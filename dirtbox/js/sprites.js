// Voxel models rendered into isometric pixel sprites ("sprite stacking"), cached per angle.
import { G } from './ns.js';

const U = G.U;
const OUTLINE = [20, 14, 26];

function makeVox(L, W, H) {
  return { L, W, H, data: new Uint8Array(L * W * H), pal: [null] };
}
function color(vox, hex) {
  const rgb = Array.isArray(hex) ? hex : U.hex(hex);
  for (let i = 1; i < vox.pal.length; i++) {
    const p = vox.pal[i];
    if (p[0] === rgb[0] && p[1] === rgb[1] && p[2] === rgb[2]) return i;
  }
  vox.pal.push(rgb);
  return vox.pal.length - 1;
}
function set(vox, x, y, z, ci) {
  x = Math.round(x); y = Math.round(y); z = Math.round(z);
  if (x < 0 || y < 0 || z < 0 || x >= vox.L || y >= vox.W || z >= vox.H) return;
  vox.data[(z * vox.W + y) * vox.L + x] = ci;
}
function get(vox, x, y, z) {
  if (x < 0 || y < 0 || z < 0 || x >= vox.L || y >= vox.W || z >= vox.H) return 0;
  return vox.data[(z * vox.W + y) * vox.L + x];
}

// Render a voxel model at heading `angle` (radians, world frame) into a canvas.
function render(vox, angle, opts) {
  opts = opts || {};
  const { L, W, H, data, pal } = vox;
  const R = Math.hypot(L / 2, W / 2);
  const w = 2 * Math.ceil(R * 1.4143) + 6;
  const ay = Math.ceil(R * 0.7072) + H + 3;
  const h = ay + Math.ceil(R * 0.7072) + 4;
  const ax = w >> 1;
  const c = U.makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const px = img.data;
  const cs = Math.cos(angle), sn = Math.sin(angle);
  const hl = L / 2, hw = W / 2;
  for (let z = 0; z < H; z++) {
    const layerShade = 0.8 + 0.2 * (z / Math.max(1, H - 1));
    for (let py = 0; py < h; py++) {
      const sy = py + 0.5 - ay + z;
      for (let pxi = 0; pxi < w; pxi++) {
        const sx = pxi + 0.5 - ax;
        const wx = sy + sx * 0.5, wy = sy - sx * 0.5;
        const mx = wx * cs + wy * sn + hl;
        const my = -wx * sn + wy * cs + hw;
        if (mx < 0 || my < 0 || mx >= L || my >= W) continue;
        const ix = mx | 0, iy = my | 0;
        const v = data[(z * W + iy) * L + ix];
        if (!v) continue;
        const top = z === H - 1 || data[((z + 1) * W + iy) * L + ix] === 0;
        let f = layerShade * (top ? 1.06 : 0.8);
        if (opts.flat) f = top ? 1 : 0.82;
        const rgb = pal[v];
        const o = (py * w + pxi) * 4;
        px[o] = Math.min(255, rgb[0] * f);
        px[o + 1] = Math.min(255, rgb[1] * f);
        px[o + 2] = Math.min(255, rgb[2] * f);
        px[o + 3] = 255;
      }
    }
  }
  if (opts.outline !== false) {
    const copy = new Uint8ClampedArray(px);
    const ol = opts.outlineColor || OUTLINE;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        if (copy[o + 3]) continue;
        const n = (x > 0 && copy[o - 1]) || (x < w - 1 && copy[o + 7]) || (y > 0 && copy[o - w * 4 + 3]) || (y < h - 1 && copy[o + w * 4 + 3]);
        if (n) { px[o] = ol[0]; px[o + 1] = ol[1]; px[o + 2] = ol[2]; px[o + 3] = 255; }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return { c, ax, ay, w, h };
}

// ---------- Trucks ----------
const SCHEMES = [
  { name: 'CRIMSON', paint: '#c8352f', roof: '#de5244' },
  { name: 'COBALT', paint: '#2f5fc8', roof: '#4a7ee0' },
  { name: 'MUSTARD', paint: '#d9a520', roof: '#ecc040' },
  { name: 'FOREST', paint: '#2f8a45', roof: '#46a65a' },
  { name: 'ARCTIC', paint: '#d4d9e2', roof: '#eef1f6' },
  { name: 'MIDNIGHT', paint: '#33334a', roof: '#4a4a66' },
  { name: 'SUNSET', paint: '#e06a24', roof: '#f08a40' },
  { name: 'GRAPE', paint: '#7a3fb0', roof: '#9858cc' },
];

function buildTruck(scheme) {
  const L = 17, W = 10, H = 10;
  const v = makeVox(L, W, H);
  const P = color(v, scheme.paint), ROOF = color(v, scheme.roof), CLAD = color(v, '#5e636e'),
    TRIM = color(v, '#2a2a30'), GLASS = color(v, '#1d2c44'), GLINT = color(v, '#86b4dc'),
    TIRE = color(v, '#18181c'), HUB = color(v, '#a8acb4'), LIGHT = color(v, '#fff4c0'), TAIL = color(v, '#e42a2a'),
    RACK = color(v, '#202024'), CAB = color(v, '#2a2428');
  for (let z = 0; z < H; z++) for (let y = 0; y < W; y++) for (let x = 0; x < L; x++) {
    let c = 0;
    const inY = y >= 1 && y <= 8;
    for (const wcx of [4.5, 13.5]) {
      const dx = x + 0.5 - wcx, dz = z + 0.5 - 2.0;
      if ((y <= 1 || y >= 8) && dx * dx + dz * dz <= 4.4) {
        c = ((y === 0 || y === 9) && Math.abs(dx) < 0.6 && Math.abs(dz) < 0.6) ? HUB : TIRE;
      }
    }
    if (!c) {
      if (z === 1 && x >= 2 && x <= 15 && y >= 2 && y <= 7) c = TRIM;
      else if (z === 2 && x >= 1 && x <= 16 && inY) c = (x === 1 || x === 16) ? TRIM : CLAD;
      else if ((z === 3 || z === 4) && x >= 1 && x <= 16 && inY) {
        c = P;
        if (x === 16 && z === 4) c = (y <= 2 || y >= 7) ? LIGHT : TRIM;
        if (x === 16 && z === 3) c = TRIM;
        if (x === 1 && (y === 1 || y === 8)) c = TAIL;
      } else if (z === 5 && x >= 1 && x <= 16 && inY) {
        c = P;
        if (x === 1 && (y === 1 || y === 8)) c = TAIL;
      } else if ((z === 6 || z === 7) && x >= 1 && inY && x <= (z === 6 ? 11 : 10)) {
        const xmax = z === 6 ? 11 : 10;
        const perim = x === 1 || x === xmax || y === 1 || y === 8;
        if (perim) {
          c = GLASS;
          if ((y === 1 || y === 8) && (x === 1 || x === 6 || x === xmax)) c = P;
          if (z === 7 && c === GLASS && (x * 3 + y) % 7 === 0) c = GLINT;
        } else c = CAB;
      } else if (z === 8 && x >= 1 && x <= 10 && inY) c = ROOF;
      else if (z === 9 && x >= 2 && x <= 9 && (y === 2 || y === 7 || ((x === 3 || x === 8) && y > 2 && y < 7))) c = RACK;
    }
    if (x === 0 && y >= 3 && y <= 6 && z >= 3 && z <= 6) {
      const cy = y - 4.5, cz = z - 4.5;
      if (cy * cy + cz * cz <= 4.6) c = (Math.abs(cy) < 1 && Math.abs(cz) < 1) ? HUB : TIRE;
    }
    if (z === 6 && x === 11 && (y === 0 || y === 9)) c = P;
    if (c) set(v, x, y, z, c);
  }
  return v;
}

const ANGLES = 64;
const truckCache = {};
function truckFrames(schemeIdx) {
  if (truckCache[schemeIdx]) return truckCache[schemeIdx];
  const vox = buildTruck(SCHEMES[schemeIdx]);
  const frames = [];
  for (let i = 0; i < ANGLES; i++) frames.push(render(vox, (i / ANGLES) * U.TAU));
  truckCache[schemeIdx] = frames;
  return frames;
}
function angleIndex(a, count) {
  count = count || ANGLES;
  let i = Math.round((a / U.TAU) * count) % count;
  if (i < 0) i += count;
  return i;
}

// ---------- Item crates ----------
const ICONS = {
  missile: ['..#..', '.###.', '.###.', '.###.', '#.#.#'],
  bomb: ['...##', '.###.', '#####', '#####', '.###.'],
  nitro: ['..##.', '.##..', '#####', '..##.', '.##..'],
  engine: ['..#..', '.###.', '#####', '.###.', '.###.'],
  tires: ['.###.', '#...#', '#.#.#', '#...#', '.###.'],
  turbo: ['#.#..', '.#.#.', '..#.#', '.#.#.', '#.#..'],
};
const ITEMS = {
  missile: { crate: '#c43434', icon: '#ffffff', label: 'MISSILES' },
  bomb: { crate: '#3c3c48', icon: '#f0a020', label: 'BOMBS' },
  nitro: { crate: '#2a6ad0', icon: '#f8e040', label: 'NITRO' },
  engine: { crate: '#e07020', icon: '#ffffff', label: 'ENGINE' },
  tires: { crate: '#6a7080', icon: '#ffffff', label: 'TIRES' },
  turbo: { crate: '#2a9a50', icon: '#ffffff', label: 'TURBO' },
};
function buildCrate(type) {
  const it = ITEMS[type];
  const v = makeVox(9, 9, 7);
  const body = color(v, it.crate), frame = color(v, U.mul(U.hex(it.crate), 0.55)), topc = color(v, U.mul(U.hex(it.crate), 1.18)), icon = color(v, it.icon);
  const rows = ICONS[type];
  for (let z = 0; z < 7; z++) for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
    const edges = (x === 0 || x === 8 ? 1 : 0) + (y === 0 || y === 8 ? 1 : 0) + (z === 0 || z === 6 ? 1 : 0);
    let c = edges >= 2 ? frame : body;
    if (z === 6 && edges < 2) c = (x >= 2 && x <= 6 && y >= 2 && y <= 6 && rows[y - 2][x - 2] === '#') ? icon : topc;
    set(v, x, y, z, c);
  }
  return v;
}
const SPIN = 16;
const crateCache = {};
function crateFrames(type) {
  if (!crateCache[type]) {
    const vox = buildCrate(type);
    crateCache[type] = [];
    for (let i = 0; i < SPIN; i++) crateCache[type].push(render(vox, (i / SPIN) * U.TAU));
  }
  return crateCache[type];
}

