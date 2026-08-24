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
import { computeLayout, drawBoard, fitCanvas, withRingOffset } from "../render/canvas.js";
import type { Theme } from "../render/theme.js";
import {
  type Drifter,
  type QuietZone,
  drawBackdropSheet,
  drawDrifters,
  makeBackdropSheet,
  makeCandySprites,
  makeDrifters,
} from "../render/backdrop.js";

const SPEC = DEFAULT_SPEC;

/** How fast each ring turns, in radians per second. Alternating signs. */
const RING_SPEED = [0.16, -0.11, 0.075, -0.05, 0.032];

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

export class MenuScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly board = decorativeBoard();
  private theme: Theme;
  private drifters: Drifter[] = [];
  private quiet: QuietZone[] = [];
  /** Baked sweets for the drift, one per colour. */
  private sprites: HTMLCanvasElement[] = [];
  private sheet: HTMLCanvasElement | null = null;
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
    this.sheet = makeBackdropSheet(this.width, this.height, this.theme, {
      x: this.width / 2,
      y: this.height * 0.3,
      radius: this.discRadius(),
    });
    this.sprites = makeCandySprites(this.theme);
    this.drifters = makeDrifters(this.width, this.height);
    // The menu column is the one thing here anybody reads. The disc is the
    // logo, and blocks pass behind it rather than being fenced off it.
    const column = Math.min(this.width, 380);
    this.quiet = [
      {
        x: (this.width - column) / 2,
        // From the title down: everything below the disc is text or buttons.
        y: this.height * 0.5,
        width: column,
        height: this.height * 0.5,
      },
    ];
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    // The background has the theme's colours baked into it.
    this.measure();
  }

  start(): void {
    if (this.frame) return;
    this.last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(now - this.last, 64) / 1000;
      this.last = now;
      this.clock += dt;
      this.render();
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

  private render(): void {
    const ctx = this.ctx;
    const scene = { width: this.width, height: this.height, clock: this.clock };

    drawBackdropSheet(ctx, this.sheet, this.width, this.height, this.theme);
    // Bolder here than in a round: the menu has nothing else to look at.
    drawDrifters(ctx, this.drifters, this.theme, {
      ...scene,
      alpha: 0.46,
      quiet: this.quiet,
      sprites: this.sprites,
      behind: { x: this.width / 2, y: this.height * 0.3, radius: this.discRadius() },
    });

    let layout = computeLayout(SPEC, this.width / 2, this.height * 0.3, this.discRadius());
    for (let r = 0; r < SPEC.rings; r++) {
      layout = withRingOffset(layout, r, this.clock * (RING_SPEED[r] ?? 0.1));
    }
    drawBoard(ctx, this.board, layout, this.theme);
  }
}
