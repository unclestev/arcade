// Shared namespace for Dirtbox Rally's browser modules (renderer, audio, input, screens).
// The game rules live in sim.js and never touch this.
export const G = {};

// Isometric ground canvas: world (x, y) maps to (x - y + WORLD, (x + y) / 2 + OY).
export const OY = 24;
