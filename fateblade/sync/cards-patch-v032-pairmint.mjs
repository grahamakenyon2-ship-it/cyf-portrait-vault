#!/usr/bin/env node
// v0.32.0 PAIRING MINT — second keywords for rare+ minions across all 16 realms.
// Doctrine (user-locked v0.20 pairing matrix + v0.31.2 user ruling):
//   - every mint must fit LORE (name/flavor/ability text), GAMEPLAY (role,
//     matrix legality, rarity gates) and ART (the portrait IS the character,
//     so name/flavor fit = art fit).
//   - budget T = 2*cost + sum(KW_DISCOUNT) + (bc?1:0) + (dr?1:0), atk+hp <= T
//     (new-card.mjs rule, applied batch-wide).
//   - PREMIUM pairs epic+ only; FAIR pairs rare+; CONFLICT pairs refused;
//     triples legendary-only with a premium core. Commons get NO second
//     keyword (the matrix has no common-legal pair).
//   - deterministic: no randomness, replayable.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const EXPECTED_IN_SHA256 = '344c64a740a77a524931925d235c0a651af7b3ec97e80b18fc599405df2c0423';
const EXPECTED_IN_BYTES = 1114423;
const EXPECTED_OUT_SHA256 = '05650f00982e5e120f3e82effa0c23e9cdc3adfc158a61bba7cd76406f404cd7';
const EXPECTED_OUT_BYTES = 1115506;
const DATA = process.env.FB_CARDS_PATH || 'data/cards.json';
const raw = readFileSync(DATA, 'utf8');
const inSha = createHash('sha256').update(raw).digest('hex');
if (inSha !== EXPECTED_IN_SHA256) { console.error('INPUT GATE FAIL: ' + inSha); process.exit(1); }
const D = JSON.parse(raw);

const KWD = { Guard: 0, Ranged: 1, Lifesteal: 1, Shock: 1, Charge: 2, Aegis: 2, Bane: 2, Relentless: 3, Shadow: 2 };
const RORD = { common: 0, rare: 1, epic: 2, legendary: 3 };
const spk = (s)=>s.split('+').sort().join('+');
const PREMIUM = ['Charge+Relentless','Ranged+Bane','Ranged+Relentless','Bane+Relentless','Bane+Lifesteal','Guard+Bane','Guard+Aegis','Charge+Bane'].map(spk);
const FAIR = ['Charge+Aegis','Charge+Lifesteal','Ranged+Lifesteal','Lifesteal+Relentless','Guard+Lifesteal','Aegis+Relentless'].map(spk);
const CONFLICT = ['Charge+Shock','Guard+Shock','Guard+Relentless'].map(spk);
const pk = (a,b)=>[a,b].sort().join('+');
function pairLegal(a, b, rarity){
  const key = pk(a,b);
  if (CONFLICT.includes(key)) return false;
  if (PREMIUM.includes(key)) return RORD[rarity] >= 2;
  if (FAIR.includes(key)) return RORD[rarity] >= 1;
  if (a === 'Shadow' || b === 'Shadow'){
    const o = a === 'Shadow' ? b : a;
    if (o === 'Bane' || o === 'Charge') return RORD[rarity] >= 2;
    if (o === 'Guard' || o === 'Aegis') return RORD[rarity] >= 1;
    return false;
  }
  return null; // unjudged
}

