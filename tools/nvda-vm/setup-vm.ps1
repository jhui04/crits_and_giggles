<#
One-time setup: from snapshot 'windows-ready' to snapshot 'nvda-ready'.

Restores 'windows-ready', starts the VM headless, then inside the guest:
  1. checks that the step tasks run on tester's desktop,
  2. makes the step tasks run PowerShell hidden,
  3. installs portable Node.js (SHA-256 verified),
  4. copies the test project in and runs npm ci, Guidepup setup, Guidepup's
     NVDA install and Playwright's Chromium install,
then shuts down and takes snapshot 'nvda-ready' (replacing an older one).

Never runs anything screen-reader related on the host. Output is PASS / FAIL /
INFO lines; exits non-zero on failure.
#>
[CmdletBinding()]
param(
    # Keep an existing 'nvda-ready' snapshot and exit early.
    [switch] $SkipIfReady
)

# 'Continue', not 'Stop': in Windows PowerShell 5.1, 'Stop' turns any stderr
# output of VBoxManage into a terminating error. Exit codes are checked instead.
$ErrorActionPreference = 'Continue'
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\lib\guest.ps1"
. "$PSScriptRoot\lib\wait-ready.ps1"
. "$PSScriptRoot\lib\runner-copy.ps1"

Assert-NvdaVmPasswordFile
$vm = $NvdaVmName
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$resultsDir = Join-Path $NvdaResultsDir "setup-$stamp"
New-Item -ItemType Directory -Force -Path $resultsDir | Out-Null

if ($SkipIfReady -and (Test-NvdaSnapshotExists $NvdaReadySnapshot)) {
    Write-Output "PASS: snapshot '$NvdaReadySnapshot' already exists; nothing to do."
    exit 0
}

function Fail($msg) {
    Write-Output "FAIL: $msg"
    $shot = Join-Path $resultsDir 'failure-screenshot.png'
    & $VBoxManage controlvm $vm screenshotpng $shot 2>$null | Out-Null
    Write-Output "INFO: logs in $resultsDir"
    Stop-NvdaVmHard
    exit 1
}

trap { Fail "unexpected error: $_" }

function Invoke-RequiredStep {
    param([string] $Script, [string] $Name, [switch] $Elevated, [string] $Arguments = '', [int] $TimeoutSeconds = 300)
    Invoke-GuestStep -LocalScript (Join-Path $NvdaGuestScriptsDir $Script) -StepName $Name -Elevated:$Elevated `
        -Arguments $Arguments -TimeoutSeconds $TimeoutSeconds -ResultsDir $resultsDir
    if ("$global:LastStepExitCode" -ne '0') { Fail "guest step '$Name' failed (exit '$global:LastStepExitCode')" }
    Write-Output "PASS: $Name"
}

Stop-NvdaVmHard
Write-Output "INFO: restoring snapshot '$NvdaBaseSnapshot'"
& $VBoxManage snapshot $vm restore $NvdaBaseSnapshot 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "could not restore '$NvdaBaseSnapshot'" }
& $VBoxManage startvm $vm --type headless 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "could not start the VM headless" }
if (-not (Wait-ForGuestReady -TimeoutMinutes 10)) { Fail 'guest did not become ready within 10 minutes' }
Write-Output 'PASS: guest ready (Guest Additions up, tester logged in, desktop running)'

Invoke-RequiredStep -Script 'check-session.ps1' -Name 'check-user-session' -TimeoutSeconds 90
Invoke-RequiredStep -Script 'prep-tasks.ps1' -Name 'prep-tasks' -Elevated -TimeoutSeconds 90
Invoke-RequiredStep -Script 'prep-network.ps1' -Name 'prep-network' -Elevated -TimeoutSeconds 90
Invoke-RequiredStep -Script 'check-session.ps1' -Name 'check-user-session-hidden' -TimeoutSeconds 90
Invoke-RequiredStep -Script 'install-node.ps1' -Name 'install-node' -Arguments "-Version '$PortableNodeVersion'" -TimeoutSeconds 600

Write-Output 'INFO: copying the test project into the guest'
Copy-RunnerToGuest
Write-Output 'PASS: test project copied'

Invoke-RequiredStep -Script 'setup-runner.ps1' -Name 'setup-runner' -TimeoutSeconds 1800
Invoke-RequiredStep -Script 'prep-firewall.ps1' -Name 'prep-firewall' -Elevated -TimeoutSeconds 90
Invoke-RequiredStep -Script 'prep-user.ps1' -Name 'prep-user' -TimeoutSeconds 90

Write-Output 'INFO: shutting down to take the snapshot'
Stop-NvdaVmGuest
if (Test-NvdaSnapshotExists $NvdaReadySnapshot) {
    Write-Output "INFO: deleting the older '$NvdaReadySnapshot' snapshot"
    & $VBoxManage snapshot $vm delete $NvdaReadySnapshot 2>&1 | Out-Null
}
& $VBoxManage snapshot $vm take $NvdaReadySnapshot --description "NVDA test VM: portable Node $PortableNodeVersion, Guidepup NVDA, runner node_modules, Playwright Chromium. Made $stamp by setup-vm.ps1." 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Output "FAIL: could not take snapshot '$NvdaReadySnapshot'"; exit 1 }
Write-Output "PASS: snapshot '$NvdaReadySnapshot' taken. Logs in $resultsDir"
exit 0
