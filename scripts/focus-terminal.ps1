param([string]$ProjectName = "")

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class VDesktop {
    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("a5cd92ff-29be-454c-8d04-d82879fb3f1b")]
    private interface IVirtualDesktopManager {
        [PreserveSig] int IsWindowOnCurrentVirtualDesktop(IntPtr h, out bool b);
        [PreserveSig] int GetWindowDesktopId(IntPtr h, out Guid g);
        [PreserveSig] int MoveWindowToDesktop(IntPtr h, ref Guid g);
    }

    private static readonly Guid CLSID = new Guid("aa509086-5ca9-4c25-8f95-589d3c07b48a");

    public static string MoveToCurrentDesktop(IntPtr targetHwnd) {
        try {
            Type t = Type.GetTypeFromCLSID(CLSID);
            IVirtualDesktopManager vdm = (IVirtualDesktopManager)Activator.CreateInstance(t);

            // Get target desktop GUID
            Guid targetDesktop;
            vdm.GetWindowDesktopId(targetHwnd, out targetDesktop);

            // Find the REAL current desktop by looking at a normal window
            // (not alwaysOnTop, not WindowsTerminal which lies)
            Guid currentDesktop = Guid.Empty;
            EnumWindows((hwnd, _) => {
                try {
                    if (!IsWindowVisible(hwnd)) return true;

                    // Skip windows that report GUID 00000000 (alwaysOnTop/special)
                    Guid g;
                    if (vdm.GetWindowDesktopId(hwnd, out g) != 0 || g == Guid.Empty) return true;

                    // Check if this window is truly on the current desktop
                    bool here;
                    vdm.IsWindowOnCurrentVirtualDesktop(hwnd, out here);

                    // Only trust windows that are NOT WindowsTerminal (which lies)
                    // and have a non-empty GUID
                    uint pid;
                    GetWindowThreadProcessId(hwnd, out pid);

                    if (here && g != Guid.Empty) {
                        currentDesktop = g;
                        return false; // found it
                    }
                } catch {}
                return true;
            }, IntPtr.Zero);

            if (currentDesktop == Guid.Empty)
                return "NO_CURRENT_DESKTOP";

            // Compare GUIDs directly (don't trust IsWindowOnCurrentVirtualDesktop for the target)
            if (currentDesktop == targetDesktop)
                return "SAME_DESKTOP";

            // Move target to current desktop
            int hr = vdm.MoveWindowToDesktop(targetHwnd, ref currentDesktop);
            return hr == 0 ? "MOVED" : "MOVE_HR=" + hr;
        } catch (Exception ex) {
            return "ERR:" + ex.GetType().Name + ":" + ex.Message;
        }
    }

    public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc proc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@

# Find Claude terminal
$target = Get-Process | Where-Object {
    $_.MainWindowHandle -ne 0 -and $_.ProcessName -eq 'WindowsTerminal' -and $_.MainWindowTitle -match 'claude'
} | Select-Object -First 1

if (-not $target) {
    $target = Get-Process | Where-Object {
        $_.MainWindowHandle -ne 0 -and $_.ProcessName -eq 'WindowsTerminal'
    } | Select-Object -First 1
}
if (-not $target) { exit }

$hwnd = $target.MainWindowHandle

# Move to current desktop (comparing GUIDs, not trusting IsWindowOnCurrentVirtualDesktop)
$moveResult = [VDesktop]::MoveToCurrentDesktop($hwnd)

# Focus
$wsh = New-Object -ComObject WScript.Shell
$focusResult = $wsh.AppActivate($target.MainWindowTitle)

Add-Content -Path (Join-Path $env:USERPROFILE ".peonping-overlay\focus-debug.log") -Value "$(Get-Date -Format o) | $($target.MainWindowTitle) | move=$moveResult | focus=$focusResult"
Write-Output "$focusResult|$($target.MainWindowTitle)|$moveResult"
