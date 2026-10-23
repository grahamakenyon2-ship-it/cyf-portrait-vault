#!/usr/bin/env node
// fateblade/regen-manifest.mjs — SYNC-V3: recompute manifest sha256s from the
// vault tree (run from repo root in the sync workflow, after the agent has
// pushed source files in vault format).
// - version := fateblade/data/cards.json .version (single source of truth)
// - every manifest entry whose file exists under fateblade/<path>: sha256
//   recomputed and updated on drift
// - entry whose file is MISSING from the tree: HARD FAIL (never drop entries)
// - byte form: JSON.stringify(M,null,1)+'\n' (the proven vault manifest format)
// Modes: --apply (write) | --check (report only, exit 1 on drift)
// Test overrides (never used in prod): FB_MANIFEST_PATH, FB_TREE_ROOT.
import { readFileSync, writeFileSync } from 'node:fs';
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
const version = cards.version;
if (!version) { console.error('FATAL: data/cards.json has no .version'); process.exit(1); }

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
