// Dirtbox Rally game rules: a pure, deterministic simulation shared by the browser and the referee.
//
// Same seed + same inputs => same game, bit for bit, on any JavaScript engine.
// Rules for keeping it that way:
//   - fixed 60 Hz step (two physics substeps per tick), all randomness from the seeded generator
//   - only + - * / comparisons and Math.abs/min/max/floor/round/imul; sine, cosine, arctangent and
//     square root come from the deterministic helpers below, never from Math
//   - no DOM, no clock, no Math.random
// Visual-only things (particles, sound, skid marks, camera) live in the renderer and read events
// from game.ev; the simulation never reads anything back from them.

// Bump RULES whenever a change would alter how any run plays out.
export const RULES = '2';  // 2: hit spins end facing down the track

export const TICK = 1 / 60;
const SUB = 2;
const H = TICK / SUB;
export const MAX_TICKS = 60 * 60 * 60; // one hour of racing
export const LAPS = 3;
export const START_LIVES = 3;
export const MAX_UPGRADE = 5;
export const LETTER_WORD = 'DIRTBOX';
export const BOARDS = ['classic', 'nextgen']; // Next Gen: same rules, 3D view, its own leaderboard
export const POINTS = {
  place: [5000, 3000, 1500, 0], pickup: 100, upgrade: 250, letter: 500, word: 10000,
  missileHit: 1000, bombHit: 750, circuit: 25000,
};
export const TRUCK = {
  vmax: 165, vmaxPerEngine: 13, drag: 1.5, dragPerTurbo: 0.16,
  grip: 9, gripPerTires: 1.6, turn: 3.3, turnPerTires: 0.12,
};
export const WORLD = 1100;
export const HW = 30, CURB = 5, WALL = 6;
const DS = 4;
const GRAV = 300;
const INTRO = 1.7, COUNT = 2.4, AFTER = 4.2;
const AMMO_CAP = { missile: 9, bomb: 9, nitro: 5 };

// ---------- deterministic math ----------
export const PI = 3.141592653589793;
export const TAU = 2 * PI;
const HALF_PI = PI / 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const approach = (v, t, s) => (v < t ? Math.min(v + s, t) : Math.max(v - s, t));
export const wrapAngle = a => a - TAU * Math.floor((a + PI) / TAU);
const sgn = v => (v < 0 ? -1 : 1);

const TRIG_N = 4096;
const SIN = new Float64Array(TRIG_N + 1);
for (let i = 0; i <= TRIG_N; i++) {
  let x = (i / TRIG_N) * TAU;
  if (x > PI) x -= TAU;
  let term = x, sum = x;
  for (let k = 1; k < 16; k++) { term = -term * x * x / ((2 * k) * (2 * k + 1)); sum += term; }
  SIN[i] = sum;
}
export function dsin(a) {
  const u = a * (TRIG_N / TAU);
  const f = Math.floor(u);
  let i = f % TRIG_N;
  if (i < 0) i += TRIG_N;
  const t = u - f;
  return SIN[i] + (SIN[i + 1] - SIN[i]) * t;
}
export const dcos = a => dsin(a + HALF_PI);
function datan(z) {
  const z2 = z * z;
  return z * (0.9998660 + z2 * (-0.3302995 + z2 * (0.1801410 + z2 * (-0.0851330 + z2 * 0.0208351))));
}
export function datan2(y, x) {
  const ax = Math.abs(x), ay = Math.abs(y);
  if (ax === 0 && ay === 0) return 0;
  let a = ax >= ay ? datan(ay / ax) : HALF_PI - datan(ax / ay);
  if (x < 0) a = PI - a;
  return y < 0 ? -a : a;
}
export function dsqrt(x) {
  if (!(x > 0)) return 0;
  let y = x, g = 1;
  while (y > 4) { y *= 0.25; g *= 2; }
  while (y < 0.25) { y *= 4; g *= 0.5; }
  let r = 0.5 + 0.5 * y;
  for (let i = 0; i < 6; i++) r = 0.5 * (r + y / r);
  return r * g;
}
// e^-k for small k (only used for per-substep damping)
const decay = k => 1 / (1 + k + k * k * 0.5);

// ---------- seeded random (sfc32, same generator as Bomber) ----------
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

// ---------- inputs ----------
// One integer per tick: steer -100..100, gas 0..10, brake 0..10, and three buttons pressed this tick.
export function packInput(steer, gas, brake, fire, bomb, boost) {
  const s = clamp(Math.round(steer * 100), -100, 100) + 100;
  const g = clamp(Math.round(gas * 10), 0, 10), b = clamp(Math.round(brake * 10), 0, 10);
  return s | (g << 8) | (b << 12) | (fire ? 1 << 16 : 0) | (bomb ? 1 << 17 : 0) | (boost ? 1 << 18 : 0);
}
export function unpackInput(u) {
  return {
    steer: ((u & 0xff) - 100) / 100, gas: ((u >> 8) & 0xf) / 10, brake: ((u >> 12) & 0xf) / 10,
    fire: !!(u & (1 << 16)), bomb: !!(u & (1 << 17)), boost: !!(u & (1 << 18)),
  };
}
export const NO_INPUT = packInput(0, 0, 0, false, false, false);

