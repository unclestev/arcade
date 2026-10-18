// In-race heads-up display.
import { G } from './ns.js';
import { LAPS, LETTER_WORD, TRACKS } from './sim.js';

const U = G.U;
const VW = G.CONFIG.VIEW_W, VH = G.CONFIG.VIEW_H;
const T = (ctx, s, x, y, o) => G.font.text(ctx, s, x, y, o);
const PLACE_COL = ['#ffd84a', '#d8e0ec', '#e09a5a', '#ff5a4a'];
const iconCache = {};

function icon(type) {
  if (iconCache[type]) return iconCache[type];
  const it = G.SPR.ITEMS[type];
  const c = U.makeCanvas(9, 9);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#140e1a';
  ctx.fillRect(0, 0, 9, 9);
  ctx.fillStyle = it.crate;
  ctx.fillRect(1, 1, 7, 7);
  ctx.fillStyle = it.icon;
  const rows = G.SPR.ICONS[type];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) if (rows[y][x] === '#') ctx.fillRect(2 + x, 2 + y, 1, 1);
  iconCache[type] = c;
  return c;
}

function panel(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(14,10,22,0.62)';
  ctx.fillRect(x, y, w, h);
}

function draw(ctx, race, game, opts) {
  opts = opts || {};
  const t = race.t;
  const R = race.R, pl = R.player;
  if (race.demo) return drawDemo(ctx, race, opts);

  // place + lap
  const rank = R.playerRank();
  panel(ctx, 2, 2, 82, 30);
  T(ctx, U.ordinal(rank), 6, 5, { color: PLACE_COL[rank - 1], scale: 2, shadow: '#140e1a' });
  const lapN = U.clamp(pl.lap + 1, 1, LAPS);
  T(ctx, 'LAP', 46, 5, { color: '#a8a0b8' });
  T(ctx, lapN + '/' + LAPS, 46, 14, { color: '#ffffff' });
  T(ctx, U.fmtTime(R.time), 6, 23, { color: '#a8a0b8' });
  // trucks left
  T(ctx, 'x' + game.lives, 66, 23, { color: '#ffffff' });
  ctx.fillStyle = G.SPR.SCHEMES[race.scheme(pl.slot)].paint;
  ctx.fillRect(58, 25, 6, 3);
  ctx.fillRect(59, 23, 4, 2);

  // score + letters
  const cx = VW / 2 - 20;
  panel(ctx, cx - 42, 2, 84, 30);
  T(ctx, U.pad(game.score + R.score, 7), cx, 5, { color: '#ffffff', align: 'center', scale: 1 });
  const word = LETTER_WORD;
  const wx = cx - Math.floor((word.length * 9 - 3) / 2);
  for (let i = 0; i < word.length; i++) {
    const got = i < game.letters;
    const next = i === game.letters;
    let col = got ? '#ffd84a' : '#4a4258';
    if (next && R.letter && R.letter.active && Math.floor(t * 3) % 2 === 0) col = '#ffffff';
    T(ctx, word[i], wx + i * 9, 16, { color: col });
  }
  // minimap
  const mm = race.gv.minimap;
  const mx = VW - mm.w - 2, my = 2;
  panel(ctx, mx, my, mm.w, mm.h);
  ctx.drawImage(mm.canvas, mx, my);
  const st = R.track.posAt(0, 0);
  const [sx0, sy0] = mm.map(st.x, st.y);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(mx + Math.round(sx0) - 1, my + Math.round(sy0) - 1, 3, 3);
  for (const c of R.cars) {
    if (c === pl) continue;
    const [x, y] = mm.map(c.x, c.y);
    ctx.fillStyle = '#140e1a';
    ctx.fillRect(mx + Math.round(x) - 1, my + Math.round(y) - 1, 3, 3);
    ctx.fillStyle = G.SPR.SCHEMES[race.scheme(c.slot)].roof;
    ctx.fillRect(mx + Math.round(x) - 1, my + Math.round(y) - 1, 2, 2);
  }
  {
    const [x, y] = mm.map(pl.x, pl.y);
    ctx.fillStyle = Math.floor(t * 6) % 2 ? '#ffffff' : '#140e1a';
    ctx.fillRect(mx + Math.round(x) - 2, my + Math.round(y) - 2, 4, 4);
    ctx.fillStyle = G.SPR.SCHEMES[race.scheme(pl.slot)].roof;
    ctx.fillRect(mx + Math.round(x) - 1, my + Math.round(y) - 1, 2, 2);
  }

  // ammo (bottom centre, clear of touch controls)
  const items = [['missile', pl.ammo.missile], ['bomb', pl.ammo.bomb], ['nitro', pl.ammo.nitro]];
  const bw = 30, bx = Math.round(VW / 2 - (items.length * bw) / 2), by = VH - 14;
  panel(ctx, bx - 3, by - 3, items.length * bw + 4, 15);
  items.forEach(([k, n], i) => {
    ctx.drawImage(icon(k), bx + i * bw, by);
    T(ctx, 'x' + n, bx + i * bw + 11, by + 1, { color: n > 0 ? '#ffffff' : '#6a6278' });
  });
  if (pl.boostT > 0) {
    ctx.fillStyle = Math.floor(t * 12) % 2 ? '#ffe060' : '#ff7020';
    ctx.fillRect(bx + 2 * bw - 2, by - 3, bw, 1);
  }

  // messages
  for (const m of race.messages) {
    if (m.big) {
      const scale = m.text.length > 10 ? 2 : 3;
      const pop = Math.min(1, m.t * 8);
      T(ctx, m.text, VW / 2, 66 - (1 - pop) * 10, { color: m.color, scale, align: 'center', outline: '#140e1a' });
    } else {
      T(ctx, m.text, VW / 2, 92, { color: m.color, align: 'center', outline: '#140e1a' });
    }
  }
  // countdown
  if (R.phase === 'countdown') {
    const n = 3 - Math.floor(R.phaseT / 0.8);
    if (n > 0) {
      const f = (R.phaseT % 0.8) / 0.8;
      T(ctx, String(n), VW / 2, 60 - f * 6, { color: ['#ff5a4a', '#ffd84a', '#ffe060'][3 - n] || '#fff', scale: 5, align: 'center', outline: '#140e1a' });
    }
    drawLights(ctx, n);
  }
  if (R.phase === 'intro') {
    const a = Math.min(1, R.phaseT * 4);
    panel(ctx, 0, 60, VW, 40);
    const name = race.def.name;
    T(ctx, 'RACE ' + (game.raceNo + 1) + ' - CIRCUIT ' + (Math.floor(game.raceNo / TRACKS.length) + 1), VW / 2, 66, { color: '#a8a0b8', align: 'center' });
    T(ctx, name, VW / 2 - (1 - a) * 200, 78, { color: '#ffe060', scale: 2, align: 'center', outline: '#140e1a' });
  }
  if (R.phase === 'race' && pl.wrongT > 1 && Math.floor(t * 4) % 2 === 0) {
    T(ctx, 'WRONG WAY!', VW / 2, 120, { color: '#ff5a4a', scale: 2, align: 'center', outline: '#140e1a' });
  }
}

function drawLights(ctx, n) {
  const x0 = VW / 2 - 22, y0 = 36;
  ctx.fillStyle = '#140e1a';
  ctx.fillRect(x0 - 3, y0 - 3, 50, 12);
  for (let i = 0; i < 3; i++) {
    const lit = 3 - n > i;
    ctx.fillStyle = lit ? (i < 2 ? '#ff4a3a' : '#ffd84a') : '#3a2e3e';
    ctx.fillRect(x0 + i * 16, y0, 12, 6);
  }
}

function drawDemo(ctx, race, opts) {
  const t = race.t;
  panel(ctx, 0, 2, VW, 12);
  T(ctx, 'DEMO PLAY  -  ' + race.def.name, VW / 2, 5, { color: '#a8a0b8', align: 'center' });
  if (Math.floor(t * 2) % 2 === 0) T(ctx, opts.prompt || 'PRESS START', VW / 2, VH - 30, { color: '#ffe060', scale: 2, align: 'center', outline: '#140e1a' });
  if (opts.credits) T(ctx, opts.credits, VW - 4, VH - 10, { color: '#ffffff', align: 'right', shadow: '#140e1a' });
}

G.hud = { draw, icon, panel, PLACE_COL };
