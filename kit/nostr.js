// UncleStev Arcade — Nostr core: sign-in, verified scores, leaderboards, sharing. Shared by every game.
//
// KEY SAFETY RULES (do not relax these):
//  1. The arcade never asks for, accepts, generates, stores or sends a player's private key.
//     Signing happens only inside a NIP-07 browser extension or a NIP-46 signer app.
//  2. Anything that looks like a private key typed into the arcade is rejected and wiped on the spot.
//  3. The only keys the arcade creates are throwaway Nostr Connect session keys. They live in memory
//     for one visit, are never written to storage, and the signer app is only asked for two
//     narrow permissions: sign kind 27235 (referee login) and kind 1 (a score note you approve).
//  4. Every event coming back from a signer is checked: valid signature, your pubkey, and exactly
//     the content the arcade asked to sign. Every event read from relays is signature-checked too.
//  5. Signing is disabled when a game is embedded inside another site (clickjacking guard).

import {
  SimplePool, verifyEvent, generateSecretKey, getPublicKey, nip19,
  BunkerSigner, parseBunkerInput, createNostrConnectURI, sha256, bytesToHex,
} from './vendor/nostr.js';
import { ARCADE_NAME, HOME_URL, RELAYS, CONNECT_RELAYS, REFEREE_URL, REFEREE_PUBKEY, SCORE_KIND } from './config.js';
import { checkName } from './names.js';

const HEX64 = /^[0-9a-f]{64}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const now = () => Math.floor(Date.now() / 1000);
const STORE_KEY = 'arcade.nostr'; // holds { method, pubkey } only — public information

export const framed = (() => { try { return window.top !== window.self; } catch (e) { return true; } })();
export const refereeReady = () => HEX64.test(REFEREE_PUBKEY) && /^https:\/\/[^/]+$/.test(REFEREE_URL);

let pool = null;
const getPool = () => pool || (pool = new SimplePool());

function withTimeout(p, ms, msg = 'Timed out.') {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(t));
}
const store = {
  get() { try { const v = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); return v && HEX64.test(v.pubkey) ? v : null; } catch (e) { return null; } },
  set(v) { try { localStorage.setItem(STORE_KEY, JSON.stringify({ method: v.method, pubkey: v.pubkey })); } catch (e) {} },
  clear() { try { localStorage.removeItem(STORE_KEY); } catch (e) {} },
};

// ---------- signer state ----------
let signer = null; // { method: 'extension' | 'signer', pubkey, sign(template) }
const listeners = new Set();
export const onAuthChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(f => { try { f(signer); } catch (e) {} });
export const currentSigner = () => signer;

export function npub(pk) { try { return nip19.npubEncode(pk); } catch (e) { return ''; } }
export function shortNpub(pk) { const n = npub(pk); return n ? n.slice(0, 10) + '…' + n.slice(-6) : ''; }

// Anything resembling a private key. Checked before any pasted text is used for anything.
export function looksLikeSecret(text) {
  const s = String(text || '').trim();
  return /nsec1[02-9ac-hj-np-z]{20,}/i.test(s) || /ncryptsec1/i.test(s) || /^[0-9a-f]{64}$/i.test(s);
}

// The signer must return exactly what we asked for, signed by the account that signed in.
function checkSigned(ev, t, pk) {
  if (!ev || typeof ev !== 'object') throw new Error('Your signer did not return a signed event.');
  const same = ev.pubkey === pk && ev.kind === t.kind && ev.content === t.content &&
    JSON.stringify(ev.tags) === JSON.stringify(t.tags) && Math.abs(ev.created_at - t.created_at) <= 600;
  if (!same) throw new Error('Your signer signed something different, or with a different account. Sign in again.');
  if (!verifyEvent(ev)) throw new Error('The signature from your signer is not valid.');
  return ev;
}

// ---------- NIP-07 browser extension ----------
export function extensionAvailable() {
  const n = window.nostr;
  return !!(n && typeof n.getPublicKey === 'function' && typeof n.signEvent === 'function');
}
function useExtension(pk) {
  signer = {
    method: 'extension', pubkey: pk,
    async sign(t) {
      if (!extensionAvailable()) throw new Error('Your Nostr extension is not available right now.');
      return checkSigned(await window.nostr.signEvent(t), t, pk);
    },
  };
  store.set(signer); emit();
}
export async function signInWithExtension() {
  if (framed) throw new Error('Open the game in its own tab to sign in.');
  if (!extensionAvailable()) throw new Error('No Nostr extension found in this browser.');
  const pk = await window.nostr.getPublicKey();
  if (!HEX64.test(pk || '')) throw new Error('The extension returned an invalid public key.');
  useExtension(pk);
  return pk;
}

