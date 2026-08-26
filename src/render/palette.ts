/**
 * Palette eras: every ten depths, all eight colours change at once.
 *
 * Marcus's ask, and it is the one thing in the whole depth ladder that changes
 * the board rather than the light on it: same disc, same shapes, same rules,
 * an entirely new set of sweets. Block Blast and its relatives do this and it
 * is the reason a long session there does not go stale.
 *
 * ## Why a whole-palette swap is safe when shifting one colour is not
 *
 * A line only pays a spin if every cell shares one colour. That rule does not
 * care *which* eight colours are on the board, only that there are eight and
 * that a player can tell them apart. So swapping all eight together is safe;
 * nudging one of them is not, because it would drift toward a neighbour and two
 * blocks that used to be distinct would start reading as a match.
 *
 * ## The bar every era has to clear, and where it came from
 *
 * Measured off the shipped palette rather than invented:
 *
 * - Its smallest gap between any two hues is **17.4 degrees** (orange at 29 and
 *   lemon at 46).
 * - Its lowest saturation is **78%**.
 * - Its lightness runs **41% to 62%**.
 *
 * One thing that measurement corrected: `theme.ts` says the eight are "spaced
 * by lightness so they stay distinguishable for colour-blind players", and that
 * is only half true. The smallest lightness gap between neighbours in the
 * shipped palette is **zero** — orange and lemon are both at 50% and are told
 * apart by hue alone. So lightness spacing cannot be the bar, because the
 * palette everybody has been playing since day one would fail it.
 *
 * What every era below must therefore do is be *no worse than what already
 * ships*, on every axis, and the tests check exactly that. This is deliberately
 * a floor and not an ideal: if the shipped palette should be improved for
 * colour-blind players, that is a change to all eight at once and its own piece
 * of work, not something to smuggle in behind a feature about going deeper.
 */

import type { BlockColour, Theme } from "./theme.js";
import { deepen, hslToHex, toHSL } from "./depth.js";
import { lapAt, lapTrim, worldAt, worldChanged, worldIndex } from "./world.js";

/**
 * An era is now a Depth World's colour half.
 *
 * This file used to carry its own ten-depth counter and its own table of four
 * eras. Both are gone: `world.ts` is the single depth-driven table, and a world
 * carries the rotation it wants. Two systems each deciding when the colours
 * change is how a board ends up with the palette swapping on one schedule and
 * the finish on another.
 *
 * What has *not* changed is the guarantee, which is the important part: the
 * rotation is rigid. Hand-picking eight fresh colours per era was tried and
 * three of four candidates came in worse than what already ships — hues crowded
 * to 12.6 degrees against a floor of 17.4, saturation down to 49% against 78%.
 * Turning the existing eight together cannot do that, because every gap between
 * them is preserved exactly.
 */

/** A world's colour half, read straight off the world. */
export interface Era {
  readonly id: string;
  readonly label: string;
  readonly hueShift: number;
  readonly satBoost: number;
  readonly lightShift: number;
  readonly groundShift: number;
}

/**
 * A world's rotation, plus the deeper lap's small extra.
 *
 * Saturation and lightness move a little with the lap rather than with the
 * world, so a returning world is recognisably itself and still not identical.
 */
export function eraAt(depth: number): Era {
  const world = worldAt(depth);
  const trim = lapTrim(depth);
  const lap = lapAt(depth);
  return {
    id: lap > 0 ? `${world.id}-${lap}` : world.id,
    label: world.label,
    hueShift: world.hue,
    satBoost: Math.min(0.12, lap * 0.03),
    lightShift: lap % 2 === 1 ? -0.03 : 0,
    groundShift: world.ground + trim.ground * Math.sign(world.ground || 1),
  };
}

/** How many worlds deep, counting laps. Zero before the first change. */
export function eraIndex(depth: number): number {
  return worldIndex(depth);
}

/** Whether crossing into `to` started a new era. */
export function eraChanged(from: number, to: number): boolean {
  return worldChanged(from, to);
}

