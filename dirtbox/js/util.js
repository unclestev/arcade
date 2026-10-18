import { G } from './ns.js';

const U = {};
const TAU = Math.PI * 2;
U.TAU = TAU;

U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
U.lerp = (a, b, t) => a + (b - a) * t;
U.approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));
U.wrapAngle = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
U.sign = (v) => (v < 0 ? -1 : 1);

// Small deterministic RNG (mulberry32).
U.rng = function (seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

U.hash2 = (x, y) => {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

// Smooth value noise in 0..1.
U.noise = (x, y) => {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = U.hash2(xi, yi), b = U.hash2(xi + 1, yi);
  const c = U.hash2(xi, yi + 1), d = U.hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};

U.hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
U.css = (rgb) => 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
U.mul = (rgb, f) => [U.clamp(Math.round(rgb[0] * f), 0, 255), U.clamp(Math.round(rgb[1] * f), 0, 255), U.clamp(Math.round(rgb[2] * f), 0, 255)];
U.mix = (a, b, t) => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];

// Isometric (2:1) projection of world coordinates.
U.isoX = (x, y) => x - y;
U.isoY = (x, y) => (x + y) * 0.5;

U.pad = (n, len, ch) => {
  let s = String(Math.floor(n));
  while (s.length < len) s = (ch || '0') + s;
  return s;
};
U.ordinal = (n) => ['1ST', '2ND', '3RD', '4TH'][n - 1] || n + 'TH';
U.fmtTime = (t) => {
  if (!isFinite(t)) return '-:--.-';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return m + ':' + U.pad(Math.floor(s), 2) + '.' + Math.floor((s % 1) * 10);
};

U.makeCanvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

// Browser storage can be missing or throw; the game must still run.
U.store = {
  load(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  },
  save(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* ignore */ }
  },
};

G.U = U;