// ---------- NIP-46 signer apps (Nostr Connect) ----------
function useBunker(bs, pk) {
  signer = {
    method: 'signer', pubkey: pk, bunker: bs,
    async sign(t) {
      return checkSigned(await withTimeout(bs.signEvent(t), 120000, 'Your signer app did not respond. Open it and try again.'), t, pk);
    },
  };
  store.set(signer); emit();
}
async function finishBunker(bs) {
  const pk = await withTimeout(bs.getPublicKey(), 60000, 'Your signer app did not share your public key.');
  if (!HEX64.test(pk || '')) throw new Error('Your signer returned an invalid public key.');
  useBunker(bs, pk);
  return pk;
}
const PERMS = ['sign_event:27235', 'sign_event:1'];
const clientMeta = () => ({ name: ARCADE_NAME, url: new URL(HOME_URL).origin });

// Signer-initiated flow: show this URI as a QR code or open it on the phone.
export function startSignerConnect({ onAuthUrl } = {}) {
  if (framed) throw new Error('Open the game in its own tab to sign in.');
  const sessionKey = generateSecretKey(); // throwaway, memory only, never stored
  const secret = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const uri = createNostrConnectURI({ clientPubkey: getPublicKey(sessionKey), relays: CONNECT_RELAYS, secret, perms: PERMS, ...clientMeta() });
  const ac = new AbortController();
  const done = BunkerSigner.fromURI(sessionKey, uri, { pool: getPool(), onauth: safeAuth(onAuthUrl) }, ac.signal).then(finishBunker);
  return { uri, done, cancel: () => ac.abort() };
}

// Paste flow: a bunker:// link copied from the signer app.
export async function connectBunkerLink(text, { onAuthUrl } = {}) {
  if (framed) throw new Error('Open the game in its own tab to sign in.');
  const s = String(text || '').trim();
  if (looksLikeSecret(s)) { const e = new Error('That looks like a private key.'); e.code = 'SECRET'; throw e; }
  if (!/^bunker:\/\//i.test(s)) throw new Error('Paste a link that starts with bunker://');
  const bp = await parseBunkerInput(s);
  if (!bp || !bp.relays.length) throw new Error('That bunker link is not valid.');
  const bs = BunkerSigner.fromBunker(generateSecretKey(), bp, { pool: getPool(), onauth: safeAuth(onAuthUrl) });
  await withTimeout(bs.connect(clientMeta()), 120000, 'Your signer app did not answer.');
  return finishBunker(bs);
}
function safeAuth(cb) {
  return url => { try { const u = new URL(url); if (u.protocol === 'https:' && cb) cb(u.href); } catch (e) {} };
}

export function signOut() {
  try { signer?.bunker?.close(); } catch (e) {}
  signer = null; store.clear(); emit();
}

// Restore an extension sign-in on reload without prompting. Signer-app sessions are not restored:
// their session key lived only in memory, which is the point.
let restored = false;
export function restore() {
  if (restored) return; restored = true;
  const saved = store.get();
  if (!saved || framed) return;
  if (saved.method !== 'extension') { store.clear(); return; }
  let tries = 0;
  const t = setInterval(() => {
    if (extensionAvailable()) { clearInterval(t); useExtension(saved.pubkey); }
    else if (++tries > 20) clearInterval(t);
  }, 150);
}

// ---------- guests ----------
// Players without a Nostr account post verified scores under a nickname. No keys are involved:
// a random guest id stays in this browser and is only ever sent to the referee, which publishes
// a one-way hash of it so nobody else can overwrite a guest's score.
const GUEST_KEY = 'arcade.guest';
export function guest() {
  let g = null;
  try { g = JSON.parse(localStorage.getItem(GUEST_KEY) || 'null'); } catch (e) {}
  if (!g || !HEX32.test(g.id)) {
    g = { id: bytesToHex(crypto.getRandomValues(new Uint8Array(16))), name: '' };
    try { localStorage.setItem(GUEST_KEY, JSON.stringify(g)); } catch (e) {}
  }
  return { id: g.id, name: typeof g.name === 'string' ? g.name : '' };
}
export function setGuestName(name) {
  const g = guest();
  try { localStorage.setItem(GUEST_KEY, JSON.stringify({ id: g.id, name })); } catch (e) {}
}
export const guestTag = id => bytesToHex(sha256(new TextEncoder().encode('arcade-guest:' + id))).slice(0, 32);
export { checkName };

// ---------- profiles ----------
const profiles = new Map();
const clean = s => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '').trim().slice(0, 40) : '');
function parseProfile(e) {
  let o = {};
  try { o = JSON.parse(e && e.content || '{}') || {}; } catch (err) {}
  const name = clean(o.display_name) || clean(o.name);
  let picture = '';
  if (typeof o.picture === 'string' && o.picture.length < 1000) {
    try { const u = new URL(o.picture); if (u.protocol === 'https:') picture = u.href; } catch (err) {}
  }
  return { name, picture };
}
export async function fetchProfiles(pks) {
  const need = [...new Set(pks)].filter(p => HEX64.test(p) && !profiles.has(p)).slice(0, 150);
  if (need.length) {
    const evs = await getPool().querySync(RELAYS, { kinds: [0], authors: need }, { maxWait: 4000 });
    const latest = new Map();
    for (const e of evs) {
      if (!need.includes(e.pubkey) || !verifyEvent(e)) continue;
      const cur = latest.get(e.pubkey);
      if (!cur || e.created_at > cur.created_at) latest.set(e.pubkey, e);
    }
    for (const p of need) profiles.set(p, parseProfile(latest.get(p)));
  }
  return new Map(pks.map(p => [p, profiles.get(p) || { name: '', picture: '' }]));
}

