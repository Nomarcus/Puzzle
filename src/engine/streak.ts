/**
 * The daily streak.
 *
 * Levels give a player somewhere to get to, free play gives them a number to
 * beat, and the daily gives them a reason to come back — but only if coming
 * back is *visible*. A streak is the cheapest and most durable retention
 * mechanic there is, and the reason is not manipulation: it turns a series of
 * unrelated sessions into one thing the player owns and can lose. Wordle is
 * built on nothing else.
 *
 * Pure date arithmetic over a record of days played, kept out of the UI so the
 * awkward parts — a streak that is alive but not yet extended, a day missed
 * across a month boundary — can be tested rather than eyeballed.
 */

import { dateKey } from "./rng.js";

/** Every daily ever finished: date key to score. */
export type DailyHistory = Readonly<Record<string, number>>;

export interface Streak {
  /** Days in a row, counting today if it has been played. */
  readonly length: number;
  /**
   * Whether today still needs playing to keep it.
   *
   * A streak does not break the moment the clock passes midnight — it breaks
   * when a whole day goes by unplayed. So a player who played yesterday and
   * not yet today still *has* their streak, and the screen should say so and
   * ask them to keep it, rather than showing a zero that is not true yet.
   */
  readonly atRisk: boolean;
}

const MS_PER_DAY = 86_400_000;

/** The day `back` days before `date`, as a key. */
export function dayBefore(date: Date, back: number): string {
  return dateKey(new Date(date.getTime() - back * MS_PER_DAY));
}

export function streakOf(history: DailyHistory, today: Date): Streak {
  const playedToday = history[dateKey(today)] !== undefined;
  // Count from today if today is played, otherwise from yesterday — a day that
  // has not ended yet cannot have been missed.
  const start = playedToday ? 0 : 1;

  let length = 0;
  for (let back = start; ; back++) {
    if (history[dayBefore(today, back)] === undefined) break;
    length++;
  }

  return { length, atRisk: length > 0 && !playedToday };
}

/** The longest run in the record, however long ago it was. */
export function bestStreakOf(history: DailyHistory): number {
  const days = Object.keys(history).sort();
  let best = 0;
  let run = 0;
  let previous: string | null = null;

  for (const day of days) {
    // Compared as timestamps rather than as strings: "2026-03-01" follows
    // "2026-02-28" and no amount of string arithmetic knows that.
    const consecutive =
      previous !== null && Date.parse(day) - Date.parse(previous) === MS_PER_DAY;
    run = consecutive ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day;
  }

  return best;
}

export interface DayCell {
  readonly key: string;
  readonly score: number | null;
  readonly today: boolean;
}

/**
 * The last `days` days, oldest first, for the little calendar strip. Days with
 * no entry come back null rather than being dropped, because the gaps are the
 * point of showing it at all.
 */
export function recentDays(history: DailyHistory, today: Date, days = 14): DayCell[] {
  const out: DayCell[] = [];
  for (let back = days - 1; back >= 0; back--) {
    const key = dayBefore(today, back);
    out.push({ key, score: history[key] ?? null, today: back === 0 });
  }
  return out;
}
