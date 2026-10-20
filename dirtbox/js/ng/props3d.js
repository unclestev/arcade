// Next Gen pickups and hazards: glossy item crates with lit icons, the gold letter medallion and a
// hazard-striped mine. Purely visual.
import * as THREE from '../../vendor/three/three.module.min.js';
import { G } from '../ns.js';

const U = G.U;
const all = [];             // every material here, so the track's reflections can be applied
const track = (m) => { all.push(m); return m; };
export function setPropsEnv(env) {
  for (const m of all) if (m.envMap !== env) { m.envMap = env; m.needsUpdate = true; }
}
function tex(w, h, draw) {
  const c = U.makeCanvas(w, h);
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ---------- crate icons (vector, centred on 64,64 in a 128 canvas) ----------
const ICON = {
  missile(ctx) {
    ctx.rotate(-Math.PI / 4);
    ctx.beginPath(); ctx.moveTo(0, -40); ctx.quadraticCurveTo(13, -26, 11, 4); ctx.lineTo(11, 22); ctx.lineTo(-11, 22); ctx.lineTo(-11, 4); ctx.quadraticCurveTo(-13, -26, 0, -40); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-11, 8); ctx.lineTo(-22, 26); ctx.lineTo(-11, 22); ctx.fill();
    ctx.beginPath(); ctx.moveTo(11, 8); ctx.lineTo(22, 26); ctx.lineTo(11, 22); ctx.fill();
    ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.moveTo(-7, 26); ctx.lineTo(0, 42); ctx.lineTo(7, 26); ctx.fill();
  },
  bomb(ctx) {
    ctx.beginPath(); ctx.arc(-4, 8, 27, 0, U.TAU); ctx.fill();
    ctx.fillRect(10, -24, 14, 14);
    ctx.lineWidth = 5; ctx.strokeStyle = ctx.fillStyle; ctx.beginPath(); ctx.moveTo(17, -24); ctx.quadraticCurveTo(24, -38, 36, -34); ctx.stroke();
    ctx.beginPath(); for (let i = 0; i < 8; i++) { const a = (i / 8) * U.TAU, r = i % 2 ? 4 : 11; ctx.lineTo(38 + Math.cos(a) * r, -36 + Math.sin(a) * r); } ctx.fill();
  },
  nitro(ctx) {
    ctx.beginPath(); ctx.moveTo(10, -44); ctx.lineTo(-24, 6); ctx.lineTo(-2, 6); ctx.lineTo(-10, 44); ctx.lineTo(24, -8); ctx.lineTo(2, -8); ctx.closePath(); ctx.fill();
  },
  engine(ctx) {
    ctx.beginPath();
    for (let i = 0; i < 16; i++) { const a = (i / 16) * U.TAU, r = i % 2 ? 30 : 40; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath(); ctx.fill();
    ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); ctx.arc(0, 0, 13, 0, U.TAU); ctx.fill();
  },
  tires(ctx) {
    ctx.beginPath(); ctx.arc(0, 0, 40, 0, U.TAU); ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.arc(0, 0, 22, 0, U.TAU); ctx.fill();
    for (let i = 0; i < 12; i++) { ctx.save(); ctx.rotate((i / 12) * U.TAU); ctx.fillRect(-3, -42, 6, 8); ctx.restore(); }
    ctx.globalCompositeOperation = 'source-over'; ctx.beginPath(); ctx.arc(0, 0, 9, 0, U.TAU); ctx.fill();
  },
  turbo(ctx) {
    ctx.lineWidth = 6; ctx.strokeStyle = ctx.fillStyle;
    ctx.beginPath(); ctx.arc(0, 0, 38, 0, U.TAU); ctx.stroke();
    for (let i = 0; i < 6; i++) {
      ctx.save(); ctx.rotate((i / 6) * U.TAU);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(26, -6, 30, -26); ctx.quadraticCurveTo(12, -18, 0, 0); ctx.fill();
      ctx.restore();
    }
    ctx.beginPath(); ctx.arc(0, 0, 7, 0, U.TAU); ctx.fill();
  },
};
function drawIcon(ctx, type, color) {
  ctx.save(); ctx.translate(64, 64); ctx.fillStyle = color; ICON[type](ctx); ctx.restore();
}

// Small crate badge for the HUD (same art as the 3D crates).
export function iconCanvas(type, px) {
  const it = G.SPR.ITEMS[type];
  const c = U.makeCanvas(px, px);
  const ctx = c.getContext('2d');
  const k = px / 128;
  ctx.scale(k, k);
  rr(ctx, 4, 4, 120, 120, 26);
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  const col = new THREE.Color(it.crate);
  g.addColorStop(0, '#' + col.clone().lerp(new THREE.Color('#ffffff'), 0.2).getHexString());
  g.addColorStop(1, '#' + col.clone().multiplyScalar(0.7).getHexString());
  ctx.fillStyle = g; ctx.fill();
  ctx.translate(64, 64); ctx.scale(0.7, 0.7); ctx.translate(-64, -64);
  drawIcon(ctx, type, it.icon);
  return c;
}

