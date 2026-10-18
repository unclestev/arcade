# Security

The most important rule in UncleStev Arcade: **a player's Nostr private key must never be exposed.** This file explains how every game keeps to that, and what each part is trusted to do. The rules are enforced in one place, `kit/nostr.js`, which every game uses.

## Players' keys

- **The arcade never handles private keys.** There is no field for an `nsec`, no "create account" key generator and no key import. All signing happens inside a NIP-07 browser extension or a NIP-46 signer app, which keep the key and ask the player before signing.
- **Paste guard.** If anything that looks like a private key (`nsec1…`, `ncryptsec1…`, or 64 hex characters) is typed or pasted into the only text box the arcade has (the `bunker://` field), it is cleared immediately, a warning is shown, and it is never stored or sent.
- **Narrow requests.** Games only ask signers to sign:
  - kind **27235** (NIP-98 HTTP auth) to prove to the referee that a run is yours. Bound to the exact URL, method and body hash; valid for two minutes; never published.
  - kind **1** only when you tap Share, after showing you the exact text.
  Signer-app connections request only `sign_event:27235,sign_event:1`.
- **Checked results.** Every event a signer returns is checked before use: valid signature, the signed-in pubkey, and exactly the kind, tags and content the game asked for.
- **Session keys.** Nostr Connect needs a throwaway session key for the encrypted channel to the signer app. The arcade creates it in memory for that visit only and never writes it to storage. It cannot sign as you, and it is gone when you reload.
- **What is stored.** `localStorage` holds settings, local high scores, `arcade.nostr = { method, pubkey }` (public information), and for guests `arcade.guest = { id, name }`.

## Guests

- Guests have no keys at all. Their browser keeps a random guest id (not a key: it can't sign anything). Tickets for a guest run are bound to that id.
- Guest scores need no signature: the sealed ticket plus a replay the referee can verify is the proof. The referee publishes the score with the nickname and a one-way hash of the guest id, so nobody else learns the id or can overwrite that guest's score.
- Nicknames are checked by the referee (`kit/names.js`): 2–16 letters, numbers, spaces, dots, dashes or underscores; hidden and direction-changing characters removed; a short list of slurs and obscenities blocked. Nicknames aren't unique, and the leaderboard labels guests clearly so they can't pass as signed-in players.
- The arcade deliberately does **not** create Nostr keys for guests. A key made by a web page would live in the page, where clearing site data loses it and a script injection could steal it. New players who want an account are pointed to dedicated signers instead.

## The pages

- **Strict Content Security Policy** on every page. Only the arcade's own script files can run: no inline scripts, no `eval`, no third-party JavaScript. Trusted Types are enforced, so HTML can't be injected from strings. Network access is limited to Nostr relays (`wss:`) and the referee.
- **No CDN code.** The Nostr library is a pinned, vendored build of nostr-tools v2.25.2 and its audited `@noble`/`@scure` dependencies (`tools/build-vendor.sh` rebuilds it from release tags).
- **Untrusted relay data.** Profile names and pictures are length-limited, stripped of control and direction-override characters, and displayed with `textContent`. Pictures must be `https:` and load with no referrer.
- **Clickjacking guard.** If a game is embedded inside another site, sign-in and signing are disabled.
- **Shared origin.** All games live under `unclestev.github.io`, so they share sign-in state — and would share the impact of a script injection. That is why every page keeps the same strict policy. Never add a page under this site that loads third-party scripts.

## The referee

- One Cloudflare Worker verifies runs for every game. Its Nostr private key exists only in the `REFEREE_SECRET` Worker secret. The setup page shows the public key, never the secret.
- Tickets are sealed with an HMAC derived from that secret, bound to one player, game and board, and expire after six hours. The referee keeps no database, except the pending-run store described below.
- `/verify` requires a valid NIP-98 signature from the ticket's player, checks the game's rules version, replays the full run with that game's own rules, computes the score itself, and signs a kind 30078 event. The score is never taken from the client; for games verified later, the client's claimed score is only signed as verified once the replay reproduces it exactly.
- CORS allows only the origins in `ALLOWED_ORIGINS`.
- Games verified later (Dirtbox Rally): `/verify` runs quick consistency checks, stores the replay in the `RUNS` KV store and signs a separate *pending* record that never replaces a verified score. The GitHub Actions verifier replays the run and calls `/resolve`, authenticated with the `VERIFIER_TOKEN` secret (compared in constant time). It never holds the referee key; the referee only signs a verified score when the replay scores exactly what was claimed. A leaked `VERIFIER_TOKEN` could let someone confirm pending runs without replaying them, so rotate it in both places if that happens.

What the referee can't prevent: a bot or script that genuinely plays the game. Runs must take at least as long as real play.

## If the referee key leaks

Generate a new key on the referee's setup page, replace `REFEREE_SECRET`, and update `REFEREE_PUBKEY` in `kit/config.js`. Scores signed by the old key stop appearing on leaderboards.

## Reporting a problem

Open a GitHub issue without exploit details and ask for a private contact, or message the maintainer on Nostr.
