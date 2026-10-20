// Dirtbox Rally Next Gen: a 3D chase-camera view of the same race simulation Classic uses.
// It reads the simulation's state and events every frame; nothing here feeds back into the rules,
// so Next Gen runs replay and verify exactly like Classic ones.
import * as THREE from '../../vendor/three/three.module.min.js';
import { G } from '../ns.js';
import { LETTER_WORD } from '../sim.js';
import { makeCrate, crateMaterial, makeLetter, makeBomb, setPropsEnv } from './props3d.js';
import { buildWorld, envScene, ROAD_HEIGHT } from './world.js';
import { makeTruck, setTruckEnv, WHEEL_R } from './truck3d.js';
import { Particles, Skids } from './particles.js';
import * as HUD from './hud3d.js';
import * as UI from './menus3d.js';

const U = G.U;
const RIVAL_NAMES = ['BLAZE', 'RIPTIDE', 'DUSTY', 'BOULDER', 'FROSTY', 'NIGHTOWL', 'TORCH', 'JAMMER'];
const PLAYER = 3;
// Chase camera presets: distance behind, height, how far ahead it aims and at what height.
const CAMS = {
  high: { dist: 34, hgt: 30, hgtSpeed: 4, ahead: 40, aheadSpeed: 14, lookY: 1 },
  medium: { dist: 30, hgt: 20, hgtSpeed: 3, ahead: 28, aheadSpeed: 10, lookY: 2.5 },
  low: { dist: 27, hgt: 11.5, hgtSpeed: 1.5, ahead: 16, aheadSpeed: 0, lookY: 4 },
};
export const CAM_NAMES = Object.keys(CAMS);

let renderer = null, canvas = null, camera = null, stage = null, shown = false;
let cached = null;           // { index, world } for the current track only
let soft = null, glow = null, skids = null, flashLight = null;
const flashes = [];
// Automatic resolution: drop the render scale when frames run slow, raise it again with headroom.
const perf = { scale: 1, ema: 1 / 60, last: 0, checkT: 0, shadowsOff: false };

// Reflections: a blurred copy of the track's sky (PMREM), used by the truck paint, glass and chrome.
function makeEnv(scene) {
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.035);
  pm.dispose();
  scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  return rt;
}
export const makeEnvMap = (scene) => makeEnv(scene);
export const getRenderer = () => renderer;

// ---------- setup ----------
export function init() {
  if (renderer) return;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  G.NG_QUALITY = coarse
    ? { shadow: 1024, terrain: 90, dpr: 1.25, particles: 900, aa: false, decor: 0.7, lite: true }
    : { shadow: 2048, terrain: 140, dpr: 1.75, particles: 1600, aa: true, decor: 1 };
  stage = document.getElementById('game');
  canvas = document.createElement('canvas');
  canvas.className = 'ng3d';
  canvas.hidden = true;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: G.NG_QUALITY.aa, powerPreference: 'high-performance' });
  } catch (e) {
    const err = new Error('WebGL is not available');
    err.webgl = false;
    throw err;
  }
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  stage.prepend(canvas);
  camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.8, 4600);
  soft = new Particles(G.NG_QUALITY.particles, false);
  glow = new Particles(700, true);
  skids = new Skids(900);
  flashLight = new THREE.PointLight('#ffb050', 0, 90, 1.6);
  HUD.build(stage);
  UI.build(stage);
  addEventListener('resize', resize);
  try { new ResizeObserver(resize).observe(stage); } catch (e) { /* ignore */ }
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  resize();
  G.NG = { RaceView3D, show, setLook, perf, ui: UI, info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }) };
}

function resize() {
  if (!renderer) return;
  const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, G.NG_QUALITY.dpr) * perf.scale);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// mode: 'race' (3D view + HUD), 'menu' (3D backdrop under a Next Gen menu) or false (Classic screens)
export function show(mode) {
  const on = !!mode;
  shown = on;
  UI.leave();
  if (!canvas) return;
  canvas.hidden = !on;
  setLook('');
  if (mode !== 'race') HUD.setPaused(false);
  if (G.view && G.view.is3D) G.view.paused = undefined; // re-apply the pause look on the next frame
  HUD.show(mode === 'race');
  const scr = document.getElementById('screen');
  if (scr) scr.classList.toggle('ng-overlay', on);
  stage.classList.toggle('ngmode', on);
  perf.last = 0;
  if (on) resize();
}
// dim the 3D backdrop under a menu: '' | 'paused' | 'soft'
export function setLook(look) {
  if (!canvas) return;
  canvas.classList.toggle('paused', look === 'paused');
  canvas.classList.toggle('soft', look === 'soft');
}

