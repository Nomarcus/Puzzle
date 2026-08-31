/**
 * Painting the disc.
 *
 * Every filled cell is drawn as a little 3D sweet: a saturated base, a light
 * band along its outer edge, a darker band along its inner edge, and a narrow
 * gloss streak. Lighting radiates outwards from the hub rather than coming
 * from a corner, which is what makes a round board read as domed instead of
 * flat.
 */

import type { BoardSpec } from "../engine/geometry.js";
import { type Board, WILD, colourOf, getCell, isStone, isStripedValue } from "../engine/board.js";
import type { Piece } from "../engine/pieces.js";
import { type SectorGeometry, annularSectorPath, ringRadii } from "./annulus.js";
import { type BlockColour, type Theme, blockColour } from "./theme.js";
import { CANDY, type Material, cellNoise, materialById, withSparkle } from "./material.js";
import { type PatternId, drawPattern } from "./pattern.js";
import { finishAt, lapTrim, worldAt } from "./world.js";
import { themeForDepth } from "./palette.js";
import { SKY } from "./theme.js";
import { BEZEL_SEGMENTS, bezel, bezelColour } from "./depth.js";

/** Sector 0 sits at twelve o'clock, like a dial. */
export const ANGLE_ORIGIN = -Math.PI / 2;

export interface BoardLayout {
  readonly spec: BoardSpec;
  readonly cx: number;
  readonly cy: number;
  readonly innerRadius: number;
  readonly outerRadius: number;
  readonly radii: readonly number[];
  readonly sectorAngle: number;
  readonly pad: number;
  readonly corner: number;
  /**
   * Live angular offset per ring, in radians. Zero at rest; the spin animation
   * drives one ring away from zero and back as it settles into its new sector.
   */
  readonly ringOffset: readonly number[];
  /**
   * Live radial offset per sector, in pixels. The push gesture's equivalent of
   * ringOffset: it tugs one spoke in or out while the finger is down.
   */
  readonly spokeOffset: readonly number[];
}

export interface LayoutOptions {
  /** Fraction of the outer radius taken up by the hole in the middle. */
  readonly holeRatio?: number;
  /** 0 keeps rings equally wide, 1 makes every cell the same area. */
  readonly areaBias?: number;
  readonly pad?: number;
  readonly corner?: number;
}

export function computeLayout(
  spec: BoardSpec,
  cx: number,
  cy: number,
  outerRadius: number,
  options: LayoutOptions = {},
): BoardLayout {
  const holeRatio = options.holeRatio ?? 0.34;
  const areaBias = options.areaBias ?? 0.55;
  const innerRadius = outerRadius * holeRatio;
  const ringWidth = (outerRadius - innerRadius) / spec.rings;

  return {
    spec,
    cx,
    cy,
    innerRadius,
    outerRadius,
    radii: ringRadii(spec.rings, innerRadius, outerRadius, areaBias),
    sectorAngle: (Math.PI * 2) / spec.sectors,
    pad: options.pad ?? Math.max(1.5, ringWidth * 0.055),
    corner: options.corner ?? ringWidth * 0.28,
    ringOffset: new Array(spec.rings).fill(0),
    spokeOffset: new Array(spec.sectors).fill(0),
  };
}

/** Average width of one ring. The distance a push has to travel. */
export function ringWidth(layout: BoardLayout): number {
  return (layout.outerRadius - layout.innerRadius) / layout.spec.rings;
}

export function withRingOffset(layout: BoardLayout, ring: number, radians: number): BoardLayout {
  const ringOffset = [...layout.ringOffset];
  ringOffset[ring] = radians;
  return { ...layout, ringOffset };
}

export function withSpokeOffset(layout: BoardLayout, sector: number, pixels: number): BoardLayout {
  const spokeOffset = [...layout.spokeOffset];
  spokeOffset[sector] = pixels;
  return { ...layout, spokeOffset };
}

