/**
 * Scoring.
 *
 * The numbers here are starting values, not decisions. tools/balance.ts plays
 * a thousand seeded games and tells us whether rings are worth chasing and
 * whether spins are too cheap.
 *
 * The shape of it matters more than the constants:
 *   - a spoke is as long as the disc has rings, so it is common and cheap:
 *     the bread and butter that keeps the board breathing
 *   - a ring is as long as it has sectors, so it is rare and pays far more —
 *     and it is the only thing that buys back a spin
 *   - a ring and a spoke completed by the same move sweep the entire disc,
 *     which is the biggest thing that can happen in a round
 *   - clearing several lines at once, and clearing on consecutive turns,
 *     both multiply — that is where the ceiling for expert play lives
 */

import { type Clears, isBullseye } from "./board.js";

export const SCORING = {
  perCellPlaced: 2,
  perSpoke: 60,
  perRing: 1000,
  /** Each extra line in the same clear adds this much to the multiplier. */
  simultaneousStep: 0.5,
  /** Each consecutive clearing turn adds this much to the multiplier. */
  comboStep: 0.5,
  comboCap: 4,
  /** A clear triggered by spinning a ring is worth more — it was earned. */
  spinBonus: 1.5,
  /** Flat prize for taking a ring and a spoke together, which sweeps the disc. */
  bullseyeBonus: 2500,
  bullseyeMultiplier: 2,
} as const;

export function placementScore(cellsPlaced: number): number {
  return cellsPlaced * SCORING.perCellPlaced;
}

export function simultaneousMultiplier(lineCount: number): number {
  if (lineCount <= 1) return 1;
  return 1 + SCORING.simultaneousStep * (lineCount - 1);
}

/** `combo` is the number of *previous* consecutive clearing turns. */
export function comboMultiplier(combo: number): number {
  return Math.min(1 + SCORING.comboStep * combo, SCORING.comboCap);
}

export function clearScore(clears: Clears, combo: number, viaSpin: boolean): number {
  const lineCount = clears.rings.length + clears.spokes.length;
  if (lineCount === 0) return 0;

  const bullseye = isBullseye(clears);
  const base =
    clears.rings.length * SCORING.perRing +
    clears.spokes.length * SCORING.perSpoke +
    (bullseye ? SCORING.bullseyeBonus : 0);

  const multiplier =
    simultaneousMultiplier(lineCount) *
    comboMultiplier(combo) *
    (viaSpin ? SCORING.spinBonus : 1) *
    (bullseye ? SCORING.bullseyeMultiplier : 1);

  return Math.round(base * multiplier);
}
