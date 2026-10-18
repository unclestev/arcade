// Unified input: keyboard, on-screen touch controls, gamepads and racing wheels (Logitech G29).
import { G } from './ns.js';

const U = G.U;
const ACTIONS = ['left', 'right', 'up', 'down', 'gas', 'brake', 'fire', 'bomb', 'boost', 'pause', 'start', 'coin', 'confirm', 'back'];
const KEYMAP = {
  ArrowLeft: ['left'], KeyA: ['left'],
  ArrowRight: ['right'], KeyD: ['right'],
  ArrowUp: ['up', 'gas'], KeyW: ['up', 'gas'],
  ArrowDown: ['down', 'brake'], KeyS: ['down', 'brake'],
  Space: ['fire', 'confirm'], KeyJ: ['fire'], KeyZ: ['fire', 'confirm'],
  KeyK: ['bomb'], KeyX: ['bomb'],
  KeyL: ['boost'], KeyC: ['boost'], ShiftLeft: ['boost'], ShiftRight: ['boost'],
  Enter: ['start', 'confirm', 'pause'], NumpadEnter: ['start', 'confirm', 'pause'],
  Escape: ['pause', 'back'], KeyP: ['pause'], Backspace: ['back'],
  Digit1: ['start'],
};
const WHEEL_RE = /wheel|g29|g920|g923|g27|g25|driving force|racing|c24f|c260|c262|c266|c26e|c29b|c24b|thrustmaster|fanatec/i;

const I = {
  axes: { steer: 0, gas: 0, brake: 0 },
  device: 'keyboard',
  touchSeen: false,
  gamepadBlocked: false,
  wheel: null,          // { id, index, calibrated }
  pad: null,            // { id, index }
  settings: { wheelLock: 270, autoGas: true },
  cal: {},
  raceMode: false,      // touch auto-gas only applies while racing
};
const keysDown = new Set();
const queued = new Set();
let held = {}, prev = {}, pressed = {}, latched = {};
const repeatT = {};
const touch = { steer: 0, held: {} };
const pedalSeen = {};
let padPrevHeld = {};

function onKey(e, down) {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  const acts = KEYMAP[e.code];
  if (acts) {
    e.preventDefault();
    if (down) {
      if (!keysDown.has(e.code)) acts.forEach((a) => queued.add(a));
      keysDown.add(e.code);
    } else keysDown.delete(e.code);
    I.device = 'keyboard';
  }
  if (down && I.onKeyDown) I.onKeyDown(e);
}
window.addEventListener('keydown', (e) => onKey(e, true));
window.addEventListener('keyup', (e) => onKey(e, false));
window.addEventListener('blur', () => { keysDown.clear(); touch.held = {}; touch.steer = 0; });

// ---------- touch controls ----------
I.bindTouch = function (root) {
  const ptr = new Map();
  const steerEl = root.querySelector('[data-steer]');
  const setSteerFrom = (e) => {
    const r = steerEl.getBoundingClientRect();
    const rel = (e.clientX - r.left) / r.width;
    touch.steer = U.clamp((rel - 0.5) / 0.3, -1, 1);
    steerEl.dataset.dir = touch.steer < -0.2 ? 'left' : touch.steer > 0.2 ? 'right' : '';
  };
  root.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('[data-act],[data-steer]');
    if (!btn) return;
    e.preventDefault();
    I.touchSeen = true;
    I.device = 'touch';
    try { btn.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
    if (btn.hasAttribute('data-steer')) {
      ptr.set(e.pointerId, 'steer');
      setSteerFrom(e);
    } else {
      const act = btn.dataset.act;
      ptr.set(e.pointerId, act);
      touch.held[act] = true;
      queued.add(act);
      if (act === 'pause') queued.add('back');
      btn.classList.add('on');
    }
    if (G.audio) G.audio.unlock();
  });
  root.addEventListener('pointermove', (e) => {
    if (ptr.get(e.pointerId) === 'steer') setSteerFrom(e);
  });
  const up = (e) => {
    const act = ptr.get(e.pointerId);
    if (!act) return;
    ptr.delete(e.pointerId);
    if (act === 'steer') {
      touch.steer = 0;
      steerEl.dataset.dir = '';
    } else {
      touch.held[act] = false;
      const btn = root.querySelector('[data-act="' + act + '"]');
      if (btn) btn.classList.remove('on');
    }
  };
  root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', up);
  root.addEventListener('lostpointercapture', up);
  root.addEventListener('contextmenu', (e) => e.preventDefault());
};

// ---------- gamepads ----------
function getPads() {
  if (I.gamepadBlocked || !navigator.getGamepads) return [];
  try {
    return Array.from(navigator.getGamepads() || []).filter((p) => p && p.connected);
  } catch (e) {
    I.gamepadBlocked = true;
    return [];
  }
}
I.rawPads = getPads;