// ---------- tracks ----------
// pts = spline control points (world units). Features are placed by lap fraction:
// ramps [f, hasPit], puddles/oils [f, lateral, radius], boosts [f, lateral],
// items [f, lateral, 'ammo'|'upgrade'], letter [f, lateral].
export const TRACKS = [
  {
    name: 'MUDDY ACRES', theme: 'farm',
    pts: [[180, 180], [560, 150], [920, 190], [960, 480], [920, 860], [680, 950], [580, 790], [460, 790], [360, 950], [170, 900], [140, 520]],
    ramps: [[0.30, true]], puddles: [[0.12, -12, 14], [0.62, 10, 13], [0.86, 0, 15]], oils: [], boosts: [[0.80, 0]],
    items: [[0.08, 14, 'ammo'], [0.22, -12, 'ammo'], [0.45, 0, 'upgrade'], [0.57, -14, 'ammo'], [0.72, 12, 'ammo'], [0.92, -10, 'ammo']], letter: [0.40, 18],
  },
  {
    name: 'SIDEWINDER CANYON', theme: 'desert',
    pts: [[160, 160], [520, 130], [880, 170], [960, 420], [780, 520], [560, 460], [390, 520], [390, 670], [560, 730], [860, 710], [950, 880], [700, 980], [300, 960], [130, 780], [140, 450]],
    ramps: [[0.10, true], [0.70, false]], puddles: [[0.47, 0, 14]], oils: [[0.32, -12, 11], [0.88, 14, 11]], boosts: [[0.60, -10], [0.93, 0]],
    items: [[0.05, 0, 'ammo'], [0.25, 12, 'ammo'], [0.42, -10, 'upgrade'], [0.55, 10, 'ammo'], [0.78, -14, 'ammo'], [0.97, 10, 'ammo']], letter: [0.36, -20],
  },
  {
    name: 'FROSTBITE PASS', theme: 'snow',
    pts: [[150, 150], [400, 140], [470, 420], [640, 420], [700, 150], [940, 170], [960, 480], [720, 560], [720, 700], [950, 760], [920, 960], [480, 960], [160, 900], [220, 620], [130, 400]],
    ramps: [[0.665, true]], puddles: [[0.17, 0, 14], [0.88, -10, 14]], oils: [[0.30, 10, 13], [0.45, -12, 13], [0.79, 8, 14]], boosts: [[0.53, 0], [0.95, 0]],
    items: [[0.05, 12, 'ammo'], [0.22, -10, 'ammo'], [0.38, 0, 'upgrade'], [0.50, 12, 'ammo'], [0.73, -12, 'ammo'], [0.84, 0, 'upgrade'], [0.92, 10, 'ammo']], letter: [0.58, 20],
  },
  {
    name: 'GATOR BAYOU', theme: 'swamp',
    pts: [[200, 140], [500, 220], [800, 140], [960, 300], [860, 500], [960, 700], [880, 950], [600, 880], [400, 960], [180, 900], [150, 760], [270, 620], [140, 420]],
    ramps: [[0.14, true]], puddles: [[0.08, 10, 15], [0.30, -12, 15], [0.38, 8, 14], [0.52, 0, 16], [0.66, -10, 15], [0.80, 12, 14], [0.92, -8, 15]], oils: [[0.45, -14, 11]], boosts: [[0.60, 0]],
    items: [[0.04, -12, 'ammo'], [0.20, 10, 'ammo'], [0.34, 0, 'upgrade'], [0.48, 12, 'ammo'], [0.70, 10, 'ammo'], [0.86, -12, 'ammo']], letter: [0.75, -20],
  },
  {
    name: 'STEEL CITY', theme: 'city',
    pts: [[150, 150], [950, 150], [950, 430], [660, 450], [660, 650], [950, 670], [950, 950], [150, 950], [150, 680], [400, 620], [400, 420], [150, 380]],
    ramps: [[0.06, false], [0.62, true]], puddles: [[0.40, 10, 13]], oils: [[0.18, -12, 12], [0.48, 10, 12], [0.85, -10, 12]], boosts: [[0.12, 0], [0.71, -12], [0.71, 12]],
    items: [[0.03, -12, 'ammo'], [0.25, 0, 'ammo'], [0.33, 12, 'upgrade'], [0.53, -12, 'ammo'], [0.78, 0, 'ammo'], [0.90, 12, 'upgrade'], [0.95, -12, 'ammo']], letter: [0.44, -22],
  },
  {
    name: 'TIMBERLINE TRAIL', theme: 'forest',
    pts: [[140, 200], [380, 130], [600, 250], [820, 140], [980, 300], [850, 480], [980, 640], [900, 950], [640, 880], [520, 980], [300, 880], [150, 800], [170, 660], [270, 570], [240, 460], [120, 380]],
    ramps: [[0.70, true]], puddles: [[0.22, 0, 14], [0.55, 10, 14]], oils: [[0.40, -10, 11]], boosts: [[0.08, 0], [0.85, 0]],
    items: [[0.04, 10, 'ammo'], [0.16, -12, 'ammo'], [0.30, 0, 'upgrade'], [0.47, 12, 'ammo'], [0.62, -12, 'ammo'], [0.78, 10, 'ammo'], [0.92, -10, 'ammo']], letter: [0.34, 22],
  },
  {
    name: 'SANDBAR SPRINT', theme: 'beach',
    pts: [[200, 200], [700, 140], [970, 330], [900, 700], [960, 950], [560, 960], [470, 800], [370, 790], [260, 880], [150, 800], [120, 560]],
    ramps: [[0.12, true], [0.85, true]], puddles: [[0.30, -10, 15], [0.45, 12, 15], [0.65, 0, 14]], oils: [[0.55, -12, 11]], boosts: [[0.38, 0], [0.95, 0]],
    items: [[0.05, 12, 'ammo'], [0.22, -12, 'ammo'], [0.35, 0, 'upgrade'], [0.50, -10, 'ammo'], [0.70, 12, 'ammo'], [0.78, -12, 'upgrade'], [0.98, 10, 'ammo']], letter: [0.60, 22],
  },
  {
    name: 'MAGMA MOUNTAIN', theme: 'volcano',
    pts: [[150, 150], [450, 130], [540, 330], [420, 500], [600, 620], [800, 450], [740, 300], [800, 150], [960, 180], [980, 600], [880, 960], [480, 980], [300, 950], [160, 870], [130, 700], [130, 500]],
    ramps: [[0.47, true], [0.72, true]], puddles: [[0.20, 10, 14]], oils: [[0.12, -12, 12], [0.33, 10, 12], [0.60, -10, 12], [0.88, 12, 12]], boosts: [[0.05, 0], [0.55, 0]],
    items: [[0.02, 12, 'ammo'], [0.16, -12, 'ammo'], [0.27, 0, 'upgrade'], [0.40, 12, 'ammo'], [0.65, 0, 'ammo'], [0.80, -12, 'upgrade'], [0.93, 10, 'ammo']], letter: [0.36, -22],
  },
];

function centripetalLoop(pts, steps) {
  const n = pts.length, out = [];
  const d = (a, b) => Math.max(1e-4, dsqrt(dsqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]))));
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    for (let k = 0; k < steps; k++) {
      const t = t1 + (t2 - t1) * k / steps;
      const P = [0, 1].map(j => {
        const A1 = p0[j] * (t1 - t) / (t1 - t0) + p1[j] * (t - t0) / (t1 - t0);
        const A2 = p1[j] * (t2 - t) / (t2 - t1) + p2[j] * (t - t1) / (t2 - t1);
        const A3 = p2[j] * (t3 - t) / (t3 - t2) + p3[j] * (t - t2) / (t3 - t2);
        const B1 = A1 * (t2 - t) / (t2 - t0) + A2 * (t - t0) / (t2 - t0);
        const B2 = A2 * (t3 - t) / (t3 - t1) + A3 * (t - t1) / (t3 - t1);
        return B1 * (t2 - t) / (t2 - t1) + B2 * (t - t1) / (t2 - t1);
      });
      out.push(P);
    }
  }
  return out;
}

