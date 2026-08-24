/**
 * The playing screen: layout, pointer handling, animation loop, painting.
 *
 * Pointer state is inherently stateful and tied to the canvas, so it lives
 * here rather than being spread across modules. The maths it relies on sits in
 * input/gestures.ts, and every rule it enforces comes from the engine — this
 * file never decides what is legal, it only asks.
 */

import { type Cell } from "../engine/geometry.js";
import { colourOf, getCell, hasPlacement, isStone, isStripedValue } from "../engine/board.js";
import {
  type GameState,
  type Move,
  RULES,
  applyMove,
  dealFreshTray,
  depthOf,
  slotPiece,
} from "../engine/game.js";
import { rampActive } from "../engine/ramp.js";
import { type ClockSpec, addTime, drainRate, timeBonus } from "../engine/timeattack.js";
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
  pushSettle,
  shockwave,
  spinSettle,
  stoneLands,
  stepEffects,
} from "../render/animate.js";
import { type Particle, burst, drawParticles, stepParticles } from "../render/particles.js";
import {
  type BoardLayout,
  cellAtPoint,
  cellCentre,
  cellGeometry,
  computeLayout,
  drawBlock,
  drawBoard,
  drawGhost,
  drawStone,
  fitCanvas,
  ringWidth,
  withRingOffset,
  withSpokeOffset,
} from "../render/canvas.js";
import {
  type Drifter,
  type QuietZone,
  drawBackdropSheet,
  drawDrifters,
  makeBackdropSheet,
  makeCandySprites,
  makeDrifters,
} from "../render/backdrop.js";
import { drawPushMeter, drawSpinMeter } from "../render/icons.js";
import { type Theme, blockColour } from "../render/theme.js";
import { t } from "./strings.js";
import { play as playSound, unlock as unlockAudio } from "../platform/audio.js";
import { type Box, drawPiece } from "../render/tray.js";
import {
  angleAt,
  angleTravelled,
  clampPushPreview,
  clampSpinPreview,
  discAxis,
  dragTarget,
  pushCommits,
  radiusAt,
  spinCommits,
} from "../input/gestures.js";

/** Chunky and rounded on iOS; degrades to the system sans elsewhere. */
const FONT = '"SF Pro Rounded", ui-rounded, -apple-system, system-ui, sans-serif';

/** How far above the fingertip a dragged piece floats, so the thumb never hides it. */
const DRAG_LIFT = 76;

/** How long the dead board is left on screen before the result card. */
const DEATH_BEAT = 1250;

/**
 * Height reserved under the header for a level's goal strip. The strip is DOM
 * and the header is canvas, so nothing stops them overlapping except this.
 * Must match `.goal-strip`'s `top` in index.html.
 */
const GOAL_STRIP_ROW = 46;

export type HapticKind = "light" | "medium" | "heavy" | "success";

export interface GameScreenOptions {
  readonly theme: Theme;
  readonly onChange?: (state: GameState) => void;
  readonly onGameOver?: (state: GameState) => void;
  readonly haptic?: (kind: HapticKind) => void;
  /**
   * Runs a clock against the round. Time attack only. It lives here rather
   * than in the engine because the engine is a pure function of moves and
   * knows nothing about wall-clock time — which is what makes replays, the
   * daily's seed vetting and the balance bot possible.
   */
  readonly clock?: ClockSpec;
}

interface RunningClock {
  /** Seconds remaining. */
  left: number;
  /** Seconds of play so far. Drives how fast the rest drains. */
  elapsed: number;
  /** Last whole second announced, so the countdown ticks once per second. */
  lastTick: number;
}

type Pointer =
  | { kind: "none" }
  | { kind: "drag"; slot: number; piece: Piece; x: number; y: number; target: Cell | null }
  /**
   * One gesture on the disc, whose axis is decided by the first few pixels of
   * travel and then locked: around the rings is a spin, in and out is a push.
   */
  | {
      kind: "disc";
      ring: number;
      sector: number;
      startAngle: number;
      startRadius: number;
      axis: "spin" | "push" | null;
      delta: number;
    };

interface ScreenLayout {
  readonly width: number;
  readonly height: number;
  /** Kept so a frame can restore the base transform without re-measuring. */
  readonly dpr: number;
  /**
   * The band the game itself occupies. The canvas fills the whole window so
   * the background can too, but on an iPad a board stretched to the full width
   * would be absurd, so the playable column is capped and centred.
   */
  readonly contentLeft: number;
  readonly contentWidth: number;
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
  private particles: Particle[] = [];
  private pointer: Pointer = { kind: "none" };
  private frame = 0;
  private lastTime = 0;
  private displayScore = 0;
  /** Seconds since the screen opened. Only the background reads it. */
  private clock = 0;
  private drifters: Drifter[] = [];
  /** Where the drift makes way: the header corners and the tray. */
  private quiet: QuietZone[] = [];
  /** Baked sweets for the drift, one per colour. */
  private sprites: HTMLCanvasElement[] = [];
  /** The static background, baked once per size and theme. */
  private sheet: HTMLCanvasElement | null = null;
  /** Which tray slots still have somewhere to go. Recomputed after every move. */
  private placeable: boolean[] = [];
  private stuck = false;
  /**
   * When the board died. The result card is held back for a beat so the player
   * sees the disc that killed them instead of a card appearing from nowhere.
   */
  private diedAt = 0;
  private announced = false;
  private runningClock: RunningClock | null = null;
  /** Set when the clock ran out, so the result can say so rather than "stuck". */
  private timeUp = false;

