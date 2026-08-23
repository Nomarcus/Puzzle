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
import { type PackId, DEFAULT_PACK, bagFor } from "./variants.js";
import { nextInt } from "./rng.js";
import { type SpinDirection, spinRing } from "./rotate.js";
import { clearScore, placementScore } from "./scoring.js";

export const RULES = {
  traySize: 3,
  /** Number of distinct block colours. Must match the palette in the theme. */
  colours: 8,
} as const;

/**
 * The knobs the balance tool turns. They live on the state rather than in a
 * module constant so tools/economy.ts can sweep them, and so a mode can run
 * different numbers without a second copy of the engine.
 */
export interface RuleSet {
  readonly startingSpins: number;
  readonly maxSpins: number;
  /** Lines you must clear to earn one spin back. */
  readonly clearsPerSpin: number;
  /**
   * Which clears pay for spins. "rings" makes the rare, hard clear the only
   * source of lives, which is what stops spins from becoming unlimited.
   */
  readonly spinSource: "any" | "rings";
  /** Ends the round after this many pieces. 0 means play until stuck. */
  readonly pieceLimit: number;
}

export const DEFAULT_RULES: RuleSet = {
  startingSpins: 1,
  maxSpins: 3,
  // One ring, one spin. Rings are rare and spokes are constant, so paying for
  // spokes would hand out unlimited escapes and nothing would ever be at stake.
  clearsPerSpin: 1,
  spinSource: "rings",
  pieceLimit: 0,
};

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
  readonly pack: PackId;
  /** Whether a full spoke pops as well as a full ring. */
  readonly spokeClears: boolean;
  readonly rules: RuleSet;
  /** Whether the deal avoids handing out pieces with nowhere to go. */
  readonly fairDeal: boolean;
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

/** Draws three pieces blind. */
function drawTray(rngState: number, spec: BoardSpec, pack: PackId): [tray: TraySlot[], next: number] {
  const bag = bagFor(spec.rings, pack);
  const tray: TraySlot[] = [];
  let state = rngState;
  for (let i = 0; i < RULES.traySize; i++) {
    const [piece, afterPiece] = drawPiece(bag, state);
    const [colourIndex, afterColour] = nextInt(afterPiece, RULES.colours);
    tray.push({ pieceId: piece.id, colour: colourIndex + 1 });
    state = afterColour;
  }
  return [tray, state];
}

/**
 * Deals a tray, preferring one where every piece has somewhere to go.
 *
 * This is what stops a round ending on a coin flip. Blind dealing can hand you
 * three shapes that fit nowhere, and losing to the deal rather than to your own
 * play is the complaint this whole game exists to answer.
 *
 * It is deliberately not used for the daily. The deal depends on the board, so
 * two players who played differently would be handed different pieces, and the
 * daily's entire claim — the same puzzle for everyone — would be false. The
 * daily protects itself the other way, by vetting its seed up front.
 */
function dealTray(
  rngState: number,
  spec: BoardSpec,
  pack: PackId,
  board: Board,
  fairDeal: boolean,
): [tray: TraySlot[], next: number] {
  if (!fairDeal) return drawTray(rngState, spec, pack);

  let state = rngState;
  let bestTray: TraySlot[] | null = null;
  let bestNext = rngState;
  let bestLive = -1;

  for (let attempt = 0; attempt < 10; attempt++) {
    const [tray, next] = drawTray(state, spec, pack);
    let live = 0;
    for (const slot of tray) {
      if (hasPlacement(board, pieceById(slot.pieceId))) live++;
    }

    if (live > bestLive) {
      bestLive = live;
      bestTray = tray;
      bestNext = next;
    }
    // Every piece playable is the best we can ask for; stop looking.
    if (live === RULES.traySize) break;
    state = next;
  }

  return [bestTray!, bestNext];
}

