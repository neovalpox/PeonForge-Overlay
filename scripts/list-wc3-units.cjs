const casclib = require('casclib');
const path = require('path');
const fs = require('fs');

console.log('Opening CASC...');
const handle = casclib.openStorageSync('C:\\Program Files (x86)\\Warcraft III', ['FRFR']);

console.log('Searching unit voice files...');
const files = casclib.findFilesSync(handle, '*Units*');
console.log(`Found ${files.length} unit-related files`);

// Show a few samples to understand path format
let shown = 0;
for (const f of files) {
  if (f.fullName.includes('frFR') && /\.(wav|flac|mp3)$/i.test(f.fullName)) {
    if (shown < 10) { console.log(`  SAMPLE: ${f.fullName}`); shown++; }
  }
}

const units = {};
for (const f of files) {
  const fn = f.fullName;
  if (!fn.includes('frFR')) continue;
  if (!/\.(wav|flac|mp3)$/i.test(fn)) continue;

  // CASC paths look like: War3.w3mod:_Locales\frFR.w3mod:Units\Human\Peasant\PeasantWhat1.flac
  // Split on both \ and : to find Units/Race/Unit
  const parts = fn.replace(/:/g, '\\').split('\\');
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i] === 'Units' && i + 2 < parts.length) {
      const race = parts[i + 1];
      const unit = parts[i + 2];
      const sound = parts[parts.length - 1];
      const key = `${race}/${unit}`;
      if (!units[key]) units[key] = { race, unit, sounds: [], paths: [] };
      units[key].sounds.push(sound);
      units[key].paths.push(fn);
      break;
    }
  }
}

const sorted = Object.values(units)
  .filter(u => u.sounds.length >= 5)
  .sort((a, b) => a.race.localeCompare(b.race) || a.unit.localeCompare(b.unit));

console.log(`\n${sorted.length} units with 5+ voice lines:\n`);
console.log('Race'.padEnd(14) + 'Unit'.padEnd(30) + 'Sons');
console.log('-'.repeat(55));
for (const u of sorted) {
  console.log(`${u.race.padEnd(14)}${u.unit.padEnd(30)}${u.sounds.length}`);
}

// Save JSON
const outPath = path.join(__dirname, '..', 'wc3-units.json');
fs.writeFileSync(outPath, JSON.stringify(sorted.map(u => ({
  race: u.race, unit: u.unit, soundCount: u.sounds.length, paths: u.paths
})), null, 2));
console.log(`\nSaved to ${outPath}`);

casclib.closeStorage(handle);
