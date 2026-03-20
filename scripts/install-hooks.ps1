# PeonForge — Install Claude Code hooks
# Copies peon.ps1, sound packs, and patches ~/.claude/settings.json

$ErrorActionPreference = "Stop"
Write-Host "`n=== PeonForge Hook Installer ===" -ForegroundColor Cyan

$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$HooksSource = Join-Path $RepoRoot "hooks"
$ClaudeDir = Join-Path $env:USERPROFILE ".claude"
$HooksTarget = Join-Path $ClaudeDir "hooks\peon-ping"
$SettingsFile = Join-Path $ClaudeDir "settings.json"

# 1. Check source files exist
if (-not (Test-Path (Join-Path $HooksSource "peon.ps1"))) {
    Write-Host "Error: hooks/peon.ps1 not found in repo" -ForegroundColor Red
    exit 1
}

# 2. Create target directory
Write-Host "`n[1/3] Copying hook files to $HooksTarget..." -ForegroundColor Yellow
if (-not (Test-Path $HooksTarget)) {
    New-Item -ItemType Directory -Path $HooksTarget -Force | Out-Null
}

# Copy main script
Copy-Item (Join-Path $HooksSource "peon.ps1") $HooksTarget -Force
Write-Host "  peon.ps1" -ForegroundColor Green

# Copy win-play.ps1
$scriptsTarget = Join-Path $HooksTarget "scripts"
if (-not (Test-Path $scriptsTarget)) { New-Item -ItemType Directory -Path $scriptsTarget -Force | Out-Null }
Copy-Item (Join-Path $HooksSource "win-play.ps1") $scriptsTarget -Force
Write-Host "  scripts/win-play.ps1" -ForegroundColor Green

# Copy config (only if not exists — don't overwrite user config)
$configTarget = Join-Path $HooksTarget "config.json"
if (-not (Test-Path $configTarget)) {
    Copy-Item (Join-Path $HooksSource "config.default.json") $configTarget
    Write-Host "  config.json (new)" -ForegroundColor Green
} else {
    Write-Host "  config.json (kept existing)" -ForegroundColor DarkGray
}

# Copy sound packs (only missing ones)
$packsTarget = Join-Path $HooksTarget "packs"
if (-not (Test-Path $packsTarget)) { New-Item -ItemType Directory -Path $packsTarget -Force | Out-Null }
$packsSource = Join-Path $HooksSource "packs"
if (Test-Path $packsSource) {
    Get-ChildItem $packsSource -Directory | ForEach-Object {
        $dest = Join-Path $packsTarget $_.Name
        if (-not (Test-Path $dest)) {
            Copy-Item $_.FullName $dest -Recurse
            Write-Host "  packs/$($_.Name)" -ForegroundColor Green
        } else {
            Write-Host "  packs/$($_.Name) (already exists)" -ForegroundColor DarkGray
        }
    }
}

# 3. Patch settings.json
Write-Host "`n[2/3] Patching Claude Code settings..." -ForegroundColor Yellow

$hookCommand = "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$HooksTarget\peon.ps1`""

# Define the hooks we need
$hookEvents = @("Notification", "Stop", "SessionStart", "SessionEnd", "SubagentStart", "PermissionRequest", "PostToolUseFailure", "PreCompact")

if (Test-Path $SettingsFile) {
    $settings = Get-Content $SettingsFile -Raw | ConvertFrom-Json
} else {
    if (-not (Test-Path $ClaudeDir)) { New-Item -ItemType Directory -Path $ClaudeDir -Force | Out-Null }
    $settings = [PSCustomObject]@{}
}

# Ensure hooks property exists
if (-not $settings.PSObject.Properties['hooks']) {
    $settings | Add-Member -NotePropertyName 'hooks' -NotePropertyValue ([PSCustomObject]@{})
}

$hookEntry = [PSCustomObject]@{
    matcher = ""
    hooks = @(
        [PSCustomObject]@{
            type = "command"
            command = $hookCommand
            timeout = 10
        }
    )
}

$added = 0
foreach ($eventName in $hookEvents) {
    if (-not $settings.hooks.PSObject.Properties[$eventName]) {
        $settings.hooks | Add-Member -NotePropertyName $eventName -NotePropertyValue @($hookEntry)
        $added++
    } else {
        # Check if our hook is already there, and update the command if needed
        $existing = $settings.hooks.$eventName
        $found = $false
        foreach ($entry in $existing) {
            foreach ($h in $entry.hooks) {
                if ($h.command -like "*peon.ps1*") {
                    $found = $true
                    # Update command to latest version (fixes ExecutionPolicy etc.)
                    if ($h.command -ne $hookCommand) {
                        $h.command = $hookCommand
                        $added++
                    }
                    break
                }
            }
            if ($found) { break }
        }
        if (-not $found) {
            $settings.hooks.$eventName = @($existing) + @($hookEntry)
            $added++
        }
    }
}

$settings | ConvertTo-Json -Depth 10 | Set-Content $SettingsFile -Encoding UTF8
if ($added -gt 0) {
    Write-Host "  Added $added hook events" -ForegroundColor Green
} else {
    Write-Host "  All hooks already configured" -ForegroundColor DarkGray
}

# 3. Check prerequisites
Write-Host "`n[3/3] Checking prerequisites..." -ForegroundColor Yellow
$ff = Get-Command ffplay -ErrorAction SilentlyContinue
if ($ff) {
    Write-Host "  ffplay: OK" -ForegroundColor Green
} else {
    Write-Host "  ffplay: not found (sounds will work but without volume control)" -ForegroundColor Yellow
    Write-Host "  Install: winget install Gyan.FFmpeg" -ForegroundColor DarkGray
}

$cf = Get-Command cloudflared -ErrorAction SilentlyContinue
if ($cf) {
    Write-Host "  cloudflared: OK" -ForegroundColor Green
} else {
    Write-Host "  cloudflared: not found (needed for mobile access over internet)" -ForegroundColor Yellow
    Write-Host "  Install: winget install Cloudflare.cloudflared" -ForegroundColor DarkGray
}

Write-Host "`n=== Installation complete! ===" -ForegroundColor Cyan
Write-Host "Hook: $HooksTarget\peon.ps1" -ForegroundColor DarkGray
Write-Host "Packs: peon_fr, peasant_fr (add more with extract-characters.cjs)" -ForegroundColor DarkGray
Write-Host "Config: $configTarget" -ForegroundColor DarkGray
Write-Host "`nRestart Claude Code for hooks to take effect." -ForegroundColor Yellow
Write-Host ""
