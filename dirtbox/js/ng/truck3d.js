// Next Gen truck: a smooth, modern mid-size SUV (long hood, raked windscreen, blacked-out "floating
// roof" pillars, roof rails, slim LED lights, two-tone alloys). Generic styling: no brand badges,
// logos or model lettering anywhere. Purely visual; the simulation never sees any of this.
//
// Local space matches the old voxel truck: +X = forward, Y = up, Z = across, ground at Y = 0.
// Body parts are merged into one geometry with a group per material (paint, glass, black trim,
// chrome, lamps), so each truck costs a handful of draw calls.
import * as THREE from '../../vendor/three/three.module.min.js';
import { G } from '../ns.js';

export const WHEEL_R = 2.3;
export const WHEELS = [[-4, -3.82, false], [-4, 3.82, false], [5, -3.82, true], [5, 3.82, true]]; // x, z, steers
const ARCH_R = 2.75;
const BOTTOM = 1.45;

// ---------- geometry helpers ----------
// Every part becomes a non-indexed geometry with position, normal and color, so parts merge freely.
function prep(g, color) {
  let n = g.index ? g.toNonIndexed() : g;
  if (g.index) g.dispose();
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
  if (!n.getAttribute('normal')) n.computeVertexNormals();
  const c = new THREE.Color(color || '#ffffff');
  const cnt = n.getAttribute('position').count;
  const cols = new Float32Array(cnt * 3);
  for (let i = 0; i < cnt; i++) { cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
  n.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return n;
}
// Lamps can be brighter than white (tone mapping keeps them punchy rather than clipped).
function glowColor(g, hex, k) {
  const c = new THREE.Color(hex).multiplyScalar(k);
  const a = g.getAttribute('color');
  for (let i = 0; i < a.count; i++) a.setXYZ(i, c.r, c.g, c.b);
  return g;
}
// Merge lists of parts (one list per material) into a single geometry with groups.
function merge(lists) {
  let total = 0;
  for (const l of lists) for (const g of l) total += g.getAttribute('position').count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  const out = new THREE.BufferGeometry();
  let o = 0;
  lists.forEach((l, mi) => {
    const start = o;
    for (const g of l) {
      const n = g.getAttribute('position').count;
      pos.set(g.getAttribute('position').array, o * 3);
      nor.set(g.getAttribute('normal').array, o * 3);
      col.set(g.getAttribute('color').array, o * 3);
      o += n;
      g.dispose();
    }
    if (o > start) out.addGroup(start, o - start, mi);
  });
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}
function box(sx, sy, sz, x, y, z, color) {
  return prep(new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z), color);
}
// a bar from (x1, y1) to (x2, y2) at depth z
function bar(x1, y1, x2, y2, z, th, dep, color) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const g = new THREE.BoxGeometry(len, th, dep).rotateZ(Math.atan2(y2 - y1, x2 - x1)).translate((x1 + x2) / 2, (y1 + y2) / 2, z);
  return prep(g, color);
}
function cyl(r, len, x, y, z, color, seg) {
  return prep(new THREE.CylinderGeometry(r, r, len, seg || 14).rotateZ(Math.PI / 2).translate(x, y, z), color);
}
// side-profile extrusion, centred across Z
function profile(pts, depth, bevel, color) {
  if (bevel > 0) pts = inset(pts, bevel);
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 8 });
  g.translate(0, 0, -depth / 2);
  return prep(g, color);
}
// pull the upper part in toward the centre line (tumblehome)
function tumble(g, y0, y1, amount) {
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const f = THREE.MathUtils.clamp((p.getY(i) - y0) / (y1 - y0), 0, 1);
    p.setZ(i, p.getZ(i) * (1 - amount * f));
  }
  g.computeVertexNormals();
  return g;
}
// both sides: build at +Z, mirror to -Z
function pair(fn) { return [fn(1), fn(-1)]; }
function archPts(cx) {
  const out = [];
  const phi = Math.asin((WHEEL_R - BOTTOM) / ARCH_R);
  for (let i = 0; i <= 14; i++) {
    const a = Math.PI + phi - (i / 14) * (Math.PI + 2 * phi);
    out.push([cx + Math.cos(a) * ARCH_R, WHEEL_R + Math.sin(a) * ARCH_R]);
  }
  return out;
}
// Pull a closed outline in by d, so that once the extrusion's bevel grows it back out, the outer
// surface lands on the coordinates written below.
function inset(pts, d) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a[0] * b[1] - b[0] * a[1]; }
  const sg = area > 0 ? 1 : -1;
  const nrm = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [-dy / l * sg, dx / l * sg]; };
  return pts.map((p, i) => {
    const n1 = nrm(pts[(i - 1 + pts.length) % pts.length], p), n2 = nrm(p, pts[(i + 1) % pts.length]);
    const k = d / Math.max(0.35, 1 + n1[0] * n2[0] + n1[1] * n2[1]);
    return [p[0] + (n1[0] + n2[0]) * k, p[1] + (n1[1] + n2[1]) * k];
  });
}

