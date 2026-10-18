// Compact replay encoding shared by the browser and the referee.
// Each tick is one packed input (steer, pedals, buttons). They are split into three byte planes
// (steer as deltas, pedals, buttons), deflate-compressed and base64 encoded.

import { MAX_TICKS } from './sim.js';

const MAX_RAW_BYTES = MAX_TICKS * 3;

function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream, cap) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const chunks = []; let len = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    len += value.length;
    if (cap && len > cap) { try { await reader.cancel(); } catch (e) {} throw new Error('replay too large'); }
    chunks.push(value);
  }
  const out = new Uint8Array(len); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export async function encodeReplay(board, seed, segs, inputs) {
  const n = inputs.length;
  const raw = new Uint8Array(n * 3);
  let prev = 100;
  for (let i = 0; i < n; i++) {
    const u = inputs[i];
    const s = u & 0xff;
    raw[i] = (s - prev) & 0xff; prev = s;
    raw[n + i] = (((u >> 8) & 0xf) << 4) | ((u >> 12) & 0xf);
    raw[2 * n + i] = (u >> 16) & 7;
  }
  const packed = await pipe(raw, new CompressionStream('deflate-raw'));
  return { v: 1, board, seed, segs: segs.slice(), u: toB64(packed) };
}

// Cheap structural check for the referee's quick path: decompresses (natively) and checks the size,
// without decoding every frame. The full replay check happens later in decodeReplay + runReplay.
export async function replayShape(r) {
  if (!r || r.v !== 1 || typeof r.u !== 'string' || !Array.isArray(r.segs)) throw new Error('bad replay');
  if (r.u.length > MAX_RAW_BYTES || r.segs.length > 2000) throw new Error('replay too large');
  const total = r.segs.reduce((a, b) => a + b, 0);
  if (!r.segs.every(x => Number.isInteger(x) && x >= 0) || total > MAX_TICKS) throw new Error('replay too long');
  const raw = await pipe(fromB64(r.u), new DecompressionStream('deflate-raw'), MAX_RAW_BYTES);
  if (raw.length !== total * 3) throw new Error('input count mismatch');
  return { segs: r.segs, ticks: total };
}

export async function decodeReplay(r) {
  if (!r || r.v !== 1 || typeof r.u !== 'string' || !Array.isArray(r.segs)) throw new Error('bad replay');
  if (r.u.length > MAX_RAW_BYTES || r.segs.length > 2000) throw new Error('replay too large');
  const total = r.segs.reduce((a, b) => a + b, 0);
  if (!r.segs.every(x => Number.isInteger(x) && x >= 0) || total > MAX_TICKS) throw new Error('replay too long');
  const raw = await pipe(fromB64(r.u), new DecompressionStream('deflate-raw'), MAX_RAW_BYTES);
  if (raw.length !== total * 3) throw new Error('input count mismatch');
  const inputs = new Uint32Array(total);
  let s = 100;
  for (let i = 0; i < total; i++) {
    s = (s + raw[i]) & 0xff;
    const gas = raw[total + i] >> 4, brake = raw[total + i] & 0xf, btn = raw[2 * total + i];
    if (s > 200 || gas > 10 || brake > 10 || btn > 7) throw new Error('bad replay data');
    inputs[i] = s | (gas << 8) | (brake << 12) | (btn << 16);
  }
  return { board: r.board, seed: r.seed, segs: r.segs, inputs };
}
