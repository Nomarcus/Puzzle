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
  /** Stone, which bursts grey rather than in one of the eight candy colours. */
  readonly stone?: boolean;
}

export type Effect =
  | { kind: "clear"; cells: ClearedCell[]; elapsed: number; duration: number }
  | { kind: "drop"; cells: Cell[]; elapsed: number; duration: number }
  /** The ramp dropping a fresh stone on the rim. */
  | { kind: "stone"; cell: Cell; elapsed: number; duration: number }
  | { kind: "float"; x: number; y: number; text: string; big: boolean; elapsed: number; duration: number }
  | { kind: "spinSettle"; ring: number; from: number; elapsed: number; duration: number }
  | { kind: "pushSettle"; sector: number; from: number; elapsed: number; duration: number }
  | { kind: "shake"; elapsed: number; duration: number }
  | { kind: "denied"; elapsed: number; duration: number }
  | { kind: "shockwave"; x: number; y: number; radius: number; elapsed: number; duration: number }
  /** A depth landing: light crossing the disc as the new palette settles in. */
  | { kind: "deepen"; x: number; y: number; radius: number; elapsed: number; duration: number };

export function clearBurst(cells: ClearedCell[]): Effect {
  return { kind: "clear", cells, elapsed: 0, duration: 420 };
}

export function dropIn(cells: Cell[]): Effect {
  return { kind: "drop", cells, elapsed: 0, duration: 220 };
}

/**
 * Stone landing. Slower than a piece dropping in, and it overshoots: you are
 * meant to notice this one, because it is the game getting harder and the whole
 * point of the ramp is that it never does that behind your back.
 */
export function stoneLands(cell: Cell): Effect {
  return { kind: "stone", cell, elapsed: 0, duration: 380 };
}

/**
 * The moment a depth lands.
 *
 * Long, by the standards of everything else here, and deliberately so: the
 * palette underneath it shifts over 22 pieces, which is a change nobody would
 * ever notice happening. The feeling of getting somewhere comes from the moment
 * it lands, not from the state it lands in, so this is the effect that makes
 * the other two worth building.
 */
export function deepenSweep(x: number, y: number, radius: number): Effect {
  return { kind: "deepen", x, y, radius, elapsed: 0, duration: 900 };
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

/** The same, for a spoke shoved in or out. `from` is in pixels, not radians. */
export function pushSettle(sector: number, from: number): Effect {
  return { kind: "pushSettle", sector, from, elapsed: 0, duration: 190 };
}

export function shake(): Effect {
  return { kind: "shake", elapsed: 0, duration: 320 };
}

/** The nudge that says "you have no spins left". */
export function denied(): Effect {
  return { kind: "denied", elapsed: 0, duration: 360 };
}

/** A ring of light racing outwards. Reserved for the bullseye. */
export function shockwave(x: number, y: number, radius: number): Effect {
  return { kind: "shockwave", x, y, radius, elapsed: 0, duration: 700 };
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
