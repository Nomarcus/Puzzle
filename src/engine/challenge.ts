/**
 * Challenges: the same board and the same pieces, sent to somebody else.
 *
 * This is what a deterministic engine is *for*. The whole of a round — the
 * disc, the pack, the ration and the exact sequence of pieces — is a seed and
 * three small numbers, so it fits in a short code that can be typed, texted or
 * pasted. No server, no account, no network call. Your friend plays the round
 * you played, piece for piece, with your score on screen as the target.
 *
 * It is deliberately not a global leaderboard. Being four thousandth on a
 * public board tells a new player nothing; beating the number their friend just
 * sent them is a game. One is infrastructure, the other is a reason to open the
 * app.
 *
 * The deal is fixed rather than adaptive, for the same reason the daily's is:
 * the adaptive deal reads the board, so two people who played differently would
 * be handed different pieces and "the same round" would be a lie.
 */

import { BOT_POLICY_V1, playOut } from "./bot.js";
import { createGame } from "./game.js";
import { hashSeed } from "./rng.js";
import { type PackId, type SizeId, PACKS, SIZES, sizeById } from "./variants.js";

/** Same ration as the daily: a challenge has to be the same length for both. */
export const CHALLENGE_PIECES = 60;

export interface Challenge {
  readonly seed: number;
  readonly size: SizeId;
  readonly pack: PackId;
  /** Pieces each player gets. Carried in the code so old codes keep working. */
  readonly pieces: number;
  /** The challenger's score — the number to beat. 0 for a fresh challenge. */
  readonly score: number;
}

/**
 * Crockford's base32: no I, L, O or U, so nothing reads as a different
 * character in a text message and the set cannot spell anything unfortunate.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Bits per field. 64 of payload plus a 10-bit check, which is 15 characters. */
const BITS = { seed: 32, size: 2, pack: 2, pieces: 8, score: 20 } as const;
const PAYLOAD_BITS = 64;
const CHECK_BITS = 10;
const CODE_LENGTH = Math.ceil((PAYLOAD_BITS + CHECK_BITS) / 5);

/** Highest score a code can carry. Well past what a 60-piece round produces. */
export const MAX_CODE_SCORE = 2 ** BITS.score - 1;

/**
 * Two check characters, so a mistyped code is rejected rather than quietly
 * becoming a different round — which is the worst failure available here: two
 * people would believe they were playing the same puzzle and would not be.
 *
 * This began as a digit sum over the five-bit groups, and the test that feeds
 * it every single-character typo caught it accepting some of them: a digit sum
 * misses a swap between the lowest and highest symbol, and it cannot see two
 * errors that cancel. FNV-1a over the payload bytes mixes properly, and ten
 * bits leaves a one-in-a-thousand chance of a corrupt code slipping through
 * instead of one in thirty.
 */
function checksum(payload: bigint): bigint {
  let hash = 0x811c9dc5;
  let rest = payload;
  for (let i = 0; i < PAYLOAD_BITS / 8; i++) {
    hash ^= Number(rest & 0xffn);
    hash = Math.imul(hash, 0x01000193) >>> 0;
    rest >>= 8n;
  }
  return BigInt(hash & ((1 << CHECK_BITS) - 1));
}

export function encodeChallenge(challenge: Challenge): string {
  const sizeIndex = SIZES.findIndex((size) => size.id === challenge.size);
  const packIndex = PACKS.findIndex((pack) => pack.id === challenge.pack);

  let payload = 0n;
  payload = (payload << BigInt(BITS.seed)) | BigInt(challenge.seed >>> 0);
  payload = (payload << BigInt(BITS.size)) | BigInt(Math.max(0, sizeIndex));
  payload = (payload << BigInt(BITS.pack)) | BigInt(Math.max(0, packIndex));
  payload = (payload << BigInt(BITS.pieces)) | BigInt(Math.min(255, Math.max(0, challenge.pieces)));
  payload =
    (payload << BigInt(BITS.score)) |
    BigInt(Math.min(MAX_CODE_SCORE, Math.max(0, Math.round(challenge.score))));

  const framed = (payload << BigInt(CHECK_BITS)) | checksum(payload);

  let out = "";
  for (let i = CODE_LENGTH - 1; i >= 0; i--) {
    out += ALPHABET[Number((framed >> BigInt(i * 5)) & 31n)];
  }
  return out;
}

