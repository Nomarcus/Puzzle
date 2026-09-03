/**
 * The belt: pieces keep coming whether you are ready or not.
 *
 * Every other mode waits for you. The tray refills when you have spent all
 * three, so the game runs at exactly the speed you think at — which is the
 * right default and is also why nothing in the game has ever asked you to
 * hurry except the clock in time attack.
 *
 * This mode takes that away. A piece slides onto the belt every so often, the
 * gap between arrivals shrinks for as long as you last, and a piece arriving
 * with nowhere to put it is a piece you have failed to keep up with.
 *
 * ## Why the pressure is speed and not space
 *
 * Time attack is the fast mode and free play is the spatial one, and the two
 * stay apart because neither borrows the other's pressure — the docs are
 * explicit that the daily and free play are about the board filling and time
 * attack is about how fast you can think, with nothing else mixed in. A belt is
 * a *speed* pressure, so it belongs next to the clock rather than on top of it:
 * this mode has no clock at all. What ends a round is falling behind.
 *
 * ## What happens when you fall behind
 *
 * A piece that arrives with the tray already full does not end the round on the
 * spot. It drops **a stone on the rim** instead, which is the mechanic free
 * play already uses to make a board slowly unplayable: a line containing stone
 * does not clear, so the disc degrades a cell at a time and the round ends the
 * ordinary way, when nothing fits and no spin or push is left.
 *
 * That is deliberately a slope rather than a cliff. Ending the round on the
 * first overflow would make the whole mode one mistake long, and a player who
 * cannot see death coming cannot learn to avoid it. Stone is visible, it lands
 * where you can watch it land, and it is already the thing the game uses to
 * say "this is getting worse".
 *
 * ## It has to end, and that is why the belt has no floor
 *
 * The gap between arrivals shrinks without bound. This is the third time the
 * same lesson has been paid for in this codebase — free play's ramp plateaued
 * on stone, time attack's drain plateaued at 2.2x and a good enough player
 * simply never died — so it is written down here as a rule rather than
 * rediscovered a fourth time: **any dial meant to end a round must grow without
 * a ceiling, or it is a plateau wearing an ending's clothes.** However fast you
 * place pieces, there is a point on this curve where the belt is faster.
 */

export interface BeltSpec {
  /** Seconds between arrivals when the round opens. */
  readonly opening: number;
  /** Seconds of play before the belt steps up a gear. */
  readonly every: number;
  /**
   * How much quicker each gear is, as a share of the opening gap. There is no
   * ceiling on the number of gears — see the note above about plateaus.
   */
  readonly step: number;
}

/**
 * Set against measured rates of placement — `npm run belt` models players from
 * one piece every four seconds to one every second and reports how long each
 * lasts, how many pieces they get down and how much stone they drown in.
 */
export const BELT: BeltSpec = {
  opening: 3,
  every: 30,
  step: 0.2,
};

/**
 * Seconds between arrivals after this long at the belt.
 *
 * Divides rather than subtracts, so the gap approaches zero without ever
 * reaching it — a subtraction would hit zero at a knowable moment and then go
 * negative, which is a different bug in every scheduler that has ever tried it.
 */
export function beltInterval(spec: BeltSpec, elapsed: number): number {
  const gears = Math.floor(Math.max(0, elapsed) / spec.every);
  return spec.opening / (1 + gears * spec.step);
}

/** How many pieces the belt has delivered by now. Used only for display. */
export function beltDelivered(spec: BeltSpec, elapsed: number): number {
  let count = 0;
  let at = 0;
  // Walks gear by gear rather than integrating, because the interval is a step
  // function and the closed form would be wrong at every boundary.
  while (at < elapsed && count < 100_000) {
    at += beltInterval(spec, at);
    if (at <= elapsed) count += 1;
  }
  return count;
}
