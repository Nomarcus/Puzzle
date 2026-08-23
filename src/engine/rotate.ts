/**
 * The one special move in the whole game.
 *
 * Spinning a ring one sector needs no wrap-around rule, because a ring has no
 * edge. That is the entire reason the board is round: on a square grid you
 * have to teach the player that things falling off the right come back on the
 * left, and here there is nothing to teach.
 */

import { cellIndex, wrapSector } from "./geometry.js";
import { type Board, cloneBoard } from "./board.js";

export type SpinDirection = 1 | -1;

/**
 * Rotates one ring by a single sector. +1 moves each cell to the next sector
 * index, -1 goes the other way.
 */
export function spinRing(board: Board, ring: number, dir: SpinDirection): Board {
  const { spec } = board;
  if (ring < 0 || ring >= spec.rings) {
    throw new Error(`Ring ${ring} is outside the board`);
  }

  const next = cloneBoard(board);
  for (let s = 0; s < spec.sectors; s++) {
    const from = board.cells[cellIndex(spec, ring, s)]!;
    next.cells[cellIndex(spec, ring, wrapSector(spec, s + dir))] = from;
  }
  return next;
}
