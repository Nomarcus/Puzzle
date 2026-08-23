/**
 * Piece shapes.
 *
 * A shape is a set of [dr, ds] offsets from its anchor cell. Because the board
 * is round, these read differently than on a square grid: a run along ds is an
 * ARC, a run along dr is a WEDGE, and a 2x2 is a curved BRICK. That is what
 * makes the tray look like soft symmetrical shapes rather than Tetris bars.
 *
 * Radial extent is capped at 3 so that no piece can span more than three of the
 * five rings — otherwise almost nothing fits once the disc starts filling up.
 */

import { nextRandom } from "./rng.js";

export type Offset = readonly [dr: number, ds: number];

export interface Piece {
  readonly id: string;
  readonly cells: readonly Offset[];
  /** Relative draw frequency. Tuned by tools/balance.ts, not by guesswork. */
  readonly weight: number;
  readonly radialExtent: number;
  readonly sectorExtent: number;
  readonly size: number;
}

function define(id: string, cells: readonly Offset[], weight: number): Piece {
  const radialExtent = Math.max(...cells.map(([dr]) => dr)) + 1;
  const sectorExtent = Math.max(...cells.map(([, ds]) => ds)) + 1;
  return { id, cells, weight, radialExtent, sectorExtent, size: cells.length };
}

export const PIECES: readonly Piece[] = [
  // Single cell — the get-out-of-jail piece.
  define("dot", [[0, 0]], 8),

  // Arcs: runs along the sectors, they curve around the disc.
  define("arc2", [[0, 0], [0, 1]], 10),
  define("arc3", [[0, 0], [0, 1], [0, 2]], 10),
  define("arc4", [[0, 0], [0, 1], [0, 2], [0, 3]], 7),
  define("arc5", [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], 4),

  // Wedges: runs along the rings, they point outwards like spokes.
  define("wedge2", [[0, 0], [1, 0]], 10),
  define("wedge3", [[0, 0], [1, 0], [2, 0]], 8),

  // Curved bricks.
  define("brick", [[0, 0], [0, 1], [1, 0], [1, 1]], 9),
  define("brick23", [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]], 4),
  define("brick33", [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]], 2),

  // Corners — the four rotations of a 3-cell elbow.
  define("elbowA", [[0, 0], [0, 1], [1, 0]], 7),
  define("elbowB", [[0, 0], [0, 1], [1, 1]], 7),
  define("elbowC", [[0, 0], [1, 0], [1, 1]], 7),
  define("elbowD", [[0, 1], [1, 0], [1, 1]], 7),

  // Big elbows, 5 cells across three rings.
  define("hookOut", [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]], 3),
  define("hookIn", [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]], 3),

  // Fans — a T pointing in or out.
  define("fanOut", [[0, 0], [0, 1], [0, 2], [1, 1]], 5),
  define("fanIn", [[0, 1], [1, 0], [1, 1], [1, 2]], 5),

  // Staggered pairs.
  define("stepA", [[0, 0], [0, 1], [1, 1], [1, 2]], 4),
  define("stepB", [[0, 1], [0, 2], [1, 0], [1, 1]], 4),

  // Rosette — a plus, the most symmetrical piece in the set.
  define("rosette", [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]], 3),
];

export const PIECES_BY_ID: ReadonlyMap<string, Piece> = new Map(PIECES.map((p) => [p.id, p]));

export function pieceById(id: string): Piece {
  const piece = PIECES_BY_ID.get(id);
  if (!piece) throw new Error(`Unknown piece id: ${id}`);
  return piece;
}

const TOTAL_WEIGHT = PIECES.reduce((sum, p) => sum + p.weight, 0);

/**
 * Draws one piece, weighted. Pure: takes an rng state, returns the next one.
 * Deliberately drawn with replacement rather than from a shuffled bag — a bag
 * would let expert players count what is left, which makes the daily puzzle a
 * memory test instead of a spatial one.
 */
export function drawPiece(rngState: number): [piece: Piece, next: number] {
  const [value, next] = nextRandom(rngState);
  const roll = value * TOTAL_WEIGHT;

  let acc = 0;
  for (const piece of PIECES) {
    acc += piece.weight;
    if (roll < acc) return [piece, next];
  }
  return [PIECES[PIECES.length - 1]!, next];
}
