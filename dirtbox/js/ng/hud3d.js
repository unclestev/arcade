// Next Gen heads-up display: crisp DOM overlay over the 3D view (nothing here touches the rules).
import { G } from '../ns.js';
import { LAPS, LETTER_WORD, TRACKS } from '../sim.js';
import { iconCanvas } from './props3d.js';

const U = G.U;
const PLACE_COL = ['#ffd84a', '#e4ecf6', '#f0a66a', '#ff6a5a'];
const SUFFIX = ['ST', 'ND', 'RD', 'TH'];
let root = null;
const E = {};
const last = {};

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
// Only touch the DOM when a value changes.
function set(key, node, prop, value) {
  if (last[key] === value) return;
  last[key] = value;
  if (prop === 'text') node.textContent = value;
  else if (prop === 'html') node.replaceChildren(...value);
  else node.style.setProperty(prop, value);
}

// Crate badge (same art as the 3D crates).
function crateIcon(type) {
  const c = iconCanvas(type, 48);
  c.className = 'ngh-ico';
  return c;
}

export function build(stage) {
  if (root) return;
  root = el('div', 'ngh', stage);
  root.hidden = true;
  root.setAttribute('aria-hidden', 'true');

  const tl = el('div', 'ngh-panel ngh-tl', root);
  E.pos = el('div', 'ngh-pos', tl);
  E.posN = el('b', '', E.pos, '1');
  E.posS = el('sup', '', E.pos, 'ST');
  const side = el('div', 'ngh-side', tl);
  const lap = el('div', 'ngh-lap', side);
  el('span', '', lap, 'LAP ');
  E.lap = el('b', '', lap, '1');
  el('span', '', lap, '/' + LAPS);
  E.time = el('div', 'ngh-time', side, '0:00.0');
  E.lives = el('div', 'ngh-lives', side, 'TRUCKS 3');

  const tc = el('div', 'ngh-panel ngh-tc', root);
  E.score = el('div', 'ngh-score', tc, '0000000');
  E.word = el('div', 'ngh-word', tc);
  E.letters = LETTER_WORD.split('').map((ch) => el('span', '', E.word, ch));

  E.mapWrap = el('div', 'ngh-panel ngh-map', root);
  E.map = el('canvas', '', E.mapWrap);

  const bottom = el('div', 'ngh-bottom', root);
  E.speed = el('div', 'ngh-speed', bottom);
  E.speedN = el('b', '', E.speed, '0');
  el('span', '', E.speed, 'MPH');
  E.ammo = el('div', 'ngh-panel ngh-ammo', bottom);
  E.ammoN = {};
  for (const k of ['missile', 'bomb', 'nitro']) {
    const d = el('div', 'ngh-item', E.ammo);
    d.dataset.k = k;
    d.appendChild(crateIcon(k));
    E.ammoN[k] = el('b', '', d, 'x0');
    E['item_' + k] = d;
  }

  E.count = el('div', 'ngh-count', root);
  E.lights = el('div', 'ngh-lights', E.count);
  E.lamp = [el('i', '', E.lights), el('i', '', E.lights), el('i', '', E.lights)];
  E.countN = el('div', 'ngh-num', E.count);

  E.intro = el('div', 'ngh-intro', root);
  E.introR = el('span', '', E.intro);
  E.introN = el('b', '', E.intro);

  E.big = el('div', 'ngh-big', root);
  E.small = el('div', 'ngh-small', root);
  E.wrong = el('div', 'ngh-wrong', root, 'WRONG WAY!');
  E.pops = el('div', 'ngh-pops', root);
}

export function show(on) { if (root) root.hidden = !on; }
export function setPaused(on) { if (root) root.classList.toggle('paused', !!on); }

