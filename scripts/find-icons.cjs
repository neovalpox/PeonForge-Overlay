const casclib = require('casclib');
const fs = require('fs');
const path = require('path');

console.log('Opening CASC...');
const handle = casclib.openStorageSync('C:\\Program Files (x86)\\Warcraft III', ['ALL']);

// Search for button/command icons (BTN = button icons in WC3)
console.log('Searching for unit icons...');
const btnFiles = casclib.findFilesSync(handle, '*BTN*');
const cmdFiles = casclib.findFilesSync(handle, '*CommandButtons*');
const iconFiles = [...btnFiles, ...cmdFiles];

console.log(`Found ${iconFiles.length} icon-related files`);

// Show samples
const seen = new Set();
let shown = 0;
for (const f of iconFiles) {
  if (f.fullName.match(/\.(blp|dds|png|tga)$/i) && !seen.has(f.fullName)) {
    seen.add(f.fullName);
    if (shown < 30) { console.log(`  ${f.fullName} (${f.fileSize})`); shown++; }
  }
}

// Search specifically for unit command button icons
console.log('\n--- Searching for specific unit icons ---');
const characters = [
  'Peasant', 'Peon', 'Footman', 'Grunt', 'Archer', 'Ghoul',
  'Sorceress', 'WitchDoctor', 'Dryad', 'Banshee', 'Knight', 'Tauren',
  'Priest', 'Shaman', 'Paladin', 'Arthas', 'Thrall', 'Jaina',
  'Illidan', 'Tyrande', 'Uther', 'Lich', 'DreadLord', 'Maiev',
  'DeathKnight', 'MountainKing', 'Cairne', 'ShadowHunter',
  'DemonHunter', 'KeeperOfTheGrove', 'Farseer', 'Vashj',
  'DruidOfTheClaw', 'Pandaren', 'KelThuzad', 'Abomination'
];

const results = {};
for (const char of characters) {
  const pattern = new RegExp(char, 'i');
  const matches = iconFiles.filter(f => pattern.test(f.fullName) && f.fullName.match(/\.(blp|dds|png|tga)$/i));
  if (matches.length > 0) {
    results[char] = matches.map(f => f.fullName);
    console.log(`  ${char}: ${matches.length} icons`);
    matches.slice(0, 3).forEach(m => console.log(`    ${m.fullName}`));
  } else {
    console.log(`  ${char}: NO ICONS`);
  }
}

fs.writeFileSync(path.join(__dirname, '..', 'wc3-icons.json'), JSON.stringify(results, null, 2));
casclib.closeStorage(handle);
