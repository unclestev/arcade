// Bomber — browser app: rendering, sound, input, menus and the Nostr screens.
// Game rules live in sim.js so the referee can replay any run exactly.

import { TICK, INPUT_MAX, GROUPS, CLASSIC, NEXTGEN, RULES, MODES, usesNextGenRules as isNG, createGame, startWave, step } from './sim.js';
import { encodeReplay } from './replay.js';
import { createArcade } from '../../kit/arcade.js';

// The single-file preview build (inside Claude) has no network access, so Nostr features are hidden there.
// eslint-disable-next-line no-undef
const PREVIEW = typeof __ARCADE_PREVIEW__ !== 'undefined' && __ARCADE_PREVIEW__;

// =====================================================================
// helpers
// =====================================================================
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const TAU = Math.PI * 2;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function rr(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgb = (a, al = 1) => `rgba(${a[0] | 0},${a[1] | 0},${a[2] | 0},${al})`;
const fmt = n => Number(n).toLocaleString('en-US');
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

const KMAX = 1.22, KACC = 10.4; // bucket speed in screen-widths per second

// ---------- storage ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const settings = Object.assign({ sound: true, music: true, shake: !reduceMotion, vibrate: true, touchSens: 1.3,
  wheelDeg: 180, wheelInvert: false, wheelMode: 'auto', center: 0 }, store.get('fusebox.settings', {}));
const saveSettings = () => store.set('fusebox.settings', settings);

// ---------- DOM ----------
const stage = $('stage'), glass = $('glass'), keysEl = $('keys');
const ov = { menu: $('ovMenu'), msg: $('ovMsg'), pause: $('ovPause'), over: $('ovOver') };
// Sign-in, verified scores and leaderboards come from the shared UncleStev Arcade kit.
const arcade = createArcade('bomber', { rules: RULES, preview: PREVIEW, onOpen: () => pauseForModal() });
const modalOpen = () => !$('settings').hidden || arcade.isSheetOpen();

// ---------- app state ----------
const S = {
  mode: 'classic', paused: false, u: 0.5, uPrev: 0.5, uv: 0, kv: 0, time: 0, menuSel: 0, overAt: 0,
  hi: { classic: store.get('fusebox.hi', 0), nextgen: store.get('fusebox.hi.ng', 0), bitcoin: store.get('fusebox.hi.btc', 0) },
};
const HI_KEY = { classic: 'fusebox.hi', nextgen: 'fusebox.hi.ng', bitcoin: 'fusebox.hi.btc' };
const MODE_NAME = { classic: 'Classic', nextgen: 'Next Gen', bitcoin: 'Bitcoin Edition' };
let G = null;     // the running game (sim.js), null on the menu
let run = null;   // replay being recorded for the referee
let acc = 0;      // fixed-step accumulator
let inputMode = 'keyboard';
const K = { left: false, right: false };
let stickX = 0;
const attract = { x: 80, tx: 80, bob: 0, bobT: 0 }; // menu-only walker (not part of any game)

// =====================================================================
// audio
// =====================================================================
let AC = null, master = null, fuseGain = null, noiseBuf = null, fuseOn = false, musicBus = null;
function ensureAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume().catch(() => {}); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = settings.sound ? 0.5 : 0; master.connect(AC.destination);
    const len = AC.sampleRate; noiseBuf = AC.createBuffer(1, len, AC.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = AC.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3400; bp.Q.value = 0.9;
    fuseGain = AC.createGain(); fuseGain.gain.value = 0;
    src.connect(bp).connect(fuseGain).connect(master); src.start();
    musicBus = AC.createGain(); musicBus.gain.value = 0; musicBus.connect(master);
  } catch (e) { AC = null; }
}
function osc(dest, t, f, d, type = 'square', v = 0.1, slide = 0) {
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0008, t + d);
  o.connect(g).connect(dest); o.start(t); o.stop(t + d + 0.03);
}
function nz(dest, t, d, v, ft = 'lowpass', f0 = 2600, f1 = 120, q = 0.7) {
  const s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = noiseBuf; f.type = ft; f.Q.value = q; f.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + d);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0008, t + d);
  s.connect(f).connect(g).connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + d + 0.03);
}
const now = () => AC.currentTime;
const SCALE = [523, 587, 659, 698, 784, 880, 988, 1047];
const sfx = {
  drop() { if (AC) osc(master, now(), 1500, 0.02, 'square', 0.035); },
  catch(n) { if (AC) osc(master, now(), SCALE[n % 8], 0.08, 'square', 0.1); },
  boom() { if (AC) nz(master, now(), 0.34, 0.5); },
  lose() { if (AC) osc(master, now(), 330, 0.4, 'triangle', 0.22, 90); },
  clear() { if (AC) [523, 659, 784, 1047].forEach((f, i) => osc(master, now() + i * 0.07, f, 0.09, 'square', 0.09)); },
  bonus() { if (AC) [784, 988, 1175, 1568].forEach((f, i) => osc(master, now() + i * 0.06, f, 0.08, 'square', 0.09)); },
  over() { if (AC) [392, 330, 262, 196].forEach((f, i) => osc(master, now() + i * 0.2, f, 0.24, 'triangle', 0.18)); },
  start() { if (AC) { osc(master, now(), 660, 0.06, 'square', 0.09); osc(master, now() + 0.06, 990, 0.09, 'square', 0.09); } },
};
const ngs = {
  drop() { if (AC) nz(master, now(), 0.09, 0.07, 'bandpass', 1100, 380, 2); },
  catch(n, gold) {
    if (!AC) return; const t = now(), f = 440 * Math.pow(2, (n % 12) / 12);
    osc(master, t, f, 0.14, 'sine', 0.17); osc(master, t, f * 2, 0.09, 'triangle', 0.05);
    nz(master, t, 0.1, 0.1, 'highpass', 2600, 6000);
    if (gold) [1, 1.25, 1.5, 2].forEach((m, i) => osc(master, t + 0.03 + i * 0.045, f * 2 * m, 0.12, 'square', 0.035));
  },
  boom() { if (!AC) return; const t = now(); nz(master, t, 0.7, 0.55, 'lowpass', 3200, 80); osc(master, t, 130, 0.5, 'sine', 0.5, 30); },
  power() { if (AC) [523, 659, 784, 1047, 1319].forEach((f, i) => osc(master, now() + i * 0.05, f, 0.16, 'triangle', 0.12)); },
  shield() { if (!AC) return; const t = now(); nz(master, t, 0.45, 0.3, 'highpass', 5000, 1200); osc(master, t, 1900, 0.4, 'sine', 0.12, 420); },
  combo(m) { if (AC) [0, 4, 7, 12].forEach((s, i) => osc(master, now() + i * 0.06, 330 * Math.pow(2, (s + m * 2) / 12), 0.2, 'sawtooth', 0.05)); },
  lose() { if (AC) { osc(master, now(), 220, 0.7, 'sawtooth', 0.14, 50); nz(master, now(), 0.5, 0.2, 'lowpass', 1500, 200); } },
  clear() { if (AC) [523, 659, 784, 1047, 1319].forEach((f, i) => osc(master, now() + i * 0.07, f, 0.22, 'triangle', 0.12)); },
  bonus() { if (AC) [784, 988, 1175, 1568, 1976].forEach((f, i) => osc(master, now() + i * 0.05, f, 0.14, 'sine', 0.12)); },
  over() { if (AC) [392, 349, 311, 262, 196].forEach((f, i) => osc(master, now() + i * 0.22, f, 0.35, 'triangle', 0.16)); },
  start() { if (AC) { const t = now(); osc(master, t, 220, 0.35, 'sawtooth', 0.08, 880); nz(master, t, 0.35, 0.1, 'highpass', 800, 7000); } },
};
// Bitcoin Edition: coin clinks instead of splashes, a market crash instead of a bang.
const btcs = Object.assign({}, ngs, {
  drop() { if (AC) osc(master, now(), 2400, 0.035, 'sine', 0.035); },
  catch(n, gold) {
    if (!AC) return; const t = now(), f = 880 * Math.pow(2, (n % 12) / 12);
    osc(master, t, f, 0.13, 'sine', 0.14); osc(master, t, f * 2.76, 0.07, 'sine', 0.05); osc(master, t + 0.035, f * 1.5, 0.1, 'triangle', 0.06);
    if (gold) [1, 1.5, 2, 3].forEach((m, i) => osc(master, t + 0.05 + i * 0.04, f * m, 0.12, 'square', 0.03));
  },
  boom() { if (!AC) return; const t = now(); nz(master, t, 0.6, 0.45, 'lowpass', 2400, 90); osc(master, t, 520, 0.55, 'sawtooth', 0.12, 60); },
});
const NS = () => S.mode === 'bitcoin' ? btcs : ngs;
const SND = () => S.mode === 'classic' ? sfx : NS();
function setFuse(on) {
  if (!AC || on === fuseOn) return; fuseOn = on;
  fuseGain.gain.setTargetAtTime(on ? 0.035 : 0, AC.currentTime, 0.04);
}
const music = { on: false, step: 0, next: 0 };
const ROOTS = [55, 43.65, 65.41, 49];
function musicStep(i, t) {
  const bar = Math.floor(i / 16) % 4, s = i % 16, root = ROOTS[bar], grp = G ? G.group : 0;
  if (s % 4 === 0) osc(musicBus, t, 150, 0.22, 'sine', 0.55, 42);
  if (s % 2 === 1) nz(musicBus, t, 0.035, s % 4 === 3 ? 0.09 : 0.05, 'highpass', 7000, 7000);
  if (s === 4 || s === 12) { nz(musicBus, t, 0.14, 0.16, 'bandpass', 1800, 1200, 1); osc(musicBus, t, 190, 0.08, 'triangle', 0.08); }
  if ([0, 3, 6, 8, 10, 14].includes(s)) osc(musicBus, t, root * (s === 10 ? 1.5 : 1), 0.16, 'sawtooth', 0.09);
  if (grp >= 2 && s % 2 === 0) osc(musicBus, t, root * 4 * [1, 1.2, 1.5, 2][(s / 2) % 4], 0.1, 'square', 0.022);
}
function musicTick() {
  if (!AC || !musicBus) return;
  const want = settings.music && settings.sound && isNG(S.mode) && G && ['ready', 'play', 'clear'].includes(G.state)
    && !S.paused && !modalOpen() && !document.hidden;
  if (want !== music.on) {
    music.on = want; musicBus.gain.setTargetAtTime(want ? 0.5 : 0, AC.currentTime, 0.2);
    if (want) music.next = AC.currentTime + 0.05;
  }
  if (!want) return;
  if (music.next < AC.currentTime - 0.2) music.next = AC.currentTime + 0.02;
  const spb = 60 / (104 + (G ? G.group : 0) * 5) / 4;
  while (music.next < AC.currentTime + 0.12) { musicStep(music.step, music.next); music.next += spb; music.step = (music.step + 1) % 64; }
}
function buzz(ms) { if (!settings.vibrate) return; try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} }

// =====================================================================
// game flow
// =====================================================================
let E; // current renderer
const inGame = () => !!G && ['ready', 'play', 'clear', 'boom'].includes(G.state);
const running = () => !!G && (G.state === 'play' || G.state === 'clear' || G.state === 'boom');

function setInput(m) {
  if (m === inputMode) return;
  inputMode = m;
  $('ctlName').textContent = { keyboard: 'Keyboard', touch: 'Touch', mouse: 'Mouse', wheel: 'Racing wheel', gamepad: 'Gamepad' }[m];
  if (G && G.state === 'ready' && !S.paused) showReady();
}
function hintText() {
  return { touch: 'Tap to start the drop', mouse: 'Click to start the drop', wheel: 'Press a wheel button',
    gamepad: 'Press A to start', keyboard: 'Press Space' }[inputMode];
}
function show(name) {
  for (const k in ov) ov[k].hidden = k !== name;
  $('btnPause').hidden = !inGame();
}
function showMsg(title, sub, hint) {
  $('msgTitle').textContent = title; $('msgSub').textContent = sub;
  $('msgHint').hidden = !hint; if (hint) $('msgHint').textContent = hint;
  ov.msg.classList.remove('in'); void ov.msg.offsetWidth; ov.msg.classList.add('in');
  show('msg');
}
function updateHiLabels() {
  $('hiTop').textContent = fmt(S.hi[S.mode]); $('hiMenu').textContent = fmt(S.hi.classic); $('hiMenuNg').textContent = fmt(S.hi.nextgen);
  $('hiMenuBtc').textContent = fmt(S.hi.bitcoin);
}
function setView(v) {
  const ng = isNG(v);
  document.body.dataset.view = ng ? 'nextgen' : 'classic';
  document.body.dataset.skin = v === 'bitcoin' ? 'bitcoin' : '';
  CL.cv.hidden = ng; NG.cv.hidden = !ng;
  NG.setSkin(v === 'bitcoin' ? 'btc' : 'city');
  const brand = $('brand'); brand.textContent = 'BOMBER';
  if (ng) { brand.append(' '); brand.append(el('em', '', v === 'bitcoin' ? 'BTC' : 'NG')); }
  layout();
}
const MENU_BTNS = ['btnClassic', 'btnNextGen', 'btnBitcoin']; // same order as MODES
function updateMenuSel() { MENU_BTNS.forEach((id, i) => $(id).classList.toggle('sel', S.menuSel === i)); }

