#!/usr/bin/env node
// v0.32.1 sovfix — sovereign passive reworks (4 cards).
// AMBUSH (Babur): first Charge each turn enters with +1/+1 (was Shock).
// PYROMANCER (Suleiman): AoE edicts deal +1 damage (was Scorch-only).
// SCORCHED_VICTORY (Cynisca): any edict kill burns the enemy Sovereign (was X-spell only).
// IRON_LEVEY -> IRON_LEVY (Ashen-Prime): passive id typo fix, text unchanged.
// SHA-GATED: input must hash to the v0.32.0 pairing-mint baseline, output to
// the verified v0.32.1 build, or the script exits 1 and nothing is written.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const EXPECTED_IN_SHA256 = '05650f00982e5e120f3e82effa0c23e9cdc3adfc158a61bba7cd76406f404cd7';
const EXPECTED_IN_BYTES = 1115506;
const EXPECTED_OUT_SHA256 = '9b42073686d2d673c0835c38199f8d86e0e98c83f213eb5d79c5e38b50da333b';
const EXPECTED_OUT_BYTES = 1115496;
const DATA = process.env.FB_CARDS_PATH || 'data/cards.json';
const raw = readFileSync(DATA, 'utf8');
const inSha = createHash('sha256').update(raw).digest('hex');
if (inSha !== EXPECTED_IN_SHA256 || Buffer.byteLength(raw) !== EXPECTED_IN_BYTES) {
  console.error('INPUT GATE FAIL: got ' + inSha + ' (' + Buffer.byteLength(raw) + 'B) expected ' + EXPECTED_IN_SHA256 + ' (' + EXPECTED_IN_BYTES + 'B) - baseline is not the v0.32.0 pairing-mint build');
  process.exit(1);
}
const D = JSON.parse(raw);
const CHANGES = {
  "babur@crescent": { "passive": { "id": "AMBUSH", "name": "Ambush", "desc": "Your first Charge minion each turn enters with +1/+1." } },
  "suleiman@crescent": { "passive": { "id": "PYROMANCER", "name": "Pyromancer", "desc": "Your AoE edicts deal 1 more damage." } },
  "cynisca@ironsteppes": { "passive": { "id": "SCORCHED_VICTORY", "name": "Scorched Victory", "desc": "When your edict kills a minion, deal 1 damage to the enemy Sovereign." } },
  "ashen-prime-of-the-vanguard@marches": { "passive": { "id": "IRON_LEVY", "name": "Iron Levy", "desc": "At the start of your turn, if you control 3 or more minions, summon a 1/1 Conscript." } }
};
const byId = new Map();
for (const f of D.factions) for (const c of f.cards) byId.set(c.id, c);
let n = 0;
for (const [id, patch] of Object.entries(CHANGES)) {
  const c = byId.get(id);
  if (!c) { console.error('MISSING ID: ' + id); process.exit(1); }
  for (const [k, v] of Object.entries(patch)) c[k] = v;
  n++;
}
D.version = '0.32.1';
const out = JSON.stringify(D, null, 1) + '\n';
const outSha = createHash('sha256').update(out).digest('hex');
if (outSha !== EXPECTED_OUT_SHA256 || Buffer.byteLength(out) !== EXPECTED_OUT_BYTES) {
  console.error('OUTPUT GATE FAIL: got ' + outSha + ' (' + Buffer.byteLength(out) + 'B) expected ' + EXPECTED_OUT_SHA256 + ' (' + EXPECTED_OUT_BYTES + 'B)');
  process.exit(1);
}
writeFileSync(DATA, out);
console.log('SHA GATES PASS: ' + outSha);
console.log('patched cards: ' + n + '; version 0.32.1');
