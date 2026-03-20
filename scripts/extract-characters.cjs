// Extract selected WC3 character voices from CASC
const casclib = require('casclib');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Characters to extract with their unlock levels
const CHARACTERS = [
  // Level 1 - Starter (already have these)
  { race: 'Human', unit: 'Peasant', name: 'Paysan', unlockLevel: 1, faction: 'human' },
  { race: 'Orc', unit: 'Peon', name: 'Peon', unlockLevel: 1, faction: 'orc' },

  // Level 3-5 - Basic units
  { race: 'Human', unit: 'Footman', name: 'Fantassin', unlockLevel: 3, faction: 'human' },
  { race: 'Orc', unit: 'Grunt', name: 'Grunt', unlockLevel: 3, faction: 'orc' },
  { race: 'NightElf', unit: 'Archer', name: 'Archère', unlockLevel: 5, faction: 'nightelf' },
  { race: 'Undead', unit: 'Ghoul', name: 'Goule', unlockLevel: 5, faction: 'undead' },

  // Level 8-10 - Magic units
  { race: 'Human', unit: 'Sorceress', name: 'Ensorceleuse', unlockLevel: 8, faction: 'human' },
  { race: 'Orc', unit: 'WitchDoctor', name: 'Medecin', unlockLevel: 8, faction: 'orc' },
  { race: 'NightElf', unit: 'Dryad', name: 'Dryade', unlockLevel: 10, faction: 'nightelf' },
  { race: 'Undead', unit: 'Banshee', name: 'Banshee', unlockLevel: 10, faction: 'undead' },

  // Level 12-15 - Elite units
  { race: 'Human', unit: 'Knight', name: 'Chevalier', unlockLevel: 12, faction: 'human' },
  { race: 'Orc', unit: 'Tauren', name: 'Tauren', unlockLevel: 12, faction: 'orc' },
  { race: 'Human', unit: 'Priest', name: 'Pretre', unlockLevel: 14, faction: 'human' },
  { race: 'Orc', unit: 'Shaman', name: 'Shaman', unlockLevel: 14, faction: 'orc' },
  { race: 'NightElf', unit: 'DruidOfTheClaw', name: 'Druide de la Griffe', unlockLevel: 15, faction: 'nightelf' },

  // Level 18-20 - Heroes
  { race: 'Human', unit: 'HeroPaladin', name: 'Paladin', unlockLevel: 18, faction: 'human' },
  { race: 'Orc', unit: 'HeroFarseer', name: 'Farseer', unlockLevel: 18, faction: 'orc' },
  { race: 'NightElf', unit: 'HeroKeeperOfTheGrove', name: 'Gardien du Bosquet', unlockLevel: 20, faction: 'nightelf' },
  { race: 'Undead', unit: 'HeroDeathKnight', name: 'Chevalier de la Mort', unlockLevel: 20, faction: 'undead' },
  { race: 'Human', unit: 'HeroMountainKing', name: 'Roi de la Montagne', unlockLevel: 20, faction: 'human' },

  // Level 25 - Named heroes
  { race: 'Human', unit: 'Arthas', name: 'Arthas', unlockLevel: 25, faction: 'human' },
  { race: 'Orc', unit: 'Thrall', name: 'Thrall', unlockLevel: 25, faction: 'orc' },
  { race: 'Human', unit: 'Jaina', name: 'Jaina', unlockLevel: 25, faction: 'human' },
  { race: 'NightElf', unit: 'Tyrande', name: 'Tyrande', unlockLevel: 25, faction: 'nightelf' },
  { race: 'Human', unit: 'Uther', name: 'Uther', unlockLevel: 25, faction: 'human' },

  // Level 30 - Villains & exotics
  { race: 'Undead', unit: 'HeroLich', name: 'Liche', unlockLevel: 30, faction: 'undead' },
  { race: 'Undead', unit: 'HeroDreadLord', name: 'Seigneur de l\'Effroi', unlockLevel: 30, faction: 'undead' },
  { race: 'Orc', unit: 'HeroShadowHunter', name: 'Chasseur des Ombres', unlockLevel: 30, faction: 'orc' },
  { race: 'Naga', unit: 'LadyVashj', name: 'Lady Vashj', unlockLevel: 30, faction: 'naga' },

  // Level 35 - Legendary
  { race: 'Undead', unit: 'EvilArthas', name: 'Arthas Corrompu', unlockLevel: 35, faction: 'undead' },
  { race: 'NightElf', unit: 'Maiev', name: 'Maiev', unlockLevel: 35, faction: 'nightelf' },
  { race: 'Orc', unit: 'Cairne', name: 'Cairne', unlockLevel: 35, faction: 'orc' },

  // Level 40 - Ultimate
  { race: 'NightElf', unit: 'Illidan', name: 'Illidan', unlockLevel: 40, faction: 'nightelf' },
  { race: 'NightElf', unit: 'HeroDemonHunter', name: 'Chasseur de Demons', unlockLevel: 40, faction: 'nightelf' },
  { race: 'Creeps', unit: 'PandarenBrewmaster', name: 'Pandaren', unlockLevel: 45, faction: 'neutral' },

  // Level 50 - God tier
  { race: 'Undead', unit: 'KelThuzadLich', name: 'Kel\'Thuzad', unlockLevel: 50, faction: 'undead' },
];

