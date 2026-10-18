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
for (const [id, g] of Object.entries(GAMES)) {
  const screen = h('div', { class: 'screen' });
  if (g.cover) screen.append(h('img', { src: g.cover, alt: `${g.title} gameplay`, loading: 'lazy' }));
  list.append(h('article', { class: 'cab' }, screen,
    h('div', { class: 'body' },
      h('h3', { text: g.title.toUpperCase() }),
      h('p', { text: g.blurb }),
      h('div', { class: 'chips' }, g.boards.map(b => h('span', { text: b.label }))),
      h('div', { class: 'actions' },
        h('a', { class: 'btn play', href: g.path, text: 'PLAY' }),
        h('button', { class: 'btn', onclick: () => hub.openSheet('board', id) }, 'SCORES')))));
}
list.append(h('article', { class: 'cab soon', 'aria-label': 'Next game in development' },
  h('div', { class: 'screen', text: 'IN THE WORKSHOP' }),
  h('div', { class: 'body' }, h('h3', { text: 'NEXT GAME' }), h('p', { text: 'Another cabinet is on the bench. Same sign-in, same verified leaderboard.' }))));

const ref = $('refLine');
if (N.refereeReady()) {
  ref.textContent = 'Scores are verified and signed by the arcade referee: ';
  ref.append(h('code', { text: N.npub(REFEREE_PUBKEY) }));
} else ref.textContent = 'The verified leaderboard opens once the arcade referee is online.';
