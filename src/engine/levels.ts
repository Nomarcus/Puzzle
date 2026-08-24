/**
 * Levels.
 *
 * Free play does not end. That is measured, not assumed — `npm run endless`
 * says 0 of 12 rounds finish within 6,000 placements on the default packs. It
 * is a fine way to pass twenty minutes and a poor way to feel you are getting
 * anywhere, and it means the endless leaderboard ranks patience.
 *
 * A level is the opposite: a fixed board, a fixed sequence, a budget of pieces
 * and one thing to achieve. It ends, you either did it or you did not, and the
 * next one is different.
 *
 * Three things make each one its own puzzle:
 *
 * **A starting pattern.** Most of these do not begin on an empty disc. A ring
 * two cells short, a filled rim, a quarter blocked off — the board arrives
 * mid-thought and the first move already matters. This is the single biggest
 * difference between "a level" and "free play with a target".
 *
 * **A goal that is not always score.** Clear rings, clear in one colour, chain
 * a combo, land a bullseye. Each goal points at a different part of the game,
 * so the twenty of them teach it in order rather than repeating one idea.
 *
 * **A budget.** Every level rations pieces. Running out is how you lose, which
 * makes every placement cost something.
 *
 * The targets are not guesses. `npm run levels` plays every level with the bot
 * a few hundred times and reports what it actually achieves; the numbers below
 * are set from that. The bot is a weak, one-move-deep player, so a target it
 * can reach is one a person will find fair — that is the point of using it.
 */

import { type Board, STONE, createBoard } from "./board.js";
import type { BoardSpec } from "./geometry.js";
import { cellIndex } from "./geometry.js";
import type { RuleSet } from "./game.js";
import { type CoreSpec, DEFAULT_CORE } from "./core.js";
import { hashSeed } from "./rng.js";
import { BOT_POLICY_LEVELS, playOut } from "./bot.js";
import { createGame } from "./game.js";
import { type PackId, type SizeId, sizeById } from "./variants.js";

// --------------------------------------------------------------- the goals

export type Goal =
  /** Reach a score within the budget. The all-rounder. */
  | { readonly kind: "score"; readonly target: number }
  /** Pop whole rings — the rare, hard clear. */
  | { readonly kind: "rings"; readonly target: number }
  /** Pop spokes. The bread and butter, so the targets are higher. */
  | { readonly kind: "spokes"; readonly target: number }
  /** Clear lines in a single colour. Makes the palette matter. */
  | { readonly kind: "pure"; readonly target: number }
  /** Set off striped blocks. */
  | { readonly kind: "stripes"; readonly target: number }
  /** A ring and a spoke in one move. The big one. */
  | { readonly kind: "bullseye"; readonly target: number }
  /** Charge and fire the core. Teaches the hold-or-fire decision. */
  | { readonly kind: "cores"; readonly target: number }
  /** Chain clears without a break. */
  | { readonly kind: "combo"; readonly target: number };

export type GoalKind = Goal["kind"];

/** What a level asks for, and how far along the player is. */
export interface Progress {
  readonly kind: GoalKind;
  readonly done: number;
  readonly target: number;
  readonly met: boolean;
}

// ------------------------------------------------------------- the patterns

export type PatternId =
  | "empty"
  | "rim"
  | "hub"
  | "ringShort"
  | "quarter"
  | "spokes"
  | "speckle"
  | "checker"
  | "cross"
  | "chorus"
  | "spiral";

/**
 * A deterministic scatter. Patterns need arbitrary-looking placement that is
 * identical on every device, and threading the game's RNG through a shape
 * function would be more machinery than the job deserves.
 */
