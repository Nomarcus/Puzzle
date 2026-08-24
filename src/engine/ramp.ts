/**
 * The difficulty ramp for free play.
 *
 * Free play had no ending. The bot said so plainly: on the default packs a
 * round essentially never finishes, which meant the free-play leaderboard
 * ranked patience rather than skill — the top score belonged to whoever sat
 * there longest.
 *
 * The genre has five answers to this and we can only use three of them. Speed
 * is out: the game is turn-based and meant to be calm. A hard piece cap is out
 * too — the daily already is one, and free play should end because the board
 * beat you, not because a counter ran out. That leaves the three dials below,
 * which move together as the round goes deeper.
 *
 * All three are *telegraphed*. The depth is on screen, it announces itself when
 * it changes, and stone lands where you can watch it land. This is the whole
 * difference between us and the games this one is answering: Block Blast gets
 * harder by quietly handing you pieces that do not fit, and that is why losing
 * to it feels like a swindle. Getting harder is fine. Hiding it is not.
 */

import { type Board, petrify } from "./board.js";
import type { Family } from "./pieces.js";
// Type-only, so it is erased at compile time and game.ts importing this back
// is not a runtime cycle.
import type { RuleSet } from "./game.js";
import { nextRandom } from "./rng.js";
import { type PackId, packById } from "./variants.js";

export interface RampSpec {
  /** Pieces placed per depth. Depth 0 is the game as it always was. */
  readonly piecesPerDepth: number;
  /** Past this, nothing gets worse. A ramp with no ceiling is just a wall. */
  readonly maxDepth: number;
  /** First depth that drops stone. Before it the round plays normally. */
  readonly stoneFrom: number;
  /** Pieces between stones when stone starts. Shrinks as it gets deeper. */
  readonly stoneEvery: number;
  /** First depth where a spin costs more than one ring. */
  readonly costFrom: number;
}

/**
 * Off by default. The daily and the levels must not ramp — both are the same
 * puzzle for everybody, and a ramp that reacts to how far you got would make
 * two players' boards diverge.
 */
export const NO_RAMP: RampSpec = {
  piecesPerDepth: 0,
  maxDepth: 0,
  stoneFrom: Infinity,
  stoneEvery: Infinity,
  costFrom: Infinity,
};

/**
 * Set by `npm run ramp`, which plays the bot against each candidate on every
 * disc and pack. Chosen for three properties, in this order: every round ends,
 * no round ends absurdly early, and the gap between a bad run and a good one
 * stays wide — that gap is the leaderboard, and a ramp that killed everybody at
 * the same place would end rounds without making them a contest.
 *
 * Bot medians land around 200 pieces with a four- to eightfold spread. A person
 * plays better than this bot, so read those as a floor.
 */
export const FREE_PLAY_RAMP: RampSpec = {
  piecesPerDepth: 22,
  maxDepth: 8,
  // Nothing happens for the first sixty-odd pieces. The opening of a round
  // should feel like the game it has always been.
  stoneFrom: 3,
  stoneEvery: 13,
  costFrom: 3,
};

export function rampActive(ramp: RampSpec): boolean {
  return ramp.piecesPerDepth > 0;
}

/**
 * How deep the round has got. Deliberately unbounded — it is the number the
 * player is playing for, and the stone dial reads it raw.
 */
export function depthAt(ramp: RampSpec, piecesPlaced: number): number {
  if (!rampActive(ramp)) return 0;
  return Math.floor(piecesPlaced / ramp.piecesPerDepth);
}

/**
 * 0 at the top, 1 at maxDepth and no further. The bag and the spin cap are
 * texture, not the thing that ends a round: past a point there is no heavier
 * piece to deal and no smaller cap than one, so they level off and the stone
 * carries on alone.
 */
function pressure(ramp: RampSpec, depth: number): number {
  if (!rampActive(ramp) || ramp.maxDepth === 0) return 0;
  return Math.min(1, depth / ramp.maxDepth);
}

