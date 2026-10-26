#!/usr/bin/env node
// fateblade/regen-manifest.mjs — SYNC-V3: recompute manifest sha256s from the
// vault tree (run from repo root in the sync workflow, after the agent has
// pushed source files in vault format).
// - version (v2, Oct 26): fateblade/sync-queue.json .version is THE source
//   (engine/game.html-only ships can bump the queue without touching cards.json
//   — the v0.41.2 class). Fallback: data/cards.json .version. Gate: queue
//   version must be >= cards version (semver) — fail if behind.
// - every manifest entry whose file exists under fateblade/<path>: sha256
//   recomputed and updated on drift
// - entry whose file is MISSING from the tree: HARD FAIL (never drop entries)
// - byte form: JSON.stringify(M,null,1)+'\n' (the proven vault manifest format)
// Modes: --apply (write) | --check (report only, exit 1 on drift)
// Test overrides (never used in prod): FB_MANIFEST_PATH, FB_TREE_ROOT.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const apply = process.argv.includes('--apply');
const MANIFEST = process.env.FB_MANIFEST_PATH || join(HERE, 'manifest.json');
const TREE = process.env.FB_TREE_ROOT || HERE; // the fateblade/ dir itself

const raw = readFileSync(MANIFEST, 'utf8');
const M = JSON.parse(raw);
const cards = JSON.parse(readFileSync(join(TREE, 'data', 'cards.json'), 'utf8'));
const cardsVersion = cards.version;
if (!cardsVersion) { console.error('FATAL: data/cards.json has no .version'); process.exit(1); }
// v2: the queue is the primary version source
const queuePath = join(TREE, 'sync-queue.json');
let queueVersion = null;
if (existsSync(queuePath)) {
  const q = JSON.parse(readFileSync(queuePath, 'utf8'));
  queueVersion = q.version || (q.pending && q.pending[0] && q.pending[0].version) || null;
} else {
  console.log('note: sync-queue.json not found — falling back to cards.json .version');
}
const version = queueVersion || cardsVersion;
if (queueVersion) {
  const pv = (v) => String(v).split('.').map(Number);
  const [a, b] = [pv(queueVersion), pv(cardsVersion)];
  let behind = false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x > y) { behind = false; break; }
    if (x < y) { behind = true; break; }
  }
  if (behind) { console.error('FATAL: sync-queue.json version (' + queueVersion + ') is BEHIND data/cards.json (' + cardsVersion + ') — bump the queue'); process.exit(1); }
  if (queueVersion !== cardsVersion) console.log('version source: sync-queue.json (' + queueVersion + '; cards.json at ' + cardsVersion + ' — engine/code-only ship)');
}

const shaOf = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
let updated = 0, missing = 0, drift = [];
for (const e of M.files) {
  const fp = join(TREE, e.path);
  let sha;
  try { sha = shaOf(fp); } catch { missing++; console.error('MISSING IN TREE: ' + e.path); continue; }
  if (sha !== e.sha256) { drift.push(e.path); updated++; e.sha256 = sha; }
}
if (missing) { console.error('FATAL: ' + missing + ' manifest entries missing from tree - refusing to write'); process.exit(1); }
const oldVersion = M.version;
M.version = version;
const out = JSON.stringify(M, null, 1) + '\n';
if (oldVersion !== version) console.log('version: ' + oldVersion + ' -> ' + version);
console.log('entries: ' + M.files.length + ', sha updated: ' + updated + (drift.length ? ' [' + drift.slice(0, 10).join(', ') + (drift.length > 10 ? ', +' + (drift.length - 10) + ' more' : '') + ']' : ''));
if (!updated && oldVersion === version) { console.log('MANIFEST CLEAN'); process.exit(0); }
if (!apply) { console.log('DRIFT DETECTED (--check, nothing written)'); process.exit(1); }
writeFileSync(MANIFEST, out);
const vSha = createHash('sha256').update(out).digest('hex');
console.log('MANIFEST REGENED: version ' + version + ' (' + Buffer.byteLength(out) + 'B) sha256 ' + vSha);
