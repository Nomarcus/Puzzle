/**
 * The music bed.
 *
 * Built on the same chip as everything else — the pulse waves, the stepped
 * triangle and the LFSR noise all come off the `Bus` the sound effects already
 * use, so the music is the same instrument and not a second one playing
 * alongside it. Nothing here is a sample and nothing is licensed.
 *
 * ## What it is trying to be
 *
 * Calm, hypnotic, and something you could leave on for an hour. Around 100 BPM
 * in D pentatonic, which is the scale every sound effect is already tuned to, so
 * a placement or a clear lands *in key* rather than over the top of one.
 *
 * There is no intro, no chorus and no drop. There is no lead line either: a
 * melody is the one thing that would compete with the sound effects for the
 * player's attention, and the effects are the part that carries information.
 *
 * ## Why it does not loop
 *
 * A bar is generated from its own index rather than read out of a fixed
 * sequence. The arpeggio walks an eight-bar chord cycle, the octave drifts on a
 * seventeen-bar cycle and the percussion is hashed per bar, so the pattern only
 * truly repeats after a length nobody sits through. It is cheap: one small
 * array of numbers per bar, built two bars ahead.
 *
 * ## How depth reaches it
 *
 * Depth moves `intensity`, and intensity gates *layers* in and out rather than
 * turning anything up or speeding it up. Going deeper makes the bed richer, not
 * louder — the brief is explicit that it must never become stressful, and a
 * puzzle you are concentrating on is not helped by a track that keeps climbing.
 *
 * The world moves timbre only: duty cycle, how the arpeggio is spun, whether
 * the bass syncopates. A world change is not a new track, and it lands on a bar
 * line so it reads as the same music having moved somewhere.
 */

import { type Bus, note } from "./audio.js";

/** Beats a minute. Slow enough to think over. */
export const BPM = 100;
export const BEAT = 60 / BPM;
/** Four beats. Everything that changes, changes here. */
export const BAR = BEAT * 4;

/** How far ahead bars are built. Two is enough to survive a stalled frame. */
const LOOKAHEAD_BARS = 2;
/** How often the scheduler wakes. Well under a bar, so it cannot miss one. */
const TICK_MS = 400;

export type Layer = "bass" | "arp" | "perc" | "air";

export interface MusicEvent {
  readonly layer: Layer;
  /** Seconds from the start of the bar. */
  readonly at: number;
  /** Scale degree, fed through `note()`. Ignored by percussion. */
  readonly degree: number;
  readonly seconds: number;
  /** 0..1 before the layer's own mix level is applied. */
  readonly gain: number;
}

