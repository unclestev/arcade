// Dirtbox Rally — browser app: boot, main loop, screens, recording runs and the arcade kit.
// Game rules live in sim.js so the referee can replay any run exactly.

import { G } from './ns.js';
import './config.js';
import './util.js';
import './font.js';
import './themes.js';
import * as S from './sim.js';
import './sprites.js';
import './ground.js';
import './audio.js';
import './input.js';
import './fx.js';
import { RaceView } from './view.js';
import './hud.js';
import './screens.js';
import { encodeReplay } from './replay.js';
import { createArcade } from '../../kit/arcade.js';

// The single-file preview build has no network access, so Nostr features are hidden there.
// eslint-disable-next-line no-undef
const PREVIEW = typeof __ARCADE_PREVIEW__ !== 'undefined' && __ARCADE_PREVIEW__;

const U = G.U, C = G.CONFIG;
const VW = C.VIEW_W, VH = C.VIEW_H;
const KEY = C.STORAGE_KEY;
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n).toLocaleString('en-US');

const DEFAULT_SETTINGS = { music: true, sfx: true, autoGas: true, wheelLock: 270, steerFeel: 'smooth', lastScheme: 0 };
G.settings = Object.assign({}, DEFAULT_SETTINGS, U.store.load(KEY + '.settings', {}));
G.saveSettings = () => U.store.save(KEY + '.settings', G.settings);
G.hiScore = U.store.load(KEY + '.hi', 0) || 0;
G.time = 0;

// ---------- arcade kit: sign-in, ranked runs, leaderboard ----------
let screenName = '';
const arcade = createArcade('dirtbox', {
  rules: S.RULES, preview: PREVIEW,
  onOpen: () => { if (screenName === 'race' && !G.screens.race.paused) G.screens.race.pause(); },
});
G.modalOpen = () => arcade.isSheetOpen();
G.openBoard = () => arcade.openSheet('board', 'classic');
arcade.bindAccountButton($('btnAcct'), $('acctName'));
$('btnBoard').addEventListener('click', () => G.openBoard());

let run = null;        // the ranked run being recorded for the referee
let acc = 0;           // fixed-step accumulator
const pend = { fire: false, bomb: false, boost: false }; // button presses waiting for the next tick

G.newRun = function () {
  G.game = null;
  G.view = null;
  // The kit asks the referee for a sealed seed. Accept it until the game is created with a seed.
  const r = arcade.newRun('classic', () => run === r && !r.locked && !G.game);
  Object.assign(r, { segs: [], inputs: [] });
  run = r;
};
G.beginGame = function (scheme) {
  if (!run) G.newRun();
  G.scheme = scheme;
  G.game = S.createGame('classic', run.seed);
};
G.beginRace = function () {
  const game = G.game;
  if (!S.startRace(game)) return;
  if (!run.locked) run.lock(); // play has started: the seed can no longer change
  run.segs.push(0);
  G.view = new RaceView(game, { scheme: G.scheme });
  G.view.handle(game.ev);
  game.ev.length = 0;
  acc = 0;
  pend.fire = pend.bomb = pend.boost = false;
  G.input.raceMode = true; // touch auto-gas applies while racing
};
G.rankedLabel = function () {
  if (!arcade.enabled) return 'PRACTICE RUN';
  if (run && run.ranked) return 'RANKED RUN';
  return run && run.locked ? 'UNRANKED: REFEREE WAS OFFLINE' : 'CONNECTING TO THE REFEREE...';
};

// The race advances in fixed 1/60 s ticks, recording the player's input for each one.
G.tickGame = function (dt) {
  const game = G.game, I = G.input;
  if (I.pressed('fire')) pend.fire = true;
  if (I.pressed('bomb')) pend.bomb = true;
  if (I.pressed('boost')) pend.boost = true;
  acc += dt;
  let n = 0;
  while (acc >= S.TICK && n < 8) {
    acc -= S.TICK;
    n++;
    if (game.state !== 'race') break;
    const u = S.packInput(I.axes.steer, I.axes.gas, I.axes.brake, pend.fire, pend.bomb, pend.boost);
    pend.fire = pend.bomb = pend.boost = false;
    run.inputs.push(u);
    run.segs[run.segs.length - 1]++;
    S.step(game, u);
    G.view.handle(game.ev);
    game.ev.length = 0;
  }
  if (acc > S.TICK * 8) acc = 0;
  const pl = game.race.player;
  const phase = game.race.phase;
  G.audio.engine(Math.abs(pl.vF) / S.TRUCK.vmax, pl.finished ? 0.3 : (phase === 'race' || phase === 'countdown' ? I.axes.gas : 0), pl.boostT > 0, game.state === 'race');
};

