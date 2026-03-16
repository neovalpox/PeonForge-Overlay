const { app, BrowserWindow, Tray, Menu, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync, exec } = require('child_process');
const os = require('os');

let tray = null;
let overlayWindow = null;
let faction = 'human'; // default
let volume = 0.7;
let watching = true;

// Config
const CONFIG_DIR = path.join(os.homedir(), '.peonping-overlay');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const PEON_DIR = path.join(os.homedir(), '.claude', 'hooks', 'peon-ping');

function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    if (fs.existsSync(CONFIG_FILE)) {
      const c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      faction = c.faction || 'human';
      volume = c.volume ?? 0.7;
    }
  } catch {}
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ faction, volume }, null, 2));
  } catch {}
}

// ─── Watch peon-ping hooks for Claude events ──────
// We watch the peon-ping sessions/log to detect when Claude finishes
// Alternative: poll Claude terminals or watch a trigger file

let lastEventTime = Date.now();

function startWatcher() {
  // Create a trigger file that NeonHub or Claude hooks can write to
  const triggerFile = path.join(CONFIG_DIR, 'trigger.json');

  // Poll the trigger file for new events
  setInterval(() => {
    if (!watching) return;
    try {
      if (!fs.existsSync(triggerFile)) return;
      const stat = fs.statSync(triggerFile);
      if (stat.mtimeMs > lastEventTime) {
        lastEventTime = Date.now();
        const data = JSON.parse(fs.readFileSync(triggerFile, 'utf-8'));
        showOverlay(data.project || 'Projet', data.faction || faction);
        // Play peon-ping sound
        playPeonSound();
      }
    } catch {}
  }, 1000);

  // Also set up a tiny HTTP server for direct triggers
  const http = require('http');
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/notify') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          showOverlay(data.project || 'Projet', data.faction || faction);
          playPeonSound();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        } catch {
          res.writeHead(400);
          res.end('{"error":"bad json"}');
        }
      });
    } else if (req.method === 'GET' && req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ running: true, faction, watching }));
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log('[PeonPing Overlay] Port 7777 busy, trying 7778...');
      server.listen(7778, '127.0.0.1');
    } else {
      console.error('[PeonPing Overlay] Server error:', err.message);
    }
  });
  server.listen(7777, '127.0.0.1', () => {
    console.log('[PeonPing Overlay] Listening on http://127.0.0.1:7777');
  });
}

function playPeonSound() {
  try {
    const peonBin = path.join(os.homedir(), '.local', 'bin', 'peon');
    if (fs.existsSync(peonBin) || fs.existsSync(peonBin + '.cmd')) {
      exec(`"${peonBin}" preview task.complete`, { timeout: 5000 });
    }
  } catch {}
}

// ─── Overlay Window ───────────────────────────────
function showOverlay(project, fac) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
    overlayWindow = null;
  }

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

  // Auto close
  setTimeout(() => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.close();
    }
  }, 12000);
}

// ─── IPC ──────────────────────────────────────────
ipcMain.on('close-overlay', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
});

ipcMain.on('focus-neonhub', () => {
  // Try to focus NeonHub window
  try {
    if (process.platform === 'win32') {
      exec('powershell -Command "(Get-Process NeonHub -ErrorAction SilentlyContinue | Select-Object -First 1).MainWindowHandle | ForEach-Object { [void][System.Runtime.InteropServices.Marshal]::GetLastWin32Error() }"');
    }
  } catch {}
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
});

// ─── Tray Icon ────────────────────────────────────
function createTray() {
  // Generate a simple tray icon if not exists
  const iconPath = path.join(__dirname, 'tray-icon.png');
  if (!fs.existsSync(iconPath)) {
    // Create a tiny 16x16 PNG programmatically
    generateTrayIcon(iconPath);
  }

  tray = new Tray(iconPath);

  function buildMenu() {
    return Menu.buildFromTemplate([
      { label: 'PeonPing Overlay', enabled: false },
      { type: 'separator' },
      {
        label: `Faction: ${faction === 'human' ? 'Humain' : 'Orc'}`,
        submenu: [
          { label: 'Humain (Paysan)', type: 'radio', checked: faction === 'human', click: () => { faction = 'human'; saveConfig(); tray.setContextMenu(buildMenu()); } },
          { label: 'Orc (Peon)', type: 'radio', checked: faction === 'orc', click: () => { faction = 'orc'; saveConfig(); tray.setContextMenu(buildMenu()); } },
        ]
      },
      { label: 'Tester la notification', click: () => showOverlay('TestProject', faction) },
      { type: 'separator' },
      { label: watching ? 'Pause' : 'Reprendre', click: () => { watching = !watching; tray.setContextMenu(buildMenu()); } },
      { type: 'separator' },
      { label: 'Quitter', click: () => app.quit() }
    ]);
  }

  tray.setToolTip('PeonPing Overlay');
  tray.setContextMenu(buildMenu());
  tray.on('click', () => showOverlay('TestProject', faction));
}

function generateTrayIcon(filepath) {
  // Create a minimal 32x32 PNG with a pickaxe emoji placeholder
  // We'll use a simple canvas approach via Electron's nativeImage
  const { nativeImage } = require('electron');
  const canvas = Buffer.alloc(32 * 32 * 4);
  // Draw a simple blue/cyan circle
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const dx = x - 16, dy = y - 16;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const offset = (y * 32 + x) * 4;
      if (dist < 14) {
        canvas[offset] = 0;     // R
        canvas[offset + 1] = 240; // G
        canvas[offset + 2] = 255; // B
        canvas[offset + 3] = dist < 12 ? 255 : 128; // A
      } else {
        canvas[offset + 3] = 0; // transparent
      }
    }
  }
  const img = nativeImage.createFromBuffer(canvas, { width: 32, height: 32 });
  fs.writeFileSync(filepath, img.toPNG());
}

// ─── App ──────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log('[PeonPing Overlay] Another instance is already running. Quitting.');
  app.quit();
} else {
  app.on('second-instance', () => {
    // Second instance tried to start — show a test notification instead
    showOverlay('PeonPing', faction);
  });

  app.whenReady().then(() => {
    loadConfig();
    createTray();
    startWatcher();
    console.log('[PeonPing Overlay] Ready! Faction:', faction);
    console.log('[PeonPing Overlay] HTTP trigger: POST http://127.0.0.1:7777/notify');
    console.log('[PeonPing Overlay] File trigger:', path.join(CONFIG_DIR, 'trigger.json'));
  });

  app.on('window-all-closed', (e) => {
    e.preventDefault(); // Keep running in tray
  });
}
