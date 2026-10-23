#!/usr/bin/env node
// fateblade/organize-vault.mjs — Vault Grand Housekeeping (v0.28.0)
// Modes: report (dry-run, no mutation except nothing) | apply (moves + rewrites)
// Run from the REPO ROOT:  node fateblade/organize-vault.mjs report|apply
//
// Layout after apply (all fateblade-relative, keeper-compatible):
//   cards/<realm>/<slug>.jpg      canon + wayfarers minion portraits
//   commanders/<realm>.jpg        all 15 sovereigns (commanderFile = truth; fixes marches)
//   scenes/<realm>/<slug>.jpg     canon + wayfarers edict/relic art
//   annals/<realm>/<slug>.jpg     history minions + edicts (was vault/history + root art)
//   theme/*.jpg                   4 renamed uuid textures (game.html THEME const)
// UNBOUND art stays in art/stockpile, art/stockpile-cropped, art/scenes — zero keeper changes.
// Rewrites: data/cards.json (+cards.js byte-copy), manifest.json (indent 1),
//           portrait-queue.json + edict-scene-queue.json file refs, src/game.html theme refs.
// Exits nonzero on missing sources or dest collisions. Writes organize-report.json.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MODE = process.argv[2];
if (MODE !== 'report' && MODE !== 'apply') {
  console.error('usage: node fateblade/organize-vault.mjs report|apply');
  process.exit(2);
}
const ROOT = process.cwd();
const FB = path.join(ROOT, 'fateblade');           // fateblade/ tree
const fbRel = p => path.join(FB, p);               // fateblade-relative -> abs
const read = p => fs.readFileSync(p, 'utf8');
const exists = p => fs.existsSync(p);
const sha256 = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const slugify = n => String(n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const j1 = o => JSON.stringify(o, null, 1) + '\n';

const cards = JSON.parse(read(fbRel('data/cards.json')));
const manifest = JSON.parse(read(fbRel('manifest.json')));
const pQueue = JSON.parse(read(fbRel('portrait-queue.json')));
const eQueue = JSON.parse(read(fbRel('edict-scene-queue.json')));

const PAGES = cards.pages;                                  // https://...cyf-portrait-vault (no trailing slash)
const IMG = rel => `${PAGES}/fateblade/${rel}`;             // new universal img formula

// fateblade URL base derived from a live manifest entry (never hardcoded)
const probe = manifest.files.find(e => e.path.startsWith('art/stockpile/'));
if (!probe) { console.error('FATAL: cannot find an art/stockpile manifest entry to derive URL base'); process.exit(1); }
const FB_URL_BASE = probe.url.slice(0, probe.url.length - probe.path.length); // .../cyf-portrait-vault/fateblade/

// Theme texture renames — derived from game.html usage + disk, NEVER hardcoded (uuids are typo-prone):
//   --theme-btn line -> fateblade-plate.jpg, --menu-bg -> menu-hall.jpg, --board-bg -> board-texture.jpg,
//   uuid on disk but unreferenced -> spare-texture.jpg
const THEME_MAP = (() => {
  const html = read(fbRel('src/game.html'));
  const uuidFiles = fs.readdirSync(fbRel('art')).filter(f => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/.test(f));
  const map = {};
  for (const f of uuidFiles) {
    const idx = html.indexOf(f);
    let name = null;
    if (idx !== -1) {
      const ctx = html.slice(Math.max(0, idx - 120), idx);
      if (ctx.includes('--theme-btn')) name = 'fateblade-plate.jpg';
      else if (ctx.includes('--menu-bg')) name = 'menu-hall.jpg';
      else if (ctx.includes('--board-bg')) name = 'board-texture.jpg';
    }
    if (!name) name = 'spare-texture.jpg';
    map['art/' + f] = 'theme/' + name;
  }
  if (uuidFiles.length < 4) { console.error('FATAL: expected 4 uuid textures in art/, found ' + uuidFiles.length); process.exit(1); }
  return map;
})();

// ---------- plan ----------
const moves = [];            // {srcAbs, destRel, srcKey}
const byDest = new Map();    // destRel -> {srcs:Set, firstSrc}
const usedNames = new Map(); // destDir -> Set(slugs)
const cardUpdates = [];      // {card, oldFile, newFile, fac}
const cmdUpdates = [];      // {fac, oldFile, newFile}
const queueUpdates = { portrait: 0, edict: 0 };
const missing = [];
const collisions = [];
const bySrc = new Map(); // srcAbs -> {name, dest} for benign name+file reuse

// physical resolution: 'history/...' refs are vault-root-relative; everything else fateblade-relative
const phys = file => file.startsWith('history/') ? path.join(ROOT, 'vault', file) : fbRel(file);
// old manifest path for a physical file
const oldManifestPath = abs => abs.startsWith(FB + path.sep)
  ? path.relative(FB, abs)
  : path.relative(ROOT, abs); // vault/history/... is repo-root-relative in the manifest

function claimSlug(dir, name) {
  let base = slugify(name);
  if (!base) base = 'unnamed';
  const used = usedNames.get(dir) || new Set();
  let s = base, i = 2;
  while (used.has(s)) { s = base + '-' + i; i++; }
  used.add(s);
  usedNames.set(dir, used);
  return s;
}

function planMove(srcAbs, destRel) {
  let entry = byDest.get(destRel);
  if (!entry) {
    entry = { srcs: new Set() };
    byDest.set(destRel, entry);
    moves.push({ srcAbs, destRel });
  }
  entry.srcs.add(srcAbs);
}

// 1. Cards
let cardsScanned = 0, annals = 0, canonMinion = 0, canonScene = 0;
for (const fac of cards.factions) {
  const isHistory = fac.pool === 'history';
  for (const card of fac.cards) {
    cardsScanned++;
    if (!card.file) continue;
    const src = phys(card.file);
    const isPortrait = card.file.startsWith('art/stockpile');
    let dir;
    if (isHistory) { dir = `annals/${fac.id}`; annals++; }
    else if (isPortrait) { dir = `cards/${fac.id}`; canonMinion++; }
    else { dir = `scenes/${fac.id}`; canonScene++; }
    if (!exists(src)) { missing.push({ what: `card ${card.id} file`, ref: card.file }); continue; }
    // Benign reuse: two cards with the SAME name and SAME source file share ONE output file
    // (Marius pair). Different names sharing a source (Vessmora pair) split via byte-copy.
    let destRel;
    const prev = bySrc.get(src);
    if (prev && prev.name === card.name) destRel = prev.dest;
    else {
      destRel = `${dir}/${claimSlug(dir, card.name)}.jpg`;
      bySrc.set(src, { name: card.name, dest: destRel });
    }
    planMove(src, destRel);
    cardUpdates.push({ card, oldFile: card.file, newFile: destRel, fac, isHistory });
  }
  // 2. Commander (commanderFile is the truth; fixes the marches mismatch)
  if (fac.commanderFile) {
    const src = phys(fac.commanderFile);
    const destRel = `commanders/${fac.id}.jpg`;
    if (!exists(src)) { missing.push({ what: `commander ${fac.id} file`, ref: fac.commanderFile }); continue; }
    planMove(src, destRel);
    cmdUpdates.push({ fac, oldFile: fac.commanderFile, newFile: destRel });
  }
}

// 3. Theme textures
for (const [oldRel, destRel] of Object.entries(THEME_MAP)) {
  const src = fbRel(oldRel);
  if (!exists(src)) { missing.push({ what: 'theme texture', ref: oldRel }); continue; }
  planMove(src, destRel);
}

// collisions: one dest claimed by two different sources
for (const [destRel, e] of byDest) if (e.srcs.size > 1) collisions.push(destRel);

// src usage: rename once, copy the rest (handles Vessmora split + commander/card face reuse)
const srcCount = new Map();
for (const m of moves) srcCount.set(m.srcAbs, (srcCount.get(m.srcAbs) || 0) + 1);

// ---------- apply or report ----------
const applying = MODE === 'apply';
let manifestUpdates = 0, manifestAdds = 0;

if (applying) {
  // Group by source: single-dest srcs rename; multi-dest srcs (commander/card face reuse,
  // Vessmora split, theme/scene dual-use) copy to all but the LAST dest, then rename to it.
  const bySrc = new Map();
  for (const m of moves) {
    if (!bySrc.has(m.srcAbs)) bySrc.set(m.srcAbs, []);
    bySrc.get(m.srcAbs).push(m.destRel);
  }
  for (const [srcAbs, dests] of bySrc) {
    for (let i = 0; i < dests.length - 1; i++) {
      fs.mkdirSync(path.dirname(fbRel(dests[i])), { recursive: true });
      fs.copyFileSync(srcAbs, fbRel(dests[i]));
    }
    fs.mkdirSync(path.dirname(fbRel(dests[dests.length - 1])), { recursive: true });
    fs.renameSync(srcAbs, fbRel(dests[dests.length - 1]));
  }

  // cards.json + cards.js
  for (const u of cardUpdates) { u.card.file = u.newFile; u.card.img = IMG(u.newFile); }
  for (const u of cmdUpdates) { u.fac.commanderFile = u.newFile; u.fac.commander = IMG(u.newFile); }
  cards.version = '0.28.0';
  // cards.json live format: JSON.stringify(doc, null, 1) with NO trailing newline (byte-preserving convention)
  fs.writeFileSync(fbRel('data/cards.json'), JSON.stringify(cards, null, 1));
  fs.writeFileSync(fbRel('data/cards.js'), 'window.CARDS = ' + JSON.stringify(cards) + ';\n');

  // queues (file refs only; unbound refs untouched)
  const refMap = new Map(cardUpdates.map(u => [u.oldFile, u.newFile]));
  for (const q of pQueue.queue) if (q.file && refMap.has(q.file)) { q.file = refMap.get(q.file); queueUpdates.portrait++; }
  for (const q of eQueue.queue) if (q.file && refMap.has(q.file)) { q.file = refMap.get(q.file); queueUpdates.edict++; }
  fs.writeFileSync(fbRel('portrait-queue.json'), j1(pQueue));   // live format: indent 1 + newline
  fs.writeFileSync(fbRel('edict-scene-queue.json'), j1(eQueue));

  // manifest: moved + split entries
  const manIdx = new Map(manifest.files.map(e => [e.path, e]));
  for (const p of ['data/cards.json', 'data/cards.js']) { // rewritten above -> sha bump
    const e = manIdx.get(p);
    if (e) { e.sha256 = sha256(fbRel(p)); manifestUpdates++; }
    else { console.error('FATAL: manifest entry missing for ' + p); process.exit(1); }
  }
  for (const m of moves) {
    const omp = oldManifestPath(m.srcAbs);
    const srcEntry = manIdx.get(omp);
    const destAbs = fbRel(m.destRel);
    const dig = sha256(destAbs);
    const url = FB_URL_BASE + m.destRel;
    if (srcEntry) {
      srcEntry.path = m.destRel; srcEntry.sha256 = dig; srcEntry.url = url;
      manIdx.delete(omp); manIdx.set(m.destRel, srcEntry);
      manifestUpdates++;
    } else {
      const add = { path: m.destRel, sha256: dig, url };
      manifest.files.push(add); manIdx.set(m.destRel, add);
      manifestAdds++;
    }
  }

  // game.html: THEME const + renamed texture refs + manifest sha bump
  let html = read(fbRel('src/game.html'));
  const ART_LINE = "const ART = (DATA.art || 'https://grahamakenyon2-ship-it.github.io/cyf-portrait-vault/fateblade/art');";
  if (!html.includes(ART_LINE)) { console.error('FATAL: ART const not found in src/game.html'); process.exit(1); }
  html = html.replace(ART_LINE, ART_LINE + "\nconst THEME = ART.replace(/\\/art$/, '/theme'); // v0.28.0 vault housekeeping: theme textures live in fateblade/theme/");
  const uuidRefs = Object.entries(THEME_MAP)
    .filter(([oldRel]) => oldRel !== Object.entries(THEME_MAP).find(([, n]) => n === 'theme/spare-texture.jpg')?.[0])
    .map(([oldRel, destRel]) => ['${ART}/' + oldRel.slice('art/'.length), '${THEME}/' + destRel.slice('theme/'.length)]);
  for (const [a, b] of uuidRefs) {
    if (!html.includes(a)) { console.error('FATAL: theme ref not found: ' + a); process.exit(1); }
    html = html.split(a).join(b);
  }
  fs.writeFileSync(fbRel('src/game.html'), html);
  const gh = manIdx.get('src/game.html');
  if (gh) { gh.sha256 = sha256(fbRel('src/game.html')); manifestUpdates++; }

  manifest.version = '0.28.0';
  fs.writeFileSync(fbRel('manifest.json'), j1(manifest));

  // prune empty dirs: vault/history subtree (never other vault/ content), fateblade/art moved dirs
  const pruneEmpty = dir => {
    let any = false;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (pruneEmpty(path.join(dir, e.name))) fs.rmdirSync(path.join(dir, e.name)); else any = true; }
      else any = true;
    }
    return !any; // true => dir is empty
  };
  if (exists(path.join(ROOT, 'vault/history'))) pruneEmpty(path.join(ROOT, 'vault/history'));
  pruneEmpty(fbRel('art/scenes')); pruneEmpty(fbRel('art/stockpile')); pruneEmpty(fbRel('art/stockpile-cropped'));
}

