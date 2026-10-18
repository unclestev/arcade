// UncleStev Arcade referee — a Cloudflare Worker that verifies runs for every game in the arcade.
//
// 1. GET  /ticket?game=&board=&pubkey=  hands out a one-run seed, sealed with an HMAC so it can't be forged.
//    GET  /ticket?game=&board=&guest=   same for guests (no Nostr account): a random guest id instead of a pubkey.
// 2. POST /verify                       takes a finished run (ticket + rules version + recorded inputs), asks
//                                       that game's verify module to replay it with the same rules as the
//                                       browser, and if it checks out, signs the score with the referee key.
// 3. GET  /games                        lists the games, boards and rules versions the referee knows.
// 4. GET  /                             setup page: shows the referee's public key (never the secret).
//
// The referee's private key lives only in the REFEREE_SECRET secret on Cloudflare.
// Players' keys never come here: they prove who they are with a NIP-98 signed request.
// Guests need no key at all: their ticket plus a replay that checks out is the proof, and the score
// is published under a nickname with a hash of their guest id.

import { GAMES } from './games.js';
import { checkName } from '../../kit/names.js';
import { finalizeEvent, getPublicKey, verifyEvent, nip19, sha256, bytesToHex, hexToBytes } from '../../kit/vendor/nostr.js';

const HEX64 = /^[0-9a-f]{64}$/;
const SEED = /^[0-9a-f]{32}$/;
const GUEST = /^[0-9a-f]{32}$/;
// Guests are identified by a random id kept in their browser; scores carry only a one-way hash of it.
const guestTag = id => bytesToHex(sha256(enc.encode('arcade-guest:' + id))).slice(0, 32);
const STAT = /^[a-z0-9_]{1,24}$/;
const TICKET_TTL_MS = 6 * 3600 * 1000;
const MAX_BODY = 512 * 1024;
const enc = new TextEncoder();

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; this.expose = true; } }

const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = s => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };

let cached = null;
async function refereeKey(env) {
  const secret = String(env.REFEREE_SECRET || '').trim().toLowerCase();
  if (!HEX64.test(secret)) return null;
  if (cached && cached.secret === secret) return cached;
  const sk = hexToBytes(secret);
  const hmacKey = await crypto.subtle.importKey('raw', sha256(enc.encode('arcade-ticket-v1:' + secret)),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  cached = { secret, sk, pk: getPublicKey(sk), hmacKey };
  return cached;
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
}
const findGame = (game, board) => {
  const g = Object.prototype.hasOwnProperty.call(GAMES, game) ? GAMES[game] : null;
  return g && Object.prototype.hasOwnProperty.call(g.boards, board) ? g : null;
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || 'https://unclestev.github.io').split(',').map(s => s.trim()).filter(Boolean);
    const cors = allowed.includes(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' };
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '86400' } });
    }
    try {
      if (url.pathname === '/' && req.method === 'GET') return home(env, url);
      if (url.pathname === '/games' && req.method === 'GET') {
        return json(Object.values(GAMES).map(g => ({ id: g.id, title: g.title, rules: g.rules, boards: g.boards })), 200, cors);
      }
      const key = await refereeKey(env);
      if (!key) throw new HttpError(503, 'The referee is not set up yet.');
      if (url.pathname === '/ticket' && req.method === 'GET') return json(await issueTicket(url, key), 200, cors);
      if (url.pathname === '/verify' && req.method === 'POST') return json(await verifyRun(req, url, key, env), 200, cors);
      throw new HttpError(404, 'Not found.');
    } catch (e) {
      return json({ error: e.expose ? e.message : 'The referee hit an error.' }, e.status || 500, cors);
    }
  },
};