export function cellGeometry(layout: BoardLayout, r: number, s: number): SectorGeometry {
  const offset = layout.ringOffset[r] ?? 0;
  const start = ANGLE_ORIGIN + s * layout.sectorAngle + offset;
  const radial = layout.spokeOffset[((s % layout.spec.sectors) + layout.spec.sectors) % layout.spec.sectors] ?? 0;
  return {
    cx: layout.cx,
    cy: layout.cy,
    // Clamped above zero: a spoke tugged hard inwards would otherwise ask for
    // an arc of negative radius.
    innerRadius: Math.max(1, layout.radii[r]! + radial),
    outerRadius: Math.max(2, layout.radii[r + 1]! + radial),
    startAngle: start,
    endAngle: start + layout.sectorAngle,
    pad: layout.pad,
    corner: layout.corner,
  };
}

/** The middle of a cell, in screen coordinates. Where its debris flies from. */
export function cellCentre(layout: BoardLayout, r: number, s: number): { x: number; y: number } {
  const g = cellGeometry(layout, r, s);
  const radius = (g.innerRadius + g.outerRadius) / 2;
  const angle = (g.startAngle + g.endAngle) / 2;
  return { x: g.cx + radius * Math.cos(angle), y: g.cy + radius * Math.sin(angle) };
}

/** Which cell a screen point falls in, or null if it missed the disc. */
export function cellAtPoint(layout: BoardLayout, x: number, y: number): { r: number; s: number } | null {
  const dx = x - layout.cx;
  const dy = y - layout.cy;
  const radius = Math.hypot(dx, dy);
  if (radius < layout.innerRadius || radius > layout.outerRadius) return null;

  let ring = -1;
  for (let r = 0; r < layout.spec.rings; r++) {
    if (radius >= layout.radii[r]! && radius <= layout.radii[r + 1]!) {
      ring = r;
      break;
    }
  }
  if (ring < 0) return null;

  const offset = layout.ringOffset[ring] ?? 0;
  const raw = Math.atan2(dy, dx) - ANGLE_ORIGIN - offset;
  const turns = raw / (Math.PI * 2);
  const normalised = turns - Math.floor(turns);
  const sector = Math.floor(normalised * layout.spec.sectors) % layout.spec.sectors;

  return { r: ring, s: sector };
}

export function drawEmptyCell(ctx: CanvasRenderingContext2D, g: SectorGeometry, theme: Theme): void {
  annularSectorPath(ctx, g);
  ctx.fillStyle = theme.empty;
  ctx.fill();
  ctx.strokeStyle = theme.emptyEdge;
  ctx.lineWidth = 1;
  ctx.stroke();
}