// ---------- report ----------
const split = moves.filter(m => (srcCount.get(m.srcAbs) || 0) > 1);
const report = {
  mode: MODE, cardsVersion: cards.version, manifestVersion: manifest.version,
  cardsScanned, canonMinion, canonScene, annals,
  moves: moves.length, splits: split.length,
  commanders: cmdUpdates.length,
  themeTextures: Object.keys(THEME_MAP).length,
  manifestUpdates: applying ? manifestUpdates : 'n/a (apply only)',
  manifestAdds: applying ? manifestAdds : 'n/a (apply only)',
  queueUpdates: applying ? queueUpdates : 'n/a (apply only)',
  missing: missing.length, collisions: collisions.length,
  splitDetail: split.map(m => path.relative(ROOT, m.srcAbs) + ' -> ' + m.destRel),
  missingRefs: missing, collisionDests: collisions,
};
fs.writeFileSync(fbRel('organize-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, missingRefs: `${missing.length} listed in fateblade/organize-report.json`, collisionDests: collisions.length }, null, 2));

if (missing.length || collisions.length) {
  console.error(`\nNOT CLEAN: ${missing.length} missing sources, ${collisions.length} collisions — aborting without ${applying ? 'completing' : 'approving'}.`);
  process.exit(1);
}
console.log(`\n${applying ? 'APPLY complete' : 'REPORT clean'} — ${moves.length} planned moves (${split.length} copies), ${cmdUpdates.length} commanders, ${annals} annals + ${canonMinion} canon portraits + ${canonScene} canon scenes.`);
