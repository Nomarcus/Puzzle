/**
 * Deterministic randomness.
 *
 * Daily mode falls apart if two phones disagree about which pieces come next,
 * so nothing in the engine is allowed to call Math.random. Everything draws
 * from mulberry32, threaded through the game state as a plain number.
 *
 * The generator is written as a pure step function — state in, [value, state]
 * out — rather than a closure, so GameState stays serialisable and a replay
 * can be re-simulated move for move.
 */

/** mulberry32, one step. Returns the value in [0,1) and the next state. */
export function nextRandom(state: number): [value: number, next: number] {
  const a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, a];
}

/** Uniform integer in [0, maxExclusive). */
export function nextInt(state: number, maxExclusive: number): [value: number, next: number] {
  const [v, next] = nextRandom(state);
  return [Math.floor(v * maxExclusive), next];
}

/** xmur3 — turns a string into a well-mixed 32-bit seed. */
export function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** The day the daily puzzle counter starts from. Puzzle #1 is this date. */
export const DAILY_EPOCH_UTC = Date.UTC(2026, 0, 1);
const MS_PER_DAY = 86_400_000;

/** UTC calendar day as YYYY-MM-DD. UTC so the puzzle flips worldwide at once. */
export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Every player on a given date gets this seed, and therefore these pieces. */
export function dailySeed(date: Date): number {
  return hashSeed(`shiftle:${dateKey(date)}`);
}

/** Human-facing puzzle number, as in "Shiftle #142". */
export function dailyNumber(date: Date): number {
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((midnight - DAILY_EPOCH_UTC) / MS_PER_DAY) + 1;
}
