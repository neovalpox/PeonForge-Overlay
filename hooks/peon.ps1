# peon-ping hook for Claude Code (Windows native)
# Called by Claude Code hooks on SessionStart, Stop, Notification, PermissionRequest, PostToolUseFailure, PreCompact

param(
    [string]$Command = "",
    [string]$Arg1 = "",
    [string]$Arg2 = ""
)

# 8-second self-timeout safety net ??? kills this process if anything blocks unexpectedly.
# Uses System.Timers.Timer (not Forms.Timer) so it works in headless PowerShell without a message pump.
# Must fire before ANY I/O (config read, state read, stdin read).
if (-not $Command) {
    $safetyTimer = New-Object System.Timers.Timer
    $safetyTimer.Interval = 8000
    $safetyTimer.AutoReset = $false
    Register-ObjectEvent -InputObject $safetyTimer -EventName Elapsed -Action { [Environment]::Exit(1) } | Out-Null
    $safetyTimer.Start()
}

# Raw config read; repair is done at install/update time, so hook only needs plain read.
function Get-PeonConfigRaw {
    param([string]$Path)
    return Get-Content $Path -Raw
}

# --- CLI commands ---
if ($Command) {
    $InstallDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $ConfigPath = Join-Path $InstallDir "config.json"

    # Ensure config exists
    if (-not (Test-Path $ConfigPath)) {
        Write-Host "Error: peon-ping not configured. Config not found at $ConfigPath" -ForegroundColor Red
        exit 1
    }

    switch -Regex ($Command) {
        "^--toggle$" {
            $raw = Get-PeonConfigRaw $ConfigPath
            $cfg = $raw | ConvertFrom-Json
            $newState = -not $cfg.enabled
            $raw = Get-Content $ConfigPath -Raw
            $raw = $raw -replace '"enabled"\s*:\s*(true|false)', "`"enabled`": $($newState.ToString().ToLower())"
            Set-Content $ConfigPath -Value $raw -Encoding UTF8
            $state = if ($newState) { "ENABLED" } else { "PAUSED" }
            Write-Host "peon-ping: $state" -ForegroundColor Cyan
            return
        }
        "^--(pause|mute)$" {
            $raw = Get-Content $ConfigPath -Raw
            $raw = $raw -replace '"enabled"\s*:\s*(true|false)', '"enabled": false'
            Set-Content $ConfigPath -Value $raw -Encoding UTF8
            Write-Host "peon-ping: PAUSED" -ForegroundColor Yellow
            return
        }
        "^--(resume|unmute)$" {
            $raw = Get-Content $ConfigPath -Raw
            $raw = $raw -replace '"enabled"\s*:\s*(true|false)', '"enabled": true'
            Set-Content $ConfigPath -Value $raw -Encoding UTF8
            Write-Host "peon-ping: ENABLED" -ForegroundColor Green
            return
        }
        "^--status$" {
            try {
                $cfg = Get-PeonConfigRaw $ConfigPath | ConvertFrom-Json
                $state = if ($cfg.enabled) { "ENABLED" } else { "PAUSED" }
                Write-Host "peon-ping: $state | pack: $($cfg.active_pack) | volume: $($cfg.volume)" -ForegroundColor Cyan
            } catch {
                Write-Host "Error reading config: $_" -ForegroundColor Red
                exit 1
            }
            return
        }
        "^--packs$" {
            $packsDir = Join-Path $InstallDir "packs"
            $cfg = Get-PeonConfigRaw $ConfigPath | ConvertFrom-Json
            $available = Get-ChildItem -Path $packsDir -Directory | Where-Object {
                (Get-ChildItem -Path (Join-Path $_.FullName "sounds") -File -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0
            } | ForEach-Object { $_.Name } | Sort-Object

            switch ($Arg1) {
                "use" {
                    if (-not $Arg2) {
                        Write-Host "Usage: peon packs use <pack-name>" -ForegroundColor Yellow
                        return
                    }
                    $newPack = $Arg2
                    if ($newPack -notin $available) {
                        Write-Host "Pack '$newPack' not found. Available: $($available -join ', ')" -ForegroundColor Red
                        return
                    }
                    $raw = Get-Content $ConfigPath -Raw
                    $raw = $raw -replace '"active_pack"\s*:\s*"[^"]*"', "`"active_pack`": `"$newPack`""
                    Set-Content $ConfigPath -Value $raw -Encoding UTF8
                    Write-Host "peon-ping: switched to '$newPack'" -ForegroundColor Green
                    return
                }
                "next" {
                    $idx = [array]::IndexOf($available, $cfg.active_pack)
                    $newPack = $available[($idx + 1) % $available.Count]
                    $raw = Get-Content $ConfigPath -Raw
                    $raw = $raw -replace '"active_pack"\s*:\s*"[^"]*"', "`"active_pack`": `"$newPack`""
                    Set-Content $ConfigPath -Value $raw -Encoding UTF8
                    Write-Host "peon-ping: switched to '$newPack'" -ForegroundColor Green
                    return
                }
                default {
                    # "list" or no subcommand - show available packs
                    Write-Host "Available packs:" -ForegroundColor Cyan
                    foreach ($packName in $available) {
                        $soundCount = (Get-ChildItem -Path (Join-Path $packsDir "$packName\sounds") -File -ErrorAction SilentlyContinue | Measure-Object).Count
                        $marker = if ($packName -eq $cfg.active_pack) { " <-- active" } else { "" }
                        Write-Host "  $packName ($soundCount sounds)$marker"
                    }
                    return
                }
            }
        }
        "^--pack$" {
            $cfg = Get-PeonConfigRaw $ConfigPath | ConvertFrom-Json
            $packsDir = Join-Path $InstallDir "packs"
            $available = Get-ChildItem -Path $packsDir -Directory | Where-Object {
                (Get-ChildItem -Path (Join-Path $_.FullName "sounds") -File -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0
            } | ForEach-Object { $_.Name } | Sort-Object

            if ($Arg1 -eq "use") {
                # "peon pack use <name>" - treat Arg2 as the pack name
                if (-not $Arg2) {
                    Write-Host "Usage: peon pack use <pack-name>" -ForegroundColor Yellow
                    return
                }
                $newPack = $Arg2
            } elseif ($Arg1 -eq "next") {
                # "peon pack next" - cycle to next
                $idx = [array]::IndexOf($available, $cfg.active_pack)
                $newPack = $available[($idx + 1) % $available.Count]
            } elseif ($Arg1) {
                $newPack = $Arg1
            } else {
                $idx = [array]::IndexOf($available, $cfg.active_pack)
                $newPack = $available[($idx + 1) % $available.Count]
            }

            if ($newPack -notin $available) {
                Write-Host "Pack '$newPack' not found. Available: $($available -join ', ')" -ForegroundColor Red
                return
            }

            $raw = Get-Content $ConfigPath -Raw
            $raw = $raw -replace '"active_pack"\s*:\s*"[^"]*"', "`"active_pack`": `"$newPack`""
            Set-Content $ConfigPath -Value $raw -Encoding UTF8
            Write-Host "peon-ping: switched to '$newPack'" -ForegroundColor Green
            return
        }
        "^--volume$" {
            if ($Arg1) {
                $vol = [math]::Round([math]::Max(0.0, [math]::Min(1.0, [double]::Parse($Arg1.Trim(), [System.Globalization.CultureInfo]::InvariantCulture))), 2)
                $volStr = $vol.ToString([System.Globalization.CultureInfo]::InvariantCulture)
                $raw = Get-Content $ConfigPath -Raw
                $raw = $raw -replace '"volume"\s*:\s*[\d.]+,', "`"volume`": $volStr,"
                Set-Content $ConfigPath -Value $raw -Encoding UTF8
                Write-Host "peon-ping: volume set to $vol" -ForegroundColor Green
            } else {
                Write-Host "Usage: peon --volume 0.5" -ForegroundColor Yellow
            }
            return
        }
        "^--help$" {
            Write-Host "peon-ping commands:" -ForegroundColor Cyan
            Write-Host "  --toggle       Toggle enabled/paused"
            Write-Host "  --pause        Pause sounds"
            Write-Host "  --resume       Resume sounds"
            Write-Host "  --mute         Alias for --pause"
            Write-Host "  --unmute       Alias for --resume"
            Write-Host "  --status       Show current status"
            Write-Host "  --packs        List available sound packs"
            Write-Host "  --pack [name]  Switch pack (or cycle)"
            Write-Host "  --volume N     Set volume (0.0-1.0)"
            Write-Host "  --help         Show this help"
            return
        }
    }
    return
}

# --- Hook mode (called by Claude Code via stdin JSON) ---
$InstallDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $InstallDir "config.json"
$StatePath = Join-Path $InstallDir ".state.json"

# Read config
try {
    $config = Get-PeonConfigRaw $ConfigPath | ConvertFrom-Json
} catch {
    exit 0
}

if (-not $config.enabled) { exit 0 }

# Read hook input from stdin (StreamReader with UTF-8 auto-strips BOM on Windows)
$hookInput = ""
try {
    if (-not [Console]::IsInputRedirected) { exit 0 }
    $stream = [Console]::OpenStandardInput()
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
    $hookInput = $reader.ReadToEnd()
    $reader.Close()
} catch {
    exit 0
}

if (-not $hookInput) { exit 0 }

try {
    $event = $hookInput | ConvertFrom-Json
} catch {
    exit 0
}

$rawEvent = $event.hook_event_name
if (-not $rawEvent) { exit 0 }

# --- Forward event to PeonPing Overlay (fire-and-forget) ---
$projectPath = ""
try { $projectPath = (Get-Location).Path } catch {}
$projectName = if ($projectPath) { Split-Path $projectPath -Leaf } else { "Projet" }

# Cursor IDE sends camelCase via Third-party skills; Claude Code sends PascalCase.
# Map to PascalCase so the switch below matches.
$cursorMap = @{
    "sessionStart" = "SessionStart"
    "sessionEnd" = "SessionEnd"
    "beforeSubmitPrompt" = "UserPromptSubmit"
    "stop" = "Stop"
    "preToolUse" = "UserPromptSubmit"
    "postToolUse" = "Stop"
    "subagentStop" = "Stop"
    "subagentStart" = "SubagentStart"
    "preCompact" = "PreCompact"
}
$hookEvent = if ($cursorMap.ContainsKey($rawEvent)) { $cursorMap[$rawEvent] } else { $rawEvent }

# Extract session ID (Claude Code: session_id, Cursor: conversation_id)
$sessionId = if ($event.session_id) { $event.session_id } elseif ($event.conversation_id) { $event.conversation_id } else { "default" }

# --- Forward event to PeonPing Overlay ---
try {
    $overlayBody = @{
        hook_event = $hookEvent
        raw_event = $rawEvent
        session_id = $sessionId
        project = $projectName
        project_path = $projectPath
    } | ConvertTo-Json -Compress

    $overlayBytes = [System.Text.Encoding]::UTF8.GetBytes($overlayBody)
    $overlayReq = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:7777/event")
    $overlayReq.Method = "POST"
    $overlayReq.ContentType = "application/json"
    $overlayReq.Timeout = 1500
    $overlayReq.ContentLength = $overlayBytes.Length
    $overlayStream = $overlayReq.GetRequestStream()
    $overlayStream.Write($overlayBytes, 0, $overlayBytes.Length)
    $overlayStream.Close()
    $overlayResp = $overlayReq.GetResponse()
    $overlayResp.Close()
} catch {
    # Overlay not running — try to auto-start on SessionStart
    if ($hookEvent -eq "SessionStart") {
        $appJson = Join-Path ([Environment]::GetFolderPath("UserProfile")) ".peonping-overlay\app.json"
        if (Test-Path $appJson) {
            try {
                $appCfg = Get-Content $appJson -Raw | ConvertFrom-Json
                $electronExe = $appCfg.electron_path
                $appDir = $appCfg.app_path
                if ($electronExe -and (Test-Path $electronExe) -and $appDir -and (Test-Path $appDir)) {
                    Start-Process -FilePath $electronExe -ArgumentList "`"$appDir`"" -WindowStyle Hidden
                    # Wait briefly then retry the event
                    Start-Sleep -Milliseconds 3000
                    try {
                        $retryReq = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:7777/event")
                        $retryReq.Method = "POST"
                        $retryReq.ContentType = "application/json"
                        $retryReq.Timeout = 1500
                        $retryReq.ContentLength = $overlayBytes.Length
                        $retryStream = $retryReq.GetRequestStream()
                        $retryStream.Write($overlayBytes, 0, $overlayBytes.Length)
                        $retryStream.Close()
                        $retryResp = $retryReq.GetResponse()
                        $retryResp.Close()
                    } catch {}
                }
            } catch {}
        }
    }
}

