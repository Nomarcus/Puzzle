/**
 * Spin economy sweep.
 *
 * The first balance run showed rounds that never end. The cause is not the
 * board — it is that a spin is earned every two clears while spokes clear
 * constantly, so the player always has an escape banked and "no room left"
 * never arrives. This sweeps where spins come from and how much they cost.
 *
 * Run: npx vite-node tools/economy.ts [games]
 */

import { playOut } from "../src/engine/bot.js";
import { createGame, type RuleSet } from "../src/engine/game.js";
import { hashSeed } from "../src/engine/rng.js";

const GAMES = Number(process.argv[2] ?? 40);
const SPEC = { rings: 6, sectors: 9 };

const CANDIDATES: Array<Partial<RuleSet>> = [
  { spinSource: "any", clearsPerSpin: 2, maxSpins: 3 },
  { spinSource: "any", clearsPerSpin: 6, maxSpins: 3 },
  { spinSource: "any", clearsPerSpin: 12, maxSpins: 3 },
  { spinSource: "rings", clearsPerSpin: 1, maxSpins: 3 },
  { spinSource: "rings", clearsPerSpin: 2, maxSpins: 3 },
  { spinSource: "rings", clearsPerSpin: 2, maxSpins: 2 },
  { spinSource: "rings", clearsPerSpin: 3, maxSpins: 3 },
];

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};
const pct = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
};
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

console.log(`Spin economy on a ${SPEC.rings}x${SPEC.sectors} disc — ${GAMES} bot games each\n`);
console.log(
  "source".padEnd(8) +
    "per".padEnd(5) +
    "cap".padEnd(5) +
    ["placed", "p90", "capped", "rings", "spins", "score"].map((h) => h.padStart(9)).join(""),
);
console.log("-".repeat(77));

for (const rules of CANDIDATES) {
  const placed: number[] = [];
  const rings: number[] = [];
  const spins: number[] = [];
  const scores: number[] = [];
  let capped = 0;

  for (let game = 0; game < GAMES; game++) {
    const seed = hashSeed(`eco:${JSON.stringify(rules)}:${game}`);
    const result = playOut(createGame({ seed, spec: SPEC, pack: "mixed", rules }), 400);
    placed.push(result.state.stats.piecesPlaced);
    rings.push(result.state.stats.ringsCleared);
    spins.push(result.state.stats.spinsUsed);
    scores.push(result.state.score);
    if (result.turns >= 400) capped++;
  }

  console.log(
    String(rules.spinSource).padEnd(8) +
      String(rules.clearsPerSpin).padEnd(5) +
      String(rules.maxSpins).padEnd(5) +
      String(median(placed)).padStart(9) +
      String(pct(placed, 0.9)).padStart(9) +
      `${capped}/${GAMES}`.padStart(9) +
      mean(rings).toFixed(1).padStart(9) +
      mean(spins).toFixed(1).padStart(9) +
      Math.round(median(scores)).toLocaleString("en-GB").padStart(9),
  );
}