export function drawBlock(
  ctx: CanvasRenderingContext2D,
  g: SectorGeometry,
  colourId: number,
  theme: Theme,
  alpha = 1,
  muted = false,
  striped = false,
  /** What the block is made of. Defaults to the sweet it has always been. */
  material: Material = CANDY,
  /** The world's pattern, drawn over the finish. Defaults to nothing. */
  pattern: PatternId = "none",
  patternStrength = 0,
  patternVariant = false,
): void {
  if (colourId === WILD && !muted) {
    drawWild(ctx, g, theme, alpha);
    return;
  }
  // A block with nowhere to go is greyed out to say so, and that message beats
  // any amount of polish: a muted diamond still has to read as unplayable, and
  // a pattern on top of the grey would only make it harder to see that it is.
  if (muted) {
    material = CANDY;
    pattern = "none";
  }
  const colour = muted ? theme.muted : blockColour(theme, colourId);
  const ri = g.innerRadius + g.pad;
  const ro = g.outerRadius - g.pad;
  const width = ro - ri;
  if (width <= 0) return;

  ctx.save();
  try {
    // Compose with whatever the caller already set — globalAlpha is absolute,
    // so assigning here would wipe out a fade applied further up the stack.
    ctx.globalAlpha *= alpha;

    annularSectorPath(ctx, g);
    ctx.save();
    try {
      ctx.clip();

      ctx.fillStyle = colour.base;
      ctx.fillRect(g.cx - g.outerRadius, g.cy - g.outerRadius, g.outerRadius * 2, g.outerRadius * 2);

      // Lit edge facing out, shaded edge facing the hub — the bevel that makes
      // it look like a sweet rather than a flat tile.
      const bandOut = width * 0.3;
      ctx.strokeStyle = colour.light;
      ctx.lineWidth = bandOut;
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, ro - bandOut / 2, g.startAngle - 0.2, g.endAngle + 0.2);
      ctx.stroke();

      const bandIn = width * 0.26;
      ctx.strokeStyle = colour.dark;
      ctx.lineWidth = bandIn;
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, ri + bandIn / 2, g.startAngle - 0.2, g.endAngle + 0.2);
      ctx.stroke();

      // Narrow specular streak. Wider and brighter the harder the material.
      const gloss = width * material.gloss;
      ctx.strokeStyle = `rgba(255, 255, 255, ${material.glossAlpha})`;
      ctx.lineWidth = gloss;
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, ro - bandOut * 0.72, g.startAngle - 0.2, g.endAngle + 0.2);
      ctx.stroke();

      drawFacets(ctx, g, colour, material, ri, ro, width);

      // The world's pattern, inside the clip and over the finish. Inside,
      // because half a stroke landing in the gap between cells is what turns a
      // decoration into a grid drawn over the whole board.
      drawPattern(ctx, g, colour, pattern, patternStrength, patternVariant);

      // Light catching the cut edge, drawn INSIDE the clip.
      //
      // Outside it, half of every stroke straddles the path and lands in the
      // gap between cells, so the board grows a white grid and every block
      // reads a shade paler than it is — which is the one thing the colour
      // rules forbid, since a pale strawberry and a pale bubblegum are the same
      // block to somebody matching by lightness. Clipped, only the inner half
      // survives, and it reads as an edge rather than as a border.
      if (material.rim > 0) {
        annularSectorPath(ctx, g);
        ctx.strokeStyle = `rgba(255, 255, 255, ${material.rim})`;
        ctx.lineWidth = Math.max(1, width * 0.07);
        ctx.stroke();
      }

      if (striped) {
        // A cross of bright bands: one around the ring, one across it. The mark
        // shows the two lines the block will take when it goes off.
        const mid = (ri + ro) / 2;
        const midAngle = (g.startAngle + g.endAngle) / 2;

        ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
        ctx.lineWidth = width * 0.2;
        ctx.lineCap = "butt";

        ctx.beginPath();
        ctx.arc(g.cx, g.cy, mid, g.startAngle - 0.3, g.endAngle + 0.3);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(g.cx + (ri - width) * Math.cos(midAngle), g.cy + (ri - width) * Math.sin(midAngle));
        ctx.lineTo(g.cx + (ro + width) * Math.cos(midAngle), g.cy + (ro + width) * Math.sin(midAngle));
        ctx.stroke();
      }
    } finally {
      ctx.restore();
    }

    annularSectorPath(ctx, g);
    ctx.strokeStyle = theme.blockOutline;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (material.sparkle > 0) drawSparkle(ctx, g, material, ri, ro, width);
  } finally {
    // Balanced whatever happens inside. An unbalanced save is not a cosmetic
    // problem: the clip and the transform it holds stay alive into the next
    // frame, and they compound until nothing lands on screen at all.
    ctx.restore();
  }
}

/**
 * The cuts that turn a sweet into a stone worth having.
 *
 * Radial, because the cell is a ring segment: a cut along the arc would follow
 * the bevel that is already there and read as another highlight, while a cut
 * across it breaks the shape into faces that catch light differently. Each face
 * is nudged lighter or darker from the block's *own* light and dark shades
 * rather than toward white, so a facetted block keeps its hue and its place in
 * the lightness order the colour-blind reading depends on.
 */
