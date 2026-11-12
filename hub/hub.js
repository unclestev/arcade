// UncleStev Arcade hub: one cabinet per game with an edition picker, a leaderboard preview, and the shared sign-in.
import { GAMES } from '../games.js';
import { createHub, nostr as N } from '../kit/arcade.js';
import { REFEREE_PUBKEY } from '../kit/config.js';

const $ = id => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}
function icon(paths) {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
  for (const d of paths) { const p = document.createElementNS(SVG, 'path'); p.setAttribute('d', d); s.append(p); }
  return s;
}
const fmt = n => Number(n).toLocaleString('en-US');

// What the visitor picked last time (edition per game, leaderboard tab). Only a convenience: the page works without it.
const PREF_KEY = 'arcade.hub';
const prefs = (() => { try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch (e) { return {}; } })();
function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* private window */ } }
if (!prefs.edition || typeof prefs.edition !== 'object') prefs.edition = {};

// A saved or requested edition, else the game's first modern edition (first-time visitors see the newest graphics;
// Classic is one tap away and is remembered once picked).
const boardOf = (g, id) => g.boards.find(b => b.id === id) || g.boards.find(b => b.look === 'modern') || g.boards[0];
const playUrl = (g, b) => `${g.path}?mode=${b.id}`;

const hub = createHub();
hub.bindAccountButton($('btnAcct'), $('acctName'));

// ---------------------------------------------------------------------
// account entry points (header button is bound by the kit; these two mirror it)
// ---------------------------------------------------------------------
const openAccount = () => hub.openSheet('acct');
if (N.framed) { $('tabAcct').hidden = true; $('btnSignin2').closest('.signin-card').hidden = true; }
$('tabAcct').addEventListener('click', openAccount);
$('btnSignin2').addEventListener('click', openAccount);
function renderAuth() {
  const me = N.currentSigner();
  $('tabAcctName').textContent = me ? 'Account' : 'Sign in';
  $('btnSignin2').textContent = me ? 'Account' : 'Sign in';
}
N.onAuthChange(renderAuth); renderAuth();

