#!/usr/bin/env node
// v0.31.0 Grand Redesign — realms 2-16 mechanical treatment (245 cards).
// Doctrine (courts pilot, approved): hero-ping purge, keyword-monotony break
// (dominant kw capped ~30%), 1-drop curve floor (>=4 per realm), v0.27/v0.29
// primitives lit per realm (2 onSpell / 2 onDraw / 2 ih, realm-tribe discounts).
// ID-stable, name-stable, rarity-stable. No mints, no renames this pass.
// Courts + all non-minion data byte-identical (regression-verified).
// SHA-GATED: input must hash to the v0.30 baseline, output to the verified
// v0.31 build, or the script exits 1 and nothing is written.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const EXPECTED_IN_SHA256 = '22c7fc314fdaafd7a736d0d42498e8c4b8036de9323b3f3a48ab73e911871e8d';
const EXPECTED_IN_BYTES = 1107597;
const EXPECTED_OUT_SHA256 = '344c64a740a77a524931925d235c0a651af7b3ec97e80b18fc599405df2c0423';
const EXPECTED_OUT_BYTES = 1114423;
const DATA = process.env.FB_CARDS_PATH || 'data/cards.json';
const raw = readFileSync(DATA, 'utf8');
const inSha = createHash('sha256').update(raw).digest('hex');
if (inSha !== EXPECTED_IN_SHA256 || Buffer.byteLength(raw) !== EXPECTED_IN_BYTES) {
  console.error('INPUT GATE FAIL: got ' + inSha + ' (' + Buffer.byteLength(raw) + 'B) expected ' + EXPECTED_IN_SHA256 + ' (' + EXPECTED_IN_BYTES + 'B) - baseline is not the v0.30 courts build');
  process.exit(1);
}
const D = JSON.parse(raw);
const CHANGES = {
 "theresa-may@barning": {
  "cost": 1,
  "hp": 2,
  "dr": null,
  "ability": null
 },
 "adm-beatty@barning": {
  "onSpell": "spGrow",
  "ability": "Whenever you cast an edict, this minion gains +1 Attack."
 },
 "charles-clarke@barning": {
  "cost": 1,
  "hp": 2,
  "ability": "Battlecry: deal 1 damage to a random enemy minion."
 },
 "alistair-darling@barning": {
  "cost": 1,
  "hp": 3,
  "dr": null,
  "ability": null
 },
 "f-m-plumer@barning": {
  "ih": {
   "tribe": "Humans",
   "amount": 1
  },
  "ability": "Costs 1 less while you hold another Human."
 },
 "ramsay-macdonald@barning": {
  "cost": 1,
  "hp": 4,
  "dr": null,
  "ability": null
 },
 "john-major@barning": {
  "onSpell": "spPing",
  "ability": "Whenever you cast an edict, deal 1 damage to a random enemy minion."
 },
 "jack-straw@barning": {
  "onDraw": "odHeal",
  "ability": "Whenever you draw this card, restore 1 Health to your hero."
 },
 "sir-w-robertson@barning": {
  "onDraw": "odDraw",
  "ability": "Whenever you draw this card, draw another card."
 },
 "wellington-2@barning": {
  "ih": {
   "tribe": "Humans",
   "amount": 1
  },
  "ability": "Costs 1 less while you hold another Human."
 },
 "adm-coligny@lucerre": {
  "cost": 1,
  "hp": 2,
  "bc": "bcPing",
  "dr": null,
  "ability": "Battlecry: deal 1 damage to a random enemy minion."
 },
 "henry-ii@lucerre": {
  "cost": 1,
  "hp": 3
 },
 "kl-ber@lucerre": {
  "cost": 1,
  "hp": 2,
  "dr": null,
  "ability": null
 },
 "marat@lucerre": {
  "bc": "bcBuff",
  "ability": "Battlecry: give another friendly minion +1/+1."
 },
 "mortier@lucerre": {
  "onDraw": "odDraw",
  "ability": "Whenever you draw this card, draw another card."
 },
 "nivelle@lucerre": {
  "bc": "bcPing2",
  "ability": "Battlecry: deal 2 damage to a random enemy minion."
 },
 "pauline-borghese@lucerre": {
  "bc": "bcDraw",
  "ability": "Battlecry: draw a card."
 },
 "pierre-laval@lucerre": {
  "bc": "bcHeal2",
  "ability": "Battlecry: restore 2 HP to your hero."
 },
 "fouch@lucerre": {
  "bc": "bcPing2",
  "ability": "Battlecry: deal 2 damage to a random enemy minion."
 },
 "jules-simon@lucerre": {
  "bc": "bcHeal2",
  "ability": "Battlecry: restore 2 HP to your hero. Deathrattle: draw a card."
 },
 "marie-antoinette@lucerre": {
  "bc": "bcHeal2",
  "ability": "Battlecry: restore 2 HP to your hero."
 },
 "falli-res@lucerre": {
  "cost": 1,
  "hp": 4,
  "bc": "bcPing",
  "ability": "Battlecry: deal 1 damage to a random enemy minion."
 },
 "caroline-bonaparte@lucerre": {
  "bc": "bcHeal2",
  "ability": "Battlecry: restore 2 HP to your hero."
 },
 "jacques-chirac@lucerre": {
  "bc": "bcBuff",
  "ability": "Battlecry: give another friendly minion +1/+1."
 },
 "f-lix-faure@lucerre": {
  "bc": "bcPing",
  "ability": "Battlecry: deal 1 damage to a random enemy minion."
 },
 "j-r-me-bonaparte@lucerre": {
  "ih": {
   "tribe": "Humans",
   "amount": 1
  },
  "ability": "Costs 1 less while you hold another Human."
 },
 "lafayette@lucerre": {
  "onSpell": "spPing",
  "ability": "Whenever you cast an edict, deal 1 damage to a random enemy minion."
 },
 "poincar@lucerre": {
  "hp": 5,
  "bc": "bcHeal2",
  "ability": "Battlecry: restore 2 HP to your hero."
 },
 "prince-napoleon@lucerre": {
  "bc": "bcDraw",
  "ability": "Battlecry: draw a card."
 },
 "paul-reynaud@lucerre": {
  "bc": "bcBuff",
  "ability": "Battlecry: give another friendly minion +1/+1."
 },
 "jean-jaur-s@lucerre": {
  "bc": "bcBuff",
  "ability": "Battlecry: give another friendly minion +1/+1. Deathrattle: draw a card."
 },
 "jules-favre@lucerre": {
  "bc": "bcHeal2",
  "ability": "Battlecry: restore 2 HP to your hero. Deathrattle: draw a card."
 },
 "kl-ber-3@lucerre": {
  "ih": {
   "tribe": "Humans",
   "amount": 1
  },
  "ability": "Costs 1 less while you hold another Human."
 },
 "l-on-gambetta@lucerre": {
  "bc": "bcHeal2",
  "ability": "Battlecry: restore 2 HP to your hero. Deathrattle: draw a card."
 },
 "bessi-res@lucerre": {
  "bc": "bcPing2",
  "ability": "Battlecry: deal 2 damage to a random enemy minion."
 },
 "p-tain@lucerre": {
  "bc": "bcPing2",
  "ability": "Battlecry: deal 2 damage to a random enemy minion. Deathrattle: deal 1 damage to a random enemy minion."
 },
 "clemenceau@lucerre": {
  "bc": "bcHeal2",
  "ability": "Battlecry: restore 2 HP to your hero."
 },
 "charles-de-gaulle@lucerre": {
  "bc": "bcBuff",
  "ability": "Battlecry: give another friendly minion +1/+1."
 },
 "oudinot@lucerre": {
  "bc": "bcHeal2",
  "ability": "Battlecry: restore 2 HP to your hero."
 },
 "talleyrand-2@lucerre": {
  "bc": "bcPing2",
  "ability": "Battlecry: deal 2 damage to a random enemy minion."
 },
 "aristide-briand-2@lucerre": {
  "bc": "bcDraw",
  "ability": "Battlecry: draw a card. Deathrattle: restore 2 HP to your hero."
 },
 "soult@lucerre": {
  "bc": "bcDraw",
  "ability": "Battlecry: draw a card."
 },
 "charles-ix@lucerre": {
  "onDraw": "odHeal",
  "ability": "Whenever you draw this card, restore 1 Health to your hero."
 },
 "charles-vii@lucerre": {
  "bc": "bcBuff",
  "ability": "Battlecry: give another friendly minion +1/+1."
 },
 "emile-loubet@lucerre": {
  "onSpell": "spGrow",
  "ability": "Whenever you cast an edict, this minion gains +1 Attack."
 },
 "valerian@fenorian": {
  "cost": 1,
  "hp": 2,
  "dr": null,
  "ability": null
 },
 "leo-iii@fenorian": {
  "onSpell": "spGrow",
  "ability": "Whenever you cast an edict, this minion gains +1 Attack."
 },
 "gallienus@fenorian": {
  "onSpell": "spPing",
  "ability": "Whenever you cast an edict, deal 1 damage to a random enemy minion."
 },
 "jovian@fenorian": {
  "onDraw": "odPing",
  "ability": "Whenever you draw this card, deal 1 damage to a random enemy minion."
 },
 "constantius-ii@fenorian": {
  "cost": 1,
  "hp": 3
 },
 "tiberius-ii@fenorian": {
  "onDraw": "odDraw",
  "ability": "Whenever you draw this card, draw another card."
 },
 "john-tzimiskes@fenorian": {
  "cost": 1,
  "hp": 4,
  "dr": null,
  "ability": null
 },
 "andronikos-ii@fenorian": {
  "cost": 1,
  "hp": 2,
  "bc": "bcPing",
  "ability": "Battlecry: deal 1 damage to a random enemy minion."
 },
 "byzantium-default-m@fenorian": {
  "ih": {
   "tribe": "Humans",
   "amount": 1
  },
  "ability": "Costs 1 less while you hold another Human."
 },
 "carinus@fenorian": {
  "ih": {
   "tribe": "Humans",
   "amount": 1
  },
  "ability": "Costs 1 less while you hold another Human."
 },
 "mehmed-iv@crescent": {
  "onDraw": "odDraw",
  "ability": "Whenever you draw this card, draw another card."
 },
 "amenhotep-ii@crescent": {
  "ih": {
   "tribe": "Humans",
   "amount": 1
  },
  "ability": "Costs 1 less while you hold another Human."
 },
 "mustafa-ii@crescent": {
  "onSpell": "spPing",
  "ability": "Whenever you cast an edict, deal 1 damage to a random enemy minion."
 },
 "mehmed-vi@crescent": {
  "cost": 1,
  "bc": "bcDraw",
  "ability": "Battlecry: draw a card."
 },
 "mehmed-v@crescent": {
  "cost": 1,
  "hp": 2,
  "bc": "bcPing",
  "ability": "Battlecry: deal 1 damage to a random enemy minion."
 },
 "al-nasir-muhammad@crescent": {
  "bc": "bcPing2",
  "ability": "Battlecry: deal 2 damage to a random enemy minion."
 },
 "khushqadam@crescent": {
  "cost": 1
 },
 "akhenaten@crescent": {
  "bc": "bcHeal2",
  "ability": "Battlecry: restore 2 HP to your hero."
 },
 "al-amin@crescent": {
  "bc": "bcHeal2",
  "ability": "Battlecry: restore 2 HP to your hero."
 },
 "al-mansur@crescent": {
  "onDraw": "odPing",
  "ability": "Whenever you draw this card, deal 1 damage to a random enemy minion."
 },
 "al-mutawakkil@crescent": {
  "onSpell": "spGrow",
  "ability": "Whenever you cast an edict, this minion gains +1 Attack."
 },
 "al-qa-im@crescent": {
  "ih": {
   "tribe": "Humans",
   "amount": 1
  },
  "ability": "Costs 1 less while you hold another Human."
 },
 "aurangzeb@crescent": {
  "cost": 1,
  "ability": null
 },
 "chernenko@ironsteppes": {
  "ih": {
   "tribe": "Humans",
   "amount": 1
  },
  "ability": "Costs 1 less while you hold another Human."
 },
 "vasily-shuisky@ironsteppes": {
  "cost": 1,
  "hp": 1
 },
 "brezhnev@ironsteppes": {
  "cost": 1,
  "hp": 1
 },
 "ivan-vi@ironsteppes": {
  "cost": 1,
  "dr": null,
  "ability": null
 },
 "xerxes@ironsteppes": {
  "onSpell": "spPing",
  "ability": "Whenever you cast an edict, deal 1 damage to a random enemy minion."
 },
 "esther@ironsteppes": {
  "cost": 1,
  "dr": null,
  "ability": null
 },
 "agis-iii-areus@ironsteppes": {
  "onDraw": "odPing",
  "ability": "Whenever you draw this card, deal 1 damage to a random enemy minion."
 },
 "cleomenes-i@ironsteppes": {
  "onDraw": "odDraw",
  "ability": "Whenever you draw this card, draw another card."
 },
 "eurysthenes-procles@ironsteppes": {
  "ih": {
   "tribe": "Humans",
   "amount": 1
  },
  "ability": "Costs 1 less while you hold another Human."
 },
 "immortal-of-susa@ironsteppes": {
  "onSpell": "spGrow",
  "ability": "Whenever you cast an edict, this minion gains +1 Attack."
 },
 "silevris-the-hollow-crowned@stormlit": {
  "kw": "Shock"
 },
 "nerendor-the-wall-of-spears@stormlit": {
  "atk": 6,
  "kw": null
 },
 "gilorwyn-the-blood-tithed@stormlit": {
  "onDraw": "odPing",
  "ability": "Whenever you draw this card, deal 1 damage to a random enemy minion."
 },
 "aearlas-the-oath-forged@stormlit": {
  "kw": "Shock"
 },
 "mirevris-the-gate-warden@stormlit": {
  "kw": "Bane"
 },
 "caelenion-the-patient@stormlit": {
  "onSpell": "spPing",
  "ability": "Whenever you cast an edict, deal 1 damage to a random enemy minion."
 },
 "eleneth-the-bold@stormlit": {
  "kw": "Bane",
  "ability": "Deathrattle: deal 2 damage to a random enemy minion."
 },
 "ruarwen-the-thorned@stormlit": {
  "onSpell": "spGrow",
  "ability": "Whenever you cast an edict, this minion gains +1 Attack."
 },
 "ithaliel-of-the-long-watch@stormlit": {
  "hp": 3,
  "kw": null
 },
 "arenmar-the-unbreached@stormlit": {
  "cost": 1,
  "kw": null,
  "dr": null,
  "ability": null
 },
 "nerardor-the-last-voiced@stormlit": {
  "kw": "Shock",
  "ability": "Battlecry: deal 1 damage to a random enemy minion."
 },
 "ithadeth-of-the-quiet-house@stormlit": {
  "hp": 2,
  "kw": null,
  "ability": "Deathrattle: deal 2 damage to a random enemy minion."
 },
 "soreniel-the-steadfast@stormlit": {
  "hp": 2,
  "kw": null,
  "ability": "Battlecry: deal 1 damage to a random enemy minion. Deathrattle: restore 2 HP to your hero."
 },
 "faearien-the-patient@stormlit": {
  "cost": 1,
  "kw": "Bane"
 },
 "aealwen-the-unseen@stormlit": {
  "kw": "Shock",
  "ability": "Deathrattle: deal 2 damage to a random enemy minion."
 },
 "aealiel-the-steadfast@stormlit": {
  "hp": 2,
  "kw": null,
  "ability": "Battlecry: deal 1 damage to a random enemy minion. Deathrattle: deal 2 damage to a random enemy minion."
 },
 "aelok-the-cold-throned@stormlit": {
  "atk": 3,
  "kw": null,
  "ability": null
 },
 "thalwyn@stormlit": {
  "cost": 1,
  "ability": null
 },
 "morris@stormlit": {
  "atk": 4,
  "kw": null,
  "ability": null
 },
 "dralas@stormlit": {
  "cost": 1,
  "kw": "Bane",
  "ability": null
 },
 "leshyi-rootfather@stormlit": {
  "onDraw": "odDraw",
  "ability": "Whenever you draw this card, draw another card."
 },
 "brygida-the-hedge-wife@stormlit": {
  "ih": {
   "tribe": "Elderkin",
   "amount": 1
  },
  "ability": "Costs 1 less while you hold another Elderkin."
 },
 "graleuk-the-thorned@starwind": {
  "ih": {
   "tribe": "Starfarers",
   "amount": 1
  },
  "ability": "Costs 1 less while you hold another Starfarer."
 },
 "skoreshek-the-late-reborn@starwind": {
  "atk": 3,
  "kw": null
 },
 "thakior-the-hollow-crowned@starwind": {
  "kw": "Bane"
 },
 "naliaal-the-keen-eyed@starwind": {
  "kw": "Bane"
 },
 "xelakuk-the-keen-eyed@starwind": {
  "hp": 2,
  "kw": null
 },
 "korakax-of-the-quiet-house@starwind": {
  "hp": 3
 },
 "mekeshara-the-thousand-yard@starwind": {
  "kw": "Bane"
 },
 "voreara-the-swift-loosed@starwind": {
  "atk": 4,
  "kw": null
 },
 "korurusk-the-unseen@starwind": {
  "atk": 4,
  "kw": null
 },
 "naloraal-the-thousand-yard@starwind": {
  "hp": 2,
  "kw": null
 },
 "ureshun-the-keen-eyed@starwind": {
  "kw": "Bane"
 },
 "ureis-the-twice-sworn@starwind": {
  "atk": 3,
  "kw": null
 },
 "mekoax-of-the-ninth-gate@starwind": {
  "kw": "Bane"
 },
 "talakax-the-longbow@starwind": {
  "hp": 2,
  "kw": null
 },
 "vrexior-the-thousand-yard@starwind": {
  "cost": 1,
  "hp": 2,
  "kw": null
 },
 "tavakosh-of-the-grey-fletching@starwind": {
  "kw": "Bane"
 },
 "koreshax-of-the-long-watch@starwind": {
  "cost": 1,
  "hp": 2,
  "kw": "Bane",
  "dr": null,
  "ability": null
 },
 "talaaal-the-thousand-yard@starwind": {
  "atk": 2,
  "kw": "Shock"
 },
 "koriek-the-unbreached@starwind": {
  "cost": 1,
  "hp": 2,
  "dr": null,
  "ability": null
 },
 "naleusk-the-usurper@starwind": {
  "cost": 1,
  "hp": 3,
  "kw": null,
  "bc": "bcPing",
  "ability": "Battlecry: deal 1 damage to a random enemy minion."
 },
 "xelorath-the-wanderer@starwind": {
  "atk": 2,
  "kw": "Shock"
 },
 "vororis-the-swift-loosed@starwind": {
  "hp": 2,
  "kw": null
 },
 "droeath-the-longbow@starwind": {
  "hp": 2,
  "kw": null
 },
 "gralurun-the-keen-eyed@starwind": {
  "atk": 2,
  "kw": "Shock"
 },
 "naleshek-the-reckoner@starwind": {
  "hp": 2,
  "kw": null
 },
 "rukeusk-the-swift-loosed@starwind": {
  "hp": 2,
  "kw": null,
  "ability": "Battlecry: deal 1 damage to a random enemy minion. Deathrattle: deal 2 damage to a random enemy minion."
 },
 "koroor-of-the-grey-fletching@starwind": {
  "atk": 2,
  "kw": "Shock"
 },
 "pyrashith-the-keen-eyed@starwind": {
  "kw": "Shock",
  "ability": null
 },
 "sylieth@starwind": {
  "onSpell": "spGrow",
  "ability": "Whenever you cast an edict, this minion gains +1 Attack."
 },
 "lyroon@starwind": {
  "hp": 3,
  "kw": null,
  "ability": null
 },
 "lyrorak-the-breaker-line@starwind": {
  "kw": "Bane",
  "ability": null
 },
 "sylokok-the-hundred-victor@starwind": {
  "onDraw": "odDraw",
  "ability": "Whenever you draw this card, draw another card."
 },
 "nyax@starwind": {
  "onSpell": "spPing",
  "ability": "Whenever you cast an edict, deal 1 damage to a random enemy minion."
 },
 "fenur-of-the-grey-fletching@starwind": {
  "atk": 2,
  "hp": 10,
  "kw": "Shock",
  "ability": null
 },
 "moreth@starwind": {
  "atk": 2,
  "hp": 3,
  "kw": "Shock",
  "ability": null
 },
 "xilvahri-of-the-deep-choir@starwind": {
  "ih": {
   "tribe": "Starfarers",
   "amount": 1
  },
  "ability": "Costs 1 less while you hold another Starfarer."
 },
 "the-cartographer-of-epsilon-nine@starwind": {
  "onDraw": "odHeal",
  "ability": "Whenever you draw this card, restore 1 Health to your hero."
 },
 "garurot-the-reckoner@tigerpass": {
  "atk": 7,
  "kw": null
 },
 "rokiskab-the-bright-bladed@tigerpass": {
  "kw": "Bane"
 },
 "grokogtusk-the-first-over@tigerpass": {
  "kw": "Shock"
 },
 "molashrek-the-tireless@tigerpass": {
  "onSpell": "spPing",
  "ability": "Whenever you cast an edict, deal 1 damage to a random enemy minion."
 },
 "skuzashgrat-the-thunder-heeled@tigerpass": {
  "hp": 2,
  "kw": null
 },
 "skuzuzog-the-ash-cloaked@tigerpass": {
  "cost": 1,
  "kw": null,
  "bc": "bcPing",
  "ability": "Battlecry: deal 1 damage to a random enemy minion."
 },
 "thugoggore-the-swift-loosed@tigerpass": {
  "onSpell": "spGrow",
  "ability": "Whenever you cast an edict, this minion gains +1 Attack."
 },
 "skuziskab-the-bright-bladed@tigerpass": {
  "cost": 1,
  "kw": null,
  "dr": null,
  "ability": null
 },
 "nagadak-the-patient@tigerpass": {
  "cost": 1,
  "bc": "bcPing",
  "ability": "Battlecry: deal 1 damage to a random enemy minion."
 },
 "garogdak-the-bold@tigerpass": {
  "cost": 1,
  "hp": 2,
  "kw": null
 },
 "aelor@tigerpass": {
  "ih": {
   "tribe": "Beasts",
   "amount": 1
  },
  "ability": "Costs 1 less while you hold another Beast."
 },
 "fenisor-the-swift-loosed@tigerpass": {
  "kw": "Bane",
  "ability": null
 },
 "moran@tigerpass": {
  "atk": 3,
  "kw": null,
  "ability": null
 },
 "keluk@tigerpass": {
  "onDraw": "odDraw",
  "ability": "Whenever you draw this card, draw another card."
 },
 "nymar@tigerpass": {
  "onDraw": "odPing",
  "ability": "Whenever you draw this card, deal 1 damage to a random enemy minion."
 },
 "io-the-basilisk-guard@tigerpass": {
  "ih": {
   "tribe": "Beasts",
   "amount": 1
  },
  "ability": "Costs 1 less while you hold another Beast."
 },
 "abaddon@zephek": {
  "cost": 1,
  "hp": 2,
  "bc": "bcPing",
  "dr": null,
  "ability": "Battlecry: deal 1 damage to a random enemy minion."
 },
 "trazyn@zephek": {
  "onDraw": "odDraw",
  "ability": "Whenever you draw this card, draw another card."
 },
 "corvus corax@zephek": {
  "onDraw": "odHeal",
  "ability": "Whenever you draw this card, restore 1 Health to your hero."
 },
 "vitoian-the-unseen@zephek": {
  "ih": {
   "tribe": "Constructs",
   "amount": 1
  },
  "ability": "Costs 1 less while you hold another Construct."
 },
 "casanmund-the-steadfast@zephek": {
  "cost": 1,
  "hp": 2,
  "dr": null,
  "ability": null
 },
 "constviphel-the-twilight-born@zephek": {
  "ih": {
   "tribe": "Constructs",
   "amount": 1
  },
  "ability": "Costs 1 less while you hold another Construct."
 },
 "ferevus-the-twilight-born@zephek": {
  "cost": 1,
  "hp": 2
 },
 "lucririk@zephek": {
  "dr": "drDraw",
  "ability": "Deathrattle: draw a card."
 },
 "moris@zephek": {
  "onSpell": "spPing",
  "ability": "Whenever you cast an edict, deal 1 damage to a random enemy minion."
 },
 "pyrithur-the-hundred-victor@zephek": {
  "onSpell": "spGrow",
  "ability": "Whenever you cast an edict, this minion gains +1 Attack."
 },
 "sylwyn@zephek": {
  "cost": 1,
  "hp": 2,
  "ability": null
 },
 "alia@wayfarers": {
  "cost": 1,
  "hp": 2,
  "bc": "bcPing",
  "dr": null,
  "ability": "Battlecry: deal 1 damage to a random enemy minion."
 },
 "constantine v@wayfarers": {
  "cost": 1,
  "hp": 2
 },
 "john hume@wayfarers": {
  "cost": 1,
  "hp": 2,
  "dr": null,
  "ability": null
 },
 "theoden@wayfarers": {
  "cost": 1,
  "hp": 3,
  "dr": null,
  "ability": null
 },
 "corlys velaryon@wayfarers": {
  "onSpell": "spPing",
  "ability": "Whenever you cast an edict, deal 1 damage to a random enemy minion."
 },
 "abraham@wayfarers": {
  "kw": "Bane",
  "ability": null
 },
 "ackbar@wayfarers": {
  "ih": {
   "tribe": "Humans",
   "amount": 1
  },
  "ability": "Costs 1 less while you hold another Human."
 },
 "aegon-targaryen@wayfarers": {
  "onDraw": "odHeal",
  "ability": "Whenever you draw this card, restore 1 Health to your hero."
 },
 "aenar-targaryen@wayfarers": {
  "onSpell": "spGrow",
  "ability": "Whenever you cast an edict, this minion gains +1 Attack."
 },
 "ailron@wayfarers": {
  "ih": {
   "tribe": "Humans",
   "amount": 1
  },
  "ability": "Costs 1 less while you hold another Human."
 },
 "al-adil@wayfarers": {
  "onDraw": "odDraw",
  "ability": "Whenever you draw this card, draw another card."
 },
 "taoshtai@kingdoms": {
  "bc": "bcPing2",
  "ability": "Battlecry: deal 2 damage to a random enemy minion."
 },
 "baontai-the-twilight-born@kingdoms": {
  "onDraw": "odDraw",
  "ability": "Whenever you draw this card, draw another card."
 },
 "qingwei-of-the-grey-fletching@kingdoms": {
  "bc": "bcPing2",
  "ability": "Battlecry: deal 2 damage to a random enemy minion."
 },
 "guanrfeng-the-steadfast@kingdoms": {
  "onSpell": "spGrow",
  "ability": "Whenever you cast an edict, this minion gains +1 Attack."
 },
 "peiling-the-steadfast@kingdoms": {
  "bc": "bcPing2",
  "ability": "Battlecry: deal 2 damage to a random enemy minion."
 },
 "chengyan-the-blood-tithed@kingdoms": {
  "bc": "bcBuff",
  "ability": "Battlecry: give another friendly minion +1/+1."
 },
 "ruanyan@kingdoms": {
  "bc": "bcHeal2",
  "ability": "Battlecry: restore 2 HP to your hero."
 },
 "jiantai-the-iron-voiced@kingdoms": {
  "cost": 1,
  "hp": 2,
  "bc": "bcPing",
  "ability": "Battlecry: deal 1 damage to a random enemy minion."
 },
 "peigfeng-the-breaker-line@kingdoms": {
  "bc": "bcBuff",
  "ability": "Battlecry: give another friendly minion +1/+1."
 },
 "niegshu-the-keen-eyed@kingdoms": {
  "bc": "bcPing2",
  "ability": "Battlecry: deal 2 damage to a random enemy minion."
 },
 "guangqiu-the-keen-eyed@kingdoms": {
  "cost": 1,
  "hp": 3,
  "bc": "bcPing",
  "ability": "Battlecry: deal 1 damage to a random enemy minion."
 },
 "duanghai-the-unbowed@kingdoms": {
  "cost": 1,
  "hp": 2,
  "bc": "bcPing",
  "ability": "Battlecry: deal 1 damage to a random enemy minion."
 },
 "pyris-the-breaker-line@kingdoms": {
  "onSpell": "spPing",
  "ability": "Whenever you cast an edict, deal 1 damage to a random enemy minion."
 },
 "orsak@kingdoms": {
  "ih": {
   "tribe": "Humans",
   "amount": 1
  },
  "ability": "Costs 1 less while you hold another Human."
 },
 "mekien@kingdoms": {
  "ih": {
   "tribe": "Humans",
   "amount": 1
  },
  "ability": "Costs 1 less while you hold another Human."
 },
 "nymdor@kingdoms": {
  "cost": 1,
  "ability": null
 },
 "thaleth@kingdoms": {
  "onDraw": "odHeal",
  "ability": "Whenever you draw this card, restore 1 Health to your hero."
 },
 "isenadrel-the-silent@towers": {
  "onSpell": "spPing",
  "ability": "Whenever you cast an edict, deal 1 damage to a random enemy minion."
 },
 "isenaewenna-of-the-ninth-gate@towers": {
  "cost": 1,
  "hp": 2,
  "dr": null,
  "ability": null
 },
 "haliwenna@towers": {
  "bc": "bcBuff",
  "ability": "Battlecry: give another friendly minion +1/+1."
 },
 "othathas-the-breaker-line@towers": {
  "onDraw": "odHeal",
  "ability": "Whenever you draw this card, restore 1 Health to your hero."
 },
 "keliorath@towers": {
  "cost": 1,
  "hp": 2,
  "bc": "bcPing",
  "ability": "Battlecry: deal 1 damage to a random enemy minion."
 },
 "kelomir-the-dusk-marked@towers": {
  "cost": 1,
  "hp": 2,
  "dr": null,
  "ability": null
 },
 "lyriawenna@towers": {
  "cost": 1,
  "hp": 2,
  "dr": null,
  "ability": null
 },
 "szaaris@towers": {
  "ih": {
   "tribe": "Humans",
   "amount": 1
  },
  "ability": "Costs 1 less while you hold another Human."
 },
 "kelwyn@towers": {
  "ih": {
   "tribe": "Humans",
   "amount": 1
  },
  "ability": "Costs 1 less while you hold another Human."
 },
 "draakur-the-steadfast@towers": {
  "onSpell": "spGrow",
  "ability": "Whenever you cast an edict, this minion gains +1 Attack."
 },
 "lyrunun-of-the-quiet-house@towers": {
  "onDraw": "odDraw",
  "ability": "Whenever you draw this card, draw another card."
 },
 "morgrim@necropolis": {
  "onSpell": "spGrow",
  "ability": "Whenever you cast an edict, this minion gains +1 Attack."
 },
 "ghast-rider-hulga@necropolis": {
  "dr": "drHeal2",
  "ability": "Deathrattle: restore 2 HP to your hero."
 },
 "bellringer-of-the-drowned-parish@necropolis": {
  "ih": {
   "tribe": "Undead",
   "amount": 1
  },
  "ability": "Costs 1 less while you hold another Undead."
 },
 "the-gravewarden@necropolis": {
  "dr": "drPing",
  "ability": "Deathrattle: deal 1 damage to a random enemy minion."
 },
 "shade-adjutant-vell@necropolis": {
  "dr": "drPing",
  "ability": "Deathrattle: deal 1 damage to a random enemy minion."
 },
 "nightmare-steed-vhorrus@necropolis": {
  "dr": "drPing",
  "ability": "Battlecry: summon a 1/1 Conscript. Deathrattle: deal 1 damage to a random enemy minion."
 },
 "the-archlich-vermillon@necropolis": {
  "onDraw": "odDraw",
  "ability": "Whenever you draw this card, draw another card."
 },
 "cargath-the-dusk-marked@necropolis": {
  "onDraw": "odPing",
  "ability": "Whenever you draw this card, deal 1 damage to a random enemy minion."
 },
 "drewyn-the-wall-of-spears@necropolis": {
  "ih": {
   "tribe": "Undead",
   "amount": 1
  },
  "ability": "Costs 1 less while you hold another Undead."
 },
 "malhold-the-dusk-marked@necropolis": {
  "onSpell": "spPing",
  "ability": "Whenever you cast an edict, deal 1 damage to a random enemy minion."
 },
 "grumbark-the-lurker@marches": {
  "ih": {
   "tribe": "Greenskins",
   "amount": 1
  },
  "ability": "Costs 1 less while you hold another Greenskin."
 },
 "snikmaw-the-hollow-crowned@marches": {
  "onDraw": "odHeal",
  "ability": "Whenever you draw this card, restore 1 Health to your hero."
 },
 "grashkab-the-reckoner@marches": {
  "kw": "Bane"
 },
 "grazzog-the-nine-crowned@marches": {
  "onSpell": "spGrow",
  "ability": "Whenever you cast an edict, this minion gains +1 Attack."
 },
 "roknak-the-wall-of-spears@marches": {
  "ih": {
   "tribe": "Greenskins",
   "amount": 1
  },
  "ability": "Costs 1 less while you hold another Greenskin."
 },
 "rokdak-the-grave-sworn@marches": {
  "onSpell": "spPing",
  "ability": "Whenever you cast an edict, deal 1 damage to a random enemy minion."
 },
 "grashgnash-the-grave-sworn@marches": {
  "onDraw": "odDraw",
  "ability": "Whenever you draw this card, draw another card."
 },
 "skarfist-the-deep-minded@marches": {
  "atk": 7,
  "kw": null
 },
 "perrin-downs@deepholds": {
  "hp": 2,
  "kw": null
 },
 "grantham-slatefist@deepholds": {
  "atk": 2,
  "kw": "Shock"
 },
 "old-threek-cogstoker@deepholds": {
  "hp": 2,
  "kw": null
 },
 "spore-tender-ixil@deepholds": {
  "kw": "Bane"
 },
 "tordell-the-nine-crowned@deepholds": {
  "onSpell": "spGrow",
  "ability": "Whenever you cast an edict, this minion gains +1 Attack."
 },
 "durmar-the-ash-cloaked@deepholds": {
  "hp": 3,
  "kw": null
 },
 "brambrew-the-deep-minded@deepholds": {
  "atk": 2,
  "kw": "Shock",
  "ability": "Battlecry: draw a card."
 },
 "thragold-the-grave-sworn@deepholds": {
  "hp": 3,
  "kw": null,
  "ability": "Battlecry: restore 2 HP to your hero. Deathrattle: deal 1 damage to all enemy minions."
 },
 "cordell-the-deep-minded@deepholds": {
  "kw": "Bane",
  "ability": null
 },
 "balbard-the-grave-sworn@deepholds": {
  "kw": "Bane",
  "ability": null
 },
 "haldell-the-bold@deepholds": {
  "atk": 2,
  "kw": null
 },
 "tordin-the-silent@deepholds": {
  "kw": "Shock"
 },
 "thrabard-the-wall-of-spears@deepholds": {
  "hp": 8,
  "onDraw": "odDraw",
  "ability": "Whenever you draw this card, draw another card."
 },
 "bregbrew-the-reckoner@deepholds": {
  "atk": 3,
  "kw": null,
  "ability": null
 },
 "durdan-the-reckoner@deepholds": {
  "kw": "Shock"
 },
 "bramdan-the-dusk-marked@deepholds": {
  "ih": {
   "tribe": "Underfolk",
   "amount": 1
  },
  "ability": "Costs 1 less while you hold another Underfolk."
 },
 "brambard-the-silent@deepholds": {
  "hp": 9
 },
 "bregwick-the-reckoner@deepholds": {
  "atk": 4,
  "kw": null,
  "ability": null
 },
 "grimdan-the-thorned@deepholds": {
  "ih": {
   "tribe": "Underfolk",
   "amount": 1
  },
  "ability": "Costs 1 less while you hold another Underfolk."
 },
 "nalwick-the-silent@deepholds": {
  "onSpell": "spPing",
  "ability": "Whenever you cast an edict, deal 1 damage to a random enemy minion."
 },
 "fizzmar-the-grave-sworn@deepholds": {
  "bc": "bcPing2",
  "ability": "Battlecry: deal 2 damage to a random enemy minion."
 },
 "hewwick-the-swift-loosed@deepholds": {
  "onDraw": "odPing",
  "ability": "Whenever you draw this card, deal 1 damage to a random enemy minion."
 },
 "grimbrew-the-swift-loosed@deepholds": {
  "atk": 4,
  "kw": null
 },
 "fizzgrim-the-thorned@deepholds": {
  "kw": "Bane"
 }
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
D.version = '0.31.0';
const out = JSON.stringify(D, null, 1) + '\n';
const outSha = createHash('sha256').update(out).digest('hex');
if (outSha !== EXPECTED_OUT_SHA256 || Buffer.byteLength(out) !== EXPECTED_OUT_BYTES) {
  console.error('OUTPUT GATE FAIL: got ' + outSha + ' (' + Buffer.byteLength(out) + 'B) expected ' + EXPECTED_OUT_SHA256 + ' (' + EXPECTED_OUT_BYTES + 'B)');
  process.exit(1);
}
writeFileSync(DATA, out);
console.log('SHA GATES PASS: ' + outSha);
console.log('patched cards: ' + n + ' across 15 realms; version 0.31.0');