function resample(poly, ds) {
  const n = poly.length;
  const cum = [0];
  for (let i = 1; i <= n; i++) {
    const a = poly[i - 1], b = poly[i % n];
    cum.push(cum[i - 1] + dsqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1])));
  }
  const total = cum[n];
  const count = Math.round(total / ds);
  const step = total / count;
  const out = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const s = k * step;
    while (cum[seg + 1] < s) seg++;
    const a = poly[seg], b = poly[(seg + 1) % n];
    const f = (s - cum[seg]) / (cum[seg + 1] - cum[seg]);
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return { pts: out, step };
}

export class Track {
  constructor(def, index) {
    this.def = def;
    this.index = index;
    this.hw = HW; this.curb = CURB; this.wall = WALL;
    this.drivable = HW + CURB;
    this.buildGeometry();
    this.buildFeatures();
  }

  buildGeometry() {
    let rs = resample(centripetalLoop(this.def.pts, 40), DS);
    let pts = rs.pts;
    // relax the curve so no corner is tighter than the trucks can take
    for (let it = 0; it < 60; it++) {
      const m = pts.length, nxt = new Array(m);
      for (let i = 0; i < m; i++) {
        const a = pts[(i - 1 + m) % m], b = pts[i], c = pts[(i + 1) % m];
        nxt[i] = [(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4];
      }
      pts = nxt;
    }
    rs = resample(pts, DS);
    const n = rs.pts.length;
    this.n = n; this.ds = rs.step; this.len = n * rs.step;
    const cx = this.cx = new Float64Array(n), cy = this.cy = new Float64Array(n);
    const tx = this.tx = new Float64Array(n), ty = this.ty = new Float64Array(n);
    const ang = this.ang = new Float64Array(n), kap = this.kap = new Float64Array(n);
    for (let i = 0; i < n; i++) { cx[i] = rs.pts[i][0]; cy[i] = rs.pts[i][1]; }
    for (let i = 0; i < n; i++) {
      const a = (i - 2 + n) % n, b = (i + 2) % n;
      const dx = cx[b] - cx[a], dy = cy[b] - cy[a];
      const l = dsqrt(dx * dx + dy * dy) || 1;
      tx[i] = dx / l; ty[i] = dy / l;
      ang[i] = datan2(ty[i], tx[i]);
    }
    const raw = new Float64Array(n);
    for (let i = 0; i < n; i++) raw[i] = wrapAngle(ang[(i + 1) % n] - ang[(i - 1 + n) % n]) / (2 * this.ds);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -3; k <= 3; k++) sum += raw[(i + k + n) % n];
      kap[i] = sum / 7;
    }
    this.grid = new Map();
    for (let i = 0; i < n; i++) {
      const key = Math.floor(cx[i] / 64) * 1000 + Math.floor(cy[i] / 64);
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key).push(i);
    }
  }

  nearest(x, y, hint) {
    const cx = this.cx, cy = this.cy, n = this.n;
    let best = -1, bd = Infinity;
    if (hint >= 0) {
      for (let k = -14; k <= 14; k++) {
        const i = (hint + k + n) % n;
        const dx = x - cx[i], dy = y - cy[i], d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = i; }
      }
      if (bd < (HW + 60) * (HW + 60)) return best;
    }
    const gx = Math.floor(x / 64), gy = Math.floor(y / 64);
    for (let r = 1; r <= 3 && best < 0; r++) {
      for (let ox = -r; ox <= r; ox++) for (let oy = -r; oy <= r; oy++) {
        const list = this.grid.get((gx + ox) * 1000 + gy + oy);
        if (!list) continue;
        for (const i of list) {
          const dx = x - cx[i], dy = y - cy[i], d2 = dx * dx + dy * dy;
          if (d2 < bd) { bd = d2; best = i; }
        }
      }
    }
    if (best < 0) {
      for (let i = 0; i < n; i++) {
        const dx = x - cx[i], dy = y - cy[i], d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = i; }
      }
    }
    return best;
  }
  lateral(x, y, i) { return (x - this.cx[i]) * -this.ty[i] + (y - this.cy[i]) * this.tx[i]; }
  wrapS(s) { s -= this.len * Math.floor(s / this.len); return s; }
  sAt(x, y, i) { return this.wrapS(i * this.ds + (x - this.cx[i]) * this.tx[i] + (y - this.cy[i]) * this.ty[i]); }
  idxAt(s) { return Math.floor(this.wrapS(s) / this.ds) % this.n; }
  posAt(s, d, out) {
    s = this.wrapS(s);
    const f = s / this.ds;
    const i = Math.floor(f) % this.n, j = (i + 1) % this.n, t = f - Math.floor(f);
    const x = this.cx[i] + (this.cx[j] - this.cx[i]) * t, y = this.cy[i] + (this.cy[j] - this.cy[i]) * t;
    const nx = -(this.ty[i] + (this.ty[j] - this.ty[i]) * t), ny = this.tx[i] + (this.tx[j] - this.tx[i]) * t;
    out = out || {};
    out.x = x + nx * d; out.y = y + ny * d;
    out.a = datan2(-nx, ny);
    return out;
  }
  maxCurv(i, dist) {
    const cnt = Math.max(1, Math.round(dist / this.ds));
    let m = 0;
    for (let k = 0; k < cnt; k++) { const v = Math.abs(this.kap[(i + k) % this.n]); if (v > m) m = v; }
    return m;
  }
  buildFeatures() {
    const def = this.def, L = this.len;
    const P = (f, d) => this.posAt(f * L, d || 0);
    this.puddles = (def.puddles || []).map(([f, d, r]) => Object.assign(P(f, d), { r: r || 14, s: f * L, d: d || 0, kind: 'puddle' }));
    this.oils = (def.oils || []).map(([f, d, r]) => Object.assign(P(f, d), { r: r || 11, s: f * L, d: d || 0, kind: 'oil' }));
    this.boosts = (def.boosts || []).map(([f, d]) => ({ s0: f * L, s1: f * L + 26, d: d || 0, w: 14 }));
    this.ramps = (def.ramps || []).map(([f, pit]) => ({ s0: f * L, s1: f * L + 22, pit: pit ? { s0: f * L + 30, s1: f * L + 78 } : null }));
    this.hazards = this.puddles.concat(this.oils);
  }
  inRange(s, a, b) {
    const rel = s - a - this.len * Math.floor((s - a) / this.len);
    return rel <= b - a;
  }
  surfaceAt(s, d, x, y) {
    const res = { puddle: false, oil: false, boost: false, ramp: null, pit: false };
    for (const h of this.hazards) {
      const dx = x - h.x, dy = y - h.y;
      if (dx * dx + dy * dy < h.r * h.r) res[h.kind] = true;
    }
    for (const b of this.boosts) if (this.inRange(s, b.s0, b.s1) && Math.abs(d - b.d) < b.w) res.boost = true;
    for (const r of this.ramps) {
      if (this.inRange(s, r.s0, r.s1)) res.ramp = { r, t: this.wrapS(s - r.s0) / (r.s1 - r.s0) };
      if (r.pit && this.inRange(s, r.pit.s0, r.pit.s1)) res.pit = true;
    }
    return res;
  }
}

