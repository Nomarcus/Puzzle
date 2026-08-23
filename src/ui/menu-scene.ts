/**
 * The animated menu background.
 *
 * The disc is the logo. It is filled as a rainbow wheel and its rings turn at
 * different speeds in alternating directions, which shows what the game is and
 * what the one special move does before the player has read a single word.
 *
 * Candy blocks drift behind it so the screen is never a flat wash of colour.
 */

import { DEFAULT_SPEC } from "../engine/geometry.js";
import { type Board, createBoard } from "../engine/board.js";
import { cellIndex } from "../engine/geometry.js";
import { computeLayout, drawBoard, paintBackdrop, fitCanvas, withRingOffset } from "../render/canvas.js";
import { type Theme, blockColour } from "../render/theme.js";

const SPEC = DEFAULT_SPEC;

/** How fast each ring turns, in radians per second. Alternating signs. */
const RING_SPEED = [0.16, -0.11, 0.075, -0.05, 0.032];

interface Drifter {
  x: number;
  y: number;
  size: number;
  colour: number;
  angle: number;
  spin: number;
  driftY: number;
}

/**
 * A rainbow wheel with a few gaps punched out. The gaps stop it reading as a
 * solid colour chart and hint that this is a board with room left on it.
 */
function decorativeBoard(): Board {
  const board = createBoard(SPEC);
  for (let r = 0; r < SPEC.rings; r++) {
    for (let s = 0; s < SPEC.sectors; s++) {
      if ((r * 5 + s * 2) % 7 === 0) continue;
      board.cells[cellIndex(SPEC, r, s)] = ((s + r) % 8) + 1;
    }
  }
  return board;
}

function makeDrifters(width: number, height: number): Drifter[] {
  const drifters: Drifter[] = [];
  // Fixed arrangement rather than random, so the menu looks the same every
  // time the player opens it.
  const spots: Array<[number, number, number, number]> = [
    [0.1, 0.12, 30, 3],
    [0.88, 0.18, 24, 6],
    [0.16, 0.72, 26, 8],
    [0.84, 0.66, 32, 4],
    [0.5, 0.06, 20, 1],
    [0.08, 0.44, 18, 2],
    [0.92, 0.42, 22, 7],
  ];
  for (const [fx, fy, size, colour] of spots) {
    drifters.push({
      x: width * fx,
      y: height * fy,
      size,
      colour,
      angle: fx * 6 + fy * 3,
      spin: 0.25 + fx * 0.4,
      driftY: 0,
    });
  }
  return drifters;
}

function candySquare(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  angle: number,
  colourId: number,
  theme: Theme,
  alpha: number,
): void {
  const colour = blockColour(theme, colourId);
  const half = size / 2;
  const radius = size * 0.28;

  ctx.save();
  ctx.globalAlpha = alpha;
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
  ctx.clip();
  // Lit along the top, shaded along the bottom — same language as the board.
  ctx.fillStyle = colour.light;
  ctx.fillRect(-half, -half, size, size * 0.3);
  ctx.fillStyle = colour.dark;
  ctx.fillRect(-half, half - size * 0.24, size, size * 0.24);
  ctx.restore();

  ctx.restore();
}

export class MenuScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly board = decorativeBoard();
  private theme: Theme;
  private drifters: Drifter[] = [];
  private width = 0;
  private height = 0;
  private frame = 0;
  private clock = 0;
  private last = 0;

  constructor(canvas: HTMLCanvasElement, theme: Theme) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.theme = theme;
    this.measure();
  }

  measure(): void {
    const size = fitCanvas(this.canvas, Math.min(window.devicePixelRatio || 1, 3));
    this.width = size.width;
    this.height = size.height;
    this.drifters = makeDrifters(this.width, this.height);
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
  }

  start(): void {
    if (this.frame) return;
    this.last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(now - this.last, 64) / 1000;
      this.last = now;
      this.clock += dt;
      this.render(dt);
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  /** Where the disc sits, so the DOM can lay itself out underneath. */
  discBottom(): number {
    return this.height * 0.3 + this.discRadius() + 20;
  }

  private discRadius(): number {
    return Math.min(this.width * 0.4, this.height * 0.21);
  }

  private render(dt: number): void {
    const ctx = this.ctx;
    paintBackdrop(ctx, this.width, this.height, this.theme);

    for (const drifter of this.drifters) {
      drifter.angle += drifter.spin * dt;
      drifter.driftY = Math.sin(this.clock * 0.6 + drifter.x * 0.01) * 12;
      candySquare(
        ctx,
        drifter.x,
        drifter.y + drifter.driftY,
        drifter.size,
        drifter.angle,
        drifter.colour,
        this.theme,
        0.42,
      );
    }

    let layout = computeLayout(SPEC, this.width / 2, this.height * 0.3, this.discRadius());
    for (let r = 0; r < SPEC.rings; r++) {
      layout = withRingOffset(layout, r, this.clock * (RING_SPEED[r] ?? 0.1));
    }
    drawBoard(ctx, this.board, layout, this.theme);
  }
}
