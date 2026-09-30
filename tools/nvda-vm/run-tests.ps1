<#
Runs the NVDA screen reader test suite inside the VM, from a clean snapshot.

  1. Builds the app if dist/ is stale and starts the app servers on the host
     (before the VM starts, so a failed build or a busy port fails fast).
  2. Restores snapshot 'nvda-ready' and starts the VM headless (null audio).
  3. Waits for Windows, copies in the latest tools/nvda-vm/runner.
  4. Runs Playwright on tester's desktop through the JawsTestUser task.
     Guidepup starts NVDA there; Playwright opens a headed Chromium there.
  5. Copies results back to tools/nvda-vm/results/<timestamp>/.
  6. Stops the host servers, shuts the VM down, prints the text summary.

Nothing screen-reader related runs on the host. Output is PASS / FAIL / INFO
lines plus Playwright's list reporter. Exits 0 only if every test passed.

Examples:
  powershell -NoProfile -ExecutionPolicy Bypass -File tools\nvda-vm\run-tests.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File tools\nvda-vm\run-tests.ps1 -Grep "Oracle"
#>
[CmdletBinding()]
param(
    # Only run tests whose title matches this regular expression.
    [string] $Grep = '',
    # Leave the VM running afterwards (for diagnosis). Default: shut it down.
    [switch] $KeepVmRunning,
    # For iterating on a test: use the VM as it is now (running, for example
    # after -KeepVmRunning) instead of restoring 'nvda-ready'. Faster, but the
    # results are then not from a clean state.
    [switch] $UseRunningVm,
    [int] $TestTimeoutMinutes = 20
)

# 'Continue', not 'Stop': in Windows PowerShell 5.1, 'Stop' turns any stderr
# output of VBoxManage into a terminating error. Exit codes are checked instead.
$ErrorActionPreference = 'Continue'
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\lib\guest.ps1"
. "$PSScriptRoot\lib\wait-ready.ps1"
. "$PSScriptRoot\lib\runner-copy.ps1"
. "$PSScriptRoot\lib\app-servers.ps1"

Assert-NvdaVmPasswordFile
$vm = $NvdaVmName
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$resultsDir = Join-Path $NvdaResultsDir $stamp
New-Item -ItemType Directory -Force -Path $resultsDir | Out-Null
$runStart = Get-Date
$servers = $null

function Finish([int] $code, [string] $message) {
    if ($servers) { Stop-HostAppServers $servers; Write-Output 'INFO: host app servers stopped' }
    if ($KeepVmRunning) {
        Write-Output "INFO: leaving the VM running (-KeepVmRunning)"
    } else {
        Write-Output 'INFO: shutting the VM down'
        try { Stop-NvdaVmGuest } catch { Write-Output "INFO: $_"; Stop-NvdaVmHard }
    }
    $mins = [math]::Round(((Get-Date) - $runStart).TotalMinutes, 1)
    Write-Output "INFO: results in $resultsDir ($mins min in total)"
    if ($code -eq 0) { Write-Output "PASS: $message" } else { Write-Output "FAIL: $message" }
    exit $code
}

trap { Finish 1 "unexpected error: $_" }

# Before the VM starts, so a failed build or a busy port fails fast.
Write-Output 'INFO: building (if needed) and starting the app servers on the host'
$servers = Start-HostAppServers -LogDir $resultsDir
if (-not $servers.Ok) { Finish 1 'host app servers did not start; see app-build.log and *-server*.log in the results folder' }

if ($UseRunningVm) {
    Write-Output 'INFO: -UseRunningVm: not restoring a snapshot (diagnosis mode, not a clean run)'
    if ((Get-NvdaVmState) -ne 'running') { $KeepVmRunning = $true; Finish 1 'the VM is not running' }
} else {
    if (-not (Test-NvdaSnapshotExists $NvdaReadySnapshot)) {
        Finish 1 "snapshot '$NvdaReadySnapshot' not found. Run setup-vm.ps1 first."
    }
    Stop-NvdaVmHard
    Write-Output "INFO: restoring snapshot '$NvdaReadySnapshot' and starting the VM headless"
    & $VBoxManage snapshot $vm restore $NvdaReadySnapshot 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Finish 1 "could not restore '$NvdaReadySnapshot'" }
    & $VBoxManage startvm $vm --type headless 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Finish 1 'could not start the VM' }
}
if (-not (Wait-ForGuestReady -TimeoutMinutes 10)) { Finish 1 'guest did not become ready within 10 minutes' }
Write-Output 'PASS: guest ready'

Write-Output 'INFO: copying the test project into the guest'
Copy-RunnerToGuest
Write-Output 'PASS: test project copied'

# Give the fresh desktop a moment to finish logon work before NVDA starts.
Start-Sleep -Seconds 15

$grepArg = ''
if ($Grep) { $grepArg = "-Grep '" + $Grep.Replace("'", "''") + "'" }
Write-Output 'INFO: running the NVDA suite on the guest desktop'
Invoke-GuestStep -LocalScript (Join-Path $NvdaGuestScriptsDir 'run-playwright.ps1') -StepName 'playwright' `
    -Arguments "$grepArg -AppHost '$GuestAppHost'" -TimeoutSeconds ($TestTimeoutMinutes * 60) -ResultsDir $resultsDir
$pwCode = "$global:LastStepExitCode"

if ($pwCode -ne '0') {
    Write-Output 'INFO: collecting a window list from the guest for diagnosis'
    Invoke-GuestStep -LocalScript (Join-Path $NvdaGuestScriptsDir 'windows.ps1') -StepName 'windows' `
        -TimeoutSeconds 90 -ResultsDir $resultsDir -Quiet
    $winLog = Join-Path $resultsDir 'windows.log'
    if (Test-Path $winLog) { Get-Content $winLog -Encoding UTF8 | ForEach-Object { "  | $_" } }
}

Write-Output 'INFO: copying Playwright results back'
Copy-FromGuest -GuestPath "$GuestOutDir\playwright" -LocalPath (Join-Path $resultsDir 'playwright') -Recursive | Out-Null
$summary = Join-Path $resultsDir 'playwright\summary.txt'
if (-not (Test-Path $summary)) {
    # copyfrom of a directory may nest it one level deeper, depending on VBoxManage.
    $found = Get-ChildItem $resultsDir -Recurse -Filter summary.txt -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { $summary = $found.FullName }
}

Write-Output ''
Write-Output '===== NVDA test summary ====='
if (Test-Path $summary) {
    Get-Content $summary -Encoding UTF8 | Write-Output
} else {
    Write-Output 'FAIL: no summary.txt came back from the guest; see playwright.log in the results folder'
}
Write-Output '============================='

if ($pwCode -eq '0') { Finish 0 'NVDA suite passed' }
Finish 1 "NVDA suite failed (Playwright exit code '$pwCode')"
