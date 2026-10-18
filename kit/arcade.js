// UncleStev Arcade kit — the part every game uses.
//
//   import { createArcade } from '../kit/arcade.js';
//   const arcade = createArcade('bomber', { rules: RULES, onOpen: pause });
//   arcade.bindAccountButton(button, nameEl);         // header sign-in button
//   arcade.openSheet('board', 'classic');             // leaderboard / account sheet
//   const run = arcade.newRun('classic', seed => ...); // seeded, rankable run; call run.lock() when play starts
//   arcade.showResult(container, { run, score, replay, shareText }); // game-over panel
//
// All UI is built with DOM APIs (no HTML strings), styled by kit/arcade.css and themable with --ax-* variables.

import * as N from './nostr.js';
import { ARCADE_NAME, HOME_URL } from './config.js';
import { GAMES } from '../games.js';
import qrcode from './vendor/qrcode.js';

export { N as nostr };
const fmt = n => Number(n).toLocaleString('en-US');
const seedHex = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');

function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}
function icon(paths) {
  const NS = 'http://www.w3.org/2000/svg', s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
  for (const d of paths) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p); }
  return s;
}
function avatar(url) {
  if (!url) return h('span', { class: 'ax-ph', 'aria-hidden': 'true' });
  const img = h('img', { class: 'ax-ph', alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(avatar('')), { once: true });
  img.src = url;
  return img;
}
function status(el, text, kind) { el.textContent = text || ''; el.className = 'ax-status' + (kind ? ' ' + kind : ''); }

// =====================================================================
// the shared sheet (leaderboard + account) and share confirmation
// =====================================================================
const UI = { built: false, preview: false, games: [], game: null, board: null, scope: 'global', token: 0, connect: null, onClose: null, el: {} };

export const isSheetOpen = () => UI.built && (!UI.el.modal.hidden || !UI.el.share.hidden);

function build() {
  if (UI.built) return;
  UI.built = true;
  const E = UI.el;
  E.title = h('h2', { id: 'axTitle', text: ARCADE_NAME.toUpperCase() });
  E.close = h('button', { class: 'ax-icon', 'aria-label': 'Close', onclick: close }, icon(['M6 6l12 12M18 6L6 18']));
  E.tabBoard = h('button', { role: 'tab', 'aria-selected': 'true', onclick: () => select('board') }, 'LEADERBOARD');
  E.tabAcct = h('button', { role: 'tab', 'aria-selected': 'false', onclick: () => select('acct') }, 'ACCOUNT');
  E.gameSeg = h('div', { class: 'ax-seg', role: 'group', 'aria-label': 'Game' });
  E.boardSeg = h('div', { class: 'ax-seg', role: 'group', 'aria-label': 'Board' });
  E.scopeSeg = h('div', { class: 'ax-seg', role: 'group', 'aria-label': 'Whose scores' });
  E.note = h('p', { class: 'ax-empty' });
  E.list = h('ol', { class: 'ax-lb' });
  E.paneBoard = h('section', { class: 'ax-pane', role: 'tabpanel' },
    h('div', { class: 'ax-controls' }, E.gameSeg, E.boardSeg, E.scopeSeg), E.note, E.list);

  E.extNote = h('span');
  E.ext = h('button', { class: 'ax-opt', onclick: signExt }, h('b', { text: 'BROWSER EXTENSION' }), E.extNote);
  E.connectBtn = h('button', { class: 'ax-opt', onclick: startConnect }, h('b', { text: 'SIGNER APP' }),
    h('span', { text: 'Amber, nsec.app or any Nostr Connect signer. Scan or tap to approve.' }));
  E.qr = h('canvas', { width: '1', height: '1', 'aria-label': 'Nostr Connect QR code' });
  E.connectStatus = h('p', { class: 'ax-status' });
  E.connectBox = h('div', { class: 'ax-qrbox' }, E.qr,
    h('div', { class: 'ax-btnrow' },
      h('button', { class: 'ax-btn', onclick: () => { if (UI.connect) location.href = UI.connect.uri; } }, 'OPEN SIGNER APP'),
      h('button', { class: 'ax-btn', onclick: copyConnect }, 'COPY LINK'),
      h('button', { class: 'ax-btn', onclick: cancelConnect }, 'CANCEL')),
    E.connectStatus);
  E.connectBox.hidden = true;
  E.bunker = h('input', { id: 'axBunker', type: 'text', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'bunker://…' });
  E.bunker.addEventListener('input', guardSecret);
  E.bunker.addEventListener('paste', () => setTimeout(guardSecret, 0));
  E.warn = h('p', { class: 'ax-callout warn', text: 'That looks like a private key. Never paste it into a website, including this one. It was not stored or sent anywhere; the box has been cleared.' });
  E.warn.hidden = true;
  E.signStatus = h('p', { class: 'ax-status' });
  E.out = h('div', { class: 'ax-stack' },
    h('p', { class: 'ax-callout', text: 'The arcade never asks for, sees or stores your private key. Your browser extension or signer app keeps it and asks you before anything is signed.' }),
    E.ext, E.connectBtn, E.connectBox,
    h('label', { class: 'ax-label', for: 'axBunker' }, 'Or paste a bunker:// link from your signer',
      h('span', { class: 'ax-field' }, E.bunker, h('button', { class: 'ax-btn', onclick: connectBunker }, 'CONNECT'))),
    E.warn, E.signStatus);
  E.meImg = h('img', { alt: '', referrerpolicy: 'no-referrer' }); E.meImg.hidden = true;
  E.meImg.addEventListener('error', () => { E.meImg.hidden = true; });
  E.meName = h('div', { class: 'ax-nm' }); E.meNpub = h('div', { class: 'ax-mono' }); E.meMethod = h('p', { class: 'ax-note' });
  E.in = h('div', { class: 'ax-stack' },
    h('div', { class: 'ax-profile' }, E.meImg, h('div', {}, E.meName, E.meNpub)), E.meMethod,
    h('button', { class: 'ax-btn', onclick: () => { N.signOut(); renderAccount(); } }, 'SIGN OUT'));
  E.paneAcct = h('section', { class: 'ax-pane', role: 'tabpanel' }, E.out, E.in);
  E.paneAcct.hidden = true;

  E.modal = h('div', { class: 'ax-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'axTitle' },
    h('div', { class: 'ax-sheet' }, h('div', { class: 'ax-head' }, E.title, E.close),
      h('div', { class: 'ax-tabs', role: 'tablist' }, E.tabBoard, E.tabAcct), E.paneBoard, E.paneAcct));
  E.modal.hidden = true;
  E.modal.addEventListener('click', e => { if (e.target === E.modal) close(); });

  E.sharePreview = h('p', { class: 'ax-preview' });
  E.shareGo = h('button', { class: 'ax-btn primary' }, 'POST');
  E.share = h('div', { class: 'ax-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'axShareTitle' },
    h('div', { class: 'ax-sheet' }, h('div', { class: 'ax-head' }, h('h2', { id: 'axShareTitle', text: 'POST TO NOSTR?' })),
      h('p', { class: 'ax-note', text: 'This public note will be signed by your signer and posted to your relays:' }), E.sharePreview,
      h('div', { class: 'ax-btnrow' }, E.shareGo, h('button', { class: 'ax-btn', onclick: () => { E.share.hidden = true; } }, 'CANCEL'))));
  E.share.hidden = true;

  document.body.append(E.modal, E.share);
  N.onAuthChange(() => { if (!E.modal.hidden) { if (E.paneAcct.hidden) loadBoard(); else renderAccount(); } });
  // While a sheet is open it owns the keyboard: Escape closes it, and games don't see key presses.
  window.addEventListener('keydown', e => {
    if (!isSheetOpen()) return;
    if (e.key === 'Escape') { if (!E.share.hidden) E.share.hidden = true; else close(); }
    e.stopImmediatePropagation();
  }, true);
}

function open({ games, game, board, tab = 'board', onOpen, onClose }) {
  build();
  UI.games = games; UI.game = game; UI.board = board; UI.onClose = onClose;
  if (onOpen) onOpen();
  UI.el.modal.hidden = false;
  select(tab);
  UI.el.close.focus();
}
function close() {
  if (!UI.built) return;
  UI.el.modal.hidden = true; cancelConnect();
  const cb = UI.onClose; UI.onClose = null; if (cb) cb();
}
function select(tab) {
  const E = UI.el, board = tab === 'board';
  E.tabBoard.setAttribute('aria-selected', String(board)); E.tabAcct.setAttribute('aria-selected', String(!board));
  E.paneBoard.hidden = !board; E.paneAcct.hidden = board;
  if (board) loadBoard(); else renderAccount();
}
function seg(el, items, current, pick) {
  el.textContent = '';
  el.hidden = items.length < 2;
  for (const [id, label] of items) el.append(h('button', { 'aria-pressed': String(id === current), onclick: () => pick(id) }, label));
}

async function loadBoard() {
  const E = UI.el, token = ++UI.token, cfg = GAMES[UI.game];
  if (!cfg.boards.some(b => b.id === UI.board)) UI.board = cfg.boards[0].id;
  seg(E.gameSeg, UI.games.map(g => [g, GAMES[g].title]), UI.game, g => { UI.game = g; UI.board = GAMES[g].boards[0].id; loadBoard(); });
  seg(E.boardSeg, cfg.boards.map(b => [b.id, b.label]), UI.board, b => { UI.board = b; loadBoard(); });
  seg(E.scopeSeg, [['global', 'Everyone'], ['follows', 'People I follow']], UI.scope, s => { UI.scope = s; loadBoard(); });
  E.list.textContent = '';
  if (UI.preview) {
    E.note.textContent = 'The verified leaderboard and Nostr sign-in run on the full site: ';
    E.note.append(h('a', { href: HOME_URL, target: '_blank', rel: 'noopener', text: HOME_URL.replace(/^https:\/\//, '') }));
    return;
  }
  if (!N.refereeReady()) { E.note.textContent = `The verified leaderboard opens once the ${ARCADE_NAME} referee is set up.`; return; }
  const me = N.currentSigner();
  if (UI.scope === 'follows' && !me) { E.note.textContent = 'Sign in to see scores from people you follow.'; return; }
  E.note.textContent = 'Loading verified scores…';
  try {
    const game = UI.game, board = UI.board;
    let rows = await N.fetchBoard(game, board);
    if (token !== UI.token) return;
    if (UI.scope === 'follows') { const f = await N.fetchFollows(me.pubkey); if (token !== UI.token) return; rows = rows.filter(r => f.has(r.pubkey)); }
    rows = rows.slice(0, 100);
    if (!rows.length) { E.note.textContent = UI.scope === 'follows' ? 'No verified scores from people you follow yet.' : 'No verified scores yet. Be the first.'; return; }
    E.note.textContent = 'Every score here was replayed and checked by the arcade referee.';
    const profs = await N.fetchProfiles(rows.slice(0, 50).map(r => r.pubkey)).catch(() => new Map());
    if (token !== UI.token) return;
    const statDefs = (cfg.boards.find(b => b.id === board) || {}).stats || [];
    rows.forEach((r, i) => {
      const p = profs.get(r.pubkey) || {};
      const detail = statDefs.filter(([k]) => r.stats[k] !== undefined).map(([k, label]) => `${label} ${fmt(r.stats[k])}`).join(' · ');
      E.list.append(h('li', { class: me && r.pubkey === me.pubkey ? 'me' : null },
        h('span', { class: 'ax-rank', text: String(i + 1) }), avatar(p.picture),
        h('span', { class: 'ax-name' }, p.name || N.shortNpub(r.pubkey), detail ? h('small', { text: detail }) : null),
        h('span', { class: 'ax-pts', text: fmt(r.score) })));
    });
  } catch (e) { if (token === UI.token) E.note.textContent = 'Could not reach the relays. Check your connection and try again.'; }
}

async function renderAccount() {
  const E = UI.el, me = N.currentSigner();
  E.out.hidden = !!me; E.in.hidden = !me;
  if (!me) {
    const ext = N.extensionAvailable();
    E.ext.disabled = !ext;
    E.extNote.textContent = ext ? 'Use the Nostr extension in this browser.' : 'No extension found here. Desktop: Alby or nos2x. iPhone: install Nostash and turn it on in Safari.';
    return;
  }
  E.meName.textContent = N.shortNpub(me.pubkey); E.meNpub.textContent = N.npub(me.pubkey);
  E.meMethod.textContent = me.method === 'extension' ? 'Signed in with your browser extension.' : 'Signed in with your signer app for this visit. The arcade keeps no keys, so you will reconnect next time.';
  E.meImg.hidden = true;
  const profs = await N.fetchProfiles([me.pubkey]).catch(() => null);
  const p = profs && profs.get(me.pubkey);
  if (p && N.currentSigner() === me) {
    if (p.name) E.meName.textContent = p.name;
    if (p.picture) { E.meImg.src = p.picture; E.meImg.hidden = false; }
  }
}

// --- sign-in actions ---
async function signExt() {
  status(UI.el.signStatus, 'Approve the request in your extension…');
  try { await N.signInWithExtension(); status(UI.el.signStatus, ''); }
  catch (e) { status(UI.el.signStatus, e.message || 'Sign-in was cancelled.', 'bad'); }
}
function drawQR(text) {
  const q = qrcode(0, 'L'); q.addData(text); q.make();
  const n = q.getModuleCount(), m = 4, cells = n + m * 2, scale = Math.max(2, Math.floor(440 / cells));
  const cv = UI.el.qr; cv.width = cv.height = cells * scale;
  const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height); c.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (q.isDark(r, col)) c.fillRect((col + m) * scale, (r + m) * scale, scale, scale);
}
function cancelConnect() { if (UI.connect) { UI.connect.cancel(); UI.connect = null; } if (UI.built) UI.el.connectBox.hidden = true; }
function startConnect() {
  const E = UI.el;
  cancelConnect();
  let sess;
  try { sess = N.startSignerConnect({ onAuthUrl: url => { status(E.connectStatus, 'Your signer needs approval. Opening it…'); window.open(url, '_blank', 'noopener'); } }); }
  catch (e) { status(E.signStatus, e.message, 'bad'); return; }
  UI.connect = sess;
  drawQR(sess.uri); E.connectBox.hidden = false;
  status(E.connectStatus, 'Scan with your signer app, or tap Open on this phone. Then approve.');
  sess.done.then(() => { if (UI.connect === sess) { UI.connect = null; E.connectBox.hidden = true; } })
    .catch(e => { if (UI.connect === sess) status(E.connectStatus, /abort/i.test(e && e.message || '') ? 'Cancelled.' : (e.message || 'Connection failed.'), 'bad'); });
}
async function copyConnect() {
  if (!UI.connect) return;
  try { await navigator.clipboard.writeText(UI.connect.uri); status(UI.el.connectStatus, 'Link copied. Paste it into your signer app.'); }
  catch (e) { status(UI.el.connectStatus, 'Could not copy. Scan the code instead.', 'bad'); }
}
function guardSecret() {
  const E = UI.el;
  if (N.looksLikeSecret(E.bunker.value)) { E.bunker.value = ''; E.warn.hidden = false; return true; }
  return false;
}
async function connectBunker() {
  const E = UI.el;
  if (guardSecret()) return;
  E.warn.hidden = true;
  status(E.signStatus, 'Connecting to your signer… approve it in the app.');
  try { await N.connectBunkerLink(E.bunker.value, { onAuthUrl: url => window.open(url, '_blank', 'noopener') }); E.bunker.value = ''; status(E.signStatus, ''); }
  catch (e) { if (e.code === 'SECRET') { E.bunker.value = ''; E.warn.hidden = false; status(E.signStatus, ''); } else status(E.signStatus, e.message || 'Could not connect.', 'bad'); }
}

function confirmShare(text) {
  build();
  const E = UI.el;
  E.sharePreview.textContent = text;
  E.share.hidden = false;
  return new Promise(resolve => {
    const done = ok => { E.share.hidden = true; E.shareGo.removeEventListener('click', yes); E.share.removeEventListener('click', bg); obs.disconnect(); resolve(ok); };
    const yes = () => done(true);
    const bg = e => { if (e.target === E.share) done(false); };
    const obs = new MutationObserver(() => { if (E.share.hidden) done(false); });
    E.shareGo.addEventListener('click', yes); E.share.addEventListener('click', bg);
    obs.observe(E.share, { attributes: true, attributeFilter: ['hidden'] });
    E.shareGo.focus();
  });
}

// =====================================================================
// account button (header)
// =====================================================================
function bindAccountButton(btn, nameEl, openFn) {
  if (UI.preview || N.framed) { btn.hidden = true; return; }
  const ico = btn.querySelector('svg');
  const render = () => {
    const me = N.currentSigner();
    btn.querySelectorAll('img.ax-avatar').forEach(i => i.remove());
    if (ico) ico.style.display = '';
    if (!me) { nameEl.textContent = 'Sign in'; return; }
    nameEl.textContent = N.shortNpub(me.pubkey);
    N.fetchProfiles([me.pubkey]).then(m => {
      const p = m.get(me.pubkey); if (N.currentSigner() !== me) return;
      if (p.name) nameEl.textContent = p.name;
      if (p.picture) {
        const img = h('img', { class: 'ax-avatar', alt: '', referrerpolicy: 'no-referrer' });
        img.addEventListener('error', () => { img.remove(); if (ico) ico.style.display = ''; }, { once: true });
        img.src = p.picture; if (ico) ico.style.display = 'none'; btn.prepend(img);
      }
    }).catch(() => {});
  };
  N.onAuthChange(render); render();
  btn.addEventListener('click', () => openFn(N.currentSigner() ? 'board' : 'acct'));
}

// =====================================================================
// per-game API
// =====================================================================
export function createArcade(gameId, { rules, preview = false, onOpen, onClose } = {}) {
  const cfg = GAMES[gameId];
  if (!cfg) throw new Error('Unknown game: ' + gameId);
  if (preview) UI.preview = true;
  const enabled = !preview && !N.framed;
  if (enabled) N.restore();
  const gameUrl = new URL(cfg.path, HOME_URL).href;
  let active = null;   // the run currently being played
  let result = null;   // the game-over panel currently shown

  function tryTicket() {
    const run = active, me = N.currentSigner();
    if (!enabled || !run || run.ticket || run.locked || run.pending || !me || !N.refereeReady()) return;
    run.pending = true;
    N.requestTicket(gameId, run.board, me.pubkey)
      .then(t => {
        if (!t || active !== run || run.locked) return;
        if (run.accept(t.seed)) Object.assign(run, { seed: t.seed, ticket: t.ticket, pubkey: me.pubkey, ranked: true });
      })
      .catch(() => {})
      .finally(() => { run.pending = false; });
  }

  function renderResult() {
    if (!result || !result.container.isConnected) return;
    const { container, run, score } = result, token = ++result.token;
    container.textContent = '';
    if (!enabled) { container.hidden = true; return; }
    container.hidden = false;
    const st = h('p', { class: 'ax-status' });
    const post = h('button', { class: 'ax-btn primary' }, 'POST VERIFIED SCORE');
    const share = h('button', { class: 'ax-btn' }, 'SHARE ON NOSTR');
    const sign = h('button', { class: 'ax-btn', onclick: () => api.openSheet('acct', run.board) }, 'SIGN IN WITH NOSTR');
    post.hidden = true;
    container.append(st, h('div', { class: 'ax-btnrow' }, post, share, sign));
    const me = N.currentSigner();
    sign.hidden = !!me; share.hidden = !me;
    share.addEventListener('click', async () => {
      const text = result.shareText(!!run.submitted);
      if (!(await confirmShare(text))) return;
      status(st, 'Approve the note in your signer…');
      try { const n = await N.postNote(text, { game: gameId, url: gameUrl }); status(st, n ? `Shared to ${n} relay${n === 1 ? '' : 's'}.` : 'No relay accepted the note.', n ? 'ok' : 'bad'); }
      catch (e) { status(st, e.message || 'Could not share.', 'bad'); }
    });
    post.addEventListener('click', async () => {
      post.disabled = true;
      status(st, 'Approve the request in your signer. The referee will replay your run.');
      try {
        const replay = await result.replay();
        const r = await N.submitVerified({ game: gameId, board: run.board, ticket: run.ticket, rules, replay, score });
        run.submitted = true;
        if (result && result.run === run) { post.hidden = true; status(st, r.relays ? `Verified ✓ Posted to ${r.relays} relay${r.relays === 1 ? '' : 's'}.` : 'Verified ✓ but no relay accepted it. Try again later.', r.relays ? 'ok' : 'bad'); }
      } catch (e) { post.disabled = false; status(st, e.message || 'Could not post the score.', 'bad'); }
    });
    if (!me) { status(st, 'Sign in with Nostr to post verified scores and share your run.'); return; }
    if (run.submitted) { status(st, 'Verified and posted.', 'ok'); return; }
    if (!N.refereeReady()) { status(st, `The verified leaderboard opens once the ${ARCADE_NAME} referee is set up.`); return; }
    if (!run.ranked || run.pubkey !== me.pubkey) { status(st, 'This run is unranked: it started before you signed in or while the referee was offline.'); return; }
    if (!(score > 0)) { status(st, 'Score some points to post a run.'); return; }
    status(st, 'Checking your verified best…');
    N.fetchMyBest(gameId, run.board, me.pubkey).then(b => {
      if (!result || token !== result.token) return;
      if (b && b.score >= score) { status(st, `Your verified best is ${fmt(b.score)}. Beat it to post again.`); return; }
      post.hidden = false;
      status(st, b ? `New personal best! Your previous verified score was ${fmt(b.score)}.` : 'Post this score to the verified leaderboard.');
    }).catch(() => { if (result && token === result.token) { post.hidden = false; status(st, 'Post this score to the verified leaderboard.'); } });
  }

  N.onAuthChange(() => { tryTicket(); renderResult(); });

  const api = {
    game: gameId, config: cfg, enabled, gameUrl,
    isSheetOpen,
    openSheet(tab = 'board', board) {
      open({ games: [gameId], game: gameId, board: board || cfg.boards[0].id, tab, onOpen, onClose });
    },
    bindAccountButton(btn, nameEl) { bindAccountButton(btn, nameEl, tab => api.openSheet(tab)); },
    // Start a run. `accept(seed)` is called if the referee's seed arrives before play starts;
    // return true after restarting the game with that seed. Call run.lock() when play begins.
    newRun(board, accept) {
      result = null;
      const run = { game: gameId, board, seed: seedHex(), ticket: null, pubkey: null, ranked: false, locked: false, submitted: false,
        accept, lock() { this.locked = true; } };
      active = run;
      tryTicket();
      return run;
    },
    // Game-over panel: posting a verified score, sharing, or signing in.
    showResult(container, { run, score, replay, shareText }) {
      result = { container, run, score, replay, shareText, token: 0 };
      renderResult();
    },
  };
  return api;
}

// For the hub page: one sheet covering every game.
export function createHub({ onOpen } = {}) {
  if (!N.framed) N.restore();
  const ids = Object.keys(GAMES);
  const openSheet = (tab = 'board', game = ids[0], board) =>
    open({ games: ids, game, board: board || GAMES[game].boards[0].id, tab, onOpen });
  return { openSheet, bindAccountButton: (btn, nameEl) => bindAccountButton(btn, nameEl, tab => openSheet(tab)) };
}
