const { app, BrowserWindow, Tray, Menu, screen, ipcMain, nativeImage, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const os = require('os');
const http = require('http');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

let tray = null;
let overlayWindow = null;
let pairingWindow = null;
let tunnelInstance = null;
let tunnelUrl = null;
let companionWindow = null;
let settingsWindow = null;
let serverInstance = null;
let faction = 'human';
let side = 'alliance';
let showCompanionWidget = true;  // toggle peon overlay
let companionMini = false;       // mini mode: smaller, portrait only
let showNotifications = true;    // toggle WC3 notifications
let volume = 0.7;
let watching = true;
let soundEnabled = true;
let notifCount = 0;

// Session tracking
const sessions = new Map();
const recentEvents = []; // global recent events (max 30)
const MAX_RECENT = 30;
let sessionCharCounter = 0;

// Character pool for multi-session avatars
const CHARACTERS = [
  { id: 'peasant_fr', name: 'Paysan', gif: 'assets/peasant.gif', color: '#64c8ff' },
  { id: 'peon_fr', name: 'Peon', gif: 'assets/peon.gif', color: '#ff6644' },
];

// Tamagotchi state
let tamagotchi = {
  xp: 0, gold: 0,
  tasksCompleted: 0, errorsEncountered: 0,
  totalWorkTime: 0, // seconds
  lastActivity: 0,  // timestamp
  happiness: 50,     // 0-100
  lastFed: 0,        // timestamp
  lastPet: 0,        // timestamp
  xpBoostUntil: 0,   // timestamp (boost active until)
  dailySteps: 0,     // steps today from mobile pedometer
  stepsDate: '',     // YYYY-MM-DD to reset daily
};

const CONFIG_DIR = path.join(os.homedir(), '.peonping-overlay');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const HISTORY_FILE = path.join(CONFIG_DIR, 'history.json');
const TAMA_FILE = path.join(CONFIG_DIR, 'tamagotchi.json');
const APP_JSON = path.join(CONFIG_DIR, 'app.json');
const PEON_BIN = path.join(os.homedir(), '.local', 'bin', 'peon');
const CAPTURES_DIR = path.join(CONFIG_DIR, 'captures');
const CHARACTERS_FILE = path.join(__dirname, 'characters.json');
const CHAR_ASSIGNMENTS_FILE = path.join(CONFIG_DIR, 'character-assignments.json');

// Persistent character assignments per project
let charAssignments = {};
try {
  if (fs.existsSync(CHAR_ASSIGNMENTS_FILE)) {
    charAssignments = JSON.parse(fs.readFileSync(CHAR_ASSIGNMENTS_FILE, 'utf-8'));
  }
} catch {}

function saveCharAssignments() {
  try { fs.writeFileSync(CHAR_ASSIGNMENTS_FILE, JSON.stringify(charAssignments, null, 2)); } catch {}
}

function getCharacterForProject(project) {
  const packId = charAssignments[project];
  if (!packId) return null;
  const charInfo = characterCatalog.find(c => c.id === packId);
  if (!charInfo) return null;
  const fc = { orc: '#ff6644', nightelf: '#b482ff', undead: '#5aff5a', naga: '#00ccaa', neutral: '#ffc832' };
  return { id: packId, name: charInfo.name, gif: `assets/icons/${packId}.png`, color: fc[charInfo.faction] || '#64c8ff' };
}

// Side mapping (must be before character loading)
const ALLIANCE_FACTIONS = ['human', 'nightelf'];
const HORDE_FACTIONS = ['orc', 'undead', 'naga', 'neutral'];
function factionToSide(f) { return ALLIANCE_FACTIONS.includes(f) ? 'alliance' : 'horde'; }
function sideToFaction(s) { return s === 'horde' ? 'orc' : 'human'; }

// Load character catalog
let characterCatalog = [];
try {
  if (fs.existsSync(CHARACTERS_FILE)) {
    characterCatalog = JSON.parse(fs.readFileSync(CHARACTERS_FILE, 'utf-8'))
      .filter(c => c.status === 'ok' || c.status === 'already_exists')
      .map(c => ({
        id: c.packName || (c.unit.toLowerCase() + '_fr'),
        name: c.name,
        race: c.race,
        faction: c.faction,
        side: ALLIANCE_FACTIONS.includes(c.faction) ? 'alliance' : 'horde',
        unlockLevel: c.unlockLevel,
        sounds: c.sounds || 0,
        tier: c.unlockLevel <= 1 ? 'starter' : c.unlockLevel <= 10 ? 'common' : c.unlockLevel <= 20 ? 'rare' : c.unlockLevel <= 30 ? 'epic' : c.unlockLevel <= 40 ? 'legendary' : 'mythic',
      }));
  }
} catch {}
console.log(`[PeonForge] ${characterCatalog.length} characters loaded`);

// (Side mapping moved above character loading)
const FOCUS_SCRIPT = path.join(__dirname, 'scripts', 'focus-terminal.ps1');
const FORGE_CONFIG = path.join(CONFIG_DIR, 'forge.json');
const AUTH_FILE = path.join(CONFIG_DIR, 'auth.json');

// ─── Auth Token ───────────────────────────────────
let authToken = '';
function loadOrCreateAuth() {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      const a = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
      authToken = a.token || '';
    }
    if (!authToken) {
      authToken = require('crypto').randomBytes(32).toString('hex');
      fs.writeFileSync(AUTH_FILE, JSON.stringify({ token: authToken }, null, 2));
      console.log('[PeonForge] New auth token generated');
    }
  } catch {}
}
loadOrCreateAuth();

function checkAuth(req) {
  // Check Authorization header or ?token= query param
  const auth = req.headers?.authorization?.replace('Bearer ', '') || '';
  if (auth === authToken) return true;
  const url = req.url || '';
  const tokenMatch = url.match(/[?&]token=([^&]+)/);
  if (tokenMatch && tokenMatch[1] === authToken) return true;
  return false;
}

// List of endpoints that don't require auth (public)
const PUBLIC_ENDPOINTS = ['/discover', '/status'];

// PeonForge sync
let forgeToken = null;
let forgeUrl = 'https://peonforge.ch';
let forgeUsername = '';
let forgeAvatar = ''; // character pack id for site display
let forgeAchievements = []; // achievements received from forge sync
let dailySummarySentDate = ''; // YYYY-MM-DD to avoid sending daily summary twice

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
      side = c.side || factionToSide(faction);
      volume = c.volume ?? 0.7;
      showCompanionWidget = c.showCompanion !== false;
      showNotifications = c.showNotifications !== false;
      companionMini = c.companionMini === true;
      soundEnabled = c.soundEnabled !== false;
      watching = c.watching !== false;
    }
  } catch {}
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ faction, side, volume, soundEnabled, watching, showCompanion: showCompanionWidget, showNotifications, companionMini }, null, 2));
  } catch {}
}

function syncVolumeToHooks() {
  try {
    const ppConfig = path.join(os.homedir(), '.claude', 'hooks', 'peon-ping', 'config.json');
    if (fs.existsSync(ppConfig)) {
      const raw = fs.readFileSync(ppConfig, 'utf-8');
      const volStr = volume.toFixed(2);
      const updated = raw.replace(/"volume"\s*:\s*[\d.]+/, `"volume": ${volStr}`);
      fs.writeFileSync(ppConfig, updated);
    }
  } catch {}
}

