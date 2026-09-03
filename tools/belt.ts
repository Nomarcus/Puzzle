/**
 * How long the belt lasts, per rate of placement.
 *
 * Same shape as `npm run timeattack`, and for the same reason: this mode is
 * tuned on a rate a person can sustain rather than on how well a bot searches
 * the board, so what is modelled is "a piece every N seconds" rather than a
 * game. The bot cannot help here — it plays instantly, and instant play beats
 * any belt.
 *
 * Four numbers come off each run:
 *
 * - **How long the round lasts.** Under a minute is a mode nobody plays twice.
 * - **How many pieces you got down**, which is what the score will be made of.
 * - **When the first stone landed** — the moment the mode starts telling you
 *   you are behind. Too early and it feels unfair, too late and the ending
 *   arrives with no warning.
 * - **How much stone you drowned in**, as a sanity check that the ending comes
 *   from falling behind rather than from a board that filled up on its own.
 *
 * Run with `npm run belt`.
 */

import { BELT, type BeltSpec, beltInterval } from "../src/engine/belt.js";

interface Standard {
  readonly name: string;
  /** Seconds a player takes to place one piece, sustained. */
  readonly placeEvery: number;
}

/**
 * Rates of placement, from someone thinking about every piece to someone
 * playing faster than is plausible for long.
 *
 * Anchored on time attack's own model: an "ok" player there clears a spoke
 * every 5.5 seconds, and a placement is a good deal quicker than a clear, so
 * ordinary sustained play sits somewhere around two to three seconds a piece.
 */
const STANDARDS: readonly Standard[] = [
  { name: "thinking", placeEvery: 4 },
  { name: "steady", placeEvery: 3 },
  { name: "ok", placeEvery: 2.4 },
  { name: "quick", placeEvery: 1.8 },
  { name: "flying", placeEvery: 1.2 },
];

interface Run {
  readonly lasted: number;
  readonly placed: number;
  readonly firstStone: number | null;
  readonly stones: number;
}

/**
 * Plays the belt at a fixed rate of placement.
 *
 * The tray holds three. A piece arriving with all three full is an overflow and
 * drops a stone; the round ends once the board has taken more stone than it can
 * carry. `stoneBudget` stands in for "the disc is now unplayable" — the real
 * ending is the ordinary one (nothing fits, no spin, no push), which needs a
 * board and is covered by the engine tests rather than modelled here.
 */
function play(spec: BeltSpec, standard: Standard, stoneBudget = 12): Run {
  const step = 0.05;
  let elapsed = 0;
  // The belt starts with **one** piece, not the usual full tray of three.
  // Modelled with a full tray the very first arrival overflows and every
  // ordinary player takes a stone three seconds into the round, before they
  // have done anything at all — the tray is the belt here, and a belt that
  // starts at capacity has no room to deliver into.
  let held = 1;
  let placed = 0;
  let stones = 0;
  let firstStone: number | null = null;
  let nextArrival = beltInterval(spec, 0);
  let nextPlace = standard.placeEvery;

  while (stones < stoneBudget && elapsed < 3600) {
    elapsed += step;

    if (elapsed >= nextArrival) {
      if (held >= 3) {
        stones += 1;
        if (firstStone === null) firstStone = elapsed;
      } else {
        held += 1;
      }
      nextArrival = elapsed + beltInterval(spec, elapsed);
    }

    if (elapsed >= nextPlace) {
      // Nothing to place is not a stall you can act on — the belt owes you a
      // piece — so the player simply waits for the next arrival.
      if (held > 0) {
        held -= 1;
        placed += 1;
      }
      nextPlace = elapsed + standard.placeEvery;
    }
  }
  return { lasted: elapsed, placed, firstStone, stones };
}

function report(label: string, spec: BeltSpec): void {
  console.log(`\n${label}`);
  console.log(
    `  opens every ${spec.opening}s · +${spec.step} of a gear every ${spec.every}s · ` +
      `at 2min the gap is ${beltInterval(spec, 120).toFixed(2)}s`,
  );
  console.log("  standard      lasts    pieces   1st stone");
  for (const standard of STANDARDS) {
    const run = play(spec, standard);
    const forever = run.lasted >= 3600 ? "  NEVER ENDS" : "";
    console.log(
      `  ${standard.name.padEnd(12)} ${`${run.lasted.toFixed(0)}s`.padStart(6)}` +
        `${String(run.placed).padStart(10)}` +
        `${(run.firstStone === null ? "never" : `${run.firstStone.toFixed(0)}s`).padStart(12)}` +
        forever,
    );
  }
  const runs = STANDARDS.map((s) => play(spec, s));
  console.log(
    `  spread flying/thinking: ${(runs[runs.length - 1]!.placed / runs[0]!.placed).toFixed(1)}x pieces`,
  );
}

report("shipping", BELT);
for (const opening of [2.5, 3, 3.5]) {
  for (const every of [25, 30, 40]) {
    if (opening === BELT.opening && every === BELT.every) continue;
    report(`opens ${opening}s, gear every ${every}s`, { ...BELT, opening, every });
  }
}
