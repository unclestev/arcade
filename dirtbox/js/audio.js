// WebAudio chip synth: SFX, engine drone, and a small step sequencer for music.
import { G } from './ns.js';

const A = { ctx: null, musicOn: true, sfxOn: true };
let master, musicBus, sfxBus, noiseBuf, pulse12, pulse25;
let engine = null;

A.init = function () {
  if (A.ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  try { A.ctx = new AC(); } catch (e) { return false; }
  const ctx = A.ctx;
  master = ctx.createGain();
  master.gain.value = 0.7;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  master.connect(comp);
  comp.connect(ctx.destination);
  musicBus = ctx.createGain();
  musicBus.gain.value = A.musicOn ? 0.55 : 0;
  musicBus.connect(master);
  sfxBus = ctx.createGain();
  sfxBus.gain.value = A.sfxOn ? 0.9 : 0;
  sfxBus.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  pulse12 = makePulse(0.125);
  pulse25 = makePulse(0.25);
  return true;
};

function makePulse(duty) {
  const N = 32, re = new Float32Array(N), im = new Float32Array(N);
  for (let n = 1; n < N; n++) re[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
  return A.ctx.createPeriodicWave(re, im);
}

// iPhone: "ambient" sound, so the ring/silent switch mutes the game and it mixes with other
// audio (Safari 16.4+; ignored elsewhere).
try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch (e) { /* ignore */ }

let primed = false;
// Must run inside a user gesture that WebKit accepts (touchend / pointerup from a finger,
// click, keydown); a finger's pointerdown or touchstart does not unlock audio on iOS.
// Resumes from 'suspended' and from iOS's 'interrupted' (after switching away from a
// home-screen app or a phone call).
A.unlock = function () {
  if (!A.init()) return;
  const ctx = A.ctx;
  if (ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {});
  if (!primed) {
    // a silent one-sample buffer started in the gesture finishes unlocking older iOS
    primed = true;
    try {
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      s.connect(ctx.destination);
      s.start(0);
    } catch (e) { primed = false; }
  }
};
A.running = () => !!(A.ctx && A.ctx.state === 'running');

A.setMusic = function (on) {
  A.musicOn = on;
  if (musicBus) musicBus.gain.setTargetAtTime(on ? 0.55 : 0, A.ctx.currentTime, 0.05);
};
A.setSfx = function (on) {
  A.sfxOn = on;
  if (sfxBus) sfxBus.gain.setTargetAtTime(on ? 0.9 : 0, A.ctx.currentTime, 0.05);
  if (!on) A.engine(0, 0, 0, false);
};

function ready() {
  return A.ctx && A.ctx.state === 'running';
}

function osc(wave, f0, f1, t, dur, vol, dest, attack) {
  const ctx = A.ctx;
  const o = ctx.createOscillator();
  if (wave === 'p12') o.setPeriodicWave(pulse12);
  else if (wave === 'p25') o.setPeriodicWave(pulse25);
  else o.type = wave;
  o.frequency.setValueAtTime(f0, t);
  if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + (attack || 0.005));
  g.gain.exponentialRampToValueAtTime(vol * 0.5, t + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(dest || sfxBus);
  o.start(t);
  o.stop(t + dur + 0.03);
}

function noise(t, dur, vol, type, f0, f1, dest) {
  const ctx = A.ctx;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const filt = ctx.createBiquadFilter();
  filt.type = type || 'lowpass';
  filt.frequency.setValueAtTime(f0 || 2000, t);
  if (f1) filt.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filt);
  filt.connect(g);
  g.connect(dest || sfxBus);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

const N = (name) => {
  const m = /^([A-G])([#b]?)(\d)$/.exec(name);
  if (!m) return 0;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const midi = 12 * (parseInt(m[3], 10) + 1) + base;
  return 440 * Math.pow(2, (midi - 69) / 12);
};
const MIDI = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

function arp(notes, step, wave, vol) {
  const t = A.ctx.currentTime;
  notes.forEach((n, i) => osc(wave || 'square', N(n), 0, t + i * step, step * 1.6, vol || 0.18));
}

const SFX = {
  blip() { osc('square', 880, 0, A.ctx.currentTime, 0.05, 0.12); },
  select() { const t = A.ctx.currentTime; osc('square', 660, 0, t, 0.06, 0.15); osc('square', 990, 0, t + 0.06, 0.1, 0.15); },
  back() { const t = A.ctx.currentTime; osc('square', 523, 0, t, 0.06, 0.12); osc('square', 392, 0, t + 0.06, 0.1, 0.12); },
  coin() { const t = A.ctx.currentTime; osc('square', 988, 0, t, 0.08, 0.16); osc('square', 1319, 0, t + 0.08, 0.35, 0.16); },
  pickup() { arp(['C6', 'E6', 'G6'], 0.045, 'p25', 0.16); },
  upgrade() { arp(['C5', 'E5', 'G5', 'C6', 'E6', 'G6'], 0.055, 'p25', 0.17); },
  letter() { arp(['G5', 'B5', 'D6', 'G6', 'D6', 'G6'], 0.06, 'square', 0.15); },
  missile() { const t = A.ctx.currentTime; noise(t, 0.4, 0.35, 'bandpass', 2500, 500); osc('sawtooth', 420, 110, t, 0.3, 0.08); },
  bombdrop() { osc('triangle', 320, 110, A.ctx.currentTime, 0.18, 0.3); },
  explode() { const t = A.ctx.currentTime; noise(t, 0.8, 0.9, 'lowpass', 2200, 90); osc('sine', 130, 35, t, 0.5, 0.5); },
  wall() { const t = A.ctx.currentTime; noise(t, 0.09, 0.35, 'lowpass', 900); osc('square', 120, 70, t, 0.07, 0.1); },
  bump() { osc('square', 170, 90, A.ctx.currentTime, 0.08, 0.12); },
  jump() { osc('p25', 300, 760, A.ctx.currentTime, 0.18, 0.14); },
  land() { noise(A.ctx.currentTime, 0.14, 0.4, 'lowpass', 700, 150); },
  splash() { noise(A.ctx.currentTime, 0.35, 0.35, 'bandpass', 3200, 700); },
  skid() { noise(A.ctx.currentTime, 0.3, 0.25, 'bandpass', 1400, 900); },
  boost() { const t = A.ctx.currentTime; noise(t, 0.5, 0.35, 'bandpass', 300, 2600); osc('sawtooth', 160, 520, t, 0.45, 0.07); },
  beep() { osc('square', 440, 0, A.ctx.currentTime, 0.18, 0.18); },
  go() { osc('square', 880, 0, A.ctx.currentTime, 0.5, 0.2); },
  lap() { arp(['E5', 'A5', 'E6'], 0.07, 'p25', 0.16); },
  finallap() { arp(['A5', 'E6', 'A5', 'E6', 'A6'], 0.07, 'p25', 0.16); },
  spin() { const t = A.ctx.currentTime; for (let i = 0; i < 4; i++) osc('square', 700 - i * 120, 500 - i * 100, t + i * 0.07, 0.07, 0.1); },
  hit() { const t = A.ctx.currentTime; noise(t, 0.5, 0.7, 'lowpass', 3000, 120); osc('square', 220, 55, t, 0.35, 0.18); },
  extra() { arp(['C5', 'G5', 'C6', 'E6', 'G6', 'C7'], 0.08, 'p25', 0.17); },
  empty() { osc('square', 150, 0, A.ctx.currentTime, 0.08, 0.1); },
};

A.sfx = function (name) {
  if (!ready() || !A.sfxOn || !SFX[name]) return;
  SFX[name]();
};

// ---------- engine drone ----------
A.engine = function (speedFrac, throttle, boost, on) {
  if (!ready()) return;
  const ctx = A.ctx, t = ctx.currentTime;
  if (!on || !A.sfxOn) {
    if (engine) {
      engine.g.gain.setTargetAtTime(0, t, 0.05);
      const e = engine;
      engine = null;
      setTimeout(() => { try { e.o1.stop(); e.o2.stop(); } catch (er) { /* ignore */ } }, 300);
    }
    return;
  }
  if (!engine) {
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o2.setPeriodicWave(pulse25);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 600;
    const g = ctx.createGain();
    g.gain.value = 0;
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(sfxBus);
    o1.start(); o2.start();
    engine = { o1, o2, f, g };
  }
  const sf = Math.max(0, speedFrac);
  const gears = [0, 0.26, 0.5, 0.74, 1.0, 1.5];
  let gi = 0;
  while (gi < gears.length - 2 && sf > gears[gi + 1]) gi++;
  const rpm = (sf - gears[gi]) / (gears[gi + 1] - gears[gi]);
  const freq = 52 + rpm * 70 + gi * 10 + (boost ? 25 : 0);
  engine.o1.frequency.setTargetAtTime(freq, t, 0.03);
  engine.o2.frequency.setTargetAtTime(freq * 0.5, t, 0.03);
  engine.f.frequency.setTargetAtTime(380 + throttle * 900 + (boost ? 600 : 0), t, 0.05);
  engine.g.gain.setTargetAtTime(0.05 + throttle * 0.06, t, 0.05);
};

// ---------- music ----------
function chordTones(name) {
  const m = /^([A-G][#b]?)(m?)$/.exec(name);
  const root = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 }[m[1]];
  return { root, tones: m[2] ? [0, 3, 7] : [0, 4, 7] };
}

const SONGS = {
  title: {
    bpm: 120, drums: 'light',
    bars: [
      ['C', 'E5 - - - G5 - - - C6 - - - B5 - A5 -'],
      ['Am', 'A5 - - - E5 - - - C5 - D5 - E5 - - -'],
      ['F', 'F5 - - - A5 - - - C6 - - - A5 - F5 -'],
      ['G', 'G5 - - - - - D5 - G5 - - - B5 - - -'],
      ['C', 'C6 - - - B5 - C6 - D6 - - - C6 - G5 -'],
      ['Am', 'A5 - - - - - G5 - E5 - - - C5 - - -'],
      ['F', 'F5 - A5 - C6 - F6 - E6 - - - D6 - C6 -'],
      ['G', 'B5 - - - - - - - D6 - - - - - - -'],
    ],
  },
  raceA: {
    bpm: 152, drums: 'rock',
    bars: [
      ['Am', 'A4 - C5 - E5 - A5 - G5 - E5 - C5 - D5 -'],
      ['F', 'F5 - - - E5 - F5 - A5 - - - G5 - F5 -'],
      ['G', 'G5 - - - D5 - G5 - B5 - - - A5 - G5 -'],
      ['E', 'E5 - G#5 - B5 - E6 - D6 - B5 - G#5 - E5 -'],
      ['Am', 'A5 - - - E5 - A5 - C6 - B5 - A5 - E5 -'],
      ['F', 'F5 - A5 - C6 - A5 - F5 - - - E5 - D5 -'],
      ['G', 'D5 - G5 - B5 - D6 - C6 - B5 - G5 - - -'],
      ['E', 'E5 - - - G#5 - - - B5 - - - E6 - - -'],
    ],
  },
  raceB: {
    bpm: 160, drums: 'rock',
    bars: [
      ['Dm', 'D5 - F5 - A5 - - - G5 - F5 - E5 - F5 -'],
      ['C', 'E5 - - - C5 - E5 - G5 - - - F5 - E5 -'],
      ['Bb', 'D5 - F5 - Bb5 - - - A5 - G5 - F5 - G5 -'],
      ['C', 'E5 - - - - - G5 - C6 - - - - - - -'],
      ['Dm', 'A5 - - - D6 - - - C6 - A5 - F5 - A5 -'],
      ['C', 'G5 - - - E5 - G5 - C6 - - - G5 - E5 -'],
      ['Bb', 'F5 - D5 - F5 - Bb5 - A5 - F5 - D5 - F5 -'],
      ['A', 'E5 - - - C#5 - E5 - A5 - - - - - - -'],
    ],
  },
  raceC: {
    bpm: 168, drums: 'drive',
    bars: [
      ['Em', 'E5 - - B4 E5 - G5 - B5 - - - A5 G5 F#5 -'],
      ['C', 'G5 - - E5 G5 - C6 - B5 - - - A5 - G5 -'],
      ['D', 'F#5 - - D5 F#5 - A5 - D6 - - - C6 B5 A5 -'],
      ['B', 'B5 - - - D#6 - - - F#6 - - - D#6 - B5 -'],
      ['Em', 'E6 - D6 - B5 - G5 - E5 - G5 - B5 - E6 -'],
      ['C', 'C6 - B5 - G5 - E5 - C5 - E5 - G5 - C6 -'],
      ['D', 'D6 - C6 - A5 - F#5 - D5 - F#5 - A5 - D6 -'],
      ['B', 'D#6 - - - - - - - B5 - - - - - - -'],
    ],
  },
};
// pre-parse melodies
for (const k in SONGS) {
  SONGS[k].steps = [];
  SONGS[k].bars.forEach(([chord, mel]) => {
    const toks = mel.trim().split(/\s+/);
    if (toks.length !== 16) console.warn('bar length', k, toks.length);
    const ct = chordTones(chord);
    toks.forEach((tok, i) => {
      let len = 0;
      if (tok !== '-' && tok !== '.') {
        len = 1;
        while (i + len < toks.length && toks[i + len] === '-') len++;
      }
      SONGS[k].steps.push({ note: len ? N(tok) : 0, len, chord: ct, i });
    });
  });
}

let seq = null;
function schedule() {
  if (!seq || !ready()) return;
  const ctx = A.ctx;
  const song = SONGS[seq.name];
  const stepDur = 60 / song.bpm / 4;
  while (seq.next < ctx.currentTime + 0.15) {
    const st = song.steps[seq.pos % song.steps.length];
    const t = seq.next;
    if (st.note) osc('p25', st.note, 0, t, stepDur * st.len * 0.95, 0.11, musicBus, 0.004);
    const ch = st.chord;
    // bass: driving eighths on root / octave
    if (st.i % 2 === 0) {
      const bm = 33 + ch.root + ((st.i % 4 === 2) ? 12 : 0);
      osc('triangle', MIDI(bm), 0, t, stepDur * 1.8, 0.28, musicBus, 0.003);
    }
    // arpeggio
    const ar = ch.tones[[0, 1, 2, 1][st.i % 4]];
    osc('p12', MIDI(57 + ch.root + ar + (ch.root > 6 ? -12 : 0)), 0, t, stepDur * 0.9, 0.035, musicBus, 0.002);
    // drums
    const dr = song.drums;
    const kick = dr === 'light' ? (st.i === 0 || st.i === 8) : dr === 'drive' ? (st.i % 4 === 0) : (st.i === 0 || st.i === 8 || st.i === 10);
    const snare = st.i === 4 || st.i === 12;
    if (kick) osc('sine', 150, 40, t, 0.13, 0.5, musicBus, 0.002);
    if (snare && dr !== 'light') { noise(t, 0.12, 0.22, 'highpass', 1200, 0, musicBus); osc('triangle', 210, 140, t, 0.06, 0.12, musicBus); }
    if (st.i % 2 === 0 && dr !== 'light') noise(t, 0.035, st.i % 4 === 2 ? 0.12 : 0.06, 'highpass', 7000, 0, musicBus);
    if (dr === 'light' && st.i % 4 === 2) noise(t, 0.03, 0.05, 'highpass', 7000, 0, musicBus);
    seq.next += stepDur;
    seq.pos++;
  }
}
setInterval(schedule, 25);

A.music = function (name) {
  if (seq && seq.name === name) return;
  if (!A.ctx) { seq = { name, pos: 0, next: 0, pending: true }; return; }
  seq = { name, pos: 0, next: A.ctx.currentTime + 0.08 };
};
A.stopMusic = function () { seq = null; };
A.currentMusic = () => (seq ? seq.name : null);
// if music was requested before audio unlocked, start it now
A.resumePending = function () {
  if (seq && seq.pending && A.ctx) seq = { name: seq.name, pos: 0, next: A.ctx.currentTime + 0.08 };
};

const JINGLES = {
  win: [['C5', 1], ['E5', 1], ['G5', 1], ['C6', 3], ['G5', 1], ['C6', 4]],
  qualify: [['G5', 1], ['A5', 1], ['B5', 1], ['D6', 4]],
  lose: [['E5', 2], ['D#5', 2], ['D5', 2], ['C#5', 6]],
  gameover: [['G4', 3], ['E4', 3], ['C4', 3], ['G3', 6]],
  circuit: [['C5', 1], ['C5', 1], ['C5', 1], ['C5', 2], ['G#4', 2], ['A#4', 2], ['C5', 1], ['A#4', 1], ['C5', 6]],
};
A.jingle = function (name) {
  seq = null;
  if (!ready()) return;
  const t0 = A.ctx.currentTime + 0.05, u = 0.09;
  let t = t0;
  for (const [n, len] of JINGLES[name]) {
    osc('p25', N(n), 0, t, u * len * 0.95, 0.13, musicBus);
    osc('triangle', N(n) / 2, 0, t, u * len * 0.95, 0.2, musicBus);
    t += u * len;
  }
};

G.audio = A;