function startGame(mode) {
  ensureAudio();
  S.mode = mode; E = isNG(mode) ? NG : CL; setView(mode);
  // A rankable run: the kit asks the referee for a seed; if it arrives before the first bomb, restart with it.
  run = arcade.newRun(mode, seed => {
    if (!G || G.tick !== 0 || G.state !== 'ready' || G.mode !== mode) return false;
    G = createGame(mode, seed); return true;
  });
  Object.assign(run, { mode, segs: [], inputs: [] });
  G = createGame(mode, run.seed);
  Object.assign(S, { paused: false, u: 0.5, uPrev: 0.5, kv: 0 });
  acc = 0;
  E.reset();
  SND().start();
  try { navigator.wakeLock && navigator.wakeLock.request('screen').catch(() => {}); } catch (e) {}
  updateHiLabels();
  showReady();
}
function showReady() {
  const g = GROUPS[G.group];
  if (S.mode === 'bitcoin') showMsg('BLOCK ' + (G.group + 1), g.n + ' coins · ' + g.pts + (g.pts === 1 ? ' sat' : ' sats') + ' each', hintText());
  else showMsg('GROUP ' + (G.group + 1), g.n + ' bombs · ' + g.pts + (g.pts === 1 ? ' point' : ' points') + ' each', hintText());
}
function action() {
  if (S.paused || modalOpen() || !G || G.state !== 'ready') return;
  ensureAudio();
  startWave(G);
  run.lock(); // play has started: the seed can no longer change
  run.segs.push(0);
  handleEvents();
}
function handleEvents() {
  for (const e of G.ev) {
    E.onEvent(e);
    switch (e.t) {
      case 'wave': show(null); break;
      case 'ready': showReady(); break;
      case 'over': gameOver(); break;
      case 'lose': SND().lose(); buzz(180); break;
      case 'bonusBucket': SND().bonus(); break;
      case 'clear':
        if (G.mode === 'bitcoin') { showMsg('BLOCK MINED', '+' + e.bonus + ' block reward', null); btcs.clear(); }
        else if (G.ng) { showMsg('WAVE CLEAR', '+' + e.bonus + ' clear bonus', null); ngs.clear(); }
        else { showMsg('GROUP ' + (G.group + 1) + ' CLEAR', 'Score ' + G.score, null); sfx.clear(); }
        break;
    }
  }
  G.ev.length = 0;
}
function gameOver() {
  S.overAt = S.time;
  const best = G.score > S.hi[S.mode];
  if (best) { S.hi[S.mode] = G.score; store.set(HI_KEY[S.mode], G.score); updateHiLabels(); }
  const btc = S.mode === 'bitcoin';
  $('overLabel').textContent = btc ? 'Sats stacked' : 'Score';
  $('stGroupLabel').textContent = btc ? 'Block' : 'Group';
  $('overScore').textContent = fmt(G.score);
  const hiEl = $('overHi'); hiEl.textContent = '';
  if (best && G.score > 0) hiEl.append(el('b', '', 'NEW HIGH SCORE'));
  else { hiEl.append('HI SCORE '); hiEl.append(el('b', '', fmt(S.hi[S.mode]))); }
  const ngMode = G.ng;
  $('overStats').hidden = !ngMode;
  if (ngMode) { $('stBest').textContent = G.best; $('stCaught').textContent = G.caught; $('stGroup').textContent = G.maxGroup + 1; }
  SND().over(); show('over');
  const thisRun = run, score = G.score, stats = { group: G.maxGroup + 1, combo: G.best };
  arcade.showResult($('overNostr'), {
    run: thisRun, score,
    replay: () => encodeReplay(thisRun.mode, thisRun.seed, thisRun.segs, Uint16Array.from(thisRun.inputs)),
    shareText: verified => thisRun.mode === 'bitcoin'
      ? `I stacked ${fmt(score)} sats in Bomber: Bitcoin Edition${verified ? ' (verified)' : ''}: reached block ${stats.group}, best combo ${stats.combo}.` +
        `\n\nPlay: ${arcade.gameUrl}?mode=bitcoin\n#bomber #bitcoin`
      : `I scored ${fmt(score)} in Bomber ${MODE_NAME[thisRun.mode]}${verified ? ' (verified)' : ''}: ` +
        `reached group ${stats.group}${thisRun.mode === 'nextgen' ? ', best combo ' + stats.combo : ''}.\n\nPlay: ${arcade.gameUrl}\n#bomber`,
  });
}
function toMenu() {
  S.mode = 'classic'; E = CL; setView('classic');
  G = null; run = null; S.paused = false; CL.fx = [];
  updateHiLabels(); updateMenuSel(); show('menu');
}
function pause(on) {
  if (!inGame()) return;
  S.paused = on;
  if (on) show('pause');
  else if (G.state === 'ready') showReady();
  else if (G.state === 'clear') show('msg');
  else show(null);
}

// =====================================================================
// CLASSIC renderer — 160×192 pixels
// =====================================================================
const PAL = { Y:'#f2c230', S:'#e7a777', G:'#1d1d22', W:'#ffffff', M:'#7a3420', O:'#e8661c', K:'#121214', F:'#cfa36a',
  R:'#f4f4f4', B:'#6fcfff', L:'#b9bccb', D:'#7c8098', X:'#ff7a1a', Z:'#ffd23a', A:'#9a9aa8' };
const BOMBER_TOP = ['....YYYY....','..YYYYYYYY..','.YYYYYYYYYY.','YYYYYYYYYYYY','..SSSSSSSS..','..GGGSSGGG..','..GWGSSGWG..','..SSSSSSSS..'];
const BOMBER_BOT = ['....SSSS....','.OOOOOOOOOO.','OOOWOOOOWOOO','OOOWOOOOWOOO','SOOOOOOOOOOS','SOOOOOOOOOOS'];
const DIG = {
  '0':['111','101','101','101','111'],'1':['010','110','010','010','111'],'2':['111','001','111','100','111'],
  '3':['111','001','111','001','111'],'4':['101','101','111','001','001'],'5':['111','100','111','001','111'],
  '6':['111','100','111','101','111'],'7':['111','001','010','010','010'],'8':['111','101','111','101','111'],'9':['111','101','111','001','111']};
function sprite(rows) {
  const h = rows.length, w = rows[0].length;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const ch = rows[j][i];
    if (ch !== '.' && PAL[ch]) { x.fillStyle = PAL[ch]; x.fillRect(i, j, 1, 1); }
  }
  return c;
}
const SPR = {
  calm: sprite([...BOMBER_TOP, '..SSMMMMSS..', '...SSSSSS...', ...BOMBER_BOT]),
  grin: sprite([...BOMBER_TOP, '..SMWWWWMS..', '...SMMMMS...', ...BOMBER_BOT]),
  bomb: sprite(['...F...','...F...','..KKK..','.KKKKK.','KKWKKKK','KWKKKKK','KKKKKKK','.KKKKK.','..KKK..']),
  bucket: sprite(['RRRRRRRRRRRRRRRR','.BBBBBBBBBBBBBB.','.LLLLLLLLLLLLLL.','..LLDLLLLLLDLL..','..LLLLLLLLLLLL..','...DDDDDDDDDD...']),
  boomS: sprite(['.........','.........','...X.X...','....Z....','...ZWZ...','....Z....','...X.X...','.........','.........']),
  boomB: sprite(['....X....','.X..X..X.','..XXXXX..','..XZZZX..','XXXZWZXXX','..XZZZX..','..XXXXX..','.X..X..X.','....X....']),
  smoke: sprite(['.........','..A...A..','....A....','.A.....A.','...A.A...','.A.....A.','....A....','..A...A..','.........']),
  splash: sprite(['..B....B..','.B..BB..B.','B..B..B..B']),
};
const CCOL = { back: '#3b3560', brick: '#a39a8c', mortar: '#6f675c', field: '#3f62a8', boom: '#b5431c',
  ground: '#5b3b17', groundDot: '#76521f', score: '#ffd55a' };

const CL = {
  W: 160, H: 192, cv: $('screen'), c: null, fx: [], bob: 0, bobT: 0,
  displayX() { return CLASSIC.LO + Math.round(S.u * INPUT_MAX) / INPUT_MAX * (CLASSIC.HI - CLASSIC.LO); },
  uFromClientX(cx) { const r = this.cv.getBoundingClientRect(); return ((cx - r.left) / r.width * 160 - CLASSIC.LO) / (CLASSIC.HI - CLASSIC.LO); },
  rect() { return this.cv.getBoundingClientRect(); },
  travelCss() { return this.cv.getBoundingClientRect().width * (CLASSIC.HI - CLASSIC.LO) / 160; },
  reset() { this.fx = []; },
  onEvent(e) {
    if (e.t === 'drop') sfx.drop();
    else if (e.t === 'catch') { sfx.catch(e.n - 1); this.fx.push({ t: 'splash', x: e.x, y: e.top - 3, a: 0 }); }
    else if (e.t === 'explode') { this.fx.push({ t: 'boom', x: e.x, y: e.y, a: 0 }); sfx.boom(); }
  },
  update(dt) {
    let vx;
    if (!G) { // menu attract walker
      if (Math.random() < 0.5 * dt || Math.abs(attract.tx - attract.x) < 1) attract.tx = rnd(8, 152);
      const d = attract.tx - attract.x, st = 26 * dt;
      attract.x = Math.abs(d) <= st ? attract.tx : attract.x + Math.sign(d) * st; vx = 26;
    } else vx = running() ? G.bomber.vx : 0;
    if (Math.abs(vx) > 1) { this.bobT += dt; if (this.bobT > 0.12) { this.bobT = 0; this.bob ^= 1; } } else this.bob = 0;
    for (const f of this.fx) f.a += dt;
    this.fx = this.fx.filter(f => f.a < (f.t === 'boom' ? 0.5 : 0.16));
  },
  digits(str, cx, y) {
    const c = this.c, w = str.length * 8 - 2; let x = Math.round(cx - w / 2);
    c.fillStyle = CCOL.score;
    for (const ch of str) {
      const g = DIG[ch];
      for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (g[j][i] === '1') c.fillRect(x + i * 2, y + j * 2, 2, 2);
      x += 8;
    }
  },
  render() {
    const c = this.c, W = this.W, H = this.H, GY = CLASSIC.GROUND;
    c.fillStyle = '#000'; c.fillRect(0, 0, W, 14);
    c.fillStyle = CCOL.back; c.fillRect(0, 14, W, 26);
    const grin = G && (G.state === 'boom' || G.state === 'over');
    const bxp = G ? G.bomber.x : attract.x;
    c.drawImage(grin ? SPR.grin : SPR.calm, Math.round(bxp - 6), 24 + this.bob);
    c.fillStyle = CCOL.brick; c.fillRect(0, 40, W, 6);
    c.fillStyle = CCOL.mortar; c.fillRect(0, 42, W, 1); c.fillRect(0, 45, W, 1);
    for (let x = 0; x < W; x += 8) { c.fillRect(x, 40, 1, 2); c.fillRect(x + 4, 43, 1, 2); }
    let heat = 0;
    if (G && G.state === 'boom') heat = 0.15 + 0.5 * (G.boomDone / Math.max(1, G.boomTotal));
    if (heat) { const a = hex(CCOL.field), b = hex(CCOL.boom); c.fillStyle = rgb(a.map((v, i) => v + (b[i] - v) * heat)); }
    else c.fillStyle = CCOL.field;
    c.fillRect(0, 46, W, GY - 46);
    c.fillStyle = CCOL.ground; c.fillRect(0, GY, W, H - GY);
    c.fillStyle = CCOL.groundDot;
    for (let x = 2; x < W; x += 6) c.fillRect(x, GY + 3 + ((x / 6) & 1) * 3, 2, 1);
    if (G) {
      const sparkOn = Math.floor(S.time * 14) & 1;
      for (const b of G.bombs) {
        const bx = Math.round(b.x - 3), by = Math.round(b.y);
        c.drawImage(SPR.bomb, bx, by);
        c.fillStyle = sparkOn ? '#ffe36a' : '#ff8a2a';
        c.fillRect(bx + 3 + (sparkOn ? 1 : 0), by - 1, 1, 1);
      }
      const blinkLast = G.state === 'boom' && !G.boomQ.length && (Math.floor(S.time * 6) & 1);
      const bx = this.displayX();
      for (let k = 0; k < G.buckets; k++) {
        if (blinkLast && k === G.buckets - 1) continue;
        c.drawImage(SPR.bucket, Math.round(bx - 8), CLASSIC.TOPS[k]);
      }
      this.digits(String(G.score), W / 2, 2);
    }
    for (const f of this.fx) {
      if (f.t === 'splash') c.drawImage(SPR.splash, Math.round(f.x - 5), f.y);
      else c.drawImage(f.a < 0.06 ? SPR.boomS : f.a < 0.24 ? SPR.boomB : SPR.smoke, Math.round(f.x - 4), Math.round(f.y - 4));
    }
  },
};
CL.c = CL.cv.getContext('2d'); CL.c.imageSmoothingEnabled = false;

