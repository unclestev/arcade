import { G } from './ns.js';
import * as SIM from './sim.js';

const U = G.U;
const VW = G.CONFIG.VIEW_W, VH = G.CONFIG.VIEW_H;
const C = G.CONFIG;
const T = (ctx, s, x, y, o) => G.font.text(ctx, s, x, y, o);
const In = () => G.input;
const DARK = '#140e1a';
const S = {};
// Next Gen draws these screens with its own 3D backdrop and modern panels (ng/menus3d.js).
const NGUI = () => (G.board === 'nextgen' && G.NG && G.NG.ui) || null;
function frameDt(o) { const d = o._rt === undefined ? 0 : Math.min(0.1, G.time - o._rt); o._rt = G.time; return d; }
// 3D backdrop behind a Next Gen menu: the race (dimmed) when we came from one, else the showroom
function ngBackdrop(o, fromRace) {
  const dt = frameDt(o);
  if (fromRace && G.view && G.view.is3D) { G.view.stillFrame(); G.NG.setLook('paused'); } else G.NG.ui.showroom(G.settings.lastScheme || 0, dt, false);
}
function ngOrbit(o) {
  const dt = frameDt(o);
  if (G.view && G.view.is3D) { G.view.orbitFrame(dt); G.NG.setLook('soft'); } else G.NG.ui.showroom(G.settings.lastScheme || 0, dt, false);
}

// ---------- pointer hit regions ----------
G.ui = {
  hits: [],
  reset() { this.hits = []; },
  add(x, y, w, h, cb) { this.hits.push({ x, y, w, h, cb }); },
  click(x, y) {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (x >= h.x && y >= h.y && x < h.x + h.w && y < h.y + h.h) { h.cb(); return true; }
    }
    return false;
  },
};

// ---------- backdrop ----------
const bg = { layers: null, dust: [] };
function buildBackdrop() {
  const mk = (amp, base, seed, col, col2) => {
    const w = VW * 2;
    const c = U.makeCanvas(w, VH);
    const ctx = c.getContext('2d');
    for (let x = 0; x < w; x++) {
      const n = U.noise(x / 46 + seed, seed) * 0.65 + U.noise(x / 13, seed + 9) * 0.35;
      const n2 = U.noise(((x + w) % w) / 46 + seed, seed);
      const blend = x > w - 60 ? (x - (w - 60)) / 60 : 0;
      const v = n * (1 - blend) + (U.noise((x - w) / 46 + seed, seed) * 0.65 + U.noise((x - w) / 13, seed + 9) * 0.35) * blend;
      void n2;
      const top = Math.round(base - v * amp);
      ctx.fillStyle = col;
      ctx.fillRect(x, top, 1, VH - top);
      if (col2) { ctx.fillStyle = col2; ctx.fillRect(x, top, 1, 1); }
    }
    return c;
  };
  bg.layers = [mk(44, 132, 3.1, '#3a2858', '#5a3a78'), mk(28, 146, 7.7, '#241a3a', '#3a2a52')];
}

function backdrop(ctx, t, opts) {
  opts = opts || {};
  if (!bg.layers) buildBackdrop();
  const sky = ['#140e2e', '#2e1e52', '#6a2e6a', '#c8506a', '#f09a5a'];
  const horizon = 150;
  for (let y = 0; y < horizon; y++) {
    const f = (y / horizon) * (sky.length - 1);
    const i = Math.floor(f), fr = f - i;
    ctx.fillStyle = sky[Math.min(sky.length - 1, i + ((fr > 0.5 && (y % 2 === 0)) || fr > 0.75 ? 1 : 0))];
    ctx.fillRect(0, y, VW, 1);
  }
  // stars
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(U.hash2(i, 1) * VW), y = Math.floor(U.hash2(i, 2) * 60);
    if (U.hash2(i, Math.floor(t * 2)) > 0.15) { ctx.fillStyle = i % 3 ? '#8a7ab8' : '#ffffff'; ctx.fillRect(x, y, 1, 1); }
  }
  // striped sun
  const sx = 300, sy = 112, r = 26;
  for (let y = -r; y <= 0; y++) {
    if (y > -10 && (y % 4 === 0 || (y > -6 && y % 3 === 0))) continue;
    const span = Math.round(Math.sqrt(r * r - y * y));
    ctx.fillStyle = y < -18 ? '#ffe68a' : y < -8 ? '#ffc04a' : '#ff8a3a';
    ctx.fillRect(sx - span, sy + y, span * 2, 1);
  }
  // mountains
  const scroll = opts.still ? 0 : t;
  bg.layers.forEach((c, i) => {
    const off = Math.floor(scroll * (6 + i * 10)) % c.width;
    ctx.drawImage(c, -off, 0);
    ctx.drawImage(c, c.width - off, 0);
  });
  // ground + road
  ctx.fillStyle = '#2e4a2a';
  ctx.fillRect(0, horizon, VW, VH - horizon);
  for (let y = horizon; y < VH; y += 3) { ctx.fillStyle = '#365632'; ctx.fillRect(0, y, VW, 1); }
  const ry = 172, rh = 26;
  ctx.fillStyle = '#a5794a';
  ctx.fillRect(0, ry, VW, rh);
  ctx.fillStyle = '#8c6239';
  ctx.fillRect(0, ry + 8, VW, 1); ctx.fillRect(0, ry + 17, VW, 1);
  const curbOff = Math.floor(scroll * 90) % 16;
  for (let x = -16; x < VW + 16; x += 16) {
    ctx.fillStyle = '#c8402e'; ctx.fillRect(x - curbOff, ry - 3, 8, 3); ctx.fillRect(x - curbOff + 8, ry + rh, 8, 3);
    ctx.fillStyle = '#f2ece0'; ctx.fillRect(x - curbOff + 8, ry - 3, 8, 3); ctx.fillRect(x - curbOff, ry + rh, 8, 3);
  }
  if (opts.truck !== false) {
    const cyc = (t % 7) / 7;
    const tx = Math.round(-70 + cyc * (VW + 140));
    const scheme = opts.scheme || 0;
    const fr = G.SPR.truckFrames(scheme)[G.SPR.angleIndex(-Math.PI / 4)];
    const bounce = Math.floor(t * 10) % 2;
    if (Math.random() < 0.6) bg.dust.push({ x: tx - 34 + Math.random() * 6, y: ry + 16 + Math.random() * 6, life: 0.6 });
    ctx.globalAlpha = 0.3;
    const sh = G.SPR.shadow(22, 6);
    ctx.drawImage(sh, tx - 22, ry + 12);
    ctx.globalAlpha = 1;
    ctx.drawImage(fr.c, 0, 0, fr.w, fr.h, tx - fr.ax * 2, ry + 16 - fr.ay * 2 - bounce, fr.w * 2, fr.h * 2);
  }
  for (const d of bg.dust) { d.life -= 1 / 60; d.x -= 1.5; d.y -= 0.3; }
  bg.dust = bg.dust.filter((d) => d.life > 0);
  ctx.fillStyle = '#d8b07a';
  for (const d of bg.dust) ctx.fillRect(Math.round(d.x), Math.round(d.y), d.life > 0.3 ? 2 : 1, d.life > 0.3 ? 2 : 1);
}

