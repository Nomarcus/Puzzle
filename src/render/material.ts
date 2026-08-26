/**
 * The finishes a block can wear.
 *
 * This used to be a depth ladder of its own. It is now a **vocabulary**: a
 * Depth World names the finish it wants (see `world.ts`), and nothing here reads
 * the depth. That is a correction rather than a refactor for its own sake — with
 * both systems driven by depth they collided, because `materialAt(20)` was
 * already *diamond*, so a wood world at depth 20 came out as grain plus facets
 * plus sparkle. Three signatures on a cell that is sixteen pixels wide on a
 * phone is exactly the mush the world system has to avoid.
 *
 * Style and surface therefore stop competing, and where they would overload each
 * other the world wins, which is both the brief's rule and the readable one.
 *
 * The hard constraint is unchanged and is the reason this is a finish vocabulary
 * rather than a colour one: **a line only pays a spin if every cell shares one
 * colour**. So every finish paints the same `colour.base` fill underneath and
 * changes only what happens on top — highlights, edge light, cuts, glints.
 * Nothing here shifts a hue, and nothing may wash the body out toward white,
 * because a pale strawberry and a pale bubblegum are the same block to somebody
 * matching by lightness.
 *
 * One trap worth keeping in mind for anything added later: **stone has to stay
 * obviously not-a-block**. It is the one thing on the disc that is not a sweet to
 * be cleared, it is grey and off-palette on purpose, and "hard shiny mineral" is
 * exactly what the top of this vocabulary is. What keeps them apart is
 * saturation, so no finish may drain the body's colour.
 */

export type MaterialId =
  | "candy"
  | "glazed"
  | "matte"
  | "satin"
  | "wood"
  | "plastic"
  | "glass"
  | "pearl"
  | "glow"
  | "molten"
  | "crystal"
  | "diamond";

export interface Material {
  readonly id: MaterialId;
  /** Shown to the player when the tier is reached. */
  readonly label: string;
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
 * Twelve finishes.
 *
 * `gloss`/`glossAlpha` are the specular streak, `rim` the light catching the
 * cell's edge, `facets` the cut faces, `sparkle` how many cells carry a glint.
 * Everything is a fraction of the cell so it scales with the disc.
 *
 * `candy` must stay exactly what shipped: it is what the daily, the levels, the
 * challenges and time attack all wear, and what free play's first ten depths
 * wear too, so a change here is a change to the game's own face.
 */
export const MATERIALS: readonly Material[] = [
  { id: "candy", label: "Candy", gloss: 0.1, glossAlpha: 0.42, rim: 0, facets: 0, facetDepth: 0, sparkle: 0 },
  { id: "glazed", label: "Glazed", gloss: 0.16, glossAlpha: 0.6, rim: 0.14, facets: 0, facetDepth: 0, sparkle: 0 },
  // Matte is the one finish that goes *down*: fruit skin and animal hide are not
  // wet, and killing the specular is the whole tell.
  { id: "matte", label: "Matte", gloss: 0.06, glossAlpha: 0.16, rim: 0.06, facets: 0, facetDepth: 0, sparkle: 0 },
  { id: "satin", label: "Satin", gloss: 0.14, glossAlpha: 0.38, rim: 0.12, facets: 0, facetDepth: 0, sparkle: 0 },
  { id: "wood", label: "Wood", gloss: 0.16, glossAlpha: 0.5, rim: 0.1, facets: 0, facetDepth: 0, sparkle: 0 },
  // Injection-moulded plastic: a hard, tight highlight rather than a broad one.
  { id: "plastic", label: "Plastic", gloss: 0.12, glossAlpha: 0.82, rim: 0.22, facets: 0, facetDepth: 0, sparkle: 0 },
  { id: "glass", label: "Glass", gloss: 0.2, glossAlpha: 0.78, rim: 0.26, facets: 0, facetDepth: 0, sparkle: 0 },
  { id: "pearl", label: "Pearl", gloss: 0.26, glossAlpha: 0.62, rim: 0.24, facets: 0, facetDepth: 0, sparkle: 0.1 },
  { id: "glow", label: "Glow", gloss: 0.18, glossAlpha: 0.72, rim: 0.42, facets: 0, facetDepth: 0, sparkle: 0.12 },
  { id: "molten", label: "Molten", gloss: 0.22, glossAlpha: 0.68, rim: 0.3, facets: 0, facetDepth: 0, sparkle: 0.16 },
  { id: "crystal", label: "Crystal", gloss: 0.22, glossAlpha: 0.85, rim: 0.32, facets: 2, facetDepth: 0.12, sparkle: 0.14 },
  { id: "diamond", label: "Diamond", gloss: 0.24, glossAlpha: 0.95, rim: 0.4, facets: 3, facetDepth: 0.17, sparkle: 0.3 },
];

const BY_ID = new Map(MATERIALS.map((m) => [m.id, m]));

/** The finish a world named. Falls back to candy rather than throwing. */
export function materialById(id: MaterialId): Material {
  return BY_ID.get(id) ?? MATERIALS[0]!;
}

/** A deeper lap wears the same finish with a little more glint. */
export function withSparkle(material: Material, extra: number): Material {
  if (extra <= 0) return material;
  return { ...material, sparkle: Math.min(0.45, material.sparkle + extra) };
}

export const CANDY = MATERIALS[0]!;

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