// ---- lore affinity lexicons (name + flavor + ability + tribe) ----
const LEX = {
  Ranged: ['archer','arrow','bow','fletch','hunt','sniper','keen-eyed','keen eye','crossbow','sling','dart','sharpshot','volley','quiver','mark-liner','scout','tracer','shoot','rifle','gunner','artillery','cannon'],
  Guard: ['gate','wall','shield','ward','bulwark','steadfast','defender','door','rampart','sentinel','vanguard','bastion','never left','nothing passes','has not been named','warden','keeper of the wall','hold the','gate-warden','wallguard','wallwright','passholder','pass-ward','pass-sentinel','oath-keeper','shieldwall'],
  Charge: ['rider','cavalry','horse','swift','first over the wall','lance','joust','assault','banner-breaker','spearhead','rush','hooved','chariot','gap-springer','breaker','tiger','lancer','knight','crash','boar','wolf-rider','storm of iron','iron-captain'],
  Bane: ['poison','venom','assassin','signed in silence','night-sent','dagger','toxin','plague','blight','rot','grave','tomb','hollow','dusk-marked','dusk-mark','shade','crypt','bone-drinker','bite','fang','wither','grave-soil','verger','sexton'],
  Lifesteal: ['vampire','drain','feast','hunger','thirst','blood','devour','sate','leech','pull the dying back','reaper','harvest','drink','sanguine','red-handed','grave-hunger','famine'],
  Shock: ['storm','thunder','lightning','drum','cannon','gunpowder','crack','spark','muzzle','voltaic','arc-','static','shellfire','broadside','battery','shelling','jutland','ironclad','thunderer'],
  Relentless: ['pit','duel','hundred-victor','never asked twice','wrestler','pit-sworn','brawler','berserk','arena','chains','grudge-chew','never-sated','twice-hunted','tusk-split','skull-splinter','mauler','gladiator','duelist'],
  Aegis: ['blessed','pure','gold','light-bearing','halo','saint','aegis','consecrat','anoint','gilded','wreath','vow','purity','ward of light','reliquary','tithe','zeal','crusade','paladin','litany'],
  Shadow: ['veil','night','unseen','quiet','silent','dusk','shade','whisper','creed','one breath one arrow one silence','hollow-crowned','smoke','mask','untraceable','night-hunter','mist','assassin','thief',
    'admiral','first sea lord','gunner','broadside','jutland','ironclad','trench','artillery','siege','battering','catapult','ballista','sapper','commissar','shock army','gendarmerie','spymaster','secret','police','shadow-'],
};
// historical name/archetype hooks (annals realms have terse flavor; the figure IS the lore)
const HIST = {
  Ranged: ['archer','longbow','yeoman','musketeer','chasseur','voltigeur','tirailleur','sharpshooter','sniper','rifle','crossbow','balistar','scout','bedouin','raider','partisan','cossack'],
  Guard: ['wellington','iron duke','marlborough','grenadier','coldstream','highlander','household','phalanx','testudo','praetorian','varangian','cataphract','hoplite','centurion','legion','red guard','home guard','garrison','governor','constable','warden','custodian','chamberlain'],
  Charge: ['marshal','marechal','cuirassier','carabinier','zouave','hussar','lancer','dragoon','cavalry','brigade','camel','sipahi','ghulam','mamluk','janissary','saracen','legion','elephant','chariot','vanguard','blitz'],
  Bane: ['poisoner','hashashin','assassin','bane','venom','plague','pestilence','typhus','cholera','inquisition','executioner','headsman','hangman','sicarius','curse','hex'],
  Lifesteal: ['vampire','dracula','blood','sanguine','leech','bathory','ghoul','feast','reaper','harvest','famine','tyrant'],
  Shock: ['admiral','nelson','beatty','jutland','ironclad','dreadnought','gunboat','broadside','artillery','howitzer','katyusha','thunder','storm','lightning','tesla','cannon','naval','fleet','navy','storm of iron'],
  Relentless: ['bonaparte','napoleon','caesar','alexander','subotai','scipio','wrestler','gladiator','pit','duel','vendetta','grudge','tireless','relentless','achilles','hercules','samson','conqueror'],
  Aegis: ['blessed','saint','constantine','theodosian','basilica','icon','halo','gilded','golden','mace','throne','patriarch','pontiff','templar','teutonic','crusader','order of','knighthood','garter','chivalry','oath','vow','crown','anoint'],
  Shadow: ['spymaster','walsingham','guiscard','cardinal','whisper','cabal','jacobin','okhrana','cheka','night','veiled','silent','quiet','tacit','fox','machiavell','cunning','sly'],
};
const REALM_PRIOR = {
  barning: { Ranged:1.2, Shock:1.3, Guard:1.1 }, lucerre: { Charge:1.3, Ranged:1.2, Aegis:1.1 },
  fenorian: { Guard:1.3, Charge:1.2 }, crescent: { Charge:1.2, Bane:1.2, Relentless:1.1 },
  ironsteppes: { Shock:1.3, Guard:1.2, Charge:1.1 }, stormlit: { Guard:1.3, Ranged:1.2 },
  starwind: { Ranged:1.3, Aegis:1.2 }, tigerpass: { Ranged:1.2, Relentless:1.2, Bane:1.1 },
  zephek: { Aegis:1.3, Guard:1.2, Charge:1.1 }, wayfarers: { Ranged:1.2, Guard:1.1 },
  courts: { Shadow:1.3, Aegis:1.2, Bane:1.1 }, kingdoms: { Charge:1.2, Guard:1.2 },
  towers: { Aegis:1.2, Ranged:1.2 }, necropolis: { Bane:1.3, Lifesteal:1.3, Shadow:1.2 },
  marches: { Charge:1.3, Relentless:1.2, Shock:1.2 }, deepholds: { Guard:1.3, Bane:1.1, Relentless:1.1 },
};

