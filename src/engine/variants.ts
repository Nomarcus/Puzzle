/**
 * Board sizes and piece packs.
 *
 * The rules never change — you still drag, still spin, still clear a ring or a
 * spoke. Only the size of the disc and what turns up in the tray vary. That is
 * the whole trick: there is never anything new to learn, so variety can be
 * added without the game becoming a mess.
 *
 * Changing the size is not just cosmetic — a ring is as long as the disc has
 * sectors, so the small disc asks for 8 in a row and the large one for 12. The
 * same rules produce a quick scramble or a long haul.
 */

import type { BoardSpec } from "./geometry.js";
import { type Bag, type Family, makeBag } from "./pieces.js";
import { nextInt } from "./rng.js";

export type SizeId = "small" | "standard" | "large";
export type PackId = "mixed" | "curves" | "chunks";

export interface BoardSize {
  readonly id: SizeId;
  readonly spec: BoardSpec;
}

export const SIZES: readonly BoardSize[] = [
  { id: "small", spec: { rings: 5, sectors: 8 } },
  { id: "standard", spec: { rings: 6, sectors: 10 } },
  { id: "large", spec: { rings: 7, sectors: 12 } },
];

/**
 * Multipliers on each family's base weight. Every family keeps a non-zero
 * weight in every pack — a pack that removed a family outright would make some
 * boards unsolvable, and the dot in particular is the get-out-of-jail piece.
 */
export interface PiecePack {
  readonly id: PackId;
  readonly weights: Readonly<Record<Family, number>>;
}

export const PACKS: readonly PiecePack[] = [
  {
    id: "mixed",
    weights: { dot: 1, arc: 1, wedge: 1, brick: 1, elbow: 1, hook: 1, fan: 1, step: 1, rosette: 1 },
  },
  {
    // Everything flows: long arcs and sweeping hooks, hardly any solid blocks.
    id: "curves",
    weights: {
      dot: 1,
      arc: 2.2,
      wedge: 0.8,
      brick: 0.25,
      elbow: 0.7,
      hook: 1.6,
      fan: 1.4,
      step: 1.3,
      rosette: 0.8,
    },
  },
  {
    // Heavy and blocky. The 3x3 brick reads as a fat cube on the disc.
    id: "chunks",
    weights: {
      dot: 1,
      arc: 0.45,
      wedge: 1.2,
      brick: 2.6,
      elbow: 1.6,
      hook: 0.7,
      fan: 0.8,
      step: 0.8,
      rosette: 1.5,
    },
  },
];

export const DEFAULT_SIZE: SizeId = "standard";
export const DEFAULT_PACK: PackId = "mixed";

export function sizeById(id: SizeId): BoardSize {
  return SIZES.find((size) => size.id === id) ?? SIZES[1]!;
}

export function packById(id: PackId): PiecePack {
  return PACKS.find((pack) => pack.id === id) ?? PACKS[0]!;
}

/** Bags are pure functions of (rings, pack), so they are built once and reused. */
const bagCache = new Map<string, Bag>();

export function bagFor(rings: number, packId: PackId): Bag {
  const key = `${rings}:${packId}`;
  const cached = bagCache.get(key);
  if (cached) return cached;

  const pack = packById(packId);
  const bag = makeBag(rings, (family) => pack.weights[family]);
  bagCache.set(key, bag);
  return bag;
}

export interface Variant {
  readonly size: SizeId;
  readonly pack: PackId;
}

/**
 * The daily variant, derived from the date seed. Every player in the world
 * gets the same disc and the same bag on the same day, so rotating the setup
 * makes each day feel new without touching the fairness of the competition.
 */
export function dailyVariant(seed: number): Variant {
  const [sizeIndex, afterSize] = nextInt(seed, SIZES.length);
  const [packIndex] = nextInt(afterSize, PACKS.length);
  return { size: SIZES[sizeIndex]!.id, pack: PACKS[packIndex]!.id };
}