// ---------- Letters ----------
const letterCache = {};
function letterFrames(ch) {
  if (letterCache[ch]) return letterCache[ch];
  const rows = G.font.glyphRows(ch) || G.font.glyphRows('?');
  const v = makeVox(5, 2, 7);
  const front = color(v, '#f8d030'), back = color(v, '#c08a10');
  for (let r = 0; r < 7; r++) for (let x = 0; x < 5; x++) {
    if (rows[r][x] === '#') { set(v, x, 0, 6 - r, front); set(v, x, 1, 6 - r, back); }
  }
  letterCache[ch] = [];
  for (let i = 0; i < SPIN; i++) letterCache[ch].push(render(v, (i / SPIN) * U.TAU, { flat: true }));
  return letterCache[ch];
}

// ---------- Bomb ----------
let bombSprite = null;
function bomb() {
  if (bombSprite) return bombSprite;
  const v = makeVox(7, 7, 8);
  const body = color(v, '#2c2c38'), hi = color(v, '#7a7a90'), fuse = color(v, '#a07040');
  for (let z = 0; z < 6; z++) for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
    const dx = x + 0.5 - 3.5, dy = y + 0.5 - 3.5, dz = z + 0.5 - 3;
    if (dx * dx + dy * dy + dz * dz <= 8.6) set(v, x, y, z, body);
  }
  set(v, 2, 2, 5, hi);
  set(v, 3, 3, 6, fuse); set(v, 4, 3, 7, fuse);
  bombSprite = render(v, 0.6);
  return bombSprite;
}

