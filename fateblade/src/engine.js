// engine.js — FATEBLADE rules engine v0.5 (pure, headless-testable).
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
  const AI_LEVELS = ['easy', 'normal', 'hard'];

  const KWTXT = { Guard: 'GUARD', Charge: 'CHARGE', Lifesteal: 'LIFESTEAL', Ranged: 'RANGED' };
  const KWDESC = {
    Guard: 'Enemies must attack this minion before any other target.',
    Charge: 'This minion can attack the turn it is played.',
    Lifesteal: 'Damage this minion deals also heals your hero.',
    Ranged: 'This minion attacks without taking retaliation damage.',
  };

  const other = (side) => (side === 'A' ? 'B' : 'A');
  const hasP = (p, id) => !!(p.sov && p.sov.passive && p.sov.passive.id === id);

  // ---------- state ----------
  // opts: { sovA, sovB, first, deckA, deckB, aiA, aiB, rng }
  //   sovA/sovB — the Legendary cards leading each deck (their .passive is used)
  //   first     — 'A' | 'B', who won the coin flip and acts first
  //   deckA/deckB — arrays of card ids (10 types → ×2 copies each). If omitted,
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
      for (const id of ids) {
        const c = byId.get(id);
        if (!c) continue;
        d.push({ ...c, uid: c.id + '-1' });
        d.push({ ...c, uid: c.id + '-2' });
      }
      return shuffle(d);
    };
    const side = (fac, sov, deckIds) => ({
      hp: MAX_HP, mana: 1, maxmana: 1, power: false, fac,
      deck: mk(fac, deckIds), hand: [], board: [], relics: [],
      sov: sov ? { id: sov.id, name: sov.name, img: sov.img, passive: sov.passive } : null,
      discountUsed: false,
      fatigue: 0,
    });
    const first = opts.first === 'B' ? 'B' : 'A';
    const lvl = (v) => (AI_LEVELS.includes(v) ? v : 'normal');
    const S = {
      turn: 1, active: first, first, events: [], rng: opts.rng || Math.random,
      aiA: lvl(opts.aiA), aiB: lvl(opts.aiB),
      A: side(facA, opts.sovA, opts.deckA), B: side(facB, opts.sovB, opts.deckB),
    };
    const n = (side) => (side === first ? 3 : 4); // going-second compensation: +1 card
    for (let i = 0; i < n('A'); i++) draw(S, 'A');
    for (let i = 0; i < n('B'); i++) draw(S, 'B');
    S[first].mana += 1; // First Rites v0.6.4: turn-one bonus (turns 2-3 come from endTurn)
    S.events.push({ t: 'passive', side: first, id: 'FIRST_RITES' });
    return S;
  }

  // First Rites: for the coin-flip winner's first three turns (S.turn 1, 3, 5), their
  // Sovereign passive magnitudes are doubled (+1s become +2s, pings deal 2, …).
  const rites = (S, side) => (S.first === side && S.turn <= 5 ? 2 : 1);

  function draw(S, side) {
    const p = S[side];
    if (!p.deck.length) {
      // fatigue: each draw from an empty deck escalates (1, 2, 3, …)
      p.fatigue += 1;
      p.hp -= p.fatigue;
      S.events.push({ t: 'fatigue', side, dmg: p.fatigue });
      return;
    }
    if (p.hand.length < MAX_HAND) p.hand.push(p.deck.pop());
  }

  // ---------- helpers ----------
  // deal damage to a minion; handles death + Deathrattle + the owner's DEATHGIFT
  function damageMinion(S, victimSide, uid, dmg) {
    const vp = S[victimSide], foeSide = other(victimSide);
    const t = vp.board.find((x) => x.uid === uid);
    if (!t) return;
    t.hp -= dmg;
    if (t.hp <= 0) {
      vp.board = vp.board.filter((x) => x.uid !== uid);
      S.events.push({ t: 'death', side: victimSide, id: t.id, uid });
      // Deathrattle templates (fixed/fair automatic targeting)
      const dr = t.dr;
      if (dr) {
        S.events.push({ t: 'dr', side: victimSide, id: dr, src: t.id });
        if (dr === 'drHero1') { S[foeSide].hp -= 1; S.events.push({ t: 'heroHit', side: foeSide, id: 'DR', dmg: 1 }); }
        else if (dr === 'drPing' && S[foeSide].board.length) {
          const m = S[foeSide].board[Math.floor(S.rng() * S[foeSide].board.length)];
          damageMinion(S, foeSide, m.uid, 1);
        }
        else if (dr === 'drHeal2') { vp.hp = Math.min(MAX_HP, vp.hp + 2); }
        else if (dr === 'drSummon' && vp.board.length < MAX_BOARD) { vp.board.push(token(vp, S)); S.events.push({ t: 'play', side: victimSide, id: 'TOKEN', uid: 'TOKEN' + vp.board.length, kw: null, cost: 1 }); }
        else if (dr === 'drDraw') { draw(S, victimSide); }
      }
      if (hasP(vp, 'DEATHGIFT')) {
        const d = 1 * rites(S, victimSide);
        S[foeSide].hp -= d;
        S.events.push({ t: 'heroHit', side: foeSide, id: 'DEATHGIFT', dmg: d });
      }
    }
  }
  // 1/1 Conscript token (uses the realm commander portrait)
  function token(p, S) {
    const t = { id: 'TOKEN@' + p.fac.id, name: 'Conscript', cost: 1, atk: 1, hp: 1, kw: null,
      uid: 'TOKEN-' + Math.floor(S.rng() * 1e9), img: p.fac.commander, file: p.fac.commanderFile, fl: 'Sworn to the banner.' };
    if (hasRelic(p, 'rlDrillyard')) { t.atk += 1; t.hp += 1; } // Iron Yards: sworn levies drill to 2/2
    return t;
  }
  const hasRelic = (p, rl) => p.relics.some((x) => x.rl === rl);
  // damage to a hero, respecting EMBERWARD (only vs attacks)
  function heroDamage(S, victimSide, dmg, fromAttack) {
    const vp = S[victimSide];
    if (fromAttack && hasP(vp, 'EMBERWARD')) dmg = Math.max(1, dmg - rites(S, victimSide));
    vp.hp -= dmg;
    return dmg;
  }

  // ---------- actions ----------
  function effCost(S, side, c) {
    const p = S[side];
    if (hasP(p, 'SWIFTRANKS') && !p.discountUsed && c.cost <= 3) return Math.max(0, c.cost - rites(S, side)); // v0.6.4: once per game, cheap cards only
    return c.cost;
  }
  function canPlay(S, side, i) {
    const p = S[side], c = p.hand[i];
    if (!c || p.mana < effCost(S, side, c)) return false;
    if (c.type === 'edict') return true;                       // spells never need board space
    if (c.type === 'relic') return p.relics.length < MAX_RELICS;
    return p.board.length < MAX_BOARD;
  }
  function playCard(S, side, i) {
    if (!canPlay(S, side, i)) return false;
    const p = S[side], foe = S[other(side)];
    const c = p.hand.splice(i, 1)[0];
    const cost = effCost(S, side, c);
    if (hasP(p, 'SWIFTRANKS') && !p.discountUsed) p.discountUsed = true; // stays spent for the whole game (v0.6.4)
    p.mana -= cost;

    // ---- EDICTS: one-shot command cards; resolve and vanish ----
    if (c.type === 'edict') {
      S.events.push({ t: 'edict', side, id: c.id, fx: c.fx });
      resolveEdict(S, side, c.fx, c);
      return true;
    }
    // ---- RELICS: persistent seats of power; take a relic slot ----
    if (c.type === 'relic') {
      if (p.relics.length >= MAX_RELICS) { p.hand.splice(i, 0, c); p.mana += cost; return false; }
      p.relics.push({ ...c });
      S.events.push({ t: 'relic', side, id: c.id, rl: c.rl });
      if (c.rl === 'rlStandards') p.board.forEach((m) => { if (m.kw === 'Guard') m.atk += 1; }); // eagles rise for the standing army
      if (c.rl === 'rlLookout') p.board.forEach((m) => { if (m.kw === 'Ranged') m.atk += 1; }); // the masthead watches
      return true;
    }

    // Sovereign entry passives (First Rites doubles the bonus in the opening)
    const r = rites(S, side);
    const m = { ...c, ready: c.kw === 'Charge', uid: c.uid };
    if (m.kw === 'Guard' && hasRelic(p, 'rlStandards')) m.atk += 1; // Legion Standards: every Guard musters +1 atk
    if (m.kw === 'Ranged' && hasRelic(p, 'rlLookout')) m.atk += 1; // The Lookout: every gun is sighted
    if (m.kw === 'Guard' && hasP(p, 'BULWARK')) m.hp += 2 * r; // v0.6.4 buff: +2 HP (was +1)
    if (m.kw === 'Charge' && hasP(p, 'VANGUARD')) m.atk += r;
    if (m.kw === 'Lifesteal' && hasP(p, 'SOULTITHE')) m.atk += r;
    if (m.kw === 'Ranged' && hasP(p, 'LONGSIGHT')) m.hp += r;
    p.board.push(m);
    S.events.push({ t: 'play', side, id: c.id, uid: c.uid, kw: c.kw || null, cost: c.cost });
    // Battlecry templates (fixed/fair automatic targeting)
    if (c.bc) {
      S.events.push({ t: 'bc', side, id: c.bc, src: c.id });
      if (c.bc === 'bcHero1') { foe.hp -= 1; S.events.push({ t: 'heroHit', side: other(side), id: 'BC', dmg: 1 }); }
      else if (c.bc === 'bcPing' && foe.board.length) {
        const t = foe.board[Math.floor(S.rng() * foe.board.length)];
        damageMinion(S, other(side), t.uid, 1);
      }
      else if (c.bc === 'bcHeal2') { p.hp = Math.min(MAX_HP, p.hp + 2); }
      else if (c.bc === 'bcBuff') {
        const others = p.board.filter((x) => x.uid !== m.uid);
        if (others.length) { const b = others[Math.floor(S.rng() * others.length)]; b.atk += 1; b.hp += 1; S.events.push({ t: 'buff', side, id: b.id }); }
      }
      else if (c.bc === 'bcSummon' && p.board.length < MAX_BOARD) { p.board.push(token(p, S)); }
      else if (c.bc === 'bcDraw') { draw(S, side); }
    }
    return true;
  }

  // ---------- EDICT EFFECTS (v0.6) ----------
  function resolveEdict(S, side, fx, c) {
    const p = S[side], foe = S[other(side)];
    switch (fx) {
      case 'fxDraw2': draw(S, side); draw(S, side); break;
      case 'fxPingAll': foe.board.slice().forEach((t) => damageMinion(S, other(side), t.uid, 1)); break;
      case 'fxAoe2':   foe.board.slice().forEach((t) => damageMinion(S, other(side), t.uid, 2)); break;
      case 'fxSnipe3': { const t = foe.board.slice().sort((a,b) => (b.atk+b.hp)-(a.atk+a.hp))[0]; if (t) damageMinion(S, other(side), t.uid, 3); break; }
      case 'fxExecute': { const t = foe.board.slice().sort((a,b) => b.atk-a.atk)[0]; if (t) damageMinion(S, other(side), t.uid, t.hp + 99); break; }
      case 'fxHealHero4': p.hp = Math.min(MAX_HP, p.hp + 4); break;
      case 'fxMana2': p.mana += 2; break;
      case 'fxRally': { if (p.board.length < MAX_BOARD) p.board.push(token(p, S)); if (p.board.length < MAX_BOARD) p.board.push(token(p, S)); break; }
      case 'fxRallyBoard': p.board.forEach((m) => { m.atk += 1; m.hp += 1; }); break;
      case 'fxVolley': { const n = p.board.filter((m) => m.kw === 'Ranged').length; const d = n * 1; if (d > 0) { foe.hp -= d; S.events.push({ t: 'heroHit', side: other(side), id: 'VOLLEY', dmg: d }); } break; }
      case 'fxMomentum': p.board.forEach((m) => { if (m.kw === 'Charge') m.atk += 2; }); break;
      case 'fxFormation': p.board.forEach((m) => { if (m.kw === 'Guard') m.hp += 2; }); break;
      case 'fxLevy': { p.board.forEach((m) => { if (m.id.startsWith('TOKEN@')) { m.atk += 1; m.hp += 1; } }); if (p.board.length < MAX_BOARD) p.board.push(token(p, S)); break; }
      case 'fxPillage': { foe.hp -= 2; S.events.push({ t: 'heroHit', side: other(side), id: 'PILLAGE', dmg: 2 }); if (p.board.length > foe.board.length) draw(S, side); break; }
    }
  }

  function canAttack(S, side, uid, target) {
    const p = S[side], foe = S[other(side)];
    const m = p.board.find((x) => x.uid === uid);
    if (!m || !m.ready) return false;
    const guards = foe.board.filter((x) => x.kw === 'Guard');
    if (target.hero) return guards.length === 0;
    const t = foe.board.find((x) => x.uid === target.uid);
    if (!t) return false;
    return guards.length === 0 || t.kw === 'Guard';
  }
  function attack(S, side, uid, target) {
    if (!canAttack(S, side, uid, target)) return false;
    const p = S[side], foe = S[other(side)];
    const m = p.board.find((x) => x.uid === uid);
    m.ready = false;
    if (target.hero) {
      const dealt = heroDamage(S, other(side), m.atk, true);
      if (m.kw === 'Lifesteal') p.hp = Math.min(MAX_HP, p.hp + dealt);
      S.events.push({ t: 'heroHit', side, id: m.id, dmg: dealt });
    } else {
      const t = foe.board.find((x) => x.uid === target.uid);
      S.events.push({ t: 'hit', side, id: m.id, dmg: m.atk, on: t.id });
      if (m.kw !== 'Ranged' && t.atk > 0) {
        // retaliation can kill the attacker (their own Deathrattle/DEATHGIFT may fire)
        damageMinion(S, side, m.uid, t.atk);
      }
      if (m.kw === 'Lifesteal' && m.hp > 0) p.hp = Math.min(MAX_HP, p.hp + m.atk);
      damageMinion(S, other(side), t.uid, m.atk);
    }
    return true;
  }

  function canPower(S, side) {
    const p = S[side];
    return S.active === side && !p.power && p.mana >= powerCost(S, side);
  }
  // First Rites: during the coin-flip winner's first three turns, Skirmish costs 1 mana
  function powerCost(S, side) {
    return (S.first === side && S.turn <= 5) ? 1 : 2;
  }
  // Bloodletter's Skirmish deals 2; First Rites doubles it in the opening.
  function powerDmg(S, side) {
    return (hasP(S[side], 'BLOODLETTER') ? 2 : 1) * rites(S, side);
  }
  function power(S, side, target) {
    if (!canPower(S, side)) return false;
    const p = S[side], foe = S[other(side)];
    p.power = true; p.mana -= powerCost(S, side);
    const dmg = powerDmg(S, side);
    if (target.hero) {
      foe.hp -= dmg;
      S.events.push({ t: 'heroHit', side, id: 'POWER', dmg });
    } else {
      const t = foe.board.find((x) => x.uid === target.uid);
      if (!t) return false;
      S.events.push({ t: 'hit', side, id: 'POWER', dmg, on: t.id });
      damageMinion(S, other(side), t.uid, dmg);
    }
    return true;
  }

  function endTurn(S) {
    const next = other(S.active);
    S.active = next; S.turn++;
    const np = S[next], foe = S[other(next)];
    np.maxmana = Math.min(MAX_MANA, np.maxmana + 1);
    np.mana = np.maxmana + (S.first === next && S.turn <= 5 ? 1 : 0) + (S.first === next && S.turn <= 1 ? 1 : 0); // First Rites v0.6.4: +1 mana on the winner's first three turns, +2 on turn one (tuned: 55.7% → 34% → 43.6% → target 50)
    np.power = false;
    np.board.forEach((m) => { m.ready = true; });
    // relic hooks (v0.6)
    if (hasRelic(np, 'rlGranary')) np.hp = Math.min(MAX_HP, np.hp + 1);
    if (hasRelic(foe, 'rlLibrary') && foe.mana >= 2) { draw(S, other(next)); S.events.push({ t: 'relicfx', side: other(next), id: 'rlLibrary' }); }
    if (hasRelic(foe, 'rlForage') && foe.board.length < 3 && foe.board.length < MAX_BOARD) { foe.board.push(token(foe, S)); S.events.push({ t: 'relicfx', side: other(next), id: 'rlForage' }); }
    const r = rites(S, next);
    // start-of-turn Sovereign passives
    if (hasP(np, 'STORMCALL') && foe.board.length) {
      for (let i = 0; i < r; i++) {
        if (!foe.board.length) break;
        const t = foe.board[Math.floor(S.rng() * foe.board.length)];
        S.events.push({ t: 'passive', side: next, id: 'STORMCALL', on: t.id });
        damageMinion(S, other(next), t.uid, 1);
      }
    }
    if (hasP(np, 'SECOND_SIGHT') && np.hand.length <= 3 && np.deck.length) {
      S.events.push({ t: 'passive', side: next, id: 'SECOND_SIGHT' });
      for (let i = 0; i < r; i++) draw(S, next);
    }
    draw(S, next);
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

  // ---------- AI brains ----------
  // EASY — a careless levy: reasonable tempo but sloppy aim, occasionally
  // fumbles its best play, picks attack targets on a whim, and half the time
  // forgets Skirmish exists.
  function aiEasy(S, side) {
    const foeSide = other(side);
    const me = S[side], foe = S[foeSide];

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
    if (bi >= 0) playCard(S, side, bi);

    // hero power: remembers it exists about half the time
    if (canPower(S, side) && S.rng() > 0.5) {
      const pd = powerDmg(S, side);
      const t = foe.board.filter((m) => m.hp <= pd).sort((a, b) => b.atk - a.atk)[0];
      if (t || foe.hp <= pd) power(S, side, t ? { uid: t.uid } : { hero: true });
    }

    // attacks: aims face more often than it should, trades at random otherwise
    const legalTargets = () => {
      const guards = foe.board.filter((m) => m.kw === 'Guard');
      if (guards.length) return guards.map((g) => ({ uid: g.uid }));
      if (S.rng() < 0.65 || !foe.board.length) return [{ hero: true }];
      const opts = foe.board.map((t) => ({ uid: t.uid }));
      return [opts[Math.floor(S.rng() * opts.length)]];
    };
    me.board.slice().forEach((m) => {
      if (!me.board.find((x) => x.uid === m.uid) || !m.ready) return; // died mid-loop
      const opts = legalTargets();
      const pick = opts[Math.floor(S.rng() * opts.length)];
      attack(S, side, m.uid, pick);
    });
  }

  // NORMAL — the classic greedy AI (unchanged behavior; prior sim reports reproduce)
  function aiNormal(S, side) {
    const foeSide = other(side);
    const me = S[side], foe = S[foeSide];

    // play greedily by cost, highest affordable first
    let played = true;
    while (played) {
      played = false;
      let bi = -1;
      me.hand.forEach((c, i) => {
        if (canPlay(S, side, i) && (bi < 0 || effCost(S, side, c) > effCost(S, side, me.hand[bi]))) bi = i;
      });
      if (bi >= 0) { playCard(S, side, bi); played = true; }
    }

    // hero power: finish a wounded minion, or push lethal-ish damage
    if (canPower(S, side)) {
      const pd = powerDmg(S, side);
      const t = foe.board.filter((m) => m.hp <= pd).sort((a, b) => b.atk - a.atk)[0];
      if (t || foe.hp <= pd) power(S, side, t ? { uid: t.uid } : { hero: true });
    }

    // attacks
    const guard = () => foe.board.some((m) => m.kw === 'Guard');
    me.board.slice().forEach((m) => {
      if (!me.board.find((x) => x.uid === m.uid) || !m.ready) return; // died mid-loop
      if (!foe.board.length && !guard()) { attack(S, side, m.uid, { hero: true }); return; }
      if (foe.hp <= m.atk && !guard()) { attack(S, side, m.uid, { hero: true }); return; }
      // favorable trades: kill something without dying (or dying to something smaller than us)
      const opts = foe.board.filter((t) =>
        t.hp <= m.atk && (m.kw === 'Ranged' || m.hp > t.atk || t.atk < m.atk));
      if (opts.length) {
        const t = opts.sort((a, b) => b.atk - a.atk)[0];
        attack(S, side, m.uid, { uid: t.uid });
        return;
      }
      if (!guard()) { attack(S, side, m.uid, { hero: true }); return; }
      // v0.6.4: never pass forever into a Guard wall — kill one if possible,
      // otherwise chip the weakest Guard (the old pass-only behavior stalled
      // 12-14% of games at the turn cap).
      const gs2 = foe.board.filter((t) => t.kw === 'Guard');
      if (gs2.length) {
        const kill = gs2.filter((t) => t.hp <= m.atk).sort((a, b) => b.atk - a.atk)[0];
        const chip = kill || gs2.slice().sort((a, b) => a.hp - b.hp)[0];
        attack(S, side, m.uid, { uid: chip.uid });
      }
    });
  }

  // HARD — a veteran marshal: plays greedy, reads lethal before anything else,
  // trades for maximum value (survives when it can, kills threats when it must),
  // and spends Skirmish to remove the biggest thing it can kill.
  // HARD AI play evaluator (v0.6): every legal card gets an expected-value
  // score in context; the AI plays the highest-EV line it can afford, and
  // HOLDS cards whose value is situational (no AOE into empty boards, no
  // relic spam over bodies). This is what makes edicts/relics strategic.
  function evScore(S, side, c) {
    const p = S[side], foe = S[other(side)];
    if (c.type === 'edict') {
      switch (c.fx) {
        case 'fxDraw2': return 2.6;
        case 'fxPingAll': return foe.board.reduce((s2, t) => s2 + Math.min(1, t.hp) * (t.hp <= 1 ? 2.0 : 1.1), 0);
        case 'fxAoe2': return foe.board.reduce((s2, t) => s2 + (t.hp <= 2 ? (t.atk + t.hp) * 1.2 : 2.4), 0);
        case 'fxSnipe3': { const t = foe.board.slice().sort((a,b) => (b.atk+b.hp)-(a.atk+a.hp))[0]; return t ? (t.hp <= 3 ? (t.atk + t.hp) * 1.3 : 3.6) : 0; }
        case 'fxExecute': { const t = foe.board.slice().sort((a,b) => b.atk-a.atk)[0]; return t ? (t.atk + t.hp) * 1.4 : 0; }
        case 'fxHealHero4': return Math.min(4, MAX_HP - p.hp) * 0.55;
        case 'fxMana2': return p.hand.length > 2 ? 2.2 : 0.8;
        case 'fxRally': return (p.board.length <= MAX_BOARD - 2) ? 2 * 2 * 0.9 : 0;
        case 'fxRallyBoard': return p.board.reduce((s2, m) => s2 + 2, 0) * 0.95;
        case 'fxVolley': return p.board.filter((m) => m.kw === 'Ranged').length * 1.35;
        case 'fxMomentum': return p.board.filter((m) => m.kw === 'Charge').length * 1.6;
        case 'fxFormation': return p.board.filter((m) => m.kw === 'Guard').length * 1.9;
        case 'fxLevy': return p.board.filter((m) => m.id.startsWith('TOKEN@')).length * 2.1 + 1.5;
        case 'fxPillage': return 2 * 1.4 + (p.board.length > foe.board.length ? 1.6 : 0);
        default: return 1;
      }
    }
    if (c.type === 'relic') {
      switch (c.rl) {
        case 'rlLibrary': return 2.3;
        case 'rlStandards': return 1.2 + p.board.filter((m) => m.kw === 'Guard').length * 1.4;
        case 'rlGranary': return 1.9;
        case 'rlDrillyard': return 1.8;
        case 'rlForage': return 2.0;
        case 'rlLookout': return 1.2 + p.board.filter((m) => m.kw === 'Ranged').length * 1.3;
        default: return 1.5;
      }
    }
    // minion: tempo + keyword + ability value
    let v = c.atk + c.hp;
    if (c.kw === 'Guard') v += 1.2;
    else if (c.kw === 'Charge') v += 1.8;
    else if (c.kw === 'Ranged') v += 1.2;
    else if (c.kw === 'Lifesteal') v += 1.0;
    if (c.bc === 'bcDraw') v += 1.6;
    if (c.bc === 'bcPing') v += 0.4 + foe.board.length * 0.4;
    if (c.bc === 'bcHeal2') v += Math.min(2, MAX_HP - p.hp) * 0.5;
    if (c.bc === 'bcSummon') v += 1.7;
    if (c.bc === 'bcBuff') v += p.board.length * 1.1;
    if (c.dr) v += 0.9;
    if (c.rarity === 'legendary') v += 1.2;
    return v;
  }

  const p2manaOK = (S, side, i) => { try { return canPlay(S, side, i); } catch (e) { return false; } };

  function aiHard(S, side) {
    const foeSide = other(side);
    const me = S[side], foe = S[foeSide];

    // THE PLAY EVALUATOR: score every affordable card in context; play the best
    // EV above a hold threshold, repeat while plays remain worthwhile.
    let played = true;
    while (played) {
      played = false;
      let bi = -1, bv = 0;
      me.hand.forEach((c, i) => {
        if (!canPlay(S, side, i)) return;
        const v = evScore(S, side, c) - effCost(S, side, c) * 0.2;
        if (v > bv) { bv = v; bi = i; }
      });
      if (bi >= 0 && bv >= 1.2) { playCard(S, side, bi); played = true; }
    }

    // lethal check BEFORE acting: if the board can end it, everything goes face
    const guards = () => foe.board.filter((m) => m.kw === 'Guard');
    const readyAtk = me.board.filter((m) => m.ready).reduce((s, m) => s + m.atk, 0);
    const pd = canPower(S, side) ? powerDmg(S, side) : 0;
    // spell lethal: face-damage edicts in hand count toward the kill
    let spellDmg = 0;
    me.hand.forEach((c, i) => {
      if (c.type === 'edict' && (c.fx === 'fxVolley' || c.fx === 'fxPillage') && p2manaOK(S, side, i)) {
        spellDmg += c.fx === 'fxVolley' ? me.board.filter((m) => m.kw === 'Ranged').length : 2;
      }
    });
    const lethal = !guards().length && foe.hp <= readyAtk + pd + spellDmg;

    // hero power: on lethal it's damage; otherwise remove the juiciest minion we can kill
    if (canPower(S, side)) {
      if (lethal) power(S, side, { hero: true });
      else {
        const t = foe.board.filter((m) => m.hp <= pd).sort((a, b) => (b.atk + b.hp) - (a.atk + a.hp))[0];
        if (t) power(S, side, { uid: t.uid });
        else if (foe.hp <= pd) power(S, side, { hero: true });
      }
    }

    // attacks: biggest attackers decide first, so small minions clean up after them
    me.board.slice().sort((a, b) => b.atk - a.atk).forEach((m) => {
      if (!me.board.find((x) => x.uid === m.uid) || !m.ready) return; // died mid-loop
      if (lethal && !guards().length) { attack(S, side, m.uid, { hero: true }); return; }

      // value trades: prefer kills we survive; among them, kill the most valuable
      const kills = foe.board.filter((t) => t.hp <= m.atk);
      const safe = kills.filter((t) => m.kw === 'Ranged' || m.hp > t.atk);
      const pool = safe.length ? safe : kills;
      if (pool.length) {
        const t = pool.slice().sort((a, b) => (b.atk + b.hp) - (a.atk + a.hp))[0];
        // don't suicide a big body into chaff unless it's a real threat
        const worthIt = safe.length || (t.atk + t.hp) * 2 >= m.atk + m.hp;
        if (worthIt) { attack(S, side, m.uid, { uid: t.uid }); return; }
      }

      const gs = guards();
      if (!gs.length) { attack(S, side, m.uid, { hero: true }); return; }
      // must chew through a Guard: kill one if possible, otherwise bleed the weakest
      const killable = gs.filter((g) => g.hp <= m.atk).sort((a, b) => b.atk - a.atk)[0];
      const g = killable || gs.slice().sort((a, b) => a.hp - b.hp)[0];
      attack(S, side, m.uid, { uid: g.uid });
    });
  }

  // dispatch: aiTurn(S, side, level) — level falls back to the side's declared
  // difficulty (S.aiA/S.aiB from startMatch opts), then to 'normal'.
  function aiTurn(S, side, level) {
    const brain = AI_LEVELS.includes(level) ? level
      : (side === 'A' ? S.aiA : S.aiB) || 'normal';
    if (brain === 'easy') return aiEasy(S, side);
    if (brain === 'hard') return aiHard(S, side);
    return aiNormal(S, side);
  }

  return {
    MAX_BOARD, MAX_HAND, MAX_HP, MAX_MANA, MAX_RELICS, AI_LEVELS,
    KWTXT, KWDESC, hasP, powerDmg, powerCost, effCost,
    other, startMatch, draw,
    canPlay, playCard, canAttack, attack, canPower, power, endTurn, checkEnd, aiTurn,
  };
});
