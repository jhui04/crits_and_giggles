# User step, one-time (setup-vm.ps1): installs the test project's npm packages,
# Playwright's Chromium, and Guidepup's portable NVDA into tester's profile.
$ErrorActionPreference = 'Continue'
$env:Path = "C:\jawstest\node;$env:Path"
$env:NO_COLOR = '1'
$env:npm_config_update_notifier = 'false'
$env:npm_config_fund = 'false'
$env:npm_config_audit = 'false'
Set-Location 'C:\jawstest\runner'

function Step($label, [scriptblock] $block) {
    "--- $label"
    & $block 2>&1 | ForEach-Object { "$_" }
    if ($LASTEXITCODE -ne 0) { "FAIL: $label (exit $LASTEXITCODE)"; exit 1 }
    "PASS: $label"
}

Step 'npm install' { if (Test-Path package-lock.json) { npm.cmd ci } else { npm.cmd install } }
Step 'guidepup setup --ci' { npx.cmd --no-install guidepup setup --ci }
Step 'guidepup install nvda' { npx.cmd --no-install guidepup install nvda }
# Playwright's downloader reported bogus "timed out after 30000ms" errors in
# this VM, even after prep-network.ps1 turned IPv6 off, then succeeded on a
# later attempt. Retry the whole install a few times.
$env:PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT = '120000'
$pwOk = $false
for ($i = 1; $i -le 3 -and -not $pwOk; $i++) {
    "--- playwright install chromium (attempt $i)"
    # --no-shell: tests always run headed, so skip the 115 MB headless shell.
    npx.cmd --no-install playwright install chromium --no-shell 2>&1 | Where-Object { "$_" -notmatch '\d+% of ' } | ForEach-Object { "$_" }
    if ($LASTEXITCODE -eq 0) { $pwOk = $true } else { "INFO: attempt $i failed (exit $LASTEXITCODE)"; Start-Sleep -Seconds 20 }
}
if (-not $pwOk) { "FAIL: playwright install chromium"; exit 1 }
"PASS: playwright install chromium"

# Guidepup's installer (unzipper, under Node 24.18) left about 40 of NVDA's
# 1783 files zero-filled at the right size, e.g. VCRUNTIME140.dll, so nvda.exe
# died with a "Bad Image" (0xc000012f) system dialog and never opened port
# 6837. Re-extract every entry with .NET from the zip Guidepup downloaded and
# SHA-256-checked, then verify every file byte for byte against the zip.
"--- re-extract and verify NVDA files"
$nvdaBase = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'guidepup\nvda\all') -Directory | Select-Object -First 1
$nvdaZip = Get-ChildItem $nvdaBase.FullName -Filter *.zip | Select-Object -First 1
if (-not $nvdaZip) { "FAIL: Guidepup's NVDA zip not found under $($nvdaBase.FullName)"; exit 1 }
$extracted = Join-Path $nvdaBase.FullName 'extracted'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$sha = [Security.Cryptography.SHA256]::Create()
$z = [IO.Compression.ZipFile]::OpenRead($nvdaZip.FullName)
$rewritten = 0; $bad = 0; $count = 0
try {
    foreach ($e in $z.Entries) {
        if (-not $e.Name) { continue }
        $count++
        $target = Join-Path $extracted ($e.FullName -replace '/', '\')
        $s = $e.Open(); $ms = New-Object IO.MemoryStream; $s.CopyTo($ms); $s.Dispose()
        $bytes = $ms.ToArray()
        $want = [BitConverter]::ToString($sha.ComputeHash($bytes))
        $have = if (Test-Path $target) { [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($target))) } else { '' }
        if ($want -ne $have) {
            New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
            [IO.File]::WriteAllBytes($target, $bytes)
            $rewritten++
            $have = [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($target)))
            if ($want -ne $have) { "BAD: $($e.FullName)"; $bad++ }
        }
    }
} finally { $z.Dispose() }
"NVDA files: $count in zip, $rewritten rewritten, $bad still wrong"
if ($bad -gt 0) { "FAIL: NVDA files do not match the zip"; exit 1 }
"PASS: NVDA files match the zip byte for byte"

$gp = Join-Path $env:LOCALAPPDATA 'guidepup'
$nvdaExe = Get-ChildItem -Path $gp -Recurse -Filter nvda.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $nvdaExe) { "FAIL: nvda.exe not found under $gp"; exit 1 }
"nvda.exe: $($nvdaExe.FullName)"
$ini = Join-Path $nvdaExe.DirectoryName 'userConfig\nvda.ini'
if (Test-Path $ini) {
    "--- Guidepup's NVDA user config ($ini):"
    Get-Content $ini
}
$pw = Join-Path $env:LOCALAPPDATA 'ms-playwright'
"Playwright browsers: $((Get-ChildItem $pw -Directory -ErrorAction SilentlyContinue | ForEach-Object Name) -join ', ')"
# Record which package-lock the snapshot's node_modules came from, so
# run-tests can skip reinstalling when nothing changed.
(Get-FileHash package-lock.json -Algorithm SHA256).Hash | Set-Content 'C:\jawstest\runner-lock.sha256' -Encoding ASCII
"PASS: runner setup complete"
exit 0