function saveAppJson() {
  try {
    fs.writeFileSync(APP_JSON, JSON.stringify({
      app_path: __dirname,
      electron_path: process.execPath,
      pid: process.pid
    }, null, 2));
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

// ─── Tamagotchi ───────────────────────────────────
function loadTamagotchi() {
  try {
    if (fs.existsSync(TAMA_FILE)) {
      Object.assign(tamagotchi, JSON.parse(fs.readFileSync(TAMA_FILE, 'utf-8')));
    }
  } catch {}
}

function saveTamagotchi() {
  try {
    fs.writeFileSync(TAMA_FILE, JSON.stringify(tamagotchi, null, 2));
  } catch {}
}

function getLevel(xp) {
  // Level 1: 0, Level 2: 50, Level 3: 200, Level 4: 450, Level 5: 800...
  return Math.floor(Math.sqrt(xp / 50)) + 1;
}

function getLevelXP(level) {
  return (level - 1) * (level - 1) * 50;
}

function addXP(xp, gold) {
  // XP boost from training (+20%)
  if (tamagotchi.xpBoostUntil > Date.now()) xp = Math.round(xp * 1.2);
  // Happiness bonus: +10% gold if happiness > 80
  if (getHappiness() > 80) gold = Math.round(gold * 1.1);
  // Happiness penalty: -50% XP if happiness == 0
  if (getHappiness() === 0) xp = Math.round(xp * 0.5);
  const prevLevel = getLevel(tamagotchi.xp);
  tamagotchi.xp += xp;
  tamagotchi.gold = Math.max(0, tamagotchi.gold + gold);
  tamagotchi.lastActivity = Date.now();
  const newLevel = getLevel(tamagotchi.xp);
  saveTamagotchi();

  // Easter eggs — special celebrations at milestones
  if (newLevel > prevLevel) {
    const milestones = { 10: 'Apprenti !', 25: 'Veteran !', 50: 'Maitre !', 100: 'Legende !' };
    if (milestones[newLevel]) {
      console.log(`[PeonForge] MILESTONE: Level ${newLevel} — ${milestones[newLevel]}`);
      showOverlay(`Niveau ${newLevel} — ${milestones[newLevel]}`, faction, forgeAvatar || (faction === 'orc' ? 'peon_fr' : 'peasant_fr'));
      playSound('task.complete');
      setTimeout(() => { playSound('task.complete'); }, 1500);
      pushCompanionUpdate({ milestone: { level: newLevel, title: milestones[newLevel] } });
    }
  }

  // Task milestones
  const taskMilestones = { 100: 'Centurion !', 500: 'Commander !', 1000: 'Maitre des taches !', 5000: 'Legendaire !' };
  if (taskMilestones[tamagotchi.tasksCompleted]) {
    const title = taskMilestones[tamagotchi.tasksCompleted];
    console.log(`[PeonForge] MILESTONE: ${tamagotchi.tasksCompleted} tasks — ${title}`);
    showOverlay(`${tamagotchi.tasksCompleted} taches — ${title}`, faction, forgeAvatar || (faction === 'orc' ? 'peon_fr' : 'peasant_fr'));
    pushCompanionUpdate({ milestone: { tasks: tamagotchi.tasksCompleted, title } });
  }
}

function getMood() {
  const now = Date.now();
  const active = [...sessions.values()].filter(s => s.status !== 'done');
  if (active.length > 0) return 'working';
  const elapsed = now - tamagotchi.lastActivity;
  if (elapsed < 2 * 60 * 1000) return 'happy';     // < 2min since last activity
  if (elapsed < 30 * 60 * 1000) return 'idle';      // < 30min
  return 'sleeping';
}

function getHappiness() {
  // Happiness = daily steps / 100, capped at 100 (10,000 steps = 100%)
  const today = new Date().toISOString().slice(0, 10);
  if (tamagotchi.stepsDate !== today) {
    tamagotchi.dailySteps = 0;
    tamagotchi.stepsDate = today;
  }
  return Math.max(0, Math.min(100, Math.floor(tamagotchi.dailySteps / 100)));
}

function applyHappinessDecay() {
  // No more decay — happiness is purely step-based now
  tamagotchi.happiness = getHappiness();
}

// ─── Claude Usage Stats (ccusage) ────────────────
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
let cachedUsage = { totalTokens: 0, totalCost: 0, todayTokens: 0, todayCost: 0, lastUpdate: 0 };

function parseClaudeUsage() {
  try {
    const projectsDir = path.join(CLAUDE_DIR, 'projects');
    if (!fs.existsSync(projectsDir)) return cachedUsage;

    // Only refresh every 5 min
    if (Date.now() - cachedUsage.lastUpdate < 300000) return cachedUsage;

    const today = new Date().toISOString().slice(0, 10);
    let totalTokens = 0, totalCost = 0, todayTokens = 0, todayCost = 0;

    // Pricing per token (approximate, Opus 4.6 rates)
    const pricing = {
      input: 15 / 1e6, output: 75 / 1e6,
      cacheWrite: 3.75 / 1e6, cacheRead: 0.30 / 1e6,
    };

    const dirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const dir of dirs) {
      const projPath = path.join(projectsDir, dir.name);
      const files = fs.readdirSync(projPath).filter(f => f.endsWith('.jsonl'));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(projPath, file), 'utf-8');
          const lines = content.split('\n').filter(l => l.includes('"usage"'));
          for (const line of lines) {
            try {
              const obj = JSON.parse(line);
              const u = obj?.message?.usage || obj?.usage;
              if (!u) continue;
              const inp = u.input_tokens || 0;
              const out = u.output_tokens || 0;
              const cw = u.cache_creation_input_tokens || 0;
              const cr = u.cache_read_input_tokens || 0;
              const tokens = inp + out + cw + cr;
              const cost = inp * pricing.input + out * pricing.output + cw * pricing.cacheWrite + cr * pricing.cacheRead;
              totalTokens += tokens;
              totalCost += cost;

              // Check if today
              const ts = obj.timestamp;
              if (ts) {
                const d = new Date(ts).toISOString().slice(0, 10);
                if (d === today) { todayTokens += tokens; todayCost += cost; }
              }
            } catch {}
          }
        } catch {}
      }
    }

    // Calculate week and month boundaries
    const now = new Date();
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); // Sunday
    const weekStr = weekStart.toISOString().slice(0, 10);
    const monthStr = now.toISOString().slice(0, 7); // YYYY-MM

    let weekTokens = 0, weekCost = 0, monthTokens = 0, monthCost = 0;
    // Re-scan with date grouping (we already parsed everything above)
    // Use a second pass on the lines we already found
    // Actually let's track per-date costs during the main loop above
    // For simplicity, estimate from the daily totals
    // The main loop already computed today — we need to re-parse for week/month
    // Let's just scan the files again quickly for dates
    const dateCosts = {};
    for (const dir of dirs) {
      const projPath = path.join(projectsDir, dir.name);
      const files2 = fs.readdirSync(projPath).filter(f => f.endsWith('.jsonl'));
      for (const file of files2) {
        try {
          const content2 = fs.readFileSync(path.join(projPath, file), 'utf-8');
          const lines2 = content2.split('\n').filter(l => l.includes('"usage"'));
          for (const line of lines2) {
            try {
              const obj2 = JSON.parse(line);
              const u2 = obj2?.message?.usage || obj2?.usage;
              if (!u2 || !obj2.timestamp) continue;
              const d2 = new Date(obj2.timestamp).toISOString().slice(0, 10);
              const cost2 = (u2.input_tokens||0)*pricing.input + (u2.output_tokens||0)*pricing.output + (u2.cache_creation_input_tokens||0)*pricing.cacheWrite + (u2.cache_read_input_tokens||0)*pricing.cacheRead;
              const tok2 = (u2.input_tokens||0) + (u2.output_tokens||0) + (u2.cache_creation_input_tokens||0) + (u2.cache_read_input_tokens||0);
              if (!dateCosts[d2]) dateCosts[d2] = { cost: 0, tokens: 0 };
              dateCosts[d2].cost += cost2;
              dateCosts[d2].tokens += tok2;
            } catch {}
          }
        } catch {}
      }
    }
    for (const [d, v] of Object.entries(dateCosts)) {
      if (d >= weekStr) { weekCost += v.cost; weekTokens += v.tokens; }
      if (d.startsWith(monthStr)) { monthCost += v.cost; monthTokens += v.tokens; }
    }

    // Calculate 5-hour window tokens (Claude Pro Max billing window)
    const fiveHoursAgo = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
    let windowTokens = 0;
    for (const [d, v] of Object.entries(dateCosts)) {
      // Only today matters for the 5h window (approximate — we track per-day, not per-hour)
      if (d === today) windowTokens = v.tokens;
    }

    cachedUsage = {
      totalTokens, totalCost: Math.round(totalCost * 100) / 100,
      todayTokens, todayCost: Math.round(todayCost * 100) / 100,
      weekTokens, weekCost: Math.round(weekCost * 100) / 100,
      monthTokens, monthCost: Math.round(monthCost * 100) / 100,
      windowTokens, // approximate 5h window (using today's total)
      lastUpdate: Date.now(),
    };
    console.log(`[PeonForge] Usage: today $${cachedUsage.todayCost} (${(cachedUsage.todayTokens/1e6).toFixed(1)}M tokens), total $${cachedUsage.totalCost}`);
  } catch {}
  return cachedUsage;
}

function getTamagotchiPayload() {
  const level = getLevel(tamagotchi.xp);
  const prevXP = getLevelXP(level);
  const nextXP = getLevelXP(level + 1);
  return {
    xp: tamagotchi.xp,
    gold: tamagotchi.gold,
    level,
    xpInLevel: tamagotchi.xp - prevXP,
    xpForLevel: nextXP - prevXP,
    tasksCompleted: tamagotchi.tasksCompleted,
    totalWorkTime: tamagotchi.totalWorkTime,
    happiness: getHappiness(),
    dailySteps: tamagotchi.dailySteps,
    lastFed: tamagotchi.lastFed,
    lastPet: tamagotchi.lastPet,
    xpBoost: tamagotchi.xpBoostUntil > Date.now(),
    usage: parseClaudeUsage(),
  };
}

// ─── Tamagotchi Interactions ──────────────────────
function tamagotchiFeed() {
  const cost = 10;
  if (tamagotchi.gold < cost) return { ok: false, error: 'Pas assez d\'or' };
  applyHappinessDecay();
  tamagotchi.gold -= cost;
  tamagotchi.happiness = Math.min(100, tamagotchi.happiness + 20);
  tamagotchi.lastFed = Date.now();
  saveTamagotchi();
  return { ok: true, speech: 'feed' };
}