// ---------- logo ----------
let logoCanvas = null;
function logo() {
  if (logoCanvas) return logoCanvas;
  const lines = C.TITLE_LINES;
  const sc = 4;
  const w = Math.max(...lines.map((l) => G.font.measure(l, sc))) + 12;
  const h = lines.length * (7 * sc + 6) + 8;
  const mask = U.makeCanvas(w, h);
  const m = mask.getContext('2d');
  lines.forEach((l, i) => T(m, l, w / 2, 4 + i * (7 * sc + 6), { color: '#ffffff', scale: sc, align: 'center' }));
  const out = U.makeCanvas(w, h);
  const o = out.getContext('2d');
  const md = m.getImageData(0, 0, w, h).data;
  const img = o.createImageData(w, h);
  const grad = ['#fff6b0', '#ffe060', '#ffc040', '#ff9a30', '#f06a28', '#d84a28'].map(U.hex);
  const put = (x, y, rgb) => { const k = (y * w + x) * 4; img.data[k] = rgb[0]; img.data[k + 1] = rgb[1]; img.data[k + 2] = rgb[2]; img.data[k + 3] = 255; };
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && md[(y * w + x) * 4 + 3] > 0;
  // shadow + outline
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (on(x - 3, y - 3) || on(x - 2, y - 3) || on(x - 3, y - 2)) put(x, y, [90, 26, 58]);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (on(x + dx, y + dy)) { put(x, y, [20, 14, 26]); dy = 3; break; }
  }
  lines.forEach((l, i) => {
    const y0 = 4 + i * (7 * sc + 6);
    for (let y = y0; y < y0 + 7 * sc; y++) for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue;
      const f = (y - y0) / (7 * sc);
      let rgb = grad[Math.min(grad.length - 1, Math.floor(f * grad.length))];
      if ((y - y0) % sc === 0 && f < 0.5) rgb = U.mix(rgb, [255, 255, 255], 0.35);
      put(x, y, rgb);
    }
  });
  o.putImageData(img, 0, 0);
  logoCanvas = out;
  return out;
}

// ---------- menu component ----------
function menuDraw(ctx, st, items, x, y, opts) {
  opts = opts || {};
  const lh = opts.lh || 12;
  const w = opts.w || 200;
  if (opts.panel !== false) G.hud.panel(ctx, x - w / 2 - 6, y - 5, w + 12, items.length * lh + 8);
  items.forEach((it, i) => {
    const sel = i === st.sel;
    const yy = y + i * lh;
    let label = it.label;
    const val = it.value ? it.value() : null;
    const col = it.disabled ? '#6a6278' : sel ? '#ffe060' : '#e8e0f0';
    if (val !== null) {
      T(ctx, label, x - w / 2 + 6, yy, { color: col });
      const vs = sel ? '< ' + val + ' >' : val;
      T(ctx, vs, x + w / 2 - 6, yy, { color: sel ? '#ffffff' : '#a8a0b8', align: 'right' });
    } else {
      T(ctx, label, x, yy, { color: col, align: 'center' });
    }
    if (sel && Math.floor(G.time * 4) % 2 === 0) T(ctx, '>', x - w / 2 - 2, yy, { color: '#ffe060' });
    G.ui.add(x - w / 2 - 6, yy - 3, w + 12, lh, () => {
      if (st.sel !== i) { st.sel = i; G.audio.sfx('blip'); }
      if (it.change) it.change(1);
      else if (it.action && !it.disabled) { G.audio.sfx('select'); it.action(); }
    });
  });
}
function menuInput(st, items, onBack) {
  const I = In();
  const n = items.length;
  const move = (d) => {
    let k = st.sel;
    for (let i = 0; i < n; i++) { k = (k + d + n) % n; if (!items[k].skip) break; }
    st.sel = k;
    G.audio.sfx('blip');
  };
  if (I.pressed('up')) move(-1);
  if (I.pressed('down')) move(1);
  const it = items[st.sel];
  if (I.pressed('left') || I.pressed('right')) {
    const d = I.pressed('left') ? -1 : 1;
    if (it.change) { it.change(d); G.audio.sfx('blip'); } else move(d);
  }
  if ((I.pressed('confirm') || I.pressed('start')) && it.action && !it.disabled) { G.audio.sfx('select'); it.action(); return; }
  if ((I.pressed('confirm') || I.pressed('start')) && it.change) { it.change(1); G.audio.sfx('blip'); }
  if (I.pressed('back') && onBack) { G.audio.sfx('back'); onBack(); }
}

// small fullscreen toggle drawn in the corner of menu screens
function fsIcon(ctx) {
  const x = VW - 15, y = VH - 15;
  ctx.fillStyle = 'rgba(14,10,22,0.7)';
  ctx.fillRect(x - 2, y - 2, 13, 13);
  ctx.fillStyle = '#a8a0b8';
  [[0, 0, 4, 1], [0, 0, 1, 4], [5, 0, 4, 1], [8, 0, 1, 4], [0, 8, 4, 1], [0, 5, 1, 4], [5, 8, 4, 1], [8, 5, 1, 4]].forEach(([a, b, w, h]) => ctx.fillRect(x + a, y + b, w, h));
  G.ui.add(x - 6, y - 6, 21, 21, () => G.toggleFullscreen());
}

