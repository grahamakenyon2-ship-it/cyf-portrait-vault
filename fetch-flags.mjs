#!/usr/bin/env node
/**
 * FLAG KEEPER v4 - mirrors every banner the game's RW_FLAGS table names
 * from Wikimedia Commons into flags/ in this repo (the portrait vault),
 * so the game reads banners from GitHub Pages instead of hammering
 * Commons on every fresh session (playtest 429 storms).
 *
 * v4 (SLOW AND STEADY): even 90s backoffs got 429'd on the v3 run -
 * Wikimedia throttles GitHub Actions runner IPs hard, so patience WITHIN
 * one request is not enough. The keeper now (a) crawls at a steady 2.5s
 * between files, (b) backs off 30s/60s/120s on a 429 with x3 retries,
 * (c) works in CHUNKS: one run fetches at most BATCH banners (default
 * 80), commits what it got, and you simply re-run the workflow until it
 * reports the vault complete - so a cancelled or throttled run never
 * loses progress, and the host never sees a long burst.
 *
 * v2/v1 history: the title list travels in this repo as flags/titles.txt
 * (the game repo is private - a cross-repo checkout 404'd on this repo's
 * GITHUB_TOKEN). If a game repo happens to be checked out at game/, its
 * titles are merged in too.
 *
 * exit 0 = fetched some or nothing new - rerun to continue
 * exit 1 = every attempted banner failed this run - throttling or errors; rerun later
 * exit 2 = the vault is complete (nothing missing) - the workflow self-disables
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';

const TITLES = 'flags/titles.txt';
const GAME_PART = 'game/modules/13-flags.part';   // optional: a checked-out game repo with a newer RW_FLAGS
const FLAGS_DIR = 'flags';
const INDEX = 'flags/index.json';
const BATCH = parseInt(process.env.BATCH || '80', 10);
const CRAWL_MS = 2500;                            // steady crawl between files
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
let missing = titles.filter(t => !have.has(slug(t) + '.svg'));
console.log(have.size + ' already in the vault; ' + missing.length + ' still to fetch.');
if (!missing.length) {
  // nothing missing - clean up a stale failures list and report complete
  if (existsSync('flags/failures.txt')) writeFileSync('flags/failures.txt', '');
  process.exit(2);
}
const batch = missing.slice(0, BATCH);
console.log('this run will fetch ' + batch.length + ' (BATCH=' + BATCH + '); ' + (missing.length - batch.length) + ' remain for later runs.');

let index = { v: 1, files: {} };
try { index = JSON.parse(readFileSync(INDEX, 'utf8')); if (!index.files) index.files = {}; } catch {}

// resolve direct upload.wikimedia.org URLs via the CORS-clean MediaWiki API (50 titles per query)
const API = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&prop=imageinfo&iiprop=url%7Csize&titles=';
const directFor = new Map();
for (let i = 0; i < batch.length; i += 50) {
  const q = batch.slice(i, i + 50).map(t => 'File:' + t).join('|');
  const r = await fetch(API + encodeURIComponent(q), { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('MediaWiki API HTTP ' + r.status);
  const j = await r.json();
  for (const p of Object.values((j.query && j.query.pages) || {})) {
    if (p && p.title && p.imageinfo && p.imageinfo[0] && p.imageinfo[0].url) {
      directFor.set(p.title.replace(/^File:/, ''), p.imageinfo[0].url);
    }
  }
  await sleep(2000);
}

// the steady crawl: 2.5s between files, 30s/60s/120s backoff on a 429
let ok = 0;
const fail = [];
const BACKOFF = [30000, 60000, 120000];
for (const t of batch) {
  const u = directFor.get(t);
  const f = slug(t) + '.svg';
  if (!u) { console.warn('MISS (no such banner on Commons): ' + t); fail.push(t + ' (missing on Commons)'); await sleep(CRAWL_MS); continue; }
  let text = null, err = null;
  for (let attempt = 0; attempt <= BACKOFF.length; attempt++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA } });
      if (r.status === 429 && attempt < BACKOFF.length) {
        console.warn('429 on ' + t + ' - backing off ' + (BACKOFF[attempt] / 1000) + 's (attempt ' + (attempt + 1) + '/' + (BACKOFF.length + 1) + ')');
        await sleep(BACKOFF[attempt]);
        continue;
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      text = await r.text();
      break;
    } catch (e) { err = e; if (attempt < BACKOFF.length) await sleep(BACKOFF[attempt]); }
  }
  if (text && text.charCodeAt(0) === 60 && text.length <= 1200000) {
    writeFileSync(FLAGS_DIR + '/' + f, text);
    index.files[t] = { f, m: 'image/svg+xml', bytes: Buffer.byteLength(text) };
    ok++;
    console.log('ok ' + ok + ': ' + f);
  } else {
    const why = text ? 'not a sane svg' : ((err && err.message) || 'exhausted retries');
    console.warn('FAIL ' + t + ': ' + why);
    fail.push(t + ' (' + why + ')');
  }
  await sleep(CRAWL_MS);
}
writeFileSync(INDEX, JSON.stringify(index, null, 1) + '\n');
if (fail.length) writeFileSync('flags/failures.txt', fail.join('\n') + '\n');
console.log('fetched ' + ok + ', failed ' + fail.length + ', vault now holds ' + (have.size + ok) + ' of ' + titles.length + ' banners');
if (ok === 0 && fail.length) process.exit(1);   // total throttle-out: rerun later; keep the workflow enabled
process.exit(0);   // progress made (or nothing to do in this chunk): commit and rerun until exit 2
