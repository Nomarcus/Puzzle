/**
 * A greedy player.
 *
 * Two jobs. Offline it plays thousands of seeded games so the rules can be
 * balanced against measurements rather than opinion. In the app it vets the
 * daily seed, so a day that no amount of skill could rescue never reaches
 * anybody.
 *
 * It is deliberately not a strong player — it looks one move ahead and only
 * spins when it is out of room. A human expert will beat it, which is what we
 * want: if the bot can survive a board, a person certainly can.
 */

import {
  type Board,
  applyClears,
  canPlace,
  detonate,
  findClears,
  hasClears,
  isBullseye,
  place,
  pureLines,
} from "./board.js";
import { type GameState, type Move, type TraySlot, applyMove, slotPiece } from "./game.js";
import { cellIndex } from "./geometry.js";
import type { SpinDirection } from "./rotate.js";
import { pushSpoke, spinRing } from "./rotate.js";

const WEIGHTS = {
  /** A cleared line is worth far more than any positional consideration. */
  clearedLine: 900,
  ringBonus: 500,
  /** A single-colour line is the only thing that buys a push, and a push is a life. */
  pureLine: 700,
  /** The whole disc. Nothing else comes close. */
  sweep: 4000,
  /** Cubed, so filling a line from 80% to 100% counts for much more than 0% to 20%. */
  lineProgress: 260,
  isolatedCell: 26,
  occupancy: 1.6,
} as const;

/**
 * What the bot is allowed to do.
 *
 * It exists so the daily can be pinned to one behaviour. The daily's seed is
 * chosen by playing the day through, so the puzzle every player in the world
 * gets is a function of how this bot plays — improve it and every past daily
 * silently becomes a different puzzle. See DAILY_BOT_POLICY in daily.ts.
 */
export interface BotPolicy {
  /** Spend a push when nothing fits. Without this the bot stops while it still has moves. */
  readonly pushes: boolean;
  /** Value single-colour lines and detonations, rather than only counting lines. */
  readonly colour: boolean;
}

export const BOT_POLICY_V1: BotPolicy = { pushes: true, colour: true };

function lineValue(filled: number, length: number): number {
  const fraction = filled / length;
  return WEIGHTS.lineProgress * fraction * fraction * fraction;
}

/**
 * How promising a board looks. Rewards concentrating blocks into nearly
 * complete lines, punishes empty cells that nothing can reach any more, and
 * mildly prefers an emptier disc.
 */
export function boardValue(board: Board): number {
  const { rings, sectors } = board.spec;
  const at = (r: number, s: number) => board.cells[cellIndex(board.spec, r, s)]!;
  let value = 0;
  let filled = 0;

  for (let r = 0; r < rings; r++) {
    let n = 0;
    for (let s = 0; s < sectors; s++) if (at(r, s) !== 0) n++;
    filled += n;
    value += lineValue(n, sectors);
  }

  for (let s = 0; s < sectors; s++) {
    let n = 0;
    for (let r = 0; r < rings; r++) if (at(r, s) !== 0) n++;
    value += lineValue(n, rings);
  }

  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < sectors; s++) {
      if (at(r, s) !== 0) continue;
      let open = 0;
      if (r > 0 && at(r - 1, s) === 0) open++;
      if (r < rings - 1 && at(r + 1, s) === 0) open++;
      if (at(r, s + 1) === 0) open++;
      if (at(r, s - 1) === 0) open++;
      // A hole with no empty neighbour can only ever take a single cell.
      if (open === 0) value -= WEIGHTS.isolatedCell;
    }
  }

  return value - filled * WEIGHTS.occupancy;
}

/**
 * Settles a candidate board the same way the engine will, so the bot is
 * choosing between the outcomes it is actually going to get. Mirrors resolve()
 * in game.ts — purity read from the lines the move completed, before any
 * stripe widens them.
 */
function afterClears(
  board: Board,
  spokeClears: boolean,
  policy: BotPolicy,
): { board: Board; value: number } {
  const base = findClears(board, spokeClears);
  if (!hasClears(base)) return { board, value: 0 };

  if (!policy.colour) {
    const lines = base.rings.length + base.spokes.length;
    const value = lines * WEIGHTS.clearedLine + base.rings.length * WEIGHTS.ringBonus;
    return { board: applyClears(board, base).board, value };
  }

  const pure = pureLines(board, base);
  const bullseye = isBullseye(base);
  const fired = detonate(board, base);
  const sweep = bullseye || fired.sweep;
  const cleared = applyClears(board, fired.clears, sweep);

  const lines = fired.clears.rings.length + fired.clears.spokes.length;
  const value =
    lines * WEIGHTS.clearedLine +
    fired.clears.rings.length * WEIGHTS.ringBonus +
    pure * WEIGHTS.pureLine +
    (sweep ? WEIGHTS.sweep : 0);

  return { board: cleared.board, value };
}