// ---------- verified scores ----------
// Score record (kind 30078, authored by the referee):
//   d = arcade:<game>:<board>:<player>   p = <player>   t = arcade, <game>, <game>-<board>
//   game, board, score, rules, replay, and any number of ["stat", name, value]
export const scoreTag = (game, board) => `${game}-${board}`;
export const scoreD = (game, board, pk) => `arcade:${game}:${board}:${pk}`;
export const guestD = (game, board, tag) => `arcade:${game}:${board}:guest:${tag}`;

// Returns { key, pubkey | null, guest | null, name, score, stats, rules, at } for a valid referee-signed record.
export function parseScore(e, game, board) {
  if (!e || e.kind !== SCORE_KIND || e.pubkey !== REFEREE_PUBKEY || !Array.isArray(e.tags)) return null;
  const tag = k => { const t = e.tags.find(x => Array.isArray(x) && x[0] === k); return t ? t[1] : undefined; };
  if (tag('game') !== game || tag('board') !== board) return null;
  const p = tag('p'), g = tag('guest');
  let who;
  if (HEX64.test(p || '') && tag('d') === scoreD(game, board, p)) who = { key: p, pubkey: p, guest: null, name: '' };
  else if (!p && HEX32.test(g || '') && tag('d') === guestD(game, board, g)) {
    const n = checkName(tag('name'));
    if (!n.ok || n.name !== tag('name')) return null;
    who = { key: 'guest:' + g, pubkey: null, guest: g, name: n.name };
  } else return null;
  const score = /^\d{1,12}$/.test(tag('score') || '') ? Number(tag('score')) : null;
  if (score === null || !verifyEvent(e)) return null;
  const stats = {};
  for (const t of e.tags) if (t[0] === 'stat' && /^[a-z0-9_]{1,24}$/.test(t[1] || '') && /^\d{1,12}$/.test(t[2] || '')) stats[t[1]] = Number(t[2]);
  return { ...who, score, stats, rules: String(tag('rules') || ''), at: e.created_at };
}
export async function fetchBoard(game, board) {
  if (!refereeReady() || !ID.test(game) || !ID.test(board)) return null;
  const evs = await getPool().querySync(RELAYS,
    { kinds: [SCORE_KIND], authors: [REFEREE_PUBKEY], '#t': [scoreTag(game, board)], limit: 500 }, { maxWait: 5000 });
  const best = new Map();
  for (const e of evs) {
    const r = parseScore(e, game, board);
    if (!r) continue;
    const cur = best.get(r.key);
    if (!cur || r.at > cur.at) best.set(r.key, r); // newest verified record per player (replaceable event)
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.at - b.at);
}
// who: { pubkey } for a signed-in player, or { guest: <guest id> } for a guest.
export async function fetchMyBest(game, board, who) {
  if (!refereeReady()) return null;
  const d = who.pubkey ? scoreD(game, board, who.pubkey) : guestD(game, board, guestTag(who.guest));
  const evs = await getPool().querySync(RELAYS, { kinds: [SCORE_KIND], authors: [REFEREE_PUBKEY], '#d': [d] }, { maxWait: 4000 });
  let best = null;
  for (const e of evs) { const r = parseScore(e, game, board); if (r && (!best || r.at > best.at)) best = r; }
  return best;
}
export async function fetchFollows(pk) {
  const evs = await getPool().querySync(RELAYS, { kinds: [3], authors: [pk], limit: 1 }, { maxWait: 4000 });
  let latest = null;
  for (const e of evs) if (e.pubkey === pk && verifyEvent(e) && (!latest || e.created_at > latest.created_at)) latest = e;
  const set = new Set([pk]);
  if (latest) for (const t of latest.tags) if (t[0] === 'p' && HEX64.test(t[1] || '')) set.add(t[1]);
  return set;
}

