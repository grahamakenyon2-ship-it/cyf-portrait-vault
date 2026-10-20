#!/usr/bin/env node
/**
 * FATEBLADE AUDIO KEEPER v1.0 - mirrors CC0 sound effects (Kenney packs) and
 * public-domain music (Wikimedia Commons) into fateblade/audio/ in this repo,
 * and updates fateblade/manifest.json so the Patcher ships every fetched file
 * (license + source recorded in the manifest for the commercial audit trail).
 *
 * Same skeleton as fetch-edict-art.mjs: slow steady crawl, 30/60/120s backoff,
 * wall-clock budget so a run always commits its chunk, exit codes the workflow
 * understands.
 *
 * Sources live in fateblade/audio/audio-sources.txt:
 *   sfx/hit.ogg   | CC0           | kenney:impact-sounds:Audio/impactMetal_medium_000.ogg
 *   music/x.ogg   | Public domain | https://upload.wikimedia.org/...ogg
 *
 * exit 0 = fetched some or nothing new - rerun to continue
 * exit 1 = every attempted fetch failed this run - rerun later
 * exit 2 = vault complete (nothing missing) - the workflow self-disables
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const SRCS     = 'fateblade/audio/audio-sources.txt';
const AUDIO    = 'fateblade/audio';
const INDEX    = AUDIO + '/audio-index.json';
const MANIFEST = 'fateblade/manifest.json';
const FAILURES = AUDIO + '/audio-failures.txt';
const PAGES    = 'https://grahamakenyon2-ship-it.github.io/cyf-portrait-vault/fateblade/';

const BATCH     = parseInt(process.env.BATCH || '20', 10);
const CRAWL_MS  = 1500;
const BACKOFF   = [30000, 60000, 120000];
const BUDGET_MS = parseInt(process.env.BUDGET_MIN || '35', 10) * 60 * 1000;
const UA = 'fateblade-audio-vault/1.0 (https://github.com/grahamakenyon2-ship-it/cyf-portrait-vault)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
class Unrecoverable extends Error {}
const T0 = Date.now();
const outOfTime = () => Date.now() - T0 > BUDGET_MS;

// Kenney CC0 pack zips (pinned 2026-10; re-pin here if kenney.nl moves them).
const KENNEY = {
  'impact-sounds':    'https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip',
  'interface-sounds': 'https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip',
  'casino-audio':     'https://kenney.nl/media/pages/assets/casino-audio/2472606a04-1721639069/kenney_casino-audio.zip',
  'rpg-audio':        'https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip',
};
const zipCache = new Map(); // pack -> local zip path in a temp dir

mkdirSync(AUDIO, { recursive: true });

// ---- load sources, index, manifest -------------------------------------------------
const lines = readFileSync(SRCS, 'utf8').split('\n').map(s => s.trim())
  .filter(l => l && !l.startsWith('#'));
const wanted = [];
for (const line of lines) {
  const parts = line.split('|').map(s => s.trim());
  if (parts.length < 3) { console.warn('bad line (want slug | license | source): ' + line); continue; }
  wanted.push({ slug: parts[0], license: parts[1], src: parts.slice(2).join('|').trim() });
}
console.log('the keeper wants ' + wanted.length + ' audio files');

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
  const done = index.files[w.slug];
  return !(done && done.src === w.src && done.license === w.license && existsSync(AUDIO + '/' + w.slug));
});
console.log((wanted.length - missing.length) + ' already in the vault; ' + missing.length + ' still to fetch.');
if (!missing.length) {
  if (existsSync(FAILURES)) writeFileSync(FAILURES, '');
  console.log('FATEBLADE AUDIO VAULT COMPLETE');
  process.exit(2);
}
const batch = missing.slice(0, BATCH);
console.log('this run will fetch ' + batch.length + ' (BATCH=' + BATCH + '); ' +
  (missing.length - batch.length) + ' remain for later runs.');

// ---- fetching helpers ---------------------------------------------------------------
async function fetchBin(url, minBytes, maxBytes) {
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
  if (buf.length < minBytes) throw new Error('suspiciously small (' + buf.length + 'B)');
  if (buf.length > maxBytes) throw new Error('suspiciously large (' + buf.length + 'B)');
  if (buf.slice(0, 4).toString('binary') !== 'OggS') throw new Error('not an Ogg file (bad magic)');
  return buf;
}

async function kenneyMember(pack, member) {
  if (!KENNEY[pack]) throw new Error('unknown Kenney pack: ' + pack);
  if (!zipCache.has(pack)) {
    const zip = await (async () => {
      let buf = null, err = null;
      for (let attempt = 0; attempt <= BACKOFF.length; attempt++) {
        try {
          const r = await fetch(KENNEY[pack], { headers: { 'User-Agent': UA } });
          if (r.status === 429) { if (attempt < BACKOFF.length) { await sleep(BACKOFF[attempt]); continue; } throw new Unrecoverable('429 even after backoffs'); }
          if (!r.ok) throw new Unrecoverable('HTTP ' + r.status);
          buf = Buffer.from(await r.arrayBuffer());
          break;
        } catch (e) {
          if (e instanceof Unrecoverable || attempt >= BACKOFF.length) { err = e; break; }
          err = e; await sleep(BACKOFF[attempt]);
        }
      }
      if (!buf) throw new Error('zip fetch failed: ' + ((err && err.message) || 'unknown'));
      const dir = mkdtempSync(join(tmpdir(), 'kenney-'));
      const zp = join(dir, pack + '.zip');
      writeFileSync(zp, buf);
      return zp;
    })();
    zipCache.set(pack, zip);
  }
  // unzip -p streams one member to stdout; execFileSync returns it as a Buffer
  const out = execFileSync('unzip', ['-p', zipCache.get(pack), member], { maxBuffer: 16 * 1024 * 1024 });
  if (!out || out.length < 512) throw new Error('member missing or empty in pack: ' + member);
  if (out.slice(0, 4).toString('binary') !== 'OggS') throw new Error('member is not Ogg: ' + member);
  return out;
}

// SFX are small; music tracks are a few MB.
const limitsFor = (slug) => slug.startsWith('music/')
  ? [200 * 1024, 15 * 1024 * 1024]
  : [1024, 800 * 1024];

// ---- the steady crawl ----------------------------------------------------------------
let ok = 0;
const fail = [];
for (const w of batch) {
  if (outOfTime()) { console.log('budget spent - committing what we have; the rest remain for the next run'); break; }
  try {
    let buf;
    if (w.src.startsWith('kenney:')) {
      const [, pack, member] = w.src.split(':');
      buf = await kenneyMember(pack, member);
      const [, max] = limitsFor(w.slug);
      if (buf.length > max) throw new Error('member too large (' + buf.length + 'B)');
    } else if (/^https?:\/\//.test(w.src)) {
      const [min, max] = limitsFor(w.slug);
      buf = await fetchBin(w.src, min, max);
    } else {
      throw new Error('unrecognized source scheme: ' + w.src);
    }
    mkdirSync(dirname(AUDIO + '/' + w.slug), { recursive: true });
    writeFileSync(AUDIO + '/' + w.slug, buf);
    index.files[w.slug] = { src: w.src, license: w.license, bytes: buf.length };
    // keep the patcher manifest in lockstep: every fetched file is shippable
    const rel = 'audio/' + w.slug;
    mpath.set(rel, {
      path: rel,
      sha256: createHash('sha256').update(buf).digest('hex'),
      url: PAGES + rel,
      license: w.license,
      src: w.license === 'CC0' ? 'kenney.nl (CC0)' : w.src
    });
    ok++;
    console.log('ok ' + ok + ': ' + w.slug + ' (' + Math.round(buf.length / 1024) + 'KB, ' + w.license + ')');
  } catch (e) {
    console.warn('FAIL ' + w.slug + ': ' + ((e && e.message) || 'unknown'));
    fail.push(w.slug + ' (' + ((e && e.message) || 'unknown') + ')');
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