const txt = (c) => ((c.name||'') + ' ' + (c.fl||'') + ' ' + (c.ability||'') + ' ' + (c.tribe||'')).toLowerCase();
function loreScore(c, kw, realm){
  const t = txt(c);
  let hits = 0;
  for (const w of LEX[kw]) if (t.includes(w)) hits += (w.includes(' ')?2:1);
  for (const w of (HIST[kw] || [])) if (t.includes(w)) hits += (w.includes(' ')?2:1.5);
  if (!hits) return 0;
  return hits * (REALM_PRIOR[realm] && REALM_PRIOR[realm][kw] ? REALM_PRIOR[realm][kw] : 1);
}
// gameplay-shape fit: a keyword that agrees with the stat silhouette reads right at a glance
function shapeBonus(c, kw){
  let b = 0;
  if (kw === 'Guard' || kw === 'Aegis') b += (c.hp >= c.atk + 1) ? 0.6 : -0.4;
  if (kw === 'Ranged') b += (c.hp <= c.atk + 1) ? 0.4 : 0;
  if (kw === 'Charge' || kw === 'Relentless') b += (c.atk >= 3) ? 0.4 : -0.2;
  if (kw === 'Lifesteal') b += (c.atk >= 2) ? 0.3 : -0.5;
  return b;
}
function kws(c){ return String(c.kw||'').split(/[+,]/).map(s=>s.trim()).filter(Boolean); }
const budget = (c) => 2*c.cost + kws(c).reduce((s,k)=>s+(KWD[k]??0),0) + (c.bc?1:0) + (c.dr?1:0);

