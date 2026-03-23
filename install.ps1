#Requires -Version 5.1
<# PeonForge Installer — https://peonforge.ch
   Usage: iwr peonforge.ch/install.ps1 -Out i.ps1; .\i.ps1
#>
$ErrorActionPreference = "SilentlyContinue"
$g = "DarkYellow"; $d = "DarkGray"; $c = "Cyan"; $w = "White"; $r = "Red"; $gr = "Green"

function B { # Banner
    cls
    Write-Host ""
    Write-Host "    ╔══════════════════════════════════════════════════╗" -Fo $g
    Write-Host "    ║" -Fo $g -No; Write-Host "                                                  " -No; Write-Host "║" -Fo $g
    Write-Host "    ║" -Fo $g -No; Write-Host "   ____                    _____                  " -Fo $c -No; Write-Host "║" -Fo $g
    Write-Host "    ║" -Fo $g -No; Write-Host "  |  _ \ ___  ___  _ __   |  ___|__  _ __ __ _  __" -Fo $c -No; Write-Host "║" -Fo $g
    Write-Host "    ║" -Fo $g -No; Write-Host "  | |_) / _ \/ _ \| '_ \  | |_ / _ \| '__/ _  |/ _\" -Fo $c -No; Write-Host "║" -Fo $g
    Write-Host "    ║" -Fo $g -No; Write-Host "  |  __/  __/ (_) | | | | |  _| (_) | | | (_| |  _/" -Fo $c -No; Write-Host "║" -Fo $g
    Write-Host "    ║" -Fo $g -No; Write-Host "  |_|   \___|\___/|_| |_| |_|  \___/|_|  \__, |\___|" -Fo $c -No; Write-Host "" -Fo $g
    Write-Host "    ║" -Fo $g -No; Write-Host "                                          |___/    " -Fo $c -No; Write-Host "║" -Fo $g
    Write-Host "    ║" -Fo $g -No; Write-Host "                                                  " -No; Write-Host "║" -Fo $g
    Write-Host "    ║" -Fo $g -No; Write-Host "       Ton compagnon Warcraft pour Claude Code     " -Fo $d -No; Write-Host "║" -Fo $g
    Write-Host "    ║" -Fo $g -No; Write-Host "       100% gratuit  ·  100% inutile  ·  Work work" -Fo $d -No; Write-Host "║" -Fo $g
    Write-Host "    ║" -Fo $g -No; Write-Host "                                                  " -No; Write-Host "║" -Fo $g
    Write-Host "    ╚══════════════════════════════════════════════════╝" -Fo $g
    Write-Host ""
}

function S($n,$t,$txt) { Write-Host "    ⚒ " -Fo $g -No; Write-Host "[$n/$t] " -Fo $c -No; Write-Host $txt -Fo $w }
function OK($t) { Write-Host "       ✓ " -Fo $gr -No; Write-Host $t -Fo Gray }
function WR($t) { Write-Host "       ⚠ " -Fo Yellow -No; Write-Host $t -Fo Gray }
function FL($t) { Write-Host "       ✗ " -Fo $r -No; Write-Host $t -Fo Gray }
function LN { Write-Host "    ──────────────────────────────────────────────" -Fo $d }
function ASK($prompt) { Write-Host "       $prompt" -Fo $w -No; return [Console]::ReadLine() }

B
$T = 9; $dir = Join-Path $env:USERPROFILE "PeonForge"

# ═══ 1. Git ═══
S 1 $T "Verification de Git..."
$x = Get-Command git -EA 0
if ($x) { OK "Git $(& git --version 2>&1)" }
else { WR "Installation de Git..."; winget install Git.Git --accept-package-agreements --accept-source-agreements 2>$null
    $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
    if (Get-Command git -EA 0) { OK "Git installe" } else { FL "https://git-scm.com"; exit 1 }
}

# ═══ 2. Node ═══
S 2 $T "Verification de Node.js..."
$x = Get-Command node -EA 0
if ($x) { OK "Node.js $(& node --version 2>&1)" }
else { WR "Installation de Node.js..."; winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements 2>$null
    $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
    if (Get-Command node -EA 0) { OK "Node.js installe" } else { FL "https://nodejs.org"; exit 1 }
}

# ═══ 3. Clone ═══
S 3 $T "Telechargement de PeonForge..."
if (Test-Path "$dir\.git") { Push-Location $dir; & git pull -q 2>$null; Pop-Location; OK "Mis a jour" }
else { if (Test-Path $dir) { Remove-Item $dir -Recurse -Force 2>$null }
    & git clone -q https://github.com/neovalpox/PeonForge-Overlay.git $dir 2>$null
    if (Test-Path "$dir\package.json") { OK "Telecharge dans $dir" } else { FL "Echec du clonage"; exit 1 }
}

# ═══ 4. npm install ═══
S 4 $T "Installation des dependances..."
Push-Location $dir; & npm.cmd install --silent 2>$null; Pop-Location; OK "Pret"

