// Dirtbox Rally Next Gen: a 3D chase-camera view of the same race simulation Classic uses.
// It reads the simulation's state and events every frame; nothing here feeds back into the rules,
// so Next Gen runs replay and verify exactly like Classic ones.
import * as THREE from '../../vendor/three/three.module.min.js';
import { G } from '../ns.js';
import { LETTER_WORD } from '../sim.js';
import { makeCrate, crateMaterial, makeLetter, makeBomb, setPropsEnv } from './props3d.js';
import { buildWorld, envScene, ROAD_HEIGHT } from './world.js';
import { makeTruck, setTruckEnv, WHEEL_R } from './truck3d.js';
import { Particles, Skids, Decals, Rings, splatTexture } from './particles.js';
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
let soft = null, glow = null, skids = null, flashLight = null, weather = null, scorch = null, rings = null;
let liveTrucks = [];
// Per theme: the mud that builds up on the trucks, how fast, how rough the ground rides, what flies
// off the tyres, and the ambient weather around the camera.
const GRIME = {
  farm: { mud: '#5a4026', rate: 0.007, rough: 1, chunk: '#4a3420', wx: 'pollen' },
  desert: { mud: '#b8925e', rate: 0.006, rough: 0.9, chunk: '#a8804e', wx: 'sand' },
  snow: { mud: '#cfd6de', rate: 0.006, rough: 0.7, chunk: '#f4f8ff', wx: 'snow' },
  swamp: { mud: '#3e3420', rate: 0.009, rough: 1.1, chunk: '#3a2e1c', wx: 'fireflies' },
  city: { mud: '#4a4a4c', rate: 0.0025, rough: 0.3, chunk: null, wx: null },
  forest: { mud: '#4a3820', rate: 0.007, rough: 1, chunk: '#3e2e1a', wx: 'leaves' },
  beach: { mud: '#c8b48a', rate: 0.005, rough: 0.8, chunk: '#d8c498', wx: null },
  volcano: { mud: '#3a3436', rate: 0.006, rough: 0.9, chunk: '#2a2426', wx: 'embers' },
};
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
    ? { shadow: 1024, terrain: 90, dpr: 1.25, particles: 1100, aa: false, decor: 0.7, grass: 10000, weather: 260, lite: true }
    : { shadow: 2048, terrain: 140, dpr: 1.75, particles: 2000, aa: true, decor: 1, grass: 18000, weather: 500 };
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
  weather = new Particles(G.NG_QUALITY.weather, false);
  scorch = new Decals(32, splatTexture('scorch'));
  rings = new Rings(8);
  flashLight = new THREE.PointLight('#ffb050', 0, 90, 1.6);
  HUD.build(stage);
  UI.build(stage);
  addEventListener('resize', resize);
  try { new ResizeObserver(resize).observe(stage); } catch (e) { /* ignore */ }
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  resize();
  G.NG = { RaceView3D, show, setLook, perf, ui: UI, camera, info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }) };
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
    cached.world.setEnv(cached.env.texture);
    this.world = cached.world;
    this.scene = this.world.scene;
    if (this.scene.userData.dyn) this.scene.remove(this.scene.userData.dyn);
    this.dyn = new THREE.Group();
    this.scene.userData.dyn = this.dyn;
    this.scene.add(this.dyn);
    soft.clear(); glow.clear(); skids.clear(); weather.clear(); scorch.clear(); rings.clear();
    this.dyn.add(soft.points, glow.points, skids.mesh, flashLight, weather.points, scorch.mesh, rings.group);
    this.grime = GRIME[this.def.theme] || GRIME.farm;
    this.wxAcc = 0;
    flashLight.intensity = 0;
    for (const f of flashes) f.mesh.visible = false;

    for (const tr of liveTrucks) tr.dispose();
    this.trucks = this.R.cars.map((c) => {
      const tr = makeTruck(this.scheme(c.slot));
      tr.dirt = 0.04;
      tr.setGrime(tr.dirt, 0, 0, this.grime.mud);
      this.dyn.add(tr.root, tr.contact);
      return tr;
    });
    liveTrucks = this.trucks;
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
      glow.clear(); soft.clear(); scorch.clear(); rings.clear();
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
      soft.spawn(x, y, 1, Math.cos(a) * sp, Math.sin(a) * sp, 6 + Math.random() * 14, 0.7 + Math.random() * 0.7, color, (size || 4) + Math.random() * 3, 25, 2, 8, 0.75);
    }
  }
  // a ring of dust rolling outward along the ground (landings), plus clods thrown up
  dustRing(x, y, color, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * U.TAU + Math.random() * 0.3, sp = speed * (0.8 + Math.random() * 0.4);
      soft.spawn(x + Math.cos(a) * 4, y + Math.sin(a) * 4, 1, Math.cos(a) * sp, Math.sin(a) * sp, 4 + Math.random() * 6, 0.8 + Math.random() * 0.6, color, 5 + Math.random() * 3, 10, 2.6, 9, 0.7);
    }
    if (this.grime.chunk) this.chunks(x, y, 1, this.grime.chunk, 8, 0, 0, 30);
  }
  // clods of mud / snow / gravel with real weight
  chunks(x, y, z, color, n, vx, vy, up) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * U.TAU, sp = 6 + Math.random() * 18;
      soft.spawn(x, y, z, vx + Math.cos(a) * sp, vy + Math.sin(a) * sp, up * (0.6 + Math.random() * 0.8), 0.55 + Math.random() * 0.45, color, 0.8 + Math.random() * 0.9, 170, 0.4, 0, 1);
    }
  }
  sparks(x, y, z, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * U.TAU, sp = 40 + Math.random() * 80;
      glow.spawn(x, y, z, Math.cos(a) * sp, Math.sin(a) * sp, 20 + Math.random() * 60, 0.25 + Math.random() * 0.25, Math.random() < 0.5 ? '#fff6a0' : '#ffb030', 0.9, 260, 0);
    }
  }
  splash(x, y, n, color, big) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * U.TAU, sp = (big ? 14 : 10) + Math.random() * (big ? 45 : 35);
      soft.spawn(x, y, 1, Math.cos(a) * sp, Math.sin(a) * sp, (big ? 55 : 40) + Math.random() * (big ? 80 : 60), 0.5 + Math.random() * 0.5, Math.random() < 0.45 ? '#ffffff' : color, (big ? 2.4 : 2) + Math.random() * 2, 260, 0.5, 2, 0.9);
    }
    if (big) {
      // a spray column and a cloud of mist
      for (let i = 0; i < 10; i++) soft.spawn(x + (Math.random() - 0.5) * 6, y + (Math.random() - 0.5) * 6, 2, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, 70 + Math.random() * 50, 0.7 + Math.random() * 0.4, '#ffffff', 2 + Math.random() * 2, 200, 0.6, 3, 0.85);
      for (let i = 0; i < 6; i++) soft.spawn(x + (Math.random() - 0.5) * 10, y + (Math.random() - 0.5) * 10, 3, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, 6, 1.2 + Math.random() * 0.6, '#e8f0f4', 6 + Math.random() * 4, -4, 1.5, 10, 0.35);
    }
  }
  explosion(x, y, big) {
    const ry = ROAD_HEIGHT;
    const n = big ? 46 : 22;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * U.TAU, sp = 25 + Math.random() * 95;
      glow.spawn(x, y, 4, Math.cos(a) * sp, Math.sin(a) * sp, 30 + Math.random() * 90, 0.45 + Math.random() * 0.5, ['#fff0a0', '#ffc040', '#ff8a20', '#e04a20'][(Math.random() * 4) | 0], 2.5 + Math.random() * 3.5, 160, 1.2, -1);
    }
    // a rising column of smoke that lingers
    for (let i = 0; i < (big ? 18 : 9); i++) {
      soft.spawn(x + (Math.random() - 0.5) * 9, y + (Math.random() - 0.5) * 9, 4, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, 12 + Math.random() * 18, 1.4 + Math.random() * 1.3, ['#2e282c', '#3a3236', '#4e4648'][(Math.random() * 3) | 0], 6 + Math.random() * 5, -8, 1.1, 11, 0.75);
    }
    // debris and sparks
    for (let i = 0; i < (big ? 14 : 7); i++) {
      const a = Math.random() * U.TAU, sp = 20 + Math.random() * 45;
      soft.spawn(x, y, 3, Math.cos(a) * sp, Math.sin(a) * sp, 40 + Math.random() * 50, 0.9 + Math.random() * 0.6, Math.random() < 0.5 ? '#1e1a1c' : '#4a3a30', 0.9 + Math.random() * 0.9, 170, 0.3, 0, 1);
    }
    this.sparks(x, y, 4, big ? 16 : 8);
    // shockwave across the ground and a scorch mark left behind
    rings.add(x, y, ry + 0.35, 2, big ? 36 : 22, big ? 0.5 : 0.38, '#ffc070', 0.95);
    scorch.add(x, y, big ? 12 : 8, '#120c0a', 25, ry + 0.07);
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
          { // soot on the paint and smoke from under the hood for a few seconds
            const tr = this.trucks[e.car];
            if (tr) { tr.scorch = Math.min(1, tr.scorch + 0.55); tr.smokeT = 3.5; }
          }
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
          if (e.impact > 40 && this.trucks[e.car]) { const tr = this.trucks[e.car]; tr.scuff = Math.min(1, tr.scuff + e.impact / 700); }
          if (me) { A.sfx('wall'); I.rumble(Math.min(1, e.impact / 150), 90); if (e.impact > 80) this.shake = Math.max(this.shake, 0.5); }
          break;
        case 'oil': if (me) A.sfx('skid'); break;
        case 'puddle':
          if (this.near(e.x, e.y)) {
            this.splash(e.x, e.y, 18, this.theme.colors.PUDDLE[0]);
            rings.add(e.x, e.y, ROAD_HEIGHT + 0.2, 2, 13, 0.9, '#ffffff', 0.35, false);
          }
          if (this.trucks[e.car]) this.trucks[e.car].dirt = Math.min(1, this.trucks[e.car].dirt + 0.05);
          if (me) A.sfx('splash');
          break;
        case 'boostpad': if (me) A.sfx('boost'); break;
        case 'jump': if (me) A.sfx('jump'); break;
        case 'land': {
          if (this.near(e.x, e.y)) { this.dust(e.x, e.y, this.theme.dust, 8, 30, 5); this.dustRing(e.x, e.y, this.theme.dust, Math.min(26, 10 + e.impact / 10), 26 + e.impact * 0.12); }
          if (me) { A.sfx('land'); I.rumble(Math.min(1, e.impact / 200), 120); }
          const tr = this.trucks[e.car];
          if (tr) { tr.bv = -Math.min(14, e.impact * 0.08); tr.dropV = Math.min(14, e.impact * 0.07); tr.dirt = Math.min(1, tr.dirt + 0.02); }
          break;
        }
        case 'splash': {
          const tr = this.trucks[e.car];
          const entry = tr && this.t - (tr.lastSplash || -9) > 0.6;
          if (tr) { tr.lastSplash = this.t; tr.dirt = Math.min(1, tr.dirt + (entry ? 0.12 : 0.01)); }
          if (this.near(e.x, e.y)) {
            this.splash(e.x, e.y, entry ? 34 : 6, this.theme.colors.PIT[0], entry);
            if (entry || Math.random() < 0.3) rings.add(e.x, e.y, ROAD_HEIGHT - 1.0, 2, entry ? 22 : 12, entry ? 1.3 : 0.9, '#ffffff', entry ? 0.55 : 0.3, false);
          }
          if (me && (entry || Math.random() < 0.3)) A.sfx('splash');
          break;
        }
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
    this.world.update(this.t, camera.position);
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
    this.weatherFx(dt);
    weather.update(dt, scale);
    scorch.update(dt);
    rings.update(dt);
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
    // suspension: squat/dive with acceleration, lean out of turns, pitch on ramps and in the air.
    // Springs (with a little overshoot) rather than plain easing, so the body rocks and settles.
    const acc = (c.vF - tr.prevVF) / dt;
    tr.prevVF = c.vF;
    tr.acc += (U.clamp(acc, -400, 400) - tr.acc) * Math.min(1, dt * 6);
    let yaw = 0;
    if (tr.prevH !== null && c.spinT <= 0) yaw = U.wrapAngle(c.h - tr.prevH) / dt;
    tr.prevH = c.h;
    let pitchT, rollT;
    if (c.onRamp) pitchT = 0.27;
    else if (air) pitchT = U.clamp(Math.atan2(c.vz, Math.max(30, Math.abs(c.vF))) * 0.8, -0.45, 0.45);
    else pitchT = U.clamp(tr.acc * 0.00034, -0.075, 0.075);
    rollT = air ? 0 : U.clamp(-c.vF * yaw * 0.0005, -0.1, 0.1);
    // road texture under each wheel: bumps grow with speed, bigger on dirt than tarmac
    const speedK = Math.min(1, Math.abs(c.vF) / 110);
    tr.odo += Math.abs(c.vF) * dt;
    const rough = air || c.onRamp ? 0 : this.grime.rough * speedK;
    const bump = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const o = tr.odo + i * 13.7 + c.slot * 31;
      bump[i] = (Math.sin(o * 0.37) * 0.5 + Math.sin(o * 0.91 + i) * 0.3 + Math.sin(o * 2.3 + i * 2) * 0.2) * 0.32 * rough;
    }
    // WHEELS order: rear-left, rear-right, front-left, front-right
    pitchT += ((bump[0] + bump[1]) - (bump[2] + bump[3])) * 0.5 / 9;
    rollT += ((bump[0] + bump[2]) - (bump[1] + bump[3])) * 0.5 / 7.6;
    const sub = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / sub;
    for (let k = 0; k < sub; k++) {
      tr.pv += ((pitchT - tr.pitch) * 140 - tr.pv * 13) * h; tr.pitch += tr.pv * h;
      tr.rv += ((rollT - tr.roll) * 120 - tr.rv * 11) * h; tr.roll += tr.rv * h;
      // landing bounce: a damped spring
      tr.bv += (-tr.bounce * 160 - tr.bv * 14) * h; tr.bounce += tr.bv * h;
      // wheels drop on their springs in the air and tuck up on landing
      const dropT = air ? -0.85 : 0;
      tr.dropV = (tr.dropV || 0) + ((dropT - (tr.drop || 0)) * 120 - (tr.dropV || 0) * 12) * h;
      tr.drop = U.clamp((tr.drop || 0) + tr.dropV * h, -0.95, 0.8);
    }
    tr.pivot.rotation.set(tr.roll, 0, tr.pitch);
    tr.pivot.position.y = U.clamp(tr.bounce, -1.2, 1.2) + (bump[0] + bump[1] + bump[2] + bump[3]) * 0.25;
    // wheels roll with the ground speed; front wheels steer
    tr.spin -= (c.vF * dt) / WHEEL_R;
    tr.wheels.forEach((w, i) => {
      w.w.rotation.z = tr.spin;
      w.steer.position.y = WHEEL_R + tr.drop + bump[i];
      if (w.front) w.steer.rotation.y = -c.steer * 0.5;
    });

    // grime: mud builds with distance on loose ground; soot fades slowly; scrapes stay
    tr.dirt = Math.min(1, tr.dirt + this.grime.rate * speedK * dt * (c.z <= 0.5 ? 1 : 0));
    tr.scorch = Math.max(0, tr.scorch - dt * 0.015);
    tr.setGrime(tr.dirt, tr.scorch, tr.scuff);

    // nitro: flames from the exhausts while boosting
    const boosting = c.boostT > 0;
    tr.flames.visible = boosting;
    if (boosting) {
      const f = 0.8 + Math.random() * 0.5 + speedK * 0.3;
      tr.flames.scale.set(f, 0.85 + Math.random() * 0.3, 0.85 + Math.random() * 0.3);
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
    const fast = Math.abs(c.vF) > 90;
    // dust rolling off the back: bigger, longer clouds at speed or sliding
    if (ground && (sliding || gas || fast) && Math.random() < dt * (sliding ? 46 : fast ? 26 : 16)) {
      const w = rw[Math.random() < 0.5 ? 0 : 1];
      soft.spawn(w[0] - cs * 3 + (Math.random() - 0.5) * 5, w[1] - sn * 3 + (Math.random() - 0.5) * 5, 1, -cs * 14 + (Math.random() - 0.5) * 18, -sn * 14 + (Math.random() - 0.5) * 18, 6 + Math.random() * 10, 0.8 + Math.random() * 0.8, this.theme.dust, 4.5 + Math.random() * 4 + speedK * 2, 10, 1.5, 11, 0.65);
    }
    // clods thrown up by the rear tyres when they dig in
    if (ground && this.grime.chunk && (sliding || (gas && c.vF > 25)) && Math.random() < dt * (sliding ? 22 : 12)) {
      const w = rw[Math.random() < 0.5 ? 0 : 1];
      this.chunks(w[0] - cs * 2, w[1] - sn * 2, 1.5, this.grime.chunk, 1, -cs * (20 + c.vF * 0.15), -sn * (20 + c.vF * 0.15), 34);
    }
    if (boosting) for (let i = 0; i < 2; i++) glow.spawn(rx + (Math.random() - 0.5) * 2, rY + (Math.random() - 0.5) * 2, 2 + Math.random(), -c.vx * 0.2 + (Math.random() - 0.5) * 16, -c.vy * 0.2 + (Math.random() - 0.5) * 16, 4 + Math.random() * 6, 0.16 + Math.random() * 0.12, Math.random() < 0.5 ? '#ffe060' : '#ff7020', 2.4, 0, 3);
    if (c.spinT > 0 && Math.random() < dt * 25) soft.spawn(c.x, c.y, 5, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, 16, 0.9, Math.random() < 0.5 ? '#5a5258' : '#7a7278', 5, -8, 1.5, 6, 0.75);
    // smoke from under the hood after a hit
    if (tr.smokeT > 0) {
      tr.smokeT -= dt;
      if (Math.random() < dt * 22) soft.spawn(c.x + cs * 6 + (Math.random() - 0.5) * 3, c.y + sn * 6 + (Math.random() - 0.5) * 3, 6, -c.vx * 0.3 + (Math.random() - 0.5) * 6, -c.vy * 0.3 + (Math.random() - 0.5) * 6, 10 + Math.random() * 8, 1 + Math.random() * 0.6, Math.random() < 0.5 ? '#2a2628' : '#4a4446', 3.5, -10, 1.3, 7, 0.6 * Math.min(1, tr.smokeT));
    }
    if (pit && Math.abs(c.vF) > 10 && Math.random() < dt * 30) this.splash(c.x, c.y, 1, this.theme.colors.PIT[0]);
  }

  // Ambient weather around the camera: snow, embers and ash, fireflies, drifting leaves, sand.
  weatherFx(dt) {
    const kind = this.grime.wx;
    if (!kind) return;
    const c = this.R.player;
    const cx = c.x + Math.cos(this.camAng) * 50, cy = c.y + Math.sin(this.camAng) * 50;
    const lite = G.NG_QUALITY.lite;
    const R = (n) => (Math.random() - 0.5) * n;
    const rate = { snow: 90, embers: 30, fireflies: 7, leaves: 6, sand: 5, pollen: 6 }[kind] * (lite ? 0.55 : 1);
    this.wxAcc += dt * rate;
    while (this.wxAcc >= 1) {
      this.wxAcc--;
      const x = cx + R(300), y = cy + R(300);
      switch (kind) {
        case 'snow': weather.spawn(x, y, 30 + Math.random() * 40, 8 + R(4), 3 + R(4), -12 - Math.random() * 6, 5, '#ffffff', 0.7 + Math.random() * 0.6, 0, 0, 0, 0.9); break;
        case 'embers':
          if (Math.random() < 0.6) glow.spawn(x, y, Math.random() * 4, R(6), R(6), 8 + Math.random() * 10, 1.8 + Math.random() * 1.2, Math.random() < 0.5 ? '#ff8a30' : '#ffc050', 0.6 + Math.random() * 0.5, -2, 0.3);
          else weather.spawn(x, y, 25 + Math.random() * 30, 5 + R(4), R(4), -5 - Math.random() * 3, 5, Math.random() < 0.5 ? '#5a5458' : '#7a7476', 0.7 + Math.random() * 0.5, 0, 0, 0, 0.8);
          break;
        case 'fireflies': glow.spawn(x, y, 3 + Math.random() * 10, R(5), R(5), R(3), 2.5 + Math.random() * 1.5, Math.random() < 0.6 ? '#d8ff70' : '#ffe880', 0.7, 0, 0.2); break;
        case 'leaves': weather.spawn(x, y, 25 + Math.random() * 25, 7 + R(6), R(6), -6 - Math.random() * 3, 5, ['#8a6a2a', '#a8742a', '#6a7a2a'][(Math.random() * 3) | 0], 0.8 + Math.random() * 0.4, 0, 0, 0, 1); break;
        case 'pollen': glow.spawn(x, y, 3 + Math.random() * 14, 3 + R(3), R(3), R(2), 3, '#fff8d0', 0.35, 0, 0.1); break;
        case 'sand': weather.spawn(x, y, 1 + Math.random() * 3, 22 + R(8), 6 + R(6), 1, 2.2, '#e8c890', 9 + Math.random() * 6, 0, 0.2, 8, 0.12); break;
      }
    }
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
    this.world.update(this.t, camera.position);
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
    weather.update(dt, scale);
    rings.update(dt);
    for (const t of this.trucks) t.flames.visible = false;
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