const deviceHint = (kb, touch, wheel, pad) => {
  const d = In().device;
  return d === 'touch' ? touch : d === 'wheel' ? wheel : d === 'pad' ? pad : kb;
};
// ======================= TITLE =======================
// Next Gen needs the 3D module; it loads on first pick (a moment on a slow connection).
function startEdition(board) {
  G.setBoard(board);
  if (board !== 'nextgen') { G.go('select'); return; }
  if (S.title.loading) return;
  S.title.loading = true;
  G.loadNextGen().then(() => {
    S.title.loading = false;
    if (G.currentScreen() === 'title') G.go('select');
  }, (err) => {
    S.title.loading = false;
    console.error('Next Gen failed to start:', err);
    G.toast(err && err.webgl === false ? 'NEXT GEN NEEDS WEBGL' : 'NEXT GEN COULD NOT LOAD');
    G.setBoard('classic');
  });
}
S.title = {
  enter() {
    this.sel = G.board === 'nextgen' ? 1 : 0; this.t = 0; this.idle = 0; this.loading = false;
    G.audio.music('title');
    G.showOver(false);
  },
  items() {
    const list = [
      { label: 'CLASSIC', action: () => startEdition('classic'), board: 'classic' },
      { label: 'NEXT GEN', action: () => startEdition('nextgen'), board: 'nextgen' },
      { label: 'LEADERBOARD', action: () => G.openBoard() },
      { label: 'OPTIONS', action: () => G.go('options', { back: 'title' }) },
    ];
    if (In().wheel) list.push({ label: 'WHEEL SETUP', action: () => G.go('wheel', { back: 'title' }) });
    return list;
  },
  update(dt) {
    this.t += dt; this.idle += dt;
    const I = In();
    if (G.modalOpen() || this.loading) { this.idle = 0; return; }
    if (I.pressed('start') && !I.pressed('confirm')) { startEdition(G.board); return; }
    const items = this.items();
    if (this.sel >= items.length) this.sel = 0;
    const before = this.sel;
    menuInput(this, items, null);
    // highlighting an edition picks it, so the leaderboard and hi score follow
    if (items[this.sel] && items[this.sel].board) G.setBoard(items[this.sel].board);
    if (before !== this.sel || I.anyPressed()) this.idle = 0;
    if (this.idle > 20) G.go('demo');
  },
  render(ctx) {
    backdrop(ctx, this.t, { scheme: G.settings.lastScheme || 0 });
    const lg = logo();
    const bob = Math.round(Math.sin(this.t * 2) * 1.5);
    ctx.drawImage(lg, Math.round(VW / 2 - lg.width / 2), 14 + bob);
    const ng = G.board === 'nextgen';
    T(ctx, (ng ? 'NEXT GEN' : 'CLASSIC') + ' EDITION', VW / 2, 14 + lg.height + 2, { color: ng ? '#ff9a30' : '#7cf0e0', align: 'center', outline: DARK });
    T(ctx, 'HI ' + U.pad(G.hiScore, 7), VW / 2, 3, { color: '#ffffff', align: 'center', shadow: DARK });
    menuDraw(ctx, this, this.items(), VW / 2, 109, { w: 120 });
    if (this.loading) {
      T(ctx, 'LOADING 3D...', VW / 2, VH - 12, { color: '#ff9a30', align: 'center', outline: DARK });
    } else if (Math.floor(this.t * 2) % 2 === 0) {
      T(ctx, deviceHint('PRESS ENTER', 'TAP AN EDITION', 'PRESS GAS OR X', 'PRESS START'), VW / 2, VH - 12, { color: '#ffe060', align: 'center', outline: DARK });
    }
    if (In().wheel && !In().wheel.calibrated) T(ctx, 'WHEEL FOUND', 4, 3, { color: '#7cf0e0', shadow: DARK });
    fsIcon(ctx);
  },
};

// ======================= DEMO =======================
S.demo = {
  enter() {
    this.t = 0;
    this.demo = G.makeDemo();
    G.audio.stopMusic();
  },
  update(dt) {
    this.t += dt;
    this.demo.update(dt);
    const I = In();
    if (I.anyPressed() || I.pressed('confirm')) { G.go('title'); return; }
    if (this.t > 32 || this.demo.game.state !== 'race') G.go('title');
  },
  render(ctx) {
    this.demo.view.render(ctx);
    G.hud.draw(ctx, this.demo.view, this.demo.game, { prompt: 'PRESS START' });
    G.ui.add(0, 0, VW, VH, () => G.go('title'));
  },
};

// ======================= TRUCK SELECT =======================
S.select = {
  enter() { this.t = 0; this.sel = G.settings.lastScheme || 0; this.done = false; G.audio.music('title'); G.newRun(); },
  pick() {
    if (this.done) return;
    this.done = true;
    G.settings.lastScheme = this.sel;
    G.saveSettings();
    G.audio.sfx('select');
    G.beginGame(this.sel);
    G.go('loading');
  },
  update(dt) {
    this.t += dt;
    const I = In();
    const mv = (d) => { this.sel = (this.sel + d + 8) % 8; G.audio.sfx('blip'); };
    if (I.pressed('left')) mv(-1);
    if (I.pressed('right')) mv(1);
    if (I.pressed('up') || I.pressed('down')) mv(4);
    if (I.pressed('confirm') || I.pressed('start') || I.pressed('fire')) this.pick();
    if (this.t > 20) this.pick();
  },
  render(ctx) {
    const ng = NGUI();
    if (ng) { ctx.clearRect(0, 0, VW, VH); ng.select(this, frameDt(this)); return; }
    backdrop(ctx, this.t, { truck: false, still: true });
    G.hud.panel(ctx, 14, 8, VW - 28, VH - 16);
    T(ctx, 'CHOOSE YOUR TRUCK', VW / 2, 14, { color: '#ffe060', scale: 2, align: 'center', outline: DARK });
    T(ctx, String(Math.max(0, Math.ceil(20 - this.t))), VW - 24, 14, { color: '#ffffff', scale: 2, align: 'right' });
    for (let i = 0; i < 8; i++) {
      const col = i % 4, row = Math.floor(i / 4);
      const cx = 60 + col * 88, cy = 72 + row * 70;
      const sel = i === this.sel;
      if (sel) {
        ctx.fillStyle = Math.floor(this.t * 6) % 2 ? '#ffe060' : '#ff9a30';
        ctx.fillRect(cx - 38, cy - 34, 76, 1); ctx.fillRect(cx - 38, cy + 26, 76, 1);
        ctx.fillRect(cx - 38, cy - 34, 1, 61); ctx.fillRect(cx + 37, cy - 34, 1, 61);
      }
      const a = sel ? this.t * 2.2 : Math.PI * 0.75;
      const fr = G.SPR.truckFrames(i)[G.SPR.angleIndex(a)];
      ctx.globalAlpha = 0.35;
      const sh = G.SPR.shadow(22, 10);
      ctx.drawImage(sh, cx - 22, cy - 2);
      ctx.globalAlpha = 1;
      ctx.drawImage(fr.c, 0, 0, fr.w, fr.h, cx - fr.ax * 2, cy + 6 - fr.ay * 2, fr.w * 2, fr.h * 2);
      T(ctx, G.SPR.SCHEMES[i].name, cx, cy + 16, { color: sel ? '#ffffff' : '#a8a0b8', align: 'center' });
      G.ui.add(cx - 38, cy - 34, 76, 61, () => { if (this.sel === i) this.pick(); else { this.sel = i; G.audio.sfx('blip'); } });
    }
    T(ctx, deviceHint('ARROWS TO CHOOSE - ENTER TO RACE', 'TAP A TRUCK TWICE TO RACE', 'STEER TO CHOOSE - GAS TO RACE', 'D-PAD TO CHOOSE - A TO RACE'), VW / 2, VH - 20, { color: '#a8a0b8', align: 'center' });
  },
};


