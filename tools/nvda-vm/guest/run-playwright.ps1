# User step, every run: runs the NVDA Playwright suite on tester's desktop.
# Playwright launches a headed Chromium, and Guidepup's nvdaTest fixture starts
# NVDA, so all three share this interactive desktop.
# -AppHost: where the guest reaches the host's app servers (10.0.2.2 through
# VirtualBox NAT). run-tests.ps1 always passes it; the runner's
# global-setup.ts forwards localhost:5174 and :3005 to it.
param([string] $Grep = '', [string] $AppHost = '')
$ErrorActionPreference = 'Continue'
# Not [Parameter(Mandatory)]: a missing value would make PowerShell wait for
# input in a hidden window until the step times out.
if (-not $AppHost) { "FAIL: -AppHost is required (run this through run-tests.ps1)"; exit 1 }
$env:Path = "C:\jawstest\node;$env:Path"
$env:NO_COLOR = '1'
$env:CI = '1'
# Decode child-process output as UTF-8, so the list reporter's characters
# survive the trip into the log.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$env:npm_config_update_notifier = 'false'
$env:NVDA_RESULTS_DIR = 'C:\jawstest\out\playwright'
$env:NVDA_APP_HOST = $AppHost
Set-Location 'C:\jawstest\runner'

# Keep pop-ups off the desktop: they take the foreground, so NVDA's keys stop
# reaching the browser. About 10 minutes after boot, OneDrive once showed a
# "Turn On Windows Backup" notification ("New notification",
# ShellExperienceHost) and every later test heard nothing. Done here, every
# run, so the 'nvda-ready' snapshot does not need rebuilding.
$notifKeys = @{
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\PushNotifications' = 'ToastEnabled'
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings' = 'NOC_GLOBAL_SETTING_TOASTS_ENABLED'
}
foreach ($k in $notifKeys.Keys) {
    New-Item -Path $k -Force -ErrorAction SilentlyContinue | Out-Null
    New-ItemProperty -Path $k -Name $notifKeys[$k] -Value 0 -PropertyType DWord -Force -ErrorAction SilentlyContinue | Out-Null
}
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'OneDrive' -ErrorAction SilentlyContinue
$od = Get-Process -Name 'OneDrive*' -ErrorAction SilentlyContinue
if ($od) { $od | Stop-Process -Force -ErrorAction SilentlyContinue; "INFO: stopped OneDrive and turned notifications off" }
else { "INFO: turned notifications off (OneDrive was not running)" }

# Reinstall packages only if the lockfile differs from the one baked into the snapshot.
$lockHash = (Get-FileHash package-lock.json -Algorithm SHA256).Hash
$baked = if (Test-Path 'C:\jawstest\runner-lock.sha256') { (Get-Content 'C:\jawstest\runner-lock.sha256' -Raw).Trim() } else { '' }
if ($lockHash -ne $baked) {
    "INFO: package-lock.json changed since the snapshot; running npm ci"
    npm.cmd ci 2>&1 | ForEach-Object { "$_" }
    if ($LASTEXITCODE -ne 0) { "FAIL: npm ci (exit $LASTEXITCODE)"; exit 1 }
}

$pwArgs = @('--no-install', 'playwright', 'test')
if ($Grep) { $pwArgs += @('--grep', $Grep) }
"INFO: npx $($pwArgs -join ' ')"
& npx.cmd @pwArgs 2>&1 | ForEach-Object { "$_" }
$code = $LASTEXITCODE
"INFO: playwright exit code $code"
exit $code
