/**
 * Mastery goals: three to choose from, one at a time.
 *
 * A chosen goal is not the same thing as an assigned one. The player picks
 * which of three they want, which means a goal is never a demand — it is a way
 * of saying "this is what I feel like doing next", and picking nothing is a
 * perfectly good answer.
 *
 * ## The rules these obey, and why
 *
 * - **Deterministic and offline.** The trio comes from a hash of the round
 *   number, so it needs no clock, no server and no stored list.
 * - **Nothing expires.** The round number advances when a goal is *completed*,
 *   never with the date. A goal that vanished overnight would punish somebody
 *   for having a life, and it is the exact mechanic the brief rules out.
 * - **Never a reason to play badly.** Every goal is something a player wants to
 *   do anyway — go deeper, clear more, fire the core. There is no "score under
 *   X" or "avoid using a spin", because a goal that fights the game is a goal
 *   that makes the game worse.
 * - **Never impossible for the board in front of you.** Each goal names the
 *   modes it can be met in, and progress is only read from those.
 * - **Progress only ever goes up.** A bad round cannot undo what a good one
 *   showed, so a goal is a thing you chip away at rather than a thing you can
 *   lose.
 *
 * ## The reward, and what it deliberately is not
 *
 * Completing a goal adds a small amount to the **existing lifetime total** — the
 * one currency the game already has. It does not create a second currency, it
 * does not touch the round's score, and it never reaches Game Center. A
 * free-play round is worth roughly 100,000 lifetime on measured play, so the
 * bonus below is about a twentieth of one round: enough to feel like something,
 * far too little to be a better way of earning than playing.
 */

import type { ModeId, ModeRecords, Save } from "./save.js";
import { WORLDS } from "../render/world.js";

/** Lifetime points for finishing a goal. Progression only — never a score. */
export const MASTERY_BONUS = 5_000;

/** What a round produced, in the terms goals are written in. */
export interface RoundTally {
  readonly mode: ModeId;
  readonly score: number;
  readonly depth: number;
  readonly bestCombo: number;
  readonly ringsCleared: number;
  readonly spokesCleared: number;
  readonly coresFired: number;
  readonly stripesFired: number;
  readonly pureClears: number;
  readonly survived: number;
}

export interface Goal {
  readonly id: string;
  /** Key into the string table, so the text lives with the other languages. */
  readonly text: string;
  /** Substituted into the text. */
  readonly target: number;
  /** Modes this can be worked on. Progress from any other mode is ignored. */
  readonly modes: readonly ModeId[];
  /** Pulls this goal's number out of a finished round. */
  readonly read: (tally: RoundTally) => number;
}

const ALL: readonly ModeId[] = ["daily", "endless", "level", "time"];
/** Depth only exists where the ramp does, which is free play alone. */
const DEEP: readonly ModeId[] = ["endless"];

/**
 * The pool.
 *
 * Targets are set against measured play: a median free-play round reaches depth
 * ~14 and clears a few dozen rings, so these land at one to three rounds of
 * ordinary effort rather than a grind or a gimme.
 */
function pool(): Goal[] {
  const goals: Goal[] = [];

  for (const target of [8, 12, 16]) {
    goals.push({
      id: `depth-${target}`,
      text: "goalDepth",
      target,
      modes: DEEP,
      read: (t) => t.depth,
    });
  }
  for (const target of [12, 20, 30]) {
    goals.push({
      id: `rings-${target}`,
      text: "goalRingCount",
      target,
      modes: ALL,
      read: (t) => t.ringsCleared,
    });
  }
  for (const target of [5, 7, 9]) {
    goals.push({
      id: `combo-${target}`,
      text: "goalComboCount",
      target,
      modes: ALL,
      read: (t) => t.bestCombo,
    });
  }
  for (const target of [1, 3]) {
    goals.push({
      id: `core-${target}`,
      text: "goalCoreCount",
      target,
      modes: ALL,
      read: (t) => t.coresFired,
    });
  }
  for (const target of [3, 6]) {
    goals.push({
      id: `stripe-${target}`,
      text: "goalStripeCount",
      target,
      modes: ALL,
      read: (t) => t.stripesFired,
    });
  }
  for (const target of [4, 8]) {
    goals.push({
      id: `pure-${target}`,
      text: "goalPureCount",
      target,
      modes: ALL,
      read: (t) => t.pureClears,
    });
  }

  // A world already discovered, offered back as somewhere to go, not as
  // "discover it" — depth already does that on its own, and turning what
  // already happened automatically into a goal is not a choice. Candy is
  // excluded: everyone is standing on it from the first piece placed, so
  // reaching it is not a goal either. `offered()` only ever shows one of
  // these for a world already in the player's own save.
  for (const world of WORLDS) {
    if (world.from === 0) continue;
    goals.push({
      id: `world-${world.id}`,
      text: "goalWorld",
      target: 1,
      modes: DEEP,
      read: (t) => (t.depth >= world.from ? 1 : 0),
    });
  }

  return goals;
}

export const GOALS: readonly Goal[] = pool();

const BY_ID = new Map(GOALS.map((g) => [g.id, g]));

