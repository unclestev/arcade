# Arcade referee

A Cloudflare Worker that replays finished runs for every game in the arcade and signs verified scores with the arcade's Nostr key.

## Deploy from GitHub (works from a phone)

1. In the Cloudflare dashboard, go to **Workers & Pages → Create → Import a repository**, and pick the `arcade` repo.
2. Set **Root directory** to `referee`. Leave the deploy command as `npx wrangler deploy`. Deploy.
3. Open the Worker's address (`https://arcade-referee.<your-subdomain>.workers.dev`). The setup page shows a freshly generated random key.
4. **Save that key in your password manager.** Cloudflare can't show a secret again after you save it, and this key is the arcade's identity: every verified score is signed with it.
5. In the Worker, go to **Settings → Variables and Secrets → Add**. Choose type **Secret**, name it `REFEREE_SECRET`, paste the key, and save.
6. Reload the Worker's address. It now shows two lines: the referee URL and public key. Put them in `kit/config.js` and push.

## Settings

- `ARCADE_NAME` (in `wrangler.toml`): shown on the setup page and in score events.
- `ALLOWED_ORIGINS` (in `wrangler.toml`): sites allowed to call the referee from a browser. Defaults to `https://unclestev.github.io`.
- `REFEREE_SECRET` (secret): the referee's Nostr private key, 64 hex characters. Never commit it.

## Endpoints

| | |
|---|---|
| `GET /` | Setup page (public key once configured) |
| `GET /games` | Games, boards and rules versions the referee knows |
| `GET /ticket?game=&board=&pubkey=` | Sealed seed for a ranked run |
| `POST /verify` | `{ ticket, rules, replay }` with a NIP-98 `Authorization: Nostr …` header; returns the signed score event |

## CPU limits

Verifying a run replays every frame. Cloudflare's free plan allows 10 ms of CPU per request. Short and medium games fit; very long games (or the first request after the Worker wakes up) can exceed it, and the player sees an error. If that happens often, move the Worker to a paid plan, which allows much more CPU time per request.

## Updating games

The referee bundles each game's rules from the repo. If you connected the repo, Cloudflare redeploys on every push, so site and referee stay in step. When a game's `RULES` version changes, runs recorded under the old rules get a clear "reload to play the new version" message.
