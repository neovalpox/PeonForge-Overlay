# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is PeonForge

A Windows desktop notification overlay built with Electron. It displays animated Warcraft III characters (Peasant/Peon) with French voice lines when Claude Code finishes tasks. Runs as a system tray app with an HTTP API. Integrates with Claude Code hooks via `peon.ps1` which forwards all hook events to the overlay. Includes a mobile companion app (Flutter/Android) and a web leaderboard (peonforge.ch).

## Setup

```
npm install            # Install Node dependencies
npm run setup          # Install all prerequisites (cloudflared, ffplay)
npm run install-hooks  # Install Claude Code hooks + sound packs
```

### Prerequisites

- **Node.js** + **npm**
- **cloudflared** — Required for remote mobile access over internet (Cloudflare Tunnel). Install: `winget install Cloudflare.cloudflared`
- **ffplay** (optional) — For volume-controlled sound playback. Install: `winget install Gyan.FFmpeg`

The `npm run setup` script checks and installs these automatically via winget.

## Commands

- `npm start` — Run the app in dev mode (launches Electron)
- `npm run setup` — Install prerequisites (cloudflared, ffplay)
- `npm run install-hooks` — Install Claude Code hooks and sound packs to `~/.claude/hooks/peon-ping/`
- `npm run dist` — Build a Windows NSIS installer to `dist/`

No test framework or linter is configured.

## Architecture

### Layers

1. **Main process (`main.cjs`)** — System tray, HTTP+WebSocket server (port 7777), session tracking, tamagotchi state, IPC, progress/notification window management, focus-terminal, PeonForge leaderboard sync, cloudflared tunnel, QR pairing.
2. **Companion window (`companion.html` + `preload-companion.cjs`)** — Persistent tamagotchi widget (bottom-right) with XP/level/gold, mood animations, activity log, multi-session avatars. Always on top, draggable.
3. **Overlay window (`overlay.html` + `preload.cjs`)** — WC3-style celebration notification (top-right) on task completion. Auto-closes after 12s. Click switches to the terminal's virtual desktop. Draggable.
4. **Progress window (`progress.html` + `preload-progress.cjs`)** — Compact progress bar with colored event pips, mini-log, elapsed timer.
5. **Settings window (`settings.html` + `preload-settings.cjs`)** — Tray-accessible panel for faction, volume, sound toggle, history.
6. **Pairing window (`pairing.html` + `preload-pairing.cjs`)** — QR code display for mobile app pairing (LAN + cloudflared tunnel).

### Integration with Claude Code

The hook `~/.claude/hooks/peon-ping/peon.ps1` is called by Claude Code on all events. It:
1. Plays the appropriate sound via `scripts/win-play.ps1` (using ffplay for volume control)
2. Forwards the event as HTTP POST to `localhost:7777/event` with `{hook_event, raw_event, session_id, project, project_path}`
3. On SessionStart, if the overlay isn't running, auto-starts it using `~/.peonping-overlay/app.json`

### HTTP API (port 7777, bound to 0.0.0.0 for LAN access)

- `POST /event` — Hook event forwarding (main integration point)
- `POST /notify` — Direct notification trigger (`{project, faction?}`)
- `GET /status` — App state including active sessions, level
- `POST /config` — Update settings
- `GET /discover` — Network discovery for mobile app (`{app, version, hostname}`)
- `GET /tamagotchi` — Tamagotchi stats + mood
- `GET /sessions` — Active sessions list
- `WebSocket /` — Real-time push to mobile app (full-state on connect, updates on events)

### Mobile commands via WebSocket

- `set-config` — Change faction, volume, sound, watching
- `test-notification` — Trigger test overlay + sound
- `focus-terminal` — Focus a specific terminal window on the PC (switches virtual desktop)

### Click-to-focus

Clicking any notification/progress/companion widget runs `scripts/focus-terminal.ps1` which uses Win32 `SetForegroundWindow`. This automatically switches virtual desktops on Windows 10/11.

### Persistent state

All stored in `~/.peonping-overlay/`:
- `config.json` — faction, volume, soundEnabled, watching
- `tamagotchi.json` — xp, gold, tasksCompleted, errorsEncountered, totalWorkTime
- `history.json` — last 50 notifications
- `app.json` — Electron path for auto-start
- `forge.json` — PeonForge leaderboard token + URL

### Faction system

Two factions: **Human** (Peasant, cyan) and **Orc** (Peon, red). Each has its own GIF portrait, voice pack, messages, and colors. Changing faction also updates `~/.claude/hooks/peon-ping/config.json`.

### Sound system

Uses `win-play.ps1` which prioritizes ffplay (supports volume control) over SoundPlayer. Sound packs with `openpeon.json` manifests in `~/.claude/hooks/peon-ping/packs/`. French WC3 sounds extracted from Warcraft III Reforged via `scripts/extract-wc3-sounds.cjs` (CascLib).

### PeonForge leaderboard sync

`main.cjs` syncs tamagotchi stats to `peonforge.ch/api/sync` every 5 minutes and immediately after each task completion. Auth via Bearer token stored in `forge.json`.
