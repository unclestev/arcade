// Guest nickname rules, shared by the games (instant feedback) and the referee (the rule that counts).

export const NAME_MIN = 2;
export const NAME_MAX = 16;

// Matched against a flattened, lower-case form of the name ("Sh1t" -> "shit").
// Kept short on purpose: words that appear inside ordinary names are left out.
const BLOCK = [
  'fuck', 'shit', 'cunt', 'bitch', 'whore', 'slut', 'nigg', 'nigr', 'faggot', 'fagot', 'retard', 'nazi', 'hitler',
  'kike', 'chink', 'spick', 'wetback', 'tranny', 'pussy', 'porn', 'twat', 'wank', 'jizz', 'penis', 'vagina', 'kkk',
];

const flatten = s => s.toLowerCase()
  .replace(/[0@]/g, 'o').replace(/[1!|]/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/[5$]/g, 's').replace(/7/g, 't')
  .replace(/[^a-z]/g, '');

// Returns { ok: true, name } with the cleaned name, or { ok: false, error }.
export function checkName(raw) {
  const s = String(raw || '').normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/\s+/g, ' ').trim();
  if (s.length < NAME_MIN || s.length > NAME_MAX) return { ok: false, error: `Use ${NAME_MIN} to ${NAME_MAX} characters.` };
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(s)) return { ok: false, error: 'Use letters and numbers (spaces, dots, dashes and underscores are fine too).' };
  const flat = flatten(s);
  if (BLOCK.some(w => flat.includes(w))) return { ok: false, error: 'Pick a different nickname.' };
  return { ok: true, name: s };
}
