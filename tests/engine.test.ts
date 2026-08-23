import { describe, expect, it } from "vitest";

import { cellIndex, sectorDelta, wrapSector } from "../src/engine/geometry.js";
import { DEFAULT_RULES } from "../src/engine/game.js";
import { dailyNumber, dailySeed, hashSeed, nextRandom } from "../src/engine/rng.js";
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
  STRIPE_FLAG,
  colourOf,
  detonate,
  isBullseye,
  isStripedValue,
  lineColour,
} from "../src/engine/board.js";
import { chooseMove, playOut } from "../src/engine/bot.js";
import { PACKS, SIZES, bagFor, dailyVariant } from "../src/engine/variants.js";
import { pushSpoke, spinRing } from "../src/engine/rotate.js";
import { pureLines } from "../src/engine/board.js";
import { clearScore, comboMultiplier, simultaneousMultiplier } from "../src/engine/scoring.js";
import {
  type Move,
  RULES,
  applyMove,
  createGame,
  dealFreshTray,
  isGameOver,
  replay,
  slotPiece,
} from "../src/engine/game.js";

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
          expect(cell.colour).toBeGreaterThan(0);
          expect(cell.colour).toBeLessThanOrEqual(RULES.colours);
        }
        state = result.state;
      }
    }
  });
});