// ---------- tickets ----------
async function issueTicket(url, key) {
  const game = url.searchParams.get('game'), board = url.searchParams.get('board');
  const pubkey = url.searchParams.get('pubkey'), guest = url.searchParams.get('guest');
  if (!findGame(game, board)) throw new HttpError(400, 'Bad ticket request.');
  const who = HEX64.test(pubkey || '') ? { p: pubkey } : GUEST.test(guest || '') ? { q: guest } : null;
  if (!who) throw new HttpError(400, 'Bad ticket request.');
  const seed = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const body = b64url(enc.encode(JSON.stringify({ v: 1, g: game, b: board, ...who, s: seed, t: Date.now() })));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key.hmacKey, enc.encode(body)));
  return { ticket: body + '.' + b64url(sig), seed };
}
async function openTicket(ticket, key) {
  if (typeof ticket !== 'string' || ticket.length > 1000) throw new HttpError(400, 'Bad ticket.');
  const [body, sig] = ticket.split('.');
  if (!body || !sig) throw new HttpError(400, 'Bad ticket.');
  let ok = false;
  try { ok = await crypto.subtle.verify('HMAC', key.hmacKey, fromB64url(sig), enc.encode(body)); } catch (e) {}
  if (!ok) throw new HttpError(403, 'This run was not started by the referee.');
  const t = JSON.parse(new TextDecoder().decode(fromB64url(body)));
  const whoOk = t.p !== undefined ? HEX64.test(t.p) && t.q === undefined : GUEST.test(t.q || '');
  if (t.v !== 1 || !findGame(t.g, t.b) || !whoOk || !SEED.test(t.s) || !Number.isFinite(t.t)) throw new HttpError(400, 'Bad ticket.');
  if (Date.now() - t.t > TICKET_TTL_MS) throw new HttpError(403, 'This run is too old to verify.');
  return t;
}

// ---------- NIP-98 auth ----------
function checkAuth(header, url, bodyText) {
  if (!header || !header.startsWith('Nostr ') || header.length > 8000) throw new HttpError(401, 'Sign the request with Nostr.');
  let ev;
  try { ev = JSON.parse(new TextDecoder().decode(fromB64url(header.slice(6).trim()))); } catch (e) { throw new HttpError(401, 'Bad Nostr authorization.'); }
  const tag = k => (ev.tags || []).find(x => Array.isArray(x) && x[0] === k)?.[1];
  const now = Math.floor(Date.now() / 1000);
  if (ev.kind !== 27235 || !HEX64.test(ev.pubkey || '') || Math.abs(now - ev.created_at) > 120) throw new HttpError(401, 'Your sign-in for this request expired. Try again.');
  if (tag('u') !== url.href || tag('method') !== 'POST') throw new HttpError(401, 'Authorization is for a different request.');
  if (tag('payload') !== bytesToHex(sha256(enc.encode(bodyText)))) throw new HttpError(401, 'Authorization does not match this run.');
  if (!verifyEvent(ev)) throw new HttpError(401, 'Bad signature.');
  return ev.pubkey;
}

