#!/usr/bin/env node
// v0.30.0 courts pilot — patch applier for workflow application (design: work/v0.30-redesign/courts-DESIGN.md).
// Only touches factions[courts].cards + version. Everything else byte-identical.
// SHA-GATED: output must hash to the expected value below or the script exits 1 (no bad commit).
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const EXPECTED_SHA256 = '22c7fc314fdaafd7a736d0d42498e8c4b8036de9323b3f3a48ab73e911871e8d';
const EXPECTED_BYTES = 1107597;
const DATA = process.env.FB_CARDS_PATH || 'data/cards.json';
const D = JSON.parse(readFileSync(DATA, 'utf8'));
const F = D.factions.find(f => f.id === 'courts');
const byId = new Map(F.cards.map(c => [c.id.replace('@courts', ''), c]));

// engine-truth texts (most-common pool variants, verified by census)
const T = {
  bcPing:  'Battlecry: deal 1 damage to a random enemy minion.',
  bcPing2: 'Battlecry: deal 2 damage to a random enemy minion.',
  bcPing3: 'Battlecry: deal 3 damage to an enemy minion.',
  bcDraw:  'Battlecry: draw a card.',
  bcHeal2: 'Battlecry: restore 2 HP to your hero.',
  bcBuff:  'Battlecry: give another friendly minion +1/+1.',
  bcSummon:'Battlecry: summon a 1/1 Conscript.',
  bcAoe1:  'Battlecry: deal 1 damage to all enemy minions.',
  drPing:  'Deathrattle: deal 1 damage to a random enemy minion.',
  drPing2:'Deathrattle: deal 2 damage to a random enemy minion.',
  drDraw:  'Deathrattle: draw a card.',
  drAoe1:  'Deathrattle: deal 1 damage to all enemy minions.',
  drSummon:'Deathrattle: summon a 1/1 Conscript.',
  drHeal2: 'Deathrattle: restore 2 HP to your hero.',
  drTribeRally:'Deathrattle: your other Humans gain +1/+1.',
};
const NEW = {
  spPing: 'Whenever you cast an edict, deal 1 damage to a random enemy minion.',
  spGrow: 'Whenever you cast an edict, this minion gains +1 Attack.',
  odDraw: 'Whenever you draw this card, draw another card.',
  odPing: 'Whenever you draw this card, deal 1 damage to a random enemy minion.',
  odHeal: 'Whenever you draw this card, restore 1 Health to your hero.',
};
const ihTxt = (a) => `Costs ${a} less while you hold another Human.`;
const KW_PREFIX = { Bane: 'Bane.', Shadow: 'Shadow.', Guard: 'Guard.', Ranged: 'Ranged.', Shock: 'Shock.', Aegis: 'Aegis.', Relentless: 'Relentless.', Lifesteal: 'Lifesteal.' };

