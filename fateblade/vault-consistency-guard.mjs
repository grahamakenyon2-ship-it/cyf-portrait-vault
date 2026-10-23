#!/usr/bin/env node
// VAULT CONSISTENCY GUARD - verify every fateblade/manifest.json entry resolves
// in-repo with a matching sha256. Exit 1 on ANY missing file or sha mismatch.
// Runs in the cyf-portrait-vault repo root (Actions: sparse checkout of fateblade/).
// ASCII only (lesson 36: emoji can break tool-call lexers).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = 'fateblade';
const PAGES = 'https://grahamakenyon2-ship-it.github.io/cyf-portrait-vault/fateblade/';

const manPath = path.join(ROOT, 'manifest.json');
if (!fs.existsSync(manPath)) {
  console.error('FATAL: ' + manPath + ' not found (run from vault repo root)');
  process.exit(2);
}
const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
const entries = man.files || [];
let ok = 0;
const missing = [], shaBad = [], urlBad = [];
for (const e of entries) {
  const p = path.join(ROOT, e.path);
  if (!fs.existsSync(p)) { missing.push(e.path); continue; }
  const sha = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  if (sha !== e.sha256) {
    shaBad.push(e.path + ' manifest=' + (e.sha256 || '').slice(0, 8) + ' disk=' + sha.slice(0, 8));
    continue;
  }
  if (e.url !== PAGES + e.path) urlBad.push(e.path);
  ok++;
}
console.log('manifest version: ' + man.version + ' | entries: ' + entries.length +
  ' | ok: ' + ok + ' | missing: ' + missing.length +
  ' | shaMismatch: ' + shaBad.length + ' | urlFormulaBad: ' + urlBad.length);
for (const m of missing.slice(0, 25)) console.log('MISSING ' + m);
for (const s of shaBad.slice(0, 25)) console.log('SHA-MISMATCH ' + s);
for (const u of urlBad.slice(0, 25)) console.log('URL-BAD ' + u);
if (missing.length || shaBad.length) {
  console.log('CONSISTENCY GUARD: FAIL');
  process.exit(1);
}
console.log('CONSISTENCY GUARD: PASS');
