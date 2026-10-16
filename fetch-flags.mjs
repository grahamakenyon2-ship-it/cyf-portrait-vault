#!/usr/bin/env node
/**
 * FLAG KEEPER v2 - mirrors every banner the game's RW_FLAGS table names
 * from Wikimedia Commons into flags/ in this repo (the portrait vault),
 * so the game reads banners from GitHub Pages instead of hammering
 * Commons on every fresh session (playtest 429 storms).
 *
 * v2: the title list now travels IN THIS REPO as flags/titles.txt (one
 * Commons "File:" title per line). The first version read it from a
 * cyf-game checkout - but cyf-game is PRIVATE, and this repo's
 * GITHUB_TOKEN cannot see it ("Error: Not Found" at the checkout step).
 * If the game repo happens to be checked out at game/ anyway (a future
 * maintainer with a PAT), newer titles there are merged in too - but the
 * committed list is the source of truth that always works.
 *
 * exit 0 = banners fetched/committed (or nothing new)
 * exit 1 = some banners failed - the workflow commits what it got; rerun later
 * exit 2 = the vault is complete (nothing missing, nothing failed) - self-disables
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';

const TITLES = 'flags/titles.txt';
const GAME_PART = 'game/modules/13-flags.part';   // optional override: a checked-out game repo with a newer RW_FLAGS
const FLAGS_DIR = 'flags';
const INDEX = 'flags/index.json';
const UA = 'cyf-flag-vault/1.0 (https://github.com/grahamakenyon2-ship-it/cyf-portrait-vault)';
const slug = t => String(t).toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let titles = readFileSync(TITLES, 'utf8').split('\n').map(s => s.trim()).filter(s => s.endsWith('.svg'));
if (existsSync(GAME_PART)) {
  const part = readFileSync(GAME_PART, 'utf8');
  const newer = [...part.matchAll(/"([^"]+\.svg)"/g)].map(m => m[1]);
  titles = [...new Set([...titles, ...newer])];
  console.log('game repo part found - merged its titles too');
}
titles = [...new Set(titles)].sort();
console.log('the keeper knows ' + titles.length + ' banner titles');

mkdirSync(FLAGS_DIR, { recursive: true });
const have = new Set(readdirSync(FLAGS_DIR).filter(f => f.endsWith('.svg')));
const missing = titles.filter(t => !have.has(slug(t) + '.svg'));
console.log(have.size + ' already in the vault; ' + missing.length + ' to fetch.');

let index = { v: 1, files: {} };
try { index = JSON.parse(readFileSync(INDEX, 'utf8')); if (!index.files) index.files = {}; } catch {}

// resolve direct upload.wikimedia.org URLs via the CORS-clean MediaWiki API (50 titles per query)
const API = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&prop=imageinfo&iiprop=url%7Csize&titles=';
const directFor = new Map();
for (let i = 0; i < missing.length; i += 50) {
  const batch = missing.slice(i, i + 50).map(t => 'File:' + t).join('|');
  const r = await fetch(API + encodeURIComponent(batch), { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('MediaWiki API HTTP ' + r.status);
  const j = await r.json();
  for (const p of Object.values((j.query && j.query.pages) || {})) {
    if (p && p.title && p.imageinfo && p.imageinfo[0] && p.imageinfo[0].url) {
      directFor.set(p.title.replace(/^File:/, ''), p.imageinfo[0].url);
    }
  }
  await sleep(400);
}

let ok = 0;
const fail = [];
for (const t of missing) {
  const u = directFor.get(t);
  const f = slug(t) + '.svg';
  if (!u) { console.warn('MISS (no such banner on Commons): ' + t); fail.push(t + ' (missing on Commons)'); continue; }
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const text = await r.text();
    if (!text || text.charCodeAt(0) !== 60 || text.length > 1200000) throw new Error('not a sane svg');
    writeFileSync(FLAGS_DIR + '/' + f, text);
    index.files[t] = { f, m: 'image/svg+xml', bytes: Buffer.byteLength(text) };
    ok++;
    await sleep(150);
  } catch (e) { console.warn('FAIL ' + t + ': ' + e.message); fail.push(t + ' (' + e.message + ')'); await sleep(1200); }
}
writeFileSync(INDEX, JSON.stringify(index, null, 1) + '\n');
if (fail.length) writeFileSync('flags/failures.txt', fail.join('\n') + '\n');
else if (existsSync('flags/failures.txt')) writeFileSync('flags/failures.txt', '');
console.log('fetched ' + ok + ', failed ' + fail.length + ', vault now holds ' + (have.size + ok) + ' banners');
if (!fail.length && !missing.length) process.exit(2);   // complete: the workflow self-disables
process.exit(fail.length ? 1 : 0);