# Helper function to convert PSCustomObject to hashtable (PS 5.1 compat)
function ConvertTo-Hashtable {
    param([Parameter(ValueFromPipeline)]$obj)
    if ($obj -is [hashtable]) { return $obj }
    if ($obj -is [System.Collections.IEnumerable] -and $obj -isnot [string]) {
        return @($obj | ForEach-Object { ConvertTo-Hashtable $_ })
    }
    if ($obj -is [PSCustomObject]) {
        $ht = @{}
        foreach ($prop in $obj.PSObject.Properties) {
            $ht[$prop.Name] = ConvertTo-Hashtable $prop.Value
        }
        return $ht
    }
    return $obj
}

# --- Atomic state I/O helpers ---
function Write-StateAtomic {
    param([hashtable]$State, [string]$Path)
    $dir = Split-Path $Path -Parent
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $tmp = "$Path.$PID.tmp"
    try {
        $State | ConvertTo-Json -Depth 3 | Set-Content $tmp -Encoding UTF8
        # [System.IO.File]::Move with overwrite requires .NET Core (PS 7+).
        # For PS 5.1 compat: delete target then move (atomic on NTFS same-volume).
        if (Test-Path $Path) { [System.IO.File]::Delete($Path) }
        [System.IO.File]::Move($tmp, $Path)
    } catch {
        Remove-Item $tmp -ErrorAction SilentlyContinue
    }
}