// ======================= LOADING (race card) =======================
S.loading = {
  enter() { this.frames = 0; this.t = 0; G.audio.stopMusic(); },
  update(dt) {
    this.t += dt;
    this.frames++;
    if (this.frames === 3) { G.beginRace(); this.waitT = 0; }
    // Next Gen: hold the race card while the 3D shaders finish compiling (at most a few seconds)
    if (this.frames >= 3) {
      this.waitT += dt;
      if (!(G.view && G.view.warming) || this.waitT > 6) G.go('race');
    }
  },
  render(ctx) {
    const g = G.game;
    const ng = NGUI();
    if (ng) { ctx.clearRect(0, 0, VW, VH); ng.card(g); return; }
    const def = SIM.TRACKS[g.raceNo % SIM.TRACKS.length];
    ctx.fillStyle = '#140e2e';
    ctx.fillRect(0, 0, VW, VH);
    const sky = G.THEMES[def.theme].sky;
    sky.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(0, 60 + i * 6, VW, 6); });
    T(ctx, 'RACE ' + (g.raceNo + 1), VW / 2, 30, { color: '#a8a0b8', scale: 2, align: 'center' });
    T(ctx, def.name, VW / 2, 98, { color: '#ffe060', scale: 3, align: 'center', outline: DARK });
    T(ctx, 'FINISH IN THE TOP 3 TO ADVANCE', VW / 2, 140, { color: '#ffffff', align: 'center' });
    T(ctx, 'TRUCKS x' + g.lives + '    CIRCUIT ' + (Math.floor(g.raceNo / SIM.TRACKS.length) + 1), VW / 2, 156, { color: '#7cf0e0', align: 'center' });
    T(ctx, G.rankedLabel(), VW / 2, 176, { color: '#a8a0b8', align: 'center' });
  },
};

// ======================= RACE =======================
S.race = {
  enter() { this.paused = false; this.psel = 0; },
  pauseItems() {
    return [
      { label: 'RESUME', action: () => { this.paused = false; } },
      { label: 'OPTIONS', action: () => G.go('options', { back: 'race' }) },
      { label: 'QUIT TO TITLE', action: () => { G.audio.engine(0, 0, false, false); G.input.raceMode = false; G.quitGame(); } },
    ];
  },
  sel() { return { get sel() { return S.race.psel; }, set sel(v) { S.race.psel = v; } }; },
  pause() {
    this.paused = true;
    this.psel = 0;
    G.audio.engine(0, 0, false, false);
    G.audio.sfx('back');
    In().clearPressed();
  },
  update(dt) {
    const I = In();
    const v = G.view;
    if (G.modalOpen() && !this.paused) this.pause();
    if (this.paused) {
      if (G.modalOpen()) return;
      menuInput(this.sel(), this.pauseItems(), () => { this.paused = false; });
      if (I.pressed('pause') && !I.pressed('back') && !I.pressed('confirm')) this.paused = false;
      return;
    }
    if (I.pressed('pause') && v.R.phase !== 'finish') { this.pause(); return; }
    G.tickGame(dt);
    v.update(dt);
    if (G.game.state !== 'race') G.go('results');
  },
  render(ctx) {
    const v = G.view;
    v.render(ctx);
    if (!v.is3D) G.hud.draw(ctx, v, G.game);
    const ng = v.is3D && NGUI();
    if (ng) { if (this.paused) ng.pause(this.sel(), this.pauseItems()); else ng.leave(); return; }
    if (this.paused) {
      ctx.fillStyle = 'rgba(10,6,18,0.6)';
      ctx.fillRect(0, 0, VW, VH);
      T(ctx, 'PAUSED', VW / 2, 50, { color: '#ffe060', scale: 3, align: 'center', outline: DARK });
      menuDraw(ctx, this.sel(), this.pauseItems(), VW / 2, 96, { w: 130 });
      const u = G.game.upgrades;
      T(ctx, 'ENGINE ' + u.engine + '/5   TIRES ' + u.tires + '/5   TURBO ' + u.turbo + '/5', VW / 2, 150, { color: '#a8a0b8', align: 'center' });
    }
  },
};

