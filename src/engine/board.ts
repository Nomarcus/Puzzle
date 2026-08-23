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

/**
 * Cells are packed into a byte: the low bits carry the colour (1..8, with 0
 * meaning empty) and one high bit marks a striped block. Keeping it in a
 * Uint8Array rather than an object array is what lets a board be cloned dozens
 * of times a frame without the allocator noticing.
 */
export const STRIPE_FLAG = 16;

export function colourOf(value: number): number {
  return value & (STRIPE_FLAG - 1);
}

export function isStripedValue(value: number): boolean {
  return value >= STRIPE_FLAG;
}

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

/**
 * `stripedCell` is an index into piece.cells: that one cell is laid down as a
 * striped block. Undefined lays the piece down plain.
 */
export function place(
  board: Board,
  piece: Piece,
  r: number,
  s: number,
  colour: number,
  stripedCell?: number,
): Board {
  const next = cloneBoard(board);
  piece.cells.forEach(([dr, ds], i) => {
    const value = i === stripedCell ? colour | STRIPE_FLAG : colour;
    next.cells[cellIndex(board.spec, r + dr, s + ds)] = value;
  });
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
 * Spokes clear as well as rings, and they are deliberately the cheaper of the
 * two: a spoke is only as long as the disc has rings. That constant drain is
 * what keeps a round alive indefinitely, which is the point — this is a
 * high-score chase, not a puzzle with an ending. Rings are the rare prize, and
 * completing one at the same time as a spoke takes the whole board.
 */
export function findClears(board: Board, spokeClears = true): Clears {
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
 * A ring and a spoke completed by the same move. They cross, and the whole
 * disc goes with them — the biggest thing that can happen in a round.
 */
export function isBullseye(clears: Clears): boolean {
  return clears.rings.length > 0 && clears.spokes.length > 0;
}

/**
 * Empties the given rings and spokes. Returns the cleared cells too, because
 * the renderer needs to know exactly which tiles to burst.
 */
/**
 * Expands a clear by firing any striped blocks caught in it.
 *
 * A stripe takes the lines that cross it, and the expansion repeats, so one
 * stripe can set off another. Two or more firing in a single move sweep the
 * whole disc — the combination worth engineering, and the reason a stripe is
 * worth planting somewhere specific rather than anywhere.
 */
export interface Detonation {
  readonly clears: Clears;
  readonly stripes: number;
  readonly sweep: boolean;
}

export function detonate(board: Board, base: Clears): Detonation {
  const { rings: ringCount, sectors } = board.spec;
  const rings = new Set(base.rings);
  const spokes = new Set(base.spokes);
  const fired = new Set<number>();

  const consider = (r: number, s: number) => {
    const index = cellIndex(board.spec, r, s);
    if (fired.has(index)) return false;
    if (!isStripedValue(board.cells[index]!)) return false;
    fired.add(index);
    rings.add(r);
    spokes.add(s);
    return true;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const r of [...rings]) {
      for (let s = 0; s < sectors; s++) if (consider(r, s)) changed = true;
    }
    for (const s of [...spokes]) {
      for (let r = 0; r < ringCount; r++) if (consider(r, s)) changed = true;
    }
  }

  return {
    clears: { rings: [...rings].sort((a, b) => a - b), spokes: [...spokes].sort((a, b) => a - b) },
    stripes: fired.size,
    sweep: fired.size >= 2,
  };
}

export interface ClearedCell extends Cell {
  /**
   * The colour that was standing there. Reported rather than left for the
   * renderer to recover: after a spin the board has already moved, so the only
   * place this can be read correctly is here, before the cell is wiped.
   */
  readonly colour: number;
}

export function applyClears(
  board: Board,
  clears: Clears,
  sweep = isBullseye(clears),
): { board: Board; cells: ClearedCell[] } {
  if (!hasClears(clears)) return { board, cells: [] };

  const next = cloneBoard(board);
  const seen = new Set<number>();
  const cells: ClearedCell[] = [];

  const take = (r: number, s: number) => {
    const index = cellIndex(board.spec, r, s);
    if (seen.has(index)) return;
    seen.add(index);
    // A stripe widens a clear onto lines that are not themselves full, so some
    // of what it takes is empty space. Nothing happens to an empty cell and
    // there is nothing there to burst, so it is not a cleared cell.
    const value = colourOf(board.cells[index]!);
    if (value === 0) return;
    cells.push({ r, s, colour: value });
    next.cells[index] = 0;
  };

  if (sweep) {
    // A ring and a spoke together sweep the disc, filled cells and all.
    for (let r = 0; r < board.spec.rings; r++) {
      for (let s = 0; s < board.spec.sectors; s++) {
        if (board.cells[cellIndex(board.spec, r, s)] !== 0) take(r, s);
      }
    }
    return { board: next, cells };
  }

  for (const r of clears.rings) {
    for (let s = 0; s < board.spec.sectors; s++) take(r, s);
  }
  for (const s of clears.spokes) {
    for (let r = 0; r < board.spec.rings; r++) take(r, s);
  }

  return { board: next, cells };
}

/**
 * The colour every cell of a line shares, or 0 if they do not all match.
 *
 * Colour has been decoration until now. A line cleared in a single colour is
 * the one thing that earns a push, which gives the palette a job: it is worth
 * planning around without adding a rule anyone has to learn.
 *
 * Must be asked before the line is cleared, obviously.
 */
export function lineColour(board: Board, kind: "ring" | "spoke", index: number): number {
  const { rings, sectors } = board.spec;
  const length = kind === "ring" ? sectors : rings;
  let colour = 0;

  for (let i = 0; i < length; i++) {
    const raw =
      kind === "ring"
        ? board.cells[cellIndex(board.spec, index, i)]!
        : board.cells[cellIndex(board.spec, i, index)]!;
    // A stripe does not break a run of one colour; it is still that colour.
    const value = colourOf(raw);
    if (value === 0) return 0;
    if (colour === 0) colour = value;
    else if (colour !== value) return 0;
  }

  return colour;
}

/** How many of these cleared lines were a single colour. */
export function pureLines(board: Board, clears: Clears): number {
  let pure = 0;
  for (const r of clears.rings) if (lineColour(board, "ring", r) !== 0) pure++;
  for (const s of clears.spokes) if (lineColour(board, "spoke", s) !== 0) pure++;
  return pure;
}

export function filledCount(board: Board): number {
  let n = 0;
  for (const value of board.cells) if (value !== 0) n++;
  return n;
}
