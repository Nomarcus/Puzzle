/**
 * The core: the hole in the middle of the disc, put to work.
 *
 * The hub was decoration — a hole the rings are drawn around. It is also the
 * one part of the screen the eye returns to constantly, because everything on
 * a round board points at it, so it is the obvious place to put something the
 * player is building toward.
 *
 * Every line cleared feeds it. When it fills, the disc has a bomb in the middle
 * of it that the player fires by tapping, and firing sweeps the board — every
 * block, and every stone the free-play ramp has crusted the rim with.
 *
 * What makes it more than a bomb is *when* you fire it. A sweep pays for what
 * it takes, so a full core is worth more the longer you hold it, and holding it
 * means playing on a board you are deliberately letting fill. That is the whole
 * decision, it needs no explanation, and it is the same decision at every level
 * of play — which is what a good mechanic looks like.
 *
 * It is deliberately not a rescue you can rely on: a core takes about eight
 * spokes' worth of clearing to fill, so a player already dying is not going to
 * charge one in time. It rewards someone doing well and gives them something to
 * do with it.
 */

import type { Clears } from "./board.js";

export interface CoreSpec {
  /** Charge needed to fire. 0 turns the core off entirely. */
  readonly capacity: number;
  readonly perSpoke: number;
  readonly perRing: number;
  /** On top of the line itself, for a line cleared in a single colour. */
  readonly perPure: number;
  readonly perStripe: number;
  /** A sweep already clears the disc, so it pays a fraction rather than a fill. */
  readonly perSweep: number;
  /**
   * Points per cell a firing takes off the board.
   *
   * Per cell rather than per line, and low rather than generous. Both were
   * corrected by measurement: scoring a firing as sixteen simultaneous lines
   * paid it three times a bullseye, and even once that was fixed, a core worth
   * a lot flattened free play's score spread from four- to eightfold down to
   * about 1.5x — every player scoring the same because everyone fires roughly
   * the same number of cores. The core has to be a good move, not the move
   * that decides the round.
   */
  readonly perCellScore: number;
}

export const NO_CORE: CoreSpec = {
  capacity: 0,
  perSpoke: 0,
  perRing: 0,
  perPure: 0,
  perStripe: 0,
  perSweep: 0,
  perCellScore: 0,
};

/**
 * Set by `npm run core`, which plays the bot against each candidate.
 *
 * Thirty-four works out at one firing every eighty-odd placements — an event
 * rather than a rhythm. That rarity is not a compromise: measured, it widens
 * free play's score spread to 5.6x, *wider* than with no core at all (3.7x),
 * because a core you only get a few times is worth holding for a packed board
 * and knowing when to do that is a real difference between players. The
 * generous early version, firing every forty pieces, narrowed the spread to
 * 2.8x — everybody fires roughly the same number, so everybody scores roughly
 * the same.
 */
export const DEFAULT_CORE: CoreSpec = {
  capacity: 34,
  perSpoke: 1,
  perRing: 3,
  perPure: 2,
  perStripe: 2,
  // A sweep is already the biggest thing that can happen; paying it a full
  // core on top would let one bullseye chain into the next.
  perSweep: 4,
  perCellScore: 55,
};

export function coreActive(spec: CoreSpec): boolean {
  return spec.capacity > 0;
}

/** What a settled move feeds the core. */
export function chargeFrom(
  spec: CoreSpec,
  clears: Clears,
  pure: number,
  stripes: number,
  sweep: boolean,
): number {
  if (!coreActive(spec)) return 0;
  if (sweep) return spec.perSweep;
  return (
    clears.spokes.length * spec.perSpoke +
    clears.rings.length * spec.perRing +
    pure * spec.perPure +
    stripes * spec.perStripe
  );
}

export function coreReady(spec: CoreSpec, charge: number): boolean {
  return coreActive(spec) && charge >= spec.capacity;
}

/** 0 to 1, for the renderer. Never above 1 — the charge itself is clamped. */
export function coreFraction(spec: CoreSpec, charge: number): number {
  if (!coreActive(spec)) return 0;
  return Math.min(1, charge / spec.capacity);
}
