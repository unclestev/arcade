// Next Gen menus: a 3D showroom for picking the truck, and modern DOM panels for the race card,
// pause menu, results, circuit bonus, game over headline, options, controls and wheel setup.
// The screens in screens.js keep all their logic and input handling; when Next Gen is the board they
// hand their state to these functions instead of drawing pixel art. Built without innerHTML (the
// page's CSP forbids it): every node is created with createElement and filled with textContent.
import * as THREE from '../../vendor/three/three.module.min.js';
import { G } from '../ns.js';
import * as SIM from '../sim.js';
import { makeTruck, setTruckEnv } from './truck3d.js';
import { getRenderer, makeEnvMap, setLook } from './view3d.js';

const U = G.U;
const PLACE_COL = ['#ffd84a', '#e4ecf6', '#f0a66a', '#ff6a5a'];
let root = null, stage = null, cur = null;

// ---------- DOM helpers ----------
function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
// Buttons never take keyboard focus (Enter is already the game's confirm key).
function btn(cls, parent, text, onClick) {
  const b = el('button', cls, parent, text);
  b.type = 'button';
  b.tabIndex = -1;
  b.addEventListener('pointerdown', (e) => e.preventDefault());
  b.addEventListener('click', (e) => { e.preventDefault(); G.audio.unlock(); onClick(e); });
  return b;
}
function txt(node, value) { const v = String(value); if (node.textContent !== v) node.textContent = v; }
function cls(node, value) { if (node.className !== value) node.className = value; }
const hint = (kb, touch, wheel, pad) => {
  const d = G.input.device;
  return d === 'touch' ? touch : d === 'wheel' ? wheel : d === 'pad' ? pad : kb;
};

export function build(st) {
  if (root) return;
  stage = st;
  root = el('div', 'ngm', stage);
  root.hidden = true;
}
// Called on every screen change: drops the previous screen's panel.
export function leave() {
  if (cur) { cur.node.remove(); cur = null; }
  if (root) root.hidden = true;
}
function mount(key, buildFn) {
  if (cur && cur.key === key) return cur;
  leave();
  root.hidden = false;
  const node = el('div', 'ngm-scr ngm-s-' + key, root);
  cur = { key, node, r: {} };
  buildFn(node, cur.r);
  return cur;
}

