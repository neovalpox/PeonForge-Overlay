param(
    [string]$OutputPath = "",
    [int]$TargetPid = 0,
    [string]$ProjectName = "",
    [long]$Hwnd = 0
)

if (-not $OutputPath) {
    $OutputPath = Join-Path $env:USERPROFILE ".peonping-overlay\terminal-capture.jpg"
}

Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class TermCapture {
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);

    [StructLayout(LayoutKind.Sequential)]
    struct RECT { public int Left, Top, Right, Bottom; }

    public static bool Capture(IntPtr hwnd, string outPath) {
        RECT r;
        if (!GetWindowRect(hwnd, out r)) return false;
        int w = r.Right - r.Left;
        int h = r.Bottom - r.Top;
        if (w <= 0 || h <= 0) return false;

        using (Bitmap bmp = new Bitmap(w, h)) {
            using (Graphics gfx = Graphics.FromImage(bmp)) {
                IntPtr hdc = gfx.GetHdc();
                bool ok = PrintWindow(hwnd, hdc, 2);
                gfx.ReleaseHdc(hdc);
                if (!ok) gfx.CopyFromScreen(r.Left, r.Top, 0, 0, bmp.Size);
            }
            var encoder = GetEncoder(ImageFormat.Jpeg);
            var encoderParams = new EncoderParameters(1);
            encoderParams.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 85L);
            bmp.Save(outPath, encoder, encoderParams);
            return true;
        }
    }

    static ImageCodecInfo GetEncoder(ImageFormat format) {
        foreach (var codec in ImageCodecInfo.GetImageEncoders())
            if (codec.FormatID == format.Guid) return codec;
        return null;
    }
}
'@ -ReferencedAssemblies System.Drawing

# Direct capture by window handle (each Claude window has its own hwnd)
if ($Hwnd -ne 0) {
    $result = [TermCapture]::Capture([IntPtr]$Hwnd, $OutputPath)
    if ($result) { Write-Output "OK|$OutputPath" } else { Write-Output "FAIL|hwnd capture" }
    exit
}

# Fallback: find WindowsTerminal by process
$proc = Get-Process WindowsTerminal -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    Select-Object -First 1

if (-not $proc) { Write-Output "FAIL|no terminal"; exit }

# If a project name is specified, try to switch to the right tab
# Windows Terminal tabs can be switched with Ctrl+Shift+<number> or by cycling with Ctrl+Tab
if ($ProjectName -and $ProjectName -ne 'Claude') {
    try {
        # Use wt.exe focusTab command if available (Windows Terminal 1.11+)
        # Unfortunately wt.exe doesn't support focusing by title directly
        # We'll use UI Automation to find and click the right tab

        Add-Type -AssemblyName UIAutomationClient
        Add-Type -AssemblyName UIAutomationTypes

        $root = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)

        # Find tab items
        $tabCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::TabItem
        )
        $tabs = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCondition)

        foreach ($tab in $tabs) {
            $tabName = $tab.Current.Name
            if ($tabName -match [regex]::Escape($ProjectName)) {
                # Click on this tab using SelectionItemPattern
                try {
                    $pattern = $tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
                    $pattern.Select()
                    Start-Sleep -Milliseconds 200
                } catch {
                    # Fallback: invoke pattern
                    try {
                        $invokePattern = $tab.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                        $invokePattern.Invoke()
                        Start-Sleep -Milliseconds 200
                    } catch {}
                }
                break
            }
        }
    } catch {
        # UI Automation failed, just capture current tab
    }
}

# Capture
$result = [TermCapture]::Capture($proc.MainWindowHandle, $OutputPath)
if ($result) { Write-Output "OK|$OutputPath" }
else { Write-Output "FAIL|capture error" }
