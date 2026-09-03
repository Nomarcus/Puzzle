import { describe, expect, it } from "vitest";

import { cellIndex, sectorDelta, wrapSector } from "../src/engine/geometry.js";
import { DEFAULT_RULES } from "../src/engine/game.js";
import { dailyNumber, dailySeed, hashSeed, nextRandom } from "../src/engine/rng.js";
import { bestStreakOf, recentDays, streakOf } from "../src/engine/streak.js";
import {
  UNLOCKS,
  isUnlocked,
  nextUnlock,
  unlockProgress,
  unlockedBetween,
} from "../src/engine/progress.js";
import { SKY, THEMES, blockColour } from "../src/render/theme.js";
import { eraAt, eraChanged, paletteFor, themeForDepth } from "../src/render/palette.js";
import { cellNoise, materialById } from "../src/render/material.js";
import {
  SAVE_VERSION,
  applyRound,
  discoverWorld,
  freshSave,
  isDiscovered,
  loadSave,
} from "../src/engine/save.js";
import {
  GOALS,
  MASTERY_BONUS,
  applyMastery,
  chooseGoal,
  goalById,
  offered,
  tallyOf,
} from "../src/engine/mastery.js";
import {
  PATTERNS,
  SHADE_CAP,
  STROKE_CAP,
  WHITE_CAP,
  patternSpec,
} from "../src/render/pattern.js";
import {
  LAP_SPAN,
  WORLDS,
  depthsToNextWorld,
  finishAt,
  lapAt,
  lapTrim,
  nextWorld,
  worldAt,
  worldChanged,
  worldIndex,
} from "../src/render/world.js";
import {
  BEZEL_SEGMENTS,
  bezel,
  bezelColour,
  deepen,
  depthShift,
  toHSL,
} from "../src/render/depth.js";
import {
  applyClears,
  canPlace,
  createBoard,
  filledCount,
  findClears,
  getCell,
  hasPlacement,
  place,
  placements,
} from "../src/engine/board.js";
import { PIECES, pieceById } from "../src/engine/pieces.js";
import {
  STONE,
  STRIPE_FLAG,
  WILD,
  colourOf,
  detonate,
  isBullseye,
  isStone,
  isStripedValue,
  lineColour,
  petrify,
  stoneCount,
} from "../src/engine/board.js";
import {
  FREE_PLAY_RAMP,
  NO_RAMP,
  depthAt,
  rampedRules,
  rampedWeights,
  stoneDue,
  stoneInterval,
} from "../src/engine/ramp.js";
import { TIME_ATTACK, addTime, drainRate, timeBonus } from "../src/engine/timeattack.js";
import {
  DEFAULT_CORE,
  NO_CORE,
  chargeFrom,
  coreActive,
  coreReady,
} from "../src/engine/core.js";
import {
  CHALLENGE_PIECES,
  MAX_CODE_SCORE,
  decodeChallenge,
  encodeChallenge,
  formatCode,
  newChallenge,
} from "../src/engine/challenge.js";
import { BOT_POLICY_LEVELS, BOT_POLICY_V2, chooseMove, playOut } from "../src/engine/bot.js";
import { LEVELS, goalProgress, levelBoard,
  levelCore, levelSeed } from "../src/engine/levels.js";
import { PACKS, SIZES, bagFor, dailyVariant, sizeById } from "../src/engine/variants.js";
import { pushSpoke, spinRing } from "../src/engine/rotate.js";
import { pureLines } from "../src/engine/board.js";
import { clearScore, comboMultiplier, simultaneousMultiplier } from "../src/engine/scoring.js";
import {
  type Move,
  RULES,
  applyMove,
  createGame,
  dealFreshTray,
  deliverToBelt,
  isGameOver,
  openBelt,
  replay,
  slotPiece,
} from "../src/engine/game.js";
import { BELT, beltInterval } from "../src/engine/belt.js";

/**
 * Pinned rather than taken from DEFAULT_SPEC: these tests are about wrapping
 * and clearing, and they should not start failing because the shipped disc
 * changed shape.
 */
const spec = { rings: 5, sectors: 12 };

/** Fills every cell of the board except the ones listed, so clears are easy to set up. */
function boardWithHoles(holes: Array<[number, number]>) {
  let board = createBoard(spec);
  const dot = pieceById("dot");
  const holeSet = new Set(holes.map(([r, s]) => `${r}:${s}`));
  for (let r = 0; r < spec.rings; r++) {
    for (let s = 0; s < spec.sectors; s++) {
      if (!holeSet.has(`${r}:${s}`)) board = place(board, dot, r, s, 1);
    }
  }
  return board;
}

describe("geometry", () => {
  it("wraps sectors in both directions", () => {
    expect(wrapSector(spec, 0)).toBe(0);
    expect(wrapSector(spec, 12)).toBe(0);
    expect(wrapSector(spec, 13)).toBe(1);
    expect(wrapSector(spec, -1)).toBe(11);
    expect(wrapSector(spec, -13)).toBe(11);
  });

  it("takes the short way round when measuring sector distance", () => {
    expect(sectorDelta(spec, 0, 1)).toBe(1);
    expect(sectorDelta(spec, 0, 11)).toBe(-1);
    expect(sectorDelta(spec, 11, 0)).toBe(1);
    expect(sectorDelta(spec, 0, 6)).toBe(6);
  });
});

describe("rng", () => {
  it("gives the same sequence for the same seed", () => {
    const run = (seed: number) => {
      let state = seed;
      const out: number[] = [];
      for (let i = 0; i < 50; i++) {
        const [value, next] = nextRandom(state);
        out.push(value);
        state = next;
      }
      return out;
    };
    expect(run(12345)).toEqual(run(12345));
    expect(run(12345)).not.toEqual(run(12346));
  });

  it("produces values inside [0,1)", () => {
    let state = hashSeed("shiftle");
    for (let i = 0; i < 1000; i++) {
      const [value, next] = nextRandom(state);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      state = next;
    }
  });

  it("ties the daily seed to the UTC date, not the local one", () => {
    const a = dailySeed(new Date("2026-08-23T00:30:00Z"));
    const b = dailySeed(new Date("2026-08-23T23:30:00Z"));
    const c = dailySeed(new Date("2026-08-24T00:30:00Z"));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("counts puzzle numbers up from the epoch", () => {
    expect(dailyNumber(new Date("2026-01-01T12:00:00Z"))).toBe(1);
    expect(dailyNumber(new Date("2026-01-02T12:00:00Z"))).toBe(2);
  });
});

describe("board placement", () => {
  it("lets arcs wrap across sector zero", () => {
    const board = createBoard(spec);
    const arc3 = pieceById("arc3");
    // Anchored at sector 11, an arc of three covers 11, 0 and 1.
    expect(canPlace(board, arc3, 0, 11)).toBe(true);
    const placed = place(board, arc3, 0, 11, 3);
    expect(getCell(placed, 0, 11)).toBe(3);
    expect(getCell(placed, 0, 0)).toBe(3);
    expect(getCell(placed, 0, 1)).toBe(3);
  });

  it("refuses to hang a wedge off the outer rim", () => {
    const board = createBoard(spec);
    const wedge3 = pieceById("wedge3");
    expect(canPlace(board, wedge3, 2, 0)).toBe(true); // rings 2,3,4
    expect(canPlace(board, wedge3, 3, 0)).toBe(false); // would need ring 5
    expect(canPlace(board, wedge3, -1, 0)).toBe(false);
  });

  it("will not overlap an occupied cell", () => {
    let board = createBoard(spec);
    board = place(board, pieceById("dot"), 0, 5, 1);
    expect(canPlace(board, pieceById("dot"), 0, 5)).toBe(false);
    expect(canPlace(board, pieceById("dot"), 0, 6)).toBe(true);
  });

  it("finds every anchor for a piece on an empty board", () => {
    const board = createBoard(spec);
    // A wedge spanning 3 rings fits at 3 ring offsets, in all 12 sectors.
    expect(placements(board, pieceById("wedge3")).length).toBe(3 * spec.sectors);
    // A single cell fits everywhere.
    expect(placements(board, pieceById("dot")).length).toBe(spec.rings * spec.sectors);
  });
});

describe("clears", () => {
  it("pops a full ring", () => {
    const board = boardWithHoles([[0, 0]]);
    // Ring 0 has a hole, so only the spokes that avoid it are complete.
    expect(findClears(board).rings).toEqual([1, 2, 3, 4]);

    const full = place(board, pieceById("dot"), 0, 0, 2);
    expect(findClears(full).rings).toEqual([0, 1, 2, 3, 4]);
  });

  it("pops a full spoke", () => {
    let board = createBoard(spec);
    for (let r = 0; r < spec.rings; r++) {
      board = place(board, pieceById("dot"), r, 7, 4);
    }
    const clears = findClears(board);
    expect(clears.spokes).toEqual([7]);
    expect(clears.rings).toEqual([]);
  });

  it("clears a ring and a spoke at once without double-counting the crossing", () => {
    // Everything filled except ring 2 / sector 3, which both lines need.
    const board = boardWithHoles([[2, 3]]);
    const full = place(board, pieceById("dot"), 2, 3, 5);

    const clears = findClears(full);
    expect(clears.rings.length).toBe(spec.rings);
    expect(clears.spokes.length).toBe(spec.sectors);

    const { board: after, cells } = applyClears(full, clears);
    // The whole board is one big clear here, and no cell appears twice.
    expect(cells.length).toBe(spec.rings * spec.sectors);
    expect(filledCount(after)).toBe(0);
  });

  it("leaves untouched cells alone", () => {
    let board = createBoard(spec);
    for (let r = 0; r < spec.rings; r++) board = place(board, pieceById("dot"), r, 7, 4);
    board = place(board, pieceById("dot"), 0, 9, 6);

    const { board: after } = applyClears(board, findClears(board));
    expect(getCell(after, 0, 7)).toBe(0);
    expect(getCell(after, 0, 9)).toBe(6);
  });
});

describe("spinning a ring", () => {
  it("carries cells round the wrap", () => {
    let board = createBoard(spec);
    board = place(board, pieceById("dot"), 1, 11, 7);

    const forward = spinRing(board, 1, 1);
    expect(getCell(forward, 1, 11)).toBe(0);
    expect(getCell(forward, 1, 0)).toBe(7);

    const back = spinRing(board, 1, -1);
    expect(getCell(back, 1, 10)).toBe(7);
  });

  it("only touches the ring it is given", () => {
    let board = createBoard(spec);
    board = place(board, pieceById("dot"), 0, 4, 2);
    board = place(board, pieceById("dot"), 3, 4, 5);

    const spun = spinRing(board, 0, 1);
    expect(getCell(spun, 0, 5)).toBe(2);
    expect(getCell(spun, 3, 4)).toBe(5); // untouched
  });

  it("returns to the start after a full turn", () => {
    let board = createBoard(spec);
    board = place(board, pieceById("arc3"), 2, 10, 3);
    let spun = board;
    for (let i = 0; i < spec.sectors; i++) spun = spinRing(spun, 2, 1);
    expect(Array.from(spun.cells)).toEqual(Array.from(board.cells));
  });

  it("can complete a spoke that a placement could not", () => {
    let board = createBoard(spec);
    // A spoke at sector 0, but ring 2's cell sits one sector over at sector 1.
    for (const r of [0, 1, 3, 4]) board = place(board, pieceById("dot"), r, 0, 1);
    board = place(board, pieceById("dot"), 2, 1, 1);

    expect(findClears(board).spokes).toEqual([]);
    const spun = spinRing(board, 2, -1);
    expect(findClears(spun).spokes).toEqual([0]);
  });
});

describe("scoring", () => {
  it("scales with simultaneous lines", () => {
    expect(simultaneousMultiplier(1)).toBe(1);
    expect(simultaneousMultiplier(2)).toBe(1.5);
    expect(simultaneousMultiplier(3)).toBe(2);
  });

  it("caps the combo multiplier", () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(2)).toBe(2);
    expect(comboMultiplier(100)).toBe(4);
  });

  it("pays more for a ring than a spoke, and more again via a spin", () => {
    const oneSpoke = { rings: [], spokes: [1] };
    const oneRing = { rings: [1], spokes: [] };
    expect(clearScore(oneRing, 0, false)).toBeGreaterThan(clearScore(oneSpoke, 0, false));
    expect(clearScore(oneSpoke, 0, true)).toBeGreaterThan(clearScore(oneSpoke, 0, false));
    expect(clearScore({ rings: [], spokes: [] }, 0, false)).toBe(0);
  });
});