// ---------- verification ----------
async function verifyRun(req, url, key, env) {
  const len = Number(req.headers.get('Content-Length') || 0);
  if (len > MAX_BODY) throw new HttpError(413, 'Run is too large.');
  const bodyText = await req.text();
  if (bodyText.length > MAX_BODY) throw new HttpError(413, 'Run is too large.');

  let body;
  try { body = JSON.parse(bodyText); } catch (e) { throw new HttpError(400, 'Bad request.'); }
  const t = await openTicket(body.ticket, key);
  let who;
  if (t.p) {
    // Nostr player: must prove it's their run with a NIP-98 signature.
    const player = checkAuth(req.headers.get('Authorization'), url, bodyText);
    if (t.p !== player) throw new HttpError(403, 'This run belongs to a different player.');
    who = [['d', `arcade:${t.g}:${t.b}:${player}`], ['p', player]];
  } else {
    // Guest: the ticket was issued for their private guest id; they choose a nickname.
    const n = checkName(body.name);
    if (!n.ok) throw new HttpError(422, n.error);
    const tag = guestTag(t.q);
    who = [['d', `arcade:${t.g}:${t.b}:guest:${tag}`], ['guest', tag], ['name', n.name]];
  }
  const game = findGame(t.g, t.b);
  if (body.rules !== game.rules) throw new HttpError(409, `${game.title} was updated. Reload the page to play the new version.`);

  let r;
  try { r = await game.verify({ board: t.b, seed: t.s, replay: body.replay }); }
  catch (e) { throw new HttpError(422, 'The replay did not check out: ' + String(e && e.message || 'invalid').slice(0, 120)); }
  if (!r || !r.finished) throw new HttpError(422, 'The run is not finished.');
  if (!Number.isSafeInteger(r.score) || r.score <= 0 || r.score > 999999999999) throw new HttpError(422, 'Score some points to post a run.');
  if (!(Date.now() - t.t >= (Number(r.playMs) || 0) * 0.97)) throw new HttpError(422, 'The run finished faster than it could be played.');

  const stats = Object.entries(r.stats || {}).filter(([k, v]) => STAT.test(k) && Number.isSafeInteger(v) && v >= 0).slice(0, 12);
  const label = `${game.title} ${game.boards[t.b]}`;
  const event = finalizeEvent({
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ...who,
      ['t', 'arcade'], ['t', t.g], ['t', `${t.g}-${t.b}`],
      ['game', t.g], ['board', t.b],
      ['score', String(r.score)],
      ...stats.map(([k, v]) => ['stat', k, String(v)]),
      ['rules', game.rules],
      ['replay', bytesToHex(sha256(enc.encode(JSON.stringify(body.replay))))],
      ['alt', `${env.ARCADE_NAME || 'Arcade'}: verified ${label} score ${r.score}`],
    ],
    content: '',
  }, key.sk);
  return { event };
}

// ---------- setup page ----------
function home(env, url) {
  const name = esc(env.ARCADE_NAME || 'Arcade');
  const secret = String(env.REFEREE_SECRET || '').trim().toLowerCase();
  let body;
  if (HEX64.test(secret)) {
    const pk = getPublicKey(hexToBytes(secret));
    body = `<h1>${name} referee is running</h1>
<p>Put these two lines in <code>kit/config.js</code> in the arcade repo:</p>
<pre>export const REFEREE_URL = '${esc(url.origin)}';
export const REFEREE_PUBKEY = '${pk}';</pre>
<p>Referee npub: <code>${nip19.npubEncode(pk)}</code></p>
<p>Games: ${Object.values(GAMES).map(g => esc(g.title) + ' (rules ' + esc(g.rules) + ')').join(', ')}</p>
<p>The secret key is never displayed here.</p>`;
  } else {
    const fresh = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    body = `<h1>Set up the ${name} referee</h1>
<p>The referee needs its own Nostr key. Here is a fresh random one, made just now for this page view only:</p>
<pre>${fresh}</pre>
<ol>
<li>In Cloudflare, open this Worker, then <b>Settings → Variables and Secrets → Add</b>.</li>
<li>Type <b>Secret</b>, name <code>REFEREE_SECRET</code>, and paste the value above.</li>
<li>Save and deploy, then reload this page to get the public key for the games.</li>
</ol>
<p>Don't share that value or post it anywhere. Cloudflare can't show a secret again after you save it, so if you want a backup, keep it in a password manager. Once it's saved, this page stops showing keys.</p>`;
  }
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name} referee</title>
<style>body{font:17px/1.5 system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;background:#15110d;color:#f2e6d2}
pre,code{font:14px ui-monospace,Menlo,monospace;background:#211a14;border-radius:6px}pre{padding:12px;white-space:pre-wrap;word-break:break-all}code{padding:1px 4px}h1{color:#f0862a}</style>${body}`;
  return new Response(html, { headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  } });
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
