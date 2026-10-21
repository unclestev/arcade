// Next Gen: builds the 3D scenery for a track from the simulation's track geometry.
// Purely visual. World x, y (sim units) map to three.js X, Z; height (sim z) is three.js Y.
import * as THREE from '../../vendor/three/three.module.min.js';
import { G } from '../ns.js';
import { HW, CURB, WALL, WORLD } from '../sim.js';
import { voxGeometry, voxMaterial } from './voxmesh.js';
import { TIME, addWind, terrainDetail, terrainNormal, waterNormals, lavaTextures, grassField, trackFlags, cloudLayer } from './nature.js';

const U = G.U;
const ROAD_Y = 0.05;
const DRIVE = HW + CURB;

// Look per theme: light, fog, terrain relief and an optional sea/swamp water level.
const LOOK = {
  farm: { sun: '#fff1d6', sunI: 2.6, hemiI: 1.15, sunDir: [-0.5, 0.75, -0.35], fog: [500, 1500], hills: 26, peaks: 160, peakCol: '#5a7a48', water: null },
  desert: { sun: '#fff0d0', sunI: 2.9, hemiI: 1.1, sunDir: [-0.6, 0.6, -0.2], fog: [450, 1500], hills: 18, peaks: 220, peakCol: '#b8704a', water: null },
  snow: { sun: '#f2f6ff', sunI: 2.4, hemiI: 1.35, sunDir: [-0.4, 0.7, -0.5], fog: [380, 1300], hills: 30, peaks: 260, peakCol: '#f4f8ff', water: null },
  swamp: { sun: '#e8f0c8', sunI: 1.9, hemiI: 1.15, sunDir: [-0.3, 0.8, -0.4], fog: [260, 1000], hills: 8, peaks: 70, peakCol: '#3e5a32', water: { y: -0.9, color: '#3a5a50' } },
  city: { sun: '#dfe6ff', sunI: 2.0, hemiI: 1.05, sunDir: [-0.5, 0.6, -0.6], fog: [400, 1400], hills: 0, peaks: 0, peakCol: '#7c8088', water: null, city: true },
  forest: { sun: '#fff4dc', sunI: 2.4, hemiI: 1.1, sunDir: [-0.55, 0.7, -0.3], fog: [320, 1200], hills: 34, peaks: 200, peakCol: '#2c5a30', water: null },
  beach: { sun: '#fffaf0', sunI: 3.0, hemiI: 1.2, sunDir: [-0.4, 0.8, -0.3], fog: [600, 1800], hills: 6, peaks: 0, peakCol: '#dcc48a', water: { y: -1.2, color: '#2a8ac0', sea: true } },
  volcano: { sun: '#ffb080', sunI: 2.2, hemiI: 1.0, sunDir: [-0.5, 0.55, -0.5], fog: [300, 1100], hills: 22, peaks: 320, peakCol: '#2a2226', water: { y: -1.0, lava: true }, lava: true },
};

