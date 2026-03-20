param(
    [string]$Keys = "",
    [long]$Hwnd = 0
)

Add-Type -AssemblyName System.Windows.Forms

# Find terminal
if ($Hwnd -eq 0) {
    $proc = Get-Process WindowsTerminal -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } |
        Select-Object -First 1
    if ($proc) { $Hwnd = $proc.MainWindowHandle.ToInt64() }
}
if ($Hwnd -eq 0) { Write-Output "FAIL"; exit }

# Parse special keys and build text + actions
$actions = @()
$textBuffer = ""
$i = 0
while ($i -lt $Keys.Length) {
    $c = $Keys[$i]
    if ($c -eq '{') {
        if ($textBuffer) { $actions += @{type='text';value=$textBuffer}; $textBuffer = "" }
        $end = $Keys.IndexOf('}', $i)
        if ($end -gt $i) {
            $keyName = $Keys.Substring($i + 1, $end - $i - 1).ToUpper()
            $actions += @{type='key';value=$keyName}
            $i = $end + 1; continue
        }
    } elseif ($c -eq '^') {
        if ($textBuffer) { $actions += @{type='text';value=$textBuffer}; $textBuffer = "" }
        if ($i + 1 -lt $Keys.Length) {
            $actions += @{type='ctrl';value=$Keys[$i+1]}
            $i += 2; continue
        }
    } else {
        $textBuffer += $c
    }
    $i++
}
if ($textBuffer) { $actions += @{type='text';value=$textBuffer} }

# Focus the window using AppActivate, then use SendKeys
$wsh = New-Object -ComObject WScript.Shell

# Try to find and activate by window title
$proc = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -eq [IntPtr]$Hwnd }
if ($proc) {
    $activated = $wsh.AppActivate($proc.Id)
} else {
    $activated = $false
}

# Small delay for focus
Start-Sleep -Milliseconds 150

# Execute actions using SendKeys (requires focus but AppActivate from WScript gives it)
foreach ($action in $actions) {
    switch ($action.type) {
        'text' {
            # Use clipboard paste for reliability
            [System.Windows.Forms.Clipboard]::SetText($action.value)
            Start-Sleep -Milliseconds 50
            $wsh.SendKeys('^v')
            Start-Sleep -Milliseconds 50
        }
        'key' {
            switch ($action.value) {
                'ENTER'  { $wsh.SendKeys('{ENTER}') }
                'TAB'    { $wsh.SendKeys('{TAB}') }
                'ESC'    { $wsh.SendKeys('{ESC}') }
                'UP'     { $wsh.SendKeys('{UP}') }
                'DOWN'   { $wsh.SendKeys('{DOWN}') }
                'LEFT'   { $wsh.SendKeys('{LEFT}') }
                'RIGHT'  { $wsh.SendKeys('{RIGHT}') }
                'BACK'   { $wsh.SendKeys('{BACKSPACE}') }
            }
            Start-Sleep -Milliseconds 30
        }
        'ctrl' {
            $wsh.SendKeys('^' + $action.value)
            Start-Sleep -Milliseconds 30
        }
    }
}

Write-Output "OK|activated=$activated"
