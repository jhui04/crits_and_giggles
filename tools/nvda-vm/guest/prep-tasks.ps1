# Elevated, one-time: makes the two step tasks start PowerShell with a hidden
# window, so no console window sits on tester's desktop and competes with the
# browser for the foreground (Guidepup's keys go to the foreground window).
$ErrorActionPreference = 'Continue'
foreach ($t in @(
    @{ Name = 'JawsTestUser'; Script = 'C:\jawstest\run\user.ps1' },
    @{ Name = 'JawsTestElevated'; Script = 'C:\jawstest\run\elevated.ps1' })) {
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $($t.Script)"
    # No execution time limit (the default is 72 h, fine, but be explicit) and allow on battery.
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
    Set-ScheduledTask -TaskName $t.Name -Action $action -Settings $settings | Out-Null
    $task = Get-ScheduledTask -TaskName $t.Name
    "$($t.Name): $($task.Actions[0].Execute) $($task.Actions[0].Arguments) (RunLevel $($task.Principal.RunLevel), LogonType $($task.Principal.LogonType))"
}
exit 0