const hexLinear = (h) => new THREE.Color(h);
const rgb = (h) => U.hex(h).map((v) => v / 255);
const smooth = (a, b, x) => { const t = U.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------- textures ----------
function canvasTexture(w, h, draw, opts = {}) {
  const c = U.makeCanvas(w, h);
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.wrapS = opts.clampS ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// Road surface: dirt or asphalt in the theme's track colours, plus a matching normal map so the
// sun picks out ruts, pebbles and cracks. u runs across the road (0..1 = -HW..HW), v along it
// (one tile = 64 units). Built from one height field so colour and relief line up.
function roadMaps(theme) {
  const pal = theme.colors;
  const lite = G.NG_QUALITY.lite;
  const w = lite ? 256 : 512, h = lite ? 512 : 1024;
  const sc = w / 256;
  const rnd = U.rng(7);
  const city = theme.lineStyle === 'center';
  const base = U.hex(pal.TRACK[0]), line = U.hex(pal.LINE[0]);
  const H = new Float32Array(w * h);   // relief, roughly -1..1
  const S = new Float32Array(w * h);   // brightness factor
  const X = (d) => ((d + HW) / (2 * HW)) * w;
  // periodic along v so the tile repeats cleanly down the track
  const nz = (x, y, f) => U.noise(x / f, ((y % h) + h) % h / f);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const n1 = nz(x / sc, y / sc, 22), n2 = nz(x / sc + 50, y / sc, 6), n3 = rnd();
    H[i] = (n1 - 0.5) * 0.9 + (n2 - 0.5) * 0.5 + (n3 - 0.5) * (city ? 0.25 : 0.4);
    S[i] = 0.84 + n1 * 0.2 + n2 * 0.1 + n3 * 0.08;
  }
  const lineMask = new Float32Array(w * h); // centre line (city) or tyre ruts (dirt), tinted LINE
  const add = (cx, cy, r, dh, ds) => {
    for (let yy = Math.floor(cy - r); yy <= cy + r; yy++) for (let xx = Math.floor(cx - r); xx <= cx + r; xx++) {
      if (xx < 0 || xx >= w) continue;
      const q = 1 - Math.hypot(xx - cx, yy - cy) / r;
      if (q <= 0) continue;
      const i = (((yy % h) + h) % h) * w + xx;
      H[i] += dh * Math.sqrt(q); S[i] *= 1 + ds * q;
    }
  };
  if (!city) {
    // tyre ruts: worn-in grooves, darker and smoother
    for (const d of [-14, -8, 8, 14]) {
      const cx = X(d);
      for (let y = 0; y < h; y++) {
        const wob = Math.sin(y / h * U.TAU * 2 + d) * 2 * sc;
        for (let x = Math.floor(cx - 10 * sc); x <= cx + 10 * sc; x++) {
          const q = 1 - Math.abs(x - cx - wob) / (10 * sc);
          if (q <= 0) continue;
          const i = y * w + x;
          H[i] -= q * q * 1.2;
          S[i] *= 1 - q * 0.1;
          lineMask[i] = Math.max(lineMask[i], q * q * 0.55);
        }
      }
    }
    // pebbles and small stones with a lit top
    for (let k = 0; k < 1400 * sc; k++) add(rnd() * w, rnd() * h, (0.8 + rnd() * rnd() * 3.2) * sc, 0.9 + rnd(), rnd() < 0.5 ? 0.18 : -0.12);
  } else {
    // asphalt: patches, cracks and a dashed centre line
    for (let k = 0; k < 10; k++) {
      const px = rnd() * w, py = rnd() * h, pw = (20 + rnd() * 50) * sc, ph = (30 + rnd() * 80) * sc;
      for (let y = Math.floor(py); y < py + ph; y++) for (let x = Math.floor(px); x < Math.min(w, px + pw); x++) S[((y % h) * w) + x] *= 0.9;
    }
    for (let k = 0; k < 14; k++) {
      let x = rnd() * w, y = rnd() * h, a = rnd() * U.TAU;
      for (let s = 0; s < 70 * sc; s++) {
        a += (rnd() - 0.5) * 0.6; x += Math.cos(a); y += Math.sin(a);
        if (x < 0 || x >= w) break;
        const i = (((Math.floor(y) % h) + h) % h) * w + Math.floor(x);
        H[i] -= 1.4; S[i] *= 0.7;
      }
    }
    for (let k = 0; k < 2500 * sc; k++) add(rnd() * w, rnd() * h, (0.6 + rnd() * 1.2) * sc, 0.4, rnd() < 0.5 ? 0.12 : -0.1);
  }
  if (city) for (let y = 0; y < h; y++) if ((y % (128 * sc)) < 64 * sc) for (let x = Math.floor(X(0) - 3 * sc); x < X(0) + 3 * sc; x++) lineMask[y * w + x] = 1;
  const edge = (x) => { const u = x / w; return 1 - 0.28 * (1 - U.clamp(Math.min(u, 1 - u) / 0.07, 0, 1)); };
  const map = canvasTexture(w, h, (ctx) => {
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, o = i * 4;
      // grooves collect darker dust; raised stones catch light
      const k = S[i] * edge(x) * (1 + U.clamp(H[i], -1.5, 1.5) * 0.04);
      const lm = lineMask[i] * (city ? 0.92 : 1);
      for (let c = 0; c < 3; c++) img.data[o + c] = U.clamp(base[c] * k * (1 - lm) + line[c] * lm * (0.9 + S[i] * 0.1), 0, 255);
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, { clampS: true });
  // normal map from the height field
  const at = (x, y) => H[(((y % h) + h) % h) * w + U.clamp(x, 0, w - 1)];
  const str = (city ? 0.9 : 1.6) / sc;
  const normal = canvasTexture(w, h, (ctx) => {
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * str, dy = (at(x, y + 1) - at(x, y - 1)) * str;
      const l = Math.hypot(dx, dy, 1), o = (y * w + x) * 4;
      img.data[o] = (-dx / l * 0.5 + 0.5) * 255; img.data[o + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, { clampS: true, linear: true });
  return { map, normal };
}

// Soft-edged blob (puddle / oil / lava) as an alpha mask, same shape recipe as the Classic ground.
function blobTexture(seed) {
  return canvasTexture(128, 128, (ctx, w) => {
    const rnd = U.rng(seed);
    ctx.fillStyle = '#fff';
    ctx.filter = 'blur(3px)';
    const c = w / 2, r = w * 0.36;
    ctx.beginPath(); ctx.arc(c, c, r * 0.85, 0, U.TAU); ctx.fill();
    for (let k = 0; k < 4; k++) {
      const a = rnd() * U.TAU, rr = r * (0.35 + rnd() * 0.3);
      ctx.beginPath(); ctx.arc(c + Math.cos(a) * r * 0.45, c + Math.sin(a) * r * 0.45, rr, 0, U.TAU); ctx.fill();
    }
  }, { linear: true });
}

function chevronTexture() {
  return canvasTexture(64, 128, (ctx, w, h) => {
    ctx.fillStyle = '#f0c830'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e0501c';
    // Tip toward the top of the canvas: the texture is flipped on upload, so the top lands at
    // higher v, which is further along the track (the way the trucks drive).
    for (let k = 0; k < 2; k++) {
      const y = k * 64;
      ctx.beginPath();
      ctx.moveTo(4, y + 54); ctx.lineTo(w / 2, y + 24); ctx.lineTo(w - 4, y + 54);
      ctx.lineTo(w - 4, y + 38); ctx.lineTo(w / 2, y + 8); ctx.lineTo(4, y + 38); ctx.closePath(); ctx.fill();
    }
  });
}

function checkerTexture(cols, rows) {
  const t = canvasTexture(cols * 8, rows * 8, (ctx) => {
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      ctx.fillStyle = (q + r) % 2 ? '#f4f4f4' : '#1e1e24';
      ctx.fillRect(q * 8, r * 8, 8, 8);
    }
  });
  t.magFilter = THREE.NearestFilter;
  return t;
}

function bannerTexture(text) {
  return canvasTexture(512, 64, (ctx, w, h) => {
    ctx.fillStyle = '#140e1a'; ctx.fillRect(0, 0, w, h);
    for (let q = 0; q < 64; q++) for (let r = 0; r < 2; r++) {
      ctx.fillStyle = (q + r) % 2 ? '#f4f4f4' : '#1e1e24';
      ctx.fillRect(q * 8, r * 8 + (r ? h - 16 : 0), 8, 8);
    }
    ctx.fillStyle = '#ffc040';
    ctx.font = 'italic 700 34px "Chakra Petch", system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 1);
  });
}

// ---------- geometry helpers ----------
// A ribbon along the track between two lateral offsets, from sample a to b (indices may wrap).
function ribbon(track, d0, d1, y0, y1, opts = {}) {
  const n = track.n;
  const pos = [], uv = [], col = [], idx = [];
  const ranges = opts.ranges || [[0, n]];
  for (const [a, b] of ranges) {
    const start = pos.length / 3;
    for (let k = a; k <= b; k++) {
      const i = ((k % n) + n) % n;
      const nx = -track.ty[i], ny = track.tx[i];
      const cx = track.cx[i], cy = track.cy[i];
      pos.push(cx + nx * d0, y0, cy + ny * d0, cx + nx * d1, y1, cy + ny * d1);
      const v = (k * track.ds) / 64;
      uv.push(0, v, 1, v);
      if (opts.color) { const c = opts.color(i, k); col.push(...c, ...c); }
      if (k > a) {
        const p = start + (k - a) * 2;
        idx.push(p - 2, p, p - 1, p - 1, p, p + 1);
      }
    }
  }
  return finish(pos, uv, opts.color ? col : null, idx);
}
function finish(pos, uv, col, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// Make sure every triangle faces up (+Y) or outward: flips the winding if the first normal points down.
function faceUp(g) {
  const n = g.getAttribute('normal');
  if (n && n.count && n.getY(0) < 0) {
    const ix = g.getIndex().array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    g.computeVertexNormals();
  }
  return g;
}

// Flat-coloured quads along the track: a band from d0 to d1 split into stripes of `len` units.
function stripes(track, d0, d1, y, len, colors, sRange) {
  const pos = [], col = [], idx = [];
  const n = track.n;
  const per = Math.max(1, Math.round(len / track.ds));
  const [a, b] = sRange || [0, n];
  for (let k = a; k < b; k++) {
    const i = ((k % n) + n) % n, j = (i + 1) % n;
    const c = colors[Math.floor(k / per) % colors.length];
    const v0 = pos.length / 3;
    for (const q of [i, j]) {
      const nx = -track.ty[q], ny = track.tx[q];
      pos.push(track.cx[q] + nx * d0, y, track.cy[q] + ny * d0, track.cx[q] + nx * d1, y, track.cy[q] + ny * d1);
      col.push(...c, ...c);
    }
    idx.push(v0, v0 + 2, v0 + 1, v0 + 1, v0 + 2, v0 + 3);
  }
  return faceUp(finish(pos, null, col, idx));
}

// Wall band: top + inner + outer faces, dashed in two colours.
function walls(track, theme, height) {
  const pal = theme.colors;
  const A = rgb(pal.WALL_A[0]), B = rgb(pal.WALL_B[0]);
  const dash = theme.wallDash || [4, 10];
  const period = dash[0] + dash[1];
  const pos = [], col = [], idx = [];
  const n = track.n;
  for (const side of [-1, 1]) {
    const din = side * DRIVE, dout = side * (DRIVE + WALL);
    for (let k = 0; k < n; k++) {
      const i = k, j = (k + 1) % n;
      const s = k * track.ds;
      const c = (s % period) < dash[0] ? B : A;
      const P = (q, d, y) => [track.cx[q] - track.ty[q] * d, y, track.cy[q] + track.tx[q] * d];
      const quads = [
        [P(i, din, height), P(i, dout, height), P(j, din, height), P(j, dout, height), 1.0],
        [P(i, din, -1), P(i, din, height), P(j, din, -1), P(j, din, height), 0.78],
        [P(i, dout, -1), P(i, dout, height), P(j, dout, -1), P(j, dout, height), 0.62],
      ];
      for (const [p0, p1, p2, p3, shade] of quads) {
        const v0 = pos.length / 3;
        pos.push(...p0, ...p1, ...p2, ...p3);
        const cc = [c[0] * shade, c[1] * shade, c[2] * shade];
        col.push(...cc, ...cc, ...cc, ...cc);
        idx.push(v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2);
      }
    }
  }
  const g = finish(pos, null, col, idx);
  return g;
}

// ---------- scenery placement (same recipe as the Classic ground, so layouts match) ----------
function placeDecor(track, theme) {
  const rnd = U.rng(1000 + track.index * 77);
  const list = [];
  const total = theme.decor.reduce((a, b) => a + b[1], 0);
  const pick = () => {
    let r = rnd() * total;
    for (const [type, w] of theme.decor) { r -= w; if (r <= 0) return type; }
    return theme.decor[0][0];
  };
  const clear = HW + CURB + WALL + 12;
  const tries = Math.round(900 * (track.def.decor || 1) * (theme.decorDensity || 1));
  for (let t = 0; t < tries; t++) {
    const x = 20 + rnd() * (WORLD - 40), y = 20 + rnd() * (WORLD - 40);
    const i = track.nearest(x, y, -1);
    const dist = Math.hypot(x - track.cx[i], y - track.cy[i]);
    const type = pick();
    const need = clear + (G.DECOR_SIZE[type] || 6);
    if (dist < need) continue;
    if (list.some((o) => Math.abs(o.x - x) < 14 && Math.abs(o.y - y) < 14)) continue;
    list.push({ type, x, y, v: Math.floor(rnd() * 3), a: rnd() * U.TAU });
  }
  const side = HW + CURB + WALL + 18;
  if (theme.stands) {
    for (const sgn of [-1, 1]) for (const off of [-60, 20]) {
      const p = track.posAt(off, sgn * side);
      list.push({ type: 'stand', x: p.x, y: p.y, v: off > 0 ? 1 : 0, a: track.ang[track.idxAt(off)] + (sgn > 0 ? Math.PI : 0) + Math.PI / 2, face: sgn });
    }
  }
  const stands = list.filter((o) => o.type === 'stand');
  return list.filter((o) => o.type === 'stand' || !stands.some((s) => Math.hypot(s.x - o.x, s.y - o.y) < 26));
}

// Distance from (x, y) to the track centreline (coarse, for terrain shaping).
function distField(track) {
  const step = 3;
  const xs = [], ys = [];
  for (let i = 0; i < track.n; i += step) { xs.push(track.cx[i]); ys.push(track.cy[i]); }
  return (x, y) => {
    let b = Infinity;
    for (let k = 0; k < xs.length; k++) {
      const dx = x - xs[k], dy = y - ys[k];
      const d = dx * dx + dy * dy;
      if (d < b) b = d;
    }
    return Math.sqrt(b);
  };
}

// ---------- the world ----------
// A small stand-in for the track's surroundings (sky gradient, sun, ground) that the 3D view blurs
// into a reflection map for the trucks' paint, glass and chrome.
export function envScene(track) {
  const theme = G.THEMES[track.def.theme];
  const look = LOOK[track.def.theme] || LOOK.farm;
  const sky = theme.sky.map(hexLinear);
  const ground = new THREE.Color(theme.colors.GROUND[0]).multiplyScalar(0.55);
  const scene = new THREE.Scene();
  const g = new THREE.SphereGeometry(50, 48, 24);
  const p = g.getAttribute('position');
  const cols = [];
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / 50;
    let c;
    if (t >= 0) {
      const f = U.clamp(1 - Math.pow(t, 0.55), 0, 1) * (sky.length - 1);
      const a = Math.floor(f), b = Math.min(sky.length - 1, a + 1);
      c = sky[a].clone().lerp(sky[b], f - a).multiplyScalar(1.15);
    } else c = sky[sky.length - 1].clone().lerp(ground, smooth(0, 0.18, -t));
    cols.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const sun = new THREE.Mesh(new THREE.SphereGeometry(3.2, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(look.sun).multiplyScalar(30) }));
  sun.position.copy(new THREE.Vector3(...look.sunDir).normalize().multiplyScalar(40));
  scene.add(sun);
  return scene;
}

export function buildWorld(track) {
  const theme = G.THEMES[track.def.theme];
  const look = LOOK[track.def.theme] || LOOK.farm;
  const pal = theme.colors;
  const scene = new THREE.Scene();
  const disposables = [];
  const keep = (o) => { disposables.push(o); return o; };
  const world = { scene, track, theme, look, dynamic: {}, flow: [], envMats: [], lavaMats: [] };
  // Water: glossy, rippling (scrolling normal map) and reflecting the sky once the env map is set.
  const waterMaterial = (color, rep, opacity) => {
    const n = keep(waterNormals().clone());
    n.needsUpdate = true;
    n.repeat.set(rep, rep);
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.05, metalness: 0.25, transparent: true, opacity, normalMap: n, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.2 });
    world.flow.push({ tex: n, sx: 0.011, sy: 0.017 });
    world.envMats.push(m);
    return m;
  };
  // Lava: glowing cracks between dark crust plates, creeping slowly and pulsing.
  const lavaMaterial = (rep) => {
    const L = lavaTextures();
    const map = keep(L.map.clone()), emi = keep(L.emi.clone());
    for (const t of [map, emi]) { t.needsUpdate = true; t.repeat.set(rep, rep); world.flow.push({ tex: t, sx: 0.004, sy: 0.006 }); }
    const m = new THREE.MeshStandardMaterial({ map, emissive: '#ff5a18', emissiveMap: emi, emissiveIntensity: 2.2, roughness: 0.7 });
    world.lavaMats.push(m);
    return m;
  };

  // sky dome: the theme's sky gradient, horizon at the bottom
  const sky = theme.sky.map(hexLinear);
  {
    const g = keep(new THREE.SphereGeometry(4000, 32, 16));
    const p = g.getAttribute('position');
    const cols = [];
    for (let i = 0; i < p.count; i++) {
      const t = U.clamp(p.getY(i) / 4000, -0.2, 1);
      const f = U.clamp(1 - Math.pow(Math.max(0, t), 0.55), 0, 1) * (sky.length - 1);
      const a = Math.floor(f), b = Math.min(sky.length - 1, a + 1);
      const c = sky[a].clone().lerp(sky[b], f - a);
      cols.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const m = keep(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    const dome = new THREE.Mesh(g, m);
    dome.renderOrder = -10;
    world.sky = dome;
    scene.add(dome);
  }
  const fogCol = sky[sky.length - 1].clone().lerp(sky[sky.length - 2], 0.35);
  scene.fog = new THREE.Fog(fogCol, look.fog[0], look.fog[1]);
  scene.background = fogCol;

  // lights
  const hemi = new THREE.HemisphereLight(sky[1].clone().lerp(new THREE.Color('#ffffff'), 0.5), new THREE.Color(pal.GROUND[0]).multiplyScalar(0.6), look.hemiI);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(sky[2].clone().lerp(new THREE.Color('#ffffff'), 0.6), 0.55)); // lifts the shadow side
  const sun = new THREE.DirectionalLight(new THREE.Color(look.sun), look.sunI);
  sun.castShadow = true;
  sun.shadow.mapSize.set(G.NG_QUALITY.shadow, G.NG_QUALITY.shadow);
  const sc = sun.shadow.camera;
  sc.left = -130; sc.right = 130; sc.top = 130; sc.bottom = -130; sc.near = 10; sc.far = 600;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.6;
  world.sunDir = new THREE.Vector3(...look.sunDir).normalize();
  scene.add(sun, sun.target);
  world.sun = sun;

  // terrain: flat along the track, rolling further out, mountains (or sea) at the edges
  const dist = distField(track);
  const corridor = DRIVE + WALL;
  const heightAt = (x, y) => {
    const d = dist(x, y);
    if (d < corridor + 2) return -0.6;
    if (look.city) return 0;
    const off = d - corridor;
    const r = Math.hypot(x - WORLD / 2, y - WORLD / 2);
    if (look.water && look.water.sea) return smooth(5, 60, off) * 3 - smooth(520, 760, r) * 30;
    const relief = (U.noise(x / 170 + track.index * 3.1, y / 170) - 0.35) * look.hills + (U.noise(x / 55, y / 55) - 0.5) * look.hills * 0.25;
    const peaks = smooth(620, 1250, r) * look.peaks * (0.45 + U.noise(x / 260 + 9, y / 260) * 0.9);
    let h = smooth(6, 140, off) * Math.max(-2, relief) + peaks;
    if (look.water) h = Math.min(h, (U.noise(x / 90, y / 90) - 0.55) * 10 * smooth(10, 60, off));
    return h;
  };
  world.heightAt = heightAt;
  {
    const ext0 = -1100, ext1 = WORLD + 1100, segs = G.NG_QUALITY.terrain;
    const size = ext1 - ext0;
    const g = keep(new THREE.PlaneGeometry(size, size, segs, segs));
    g.rotateX(-Math.PI / 2);
    g.translate(ext0 + size / 2, 0, ext0 + size / 2);
    const p = g.getAttribute('position');
    const cols = [];
    const G0 = pal.GROUND.map(rgb), GA = (pal.GROUND_ALT || pal.GROUND).map(rgb), PK = rgb(look.peakCol);
    const patchT = theme.patch === undefined ? 0.58 : theme.patch;
    const wl = look.water ? look.water.y : null;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getZ(i);
      const h = heightAt(x, y);
      p.setY(i, h);
      const patch = U.noise(x / 46 + track.index * 13.1, y / 46) * 0.7 + U.noise(x / 13, y / 13 + 5) * 0.3;
      let c = (patch > patchT ? GA : G0)[Math.floor(U.hash2(Math.round(x), Math.round(y)) * 2.99) % (patch > patchT ? GA : G0).length];
      const hk = U.clamp((h - 25) / 120, 0, 1);
      c = [c[0] + (PK[0] - c[0]) * hk, c[1] + (PK[1] - c[1]) * hk, c[2] + (PK[2] - c[2]) * hk];
      if (wl !== null && h < wl + 0.5) { const k = 0.75; c = [c[0] * k, c[1] * k, c[2] * k]; }
      const toL = (v) => Math.pow(v, 2.2);
      cols.push(toL(c[0]), toL(c[1]), toL(c[2]));
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.computeVertexNormals();
    const detail = terrainDetail(), dn = terrainNormal();
    detail.repeat.set(size / 26, size / 26);
    dn.repeat.set(size / 26, size / 26);
    const m = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, map: detail, normalMap: dn, normalScale: new THREE.Vector2(0.55, 0.55) }));
    const terrain = new THREE.Mesh(g, m);
    terrain.receiveShadow = true;
    scene.add(terrain);
    if (look.water) {
      const wg = keep(new THREE.PlaneGeometry(size, size));
      wg.rotateX(-Math.PI / 2);
      wg.translate(ext0 + size / 2, look.water.y, ext0 + size / 2);
      const wm = keep(look.water.lava ? lavaMaterial(size / 60) : waterMaterial(look.water.color, size / 70, 0.86));
      const water = new THREE.Mesh(wg, wm);
      water.receiveShadow = !look.water.lava;
      scene.add(water);
    }
  }

  // road (the pits are cut out and drawn as water / lava below)
  const pitRanges = track.ramps.filter((r) => r.pit).map((r) => [Math.floor(r.pit.s0 / track.ds), Math.ceil(r.pit.s1 / track.ds)]);
  const roadRanges = [];
  {
    let start = 0;
    for (const [a, b] of pitRanges.slice().sort((x, y) => x[0] - y[0])) {
      if (a > start) roadRanges.push([start, a]);
      start = b;
    }
    roadRanges.push([start, track.n]); // ribbon() wraps index n back to 0, closing the loop
  }
  const roadTex = roadMaps(theme);
  keep(roadTex.map); keep(roadTex.normal);
  const roadMat = keep(new THREE.MeshStandardMaterial({ map: roadTex.map, normalMap: roadTex.normal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: theme.lineStyle === 'center' ? 0.82 : 0.93, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
  {
    const g = keep(faceUp(ribbon(track, -HW, HW, ROAD_Y, ROAD_Y, { ranges: roadRanges })));
    const road = new THREE.Mesh(g, roadMat);
    road.receiveShadow = true;
    scene.add(road);
  }
  // curbs
  {
    const ca = rgb(pal.CURB_A[0]).map((v) => Math.pow(v, 2.2)), cb = rgb(pal.CURB_B[0]).map((v) => Math.pow(v, 2.2));
    const m = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    for (const sgn of [-1, 1]) {
      const g = keep(stripes(track, sgn * HW, sgn * DRIVE, ROAD_Y + 0.12, 8, [ca, cb]));
      const mesh = new THREE.Mesh(g, m);
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }
  // walls
  {
    const g = keep(walls(track, theme, (theme.wallH || 4) * 1.15));
    const m = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
    g.getAttribute('color').array.forEach((v, i, a) => { a[i] = Math.pow(v, 2.2); });
    const w = new THREE.Mesh(g, m);
    w.castShadow = true; w.receiveShadow = true;
    scene.add(w);
  }

  // start line + gantry with countdown lights
  {
    const g = keep(faceUp(ribbon(track, -DRIVE, DRIVE, ROAD_Y + 0.15, ROAD_Y + 0.15, { ranges: [[0, 2]] })));
    const tex = keep(checkerTexture(Math.round((2 * DRIVE) / 4), 2));
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.repeat.set(1, 64 / 8); // 2 samples * 4 units = 8 units long
    const m = keep(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    scene.add(new THREE.Mesh(g, m));
    const gantry = new THREE.Group();
    const p = track.posAt(4, 0);
    gantry.position.set(p.x, 0, p.y);
    gantry.rotation.y = -track.ang[track.idxAt(4)];
    const steel = keep(new THREE.MeshStandardMaterial({ color: '#c8ccd4', roughness: 0.4, metalness: 0.6 }));
    const span = DRIVE + WALL + 2;
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(keep(new THREE.BoxGeometry(2.5, 26, 2.5)), steel);
      post.position.set(0, 13, s * span);
      post.castShadow = true;
      gantry.add(post);
    }
    const beamGeo = keep(new THREE.BoxGeometry(3, 6, span * 2 + 2.5));
    const banner = keep(bannerTexture('DIRTBOX RALLY'));
    const bannerMat = keep(new THREE.MeshStandardMaterial({ map: banner, roughness: 0.6 }));
    // BoxGeometry material groups: +X, -X, +Y, -Y, +Z, -Z. The +-X faces look along the road.
    const beam = new THREE.Mesh(beamGeo, [bannerMat, bannerMat, steel, steel, steel, steel]);
    beam.position.set(0, 24, 0);
    beam.castShadow = true;
    gantry.add(beam);
    const lights = [];
    for (let i = 0; i < 3; i++) {
      const lm = new THREE.MeshStandardMaterial({ color: '#2a1e24', emissive: '#000000', roughness: 0.3 });
      keep(lm);
      const l = new THREE.Mesh(keep(new THREE.SphereGeometry(1.3, 12, 8)), lm);
      l.position.set(-1.8, 19.5, (i - 1) * 4);
      gantry.add(l);
      lights.push(lm);
    }
    world.startLights = lights;
    scene.add(gantry);
  }

  // ramps: wedges rising to 6 units, three bright stripes, with a drop at the far end
  for (const r of track.ramps) {
    const i0 = Math.floor(r.s0 / track.ds), i1 = Math.ceil(r.s1 / track.ds);
    const pos = [], col = [], idx = [];
    const base = rgb(pal.RAMP[0]).map((v) => Math.pow(v, 2.2)), str = rgb(pal.RAMP_B[0]).map((v) => Math.pow(v, 2.2));
    const w = DRIVE - 2;
    const P = (k, d, y) => { const i = ((k % track.n) + track.n) % track.n; return [track.cx[i] - track.ty[i] * d, y, track.cy[i] + track.tx[i] * d]; };
    for (let k = i0; k < i1; k++) {
      const t0 = (k - i0) / (i1 - i0), t1 = (k + 1 - i0) / (i1 - i0);
      const y0 = ROAD_Y + 6 * t0, y1 = ROAD_Y + 6 * t1;
      const s = (k - i0) * track.ds;
      const c = (s > 3 && ((s - 3) % 7) < 2.5 && s < 24) ? str : base;
      const quads = [
        [P(k, -w, y0), P(k, w, y0), P(k + 1, -w, y1), P(k + 1, w, y1), c],
        [P(k, -w, 0), P(k, -w, y0), P(k + 1, -w, 0), P(k + 1, -w, y1), base.map((v) => v * 0.6)],
        [P(k, w, 0), P(k, w, y0), P(k + 1, w, 0), P(k + 1, w, y1), base.map((v) => v * 0.6)],
      ];
      for (const [a, b, cc, d, cl] of quads) {
        const v0 = pos.length / 3;
        pos.push(...a, ...b, ...cc, ...d);
        col.push(...cl, ...cl, ...cl, ...cl);
        idx.push(v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2);
      }
    }
    { // back face
      const v0 = pos.length / 3;
      const yTop = ROAD_Y + 6;
      pos.push(...P(i1, -w, 0), ...P(i1, w, 0), ...P(i1, -w, yTop), ...P(i1, w, yTop));
      const cl = base.map((v) => v * 0.45);
      col.push(...cl, ...cl, ...cl, ...cl);
      idx.push(v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2);
    }
    const g = keep(finish(pos, null, col, idx));
    const m = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }));
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // pits: a sunken pool of water (or lava) across the road, with dark banks
  world.pitMats = [];
  for (const r of track.ramps) {
    if (!r.pit) continue;
    const a = Math.floor(r.pit.s0 / track.ds), b = Math.ceil(r.pit.s1 / track.ds);
    const lava = !!look.lava;
    const bank = keep(faceUp(ribbon(track, -DRIVE, DRIVE, -3.2, -3.2, { ranges: [[a, b]] })));
    const bankMat = keep(new THREE.MeshStandardMaterial({ color: lava ? '#1a1010' : '#3a2a1e', roughness: 1 }));
    scene.add(new THREE.Mesh(bank, bankMat));
    // the two end walls of the pool
    for (const k of [a, b]) {
      const P = (d, y) => { const i = ((k % track.n) + track.n) % track.n; return [track.cx[i] - track.ty[i] * d, y, track.cy[i] + track.tx[i] * d]; };
      const g = keep(finish([...P(-DRIVE, -3.2), ...P(DRIVE, -3.2), ...P(-DRIVE, ROAD_Y), ...P(DRIVE, ROAD_Y)], null, null, [0, 1, 2, 1, 3, 2]));
      const m = keep(new THREE.MeshStandardMaterial({ color: lava ? '#2a1814' : '#5a4030', roughness: 1, side: THREE.DoubleSide }));
      scene.add(new THREE.Mesh(g, m));
    }
    const surf = keep(faceUp(ribbon(track, -DRIVE, DRIVE, -1.1, -1.1, { ranges: [[a, b]] })));
    const pm = keep(lava ? lavaMaterial(1.6) : waterMaterial(pal.PIT[0], 2, 0.84));
    world.pitMats.push({ m: pm, lava });
    const pool = new THREE.Mesh(surf, pm);
    pool.receiveShadow = !lava;
    scene.add(pool);
  }

  // puddles and oil slicks (on the volcano the "oil" is lava)
  world.lavaMats = world.lavaMats || [];
  {
    const make = (h, kind, seed) => {
      const tex = keep(blobTexture(seed));
      let m;
      if (kind === 'oil' && look.lava) {
        const L = lavaTextures();
        m = new THREE.MeshStandardMaterial({ map: L.map, emissive: '#ff5a18', emissiveMap: L.emi, emissiveIntensity: 2.2, alphaMap: tex, transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
        world.lavaMats.push(m);
      }
      else if (kind === 'oil') m = new THREE.MeshStandardMaterial({ color: pal.OIL[0], alphaMap: tex, transparent: true, roughness: 0.12, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
      else {
        m = waterMaterial(pal.PUDDLE[0], 1.2, 0.88);
        Object.assign(m, { alphaMap: tex, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
      }
      keep(m);
      const g = keep(new THREE.PlaneGeometry(h.r * 2.6, h.r * 2.6));
      g.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(h.x, ROAD_Y + 0.08, h.y);
      mesh.receiveShadow = true;
      scene.add(mesh);
    };
    track.puddles.forEach((h, i) => make(h, 'puddle', 55 + track.index + i * 3));
    track.oils.forEach((h, i) => make(h, 'oil', 91 + track.index + i * 5));
  }

  // boost pads: glowing chevrons that scroll forward
  world.boostTex = [];
  for (const b of track.boosts) {
    const a = Math.floor(b.s0 / track.ds), c = Math.ceil(b.s1 / track.ds);
    const g = keep(faceUp(ribbon(track, b.d - b.w, b.d + b.w, ROAD_Y + 0.1, ROAD_Y + 0.1, { ranges: [[a, c]] })));
    const tex = keep(chevronTexture());
    tex.repeat.set(1, 2.4);
    const m = keep(new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffb020', emissiveMap: tex, emissiveIntensity: 0.9, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    world.boostTex.push(tex);
    scene.add(new THREE.Mesh(g, m));
  }

  // scenery: instanced meshes per model, variant and map tile, so tiles off screen (or out of the
  // shadow camera) are culled. Phones get a slightly thinner forest.
  {
    const keepRate = G.NG_QUALITY.decor || 1;
    const lavaY = look.water && look.water.lava ? look.water.y + 0.4 : -Infinity;
    const list = placeDecor(track, theme).filter((o) => o.type === 'stand' || (U.hash2(Math.round(o.x * 7), Math.round(o.y * 3)) < keepRate && heightAt(o.x, o.y) > lavaY));
    world.decor = list;
    const TILE = 220;
    const groups = new Map();
    for (const o of list) {
      const key = o.type + ':' + o.v + ':' + Math.floor(o.x / TILE) + ':' + Math.floor(o.y / TILE);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(o);
    }
    const mat = voxMaterial();
    // plants sway in the wind (amount by type; local voxel units, full effect at the reference height)
    const SWAY = { oak: [0.7, 24], bush: [0.35, 8], pine: [0.8, 30], pine_snow: [0.6, 30], palm: [1.6, 30], deadtree: [0.4, 24] };
    const windMats = {};
    const matFor = (type) => {
      const sw = SWAY[type];
      if (!sw) return mat;
      if (!windMats[type]) windMats[type] = keep(addWind(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.05 }), sw[0], sw[1], 'tree:' + type));
      return windMats[type];
    };
    const geos = new Map();
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const [key, items] of groups) {
      const [type, v] = key.split(':');
      const gk = type + ':' + v;
      if (!geos.has(gk)) geos.set(gk, keep(voxGeometry(G.SPR.vox.decor(type, +v))));
      const geo = geos.get(gk);
      const inst = new THREE.InstancedMesh(geo, matFor(type), items.length);
      items.forEach((o, i) => {
        q.setFromAxisAngle(up, -(o.a || 0));
        const s = type === 'stand' ? 1.25 : 1.1 + U.hash2(Math.round(o.x), Math.round(o.y)) * 0.35;
        sv.set(s, s, s);
        pv.set(o.x, Math.max(look.water ? look.water.y : -9, heightAt(o.x, o.y)) - 0.8, o.y);
        m4.compose(pv, q, sv);
        inst.setMatrixAt(i, m4);
      });
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      scene.add(inst);
    }
  }

  // grass along the track, flags beside it, clouds above
  {
    const wl = look.water ? look.water.y + (look.water.lava ? 0.6 : 0.2) : -Infinity;
    const decor = world.decor || [];
    const ok = (x, y, h) => h > wl && !decor.some((o) => Math.abs(o.x - x) < 5 && Math.abs(o.y - y) < 5);
    for (const g of grassField(track, theme, track.def.theme, heightAt, ok, keep)) scene.add(g);
    const near = (s, a, b) => track.wrapS(s - a) <= b - a; // s within [a, b] along the loop
    const avoid = (s) => near(s, -95, 70) || track.ramps.some((r) => near(s, r.s0 - 20, (r.pit ? r.pit.s1 : r.s1) + 20));
    for (const m of trackFlags(track, heightAt, keep, avoid)) scene.add(m);
    world.clouds = cloudLayer(track.def.theme, fogCol, keep);
    scene.add(world.clouds.mesh);
  }

  world.update = (t, cam) => {
    TIME.value = t;
    for (const tex of world.boostTex) tex.offset.y = -t * 1.6;
    for (const f of world.flow) f.tex.offset.set(t * f.sx, t * f.sy);
    const pulse = 2.0 + Math.sin(t * 2.2) * 0.35 + Math.sin(t * 5.3) * 0.15;
    for (const m of world.lavaMats) m.emissiveIntensity = pulse;
    if (cam && world.clouds) world.clouds.update(t, cam);
  };
  world.setEnv = (env) => {
    for (const m of world.envMats) if (m.envMap !== env) { m.envMap = env; m.needsUpdate = true; }
  };
  world.dispose = () => {
    for (const d of disposables) if (d && d.dispose) d.dispose();
    scene.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
  };
  return world;
}

export const ROAD_HEIGHT = ROAD_Y;
