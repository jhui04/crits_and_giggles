# User step, one-time: per-user settings for tester.
$ErrorActionPreference = 'Continue'

# Windows 11 hosts console programs in Windows Terminal by default, which
# ignores -WindowStyle Hidden, so the step task's PowerShell showed up as a
# foreground Windows Terminal window. Force the classic console host instead
# (the GUID below is conhost's "legacy console" delegation value).
$conhost = '{B23D10C0-E52E-411E-9D5B-C09FDF709C7D}'
$key = 'HKCU:\Console\%%Startup'
New-Item -Path $key -Force | Out-Null
New-ItemProperty -Path $key -Name 'DelegationConsole' -Value $conhost -PropertyType String -Force | Out-Null
New-ItemProperty -Path $key -Name 'DelegationTerminal' -Value $conhost -PropertyType String -Force | Out-Null
"Console delegation set to conhost: $((Get-ItemProperty $key).DelegationConsole)"
exit 0
