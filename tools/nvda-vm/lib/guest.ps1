# Helpers for talking to the guest through VBoxManage guestcontrol.
# Requires config.ps1 to already be dot-sourced.
#
# Two ways to run things in the guest:
#   - Invoke-GuestExe: runs a program directly through guestcontrol. It runs as
#     tester but NOT on tester's interactive desktop. Fine for file operations,
#     tasklist, netstat and similar.
#   - Invoke-GuestStep: runs a PowerShell script on tester's interactive desktop
#     through the on-demand scheduled tasks JawsTestUser / JawsTestElevated
#     (part of the 'windows-ready' snapshot; the names are historical).
#     Anything that needs the desktop (NVDA, the browser, Playwright) must use it.

function Get-GuestAuthArgs {
    return @('--username', $NvdaVmUser, '--passwordfile', $NvdaVmPasswordFile)
}

# Runs a guest program directly and returns its stdout lines. Sets
# $global:GuestExitCode. Do not repeat the program name as the first argument.
function Invoke-GuestExe {
    param(
        [Parameter(Mandatory)] [string] $Exe,
        [string[]] $Arguments = @(),
        [int] $TimeoutSeconds = 120
    )
    $auth = Get-GuestAuthArgs
    $cmd = @('guestcontrol', $NvdaVmName, 'run') + $auth + @('--timeout', ($TimeoutSeconds * 1000), '--wait-stdout', '--wait-stderr', '--exe', $Exe)
    if ($Arguments.Count -gt 0) { $cmd += @('--') + $Arguments }
    $out = & $VBoxManage @cmd 2>&1
    $global:GuestExitCode = $LASTEXITCODE
    return $out | ForEach-Object { "$_" }
}

function Invoke-GuestPowerShell {
    param(
        [Parameter(Mandatory)] [string] $Command,
        [int] $TimeoutSeconds = 120
    )
    $encoded = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($Command))
    return Invoke-GuestExe -Exe 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
        -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded) -TimeoutSeconds $TimeoutSeconds
}

function Copy-ToGuest {
    param(
        [Parameter(Mandatory)] [string] $LocalPath,
        [Parameter(Mandatory)] [string] $GuestPath,
        [switch] $Recursive
    )
    $auth = Get-GuestAuthArgs
    $extra = @()
    if ($Recursive) { $extra += '--recursive' }
    $out = & $VBoxManage guestcontrol $NvdaVmName copyto @auth @extra $LocalPath $GuestPath 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "copyto failed: $LocalPath -> $GuestPath (exit $LASTEXITCODE): $out"
    }
}

