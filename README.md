# UncleStev Arcade

Browser arcade games with one shared Nostr sign-in and a leaderboard where every score is replayed and verified.

**Play:** https://unclestev.github.io/arcade/

| Game | Boards | Play |
|---|---|---|
| **Bomber** — catch Sparky's falling bombs in three water buckets. Atari-style Classic mode and a modern Next Gen remake. | Classic, Next Gen | [/arcade/bomber/](https://unclestev.github.io/arcade/bomber/) |
| **Bomber: Bitcoin Edition** — Satoshi drops bitcoins off a mining rig; stack them in cold wallets before the price crashes. Next Gen rules with its own look and leaderboard. | Bitcoin | [/arcade/bomber/?mode=bitcoin](https://unclestev.github.io/arcade/bomber/?mode=bitcoin) |
| **Dirtbox Rally** — isometric off-road racing with boxy 4x4s, missiles, bombs, upgrades and jumps over the creek. Eight tracks per circuit; finish in the top three or lose a truck. | Classic | [/arcade/dirtbox/](https://unclestev.github.io/arcade/dirtbox/) |

Every game works with touch, keyboard and mouse; Bomber and Dirtbox Rally also support gamepads and the Logitech G29 wheel (Dirtbox Rally has a wheel setup wizard for steering, pedals and buttons).

## Play as a guest, or sign in once for everything

**No account needed.** Anyone can post a verified score with just a nickname. The referee checks guest runs exactly like everyone else's, and the leaderboard marks them GUEST.

**Signing in** adds your name and picture, keeps your scores with you on any device, and lets you share runs and see scores from people you follow. Sign-in uses Nostr, and the arcade never asks for, sees or stores your private key. Sign in with:

- **A browser extension** (NIP-07): Alby or nos2x on desktop, Nostash in Safari on iPhone/iPad.
- **A signer app** (NIP-46 Nostr Connect): Amber, nsec.app or any Nostr Connect signer. Scan the code or tap to open, then approve. You can also paste a `bunker://` link.

All games share one origin, so an extension sign-in carries across every game and the hub.

New to Nostr? The sign-in screen links to free signers (nsec.app, Nostash, Alby, Amber). The account is created and kept by the signer, never by the arcade.

## How scores are verified

1. When a run starts, the referee hands the game a sealed ticket with a random seed, bound to the player's Nostr account or, for guests, to a random guest id kept in their browser.
2. Games are deterministic: the seed plus the player's inputs recreate the whole run.
3. At game over the player taps **Post** (guests type a nickname first). The referee replays the inputs with the game's own rules, computes the score itself, and signs it with the arcade's Nostr key.
4. Leaderboards only show scores signed by the referee, and check every signature.

Faked scores, edited runs, reused tickets and other players' runs all fail. No web game can stop a bot that genuinely plays well; the referee also rejects runs that finish faster than real time.

### Score records

Verified scores are NIP-78 app-data events (kind 30078) authored by the referee, one per player per board:

```
d      arcade:<game>:<board>:<player pubkey>      (guests: arcade:<game>:<board>:guest:<guest tag>)
p      <player pubkey>                            (guests: guest <tag>, name <nickname>)
t      arcade · <game> · <game>-<board>
game   <game>          board  <board>
score  <integer>       rules  <rules version>
stat   <name> <integer>     (any number, e.g. group, combo)
replay <sha256 of the replay>
```

## Repo layout

```
index.html, hub/      arcade front page
games.js              list of games: title, path, cover, boards, the stats each board shows, and extra edition cabinets
kit/                  shared sign-in, scores and leaderboard UI used by every game (see kit/README.md)
bomber/               Bomber (its rules in bomber/js/sim.js, referee module in bomber/verify.js)
dirtbox/              Dirtbox Rally (its rules in dirtbox/js/sim.js, referee module in dirtbox/verify.js)
referee/              Cloudflare Worker that verifies runs for every game
tools/                build scripts for the vendored Nostr library and single-file previews
```

GitHub Pages serves the files as-is; there is no build step for the site.

**Adding a game:** see [kit/README.md](kit/README.md). **Security design:** [SECURITY.md](SECURITY.md). **Running the referee:** [referee/README.md](referee/README.md).

Bomber is inspired by Kaboom! (Activision, 1981). Not affiliated with or endorsed by Activision.
