import { G, OY } from './ns.js';
import { WORLD, HW, CURB, WALL } from './sim.js';

// Pre-rendered isometric ground for a track (pixel texture, walls, ramps, start line), scenery
// placement and the minimap. Purely visual: it reads the track geometry from sim.js.
const M = { GROUND: 0, TRACK: 1, LINE: 2, CURB_A: 3, CURB_B: 4, WALL_A: 5, WALL_B: 6, START_A: 7, START_B: 8,
  PUDDLE: 9, OIL: 10, BOOST: 11, RAMP: 12, RAMP_B: 13, PIT: 14, BOOST_B: 15 };
let U;

const methods = {
  pathFor(ctx, offset) {
    ctx.beginPath();
    for (let i = 0; i <= this.n; i++) {
      const k = i % this.n;
      const x = this.cx[k] - this.ty[k] * (offset || 0);
      const y = this.cy[k] + this.tx[k] * (offset || 0);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  },

  // ---------- decoration placement ----------
  placeDecor() {
    const rnd = U.rng(1000 + this.index * 77);
    const theme = this.theme;
    const list = [];
    const total = theme.decor.reduce((a, b) => a + b[1], 0);
    const pick = () => {
      let r = rnd() * total;
      for (const [type, w] of theme.decor) { r -= w; if (r <= 0) return type; }
      return theme.decor[0][0];
    };
    const clear = HW + CURB + WALL + 12;
    const tries = Math.round(900 * (this.def.decor || 1) * (theme.decorDensity || 1));
    for (let t = 0; t < tries; t++) {
      const x = 20 + rnd() * (WORLD - 40), y = 20 + rnd() * (WORLD - 40);
      const i = this.nearest(x, y, -1);
      const dist = Math.hypot(x - this.cx[i], y - this.cy[i]);
      const type = pick();
      const need = clear + (G.DECOR_SIZE[type] || 6);
      if (dist < need) continue;
      if (list.some((o) => Math.abs(o.x - x) < 14 && Math.abs(o.y - y) < 14)) continue;
      list.push({ type, x, y, v: Math.floor(rnd() * 3) });
    }
    // grandstands and flags near the start line
    const st = this.posAt(18, 0);
    const side = HW + CURB + WALL + 18;
    if (theme.stands) {
      for (const sgn of [-1, 1]) {
        for (const off of [-60, 20]) {
          const p = this.posAt(off, sgn * side);
          const a = Math.atan2(st.y - p.y, st.x - p.x);
          list.push({ type: 'stand', x: p.x, y: p.y, v: (off > 0 ? 1 : 0), face: this.ang[this.idxAt(off)] + (sgn > 0 ? Math.PI : 0), a });
        }
      }
    }
    // remove decor overlapping stands
    const stands = list.filter((o) => o.type === 'stand');
    this.decor = list.filter((o) => o.type === 'stand' || !stands.some((s) => Math.hypot(s.x - o.x, s.y - o.y) < 26));
    for (const o of this.decor) {
      o.sx = U.isoX(o.x, o.y) + WORLD;
      o.sy = U.isoY(o.x, o.y) + OY;
    }
    this.decor.sort((a, b) => a.sy - b.sy);
  },

  // ---------- ground rendering ----------
  renderGround() {
    const theme = this.theme;
    const W = WORLD;
    const idx = new Uint8Array(W * W);
    const height = new Uint8Array(W * W);
    const mask = U.makeCanvas(W, W);
    const mctx = mask.getContext('2d', { willReadFrequently: true });
    const self = this;

    function layer(mat, draw, onPixel) {
      mctx.clearRect(0, 0, W, W);
      mctx.save();
      mctx.fillStyle = '#fff';
      mctx.strokeStyle = '#fff';
      mctx.lineJoin = 'round';
      mctx.lineCap = 'round';
      draw(mctx);
      mctx.restore();
      const data = mctx.getImageData(0, 0, W, W).data;
      for (let p = 0, q = 3; p < W * W; p++, q += 4) {
        if (data[q] >= 128) {
          idx[p] = mat;
          if (onPixel) onPixel(p);
        }
      }
    }
    const stroke = (width, dash, offset) => (c) => {
      if (dash) c.setLineDash(dash);
      c.lineWidth = width;
      self.pathFor(c, offset || 0);
      c.stroke();
    };
    const wallH = theme.wallH || 4;
    // walls (with outer half removed so the wall is one band)
    layer(M.WALL_A, stroke((HW + CURB + WALL) * 2), (p) => { height[p] = wallH; });
    layer(M.WALL_B, stroke((HW + CURB + WALL) * 2, theme.wallDash || [4, 10]), (p) => { height[p] = wallH; });
    layer(M.CURB_A, stroke((HW + CURB) * 2), (p) => { height[p] = 0; });
    layer(M.CURB_B, stroke((HW + CURB) * 2, [8, 8]));
    layer(M.TRACK, stroke(HW * 2));
    // worn lines / ruts
    if (theme.lineStyle === 'ruts') {
      for (const o of [-14, -8, 8, 14]) layer(M.LINE, stroke(2, null, o));
    } else if (theme.lineStyle === 'center') {
      layer(M.LINE, stroke(2, [14, 14], 0));
    } else if (theme.lineStyle === 'groove') {
      layer(M.LINE, stroke(16, null, 0));
    }

    // start line checkers
    layer(M.START_A, (c) => {
      const a = this.posAt(0, -HW - CURB), b = this.posAt(0, HW + CURB), a2 = this.posAt(8, -HW - CURB), b2 = this.posAt(8, HW + CURB);
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(b2.x, b2.y); c.lineTo(a2.x, a2.y); c.closePath(); c.fill();
    });
    layer(M.START_B, (c) => {
      for (let row = 0; row < 2; row++) {
        for (let k = -HW - CURB; k < HW + CURB; k += 4) {
          if (((k + HW + CURB) / 4 + row) % 2 !== 0) continue;
          const s0 = row * 4, s1 = s0 + 4;
          const p1 = this.posAt(s0, k), p2 = this.posAt(s0, k + 4), p3 = this.posAt(s1, k + 4), p4 = this.posAt(s1, k);
          c.beginPath(); c.moveTo(p1.x, p1.y); c.lineTo(p2.x, p2.y); c.lineTo(p3.x, p3.y); c.lineTo(p4.x, p4.y); c.closePath(); c.fill();
        }
      }
    });

    const blob = (c, h, rnd) => {
      c.beginPath();
      c.arc(h.x, h.y, h.r * 0.85, 0, U.TAU);
      c.fill();
      for (let k = 0; k < 4; k++) {
        const a = rnd() * U.TAU, r = h.r * (0.35 + rnd() * 0.3);
        c.beginPath();
        c.arc(h.x + Math.cos(a) * h.r * 0.45, h.y + Math.sin(a) * h.r * 0.45, r, 0, U.TAU);
        c.fill();
      }
    };
    const rnd = U.rng(55 + this.index);
    if (this.puddles.length) layer(M.PUDDLE, (c) => this.puddles.forEach((h) => blob(c, h, rnd)));
    if (this.oils.length) layer(M.OIL, (c) => this.oils.forEach((h) => blob(c, h, rnd)));

    const quad = (c, s0, s1, d0, d1) => {
      const p1 = this.posAt(s0, d0), p2 = this.posAt(s0, d1), p3 = this.posAt(s1, d1), p4 = this.posAt(s1, d0);
      c.beginPath(); c.moveTo(p1.x, p1.y); c.lineTo(p2.x, p2.y); c.lineTo(p3.x, p3.y); c.lineTo(p4.x, p4.y); c.closePath(); c.fill();
    };
    if (this.boosts.length) {
      layer(M.BOOST, (c) => this.boosts.forEach((b) => quad(c, b.s0, b.s1, b.d - b.w, b.d + b.w)));
      layer(M.BOOST_B, (c) => this.boosts.forEach((b) => {
        for (let k = 0; k < 3; k++) {
          const s = b.s0 + 3 + k * 8;
          const tip = this.posAt(s + 6, b.d), l = this.posAt(s, b.d - b.w + 3), r = this.posAt(s, b.d + b.w - 3);
          const l2 = this.posAt(s + 3, b.d - b.w + 3), r2 = this.posAt(s + 3, b.d + b.w - 3), tip2 = this.posAt(s + 9, b.d);
          c.beginPath(); c.moveTo(l.x, l.y); c.lineTo(tip.x, tip.y); c.lineTo(r.x, r.y); c.lineTo(r2.x, r2.y); c.lineTo(tip2.x, tip2.y); c.lineTo(l2.x, l2.y); c.closePath(); c.fill();
        }
      }));
    }
    for (const r of this.ramps) {
      if (r.pit) layer(M.PIT, (c) => quad(c, r.pit.s0, r.pit.s1, -HW - CURB, HW + CURB));
      const s0 = r.s0, len = r.s1 - r.s0;
      const tx0 = this.tx[this.idxAt(s0)], ty0 = this.ty[this.idxAt(s0)];
      const c0 = this.posAt(s0, 0);
      const rampH = (p) => {
        const px = p % W, py = (p / W) | 0;
        const t = U.clamp(((px - c0.x) * tx0 + (py - c0.y) * ty0) / len, 0, 1);
        height[p] = 1 + Math.floor(t * 6);
      };
      layer(M.RAMP, (c) => quad(c, s0, r.s1, -HW - CURB + 2, HW + CURB - 2), rampH);
      layer(M.RAMP_B, (c) => { for (let k = 0; k < 3; k++) quad(c, s0 + 3 + k * 7, s0 + 5 + k * 7, -HW - CURB + 2, HW + CURB - 2); }, rampH);
    }

    // Colors
    const pal = theme.colors;
    const toU32 = (rgb) => (255 << 24) | (rgb[2] << 16) | (rgb[1] << 8) | rgb[0];
    const mats = {};
    for (const key in M) {
      const list = (pal[key] || pal.GROUND).map((h) => U.hex(h));
      mats[M[key]] = list;
    }
    const matU32 = {}, sideU32 = {}, side2U32 = {};
    for (const k in mats) {
      matU32[k] = mats[k].map(toU32);
      sideU32[k] = toU32(U.mul(mats[k][0], 0.68));
      side2U32[k] = toU32(U.mul(mats[k][0], 0.5));
    }
    const altU32 = (pal.GROUND_ALT || pal.GROUND).map((h) => toU32(U.hex(h)));
    const detU32 = (pal.DETAIL || []).map((h) => toU32(U.hex(h)));
    const outline = toU32(U.hex(pal.WALL_EDGE || '#1c1420'));

    // coarse patches for ground variation
    const CG = 4, CW = Math.ceil(W / CG) + 2;
    const patch = new Float32Array(CW * CW);
    for (let y = 0; y < CW; y++) for (let x = 0; x < CW; x++) {
      patch[y * CW + x] = U.noise(x * CG / 46 + this.index * 13.1, y * CG / 46) * 0.7 + U.noise(x * CG / 13, y * CG / 13 + 5) * 0.3;
    }

    const IW = W * 2, IH = W + OY + 8;
    const canvas = U.makeCanvas(IW, IH);
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(IW, IH);
    const buf = new Uint32Array(img.data.buffer);
    const patchT = theme.patch === undefined ? 0.58 : theme.patch;
    const detailP = theme.detailRate || 0;

    for (let py = 0; py < IH; py++) {
      const wy0 = py - OY + 0.5;
      for (let px = 0; px < IW; px++) {
        const sx = px - W + 0.5;
        const wx = wy0 + sx * 0.5, wyy = wy0 - sx * 0.5;
        const xi = Math.floor(wx), yi = Math.floor(wyy);
        const h = U.hash2(xi, yi);
        let mat = 0, ht = 0;
        if (xi >= 0 && yi >= 0 && xi < W && yi < W) {
          const p = yi * W + xi;
          mat = idx[p];
          ht = height[p];
        }
        let col;
        if (mat === 0) {
          const pv = patch[((yi >> 2) + 1) * CW + (xi >> 2) + 1] || 0.5;
          const dither = (h - 0.5) * 0.08;
          if (pv + dither > patchT) col = altU32[(h * altU32.length) | 0];
          else col = matU32[0][(h * matU32[0].length) | 0];
          if (detailP && detU32.length && h > 1 - detailP) col = detU32[((h * 9973) | 0) % detU32.length];
        } else {
          const shades = matU32[mat];
          col = shades[(h * shades.length) | 0];
        }
        if (ht > 0) {
          // extrude: side column then top face
          const side = (mat === M.RAMP || mat === M.RAMP_B) ? sideU32[M.RAMP] : sideU32[mat];
          const side2 = (mat === M.RAMP || mat === M.RAMP_B) ? side2U32[M.RAMP] : side2U32[mat];
          for (let k = 0; k < ht; k++) {
            const yy = py - k;
            if (yy >= 0) buf[yy * IW + px] = k === 0 ? side2 : side;
          }
          if (py - ht >= 0) buf[(py - ht) * IW + px] = col;
        } else {
          buf[py * IW + px] = col;
        }
      }
    }
    // dark rim along the top edge of walls for definition
    if (theme.wallRim !== false) {
      for (let py = 1; py < IH; py++) {
        for (let px = 0; px < IW; px++) {
          const sx = px - W + 0.5, wy0 = py - OY + 0.5;
          const xi = Math.floor(wy0 + sx * 0.5), yi = Math.floor(wy0 - sx * 0.5);
          if (xi < 0 || yi < 0 || xi >= W || yi >= W) continue;
          const p = yi * W + xi;
          if (height[p] !== wallH || idx[p] < M.WALL_A || idx[p] > M.WALL_B) continue;
          // a wall pixel whose neighbour toward the viewer-top is not wall: outline its top edge
          const xb = Math.floor(wy0 - 1 + sx * 0.5), yb = Math.floor(wy0 - 1 - sx * 0.5);
          if (xb < 0 || yb < 0 || xb >= W || yb >= W) continue;
          const pb = yb * W + xb;
          if (height[pb] === 0 && py - wallH - 1 >= 0) buf[(py - wallH - 1) * IW + px] = outline;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    this.ground = canvas;
    this.groundBackup = U.makeCanvas(IW, IH);
    this.groundBackup.getContext('2d').drawImage(canvas, 0, 0);
    this.gctx = ctx;
    this.IW = IW;
    this.IH = IH;
  },

  resetGround() {
    if (!this.ground) return;
    this.gctx.clearRect(0, 0, this.IW, this.IH);
    this.gctx.drawImage(this.groundBackup, 0, 0);
  },

  // Minimap: iso-projected centerline fitted to a box.
  buildMinimap(w, h) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < this.n; i++) {
      const x = U.isoX(this.cx[i], this.cy[i]), y = U.isoY(this.cx[i], this.cy[i]);
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const sc = Math.min((w - 6) / (maxX - minX), (h - 6) / (maxY - minY));
    const ox = (w - (maxX - minX) * sc) / 2, oy = (h - (maxY - minY) * sc) / 2;
    const map = (x, y) => [ox + (U.isoX(x, y) - minX) * sc, oy + (U.isoY(x, y) - minY) * sc];
    const c = U.makeCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 1;
    for (let i = 0; i < this.n; i += 1) {
      const [x, y] = map(this.cx[i], this.cy[i]);
      ctx.fillRect(Math.round(x) - 1, Math.round(y), 3, 1);
      ctx.fillRect(Math.round(x), Math.round(y) - 1, 1, 3);
    }
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = '#d8d0b8';
    ctx.fillRect(0, 0, w, h);
    this.minimap = { canvas: c, map, w, h };
    return this.minimap;
  }
};

// Only the current track's canvases are kept: each one is a few megabytes.
let current = null;
G.ground = {
  get(track) {
    U = G.U;
    if (current && current.index === track.index) { current.resetGround(); return current; }
    const v = Object.create(track);
    Object.assign(v, methods);
    v.theme = G.THEMES[track.def.theme];
    v.renderGround();
    v.placeDecor();
    v.buildMinimap(66, 42);
    current = v;
    return v;
  },
};
