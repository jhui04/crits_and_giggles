# Central configuration for the NVDA-in-a-VM test scripts.
# Dot-source this from every top-level script: `. "$PSScriptRoot\config.ps1"`
#
# The names 'jaws-rcs-test', C:\jawstest and the JawsTestUser / JawsTestElevated
# tasks are historical: the VM was first built for an abandoned JAWS attempt.
# Nothing JAWS-specific is installed in it. The names are kept because renaming
# them would mean rebuilding the snapshots.

$Global:NvdaVmName = 'jaws-rcs-test'
$Global:NvdaVmUser = 'tester'

# Snapshots: 'windows-ready' is clean Windows plus the task/prep setup.
# 'nvda-ready' adds portable Node, Guidepup's NVDA, the runner's node_modules
# and Playwright's Chromium (made by setup-vm.ps1). run-tests.ps1 restores it.
$Global:NvdaBaseSnapshot = 'windows-ready'
$Global:NvdaReadySnapshot = 'nvda-ready'

$Global:NvdaVmHostRoot = Join-Path $env:USERPROFILE 'jaws-vm'
# Plain ASCII, no BOM: a UTF-8 BOM breaks guest authentication.
$Global:NvdaVmPasswordFile = Join-Path $NvdaVmHostRoot 'vm-password.txt'

$Global:VBoxManage = 'C:\Program Files\Oracle\VirtualBox\VBoxManage.exe'

$Global:NvdaScriptsRoot = $PSScriptRoot
$Global:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Global:NvdaGuestScriptsDir = Join-Path $NvdaScriptsRoot 'guest'
$Global:NvdaRunnerDir = Join-Path $NvdaScriptsRoot 'runner'
$Global:NvdaResultsDir = Join-Path $NvdaScriptsRoot 'results'

# Paths inside the guest. The guest/*.ps1 step scripts run without this file,
# so they spell out the same C:\jawstest paths themselves.
$Global:GuestRunDir = 'C:\jawstest\run'
$Global:GuestOutDir = 'C:\jawstest\out'
$Global:GuestRunnerDir = 'C:\jawstest\runner'

# Portable Node.js for inside the VM (guest/install-node.ps1 downloads it from
# nodejs.org and checks it against SHASUMS256.txt).
$Global:PortableNodeVersion = '24.18.0'

function Assert-NvdaVmPasswordFile {
    if (-not (Test-Path $NvdaVmPasswordFile)) {
        throw "Password file not found: $NvdaVmPasswordFile"
    }
    $bytes = [System.IO.File]::ReadAllBytes($NvdaVmPasswordFile)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        throw "Password file $NvdaVmPasswordFile starts with a UTF-8 BOM, which breaks guest authentication. Rewrite it as plain ASCII."
    }
}

function Get-NvdaVmState {
    $line = & $VBoxManage showvminfo $NvdaVmName --machinereadable 2>$null | Select-String '^VMState='
    if ($line -match '"(.+)"') { return $matches[1] }
    return 'unknown'
}

function Wait-NvdaVmPoweredOff {
    param([int] $TimeoutMinutes = 5)
    $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
    while ((Get-Date) -lt $deadline) {
        if ((Get-NvdaVmState) -eq 'poweroff') { return $true }
        Start-Sleep -Seconds 5
    }
    return $false
}

# acpipowerbutton is unreliable on this Windows 11 guest. Shut down from inside
# the guest with shutdown.exe, and fall back to a hard power-off if that stalls.
function Stop-NvdaVmGuest {
    param([int] $TimeoutMinutes = 5)
    if ((Get-NvdaVmState) -eq 'poweroff') { return }
    # Do not repeat the program name after `--`: it would become an extra argument.
    & $VBoxManage guestcontrol $NvdaVmName run --username $NvdaVmUser --passwordfile $NvdaVmPasswordFile `
        --exe 'C:\Windows\System32\shutdown.exe' -- /s /t 0 /f 2>$null | Out-Null
    if (-not (Wait-NvdaVmPoweredOff -TimeoutMinutes $TimeoutMinutes)) {
        Write-Output "INFO: in-guest shutdown did not finish within $TimeoutMinutes min; forcing power off"
        & $VBoxManage controlvm $NvdaVmName poweroff 2>$null | Out-Null
        if (-not (Wait-NvdaVmPoweredOff -TimeoutMinutes 2)) {
            throw "VM $NvdaVmName did not power off"
        }
    }
}

# Hard power-off, for when the guest is unresponsive. Only used on failure paths.
function Stop-NvdaVmHard {
    if ((Get-NvdaVmState) -ne 'poweroff') {
        & $VBoxManage controlvm $NvdaVmName poweroff 2>$null | Out-Null
        Wait-NvdaVmPoweredOff -TimeoutMinutes 2 | Out-Null
    }
}

function Test-NvdaSnapshotExists {
    param([Parameter(Mandatory)] [string] $Name)
    $list = & $VBoxManage snapshot $NvdaVmName list --machinereadable 2>$null
    return [bool]($list | Select-String -SimpleMatch "=`"$Name`"")
}
