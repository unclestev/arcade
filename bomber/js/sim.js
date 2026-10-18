// Bomber game rules: a pure, deterministic simulation shared by the browser and the referee.
//
// Same seed + same inputs => same game, bit for bit, on any JavaScript engine.
// Rules for keeping it that way:
//   - fixed 60 Hz step, all randomness from the seeded generator below
//   - only + - * / comparisons and Math.abs/min/max/floor/round/imul (no sin, exp, etc.)
//   - no DOM, no clock, no Math.random
// Visual-only things (particles, sound, wobble) live in the renderer, never here.

// Bump RULES whenever a change would alter how any run plays out. The referee refuses runs
// recorded under different rules, so old replays never verify against new rules.
export const RULES = '1';

export const TICK = 1 / 60;
export const INPUT_MAX = 4095; // bucket position is an integer 0..4095 each tick
export const MAX_TICKS = 60 * 60 * 120; // 2 hours of play time

export const GROUPS = [
  { n: 10,  pts: 1, fall: 42,  gap: 1.00, walk: 28,  err: 0.5 },
  { n: 20,  pts: 2, fall: 55,  gap: 0.80, walk: 38,  err: 0.8 },
  { n: 30,  pts: 3, fall: 70,  gap: 0.62, walk: 50,  err: 1.0 },
  { n: 40,  pts: 4, fall: 86,  gap: 0.48, walk: 64,  err: 1.3 },
  { n: 50,  pts: 5, fall: 104, gap: 0.38, walk: 80,  err: 1.6 },
  { n: 75,  pts: 6, fall: 122, gap: 0.30, walk: 96,  err: 1.9 },
  { n: 100, pts: 7, fall: 142, gap: 0.24, walk: 112, err: 2.2 },
  { n: 150, pts: 8, fall: 165, gap: 0.19, walk: 130, err: 2.6 },
];

// Classic: a 160 x 192 Atari-style field.
export const CLASSIC = { W: 160, LO: 8, HI: 152, GROUND: 182, TOPS: [138, 153, 168], SPAWN_Y: 34, BONUS: 1000 };
// Next Gen: a fixed 480-unit-wide field so every screen plays the same game.
export const NEXTGEN = {
  W: 480, M: 46, LO: 46, HI: 434, PARAPET: 92, SPAWN_Y: 84, GROUND: 506, TOPS: [402, 436, 470], BH: 28, R: 13,
  HALF: 33, HALF_WIDE: 50, BONUS: 2000,
};
export const POWERS = { wide: 10, slow: 7, shield: 0 }; // seconds (shield lasts until used)
const POWER_TYPES = ['wide', 'slow', 'shield'];

// ---------- seeded random (sfc32) ----------
export function makeRng(seedHex) {
  const h = String(seedHex).padEnd(32, '0');
  let a = parseInt(h.slice(0, 8), 16) | 0, b = parseInt(h.slice(8, 16), 16) | 0;
  let c = parseInt(h.slice(16, 24), 16) | 0, d = parseInt(h.slice(24, 32), 16) | 0;
  const next = () => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 15; i++) next();
  return next;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const tri = x => { const f = x - Math.floor(x); return 1 - 4 * Math.abs(f - 0.5); }; // -1..1 triangle wave

// ---------- game ----------
// Modes: 'classic', 'nextgen', and 'bitcoin' (the Bitcoin Edition: Next Gen rules with a different look).
export const MODES = ['classic', 'nextgen', 'bitcoin'];
export const usesNextGenRules = mode => mode === 'nextgen' || mode === 'bitcoin';

export function createGame(mode, seedHex) {
  if (!MODES.includes(mode)) throw new Error('bad mode');
  const ng = usesNextGenRules(mode);
  const C = ng ? NEXTGEN : CLASSIC;
  const cx = C.W / 2;
  return {
    mode, ng, seed: seedHex, rand: makeRng(seedHex), C,
    state: 'ready', tick: 0, score: 0, buckets: 3, group: 0, maxGroup: 0, nextBonus: C.BONUS,
    bombs: [], powers: [], nextId: 1,
    bomber: { x: cx, tx: cx, vx: 0, hand: 1, throwT: 0 },
    dropped: 0, dropT: 0, waveCaught: 0, caught: 0,
    streak: 0, best: 0, mult: 1, pw: { wide: 0, slow: 0, shield: false },
    boomQ: [], boomT: 0, boomWait: 0, boomTotal: 0, boomDone: 0, clearT: 0,
    u: INPUT_MAX / 2 | 0,
    ev: [], // events for the renderer (sound, particles, messages); the sim never reads them
  };
}