// ======================= RESULTS =======================
S.results = {
  enter() {
    const g = G.game, L = g.last;
    this.view = G.view;
    this.race = g.race;
    this.t = 0;
    this.done = false;
    this.place = L.place;
    this.qualified = L.qualified;
    this.placePts = L.placePts;
    this.racePts = L.raceScore;
    this.to = g.score;
    this.from = g.score - L.placePts - L.raceScore - (L.circuit ? SIM.POINTS.circuit : 0);
    this.standings = g.race.standings();
    G.audio.engine(0, 0, false, false);
    G.input.raceMode = false;
    this.tick = 0;
  },
  next() {
    if (this.done) return;
    this.done = true;
    const g = G.game;
    if (g.state === 'over') G.go('over');
    else if (g.last.circuit) G.go('circuit');
    else G.go('loading');
  },
  update(dt) {
    this.t += dt;
    const I = In();
    if (this.t > 0.6 && this.t < 2.2) {
      this.tick += dt;
      if (this.tick > 0.06) { this.tick = 0; G.audio.sfx('blip'); }
    }
    if (this.t > 2.2 && (I.pressed('confirm') || I.pressed('start') || I.pressed('fire'))) this.next();
    if (this.t > 12) this.next();
  },
  render(ctx) {
    const g = G.game, r = this.race, v = this.view;
    const ng = v.is3D && NGUI();
    if (ng) { ctx.clearRect(0, 0, VW, VH); ngOrbit(this); ng.results(this); return; }
    backdrop(ctx, this.t, { truck: false, still: true });
    G.hud.panel(ctx, 20, 8, VW - 40, VH - 16);
    T(ctx, 'RACE RESULTS', VW / 2, 14, { color: '#ffe060', scale: 2, align: 'center', outline: DARK });
    T(ctx, r.def.name, VW / 2, 32, { color: '#a8a0b8', align: 'center' });
    this.standings.forEach((c, i) => {
      const y = 48 + i * 18;
      const me = c === r.player;
      const name = v.names[c.slot];
      const col = me ? '#ffffff' : '#c8c0d8';
      T(ctx, U.ordinal(i + 1), 46, y, { color: G.hud.PLACE_COL[i], scale: 1 });
      const fr = v.frames[c.slot][G.SPR.angleIndex(Math.PI * 0.75)];
      ctx.drawImage(fr.c, 84 - fr.ax, y + 10 - fr.ay);
      T(ctx, name, 104, y, { color: me ? '#ffe060' : col });
      T(ctx, c.finished && isFinite(c.finishTime) ? U.fmtTime(c.finishTime) : '--:--.-', 220, y, { color: col, align: 'right' });
      if (me && isFinite(c.bestLap)) T(ctx, 'BEST ' + U.fmtTime(c.bestLap), 330, y, { color: '#7cf0e0', align: 'right' });
    });
    const f = U.clamp((this.t - 0.6) / 1.6, 0, 1);
    const shown = Math.round(this.from + (this.to - this.from) * f);
    T(ctx, 'PLACE BONUS', 60, 128, { color: '#a8a0b8' });
    T(ctx, '+' + this.placePts, 320, 128, { color: '#ffffff', align: 'right' });
    T(ctx, 'PICKUPS + HITS', 60, 140, { color: '#a8a0b8' });
    T(ctx, '+' + this.racePts, 320, 140, { color: '#ffffff', align: 'right' });
    T(ctx, 'SCORE', 60, 154, { color: '#ffe060' });
    T(ctx, U.pad(shown, 7), 320, 154, { color: '#ffe060', align: 'right' });
    const word = SIM.LETTER_WORD;
    for (let i = 0; i < word.length; i++) T(ctx, word[i], 140 + i * 9, 166, { color: i < g.letters ? '#ffd84a' : '#4a4258' });
    if (this.t > 1.2) {
      const msg = this.qualified ? (this.place === 1 ? 'YOU WIN!' : 'QUALIFIED!') : (g.lives > 0 ? 'TRUCK LOST! ' + g.lives + ' LEFT' : 'NO TRUCKS LEFT');
      if (Math.floor(this.t * 3) % 2 === 0 || this.t < 2) T(ctx, msg, VW / 2, 180, { color: this.qualified ? '#7cf07c' : '#ff5a4a', scale: 2, align: 'center', outline: DARK });
    }
    if (this.t > 2.2) {
      T(ctx, deviceHint('PRESS ENTER', 'TAP TO CONTINUE', 'PRESS GAS', 'PRESS A'), VW / 2, VH - 18, { color: '#a8a0b8', align: 'center' });
      G.ui.add(0, 0, VW, VH, () => this.next());
    }
  },
};

// ======================= CIRCUIT COMPLETE =======================
S.circuit = {
  enter() {
    this.t = 0;
    G.audio.jingle('circuit');
  },
  update(dt) {
    this.t += dt;
    const I = In();
    if ((this.t > 2 && (I.pressed('confirm') || I.pressed('start'))) || this.t > 8) G.go('loading');
  },
  render(ctx) {
    const ng = NGUI();
    if (ng) { ctx.clearRect(0, 0, VW, VH); ngOrbit(this); ng.circuit(this); return; }
    backdrop(ctx, this.t, { scheme: G.game.scheme });
    const n = Math.floor((G.game.raceNo - 1) / SIM.TRACKS.length) + 1;
    T(ctx, 'CIRCUIT ' + n, VW / 2, 40, { color: '#ffffff', scale: 3, align: 'center', outline: DARK });
    T(ctx, 'COMPLETE!', VW / 2, 70, { color: '#ffe060', scale: 3, align: 'center', outline: DARK });
    T(ctx, 'BONUS +' + SIM.POINTS.circuit, VW / 2, 104, { color: '#7cf07c', scale: 2, align: 'center', outline: DARK });
    T(ctx, 'THE RIVALS GET FASTER...', VW / 2, 130, { color: '#ffffff', align: 'center', outline: DARK });
    G.ui.add(0, 0, VW, VH, () => { if (this.t > 2) G.go('loading'); });
  },
};

// ======================= GAME OVER =======================
// The canvas shows the headline; the DOM panel over it (G.showOver) holds the score and the kit's
// post-to-leaderboard controls, which need real text inputs.
S.over = {
  enter() {
    this.t = 0;
    G.audio.jingle('gameover');
    G.showOver(true);
  },
  update(dt) { this.t += dt; },
  render(ctx) {
    const ng = NGUI();
    if (ng) { ctx.clearRect(0, 0, VW, VH); ngOrbit(this); ng.over(); return; }
    ctx.fillStyle = '#0a0612';
    ctx.fillRect(0, 0, VW, VH);
    const a = Math.min(1, this.t * 2);
    T(ctx, 'GAME OVER', VW / 2, 24 - (1 - a) * 20, { color: '#ff5a4a', scale: 3, align: 'center', outline: DARK });
  },
};

