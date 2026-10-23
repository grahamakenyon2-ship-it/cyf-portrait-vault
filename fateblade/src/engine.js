// engine.js — FATEBLADE rules engine v0.5 (pure, headless-testable).
// v0.11 KEYWORDS: Shock (attack minions the turn played, not the Sovereign),
//       Aegis (first damage instance negated), Bane (destroys any minion it
//       damages, incl. via retaliation), Relentless (attacks twice per turn).
//       All four are gated on the new kw values — the v0.10.1 card pool behaves
//       byte-identically under this engine (regression-verified).
// Shared by src/game.html (browser), tools/simulate.mjs (AI playtesting), and the
// in-game WATCH mode. No DOM access in here.
// v0.3: Sovereign system — each deck is led by one of its Legendary cards; the
//       Sovereign's passive is engine-enforced for whichever side declares it.
// v0.3.1: coin flip (opts.first), FIRST RITES (passive ×2, +1 mana, cheap Skirmish
//       for the coin-flip winner's first three turns), FATIGUE (empty-deck draws
//       deal escalating damage).
// v0.4: DECKS (opts.deckA/deckB = array of 10 card ids → 20-card deck) and
//       ABILITIES — battlecry (on play) and deathrattle (on death) templates with
//       automatic fair targeting (AI-friendly, no player choices needed).
// v0.6.4 BALANCE PASS (deep-playtest v1 findings):
//       SWIFTRANKS nerfed: the 1-mana discount now applies ONCE PER GAME (not once
//       per turn) and only to cards costing 3 or less.
//       BULWARK buffed: Guards played get +2 HP (doubled by First Rites) instead
//       of +1 — it was dead last in every passive tier.
//       FIRST RITES trimmed: no more +1 mana in the opening (coin-flip winner was
//       55-61% to win); passive doubling and the 1-mana Skirmish remain.
//       NORMAL AI stall fix: when walled by Guards it chips the weakest one
//       instead of passing forever (was 12-14% of games hitting the turn cap).
// v0.6: CARD TYPES & STRATEGY — Edicts (type:'edict', fx: one-shot effects),
//       Relics (type:'relic', rl: persistent, max 2 per side), faction
//       archetype synergies (VOLLEY/MOMENTUM/FORMATION/SWARM/ATTRITION fx),
//       and the HARD AI becomes a play evaluator: every legal card is scored
//       by expected value in context (situational edicts, hold vs dump),
//       lethal is checked including spell face damage.
// v0.5: AI DIFFICULTY TIERS — opts.aiA/opts.aiB = 'easy' | 'normal' | 'hard'
//       (default 'normal'). aiTurn(S, side, level) dispatches to the right brain:
//       easy  — sloppy: cheapest plays, hesitates, misses trades, forgets Skirmish
//       normal— the classic greedy AI (unchanged; all prior sim reports reproduce)
//       hard  — lethal-aware: reads the board, trades for value, finishes with
//               hero power, and never misses lethal. Campaign-ready.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FBEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MAX_BOARD = 6, MAX_HAND = 8, MAX_HP = 30, MAX_MANA = 10, MAX_RELICS = 2;
  const AI_LEVELS = ['easy', 'normal', 'hard', 'impossible']; // v0.25.2: Impossible = hard heuristics + learned residual (RL rig v2, 70.06% vs hard)

  const KWTXT = { Guard: 'GUARD', Charge: 'CHARGE', Lifesteal: 'LIFESTEAL', Ranged: 'RANGED',
    Shock: 'SHOCK', Aegis: 'AEGIS', Bane: 'BANE', Relentless: 'RELENTLESS', Shadow: 'SHADOW' };
  const KWDESC = {
    Guard: 'Enemies must attack this minion before any other target.',
    Charge: 'This minion can attack the turn it is played.',
    Lifesteal: 'Damage this minion deals also heals your hero.',
    Ranged: 'This minion attacks without taking retaliation damage.',
    Shock: 'The turn this is played, it can attack enemy minions — but not the enemy Sovereign.',
    Aegis: 'The first damage this would take is negated.',
    Bane: 'Any minion this damages is destroyed, whatever its remaining health.',
    Relentless: 'This minion can attack twice each turn.',
    Shadow: 'This minion cannot be attacked until it attacks.',
  };

  const other = (side) => (side === 'A' ? 'B' : 'A');
  // ---------- v0.20 MULTI-KEYWORD ----------
  // kw may be a list: "Guard, Lifesteal" (comma/plus separated). hasKw(o, k) is the
  // ONLY sanctioned way to test a keyword from now on (cards, board minions, tokens).
  // Perf: per-object cached Set (WeakMap) — hot combat loops don't re-split strings.
  const KW_CACHE = new WeakMap();
  const kwsOf = (o) => {
    if (!o) return new Set();
    let s = KW_CACHE.get(o);
    if (!s) { s = new Set(String(o.kw || '').split(/[+,]/).map((x) => x.trim()).filter(Boolean)); KW_CACHE.set(o, s); }
    return s;
  };
  const hasKw = (o, k) => kwsOf(o).has(k);
  // ---------- v0.29.0 ENGINE PRIMITIVES II: SHADOW (our Stealth dialect) ----------
  // A shadowed minion cannot be ATTACKED until it attacks; aimed edicts still
  // reach it. Shadow is stripped the moment its holder attacks (multi-kw-safe
  // rebuild — never string-replace a kw list).
  const shadowed = (m) => hasKw(m, 'Shadow');
  const stripShadow = (m) => {
    if (!hasKw(m, 'Shadow')) return;
    const rest = [...kwsOf(m)].filter((k) => k !== 'Shadow');
    m.kw = rest.length ? rest.join(', ') : null;
    KW_CACHE.delete(m);
  };
  // Legal ATTACK targets on a board (edicts bypass this). Guards that are
  // shadowed cannot be attacked, so they do not pull attacks either.
  const guardsOn = (foe) => foe.board.filter((x) => hasKw(x, 'Guard') && !shadowed(x));
  // v0.23 T2: tribal system — minions carry a `tribe` string (the 15-tribe
  // taxonomy). All payoff templates read the CARD'S OWN tribe (kin-matters design),
  // so one field serves both identity and synergy. Inert on pre-tribe data.
  const tribeOf = (o) => (o && o.tribe) || null;
  const countTribe = (board, tr) => (tr ? board.reduce((n, m) => n + ((m.tribe === tr || m.tribe === 'Mimic') ? 1 : 0), 0) : 0); // v0.24: Mimic changeling counts as kin of every tribe
  const kwsStr = (o) => [...kwsOf(o)].join(', ');
  // ---------- v0.20 TARGETING (A3) ----------
  // opts.target = { uid } — the chosen target for single-target templates.
  // pickTarget validates against the pool and returns it, or null when absent
  // or invalid; callers fall back to the legacy random/auto pick, so a
  // no-target play consumes S.rng() exactly as before (byte-identical).
  // Deathrattles stay random on purpose (HS-style: you can't aim a deathrattle).
  const pickTarget = (opts, pool) => {
    const t = opts && opts.target;
    if (!t || !t.uid) return null;
    return pool.find((m) => m.uid === t.uid) || null;
  };
  // which cards can be aimed, and at what (null = not targetable)
  const TGT_BC = { bcPing: 'foe', bcPing2: 'foe', bcPing3: 'foe', bcBuff: 'friend', bcPerm: 'friend' }; // v0.27.0: bcPerm aims like bcBuff
  const TGT_FX = { fxSnipe3: 'foe', fxSnipe4: 'foe', fxExecute: 'foe', fxExecute2: 'foe', fxSilence: 'foe', fxTransform: 'foe', fxScorchX: 'foe' }; // v0.21 P8: aimed interaction/burn
  const targetSpec = (c) => TGT_BC[c.bc || ''] || TGT_FX[c.fx || ''] || null;
  const validTargets = (S, side, c) => {
    const spec = targetSpec(c);
    if (!spec) return null;
    if (spec === 'foe') return S[other(side)].board.map((m) => m.uid);
    return S[side].board.filter((m) => m.uid !== c.uid).map((m) => m.uid);
  };
  // ---------- v0.20 A6: AI TARGETING — all difficulties aim well ----------
  // User decision: the game tests deck quality, not aim. The human's no-target
  // play still falls back to the legacy random pick (browser unchanged until
  // the UI flow lands); the AI never leaves targeting to chance.
  const tgtDmg = (c) => ({ bcPing: 1, bcPing2: 2, bcPing3: 3, fxSnipe3: 3, fxSnipe4: 4 }[c.bc || c.fx] || 0);
  const aiTarget = (S, side, c) => {
    const spec = targetSpec(c);
    if (!spec) return null;
    if (spec === 'foe') {
      const pool = S[other(side)].board;
      if (!pool.length) return null;
      const byThreat = (a, b) => (b.atk - a.atk) || (b.hp - a.hp);
      const byValue = (a, b) => (b.atk + b.hp) - (a.atk + a.hp);
      if (c.fx === 'fxExecute' || c.fx === 'fxExecute2') return { uid: pool.slice().sort(byThreat)[0].uid }; // Execute: kill the biggest threat
      const d = tgtDmg(c);
      const killable = d ? pool.filter((t) => t.hp > 0 && t.hp <= d) : [];
      if (killable.length) return { uid: killable.slice().sort(byValue)[0].uid }; // cleanest kill, best value
      return { uid: pool.slice().sort(byThreat)[0].uid };                          // nothing kills: chip the biggest
    }
    // friend (bcBuff): feed the strongest body that isn't the card itself
    const own = S[side].board.filter((m) => m.uid !== c.uid);
    if (!own.length) return null;
    return { uid: own.slice().sort((a, b) => (b.atk + b.hp) - (a.atk + a.hp))[0].uid };
  };
  const hasP = (p, id) => !!(p.sov && p.sov.passive && p.sov.passive.id === id);

  // ---------- state ----------
  // opts: { sovA, sovB, first, deckA, deckB, aiA, aiB, rng }
  //   sovA/sovB — the Legendary cards leading each deck (their .passive is used)
  //   first     — 'A' | 'B', who won the coin flip and acts first
  //   deckA/deckB — arrays of card ids (v0.10: explicit copy lists, e.g. 30
  //                 cards; copy caps are the deck builder's job). If omitted,
  //                 falls back to the faction's defaultDeck, then all its cards.
  //   aiA/aiB   — AI difficulty for that side ('easy'|'normal'|'hard', default 'normal')
  //   rng       — randomness source for random passives (STORMCALL) & random targets
  function startMatch(facA, facB, shuffle, opts) {
    opts = opts || {};
    const mk = (fac, deckIds) => {
      const ids = deckIds && deckIds.length ? deckIds
        : (fac.defaultDeck && fac.defaultDeck.length ? fac.defaultDeck : fac.cards.map(c => c.id));
      const byId = new Map(fac.cards.map(c => [c.id, c]));
      // v0.5: decks may hire Wayfarers' Guild (neutral) cards — index them too
      for (const c of (opts.extraCards || [])) if (!byId.has(c.id)) byId.set(c.id, c);
      const d = [];
      const counts = {};
      for (const id of ids) {
        const c = byId.get(id);
        if (!c) continue;
        // v0.10: deck lists carry explicit copy counts (30-card decks, 2x
        // common/rare, 1x epic) — instance numbering follows the list, no
        // hidden duplication.
        counts[id] = (counts[id] || 0) + 1;
        d.push({ ...c, uid: c.id + '-' + counts[id] });
      }
      return shuffle(d);
    };
    const side = (fac, sov, deckIds) => ({
      hp: MAX_HP, mana: 1, maxmana: 1, power: false, fac,
      deck: mk(fac, deckIds), hand: [], board: [], relics: [],
      sov: sov ? { id: sov.id, name: sov.name, img: sov.img, passive: sov.passive } : null,
      discountUsed: false,
      fatigue: 0,
      sovOnce: {}, turnDraws: 0, tookHeroDmg: false, heroDmgOnce: false, // v0.15: per-turn sovereign hook state
      deathsThisRound: 0, diedLastTurn: 0, edictsThisTurn: 0, drawsThisTurn: 0, ownTurns: 0, warProfCount: 0, lastRitesUsed: false, // v0.26: sovereign overhaul state
      pending: [], fallen: [], // v0.16: delayed decrees queue + graveyard-lite (recursion)
    });
    const first = opts.first === 'B' ? 'B' : 'A';
    const lvl = (v) => (AI_LEVELS.includes(v) ? v : 'normal');
    const S = {
      turn: 1, active: first, first, events: [], rng: opts.rng || Math.random,
      aiA: lvl(opts.aiA), aiB: lvl(opts.aiB),
      A: side(facA, opts.sovA, opts.deckA), B: side(facB, opts.sovB, opts.deckB),
      laws: [], // v0.16: round-scoped Temporary Laws
    };
    const n = (side) => (side === first ? 3 : 4); // going-second compensation: +1 card
    for (let i = 0; i < n('A'); i++) draw(S, 'A', true); // v0.15: draw-phase deal
    for (let i = 0; i < n('B'); i++) draw(S, 'B', true);
    S[first].mana += 1; // First Rites v0.6.4: turn-one bonus (turns 2-3 come from endTurn)
    S.events.push({ t: 'passive', side: first, id: 'FIRST_RITES' });
    return S;
  }

  // First Rites: for the coin-flip winner's first four turns (S.turn 1, 3, 5, 7), their
  // Sovereign passive magnitudes are doubled (+1s become +2s, pings deal 2, …).
  const rites = (S, side) => (S.first === side && S.turn <= 9 ? 2 : 1) + (S[side].relics.some((x) => x.rl === 'rlReliquary') ? 1 : 0); // v0.25.0: widen 7 -> 9 (first player 44.6% in 880k deep playtest)

  function draw(S, side, phase) { // v0.15: phase=true marks draw-phase draws (startMatch deal + start-of-turn draw)
    const p = S[side];
    if (!p.deck.length) {
      // fatigue: each draw from an empty deck escalates (1, 2, 3, …)
      p.fatigue += 1;
      p.hp -= p.fatigue;
      S.events.push({ t: 'fatigue', side, dmg: p.fatigue });
      return;
    }
    if (p.hand.length < MAX_HAND) {
      p.hand.push(p.deck.pop());
      // v0.29.0 PRIMITIVES II: on-draw triggers fire when the card lands in hand
      const got = p.hand[p.hand.length - 1];
      if (got && got.onDraw) {
        S.events.push({ t: 'trigger', side, id: 'ONDRAW', on: got.id, fx: got.onDraw });
        if (got.onDraw === 'odDraw') draw(S, side); // guarded: an empty deck fatigues instead of recursing
        else if (got.onDraw === 'odPing') { const fb = S[other(side)].board; if (fb.length) damageMinion(S, other(side), fb[Math.floor(S.rng() * fb.length)].uid, 1); }
        else if (got.onDraw === 'odHeal') p.hp = Math.min(MAX_HP, p.hp + 1);
      }
    }
    p.drawsThisTurn = (p.drawsThisTurn || 0) + 1; // v0.26: POISON_PEN counts every draw, phase or not
    if (!phase && p.drawsThisTurn >= 2 && hasP(p, 'POISON_PEN') && S[other(side)].board.length) { const t = S[other(side)].board[Math.floor(S.rng() * S[other(side)].board.length)]; S.events.push({ t: 'passive', side, id: 'POISON_PEN', on: t.id }); damageMinion(S, other(side), t.uid, 1 * rites(S, side)); } // Isolelvaine: the second letter cuts deeper
    // v0.15 sovereign draw hooks — only on draws OUTSIDE the draw phase
    if (!phase && (hasP(p, 'PRIVATEERING') || hasP(p, 'CHAOS_LADDER'))) {
      if (hasP(p, 'CHAOS_LADDER')) p.turnDraws += 1;
      const foe = S[other(side)];
      if (hasP(p, 'PRIVATEERING')) { const d = 1 * rites(S, side); foe.hp -= d; S.events.push({ t: 'heroHit', side: other(side), id: 'PRIVATEERING', dmg: d }); }
      if (p.turnDraws >= 2 && hasP(p, 'CHAOS_LADDER') && foe.board.length) { const t = foe.board[Math.floor(S.rng() * foe.board.length)]; S.events.push({ t: 'passive', side, id: 'CHAOS_LADDER', on: t.id }); damageMinion(S, other(side), t.uid, 2); } // v0.16 buff: 1 -> 2
    }
    // v0.16: Satrap's Court — every non-phase draw by the relic's opponent burns their hero
    if (!phase && hasRelic(S[other(side)], 'rlSatrap')) { p.hp -= 1; S.events.push({ t: 'heroHit', side, id: 'RL_SATRAP', dmg: 1 }); }
  }

  // ---------- helpers ----------
  // deal damage to a minion; handles death + Deathrattle + the owner's DEATHGIFT
  function damageMinion(S, victimSide, uid, dmg, combat) { // v0.15: combat tag ('retal'|'hit') for TESTUDO/GLORY/BLOOD_MONEY
    const vp = S[victimSide], foeSide = other(victimSide);
    const t = vp.board.find((x) => x.uid === uid);
    if (!t) return;
    // v0.11 AEGIS: one absorbed damage instance (attacks, retaliation, pings, AOE)
    if (t.shield > 0) { t.shield -= 1; S.events.push({ t: 'shield', side: victimSide, id: t.id, uid }); return; }
    // v0.15 TESTUDO: your Guard minions take 1 less combat damage (min 1)
    if (combat && hasP(vp, 'TESTUDO') && hasKw(t, 'Guard')) dmg = Math.max(1, dmg - 1 * rites(S, victimSide));
    if (combat && hasP(vp, 'TITAN_PLATING') && t.tribe === 'Constructs') dmg = Math.max(1, dmg - 1 * rites(S, victimSide)); // v0.26: Ithael — machine plating shrugs off steel
    if (combat && hasKw(t, 'Guard') && hasRelic(vp, 'rlBasilica')) dmg = Math.max(1, dmg - 1); // v0.16: Iron Basilica
    t.hp -= dmg;
    if (t.hp <= 0) die(S, victimSide, t, uid, combat);
    else refreshPrim(S); // v0.27.0: enrage wakes after damage (no-op on pristine data)
  }
  function die(S, victimSide, t, uid, combat) { // v0.27.0: death processing extracted from damageMinion so aura-loss deaths reuse it verbatim
    const vp = S[victimSide], foeSide = other(victimSide);
    vp.board = vp.board.filter((x) => x.uid !== uid);
    S.events.push({ t: 'death', side: victimSide, id: t.id, uid });
    // Deathrattle templates (fixed/fair automatic targeting)
    const dr = t.dr;
    if (dr) {
      S.events.push({ t: 'dr', side: victimSide, id: dr, src: t.id });
      // v0.12: parameterized magnitudes — drHero1/drPing/drHeal2/drSummon/drDraw
      // keep their exact v0.11 behavior (byte-identical on the same seeds);
      // drPing2/drPing3 hit a random enemy minion for N; drAoe1/drAoe2 sweep
      // the enemy board; drAoeAll1 is the nuclear option — every minion on
      // BOTH boards takes 1, including the rest of yours; drHero2 burns face.
      const drDmg = { drPing: 1, drPing2: 2, drPing3: 3 }[dr];
      const drAoe = { drAoe1: 1, drAoe2: 2 }[dr];
      if (dr === 'drHero1') { const ci = 1 + (hasP(vp, 'COURT_INTRIGUE') ? 2 * rites(S, victimSide) : 0); S[foeSide].hp -= ci; S.events.push({ t: 'heroHit', side: foeSide, id: 'DR', dmg: ci }); } // v0.15: COURT_INTRIGUE
      else if (dr === 'drHero2') { const ci = 2 + (hasP(vp, 'COURT_INTRIGUE') ? 2 * rites(S, victimSide) : 0); S[foeSide].hp -= ci; S.events.push({ t: 'heroHit', side: foeSide, id: 'DR', dmg: ci }); } // v0.15.1: COURT_INTRIGUE
      else if (drDmg && S[foeSide].board.length) {
        const m = S[foeSide].board[Math.floor(S.rng() * S[foeSide].board.length)];
        damageMinion(S, foeSide, m.uid, drDmg);
      }
      else if (drAoe) { const wv = drAoe + (hasP(vp, 'WEAVE') ? rites(S, victimSide) : 0); S[foeSide].board.slice().forEach((m) => damageMinion(S, foeSide, m.uid, wv)); } // v0.15: WEAVE
      else if (dr === 'drAoeAll1') {
        // both boards, in a stable order; each hit can chain further dr's
        S[victimSide === 'A' ? 'B' : 'A'].board.slice().forEach((m) => damageMinion(S, victimSide === 'A' ? 'B' : 'A', m.uid, 1));
        vp.board.slice().forEach((m) => damageMinion(S, victimSide, m.uid, 1));
      }
      else if (dr === 'drHeal2') { vp.hp = Math.min(MAX_HP, vp.hp + 2 + (hasP(vp, 'IRON_RATIONS') ? 2 * rites(S, victimSide) : 0)); } // v0.15: IRON_RATIONS
      else if (dr === 'drSummon') { const hn = 1 + (hasP(vp, 'HORDEMASTER') ? rites(S, victimSide) : 0); for (let hi = 0; hi < hn && vp.board.length < MAX_BOARD; hi++) vp.board.push(token(vp, S)); S.events.push({ t: 'play', side: victimSide, id: 'TOKEN', uid: 'TOKEN' + vp.board.length, kw: null, cost: 1 }); refreshPrim(S); } // v0.15: HORDEMASTER
      else if (dr === 'drDraw') { draw(S, victimSide); }
      else if (dr === 'drTribeRally') { const tr = t.tribe; if (tr) { vp.board.forEach((m) => { if (m.tribe === tr) { m.atk += 1; m.hp += 1; } }); S.events.push({ t: 'passive', side: victimSide, id: 'DR_TRIBE_RALLY', on: tr }); refreshPrim(S); } } // v0.23: the fallen kinsman's oath — surviving kin gain +1/+1
    }
    // v0.16 graveyard-lite + recursion/politics relic hooks
    vp.fallen.push({ id: t.id, name: t.name, img: t.img, file: t.file }); if (vp.fallen.length > 24) vp.fallen.shift();
    // v0.26: sovereign overhaul — death hooks
    vp.deathsThisRound = (vp.deathsThisRound || 0) + 1;
    if (hasP(vp, 'BANNER_OF_SKULLS') && t.id.startsWith('TOKEN@')) { const d = 1 * rites(S, victimSide); S[foeSide].hp -= d; S.events.push({ t: 'heroHit', side: foeSide, id: 'BANNER_OF_SKULLS', dmg: d }); } // Vorgath: every fallen levy burns the foe
    if (hasP(vp, 'LAST_RITES') && !vp.lastRitesUsed) { vp.lastRitesUsed = true; if (vp.board.length < MAX_BOARD) { vp.board.push({ id: 'ECHO@' + t.id, name: 'Echo of ' + t.name, cost: 1, atk: 1, hp: 1, maxhp: 1, kw: null, uid: 'ECHO-' + Math.floor(S.rng() * 1e9), img: t.img, file: t.file, tribe: t.tribe, fl: 'Called back beyond the veil.' }); S.events.push({ t: 'passive', side: victimSide, id: 'LAST_RITES', on: t.id }); refreshPrim(S); } } // Morvenne: once per game the Pale Court gives back its dead
    if (hasRelic(vp, 'rlMoonwell') && !vp.moonwellOnce && vp.hand.length <= 2 && vp.deck.length) { vp.moonwellOnce = true; draw(S, victimSide); S.events.push({ t: 'passive', side: victimSide, id: 'RL_MOONWELL' }); }
    if (combat && hasRelic(S[foeSide], 'rlTrophy')) { const ap2 = S[foeSide]; ap2.hp = Math.min(MAX_HP, ap2.hp + 1); S.events.push({ t: 'passive', side: foeSide, id: 'RL_TROPHY' }); }
    if (hasP(vp, 'DEATHGIFT')) {
      const d = 1 * rites(S, victimSide);
      S[foeSide].hp -= d;
      S.events.push({ t: 'heroHit', side: foeSide, id: 'DEATHGIFT', dmg: d });
    }
    // v0.15 combat-death sovereign passives
    if (combat === 'retal' && hasP(vp, 'GLORY_IN_BATTLE')) {
      const d = 3 * rites(S, victimSide); // v0.15.1 buff: 2 -> 3
      S[foeSide].hp -= d;
      S.events.push({ t: 'heroHit', side: foeSide, id: 'GLORY_IN_BATTLE', dmg: d });
    }
    if (combat === 'retal' && hasP(vp, 'VENGEANCE_MOON')) { // v0.26: Baibars — kin that fall mid-charge are avenged
      const d = 2 * rites(S, victimSide);
      S[foeSide].hp -= d;
      S.events.push({ t: 'heroHit', side: foeSide, id: 'VENGEANCE_MOON', dmg: d });
    }
    if (combat === 'hit' && hasP(S[foeSide], 'BLOOD_MONEY')) {
      const ap = S[foeSide];
      ap.hp = Math.min(MAX_HP, ap.hp + 1 * rites(S, foeSide));
      S.events.push({ t: 'passive', side: foeSide, id: 'BLOOD_MONEY' });
    }
    refreshPrim(S); // v0.27.0: a departing holder's aura/enrage settles after the death hooks
  }
  // 1/1 Conscript token (uses the realm commander portrait)
  function token(p, S) {
    const t = { id: 'TOKEN@' + p.fac.id, name: 'Conscript', cost: 1, atk: 1, hp: 1, kw: null,
      uid: 'TOKEN-' + Math.floor(S.rng() * 1e9), img: p.fac.commander, file: p.fac.commanderFile, fl: 'Sworn to the banner.' };
    if (hasRelic(p, 'rlDrillyard')) { t.atk += 1; t.hp += 1; } // Iron Yards: sworn levies drill to 2/2
    if (hasRelic(p, 'rlDrum')) t.atk += 1; // v0.16: Warlord's Drum — every summoned levy hits harder
    // v0.26: token sovereign passives (tokens never pass through playCard)
    if (hasP(p, 'PRESS_GANG')) { t.atk += 1; t.hp += 1; } // Genghis Khan: pressed levies muster stronger
    if (hasP(p, 'ENDLESS_LEVY')) t.atk += 1; // Skarnag: the banner never runs out of soldiers
    if (hasP(p, 'DRILL_MARSHAL')) t.kw = t.kw ? t.kw + ', Guard' : 'Guard'; // the Iron Marshal: levies stand as a wall
    t.maxhp = t.hp; // v0.26: heal bookkeeping for FIELD_MEDIC
    return t;
  }
  const hasRelic = (p, rl) => p.relics.some((x) => x.rl === rl);
  // ---------- v0.27.0 ENGINE PRIMITIVES I: auras, turn triggers, enrage, persistent enchants ----------
  // Inertness contract: no existing card carries aura/t0/rage/bcPerm, so on
  // pristine data refreshPrim computes zero deltas, fires no events and draws
  // no rng — behavior stays byte-identical (regression-gated before any ship).
  const AURA_SPECS = {
    auraTribe: { atk: 1, hp: 1, match: (h, m) => m.tribe && m.tribe === h.tribe }, // kin banner: other own-tribe minions +1/+1
    auraGuard: { atk: 1, hp: 0, match: (h, m) => hasKw(m, 'Guard') },              // drill marshal: other own Guard minions +1 ATK
    auraAll:   { atk: 1, hp: 0, match: () => true },                               // warlord's presence: other own minions +1 ATK (epic+ only)
  };
  const RAGE_SPECS = { rageAtk2: 2 }; // +2 ATK while damaged
  // LIVE recompute: effective stats are read from board state at call time, so
  // buffs follow minions in and out and a dying holder's gift dies with it.
  // Called at every board-membership / minion-hp mutation point.
  function refreshPrim(S) {
    for (let pass = 0; pass < 24; pass++) {
      let changed = false;
      for (const side of ['A', 'B']) {
        const board = S[side].board;
        for (const m of board) {
          let bA = 0, bH = 0;
          for (const h of board) {
            if (h === m || !h.aura) continue;
            const sp = AURA_SPECS[h.aura];
            if (sp && sp.match(h, m)) { bA += sp.atk; bH += sp.hp; }
          }
          const rg = (m.rage && m.maxhp && m.hp < m.maxhp) ? (RAGE_SPECS[m.rage] || 0) : 0;
          const oA = m._pA || 0, oH = m._pH || 0, oR = m._pR || 0;
          if (bA !== oA || bH !== oH || rg !== oR) {
            m.atk += (bA - oA) + (rg - oR); m.hp += bH - oH;
            m._pA = bA; m._pH = bH; m._pR = rg; changed = true;
          }
        }
      }
      if (!changed) return;
      // a stat delta can drop a minion to 0 hp (aura holder died) — settle deaths, recompute
      const dying = [];
      for (const side of ['A', 'B']) for (const m of S[side].board) if (m.hp <= 0) dying.push([side, m]);
      if (!dying.length) return;
      for (const dy of dying) if (S[dy[0]].board.some((x) => x.uid === dy[1].uid)) die(S, dy[0], dy[1], dy[1].uid, null);
    }
  }
  // Start/end-of-turn minion triggers (owner's side only). Templates reuse the
  // bc/dr machinery shapes: ping, heal, summon, draw. Event log id is unique.
  function resolveTt(S, side, m) {
    const p = S[side], foe = S[other(side)];
    S.events.push({ t: 'trigger', side, id: m.t0 === 'sot' ? 'SOT' : 'EOT', on: m.id, fx: m.tt });
    if (m.tt === 'ttPing' && foe.board.length) { const t = foe.board[Math.floor(S.rng() * foe.board.length)]; damageMinion(S, other(side), t.uid, 1); }
    else if (m.tt === 'ttHeal') p.hp = Math.min(MAX_HP, p.hp + 1);
    else if (m.tt === 'ttDraw') draw(S, side);
    else if (m.tt === 'ttSummon' && p.board.length < MAX_BOARD) { p.board.push(token(p, S)); refreshPrim(S); }
  }
  // damage to a hero; EMBERWARD shaves ALL incoming hero damage (v0.14.2 buff: was attacks only —
  // the passive sat at 38.5% when leading in the 1.86M-game deep playtest).
  function heroDamage(S, victimSide, dmg, fromAttack) {
    const vp = S[victimSide];
    if (hasP(vp, 'EMBERWARD')) dmg = Math.max(1, dmg - rites(S, victimSide));
    if (fromAttack && hasP(vp, 'JADE_BULWARK')) dmg = Math.max(1, dmg - 1 * rites(S, victimSide)); // v0.26: Ruangwei — the jade wall turns aside steel
    if (vp.hand.length >= 6 && hasP(vp, 'NINTH_GATE')) dmg = Math.max(1, dmg - 1 * rites(S, victimSide)); // v0.26: Warden of the Ninth Deep — a prepared delve endures
    vp.hp -= dmg;
    if (dmg > 0) {
      vp.tookHeroDmg = true; // v0.15: STILLNESS — no hero damage since your last turn
      // SCORCHED_EARTH: once per turn, when your hero takes damage, deal 1 to ALL enemy minions
      if (hasP(vp, 'SCORCHED_EARTH') && !vp.heroDmgOnce) {
        vp.heroDmgOnce = true;
        const r = rites(S, victimSide);
        S[other(victimSide)].board.slice().forEach((t) => damageMinion(S, other(victimSide), t.uid, 1 * r));
        S.events.push({ t: 'passive', side: victimSide, id: 'SCORCHED_EARTH' });
      }
    }
    return dmg;
  }
  // v0.21 P8: rlNullify — the first enemy edict that would burn your Sovereign
  // each round is voided (reactive counterplay relic, priced like a secret).
  function edictHeroHit(S, atkSide, id, dmg) {
    const foe = S[other(atkSide)];
    if (dmg > 0 && hasRelic(foe, 'rlNullify') && foe.nullGuard !== S.turn) {
      foe.nullGuard = S.turn;
      S.events.push({ t: 'passive', side: other(atkSide), id: 'RL_NULLIFY', on: id });
      return;
    }
    if (dmg > 0 && hasP(foe, 'COOLANT_VEIL')) dmg = Math.max(0, dmg - 1 * rites(S, other(atkSide))); // v0.26: Praia — enemy edicts splash off the gate
    foe.hp -= dmg;
    if (dmg > 0) S.events.push({ t: 'heroHit', side: other(atkSide), id, dmg });
  }

  // ---------- actions ----------
  function effCost(S, side, c) {
    const p = S[side];
    if (hasP(p, 'SWIFTRANKS') && !p.discountUsed && c.cost <= 3) return Math.max(0, c.cost - rites(S, side)); // v0.6.4: once per game, cheap cards only
    // v0.15: once-per-turn sovereign discounts
    if (hasP(p, 'ORIFLAMME') && hasKw(c, 'Charge') && !p.sovOnce.oriflamme) return Math.max(0, c.cost - rites(S, side));
    if (hasP(p, 'BAZAAR') && c.type === 'edict' && (p.sovOnce.bazaar || 0) < 2) return Math.max(0, c.cost - rites(S, side)); // v0.16 buff: two edicts/turn
    // v0.26: sovereign discount passives
    if (hasP(p, 'STRATAGEM') && c.type === 'edict' && !p.sovOnce.stratagem) return Math.max(0, c.cost - 1 * rites(S, side)); // Meiming: the first edict of the day is on the dynasty
    if (hasP(p, 'DIWAN') && c.type === 'relic') return Math.max(0, c.cost - 1 * rites(S, side)); // Al-Adid: the treasury sponsors the court
    if (hasP(p, 'SOLAR_FLARE') && hasKw(c, 'Ranged') && !p.sovOnce.solarflare) return Math.max(0, c.cost - 1 * rites(S, side)); // Tavaeth: the flare opens the volley
    if (hasP(p, 'ENDLESS_MARCH') && hasKw(c, 'Relentless') && !p.sovOnce.endlessmarch) return Math.max(0, c.cost - 1 * rites(S, side)); // Aelmar: the first banner-bearer marches free
    // v0.16: laws + relic economy/politics hooks
    if (S.laws.some((l) => l.id === 'lawTariff' && l.side !== side)) return c.cost + 1; // Temporary Law: the tariff
    if (hasRelic(p, 'rlAmulet') && c.type === 'edict') return Math.max(0, c.cost - 1);
    if (hasRelic(p, 'rlIdol') && c.cost >= 5) return Math.max(0, c.cost - 1);
    if (hasRelic(p, 'rlVault') && !p.sovOnce.vault) return Math.max(0, c.cost - 1);
    if (hasRelic(S[other(side)], 'rlScales') && c.cost >= 4) return c.cost + 1;
    if (c.tribe && c.tribeCost && p.board.some((m) => m.tribe === c.tribe)) return Math.max(0, c.cost - 1); // v0.23: kin discount — cheaper while a kinsman holds the field
    if (c.ih && p.hand.some((h) => h !== c && h.tribe === c.ih.tribe)) return Math.max(0, c.cost - (c.ih.amount || 1)); // v0.29.0 PRIMITIVES II: in-hand kin discount — cheaper while you HOLD a kinsman
    return c.cost;
  }
  function canPlay(S, side, i) {
    const p = S[side], c = p.hand[i];
    if (!c || p.mana < effCost(S, side, c)) return false;
    if (c.type === 'edict') return true;                       // spells never need board space
    if (c.type === 'relic') return p.relics.length < MAX_RELICS;
    return p.board.length < MAX_BOARD;
  }
  // v0.20 A9: battlecry resolver shared by minion plays and multi-part edict riders.
  function resolveBc(S, side, c, opts, selfUid) {
    const p = S[side], foe = S[other(side)];
    if (c.bc) {
      S.events.push({ t: 'bc', side, id: c.bc, src: c.id });
      // v0.12: parameterized magnitudes — bcHero1/bcPing/bcHeal2 keep their exact
      // v0.11 behavior; bcPing2/bcPing3 hit a random enemy minion for N;
      // bcAoe1 sweeps the enemy board; bcAoeAll1 sweeps BOTH boards (yours too);
      // bcHero2 burns the enemy Sovereign for 2.
      const bcDmg = { bcPing: 1, bcPing2: 2, bcPing3: 3 }[c.bc];
      if (c.bc === 'bcHero1') { const ci = 1 + (hasP(p, 'COURT_INTRIGUE') ? 2 * rites(S, side) : 0); foe.hp -= ci; S.events.push({ t: 'heroHit', side: other(side), id: 'BC', dmg: ci }); } // v0.15: COURT_INTRIGUE
      else if (c.bc === 'bcHero2') { const ci = 2 + (hasP(p, 'COURT_INTRIGUE') ? 2 * rites(S, side) : 0); foe.hp -= ci; S.events.push({ t: 'heroHit', side: other(side), id: 'BC', dmg: ci }); } // v0.15.1: COURT_INTRIGUE
      else if (bcDmg && foe.board.length) {
        const t = pickTarget(opts, foe.board) || foe.board[Math.floor(S.rng() * foe.board.length)]; // v0.20: aimed, else legacy random
        damageMinion(S, other(side), t.uid, bcDmg);
      }
      else if (c.bc === 'bcAoe1') { const wv = 1 + (hasP(p, 'WEAVE') ? rites(S, side) : 0); foe.board.slice().forEach((t) => damageMinion(S, other(side), t.uid, wv)); } // v0.15: WEAVE
      else if (c.bc === 'bcAoeAll1') {
        foe.board.slice().forEach((t) => damageMinion(S, other(side), t.uid, 1));
        p.board.slice().forEach((t) => { if (t.uid !== selfUid) damageMinion(S, side, t.uid, 1); });
      }
      else if (c.bc === 'bcHeal2') { p.hp = Math.min(MAX_HP, p.hp + 2); }
      else if (c.bc === 'bcBuff') {
        const others = p.board.filter((x) => x.uid !== selfUid);
        if (others.length) { const sq = 1 + (hasP(p, 'SQUIG_FRENZY') ? 2 : 0); const b = pickTarget(opts, others) || others[Math.floor(S.rng() * others.length)]; b.atk += sq; b.hp += sq; S.events.push({ t: 'buff', side, id: b.id }); refreshPrim(S); } // v0.20: aimed, else legacy random; v0.15: SQUIG_FRENZY; v0.27.0: enrage can sleep after a heal-carrying buff
      }
      // v0.27.0: persistent enchant — +1/+1 that is ON the minion: survives its
      // caster's death, and Silence strips it (tracked via m.perm).
      else if (c.bc === 'bcPerm') {
        const others = p.board.filter((x) => x.uid !== selfUid);
        if (others.length) { const b = pickTarget(opts, others) || others[Math.floor(S.rng() * others.length)]; b.atk += 1; b.hp += 1; b.perm = { atk: (b.perm ? b.perm.atk : 0) + 1, hp: (b.perm ? b.perm.hp : 0) + 1 }; S.events.push({ t: 'buff', side, id: b.id }); refreshPrim(S); }
      }
      else if (c.bc === 'bcSummon' && p.board.length < MAX_BOARD) { p.board.push(token(p, S)); refreshPrim(S); }
      else if (c.bc === 'bcDraw') { draw(S, side); }
      else if (c.bc === 'bcTribeBanner') { const tr = c.tribe; p.board.forEach((m) => { if (tr && m.tribe === tr) { m.atk += 1; m.hp += 1; } }); if (tr) S.events.push({ t: 'passive', side, id: 'BC_TRIBE_BANNER', on: tr }); refreshPrim(S); } // v0.23: the banner rises — all kin gain +1/+1
      else if (c.bc === 'bcTribeDraw') { if (c.tribe && countTribe(p.board, c.tribe) > 1) draw(S, side); } // v0.23: counsel of kin — draw if another kinsman is already fielded
    }
  }
  function playCard(S, side, i, opts) { // v0.20: opts.target = { uid } aims single-target effects
    opts = opts || {};
    if (!canPlay(S, side, i)) return false;
    const p = S[side], foe = S[other(side)];
    const c = p.hand.splice(i, 1)[0];
    const cost = effCost(S, side, c);
    if (hasP(p, 'SWIFTRANKS') && !p.discountUsed) p.discountUsed = true; // stays spent for the whole game (v0.6.4)
    if (hasP(p, 'ORIFLAMME') && hasKw(c, 'Charge')) p.sovOnce.oriflamme = true; // v0.15: once per turn
    if (hasP(p, 'BAZAAR') && c.type === 'edict') p.sovOnce.bazaar = (p.sovOnce.bazaar || 0) + 1; // v0.16 buff: two/turn
    if (hasP(p, 'STRATAGEM') && c.type === 'edict') p.sovOnce.stratagem = true; // v0.26: first edict each turn
    if (hasP(p, 'SOLAR_FLARE') && hasKw(c, 'Ranged')) p.sovOnce.solarflare = true;
    if (hasP(p, 'ENDLESS_MARCH') && hasKw(c, 'Relentless')) p.sovOnce.endlessmarch = true;
    if (hasRelic(p, 'rlVault') && cost < c.cost) p.sovOnce.vault = true; // v0.16: Gilded Vault — once per turn
    p.mana -= cost;

    // ---- EDICTS: one-shot command cards; resolve and vanish ----
    if (c.type === 'edict') {
      S.events.push({ t: 'edict', side, id: c.id, fx: c.fx });
      if (hasP(p, 'NENYA')) { p.hp = Math.min(MAX_HP, p.hp + 1 * rites(S, side)); S.events.push({ t: 'passive', side, id: 'NENYA' }); } // v0.15: edicts also mend the Sovereign
      // v0.26: sovereign overhaul — edict hooks
      p.edictsThisTurn = (p.edictsThisTurn || 0) + 1;
      if (hasP(p, 'BURNING_BANNER') && !p.sovOnce.burningbanner) { p.sovOnce.burningbanner = true; if (foe.board.length) { const t = foe.board[Math.floor(S.rng() * foe.board.length)]; S.events.push({ t: 'passive', side, id: 'BURNING_BANNER', on: t.id }); damageMinion(S, other(side), t.uid, 1 * rites(S, side)); } } // Karrukh: the banner scatters embers before the order lands
      if (hasP(foe, 'WAR_PROFITEER')) { foe.warProfCount = (foe.warProfCount || 0) + 1; if (foe.warProfCount % 2 === 0 && foe.deck.length) { draw(S, other(side)); S.events.push({ t: 'passive', side: other(side), id: 'WAR_PROFITEER', on: c.id }); } } // Brynelric: every second enemy decree feeds the court's informants
      const svPrey = hasP(p, 'SCORCHED_VICTORY') ? foe.board.map((t) => t.uid) : null; // v0.32.1 rework: Cynisca — snapshot the field before the decree lands
      resolveEdict(S, side, c.fx, c, opts); // v0.20: target flows into the edict switch
      if (svPrey && svPrey.some((uid) => !foe.board.find((t) => t.uid === uid))) edictHeroHit(S, side, 'SCORCHED_VICTORY', 1 * rites(S, side)); // v0.32.1: the decree that kills feeds the pyre
      if (hasP(p, 'RESONANCE') && ['fxPingAll', 'fxPingAll2', 'fxAoe2', 'fxAoe3'].includes(c.fx)) edictHeroHit(S, side, 'RESONANCE', 1 * rites(S, side)); // Maeaemir: the spire rings with every sweep
      if (hasP(p, 'FARSIGHT') && ['fxScry2', 'fxScry3'].includes(c.fx) && foe.board.length) { const t = foe.board.slice().sort((a, b) => (b.atk + b.hp) - (a.atk + a.hp))[0]; S.events.push({ t: 'passive', side, id: 'FARSIGHT', on: t.id }); damageMinion(S, other(side), t.uid, 1 * rites(S, side)); } // Fenith: the tower's eye marks the target
      if (c.bc) resolveBc(S, side, c, opts, null); // v0.20 A9: multi-part edicts — the battlecry rider resolves after the fx
      // v0.29.0 PRIMITIVES II: spell-synergy bodies — every friendly minion with
      // onSpell fires once after the edict resolves (relics do not count).
      // Effects are minion-level only, never edict casts — no recursion by construction.
      for (const sm of p.board.slice()) {
        if (!sm.onSpell || !p.board.includes(sm)) continue; // may have died inside the edict's damage
        S.events.push({ t: 'trigger', side, id: 'ONSPELL', on: sm.id, fx: sm.onSpell });
        if (sm.onSpell === 'spPing') { const fb = foe.board; if (fb.length && p.board.includes(sm)) damageMinion(S, other(side), fb[Math.floor(S.rng() * fb.length)].uid, 1); }
        else if (sm.onSpell === 'spGrow') { if (p.board.includes(sm)) { sm.atk += 1; refreshPrim(S); } }
      }
      return true;
    }
    // ---- RELICS: persistent seats of power; take a relic slot ----
    if (c.type === 'relic') {
      if (p.relics.length >= MAX_RELICS) { p.hand.splice(i, 0, c); p.mana += cost; return false; }
      p.relics.push({ ...c });
      S.events.push({ t: 'relic', side, id: c.id, rl: c.rl });
      if (c.rl === 'rlStandards') p.board.forEach((m) => { if (hasKw(m, 'Guard')) m.atk += 1; }); // eagles rise for the standing army
      if (c.rl === 'rlLookout') { p.board.forEach((m) => { if (hasKw(m, 'Ranged')) { m.atk += 1; m.hp += 1; } }); refreshPrim(S); } // v0.16 buff: +1/+1
      if (c.rl === 'rlTribeStandard' && c.tribe) p.board.forEach((m) => { if (m.tribe === c.tribe) m.atk += 1; }); // v0.23: the standard rises — kin already on the field rally +1 ATK
      if (c.rl === 'rlMirror') { const top = p.deck.splice(-Math.min(2, p.deck.length)); const val = (cc) => cc.type === 'minion' ? (cc.atk + cc.hp + (cc.bc ? 2 : 0) + (cc.dr ? 1 : 0)) : 6; top.sort((a, b) => val(b) - val(a)); while (top.length) p.deck.push(top.pop()); } // v0.16: Dreamer's Mirror — the best of the top two surfaces
      if (hasP(p, 'WARDSMITH')) { p.hp = Math.min(MAX_HP, p.hp + 2 * rites(S, side)); S.events.push({ t: 'passive', side, id: 'WARDSMITH' }); } // v0.26: Emile Oliivier — every ward forged mends its smith
      return true;
    }

    // Sovereign entry passives (First Rites doubles the bonus in the opening)
    const r = rites(S, side);
    const m = { ...c, ready: hasKw(c, 'Charge') || hasKw(c, 'Shock'), uid: c.uid };
    if (hasKw(m, 'Shock')) m.shocked = true; // v0.11: can hit minions, not the hero, this turn
    if (hasKw(m, 'Aegis')) m.shield = 1;    // v0.11: absorbs the first damage instance
    if (hasKw(m, 'Relentless')) m.attacks = 0; // v0.11: attack counter for the second swing
    if (hasKw(m, 'Guard') && hasRelic(p, 'rlStandards')) m.atk += 1; // Legion Standards: every Guard musters +1 atk
    if (S.laws.some((l) => l.id === 'lawMuster' && l.side === side)) { m.atk += 1; m.hp += 1; } // v0.16: Temporary Law: the muster
    if (hasKw(m, 'Ranged') && hasRelic(p, 'rlLookout')) { m.atk += 1; m.hp += 1; } // v0.16 buff: +1/+1
    if (hasKw(m, 'Guard') && hasP(p, 'BULWARK')) m.hp += 1 * r; // v0.25.0: revert v0.6.4 buff to +1 to match card text (deep audit: Breggan 92.2% hot)
    if (hasKw(m, 'Charge') && hasP(p, 'VANGUARD')) m.atk += r;
    if (hasKw(m, 'Lifesteal') && hasP(p, 'SOULTITHE')) m.atk += r;
    if (hasKw(m, 'Ranged') && hasP(p, 'LONGSIGHT')) { m.atk += r; m.hp += r; } // v0.14.2 buff: +1 HP -> +1/+1 (37.2% when leading, weakest passive)
    // v0.15 sovereign entry passives
    if (hasKw(m, 'Lifesteal') && hasP(p, 'OATHBOUND')) { m.atk += r; m.hp += r; } // v0.15.1 buff: +1 HP -> +1/+1
    if (hasKw(m, 'Relentless') && hasP(p, 'BROTHERHOOD')) { m.atk += r; m.hp += r; }
    if (hasKw(m, 'Ranged') && hasP(p, 'STRAFING') && !p.sovOnce.strafing) { m.atk += r; m.hp += r; p.sovOnce.strafing = true; } // v0.15.1 buff: +1 ATK -> +1/+1
    if (c.cost <= 2 && hasP(p, 'PICKET')) { m.atk += r; m.hp += r; } // v0.15.1 buff: +1 HP -> +1/+1
    if (hasKw(m, 'Charge') && hasP(p, 'NIZARI')) m.shield = (m.shield || 0) + r; // v0.15.1 buff: every Charge, not just the first
    // v0.26: sovereign overhaul — entry passives
    p.sovOnce.minion = (p.sovOnce.minion || 0) + 1; // minions fielded this turn (SCARAB_SWARM)
    if (p.sovOnce.minion >= 2 && hasP(p, 'SCARAB_SWARM')) { m.atk += r; m.hp += r; } // Nefertiti: the second beetle rides the first's shell
    if (!p.sovOnce.ghost && hasP(p, 'GHOST_STEP')) { p.sovOnce.ghost = true; m.shield = (m.shield || 0) + r; } // Ubayd Allah: the first servant of the turn walks veiled
    if (hasKw(m, 'Guard')) {
      if (hasP(p, 'STONE_REMEMBERS')) m.hp += 2 * r; // Breggan: the stone remembers every siege
      if (hasP(p, 'VEILED_COURT')) m.shield = (m.shield || 0) + r; // Orsuesande: the court's wall arrives shielded
      if (hasP(p, 'THORN_GUARD')) m.kw = m.kw ? m.kw + ', Lifesteal' : 'Lifesteal'; // Sorariel: the briar drinks what it bleeds
    }
    if (hasP(p, 'BARRICADE') && c.cost <= 2) m.hp += r; // Bryoaris: cheap spires stack the wall
    if (hasP(p, 'GRAVE_CHARGE') && hasKw(m, 'Charge')) m.hp += r; // Belwyn: the dead charge harder to escape
    if (hasP(p, 'AMBUSH') && hasKw(m, 'Charge') && !p.sovOnce.ambush) { p.sovOnce.ambush = true; m.atk += r; m.hp += r; S.events.push({ t: 'passive', side, id: 'AMBUSH', on: m.id }); } // v0.32.1 rework: Babur — the first charge of the day arrives battle-hardened (+1/+1; Charge already readies)
    if (hasP(p, 'PRIDE_OF_THE_PACK') && m.tribe === 'Beasts') m.hp += r; // Ashenmane: pride swells the chest
    if (hasP(p, 'DEN_GUARD') && m.tribe === 'Beasts' && !p.sovOnce.dengu && !hasKw(m, 'Guard')) { p.sovOnce.dengu = true; m.kw = m.kw ? m.kw + ', Guard' : 'Guard'; } // Brannoc: the first beast of the turn stakes the den
    if (hasP(p, 'PACK_HUNTER') && m.tribe && countTribe(p.board, m.tribe) >= 3) { m.atk += r; m.hp += r; } // Moratusk: the pack hunts as one
    if (hasP(p, 'IRON_FIST') && m.atk <= 2) m.atk += r; // Shah Rukh: the small are made to strike above their weight
    if (hasP(p, 'DEEP_RITES') && c.cost >= 5) { m.atk += r; m.hp += r; } // Ordrath: the deep rites crown the mighty
    m.maxhp = m.hp; // v0.26: heal bookkeeping for FIELD_MEDIC (set after entry buffs)
    if (m.tribe && p.relics.some((x) => x.rl === 'rlTribeStandard' && x.tribe === m.tribe)) m.atk += 1; // v0.23: Kin Standard — kinsmen march in with +1 ATK
    p.board.push(m);
    refreshPrim(S); // v0.27.0: the newcomer both receives and grants live auras
    S.events.push({ t: 'play', side, id: c.id, uid: c.uid, kw: c.kw || null, cost: c.cost });
    // v0.20 A9: shared battlecry resolver — minions pass their uid; multi-part
    // edicts pass null (their fx already resolved, the rider lands second).
    if (c.bc) resolveBc(S, side, c, opts, m.uid);
    return true;
  }

  // ---------- EDICT EFFECTS (v0.6) ----------
  function resolveEdict(S, side, fx, c, opts) { // v0.20: opts.target aims single-target edicts
    const p = S[side], foe = S[other(side)];
    const wv = hasP(p, 'WEAVE') ? rites(S, side) : 0; // v0.15: the Weave empowers every sweep
    const pv = hasP(p, 'PYROMANCER') ? rites(S, side) : 0; // v0.32.1 rework: Suleiman — every sweep burns hotter
    switch (fx) {
      case 'fxDraw2': draw(S, side); draw(S, side); break;
      case 'fxPingAll': foe.board.slice().forEach((t) => damageMinion(S, other(side), t.uid, 1 + wv + pv)); break;
      case 'fxAoe2':   foe.board.slice().forEach((t) => damageMinion(S, other(side), t.uid, 2 + wv + pv)); break;
      case 'fxSnipe3': { const t = pickTarget(opts, foe.board) || foe.board.slice().sort((a,b) => (b.atk+b.hp)-(a.atk+a.hp))[0]; if (t) damageMinion(S, other(side), t.uid, 3); break; } // v0.20: aimed, else auto-best
      case 'fxExecute': { const t = pickTarget(opts, foe.board) || foe.board.slice().sort((a,b) => b.atk-a.atk)[0]; if (t) damageMinion(S, other(side), t.uid, t.hp + 99); break; } // v0.20: aimed, else auto-biggest
      case 'fxHealHero4': p.hp = Math.min(MAX_HP, p.hp + 4); break;
      case 'fxMana2': p.mana += 2; break;
      case 'fxRally': { if (p.board.length < MAX_BOARD) p.board.push(token(p, S)); if (p.board.length < MAX_BOARD) p.board.push(token(p, S)); refreshPrim(S); break; }
      case 'fxRallyBoard': p.board.forEach((m) => { m.atk += 1; m.hp += 1; }); refreshPrim(S); break;
      case 'fxVolley': { const n = p.board.filter((m) => hasKw(m, 'Ranged')).length; const d = n * (1 + (hasP(p, 'COURT_INTRIGUE') ? 2 * rites(S, side) : 0)); if (d > 0) edictHeroHit(S, side, 'VOLLEY', d); break; } // v0.21: routes through rlNullify; v0.15.1: COURT_INTRIGUE
      case 'fxMomentum': p.board.forEach((m) => { if (hasKw(m, 'Charge')) m.atk += 2; }); break;
      case 'fxFormation': p.board.forEach((m) => { if (hasKw(m, 'Guard')) m.hp += 2; }); refreshPrim(S); break;
      case 'fxLevy': { p.board.forEach((m) => { if (m.id.startsWith('TOKEN@')) { m.atk += 1; m.hp += 1; } }); if (p.board.length < MAX_BOARD) p.board.push(token(p, S)); refreshPrim(S); break; }
      case 'fxPillage': { const pi = 2 + (hasP(p, 'COURT_INTRIGUE') ? 2 * rites(S, side) : 0); edictHeroHit(S, side, 'PILLAGE', pi); if (p.board.length > foe.board.length) draw(S, side); break; } // v0.21: routes through rlNullify; v0.15.1: COURT_INTRIGUE
      // v0.12: stronger variants — the edict tier the audit asked for
      case 'fxPingAll2': foe.board.slice().forEach((t) => damageMinion(S, other(side), t.uid, 2 + wv + pv)); break;
      case 'fxAoe3':     foe.board.slice().forEach((t) => damageMinion(S, other(side), t.uid, 3 + wv + pv)); break;
      case 'fxSnipe4': { const t = pickTarget(opts, foe.board) || foe.board.slice().sort((a,b) => (b.atk+b.hp)-(a.atk+a.hp))[0]; if (t) damageMinion(S, other(side), t.uid, 4); break; } // v0.20: aimed, else auto-best
      case 'fxVolley2': { const n = p.board.filter((m) => hasKw(m, 'Ranged')).length; const d = n * (2 + (hasP(p, 'COURT_INTRIGUE') ? 2 * rites(S, side) : 0)); if (d > 0) edictHeroHit(S, side, 'VOLLEY', d); break; } // v0.21: routes through rlNullify; v0.15.1: COURT_INTRIGUE
      case 'fxHero3': { edictHeroHit(S, side, 'BURN', 3); break; } // v0.21: routes through rlNullify
      case 'fxDraw3': draw(S, side); draw(S, side); draw(S, side); break;
      case 'fxHealHero6': p.hp = Math.min(MAX_HP, p.hp + 6); break;
      case 'fxRally3': { for (let i = 0; i < 3; i++) if (p.board.length < MAX_BOARD) p.board.push(token(p, S)); refreshPrim(S); break; }
      case 'fxMana3': p.mana += 3; break;
      case 'fxExecute2': { // v0.20: aimed target dies first, auto picks the second
        const pick = pickTarget(opts, foe.board);
        const rest = foe.board.filter((x) => !pick || x.uid !== pick.uid).sort((a,b) => b.atk-a.atk);
        (pick ? [pick, ...rest] : rest).slice(0, 2).forEach((t) => damageMinion(S, other(side), t.uid, t.hp + 99)); break;
      }
      // v0.16: Temporary Laws, Delayed decrees, Hand-quality scry, Espionage
      case 'fxLawTariff': S.laws.push({ id: 'lawTariff', side, until: S.turn + 3 }); S.events.push({ t: 'passive', side, id: 'LAW_TARIFF' }); break;
      case 'fxLawMuster': S.laws.push({ id: 'lawMuster', side, until: S.turn + 3 }); S.events.push({ t: 'passive', side, id: 'LAW_MUSTER' }); break;
      case 'fxDecreeMuster': p.pending.push({ fx: 'decreeMuster' }); break;
      case 'fxDecreeDraw': p.pending.push({ fx: 'decreeDraw' }); break;
      case 'fxDecreeMana': p.pending.push({ fx: 'decreeMana' }); break;
      case 'fxScry2': case 'fxScry3': {
        const k = fx === 'fxScry2' ? 2 : 3;
        const top = p.deck.splice(-Math.min(k, p.deck.length));
        const val = (cc) => cc.type === 'minion' ? (cc.atk + cc.hp + (cc.bc ? 2 : 0) + (cc.dr ? 1 : 0)) : 6;
        top.sort((a, b) => val(b) - val(a));
        while (top.length > 1) p.deck.push(top.pop());
        if (top.length) { p.deck.push(top[0]); draw(S, side); }
        break;
      }
      case 'fxEspionage': {
        draw(S, side);
        if (foe.hand.length >= 4) { const hi = foe.hand.reduce((acc, cc, i2) => (cc.cost > foe.hand[acc].cost ? i2 : acc), 0); const dc = foe.hand.splice(hi, 1)[0]; S.events.push({ t: 'passive', side: other(side), id: 'RL_DISCARD', on: dc.id }); }
        break;
      }
      // v0.21 P8: interaction + choice templates
      case 'fxSilence': { const t = pickTarget(opts, foe.board) || foe.board.slice().sort((a,b) => (b.atk+b.hp)-(a.atk+a.hp))[0]; if (t) { t.kw = null; t.shield = 0; if (t.perm) { t.atk -= t.perm.atk || 0; t.hp -= t.perm.hp || 0; t.perm = null; } t.aura = null; t.rage = null; t.t0 = null; t.tt = null; S.events.push({ t: 'passive', side, id: 'FX_SILENCE', on: t.id }); refreshPrim(S); } break; } // v0.27.0: silence also strips auras/enrage/triggers/persistent enchants // strip keywords + Aegis shield, aimed else auto-biggest
      case 'fxTransform': { const t = pickTarget(opts, foe.board) || foe.board.slice().sort((a,b) => (b.atk+b.hp)-(a.atk+a.hp))[0]; if (t) { t.atk = 1; t.hp = 1; t.kw = null; t.shield = 0; t.bc = null; t.dr = null; t.aura = null; t.rage = null; t.t0 = null; t.tt = null; t.perm = null; t._pA = 0; t._pH = 0; t._pR = 0; t.name = 'Conscript'; t.id = 'SHEEP@' + t.uid; refreshPrim(S); S.events.push({ t: 'passive', side, id: 'FX_TRANSFORM', on: t.id }); } break; } // polymorph: any foe body becomes a 1/1 Conscript
      case 'fxDeliberate': { // discover-class: look at the top 3, take the best, shuffle the rest back in
        const top = p.deck.splice(-Math.min(3, p.deck.length));
        const val = (cc) => cc.type === 'minion' ? (cc.atk + cc.hp + (cc.bc ? 2 : 0) + (cc.dr ? 1 : 0)) : 6;
        top.sort((a, b) => val(b) - val(a));
        while (top.length > 1) p.deck.splice(Math.floor(S.rng() * (p.deck.length + 1)), 0, top.pop());
        if (top.length) p.deck.push(top[0]); // best card goes to hand
        draw(S, side);
        break;
      }
      case 'fxScorchX': { const d = p.mana; const t = pickTarget(opts, foe.board) || foe.board.slice().sort((a,b) => (b.atk+b.hp)-(a.atk+a.hp))[0]; if (t && d > 0) damageMinion(S, other(side), t.uid, d); p.mana = 0; S.events.push({ t: 'passive', side, id: 'FX_SCORCHX', dmg: d }); break; } // X-spell: spend ALL remaining mana as damage to one foe minion
      // v0.23 T2: tribal payoff edicts — all read the card's own tribe
      case 'fxTribeMuster': { const tr = c.tribe; const n = Math.min(3, countTribe(p.board, tr)); for (let i = 0; i < n && p.board.length < MAX_BOARD; i++) p.board.push(token(p, S)); S.events.push({ t: 'passive', side, id: 'FX_TRIBE_MUSTER', on: tr, n }); refreshPrim(S); break; } // one levy per kinsman, up to three
      case 'fxTribeWarCry': { const tr = c.tribe; p.board.forEach((m) => { if (tr && m.tribe === tr) m.atk += 2; }); if (tr) S.events.push({ t: 'passive', side, id: 'FX_TRIBE_WARCRY', on: tr }); break; } // the war cry — kin gain +2 ATK
      case 'fxTribeLaw': { S.laws.push({ id: 'lawTribeGuard', side, tribe: c.tribe || null, until: S.turn + 3 }); S.events.push({ t: 'passive', side, id: 'LAW_TRIBE_GUARD', on: c.tribe || null }); break; } // kin stand as guards for three rounds
    }
  }

  function canAttack(S, side, uid, target) {
    const p = S[side], foe = S[other(side)];
    const m = p.board.find((x) => x.uid === uid);
    if (!m || !m.ready) return false;
    if (hasKw(m, 'Relentless') && (m.attacks || 0) >= 2) return false; // v0.11: two swings max
    if (target.hero && m.shocked) return false; // v0.11: Shock cannot reach the Sovereign this turn
    const guards = foe.board.filter((x) => !shadowed(x) && (hasKw(x, 'Guard') || (x.tribe && S.laws.some((l) => l.id === 'lawTribeGuard' && l.side !== side && l.tribe === x.tribe)))); // v0.23: Tribal Law — enemy kin stand as guards // v0.29.0: a shadowed minion (even a Guard) is not attackable, so it never pulls attacks
    if (target.hero) return guards.length === 0;
    const t = foe.board.find((x) => x.uid === target.uid);
    if (!t || shadowed(t)) return false; // v0.29.0: Shadow — cannot be attacked until it attacks
    return guards.length === 0 || hasKw(t, 'Guard') || (t.tribe && S.laws.some((l) => l.id === 'lawTribeGuard' && l.side !== side && l.tribe === t.tribe)); // v0.23: law-guarded kin are attackable, like any guard
  }
  function attack(S, side, uid, target) {
    if (!canAttack(S, side, uid, target)) return false;
    const p = S[side], foe = S[other(side)];
    const m = p.board.find((x) => x.uid === uid);
    m.attacks = (m.attacks || 0) + 1;
    stripShadow(m); // v0.29.0: Shadow drops the moment its holder attacks
    m.ready = hasKw(m, 'Relentless') && m.attacks < 2; // v0.11: Relentless swings twice
    if (target.hero) {
      const dealt = heroDamage(S, other(side), m.atk, true);
      if (hasKw(m, 'Lifesteal')) p.hp = Math.min(MAX_HP, p.hp + dealt);
      S.events.push({ t: 'heroHit', side, id: m.id, dmg: dealt });
    } else {
      const t = foe.board.find((x) => x.uid === target.uid);
      S.events.push({ t: 'hit', side, id: m.id, dmg: m.atk, on: t.id });
      if (!hasKw(m, 'Ranged') && t.atk > 0) { // v0.20.1: multi-kw Ranged (e.g. 'Ranged, Bane') must not take retaliation
        // retaliation can kill the attacker (their own Deathrattle/DEATHGIFT may fire)
        damageMinion(S, side, m.uid, hasKw(t, 'Bane') ? 999 : t.atk, 'retal'); // v0.11 Bane; v0.15 combat tag for GLORY/TESTUDO
      }
      if (hasKw(m, 'Lifesteal') && m.hp > 0) p.hp = Math.min(MAX_HP, p.hp + m.atk);
      damageMinion(S, other(side), t.uid, hasKw(m, 'Bane') ? 999 : m.atk, 'hit'); // v0.11 Bane; v0.15 combat tag for BLOOD_MONEY/TESTUDO
      if (hasKw(m, 'Ranged') && m.hp > 0 && hasP(p, 'SIEGECRAFT')) { const d = 1 * rites(S, side); heroDamage(S, other(side), d, false); S.events.push({ t: 'heroHit', side: other(side), id: 'SIEGECRAFT', dmg: d }); } // v0.26: Talorath — every aimed volley looses a splinter at the Sovereign
    }
    return true;
  }

  // ================= v0.33 REALM COMMANDS =================
  // One hero power per realm, replacing the universal Skirmish. Wayfarers are
  // the neutral guild — not a playable realm, no command. Every command is
  // priced at ~1.0–1.2 power-equivalents; Decrees (once-per-game riders) are
  // designed but deliberately NOT implemented — see the Realm Commands design
  // doc for the sovOnce grammar when they ship.
  const REALM_COMMANDS = {
    ironsteppes: { name: 'Muster Levy',    cost: 2, kind: 'summon',   text: 'Summon a 1/1 Conscript.' },
    barning:     { name: 'Broadside',      cost: 2, kind: 'dmg', dmg: 1, tset: 'foeHero',   text: 'Deal 1 damage to the enemy Sovereign.' },
    fenorian:    { name: 'Shield Wall',    cost: 2, kind: 'guard',   text: 'Give a friendly minion Guard.' },
    lucerre:     { name: 'Sound the Charge', cost: 2, kind: 'buff', text: 'Give a friendly minion +1 Attack this turn.' },
    crescent:    { name: 'Conscription',   cost: 2, kind: 'dmg', dmg: 1, tset: 'foeMinion', rider: 'conscript', text: 'Deal 1 damage to an enemy minion. If it dies, summon a Conscript.' },
    stormlit:    { name: 'Oathward',       cost: 2, kind: 'heal', heal: 2, text: 'Restore 2 Health to a friendly character.' },
    starwind:    { name: 'Salvage',        cost: 2, kind: 'salvage', text: 'Look at the top card of your deck. Draw it, or put it back.' },
    tigerpass:   { name: 'Blood Rite',     cost: 2, kind: 'selfdmg', dmg: 2, self: 1, tset: 'foeHero', text: 'Deal 2 damage to the enemy Sovereign and 1 damage to your own.' },
    zephek:      { name: 'Assembly Rite',  cost: 2, kind: 'buffself', text: 'Give a friendly minion +0/+1 and Aegis.' },
    courts:      { name: 'Petition the Court', cost: 2, kind: 'draw', text: 'Draw a card.' },
    kingdoms:     { name: 'Jade Vow',       cost: 2, kind: 'buff2',  text: 'Give two friendly minions +0/+1.' },
    towers:      { name: 'Arcane Bolt',    cost: 3, kind: 'dmg', dmg: 2, tset: 'any', text: 'Deal 2 damage to any target.' }, // cost-for-effect doctrine: the realm of magic pays premium for flexibility
    necropolis:  { name: 'Exhume',         cost: 2, kind: 'exhume', text: 'Return the last friendly minion that died as a 1/1 Echo.' },
    marches:     { name: 'Raid',           cost: 2, kind: 'raid', dmg: 1, face: 1, text: 'Deal 1 damage to an enemy minion and 1 damage to the enemy Sovereign.' },
    deepholds:   { name: 'Delve',          cost: 2, kind: 'delve',  text: 'Gain 1 mana this turn.' },
    wayfarers:   null, // the neutral guild fields no command
  };
  function realmCmd(S, side) {
    const f = S[side].fac;
    return (f && REALM_COMMANDS[f.id] !== undefined) ? REALM_COMMANDS[f.id] : null;
  }
  function powerName(S, side) { const c = realmCmd(S, side); return c ? c.name : 'Realm Command'; }
  function powerText(S, side) { const c = realmCmd(S, side); return c ? c.text : ''; }
  function powerKind(S, side) { const c = realmCmd(S, side); return c ? c.kind : null; }
  // What the armed command can legally hit. minion: 'friend' | 'foe' | 'any' | false.
  function powerTargets(S, side) {
    const c = realmCmd(S, side); if (!c) return { hero: false, minion: false, free: false };
    switch (c.kind) {
      case 'summon': case 'draw': case 'exhume': case 'delve':
        return { hero: false, minion: false, free: true };
      case 'salvage': // the UI opens the two-button mini-choice; the AI passes {salvage}
        return { hero: false, minion: false, free: true };
      case 'dmg':
        return { hero: c.tset !== 'foeMinion', minion: c.tset === 'foeMinion' ? 'foe' : (c.tset === 'any' ? 'any' : false), free: false };
      case 'selfdmg':
        return { hero: true, minion: false, free: false };
      case 'raid':
        return { hero: true, minion: 'foe', free: false }; // the face chip rides the raid
      case 'guard': case 'buff': case 'buffself': case 'buff2': case 'heal':
        return { hero: false, minion: 'friend', free: false }; // heal may also take the own hero via {hero:true}
      default:
        return { hero: false, minion: false, free: false };
    }
  }
  function canPower(S, side) {
    const p = S[side];
    return !!realmCmd(S, side) && S.active === side && !p.power && p.mana >= powerCost(S, side);
  }
  // First Rites (rework): the coin-flip winner's first THREE turns, their Realm
  // Command costs (1) less. The old ≤9 window and rites() coupling are gone —
  // First Rites serves the commands, not the other way around.
  function powerCost(S, side) {
    const c = realmCmd(S, side); if (!c) return 0;
    return (S.first === side && S.turn <= 5) ? Math.max(1, c.cost - 1) : c.cost;
  }
  // The command's damage number (per aimed target). Realm-aware: only damage
  // commands carry one. Riders: BLOODLETTER (×2 — dead text under fenorian's
  // Shield Wall until a future cards.json pass) and Unbowed Banner (+1).
  // rites() no longer multiplies powers.
  function powerDmg(S, side) {
    const c = realmCmd(S, side); if (!c) return 0;
    let d = 0;
    if (c.kind === 'dmg') d = c.dmg;          // Broadside / Conscription / Arcane Bolt
    else if (c.kind === 'selfdmg') d = c.dmg; // Blood Rite
    else if (c.kind === 'raid') d = c.face;   // Raid's chip at the Sovereign
    if (!d) return 0;
    if (hasP(S[side], 'BLOODLETTER')) d *= 2;
    if (S[side].relics.some((x) => x.rl === 'rlBanner')) d += 1;
    return d;
  }
  // Face reach only — what lethal reads and threat() count.
  function powerFaceDmg(S, side) {
    return powerTargets(S, side).hero ? powerDmg(S, side) : 0;
  }
  function power(S, side, target) {
    if (!canPower(S, side)) return false;
    const c = realmCmd(S, side); if (!c) return false;
    const p = S[side], foe = S[other(side)];
    target = target || {};
    // validate BEFORE committing mana and the once-per-turn flag
    const tm = target.uid ? p.board.find((x) => x.uid === target.uid) : null;
    const fm = target.uid ? foe.board.find((x) => x.uid === target.uid) : null;
    const pd = powerDmg(S, side);
    switch (c.kind) {
      case 'summon': if (p.board.length >= MAX_BOARD) return false; break;
      case 'dmg':
        if (c.tset === 'foeHero') { if (!target.hero) return false; }
        else if (c.tset === 'foeMinion') { if (!fm) return false; }
        else if (c.tset === 'any') { if (!target.hero && !tm && !fm) return false; }
        break;
      case 'selfdmg': if (!target.hero) return false; break;
      case 'raid': if (!fm && !(target.hero && !foe.board.length)) return false; break; // face-only raid when the foe field is empty
      case 'guard': case 'buff': case 'buffself': if (!tm) return false; break;
      case 'heal': if (!target.hero && !tm) return false; break;
      case 'salvage': if (!p.deck.length || (target.salvage !== 'keep' && target.salvage !== 'put')) return false; break;
      case 'buff2': if (!p.board.length || (target.uid && !tm)) return false; break;
      case 'exhume': if (!p.fallen.length || p.board.length >= MAX_BOARD) return false; break;
      case 'draw': if (!p.deck.length) return false; break;
      case 'delve': break; // the deep holds always answer
    }
    // commit
    p.power = true; p.mana -= powerCost(S, side);
    switch (c.kind) {
      case 'summon': { p.board.push(token(p, S)); refreshPrim(S); S.events.push({ t: 'play', side, id: 'TOKEN', uid: 'TOKEN' + p.board.length, kw: null, cost: 1 }); break; }
      case 'dmg':
        if (target.hero) {
          foe.hp -= pd;
          S.events.push({ t: 'heroHit', side, id: 'POWER', dmg: pd });
        } else {
          S.events.push({ t: 'hit', side, id: 'POWER', dmg: pd, on: fm.id });
          damageMinion(S, other(side), fm.uid, pd);
          if (c.rider === 'conscript' && !foe.board.some((x) => x.uid === fm.uid) && p.board.length < MAX_BOARD) { p.board.push(token(p, S)); refreshPrim(S); S.events.push({ t: 'play', side, id: 'TOKEN', uid: 'TOKEN' + p.board.length, kw: null, cost: 1 }); } // Conscription: the fallen foe's kit is pressed into service
        }
        break;
      case 'selfdmg': {
        foe.hp -= pd;
        S.events.push({ t: 'heroHit', side, id: 'POWER', dmg: pd });
        p.hp -= c.self;
        S.events.push({ t: 'heroHit', side, id: 'POWER_SELF', dmg: c.self });
        break;
      }
      case 'raid': {
        if (fm) { // empty foe field: face-only raid, the chip rides only the Sovereign
          S.events.push({ t: 'hit', side, id: 'POWER', dmg: c.dmg, on: fm.id });
          damageMinion(S, other(side), fm.uid, c.dmg);
        }
        foe.hp -= pd;
        S.events.push({ t: 'heroHit', side, id: 'POWER', dmg: pd });
        break;
      }
      case 'guard': {
        if (!hasKw(tm, 'Guard')) tm.kw = tm.kw ? tm.kw + ', Guard' : 'Guard';
        KW_CACHE.delete(tm); // kw mutated after kwsOf may have cached — invalidate
        S.events.push({ t: 'buff', side, id: 'POWER', on: tm.id });
        refreshPrim(S);
        break;
      }
      case 'buff': { // Sound the Charge: +1 ATK this turn only
        tm.atk += 1; tm.tmpAtk = (tm.tmpAtk || 0) + 1;
        S.events.push({ t: 'buff', side, id: 'POWER', on: tm.id });
        refreshPrim(S);
        break;
      }
      case 'buffself': { // Assembly Rite: +0/+1 and Aegis
        tm.hp += 1; if (tm.maxhp) tm.maxhp += 1;
        if (!hasKw(tm, 'Aegis')) tm.kw = tm.kw ? tm.kw + ', Aegis' : 'Aegis';
        KW_CACHE.delete(tm); // same stale-cache guard as Shield Wall
        tm.shield = 1;
        S.events.push({ t: 'buff', side, id: 'POWER', on: tm.id });
        refreshPrim(S);
        break;
      }
      case 'buff2': { // Jade Vow: two friendly minions +0/+1
        const big = (arr) => arr.slice().sort((a, b) => (b.atk + b.hp) - (a.atk + a.hp));
        const first = tm || big(p.board)[0];
        const rest = big(p.board.filter((x) => x.uid !== first.uid));
        for (const b of [first, rest[0]]) {
          if (!b) continue;
          b.hp += 1; if (b.maxhp) b.maxhp += 1;
          S.events.push({ t: 'buff', side, id: 'POWER', on: b.id });
        }
        refreshPrim(S);
        break;
      }
      case 'heal': {
        if (target.hero) p.hp = Math.min(MAX_HP, p.hp + c.heal);
        else if (tm.maxhp) tm.hp = Math.min(tm.maxhp, tm.hp + c.heal);
        S.events.push({ t: 'passive', side, id: 'POWER' });
        break;
      }
      case 'salvage': { // the top card is the deck's tail: draws pop from the end
        if (target.salvage === 'keep') draw(S, side);
        S.events.push({ t: 'passive', side, id: 'POWER' });
        break;
      }
      case 'draw': { draw(S, side); S.events.push({ t: 'passive', side, id: 'POWER' }); break; } // Petition the Court
      case 'exhume': {
        const gc = p.fallen.pop(); if (!gc) { p.power = false; p.mana += powerCost(S, side); return false; } // paranoia: never strand the flag
        p.board.push({ id: 'ECHO@' + gc.id, name: 'Echo of ' + gc.name, cost: 1, atk: 1, hp: 1, maxhp: 1, kw: null, uid: 'ECHO-' + Math.floor(S.rng() * 1e9), img: gc.img, file: gc.file, fl: 'Called back beyond the veil.' });
        S.events.push({ t: 'play', side, id: 'ECHO', uid: 'ECHO' + p.board.length, kw: null, cost: 1 });
        refreshPrim(S);
        break;
      }
      case 'delve': { p.mana += 1; S.events.push({ t: 'passive', side, id: 'POWER' }); break; }
    }
    if (hasP(p, 'ARCANE_LANCE') && foe.board.length) { const t = foe.board[Math.floor(S.rng() * foe.board.length)]; S.events.push({ t: 'passive', side, id: 'ARCANE_LANCE', on: t.id }); damageMinion(S, other(side), t.uid, 1 * rites(S, side)); } // v0.26: Queliomir — every cast looses a stray arc
    return true;
  }
  // v0.33: the shared power oracle — every brain asks the plan what its realm's
  // command should do THIS turn. Answers, not routines: a legal target object
  // for power(), or null to hold. The brains layer their lethal override on top.
  function aiPowerPlan(S, side) {
    if (!canPower(S, side)) return null;
    const c = realmCmd(S, side); if (!c) return null;
    const p = S[side], foe = S[other(side)];
    const th = threat(S, side);
    const pd = powerDmg(S, side);
    const big = (arr) => arr.slice().sort((a, b) => (b.atk + b.hp) - (a.atk + a.hp))[0];
    switch (c.kind) {
      case 'summon': return p.board.length < MAX_BOARD ? {} : null; // Muster Levy: always another body
      case 'dmg':
        if (c.tset === 'foeHero') return { hero: true }; // Broadside: every turn, the cannons speak
        if (c.tset === 'foeMinion') { const t = big(foe.board.filter((m) => m.hp <= pd)); return t ? { uid: t.uid } : null; } // Conscription: press the kill
        { const t = big(foe.board.filter((m) => m.hp <= pd)); if (t) return { uid: t.uid }; return foe.hp <= pd ? { hero: true } : null; } // Arcane Bolt
      case 'guard': { const t = big(p.board.filter((m) => !hasKw(m, 'Guard'))); return t ? { uid: t.uid } : null; } // Shield Wall: the biggest body stands watch
      case 'buff': { const t = big(p.board.filter((m) => m.ready && m.atk > 0)); return t ? { uid: t.uid } : null; } // Sound the Charge: swing with it now
      case 'heal': {
        if (MAX_HP - p.hp >= 4) return { hero: true }; // Oathward: mend the Sovereign only when it hurts
        const t = big(p.board.filter((m) => m.maxhp && m.hp < m.maxhp));
        return t ? { uid: t.uid } : null;
      }
      case 'salvage': return p.deck.length ? { salvage: p.hand.length < 7 ? 'keep' : 'put' } : null; // top card stays seen; hold a full hand back
      case 'selfdmg': return (p.hp <= 6) ? null : { hero: true }; // Blood Rite: never the last mistake (lethal override lives in the brains)
      case 'buffself': { // Assembly Rite: Aegis only under fire
        if (!th.danger) return null;
        const t = big(p.board); return t ? { uid: t.uid } : null;
      }
      case 'draw': return p.deck.length ? {} : null; // Petition the Court: always
      case 'buff2': { const t = big(p.board); return t ? { uid: t.uid } : null; } // Jade Vow: the engine buffs the biggest and its neighbor
      case 'exhume': return (p.fallen.length && p.board.length < 3) ? {} : null; // a small board earns the dead back
      case 'raid': { if (!foe.board.length) return { hero: true }; const t = big(foe.board.filter((m) => m.hp <= c.dmg)) || big(foe.board); return t ? { uid: t.uid } : null; }
      case 'delve': return p.hand.some((cd) => effCost(S, side, cd) > p.mana) ? {} : null; // Delve: only when something costlier waits
      default: return null;
    }
  }

  function endTurn(S) {
    // v0.26: sovereign overhaul — end-of-turn hooks for the closing side
    {
      const ep = S[S.active];
      if (hasP(ep, 'COURT_WHISPERS') && (ep.edictsThisTurn || 0) >= 2 && ep.deck.length) { S.events.push({ t: 'passive', side: S.active, id: 'COURT_WHISPERS' }); draw(S, S.active); } // Lysobelle: two decrees a day earn the court's ear
      if (hasP(ep, 'FIELD_MEDIC') && ep.board.some((m) => m.hp > 0 && m.maxhp && m.hp < m.maxhp)) { ep.board.forEach((m) => { if (m.hp > 0 && m.maxhp && m.hp < m.maxhp) m.hp += 1 * rites(S, S.active); }); S.events.push({ t: 'passive', side: S.active, id: 'FIELD_MEDIC' }); refreshPrim(S); } // Nerriel: the medic makes her rounds
      for (const tm of ep.board.slice()) if (tm.t0 === 'eot') resolveTt(S, S.active, tm); // v0.27.0: end-of-turn triggers (owner's side only)
      ep.edictsThisTurn = 0; // reset for the next round
    }
    // v0.11: the ending side's Shock window closes and Relentless counters settle
    // v0.33: Sound the Charge's +1 ATK expires with the turn
    S[S.active].board.forEach((m) => { m.shocked = false; m.attacks = 0; if (m.tmpAtk) { m.atk -= m.tmpAtk; m.tmpAtk = 0; } });
    const next = other(S.active);
    S.active = next; S.turn++;
    const np = S[next], foe = S[other(next)];
    np.maxmana = Math.min(MAX_MANA, np.maxmana + 1);
    np.mana = np.maxmana + (S.first === next && S.turn <= 9 ? 1 : 0) + (S.first === next && S.turn <= 1 ? 1 : 0); // v0.25.0: widen 7 -> 9 (first player 44.6% in 880k deep playtest)
    np.power = false;
    np.board.forEach((m) => { m.ready = true; m.shocked = false; m.attacks = 0; }); // v0.11: Aegis (m.shield) intentionally persists across turns
    // relic hooks (v0.6)
    if (hasRelic(np, 'rlGranary')) np.hp = Math.min(MAX_HP, np.hp + 2); // v0.16 buff: 1 -> 2
    if (hasRelic(foe, 'rlLibrary') && foe.mana >= 2) { draw(S, other(next)); S.events.push({ t: 'relicfx', side: other(next), id: 'rlLibrary' }); }
    if (hasRelic(foe, 'rlForage') && foe.board.length < 3 && foe.board.length < MAX_BOARD) { foe.board.push(token(foe, S)); S.events.push({ t: 'relicfx', side: other(next), id: 'rlForage' }); refreshPrim(S); }
    const r = rites(S, next);
    np.sovOnce = {}; np.turnDraws = 0; np.heroDmgOnce = false; np.drawsThisTurn = 0; // v0.15: per-turn sovereign state (tookHeroDmg resets below, after STILLNESS checks it); v0.26: drawsThisTurn
    np.moonwellOnce = false; // v0.16: Moonwell Vial per-turn gate
    // v0.16: Temporary Laws expire with the round (created on turn T, live through your turn T+2)
    S.laws = S.laws.filter((l) => S.turn < l.until);
    // v0.16: Delayed decrees fire at the start of their owner's turn
    const pend = np.pending; np.pending = [];
    for (const pr of pend) {
      if (pr.fx === 'decreeMuster') { for (let pi = 0; pi < 2; pi++) if (np.board.length < MAX_BOARD) np.board.push(token(np, S)); S.events.push({ t: 'passive', side: next, id: 'DECREE_MUSTER' }); refreshPrim(S); }
      else if (pr.fx === 'decreeDraw') { draw(S, next); draw(S, next); S.events.push({ t: 'passive', side: next, id: 'DECREE_DRAW' }); }
      else if (pr.fx === 'decreeMana') { np.mana += 2; S.events.push({ t: 'passive', side: next, id: 'DECREE_MANA' }); }
    }
    for (const tm of np.board.slice()) if (tm.t0 === 'sot') resolveTt(S, next, tm); // v0.27.0: start-of-turn triggers (owner's side only)
    // v0.16 relic turn-start hooks (terrain, recursion, politics, sustain, engines)
    if (hasRelic(np, 'rlFlame') && foe.board.length) { const wf = foe.board.slice().sort((a, b) => (a.atk + a.hp) - (b.atk + b.hp))[0]; S.events.push({ t: 'passive', side: next, id: 'RL_FLAME', on: wf.id }); damageMinion(S, other(next), wf.uid, 1); } // Silver Flame
    if (hasRelic(np, 'rlTent') && np.board.length) { const wt = np.board.slice().sort((a, b) => (a.atk + a.hp) - (b.atk + b.hp))[0]; wt.atk += 1; wt.hp += 1; S.events.push({ t: 'passive', side: next, id: 'RL_TENT', on: wt.id }); refreshPrim(S); } // The Great Tent
    if (hasRelic(np, 'rlRampart')) { np.board.forEach((m) => { if (hasKw(m, 'Guard')) m.hp += 1; }); refreshPrim(S); } // Rampart of Skulls: the wall grows
    if (hasRelic(np, 'rlWard') && !np.tookHeroDmg) np.hp = Math.min(MAX_HP, np.hp + 2); // Glade Ward
    if (hasRelic(np, 'rlHearth') && np.hand.length >= 5) np.hp = Math.min(MAX_HP, np.hp + 2); // Winter Hearth: rewards a full hand
    if (hasRelic(np, 'rlMusketeers')) np.board.forEach((m) => { if (hasKw(m, 'Ranged')) m.atk += 1; }); // King's Musketeers
    if (hasRelic(np, 'rlCistern') && S.turn % 3 === 0) np.mana += 1; // Grand Cistern: every third turn
    if (hasRelic(np, 'rlCuria') && foe.board.length > np.board.length && np.deck.length) { draw(S, next); S.events.push({ t: 'passive', side: next, id: 'RL_CURIA' }); } // Curia Julia: the senate reacts
    if (hasRelic(np, 'rlWarStandard') && np.board.length >= 4) np.board.forEach((m) => { m.atk += 1; }); // War Standard of the Houses
    if (hasRelic(np, 'rlQuill') && np.fallen.length && np.board.length < MAX_BOARD) { const gc = np.fallen.pop(); np.board.push({ id: 'ECHO@' + gc.id, name: 'Echo of ' + gc.name, cost: 1, atk: 1, hp: 1, kw: null, uid: 'ECHO-' + Math.floor(S.rng() * 1e9), img: gc.img, file: gc.file, fl: 'Called back beyond the veil.' }); S.events.push({ t: 'play', side: next, id: 'ECHO', uid: 'ECHO' + np.board.length, kw: null, cost: 1 }); refreshPrim(S); } // Chronicler's Quill: the last of the fallen returns as a 1/1 Echo
    if (hasRelic(np, 'rlDebt') && foe.hand.length >= 7) { const hi = foe.hand.reduce((acc, cc, i2) => (cc.cost > foe.hand[acc].cost ? i2 : acc), 0); const dc = foe.hand.splice(hi, 1)[0]; S.events.push({ t: 'passive', side: other(next), id: 'RL_DISCARD', on: dc.id }); } // The Crown's Debt: hoarders pay
    // v0.26: TEMPEST (Wellington) — the storm gathers every other turn while you are outnumbered
    if (hasP(np, 'TEMPEST') && foe.board.length && np.board.length < foe.board.length && np.ownTurns % 2 === 0) { const wv = 1 * r; foe.board.slice().forEach((t) => damageMinion(S, other(next), t.uid, wv)); S.events.push({ t: 'passive', side: next, id: 'TEMPEST' }); }
    // v0.9.4 buff: threshold 3 -> 4 (deep playtest 9.6M games: Second Sight
    // 28.7% when leading = weakest passive; the <=3 gate rarely fired).
    if (hasP(np, 'SECOND_SIGHT') && np.hand.length <= 3 && np.deck.length) { // v0.21.1: 5 -> 3 (CI: constant draw fatigues courts decks under lysobelle)
      S.events.push({ t: 'passive', side: next, id: 'SECOND_SIGHT' });
      for (let i = 0; i < r; i++) draw(S, next);
    }
    // v0.15 sovereign start-of-turn passives
    const weak = (arr) => arr.length ? arr.reduce((a, b) => (a.atk <= b.atk ? a : b)) : null;
    // v0.26: sovereign overhaul — start-of-turn bookkeeping + hooks
    np.ownTurns = (np.ownTurns || 0) + 1;
    np.diedLastTurn = np.deathsThisRound || 0; np.deathsThisRound = 0;
    if (hasP(np, 'TITHE') && foe.hand.length > np.hand.length) { np.mana += 1 * r; S.events.push({ t: 'passive', side: next, id: 'TITHE' }); } // Asquith: a thin purse taxes the rich
    if (hasP(np, 'MASQUERADE') && np.board.length) { const w0 = weak(np.board); w0.hp += 2 * r; if (w0.maxhp) w0.maxhp += 2 * r; S.events.push({ t: 'passive', side: next, id: 'MASQUERADE', on: w0.id }); refreshPrim(S); } // Fiouenette: the mask hides the frail
    if (hasP(np, 'ELDER_COUNCIL') && np.deck.length) { const tr = [...new Set(np.board.map((m) => m.tribe).filter(Boolean))].find((tr2) => countTribe(np.board, tr2) >= 3); if (tr) { S.events.push({ t: 'passive', side: next, id: 'ELDER_COUNCIL', on: tr }); draw(S, next); } } // Velorwyn: three elders make a quorum
    if (hasP(np, 'TIDE_OF_KIN') && countTribe(np.board, 'Underfolk') >= 3) { np.hp = Math.min(MAX_HP, np.hp + 2 * r); S.events.push({ t: 'passive', side: next, id: 'TIDE_OF_KIN' }); } // Myrra: the tide renews the sworn
    if (hasP(np, 'OVERCLOCK') && np.board.length) { const cs = np.board.filter((m) => m.tribe === 'Constructs'); if (cs.length) { const t2 = cs[Math.floor(S.rng() * cs.length)]; t2.atk += r; t2.hp += r; if (t2.maxhp) t2.maxhp += r; S.events.push({ t: 'passive', side: next, id: 'OVERCLOCK', on: t2.id }); refreshPrim(S); } } // Halior: the engines surge
    if (hasP(np, 'WATCHTOWER_PROTOCOL') && np.board.some((m) => hasKw(m, 'Guard')) && foe.board.length) { const w2 = foe.board.slice().sort((a, b) => (a.atk + a.hp) - (b.atk + b.hp))[0]; S.events.push({ t: 'passive', side: next, id: 'WATCHTOWER_PROTOCOL', on: w2.id }); damageMinion(S, other(next), w2.uid, 1 * r); } // Octtivus: the gate marks the weakest
    if (hasP(np, 'IRON_LEVY') && np.board.length >= 3 && np.board.length < MAX_BOARD) { np.board.push(token(np, S)); S.events.push({ t: 'passive', side: next, id: 'IRON_LEVY' }); refreshPrim(S); } // Ashen-Prime: a warband this size drafts itself
    if (hasP(np, 'GRAVE_HUNGER') && np.diedLastTurn > 0 && np.board.length) { const w3 = weak(np.board); w3.atk += 1 * r; S.events.push({ t: 'passive', side: next, id: 'GRAVE_HUNGER', on: w3.id }); } // Ossrath: what died yesterday feeds today
    if (hasP(np, 'REVENANT_HOST') && np.diedLastTurn >= 3 && np.board.length < MAX_BOARD) { np.board.push(token(np, S)); S.events.push({ t: 'passive', side: next, id: 'REVENANT_HOST' }); refreshPrim(S); } // the Hollow Choir: a fallen chorus rises one voice stronger
    if (hasP(np, 'NOVA_CASCADE') && np.hand.length >= 5 && foe.board.length) { const t3 = foe.board[Math.floor(S.rng() * foe.board.length)]; S.events.push({ t: 'passive', side: next, id: 'NOVA_CASCADE', on: t3.id }); damageMinion(S, other(next), t3.uid, 1 * r); } // Sylur: the hundredth victory leaves an ember
    if (hasP(np, 'THUNDER_SPIRE') && foe.board.length > np.board.length) { const w4 = foe.board.slice().sort((a, b) => (a.atk + a.hp) - (b.atk + b.hp)).slice(0, 2); for (const t4 of w4) { S.events.push({ t: 'passive', side: next, id: 'THUNDER_SPIRE', on: t4.id }); damageMinion(S, other(next), t4.uid, 1 * r); } } // Maeiowynd: the spire answers numbers with thunder
    if (hasP(np, 'WAR_DRUMS') && np.board.length > foe.board.length && np.board.length) { const w5 = weak(np.board); w5.atk += r; w5.hp += r; if (w5.maxhp) w5.maxhp += r; S.events.push({ t: 'passive', side: next, id: 'WAR_DRUMS', on: w5.id }); refreshPrim(S); } // Baorgang: the drums roll for the bigger line
    if (hasP(np, 'FERAL_HOWL') && np.board.length) { const w = weak(np.board); w.atk += 1 * r; S.events.push({ t: 'passive', side: next, id: 'FERAL_HOWL', on: w.id }); } // v0.25.0: +2 -> +1 ATK (Ossrath 89.2% hot in deep audit)
    if (hasP(np, 'MARCHING_ORDERS') && np.board.length) { const w = weak(np.board); w.atk += r; w.hp += r; S.events.push({ t: 'passive', side: next, id: 'MARCHING_ORDERS', on: w.id }); refreshPrim(S); }
    if (hasP(np, 'BLOCKADE') && foe.board.length - np.board.length >= 2 && np.board.length < MAX_BOARD) { np.board.push(token(np, S)); S.events.push({ t: 'passive', side: next, id: 'BLOCKADE' }); refreshPrim(S); } // v0.15.1 buff: 3 -> 2
    if (hasP(np, 'STANDARDS') && np.board.filter((m) => hasKw(m, 'Guard')).length >= 3 && np.deck.length) { S.events.push({ t: 'passive', side: next, id: 'STANDARDS' }); draw(S, next); }
    if (hasP(np, 'TARGETING_GRID') && np.hand.length >= 4 && foe.board.length) { const t = foe.board.slice().sort((a, b) => (b.atk + b.hp) - (a.atk + a.hp))[0]; S.events.push({ t: 'passive', side: next, id: 'TARGETING_GRID', on: t.id }); damageMinion(S, other(next), t.uid, 1 * r); }
    if (hasP(np, 'MOONLIGHT') && np.board.some((m) => hasKw(m, 'Lifesteal'))) { np.hp = Math.min(MAX_HP, np.hp + 3 * r); S.events.push({ t: 'passive', side: next, id: 'MOONLIGHT' }); } // v0.15.1 buff: 2 -> 3
    if (hasP(np, 'STILLNESS') && !np.tookHeroDmg) { np.hp = Math.min(MAX_HP, np.hp + 3 * r); S.events.push({ t: 'passive', side: next, id: 'STILLNESS' }); }
    np.tookHeroDmg = false; // v0.15: STILLNESS window reopens (after the check above)
    draw(S, next, true); // v0.15: draw-phase draw — sovereign draw hooks skip it
  }

  // ---------- end conditions ----------
  function checkEnd(S) {
    if (S.A.hp <= 0 && S.B.hp <= 0) return S.first === 'A' ? 'B' : 'A'; // simultaneous death: player who went second survives
    if (S.A.hp <= 0) return 'B';
    if (S.B.hp <= 0) return 'A';
    for (const side of ['A', 'B']) {
      const p = S[side];
      if (!p.deck.length && !p.hand.length && !p.board.length) return other(side); // exhausted
    }
    return null;
  }

  // ---------- v0.17 AI: perception — reading the board like a player ----------
  // threat(): the damage the foe can put on our hero next turn, and whether
  // lethal is on the table (their reach vs our HP + our Guard wall).
  function threat(S, side) {
    const p = S[side], foe = S[other(side)];
    const foeReach = foe.board.reduce((s, m) => s + m.atk * (hasKw(m, 'Relentless') ? 2 : 1), 0)
      + powerFaceDmg(S, other(side)) // v0.18: their Realm Command comes back around if it can reach us; // v0.26: ART_OF_WAR clause removed (passive rewritten as WAR_DRUMS, no hero damage)
    const guardHp = p.board.filter((m) => hasKw(m, 'Guard')).reduce((s, m) => s + m.hp, 0);
    return { foeReach, guardHp, danger: foeReach > 0 && foeReach >= p.hp + guardHp };
  }
  // burnInHand(): hero damage available in hand right now (for lethal reads)
  function burnInHand(S, side) {
    const p = S[side];
    let d = 0;
    p.hand.forEach((c, i) => {
      if (c.type !== 'edict' || !canPlay(S, side, i)) return;
      const ci = hasP(p, 'COURT_INTRIGUE') ? rites(S, side) : 0;
      if (c.fx === 'fxPillage') d += 2 + ci;
      if (c.fx === 'fxHero3') d += 3;
      if (c.fx === 'fxVolley' || c.fx === 'fxVolley2') { const k = p.board.filter((m) => hasKw(m, 'Ranged')).length; if (k) d += k * (c.fx === 'fxVolley' ? 1 : 2) + (ci ? k * ci : 0); }
    });
    return d;
  }
  // survivalBonus(): under a live lethal threat, defensive lines gain value —
  // the "do I play my Guard to not die?" read.
  function survivalBonus(S, side, c, th) {
    let b = 0;
    if (hasKw(c, 'Guard')) b += 2.5 + c.hp * 0.3;   // a wall buys a turn
    if (hasKw(c, 'Aegis')) b += 1.5;
    if (c.fx === 'fxHealHero4' || c.fx === 'fxHealHero6') b += 2;
    if (c.rl === 'rlBasilica' || c.rl === 'rlRampart' || c.rl === 'rlWard') b += 1.5;
    if (['fxPingAll', 'fxPingAll2', 'fxAoe2', 'fxAoe3', 'fxSnipe3', 'fxSnipe4', 'fxExecute', 'fxExecute2', 'fxSilence', 'fxTransform', 'fxScorchX'].includes(c.fx)) b += Math.min(2, th.foeReach * 0.4); // takes attackers off the table
    return b;
  }
  // deckPlan(): the AI knows its OWN decklist (order-agnostic, like a player)
  // and derives an archetype — aggro (Charge/burn), control (Guard/removal) —
  // plus live synergy carrier counts. Cached per side; deterministic.
  function deckPlan(S, side) {
    const p = S[side];
    if (p.plan) return p.plan;
    const pool = [...p.deck, ...p.hand, ...p.board, ...p.relics];
    let charge = 0, guard = 0, ranged = 0, burn = 0, removal = 0, tokens = 0;
    for (const c of pool) {
      if (hasKw(c, 'Charge')) charge++;
      if (hasKw(c, 'Guard')) guard++;
      if (hasKw(c, 'Ranged')) ranged++;
      if (['fxPillage', 'fxHero3', 'fxVolley', 'fxVolley2'].includes(c.fx)) burn++;
      if (['fxPingAll', 'fxPingAll2', 'fxAoe2', 'fxAoe3', 'fxSnipe3', 'fxSnipe4', 'fxExecute', 'fxExecute2', 'fxSilence', 'fxTransform', 'fxScorchX'].includes(c.fx)) removal++;
      if (['fxRally', 'fxRally3', 'fxLevy', 'fxDecreeMuster'].includes(c.fx)) tokens++;
    }
    p.plan = { aggro: (charge + burn) >= 6, control: (guard + removal) >= 8, guard, ranged, tokens };
    return p.plan;
  }

  // ---------- v0.18 AI: the spy — public information, read like a player ----------
  // Everything a human spectator at the table knows: both sovereigns'
  // passives (they're on the table from turn one), the foe's hand SIZE, what
  // they've PLAYED (the public event log is the play-by-play every player
  // watches), and the copy rules (2x common/rare, 1x epic — "they already
  // played their one epic sweep, the board is safe now"). The doctrine decks
  // are the known meta: a sharp player assumes the netdeck until proven
  // otherwise, and counts answers as they're spent.
  function seenPlays(S, side) {
    const m = {};
    for (const e of S.events) {
      if (e.side !== side) continue;
      if (e.t !== 'edict' && e.t !== 'relic' && e.t !== 'play') continue;
      if (e.id === 'TOKEN' || e.id === 'ECHO' || (e.id || '').startsWith('ECHO@')) continue;
      m[e.id] = (m[e.id] || 0) + 1;
    }
    return m;
  }
  // spyRead(): the answer count. Sweep/removal/burn/heal their list CAN still
  // hold = deck copies minus what the log shows them play. Deterministic —
  // same visible game, same read.
  function spyRead(S, side) {
    const foeSide = other(side), foe = S[foeSide];
    const seen = seenPlays(S, foeSide);
    const pool = (foe.fac && foe.fac.cards) || [];
    const byId = new Map(pool.map((c) => [c.id, c]));
    const list = (foe.fac && foe.fac.defaultDeck && foe.fac.defaultDeck.length)
      ? foe.fac.defaultDeck : pool.map((c) => c.id);
    const cnt = {}; for (const id of list) cnt[id] = (cnt[id] || 0) + 1;
    let sweep = 0, removal = 0, burn = 0, heal = 0;
    for (const id of Object.keys(cnt)) {
      const c = byId.get(id); if (!c) continue;
      const cap = (c.rarity === 'epic' || c.rarity === 'legendary') ? 1 : 2;
      const left = Math.max(0, Math.min(cnt[id], cap) - (seen[id] || 0));
      if (!left) continue;
      if (['fxPingAll', 'fxPingAll2', 'fxAoe2', 'fxAoe3'].includes(c.fx)) sweep += left;
      else if (['fxSnipe3', 'fxSnipe4', 'fxExecute', 'fxExecute2', 'fxSilence', 'fxTransform', 'fxScorchX'].includes(c.fx)) removal += left;
      else if (['fxPillage', 'fxHero3', 'fxVolley', 'fxVolley2'].includes(c.fx)) burn += left;
      else if (['fxHealHero4', 'fxHealHero6'].includes(c.fx)) heal += left;
    }
    return {
      sweep, removal, burn, heal,
      foeHand: foe.hand.length,
      handEmpty: foe.hand.length === 0,
      handBig: foe.hand.length >= 5,
      foeDeck: foe.deck.length,
      foeFatigue: !foe.deck.length,
      foeScorched: hasP(foe, 'SCORCHED_EARTH'),
    };
  }
  // sovSynergy(): play INTO your own sovereign — the passive is why you picked
  // this leader; draft your lines toward its conditions.
  function sovSynergy(S, side, c) {
    let v = 0; const p = S[side], foe = S[other(side)];
    const drawish = c.fx && ['fxDraw2', 'fxDraw3', 'fxScry2', 'fxScry3', 'fxDecreeDraw', 'fxEspionage', 'fxLawTariff', 'fxDeliberate'].includes(c.fx);
    const sweepFx = c.fx && ['fxPingAll', 'fxPingAll2', 'fxAoe2', 'fxAoe3'].includes(c.fx);
    const burnFx = c.fx && ['fxPillage', 'fxHero3', 'fxVolley', 'fxVolley2'].includes(c.fx);
    if (hasP(p, 'WEAVE') && sweepFx) v += 0.5;                 // rites amplify every sweep
    if (hasP(p, 'COURT_INTRIGUE') && burnFx) v += 0.3;         // rites amplify the burn
    if (hasP(p, 'STANDARDS') && hasKw(c, 'Guard')) v += p.board.filter((m) => hasKw(m, 'Guard')).length < 3 ? 0.4 : 0.3; // 3 Guards = the draw engine
    else if ((hasP(p, 'BULWARK') || hasP(p, 'TESTUDO') || hasP(p, 'STONE_REMEMBERS') || hasP(p, 'VEILED_COURT') || hasP(p, 'THORN_GUARD') || hasP(p, 'VANGUARD')) && hasKw(c, 'Guard')) v += 0.3;
    if (hasP(p, 'MOONLIGHT') && hasKw(c, 'Lifesteal')) v += 0.6; // the engine is live
    if (hasP(p, 'SOULTITHE') && hasKw(c, 'Lifesteal')) v += 0.4;
    if (hasP(p, 'ORIFLAMME') && hasKw(c, 'Charge')) v += 0.3;
    if (hasP(p, 'NIZARI') && hasKw(c, 'Charge')) v += 0.3;
    if (hasP(p, 'GHOST_STEP') && c.type === 'minion') v += 0.2; // v0.26: the veiled first servant
    if (hasP(p, 'SIEGECRAFT') && hasKw(c, 'Ranged')) v += 0.3; // v0.26: aimed volleys reach the Sovereign
    if (hasP(p, 'STRAFING') && hasKw(c, 'Ranged')) v += 0.3;
    if (hasP(p, 'PICKET') && c.type === 'minion' && c.cost <= 2) v += 0.25;
    if (hasP(p, 'BARRICADE') && c.type === 'minion' && c.cost <= 2) v += 0.25; // v0.26
    if (hasP(p, 'BAZAAR') && c.type === 'edict') v += 0.25;
    if (hasP(p, 'STRATAGEM') && c.type === 'edict') v += 0.25; // v0.26
    if (hasP(p, 'COURT_WHISPERS') && c.type === 'edict') v += 0.2; // v0.26: decree density pays
    if (hasP(p, 'TARGETING_GRID') && drawish && p.hand.length <= 4) v += 0.5; // fuel the grid
    if ((hasP(p, 'PRIVATEERING') || hasP(p, 'CHAOS_LADDER')) && drawish) v += 0.3;
    if (hasP(p, 'BLOCKADE') && c.type === 'minion' && p.board.length + 2 <= foe.board.length) v += 0.2;
    if (hasP(p, 'WARD_SMITH') && c.type === 'relic') v += 0.3; // v0.26
    if (hasP(p, 'DIWAN') && c.type === 'relic') v += 0.3; // v0.26
    if (hasP(p, 'PACK_HUNTER') && c.tribe) v += 0.25; // v0.26: kin feed the pack
    if (hasP(p, 'DEN_GUARD') && c.tribe === 'Beasts') v += 0.25; // v0.26
    if (hasP(p, 'PRIDE_OF_THE_PACK') && c.tribe === 'Beasts') v += 0.2; // v0.26
    if (hasP(p, 'ELDER_COUNCIL') && c.tribe) v += 0.2; // v0.26: elders count kin
    if (hasP(p, 'TITAN_PLATING') && c.tribe === 'Constructs') v += 0.25; // v0.26
    if (hasP(p, 'AMBUSH') && hasKw(c, 'Charge')) v += 0.3; // v0.26
    if (hasP(p, 'GRAVE_CHARGE') && hasKw(c, 'Charge')) v += 0.25; // v0.26
    if (hasP(p, 'IRON_FIST') && c.type === 'minion' && c.atk <= 2) v += 0.25; // v0.26
    if (hasP(p, 'PYROMANCER') && sweepFx) v += 0.4; // v0.32.1 rework: Suleiman — every sweep burns hotter
    if (hasP(p, 'SCORCHED_VICTORY') && sweepFx) v += 0.3; // v0.32.1 rework: Cynisca — killing decrees feed the pyre
    if (hasP(p, 'RESONANCE') && sweepFx) v += 0.4; // v0.26: the spire rings
    if (hasP(p, 'DEEP_RITES') && c.cost >= 5) v += 0.3; // v0.26: the deep crown the mighty
    if (hasP(p, 'SOLAR_FLARE') && hasKw(c, 'Ranged')) v += 0.2; // v0.26
    if (hasP(p, 'ENDLESS_MARCH') && hasKw(c, 'Relentless')) v += 0.25; // v0.26
    return v;
  }
  // spyAdjust(): play AROUND their answers — the counting-cards layer.
  function spyAdjust(S, side, c, spy) {
    let v = 0; const p = S[side];
    // a "wide" line floods the board: cheap minions or the token rituals
    const wide = (c.type === 'minion' && c.cost <= 2) || (c.fx && ['fxRally', 'fxRally3', 'fxLevy', 'fxDecreeMuster', 'fxLawMuster'].includes(c.fx));
    if (spy.handBig && spy.sweep > 0 && wide) v -= 0.3;          // they're holding clears — don't overcommit
    if (spy.sweep === 0 && wide) v += 0.3;                        // their clears are spent — the board is safe
    if (spy.removal === 0 && c.type === 'minion' && c.atk + c.hp >= 10) v += 0.4; // no Execute left: big bodies are free
    if (spy.burn === 0 && spy.heal === 0 && c.fx === 'fxPillage') v += 0.2;       // no outs: close the door
    if (spy.handEmpty && (hasKw(c, 'Charge') || (c.fx && ['fxPillage', 'fxHero3'].includes(c.fx)))) v += 0.4; // topdeck town: all-in
    if (spy.foeFatigue && p.deck.length > 0 && (hasKw(c, 'Guard') || (c.fx && ['fxHealHero4', 'fxHealHero6'].includes(c.fx)))) v += 0.3; // they're decking: walls win the race
    return v;
  }

  // ---------- AI brains ----------
  // EASY — a careless levy: reasonable tempo but sloppy aim, occasionally
  // fumbles its best play, picks attack targets on a whim, and half the time
  // forgets Skirmish exists.
  function aiEasy(S, side, snap) {
    const foeSide = other(side);
    const me = S[side], foe = S[foeSide];
    // v0.9.6: snap(S) fires after each visible action when the UI animates the
    // AI's turn; sims never pass it, so behavior is unchanged.
    const pc = (i) => { playCard(S, side, i, { target: aiTarget(S, side, S[side].hand[i]) }); if (snap) snap(S); }; // v0.20 A6: the AI aims
    const pw = (t) => { power(S, side, t); if (snap) snap(S); };
    const atk = (u, t) => { attack(S, side, u, t); if (snap) snap(S); };

    // usually plays greedy like anyone would, but sometimes grabs the cheapest
    // card instead of the best one
    const fumble = S.rng() < 0.25;
    let bi = -1;
    me.hand.forEach((c, i) => {
      if (!canPlay(S, side, i)) return;
      if (bi < 0) { bi = i; return; }
      const a = effCost(S, side, c), b = effCost(S, side, me.hand[bi]);
      if (fumble ? a < b : a > b) bi = i;
    });
    if (bi >= 0) pc(bi);

    // hero power (v0.33 REALM COMMANDS): remembers it exists about half the time
    if (canPower(S, side) && S.rng() > 0.5) {
      const t = aiPowerPlan(S, side);
      if (t) pw(t);
    }

    // attacks: aims face more often than it should, trades at random otherwise
    const legalTargets = () => {
      const guards = guardsOn(foe); // v0.29.0: shadowed guards do not pull attacks
      if (guards.length) return guards.map((g) => ({ uid: g.uid }));
      if (S.rng() < 0.65 || !foe.board.length) return [{ hero: true }];
      const opts = foe.board.filter((t) => !shadowed(t)).map((t) => ({ uid: t.uid })); // v0.29.0: never aim at a shadowed body
      if (!opts.length) return [{ hero: true }]; // v0.32.1 fix: an all-Shadow board still offers the face
      return [opts[Math.floor(S.rng() * opts.length)]];
    };
    me.board.slice().forEach((m) => {
      if (!me.board.find((x) => x.uid === m.uid) || !m.ready) return; // died mid-loop
      const opts = legalTargets();
      const pick = opts[Math.floor(S.rng() * opts.length)];
      atk(m.uid, pick);
    });
  }

  // NORMAL v0.17 — a decent player: reads lethal, respects threats, and holds
  // situational cards for a better moment instead of vomiting the curve.
  function aiNormal(S, side, snap) {
    const foeSide = other(side);
    const me = S[side], foe = S[foeSide];
    const pc = (i) => { playCard(S, side, i, { target: aiTarget(S, side, S[side].hand[i]) }); if (snap) snap(S); }; // v0.20 A6: the AI aims
    const pw = (t) => { power(S, side, t); if (snap) snap(S); };
    const atk = (u, t) => { attack(S, side, u, t); if (snap) snap(S); };

    const th = threat(S, side);
    const spy = spyRead(S, side); // v0.18: count their outs
    const pd0 = canPower(S, side) ? powerFaceDmg(S, side) : 0;
    const readyAtk0 = me.board.filter((m) => m.ready).reduce((s, m) => s + m.atk, 0);
    const lethal = !guardsOn(foe).length && foe.hp <= readyAtk0 + pd0 + burnInHand(S, side);

    // v0.17 plays: contextual value with a hold threshold — no AOE into thin
    // boards, no buffs with no carriers; Guards/removal jump the queue under fire.
    let played = true;
    while (played) {
      played = false;
      let bi = -1, bv = 0;
      // v0.17.1: the danger tax only applies when a defensive line EXISTS in hand —
      // with no way to survive, keep playing offense.
      const hasDef = th.danger && me.hand.some((c, i) => { try { return canPlay(S, side, i) && survivalBonus(S, side, c, th) > 0; } catch (e) { return false; } });
      me.hand.forEach((c, i) => {
        if (!canPlay(S, side, i)) return;
        let nv = evScore(S, side, c) - effCost(S, side, c) * 0.2;
        nv += sovSynergy(S, side, c) + spyAdjust(S, side, c, spy); // v0.18: leader lines + counting their outs
        // v0.17.1: under lethal threat, defensive lines are DOUBLED and
        // non-defensive lines are taxed — "don't die" beats "big body".
        const sb = survivalBonus(S, side, c, th);
        if (th.danger) nv += sb * 2 - (sb ? 0 : (hasDef ? 2 : 0));
        if (nv > bv) { bv = nv; bi = i; }
      });
      // v0.17.1: anti-stall — after turn 40, stop holding situational cards
      const holdN = S.turn > 40 ? 0.1 : 1.0;
      if (bi >= 0 && bv >= holdN) { pc(bi); played = true; }
    }

    // hero power (v0.33): lethal first, then the realm oracle's plan
    if (canPower(S, side)) {
      const c = realmCmd(S, side);
      if (lethal && c && c.kind === 'dmg' && c.tset !== 'foeMinion') pw({ hero: true });
      else { const t = aiPowerPlan(S, side); if (t) pw(t); }
    }

    // attacks
    const guard = () => guardsOn(foe).length > 0; // v0.29.0: shadowed guards do not pull attacks
    // v0.18: against Scorched Earth, going face sweeps our own 1-HP board —
    // a player checks their leader before swinging
    const scorchCautious = spy.foeScorched && me.board.filter((m) => m.hp === 1).length >= 3 && foe.hp > 15 && !lethal;
    const sweep = () => me.board.slice().forEach((m) => {
      if (!me.board.find((x) => x.uid === m.uid) || !m.ready) return; // died mid-loop
      if (!foe.board.length && !guard() && !m.shocked && !scorchCautious) { atk(m.uid, { hero: true }); return; }
      if (foe.hp <= m.atk && !guard() && !m.shocked) { atk(m.uid, { hero: true }); return; }
      // favorable trades: kill something without dying (or dying to something smaller than us)
      const opts = foe.board.filter((t) => !shadowed(t) &&
        t.hp <= m.atk && (hasKw(m, 'Ranged') || m.hp > t.atk || t.atk < m.atk));
      if (opts.length) {
        const t = opts.sort((a, b) => b.atk - a.atk)[0];
        atk(m.uid, { uid: t.uid });
        return;
      }
      if (!guard() && !m.shocked && !scorchCautious) { atk(m.uid, { hero: true }); return; }
      // v0.6.4: never pass forever into a Guard wall — kill one if possible,
      // otherwise chip the weakest Guard (the old pass-only behavior stalled
      // 12-14% of games at the turn cap).
      const gs2 = guardsOn(foe);
      if (gs2.length) {
        const kill = gs2.filter((t) => t.hp <= m.atk).sort((a, b) => b.atk - a.atk)[0];
        const chip = kill || gs2.slice().sort((a, b) => a.hp - b.hp)[0];
        atk(m.uid, { uid: chip.uid });
      }
    });
    sweep();
    // v0.11: Relentless's second swing. Gated so failed attackers in the old
    // pool never get a retry the original single pass didn't give them.
    if (me.board.some((m) => hasKw(m, 'Relentless') && m.ready)) sweep();
  }

  // HARD — a veteran marshal: plays greedy, reads lethal before anything else,
  // trades for maximum value (survives when it can, kills threats when it must),
  // and spends Skirmish to remove the biggest thing it can kill.
  // v0.17 PLAY EVALUATOR: CONTEXTUAL — every template is priced by what it can
  // actually accomplish against THIS board right now. Sweeps are worth their
  // kills, removal is worth its target, buffs need live carriers. (The v0.12
  // templates previously fell through to default=1 and were never played at all
  // — the clearest "the AI doesn't understand its cards" bug in the old engine.)
  function evScore(S, side, c) {
    const p = S[side], foe = S[other(side)];
    const th = threat(S, side);
    if (c.type === 'edict') {
      const wv = hasP(p, 'WEAVE') ? rites(S, side) : 0;
      const pv = hasP(p, 'PYROMANCER') ? rites(S, side) : 0; // v0.32.1: Suleiman's sweeps burn hotter
      const kills = (d) => foe.board.reduce((s2, t) => s2 + (t.hp <= d ? (t.atk + t.hp) * 1.25 : d * 0.5), 0);
      const top = (cmp) => foe.board.slice().sort(cmp)[0];
      switch (c.fx) {
        case 'fxDraw2': return 2.6 + (p.hand.length <= 2 ? 1.2 : 0);
        case 'fxDraw3': return 3.1 + (p.hand.length <= 3 ? 1.0 : 0) - (p.hand.length >= 7 ? 1.2 : 0);
        case 'fxPingAll': return kills(1 + wv + pv);
        case 'fxPingAll2': return kills(2 + wv + pv);
        case 'fxAoe2': return kills(2 + wv + pv);
        case 'fxAoe3': return kills(3 + wv + pv) - 1;
        case 'fxSnipe3': { const t = top((a, b) => (b.atk + b.hp) - (a.atk + a.hp)); return t ? (t.hp <= 3 ? (t.atk + t.hp) * 1.3 : 3.6) : 0; }
        case 'fxSnipe4': { const t = top((a, b) => (b.atk + b.hp) - (a.atk + a.hp)); return t ? (t.hp <= 4 ? (t.atk + t.hp) * 1.3 : 3.4) : 0; }
        case 'fxExecute': { const t = top((a, b) => b.atk - a.atk); return t ? (t.atk + t.hp) * 1.45 : 0; }
        case 'fxExecute2': { return foe.board.slice().sort((a, b) => b.atk - a.atk).slice(0, 2).reduce((s2, t) => s2 + (t.atk + t.hp) * 1.3, 0); }
        case 'fxHealHero4': return Math.min(4, MAX_HP - p.hp) * 0.55 + (th.danger ? 1.5 : 0);
        case 'fxHealHero6': return Math.min(6, MAX_HP - p.hp) * 0.55 + (th.danger ? 1.5 : 0);
        case 'fxMana2': return p.hand.length > 2 ? 2.2 : 0.8;
        case 'fxMana3': return p.hand.length > 2 ? 3.0 : 1.0;
        case 'fxRally': return (p.board.length <= MAX_BOARD - 2) ? 3.4 : 0.8;
        case 'fxRally3': { const nn = Math.min(3, MAX_BOARD - p.board.length); return nn * 1.7; }
        case 'fxRallyBoard': return p.board.reduce((s2, m) => s2 + 2, 0) * 0.95 + (p.board.length >= 3 ? 1 : 0);
        case 'fxVolley': { const k = p.board.filter((m) => hasKw(m, 'Ranged')).length; const d = k * (1 + (hasP(p, 'COURT_INTRIGUE') ? rites(S, side) : 0)); return d > 0 ? d * 1.35 : 0.2; }
        case 'fxVolley2': { const k = p.board.filter((m) => hasKw(m, 'Ranged')).length; const d = k * (2 + (hasP(p, 'COURT_INTRIGUE') ? rites(S, side) : 0)); return d > 0 ? d * 1.3 : 0.2; }
        case 'fxMomentum': { const k = p.board.filter((m) => hasKw(m, 'Charge')).length; return k ? k * 1.6 : -0.5; }
        case 'fxFormation': { const k = p.board.filter((m) => hasKw(m, 'Guard')).length; return k ? k * 1.9 + (th.danger ? 0.8 : 0) : -0.5; }
        case 'fxLevy': return p.board.filter((m) => m.id.startsWith('TOKEN@')).length * 2.1 + 1.5 + (p.board.length < MAX_BOARD ? 0.4 : 0);
        case 'fxPillage': return 2.8 + (p.board.length > foe.board.length ? 1.6 : 0) + (foe.hp <= 6 ? 2.5 : 0);
        case 'fxHero3': return 3 * (foe.hp <= 4 ? 2 : 1);
        // v0.16 templates, contextually priced
        case 'fxLawTariff': return 1.4 + foe.hand.length * 0.35 + (S.turn <= 4 ? 0.5 : 0);
        case 'fxLawMuster': return 1.2 + Math.min(3, MAX_BOARD - p.board.length) * 0.9;
        case 'fxDecreeMuster': return 2.2 + (p.board.length < 3 ? 0.6 : 0);
        case 'fxDecreeDraw': return 2.4 + (p.hand.length <= 3 ? 0.6 : 0);
        case 'fxDecreeMana': return 2.1;
        case 'fxScry2': return 2.2 + (p.hand.length <= 2 ? 0.6 : 0);
        case 'fxScry3': return 2.5 + (p.hand.length <= 3 ? 0.6 : 0);
        case 'fxEspionage': return 2.0 + (foe.hand.length >= 4 ? 1.2 : 0);
        // v0.21 P8
        case 'fxSilence': { const t = foe.board.slice().sort((a, b) => ((b.kw ? 1 : 0) - (a.kw ? 1 : 0)) || ((b.atk + b.hp) - (a.atk + a.hp)))[0]; return t ? (t.kw ? (t.atk + t.hp) * 0.95 : 0.3) : 0; }
        case 'fxTransform': { const t = top((a, b) => (b.atk + b.hp) - (a.atk + a.hp)); return t ? (t.atk + t.hp) * 1.05 - 2 : 0; }
        case 'fxDeliberate': return 2.5 + (p.hand.length <= 2 ? 0.8 : 0);
        case 'fxScorchX': { const d = p.mana; return d > 0 ? kills(d) : 0; }
        // v0.23 T2: tribal edicts — value scales with kin on the field
        case 'fxTribeMuster': return 1.0 + Math.min(3, countTribe(p.board, c.tribe)) * 1.6 + (p.board.length < MAX_BOARD - 2 ? 0.4 : 0);
        case 'fxTribeWarCry': { const k = countTribe(p.board, c.tribe); return k ? k * 2.2 : -0.5; }
        case 'fxTribeLaw': { const k = countTribe(p.board, c.tribe); return k ? 1.2 + k * 0.8 + (th.danger ? 0.6 : 0) : 0.3; }
        default: return 1;
      }
    }
    if (c.type === 'relic') {
      const g = p.board.filter((m) => hasKw(m, 'Guard')).length;
      const r = p.board.filter((m) => hasKw(m, 'Ranged')).length;
      switch (c.rl) {
        case 'rlLibrary': return 2.3;
        case 'rlStandards': return 1.2 + g * 1.4;
        case 'rlGranary': return 1.9;
        case 'rlNullify': return 1.6 + (th.danger ? 0.4 : 0); // v0.21 P8: counters burn edicts
        case 'rlTribeStandard': return 1.2 + countTribe(p.board, c.tribe) * 0.9; // v0.23: scales with kin fielded
        case 'rlDrillyard': return 1.8;
        case 'rlForage': return 2.0;
        case 'rlLookout': return 1.2 + r * 1.3;
        // v0.16 relics, contextually priced
        case 'rlFlame': return 1.9;
        case 'rlTent': return 1.7;
        case 'rlRampart': return 1.0 + g * 0.4;
        case 'rlWard': return 1.5 + (p.hp <= 15 ? 0.6 : 0);
        case 'rlHearth': return 1.5;
        case 'rlMusketeers': return 1.1 + r * 0.35;
        case 'rlCistern': return 1.6;
        case 'rlCuria': return 1.6;
        case 'rlWarStandard': return 1.5;
        case 'rlQuill': return 1.7;
        case 'rlMoonwell': return 1.5;
        case 'rlTrophy': return 1.5;
        case 'rlBasilica': return 1.0 + g * 0.4 + (th.danger ? 1.0 : 0);
        case 'rlReliquary': return 1.9;
        case 'rlBanner': return 1.4;
        case 'rlVault': return 1.8;
        case 'rlMirror': return 1.7;
        case 'rlAmulet': return 1.3 + p.hand.filter((c2) => c2.type === 'edict').length * 0.25;
        case 'rlIdol': return 1.5;
        case 'rlDrum': return 1.5;
        case 'rlScales': return 1.6;
        case 'rlSatrap': return 1.5;
        case 'rlDebt': return 1.4;
        default: return 1.5;
      }
    }
    // minion: tempo + keyword + ability value
    let v = c.atk + c.hp;
    if (hasKw(c, 'Guard')) v += 1.2;
    else if (hasKw(c, 'Charge')) v += 1.8;
    else if (hasKw(c, 'Ranged')) v += 1.2;
    else if (hasKw(c, 'Lifesteal')) v += 1.0;
    else if (hasKw(c, 'Shock')) v += 1.4;       // v0.11: pseudo-charge, hero locked out
    else if (hasKw(c, 'Aegis')) v += 1.5;       // v0.11: negates one damage instance
    else if (hasKw(c, 'Bane')) v += 1.6;        // v0.11: destroys anything it touches
    else if (hasKw(c, 'Relentless')) v += 1.8;  // v0.11: two swings a turn
    if (c.bc === 'bcDraw') v += 1.6;
    if (c.bc === 'bcPing') v += 0.4 + foe.board.length * 0.4;
    if (c.bc === 'bcPing2') v += 0.8 + foe.board.length * 0.7;
    if (c.bc === 'bcPing3') v += 1.2 + foe.board.length * 0.9;
    if (c.bc === 'bcAoe1') v += foe.board.reduce((s2, t) => s2 + (t.hp <= 1 ? (t.atk + t.hp) * 1.1 : 1.1), 0);
    if (c.bc === 'bcAoeAll1') v += (foe.board.reduce((s2, t) => s2 + (t.hp <= 1 ? (t.atk + t.hp) * 1.1 : 1.1), 0) - p.board.length * 1.0);
    if (c.bc === 'bcHero2') v += 1.2;
    if (c.bc === 'bcHeal2') v += Math.min(2, MAX_HP - p.hp) * 0.5;
    if (c.bc === 'bcSummon') v += 1.7;
    if (c.bc === 'bcBuff') v += p.board.length * 1.1;
    if (c.bc === 'bcTribeBanner') v += countTribe(p.board, c.tribe) * 1.9; // v0.23: kin-matters banner
    if (c.bc === 'bcTribeDraw') v += (countTribe(p.board, c.tribe) > 1 ? 2.0 : 0); // v0.23: needs a kinsman on the field
    // v0.27.0 primitives: price auras/triggers/enrage/perm by what they accomplish on THIS board
    if (c.aura === 'auraTribe') v += countTribe(p.board, c.tribe) * 1.5 + 0.8;
    if (c.aura === 'auraGuard') v += p.board.filter((m) => hasKw(m, 'Guard')).length * 1.2 + 0.6;
    if (c.aura === 'auraAll') v += p.board.length * 1.0 + 0.6;
    if (c.rage) v += (RAGE_SPECS[c.rage] || 0) * 0.6;
    if (c.t0) v += ({ ttPing: 0.8, ttHeal: 0.5, ttDraw: 1.4, ttSummon: 1.2 }[c.tt] || 1.0);
    if (c.bc === 'bcPerm') v += p.board.length * 1.1;
    // v0.29.0 PRIMITIVES II: price Shadow by its guaranteed setup turn, and the
    // new triggers by what they accomplish in context
    if (hasKw(c, 'Shadow')) v += 0.5; // one guaranteed turn of setup, premium on utility bodies
    if (c.ih) v += p.hand.filter((h) => h !== c && h.tribe === c.ih.tribe).length ? 0.4 : 0;
    if (c.onDraw) v += ({ odDraw: 1.4, odPing: 0.7, odHeal: 0.4 }[c.onDraw] || 0.5);
    if (c.onSpell) v += ({ spPing: 0.9, spGrow: 0.7 }[c.onSpell] || 0.5);
    // v0.12: deathrattle value scales with magnitude (dr quality mattered in the audit)
    // v0.12: every v0.11 dr template keeps its exact old score (flat 0.9);
    // only the NEW magnitude templates scale — old data must play identically
    const drVal = { drPing2: 1.7, drPing3: 2.5, drAoe1: 1.0 + foe.board.length * 0.9,
      drAoe2: 1.6 + foe.board.length * 1.5, drAoeAll1: 0.6 + (foe.board.length - p.board.length) * 0.9,
      drHero2: 1.7 }[c.dr];
    if (c.dr) v += (drVal !== undefined ? drVal : 0.9);
    if (c.rarity === 'legendary') v += 1.2;
    return v;
  }

  const p2manaOK = (S, side, i) => { try { return canPlay(S, side, i); } catch (e) { return false; } };

  function aiHard(S, side, snap) {
    const foeSide = other(side);
    const me = S[side], foe = S[foeSide];
    const pc = (i) => { playCard(S, side, i, { target: aiTarget(S, side, S[side].hand[i]) }); if (snap) snap(S); }; // v0.20 A6: the AI aims
    const pw = (t) => { power(S, side, t); if (snap) snap(S); };
    const atk = (u, t) => { attack(S, side, u, t); if (snap) snap(S); };

    const plan = deckPlan(S, side); // v0.17: the marshal knows what deck he's piloting
    const th = threat(S, side);      // v0.17: and whether lethal is coming back at him
    const spy = spyRead(S, side);    // v0.18: and counts their remaining outs like a sharp

    // THE PLAY EVALUATOR: score every affordable card in context; play the best
    // EV above a hold threshold, repeat while plays remain worthwhile.
    let played = true;
    while (played) {
      played = false;
      let bi = -1, bv = 0;
      // v0.17.1: the danger tax only applies when a defensive line EXISTS in hand —
      // with no way to survive, keep playing offense.
      const hasDef = th.danger && me.hand.some((c, i) => { try { return canPlay(S, side, i) && survivalBonus(S, side, c, th) > 0; } catch (e) { return false; } });
      me.hand.forEach((c, i) => {
        if (!canPlay(S, side, i)) return;
        let v = evScore(S, side, c) - effCost(S, side, c) * 0.2;
        v += sovSynergy(S, side, c) + spyAdjust(S, side, c, spy); // v0.18: leader lines + counting their outs
        // v0.17: plan-weighted lines — aggro decks push face damage and Charges,
        // control decks prize removal and walls; under lethal threat, survive first.
        if (plan.aggro && (c.fx === 'fxPillage' || c.fx === 'fxHero3' || c.fx === 'fxVolley' || c.fx === 'fxVolley2' || hasKw(c, 'Charge'))) v += 0.4;
        if (plan.control && (hasKw(c, 'Guard') || ['fxExecute', 'fxExecute2', 'fxSnipe3', 'fxSnipe4', 'fxPingAll', 'fxPingAll2', 'fxAoe2', 'fxAoe3', 'fxSilence', 'fxTransform', 'fxScorchX'].includes(c.fx))) v += 0.4;
        // v0.17.1: under lethal threat, defensive lines are DOUBLED and
        // non-defensive lines are taxed — "don't die" beats "big body".
        const sb = survivalBonus(S, side, c, th);
        if (th.danger) v += sb * 2 - (sb ? 0 : (hasDef ? 2 : 0));
        if (v > bv) { bv = v; bi = i; }
      });
      // v0.17.1: anti-stall — after turn 40, stop holding situational cards
      const holdH = S.turn > 40 ? 0.1 : 1.2;
      if (bi >= 0 && bv >= holdH) { pc(bi); played = true; }
    }

    // lethal check BEFORE acting: if the board can end it, everything goes face
    const guards = () => guardsOn(foe); // v0.29.0: shadowed guards do not pull attacks
    const readyAtk = me.board.filter((m) => m.ready).reduce((s, m) => s + m.atk, 0);
    const pd = canPower(S, side) ? powerFaceDmg(S, side) : 0;
    // spell lethal: the full burn read (pillage, hero-burn, both volleys) counts toward the kill
    const spellDmg = burnInHand(S, side); // v0.17: was volley/pillage only
    const lethal = !guards().length && foe.hp <= readyAtk + pd + spellDmg;

    // hero power (v0.33 REALM COMMANDS): on lethal a damage command goes face;
    // otherwise the shared oracle says what this realm's command does.
    if (canPower(S, side)) {
      const c = realmCmd(S, side);
      if (lethal && c && c.kind === 'dmg' && c.tset !== 'foeMinion') pw({ hero: true });
      else { const t = aiPowerPlan(S, side); if (t) pw(t); }
    }

    // attacks: biggest attackers decide first, so small minions clean up after them
    // v0.18: against Scorched Earth, going face sweeps our own 1-HP board
    const scorchCautious = spy.foeScorched && me.board.filter((m) => m.hp === 1).length >= 3 && foe.hp > 15 && !lethal;
    const sweep = () => me.board.slice().sort((a, b) => b.atk - a.atk).forEach((m) => {
      if (!me.board.find((x) => x.uid === m.uid) || !m.ready) return; // died mid-loop
      if (lethal && !guards().length && !m.shocked) { atk(m.uid, { hero: true }); return; }

      // value trades: prefer kills we survive; among them, kill the most valuable
      // v0.11: Bane's touch kills anything it can reach
      const kills = hasKw(m, 'Bane') ? foe.board.filter((t) => !shadowed(t)) : foe.board.filter((t) => !shadowed(t) && t.hp <= m.atk); // v0.29.0: never aim at a shadowed body
      const safe = kills.filter((t) => hasKw(m, 'Ranged') || hasKw(m, 'Bane') || m.hp > t.atk);
      const pool = safe.length ? safe : kills;
      if (pool.length) {
        const t = pool.slice().sort((a, b) => (b.atk + b.hp) - (a.atk + a.hp))[0];
        // don't suicide a big body into chaff unless it's a real threat
        const worthIt = safe.length || (t.atk + t.hp) * 2 >= m.atk + m.hp;
        if (worthIt) { atk(m.uid, { uid: t.uid }); return; }
      }

      const gs = guards();
      if (!gs.length) { if (!m.shocked && !scorchCautious) atk(m.uid, { hero: true }); return; }
      // must chew through a Guard: kill one if possible, otherwise bleed the weakest
      const killable = gs.filter((g) => g.hp <= m.atk).sort((a, b) => b.atk - a.atk)[0];
      const g = killable || gs.slice().sort((a, b) => a.hp - b.hp)[0];
      atk(m.uid, { uid: g.uid });
    });
    sweep();
    // v0.11: Relentless's second swing. Gated so failed attackers in the old
    // pool never get a retry the original single pass didn't give them.
    if (me.board.some((m) => hasKw(m, 'Relentless') && m.ready)) sweep();
  }


  // v0.25.2 "IMPOSSIBLE" — the RL rig's evolved brain (v2, full action surface).
  // ARCHITECTURE: residual learning on aiHard — every decision is
  // hardScore + W·features across FOUR heads: (1) play evaluation, (2) hold
  // threshold, (3) hero-power target, (4) attack targeting. The hard AI's own
  // choice is always first among candidates, so W=0 is decision-identical to
  // aiHard (seed-replay verified). RL_W below is the lineage-2 champion
  // (70.06% vs hard over 1,760 games, 0 stalls). Schema is tied to the
  // ENGINE, not cards — retrain via tools/rl/ after engine AI changes.
  // Feature order is CONTRACT (matches tools/rl/rl-brain.mjs FEATURES).
  const RL_W = [0.038050,-0.021650,-0.541914,0.633193,0.215587,-0.250032,0.618344,-0.533008,0.075421,-0.020180,-0.434405,-0.163405,0.263856,-0.154298,0.055658,0.388398,0.168472,0.344688,0.136545,-0.528336,-0.211848,0.010324,0.420618,0.769535,-0.225544,0.187853,0.368028,-0.249250,-0.817855,-0.128561,0.637978,0.122365,0.408497,0.222635,-0.186835,0.139695,0.149541,-0.401328,-0.077700,0.772726,0.114104,-0.318592,0.090911,0.269784,0.319702,-0.019415,-0.042221,-0.701111,0.204040,-0.121177,-0.084353,0.083054,0.064119,0.018681,0.262113,-0.358932];
  const RL_P_OFF = 0, RL_A_OFF = 31, RL_PW_OFF = 45, RL_H_OFF = 52;
  const rlDot = (off, f) => { let s = 0; for (let i = 0; i < f.length; i++) s += RL_W[off + i] * f[i]; return s; };

  function rlPlayFeatures(S, side, c, th, plan, spy, hardV) {
    const me = S[side], foe = S[other(side)];
    const ci = effCost(S, side, c);
    const ev = evScore(S, side, c);
    const aggroCard = c.fx === 'fxPillage' || c.fx === 'fxHero3' || c.fx === 'fxVolley' || c.fx === 'fxVolley2' || hasKw(c, 'Charge');
    const controlCard = hasKw(c, 'Guard') || ['fxExecute', 'fxExecute2', 'fxSnipe3', 'fxSnipe4', 'fxPingAll', 'fxPingAll2', 'fxAoe2', 'fxAoe3', 'fxSilence', 'fxTransform', 'fxScorchX'].includes(c.fx);
    return [
      ev, hardV, ci,
      sovSynergy(S, side, c), spyAdjust(S, side, c, spy),
      survivalBonus(S, side, c, th),
      (plan.aggro && aggroCard) ? 1 : 0,
      (plan.control && controlCard) ? 1 : 0,
      c.cost,
      S.turn > 40 ? 1 : 0,
      (me.hp - foe.hp) / 10,
      me.board.length - foe.board.length,
      me.hand.length, foe.hand.length,
      me.deck.length / 10, foe.deck.length / 10,
      me.relics.length,
      me.board.filter((m) => hasKw(m, 'Guard')).length,
      foe.board.filter((m) => hasKw(m, 'Guard')).length,
      c.type === 'minion' ? (c.atk + c.hp) : 0,
      hasKw(c, 'Charge') ? 1 : 0, hasKw(c, 'Guard') ? 1 : 0,
      hasKw(c, 'Ranged') ? 1 : 0, hasKw(c, 'Bane') ? 1 : 0,
      c.bc ? 1 : 0, c.dr ? 1 : 0,
      spy.sweep, spy.removal, spy.burn,
      th.danger ? 1 : 0,
      1,
    ];
  }

  function rlAtkFeatures(S, side, m, t) {
    const me = S[side], foe = S[other(side)];
    if (t === 'PASS') return [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const isFace = t === 'FACE';
    const tm = isFace ? { atk: 0, hp: foe.hp, kw: null } : t;
    return [
      1,
      isFace ? 1 : 0,
      m.atk / 5, m.hp / 5,
      (tm.atk || 0) / 5, (tm.hp || 0) / 5,
      (!isFace && tm.hp <= m.atk) ? 1 : 0,
      (!isFace && m.hp <= tm.atk) ? 1 : 0,
      (!isFace && hasKw(tm, 'Guard')) ? 1 : 0,
      hasKw(m, 'Ranged') ? 1 : 0,
      hasKw(m, 'Bane') ? 1 : 0,
      hasKw(m, 'Relentless') ? 1 : 0,
      foe.board.length / 5,
      me.hp <= 10 ? 1 : 0,
    ];
  }

  function rlPowFeatures(S, side, t, pd) {
    const foe = S[other(side)];
    const isFace = t === 'FACE';
    const isSkip = t === 'SKIP';
    const tm = (!isFace && !isSkip) ? t : { atk: 0, hp: 0 };
    return [
      1,
      isFace ? 1 : 0,
      isSkip ? 1 : 0,
      (tm.atk + tm.hp) / 5,
      pd,
      foe.hp <= pd + 2 ? 1 : 0,
      0, // lethal — filled by caller
    ];
  }

  // rlHardAttackChoice(): EXACTLY what aiHard's sweep does with minion m —
  // computed WITHOUT attacking, so the learned layer can override.
  function rlHardAttackChoice(S, side, m, foe, lethal, guards, scorchCautious) {
    if (lethal && !guards().length && !m.shocked) return { hero: true };
    const kills = hasKw(m, 'Bane') ? foe.board.slice() : foe.board.filter((t) => t.hp <= m.atk);
    const safe = kills.filter((t) => hasKw(m, 'Ranged') || hasKw(m, 'Bane') || m.hp > t.atk);
    const pool = safe.length ? safe : kills;
    if (pool.length) {
      const t = pool.slice().sort((a, b) => (b.atk + b.hp) - (a.atk + a.hp))[0];
      const worthIt = safe.length || (t.atk + t.hp) * 2 >= m.atk + m.hp;
      if (worthIt) return { uid: t.uid };
    }
    const gs = guards();
    if (!gs.length) { if (!m.shocked && !scorchCautious) return { hero: true }; return null; }
    const killable = gs.filter((g) => g.hp <= m.atk).sort((a, b) => b.atk - a.atk)[0];
    const g = killable || gs.slice().sort((a, b) => a.hp - b.hp)[0];
    return { uid: g.uid };
  }

  function aiImpossible(S, side, snap) {
    const foeSide = other(side);
    const me = S[side], foe = S[foeSide];
    const pc = (i) => { playCard(S, side, i, { target: aiTarget(S, side, S[side].hand[i]) }); if (snap) snap(S); };
    const pw = (t) => { power(S, side, t); if (snap) snap(S); };
    const atk = (u, t) => { attack(S, side, u, t); if (snap) snap(S); };

    const plan = deckPlan(S, side);
    const th = threat(S, side);
    const spy = spyRead(S, side);

    // HEAD 1 — play evaluator: hard heuristics + learned residual,
    // with the learned hold threshold (HEAD 4).
    let played = true;
    while (played) {
      played = false;
      let bi = -1, bv = 0;
      const hasDef = th.danger && me.hand.some((c, i) => { try { return canPlay(S, side, i) && survivalBonus(S, side, c, th) > 0; } catch (e) { return false; } });
      me.hand.forEach((c, i) => {
        if (!canPlay(S, side, i)) return;
        let v = evScore(S, side, c) - effCost(S, side, c) * 0.2;
        v += sovSynergy(S, side, c) + spyAdjust(S, side, c, spy);
        if (plan.aggro && (c.fx === 'fxPillage' || c.fx === 'fxHero3' || c.fx === 'fxVolley' || c.fx === 'fxVolley2' || hasKw(c, 'Charge'))) v += 0.4;
        if (plan.control && (hasKw(c, 'Guard') || ['fxExecute', 'fxExecute2', 'fxSnipe3', 'fxSnipe4', 'fxPingAll', 'fxPingAll2', 'fxAoe2', 'fxAoe3', 'fxSilence', 'fxTransform', 'fxScorchX'].includes(c.fx))) v += 0.4;
        const sb = survivalBonus(S, side, c, th);
        if (th.danger) v += sb * 2 - (sb ? 0 : (hasDef ? 2 : 0));
        const f = rlPlayFeatures(S, side, c, th, plan, spy, v);
        const total = v + rlDot(RL_P_OFF, f);
        if (total > bv) { bv = total; bi = i; }
      });
      const holdF = [1, S.turn / 10, me.hand.length, me.mana];
      const holdH = (S.turn > 40 ? 0.1 : 1.2) + rlDot(RL_H_OFF, holdF);
      if (bi >= 0 && bv >= holdH) { pc(bi); played = true; }
    }

    // lethal check BEFORE acting (verbatim)
    const guards = () => guardsOn(foe); // v0.29.0: shadowed guards do not pull attacks
    const readyAtk = me.board.filter((m) => m.ready).reduce((s, m) => s + m.atk, 0);
    const pd = canPower(S, side) ? powerFaceDmg(S, side) : 0;
    const spellDmg = burnInHand(S, side);
    const lethal = !guards().length && foe.hp <= readyAtk + pd + spellDmg;

    // HEAD 3 — hero power (v0.33 REALM COMMANDS): the shared oracle answers;
    // damage commands keep a learned candidate head (hard's choice, then the
    // field). Non-damage commands take the plan directly — W=0 ≡ hard.
    if (canPower(S, side)) {
      const c = realmCmd(S, side);
      if (lethal && c && c.kind === 'dmg' && c.tset !== 'foeMinion') pw({ hero: true });
      else if (c && (c.kind === 'dmg' || c.kind === 'raid')) {
        const fullPd = powerDmg(S, side);
        const tt = powerTargets(S, side);
        const pool = tt.minion === 'friend' ? me.board : foe.board; // what the command can aim at
        const hitDmg = c.kind === 'raid' ? c.dmg : fullPd; // raid's minion chip is not the face chip
        const killable = tt.minion ? pool.filter((m) => m.hp <= hitDmg) : [];
        const plan = aiPowerPlan(S, side);
        const cands = [];
        if (plan && plan.uid) { const h = killable.find((t) => t.uid === plan.uid) || pool.find((t) => t.uid === plan.uid); if (h) cands.push(h); } // hard's aim leads; W=0 takes it
        if (plan && plan.hero && tt.hero) cands.push('FACE');
        cands.push('SKIP'); // v0.33 W=0 contract: no plan means hard would NOT cast — SKIP leads so W=0 skips
        if (tt.hero && !(plan && plan.hero)) cands.push('FACE');
        cands.push(...killable);
        const uniq = cands.filter((x, i) => x !== undefined && cands.indexOf(x) === i);
        let best = null, bs = 0;
        for (const x of uniq) {
          const f = rlPowFeatures(S, side, x, fullPd);
          f[6] = lethal ? 1 : 0;
          const s = rlDot(RL_PW_OFF, f);
          if (!best || s > bs) { best = x; bs = s; }
        }
        if (best === 'FACE') pw({ hero: true });
        else if (best !== 'SKIP' && best) pw({ uid: best.uid });
      } else {
        const plan = aiPowerPlan(S, side);
        if (plan) pw(plan);
      }
    }

    // HEAD 2 — attacks: per minion, hard's target first among candidates,
    // learned scores override.
    const scorchCautious = spy.foeScorched && me.board.filter((m) => m.hp === 1).length >= 3 && foe.hp > 15 && !lethal;
    const sweep = () => me.board.slice().sort((a, b) => b.atk - a.atk).forEach((m) => {
      if (!me.board.find((x) => x.uid === m.uid) || !m.ready) return;
      const hc = rlHardAttackChoice(S, side, m, foe, lethal, guards, scorchCautious);
      const gs = guards();
      const hcCand = hc === null ? 'PASS' : (hc.hero ? 'FACE' : foe.board.find((x) => x.uid === hc.uid));
      const legal = gs.length ? gs.slice() : foe.board.filter((t) => !shadowed(t)); // v0.29.0: never aim at a shadowed body
      const cands = [hcCand, 'PASS', ...legal, ...(gs.length ? [] : (!m.shocked ? ['FACE'] : []))];
      const uniq = cands.filter((c, i) => c !== undefined && c !== null && cands.indexOf(c) === i);
      let best = null, bs = 0;
      for (const c of uniq) {
        const s = rlDot(RL_A_OFF, rlAtkFeatures(S, side, m, c));
        if (!best || s > bs) { best = c; bs = s; }
      }
      if (best === 'PASS' || best == null) return;
      if (best === 'FACE') atk(m.uid, { hero: true });
      else atk(m.uid, { uid: best.uid });
    });
    sweep();
    if (me.board.some((m) => hasKw(m, 'Relentless') && m.ready)) sweep();
  }

  // dispatch: aiTurn(S, side, level, onAction) — level falls back to the side's declared
  // difficulty (S.aiA/S.aiB from startMatch opts), then to 'normal'.
  // v0.9.6: optional onAction(state) fires after every visible AI action
  // (play / power / attack) so the UI can animate the enemy turn step by
  // step; the sim harness passes nothing, so sim behavior is byte-identical.
  function aiTurn(S, side, level, onAction) {
    const brain = AI_LEVELS.includes(level) ? level
      : (side === 'A' ? S.aiA : S.aiB) || 'normal';
    if (brain === 'easy') return aiEasy(S, side, onAction);
    if (brain === 'hard') return aiHard(S, side, onAction);
    if (brain === 'impossible') return aiImpossible(S, side, onAction);
    return aiNormal(S, side, onAction);
  }

  return {
    MAX_BOARD, MAX_HAND, MAX_HP, MAX_MANA, MAX_RELICS, AI_LEVELS,
    KWTXT, KWDESC, hasP, powerDmg, powerFaceDmg, powerCost, effCost,
    powerName, powerText, powerKind, powerTargets, aiPowerPlan, realmCmd, // v0.33 REALM COMMANDS — the UI and the RL brain read the table through these
    other, startMatch, draw,
    canPlay, playCard, canAttack, attack, canPower, power, endTurn, checkEnd, aiTurn,
    threat, spyRead, seenPlays, sovSynergy, spyAdjust, deckPlan,
    hasKw, kwsOf, // v0.20: multi-keyword helpers exported for tests (inert in browser)
    shadowed, guardsOn, // v0.29.0: Shadow helpers exported for the RL brain's engine-replica blocks (inert in browser)
    tribeOf, countTribe, // v0.23: tribal helpers exported for tests (inert in browser)
    pickTarget, targetSpec, validTargets, aiTarget, resolveBc, // v0.20 A3+A6+A9: targeting + multi-part riders exported
  };
});
