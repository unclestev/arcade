// Every game in UncleStev Arcade. The hub page lists these and each game reads its own entry.
// To add a game: add an entry here, a folder with the game, and its verify module in referee/src/games.js.
export const GAMES = {
  bomber: {
    title: 'Bomber',
    path: 'bomber/',
    cover: 'bomber/cover.jpg',
    blurb: "Catch Sparky's lit bombs in three water buckets before they hit the street. Atari-style Classic mode and a modern Next Gen remake.",
    boards: [
      { id: 'classic', label: 'Classic', stats: [['group', 'Group']] },
      { id: 'nextgen', label: 'Next Gen', stats: [['group', 'Group'], ['combo', 'Combo']] },
    ],
  },
};