const WC3_PATH = 'C:\\Program Files (x86)\\Warcraft III';
const OUTPUT_DIR = path.join(__dirname, '..', 'extracted-characters');
const PACKS_DIR = path.join(require('os').homedir(), '.claude', 'hooks', 'peon-ping', 'packs');

// Check for ffmpeg
let hasFFmpeg = false;
try { execSync('ffmpeg -version', { stdio: 'pipe' }); hasFFmpeg = true; } catch {}

console.log('Opening CASC...');
const handle = casclib.openStorageSync(WC3_PATH, ['FRFR', 'ALL']);
const allFiles = casclib.findFilesSync(handle, '*Units*');
console.log(`${allFiles.length} unit files in CASC\n`);

const extracted = [];

for (const char of CHARACTERS) {
  // Skip peasant/peon (already extracted)
  if (char.unit === 'Peasant' || char.unit === 'Peon') {
    extracted.push({ ...char, sounds: 0, status: 'already_exists' });
    continue;
  }

  // Find matching files
  const pattern = new RegExp(`frFR.*Units.*${char.race}.*${char.unit}.*\\.(wav|flac|mp3)$`, 'i');
  const matches = allFiles.filter(f => pattern.test(f.fullName));

  if (matches.length === 0) {
    console.log(`  SKIP ${char.name} (${char.race}/${char.unit}) - no files found`);
    extracted.push({ ...char, sounds: 0, status: 'not_found' });
    continue;
  }

  // Create output directory
  const packName = `${char.unit.toLowerCase()}_fr`;
  const packDir = path.join(PACKS_DIR, packName);
  const soundsDir = path.join(packDir, 'sounds');
  fs.mkdirSync(soundsDir, { recursive: true });

  console.log(`  Extracting ${char.name} (${matches.length} files)...`);

  const soundFiles = [];
  for (const file of matches) {
    try {
      const data = casclib.readFileSync(handle, file.fullName);
      const basename = path.basename(file.fullName);
      const ext = path.extname(basename).toLowerCase();
      const nameNoExt = path.basename(basename, ext);

      if (ext === '.flac' && hasFFmpeg) {
        // Convert FLAC to WAV
        const tmpFlac = path.join(soundsDir, basename);
        const outWav = path.join(soundsDir, nameNoExt + '.wav');
        fs.writeFileSync(tmpFlac, data);
        try {
          execSync(`ffmpeg -y -i "${tmpFlac}" -acodec pcm_s16le -ar 22050 "${outWav}"`, { stdio: 'pipe' });
          fs.unlinkSync(tmpFlac);
          soundFiles.push(nameNoExt + '.wav');
        } catch {
          soundFiles.push(basename); // keep flac
        }
      } else {
        fs.writeFileSync(path.join(soundsDir, basename), data);
        soundFiles.push(basename);
      }
    } catch (e) {
      // Skip failed files
    }
  }

  // Create openpeon.json manifest
  const manifest = {
    cesp_version: '1.0',
    name: packName,
    display_name: `${char.name} (FR)`,
    version: '1.0.0',
    language: 'fr',
    categories: {}
  };

  // Categorize sounds by filename pattern
  const categorize = (files) => {
    const cats = {
      'session.start': [], 'task.acknowledge': [], 'task.complete': [],
      'task.error': [], 'input.required': [], 'user.spam': [], 'resource.limit': []
    };
    for (const f of files) {
      const lower = f.toLowerCase();
      if (lower.includes('ready') || lower.includes('warcry')) {
        cats['session.start'].push(f);
        cats['task.complete'].push(f);
      } else if (lower.includes('what') || lower.includes('rdy')) {
        cats['input.required'].push(f);
        cats['session.start'].push(f);
      } else if (lower.includes('yes') || lower.includes('attack')) {
        cats['task.acknowledge'].push(f);
        if (!lower.includes('attack')) cats['task.complete'].push(f);
      } else if (lower.includes('pissed') || lower.includes('pss')) {
        cats['user.spam'].push(f);
      } else if (lower.includes('death') || lower.includes('dth')) {
        cats['task.error'].push(f);
      } else {
        // Default: put in acknowledge
        cats['task.acknowledge'].push(f);
      }
    }
    return cats;
  };

  const cats = categorize(soundFiles);
  for (const [cat, files] of Object.entries(cats)) {
    if (files.length > 0) {
      manifest.categories[cat] = {
        sounds: files.map(f => ({ file: `sounds/${f}`, label: f.replace(/\.(wav|flac|mp3)$/i, '') }))
      };
    }
  }

  fs.writeFileSync(path.join(packDir, 'openpeon.json'), JSON.stringify(manifest, null, 2));
  extracted.push({ ...char, sounds: soundFiles.length, status: 'ok', packName });
  console.log(`    -> ${soundFiles.length} sounds in ${packName}/`);
}

casclib.closeStorage(handle);

// Save character catalog
const catalogPath = path.join(__dirname, '..', 'characters.json');
fs.writeFileSync(catalogPath, JSON.stringify(extracted, null, 2));
console.log(`\nDone! ${extracted.filter(e => e.status === 'ok').length} characters extracted`);
console.log(`Catalog saved to ${catalogPath}`);
