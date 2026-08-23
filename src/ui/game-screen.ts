/**
 * The playing screen: layout, pointer handling, animation loop, painting.
 *
 * Pointer state is inherently stateful and tied to the canvas, so it lives
 * here rather than being spread across modules. The maths it relies on sits in
 * input/gestures.ts, and every rule it enforces comes from the engine — this
 * file never decides what is legal, it only asks.
 */

import { type Cell } from "../engine/geometry.js";
import { getCell } from "../engine/board.js";
import {
  type GameState,
  type Move,
  RULES,
  applyMove,
  slotPiece,
} from "../engine/game.js";
import type { Piece } from "../engine/pieces.js";
import type { SpinDirection } from "../engine/rotate.js";
import {
  type Effect,
  clearBurst,
  denied,
  dropIn,
  easeOutBack,
  easeOutCubic,
  floatText,
  progress,
  shake,
  spinSettle,
  stepEffects,
} from "../render/animate.js";
import {
  type BoardLayout,
  cellAtPoint,
  cellGeometry,
  computeLayout,
  drawBlock,
  drawBoard,
  drawGhost,
  fitCanvas,
  paintBackdrop,
  withRingOffset,
} from "../render/canvas.js";
import { drawSpinMeter } from "../render/icons.js";
import { type Theme, blockColour } from "../render/theme.js";
import { t } from "./strings.js";
import { type Box, drawPiece } from "../render/tray.js";
import {
  angleAt,
  angleTravelled,
  clampSpinPreview,
  dragTarget,
  spinCommits,
} from "../input/gestures.js";

/** Chunky and rounded on iOS; degrades to the system sans elsewhere. */
const FONT = '"SF Pro Rounded", ui-rounded, -apple-system, system-ui, sans-serif';

/** How far above the fingertip a dragged piece floats, so the thumb never hides it. */
const DRAG_LIFT = 76;

export type HapticKind = "light" | "medium" | "heavy" | "success";

export interface GameScreenOptions {
  readonly theme: Theme;
  readonly onChange?: (state: GameState) => void;
  readonly onGameOver?: (state: GameState) => void;
  readonly haptic?: (kind: HapticKind) => void;
}

type Pointer =
  | { kind: "none" }
  | { kind: "drag"; slot: number; piece: Piece; x: number; y: number; target: Cell | null }
  | { kind: "spin"; ring: number; startAngle: number; delta: number };

interface ScreenLayout {
  readonly width: number;
  readonly height: number;
  readonly board: BoardLayout;
  readonly boardRadius: number;
  readonly trayTop: number;
  readonly trayHeight: number;
  readonly slots: readonly Box[];
  readonly headerY: number;
}

export class GameScreen {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private options: GameScreenOptions;

  private state: GameState;
  private theme: Theme;
  private layout!: ScreenLayout;
  private effects: Effect[] = [];
  private pointer: Pointer = { kind: "none" };
  private frame = 0;
  private lastTime = 0;
  private displayScore = 0;

  constructor(canvas: HTMLCanvasElement, state: GameState, options: GameScreenOptions) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.state = state;
    this.options = options;
    this.theme = options.theme;

