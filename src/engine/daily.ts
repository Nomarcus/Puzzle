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

import { BOT_POLICY_V1, type BotPolicy, playOut } from "./bot.js";
import { createGame } from "./game.js";
import { dateKey, dailyNumber, dailySeed, hashSeed } from "./rng.js";
import { type PackId, type SizeId, dailyVariant, sizeById } from "./variants.js";

/**
 * Free play runs indefinitely by design, so the daily needs its own ending or
 * one attempt could last hours and scores would measure stamina rather than
 * skill. A fixed ration of pieces makes every player's day the same length as
 * well as the same puzzle.
 */
export const DAILY_PIECES = 60;

/**
 * How the vetting bot plays, pinned deliberately.
 *
 * The seed for a day is chosen by playing that day through, so which puzzle
 * every player in the world gets is a function of how this bot plays. Change
 * it and every past daily silently becomes a different puzzle — including ones
 * people have already played and posted scores for. So the policy is named and
 * frozen: improving the bot for balance work is free, repointing this is not.
 */
const DAILY_BOT_POLICY: BotPolicy = BOT_POLICY_V1;

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

/**
 * Vetting a day costs up to six full bot playouts, and the answer only ever
 * changes at midnight UTC. The result screen asks for today's puzzle at exactly
 * the wrong moment — while the player is watching an animation — so the work is
 * done once per day per launch and remembered.
 */
const vetted = new Map<string, DailyPuzzle>();

export function dailyPuzzle(date: Date): DailyPuzzle {
  const key = dateKey(date);
  const known = vetted.get(key);
  if (known) return known;

  const puzzle = vetDaily(date);
  vetted.set(key, puzzle);
  return puzzle;
}

function vetDaily(date: Date): DailyPuzzle {
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
      DAILY_BOT_POLICY,
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
