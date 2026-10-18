// UncleStev Arcade settings shared by every game.

export const ARCADE_NAME = 'UncleStev Arcade';
export const HOME_URL = 'https://unclestev.github.io/arcade/';

// Relays used to read and publish scores and profiles.
export const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];

// Relays used only to talk to a signer app over Nostr Connect (NIP-46).
export const CONNECT_RELAYS = ['wss://relay.nsec.app', 'wss://relay.damus.io'];

// The referee replays runs and signs verified scores for every game.
// Fill these in after deploying referee/ (its home page shows both values).
export const REFEREE_URL = 'https://arcade-referee.sfailla.workers.dev';
export const REFEREE_PUBKEY = '0fb09c0e264209bc978824d4e031e1e09aa780ab356a939ef4d4b06e1afd18b3';

// Verified scores are NIP-78 app-data events (kind 30078) authored by the referee.
export const SCORE_KIND = 30078;