function tamagotchiPet() {
  applyHappinessDecay();
  tamagotchi.happiness = Math.min(100, tamagotchi.happiness + 5);
  tamagotchi.lastPet = Date.now();
  saveTamagotchi();
  return { ok: true, speech: 'pet' };
}

function tamagotchiTrain() {
  const cost = 25;
  if (tamagotchi.gold < cost) return { ok: false, error: 'Pas assez d\'or' };
  if (tamagotchi.xpBoostUntil > Date.now()) return { ok: false, error: 'Deja en entrainement' };
  tamagotchi.gold -= cost;
  tamagotchi.xpBoostUntil = Date.now() + 60 * 60 * 1000; // 1 hour
  saveTamagotchi();
  return { ok: true, speech: 'train' };
}

// ─── PeonForge Sync ───────────────────────────────
function loadForgeConfig() {
  try {
    if (fs.existsSync(FORGE_CONFIG)) {
      const c = JSON.parse(fs.readFileSync(FORGE_CONFIG, 'utf-8'));
      forgeToken = c.token || null;
      // Ignore localhost URLs from old configs
      if (c.url && !c.url.includes('localhost')) forgeUrl = c.url;
      forgeUsername = c.username || '';
      forgeAvatar = c.avatar || '';
    }
  } catch {}
}

function saveForgeConfig() {
  try {
    fs.writeFileSync(FORGE_CONFIG, JSON.stringify({ token: forgeToken, url: forgeUrl, username: forgeUsername, avatar: forgeAvatar }, null, 2));
  } catch {}
}

function registerOnForge(username) {
  const data = JSON.stringify({ username, faction });
  const url = new URL(forgeUrl + '/api/register');
  console.log(`[PeonForge] Registering "${username}" on ${url.href}...`);
  const reqModule = url.protocol === 'https:' ? require('https') : http;
  const req = reqModule.request({
    hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80), path: url.pathname,
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, timeout: 5000,
  }, (res) => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => {
      try {
        const r = JSON.parse(body);
        if (r.token) {
          forgeToken = r.token;
          forgeUsername = username;
          saveForgeConfig();
          syncToForge();
          console.log(`[PeonForge] Registered as: ${username}`);
          broadcastToMobile({ username: forgeUsername, registered: true });
        } else if (r.error) {
          console.log(`[PeonForge] Register failed: ${r.error}`);
          broadcastToMobile({ registerError: r.error });
        }
      } catch (e) { console.log(`[PeonForge] Register parse error: ${e.message}`); }
    });
  });
  req.on('error', (e) => { console.log(`[PeonForge] Register network error: ${e.message}`); });
  req.write(data);
  req.end();
}

function syncToForge() {
  if (!forgeToken) return;
  const activeSessions = [...sessions.values()].filter(s => s.status !== 'done');
  const data = JSON.stringify({
    xp: tamagotchi.xp,
    gold: tamagotchi.gold,
    tasks_completed: tamagotchi.tasksCompleted,
    errors_encountered: tamagotchi.errorsEncountered,
    total_work_time: tamagotchi.totalWorkTime,
    daily_steps: tamagotchi.dailySteps,
    active_peons: activeSessions.length,
    faction,
    username: forgeUsername || undefined,
    avatar: forgeAvatar || undefined,
    tunnel_url: tunnelUrl || undefined,
    lan_ip: getLanIP() || undefined,
    port: 7777,
  });

  const url = new URL(forgeUrl + '/api/sync');
  const options = {
    hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80), path: url.pathname,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${forgeToken}`, 'Content-Length': Buffer.byteLength(data) },
    timeout: 5000,
  };

  const req = (url.protocol === 'https:' ? require('https') : http).request(options, (res) => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => {
      try {
        const r = JSON.parse(body);
        console.log(`[PeonForge] Sync OK: level ${r.level}`);
        // Handle new achievements
        if (r.new_achievements && r.new_achievements.length > 0) {
          for (const ach of r.new_achievements) {
            console.log(`[PeonForge] Achievement unlocked: ${ach.name}`);
            forgeAchievements.push(ach);
            showOverlay(`Achievement: ${ach.name}`, faction, forgeAvatar || (faction === 'orc' ? 'peon_fr' : 'peasant_fr'));
            pushCompanionUpdate({ achievement: ach });
          }
        }
        // Store all achievements if provided
        if (r.achievements) forgeAchievements = r.achievements;
      } catch {}
    });
  });
  req.on('error', () => {});
  req.write(data);
  req.end();
}

function startForgeSync() {
  loadForgeConfig();
  if (!forgeToken) {
    // Auto-register with hostname if no token yet
    const name = os.hostname().slice(0, 20) || 'Peon';
    console.log(`[PeonForge] No forge token, auto-registering as "${name}"...`);
    registerOnForge(name);
  }
  if (forgeToken) {
    syncToForge();
  }
  setInterval(() => { if (forgeToken) syncToForge(); }, 5 * 60 * 1000);
}

// ─── Tray Icon ────────────────────────────────────
function createTrayIcon() {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  const isOrc = faction === 'orc';
  const skinR = isOrc ? 0x7a : 0xf5, skinG = isOrc ? 0xb6 : 0xc5, skinB = isOrc ? 0x48 : 0xa3;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - 16, dy = y - 16;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const off = (y * size + x) * 4;

      if (dist < 13) {
        buf[off] = skinR; buf[off + 1] = skinG; buf[off + 2] = skinB; buf[off + 3] = 255;
        if ((Math.abs(dx - 4) < 2 && Math.abs(dy + 2) < 2) || (Math.abs(dx + 4) < 2 && Math.abs(dy + 2) < 2)) {
          buf[off] = 20; buf[off + 1] = 20; buf[off + 2] = 20;
        }
        if (dy > 3 && dy < 6 && Math.abs(dx) < 4) {
          buf[off] = 30; buf[off + 1] = 30; buf[off + 2] = 30;
        }
      } else if (dist < 15) {
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
  tray.setToolTip(`PeonForge — ${faction === 'human' ? 'Humain' : 'Orc'}`);
  updateTrayMenu();
  tray.on('click', () => openSettings());
  tray.on('double-click', () => openSettings());
}

function updateTrayMenu() {
  if (!tray) return;
  const activeSessions = [...sessions.values()].filter(s => s.status !== 'done');
  const sessionLabel = activeSessions.length > 0
    ? `${activeSessions.length} session(s) active(s)`
    : 'Aucune session';
  const level = getLevel(tamagotchi.xp);

  const menu = Menu.buildFromTemplate([
    { label: `PeonForge — Niv. ${level} (${notifCount} notifs)`, enabled: false },
    { label: sessionLabel, enabled: false },
    { type: 'separator' },
    { label: 'Ouvrir les parametres', click: openSettings },
    { label: 'Connecter mobile (QR)', click: () => openPairing() },
    { label: 'Tester la notification', click: () => { showOverlay('TestProject', faction, forgeAvatar || (faction === 'orc' ? 'peon_fr' : 'peasant_fr')); playPeonSound(); } },
    { label: companionMini ? 'Mode complet' : 'Mode mini', click: toggleCompanionMini },
    { type: 'separator' },
    {
      label: 'Camp',
      submenu: [
        { label: 'Alliance', type: 'radio', checked: side === 'alliance', click: () => { setSide('alliance'); } },
        { label: 'Horde', type: 'radio', checked: side === 'horde', click: () => { setSide('horde'); } },
      ]
    },
    { label: soundEnabled ? 'Son active' : 'Son desactive', click: () => { soundEnabled = !soundEnabled; saveConfig(); updateTrayMenu(); } },
    { label: watching ? 'En ecoute' : 'En pause', click: () => { watching = !watching; saveConfig(); updateTrayMenu(); } },
    { type: 'separator' },
    { label: 'Quitter', click: () => { app.quit(); } }
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(`PeonForge — Niv. ${level} | ${side === 'alliance' ? 'Alliance' : 'Horde'} | ${watching ? 'Actif' : 'Pause'}`);
}

function setSide(s) {
  side = s;
  faction = sideToFaction(s);
  saveConfig();
  tray.setImage(createTrayIcon());
  updateTrayMenu();
  try {
    const ppConfig = path.join(os.homedir(), '.claude', 'hooks', 'peon-ping', 'config.json');
    if (fs.existsSync(ppConfig)) {
      const cfg = JSON.parse(fs.readFileSync(ppConfig, 'utf-8'));
      cfg.active_pack = s === 'horde' ? 'peon_fr' : 'peasant_fr';
      fs.writeFileSync(ppConfig, JSON.stringify(cfg, null, 4));
    }
  } catch {}
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('config-update', { faction, side, volume, soundEnabled, watching });
  }
  pushCompanionUpdate({ side, faction });
}
// Backward compat
function setFaction(f) { setSide(factionToSide(f)); }

// ─── Settings Window ──────────────────────────────
function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 480, height: 620,
    resizable: false, frame: false, transparent: true,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload-settings.cjs')
    }
  });
  settingsWindow.loadFile('settings.html', {
    query: { faction, volume: String(volume), soundEnabled: String(soundEnabled), watching: String(watching), notifCount: String(notifCount) }
  });
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ─── Sound ────────────────────────────────────────
const PEON_PACKS_DIR = path.join(os.homedir(), '.claude', 'hooks', 'peon-ping', 'packs');
const WIN_PLAY_SCRIPT = path.join(os.homedir(), '.claude', 'hooks', 'peon-ping', 'scripts', 'win-play.ps1');

function playSound(category, packOverride) {
  if (!soundEnabled) return;
  try {
    const packName = packOverride || (faction === 'orc' ? 'peon_fr' : 'peasant_fr');
    const packDir = path.join(PEON_PACKS_DIR, packName);
    const manifestPath = path.join(packDir, 'openpeon.json');
    if (!fs.existsSync(manifestPath)) return;

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const catSounds = manifest.categories?.[category]?.sounds;
    if (!catSounds || catSounds.length === 0) return;

    const chosen = catSounds[Math.floor(Math.random() * catSounds.length)];
    const soundFile = path.basename(chosen.file);
    const soundPath = path.join(packDir, 'sounds', soundFile);
    if (!fs.existsSync(soundPath)) return;

    if (fs.existsSync(WIN_PLAY_SCRIPT)) {
      exec(
        `powershell -NoProfile -NonInteractive -File "${WIN_PLAY_SCRIPT}" -path "${soundPath}" -vol ${volume}`,
        { timeout: 8000, windowsHide: true }
      );
    }
  } catch {}
}

function playPeonSound() {
  playSound('task.complete');
}

// ─── Focus Terminal ───────────────────────────────
function focusTerminal(projectName) {
  const escaped = (projectName || '').replace(/"/g, '');
  // Write a temp .bat that explorer.exe will launch as a top-level user process
  const batFile = path.join(CONFIG_DIR, '_focus.bat');
  const psCmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${FOCUS_SCRIPT}" -ProjectName "${escaped}"`;
  fs.writeFileSync(batFile, `@echo off\r\n${psCmd}\r\n`);
  // explorer.exe launches the bat as a fully independent user process with desktop rights
  exec(`explorer.exe "${batFile}"`, { timeout: 5000 });
  console.log(`[PeonForge] Focus via explorer for: ${projectName}`);
}

