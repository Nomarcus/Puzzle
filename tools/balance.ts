/**
 * Balance measurements.
 *
 * Plays seeded games with the greedy bot across every disc and pack and prints
 * how long rounds last and what they score. The point is to answer "how long
 * can you keep going" and "is this luck or skill" with numbers instead of
 * opinions.
 *
 * Run: npx vite-node tools/balance.ts [gamesPerCombination]
 */

import { playOut } from "../src/engine/bot.js";
import { createGame } from "../src/engine/game.js";
import { hashSeed } from "../src/engine/rng.js";
import { PACKS, SIZES, type PackId, type SizeId } from "../src/engine/variants.js";

const GAMES = Number(process.argv[2] ?? 120);

interface Row {
  size: SizeId;
  pack: PackId;
  placements: number[];
  scores: number[];
  rings: number[];
  spokes: number[];
  spinsUsed: number[];
  stalled: number;
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[index]!;
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

function run(size: SizeId, pack: PackId): Row {
  const row: Row = {
    size,
    pack,
    placements: [],
    scores: [],
    rings: [],
    spokes: [],
    spinsUsed: [],
    stalled: 0,
  };

  const spec = SIZES.find((entry) => entry.id === size)!.spec;
  for (let game = 0; game < GAMES; game++) {
    const seed = hashSeed(`balance:${size}:${pack}:${game}`);
    const result = playOut(createGame({ seed, spec, pack }));
    row.placements.push(result.state.stats.piecesPlaced);
    row.scores.push(result.state.score);
    row.rings.push(result.state.stats.ringsCleared);
    row.spokes.push(result.state.stats.spokesCleared);
    row.spinsUsed.push(result.state.stats.spinsUsed);
    if (result.stalled) row.stalled++;
  }
  return row;
}

const pad = (text: string, width: number) => text.padEnd(width);
const num = (value: number, width = 7) =>
  (Math.round(value * 10) / 10).toLocaleString("en-GB").padStart(width);

console.log(`Shiftle balance — ${GAMES} bot games per combination\n`);
console.log(
  pad("disc", 10) +
    pad("pack", 9) +
    num("placed p50".length ? 0 : 0, 0) +
    ["placed", "p10", "p90", "score", "p10", "p90", "rings", "spokes", "spins"]
      .map((h) => h.padStart(8))
      .join(""),
);
console.log("-".repeat(91));

const rows: Row[] = [];
for (const size of SIZES) {
  for (const pack of PACKS) {
    const row = run(size.id, pack.id);
    rows.push(row);
    console.log(
      pad(row.size, 10) +
        pad(row.pack, 9) +
        num(quantile(row.placements, 0.5), 8) +
        num(quantile(row.placements, 0.1), 8) +
        num(quantile(row.placements, 0.9), 8) +
        num(quantile(row.scores, 0.5), 8) +
        num(quantile(row.scores, 0.1), 8) +
        num(quantile(row.scores, 0.9), 8) +
        num(mean(row.rings), 8) +
        num(mean(row.spokes), 8) +
        num(mean(row.spinsUsed), 8),
    );
  }
}

const allPlacements = rows.flatMap((row) => row.placements);
const allScores = rows.flatMap((row) => row.scores);
const shortRuns = allPlacements.filter((n) => n < 15).length;

console.log("\nAcross every combination:");
console.log(`  median placements   ${quantile(allPlacements, 0.5)}`);
console.log(`  median score        ${quantile(allScores, 0.5)}`);
console.log(
  `  spread p10..p90     ${quantile(allScores, 0.1)} .. ${quantile(allScores, 0.9)}` +
    `  (ratio ${(quantile(allScores, 0.9) / Math.max(1, quantile(allScores, 0.1))).toFixed(1)}x)`,
);
console.log(
  `  rounds under 15 pieces  ${shortRuns} of ${allPlacements.length}` +
    `  (${((shortRuns / allPlacements.length) * 100).toFixed(1)}%)`,
);
console.log(`  bot stalled             ${rows.reduce((n, row) => n + row.stalled, 0)}`);