function drawFacets(
  ctx: CanvasRenderingContext2D,
  g: SectorGeometry,
  colour: BlockColour,
  material: Material,
  ri: number,
  ro: number,
  width: number,
): void {
  if (material.facets <= 0) return;
  const spread = g.endAngle - g.startAngle;

  ctx.save();
  try {
    for (let i = 1; i <= material.facets; i++) {
      const t = i / (material.facets + 1);
      const angle = g.startAngle + spread * t;
      // Kept very faint. A strong wash over half a cell does not read as a cut
      // face, it reads as a second colour — and on a board where a line only
      // pays out if every cell is the same colour, a block that looks like two
      // is worse than a block with no facets at all.
      ctx.globalAlpha = material.facetDepth;
      ctx.fillStyle = i % 2 === 0 ? colour.dark : colour.light;
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, ro, angle, g.startAngle + spread * Math.min(1, t + 1 / (material.facets + 1)));
      ctx.arc(
        g.cx,
        g.cy,
        ri,
        g.startAngle + spread * Math.min(1, t + 1 / (material.facets + 1)),
        angle,
        true,
      );
      ctx.closePath();
      ctx.fill();

      // The cut itself. Faint on purpose: a crisp white line across a block
      // reads as a scratch, and enough of them read as a grid laid over the
      // board. What should say "cut" is the two faces meeting at different
      // brightnesses, not the join between them.
      ctx.globalAlpha = material.facetDepth * 0.9;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
      ctx.lineWidth = Math.max(0.75, width * 0.03);
      ctx.beginPath();
      ctx.moveTo(g.cx + ri * Math.cos(angle), g.cy + ri * Math.sin(angle));
      ctx.lineTo(g.cx + ro * Math.cos(angle), g.cy + ro * Math.sin(angle));
      ctx.stroke();
    }
  } finally {
    ctx.restore();
  }
}

/**
 * A four-point glint, on a scattering of cells rather than all of them.
 *
 * All of them would be a texture, and a texture is not a reward — it is the
 * fact that only some catch the light that makes the board look like it is made
 * of something. Which cells is hashed from the cell's own position, so the
 * sparkle sits still instead of crawling across the disc every frame.
 */
function drawSparkle(
  ctx: CanvasRenderingContext2D,
  g: SectorGeometry,
  material: Material,
  ri: number,
  ro: number,
  width: number,
): void {
  const midAngle = (g.startAngle + g.endAngle) / 2;
  const mid = (ri + ro) / 2;
  const noise = cellNoise(mid, midAngle);
  if (noise > material.sparkle) return;

  // Placed off-centre by the same hash, so the glints do not line up in a ring.
  const angle = g.startAngle + (g.endAngle - g.startAngle) * (0.3 + noise * 1.4);
  const radius = ri + width * (0.3 + cellNoise(midAngle, mid) * 0.4);
  const x = g.cx + radius * Math.cos(angle);
  const y = g.cy + radius * Math.sin(angle);
  const arm = width * (0.3 + noise * 0.5);

  ctx.save();
  try {
    ctx.globalAlpha *= 0.5 + noise * 0.5;
    // A soft bloom under a short cross, rather than a hard plus sign. The plus
    // on its own reads as clip art stuck on top of the block; the bloom is what
    // makes it look like the light is coming off the surface.
    const bloom = ctx.createRadialGradient(x, y, 0, x, y, arm * 1.5);
    bloom.addColorStop(0, "rgba(255, 255, 255, 0.55)");
    bloom.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = bloom;
    ctx.beginPath();
    ctx.arc(x, y, arm * 1.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = Math.max(1, width * 0.055);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x - arm, y);
    ctx.lineTo(x + arm, y);
    ctx.moveTo(x, y - arm * 0.72);
    ctx.lineTo(x, y + arm * 0.72);
    ctx.stroke();
  } finally {
    ctx.restore();
  }
}

/**
 * A wild block: every colour at once.
 *
 * Painted as a sweep of the whole palette around the sector rather than as a
 * static rainbow stripe, so it reads as "all of them" and not as "a new
 * colour". It keeps the same bevel and gloss as an ordinary block, because it
 * is an ordinary block in every way except which line it will agree with.
 */