// ─── Companion Window (Tamagotchi) ────────────────
function showCompanion() {
  if (companionWindow && !companionWindow.isDestroyed()) return;

  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;
  const w = companionMini ? 280 : 280;
  const h = companionMini ? 90 : 420;

  companionWindow = new BrowserWindow({
    width: w, height: h,
    x: sw - w - 16, y: sh - h - 16,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload-companion.cjs')
    }
  });

  const f = encodeURIComponent(faction);
  companionWindow.loadFile('companion.html', { query: { faction: f, mini: companionMini ? '1' : '' } });

  companionWindow.webContents.on('did-finish-load', () => {
    // Send initial state
    pushCompanionUpdate({
      tamagotchi: getTamagotchiPayload(),
      mood: getMood(),
      faction,
      avatar: forgeAvatar,
      characters: getCharactersPayload(),
      sessions: getSessionsPayload(),
      recentEvents: recentEvents.slice(0, 20),
      achievements: forgeAchievements,
    });
  });

  companionWindow.on('closed', () => { companionWindow = null; });
}

function toggleCompanionMini() {
  companionMini = !companionMini;
  saveConfig();
  if (companionWindow && !companionWindow.isDestroyed()) {
    companionWindow.close();
    companionWindow = null;
  }
  showCompanion();
  updateTrayMenu();
}

function pushCompanionUpdate(data) {
  if (companionWindow && !companionWindow.isDestroyed()) {
    try {
      companionWindow.webContents.send('companion-update', data);
    } catch {}
  }
  broadcastToMobile(data);
}

// ─── Mobile WebSocket ─────────────────────────────
const mobileClients = new Set();

function broadcastToMobile(data) {
  if (mobileClients.size === 0) return;
  const payload = JSON.stringify({ type: 'update', ...data });
  for (const ws of mobileClients) {
    if (ws.readyState === 1) ws.send(payload);
  }
}

function getCharactersPayload() {
  const level = getLevel(tamagotchi.xp);
  return characterCatalog.map(c => ({
    ...c,
    unlocked: level >= c.unlockLevel,
  }));
}

function getFullStateForMobile() {
  return JSON.stringify({
    type: 'full-state',
    config: { faction, side, volume, soundEnabled, watching, showCompanion: showCompanionWidget, showNotifications },
    tamagotchi: getTamagotchiPayload(),
    sessions: getSessionsPayload(),
    recentEvents: recentEvents.slice(0, 20),
    mood: getMood(),
    hostname: os.hostname(),
    tunnelUrl: tunnelUrl || null,
    lanIp: getLanIP(),
    port: 7777,
    characters: getCharactersPayload(),
    username: forgeUsername,
    avatar: forgeAvatar,
    forgeToken: forgeToken || null,
    achievements: forgeAchievements,
  });
}

// ─── Overlay Window (completion celebration) ──────
function showOverlay(project, fac, charIconId) {
  if (!showNotifications) return;
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
    frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: true, resizable: false, hasShadow: false,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  overlayWindow.loadFile('overlay.html', { query: { project, faction: fac, charIcon: charIconId || '' } });
  overlayWindow.on('closed', () => { overlayWindow = null; });

  setTimeout(() => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.destroy();
      overlayWindow = null;
    }
  }, 12000);
}

// ─── Session & Event Handling ─────────────────────
function addRecentEvent(type, project, sessionId) {
  recentEvents.unshift({ type, project, sessionId, timestamp: Date.now() });
  if (recentEvents.length > MAX_RECENT) recentEvents.length = MAX_RECENT;
}

function getSessionsPayload() {
  return [...sessions.values()]
    .filter(s => s.status !== 'done')
    .map(s => ({
      id: s.id,
      project: s.project,
      projectPath: s.projectPath || '',
      character: s.character || CHARACTERS[0],
      startTime: s.startTime,
      eventCount: s.events.length,
      lastEventTime: s.events.length > 0 ? s.events[s.events.length - 1].time : s.startTime,
      events: s.events.slice(-10).map(e => ({ event: e.event, time: e.time })),
      pid: s.pid || 0,
      hwnd: s.hwnd || 0,
    }));
}

