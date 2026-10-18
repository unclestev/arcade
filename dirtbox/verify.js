// Dirtbox Rally's referee module: how UncleStev Arcade's referee checks a Dirtbox Rally run.
//
// A full replay costs far more CPU than Cloudflare's free plan allows per request, so this game is
// verified in two steps (see referee/README.md):
//   quickCheck  runs at post time: cheap consistency checks, then the score is published as PENDING
//   verify      the full replay, run later by the GitHub Actions job in tools/verify-pending.mjs
import { runReplay, RULES, TICK, POINTS, START_LIVES, LETTER_WORD, TRACKS, MAX_TICKS } from './js/sim.js';
import { decodeReplay, replayShape } from './js/replay.js';

const INTRO_TICKS = Math.round((1.7 + 2.4) * 60);
const MIN_LAP_TICKS = 8 * 60;                       // no track can be lapped in under 8 seconds
const MIN_RACE_TICKS = INTRO_TICKS + 3 * MIN_LAP_TICKS;
const MAX_RACE_TICKS = 60 * 420;                    // rivals always finish well before 7 minutes
const MAX_POINTS_PER_SECOND = 700;                  // pickups and hits, far above anything reachable
const int = v => Number.isSafeInteger(v) && v >= 0;

function matchTicket(board, seed, replay) {
  if (!replay || replay.board !== board || replay.seed !== seed) throw new Error('This run does not match its ticket.');
}

export default {
  id: 'dirtbox',
  title: 'Dirtbox Rally',
  rules: RULES,
  boards: { classic: 'Classic' },
  deferred: true,

  // Full check: replay every frame. `seed` comes from the referee's sealed ticket.
  async verify({ board, seed, replay }) {
    matchTicket(board, seed, replay);
    const G = runReplay(await decodeReplay(replay));
    return {
      finished: G.state === 'over',
      score: G.score,
      playMs: G.tick * TICK * 1000,
      stats: { race: G.raceNo + 1, wins: G.wins },
    };
  },

  // Cheap check for posting right away: the replay decodes, every race has a possible length,
  // and the claimed score and stats agree with each other and with how long the run took.
  async quickCheck({ board, seed, replay, claim }) {
    matchTicket(board, seed, replay);
    const r = await replayShape(replay);
    const races = r.segs.length;
    if (!races) throw new Error('This run has no races.');
    let ticks = 0;
    for (const n of r.segs) {
      if (n < MIN_RACE_TICKS || n > MAX_RACE_TICKS) throw new Error('A race in this run has an impossible length.');
      ticks += n;
    }
    const score = claim && claim.score, st = (claim && claim.stats) || {};
    if (!int(score) || !int(st.race) || !int(st.wins) || st.race < 1) throw new Error('The score or stats are missing.');
    const qualified = st.race - 1;                  // races finished in the top 3
    const losses = races - qualified;
    const extraTrucks = Math.floor(races / LETTER_WORD.length); // at most one letter per race
    const hitTimeLimit = ticks >= MAX_TICKS - 1;
    if (qualified > races || st.wins > qualified) throw new Error('The stats do not add up.');
    if (!hitTimeLimit && (losses < START_LIVES || losses > START_LIVES + extraTrucks)) throw new Error('This run is not finished.');
    const minScore = st.wins * POINTS.place[0] + (qualified - st.wins) * POINTS.place[2];
    const circuits = Math.floor(qualified / TRACKS.length);
    const maxScore = races * (POINTS.place[0] + POINTS.letter + 3 * POINTS.upgrade) + extraTrucks * POINTS.word +
      circuits * POINTS.circuit + Math.ceil(ticks / 60) * MAX_POINTS_PER_SECOND;
    if (score < minScore || score > maxScore) throw new Error('The score does not match this run.');
    return { finished: true, score, playMs: ticks * TICK * 1000, stats: { race: st.race, wins: st.wins } };
  },
};
