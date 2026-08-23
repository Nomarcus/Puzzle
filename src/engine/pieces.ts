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

/**
 * What a shape feels like to place. Piece packs re-weight whole families, so
 * a pack can change the character of a round without introducing a single new
 * shape — which is how the game gets variety without getting messy.
 */
export type Family = "dot" | "arc" | "wedge" | "brick" | "elbow" | "hook" | "fan" | "step" | "rosette";

export interface Piece {
  readonly id: string;
  readonly family: Family;
  readonly cells: readonly Offset[];
  /** Relative draw frequency. Tuned by tools/balance.ts, not by guesswork. */
  readonly weight: number;
  readonly radialExtent: number;
  readonly sectorExtent: number;
  readonly size: number;
}

function define(id: string, family: Family, cells: readonly Offset[], weight: number): Piece {
  const radialExtent = Math.max(...cells.map(([dr]) => dr)) + 1;
  const sectorExtent = Math.max(...cells.map(([, ds]) => ds)) + 1;
  return { id, family, cells, weight, radialExtent, sectorExtent, size: cells.length };
}

export const PIECES: readonly Piece[] = [
  // Single cell — the get-out-of-jail piece.
  define("dot", "dot", [[0, 0]], 8),

  // Arcs: runs along the sectors, they curve around the disc.
  define("arc2", "arc", [[0, 0], [0, 1]], 10),
  define("arc3", "arc", [[0, 0], [0, 1], [0, 2]], 10),
  define("arc4", "arc", [[0, 0], [0, 1], [0, 2], [0, 3]], 7),
  define("arc5", "arc", [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], 4),

  // Wedges: runs along the rings, they point outwards like spokes.
  define("wedge2", "wedge", [[0, 0], [1, 0]], 10),
  define("wedge3", "wedge", [[0, 0], [1, 0], [2, 0]], 8),

  // Curved bricks.
  define("brick", "brick", [[0, 0], [0, 1], [1, 0], [1, 1]], 9),
  define("brick23", "brick", [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]], 4),
  define("brick33", "brick", [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]], 2),

  // Corners — the four rotations of a 3-cell elbow.
  define("elbowA", "elbow", [[0, 0], [0, 1], [1, 0]], 7),
  define("elbowB", "elbow", [[0, 0], [0, 1], [1, 1]], 7),
  define("elbowC", "elbow", [[0, 0], [1, 0], [1, 1]], 7),
  define("elbowD", "elbow", [[0, 1], [1, 0], [1, 1]], 7),

  // Big elbows, 5 cells across three rings.
  define("hookOut", "hook", [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]], 3),
  define("hookIn", "hook", [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]], 3),

  // Fans — a T pointing in or out.
  define("fanOut", "fan", [[0, 0], [0, 1], [0, 2], [1, 1]], 5),
  define("fanIn", "fan", [[0, 1], [1, 0], [1, 1], [1, 2]], 5),

  // Staggered pairs.
  define("stepA", "step", [[0, 0], [0, 1], [1, 1], [1, 2]], 4),
  define("stepB", "step", [[0, 1], [0, 2], [1, 0], [1, 1]], 4),

  // Rosette — a plus, the most symmetrical piece in the set.
  define("rosette", "rosette", [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]], 3),
];

export const PIECES_BY_ID: ReadonlyMap<string, Piece> = new Map(PIECES.map((p) => [p.id, p]));

export function pieceById(id: string): Piece {
  const piece = PIECES_BY_ID.get(id);
  if (!piece) throw new Error(`Unknown piece id: ${id}`);
  return piece;
}

/**
 * A weighted draw table. Only shapes that physically fit the board are in it,
 * so a small disc never offers a piece that could not be placed anywhere.
 */
export interface Bag {
  readonly pieces: readonly Piece[];
  readonly cumulative: readonly number[];
  readonly total: number;
}

export function makeBag(rings: number, familyWeight: (family: Family) => number): Bag {
  const pieces: Piece[] = [];
  const cumulative: number[] = [];
  let total = 0;

  for (const piece of PIECES) {
    if (piece.radialExtent > rings) continue;
    const weight = piece.weight * familyWeight(piece.family);
    if (weight <= 0) continue;
    total += weight;
    pieces.push(piece);
    cumulative.push(total);
  }

  if (pieces.length === 0) throw new Error("Piece bag came out empty");
  return { pieces, cumulative, total };
}

/**
 * Draws one piece, weighted. Pure: takes an rng state, returns the next one.
 * Deliberately drawn with replacement rather than from a shuffled bag — a real
 * bag would let expert players count what is left, which turns the daily
 * puzzle into a memory test instead of a spatial one.
 */
export function drawPiece(bag: Bag, rngState: number): [piece: Piece, next: number] {
  const [value, next] = nextRandom(rngState);
  const roll = value * bag.total;

  for (let i = 0; i < bag.pieces.length; i++) {
    if (roll < bag.cumulative[i]!) return [bag.pieces[i]!, next];
  }
  return [bag.pieces[bag.pieces.length - 1]!, next];
}