const CURATED = {
  "_note": "v0.32.0 hand-curated pairing mints - every entry lore-true to the figure/art (annals realms have terse flavor, so history is the lore). Applied after the algorithmic pass, which skips these ids. fix=true entries correct a legacy keyword that contradicted the character.",
  "barning": {
    "wellington@barning": { "kw": "Guard, Aegis", "note": "the Iron Duke - unconquered defensive general" },
    "arthur-tudor@barning": { "kw": "Guard, Aegis", "note": "the sea-crown's shield" },
    "margaret-thatcher@barning": { "kw": "Ranged, Relentless", "note": "the lady's not for turning" },
    "william-rufus@barning": { "kw": "Ranged, Bane", "note": "the king the arrow took" },
    "philip-sidney@barning": { "kw": "Lifesteal, Relentless", "note": "the poet-knight who gave his water and would not quit" },
    "gen-allenby@barning": { "kw": "Charge, Relentless", "note": "the Palestine campaign, never a backward step" },
    "keir-starmer@barning": { "kw": "Guard, Bane", "note": "the prosecutor's case - shields the law, ends careers" }
  },
  "lucerre": {
    "georges-clemenceau@lucerre": { "kw": "Guard, Bane", "note": "the Tiger - la guerre jusqu'au bout" },
    "louis-ix@lucerre": { "kw": "Guard, Aegis", "note": "the saint-king crusader" },
    "lafayette-2@lucerre": { "kw": "Charge, Relentless", "note": "the hero of two worlds, tireless" },
    "talleyrand@lucerre": { "kw": "Bane, Lifesteal", "note": "survived every regime - fed on them" },
    "davout@lucerre": { "kw": "Charge, Aegis", "note": "the iron marshal of Auerstedt" },
    "philip-iv@lucerre": { "kw": "Charge, Relentless", "note": "the banner never lowers" },
    "alexandre-millerand@lucerre": { "kw": "Guard, Aegis", "note": "chivalry, sharpened" }
  },
  "fenorian": {
    "constantine@fenorian": { "kw": "Guard, Aegis", "note": "by this sign - the shield of the Cross" },
    "augustus@fenorian": { "kw": "Guard, Aegis", "note": "Pax Romana - the shield of Rome" },
    "constantine-xi@fenorian": { "kw": "Aegis, Shadow", "note": "died in the breach and vanished - the marble emperor of legend" },
    "basil-i@fenorian": { "kw": "Aegis, Relentless", "note": "from peasant to the purple - the relentless climb" }
  },
  "crescent": {
    "baibars@crescent": { "kw": "Charge, Relentless", "note": "the slave-sultan who broke the Mongols" },
    "suleiman@crescent": { "kw": "Guard, Aegis", "note": "the Lawgiver at the gates of Vienna" },
    "mahmud-ii@crescent": { "kw": "Bane, Relentless", "note": "the Auspicious Event - the reform that would not stop" },
    "thutmose-iii@crescent": { "kw": "Charge, Aegis", "note": "Megiddo - the warrior-pharaoh with the divine mandate" },
    "nefertiti@crescent": { "kw": "Charge, Aegis", "note": "the sabre and the star" }
  },
  "ironsteppes": {
    "stalin@ironsteppes": { "kw": "Guard, Aegis", "note": "the Man of Steel" },
    "genghis-khan@ironsteppes": { "kw": "Charge, Relentless", "note": "the storm from the steppe" },
    "husayn-bayqara@ironsteppes": { "kw": "Guard, Bane", "note": "the storm does not ask permission" },
    "shah-rukh@ironsteppes": { "kw": "Charge, Relentless", "note": "every furnace births an army - the heir who held it all" },
    "temujin@ironsteppes": { "kw": "Charge, Lifesteal", "note": "before the empire, the wolf" },
    "leonidas@ironsteppes": { "kw": "Aegis, Relentless", "note": "the shield-king - hold and never yield" },
    "ariq-b-ke@ironsteppes": { "kw": "Charge, Relentless", "note": "the steppe civil war, fought to the end" }
  },
  "wayfarers": {
    "julius@wayfarers": { "kw": "Charge, Relentless", "fix": true, "note": "veni vidi vici - correct the Lifesteal error, the relentless charger" },
    "boba@wayfarers": { "kw": "Bane, Shadow", "fix": true, "note": "the bounty hunter - correct the Lifesteal error; hunts unseen, kills what he marks" },
    "thrawn@wayfarers": { "kw": "Charge, Aegis", "note": "the grand admiral - fleet assaults behind layered defenses" },
    "legolas@wayfarers": { "kw": "Ranged", "fix": true, "note": "the elf archer - correct the Charge error to the keyword he was born with" },
    "mance rayder@wayfarers": { "kw": "Ranged", "fix": true, "note": "the King-beyond-the-Wall, a ranger - correct the Lifesteal error" },
    "theon greyjoy@wayfarers": { "kw": "Ranged", "fix": true, "note": "the archer of the Iron Islands - correct the Guard error" }
  },
  "deepholds": {
    "gilithdir-of-the-deep-roads@deepholds": { "kw": "Guard, Aegis", "note": "the Long Memory keeps its own" },
    "thane-breggan-ironhearth@deepholds": { "kw": "Guard, Aegis", "note": "kings come and go; the beard endures" },
    "torgold-the-wall-of-spears@deepholds": { "kw": "Guard, Bane", "note": "the wall of spears ends what it catches" },
    "grimdan-the-dusk-marked@deepholds": { "kw": "Guard, Shadow", "note": "the dusk-marked gatekeeper fights from the dusk" },
    "hewdin-the-dusk-marked@deepholds": { "kw": "Guard, Shadow", "note": "the dusk-marked - marked by the veil" },
    "bramdan-the-silent@deepholds": { "kw": "Guard, Shadow", "note": "the silent keeper no one sees" }
  }
};
const CURATED_IDS = new Set(Object.values(CURATED).flatMap(r => Object.keys(r)));

