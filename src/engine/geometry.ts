/**
 * The board is a ring of sectors, not a square grid.
 *
 * A cell is addressed as (r, s):
 *   r = ring index, 0 is innermost. Rings have hard edges — a piece may not
 *       hang off the inside or outside of the disc.
 *   s = sector index, counted clockwise. Sectors wrap: sector `sectors` IS
 *       sector 0. This is the whole point of the game, so every sector index
 *       that enters the engine goes through wrapSector first.
 */

export interface BoardSpec {
  readonly rings: number;
  readonly sectors: number;
}

/** Starting point, not a decision — tools/balance.ts settles the real numbers. */
export const DEFAULT_SPEC: BoardSpec = { rings: 6, sectors: 10 };

export type Cell = { readonly r: number; readonly s: number };

export function cellCount(spec: BoardSpec): number {
  return spec.rings * spec.sectors;
}

/** Normalises any integer sector into [0, sectors). Handles negatives. */
export function wrapSector(spec: BoardSpec, s: number): number {
  const n = spec.sectors;
  return ((s % n) + n) % n;
}

export function ringInRange(spec: BoardSpec, r: number): boolean {
  return r >= 0 && r < spec.rings;
}

export function cellIndex(spec: BoardSpec, r: number, s: number): number {
  return r * spec.sectors + wrapSector(spec, s);
}

export function indexToCell(spec: BoardSpec, index: number): Cell {
  return { r: Math.floor(index / spec.sectors), s: index % spec.sectors };
}

/**
 * Shortest signed distance from sector `from` to sector `to`, taking the wrap
 * into account. Used by the spin gesture to work out which way the thumb went.
 */
export function sectorDelta(spec: BoardSpec, from: number, to: number): number {
  const n = spec.sectors;
  const raw = wrapSector(spec, to - from);
  return raw > n / 2 ? raw - n : raw;
}