// ======================= OPTIONS =======================
const cycle = (list, cur, d) => list[(list.indexOf(cur) + d + list.length) % list.length];
S.options = {
  enter(arg) { this.arg = arg || { back: 'title' }; this.sel = 0; this.t = 0; },
  back() {
    G.saveSettings();
    if (this.arg.back === 'race') { G.go('race'); S.race.paused = true; } else G.go('title');
  },
  items() {
    const st = G.settings;
    const onoff = (k, apply) => ({ value: () => (st[k] ? 'ON' : 'OFF'), change: () => { st[k] = !st[k]; if (apply) apply(st[k]); G.saveSettings(); } });
    return [
      Object.assign({ label: 'MUSIC' }, onoff('music', (v) => G.audio.setMusic(v))),
      Object.assign({ label: 'SOUND FX' }, onoff('sfx', (v) => G.audio.setSfx(v))),
      Object.assign({ label: 'TOUCH AUTO-GAS' }, onoff('autoGas')),
      { label: 'STEERING', value: () => (st.steerFeel || 'smooth').toUpperCase(), change: (d) => { st.steerFeel = cycle(In().STEER_FEELS, st.steerFeel || 'smooth', d); G.saveSettings(); } },
      { label: '3D CAMERA', value: () => (st.ngCam || 'high').toUpperCase(), change: (d) => { st.ngCam = cycle(['high', 'medium', 'low'], st.ngCam || 'high', d); G.saveSettings(); } },
      Object.assign({ label: 'WHEEL ROTATION' }, { value: () => st.wheelLock + ' DEG', change: (d) => { st.wheelLock = cycle([180, 270, 360, 540, 900], st.wheelLock, d); G.saveSettings(); } }),
      { label: 'WHEEL SETUP', action: () => G.go('wheel', { back: 'options', arg: this.arg }) },
      { label: 'CONTROLS', action: () => G.go('controls', { arg: this.arg }) },
      { label: 'FULLSCREEN', action: () => G.toggleFullscreen() },
      { label: 'BACK', action: () => this.back() },
    ];
  },
  update(dt) {
    this.t += dt;
    menuInput(this, this.items(), () => this.back());
  },
  render(ctx) {
    const I = In();
    const w = I.wheel ? 'WHEEL: ' + (I.wheel.calibrated ? 'SET UP' : 'NOT SET UP') : I.gamepadBlocked ? 'WHEEL/GAMEPAD: BLOCKED IN THIS VIEW' : 'WHEEL: NOT CONNECTED';
    const ng = NGUI();
    if (ng) { ctx.clearRect(0, 0, VW, VH); ngBackdrop(this, this.arg.back === 'race'); ng.options(this, this.items(), w); return; }
    backdrop(ctx, this.t, { truck: false, still: true });
    T(ctx, 'OPTIONS', VW / 2, 8, { color: '#ffe060', scale: 2, align: 'center', outline: DARK });
    menuDraw(ctx, this, this.items(), VW / 2, 44, { w: 250, lh: 15 });
  },
};

// ======================= CONTROLS =======================
const PAGES = [
  ['KEYBOARD', [['STEER', 'LEFT/RIGHT OR A/D - HOLD TO TURN MORE'], ['GAS', 'UP OR W'], ['BRAKE/REVERSE', 'DOWN OR S'], ['MISSILE', 'SPACE, J OR Z'], ['BOMB', 'K OR X'], ['NITRO', 'L, C OR SHIFT'], ['PAUSE', 'ESC OR P'], ['START', 'ENTER OR 1'], ['FULLSCREEN', 'F'], ['MUSIC ON/OFF', 'M']]],
  ['LOGITECH G29', [['STEER', 'WHEEL'], ['GAS / BRAKE', 'PEDALS'], ['MISSILE', 'X OR RIGHT PADDLE'], ['BOMB', 'CIRCLE OR LEFT PADDLE'], ['NITRO', 'SQUARE, TRIANGLE OR R2'], ['PAUSE / START', 'OPTIONS'], ['MENUS', 'TURN WHEEL / D-PAD'], ['SELECT / BACK', 'GAS / BRAKE PEDAL'], ['', 'RUN WHEEL SETUP TO REMAP']]],
  ['GAMEPAD', [['STEER', 'LEFT STICK OR D-PAD (HOLD)'], ['GAS', 'RT OR A'], ['BRAKE', 'LT OR X'], ['MISSILE', 'B'], ['BOMB', 'Y'], ['NITRO', 'LB OR RB'], ['PAUSE', 'START']]],
  ['TOUCH', [['STEER', 'STICK: SIDE = FULL, UP/DOWN = LESS'], ['GAS', 'AUTO (OR GAS BUTTON)'], ['BRAKE', 'BRAKE BUTTON'], ['MISSILE', 'MISSILE BUTTON'], ['BOMB', 'BOMB BUTTON'], ['NITRO', 'NITRO BUTTON'], ['PAUSE', 'II BUTTON (TOP)'], ['MENUS', 'TAP ITEMS']]],
];
S.controls = {
  enter(arg) { this.arg = arg || {}; this.page = { touch: 3, wheel: 1, pad: 2 }[In().device] || 0; this.t = 0; },
  update(dt) {
    this.t += dt;
    const I = In();
    if (I.pressed('left')) { this.page = (this.page + PAGES.length - 1) % PAGES.length; G.audio.sfx('blip'); }
    if (I.pressed('right')) { this.page = (this.page + 1) % PAGES.length; G.audio.sfx('blip'); }
    if (I.pressed('back') || I.pressed('confirm')) G.go('options', this.arg.arg);
  },
  render(ctx) {
    const ng = NGUI();
    if (ng) {
      ctx.clearRect(0, 0, VW, VH);
      ngBackdrop(this, !!(this.arg.arg && this.arg.arg.back === 'race'));
      const step = (d) => { this.page = (this.page + PAGES.length + d) % PAGES.length; G.audio.sfx('blip'); };
      ng.controls(this, PAGES, () => step(-1), () => step(1), () => G.go('options', this.arg.arg));
      return;
    }
    backdrop(ctx, this.t, { truck: false, still: true });
    G.hud.panel(ctx, 12, 6, VW - 24, VH - 12);
    const [title, rows] = PAGES[this.page];
    T(ctx, '< ' + title + ' >', VW / 2, 12, { color: '#ffe060', scale: 2, align: 'center', outline: DARK });
    rows.forEach(([a, b], i) => {
      T(ctx, a, 40, 40 + i * 13, { color: '#a8a0b8' });
      T(ctx, b, VW - 40, 40 + i * 13, { color: '#ffffff', align: 'right' });
    });
    T(ctx, (this.page + 1) + '/' + PAGES.length, VW / 2, VH - 16, { color: '#6a6278', align: 'center' });
    G.ui.add(0, 0, VW / 3, VH, () => { this.page = (this.page + PAGES.length - 1) % PAGES.length; });
    G.ui.add(VW * 2 / 3, 0, VW / 3, VH, () => { this.page = (this.page + 1) % PAGES.length; });
    G.ui.add(VW / 3, 0, VW / 3, VH, () => G.go('options', this.arg.arg));
  },
};

