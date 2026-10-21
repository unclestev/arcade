// Next Gen scenery extras: wind, grass, trackside flags, clouds, and the tileable textures for
// terrain detail, water and lava. Purely visual; built from the sim's track geometry.
import * as THREE from '../../vendor/three/three.module.min.js';
import { G } from '../ns.js';
import { HW, CURB, WALL } from '../sim.js';

const U = G.U;
const DRIVE = HW + CURB;

// One clock for everything that sways or flows (seconds; set by the world each frame).
export const TIME = { value: 0 };

// ---------- tileable noise ----------
const fade = (t) => t * t * (3 - 2 * t);
// Value noise that repeats every `p` lattice cells, so textures built from it tile seamlessly.
function pnoise(x, y, p, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = fade(x - xi), fy = fade(y - yi);
  const h = (i, j) => U.hash2((((i % p) + p) % p) + seed * 1013, (((j % p) + p) % p) + seed * 769);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
// fractal sum, 0..1, tiling over the texture (base period p at octave 0)
function fbm(u, v, p, oct, seed) {
  let s = 0, a = 0.5, n = 0;
  for (let o = 0; o < oct; o++) {
    const f = p * (1 << o);
    s += pnoise(u * f, v * f, f, seed + o) * a;
    n += a; a *= 0.5;
  }
  return s / n;
}

function dataTexture(w, h, fill, opts = {}) {
  const c = U.makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) fill(d, (y * w + x) * 4, x / w, y / h, x, y);
  ctx.putImageData(img, 0, 0);
  if (opts.draw) opts.draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
// Normal map from a tileable height function (central differences, wrapping).
function normalTexture(size, height, strength) {
  const H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) H[y * size + x] = height(x / size, y / size, x, y);
  const at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
  return dataTexture(size, size, (d, o, u, v, x, y) => {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    d[o] = (-dx / l * 0.5 + 0.5) * 255; d[o + 1] = (dy / l * 0.5 + 0.5) * 255; d[o + 2] = (1 / l * 0.5 + 0.5) * 255; d[o + 3] = 255;
  });
}

// ---------- textures ----------
// Terrain detail: soft mottling and speckle, near white so it only modulates the vertex colours.
let detailTex = null;
export function terrainDetail() {
  if (detailTex) return detailTex;
  detailTex = dataTexture(256, 256, (d, o, u, v) => {
    const n = fbm(u, v, 8, 4, 3);
    const sp = U.hash2(Math.floor(u * 256) + 9, Math.floor(v * 256)) ;
    let k = 0.8 + n * 0.32 + (sp > 0.93 ? 0.1 : sp < 0.05 ? -0.12 : 0);
    k = U.clamp(k, 0, 1) * 255;
    d[o] = k; d[o + 1] = k; d[o + 2] = k; d[o + 3] = 255;
  }, { srgb: true });
  return detailTex;
}
let detailNormal = null;
export function terrainNormal() {
  if (!detailNormal) detailNormal = normalTexture(256, (u, v) => fbm(u, v, 16, 3, 41), 5);
  return detailNormal;
}

// Rippling water: sum of tileable waves, as a normal map that the world scrolls two ways.
let waterNrm = null;
export function waterNormals() {
  if (waterNrm) return waterNrm;
  const waves = [];
  const r = U.rng(99);
  for (let i = 0; i < 9; i++) waves.push([Math.round((r() - 0.5) * 12) || 1, Math.round((r() - 0.5) * 12), r() * 6.283, 1 / (1 + i * 0.6)]);
  waterNrm = normalTexture(256, (u, v) => {
    let h = 0;
    for (const [a, b, ph, amp] of waves) h += Math.sin((a * u + b * v) * 6.283 + ph) * amp;
    return h + fbm(u, v, 16, 2, 7) * 1.2;
  }, 1.6);
  return waterNrm;
}