function Read-StateWithRetry {
    param([string]$Path)
    $delays = @(50, 100, 200)
    for ($i = 0; $i -le $delays.Count; $i++) {
        try {
            if (Test-Path $Path) {
                $raw = Get-Content $Path -Raw
                if ($raw -and $raw.Trim().Length -gt 0) {
                    $stateObj = $raw | ConvertFrom-Json
                    $converted = ConvertTo-Hashtable $stateObj
                    if ($converted -is [hashtable]) { return $converted }
                }
            }
            return @{}
        } catch {
            if ($i -lt $delays.Count) {
                Start-Sleep -Milliseconds $delays[$i]
            }
        }
    }
    return @{}
}

# Read state
$state = Read-StateWithRetry -Path $StatePath

# --- Session cleanup: expire old sessions ---
$now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$ttlDays = if ($config.session_ttl_days) { $config.session_ttl_days } else { 7 }
$cutoff = $now - ($ttlDays * 86400)
$sessionPacks = if ($state.ContainsKey("session_packs")) { $state["session_packs"] } else { @{} }
$sessionPacksClean = @{}
foreach ($sid in $sessionPacks.Keys) {
    $packData = $sessionPacks[$sid]
    if ($packData -is [hashtable]) {
        # New format with timestamp
        $lastUsed = if ($packData.ContainsKey("last_used")) { $packData["last_used"] } else { 0 }
        if ($lastUsed -gt $cutoff) {
            if ($sid -eq $sessionId) {
                $packData["last_used"] = $now
            }
            $sessionPacksClean[$sid] = $packData
        }
    } elseif ($sid -eq $sessionId) {
        # Old format, upgrade active session
        $sessionPacksClean[$sid] = @{ pack = $packData; last_used = $now }
    } elseif ($packData -is [string]) {
        # Old format for inactive sessions - keep for now (migration path)
        $sessionPacksClean[$sid] = $packData
    }
}
$state["session_packs"] = $sessionPacksClean
$stateDirty = $false
if ($sessionPacksClean.Count -ne $sessionPacks.Count) {
    $stateDirty = $true
}

