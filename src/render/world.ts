/**
 * Depth Worlds: what free play looks like as it goes down.
 *
 * Ten worlds, one every two depths, then the same ten again on a deeper lap.
 * This is the single depth-driven table in the renderer — everything else asks
 * `worldAt(depth)` and reads what it needs off the answer. There is deliberately
 * no depth branch anywhere in the drawing code.
 *
 * ## Why worlds own the finish
 *
 * The material ladder used to be driven by depth too, and the two collided:
 * `materialAt(20)` was already *diamond*, so a wood world at depth 20 would have
 * come out as grain plus facets plus sparkle. Three signatures on a cell that is
 * about sixteen pixels wide on a phone is exactly the mush this system has to
 * avoid.
 *
 * So `material.ts` is now a **vocabulary of finishes** rather than a ladder, and
 * a world names the one it wants. Style and surface stop competing, and where
 * they would overload each other the world wins — which is the brief's rule and
 * also the readable one.
 *
 * Each world hardens once at its halfway mark, which at a two-depth span means
 * the finish steps on every odd depth. So *something* changes at every single
 * depth: the world change gets the big moment on the evens, and the finish step
 * rides the announcement that already exists on the odds.
 *
 * ## What the depths are actually worth
 *
 * Measured with `npx vite-node tools/ramp.ts 24` across every disc and pack: the
 * median round runs 272–347 pieces, which at 22 pieces per depth is **depth
 * ~14**, and the browser bot could not be driven past 15.
 *
 * That number is why the span is two rather than the ten the brief first asked
 * for: at ten, a normal round saw two worlds and the other eight were content
 * nobody would ever reach. At two, a median round travels through eight of them
 * and a good one sees all ten.
 */

import type { PatternId } from "./pattern.js";
import type { MaterialId } from "./material.js";

/** What clear-bursts throw off in this world. */
export type ParticleShape = "confetti" | "seed" | "splinter" | "chip" | "glint" | "bubble" | "star" | "spark";

export interface DepthWorld {
  readonly id: string;
  /** Shown once, when the world is entered. */
  readonly label: string;
  /** First depth of the world, within a lap. */
  readonly from: number;
  readonly pattern: PatternId;
  /** How strongly the pattern is drawn, 0 to 1. */
  readonly patternStrength: number;
  /** The finish for the world's first half. */
  readonly finish: MaterialId;
  /** The finish from the halfway mark on. */
  readonly finishLate: MaterialId;
  /** Degrees the eight block colours turn. Rigid, so spacing is preserved. */
  readonly hue: number;
  /** Degrees the ground turns. Capped hard — the player's Theme has to survive. */
  readonly ground: number;
  readonly particle: ParticleShape;
}

/**
 * Depths per world, and therefore a finish step every other one.
 *
 * Two, not ten, and that is a measurement rather than a preference. The brief
 * asked for a world every ten depths, but `npx vite-node tools/ramp.ts 24` puts
 * the median round at 272–347 pieces — **depth ~14** — and the browser bot could
 * not be driven past 15. At ten, a normal round saw Candy and Fruit and the
 * other eight worlds were content nobody would ever reach.
 *
 * At two, a median round travels through **eight** of them and a good one sees
 * all ten. A world lands roughly every 44 pieces, which is a change often enough
 * to keep pulling and slow enough that nothing strobes.
 */
export const WORLD_SPAN = 2;

/** Worlds in a lap. Ten worlds, so a lap is twenty depths. */
export const LAP_SPAN = WORLD_SPAN * 10;

/**
 * The ten.
 *
 * Hue rotations step by roughly the golden angle rather than evenly, so
 * consecutive worlds are as unlike each other as the wheel allows — worlds 36
 * degrees apart would read as the same board under different lighting, which is
 * the opposite of the point. Over ten worlds the wheel still gets covered.
 *
 * Woodland and Crystal Cave reuse the grain and facet passes that already exist
 * and were tuned by eye, rather than growing lookalikes of them.
 */
