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
 * sequence. The chord progression is an eight-bar cycle and the octave drifts
 * on a seventeen-bar cycle, so the harmony alone only comes home after 136
 * bars — about five and a half minutes. On top of that, the arpeggio's holes
 * and the percussion hits are hashed per bar rather than read from any cycle,
 * so there is no short block that repeats for a listener to catch (measured:
 * none of the 48 bars after any given bar, about two minutes, exactly repeat
 * it). Two individual bars can still land on the same hash pattern by chance,
 * same as two coin flips landing the same way now and then, but that is a
 * coincidence, not a loop, and it is inaudible against a bed this sparse. It
 * is cheap either way: one small array of numbers per bar, built two bars
 * ahead.
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

import { type Bus, note, noise, pulse, tri } from "./audio.js";

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
 * The chord cycle: sixteen bars of pentatonic roots that keep coming home.
 *
 * Degrees, not semitones — `note()` owns the scale, so nothing here can produce
 * a note outside it however wrong the arithmetic gets.
 *
 * The first half is the eight bars this always had. The second half answers it
 * with the same opening and a different turn, which is the cheapest way to
 * double the harmonic length without the bed wandering off somewhere it cannot
 * come home from. Bars 0–1 and 8–9 deliberately match: the octave drift below
 * runs on seventeen, so a listener meeting bar 16 has to hear the *same* chord
 * an octave away rather than two changes at once.
 */
const CYCLE = [0, 0, 3, 3, 1, 1, 4, 2, 0, 0, 3, 3, 2, 2, 4, 1];

/**
 * The shapes the arpeggio can walk, in scale degrees above the chord root.
 *
 * There used to be one — `0,2,4,2` — rotated four ways by the world, which
 * meant a whole world was a single eight-note figure with holes punched in it.
 * Measured: four contours in the entire game, one per world, and all four were
 * rotations of the same cell, so the ear heard one idea for the length of a
 * round.
 *
 * These are picked by **chord position rather than by a free hash**, which is
 * both the musical answer and the testable one: a shape belongs to a chord, and
 * bar 0 and bar 16 land on the same chord, so the octave drift can still be
 * read off them. `CONTOURS[0]` is the original figure, so the bed still opens
 * exactly as it always has.
 */
const CONTOURS: readonly (readonly number[])[] = [
  [0, 2, 4, 2, 0, 2, 4, 2], // the signature: broken thirds
  [0, 1, 2, 3, 4, 3, 2, 1], // a run up and back
  [0, 0, 4, 0, 2, 0, 4, 0], // a pedal with the fifth over it
  [4, 3, 2, 1, 0, 1, 2, 3], // the run inverted
  [0, 2, 4, 6, 4, 2, 0, 2], // a wide arc, reaching an octave up
  [0, 4, 0, 4, 2, 5, 2, 5], // paired leaps
];

/**
 * The chord tones the arpeggio flickers between, as scale degrees.
 *
 * This is the thing that was missing entirely: `audio.ts` calls the flutter
 * "the genre's signature more than any waveform is", every sound effect uses
 * it, and the music set a single static frequency per note. It costs no extra
 * nodes — it is frequency automation on the oscillator that was already there.
 */
const CHORD = [0, 2, 4];
/** Wider, for a bar that has just been lifted by something the player did. */
const CHORD_WIDE = [0, 2, 4, 6];

/**
 * Semitone offsets for a set of scale degrees above `base`.
 *
 * `pulse()`'s flutter is in semitones, the scale is in degrees, and mixing the
 * two is the one way to land a note outside the pentatonic — a major third off
 * a degree that has no major third under it. Going through `note()` for both
 * ends and taking the ratio cannot do that, whatever the arithmetic.
 */
export function flutter(base: number, degrees: readonly number[]): number[] {
  return degrees.map((d) => Math.round(12 * Math.log2(note(base + d) / note(base))));
}

/**
 * Everything one bar plays.
 *
 * Pure, so the offline preview renders exactly what the game plays and a test
 * can assert the shape of it without an audio context.
 */
