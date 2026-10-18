// Particles, explosions, floating score text and screen shake.
import { G, OY } from './ns.js';
import { WORLD } from './sim.js';

const U = G.U;

class FX {
  constructor() {
    this.parts = [];
    this.booms = [];
    this.popups = [];
    this.shake = 0;
  }

  spawn(x, y, z, vx, vy, vz, life, color, size, grav, drag) {
    if (this.parts.length > 700) this.parts.shift();
    this.parts.push({ x, y, z, vx, vy, vz, life, max: life, color, size: size || 1, g: grav === undefined ? 200 : grav, drag: drag || 0 });
  }

  dust(x, y, color, n, spread) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * U.TAU, sp = (spread || 20) * Math.random();
      this.spawn(x, y, 1, Math.cos(a) * sp, Math.sin(a) * sp, 10 + Math.random() * 25, 0.35 + Math.random() * 0.35, color, Math.random() < 0.3 ? 2 : 1, 60, 2);
    }
  }
  sparks(x, y, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * U.TAU, sp = 40 + Math.random() * 70;
      this.spawn(x, y, 3, Math.cos(a) * sp, Math.sin(a) * sp, 30 + Math.random() * 50, 0.25 + Math.random() * 0.2, Math.random() < 0.5 ? '#fff6a0' : '#ffb030', 1, 260);
    }
  }
  splash(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * U.TAU, sp = 15 + Math.random() * 35;
      this.spawn(x, y, 1, Math.cos(a) * sp, Math.sin(a) * sp, 40 + Math.random() * 60, 0.4 + Math.random() * 0.3, Math.random() < 0.4 ? '#ffffff' : (color || '#8ac0f0'), Math.random() < 0.3 ? 2 : 1, 320);
    }
  }
  flame(x, y, z, vx, vy) {
    this.spawn(x, y, z, vx * 0.2 + (Math.random() - 0.5) * 20, vy * 0.2 + (Math.random() - 0.5) * 20, 5 + Math.random() * 10, 0.18 + Math.random() * 0.12, Math.random() < 0.5 ? '#ffe060' : '#ff7020', Math.random() < 0.4 ? 2 : 1, 0, 3);
  }
  smoke(x, y, z) {
    this.spawn(x, y, z, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, 18 + Math.random() * 10, 0.5 + Math.random() * 0.4, Math.random() < 0.5 ? '#5a5258' : '#7a7278', 2, -10, 1.5);
  }
  explosion(x, y, big) {
    this.booms.push({ x, y, t: 0, max: big ? 0.75 : 0.5, r: big ? 15 : 9 });
    for (let i = 0; i < (big ? 26 : 12); i++) {
      const a = Math.random() * U.TAU, sp = 30 + Math.random() * 90;
      this.spawn(x, y, 4, Math.cos(a) * sp, Math.sin(a) * sp, 50 + Math.random() * 90, 0.5 + Math.random() * 0.5, ['#ffe060', '#ff8a20', '#c83a20', '#3a3238'][(Math.random() * 4) | 0], Math.random() < 0.4 ? 2 : 1, 260);
    }
    for (let i = 0; i < (big ? 8 : 4); i++) this.smoke(x + (Math.random() - 0.5) * 10, y + (Math.random() - 0.5) * 10, 6);
    this.shake = Math.max(this.shake, big ? 5 : 3);
  }
  popup(x, y, text, color) {
    this.popups.push({ x, y, z: 14, t: 0, text, color: color || '#ffffff' });
  }

  update(dt) {
    for (const p of this.parts) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vz -= p.g * dt;
      if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; }
      if (p.z < 0) { p.z = 0; p.vz = -p.vz * 0.3; p.vx *= 0.6; p.vy *= 0.6; }
    }
    this.parts = this.parts.filter((p) => p.life > 0);
    for (const b of this.booms) b.t += dt;
    this.booms = this.booms.filter((b) => b.t < b.max);
    for (const p of this.popups) { p.t += dt; p.z += dt * 18; }
    this.popups = this.popups.filter((p) => p.t < 1.1);
    this.shake = Math.max(0, this.shake - dt * 14);
  }

  renderParts(ctx, vx, vy) {
    for (const p of this.parts) {
      const sx = Math.round(p.x - p.y + WORLD - vx), sy = Math.round((p.x + p.y) * 0.5 + OY - vy - p.z);
      if (sx < -4 || sy < -4 || sx > 390 || sy > 222) continue;
      ctx.fillStyle = p.color;
      ctx.fillRect(sx, sy, p.size, p.size);
    }
    for (const b of this.booms) {
      const sx = Math.round(b.x - b.y + WORLD - vx), sy = Math.round((b.x + b.y) * 0.5 + OY - vy - 6);
      const f = b.t / b.max;
      const r = Math.round(3 + b.r * Math.sqrt(f));
      const col = f < 0.12 ? '#ffffff' : f < 0.35 ? '#ffe060' : f < 0.65 ? '#ff8a20' : '#8a3a28';
      pixelDisc(ctx, sx, sy, r, col, b.t * 997);
      if (f < 0.6) pixelDisc(ctx, sx, sy - 1, Math.max(1, Math.round(r * 0.55)), f < 0.3 ? '#ffffff' : '#ffe060', b.t * 31);
    }
  }

  renderPopups(ctx, vx, vy) {
    for (const p of this.popups) {
      const sx = Math.round(p.x - p.y + WORLD - vx), sy = Math.round((p.x + p.y) * 0.5 + OY - vy - p.z - 14);
      if (p.t > 0.8 && Math.floor(p.t * 20) % 2) continue;
      G.font.text(ctx, p.text, sx, sy, { color: p.color, align: 'center', outline: '#140e1a' });
    }
  }
}

// Ragged pixel disc (squashed for isometric ground).
function pixelDisc(ctx, cx, cy, r, color, seed) {
  ctx.fillStyle = color;
  const ry = Math.max(1, Math.round(r * 0.75));
  for (let y = -ry; y <= ry; y++) {
    const span = Math.round(r * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry + 0.3))));
    const jag = U.hash2(y + 50, seed | 0) < 0.35 ? 1 : 0;
    ctx.fillRect(cx - span + jag, cy + y, span * 2 + 1 - jag * 2, 1);
  }
}

G.FX = FX;
G.pixelDisc = pixelDisc;
