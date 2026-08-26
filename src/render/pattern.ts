/**
 * What a Depth World draws on top of a block.
 *
 * ## The rule this file exists to obey
 *
 * Shiftle uses colour as gameplay information: a line only pays a spin if every
 * cell shares one colour, and the eight hues are told apart by hue and lightness
 * together. So a world pattern may change how a block is *textured* and must
 * never change what colour it reads as.
 *
 * That is not left to judgement. Every pattern is a row in `PATTERNS` below, and
 * the row carries its own ink and alpha, so the limits are data a test can
 * check rather than an intention a reviewer has to spot:
 *
 * - **Ink is the block's own light or dark shade**, almost always. Those are the
 *   same two colours the bevel is already made of, so a mark drawn in them can
 *   shift the block's lightness a little and its hue not at all.
 * - **White is capped at 0.30 alpha**, and only three patterns use it. For scale:
 *   the striped marker draws white at **0.92** across the full width of the cell.
 *   Nothing here may come close to that, because a pattern that could be
 *   mistaken for a striped block would cost the player a move.
 * - **No pattern draws both a full arc and a full radial line.** That pair *is*
 *   the striped mark. Individually either is fine; together they are the one
 *   shape on the disc that already means something.
 * - **No large fills.** Marks are dots, short arcs and thin lines. A wash over
 *   the body is the thing that drains saturation, and low saturation is how a
 *   block starts to look like stone.
 *
 * Everything is hashed from the cell's own position through `cellNoise`, so a
 * pattern sits still between frames instead of crawling, and no decoration ever
 * draws from the engine's RNG — that stream is threaded through game state for
 * replay and belongs to gameplay alone.
 */

import type { SectorGeometry } from "./annulus.js";
import type { BlockColour } from "./theme.js";
import { cellNoise } from "./material.js";

export type PatternId =
  | "none"
  | "seeds"
  | "grain"
  | "studs"
  | "spots"
  | "facets"
  | "bubbles"
  | "speckles"
  | "grid"
  | "cracks";

/** Which of the block's own colours a pattern is drawn in. */
export type Ink = "light" | "dark" | "white";

export interface PatternSpec {
  readonly id: PatternId;
  readonly ink: Ink;
  /** Peak alpha at full strength. Capped by ink — see the caps below. */
  readonly alpha: number;
  /** Peak stroke width, as a fraction of the cell's width. */
  readonly stroke: number;
  /** Whether the pattern draws an arc spanning the cell. */
  readonly fullArc: boolean;
  /** Whether it draws a line spanning the cell radially. */
  readonly fullRadial: boolean;
}

/**
 * The caps, and where they come from.
 *
 * `WHITE_CAP` is set against the striped marker, which is white at 0.92 alpha
 * and `width * 0.2` wide. A third of that alpha is far enough away that the two
 * cannot be confused at a glance, which is the only thing that matters.
 *
 * `SHADE_CAP` is looser because a mark in the block's own dark shade cannot move
 * its hue at all — the worst it can do is make one part of a red block a deeper
 * red.
 */
export const WHITE_CAP = 0.3;
export const SHADE_CAP = 0.78;
export const STROKE_CAP = 0.12;

export const PATTERNS: readonly PatternSpec[] = [
  { id: "none", ink: "dark", alpha: 0, stroke: 0, fullArc: false, fullRadial: false },
  { id: "seeds", ink: "dark", alpha: 0.72, stroke: 0.09, fullArc: false, fullRadial: false },
  { id: "grain", ink: "dark", alpha: 0.7, stroke: 0.1, fullArc: true, fullRadial: false },
  { id: "studs", ink: "light", alpha: 0.7, stroke: 0.08, fullArc: false, fullRadial: false },
  { id: "spots", ink: "dark", alpha: 0.7, stroke: 0.1, fullArc: false, fullRadial: false },
  { id: "facets", ink: "white", alpha: 0.28, stroke: 0.04, fullArc: false, fullRadial: true },
  { id: "bubbles", ink: "light", alpha: 0.75, stroke: 0.07, fullArc: false, fullRadial: false },
  { id: "speckles", ink: "white", alpha: 0.28, stroke: 0.06, fullArc: false, fullRadial: false },
  { id: "grid", ink: "light", alpha: 0.6, stroke: 0.05, fullArc: true, fullRadial: false },
  { id: "cracks", ink: "dark", alpha: 0.78, stroke: 0.09, fullArc: false, fullRadial: true },
];

const BY_ID = new Map(PATTERNS.map((p) => [p.id, p]));

export function patternSpec(id: PatternId): PatternSpec {
  return BY_ID.get(id) ?? PATTERNS[0]!;
}

function inkColour(spec: PatternSpec, colour: BlockColour): string {
  if (spec.ink === "white") return "#FFFFFF";
  return spec.ink === "light" ? colour.light : colour.dark;
}

