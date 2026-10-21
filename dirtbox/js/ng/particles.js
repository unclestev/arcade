// Next Gen effects: GPU point particles (soft dust/smoke, glowing fire/sparks) and skid marks.
// Positions are in simulation coordinates (x, y on the ground, z up) and converted when uploaded.
import * as THREE from '../../vendor/three/three.module.min.js';

const VERT = `
attribute float size;
attribute float alpha;
attribute vec3 tint;
attribute float seed;
uniform float scale;
varying vec3 vColor;
varying float vAlpha;
varying float vSeed;
void main() {
  vColor = tint;
  vAlpha = alpha;
  vSeed = seed;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(size * scale / -mv.z, 1.0, 160.0);
  gl_Position = projectionMatrix * mv;
}`;
// Soft particles are lumpy, top-lit puffs (three offset blobs per particle, turned by its seed);
// glowing ones get a hot core.
const FRAG = `
uniform float puff;
varying vec3 vColor;
varying float vAlpha;
varying float vSeed;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p);
  float a = smoothstep(0.5, 0.18, d);
  vec3 col = vColor;
  if (puff > 0.5) {
    float s = vSeed * 6.2831;
    vec2 o1 = vec2(cos(s), sin(s)) * 0.15;
    vec2 o2 = vec2(cos(s + 2.1), sin(s + 2.1)) * 0.14;
    vec2 o3 = vec2(cos(s + 4.2), sin(s + 4.2)) * 0.12;
    float b = max(max(smoothstep(0.33, 0.06, length(p - o1)), smoothstep(0.31, 0.06, length(p - o2))), smoothstep(0.32, 0.08, length(p - o3)));
    a = max(a * 0.5, b) * smoothstep(0.5, 0.36, d);
    col *= 0.86 + clamp(-p.y * 0.7 + 0.12, 0.0, 0.32);
  } else {
    col *= 1.0 + smoothstep(0.26, 0.0, d) * 1.3;
  }
  a *= vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const KEYS = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'life', 'maxLife', 'size', 'grow', 'grav', 'drag', 'r', 'g', 'b', 'a0', 'sd'];
const colorCache = new Map();
function lin(hex) {
  let c = colorCache.get(hex);
  if (!c) { c = new THREE.Color(hex); colorCache.set(hex, c); }
  return c;
}

export class Particles {
  constructor(max, additive) {
    this.max = max;
    this.n = 0;
    const f = (k) => new Float32Array(max * k);
    // per particle state
    this.px = f(1); this.py = f(1); this.pz = f(1);
    this.vx = f(1); this.vy = f(1); this.vz = f(1);
    this.life = f(1); this.maxLife = f(1); this.size = f(1); this.grow = f(1);
    this.grav = f(1); this.drag = f(1); this.r = f(1); this.g = f(1); this.b = f(1); this.a0 = f(1); this.sd = f(1);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(f(3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(f(3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(f(1), 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(f(1), 1).setUsage(THREE.DynamicDrawUsage);
    this.aSeed = new THREE.BufferAttribute(f(1), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('tint', this.aCol);
    geo.setAttribute('size', this.aSize);
    geo.setAttribute('alpha', this.aAlpha);
    geo.setAttribute('seed', this.aSeed);
    geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 400 }, puff: { value: additive ? 0 : 1 } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
  }

  spawn(x, y, z, vx, vy, vz, life, color, size, grav, drag, grow, alpha) {
    let i = this.n;
    if (i >= this.max) { // full: overwrite the oldest-ish slot
      i = (Math.random() * this.max) | 0;
    } else this.n++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = size; this.grow[i] = grow || 0;
    this.grav[i] = grav === undefined ? 200 : grav; this.drag[i] = drag || 0;
    const c = lin(color);
    this.r[i] = c.r; this.g[i] = c.g; this.b[i] = c.b;
    this.a0[i] = alpha === undefined ? 1 : alpha;
    this.sd[i] = Math.random();
  }

  update(dt, scale) {
    this.mat.uniforms.scale.value = scale;
    const P = this.aPos.array, C = this.aCol.array, S = this.aSize.array, A = this.aAlpha.array, D = this.aSeed.array;
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { // swap-remove
        const j = --this.n;
        if (i !== j) {
          for (const k of KEYS) this[k][i] = this[k][j];
        }
        continue;
      }
      if (this.drag[i]) { const k = Math.exp(-this.drag[i] * dt); this.vx[i] *= k; this.vy[i] *= k; this.vz[i] *= k; }
      this.vz[i] -= this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      if (this.pz[i] < 0.2) { this.pz[i] = 0.2; this.vz[i] = -this.vz[i] * 0.3; this.vx[i] *= 0.7; this.vy[i] *= 0.7; }
      this.size[i] += this.grow[i] * dt;
      const f = this.life[i] / this.maxLife[i];
      P[i * 3] = this.px[i]; P[i * 3 + 1] = this.pz[i]; P[i * 3 + 2] = this.py[i];
      C[i * 3] = this.r[i]; C[i * 3 + 1] = this.g[i]; C[i * 3 + 2] = this.b[i];
      S[i] = this.size[i];
      D[i] = this.sd[i];
      A[i] = this.a0[i] * Math.min(1, f * 2.2);
      i++;
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = this.aAlpha.needsUpdate = this.aSeed.needsUpdate = true;
  }
  clear() { this.n = 0; this.points.geometry.setDrawRange(0, 0); }
  dispose() { this.points.geometry.dispose(); this.mat.dispose(); }
}

// Tyre marks: a ring buffer of thin quads laid on the ground.
export class Skids {
  constructor(max) {
    this.max = max;
    this.next = 0;
    this.count = 0;
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(max * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pos);
    const idx = new Uint32Array(max * 6);
    for (let q = 0; q < max; q++) { const v = q * 4; idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], q * 6); }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    this.mat = new THREE.MeshBasicMaterial({ color: '#100a0c', transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }
  add(x0, y0, x1, y1, w, h) {
    const dx = x1 - x0, dy = y1 - y0;
    const l = Math.hypot(dx, dy);
    if (l < 0.01 || l > 12) return;
    const nx = (-dy / l) * w, ny = (dx / l) * w;
    const a = this.pos.array, o = this.next * 12;
    a[o] = x0 - nx; a[o + 1] = h; a[o + 2] = y0 - ny;
    a[o + 3] = x0 + nx; a[o + 4] = h; a[o + 5] = y0 + ny;
    a[o + 6] = x1 - nx; a[o + 7] = h; a[o + 8] = y1 - ny;
    a[o + 9] = x1 + nx; a[o + 10] = h; a[o + 11] = y1 + ny;
    this.next = (this.next + 1) % this.max;
    this.count = Math.min(this.max, this.count + 1);
    this.mesh.geometry.setDrawRange(0, this.count * 6);
    this.pos.needsUpdate = true;
  }
  clear() { this.next = 0; this.count = 0; this.mesh.geometry.setDrawRange(0, 0); }
  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); }
}

// Ground decals: scorch marks and mud splats laid on the road, fading out over time.
// One mesh for all of them (a ring buffer of quads with per-vertex alpha).
export class Decals {
  constructor(max, texture, opts = {}) {
    this.max = max;
    this.next = 0;
    this.count = 0;
    this.items = [];
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(max * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.col = new THREE.BufferAttribute(new Float32Array(max * 4 * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const uv = new Float32Array(max * 8);
    const idx = new Uint32Array(max * 6);
    for (let q = 0; q < max; q++) { uv.set([0, 0, 1, 0, 0, 1, 1, 1], q * 8); const v = q * 4; idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], q * 6); }
    geo.setAttribute('position', this.pos);
    geo.setAttribute('color', this.col);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    this.mat = new THREE.MeshBasicMaterial({ map: texture, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -10, blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }
  add(x, y, r, color, life, h) {
    const a = Math.random() * Math.PI * 2, c = Math.cos(a) * r, s = Math.sin(a) * r;
    const o = this.next * 12, p = this.pos.array;
    const corners = [[-c + s, -s - c], [c + s, s - c], [-c - s, -s + c], [c - s, s + c]];
    corners.forEach(([dx, dy], k) => { p[o + k * 3] = x + dx; p[o + k * 3 + 1] = h; p[o + k * 3 + 2] = y + dy; });
    const col = new THREE.Color(color);
    this.items[this.next] = { r: col.r, g: col.g, b: col.b, life, max: life };
    this.next = (this.next + 1) % this.max;
    this.count = Math.min(this.max, this.count + 1);
    this.mesh.geometry.setDrawRange(0, this.count * 6);
    this.pos.needsUpdate = true;
  }
  update(dt) {
    const C = this.col.array;
    for (let q = 0; q < this.count; q++) {
      const it = this.items[q];
      if (!it) continue;
      it.life = Math.max(0, it.life - dt);
      const a = Math.min(1, it.life / (it.max * 0.4));
      for (let k = 0; k < 4; k++) C.set([it.r, it.g, it.b, a], (q * 4 + k) * 4);
    }
    this.col.needsUpdate = true;
  }
  clear() { this.next = 0; this.count = 0; this.items.length = 0; this.mesh.geometry.setDrawRange(0, 0); }
}

// Expanding rings on the ground: explosion shockwaves (additive) and ripples on water.
export class Rings {
  constructor(max) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 30, 64, 64, 63);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, 'rgba(255,255,255,0.15)'); g.addColorStop(0.9, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    this.tex = new THREE.CanvasTexture(c);
    this.geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    this.list = [];
    this.group = new THREE.Group();
    for (let i = 0; i < max; i++) {
      const m = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 }));
      m.visible = false;
      m.renderOrder = 2;
      this.group.add(m);
      this.list.push({ m, t: 0, dur: 1, r0: 1, r1: 10, a: 1 });
    }
  }
  add(x, y, h, r0, r1, dur, color, alpha, additive) {
    const it = this.list.find((q) => !q.m.visible) || this.list.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b));
    it.m.visible = true;
    it.m.position.set(x, h, y);
    it.m.material.color.set(color);
    const blend = additive === false ? THREE.NormalBlending : THREE.AdditiveBlending;
    if (it.m.material.blending !== blend) { it.m.material.blending = blend; it.m.material.needsUpdate = true; }
    Object.assign(it, { t: 0, dur, r0, r1, a: alpha });
    it.m.scale.setScalar(r0);
  }
  update(dt) {
    for (const it of this.list) {
      if (!it.m.visible) continue;
      it.t += dt;
      const k = it.t / it.dur;
      if (k >= 1) { it.m.visible = false; continue; }
      const e = 1 - (1 - k) * (1 - k);
      it.m.scale.setScalar(it.r0 + (it.r1 - it.r0) * e);
      it.m.material.opacity = it.a * (1 - k);
    }
  }
  clear() { for (const it of this.list) it.m.visible = false; }
}

// Splat texture for decals: white with a ragged alpha edge (tinted by the decal colour).
// kind 'scorch' = soft blast mark with streaks, 'splat' = blobby mud splash with drops.
export function splatTexture(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  if (kind === 'scorch') {
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 60);
    g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.5, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, r0 = 18 + Math.random() * 10, r1 = 40 + Math.random() * 22;
      ctx.lineWidth = 1 + Math.random() * 4;
      ctx.beginPath(); ctx.moveTo(64 + Math.cos(a) * r0, 64 + Math.sin(a) * r0); ctx.lineTo(64 + Math.cos(a) * r1, 64 + Math.sin(a) * r1); ctx.stroke();
    }
  } else {
    ctx.filter = 'blur(1.5px)';
    ctx.beginPath(); ctx.arc(64, 64, 26, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 9; i++) { const a = Math.random() * 6.28, r = 16 + Math.random() * 16; ctx.beginPath(); ctx.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 8 + Math.random() * 10, 0, 6.28); ctx.fill(); }
    for (let i = 0; i < 22; i++) { const a = Math.random() * 6.28, r = 36 + Math.random() * 22; ctx.beginPath(); ctx.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 1.5 + Math.random() * 3.5, 0, 6.28); ctx.fill(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
