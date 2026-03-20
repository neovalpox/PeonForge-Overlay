# List ALL terminal windows across all virtual desktops
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class WinEnum {
    public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc proc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder sb, int maxCount);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

    public static List<int[]> FindWindowsByProcess(string processName) {
        var results = new List<int[]>();
        var targetPids = new HashSet<uint>();

        foreach (var proc in System.Diagnostics.Process.GetProcessesByName(processName)) {
            targetPids.Add((uint)proc.Id);
        }

        EnumWindows((hwnd, _) => {
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            if (targetPids.Contains(pid)) {
                int len = GetWindowTextLength(hwnd);
                if (len > 0) {
                    results.Add(new int[] { (int)pid, (int)hwnd });
                }
            }
            return true;
        }, IntPtr.Zero);

        return results;
    }

    public static string GetTitle(IntPtr hwnd) {
        int len = GetWindowTextLength(hwnd);
        if (len <= 0) return "";
        var sb = new StringBuilder(len + 1);
        GetWindowText(hwnd, sb, sb.Capacity);
        return sb.ToString();
    }
}
'@

$results = @()

# Find ALL windows belonging to WindowsTerminal
$windows = [WinEnum]::FindWindowsByProcess("WindowsTerminal")
foreach ($w in $windows) {
    $procId = $w[0]
    $hwnd = [IntPtr]$w[1]
    $title = [WinEnum]::GetTitle($hwnd)
    if ($title.Length -gt 0 -and $title -ne "Default IME" -and $title -ne "MSCTFIME UI" -and $title -notmatch "^GDI\+") {
        $results += @{ pid = $procId; hwnd = $w[1]; title = $title }
    }
}

$results | ConvertTo-Json -Compress
