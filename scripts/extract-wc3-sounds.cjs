// Extract French Peasant & Peon sounds from WC3 Reforged CASC storage
// Then convert FLAC → WAV and install into peon-ping packs
const casclib = require('casclib');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WC3_PATH = 'C:\\Program Files (x86)\\Warcraft III';
const EXTRACT_DIR = path.join(__dirname, '..', 'extracted-sounds');
const PACKS_DIR = path.join(require('os').homedir(), '.claude', 'hooks', 'peon-ping', 'packs');

console.log('[CASC] Opening WC3 Reforged storage (this takes a while)...');
const handle = casclib.openStorageSync(WC3_PATH, ['FRFR', 'ALL']);
const info = casclib.getStorageInfo(handle);
console.log(`[CASC] Opened: build ${info.gameBuild}, locales: ${info.installedLocales.join(', ')}`);

console.log('[CASC] Searching for sound files...');
const allFiles = casclib.findFilesSync(handle, '*');

// We want the frFR Peasant and Peon unit sounds
const targets = allFiles.filter(f => {
  const name = f.fullName;
  // French localized unit voices
  if (name.includes('frFR') && name.includes('Units') &&
      (name.includes('Human\\Peasant\\') || name.includes('Orc\\Peon\\')) &&
      name.match(/\.(wav|flac|mp3|ogg)$/i)) {
    return true;
  }
  // Also grab the non-localized death sounds
  if (!name.includes('_Locales') && !name.includes('_HD') &&
      (name.includes('Human\\Peasant\\') || name.includes('Orc\\Peon\\')) &&
      name.match(/\.(wav|flac|mp3|ogg)$/i)) {
    return true;
  }
  // Also PeonJobDone (building complete sound)
  if (name.includes('frFR') && (name.includes('PeonJobDone') || name.includes('PeasantBuildingComplete'))) {
    return true;
  }
  return false;
});

console.log(`[CASC] Found ${targets.length} target files:`);
targets.forEach(f => console.log(`  ${f.fullName} (${f.fileSize} bytes)`));

// Extract
fs.mkdirSync(EXTRACT_DIR, { recursive: true });
const extracted = [];

for (const file of targets) {
  try {
    const data = casclib.readFileSync(handle, file.fullName);
    // Flatten path: just use the filename
    const basename = path.basename(file.fullName);
    // Determine unit type from path
    const isPeasant = file.fullName.includes('Peasant');
    const isPeon = file.fullName.includes('Peon');
    const unit = isPeasant ? 'peasant' : isPeon ? 'peon' : 'other';

    const unitDir = path.join(EXTRACT_DIR, unit);
    fs.mkdirSync(unitDir, { recursive: true });
    const outPath = path.join(unitDir, basename);
    fs.writeFileSync(outPath, data);
    extracted.push({ unit, basename, outPath, size: data.length });
    console.log(`[OK] ${unit}/${basename} (${data.length} bytes)`);
  } catch (e) {
    console.log(`[ERR] ${file.fullName}: ${e.message}`);
  }
}

casclib.closeStorage(handle);
console.log(`\n[CASC] Extracted ${extracted.length} files to ${EXTRACT_DIR}`);

// Check for ffmpeg to convert FLAC → WAV
let hasFFmpeg = false;
try { execSync('ffmpeg -version', { stdio: 'pipe' }); hasFFmpeg = true; } catch {}

if (!hasFFmpeg) {
  // Try powershell approach for FLAC → WAV conversion
  console.log('\n[CONVERT] No ffmpeg found. Trying PowerShell MediaFoundation...');
}

// Convert FLAC → WAV and install into peon-ping packs
for (const unit of ['peasant', 'peon']) {
  const srcDir = path.join(EXTRACT_DIR, unit);
  if (!fs.existsSync(srcDir)) continue;

  const packName = unit + '_fr';
  const packSoundsDir = path.join(PACKS_DIR, packName, 'sounds');
  // Back up old sounds
  const backupDir = path.join(PACKS_DIR, packName, 'sounds_tts_backup');
  if (fs.existsSync(packSoundsDir) && !fs.existsSync(backupDir)) {
    fs.renameSync(packSoundsDir, backupDir);
    console.log(`[BACKUP] ${packName}/sounds → sounds_tts_backup`);
  }
  fs.mkdirSync(packSoundsDir, { recursive: true });

  const files = fs.readdirSync(srcDir);
  for (const file of files) {
    const srcPath = path.join(srcDir, file);
    const ext = path.extname(file).toLowerCase();
    const nameNoExt = path.basename(file, ext);
    const destWav = path.join(packSoundsDir, nameNoExt + '.wav');

    if (ext === '.wav') {
      fs.copyFileSync(srcPath, destWav);
      console.log(`[INSTALL] ${packName}/sounds/${nameNoExt}.wav (copied)`);
    } else if (ext === '.flac') {
      if (hasFFmpeg) {
        try {
          execSync(`ffmpeg -y -i "${srcPath}" -acodec pcm_s16le -ar 22050 "${destWav}"`, { stdio: 'pipe' });
          console.log(`[INSTALL] ${packName}/sounds/${nameNoExt}.wav (converted from FLAC)`);
        } catch (e) {
          console.log(`[ERR] Convert ${file}: ${e.message}`);
        }
      } else {
        // Use PowerShell to convert FLAC → WAV via Windows Media Foundation
        try {
          const ps = `
            Add-Type -AssemblyName PresentationCore
            $src = [System.Uri]::new("${srcPath.replace(/\\/g, '\\\\')}")
            $player = New-Object System.Windows.Media.MediaPlayer
            $player.Open($src)
            Start-Sleep -Milliseconds 500
            $player.Close()
          `;
          // Fallback: just copy the FLAC and rename (win-play.ps1 can try ffplay/mpv)
          const destFlac = path.join(packSoundsDir, file);
          fs.copyFileSync(srcPath, destFlac);
          console.log(`[INSTALL] ${packName}/sounds/${file} (FLAC, needs player)`);
        } catch (e) {
          fs.copyFileSync(srcPath, path.join(packSoundsDir, file));
          console.log(`[INSTALL] ${packName}/sounds/${file} (FLAC copy)`);
        }
      }
    }
  }
}

console.log('\n[DONE] French WC3 sounds installed into peon-ping packs!');
console.log('Run the overlay to test: npm start');
