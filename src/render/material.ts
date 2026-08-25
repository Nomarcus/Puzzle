/**
 * What the blocks are made of, and how that changes as a round goes deeper.
 *
 * The ladder is candy → glazed → glass → crystal → diamond. It exists because a
 * player who has gone a very long way should be able to see that they have,
 * from the blocks themselves and not from a number, and because "the sweets
 * turned to diamond" is a reward you can feel without anybody explaining it.
 *
 * The hard constraint is the same one that governs `depth.ts`, and it is the
 * reason this is a *finish* ladder rather than a colour ladder: **a line only
 * pays a spin if every cell shares one colour**, and the eight hues are spaced
 * by lightness so they stay apart for colour-blind players. So every tier below
 * paints the same `colour.base` fill underneath and only changes what happens
 * on top of it — highlights, facet cuts, edge light. Nothing here shifts a hue,
 * and nothing here is allowed to wash the body out toward white, because a pale
 * strawberry and a pale bubblegum are the same block to somebody who is
 * matching by lightness.
 *
 * One thing the ladder must not do, which is easy to miss: **stone has to stay
 * obviously not-a-block**. Stone is the one thing on the disc that is not a
 * sweet to be cleared, it is grey and off-palette on purpose, and "hard shiny
 * mineral" is exactly what the top of this ladder is. What keeps them apart is
 * saturation — a diamond block is a fully saturated red or green with facets
 * cut into it, and stone has no hue at all — so no tier may drain the body's
 * colour, or the threat stops reading as a threat.
 */

export interface Material {
  readonly id: string;
  /** Shown to the player when the tier is reached. */
  readonly label: string;
  /** First depth that uses this tier. The first entry must be 0. */
  readonly from: number;
  /** Width of the specular streak, as a fraction of the cell's width. */
  readonly gloss: number;
  /** How bright that streak is. */
  readonly glossAlpha: number;
  /** A light catching the cell's whole edge. 0 for none. */
  readonly rim: number;
  /** Radial cuts across the cell, which is what reads as "cut" rather than "wet". */
  readonly facets: number;
  /** How hard the facets are shaded apart. */
  readonly facetDepth: number;
  /** A star glint on a scattering of cells. 0 for none. */
  readonly sparkle: number;
}

/**
 * Five tiers, spaced three depths apart.
 *
 * Three depths is about 66 pieces, which on the bot's numbers is a couple of
 * minutes of real play — long enough that arriving somewhere feels earned and
 * short enough that a good run passes through several. The last tier is
 * open-ended: past depth 12 there is nothing further to become, and the rim
 * counter carries the reward on alone from there.
 */
export const MATERIALS: readonly Material[] = [
  {
    id: "candy",
    label: "Candy",
    from: 0,
    gloss: 0.1,
    glossAlpha: 0.42,
    rim: 0,
    facets: 0,
    facetDepth: 0,
    sparkle: 0,
  },
  {
    id: "glazed",
    label: "Glazed",
    from: 3,
    gloss: 0.16,
    glossAlpha: 0.6,
    rim: 0.14,
    facets: 0,
    facetDepth: 0,
    sparkle: 0,
  },
  {
    id: "glass",
    label: "Glass",
    from: 6,
    gloss: 0.2,
    glossAlpha: 0.78,
    rim: 0.26,
    facets: 0,
    facetDepth: 0,
    sparkle: 0,
  },
  {
    id: "crystal",
    label: "Crystal",
    from: 9,
    gloss: 0.22,
    glossAlpha: 0.85,
    rim: 0.32,
    facets: 2,
    facetDepth: 0.12,
    sparkle: 0.14,
  },
  {
    id: "diamond",
    label: "Diamond",
    from: 12,
    gloss: 0.24,
    glossAlpha: 0.95,
    rim: 0.4,
    facets: 3,
    facetDepth: 0.17,
    sparkle: 0.3,
  },
];

export const CANDY = MATERIALS[0]!;

/**
 * The tier a depth is in.
 *
 * Depth 0 is candy, which is what every other mode is: the daily, the levels,
 * the challenges and time attack all run without a ramp, so their depth is
 * structurally zero and they get the block they have always had.
 */
export function materialAt(depth: number): Material {
  if (!Number.isFinite(depth) || depth <= 0) return CANDY;
  let found = CANDY;
  for (const material of MATERIALS) {
    if (depth >= material.from) found = material;
  }
  return found;
}

/** The tier index, for anything that needs to compare two of them. */
export function materialIndex(depth: number): number {
  const material = materialAt(depth);
  return MATERIALS.indexOf(material);
}

/**
 * Whether crossing into `depth` entered a new tier, so the game can say so.
 *
 * Reads both depths rather than tracking a flag, because the ramp is a pure
 * function of pieces placed and anything that has to be remembered separately
 * is a thing that can fall out of step with a replay.
 */
export function materialChanged(from: number, to: number): boolean {
  return materialIndex(to) > materialIndex(from);
}

/**
 * A stable 0..1 per cell, so a sparkle stays on the same blocks from frame to
 * frame instead of crawling over the board.
 *
 * Hashed from the cell's own position rather than seeded from the RNG: the
 * engine's randomness is threaded through game state for replay, and a
 * decoration must never take a draw from it.
 */
export function cellNoise(radius: number, angle: number): number {
  const n = Math.sin(radius * 12.9898 + angle * 78.233) * 43758.5453;
  return n - Math.floor(n);
}
