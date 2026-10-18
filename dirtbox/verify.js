// Dirtbox Rally's referee module: how UncleStev Arcade's referee checks a Dirtbox Rally run.
import { runReplay, RULES, TICK } from './js/sim.js';
import { decodeReplay } from './js/replay.js';

export default {
  id: 'dirtbox',
  title: 'Dirtbox Rally',
  rules: RULES,
  boards: { classic: 'Classic' },
  // `seed` comes from the referee's sealed ticket; the replay must have been played with it.
  async verify({ board, seed, replay }) {
    if (!replay || replay.board !== board || replay.seed !== seed) throw new Error('This run does not match its ticket.');
    const G = runReplay(await decodeReplay(replay));
    return {
      finished: G.state === 'over',
      score: G.score,
      playMs: G.tick * TICK * 1000,
      stats: { race: G.raceNo + 1, wins: G.wins },
    };
  },
};