const ORDER: readonly Omit<DepthWorld, "from">[] = [
  {
    id: "candy",
    label: "Candy",
    pattern: "none",
    patternStrength: 0,
    finish: "candy",
    finishLate: "glazed",
    // Zero, and it must stay zero: this is the game's own face, and free play's
    // opening depths have to look like the daily and the levels do.
    hue: 0,
    ground: 0,
    particle: "confetti",
  },
  {
    id: "fruit",
    label: "Fruit",
    pattern: "seeds",
    patternStrength: 0.8,
    finish: "glazed",
    finishLate: "matte",
    hue: 137,
    ground: 12,
    particle: "seed",
  },
  {
    id: "woodland",
    label: "Woodland",
    pattern: "grain",
    patternStrength: 0.85,
    finish: "wood",
    finishLate: "wood",
    hue: 275,
    ground: -14,
    particle: "splinter",
  },
  {
    id: "toybox",
    label: "Toy Box",
    pattern: "studs",
    patternStrength: 0.9,
    finish: "plastic",
    finishLate: "plastic",
    hue: 52,
    ground: 16,
    particle: "chip",
  },
  {
    id: "animal",
    label: "Animal",
    pattern: "spots",
    patternStrength: 0.75,
    finish: "matte",
    finishLate: "satin",
    hue: 190,
    ground: -10,
    particle: "chip",
  },
  {
    id: "crystal",
    label: "Crystal Cave",
    pattern: "facets",
    patternStrength: 1,
    finish: "crystal",
    finishLate: "diamond",
    hue: 327,
    ground: 14,
    particle: "glint",
  },
  {
    id: "ocean",
    label: "Ocean",
    pattern: "bubbles",
    patternStrength: 0.8,
    finish: "pearl",
    finishLate: "pearl",
    hue: 105,
    ground: -16,
    particle: "bubble",
  },
  {
    id: "space",
    label: "Space",
    pattern: "speckles",
    patternStrength: 0.8,
    finish: "glass",
    finishLate: "crystal",
    hue: 242,
    ground: 11,
    particle: "star",
  },
  {
    id: "arcade",
    label: "Arcade",
    pattern: "grid",
    patternStrength: 0.7,
    finish: "glow",
    finishLate: "glow",
    hue: 19,
    ground: -13,
    particle: "chip",
  },
  {
    id: "lava",
    label: "Lava",
    pattern: "cracks",
    patternStrength: 0.85,
    finish: "matte",
    finishLate: "molten",
    hue: 156,
    ground: 15,
    particle: "spark",
  },
];

/**
 * The ten, in order, with `from` derived rather than written down.
 *
 * Hand-written boundaries and a separately declared span are two sources of the
 * same truth, and changing the span from ten to two would have silently left
 * them disagreeing.
 */
export const WORLDS: readonly DepthWorld[] = ORDER.map((world, i) => ({
  ...world,
  from: i * WORLD_SPAN,
}));

export const CANDY_WORLD = WORLDS[0]!;

/**
 * Which lap of the ten a depth is on. Zero for the first twenty.
 *
 * Depth is unbounded in the engine — the stone dial keeps tightening forever, so
 * there is no depth the game refuses to go past — and a world table that ran out
 * would leave the deepest players looking at nothing.
 */
export function lapAt(depth: number): number {
  if (!Number.isFinite(depth) || depth <= 0) return 0;
  return Math.floor(depth / LAP_SPAN);
}

/** The world a depth is in, ignoring which lap. */
export function worldAt(depth: number): DepthWorld {
  if (!Number.isFinite(depth) || depth <= 0) return CANDY_WORLD;
  const within = Math.floor(depth) % LAP_SPAN;
  const index = Math.floor(within / WORLD_SPAN);
  return WORLDS[Math.min(index, WORLDS.length - 1)]!;
}

/** How many worlds deep in total, counting laps. Zero before the first change. */
export function worldIndex(depth: number): number {
  if (!Number.isFinite(depth) || depth <= 0) return 0;
  return Math.floor(Math.floor(depth) / WORLD_SPAN);
}

/** Whether crossing into `to` entered a new world, so the game can announce it. */
export function worldChanged(from: number, to: number): boolean {
  return worldIndex(to) > worldIndex(from);
}

/** Depths left in the current world. Used for the "next world" hint. */
export function depthsToNextWorld(depth: number): number {
  if (!Number.isFinite(depth) || depth < 0) return WORLD_SPAN;
  const whole = Math.floor(depth);
  return WORLD_SPAN - (whole % WORLD_SPAN);
}

/** The world after this one, which is what the hint names. */
export function nextWorld(depth: number): DepthWorld {
  return worldAt(Math.floor(Math.max(0, depth)) + depthsToNextWorld(depth));
}

/**
 * Whether a depth is in the back half of its world, where the finish hardens.
 *
 * With a two-depth span this is every odd depth, so something changes at every
 * depth without a second concept: the world change carries the big moment on the
 * evens and this rides the material announcement on the odds.
 */
export function inLateHalf(depth: number): boolean {
  if (!Number.isFinite(depth) || depth <= 0) return false;
  return Math.floor(depth) % WORLD_SPAN >= WORLD_SPAN / 2;
}

/** Which finish the world is wearing at this depth. */
export function finishAt(depth: number): MaterialId {
  const world = worldAt(depth);
  return inLateHalf(depth) ? world.finishLate : world.finish;
}

/**
 * A deeper lap of the same world, made a little more exclusive.
 *
 * Kept to one notch per lap and capped: the point is that a returning world
 * feels earned, not that lap four is unreadable. Pattern strength deliberately
 * does *not* climb — a stronger pattern is the one change that would cost
 * legibility, which is the thing this system may never spend.
 */
export interface LapTrim {
  /** Extra sparkle added to the world's finish. */
  readonly sparkle: number;
  /** Extra degrees on the ground rotation, still capped downstream. */
  readonly ground: number;
  /** Picks the alternate variant of the world's pattern. */
  readonly variant: boolean;
}

export function lapTrim(depth: number): LapTrim {
  const lap = Math.min(lapAt(depth), 3);
  return {
    sparkle: lap * 0.08,
    ground: lap * 3,
    variant: lap % 2 === 1,
  };
}
