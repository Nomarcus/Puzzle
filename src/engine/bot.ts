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
  findClears,
  hasClears,
  place,
} from "./board.js";
import { type GameState, type Move, applyMove, slotPiece } from "./game.js";
import { cellIndex } from "./geometry.js";
import type { SpinDirection } from "./rotate.js";
import { spinRing } from "./rotate.js";

const WEIGHTS = {
  /** A cleared line is worth far more than any positional consideration. */
  clearedLine: 900,
  ringBonus: 500,
  /** Cubed, so filling a line from 80% to 100% counts for much more than 0% to 20%. */
  lineProgress: 260,
  isolatedCell: 26,
  occupancy: 1.6,
} as const;

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

function afterClears(board: Board, spokeClears: boolean): { board: Board; value: number } {
  const clears = findClears(board, spokeClears);
  if (!hasClears(clears)) return { board, value: 0 };

  const lines = clears.rings.length + clears.spokes.length;
  const value = lines * WEIGHTS.clearedLine + clears.rings.length * WEIGHTS.ringBonus;
  return { board: applyClears(board, clears).board, value };
}

/**
 * The best move the bot can see, or null when it is out of options. Spins are
 * only considered once nothing can be placed — a stronger player would spin to
 * set up combos, so treat bot results as a floor, not a ceiling.
 */
export function chooseMove(state: GameState): Move | null {
  let best: Move | null = null;
  let bestValue = -Infinity;

  const maxRing = state.spec.rings;
  for (let slot = 0; slot < state.tray.length; slot++) {
    const piece = slotPiece(state.tray[slot] ?? null);
    if (!piece) continue;

    for (let r = 0; r + piece.radialExtent <= maxRing; r++) {
      for (let s = 0; s < state.spec.sectors; s++) {
        if (!canPlace(state.board, piece, r, s)) continue;
        const placed = place(state.board, piece, r, s, 1);
        const settled = afterClears(placed, state.spokeClears);
        const value = settled.value + boardValue(settled.board);
        if (value > bestValue) {
          bestValue = value;
          best = { type: "place", slot, r, s };
        }
      }
    }
  }

  if (best) return best;
  if (state.spins <= 0) return null;

  for (let ring = 0; ring < state.spec.rings; ring++) {
    for (const dir of [1, -1] as SpinDirection[]) {
      const spun = spinRing(state.board, ring, dir);
      const settled = afterClears(spun, state.spokeClears);

      // A spin is only worth it if it clears something or opens up a home.
      let opens = settled.value > 0;
      if (!opens) {
        for (const slot of state.tray) {
          const piece = slotPiece(slot);
          if (!piece) continue;
          for (let r = 0; r + piece.radialExtent <= maxRing && !opens; r++) {
            for (let s = 0; s < state.spec.sectors; s++) {
              if (canPlace(settled.board, piece, r, s)) {
                opens = true;
                break;
              }
            }
          }
          if (opens) break;
        }
      }
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

  return best;
}

export interface Playout {
  readonly state: GameState;
  readonly turns: number;
  /** True when the bot ran out of ideas before the rules declared it over. */
  readonly stalled: boolean;
}

export function playOut(start: GameState, maxTurns = 600): Playout {
  let state = start;
  let turns = 0;

  while (!state.over && turns < maxTurns) {
    const move = chooseMove(state);
    if (!move) return { state, turns, stalled: !state.over };
    const result = applyMove(state, move);
    if (!result) return { state, turns, stalled: true };
    state = result.state;
    turns++;
  }

  return { state, turns, stalled: false };
}