const byId = new Map();
for (const f of D.factions) for (const c of f.cards) byId.set(c.id, c);

const MINT = {};
const REPORT = [];
const perRealm = {};

// ---- curated table (hand-authored lore mints + keyword corrections) ----
for (const [realm, entries] of Object.entries(CURATED)){
  if (realm.startsWith('_')) continue;
  for (const [id, m] of Object.entries(entries)){
    const c = byId.get(id);
    if (!c){ console.error('CURATED MISSING ' + id); process.exit(1); }
    const newKws = kws({ kw: m.kw });
    const rarity = c.rarity || 'common';
    for (let i = 0; i < newKws.length; i++) for (let j = i + 1; j < newKws.length; j++){
      if (pairLegal(newKws[i], newKws[j], rarity) !== true){ console.error('CURATED MATRIX FAIL ' + id + ': ' + pk(newKws[i], newKws[j])); process.exit(1); }
    }
    const T = 2*c.cost + newKws.reduce((s,k)=>s+KWD[k],0) + (c.bc?1:0) + (c.dr?1:0);
    let { atk, hp } = c;
    const gap = atk + hp - T;
    if (gap > 0){
      for (let i = 0; i < gap; i++){ if (hp > 1) hp--; else if (atk > 2) atk--; else break; }
      if (atk + hp > T){ console.error('CURATED BUDGET FAIL ' + id); process.exit(1); }
    } else if (gap <= -2){
      if (['Guard','Aegis','Lifesteal'].includes(newKws[newKws.length-1])) hp += 1; else if (atk >= 2 && atk < 8) atk += 1; else hp += 1;
    }
    MINT[id] = { kw: m.kw };
    if (atk !== c.atk) MINT[id].atk = atk;
    if (hp !== c.hp) MINT[id].hp = hp;
    REPORT.push({ id, realm, name: c.name, rar: c.rarity, kw: m.kw, lore: 'curated', stats: `${c.atk}/${c.hp} -> ${atk}/${hp}`, cost: c.cost, note: m.note, fix: m.fix || undefined });
  }
}