const trackCache = [];
export function getTrack(i) {
  i %= TRACKS.length;
  if (!trackCache[i]) trackCache[i] = new Track(TRACKS[i], i);
  return trackCache[i];
}

// ---------- trucks ----------
class Car {
  constructor(race, slot, opts) {
    this.race = race;
    this.track = race.track;
    this.slot = slot;
    this.isPlayer = !!opts.isPlayer;
    this.aiDriven = !!opts.ai;
    this.level = opts.level || 0;
    this.skill = opts.skill || 1;
    this.upgrades = opts.upgrades || { engine: 0, tires: 0, turbo: 0 };
    this.ammo = opts.ammo || { missile: 0, bomb: 0, nitro: 0 };
    this.ai = new AI(this, opts.lane || 0, opts.aggression || 0.2, race.G.rand);
    this.aiOut = null;
    this.rubber = 1;
    this.computeStats();
  }
  computeStats() {
    const T = TRUCK;
    if (this.isPlayer) {
      const u = this.upgrades;
      this.stats = { vmax: T.vmax + T.vmaxPerEngine * u.engine, drag: T.drag + T.dragPerTurbo * u.turbo,
        grip: T.grip + T.gripPerTires * u.tires, turn: T.turn + T.turnPerTires * u.tires };
    } else {
      const L = this.level;
      this.stats = { vmax: Math.min(245, (154 + L * 5.4) * this.skill), drag: T.drag + Math.min(0.8, L * 0.05),
        grip: T.grip + 1 + Math.min(8, L * 0.5), turn: T.turn + Math.min(0.6, L * 0.04) };
    }
  }
  place(s, d) {
    const T = this.track, p = T.posAt(s, d);
    this.x = p.x; this.y = p.y; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.idx = T.nearest(this.x, this.y, -1);
    this.h = T.ang[this.idx];
    this.s = T.sAt(this.x, this.y, this.idx);
    this.d = T.lateral(this.x, this.y, this.idx);
    this.lap = this.s > T.len * 0.5 ? -1 : 0;
    this.steer = 0;
    this.spinT = 0; this.spinDir = 1; this.invulnT = 0; this.boostT = 0; this.slipT = 0;
    this.onRamp = false; this.inPit = false;
    this.finished = false; this.finishTime = 0; this.place = 0;
    this.wrongT = 0; this.wallT = 0; this.stuckT = 0;
    this.fireCd = 0; this.bombCd = 0;
    this.lastLapStart = 0; this.bestLap = Infinity;
    this.vF = 0; this.vL = 0; this.brakeIn = 0;
    this.surf = { puddle: false, oil: false, boost: false, ramp: null, pit: false };
    this.splashT = 0;
  }
  get progress() { return this.lap * this.track.len + this.s; }

  hit(kind) {
    if (this.invulnT > 0) return false;
    this.spinT = kind === 'lava' ? 0.9 : 1.15;
    this.spinDir = this.race.G.rand() < 0.5 ? -1 : 1;
    this.vz = kind === 'lava' ? 70 : 125;
    this.z = Math.max(this.z, 1);
    this.vx *= 0.25; this.vy *= 0.25;
    this.invulnT = 2.3;
    this.boostT = 0;
    return true;
  }