export function drawWild(
  ctx: CanvasRenderingContext2D,
  g: SectorGeometry,
  theme: Theme,
  alpha = 1,
): void {
  const ri = g.innerRadius + g.pad;
  const ro = g.outerRadius - g.pad;
  const width = ro - ri;
  if (width <= 0) return;

  ctx.save();
  try {
    ctx.globalAlpha *= alpha;
    annularSectorPath(ctx, g);
    ctx.save();
    try {
      ctx.clip();

      // A band per colour, laid across the sector. Eight of them in the width
      // of a fingernail would be mush, so it takes every other one.
      const stops = theme.blocks.filter((_, i) => i % 2 === 0);
      const span = g.endAngle - g.startAngle;
      stops.forEach((colour, i) => {
        const from = g.startAngle + (span * i) / stops.length - 0.02;
        const to = g.startAngle + (span * (i + 1)) / stops.length + 0.02;
        ctx.beginPath();
        ctx.moveTo(g.cx + ri * Math.cos(from), g.cy + ri * Math.sin(from));
        ctx.arc(g.cx, g.cy, ro, from, to);
        ctx.arc(g.cx, g.cy, ri, to, from, true);
        ctx.closePath();
        ctx.fillStyle = colour.base;
        ctx.fill();
      });

      // The same lit rim and gloss every other block has, over the top, so it
      // sits in the same world as the sweets around it.
      const bandOut = width * 0.26;
      ctx.globalAlpha *= 0.5;
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = bandOut;
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, ro - bandOut / 2, g.startAngle - 0.2, g.endAngle + 0.2);
      ctx.stroke();

      ctx.globalAlpha /= 0.5;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
      ctx.lineWidth = width * 0.1;
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, ro - bandOut * 0.9, g.startAngle - 0.2, g.endAngle + 0.2);
      ctx.stroke();
    } finally {
      ctx.restore();
    }

    annularSectorPath(ctx, g);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 2.5;
    ctx.stroke();
  } finally {
    ctx.restore();
  }
}

/**
 * A stone cell. Same bevel as a block so it belongs on the disc, but grey, matt
 * and split by a fissure — no gloss streak, because the gloss is what makes the
 * candy look edible and this is the one thing on the board you cannot eat.
 *
 * A cracked stone is paler and split further, which is the whole tell: it says
 * "one more clear through here" without a number or a bar.
 */
export function drawStone(
  ctx: CanvasRenderingContext2D,
  g: SectorGeometry,
  theme: Theme,
  alpha = 1,
): void {
  const colour = theme.stone;
  const ri = g.innerRadius + g.pad;
  const ro = g.outerRadius - g.pad;
  const width = ro - ri;
  if (width <= 0) return;

  ctx.save();
  try {
    ctx.globalAlpha *= alpha;

    annularSectorPath(ctx, g);
    ctx.save();
    try {
      ctx.clip();

      ctx.fillStyle = colour.base;
      ctx.fillRect(g.cx - g.outerRadius, g.cy - g.outerRadius, g.outerRadius * 2, g.outerRadius * 2);

      const bandOut = width * 0.28;
      ctx.strokeStyle = colour.light;
      ctx.lineWidth = bandOut;
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, ro - bandOut / 2, g.startAngle - 0.2, g.endAngle + 0.2);
      ctx.stroke();

      const bandIn = width * 0.3;
      ctx.strokeStyle = colour.dark;
      ctx.lineWidth = bandIn;
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, ri + bandIn / 2, g.startAngle - 0.2, g.endAngle + 0.2);
      ctx.stroke();

      // The fissure. Drawn from fixed fractions of the cell rather than from a
      // random walk so a stone looks the same every frame it is on screen.
      const span = g.endAngle - g.startAngle;
      const at = (t: number, u: number) => ({
        x: g.cx + (ri + width * u) * Math.cos(g.startAngle + span * t),
        y: g.cy + (ri + width * u) * Math.sin(g.startAngle + span * t),
      });

      ctx.strokeStyle = colour.dark;
      ctx.lineWidth = Math.max(1.5, width * 0.11);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.beginPath();
      const a = at(0.18, 0.05);
      const b = at(0.42, 0.48);
      const c = at(0.3, 0.72);
      const d = at(0.62, 1);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();

      // A second split. Two fissures rather than one is what stops a grey
      // cell reading as just another colour of sweet.
      ctx.beginPath();
      const e = at(0.88, 0.1);
      const f = at(0.62, 0.44);
      const h = at(0.86, 0.86);
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(f.x, f.y);
      ctx.lineTo(h.x, h.y);
      ctx.stroke();
    } finally {
      ctx.restore();
    }

    annularSectorPath(ctx, g);
    ctx.strokeStyle = theme.blockOutline;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } finally {
    ctx.restore();
  }
}