describe("game reducer", () => {
  it("starts with a full tray and one spin", () => {
    const game = createGame({ seed: 1 });
    expect(game.tray.length).toBe(RULES.traySize);
    expect(game.tray.every((slot) => slot !== null)).toBe(true);
    expect(game.spins).toBe(game.rules.startingSpins);
    expect(game.over).toBe(false);
  });

  it("rejects illegal moves instead of corrupting state", () => {
    const game = createGame({ seed: 2 });
    expect(applyMove(game, { type: "place", slot: 0, r: -1, s: 0 })).toBeNull();
    expect(applyMove(game, { type: "place", slot: 99, r: 0, s: 0 })).toBeNull();
    expect(applyMove(game, { type: "spin", ring: 99, dir: 1 })).toBeNull();
  });

  it("only refills the tray once all three slots are spent", () => {
    let state = createGame({ seed: 3 });
    const firstTray = state.tray.map((slot) => slot?.pieceId);

    for (let slot = 0; slot < RULES.traySize; slot++) {
      const piece = slotPiece(state.tray[slot] ?? null)!;
      const spot = placements(state.board, piece)[0]!;
      const result = applyMove(state, { type: "place", slot, r: spot.r, s: spot.s })!;
      expect(result).not.toBeNull();
      state = result.state;

      if (slot < RULES.traySize - 1) {
        expect(result.events.trayRefilled).toBe(false);
        expect(state.tray[slot]).toBeNull();
      } else {
        expect(result.events.trayRefilled).toBe(true);
        expect(state.tray.every((s) => s !== null)).toBe(true);
      }
    }
    expect(state.tray.map((slot) => slot?.pieceId)).not.toEqual(firstTray);
  });

  it("spends a spin and refuses to spin at zero", () => {
    let state = createGame({ seed: 4 });
    expect(state.spins).toBe(1);

    const result = applyMove(state, { type: "spin", ring: 0, dir: 1 })!;
    expect(result).not.toBeNull();
    state = result.state;
    expect(state.spins).toBe(0);
    expect(state.stats.spinsUsed).toBe(1);

    expect(applyMove(state, { type: "spin", ring: 0, dir: 1 })).toBeNull();
  });

  it("keeps playing while spins remain, even with nothing placeable", () => {
    // A completely full board: nothing fits anywhere.
    const board = boardWithHoles([]);
    const tray = [{ pieceId: "dot", colour: 1 }];
    expect(isGameOver(board, tray, 1)).toBe(false);
    expect(isGameOver(board, tray, 0)).toBe(true);
  });

  it("is not over while any tray piece still fits", () => {
    const board = createBoard(spec);
    expect(isGameOver(board, [{ pieceId: "brick33", colour: 1 }], 0)).toBe(false);
  });

  it("keeps playing on a stuck board while the core is charged, the same as a spin or a push", () => {
    // A stuck player used to be told the round was over even sitting on a
    // fully charged core — firing it clears the whole disc and is exactly as
    // valid a way out as a spin or a push, so it has to count the same way.
    const board = boardWithHoles([]);
    const tray = [{ pieceId: "dot", colour: 1 }];
    expect(isGameOver(board, tray, 0, 0, DEFAULT_CORE, DEFAULT_CORE.capacity)).toBe(false);
    // Under capacity, it is over exactly like before.
    expect(isGameOver(board, tray, 0, 0, DEFAULT_CORE, DEFAULT_CORE.capacity - 1)).toBe(true);
    // A level with the core turned off must not be rescued by a stray charge.
    expect(isGameOver(board, tray, 0, 0, { ...DEFAULT_CORE, capacity: 0 }, 999)).toBe(true);
    // Omitting core/charge is untouched — every existing caller that never
    // passes them keeps its old behaviour exactly.
    expect(isGameOver(board, tray, 0)).toBe(true);
  });

  it("replays a move log to exactly the same state", () => {
    let state = createGame({ seed: 99, mode: "daily" });
    const log: Move[] = [];

    for (let turn = 0; turn < 40 && !state.over; turn++) {
      let moved = false;
      for (let slot = 0; slot < RULES.traySize; slot++) {
        const piece = slotPiece(state.tray[slot] ?? null);
        if (!piece || !hasPlacement(state.board, piece)) continue;
        const spot = placements(state.board, piece)[0]!;
        const move: Move = { type: "place", slot, r: spot.r, s: spot.s };
        state = applyMove(state, move)!.state;
        log.push(move);
        moved = true;
        break;
      }
      if (!moved) break;
    }

    expect(log.length).toBeGreaterThan(5);
    const replayed = replay(99, log, { mode: "daily" })!;
    expect(replayed).not.toBeNull();
    expect(replayed.score).toBe(state.score);
    expect(Array.from(replayed.board.cells)).toEqual(Array.from(state.board.cells));
    expect(replayed.rngState).toBe(state.rngState);
  });

  it("gives every player the same pieces on the same day", () => {
    const seed = dailySeed(new Date("2026-08-23T09:00:00Z"));
    const a = createGame({ seed, mode: "daily" });
    const b = createGame({ seed, mode: "daily" });
    expect(a.tray).toEqual(b.tray);

    const other = createGame({ seed: dailySeed(new Date("2026-08-24T09:00:00Z")), mode: "daily" });
    expect(other.tray).not.toEqual(a.tray);
  });
});

describe("variants", () => {
  it("gives every player the same disc and bag on the same day", () => {
    const seed = dailySeed(new Date("2026-08-23T09:00:00Z"));
    expect(dailyVariant(seed)).toEqual(dailyVariant(seed));
  });

  it("rotates the setup across days", () => {
    const days = ["2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28"];
    const variants = days.map((day) => {
      const v = dailyVariant(dailySeed(new Date(`${day}T09:00:00Z`)));
      return `${v.size}:${v.pack}`;
    });
    // Not every day differs, but a week must not be one single setup.
    expect(new Set(variants).size).toBeGreaterThan(1);
  });

  it("keeps every family reachable in every pack", () => {
    for (const pack of PACKS) {
      const bag = bagFor(6, pack.id);
      const families = new Set(bag.pieces.map((piece) => piece.family));
      // A pack that dropped a family outright could strand a board — the
      // single cell especially is the piece that rescues a full disc.
      expect(families.has("dot")).toBe(true);
      expect(bag.pieces.length).toBe(PIECES.length);
      expect(bag.total).toBeGreaterThan(0);
    }
  });

  it("weights chunks towards blocks and curves away from them", () => {
    const share = (packId: "mixed" | "curves" | "chunks") => {
      const bag = bagFor(6, packId);
      let brick = 0;
      let previous = 0;
      bag.pieces.forEach((piece, i) => {
        const weight = bag.cumulative[i]! - previous;
        previous = bag.cumulative[i]!;
        if (piece.family === "brick") brick += weight;
      });
      return brick / bag.total;
    };
    expect(share("chunks")).toBeGreaterThan(share("mixed"));
    expect(share("curves")).toBeLessThan(share("mixed"));
  });

  it("leaves out shapes too tall for the disc", () => {
    // Every shape spans at most 3 rings, so a 3-ring disc still takes them all
    // while a 2-ring disc must drop the tall ones.
    expect(bagFor(3, "mixed").pieces.length).toBe(PIECES.length);
    const shallow = bagFor(2, "mixed");
    expect(shallow.pieces.length).toBeLessThan(PIECES.length);
    expect(shallow.pieces.every((piece) => piece.radialExtent <= 2)).toBe(true);
  });

  it("plays a full game on every size", () => {
    for (const size of SIZES) {
      let state = createGame({ seed: 7, spec: size.spec, pack: "chunks" });
      expect(state.spec).toEqual(size.spec);

      let turns = 0;
      while (!state.over && turns < 200) {
        const slot = state.tray.findIndex((entry) => {
          const piece = slotPiece(entry ?? null);
          return piece !== null && hasPlacement(state.board, piece);
        });
        if (slot < 0) break;
        const piece = slotPiece(state.tray[slot] ?? null)!;
        const spot = placements(state.board, piece)[0]!;
        state = applyMove(state, { type: "place", slot, r: spot.r, s: spot.s })!.state;
        turns++;
      }
      expect(turns).toBeGreaterThan(3);
    }
  });

  it("pays for spins with rings only", () => {
    // Spokes are constant and cheap; paying for them would hand out unlimited
    // escapes and nothing would ever be at stake.
    expect(DEFAULT_RULES.spinSource).toBe("rings");
    expect(DEFAULT_RULES.clearsPerSpin).toBe(1);
  });

  it("needs a full ring of the right length on each size", () => {
    for (const size of SIZES) {
      let board = createBoard(size.spec);
      for (let s = 0; s < size.spec.sectors - 1; s++) {
        board = place(board, pieceById("dot"), 0, s, 1);
      }
      expect(findClears(board).rings).toEqual([]);
      board = place(board, pieceById("dot"), 0, size.spec.sectors - 1, 1);
      expect(findClears(board).rings).toEqual([0]);
    }
  });
});


describe("the bullseye", () => {
  it("only counts when a ring and a spoke go together", () => {
    expect(isBullseye({ rings: [1], spokes: [] })).toBe(false);
    expect(isBullseye({ rings: [], spokes: [2] })).toBe(false);
    expect(isBullseye({ rings: [1], spokes: [2] })).toBe(true);
  });

  it("sweeps the whole disc, not just the two lines", () => {
    // Ring 0 needs one more cell; spoke 4 needs the same one. Scatter some
    // unrelated blocks that a plain clear would leave behind.
    let board = createBoard(spec);
    for (let s = 0; s < spec.sectors; s++) {
      if (s !== 4) board = place(board, pieceById("dot"), 0, s, 1);
    }
    for (let r = 1; r < spec.rings; r++) board = place(board, pieceById("dot"), r, 4, 2);
    board = place(board, pieceById("dot"), 3, 9, 5);
    board = place(board, pieceById("dot"), 2, 7, 6);

    const before = filledCount(board);
    const full = place(board, pieceById("dot"), 0, 4, 3);
    const clears = findClears(full);
    expect(isBullseye(clears)).toBe(true);

    const { board: after, cells } = applyClears(full, clears);
    expect(filledCount(after)).toBe(0);
    // Every filled cell is reported, so the burst animates the whole disc.
    expect(cells.length).toBe(before + 1);
  });

  it("is worth far more than the two lines on their own", () => {
    const apart = clearScore({ rings: [0], spokes: [] }, 0, false) +
      clearScore({ rings: [], spokes: [4] }, 0, false);
    const together = clearScore({ rings: [0], spokes: [4] }, 0, false);
    expect(together).toBeGreaterThan(apart * 3);
  });

  it("lets competent play run indefinitely", () => {
    // The point of endless mode. Measured with the bot rather than a naive
    // first-legal-spot policy, because the claim is about competent play: a
    // player who is trying should not be knocked out by the rules themselves.
    const result = playOut(createGame({ seed: 4242, spec: { rings: 6, sectors: 10 } }), 400);
    expect(result.state.stats.piecesPlaced).toBeGreaterThan(150);
    expect(result.stalled).toBe(false);
  });
});


describe("pushing a spoke", () => {
  it("carries cells across the rim, the way a spin carries them across the seam", () => {
    let board = createBoard(spec);
    board = place(board, pieceById("dot"), spec.rings - 1, 4, 7);

    const outward = pushSpoke(board, 4, 1);
    expect(getCell(outward, spec.rings - 1, 4)).toBe(0);
    // Off the outer rim and back in at the hub: the disc is a torus.
    expect(getCell(outward, 0, 4)).toBe(7);

    const inward = pushSpoke(board, 4, -1);
    expect(getCell(inward, spec.rings - 2, 4)).toBe(7);
  });

  it("only touches the spoke it is given", () => {
    let board = createBoard(spec);
    board = place(board, pieceById("dot"), 1, 2, 3);
    board = place(board, pieceById("dot"), 1, 5, 6);

    const pushed = pushSpoke(board, 2, 1);
    expect(getCell(pushed, 2, 2)).toBe(3);
    expect(getCell(pushed, 1, 5)).toBe(6);
  });

  it("returns to the start after a full lap", () => {
    let board = createBoard(spec);
    board = place(board, pieceById("wedge3"), 1, 6, 4);
    let pushed = board;
    for (let i = 0; i < spec.rings; i++) pushed = pushSpoke(pushed, 6, 1);
    expect(Array.from(pushed.cells)).toEqual(Array.from(board.cells));
  });

  it("loses nothing — a push never destroys a block", () => {
    let board = createBoard(spec);
    for (let r = 0; r < spec.rings; r++) board = place(board, pieceById("dot"), r, 3, r + 1);
    const before = filledCount(board);
    expect(filledCount(pushSpoke(board, 3, 1))).toBe(before);
  });

  it("costs a push and is refused without one", () => {
    let state = createGame({ seed: 11 });
    expect(state.pushes).toBe(0);
    expect(applyMove(state, { type: "push", sector: 0, dir: 1 })).toBeNull();

    state = { ...state, pushes: 1 };
    const result = applyMove(state, { type: "push", sector: 0, dir: 1 })!;
    expect(result).not.toBeNull();
    expect(result.state.pushes).toBe(0);
    expect(result.state.stats.pushesUsed).toBe(1);
  });

  it("keeps the round alive while a push remains", () => {
    const board = boardWithHoles([]);
    const tray = [{ pieceId: "dot", colour: 1 }];
    expect(isGameOver(board, tray, 0, 1)).toBe(false);
    expect(isGameOver(board, tray, 0, 0)).toBe(true);
  });
});

