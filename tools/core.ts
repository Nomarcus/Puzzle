/**
 * How strong should the core be?
 *
 * Two numbers decide it: how much clearing fills it, and what a firing pays.
 * Both were wrong on the first pass and the bot said so — at twelve capacity
 * and a generous payout, free play's score spread collapsed from four- to
 * eightfold down to about 1.5x, because everybody fires roughly the same
 * number of cores and the cores were most of the score. A mechanic that
 * homogenises outcomes is worse than no mechanic at all on a game whose point
 * is a leaderboard.
 *
 * So this reads four numbers off each candidate: do rounds still end, how long
 * are they, how many cores get fired, and — the one that matters — how far
 * apart are a bad run and a good one.
 *
 *   npx vite-node tools/core.ts [runs]
 */

import { createGame } from "../src/engine/game.js";
import { type CoreSpec, DEFAULT_CORE, NO_CORE } from "../src/engine/core.js";
import { FREE_PLAY_RAMP } from "../src/engine/ramp.js";
import { BOT_POLICY_V2, playOut } from "../src/engine/bot.js";
import { sizeById } from "../src/engine/variants.js";
import { hashSeed } from "../src/engine/rng.js";

const RUNS = Number(process.argv[2] ?? 12);
const CEILING = 3000;

const SETUPS = [
  ["standard", "mixed"],
  ["standard", "curves"],
  ["large", "chunks"],
] as const;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!;
}

function measure(core: CoreSpec) {
  const pieces: number[] = [];
  const scores: number[] = [];
  const cores: number[] = [];
  let unfinished = 0;

  for (const [size, pack] of SETUPS) {
    for (let i = 0; i < RUNS; i++) {
      const game = createGame({
        seed: hashSeed(`core:${size}:${pack}:${i}`),
        mode: "endless",
        spec: sizeById(size).spec,
        pack,
        ramp: FREE_PLAY_RAMP,
        core,
      });
      const result = playOut(game, CEILING, BOT_POLICY_V2);
      if (!result.state.over) unfinished++;
      pieces.push(result.state.stats.piecesPlaced);
      scores.push(result.state.score);
      cores.push(result.state.stats.coresFired);
    }
  }

  pieces.sort((a, b) => a - b);
  scores.sort((a, b) => a - b);
  cores.sort((a, b) => a - b);

  const total = RUNS * SETUPS.length;
  return {
    ends: (total - unfinished) / total,
    pieces: percentile(pieces, 0.5),
    score: percentile(scores, 0.5),
    spread: percentile(scores, 0.9) / Math.max(1, percentile(scores, 0.1)),
    fired: percentile(cores, 0.5),
    every: percentile(cores, 0.5) > 0 ? percentile(pieces, 0.5) / percentile(cores, 0.5) : Infinity,
  };
}

const CANDIDATES: [string, CoreSpec][] = [
  ["no core", NO_CORE],
  ["cap 12 / 110", { ...DEFAULT_CORE, capacity: 12, perCellScore: 110 }],
  ["cap 18 / 80", { ...DEFAULT_CORE, capacity: 18, perCellScore: 80 }],
  ["cap 26 / 55", { ...DEFAULT_CORE, capacity: 26, perCellScore: 55 }],
  ["cap 26 / 30", { ...DEFAULT_CORE, capacity: 26, perCellScore: 30 }],
  ["cap 34 / 55", { ...DEFAULT_CORE, capacity: 34, perCellScore: 55 }],
  ["cap 34 / 30", { ...DEFAULT_CORE, capacity: 34, perCellScore: 30 }],
];

console.log(`\nThe core — ${RUNS} bot runs on each of three setups\n`);
console.log("candidate        ends   median pieces   median score   spread   cores   one every");
console.log("-".repeat(86));

for (const [label, core] of CANDIDATES) {
  const o = measure(core);
  console.log(
    label.padEnd(17) +
      `${Math.round(o.ends * 100)}%`.padStart(5) +
      String(o.pieces).padStart(16) +
      String(o.score).padStart(15) +
      `${o.spread.toFixed(1)}x`.padStart(9) +
      String(o.fired).padStart(8) +
      (Number.isFinite(o.every) ? `${Math.round(o.every)} pcs` : "never").padStart(12),
  );
}

console.log(
  "\nWanted: rounds still end, a spread above 3x, and a core every 60-100 pieces —\nthe mechanic should be an event, not the thing that decides the round.",
);
