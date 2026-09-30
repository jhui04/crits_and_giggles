# Diagnostics, as text: lists the foreground window, every top-level window
# (with its process), and the buttons inside each, through UI Automation.
# Also lists the processes of interest. Run as a user step on tester's desktop.
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class NvdaVmWin {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@

$fg = [NvdaVmWin]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[NvdaVmWin]::GetWindowText($fg, $sb, 512) | Out-Null
$fgPid = 0
[NvdaVmWin]::GetWindowThreadProcessId($fg, [ref]$fgPid) | Out-Null
$fgProc = (Get-Process -Id $fgPid -ErrorAction SilentlyContinue).ProcessName
"FOREGROUND: '$($sb.ToString())' (process $fgProc, pid $fgPid)"

$root = [System.Windows.Automation.AutomationElement]::RootElement
$winCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Window)
$btnCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button)
$textCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Text)
foreach ($w in $root.FindAll([System.Windows.Automation.TreeScope]::Children, $winCond)) {
    $p = (Get-Process -Id $w.Current.ProcessId -ErrorAction SilentlyContinue).ProcessName
    "WINDOW: '$($w.Current.Name)' (process $p)"
    try {
        foreach ($b in $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $btnCond)) {
            if ($b.Current.Name) { "  BUTTON: $($b.Current.Name)" }
        }
        $n = 0
        foreach ($t in $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $textCond)) {
            if ($t.Current.Name -and $n -lt 15) { "  TEXT: $($t.Current.Name)"; $n++ }
        }
    } catch { "  (could not list controls: $_)" }
}

"PROCESSES:"
Get-Process | Where-Object { $_.ProcessName -match '^(nvda|nvda_.*|chrome|node|powershell|msedge|cscript)$' } |
    ForEach-Object { "  $($_.ProcessName) pid $($_.Id) session $($_.SessionId) title '$($_.MainWindowTitle)'" }
"LISTENING 6837:"
netstat -ano | Select-String ':6837\s' | ForEach-Object { "  $_" }
exit 0
