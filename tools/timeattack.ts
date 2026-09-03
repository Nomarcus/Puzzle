/**
 * What time attack actually feels like, per standard of play.
 *
 * Every other balance question in the game has a tool — `ramp`, `core`,
 * `levels`, `economy`. Time attack had only a model buried in a test, which is
 * enough to stop it regressing and not enough to *tune* it: the numbers that
 * shipped were read off a sweep that then went away, so the next person to
 * change them is back to guessing. This is that sweep, kept.
 *
 * The model is deliberately not the bot. The bot plays the board; this mode is
 * about how fast a person can think, and the thing worth modelling is a rate of
 * clearing rather than a search for the best move. So a "standard of play" is
 * two numbers — seconds between spokes, seconds between rings — and the five
 * below span from somebody who is struggling to somebody far beyond human.
 *
 * Four numbers come off every run, and they are the four the mode lives or dies
 * on:
 *
 * - **How long the round lasts.** Under a minute for an ordinary player is a
 *   mode that feels like a punishment rather than a contest.
 * - **The spread**, expert over struggling. This is what makes the leaderboard
 *   mean anything; a clock that kills everybody at the same time ends rounds
 *   without ranking them.
 * - **Time spent under ten seconds**, which is where the mode gets its tension.
 *   Too little and it is placid, too much and it is nothing but panic.
 * - **Seconds thrown away at the cap.** A clear that pays nothing because the
 *   clock is already full is the one failure this mode cannot have — it is the
 *   bug that shipped in an early version and made the first twenty seconds of
 *   every round ignore the player.
 *
 * Run with `npm run timeattack`.
 */

import { TIME_ATTACK, type ClockSpec, addTime, drainRate, timeBonus } from "../src/engine/timeattack.js";
import type { MoveEvents } from "../src/engine/game.js";

/** The shape `timeBonus` reads. Nothing else about a move matters here. */
function move(rings: number[], spokes: number[], stripes = 0, sweep = false): MoveEvents {
  return {
    placed: true,
    cleared: rings.length + spokes.length,
    clears: { rings, spokes },
    stripesFired: stripes,
    sweep,
    combo: 1,
    scored: 0,
    pure: false,
  } as unknown as MoveEvents;
}

interface Standard {
  readonly name: string;
  /** Seconds between clearing a spoke, and between clearing a ring. */
  readonly spokeEvery: number;
  readonly ringEvery: number;
}

/**
 * Five rates of play, from struggling to far beyond human.
 *
 * These are the same five the shipped numbers were set against, so a change can
 * be compared with what it replaced rather than only judged on its own.
 */
const STANDARDS: readonly Standard[] = [
  { name: "struggling", spokeEvery: 8, ringEvery: 60 },
  { name: "ok", spokeEvery: 5.5, ringEvery: 40 },
  { name: "good", spokeEvery: 3.5, ringEvery: 25 },
  { name: "strong", spokeEvery: 2.5, ringEvery: 16 },
  { name: "expert", spokeEvery: 2, ringEvery: 12 },
];

interface Run {
  /** How long the round lasted, in seconds. */
  readonly lasted: number;
  /** Share of the round spent under ten seconds on the clock. */
  readonly tense: number;
  /** Seconds of earned time thrown away because the clock was already full. */
  readonly wasted: number;
}

function play(spec: ClockSpec, standard: Standard): Run {
  const step = 0.05;
  let left = spec.seconds;
  let elapsed = 0;
  let tense = 0;
  let wasted = 0;
  let nextSpoke = standard.spokeEvery;
  let nextRing = standard.ringEvery;

  const earn = (bonus: number): void => {
    const after = addTime(spec, left, bonus);
    wasted += bonus - (after - left);
    left = after;
  };
  const spokeBonus = timeBonus(move([], [1]), spec);
  const ringBonus = timeBonus(move([1], []), spec);

  // An hour is far past any real round; it is here so a spec that cannot end
  // reports as a plateau rather than hanging the tool.
  while (left > 0 && elapsed < 3600) {
    left -= step * drainRate(spec, elapsed);
    elapsed += step;
    if (left < 10) tense += step;
    if (elapsed >= nextSpoke) {
      earn(spokeBonus);
      nextSpoke += standard.spokeEvery;
    }
    if (elapsed >= nextRing) {
      earn(ringBonus);
      nextRing += standard.ringEvery;
    }
  }
  return { lasted: elapsed, tense: tense / elapsed, wasted };
}

function report(label: string, spec: ClockSpec): void {
  const runs = STANDARDS.map((s) => ({ standard: s, run: play(spec, s) }));
  const first = runs[0]!.run.lasted;
  const last = runs[runs.length - 1]!.run.lasted;

  console.log(`\n${label}`);
  console.log(
    `  open ${spec.seconds}s · drain +${spec.drainStep} every ${spec.drainEvery}s · ` +
      `spoke ${spec.spoke}s ring ${spec.ring}s sweep ${spec.sweep}s stripe ${spec.stripe}s`,
  );
  console.log("  standard      lasts     under 10s   wasted");
  for (const { standard, run } of runs) {
    const forever = run.lasted >= 3600 ? "  NEVER ENDS" : "";
    console.log(
      `  ${standard.name.padEnd(12)} ${`${run.lasted.toFixed(0)}s`.padStart(6)}` +
        `${`${(run.tense * 100).toFixed(0)}%`.padStart(11)}` +
        `${`${run.wasted.toFixed(0)}s`.padStart(9)}${forever}`,
    );
  }
  console.log(`  spread expert/struggling: ${(last / first).toFixed(1)}x`);
}

report("shipping", TIME_ATTACK);

// Candidates. The ask is "more time back when you clear, it is too hard", so
// the payouts move first, and the cap only where the payouts alone cannot help
// — a bigger refill is thrown away if the clock is already full, which is what
// the "wasted" column is there to catch.
// The property a bigger payout puts most at risk, so it is checked where the
// change is made rather than only in a test: a rate of clearing far past human
// still has to run out. If this ever prints NEVER ENDS the mode has become a
// treadmill and the leaderboard ranks patience again.
report("superhuman — must still end", TIME_ATTACK);
console.log(
  `  a spoke every second and a ring every five: ` +
    `${play(TIME_ATTACK, { name: "superhuman", spokeEvery: 1, ringEvery: 5 }).lasted.toFixed(0)}s`,
);

const payouts = {
  "+33%": { spoke: 2, ring: 5.5, sweep: 10, stripe: 1.5 },
  "+50%": { spoke: 2.25, ring: 6, sweep: 12, stripe: 1.5 },
  "+66%": { spoke: 2.5, ring: 6.5, sweep: 13, stripe: 1.5 },
};

for (const [label, pay] of Object.entries(payouts)) {
  for (const seconds of [45, 50, 55]) {
    report(`payouts ${label}, cap ${seconds}`, { ...TIME_ATTACK, ...pay, seconds });
  }
}