/**
 * The dish the puzzle sits on, plus the hub in the middle.
 *
 * At depth the dish's own rim becomes the depth gauge — see `drawBezel`.
 */
export function drawPlate(
  ctx: CanvasRenderingContext2D,
  layout: BoardLayout,
  theme: Theme,
  depth = 0,
): void {
  const rim = layout.outerRadius + layout.pad * 4;

  ctx.save();
  ctx.beginPath();
  ctx.arc(layout.cx, layout.cy, rim, 0, Math.PI * 2);
  ctx.fillStyle = theme.plate;
  ctx.shadowColor = "rgba(0, 0, 0, 0.18)";
  ctx.shadowBlur = rim * 0.10;
  ctx.shadowOffsetY = rim * 0.035;
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(layout.cx, layout.cy, rim, 0, Math.PI * 2);
  ctx.strokeStyle = theme.plateEdge;
  ctx.lineWidth = 2;
  ctx.stroke();

  drawBezel(ctx, layout, rim, depth);
}

/**
 * One notch per depth, around the rim of the dish.
 *
 * This is the part of the depth ladder you can *count*: the backdrop tells you
 * something has changed, the rim tells you exactly how far in you are without
 * anybody reading a number.
 *
 * It rides the plate's existing edge rather than sitting outside it, and that
 * is a constraint rather than a preference. The band outside the board is
 * `pad * 4`, which on a phone is about six pixels — concentric growth rings
 * were the first design and twelve of them land on top of each other in a gap
 * that size. The disc is also already 0.485 of the content width, so there is
 * nothing to grow into either. Segmenting the edge that is drawn anyway costs
 * no space at all and touches no playable cell.
 */
function drawBezel(
  ctx: CanvasRenderingContext2D,
  layout: BoardLayout,
  rim: number,
  depth: number,
): void {
  const { lit, lap } = bezel(depth);
  if (lit <= 0) return;

  const arc = (Math.PI * 2) / BEZEL_SEGMENTS;
  // A little proud of the plate's own 2px edge so it reads as a raised bezel
  // rather than as a stroke that changed colour.
  const width = Math.max(3, layout.pad * 2.4);

  ctx.save();
  try {
    ctx.lineCap = "butt";
    ctx.lineWidth = width;
    for (let i = 0; i < BEZEL_SEGMENTS; i++) {
      // A lap already completed stays lit underneath, so the rim reads as
      // filling further rather than as starting over.
      const on = i < lit;
      if (!on && lap === 0) continue;
      const gap = arc * 0.13;
      const start = -Math.PI / 2 + i * arc + gap;
      const end = -Math.PI / 2 + (i + 1) * arc - gap;
      ctx.beginPath();
      ctx.arc(layout.cx, layout.cy, rim, start, end);
      ctx.strokeStyle = on ? bezelColour(i, lap) : bezelColour(i, lap - 1);
      ctx.globalAlpha = on ? 1 : 0.45;
      ctx.stroke();
    }
  } finally {
    ctx.restore();
  }
}

/**
 * The hub, and the charge it holds.
 *
 * Drawn as a level rising in a well rather than as a ring or an arc, because a
 * filling vessel needs no legend — everyone has watched a glass fill. The
 * surface catches a highlight and wobbles slightly so it reads as liquid and
 * not as a bar chart, and once it is full the whole thing pulses and gains a
 * ring of light, which is the only invitation to tap it anybody needs.
 *
 * `charge` is 0 to 1. `clock` is seconds since the screen opened, for the
 * wobble and the pulse.
 */
