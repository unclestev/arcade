# Arcade kit

Shared sign-in, verified scores and leaderboard UI for every UncleStev Arcade game.

| File | What it does |
|---|---|
| `arcade.js` | The API games use, plus the sign-in / leaderboard sheet and the game-over panel |
| `nostr.js` | Sign-in (extensions and signer apps), referee calls, leaderboards, sharing. Holds the key-safety rules |
| `config.js` | Arcade name, relays, referee URL and public key — one place for every game |
| `arcade.css` | Styles for the kit's UI; theme it with the `--ax-*` variables |
| `vendor/` | Pinned nostr-tools subset and qrcode-generator |

## Adding a game

Say the new game is called `rocks`.

### 1. Make the rules deterministic

Put the game rules in a module with no DOM, no clock and no `Math.random`, seeded by a 32-hex-character seed and stepped at a fixed rate. Use only `+ - * /`, comparisons and `Math.abs/min/max/floor/round/imul`: `Math.sin`, `exp` and friends can differ between browsers and would break verification. Bomber's `bomber/js/sim.js` is the model, including its seeded random generator and `runReplay`.

Export a `RULES` version string and bump it whenever a change would alter how a run plays out.

### 2. Record a replay

Record what the player did each step (Bomber stores the bucket position per tick, delta-encoded and compressed in `bomber/js/replay.js`). The replay plus the seed must recreate the whole run.

### 3. Write the referee module — `rocks/verify.js`

```js
import { RULES, runReplay } from './js/sim.js';
export default {
  id: 'rocks', title: 'Rocks', rules: RULES,
  boards: { arcade: 'Arcade' },
  async verify({ board, seed, replay }) {
    // must use `seed` (from the referee's ticket), never a seed from the replay
    const G = runReplay(seed, replay);
    return { finished: G.over, score: G.score, playMs: G.ticks * 1000 / 60, stats: { level: G.level } };
  },
};
```

Register it in `referee/src/games.js`.

### 4. List it in `games.js`

```js
rocks: {
  title: 'Rocks', path: 'rocks/', cover: 'rocks/cover.jpg',
  blurb: 'One line about the game.',
  boards: [{ id: 'arcade', label: 'Arcade', stats: [['level', 'Level']] }],
},
```

A game can also add `editions`: extra cabinets on the hub that open the game with a query string and show one of its boards (see Bomber's Bitcoin Edition). They share the game's sign-in and referee module; give the edition its own board so its scores stay separate.

### 5. Use the kit in the game

In `rocks/index.html`, copy the Content Security Policy from `bomber/index.html`, and load `../kit/arcade.css` before the game's own CSS. Then:

```js
import { createArcade } from '../../kit/arcade.js';
import { RULES } from './sim.js';

const arcade = createArcade('rocks', { rules: RULES, onOpen: pauseGame });
arcade.bindAccountButton(accountButton, accountNameSpan);   // header sign-in button
leaderboardButton.onclick = () => arcade.openSheet('board', 'arcade');

// New game: the kit asks the referee for a seed. If it arrives before play starts, restart with it.
const run = arcade.newRun('arcade', seed => { if (notStartedYet) { game = newGame(seed); return true; } return false; });
game = newGame(run.seed);
// ...when the player actually starts:
run.lock();

// Game over:
arcade.showResult(document.getElementById('resultPanel'), {
  run, score: game.score,
  replay: async () => encodeReplay(...),                    // only built if they post
  shareText: verified => `I scored ${game.score} in Rocks${verified ? ' (verified)' : ''}!`,
});
```

While `arcade.isSheetOpen()` is true, the kit owns the keyboard; pause the game when `onOpen` fires.

The game-over panel has a nickname box for guests, so ignore key presses whose target is an `input` in your game's keyboard handler.

Players who aren't signed in get guest tickets automatically, so every run is ranked as long as the referee is reachable.

### 6. Ship it

Push the repo. Cloudflare redeploys the referee with the new game, and GitHub Pages serves the new folder. Add a test run with the local referee before going live (see `referee/README.md`).