/** Deterministic 0..1. The same hash shape the renderer uses for patterns. */
function hash(a: number, b: number): number {
  const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * The chord cycle: eight bars of pentatonic roots that keep coming home.
 *
 * Degrees, not semitones — `note()` owns the scale, so nothing here can produce
 * a note outside it however wrong the arithmetic gets.
 */
const CYCLE = [0, 0, 3, 3, 1, 1, 4, 2];

/**
 * Everything one bar plays.
 *
 * Pure, so the offline preview renders exactly what the game plays and a test
 * can assert the shape of it without an audio context.
 */
export function planBar(bar: number, world: number, intensity: number): MusicEvent[] {
  const events: MusicEvent[] = [];
  const t = Math.max(0, Math.min(1, intensity));
  const root = CYCLE[((bar % CYCLE.length) + CYCLE.length) % CYCLE.length]!;
  // A slow drift on a cycle that shares no factor with the chord cycle, so the
  // two only line up again after 136 bars — about five and a half minutes.
  const octave = bar % 17 < 9 ? 0 : 5;

  // --- bass: always there, and the only thing that always is -------------
  const syncopated = world % 3 === 2;
  events.push({ layer: "bass", at: 0, degree: root - 5, seconds: BEAT * 1.7, gain: 1 });
  events.push({
    layer: "bass",
    at: syncopated ? BEAT * 2.5 : BEAT * 2,
    degree: root - 5,
    seconds: BEAT * 1.3,
    gain: 0.8,
  });

  // --- arpeggio: the pulse that carries the movement ---------------------
  // Sparse at the top of a round and filling in as it goes deeper. Sixteenths
  // are deliberately never reached; this is a bed, not a driver.
  const steps = t < 0.3 ? 4 : 8;
  const spin = world % 4;
  for (let i = 0; i < steps; i++) {
    // Holes rather than a solid run: a continuous arpeggio becomes a texture the
    // ear stops hearing, and the gaps are where the sound effects live.
    if (hash(bar * 31 + i, world + 1) < 0.22) continue;
    const shape = [0, 2, 4, 2][(i + spin) % 4]!;
    events.push({
      layer: "arp",
      at: (i * BAR) / steps,
      degree: root + shape + octave,
      seconds: BEAT * 0.42,
      gain: i % 2 === 0 ? 0.85 : 0.55,
    });
  }

  // --- percussion: a breath, not a beat ----------------------------------
  if (t >= 0.45) {
    for (const beat of [1, 3]) {
      if (hash(bar, beat * 7) < 0.25) continue;
      events.push({ layer: "perc", at: BEAT * beat, degree: 0, seconds: 0.05, gain: 0.7 });
    }
  }

  // --- air: one long note into the echo, occasionally --------------------
  if (t >= 0.7 && bar % 4 === 2) {
    events.push({
      layer: "air",
      at: BEAT * 1.5,
      degree: root + 7 + octave,
      seconds: BEAT * 2.4,
      gain: 0.5,
    });
  }

  return events;
}

/** Per-layer mix. Kept low: the effects have to sit on top of this, not under. */
const MIX: Readonly<Record<Layer, number>> = {
  bass: 0.16,
  arp: 0.075,
  perc: 0.05,
  air: 0.06,
};

/** Duty cycles per world, so a world has its own colour without a new tune. */
const DUTIES = [0.5, 0.25, 0.125, 0.25, 0.5, 0.125, 0.25, 0.125, 0.5, 0.25];

function voice(bus: Bus, dest: AudioNode, event: MusicEvent, when: number, world: number): void {
  const ctx = bus.ctx;
  const gain = ctx.createGain();
  const level = MIX[event.layer] * event.gain;

  if (event.layer === "perc") {
    const src = ctx.createBufferSource();
    src.buffer = bus.noiseShort;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 2400;
    band.Q.value = 1.2;
    src.connect(band).connect(gain).connect(dest);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(level, when + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + event.seconds);
    src.start(when);
    src.stop(when + event.seconds + 0.02);
    return;
  }

  const osc = ctx.createOscillator();
  if (event.layer === "bass") {
    osc.setPeriodicWave(bus.triangle);
  } else {
    const duty = DUTIES[((world % DUTIES.length) + DUTIES.length) % DUTIES.length]!;
    const wave = bus.pulses.get(duty) ?? bus.pulses.values().next().value;
    if (wave) osc.setPeriodicWave(wave);
  }
  osc.frequency.value = note(event.degree);
  osc.connect(gain).connect(dest);

  // The air layer is the only thing that reaches the tracker echo. Everything
  // else stays dry, or the bed turns to soup underneath the sound effects.
  if (event.layer === "air") gain.connect(bus.send);

  const attack = event.layer === "bass" ? 0.05 : 0.012;
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(level, when + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + event.seconds);
  osc.start(when);
  osc.stop(when + event.seconds + 0.02);
}

/** Renders one bar into any context. Used live and by the offline preview. */
export function scheduleBar(
  bus: Bus,
  dest: AudioNode,
  bar: number,
  world: number,
  intensity: number,
  when: number,
): void {
  for (const event of planBar(bar, world, intensity)) {
    voice(bus, dest, event, when + event.at, world);
  }
}

/**
 * The live player.
 *
 * A lookahead scheduler rather than a node graph that loops: bars are built two
 * ahead on a 400ms timer, so there is no seam to click at and the pattern can
 * change without stopping. The timer is the only one, it is cleared on `stop`,
 * and every node it creates is one-shot with a `stop()` already scheduled — so a
 * long session accumulates nothing.
 */
export class MusicPlayer {
  private readonly bus: Bus;
  private readonly ctx: AudioContext;
  private readonly out: GainNode;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextBar = 0;
  private nextTime = 0;
  private world = 0;
  /** Queued, and taken at the next bar line so a change lands musically. */
  private pendingWorld = 0;
  private intensity = 0;
  private pendingIntensity = 0;

  constructor(bus: Bus, ctx: AudioContext, destination: AudioNode) {
    this.bus = bus;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 1;
    this.out.connect(destination);
  }

  /** The node the ducking is applied to. */
  get gain(): GainNode {
    return this.out;
  }

  start(): void {
    if (this.timer) return;
    this.nextBar = 0;
    // A beat of headroom so the first bar is scheduled, not raced.
    this.nextTime = this.ctx.currentTime + 0.12;
    this.pump();
    this.timer = setInterval(() => this.pump(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  /** Takes effect on the next bar line, never mid-bar. */
  setWorld(world: number): void {
    this.pendingWorld = world;
  }

  setIntensity(value: number): void {
    this.pendingIntensity = Math.max(0, Math.min(1, value));
  }

  private pump(): void {
    if (this.ctx.state !== "running") return;
    const horizon = this.ctx.currentTime + BAR * LOOKAHEAD_BARS;
    let guard = 0;
    while (this.nextTime < horizon && guard++ < 8) {
      // Changes are taken here, which is by definition a bar line.
      this.world = this.pendingWorld;
      this.intensity = this.pendingIntensity;
      try {
        scheduleBar(this.bus, this.out, this.nextBar, this.world, this.intensity, this.nextTime);
      } catch {
        // A bar that will not build is not worth stopping the music for.
      }
      this.nextBar += 1;
      this.nextTime += BAR;
    }
    // A context that was suspended and resumed can leave the cursor in the
    // past, which would schedule a burst of bars all at once.
    if (this.nextTime < this.ctx.currentTime) this.nextTime = this.ctx.currentTime + 0.05;
  }
}
