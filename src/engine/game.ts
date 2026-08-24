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
  type ClearedCell,
  applyClears,
  canPlace,
  createBoard,
  detonate,
  findClears,
  hasClears,
  hasPlacement,
  isBullseye,
  pieceCells,
  place,
  pureLines,
} from "./board.js";
import { type Bag, type Piece, drawPiece, pieceById } from "./pieces.js";
import { type PackId, DEFAULT_PACK, bagFor, bagFrom } from "./variants.js";
import {
  type RampSpec,
  NO_RAMP,
  depthAt,
  dropStone,
  rampedRules,
  rampedWeights,
  stoneDue,
} from "./ramp.js";
import { nextInt, nextRandom } from "./rng.js";
import { type SpinDirection, pushSpoke, spinRing } from "./rotate.js";
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
  /** Chance that a dealt piece carries a striped block. */
  readonly stripeChance: number;
  /**
   * Pushes shift a spoke instead of a ring. They are the rare power: only a
   * line cleared in a single colour, or a bullseye, pays for one.
   */
  readonly maxPushes: number;
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
  // Roughly one striped block every four trays: often enough to plan around,
  // rare enough that landing one still feels like an event.
  stripeChance: 0.07,
  maxPushes: 2,
  pieceLimit: 0,
};

export type GameMode = "daily" | "endless" | "level" | "challenge";

export interface TraySlot {
  readonly pieceId: string;
  readonly colour: number;
  /**
   * Index into the piece's cells: that one goes down striped. Undefined for
   * an ordinary piece, which is nearly all of them.
   */
  readonly striped?: number;
}

export type Move =
  | { readonly type: "place"; readonly slot: number; readonly r: number; readonly s: number }
  | { readonly type: "spin"; readonly ring: number; readonly dir: SpinDirection }
  | { readonly type: "push"; readonly sector: number; readonly dir: SpinDirection };

export interface GameStats {
  piecesPlaced: number;
  cellsPlaced: number;
  ringsCleared: number;
  spokesCleared: number;
  spinsUsed: number;
  pushesUsed: number;
  stripesFired: number;
  pureClears: number;
  bullseyes: number;
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
  /**
   * How the round gets harder as it goes on. NO_RAMP for the daily and for
   * levels, both of which must stay the same puzzle for everybody.
   */
  readonly ramp: RampSpec;
  /** Whether the deal avoids handing out pieces with nowhere to go. */
  readonly fairDeal: boolean;
  readonly board: Board;
  readonly tray: readonly (TraySlot | null)[];
  readonly rngState: number;
  readonly score: number;
  /** Consecutive clearing turns so far. Feeds the combo multiplier. */
  readonly combo: number;
  readonly spins: number;
  readonly pushes: number;
  readonly clearsTowardSpin: number;
  readonly over: boolean;
  readonly stats: Readonly<GameStats>;
  readonly moves: readonly Move[];
}

export interface MoveEvents {
  readonly kind: "place" | "spin" | "push";
  readonly placedCells: Cell[];
  readonly colour: number;
  readonly spin: { ring: number; dir: SpinDirection } | null;
  readonly clears: Clears;
  /** What went, and what colour it was. The renderer bursts exactly these. */
  readonly clearedCells: ClearedCell[];
  readonly scoreDelta: number;
  readonly combo: number;
  readonly spinsGained: number;
  readonly pushesGained: number;
  /** Striped blocks that went off, and whether they took the whole disc. */
  readonly stripesFired: number;
  readonly sweep: boolean;
  /** Cleared lines that were a single colour. Worth shouting about. */
  readonly pureClears: number;
  readonly bullseye: boolean;
  readonly trayRefilled: boolean;
  readonly gameOver: boolean;
  /** Where the ramp just dropped a fresh stone, if it did. */
  readonly stoneDropped: Cell | null;
  /** Set on the move that takes the round one depth deeper. */
  readonly depthReached: number | null;
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
    pushesUsed: 0,
    stripesFired: 0,
    pureClears: 0,
    bullseyes: 0,
    bestCombo: 0,
    bestClear: 0,
  };
}

/**
 * The bag to deal from right now. Off the ramp this is the pack's own bag,
 * built once and cached; on it the weights have been bent toward the heavy
 * pieces by however deep the round has got.
 */
function bagAt(spec: BoardSpec, pack: PackId, ramp: RampSpec, depth: number): Bag {
  if (depth === 0) return bagFor(spec.rings, pack);
  return bagFrom(spec.rings, rampedWeights(pack, ramp, depth));
}