// ---------- the body ----------
const BLACK = '#121216', SATIN = '#24262c', GREY = '#3a3d44', PLATE = '#dcdcd6';
function bodyGeometry() {
  const paint = [], glass = [], trim = [], chrome = [], lamps = [];
  // lower body: side profile with both wheel arches cut out of the bottom edge
  const lower = [[-8.0, BOTTOM], ...archPts(-4), ...archPts(5), [8.05, BOTTOM], [8.5, 1.9], [8.66, 3.0], [8.68, 4.45], [8.45, 5.18],
    [6.0, 5.52], [2.8, 5.76], [-6.4, 5.95], [-7.85, 6.02], [-8.35, 5.55], [-8.48, 3.7], [-8.38, 2.0]];
  paint.push(profile(lower, 8.6, 0.32));
  // greenhouse: dark glass all round with the pillars blacked out (the "floating roof" look)
  glass.push(tumble(profile([[2.95, 5.6], [0.4, 8.18], [-6.85, 8.32], [-7.9, 6.0], [-7.85, 5.6]], 7.3, 0.28), 5.8, 8.6, 0.09));
  // roof panel, body colour, sits on the glass
  paint.push(tumble(profile([[0.62, 8.32], [-6.95, 8.46], [-7.12, 8.72], [-0.4, 8.84], [0.42, 8.6]], 6.6, 0.24), 5.8, 8.6, 0.09));
  // pillars: B and C in satin black, a chrome strip under the side glass that kicks up at the back
  for (const s of [1, -1]) {
    trim.push(tumble(bar(-1.65, 5.95, -1.45, 8.28, s * 3.96, 0.55, 0.12, BLACK), 5.8, 8.6, 0.09));
    trim.push(tumble(bar(-5.15, 5.95, -4.85, 8.34, s * 3.96, 0.45, 0.12, BLACK), 5.8, 8.6, 0.09));
    chrome.push(bar(2.75, 5.86, -6.2, 5.98, s * 4.0, 0.13, 0.1));
    chrome.push(tumble(bar(-6.2, 5.98, -7.55, 6.5, s * 4.0, 0.13, 0.1), 5.8, 8.6, 0.09));
    chrome.push(tumble(bar(0.55, 8.2, -6.75, 8.35, s * 3.98, 0.1, 0.1), 5.8, 8.6, 0.09));
    // mirrors
    paint.push(box(0.95, 0.62, 0.7, 2.15, 6.35, s * 4.78));
    trim.push(box(0.6, 0.25, 0.5, 2.3, 5.98, s * 4.5, BLACK));
    // door seams and handles
    for (const x of [2.85, -1.55]) trim.push(box(0.06, 3.6, 0.04, x, 3.95, s * 4.63, '#0c0c0e'));
    trim.push(bar(-5.0, 2.6, -5.3, 5.8, s * 4.63, 0.06, 0.04, '#0c0c0e'));
    chrome.push(box(0.75, 0.16, 0.08, 1.2, 5.25, s * 4.66));
    chrome.push(box(0.75, 0.16, 0.08, -2.6, 5.3, s * 4.66));
    // lower body cladding and wheel-arch flares
    trim.push(box(3.6, 0.72, 0.12, 0.5, 1.82, s * 4.66, BLACK));
    for (const cx of [-4, 5]) {
      const sh = new THREE.Shape();
      const phi = 0.28;
      sh.absarc(0, 0, ARCH_R + 0.45, -phi, Math.PI + phi, false);
      sh.absarc(0, 0, ARCH_R, Math.PI + phi, -phi, true);
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.42, bevelEnabled: false, curveSegments: 18 });
      g.translate(cx, WHEEL_R, s > 0 ? 4.32 : -4.74);
      trim.push(prep(g, BLACK));
    }
    // roof rails with feet
    trim.push(box(6.6, 0.22, 0.32, -3.3, 9.2, s * 2.95, SATIN));
    for (const x of [-0.2, -6.4]) trim.push(box(0.6, 0.42, 0.3, x, 8.98, s * 2.95, SATIN));
  }
  // ---- front ----
  trim.push(box(0.22, 1.6, 4.4, 8.68, 3.5, 0, BLACK));                       // grille
  for (const y of [2.95, 3.4, 3.85]) chrome.push(box(0.12, 0.09, 4.2, 8.8, y, 0));
  chrome.push(box(0.16, 0.2, 6.2, 8.74, 4.38, 0));                               // bar linking the headlamps
  trim.push(box(0.25, 0.62, 5.6, 8.55, 2.1, 0, BLACK));                         // lower intake
  trim.push(box(0.2, 0.32, 3.0, 8.42, 1.62, 0, GREY));                           // skid plate
  for (const s of [1, -1]) {
    trim.push(box(0.5, 0.56, 1.95, 8.52, 4.66, s * 3.45, BLACK));               // headlamp housing
    lamps.push(glowColor(box(0.12, 0.12, 1.75, 8.79, 4.8, s * 3.45), '#ffffff', 3.2));
    lamps.push(glowColor(box(0.1, 0.24, 0.9, 8.79, 4.56, s * 3.0), '#eaf2ff', 1.6));
    lamps.push(glowColor(box(0.6, 0.12, 0.1, 8.3, 4.72, s * 4.5), '#ffb030', 2.2)); // side marker
    lamps.push(glowColor(box(0.1, 0.18, 0.55, 8.62, 2.1, s * 3.4), '#ffffff', 1.4)); // fog lamp
  }
  // ---- rear ----
  for (const s of [1, -1]) {
    lamps.push(glowColor(box(0.18, 1.0, 1.55, -8.52, 5.12, s * 3.72), '#ff1a14', 1.15));
    lamps.push(glowColor(box(0.12, 0.12, 1.4, -8.62, 5.38, s * 3.72), '#ff3020', 2.6));  // LED line
    lamps.push(glowColor(box(0.9, 0.62, 0.12, -8.05, 5.32, s * 4.6), '#ff1a14', 1.15));  // wrap-around
    lamps.push(glowColor(box(0.1, 0.3, 0.5, -8.6, 4.45, s * 3.95), '#f4f4ff', 0.9));     // reverse lamp
    chrome.push(cyl(0.3, 0.7, -8.55, 1.75, s * 2.7));                                    // exhaust tips
    trim.push(cyl(0.2, 0.72, -8.56, 1.75, s * 2.7, '#050505'));
  }
  trim.push(box(0.14, 0.42, 4.9, -8.56, 5.2, 0, BLACK));                       // liftgate band
  chrome.push(box(0.1, 0.1, 4.9, -8.6, 4.92, 0));
  trim.push(box(0.12, 1.3, 2.7, -8.55, 3.55, 0, BLACK));                       // plate recess
  trim.push(box(0.08, 1.05, 2.4, -8.6, 3.55, 0, PLATE));                       // blank plate
  trim.push(box(0.5, 0.95, 8.9, -8.3, 2.05, 0, BLACK));                        // rear bumper lower
  trim.push(box(0.5, 0.95, 8.9, 8.3, 1.9, 0, BLACK));                         // front bumper lower
  paint.push(box(0.75, 0.28, 6.6, -7.05, 8.86, 0));                            // roof spoiler
  lamps.push(glowColor(box(0.1, 0.1, 1.6, -7.45, 8.78, 0), '#ff2018', 2.2));   // high brake lamp
  trim.push(box(1.1, 0.4, 0.5, -5.9, 9.0, 0, BLACK));                          // shark-fin antenna
  return merge([paint, glass, trim, chrome, lamps]);
}

