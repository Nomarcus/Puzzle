/**
 * Does free play ever actually end?
 *
 * The balance sweep caps at 600 placements, and once the bot knew how to spend
 * a push almost every combination started reaching that cap — which tells us
 * nothing except that 600 is a big number. This lifts the cap a long way and
 * asks the question the cap was hiding: is a competent player ever forced to
 * stop, or does the score just keep climbing for as long as they sit there?
 *
 * That matters for the leaderboard. A mode with no failure state ranks
 * patience, not skill.
 *
 * Run: npx vite-node tools/endless.ts [games] [cap]
 */

import { playOut } from "../src/engine/bot.js";
import { createGame } from "../src/engine/game.js";
import { hashSeed } from "../src/engine/rng.js";
import { PACKS, SIZES } from "../src/engine/variants.js";

const GAMES = Number(process.argv[2] ?? 12);
const CAP = Number(process.argv[3] ?? 6000);

console.log(`Shiftle — does free play end? ${GAMES} games per combination, cap ${CAP}\n`);
console.log(
  "disc     pack     ended    shortest   median  mean score".replace(/ +/g, (m) => m),
);
console.log("-".repeat(62));

let endedTotal = 0;
let gamesTotal = 0;

for (const size of SIZES) {
  for (const pack of PACKS) {
    let ended = 0;
    let score = 0;
    const lengths: number[] = [];

    for (let game = 0; game < GAMES; game++) {
      const seed = hashSeed(`endless:${size.id}:${pack.id}:${game}`);
      const result = playOut(createGame({ seed, spec: size.spec, pack: pack.id }), CAP);
      lengths.push(result.state.stats.piecesPlaced);
      score += result.state.score;
      if (result.state.over) ended++;
      // Should be unreachable: the bot stopping while a legal move exists
      // measures the bot, not the game.
      if (result.stalled) console.log(`  !! stalled: ${size.id}/${pack.id} game ${game}`);
    }

    endedTotal += ended;
    gamesTotal += GAMES;
    const sorted = [...lengths].sort((a, b) => a - b);
    console.log(
      size.id.padEnd(9) +
        pack.id.padEnd(9) +
        `${ended}/${GAMES}`.padStart(5) +
        String(sorted[0]).padStart(12) +
        String(sorted[GAMES >> 1]).padStart(9) +
        Math.round(score / GAMES).toLocaleString("en-GB").padStart(12),
    );
  }
}

console.log(
  `\n${endedTotal} of ${gamesTotal} rounds ended on their own ` +
    `(${Math.round((endedTotal / gamesTotal) * 100)}%). ` +
    `The rest were still going at ${CAP} pieces.`,
);
