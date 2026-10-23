#!/usr/bin/env node
// VAULT-SIDE WRAPPER REGEN - kills the cards.json/cards.js/manifest triple-push
// dance (OPTIMIZATION-NOTES section 2, option a). The vault now receives ONE
// hand-pushed data file (fateblade/data/cards.json); this tool computes the
// rest: the cards.js wrapper (byte-deterministic formula, verified against
// live v0.28.0 bytes) plus the manifest entries for both data files, with the
// manifest version synced FROM cards.json's own "version" field (the ONE
// version bump place per OPTIMIZATION-NOTES section 7).
//
// Usage:  node regen-wrappers.mjs [--apply] [--json]
//   report (default): prints drift, writes NOTHING, exit 0
//   --apply: writes fateblade/data/cards.js and fateblade/manifest.json on drift
//   --json: also print a machine-readable report to stdout (last line)
// The WORKFLOW does the commit (stash -> fetch+reset -> copy back pattern,
// lesson 34: never pull --rebase in workflow commits).
// Byte formulas verified against live v0.28.0 (Oct 23 2026):
//   cards.js  = 'window.CARDS = ' + JSON.stringify(JSON.parse(cards.json)) + ';\n'
//   manifest  = JSON.stringify(man, null, 1) + '\n'
// Run from the cyf-portrait-vault repo root.
// ASCII only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = 'fateblade';
const PAGES = 'https://grahamakenyon2-ship-it.github.io/cyf-portrait-vault/fateblade/';
const APPLY = process.argv.includes('--apply');
const JSONOUT = process.argv.includes('--json');

const cjPath = path.join(ROOT, 'data/cards.json');
const jsPath = path.join(ROOT, 'data/cards.js');
const manPath = path.join(ROOT, 'manifest.json');
for (const p of [cjPath, manPath]) {
  if (!fs.existsSync(p)) {
    console.error('FATAL: ' + p + ' not found (run from vault repo root)');
    process.exit(2);
  }
}

const cjBytes = fs.readFileSync(cjPath);
const DATA = JSON.parse(cjBytes.toString('utf8'));
const version = DATA.version;
if (!version) { console.error('FATAL: cards.json has no version field'); process.exit(2); }

// 1. Wrapper regen (byte-deterministic).
const wantJs = 'window.CARDS = ' + JSON.stringify(DATA) + ';\n';
const jsNow = fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf8') : '';
const jsDrift = jsNow !== wantJs;

// 2. Manifest: recompute data shas, sync version.
const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
const byPath = new Map((man.files || []).map((e) => [e.path, e]));
const shas = {
  'data/cards.json': crypto.createHash('sha256').update(cjBytes).digest('hex'),
  'data/cards.js': crypto.createHash('sha256').update(Buffer.from(wantJs, 'utf8')).digest('hex'),
};
const manIssues = [];
let manChanged = false;
for (const [p, sha] of Object.entries(shas)) {
  const e = byPath.get(p);
  if (!e) {
    manIssues.push('missing manifest entry: ' + p);
    byPath.set(p, { path: p, sha256: sha, url: PAGES + p });
    manChanged = true;
  } else if (e.sha256 !== sha) {
    manIssues.push('sha drift: ' + p + ' manifest=' + (e.sha256 || '').slice(0, 8) + ' computed=' + sha.slice(0, 8));
    e.sha256 = sha;
    manChanged = true;
  }
}
if (man.version !== version) {
  manIssues.push('version drift: manifest=' + man.version + ' cards.json=' + version);
  man.version = version;
  manChanged = true;
}

const drift = jsDrift || manChanged;
const report = {
  mode: APPLY ? 'apply' : 'report',
  version,
  cardsJsDrift: jsDrift,
  manifestChanged: manChanged,
  issues: manIssues,
};

if (APPLY && jsDrift) fs.writeFileSync(jsPath, wantJs, 'utf8');
if (APPLY && manChanged) {
  man.files = [...byPath.values()];
  fs.writeFileSync(manPath, JSON.stringify(man, null, 1) + '\n', 'utf8');
}
if (APPLY) report.wrote = { cardsJs: jsDrift, manifest: manChanged };

console.log('regen-wrappers ' + (APPLY ? 'APPLY' : 'REPORT') +
  ' | version(cards.json): ' + version + ' | cards.js drift: ' + jsDrift +
  ' | manifest changes: ' + manIssues.length + ' | needs-write: ' + drift);
for (const i of manIssues) console.log('  - ' + i);
if (JSONOUT) console.log('REGEN_JSON ' + JSON.stringify(report));
process.exit(drift && !APPLY ? 0 : 0); // report mode never fails on drift; drift is informational