// ---- algorithmic pass ----
for (const f of D.factions){
  const minions = f.cards.filter(c => !c.type || c.type === 'minion');
  const cap = Math.max(8, Math.min(26, Math.round(minions.length * 0.14)));
  const cand = [];
  for (const c of minions){
    const rarity = c.rarity || 'common';
    if (RORD[rarity] === undefined || RORD[rarity] < 1) continue;
    const cur = kws(c);
    if (cur.length >= 2) continue;
    for (const kw of Object.keys(KWD)){
      if (cur.includes(kw)) continue;
      const sc = loreScore(c, kw, f.id);
      if (!sc) continue;
      cand.push({ c, kw, sc, rarity });
    }
  }
  const picks = [];
  for (const { c, kw, sc, rarity } of cand){
    if (CURATED_IDS.has(c.id)) continue;
    const cur = kws(c);
    if (!cur.length) continue;                 // kw-less cards handled as identity pairs below
    if (pairLegal(cur[0], kw, rarity) !== true) continue;
    picks.push({ c, kw, sc: (sc + shapeBonus(c, kw)) * (1 + 0.15 * RORD[rarity]) });
  }
  picks.sort((a,b) => b.sc - a.sc || a.c.id.localeCompare(b.c.id));
  const chosen = new Set(CURATED_IDS);
  let realmMinted = 0;
  perRealm[f.id] = {};
  for (const p of picks){
    if (realmMinted >= cap) break;
    if (chosen.has(p.c.id)) continue;
    const c = p.c;
    const pairKey = pk(kws(c)[0], p.kw);
    if ((perRealm[f.id][pairKey] || 0) >= 3) continue;   // pair diversity per realm
    const T_new = budget(c) + KWD[p.kw];
    let { atk, hp } = c;
    const gap = atk + hp - T_new;
    if (gap > 0){
      const defensive = ['Guard','Aegis','Lifesteal'].includes(p.kw) || ['Guard','Aegis'].includes(kws(c)[0]);
      for (let i = 0; i < gap; i++){
        if (defensive){ if (hp > 1) hp--; else if (atk > 2) atk--; else break; }
        else { if (atk > 2) atk--; else if (hp > 1) hp--; else break; }
      }
      if (atk + hp > T_new) continue;
      if (kws(c)[0] === 'Guard' && atk > 5) continue;
    } else if (gap <= -2){
      if (['Guard','Aegis','Lifesteal'].includes(p.kw)) hp += 1; else if (atk >= 2 && atk < 8) atk += 1; else hp += 1;
    }
    if (atk < 2 && !(kws(c).includes('Guard') || c.bc || c.dr || p.kw === 'Guard')) continue;
    chosen.add(c.id);
    realmMinted++;
    perRealm[f.id][pairKey] = (perRealm[f.id][pairKey] || 0) + 1;
    const newKw = kws(c)[0] + ', ' + p.kw;
    MINT[c.id] = { kw: newKw };
    if (atk !== c.atk) MINT[c.id].atk = atk;
    if (hp !== c.hp) MINT[c.id].hp = hp;
    REPORT.push({ id: c.id, realm: f.id, name: c.name, rar: c.rarity, kw: newKw, lore: Math.round(p.sc*10)/10, stats: `${c.atk}/${c.hp} -> ${atk}/${hp}`, cost: c.cost });
  }
  // kw-less rare+ cards: mint an identity PAIR (legal, well-scored) toward the cap
  for (const c of minions){
    if (realmMinted >= cap) break;
    if (chosen.has(c.id)) continue;
    if (!['rare','epic','legendary'].includes(c.rarity)) continue;
    if (kws(c).length) continue;
    let best = null;
    for (const a of Object.keys(KWD)) for (const b of Object.keys(KWD)){
      if (a === b) continue;
      if (pairLegal(a, b, c.rarity) !== true) continue;
      const sc = loreScore(c, a, f.id) + loreScore(c, b, f.id);
      if (sc < 3) continue;
      if (!best || sc > best.sc) best = { a, b, sc };
    }
    if (!best) continue;
    const T_new = 2*c.cost + KWD[best.a] + KWD[best.b] + (c.bc?1:0) + (c.dr?1:0);
    let { atk, hp } = c;
    const gap = atk + hp - T_new;
    if (gap > 0){
      for (let i = 0; i < gap; i++){ if (hp > 1) hp--; else if (atk > 2) atk--; else break; }
      if (atk + hp > T_new) continue;
    } else if (gap <= -2){ hp += 1; }
    if (atk < 2 && !['Guard','Aegis'].includes(best.a) && !['Guard','Aegis'].includes(best.b) && !c.bc && !c.dr) continue;
    if ((best.a === 'Guard' || best.b === 'Guard') && atk > 5) continue;
    chosen.add(c.id);
    realmMinted++;
    const newKw = [best.a, best.b].sort((x,y)=>KWD[x]-KWD[y]).join(', ');
    MINT[c.id] = { kw: newKw };
    if (atk !== c.atk) MINT[c.id].atk = atk;
    if (hp !== c.hp) MINT[c.id].hp = hp;
    REPORT.push({ id: c.id, realm: f.id, name: c.name, rar: c.rarity, kw: newKw, lore: Math.round(best.sc*10)/10, stats: `${c.atk}/${c.hp} -> ${atk}/${hp}`, cost: c.cost, identity: true });
  }
}