export function goalById(id: string | null): Goal | null {
  return id === null ? null : (BY_ID.get(id) ?? null);
}

/** Deterministic 0..1 from two integers. The same hash shape as cellNoise. */
function hash(a: number, b: number): number {
  const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * The three on offer for a round number.
 *
 * Picked without replacement so the player never sees the same goal twice in one
 * trio, and spread across kinds so the choice is a real one — three flavours of
 * "clear more rings" is not a choice, it is a number to agree with.
 *
 * `discoveredWorldIds` gates the "world" kind: a world goal only exists to be
 * offered once the player has actually been there, so on a save with nothing
 * discovered yet the family is empty and the other kinds fill all three slots,
 * exactly as they did before this kind existed.
 */
export function offered(round: number, discoveredWorldIds: ReadonlySet<string>): Goal[] {
  const kinds = ["depth", "rings", "combo", "core", "stripe", "pure", "world"];
  const chosen: Goal[] = [];
  const usedKinds = new Set<string>();

  const familyOf = (kind: string): Goal[] =>
    kind === "world"
      ? GOALS.filter((g) => g.id.startsWith("world-") && discoveredWorldIds.has(g.id.slice(6)))
      : GOALS.filter((g) => g.id.startsWith(`${kind}-`));

  for (let slot = 0; chosen.length < 3 && slot < 24; slot++) {
    const kind = kinds[Math.floor(hash(round + 1, slot + 1) * kinds.length) % kinds.length]!;
    if (usedKinds.has(kind)) continue;
    const family = familyOf(kind);
    if (family.length === 0) continue;
    const pick = family[Math.floor(hash(slot + 7, round + 3) * family.length) % family.length]!;
    usedKinds.add(kind);
    chosen.push(pick);
  }

  // A hash can, in principle, keep landing on kinds already used or on "world"
  // with nothing discovered yet. Topping up in order is not elegant, but three
  // goals that exist beat an empty screen — skipping any undiscovered-world
  // goal here too, for the same reason the loop above does.
  for (const goal of GOALS) {
    if (chosen.length >= 3) break;
    if (chosen.some((g) => g.id === goal.id)) continue;
    if (goal.id.startsWith("world-") && !discoveredWorldIds.has(goal.id.slice(6))) continue;
    chosen.push(goal);
  }
  return chosen.slice(0, 3);
}

export interface MasteryOutcome {
  readonly save: Save;
  /** Progress toward the active goal after this round, capped at its target. */
  readonly progress: number;
  readonly target: number;
  /** True on the round that finished it. */
  readonly completed: boolean;
  /** Lifetime points to add. Zero unless it completed. */
  readonly bonus: number;
}

/**
 * Folds a finished round into the active goal.
 *
 * A round in a mode the goal does not name is not a failure and not a reset — it
 * simply says nothing, and the goal waits.
 */
export function applyMastery(save: Save, tally: RoundTally): MasteryOutcome {
  const goal = goalById(save.mastery.activeId);
  if (!goal) {
    return { save, progress: 0, target: 0, completed: false, bonus: 0 };
  }

  const relevant = goal.modes.includes(tally.mode);
  const seen = relevant ? goal.read(tally) : 0;
  // Best ever seen, never the latest: a goal you have chipped at cannot be
  // undone by one bad round.
  const progress = Math.min(goal.target, Math.max(save.mastery.progress, seen));
  const completed = progress >= goal.target;

  const mastery = completed
    ? {
        round: save.mastery.round + 1,
        activeId: null,
        progress: 0,
        completed: save.mastery.completed + 1,
      }
    : { ...save.mastery, progress };

  return {
    save: { ...save, mastery },
    progress,
    target: goal.target,
    completed,
    bonus: completed ? MASTERY_BONUS : 0,
  };
}

/** Picks a goal. Choosing a different one before finishing resets progress. */
export function chooseGoal(save: Save, id: string): Save {
  if (!BY_ID.has(id)) return save;
  if (save.mastery.activeId === id) return save;
  return { ...save, mastery: { ...save.mastery, activeId: id, progress: 0 } };
}

/** Builds a tally from the pieces the game already tracks. */
export function tallyOf(
  mode: ModeId,
  score: number,
  depth: number,
  stats: {
    ringsCleared: number;
    spokesCleared: number;
    bestCombo: number;
    coresFired: number;
    stripesFired: number;
    pureClears: number;
  },
  survived = 0,
): RoundTally {
  return {
    mode,
    score,
    depth,
    bestCombo: stats.bestCombo,
    ringsCleared: stats.ringsCleared,
    spokesCleared: stats.spokesCleared,
    coresFired: stats.coresFired,
    stripesFired: stats.stripesFired,
    pureClears: stats.pureClears,
    survived,
  };
}

/** What the result screen shows for records, in the same order as `applyRound`. */
export const RECORD_LABELS: Readonly<Record<keyof ModeRecords, string>> = {
  depth: "recDepth",
  score: "recScore",
  survived: "recSurvived",
  bestCombo: "recCombo",
  coresFired: "recCores",
  ringsCleared: "recRings",
};