// ---------- showroom (3D) ----------
let studio = null;
function studioEnvScene() {
  const scene = new THREE.Scene();
  const g = new THREE.SphereGeometry(50, 32, 16);
  const p = g.getAttribute('position');
  const cols = [];
  const top = new THREE.Color('#1c1630'), mid = new THREE.Color('#0c0a14'), low = new THREE.Color('#050408');
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / 50;
    const c = t > 0 ? mid.clone().lerp(top, t) : mid.clone().lerp(low, -t);
    cols.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  // softboxes: a big one overhead, long strips either side, a warm kicker behind
  const box = (w, h, x, y, z, color, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  box(40, 18, 0, 38, 0, '#ffffff', 2.4);
  box(60, 4, 0, 14, 36, '#e8f0ff', 2.2);
  box(60, 4, 0, 14, -36, '#e8f0ff', 2.2);
  box(30, 8, -40, 10, 0, '#ffb070', 2.0);
  box(20, 6, 38, 6, 10, '#80e8ff', 1.4);
  return scene;
}
function buildStudio() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#07060c');
  scene.fog = new THREE.Fog('#07060c', 70, 190);
  // backdrop: a curved cyclorama with a soft glow behind the truck
  {
    const g = new THREE.CylinderGeometry(120, 120, 80, 48, 8, true);
    const p = g.getAttribute('position');
    const cols = [];
    for (let i = 0; i < p.count; i++) {
      const y = (p.getY(i) + 40) / 80;
      const ang = Math.atan2(p.getZ(i), p.getX(i));
      const glow = Math.max(0, Math.cos(ang + 2.2)) * Math.max(0, 1 - Math.abs(y - 0.2) * 2.2);
      const c = new THREE.Color('#0a0812').lerp(new THREE.Color('#3a1e4a'), glow * 0.9).lerp(new THREE.Color('#140c22'), y * 0.3);
      cols.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
    m.position.y = 30;
    scene.add(m);
  }
  // glossy floor and a turntable with a lit rim
  const floor = new THREE.Mesh(new THREE.CircleGeometry(160, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#0e0b15', roughness: 0.75, metalness: 0.2 }));
  floor.receiveShadow = true;
  scene.add(floor);
  const table = new THREE.Group();
  scene.add(table);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(16, 16.6, 0.7, 72), new THREE.MeshStandardMaterial({ color: '#1c1928', roughness: 0.6, metalness: 0.3 }));
  disc.position.y = 0.35;
  disc.receiveShadow = true;
  table.add(disc);
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(new THREE.RingGeometry(6 + i * 4, 6.12 + i * 4, 72).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#2c2440' }));
    r.position.y = 0.72;
    table.add(r);
  }
  const rim = new THREE.Mesh(new THREE.TorusGeometry(16.35, 0.14, 8, 96).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff9a30').multiplyScalar(2.2) }));
  rim.position.y = 0.66;
  scene.add(rim);
  const halo = new THREE.Mesh(new THREE.RingGeometry(16.6, 24, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ff8a20', transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.position.y = 0.05;
  scene.add(halo);
  // lights: soft key from the front, cool and warm rims behind
  scene.add(new THREE.HemisphereLight('#c8c0e8', '#140e1a', 0.6));
  const key = new THREE.SpotLight('#fff4e8', 2400, 160, 0.42, 0.7, 1.6);
  key.position.set(12, 50, 26);
  key.target.position.set(0, 2, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.4;
  scene.add(key, key.target);
  const rimA = new THREE.SpotLight('#ff9a50', 900, 90, 0.32, 0.9, 1.6);
  rimA.position.set(-30, 16, -24);
  rimA.target.position.set(0, 5, 0);
  scene.add(rimA, rimA.target);
  const rimB = new THREE.SpotLight('#70d8ff', 800, 90, 0.32, 0.9, 1.6);
  rimB.position.set(-14, 18, 34);
  rimB.target.position.set(0, 5, 0);
  scene.add(rimB, rimB.target);
  const camera = new THREE.PerspectiveCamera(34, 16 / 9, 1, 600);
  const env = makeEnvMap(studioEnvScene());
  studio = { scene, table, camera, env, trucks: {}, shown: -1, pop: 0 };
}
function studioTruck(scheme) {
  if (!studio.trucks[scheme]) {
    const tr = makeTruck(scheme, { wheelShadows: true });
    tr.root.position.y = 0.7;
    tr.contact.position.y = 0.74;
    tr.contact.material.opacity = 0.7;
    tr.glow.material.opacity = 0.25;
    studio.table.add(tr.root, tr.contact);
    studio.trucks[scheme] = tr;
  }
  return studio.trucks[scheme];
}

/** Draw the showroom with the given paint on the turntable. */
export function showroom(scheme, dt, spin) {
  const renderer = getRenderer();
  if (!renderer) return;
  if (!studio) buildStudio();
  setTruckEnv(studio.env.texture);
  setLook('');
  for (const k in studio.trucks) studio.trucks[k].root.visible = studio.trucks[k].contact.visible = +k === scheme;
  const tr = studioTruck(scheme);
  if (studio.shown !== scheme) { studio.shown = scheme; studio.pop = 1; }
  studio.pop = Math.max(0, studio.pop - dt * 2.5);
  studio.table.rotation.y += dt * (spin === false ? 0.08 : 0.32);
  const bounce = Math.sin(studio.pop * Math.PI) * 1.2;
  tr.root.position.y = 0.7 + bounce;
  tr.pivot.rotation.z = -Math.sin(studio.pop * Math.PI) * 0.04;
  for (const w of tr.wheels) if (w.front) w.steer.rotation.y = -0.32;
  const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
  const cam = studio.camera;
  cam.aspect = w / h;
  // narrow screens pull back; short ones (phones sideways) pull back a little and lift the truck clear
  // of the paint picker along the bottom
  const far = Math.max(1, 1.55 / cam.aspect);
  const short = h < 520 ? 1 : 0;
  const d = 41 * far * (1 + short * 0.12);
  cam.position.set(d * 0.62, 11 + far * 3 + short * 2, d * 0.78);
  cam.lookAt(0, 3.6 - (far - 1) * 2 - short * 4.5, 0);
  cam.updateProjectionMatrix();
  renderer.render(studio.scene, cam);
}

// ---------- shared bits ----------
function header(node, title, sub) {
  const h = el('div', 'ngm-head', node);
  el('div', 'ngm-title', h, title);
  return sub !== undefined ? el('div', 'ngm-sub', h, sub) : null;
}
function itemRows(list, r, st, items) {
  r.items = items;
  r.rows = items.map((it0, i) => {
    const row = btn('ngm-item', list, '', () => {
      const it = r.items[i];
      if (!it) return;
      if (st.sel !== i) { st.sel = i; G.audio.sfx('blip'); }
      if (it.change) { it.change(1); G.audio.sfx('blip'); } else if (it.action && !it.disabled) { G.audio.sfx('select'); it.action(); }
    });
    const lab = el('span', 'ngm-lab', row, it0.label);
    const val = el('span', 'ngm-val', row);
    return { row, lab, val };
  });
  r.itemKey = items.map((i) => i.label).join('|');
}
function updateItems(r, st, items) {
  r.items = items;
  if (r.lastSel !== st.sel && r.rows[st.sel]) { r.lastSel = st.sel; try { r.rows[st.sel].row.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ } }
  items.forEach((it, i) => {
    const R = r.rows[i];
    if (!R) return;
    const v = it.value ? it.value() : '';
    txt(R.val, v);
    cls(R.row, 'ngm-item' + (i === st.sel ? ' sel' : '') + (it.disabled ? ' off' : '') + (it.value ? ' has-val' : ''));
  });
}
function menuPanel(key, node, title, sub, st, items) {
  const c = mount(key, (n, r) => {
    r.panel = el('div', 'ngm-panel ngm-menu', n);
    r.sub = header(r.panel, title, sub || '');
    r.list = el('div', 'ngm-list', r.panel);
    itemRows(r.list, r, st, items);
    r.foot = el('div', 'ngm-foot', r.panel);
  });
  const r = c.r;
  if (r.itemKey !== items.map((i) => i.label).join('|')) { r.list.replaceChildren(); itemRows(r.list, r, st, items); }
  updateItems(r, st, items);
  if (sub !== undefined) txt(r.sub, sub);
  return r;
}
function trackMap(canvas, index, size) {
  const T = SIM.getTrack(index);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const px = Math.round(size * dpr);
  canvas.width = px; canvas.height = px;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < T.n; i++) { minX = Math.min(minX, T.cx[i]); maxX = Math.max(maxX, T.cx[i]); minY = Math.min(minY, T.cy[i]); maxY = Math.max(maxY, T.cy[i]); }
  const pad = px * 0.08;
  const sc = Math.min((px - pad * 2) / (maxX - minX), (px - pad * 2) / (maxY - minY));
  const ox = (px - (maxX - minX) * sc) / 2, oy = (px - (maxY - minY) * sc) / 2;
  const ctx = canvas.getContext('2d');
  ctx.lineJoin = 'round';
  const path = () => { ctx.beginPath(); for (let i = 0; i <= T.n; i += 2) { const k = i % T.n; const x = ox + (T.cx[k] - minX) * sc, y = oy + (T.cy[k] - minY) * sc; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); } ctx.closePath(); };
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = px * 0.075; path(); ctx.stroke();
  ctx.strokeStyle = '#ffc040'; ctx.lineWidth = px * 0.022; path(); ctx.stroke();
  const st = T.posAt(0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(ox + (st.x - minX) * sc, oy + (st.y - minY) * sc, px * 0.03, 0, U.TAU); ctx.fill();
}

// ---------- TRUCK SELECT ----------
export function select(st, dt) {
  showroom(st.sel, dt);
  const schemes = G.SPR.SCHEMES;
  const c = mount('select', (n, r) => {
    const top = el('div', 'ngm-top', n);
    const h = el('div', 'ngm-head', top);
    el('div', 'ngm-kicker', h, 'GARAGE');
    el('div', 'ngm-title', h, 'CHOOSE YOUR RIDE');
    r.ranked = el('div', 'ngm-sub', h);
    r.timer = el('div', 'ngm-timer', top);
    r.timerN = el('b', '', r.timer);
    el('span', '', r.timer, 'SEC');
    const spec = el('div', 'ngm-panel ngm-spec', n);
    el('div', 'ngm-spec-h', spec, 'MID-SIZE 4X4 SUV');
    for (const [k, v] of [['ENGINE', 'engine'], ['TIRES', 'tires'], ['TURBO', 'turbo']]) {
      const row = el('div', 'ngm-stat', spec);
      el('span', '', row, k);
      const bar = el('i', 'ngm-bar', row);
      const lvl = (G.game && G.game.upgrades && G.game.upgrades[v]) || 0;
      for (let i = 0; i < SIM.MAX_UPGRADE; i++) el('u', i < lvl ? 'on' : '', bar);
      el('em', '', row, lvl ? lvl + '/' + SIM.MAX_UPGRADE : 'STOCK');
    }
    el('p', 'ngm-note', spec, 'UPGRADE ON THE TRACK WITH ORANGE, GREY AND GREEN CRATES.');
    const bot = el('div', 'ngm-pick', n);
    const nameRow = el('div', 'ngm-name-row', bot);
    btn('ngm-arrow', nameRow, '‹', () => { st.sel = (st.sel + 7) % 8; G.audio.sfx('blip'); });
    const nm = el('div', 'ngm-name', nameRow);
    r.paintN = el('span', '', nm, 'PAINT');
    r.name = el('b', '', nm);
    btn('ngm-arrow', nameRow, '›', () => { st.sel = (st.sel + 1) % 8; G.audio.sfx('blip'); });
    const sw = el('div', 'ngm-swatches', bot);
    r.sw = schemes.map((s, i) => {
      const b = btn('ngm-sw', sw, '', () => { if (st.sel === i) st.pick(); else { st.sel = i; G.audio.sfx('blip'); } });
      b.style.setProperty('--c', s.paint);
      b.style.setProperty('--c2', s.roof);
      b.setAttribute('aria-label', s.name);
      return b;
    });
    r.go = btn('ngm-btn primary', bot, 'RACE', () => st.pick());
    r.hint = el('div', 'ngm-hint', bot);
  });
  const r = c.r;
  txt(r.name, schemes[st.sel].name);
  txt(r.paintN, 'PAINT ' + (st.sel + 1) + '/8');
  r.sw.forEach((b, i) => cls(b, 'ngm-sw' + (i === st.sel ? ' sel' : '')));
  txt(r.timerN, Math.max(0, Math.ceil(20 - st.t)));
  txt(r.ranked, G.rankedLabel());
  txt(r.hint, hint('ARROWS TO CHOOSE · ENTER TO RACE', 'TAP A COLOUR · TAP RACE', 'STEER TO CHOOSE · GAS TO RACE', 'D-PAD TO CHOOSE · A TO RACE'));
}

// ---------- RACE CARD ----------
export function card(g) {
  const def = SIM.TRACKS[g.raceNo % SIM.TRACKS.length];
  const theme = G.THEMES[def.theme];
  mount('card', (n, r) => {
    const sky = theme.sky;
    n.style.setProperty('background', 'linear-gradient(160deg, ' + sky[0] + ' 0%, ' + sky[1] + ' 38%, ' + sky[2] + ' 80%, ' + sky[sky.length - 1] + ' 100%)');
    el('div', 'ngm-card-shade', n);
    const box = el('div', 'ngm-cardbox', n);
    const left = el('div', 'ngm-card-l', box);
    el('div', 'ngm-kicker', left, 'RACE ' + (g.raceNo + 1) + ' · CIRCUIT ' + (Math.floor(g.raceNo / SIM.TRACKS.length) + 1));
    el('div', 'ngm-card-name', left, def.name);
    el('div', 'ngm-card-goal', left, 'FINISH IN THE TOP 3 TO ADVANCE');
    const row = el('div', 'ngm-card-row', left);
    const lives = el('span', 'ngm-chip', row);
    el('b', '', lives, String(g.lives));
    el('span', '', lives, g.lives === 1 ? 'TRUCK LEFT' : 'TRUCKS LEFT');
    const laps = el('span', 'ngm-chip', row);
    el('b', '', laps, String(SIM.LAPS));
    el('span', '', laps, 'LAPS');
    el('div', 'ngm-card-rank', left, G.rankedLabel());
    const map = el('canvas', 'ngm-card-map', box);
    trackMap(map, g.raceNo % SIM.TRACKS.length, 220);
    el('div', 'ngm-loading', n, 'LOADING TRACK');
    r.done = true;
  });
}

// ---------- PAUSE ----------
export function pause(st, items) {
  const r = menuPanel('pause', null, 'PAUSED', '', st, items);
  if (!r.up) {
    r.up = el('div', 'ngm-ups', r.foot);
    r.upN = ['engine', 'tires', 'turbo'].map((k) => { const d = el('div', 'ngm-up', r.up); el('span', '', d, k.toUpperCase()); return el('b', '', d); });
  }
  const u = G.game.upgrades;
  ['engine', 'tires', 'turbo'].forEach((k, i) => txt(r.upN[i], u[k] + '/5'));
}

// ---------- RESULTS ----------
export function results(st) {
  const g = G.game, R = st.race, v = st.view;
  const c = mount('results', (n, r) => {
    btn('ngm-catch', n, '', () => { if (st.t > 2.2) st.next(); });
    const p = el('div', 'ngm-panel ngm-results', n);
    header(p, 'RACE RESULTS', R.def.name);
    const tbl = el('div', 'ngm-table', p);
    st.standings.forEach((car, i) => {
      const me = car === R.player;
      const row = el('div', 'ngm-tr' + (me ? ' me' : ''), tbl);
      row.style.setProperty('--d', (0.08 * i) + 's');
      const pos = el('b', 'ngm-place', row, U.ordinal(i + 1));
      pos.style.setProperty('color', PLACE_COL[i]);
      const chip = el('i', 'ngm-chipc', row);
      chip.style.setProperty('--c', G.SPR.SCHEMES[v.scheme(car.slot)].paint);
      el('span', 'ngm-nm', row, v.names[car.slot]);
      el('span', 'ngm-tm', row, car.finished && isFinite(car.finishTime) ? U.fmtTime(car.finishTime) : '--:--.-');
      el('span', 'ngm-best', row, me && isFinite(car.bestLap) ? 'BEST ' + U.fmtTime(car.bestLap) : '');
    });
    const sc = el('div', 'ngm-score', p);
    const line = (a, b, k) => { const d = el('div', 'ngm-sl' + (k ? ' ' + k : ''), sc); el('span', '', d, a); return el('b', '', d, b); };
    line('PLACE BONUS', '+' + st.placePts);
    line('PICKUPS + HITS', '+' + st.racePts);
    r.total = line('SCORE', '', 'total');
    const word = el('div', 'ngm-word', p);
    SIM.LETTER_WORD.split('').forEach((ch, i) => el('span', i < g.letters ? 'got' : '', word, ch));
    r.msg = el('div', 'ngm-verdict', p);
    r.hint = el('div', 'ngm-hint', p);
  });
  const r = c.r;
  const f = U.clamp((st.t - 0.6) / 1.6, 0, 1);
  txt(r.total, U.pad(Math.round(st.from + (st.to - st.from) * f), 7));
  const msg = st.qualified ? (st.place === 1 ? 'YOU WIN!' : 'QUALIFIED!') : (g.lives > 0 ? 'TRUCK LOST · ' + g.lives + ' LEFT' : 'NO TRUCKS LEFT');
  txt(r.msg, st.t > 1.2 ? msg : '');
  cls(r.msg, 'ngm-verdict' + (st.t > 1.2 ? ' on' : '') + (st.qualified ? ' good' : ' bad'));
  txt(r.hint, st.t > 2.2 ? hint('PRESS ENTER', 'TAP TO CONTINUE', 'PRESS GAS', 'PRESS A') : '');
}

// ---------- CIRCUIT COMPLETE ----------
export function circuit(st) {
  mount('circuit', (n) => {
    btn('ngm-catch', n, '', () => { if (st.t > 2) G.go('loading'); });
    const b = el('div', 'ngm-banner', n);
    const k = Math.floor((G.game.raceNo - 1) / SIM.TRACKS.length) + 1;
    el('div', 'ngm-kicker', b, 'CIRCUIT ' + k);
    el('div', 'ngm-big', b, 'COMPLETE!');
    el('div', 'ngm-bonus', b, 'BONUS +' + SIM.POINTS.circuit.toLocaleString('en-US'));
    el('div', 'ngm-sub', b, 'THE RIVALS GET FASTER...');
  });
}

// ---------- GAME OVER (headline; the score card is the page's own panel) ----------
export function over() {
  mount('over', (n) => { el('div', 'ngm-over', n, 'GAME OVER'); });
}

// ---------- OPTIONS ----------
export function options(st, items, wheelLine) {
  const r = menuPanel('options', null, 'OPTIONS', '', st, items);
  if (!r.wl) r.wl = el('div', 'ngm-note', r.foot);
  txt(r.wl, wheelLine);
}

// ---------- CONTROLS ----------
export function controls(st, pages, onPrev, onNext, onBack) {
  const c = mount('controls', (n, r) => {
    const p = el('div', 'ngm-panel ngm-controls', n);
    const h = el('div', 'ngm-head ngm-tabs', p);
    btn('ngm-arrow', h, '‹', onPrev);
    r.title = el('div', 'ngm-title', h);
    btn('ngm-arrow', h, '›', onNext);
    r.tbl = el('div', 'ngm-keys', p);
    r.page = -1;
    const f = el('div', 'ngm-foot', p);
    r.n = el('div', 'ngm-note', f);
    btn('ngm-btn', f, 'BACK', onBack);
  });
  const r = c.r;
  if (r.page !== st.page) {
    r.page = st.page;
    const [title, rows] = pages[st.page];
    txt(r.title, title);
    r.tbl.replaceChildren();
    for (const [a, b] of rows) { const d = el('div', 'ngm-key', r.tbl); el('span', '', d, a); el('b', '', d, b); }
    txt(r.n, (st.page + 1) + ' / ' + pages.length);
  }
}

// ---------- WHEEL SETUP ----------
export function wheel(info) {
  const c = mount('wheel', (n, r) => {
    const p = el('div', 'ngm-panel ngm-wheel', n);
    r.sub = header(p, 'WHEEL SETUP', '');
    r.lines = el('div', 'ngm-lines', p);
    r.pad = el('div', 'ngm-padid', p);
    r.axes = el('div', 'ngm-axes', p);
    r.ax = [];
    r.test = el('div', 'ngm-test', p);
    r.tb = ['STEER', 'GAS', 'BRAKE'].map((k) => { const d = el('div', 'ngm-tb', r.test); el('span', '', d, k); const o = el('i', '', d); return el('u', '', o); });
    r.foot = el('div', 'ngm-hint', p);
    r.key = '';
  });
  const r = c.r;
  txt(r.sub, info.step);
  const key = info.lines.join('|');
  if (r.key !== key) { r.key = key; r.lines.replaceChildren(...info.lines.map((l) => el('p', info.warn ? 'warn' : '', null, l))); }
  txt(r.pad, info.pad || '');
  cls(r.pad, 'ngm-padid' + (info.missing ? ' warn' : ''));
  while (r.ax.length < info.axes.length) { const d = el('div', 'ngm-ax', r.axes); const bar = el('i', '', d); el('span', '', d, 'A' + r.ax.length); r.ax.push({ d, u: el('u', '', bar) }); }
  r.ax.forEach((a, i) => {
    a.d.hidden = i >= info.axes.length;
    if (i >= info.axes.length) return;
    const v = U.clamp(info.axes[i], -1, 1);
    a.u.style.setProperty('height', Math.abs(v * 50).toFixed(1) + '%');
    a.u.style.setProperty('top', (v > 0 ? 50 - v * 50 : 50).toFixed(1) + '%');
    cls(a.d, 'ngm-ax' + (i === info.hl ? ' hl' : ''));
  });
  r.test.hidden = !info.test;
  if (info.test) {
    const s = U.clamp(info.test.steer, -1, 1);
    r.tb[0].style.setProperty('left', (50 + Math.min(0, s) * 50).toFixed(1) + '%');
    r.tb[0].style.setProperty('width', Math.abs(s * 50).toFixed(1) + '%');
    r.tb[1].style.setProperty('width', (info.test.gas * 100).toFixed(1) + '%');
    r.tb[2].style.setProperty('width', (info.test.brake * 100).toFixed(1) + '%');
  }
  txt(r.foot, info.hint);
}
