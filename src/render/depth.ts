/**
 * What depth looks like.
 *
 * The ramp already changes the rules every 22 pieces — a heavier bag, fewer
 * spins, stone creeping in from the rim. Until now it changed nothing you could
 * see, so depth 8 looked exactly like depth 0 and a long run felt like a short
 * one that had gone on a while.
 *
 * Three rules constrain everything in here, and the third one rules out what
 * almost every other game does:
 *
 * 1. **Depth modifies the theme, it never replaces it.** Seven themes, four of
 *    them earned with lifetime score. If depth overwrote the colours, choosing
 *    Bubblegum would stop meaning anything and the unlocks would lose their
 *    point. So this module only ever transforms whatever theme it is handed.
 * 2. **Block colour is off limits.** A line only pays a spin if every cell
 *    shares one colour, and the eight hues are spaced by lightness so they stay
 *    apart for colour-blind players. Nothing here touches `theme.blocks`.
 * 3. **It cannot drain the colour.** Dark slate, neon, a violet gradient — the
 *    whole default way of signalling depth is exactly the look the brief rules
 *    out. So the ladder runs the other way: each theme *saturates into its own
 *    hue*, and the screen gets richer rather than greyer.
 *
 * Rule 3 took three attempts to satisfy, and the first two are worth recording
 * because both looked correct in the source and wrong on the screen:
 *
 * - **Blending the backdrop toward gold cancels to grey.** Sky's blue and gold
 *   are near-complementary, so interpolating between them in RGB destroys the
 *   saturation; by depth 9 the screen was mud.
 * - **Compositing gold in `overlay` bleaches instead.** Sky's blue channel is
 *   already at maximum, so overlay screens it and the whole screen washed out
 *   toward white.
 *
 * Blue simply cannot travel to gold: the short way round the wheel passes
 * through green, which fights the green blocks, and the long way passes through
 * violet, which the brief forbids. Holding the hue and pushing the saturation
 * sidesteps all of it — and it is the better idea anyway, because every theme
 * then intensifies into itself with no per-theme colour to hand-pick.
 */

/**
 * How far along the ladder a depth sits, 0 to 1.
 *
 * Reaches full at depth 9 rather than at the ramp's `maxDepth` of 8, so the
 * look is still moving one depth after the mechanics have levelled off — the
 * stone dial carries on alone past that point, and the screen should not go
 * quiet exactly where the round gets hardest.
 */
export function depthProgress(depth: number): number {
  if (!Number.isFinite(depth) || depth <= 0) return 0;
  return Math.min(1, depth / 9);
}

/**
 * Capped well short of 1. At full strength every theme converges on the same
 * saturated slab and Rule 1 quietly stops being true, so the ceiling is the
 * thing that keeps Sky recognisably Sky at the bottom of a long run.
 */
const MAX_SHIFT = 0.45;

export function depthShift(depth: number): number {
  return depthProgress(depth) * MAX_SHIFT;
}

interface HSL {
  readonly h: number;
  readonly s: number;
  readonly l: number;
}

/** Accepts `#rgb` and `#rrggbb`. Anything else is passed through untouched. */
function parseHex(hex: string): readonly [number, number, number] | null {
  const raw = hex.trim().replace(/^#/, "");
  const full = raw.length === 3 ? raw.replace(/./g, (c) => c + c) : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHSL(hex: string): HSL | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0]
    : hp < 2 ? [x, c, 0]
    : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c]
    : hp < 5 ? [x, 0, c]
    : [c, 0, x];
  const m = l - c / 2;
  const hex = (v: number) =>
    Math.round(Math.min(255, Math.max(0, (v + m) * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${hex(r1)}${hex(g1)}${hex(b1)}`;
}

/**
 * The theme's own colour, deeper.
 *
 * Hue is held exactly. Saturation climbs toward full and lightness drops a
 * little — enough to read as further in, nowhere near enough to read as a dark
 * theme, which the floor below guarantees no matter how deep the round goes.
 *
 * A colour this cannot parse comes back unchanged rather than throwing: this
 * runs inside a draw call, and a bad theme value should cost a shade, not the
 * frame.
 */
export function deepen(hex: string, shift: number): string {
  const hsl = toHSL(hex);
  if (!hsl || shift <= 0) return hex;
  const t = Math.min(1, Math.max(0, shift));
  const s = Math.min(1, hsl.s + (1 - hsl.s) * t * 0.9);
  // Never below this, on any theme, at any depth. Lemonade's ground starts at
  // 0.56 lightness and Sky's at 0.69; the floor is what stops a long round
  // arriving anywhere near a dashboard.
  const l = Math.max(0.42, hsl.l - t * 0.3);
  // Hex out, hex in: the result is handed straight back into code that has only
  // ever seen theme colours, so it has to be the same kind of value one is —
  // interchangeable, and able to round-trip through toHSL for the tests that
  // prove the hue never drifts.
  return hslToHex(hsl.h, s, l);
}

/** Segments in the plate's rim. Twelve reads as a clock face without counting. */
export const BEZEL_SEGMENTS = 12;

/**
 * How the rim reads at a given depth: how many segments are lit, and which lap
 * they are on.
 *
 * Depth is deliberately unbounded in the engine — the stone dial keeps tighten-
 * ing forever, so there is no depth the game refuses to go past — which means
 * the rim has to say something at depth 30 as well as at depth 3. It fills,
 * then fills again in a hotter colour. Nobody will see lap 3, but nothing
 * breaks if they do.
 */
export function bezel(depth: number): { lit: number; lap: number } {
  if (!Number.isFinite(depth) || depth <= 0) return { lit: 0, lap: 0 };
  const whole = Math.floor(depth);
  const lap = Math.floor(whole / BEZEL_SEGMENTS);
  const lit = whole - lap * BEZEL_SEGMENTS;
  // A completed lap shows as a full rim rather than an empty one: at exactly
  // 12, 24, 36 the remainder is zero, and blanking the rim at the moment it
  // completes would read as losing the run rather than finishing a lap.
  if (lit === 0) return { lit: BEZEL_SEGMENTS, lap: lap - 1 };
  return { lit, lap };
}

/**
 * The lit segments walk lemon to orange across a lap, and each further lap
 * starts hotter. All four are candy colours already in the palette — the rim is
 * warm because warm is what is left once dark and neon are both ruled out.
 */
const LAP_COLOURS: readonly (readonly [string, string])[] = [
  ["#FFC400", "#FF7A00"],
  ["#FF7A00", "#FF2D42"],
  ["#FF2D42", "#FF3D93"],
];

export function bezelColour(index: number, lap: number): string {
  const pair = LAP_COLOURS[Math.min(Math.max(lap, 0), LAP_COLOURS.length - 1)]!;
  const t = BEZEL_SEGMENTS <= 1 ? 0 : index / (BEZEL_SEGMENTS - 1);
  const from = parseHex(pair[0]);
  const to = parseHex(pair[1]);
  if (!from || !to) return pair[0];
  const c = from.map((v, i) => Math.round(v + (to[i]! - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
