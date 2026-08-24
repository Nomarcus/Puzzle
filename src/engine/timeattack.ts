/**
 * Time attack: the clock is the opponent.
 *
 * The other modes are about space — the board fills, and you lose when nothing
 * fits. This one is about speed, and it is deliberately the most stressful
 * thing in the game: the clock is always running down, and the only thing that
 * puts seconds back is clearing lines. Stop clearing and you are dead in under
 * a minute, however much room is left on the disc.
 *
 * That makes it the purest competitive mode we have. The daily measures points
 * per piece; free play measures how deep you got. This measures how fast you
 * can think, with nothing else mixed in — no ration to pace yourself against,
 * no stone to plan around, and no way to sit and stare at the board.
 *
 * None of it lives in the game state. The engine is a pure function of moves
 * and knows nothing about wall-clock time, which is what makes replays and the
 * bot possible; the clock belongs to the screen. What is here is the arithmetic
 * — what a move is worth in seconds, and how fast the clock runs — kept out of
 * the view so it can be reasoned about and tested on its own.
 */

import type { MoveEvents } from "./game.js";

export interface ClockSpec {
  /** Seconds on the clock when the round opens, and the most it can ever hold. */
  readonly seconds: number;
  /** Seconds of play before the clock starts running faster. */
  readonly drainEvery: number;
  /**
   * Extra drain per `drainEvery` survived, forever — there is deliberately no
   * ceiling on it.
   *
   * A capped drain is a rate a good enough player simply out-earns, and then
   * the round never ends. That is not hypothetical: at a cap of 2.2 seconds
   * per second, clearing a spoke every second and a ring every five brings in
   * 2.3, and the test that plays that standard of play ran to its own hour-long
   * ceiling without dying. It is the same mistake the free-play ramp made with
   * stone — every dial that is supposed to end a round has to grow without
   * bound, or it stops being an ending and becomes a plateau.
   */
  readonly drainStep: number;
}

/**
 * Chosen by modelling five standards of play — from someone clearing a spoke
 * every eight seconds to someone doing it every two — against each candidate,
 * and reading four numbers off every run: does everyone die, how far apart are
 * the best and worst, how much of the round is spent under ten seconds, and how
 * many clears paid nothing.
 *
 * Thirty seconds gives rounds of about 35 seconds to two and a half minutes, a
 * fourfold gap between a beginner and an expert, and roughly a third of a good
 * player's round in the red.
 *
 * That last measurement is why the clock opens at what it caps at. An earlier
 * version opened at 45 and capped at 25, on the theory that a calm opening you
 * could never return to would be the most tense shape available. It measured
 * well and played terribly: above the cap a clear is worth nothing, so the
 * first twenty seconds of the round silently ignored everything the player
 * did. A mode whose one mechanic is "clearing buys time" cannot have a phase
 * where clearing buys no time.
 */
export const TIME_ATTACK: ClockSpec = {
  seconds: 30,
  drainEvery: 40,
  drainStep: 0.18,
};

/**
 * How fast the clock is running after this many seconds of play.
 *
 * It has to accelerate. A constant drain plus a fixed refill is a treadmill a
 * good player can walk forever, which is exactly the problem free play had
 * before its ramp — a mode that never ends ranks patience, not skill.
 */
export function drainRate(spec: ClockSpec, elapsed: number): number {
  const steps = Math.floor(Math.max(0, elapsed) / spec.drainEvery);
  return 1 + steps * spec.drainStep;
}

/**
 * Seconds a move buys back.
 *
 * Weighted the same way the score is, and for the same reason: a spoke is the
 * constant drip that keeps you alive, a ring is worth going for, and the
 * bullseye is worth building toward even with the clock at four seconds. The
 * numbers are deliberately smaller than the drain — clearing has to be
 * *frequent*, not occasional, or the mode turns into waiting for one big move.
 */
export function timeBonus(events: MoveEvents): number {
  if (events.sweep) return 8;

  let seconds = 0;
  seconds += events.clears.spokes.length * 1.5;
  seconds += events.clears.rings.length * 4;
  // A stripe fires across lines that were not full, so it is not already
  // counted above. It is the one thing you can set up in advance, which is
  // worth something when there is no time to set anything up.
  seconds += events.stripesFired * 1;
  return seconds;
}

/** Where the clock stands after a move that earned `bonus` seconds. */
export function addTime(spec: ClockSpec, left: number, bonus: number): number {
  return Math.min(spec.seconds, left + bonus);
}
