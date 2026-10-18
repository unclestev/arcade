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
- `RUNS` (KV binding, in `wrangler.toml`): the free Workers KV store `arcade-runs`, which holds pending runs for games verified later.
- `VERIFIER_TOKEN` (secret): a random value shared with the verifier job. Add the same value as a GitHub Actions repository secret named `VERIFIER_TOKEN`.

## Endpoints

| | |
|---|---|
| `GET /` | Setup page (public key once configured) |
| `GET /games` | Games, boards and rules versions the referee knows |
| `GET /ticket?game=&board=&pubkey=` | Sealed seed for a signed-in player's run |
| `GET /ticket?game=&board=&guest=` | Sealed seed for a guest's run (32-hex guest id) |
| `POST /verify` | Players: `{ ticket, rules, replay, score, stats }` with a NIP-98 `Authorization: Nostr …` header. Guests: the same plus `name`. Returns the signed score event (`pending: true` for games verified later). `score` and `stats` are only read for those games |
| `GET /pending?limit=` | Verifier job only (`Authorization: Bearer <VERIFIER_TOKEN>`): pending runs with their replays |
| `POST /resolve` | Verifier job only: `{ run, ok, score, stats, reason }`. Returns the signed verified score (if the replay checked out) and a record that closes the pending one |

## CPU limits

Verifying a run replays every frame. Cloudflare's free plan allows 10 ms of CPU per request. Short and medium games fit; very long games (or the first request after the Worker wakes up) can exceed it, and the player sees an error. If that happens often, move the Worker to a paid plan, which allows much more CPU time per request.

## Games verified later (Dirtbox Rally)

A Dirtbox Rally replay runs four trucks with physics and AI at 60 Hz, about 5 µs per frame: roughly 120 ms for a 7-minute run, far over the free plan's 10 ms. So games whose verify module sets `deferred: true` are checked in two steps:

1. **At post time** the referee runs the game's `quickCheck` (a few ms): the ticket matches, every race has a possible length, the claimed score and stats agree with each other and with how long the run took, and the run isn't faster than real time. It stores the replay in the `RUNS` KV store and signs a **pending** record (its own `d` tag, so it never replaces a player's verified best). Leaderboards show it marked PENDING.
2. **Every 5 minutes** the GitHub Actions workflow `.github/workflows/verify-runs.yml` runs `tools/verify-pending.mjs`. It fetches pending runs from `/pending`, replays each with the game's own `verify`, and reports to `/resolve`. The referee signs the verified score (only if the replay scores exactly what was claimed; leaderboards then hide the pending record, which has the same score) or, for a run that fails, a record that closes the pending one as rejected. The job publishes it. A verified score only replaces the player's record if it beats it.

The job never sees the referee key; it authenticates with `VERIFIER_TOKEN`. Pending runs expire from KV after 14 days, and leaderboards stop showing a pending score after 3 days. To run the job by hand: GitHub → Actions → **Verify pending runs** → **Run workflow**, or locally `VERIFIER_TOKEN=… node tools/verify-pending.mjs` (add `--dry-run` to replay without resolving).

GitHub pauses scheduled workflows after 60 days without commits to the repo; if that happens, open the workflow and click **Enable workflow**. Scheduled runs can also start a few minutes late when GitHub is busy.

If the `RUNS` binding is missing, deferred games fall back to a full replay at post time (which needs the Workers paid plan). Moving to the paid plan later is optional: remove `deferred: true` from `dirtbox/verify.js` to verify instantly again.

## Updating games

The referee bundles each game's rules from the repo. If you connected the repo, Cloudflare redeploys on every push, so site and referee stay in step. When a game's `RULES` version changes, runs recorded under the old rules get a clear "reload to play the new version" message.