function defaultWheelProfile(pad) {
  const many = pad.axes.length >= 6;
  return {
    steerAxis: 0, steerMin: -1, steerMax: 1, steerCenter: 0,
    gasAxis: many ? 2 : 1, gasRest: 1, gasFull: -1,
    brakeAxis: many ? 5 : 2, brakeRest: 1, brakeFull: -1,
    buttons: { fire: [0, 4], bomb: [2, 5], boost: [1, 3, 6], pause: [9], coin: [8], confirm: [0, 3], back: [2] },
    guessed: true,
  };
}
I.wheelProfile = function (pad) {
  return I.cal[pad.id] || defaultWheelProfile(pad);
};

function pedal(pad, axis, rest, full) {
  if (axis < 0 || axis >= pad.axes.length) return 0;
  const v = pad.axes[axis];
  const key = pad.id + ':' + axis;
  if (v !== 0) pedalSeen[key] = true;
  if (!pedalSeen[key] && rest !== 0) return 0; // axis not reported yet
  const n = U.clamp((v - rest) / (full - rest), 0, 1);
  return n < 0.04 ? 0 : n;
}
const btn = (pad, i) => !!(pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5));
const anyBtn = (pad, list) => (list || []).some((i) => btn(pad, i));

// POV hat reported as an axis (common for wheels): returns {up,down,left,right}
function hat(pad) {
  const out = { up: false, down: false, left: false, right: false };
  for (let a = 9; a < pad.axes.length; a++) {
    const v = pad.axes[a];
    if (v > 1.05 || v < -1.05) continue;
    const pos = Math.round((v + 1) / (2 / 7));
    if (Math.abs(v + 1 - pos * (2 / 7)) > 0.05) continue;
    if (pos === 0 || pos === 1 || pos === 7) out.up = true;
    if (pos >= 1 && pos <= 3) out.right = true;
    if (pos >= 3 && pos <= 5) out.down = true;
    if (pos >= 5 && pos <= 7) out.left = true;
    return out;
  }
  return out;
}

function readPads(h) {
  const pads = getPads();
  let steer = 0, gas = 0, brake = 0;
  I.wheel = null;
  I.pad = null;
  for (const pad of pads) {
    const isWheel = WHEEL_RE.test(pad.id) || !!I.cal[pad.id];
    if (isWheel) {
      const p = I.wheelProfile(pad);
      I.wheel = { id: pad.id, index: pad.index, calibrated: !p.guessed };
      const raw = pad.axes[p.steerAxis] || 0;
      const off = raw - p.steerCenter;
      const rightSide = off * (p.steerMax - p.steerCenter) >= 0;
      let n = rightSide ? off / ((p.steerMax - p.steerCenter) || 1) : -off / ((p.steerMin - p.steerCenter) || -1);
      n = U.clamp(n * (900 / I.settings.wheelLock), -1, 1);
      if (Math.abs(n) < 0.015) n = 0;
      const g = pedal(pad, p.gasAxis, p.gasRest, p.gasFull);
      const b = pedal(pad, p.brakeAxis, p.brakeRest, p.brakeFull);
      if (Math.abs(n) > Math.abs(steer)) steer = n;
      gas = Math.max(gas, g);
      brake = Math.max(brake, b);
      const B = p.buttons || {};
      if (anyBtn(pad, B.fire)) h.fire = true;
      if (anyBtn(pad, B.bomb)) h.bomb = true;
      if (anyBtn(pad, B.boost)) h.boost = true;
      if (anyBtn(pad, B.pause)) { h.pause = true; h.start = true; }
      if (anyBtn(pad, B.coin)) h.coin = true;
      if (anyBtn(pad, B.confirm)) h.confirm = true;
      if (anyBtn(pad, B.back)) h.back = true;
      if (n < -0.35) h.left = true;
      if (n > 0.35) h.right = true;
      if (g > 0.6) { h.confirm = true; h.start = true; }
      if (b > 0.6) h.back = true;
      const ht = hat(pad);
      if (ht.up) h.up = true;
      if (ht.down) h.down = true;
      if (ht.left) h.left = true;
      if (ht.right) h.right = true;
      if (Math.abs(n) > 0.12 || g > 0.2 || b > 0.2 || pad.buttons.some((x) => x.pressed)) I.device = 'wheel';
    } else {
      I.pad = { id: pad.id, index: pad.index };
      const std = pad.mapping === 'standard';
      let sx = pad.axes[0] || 0;
      if (Math.abs(sx) < 0.15) sx = 0;
      else sx = Math.sign(sx) * (Math.abs(sx) - 0.15) / 0.85;
      if (std) {
        if (btn(pad, 14)) sx = -1;
        if (btn(pad, 15)) sx = 1;
      }
      if (Math.abs(sx) > Math.abs(steer)) steer = sx;
      const bv = (i) => (pad.buttons[i] ? pad.buttons[i].value || (pad.buttons[i].pressed ? 1 : 0) : 0);
      const g = std ? Math.max(bv(7), btn(pad, 0) ? 1 : 0) : (btn(pad, 0) ? 1 : 0);
      const b = std ? Math.max(bv(6), btn(pad, 2) ? 1 : 0) : (btn(pad, 2) ? 1 : 0);
      gas = Math.max(gas, g);
      brake = Math.max(brake, b);
      if (btn(pad, 1)) { h.fire = true; h.back = true; }
      if (btn(pad, 3)) h.bomb = true;
      if (btn(pad, 4) || btn(pad, 5)) h.boost = true;
      if (btn(pad, 9)) { h.pause = true; h.start = true; }
      if (btn(pad, 8)) h.coin = true;
      if (btn(pad, 0)) h.confirm = true;
      const sy = pad.axes[1] || 0;
      if (sy < -0.5 || (std && btn(pad, 12))) h.up = true;
      if (sy > 0.5 || (std && btn(pad, 13))) h.down = true;
      if (sx < -0.5) h.left = true;
      if (sx > 0.5) h.right = true;
      if (Math.abs(sx) > 0.3 || g > 0.2 || pad.buttons.some((x) => x.pressed)) I.device = 'pad';
    }
  }
  return { steer, gas, brake };
}