function Copy-FromGuest {
    param(
        [Parameter(Mandatory)] [string] $GuestPath,
        [Parameter(Mandatory)] [string] $LocalPath,
        [switch] $Recursive
    )
    $auth = Get-GuestAuthArgs
    $extra = @()
    if ($Recursive) { $extra += '--recursive' }
    # copyfrom does not replace an existing host file (the streamed log then
    # shows an older run's lines), so remove it first. copyto does replace.
    if (-not $Recursive -and (Test-Path $LocalPath -PathType Leaf)) { Remove-Item $LocalPath -Force }
    & $VBoxManage guestcontrol $NvdaVmName copyfrom @auth @extra $GuestPath $LocalPath 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Test-GuestPath {
    param([Parameter(Mandatory)] [string] $GuestPath)
    $auth = Get-GuestAuthArgs
    & $VBoxManage guestcontrol $NvdaVmName stat @auth $GuestPath 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

# Copies a step script into the guest and runs it on tester's desktop through
# a scheduled task. A generated wrapper (user.ps1 / elevated.ps1) runs the step,
# appends all of its output to C:\jawstest\out\<StepName>.log (UTF-8) and writes
# the exit code to C:\jawstest\out\<StepName>.done. The host polls for the
# marker, streams new log lines while it waits, and returns the exit code
# (or $null on timeout).
#
# -Arguments is appended verbatim to the step invocation, so quote values
# yourself, for example: -Arguments "-Version '24.18.0'".
function Invoke-GuestStep {
    param(
        [Parameter(Mandatory)] [string] $LocalScript,
        [Parameter(Mandatory)] [string] $StepName,
        [switch] $Elevated,
        [string] $Arguments = '',
        [int] $TimeoutSeconds = 120,
        [string] $ResultsDir = $NvdaResultsDir,
        [switch] $Quiet
    )

    $wrapperName = if ($Elevated) { 'elevated.ps1' } else { 'user.ps1' }
    $taskName = if ($Elevated) { 'JawsTestElevated' } else { 'JawsTestUser' }
    $guestStep = "$GuestRunDir\step-$StepName.ps1"
    $doneMarker = "$GuestOutDir\$StepName.done"
    $logFile = "$GuestOutDir\$StepName.log"

    $wrapper = @"
`$ErrorActionPreference = 'Continue'
`$log = '$logFile'
`$code = 0
try {
    `$global:LASTEXITCODE = 0
    & '$guestStep' $Arguments *>&1 | ForEach-Object { "`$_" | Add-Content -Path `$log -Encoding UTF8 }
    if (`$LASTEXITCODE) { `$code = `$LASTEXITCODE }
} catch {
    "ERROR: `$_" | Add-Content -Path `$log -Encoding UTF8
    `$code = 1
}
Set-Content -Path '$doneMarker' -Value `$code -Encoding ASCII
"@
    $tmpDir = Join-Path $env:TEMP 'nvda-vm-steps'
    New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
    $localWrapper = Join-Path $tmpDir $wrapperName
    Set-Content -Path $localWrapper -Value $wrapper -Encoding UTF8

    Copy-ToGuest -LocalPath $LocalScript -GuestPath $guestStep
    Copy-ToGuest -LocalPath $localWrapper -GuestPath "$GuestRunDir\$wrapperName"

    # Clear any earlier marker/log for this step so a stale .done can't be misread.
    Invoke-GuestExe -Exe 'C:\Windows\System32\cmd.exe' -Arguments @('/c', "del /f /q `"$doneMarker`" `"$logFile`" 2>nul") | Out-Null

    if (-not $Quiet) { Write-Output "INFO: step '$StepName' starting via task $taskName" }
    $out = Invoke-GuestExe -Exe 'C:\Windows\System32\schtasks.exe' -Arguments @('/run', '/tn', $taskName)
    if ($global:GuestExitCode -ne 0) { throw "starting task $taskName failed (exit $global:GuestExitCode): $out" }

    New-Item -ItemType Directory -Force -Path $ResultsDir | Out-Null
    $localLog = Join-Path $ResultsDir "$StepName.log"
    $tmpLog = Join-Path $tmpDir "$StepName.partial.log"
    $printed = 0
    $started = Get-Date
    $deadline = $started.AddSeconds($TimeoutSeconds)
    $seen = $false
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 4
        if (Test-GuestPath $doneMarker) { $seen = $true; break }
        if (-not $Quiet -and (Copy-FromGuest -GuestPath $logFile -LocalPath $tmpLog)) {
            $lines = @(Get-Content $tmpLog -Encoding UTF8)
            for ($i = $printed; $i -lt $lines.Count; $i++) { Write-Output "  | $($lines[$i])" }
            $printed = $lines.Count
        }
    }

    Copy-FromGuest -GuestPath $logFile -LocalPath $localLog | Out-Null
    if (-not $Quiet -and (Test-Path $localLog)) {
        $lines = @(Get-Content $localLog -Encoding UTF8)
        for ($i = $printed; $i -lt $lines.Count; $i++) { Write-Output "  | $($lines[$i])" }
    }

    if (-not $seen) {
        Write-Output "FAIL: step '$StepName' did not finish within $TimeoutSeconds s"
        $global:LastStepExitCode = $null
        return
    }
    $localDone = Join-Path $ResultsDir "$StepName.done"
    Copy-FromGuest -GuestPath $doneMarker -LocalPath $localDone | Out-Null
    $code = if (Test-Path $localDone) { (Get-Content $localDone -Raw).Trim() } else { 'unknown' }
    $elapsed = [math]::Round(((Get-Date) - $started).TotalSeconds)
    if (-not $Quiet) { Write-Output "INFO: step '$StepName' finished in $elapsed s, exit code $code" }
    $global:LastStepExitCode = $code
}
