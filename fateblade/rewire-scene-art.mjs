#!/usr/bin/env node
/**
 * FATEBLADE SCENE-ART REWIRE v1.0 (Oct 26 2026)
 *
 * Wires the minted AI scene art sitting in fateblade/art/scenes/ (the Scene
 * Forge output) onto the files the cards actually reference. History: the
 * v0.28 vault reorg copied the OLD Commons fetch art into scenes/<realm>/,
 * and the mint pass landed its 128 generated scenes in art/scenes/ — the
 * "mint it to that card later" wiring step never ran, so ~128 edicts/relics
 * render open-source museum art while their replacements sit orphaned.
 * (Proven byte-exact: queue 'bytes' == art/scenes file sizes for all 128.)
 *
 * What it does: for every edict/relic card whose slug matches an
 * art/scenes/<slug>.jpg file, copies that minted art over the card's
 * referenced file (scenes/<realm>/<slug>.jpg). Refs never change; the
 * art/scenes masters are kept untouched (fail-soft, idempotent, rerunnable).
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';

const ROOT = 'fateblade';
const ART = ROOT + '/art/scenes';

const cards = JSON.parse(readFileSync(ROOT + '/data/cards.json', 'utf8'));
const mints = new Set(readdirSync(ART).filter((f) => f.endsWith('.jpg')));

let rewired = 0, alreadyWired = 0, noMaster = [], skipped = [];
const report = [];

for (const fac of cards.factions) {
  for (const c of fac.cards || []) {
    if (c.type !== 'edict' && c.type !== 'relic') continue;
    const slug = c.id.split('@')[0];
    const master = slug + '.jpg';
    if (!mints.has(master)) { noMaster.push(c.id); continue; }
    const file = c.file || '';
    if (!file.startsWith('scenes/')) { skipped.push(c.id + ' (ref not scenes/: ' + file + ')'); continue; }
    if (file.split('/').pop() !== master) { skipped.push(c.id + ' (ref basename != slug: ' + file + ')'); continue; }
    const src = ART + '/' + master;
    const dst = ROOT + '/' + file;
    if (!existsSync(dst)) { skipped.push(c.id + ' (ref target missing: ' + file + ')'); continue; }
    const a = readFileSync(src), b = readFileSync(dst);
    if (a.equals(b)) { alreadyWired++; continue; }
    writeFileSync(dst, a);
    rewired++;
    report.push({ id: c.id, to: file, bytes: a.length });
  }
}

writeFileSync(ROOT + '/art/rewire-report.json', JSON.stringify({ rewired, alreadyWired, skipped: skipped.length, report }, null, 1));
console.log('SCENE-ART REWIRE: rewired=' + rewired + ' alreadyWired=' + alreadyWired +
  ' noMaster(untouched, e.g. history realms)=' + noMaster.length + ' skipped=' + skipped.length);
if (skipped.length) skipped.forEach((s) => console.log('  SKIP ' + s));
console.log(rewired + ' cards now render their minted art. Masters kept in art/scenes/.');
