#!/usr/bin/env node
/**
 * FATEBLADE EDICT/RELIC ART KEEPER v1.0 - mirrors one open-source image per
 * Fateblade edict and relic (44 + 15, named for Annals history/fandom) from
 * Wikimedia Commons (or a direct URL) into fateblade/art/ in this repo, and
 * updates fateblade/manifest.json so the Patcher ships every fetched file.
 *
 * Same skeleton as the CYF flag keeper (fetch-flags.mjs v5.2): slow steady
 * crawl, 30/60/120s backoff on 429/network errors, wall-clock budget so a
 * run always commits its chunk, exit codes the workflow understands.
 *
 * Sources live in fateblade/art/edict-sources.txt:
 *   fname.jpg | commons:<search query>     -> Commons search, first bitmap hit
 *   fname.jpg | commons:File:Exact Name.jpg -> exact Commons file
 *   fname.jpg | https://...                -> direct URL
 * Images are saved as ~1200px-wide Commons thumbs (keeps the repo light);
 * exact/commons fetches ask the MediaWiki API for a thumburl at THUMB_W.
 *
 * exit 0 = fetched some or nothing new - rerun to continue
 * exit 1 = every attempted fetch failed this run - rerun later
 * exit 2 = vault complete (nothing missing) - the workflow self-disables
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SRCS     = 'fateblade/art/edict-sources.txt';
const ART      = 'fateblade/art';
const INDEX    = ART + '/edict-index.json';
const MANIFEST = 'fateblade/manifest.json';
const FAILURES = ART + '/edict-art-failures.txt';
const PAGES    = 'https://grahamakenyon2-ship-it.github.io/cyf-portrait-vault/fateblade/';

const BATCH    = parseInt(process.env.BATCH || '20', 10);
const CRAWL_MS = 2500;
const BACKOFF  = [30000, 60000, 120000];
const BUDGET_MS = parseInt(process.env.BUDGET_MIN || '35', 10) * 60 * 1000;
const THUMB_W  = 1200;
const UA = 'fateblade-art-vault/1.0 (https://github.com/grahamakenyon2-ship-it/cyf-portrait-vault)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
class Unrecoverable extends Error {}
const T0 = Date.now();
const outOfTime = () => Date.now() - T0 > BUDGET_MS;

mkdirSync(ART, { recursive: true });

// ---- load sources, index, manifest -------------------------------------------------
const lines = readFileSync(SRCS, 'utf8').split('\n').map(s => s.trim())
  .filter(l => l && !l.startsWith('#'));
const wanted = [];
for (const line of lines) {
  const bar = line.indexOf('|');
  if (bar < 0) { console.warn('bad line (no |): ' + line); continue; }
  wanted.push({ fname: line.slice(0, bar).trim(), src: line.slice(bar + 1).trim() });
}
console.log('the keeper wants ' + wanted.length + ' edict/relic artworks');

let index = { v: 1, files: {} };
try { index = JSON.parse(readFileSync(INDEX, 'utf8')); if (!index.files) index.files = {}; } catch {}
let manifest = null;
try { manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')); } catch {}
if (!manifest || !Array.isArray(manifest.files)) {
  console.error('cannot read ' + MANIFEST + ' - refusing to run (would not know how to rebuild it)');
  process.exit(1);
}
const mpath = new Map(manifest.files.map(e => [e.path, e]));
console.log('manifest at version ' + manifest.version + ' with ' + manifest.files.length + ' entries');

// ---- what is missing? -------------------------------------------------------------
const missing = wanted.filter(w => {
  const done = index.files[w.fname];
  return !(done && done.src === w.src && existsSync(ART + '/' + w.fname));
});
console.log((wanted.length - missing.length) + ' already in the vault; ' + missing.length + ' still to fetch.');
if (!missing.length) {
  if (existsSync(FAILURES)) writeFileSync(FAILURES, '');
  console.log('EDICT/RELIC ART VAULT COMPLETE');
  process.exit(2);
}
const batch = missing.slice(0, BATCH);
console.log('this run will fetch ' + batch.length + ' (BATCH=' + BATCH + '); ' +
  (missing.length - batch.length) + ' remain for later runs.');

// ---- Commons helpers ---------------------------------------------------------------
async function api(params) {
  for (let attempt = 0; attempt <= BACKOFF.length; attempt++) {
    try {
      const r = await fetch('https://commons.wikimedia.org/w/api.php?' + params,
        { headers: { 'User-Agent': UA } });
      if (r.status === 429) { if (attempt < BACKOFF.length) { console.log('429 api - backoff ' + BACKOFF[attempt] / 1000 + 's'); await sleep(BACKOFF[attempt]); continue; } throw new Unrecoverable('429 even after backoffs'); }
      if (!r.ok) throw new Error('Commons API HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (e instanceof Unrecoverable || attempt >= BACKOFF.length) throw e;
      await sleep(BACKOFF[attempt]);
    }
  }
  throw new Error('unreachable');
}

// Resolve a source line to a fetchable URL. Exact files and search hits both
// come back as a 1200px thumburl when the original is a large bitmap.
async function resolve(src) {
  if (/^https?:\/\//.test(src)) return src;
  if (!src.startsWith('commons:')) throw new Error('unrecognized source scheme: ' + src);
  const q = src.slice(8).trim();
  let title = null;
  if (/^file:/i.test(q)) {
    title = q;
  } else {
    // search the File namespace for bitmaps; take the first sane hit
    const j = await api('action=query&format=json&origin=*&list=search&srnamespace=6&srlimit=10&srsearch=' +
      encodeURIComponent(q + ' filetype:bitmap'));
    const hits = ((j.query && j.query.search) || []).map(h => h.title);
    if (!hits.length) throw new Error('no search results on Commons: ' + q);
    title = hits[0];
    console.log('  search picked: ' + title);
  }
  const j = await api('action=query&format=json&origin=*&prop=imageinfo&iiprop=url%7Cmime&iiurlwidth=' + THUMB_W +
    '&titles=' + encodeURIComponent(title));
  for (const p of Object.values((j.query && j.query.pages) || {})) {
    const ii = p && p.imageinfo && p.imageinfo[0];
    if (ii && ii.mime && ii.mime !== 'image/svg+xml') {
      return ii.thumburl || ii.url;   // thumb keeps big paintings light
    }
  }
  throw new Error('no usable bitmap on Commons: ' + title);
}

// ---- the steady crawl ----------------------------------------------------------------
let ok = 0;
const fail = [];
for (const w of batch) {
  if (outOfTime()) { console.log('budget spent - committing what we have; the rest remain for the next run'); break; }
  try {
    const url = await resolve(w.src);
    let buf = null, err = null;
    for (let attempt = 0; attempt <= BACKOFF.length; attempt++) {
      try {
        const r = await fetch(url, { headers: { 'User-Agent': UA } });
        if (r.status === 429) { if (attempt < BACKOFF.length) { console.log('429 - backoff ' + BACKOFF[attempt] / 1000 + 's'); await sleep(BACKOFF[attempt]); continue; } throw new Unrecoverable('429 even after backoffs'); }
        if (!r.ok) throw new Unrecoverable('HTTP ' + r.status);
        buf = Buffer.from(await r.arrayBuffer());
        break;
      } catch (e) {
        if (e instanceof Unrecoverable || attempt >= BACKOFF.length) { err = e; break; }
        err = e; await sleep(BACKOFF[attempt]);
      }
    }
    if (!buf) throw new Error((err && err.message) || 'exhausted retries');
    if (buf.length < 5000) throw new Error('susprisingly small (' + buf.length + 'B) - not sane art');
    writeFileSync(ART + '/' + w.fname, buf);
    index.files[w.fname] = { f: w.fname, src: w.src, bytes: buf.length };
    // keep the patcher manifest in lockstep: every fetched file is shippable
    const rel = 'art/' + w.fname;
    mpath.set(rel, { path: rel, sha256: createHash('sha256').update(buf).digest('hex'), url: PAGES + rel });
    ok++;
    console.log('ok ' + ok + ': ' + w.fname + ' (' + Math.round(buf.length / 1024) + 'KB)');
  } catch (e) {
    console.warn('FAIL ' + w.fname + ': ' + ((e && e.message) || 'unknown'));
    fail.push(w.fname + ' (' + ((e && e.message) || 'unknown') + ')');
  }
  await sleep(CRAWL_MS);
}

// ---- persist ------------------------------------------------------------------------
manifest.files = [...mpath.values()];
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(INDEX, JSON.stringify(index, null, 1) + '\n');
if (fail.length) writeFileSync(FAILURES, fail.join('\n') + '\n');
else if (existsSync(FAILURES)) writeFileSync(FAILURES, '');
console.log('fetched ' + ok + ', failed ' + fail.length + '; manifest now ' + manifest.files.length + ' entries');
if (ok === 0 && fail.length) process.exit(1);
process.exit(0);