// ---------- crates ----------
const crateMats = {};
let crateGeo = null;
export function crateMaterial(type) {
  if (crateMats[type]) return crateMats[type];
  const it = G.SPR.ITEMS[type];
  const base = tex(128, 128, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    const c = new THREE.Color(it.crate);
    g.addColorStop(0, '#' + c.clone().lerp(new THREE.Color('#ffffff'), 0.18).getHexString());
    g.addColorStop(1, '#' + c.clone().multiplyScalar(0.7).getHexString());
    ctx.fillStyle = '#111116'; ctx.fillRect(0, 0, 128, 128);
    rr(ctx, 7, 7, 114, 114, 16); ctx.fillStyle = g; ctx.fill();
    ctx.globalAlpha = 0.18; rr(ctx, 7, 7, 114, 40, 16); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.globalAlpha = 1;
    ctx.save(); ctx.translate(64, 64); ctx.scale(0.62, 0.62); ctx.translate(-64, -64); drawIcon(ctx, type, it.icon); ctx.restore();
  });
  const glow = tex(128, 128, (ctx) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 128, 128);
    ctx.save(); ctx.translate(64, 64); ctx.scale(0.62, 0.62); ctx.translate(-64, -64); drawIcon(ctx, type, '#ffffff'); ctx.restore();
  });
  crateMats[type] = track(new THREE.MeshStandardMaterial({ map: base, emissive: it.icon, emissiveMap: glow, emissiveIntensity: 0.9, roughness: 0.32, metalness: 0.1 }));
  return crateMats[type];
}
export function makeCrate(type) {
  if (!crateGeo) crateGeo = new THREE.BoxGeometry(6.6, 6.6, 6.6);
  const m = new THREE.Mesh(crateGeo, crateMaterial(type));
  m.castShadow = true;
  m.userData.type = type;
  return m;
}

// ---------- letter medallion ----------
let coin = null;
const letterTex = {};
function letterTexture(ch) {
  if (letterTex[ch]) return letterTex[ch];
  letterTex[ch] = tex(256, 256, (ctx) => {
    const g = ctx.createRadialGradient(100, 90, 10, 128, 128, 128);
    g.addColorStop(0, '#fff2b0'); g.addColorStop(0.55, '#ffc838'); g.addColorStop(1, '#c47a10');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(128, 128, 128, 0, U.TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(120,64,0,0.55)'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(128, 128, 104, 0, U.TAU); ctx.stroke();
    ctx.font = 'italic 700 150px "Chakra Petch", system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillText(ch, 131, 141);
    ctx.fillStyle = '#5a2e00'; ctx.fillText(ch, 126, 136);
  });
  return letterTex[ch];
}
export function makeLetter(ch) {
  if (!coin) {
    coin = {
      edge: new THREE.CylinderGeometry(4.4, 4.4, 1, 40, 1, true).rotateX(Math.PI / 2),
      rim: new THREE.TorusGeometry(4.4, 0.32, 10, 48),
      face: new THREE.CircleGeometry(4.3, 40),
      gold: track(new THREE.MeshStandardMaterial({ color: '#ffc030', metalness: 0.85, roughness: 0.22, emissive: '#ff9a10', emissiveIntensity: 0.25 })),
    };
  }
  const g = new THREE.Group();
  const edge = new THREE.Mesh(coin.edge, coin.gold); edge.castShadow = true; g.add(edge);
  for (const z of [0.5, -0.5]) {
    const r = new THREE.Mesh(coin.rim, coin.gold); r.position.z = z; g.add(r);
  }
  const mat = track(new THREE.MeshStandardMaterial({ map: letterTexture(ch), metalness: 0.55, roughness: 0.3, emissive: '#ffb020', emissiveMap: letterTexture(ch), emissiveIntensity: 0.35 }));
  const f = new THREE.Mesh(coin.face, mat); f.position.z = 0.51; g.add(f);
  const b = new THREE.Mesh(coin.face, mat); b.position.z = -0.51; b.rotation.y = Math.PI; g.add(b);
  return g;
}

// ---------- mine ----------
let mine = null;
export function makeBomb() {
  if (!mine) {
    const stripes = tex(256, 32, (ctx, w, h) => {
      ctx.fillStyle = '#ffc020'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#16161a';
      for (let x = -32; x < w + 32; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 16, 0); ctx.lineTo(x + 32, h); ctx.lineTo(x + 16, h); ctx.closePath(); ctx.fill(); }
    });
    stripes.wrapS = THREE.RepeatWrapping;
    stripes.repeat.set(3, 1);
    mine = {
      body: new THREE.CylinderGeometry(3.2, 3.5, 1.5, 28).translate(0, 0.75, 0),
      band: new THREE.CylinderGeometry(3.27, 3.45, 1.0, 28, 1, true).translate(0, 0.72, 0),
      dome: new THREE.SphereGeometry(1.7, 20, 10, 0, U.TAU, 0, Math.PI / 2).translate(0, 1.5, 0),
      led: new THREE.SphereGeometry(0.42, 10, 8).translate(0, 3.25, 0),
      metal: track(new THREE.MeshStandardMaterial({ color: '#2a2c32', metalness: 0.7, roughness: 0.4 })),
      tape: track(new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.6 })),
      red: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2a20').multiplyScalar(2) }),
    };
  }
  const g = new THREE.Group();
  const b = new THREE.Mesh(mine.body, mine.metal); b.castShadow = true; g.add(b);
  g.add(new THREE.Mesh(mine.band, mine.tape));
  const d = new THREE.Mesh(mine.dome, mine.metal); d.castShadow = true; g.add(d);
  const led = new THREE.Mesh(mine.led, mine.red);
  g.add(led);
  g.userData.led = led;
  return g;
}