// ---------- referee ----------
// who: { pubkey } for a signed-in player, or { guest: <guest id> } for a guest.
export async function requestTicket(game, board, who) {
  if (!refereeReady() || !ID.test(game) || !ID.test(board)) return null;
  const q = new URLSearchParams({ game, board });
  if (who.pubkey && HEX64.test(who.pubkey)) q.set('pubkey', who.pubkey);
  else if (who.guest && HEX32.test(who.guest)) q.set('guest', who.guest);
  else return null;
  const r = await withTimeout(fetch(`${REFEREE_URL}/ticket?${q}`, { cache: 'no-store', credentials: 'omit' }), 8000, 'Referee timed out.');
  if (!r.ok) throw new Error('Referee unavailable.');
  const j = await r.json();
  if (typeof j.ticket !== 'string' || j.ticket.length > 2000 || !/^[0-9a-f]{32}$/.test(j.seed)) throw new Error('Bad ticket.');
  return j;
}

const utf8b64 = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

export async function submitVerified({ game, board, ticket, rules, replay, score }) {
  if (!signer) throw new Error('Sign in first.');
  const url = `${REFEREE_URL}/verify`;
  const body = JSON.stringify({ ticket, rules, replay });
  const payload = bytesToHex(sha256(new TextEncoder().encode(body)));
  // NIP-98 HTTP auth: proves to the referee that this run belongs to you. Never published.
  const auth = await signer.sign({ kind: 27235, created_at: now(), tags: [['u', url], ['method', 'POST'], ['payload', payload]], content: '' });
  const res = await withTimeout(fetch(url, {
    method: 'POST', credentials: 'omit', cache: 'no-store', body,
    headers: { 'Content-Type': 'application/json', Authorization: 'Nostr ' + utf8b64(JSON.stringify(auth)) },
  }), 20000, 'The referee took too long.');
  let j = {};
  try { j = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error.slice(0, 160) : 'The referee could not verify this run.');
  const r = parseScore(j.event, game, board);
  if (!r || r.pubkey !== signer.pubkey || r.score !== score) throw new Error('The referee sent back an unexpected result.');
  const relays = await publish(j.event);
  return { relays, record: r };
}

// Guests: no signature needed. The ticket (bound to the guest id) and the replay prove the run.
export async function submitGuest({ game, board, ticket, rules, replay, score, name, guestId }) {
  const n = checkName(name);
  if (!n.ok) throw new Error(n.error);
  const res = await withTimeout(fetch(`${REFEREE_URL}/verify`, {
    method: 'POST', credentials: 'omit', cache: 'no-store',
    body: JSON.stringify({ ticket, rules, replay, name: n.name }), headers: { 'Content-Type': 'application/json' },
  }), 20000, 'The referee took too long.');
  let j = {};
  try { j = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error.slice(0, 160) : 'The referee could not verify this run.');
  const r = parseScore(j.event, game, board);
  if (!r || r.guest !== guestTag(guestId) || r.name !== n.name || r.score !== score) throw new Error('The referee sent back an unexpected result.');
  const relays = await publish(j.event);
  return { relays, record: r };
}

async function publish(ev) {
  const results = await Promise.allSettled(getPool().publish(RELAYS, ev).map(p => withTimeout(p, 8000)));
  return results.filter(x => x.status === 'fulfilled').length;
}

// ---------- sharing ----------
export async function postNote(text, { game, url } = {}) {
  if (!signer) throw new Error('Sign in first.');
  const tags = [['t', 'arcade']];
  if (game && ID.test(game)) tags.push(['t', game]);
  if (url) tags.push(['r', url]);
  const ev = await signer.sign({ kind: 1, created_at: now(), tags, content: String(text).slice(0, 2000) });
  return publish(ev);
}