function handleHookEvent(data) {
  const hookEvent = data.hook_event;
  const rawEvent = data.raw_event || hookEvent;
  const sessionId = data.session_id;
  const project = data.project;
  const projectPath = data.project_path;
  if (!hookEvent) return;

  const now = Date.now();
  let session = sessions.get(sessionId);

  // If session not found by ID, try matching a scanned session by project name
  if (!session && project) {
    for (const [id, s] of sessions) {
      if (id.startsWith('scan-') && s.project === project && s.status !== 'done') {
        // Transfer scanned session to real session ID
        sessions.delete(id);
        s.id = sessionId;
        s.projectPath = projectPath || s.projectPath;
        sessions.set(sessionId, s);
        session = s;
        console.log(`[PeonForge] Merged scan session ${id} -> ${sessionId} (${project})`);
        break;
      }
    }
  }

  // Determine the display event type (distinguish subagent stops)
  let displayEvent = hookEvent;
  if (hookEvent === 'Stop' && rawEvent === 'subagentStop') {
    displayEvent = 'SubagentStop';
  }

  if (hookEvent === 'SessionStart') {
    // Check if a scanned session already exists for this project (merge instead of duplicate)
    let existingScanned = null;
    for (const [id, s] of sessions) {
      if (id.startsWith('scan-') && s.project === (project || 'Projet') && s.status !== 'done') {
        existingScanned = id;
        break;
      }
    }
    if (existingScanned) {
      // Merge: transfer the scanned session to the real session ID
      session = sessions.get(existingScanned);
      sessions.delete(existingScanned);
      session.id = sessionId;
      session.projectPath = projectPath || '';
      sessions.set(sessionId, session);
    } else {
      const charIdx = sessionCharCounter % CHARACTERS.length;
      sessionCharCounter++;
      session = {
        id: sessionId,
        project: project || 'Projet',
        projectPath: projectPath || '',
        startTime: now,
        events: [],
        status: 'active',
        character: getCharacterForProject(project || 'Projet') || CHARACTERS[charIdx],
      };
    }
    sessions.set(sessionId, session);
    addRecentEvent(displayEvent, session.project, sessionId);
    addXP(10, 5);
    pushCompanionUpdate({
      event: { type: displayEvent, project: session.project, sessionId },
      tamagotchi: getTamagotchiPayload(),
      mood: 'working',
      sessions: getSessionsPayload(),
    });
    updateTrayMenu();
    return;
  }

  if (hookEvent === 'SessionEnd') {
    // Work time is already accumulated by the mood timer (every 60s)
    if (session) {
      session.status = 'done';
      sessions.delete(sessionId);
      saveTamagotchi();
    }
    addRecentEvent(displayEvent, project || (session && session.project) || 'Projet', sessionId);
    const active = [...sessions.values()].filter(s => s.status !== 'done');
    pushCompanionUpdate({
      event: { type: displayEvent, project: project || 'Projet', sessionId, character: session?.character },
      tamagotchi: getTamagotchiPayload(),
      mood: active.length > 0 ? 'working' : 'idle',
      sessions: getSessionsPayload(),
    });
    updateTrayMenu();
    return;
  }

  // Create session on-the-fly if we missed SessionStart
  if (!session) {
    const charIdx = sessionCharCounter % CHARACTERS.length;
    sessionCharCounter++;
    session = {
      id: sessionId,
      project: project || 'Projet',
      projectPath: projectPath || '',
      startTime: now,
      events: [],
      status: 'active',
      character: CHARACTERS[charIdx],
    };
    sessions.set(sessionId, session);
  }

  if (project && project !== 'Projet') session.project = project;
  session.events.push({ event: displayEvent, time: now });
  addRecentEvent(displayEvent, session.project, sessionId);

  // XP rewards per event type
  switch (hookEvent) {
    case 'Stop':
      tamagotchi.tasksCompleted++;
      addXP(30, 15);
      syncToForge();
      session.status = 'done';
      if (watching) {
        // Use the session's character for the overlay and sound
        const sessionCharId = session.character?.id || (side === 'horde' ? 'peon_fr' : 'peasant_fr');
        const charInfo = characterCatalog.find(c => c.id === sessionCharId);
        const sessionFaction = charInfo ? (ALLIANCE_FACTIONS.includes(charInfo.faction) ? 'human' : 'orc') : sideToFaction(side);
        setTimeout(() => {
          showOverlay(session.project, sessionFaction, sessionCharId);
        }, 300);
        playSound('task.complete', sessionCharId);
      }
      setTimeout(() => { sessions.delete(sessionId); }, 30000);
      // Pick a random voice line from the session's character pack
      const charPackId = session.character?.id || (faction === 'orc' ? 'peon_fr' : 'peasant_fr');
      let voiceLine = null;
      try {
        const packDir = path.join(PEON_PACKS_DIR, charPackId);
        const mf = JSON.parse(fs.readFileSync(path.join(packDir, 'openpeon.json'), 'utf-8'));
        const sounds = mf.categories?.['task.complete']?.sounds || mf.categories?.['session.start']?.sounds || [];
        if (sounds.length > 0) {
          const chosen = sounds[Math.floor(Math.random() * sounds.length)];
          voiceLine = { file: path.basename(chosen.file), label: chosen.label || '', pack: charPackId };
        }
      } catch {}

      pushCompanionUpdate({
        event: { type: displayEvent, project: session.project, sessionId, character: session.character, voiceLine },
        tamagotchi: getTamagotchiPayload(),
        mood: 'happy',
        sessions: getSessionsPayload(),
      });
      updateTrayMenu();
      return;

    case 'SubagentStart':
      addXP(5, 2);
      break;

    case 'PermissionRequest':
      addXP(3, 0);
      break;

    case 'PostToolUseFailure':
      tamagotchi.errorsEncountered++;
      addXP(2, -5);
      break;

    case 'PreCompact':
      addXP(5, 0);
      break;

    default:
      addXP(1, 0);
      break;
  }

  // Pick a voice line for events that trigger mobile notifications
  let eventVoiceLine = null;
  if (displayEvent === 'PermissionRequest' || displayEvent === 'SubagentStart') {
    const charPackId = session.character?.id || (faction === 'orc' ? 'peon_fr' : 'peasant_fr');
    const category = displayEvent === 'PermissionRequest' ? 'input.required' : 'task.acknowledge';
    try {
      const packDir = path.join(PEON_PACKS_DIR, charPackId);
      const mf = JSON.parse(fs.readFileSync(path.join(packDir, 'openpeon.json'), 'utf-8'));
      const sounds = mf.categories?.[category]?.sounds || [];
      if (sounds.length > 0) {
        const chosen = sounds[Math.floor(Math.random() * sounds.length)];
        eventVoiceLine = { file: path.basename(chosen.file), pack: charPackId };
      }
    } catch {}
  }

  pushCompanionUpdate({
    event: { type: displayEvent, project: session.project, sessionId, character: session.character, voiceLine: eventVoiceLine },
    tamagotchi: getTamagotchiPayload(),
    mood: getMood(),
    sessions: getSessionsPayload(),
  });
}