I.update = function (dt) {
  prev = held;
  held = {};
  for (const code of keysDown) (KEYMAP[code] || []).forEach((a) => { held[a] = true; });
  const kbSteer = (held.right ? 1 : 0) - (held.left ? 1 : 0);
  const kbGas = held.gas ? 1 : 0, kbBrake = held.brake ? 1 : 0;
  for (const a in touch.held) if (touch.held[a]) held[a] = true;
  const padHeld = {};
  const pads = readPads(padHeld);
  for (const a in padHeld) held[a] = true;

  // steer: strongest source wins
  let steer = kbSteer;
  if (Math.abs(touch.steer) > Math.abs(steer)) steer = touch.steer;
  if (Math.abs(pads.steer) > Math.abs(steer)) steer = pads.steer;
  let gas = Math.max(kbGas, touch.held.gas ? 1 : 0, pads.gas);
  const brake = Math.max(kbBrake, touch.held.brake ? 1 : 0, pads.brake);
  if (I.raceMode && I.device === 'touch' && I.settings.autoGas && !brake) gas = 1;
  I.axes.steer = steer;
  I.axes.gas = gas;
  I.axes.brake = brake;
  if (touch.steer < -0.35) held.left = true;
  if (touch.steer > 0.35) held.right = true;

  for (const a in latched) if (!held[a]) delete latched[a];
  pressed = {};
  for (const a of ACTIONS) {
    if ((held[a] && !prev[a]) || queued.has(a)) pressed[a] = true;
  }
  // pad edges come from polled state
  for (const a in padHeld) if (!padPrevHeld[a]) pressed[a] = true;
  padPrevHeld = padHeld;
  queued.clear();
  for (const a in latched) delete pressed[a];
  // auto-repeat for menu navigation
  for (const a of ['up', 'down', 'left', 'right']) {
    if (held[a] && !latched[a]) {
      repeatT[a] = (repeatT[a] || 0) + dt;
      if (repeatT[a] > 0.42) { pressed[a] = true; repeatT[a] = 0.3; }
    } else repeatT[a] = 0;
  }
};

I.held = (a) => !!held[a];
I.pressed = (a) => !!pressed[a];
I.anyPressed = () => ['confirm', 'start', 'fire', 'pause', 'back', 'bomb', 'boost'].some((a) => pressed[a]);
I.consume = (a) => { delete pressed[a]; };
// Forget pending presses; anything still held must be released before it counts again.
I.clearPressed = () => { pressed = {}; queued.clear(); latched = Object.assign({}, held); };

I.rumble = function (strength, ms) {
  try {
    for (const pad of getPads()) {
      if (pad.vibrationActuator && pad.vibrationActuator.playEffect) {
        pad.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 }).catch(() => {});
      }
    }
    if (I.device === 'touch' && navigator.vibrate) navigator.vibrate(Math.min(ms, 80));
  } catch (e) { /* ignore */ }
};

I.saveCal = function () {
  const st = U.store.load(G.CONFIG.STORAGE_KEY + '-input', {});
  st.cal = I.cal;
  st.settings = I.settings;
  U.store.save(G.CONFIG.STORAGE_KEY + '-input', st);
};
I.loadCal = function () {
  const st = U.store.load(G.CONFIG.STORAGE_KEY + '-input', {});
  if (st.cal) I.cal = st.cal;
  if (st.settings) Object.assign(I.settings, st.settings);
};
I.isWheelId = (id) => WHEEL_RE.test(id);

G.input = I;
