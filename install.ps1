#Requires -Version 5.1
# PeonForge Installer
$ErrorActionPreference = "SilentlyContinue"

function S($n,$t,$txt) { Write-Host "    [" -Fo Cyan -No; Write-Host "$n/$t" -Fo White -No; Write-Host "] " -Fo Cyan -No; Write-Host $txt -Fo White }
function OK($t) { Write-Host "        OK " -Fo Green -No; Write-Host $t -Fo Gray }
function WR($t) { Write-Host "        !! " -Fo Yellow -No; Write-Host $t -Fo Gray }
function FL($t) { Write-Host "        XX " -Fo Red -No; Write-Host $t -Fo Gray }
function ASK($p) { Write-Host "        $p" -Fo White -No; return [Console]::ReadLine() }
function ASKPWD($p) {
    Write-Host "        $p" -Fo White -No
    $pwd = ""
    while ($true) {
        $key = [Console]::ReadKey($true)
        if ($key.Key -eq "Enter") { Write-Host ""; return $pwd }
        if ($key.Key -eq "Backspace") { if ($pwd.Length -gt 0) { $pwd = $pwd.Substring(0, $pwd.Length-1); Write-Host "`b `b" -No } }
        else { $pwd += $key.KeyChar; Write-Host "*" -No }
    }
}
function ASKDEF($p, $def) {
    Write-Host "        $p" -Fo White -No; Write-Host " [$def] " -Fo DarkGray -No
    $v = [Console]::ReadLine()
    if ([string]::IsNullOrWhiteSpace($v)) { return $def }
    return $v
}

cls; Write-Host ""
Write-Host "    ======================================================" -Fo DarkYellow
Write-Host "    =                                                    =" -Fo DarkYellow
Write-Host "    =   PEON FORGE                                      =" -Fo DarkYellow
Write-Host "    =   Ton compagnon Warcraft pour Claude Code          =" -Fo DarkYellow
Write-Host "    =   100% gratuit - 100% inutile - Work, work.       =" -Fo DarkYellow
Write-Host "    =                                                    =" -Fo DarkYellow
Write-Host "    ======================================================" -Fo DarkYellow
Write-Host ""

$T = 9; $dir = Join-Path $env:USERPROFILE "PeonForge"

# 1. Git
S 1 $T "Verification de Git..."
if (Get-Command git -EA 0) { OK "Git OK" }
else { WR "Installation de Git..."; winget install Git.Git --accept-package-agreements --accept-source-agreements 2>$null
    $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
    if (Get-Command git -EA 0) { OK "Git installe" } else { FL "Installe Git: https://git-scm.com"; exit 1 }
}

# 2. Node
S 2 $T "Verification de Node.js..."
if (Get-Command node -EA 0) { OK "Node.js OK" }
else { WR "Installation de Node.js..."; winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements 2>$null
    $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
    if (Get-Command node -EA 0) { OK "Node.js installe" } else { FL "Installe Node.js: https://nodejs.org"; exit 1 }
}

# 3. Clone
S 3 $T "Telechargement de PeonForge..."
if (Test-Path "$dir\.git") { Push-Location $dir; & git pull -q 2>$null; Pop-Location; OK "Mis a jour" }
else { if (Test-Path $dir) { Remove-Item $dir -Recurse -Force 2>$null }
    & git clone -q https://github.com/neovalpox/PeonForge-Overlay.git $dir 2>$null
    if (Test-Path "$dir\package.json") { OK "Telecharge" } else { FL "Echec du clonage"; exit 1 }
}

# 4. npm install (ignore casclib build errors)
S 4 $T "Installation des dependances..."
Push-Location $dir; & npm.cmd install --ignore-scripts 2>$null; Pop-Location; OK "Pret"

# 5. cloudflared
S 5 $T "Cloudflared..."
if (Get-Command cloudflared -EA 0) { OK "Deja installe" }
else { WR "Installation..."; winget install Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements 2>$null
    if (Get-Command cloudflared -EA 0) { OK "Installe" } else { WR "Optionnel" }
}

# 6. ffplay
S 6 $T "FFplay..."
if (Get-Command ffplay -EA 0) { OK "Deja installe" }
else { WR "Installation..."; winget install Gyan.FFmpeg --accept-package-agreements --accept-source-agreements 2>$null
    if (Get-Command ffplay -EA 0) { OK "Installe" } else { WR "Optionnel" }
}

# 7. Hooks
S 7 $T "Hooks Claude Code..."
$hs = Join-Path $dir "scripts\install-hooks.ps1"
if (Test-Path $hs) { & powershell -NoProfile -ExecutionPolicy Bypass -File $hs 2>$null; OK "Hooks actifs" }
else { WR "Hooks non trouves" }