# --- Map Claude Code hook event -> CESP manifest category ---
$category = $null
$ntype = $event.notification_type

switch ($hookEvent) {
    "SessionStart" {
        $category = "session.start"
    }
    "Stop" {
        $category = "task.complete"
        # Debounce rapid Stop events (5s cooldown)
        $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        $lastStop = if ($state.ContainsKey("last_stop_time")) { $state["last_stop_time"] } else { 0 }
        if (($now - $lastStop) -lt 5) {
            $category = $null
        }
        $state["last_stop_time"] = $now
    }
    "Notification" {
        if ($ntype -eq "permission_prompt") {
            # PermissionRequest event handles the sound, skip here
            $category = $null
        } elseif ($ntype -eq "idle_prompt") {
            # Stop event already played the sound
            $category = $null
        } else {
            # Other notification types (e.g., tool results) map to task.complete
            $category = "task.complete"
        }
    }
    "PermissionRequest" {
        $category = "input.required"
    }
    "UserPromptSubmit" {
        # Detect rapid prompts for "annoyed" easter egg
        $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        $annoyedThreshold = if ($config.annoyed_threshold) { $config.annoyed_threshold } else { 3 }
        $annoyedWindow = if ($config.annoyed_window_seconds) { $config.annoyed_window_seconds } else { 10 }

        $allPrompts = if ($state.ContainsKey("prompt_timestamps")) { $state["prompt_timestamps"] } else { @{} }
        $recentPrompts = @()
        if ($allPrompts.ContainsKey($sessionId)) {
            $recentPrompts = @($allPrompts[$sessionId] | Where-Object { ($now - $_) -lt $annoyedWindow })
        }
        $recentPrompts += $now
        $allPrompts[$sessionId] = $recentPrompts
        $state["prompt_timestamps"] = $allPrompts

        if ($recentPrompts.Count -ge $annoyedThreshold) {
            $category = "user.spam"
        }
    }
    "PostToolUseFailure" {
        $category = "task.error"
    }
    "SubagentStart" {
        $category = "task.acknowledge"
    }
}