// ─── HTTP Server ──────────────────────────────────
function startServer() {
  const triggerFile = path.join(CONFIG_DIR, 'trigger.json');
  let lastEventTime = Date.now();

  setInterval(() => {
    if (!watching) return;
    try {
      if (!fs.existsSync(triggerFile)) return;
      const stat = fs.statSync(triggerFile);
      if (stat.mtimeMs > lastEventTime) {
        lastEventTime = Date.now();
        const data = JSON.parse(fs.readFileSync(triggerFile, 'utf-8'));
        showOverlay(data.project || 'Projet', data.faction || faction, forgeAvatar || (faction === 'orc' ? 'peon_fr' : 'peasant_fr'));
        playPeonSound();
      }
    } catch {}
  }, 1000);

  serverInstance = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    // Auth check — public endpoints and localhost don't need token
    const reqPath = (req.url || '').split('?')[0];
    const isLocal = req.socket?.remoteAddress === '127.0.0.1' || req.socket?.remoteAddress === '::1' || req.socket?.remoteAddress === '::ffff:127.0.0.1';
    const isPublic = PUBLIC_ENDPOINTS.some(p => reqPath === p) || reqPath === '/event'; // hooks are local
    if (!isLocal && !isPublic && !checkAuth(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end('{"error":"unauthorized"}');
      return;
    }

    if (req.method === 'POST' && req.url === '/notify') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (watching) {
            showOverlay(data.project || 'Projet', data.faction || faction, forgeAvatar || (faction === 'orc' ? 'peon_fr' : 'peasant_fr'));
            playPeonSound();
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        } catch {
          res.writeHead(400);
          res.end('{"error":"bad json"}');
        }
      });
    } else if (req.method === 'POST' && req.url === '/event') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          handleHookEvent(data);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        } catch {
          res.writeHead(400);
          res.end('{"error":"bad json"}');
        }
      });
    } else if (req.method === 'GET' && req.url === '/status') {
      const activeSessions = [...sessions.values()].filter(s => s.status !== 'done');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        running: true, faction, watching, soundEnabled, notifCount,
        level: getLevel(tamagotchi.xp),
        activeSessions: activeSessions.length,
        sessions: activeSessions.map(s => ({ id: s.id, project: s.project, events: s.events.length }))
      }));
    } else if (req.method === 'GET' && req.url === '/terminal-capture') {
      // Capture terminal screenshot and serve as JPEG
      const capturePath = path.join(CONFIG_DIR, 'terminal-capture.jpg');
      const captureScript = path.join(__dirname, 'scripts', 'capture-terminal.ps1');
      exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${captureScript}" -OutputPath "${capturePath}"`,
        { timeout: 5000 },
        (err) => {
          if (!err && fs.existsSync(capturePath)) {
            const img = fs.readFileSync(capturePath);
            res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': img.length, 'Cache-Control': 'no-cache' });
            res.end(img);
          } else {
            res.writeHead(404);
            res.end('capture failed');
          }
        }
      );
      return;
    } else if (req.method === 'POST' && req.url === '/config') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.faction) setFaction(data.faction);
          if (data.volume !== undefined) { volume = data.volume; saveConfig(); syncVolumeToHooks(); }
          if (data.soundEnabled !== undefined) { soundEnabled = data.soundEnabled; saveConfig(); updateTrayMenu(); }
          if (data.watching !== undefined) { watching = data.watching; saveConfig(); updateTrayMenu(); }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        } catch {
          res.writeHead(400);
          res.end('{"error":"bad json"}');
        }
      });
    } else if (req.method === 'POST' && req.url === '/focus') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const sid = data.sessionId;
          const session = sessions.get(sid);
          const project = session ? session.project : (data.project || '');
          console.log(`[PeonForge] Focus (HTTP): ${project}`);
          focusTerminal(project);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        } catch {
          res.writeHead(400);
          res.end('{"error":"bad json"}');
        }
      });
    } else if (req.method === 'GET' && req.url === '/discover') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ app: 'peonforge', version: '2.0.0', hostname: os.hostname() }));
    } else if (req.method === 'GET' && req.url === '/tamagotchi') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...getTamagotchiPayload(), mood: getMood(), faction }));
    } else if (req.method === 'POST' && req.url === '/send-keys') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const keys = (data.keys || '').replace(/"/g, '');
          const sendKeysScript = path.join(__dirname, 'scripts', 'send-keys.ps1');
          let hwnd = 0;
          for (const s of sessions.values()) {
            if (s.hwnd && s.status !== 'done') { hwnd = s.hwnd; break; }
          }
          exec(`powershell -NoProfile -ExecutionPolicy Bypass -STA -File "${sendKeysScript}" -Keys "${keys}" -Hwnd ${hwnd}`,
            { timeout: 3000 },
            (err, stdout) => { if (stdout) console.log(`[PeonForge] SendKeys HTTP: ${stdout.trim()}`); }
          );
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        } catch {
          res.writeHead(400);
          res.end('{"error":"bad json"}');
        }
      });
      return;
    } else if (req.method === 'GET' && req.url?.startsWith('/icon/')) {
      // Serve character icon: /icon/packName.png
      const iconName = req.url.replace('/icon/', '');
      const iconPath = path.join(__dirname, 'assets', 'icons', iconName);
      if (fs.existsSync(iconPath)) {
        const data = fs.readFileSync(iconPath);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': data.length, 'Cache-Control': 'public, max-age=86400' });
        res.end(data);
        return;
      }
      res.writeHead(404); res.end('not found');
      return;
    } else if (req.method === 'GET' && req.url?.startsWith('/sound/')) {
      // Serve sound file: /sound/packName/filename.wav
      const parts = req.url.replace('/sound/', '').split('/');
      if (parts.length === 2) {
        const soundPath = path.join(PEON_PACKS_DIR, parts[0], 'sounds', parts[1]);
        if (fs.existsSync(soundPath)) {
          const data = fs.readFileSync(soundPath);
          res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': data.length, 'Cache-Control': 'public, max-age=86400' });
          res.end(data);
          return;
        }
      }
      res.writeHead(404); res.end('not found');
      return;
    } else if (req.method === 'GET' && req.url === '/characters') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getCharactersPayload()));
    } else if (req.method === 'GET' && req.url === '/sessions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getSessionsPayload()));
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  });

  // WebSocket server (shares HTTP server, auto-upgrade)
  const wss = new WebSocketServer({ server: serverInstance });
  wss.on('connection', (ws, req) => {
    // Auth check for WebSocket — token in query string or first message
    const wsUrl = new URL(req.url || '/', 'http://localhost');
    const wsToken = wsUrl.searchParams.get('token') || '';
    const wsLocal = req.socket?.remoteAddress === '127.0.0.1' || req.socket?.remoteAddress === '::1' || req.socket?.remoteAddress === '::ffff:127.0.0.1';

    if (!wsLocal && wsToken !== authToken) {
      console.log(`[PeonForge] WS rejected: invalid token from ${req.socket?.remoteAddress}`);
      ws.close(4001, 'unauthorized');
      return;
    }

    mobileClients.add(ws);
    console.log(`[PeonForge] Mobile connected (${mobileClients.size} clients) auth=${wsLocal ? 'local' : 'token'}`);
    ws.send(getFullStateForMobile());
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        // Log all incoming WS messages
        const logLine = `[${new Date().toISOString()}] WS msg: ${msg.type || 'unknown'} ${JSON.stringify(msg).slice(0,100)}\n`;
        fs.appendFileSync(path.join(CONFIG_DIR, 'ws-debug.log'), logLine);
        console.log(`[PeonForge] WS received: ${msg.type}`);
        if (msg.type === 'set-config') {
          if (msg.side) setSide(msg.side);
          else if (msg.faction) setFaction(msg.faction);
          if (msg.volume !== undefined) { volume = msg.volume; saveConfig(); syncVolumeToHooks(); }
          if (msg.soundEnabled !== undefined) { soundEnabled = msg.soundEnabled; saveConfig(); updateTrayMenu(); }
          if (msg.watching !== undefined) { watching = msg.watching; saveConfig(); updateTrayMenu(); }
          if (msg.showCompanion !== undefined) {
            showCompanionWidget = msg.showCompanion;
            saveConfig();
            if (showCompanionWidget) showCompanion();
            else if (companionWindow && !companionWindow.isDestroyed()) companionWindow.close();
          }
          if (msg.showNotifications !== undefined) {
            showNotifications = msg.showNotifications;
            saveConfig();
          }
        }
        if (msg.type === 'test-notification') {
          showOverlay('TestProject', faction, forgeAvatar || (faction === 'orc' ? 'peon_fr' : 'peasant_fr'));
          playPeonSound();
        }
        if (msg.type === 'focus-terminal') {
          const sid = msg.sessionId;
          const session = sessions.get(sid);
          const project = session ? session.project : (msg.project || '');
          console.log(`[PeonForge] Focus terminal: ${project} (session: ${sid})`);
          focusTerminal(project);
        }
        if (msg.type === 'set-session-character') {
          const session = sessions.get(msg.sessionId);
          const packId = msg.characterId;
          if (session && packId) {
            const charInfo = characterCatalog.find(c => c.id === packId);
            const level = getLevel(tamagotchi.xp);
            if (charInfo && level >= charInfo.unlockLevel) {
              const fc = { orc: '#ff6644', nightelf: '#b482ff', undead: '#5aff5a', naga: '#00ccaa', neutral: '#ffc832' };
              session.character = { id: packId, name: charInfo.name, gif: `assets/icons/${packId}.png`, color: fc[charInfo.faction] || '#64c8ff' };
              // Persist by project name so it survives restarts
              if (session.project) {
                charAssignments[session.project] = packId;
                saveCharAssignments();
              }
              // Also switch the sound pack for peon-ping
              try {
                const ppConfig = path.join(os.homedir(), '.claude', 'hooks', 'peon-ping', 'config.json');
                if (fs.existsSync(ppConfig)) {
                  const raw = fs.readFileSync(ppConfig, 'utf-8');
                  const updated = raw.replace(/"active_pack"\s*:\s*"[^"]*"/, `"active_pack": "${packId}"`);
                  fs.writeFileSync(ppConfig, updated);
                }
              } catch {}
              broadcastToMobile({ sessions: getSessionsPayload() });
              pushCompanionUpdate({ sessions: getSessionsPayload() });
            }
          }
        }
        if (msg.type === 'set-avatar') {
          const avatarId = (msg.avatar || '').trim();
          // Check if character is unlocked
          const charInfo = characterCatalog.find(c => c.id === avatarId);
          const level = getLevel(tamagotchi.xp);
          if (charInfo && level >= charInfo.unlockLevel) {
            forgeAvatar = avatarId;
            saveForgeConfig();
            syncToForge();
            broadcastToMobile({ avatar: forgeAvatar });
            pushCompanionUpdate({ avatar: forgeAvatar, characters: getCharactersPayload() });
            console.log(`[PeonForge] Avatar set to: ${charInfo.name}`);
          }
        }
        if (msg.type === 'set-username') {
          const name = (msg.username || '').trim();
          if (name.length >= 2 && name.length <= 20) {
            if (!forgeToken) {
              // First time: register
              registerOnForge(name);
            } else {
              // Already registered: just update local
              forgeUsername = name;
              saveForgeConfig();
              broadcastToMobile({ username: forgeUsername });
            }
          }
        }
        if (msg.type === 'start-terminal-stream') {
          const captureScript = path.join(__dirname, 'scripts', 'capture-terminal.ps1');
          const resizeScript = path.join(__dirname, 'scripts', 'resize-terminal.ps1');
          const capturePath = path.join(CONFIG_DIR, 'terminal-capture.jpg');
          const streamSession = msg.sessionId ? sessions.get(msg.sessionId) : null;
          const streamHwnd = streamSession?.hwnd || 0;
          if (ws._streamInterval) clearInterval(ws._streamInterval);

          // Resize terminal to narrow portrait format for mobile readability
          // Fixed size that works well on phones: 600x900 (2:3 portrait)
          const targetW = 600, targetH = 900;
          if (streamHwnd) {
            exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${resizeScript}" -Hwnd ${streamHwnd} -Width ${targetW} -Height ${targetH}`,
              { timeout: 3000 });
          }
          ws._streamHwnd = streamHwnd;
          console.log(`[PeonForge] Stream started hwnd=${streamHwnd} resize=${targetW}x${targetH}`);
          const streamInterval = setInterval(() => {
            if (ws.readyState !== 1) { clearInterval(streamInterval); return; }
            const hwndArg = streamHwnd ? `-Hwnd ${streamHwnd}` : '';
            exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${captureScript}" -OutputPath "${capturePath}" ${hwndArg}`,
              { timeout: 3000 },
              (err) => {
                if (!err && fs.existsSync(capturePath) && ws.readyState === 1) {
                  const img = fs.readFileSync(capturePath);
                  ws.send(JSON.stringify({ type: 'terminal-frame', data: img.toString('base64'), size: img.length }));
                }
              }
            );
          }, 1000); // 1 fps
          ws._streamInterval = streamInterval;
          console.log('[PeonForge] Terminal stream started');
        }
        if (msg.type === 'send-keys') {
          const sendKeysScript = path.join(__dirname, 'scripts', 'send-keys.ps1');
          const keys = (msg.keys || '').replace(/"/g, '');
          // Find hwnd from the active stream session or any Claude terminal
          let hwnd = ws._streamHwnd || 0;
          if (!hwnd) {
            // Find any active session with a hwnd
            for (const s of sessions.values()) {
              if (s.hwnd && s.status !== 'done') { hwnd = s.hwnd; break; }
            }
          }
          // Use VBScript with window title for correct terminal targeting
          const vbsScript = path.join(__dirname, 'scripts', 'send-keys.vbs');
          // Find the window title from the session being streamed
          let targetTitle = 'Claude';
          if (ws._streamHwnd) {
            for (const s of sessions.values()) {
              if (s.hwnd === ws._streamHwnd) { targetTitle = s.project || 'Claude'; break; }
            }
          } else if (hwnd) {
            for (const s of sessions.values()) {
              if (s.hwnd === hwnd) { targetTitle = s.project || 'Claude'; break; }
            }
          }
          console.log(`[PeonForge] SendKeys to "${targetTitle}": ${keys}`);
          exec(`cscript //nologo "${vbsScript}" "${keys}" "${targetTitle}"`, { timeout: 5000, windowsHide: true },
            (err) => { if (err) console.log(`[PeonForge] SendKeys error: ${err.message}`); }
          );
        }
        if (msg.type === 'stop-terminal-stream') {
          if (ws._streamInterval) {
            clearInterval(ws._streamInterval);
            ws._streamInterval = null;
            if (ws._streamHwnd) {
              const resizeScript = path.join(__dirname, 'scripts', 'resize-terminal.ps1');
              exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${resizeScript}" -Hwnd ${ws._streamHwnd} -Restore`,
                { timeout: 3000 });
              ws._streamHwnd = null;
            }
            console.log('[PeonForge] Terminal stream stopped + restored');
          }
        }
        if (msg.type === 'set-steps') {
          const steps = parseInt(msg.steps) || 0;
          const today = new Date().toISOString().slice(0, 10);
          if (tamagotchi.stepsDate !== today) {
            tamagotchi.dailySteps = 0;
            tamagotchi.stepsDate = today;
          }
          tamagotchi.dailySteps = steps;
          tamagotchi.happiness = getHappiness();
          saveTamagotchi();
          const update = { tamagotchi: getTamagotchiPayload(), mood: getMood() };
          broadcastToMobile(update);
          pushCompanionUpdate(update);
        }
        if (msg.type === 'interact') {
          let result;
          switch (msg.action) {
            case 'feed': result = tamagotchiFeed(); break;
            case 'pet': result = tamagotchiPet(); break;
            case 'train': result = tamagotchiTrain(); break;
            default: result = { ok: false, error: 'Unknown action' };
          }
          // Broadcast updated state to all mobile clients + companion
          const update = { tamagotchi: getTamagotchiPayload(), mood: getMood(), interaction: { action: msg.action, ...result } };
          broadcastToMobile(update);
          pushCompanionUpdate(update);
        }
        if (msg.type === 'upload-image') {
          try {
            const base64 = msg.data;
            const filename = msg.filename || 'mobile.jpg';
            const buffer = Buffer.from(base64, 'base64');
            const filePath = saveImageToCaptures(buffer, filename);
            if (filePath) {
              ws.send(JSON.stringify({ type: 'image-saved', path: filePath }));
              // Also notify companion widget
              pushCompanionUpdate({ imageSaved: filePath });
            } else {
              ws.send(JSON.stringify({ type: 'image-error', error: 'Failed to save' }));
            }
          } catch (e) {
            ws.send(JSON.stringify({ type: 'image-error', error: e.message }));
          }
        }
      } catch {}
    });
    // Notify pairing window
    if (pairingWindow && !pairingWindow.isDestroyed()) {
      pairingWindow.webContents.send('pairing-data', { connected: true });
    }
    ws.on('close', () => {
      if (ws._streamInterval) clearInterval(ws._streamInterval);
      if (ws._streamHwnd) {
        const resizeScript = path.join(__dirname, 'scripts', 'resize-terminal.ps1');
        exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${resizeScript}" -Hwnd ${ws._streamHwnd} -Restore`, { timeout: 3000 });
      }
      mobileClients.delete(ws);
      console.log(`[PeonForge] Mobile disconnected (${mobileClients.size} clients)`);
    });
  });

  serverInstance.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log('[PeonForge] Port 7777 busy, trying 7778...');
      serverInstance.listen(7778, '0.0.0.0');
    }
  });
  serverInstance.listen(7777, '0.0.0.0', () => {
    const nets = os.networkInterfaces();
    let lanIP = '127.0.0.1';
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) { lanIP = net.address; break; }
      }
    }
    console.log(`[PeonForge] HTTP+WS server on http://${lanIP}:7777`);
  });
}