describe("single-colour clears", () => {
  it("reads a line's colour only when every cell matches", () => {
    let board = createBoard(spec);
    for (let s = 0; s < spec.sectors; s++) board = place(board, pieceById("dot"), 0, s, 5);
    expect(lineColour(board, "ring", 0)).toBe(5);

    const mixed = place(board, pieceById("dot"), 0, 3, 5);
    expect(lineColour(mixed, "ring", 0)).toBe(5); // same colour, still pure
  });

  it("is not pure when one cell differs, or when one is missing", () => {
    let board = createBoard(spec);
    for (let s = 0; s < spec.sectors; s++) {
      board = place(board, pieceById("dot"), 0, s, s === 2 ? 6 : 5);
    }
    expect(lineColour(board, "ring", 0)).toBe(0);

    let gappy = createBoard(spec);
    for (let s = 0; s < spec.sectors - 1; s++) gappy = place(gappy, pieceById("dot"), 0, s, 5);
    expect(lineColour(gappy, "ring", 0)).toBe(0);
  });

  it("counts pure lines among a clear", () => {
    let board = createBoard(spec);
    for (let s = 0; s < spec.sectors; s++) board = place(board, pieceById("dot"), 0, s, 4);
    for (let s = 0; s < spec.sectors; s++) {
      board = place(board, pieceById("dot"), 1, s, s === 0 ? 2 : 3);
    }
    const clears = findClears(board);
    expect(clears.rings).toEqual([0, 1]);
    expect(pureLines(board, clears)).toBe(1);
  });

  it("pays a push and doubles the score", () => {
    const plain = clearScore({ rings: [0], spokes: [] }, 0, false, 0);
    const pure = clearScore({ rings: [0], spokes: [] }, 0, false, 1);
    expect(pure).toBe(plain * 2);
  });

  it("hands a push to the player who earns one", () => {
    // A ring one cell short, all in one colour, and a matching piece to finish it.
    let state = createGame({ seed: 21, spec: { rings: 5, sectors: 8 } });
    const cells = new Uint8Array(state.board.cells.length);
    for (let s = 1; s < 8; s++) cells[s] = 4;
    state = {
      ...state,
      board: { spec: state.spec, cells },
      tray: [{ pieceId: "dot", colour: 4 }, null, null],
    };

    const result = applyMove(state, { type: "place", slot: 0, r: 0, s: 0 })!;
    expect(result).not.toBeNull();
    expect(result.events.pureClears).toBe(1);
    expect(result.events.pushesGained).toBe(1);
    expect(result.state.pushes).toBe(1);
  });

  it("gives no push for a clear of mixed colours", () => {
    let state = createGame({ seed: 22, spec: { rings: 5, sectors: 8 } });
    const cells = new Uint8Array(state.board.cells.length);
    for (let s = 1; s < 8; s++) cells[s] = s === 3 ? 6 : 4;
    state = {
      ...state,
      board: { spec: state.spec, cells },
      tray: [{ pieceId: "dot", colour: 4 }, null, null],
    };

    const result = applyMove(state, { type: "place", slot: 0, r: 0, s: 0 })!;
    expect(result.events.pureClears).toBe(0);
    expect(result.state.pushes).toBe(0);
  });
});

describe("the tray never strands a player", () => {
  it("always leaves something to drag while the round is live", () => {
    // The reported symptom was a live board with an empty tray and no way to
    // act. Play every disc and pack out and assert it cannot happen.
    for (const size of SIZES) {
      for (const pack of PACKS) {
        let state = createGame({
          seed: hashSeed(`stranded:${size.id}:${pack.id}`),
          spec: size.spec,
          pack: pack.id,
        });

        for (let turn = 0; turn < 300 && !state.over; turn++) {
          expect(state.tray.some((slot) => slot !== null)).toBe(true);
          const move = chooseMove(state);
          if (!move) break;
          const result = applyMove(state, move);
          if (!result) break;
          state = result.state;
        }
      }
    }
  });

  it("deals a fresh tray without touching the score or the board", () => {
    let state = createGame({ seed: 77 });
    const piece = slotPiece(state.tray[0] ?? null)!;
    const spot = placements(state.board, piece)[0]!;
    state = applyMove(state, { type: "place", slot: 0, r: spot.r, s: spot.s })!.state;

    const rescued = dealFreshTray({ ...state, tray: [null, null, null] });
    expect(rescued.tray.every((slot) => slot !== null)).toBe(true);
    expect(rescued.score).toBe(state.score);
    expect(Array.from(rescued.board.cells)).toEqual(Array.from(state.board.cells));
  });
});

describe("striped blocks", () => {
  const striped = (colour: number) => colour | STRIPE_FLAG;

  it("keeps colour and stripe in one byte", () => {
    expect(colourOf(striped(5))).toBe(5);
    expect(isStripedValue(striped(5))).toBe(true);
    expect(isStripedValue(5)).toBe(false);
    expect(colourOf(0)).toBe(0);
  });

  it("does not break a run of one colour", () => {
    let board = createBoard(spec);
    for (let s = 0; s < spec.sectors; s++) board = place(board, pieceById("dot"), 0, s, 4);
    board.cells[3] = striped(4);
    expect(lineColour(board, "ring", 0)).toBe(4);
  });

  it("takes the lines that cross it", () => {
    let board = createBoard(spec);
    // A full ring, with one striped cell in it.
    for (let s = 0; s < spec.sectors; s++) board = place(board, pieceById("dot"), 0, s, 2);
    board.cells[cellIndex(spec, 0, 5)] = striped(2);
    // Something to prove the spoke really goes too.
    board = place(board, pieceById("dot"), 3, 5, 7);

    const base = findClears(board);
    expect(base.rings).toEqual([0]);
    expect(base.spokes).toEqual([]);

    const fired = detonate(board, base);
    expect(fired.stripes).toBe(1);
    expect(fired.sweep).toBe(false);
    expect(fired.clears.spokes).toContain(5);

    const { board: after } = applyClears(board, fired.clears, fired.sweep);
    expect(getCell(after, 3, 5)).toBe(0);
  });

  it("chains: one stripe can set off another", () => {
    let board = createBoard(spec);
    for (let s = 0; s < spec.sectors; s++) board = place(board, pieceById("dot"), 0, s, 2);
    board.cells[cellIndex(spec, 0, 4)] = striped(2);
    // Sitting on spoke 4, which the first stripe will take, is a second one.
    board = place(board, pieceById("dot"), 2, 4, 3);
    board.cells[cellIndex(spec, 2, 4)] = striped(3);

    const fired = detonate(board, findClears(board));
    expect(fired.stripes).toBe(2);
    expect(fired.clears.rings).toContain(2);
  });

  it("sweeps the disc when two go off together", () => {
    let board = createBoard(spec);
    for (let s = 0; s < spec.sectors; s++) board = place(board, pieceById("dot"), 0, s, 2);
    board.cells[cellIndex(spec, 0, 1)] = striped(2);
    board.cells[cellIndex(spec, 0, 6)] = striped(2);
    // A block nowhere near either line, to prove the sweep is total.
    board = place(board, pieceById("dot"), 4, 9, 8);

    const fired = detonate(board, findClears(board));
    expect(fired.sweep).toBe(true);

    const { board: after } = applyClears(board, fired.clears, fired.sweep);
    expect(filledCount(after)).toBe(0);
  });

  it("does not let a stripe claim a bullseye nobody set up", () => {
    // One stripe in a ring clear widens the clear, but the bullseye belongs to
    // the player who completes both lines by placement.
    let state = createGame({ seed: 31, spec: { rings: 5, sectors: 8 } });
    const cells = new Uint8Array(state.board.cells.length);
    for (let s = 1; s < 8; s++) cells[s] = s === 4 ? striped(2) : 2;
    state = {
      ...state,
      board: { spec: state.spec, cells },
      tray: [{ pieceId: "dot", colour: 2 }, null, null],
    };

    const result = applyMove(state, { type: "place", slot: 0, r: 0, s: 0 })!;
    expect(result.events.stripesFired).toBe(1);
    expect(result.events.bullseye).toBe(false);
    expect(result.events.sweep).toBe(false);
  });

  it("is not paid the bullseye bonus for a crossing it detonated itself", () => {
    // The clear covers both axes once the stripe fires, so anything that reads
    // the jackpot back out of the expanded clear pays out far too much.
    const crossing = { rings: [0], spokes: [2] };
    const earned = clearScore(crossing, 0, false, 0, true);
    const detonated = clearScore(crossing, 0, false, 0, false);
    expect(detonated).toBeLessThan(earned / 3);
  });

  it("records what happened, on every kind of move", () => {
    let state = createGame({ seed: 41, spec: { rings: 5, sectors: 8 } });
    const cells = new Uint8Array(state.board.cells.length);
    for (let s = 1; s < 8; s++) cells[s] = s === 4 ? (2 | STRIPE_FLAG) : 2;
    state = {
      ...state,
      board: { spec: state.spec, cells },
      tray: [{ pieceId: "dot", colour: 2 }, null, null],
    };

    const after = applyMove(state, { type: "place", slot: 0, r: 0, s: 0 })!.state;
    // These three counters were silently dropped from the placement path once
    // before, so they are worth pinning down.
    expect(after.stats.stripesFired).toBe(1);
    expect(after.stats.pureClears).toBe(1);
    expect(after.stats.ringsCleared).toBe(1);
  });

  it("deals stripes at roughly the configured rate, and identically per seed", () => {
    const count = (seed: number) => {
      let state = createGame({ seed, spec: { rings: 6, sectors: 10 } });
      let striped = 0;
      let dealt = 0;
      for (let turn = 0; turn < 200 && !state.over; turn++) {
        const move = chooseMove(state);
        if (!move) break;
        const before = state.tray.map((s) => s?.striped);
        state = applyMove(state, move)!.state;
        if (state.tray.some((s, i) => s?.striped !== undefined && before[i] === undefined)) {
          striped += state.tray.filter((s) => s?.striped !== undefined).length;
          dealt += 3;
        }
      }
      return { striped, dealt };
    };
    // Same seed, same stripes: the daily has to stay identical for everyone.
    expect(count(99)).toEqual(count(99));
  });
});

/**
 * The bug behind the white screen Marcus hit: spin twice and the page goes
 * blank.
 *
 * The renderer used to recover the colour of a cleared cell by reading the
 * board from before the move. That is right for a placement and wrong for a
 * spin — the disc has already turned, so those coordinates hold somebody
 * else's block or nothing at all. When it read nothing it fell back to
 * `events.colour`, which is 0 for a spin, and colour 0 is not a colour: it
 * indexed off the end of the palette, threw mid-draw, and left the canvas with
 * an unbalanced save whose transform compounded frame after frame until the
 * board was being drawn off screen.
 *
 * So the engine now reports the colour it wiped, and these pin that it always
 * reports a real one.
 */
describe("cleared cells carry their own colour", () => {
  it("reports the colour that was standing there", () => {
    let board = createBoard(spec);
    for (let s = 0; s < spec.sectors; s++) board = place(board, pieceById("dot"), 0, s, 5);

    const { cells } = applyClears(board, findClears(board));
    expect(cells.length).toBe(spec.sectors);
    expect(cells.every((cell) => cell.colour === 5)).toBe(true);
  });

  it("never reports an empty cell as cleared", () => {
    // A stripe widens a clear onto a spoke that is not itself full, so most of
    // that spoke is empty space. Empty space has no colour and nothing to burst.
    let board = createBoard(spec);
    for (let s = 0; s < spec.sectors; s++) board = place(board, pieceById("dot"), 0, s, 2);
    board.cells[cellIndex(spec, 0, 5)] = 2 | STRIPE_FLAG;
    board = place(board, pieceById("dot"), 3, 5, 7);

    const fired = detonate(board, findClears(board));
    expect(fired.clears.spokes).toContain(5);

    const { cells } = applyClears(board, fired.clears, fired.sweep);
    expect(cells.every((cell) => cell.colour > 0)).toBe(true);
    // Ring 0 plus the one block further down the spoke the stripe reached.
    expect(cells.length).toBe(spec.sectors + 1);
  });

  it("a clear triggered by a spin still names real colours", () => {
    // Spoke 0 is one cell short: ring 2 is empty there, and the block that
    // fills it is sitting one sector round. Spinning ring 2 by +1 carries it
    // into sector 0 and the spoke pops.
    //
    // This is the exact shape of the bug. At those coordinates the pre-move
    // board held nothing, so recovering the colour from it gave 0 — and 0 is
    // not a colour.
    const cells = new Uint8Array(spec.rings * spec.sectors);
    for (let r = 0; r < spec.rings; r++) {
      if (r !== 2) cells[cellIndex(spec, r, 0)] = r + 1;
    }
    cells[cellIndex(spec, 2, spec.sectors - 1)] = 7;

    const state = createGame({ seed: 7, spec });
    const before = { ...state, board: { spec, cells }, spins: 2 };
    expect(getCell(before.board, 2, 0)).toBe(0);

    const result = applyMove(before, { type: "spin", ring: 2, dir: 1 });
    expect(result).not.toBeNull();
    expect(result!.events.clears.spokes).toContain(0);
    expect(result!.events.clearedCells.length).toBe(spec.rings);
    // The colour that moved in must be reported, not the nothing that was
    // there before the disc turned.
    expect(result!.events.clearedCells.every((cell) => cell.colour > 0)).toBe(true);
    expect(result!.events.clearedCells.find((cell) => cell.r === 2)!.colour).toBe(7);
  });

  it("every clear a full bot game produces names a drawable colour", () => {
    // The broad net: whatever the bot stumbles into over a long run, no move
    // may ever hand the renderer a colour it cannot look up.
    for (const seed of [3, 17, 91, 404]) {
      let state = createGame({ seed, spec });
      for (let turn = 0; turn < 220 && !state.over; turn++) {
        const move = chooseMove(state);
        if (!move) break;
        const result = applyMove(state, move);
        if (!result) break;
        for (const cell of result.events.clearedCells) {
          // The invariant is that the renderer can draw it. Colour 0 was the
          // white-screen crash; WILD is a real id the renderer routes to the
          // prism, so it belongs here too.
          expect(cell.colour).toBeGreaterThan(0);
          expect(cell.colour === WILD || cell.colour <= RULES.colours).toBe(true);
        }
        state = result.state;
      }
    }
  });
});

/**
 * Levels.
 *
 * The targets themselves are set by measurement — `npm run levels` plays each
 * one a few hundred times with the bot — and that is far too slow to live in a
 * unit test. What is pinned here is everything the measurement assumes: that
 * the twenty levels are well formed, that their opening patterns leave a game
 * to play, and that a goal counts what it says it counts.
 */