/**
 * The lit and shaded faces of a block, derived from its base.
 *
 * Hand-authored per colour for the shipped palette; derived for an era, because
 * an era is a whole set and keeping twenty-four values consistent by hand is how
 * a palette ends up with one block catching the light differently from the
 * other seven.
 */
function shades(base: string): BlockColour {
  const hsl = toHSL(base);
  if (!hsl) return { base, light: base, dark: base };
  return {
    base,
    light: hslToHex(hsl.h, Math.max(0, hsl.s - 0.06), Math.min(0.92, hsl.l + 0.14)),
    dark: hslToHex(hsl.h, Math.min(1, hsl.s + 0.06), Math.max(0.12, hsl.l - 0.15)),
  };
}

/** One block, turned into its era. */
function shift(colour: BlockColour, era: Era): BlockColour {
  const hsl = toHSL(colour.base);
  if (!hsl) return colour;
  // Lightness is clamped to the band the shipped palette already occupies, so
  // an era can never drift pale enough to lose contrast against the plate or
  // dark enough to stop looking like a sweet.
  const l = Math.max(0.36, Math.min(0.74, hsl.l + era.lightShift));
  const s = Math.min(1, hsl.s + era.satBoost);
  return shades(hslToHex(hsl.h + era.hueShift, s, l));
}

const CACHE = new Map<string, readonly BlockColour[]>();

/** The eight blocks an era paints with, given the theme underneath it. */
export function paletteFor(theme: Theme, era: Era): readonly BlockColour[] {
  if (era.hueShift === 0 && era.satBoost === 0 && era.lightShift === 0) return theme.blocks;
  const key = `${theme.id}:${era.id}`;
  const cached = CACHE.get(key);
  if (cached) return cached;
  const built = theme.blocks.map((c) => shift(c, era));
  CACHE.set(key, built);
  return built;
}

/**
 * The theme as it should look at this depth: era colours on the blocks, and the
 * ground nudged with them.
 *
 * Returned as a whole Theme rather than a palette threaded through every draw
 * call, because `theme` already reaches the board, the tray, the particles, the
 * drifters and the share card. One substitution at the top keeps all of them in
 * step, and a tray showing last era's sweets next to this era's board would be
 * the obvious bug.
 */
export function themeForDepth(theme: Theme, depth: number): Theme {
  const era = eraAt(depth);
  if (era.hueShift === 0 && era.satBoost === 0 && era.lightShift === 0 && era.groundShift === 0) {
    return theme;
  }
  return {
    ...theme,
    blocks: paletteFor(theme, era),
    backdrop: [rotate(theme.backdrop[0], era.groundShift), rotate(theme.backdrop[1], era.groundShift)],
  };
}

/**
 * Turns a colour a few degrees around the wheel, keeping everything else.
 *
 * The cap is what makes this obey the rule that depth modifies a theme and
 * never replaces it: fourteen degrees is a ground that has visibly changed and
 * is still unmistakably the one the player chose.
 */
function rotate(hex: string, degrees: number): string {
  if (degrees === 0) return hex;
  const hsl = toHSL(hex);
  if (!hsl) return hex;
  // Marcus's rule, and the reason Themes stay worth earning: a Depth World
  // *modifies* the player's Theme and never replaces it. Sky plus Ocean has to
  // still feel like Sky. Twenty degrees is a ground that has visibly moved and
  // is still unmistakably the one they chose.
  const capped = Math.max(-20, Math.min(20, degrees));
  return hslToHex(hsl.h + capped, hsl.s, hsl.l);
}

/** The ground at a depth: era rotation first, then the deepening on top. */
export function groundFor(theme: Theme, depth: number, shift: number): readonly [string, string] {
  const era = eraAt(depth);
  return [
    deepen(rotate(theme.backdrop[0], era.groundShift), shift * 0.55),
    deepen(rotate(theme.backdrop[1], era.groundShift), shift),
  ] as const;
}