/**
 * Dial 1 — the deal gets heavier.
 *
 * Weights blend toward this as the round goes deeper, whichever pack was
 * chosen. It is meaner than the chunks pack: fat bricks and rosettes, hardly
 * any arcs, and — the part that actually kills you — the single dot, the
 * get-out-of-jail piece that patches a one-cell hole, becomes rare.
 *
 * It never reaches zero. A bag that could not fill a gap would make some boards
 * unsolvable, and losing because no piece on earth fitted is the complaint this
 * game exists to answer.
 */
const DEEP_WEIGHTS: Readonly<Record<Family, number>> = {
  dot: 0.3,
  arc: 0.5,
  wedge: 1,
  brick: 3,
  elbow: 1.8,
  hook: 0.8,
  fan: 1.6,
  step: 1.2,
  rosette: 2.4,
};

export function rampedWeights(pack: PackId, ramp: RampSpec, depth: number): Record<Family, number> {
  const base = packById(pack).weights;
  const t = pressure(ramp, depth);
  const out = {} as Record<Family, number>;
  for (const key of Object.keys(base) as Family[]) {
    out[key] = base[key] * (1 - t) + DEEP_WEIGHTS[key] * t;
  }
  return out;
}

/**
 * Dial 2 — lives get scarce.
 *
 * Spins are the game's lives: the round ends only when nothing fits *and* you
 * have none left.
 *
 * This started as a price rise — one ring buys a spin, then two, then three —
 * and the bot showed it was inert. Playing a full round it sat at the three-spin
 * cap for 92% of its turns and spent four spins in 359 pieces. You cannot make
 * lives expensive for somebody who is never short of one; the bank was always
 * full, so the price on the door never came up.
 *
 * So the cap comes down instead, 3 to 2 to 1, and the price rises alongside it
 * to slow the refill once the bank is small enough to empty. Nothing already
 * banked is confiscated — a lower cap only stops the next refill going that
 * high, so the meter shrinks ahead of you rather than snatching from you.
 */
export function rampedRules(base: RuleSet, ramp: RampSpec, rawDepth: number): RuleSet {
  const depth = Math.min(rawDepth, ramp.maxDepth);
  if (!rampActive(ramp) || depth < ramp.costFrom) return base;
  const steps = 1 + Math.floor((depth - ramp.costFrom) / 2);
  return {
    ...base,
    clearsPerSpin: base.clearsPerSpin + steps,
    maxSpins: Math.max(1, base.maxSpins - steps),
  };
}

/**
 * Dial 3 — the rim turns to stone, and this is the one that ends the round.
 *
 * Every so often one empty cell on the outermost ring with room left becomes a
 * blockage. It fills space, it can never be part of a single-colour clear, and
 * it takes two clears to break. The disc crusts over from the outside in, which
 * is the one threat a round board can state without a word of explanation.
 *
 * The interval falls all the way to one stone per piece and stays there. That
 * is deliberate and it is what makes free play finite: a board that gains a
 * blockage every single turn cannot be kept clear by any standard of play, so
 * every round has an end and the only question is how far down you got. Capping
 * this dial the way the other two are capped was the mistake the bot caught —
 * with every dial levelling off, deep play reached a steady state it could sit
 * in forever, and rounds ran past a thousand pieces without finishing.
 */
export function stoneInterval(ramp: RampSpec, depth: number): number {
  if (!rampActive(ramp) || depth < ramp.stoneFrom) return Infinity;
  return Math.max(1, ramp.stoneEvery - (depth - ramp.stoneFrom));
}

/**
 * Whether the piece just placed is the one that brings a stone with it.
 *
 * Counted against the interval for the depth we are at now, rather than a
 * running tally, so the rate is a pure function of how far in you are — which
 * keeps a replay from having to carry a counter.
 */
export function stoneDue(ramp: RampSpec, piecesPlaced: number): boolean {
  const depth = depthAt(ramp, piecesPlaced);
  const interval = stoneInterval(ramp, depth);
  if (!Number.isFinite(interval)) return false;
  return piecesPlaced % interval === 0;
}

export interface StoneDrop {
  readonly board: Board;
  readonly cell: { readonly r: number; readonly s: number };
  readonly rngState: number;
}

export function dropStone(board: Board, rngState: number): StoneDrop | null {
  const [roll, next] = nextRandom(rngState);
  const result = petrify(board, roll);
  if (!result) return null;
  return { board: result.board, cell: result.cell, rngState: next };
}