  constructor(canvas: HTMLCanvasElement, state: GameState, options: GameScreenOptions) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.state = state;
    this.options = options;
    this.theme = options.theme;

    this.measure();
    this.refreshPlaceable();
    this.bindPointer();

    if (options.clock) {
      this.runningClock = { left: options.clock.seconds, elapsed: 0, lastTick: Math.ceil(options.clock.seconds) };
    }
  }

  /** Seconds left, or null when this round is not on a clock. */
  getClock(): number | null {
    return this.runningClock ? Math.max(0, this.runningClock.left) : null;
  }

  /** Whether the round ended because the clock ran out rather than the board. */
  ranOutOfTime(): boolean {
    return this.timeUp;
  }

  /** Seconds of play this round lasted. Only meaningful on a clock. */
  getElapsed(): number {
    return this.runningClock?.elapsed ?? 0;
  }

  /**
   * Takes seconds off the clock directly. Only the browser test uses it — a
   * test that waited out a real minute would be a test nobody runs.
   */
  burnClock(seconds: number): boolean {
    if (!this.runningClock) return false;
    this.runningClock.left = Math.max(0, this.runningClock.left - seconds);
    return true;
  }

  /**
   * Advances the clock. Called once a frame, and only while the round is live:
   * time must not drain during the beat where the dead board is held on screen,
   * or a player who just died would watch the clock keep falling.
   */
  private stepClock(dt: number): void {
    const spec = this.options.clock;
    const clock = this.runningClock;
    if (!spec || !clock || this.state.over || this.diedAt) return;

    const seconds = dt / 1000;
    clock.elapsed += seconds;
    clock.left -= seconds * drainRate(spec, clock.elapsed);

    // The last few seconds tick, once each, so the end is heard as well as
    // seen — by then the player is looking at the board, not the header.
    const whole = Math.ceil(Math.max(0, clock.left));
    if (whole < clock.lastTick) {
      clock.lastTick = whole;
      if (whole <= 5 && whole > 0) {
        playSound("tick", 0, 5 - whole);
        this.options.haptic?.("light");
      }
    }

    if (clock.left <= 0) {
      clock.left = 0;
      this.timeUp = true;
      this.pointer = { kind: "none" };
      this.diedAt = performance.now();
      playSound("gameOver");
      this.effects.push(shake());
    }
  }

  /**
   * A piece with nowhere to go is greyed out in the tray, so the disc visibly
   * closes in one slot at a time rather than ending without warning.
   */
  private refreshPlaceable(): void {
    this.placeable = this.state.tray.map((slot) => {
      const piece = slotPiece(slot);
      return piece !== null && hasPlacement(this.state.board, piece);
    });
    this.stuck = !this.placeable.some(Boolean);

    // The engine refills the tray whenever the last slot is spent, so an empty
    // tray on a live board should be unreachable. It is also the one state a
    // player cannot escape from, so it is worth refusing to display: deal a
    // fresh tray, keeping the board and the score, rather than leaving somebody
    // stuck with nothing to drag.
    if (!this.state.over && this.state.tray.every((slot) => slot === null)) {
      console.error("Shiftle: empty tray on a live board, dealing a fresh one");
      this.state = dealFreshTray(this.state);
      this.placeable = this.state.tray.map((slot) => {
        const piece = slotPiece(slot);
        return piece !== null && hasPlacement(this.state.board, piece);
      });
      this.stuck = !this.placeable.some(Boolean);
    }
  }

  // ---------------------------------------------------------------- lifecycle

  start(): void {
    if (this.frame) return;
    this.lastTime = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(now - this.lastTime, 64);
      this.lastTime = now;
      this.clock += dt / 1000;
      this.stepClock(dt);
      this.effects = stepEffects(this.effects, dt);
      this.particles = stepParticles(this.particles, dt);
      this.animateScore(dt);
      if (this.diedAt && !this.announced && now - this.diedAt > DEATH_BEAT) {
        this.announced = true;
        // The result screen is somebody else's code. A throw in it must not
        // take the animation loop with it: that would strand the player on
        // whatever half-built screen the throw left behind.
        try {
          this.options.onGameOver?.(this.state);
        } catch (error) {
          console.error("Shiftle: the result screen failed", error);
        }
      }

      // The frame is scheduled whatever happens. Painting is cosmetic, and a
      // throw in one effect must never be able to stop the loop and freeze a
      // round the player is in the middle of.
      try {
        this.render();
      } catch (error) {
        this.reportPaintFailure(error);
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  /** Logged once per screen; a repeating paint failure must not spam. */
  private paintFailed = false;

  private reportPaintFailure(error: unknown): void {
    // Dropped on every failure, not just the first: the effects are the most
    // likely cause, and leaving them in place after the second one lets a bad
    // frame repeat forever. Only the logging is rationed.
    this.particles = [];
    this.effects = [];
    if (this.paintFailed) return;
    this.paintFailed = true;
    console.error("Shiftle: paint failed, dropping effects", error);
  }

  stop(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    // The background has the theme's colours baked into it.
    this.measure();
  }

  /**
   * Applies a move through the same path a gesture takes, effects and all.
   * Used by the browser tests so long sessions exercise the real pipeline
   * rather than quietly skipping it.
   */
  playMove(move: Move): boolean {
    const before = this.state;
    this.commit(move, null, null);
    return this.state !== before;
  }

  isRunning(): boolean {
    return this.frame !== 0;
  }

  getState(): GameState {
    return this.state;
  }

  replaceState(state: GameState): void {
    this.state = state;
    this.displayScore = state.score;
    this.effects = [];
    this.particles = [];
    this.pointer = { kind: "none" };
    // A state handed in already dead still earns its beat before the card.
    this.diedAt = state.over ? performance.now() : 0;
    this.announced = false;
    this.refreshPlaceable();
  }

  resize(): void {
    this.measure();
  }

  /**
   * Where the furniture ended up. Only the browser tests read this — it is the
   * one way to check the safe-area insets landed without a notched device.
   */
  getLayout(): { headerY: number; trayTop: number; boardCy: number; boardRadius: number } {
    return {
      headerY: this.layout.headerY,
      trayTop: this.layout.trayTop,
      boardCy: this.layout.board.cy,
      boardRadius: this.layout.boardRadius,
    };
  }

  // ------------------------------------------------------------------ layout

  private measure(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const { width, height } = fitCanvas(this.canvas, dpr);

    const { top: safeTop, bottom: safeBottom } = safeInsets();

    // The playable column. A tablet is far wider than anyone wants to drag
    // across, so the game is capped and centred — but capped generously, since
    // the same disc marooned in a sea of empty blue looks worse than a large
    // one. Everything else on this screen is measured from this band, not from
    // the window, which is what keeps the tablet layout from spreading out to
    // the corners.
    const contentWidth = Math.min(width, 680);
    const contentLeft = (width - contentWidth) / 2;
    // Furniture grows with the column so a tablet gets a bigger game rather
    // than phone-sized furniture floating in it.
    const scale = Math.min(1.3, contentWidth / 390);

    // Row one is the quit and restart buttons (DOM, in the corners); the
    // score and spin meter sit on row two.
    const headerY = safeTop + 74;
    // Two meter rows on the right, always reserved: the board must not jump
    // the moment a push is earned. A level adds a row for the goal strip —
    // reserved rather than overlaid, because the strip is a DOM element and
    // floating it over the header put it straight through the piece counter.
    const goalRow = this.state.mode === "level" ? GOAL_STRIP_ROW : 0;
    const headerBottom = headerY + 82 + goalRow;
    // A generous tray: these pieces are the thing you grab, so they get room
    // to be drawn fat rather than dainty.
    const trayHeight = Math.round(168 * scale);
    const trayTop = height - safeBottom - trayHeight - 14;

    const boardRadius = Math.min(contentWidth * 0.485, (trayTop - headerBottom) / 2 - 10);
    const cx = width / 2;
    const cy = headerBottom + (trayTop - headerBottom) / 2;

    const gutter = 16 * scale;
    const slotWidth = (contentWidth - gutter * 2) / RULES.traySize;
    const slots: Box[] = [];
    for (let i = 0; i < RULES.traySize; i++) {
      slots.push({
        x: contentLeft + gutter + i * slotWidth,
        y: trayTop,
        width: slotWidth,
        height: trayHeight,
      });
    }

    this.layout = {
      width,
      height,
      dpr,
      contentLeft,
      contentWidth,
      board: computeLayout(this.state.spec, cx, cy, boardRadius),
      boardRadius,
      trayTop,
      trayHeight,
      slots,
      headerY,
    };

    this.sheet = makeBackdropSheet(width, height, this.theme, {
      x: cx,
      y: cy,
      radius: boardRadius,
    });

    // Scattered over the whole window, not just the playable column. On a
    // tablet the margins around the disc are the part that needs filling; on a
    // phone there is no margin at all, because the disc is nearly as wide as
    // the screen — so the drift rises past behind it instead of being fenced
    // off it. Where it has to make way is decided per frame, since it moves.
    this.sprites = makeCandySprites(this.theme);
    this.drifters = makeDrifters(width, height);
    // Sized to the text, not to the row: a zone any taller than what it
    // protects washes out blocks that were never in the way.
    const label = 170 * scale;
    this.quiet = [
      // The score on the left, the two meters on the right. Between and above
      // them is open, so blocks still rise through the top of the screen.
      { x: contentLeft, y: headerY - 28, width: label, height: 64 },
      { x: contentLeft + contentWidth - label, y: headerY - 24, width: label, height: 112 },
      // The tray is something you aim at.
      { x: 0, y: trayTop - 12, width, height: height - trayTop + 12 },
    ];

    if (goalRow > 0) {
      // The goal strip is translucent, so a sweet drifting behind it turns the
      // one line telling you what the level wants into mush.
      this.quiet.push({
        x: contentLeft + contentWidth * 0.06,
        y: headerY + 84,
        width: contentWidth * 0.88,
        height: goalRow,
      });
    }
  }

  /** The board layout with any in-flight spin offset folded in. */
  private liveBoardLayout(): BoardLayout {
    let layout = this.layout.board;

    if (this.pointer.kind === "disc" && this.pointer.axis === "spin") {
      layout = withRingOffset(layout, this.pointer.ring, this.pointer.delta);
    }
    if (this.pointer.kind === "disc" && this.pointer.axis === "push") {
      layout = withSpokeOffset(layout, this.pointer.sector, this.pointer.delta);
    }
    for (const effect of this.effects) {
      if (effect.kind === "spinSettle") {
        const eased = 1 - easeOutCubic(progress(effect));
        layout = withRingOffset(layout, effect.ring, effect.from * eased);
      }
      if (effect.kind === "pushSettle") {
        const eased = 1 - easeOutCubic(progress(effect));
        layout = withSpokeOffset(layout, effect.sector, effect.from * eased);
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
    // A pointer that leaves the surface without an up event would otherwise
    // leave a piece stuck to the cursor and its tray slot hidden.
    this.canvas.addEventListener("pointerleave", this.onCancel);
    this.canvas.addEventListener("lostpointercapture", this.onCancel);
  }

  /**
   * Every handler runs behind this. A throw in input is the one failure that
   * can leave the game looking alive but refusing to respond, so a bad event
   * drops the gesture and lets the next touch start clean rather than wedging
   * the screen.
   */
  private guard(handler: (event: PointerEvent) => void): (event: PointerEvent) => void {
    return (event: PointerEvent) => {
      try {
        handler(event);
      } catch (error) {
        this.pointer = { kind: "none" };
        console.error("Shiftle: input failed, gesture dropped", error);
      }
    };
  }

  destroy(): void {
    this.stop();
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("pointercancel", this.onCancel);
    this.canvas.removeEventListener("pointerleave", this.onCancel);
    this.canvas.removeEventListener("lostpointercapture", this.onCancel);
  }

  private pointAt(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private onDown = this.guard((event: PointerEvent): void => {
    unlockAudio();
    // Whatever the last gesture left behind, this touch starts fresh.
    this.pointer = { kind: "none" };
    if (this.state.over) return;

    const { x, y } = this.pointAt(event);
    // Capture can be refused for a pointer the browser no longer considers
    // active. Losing it costs precision, not the gesture.
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      /* carry on without capture */
    }

    // A drag that starts in the tray is a placement...
    const slot = this.slotAt(x, y);
    if (slot !== null) {
      const piece = slotPiece(this.state.tray[slot] ?? null);
      if (piece && !this.placeable[slot]) {
        // Silence here reads as a broken game, so say no out loud.
        this.effects.push(shake());
        this.options.haptic?.("medium");
        playSound("denied");
        return;
      }
      if (piece) {
        this.pointer = { kind: "drag", slot, piece, x, y, target: null };
        this.updateDragTarget();
        this.options.haptic?.("light");
      }
      return;
    }

    // ...and a drag that starts on the disc turns a ring or shoves a spoke,
    // decided by which way the thumb goes. The two can never be mistaken for a
    // placement, which is why there is no mode button.
    const cell = cellAtPoint(this.layout.board, x, y);
    if (cell) {
      if (this.state.spins <= 0 && this.state.pushes <= 0) {
        this.effects.push(denied());
        playSound("denied");
        return;
      }
      this.pointer = {
        kind: "disc",
        ring: cell.r,
        sector: cell.s,
        startAngle: angleAt(this.layout.board, x, y),
        startRadius: radiusAt(this.layout.board, x, y),
        axis: null,
        delta: 0,
      };
    }
  });

  private onMove = this.guard((event: PointerEvent): void => {
    if (this.pointer.kind === "none") return;
    const { x, y } = this.pointAt(event);

    if (this.pointer.kind === "drag") {
      this.pointer.x = x;
      this.pointer.y = y;
      this.updateDragTarget();
      return;
    }

    const board = this.layout.board;
    const angle = angleTravelled(this.pointer.startAngle, angleAt(board, x, y));
    const radial = radiusAt(board, x, y) - this.pointer.startRadius;
    const width = ringWidth(board);

    if (this.pointer.axis === null) {
      // Arc travel in pixels, so the two axes are compared in the same units.
      const arcPixels = angle * this.pointer.startRadius;
      const axis = discAxis(arcPixels, radial);
      if (axis === null) return;
      // Only offer an axis the player can actually pay for.
      if (axis === "spin" && this.state.spins <= 0) return;
      if (axis === "push" && this.state.pushes <= 0) return;
      this.pointer.axis = axis;
    }

    this.pointer.delta =
      this.pointer.axis === "spin"
        ? clampSpinPreview(angle, board.sectorAngle)
        : clampPushPreview(radial, width);
  });

  private onUp = this.guard((event: PointerEvent): void => {
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

    const board = this.layout.board;

    if (pointer.axis === "push") {
      const width = ringWidth(board);
      const dir = pushCommits(pointer.delta, width);
      if (dir === 0) {
        this.effects.push(pushSettle(pointer.sector, pointer.delta));
        return;
      }
      const carry = pointer.delta - dir * width;
      this.effects.push(pushSettle(pointer.sector, carry));
      playSound("spin", 0, pointer.sector);
      this.commit({ type: "push", sector: pointer.sector, dir: dir as SpinDirection }, null, null);
      return;
    }

    const sectorAngle = board.sectorAngle;
    const dir = spinCommits(pointer.delta, sectorAngle);
    if (dir === 0) {
      this.effects.push(spinSettle(pointer.ring, pointer.delta));
      return;
    }

    // The board rotates a whole sector now, so the visible offset jumps back by
    // that sector and eases to zero — the ring appears to carry on turning.
    const carry = pointer.delta - dir * sectorAngle;
    this.effects.push(spinSettle(pointer.ring, carry));
    playSound("spin", 0, this.state.spec.rings - 1 - pointer.ring);
    this.commit({ type: "spin", ring: pointer.ring, dir: dir as SpinDirection }, null, null);
    void event;
  });

  private onCancel = (): void => {
    if (this.pointer.kind === "disc" && this.pointer.axis === "spin") {
      this.effects.push(spinSettle(this.pointer.ring, this.pointer.delta));
    }
    if (this.pointer.kind === "disc" && this.pointer.axis === "push") {
      this.effects.push(pushSettle(this.pointer.sector, this.pointer.delta));
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
      // Colours come from the engine, which read them off the board at the
      // moment it wiped them. Recovering them here from the pre-move board
      // used to work for placements and was simply wrong after a spin: the
      // disc has already turned, so those coordinates hold somebody else's
      // block, or nothing at all.
      const cells = events.clearedCells;
      this.effects.push(clearBurst(cells));
      this.effects.push(shake());

      const lines = events.clears.rings.length + events.clears.spokes.length;
      const { cx, cy } = this.layout.board;

      // Debris flies outwards from the hub, so a ring throws its blocks off
      // the rim like a wheel and a bullseye throws the entire disc.
      const board = this.liveBoardLayout();
      for (const cell of cells) {
        const at = cellCentre(board, cell.r, cell.s);
        burst(this.particles, at.x, at.y, cell.colour, {
          count: events.sweep ? 5 : 7,
          speed: events.sweep ? 300 : 220,
          awayFrom: { x: board.cx, y: board.cy },
        });
      }

      if (events.sweep) {
        // The whole disc just went. It gets its own announcement, and which
        // one depends on how it was earned.
        const key = events.bullseye ? "bullseye" : "doubleStripe";
        this.effects.push(floatText(cx, cy - 40, t(key), true));
        // The signature, at full size. This is the moment the game is for.
        playSound("bonus", 2, 4);
        this.effects.push(shake());
        this.effects.push(shockwave(cx, cy, this.layout.boardRadius));
      } else if (events.stripesFired > 0) {
        this.effects.push(floatText(cx, cy - 40, t("stripe"), true));
        this.effects.push(shockwave(cx, cy, this.layout.boardRadius * 0.8));
        playSound("bonus", 0, 3);
        // A stripe tears across the board; it should not sound like a chime.
        playSound("stripe", events.combo, events.clears.rings[0] ?? events.clears.spokes[0] ?? 0);
      } else if (events.pureClears > 0) {
        this.effects.push(floatText(cx, cy - 40, t("pure"), true));
        this.effects.push(shockwave(cx, cy, this.layout.boardRadius * 0.8));
        playSound("bonus", 1, 2);
        playSound("pure", events.combo, events.clears.spokes[0] ?? events.clears.rings[0] ?? 0);
      } else {
        // The pitch says where on the disc it happened. The inner ring is the
        // smallest circle so it rings highest; spokes walk round the dial a
        // scale degree at a time.
        if (events.clears.rings.length > 0) {
          const ring = events.clears.rings[0]!;
          playSound("ring", events.combo, this.state.spec.rings - 1 - ring);
        } else {
          playSound("spoke", events.combo, events.clears.spokes[0] ?? 0);
        }
      }
      this.effects.push(
        floatText(cx, cy, `+${events.scoreDelta}`, events.sweep || events.clears.rings.length > 0),
      );
      if (events.combo >= 2) {
        this.effects.push(floatText(cx, cy + 46, `${t("combo")} x${events.combo}`));
      }
      this.options.haptic?.(
        events.sweep || lines > 1 || events.clears.rings.length > 0 ? "heavy" : "medium",
      );
    } else if (move.type === "place") {
      this.options.haptic?.("light");
      playSound("place", 0, this.state.spec.rings - 1 - move.r);
    }

    if (events.spinsGained > 0 || events.pushesGained > 0) this.options.haptic?.("success");

    // Seconds back on the clock. The only thing keeping a timed round alive, so
    // it gets its own float and its own sound rather than being folded into the
    // score that flies up at the same moment.
    const spec = this.options.clock;
    if (spec && this.runningClock && !this.timeUp) {
      const bonus = timeBonus(events);
      if (bonus > 0) {
        const before = this.runningClock.left;
        this.runningClock.left = addTime(spec, before, bonus);
        this.runningClock.lastTick = Math.ceil(this.runningClock.left);
        const gained = this.runningClock.left - before;
        // Half a second is the floor for saying anything. Near a full clock a
        // clear can land a fraction, and "+0.2s" shouted across the header is
        // noise about nothing.
        if (gained >= 0.5) {
          this.effects.push(
            floatText(
              this.layout.contentLeft + this.layout.contentWidth / 2,
              // Below the clock and its bar, not over them: the float rises as
              // it fades, and started life climbing straight through the one
              // number the player is watching.
              this.layout.headerY + 118,
              `+${gained.toFixed(1)}s`,
              gained >= 4,
            ),
          );
          playSound("gainTime", events.combo, events.clears.rings[0] ?? 0);
        }
      }
    }

    // The ramp. All of it announces itself: stone lands where you can watch it
    // land and the depth says its own name. A game that gets harder quietly is
    // the thing this one is arguing against.
    if (events.stoneDropped) {
      this.effects.push(stoneLands(events.stoneDropped));
      this.effects.push(shake());
      this.options.haptic?.("medium");
      playSound("stone", 0, this.state.spec.rings - 1 - events.stoneDropped.r);
    }

    if (events.depthReached !== null) {
      const { cx, cy } = this.layout.board;
      this.effects.push(floatText(cx, cy - 40, `${t("depth")} ${events.depthReached}`, true));
      this.options.haptic?.("heavy");
      playSound("deeper", 0, events.depthReached);
    }

    this.refreshPlaceable();
    this.options.onChange?.(this.state);
    if (events.gameOver && !this.diedAt) {
      this.diedAt = performance.now();
      playSound("gameOver");
    }
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

  /**
   * Puts the canvas back to a known state before anything is drawn.
   *
   * A frame that throws part-way through can leave save()s unbalanced, and an
   * unbalanced save is not a cosmetic problem — it keeps a clip and a
   * transform alive into the next frame, where they compound. A few dozen
   * frames of that and the disc is being drawn far off screen, which is what a
   * player sees as the page going blank. So no frame trusts the one before it
   * to have tidied up after itself.
   */
  private resetContext(): void {
    const ctx = this.ctx;
    // Restoring an empty stack is a no-op, so this simply unwinds whatever is
    // there. The cap keeps it a bounded amount of work.
    for (let i = 0; i < 64; i++) ctx.restore();
    ctx.setTransform(this.layout.dpr, 0, 0, this.layout.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  private render(): void {
    const ctx = this.ctx;
    const { width, height } = this.layout;

    this.resetContext();
    ctx.save();
    try {
      const jolt = this.shakeOffset();
      if (jolt !== 0) ctx.translate(jolt, jolt * 0.5);

      drawBackdropSheet(ctx, this.sheet, width, height, this.theme);

      const board = this.liveBoardLayout();

      // The drift, in its own pass: it is the layer nobody would miss, so it
      // is never allowed to cost the player a frame of the board. Fainter than
      // on the menu — here it sits behind a puzzle somebody is concentrating on.
      try {
        drawDrifters(ctx, this.drifters, this.theme, {
          width,
          height,
          clock: this.clock,
          alpha: 0.38,
          quiet: this.quiet,
          sprites: this.sprites,
          behind: { x: board.cx, y: board.cy, radius: this.layout.boardRadius },
        });
      } catch (error) {
        this.reportPaintFailure(error);
      }

      this.drawHeader(ctx);
      drawBoard(ctx, this.state.board, board, this.theme);

      // Decoration, in its own pass. If any of it throws, the player still gets
      // a board and a tray they can act on.
      try {
        this.drawDropPops(ctx, board);
        this.drawStoneDrops(ctx, board);
        this.drawClearBursts(ctx, board);
        if (this.pointer.kind === "drag") this.drawDrag(ctx, board);
        this.drawShockwaves(ctx);
        drawParticles(ctx, this.particles, this.theme);
      } catch (error) {
        this.reportPaintFailure(error);
      }

      this.drawTray(ctx);
      this.drawStuckHint(ctx);

      try {
        this.drawFloatingText(ctx);
        this.drawDeathBeat(ctx);
      } catch (error) {
        this.reportPaintFailure(error);
      }
    } finally {
      ctx.restore();
    }
  }

  /**
   * The rescue prompt. Nothing fits but spins remain — this is the moment the
   * whole game is built around, so it gets said plainly rather than left for
   * the player to work out from pieces that refuse to move.
   */
  private drawStuckHint(ctx: CanvasRenderingContext2D): void {
    if (!this.stuck || this.diedAt) return;
    if (this.state.spins <= 0 && this.state.pushes <= 0) return;

    const text = this.state.spins > 0 ? t("stuckHint") : t("stuckPush");
    const y = this.layout.trayTop - 26;
    const pulse = 1 + Math.sin(performance.now() / 260) * 0.03;

    ctx.save();
    ctx.font = `800 15px ${FONT}`;
    const width = ctx.measureText(text).width + 34;
    const height = 38;
    const x = this.layout.width / 2;

    ctx.translate(x, y);
    ctx.scale(pulse, pulse);

    const warm = blockColour(this.theme, 2);
    roundRect(ctx, -width / 2, -height / 2, width, height, height / 2);
    ctx.fillStyle = warm.base;
    ctx.shadowColor = "rgba(0,0,0,0.22)";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 3;
    ctx.fill();
    ctx.shadowColor = "transparent";

    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 0, 1);
    ctx.restore();
  }

  /** Holds the dead board on screen for a beat, so the ending has a cause. */
  private drawDeathBeat(ctx: CanvasRenderingContext2D): void {
    // Once the result card is up it owns the screen; leaving the beat drawn
    // underneath bleeds through the card's translucent backing.
    if (!this.diedAt || this.announced) return;

    const t0 = Math.min((performance.now() - this.diedAt) / 420, 1);
    const { width, height } = this.layout;

    // A neutral shade rather than the theme colour: tinting the board with its
    // own backdrop shifts every block's hue and the disc goes muddy.
    ctx.save();
    ctx.globalAlpha = t0 * 0.45;
    ctx.fillStyle = "#0C283A";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = t0;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `900 27px ${FONT}`;
    ctx.lineWidth = 7;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(12, 40, 58, 0.85)";
    ctx.strokeText(t("stuckOver"), width / 2, this.layout.board.cy);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(t("stuckOver"), width / 2, this.layout.board.cy);
    ctx.restore();
  }

  /** The ring of light that races out on a bullseye. */
  private drawShockwaves(ctx: CanvasRenderingContext2D): void {
    for (const effect of this.effects) {
      if (effect.kind !== "shockwave") continue;
      const t0 = progress(effect);
      const eased = easeOutCubic(t0);

      ctx.save();
      ctx.globalAlpha = 1 - eased;
      // White vanished against the near-white plate; the warm accent reads on
      // the plate and on the backdrop alike.
      ctx.strokeStyle = blockColour(this.theme, 2).base;
      ctx.lineWidth = 24 * (1 - eased) + 4;
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, effect.radius * (0.05 + eased * 1.25), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
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
    const { headerY, contentLeft, contentWidth } = this.layout;
    const left = contentLeft + 24;
    const right = contentLeft + contentWidth - 24;
    const centre = contentLeft + contentWidth / 2;

    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = this.theme.text;
    ctx.font = `800 38px ${FONT}`;
    ctx.fillText(Math.round(this.displayScore).toLocaleString("sv-SE"), left, headerY);

    ctx.font = `700 12px ${FONT}`;
    ctx.fillStyle = this.theme.textSoft;
    ctx.fillText(t("score"), left + 1, headerY + 26);

    // The spin meter flinches when a spin is attempted with none left.
    let nudge = 0;
    for (const effect of this.effects) {
      if (effect.kind !== "denied") continue;
      const t = progress(effect);
      nudge = Math.sin(t * Math.PI * 5) * 6 * (1 - t);
    }

    ctx.save();
    ctx.translate(nudge, 0);
    // While nothing fits, the meter breathes: it is the only way out.
    if (this.stuck && (this.state.spins > 0 || this.state.pushes > 0) && !this.diedAt) {
      const beat = 1 + Math.sin(performance.now() / 260) * 0.12;
      ctx.translate(right, headerY - 2);
      ctx.scale(beat, beat);
      ctx.translate(-right, -(headerY - 2));
    }
    drawSpinMeter(ctx, right, headerY - 2, this.state.spins, this.state.rules.maxSpins, this.theme);
    ctx.restore();

    ctx.textAlign = "right";
    ctx.font = `700 12px ${FONT}`;
    ctx.fillStyle = this.theme.textSoft;
    ctx.fillText(t("spins"), right, headerY + 26);

    drawPushMeter(ctx, right, headerY + 52, this.state.pushes, this.state.rules.maxPushes, this.theme);
    ctx.textAlign = "right";
    ctx.font = `700 12px ${FONT}`;
    ctx.fillStyle = this.theme.textSoft;
    ctx.fillText(t("pushes"), right, headerY + 78);

    // A rationed round has to show what is left of the ration. A ramping one
    // shows the depth instead — the two never both apply, and both belong in
    // the same place: the one number that says how far through this round is.
    const limit = this.state.rules.pieceLimit;
    const depth = depthOf(this.state);
    if (limit > 0) {
      const remaining = Math.max(0, limit - this.state.stats.piecesPlaced);
      ctx.textAlign = "center";
      ctx.font = `800 22px ${FONT}`;
      ctx.fillStyle = this.theme.text;
      ctx.fillText(String(remaining), centre, headerY - 2);
      ctx.font = `700 12px ${FONT}`;
      ctx.fillStyle = this.theme.textSoft;
      ctx.fillText(t("pieces"), centre, headerY + 26);
    } else if (this.runningClock && this.options.clock) {
      // The clock owns the centre in a timed round. It is the only number that
      // matters — the score is a consequence of it, not a competitor for
      // attention — so it is drawn larger than anything else in the header and
      // turns red at the point where it is worth panicking.
      const left = Math.max(0, this.runningClock.left);
      const urgent = left <= 10;
      const beat = urgent ? 1 + Math.sin(performance.now() / 90) * 0.07 : 1;

      ctx.save();
      try {
        ctx.textAlign = "center";
        ctx.translate(centre, headerY - 2);
        ctx.scale(beat, beat);
        ctx.font = `900 34px ${FONT}`;
        ctx.fillStyle = urgent ? "#FF2D42" : this.theme.text;
        ctx.fillText(left >= 10 ? left.toFixed(0) : left.toFixed(1), 0, 0);
      } finally {
        ctx.restore();
      }

      ctx.textAlign = "center";
      ctx.font = `700 12px ${FONT}`;
      ctx.fillStyle = urgent ? "#FF2D42" : this.theme.textSoft;
      ctx.fillText(t("time"), centre, headerY + 26);

      // A bar under it, because a number falling is harder to read at a glance
      // than a bar emptying — and at ten seconds nobody is reading anything.
      const spec = this.options.clock;
      const barWidth = Math.min(180, this.layout.contentWidth * 0.4);
      const barY = headerY + 40;
      ctx.save();
      try {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = this.theme.textSoft;
        ctx.beginPath();
        ctx.roundRect(centre - barWidth / 2, barY, barWidth, 6, 3);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = urgent ? "#FF2D42" : "#4FD31A";
        const filled = Math.max(0, Math.min(1, left / spec.seconds)) * barWidth;
        ctx.beginPath();
        ctx.roundRect(centre - barWidth / 2, barY, filled, 6, 3);
        ctx.fill();
      } finally {
        ctx.restore();
      }
    } else if (rampActive(this.state.ramp)) {
      // Flashes for a moment on the way down, so the number that just changed
      // is the one thing moving on an otherwise still header.
      let flash = 0;
      for (const effect of this.effects) {
        if (effect.kind === "float" && effect.text.startsWith(t("depth"))) {
          flash = 1 - progress(effect);
        }
      }
      ctx.textAlign = "center";
      ctx.font = `800 22px ${FONT}`;
      ctx.fillStyle = flash > 0 ? this.theme.text : this.theme.textSoft;
      ctx.save();
      const scale = 1 + flash * 0.35;
      ctx.translate(centre, headerY - 2);
      ctx.scale(scale, scale);
      ctx.fillText(String(depth), 0, 0);
      ctx.restore();
      ctx.font = `700 12px ${FONT}`;
      ctx.fillStyle = this.theme.textSoft;
      ctx.fillText(t("depth"), centre, headerY + 26);
    }
  }

  private drawDropPops(ctx: CanvasRenderingContext2D, board: BoardLayout): void {
    for (const effect of this.effects) {
      if (effect.kind !== "drop") continue;
      const t = easeOutBack(progress(effect));
      for (const cell of effect.cells) {
        const g = cellGeometry(board, cell.r, cell.s);
        // The raw cell carries the stripe flag in a high bit, so it has to be
        // unpacked: handing it over whole picks the wrong colour and loses the
        // stripe's cross.
        const value = getCell(this.state.board, cell.r, cell.s);
        if (value === 0) continue;
        ctx.save();
        try {
          ctx.globalAlpha = Math.min(1, t * 2);
          if (isStone(value)) drawStone(ctx, g, this.theme);
          else drawBlock(ctx, g, colourOf(value), this.theme, 1, false, isStripedValue(value));
        } finally {
          ctx.restore();
        }
      }
    }
  }

  /**
   * Stone arriving. It falls in from outside the rim and lands heavy — the one
   * thing on this board that comes from somewhere else.
   */
  private drawStoneDrops(ctx: CanvasRenderingContext2D, board: BoardLayout): void {
    for (const effect of this.effects) {
      if (effect.kind !== "stone") continue;
      const t = progress(effect);
      const g = cellGeometry(board, effect.cell.r, effect.cell.s);
      const drop = (1 - easeOutBack(t)) * board.outerRadius * 0.35;
      const angle = (g.startAngle + g.endAngle) / 2;

      ctx.save();
      try {
        ctx.globalAlpha = Math.min(1, t * 3);
        ctx.translate(Math.cos(angle) * drop, Math.sin(angle) * drop);
        drawStone(ctx, g, this.theme);
      } finally {
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
        try {
          ctx.translate(g.cx, g.cy);
          ctx.scale(grow, grow);
          ctx.translate(-g.cx, -g.cy);
          // Stone has no colour id, so it must not be routed through the candy
          // palette — colour 0 there is a clamped guess, not a grey.
          if (cell.stone) drawStone(ctx, g, this.theme, fade);
          else drawBlock(ctx, g, cell.colour, this.theme, fade);

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
        } finally {
          // A throw between save and restore is not cosmetic: it leaves the
          // scale above alive into the next frame, where it compounds until
          // the disc is drawn far off screen and the player is left with a
          // blank page. The frame is always handed back balanced.
          ctx.restore();
        }
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
      false,
      this.state.tray[slot]?.striped,
    );
  }

  private drawTray(ctx: CanvasRenderingContext2D): void {
    const { slots, trayTop, trayHeight, contentLeft, contentWidth } = this.layout;

    ctx.save();
    ctx.globalAlpha = 0.55;
    roundRect(ctx, contentLeft + 12, trayTop - 6, contentWidth - 24, trayHeight + 8, 26);
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
        this.placeable[i] ? 1 : 0.65,
        !this.placeable[i],
        slot.striped,
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

/**
 * The safe-area insets, in pixels.
 *
 * Measured off a real element rather than read off the custom property that
 * index.html parks on :root. Reading it directly means parsing whatever the
 * engine hands back for a custom property, and whether `env()` inside one is
 * substituted at that point is engine-dependent — Chromium resolves it to
 * "0px", but this ships in WKWebView and a literal "env(...)" string would
 * parse to NaN and quietly become zero. On a notched phone that is the
 * difference between the score sitting under the Dynamic Island and not.
 *
 * Going through `var()` on a real property is resolved by the normal cascade
 * everywhere, and it keeps the insets overridable, which is the only way to
 * test this without a notched device.
 */
let insetProbe: HTMLDivElement | null = null;

function safeInsets(): { top: number; bottom: number } {
  if (!insetProbe) {
    insetProbe = document.createElement("div");
    insetProbe.setAttribute("aria-hidden", "true");
    insetProbe.style.cssText =
      "position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;" +
      "padding-top:var(--safe-top);padding-bottom:var(--safe-bottom);";
    document.body.append(insetProbe);
  }

  const style = getComputedStyle(insetProbe);
  const top = Number.parseFloat(style.paddingTop);
  const bottom = Number.parseFloat(style.paddingBottom);
  return {
    top: Number.isFinite(top) ? top : 0,
    bottom: Number.isFinite(bottom) ? bottom : 0,
  };
}