function adapt() {
  const now = performance.now();
  if (perf.last) {
    const dt = Math.min(0.25, (now - perf.last) / 1000);
    perf.ema += (dt - perf.ema) * 0.05;
    perf.checkT += dt;
  }
  perf.last = now;
  if (perf.checkT < 2) return;
  perf.checkT = 0;
  if (perf.ema > 1 / 45 && perf.scale > 0.55) { perf.scale = Math.max(0.55, perf.scale * 0.85); resize(); }
  else if (perf.ema > 1 / 45 && !perf.shadowsOff) { perf.shadowsOff = true; renderer.shadowMap.enabled = false; recompile(); }
  else if (perf.ema < 1 / 57 && perf.scale < 1) { perf.scale = Math.min(1, perf.scale * 1.1); resize(); }
}
function recompile() {
  if (cached) cached.world.scene.traverse((o) => {
    const m = o.material;
    if (m) (Array.isArray(m) ? m : [m]).forEach((x) => { x.needsUpdate = true; });
  });
}

// ---------- models ----------
let missileParts = null;

function makeMissile() {
  if (!missileParts) {
    missileParts = {
      body: new THREE.CylinderGeometry(0.7, 0.7, 5, 10).rotateZ(Math.PI / 2),
      nose: new THREE.ConeGeometry(0.7, 1.8, 10).rotateZ(-Math.PI / 2).translate(3.4, 0, 0),
      fin: new THREE.BoxGeometry(1.4, 0.15, 2.6).translate(-2, 0, 0),
      white: new THREE.MeshStandardMaterial({ color: '#f0f0f8', roughness: 0.35, metalness: 0.3 }),
      red: new THREE.MeshStandardMaterial({ color: '#e0302a', roughness: 0.4 }),
      glow: new THREE.MeshBasicMaterial({ color: '#ffd060' }),
      flame: new THREE.SphereGeometry(0.75, 8, 6).translate(-2.9, 0, 0),
    };
  }
  const P = missileParts;
  const g = new THREE.Group();
  const b = new THREE.Mesh(P.body, P.white); b.castShadow = true; g.add(b);
  g.add(new THREE.Mesh(P.nose, P.red));
  const f1 = new THREE.Mesh(P.fin, P.red); g.add(f1);
  const f2 = new THREE.Mesh(P.fin, P.red); f2.rotation.x = Math.PI / 2; g.add(f2);
  g.add(new THREE.Mesh(P.flame, P.glow));
  return g;
}
// ---------- the view ----------
export class RaceView3D {
  constructor(game, { scheme = 0 } = {}) {
    this.is3D = true;
    this.game = game;
    this.R = game.race;
    this.def = this.R.def;
    this.track = this.R.track;
    this.theme = G.THEMES[this.def.theme];
    this.demo = false;
    this.t = 0;
    this.messages = [];
    this.msgId = 0;
    this.pops = [];
    this.shake = 0;
    HUD.reset();
    const rivals = [0, 1, 2, 3, 4, 5, 6, 7].filter((s) => s !== scheme).slice(0, 3);
    this.schemes = [...rivals, scheme];
    this.names = [...rivals.map((s) => RIVAL_NAMES[s]), 'YOU'];

    // world: rebuilt only when the track changes
    if (!cached || cached.index !== this.track.index) {
      if (cached) { cached.world.dispose(); if (cached.env) cached.env.dispose(); }
      cached = { index: this.track.index, world: buildWorld(this.track) };
      cached.env = makeEnv(envScene(this.track));
    }
    setTruckEnv(cached.env.texture);
    setPropsEnv(cached.env.texture);
    this.world = cached.world;
    this.scene = this.world.scene;
    if (this.scene.userData.dyn) this.scene.remove(this.scene.userData.dyn);
    this.dyn = new THREE.Group();
    this.scene.userData.dyn = this.dyn;
    this.scene.add(this.dyn);
    soft.clear(); glow.clear(); skids.clear();
    this.dyn.add(soft.points, glow.points, skids.mesh, flashLight);
    flashLight.intensity = 0;
    for (const f of flashes) f.mesh.visible = false;

    this.trucks = this.R.cars.map((c) => {
      const tr = makeTruck(this.scheme(c.slot));
      this.dyn.add(tr.root, tr.contact);
      return tr;
    });
    this.pickups = new Map();
    for (const p of this.R.pickups) {
      const m = makeCrate(p.type);
      this.dyn.add(m);
      this.pickups.set(p.id, m);
    }
    if (this.R.letter) {
      this.letter = makeLetter(this.R.letter.ch);
      this.dyn.add(this.letter);
    }
    this.bombs = new Map();
    this.missiles = new Map();
    this.camAng = this.R.player.h;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.camInit = false;
    this.target = new THREE.Vector3();
    this.updateCamera(0);
    this.warmUp();
  }

