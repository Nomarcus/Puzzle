/**
 * Drawing a piece outside the board — in the tray, or under the thumb.
 *
 * Tray pieces keep the curvature they will have once placed, so an arc looks
 * like an arc and a wedge looks like a wedge. Showing them as straight bars
 * would be a lie the player has to unlearn the moment they drag one in.
 */

import type { BoardSpec } from "../engine/geometry.js";
import type { Piece } from "../engine/pieces.js";
import type { Theme } from "./theme.js";
import { type BoardLayout, cellGeometry, computeLayout, drawBlock } from "./canvas.js";

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Anchor that keeps a piece centred on the twelve o'clock spoke. */
function anchorFor(piece: Piece, spec: BoardSpec): { r: number; s: number } {
  return {
    r: Math.max(0, Math.floor((spec.rings - piece.radialExtent) / 2)),
    s: spec.sectors - Math.floor(piece.sectorExtent / 2),
  };
}

function pieceBounds(layout: BoardLayout, piece: Piece, r: number, s: number): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const [dr, ds] of piece.cells) {
    const g = cellGeometry(layout, r + dr, s + ds);
    // Sample along both arcs; the extremes of a sector always lie on them.
    for (const radius of [g.innerRadius, g.outerRadius]) {
      for (let i = 0; i <= 8; i++) {
        const angle = g.startAngle + ((g.endAngle - g.startAngle) * i) / 8;
        const x = g.cx + radius * Math.cos(angle);
        const y = g.cy + radius * Math.sin(angle);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Renders a piece centred inside `box`, scaled down to fit. Returns the scale
 * used so the drag layer can grow the piece to full board size as it is lifted.
 */
export function drawPiece(
  ctx: CanvasRenderingContext2D,
  piece: Piece,
  colourId: number,
  theme: Theme,
  spec: BoardSpec,
  box: Box,
  boardOuterRadius: number,
  alpha = 1,
  muted = false,
  stripedCell?: number,
): number {
  const layout = computeLayout(spec, 0, 0, boardOuterRadius);
  const { r, s } = anchorFor(piece, spec);
  const bounds = pieceBounds(layout, piece, r, s);
  if (bounds.width <= 0 || bounds.height <= 0) return 1;

  const scale = Math.min(box.width / bounds.width, box.height / bounds.height, 1);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-(bounds.x + bounds.width / 2), -(bounds.y + bounds.height / 2));

  piece.cells.forEach(([dr, ds], i) => {
    drawBlock(
      ctx,
      cellGeometry(layout, r + dr, s + ds),
      colourId,
      theme,
      1,
      muted,
      i === stripedCell,
    );
  });

  ctx.restore();
  return scale;
}