export function planBar(
  bar: number,
  world: number,
  intensity: number,
  lift = 0,
): MusicEvent[] {
  const events: MusicEvent[] = [];
  const t = Math.max(0, Math.min(1, intensity));
  const step = ((bar % CYCLE.length) + CYCLE.length) % CYCLE.length;
  const root = CYCLE[step]!;
  const next = CYCLE[(step + 1) % CYCLE.length]!;
  // A slow drift on a cycle that shares no factor with the chord cycle, so the
  // two only line up again after 16 × 17 = 272 bars — about eleven minutes,
  // which is roughly a whole median round rather than half of one.
  const octave = bar % 17 < 9 ? 0 : 5;
  const lifted = lift > 0;

  // --- bass: always there, and the only thing that always is -------------
  // The second note moves, which is the whole difference between a bass line
  // and a pulse. It walks to the next bar's root when the chord is about to
  // change and lifts to the fifth when it is not — so the line is always going
  // somewhere, and where it goes says what is coming.
  const syncopated = world % 3 === 2;
  const moving = next !== root;
  events.push({ layer: "bass", at: 0, degree: root - 5, seconds: BEAT * 1.7, gain: 1 });
  events.push({
    layer: "bass",
    at: syncopated ? BEAT * 2.5 : BEAT * 2,
    degree: (moving ? next : root + 3) - 5,
    seconds: BEAT * 1.3,
    gain: 0.8,
  });

  // --- arpeggio: the pulse that carries the movement ---------------------
  // Sparse at the top of a round and filling in as it goes deeper. Sixteenths
  // are deliberately never reached; this is a bed, not a driver.
  const steps = t < 0.3 ? 4 : 8;
  const contour = CONTOURS[step % CONTOURS.length]!;
  const spin = world % 4;
  for (let i = 0; i < steps; i++) {
    // Holes rather than a solid run: a continuous arpeggio becomes a texture the
    // ear stops hearing, and the gaps are where the sound effects live. A
    // lifted bar fills them in — that is what makes the lift audible without
    // adding a single note the bed could not already play.
    if (!lifted && hash(bar * 31 + i, world + 1) < 0.22) continue;
    const shape = contour[(i + spin) % contour.length]!;
    events.push({
      layer: "arp",
      at: (i * BAR) / steps,
      degree: root + shape + octave,
      seconds: BEAT * 0.42,
      gain: i % 2 === 0 ? 0.85 : 0.55,
    });
  }

  // --- percussion: a breath, not a beat ----------------------------------
  // Two drums where there was one. `degree` names which: 0 is the kick, 1 the
  // hat. A single bandpassed blip on beats one and three is a metronome; a
  // kick and a hat playing off each other is a groove, at the same note count.
  if (t >= 0.45) {
    events.push({ layer: "perc", at: 0, degree: 0, seconds: 0.09, gain: 0.85 });
    if (hash(bar, 13) < 0.55) {
      events.push({ layer: "perc", at: BEAT * 2.5, degree: 0, seconds: 0.08, gain: 0.6 });
    }
    if (lifted) {
      // The fill: two hats into the top of the next bar, which is how every
      // tracker has ever said "something just happened".
      events.push({ layer: "perc", at: BEAT * 3.5, degree: 1, seconds: 0.04, gain: 0.7 });
      events.push({ layer: "perc", at: BEAT * 3.75, degree: 1, seconds: 0.04, gain: 0.9 });
    } else if (hash(bar, 29) < 0.6) {
      events.push({ layer: "perc", at: BEAT * 3, degree: 1, seconds: 0.04, gain: 0.55 });
    }
  }

  // --- air: one long note into the echo, occasionally --------------------
  // A lift buys it outright, whatever the depth: the bed answering something
  // the player did is the one place this is allowed to arrive early.
  if ((t >= 0.7 && bar % 4 === 2) || lifted) {
    events.push({
      layer: "air",
      at: BEAT * 1.5,
      degree: root + 7 + octave,
      seconds: BEAT * 2.4,
      gain: lifted ? 0.65 : 0.5,
    });
  }

  return events;
}