export function bucketX(G, u = G.u) {
  const C = G.C;
  return C.LO + (u / INPUT_MAX) * (C.HI - C.LO);
}
export function bucketHalf(G) {
  return G.ng ? (G.pw.wide > 0 ? NEXTGEN.HALF_WIDE : NEXTGEN.HALF) : 8;
}

export function startWave(G) {
  if (G.state !== 'ready') return false;
  const g = GROUPS[G.group];
  G.state = 'play'; G.dropped = 0; G.dropT = g.gap * 0.5; G.waveCaught = 0; G.bombs = [];
  G.bomber.tx = G.C.LO + G.rand() * (G.C.HI - G.C.LO);
  G.ev.push({ t: 'wave', group: G.group });
  return true;
}

function moveBomber(G, dt, speed, err) {
  const b = G.bomber, C = G.C, ox = b.x;
  if (speed > 0 && (G.rand() < err * dt || Math.abs(b.tx - b.x) < 1)) b.tx = C.LO + G.rand() * (C.HI - C.LO);
  b.tx = clamp(b.tx, C.LO, C.HI); b.x = clamp(b.x, C.LO, C.HI);
  const d = b.tx - b.x, step = speed * dt;
  if (Math.abs(d) <= step) b.x = b.tx; else b.x += (d > 0 ? 1 : -1) * step;
  b.vx = dt > 0 ? (b.x - ox) / dt : 0;
}

function addScore(G, p) {
  G.score = Math.min(9999999, G.score + p);
  while (G.score >= G.nextBonus) {
    G.nextBonus += G.C.BONUS;
    if (G.buckets < 3) { G.buckets++; G.ev.push({ t: 'bonusBucket' }); }
  }
}

function startBoom(G, first) {
  G.state = 'boom';
  const rest = G.bombs.filter(b => b !== first).sort((a, b) => b.y - a.y || a.id - b.id);
  G.boomQ = [first, ...rest]; G.boomTotal = G.boomQ.length; G.boomDone = 0; G.boomT = 0;
  G.boomWait = G.ng ? 1.0 : 0.8;
  G.streak = 0; G.mult = 1;
  for (const p of G.powers) G.ev.push({ t: 'powerLost', x: p.cx, y: p.y, type: p.type });
  G.powers = [];
  G.ev.push({ t: 'miss' });
}

function loseBucket(G) {
  G.buckets--;
  G.ev.push({ t: 'lose', bucket: G.buckets });
  if (G.buckets <= 0) { G.state = 'over'; G.bombs = []; G.ev.push({ t: 'over' }); return; }
  G.group = Math.max(0, G.group - 1);
  G.state = 'ready'; G.bombs = [];
  G.ev.push({ t: 'ready' });
}

function waveClear(G) {
  const g = GROUPS[G.group];
  G.state = 'clear';
  if (G.ng) {
    const bonus = g.pts * 20;
    addScore(G, bonus);
    for (const p of G.powers) G.ev.push({ t: 'powerLost', x: p.cx, y: p.y, type: p.type });
    G.powers = [];
    G.clearT = 1.7;
    G.ev.push({ t: 'clear', bonus });
  } else {
    G.clearT = 1.2;
    G.ev.push({ t: 'clear', bonus: 0 });
  }
}

// Advance one tick. Only call while state is 'play', 'clear' or 'boom'.
export function step(G, u) {
  if (G.state !== 'play' && G.state !== 'clear' && G.state !== 'boom') return;
  G.u = clamp(u | 0, 0, INPUT_MAX);
  G.tick++;
  if (G.ng) stepNextGen(G); else stepClassic(G);
}

