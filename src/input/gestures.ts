/**
 * Gesture maths, kept pure so it can be reasoned about (and tested) without a
 * browser.
 *
 * The two gestures can never be confused with one another: a drag that starts
 * in the tray is always a placement, and a drag that starts on the disc is
 * always a spin. That is why the game needs no mode button.
 */

import type { Cell } from "../engine/geometry.js";
import { type Board, canPlace } from "../engine/board.js";
import type { Piece } from "../engine/pieces.js";
import { type BoardLayout, ANGLE_ORIGIN, cellAtPoint } from "../render/canvas.js";

/** How much of a sector the thumb must travel before a spin commits. */
export const SPIN_COMMIT_FRACTION = 0.4;

/**
 * Turns the cell under the finger into a piece anchor, by backing off to the
 * piece's middle. Without this the piece would hang down-and-right of the
 * thumb instead of sitting under it.
 */
export function anchorFromCell(piece: Piece, cell: Cell): Cell {
  return {
    r: cell.r - Math.floor((piece.radialExtent - 1) / 2),
    s: cell.s - Math.floor((piece.sectorExtent - 1) / 2),
  };
}

/**
 * Looks for a legal home near the requested anchor, nearest first.
 *
 * Fingers are imprecise and the inner cells are small, so a placement that is
 * one cell off should still land where the player obviously meant. The search
 * is deliberately tight — being helpful is good, moving the piece somewhere
 * the player did not intend is not.
 */
export function findSnap(
  board: Board,
  piece: Piece,
  desired: Cell,
  radialSlack = 1,
  sectorSlack = 1,
): Cell | null {
  const candidates: Array<{ cell: Cell; cost: number }> = [];

  for (let dr = -radialSlack; dr <= radialSlack; dr++) {
    for (let ds = -sectorSlack; ds <= sectorSlack; ds++) {
      const cell = { r: desired.r + dr, s: desired.s + ds };
      if (!canPlace(board, piece, cell.r, cell.s)) continue;
      // Radial slips are more disruptive than angular ones, so cost them more.
      candidates.push({ cell, cost: Math.abs(dr) * 1.6 + Math.abs(ds) });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.cost - b.cost);
  return candidates[0]!.cell;
}

/** Where a dragged piece wants to go, or null if it is not over the disc. */
export function dragTarget(
  layout: BoardLayout,
  board: Board,
  piece: Piece,
  x: number,
  y: number,
): Cell | null {
  const cell = cellAtPoint(layout, x, y);
  if (!cell) return null;
  return findSnap(board, piece, anchorFromCell(piece, cell));
}

export function angleAt(layout: BoardLayout, x: number, y: number): number {
  return Math.atan2(y - layout.cy, x - layout.cx) - ANGLE_ORIGIN;
}

/** Signed angle travelled since the gesture began, unwrapped across the seam. */
export function angleTravelled(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

/**
 * A spin preview never runs past one sector — the move is always exactly one
 * step, so letting the ring follow the thumb further would promise something
 * the rules do not deliver.
 */
export function clampSpinPreview(delta: number, sectorAngle: number): number {
  return Math.max(-sectorAngle, Math.min(sectorAngle, delta));
}

export function spinCommits(delta: number, sectorAngle: number): 1 | -1 | 0 {
  if (Math.abs(delta) < sectorAngle * SPIN_COMMIT_FRACTION) return 0;
  return delta > 0 ? 1 : -1;
}