// Lava: cooled dark crust plates with glowing cracks between them (tileable Worley cells).
let lavaTex = null;
export function lavaTextures() {
  if (lavaTex) return lavaTex;
  const N = 14, pts = [];
  const r = U.rng(31);
  for (let i = 0; i < N; i++) pts.push([r(), r()]);
  const cell = (u, v) => {
    let f1 = 9, f2 = 9;
    for (const [px, py] of pts) for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      const d = Math.hypot(u - px - ox, v - py - oy);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    return f2 - f1;
  };
  const size = 256;
  const crack = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const e = cell(u, v) + (fbm(u, v, 8, 3, 5) - 0.5) * 0.05;
    const glow = U.clamp(1 - e / 0.06, 0, 1);
    crack[y * size + x] = glow * glow * (0.75 + fbm(u, v, 4, 2, 9) * 0.5);
  }
  const map = dataTexture(size, size, (d, o, u, v, x, y) => {
    const g = crack[y * size + x];
    const n = fbm(u, v, 16, 3, 13);
    // crust: near-black reddish rock; cracks: orange to yellow
    d[o] = U.clamp(40 + n * 40 + g * 215, 0, 255);
    d[o + 1] = U.clamp(18 + n * 16 + g * 150, 0, 255);
    d[o + 2] = U.clamp(14 + n * 12 + g * 40, 0, 255);
    d[o + 3] = 255;
  }, { srgb: true });
  const emi = dataTexture(size, size, (d, o, u, v, x, y) => {
    const g = crack[y * size + x];
    d[o] = g * 255; d[o + 1] = g * 190; d[o + 2] = g * 90; d[o + 3] = 255;
  }, { srgb: true });
  lavaTex = { map, emi };
  return lavaTex;
}

// Clouds: tileable puffy fbm in the alpha channel.
const cloudTex = new Map();
function cloudTexture(cover) {
  const key = cover.toFixed(2);
  if (cloudTex.has(key)) return cloudTex.get(key);
  const t = dataTexture(512, 512, (d, o, u, v) => {
    const n = fbm(u, v, 4, 5, 21);
    const a = U.clamp((n - (0.62 - cover * 0.3)) / 0.16, 0, 1);
    const shade = 0.78 + U.clamp((n - 0.5) * 1.4, 0, 0.22);
    d[o] = d[o + 1] = d[o + 2] = shade * 255;
    d[o + 3] = a * a * (3 - 2 * a) * 255;
  }, { srgb: true });
  cloudTex.set(key, t);
  return t;
}