  step(h, inp) {
    const T = this.track, st = this.stats, race = this.race;
    this.spinT -= h; this.invulnT -= h; this.boostT -= h; this.slipT -= h;
    this.fireCd -= h; this.bombCd -= h; this.wallT -= h; this.splashT -= h;
    this.brakeIn = inp.brake;
    const stunned = this.spinT > 0;
    const air = this.z > 0.6 && !this.onRamp;
    const surf = this.surf;

    const steerTarget = stunned ? 0 : clamp(inp.steer, -1, 1);
    this.steer = approach(this.steer, steerTarget, h * 11);
    const fwd0 = this.vx * dcos(this.h) + this.vy * dsin(this.h);
    const sp = Math.abs(fwd0);
    let turn = st.turn * this.steer * Math.min(1, sp / 32) * (1 - 0.28 * Math.min(1, sp / st.vmax));
    if (fwd0 < -2) turn = -turn;
    if (air) turn *= 0.3;
    if (stunned) {
      // Spin about 13 rad/s, but pace it so the spin ends facing down the track (like R.C. Pro-Am's
      // crash reset) instead of wherever the fixed rate happened to stop (that was ~136° off).
      const nom = this.spinDir * 13 * this.spinT;
      const left = nom + wrapAngle(T.ang[this.idx] - (this.h + nom));
      this.h = wrapAngle(this.h + left * Math.min(1, h / this.spinT));
    } else this.h = wrapAngle(this.h + turn * h);

    const fx = dcos(this.h), fy = dsin(this.h);
    let vF = this.vx * fx + this.vy * fy;
    let vL = -this.vx * fy + this.vy * fx;
    const boosting = this.boostT > 0;
    const vmax = st.vmax * (boosting ? 1.34 : 1) * this.rubber;
    if (!air) {
      const thr = stunned ? 0 : inp.gas, brk = stunned ? 0 : inp.brake;
      const k = st.drag * (boosting ? 1.8 : 1);
      if (boosting) vF += k * (vmax - vF) * h;
      else if (thr > 0.01 && vF < vmax) vF += k * (vmax - vF) * thr * h;
      else vF -= vF * (vF > vmax ? 1.6 : 0.7) * h;
      if (brk > 0.01) {
        if (vF > 4) vF = Math.max(0, vF - 280 * brk * h);
        else vF = Math.max(-48, vF - 110 * brk * h);
      }
      if (surf.puddle) vF -= vF * 1.6 * h;
      if (this.inPit) vF -= vF * 3.2 * h;
      let grip = st.grip;
      if (surf.oil || this.slipT > 0) grip *= 0.14;
      if (surf.puddle) grip *= 0.6;
      if (stunned) grip *= 0.25;
      vL *= decay(grip * h);
    }
    this.vF = vF; this.vL = vL;
    this.vx = fx * vF - fy * vL;
    this.vy = fy * vF + fx * vL;
    this.x += this.vx * h;
    this.y += this.vy * h;

    this.idx = T.nearest(this.x, this.y, this.idx);
    const prevS = this.s;
    this.s = T.sAt(this.x, this.y, this.idx);
    this.d = T.lateral(this.x, this.y, this.idx);
    if (prevS > T.len * 0.75 && this.s < T.len * 0.25) this.lap++;
    else if (prevS < T.len * 0.25 && this.s > T.len * 0.75) this.lap--;

    // walls: bounce; glancing contact costs little, head-on costs a lot
    const lim = T.drivable - 5;
    if (Math.abs(this.d) > lim) {
      const nx = -T.ty[this.idx], ny = T.tx[this.idx];
      const sg = sgn(this.d);
      const over = Math.abs(this.d) - lim;
      this.x -= nx * sg * over; this.y -= ny * sg * over;
      const vn = this.vx * nx + this.vy * ny;
      if (vn * sg > 0) {
        const loss = Math.min(0.4, Math.abs(vn) / 320);
        this.vx -= nx * vn * 1.45; this.vy -= ny * vn * 1.45;
        this.vx *= 1 - loss; this.vy *= 1 - loss;
        const ta = T.ang[this.idx];
        const along = dcos(this.h - ta) >= 0 ? ta : ta + PI;
        this.h = wrapAngle(this.h + wrapAngle(along - this.h) * 0.25);
        if (Math.abs(vn) > 25 && this.wallT <= 0) {
          this.wallT = 0.25;
          race.emit({ t: 'wall', car: this.slot, impact: Math.abs(vn), x: this.x + nx * sg * 5, y: this.y + ny * sg * 5 });
        }
      }
      this.d = sg * lim;
    }

    const ns = T.surfaceAt(this.s, this.d, this.x, this.y);
    if (this.z < 1) {
      if (ns.oil && !surf.oil) { this.slipT = 0.7; this.h += (race.G.rand() - 0.5) * 0.5; race.emit({ t: 'oil', car: this.slot }); }
      if (ns.puddle && !surf.puddle) race.emit({ t: 'puddle', car: this.slot, x: this.x, y: this.y });
      if (ns.boost && !surf.boost) { this.boostT = Math.max(this.boostT, 0.9); race.emit({ t: 'boostpad', car: this.slot }); }
    }
    this.surf = ns;

    if (ns.ramp && this.z <= 6 * ns.ramp.t + 0.6 && this.vz <= 0) {
      this.onRamp = true; this.z = 6 * ns.ramp.t; this.vz = 0;
    } else if (this.onRamp) {
      this.onRamp = false;
      if (vF > 35) { this.vz = vF * 0.42; race.emit({ t: 'jump', car: this.slot }); }
    }
    if (!this.onRamp && (this.z > 0 || this.vz > 0)) {
      this.vz -= GRAV * h;
      this.z += this.vz * h;
      if (this.z <= 0) {
        this.z = 0;
        const impact = -this.vz;
        this.vz = impact > 90 ? impact * 0.22 : 0;
        if (impact > 60) race.emit({ t: 'land', car: this.slot, impact, x: this.x, y: this.y });
      }
    }
    this.inPit = !!(ns.pit && this.z <= 0.5);
    if (this.inPit) race.onPit(this);

    if (dcos(this.h - T.ang[this.idx]) < -0.4 && Math.abs(vF) > 15) this.wrongT += h; else this.wrongT = Math.max(0, this.wrongT - h * 2);
    if (Math.abs(vF) < 10 && !stunned) this.stuckT += h; else this.stuckT = 0;
  }
}

// ---------- AI driver ----------
class AI {
  constructor(car, lane, aggression, rand) {
    this.car = car;
    this.baseLane = lane; this.lane = lane;
    this.phase = rand() * 10;
    this.aggr = aggression;
    this.t = 0;
    this.weaponT = rand();
    this.reverseT = 0;
  }
  think(dt) {
    const c = this.car, T = c.track, race = c.race, rand = race.G.rand;
    this.t += dt;
    const out = { steer: 0, gas: 1, brake: 0, fire: false, bomb: false, boost: false };
    const sp = c.vF;
    const lim = T.drivable - 13;
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      out.gas = 0; out.brake = 1;
      out.steer = -sgn(wrapAngle(T.ang[c.idx] - c.h));
      return out;
    }
    // facing the wrong way after a spin: pivot around (arcade assist)
    const toward = wrapAngle(T.ang[c.idx] - c.h);
    if (Math.abs(toward) > 1.7 && Math.abs(sp) < 80 && c.spinT <= 0 && c.z < 1) {
      c.h = wrapAngle(c.h + sgn(toward) * Math.min(Math.abs(toward), 5 * dt));
      out.gas = 0.25; out.steer = sgn(toward);
      return out;
    }
    if (c.stuckT > 1.0 && dcos(c.h - T.ang[c.idx]) < 0.3) { this.reverseT = 0.7; c.stuckT = 0; }

    let lane = this.baseLane + dsin(this.t * 0.45 + this.phase) * 7;
    const ahead = s => T.wrapS(s - c.s);
    for (const hz of T.hazards) {
      const a = ahead(hz.s);
      if (a > 10 && a < 150 && Math.abs(hz.d - lane) < hz.r + 12) lane = hz.d + (lane >= hz.d ? 1 : -1) * (hz.r + 15);
    }
    for (const b of race.bombs) {
      const a = ahead(b.s);
      if (a > 5 && a < 120 && Math.abs(b.d - lane) < 20) lane = b.d + (lane >= b.d ? 1 : -1) * 22;
    }
    for (const o of race.cars) {
      if (o === c) continue;
      const a = ahead(o.s);
      if (a > 2 && a < 40 && Math.abs(o.d - lane) < 14 && o.vF < sp) lane = o.d + (lane >= o.d ? 1 : -1) * 18;
    }
    for (const p of race.pickups) {
      if (!p.active || p.kind !== 'ammo') continue;
      const a = ahead(p.s);
      if (a > 20 && a < 110 && Math.abs(p.d - lane) < 22) { lane = p.d; break; }
    }
    let rampAhead = false;
    for (const r of T.ramps) {
      const a = ahead(r.s0);
      if (a > 0 && a < 170) { rampAhead = true; lane = lane * 0.4; }
    }
    lane = clamp(lane, -lim, lim);
    this.lane = approach(this.lane, lane, dt * 40);