/** Draws three pieces blind. */
function drawTray(
  rngState: number,
  bag: Bag,
  stripeChance: number,
): [tray: TraySlot[], next: number] {
  const tray: TraySlot[] = [];
  let state = rngState;

  for (let i = 0; i < RULES.traySize; i++) {
    const [piece, afterPiece] = drawPiece(bag, state);
    const [colourIndex, afterColour] = nextInt(afterPiece, RULES.colours);
    // Drawn from the same stream whether or not it lands, so the sequence
    // stays identical for every player on a given seed.
    const [roll, afterRoll] = nextRandom(afterColour);
    const [where, afterWhere] = nextInt(afterRoll, piece.size);

    tray.push(
      roll < stripeChance
        ? { pieceId: piece.id, colour: colourIndex + 1, striped: where }
        : { pieceId: piece.id, colour: colourIndex + 1 },
    );
    state = afterWhere;
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
  bag: Bag,
  board: Board,
  fairDeal: boolean,
  stripeChance: number,
): [tray: TraySlot[], next: number] {
  if (!fairDeal) return drawTray(rngState, bag, stripeChance);

  let state = rngState;
  let bestTray: TraySlot[] | null = null;
  let bestNext = rngState;
  let bestLive = -1;

  for (let attempt = 0; attempt < 10; attempt++) {
    const [tray, next] = drawTray(state, bag, stripeChance);
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
  /**
   * A board to start from rather than an empty disc. Levels use it: arriving
   * mid-thought is most of what makes one a puzzle instead of free play with a
   * target on it.
   */
  board?: Board;
  ramp?: RampSpec;
}): GameState {
  const spec = options.spec ?? DEFAULT_SPEC;
  const pack = options.pack ?? DEFAULT_PACK;
  const spokeClears = options.spokeClears ?? true;
  const rules: RuleSet = { ...DEFAULT_RULES, ...options.rules };
  const mode = options.mode ?? "endless";
  // Never on by default. The daily and the levels are the same puzzle for
  // everybody, and a ramp would make two players' boards diverge.
  const ramp = options.ramp ?? NO_RAMP;
  // The daily must deal the same pieces to everyone, so it never adapts.
  // A level deals from a fixed sequence for the same reason the daily does:
  // it is the same puzzle for everybody, so the deal must not adapt to how
  // somebody happens to be playing it.
  const fairDeal = options.fairDeal ?? (mode === "endless");
  const board = options.board ?? createBoard(spec);
  const [tray, rngState] = dealTray(
    options.seed,
    bagAt(spec, pack, ramp, 0),
    board,
    fairDeal,
    rules.stripeChance,
  );

  return {
    mode,
    spec,
    pack,
    spokeClears,
    rules,
    ramp,
    fairDeal,
    board,
    tray,
    rngState,
    score: 0,
    combo: 0,
    spins: rules.startingSpins,
    pushes: 0,
    clearsTowardSpin: 0,
    over: false,
    stats: emptyStats(),
    moves: [],
  };
}

/**
 * Deals a fresh tray onto a round already in progress, keeping the board and
 * the score. A safety net rather than a normal path: the tray refills itself
 * whenever the last slot is spent, so nothing should ever need this.
 */
export function dealFreshTray(state: GameState): GameState {
  const [tray, rngState] = dealTray(
    state.rngState,
    bagAt(state.spec, state.pack, state.ramp, depthAt(state.ramp, state.stats.piecesPlaced)),
    state.board,
    state.fairDeal,
    state.rules.stripeChance,
  );
  return { ...state, tray, rngState };
}

/** How deep the round has got. 0 unless free play's ramp is running. */
export function depthOf(state: GameState): number {
  return depthAt(state.ramp, state.stats.piecesPlaced);
}

/**
 * The rules as they stand at this depth, which is what the game actually runs
 * on. `state.rules` is the round's starting contract; the ramp bends it.
 */
export function rulesNow(state: GameState): RuleSet {
  return rampedRules(state.rules, state.ramp, depthOf(state));
}

export function slotPiece(slot: TraySlot | null): Piece | null {
  return slot ? pieceById(slot.pieceId) : null;
}

/**
 * Game over is deliberately generous: it is not enough that nothing fits, you
 * must also be out of spins. That is what turns spins into lives and makes a
 * doomed board survivable — if you can see the rescue.
 */
export function isGameOver(
  board: Board,
  tray: readonly (TraySlot | null)[],
  spins: number,
  pushes = 0,
): boolean {
  if (spins > 0 || pushes > 0) return false;
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
/**
 * Pushes come only from a single-colour line or a bullseye, so they stay rare
 * enough to feel like a prize rather than a second currency to manage.
 */
function grantPushes(rules: RuleSet, current: number, pure: number, bullseye: boolean): [pushes: number, gained: number] {
  const earned = pure + (bullseye ? 1 : 0);
  if (earned === 0) return [current, 0];
  const pushes = Math.min(rules.maxPushes, current + earned);
  return [pushes, pushes - current];
}

interface Resolution {
  readonly board: Board;
  readonly clears: Clears;
  readonly clearedCells: ClearedCell[];
  readonly pure: number;
  readonly bullseye: boolean;
  readonly stripes: number;
  readonly sweep: boolean;
}

/**
 * Settles a board after a move: finds the lines, fires any striped blocks
 * caught in them, and sweeps the disc if the move earned it.
 *
 * Purity and the bullseye are read from the lines the player actually
 * completed, before stripes widen them. A stripe should pay for what it
 * detonates, not quietly claim credit for a bullseye nobody set up.
 */
function resolve(board: Board, spokeClears: boolean): Resolution {
  const base = findClears(board, spokeClears);
  const pure = pureLines(board, base);
  const bullseye = isBullseye(base);

  const fired = detonate(board, base);
  const sweep = bullseye || fired.sweep;
  const cleared = applyClears(board, fired.clears, sweep);

  return {
    board: cleared.board,
    clears: fired.clears,
    clearedCells: cleared.cells,
    pure,
    bullseye,
    stripes: fired.stripes,
    sweep,
  };
}

export function applyMove(state: GameState, move: Move): MoveResult | null {
  if (state.over) return null;
  if (move.type === "place") return applyPlace(state, move);
  if (move.type === "spin") return applySpin(state, move);
  return applyPush(state, move);
}

function applyPlace(
  state: GameState,
  move: Extract<Move, { type: "place" }>,
): MoveResult | null {
  const slot = state.tray[move.slot] ?? null;
  const piece = slotPiece(slot);
  if (!piece || !slot) return null;
  if (!canPlace(state.board, piece, move.r, move.s)) return null;

  const rules = rulesNow(state);
  const placedCells = pieceCells(state.board, piece, move.r, move.s);
  let board = place(state.board, piece, move.r, move.s, slot.colour, slot.striped);

  const settled = resolve(board, state.spokeClears);
  const { clears, pure, bullseye, stripes, sweep } = settled;
  board = settled.board;

  const didClear = hasClears(clears);
  const gained = clearScore(clears, state.combo, false, pure, sweep);
  const scoreDelta = placementScore(piece.size) + gained;
  const combo = didClear ? state.combo + 1 : 0;
  const [spins, clearsTowardSpin, spinsGained] = didClear
    ? grantSpins(rules, state.spins, state.clearsTowardSpin, clears)
    : [state.spins, state.clearsTowardSpin, 0];
  const [pushes, pushesGained] = grantPushes(rules, state.pushes, pure, sweep);

  const piecesPlaced = state.stats.piecesPlaced + 1;
  let rngState = state.rngState;

  // The rim crusts over. Dropped after the clears have settled, so a move that
  // opened the board up is not immediately punished on the cell it just freed,
  // and before the tray is dealt, so a fair deal can see the stone is there.
  let stoneDropped: Cell | null = null;
  if (stoneDue(state.ramp, piecesPlaced)) {
    const drop = dropStone(board, rngState);
    if (drop) {
      board = drop.board;
      stoneDropped = drop.cell;
      rngState = drop.rngState;
    }
  }

  // The tray only refills once all three slots are spent — that is what makes
  // the third piece a genuine planning problem rather than an afterthought.
  const tray: (TraySlot | null)[] = [...state.tray];
  tray[move.slot] = null;
  const trayRefilled = tray.every((s) => s === null);
  let nextTray: (TraySlot | null)[] = tray;
  const depth = depthAt(state.ramp, piecesPlaced);
  if (trayRefilled) {
    const [filled, afterFill] = dealTray(
      rngState,
      bagAt(state.spec, state.pack, state.ramp, depth),
      board,
      state.fairDeal,
      rules.stripeChance,
    );
    nextTray = filled;
    rngState = afterFill;
  }

  const outOfPieces = rules.pieceLimit > 0 && piecesPlaced >= rules.pieceLimit;
  const over = outOfPieces || isGameOver(board, nextTray, spins, pushes);

  const stats: GameStats = {
    ...state.stats,
    piecesPlaced,
    cellsPlaced: state.stats.cellsPlaced + piece.size,
    ringsCleared: state.stats.ringsCleared + clears.rings.length,
    spokesCleared: state.stats.spokesCleared + clears.spokes.length,
    pureClears: state.stats.pureClears + pure,
    bullseyes: state.stats.bullseyes + (bullseye ? 1 : 0),
    stripesFired: state.stats.stripesFired + stripes,
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
      pushes,
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
      clearedCells: settled.clearedCells,
      scoreDelta,
      combo,
      spinsGained,
      pushesGained,
      pureClears: pure,
      bullseye,
      stripesFired: stripes,
      sweep,
      trayRefilled,
      gameOver: over,
      stoneDropped,
      depthReached: depth > depthAt(state.ramp, state.stats.piecesPlaced) ? depth : null,
    },
  };
}

function applySpin(state: GameState, move: Extract<Move, { type: "spin" }>): MoveResult | null {
  if (state.spins <= 0) return null;
  if (move.ring < 0 || move.ring >= state.spec.rings) return null;

  let board = spinRing(state.board, move.ring, move.dir);

  const settled = resolve(board, state.spokeClears);
  const { clears, pure, bullseye, stripes, sweep } = settled;
  board = settled.board;

  const didClear = hasClears(clears);
  const gained = clearScore(clears, state.combo, true, pure, sweep);
  const combo = didClear ? state.combo + 1 : state.combo;

  const rules = rulesNow(state);
  const spentSpins = state.spins - 1;
  const [spins, clearsTowardSpin, spinsGained] = didClear
    ? grantSpins(rules, spentSpins, state.clearsTowardSpin, clears)
    : [spentSpins, state.clearsTowardSpin, 0];
  const [pushes, pushesGained] = grantPushes(rules, state.pushes, pure, sweep);

  const stats: GameStats = {
    ...state.stats,
    ringsCleared: state.stats.ringsCleared + clears.rings.length,
    spokesCleared: state.stats.spokesCleared + clears.spokes.length,
    pureClears: state.stats.pureClears + pure,
    bullseyes: state.stats.bullseyes + (bullseye ? 1 : 0),
    stripesFired: state.stats.stripesFired + stripes,
    spinsUsed: state.stats.spinsUsed + 1,
    bestCombo: Math.max(state.stats.bestCombo, combo),
    bestClear: Math.max(state.stats.bestClear, gained),
  };

  const over = isGameOver(board, state.tray, spins, pushes);

  return {
    state: {
      ...state,
      board,
      score: state.score + gained,
      combo,
      spins,
      pushes,
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
      clearedCells: settled.clearedCells,
      scoreDelta: gained,
      combo,
      spinsGained,
      pushesGained,
      pureClears: pure,
      bullseye,
      stripesFired: stripes,
      sweep,
      trayRefilled: false,
      gameOver: over,
      stoneDropped: null,
      depthReached: null,
    },
  };
}

/**
 * The sibling of a spin, along the other axis: shove one spoke a ring in or
 * out. Costs a push, which only a single-colour clear or a bullseye pays for.
 */
function applyPush(state: GameState, move: Extract<Move, { type: "push" }>): MoveResult | null {
  if (state.pushes <= 0) return null;
  if (move.sector < 0 || move.sector >= state.spec.sectors) return null;

  let board = pushSpoke(state.board, move.sector, move.dir);

  const settled = resolve(board, state.spokeClears);
  const { clears, pure, bullseye, stripes, sweep } = settled;
  board = settled.board;

  const didClear = hasClears(clears);
  const gained = clearScore(clears, state.combo, true, pure, sweep);
  const combo = didClear ? state.combo + 1 : state.combo;

  const rules = rulesNow(state);
  const [spins, clearsTowardSpin, spinsGained] = didClear
    ? grantSpins(rules, state.spins, state.clearsTowardSpin, clears)
    : [state.spins, state.clearsTowardSpin, 0];
  const [pushes, pushesGained] = grantPushes(rules, state.pushes - 1, pure, sweep);

  const stats: GameStats = {
    ...state.stats,
    ringsCleared: state.stats.ringsCleared + clears.rings.length,
    spokesCleared: state.stats.spokesCleared + clears.spokes.length,
    pureClears: state.stats.pureClears + pure,
    bullseyes: state.stats.bullseyes + (bullseye ? 1 : 0),
    stripesFired: state.stats.stripesFired + stripes,
    pushesUsed: state.stats.pushesUsed + 1,
    bestCombo: Math.max(state.stats.bestCombo, combo),
    bestClear: Math.max(state.stats.bestClear, gained),
  };

  const over = isGameOver(board, state.tray, spins, pushes);

  return {
    state: {
      ...state,
      board,
      score: state.score + gained,
      combo,
      spins,
      pushes,
      clearsTowardSpin,
      over,
      stats,
      moves: [...state.moves, move],
    },
    events: {
      kind: "push",
      placedCells: [],
      colour: 0,
      spin: null,
      clears,
      clearedCells: settled.clearedCells,
      scoreDelta: gained,
      combo,
      spinsGained,
      pushesGained,
      pureClears: pure,
      bullseye,
      stripesFired: stripes,
      sweep,
      trayRefilled: false,
      gameOver: over,
      stoneDropped: null,
      depthReached: null,
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
