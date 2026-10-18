import { G, OY } from './ns.js';
import { WORLD, LETTER_WORD } from './sim.js';

// Draws a race from the simulation's state and turns its events into sound, particles and messages.
// Nothing here feeds back into the rules.
const RIVAL_NAMES = ['BLAZE', 'RIPTIDE', 'DUSTY', 'BOULDER', 'FROSTY', 'NIGHTOWL', 'TORCH', 'JAMMER'];
const PLAYER = 3;

export class RaceView {
  constructor(game, { scheme = 0, demo = false } = {}) {
    const U = G.U;
    this.game = game;
    this.R = game.race;
    this.def = this.R.def;
    this.track = this.R.track;
    this.demo = demo;
    this.gv = G.ground.get(this.track);
    this.theme = G.THEMES[this.def.theme];
    this.fx = new G.FX();
    this.messages = [];
    this.t = 0;
    const rivals = [0, 1, 2, 3, 4, 5, 6, 7].filter((s) => s !== scheme).slice(0, 3);
    this.schemes = [...rivals, scheme];
    this.names = [...rivals.map((s) => RIVAL_NAMES[s]), 'YOU'];
    this.frames = this.schemes.map((s) => G.SPR.truckFrames(s));
    const p = this.R.player;
    this.cam = { x: U.isoX(p.x, p.y) + WORLD, y: U.isoY(p.x, p.y) + OY };
    this.spin = 0;
  }

  scheme(slot) { return this.schemes[slot]; }
  isMe(slot) { return slot === PLAYER && !this.demo; }
  near(x, y) {
    return Math.abs(G.U.isoX(x, y) + WORLD - this.cam.x) < 220 && Math.abs(G.U.isoY(x, y) + OY - this.cam.y) < 130;
  }
  carNear(slot) { const c = this.R.cars[slot]; return this.near(c.x, c.y); }
  msg(text, color, dur, big) {
    this.messages = this.messages.filter((m) => m.big !== big);
    this.messages.push({ text, color: color || '#ffffff', t: 0, dur: dur || 1.6, big: !!big });
  }

