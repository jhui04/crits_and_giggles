# Waits until the VM's Guest Additions are up, tester is logged in, guest
# control works, and Explorer (the desktop) is running.
# Requires config.ps1 and lib/guest.ps1 to already be dot-sourced.

function Wait-ForGuestReady {
    param([int] $TimeoutMinutes = 10)

    $vm = $NvdaVmName
    $started = Get-Date
    $deadline = $started.AddMinutes($TimeoutMinutes)
    $lastPrinted = -1

    while ((Get-Date) -lt $deadline) {
        $elapsedMin = [math]::Floor(((Get-Date) - $started).TotalMinutes)
        if ($elapsedMin -ne $lastPrinted) {
            Write-Host "INFO: waiting for the guest to be ready ($elapsedMin/$TimeoutMinutes min)"
            $lastPrinted = $elapsedMin
        }

        $gaVersion = & $VBoxManage guestproperty get $vm '/VirtualBox/GuestAdd/Version' 2>$null
        $loggedIn = & $VBoxManage guestproperty get $vm '/VirtualBox/GuestInfo/OS/LoggedInUsers' 2>$null
        $gaOk = $gaVersion -and ($gaVersion -notmatch 'No value set')
        $loginOk = $false
        if ($loggedIn -match 'Value:\s*(\d+)') { $loginOk = [int]$matches[1] -ge 1 }

        if ($gaOk -and $loginOk) {
            $tl = Invoke-GuestExe -Exe 'C:\Windows\System32\tasklist.exe' -Arguments @('/fi', 'IMAGENAME eq explorer.exe', '/fo', 'csv', '/nh') -TimeoutSeconds 30
            if ($global:GuestExitCode -eq 0 -and ($tl -join "`n") -match 'explorer\.exe') {
                return $true
            }
        }
        Start-Sleep -Seconds 10
    }
    return $false
}
