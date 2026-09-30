# Elevated, one-time: turns IPv6 off on the guest's network adapter.
# VirtualBox NAT gives the guest a ULA IPv6 address and an IPv6 default route,
# but IPv6 traffic never gets out, so IPv6 connects hang instead of failing.
# Playwright's downloader tries IPv6 first and then aborts with a bogus
# "timed out after 30000ms" after about 5 s, so `playwright install` failed.
$ErrorActionPreference = 'Continue'
Get-NetAdapter | ForEach-Object {
    Disable-NetAdapterBinding -Name $_.Name -ComponentID ms_tcpip6 -ErrorAction Continue
    $b = Get-NetAdapterBinding -Name $_.Name -ComponentID ms_tcpip6
    "$($_.Name): IPv6 binding enabled = $($b.Enabled)"
}
exit 0
