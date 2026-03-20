# PeonForge Overlay

Overlay desktop Windows pour Claude Code. Un compagnon Warcraft III qui vit sur ton ecran, reagit a tes sessions Claude, et te notifie avec les vraies voix du jeu.

> *"Something need doing?"*

## Installation

### Prerequis

- Windows 10/11
- [Node.js](https://nodejs.org/) 18+
- [Warcraft III Reforged](https://shop.battle.net/) (pour les voix FR, optionnel)
- [Claude Code](https://claude.ai/code)

### 1. Clone et installe

```bash
git clone https://github.com/neovalpox/PeonForge-Overlay
cd PeonForge-Overlay
npm install
```

### 2. Lance l'overlay

```bash
npm start
```

L'overlay apparait dans le system tray. Un compagnon WC3 s'affiche en bas a droite.

### 3. Configure les hooks Claude Code

Les hooks permettent a Claude Code de communiquer avec PeonForge. Copie la config suivante dans `~/.claude/settings.json` (section `hooks`) :

```json
{
  "hooks": {
    "Notification": [{ "matcher": "", "hooks": [{ "type": "command", "command": "powershell -NoProfile -NonInteractive -File \"C:\\Users\\<TON_USER>\\.claude\\hooks\\peon-ping\\peon.ps1\"", "timeout": 10 }] }],
    "Stop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "powershell -NoProfile -NonInteractive -File \"C:\\Users\\<TON_USER>\\.claude\\hooks\\peon-ping\\peon.ps1\"", "timeout": 10 }] }],
    "SessionStart": [{ "matcher": "", "hooks": [{ "type": "command", "command": "powershell -NoProfile -NonInteractive -File \"C:\\Users\\<TON_USER>\\.claude\\hooks\\peon-ping\\peon.ps1\"", "timeout": 10 }] }],
    "SubagentStart": [{ "matcher": "", "hooks": [{ "type": "command", "command": "powershell -NoProfile -NonInteractive -File \"C:\\Users\\<TON_USER>\\.claude\\hooks\\peon-ping\\peon.ps1\"", "timeout": 10 }] }],
    "PermissionRequest": [{ "matcher": "", "hooks": [{ "type": "command", "command": "powershell -NoProfile -NonInteractive -File \"C:\\Users\\<TON_USER>\\.claude\\hooks\\peon-ping\\peon.ps1\"", "timeout": 10 }] }]
  }
}
```

Remplace `<TON_USER>` par ton nom d'utilisateur Windows.

### 4. Renomme tes terminaux Claude

Pour que PeonForge identifie chaque terminal, renomme-les avec :

```
/rename MonProjet
```

Chaque fenetre Windows Terminal apparaitra dans l'app mobile avec son nom.

### 5. Connecte l'app mobile (optionnel)

1. Installe [PeonForge Mobile](https://github.com/neovalpox/PeonForge-Mobile) sur Android
2. Clic droit sur le tray PeonForge > "Connecter mobile (QR)"
3. Scanne le QR code avec l'app mobile

### 6. Extraire les voix WC3 (optionnel)

Si tu as Warcraft III Reforged installe :

```bash
node scripts/extract-characters.cjs
```

Ca extrait 36 personnages avec 819 fichiers sonores en francais.

## Features

- Compagnon Tamagotchi always-on-top avec XP, Or, niveaux
- Notifications WC3 avec portraits HD et voix francaises
- 36 personnages deblocables (Arthas, Thrall, Illidan, Jaina...)
- Terminal distant depuis le mobile
- Multi-sessions avec detection automatique des terminaux
- Alliance vs Horde
- Leaderboard mondial sur [peonforge.ch](https://peonforge.ch)
- Tunnel Cloudflare pour acces distant (4G/5G)
- QR code pairing avec l'app mobile

## Build l'installateur

```bash
npm run dist
```

Cree un installateur NSIS dans `dist/`.

## Repos lies

- [PeonForge-Overlay](https://github.com/neovalpox/PeonForge-Overlay) — Ce repo (Electron desktop)
- [PeonForge-Mobile](https://github.com/neovalpox/PeonForge-Mobile) — App Flutter Android

## Site

[peonforge.ch](https://peonforge.ch) — Leaderboard, personnages, telechargement APK

---

100% vibecoded avec Claude Code — 100% inutile, donc indispensable — *Work, work.*
