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

import { type Board, createBoard } from "./board.js";
import type { BoardSpec } from "./geometry.js";
import { cellIndex } from "./geometry.js";
import type { RuleSet } from "./game.js";
import { hashSeed } from "./rng.js";
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
];

export function levelByNumber(number: number): Level | null {
  return LEVELS.find((level) => level.number === number) ?? null;
}

/**
 * Every level's pieces come from its own fixed seed, so a level is the same
 * puzzle for everybody, every attempt — the daily's promise, twenty times over.
 */
export function levelSeed(level: Level): number {
  return hashSeed(`shiftle:level:${level.number}`);
}

export function levelBoard(level: Level): Board {
  return buildPattern(level.pattern, sizeById(level.size).spec);
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
    }
  })();

  return { kind: goal.kind, done, target: goal.target, met: done >= goal.target };
}
