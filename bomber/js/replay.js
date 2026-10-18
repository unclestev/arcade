// Compact replay encoding shared by the browser and the referee.
// Inputs are one bucket position (0..4095) per tick, stored as zig-zag varint deltas,
// then deflate-compressed and base64 encoded. A long game is a few kilobytes.

import { MAX_TICKS, INPUT_MAX } from './sim.js';

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

export async function encodeReplay(mode, seed, segs, inputs) {
  const raw = new Uint8Array(inputs.length * 3); let n = 0, prev = 0;
  for (let i = 0; i < inputs.length; i++) {
    const d = inputs[i] - prev; prev = inputs[i];
    let z = d >= 0 ? d * 2 : -d * 2 - 1;
    while (z >= 0x80) { raw[n++] = (z & 0x7f) | 0x80; z >>>= 7; }
    raw[n++] = z;
  }
  const packed = await pipe(raw.subarray(0, n), new CompressionStream('deflate-raw'));
  return { v: 1, mode, seed, segs: segs.slice(), u: toB64(packed) };
}

export async function decodeReplay(r) {
  if (!r || r.v !== 1 || typeof r.u !== 'string' || !Array.isArray(r.segs)) throw new Error('bad replay');
  if (r.u.length > MAX_RAW_BYTES || r.segs.length > 10000) throw new Error('replay too large');
  const raw = await pipe(fromB64(r.u), new DecompressionStream('deflate-raw'), MAX_RAW_BYTES);
  const total = r.segs.reduce((a, b) => a + b, 0);
  if (!Number.isInteger(total) || total > MAX_TICKS) throw new Error('replay too long');
  const inputs = new Uint16Array(total);
  let i = 0, p = 0, prev = 0;
  while (p < raw.length) {
    let z = 0, shift = 0, byte;
    do {
      if (p >= raw.length || shift > 21) throw new Error('bad replay data');
      byte = raw[p++]; z |= (byte & 0x7f) << shift; shift += 7;
    } while (byte & 0x80);
    const d = z & 1 ? -((z + 1) >>> 1) : z >>> 1;
    const v = prev + d;
    if (i >= total || v < 0 || v > INPUT_MAX) throw new Error('bad replay data');
    inputs[i++] = v; prev = v;
  }
  if (i !== total) throw new Error('input count mismatch');
  return { mode: r.mode, seed: r.seed, segs: r.segs, inputs };
}
