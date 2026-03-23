#Requires -Version 5.1
# PeonForge — One-click installer
# Run: & ([scriptblock]::Create((irm https://peonforge.ch/install.ps1)))
# Or:  powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = "SilentlyContinue"

# ─── ASCII Art Banner ───
function Show-Banner {
    $gold = "DarkYellow"
    $dim = "DarkGray"
    Write-Host ""
    Write-Host "  ______                 ______                    " -ForegroundColor $gold
    Write-Host " |   __ \.-----.-----.--|   __ \.-----.----.-----." -ForegroundColor $gold
    Write-Host " |    __/|  -__|  _  |  |    __/|  _  |   _|  _  |" -ForegroundColor $gold
    Write-Host " |___|   |_____|_____|__|___|   |_____|__| |___  |" -ForegroundColor $gold
    Write-Host "                                           |_____|" -ForegroundColor $gold
    Write-Host ""
    Write-Host "  Ton compagnon Warcraft pour Claude Code" -ForegroundColor $dim
    Write-Host "  Work, work." -ForegroundColor $dim
    Write-Host ""
    Write-Host "  ========================================" -ForegroundColor DarkCyan
    Write-Host ""
}

function Write-Step($num, $total, $text) {
    Write-Host "  [$num/$total] " -ForegroundColor Cyan -NoNewline
    Write-Host $text -ForegroundColor White
}

function Write-OK($text) {
    Write-Host "        OK " -ForegroundColor Green -NoNewline
    Write-Host $text -ForegroundColor Gray
}

function Write-Warn($text) {
    Write-Host "        !! " -ForegroundColor Yellow -NoNewline
    Write-Host $text -ForegroundColor Gray
}

function Write-Fail($text) {
    Write-Host "        XX " -ForegroundColor Red -NoNewline
    Write-Host $text -ForegroundColor Gray
}

Show-Banner

$totalSteps = 9
$installDir = Join-Path $env:USERPROFILE "PeonForge"

# ─── Step 1: Check Git ───
Write-Step 1 $totalSteps "Verification de Git..."
$git = Get-Command git -ErrorAction SilentlyContinue
if ($git) {
    Write-OK "Git $(& git --version 2>&1)"
} else {
    Write-Warn "Git non trouve. Installation via winget..."
    winget install Git.Git --accept-package-agreements --accept-source-agreements 2>$null
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    $git = Get-Command git -ErrorAction SilentlyContinue
    if ($git) { Write-OK "Git installe" } else { Write-Fail "Installe Git manuellement: https://git-scm.com"; exit 1 }
}

# ─── Step 2: Check Node.js ───
Write-Step 2 $totalSteps "Verification de Node.js..."
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    $nodeVer = & node --version 2>&1
    Write-OK "Node.js $nodeVer"
} else {
    Write-Warn "Node.js non trouve. Installation via winget..."
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements 2>$null
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) { Write-OK "Node.js installe" } else { Write-Fail "Installe Node.js manuellement: https://nodejs.org"; exit 1 }
}

# ─── Step 3: Clone or update repo ───
Write-Step 3 $totalSteps "Telechargement de PeonForge..."
if (Test-Path (Join-Path $installDir ".git")) {
    Push-Location $installDir
    & git pull --quiet 2>$null
    Pop-Location
    Write-OK "Mis a jour dans $installDir"
} else {
    if (Test-Path $installDir) { Remove-Item $installDir -Recurse -Force 2>$null }
    & git clone --quiet https://github.com/neovalpox/PeonForge-Overlay.git $installDir 2>$null
    if (Test-Path (Join-Path $installDir "package.json")) {
        Write-OK "Clone dans $installDir"
    } else {
        Write-Fail "Echec du clonage. Verifie ta connexion internet."
        exit 1
    }
}

# ─── Step 4: npm install ───
Write-Step 4 $totalSteps "Installation des dependances Node..."
Push-Location $installDir
& npm.cmd install --silent 2>$null
Pop-Location
Write-OK "node_modules installe"