    const look = 24 + Math.max(0, sp) * 0.42;
    const tp = T.posAt(c.s + look, this.lane);
    const diff = wrapAngle(datan2(tp.y - c.y, tp.x - c.x) - c.h);
    out.steer = clamp(diff * 2.8, -1, 1);

    const kmax = T.maxCurv(c.idx, 30 + Math.max(0, sp) * 0.8);
    const turnCap = c.stats.turn * 0.72 * 0.86;
    const vLimit = kmax > 1e-4 ? Math.max(70, turnCap / kmax) : 1e9;
    if (!rampAhead) {
      if (sp > vLimit * 1.1) { out.gas = 0; out.brake = 0.6; } else if (sp > vLimit) out.gas = 0.2;
    }
    if (Math.abs(diff) > 1.2) out.gas = 0.5;

    this.weaponT -= dt;
    if (this.weaponT <= 0 && race.phase === 'race' && !c.finished) {
      this.weaponT = 0.5;
      for (const o of race.cars) {
        if (o === c || o.finished) continue;
        const gap = o.progress - c.progress;
        const pref = o.isPlayer ? 1.25 : 0.6;
        if (gap > 40 && gap < 230 && Math.abs(o.d - c.d) < 18 && c.fireCd <= 0 && rand() < this.aggr * pref) out.fire = true;
        if (gap < -15 && gap > -90 && Math.abs(o.d - c.d) < 18 && c.bombCd <= 0 && rand() < this.aggr * pref * 0.7) out.bomb = true;
      }
      if (c.ammo.nitro > 0 && kmax < 0.004 && rand() < 0.15) out.boost = true;
    }
    return out;
  }
}

// ---------- race ----------
const AMMO_TYPES = [['missile', 40], ['bomb', 30], ['nitro', 30]];

class Race {
  constructor(G, trackIndex, level) {
    this.G = G;
    this.index = trackIndex % TRACKS.length;
    this.def = TRACKS[this.index];
    this.track = getTrack(this.index);
    this.level = level;
    this.cars = []; this.bombs = []; this.missiles = []; this.pickups = [];
    this.phase = 'intro'; this.phaseT = 0; this.time = 0; this.countBeep = 4;
    this.finishOrder = 0; this.score = 0; this.hits = 0; this.upgradesGot = []; this.gotLetter = false;
    this.nextId = 1;
    this.setupCars();
    this.setupPickups();
  }
  emit(e) { this.G.ev.push(e); }

  setupCars() {
    const G = this.G, rand = G.rand;
    const skills = [1.02, 1.0, 0.965];
    for (let i = skills.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = skills[i]; skills[i] = skills[j]; skills[j] = t; }
    const lanes = [-12, 12, -12, 12];
    const slots = [[-24, -13], [-24, 13], [-58, -13], [-58, 13]];
    const L = this.track.len;
    for (let i = 0; i < 3; i++) {
      const c = new Car(this, i, { ai: true, level: this.level, skill: skills[i], lane: lanes[i],
        aggression: 0.035 + Math.min(0.12, this.level * 0.01), ammo: { missile: 99, bomb: 99, nitro: 1 } });
      c.place(L + slots[i][0], slots[i][1]);
      this.cars.push(c);
    }
    const pl = new Car(this, 3, { isPlayer: !G.demo, ai: G.demo, level: this.level, upgrades: G.upgrades, ammo: G.ammo, lane: 8, aggression: 0.35 });
    if (G.demo) { pl.level = this.level + 1; pl.computeStats(); }
    pl.place(L + slots[3][0], slots[3][1]);
    this.cars.push(pl);
    this.player = pl;
  }

  pickAmmo() {
    let r = this.G.rand() * 100;
    for (const [t, w] of AMMO_TYPES) { r -= w; if (r <= 0) return t; }
    return 'missile';
  }
  pickUpgrade() {
    const u = this.G.upgrades, rand = this.G.rand;
    const opts = ['engine', 'tires', 'turbo'].filter(k => u[k] < MAX_UPGRADE);
    if (!opts.length) return 'nitro';
    const min = Math.min(...opts.map(k => u[k]));
    const low = opts.filter(k => u[k] === min);
    return rand() < 0.7 ? low[Math.floor(rand() * low.length)] : opts[Math.floor(rand() * opts.length)];
  }
  setupPickups() {
    const T = this.track, G = this.G;
    for (const [f, d, kind] of this.def.items || []) {
      const p = T.posAt(f * T.len, d);
      this.pickups.push({ id: this.nextId++, s: f * T.len, d, x: p.x, y: p.y, kind, type: kind === 'upgrade' ? this.pickUpgrade() : this.pickAmmo(), active: true, respawnT: 0 });
    }
    this.letter = null;
    if (!G.demo && this.def.letter) {
      const [f, d] = this.def.letter;
      const p = T.posAt(f * T.len, d);
      this.letter = { x: p.x, y: p.y, s: f * T.len, ch: LETTER_WORD[G.letters % LETTER_WORD.length], active: true };
    }
  }

  // one 60 Hz tick
  tick(inp) {
    const G = this.G, pl = this.player;
    this.phaseT += TICK;
    if (this.phase === 'intro' && this.phaseT >= INTRO) { this.phase = 'countdown'; this.phaseT = 0; }
    if (this.phase === 'countdown') {
      const n = 3 - Math.floor(this.phaseT / 0.8);
      if (n < this.countBeep && n > 0) { this.countBeep = n; this.emit({ t: 'count', n }); }
      if (this.phaseT >= COUNT) { this.phase = 'race'; this.phaseT = 0; this.emit({ t: 'go' }); }
    }
    const moving = this.phase === 'race' || this.phase === 'finish';
    if (this.phase === 'race' && !G.demo && !pl.finished) {
      if (inp.fire) this.fireMissile(pl);
      if (inp.bomb) this.dropBomb(pl);
      if (inp.boost) this.useNitro(pl);
    }
    if (moving) {
      for (const c of this.cars) {
        const ai = c.aiDriven || c.finished || this.phase !== 'race';
        if (ai) {
          c.aiOut = c.ai.think(TICK);
          if (this.phase === 'race' && !c.finished) {
            if (c.aiOut.fire) this.fireMissile(c);
            if (c.aiOut.bomb) this.dropBomb(c);
            if (c.aiOut.boost) this.useNitro(c);
          }
        } else c.aiOut = null;
      }
      for (let k = 0; k < SUB; k++) this.substep(H, inp);
    }
    if (this.phase === 'finish' && this.phaseT >= AFTER) return true;
    return false;
  }

