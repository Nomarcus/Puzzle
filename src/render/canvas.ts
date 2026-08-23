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
import { type Board, colourOf, getCell, isStripedValue } from "../engine/board.js";
import type { Piece } from "../engine/pieces.js";
import { type SectorGeometry, annularSectorPath, ringRadii } from "./annulus.js";
import { type Theme, blockColour } from "./theme.js";

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
): void {
  const colour = muted ? theme.muted : blockColour(theme, colourId);
  const ri = g.innerRadius + g.pad;
  const ro = g.outerRadius - g.pad;
  const width = ro - ri;
  if (width <= 0) return;

  ctx.save();
  // Compose with whatever the caller already set — globalAlpha is absolute, so
  // assigning here would wipe out a fade applied further up the stack.
  ctx.globalAlpha *= alpha;

  annularSectorPath(ctx, g);
  ctx.save();
  ctx.clip();

  ctx.fillStyle = colour.base;
  ctx.fillRect(g.cx - g.outerRadius, g.cy - g.outerRadius, g.outerRadius * 2, g.outerRadius * 2);

  // Lit edge facing out, shaded edge facing the hub — the bevel that makes it
  // look like a sweet rather than a flat tile.
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

  // Narrow specular streak.
  const gloss = width * 0.1;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.42)";
  ctx.lineWidth = gloss;
  ctx.beginPath();
  ctx.arc(g.cx, g.cy, ro - bandOut * 0.72, g.startAngle - 0.2, g.endAngle + 0.2);
  ctx.stroke();

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

  ctx.restore();

  annularSectorPath(ctx, g);
  ctx.strokeStyle = theme.blockOutline;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();
}

/** The dish the puzzle sits on, plus the hub in the middle. */
export function drawPlate(ctx: CanvasRenderingContext2D, layout: BoardLayout, theme: Theme): void {
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
}

export function drawHub(ctx: CanvasRenderingContext2D, layout: BoardLayout, theme: Theme): void {
  const radius = layout.innerRadius - layout.pad * 2;
  if (radius <= 0) return;

  ctx.beginPath();
  ctx.arc(layout.cx, layout.cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = theme.empty;
  ctx.fill();
  ctx.strokeStyle = theme.emptyEdge;
  ctx.lineWidth = 2;
  ctx.stroke();
}

export function drawBoard(
  ctx: CanvasRenderingContext2D,
  board: Board,
  layout: BoardLayout,
  theme: Theme,
): void {
  drawPlate(ctx, layout, theme);

  for (let r = 0; r < board.spec.rings; r++) {
    for (let s = 0; s < board.spec.sectors; s++) {
      const g = cellGeometry(layout, r, s);
      const value = getCell(board, r, s);
      if (value === 0) drawEmptyCell(ctx, g, theme);
      else drawBlock(ctx, g, colourOf(value), theme, 1, false, isStripedValue(value));
    }
  }

  drawHub(ctx, layout, theme);
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
): void {
  for (const [dr, ds] of piece.cells) {
    drawBlock(ctx, cellGeometry(layout, r + dr, s + ds), colourId, theme, 0.45);
  }
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