# ─── Step 5: cloudflared ───
Write-Step 5 $totalSteps "Verification de cloudflared (acces mobile distant)..."
$cf = Get-Command cloudflared -ErrorAction SilentlyContinue
if ($cf) {
    Write-OK "cloudflared deja installe"
} else {
    Write-Warn "Installation de cloudflared..."
    winget install Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements 2>$null
    $cf = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cf) { Write-OK "cloudflared installe" } else { Write-Warn "Optionnel: installe manuellement pour l'acces distant" }
}

# ─── Step 6: ffplay ───
Write-Step 6 $totalSteps "Verification de ffplay (controle du volume)..."
$ff = Get-Command ffplay -ErrorAction SilentlyContinue
if ($ff) {
    Write-OK "ffplay deja installe"
} else {
    Write-Warn "Installation de ffmpeg..."
    winget install Gyan.FFmpeg --accept-package-agreements --accept-source-agreements 2>$null
    $ff = Get-Command ffplay -ErrorAction SilentlyContinue
    if ($ff) { Write-OK "ffplay installe" } else { Write-Warn "Optionnel: les sons marcheront sans controle de volume" }
}

# ─── Step 7: Install Claude Code hooks ───
Write-Step 7 $totalSteps "Installation des hooks Claude Code..."
$hookScript = Join-Path $installDir "scripts\install-hooks.ps1"
if (Test-Path $hookScript) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $hookScript 2>$null
    Write-OK "Hooks installes"
} else {
    Write-Warn "Script de hooks non trouve, skippe"
}

# ─── Step 8: Choose faction + username ───
Write-Step 8 $totalSteps "Configuration du profil..."
Write-Host ""

# Faction choice
Write-Host "        Choisis ton camp :" -ForegroundColor White
Write-Host ""
Write-Host "          [1] " -ForegroundColor Cyan -NoNewline
Write-Host "Alliance" -ForegroundColor Cyan -NoNewline
Write-Host " (Paysan)" -ForegroundColor DarkGray
Write-Host "          [2] " -ForegroundColor Red -NoNewline
Write-Host "Horde" -ForegroundColor Red -NoNewline
Write-Host "    (Peon)" -ForegroundColor DarkGray
Write-Host ""
$factionChoice = ""
while ($factionChoice -ne "1" -and $factionChoice -ne "2") {
    Write-Host "        Ton choix (1 ou 2): " -ForegroundColor White -NoNewline
    $factionChoice = [Console]::ReadLine()
}
$side = if ($factionChoice -eq "1") { "alliance" } else { "horde" }
$faction = if ($side -eq "alliance") { "human" } else { "orc" }
$avatar = if ($side -eq "alliance") { "peasant_fr" } else { "peon_fr" }
$sideLabel = if ($side -eq "alliance") { "Alliance" } else { "Horde" }
$avatarLabel = if ($side -eq "alliance") { "Paysan" } else { "Peon" }
Write-OK "$sideLabel — $avatarLabel"
Write-Host ""

# Username
$username = ""
while ($true) {
    Write-Host "        Choisis ton pseudo (2-20 caracteres): " -ForegroundColor White -NoNewline
    $username = [Console]::ReadLine()
    if ($username.Length -lt 2 -or $username.Length -gt 20) {
        Write-Warn "Le pseudo doit faire entre 2 et 20 caracteres"
        continue
    }
    # Check if username is available on peonforge.ch
    try {
        $checkUrl = "https://peonforge.ch/api/player/$([uri]::EscapeDataString($username))"
        $response = Invoke-RestMethod -Uri $checkUrl -Method Get -ErrorAction Stop -TimeoutSec 5
        if ($response.username) {
            Write-Warn "Le pseudo '$username' est deja pris ! Choisis-en un autre."
            continue
        }
    } catch {
        # 404 = not found = available, or network error = proceed
        $statusCode = $_.Exception.Response.StatusCode.value__
        if ($statusCode -and $statusCode -ne 404) {
            Write-Warn "Impossible de verifier le pseudo (erreur reseau). On continue."
        }
    }
    break
}
Write-OK "Pseudo: $username"