// ---- treatment map: id -> patch. null field = clear it. ----
const M = {
  // ===== 1-DROPS (downshifts from 2c — the curve fix; mint designs realized as reworks) =====
  'lysueando-of-the-ashen-vale': { cost: 1, atk: 1, hp: 2, kw: null, rarity: 'common', bc: null, dr: null, ih: { tribe: 'Humans', amount: 1 } }, // Bonded Page design
  'malueando':                   { cost: 1, atk: 1, hp: 2, kw: null, rarity: 'common', bc: 'bcPing', dr: null }, // Errand-Blade design
  'roewyn':                      { cost: 1, atk: 1, hp: 2, kw: 'Guard', rarity: 'common' }, // Doorward design
  'rootrice':                    { cost: 1, atk: 1, hp: 1, kw: 'Shadow', rarity: 'rare', bc: null, dr: null }, // Veiled on-ramp
  'casanette-the-far-walked':    { cost: 1, atk: 1, hp: 1, kw: null, rarity: 'common', bc: null, dr: null, onDraw: 'odPing' }, // audit notices
  'vioamsande-the-unforgotten':  { cost: 1, atk: 1, hp: 2, kw: 'Lifesteal', rarity: 'common' },
  // ===== 2-DROPS =====
  'casuetrice-of-the-quiet-house': { atk: 1, hp: 2, dr: 'drPing' },
  'delebelle':                     { hp: 3 },
  'gisalor-of-the-quiet-house':    { atk: 3, hp: 2, rarity: 'rare' },
  'lysetrice-of-the-still-water':  { atk: 1, hp: 2, bc: 'bcDraw' },
  'roetrice-the-last-voiced':      { atk: 1, hp: 3, dr: 'drDraw' },
  // ===== 3-DROPS =====
  'barelric-the-gate-warden':   { atk: 2, hp: 4, bc: 'bcPing' },
  'baruebelle-the-cold-blooded':{ hp: 2 },
  'brynelric-the-steadfast':    { atk: 3, hp: 3, bc: null }, // legendary, passive carries identity
  'casemonde-the-unseen':       { atk: 3, hp: 2, rarity: 'common', dr: null },
  'delocine':                   { atk: 1, hp: 5, dr: 'drPing2' },
  'deluebert-the-first-over':   { atk: 3, hp: 2, kw: 'Shadow', dr: null }, // Charge->Shadow
  'fioaando-of-the-whisper-gallery': { atk: 2, hp: 3, dr: null, onSpell: 'spGrow' }, // the rumor grows
  'fioacine-the-thousand-yard': { atk: 2, hp: 3, dr: null },
  'gisabert-the-unbowed':       { atk: 2, hp: 3, dr: null },
  'haletrice-the-far-walked':   { atk: 3, hp: 2, bc: 'bcPing', dr: null },
  'malivard':                   { atk: 2, hp: 4, kw: 'Shadow', dr: null }, // Charge->Shadow (veiled ward)
  'peramando-the-cold-blooded': { atk: 2, hp: 2, dr: null },
  'perilor-of-the-quiet-house': { atk: 3, hp: 2, kw: 'Shadow' }, // Charge->Shadow, keeps drHeal2
  'roesande-the-reckoner':      { atk: 2, hp: 3, dr: 'drPing' },
  'roetrice-the-swift-hooved':  { atk: 3, hp: 2, bc: 'bcPing' },
  'serebelle':                  { atk: 2, hp: 2 },
  'serolor-the-quiet-dagger':   { atk: 2, hp: 4, dr: null, onDraw: 'odDraw' }, // Ledger-Clerk design
  'lysolor-the-swift-loosed':   { atk: 3, hp: 2, kw: 'Ranged', dr: null, onSpell: 'spPing' },
  'orsuenette-the-shield-line': { atk: 1, hp: 5, dr: null }, // the shield-line holds
  'vioammonde':                 { atk: 2, hp: 3, dr: null },
  // ===== 4-DROPS =====
  'casambert-the-shield-sworn': { atk: 3, hp: 4, dr: null, rarity: 'rare', ih: { tribe: 'Humans', amount: 1 } }, // House rates
  'delivard-of-the-ninth-gate': { atk: 4, hp: 3, rarity: 'rare' },
  'deluebert-the-twilight-born':{ atk: 2, hp: 6, dr: 'drSummon' }, // the will is read
  'gorok-the-blood-tithed':     { atk: 3, hp: 4, dr: 'drPing2' },
  'isolimonde-the-bright-bladed': { bc: 'bcPing' },
  'joraando-the-thunder-heeled':{ atk: 3, hp: 3, kw: 'Shadow', dr: null }, // Charge->Shadow
  'lyselbelle-the-deep-minded': { atk: 3, hp: 4 },
  'malesande':                  { atk: 3, hp: 3, kw: 'Shadow', dr: null, onSpell: 'spPing' }, // masked whisper-keeper (epic)
  'morenis-the-nine-crowned':   { atk: 3, hp: 5 },
  'nymiseth-the-keen-eyed':     { atk: 3, hp: 2 },
  'orsavaine-the-twice-sworn':  { atk: 4, hp: 2, bc: null },
  'peritrice':                  { atk: 4, hp: 2, kw: 'Shadow' }, // Charge->Shadow, keeps bcBuff
  'seramonde-the-unseen':       { atk: 2, hp: 6, dr: 'drAoe1' },
  'viooric-of-the-grey-fletching': { atk: 3, hp: 4, dr: null },
  // ===== 5-DROPS =====
  'barellor-of-the-whisper-gallery': { onSpell: 'spGrow' }, // the rumor spreads through the gallery (6/3 kept)
  'haleando':                   { atk: 4, hp: 5, kw: null, ih: { tribe: 'Humans', amount: 1 } }, // Relentless trim + kin rate
  'halovaine':                  { atk: 5, hp: 5, kw: 'Aegis' }, // bcDraw kept; Aegis loves ATK
  'isolelric-the-ash-cloaked':  { atk: 4, hp: 3, kw: 'Aegis' }, // drAoe1 kept
  'fioicine-the-war-sworn':     { atk: 6, hp: 8, kw: 'Aegis' },
  'isolivard':                  { bc: null, onSpell: 'spPing' },
  'lysesande':                  { atk: 4, hp: 4, kw: 'Shadow', dr: null }, // Charge->Shadow
  'malamnette-of-the-ashen-vale':{ atk: 5, hp: 4, bc: null }, // Aegis loves ATK
  'vaelith-the-thorned':        { atk: 3, hp: 5, kw: 'Shadow', bc: 'bcDraw' }, // Relentless->Shadow
  // ===== 6-DROPS =====
  'casomonde':                  { ih: { tribe: 'Humans', amount: 1 } }, // House credit on the draw-broker
  'delitrice-the-red-handed':   { atk: 4, hp: 6, kw: 'Shadow', dr: null }, // Charge->Shadow, keeps bcDraw
  'isoluevaine':                { atk: 5, hp: 6 },
  'lyriseth-the-hundred-victor':{ atk: 5, hp: 3, bc: 'bcPing2' }, // assassin sizing
  'orsuesande-of-the-burning-field': { atk: 4, hp: 10, dr: 'drTribeRally' }, // the veiled court musters
  'roamvaine-the-ward-blessed': { dr: null, onDraw: 'odHeal' }, // the dividend
  // ===== 7-DROPS =====
  'alitrice-the-unseen':        { atk: 7, hp: 5, bc: null },
  'fiouenette':                 { atk: 6, hp: 8, kw: 'Shadow', dr: null, onSpell: 'spGrow' }, // MASQUERADE showcase
  'halavaine':                  { atk: 5, hp: 10, dr: 'drAoe1' }, // COURT_INTRIGUE
  'peruebelle':                 { atk: 7, hp: 5, bc: null },
  // ===== 8-DROPS =====
  'orsasande':                  { bc: null },
  // ===== RENAMES (mechanics unchanged unless in map above) =====
  'astrolabe':            { name: 'The Hollow Sceptre', rl: 'rlWard' }, // dedupe vs Coinmaster's Scales
  'ion-trail-ambush':     { name: 'The Masked Ambush' },
  'northern-armada':      { name: 'The Debt Fleet' },
  'reactor-core-blue':    { name: 'The Fan Volley' },
  'stag-of-the-grove':    { name: 'The Stag at the Table' },
  'the-belt-miners':      { name: 'The Tithe Collectors' },
  'the-coaling-station':  { name: 'The Third Weighing' },
  'the-green-knight':     { name: 'The Courteous Ward' },
  'the-kurgan-barrow':    { name: 'The Portrait Gallery' },
  'the-orb-of-foresight': { name: 'The Ledgers of Precedent' },
  'the-silverwood-bow':   { name: "The Assassin's Contract", bc: null },
  'watchtower-relay':     { name: 'The Whisper Gallery' },
  // ===== EDICT RIDER TRIMS (R4 one job) =====
  'the-judicial-duel':    { bc: null },
};
const renames = Object.fromEntries(Object.entries(M).filter(([k, v]) => v.name).map(([k, v]) => [k, v.name]));

