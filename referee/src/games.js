// Games the referee can verify. Each module exports:
//   id, title, rules (version string), boards ({ id: label }),
//   async verify({ board, seed, replay }) -> { finished, score, playMs, stats: { name: integer } }
// To add a game, import its verify module here and add it to the list.
import bomber from '../../bomber/verify.js';

export const GAMES = Object.fromEntries([bomber].map(g => [g.id, g]));
