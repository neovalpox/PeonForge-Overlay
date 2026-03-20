const casclib = require('casclib');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Map character name -> preferred icon CASC path
const ICONS = {
  'peasant_fr':          'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNPeasant.dds',
  'peon_fr':             'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNPeon.dds',
  'footman_fr':          'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNFootman.dds',
  'grunt_fr':            'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNGrunt.dds',
  'archer_fr':           'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNArcher.dds',
  'ghoul_fr':            'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNGhoul.dds',
  'sorceress_fr':        'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNSorceress.dds',
  'witchdoctor_fr':      'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNWitchDoctor.dds',
  'dryad_fr':            'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNDryad.dds',
  'banshee_fr':          'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNBanshee.dds',
  'knight_fr':           'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNKnight.dds',
  'tauren_fr':           'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNTauren.dds',
  'priest_fr':           'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNPriest.dds',
  'shaman_fr':           'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNShaman.dds',
  'druidoftheclaw_fr':   'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNDruidOfTheClaw.dds',
  'heropaladin_fr':      'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNHeroPaladin.dds',
  'herofarseer_fr':      'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNHeroFarseer.dds',
  'herokeeperofthegrove_fr': 'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNKeeperOfTheGrove.dds',
  'herodeathknight_fr':  'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNHeroDeathKnight.dds',
  'heromountainking_fr': 'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNHeroMountainKing.dds',
  'arthas_fr':           'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNArthas.dds',
  'thrall_fr':           'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNThrall.dds',
  'jaina_fr':            'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNJaina.dds',
  'tyrande_fr':          'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNTyrande.dds',
  'uther_fr':            'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNUther.dds',
  'herolich_fr':         'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNHeroLich.dds',
  'herodreadlord_fr':    'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNHeroDreadLord.dds',
  'heroshadowhunter_fr': 'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNShadowHunter.dds',
  'ladyvashj_fr':        'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNLadyVashj.dds',
  'evilarthas_fr':       'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNArthasEvil.dds',
  'maiev_fr':            'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNMaiev.dds',
  'cairne_fr':           'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNCairneBloodhoof.dds',
  'illidan_fr':          'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNHeroDemonHunter.dds',
  'herodemonhunter_fr':  'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNHeroDemonHunter.dds',
  'pandarenbrewmaster_fr': 'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNPandarenBrewmaster.dds',
  'kelthuzadlich_fr':    'War3.w3mod:_HD.w3mod:ReplaceableTextures\\CommandButtons\\BTNKelThuzad.dds',
};

// Fallback: classic (non-HD) icons
const FALLBACK = {};
for (const [pack, hdPath] of Object.entries(ICONS)) {
  FALLBACK[pack] = hdPath.replace('_HD.w3mod:', '');
}

const OUTPUT_DIR = path.join(__dirname, '..', 'assets', 'icons');
const WEB_DIR = path.join(__dirname, '..', '..', 'PeonForge', 'deploy', 'assets', 'icons');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(WEB_DIR, { recursive: true });

console.log('Opening CASC...');
const handle = casclib.openStorageSync('C:\\Program Files (x86)\\Warcraft III', ['ALL']);

let extracted = 0;
for (const [pack, cascPath] of Object.entries(ICONS)) {
  let data;
  try {
    data = casclib.readFileSync(handle, cascPath);
  } catch {
    // Try fallback
    try {
      data = casclib.readFileSync(handle, FALLBACK[pack]);
    } catch {
      console.log(`  SKIP ${pack} - icon not found`);
      continue;
    }
  }

  const ddsPath = path.join(OUTPUT_DIR, `${pack}.dds`);
  const pngPath = path.join(OUTPUT_DIR, `${pack}.png`);
  const webPngPath = path.join(WEB_DIR, `${pack}.png`);

  fs.writeFileSync(ddsPath, data);

  // Convert DDS to PNG with ffmpeg
  try {
    execSync(`ffmpeg -y -i "${ddsPath}" -vf "scale=64:64" "${pngPath}"`, { stdio: 'pipe' });
    // Also copy to web directory
    fs.copyFileSync(pngPath, webPngPath);
    fs.unlinkSync(ddsPath);
    extracted++;
    console.log(`  OK ${pack}.png`);
  } catch (e) {
    console.log(`  FAIL ${pack}: ffmpeg error`);
    fs.unlinkSync(ddsPath);
  }
}

casclib.closeStorage(handle);
console.log(`\nExtracted ${extracted} icons to ${OUTPUT_DIR} and ${WEB_DIR}`);
