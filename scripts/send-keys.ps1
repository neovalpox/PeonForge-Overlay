param(
    [string]$Keys = "",
    [long]$Hwnd = 0
)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

public class KeySender {
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern IntPtr FindWindowEx(IntPtr hwndParent, IntPtr hwndChildAfter, string lpszClass, string lpszWindow);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int dwProcessId);

    const uint WM_CHAR = 0x0102;
    const uint WM_KEYDOWN = 0x0100;
    const uint WM_KEYUP = 0x0101;

    public static void SendText(IntPtr hwnd, string text) {
        foreach (char c in text) {
            PostMessage(hwnd, WM_CHAR, (IntPtr)c, IntPtr.Zero);
            Thread.Sleep(10);
        }
    }

    public static void SendVKey(IntPtr hwnd, byte vk) {
        PostMessage(hwnd, WM_KEYDOWN, (IntPtr)vk, IntPtr.Zero);
        Thread.Sleep(20);
        PostMessage(hwnd, WM_KEYUP, (IntPtr)vk, IntPtr.Zero);
    }

    // VK codes
    public const byte VK_RETURN = 0x0D;
    public const byte VK_ESCAPE = 0x1B;
    public const byte VK_TAB = 0x09;
    public const byte VK_UP = 0x26;
    public const byte VK_DOWN = 0x28;
    public const byte VK_LEFT = 0x25;
    public const byte VK_RIGHT = 0x27;
    public const byte VK_BACK = 0x08;
}
'@

# Find terminal window if no hwnd provided
if ($Hwnd -eq 0) {
    $proc = Get-Process WindowsTerminal -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match 'claude' } |
        Select-Object -First 1
    if ($proc) { $Hwnd = $proc.MainWindowHandle.ToInt64() }
}

if ($Hwnd -eq 0) { Write-Output "FAIL|no window"; exit }

$hwndPtr = [IntPtr]$Hwnd

# Parse SendKeys-like syntax and send via PostMessage (no focus needed)
$i = 0
while ($i -lt $Keys.Length) {
    $c = $Keys[$i]

    if ($c -eq '{') {
        # Special key: {ENTER}, {TAB}, {ESC}, {UP}, {DOWN}, {BACK}
        $end = $Keys.IndexOf('}', $i)
        if ($end -gt $i) {
            $keyName = $Keys.Substring($i + 1, $end - $i - 1).ToUpper()
            switch ($keyName) {
                'ENTER'  { [KeySender]::SendVKey($hwndPtr, [KeySender]::VK_RETURN) }
                'TAB'    { [KeySender]::SendVKey($hwndPtr, [KeySender]::VK_TAB) }
                'ESC'    { [KeySender]::SendVKey($hwndPtr, [KeySender]::VK_ESCAPE) }
                'UP'     { [KeySender]::SendVKey($hwndPtr, [KeySender]::VK_UP) }
                'DOWN'   { [KeySender]::SendVKey($hwndPtr, [KeySender]::VK_DOWN) }
                'LEFT'   { [KeySender]::SendVKey($hwndPtr, [KeySender]::VK_LEFT) }
                'RIGHT'  { [KeySender]::SendVKey($hwndPtr, [KeySender]::VK_RIGHT) }
                'BACK'   { [KeySender]::SendVKey($hwndPtr, [KeySender]::VK_BACK) }
            }
            $i = $end + 1
            continue
        }
    }
    elseif ($c -eq '^') {
        # Ctrl+key: ^c = Ctrl+C (send as character 0x03)
        if ($i + 1 -lt $Keys.Length) {
            $nextChar = $Keys[$i + 1]
            $ctrlChar = [char]([int]$nextChar - 96)  # 'c' -> 0x03
            [KeySender]::SendText($hwndPtr, [string]$ctrlChar)
            $i += 2
            continue
        }
    }

    # Regular character
    [KeySender]::SendText($hwndPtr, [string]$c)
    $i++
}

Write-Output "OK"