// ---- legendary triples: legendary-only, premium core, all pairs legal ----
let triples = 0;
outer: for (const f of D.factions){
  for (const c of f.cards){
    if (triples >= 6) break outer;
    if (c.rarity !== 'legendary') continue;
    const theKws = MINT[c.id] ? kws(MINT[c.id]) : kws(c);
    if (theKws.length !== 2 || !MINT[c.id]) continue;     // only upgrade cards minted in THIS pass
    if (!PREMIUM.includes(pk(theKws[0], theKws[1]))) continue;
    for (const kw of Object.keys(KWD)){
      if (theKws.includes(kw)) continue;
      if (pairLegal(theKws[0], kw, 'legendary') !== true || pairLegal(theKws[1], kw, 'legendary') !== true) continue;
      const sc = loreScore(c, kw, f.id);
      if (sc < 3) continue;
      const T = 2*c.cost + theKws.reduce((s,k)=>s+KWD[k],0) + KWD[kw] + (c.bc?1:0) + (c.dr?1:0);
      let atk = MINT[c.id].atk !== undefined ? MINT[c.id].atk : c.atk;
      let hp = MINT[c.id].hp !== undefined ? MINT[c.id].hp : c.hp;
      const gap = atk + hp - T;
      if (gap > 0){ for (let i=0;i<gap;i++){ if (hp>1) hp--; else if (atk>2) atk--; else break; } if (atk+hp > T) continue; }
      else if (gap <= -2) hp += 1;
      MINT[c.id].kw = theKws.join(', ') + ', ' + kw;
      MINT[c.id].atk = atk; MINT[c.id].hp = hp;
      REPORT.push({ id: c.id, realm: f.id, name: c.name, rar: 'legendary', kw: MINT[c.id].kw, lore: Math.round(sc*10)/10, stats: `${c.atk}/${c.hp} -> ${atk}/${hp}`, cost: c.cost, triple: true });
      triples++;
      break;
    }
  }
}

// ---- matrix-compliance fix for legacy cards carrying illegal pairs ----
for (const f of D.factions) for (const c of f.cards){
  const k = kws(c);
  if (k.length < 2) continue;
  const rar = c.rarity || 'common';
  let fix = null;
  if (rar === 'common') fix = (k.length >= 2 && PREMIUM.includes(pk(k[0], k[1]))) ? 'epic' : 'rare';  // commons get NO pair -> bump to satisfy gate
  else if (pk(k[0], k[1]) && PREMIUM.includes(pk(k[0], k[1])) && RORD[rar] < 2) fix = 'epic';  // premium pair below epic
  if (!fix) continue;
  if (MINT[c.id]) MINT[c.id].rarity = fix; else MINT[c.id] = { rarity: fix };
  REPORT.push({ id: c.id, realm: f.id, name: c.name, rar: rar + '->' + fix, kw: k.join(', '), note: 'legacy pair above rarity gate - rarity bumped to satisfy the matrix (cap unchanged: 2x)' });
}

// ---- apply ----
let n = 0;
for (const [id, m] of Object.entries(MINT)){
  const c = byId.get(id);
  if (!c){ console.error('MISSING ' + id); process.exit(1); }
  if (m.kw !== undefined) c.kw = m.kw;
  if (m.atk !== undefined) c.atk = m.atk;
  if (m.hp !== undefined) c.hp = m.hp;
  if (m.rarity !== undefined) c.rarity = m.rarity;
  n++;
}
D.version = '0.32.0';
const out = JSON.stringify(D, null, 1) + '\n';
const outSha = createHash('sha256').update(out).digest('hex');
if (outSha !== EXPECTED_OUT_SHA256 || Buffer.byteLength(out) !== EXPECTED_OUT_BYTES) {
  console.error('OUTPUT GATE FAIL: got ' + outSha + ' (' + Buffer.byteLength(out) + 'B) expected ' + EXPECTED_OUT_SHA256 + ' (' + EXPECTED_OUT_BYTES + 'B)');
  process.exit(1);
}
writeFileSync(DATA, out);
writeFileSync(process.env.FB_MINT_REPORT_PATH || '/tmp/v032-mint-report.json', JSON.stringify(REPORT, null, 1));
console.log('minted: ' + n + ' cards (' + triples + ' triples)');
console.log('per realm: ' + Object.entries(perRealm).map(([r,ps])=>r+'='+Object.values(ps).reduce((a,b)=>a+b,0)).join(' '));