G.quitGame = function () {
  G.game = null;
  G.view = null;
  run = null;
  G.go('title');
};

// Attract-mode demo: four computer trucks on a random track. Not recorded.
G.makeDemo = function () {
  const seed = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  const game = S.createGame('classic', seed, { demo: true, level: 4 });
  game.raceNo = Math.floor(Math.random() * S.TRACKS.length);
  S.startRace(game);
  game.race.phase = 'race';
  const view = new RaceView(game, { scheme: Math.floor(Math.random() * 8), demo: true });
  game.ev.length = 0;
  let a = 0;
  return {
    game, view,
    update(dt) {
      a += dt;
      let n = 0;
      while (a >= S.TICK && n < 8 && game.state === 'race') {
        a -= S.TICK; n++;
        S.step(game, S.NO_INPUT);
        view.handle(game.ev);
        game.ev.length = 0;
      }
      view.update(dt);
    },
  };
};

// ---------- game-over panel (DOM, so the kit can offer a nickname box) ----------
G.showOver = function (on) {
  const ov = $('ovOver');
  if (!on) { ov.hidden = true; return; }
  const game = G.game;
  const score = game.score;
  const best = score > G.hiScore;
  if (best) { G.hiScore = score; U.store.save(KEY + '.hi', score); }
  $('overScore').textContent = fmt(score);
  $('stRace').textContent = game.raceNo + 1;
  $('stWins').textContent = game.wins;
  $('stCircuit').textContent = Math.floor(game.raceNo / S.TRACKS.length) + 1;
  const hi = $('overHi');
  hi.textContent = '';
  if (best && score > 0) hi.append(Object.assign(document.createElement('b'), { textContent: 'NEW HIGH SCORE' }));
  else { hi.append('HI SCORE '); hi.append(Object.assign(document.createElement('b'), { textContent: fmt(G.hiScore) })); }
  $('hiTop').textContent = fmt(G.hiScore);
  ov.hidden = false;
  const thisRun = run, raceNo = game.raceNo + 1;
  arcade.showResult($('overNostr'), {
    run: thisRun, score, stats: { race: raceNo, wins: game.wins },
    replay: () => encodeReplay('classic', thisRun.seed, thisRun.segs, Uint32Array.from(thisRun.inputs)),
    shareText: (verified) => `I scored ${fmt(score)} in Dirtbox Rally${verified ? ' (verified)' : ''}: reached race ${raceNo} with ${game.wins} win${game.wins === 1 ? '' : 's'}.\n\nPlay: ${arcade.gameUrl}\n#dirtboxrally`,
  });
  setTimeout(() => { try { $('btnAgain').focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 50);
};
$('btnAgain').addEventListener('click', () => { G.showOver(false); G.go('select'); });
$('btnMenu').addEventListener('click', () => { G.showOver(false); G.quitGame(); });

// ---------- screen manager ----------
let screen = null;
G.go = function (name, arg) {
  screenName = name;
  screen = G.screens[name];
  G.input.clearPressed();
  if (screen.enter) screen.enter(arg);
  updateTouchUI();
};
G.currentScreen = () => screenName;

const toasts = [];
G.toast = (text) => { toasts.push({ text, t: 0 }); };

// ---------- canvas & scaling ----------
const wrap = $('game');
const canvas = $('screen');
canvas.width = VW;
canvas.height = VH;
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
const touchUI = $('touch');

function fit() {
  const r = wrap.getBoundingClientRect();
  let s = Math.min(r.width / VW, r.height / VH);
  const si = Math.floor(s);
  if (si >= 2 && si / s > 0.86) s = si;
  canvas.style.width = Math.floor(VW * s) + 'px';
  canvas.style.height = Math.floor(VH * s) + 'px';
}
addEventListener('resize', fit);
try { new ResizeObserver(fit).observe(wrap); } catch (e) { /* ignore */ }
fit();

function updateTouchUI() {
  touchUI.hidden = !(G.input.touchSeen && screenName === 'race');
  touchUI.classList.toggle('autogas', !!G.settings.autoGas);
}
G.updateTouchUI = updateTouchUI;

let touchDown = false, fsOnUp = false;
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  try { canvas.focus({ preventScroll: true }); } catch (er) { /* ignore */ }
  if (e.pointerType === 'touch') { G.input.touchSeen = true; G.input.device = 'touch'; }
  G.audio.unlock();
  G.audio.resumePending();
  const r = canvas.getBoundingClientRect();
  touchDown = e.pointerType !== 'mouse';
  G.ui.click(((e.clientX - r.left) / r.width) * VW, ((e.clientY - r.top) / r.height) * VH);
  touchDown = false;
  updateTouchUI();
});
canvas.addEventListener('pointerup', () => { if (fsOnUp) { fsOnUp = false; G.toggleFullscreen(); } });