# Save state
try {
    Write-StateAtomic -State $state -Path $StatePath
} catch {}

if (-not $category) { exit 0 }

# Check if category is enabled
try {
    $catEnabled = $config.categories.$category
    if ($catEnabled -eq $false) { exit 0 }
} catch {}

# --- Pick a sound ---
$activePack = $config.active_pack
if (-not $activePack) { $activePack = "peon" }

# Support pack rotation
$rotationMode = $config.pack_rotation_mode
if (-not $rotationMode) { $rotationMode = "random" }

if ($rotationMode -eq "agentskill" -or $rotationMode -eq "session_override") {
    # Explicit per-session assignments (from skill)
    $sessionPacks = $state.session_packs
    if (-not $sessionPacks) { $sessionPacks = @{} }
    if ($sessionPacks.ContainsKey($sessionId) -and $sessionPacks[$sessionId]) {
        $packData = $sessionPacks[$sessionId]
        # Handle both old string format and new dict format
        if ($packData -is [hashtable]) {
            $candidate = $packData.pack
        } else {
            $candidate = $packData
        }
        $candidateDir = Join-Path $InstallDir "packs\$candidate"
        if ($candidate -and (Test-Path $candidateDir -PathType Container)) {
            $activePack = $candidate
            # Update timestamp
            $sessionPacks[$sessionId] = @{ pack = $candidate; last_used = [int][double]::Parse((Get-Date -UFormat %s)) }
            $state.session_packs = $sessionPacks
            $stateDirty = $true
        } else {
            # Pack missing, use default and clean up
            $activePack = $config.active_pack
            if (-not $activePack) { $activePack = "peon" }
            $sessionPacks.Remove($sessionId)
            $state.session_packs = $sessionPacks
            $stateDirty = $true
        }
    } else {
        # No assignment: check session_packs["default"] (Cursor users without conversation_id)
        $defaultData = $sessionPacks.default
        if ($defaultData) {
            $candidate = if ($defaultData -is [hashtable]) { $defaultData.pack } else { $defaultData }
            $candidateDir = Join-Path $InstallDir "packs\$candidate"
            if ($candidate -and (Test-Path $candidateDir -PathType Container)) {
                $activePack = $candidate
            } else {
                $activePack = $config.active_pack
                if (-not $activePack) { $activePack = "peon" }
            }
        } else {
            $activePack = $config.active_pack
            if (-not $activePack) { $activePack = "peon" }
        }
    }
} elseif ($config.pack_rotation -and $config.pack_rotation.Count -gt 0) {
    # Automatic rotation
    $activePack = $config.pack_rotation | Get-Random
}

