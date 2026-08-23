/**
 * Look preview. Not part of the game — it exists so the art direction can be
 * judged from a screenshot before the rest of the UI is built on top of it.
 */

import { DEFAULT_SPEC } from "./engine/geometry.js";
import { hasPlacement, placements } from "./engine/board.js";
import { type GameState, applyMove, createGame, slotPiece } from "./engine/game.js";
import { pieceById } from "./engine/pieces.js";
import { THEMES, type Theme } from "./render/theme.js";
import { computeLayout, drawBoard, paintBackdrop } from "./render/canvas.js";
import { drawPiece } from "./render/tray.js";
import { drawSpinMeter } from "./render/icons.js";

const WIDTH = 390;
const HEIGHT = 720;
const DPR = 3;

/** Plays a few sensible-looking turns so the disc is not empty in the shot. */
function midGame(seed: number, turns: number): GameState {
  let state = createGame({ seed });
  for (let i = 0; i < turns && !state.over; i++) {
    let moved = false;
    for (let slot = 0; slot < state.tray.length; slot++) {
      const piece = slotPiece(state.tray[slot] ?? null);
      if (!piece || !hasPlacement(state.board, piece)) continue;
      const spots = placements(state.board, piece);
      // Prefer the outer rings so the disc fills from the rim inwards.
      const spot = spots.sort((a, b) => b.r - a.r)[i % Math.min(3, spots.length)] ?? spots[0]!;
      const result = applyMove(state, { type: "place", slot, r: spot.r, s: spot.s });
      if (result) {
        state = result.state;
        moved = true;
        break;
      }
    }
    if (!moved) break;
  }
  return state;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawScreen(ctx: CanvasRenderingContext2D, theme: Theme, state: GameState) {
  paintBackdrop(ctx, WIDTH, HEIGHT, theme);

  // Header: score on the left, spins on the right.
  ctx.fillStyle = theme.text;
  ctx.font = "800 40px -apple-system, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(state.score.toLocaleString("sv-SE"), 26, 64);

  ctx.font = "700 13px -apple-system, system-ui, sans-serif";
  ctx.fillStyle = theme.textSoft;
  ctx.fillText("POÄNG", 27, 92);

  drawSpinMeter(ctx, WIDTH - 26, 62, 2, 3, theme);
  ctx.textAlign = "right";
  ctx.font = "700 13px -apple-system, system-ui, sans-serif";
  ctx.fillStyle = theme.textSoft;
  ctx.fillText("SNURR", WIDTH - 26, 92);

  // The disc.
  const radius = WIDTH * 0.44;
  const layout = computeLayout(DEFAULT_SPEC, WIDTH / 2, 300, radius);
  drawBoard(ctx, state.board, layout, theme);

  // Tray.
  const trayY = 560;
  const trayH = 120;
  ctx.save();
  ctx.globalAlpha = 0.45;
  roundRect(ctx, 18, trayY, WIDTH - 36, trayH, 28);
  ctx.fillStyle = theme.plate;
  ctx.fill();
  ctx.restore();

  // A hand-picked tray, so the shot shows off an arc, a rosette and a wedge
  // rather than whatever the simulated game happened to leave behind.
  const showcase: Array<[string, number]> = [
    ["arc4", 6],
    ["rosette", 4],
    ["hookOut", 8],
  ];
  const slotW = (WIDTH - 36) / 3;
  showcase.forEach(([id, colour], i) => {
    drawPiece(
      ctx,
      pieceById(id),
      colour,
      theme,
      DEFAULT_SPEC,
      { x: 18 + i * slotW + 8, y: trayY + 10, width: slotW - 16, height: trayH - 20 },
      radius,
    );
  });
}

for (const theme of THEMES) {
  const figure = document.createElement("figure");
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * DPR;
  canvas.height = HEIGHT * DPR;

  const caption = document.createElement("figcaption");
  caption.textContent = theme.label;

  figure.append(canvas, caption);
  document.body.append(figure);

  const ctx = canvas.getContext("2d")!;
  ctx.scale(DPR, DPR);
  drawScreen(ctx, theme, midGame(2026, 14));
}