export function drawHub(
  ctx: CanvasRenderingContext2D,
  layout: BoardLayout,
  theme: Theme,
  charge = 0,
  clock = 0,
): void {
  const radius = layout.innerRadius - layout.pad * 2;
  if (radius <= 0) return;

  const full = charge >= 1;
  const beat = full ? 1 + Math.sin(clock * 6) * 0.05 : 1;

  ctx.save();
  try {
    ctx.translate(layout.cx, layout.cy);
    ctx.scale(beat, beat);

    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = theme.empty;
    ctx.fill();

    if (charge > 0) {
      ctx.save();
      try {
        // Clipped to the well, so the surface can be drawn as a simple shape
        // and still come out as a disc segment.
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.clip();

        const level = radius - charge * radius * 2;
        const wobble = full ? 0 : Math.sin(clock * 2.2) * radius * 0.035;

        ctx.beginPath();
        ctx.moveTo(-radius, radius);
        ctx.lineTo(-radius, level + wobble);
        // Two arcs the opposite way round make the meniscus, which is most of
        // what stops this reading as a progress bar in a circle.
        ctx.quadraticCurveTo(-radius / 2, level - wobble, 0, level);
        ctx.quadraticCurveTo(radius / 2, level + wobble, radius, level - wobble);
        ctx.lineTo(radius, radius);
        ctx.closePath();

        const fill = ctx.createLinearGradient(0, level, 0, radius);
        fill.addColorStop(0, full ? "#FFDC4D" : theme.charge.light);
        fill.addColorStop(1, full ? "#FF7A00" : theme.charge.base);
        ctx.fillStyle = fill;
        ctx.fill();

        // A brighter lip along the surface.
        ctx.strokeStyle = full ? "#FFFFFF" : theme.charge.light;
        ctx.lineWidth = Math.max(1.5, radius * 0.07);
        ctx.beginPath();
        ctx.moveTo(-radius, level + wobble);
        ctx.quadraticCurveTo(-radius / 2, level - wobble, 0, level);
        ctx.quadraticCurveTo(radius / 2, level + wobble, radius, level - wobble);
        ctx.stroke();
      } finally {
        ctx.restore();
      }
    }

    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.strokeStyle = full ? "#FFC400" : theme.emptyEdge;
    ctx.lineWidth = full ? 4 : 2;
    ctx.stroke();

    if (full) {
      // A halo, so a full core is unmistakable at a glance across the disc.
      ctx.globalAlpha = 0.35 + Math.sin(clock * 6) * 0.18;
      ctx.beginPath();
      ctx.arc(0, 0, radius + 6, 0, Math.PI * 2);
      ctx.strokeStyle = "#FFDC4D";
      ctx.lineWidth = 5;
      ctx.stroke();
    }
  } finally {
    ctx.restore();
  }
}

export function drawBoard(
  ctx: CanvasRenderingContext2D,
  board: Board,
  layout: BoardLayout,
  theme: Theme,
  charge = 0,
  clock = 0,
  /** Free play's depth. Zero everywhere else, which is what gates the bezel. */
  depth = 0,
): void {
  drawPlate(ctx, layout, theme, depth);
  // One lookup. The world owns the finish and the pattern, so nothing in here
  // ever branches on the depth itself.
  const world = worldAt(depth);
  const trim = lapTrim(depth);
  const material = withSparkle(materialById(finishAt(depth)), trim.sparkle);

  for (let r = 0; r < board.spec.rings; r++) {
    for (let s = 0; s < board.spec.sectors; s++) {
      const g = cellGeometry(layout, r, s);
      const value = getCell(board, r, s);
      if (value === 0) drawEmptyCell(ctx, g, theme);
      // Stone deliberately does not follow the material ladder. It is the one
      // thing on the disc that is not a sweet to be cleared, and the top of the
      // ladder is "hard shiny mineral" — if stone joined in, the threat and the
      // reward would end up looking like each other.
      else if (isStone(value)) drawStone(ctx, g, theme);
      else {
        drawBlock(
          ctx,
          g,
          colourOf(value),
          theme,
          1,
          false,
          isStripedValue(value),
          material,
          world.pattern,
          world.patternStrength,
          trim.variant,
        );
      }
    }
  }

  drawHub(ctx, layout, theme, charge, clock);
}