$packDir = Join-Path $InstallDir "packs\$activePack"
$manifestPath = Join-Path $packDir "openpeon.json"
if (-not (Test-Path $manifestPath)) { exit 0 }

try {
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
} catch { exit 0 }

# Get sounds for this category
$catSounds = $null
try {
    $catSounds = $manifest.categories.$category.sounds
} catch {}
if (-not $catSounds -or $catSounds.Count -eq 0) { exit 0 }

# Anti-repeat: avoid last played sound
$lastKey = "last_$category"
$lastPlayed = ""
if ($state.ContainsKey($lastKey)) {
    $lastPlayed = $state[$lastKey]
}

$candidates = @($catSounds | Where-Object { (Split-Path $_.file -Leaf) -ne $lastPlayed })
if ($candidates.Count -eq 0) { $candidates = @($catSounds) }

$chosen = $candidates | Get-Random
$soundFile = Split-Path $chosen.file -Leaf
$soundPath = Join-Path $packDir "sounds\$soundFile"

if (-not (Test-Path $soundPath)) { exit 0 }

# Icon resolution chain (CESP ??5.5)
$iconPath = ""
$iconCandidate = ""
if ($chosen.icon) { $iconCandidate = $chosen.icon }
elseif ($manifest.categories.$category.icon) { $iconCandidate = $manifest.categories.$category.icon }
elseif ($manifest.icon) { $iconCandidate = $manifest.icon }
elseif (Test-Path (Join-Path $packDir "icon.png")) { $iconCandidate = "icon.png" }
if ($iconCandidate) {
    $resolved = [System.IO.Path]::GetFullPath((Join-Path $packDir $iconCandidate))
    $packRoot = [System.IO.Path]::GetFullPath($packDir) + [System.IO.Path]::DirectorySeparatorChar
    if ($resolved.StartsWith($packRoot) -and (Test-Path $resolved -PathType Leaf)) {
        $iconPath = $resolved
    }
}

# Save last played
$state[$lastKey] = $soundFile
try {
    Write-StateAtomic -State $state -Path $StatePath
} catch {}

# --- Delegate audio to win-play.ps1 in a detached process ---
$volume = $config.volume
if (-not $volume) { $volume = 0.5 }

$winPlayScript = Join-Path $InstallDir "scripts\win-play.ps1"
if (Test-Path $winPlayScript) {
    Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile", "-NonInteractive", "-File", $winPlayScript, "-path", $soundPath, "-vol", $volume -WindowStyle Hidden
}

exit 0
