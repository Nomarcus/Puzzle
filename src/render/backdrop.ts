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
  /** Fractions of the screen height per second. Negative: everything rises. */
  readonly rise: number;
}

/** Roughly one candidate block per square of this many pixels a side. */
const CELL = 96;

/**
 * A fixed hash rather than an RNG: the background looks the same every time
 * the game is opened, which is what makes it read as designed rather than as
 * noise, and it needs no state threaded through it.
 */
function hash(x: number, y: number, salt: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * Somewhere the drift should keep out of: the score, the meters, the tray, the
 * menu column. Blocks fade out as they approach rather than vanishing at an
 * edge, because a block that pops out of existence is far more distracting
 * than one drifting past.
 */
export interface QuietZone {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** How far outside a quiet zone a block is back to full strength. */
const QUIET_FADE = 54;

function quietFactor(zones: readonly QuietZone[], x: number, y: number): number {
  let factor = 1;
  for (const zone of zones) {
    // Distance from the rectangle, zero anywhere inside it.
    const dx = Math.max(zone.x - x, x - (zone.x + zone.width), 0);
    const dy = Math.max(zone.y - y, y - (zone.y + zone.height), 0);
    factor = Math.min(factor, Math.min(1, Math.hypot(dx, dy) / QUIET_FADE));
    if (factor === 0) return 0;
  }
  return factor;
}

/**
 * Scatters blocks over a jittered grid, so the count follows the area of the
 * screen: a phone gets a modest handful and a tablet fills its wide margins
 * without anyone having to pick a number per device.
 *
 * Nothing is filtered out here. Where they are allowed to be is decided every
 * frame instead, because they move.
 */
export function makeDrifters(width: number, height: number): Drifter[] {
  if (width <= 0 || height <= 0) return [];

  const cols = Math.max(3, Math.round(width / CELL));
  const rows = Math.max(4, Math.round(height / CELL));
  const drifters: Drifter[] = [];

  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      // Leaving gaps is what stops it looking like wallpaper.
      if (hash(col, row, 1) < 0.42) continue;

      const depth = 0.35 + hash(col, row, 4) * 0.65;
      drifters.push({
        fx: (col + 0.15 + hash(col, row, 2) * 0.7) / cols,
        fy: (row + 0.15 + hash(col, row, 3) * 0.7) / rows,
        size: 14 + depth * 26,
        colour: 1 + Math.floor(hash(col, row, 5) * 8),
        phase: hash(col, row, 6) * Math.PI * 2,
        // The near ones tumble faster, which is what sells the depth.
        spin: (0.06 + depth * 0.2) * (hash(col, row, 7) < 0.5 ? -1 : 1),
        depth,
        // ...and rise faster. Slow enough that nothing races the eye: the
        // whole field takes upwards of a minute to cross the screen.
        rise: -(0.006 + depth * 0.013),
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
  /** Where the drift has to make way for something the player is reading. */
  readonly quiet?: readonly QuietZone[];
  /** Baked sweets, from makeCandySprites. Falls back to drawing when absent. */
  readonly sprites?: readonly HTMLCanvasElement[];
  /**
   * The disc. Blocks pass behind it — the plate is opaque, so one sliding
   * under simply disappears and comes out the other side, which reads as depth
   * and is what gives a phone any room at all. Blocks buried deep enough to be
   * invisible are skipped, to save the draw rather than to change the look.
   */
  readonly behind?: { x: number; y: number; radius: number };
}

/**
 * One baked sweet per colour.
 *
 * A drifting block is a rounded path, a clip and three fills — perfectly
 * affordable for one and not for ninety, which is what a tablet ends up with.
 * Since they are all the same eight shapes at different sizes and angles, they
 * are drawn once into sprites and blitted after that. Rotation and scale come
 * free from the blit.
 *
 * Baked larger than any drifter is drawn, so it is always a downscale and
 * never a soft upscale.
 */
const SPRITE = 96;

export function makeCandySprites(theme: Theme): HTMLCanvasElement[] {
  const sprites: HTMLCanvasElement[] = [];

  for (let colour = 1; colour <= 8; colour++) {
    const canvas = document.createElement("canvas");
    canvas.width = SPRITE;
    canvas.height = SPRITE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return [];
    // A hair of margin so the rounded corners keep their antialiasing.
    drawCandySquare(ctx, SPRITE / 2, SPRITE / 2, SPRITE * 0.94, 0, colour, theme, 1);
    sprites.push(canvas);
  }

  return sprites;
}

export function drawDrifters(
  ctx: CanvasRenderingContext2D,
  drifters: readonly Drifter[],
  theme: Theme,
  options: BackdropOptions,
): void {
  const { width, height, clock } = options;
  const alpha = options.alpha ?? 0.4;
  const quiet = options.quiet ?? [];
  const behind = options.behind;

  for (const drifter of drifters) {
    // The near ones swing further, so the whole field does not move as a sheet.
    const swing = 8 + drifter.depth * 16;
    const x = width * drifter.fx + Math.cos(clock * 0.31 + drifter.phase) * swing * 0.5;

    // Rising, and wrapped: a block that leaves the top comes back at the
    // bottom, so the field never runs out. The margin keeps the wrap itself
    // off screen.
    const margin = 0.06;
    const span = 1 + margin * 2;
    let travel = (drifter.fy + margin + clock * drifter.rise) % span;
    if (travel < 0) travel += span;
    const y = height * (travel - margin) + Math.sin(clock * 0.42 + drifter.phase) * swing * 0.4;

    if (behind) {
      const buried = behind.radius - drifter.size;
      if (buried > 0 && Math.hypot(x - behind.x, y - behind.y) < buried) continue;
    }

    const strength = quietFactor(quiet, x, y);
    if (strength <= 0) continue;

    const fade = alpha * (0.55 + drifter.depth * 0.45) * strength;
    const angle = clock * drifter.spin + drifter.phase;
    const sprite = options.sprites?.[drifter.colour - 1];

    if (!sprite) {
      drawCandySquare(ctx, x, y, drifter.size, angle, drifter.colour, theme, fade);
      continue;
    }

    ctx.save();
    try {
      ctx.globalAlpha *= fade;
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.drawImage(sprite, -drifter.size / 2, -drifter.size / 2, drifter.size, drifter.size);
    } finally {
      ctx.restore();
    }
  }
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

  // Some of the pools are tinted rather than white. A single-hue gradient is
  // what makes a backdrop read as "just blue": these put a warm corner and a
  // cool one into it, far too faint to name but enough that the eye stops
  // seeing one flat colour.
  const spots: ReadonlyArray<readonly [fx: number, fy: number, scale: number, tint: string]> = [
    [0.12, 0.16, 0.55, "255, 255, 255"],
    [0.9, 0.28, 0.5, "255, 214, 120"],
    [0.06, 0.52, 0.45, "255, 160, 190"],
    [0.2, 0.84, 0.5, "255, 255, 255"],
    [0.86, 0.92, 0.48, "150, 245, 220"],
  ];
  for (const [fx, fy, scale, tint] of spots) {
    const radius = Math.max(w, h) * scale;
    const x = w * fx;
    const y = h * fy;

    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${tint}, 0.30)`);
    gradient.addColorStop(1, `rgba(${tint}, 0)`);
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
