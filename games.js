// Every game in UncleStev Arcade. The hub page lists these and each game reads its own entry.
// To add a game: add an entry here, a folder with the game, and its verify module in referee/src/games.js.
//
// Each board is one edition of the game with its own leaderboard. The hub shows one cabinet per game with
// an edition picker, and opens the chosen edition at `<path>?mode=<board id>`.
//   look    'legacy' = pixel-art edition: the hub shows it with hard pixels, scanlines and pixel type.
//           'modern' = current-generation edition: smooth art and the hub's modern styling.
//   cover   screenshot of that edition (legacy covers should be pixel-exact PNGs or clean JPEGs)
//   note    a few words under the edition's name in the picker
//   accent  colour used for that edition's glow and buttons
//   stats   extra numbers the leaderboard shows for each score
export const GAMES = {
  bomber: {
    title: 'Bomber',
    path: 'bomber/',
    genre: 'Catch game',
    blurb: "Sparky is tossing lit bombs off the wall. Catch every one in your three water buckets before they hit the street.",
    controls: ['touch', 'keyboard', 'mouse', 'gamepad', 'wheel'],
    boards: [
      { id: 'classic', label: 'Classic', look: 'legacy', note: '1981-style pixels', accent: '#ffb347', cover: 'bomber/cover-classic.png',
        stats: [['group', 'Group']] },
      { id: 'nextgen', label: 'Next Gen', look: 'modern', note: 'Combos and power-ups', accent: '#4fc3ff', cover: 'bomber/cover.jpg',
        stats: [['group', 'Group'], ['combo', 'Combo']] },
      { id: 'bitcoin', label: 'Bitcoin', look: 'modern', note: 'Stack the sats', accent: '#f7931a', cover: 'bomber/cover-bitcoin.jpg',
        stats: [['group', 'Block'], ['combo', 'Combo']] },
    ],
  },
  dirtbox: {
    title: 'Dirtbox Rally',
    path: 'dirtbox/',
    genre: 'Off-road racing',
    blurb: 'Race boxy 4x4s with missiles, bombs, nitro and jumps over the creek. Eight tracks per circuit: finish in the top three or lose a truck.',
    controls: ['touch', 'keyboard', 'gamepad', 'wheel'],
    boards: [
      { id: 'classic', label: 'Classic', look: 'legacy', note: 'Pixel-art isometric', accent: '#ffd55a', cover: 'dirtbox/cover.jpg',
        stats: [['race', 'Race'], ['wins', 'Wins']] },
      { id: 'nextgen', label: 'Next Gen', look: 'modern', note: '3D chase camera', accent: '#6fe08a', cover: 'dirtbox/cover-nextgen.jpg',
        stats: [['race', 'Race'], ['wins', 'Wins']] },
    ],
  },
};