// relic text map for astrolabe's rlWard (pool variant)
const RELIC_TEXT = {
  rlWard: 'At the start of your turn, if your hero took no damage since your last turn, restore 2 HP.',
};

let changed = 0, notes = [];
for (const [id, p] of Object.entries(M)) {
  const c = byId.get(id);
  if (!c) { console.error('MISSING ID: ' + id); process.exit(1); }
  const before = JSON.stringify([c.cost, c.atk, c.hp, c.kw, c.bc, c.dr, c.rarity, c.name]);
  let touched = false;
  for (const [k, v] of Object.entries(p)) {
    if (k === 'name') { c.name = v; touched = true; continue; }
    if (c[k] === undefined && v === null) continue;
    c[k] = v; touched = true;
  }
  if (!touched) continue;
  // normalize nulls for minion rider fields
  if ((c.type || 'minion') === 'minion') for (const k of ['bc', 'dr', 'fx', 'rl', 'aura', 'rage']) if (!(k in c)) c[k] = null;
  // recompute ability text ONLY when bc/dr/kw/onSpell/onDraw/ih changed
  const riderKeys = ['bc', 'dr', 'kw', 'onSpell', 'onDraw', 'ih', 'rl'];
  const riderTouched = riderKeys.some(k => k in p);
  if (riderTouched) {
    const parts = [];
    if (c.kw && c.bc) parts.push(KW_PREFIX[c.kw] || c.kw + '.');
    if (c.bc) parts.push(T[c.bc]);
    if (c.dr) parts.push(T[c.dr] || ('Deathrattle: ' + c.dr));
    if (c.onSpell) parts.push(NEW[c.onSpell]);
    if (c.onDraw) parts.push(NEW[c.onDraw]);
    if (c.ih) parts.push(ihTxt(c.ih.amount || 1));
    if (c.type === 'relic' && c.rl && RELIC_TEXT[c.rl]) c.ability = RELIC_TEXT[c.rl];
    else if (parts.length) c.ability = parts.join(' ');
    // kw-only cards: ability stays null (emblem carries it)
  }
  const after = JSON.stringify([c.cost, c.atk, c.hp, c.kw, c.bc, c.dr, c.rarity, c.name]);
  if (before !== after || riderTouched) changed++;
}