/**
 * How loud each layer is *relative to the others*, never how loud the bed is.
 *
 * The absolute level is `BED_LEVEL` below, and the split is not a style choice
 * — it is forced by the chip. `stair()` quantises to sixteen levels, so a peak
 * under about 1/30 rounds to zero on every step and the voice is simply
 * **silent**. Measured, exactly that: folding the bed's level into these
 * numbers rendered a completely silent bed while every layer looked correct in
 * the source. The sound effects never hit it because `schedule()` keeps its
 * peaks near 1 and puts the trim on a separate gain node afterwards, which is
 * what this does now too.
 *
 * The balance moved as well. The bass used to sit ~8 dB over the arpeggio,
 * putting the layer that never varies in front of the layer that carries all
 * the variation. It is ~3 dB now: still the floor, no longer the thing you
 * mostly hear.
 */
export const MIX: Readonly<Record<Layer, number>> = {
  bass: 0.9,
  arp: 0.62,
  perc: 0.33,
  air: 0.39,
};

/**
 * How loud the bed is, as one number on one gain node per bar.
 *
 * Set against the same measurement the effects' own trims were — the loudest
 * 300 ms window `tools/audio-preview.mjs` reports. The bed belongs just under a
 * placement (-31 dB), the quietest thing the game says and the one it says most
 * often. Above that and the bed competes with the information rather than
 * carrying it.
 *
 * It is a small number because the chip voices are loud: the staircase *holds*
 * its level where the old exponential fade collapsed, and the bass carries a
 * sub-oscillator at 1.6× on top. Measured, the identical arrangement came out
 * 13 dB louder before this was applied.
 */
const BED_LEVEL = 0.0385;

/** Duty cycles per world, so a world has its own colour without a new tune. */
const DUTIES = [0.5, 0.25, 0.125, 0.25, 0.5, 0.125, 0.25, 0.125, 0.5, 0.25];

function dutyOf(world: number): number {
  return DUTIES[((world % DUTIES.length) + DUTIES.length) % DUTIES.length]!;
}

/**
 * One note, played on the chip the sound effects are played on.
 *
 * This used to build its own oscillator and fade it with
 * `exponentialRampToValueAtTime`. That is the one thing `audio.ts` says at the
 * top of the file stops something sounding 8-bit — *"an exponential fade,
 * however short, reads as modern immediately"* — so the music was the only
 * sound in the game breaking the game's own rule, and the flutter that file
 * calls "the genre's signature more than any waveform is" was missing from the
 * bed entirely while every sound effect had it.
 *
 * It now goes through `pulse`/`tri`/`noise`, so it gets the stepped 16-level
 * envelope, the stepped pitch, the flutter and the sub-bass for free — and it
 * cannot drift away from how the rest of the game sounds, because there is only
 * one chip now instead of two.
 */
function voice(bus: Bus, event: MusicEvent, when: number, world: number, lift: number): void {
  const level = MIX[event.layer] * event.gain;

  switch (event.layer) {
    case "perc": {
      // `degree` names the drum: 0 the kick, 1 the hat. One bandpassed blip on
      // beats one and three is a metronome; a kick and a hat playing off each
      // other is a groove, at the same note count.
      if (event.degree === 0) {
        noise(bus, when, { peak: level, decay: event.seconds, rate: 0.5, rateTo: 0.22, curve: 2.4 });
      } else {
        noise(bus, when, { peak: level, decay: event.seconds, rate: 3.4, curve: 2.6 });
      }
      return;
    }

    case "bass": {
      // `sub` is the sine under the staircase. The stepped triangle alone puts
      // its energy into the harmonics and leaves the fundamental thin, which is
      // the one thing a phone speaker cannot help with. The sound effects have
      // had this since they were tuned; the bed never did.
      tri(bus, when, { freq: note(event.degree), peak: level, decay: event.seconds, sub: 1.6 });
      return;
    }

    case "air": {
      // The only layer that reaches the tracker echo. Everything else stays
      // dry, or the bed turns to soup underneath the sound effects.
      pulse(bus, when, {
        freq: note(event.degree),
        duty: dutyOf(world),
        peak: level,
        decay: event.seconds,
        vibrato: 18,
        send: 0.5,
      });
      return;
    }

    default: {
      // The arpeggio, flickering through the chord rather than holding one
      // note. Two frames a step is about 30 Hz, which is the rate a chip
      // actually ran its arpeggios at, and it costs no extra nodes — it is
      // frequency automation on the oscillator that was already there.
      pulse(bus, when, {
        freq: note(event.degree),
        duty: dutyOf(world),
        peak: level,
        decay: event.seconds,
        arp: flutter(event.degree, lift > 0 ? CHORD_WIDE : CHORD),
        arpRate: 2,
      });
    }
  }
}