// ─── LAN IP helper ────────────────────────────────
function getLanIP() {
  const nets = os.networkInterfaces();
  // Prefer 192.168.x.x (typical home LAN), then 10.x.x.x, skip link-local (169.254) and virtual
  let fallback = null;
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family !== 'IPv4' || net.internal) continue;
      if (net.address.startsWith('192.168.')) return net.address;
      if (net.address.startsWith('10.') && !fallback) fallback = net.address;
    }
  }
  return fallback || '127.0.0.1';
}

// ─── Tunnel (cloudflared) ─────────────────────────
async function startTunnel() {
  if (tunnelInstance) return tunnelUrl;
  return new Promise((resolve) => {
    try {
      const { spawn } = require('child_process');
      const proc = spawn('cloudflared', ['tunnel', '--url', 'http://localhost:7777'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      tunnelInstance = proc;
      let resolved = false;

      const onData = (data) => {
        const line = data.toString();
        // cloudflared prints the URL in the log
        const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (match && !resolved) {
          resolved = true;
          tunnelUrl = match[0];
          console.log(`[PeonForge] Tunnel: ${tunnelUrl}`);
          resolve(tunnelUrl);
        }
      };
      proc.stdout.on('data', onData);
      proc.stderr.on('data', onData);

      proc.on('error', (e) => {
        console.log(`[PeonForge] cloudflared not found: ${e.message}`);
        tunnelInstance = null;
        if (!resolved) { resolved = true; resolve(null); }
      });
      proc.on('exit', () => {
        tunnelInstance = null;
        tunnelUrl = null;
      });

      // Timeout after 15s
      setTimeout(() => {
        if (!resolved) { resolved = true; resolve(null); }
      }, 15000);
    } catch (e) {
      console.log(`[PeonForge] Tunnel error: ${e.message}`);
      resolve(null);
    }
  });
}

// ─── Pairing Window ───────────────────────────────
async function openPairing() {
  if (pairingWindow && !pairingWindow.isDestroyed()) { pairingWindow.focus(); return; }

  pairingWindow = new BrowserWindow({
    width: 380, height: 520,
    resizable: false, frame: false, transparent: true,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload-pairing.cjs')
    }
  });

  pairingWindow.loadFile('pairing.html');
  pairingWindow.on('closed', () => { pairingWindow = null; });

  const lanIp = getLanIP();

  // Send LAN info immediately
  pairingWindow.webContents.on('did-finish-load', async () => {
    pairingWindow.webContents.send('pairing-data', { lanIp, status: 'Creation du tunnel internet...', statusType: '' });

    // Start tunnel
    const tUrl = await startTunnel();

    const pairingData = {
      lanIp, port: 7777,
      tunnelUrl: tUrl || null,
      hostname: os.hostname(),
      authToken,
    };

    // Generate QR code
    try {
      const qrDataUrl = await QRCode.toDataURL(JSON.stringify(pairingData), { width: 200, margin: 1, color: { dark: '#000', light: '#fff' } });
      pairingWindow.webContents.send('pairing-data', {
        qrDataUrl,
        lanIp,
        tunnelUrl: tUrl || 'Non disponible',
        status: tUrl ? 'Pret ! Scanne le QR code.' : 'Tunnel indisponible — LAN uniquement',
        statusType: tUrl ? 'ok' : 'error',
      });
    } catch {}
  });
}

// ─── Scan for existing Claude terminals ───────────
function scanClaudeTerminals() {
  const listScript = path.join(__dirname, 'scripts', 'list-terminals.ps1');
  exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${listScript}"`,
    { timeout: 5000 },
    (err, stdout) => {
      if (err || !stdout.trim()) return;
      try {
        let windows = JSON.parse(stdout);
        if (!Array.isArray(windows)) windows = [windows];

        // Filter to Claude-related windows only (skip DDE Server, Invite de commandes, etc.)
        windows = windows.filter(w => {
          const t = (w.title || '').toLowerCase();
          return t.includes('claude') || t.includes('code') ||
            // Also match project folder names from ~/Documents/Projets
            (w.pid && t.length > 2 && !t.includes('dde') && !t.includes('invite') && t !== 'windows terminal');
        });

        const knownHwnds = new Set();
        for (const session of sessions.values()) {
          if (session.hwnd) knownHwnds.add(session.hwnd);
        }

        let added = 0;
        for (const win of windows) {
          if (!win.hwnd || knownHwnds.has(win.hwnd)) continue;

          // Check if an existing session matches by project name in title
          const winTitle = (win.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          let matched = false;
          for (const session of sessions.values()) {
            if (session.status !== 'done' && !session.hwnd) {
              const projClean = (session.project || '').toLowerCase().replace(/[^a-z0-9]/g, '');
              if (winTitle.includes(projClean) || projClean.includes(winTitle.split(' ')[0])) {
                session.hwnd = win.hwnd;
                session.pid = win.pid;
                matched = true;
                break;
              }
            }
          }
          if (matched) continue;

          // Create new scan session for this window
          const charIdx = sessionCharCounter % CHARACTERS.length;
          sessionCharCounter++;
          const sessionId = `scan-${win.hwnd}`;

          // Extract project name from title (remove emoji prefix, "Claude Code" suffix)
          let project = (win.title || 'Claude').replace(/^[^\w]*/, '').replace(/\s*[-—]\s*Claude.*$/i, '').trim();
          if (!project || project === 'Claude Code') project = 'Claude';

          sessions.set(sessionId, {
            id: sessionId,
            project,
            projectPath: '',
            startTime: Date.now(),
            events: [],
            status: 'active',
            character: getCharacterForProject(project || 'Projet') || CHARACTERS[charIdx],
            pid: win.pid,
            hwnd: win.hwnd,
          });
          added++;
          console.log(`[PeonForge] Discovered: "${project}" (hwnd=${win.hwnd})`);
        }

        if (added > 0) {
          pushCompanionUpdate({ sessions: getSessionsPayload() });
          updateTrayMenu();
        }

        // Clean up sessions whose window handle no longer exists
        const activeHwnds = new Set(windows.map(w => w.hwnd));
        for (const [id, session] of sessions) {
          if (session.hwnd && !activeHwnds.has(session.hwnd) && session.status !== 'done') {
            console.log(`[PeonForge] Window gone: ${session.project} (hwnd=${session.hwnd})`);
            session.status = 'done';
            sessions.delete(id);
          }
        }
      } catch {}
    }
  );
}

// ─── Mood Timer (periodic update) ─────────────────
function startMoodTimer() {
  setInterval(() => {
    pushCompanionUpdate({ mood: getMood() });

    // Accumulate work time and apply happiness decay
    applyHappinessDecay();
    const activeSessions = [...sessions.values()].filter(s => s.status !== 'done');
    if (activeSessions.length > 0) {
      tamagotchi.totalWorkTime += 60;
      tamagotchi.lastActivity = Date.now();
    }
    saveTamagotchi();

    // Daily summary at 20:00
    const nowDate = new Date();
    const today = nowDate.toISOString().slice(0, 10);
    if (nowDate.getHours() >= 20 && dailySummarySentDate !== today) {
      dailySummarySentDate = today;
      const level = getLevel(tamagotchi.xp);
      const hours = Math.floor(tamagotchi.totalWorkTime / 3600);
      const mins = Math.floor((tamagotchi.totalWorkTime % 3600) / 60);
      const summary = `${tamagotchi.tasksCompleted} taches | ${hours}h${mins}m | Niv.${level} | ${tamagotchi.dailySteps} pas`;
      console.log(`[PeonForge] Daily summary: ${summary}`);
      showOverlay(summary, faction, forgeAvatar || (faction === 'orc' ? 'peon_fr' : 'peasant_fr'));
      pushCompanionUpdate({ dailySummary: { date: today, tasks: tamagotchi.tasksCompleted, workTime: tamagotchi.totalWorkTime, level, steps: tamagotchi.dailySteps, gold: tamagotchi.gold } });
    }

    // Cleanup stale sessions (no event for 10 min)
    const now = Date.now();
    const staleTimeout = 10 * 60 * 1000;
    let cleaned = false;
    for (const [id, session] of sessions) {
      const lastEvent = session.events.length > 0 ? session.events[session.events.length - 1].time : session.startTime;
      if (now - lastEvent > staleTimeout && session.status !== 'done') {
        session.status = 'done';
        sessions.delete(id);
        cleaned = true;
      }
    }
    if (cleaned) {
      pushCompanionUpdate({ sessions: getSessionsPayload() });
      updateTrayMenu();
    }
  }, 60000);
}

// ─── IPC ──────────────────────────────────────────
ipcMain.on('close-overlay', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
});

