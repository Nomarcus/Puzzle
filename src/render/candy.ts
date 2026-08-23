/**
 * A rounded candy square.
 *
 * Shared by the drifting blocks behind the menu and by the burst particles, so
 * everything that flies around the screen is made of the same sweet as the
 * board itself — lit along the top, shaded along the bottom.
 */

import { type Theme, blockColour } from "./theme.js";

export function drawCandySquare(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  angle: number,
  colourId: number,
  theme: Theme,
  alpha = 1,
): void {
  if (size <= 0 || alpha <= 0) return;

  const colour = blockColour(theme, colourId);
  const half = size / 2;
  const radius = size * 0.28;

  ctx.save();
  try {
    ctx.globalAlpha *= alpha;
    ctx.translate(x, y);
    ctx.rotate(angle);

    ctx.beginPath();
    ctx.moveTo(-half + radius, -half);
    ctx.arcTo(half, -half, half, half, radius);
    ctx.arcTo(half, half, -half, half, radius);
    ctx.arcTo(-half, half, -half, -half, radius);
    ctx.arcTo(-half, -half, half, -half, radius);
    ctx.closePath();

    ctx.fillStyle = colour.base;
    ctx.fill();

    ctx.save();
    try {
      ctx.clip();
      ctx.fillStyle = colour.light;
      ctx.fillRect(-half, -half, size, size * 0.3);
      ctx.fillStyle = colour.dark;
      ctx.fillRect(-half, half - size * 0.24, size, size * 0.24);
    } finally {
      ctx.restore();
    }
  } finally {
    // Never leave a rotation or a clip behind for the next frame to inherit.
    ctx.restore();
  }
}