/** Translucent preview of where the dragged piece would land. */
export function drawGhost(
  ctx: CanvasRenderingContext2D,
  layout: BoardLayout,
  piece: Piece,
  r: number,
  s: number,
  colourId: number,
  theme: Theme,
  stripedCell?: number,
  wildCell?: number,
): void {
  // Every cell, not just the block colour: a striped or wild piece snapped
  // onto the board used to preview as a plain block, so the one thing worth
  // knowing before committing — which piece this actually is — was the one
  // thing the preview hid. Same per-cell logic drawPiece() already uses for
  // the piece riding above the thumb, so the two views of the same drag never
  // disagree about what it is.
  piece.cells.forEach(([dr, ds], i) => {
    drawBlock(
      ctx,
      cellGeometry(layout, r + dr, s + ds),
      i === wildCell ? WILD : colourId,
      theme,
      0.45,
      false,
      i === stripedCell,
    );
  });
}

export function paintBackdrop(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  theme: Theme,
): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, theme.backdrop[0]);
  gradient.addColorStop(1, theme.backdrop[1]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

/** Scales the canvas for the device pixel ratio and returns the CSS-pixel size. */
export function fitCanvas(canvas: HTMLCanvasElement, dpr: number): { width: number; height: number } {
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width: rect.width, height: rect.height };
}

/**
 * A small sample of one world's blocks, for the World Passport.
 *
 * Draws through the same `drawBlock` the board uses, at the same depth the
 * world starts at, so a card can never show something the world does not
 * actually look like. An undiscovered world gets the plate and nothing on it —
 * the shape of the thing without the answer.
 */
export function drawWorldSwatch(
  canvas: HTMLCanvasElement,
  depth: number,
  known: boolean,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const theme = themeForDepth(SKY, known ? depth : 0);
  ctx.fillStyle = theme.plate;
  ctx.fillRect(0, 0, w, h);

  if (!known) {
    ctx.fillStyle = theme.empty;
    ctx.fillRect(0, 0, w, h);
    return;
  }

  // A nearly-flat strip of three cells across the middle.
  //
  // The geometry is the board's own — same `computeLayout`, same `drawBlock` —
  // pushed to a huge radius with almost all of it hollowed out, so the arc
  // flattens into a band instead of curving off the card. That keeps a swatch
  // honest: it cannot show something the world does not actually draw.
  //
  // The cells come out around 42x32 on a passport card against roughly 16px on
  // a real board, which is the point of the card: this is where the pattern is
  // meant to be legible without squinting.
  const radius = h * 3;
  const centre = h / 2 + radius * 0.96;
  const layout = computeLayout({ rings: 1, sectors: 56 }, w / 2, centre, radius, {
    holeRatio: 0.92,
  });
  const material = withSparkle(materialById(finishAt(depth)), lapTrim(depth).sparkle);
  const world = worldAt(depth);
  const trim = lapTrim(depth);

  // Four rather than three, and an even count on purpose: sector zero *starts*
  // straight up rather than being centred on it, so an odd run comes out half a
  // cell to one side. Four straddles the origin evenly and the outer two clip at
  // the card's edges, which reads as a strip continuing past it.
  for (const [i, sector] of [-2, -1, 0, 1].entries()) {
    drawBlock(
      ctx,
      cellGeometry(layout, 0, ((sector % 56) + 56) % 56),
      i * 3 + 2,
      theme,
      1,
      false,
      false,
      material,
      world.pattern,
      world.patternStrength,
      trim.variant,
    );
  }
}