/**
 * Renders one bar into any context. Used live and by the offline preview.
 *
 * The bar gets one gain node of its own and the chip voices are pointed at it
 * by handing them a bus whose `dry` is that node — the same trick `schedule()`
 * uses to give each sound effect its own trim. One node a bar rather than one a
 * note is what keeps the busiest bar inside the node budget the tests pin.
 */
export function scheduleBar(
  bus: Bus,
  dest: AudioNode,
  bar: number,
  world: number,
  intensity: number,
  when: number,
  lift = 0,
): void {
  const dry = bus.ctx.createGain();
  dry.gain.value = BED_LEVEL;
  dry.connect(dest);
  const local: Bus = { ...bus, dry };

  for (const event of planBar(bar, world, intensity, lift)) {
    voice(local, event, when + event.at, world, lift);
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
  /** Audio-clock time the current lift runs out at. Zero when there is none. */
  private liftUntil = 0;

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

  /** Bars handed to the graph since `start`. The leak check reads this. */
  get scheduledBars(): number {
    return this.nextBar;
  }

  /** Takes effect on the next bar line, never mid-bar. */
  setWorld(world: number): void {
    this.pendingWorld = world;
  }

  setIntensity(value: number): void {
    this.pendingIntensity = Math.max(0, Math.min(1, value));
  }

  /**
   * Something big happened: lift the bed for a couple of bars.
   *
   * Measured against real play, the events this reacts to land about once every
   * eleven bars, which is roughly every twenty-five seconds — often enough that
   * the bed plainly answers the player, rare enough that it stays an answer
   * rather than a texture.
   *
   * It lands on the next **bar line**, never immediately. That is a musical
   * decision before it is a scheduling one: a fill that starts in the middle of
   * a bar sounds like a mistake, and the duck the same event already applies
   * covers the wait. It is also why this is a window in seconds rather than a
   * count of bars — bars are built ahead of the clock, so what is being asked
   * for is "every bar that starts in the next while", not "the next N I build".
   */
  lift(seconds = BAR * 2): void {
    this.liftUntil = Math.max(this.liftUntil, this.ctx.currentTime + seconds);
  }

  private pump(): void {
    if (this.ctx.state !== "running") return;

    // Backgrounding the app suspends the context, and on resume the audio clock
    // has moved on while this cursor has not. Catching up would mean scheduling
    // every missed bar at once, all with a start time already in the past —
    // which the graph plays immediately, as one very loud noise on returning to
    // the game. So the cursor is dragged forward to now first, and the bed
    // simply picks up where the player is rather than where they left.
    if (this.nextTime < this.ctx.currentTime) this.nextTime = this.ctx.currentTime + 0.05;

    const horizon = this.ctx.currentTime + BAR * LOOKAHEAD_BARS;
    let guard = 0;
    while (this.nextTime < horizon && guard++ < 8) {
      // Changes are taken here, which is by definition a bar line.
      this.world = this.pendingWorld;
      this.intensity = this.pendingIntensity;
      // A bar is lifted if it *starts* inside the window, so a lift raised now
      // reaches whichever bars have not been built yet and no others.
      const lift = this.nextTime < this.liftUntil ? 1 : 0;
      try {
        scheduleBar(
          this.bus,
          this.out,
          this.nextBar,
          this.world,
          this.intensity,
          this.nextTime,
          lift,
        );
      } catch {
        // A bar that will not build is not worth stopping the music for.
      }
      this.nextBar += 1;
      this.nextTime += BAR;
    }
  }
}
