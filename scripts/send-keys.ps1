param(
    [string]$Keys = "",
    [long]$Hwnd = 0
)

# Strategy: copy text to clipboard, then simulate Ctrl+V on the target window
# This works reliably on Windows Terminal (ConPTY) without needing focus

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

public class TermInput {
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    const uint WM_KEYDOWN = 0x0100;
    const uint WM_KEYUP = 0x0101;

    // VK codes
    const byte VK_RETURN = 0x0D;
    const byte VK_ESCAPE = 0x1B;
    const byte VK_TAB = 0x09;
    const byte VK_UP = 0x26;
    const byte VK_DOWN = 0x28;
    const byte VK_CONTROL = 0x11;
    const byte VK_V = 0x56;
    const byte VK_C = 0x43;
    const byte VK_SHIFT = 0x10;

    public static void SendVKey(IntPtr hwnd, byte vk) {
        PostMessage(hwnd, WM_KEYDOWN, (IntPtr)vk, IntPtr.Zero);
        Thread.Sleep(30);
        PostMessage(hwnd, WM_KEYUP, (IntPtr)vk, IntPtr.Zero);
        Thread.Sleep(20);
    }

    public static void SendCtrlV(IntPtr hwnd) {
        // Ctrl down, V down, V up, Ctrl up
        PostMessage(hwnd, WM_KEYDOWN, (IntPtr)VK_CONTROL, IntPtr.Zero);
        Thread.Sleep(20);
        PostMessage(hwnd, WM_KEYDOWN, (IntPtr)VK_V, IntPtr.Zero);
        Thread.Sleep(20);
        PostMessage(hwnd, WM_KEYUP, (IntPtr)VK_V, IntPtr.Zero);
        Thread.Sleep(20);
        PostMessage(hwnd, WM_KEYUP, (IntPtr)VK_CONTROL, IntPtr.Zero);
        Thread.Sleep(30);
    }

    public static void SendCtrlC(IntPtr hwnd) {
        PostMessage(hwnd, WM_KEYDOWN, (IntPtr)VK_CONTROL, IntPtr.Zero);
        Thread.Sleep(20);
        PostMessage(hwnd, WM_KEYDOWN, (IntPtr)VK_C, IntPtr.Zero);
        Thread.Sleep(20);
        PostMessage(hwnd, WM_KEYUP, (IntPtr)VK_C, IntPtr.Zero);
        Thread.Sleep(20);
        PostMessage(hwnd, WM_KEYUP, (IntPtr)VK_CONTROL, IntPtr.Zero);
        Thread.Sleep(30);
    }

    public static void SendCtrlShiftTab(IntPtr hwnd, bool shift) {
        PostMessage(hwnd, WM_KEYDOWN, (IntPtr)VK_CONTROL, IntPtr.Zero);
        if (shift) PostMessage(hwnd, WM_KEYDOWN, (IntPtr)VK_SHIFT, IntPtr.Zero);
        Thread.Sleep(20);
        PostMessage(hwnd, WM_KEYDOWN, (IntPtr)VK_TAB, IntPtr.Zero);
        Thread.Sleep(20);
        PostMessage(hwnd, WM_KEYUP, (IntPtr)VK_TAB, IntPtr.Zero);
        if (shift) PostMessage(hwnd, WM_KEYUP, (IntPtr)VK_SHIFT, IntPtr.Zero);
        PostMessage(hwnd, WM_KEYUP, (IntPtr)VK_CONTROL, IntPtr.Zero);
        Thread.Sleep(30);
    }

    public static void PasteText(IntPtr hwnd, string text) {
        // Set clipboard and paste
        Clipboard.SetText(text);
        Thread.Sleep(50);
        SendCtrlV(hwnd);
    }
}
'@ -ReferencedAssemblies System.Windows.Forms

# Find terminal window if no hwnd provided
if ($Hwnd -eq 0) {
    $proc = Get-Process WindowsTerminal -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } |
        Select-Object -First 1
    if ($proc) { $Hwnd = $proc.MainWindowHandle.ToInt64() }
}

if ($Hwnd -eq 0) { Write-Output "FAIL|no window"; exit }

$hwndPtr = [IntPtr]$Hwnd

# Parse the keys string
$textBuffer = ""

$i = 0
while ($i -lt $Keys.Length) {
    $c = $Keys[$i]

    if ($c -eq '{') {
        # Flush text buffer first
        if ($textBuffer.Length -gt 0) {
            [TermInput]::PasteText($hwndPtr, $textBuffer)
            $textBuffer = ""
            Start-Sleep -Milliseconds 50
        }

        $end = $Keys.IndexOf('}', $i)
        if ($end -gt $i) {
            $keyName = $Keys.Substring($i + 1, $end - $i - 1).ToUpper()
            switch ($keyName) {
                'ENTER'  { [TermInput]::SendVKey($hwndPtr, 0x0D) }
                'TAB'    { [TermInput]::SendVKey($hwndPtr, 0x09) }
                'ESC'    { [TermInput]::SendVKey($hwndPtr, 0x1B) }
                'UP'     { [TermInput]::SendVKey($hwndPtr, 0x26) }
                'DOWN'   { [TermInput]::SendVKey($hwndPtr, 0x28) }
                'LEFT'   { [TermInput]::SendVKey($hwndPtr, 0x25) }
                'RIGHT'  { [TermInput]::SendVKey($hwndPtr, 0x27) }
                'BACK'   { [TermInput]::SendVKey($hwndPtr, 0x08) }
            }
            $i = $end + 1
            continue
        }
    }
    elseif ($c -eq '^') {
        # Flush text buffer
        if ($textBuffer.Length -gt 0) {
            [TermInput]::PasteText($hwndPtr, $textBuffer)
            $textBuffer = ""
            Start-Sleep -Milliseconds 50
        }

        if ($i + 1 -lt $Keys.Length) {
            $nextChar = $Keys[$i + 1]
            switch ($nextChar) {
                'c' { [TermInput]::SendCtrlC($hwndPtr) }
                'v' { [TermInput]::SendCtrlV($hwndPtr) }
                default {
                    # Generic Ctrl+key via PostMessage
                    $vk = [byte][char]$nextChar.ToString().ToUpper()
                    [TermInput]::SendVKey($hwndPtr, 0x11) # Ctrl
                    [TermInput]::SendVKey($hwndPtr, $vk)
                }
            }
            $i += 2
            continue
        }
    }
    elseif ($c -eq '+' -and $i + 1 -lt $Keys.Length -and $Keys[$i + 1] -eq '{') {
        # Shift+{key} - skip the +
        $i++
        continue
    }
    else {
        # Regular character - buffer it
        $textBuffer += $c
    }

    $i++
}

# Flush remaining text
if ($textBuffer.Length -gt 0) {
    [TermInput]::PasteText($hwndPtr, $textBuffer)
}

Write-Output "OK"