// ---------------------------------------------------------------------
// cabinets
// ---------------------------------------------------------------------
const CONTROLS = {
  touch: ['Touch', ['M9 11V5.5a1.5 1.5 0 0 1 3 0V11', 'M12 10.5V9a1.5 1.5 0 0 1 3 0v2', 'M15 11v-.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-.5a6 6 0 0 1-4.6-2.2L4 15.3a1.6 1.6 0 0 1 2.4-2L9 15.5V11']],
  keyboard: ['Keyboard', ['M3 7h18v10H3z', 'M7 10.5h.01M10.5 10.5h.01M14 10.5h.01M17.5 10.5h.01M7.5 14h9']],
  mouse: ['Mouse', ['M12 3a5 5 0 0 1 5 5v8a5 5 0 0 1-10 0V8a5 5 0 0 1 5-5z', 'M12 7v3']],
  gamepad: ['Gamepad', ['M7 8h10a4 4 0 0 1 4 4v1.5a3.5 3.5 0 0 1-6.4 2L14 15h-4l-.6.5A3.5 3.5 0 0 1 3 13.5V12a4 4 0 0 1 4-4z', 'M8 11v2.5M6.75 12.25h2.5M16 11.5h.01']],
  wheel: ['G29 wheel', ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z', 'M3.3 10.5l7.3 1M20.7 10.5l-7.3 1M12 13.5V21']],
};

const list = $('cabinets'), jump = $('heroJump');
function cabinet(id, g) {
  let cur = boardOf(g, prefs.edition[id]);
  const shots = new Map(), radios = new Map();
  const tag = h('span', { class: 'screen-tag' });
  const screen = h('a', { class: 'screen' },
    g.boards.map(b => {
      const img = h('img', { class: 'shot', src: b.cover, alt: '', loading: 'lazy', decoding: 'async', 'data-look': b.look });
      shots.set(b.id, img); return img;
    }),
    h('span', { class: 'crt', 'aria-hidden': 'true' }), tag,
    h('span', { class: 'screen-play', 'aria-hidden': 'true' }, icon(['M8 5.5v13l11-6.5z'])));
  const play = h('a', { class: 'btn primary play' });
  const scores = h('button', { class: 'btn scores', type: 'button', onclick: () => hub.openSheet('board', id, cur.id) }, icon(['M6 20V11M12 20V5M18 20v-6']), 'Scores');
  const el = h('article', { class: 'cab', id: `game-${id}` }, screen,
    h('div', { class: 'body' },
      h('p', { class: 'genre', text: g.genre }),
      h('h3', { text: g.title }),
      h('p', { class: 'blurb', text: g.blurb }),
      h('div', { class: 'editions', role: 'radiogroup', 'aria-label': `${g.title} edition` },
        g.boards.map(b => {
          const r = h('button', { class: 'edition', type: 'button', role: 'radio', 'data-look': b.look, onclick: () => pick(b, true) },
            h('b', { text: b.label }), h('small', { text: b.note }));
          r.style.setProperty('--acc', b.accent);
          radios.set(b.id, r); return r;
        })),
      h('ul', { class: 'controls', 'aria-label': 'Works with' },
        g.controls.map(c => h('li', {}, icon(CONTROLS[c][1]), CONTROLS[c][0]))),
      h('div', { class: 'actions' }, play, scores)));

  function pick(b, remember) {
    cur = b;
    el.dataset.look = b.look;
    el.style.setProperty('--acc', b.accent);
    for (const [bid, img] of shots) img.classList.toggle('on', bid === b.id);
    for (const [bid, r] of radios) { const on = bid === b.id; r.setAttribute('aria-checked', String(on)); r.tabIndex = on ? 0 : -1; }
    tag.textContent = b.look === 'legacy' ? `${b.label} · pixel art` : b.label;
    play.href = screen.href = playUrl(g, b);
    play.textContent = `Play ${b.label}`;
    screen.setAttribute('aria-label', `Play ${g.title} ${b.label}`);
    if (remember) { prefs.edition[id] = b.id; savePrefs(); }
  }
  // arrow keys move through the edition picker like a radio group
  el.querySelector('.editions').addEventListener('keydown', e => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const i = (g.boards.indexOf(cur) + d + g.boards.length) % g.boards.length;
    pick(g.boards[i], true); radios.get(g.boards[i].id).focus();
  });
  pick(cur, false);
  return el;
}
for (const [id, g] of Object.entries(GAMES)) {
  list.append(cabinet(id, g));
  jump.append(h('a', { class: 'jump', href: `#game-${id}` }, h('img', { src: boardOf(g).cover, alt: '' }), g.title));
}
list.append(h('p', { class: 'soon', text: 'Another cabinet is on the workbench. Same sign-in, same verified leaderboard.' }));