// ======================= WHEEL SETUP =======================
const STEPS = [
  { key: 'center', text: ['CENTER THE WHEEL AND LET GO', 'OF THE PEDALS. THEN PRESS', 'ANY BUTTON ON THE WHEEL.'] },
  { key: 'steer', text: ['TURN THE WHEEL FULLY LEFT,', 'THEN FULLY RIGHT, THEN', 'BACK TO CENTER.'] },
  { key: 'gas', text: ['PRESS THE GAS PEDAL ALL', 'THE WAY DOWN, THEN', 'RELEASE IT.'] },
  { key: 'brake', text: ['PRESS THE BRAKE PEDAL ALL', 'THE WAY DOWN, THEN', 'RELEASE IT.'] },
  { key: 'btn:fire', text: ['PRESS THE BUTTON FOR', 'MISSILE'] },
  { key: 'btn:bomb', text: ['PRESS THE BUTTON FOR', 'BOMB'] },
  { key: 'btn:boost', text: ['PRESS THE BUTTON FOR', 'NITRO'] },
  { key: 'btn:pause', text: ['PRESS THE BUTTON FOR', 'PAUSE / START'] },
  { key: 'test', text: ['ALL SET. TRY IT OUT.'] },
];
S.wheel = {
  enter(arg) {
    this.arg = arg || { back: 'title' };
    this.t = 0;
    this.step = 0;
    this.pad = null;
    this.prof = null;
    this.reset();
  },
  reset() { this.stT = 0; this.track = null; this.stable = 0; this.prevBtn = null; this.lastVal = null; },
  leave() {
    if (this.arg.back === 'options') G.go('options', this.arg.arg);
    else G.go('title');
  },
  findPad() {
    const pads = In().rawPads();
    return pads.find((p) => In().isWheelId(p.id)) || pads.find((p) => p.axes.length >= 3) || pads[0] || null;
  },
  next() {
    this.step++;
    this.reset();
    G.audio.sfx('select');
  },
  update(dt) {
    this.t += dt;
    this.stT += dt;
    const I = In();
    if (I.pressed('back') && !(this.pad && this.step >= 3)) { G.audio.sfx('back'); this.leave(); return; }
    const step = STEPS[this.step];
    const pads = I.rawPads();
    const pad = this.pad ? pads.find((p) => p.index === this.pad.index) : null;
    if (step.key === 'center') {
      const cand = this.findPad();
      if (cand && cand.buttons.some((b) => b.pressed) && this.stT > 0.3) {
        this.pad = { index: cand.index, id: cand.id };
        this.base = cand.axes.slice();
        this.prof = { steerAxis: 0, steerMin: -1, steerMax: 1, steerCenter: 0, gasAxis: -1, gasRest: 1, gasFull: -1, brakeAxis: -1, brakeRest: 1, brakeFull: -1, buttons: { fire: [], bomb: [], boost: [], pause: [], coin: [8], confirm: [], back: [] } };
        this.prevBtn = cand.buttons.map((b) => b.pressed);
        this.next();
      }
      return;
    }
    if (!pad) { if (this.stT > 1) { G.toast('WHEEL DISCONNECTED'); this.leave(); } return; }
    const axes = pad.axes;
    const usedAxes = [this.prof.steerAxis, this.prof.gasAxis, this.prof.brakeAxis];
    const axisStep = (exclude, minRange, done) => {
      if (!this.track) {
        let best = -1, bd = 0.35;
        axes.forEach((v, i) => {
          if (exclude.includes(i) || i >= 9 && Math.abs(v) > 1.01) return;
          const d = Math.abs(v - this.base[i]);
          if (d > bd) { bd = d; best = i; }
        });
        if (best >= 0) this.track = { axis: best, lo: axes[best], hi: axes[best], first: null, rest: this.base[best] };
        return;
      }
      const tr = this.track;
      const v = axes[tr.axis];
      tr.lo = Math.min(tr.lo, v);
      tr.hi = Math.max(tr.hi, v);
      if (tr.first === null && Math.abs(v - tr.rest) > 0.5) tr.first = v;
      if (this.lastVal !== null && Math.abs(v - this.lastVal) < 0.01) this.stable += 1 / 60; else this.stable = 0;
      this.lastVal = v;
      if (tr.hi - tr.lo >= minRange && this.stable > 0.5) done(tr, v);
    };
    if (step.key === 'steer') {
      axisStep([], 1.0, (tr, v) => {
        if (Math.abs(v - (tr.lo + tr.hi) / 2) > (tr.hi - tr.lo) * 0.3) return; // wait for center
        const leftIsLow = tr.first !== null ? tr.first < (tr.lo + tr.hi) / 2 : true;
        Object.assign(this.prof, { steerAxis: tr.axis, steerMin: leftIsLow ? tr.lo : tr.hi, steerMax: leftIsLow ? tr.hi : tr.lo, steerCenter: v });
        this.next();
      });
    } else if (step.key === 'gas' || step.key === 'brake') {
      axisStep(usedAxes.filter((a) => a >= 0), 0.6, (tr, v) => {
        const rest = v;
        if (Math.abs(rest - tr.lo) > 0.25 && Math.abs(rest - tr.hi) > 0.25) return; // still pressed
        const full = Math.abs(tr.hi - rest) > Math.abs(tr.lo - rest) ? tr.hi : tr.lo;
        if (step.key === 'gas') Object.assign(this.prof, { gasAxis: tr.axis, gasRest: rest, gasFull: full });
        else Object.assign(this.prof, { brakeAxis: tr.axis, brakeRest: rest, brakeFull: full });
        this.next();
      });
      if ((I.pressed('confirm') && I.device === 'keyboard') && this.stT > 0.5) this.next();
    } else if (step.key.startsWith('btn:')) {
      const act = step.key.slice(4);
      const now = pad.buttons.map((b) => b.pressed);
      if (!this.prevBtn) this.prevBtn = now;
      const idx = now.findIndex((p, i) => p && !this.prevBtn[i]);
      this.prevBtn = now;
      if (idx >= 0 && this.stT > 0.25) {
        this.prof.buttons[act] = [idx];
        if (act === 'fire') this.prof.buttons.confirm = [idx];
        if (act === 'bomb') this.prof.buttons.back = [idx];
        this.next();
      }
      if (I.pressed('confirm') && I.device === 'keyboard') this.next();
    } else if (step.key === 'test') {
      if (this.stT > 0.6 && (pad.buttons.some((b) => b.pressed) || I.pressed('confirm'))) {
        In().cal[pad.id] = this.prof;
        In().saveCal();
        G.toast('WHEEL SAVED');
        G.audio.sfx('extra');
        this.leave();
      }
    }
  },
  ngInfo() {
    const I = In();
    if (I.gamepadBlocked) return { step: 'NOT AVAILABLE HERE', lines: ['THIS VIEW BLOCKS WHEEL ACCESS.', 'OPEN THE GAME FROM ITS OWN PAGE (LOCAL COPY OR GITHUB PAGES).'], warn: true, axes: [], hint: 'PRESS ESC TO GO BACK' };
    const step = STEPS[this.step];
    const pads = I.rawPads();
    const pad = this.pad ? pads.find((p) => p.index === this.pad.index) : this.findPad();
    const info = { step: 'STEP ' + (this.step + 1) + ' OF ' + STEPS.length, lines: [step.text.join(' ')], axes: [], hl: this.track ? this.track.axis : -1 };
    if (!pad) { info.pad = 'NO WHEEL FOUND · PLUG IT IN AND PRESS A BUTTON'; info.missing = true; }
    else {
      info.pad = pad.id.toUpperCase().replace(/[^A-Z0-9 ().:-]/g, '').slice(0, 56);
      info.axes = pad.axes.slice(0, 10);
      if (step.key === 'test') {
        const p = this.prof;
        info.test = {
          steer: p.steerAxis >= 0 ? (pad.axes[p.steerAxis] - p.steerCenter) / ((p.steerMax - p.steerCenter) || 1) : 0,
          gas: p.gasAxis >= 0 ? U.clamp((pad.axes[p.gasAxis] - p.gasRest) / (p.gasFull - p.gasRest), 0, 1) : 0,
          brake: p.brakeAxis >= 0 ? U.clamp((pad.axes[p.brakeAxis] - p.brakeRest) / (p.brakeFull - p.brakeRest), 0, 1) : 0,
        };
      }
    }
    const skippable = step.key !== 'center' && step.key !== 'steer' && step.key !== 'test';
    info.hint = step.key === 'test' ? 'PRESS ANY WHEEL BUTTON TO SAVE · ESC CANCEL' : 'ESC CANCEL' + (skippable ? ' · ENTER SKIP' : '');
    return info;
  },
  render(ctx) {
    const ng = NGUI();
    if (ng) { ctx.clearRect(0, 0, VW, VH); ngBackdrop(this, false); ng.wheel(this.ngInfo()); return; }
    backdrop(ctx, this.t, { truck: false, still: true });
    G.hud.panel(ctx, 16, 6, VW - 32, VH - 12);
    T(ctx, 'WHEEL SETUP', VW / 2, 12, { color: '#ffe060', scale: 2, align: 'center', outline: DARK });
    const I = In();
    if (I.gamepadBlocked) {
      T(ctx, 'THIS VIEW BLOCKS WHEEL ACCESS.', VW / 2, 70, { color: '#ff5a4a', align: 'center' });
      T(ctx, 'OPEN THE GAME FROM ITS OWN PAGE', VW / 2, 84, { color: '#ffffff', align: 'center' });
      T(ctx, '(LOCAL COPY OR GITHUB PAGES).', VW / 2, 96, { color: '#ffffff', align: 'center' });
      T(ctx, 'PRESS ESC TO GO BACK', VW / 2, VH - 24, { color: '#a8a0b8', align: 'center' });
      G.ui.add(0, 0, VW, VH, () => this.leave());
      return;
    }
    const step = STEPS[this.step];
    T(ctx, 'STEP ' + (this.step + 1) + ' OF ' + STEPS.length, VW / 2, 32, { color: '#a8a0b8', align: 'center' });
    step.text.forEach((l, i) => T(ctx, l, VW / 2, 50 + i * 12, { color: '#ffffff', align: 'center' }));
    const pads = I.rawPads();
    const pad = this.pad ? pads.find((p) => p.index === this.pad.index) : this.findPad();
    if (!pad) {
      if (Math.floor(this.t * 2) % 2 === 0) T(ctx, 'NO WHEEL FOUND - PLUG IT IN AND PRESS A BUTTON', VW / 2, 100, { color: '#ff5a4a', align: 'center' });
    } else {
      T(ctx, pad.id.toUpperCase().replace(/[^A-Z0-9 ().:-]/g, '').slice(0, 56), VW / 2, 94, { color: '#7cf0e0', align: 'center' });
      // live axis bars
      const n = Math.min(10, pad.axes.length);
      for (let i = 0; i < n; i++) {
        const x = 40 + i * 31, y = 112;
        const v = U.clamp(pad.axes[i], -1, 1);
        const hl = this.track && this.track.axis === i;
        ctx.fillStyle = '#2e2838';
        ctx.fillRect(x, y, 24, 40);
        ctx.fillStyle = hl ? '#ffe060' : '#7cf0e0';
        const h = Math.round(v * 20);
        ctx.fillRect(x, y + 20 - Math.max(0, h), 24, Math.abs(h) || 1);
        T(ctx, 'A' + i, x + 12, y + 44, { color: '#a8a0b8', align: 'center' });
      }
      if (step.key === 'test') {
        const p = this.prof;
        const fake = { axes: pad.axes };
        const steer = p.steerAxis >= 0 ? (pad.axes[p.steerAxis] - p.steerCenter) / ((p.steerMax - p.steerCenter) || 1) : 0;
        const g = p.gasAxis >= 0 ? U.clamp((pad.axes[p.gasAxis] - p.gasRest) / (p.gasFull - p.gasRest), 0, 1) : 0;
        const b = p.brakeAxis >= 0 ? U.clamp((pad.axes[p.brakeAxis] - p.brakeRest) / (p.brakeFull - p.brakeRest), 0, 1) : 0;
        void fake;
        G.hud.panel(ctx, 40, 166, VW - 80, 26);
        T(ctx, 'STEER', 48, 170, { color: '#a8a0b8' });
        ctx.fillStyle = '#ffe060';
        const sw = Math.round(U.clamp(steer, -1, 1) * 40);
        ctx.fillRect(130 + Math.min(0, sw), 171, Math.abs(sw) || 1, 5);
        T(ctx, 'GAS', 190, 170, { color: '#a8a0b8' });
        ctx.fillStyle = '#7cf07c'; ctx.fillRect(214, 171, Math.round(g * 40), 5);
        T(ctx, 'BRAKE', 262, 170, { color: '#a8a0b8' });
        ctx.fillStyle = '#ff5a4a'; ctx.fillRect(298, 171, Math.round(b * 40), 5);
        T(ctx, 'PRESS ANY WHEEL BUTTON TO SAVE', VW / 2, 182, { color: '#ffffff', align: 'center' });
      }
    }
    const skippable = step.key !== 'center' && step.key !== 'steer' && step.key !== 'test';
    T(ctx, 'ESC CANCEL' + (skippable ? '   ENTER SKIP' : ''), VW / 2, VH - 16, { color: '#6a6278', align: 'center' });
  },
};


G.screens = S;
