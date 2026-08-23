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

/**
 * Pushes one spoke a single ring inwards or outwards.
 *
 * The sibling of a spin, along the other axis. It wraps too — a block shoved
 * off the rim comes back at the hub — which makes the disc a torus and means
 * the two moves are the same rule stated twice rather than two rules to learn.
 * Nothing is ever destroyed by a push.
 */
export function pushSpoke(board: Board, sector: number, dir: SpinDirection): Board {
  const { spec } = board;
  if (sector < 0 || sector >= spec.sectors) {
    throw new Error(`Sector ${sector} is outside the board`);
  }

  const next = cloneBoard(board);
  for (let r = 0; r < spec.rings; r++) {
    const from = board.cells[cellIndex(spec, r, sector)]!;
    const to = ((r + dir) % spec.rings + spec.rings) % spec.rings;
    next.cells[cellIndex(spec, to, sector)] = from;
  }
  return next;
}