# ═══ 5. cloudflared ═══
S 5 $T "Cloudflared (acces mobile distant)..."
if (Get-Command cloudflared -EA 0) { OK "Deja installe" }
else { WR "Installation..."; winget install Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements 2>$null
    if (Get-Command cloudflared -EA 0) { OK "Installe" } else { WR "Optionnel — installe manuellement" }
}

# ═══ 6. ffplay ═══
S 6 $T "FFplay (controle du volume)..."
if (Get-Command ffplay -EA 0) { OK "Deja installe" }
else { WR "Installation..."; winget install Gyan.FFmpeg --accept-package-agreements --accept-source-agreements 2>$null
    if (Get-Command ffplay -EA 0) { OK "Installe" } else { WR "Optionnel — sons sans volume" }
}

# ═══ 7. Hooks ═══
S 7 $T "Hooks Claude Code..."
$hs = Join-Path $dir "scripts\install-hooks.ps1"
if (Test-Path $hs) { & powershell -NoProfile -ExecutionPolicy Bypass -File $hs 2>$null; OK "Hooks actifs" }
else { WR "Hooks non trouves" }

# ═══ 8. Profil ═══
LN
S 8 $T "Configuration de ton profil"
Write-Host ""

# Faction
Write-Host "       Choisis ton camp :" -Fo $w
Write-Host ""
Write-Host "         " -No; Write-Host "[1]" -Fo $c -No; Write-Host " ⚔ Alliance " -Fo $c -No; Write-Host "(Paysan)" -Fo $d
Write-Host "         " -No; Write-Host "[2]" -Fo $r -No; Write-Host " ☠ Horde    " -Fo $r -No; Write-Host "(Peon)" -Fo $d
Write-Host ""
$fc = ""; while ($fc -ne "1" -and $fc -ne "2") { $fc = ASK "Ton choix (1/2): " }
$side = if ($fc -eq "1") {"alliance"} else {"horde"}
$faction = if ($side -eq "alliance") {"human"} else {"orc"}
$avatar = if ($side -eq "alliance") {"peasant_fr"} else {"peon_fr"}
$sl = if ($side -eq "alliance") {"Alliance"} else {"Horde"}
OK "$sl selectionne"
Write-Host ""

# Username
$un = ""; $et = $null
while ($true) {
    $un = ASK "Pseudo (2-20 car.): "
    if ($un.Length -lt 2 -or $un.Length -gt 20) { WR "Entre 2 et 20 caracteres"; continue }
    try {
        $resp = Invoke-RestMethod "https://peonforge.ch/api/player/$([uri]::EscapeDataString($un))" -EA Stop -TimeoutSec 5
        if ($resp.username) {
            $hp = $true; try { $hp = (Invoke-RestMethod "https://peonforge.ch/api/player/$([uri]::EscapeDataString($un))/has-password" -EA Stop -TimeoutSec 5).has_password -eq $true } catch {}
            Write-Host ""; WR "Le pseudo '$un' existe deja !"
            if ($hp) {
                Write-Host "         [1] C'est moi — connexion" -Fo $c; Write-Host "         [2] Autre pseudo" -Fo $d; Write-Host ""
                $ch = ASK "Choix (1/2): "
                if ($ch -eq "1") {
                    $pw = ASK "Mot de passe: "
                    try { $lr = Invoke-RestMethod "https://peonforge.ch/api/login" -Method Post -Body (@{username=$un;password=$pw}|ConvertTo-Json) -ContentType "application/json" -EA Stop -TimeoutSec 5
                        if ($lr.token) { $et = $lr.token; OK "Bienvenue $un !"; break }
                    } catch { FL "Mot de passe incorrect"; continue }
                } else { continue }
            } else {
                Write-Host "         Ce compte n'a pas de mot de passe." -Fo $d
                Write-Host "         [1] C'est moi — definir un mdp" -Fo $c; Write-Host "         [2] Autre pseudo" -Fo $d; Write-Host ""
                $ch = ASK "Choix (1/2): "
                if ($ch -eq "1") {
                    $ef = Join-Path (Join-Path $env:USERPROFILE ".peonping-overlay") "forge.json"
                    if (Test-Path $ef) { try { $fd = Get-Content $ef -Raw | ConvertFrom-Json; if ($fd.username -eq $un -and $fd.token) { $et = $fd.token; $needsPassword = $true; OK "Compte recupere"; break } } catch {} }
                    WR "Definis ton mot de passe apres installation"; break
                } else { continue }
            }
        }
    } catch { $sc = $_.Exception.Response.StatusCode.value__; if ($sc -and $sc -ne 404) { WR "Erreur reseau" } }
    break
}
OK "Pseudo: $un"

# Password
$pw = ""
$needsPassword = if ($needsPassword) {$true} else {$false}
if (-not $et -or $needsPassword) {
    Write-Host ""; $pw = ASK "Mot de passe (min 4 car.): "
    while ($pw.Length -lt 4) { WR "Minimum 4 caracteres"; $pw = ASK "Mot de passe: " }
    OK "Mot de passe OK"
}

