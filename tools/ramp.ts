/**
 * Does free play end, and does it end for the right reason?
 *
 * `npm run endless` established the problem: on the default packs a round
 * essentially never finishes, so the leaderboard ranked patience. This measures
 * the fix. It plays the bot through the ramp on every disc and pack and reports
 * how long a round lasts, how much of it was spent under stone, and — the part
 * that matters — whether the distribution is *wide*. A ramp that killed
 * everybody at exactly piece 180 would end rounds without making them a
 * contest; the spread between a bad run and a good one is the leaderboard.
 *
 *   npx vite-node tools/ramp.ts [runs]
 *   npx vite-node tools/ramp.ts 40 sweep    — try candidate ramps
 */

import { createGame } from "../src/engine/game.js";
import { type RampSpec, FREE_PLAY_RAMP, NO_RAMP, depthAt } from "../src/engine/ramp.js";
import { playOut } from "../src/engine/bot.js";
import { stoneCount } from "../src/engine/board.js";
import { PACKS, SIZES, sizeById } from "../src/engine/variants.js";
import { hashSeed } from "../src/engine/rng.js";

const RUNS = Number(process.argv[2] ?? 24);
const MODE = process.argv[3] ?? "report";

/** Well past where a ramped round should ever get. A run that hits it did not end. */
const CEILING = 4000;

interface Outcome {
  readonly pieces: number[];
  readonly scores: number[];
  readonly depths: number[];
  readonly stone: number[];
  readonly unfinished: number;
  readonly stalled: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[index]!;
}

function measure(size: string, pack: string, ramp: RampSpec, runs = RUNS): Outcome {
  const pieces: number[] = [];
  const scores: number[] = [];
  const depths: number[] = [];
  const stone: number[] = [];
  let unfinished = 0;
  let stalled = 0;

  for (let i = 0; i < runs; i++) {
    const game = createGame({
      seed: hashSeed(`ramp:${size}:${pack}:${i}`),
      mode: "endless",
      spec: sizeById(size as never).spec,
      pack: pack as never,
      ramp,
    });
    const result = playOut(game, CEILING);
    if (result.stalled) stalled++;
    if (!result.state.over) unfinished++;

    pieces.push(result.state.stats.piecesPlaced);
    scores.push(result.state.score);
    depths.push(depthAt(ramp, result.state.stats.piecesPlaced));
    stone.push(stoneCount(result.state.board));
  }

  pieces.sort((a, b) => a - b);
  scores.sort((a, b) => a - b);
  depths.sort((a, b) => a - b);
  stone.sort((a, b) => a - b);
  return { pieces, scores, depths, stone, unfinished, stalled };
}

function report(): void {
  console.log(`\nShiftle free play — ${RUNS} bot runs per setup, ceiling ${CEILING} pieces\n`);
  console.log(
    "disc      pack    ramp   ends   pieces p10/p50/p90        score p10/p50/p90            depth  stone",
  );
  console.log("-".repeat(112));

  for (const size of SIZES) {
    for (const pack of PACKS) {
      for (const [label, ramp] of [
        ["off", NO_RAMP],
        ["on", FREE_PLAY_RAMP],
      ] as const) {
        const o = measure(size.id, pack.id, ramp);
        const ends = `${Math.round(((RUNS - o.unfinished) / RUNS) * 100)}%`;
        const p = (xs: number[]) =>
          `${percentile(xs, 0.1)}/${percentile(xs, 0.5)}/${percentile(xs, 0.9)}`;
        console.log(
          size.id.padEnd(10) +
            pack.id.padEnd(8) +
            label.padEnd(7) +
            ends.padStart(5) +
            p(o.pieces).padStart(22) +
            p(o.scores).padStart(28) +
            String(percentile(o.depths, 0.5)).padStart(7) +
            String(percentile(o.stone, 0.5)).padStart(7),
        );
      }
    }
    console.log();
  }

  notes();
}

/**
 * The three things that would make the ramp wrong, stated as measurements
 * rather than as opinions about how it feels.
 */
function notes(): void {
  const all: { size: string; pack: string; o: Outcome }[] = [];
  for (const size of SIZES) {
    for (const pack of PACKS) {
      all.push({ size: size.id, pack: pack.id, o: measure(size.id, pack.id, FREE_PLAY_RAMP) });
    }
  }

  for (const { size, pack, o } of all) {
    if (o.unfinished > 0) {
      console.log(
        `${size}/${pack}: ${o.unfinished} of ${RUNS} rounds never ended — the ramp is not closing this one out`,
      );
    }
    const spread = percentile(o.scores, 0.9) / Math.max(1, percentile(o.scores, 0.1));
    if (spread < 2) {
      console.log(
        `${size}/${pack}: best and worst runs are within ${spread.toFixed(1)}x — too flat to rank`,
      );
    }
    if (percentile(o.pieces, 0.5) < 60) {
      console.log(`${size}/${pack}: median round is only ${percentile(o.pieces, 0.5)} pieces — brutal`);
    }
  }

  const medians = all.map(({ o }) => percentile(o.pieces, 0.5));
  console.log(
    `\nRound length across every setup: ${Math.min(...medians)}–${Math.max(...medians)} pieces (median run).`,
  );
}

/**
 * Candidate ramps, played on the two setups that behave least alike — chunks
 * kills you on its own, curves never did. A ramp has to work for both.
 */
function sweep(): void {
  const candidates: [string, RampSpec][] = [
    ["shipping", FREE_PLAY_RAMP],
    ["late stone", { ...FREE_PLAY_RAMP, stoneFrom: 3 }],
    ["slow depth", { ...FREE_PLAY_RAMP, piecesPerDepth: 30 }],
    ["slow+late", { ...FREE_PLAY_RAMP, piecesPerDepth: 30, stoneFrom: 3 }],
    ["sparse stone", { ...FREE_PLAY_RAMP, stoneEvery: 13 }],
    ["sparse+late", { ...FREE_PLAY_RAMP, stoneEvery: 13, stoneFrom: 3 }],
    ["gentlest", { ...FREE_PLAY_RAMP, piecesPerDepth: 28, stoneFrom: 3, stoneEvery: 13 }],
  ];


  console.log(`\nCandidate ramps — ${RUNS} runs each\n`);
  console.log("ramp          setup              ends   pieces p10/p50/p90     score p50    spread");
  console.log("-".repeat(88));

  for (const [label, ramp] of candidates) {
    for (const [size, pack] of [
      ["standard", "curves"],
      ["standard", "chunks"],
      ["large", "mixed"],
    ] as const) {
      const o = measure(size, pack, ramp);
      const spread = percentile(o.scores, 0.9) / Math.max(1, percentile(o.scores, 0.1));
      console.log(
        label.padEnd(14) +
          `${size}/${pack}`.padEnd(19) +
          `${Math.round(((RUNS - o.unfinished) / RUNS) * 100)}%`.padStart(5) +
          `${percentile(o.pieces, 0.1)}/${percentile(o.pieces, 0.5)}/${percentile(o.pieces, 0.9)}`.padStart(
            20,
          ) +
          String(percentile(o.scores, 0.5)).padStart(13) +
          `${spread.toFixed(1)}x`.padStart(10),
      );
    }
    console.log();
  }
}

if (MODE === "sweep") sweep();
else report();
