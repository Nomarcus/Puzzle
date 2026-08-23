/**
 * The game as a pure reducer: applyMove(state, move) -> new state.
 *
 * No DOM, no timers, no Math.random. Everything the renderer needs in order to
 * animate a turn comes back in the events object, so the view never has to
 * diff two boards to work out what happened.
 *
 * Keeping this pure buys three things: unit tests, replays that can be
 * re-simulated to validate a leaderboard score, and a headless bot that can
 * play thousands of games to balance the rules.
 */

import { type BoardSpec, type Cell, DEFAULT_SPEC } from "./geometry.js";
import {
  type Board,
  type Clears,
  applyClears,
  canPlace,
  createBoard,
  findClears,
  hasClears,
  hasPlacement,
  pieceCells,
  place,
} from "./board.js";
import { type Piece, drawPiece, pieceById } from "./pieces.js";
import { nextInt } from "./rng.js";
import { type SpinDirection, spinRing } from "./rotate.js";
import { clearScore, placementScore } from "./scoring.js";

export const RULES = {
  traySize: 3,
  startingSpins: 1,
  maxSpins: 3,
  /** Lines you must clear to earn one spin back. */
  clearsPerSpin: 2,
  /** Number of distinct block colours. Must match the palette in the theme. */
  colours: 8,
} as const;

export type GameMode = "daily" | "endless";

export interface TraySlot {
  readonly pieceId: string;
  readonly colour: number;
}

export type Move =
  | { readonly type: "place"; readonly slot: number; readonly r: number; readonly s: number }
  | { readonly type: "spin"; readonly ring: number; readonly dir: SpinDirection };

export interface GameStats {
  piecesPlaced: number;
  cellsPlaced: number;
  ringsCleared: number;
  spokesCleared: number;
  spinsUsed: number;
  bestCombo: number;
  bestClear: number;
}

export interface GameState {
  readonly mode: GameMode;
  readonly spec: BoardSpec;
  readonly board: Board;
  readonly tray: readonly (TraySlot | null)[];
  readonly rngState: number;
  readonly score: number;
  /** Consecutive clearing turns so far. Feeds the combo multiplier. */
  readonly combo: number;
  readonly spins: number;
  readonly clearsTowardSpin: number;
  readonly over: boolean;
  readonly stats: Readonly<GameStats>;
  readonly moves: readonly Move[];
}

export interface MoveEvents {
  readonly kind: "place" | "spin";
  readonly placedCells: Cell[];
  readonly colour: number;
  readonly spin: { ring: number; dir: SpinDirection } | null;
  readonly clears: Clears;
  readonly clearedCells: Cell[];
  readonly scoreDelta: number;
  readonly combo: number;
  readonly spinsGained: number;
  readonly trayRefilled: boolean;
  readonly gameOver: boolean;
}

export interface MoveResult {
  readonly state: GameState;
  readonly events: MoveEvents;
}

function emptyStats(): GameStats {
  return {
    piecesPlaced: 0,
    cellsPlaced: 0,
    ringsCleared: 0,
    spokesCleared: 0,
    spinsUsed: 0,
    bestCombo: 0,
    bestClear: 0,
  };
}

/** Draws a full tray. Called at the start and whenever all three are used up. */
function fillTray(rngState: number): [tray: TraySlot[], next: number] {
  const tray: TraySlot[] = [];
  let state = rngState;
  for (let i = 0; i < RULES.traySize; i++) {
    const [piece, afterPiece] = drawPiece(state);
    const [colourIndex, afterColour] = nextInt(afterPiece, RULES.colours);
    tray.push({ pieceId: piece.id, colour: colourIndex + 1 });
    state = afterColour;
  }
  return [tray, state];
}

export function createGame(options: {
  seed: number;
  mode?: GameMode;
  spec?: BoardSpec;
}): GameState {
  const spec = options.spec ?? DEFAULT_SPEC;
  const [tray, rngState] = fillTray(options.seed);

  return {
    mode: options.mode ?? "endless",
    spec,
    board: createBoard(spec),
    tray,
    rngState,
    score: 0,
    combo: 0,
    spins: RULES.startingSpins,
    clearsTowardSpin: 0,
    over: false,
    stats: emptyStats(),
    moves: [],
  };
}

export function slotPiece(slot: TraySlot | null): Piece | null {
  return slot ? pieceById(slot.pieceId) : null;
}

/**
 * Game over is deliberately generous: it is not enough that nothing fits, you
 * must also be out of spins. That is what turns spins into lives and makes a
 * doomed board survivable — if you can see the rescue.
 */
export function isGameOver(board: Board, tray: readonly (TraySlot | null)[], spins: number): boolean {
  if (spins > 0) return false;
  for (const slot of tray) {
    const piece = slotPiece(slot);
    if (piece && hasPlacement(board, piece)) return false;
  }
  return true;
}

/** Where the given tray slot can legally go right now. */
export function canPlaceSlot(state: GameState, slot: number, r: number, s: number): boolean {
  const piece = slotPiece(state.tray[slot] ?? null);
  return piece ? canPlace(state.board, piece, r, s) : false;
}