G.toggleFullscreen = function () {
  if (touchDown) { fsOnUp = true; return; }
  const d = document;
  try {
    if (!d.fullscreenElement && !d.webkitFullscreenElement) {
      const el = d.documentElement;
      const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen ? el.webkitRequestFullscreen() : null;
      if (p && p.then) p.then(() => { try { window.screen.orientation.lock('landscape').catch(() => {}); } catch (er) { /* ignore */ } }).catch(() => G.toast('FULLSCREEN NOT AVAILABLE HERE'));
      else if (!p) G.toast('FULLSCREEN NOT AVAILABLE HERE');
    } else (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  } catch (e) { G.toast('FULLSCREEN NOT AVAILABLE HERE'); }
};
$('btnFull').addEventListener('click', () => G.toggleFullscreen());

G.input.onKeyDown = (e) => {
  G.audio.unlock();
  G.audio.resumePending();
  if (G.modalOpen()) return;
  if (e.code === 'KeyF' && !e.repeat) G.toggleFullscreen();
  if (e.code === 'KeyM' && !e.repeat) {
    G.settings.music = !G.settings.music;
    G.audio.setMusic(G.settings.music);
    G.saveSettings();
    G.toast(G.settings.music ? 'MUSIC ON' : 'MUSIC OFF');
  }
};
addEventListener('pointerdown', () => { G.audio.unlock(); G.audio.resumePending(); }, { passive: true });

addEventListener('gamepadconnected', (e) => {
  const isWheel = G.input.isWheelId(e.gamepad.id);
  G.toast((isWheel ? 'WHEEL' : 'GAMEPAD') + ' CONNECTED');
  if (isWheel && !G.input.cal[e.gamepad.id]) setTimeout(() => G.toast('RUN WHEEL SETUP IN OPTIONS'), 1600);
});
addEventListener('gamepaddisconnected', () => G.toast('CONTROLLER DISCONNECTED'));
document.addEventListener('visibilitychange', () => {
  if (document.hidden && screenName === 'race' && !G.screens.race.paused) G.screens.race.pause();
});

// ---------- boot ----------
G.input.loadCal();
G.input.settings = G.settings;
G.audio.musicOn = G.settings.music;
G.audio.sfxOn = G.settings.sfx;
G.input.bindTouch(touchUI);
$('hiTop').textContent = fmt(G.hiScore);
G.go('title');

// A drawing bug must never freeze a run: log it once and keep going.
let glitched = false;
function reportGlitch(err) { if (!glitched) { glitched = true; console.error('Dirtbox Rally visual glitch:', err); } }
let last = performance.now();
let padWasPressed = false;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  G.time += dt;
  G.input.update(dt);
  if (G.input.device === 'wheel' || G.input.device === 'pad') {
    const any = G.input.anyPressed();
    if (any && !padWasPressed) { G.audio.unlock(); G.audio.resumePending(); }
    padWasPressed = any;
  }
  G.ui.reset();
  screen.update(dt);
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    screen.render(ctx);
    for (const t of toasts) t.t += dt;
    while (toasts.length && toasts[0].t > 2.6) toasts.shift();
    toasts.slice(0, 2).forEach((t, i) => {
      const y = VH - 40 - i * 14;
      const w = G.font.measure(t.text) + 10;
      ctx.fillStyle = 'rgba(14,10,22,0.85)';
      ctx.fillRect(VW / 2 - w / 2, y - 3, w, 13);
      G.font.text(ctx, t.text, VW / 2, y, { color: '#7cf0e0', align: 'center' });
    });
  } catch (err) { reportGlitch(err); }
}
requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });

// test hook for automated checks
G.debug = { get screen() { return screenName; }, get run() { return run; } };
window.__dirtbox = G;
