// Next Gen effects: GPU point particles (soft dust/smoke, glowing fire/sparks) and skid marks.
// Positions are in simulation coordinates (x, y on the ground, z up) and converted when uploaded.
import * as THREE from '../../vendor/three/three.module.min.js';

const VERT = `
attribute float size;
attribute float alpha;
attribute vec3 tint;
uniform float scale;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = tint;
  vAlpha = alpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(size * scale / -mv.z, 1.0, 160.0);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.18, d) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

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
    this.grav = f(1); this.drag = f(1); this.r = f(1); this.g = f(1); this.b = f(1); this.a0 = f(1);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(f(3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(f(3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(f(1), 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(f(1), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('tint', this.aCol);
    geo.setAttribute('size', this.aSize);
    geo.setAttribute('alpha', this.aAlpha);
    geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 400 } },
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
  }

  update(dt, scale) {
    this.mat.uniforms.scale.value = scale;
    const P = this.aPos.array, C = this.aCol.array, S = this.aSize.array, A = this.aAlpha.array;
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { // swap-remove
        const j = --this.n;
        if (i !== j) {
          for (const k of ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'life', 'maxLife', 'size', 'grow', 'grav', 'drag', 'r', 'g', 'b', 'a0']) this[k][i] = this[k][j];
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
      A[i] = this.a0[i] * Math.min(1, f * 2.2);
      i++;
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = this.aAlpha.needsUpdate = true;
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