// ---------- wheels ----------
function wheelGeometry(side) {
  const rubber = [], metal = [];
  const r = WHEEL_R, h = 0.88;
  const prof = [[1.62, -h], [r - 0.22, -h], [r - 0.04, -h + 0.22], [r, -h + 0.42], [r, h - 0.42], [r - 0.04, h - 0.22], [r - 0.22, h], [1.62, h]];
  rubber.push(prep(new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 26), '#1c1c20'));
  // tread blocks
  for (let i = 0; i < 30; i++) {
    const g = new THREE.BoxGeometry(0.3, 1.45, 0.07).translate(0, 0, r).rotateY((i / 30) * Math.PI * 2);
    rubber.push(prep(g, '#222227'));
  }
  // rim barrel and dish (gunmetal), machined spokes, centre cap (no logo)
  metal.push(prep(new THREE.CylinderGeometry(1.64, 1.64, 1.7, 26, 1, true), '#2a2c32'));
  metal.push(prep(new THREE.CylinderGeometry(1.6, 1.6, 0.12, 26).translate(0, 0.62, 0), '#1e2026'));
  for (let i = 0; i < 6; i++) {
    for (const off of [-0.17, 0.17]) {
      const a = (i / 6) * Math.PI * 2 + off;
      const g = new THREE.BoxGeometry(0.2, 0.2, 1.25).translate(0, 0.78, 0.92).rotateY(a);
      metal.push(prep(g, '#d4d8de'));
    }
  }
  metal.push(prep(new THREE.CylinderGeometry(0.46, 0.5, 0.26, 18).translate(0, 0.86, 0), '#e8ecf0'));
  metal.push(prep(new THREE.TorusGeometry(1.6, 0.07, 6, 30).rotateX(Math.PI / 2).translate(0, 0.86, 0), '#d4d8de'));
  const out = merge([rubber, metal]);
  out.rotateX(Math.PI / 2); // axle along Z, face toward +Z
  if (side < 0) mirrorZ(out);
  return out;
}
// Mirror across Z and keep triangles facing out.
function mirrorZ(g) {
  g.scale(1, 1, -1);
  for (const k of ['position', 'normal', 'color']) {
    const a = g.getAttribute(k).array;
    for (let i = 0; i < a.length; i += 9) for (let j = 0; j < 3; j++) { const t = a[i + 3 + j]; a[i + 3 + j] = a[i + 6 + j]; a[i + 6 + j] = t; }
  }
  g.computeBoundingSphere();
}

