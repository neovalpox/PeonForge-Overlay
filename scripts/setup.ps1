# PeonForge — Setup script
# Installs all prerequisites for PeonForge to work (Node modules, cloudflared, ffplay)

param([switch]$SkipNpm)

Write-Host "`n=== PeonForge Setup ===" -ForegroundColor Cyan

# 1. Node modules
if (-not $SkipNpm) {
    Write-Host "`n[1/3] Installing Node dependencies..." -ForegroundColor Yellow
    npm install
} else {
    Write-Host "`n[1/3] Skipping npm install" -ForegroundColor DarkGray
}

# 2. cloudflared (required for remote mobile access over internet)
Write-Host "`n[2/3] Checking cloudflared..." -ForegroundColor Yellow
$cf = Get-Command cloudflared -ErrorAction SilentlyContinue
if ($cf) {
    $ver = & cloudflared --version 2>&1
    Write-Host "  OK: $ver" -ForegroundColor Green
} else {
    Write-Host "  Not found. Installing via winget..." -ForegroundColor Yellow
    try {
        winget install Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements
        Write-Host "  Installed! You may need to restart your terminal." -ForegroundColor Green
    } catch {
        Write-Host "  FAILED: Install manually — winget install Cloudflare.cloudflared" -ForegroundColor Red
    }
}

# 3. ffplay (optional, for volume-controlled sound playback)
Write-Host "`n[3/3] Checking ffplay..." -ForegroundColor Yellow
$ff = Get-Command ffplay -ErrorAction SilentlyContinue
if ($ff) {
    Write-Host "  OK: ffplay found" -ForegroundColor Green
} else {
    Write-Host "  Not found. Installing ffmpeg via winget..." -ForegroundColor Yellow
    try {
        winget install Gyan.FFmpeg --accept-package-agreements --accept-source-agreements
        Write-Host "  Installed! You may need to restart your terminal." -ForegroundColor Green
    } catch {
        Write-Host "  FAILED: Install manually — winget install Gyan.FFmpeg" -ForegroundColor Red
        Write-Host "  (Sound will still work but without volume control)" -ForegroundColor DarkGray
    }
}

Write-Host "`n=== Setup complete! Run 'npm start' to launch PeonForge ===" -ForegroundColor Cyan
Write-Host ""