# 8. Profil
Write-Host "    ------" -Fo DarkGray
S 8 $T "Configuration du profil"
Write-Host ""
Write-Host "        Choisis ton camp :" -Fo White
Write-Host "          [1] Alliance - Paysan" -Fo Cyan
Write-Host "          [2] Horde    - Peon" -Fo Red
Write-Host ""
$fc = ASKDEF "Ton choix" "1"
if ($fc -ne "2") { $fc = "1" }
$side = if ($fc -eq "1") {"alliance"} else {"horde"}
$faction = if ($side -eq "alliance") {"human"} else {"orc"}
$avatar = if ($side -eq "alliance") {"peasant_fr"} else {"peon_fr"}
$sl = if ($side -eq "alliance") {"Alliance"} else {"Horde"}
OK "$sl selectionne"
Write-Host ""

# Username
$un = ""; $et = $null; $needsPassword = $false
$defaultName = $env:USERNAME
while ($true) {
    $un = ASKDEF "Pseudo" $defaultName
    if ($un.Length -lt 2 -or $un.Length -gt 20) { WR "Entre 2 et 20 caracteres"; continue }
    try {
        $resp = Invoke-RestMethod "https://peonforge.ch/api/player/$([uri]::EscapeDataString($un))" -EA Stop -TimeoutSec 5
        if ($resp.username) {
            $hp = $true; try { $hp = (Invoke-RestMethod "https://peonforge.ch/api/player/$([uri]::EscapeDataString($un))/has-password" -EA Stop -TimeoutSec 5).has_password -eq $true } catch {}
            WR "Le pseudo '$un' existe deja !"
            if ($hp) {
                Write-Host "          [1] C'est moi, connexion" -Fo Cyan
                Write-Host "          [2] Autre pseudo" -Fo DarkGray
                $ch = ASKDEF "Choix" "1"
                if ($ch -ne "2") {
                    $pw = ASKPWD "Mot de passe : "
                    try { $lr = Invoke-RestMethod "https://peonforge.ch/api/login" -Method Post -Body (@{username=$un;password=$pw}|ConvertTo-Json) -ContentType "application/json" -EA Stop -TimeoutSec 5
                        if ($lr.token) { $et = $lr.token; OK "Bienvenue $un !"; break }
                    } catch { FL "Mot de passe incorrect"; continue }
                } else { continue }
            } else {
                Write-Host "          Ce compte n'a pas de mot de passe." -Fo DarkGray
                Write-Host "          [1] C'est moi, definir un mdp" -Fo Cyan
                Write-Host "          [2] Autre pseudo" -Fo DarkGray
                $ch = ASKDEF "Choix" "1"
                if ($ch -ne "2") {
                    $ef = Join-Path (Join-Path $env:USERPROFILE ".peonping-overlay") "forge.json"
                    if (Test-Path $ef) { try { $fd = Get-Content $ef -Raw | ConvertFrom-Json; if ($fd.username -eq $un -and $fd.token) { $et = $fd.token; $needsPassword = $true; OK "Compte recupere"; break } } catch {} }
                    WR "Definis ton mdp apres installation"; break
                } else { continue }
            }
        }
    } catch { $sc2 = $_.Exception.Response.StatusCode.value__; if ($sc2 -and $sc2 -ne 404) { WR "Erreur reseau" } }
    break
}
OK "Pseudo : $un"

# Password
$pw2 = ""
if (-not $et -or $needsPassword) {
    Write-Host ""
    while ($true) {
        $pw2 = ASKPWD "Mot de passe - min 4 car. : "
        if ($pw2.Length -lt 4) { WR "Minimum 4 caracteres"; continue }
        $pw2c = ASKPWD "Confirmer le mot de passe : "
        if ($pw2 -ne $pw2c) { WR "Les mots de passe ne correspondent pas"; continue }
        break
    }
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
    if ($pw2.Length -ge 4) { try { Invoke-RestMethod "https://peonforge.ch/api/set-password" -Method Post -Body (@{password=$pw2}|ConvertTo-Json) -ContentType "application/json" -Headers @{Authorization="Bearer $et"} -EA Stop -TimeoutSec 5 | Out-Null; OK "Mot de passe defini" } catch { WR "Erreur mdp" } }
} else {
    try { $rr = Invoke-RestMethod "https://peonforge.ch/api/register" -Method Post -Body (@{username=$un;faction=$faction;password=$pw2}|ConvertTo-Json) -ContentType "application/json" -EA Stop -TimeoutSec 5
        if ($rr.token) { @{token=$rr.token;url="https://peonforge.ch";username=$un;avatar=$avatar} | ConvertTo-Json | Set-Content $ff -Encoding UTF8; OK "Inscrit sur peonforge.ch" }
    } catch { WR "Inscription echouee" }
}