function jitter(a: number, b: number, salt: number): number {
  const n = Math.sin(a * 127.1 + b * 311.7 + salt * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * Builds a level's opening board.
 *
 * Every pattern is a function of the board spec rather than a fixed grid, so a
 * level plays the same shape on any disc and adding a size never invalidates
 * one. Colours are chosen per pattern: some deliberately monochrome, because a
 * single-colour line is what buys a push and a level about pure clears has to
 * start somewhere.
 */
export function buildPattern(id: PatternId, spec: BoardSpec, colours = 8): Board {
  const board = createBoard(spec);
  const { rings, sectors } = spec;
  const set = (r: number, s: number, colour: number) => {
    if (r < 0 || r >= rings) return;
    board.cells[cellIndex(spec, r, ((s % sectors) + sectors) % sectors)] = colour;
  };
  const varied = (r: number, s: number) => 1 + Math.floor(jitter(r, s, 3) * colours);

  switch (id) {
    case "empty":
      break;

    case "rim":
      // The outer ring, minus a couple of gaps. Closing it is one ring clear,
      // but everything placed there is in the way until it is.
      for (let s = 0; s < sectors; s++) {
        if (s % Math.max(3, Math.floor(sectors / 3)) === 0) continue;
        set(rings - 1, s, varied(rings - 1, s));
      }
      break;

    case "hub":
      // The two innermost rings, which are the smallest and the most awkward
      // to reach around.
      for (let r = 0; r < Math.min(2, rings); r++) {
        for (let s = 0; s < sectors; s++) {
          if (jitter(r, s, 7) < 0.25) continue;
          set(r, s, varied(r, s));
        }
      }
      break;

    case "ringShort": {
      // A middle ring two cells from complete, in one colour. The obvious move
      // is right there; the level is about what you do after taking it.
      const ring = Math.floor(rings / 2);
      const colour = 4;
      const gapA = 1;
      const gapB = 1 + Math.floor(sectors / 2);
      for (let s = 0; s < sectors; s++) {
        if (s === gapA || s === gapB) continue;
        set(ring, s, colour);
      }
      break;
    }

    case "quarter":
      // A block of the disc walled off. Less room, and the geometry stops
      // being symmetrical.
      for (let r = 0; r < rings; r++) {
        for (let s = 0; s < Math.ceil(sectors / 4); s++) {
          set(r, s, varied(r, s));
        }
      }
      break;

    case "spokes": {
      // Three spokes filled from the rim inwards, stopping short of the hub.
      const step = Math.max(2, Math.floor(sectors / 3));
      for (let i = 0; i < 3; i++) {
        for (let r = Math.floor(rings / 2); r < rings; r++) set(r, i * step, varied(r, i * step));
      }
      break;
    }

    case "speckle":
      // Scattered singles. Nothing is blocked, but nothing is clean either.
      for (let r = 0; r < rings; r++) {
        for (let s = 0; s < sectors; s++) {
          if (jitter(r, s, 11) < 0.78) continue;
          set(r, s, varied(r, s));
        }
      }
      break;

    case "checker":
      // Scattered cells on alternating rings. Measured sparser than it started:
      // at every other sector it left single-cell gaps everywhere and the bot
      // was strangled in half its runs, out of room rather than out of pieces.
      // A level should be hard because the goal is far away, not because
      // nothing fits.
      for (let r = 0; r < rings; r += 2) {
        for (let s = r % 4 === 0 ? 0 : 2; s < sectors; s += 3) set(r, s, varied(r, s));
      }
      break;

    case "cross": {
      // Two opposite spokes, whole, in one colour — one push from a pure clear
      // each. A level about the other currency.
      const colour = 6;
      for (let r = 0; r < rings; r++) {
        if (r === Math.floor(rings / 2)) continue;
        set(r, 0, colour);
        set(r, Math.floor(sectors / 2), colour);
      }
      break;
    }

    case "chorus": {
      // Four spokes, each in its own single colour, each two cells short. A
      // spoke is only as long as the disc has rings, so finishing one in its
      // colour is within reach — and a single-colour line is the only thing
      // that buys a push. A level about pure clears has to start somewhere,
      // and measurement said an ordinary board is not it: the bot managed one
      // pure clear in two hundred runs.
      const step = Math.max(1, Math.floor(sectors / 4));
      for (let i = 0; i < 4; i++) {
        const colour = 1 + i * 2;
        const sector = i * step;
        for (let r = 0; r < rings; r++) {
          if (r === i % rings || r === (i + 2) % rings) continue;
          set(r, sector, colour);
        }
      }
      break;
    }

    case "spiral":
      // A staircase winding out from the hub. Looks decorative, plays mean:
      // it leaves single-cell gaps everywhere.
      for (let r = 0; r < rings; r++) {
        const width = 1 + Math.floor((r * sectors) / (rings * 3));
        for (let i = 0; i < width; i++) set(r, r * 2 + i, varied(r, r * 2 + i));
      }
      break;
  }

  return board;
}

// --------------------------------------------------------------- the levels

/**
 * How much of the rim a level starts stoned.
 *
 * Stone is free play's mechanic, but as a *starting condition* it is a puzzle
 * in its own right: a stoned line cannot clear, and only a stripe or a sweep
 * shifts one, so a level that opens with four stones in the outer ring is
 * asking a specific question — dig them out, or work around them and win on
 * the rings you can still reach.
 */
export interface Level {
  /** 1-based, and the order they are played in. */
  readonly number: number;
  readonly size: SizeId;
  readonly pack: PackId;
  readonly pattern: PatternId;
  readonly goal: Goal;
  /** Pieces you get. Running out is how a level is lost. */
  readonly budget: number;
  readonly rules?: Partial<RuleSet>;
  /**
   * Core tuning for this level.
   *
   * Free play's core needs 34 charge, which is about eighty placements — more
   * than any level's whole budget. Measured, a level asking for two firings on
   * a 56-piece budget was won 0% of the time, which is not a hard level, it is
   * an impossible one. A level about the core lowers the capacity so the puzzle
   * is the *decision* — hold it or fire it — rather than the grind of charging.
   */
  readonly core?: Partial<CoreSpec>;
  /**
   * Cells of the rim that start as stone.
   *
   * Kept to two. Stone arriving gradually, as it does in free play, is a clock;
   * stone sitting there from the first move is far harsher, because it shuts a
   * ring *and* a spoke with no ordinary way to open either. Measured, four
   * stones left the bot out of room rather than out of pieces in 43-65% of
   * runs — the one kind of loss that teaches nothing. Two, plus a raised stripe
   * rate so there is a tool to dig with, is a puzzle instead of a wall.
   */
  readonly stone?: number;
}

/**
 * Twenty levels.
 *
 * The order is a teaching order, not a difficulty ramp with numbers turned up.
 * 1-4 are the basics on an easy disc. 5-8 introduce the two currencies — pure
 * clears buy pushes, ring clears buy spins. 9-12 are about the patterns: the
 * board arrives in the way and has to be dug out. 13-16 ask for the things
 * that need setting up, combos and bullseyes. 17-20 are the large disc and the
 * chunky pieces, with budgets that do not forgive much.
 */
export const LEVELS: readonly Level[] = [
  // --- the basics -----------------------------------------------------------
  { number: 1, size: "small", pack: "curves", pattern: "empty", goal: { kind: "spokes", target: 4 }, budget: 20 },
  { number: 2, size: "small", pack: "curves", pattern: "ringShort", goal: { kind: "rings", target: 1 }, budget: 18 },
  { number: 3, size: "small", pack: "mixed", pattern: "empty", goal: { kind: "score", target: 2500 }, budget: 24 },
  { number: 4, size: "small", pack: "mixed", pattern: "rim", goal: { kind: "spokes", target: 10 }, budget: 26 },

  // --- the two currencies ---------------------------------------------------
  { number: 5, size: "small", pack: "curves", pattern: "cross", goal: { kind: "pure", target: 1 }, budget: 22 },
  { number: 6, size: "standard", pack: "mixed", pattern: "empty", goal: { kind: "rings", target: 3 }, budget: 34 },
  { number: 7, size: "standard", pack: "mixed", pattern: "empty", goal: { kind: "stripes", target: 5 }, budget: 34, rules: { stripeChance: 0.16 } },
  { number: 8, size: "standard", pack: "curves", pattern: "chorus", goal: { kind: "pure", target: 2 }, budget: 32 },

  // --- digging out ----------------------------------------------------------
  { number: 9, size: "standard", pack: "mixed", pattern: "hub", goal: { kind: "spokes", target: 13 }, budget: 30 },
  { number: 10, size: "standard", pack: "curves", pattern: "quarter", goal: { kind: "score", target: 6000 }, budget: 32 },
  { number: 11, size: "standard", pack: "chunks", pattern: "empty", goal: { kind: "spokes", target: 12 }, budget: 28 },
  { number: 12, size: "standard", pack: "mixed", pattern: "checker", goal: { kind: "score", target: 6000 }, budget: 34 },

  // --- setting things up ----------------------------------------------------
  { number: 13, size: "standard", pack: "curves", pattern: "empty", goal: { kind: "combo", target: 4 }, budget: 30 },
  { number: 14, size: "standard", pack: "mixed", pattern: "spokes", goal: { kind: "rings", target: 4 }, budget: 36, rules: { startingSpins: 2 } },
  { number: 15, size: "standard", pack: "mixed", pattern: "spiral", goal: { kind: "score", target: 9000 }, budget: 34 },
  { number: 16, size: "standard", pack: "curves", pattern: "ringShort", goal: { kind: "bullseye", target: 1 }, budget: 38, rules: { startingSpins: 2 } },

  // --- the long haul --------------------------------------------------------
  { number: 17, size: "large", pack: "mixed", pattern: "empty", goal: { kind: "rings", target: 4 }, budget: 44 },
  { number: 18, size: "large", pack: "chunks", pattern: "rim", goal: { kind: "spokes", target: 18 }, budget: 42 },
  { number: 19, size: "large", pack: "curves", pattern: "chorus", goal: { kind: "pure", target: 2 }, budget: 44 },
  // The last one starts with the board already half in the way. The extra spins
  // are not generosity: on a large checker the bot was ending stuck rather than
  // out of pieces in a fifth of its runs, and losing to a board with no room
  // left is the one failure that teaches nothing.
  { number: 20, size: "large", pack: "mixed", pattern: "checker", goal: { kind: "score", target: 9000 }, budget: 48, rules: { startingSpins: 3 } },

  // --- the second twenty ------------------------------------------------
  //
  // The first twenty teach the board. These teach the things built on top of
  // it: the core in the middle, the prism block, and stone as a puzzle rather
  // than as free play's clock. Budgets are larger throughout, because every
  // one of these needs setting up before it can be cashed.

  // Meeting the core. A generous budget on a small disc: the point is to
  // charge one and see what firing it does, not to be pressed for time.
  { number: 21, size: "small", pack: "mixed", pattern: "empty", goal: { kind: "cores", target: 3 }, budget: 40, core: { capacity: 8 } },
  // The same, on a board that is already half in the way — so the core is
  // worth more when fired, which is the whole hold-or-fire decision.
  { number: 22, size: "small", pack: "mixed", pattern: "speckle", goal: { kind: "score", target: 11000 }, budget: 40 },
  // Prisms. A cross of one colour is two pushes waiting; a prism turns any
  // line into a third.
  { number: 23, size: "small", pack: "curves", pattern: "cross", goal: { kind: "pure", target: 5 }, budget: 36, rules: { wildChance: 0.14 } },
  { number: 24, size: "standard", pack: "mixed", pattern: "empty", goal: { kind: "pure", target: 5 }, budget: 44, rules: { wildChance: 0.12 } },

  // Stone as a puzzle. Four cells of the rim are shut and no ordinary clear
  // will open them — the level is what you do about that.
  { number: 25, size: "standard", pack: "mixed", pattern: "empty", goal: { kind: "spokes", target: 15 }, budget: 40, stone: 2, rules: { stripeChance: 0.16 } },
  { number: 26, size: "standard", pack: "mixed", pattern: "empty", goal: { kind: "stripes", target: 8 }, budget: 42, stone: 2, rules: { stripeChance: 0.2 } },
  // A ring with stone in it cannot clear. This one asks for rings anyway.
  { number: 27, size: "standard", pack: "curves", pattern: "ringShort", goal: { kind: "rings", target: 8 }, budget: 44, stone: 2, rules: { stripeChance: 0.16 } },

  // Two cores. Charging one is a lesson; charging two inside a budget is a
  // plan.
  { number: 28, size: "standard", pack: "mixed", pattern: "empty", goal: { kind: "cores", target: 3 }, budget: 56, core: { capacity: 8 } },
  { number: 29, size: "standard", pack: "chunks", pattern: "rim", goal: { kind: "score", target: 12000 }, budget: 48 },
  { number: 30, size: "standard", pack: "mixed", pattern: "spiral", goal: { kind: "combo", target: 4 }, budget: 46 },

  // --- the long ones ----------------------------------------------------
  { number: 31, size: "large", pack: "mixed", pattern: "empty", goal: { kind: "cores", target: 3 }, budget: 62, core: { capacity: 9 } },
  { number: 32, size: "large", pack: "curves", pattern: "chorus", goal: { kind: "pure", target: 5 }, budget: 54, rules: { wildChance: 0.1 } },
  { number: 33, size: "large", pack: "mixed", pattern: "empty", goal: { kind: "rings", target: 8 }, budget: 56, stone: 2, rules: { stripeChance: 0.16 } },
  { number: 34, size: "large", pack: "chunks", pattern: "speckle", goal: { kind: "spokes", target: 20 }, budget: 54 },
  { number: 35, size: "large", pack: "mixed", pattern: "quarter", goal: { kind: "score", target: 12500 }, budget: 56 },

  // --- the last five ----------------------------------------------------
  // The other bullseye level, and deliberately not the same puzzle as 16: that
  // one hands you a nearly finished *middle* ring, this one the rim — the
  // longest line on the disc, and the one a spoke has to reach all the way out
  // to cross.
  { number: 36, size: "standard", pack: "mixed", pattern: "rim", goal: { kind: "bullseye", target: 1 }, budget: 58, rules: { startingSpins: 3 } },
  { number: 37, size: "large", pack: "mixed", pattern: "checker", goal: { kind: "cores", target: 3 }, budget: 60, core: { capacity: 9 }, rules: { startingSpins: 3 } },
  { number: 38, size: "large", pack: "mixed", pattern: "rim", goal: { kind: "score", target: 32000 }, budget: 60, stone: 2, rules: { stripeChance: 0.16 } },
  { number: 39, size: "large", pack: "chunks", pattern: "spiral", goal: { kind: "combo", target: 6 }, budget: 58 },
  // The last one. Everything at once, on the biggest disc, with the rim
  // already crusting over.
  { number: 40, size: "large", pack: "mixed", pattern: "checker", goal: { kind: "score", target: 34000 }, budget: 66, stone: 2, rules: { startingSpins: 3, stripeChance: 0.14 } },
];

export function levelByNumber(number: number): Level | null {
  return LEVELS.find((level) => level.number === number) ?? null;
}

/**
 * Every level's pieces come from its own fixed seed, so a level is the same
 * puzzle for everybody, every attempt — the daily's promise, forty times over.
 *
 * And, like the daily, that seed is **vetted before anyone sees it**: the bot
 * plays the level through, and a deal it cannot get most of the way down is
 * rejected and reseeded.
 *
 * This is not theoretical. Level 26's first seed died on piece **eight of
 * forty-two** — its whole opening was pieces that would not fit around the
 * stone — while `npm run levels` reported it playing the full budget, because
 * the tool nudges the bot onto different seeds to see whether a level survives
 * more than one line of play. Averaging across seeds is the right question for
 * a *pattern* and the wrong one for a shipped deal: a level ships exactly one.
 * So the level's own seed is now vetted here, and the tool reports it in its
 * own column.
 */
export function levelSeed(level: Level): number {
  const known = vettedSeeds.get(level.number);
  if (known !== undefined) return known;
  const seed = vetLevelSeed(level);
  vettedSeeds.set(level.number, seed);
  return seed;
}

/**
 * Vetting costs a handful of bot playouts and the answer never changes, so it
 * is done once per level per launch and remembered. A level is opened from a
 * menu tap, which is exactly the wrong moment to spend a hundred milliseconds.
 */
const vettedSeeds = new Map<number, number>();

/** A deal the bot cannot get this far through is not the same puzzle for everyone. */
const MIN_BUDGET_FRACTION = 0.75;
const MAX_SEED_ATTEMPTS = 8;

function vetLevelSeed(level: Level): number {
  const base = hashSeed(`shiftle:level:${level.number}`);
  const spec = sizeById(level.size).spec;
  let seed = base;
  let best = { seed: base, placed: -1 };

  for (let attempt = 0; attempt < MAX_SEED_ATTEMPTS; attempt++) {
    const result = playOut(
      createGame({
        seed,
        mode: "level",
        spec,
        pack: level.pack,
        board: levelBoard(level),
        core: levelCore(level),
        rules: { ...level.rules, pieceLimit: level.budget },
      }),
      level.budget * 3,
      BOT_POLICY_LEVELS,
    );
    const placed = result.state.stats.piecesPlaced;
    if (placed > best.placed) best = { seed, placed };
    if (placed >= level.budget * MIN_BUDGET_FRACTION) break;
    seed = hashSeed(`shiftle:level:reseed:${level.number}:${attempt}`);
  }

  return best.seed;
}

/** The core a level plays with, which is usually a smaller one. */
export function levelCore(level: Level): CoreSpec {
  return { ...DEFAULT_CORE, ...level.core };
}

export function levelBoard(level: Level): Board {
  const spec = sizeById(level.size).spec;
  const board = buildPattern(level.pattern, spec);
  if (!level.stone) return board;

  // Spread around the rim rather than clustered, so the level poses "these
  // lines are shut" and not "this quarter is shut".
  const step = Math.max(1, Math.floor(spec.sectors / level.stone));
  for (let i = 0; i < level.stone; i++) {
    const sector = (i * step) % spec.sectors;
    board.cells[cellIndex(spec, spec.rings - 1, sector)] = STONE;
  }
  return board;
}

// -------------------------------------------------------------- the scoring

/** What a level's goal counts, out of a finished or in-progress round. */
export function goalProgress(
  goal: Goal,
  state: { score: number; stats: Readonly<Record<string, number>> },
): Progress {
  const done = (() => {
    switch (goal.kind) {
      case "score":
        return state.score;
      case "rings":
        return state.stats.ringsCleared ?? 0;
      case "spokes":
        return state.stats.spokesCleared ?? 0;
      case "pure":
        return state.stats.pureClears ?? 0;
      case "stripes":
        return state.stats.stripesFired ?? 0;
      case "bullseye":
        return state.stats.bullseyes ?? 0;
      case "combo":
        return state.stats.bestCombo ?? 0;
      case "cores":
        return state.stats.coresFired ?? 0;
    }
  })();

  return { kind: goal.kind, done, target: goal.target, met: done >= goal.target };
}
