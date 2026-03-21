param(
    [Parameter(Mandatory=$true)]
    [string]$path,
    [Parameter(Mandatory=$true)]
    [double]$vol
)

# Kill any previous peon sound still playing (prevents overlap/loop)
Get-Process ffplay -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process mpv -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq '' } | Stop-Process -Force -ErrorAction SilentlyContinue

# Priority: ffplay (supports volume for all formats) -> mpv -> vlc -> SoundPlayer (WAV only, no volume)

# ffplay: volume 0-100 integer scale
$ffplay = Get-Command ffplay -ErrorAction SilentlyContinue
if ($ffplay) {
    $ffVol = [math]::Max(0, [math]::Min(100, [int]($vol * 100)))
    & $ffplay.Source -nodisp -autoexit -volume $ffVol -loglevel quiet $path 2>$null
    exit 0
}

# mpv: volume 0-100 integer scale
$mpv = Get-Command mpv -ErrorAction SilentlyContinue
if ($mpv) {
    $mpvVol = [math]::Max(0, [math]::Min(100, [int]($vol * 100)))
    & $mpv.Source --no-video --volume=$mpvVol $path 2>$null
    exit 0
}

# vlc: volume 0.0-2.0 gain multiplier (1.0 = 100%)
$vlc = Get-Command vlc -ErrorAction SilentlyContinue
if (-not $vlc) {
    $vlcPaths = @(
        "$env:ProgramFiles\VideoLAN\VLC\vlc.exe",
        "${env:ProgramFiles(x86)}\VideoLAN\VLC\vlc.exe"
    )
    foreach ($p in $vlcPaths) {
        if (Test-Path $p) {
            $vlc = Get-Item $p
            break
        }
    }
}
if ($vlc) {
    $vlcGain = [math]::Round($vol * 2.0, 2).ToString([System.Globalization.CultureInfo]::InvariantCulture)
    $vlcPath = if ($vlc -is [System.Management.Automation.ApplicationInfo]) { $vlc.Source } else { $vlc.FullName }
    & $vlcPath --intf dummy --play-and-exit --gain $vlcGain $path 2>$null
    exit 0
}

# Fallback: SoundPlayer (WAV only, no volume control)
if ($path -match "\.wav$") {
    try {
        $sp = New-Object System.Media.SoundPlayer $path
        $sp.PlaySync()
        $sp.Dispose()
    } catch {}
    exit 0
}
