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
  settings: { wheelLock: 270, autoGas: true, steerFeel: 'smooth' },
  cal: {},
  raceMode: false,      // touch auto-gas only applies while racing
};

// Steering feel (Options > STEERING). Shapes only what the player sends; the race rules and
// replays are unchanged, so this needs no RULES bump.
//   keys / D-pad: a press starts at `start` and builds to full lock at `rise` per second,
//                 then recentres at `fall` per second when released
//   gamepad stick: light expo curve for finer corrections near centre
// SHARP is the original behaviour: keys snap to full lock, the stick is linear.
// The touch joystick is angle-based and the same in every setting (see stickSteer).
const FEEL = {
  smooth: { start: 0.4, rise: 6, fall: 14, expo: 0.25 },
  medium: { start: 0.6, rise: 10, fall: 20, expo: 0.12 },
  sharp: { start: 1, rise: 1e6, fall: 1e6, expo: 0 },
};
I.STEER_FEELS = ['smooth', 'medium', 'sharp'];
const feel = () => FEEL[I.settings.steerFeel] || FEEL.smooth;
function curve(x, f) {
  const a = Math.abs(x);
  return (x < 0 ? -1 : 1) * (a * (1 - f.expo) + a * a * a * f.expo);
}
let digSteer = 0; // ramped keyboard / D-pad steering
function rampDigital(dir, dt) {
  const f = feel();
  if (!dir) digSteer = U.approach(digSteer, 0, f.fall * dt);
  else {
    if (digSteer * dir <= 0) digSteer = dir * f.start; // fresh press or reversal: start with a nudge
    digSteer = U.approach(digSteer, dir, f.rise * dt);
  }
  return digSteer;
}

const keysDown = new Set();
const queued = new Set();
let held = {}, prev = {}, pressed = {}, latched = {};
const repeatT = {};
const touch = { steer: 0, vec: null, held: {}, el: null };
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
window.addEventListener('blur', () => { keysDown.clear(); touch.held = {}; touch.steer = 0; touch.vec = null; digSteer = 0; drawTouchSteer(); });

// ---------- touch controls ----------
// Touch joystick: the knob's angle sets the steering amount. Straight left or right is full lock,
// and it falls off evenly to zero as the knob moves round to straight up or down.
// nx, ny: finger offset from the stick centre in stick radii (y down).
const STICK_DEAD = 0.18;  // inside this radius: no steering
const STICK_FADE = 0.17;  // then steering fades in over this much radius (no jitter near centre)
function stickSteer(nx, ny) {
  const r = Math.sqrt(nx * nx + ny * ny);
  if (r <= STICK_DEAD) return 0;
  const tilt = Math.atan2(Math.abs(ny), Math.abs(nx)) / (Math.PI / 2); // 0 = level, 1 = straight up/down
  const amount = 1 - tilt;
  const fade = Math.min(1, (r - STICK_DEAD) / STICK_FADE);
  return (nx < 0 ? -1 : 1) * amount * fade;
}
// Knob follows the finger (held to the rim); the arc shows the steering amount.
function drawTouchSteer() {
  const el = touch.el;
  if (!el) return;
  const on = touch.vec !== null;
  let kx = 0, ky = 0;
  if (on) {
    const r = Math.sqrt(touch.vec.x * touch.vec.x + touch.vec.y * touch.vec.y);
    const k = r > 1 ? 1 / r : 1;
    kx = touch.vec.x * k; ky = touch.vec.y * k;
  }
  el.classList.toggle('active', on);
  el.style.setProperty('--kx', (kx * 50).toFixed(2) + '%');
  el.style.setProperty('--ky', (ky * 50).toFixed(2) + '%');
  el.dataset.pct = on ? Math.round(Math.abs(touch.steer) * 100) + '%' : '';
  el.dataset.dir = touch.steer < -0.02 ? 'left' : touch.steer > 0.02 ? 'right' : '';
}

I.bindTouch = function (root) {
  const ptr = new Map();
  const steerEl = root.querySelector('[data-steer]');
  touch.el = steerEl;
  const setSteerFrom = (e) => {
    const r = steerEl.getBoundingClientRect();
    const rad = r.width / 2;
    touch.vec = { x: (e.clientX - r.left - rad) / rad, y: (e.clientY - r.top - r.height / 2) / rad };
    touch.steer = stickSteer(touch.vec.x, touch.vec.y);
    drawTouchSteer();
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
      touch.vec = null;
      drawTouchSteer();
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
  let steer = 0, gas = 0, brake = 0, dpad = 0;
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
      else sx = Math.sign(sx) * Math.min(1, (Math.abs(sx) - 0.15) / 0.85);
      const curved = curve(sx, feel());
      if (Math.abs(curved) > Math.abs(steer)) steer = curved;
      // D-pad steers like the keyboard (ramped), so it is returned separately
      const dl = std && btn(pad, 14), dr = std && btn(pad, 15);
      if (dl !== dr) dpad = dl ? -1 : 1;
      if (dl) h.left = true;
      if (dr) h.right = true;
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
  return { steer, gas, brake, dpad };
}

I.update = function (dt) {
  prev = held;
  held = {};
  for (const code of keysDown) (KEYMAP[code] || []).forEach((a) => { held[a] = true; });
  const kbDir = (held.right ? 1 : 0) - (held.left ? 1 : 0);
  const kbGas = held.gas ? 1 : 0, kbBrake = held.brake ? 1 : 0;
  for (const a in touch.held) if (touch.held[a]) held[a] = true;
  const padHeld = {};
  const pads = readPads(padHeld);
  for (const a in padHeld) held[a] = true;

  // steer: strongest source wins
  let steer = rampDigital(kbDir || pads.dpad, dt);
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