function grantSpins(current: number, progress: number, linesCleared: number): [spins: number, progress: number, gained: number] {
  if (current >= RULES.maxSpins) return [current, progress, 0];

  let spins = current;
  let acc = progress + linesCleared;
  let gained = 0;

  while (acc >= RULES.clearsPerSpin && spins < RULES.maxSpins) {
    acc -= RULES.clearsPerSpin;
    spins++;
    gained++;
  }
  // Banking progress while capped would hand out a free spin the instant one
  // is spent, so hold it just below the threshold instead.
  if (spins >= RULES.maxSpins) acc = Math.min(acc, RULES.clearsPerSpin - 1);

  return [spins, acc, gained];
}

/** Returns null when the move is illegal, so replays can be validated. */
export function applyMove(state: GameState, move: Move): MoveResult | null {
  if (state.over) return null;
  return move.type === "place" ? applyPlace(state, move) : applySpin(state, move);
}

function applyPlace(
  state: GameState,
  move: Extract<Move, { type: "place" }>,
): MoveResult | null {
  const slot = state.tray[move.slot] ?? null;
  const piece = slotPiece(slot);
  if (!piece || !slot) return null;
  if (!canPlace(state.board, piece, move.r, move.s)) return null;

  const placedCells = pieceCells(state.board, piece, move.r, move.s);
  let board = place(state.board, piece, move.r, move.s, slot.colour);

  const clears = findClears(board);
  const cleared = applyClears(board, clears);
  board = cleared.board;

  const didClear = hasClears(clears);
  const gained = clearScore(clears, state.combo, false);
  const scoreDelta = placementScore(piece.size) + gained;
  const combo = didClear ? state.combo + 1 : 0;
  const lineCount = clears.rings.length + clears.spokes.length;

  const [spins, clearsTowardSpin, spinsGained] = didClear
    ? grantSpins(state.spins, state.clearsTowardSpin, lineCount)
    : [state.spins, state.clearsTowardSpin, 0];

  // The tray only refills once all three slots are spent — that is what makes
  // the third piece a genuine planning problem rather than an afterthought.
  const tray: (TraySlot | null)[] = [...state.tray];
  tray[move.slot] = null;
  const trayRefilled = tray.every((s) => s === null);
  let rngState = state.rngState;
  let nextTray: (TraySlot | null)[] = tray;
  if (trayRefilled) {
    const [filled, afterFill] = fillTray(rngState);
    nextTray = filled;
    rngState = afterFill;
  }

  const stats: GameStats = {
    ...state.stats,
    piecesPlaced: state.stats.piecesPlaced + 1,
    cellsPlaced: state.stats.cellsPlaced + piece.size,
    ringsCleared: state.stats.ringsCleared + clears.rings.length,
    spokesCleared: state.stats.spokesCleared + clears.spokes.length,
    bestCombo: Math.max(state.stats.bestCombo, combo),
    bestClear: Math.max(state.stats.bestClear, gained),
  };

  const over = isGameOver(board, nextTray, spins);

  return {
    state: {
      ...state,
      board,
      tray: nextTray,
      rngState,
      score: state.score + scoreDelta,
      combo,
      spins,
      clearsTowardSpin,
      over,
      stats,
      moves: [...state.moves, move],
    },
    events: {
      kind: "place",
      placedCells,
      colour: slot.colour,
      spin: null,
      clears,
      clearedCells: cleared.cells,
      scoreDelta,
      combo,
      spinsGained,
      trayRefilled,
      gameOver: over,
    },
  };
}

function applySpin(state: GameState, move: Extract<Move, { type: "spin" }>): MoveResult | null {
  if (state.spins <= 0) return null;
  if (move.ring < 0 || move.ring >= state.spec.rings) return null;

  let board = spinRing(state.board, move.ring, move.dir);

  const clears = findClears(board);
  const cleared = applyClears(board, clears);
  board = cleared.board;

  const didClear = hasClears(clears);
  const gained = clearScore(clears, state.combo, true);
  const combo = didClear ? state.combo + 1 : state.combo;
  const lineCount = clears.rings.length + clears.spokes.length;

  const spentSpins = state.spins - 1;
  const [spins, clearsTowardSpin, spinsGained] = didClear
    ? grantSpins(spentSpins, state.clearsTowardSpin, lineCount)
    : [spentSpins, state.clearsTowardSpin, 0];

  const stats: GameStats = {
    ...state.stats,
    ringsCleared: state.stats.ringsCleared + clears.rings.length,
    spokesCleared: state.stats.spokesCleared + clears.spokes.length,
    spinsUsed: state.stats.spinsUsed + 1,
    bestCombo: Math.max(state.stats.bestCombo, combo),
    bestClear: Math.max(state.stats.bestClear, gained),
  };

  const over = isGameOver(board, state.tray, spins);

  return {
    state: {
      ...state,
      board,
      score: state.score + gained,
      combo,
      spins,
      clearsTowardSpin,
      over,
      stats,
      moves: [...state.moves, move],
    },
    events: {
      kind: "spin",
      placedCells: [],
      colour: 0,
      spin: { ring: move.ring, dir: move.dir },
      clears,
      clearedCells: cleared.cells,
      scoreDelta: gained,
      combo,
      spinsGained,
      trayRefilled: false,
      gameOver: over,
    },
  };
}

/** Re-runs a move log from a seed. Used to verify a claimed score. */
export function replay(
  seed: number,
  moves: readonly Move[],
  options: { mode?: GameMode; spec?: BoardSpec } = {},
): GameState | null {
  let state = createGame({ seed, ...options });
  for (const move of moves) {
    const result = applyMove(state, move);
    if (!result) return null;
    state = result.state;
  }
  return state;
}
