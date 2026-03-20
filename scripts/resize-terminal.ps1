param(
    [long]$Hwnd = 0,
    [int]$Width = 0,
    [int]$Height = 0,
    [switch]$Restore
)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class WinResize {
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    public static string GetSize(IntPtr hwnd) {
        RECT r;
        GetWindowRect(hwnd, out r);
        return r.Left + "," + r.Top + "," + (r.Right - r.Left) + "," + (r.Bottom - r.Top);
    }

    public static void Resize(IntPtr hwnd, int x, int y, int w, int h) {
        MoveWindow(hwnd, x, y, w, h, true);
    }
}
'@

if ($Hwnd -eq 0) { exit }

$hwndPtr = [IntPtr]$Hwnd
$stateFile = Join-Path $env:USERPROFILE ".peonping-overlay\terminal-original-size.json"

if ($Restore) {
    # Restore original size
    if (Test-Path $stateFile) {
        $state = Get-Content $stateFile | ConvertFrom-Json
        [WinResize]::Resize($hwndPtr, $state.x, $state.y, $state.w, $state.h)
        Remove-Item $stateFile
        Write-Output "RESTORED"
    }
} else {
    # Save current size and resize
    $current = [WinResize]::GetSize($hwndPtr)
    $parts = $current.Split(',')
    $state = @{ x = [int]$parts[0]; y = [int]$parts[1]; w = [int]$parts[2]; h = [int]$parts[3]; hwnd = $Hwnd }
    $state | ConvertTo-Json | Set-Content $stateFile

    if ($Width -gt 0 -and $Height -gt 0) {
        # Calculate position: center on screen
        Add-Type -AssemblyName System.Windows.Forms
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
        $x = [Math]::Max(0, ($screen.Width - $Width) / 2)
        $y = [Math]::Max(0, ($screen.Height - $Height) / 2)
        [WinResize]::Resize($hwndPtr, $x, $y, $Width, $Height)
        Write-Output "RESIZED to ${Width}x${Height}"
    }
}
