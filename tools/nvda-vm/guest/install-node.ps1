# Downloads portable Node.js into C:\jawstest\node after checking its SHA-256
# against nodejs.org's SHASUMS256.txt. Runs as a user step.
param([string] $Version = '24.18.0')
$ErrorActionPreference = 'Continue'

$zipName = "node-v$Version-win-x64.zip"
$base = "https://nodejs.org/dist/v$Version"
$dl = 'C:\jawstest\dl'
$nodeDir = 'C:\jawstest\node'
New-Item -ItemType Directory -Force -Path $dl | Out-Null
$zip = Join-Path $dl $zipName
$sums = Join-Path $dl 'SHASUMS256.txt'

"Downloading $base/$zipName"
curl.exe -sSL --retry 3 -o $zip "$base/$zipName"
if ($LASTEXITCODE -ne 0) { "FAIL: curl exit $LASTEXITCODE downloading Node"; exit 1 }
curl.exe -sSL --retry 3 -o $sums "$base/SHASUMS256.txt"
if ($LASTEXITCODE -ne 0) { "FAIL: curl exit $LASTEXITCODE downloading SHASUMS256.txt"; exit 1 }

$line = Get-Content $sums | Where-Object { $_ -match ("\s" + [regex]::Escape($zipName) + '$') } | Select-Object -First 1
if (-not $line) { "FAIL: $zipName not listed in SHASUMS256.txt"; exit 1 }
$expected = ($line -split '\s+')[0].ToLower()
$actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
"SHA-256 expected: $expected"
"SHA-256 actual:   $actual"
if ($expected -ne $actual) { "FAIL: Node.js zip hash mismatch"; exit 1 }
"PASS: Node.js zip SHA-256 verified"

if (Test-Path $nodeDir) { Remove-Item $nodeDir -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $dl -Force
Move-Item (Join-Path $dl "node-v$Version-win-x64") $nodeDir
Remove-Item $zip -Force

$v = & "$nodeDir\node.exe" --version
"node --version: $v"
if ($v -ne "v$Version") { "FAIL: unexpected node version"; exit 1 }
$npmV = & "$nodeDir\npm.cmd" --version
"npm --version: $npmV"
"PASS: portable Node.js ready in $nodeDir"
exit 0