/** Groups of five, which is how people read a code aloud without losing place. */
export function formatCode(code: string): string {
  return (code.match(/.{1,5}/g) ?? [code]).join("-");
}

/**
 * Accepts anything a person might paste: spaces, dashes, lower case, a whole
 * share message with the code somewhere in it. Returns null if it is not a
 * valid code, including if it is the right length but fails its check digit.
 */
export function decodeChallenge(input: string): Challenge | null {
  const cleaned = input
    .toUpperCase()
    // The characters Crockford drops, mapped back to what they were meant to be.
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .replace(/[^0-9A-Z]/g, "");

  // A share message carries words around the code, so scan for a run that
  // checksums rather than demanding the code arrive on its own.
  for (let start = 0; start + CODE_LENGTH <= cleaned.length; start++) {
    const found = readCode(cleaned.slice(start, start + CODE_LENGTH));
    if (found) return found;
  }
  return null;
}

function readCode(code: string): Challenge | null {
  if (code.length !== CODE_LENGTH) return null;

  let framed = 0n;
  for (const character of code) {
    const value = ALPHABET.indexOf(character);
    if (value < 0) return null;
    framed = (framed << 5n) | BigInt(value);
  }

  // Fifteen base-32 characters hold 75 bits and only 74 are used, so the top
  // bit of the first character is spare. Left unchecked it is a hole in the
  // checksum: flipping it alone produced a code that read as valid and decoded
  // to exactly the same round, which the typo test caught.
  if (framed >> BigInt(PAYLOAD_BITS + CHECK_BITS) !== 0n) return null;

  const check = framed & ((1n << BigInt(CHECK_BITS)) - 1n);
  const payload = framed >> BigInt(CHECK_BITS);
  if (checksum(payload) !== check) return null;

  const take = (bits: number, from: bigint): [value: number, rest: bigint] => [
    Number(from & ((1n << BigInt(bits)) - 1n)),
    from >> BigInt(bits),
  ];

  let rest = payload;
  let score: number;
  let pieces: number;
  let packIndex: number;
  let sizeIndex: number;
  let seed: number;
  [score, rest] = take(BITS.score, rest);
  [pieces, rest] = take(BITS.pieces, rest);
  [packIndex, rest] = take(BITS.pack, rest);
  [sizeIndex, rest] = take(BITS.size, rest);
  [seed, rest] = take(BITS.seed, rest);

  const size = SIZES[sizeIndex]?.id;
  const pack = PACKS[packIndex]?.id;
  // Two bits hold four values and there are three of each, so a code can name a
  // disc that does not exist. That is a corrupt code, not a new disc size.
  if (!size || !pack || pieces === 0) return null;

  return { seed, size, pack, pieces, score };
}

/**
 * A fresh challenge, vetted the way the daily is.
 *
 * The deal is fixed, so a bad seed cannot be rescued by the adaptive dealer the
 * way free play's is — and sending a friend a round that dies on piece nine is
 * worse than sending nothing. The bot plays each candidate through and the
 * first playable one wins.
 */
export function newChallenge(salt: string): Challenge {
  const variantSeed = hashSeed(`shiftle:challenge:${salt}`);
  const size = SIZES[variantSeed % SIZES.length]!.id;
  const pack = PACKS[(variantSeed >>> 8) % PACKS.length]!.id;
  const spec = sizeById(size).spec;

  let seed = hashSeed(`shiftle:challenge:seed:${salt}`);
  let best = { seed, placements: -1 };

  for (let attempt = 0; attempt < 6; attempt++) {
    const result = playOut(
      createGame({
        seed,
        mode: "challenge",
        spec,
        pack,
        fairDeal: false,
        rules: { pieceLimit: CHALLENGE_PIECES },
      }),
      CHALLENGE_PIECES + 40,
      BOT_POLICY_V1,
    );
    const placements = result.state.stats.piecesPlaced;
    if (placements > best.placements) best = { seed, placements };
    if (placements >= 18) break;
    seed = hashSeed(`shiftle:challenge:reseed:${seed}:${attempt}`);
  }

  return { seed: best.seed, size, pack, pieces: CHALLENGE_PIECES, score: 0 };
}
