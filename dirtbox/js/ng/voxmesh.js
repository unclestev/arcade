// Voxel model -> three.js geometry for the Next Gen view.
// Only faces next to empty space are emitted, each corner gets classic voxel ambient occlusion,
// and colours come from the model's palette (the same models the Classic sprites are drawn from).
//
// Voxel space: x = length (front at +x), y = width, z = up. Three.js local space: X = x, Y = z (up),
// Z = y, centred on the model's footprint with the bottom at Y = 0, so an object rotated by -heading
// faces the simulation's heading (world x, y map to three X, Z).
import * as THREE from '../../vendor/three/three.module.min.js';

const AO = [0.5, 0.68, 0.84, 1];
const toLinear = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };

// face direction, the two in-plane axes, and corner order (in voxel space)
const FACES = [
  { d: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { d: [-1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { d: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { d: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { d: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { d: [0, 0, -1], u: [1, 0, 0], v: [0, 1, 0] },
];
const CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];

// three.js position of a voxel-space point
function tp(p, ox, oy, s) { return [(p[0] - ox) * s, p[2] * s, (p[1] - oy) * s]; }
// voxel-space vector -> three.js vector
const tv = (a) => [a[0], a[2], a[1]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// whether corners 0,1,2 wind counter-clockwise seen from outside, per face
for (const f of FACES) {
  const e1 = tv(f.u), e2 = tv(f.v);
  f.flip = dot(cross(e1, e2), tv(f.d)) < 0;
}

/**
 * @param vox    { L, W, H, data, pal }
 * @param opts   scale (world units per voxel, default 1), keep(x, y, z, colorIndex) -> bool,
 *               centerZ (centre vertically instead of bottom at 0), tint (multiply colours)
 */
export function voxGeometry(vox, opts = {}) {
  const { L, W, H, data, pal } = vox;
  const s = opts.scale || 1;
  const keep = opts.keep;
  const solid = (x, y, z) => {
    if (x < 0 || y < 0 || z < 0 || x >= L || y >= W || z >= H) return false;
    const c = data[(z * W + y) * L + x];
    return c !== 0 && (!keep || keep(x, y, z, c));
  };
  const lin = pal.map((c) => (c ? [toLinear(c[0]), toLinear(c[1]), toLinear(c[2])] : null));
  const pos = [], nor = [], col = [], idx = [];
  const ox = L / 2, oy = W / 2, oz = opts.centerZ ? H / 2 : 0;
  for (let z = 0; z < H; z++) for (let y = 0; y < W; y++) for (let x = 0; x < L; x++) {
    if (!solid(x, y, z)) continue;
    const ci = data[(z * W + y) * L + x];
    const base = lin[ci];
    for (const f of FACES) {
      const nx = x + f.d[0], ny = y + f.d[1], nz = z + f.d[2];
      if (solid(nx, ny, nz)) continue;
      // face plane origin: the voxel corner, pushed to the far side for positive directions
      const o = [x + Math.max(0, f.d[0]), y + Math.max(0, f.d[1]), z + Math.max(0, f.d[2])];
      const aos = [];
      const v0 = pos.length / 3;
      for (const [cu, cv] of CORNERS) {
        const p = [o[0] + f.u[0] * cu + f.v[0] * cv, o[1] + f.u[1] * cu + f.v[1] * cv, o[2] + f.u[2] * cu + f.v[2] * cv];
        const q = tp(p, ox, oy, s);
        pos.push(q[0], q[1] - oz * s, q[2]);
        const n = tv(f.d);
        nor.push(n[0], n[1], n[2]);
        // ambient occlusion from the three voxels around this corner on the outside layer
        const su = cu ? 1 : -1, sv = cv ? 1 : -1;
        const a = [nx + f.u[0] * su, ny + f.u[1] * su, nz + f.u[2] * su];
        const b = [nx + f.v[0] * sv, ny + f.v[1] * sv, nz + f.v[2] * sv];
        const c = [nx + f.u[0] * su + f.v[0] * sv, ny + f.u[1] * su + f.v[1] * sv, nz + f.u[2] * su + f.v[2] * sv];
        const s1 = solid(a[0], a[1], a[2]) ? 1 : 0, s2 = solid(b[0], b[1], b[2]) ? 1 : 0, s3 = solid(c[0], c[1], c[2]) ? 1 : 0;
        const ao = s1 && s2 ? 0 : 3 - s1 - s2 - s3;
        aos.push(ao);
        const k = AO[ao] * (opts.tint || 1);
        col.push(base[0] * k, base[1] * k, base[2] * k);
      }
      // split the quad along the brighter diagonal (avoids AO streaks)
      const alt = aos[0] + aos[2] < aos[1] + aos[3];
      let tris = alt ? [[1, 2, 3], [1, 3, 0]] : [[0, 1, 2], [0, 2, 3]];
      if (f.flip) tris = tris.map((t) => [t[0], t[2], t[1]]);
      for (const t of tris) idx.push(v0 + t[0], v0 + t[1], v0 + t[2]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// One shared material for every voxel model: vertex colours, soft and slightly glossy.
let voxMat = null;
export function voxMaterial() {
  if (!voxMat) voxMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.05 });
  return voxMat;
}