  substep(h, inp) {
    if (this.phase === 'race') this.time += h;
    const pl = this.player;
    for (const c of this.cars) {
      const ci = c.aiOut || inp;
      if (!c.isPlayer && !this.G.demo && this.phase === 'race') c.rubber = clamp(1 - (c.progress - pl.progress) / 4200, 0.93, 1.07);
      else c.rubber = 1;
      const lapBefore = c.lap;
      c.step(h, ci);
      if (c.lap !== lapBefore) this.onLap(c, lapBefore);
    }
    this.collideCars();
    this.updateMissiles(h);
    this.updateBombs(h);
    this.updatePickups(h);
  }

  collideCars() {
    const cars = this.cars;
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        if (Math.abs(a.z - b.z) > 7) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy, R = 11;
        if (d2 >= R * R || d2 < 1e-6) continue;
        const d = dsqrt(d2), nx = dx / d, ny = dy / d, push = (R - d) / 2;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel < 0) {
          const imp = -rel * 0.65;
          a.vx -= nx * imp; a.vy -= ny * imp;
          b.vx += nx * imp; b.vy += ny * imp;
          if (-rel > 30) this.emit({ t: 'bump', a: a.slot, b: b.slot });
        }
      }
    }
  }

  fireMissile(c) {
    if (c.fireCd > 0) return;
    if (c.ammo.missile <= 0) { if (c.isPlayer) { this.emit({ t: 'empty' }); c.fireCd = 0.3; } return; }
    c.ammo.missile--;
    c.fireCd = c.isPlayer ? 0.35 : 4.5;
    const T = this.track;
    // player missiles home hard; rival missiles drift slowly so they can be dodged
    const m = { id: this.nextId++, owner: c, s: T.wrapS(c.s + 14), d: c.d, speed: Math.max(c.vF, 60) + 215, life: 2.4, z: 4,
      retarget: 0, target: null, homing: c.isPlayer ? 130 : 48 };
    const p = T.posAt(m.s, m.d);
    m.x = p.x; m.y = p.y; m.a = p.a;
    this.missiles.push(m);
    this.emit({ t: 'missile', car: c.slot });
  }
  dropBomb(c) {
    if (c.bombCd > 0) return;
    if (c.ammo.bomb <= 0) { if (c.isPlayer) { this.emit({ t: 'empty' }); c.bombCd = 0.3; } return; }
    c.ammo.bomb--;
    c.bombCd = c.isPlayer ? 0.4 : 6;
    const T = this.track;
    const x = c.x - dcos(c.h) * 13, y = c.y - dsin(c.h) * 13;
    const i = T.nearest(x, y, c.idx);
    const d = clamp(T.lateral(x, y, i), -T.drivable + 6, T.drivable - 6);
    const s = T.sAt(x, y, i);
    const p = T.posAt(s, d);
    this.bombs.push({ id: this.nextId++, owner: c, x: p.x, y: p.y, s, d, armT: 0.6, life: 25 });
    this.emit({ t: 'bombdrop', car: c.slot });
  }
  useNitro(c) {
    if (c.boostT > 0.3) return;
    if (c.ammo.nitro <= 0) { if (c.isPlayer) this.emit({ t: 'empty' }); return; }
    c.ammo.nitro--;
    c.boostT = 1.7;
    this.emit({ t: 'nitro', car: c.slot });
  }

  damage(car, kind, by) {
    if (!car.hit(kind)) return;
    this.emit({ t: 'hit', car: car.slot, kind, x: car.x, y: car.y });
    if (by && by.isPlayer && !this.G.demo && car !== by) {
      const pts = kind === 'missile' ? POINTS.missileHit : POINTS.bombHit;
      this.score += pts;
      this.hits++;
      this.emit({ t: 'points', x: car.x, y: car.y, pts });
    }
  }

  updateMissiles(h) {
    const T = this.track;
    for (const m of this.missiles) {
      m.life -= h;
      m.s = T.wrapS(m.s + m.speed * h);
      m.retarget -= h;
      if (m.retarget <= 0) {
        m.retarget = 0.1;
        m.target = null;
        let best = 280;
        for (const c of this.cars) {
          if (c === m.owner) continue;
          const gap = T.wrapS(c.s - m.s);
          if (gap < best) { best = gap; m.target = c; }
        }
      }
      if (m.target) m.d = approach(m.d, m.target.d, m.homing * h);
      m.d = clamp(m.d, -T.drivable + 4, T.drivable - 4);
      const p = T.posAt(m.s, m.d);
      m.x = p.x; m.y = p.y; m.a = p.a;
      for (const c of this.cars) {
        if ((c === m.owner && m.life > 2.0) || c.z > 14) continue;
        const dx = c.x - m.x, dy = c.y - m.y;
        if (dx * dx + dy * dy < 121) {
          m.life = -1;
          this.emit({ t: 'explode', x: m.x, y: m.y, big: true });
          this.damage(c, 'missile', m.owner);
          break;
        }
      }
      if (m.life > 0) {
        for (const b of this.bombs) {
          const dx = b.x - m.x, dy = b.y - m.y;
          if (dx * dx + dy * dy < 81) { m.life = -1; b.life = -1; this.emit({ t: 'explode', x: b.x, y: b.y, big: true }); break; }
        }
      }
      if (m.life <= 0 && m.life > -0.5) { this.emit({ t: 'explode', x: m.x, y: m.y, big: false }); m.life = -1; }
    }
    this.missiles = this.missiles.filter(m => m.life > 0);
  }
  updateBombs(h) {
    for (const b of this.bombs) {
      b.armT -= h;
      b.life -= h;
      if (b.life <= 0) continue;
      for (const c of this.cars) {
        if (c.z > 6 || (c === b.owner && b.armT > 0)) continue;
        const dx = c.x - b.x, dy = c.y - b.y;
        if (dx * dx + dy * dy < 100) {
          b.life = -1;
          this.emit({ t: 'explode', x: b.x, y: b.y, big: true });
          this.damage(c, 'bomb', b.owner);
          break;
        }
      }
    }
    this.bombs = this.bombs.filter(b => b.life > 0);
  }
  updatePickups(h) {
    for (const p of this.pickups) {
      if (!p.active) {
        p.respawnT -= h;
        if (p.respawnT <= 0 && p.kind === 'ammo') { p.active = true; p.type = this.pickAmmo(); }
        continue;
      }
      for (const c of this.cars) {
        if (c.z > 12 || (!c.isPlayer && p.kind === 'upgrade')) continue;
        const dx = c.x - p.x, dy = c.y - p.y;
        if (dx * dx + dy * dy < 169) { this.collect(c, p); break; }
      }
    }
    const L = this.letter;
    if (L && L.active) {
      const c = this.player, dx = c.x - L.x, dy = c.y - L.y;
      if (dx * dx + dy * dy < 196 && c.z < 14) this.collectLetter();
    }
  }
  collect(c, p) {
    p.active = false;
    p.respawnT = 6;
    if (!c.isPlayer) return;
    const G = this.G;
    if (p.kind === 'upgrade' && p.type !== 'nitro') {
      G.upgrades[p.type] = Math.min(MAX_UPGRADE, G.upgrades[p.type] + 1);
      c.computeStats();
      this.upgradesGot.push(p.type);
      this.score += POINTS.upgrade;
      this.emit({ t: 'upgrade', type: p.type, x: p.x, y: p.y });
    } else {
      const add = p.type === 'nitro' ? 1 : 2;
      c.ammo[p.type] = Math.min(AMMO_CAP[p.type], c.ammo[p.type] + add);
      this.score += POINTS.pickup;
      this.emit({ t: 'pickup', type: p.type, add, x: p.x, y: p.y });
    }
  }
  collectLetter() {
    const L = this.letter, G = this.G;
    L.active = false;
    G.letters++;
    this.gotLetter = true;
    this.score += POINTS.letter;
    let word = false;
    if (G.letters >= LETTER_WORD.length) {
      G.letters = 0;
      G.lives++;
      this.score += POINTS.word;
      word = true;
    }
    this.emit({ t: 'letter', ch: L.ch, word, x: L.x, y: L.y });
  }

  onLap(c, before) {
    if (c.lap > before && c.lap >= 1) {
      const lt = this.time - c.lastLapStart;
      if (lt < c.bestLap) c.bestLap = lt;
    }
    if (c.lap > before) c.lastLapStart = this.time;
    if (c.lap >= LAPS && !c.finished) {
      c.finished = true;
      c.finishTime = this.time;
      c.place = ++this.finishOrder;
      if (c === this.player && !this.G.demo) {
        this.phase = 'finish';
        this.phaseT = 0;
        this.emit({ t: 'finish', place: c.place });
      }
    }
    if (c === this.player && !this.G.demo && c.lap > before && !c.finished && this.phase === 'race' && c.lap >= 1) {
      this.emit({ t: c.lap === LAPS - 1 ? 'finallap' : 'lap', lap: c.lap + 1 });
    }
    if (!this.G.demo && this.phase === 'race' && !this.player.finished && this.cars.filter(k => !k.isPlayer && k.finished).length >= 3) {
      const p = this.player;
      p.finished = true; p.place = 4; p.finishTime = Infinity;
      this.phase = 'finish';
      this.phaseT = 0;
      this.emit({ t: 'tooslow' });
    }
  }
  onPit(c) {
    if (TRACKS[this.index].theme === 'volcano') {
      this.emit({ t: 'explode', x: c.x, y: c.y, big: false });
      this.damage(c, 'lava', null);
      return;
    }
    if (c.splashT <= 0) { c.splashT = 0.12; this.emit({ t: 'splash', car: c.slot, x: c.x, y: c.y }); }
  }

  standings() {
    return this.cars.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.place - b.place;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
  }
  playerRank() {
    return this.player.finished ? this.player.place : this.standings().indexOf(this.player) + 1;
  }
}

