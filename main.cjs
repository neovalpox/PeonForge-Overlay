const { app, BrowserWindow, Tray, Menu, screen, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const os = require('os');
const http = require('http');

let tray = null;
let overlayWindow = null;
let settingsWindow = null;
let serverInstance = null;
let faction = 'human';
let volume = 0.7;
let watching = true;
let soundEnabled = true;
let notifCount = 0;

const CONFIG_DIR = path.join(os.homedir(), '.peonping-overlay');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const HISTORY_FILE = path.join(CONFIG_DIR, 'history.json');
const PEON_BIN = path.join(os.homedir(), '.local', 'bin', 'peon');

// ─── Single Instance ──────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  return;
}
app.on('second-instance', () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.focus();
  else openSettings();
});

// ─── Config ───────────────────────────────────────
function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    if (fs.existsSync(CONFIG_FILE)) {
      const c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      faction = c.faction || 'human';
      volume = c.volume ?? 0.7;
      soundEnabled = c.soundEnabled !== false;
      watching = c.watching !== false;
    }
  } catch {}
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ faction, volume, soundEnabled, watching }, null, 2));
  } catch {}
}

function addHistory(project) {
  try {
    let history = [];
    if (fs.existsSync(HISTORY_FILE)) history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    history.unshift({ project, faction, time: new Date().toISOString() });
    if (history.length > 50) history.length = 50;
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch {}
}

// ─── Tray Icon ────────────────────────────────────
function createTrayIcon() {
  // Build a proper 32x32 icon with a pickaxe/peon visual
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  // Peon face simplified: green/skin circle with eyes
  const isOrc = faction === 'orc';
  const skinR = isOrc ? 0x7a : 0xf5, skinG = isOrc ? 0xb6 : 0xc5, skinB = isOrc ? 0x48 : 0xa3;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - 16, dy = y - 16;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const off = (y * size + x) * 4;

      if (dist < 13) {
        // Face
        buf[off] = skinR; buf[off + 1] = skinG; buf[off + 2] = skinB; buf[off + 3] = 255;
        // Eyes
        if ((Math.abs(dx - 4) < 2 && Math.abs(dy + 2) < 2) || (Math.abs(dx + 4) < 2 && Math.abs(dy + 2) < 2)) {
          buf[off] = 20; buf[off + 1] = 20; buf[off + 2] = 20;
        }
        // Mouth
        if (dy > 3 && dy < 6 && Math.abs(dx) < 4) {
          buf[off] = 30; buf[off + 1] = 30; buf[off + 2] = 30;
        }
      } else if (dist < 15) {
        // Border
        buf[off] = 0; buf[off + 1] = 240; buf[off + 2] = 255; buf[off + 3] = 200;
      } else {
        buf[off + 3] = 0;
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

function createTray() {
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip(`PeonPing Overlay — ${faction === 'human' ? 'Humain' : 'Orc'}`);
  updateTrayMenu();

  tray.on('click', () => openSettings());
  tray.on('double-click', () => openSettings());
}

function updateTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: `PeonPing Overlay (${notifCount} notifs)`, enabled: false },
    { type: 'separator' },
    { label: 'Ouvrir les parametres', click: openSettings },
    { label: 'Tester la notification', click: () => { showOverlay('TestProject', faction); playPeonSound(); } },
    { type: 'separator' },
    {
      label: 'Faction',
      submenu: [
        { label: 'Humain (Paysan)', type: 'radio', checked: faction === 'human', click: () => { setFaction('human'); } },
        { label: 'Orc (Peon)', type: 'radio', checked: faction === 'orc', click: () => { setFaction('orc'); } },
      ]
    },
    { label: soundEnabled ? 'Son active' : 'Son desactive', click: () => { soundEnabled = !soundEnabled; saveConfig(); updateTrayMenu(); } },
    { label: watching ? 'En ecoute' : 'En pause', click: () => { watching = !watching; saveConfig(); updateTrayMenu(); } },
    { type: 'separator' },
    { label: 'Quitter', click: () => { app.quit(); } }
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(`PeonPing Overlay — ${faction === 'human' ? 'Humain' : 'Orc'} — ${watching ? 'Actif' : 'Pause'}`);
}

function setFaction(f) {
  faction = f;
  saveConfig();
  tray.setImage(createTrayIcon());
  updateTrayMenu();
  // Also update peon-ping config
  try {
    const ppConfig = path.join(os.homedir(), '.claude', 'hooks', 'peon-ping', 'config.json');
    if (fs.existsSync(ppConfig)) {
      const cfg = JSON.parse(fs.readFileSync(ppConfig, 'utf-8'));
      cfg.active_pack = f === 'orc' ? 'peon' : 'peasant';
      fs.writeFileSync(ppConfig, JSON.stringify(cfg, null, 4));
    }
  } catch {}
  // Update settings window if open
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('config-update', { faction, volume, soundEnabled, watching });
  }
}