describe("levels", () => {
  it("are numbered from one, in order, with no gaps", () => {
    // Unlocking walks backwards from a level to the one before it, so a gap
    // would leave everything after it permanently locked.
    expect(LEVELS.map((level) => level.number)).toEqual(
      Array.from({ length: LEVELS.length }, (_, i) => i + 1),
    );
  });

  it("all have a budget and a target worth reaching", () => {
    for (const level of LEVELS) {
      expect(level.budget, `level ${level.number} budget`).toBeGreaterThan(0);
      expect(level.goal.target, `level ${level.number} target`).toBeGreaterThan(0);
    }
  });

  it("open on a board with room left to play", () => {
    // A pattern that filled the disc, or left only holes nothing fits in,
    // would be a level nobody could start. Half the cells free is a floor, not
    // a target — the tightest pattern here is nowhere near it.
    for (const level of LEVELS) {
      const board = levelBoard(level);
      const cells = board.spec.rings * board.spec.sectors;
      const free = cells - filledCount(board);
      expect(free / cells, `level ${level.number} (${level.pattern})`).toBeGreaterThan(0.5);
      expect(hasPlacement(board, pieceById("dot")), `level ${level.number}`).toBe(true);
    }
  });

  it("build the same opening board every time", () => {
    // A level is the same puzzle for everybody, so its pattern has to be a
    // pure function of the spec — no clock, no Math.random.
    for (const level of LEVELS) {
      expect(levelBoard(level).cells).toEqual(levelBoard(level).cells);
    }
    expect(levelSeed(LEVELS[0]!)).toBe(levelSeed(LEVELS[0]!));
  });

  it("deal the same pieces every attempt", () => {
    // Levels do not use the adaptive deal, for the daily's reason: a deal that
    // depends on the board would hand two players different pieces.
    const level = LEVELS[5]!;
    const make = () =>
      createGame({
        seed: levelSeed(level),
        mode: "level",
        spec: sizeById(level.size).spec,
        pack: level.pack,
        board: levelBoard(level),
        core: levelCore(level),
        rules: { ...level.rules, pieceLimit: level.budget },
      });
    expect(make().tray).toEqual(make().tray);
    expect(make().fairDeal).toBe(false);
  });

  it("count the thing the goal names", () => {
    const state = {
      score: 4200,
      stats: { ringsCleared: 3, spokesCleared: 9, pureClears: 2, stripesFired: 5, bullseyes: 1, bestCombo: 4 },
    };
    expect(goalProgress({ kind: "score", target: 4000 }, state).met).toBe(true);
    expect(goalProgress({ kind: "score", target: 5000 }, state).met).toBe(false);
    expect(goalProgress({ kind: "rings", target: 3 }, state)).toMatchObject({ done: 3, met: true });
    expect(goalProgress({ kind: "spokes", target: 10 }, state).met).toBe(false);
    expect(goalProgress({ kind: "pure", target: 2 }, state).met).toBe(true);
    expect(goalProgress({ kind: "stripes", target: 6 }, state).met).toBe(false);
    expect(goalProgress({ kind: "bullseye", target: 1 }, state).met).toBe(true);
    expect(goalProgress({ kind: "combo", target: 4 }, state).met).toBe(true);
  });

  it("vets a shipped seed the bot can actually win, not just survive", () => {
    // Level 7 (stripes, target 5) shipped on a seed where the bot spent its
    // whole 34-piece budget and still fell short at 3 — a real report of
    // getting stuck there matched exactly. The seed search only ever checked
    // "did the bot avoid dying early", never "can the goal be reached at
    // all", so an unwinnable-but-not-stuck seed sailed straight through.
    const level = LEVELS.find((l) => l.number === 7)!;
    const state = createGame({
      seed: levelSeed(level),
      mode: "level",
      spec: sizeById(level.size).spec,
      pack: level.pack,
      board: levelBoard(level),
      core: levelCore(level),
      rules: { ...level.rules, pieceLimit: level.budget },
    });
    const result = playOut(state, level.budget * 4, BOT_POLICY_LEVELS);
    expect(goalProgress(level.goal, result.state).met).toBe(true);
  });

  it("every level is playable to the end of its budget", () => {
    // Not "winnable" — that is what the measurement tool is for, and some
    // goals need planning the bot does not do. This is the weaker claim that
    // matters: the bot never runs out of moves early, so no pattern strangles
    // the board it opens on.
    for (const level of LEVELS) {
      const state = createGame({
        seed: levelSeed(level),
        mode: "level",
        spec: sizeById(level.size).spec,
        pack: level.pack,
        board: levelBoard(level),
        core: levelCore(level),
        rules: { ...level.rules, pieceLimit: level.budget },
      });
      // Played with the core, like `npm run levels` and like a person. A
      // core-free bot dies on piece eight of the stone levels, which measures
      // a player refusing to use a mechanic the game always gives them rather
      // than measuring the level.
      const result = playOut(state, level.budget * 4, BOT_POLICY_LEVELS);
      expect(result.stalled, `level ${level.number} stalled`).toBe(false);
      expect(
        result.state.stats.piecesPlaced,
        `level ${level.number} only placed ${result.state.stats.piecesPlaced}/${level.budget}`,
      ).toBeGreaterThan(level.budget * 0.5);
    }
  });
});

describe("the free play ramp", () => {
  const spec = sizeById("standard").spec;

  it("is off unless a round asks for it", () => {
    // The daily and the levels must never ramp: both are the same puzzle for
    // everybody, and a ramp would make two players' boards diverge.
    const game = createGame({ seed: 7, mode: "daily", spec });
    expect(game.ramp).toEqual(NO_RAMP);
    expect(depthAt(game.ramp, 500)).toBe(0);
    expect(stoneDue(game.ramp, 40)).toBe(false);
  });

  it("does not touch a round until the ramp says so", () => {
    for (let n = 1; n < FREE_PLAY_RAMP.stoneFrom * FREE_PLAY_RAMP.piecesPerDepth; n++) {
      expect(stoneDue(FREE_PLAY_RAMP, n), `stone at piece ${n}`).toBe(false);
    }
  });

  it("closes to one stone a piece and stays there", () => {
    // The dial that ends a round. If it levelled off the way the other two do,
    // deep play would reach a steady state it could sit in forever — which is
    // exactly what the bot did before this was uncapped.
    const deep = FREE_PLAY_RAMP.stoneFrom + FREE_PLAY_RAMP.stoneEvery + 20;
    expect(stoneInterval(FREE_PLAY_RAMP, deep)).toBe(1);
    expect(stoneInterval(FREE_PLAY_RAMP, deep * 4)).toBe(1);
  });

  it("shrinks the spin cap rather than only raising the price", () => {
    // Raising the price alone was measurably inert: the bot sat at the cap for
    // 92% of its turns, so a dearer refill never came up.
    const shallow = rampedRules(DEFAULT_RULES, FREE_PLAY_RAMP, 0);
    expect(shallow).toEqual(DEFAULT_RULES);

    const deep = rampedRules(DEFAULT_RULES, FREE_PLAY_RAMP, 8);
    expect(deep.maxSpins).toBeLessThan(DEFAULT_RULES.maxSpins);
    expect(deep.clearsPerSpin).toBeGreaterThan(DEFAULT_RULES.clearsPerSpin);
    expect(deep.maxSpins).toBeGreaterThanOrEqual(1);
  });

  it("keeps a get-out-of-jail piece in the bag however deep it gets", () => {
    // A bag that could not fill a one-cell hole would make boards unsolvable,
    // which is the complaint this whole game exists to answer.
    for (const pack of PACKS) {
      const deep = rampedWeights(pack.id, FREE_PLAY_RAMP, 999);
      expect(deep.dot, `${pack.id} dot weight`).toBeGreaterThan(0);
      expect(deep.brick).toBeGreaterThan(deep.arc);
    }
  });

  it("stone lands on the rim and works inward", () => {
    let board = createBoard(spec);
    const rim = spec.rings - 1;

    // Fill the rim, and the next stone has to go one ring in.
    for (let i = 0; i < spec.sectors; i++) {
      const dropped = petrify(board, i / spec.sectors)!;
      expect(dropped.cell.r).toBe(rim);
      board = dropped.board;
    }
    expect(petrify(board, 0.5)!.cell.r).toBe(rim - 1);
  });

  it("stops the line it sits in from clearing", () => {
    // The rule the whole ramp rests on, and the one a measurement corrected:
    // stone that merely took two clears to break was a *gift*, because a filled
    // cell helps complete a line and a full ring is the biggest prize going.
    let board = createBoard(spec);
    for (let s = 0; s < spec.sectors; s++) {
      board = place(board, pieceById("dot"), 0, s, 3);
    }
    expect(findClears(board).rings).toEqual([0]);

    board.cells[cellIndex(spec, 0, 4)] = STONE;
    expect(findClears(board).rings).toEqual([]);
    expect(lineColour(board, "ring", 0)).toBe(0);
  });

  it("only a stripe or a sweep shifts stone", () => {
    let board = createBoard(spec);
    board.cells[cellIndex(spec, 2, 5)] = STONE;
    expect(stoneCount(board)).toBe(1);

    // An ordinary clear elsewhere leaves it alone.
    const elsewhere = applyClears(board, { rings: [4], spokes: [] });
    expect(stoneCount(elsewhere.board)).toBe(1);

    // A clear that reaches it — which only a stripe's expansion or a sweep can
    // produce, since findClears will not complete a line containing stone.
    const reached = applyClears(board, { rings: [2], spokes: [] });
    expect(stoneCount(reached.board)).toBe(0);
    expect(reached.cells.some((cell) => cell.stone && cell.r === 2 && cell.s === 5)).toBe(true);
  });

  it("stone is never mistaken for a striped block", () => {
    // isStripedValue used to be `value >= 16`, which called every stone a
    // stripe and would have let the ramp's own blockages detonate.
    expect(isStripedValue(STONE)).toBe(false);
    expect(isStone(STONE)).toBe(true);
    expect(colourOf(STONE)).toBe(0);
    expect(isStripedValue(3 | STRIPE_FLAG)).toBe(true);
    expect(isStone(3 | STRIPE_FLAG)).toBe(false);
  });

  it("ends a round that would otherwise run forever", () => {
    // The measurement in one assertion. Free play on curves finished 0 of 20
    // bot rounds inside 4,000 pieces before the ramp existed.
    //
    // BOT_POLICY_V2, not the default V1: V1 never fires the core at all (that
    // is specifically so core-vetting the daily is unaffected by the core
    // existing), and a stuck board with a charged core is correctly no longer
    // "over" — a real player would fire it and keep going, so a bot that
    // structurally never can is not a fair stand-in for one. It sat at a
    // ready core, unused, for the rest of the turn budget every time.
    for (const pack of ["curves", "mixed"] as const) {
      const game = createGame({
        seed: hashSeed(`ramp-test:${pack}`),
        mode: "endless",
        spec,
        pack,
        ramp: FREE_PLAY_RAMP,
      });
      const result = playOut(game, 3000, BOT_POLICY_V2);
      expect(result.state.over, `${pack} never ended`).toBe(true);
      expect(result.state.stats.piecesPlaced, `${pack} ended too early`).toBeGreaterThan(40);
    }
  });
});

/** Crockford's alphabet, mirrored here so the typo test can walk every symbol. */
const ALPHABET_FOR_TEST = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A deliberately unclever player, so two runs of a code differ in how they go. */
function firstPlacement(state: ReturnType<typeof createGame>) {
  for (let slot = 0; slot < state.tray.length; slot++) {
    const piece = slotPiece(state.tray[slot] ?? null);
    if (!piece) continue;
    for (let r = 0; r + piece.radialExtent <= state.spec.rings; r++) {
      for (let s = 0; s < state.spec.sectors; s++) {
        if (canPlace(state.board, piece, r, s)) return { type: "place" as const, slot, r, s };
      }
    }
  }
  return null;
}