ipcMain.on('pairing:close', () => {
  if (pairingWindow && !pairingWindow.isDestroyed()) pairingWindow.close();
});

ipcMain.on('companion:close', () => {
  if (companionWindow && !companionWindow.isDestroyed()) companionWindow.close();
});

// ─── Image Capture (drag-drop, paste, mobile upload) ───
function saveImageToCaptures(buffer, filename) {
  try {
    if (!fs.existsSync(CAPTURES_DIR)) fs.mkdirSync(CAPTURES_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const ext = path.extname(filename || '.png') || '.png';
    const safeName = `capture-${ts}${ext}`;
    const filePath = path.join(CAPTURES_DIR, safeName);
    fs.writeFileSync(filePath, buffer);
    clipboard.writeText(filePath);
    console.log(`[PeonForge] Image saved: ${filePath}`);
    return filePath;
  } catch (e) {
    console.error('[PeonForge] saveImageToCaptures error:', e);
    return null;
  }
}

ipcMain.handle('companion:save-image', async (e, arrayBuffer, filename) => {
  const buffer = Buffer.from(arrayBuffer);
  const filePath = saveImageToCaptures(buffer, filename);
  return filePath;
});

ipcMain.handle('companion:paste-image', async () => {
  console.log('[PeonForge] Paste image requested');
  try {
    const img = nativeImage.createFromClipboard();
    console.log(`[PeonForge] Clipboard image: empty=${img.isEmpty()}, size=${img.getSize().width}x${img.getSize().height}`);
    if (img.isEmpty()) return null;
    const buffer = img.toPNG();
    console.log(`[PeonForge] PNG buffer: ${buffer.length} bytes`);
    const filePath = saveImageToCaptures(buffer, 'clipboard.png');
    return filePath;
  } catch (e) {
    console.error('[PeonForge] Paste error:', e);
    return null;
  }
});

ipcMain.on('companion:focus-session', (e, sessionId) => {
  const session = sessions.get(sessionId);
  const projectName = session ? session.project : '';
  focusTerminal(projectName);
});

ipcMain.on('focus-terminal', () => {
  const active = [...sessions.values()].filter(s => s.status !== 'done');
  const projectName = active.length > 0 ? active[active.length - 1].project : '';
  focusTerminal(projectName);
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
});

ipcMain.on('focus-neonhub', () => {
  const active = [...sessions.values()].filter(s => s.status !== 'done');
  const projectName = active.length > 0 ? active[active.length - 1].project : '';
  focusTerminal(projectName);
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
});

ipcMain.on('settings:set-faction', (e, f) => setFaction(f));
ipcMain.on('settings:set-sound', (e, v) => { soundEnabled = v; saveConfig(); updateTrayMenu(); });
ipcMain.on('settings:set-watching', (e, v) => { watching = v; saveConfig(); updateTrayMenu(); });
ipcMain.on('settings:set-volume', (e, v) => { volume = v; saveConfig(); syncVolumeToHooks(); });
ipcMain.on('settings:test', () => { showOverlay('TestProject', faction, forgeAvatar || (faction === 'orc' ? 'peon_fr' : 'peasant_fr')); playPeonSound(); });
ipcMain.on('settings:close', () => { if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close(); });
ipcMain.on('settings:get-history', (e) => {
  try {
    if (fs.existsSync(HISTORY_FILE)) e.returnValue = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    else e.returnValue = [];
  } catch { e.returnValue = []; }
});
ipcMain.on('settings:get-characters', (e) => {
  e.returnValue = getCharactersPayload();
});
ipcMain.on('settings:get-username', (e) => {
  e.returnValue = forgeUsername || '';
});
ipcMain.on('settings:set-show-companion', (e, v) => {
  showCompanionWidget = v;
  saveConfig();
  if (v) showCompanion();
  else if (companionWindow && !companionWindow.isDestroyed()) companionWindow.close();
});
ipcMain.on('settings:set-show-notifications', (e, v) => {
  showNotifications = v;
  saveConfig();
});
ipcMain.on('settings:set-username', (e, name) => {
  const trimmed = (name || '').trim();
  if (trimmed.length >= 2 && trimmed.length <= 20) {
    forgeUsername = trimmed;
    saveForgeConfig();
    syncToForge();
    console.log(`[PeonForge] Username set to: ${forgeUsername}`);
  }
});

// ─── App ──────────────────────────────────────────
app.whenReady().then(() => {
  loadConfig();
  loadTamagotchi();
  createTray();
  startServer();
  saveAppJson();
  if (showCompanionWidget) showCompanion();
  startMoodTimer();
  startForgeSync();
  // Scan for existing Claude terminals that started before us
  scanClaudeTerminals();
  setInterval(scanClaudeTerminals, 30000);
  // Start tunnel at boot so mobile works over internet
  startTunnel().then(url => {
    if (url) console.log(`[PeonForge] Tunnel ready: ${url}`);
    else console.log('[PeonForge] Tunnel unavailable (cloudflared not installed?)');
  });
  console.log('[PeonForge] Ready! Faction:', faction, '| Level:', getLevel(tamagotchi.xp));
});

app.on('window-all-closed', (e) => e.preventDefault());
