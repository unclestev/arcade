// UncleStev Arcade settings shared by every game.

export const ARCADE_NAME = 'UncleStev Arcade';
export const HOME_URL = 'https://unclestev.github.io/arcade/';

// Relays used to read and publish scores and profiles.
export const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];

// Relays used only to talk to a signer app over Nostr Connect (NIP-46).
export const CONNECT_RELAYS = ['wss://relay.nsec.app', 'wss://relay.damus.io'];

// The referee replays runs and signs verified scores for every game.
// Fill these in after deploying referee/ (its home page shows both values).
export const REFEREE_URL = '';     // e.g. 'https://arcade-referee.yourname.workers.dev'
export const REFEREE_PUBKEY = '';  // 64-character hex public key of the referee

// Verified scores are NIP-78 app-data events (kind 30078) authored by the referee.
export const SCORE_KIND = 30078;
