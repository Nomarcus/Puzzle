/**
 * The disc itself, and every question you can ask of it.
 *
 * Cells hold 0 for empty, or a colour id in 1..N. Boards are treated as
 * immutable: every operation returns a fresh board so the game state can be
 * snapshotted, replayed and diffed by the renderer.
 */

import {
  type BoardSpec,
  type Cell,
  cellCount,
  cellIndex,
  ringInRange,
  wrapSector,
} from "./geometry.js";
import type { Piece } from "./pieces.js";

export interface Board {
  readonly spec: BoardSpec;
  readonly cells: Uint8Array;
}

export interface Clears {
  /** Ring indices that are completely filled — the whole circle pops. */
  readonly rings: number[];
  /** Sector indices filled from the centre out — a spoke pops. */
  readonly spokes: number[];
}

export function createBoard(spec: BoardSpec): Board {
  return { spec, cells: new Uint8Array(cellCount(spec)) };
}

export function cloneBoard(board: Board): Board {
  return { spec: board.spec, cells: new Uint8Array(board.cells) };
}

export function getCell(board: Board, r: number, s: number): number {
  if (!ringInRange(board.spec, r)) return 0;
  return board.cells[cellIndex(board.spec, r, s)]!;
}

export function isEmpty(board: Board, r: number, s: number): boolean {
  return ringInRange(board.spec, r) && board.cells[cellIndex(board.spec, r, s)] === 0;
}

/** Absolute cells a piece would occupy if anchored at (r, s). Sectors wrap. */
export function pieceCells(board: Board, piece: Piece, r: number, s: number): Cell[] {
  return piece.cells.map(([dr, ds]) => ({
    r: r + dr,
    s: wrapSector(board.spec, s + ds),
  }));
}

export function canPlace(board: Board, piece: Piece, r: number, s: number): boolean {
  // Rings have hard edges; a piece may not hang off the inner or outer rim.
  if (r < 0 || r + piece.radialExtent > board.spec.rings) return false;
  for (const [dr, ds] of piece.cells) {
    if (!isEmpty(board, r + dr, s + ds)) return false;
  }
  return true;
}

export function place(board: Board, piece: Piece, r: number, s: number, colour: number): Board {
  const next = cloneBoard(board);
  for (const [dr, ds] of piece.cells) {
    next.cells[cellIndex(board.spec, r + dr, s + ds)] = colour;
  }
  return next;
}

/** Every anchor where this piece fits right now. */
export function placements(board: Board, piece: Piece): Cell[] {
  const found: Cell[] = [];
  const maxRing = board.spec.rings - piece.radialExtent;
  for (let r = 0; r <= maxRing; r++) {
    for (let s = 0; s < board.spec.sectors; s++) {
      if (canPlace(board, piece, r, s)) found.push({ r, s });
    }
  }
  return found;
}

export function hasPlacement(board: Board, piece: Piece): boolean {
  const maxRing = board.spec.rings - piece.radialExtent;
  for (let r = 0; r <= maxRing; r++) {
    for (let s = 0; s < board.spec.sectors; s++) {
      if (canPlace(board, piece, r, s)) return true;
    }
  }
  return false;
}

/**
 * Rings and spokes are checked together and pop simultaneously, so a placement
 * that completes both cashes in as one big combined clear.
 *
 * Spoke clears are off by default, and that is a measured decision rather than
 * a simplification. A spoke is only as long as the disc has rings, so it was
 * far cheaper than a ring and cleared constantly — which drained the board
 * faster than it could fill, so rounds never ended, rings almost never
 * completed and the spin was never needed. The flag stays so tools/experiment
 * can re-check that call against any future board shape.
 */
export function findClears(board: Board, spokeClears = false): Clears {
  const { rings: ringCount, sectors } = board.spec;
  const rings: number[] = [];
  const spokes: number[] = [];

  for (let r = 0; r < ringCount; r++) {
    let full = true;
    for (let s = 0; s < sectors; s++) {
      if (board.cells[cellIndex(board.spec, r, s)] === 0) {
        full = false;
        break;
      }
    }
    if (full) rings.push(r);
  }

  if (spokeClears) {
    for (let s = 0; s < sectors; s++) {
      let full = true;
      for (let r = 0; r < ringCount; r++) {
        if (board.cells[cellIndex(board.spec, r, s)] === 0) {
          full = false;
          break;
        }
      }
      if (full) spokes.push(s);
    }
  }

  return { rings, spokes };
}

export function hasClears(clears: Clears): boolean {
  return clears.rings.length > 0 || clears.spokes.length > 0;
}

/**
 * Empties the given rings and spokes. Returns the cleared cells too, because
 * the renderer needs to know exactly which tiles to burst.
 */
export function applyClears(board: Board, clears: Clears): { board: Board; cells: Cell[] } {
  if (!hasClears(clears)) return { board, cells: [] };

  const next = cloneBoard(board);
  const seen = new Set<number>();
  const cells: Cell[] = [];

  const take = (r: number, s: number) => {
    const index = cellIndex(board.spec, r, s);
    if (seen.has(index)) return;
    seen.add(index);
    cells.push({ r, s });
    next.cells[index] = 0;
  };

  for (const r of clears.rings) {
    for (let s = 0; s < board.spec.sectors; s++) take(r, s);
  }
  for (const s of clears.spokes) {
    for (let r = 0; r < board.spec.rings; r++) take(r, s);
  }

  return { board: next, cells };
}

export function filledCount(board: Board): number {
  let n = 0;
  for (const value of board.cells) if (value !== 0) n++;
  return n;
}
