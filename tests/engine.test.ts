import { describe, expect, it } from "vitest";

import { sectorDelta, wrapSector } from "../src/engine/geometry.js";
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
import { PACKS, SIZES, bagFor, dailyVariant } from "../src/engine/variants.js";
import { spinRing } from "../src/engine/rotate.js";
import { clearScore, comboMultiplier, simultaneousMultiplier } from "../src/engine/scoring.js";
import {
  type Move,
  RULES,
  applyMove,
  createGame,
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
    // Spokes only pop when the rule is switched on.
    expect(findClears(board).spokes).toEqual([]);
    const clears = findClears(board, true);
    expect(clears.spokes).toEqual([7]);
    expect(clears.rings).toEqual([]);
  });

  it("clears a ring and a spoke at once without double-counting the crossing", () => {
    // Everything filled except ring 2 / sector 3, which both lines need.
    const board = boardWithHoles([[2, 3]]);
    const full = place(board, pieceById("dot"), 2, 3, 5);

    const clears = findClears(full, true);
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

    const { board: after } = applyClears(board, findClears(board, true));
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

    expect(findClears(board, true).spokes).toEqual([]);
    const spun = spinRing(board, 2, -1);
    expect(findClears(spun, true).spokes).toEqual([0]);
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

  it("clears rings only, unless spokes are asked for", () => {
    expect(DEFAULT_RULES.spinSource).toBe("any");
    let board = createBoard(spec);
    for (let r = 0; r < spec.rings; r++) board = place(board, pieceById("dot"), r, 3, 1);
    // A full spoke is inert by default — measurement showed spokes drained the
    // disc faster than it filled, so rounds never ended.
    expect(findClears(board).spokes).toEqual([]);
    expect(findClears(board, true).spokes).toEqual([3]);
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