    this.measure();
    this.bindPointer();
  }

  // ---------------------------------------------------------------- lifecycle

  start(): void {
    if (this.frame) return;
    this.lastTime = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(now - this.lastTime, 64);
      this.lastTime = now;
      this.effects = stepEffects(this.effects, dt);
      this.animateScore(dt);
      this.render();
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
  }

  getState(): GameState {
    return this.state;
  }

  replaceState(state: GameState): void {
    this.state = state;
    this.displayScore = state.score;
    this.effects = [];
    this.pointer = { kind: "none" };
  }

  resize(): void {
    this.measure();
  }

  // ------------------------------------------------------------------ layout

  private measure(): void {
    const { width, height } = fitCanvas(this.canvas, Math.min(window.devicePixelRatio || 1, 3));

    const safeTop = readSafeInset("--safe-top");
    const safeBottom = readSafeInset("--safe-bottom");

    // Row one is the quit and restart buttons (DOM, in the corners); the
    // score and spin meter sit on row two.
    const headerY = safeTop + 74;
    const headerBottom = headerY + 38;
    // A generous tray: these pieces are the thing you grab, so they get room
    // to be drawn fat rather than dainty.
    const trayHeight = 168;
    const trayTop = height - safeBottom - trayHeight - 14;

    // The disc is limited by the width of the phone, not its height.
    const boardRadius = Math.min(width * 0.485, (trayTop - headerBottom) / 2 - 10);
    const cx = width / 2;
    const cy = headerBottom + (trayTop - headerBottom) / 2;

    const gutter = 16;
    const slotWidth = (width - gutter * 2) / RULES.traySize;
    const slots: Box[] = [];
    for (let i = 0; i < RULES.traySize; i++) {
      slots.push({
        x: gutter + i * slotWidth,
        y: trayTop,
        width: slotWidth,
        height: trayHeight,
      });
    }

    this.layout = {
      width,
      height,
      board: computeLayout(this.state.spec, cx, cy, boardRadius),
      boardRadius,
      trayTop,
      trayHeight,
      slots,
      headerY,
    };
  }

  /** The board layout with any in-flight spin offset folded in. */
  private liveBoardLayout(): BoardLayout {
    let layout = this.layout.board;

    if (this.pointer.kind === "spin") {
      layout = withRingOffset(layout, this.pointer.ring, this.pointer.delta);
    }
    for (const effect of this.effects) {
      if (effect.kind === "spinSettle") {
        const eased = 1 - easeOutCubic(progress(effect));
        layout = withRingOffset(layout, effect.ring, effect.from * eased);
      }
    }
    return layout;
  }

  // ------------------------------------------------------------------- input

  private bindPointer(): void {
    this.canvas.style.touchAction = "none";
    this.canvas.addEventListener("pointerdown", this.onDown);
    this.canvas.addEventListener("pointermove", this.onMove);
    this.canvas.addEventListener("pointerup", this.onUp);
    this.canvas.addEventListener("pointercancel", this.onCancel);
  }

  destroy(): void {
    this.stop();
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("pointercancel", this.onCancel);
  }

  private pointAt(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private onDown = (event: PointerEvent): void => {
    if (this.state.over) return;
    const { x, y } = this.pointAt(event);
    this.canvas.setPointerCapture(event.pointerId);

    // A drag that starts in the tray is a placement...
    const slot = this.slotAt(x, y);
    if (slot !== null) {
      const piece = slotPiece(this.state.tray[slot] ?? null);
      if (piece) {
        this.pointer = { kind: "drag", slot, piece, x, y, target: null };
        this.updateDragTarget();
        this.options.haptic?.("light");
      }
      return;
    }

    // ...and a drag that starts on the disc is a spin. The two can never be
    // mistaken for one another, which is why there is no mode button.
    const cell = cellAtPoint(this.layout.board, x, y);
    if (cell) {
      if (this.state.spins <= 0) {
        this.effects.push(denied());
        return;
      }
      this.pointer = {
        kind: "spin",
        ring: cell.r,
        startAngle: angleAt(this.layout.board, x, y),
        delta: 0,
      };
    }
  };

  private onMove = (event: PointerEvent): void => {
    if (this.pointer.kind === "none") return;
    const { x, y } = this.pointAt(event);

    if (this.pointer.kind === "drag") {
      this.pointer.x = x;
      this.pointer.y = y;
      this.updateDragTarget();
      return;
    }

    const travelled = angleTravelled(this.pointer.startAngle, angleAt(this.layout.board, x, y));
    this.pointer.delta = clampSpinPreview(travelled, this.layout.board.sectorAngle);
  };

  private onUp = (event: PointerEvent): void => {
    const pointer = this.pointer;
    this.pointer = { kind: "none" };
    if (pointer.kind === "none") return;

    if (pointer.kind === "drag") {
      if (pointer.target) {
        this.commit(
          { type: "place", slot: pointer.slot, r: pointer.target.r, s: pointer.target.s },
          pointer.target,
          pointer.piece,
        );
      }
      return;
    }

    const sectorAngle = this.layout.board.sectorAngle;
    const dir = spinCommits(pointer.delta, sectorAngle);
    if (dir === 0) {
      this.effects.push(spinSettle(pointer.ring, pointer.delta));
      return;
    }

    // The board rotates a whole sector now, so the visible offset jumps back by
    // that sector and eases to zero — the ring appears to carry on turning.
    const carry = pointer.delta - dir * sectorAngle;
    this.effects.push(spinSettle(pointer.ring, carry));
    this.commit({ type: "spin", ring: pointer.ring, dir: dir as SpinDirection }, null, null);
    void event;
  };

  private onCancel = (): void => {
    if (this.pointer.kind === "spin") {
      this.effects.push(spinSettle(this.pointer.ring, this.pointer.delta));
    }
    this.pointer = { kind: "none" };
  };

  private slotAt(x: number, y: number): number | null {
    if (y < this.layout.trayTop) return null;
    for (let i = 0; i < this.layout.slots.length; i++) {
      const box = this.layout.slots[i]!;
      if (x >= box.x && x <= box.x + box.width) return i;
    }
    return null;
  }

  private updateDragTarget(): void {
    if (this.pointer.kind !== "drag") return;
    this.pointer.target = dragTarget(
      this.layout.board,
      this.state.board,
      this.pointer.piece,
      this.pointer.x,
      this.pointer.y - DRAG_LIFT,
    );
  }

  // -------------------------------------------------------------- committing

  private commit(move: Move, target: Cell | null, piece: Piece | null): void {
    const before = this.state;
    const result = applyMove(before, move);
    if (!result) {
      this.effects.push(shake());
      return;
    }

    this.state = result.state;
    const { events } = result;

    if (target && piece) {
      this.effects.push(
        dropIn(piece.cells.map(([dr, ds]) => ({ r: target.r + dr, s: target.s + ds }))),
      );
    }

    if (events.clearedCells.length > 0) {
      // The colours have already been wiped from the board, so recover them
      // from the pre-move board — falling back to the colour just placed.
      const cells = events.clearedCells.map((cell) => {
        const previous = getCell(before.board, cell.r, cell.s);
        return { ...cell, colour: previous === 0 ? events.colour : previous };
      });
      this.effects.push(clearBurst(cells));
      this.effects.push(shake());

      const lines = events.clears.rings.length + events.clears.spokes.length;
      const label = events.clears.rings.length > 0 ? `+${events.scoreDelta}` : `+${events.scoreDelta}`;
      this.effects.push(
        floatText(this.layout.board.cx, this.layout.board.cy, label, events.clears.rings.length > 0),
      );
      if (events.combo >= 2) {
        this.effects.push(
          floatText(this.layout.board.cx, this.layout.board.cy + 46, `${t("combo")} x${events.combo}`),
        );
      }
      this.options.haptic?.(lines > 1 || events.clears.rings.length > 0 ? "heavy" : "medium");
    } else if (move.type === "place") {
      this.options.haptic?.("light");
    }

    if (events.spinsGained > 0) this.options.haptic?.("success");

    this.options.onChange?.(this.state);
    if (events.gameOver) this.options.onGameOver?.(this.state);
  }

  // ------------------------------------------------------------------ paint

  private animateScore(dt: number): void {
    const gap = this.state.score - this.displayScore;
    if (Math.abs(gap) < 1) {
      this.displayScore = this.state.score;
      return;
    }
    this.displayScore += gap * Math.min(1, dt / 120);
  }

  private render(): void {
    const ctx = this.ctx;
    const { width, height } = this.layout;

    ctx.save();

    const jolt = this.shakeOffset();
    if (jolt !== 0) ctx.translate(jolt, jolt * 0.5);

    paintBackdrop(ctx, width, height, this.theme);
    this.drawHeader(ctx);

    const board = this.liveBoardLayout();
    drawBoard(ctx, this.state.board, board, this.theme);
    this.drawDropPops(ctx, board);
    this.drawClearBursts(ctx, board);

    if (this.pointer.kind === "drag") this.drawDrag(ctx, board);

    this.drawTray(ctx);
    this.drawFloatingText(ctx);

    ctx.restore();
  }

  private shakeOffset(): number {
    let offset = 0;
    for (const effect of this.effects) {
      if (effect.kind !== "shake") continue;
      const t = progress(effect);
      offset += Math.sin(t * Math.PI * 6) * 5 * (1 - t);
    }
    return offset;
  }

  private drawHeader(ctx: CanvasRenderingContext2D): void {
    const { headerY, width } = this.layout;

    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = this.theme.text;
    ctx.font = `800 38px ${FONT}`;
    ctx.fillText(Math.round(this.displayScore).toLocaleString("sv-SE"), 24, headerY);

    ctx.font = `700 12px ${FONT}`;
    ctx.fillStyle = this.theme.textSoft;
    ctx.fillText(t("score"), 25, headerY + 26);

    // The spin meter flinches when a spin is attempted with none left.
    let nudge = 0;
    for (const effect of this.effects) {
      if (effect.kind !== "denied") continue;
      const t = progress(effect);
      nudge = Math.sin(t * Math.PI * 5) * 6 * (1 - t);
    }

    ctx.save();
    ctx.translate(nudge, 0);
    drawSpinMeter(ctx, width - 24, headerY - 2, this.state.spins, RULES.maxSpins, this.theme);
    ctx.restore();

    ctx.textAlign = "right";
    ctx.font = `700 12px ${FONT}`;
    ctx.fillStyle = this.theme.textSoft;
    ctx.fillText(t("spins"), width - 24, headerY + 26);
  }

  private drawDropPops(ctx: CanvasRenderingContext2D, board: BoardLayout): void {
    for (const effect of this.effects) {
      if (effect.kind !== "drop") continue;
      const t = easeOutBack(progress(effect));
      for (const cell of effect.cells) {
        const g = cellGeometry(board, cell.r, cell.s);
        const colour = getCell(this.state.board, cell.r, cell.s);
        if (colour === 0) continue;
        ctx.save();
        ctx.globalAlpha = Math.min(1, t * 2);
        drawBlock(ctx, g, colour, this.theme);
        ctx.restore();
      }
    }
  }

  private drawClearBursts(ctx: CanvasRenderingContext2D, board: BoardLayout): void {
    for (const effect of this.effects) {
      if (effect.kind !== "clear") continue;
      const t = progress(effect);
      const fade = 1 - easeOutCubic(t);

      for (const cell of effect.cells) {
        const g = cellGeometry(board, cell.r, cell.s);
        const grow = 1 + easeOutCubic(t) * 0.22;
        ctx.save();
        ctx.translate(g.cx, g.cy);
        ctx.scale(grow, grow);
        ctx.translate(-g.cx, -g.cy);
        drawBlock(ctx, g, cell.colour, this.theme, fade);

        // A white flash on the way out.
        if (t < 0.4) {
          ctx.globalAlpha = (1 - t / 0.4) * 0.7;
          ctx.fillStyle = "#FFFFFF";
          ctx.beginPath();
          ctx.arc(
            g.cx + ((g.innerRadius + g.outerRadius) / 2) * Math.cos((g.startAngle + g.endAngle) / 2),
            g.cy + ((g.innerRadius + g.outerRadius) / 2) * Math.sin((g.startAngle + g.endAngle) / 2),
            (g.outerRadius - g.innerRadius) * 0.36,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  private drawDrag(ctx: CanvasRenderingContext2D, board: BoardLayout): void {
    if (this.pointer.kind !== "drag") return;
    const { piece, slot, target, x, y } = this.pointer;
    const colour = this.state.tray[slot]?.colour ?? 1;

    if (target) {
      // Over a legal home: snap the piece into the board so the player sees
      // exactly what they are about to get.
      drawGhost(ctx, board, piece, target.r, target.s, colour, this.theme);
      return;
    }

    // Otherwise it rides above the fingertip at full board scale.
    drawPiece(
      ctx,
      piece,
      colour,
      this.theme,
      this.state.spec,
      { x: x - 90, y: y - DRAG_LIFT - 60, width: 180, height: 120 },
      this.layout.boardRadius,
      0.9,
    );
  }

  private drawTray(ctx: CanvasRenderingContext2D): void {
    const { slots, trayTop, trayHeight, width } = this.layout;

    ctx.save();
    ctx.globalAlpha = 0.4;
    roundRect(ctx, 12, trayTop - 6, width - 24, trayHeight + 8, 26);
    ctx.fillStyle = this.theme.plate;
    ctx.fill();
    ctx.restore();

    this.state.tray.forEach((slot, i) => {
      if (!slot) return;
      // The piece under the thumb is drawn on the board instead.
      if (this.pointer.kind === "drag" && this.pointer.slot === i) return;
      const box = slots[i]!;
      drawPiece(
        ctx,
        slotPiece(slot)!,
        slot.colour,
        this.theme,
        this.state.spec,
        { x: box.x + 6, y: box.y + 12, width: box.width - 12, height: box.height - 24 },
        this.layout.boardRadius,
      );
    });
  }

  private drawFloatingText(ctx: CanvasRenderingContext2D): void {
    for (const effect of this.effects) {
      if (effect.kind !== "float") continue;
      const t = progress(effect);
      const rise = easeOutCubic(t) * 54;
      const alpha = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `800 ${effect.big ? 44 : 24}px ${FONT}`;
      ctx.lineWidth = effect.big ? 8 : 5;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineJoin = "round";
      ctx.strokeText(effect.text, effect.x, effect.y - rise);
      ctx.fillStyle = blockColour(this.theme, effect.big ? 2 : 6).base;
      ctx.fillText(effect.text, effect.x, effect.y - rise);
      ctx.restore();
    }
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Reads a safe-area inset that index.html has parked on :root. */
function readSafeInset(variable: string): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(variable);
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}