// Pre-rendered track outline for the minimap, fitted to the canvas.
function mapFor(view) {
  if (view._map) return view._map;
  const T = view.track;
  const css = E.mapWrap.clientWidth || 110;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = Math.round(css * dpr);
  E.map.width = size; E.map.height = size;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < T.n; i++) {
    minX = Math.min(minX, T.cx[i]); maxX = Math.max(maxX, T.cx[i]);
    minY = Math.min(minY, T.cy[i]); maxY = Math.max(maxY, T.cy[i]);
  }
  const pad = size * 0.1;
  const sc = Math.min((size - pad * 2) / (maxX - minX), (size - pad * 2) / (maxY - minY));
  const ox = (size - (maxX - minX) * sc) / 2, oy = (size - (maxY - minY) * sc) / 2;
  const map = (x, y) => [ox + (x - minX) * sc, oy + (y - minY) * sc];
  const bg = U.makeCanvas(size, size);
  const ctx = bg.getContext('2d');
  ctx.lineJoin = 'round';
  const path = () => {
    ctx.beginPath();
    for (let i = 0; i <= T.n; i += 2) { const [x, y] = map(T.cx[i % T.n], T.cy[i % T.n]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.closePath();
  };
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = size * 0.07; path(); ctx.stroke();
  ctx.strokeStyle = '#e8e0cc'; ctx.lineWidth = size * 0.035; path(); ctx.stroke();
  const st = T.posAt(0, 0);
  const [sx, sy] = map(st.x, st.y);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(sx - size * 0.03, sy - size * 0.03, size * 0.06, size * 0.06);
  view._map = { bg, map, size, dpr };
  return view._map;
}

function drawMap(view) {
  const m = mapFor(view);
  const ctx = E.map.getContext('2d');
  ctx.clearRect(0, 0, m.size, m.size);
  ctx.drawImage(m.bg, 0, 0);
  const R = view.R;
  const r = m.size * 0.035;
  for (const c of R.cars) {
    const [x, y] = m.map(c.x, c.y);
    const me = c === R.player;
    ctx.beginPath(); ctx.arc(x, y, me ? r * 1.5 : r, 0, U.TAU);
    ctx.fillStyle = G.SPR.SCHEMES[view.scheme(c.slot)].roof; ctx.fill();
    ctx.lineWidth = me ? r * 0.7 : r * 0.45;
    ctx.strokeStyle = me ? '#ffffff' : '#140e1a'; ctx.stroke();
  }
}

// Called every frame by the 3D view.
export function update(view, game) {
  if (!root || root.hidden) return;
  const R = view.R, pl = R.player, t = view.t;
  const rank = R.playerRank();
  set('posN', E.posN, 'text', String(rank));
  set('posS', E.posS, 'text', SUFFIX[rank - 1] || 'TH');
  set('posC', E.pos, 'color', PLACE_COL[rank - 1] || '#fff');
  set('lap', E.lap, 'text', String(U.clamp(pl.lap + 1, 1, LAPS)));
  set('time', E.time, 'text', U.fmtTime(R.time));
  set('lives', E.lives, 'text', 'TRUCKS ' + game.lives);
  set('score', E.score, 'text', U.pad(game.score + R.score, 7));
  const blinkNext = R.letter && R.letter.active && Math.floor(t * 3) % 2 === 0;
  E.letters.forEach((s, i) => {
    const cls = i < game.letters ? 'got' : (i === game.letters && blinkNext ? 'next' : '');
    if (s.className !== cls) s.className = cls;
  });
  for (const k of ['missile', 'bomb', 'nitro']) {
    const n = pl.ammo[k];
    set('a' + k, E.ammoN[k], 'text', 'x' + n);
    const cls = 'ngh-item' + (n > 0 ? '' : ' empty') + (k === 'nitro' && pl.boostT > 0 ? ' active' : '');
    if (E['item_' + k].className !== cls) E['item_' + k].className = cls;
  }
  set('speed', E.speedN, 'text', String(Math.round(Math.abs(pl.vF) * 0.5)));
  drawMap(view);

  // countdown lights + number
  const counting = R.phase === 'countdown';
  const goFlash = R.phase === 'race' && R.phaseT < 0.9;
  E.count.className = 'ngh-count' + (counting || goFlash ? ' on' : '');
  if (counting) {
    const n = 3 - Math.floor(R.phaseT / 0.8);
    E.lamp.forEach((l, i) => { const c = 3 - n > i ? (i < 2 ? 'red' : 'amber') : ''; if (l.className !== c) l.className = c; });
    set('cn', E.countN, 'text', n > 0 ? String(n) : '');
  } else if (goFlash) {
    E.lamp.forEach((l) => { if (l.className !== 'green') l.className = 'green'; });
    set('cn', E.countN, 'text', '');
  }
  // intro banner
  const intro = R.phase === 'intro';
  E.intro.className = 'ngh-intro' + (intro ? ' on' : '');
  if (intro) {
    set('ir', E.introR, 'text', 'RACE ' + (game.raceNo + 1) + '  ·  CIRCUIT ' + (Math.floor(game.raceNo / TRACKS.length) + 1));
    set('in', E.introN, 'text', view.def.name);
  }
  // messages (newest big and newest small)
  let big = null, small = null;
  for (const m of view.messages) { if (m.big) big = m; else small = m; }
  showMsg(E.big, 'big', big);
  showMsg(E.small, 'small', small);
  const wrong = R.phase === 'race' && pl.wrongT > 1;
  E.wrong.className = 'ngh-wrong' + (wrong ? ' on' : '');
  // popups follow the point they came from
  for (let i = view.pops.length - 1; i >= 0; i--) {
    const p = view.pops[i];
    const s = view.project(p.x, p.y, p.z + p.t * 14);
    if (p.t > 1.1 || !s) { p.node.remove(); view.pops.splice(i, 1); continue; }
    p.node.style.transform = 'translate(' + s.x.toFixed(1) + 'px,' + s.y.toFixed(1) + 'px) translate(-50%,-100%)';
    p.node.style.opacity = String(p.t > 0.8 ? 1 - (p.t - 0.8) / 0.3 : 1);
  }
}

function showMsg(node, key, m) {
  const text = m ? m.text : '';
  if (last['m' + key] !== (m ? m.id : -1)) {
    last['m' + key] = m ? m.id : -1;
    node.textContent = text;
    node.style.color = m ? m.color : '';
    node.className = 'ngh-' + key + (m ? ' on' : '');
    if (m) { node.style.animation = 'none'; void node.offsetWidth; node.style.animation = ''; }
  }
}

export function popup(view, x, y, z, text, color) {
  if (!root) return;
  const node = el('div', 'ngh-pop', E.pops, text);
  node.style.color = color || '#ffffff';
  view.pops.push({ x, y, z, t: 0, node });
}

export function reset() {
  for (const k in last) delete last[k];
  if (E.pops) E.pops.replaceChildren();
}