function stepClassic(G) {
  const C = CLASSIC, dt = TICK, g = GROUPS[G.group], bx = bucketX(G);
  if (G.state === 'play') {
    moveBomber(G, dt, g.walk, g.err);
    G.dropT -= dt;
    if (G.dropped < g.n && G.dropT <= 0) {
      G.bombs.push({ id: G.nextId++, x: G.bomber.x, y: C.SPAWN_Y, gold: false });
      G.dropped++; G.dropT += g.gap;
      G.ev.push({ t: 'drop' });
    }
    for (let i = G.bombs.length - 1; i >= 0; i--) {
      const b = G.bombs[i];
      b.y += g.fall * dt;
      const bot = b.y + 9;
      let top = -1;
      for (let k = 0; k < G.buckets; k++) {
        const by = C.TOPS[k];
        if (bot >= by + 1 && b.y < by + 6 && Math.abs(b.x - bx) <= 10) { top = by; break; }
      }
      if (top >= 0) {
        G.bombs.splice(i, 1);
        G.caught++; G.waveCaught++; G.streak++; if (G.streak > G.best) G.best = G.streak;
        addScore(G, g.pts);
        G.ev.push({ t: 'catch', x: bx, top, pts: g.pts, gold: false, n: G.waveCaught });
        continue;
      }
      if (bot >= C.GROUND) { startBoom(G, b); return; }
    }
    if (G.dropped >= g.n && G.bombs.length === 0) waveClear(G);
  } else if (G.state === 'clear') {
    G.clearT -= dt;
    if (G.clearT <= 0) { G.group = Math.min(GROUPS.length - 1, G.group + 1); if (G.group > G.maxGroup) G.maxGroup = G.group; G.state = 'ready'; G.ev.push({ t: 'ready' }); }
  } else stepBoom(G, 0.11, C.GROUND - 5, 4);
}

function stepBoom(G, interval, floorY, yOff) {
  G.boomT -= TICK;
  if (G.boomQ.length) {
    if (G.boomT <= 0) {
      const b = G.boomQ.shift();
      G.bombs = G.bombs.filter(x => x !== b);
      G.ev.push({ t: 'explode', x: b.x, y: Math.min(b.y + yOff, floorY) });
      G.boomDone++; G.boomT = interval;
    }
  } else {
    G.boomWait -= TICK;
    if (G.boomWait <= 0) loseBucket(G);
  }
}

function stepNextGen(G) {
  const C = NEXTGEN, g = GROUPS[G.group];
  const dt = TICK, gdt = G.pw.slow > 0 ? TICK * 0.55 : TICK;
  if (G.pw.wide > 0) G.pw.wide = Math.max(0, G.pw.wide - dt);
  if (G.pw.slow > 0) G.pw.slow = Math.max(0, G.pw.slow - dt);
  G.bomber.throwT = Math.max(0, G.bomber.throwT - dt);
  const bx = bucketX(G), half = bucketHalf(G);
  const walk = g.walk / 144 * (C.W - 2 * C.M), fall = g.fall * 2.5;

  if (G.state === 'play') {
    moveBomber(G, gdt, walk, g.err);
    G.dropT -= gdt;
    if (G.dropped < g.n && G.dropT <= 0) { spawnBomb(G); G.dropped++; G.dropT += g.gap; }
    for (let i = G.bombs.length - 1; i >= 0; i--) {
      const b = G.bombs[i];
      b.y += fall * gdt;
      let top = -1;
      for (let k = 0; k < G.buckets; k++) {
        const t = C.TOPS[k];
        if (b.y + C.R >= t + 3 && b.y - C.R < t + C.BH && Math.abs(b.x - bx) <= half + C.R * 0.35) { top = t; break; }
      }
      if (top >= 0) { G.bombs.splice(i, 1); catchBomb(G, b, top, bx, g); continue; }
      if (b.y + C.R >= C.GROUND) {
        if (G.pw.shield) {
          G.bombs.splice(i, 1);
          G.pw.shield = false; G.streak = 0; G.mult = 1;
          G.ev.push({ t: 'explode', x: b.x, y: C.GROUND - 8 });
          G.ev.push({ t: 'shieldSave', x: b.x });
          continue;
        }
        startBoom(G, b); return;
      }
    }
    stepPowers(G, gdt, bx, half, fall);
    if (G.dropped >= g.n && G.bombs.length === 0) waveClear(G);
  } else if (G.state === 'clear') {
    G.clearT -= dt;
    if (G.clearT <= 0) { G.group = Math.min(GROUPS.length - 1, G.group + 1); if (G.group > G.maxGroup) G.maxGroup = G.group; G.state = 'ready'; G.ev.push({ t: 'ready' }); }
  } else { G.bomber.vx = 0; stepBoom(G, 0.12, C.GROUND - 8, 0); }
}