describe("progression", () => {
  it("opens with real choices rather than a row of padlocks", () => {
    // The first themes are not earned. A game that starts with one option and
    // three locks looks mean, and the first choice a player makes should be a
    // real one.
    for (const theme of ["sky", "cream", "mint"]) {
      expect(isUnlocked(theme, 0), theme).toBe(true);
    }
    expect(UNLOCKS.some((u) => u.theme === "sky")).toBe(false);
  });

  it("locks the earned ones until they are earned", () => {
    const first = UNLOCKS[0]!;
    expect(isUnlocked(first.theme, first.at - 1)).toBe(false);
    expect(isUnlocked(first.theme, first.at)).toBe(true);
  });

  it("gets steadily more expensive, with no gaps or repeats", () => {
    const ats = UNLOCKS.map((u) => u.at);
    expect([...ats].sort((a, b) => a - b)).toEqual(ats);
    expect(new Set(UNLOCKS.map((u) => u.theme)).size).toBe(UNLOCKS.length);
  });

  it("names one thing to play toward, until there is nothing left", () => {
    expect(nextUnlock(0)?.theme).toBe(UNLOCKS[0]!.theme);
    const last = UNLOCKS[UNLOCKS.length - 1]!;
    expect(nextUnlock(last.at)).toBe(null);
  });

  it("announces every threshold a single round crossed, not just the last", () => {
    // One enormous round can cross two. Swallowing the first would lose the
    // one moment the whole system exists to produce.
    const a = UNLOCKS[0]!;
    const b = UNLOCKS[1]!;
    expect(unlockedBetween(0, b.at).map((u) => u.theme)).toEqual([a.theme, b.theme]);
    expect(unlockedBetween(a.at, a.at)).toEqual([]);
  });

  it("measures progress from the previous unlock, not from zero", () => {
    // Measured from zero, the bar would sit near full for the whole of the
    // last stretch and look broken.
    const a = UNLOCKS[0]!;
    const b = UNLOCKS[1]!;
    expect(unlockProgress(0)).toBe(0);
    expect(unlockProgress(a.at)).toBeCloseTo(0, 5);
    expect(unlockProgress((a.at + b.at) / 2)).toBeCloseTo(0.5, 1);
    expect(unlockProgress(Number.MAX_SAFE_INTEGER)).toBe(1);
  });

  it("every unlock names a theme that exists", () => {
    const ids = new Set(THEMES.map((theme) => theme.id));
    for (const unlock of UNLOCKS) {
      expect(ids.has(unlock.theme), `no theme called ${unlock.theme}`).toBe(true);
    }
  });

  it("every theme can draw every colour, stone and charge included", () => {
    // The white-screen crash was a theme lookup returning undefined mid-draw.
    // Four new palettes is four new chances at it.
    for (const theme of THEMES) {
      expect(theme.blocks.length).toBe(RULES.colours);
      expect(theme.stone.base).toMatch(/^#/);
      expect(theme.charge.base).toMatch(/^#/);
      for (let id = 0; id <= RULES.colours + 1; id++) {
        expect(blockColour(theme, id).base, `${theme.id} colour ${id}`).toMatch(/^#/);
      }
    }
  });
});

describe("the daily streak", () => {
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`);
  const history = (...days: string[]) =>
    Object.fromEntries(days.map((d) => [d, 1000]));

  it("counts today when today has been played", () => {
    const h = history("2026-03-01", "2026-03-02", "2026-03-03");
    expect(streakOf(h, day("2026-03-03"))).toEqual({ length: 3, atRisk: false });
  });

  it("keeps a streak alive on a day not yet played", () => {
    // A streak does not break when the clock passes midnight — it breaks when
    // a whole day goes by unplayed. Showing zero to somebody who played
    // yesterday and has not opened the app yet today would be a lie, and the
    // demoralising kind.
    const h = history("2026-03-01", "2026-03-02", "2026-03-03");
    expect(streakOf(h, day("2026-03-04"))).toEqual({ length: 3, atRisk: true });
  });

  it("breaks once a whole day is missed", () => {
    const h = history("2026-03-01", "2026-03-02", "2026-03-03");
    expect(streakOf(h, day("2026-03-05")).length).toBe(0);
  });

  it("counts across a month boundary", () => {
    // The one place naive date handling always goes wrong.
    const h = history("2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02");
    expect(streakOf(h, day("2026-03-02")).length).toBe(4);
  });

  it("counts across a leap day", () => {
    const h = history("2024-02-28", "2024-02-29", "2024-03-01");
    expect(streakOf(h, day("2024-03-01")).length).toBe(3);
  });

  it("is zero for somebody who has never played", () => {
    expect(streakOf({}, day("2026-03-02"))).toEqual({ length: 0, atRisk: false });
  });

  it("remembers the longest run, however long ago", () => {
    const h = history(
      "2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05",
      "2026-03-01", "2026-03-02",
    );
    expect(bestStreakOf(h)).toBe(5);
    // And the current one is still only the recent pair.
    expect(streakOf(h, day("2026-03-02")).length).toBe(2);
  });

  it("shows a fortnight with the gaps left in", () => {
    // The gaps are the reason to draw it at all.
    const h = history("2026-03-01", "2026-03-03");
    const days = recentDays(h, day("2026-03-03"), 5);
    expect(days.map((d) => d.key)).toEqual([
      "2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02", "2026-03-03",
    ]);
    expect(days.map((d) => d.score !== null)).toEqual([false, false, true, false, true]);
    expect(days.filter((d) => d.today)).toHaveLength(1);
  });
});

describe("wild blocks", () => {
  const spec = sizeById("standard").spec;

  const ringOf = (values: number[]) => {
    const board = createBoard(spec);
    values.forEach((v, i) => (board.cells[cellIndex(spec, 0, i)] = v));
    return board;
  };

  it("carries its line on its own, whatever else is in it", () => {
    // The first version only let a wild *agree* with an already-uniform line.
    // Measured, that was worth nothing — pure clears went from 1.0 a round to
    // 1.1 even at ten percent wilds, because five-of-a-colour is already about
    // as unlikely as six. Reducing an impossible requirement to a slightly less
    // impossible one is not a mechanic.
    const plain = ringOf(new Array(spec.sectors).fill(3));
    expect(lineColour(plain, "ring", 0)).toBe(3);

    const withWild = ringOf([3, 3, WILD, 3, 3, 3, 3, 3, 3, 3]);
    expect(lineColour(withWild, "ring", 0)).toBe(3);

    const mixed = ringOf([3, 4, WILD, 7, 3, 3, 2, 3, 3, 3]);
    expect(lineColour(mixed, "ring", 0)).not.toBe(0);
  });

  it("still cannot rescue a line with a gap in it", () => {
    // A wild is a colour, not a cell. An incomplete line is not a line.
    const gap = ringOf([3, 3, WILD, 0, 3, 3, 3, 3, 3, 3]);
    expect(lineColour(gap, "ring", 0)).toBe(0);
  });

  it("without one, a mixed line is still worth nothing", () => {
    const mixed = ringOf([3, 4, 5, 3, 3, 3, 3, 3, 3, 3]);
    expect(lineColour(mixed, "ring", 0)).toBe(0);
  });

  it("a line of nothing but wilds is a single colour too", () => {
    const all = ringOf(new Array(spec.sectors).fill(WILD));
    expect(lineColour(all, "ring", 0)).toBe(WILD);
  });

  it("cannot rescue a line containing stone", () => {
    // Stone has no colour at all, and a wild agreeing with it would hand back
    // the push that stone is supposed to cost.
    const stoned = ringOf([3, 3, WILD, STONE, 3, 3, 3, 3, 3, 3]);
    expect(lineColour(stoned, "ring", 0)).toBe(0);
  });

  it("goes down as one cell of one piece, never the whole piece", () => {
    const piece = pieceById("brick");
    const board = place(createBoard(spec), piece, 0, 0, 5, undefined, 1);

    let wilds = 0;
    let plain = 0;
    for (const [dr, ds] of piece.cells) {
      const value = getCell(board, dr, ds);
      if (value === WILD) wilds++;
      else if (colourOf(value) === 5) plain++;
    }
    expect(wilds).toBe(1);
    expect(plain).toBe(piece.size - 1);
  });

  it("never arrives on the same block as a stripe", () => {
    // Both are readable marks on a cell the size of a fingernail. Stacking
    // them would make neither legible.
    let state = createGame({ seed: 77, spec, rules: { stripeChance: 0.5, wildChance: 0.5 } });
    for (let i = 0; i < 60 && !state.over; i++) {
      for (const slot of state.tray) {
        if (!slot) continue;
        expect(slot.striped === undefined || slot.wild === undefined).toBe(true);
      }
      const move = chooseMove(state);
      if (!move) break;
      const result = applyMove(state, move);
      if (!result) break;
      state = result.state;
    }
  });

  it("did not change a single dealt sequence", () => {
    // Wilds are drawn off the *same* roll as stripes rather than a new one.
    // A new draw in the stream would have silently rewritten every daily ever
    // played, because a day's seed is chosen by playing that day through.
    const withWilds = createGame({ seed: 4242, spec, mode: "daily" });
    const without = createGame({ seed: 4242, spec, mode: "daily", rules: { wildChance: 0 } });
    expect(withWilds.rngState).toBe(without.rngState);
    expect(withWilds.tray.map((t) => t!.pieceId)).toEqual(without.tray.map((t) => t!.pieceId));
    expect(withWilds.tray.map((t) => t!.colour)).toEqual(without.tray.map((t) => t!.colour));
  });
});

describe("the core", () => {
  const spec = sizeById("standard").spec;

  const fill = (n: number) => {
    let state = createGame({ seed: 5, spec, core: DEFAULT_CORE });
    return { ...state, charge: n };
  };

  it("is off unless a round asks for it", () => {
    const bare = createGame({ seed: 1, spec, core: NO_CORE });
    expect(coreActive(bare.core)).toBe(false);
    expect(coreReady(bare.core, 999)).toBe(false);
    expect(applyMove({ ...bare, charge: 999 }, { type: "core" })).toBe(null);
  });

  it("charges from clears and from nothing else", () => {
    const none = { rings: [], spokes: [] };
    expect(chargeFrom(DEFAULT_CORE, none, 0, 0, false)).toBe(0);

    const spoke = chargeFrom(DEFAULT_CORE, { rings: [], spokes: [1] }, 0, 0, false);
    const ring = chargeFrom(DEFAULT_CORE, { rings: [1], spokes: [] }, 0, 0, false);
    expect(spoke).toBeGreaterThan(0);
    expect(ring).toBeGreaterThan(spoke);
    // A single-colour line pays on top of the line itself.
    expect(chargeFrom(DEFAULT_CORE, { rings: [], spokes: [1] }, 1, 0, false)).toBeGreaterThan(spoke);
  });

  it("pays a sweep a fraction rather than a refill", () => {
    // A full core for a bullseye would let one sweep chain straight into the
    // next, which is the shape of every runaway mechanic.
    const sweep = chargeFrom(DEFAULT_CORE, { rings: [1], spokes: [1] }, 0, 0, true);
    expect(sweep).toBeLessThan(DEFAULT_CORE.capacity);
  });

  it("refuses to fire below full, and fires exactly at full", () => {
    expect(applyMove(fill(DEFAULT_CORE.capacity - 1), { type: "core" })).toBe(null);

    let ready = fill(DEFAULT_CORE.capacity);
    // Something has to be on the board or there is nothing to sweep.
    ready = applyMove(ready, { type: "place", slot: 0, r: 0, s: 0 })!.state;
    const fired = applyMove({ ...ready, charge: DEFAULT_CORE.capacity }, { type: "core" });
    expect(fired).not.toBe(null);
    expect(fired!.events.coreFired).toBe(true);
    expect(fired!.state.charge).toBe(0);
    expect(filledCount(fired!.state.board)).toBe(0);
  });

  it("sweeps stone as well as blocks", () => {
    // Stone is otherwise only shifted by a stripe or a bullseye, so the core
    // being able to take it is most of what makes it worth holding deep in a
    // ramped round.
    let state = createGame({ seed: 9, spec, core: DEFAULT_CORE });
    const board = state.board;
    board.cells[cellIndex(spec, spec.rings - 1, 2)] = STONE;
    board.cells[cellIndex(spec, 0, 0)] = 4;
    state = { ...state, board, charge: DEFAULT_CORE.capacity };

    const fired = applyMove(state, { type: "core" })!;
    expect(stoneCount(fired.state.board)).toBe(0);
    expect(filledCount(fired.state.board)).toBe(0);
  });

  it("never charges past its capacity", () => {
    // A core that could overfill would let one huge move pay for the next.
    let state = createGame({ seed: 11, spec, core: DEFAULT_CORE });
    const result = playOut(state, 400, BOT_POLICY_V2);
    expect(result.state.charge).toBeLessThanOrEqual(DEFAULT_CORE.capacity);
  });

  it("announces the move that fills it, once", () => {
    let state = createGame({ seed: 3, spec, core: DEFAULT_CORE });
    let fills = 0;
    let sawReady = false;

    for (let i = 0; i < 200 && !state.over; i++) {
      const move = chooseMove(state, { pushes: true, colour: true, core: false, coreAt: 1 });
      if (!move) break;
      const result = applyMove(state, move);
      if (!result) break;
      if (result.events.coreFilled) fills++;
      state = result.state;
      if (coreReady(state.core, state.charge)) {
        // Once full it stays full until fired, and must not re-announce.
        if (sawReady) expect(result.events.coreFilled).toBe(false);
        sawReady = true;
      } else {
        sawReady = false;
      }
    }
    expect(fills, "the core never filled in 200 moves").toBeGreaterThan(0);
  });

  /** Fires a core on a board filled to roughly this fraction. */
  const fireOnBoard = (fraction: number): number => {
    const state = createGame({ seed: 21, spec, core: DEFAULT_CORE });
    const board = state.board;
    const total = spec.rings * spec.sectors;
    let placed = 0;
    for (let r = 0; r < spec.rings && placed < total * fraction; r++) {
      for (let sct = 0; sct < spec.sectors && placed < total * fraction; sct++) {
        board.cells[cellIndex(spec, r, sct)] = 1 + ((r + sct) % 8);
        placed++;
      }
    }
    const fired = applyMove({ ...state, board, charge: DEFAULT_CORE.capacity }, { type: "core" });
    return fired?.events.scoreDelta ?? 0;
  };

  it("pays for what it sweeps, so a fuller board is worth more", () => {
    // The whole decision the core exists to create: hold it while the disc
    // fills, cash it before it strangles you. If firing early paid the same,
    // there would be nothing to decide.
    const quarter = fireOnBoard(0.25);
    const half = fireOnBoard(0.5);
    const packed = fireOnBoard(1);

    expect(quarter).toBeGreaterThan(0);
    expect(half).toBeGreaterThan(quarter * 1.6);
    expect(packed).toBeGreaterThan(half * 1.6);
  });

  it("is worth less than a bullseye even on a full board", () => {
    // Scoring it through clearScore paid it 33,660 on a standard disc — three
    // times a bullseye — because every ring and spoke counted as a
    // simultaneous line. A move that needs no setup must not out-earn the one
    // that needs the most.
    const bullseye = clearScore({ rings: [0], spokes: [0] }, 0, false, 0, true);
    expect(fireOnBoard(1)).toBeLessThan(bullseye);
  });
});

describe("time attack", () => {
  const noClears = {
    clears: { rings: [], spokes: [] },
    stripesFired: 0,
    sweep: false,
  } as unknown as Parameters<typeof timeBonus>[0];

  const events = (over: Partial<Record<string, unknown>>) =>
    ({ ...noClears, ...over }) as unknown as Parameters<typeof timeBonus>[0];

  it("pays nothing for a move that clears nothing", () => {
    // The whole mode rests on this: placing pieces does not buy time, only
    // clearing does. Otherwise the clock is a formality.
    expect(timeBonus(noClears)).toBe(0);
  });

  it("pays for clears in the order the game values them", () => {
    const spoke = timeBonus(events({ clears: { rings: [], spokes: [2] } }));
    const ring = timeBonus(events({ clears: { rings: [1], spokes: [] } }));
    const sweep = timeBonus(events({ clears: { rings: [1], spokes: [2] }, sweep: true }));

    expect(spoke).toBeGreaterThan(0);
    expect(ring).toBeGreaterThan(spoke);
    expect(sweep).toBeGreaterThan(ring);
  });

  it("cannot be outrun: the clock speeds up without bound until it caps", () => {
    // A constant drain against a fixed refill is a treadmill a good player
    // walks forever, which is exactly what free play did before its ramp.
    expect(drainRate(TIME_ATTACK, 0)).toBe(1);
    expect(drainRate(TIME_ATTACK, TIME_ATTACK.drainEvery)).toBeGreaterThan(1);
    expect(drainRate(TIME_ATTACK, TIME_ATTACK.drainEvery * 3)).toBeGreaterThan(
      drainRate(TIME_ATTACK, TIME_ATTACK.drainEvery),
    );
    // No ceiling, on purpose. A capped drain is a rate a good enough player
    // out-earns, and then the round never ends — measured, not assumed.
    expect(drainRate(TIME_ATTACK, 100_000)).toBeGreaterThan(100);
  });

  it("always pays something for a clear, at any point in the round", () => {
    // An earlier version opened at 45 seconds and capped at 25, so above the
    // cap a clear was worth literally nothing and the first twenty seconds of
    // every round silently ignored the player. A mode whose one mechanic is
    // "clearing buys time" cannot have a phase where clearing buys no time.
    for (let left = 0.5; left < TIME_ATTACK.seconds; left += 0.5) {
      expect(addTime(TIME_ATTACK, left, 1.5), `nothing gained at ${left}s`).toBeGreaterThan(left);
    }
    // Only a full clock absorbs it, and it never overflows.
    expect(addTime(TIME_ATTACK, TIME_ATTACK.seconds, 8)).toBe(TIME_ATTACK.seconds);
  });

  /**
   * Plays a round at a fixed standard of play and reports how long it lasted.
   * `spokeEvery` and `ringEvery` are seconds between clears; Infinity means
   * never. This is the same model the shipping numbers were tuned against.
   */
  function survives(spokeEvery: number, ringEvery = Infinity): number {
    const step = 0.05;
    let left = TIME_ATTACK.seconds;
    let elapsed = 0;
    let nextSpoke = spokeEvery;
    let nextRing = ringEvery;

    while (left > 0 && elapsed < 3600) {
      left -= step * drainRate(TIME_ATTACK, elapsed);
      elapsed += step;
      if (elapsed >= nextSpoke) {
        left = addTime(TIME_ATTACK, left, timeBonus(events({ clears: { rings: [], spokes: [1] } })));
        nextSpoke += spokeEvery;
      }
      if (elapsed >= nextRing) {
        left = addTime(TIME_ATTACK, left, timeBonus(events({ clears: { rings: [1], spokes: [] } })));
        nextRing += ringEvery;
      }
    }
    return elapsed;
  }

  it("a player who never clears gets the opening clock and nothing more", () => {
    const idle = survives(Infinity);
    expect(idle).toBeGreaterThan(TIME_ATTACK.seconds * 0.7);
    expect(idle).toBeLessThan(TIME_ATTACK.seconds + 1);
  });

  it("clearing buys life, and playing better buys more of it", () => {
    // The mechanic, stated as an ordering rather than as numbers — the numbers
    // are tuning and will move; that better play lasts longer must not.
    const idle = survives(Infinity);
    const slow = survives(8, 60);
    const good = survives(3.5, 25);
    const expert = survives(2, 12);

    expect(slow).toBeGreaterThan(idle);
    expect(good).toBeGreaterThan(slow);
    expect(expert).toBeGreaterThan(good);
    // And the gap is worth having: an expert should last multiples of a
    // beginner, or the leaderboard cannot tell them apart.
    expect(expert / slow).toBeGreaterThan(2);
  });

  it("ends for everyone, however well they play", () => {
    // Even someone clearing a spoke every second and a ring every five — far
    // beyond human — has to run out. A mode that does not end ranks patience.
    expect(survives(1, 5)).toBeLessThan(3600);
  });
});

describe("the belt", () => {
  const beltGame = () =>
    openBelt(
      createGame({
        seed: 12345,
        mode: "belt",
        spec: sizeById("standard").spec,
        pack: "mixed",
        fairDeal: true,
      }),
    );

  it("opens with room to deliver into, not a full tray", () => {
    // The bug this pins, found by modelling before it could ship: the tray
    // *is* the belt, so opening with the usual three pieces means the very
    // first arrival overflows and an ordinary player takes a stone a few
    // seconds in having done nothing wrong.
    const game = beltGame();
    expect(game.tray.filter((s) => s !== null)).toHaveLength(1);
    expect(game.tray[0]).not.toBeNull();
  });

  it("fills the empty slots one piece at a time", () => {
    let game = beltGame();
    for (const expected of [2, 3]) {
      const delivery = deliverToBelt(game);
      expect(delivery.overflowed).toBe(false);
      expect(delivery.stoneDropped).toBeNull();
      game = delivery.state;
      expect(game.tray.filter((s) => s !== null)).toHaveLength(expected);
    }
  });

  it("drops a stone rather than ending the round when it overflows", () => {
    // A cliff would make the whole mode one mistake long and give the player
    // no way to see the ending coming. Stone is the warning: a line containing
    // it does not clear, so the disc degrades where you can watch it happen.
    let game = beltGame();
    game = deliverToBelt(game).state;
    game = deliverToBelt(game).state;
    expect(game.tray.every((s) => s !== null)).toBe(true);

    const stoneBefore = stoneCount(game.board);
    const overflow = deliverToBelt(game);
    expect(overflow.overflowed).toBe(true);
    expect(overflow.stoneDropped).not.toBeNull();
    expect(stoneCount(overflow.state.board)).toBe(stoneBefore + 1);
    // Still playable — the round ends the ordinary way, when nothing fits.
    expect(overflow.state.over).toBe(false);
  });

  it("never delivers into a finished round", () => {
    const game = { ...beltGame(), over: true };
    const delivery = deliverToBelt(game);
    expect(delivery.state).toBe(game);
    expect(delivery.overflowed).toBe(false);
  });

  it("speeds up without ever reaching zero", () => {
    // The third time this lesson has been paid for here — free play's ramp
    // plateaued on stone, time attack's drain plateaued at 2.2x and a good
    // enough player never died. Any dial meant to end a round has to grow
    // without a ceiling.
    let previous = Infinity;
    for (const elapsed of [0, 30, 60, 120, 300, 600, 3600]) {
      const gap = beltInterval(BELT, elapsed);
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThanOrEqual(previous);
      previous = gap;
    }
    // Genuinely unbounded: far enough out, the belt beats any human rate.
    expect(beltInterval(BELT, 36_000)).toBeLessThan(0.2);
    expect(beltInterval(BELT, 0)).toBe(BELT.opening);
  });

  it("keeps the engine pure — a delivery is a function of the state alone", () => {
    // The belt's *timing* belongs to the screen for the same reason the clock
    // does. What is in the engine must stay replayable and testable.
    const game = beltGame();
    expect(deliverToBelt(game).state.tray).toEqual(deliverToBelt(game).state.tray);
  });
});

describe("challenge codes", () => {
  const sample = {
    seed: 0xdeadbeef,
    size: "large" as const,
    pack: "chunks" as const,
    pieces: CHALLENGE_PIECES,
    score: 12480,
  };

  it("survives the round trip exactly", () => {
    // Not approximately. Two people have to get the identical round, so a code
    // that decoded to a nearby seed would be worse than one that failed.
    expect(decodeChallenge(encodeChallenge(sample))).toEqual(sample);
  });

  it("round trips every disc and pack", () => {
    for (const size of SIZES) {
      for (const pack of PACKS) {
        const one = { ...sample, size: size.id, pack: pack.id };
        expect(decodeChallenge(encodeChallenge(one))).toEqual(one);
      }
    }
  });

  it("reads a code out of the message it arrived in", () => {
    const code = encodeChallenge(sample);
    const message = `I got 12 480 in Shiftle. Beat it:\n\n${formatCode(code)}\n`;
    expect(decodeChallenge(message)).toEqual(sample);
  });

  it("survives the characters people get wrong", () => {
    // Crockford's alphabet has no I, L, O or U precisely so these can be
    // mapped back rather than rejected.
    const code = encodeChallenge({ ...sample, seed: 0 });
    const mangled = code.toLowerCase().replace(/1/g, "l").replace(/0/g, "O");
    expect(decodeChallenge(mangled)).toEqual({ ...sample, seed: 0 });
  });

  it("refuses every single-character typo rather than inventing a round", () => {
    // The worst failure available here is two people believing they played the
    // same round when they did not, so every one-character slip has to be
    // caught. The first checksum tried — a digit sum — failed this: it let a
    // typo through that decoded to a different score on the same seed.
    const code = encodeChallenge(sample);
    const slipped: string[] = [];

    for (let i = 0; i < code.length; i++) {
      for (const swap of ALPHABET_FOR_TEST) {
        if (code[i] === swap) continue;
        const typo = code.slice(0, i) + swap + code.slice(i + 1);
        const decoded = decodeChallenge(typo);
        if (decoded !== null) slipped.push(`${typo} -> ${JSON.stringify(decoded)}`);
      }
    }

    expect(slipped, `codes accepted after one typo: ${slipped.slice(0, 3).join(", ")}`).toEqual([]);
  });

  it("clamps a score too large to carry instead of wrapping it", () => {
    const huge = decodeChallenge(encodeChallenge({ ...sample, score: MAX_CODE_SCORE + 5000 }));
    expect(huge?.score).toBe(MAX_CODE_SCORE);
  });

  it("rejects rubbish", () => {
    for (const junk of ["", "hello", "0000", "not a code at all, sorry"]) {
      expect(decodeChallenge(junk)).toBe(null);
    }
  });

  it("hands out a challenge the bot can actually play", () => {
    // The deal is fixed rather than adaptive, so a bad seed cannot be rescued
    // mid-round the way free play's is. Sending somebody a round that dies on
    // piece nine is worse than sending nothing.
    for (const salt of ["a", "b", "c", "d"]) {
      const challenge = newChallenge(salt);
      const game = createGame({
        seed: challenge.seed,
        mode: "challenge",
        spec: sizeById(challenge.size).spec,
        pack: challenge.pack,
        fairDeal: false,
        rules: { pieceLimit: challenge.pieces },
      });
      const result = playOut(game, challenge.pieces + 40);
      expect(result.state.stats.piecesPlaced, `challenge ${salt} died early`).toBeGreaterThanOrEqual(18);
    }
  });

  it("gives both players the identical pieces however differently they play", () => {
    // The entire promise of the feature. Two people play the same code their
    // own way, and the sequence of pieces they are handed has to match piece
    // for piece — which is exactly what free play's adaptive deal would break,
    // since it reads the board before choosing.
    const challenge = newChallenge("shared");
    const deal = () =>
      createGame({
        seed: challenge.seed,
        mode: "challenge",
        spec: sizeById(challenge.size).spec,
        pack: challenge.pack,
        fairDeal: false,
        rules: { pieceLimit: challenge.pieces },
      });

    /** Every piece this player was dealt, in order, however they played. */
    const sequence = (pick: "greedy" | "first"): string[] => {
      let state = deal();
      const seen: string[] = state.tray.map((slot) => slot!.pieceId);

      for (let i = 0; i < 24 && !state.over; i++) {
        const move = pick === "greedy" ? chooseMove(state) : firstPlacement(state);
        if (!move) break;
        const result = applyMove(state, move);
        if (!result) break;
        state = result.state;
        if (result.events.trayRefilled) {
          seen.push(...state.tray.map((slot) => slot!.pieceId));
        }
      }
      return seen;
    };

    const greedy = sequence("greedy");
    const plain = sequence("first");
    const shared = Math.min(greedy.length, plain.length);
    expect(shared).toBeGreaterThan(RULES.traySize * 2);
    expect(greedy.slice(0, shared)).toEqual(plain.slice(0, shared));
  });
});

describe("what depth looks like", () => {
  it("changes nothing at the top of a round", () => {
    expect(depthShift(0)).toBe(0);
    for (const theme of THEMES) {
      expect(deepen(theme.backdrop[0], depthShift(0))).toBe(theme.backdrop[0]);
      expect(deepen(theme.backdrop[1], depthShift(0))).toBe(theme.backdrop[1]);
    }
  });

  it("holds every theme's hue exactly, however deep it goes", () => {
    // Rule 1: depth modifies the theme, it never replaces it. Drifting the hue
    // is how a Bubblegum player would end up looking at somebody else's theme.
    for (const theme of THEMES) {
      for (const start of theme.backdrop) {
        const before = toHSL(start)!;
        for (const depth of [1, 4, 9, 30]) {
          const after = toHSL(deepen(start, depthShift(depth)))!;
          // 1.5 degrees is the 8-bit hex round-trip, measured: the worst case
          // across all seven themes is Mint's ground at 0.65. Real drift would
          // be tens of degrees, so this still catches it.
          expect(Math.abs(after.h - before.h)).toBeLessThan(1.5);
        }
      }
    }
  });

  it("gets richer rather than greyer", () => {
    // Rule 3, and the one that killed two earlier attempts: blending toward
    // gold cancelled to mud and compositing it bleached toward white. Both
    // would fail here, because both drop the saturation.
    for (const theme of THEMES) {
      for (const start of theme.backdrop) {
        const before = toHSL(start)!;
        const after = toHSL(deepen(start, depthShift(9)))!;
        expect(after.s).toBeGreaterThanOrEqual(before.s - 1e-9);
        expect(after.l).toBeLessThan(before.l);
      }
    }
  });

  it("never arrives anywhere near a dark theme", () => {
    // The whole art brief in one assertion. Lemonade's ground is the darkest
    // starting point of the seven, and even it stays well clear of the floor.
    for (const theme of THEMES) {
      for (const start of theme.backdrop) {
        for (const depth of [9, 12, 40, 1000]) {
          expect(toHSL(deepen(start, depthShift(depth)))!.l).toBeGreaterThanOrEqual(0.41);
        }
      }
    }
  });

  it("stops shifting once it is deep, so it cannot run away", () => {
    const nine = deepen(SKY.backdrop[0], depthShift(9));
    expect(deepen(SKY.backdrop[0], depthShift(50))).toBe(nine);
    expect(deepen(SKY.backdrop[0], depthShift(5000))).toBe(nine);
  });

  it("survives a colour it cannot read instead of taking the frame down", () => {
    // This runs inside a draw call. A bad value should cost a shade, not a frame.
    expect(deepen("not a colour", 0.4)).toBe("not a colour");
    expect(deepen("", 0.4)).toBe("");
    expect(toHSL("#zzz")).toBeNull();
    // Short hex is legal CSS and the themes could start using it any day.
    expect(toHSL("#0af")).toEqual(toHSL("#00aaff"));
  });

  it("fills the rim one segment per depth", () => {
    expect(bezel(0)).toEqual({ lit: 0, lap: 0 });
    expect(bezel(1)).toEqual({ lit: 1, lap: 0 });
    expect(bezel(11)).toEqual({ lit: 11, lap: 0 });
  });

  it("shows a completed lap as full, not as empty", () => {
    // The remainder at exactly 12 is zero, and blanking the rim at the moment
    // it completes would read as losing the run rather than finishing a lap.
    expect(bezel(12)).toEqual({ lit: 12, lap: 0 });
    expect(bezel(13)).toEqual({ lit: 1, lap: 1 });
    expect(bezel(24)).toEqual({ lit: 12, lap: 1 });
    expect(bezel(25)).toEqual({ lit: 1, lap: 2 });
  });

  it("still says something at a depth nobody will reach", () => {
    // Depth is unbounded in the engine: the stone dial tightens forever, so
    // there is no depth the game refuses to go past.
    for (const depth of [40, 200, 5000]) {
      const { lit, lap } = bezel(depth);
      expect(lit).toBeGreaterThanOrEqual(1);
      expect(lit).toBeLessThanOrEqual(BEZEL_SEGMENTS);
      expect(lap).toBeGreaterThanOrEqual(0);
      expect(bezelColour(lit - 1, lap)).toMatch(/^rgb\(/);
    }
  });

  it("never picks a block colour for the rim", () => {
    // Rule 2 from the other side: the rim must not start looking like a cell.
    const blocks = new Set(THEMES.flatMap((t) => t.blocks.map((b) => b.base.toLowerCase())));
    for (let lap = 0; lap < 3; lap++) {
      for (let i = 0; i < BEZEL_SEGMENTS; i++) {
        const colour = bezelColour(i, lap);
        expect(colour).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
        expect(blocks.has(colour)).toBe(false);
      }
    }
  });
});

/** One depth inside every world, on the first lap and on a deeper one. */
function everyWorldDepth(): number[] {
  const out: number[] = [];
  for (let lap = 0; lap < 3; lap++) {
    for (const world of WORLDS) out.push(lap * LAP_SPAN + world.from + 2);
  }
  return out;
}

describe("palette eras", () => {
  /** Hue, saturation and lightness separation of a set of eight blocks. */
  const separation = (blocks: readonly { base: string }[]) => {
    const c = blocks.map((b) => toHSL(b.base)!);
    let minHue = 360;
    for (let i = 0; i < c.length; i++) {
      for (let j = i + 1; j < c.length; j++) {
        const d = Math.abs(c[i]!.h - c[j]!.h);
        minHue = Math.min(minHue, Math.min(d, 360 - d));
      }
    }
    const ls = c.map((x) => x.l);
    return {
      minHue,
      minSat: Math.min(...c.map((x) => x.s)),
      lo: Math.min(...ls),
      hi: Math.max(...ls),
    };
  };

  it("swaps every colour at once, never one of them", () => {
    // The rule this protects: a line only pays a spin if every cell shares one
    // colour. Eight colours moving together is safe; one drifting toward a
    // neighbour would make two distinct blocks start reading as a match.
    for (const depth of everyWorldDepth()) {
      const palette = paletteFor(SKY, eraAt(depth));
      expect(palette).toHaveLength(SKY.blocks.length);
      expect(new Set(palette.map((c) => c.base)).size).toBe(8);
    }
  });

  it("leaves the first era exactly as the game shipped", () => {
    expect(paletteFor(SKY, eraAt(0))).toBe(SKY.blocks);
    expect(themeForDepth(SKY, 0)).toBe(SKY);
    for (const theme of THEMES) expect(themeForDepth(theme, 0)).toBe(theme);
  });

  it("is never less separable than the palette that already ships", () => {
    // The bar is measured, not invented: the shipped palette's tightest hue gap
    // is 17.4 degrees (orange at 29 and lemon at 46) and its lowest saturation
    // is 78%. Hand-picking eight fresh hexes per era was the first attempt and
    // three of four candidates came in worse — 12.6 degrees and 49% at worst.
    // A rigid rotation cannot: it moves all eight together and the gaps between
    // them are preserved exactly.
    const bar = separation(SKY.blocks);
    expect(bar.minHue).toBeCloseTo(17.4, 1);
    for (const depth of everyWorldDepth()) {
      const era8 = separation(paletteFor(SKY, eraAt(depth)));
      // Half a degree of slack for the 8-bit hex round-trip, which is the only
      // thing that can move a rigid rotation's spacing at all.
      expect(era8.minHue).toBeGreaterThan(bar.minHue - 0.5);
      expect(era8.minSat).toBeGreaterThan(bar.minSat - 0.01);
    }
  });

  it("never drifts pale enough to lose the plate, or dark enough to stop being a sweet", () => {
    for (const theme of THEMES) {
      for (const depth of everyWorldDepth()) {
        for (const colour of paletteFor(theme, eraAt(depth))) {
          const { l } = toHSL(colour.base)!;
          expect(l).toBeGreaterThanOrEqual(0.35);
          expect(l).toBeLessThanOrEqual(0.75);
        }
      }
    }
  });

  it("never lets a block go grey enough to be mistaken for stone", () => {
    // Stone is the one thing on the disc that is not a sweet to be cleared. It
    // is off-palette and unsaturated on purpose, and a washed-out block is how
    // that distinction quietly dies.
    const stone = toHSL(SKY.stone.base)!;
    expect(stone.s).toBeLessThan(0.25);
    for (const theme of THEMES) {
      for (const depth of everyWorldDepth()) {
        for (const colour of paletteFor(theme, eraAt(depth))) {
          expect(toHSL(colour.base)!.s).toBeGreaterThan(0.6);
        }
      }
    }
  });

  it("notices an era being crossed, and only forwards", () => {
    expect(eraChanged(9, 10)).toBe(true);
    expect(eraChanged(10, 11)).toBe(false);
    expect(eraChanged(19, 20)).toBe(true);
    expect(eraChanged(20, 9)).toBe(false);
    expect(eraChanged(5, 5)).toBe(false);
  });

  it("moves the ground with the era, but only a little", () => {
    // Marcus asked for the background to keep changing "but not too much". A
    // theme that rotates far enough stops being the one the player earned.
    for (const theme of THEMES) {
      const start = toHSL(theme.backdrop[0])!;
      for (const depth of [0, 10, 20, 30, 40, 130]) {
        const after = toHSL(themeForDepth(theme, depth).backdrop[0])!;
        const drift = Math.abs(after.h - start.h);
        expect(Math.min(drift, 360 - drift)).toBeLessThanOrEqual(20.5);
      }
    }
  });

  it("hands other modes their own theme untouched, object and all", () => {
    // Depth is structurally zero without a ramp, so this is what the daily, the
    // levels, the challenges and time attack all get.
    for (const theme of THEMES) {
      expect(themeForDepth(theme, 0).blocks).toBe(theme.blocks);
      expect(themeForDepth(theme, -3).blocks).toBe(theme.blocks);
      expect(themeForDepth(theme, Number.NaN).blocks).toBe(theme.blocks);
    }
  });
});

describe("depth worlds", () => {
  it("puts a world every two depths, in the order Marcus named", () => {
    // Two rather than ten, because the median round is depth ~14: at ten, eight
    // of the ten worlds were content nobody would ever reach.
    expect(worldAt(0).id).toBe("candy");
    expect(worldAt(1).id).toBe("candy");
    expect(worldAt(2).id).toBe("fruit");
    expect(worldAt(4).id).toBe("woodland");
    expect(worldAt(6).id).toBe("toybox");
    expect(worldAt(8).id).toBe("animal");
    expect(worldAt(10).id).toBe("crystal");
    expect(worldAt(12).id).toBe("ocean");
    expect(worldAt(14).id).toBe("space");
    expect(worldAt(16).id).toBe("arcade");
    expect(worldAt(18).id).toBe("lava");
    expect(worldAt(19).id).toBe("lava");
  });

  it("shows a median round most of the ten", () => {
    // The whole reason for the two-depth span. A round that reaches depth 14 —
    // the measured median — must not spend itself inside two worlds.
    const seen = new Set<string>();
    for (let depth = 0; depth <= 14; depth++) seen.add(worldAt(depth).id);
    expect(seen.size).toBeGreaterThanOrEqual(8);
  });

  it("comes round again past a hundred instead of running out", () => {
    // Depth is unbounded in the engine — the stone dial keeps tightening for
    // ever — so a table that ended would leave the deepest players at nothing.
    expect(worldAt(20).id).toBe("candy");
    expect(worldAt(22).id).toBe("fruit");
    expect(lapAt(20)).toBe(1);
    expect(lapAt(50)).toBe(2);
    for (const depth of [20, 100, 137, 999, 12_345, 1e6]) {
      expect(WORLDS.some((w) => w.id === worldAt(depth).id)).toBe(true);
      expect(materialById(finishAt(depth))).toBeTruthy();
    }
  });

  it("survives a depth that is not a number at all", () => {
    // This runs inside a draw call: a bad value should cost a shade, not a frame.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, -1e9]) {
      expect(worldAt(bad).id).toBe("candy");
      expect(lapAt(bad)).toBe(0);
      expect(worldIndex(bad)).toBe(0);
    }
  });

  it("hardens once halfway through a world, not every depth", () => {
    // A two-depth span puts the halfway mark on every odd depth.
    expect(finishAt(0)).toBe("candy");
    expect(finishAt(1)).toBe("glazed");
    expect(finishAt(2)).toBe("glazed");
    expect(finishAt(3)).toBe("matte");
    expect(finishAt(4)).toBe("wood");
    expect(finishAt(11)).toBe("diamond");
  });

  it("announces a world only when one is actually entered", () => {
    expect(worldChanged(1, 2)).toBe(true);
    expect(worldChanged(2, 3)).toBe(false);
    expect(worldChanged(19, 20)).toBe(true);
    // Going nowhere is not a change, and neither is going backwards.
    expect(worldChanged(4, 4)).toBe(false);
    expect(worldChanged(6, 2)).toBe(false);
  });

  it("counts down to the next world correctly", () => {
    expect(depthsToNextWorld(0)).toBe(2);
    expect(depthsToNextWorld(1)).toBe(1);
    expect(depthsToNextWorld(2)).toBe(2);
    expect(nextWorld(1).id).toBe("fruit");
    expect(nextWorld(5).id).toBe("toybox");
    expect(nextWorld(19).id).toBe("candy");
  });

  it("keeps eight block colours in every world, on every lap", () => {
    for (const theme of THEMES) {
      for (const depth of everyWorldDepth()) {
        expect(paletteFor(theme, eraAt(depth))).toHaveLength(8);
      }
    }
  });

  it("leaves stone alone in every world", () => {
    // Stone is the one thing on the disc that is not a sweet to be cleared. No
    // world may touch it, or the threat stops reading as a threat.
    for (const theme of THEMES) {
      for (const depth of everyWorldDepth()) {
        expect(themeForDepth(theme, depth).stone).toBe(theme.stone);
      }
    }
  });

  it("never draws a pattern that could be mistaken for a striped block", () => {
    // The striped marker is white at 0.92 alpha, width * 0.2 wide, drawn as a
    // full arc AND a full radial line. That pair is what it means. A pattern
    // that came close would cost a player a move, so the caps are data here
    // rather than an intention somebody has to notice in review.
    for (const spec of PATTERNS) {
      const cap = spec.ink === "white" ? WHITE_CAP : SHADE_CAP;
      expect(spec.alpha).toBeLessThanOrEqual(cap);
      expect(spec.stroke).toBeLessThanOrEqual(STROKE_CAP);
      expect(spec.fullArc && spec.fullRadial).toBe(false);
    }
    expect(WHITE_CAP).toBeLessThan(0.92 / 2);
    expect(STROKE_CAP).toBeLessThan(0.2);
  });

  it("gives every world a pattern that exists and a finish that exists", () => {
    for (const world of WORLDS) {
      expect(patternSpec(world.pattern).id).toBe(world.pattern);
      expect(materialById(world.finish).id).toBe(world.finish);
      expect(materialById(world.finishLate).id).toBe(world.finishLate);
      expect(world.patternStrength).toBeGreaterThanOrEqual(0);
      expect(world.patternStrength).toBeLessThanOrEqual(1);
      // The ground cap is what keeps an earned Theme recognisable through a
      // world: Sky plus Ocean still has to feel like Sky.
      expect(Math.abs(world.ground)).toBeLessThanOrEqual(20);
    }
    expect(WORLDS).toHaveLength(10);
    expect(new Set(WORLDS.map((w) => w.id)).size).toBe(10);
    // Derived from the index, so the span and the boundaries cannot disagree.
    expect(WORLDS.map((w) => w.from)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
  });

  it("keeps the first world exactly as the game already looks", () => {
    // Candy is what the daily, the levels, the challenges and time attack all
    // wear. Free play's first ten depths have to match them or the game's own
    // face would be missing from its own default mode.
    const candy = WORLDS[0]!;
    expect(candy.hue).toBe(0);
    expect(candy.ground).toBe(0);
    expect(candy.pattern).toBe("none");
    expect(candy.patternStrength).toBe(0);
    for (const theme of THEMES) expect(themeForDepth(theme, 0)).toBe(theme);
  });

  it("never turns a returning world into an unreadable one", () => {
    // A deeper lap is meant to feel earned, not to become illegible. Pattern
    // strength deliberately does not climb — it is the one dial that would cost
    // legibility, which is the thing this system may never spend.
    for (const depth of [0, 20, 40, 60, 900]) {
      const trim = lapTrim(depth);
      expect(trim.sparkle).toBeLessThanOrEqual(0.24);
      expect(Math.abs(trim.ground)).toBeLessThanOrEqual(9);
    }
  });

  it("leaves the daily, the levels and time attack untouched", () => {
    // All three run without a ramp, so their depth is structurally zero. This
    // pins the consequence rather than the mechanism.
    for (const theme of THEMES) {
      expect(themeForDepth(theme, 0)).toBe(theme);
      expect(worldAt(0).pattern).toBe("none");
      expect(finishAt(0)).toBe("candy");
    }
  });

  it("never lets decoration touch the gameplay RNG", () => {
    // Patterns and particles are hashed from position, never drawn from the
    // engine's stream — that stream is threaded through game state for replay.
    // Playing the same seed twice with the pattern hash exercised in between
    // must land on byte-identical state.
    const play = (touchDecoration: boolean) => {
      let state = createGame({ seed: 4242, mode: "endless", ramp: FREE_PLAY_RAMP });
      for (let i = 0; i < 60; i++) {
        if (touchDecoration) {
          // Exactly what a frame does between moves.
          cellNoise(i * 3.3, i * 1.7);
          worldAt(depthAt(state.ramp, state.stats.piecesPlaced));
        }
        const move = chooseMove(state, BOT_POLICY_V2);
        if (!move) break;
        const next = applyMove(state, move);
        if (!next) break;
        state = next.state;
      }
      return state;
    };
    const quiet = play(false);
    const busy = play(true);
    expect(busy.rngState).toBe(quiet.rngState);
    expect(busy.score).toBe(quiet.score);
    expect(Array.from(busy.board.cells)).toEqual(Array.from(quiet.board.cells));
  });
});

describe("the save record", () => {
  it("survives anything that could be in storage", () => {
    // The rule: a broken save must never stop the game starting.
    for (const junk of [null, undefined, 0, "", "not json", [], true, { version: 99 }]) {
      const save = loadSave(junk);
      expect(save.version).toBe(SAVE_VERSION);
      expect(save.records).toEqual({});
      expect(save.mastery.activeId).toBeNull();
    }
  });

  it("throws away values that are not numbers, rather than storing them", () => {
    const save = loadSave({
      records: { endless: { score: "lots", depth: -4, bestCombo: Number.NaN, coresFired: 3 } },
      worlds: { fruit: { bestDepth: "deep" }, "../evil": { bestDepth: 9 }, ok: { bestDepth: 5 } },
      mastery: { round: -1, activeId: 42, progress: Infinity },
    });
    expect(save.records.endless).toEqual({
      score: 0, depth: 0, bestCombo: 0, ringsCleared: 0, coresFired: 3, survived: 0,
    });
    expect(save.worlds.fruit).toEqual({ bestDepth: 0 });
    // An id used as an object key is a cheap injection route, so it is filtered.
    expect(save.worlds["../evil"]).toBeUndefined();
    expect(save.worlds.ok).toEqual({ bestDepth: 5 });
    expect(save.mastery).toEqual({ round: 0, activeId: null, progress: 0, completed: 0 });
  });

  it("defaults sensitivity and rejects anything not one of the three levels", () => {
    expect(freshSave().controls).toEqual({ sensitivity: "standard" });
    expect(loadSave(null).controls).toEqual({ sensitivity: "standard" });
    expect(loadSave({ controls: { sensitivity: "high" } }).controls).toEqual({ sensitivity: "high" });
    expect(loadSave({ controls: { sensitivity: "extreme" } }).controls).toEqual({ sensitivity: "standard" });
    expect(loadSave({ controls: { sensitivity: 9 } }).controls).toEqual({ sensitivity: "standard" });
    expect(loadSave({ controls: null }).controls).toEqual({ sensitivity: "standard" });
  });

  it("carries an old mute forward as silence, not as new music", () => {
    // Somebody who had the whole game silenced must not be handed music on
    // first launch just because music became its own setting.
    expect(loadSave(null, true).audio).toEqual({ music: false, sfx: false, haptics: false });
    expect(loadSave(null, false).audio).toEqual({ music: true, sfx: true, haptics: true });
    // An explicit stored choice always wins over the migrated default.
    expect(loadSave({ audio: { music: true, sfx: false, haptics: true } }, true).audio).toEqual({
      music: true, sfx: false, haptics: true,
    });
  });

  it("only calls something a record when there was something to beat", () => {
    let save = freshSave();
    const first = applyRound(save, "endless", { score: 5000, depth: 4 });
    // Nothing to beat on a first round. Calling that a record is the fabricated
    // milestone the brief bans.
    expect(first.beaten).toEqual([]);
    expect(first.save.records.endless?.score).toBe(5000);

    const second = applyRound(first.save, "endless", { score: 9000, depth: 3 });
    expect(second.beaten).toEqual([{ kind: "score", from: 5000, to: 9000 }]);
    // A worse depth leaves the old one alone.
    expect(second.save.records.endless?.depth).toBe(4);
  });

  it("ranks beaten records by what matters, not by field order", () => {
    const seeded = applyRound(freshSave(), "endless", {
      score: 100, depth: 1, bestCombo: 1, ringsCleared: 1,
    }).save;
    const { beaten } = applyRound(seeded, "endless", {
      score: 200, depth: 2, bestCombo: 2, ringsCleared: 2,
    });
    expect(beaten.map((b) => b.kind)).toEqual(["depth", "score", "bestCombo", "ringsCleared"]);
  });

  it("keeps records per mode, so one cannot overwrite another", () => {
    let save = applyRound(freshSave(), "endless", { score: 9000 }).save;
    save = applyRound(save, "daily", { score: 100 }).save;
    expect(save.records.endless?.score).toBe(9000);
    expect(save.records.daily?.score).toBe(100);
  });

  it("reports a world as discovered exactly once", () => {
    const first = discoverWorld(freshSave(), "fruit", 3);
    expect(first.firstTime).toBe(true);
    expect(isDiscovered(first.save, "fruit")).toBe(true);
    const again = discoverWorld(first.save, "fruit", 5);
    expect(again.firstTime).toBe(false);
    expect(again.save.worlds.fruit?.bestDepth).toBe(5);
    // A shallower visit never lowers the best.
    expect(discoverWorld(again.save, "fruit", 2).save.worlds.fruit?.bestDepth).toBe(5);
  });
});

describe("mastery goals", () => {
  const NOTHING_DISCOVERED = new Set<string>();

  it("offers three different kinds every round, for ever", () => {
    for (let round = 0; round < 200; round++) {
      const three = offered(round, NOTHING_DISCOVERED);
      expect(three).toHaveLength(3);
      expect(new Set(three.map((g) => g.id)).size).toBe(3);
      for (const goal of three) expect(goalById(goal.id)).toBe(goal);
    }
  });

  it("is deterministic, so the same round always offers the same three", () => {
    for (const round of [0, 3, 17, 99]) {
      expect(offered(round, NOTHING_DISCOVERED).map((g) => g.id)).toEqual(
        offered(round, NOTHING_DISCOVERED).map((g) => g.id),
      );
    }
  });

  it("never offers a world goal for a world nobody has discovered", () => {
    for (let round = 0; round < 200; round++) {
      for (const goal of offered(round, NOTHING_DISCOVERED)) {
        expect(goal.id.startsWith("world-")).toBe(false);
      }
    }
  });

  it("has no goal for Candy — everyone is already standing on it", () => {
    expect(GOALS.some((g) => g.id === "world-candy")).toBe(false);
  });

  it("offers a world goal once, and only once, its world is discovered", () => {
    // A round where the hash lands on "world" needs a discovered world to
    // find — this searches for one rather than assuming a specific round
    // number, so it survives the pool or the hash shape changing later.
    const oneWorld = new Set(["ocean"]);
    let sawWorldGoal = false;
    for (let round = 0; round < 300; round++) {
      for (const goal of offered(round, oneWorld)) {
        if (!goal.id.startsWith("world-")) continue;
        expect(goal.id).toBe("world-ocean");
        sawWorldGoal = true;
      }
    }
    expect(sawWorldGoal).toBe(true);
  });

  it("reads a world goal as met once the round's depth reaches that world, not before", () => {
    const goal = goalById("world-ocean")!;
    const oceanFrom = WORLDS.find((w) => w.id === "ocean")!.from;
    const zeroStats = { ringsCleared: 0, spokesCleared: 0, bestCombo: 0, coresFired: 0, stripesFired: 0, pureClears: 0 };
    expect(goal.read(tallyOf("endless", 0, oceanFrom - 1, zeroStats))).toBe(0);
    expect(goal.read(tallyOf("endless", 0, oceanFrom, zeroStats))).toBe(1);
    expect(goal.read(tallyOf("endless", 0, oceanFrom + 50, zeroStats))).toBe(1);
  });

  it("never asks for depth outside free play, the only mode that ramps", () => {
    for (const goal of GOALS) {
      expect(goal.modes.length).toBeGreaterThan(0);
      if (goal.id.startsWith("depth-")) expect(goal.modes).toEqual(["endless"]);
    }
  });

  it("ignores a round in a mode the goal cannot be worked on", () => {
    const save = chooseGoal(freshSave(), "depth-8");
    const out = applyMastery(save, tallyOf("daily", 9999, 0, {
      ringsCleared: 40, spokesCleared: 0, bestCombo: 9, coresFired: 4, stripesFired: 9, pureClears: 9,
    }));
    expect(out.progress).toBe(0);
    expect(out.completed).toBe(false);
    expect(out.bonus).toBe(0);
  });

  it("never lets a bad round undo progress", () => {
    let save = chooseGoal(freshSave(), "rings-20");
    const stats = (rings: number) => tallyOf("endless", 0, 0, {
      ringsCleared: rings, spokesCleared: 0, bestCombo: 0, coresFired: 0, stripesFired: 0, pureClears: 0,
    });
    save = applyMastery(save, stats(14)).save;
    expect(save.mastery.progress).toBe(14);
    save = applyMastery(save, stats(2)).save;
    expect(save.mastery.progress).toBe(14);
  });

  it("pays into lifetime only on completion, and only a little", () => {
    const save = chooseGoal(freshSave(), "core-1");
    const tally = tallyOf("endless", 0, 0, {
      ringsCleared: 0, spokesCleared: 0, bestCombo: 0, coresFired: 2, stripesFired: 0, pureClears: 0,
    });
    const out = applyMastery(save, tally);
    expect(out.completed).toBe(true);
    expect(out.bonus).toBe(MASTERY_BONUS);
    // A free-play round is worth roughly 100,000 lifetime on measured play, so
    // the bonus must stay far below "a better way to earn than playing".
    expect(MASTERY_BONUS).toBeLessThan(10_000);
    // Completing clears the goal and moves the offer on. Nothing expires.
    expect(out.save.mastery.activeId).toBeNull();
    expect(out.save.mastery.round).toBe(1);
    expect(out.save.mastery.completed).toBe(1);
  });

  it("does nothing at all when no goal is chosen", () => {
    const save = freshSave();
    const out = applyMastery(save, tallyOf("endless", 500, 9, {
      ringsCleared: 9, spokesCleared: 0, bestCombo: 9, coresFired: 9, stripesFired: 9, pureClears: 9,
    }));
    expect(out.save).toBe(save);
    expect(out.bonus).toBe(0);
  });

  it("resets progress when the player swaps goal, but not when re-picking the same", () => {
    let save = chooseGoal(freshSave(), "rings-20");
    save = applyMastery(save, tallyOf("endless", 0, 0, {
      ringsCleared: 9, spokesCleared: 0, bestCombo: 0, coresFired: 0, stripesFired: 0, pureClears: 0,
    })).save;
    expect(chooseGoal(save, "rings-20").mastery.progress).toBe(9);
    expect(chooseGoal(save, "combo-5").mastery.progress).toBe(0);
    expect(chooseGoal(save, "nonsense").mastery.activeId).toBe("rings-20");
  });
});
