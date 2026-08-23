/**
 * Feedback effects.
 *
 * All of this is cosmetic and lives entirely outside the engine — the game
 * state has already moved on by the time an effect plays. Effects capture
 * whatever they need at the moment they are created, which is why a clear
 * burst carries its own copy of the cells and colours: the board no longer
 * contains them.
 */

import type { Cell } from "../engine/geometry.js";

export interface ClearedCell extends Cell {
  readonly colour: number;
}

export type Effect =
  | { kind: "clear"; cells: ClearedCell[]; elapsed: number; duration: number }
  | { kind: "drop"; cells: Cell[]; elapsed: number; duration: number }
  | { kind: "float"; x: number; y: number; text: string; big: boolean; elapsed: number; duration: number }
  | { kind: "spinSettle"; ring: number; from: number; elapsed: number; duration: number }
  | { kind: "shake"; elapsed: number; duration: number }
  | { kind: "denied"; elapsed: number; duration: number };

export function clearBurst(cells: ClearedCell[]): Effect {
  return { kind: "clear", cells, elapsed: 0, duration: 420 };
}

export function dropIn(cells: Cell[]): Effect {
  return { kind: "drop", cells, elapsed: 0, duration: 220 };
}

export function floatText(x: number, y: number, text: string, big = false): Effect {
  return { kind: "float", x, y, text, big, elapsed: 0, duration: big ? 1100 : 800 };
}

/**
 * Carries a ring the rest of the way once the finger lets go. `from` is the
 * angular offset the ring is sitting at when the gesture ends; it always eases
 * back to zero, because by then the board itself has already been rotated.
 */
export function spinSettle(ring: number, from: number): Effect {
  return { kind: "spinSettle", ring, from, elapsed: 0, duration: 190 };
}

export function shake(): Effect {
  return { kind: "shake", elapsed: 0, duration: 320 };
}

/** The nudge that says "you have no spins left". */
export function denied(): Effect {
  return { kind: "denied", elapsed: 0, duration: 360 };
}

export function progress(effect: Effect): number {
  return Math.min(effect.elapsed / effect.duration, 1);
}

export function isDone(effect: Effect): boolean {
  return effect.elapsed >= effect.duration;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export function easeInQuad(t: number): number {
  return t * t;
}

/** Advances every effect and drops the finished ones. */
export function stepEffects(effects: Effect[], dt: number): Effect[] {
  for (const effect of effects) effect.elapsed += dt;
  return effects.filter((effect) => !isDone(effect));
}