  // Compile every shader now (during the race card) so the first missile or explosion doesn't stutter.
  // Compile every shader now (during the race card) so the first frames, missile or explosion don't
  // stutter. Where the browser compiles in parallel, the race card waits for it (this.warming).
  warmUp() {
    if (cached.warm) return;
    cached.warm = true;
    const tmp = [makeMissile(), makeBomb()];
    this.explosion(0, 0, false);
    for (const o of tmp) { o.position.set(0, -500, 0); this.dyn.add(o); }
    const done = () => {
      for (const o of tmp) o.removeFromParent();
      for (const f of flashes) f.mesh.visible = false;
      flashLight.intensity = 0;
      glow.clear(); soft.clear();
      this.shake = 0;
      this.warming = false;
    };
    this.warming = true;
    try {
      if (renderer.compileAsync) renderer.compileAsync(this.scene, camera).then(done, done);
      else { renderer.compile(this.scene, camera); done(); }
    } catch (e) { done(); }
  }

  scheme(slot) { return this.schemes[slot]; }
  isMe(slot) { return slot === PLAYER; }
  get frames() { return this.schemes.map((s) => G.SPR.truckFrames(s)); } // used by the (pixel) results screen
  near(x, y, r) { const p = this.R.player; return Math.hypot(x - p.x, y - p.y) < (r || 260); }
  carNear(slot) { const c = this.R.cars[slot]; return this.near(c.x, c.y); }
  msg(text, color, dur, big) {
    this.messages = this.messages.filter((m) => m.big !== big);
    this.messages.push({ id: ++this.msgId, text, color: color || '#ffffff', t: 0, dur: dur || 1.6, big: !!big });
  }
  project(x, y, z) {
    const v = new THREE.Vector3(x, z, y).project(camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: (v.x + 1) / 2 * stage.clientWidth, y: (1 - v.y) / 2 * stage.clientHeight };
  }