# 9. Raccourci + lancement
Write-Host "    ------" -Fo DarkGray
S 9 $T "Raccourci et lancement..."

# Find electron
$ep = Join-Path $dir "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $ep)) {
    # Electron might not be installed due to --ignore-scripts, install it explicitly
    Write-Host "        Installation de Electron..." -Fo DarkGray
    Push-Location $dir; & npm.cmd install electron --silent 2>$null; Pop-Location
    $ep = Join-Path $dir "node_modules\electron\dist\electron.exe"
}

# Create shortcuts: Startup + Desktop + Start Menu
$ip = Join-Path $dir "app-icon.ico"
$sh = New-Object -ComObject WScript.Shell

# Startup shortcut
$sd = [IO.Path]::Combine($env:APPDATA, "Microsoft\Windows\Start Menu\Programs\Startup")
try {
    $lnk = $sh.CreateShortcut("$sd\PeonForge.lnk")
    $lnk.TargetPath = $ep; $lnk.Arguments = "`"$dir`""; $lnk.WorkingDirectory = $dir; $lnk.WindowStyle = 7
    $lnk.Description = "PeonForge"; if (Test-Path $ip) { $lnk.IconLocation = $ip }; $lnk.Save()
    OK "Demarrage automatique"
} catch { WR "Raccourci startup echoue" }

# Desktop shortcut
try {
    $desktop = [Environment]::GetFolderPath("Desktop")
    $lnk2 = $sh.CreateShortcut("$desktop\PeonForge.lnk")
    $lnk2.TargetPath = $ep; $lnk2.Arguments = "`"$dir`""; $lnk2.WorkingDirectory = $dir; $lnk2.WindowStyle = 7
    $lnk2.Description = "PeonForge - Ton compagnon Warcraft pour Claude Code"; if (Test-Path $ip) { $lnk2.IconLocation = $ip }; $lnk2.Save()
    OK "Raccourci bureau"
} catch { WR "Raccourci bureau echoue" }

# Start Menu shortcut
try {
    $sm = [IO.Path]::Combine($env:APPDATA, "Microsoft\Windows\Start Menu\Programs")
    $lnk3 = $sh.CreateShortcut("$sm\PeonForge.lnk")
    $lnk3.TargetPath = $ep; $lnk3.Arguments = "`"$dir`""; $lnk3.WorkingDirectory = $dir; $lnk3.WindowStyle = 7
    $lnk3.Description = "PeonForge - Ton compagnon Warcraft pour Claude Code"; if (Test-Path $ip) { $lnk3.IconLocation = $ip }; $lnk3.Save()
    OK "Raccourci menu demarrer"
} catch { WR "Raccourci menu echoue" }

# Done
Write-Host ""
Write-Host "    ======================================================" -Fo Green
Write-Host "    =                                                    =" -Fo Green
Write-Host "    =   Installation terminee !                          =" -Fo Green
Write-Host "    =   $un - $sl" -Fo Green -No
$pad = 52 - 4 - $un.Length - 3 - $sl.Length; if ($pad -lt 1) {$pad=1}; Write-Host (" " * $pad) -No; Write-Host "=" -Fo Green
Write-Host "    =                                                    =" -Fo Green
Write-Host "    =   IMPORTANT : Lance Claude Code depuis PowerShell  =" -Fo Yellow
Write-Host "    =   peonforge.ch                                     =" -Fo DarkGray
Write-Host "    =                                                    =" -Fo Green
Write-Host "    ======================================================" -Fo Green
Write-Host ""

# Launch as fully detached process (survives PowerShell close)
Write-Host "    Lancement de PeonForge..." -Fo Cyan
if (Test-Path $ep) {
    # Create a temp VBS script to launch electron completely detached
    $vbs = Join-Path $env:TEMP "peonforge_launch.vbs"
    $vbsContent = "CreateObject(`"WScript.Shell`").Run `"`"`"$ep`"`" `"`"`"$dir`"`"`"`", 0, False"
    Set-Content $vbs $vbsContent -Encoding ASCII
    & wscript.exe $vbs
    Start-Sleep 4
    # Verify it's running
    $running = Get-Process -Name "electron" -EA 0
    if ($running) {
        Write-Host "    PeonForge est dans le system tray !" -Fo Green
    } else {
        WR "Electron ne semble pas tourne. Double-clique le raccourci PeonForge sur le bureau."
    }
    Remove-Item $vbs -EA 0
} else {
    WR "electron.exe non trouve"
    WR "Double-clique le raccourci PeonForge sur le bureau pour lancer."
}
Write-Host ""