// ─── Settings Window ──────────────────────────────
function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 480,
    height: 620,
    resizable: false,
    frame: false,
    transparent: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload-settings.cjs')
    }
  });

  settingsWindow.loadFile('settings.html', {
    query: {
      faction,
      volume: String(volume),
      soundEnabled: String(soundEnabled),
      watching: String(watching),
      notifCount: String(notifCount)
    }
  });

  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ─── Sound ────────────────────────────────────────
function playPeonSound() {
  if (!soundEnabled) return;
  try {
    if (fs.existsSync(PEON_BIN) || fs.existsSync(PEON_BIN + '.cmd')) {
      exec(`"${PEON_BIN}" preview task.complete`, { timeout: 5000 });
    }
  } catch {}
}

// ─── Overlay Window ───────────────────────────────
function showOverlay(project, fac) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
    overlayWindow = null;
  }

  notifCount++;
  addHistory(project);
  updateTrayMenu();

  const display = screen.getPrimaryDisplay();
  const { width: sw } = display.workAreaSize;
  const w = 460, h = 140;

  overlayWindow = new BrowserWindow({
    width: w, height: h,
    x: sw - w - 24, y: 24,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  const p = encodeURIComponent(project);
  const f = encodeURIComponent(fac);
  overlayWindow.loadFile('overlay.html', { query: { project: p, faction: f } });
  overlayWindow.on('closed', () => { overlayWindow = null; });

  setTimeout(() => {
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
  }, 12000);
}

// ─── HTTP Server ──────────────────────────────────
function startServer() {
  const triggerFile = path.join(CONFIG_DIR, 'trigger.json');
  let lastEventTime = Date.now();

  // File watcher
  setInterval(() => {
    if (!watching) return;
    try {
      if (!fs.existsSync(triggerFile)) return;
      const stat = fs.statSync(triggerFile);
      if (stat.mtimeMs > lastEventTime) {
        lastEventTime = Date.now();
        const data = JSON.parse(fs.readFileSync(triggerFile, 'utf-8'));
        showOverlay(data.project || 'Projet', data.faction || faction);
        playPeonSound();
      }
    } catch {}
  }, 1000);

  // HTTP server
  serverInstance = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    if (req.method === 'POST' && req.url === '/notify') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (watching) {
            showOverlay(data.project || 'Projet', data.faction || faction);
            playPeonSound();
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        } catch {
          res.writeHead(400);
          res.end('{"error":"bad json"}');
        }
      });
    } else if (req.method === 'GET' && req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ running: true, faction, watching, soundEnabled, notifCount }));
    } else if (req.method === 'POST' && req.url === '/config') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.faction) setFaction(data.faction);
          if (data.volume !== undefined) { volume = data.volume; saveConfig(); }
          if (data.soundEnabled !== undefined) { soundEnabled = data.soundEnabled; saveConfig(); updateTrayMenu(); }
          if (data.watching !== undefined) { watching = data.watching; saveConfig(); updateTrayMenu(); }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        } catch {
          res.writeHead(400);
          res.end('{"error":"bad json"}');
        }
      });
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  });

  serverInstance.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log('[PeonPing] Port 7777 busy, trying 7778...');
      serverInstance.listen(7778, '127.0.0.1');
    }
  });
  serverInstance.listen(7777, '127.0.0.1', () => {
    console.log('[PeonPing] HTTP server on http://127.0.0.1:7777');
  });
}

// ─── IPC ──────────────────────────────────────────
ipcMain.on('close-overlay', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
});

ipcMain.on('focus-neonhub', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
});

ipcMain.on('settings:set-faction', (e, f) => setFaction(f));
ipcMain.on('settings:set-sound', (e, v) => { soundEnabled = v; saveConfig(); updateTrayMenu(); });
ipcMain.on('settings:set-watching', (e, v) => { watching = v; saveConfig(); updateTrayMenu(); });
ipcMain.on('settings:set-volume', (e, v) => { volume = v; saveConfig(); });
ipcMain.on('settings:test', () => { showOverlay('TestProject', faction); playPeonSound(); });
ipcMain.on('settings:close', () => { if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close(); });
ipcMain.on('settings:get-history', (e) => {
  try {
    if (fs.existsSync(HISTORY_FILE)) e.returnValue = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    else e.returnValue = [];
  } catch { e.returnValue = []; }
});

// ─── App ──────────────────────────────────────────
app.whenReady().then(() => {
  loadConfig();
  createTray();
  startServer();
  console.log('[PeonPing] Ready! Faction:', faction);
});

app.on('window-all-closed', (e) => e.preventDefault());