  // ---------- effects ----------
  dust(x, y, color, n, spread, size) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * U.TAU, sp = (spread || 20) * Math.random();
      soft.spawn(x, y, 1, Math.cos(a) * sp, Math.sin(a) * sp, 6 + Math.random() * 14, 0.5 + Math.random() * 0.5, color, (size || 4) + Math.random() * 3, 25, 2, 7, 0.75);
    }
  }
  sparks(x, y, z, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * U.TAU, sp = 40 + Math.random() * 80;
      glow.spawn(x, y, z, Math.cos(a) * sp, Math.sin(a) * sp, 20 + Math.random() * 60, 0.25 + Math.random() * 0.25, Math.random() < 0.5 ? '#fff6a0' : '#ffb030', 0.9, 260, 0);
    }
  }
  splash(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * U.TAU, sp = 10 + Math.random() * 35;
      soft.spawn(x, y, 1, Math.cos(a) * sp, Math.sin(a) * sp, 40 + Math.random() * 60, 0.5 + Math.random() * 0.4, Math.random() < 0.4 ? '#ffffff' : color, 2 + Math.random() * 2, 260, 0.5, 2, 0.9);
    }
  }
  explosion(x, y, big) {
    const n = big ? 40 : 18;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * U.TAU, sp = 25 + Math.random() * 90;
      glow.spawn(x, y, 4, Math.cos(a) * sp, Math.sin(a) * sp, 30 + Math.random() * 90, 0.45 + Math.random() * 0.45, ['#fff0a0', '#ffc040', '#ff8a20', '#e04a20'][(Math.random() * 4) | 0], 2.5 + Math.random() * 3, 160, 1.2, -1);
    }
    for (let i = 0; i < (big ? 12 : 6); i++) {
      soft.spawn(x + (Math.random() - 0.5) * 8, y + (Math.random() - 0.5) * 8, 4, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, 14 + Math.random() * 16, 1 + Math.random() * 0.8, Math.random() < 0.5 ? '#3a3236' : '#5a5258', 6 + Math.random() * 4, -6, 1.2, 9, 0.7);
    }
    // fireball + light flash
    let f = flashes.find((q) => !q.mesh.visible);
    if (!f) {
      if (flashes.length < 6) {
        f = { mesh: new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: '#ffc050', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })) };
        flashes.push(f);
      } else f = flashes[0];
    }
    if (f.mesh.parent !== this.dyn) this.dyn.add(f.mesh);
    f.mesh.visible = true;
    f.mesh.position.set(x, 5, y);
    f.t = 0; f.max = big ? 0.55 : 0.4; f.r = big ? 13 : 8;
    flashLight.position.set(x, 10, y);
    flashLight.intensity = big ? 2600 : 1400;
    if (this.near(x, y, 160)) this.shake = Math.max(this.shake, big ? 1.4 : 0.8);
  }

  // ---------- simulation events: sound, messages, effects ----------
  handle(events) {
    const A = G.audio, I = G.input;
    for (const e of events) {
      const me = e.car !== undefined && this.isMe(e.car);
      switch (e.t) {
        case 'count': A.sfx('beep'); break;
        case 'go':
          A.sfx('go');
          this.msg('GO!', '#7cf07c', 0.9, true);
          A.music(['raceA', 'raceB', 'raceC'][this.R.index % 3]);
          break;
        case 'missile': if (me || this.carNear(e.car)) A.sfx('missile'); break;
        case 'bombdrop': if (me || this.carNear(e.car)) A.sfx('bombdrop'); break;
        case 'nitro': {
          if (me || this.carNear(e.car)) A.sfx('boost');
          const c = this.R.cars[e.car];
          for (let i = 0; i < 12; i++) glow.spawn(c.x - Math.cos(c.h) * 8, c.y - Math.sin(c.h) * 8, 3, -Math.cos(c.h) * 40 + (Math.random() - 0.5) * 30, -Math.sin(c.h) * 40 + (Math.random() - 0.5) * 30, 10, 0.35, Math.random() < 0.5 ? '#ffe060' : '#ff7020', 2.5, 0, 3);
          break;
        }
        case 'empty': A.sfx('empty'); break;
        case 'hit': {
          const c = this.R.cars[e.car];
          if (me) {
            A.sfx('hit'); I.rumble(0.9, 350); this.shake = Math.max(this.shake, 1.6);
            this.msg(e.kind === 'lava' ? 'TOO HOT!' : 'OUCH!', '#ff6a5a', 1, false);
          } else if (this.near(e.x, e.y)) A.sfx('spin');
          if (c) for (let i = 0; i < 6; i++) soft.spawn(c.x, c.y, 6, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, 18, 0.9, '#4a4448', 5, -8, 1.2, 6, 0.8);
          break;
        }
        case 'points': HUD.popup(this, e.x, e.y, 14, '+' + e.pts, '#ffe060'); break;
        case 'explode':
          this.explosion(e.x, e.y, e.big);
          if (this.near(e.x, e.y)) A.sfx('explode');
          break;
        case 'upgrade': {
          const it = G.SPR.ITEMS[e.type];
          A.sfx('upgrade');
          this.msg(it.label + ' UP!', '#7cf07c', 1.4, false);
          HUD.popup(this, e.x, e.y, 10, it.label + '+', '#7cf07c');
          this.burst(e.x, e.y, it.crate);
          break;
        }
        case 'pickup':
          A.sfx('pickup');
          HUD.popup(this, e.x, e.y, 10, '+' + e.add + ' ' + G.SPR.ITEMS[e.type].label, '#ffffff');
          this.burst(e.x, e.y, G.SPR.ITEMS[e.type].crate);
          break;
        case 'letter':
          A.sfx('letter');
          HUD.popup(this, e.x, e.y, 12, e.ch + '!', '#ffe060');
          this.burst(e.x, e.y, '#ffd040', 30);
          if (e.word) { this.msg(LETTER_WORD + '! +1 TRUCK', '#ffe060', 2.5, false); setTimeout(() => A.sfx('extra'), 400); }
          else this.msg('LETTER ' + e.ch, '#ffe060', 1.4, false);
          break;
        case 'finish': {
          const good = e.place <= 3;
          this.msg(good ? 'FINISHED ' + U.ordinal(e.place) + '!' : U.ordinal(e.place) + ' PLACE', good ? '#ffe060' : '#ff6a5a', 4, true);
          A.jingle(e.place === 1 ? 'win' : good ? 'qualify' : 'lose');
          break;
        }
        case 'tooslow': this.msg('TOO SLOW!', '#ff6a5a', 4, true); A.jingle('lose'); break;
        case 'lap': this.msg('LAP ' + e.lap, '#ffffff', 1.2, true); A.sfx('lap'); break;
        case 'finallap': this.msg('FINAL LAP!', '#ffe060', 1.6, true); A.sfx('finallap'); break;
        case 'wall':
          if (!this.near(e.x, e.y)) break;
          if (e.impact > 45) this.sparks(e.x, e.y, 3, 6);
          if (me) { A.sfx('wall'); I.rumble(Math.min(1, e.impact / 150), 90); if (e.impact > 80) this.shake = Math.max(this.shake, 0.5); }
          break;
        case 'oil': if (me) A.sfx('skid'); break;
        case 'puddle':
          if (this.near(e.x, e.y)) this.splash(e.x, e.y, 14, this.theme.colors.PUDDLE[0]);
          if (me) A.sfx('splash');
          break;
        case 'boostpad': if (me) A.sfx('boost'); break;
        case 'jump': if (me) A.sfx('jump'); break;
        case 'land': {
          if (this.near(e.x, e.y)) this.dust(e.x, e.y, this.theme.dust, 12, 30, 5);
          if (me) { A.sfx('land'); I.rumble(Math.min(1, e.impact / 200), 120); }
          const tr = this.trucks[e.car];
          if (tr) tr.bv = -Math.min(14, e.impact * 0.08);
          break;
        }
        case 'splash':
          if (this.near(e.x, e.y)) this.splash(e.x, e.y, 6, this.theme.colors.PIT[0]);
          if (me && Math.random() < 0.3) A.sfx('splash');
          break;
        case 'bump':
          if (this.isMe(e.a) || this.isMe(e.b)) { A.sfx('bump'); I.rumble(0.3, 80); }
          break;
      }
    }
  }
  burst(x, y, color, n) {
    for (let i = 0; i < (n || 16); i++) {
      const a = Math.random() * U.TAU, sp = 15 + Math.random() * 30;
      glow.spawn(x, y, 6, Math.cos(a) * sp, Math.sin(a) * sp, 20 + Math.random() * 30, 0.5 + Math.random() * 0.3, Math.random() < 0.5 ? '#ffffff' : color, 1.4, 40, 1);
    }
  }

  // ---------- per frame ----------
  update(dt) {
    this.t += dt;
    for (const m of this.messages) m.t += dt;
    this.messages = this.messages.filter((m) => m.t < m.dur);
    for (const p of this.pops) p.t += dt;
    this.world.update(this.t);
    const R = this.R, t = this.t;
    const ry = ROAD_HEIGHT;

    // trucks
    R.cars.forEach((c, i) => this.updateTruck(c, this.trucks[i], dt));

    // pickups
    for (const p of R.pickups) {
      const m = this.pickups.get(p.id);
      if (!m) continue;
      m.visible = p.active;
      if (!p.active) continue;
      if (m.userData.type !== p.type) { m.material = crateMaterial(p.type); m.userData.type = p.type; }
      m.position.set(p.x, ry + 6 + Math.sin(t * 3 + p.id) * 1.2, p.y);
      m.rotation.y = t * 1.6 + p.id;
    }
    if (this.letter) {
      const L = R.letter;
      this.letter.visible = L.active;
      if (L.active) {
        this.letter.position.set(L.x, ry + 10 + Math.sin(t * 2.4) * 1.5, L.y);
        this.letter.rotation.y = t * 2.2;
        if (Math.random() < dt * 14) glow.spawn(L.x + (Math.random() - 0.5) * 10, L.y + (Math.random() - 0.5) * 10, 4 + Math.random() * 14, 0, 0, 6, 0.6, '#fff6a0', 1.2, 0);
      }
    }
    // bombs
    const seen = new Set();
    for (const b of R.bombs) {
      seen.add(b.id);
      let m = this.bombs.get(b.id);
      if (!m) { m = makeBomb(); m.rotation.y = Math.random() * U.TAU; this.dyn.add(m); this.bombs.set(b.id, m); }
      m.position.set(b.x, ry, b.y);
      m.userData.led.visible = b.armT <= 0 && Math.floor(t * 6) % 2 === 0;
    }
    for (const [id, m] of this.bombs) if (!seen.has(id)) { this.dyn.remove(m); this.bombs.delete(id); }
    // missiles
    seen.clear();
    for (const mi of R.missiles) {
      seen.add(mi.id);
      let m = this.missiles.get(mi.id);
      if (!m) { m = makeMissile(); m.rotation.order = 'YXZ'; this.dyn.add(m); this.missiles.set(mi.id, m); }
      m.position.set(mi.x, ry + mi.z, mi.y);
      m.rotation.set(t * 8, -mi.a, 0); // yaw along the track, rolling as it flies
      if (Math.random() < 0.8) soft.spawn(mi.x - Math.cos(mi.a) * 4, mi.y - Math.sin(mi.a) * 4, mi.z, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, 2, 0.5, Math.random() < 0.5 ? '#d8d0d8' : '#a8a0a8', 2.5, -4, 1, 5, 0.65);
      if (Math.random() < 0.6) glow.spawn(mi.x - Math.cos(mi.a) * 3, mi.y - Math.sin(mi.a) * 3, mi.z, 0, 0, 0, 0.12, '#ffb040', 2.2, 0);
    }
    for (const [id, m] of this.missiles) if (!seen.has(id)) { this.dyn.remove(m); this.missiles.delete(id); }

    // explosions
    for (const f of flashes) {
      if (!f.mesh.visible) continue;
      f.t += dt;
      const k = f.t / f.max;
      if (k >= 1) { f.mesh.visible = false; continue; }
      const s = f.r * (0.35 + Math.sqrt(k) * 0.9);
      f.mesh.scale.set(s, s, s);
      f.mesh.material.opacity = (1 - k) * 0.9;
      f.mesh.material.color.set(k < 0.25 ? '#fff4c0' : k < 0.55 ? '#ffb040' : '#e05020');
    }
    flashLight.intensity = Math.max(0, flashLight.intensity - dt * 7000);
    this.shake = Math.max(0, this.shake - dt * 3);

    // start lights on the gantry follow the countdown
    const lights = this.world.startLights;
    if (lights) {
      let state = ['off', 'off', 'off'];
      if (R.phase === 'countdown') { const n = 3 - Math.floor(R.phaseT / 0.8); state = state.map((_, i) => (3 - n > i ? (i < 2 ? 'red' : 'amber') : 'off')); }
      else if (R.phase === 'race' && R.time < 2) state = ['green', 'green', 'green'];
      const C = { off: ['#2a1e24', '#000000'], red: ['#ff3a2a', '#ff2010'], amber: ['#ffc040', '#ffa010'], green: ['#50ff70', '#20e040'] };
      lights.forEach((m, i) => { m.color.set(C[state[i]][0]); m.emissive.set(C[state[i]][1]); m.emissiveIntensity = state[i] === 'off' ? 0 : 3; });
    }

    this.updateCamera(dt);
    const h = renderer.domElement.height;
    const scale = h / (2 * Math.tan((camera.fov * Math.PI) / 360));
    soft.update(dt, scale);
    glow.update(dt, scale);
    HUD.update(this, this.game);
  }

  updateTruck(c, tr, dt) {
    const t = this.t, ry = ROAD_HEIGHT;
    const air = c.z > 0.6 && !c.onRamp;
    const pit = c.inPit && c.z <= 0.5;
    tr.root.position.set(c.x, ry + c.z + (pit ? -2.7 : 0), c.y);
    tr.root.rotation.y = -c.h;
    tr.root.visible = !(c.invulnT > 0 && c.spinT <= 0 && Math.floor(t * 16) % 2 === 0);
    // contact shadow stays on the road and fades as the truck leaves it
    const lift = U.clamp(c.z / 22, 0, 1);
    tr.contact.visible = !pit;
    tr.contact.position.set(c.x, ry + 0.12, c.y);
    tr.contact.rotation.y = -c.h;
    tr.contact.scale.setScalar(1 + lift * 0.5);
    tr.contact.material.opacity = 0.85 * (1 - lift);
    if (dt <= 0) return;
    // brake lamps flare when braking or slowing hard
    const braking = (c.brakeIn > 0.1 && c.vF > 3) || (c.vF - tr.prevVF) / dt < -150 ? 1 : 0;
    tr.brake += (braking - tr.brake) * Math.min(1, dt * 14);
    tr.glow.material.opacity = 0.16 + tr.brake * 0.84;
    // suspension: squat/dive with acceleration, lean out of turns, pitch on ramps and in the air
    const acc = (c.vF - tr.prevVF) / dt;
    tr.prevVF = c.vF;
    tr.acc += (U.clamp(acc, -400, 400) - tr.acc) * Math.min(1, dt * 6);
    let yaw = 0;
    if (tr.prevH !== null && c.spinT <= 0) yaw = U.wrapAngle(c.h - tr.prevH) / dt;
    tr.prevH = c.h;
    let pitchT, rollT;
    if (c.onRamp) pitchT = 0.27;
    else if (air) pitchT = U.clamp(Math.atan2(c.vz, Math.max(30, Math.abs(c.vF))) * 0.8, -0.45, 0.45);
    else pitchT = U.clamp(tr.acc * 0.00028, -0.06, 0.06);
    rollT = air ? 0 : U.clamp(-c.vF * yaw * 0.00042, -0.085, 0.085);
    const k = 1 - Math.exp(-dt * 9);
    tr.pitch += (pitchT - tr.pitch) * k;
    tr.roll += (rollT - tr.roll) * k;
    // landing bounce: a damped spring
    tr.bv += (-tr.bounce * 160 - tr.bv * 14) * dt;
    tr.bounce += tr.bv * dt;
    const rough = !air && Math.abs(c.vF) > 20 ? (Math.sin(t * 31 + c.slot) * 0.05 + Math.sin(t * 17 + c.slot * 2) * 0.04) * Math.min(1, Math.abs(c.vF) / 120) : 0;
    tr.pivot.rotation.set(tr.roll, 0, tr.pitch);
    tr.pivot.position.y = U.clamp(tr.bounce, -1.2, 1.2) + rough;
    // wheels roll with the ground speed; front wheels steer
    tr.spin -= (c.vF * dt) / WHEEL_R;
    const drop = air ? -0.7 : 0;
    for (const w of tr.wheels) {
      w.w.rotation.z = tr.spin;
      w.steer.position.y = WHEEL_R + drop;
      if (w.front) w.steer.rotation.y = -c.steer * 0.5;
    }

    // trail effects (only near the player)
    if (!this.near(c.x, c.y, 320)) { tr.prevW = null; return; }
    const cs = Math.cos(c.h), sn = Math.sin(c.h);
    const sliding = Math.abs(c.vL) > 30 || c.slipT > 0 || (c.brakeIn > 0.5 && c.vF > 60);
    const ground = c.z <= 0.5 && !c.onRamp && !pit;
    // tyre marks from both rear wheels
    const rw = [-1, 1].map((s) => [c.x - cs * 4 - sn * 4 * s, c.y - sn * 4 + cs * 4 * s]);
    if (tr.prevW && ground && sliding) for (let i = 0; i < 2; i++) skids.add(tr.prevW[i][0], tr.prevW[i][1], rw[i][0], rw[i][1], 0.9, ry + 0.06);
    tr.prevW = rw;
    const rx = c.x - cs * 8, rY = c.y - sn * 8;
    const gas = c.vF > 5 && c.vF < c.stats.vmax * 0.7;
    if (ground && (sliding || gas || Math.abs(c.vF) > 90) && Math.random() < dt * (sliding ? 40 : 14)) {
      soft.spawn(rx + (Math.random() - 0.5) * 7, rY + (Math.random() - 0.5) * 7, 1, -cs * 12 + (Math.random() - 0.5) * 16, -sn * 12 + (Math.random() - 0.5) * 16, 6 + Math.random() * 10, 0.6 + Math.random() * 0.5, this.theme.dust, 3.5 + Math.random() * 3, 10, 1.5, 9, 0.7);
    }
    if (c.boostT > 0) for (let i = 0; i < 2; i++) glow.spawn(rx + (Math.random() - 0.5) * 2, rY + (Math.random() - 0.5) * 2, 3 + Math.random(), -c.vx * 0.2 + (Math.random() - 0.5) * 16, -c.vy * 0.2 + (Math.random() - 0.5) * 16, 4 + Math.random() * 6, 0.16 + Math.random() * 0.12, Math.random() < 0.5 ? '#ffe060' : '#ff7020', 2.4, 0, 3);
    if (c.spinT > 0 && Math.random() < dt * 25) soft.spawn(c.x, c.y, 5, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, 16, 0.9, Math.random() < 0.5 ? '#5a5258' : '#7a7278', 5, -8, 1.5, 6, 0.75);
    if (pit && Math.abs(c.vF) > 10 && Math.random() < dt * 30) this.splash(c.x, c.y, 1, this.theme.colors.PIT[0]);
  }

  updateCamera(dt) {
    const R = this.R, c = R.player;
    const tr = this.trucks[PLAYER];
    const py = (tr ? tr.root.position.y : c.z) + 0;
    // follow the truck's heading, but hold steady through spin-outs
    if (c.spinT <= 0) {
      const k = dt ? 1 - Math.exp(-dt * 4.5) : 1;
      this.camAng += U.wrapAngle(c.h - this.camAng) * k;
    }
    const a = this.camAng;
    const fx = Math.cos(a), fz = Math.sin(a);
    const speed = U.clamp(Math.abs(c.vF) / 200, 0, 1);
    const boost = c.boostT > 0 ? 1 : 0;
    // Options > 3D CAMERA: HIGH looks well down the track, LOW is a classic bumper-height chase view
    const cam = CAMS[G.settings.ngCam] || CAMS.high;
    const dist = cam.dist + speed * 6, hgt = cam.hgt + speed * cam.hgtSpeed, ahead = cam.ahead + speed * cam.aheadSpeed;
    const pos = new THREE.Vector3(c.x - fx * dist, py + hgt, c.y - fz * dist);
    const look = new THREE.Vector3(c.x + fx * ahead, py + cam.lookY, c.y + fz * ahead);
    let fov = 60 + speed * 8 + boost * 7;
    if (R.phase === 'intro') {
      // fly in from in front of the grid
      const e = U.clamp(R.phaseT / 1.7, 0, 1);
      const s = e * e * (3 - 2 * e);
      const from = new THREE.Vector3(c.x + fx * 50 - fz * 34, py + 26, c.y + fz * 50 + fx * 34);
      pos.lerpVectors(from, pos, s);
      look.lerpVectors(new THREE.Vector3(c.x, py + 4, c.y), look, s);
      fov = 55 + s * 5;
    } else if (R.phase === 'finish') {
      const o = a + Math.PI * 0.7 + R.phaseT * 0.45;
      pos.set(c.x + Math.cos(o) * 36, py + 15, c.y + Math.sin(o) * 36);
      look.set(c.x, py + 4, c.y);
    }
    if (!this.camInit || !dt) {
      this.camPos.copy(pos); this.camLook.copy(look); this.camInit = true;
    } else {
      const k = 1 - Math.exp(-dt * (R.phase === 'finish' ? 3 : 10));
      this.camPos.lerp(pos, k);
      this.camLook.lerp(look, 1 - Math.exp(-dt * 14));
    }
    camera.position.copy(this.camPos);
    if (this.shake > 0) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake));
    camera.lookAt(this.camLook);
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * (dt ? Math.min(1, dt * 4) : 1); camera.updateProjectionMatrix(); }
    // shadows follow the action; the sky dome follows the camera
    this.target.set(c.x + fx * 45, 0, c.y + fz * 45);
    const sun = this.world.sun;
    sun.position.copy(this.target).addScaledVector(this.world.sunDir, 300);
    sun.target.position.copy(this.target);
    this.world.sky.position.set(camera.position.x, 0, camera.position.z);
  }

  // Backdrop for the screens after a race: a slow orbit around the player's truck.
  orbitFrame(dt) {
    this.t += dt;
    this.world.update(this.t);
    const c = this.R.player, tr = this.trucks[PLAYER];
    for (const t of this.trucks) t.glow.material.opacity = 0.16;
    if (this.orbitA === undefined) this.orbitA = c.h + Math.PI * 0.75;
    this.orbitA += dt * 0.16;
    const py = tr.root.position.y;
    const a = this.orbitA;
    camera.position.set(c.x + Math.cos(a) * 30, py + 11, c.y + Math.sin(a) * 30);
    camera.lookAt(c.x, py + 3.5, c.y);
    if (Math.abs(camera.fov - 48) > 0.05) { camera.fov = 48; camera.updateProjectionMatrix(); }
    this.target.set(c.x, 0, c.y);
    const sun = this.world.sun;
    sun.position.copy(this.target).addScaledVector(this.world.sunDir, 300);
    sun.target.position.copy(this.target);
    this.world.sky.position.set(camera.position.x, 0, camera.position.z);
    const h = renderer.domElement.height;
    const scale = h / (2 * Math.tan((camera.fov * Math.PI) / 360));
    soft.update(dt, scale);
    glow.update(dt, scale);
    setTruckEnv(cached.env.texture);
    renderer.render(this.scene, camera);
  }
  // The race exactly as it was (under the options menu opened from pause).
  stillFrame() {
    setTruckEnv(cached.env.texture);
    renderer.render(this.scene, camera);
  }

  render(ctx) {
    // the pixel canvas above is kept clear for the pause menu and toasts
    ctx.clearRect(0, 0, G.CONFIG.VIEW_W, G.CONFIG.VIEW_H);
    const paused = !!(G.screens.race && G.screens.race.paused);
    if (paused !== this.paused) {
      this.paused = paused;
      HUD.setPaused(paused);
      canvas.classList.toggle('paused', paused);
    }
    if (!shown) return;
    if (!paused) adapt();
    renderer.render(this.scene, camera);
  }
}