/**
 * Draws a world's pattern into the cell.
 *
 * Called inside the block's clip, on top of the bevel and the finish's specular,
 * so a mark never spills into the gap between cells — half a stroke landing in
 * the gaps is what turned an earlier edge-light into a white grid over the whole
 * board and made every block read a shade paler than it is.
 */
export function drawPattern(
  ctx: CanvasRenderingContext2D,
  g: SectorGeometry,
  colour: BlockColour,
  id: PatternId,
  strength: number,
  variant = false,
): void {
  if (id === "none" || strength <= 0) return;
  const spec = patternSpec(id);
  const ri = g.innerRadius + g.pad;
  const ro = g.outerRadius - g.pad;
  const width = ro - ri;
  if (width <= 0) return;

  const cap = spec.ink === "white" ? WHITE_CAP : SHADE_CAP;
  const alpha = Math.min(cap, spec.alpha) * Math.min(1, strength);
  const stroke = Math.max(0.6, width * Math.min(STROKE_CAP, spec.stroke));
  const paint = inkColour(spec, colour);

  ctx.save();
  try {
    ctx.strokeStyle = paint;
    ctx.fillStyle = paint;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = stroke;

    switch (id) {
      case "seeds":
        seeds(ctx, g, colour, ri, ro, width, alpha, variant);
        break;
      case "grain":
        grain(ctx, g, ri, ro, alpha, stroke);
        break;
      case "studs":
        studs(ctx, g, colour, ri, ro, width, alpha, variant);
        break;
      case "spots":
        variant ? animalStripes(ctx, g, ri, width, alpha) : animalSpots(ctx, g, ri, ro, width, alpha);
        break;
      case "facets":
        facets(ctx, g, colour, ri, ro, alpha, stroke, variant ? 3 : 2);
        break;
      case "bubbles":
        bubbles(ctx, g, ri, ro, width, alpha, variant);
        break;
      case "speckles":
        speckles(ctx, g, ri, ro, width, alpha);
        break;
      case "grid":
        grid(ctx, g, ri, ro, alpha);
        break;
      case "cracks":
        cracks(ctx, g, ri, width, alpha);
        break;
      default:
        break;
    }
  } finally {
    // Balanced whatever happens inside: a clip or transform left behind is
    // inherited by the next frame and compounds until nothing lands on screen.
    ctx.restore();
  }
}

/** Polar helper. Every pattern works in the cell's own coordinates. */
function at(g: SectorGeometry, radius: number, angle: number): [number, number] {
  return [g.cx + radius * Math.cos(angle), g.cy + radius * Math.sin(angle)];
}

/** Fruit: pips scattered across the flesh. Watermelon, kiwi, berry. */
function seeds(
  ctx: CanvasRenderingContext2D,
  g: SectorGeometry,
  colour: BlockColour,
  ri: number,
  ro: number,
  width: number,
  alpha: number,
  variant: boolean,
): void {
  const span = g.endAngle - g.startAngle;
  const count = variant ? 5 : 4;
  // Sized by looking: at half this they were invisible on a phone-sized cell
  // and Fruit read as "the palette rotated" rather than as a world.
  ctx.globalAlpha = alpha;
  for (let i = 0; i < count; i++) {
    const n = cellNoise(ri + i * 11.7, g.startAngle + i * 2.3);
    const m = cellNoise(g.startAngle * 3.1 + i, ro - i * 5.4);
    const r = ri + width * (0.22 + n * 0.56);
    const a = g.startAngle + span * (0.18 + m * 0.64);
    const [x, y] = at(g, r, a);
    // A teardrop rather than a circle: seeds have a point, and the taper is what
    // stops four dots reading as a manufacturing defect.
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a + Math.PI / 2);
    ctx.beginPath();
    ctx.ellipse(0, 0, width * 0.11, width * 0.17, 0, 0, Math.PI * 2);
    ctx.fill();
    // A lit sliver along one side. Without it a pip is a flat hole; with it the
    // seed sits in the flesh, which is the difference between a texture and a
    // fruit.
    ctx.globalAlpha = alpha * 0.5;
    ctx.fillStyle = colour.light;
    ctx.beginPath();
    ctx.ellipse(-width * 0.03, -width * 0.03, width * 0.055, width * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = colour.dark;
  }
}