// ---------- Scenery ----------
function ellipsoid(v, cx, cy, cz, rx, ry, rz, pick, rnd) {
  for (let z = 0; z < v.H; z++) for (let y = 0; y < v.W; y++) for (let x = 0; x < v.L; x++) {
    const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, dz = (z + 0.5 - cz) / rz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d <= 1 + (rnd() - 0.5) * 0.35) set(v, x, y, z, pick(x, y, z, d));
  }
}
function line3(v, a, b, ci) {
  const steps = Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2])) * 2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
    set(v, x, y, z, ci); set(v, x + 1, y, z, ci); set(v, x, y + 1, z, ci); set(v, x + 1, y + 1, z, ci);
  }
}

const DECOR = {
  pine(variant, snow) {
    const rnd = U.rng(31 + variant);
    const H = 17 + variant;
    const v = makeVox(11, 11, H);
    const trunk = color(v, '#6a4428');
    const greens = [color(v, '#1f5a30'), color(v, '#2a7038'), color(v, '#3a8a44')];
    const white = color(v, '#f2f6ff');
    for (let z = 0; z < H; z++) for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) {
      const d = Math.hypot(x + 0.5 - 5.5, y + 0.5 - 5.5);
      if (z <= 3 && d <= 1.1) { set(v, x, y, z, trunk); continue; }
      if (z < 3) continue;
      const tier = Math.floor((z - 3) / 4), t = (z - 3) % 4;
      const r = (5.2 - tier * 1.15) - t * 0.8 + 0.2;
      if (r <= 0 || d > r) continue;
      let c = greens[(x + y < 9 ? 2 : rnd() < 0.6 ? 0 : 1)];
      if (snow && ((t === 0 && d > r - 1.4) || z >= H - 2 || rnd() < 0.1)) c = white;
      set(v, x, y, z, c);
    }
    return v;
  },
  pine_snow(variant) { return DECOR.pine(variant, true); },
  oak(variant) {
    const rnd = U.rng(77 + variant);
    const v = makeVox(13, 13, 16);
    const trunk = color(v, '#6a4428');
    const g = [color(v, '#2f7028'), color(v, '#3d8a34'), color(v, '#58a640')];
    for (let z = 0; z < 8; z++) for (let y = 5; y < 8; y++) for (let x = 5; x < 8; x++) {
      if (Math.hypot(x + 0.5 - 6.5, y + 0.5 - 6.5) <= 1.2) set(v, x, y, z, trunk);
    }
    ellipsoid(v, 6.5, 6.5, 10.5, 5.6 - variant * 0.3, 5.6 - variant * 0.3, 4.8, (x, y, z) => (z > 12 || x + y < 9 ? g[2] : rnd() < 0.5 ? g[0] : g[1]), rnd);
    return v;
  },
  cactus(variant) {
    const v = makeVox(9, 9, 22);
    const g = color(v, '#3a8a3a'), lt = color(v, '#5aac52'), dk = color(v, '#2a6a2c');
    const H = 17 + variant * 2;
    const box = (x0, x1, y0, y1, z0, z1) => {
      for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(v, x, y, z, x === x0 ? lt : (y === y1 ? dk : g));
    };
    box(3, 5, 3, 5, 0, H - 1);
    set(v, 4, 4, H, lt);
    box(0, 2, 3, 4, 7, 8);
    box(0, 1, 3, 4, 7, 13);
    if (variant !== 1) {
      box(6, 8, 4, 5, 10, 11);
      box(7, 8, 4, 5, 10, 16);
    }
    return v;
  },
  rock(variant, snow) {
    const rnd = U.rng(11 + variant);
    const v = makeVox(9, 8, 6);
    const greys = [color(v, '#86868e'), color(v, '#76767e'), color(v, '#9a9aa4')];
    const white = color(v, '#f2f6ff');
    ellipsoid(v, 4.5, 4, 0.5, 4 - variant * 0.4, 3.4, 4.6 - variant * 0.5, (x, y, z) => (snow && z >= 3 ? white : greys[(x + y < 6) ? 2 : rnd() < 0.5 ? 0 : 1]), rnd);
    return v;
  },
  rock_snow(variant) { return DECOR.rock(variant, true); },
  bush(variant) {
    const rnd = U.rng(21 + variant);
    const v = makeVox(8, 8, 5);
    const g = [color(v, '#2e6e2a'), color(v, '#3e8636'), color(v, '#5aa448')];
    ellipsoid(v, 4, 4, 1.2, 3.6, 3.4, 3.6, (x, y, z) => (z >= 3 || x + y < 5 ? g[2] : rnd() < 0.5 ? g[0] : g[1]), rnd);
    return v;
  },
  hay() {
    const v = makeVox(8, 6, 5);
    const a = color(v, '#e2c454'), b = color(v, '#c8a63a');
    for (let z = 0; z < 5; z++) for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) {
      const corner = (y === 0 || y === 5) && (z === 0 || z === 4);
      if (!corner) set(v, x, y, z, x % 3 === 0 ? b : a);
    }
    return v;
  },
  tires(variant) {
    const v = makeVox(6, 6, 7);
    const blk = color(v, '#1c1c22'), rim = color(v, '#3a3a44'), stripe = color(v, variant === 1 ? '#e0e0e0' : '#d03030');
    for (let z = 0; z < 6; z++) for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) {
      const d = Math.hypot(x + 0.5 - 3, y + 0.5 - 3);
      if (d <= 2.9 && d >= 1.1) set(v, x, y, z, z === 5 ? rim : (z % 2 === 1 && d > 2.3) ? stripe : blk);
    }
    return v;
  },
  cone() {
    const v = makeVox(5, 5, 7);
    const o = color(v, '#f07020'), w = color(v, '#f4f4f4'), base = color(v, '#c85010');
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) set(v, x, y, 0, base);
    for (let z = 1; z < 7; z++) for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
      const r = 2.3 * (1 - z / 7.5) + 0.35;
      if (Math.hypot(x + 0.5 - 2.5, y + 0.5 - 2.5) <= r) set(v, x, y, z, z === 3 || z === 4 ? w : o);
    }
    return v;
  },
  palm(variant) {
    const v = makeVox(15, 15, 22);
    const t1 = color(v, '#8a6a40'), t2 = color(v, '#745630'), g1 = color(v, '#2e8a34'), g2 = color(v, '#48a83c'), nut = color(v, '#6a4a20');
    const lean = variant === 2 ? -0.12 : 0.14;
    for (let z = 0; z <= 17; z++) {
      const cx = 7 + z * lean;
      for (let y = 6; y <= 8; y++) for (let x = 5; x <= 10; x++) {
        if (Math.hypot(x + 0.5 - (cx + 0.5), y + 0.5 - 7.5) <= 1.5) set(v, x, y, z, z % 3 === 0 ? t2 : t1);
      }
    }
    const tx = 7 + 17 * lean;
    for (let k = 0; k < 7; k++) {
      const a = k * (U.TAU / 7) + variant * 0.4;
      for (let l = 0; l <= 7; l += 0.5) {
        const x = tx + Math.cos(a) * l, y = 7 + Math.sin(a) * l, z = 19 - (l * l) / 10;
        set(v, x, y, z, l > 4 ? g1 : g2); set(v, x + 1, y, z, l > 4 ? g1 : g2); set(v, x, y + 1, z, g1);
      }
    }
    set(v, tx, 6, 17, nut); set(v, tx + 1, 8, 17, nut);
    return v;
  },
  deadtree(variant) {
    const v = makeVox(11, 11, 16);
    const bark = color(v, '#5a4a42'), br = color(v, '#4a3c36');
    for (let z = 0; z < 12; z++) for (let y = 4; y <= 6; y++) for (let x = 4; x <= 6; x++) {
      if (Math.hypot(x + 0.5 - 5.5, y + 0.5 - 5.5) <= 1.5) set(v, x, y, z, bark);
    }
    line3(v, [5, 5, 7], [1, 3, 12 - variant], br);
    line3(v, [5, 5, 9], [9, 7, 15], br);
    line3(v, [5, 5, 5], [9, 2, 9], br);
    if (variant === 1) line3(v, [5, 5, 10], [3, 9, 14], br);
    return v;
  },
  lamp() {
    const v = makeVox(5, 5, 18);
    const pole = color(v, '#8a8e96'), lt = color(v, '#fff0a0');
    for (let z = 0; z < 17; z++) for (let x = 1; x <= 2; x++) for (let y = 1; y <= 2; y++) set(v, x, y, z, pole);
    for (let x = 1; x <= 4; x++) for (let y = 1; y <= 2; y++) set(v, x, y, 16, pole);
    for (let y = 1; y <= 2; y++) { set(v, 3, y, 15, lt); set(v, 4, y, 15, lt); }
    return v;
  },
  stand(variant) {
    const rnd = U.rng(5 + variant);
    const v = makeVox(22, 10, 11);
    const base = color(v, '#8a8a96'), dark = color(v, '#5a5a66'), roof = color(v, variant ? '#c83a3a' : '#2f5fc8');
    const crowd = ['#f0c040', '#e04848', '#4878e0', '#48b048', '#f0f0f0', '#e08030', '#c060c0'].map((c) => color(v, c));
    for (let y = 0; y < 8; y++) {
      const hgt = 2 + Math.floor(y * 0.9);
      for (let x = 0; x < 22; x++) {
        for (let z = 0; z < hgt; z++) set(v, x, y, z, x === 0 || x === 21 ? dark : base);
        if (x > 0 && x < 21 && rnd() < 0.8) set(v, x, y, hgt, crowd[(rnd() * crowd.length) | 0]);
      }
    }
    for (let x = 0; x < 22; x++) { set(v, x, 9, 10, roof); set(v, x, 8, 10, roof); for (let z = 0; z < 10; z++) if (x % 7 === 0) set(v, x, 9, z, dark); }
    return v;
  },
};

const decorCache = {};
function decor(type, variant, angle) {
  const ai = angle === undefined ? 0 : angleIndex(angle, 16);
  const key = type + ':' + variant + ':' + ai;
  if (!decorCache[key]) {
    const vox = DECOR[type](variant || 0);
    decorCache[key] = render(vox, (ai / 16) * U.TAU + (angle === undefined ? 0.35 : 0));
  }
  return decorCache[key];
}

// Pixel ellipse shadow, cached by size.
const shadowCache = {};
function shadow(rx, ry) {
  const key = rx + 'x' + ry;
  if (shadowCache[key]) return shadowCache[key];
  const c = U.makeCanvas(rx * 2 + 1, ry * 2 + 1);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  for (let y = -ry; y <= ry; y++) {
    const span = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry + 0.25))));
    ctx.fillRect(rx - span, y + ry, span * 2 + 1, 1);
  }
  shadowCache[key] = c;
  return c;
}

G.SPR = { SCHEMES, ITEMS, ICONS, ANGLES, SPIN, truckFrames, crateFrames, letterFrames, bomb, decor, shadow, angleIndex, render, buildTruck };
