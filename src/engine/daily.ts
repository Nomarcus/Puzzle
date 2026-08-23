/**
 * The daily puzzle.
 *
 * The daily cannot use the adaptive deal that free play gets, because that deal
 * depends on the board and two players who played differently would be handed
 * different pieces — which would make "the same puzzle for everyone" a lie.
 *
 * So it protects itself the other way round. The sequence is fixed, and the
 * seed is vetted before anyone sees it: the bot plays the day through, and a
 * day it cannot get a decent round out of is rejected and reseeded. The check
 * is a pure function of the date, so every device in the world independently
 * arrives at the same puzzle.
 */

import { playOut } from "./bot.js";
import { createGame } from "./game.js";
import { dailyNumber, dailySeed, hashSeed } from "./rng.js";
import { type PackId, type SizeId, dailyVariant, sizeById } from "./variants.js";

/**
 * Free play runs indefinitely by design, so the daily needs its own ending or
 * one attempt could last hours and scores would measure stamina rather than
 * skill. A fixed ration of pieces makes every player's day the same length as
 * well as the same puzzle.
 */
export const DAILY_PIECES = 60;

/** A day the bot cannot place this many pieces on is not worth playing. */
const MIN_PLACEMENTS = 18;
/** Give up after this many reseeds and take the best day we saw. */
const MAX_ATTEMPTS = 6;

export interface DailyPuzzle {
  readonly number: number;
  readonly seed: number;
  readonly size: SizeId;
  readonly pack: PackId;
  readonly pieceLimit: number;
  /** How far the bot got. Useful for tuning; not shown to the player. */
  readonly botPlacements: number;
}

export function dailyPuzzle(date: Date): DailyPuzzle {
  const base = dailySeed(date);
  // The disc and pack come from the date itself, so vetting only ever changes
  // which pieces turn up — never what today's board looks like.
  const variant = dailyVariant(base);
  const spec = sizeById(variant.size).spec;

  let seed = base;
  let best = { seed: base, placements: -1 };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const result = playOut(
      createGame({
        seed,
        mode: "daily",
        spec,
        pack: variant.pack,
        rules: { pieceLimit: DAILY_PIECES },
      }),
      DAILY_PIECES + 40,
    );
    const placements = result.state.stats.piecesPlaced;

    if (placements > best.placements) best = { seed, placements };
    if (placements >= MIN_PLACEMENTS) break;

    seed = hashSeed(`shiftle:reseed:${seed}:${attempt}`);
  }

  return {
    number: dailyNumber(date),
    seed: best.seed,
    size: variant.size,
    pack: variant.pack,
    pieceLimit: DAILY_PIECES,
    botPlacements: best.placements,
  };
}