// ---------- materials ----------
let shared = null;
function sharedParts() {
  if (shared) return shared;
  shared = {
    body: bodyGeometry(),
    wheel: [wheelGeometry(-1), wheelGeometry(1)],
    glass: new THREE.MeshStandardMaterial({ color: '#0a0e15', metalness: 0.85, roughness: 0.06, envMapIntensity: 1.3 }),
    trim: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.15 }),
    flame: null,
    chrome: new THREE.MeshStandardMaterial({ color: '#f2f4f8', metalness: 1, roughness: 0.12 }),
    lamps: new THREE.MeshBasicMaterial({ vertexColors: true }),
    rubber: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }),
    rim: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.85 }),
    env: null,
  };
  return shared;
}
// ---------- grime: mud, scorch and scrapes painted on in the shader ----------
// Each truck has its own copies of the paint, trim and wheel materials with three uniforms:
// uDirt (mud that builds up while racing, from the sills upward), uScorch (soot from hits) and
// uScuff (bare scratches along the sides from the walls). Patterns come from noise on the model's
// local coordinates, so they stick to the body (and turn with the wheels).
const GRIME_GLSL = `
uniform float uDirt;
uniform float uScorch;
uniform float uScuff;
uniform vec3 uMud;
varying vec3 vDirtPos;
float dzHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float dzNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dzHash(i), dzHash(i + vec3(1, 0, 0)), f.x), mix(dzHash(i + vec3(0, 1, 0)), dzHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(dzHash(i + vec3(0, 0, 1)), dzHash(i + vec3(1, 0, 1)), f.x), mix(dzHash(i + vec3(0, 1, 1)), dzHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;
const GRIME_MASK = {
  // body and trim: a ragged mud line that climbs as dirt builds, heavier around the wheel arches
  // and on the tailgate; scratches only on the flanks below the windows
  body: `
    float lineH = 1.3 + uDirt * 4.6 + (dzNoise(vec3(q.x * 0.45, 0.0, q.z * 0.45)) - 0.5) * 1.8;
    float low = 1.0 - smoothstep(lineH - 1.3, lineH + 0.7, q.y);
    float arch = max(1.0 - smoothstep(1.5, 4.2, length(vec2(q.x + 4.0, q.y - 2.3))), 1.0 - smoothstep(1.5, 4.2, length(vec2(q.x - 5.0, q.y - 2.3))));
    float rear = smoothstep(-6.5, -8.6, q.x) * (1.0 - smoothstep(2.5 + uDirt * 3.5, 6.0 + uDirt * 2.5, q.y));
    mudM = clamp((low + arch * 0.7 + rear * 0.6) * smoothstep(0.4 - uDirt * 0.28, 0.62 - uDirt * 0.22, n1), 0.0, 1.0) * smoothstep(0.0, 0.1, uDirt);
    scuffM = uScuff * smoothstep(3.5, 4.4, abs(q.z)) * smoothstep(0.8, 0.9, dzNoise(vec3(q.x * 0.3, q.y * 6.0, q.z * 0.5))) * (1.0 - smoothstep(5.4, 6.0, q.y));`,
  rim: `
    mudM = smoothstep(0.58 - uDirt * 0.5, 0.78 - uDirt * 0.42, n1) * smoothstep(0.0, 0.08, uDirt);`,
  tyre: `
    mudM = clamp(uDirt * (0.35 + n1 * 0.55), 0.0, 0.8);`,
};
function grime(mat, kind) {
  const u = { uDirt: { value: 0 }, uScorch: { value: 0 }, uScuff: { value: 0 }, uMud: { value: new THREE.Color('#5a4228') } };
  mat.userData.grime = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'varying vec3 vDirtPos;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvDirtPos = position;');
    sh.fragmentShader = GRIME_GLSL + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
  float mudM = 0.0, scorchM = 0.0, scuffM = 0.0;
  {
    vec3 q = vDirtPos;
    float n1 = dzNoise(q * 0.85) * 0.65 + dzNoise(q * 2.6 + 7.0) * 0.35;
    ${GRIME_MASK[kind]}
    scorchM = uScorch * smoothstep(0.45, 0.72, dzNoise(q * 0.42 + 31.0) * 0.7 + dzNoise(q * 1.7) * 0.3);
    vec3 mudCol = uMud * (0.72 + n1 * 0.5);
    diffuseColor.rgb = mix(diffuseColor.rgb, mudCol, mudM * 0.94);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.6, 0.6, 0.62), scuffM * 0.85);
    diffuseColor.rgb *= 1.0 - scorchM * 0.85;
  }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n\troughnessFactor = mix(roughnessFactor, 0.95, max(mudM, scorchM * 0.7));')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n\tmetalnessFactor *= 1.0 - max(mudM, scorchM);')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n\t#ifdef USE_CLEARCOAT\n\tmaterial.clearcoat *= 1.0 - max(mudM, scorchM);\n\t#endif');
  };
  mat.customProgramCacheKey = () => 'grime:' + kind;
  return mat;
}

function paint(scheme) {
  const sc = G.SPR.SCHEMES[scheme];
  // clear-coated paint; phones get the plain (cheaper) version with a glossier base instead
  const lite = G.NG_QUALITY && G.NG_QUALITY.lite;
  const m = lite
    ? new THREE.MeshStandardMaterial({ color: sc.paint, metalness: 0.45, roughness: 0.22, envMapIntensity: 1.1 })
    : new THREE.MeshPhysicalMaterial({ color: sc.paint, metalness: 0.45, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1 });
  return grime(m, 'body');
}
// Every live truck's own materials (so the reflection map can be swapped on all of them).
const live = new Set();
// Reflections for every truck material (the track's sky, or the showroom's softboxes).
export function setTruckEnv(env) {
  const S = sharedParts();
  if (S.env === env) return;
  S.env = env;
  for (const m of [S.glass, S.chrome, ...live]) { m.envMap = env; m.needsUpdate = true; }
}
function own(m) {
  const S = sharedParts();
  m.envMap = S.env;
  live.add(m);
  return m;
}

// Soft dark patch under each truck so it sits on the road.
let contactTex = null;
function contactMaterial() {
  if (!contactTex) {
    const c = G.U.makeCanvas(64, 128);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 64, 4, 32, 64, 62);
    g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(0.55, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.setTransform(1, 0, 0, 2, 0, -64); // stretch the falloff along the truck
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 128);
    contactTex = new THREE.CanvasTexture(c);
  }
  return new THREE.MeshBasicMaterial({ color: '#000000', alphaMap: contactTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
}
let contactGeo = null, glowGeo = null;
function brakeGlowGeometry() {
  if (glowGeo) return glowGeo;
  const parts = [];
  for (const s of [1, -1]) parts.push(new THREE.PlaneGeometry(2.6, 1.9).rotateY(-Math.PI / 2).translate(-8.75, 5.15, s * 3.72));
  parts.push(new THREE.PlaneGeometry(2.2, 0.8).rotateY(-Math.PI / 2).translate(-7.55, 8.8, 0));
  const pos = [], uv = [];
  for (const p of parts) { const n = p.toNonIndexed(); pos.push(...n.getAttribute('position').array); uv.push(...n.getAttribute('uv').array); p.dispose(); n.dispose(); }
  glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  glowGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return glowGeo;
}
let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = G.U.makeCanvas(64, 64);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

// Nitro flames out of both exhaust tips: additive cones, white-blue at the pipe fading through
// orange to nothing. Built pointing along -X from x = 0 (the group sits at the tips).
let flameGeo = null;
function flameGeometry() {
  if (flameGeo) return flameGeo;
  const parts = [];
  const shade = (g, inner) => {
    const p = g.getAttribute('position');
    const cols = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const t = U01(-p.getX(i) / (inner ? 2.0 : 4.6));
      const c = inner ? new THREE.Color('#d8ecff').lerp(new THREE.Color('#3a6cff'), t).multiplyScalar(0.8 * (1 - t))
        : new THREE.Color('#ffd070').lerp(new THREE.Color('#ff4a08'), Math.min(1, t * 1.8)).multiplyScalar(0.55 * Math.pow(1 - t, 1.2));
      cols.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    return g;
  };
  for (const s of [1, -1]) {
    parts.push(shade(new THREE.ConeGeometry(0.7, 4.6, 12, 4, true).rotateZ(Math.PI / 2).translate(-2.3, 0, s * 2.7).toNonIndexed(), false));
    parts.push(shade(new THREE.ConeGeometry(0.36, 2.0, 8, 2, true).rotateZ(Math.PI / 2).translate(-1.0, 0, s * 2.7).toNonIndexed(), true));
  }
  const pos = [], col = [];
  for (const g of parts) { pos.push(...g.getAttribute('position').array); col.push(...g.getAttribute('color').array); g.dispose(); }
  flameGeo = new THREE.BufferGeometry();
  flameGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  flameGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return flameGeo;
}
const U01 = (v) => Math.max(0, Math.min(1, v));
let flameMat = null;

/** A complete truck: root (position/heading), pivot (suspension), body, four wheels, brake glow, contact shadow. */
export function makeTruck(scheme, opts = {}) {
  const S = sharedParts();
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  root.add(pivot);
  const mats = {
    paint: own(paint(scheme)),
    trim: own(grime(S.trim.clone(), 'body')),
    rim: own(grime(S.rim.clone(), 'rim')),
    rubber: own(grime(S.rubber.clone(), 'tyre')),
  };
  const body = new THREE.Mesh(S.body, [mats.paint, S.glass, mats.trim, S.chrome, S.lamps]);
  body.castShadow = true;
  body.receiveShadow = true;
  pivot.add(body);
  const glow = new THREE.Mesh(brakeGlowGeometry(), new THREE.MeshBasicMaterial({ color: '#ff2a18', map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.3 }));
  pivot.add(glow);
  if (!flameMat) flameMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const flames = new THREE.Mesh(flameGeometry(), flameMat);
  flames.position.set(-8.9, 1.75, 0);
  flames.visible = false;
  pivot.add(flames);
  const wheels = [];
  for (const [x, z, front] of WHEELS) {
    const steer = new THREE.Group();
    steer.position.set(x, WHEEL_R, z);
    const w = new THREE.Mesh(S.wheel[z > 0 ? 1 : 0], [mats.rubber, mats.rim]);
    w.castShadow = !!opts.wheelShadows;
    steer.add(w);
    root.add(steer);
    wheels.push({ steer, w, front });
  }
  if (!contactGeo) contactGeo = new THREE.PlaneGeometry(21, 11.5).rotateX(-Math.PI / 2);
  const contact = new THREE.Mesh(contactGeo, contactMaterial());
  contact.renderOrder = -1;
  const grimeU = [mats.paint, mats.trim, mats.rim, mats.rubber].map((m) => m.userData.grime);
  const tr = {
    root, pivot, body, glow, contact, wheels, flames, spin: 0, pitch: 0, roll: 0, pv: 0, rv: 0, acc: 0, bounce: 0, bv: 0, prevVF: 0, prevH: null, prevW: null, wasAir: false, brake: 0,
    dirt: 0, scorch: 0, scuff: 0, smokeT: 0, odo: 0,
    /** Grime levels 0..1 (mud, soot, scrapes) and the mud colour. */
    setGrime(dirt, scorch, scuff, mud) {
      for (const u of grimeU) {
        u.uDirt.value = dirt; u.uScorch.value = scorch; u.uScuff.value = scuff;
        if (mud) u.uMud.value.set(mud);
      }
    },
    dispose() {
      for (const m of Object.values(mats)) { live.delete(m); m.dispose(); }
      glow.material.dispose();
      contact.material.dispose();
    },
  };
  return tr;
}
