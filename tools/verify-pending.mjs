#!/usr/bin/env node
// Verifier job for games the referee checks later (deferred), such as Dirtbox Rally.
// Runs on GitHub Actions every few minutes (.github/workflows/verify-runs.yml):
//   1. asks the referee for pending runs (GET /pending)
//   2. replays each one with the game's own verify module, exactly as the referee would
//   3. reports the result (POST /resolve); the referee signs the verified score (or, for a rejected run,
//      a record that closes the pending one), and this job publishes it to the arcade's relays.
// It never holds the referee's key: it only proves itself with VERIFIER_TOKEN.
//
// Usage: VERIFIER_TOKEN=... node tools/verify-pending.mjs [--dry-run] [--referee URL]

import { GAMES } from '../referee/src/games.js';
import { REFEREE_URL, RELAYS } from '../kit/config.js';
import { verifyEvent } from '../kit/vendor/nostr.js';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const REFEREE = args.includes('--referee') ? args[args.indexOf('--referee') + 1] : REFEREE_URL;
const TOKEN = process.env.VERIFIER_TOKEN || '';
const TIME_BUDGET_MS = 8 * 60 * 1000; // stay inside one scheduled run
const log = (...a) => console.log(new Date().toISOString(), ...a);
// On GitHub Actions, problems also show up as annotations on the run page.
const problem = msg => { log(msg); if (process.env.GITHUB_ACTIONS) console.log('::error::' + String(msg).replace(/\r?\n/g, ' ')); process.exitCode = 1; };

export async function verifyOne(run) {
  const game = GAMES[run.game];
  if (!game) return { ok: false, reason: 'unknown game' };
  if (run.rules !== game.rules) return { ok: false, reason: `rules changed (${run.rules} -> ${game.rules})` };
  try {
    const r = await game.verify({ board: run.board, seed: run.seed, replay: run.replay });
    if (!r.finished) return { ok: false, reason: 'run not finished', score: r.score };
    if (r.score !== run.score) return { ok: false, reason: `replay scores ${r.score}, claimed ${run.score}`, score: r.score };
    return { ok: true, score: r.score, stats: r.stats };
  } catch (e) {
    return { ok: false, reason: 'replay failed: ' + String(e && e.message || e).slice(0, 120) };
  }
}

async function call(path, init = {}) {
  const res = await fetch(REFEREE + path, { ...init, headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  let j = {};
  try { j = await res.json(); } catch (e) { /* ignore */ }
  if (!res.ok) throw new Error(`${path}: ${res.status} ${j.error || ''}`);
  return j;
}

// Minimal relay client (one short-lived WebSocket per relay). Failures are swallowed: a relay
// that is down must never stop the job.
function relayRequest(url, onOpen, onMessage, ms) {
  return new Promise(resolve => {
    let ws, settled = false;
    const finish = v => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (ws && ws.readyState <= 1) ws.close(); } catch (e) { /* ignore */ }
      resolve(v);
    };
    const timer = setTimeout(() => finish(undefined), ms);
    try { ws = new WebSocket(url); } catch (e) { finish(undefined); return; }
    ws.onopen = () => { try { onOpen(ws); } catch (e) { finish(undefined); } };
    ws.onmessage = m => { let msg; try { msg = JSON.parse(m.data); } catch (e) { return; } const r = onMessage(msg); if (r !== undefined) finish(r); };
    ws.onerror = () => finish(undefined);
    ws.onclose = () => finish(undefined);
  });
}
async function publishTo(ev) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const results = await Promise.all(RELAYS.map(url => relayRequest(url, ws => ws.send(JSON.stringify(['EVENT', ev])),
      msg => (msg[0] === 'OK' && msg[1] === ev.id ? !!msg[2] : undefined), 8000)));
    const n = results.filter(Boolean).length;
    if (n) return n;
    if (attempt < 3) await new Promise(r => setTimeout(r, 5000));
  }
  // Nothing accepted it: keep the signed event in the job log so it can be republished by hand.
  process.exitCode = 1;
  log('  NO RELAY ACCEPTED THIS EVENT; republish it from here:', JSON.stringify(ev));
  return 0;
}
async function queryAll(filter) {
  const lists = await Promise.all(RELAYS.map(url => {
    const got = [];
    return relayRequest(url, ws => ws.send(JSON.stringify(['REQ', 'q', filter])),
      msg => { if (msg[0] === 'EVENT' && msg[1] === 'q') got.push(msg[2]); return msg[0] === 'EOSE' ? got : undefined; }, 6000)
      .then(r => r || got);
  }));
  return lists.flat();
}

// Publish the referee's event. A verified score only replaces the player's record if it beats it,
// because a slower check could finish after a better run was already verified.
async function publish(events, d) {
  const ev = events[0];
  if (!verifyEvent(ev)) throw new Error('referee returned a bad event');
  if (ev.tags.some(t => t[0] === 'status')) return `closed rejected run on ${await publishTo(ev)} relays`;
  const score = e => Number((e.tags.find(t => t[0] === 'score') || [])[1] || 0);
  const existing = (await queryAll({ kinds: [ev.kind], authors: [ev.pubkey], '#d': [d] })).filter(e => e && verifyEvent(e));
  const best = existing.reduce((m, e) => Math.max(m, score(e)), 0);
  if (best >= score(ev)) return `kept existing best ${best}`;
  return `published verified score to ${await publishTo(ev)} relays`;
}

async function main() {
  if (TOKEN.length < 32) { problem('VERIFIER_TOKEN is not set: add it as a GitHub Actions secret (see referee/README.md).'); return; }
  const started = Date.now();
  let done = 0, failed = 0;
  {
    while (Date.now() - started < TIME_BUDGET_MS) {
      const { runs } = await call('/pending?limit=10');
      if (!runs.length) break;
      for (const run of runs) {
        const t0 = Date.now();
        const v = await verifyOne(run);
        log(`${run.game}/${run.board} run ${run.run}: ${v.ok ? 'OK' : 'REJECTED (' + v.reason + ')'} score ${run.score} in ${Date.now() - t0} ms`);
        if (DRY) continue;
        try {
          const r = await call('/resolve', { method: 'POST', body: JSON.stringify({ run: run.run, ok: v.ok, score: v.score, stats: v.stats || {}, reason: v.reason || '' }) });
          log('  ' + await publish(r.events, r.d));
          done++;
        } catch (e) { failed++; problem('could not resolve run ' + run.run + ': ' + e.message); }
      }
      if (DRY) break;
    }
  }
  log(`finished: ${done} resolved, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => problem('verifier stopped: ' + e.message)).finally(() => process.exit(process.exitCode || 0));
}
