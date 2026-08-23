/**
 * Board-shape experiment.
 *
 * A spoke is as long as the disc has rings and a ring is as long as it has
 * sectors, so 5x12 makes a spoke less than half the work of a ring. This
 * sweeps candidate shapes, with and without spoke clears, to find a setup
 * where rounds actually end, rings actually pop, and spins actually matter.
 *
 * Run: npx vite-node tools/experiment.ts [games]
 */

import { playOut } from "../src/engine/bot.js";
import { createGame } from "../src/engine/game.js";
import { hashSeed } from "../src/engine/rng.js";

const GAMES = Number(process.argv[2] ?? 40);

const CANDIDATES: Array<{ rings: number; sectors: number; spokes: boolean }> = [
  { rings: 5, sectors: 12, spokes: true }, // today, for reference
  { rings: 4, sectors: 8, spokes: false },
  { rings: 4, sectors: 9, spokes: false },
  { rings: 4, sectors: 10, spokes: false },
  { rings: 5, sectors: 8, spokes: false },
  { rings: 5, sectors: 9, spokes: false },
  { rings: 5, sectors: 10, spokes: false },
  { rings: 6, sectors: 8, spokes: false },
  { rings: 6, sectors: 9, spokes: false },
  { rings: 6, sectors: 10, spokes: false },
  { rings: 7, sectors: 9, spokes: false },
];

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

console.log(`Board shapes — ${GAMES} bot games each, mixed pack\n`);
console.log(
  "shape".padEnd(9) +
    "spokes".padEnd(8) +
    ["cells", "placed", "p90", "rings", "spokes", "spins", "score"].map((h) => h.padStart(9)).join(""),
);
console.log("-".repeat(80));

for (const candidate of CANDIDATES) {
  const spec = { rings: candidate.rings, sectors: candidate.sectors };
  const placed: number[] = [];
  const rings: number[] = [];
  const spokes: number[] = [];
  const spins: number[] = [];
  const scores: number[] = [];

  for (let game = 0; game < GAMES; game++) {
    const seed = hashSeed(`exp:${candidate.rings}x${candidate.sectors}:${candidate.spokes}:${game}`);
    const result = playOut(createGame({ seed, spec, pack: "mixed", spokeClears: candidate.spokes }), 400);
    placed.push(result.state.stats.piecesPlaced);
    rings.push(result.state.stats.ringsCleared);
    spokes.push(result.state.stats.spokesCleared);
    spins.push(result.state.stats.spinsUsed);
    scores.push(result.state.score);
  }

  const sorted = [...placed].sort((a, b) => a - b);
  console.log(
    `${candidate.rings}x${candidate.sectors}`.padEnd(9) +
      (candidate.spokes ? "on" : "off").padEnd(8) +
      String(candidate.rings * candidate.sectors).padStart(9) +
      String(median(placed)).padStart(9) +
      String(sorted[Math.floor(sorted.length * 0.9)]!).padStart(9) +
      mean(rings).toFixed(1).padStart(9) +
      mean(spokes).toFixed(1).padStart(9) +
      mean(spins).toFixed(1).padStart(9) +
      Math.round(median(scores)).toLocaleString("en-GB").padStart(9),
  );
}