// ---------- wind ----------
// Bends a material's vertices sideways with height, phase-shifted by position, so plants sway.
// `ref` = height (local units) at which the full amplitude applies; higher bends further.
export function addWind(mat, amp, ref, key, upNormals) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = TIME;
    // double-sided blades: keep the up-facing normal on both sides (no dark back faces)
    if (upNormals) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n\tnormal = normalize( vNormal );');
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        vec4 wp0 = vec4(0.0, 0.0, 0.0, 1.0);
        #ifdef USE_INSTANCING
          wp0 = instanceMatrix * wp0;
        #endif
        wp0 = modelMatrix * wp0;
        float hk = max(0.0, transformed.y) / ${ref.toFixed(2)};
        hk *= hk;
        float ph = wp0.x * 0.045 + wp0.z * 0.031;
        float w = sin(uTime * 1.7 + ph) * 0.7 + sin(uTime * 2.9 + ph * 1.7) * 0.3;
        transformed.x += w * ${amp.toFixed(3)} * hk;
        transformed.z += cos(uTime * 1.3 + ph * 1.3) * ${(amp * 0.55).toFixed(3)} * hk;
      }`);
  };
  mat.customProgramCacheKey = () => 'wind:' + key;
  return mat;
}

// ---------- grass ----------
const GRASS = {
  farm: { n: 1, h: [2.0, 3.6], tip: '#a8cc5a', lean: 0.35 },
  forest: { n: 1.1, h: [2.2, 4.0], tip: '#8ab450', lean: 0.3 },
  swamp: { n: 0.9, h: [3.4, 6.2], tip: '#b0aa62', lean: 0.2, reeds: true },
  beach: { n: 0.45, h: [2.2, 3.8], tip: '#d2cc8c', lean: 0.45 },
  desert: { n: 0.3, h: [1.3, 2.4], tip: '#d4b07a', lean: 0.6, dry: true },
  snow: { n: 0.22, h: [1.2, 2.4], tip: '#b4a47a', lean: 0.5, dry: true, base: '#5a4a34' },
  city: { n: 0.15, h: [1.4, 2.4], tip: '#98b868', lean: 0.4 },
  volcano: { n: 0 },
};

// One tuft: a handful of tapered blades, base dark, tips light. Normals point up so the blades
// light like the ground they grow from (no dark back faces).
function tuftGeometry(cfg, base, tip, seed) {
  const r = U.rng(seed);
  const pos = [], col = [], nor = [];
  const blades = cfg.reeds ? 6 : 9;
  for (let i = 0; i < blades; i++) {
    const a = r() * Math.PI * 2;
    const rad = Math.sqrt(r()) * 1.5;
    const bx = Math.cos(a) * rad, bz = Math.sin(a) * rad;
    const h = 0.5 + r() * 0.5;
    const w = (cfg.reeds ? 0.2 : 0.32) * (0.8 + r() * 0.4);
    const lean = (0.3 + r() * 0.7) * cfg.lean;
    const la = a + (r() - 0.5) * 1.2; // lean outward from the tuft centre
    const sa = r() * Math.PI;
    const sx = Math.cos(sa) * w, sz = Math.sin(sa) * w;
    const top = [bx + Math.cos(la) * lean, h, bz + Math.sin(la) * lean];
    const k = 0.8 + r() * 0.35;
    const cb = base.clone().multiplyScalar(k), ct = tip.clone().multiplyScalar(k);
    const P = [[bx - sx, 0, bz - sz], [bx + sx, 0, bz + sz], top];
    const C = [cb, cb, ct];
    for (let j = 0; j < 3; j++) {
      pos.push(...P[j]);
      col.push(C[j].r, C[j].g, C[j].b);
      nor.push(0, 1, 0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

/**
 * Grass tufts scattered along the track (where the camera looks), in 220-unit tiles so the ones
 * off screen are culled. `ok(x, y, h)` rejects spots (water, lava, scenery).
 */
export function grassField(track, theme, themeKey, heightAt, ok, keep) {
  const cfg = GRASS[themeKey] || GRASS.farm;
  const total = Math.round((G.NG_QUALITY.grass || 0) * (cfg.n || 0));
  if (!total) return [];
  const base = new THREE.Color(cfg.base || theme.colors.GROUND[0]).multiplyScalar(0.9);
  const tip = new THREE.Color(cfg.tip);
  const geos = [0, 1, 2].map((i) => keep(tuftGeometry(cfg, base, tip, 300 + i * 17)));
  const mat = keep(addWind(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }), 0.3, 1, 'grass', true));
  const r = U.rng(4242 + track.index * 31);
  const TILE = 220;
  const tiles = new Map();
  const near = DRIVE + WALL + 2.5;
  let tries = 0;
  for (let k = 0; k < total && tries < total * 4; tries++) {
    const i = Math.floor(r() * track.n);
    const side = r() < 0.5 ? -1 : 1;
    // denser close to the walls, thinning out to ~150 units away
    const d = near + Math.pow(r(), 2.2) * 120;
    const x = track.cx[i] - track.ty[i] * d * side, y = track.cy[i] + track.tx[i] * d * side;
    const h = heightAt(x, y);
    if (!ok(x, y, h)) continue;
    // keep clear of other parts of the track (inside of tight bends)
    const j = track.nearest(x, y, i);
    if (Math.hypot(x - track.cx[j], y - track.cy[j]) < near) continue;
    k++;
    // one tuft shape per tile (fewer draw calls); neighbouring tiles differ
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    const key = Math.floor(U.hash2(tx + 50, ty + 50) * 2.999) + ':' + tx + ':' + ty;
    if (!tiles.has(key)) tiles.set(key, []);
    const s = cfg.h[0] + r() * (cfg.h[1] - cfg.h[0]);
    tiles.get(key).push([x, h - 0.15, y, r() * Math.PI * 2, s, 0.8 + r() * 0.5]);
  }
  const out = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (const [key, items] of tiles) {
    const inst = new THREE.InstancedMesh(geos[+key.split(':')[0]], mat, items.length);
    items.forEach(([x, y, z, a, s, w], n) => {
      q.setFromAxisAngle(up, a);
      sv.set(s * w, s, s * w);
      pv.set(x, y, z);
      m4.compose(pv, q, sv);
      inst.setMatrixAt(n, m4);
    });
    inst.receiveShadow = true;
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    out.push(inst);
  }
  return out;
}

// ---------- trackside flags ----------
// Poles just outside the walls with cloth flags that ripple in the wind (instanced: two draws).
export function trackFlags(track, heightAt, keep, avoid) {
  const spacing = 130;
  const count = Math.floor(track.len / spacing);
  const spots = [];
  for (let k = 0; k < count; k++) {
    const s = k * spacing + 70;
    if (avoid(s)) continue;
    const side = k % 2 ? 1 : -1;
    const p = track.posAt(s, side * (DRIVE + WALL + 4));
    const i = track.idxAt(s);
    spots.push({ x: p.x, y: p.y, a: track.ang[i], side, h: Math.max(-0.6, heightAt(p.x, p.y)), c: k });
  }
  if (!spots.length) return [];
  const poleGeo = keep(new THREE.CylinderGeometry(0.28, 0.34, 17, 6).translate(0, 8.5, 0));
  const poleMat = keep(new THREE.MeshStandardMaterial({ color: '#d8dce4', roughness: 0.35, metalness: 0.7 }));
  // flag: hangs from the top of the pole, trailing back along the track
  const flagGeo = keep(new THREE.PlaneGeometry(7, 4, 10, 1).translate(-3.5, 14.6, 0));
  const flagMat = keep(new THREE.MeshStandardMaterial({ roughness: 0.75, side: THREE.DoubleSide }));
  flagMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = TIME;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        float ph = instanceMatrix[3].x * 0.07 + instanceMatrix[3].z * 0.05;
        float k = clamp(-position.x / 7.0, 0.0, 1.0);
        transformed.z += sin(uTime * 6.0 - position.x * 0.9 + ph) * 0.75 * k;
        transformed.y -= k * k * 0.6;
      }`).replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      {
        float ph2 = instanceMatrix[3].x * 0.07 + instanceMatrix[3].z * 0.05;
        float k2 = clamp(-position.x / 7.0, 0.0, 1.0);
        float dz = cos(uTime * 6.0 - position.x * 0.9 + ph2) * 0.75 * 0.9 * k2;
        objectNormal = normalize(vec3(dz, 0.0, 1.0));
      }`);
  };
  flagMat.customProgramCacheKey = () => 'flag';
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, spots.length);
  const flags = new THREE.InstancedMesh(flagGeo, flagMat, spots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const cols = G.SPR.SCHEMES.map((s) => new THREE.Color(s.paint));
  spots.forEach((o, n) => {
    pv.set(o.x, o.h, o.y);
    q.setFromAxisAngle(up, -o.a);
    m4.compose(pv, q, sv);
    poles.setMatrixAt(n, m4);
    flags.setMatrixAt(n, m4);
    flags.setColorAt(n, cols[(o.c * 3) % cols.length]);
  });
  for (const m of [poles, flags]) { m.castShadow = true; m.receiveShadow = true; m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); }
  flags.instanceColor.needsUpdate = true;
  return [poles, flags];
}

// ---------- clouds ----------
const CLOUDS = {
  farm: { cover: 0.55, color: '#ffffff', speed: 6 },
  desert: { cover: 0.2, color: '#fff0dc', speed: 4 },
  snow: { cover: 0.85, color: '#e8eef8', speed: 5 },
  swamp: { cover: 0.75, color: '#b8c4b0', speed: 3 },
  city: { cover: 0.6, color: '#c8ccd8', speed: 5 },
  forest: { cover: 0.5, color: '#ffffff', speed: 5 },
  beach: { cover: 0.35, color: '#ffffff', speed: 7 },
  volcano: { cover: 0.8, color: '#5a3a36', speed: 9 },
};
/** A cloud layer high above the track, fading out toward the horizon; follows the camera. */
export function cloudLayer(themeKey, fogCol, keep) {
  const cfg = CLOUDS[themeKey] || CLOUDS.farm;
  const R = 3600, ALT = 520;
  const g = keep(new THREE.RingGeometry(1, R, 48, 10));
  g.rotateX(Math.PI / 2); // face down
  const p = g.getAttribute('position');
  const cols = new Float32Array(p.count * 4);
  const c = new THREE.Color(cfg.color);
  for (let i = 0; i < p.count; i++) {
    const r = Math.hypot(p.getX(i), p.getZ(i)) / R;
    const a = 1 - U.clamp((r - 0.25) / 0.7, 0, 1);
    const col = c.clone().lerp(fogCol, U.clamp(r * 1.2, 0, 1) * 0.6);
    cols.set([col.r, col.g, col.b, a * a], i * 4);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 4));
  const tex = cloudTexture(cfg.cover);
  const map = tex.clone();
  map.needsUpdate = true;
  keep(map);
  map.repeat.set(5, 5);
  const m = keep(new THREE.MeshBasicMaterial({ map, vertexColors: true, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide }));
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = -9;
  mesh.frustumCulled = false;
  mesh.position.y = ALT;
  return {
    mesh,
    update(t, cam) {
      mesh.position.set(cam.x, ALT, cam.z);
      // keep the pattern fixed in the world (plus drift) while the disc follows the camera
      map.offset.set((cam.x + t * cfg.speed) / (2 * R) * 5, (cam.z + t * cfg.speed * 0.4) / (2 * R) * 5);
    },
  };
}
