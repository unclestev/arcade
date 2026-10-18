# UncleStev Arcade

Browser arcade games with one shared Nostr sign-in and a leaderboard where every score is replayed and verified.

**Play:** https://unclestev.github.io/arcade/

| Game | Boards | Play |
|---|---|---|
| **Bomber** — catch Sparky's falling bombs in three water buckets. Atari-style Classic mode and a modern Next Gen remake. | Classic, Next Gen | [/arcade/bomber/](https://unclestev.github.io/arcade/bomber/) |

Every game works with touch, keyboard and mouse; Bomber also supports gamepads and the Logitech G29 wheel.

## Sign in once, play everything

The arcade never asks for, sees or stores your private key. Sign in with:

- **A browser extension** (NIP-07): Alby or nos2x on desktop, Nostash in Safari on iPhone/iPad.
- **A signer app** (NIP-46 Nostr Connect): Amber, nsec.app or any Nostr Connect signer. Scan the code or tap to open, then approve. You can also paste a `bunker://` link.

All games share one origin, so an extension sign-in carries across every game and the hub.

## How scores are verified

1. When a signed-in run starts, the referee hands the game a sealed ticket with a random seed.
2. Games are deterministic: the seed plus the player's inputs recreate the whole run.
3. At game over the player taps **Post verified score**. The referee replays the inputs with the game's own rules, computes the score itself, and signs it with the arcade's Nostr key.
4. Leaderboards only show scores signed by the referee, and check every signature.

Faked scores, edited runs, reused tickets and other players' runs all fail. No web game can stop a bot that genuinely plays well; the referee also rejects runs that finish faster than real time.

### Score records

Verified scores are NIP-78 app-data events (kind 30078) authored by the referee, one per player per board:

```
d      arcade:<game>:<board>:<player pubkey>
p      <player pubkey>
t      arcade · <game> · <game>-<board>
game   <game>          board  <board>
score  <integer>       rules  <rules version>
stat   <name> <integer>     (any number, e.g. group, combo)
replay <sha256 of the replay>
```

## Repo layout

```
index.html, hub/      arcade front page
games.js              list of games: title, path, cover, boards and the stats each board shows
kit/                  shared sign-in, scores and leaderboard UI used by every game (see kit/README.md)
bomber/               Bomber (its rules in bomber/js/sim.js, referee module in bomber/verify.js)
referee/              Cloudflare Worker that verifies runs for every game
tools/                build scripts for the vendored Nostr library and single-file previews
```

GitHub Pages serves the files as-is; there is no build step for the site.

**Adding a game:** see [kit/README.md](kit/README.md). **Security design:** [SECURITY.md](SECURITY.md). **Running the referee:** [referee/README.md](referee/README.md).

Bomber is inspired by Kaboom! (Activision, 1981). Not affiliated with or endorsed by Activision.
