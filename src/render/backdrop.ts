/**
 * The living background, shared by the menu and the game.
 *
 * A flat gradient is fine behind a phone-sized board — there is barely any
 * background left to see. On an iPad the disc only fills the middle and
 * everything either side reads as dead space, so the backdrop has to carry the
 * screen on its own.
 *
 * It does that with three layers, cheapest first: soft pools of light, a
 * scattering of candy blocks drifting past, and a halo under the disc so the
 * board sits on the page instead of floating over it. How many blocks there
 * are follows the size of the screen, so a phone stays calm and a tablet fills
 * up.
 *
 * Deliberately slow and low-contrast. This sits behind a puzzle, and anything
 * that pulls the eye off the disc is a bug, not decoration.
 */

import type { Theme } from "./theme.js";
import { drawCandySquare } from "./candy.js";

export interface Drifter {
  /** Fractions of the viewport, so a resize moves them rather than scattering them. */
  readonly fx: number;
  readonly fy: number;
  readonly size: number;
  readonly colour: number;
  readonly phase: number;
  readonly spin: number;
  /** 0 is far away and faint, 1 is near and solid. Gives the drift some depth. */
  readonly depth: number;
}

/** Roughly one candidate block per square of this many pixels a side. */
const CELL = 148;

/**
 * A fixed hash rather than an RNG: the background looks the same every time
 * the game is opened, which is what makes it read as designed rather than as
 * noise, and it needs no state threaded through it.
 */
function hash(x: number, y: number, salt: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

export interface KeepClear {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** A rectangle the drift stays out of. Used for menu text and buttons. */
export interface KeepClearBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Scatters blocks over a jittered grid, so the count follows the area of the
 * screen: a phone gets a handful around the edges and a tablet fills its wide
 * margins without anyone having to pick a number per device.
 *
 * `keepClear` is where the disc will be, and `avoid` is anything the player
 * has to read. Blocks landing inside either are dropped rather than nudged
 * aside, which keeps a clean gap instead of a suspicious ring of debris
 * hugging whatever they were pushed off.
 */
export function makeDrifters(
  width: number,
  height: number,
  keepClear?: KeepClear,
  avoid?: KeepClearBox,
): Drifter[] {
  if (width <= 0 || height <= 0) return [];

  const cols = Math.max(2, Math.round(width / CELL));
  const rows = Math.max(3, Math.round(height / CELL));
  const drifters: Drifter[] = [];

  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      // Leaving gaps is what stops it looking like wallpaper.
      if (hash(col, row, 1) < 0.34) continue;

      const fx = (col + 0.2 + hash(col, row, 2) * 0.6) / cols;
      const fy = (row + 0.2 + hash(col, row, 3) * 0.6) / rows;

      const x = fx * width;
      const y = fy * height;

      if (keepClear && Math.hypot(x - keepClear.x, y - keepClear.y) < keepClear.radius) continue;
      if (
        avoid &&
        x > avoid.x &&
        x < avoid.x + avoid.width &&
        y > avoid.y &&
        y < avoid.y + avoid.height
      ) {
        continue;
      }

      const depth = 0.35 + hash(col, row, 4) * 0.65;
      drifters.push({
        fx,
        fy,
        size: 13 + depth * 21,
        colour: 1 + Math.floor(hash(col, row, 5) * 8),
        phase: hash(col, row, 6) * Math.PI * 2,
        // The near ones tumble faster, which is what sells the depth.
        spin: (0.06 + depth * 0.2) * (hash(col, row, 7) < 0.5 ? -1 : 1),
        depth,
      });
    }
  }

  return drifters;
}

export interface BackdropOptions {
  readonly width: number;
  readonly height: number;
  /** Seconds since the screen opened. Drives the drift. */
  readonly clock: number;
  /** Scales the whole layer down. The game uses less of it than the menu. */
  readonly alpha?: number;
}

export interface Halo {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/**
 * The entire static background, baked into one sheet: the gradient, the soft
 * pools of light that stop a wide screen reading as a flat wash, and the halo
 * that sits the disc on the page rather than floating it over one.
 *
 * None of it moves, and every layer covers the whole screen. Drawn live that
 * is six full-screen passes a frame, which on a tablet is most of the frame
 * budget spent on something nobody is looking at. Baked, it is one blit.
 *
 * The sheet is kept at CSS resolution rather than device resolution: it is
 * nothing but soft gradients, so the upscale costs nothing visible, and the
 * bake stays cheap enough to redo on a rotate or a theme change.
 */
export function makeBackdropSheet(
  width: number,
  height: number,
  theme: Theme,
  halo?: Halo,
): HTMLCanvasElement | null {
  if (width <= 0 || height <= 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const w = canvas.width;
  const h = canvas.height;

  const base = ctx.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, theme.backdrop[0]);
  base.addColorStop(1, theme.backdrop[1]);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  const spots: ReadonlyArray<readonly [number, number, number]> = [
    [0.12, 0.18, 0.55],
    [0.88, 0.32, 0.45],
    [0.2, 0.82, 0.5],
    [0.82, 0.9, 0.4],
  ];
  for (const [fx, fy, scale] of spots) {
    const radius = Math.max(w, h) * scale;
    const x = w * fx;
    const y = h * fy;

    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, "rgba(255, 255, 255, 0.20)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }

  if (halo && halo.radius > 0) {
    const outer = halo.radius * 2.1;
    const gradient = ctx.createRadialGradient(halo.x, halo.y, halo.radius * 0.4, halo.x, halo.y, outer);
    gradient.addColorStop(0, theme.backdrop[0]);
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

    ctx.globalAlpha = 0.6;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(halo.x, halo.y, outer, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  return canvas;
}

/**
 * One blit. Falls back to the plain gradient if the sheet could not be made,
 * so a browser that refuses an offscreen canvas still gets a background.
 */
export function drawBackdropSheet(
  ctx: CanvasRenderingContext2D,
  sheet: HTMLCanvasElement | null,
  width: number,
  height: number,
  theme: Theme,
): void {
  if (sheet) {
    ctx.drawImage(sheet, 0, 0, width, height);
    return;
  }

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, theme.backdrop[0]);
  gradient.addColorStop(1, theme.backdrop[1]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

export function drawDrifters(
  ctx: CanvasRenderingContext2D,
  drifters: readonly Drifter[],
  theme: Theme,
  options: BackdropOptions,
): void {
  const { width, height, clock } = options;
  const alpha = options.alpha ?? 0.4;

  for (const drifter of drifters) {
    // The near ones swing further, so the whole field does not move as a sheet.
    const swing = 8 + drifter.depth * 16;
    const x = width * drifter.fx + Math.cos(clock * 0.31 + drifter.phase) * swing * 0.5;
    const y = height * drifter.fy + Math.sin(clock * 0.42 + drifter.phase) * swing;

    drawCandySquare(
      ctx,
      x,
      y,
      drifter.size,
      clock * drifter.spin + drifter.phase,
      drifter.colour,
      theme,
      alpha * (0.4 + drifter.depth * 0.6),
    );
  }
}

