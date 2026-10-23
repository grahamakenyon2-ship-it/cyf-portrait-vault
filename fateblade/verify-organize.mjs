#!/usr/bin/env node
// verify-organize.mjs — post-apply sanity suite for organize-vault.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const ROOT = process.cwd();
const FB = path.join(ROOT, 'fateblade');
const fbRel = p => path.join(FB, p);
const exists = p => fs.existsSync(p);
const sha256 = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.log('FAIL:', msg); fails++; } };

const cards = JSON.parse(fs.readFileSync(fbRel('data/cards.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(fbRel('manifest.json'), 'utf8'));
const pQueue = JSON.parse(fs.readFileSync(fbRel('portrait-queue.json'), 'utf8'));
const eQueue = JSON.parse(fs.readFileSync(fbRel('edict-scene-queue.json'), 'utf8'));
const PAGES = cards.pages;
const IMG = rel => `${PAGES}/fateblade/${rel}`;

ok(cards.version === '0.28.0', 'cards.json version 0.28.0, got ' + cards.version);
ok(manifest.version === '0.28.0', 'manifest version 0.28.0, got ' + manifest.version);

// 1. cards: every file exists, img formula exact, ref domains correct
let n = 0;
for (const fac of cards.factions) {
  for (const c of fac.cards) {
    n++;
    if (!c.file) continue;
    ok(c.file.startsWith('cards/') || c.file.startsWith('scenes/') || c.file.startsWith('annals/') || c.file.startsWith('commanders/'),
      `card ${c.id} file in new layout, got ${c.file}`);
    ok(exists(fbRel(c.file)), `card ${c.id} file on disk: ${c.file}`);
    ok(c.img === IMG(c.file), `card ${c.id} img formula`);
  }
  if (fac.commanderFile) {
    ok(fac.commanderFile.startsWith('commanders/'), `${fac.id} commanderFile`);
    ok(exists(fbRel(fac.commanderFile)), `${fac.id} commanderFile on disk`);
    ok(fac.commander === IMG(fac.commanderFile), `${fac.id} commander img formula`);
  }
}
ok(n === 1738, '1738 cards, got ' + n);

// marches fix specifically
const marches = cards.factions.find(f => f.id === 'marches');
ok(marches.commander === IMG('commanders/marches.jpg'), 'marches commander fixed (was uncropped mismatch)');

// 2. serialization formats
const cs = fs.readFileSync(fbRel('data/cards.json'), 'utf8');
ok(cs === JSON.stringify(cards, null, 1), 'cards.json indent-1, no trailing newline');
const cjs = fs.readFileSync(fbRel('data/cards.js'), 'utf8');
ok(cjs === 'window.CARDS = ' + JSON.stringify(cards) + ';\n', 'cards.js byte-copy formula');
const ms = fs.readFileSync(fbRel('manifest.json'), 'utf8');
ok(ms === JSON.stringify(manifest, null, 1) + '\n', 'manifest indent-1 + newline');

// 3. manifest: every entry resolves on disk with matching sha and url
let manFail = 0, fateCount = 0, other = 0;
const seen = new Set();
for (const e of manifest.files) {
  if (seen.has(e.path)) { ok(false, 'manifest duplicate path ' + e.path); continue; }
  seen.add(e.path);
  const abs = e.path.startsWith('src/') || e.path.startsWith('data/') || e.path.startsWith('art/') || e.path.startsWith('audio/') || e.path.startsWith('cards/') || e.path.startsWith('scenes/') || e.path.startsWith('annals/') || e.path.startsWith('commanders/') || e.path.startsWith('theme/')
    ? fbRel(e.path) : path.join(ROOT, e.path);
  if (!exists(abs)) { if (manFail++ < 5) console.log('FAIL: manifest path missing on disk:', e.path); fails++; continue; }
  if (sha256(abs) !== e.sha256) { console.log('FAIL: sha mismatch', e.path); fails++; }
  if (e.path.startsWith('vault/')) { other++; ok(e.url.startsWith(PAGES + '/vault/'), 'vault url ' + e.url); }
  else { fateCount++; ok(e.url === PAGES + '/fateblade/' + e.path, 'fateblade url ' + e.path + ' -> ' + e.url); }
}
console.log(`manifest entries: ${manifest.files.length} (fateblade-tree ${fateCount}, other-root ${other})`);
// no stale vault/history entries left
ok(!manifest.files.some(e => e.path.startsWith('vault/history/')), 'no stale vault/history manifest entries');

// 4. queues: every minted ref resolves
let qn = 0, qMiss = 0;
for (const q of pQueue.queue) if (q.file) { qn++; if (!exists(fbRel(q.file))) { if (qMiss++ < 5) console.log('FAIL: portrait queue missing', q.file); fails++; } }
for (const q of eQueue.queue) if (q.file) { qn++; if (!exists(fbRel(q.file))) { if (qMiss++ < 5) console.log('FAIL: edict queue missing', q.file); fails++; } }
console.log(`queue refs checked: ${qn}, missing: ${qMiss}`);

// 5. game.html
const html = fs.readFileSync(fbRel('src/game.html'), 'utf8');
ok(html.includes("const THEME = ART.replace(/\\/art$/, '/theme');"), 'game.html THEME const');
ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg/.test(html), 'game.html has no uuid jpg refs left');
ok(html.includes('${THEME}/fateblade-plate.jpg') && html.includes('${THEME}/menu-hall.jpg') && html.includes('${THEME}/board-texture.jpg'), 'game.html 3 theme refs');
const gh = manifest.files.find(e => e.path === 'src/game.html');
ok(gh && gh.sha256 === sha256(fbRel('src/game.html')), 'manifest game.html sha current');

// 6. theme dir
for (const t of ['fateblade-plate', 'board-texture', 'menu-hall', 'spare-texture']) ok(exists(fbRel('theme/' + t + '.jpg')), 'theme/' + t + '.jpg');
ok(fs.readdirSync(fbRel('art')).filter(f => /^[0-9a-f]{8}-/.test(f)).length === 0, 'no uuid files left in art/ root');

// 7. leftover state
const histLeft = exists(path.join(ROOT, 'vault/history')) ? fs.readdirSync(path.join(ROOT, 'vault/history')).length : 0;
console.log('vault/history leftover subdirs:', histLeft);
const stockLeft = fs.readdirSync(fbRel('art/stockpile')).length;
const cropLeft = fs.readdirSync(fbRel('art/stockpile-cropped')).length;
const scenesLeft = fs.readdirSync(fbRel('art/scenes')).length;
console.log(`unbound leftovers kept: stockpile ${stockLeft}, stockpile-cropped ${cropLeft}, scenes ${scenesLeft}`);

// 8. no card references stockpile/scenes/history roots anymore
for (const fac of cards.factions) for (const c of fac.cards) {
  if (c.file && (c.file.startsWith('art/') || c.file.startsWith('history/'))) { ok(false, 'stale ref ' + c.file); }
}

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} FAILURES`);
process.exit(fails ? 1 : 0);