  // ---------- simulation events ----------
  handle(events) {
    const A = G.audio, fx = this.fx, I = G.input;
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
        case 'nitro': if (me || this.carNear(e.car)) A.sfx('boost'); break;
        case 'empty': if (!this.demo) A.sfx('empty'); break;
        case 'hit':
          if (me) {
            A.sfx('hit'); I.rumble(0.9, 350); fx.shake = 6;
            this.msg(e.kind === 'lava' ? 'TOO HOT!' : 'OUCH!', '#ff6a5a', 1, false);
          } else if (this.near(e.x, e.y)) A.sfx('spin');
          break;
        case 'points': fx.popup(e.x, e.y, '+' + e.pts, '#ffe060'); break;
        case 'explode':
          fx.explosion(e.x, e.y, e.big);
          if (this.near(e.x, e.y)) A.sfx('explode');
          break;
        case 'upgrade': {
          const it = G.SPR.ITEMS[e.type];
          A.sfx('upgrade');
          this.msg(it.label + ' UP!', '#7cf07c', 1.4, false);
          fx.popup(e.x, e.y, it.label + '+', '#7cf07c');
          break;
        }
        case 'pickup': A.sfx('pickup'); fx.popup(e.x, e.y, '+' + e.add + ' ' + G.SPR.ITEMS[e.type].label, '#ffffff'); break;
        case 'letter':
          A.sfx('letter');
          fx.popup(e.x, e.y, e.ch + '!', '#ffe060');
          if (e.word) { this.msg(LETTER_WORD + '! +1 TRUCK', '#ffe060', 2.5, false); setTimeout(() => A.sfx('extra'), 400); }
          else this.msg('LETTER ' + e.ch, '#ffe060', 1.4, false);
          break;
        case 'finish': {
          const good = e.place <= 3;
          this.msg(good ? 'FINISHED ' + G.U.ordinal(e.place) + '!' : G.U.ordinal(e.place) + ' PLACE', good ? '#ffe060' : '#ff6a5a', 4, true);
          A.jingle(e.place === 1 ? 'win' : good ? 'qualify' : 'lose');
          break;
        }
        case 'tooslow': this.msg('TOO SLOW!', '#ff6a5a', 4, true); A.jingle('lose'); break;
        case 'lap': this.msg('LAP ' + e.lap, '#ffffff', 1.2, true); A.sfx('lap'); break;
        case 'finallap': this.msg('FINAL LAP!', '#ffe060', 1.6, true); A.sfx('finallap'); break;
        case 'wall':
          if (!this.near(e.x, e.y)) break;
          if (e.impact > 45) fx.sparks(e.x, e.y, 4);
          if (me) { A.sfx('wall'); I.rumble(Math.min(1, e.impact / 150), 90); }
          break;
        case 'oil': if (me) A.sfx('skid'); break;
        case 'puddle':
          if (this.near(e.x, e.y)) fx.splash(e.x, e.y, 10, this.theme.colors.PUDDLE[0]);
          if (me) A.sfx('splash');
          break;
        case 'boostpad': if (me) A.sfx('boost'); break;
        case 'jump': if (me) A.sfx('jump'); break;
        case 'land':
          if (this.near(e.x, e.y)) fx.dust(e.x, e.y, this.theme.dust, 8, 30);
          if (me) { A.sfx('land'); I.rumble(Math.min(1, e.impact / 200), 120); }
          break;
        case 'splash':
          if (this.near(e.x, e.y)) fx.splash(e.x, e.y, 6, this.theme.colors.PIT[0]);
          if (me && Math.random() < 0.3) A.sfx('splash');
          break;
        case 'bump':
          if (this.isMe(e.a) || this.isMe(e.b)) { A.sfx('bump'); I.rumble(0.3, 80); }
          break;
      }
    }
  }

  // ---------- per frame ----------
  update(dt) {
    const U = G.U;
    this.t += dt;
    this.fx.update(dt);
    for (const m of this.messages) m.t += dt;
    this.messages = this.messages.filter((m) => m.t < m.dur);
    this.spin += dt * 10;
    const f = this.R.player;
    const lead = 0.32;
    const tx = U.isoX(f.x + f.vx * lead, f.y + f.vy * lead) + WORLD;
    const ty = U.isoY(f.x + f.vx * lead, f.y + f.vy * lead) + OY - f.z * 0.5;
    const k = 1 - Math.exp(-dt * 5);
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;
    for (const c of this.R.cars) this.trail(c);
  }

  trail(c) {
    if (!this.near(c.x, c.y)) return;
    const fx = this.fx;
    const cs = Math.cos(c.h), sn = Math.sin(c.h);
    const rx = c.x - cs * 6, ry = c.y - sn * 6;
    const sliding = Math.abs(c.vL) > 30 || c.slipT > 0 || (c.brakeIn > 0.5 && c.vF > 60);
    if (c.z <= 0.5 && sliding) {
      const g = this.gv.gctx;
      g.fillStyle = 'rgba(20,12,16,0.22)';
      for (const sgn of [-1, 1]) {
        const wx = rx - sn * 4 * sgn, wy = ry + cs * 4 * sgn;
        g.fillRect(Math.round(wx - wy + WORLD), Math.round((wx + wy) * 0.5 + OY), 2, 1);
      }
    }
    if (Math.random() > 0.4) return;
    const gas = c.vF > 5 && c.vF < c.stats.vmax * 0.6;
    if (c.z <= 0.5 && (sliding || gas)) {
      fx.spawn(rx + (Math.random() - 0.5) * 6, ry + (Math.random() - 0.5) * 6, 1, -cs * 15 + (Math.random() - 0.5) * 20, -sn * 15 + (Math.random() - 0.5) * 20,
        12 + Math.random() * 16, 0.35 + Math.random() * 0.3, this.theme.dust, Math.random() < 0.4 ? 2 : 1, 50, 2);
    }
    if (c.boostT > 0) for (let i = 0; i < 2; i++) fx.flame(rx - cs * 2, ry - sn * 2, 4, -c.vx, -c.vy);
    if (c.spinT > 0 && Math.random() < 0.5) fx.smoke(c.x, c.y, 6);
  }

  // ---------- drawing ----------
  render(ctx) {
    const U = G.U, R = this.R, gv = this.gv;
    const VW = G.CONFIG.VIEW_W, VH = G.CONFIG.VIEW_H;
    const sh = this.fx.shake;
    let vx = Math.round(this.cam.x - VW / 2 + (sh ? (Math.random() - 0.5) * sh * 2 : 0));
    let vy = Math.round(this.cam.y - VH / 2 + (sh ? (Math.random() - 0.5) * sh * 2 : 0));
    vx = U.clamp(vx, 0, gv.IW - VW);
    vy = U.clamp(vy, 0, gv.IH - VH);
    ctx.drawImage(gv.ground, vx, vy, VW, VH, 0, 0, VW, VH);
    const t = this.t;
    const P = (x, y) => [Math.round(x - y + WORLD - vx), Math.round((x + y) * 0.5 + OY - vy)];

    ctx.globalAlpha = 0.3;
    for (const c of R.cars) {
      const [sx, sy] = P(c.x, c.y);
      const shrink = Math.min(4, Math.floor(c.z / 6));
      const s = G.SPR.shadow(12 - shrink, 6 - (shrink >> 1));
      ctx.drawImage(s, Math.round(sx - s.width / 2), Math.round(sy - s.height / 2 + 1));
    }
    for (const p of R.pickups) if (p.active) { const [sx, sy] = P(p.x, p.y); ctx.drawImage(G.SPR.shadow(7, 3), sx - 7, sy - 3); }
    if (R.letter && R.letter.active) { const [sx, sy] = P(R.letter.x, R.letter.y); ctx.drawImage(G.SPR.shadow(6, 3), sx - 6, sy - 3); }
    ctx.fillStyle = '#000';
    for (const m of R.missiles) { const [sx, sy] = P(m.x, m.y); ctx.fillRect(sx - 2, sy, 4, 1); }
    ctx.globalAlpha = 1;

    const list = [];
    for (const o of gv.decor) {
      const sx = o.sx - vx, sy = o.sy - vy;
      if (sx < -40 || sx > VW + 40 || sy < -10 || sy > VH + 50) continue;
      list.push({ depth: o.sy, o, kind: 'decor' });
    }
    for (const c of R.cars) list.push({ depth: (c.x + c.y) * 0.5 + OY + 0.5, c, kind: 'car' });
    for (const p of R.pickups) if (p.active) list.push({ depth: (p.x + p.y) * 0.5 + OY, p, kind: 'pickup' });
    if (R.letter && R.letter.active) list.push({ depth: (R.letter.x + R.letter.y) * 0.5 + OY, kind: 'letter' });
    for (const b of R.bombs) list.push({ depth: (b.x + b.y) * 0.5 + OY, b, kind: 'bomb' });
    for (const m of R.missiles) list.push({ depth: (m.x + m.y) * 0.5 + OY + 1, m, kind: 'missile' });
    const posts = [R.track.posAt(4, -R.track.drivable - 4), R.track.posAt(4, R.track.drivable + 4)];
    posts.forEach((p, i) => list.push({ depth: (p.x + p.y) * 0.5 + OY, p, i, kind: 'post' }));
    list.sort((a, b) => a.depth - b.depth);

    for (const it of list) {
      switch (it.kind) {
        case 'decor': {
          const o = it.o, spr = G.SPR.decor(o.type, o.v, o.face);
          ctx.drawImage(spr.c, o.sx - vx - spr.ax, o.sy - vy - spr.ay);
          break;
        }
        case 'car': {
          const c = it.c;
          if (c.invulnT > 0 && c.spinT <= 0 && Math.floor(t * 16) % 2 === 0) break;
          const [sx, sy] = P(c.x, c.y);
          const fr = this.frames[c.slot][G.SPR.angleIndex(c.h)];
          ctx.drawImage(fr.c, sx - fr.ax, sy - fr.ay - Math.round(c.z) + (c.inPit ? 3 : 0));
          break;
        }
        case 'pickup': {
          const p = it.p;
          const fr = G.SPR.crateFrames(p.type)[Math.floor(this.spin + p.id * 3) % G.SPR.SPIN];
          const [sx, sy] = P(p.x, p.y);
          ctx.drawImage(fr.c, sx - fr.ax, sy - fr.ay - Math.round(5 + Math.sin(t * 4 + p.id) * 2));
          break;
        }
        case 'letter': {
          const L = R.letter;
          const fr = G.SPR.letterFrames(L.ch)[Math.floor(t * 8) % G.SPR.SPIN];
          const [sx, sy] = P(L.x, L.y);
          ctx.drawImage(fr.c, sx - fr.ax, sy - fr.ay - Math.round(7 + Math.sin(t * 3) * 2));
          if (Math.random() < 0.2) this.fx.spawn(L.x + (Math.random() - 0.5) * 10, L.y + (Math.random() - 0.5) * 10, 8 + Math.random() * 8, 0, 0, 10, 0.4, '#fff6a0', 1, 0);
          break;
        }
        case 'bomb': {
          const b = it.b, spr = G.SPR.bomb();
          const [sx, sy] = P(b.x, b.y);
          ctx.drawImage(spr.c, sx - spr.ax, sy - spr.ay);
          if (b.armT <= 0 && Math.floor(t * 6) % 2 === 0) { ctx.fillStyle = '#ff3030'; ctx.fillRect(sx, sy - 9, 2, 2); }
          break;
        }
        case 'missile': {
          const m = it.m;
          const [sx, sy0] = P(m.x, m.y);
          const sy = sy0 - m.z;
          const ca = Math.cos(m.a), sa = Math.sin(m.a);
          let dx = ca - sa, dy = (ca + sa) * 0.5;
          const l = Math.hypot(dx, dy) || 1;
          dx /= l; dy /= l;
          ctx.fillStyle = '#140e1a';
          for (let k = -4; k <= 4; k++) ctx.fillRect(Math.round(sx + dx * k) - 1, Math.round(sy + dy * k) - 1, 4, 4);
          for (let k = -4; k <= 4; k++) {
            ctx.fillStyle = k >= 3 ? '#ff3a30' : k <= -4 ? (Math.floor(t * 20) % 2 ? '#ffe060' : '#ff7020') : k === -3 ? '#8a8a96' : '#f0f0f8';
            ctx.fillRect(Math.round(sx + dx * k), Math.round(sy + dy * k), 2, 2);
          }
          if (Math.random() < 0.6) this.fx.spawn(m.x, m.y, 4, 0, 0, 6, 0.3, Math.random() < 0.5 ? '#c8c0c8' : '#9a929a', 1, -5);
          break;
        }
        case 'post': {
          const [sx, sy] = P(it.p.x, it.p.y);
          ctx.fillStyle = '#140e1a';
          ctx.fillRect(sx - 2, sy - 27, 4, 28);
          ctx.fillStyle = '#c8ccd4';
          ctx.fillRect(sx - 1, sy - 27, 2, 27);
          const wave = Math.floor(t * 6 + it.i) % 2;
          ctx.fillStyle = '#140e1a';
          ctx.fillRect(sx + 1, sy - 28, 12, 8);
          for (let r = 0; r < 6; r++) for (let q = 0; q < 10; q++) {
            ctx.fillStyle = ((q >> 1) + (r >> 1)) % 2 ? '#f4f4f4' : '#1e1e24';
            ctx.fillRect(sx + 2 + q, sy - 27 + r + ((q > 5 && wave) ? 1 : 0), 1, 1);
          }
          break;
        }
      }
    }
    this.fx.renderParts(ctx, vx, vy);
    this.fx.renderPopups(ctx, vx, vy);
    if (!this.demo && (R.phase === 'intro' || R.phase === 'countdown') && Math.floor(t * 4) % 2 === 0) {
      const [sx, sy] = P(R.player.x, R.player.y);
      G.font.text(ctx, 'YOU', sx, sy - 34, { color: '#ffe060', align: 'center', outline: '#140e1a' });
      G.font.text(ctx, 'v', sx, sy - 26, { color: '#ffe060', align: 'center', outline: '#140e1a' });
    }
  }
}

G.RaceView = RaceView;