// =====================================================================
// NEXT GEN renderer — high-res city rooftop
// The play field is always 480 units wide (sim.js); wider screens get more city on the sides.
// =====================================================================
const SKY = [
  ['#4f86c6', '#93bde2', '#f7d39a'], ['#4a78bd', '#a2aedb', '#f6bd86'], ['#5068b0', '#b49ac8', '#f6a777'],
  ['#5160a6', '#be86b2', '#f4966a'], ['#4d559c', '#b0739f', '#ef855a'], ['#4a4b92', '#9d6496', '#e9784f'],
  ['#523f80', '#a05a7c', '#ee7346'], ['#62304a', '#b24c42', '#f78a36'],
].map(p => p.map(hex));
const PW = {
  wide:   { label: 'WIDE BUCKETS', color: '#38d8ff', time: 10 },
  slow:   { label: 'SLOW-MO', color: '#b18cff', time: 7 },
  shield: { label: 'SHIELD UP', color: '#4ee08a', time: 0 },
};
// Bitcoin Edition: a brighter blue night that deepens toward space as the blocks go by, so orange coins always stand out.
const BTC_SKY = [
  ['#2a56b0', '#4f7fd0', '#a3b8ec'], ['#2850a8', '#4a70c6', '#aaa8e4'], ['#284598', '#4a62b8', '#b39cda'],
  ['#263b88', '#4656a8', '#b18ece'], ['#22307a', '#41489a', '#a87ec2'], ['#1e2770', '#3c3c8e', '#9c6eb6'],
  ['#1a1e62', '#36307e', '#8e5ea8'], ['#151651', '#2f2670', '#7e4e9a'],
].map(p => p.map(hex));
const PW_BTC = {
  wide:   { label: 'WHALE WALLETS', color: '#38d8ff', time: 10 },
  slow:   { label: 'HALVING', color: '#b18cff', time: 7 },
  shield: { label: 'HODL SHIELD', color: '#4ee08a', time: 0 },
};
const ORANGE = '#f7931a';
const FONT = '"Chakra Petch", system-ui, sans-serif';
const NGc = NEXTGEN;
// The bitcoin sign, drawn as a tilted B with two strokes through the top and bottom (no font needs the ₿ character).
function btcGlyph(c, x, y, size, col, shadow) {
  c.save(); c.translate(x, y); c.rotate(-0.24);
  c.font = `700 ${size}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
  const bw = Math.max(1, size * 0.085), bh = size * 0.16;
  const draw = (dx, dy, color) => {
    c.fillStyle = color; c.fillText('B', dx, dy + size * 0.05);
    for (const bx of [-0.17, 0.0]) { c.fillRect(dx + bx * size, dy - size * 0.5, bw, bh); c.fillRect(dx + bx * size, dy + size * 0.38, bw, bh); }
  };
  if (shadow) draw(size * 0.05, size * 0.06, shadow);
  draw(0, 0, col);
  c.restore();
}
function bolt(c, x, y, s, col) {
  c.fillStyle = col; c.beginPath();
  c.moveTo(x + 2 * s, y - 9 * s); c.lineTo(x - 5 * s, y + 1 * s); c.lineTo(x - 0.5 * s, y + 1 * s); c.lineTo(x - 2 * s, y + 9 * s);
  c.lineTo(x + 5 * s, y - 1.5 * s); c.lineTo(x + 0.5 * s, y - 1.5 * s); c.closePath(); c.fill();
}

const NG = {
  cv: $('ng'), c: null, W: 480, H: 540, ox: 0, scale: 1,
  layers: null, vig: null, stars: [], beacons: [], V: null,
  skin: 'city', P: PW, // 'city' = Next Gen, 'btc' = Bitcoin Edition (same rules, different look)
  setSkin(skin) { this.skin = skin; this.P = skin === 'btc' ? PW_BTC : PW; },
  displayX() { return NGc.LO + Math.round(S.u * INPUT_MAX) / INPUT_MAX * (NGc.HI - NGc.LO); },
  uFromClientX(cx) { const r = this.cv.getBoundingClientRect(); return ((cx - r.left) / r.width * this.W - this.ox - NGc.LO) / (NGc.HI - NGc.LO); },
  rect() { return this.cv.getBoundingClientRect(); },
  travelCss() { return this.cv.getBoundingClientRect().width * (NGc.HI - NGc.LO) / this.W; },

  resize(cw, ch) {
    const cv = this.cv;
    cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const maxPx = 2.8e6; if (cw * ch * dpr * dpr > maxPx) dpr = Math.sqrt(maxPx / (cw * ch));
    const pw = Math.round(cw * dpr), ph = Math.round(ch * dpr);
    if (pw === cv.width && ph === cv.height && this.layers) return;
    cv.width = pw; cv.height = ph;
    this.scale = Math.min(ph / 540, pw / 480);
    this.W = pw / this.scale; this.H = ph / this.scale; this.ox = (this.W - 480) / 2;
    this.build();
  },
  build() {
    let seed = 7; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const W = this.W, H = this.H, s = this.scale, Gd = NGc.GROUND;
    this.stars = Array.from({ length: Math.round(W / 5) }, () => ({ x: rand() * W, y: 110 + rand() * 200, r: 0.4 + rand() * 1.1, ph: rand() * TAU, sp: 0.8 + rand() * 2 }));
    this.beacons = []; for (let x = 40; x < W; x += 150) this.beacons.push(x);
    const mk = () => { const c = document.createElement('canvas'); c.width = Math.ceil((W + 60) * s); c.height = Math.ceil(H * s); const x = c.getContext('2d'); x.scale(s, s); return [c, x]; };
    const city = (x, cfg) => {
      for (let bx = 0; bx < W + 60;) {
        const w = cfg.w[0] + rand() * (cfg.w[1] - cfg.w[0]), h = cfg.h[0] + rand() * (cfg.h[1] - cfg.h[0]), top = Gd - h;
        x.fillStyle = cfg.fill; x.fillRect(bx, top, w - 2, h);
        if (rand() < 0.3) x.fillRect(bx + w * 0.3, top - 14, 2, 14);
        if (cfg.tank && rand() < 0.18) { x.fillRect(bx + w * 0.55, top - 16, 14, 11); x.fillRect(bx + w * 0.55 + 2, top - 5, 2, 5); x.fillRect(bx + w * 0.55 + 10, top - 5, 2, 5); }
        for (let wy = top + 8; wy < Gd - 8; wy += cfg.wy) for (let wx = bx + 5; wx < bx + w - 8; wx += cfg.wx) {
          if (rand() < cfg.lit) { x.fillStyle = rand() < 0.15 ? cfg.cool : cfg.warm; x.globalAlpha = 0.35 + rand() * 0.6; x.fillRect(wx, wy, 3, 4); x.globalAlpha = 1; }
        }
        bx += w;
      }
    };
    const [far, fx] = mk(); city(fx, { w: [26, 70], h: [150, 310], fill: 'rgba(78,88,132,.42)', wx: 8, wy: 11, lit: 0.16, warm: '#ffcf7a', cool: '#9fd3ff' });
    const [near, nx] = mk(); city(nx, { w: [44, 110], h: [70, 190], fill: 'rgba(52,57,88,.9)', wx: 10, wy: 13, lit: 0.14, warm: '#ffb85c', cool: '#8fd0ff', tank: true });
    this.layers = { far, near };
    const v = document.createElement('canvas'); v.width = Math.ceil(W * s); v.height = Math.ceil(H * s);
    const vx = v.getContext('2d'); vx.scale(s, s);
    const vg = vx.createRadialGradient(W / 2, H * 0.48, H * 0.32, W / 2, H * 0.48, Math.max(W, H) * 0.85);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.3)');
    vx.fillStyle = vg; vx.fillRect(0, 0, W, H);
    this.vig = v;
  },
  reset() {
    this.V = { parts: [], pops: [], light: 0, lightT: 0, shake: 0, disp: 0, tilt: 0, slosh: 0,
      pal: this.sky()[0].map(a => a.slice()), bv: new Map(), bobT: 0, rockets: [], rekt: false, chart: this.newChart() };
  },
  sky() { return this.skin === 'btc' ? BTC_SKY : SKY; },
  bombVis(b) {
    let v = this.V.bv.get(b.id);
    if (!v) {
      const spin = this.skin === 'btc' ? (Math.random() < 0.5 ? -1 : 1) * rnd(2.5, 5) : rnd(-2.5, 2.5);
      v = { rot: rnd(-0.3, 0.3), spin, ph: rnd(0, TAU), emit: rnd(0, 0.1) }; this.V.bv.set(b.id, v);
    }
    return v;
  },
  // Background price chart (Bitcoin Edition): pumps on catches, dumps on misses. Purely decorative.
  newChart() {
    const ch = { p: 0, T: 0, candles: [] };
    let p = -0.4;
    for (let i = 0; i < 140; i++) { const o = p; p += (Math.random() - 0.42) * 0.03; ch.candles.push({ o, c: p, h: Math.max(o, p) + Math.random() * 0.01, l: Math.min(o, p) - Math.random() * 0.01 }); }
    ch.p = p; ch.cur = { o: p, c: p, h: p, l: p };
    return ch;
  },
  market(d) { const ch = this.V.chart; ch.p += d; const k = ch.cur; k.c = ch.p; k.h = Math.max(k.h, ch.p); k.l = Math.min(k.l, ch.p); },

  // ---------- effects ----------
  part(o) { if (this.V.parts.length < 1100) this.V.parts.push(o); },
  pop(x, y, text, col, size, life) { this.V.pops.push({ x, y, text, col, size, life, max: life }); },
  explode(x, y) {
    this.part({ kind: 'flash', x, y, r: 95, life: 0.26, max: 0.26, add: true });
    this.part({ kind: 'ring', x, y, r0: 10, r1: 120, life: 0.45, max: 0.45, add: true, col: '255,190,120' });
    for (let i = 0; i < 36; i++) {
      const a = rnd(0, TAU), sp = rnd(120, 470);
      this.part({ kind: 'dot', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, g: 380, drag: 2.2, life: rnd(0.35, 0.9), max: 0.9,
        size: rnd(1.4, 3.2), col: pick(['#fff2c2', '#ffc35a', '#ff7a1a', '#ff4d2e']), add: true });
    }
    for (let i = 0; i < 10; i++) this.part({ kind: 'smoke', x: x + rnd(-10, 10), y: y + rnd(-8, 4), vx: rnd(-40, 40), vy: rnd(-70, -20), g: -8, drag: 1,
      life: rnd(0.9, 1.6), max: 1.6, size: rnd(9, 17), grow: 26, col: '42,36,46', a: 0.6 });
    for (let i = 0; i < 7; i++) { const a = rnd(Math.PI * 1.1, Math.PI * 1.9); this.part({ kind: 'chunk', x, y, vx: Math.cos(a) * rnd(120, 300), vy: Math.sin(a) * rnd(160, 340), g: 700, drag: 0.4,
      life: rnd(0.6, 1.1), max: 1.1, size: rnd(2.5, 4.5), rot: rnd(0, TAU), vr: rnd(-12, 12), col: '#15161c' }); }
    this.V.lightT = Math.min(1.2, this.V.lightT + 0.55);
    this.V.shake = Math.min(14, this.V.shake + 7);
    ngs.boom(); buzz(50);
  },
  // Bitcoin Edition miss: a red market crash instead of a fireball, with the coin shattering into gold shards.
  crash(x, y) {
    const V = this.V;
    this.part({ kind: 'flash', x, y, r: 95, life: 0.26, max: 0.26, add: true, red: true });
    this.part({ kind: 'ring', x, y, r0: 10, r1: 120, life: 0.45, max: 0.45, add: true, col: '255,80,110' });
    for (let i = 0; i < 30; i++) {
      const a = rnd(0, TAU), sp = rnd(120, 440);
      this.part({ kind: 'dot', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, g: 380, drag: 2.2, life: rnd(0.35, 0.9), max: 0.9,
        size: rnd(1.4, 3), col: pick(['#ffd6dc', '#ff5470', '#ff2e55', '#ffb347']), add: true });
    }
    for (let i = 0; i < 9; i++) { const a = rnd(Math.PI * 1.1, Math.PI * 1.9); this.part({ kind: 'chunk', x, y, vx: Math.cos(a) * rnd(120, 300), vy: Math.sin(a) * rnd(160, 340), g: 700, drag: 0.4,
      life: rnd(0.6, 1.1), max: 1.1, size: rnd(2.5, 4.5), rot: rnd(0, TAU), vr: rnd(-12, 12), col: pick([ORANGE, '#ffd27a', '#b35c00']) }); }
    for (let i = 0; i < 8; i++) this.part({ kind: 'smoke', x: x + rnd(-10, 10), y: y + rnd(-8, 4), vx: rnd(-40, 40), vy: rnd(-70, -20), g: -8, drag: 1,
      life: rnd(0.9, 1.5), max: 1.5, size: rnd(8, 15), grow: 24, col: '60,30,50', a: 0.5 });
    if (V.rekt) { V.rekt = false; this.pop(clamp(x, 70, 410), Math.min(y, NGc.GROUND - 30) - 30, 'REKT', '#ff5470', 34, 1.2); }
    this.market(-0.06);
    V.lightT = Math.min(1.2, V.lightT + 0.55);
    V.shake = Math.min(14, V.shake + 7);
    btcs.boom(); buzz(50);
  },
  coinBurst(x, y, half, gold) {
    const cols = gold ? ['#e8fbff', '#9fe8ff', '#4fb8f0'] : ['#fff2c2', '#ffd27a', ORANGE];
    for (let i = 0; i < 14; i++) this.part({ kind: 'dot', x: x + rnd(-half * 0.6, half * 0.6), y, vx: rnd(-90, 90), vy: rnd(-260, -110), g: 650, drag: 0.6,
      life: rnd(0.4, 0.75), max: 0.75, size: rnd(1.4, 2.6), col: pick(cols), add: true });
    for (let i = 0; i < 4; i++) this.part({ kind: 'chunk', x: x + rnd(-half * 0.4, half * 0.4), y: y - 2, vx: rnd(-70, 70), vy: rnd(-230, -140), g: 700, drag: 0.4,
      life: rnd(0.4, 0.6), max: 0.6, size: rnd(3, 4.5), rot: rnd(0, TAU), vr: rnd(-14, 14), col: gold ? '#9fe8ff' : '#ffc23a' });
  },
  splash(x, y, half) {
    for (let i = 0; i < 13; i++) this.part({ kind: 'dot', x: x + rnd(-half * 0.6, half * 0.6), y, vx: rnd(-90, 90), vy: rnd(-260, -110), g: 650, drag: 0.6,
      life: rnd(0.4, 0.75), max: 0.75, size: rnd(1.5, 2.7), col: pick(['#8fdcff', '#c6efff', '#4fb8f0']) });
    for (let i = 0; i < 4; i++) this.part({ kind: 'smoke', x: x + rnd(-8, 8), y: y - 4, vx: rnd(-14, 14), vy: rnd(-55, -30), g: 0, drag: 1,
      life: rnd(0.5, 0.8), max: 0.8, size: rnd(4, 7), grow: 16, col: '225,235,245', a: 0.35 });
  },
  poof(x, y, col) {
    for (let i = 0; i < 10; i++) { const a = rnd(0, TAU), sp = rnd(30, 120);
      this.part({ kind: 'dot', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 0, drag: 3, life: rnd(0.3, 0.6), max: 0.6, size: rnd(1.2, 2.4), col, add: true }); }
  },
  onEvent(e) {
    const half = G.pw.wide > 0 ? NGc.HALF_WIDE : NGc.HALF, btc = this.skin === 'btc';
    switch (e.t) {
      case 'drop': NS().drop(); break;
      case 'catch':
        if (btc) { this.coinBurst(e.x, e.top, half, e.gold); this.market(e.gold ? 0.035 : 0.012); }
        else this.splash(e.x, e.top, half);
        this.pop(e.x, e.top - 16, '+' + e.pts, btc ? (e.gold ? '#9fe8ff' : '#ffd166') : (e.gold ? '#ffd166' : '#e8f4ff'), e.gold ? 22 : 17, 0.7);
        NS().catch(e.n, e.gold); break;
      case 'combo': this.pop(240, 250, (btc ? 'STACKING ×' : 'COMBO ×') + e.m, '#ffd166', 34, 1.1); NS().combo(e.m); break;
      case 'miss': this.V.rekt = true; break;
      case 'explode': if (btc) this.crash(e.x, e.y); else this.explode(e.x, e.y); break;
      case 'clear': if (btc) this.V.rockets.push({ t: 0, x0: rnd(60, 200), trail: 0 }); break;
      case 'shieldSave':
        for (let i = 0; i < 26; i++) this.part({ kind: 'chunk', x: e.x + rnd(-60, 60), y: NGc.GROUND - 5, vx: rnd(-160, 160), vy: rnd(-260, -80), g: 600, drag: 0.5,
          life: rnd(0.5, 0.9), max: 0.9, size: rnd(2, 4), rot: rnd(0, TAU), vr: rnd(-10, 10), col: '#4ee08a' });
        this.pop(240, 290, btc ? 'HODL! SAVED' : 'SHIELD SAVED YOU', '#4ee08a', 24, 1.2); NS().shield(); break;
      case 'power': {
        const d = this.P[e.type];
        this.pop(240, 290, d.label, d.color, 26, 1.2);
        for (let i = 0; i < 22; i++) { const a = rnd(0, TAU), sp = rnd(60, 220);
          this.part({ kind: 'dot', x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 80, drag: 2, life: rnd(0.4, 0.8), max: 0.8, size: rnd(1.4, 2.6), col: d.color, add: true }); }
        NS().power(); buzz(25); break;
      }
      case 'powerLost': this.poof(e.x, e.y, this.P[e.type].color); break;
      case 'lose': {
        const top = NGc.TOPS[e.bucket], x = this.displayX();
        const cols = btc ? ['#3d4452', '#6b7487', '#1b1e26', ORANGE] : ['#c9cfdb', '#8a93a6', '#e9edf5'];
        for (let i = 0; i < 16; i++) this.part({ kind: 'chunk', x: x + rnd(-24, 24), y: top + 10, vx: rnd(-170, 170), vy: rnd(-280, -90), g: 700, drag: 0.4,
          life: rnd(0.6, 1.1), max: 1.1, size: rnd(2.5, 5), rot: rnd(0, TAU), vr: rnd(-12, 12), col: pick(cols) });
        if (btc) { this.coinBurst(x, top, 30, false); this.coinBurst(x, top + 10, 30, false); }
        else { this.splash(x, top, 30); this.splash(x, top + 10, 30); }
        this.V.shake = Math.min(16, this.V.shake + 9); break;
      }
      case 'bonusBucket': this.pop(240, 320, btc ? '+1 WALLET' : '+1 BUCKET', btc ? '#ffd166' : '#8fdcff', 24, 1.2); break;
    }
  },

  // ---------- per-frame visuals ----------
  update(dt) {
    const V = this.V; if (!V) return;
    const target = this.sky()[G ? G.group : 0], k = Math.min(1, dt * 1.2);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) V.pal[i][j] += (target[i][j] - V.pal[i][j]) * k;
    const half = G && G.pw.wide > 0 ? NGc.HALF_WIDE : NGc.HALF;
    const uvx = S.uv * (NGc.HI - NGc.LO);
    V.tilt += (clamp(-uvx * 0.00025, -0.2, 0.2) - V.tilt) * Math.min(1, dt * 12);
    V.slosh += (clamp(-uvx * half * 0.0007, -half * 0.4, half * 0.4) - V.slosh) * Math.min(1, dt * 6);
    if (G) {
      for (const b of G.bombs) {
        const v = this.bombVis(b);
        if (running()) v.rot += v.spin * dt;
        v.emit -= dt;
        if (this.skin === 'btc') {
          if (v.emit <= 0 && v.tipX !== undefined) {
            v.emit = b.gold ? 0.05 : 0.11; const a = rnd(0, TAU);
            this.part({ kind: 'dot', x: v.tipX + Math.cos(a) * 9, y: v.tipY + Math.sin(a) * 9, vx: rnd(-20, 20), vy: rnd(-50, -10), g: 0, drag: 2, life: rnd(0.25, 0.45), max: 0.45,
              size: rnd(0.9, 1.6), col: b.gold ? '#c8f4ff' : pick(['#fff2c2', '#ffd27a']), add: true });
          }
        } else if (v.emit <= 0 && v.tipX !== undefined) {
          v.emit = 0.035;
          this.part({ kind: 'dot', x: v.tipX, y: v.tipY, vx: rnd(-45, 45), vy: rnd(-110, -30), g: 240, drag: 1.5, life: rnd(0.2, 0.4), max: 0.4,
            size: rnd(1, 1.8), col: pick(['#ffe39a', '#ffb347', '#ff7a1a']), add: true });
        }
      }
      if (V.bv.size > G.bombs.length + 40) { const live = new Set(G.bombs.map(b => b.id)); for (const id of V.bv.keys()) if (!live.has(id)) V.bv.delete(id); }
      V.disp += (G.score - V.disp) * Math.min(1, dt * 10);
      if (Math.abs(G.score - V.disp) < 0.5) V.disp = G.score;
    }
    if (this.skin === 'btc') {
      const ch = V.chart;
      this.market((Math.random() - 0.46) * 0.004);
      ch.T += dt;
      if (ch.T >= 0.5) { ch.T = 0; ch.candles.push(ch.cur); if (ch.candles.length > 160) ch.candles.shift(); ch.cur = { o: ch.p, c: ch.p, h: ch.p, l: ch.p }; }
      for (let i = V.rockets.length - 1; i >= 0; i--) {
        const r = V.rockets[i]; r.t += dt / 1.7;
        if (r.t >= 1) { V.rockets.splice(i, 1); continue; }
        const [x, y] = this.rocketPos(r, r.t);
        this.part({ kind: 'dot', x, y, vx: rnd(-20, 20), vy: rnd(10, 50), g: 0, drag: 1.5, life: rnd(0.3, 0.6), max: 0.6, size: rnd(1, 2.2), col: pick(['#fff2c2', '#ffb347', ORANGE]), add: true });
      }
    }
    const a = V.parts, Gd = NGc.GROUND;
    for (let i = a.length - 1; i >= 0; i--) {
      const p = a[i];
      p.life -= dt;
      if (p.life <= 0) { a[i] = a[a.length - 1]; a.pop(); continue; }
      if (p.vx !== undefined) {
        if (p.drag) { const f = Math.exp(-p.drag * dt); p.vx *= f; p.vy *= f; }
        p.vy += (p.g || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        if ((p.kind === 'dot' || p.kind === 'chunk') && p.y > Gd - 1 && p.vy > 0) { p.y = Gd - 1; p.vy *= -0.3; p.vx *= 0.6; }
      }
      if (p.grow) p.size += p.grow * dt;
      if (p.vr) p.rot += p.vr * dt;
    }
    for (let i = V.pops.length - 1; i >= 0; i--) { const p = V.pops[i]; p.life -= dt; p.y -= 34 * dt; if (p.life <= 0) V.pops.splice(i, 1); }
    V.lightT *= Math.exp(-dt / 0.45);
    V.light += (V.lightT - V.light) * Math.min(1, dt / 0.1);
    V.shake *= Math.exp(-dt / 0.13);
  },

  render() {
    const c = this.c, W = this.W, H = this.H, s = this.scale, V = this.V, t = S.time, Gd = NGc.GROUND, ox = this.ox;
    if (!V || !G) return;
    let sx = 0, sy = 0;
    if (settings.shake && V.shake > 0.2) { sx = rnd(-1, 1) * V.shake; sy = rnd(-1, 1) * V.shake; }
    c.setTransform(s, 0, 0, s, sx * s, sy * s);
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    const btc = this.skin === 'btc';
    if (btc) this.drawMoonSky(c, t); else this.drawCity(c, t);
    // street
    const gg = c.createLinearGradient(0, Gd, 0, H);
    gg.addColorStop(0, btc ? '#3b3a52' : '#45414f'); gg.addColorStop(1, btc ? '#1f1e2e' : '#25222c');
    c.fillStyle = gg; c.fillRect(-20, Gd, W + 40, H - Gd + 20);
    c.fillStyle = 'rgba(255,255,255,.1)'; c.fillRect(-20, Gd, W + 40, 2);
    // play field content, in sim coordinates
    c.save(); c.translate(ox, 0);
    if (btc) this.drawSatoshi(c, t); else this.drawSparky(c, t);
    c.restore();
    if (btc) this.drawRig(c, t); else this.drawParapet(c, t);
    c.save(); c.translate(ox, 0);
    this.drawField(c, t, btc);
  },
  drawCity(c, t) {
    const W = this.W, H = this.H, V = this.V, Gd = NGc.GROUND;
    // sky, stars, moon
    const p = V.pal, sg = c.createLinearGradient(0, 0, 0, Gd);
    sg.addColorStop(0, rgb(p[0])); sg.addColorStop(0.55, rgb(p[1])); sg.addColorStop(1, rgb(p[2]));
    c.fillStyle = sg; c.fillRect(-20, -20, W + 40, H + 40);
    const starVis = Math.max(0, (G.group - 3) * 0.16);
    if (starVis) {
      c.fillStyle = '#fff';
      for (const st of this.stars) { c.globalAlpha = starVis * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * st.sp + st.ph))); c.fillRect(st.x, st.y, st.r, st.r); }
      c.globalAlpha = 1;
    }
    c.globalAlpha = 0.45 + G.group * 0.07;
    const mx = W - 70, my = 150, mg = c.createRadialGradient(mx, my, 10, mx, my, 80);
    mg.addColorStop(0, 'rgba(255,238,210,.28)'); mg.addColorStop(1, 'rgba(255,238,210,0)');
    c.fillStyle = mg; c.fillRect(mx - 80, my - 80, 160, 160);
    c.fillStyle = '#f3ead6'; c.beginPath(); c.arc(mx, my, 19, 0, TAU); c.fill();
    c.fillStyle = 'rgba(160,150,140,.35)'; c.beginPath(); c.arc(mx - 6, my - 4, 4, 0, TAU); c.arc(mx + 5, my + 6, 3, 0, TAU); c.fill();
    c.globalAlpha = 1;
    // city
    const par = S.u - 0.5;
    c.drawImage(this.layers.far, -30 - par * 10, 0, W + 60, H);
    c.drawImage(this.layers.near, -30 - par * 24, 0, W + 60, H);
    const hz = c.createLinearGradient(0, Gd - 120, 0, Gd);
    hz.addColorStop(0, rgb(p[2], 0)); hz.addColorStop(1, rgb(p[2], 0.22));
    c.fillStyle = hz; c.fillRect(-20, Gd - 120, W + 40, 120);
  },
  // Everything in sim coordinates (already translated by ox), then the screen-space overlays and HUD.
  drawField(c, t, btc) {
    const W = this.W, H = this.H, s = this.scale, V = this.V, ox = this.ox;
    if (G.pw.shield) {
      const a = 0.55 + 0.2 * Math.sin(t * 3);
      const sh = c.createLinearGradient(0, Gd - 34, 0, Gd);
      sh.addColorStop(0, 'rgba(78,224,138,0)'); sh.addColorStop(1, `rgba(78,224,138,${0.22 * a})`);
      c.fillStyle = sh; c.fillRect(0, Gd - 34, 480, 34);
      c.fillStyle = `rgba(150,255,190,${a})`; c.fillRect(0, Gd - 3, 480, 2);
    }
    for (const b of G.bombs) { if (btc) this.drawCoin(c, b, t); else this.drawBomb(c, b, t); }
    if (btc) for (const r of V.rockets) this.drawRocket(c, r);
    for (const pw of G.powers) this.drawPower(c, pw);
    if (inGame() || G.state === 'over') {
      const bx = this.displayX(), half = G.pw.wide > 0 ? NGc.HALF_WIDE : NGc.HALF;
      const blinkLast = G.state === 'boom' && !G.boomQ.length && (Math.floor(t * 6) & 1);
      for (let k = 0; k < G.buckets; k++) {
        if (blinkLast && k === G.buckets - 1) continue;
        (btc ? this.drawWallet : this.drawBucket).call(this, c, bx, NGc.TOPS[k], half, V.tilt * (1 + k * 0.15), V.slosh, G.pw.wide > 0, k === 0);
      }
    }
    for (const q of V.parts) {
      if (q.add) continue;
      const al = q.life / q.max;
      if (q.kind === 'smoke') { c.fillStyle = `rgba(${q.col},${al * q.a})`; c.beginPath(); c.arc(q.x, q.y, q.size, 0, TAU); c.fill(); }
      else if (q.kind === 'chunk') { c.save(); c.globalAlpha = Math.min(1, al * 1.5); c.translate(q.x, q.y); c.rotate(q.rot); c.fillStyle = q.col; c.fillRect(-q.size / 2, -q.size / 2, q.size, q.size * 0.7); c.restore(); }
      else { c.globalAlpha = Math.min(1, al * 1.4); c.fillStyle = q.col; c.beginPath(); c.arc(q.x, q.y, q.size, 0, TAU); c.fill(); c.globalAlpha = 1; }
    }
    c.globalCompositeOperation = 'lighter';
    for (const b of G.bombs) {
      const v = V.bv.get(b.id); if (!v || v.tipX === undefined) continue;
      if (btc) {
        const r = b.gold ? 34 : 26, fg = c.createRadialGradient(v.tipX, v.tipY, 6, v.tipX, v.tipY, r);
        fg.addColorStop(0, b.gold ? 'rgba(140,220,255,.5)' : 'rgba(255,170,60,.4)'); fg.addColorStop(1, 'rgba(255,140,40,0)');
        c.fillStyle = fg; c.fillRect(v.tipX - r, v.tipY - r, r * 2, r * 2);
        continue;
      }
      const fl = 0.75 + 0.25 * Math.sin(t * 40 + v.ph), r = 12 * fl;
      const fg = c.createRadialGradient(v.tipX, v.tipY, 0, v.tipX, v.tipY, r);
      fg.addColorStop(0, 'rgba(255,240,190,.95)'); fg.addColorStop(0.35, 'rgba(255,150,40,.55)'); fg.addColorStop(1, 'rgba(255,90,20,0)');
      c.fillStyle = fg; c.fillRect(v.tipX - r, v.tipY - r, r * 2, r * 2);
    }
    for (const pw of G.powers) {
      const col = hex(this.P[pw.type].color), g2 = c.createRadialGradient(pw.cx, pw.y, 0, pw.cx, pw.y, 30);
      g2.addColorStop(0, rgb(col, 0.45)); g2.addColorStop(1, rgb(col, 0));
      c.fillStyle = g2; c.fillRect(pw.cx - 30, pw.y - 30, 60, 60);
    }
    for (const q of V.parts) {
      if (!q.add) continue;
      const al = q.life / q.max;
      if (q.kind === 'flash') {
        const r = q.r * (1.2 - 0.4 * al), fg = c.createRadialGradient(q.x, q.y, 0, q.x, q.y, r);
        if (q.red) { fg.addColorStop(0, `rgba(255,220,226,${0.75 * al})`); fg.addColorStop(0.4, `rgba(255,50,90,${0.42 * al})`); fg.addColorStop(1, 'rgba(255,30,70,0)'); }
        else { fg.addColorStop(0, `rgba(255,236,190,${0.75 * al})`); fg.addColorStop(0.4, `rgba(255,140,50,${0.4 * al})`); fg.addColorStop(1, 'rgba(255,80,20,0)'); }
        c.fillStyle = fg; c.fillRect(q.x - r, q.y - r, r * 2, r * 2);
      } else if (q.kind === 'ring') {
        const r = q.r0 + (q.r1 - q.r0) * (1 - al);
        c.strokeStyle = `rgba(${q.col},${0.6 * al})`; c.lineWidth = 3 * al + 0.5; c.beginPath(); c.arc(q.x, q.y, r, 0, TAU); c.stroke();
      } else {
        c.strokeStyle = q.col; c.globalAlpha = Math.min(1, al * 1.3); c.lineWidth = q.size; c.lineCap = 'round';
        c.beginPath(); c.moveTo(q.x, q.y); c.lineTo(q.x - q.vx * 0.022, q.y - q.vy * 0.022); c.stroke(); c.globalAlpha = 1;
      }
    }
    c.restore();
    c.globalCompositeOperation = 'lighter';
    if (V.light > 0.01) { c.fillStyle = `rgba(${btc ? '255,40,80' : '255,120,50'},${Math.min(0.24, V.light * 0.22)})`; c.fillRect(-20, -20, W + 40, H + 40); }
    c.globalCompositeOperation = 'source-over';
    if (G.pw.slow > 0) { c.fillStyle = `rgba(110,120,255,${0.1 * Math.min(1, G.pw.slow)})`; c.fillRect(-20, -20, W + 40, H + 40); }
    c.save(); c.translate(ox, 0);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const q of V.pops) {
      const al = Math.min(1, q.life / q.max * 2.2), sc = 1 + 0.25 * Math.max(0, (q.life / q.max - 0.8) * 5);
      c.font = `700 ${q.size * sc}px ${FONT}`; c.globalAlpha = al;
      c.fillStyle = 'rgba(0,0,0,.55)'; c.fillText(q.text, q.x + 1.5, q.y + 2);
      c.fillStyle = q.col; c.fillText(q.text, q.x, q.y);
    }
    c.globalAlpha = 1;
    c.restore();
    c.setTransform(s, 0, 0, s, 0, 0);
    c.drawImage(this.vig, 0, 0, W, H);
    this.drawHUD(c, t);
  },
  drawParapet(c, t) {
    const W = this.W, P = NGc.PARAPET;
    const pg = c.createLinearGradient(0, P, 0, P + 30);
    pg.addColorStop(0, '#8a8593'); pg.addColorStop(0.25, '#66626f'); pg.addColorStop(1, '#3b3844');
    c.fillStyle = pg; c.fillRect(-20, P, W + 40, 30);
    c.fillStyle = '#aaa5b3'; c.fillRect(-20, P, W + 40, 3);
    c.save(); c.beginPath(); c.rect(-20, P + 8, W + 40, 7); c.clip();
    c.fillStyle = '#16141c'; c.fillRect(-20, P + 8, W + 40, 7);
    c.fillStyle = '#f5b81c';
    for (let x = -40; x < W + 40; x += 14) { c.beginPath(); c.moveTo(x, P + 15); c.lineTo(x + 7, P + 8); c.lineTo(x + 14, P + 8); c.lineTo(x + 7, P + 15); c.closePath(); c.fill(); }
    c.restore();
    c.fillStyle = 'rgba(0,0,0,.25)'; for (let x = 32; x < W; x += 64) c.fillRect(x, P + 15, 1.5, 15);
    c.fillStyle = 'rgba(0,0,0,.3)'; c.fillRect(-20, P + 30, W + 40, 3);
    for (const x of this.beacons) {
      const on = 0.5 + 0.5 * Math.sin(t * 2.4 + x * 0.05);
      c.globalCompositeOperation = 'lighter';
      const bg = c.createRadialGradient(x, P - 2, 0, x, P - 2, 22);
      bg.addColorStop(0, `rgba(255,60,40,${0.5 * on})`); bg.addColorStop(1, 'rgba(255,60,40,0)');
      c.fillStyle = bg; c.fillRect(x - 22, P - 24, 44, 44);
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = `rgb(${150 + 105 * on | 0},40,30)`; c.beginPath(); c.arc(x, P, 4, Math.PI, 0); c.fill();
    }
  },
  arm(c, sx, sy, ang, sleeve = '#363b4c', hand = '#f1b68c') {
    const L = 27, ex = sx + Math.sin(ang) * L, ey = sy + Math.cos(ang) * L;
    c.strokeStyle = sleeve; c.lineWidth = 10; c.lineCap = 'round';
    c.beginPath(); c.moveTo(sx, sy); c.lineTo(ex, ey); c.stroke();
    c.fillStyle = hand; c.beginPath(); c.arc(ex, ey, 5.5, 0, TAU); c.fill();
  },
  drawSparky(c, t) {
    const b = G.bomber, P = NGc.PARAPET;
    const laugh = G.state === 'boom' || G.state === 'over';
    const vx = running() ? b.vx : 0;
    const moving = Math.abs(vx) > 3;
    const bob = moving ? -Math.abs(Math.sin(t * 13)) * 3 : Math.sin(t * 2) * 1;
    const lean = clamp(vx * 0.0011, -0.16, 0.16) + (laugh ? Math.sin(t * 26) * 0.05 : 0);
    c.save(); c.translate(b.x, P + 4 + bob); c.rotate(lean); c.scale(0.86, 0.86);
    const k = b.throwT / 0.22, swing = Math.sin(k * Math.PI);
    let angR = 0.35 + (b.hand > 0 ? swing * 1.7 : 0), angL = -0.35 - (b.hand < 0 ? swing * 1.7 : 0);
    if (laugh) { angR = 2.5 + Math.sin(t * 20) * 0.25; angL = -2.5 - Math.sin(t * 20 + 1) * 0.25; }
    this.arm(c, -19, -50, angL);
    const vg = c.createLinearGradient(0, -58, 0, 0);
    vg.addColorStop(0, '#ff8d33'); vg.addColorStop(1, '#d9520e');
    c.fillStyle = vg; rr(c, -23, -58, 46, 60, 12); c.fill();
    c.fillStyle = 'rgba(236,245,255,.92)'; c.fillRect(-15, -54, 5, 54); c.fillRect(10, -54, 5, 54); c.fillRect(-23, -30, 46, 5);
    c.fillStyle = '#363b4c'; c.beginPath(); c.moveTo(-8, -58); c.lineTo(0, -48); c.lineTo(8, -58); c.closePath(); c.fill();
    this.arm(c, 19, -50, angR);
    c.fillStyle = '#e8a77e'; c.fillRect(-5, -62, 10, 6);
    c.fillStyle = '#f1b68c'; c.beginPath(); c.arc(0, -72, 15, 0, TAU); c.fill();
    c.beginPath(); c.arc(-15, -71, 3.5, 0, TAU); c.arc(15, -71, 3.5, 0, TAU); c.fill();
    if (laugh) {
      c.fillStyle = '#3a0d0d'; c.beginPath(); c.moveTo(-8, -67); c.quadraticCurveTo(0, -54 + Math.sin(t * 26) * 1.5, 8, -67); c.closePath(); c.fill();
      c.fillStyle = '#fff'; c.fillRect(-6, -67, 12, 2.5);
    } else if (b.throwT > 0 && running()) {
      c.fillStyle = '#4a1a12'; c.beginPath(); c.ellipse(1, -64, 3, 3.6, 0, 0, TAU); c.fill();
    } else {
      c.strokeStyle = '#5a2a1a'; c.lineWidth = 2; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-6, -64); c.quadraticCurveTo(1, -61, 7, -65.5); c.stroke();
    }
    c.fillStyle = '#23262f'; c.fillRect(-15, -78, 30, 5);
    for (const gx of [-6, 6]) {
      c.fillStyle = '#9aa3b5'; c.beginPath(); c.arc(gx, -75.5, 6, 0, TAU); c.fill();
      c.fillStyle = '#17202e'; c.beginPath(); c.arc(gx, -75.5, 4.4, 0, TAU); c.fill();
      c.fillStyle = 'rgba(127,227,255,.8)'; c.beginPath(); c.arc(gx - 1.4, -77, 1.5, 0, TAU); c.fill();
    }
    const hg = c.createLinearGradient(0, -100, 0, -80);
    hg.addColorStop(0, '#ffe066'); hg.addColorStop(1, '#f2a90c');
    c.fillStyle = hg; c.beginPath(); c.arc(0, -82, 17, Math.PI, 0); c.closePath(); c.fill();
    c.fillStyle = '#e39a08'; rr(c, -22, -84, 44, 5, 2.5); c.fill();
    c.fillStyle = '#ffd84a'; c.fillRect(-2.5, -99, 5, 15);
    c.strokeStyle = 'rgba(255,255,255,.45)'; c.lineWidth = 2; c.beginPath(); c.arc(0, -82, 12, Math.PI * 1.15, Math.PI * 1.45); c.stroke();
    c.restore();
  },
  drawBomb(c, b, t) {
    const R = NGc.R, v = this.bombVis(b);
    const fuse = 1 - clamp((b.y - NGc.SPAWN_Y) / (NGc.GROUND - NGc.SPAWN_Y), 0, 1);
    c.save(); c.translate(b.x, b.y); c.rotate(v.rot);
    const halo = c.createRadialGradient(0, 0, R * 0.7, 0, 0, R + 10);
    halo.addColorStop(0, 'rgba(255,250,238,.6)'); halo.addColorStop(1, 'rgba(255,250,238,0)');
    c.fillStyle = halo; c.fillRect(-R - 10, -R - 10, 2 * R + 20, 2 * R + 20);
    const g = c.createRadialGradient(-4, -5, 1.5, 0, 0, R);
    if (b.gold) { g.addColorStop(0, '#fff6c0'); g.addColorStop(0.35, '#f5c542'); g.addColorStop(1, '#7c5000'); }
    else { g.addColorStop(0, '#666a7c'); g.addColorStop(0.4, '#262935'); g.addColorStop(1, '#060709'); }
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, R, 0, TAU); c.fill();
    c.strokeStyle = b.gold ? 'rgba(255,245,200,.9)' : 'rgba(255,255,255,.75)'; c.lineWidth = 1.6; c.stroke();
    c.strokeStyle = b.gold ? 'rgba(255,230,140,.5)' : 'rgba(255,170,90,.28)'; c.lineWidth = 1.2;
    c.beginPath(); c.arc(0, 0, R - 0.7, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
    c.fillStyle = b.gold ? '#c99a2a' : '#70747f'; rr(c, -4.5, -R - 3.5, 9, 6, 1.5); c.fill();
    const len = 4 + 13 * fuse, tx = 4 + Math.sin(t * 6 + v.ph) * 3, ty = -R - 3 - len;
    c.strokeStyle = '#cfa86e'; c.lineWidth = 2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(0, -R - 3); c.quadraticCurveTo(-4, -R - 3 - len * 0.55, tx, ty); c.stroke();
    c.restore();
    const cs = Math.cos(v.rot), sn = Math.sin(v.rot);
    v.tipX = b.x + tx * cs - ty * sn; v.tipY = b.y + tx * sn + ty * cs;
  },
  pwIcon(c, type, x, y, s) {
    c.save(); c.translate(x, y); c.scale(s, s);
    c.strokeStyle = '#fff'; c.fillStyle = '#fff'; c.lineWidth = 2; c.lineCap = 'round'; c.lineJoin = 'round';
    if (type === 'wide') {
      c.beginPath(); c.moveTo(-6, 0); c.lineTo(6, 0); c.stroke();
      c.beginPath(); c.moveTo(-7, 0); c.lineTo(-3, -3.5); c.lineTo(-3, 3.5); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(7, 0); c.lineTo(3, -3.5); c.lineTo(3, 3.5); c.closePath(); c.fill();
    } else if (type === 'slow' && this.skin === 'btc') {
      c.font = `700 13px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('½', 0, 1);
    } else if (type === 'slow') {
      c.beginPath(); c.moveTo(-4.5, -6); c.lineTo(4.5, -6); c.lineTo(-4.5, 6); c.lineTo(4.5, 6); c.closePath(); c.stroke();
    } else {
      c.beginPath(); c.moveTo(0, -6.5); c.lineTo(5.5, -4); c.quadraticCurveTo(5.5, 3, 0, 6.5); c.quadraticCurveTo(-5.5, 3, -5.5, -4); c.closePath(); c.stroke();
    }
    c.restore();
  },
  drawPower(c, p) {
    const col = this.P[p.type].color;
    c.save(); c.translate(p.cx, p.y);
    c.fillStyle = 'rgba(240,242,255,.92)'; c.beginPath(); c.arc(0, -28, 18, Math.PI, 0); c.closePath(); c.fill();
    c.fillStyle = col; c.globalAlpha = 0.5; c.beginPath(); c.arc(0, -28, 18, Math.PI * 1.33, Math.PI * 1.66); c.lineTo(0, -28); c.closePath(); c.fill(); c.globalAlpha = 1;
    c.strokeStyle = 'rgba(255,255,255,.6)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(-18, -28); c.lineTo(-8, -11); c.moveTo(18, -28); c.lineTo(8, -11); c.moveTo(0, -28); c.lineTo(0, -11); c.stroke();
    c.fillStyle = col; rr(c, -11, -11, 22, 22, 6); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 1.5; rr(c, -11, -11, 22, 22, 6); c.stroke();
    c.restore();
    this.pwIcon(c, p.type, p.cx, p.y, 1);
  },
  drawBucket(c, x, top, half, tilt, slosh, glow, handle) {
    const h = NGc.BH, tw = half, bw = half * 0.8, y0 = -h / 2, y1 = h / 2;
    c.save(); c.translate(x, top + h / 2); c.rotate(tilt);
    if (glow) { c.shadowColor = 'rgba(90,214,255,.95)'; c.shadowBlur = 14 * this.scale; }
    const g = c.createLinearGradient(-tw, 0, tw, 0);
    g.addColorStop(0, '#6c7588'); g.addColorStop(0.32, '#e6ebf3'); g.addColorStop(0.6, '#a6aebd'); g.addColorStop(1, '#4f5668');
    c.fillStyle = g;
    c.beginPath(); c.moveTo(-tw, y0); c.lineTo(tw, y0); c.lineTo(bw, y1); c.quadraticCurveTo(0, y1 + 4, -bw, y1); c.closePath(); c.fill();
    c.shadowBlur = 0;
    c.strokeStyle = 'rgba(18,22,34,.65)'; c.lineWidth = 1.5; c.stroke();
    c.strokeStyle = 'rgba(35,40,55,.45)'; c.lineWidth = 2;
    const band = (yy) => { const w = tw + (bw - tw) * ((yy - y0) / h); c.beginPath(); c.moveTo(-w, yy); c.lineTo(w, yy); c.stroke(); };
    band(y0 + 9); band(y1 - 6);
    c.fillStyle = '#f4f6fb'; c.beginPath(); c.ellipse(0, y0, tw, 4.6, 0, 0, TAU); c.fill();
    c.save(); c.beginPath(); c.ellipse(0, y0 + 0.5, tw - 2.5, 3.3, 0, 0, TAU); c.clip();
    c.fillStyle = '#1d6fb8'; c.fillRect(-tw, y0 - 5, tw * 2, 10);
    c.fillStyle = '#5cc9ff'; c.beginPath(); c.ellipse(slosh * 0.5, y0 + 1.2, tw - 4, 2.2, 0, 0, TAU); c.fill();
    c.restore();
    if (handle) { c.strokeStyle = 'rgba(200,206,220,.7)'; c.lineWidth = 1.5;
      c.beginPath(); c.arc(0, y0 + 2, tw * 0.95, Math.PI * 1.08, Math.PI * 1.92); c.stroke(); }
    c.restore();
  },
  // =================== Bitcoin Edition art ===================
  drawMoonSky(c, t) {
    const W = this.W, H = this.H, V = this.V, Gd = NGc.GROUND, p = V.pal;
    const sg = c.createLinearGradient(0, 0, 0, Gd);
    sg.addColorStop(0, rgb(p[0])); sg.addColorStop(0.55, rgb(p[1])); sg.addColorStop(1, rgb(p[2]));
    c.fillStyle = sg; c.fillRect(-20, -20, W + 40, H + 40);
    const starVis = 0.25 + G.group * 0.09;
    c.fillStyle = '#fff';
    for (const st of this.stars) { c.globalAlpha = starVis * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * st.sp + st.ph))); c.fillRect(st.x, st.y - 60, st.r, st.r); }
    c.globalAlpha = 1;
    // the moon gets bigger every block: we're going to the moon
    const [mx, my] = this.moonPos(), mr = 22 + G.group * 4.5;
    const mg = c.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 3.2);
    mg.addColorStop(0, 'rgba(255,240,215,.38)'); mg.addColorStop(1, 'rgba(255,240,215,0)');
    c.fillStyle = mg; c.fillRect(mx - mr * 3.2, my - mr * 3.2, mr * 6.4, mr * 6.4);
    const mf = c.createRadialGradient(mx - mr * 0.35, my - mr * 0.35, mr * 0.1, mx, my, mr);
    mf.addColorStop(0, '#fffaf0'); mf.addColorStop(1, '#e6dcc6');
    c.fillStyle = mf; c.beginPath(); c.arc(mx, my, mr, 0, TAU); c.fill();
    c.fillStyle = 'rgba(160,150,140,.32)';
    for (const [dx, dy, r] of [[-0.32, -0.2, 0.2], [0.28, 0.3, 0.15], [0.15, -0.42, 0.1], [-0.1, 0.42, 0.09]]) { c.beginPath(); c.arc(mx + mr * dx, my + mr * dy, mr * r, 0, TAU); c.fill(); }
    this.drawChart(c);
    const par = S.u - 0.5;
    c.drawImage(this.layers.far, -30 - par * 10, 0, W + 60, H);
    c.drawImage(this.layers.near, -30 - par * 24, 0, W + 60, H);
    const hz = c.createLinearGradient(0, Gd - 120, 0, Gd);
    hz.addColorStop(0, rgb(p[2], 0)); hz.addColorStop(1, rgb(p[2], 0.22));
    c.fillStyle = hz; c.fillRect(-20, Gd - 120, W + 40, 120);
  },
  moonPos() { return [this.W - 78, 168]; },
  drawChart(c) {
    const ch = this.V.chart, step = 10, n = Math.min(ch.candles.length, Math.ceil(this.W / step));
    const all = ch.candles.slice(-n).concat([ch.cur]);
    let lo = Infinity, hi = -Infinity;
    for (const k of all) { if (k.l < lo) lo = k.l; if (k.h > hi) hi = k.h; }
    const top = 190, bot = 400, span = Math.max(0.12, hi - lo), y = v => bot - (v - lo) / span * (bot - top);
    const x0 = this.W - 16 - (all.length - 1) * step;
    c.save();
    c.strokeStyle = 'rgba(255,255,255,.07)'; c.lineWidth = 1;
    for (let gy = top; gy <= bot; gy += 52.5) { c.beginPath(); c.moveTo(-20, gy); c.lineTo(this.W + 20, gy); c.stroke(); }
    c.globalAlpha = 0.4;
    for (let i = 0; i < all.length; i++) {
      const k = all[i], x = x0 + i * step, up = k.c >= k.o;
      c.fillStyle = up ? '#2ee88a' : '#ff4d6a';
      c.fillRect(x - 0.6, y(k.h), 1.2, Math.max(1, y(k.l) - y(k.h)));
      const a = y(Math.max(k.o, k.c)), b = y(Math.min(k.o, k.c));
      c.fillRect(x - 3, a, 6, Math.max(1.5, b - a));
    }
    c.restore();
  },
  drawRig(c, t) {
    const W = this.W, P = NGc.PARAPET;
    const g = c.createLinearGradient(0, P, 0, P + 30);
    g.addColorStop(0, '#4f566a'); g.addColorStop(0.18, '#2c313e'); g.addColorStop(1, '#171a22');
    c.fillStyle = g; c.fillRect(-20, P, W + 40, 30);
    c.fillStyle = '#7a8399'; c.fillRect(-20, P, W + 40, 2);
    c.fillStyle = ORANGE; c.fillRect(-20, P + 26, W + 40, 2.5);
    // a row of mining rigs: two spinning fans and status lights each
    const u = 56, off = ((this.ox % u) + u) % u - u;
    for (let x = off; x < W + u; x += u) {
      c.fillStyle = 'rgba(0,0,0,.5)'; c.fillRect(x, P + 3, 1.5, 23);
      for (const fx of [x + 15, x + 41]) {
        const fy = P + 14;
        c.fillStyle = '#0c0e13'; c.beginPath(); c.arc(fx, fy, 9, 0, TAU); c.fill();
        c.strokeStyle = '#444c5d'; c.lineWidth = 1.2; c.stroke();
        c.strokeStyle = 'rgba(160,170,190,.5)'; c.lineWidth = 2.4; c.lineCap = 'round';
        const a0 = t * 11 + fx * 0.1;
        c.beginPath();
        for (let k = 0; k < 3; k++) { const a = a0 + k * TAU / 3; c.moveTo(fx, fy); c.lineTo(fx + Math.cos(a) * 7, fy + Math.sin(a) * 7); }
        c.stroke();
        c.fillStyle = '#5b6375'; c.beginPath(); c.arc(fx, fy, 2, 0, TAU); c.fill();
      }
      const on = Math.sin(t * 9 + x * 0.37) > -0.2;
      c.fillStyle = on ? '#3dff8c' : '#1d5a36'; c.fillRect(x + 26.5, P + 6, 3, 2.5);
      c.fillStyle = Math.sin(t * 6.3 + x) > 0.4 ? '#ffb347' : '#5a3a12'; c.fillRect(x + 26.5, P + 18, 3, 2.5);
    }
    c.fillStyle = 'rgba(0,0,0,.3)'; c.fillRect(-20, P + 30, W + 40, 3);
  },
  // Satoshi: an anonymous hooded figure. There is deliberately no face, just shadow under the hood.
  drawSatoshi(c, t) {
    const b = G.bomber, P = NGc.PARAPET;
    const laugh = G.state === 'boom' || G.state === 'over';
    const vx = running() ? b.vx : 0, moving = Math.abs(vx) > 3;
    const bob = moving ? -Math.abs(Math.sin(t * 13)) * 3 : Math.sin(t * 2) * 1;
    const lean = clamp(vx * 0.0011, -0.16, 0.16) + (laugh ? Math.sin(t * 26) * 0.05 : 0);
    c.save(); c.translate(b.x, P + 4 + bob); c.rotate(lean); c.scale(0.86, 0.86);
    const k = b.throwT / 0.22, swing = Math.sin(k * Math.PI);
    let angR = 0.35 + (b.hand > 0 ? swing * 1.7 : 0), angL = -0.35 - (b.hand < 0 ? swing * 1.7 : 0);
    if (laugh) { angR = 2.5 + Math.sin(t * 20) * 0.25; angL = -2.5 - Math.sin(t * 20 + 1) * 0.25; }
    const SLEEVE = '#333846', GLOVE = '#15181f';
    this.arm(c, -19, -50, angL, SLEEVE, GLOVE);
    const hg = c.createLinearGradient(0, -60, 0, 2);
    hg.addColorStop(0, '#4a5060'); hg.addColorStop(1, '#23272f');
    c.fillStyle = hg; rr(c, -24, -60, 48, 62, 13); c.fill();
    c.fillStyle = 'rgba(0,0,0,.28)'; rr(c, -14, -21, 28, 13, 5); c.fill();
    c.fillStyle = ORANGE; c.beginPath(); c.arc(0, -38, 9, 0, TAU); c.fill();
    btcGlyph(c, 0, -38, 12, '#fff');
    c.strokeStyle = '#c9ccd4'; c.lineWidth = 1.4; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-5, -57); c.lineTo(-6, -49); c.moveTo(5, -57); c.lineTo(6, -49); c.stroke();
    this.arm(c, 19, -50, angR, SLEEVE, GLOVE);
    const hd = c.createLinearGradient(0, -100, 0, -56);
    hd.addColorStop(0, '#565d6f'); hd.addColorStop(1, '#2c303a');
    c.fillStyle = hd;
    c.beginPath(); c.moveTo(-21, -57); c.quadraticCurveTo(-25, -92, -3, -99); c.quadraticCurveTo(1, -100, 5, -98);
    c.quadraticCurveTo(25, -92, 21, -57); c.closePath(); c.fill();
    const fg = c.createRadialGradient(0, -69, 2, 0, -72, 15);
    fg.addColorStop(0, '#000'); fg.addColorStop(1, '#10131a');
    c.fillStyle = fg; c.beginPath(); c.ellipse(0, -71, 11.5, 14, 0, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.12)'; c.lineWidth = 1.5; c.beginPath(); c.ellipse(0, -71.5, 12.5, 15, 0, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
    if (laugh) { // laser eyes
      c.globalCompositeOperation = 'lighter';
      for (const ex of [-4.5, 4.5]) {
        const gl = c.createRadialGradient(ex, -73, 0, ex, -73, 9);
        gl.addColorStop(0, 'rgba(255,90,40,.95)'); gl.addColorStop(1, 'rgba(255,60,20,0)');
        c.fillStyle = gl; c.fillRect(ex - 9, -82, 18, 18);
        c.fillStyle = 'rgba(255,170,120,.7)'; c.fillRect(ex - 7, -73.6, 14, 1.2);
      }
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = '#ffe2cc'; for (const ex of [-4.5, 4.5]) { c.beginPath(); c.arc(ex, -73, 1.6, 0, TAU); c.fill(); }
    }
    c.restore();
  },
  drawCoin(c, b, t) {
    const R = NGc.R + 1, v = this.bombVis(b);
    const flip = Math.cos(v.rot * 1.6), sx = Math.max(0.14, Math.abs(flip));
    c.save(); c.translate(b.x, b.y);
    c.save(); c.scale(sx, 1);
    c.fillStyle = b.gold ? '#1f5f9c' : '#8c4a00'; c.beginPath(); c.arc(0, 0, R, 0, TAU); c.fill();
    const g = c.createRadialGradient(-4, -5, 1.5, 0, 0, R);
    if (b.gold) { g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, '#bdeeff'); g.addColorStop(1, '#3a9be8'); }
    else { g.addColorStop(0, '#ffe7a3'); g.addColorStop(0.45, '#f9a531'); g.addColorStop(1, '#c86a00'); }
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, R - 1.6, 0, TAU); c.fill();
    c.strokeStyle = b.gold ? 'rgba(255,255,255,.75)' : 'rgba(255,236,180,.8)'; c.lineWidth = 1.2;
    c.beginPath(); c.arc(0, 0, R - 4, 0, TAU); c.stroke();
    if (sx > 0.32) {
      if (b.gold) bolt(c, 0, 0, 0.95, '#0f4f8a');
      else btcGlyph(c, 0, 0, 15, '#fff6e2', 'rgba(120,60,0,.55)');
    }
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1.6;
    c.beginPath(); c.arc(0, 0, R - 2.5, Math.PI * 1.1, Math.PI * 1.45); c.stroke();
    c.restore();
    c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 1.4;
    c.beginPath(); c.ellipse(0, 0, R * sx + 0.4, R + 0.4, 0, 0, TAU); c.stroke();
    c.restore();
    v.tipX = b.x; v.tipY = b.y;
  },
  // Cold wallets: steel vaults with an orange stripe, a little screen and a pile of coins inside.
  drawWallet(c, x, top, half, tilt, slosh, glow, isTop) {
    const h = NGc.BH, tw = half, bw = half * 0.86, y0 = -h / 2, y1 = h / 2;
    c.save(); c.translate(x, top + h / 2); c.rotate(tilt);
    if (glow) { c.shadowColor = 'rgba(90,214,255,.95)'; c.shadowBlur = 14 * this.scale; }
    const g = c.createLinearGradient(-tw, 0, tw, 0);
    g.addColorStop(0, '#2b303b'); g.addColorStop(0.3, '#75809a'); g.addColorStop(0.58, '#424a5a'); g.addColorStop(1, '#1c2029');
    c.fillStyle = g;
    c.beginPath(); c.moveTo(-tw, y0); c.lineTo(tw, y0); c.lineTo(bw, y1); c.quadraticCurveTo(0, y1 + 2, -bw, y1); c.closePath(); c.fill();
    c.shadowBlur = 0;
    c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = 1.5; c.stroke();
    const wAt = yy => tw + (bw - tw) * ((yy - y0) / h);
    const sy = y0 + 7;
    c.fillStyle = ORANGE; c.beginPath(); c.moveTo(-wAt(sy), sy); c.lineTo(wAt(sy), sy); c.lineTo(wAt(sy + 3), sy + 3); c.lineTo(-wAt(sy + 3), sy + 3); c.closePath(); c.fill();
    c.fillStyle = '#07140d'; rr(c, -10, y0 + 13, 20, 9, 2); c.fill();
    c.strokeStyle = 'rgba(61,255,140,.35)'; c.lineWidth = 1; rr(c, -10, y0 + 13, 20, 9, 2); c.stroke();
    btcGlyph(c, 0, y0 + 17.5, 7, '#3dff8c');
    c.fillStyle = '#a9b1c2'; c.beginPath(); c.ellipse(0, y0, tw, 4.6, 0, 0, TAU); c.fill();
    c.save(); c.beginPath(); c.ellipse(0, y0 + 0.5, tw - 2.5, 3.3, 0, 0, TAU); c.clip();
    c.fillStyle = '#1d1407'; c.fillRect(-tw, y0 - 5, tw * 2, 10);
    c.fillStyle = '#d97f0e'; c.beginPath(); c.ellipse(slosh * 0.5, y0 + 1.6, tw - 4, 2.4, 0, 0, TAU); c.fill();
    c.fillStyle = '#ffd27a';
    for (let i = -2; i <= 2; i++) { c.beginPath(); c.ellipse(slosh * 0.5 + i * tw * 0.3, y0 + 1 + (i & 1) * 0.8, 3.4, 1.3, 0, 0, TAU); c.fill(); }
    c.restore();
    if (isTop) { c.fillStyle = Math.sin(S.time * 4) > 0 ? '#3dff8c' : '#1d5a36'; c.fillRect(tw * 0.62, y0 + 15, 2.5, 2.5); }
    c.restore();
  },
  // After each mined block, a tiny rocket heads for the moon.
  rocketPos(r, k) {
    const [mx, my] = this.moonPos(), x1 = mx - this.ox - 10, y1 = my + 10, x0 = r.x0, y0 = NGc.GROUND - 10;
    return [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k - Math.sin(Math.PI * k) * 70];
  },
  drawRocket(c, r) {
    const k = Math.min(1, r.t), [x, y] = this.rocketPos(r, k), [x2, y2] = this.rocketPos(r, Math.min(1, k + 0.01));
    c.save(); c.translate(x, y); c.rotate(Math.atan2(y2 - y, x2 - x) + Math.PI / 2);
    c.globalAlpha = Math.min(1, (1 - k) * 6);
    c.fillStyle = '#ffb347'; c.beginPath(); c.moveTo(-3, 6); c.lineTo(0, 13 + Math.random() * 4); c.lineTo(3, 6); c.closePath(); c.fill();
    c.fillStyle = '#f2f4fa'; c.beginPath(); c.moveTo(0, -9); c.quadraticCurveTo(5, -3, 4, 7); c.lineTo(-4, 7); c.quadraticCurveTo(-5, -3, 0, -9); c.fill();
    c.fillStyle = ORANGE; c.beginPath(); c.arc(0, -1, 1.8, 0, TAU); c.fill();
    c.fillStyle = '#c84a2a'; c.fillRect(-6, 4, 3, 4); c.fillRect(3, 4, 3, 4);
    c.restore();
  },
  drawHUD(c, t) {
    const W = this.W, H = this.H, V = this.V;
    const hg = c.createLinearGradient(0, 0, 0, 56);
    hg.addColorStop(0, 'rgba(6,7,14,.78)'); hg.addColorStop(1, 'rgba(6,7,14,0)');
    c.fillStyle = hg; c.fillRect(0, 0, W, 56);
    c.textBaseline = 'alphabetic';
    try { c.letterSpacing = '2px'; } catch (e) {}
    c.textAlign = 'left'; c.font = `600 11px ${FONT}`; c.fillStyle = 'rgba(225,230,250,.62)';
    const btc = this.skin === 'btc';
    c.fillText((btc ? 'SATS' : 'SCORE') + (run && run.ranked ? ' · RANKED' : ''), 16, 19);
    try { c.letterSpacing = '0px'; } catch (e) {}
    c.font = `700 28px ${FONT}`; c.fillStyle = '#fff';
    c.fillText(fmt(Math.round(V.disp)), 16, 46);
    for (let i = 0; i < 3; i++) {
      const x = W - 24 - (2 - i) * 24, y = 14, on = i < G.buckets;
      c.beginPath(); c.moveTo(x - 9, y); c.lineTo(x + 9, y); c.lineTo(x + 7, y + 14); c.lineTo(x - 7, y + 14); c.closePath();
      if (on && btc) { c.fillStyle = '#5d6577'; c.fill(); c.fillStyle = ORANGE; c.fillRect(x - 8, y + 4, 16, 3); c.fillStyle = '#ffd27a'; c.fillRect(x - 8, y, 16, 2); }
      else if (on) { c.fillStyle = '#dfe5ef'; c.fill(); c.fillStyle = '#4fb8f0'; c.fillRect(x - 8, y, 16, 3); }
      else { c.strokeStyle = 'rgba(255,255,255,.28)'; c.lineWidth = 1.5; c.stroke(); }
    }
    if (G.mult > 1) {
      const pulse = 1 + 0.06 * Math.sin(t * 8);
      c.save(); c.translate(W - 48, 44); c.scale(pulse, pulse);
      c.fillStyle = '#ff7a1a'; rr(c, -26, -10, 52, 20, 10); c.fill();
      c.fillStyle = '#1d1209'; c.font = `700 14px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('×' + G.mult + ' ' + G.streak, 0, 1);
      c.restore();
    }
    const sy = NGc.GROUND + Math.min(17, (H - NGc.GROUND) / 2), g = GROUPS[G.group];
    c.textAlign = 'left'; c.textBaseline = 'middle';
    try { c.letterSpacing = '2px'; } catch (e) {}
    c.font = `700 12px ${FONT}`; c.fillStyle = 'rgba(240,243,255,.9)';
    c.fillText((btc ? 'BLOCK ' : 'GROUP ') + (G.group + 1), 16, sy);
    try { c.letterSpacing = '0px'; } catch (e) {}
    const bx = 100, bw = Math.min(170, W * 0.34);
    const prog = G.state === 'play' || G.state === 'boom' ? G.waveCaught / g.n : G.state === 'clear' ? 1 : 0;
    c.fillStyle = 'rgba(255,255,255,.16)'; rr(c, bx, sy - 3, bw, 6, 3); c.fill();
    if (prog > 0) { const pg = c.createLinearGradient(bx, 0, bx + bw, 0); pg.addColorStop(0, '#ff7a1a'); pg.addColorStop(1, '#ffd166');
      c.fillStyle = pg; rr(c, bx, sy - 3, Math.max(6, bw * prog), 6, 3); c.fill(); }
    let px = W - 26;
    const chips = [];
    if (G.pw.wide > 0) chips.push(['wide', G.pw.wide / this.P.wide.time]);
    if (G.pw.slow > 0) chips.push(['slow', G.pw.slow / this.P.slow.time]);
    if (G.pw.shield) chips.push(['shield', 1]);
    for (const [type, frac] of chips) {
      c.fillStyle = 'rgba(10,12,22,.75)'; c.beginPath(); c.arc(px, sy, 12, 0, TAU); c.fill();
      c.strokeStyle = this.P[type].color; c.lineWidth = 2.5; c.beginPath(); c.arc(px, sy, 11, -Math.PI / 2, -Math.PI / 2 + TAU * frac); c.stroke();
      this.pwIcon(c, type, px, sy, 0.8);
      px -= 30;
    }
    c.textBaseline = 'alphabetic'; c.textAlign = 'left';
  },
};
NG.c = NG.cv.getContext('2d');
NG.reset();

// =====================================================================
// input
// =====================================================================
const prevBtns = {}, lastAxis = {};
let padLabel = '', wheelAxis = 0, wheelSeen = false, stickLatch = 0;
const WHEEL_RE = /g29|g920|g923|g27|g25|driving force|racing wheel|wheel/i;
function isWheel(p) {
  if (settings.wheelMode === 'wheel') return true;
  if (settings.wheelMode === 'pad') return false;
  return WHEEL_RE.test(p.id);
}
function wheelFrac(a) {
  const deg = (a - settings.center) * 450 * (settings.wheelInvert ? -1 : 1);
  return clamp(deg / (settings.wheelDeg / 2), -1, 1);
}
function padButton(i, wheel) {
  ensureAudio();
  if (i === 9) { pause(!S.paused); return; }
  if (modalOpen()) return;
  if (!wheel && i > 3 && !(i >= 12 && i <= 15)) return;
  if (S.paused) return;
  if (!wheel && i >= 12) return; // d-pad steers, doesn't start
  if (!G) startGame(MODES[S.menuSel]);
  else if (G.state === 'over') { if (S.time - S.overAt > 0.9) startGame(S.mode); }
  else action();
}
function pollPads() {
  let pads = [];
  try { pads = navigator.getGamepads ? navigator.getGamepads() : []; } catch (e) { pads = []; }
  stickX = 0; padLabel = '';
  for (const p of pads) {
    if (!p) continue;
    const wheel = isWheel(p);
    if (!padLabel) padLabel = p.id;
    const prev = prevBtns[p.index] || [];
    const nowB = p.buttons.map(b => b.pressed || b.value > 0.5);
    nowB.forEach((on, i) => { if (on && !prev[i]) { setInput(wheel ? 'wheel' : 'gamepad'); padButton(i, wheel); } });
    prevBtns[p.index] = nowB;
    const a0 = p.axes[0] || 0;
    const moved = Math.abs(a0 - (lastAxis[p.index] ?? a0)) > 0.004;
    lastAxis[p.index] = a0;
    if (wheel) {
      wheelAxis = a0; wheelSeen = true;
      if (moved) setInput('wheel');
      const f = wheelFrac(a0);
      if (!G && inputMode === 'wheel') { const sel = f < -0.45 ? 0 : f > 0.45 ? 2 : Math.abs(f) < 0.2 ? 1 : S.menuSel; if (sel !== S.menuSel) { S.menuSel = sel; updateMenuSel(); } }
      if (inputMode === 'wheel' && !S.paused) S.u = 0.5 + f / 2;
    } else {
      let sx = Math.abs(a0) > 0.18 ? a0 : 0;
      if (nowB[14]) sx = -1; if (nowB[15]) sx = 1;
      if (sx) setInput('gamepad');
      if (!G) {
        const dir = sx < -0.5 ? -1 : sx > 0.5 ? 1 : 0;
        if (dir && dir !== stickLatch) { S.menuSel = clamp(S.menuSel + dir, 0, MODES.length - 1); updateMenuSel(); }
        stickLatch = dir;
      } else stickX = sx;
    }
  }
}
let drag = null;
stage.addEventListener('pointerdown', e => {
  ensureAudio();
  if (e.target.closest('button, select, input, .modal')) return;
  drag = { id: e.pointerId, x: e.clientX, moved: 0 };
  if (e.pointerType !== 'mouse') { setInput('touch'); try { stage.setPointerCapture(e.pointerId); } catch (_) {} }
});
stage.addEventListener('pointermove', e => {
  if (S.paused || modalOpen()) return;
  if (e.pointerType === 'mouse') {
    const r = E.rect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top - 40 && e.clientY <= r.bottom + 40) {
      if (Math.abs(e.movementX || 0) > 0 || inputMode === 'mouse') { setInput('mouse'); S.u = clamp(E.uFromClientX(e.clientX), 0, 1); }
    }
    if (drag) drag.moved += Math.abs(e.movementX || 0);
    return;
  }
  if (!drag || drag.id !== e.pointerId) return;
  const dx = e.clientX - drag.x; drag.x = e.clientX; drag.moved += Math.abs(dx);
  S.u = clamp(S.u + dx / E.travelCss() * settings.touchSens, 0, 1);
});
function endDrag(e) {
  if (!drag || drag.id !== e.pointerId) return;
  const tap = drag.moved < 10; drag = null;
  if (tap && e.type === 'pointerup') action();
}
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);
// no magnifier, text selection, long-press menu or double-tap/pinch zoom anywhere in the game
const isCtl = e => e.target && e.target.closest && e.target.closest('button, select, input, label, a, .sheet, .ax-sheet');
for (const ev of ['touchstart', 'touchmove', 'touchend']) document.addEventListener(ev, e => { if (!isCtl(e) && e.cancelable) e.preventDefault(); }, { passive: false });
for (const ev of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick']) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
document.addEventListener('contextmenu', e => { if (!(e.target.closest && e.target.closest('input, .ax-mono'))) e.preventDefault(); });
document.addEventListener('selectstart', e => { if (!(e.target.closest && e.target.closest('input, .ax-mono'))) e.preventDefault(); });

addEventListener('keydown', e => {
  if (e.target && e.target.closest && e.target.closest('input, textarea, select')) return; // typing a nickname
  if (!$('settings').hidden) { if (e.key === 'Escape') closeSettings(); return; }
  const k = e.key;
  const isL = k === 'ArrowLeft' || k === 'a' || k === 'A', isR = k === 'ArrowRight' || k === 'd' || k === 'D';
  if (!G && (isL || isR)) { S.menuSel = clamp(S.menuSel + (isR ? 1 : -1), 0, MODES.length - 1); updateMenuSel(); setInput('keyboard'); e.preventDefault(); return; }
  if (isL) { K.left = true; setInput('keyboard'); e.preventDefault(); }
  else if (isR) { K.right = true; setInput('keyboard'); e.preventDefault(); }
  else if (k === ' ' || k === 'Enter') {
    if (e.target.closest && e.target.closest('button, input')) return;
    e.preventDefault(); ensureAudio(); setInput('keyboard');
    if (!G) startGame(MODES[S.menuSel]); else action();
  } else if (k === 'p' || k === 'P' || k === 'Escape') pause(!S.paused);
});
addEventListener('keyup', e => {
  const k = e.key;
  if (k === 'ArrowLeft' || k === 'a' || k === 'A') K.left = false;
  if (k === 'ArrowRight' || k === 'd' || k === 'D') K.right = false;
});
addEventListener('blur', () => { K.left = K.right = false; if (G && G.state === 'play') pause(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden && G && G.state === 'play') pause(true); });

// ---------- buttons ----------
MENU_BTNS.forEach((id, i) => {
  $(id).addEventListener('click', () => startGame(MODES[i]));
  $(id).addEventListener('mouseenter', () => { S.menuSel = i; updateMenuSel(); });
});
$('btnResume').addEventListener('click', () => pause(false));
$('btnQuit').addEventListener('click', toMenu);
$('btnAgain').addEventListener('click', () => startGame(S.mode));
$('btnMenu').addEventListener('click', toMenu);
$('btnPause').addEventListener('click', () => pause(!S.paused));
const fullBtn = $('btnFull');
if (!document.fullscreenEnabled) fullBtn.hidden = true;
fullBtn.addEventListener('click', () => {
  try {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => { fullBtn.hidden = true; });
  } catch (e) { fullBtn.hidden = true; }
});

// ---------- settings ----------
const opt = { sound: $('optSound'), music: $('optMusic'), shake: $('optShake'), vibrate: $('optVibrate'), touch: $('optTouch'),
  deg: $('optDeg'), invert: $('optInvert'), wheelMode: $('optWheelMode') };
function syncSettingsUI() {
  opt.sound.checked = settings.sound; opt.music.checked = settings.music; opt.shake.checked = settings.shake; opt.vibrate.checked = settings.vibrate;
  opt.touch.value = settings.touchSens; opt.deg.value = settings.wheelDeg; opt.invert.checked = settings.wheelInvert; opt.wheelMode.value = settings.wheelMode;
  $('valTouch').textContent = (+settings.touchSens).toFixed(1) + '×'; $('valDeg').textContent = settings.wheelDeg + '°';
}
function pauseForModal() { if (G && (G.state === 'play' || G.state === 'ready')) pause(true); }
function openSettings() { pauseForModal(); syncSettingsUI(); $('settings').hidden = false; $('setClose').focus(); }
function closeSettings() { $('settings').hidden = true; }
$('btnSettings').addEventListener('click', openSettings);
$('setClose').addEventListener('click', closeSettings);
$('settings').addEventListener('click', e => { if (e.target.id === 'settings') closeSettings(); });
opt.sound.addEventListener('change', () => {
  settings.sound = opt.sound.checked; saveSettings(); ensureAudio();
  if (master) master.gain.setTargetAtTime(settings.sound ? 0.5 : 0, AC.currentTime, 0.02);
});
opt.music.addEventListener('change', () => { settings.music = opt.music.checked; saveSettings(); });
opt.shake.addEventListener('change', () => { settings.shake = opt.shake.checked; saveSettings(); });
opt.vibrate.addEventListener('change', () => { settings.vibrate = opt.vibrate.checked; saveSettings(); });
opt.touch.addEventListener('input', () => { settings.touchSens = +opt.touch.value; syncSettingsUI(); saveSettings(); });
opt.deg.addEventListener('input', () => { settings.wheelDeg = +opt.deg.value; syncSettingsUI(); saveSettings(); });
opt.invert.addEventListener('change', () => { settings.wheelInvert = opt.invert.checked; saveSettings(); });
opt.wheelMode.addEventListener('change', () => { settings.wheelMode = opt.wheelMode.value; saveSettings(); });
$('btnCenter').addEventListener('click', () => { settings.center = wheelSeen ? wheelAxis : 0; saveSettings(); });
function updateSettingsLive() {
  if ($('settings').hidden) return;
  const st = $('padStatus');
  if (padLabel) {
    st.textContent = 'Detected: ';
    st.append(el('b', '', padLabel.replace(/\s*\(.*\)\s*$/, '').slice(0, 60)));
    if (wheelSeen) st.append(' · steering ' + Math.round((wheelAxis - settings.center) * 450) + '°');
  } else st.textContent = 'No controller detected. Plug in the wheel and press any button on it.';
  $('needle').style.left = (wheelSeen ? (0.5 + wheelFrac(wheelAxis) / 2) * 100 : 50) + '%';
}

// =====================================================================
// Nostr (arcade kit)
// =====================================================================
arcade.bindAccountButton($('btnAcct'), $('acctName'));
$('btnBoard').addEventListener('click', () => arcade.openSheet('board', MODES[S.menuSel]));

// =====================================================================
// layout + main loop
// =====================================================================
function layout() {
  const r = stage.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const ngView = document.body.dataset.view === 'nextgen';
  const below = coarse ? (r.height < 560 ? 64 : (ngView ? 110 : 150)) : (keysEl.offsetHeight || 0);
  if (ngView) {
    let cw = Math.floor(r.width), ch = Math.floor(Math.max(240, r.height - below - 10));
    if (cw / ch > 1.9) cw = Math.floor(ch * 1.9);
    ch = Math.min(ch, Math.floor(cw * 560 / 480)); // the field is 480 x 540; on tall phones the spare height goes to the drag pad
    NG.resize(cw, ch);
    glass.style.setProperty('--u', (Math.min(cw, ch) / 160).toFixed(3));
  } else {
    const availW = r.width - 24, availH = r.height - below - 10 - 40;
    const cw = Math.max(200, Math.floor(Math.min(availW, availH * 4 / 3)));
    const ch = Math.round(cw * 3 / 4);
    CL.cv.style.width = cw + 'px'; CL.cv.style.height = ch + 'px';
    glass.style.setProperty('--u', (cw / 160).toFixed(3));
  }
}
addEventListener('resize', layout);
try { new ResizeObserver(layout).observe(stage); } catch (e) {}

function updateInput(dt) {
  if (!G || S.paused || modalOpen()) { S.kv = 0; S.uv = 0; S.uPrev = S.u; return; }
  const dir = (K.right ? 1 : 0) - (K.left ? 1 : 0);
  if (dir) {
    if (Math.sign(S.kv) !== dir) S.kv = dir * 0.35;
    S.kv = clamp(S.kv + dir * KACC * dt, -KMAX, KMAX);
    S.u += S.kv * dt;
  } else S.kv = 0;
  if (Math.abs(stickX) > 0.18) S.u += stickX * KMAX * dt;
  S.u = clamp(S.u, 0, 1);
  S.uv = (S.u - S.uPrev) / Math.max(dt, 1e-3); S.uPrev = S.u;
}
// The game advances in fixed 1/60 s steps, recording the bucket position for each one.
function tickGame(dt) {
  if (!G || S.paused || modalOpen()) { acc = 0; return; }
  acc += dt;
  let n = 0;
  while (acc >= TICK && n < 8) {
    acc -= TICK; n++;
    if (!running()) continue;
    const u = Math.round(S.u * INPUT_MAX);
    run.inputs.push(u); run.segs[run.segs.length - 1]++;
    step(G, u);
    handleEvents();
    if (!G) return;
  }
  if (acc > TICK * 8) acc = 0;
}
let last = performance.now();
function frame(t) {
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  S.time += dt;
  pollPads();
  updateInput(dt);
  tickGame(dt);
  if (!S.paused && !modalOpen()) E.update(dt);
  E.render();
  setFuse(settings.sound && G && G.mode !== 'bitcoin' && G.state === 'play' && !S.paused && !modalOpen() && G.bombs.length > 0);
  musicTick();
  updateSettingsLive();
  requestAnimationFrame(frame);
}
function boot() {
  E = CL; document.body.dataset.view = 'classic';
  // bomber/?mode=bitcoin (from the hub's Bitcoin Edition cabinet) preselects that mode
  try { const m = new URLSearchParams(location.search).get('mode'); if (MODES.includes(m)) S.menuSel = MODES.indexOf(m); } catch (e) {}
  updateHiLabels(); updateMenuSel(); syncSettingsUI(); layout(); show('menu');
  try { document.fonts && document.fonts.load(`700 28px ${FONT}`).catch(() => {}); } catch (e) {}
  requestAnimationFrame(t => { last = t; requestAnimationFrame(frame); });
}
boot();