# Save config
$cd = Join-Path $env:USERPROFILE ".peonping-overlay"
if (-not (Test-Path $cd)) { New-Item -ItemType Directory -Path $cd -Force | Out-Null }
@{faction=$faction;side=$side;volume=0.5;soundEnabled=$true;watching=$true;showCompanion=$true;showNotifications=$true;companionMini=$false} | ConvertTo-Json | Set-Content (Join-Path $cd "config.json") -Encoding UTF8

# Register / recover
$ff = Join-Path $cd "forge.json"
if ($et) {
    @{token=$et;url="https://peonforge.ch";username=$un;avatar=$avatar} | ConvertTo-Json | Set-Content $ff -Encoding UTF8
    OK "Compte restaure"
    if ($pw.Length -ge 4) { try { Invoke-RestMethod "https://peonforge.ch/api/set-password" -Method Post -Body (@{password=$pw}|ConvertTo-Json) -ContentType "application/json" -Headers @{Authorization="Bearer $et"} -EA Stop -TimeoutSec 5 | Out-Null; OK "Mot de passe defini" } catch { WR "Erreur mdp" } }
} else {
    try { $rr = Invoke-RestMethod "https://peonforge.ch/api/register" -Method Post -Body (@{username=$un;faction=$faction;password=$pw}|ConvertTo-Json) -ContentType "application/json" -EA Stop -TimeoutSec 5
        if ($rr.token) { @{token=$rr.token;url="https://peonforge.ch";username=$un;avatar=$avatar} | ConvertTo-Json | Set-Content $ff -Encoding UTF8; OK "Inscrit sur peonforge.ch" }
    } catch { WR "Inscription echouee (sera fait au lancement)" }
}

# ═══ 9. Raccourci ═══
LN
S 9 $T "Raccourci de demarrage automatique..."
$sd = [IO.Path]::Combine($env:APPDATA, "Microsoft\Windows\Start Menu\Programs\Startup")
$ep = Join-Path $dir "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $ep)) { $ep = Join-Path $dir "node_modules\.bin\electron.cmd" }
try {
    $sh = New-Object -ComObject WScript.Shell
    $sc = $sh.CreateShortcut("$sd\PeonForge.lnk")
    $sc.TargetPath = $ep; $sc.Arguments = "`"$dir`""; $sc.WorkingDirectory = $dir; $sc.WindowStyle = 7
    $sc.Description = "PeonForge"; $ip = Join-Path $dir "app-icon.ico"
    if (Test-Path $ip) { $sc.IconLocation = $ip }; $sc.Save()
    OK "PeonForge se lancera au demarrage"
} catch { WR "Raccourci echoue" }

# ═══ DONE ═══
Write-Host ""
Write-Host "    ╔══════════════════════════════════════════════════╗" -Fo $gr
Write-Host "    ║" -Fo $gr -No; Write-Host "                                                  " -No; Write-Host "║" -Fo $gr
Write-Host "    ║" -Fo $gr -No; Write-Host "        ✓  Installation terminee !                 " -Fo $gr -No; Write-Host "║" -Fo $gr
Write-Host "    ║" -Fo $gr -No; Write-Host "                                                  " -No; Write-Host "║" -Fo $gr
Write-Host "    ║" -Fo $gr -No; Write-Host "        $un — $sl" -Fo $c -No
    $pad = 50 - 8 - $un.Length - 3 - $sl.Length; Write-Host (" " * [Math]::Max(1,$pad)) -No; Write-Host "║" -Fo $gr
Write-Host "    ║" -Fo $gr -No; Write-Host "                                                  " -No; Write-Host "║" -Fo $gr
Write-Host "    ║" -Fo $gr -No; Write-Host "     ⚠  Lance Claude Code depuis PowerShell !     " -Fo Yellow -No; Write-Host "║" -Fo $gr
Write-Host "    ║" -Fo $gr -No; Write-Host "     ⚔  peonforge.ch                              " -Fo $d -No; Write-Host "║" -Fo $gr
Write-Host "    ║" -Fo $gr -No; Write-Host "                                                  " -No; Write-Host "║" -Fo $gr
Write-Host "    ╚══════════════════════════════════════════════════╝" -Fo $gr
Write-Host ""
Write-Host "    Lancement de PeonForge..." -Fo $c

# Launch
$ep2 = Join-Path $dir "node_modules\electron\dist\electron.exe"
if (Test-Path $ep2) { Start-Process $ep2 "`"$dir`"" -WorkingDirectory $dir }
elseif (Test-Path (Join-Path $dir "node_modules\.bin\electron.cmd")) { Start-Process cmd.exe "/c cd /d `"$dir`" && `"$(Join-Path $dir 'node_modules\.bin\electron.cmd')`" ." -WindowStyle Hidden }
else { Start-Process cmd.exe "/c cd /d `"$dir`" && npx.cmd electron ." -WindowStyle Hidden }

Start-Sleep -Seconds 3
Write-Host "    ✓ PeonForge est dans le system tray !" -Fo $gr
Write-Host ""
