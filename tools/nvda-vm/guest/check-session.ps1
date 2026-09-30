# Reports who the step runs as, in which session, and whether it is elevated.
# Expect session 1 or higher (tester's desktop), not 0.
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
"whoami: $($id.Name)"
"SessionId: $((Get-Process -Id $PID).SessionId)"
"IsAdmin: $isAdmin"
"LOCALAPPDATA: $env:LOCALAPPDATA"
