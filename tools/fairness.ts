/**
 * Does the deal decide the round, or does the player?
 *
 * Measures the short-round tail with blind dealing against the adaptive deal,
 * and times the daily seed vetting to make sure it can run at launch.
 *
 * Run: npx vite-node tools/fairness.ts [games]
 */

import { playOut } from "../src/engine/bot.js";
import { createGame } from "../src/engine/game.js";
import { hashSeed } from "../src/engine/rng.js";
import { dailyPuzzle } from "../src/engine/daily.js";
import { SIZES, PACKS } from "../src/engine/variants.js";

const GAMES = Number(process.argv[2] ?? 120);

const quantile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))]!;
};

function sample(fairDeal: boolean) {
  const placements: number[] = [];
  const scores: number[] = [];

  for (const size of SIZES) {
    for (const pack of PACKS) {
      for (let game = 0; game < GAMES; game++) {
        const seed = hashSeed(`fair:${size.id}:${pack.id}:${game}`);
        const result = playOut(
          createGame({ seed, spec: size.spec, pack: pack.id, fairDeal }),
          400,
        );
        placements.push(result.state.stats.piecesPlaced);
        scores.push(result.state.score);
      }
    }
  }
  return { placements, scores };
}

console.log(`Fairness — ${GAMES} bot games per combination\n`);
console.log("deal".padEnd(10) + ["p10", "p50", "p90", "<15", "score p50"].map((h) => h.padStart(11)).join(""));
console.log("-".repeat(65));

for (const fairDeal of [false, true]) {
  const { placements, scores } = sample(fairDeal);
  const short = placements.filter((n) => n < 15).length;
  console.log(
    (fairDeal ? "adaptive" : "blind").padEnd(10) +
      String(quantile(placements, 0.1)).padStart(11) +
      String(quantile(placements, 0.5)).padStart(11) +
      String(quantile(placements, 0.9)).padStart(11) +
      `${((short / placements.length) * 100).toFixed(1)}%`.padStart(11) +
      Math.round(quantile(scores, 0.5)).toLocaleString("en-GB").padStart(11),
  );
}

// --- daily vetting ---------------------------------------------------------
console.log("\nDaily seed vetting over the next 60 days:");
let reseeded = 0;
let worst = Infinity;
const started = Date.now();

for (let day = 0; day < 60; day++) {
  const date = new Date(Date.UTC(2026, 7, 23 + day));
  const puzzle = dailyPuzzle(date);
  if (puzzle.seed !== hashSeed(`shiftle:${date.toISOString().slice(0, 10)}`)) reseeded++;
  worst = Math.min(worst, puzzle.botPlacements);
}

const elapsed = Date.now() - started;
console.log(`  days needing a reseed   ${reseeded} of 60`);
console.log(`  worst bot round kept    ${worst} pieces`);
console.log(`  cost per day            ${(elapsed / 60).toFixed(0)} ms`);
