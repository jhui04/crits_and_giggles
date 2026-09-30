# Elevated, one-time (after Guidepup's NVDA is installed): NVDA's Remote
# Access relay listens on port 6837 on all interfaces, which made Windows show
# a "Windows Security: allow public and private networks to access this app?"
# dialog on NVDA's first start. That dialog takes the foreground (and NVDA
# reads it out). Any firewall rule for the program suppresses the prompt. A
# BLOCK rule is used: Guidepup connects over loopback, which the firewall
# does not filter, and nothing outside the VM needs to reach NVDA.
param([string] $User = 'tester')
$ErrorActionPreference = 'Continue'
$root = "C:\Users\$User\AppData\Local\guidepup\nvda\all"
$exes = Get-ChildItem $root -Recurse -Filter nvda*.exe -ErrorAction SilentlyContinue
if (-not $exes) { "FAIL: no NVDA executables under $root"; exit 1 }
foreach ($exe in $exes) {
    $name = "NVDA test VM block inbound: $($exe.Name)"
    Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName $name -Direction Inbound -Program $exe.FullName -Action Block -Profile Any | Out-Null
    "rule: $name -> $($exe.FullName)"
}
exit 0
