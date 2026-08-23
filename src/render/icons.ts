/**
 * Hand-drawn icons.
 *
 * The spin counter is the second most important number on screen, so it gets a
 * real drawn glyph rather than a font character — text glyphs render
 * differently on every device and an emoji would drag in a whole other visual
 * language.
 */

import type { Theme } from "./theme.js";

/** A circular arrow. `filled` distinguishes a spin you have from one you spent. */
export function drawSpinPip(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  filled: boolean,
  theme: Theme,
): void {
  const colour = filled ? theme.text : theme.textSoft;
  const start = -Math.PI * 0.62;
  const end = Math.PI * 1.06;

  ctx.save();
  ctx.globalAlpha = filled ? 1 : 0.32;
  ctx.strokeStyle = colour;
  ctx.lineWidth = radius * 0.34;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.arc(cx, cy, radius, start, end);
  ctx.stroke();

  // Arrowhead at the open end, pointing the way the ring travels.
  const tipX = cx + radius * Math.cos(start);
  const tipY = cy + radius * Math.sin(start);
  const head = radius * 0.5;
  const tangent = start - Math.PI / 2;

  ctx.beginPath();
  ctx.moveTo(tipX + head * Math.cos(tangent - 0.5), tipY + head * Math.sin(tangent - 0.5));
  ctx.lineTo(tipX + head * Math.cos(tangent + 0.5), tipY + head * Math.sin(tangent + 0.5));
  ctx.lineTo(tipX + head * Math.cos(tangent + Math.PI) * 0.1, tipY + head * Math.sin(tangent + Math.PI) * 0.1);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();

  ctx.restore();
}

/** A double-headed arrow, up and down: the push along a spoke. */
export function drawPushPip(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  filled: boolean,
  theme: Theme,
): void {
  const colour = filled ? theme.text : theme.textSoft;
  const reach = radius * 0.92;
  const head = radius * 0.5;

  ctx.save();
  ctx.globalAlpha = filled ? 1 : 0.32;
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = radius * 0.34;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(cx, cy - reach * 0.45);
  ctx.lineTo(cx, cy + reach * 0.45);
  ctx.stroke();

  for (const sign of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + sign * reach);
    ctx.lineTo(cx - head * 0.72, cy + sign * (reach - head));
    ctx.lineTo(cx + head * 0.72, cy + sign * (reach - head));
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

/** The row of spin pips: filled ones first, then spent ones ghosted out. */
export function drawSpinMeter(
  ctx: CanvasRenderingContext2D,
  rightX: number,
  cy: number,
  spins: number,
  maxSpins: number,
  theme: Theme,
): void {
  const radius = 11;
  const gap = radius * 2.9;
  for (let i = 0; i < maxSpins; i++) {
    const cx = rightX - radius - (maxSpins - 1 - i) * gap;
    drawSpinPip(ctx, cx, cy, radius, i < spins, theme);
  }
}

/** Always drawn, even at zero, so the player knows the power exists. */
export function drawPushMeter(
  ctx: CanvasRenderingContext2D,
  rightX: number,
  cy: number,
  pushes: number,
  maxPushes: number,
  theme: Theme,
): void {
  const radius = 11;
  const gap = radius * 2.9;
  for (let i = 0; i < maxPushes; i++) {
    const cx = rightX - radius - (maxPushes - 1 - i) * gap;
    drawPushPip(ctx, cx, cy, radius, i < pushes, theme);
  }
}