# Save config
$configDir = Join-Path $env:USERPROFILE ".peonping-overlay"
if (-not (Test-Path $configDir)) { New-Item -ItemType Directory -Path $configDir -Force | Out-Null }
$configFile = Join-Path $configDir "config.json"
$configData = @{
    faction = $faction
    side = $side
    volume = 0.5
    soundEnabled = $true
    watching = $true
    showCompanion = $true
    showNotifications = $true
    companionMini = $false
} | ConvertTo-Json
Set-Content $configFile -Value $configData -Encoding UTF8
Write-OK "Configuration sauvee"

# Register on peonforge.ch
try {
    $regBody = @{ username = $username; faction = $faction } | ConvertTo-Json
    $regResponse = Invoke-RestMethod -Uri "https://peonforge.ch/api/register" -Method Post -Body $regBody -ContentType "application/json" -TimeoutSec 5 -ErrorAction Stop
    if ($regResponse.token) {
        $forgeFile = Join-Path $configDir "forge.json"
        $forgeData = @{
            token = $regResponse.token
            url = "https://peonforge.ch"
            username = $username
            avatar = $avatar
        } | ConvertTo-Json
        Set-Content $forgeFile -Value $forgeData -Encoding UTF8
        Write-OK "Inscrit sur peonforge.ch comme '$username'"
    }
} catch {
    Write-Warn "Inscription sur peonforge.ch echouee (pas grave, sera fait au prochain lancement)"
}

Write-Host ""

# ─── Step 9: Create startup shortcut ───
Write-Step 9 $totalSteps "Creation du raccourci de demarrage..."
$startupDir = [System.IO.Path]::Combine($env:APPDATA, "Microsoft\Windows\Start Menu\Programs\Startup")
$shortcutPath = Join-Path $startupDir "PeonForge.lnk"
$electronExe = Join-Path $installDir "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $electronExe)) {
    $electronExe = Join-Path $installDir "node_modules\.bin\electron.cmd"
}

try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $electronExe
    $shortcut.Arguments = "`"$installDir`""
    $shortcut.WorkingDirectory = $installDir
    $shortcut.WindowStyle = 7 # minimized
    $shortcut.Description = "PeonForge — Ton compagnon Warcraft pour Claude Code"
    $iconPath = Join-Path $installDir "app-icon.ico"
    if (Test-Path $iconPath) { $shortcut.IconLocation = $iconPath }
    $shortcut.Save()
    Write-OK "Raccourci cree dans le demarrage automatique"
} catch {
    Write-Warn "Impossible de creer le raccourci de demarrage"
}

# ─── Done! ───
Write-Host ""
Write-Host "  ========================================" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  Installation terminee !" -ForegroundColor Green
Write-Host ""
Write-Host "  PeonForge est installe dans:" -ForegroundColor Gray
Write-Host "    $installDir" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Il se lancera automatiquement au demarrage de Windows." -ForegroundColor Gray
Write-Host "  IMPORTANT: Lance Claude Code depuis PowerShell !" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Lancement de PeonForge..." -ForegroundColor Cyan
Write-Host ""

# Launch PeonForge
Push-Location $installDir
# Launch Electron directly
$electronPath = Join-Path $installDir "node_modules\electron\dist\electron.exe"
if (Test-Path $electronPath) {
    Start-Process -FilePath $electronPath -ArgumentList "`"$installDir`"" -WindowStyle Hidden
} else {
    # Fallback: npm.cmd start
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c cd /d `"$installDir`" && npm.cmd start" -WindowStyle Hidden
}
Pop-Location

Write-Host "  PeonForge est lance ! Cherche l'icone dans le system tray." -ForegroundColor Green
Write-Host "  Visite https://peonforge.ch pour plus d'infos." -ForegroundColor DarkGray
Write-Host ""