/** Whether anything in the tray has somewhere to go on this board. */
function opensRoom(board: Board, tray: readonly (TraySlot | null)[], rings: number): boolean {
  for (const slot of tray) {
    const piece = slotPiece(slot);
    if (!piece) continue;
    for (let r = 0; r + piece.radialExtent <= rings; r++) {
      for (let s = 0; s < board.spec.sectors; s++) {
        if (canPlace(board, piece, r, s)) return true;
      }
    }
  }
  return false;
}

/**
 * The best move the bot can see, or null when it is out of options.
 *
 * Placements first. Spins and pushes are only considered once nothing can be
 * placed — a stronger player would spend them to set up combos, so treat bot
 * results as a floor, not a ceiling. What it must not do is stop while a legal
 * move exists: that measures the bot, not the game.
 */
export function chooseMove(state: GameState, policy: BotPolicy = BOT_POLICY_V1): Move | null {
  let best: Move | null = null;
  let bestValue = -Infinity;

  const maxRing = state.spec.rings;
  for (let slot = 0; slot < state.tray.length; slot++) {
    const held = state.tray[slot] ?? null;
    const piece = slotPiece(held);
    if (!piece || !held) continue;

    for (let r = 0; r + piece.radialExtent <= maxRing; r++) {
      for (let s = 0; s < state.spec.sectors; s++) {
        if (!canPlace(state.board, piece, r, s)) continue;
        // The real colour and the real stripe. Laying every piece down in the
        // same colour made every line look single-coloured, which is the one
        // thing that buys a push.
        const placed = policy.colour
          ? place(state.board, piece, r, s, held.colour, held.striped)
          : place(state.board, piece, r, s, 1);
        const settled = afterClears(placed, state.spokeClears, policy);
        const value = settled.value + boardValue(settled.board);
        if (value > bestValue) {
          bestValue = value;
          best = { type: "place", slot, r, s };
        }
      }
    }
  }

  if (best) return best;

  // Nothing fits. Both powers are lives at this point, so spend one.
  for (let ring = 0; ring < state.spec.rings && state.spins > 0; ring++) {
    for (const dir of [1, -1] as SpinDirection[]) {
      const spun = spinRing(state.board, ring, dir);
      const settled = afterClears(spun, state.spokeClears, policy);
      const opens = settled.value > 0 || opensRoom(settled.board, state.tray, maxRing);
      // Out of room with a spin in hand, a person spins on the off-chance
      // rather than sitting there, so the bot does too — it just prefers a
      // spin that demonstrably helps.
      const value = settled.value + boardValue(settled.board) + (opens ? 5000 : 0);
      if (value > bestValue) {
        bestValue = value;
        best = { type: "spin", ring, dir };
      }
    }
  }

  if (policy.pushes) {
    for (let sector = 0; sector < state.spec.sectors && state.pushes > 0; sector++) {
      for (const dir of [1, -1] as SpinDirection[]) {
        const pushed = pushSpoke(state.board, sector, dir);
        const settled = afterClears(pushed, state.spokeClears, policy);
        const opens = settled.value > 0 || opensRoom(settled.board, state.tray, maxRing);
        const value = settled.value + boardValue(settled.board) + (opens ? 5000 : 0);
        if (value > bestValue) {
          bestValue = value;
          best = { type: "push", sector, dir };
        }
      }
    }
  }

  return best;
}

export interface Playout {
  readonly state: GameState;
  readonly turns: number;
  /** True when the bot ran out of ideas before the rules declared it over. */
  readonly stalled: boolean;
}

export function playOut(
  start: GameState,
  maxTurns = 600,
  policy: BotPolicy = BOT_POLICY_V1,
): Playout {
  let state = start;
  let turns = 0;

  while (!state.over && turns < maxTurns) {
    const move = chooseMove(state, policy);
    if (!move) return { state, turns, stalled: !state.over };
    const result = applyMove(state, move);
    if (!result) return { state, turns, stalled: true };
    state = result.state;
    turns++;
  }

  return { state, turns, stalled: false };
}
