// Bomber's referee module: how UncleStev Arcade's referee checks a Bomber run.
// Every game provides one of these; see referee/src/games.js.
import { runReplay, RULES, TICK } from './js/sim.js';
import { decodeReplay } from './js/replay.js';

export default {
  id: 'bomber',
  title: 'Bomber',
  rules: RULES,
  boards: { classic: 'Classic', nextgen: 'Next Gen', bitcoin: 'Bitcoin Edition' },
  // `seed` comes from the referee's sealed ticket; the replay must have been played with it.
  async verify({ board, seed, replay }) {
    if (!replay || replay.mode !== board || replay.seed !== seed) throw new Error('This run does not match its ticket.');
    const G = runReplay(await decodeReplay(replay));
    return {
      finished: G.state === 'over',
      score: G.score,
      playMs: G.tick * TICK * 1000,
      stats: board !== 'classic'
        ? { group: G.maxGroup + 1, combo: G.best, caught: G.caught }
        : { group: G.maxGroup + 1, caught: G.caught },
    };
  },
};
