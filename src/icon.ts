/**
 * App icon and splash source art.
 *
 * Rendered from the game's own board renderer rather than drawn separately, so
 * the icon is literally the thing you play — same geometry, same candy bevel,
 * same palette. @capacitor/assets slices every size from these two squares.
 */

import { createBoard } from "./engine/board.js";
import { cellIndex, type BoardSpec } from "./engine/geometry.js";
import { computeLayout, drawBoard, paintBackdrop } from "./render/canvas.js";
import { SKY } from "./render/theme.js";

const SPEC: BoardSpec = { rings: 5, sectors: 12 };

/** A full rainbow wheel — no gaps, so the icon reads as a solid mark. */
function iconBoard() {
  const board = createBoard(SPEC);
  for (let r = 0; r < SPEC.rings; r++) {
    for (let s = 0; s < SPEC.sectors; s++) {
      board.cells[cellIndex(SPEC, r, s)] = ((s + r) % 8) + 1;
    }
  }
  return board;
}

function render(id: string, size: number, discFraction: number) {
  const canvas = document.createElement("canvas");
  canvas.id = id;
  canvas.width = size;
  canvas.height = size;
  document.body.append(canvas);

  const ctx = canvas.getContext("2d")!;
  paintBackdrop(ctx, size, size, SKY);

  // No rounded corners of our own: iOS applies its own mask, and a second
  // radius inside it looks like a mistake.
  const layout = computeLayout(SPEC, size / 2, size / 2, size * discFraction, {
    pad: size * 0.006,
    corner: size * 0.02,
  });
  drawBoard(ctx, iconBoard(), layout, SKY);
}

render("icon", 1024, 0.38);
render("splash", 2732, 0.12);
