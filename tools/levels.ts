/**
 * Are the levels any good?
 *
 * Twenty hand-written targets is twenty guesses, and a guessed target is how
 * you ship a level that is trivial or impossible. This plays each one with the
 * bot a few hundred times and reports what it actually achieves.
 *
 * The bot is a weak player: one move deep, and it only spends a spin or a push
 * when nothing fits. So its numbers are a floor. A target it clears comfortably
 * is one a person will find easy; a target it clears sometimes is a real
 * challenge; a target it never reaches is either a level about something the
 * bot cannot do — combos and bullseyes need setting up — or a mistake.
 *
 * Run: npx vite-node tools/levels.ts [runs]
 */

import { BOT_POLICY_LEVELS, playOut } from "../src/engine/bot.js";
import { createGame } from "../src/engine/game.js";
import { LEVELS, type Level, goalProgress, levelBoard,
  levelCore, levelSeed } from "../src/engine/levels.js";
import { hashSeed } from "../src/engine/rng.js";
import { sizeById } from "../src/engine/variants.js";

const RUNS = Number(process.argv[2] ?? 200);

interface Outcome {
  readonly level: Level;
  /** How often the bot met the goal. */
  /** Pieces the bot placed on the level's own seed — the deal players get. */
  readonly shipped: number;
  readonly winRate: number;
  /** The spread of what it reached. Targets are placed against these. */
  readonly p10: number;
  readonly median: number;
  readonly p75: number;
  readonly best: number;
  readonly target: number;
  /** How much of the budget it actually spent. */
  readonly medianPieces: number;
  /** Rounds that ended before the budget ran out — stuck, not out of pieces. */
  readonly stuckRate: number;
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
}

const median = (values: number[]) => quantile(values, 0.5);

function measure(level: Level): Outcome {
  const spec = sizeById(level.size).spec;
  const reached: number[] = [];
  const pieces: number[] = [];
  let wins = 0;
  let stuck = 0;
  let shipped = 0;

  for (let run = 0; run < RUNS; run++) {
    // The level's own seed decides the sequence, but a level is only worth
    // shipping if it survives more than one line of play — so the bot is
    // nudged onto different routes through the same deal.
    const state = createGame({
      seed: run === 0 ? levelSeed(level) : hashSeed(`level:${level.number}:${run}`),
      mode: "level",
      spec,
      pack: level.pack,
      board: levelBoard(level),
      core: levelCore(level),
      rules: { ...level.rules, pieceLimit: level.budget },
    });

    const result = playOut(state, level.budget * 4, BOT_POLICY_LEVELS);
    const progress = goalProgress(level.goal, result.state);
    reached.push(progress.done);
    pieces.push(result.state.stats.piecesPlaced);
    if (progress.met) wins++;
    if (result.state.stats.piecesPlaced < level.budget) stuck++;
    // Run zero is the deal every player actually gets. Averaging across seeds
    // is the right question for a pattern and the wrong one for a shipped
    // level, and this column exists because that difference hid a level whose
    // real deal died on piece eight of forty-two.
    if (run === 0) shipped = result.state.stats.piecesPlaced;
  }

  return {
    level,
    shipped,
    winRate: wins / RUNS,
    p10: quantile(reached, 0.1),
    median: median(reached),
    p75: quantile(reached, 0.75),
    best: Math.max(...reached),
    target: level.goal.target,
    medianPieces: median(pieces),
    stuckRate: stuck / RUNS,
  };
}

console.log(`Shiftle levels — ${RUNS} bot runs each\n`);
console.log(
  "lvl  disc      pack    pattern     goal          target    bot p10   bot p50   bot p75   best   win%   pieces  stuck%   shipped",
);
console.log("-".repeat(120));

const outcomes = LEVELS.map(measure);

for (const o of outcomes) {
  const l = o.level;
  console.log(
    String(l.number).padStart(3) +
      "  " +
      l.size.padEnd(10) +
      l.pack.padEnd(8) +
      l.pattern.padEnd(12) +
      l.goal.kind.padEnd(10) +
      String(o.target).padStart(8) +
      String(o.p10).padStart(11) +
      String(o.median).padStart(10) +
      String(o.p75).padStart(10) +
      String(o.best).padStart(7) +
      `${Math.round(o.winRate * 100)}%`.padStart(7) +
      `${o.medianPieces}/${l.budget}`.padStart(9) +
      `${Math.round(o.stuckRate * 100)}%`.padStart(8) +
      `${o.shipped}/${l.budget}`.padStart(10),
  );
}

// --- what to fix ------------------------------------------------------------
const notes: string[] = [];
for (const o of outcomes) {
  const n = o.level.number;
  // The deal every player actually gets, checked on its own. levelSeed() vets
  // it, so this failing means the vetting could not find a workable seed.
  if (o.shipped < o.level.budget * 0.7) {
    notes.push(
      `L${n}: the shipped seed only reaches ${o.shipped}/${o.level.budget} pieces — that deal is broken for everyone`,
    );
  }
  // Goals that need planning ahead. The bot is one move deep and does not set
  // anything up, so a low win rate on these says more about the bot than the
  // level — what matters is whether it ever gets there at all.
  const soft =
    o.level.goal.kind === "combo" ||
    o.level.goal.kind === "bullseye" ||
    o.level.goal.kind === "pure";

  if (o.winRate > 0.9 && n > 4) {
    notes.push(`L${n}: the bot wins ${Math.round(o.winRate * 100)}% — too easy, raise the target`);
  }
  if (o.winRate < 0.05 && !soft) {
    notes.push(
      `L${n}: the bot never wins (best ${o.best} of ${o.target}) — likely impossible, lower it`,
    );
  }
  if (soft && o.best >= o.target && o.winRate < 0.05) {
    notes.push(
      `L${n}: bot reaches ${o.target} but only ${Math.round(o.winRate * 100)}% of the time — a planning goal, which is the point`,
    );
  }
  if (soft && o.best < o.target) {
    notes.push(
      `L${n}: bot best ${o.best} of ${o.target}, but ${o.level.goal.kind} needs setting up — needs a human to confirm`,
    );
  }
  if (o.stuckRate > 0.35) {
    notes.push(
      `L${n}: stuck rather than out of pieces in ${Math.round(o.stuckRate * 100)}% — the pattern may be strangling it`,
    );
  }
}

console.log("\n" + (notes.length ? notes.join("\n") : "Nothing obviously wrong."));

const teachable = outcomes.filter((o) => o.level.number <= 4);
console.log(
  `\nThe first four should be gentle: bot wins ${teachable
    .map((o) => `${Math.round(o.winRate * 100)}%`)
    .join(", ")}`,
);