// ---------- game: a run of races until the trucks run out ----------
export function createGame(board, seedHex, opts = {}) {
  if (!BOARDS.includes(board)) throw new Error('bad board');
  return {
    board, seed: seedHex, rand: makeRng(seedHex), demo: !!opts.demo, demoLevel: opts.level || 0,
    state: 'ready', tick: 0, raceNo: 0, races: 0, lives: START_LIVES, score: 0, letters: 0, wins: 0,
    upgrades: { engine: 0, tires: 0, turbo: 0 }, ammo: { missile: 2, bomb: 1, nitro: 1 },
    race: null, last: null,
    ev: [],
  };
}

export function startRace(G) {
  if (G.state !== 'ready') return false;
  G.ammo.missile = Math.max(G.ammo.missile, 2);
  G.ammo.bomb = Math.max(G.ammo.bomb, 1);
  G.ammo.nitro = Math.max(G.ammo.nitro, 1);
  G.race = new Race(G, G.raceNo % TRACKS.length, G.demo ? G.demoLevel : G.raceNo);
  G.races++;
  G.state = 'race';
  G.ev.push({ t: 'raceStart', track: G.race.index });
  return true;
}

function endRace(G) {
  const R = G.race, pl = R.player;
  const place = pl.place || R.playerRank();
  const placePts = POINTS.place[place - 1] || 0;
  const qualified = place <= 3;
  G.score = Math.min(999999999, G.score + placePts + R.score);
  if (place === 1) G.wins++;
  let circuit = false;
  if (qualified) {
    G.raceNo++;
    if (G.raceNo % TRACKS.length === 0) { G.score = Math.min(999999999, G.score + POINTS.circuit); circuit = true; }
  } else G.lives--;
  G.last = { place, placePts, raceScore: R.score, qualified, circuit, hits: R.hits };
  G.state = G.lives > 0 ? 'ready' : 'over';
  G.ev.push({ t: G.state === 'over' ? 'over' : 'raceEnd' });
}

// Advance one tick. Only does anything while a race is running.
export function step(G, u) {
  if (G.state !== 'race') return;
  G.tick++;
  const done = G.race.tick(unpackInput(u));
  if (done) endRace(G);
  else if (G.tick >= MAX_TICKS) { G.state = 'over'; G.ev.push({ t: 'over' }); }
}

// Replays a whole run. segs = ticks played in each race, inputs = one packed input per tick.
export function runReplay({ board, seed, segs, inputs }) {
  const G = createGame(board, seed);
  let i = 0;
  for (const n of segs) {
    if (!startRace(G)) throw new Error('replay has more races than the game');
    for (let k = 0; k < n; k++) step(G, inputs[i++]);
    G.ev.length = 0;
    if (G.state === 'race') break;
  }
  if (i !== inputs.length) throw new Error('replay length mismatch');
  return G;
}