// ===== doctrine deck: The Game of Crowns (30) — v2: removal suite for big-body matchups =====
F.defaultDeck = [
  'malueando@courts', 'malueando@courts',
  'roewyn@courts', 'roewyn@courts',
  'rootrice@courts', 'rootrice@courts',
  'lysueando-of-the-ashen-vale@courts', 'lysueando-of-the-ashen-vale@courts',
  'roetrice-the-last-voiced@courts', 'roetrice-the-last-voiced@courts',
  'the-judicial-duel@courts', 'the-judicial-duel@courts',
  'the-silverwood-bow@courts', 'the-silverwood-bow@courts',
  'deluebert-the-first-over@courts', 'deluebert-the-first-over@courts',
  'fioaando-of-the-whisper-gallery@courts', 'fioaando-of-the-whisper-gallery@courts',
  'maluemonde-the-solemn@courts',
  'haluemonde-the-gate-warden@courts',
  'malesande@courts',
  'joraando-the-thunder-heeled@courts', 'joraando-the-thunder-heeled@courts',
  'casambert-the-shield-sworn@courts',
  'lysesande@courts', 'lysesande@courts',
  'malamnette-of-the-ashen-vale@courts',
  'delitrice-the-red-handed@courts',
  'isolelbert@courts',
  'the-gilded-ledger@courts',
];

D.version = '0.30.0';
const out = JSON.stringify(D, null, 1) + '\n';
const sha = createHash('sha256').update(out).digest('hex');
if (sha !== EXPECTED_SHA256 || Buffer.byteLength(out) !== EXPECTED_BYTES) {
  console.error('SHA GATE FAIL: got ' + sha + ' (' + Buffer.byteLength(out) + 'B) expected ' + EXPECTED_SHA256 + ' (' + EXPECTED_BYTES + 'B)');
  process.exit(1);
}
writeFileSync(DATA, out);
console.log('SHA GATE PASS: ' + sha);
console.log('changed cards: ' + changed + '; renames: ' + Object.keys(renames).length);
console.log('deck: ' + F.defaultDeck.length + ' cards, legendaries=' + F.defaultDeck.filter(id => byId.get(id.replace('@courts','')).rarity === 'legendary').length);
// quick ledger report
const kw = {}, nw = { onSpell: 0, onDraw: 0, ih: 0 }, hero = { bcHero1: 0, drHero1: 0 }, curve = {};
for (const c of F.cards) {
  if (c.kw) kw[c.kw] = (kw[c.kw] || 0) + 1;
  for (const k of ['onSpell', 'onDraw', 'ih']) if (c[k]) nw[k]++;
  if (c.bc === 'bcHero1') hero.bcHero1++;
  if (c.dr === 'drHero1') hero.drHero1++;
  curve[c.cost] = (curve[c.cost] || 0) + 1;
}
console.log('kw:', JSON.stringify(kw));
console.log('new:', JSON.stringify(nw), 'heroPing:', JSON.stringify(hero));
console.log('curve:', JSON.stringify(curve));
