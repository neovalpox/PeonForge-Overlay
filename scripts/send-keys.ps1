param(
    [string]$Keys = "",
    [int]$TargetPid = 0
)

# Find the terminal
$proc = $null
if ($TargetPid -gt 0) {
    $proc = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
}
if (-not $proc -or $proc.MainWindowHandle -eq 0) {
    $proc = Get-Process WindowsTerminal -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match 'claude' } |
        Select-Object -First 1
}
if (-not $proc) { exit }

# Use WScript.Shell SendKeys to send keystrokes to the window
$wsh = New-Object -ComObject WScript.Shell
$wsh.AppActivate($proc.MainWindowTitle) | Out-Null
Start-Sleep -Milliseconds 100
$wsh.SendKeys($Keys)
Write-Output "OK"