export function createGame(options: {
  seed: number;
  mode?: GameMode;
  spec?: BoardSpec;
  pack?: PackId;
  spokeClears?: boolean;
  rules?: Partial<RuleSet>;
  fairDeal?: boolean;
}): GameState {
  const spec = options.spec ?? DEFAULT_SPEC;
  const pack = options.pack ?? DEFAULT_PACK;
  const spokeClears = options.spokeClears ?? true;
  const rules: RuleSet = { ...DEFAULT_RULES, ...options.rules };
  const mode = options.mode ?? "endless";
  // The daily must deal the same pieces to everyone, so it never adapts.
  const fairDeal = options.fairDeal ?? mode !== "daily";
  const board = createBoard(spec);
  const [tray, rngState] = dealTray(options.seed, spec, pack, board, fairDeal);

  return {
    mode,
    spec,
    pack,
    spokeClears,
    rules,
    fairDeal,
    board,
    tray,
    rngState,
    score: 0,
    combo: 0,
    spins: rules.startingSpins,
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

function grantSpins(
  rules: RuleSet,
  current: number,
  progress: number,
  clears: Clears,
): [spins: number, progress: number, gained: number] {
  // Counting only rings is what keeps spins scarce: spokes are cheap and
  // constant, so paying spins for them hands the player unlimited escapes and
  // the round never ends.
  const earned =
    rules.spinSource === "rings" ? clears.rings.length : clears.rings.length + clears.spokes.length;
  if (earned === 0 || current >= rules.maxSpins) return [current, progress, 0];

  let spins = current;
  let acc = progress + earned;
  let gained = 0;

  while (acc >= rules.clearsPerSpin && spins < rules.maxSpins) {
    acc -= rules.clearsPerSpin;
    spins++;
    gained++;
  }
  // Banking progress while capped would hand out a free spin the instant one
  // is spent, so hold it just below the threshold instead.
  if (spins >= rules.maxSpins) acc = Math.min(acc, rules.clearsPerSpin - 1);

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

  const clears = findClears(board, state.spokeClears);
  const cleared = applyClears(board, clears);
  board = cleared.board;

  const didClear = hasClears(clears);
  const gained = clearScore(clears, state.combo, false);
  const scoreDelta = placementScore(piece.size) + gained;
  const combo = didClear ? state.combo + 1 : 0;
  const [spins, clearsTowardSpin, spinsGained] = didClear
    ? grantSpins(state.rules, state.spins, state.clearsTowardSpin, clears)
    : [state.spins, state.clearsTowardSpin, 0];

  // The tray only refills once all three slots are spent — that is what makes
  // the third piece a genuine planning problem rather than an afterthought.
  const tray: (TraySlot | null)[] = [...state.tray];
  tray[move.slot] = null;
  const trayRefilled = tray.every((s) => s === null);
  let rngState = state.rngState;
  let nextTray: (TraySlot | null)[] = tray;
  if (trayRefilled) {
    const [filled, afterFill] = dealTray(rngState, state.spec, state.pack, board, state.fairDeal);
    nextTray = filled;
    rngState = afterFill;
  }

  const piecesPlaced = state.stats.piecesPlaced + 1;
  const outOfPieces = state.rules.pieceLimit > 0 && piecesPlaced >= state.rules.pieceLimit;
  const over = outOfPieces || isGameOver(board, nextTray, spins);

  const stats: GameStats = {
    ...state.stats,
    piecesPlaced,
    cellsPlaced: state.stats.cellsPlaced + piece.size,
    ringsCleared: state.stats.ringsCleared + clears.rings.length,
    spokesCleared: state.stats.spokesCleared + clears.spokes.length,
    bestCombo: Math.max(state.stats.bestCombo, combo),
    bestClear: Math.max(state.stats.bestClear, gained),
  };


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

  const clears = findClears(board, state.spokeClears);
  const cleared = applyClears(board, clears);
  board = cleared.board;

  const didClear = hasClears(clears);
  const gained = clearScore(clears, state.combo, true);
  const combo = didClear ? state.combo + 1 : state.combo;

  const spentSpins = state.spins - 1;
  const [spins, clearsTowardSpin, spinsGained] = didClear
    ? grantSpins(state.rules, spentSpins, state.clearsTowardSpin, clears)
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
  options: {
    mode?: GameMode;
    spec?: BoardSpec;
    pack?: PackId;
    spokeClears?: boolean;
    rules?: Partial<RuleSet>;
    fairDeal?: boolean;
  } = {},
): GameState | null {
  let state = createGame({ seed, ...options });
  for (const move of moves) {
    const result = applyMove(state, move);
    if (!result) return null;
    state = result.state;
  }
  return state;
}