function spawnBomb(G) {
  const C = NEXTGEN, b = G.bomber;
  b.hand = -b.hand; b.throwT = 0.22;
  const gold = G.group > 0 && G.rand() < 0.06;
  G.bombs.push({ id: G.nextId++, x: clamp(b.x + b.hand * 17, C.LO, C.HI), y: C.SPAWN_Y, gold });
  G.ev.push({ t: 'drop', hand: b.hand });
  if (G.group >= 1 && G.powers.length === 0 && G.rand() < 0.05) {
    const types = POWER_TYPES.filter(t => !(t === 'shield' && G.pw.shield));
    const type = types[Math.floor(G.rand() * types.length)];
    const x = clamp(b.x, C.LO, C.HI);
    G.powers.push({ id: G.nextId++, type, x, cx: x, y: C.SPAWN_Y - 6, age: 0, ph: G.rand() });
  }
}

function catchBomb(G, b, top, bx, g) {
  G.caught++; G.waveCaught++; G.streak++; if (G.streak > G.best) G.best = G.streak;
  const m = G.streak >= 50 ? 4 : G.streak >= 25 ? 3 : G.streak >= 10 ? 2 : 1;
  if (m > G.mult) { G.mult = m; G.ev.push({ t: 'combo', m }); }
  const pts = g.pts * G.mult * (b.gold ? 3 : 1);
  addScore(G, pts);
  G.ev.push({ t: 'catch', x: bx, top, pts, gold: b.gold, n: G.streak });
}

function stepPowers(G, gdt, bx, half, fall) {
  const C = NEXTGEN;
  for (let i = G.powers.length - 1; i >= 0; i--) {
    const p = G.powers[i];
    p.age += gdt;
    p.y += fall * 0.5 * gdt;
    p.cx = clamp(p.x + 10 * tri(p.age * 0.32 + p.ph), C.LO, C.HI);
    let got = false;
    for (let k = 0; k < G.buckets; k++) {
      const t = C.TOPS[k];
      if (p.y + 11 >= t + 2 && p.y - 11 < t + C.BH && Math.abs(p.cx - bx) <= half + 8) { got = true; break; }
    }
    if (got) {
      G.powers.splice(i, 1);
      if (p.type === 'shield') G.pw.shield = true; else G.pw[p.type] = POWERS[p.type];
      G.ev.push({ t: 'power', type: p.type, x: p.cx, y: p.y });
      continue;
    }
    if (p.y + 11 >= C.GROUND) { G.powers.splice(i, 1); G.ev.push({ t: 'powerLost', x: p.cx, y: C.GROUND - 10, type: p.type }); }
  }
}

// ---------- replay verification (used by the referee; also handy for tests) ----------
// replay = { mode, seed, segs: [ticks per wave run...], inputs: Uint16Array of bucket positions }
export function runReplay(replay, limit = MAX_TICKS) {
  const { mode, seed, segs, inputs } = replay;
  if (!MODES.includes(mode)) throw new Error('bad mode');
  if (!/^[0-9a-f]{32}$/.test(seed)) throw new Error('bad seed');
  let total = 0;
  for (const n of segs) { if (!Number.isInteger(n) || n < 1) throw new Error('bad segment'); total += n; }
  if (total !== inputs.length) throw new Error('input count mismatch');
  if (total > limit) throw new Error('replay too long');
  const G = createGame(mode, seed);
  let i = 0;
  for (let s = 0; s < segs.length; s++) {
    if (!startWave(G)) throw new Error('wave started at the wrong time');
    for (let k = 0; k < segs[s]; k++) {
      if (G.state !== 'play' && G.state !== 'clear' && G.state !== 'boom') throw new Error('inputs after the run ended');
      step(G, inputs[i++]);
      G.ev.length = 0;
    }
    if (G.state !== 'ready' && G.state !== 'over') throw new Error('segment ended mid-wave');
    if (G.state === 'over' && s !== segs.length - 1) throw new Error('inputs after game over');
  }
  return G;
}
