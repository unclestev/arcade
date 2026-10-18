// UncleStev Arcade hub: game list, shared sign-in and every game's leaderboard.
import { GAMES } from '../games.js';
import { createHub, nostr as N } from '../kit/arcade.js';
import { REFEREE_PUBKEY } from '../kit/config.js';

const $ = id => document.getElementById(id);
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

const hub = createHub();
hub.bindAccountButton($('btnAcct'), $('acctName'));

const list = $('cabinets');
function cabinet(id, { title, path, cover, blurb, chips, board, edition }) {
  const screen = h('div', { class: 'screen' });
  if (cover) screen.append(h('img', { src: cover, alt: `${title} gameplay`, loading: 'lazy' }));
  return h('article', { class: edition ? 'cab edition' : 'cab' }, screen,
    h('div', { class: 'body' },
      h('h3', { text: title.toUpperCase() }),
      h('p', { text: blurb }),
      chips.length ? h('div', { class: 'chips' }, chips.map(c => h('span', { text: c }))) : null,
      h('div', { class: 'actions' },
        h('a', { class: 'btn play', href: path, text: 'PLAY' }),
        h('button', { class: 'btn', onclick: () => hub.openSheet('board', id, board) }, 'SCORES'))));
}
for (const [id, g] of Object.entries(GAMES)) {
  const main = g.boards.filter(b => !(g.editions || []).some(e => e.board === b.id));
  list.append(cabinet(id, { ...g, chips: main.map(b => b.label), board: main[0].id }));
  for (const e of g.editions || []) list.append(cabinet(id, { ...e, chips: ['Special edition'], edition: true }));
}
list.append(h('article', { class: 'cab soon', 'aria-label': 'Next game in development' },
  h('div', { class: 'screen', text: 'IN THE WORKSHOP' }),
  h('div', { class: 'body' }, h('h3', { text: 'NEXT GAME' }), h('p', { text: 'Another cabinet is on the bench. Same sign-in, same verified leaderboard.' }))));

const ref = $('refLine');
if (N.refereeReady()) {
  ref.textContent = 'Scores are verified and signed by the arcade referee: ';
  ref.append(h('code', { text: N.npub(REFEREE_PUBKEY) }));
} else ref.textContent = 'The verified leaderboard opens once the arcade referee is online.';