// ---------------------------------------------------------------------
// leaderboard preview (top five of one board; the kit's sheet has the full list)
// ---------------------------------------------------------------------
const LB = { game: GAMES[prefs.lbGame] ? prefs.lbGame : Object.keys(GAMES)[0], board: prefs.lbBoard, token: 0, loaded: false, visible: false };
function chips(box, items, current, pickFn) {
  box.textContent = '';
  for (const [id, label, accent] of items) {
    const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(id === current), onclick: () => pickFn(id) }, label);
    if (accent) b.style.setProperty('--acc', accent);
    box.append(b);
  }
}
function avatar(url) {
  if (!url) return h('span', { class: 'lb-ph', 'aria-hidden': 'true' });
  const img = h('img', { class: 'lb-ph', alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(avatar('')), { once: true });
  img.src = url;
  return img;
}
function renderBoardPicker() {
  const g = GAMES[LB.game], b = boardOf(g, LB.board);
  LB.board = b.id;
  chips($('lbGames'), Object.entries(GAMES).map(([id, x]) => [id, x.title]), LB.game, id => { LB.game = id; LB.board = null; changed(); });
  chips($('lbBoards'), g.boards.map(x => [x.id, x.label, x.accent]), LB.board, id => { LB.board = id; changed(); });
  $('lb').style.setProperty('--acc', b.accent);
  $('lbPlay').href = playUrl(g, b);
  $('lbPlay').textContent = `Play ${g.title} ${b.label}`;
}
function changed() { prefs.lbGame = LB.game; prefs.lbBoard = LB.board; savePrefs(); renderBoardPicker(); loadBoard(); }
async function loadBoard() {
  const token = ++LB.token, game = LB.game, board = LB.board, note = $('lbNote'), ol = $('lbList');
  ol.textContent = '';
  if (!LB.visible) return;
  LB.loaded = true;
  if (!N.refereeReady()) { note.textContent = 'The verified leaderboard opens once the arcade referee is online.'; return; }
  note.textContent = 'Loading verified scores…';
  try {
    const rows = ((await N.fetchBoard(game, board)) || []).slice(0, 5);
    if (token !== LB.token) return;
    if (!rows.length) { note.textContent = 'No verified scores on this board yet. Be the first.'; return; }
    const profs = await N.fetchProfiles(rows.filter(r => r.pubkey).map(r => r.pubkey)).catch(() => new Map());
    if (token !== LB.token) return;
    note.textContent = '';
    const me = N.currentSigner(), myGuest = N.guestTag(N.guest().id);
    const statDefs = boardOf(GAMES[game], board).stats || [];
    rows.forEach((r, i) => {
      const p = r.pubkey ? (profs.get(r.pubkey) || {}) : {};
      const mine = r.pubkey ? !!(me && r.pubkey === me.pubkey) : r.guest === myGuest;
      const detail = statDefs.filter(([k]) => r.stats[k] !== undefined).map(([k, label]) => `${label} ${fmt(r.stats[k])}`).join(' · ');
      ol.append(h('li', { class: mine ? 'me' : null },
        h('span', { class: 'lb-rank', text: String(i + 1) }), avatar(p.picture),
        h('span', { class: 'lb-who' },
          h('span', { class: 'lb-name', text: r.pubkey ? (p.name || N.shortNpub(r.pubkey)) : r.name }),
          h('small', {},
            r.pending ? h('i', { class: 'pending', text: 'Pending', title: 'Posted; the referee is still replaying this run.' }) : null,
            r.guest ? h('i', { text: 'Guest' }) : null, detail)),
        h('span', { class: 'lb-pts', text: fmt(r.score) })));
    });
  } catch (e) { if (token === LB.token) note.textContent = "Couldn't load the leaderboard. Check your connection and try again."; }
}
$('lbFull').addEventListener('click', () => hub.openSheet('board', LB.game, LB.board));
renderBoardPicker();
// Only talk to the relays once the leaderboard section is on screen.
if ('IntersectionObserver' in window) {
  new IntersectionObserver((es, io) => { if (es.some(e => e.isIntersecting)) { io.disconnect(); LB.visible = true; loadBoard(); } }, { rootMargin: '200px' }).observe($('lb'));
} else { LB.visible = true; loadBoard(); }
N.onAuthChange(() => { if (LB.loaded) loadBoard(); });

// ---------------------------------------------------------------------
// bottom tab bar: highlight the section being read
// ---------------------------------------------------------------------
const tabs = [...document.querySelectorAll('.tabbar a[data-tab]')];
if ('IntersectionObserver' in window) {
  const seen = new Map();
  const io = new IntersectionObserver(es => {
    for (const e of es) seen.set(e.target.id, e.isIntersecting);
    const now = ['games', 'scores', 'how'].find(id => seen.get(id)) || null;
    for (const t of tabs) { if (t.dataset.tab === now) t.setAttribute('aria-current', 'true'); else t.removeAttribute('aria-current'); }
  }, { rootMargin: '-45% 0px -45% 0px' });
  for (const id of ['games', 'scores', 'how']) io.observe($(id));
}

const ref = $('refLine');
if (N.refereeReady()) {
  ref.textContent = 'Scores are verified and signed by the arcade referee: ';
  ref.append(h('code', { text: N.npub(REFEREE_PUBKEY) }));
} else ref.textContent = 'The verified leaderboard opens once the arcade referee is online.';
