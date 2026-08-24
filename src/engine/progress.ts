/**
 * Progression.
 *
 * Every mode ends in a number, and until now that number went into a high
 * score and nowhere else. A player who has beaten their record has nothing
 * left to be moving toward, which is the point at which people stop.
 *
 * So every point ever scored, in any mode, adds to one lifetime total, and the
 * total unlocks themes. Deliberately one currency and one kind of reward:
 *
 * - **One currency**, because two would need explaining and a player would
 *   have to work out which one they were earning.
 * - **Cosmetic only.** Progression that changes how the game plays turns a
 *   puzzle into a treadmill, and the appeal of this one is that everybody's
 *   board is the same board. A theme you earned changes nothing about a
 *   leaderboard and is still worth having.
 *
 * The thresholds are set against measured play: a free-play round is worth
 * roughly 100,000 with the bot, so the first unlock is about two rounds and the
 * last is about forty. Someone who plays a daily and nothing else gets there
 * eventually too, which is the point of counting every mode.
 */

export interface Unlock {
  /** Theme id, matching one in render/theme.ts. */
  readonly theme: string;
  /** Lifetime points needed. */
  readonly at: number;
}

/**
 * In order, cheapest first. The first three themes are not here because they
 * are not earned — a game that opens with one option and a row of padlocks
 * looks mean, and the first choice a player makes should be a real one.
 */
export const UNLOCKS: readonly Unlock[] = [
  { theme: "lagoon", at: 150_000 },
  { theme: "sherbet", at: 500_000 },
  { theme: "bubblegum", at: 1_500_000 },
  { theme: "lemonade", at: 4_000_000 },
];

/** Whether a theme is available at this lifetime total. */
export function isUnlocked(themeId: string, total: number): boolean {
  const unlock = UNLOCKS.find((u) => u.theme === themeId);
  return unlock === undefined || total >= unlock.at;
}

/** The next thing to play toward, or null once everything is earned. */
export function nextUnlock(total: number): Unlock | null {
  return UNLOCKS.find((unlock) => total < unlock.at) ?? null;
}

/**
 * Anything crossed by going from `before` to `after`.
 *
 * Returns a list rather than one unlock: a single enormous round can cross two
 * thresholds, and silently swallowing the first would be the one moment the
 * whole system exists to produce.
 */
export function unlockedBetween(before: number, after: number): Unlock[] {
  return UNLOCKS.filter((unlock) => before < unlock.at && after >= unlock.at);
}

/** 0 to 1 toward the next unlock, measured from the previous one. */
export function unlockProgress(total: number): number {
  const next = nextUnlock(total);
  if (!next) return 1;
  const index = UNLOCKS.indexOf(next);
  const from = index === 0 ? 0 : UNLOCKS[index - 1]!.at;
  return Math.max(0, Math.min(1, (total - from) / (next.at - from)));
}