/** Woodland: grain running the long way round the cell. */
function grain(
  ctx: CanvasRenderingContext2D,
  g: SectorGeometry,
  ri: number,
  ro: number,
  alpha: number,
  stroke: number,
): void {
  const lines = 6;
  for (let i = 0; i < lines; i++) {
    // Uneven spacing and length, hashed off the cell, so every block is not the
    // same four stripes — that reads as corduroy rather than as timber.
    const jitter = cellNoise(ri + i * 7.3, g.startAngle + i);
    const t = (i + 0.5) / lines + (jitter - 0.5) * 0.12;
    const r = ri + (ro - ri) * Math.max(0.08, Math.min(0.92, t));
    ctx.globalAlpha = alpha * (0.7 + jitter * 0.3);
    ctx.lineWidth = stroke * (0.85 + jitter * 0.8);
    const trim = (g.endAngle - g.startAngle) * (0.05 + jitter * 0.16);
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, r, g.startAngle + trim, g.endAngle - trim);
    ctx.stroke();
  }
}

/**
 * Toy Box: moulded studs.
 *
 * Round knobs with a lit top and a shaded underside, which is what reads as
 * raised rather than printed. Deliberately generic — no brand's proportions and
 * no logo, just the injection-moulded toy language.
 */
function studs(
  ctx: CanvasRenderingContext2D,
  g: SectorGeometry,
  colour: BlockColour,
  ri: number,
  ro: number,
  width: number,
  alpha: number,
  variant: boolean,
): void {
  const span = g.endAngle - g.startAngle;
  const count = variant ? 3 : 2;
  const radius = width * (count > 2 ? 0.2 : 0.26);
  const mid = (ri + ro) / 2;
  for (let i = 0; i < count; i++) {
    const a = g.startAngle + span * ((i + 1) / (count + 1));
    const [x, y] = at(g, mid, a);

    // The seat first, in the block's own dark. Without it the knob is painted
    // in colour.light directly onto the light bevel band that already covers
    // the outer half of the cell, and it disappears — which is exactly what the
    // first version did.
    ctx.globalAlpha = alpha;
    ctx.fillStyle = colour.dark;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = colour.light;
    ctx.beginPath();
    ctx.arc(x, y - radius * 0.12, radius * 0.78, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Animal: leopard rosettes. */
function animalSpots(
  ctx: CanvasRenderingContext2D,
  g: SectorGeometry,
  ri: number,
  ro: number,
  width: number,
  alpha: number,
): void {
  const span = g.endAngle - g.startAngle;
  ctx.globalAlpha = alpha;
  for (let i = 0; i < 4; i++) {
    const n = cellNoise(ri * 1.3 + i * 9.1, g.startAngle + i * 1.7);
    const m = cellNoise(ro + i * 4.2, g.startAngle * 2.2 + i);
    const r = ri + width * (0.24 + n * 0.52);
    const a = g.startAngle + span * (0.2 + m * 0.6);
    const [x, y] = at(g, r, a);
    ctx.beginPath();
    ctx.ellipse(x, y, width * (0.19 + n * 0.09), width * (0.14 + m * 0.08), a, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Animal, alternate lap: tiger stripes. Radial, but short of spanning the cell. */
function animalStripes(
  ctx: CanvasRenderingContext2D,
  g: SectorGeometry,
  ri: number,
  width: number,
  alpha: number,
): void {
  const span = g.endAngle - g.startAngle;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width * 0.12;
  for (let i = 0; i < 3; i++) {
    const n = cellNoise(ri + i * 6.6, g.startAngle * 1.9 + i);
    const a = g.startAngle + span * (0.22 + i * 0.28);
    // Never the full radius: a stripe that spans the cell radially is half the
    // striped marker, and the pair of them is what that marker means.
    const from = ri + width * (0.12 + n * 0.16);
    const to = ri + width * (0.62 + n * 0.24);
    ctx.beginPath();
    ctx.moveTo(...at(g, from, a));
    ctx.lineTo(...at(g, to, a + span * 0.05));
    ctx.stroke();
  }
}

/**
 * Crystal Cave: cut faces.
 *
 * Radial, because the cell is a ring segment and a cut along the arc would
 * follow the bevel that is already there and read as another highlight.
 */
function facets(
  ctx: CanvasRenderingContext2D,
  g: SectorGeometry,
  colour: BlockColour,
  ri: number,
  ro: number,
  alpha: number,
  stroke: number,
  count: number,
): void {
  const span = g.endAngle - g.startAngle;
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    const angle = g.startAngle + span * t;
    const to = g.startAngle + span * Math.min(1, t + 1 / (count + 1));
    // The faces are kept very faint. A strong wash over half a cell does not
    // read as a cut face, it reads as a second colour — and on a board where a
    // line only pays if every cell matches, a block that looks like two is worse
    // than a block with no facets at all.
    ctx.globalAlpha = alpha * 0.6;
    ctx.fillStyle = i % 2 === 0 ? colour.dark : colour.light;
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, ro, angle, to);
    ctx.arc(g.cx, g.cy, ri, to, angle, true);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = stroke;
    ctx.beginPath();
    ctx.moveTo(...at(g, ri, angle));
    ctx.lineTo(...at(g, ro, angle));
    ctx.stroke();
  }
}

/** Ocean: bubbles, or shell lines on the alternate lap. */
function bubbles(
  ctx: CanvasRenderingContext2D,
  g: SectorGeometry,
  ri: number,
  ro: number,
  width: number,
  alpha: number,
  variant: boolean,
): void {
  const span = g.endAngle - g.startAngle;
  if (variant) {
    ctx.globalAlpha = alpha * 0.8;
    for (let i = 0; i < 3; i++) {
      const n = cellNoise(ri + i * 8.8, g.startAngle + i * 3.3);
      const r = ri + width * (0.3 + i * 0.2);
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, r, g.startAngle + span * 0.18, g.startAngle + span * (0.5 + n * 0.3));
      ctx.stroke();
    }
    return;
  }
  for (let i = 0; i < 4; i++) {
    const n = cellNoise(ro + i * 5.9, g.startAngle * 1.4 + i);
    const m = cellNoise(ri * 2.1 + i, g.endAngle + i * 3.7);
    const [x, y] = at(g, ri + width * (0.2 + n * 0.6), g.startAngle + span * (0.15 + m * 0.7));
    // Rings rather than discs: a bubble is mostly the water behind it, and a
    // filled dot would cover more of the block's colour than it needs to.
    const r = width * (0.13 + n * 0.09);
    ctx.globalAlpha = alpha * (0.8 + n * 0.2);
    ctx.lineWidth = Math.max(1.2, width * 0.075);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    // The catchlight. A ring alone reads as a hole punched in the block; this is
    // what makes it a bubble sitting on one.
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.3, Math.max(0.8, r * 0.24), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Space: cosmic dust. Tiny and sparse. */
function speckles(
  ctx: CanvasRenderingContext2D,
  g: SectorGeometry,
  ri: number,
  ro: number,
  width: number,
  alpha: number,
): void {
  const span = g.endAngle - g.startAngle;
  for (let i = 0; i < 9; i++) {
    const n = cellNoise(ri + i * 3.7, g.startAngle * 2.6 + i * 1.1);
    const m = cellNoise(ro * 1.7 + i * 2.2, g.endAngle + i);
    const r = ri + width * (0.14 + n * 0.72);
    const a = g.startAngle + span * (0.1 + m * 0.8);
    const [x, y] = at(g, r, a);
    ctx.globalAlpha = alpha * (0.55 + n * 0.45);
    ctx.beginPath();
    ctx.arc(x, y, width * (0.045 + m * 0.06), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Arcade: a fine scanline glow along the ring. */
function grid(
  ctx: CanvasRenderingContext2D,
  g: SectorGeometry,
  ri: number,
  ro: number,
  alpha: number,
): void {
  const span = g.endAngle - g.startAngle;
  ctx.globalAlpha = alpha;
  for (let i = 1; i <= 3; i++) {
    const r = ri + ((ro - ri) * i) / 4;
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, r, g.startAngle, g.endAngle);
    ctx.stroke();
  }
  // The other axis, kept short of the edges so the pair never spans the cell
  // both ways — that shape is the striped marker and belongs to it alone.
  for (let i = 1; i <= 3; i++) {
    const a = g.startAngle + (span * i) / 4;
    ctx.beginPath();
    ctx.moveTo(...at(g, ri + (ro - ri) * 0.16, a));
    ctx.lineTo(...at(g, ri + (ro - ri) * 0.84, a));
    ctx.stroke();
  }
}

/** Lava: fissures. Jagged, and never spanning the whole cell. */
function cracks(
  ctx: CanvasRenderingContext2D,
  g: SectorGeometry,
  ri: number,
  width: number,
  alpha: number,
): void {
  const span = g.endAngle - g.startAngle;
  for (let i = 0; i < 3; i++) {
    const n = cellNoise(ri * 1.9 + i * 12.3, g.startAngle + i * 4.4);
    const base = g.startAngle + span * (0.22 + i * 0.28);
    const from = ri + width * (0.08 + n * 0.1);
    const to = ri + width * (0.7 + n * 0.18);
    const path = () => {
      ctx.beginPath();
      for (let k = 0; k <= 3; k++) {
        const t = k / 3;
        const r = from + (to - from) * t;
        const a = base + (k % 2 === 0 ? -1 : 1) * span * 0.06;
        const [x, y] = at(g, r, a);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    };
    // The fissure, then the heat inside it. A warm core without a second hue:
    // a lava block is still its own colour, cracked open.
    ctx.globalAlpha = alpha;
    ctx.lineWidth = Math.max(1.2, width * 0.1);
    path();
    ctx.stroke();
    ctx.globalAlpha = alpha * 0.75;
    ctx.strokeStyle = "#FFD08A";
    ctx.lineWidth = Math.max(0.7, width * 0.04);
    path();
    ctx.stroke();
  }
}
