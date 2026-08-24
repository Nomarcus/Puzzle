/**
 * Sound, synthesised rather than sampled.
 *
 * Still no audio files — nothing to license, nothing to download, the bundle
 * stays tiny. But a bare oscillator with an envelope on it sounds like a
 * calculator, and that is what this used to be. Three things are what make a
 * game sound physical instead of electronic, and all three are now here:
 *
 *   - a transient. Every real impact starts with a scrap of filtered noise. It
 *     lasts a few milliseconds and it is most of what the ear reads as "that
 *     hit something".
 *   - a body. A low sine dropping in pitch under the hit. This is the weight;
 *     without it everything floats.
 *   - a room. A short convolution reverb, so sounds have somewhere to decay
 *     into rather than stopping dead against the speaker.
 *
 * Plus a compressor across the master, which is what lets a six-clear combo
 * stack up without clipping, and a little pitch jitter so a run of placements
 * does not sound like a machine gun.
 *
 * Building the graph is kept separate from playing it — `schedule()` works on
 * any BaseAudioContext — so tools/audio-preview.mjs can render these exact
 * voices offline to WAV files and they can be listened to without a build.
 *
 * iOS will not let a page make noise until the user has touched it, so the
 * context is created lazily and unlocked from the first pointer event.
 */

import { readString, writeString } from "./storage.js";

export type Sound =
  | "place"
  | "spoke"
  | "ring"
  | "bullseye"
  | "pure"
  | "stripe"
  | "spin"
  | "denied"
  | "gameOver";

// ------------------------------------------------------------------- the bus

export interface Bus {
  readonly ctx: BaseAudioContext;
  /** Voices connect here. */
  readonly dry: GainNode;
  /** ...and, as much of themselves as they want reverb on, here. */
  readonly send: GainNode;
  /** One buffer of white noise, shared by every transient. */
  readonly noise: AudioBuffer;
}

/** White noise, made once. Every click and whoosh is a window onto this. */
function makeNoise(ctx: BaseAudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // A fixed sequence rather than Math.random: the game sounds identical every
  // launch, and the offline previews match what ships.
  let seed = 0x2f6e2b1;
  for (let i = 0; i < data.length; i++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    data[i] = (seed / 0x7fffffff) % 1;
  }
  return buffer;
}

/**
 * A small room, as decaying noise. Real impulse responses are recordings; this
 * is the cheap approximation and it is entirely good enough behind a puzzle —
 * its whole job is to stop notes ending abruptly.
 */
function makeRoom(ctx: BaseAudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 1.1);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  let seed = 0x1a3f77d;

  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const noise = (seed / 0x7fffffff) % 1;
      // Steeper than a real hall: a long tail would smear the next placement.
      const decay = Math.pow(1 - i / length, 2.6);
      data[i] = noise * decay;
    }
  }
  return buffer;
}

export function createBus(ctx: BaseAudioContext, destination: AudioNode): Bus {
  const master = ctx.createGain();
  master.gain.value = 0.62;

  // Glue, and a ceiling. Six clears landing together used to clip; this lets
  // the loud moments stay loud without tearing.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -14;
  limiter.knee.value = 8;
  limiter.ratio.value = 8;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.18;

  master.connect(limiter);
  limiter.connect(destination);

  const dry = ctx.createGain();
  dry.gain.value = 1;
  dry.connect(master);

  const reverb = ctx.createConvolver();
  reverb.buffer = makeRoom(ctx);
  const wet = ctx.createGain();
  wet.gain.value = 0.5;
  reverb.connect(wet);
  wet.connect(master);

  const send = ctx.createGain();
  send.gain.value = 1;
  send.connect(reverb);

  return { ctx, dry, send, noise: makeNoise(ctx) };
}

// ------------------------------------------------------------------- voices

interface Envelope {
  /** Seconds from the start of the sound. */
  readonly at: number;
  readonly peak: number;
  readonly attack?: number;
  readonly decay: number;
  /** 0..1 of this voice routed to the reverb. */
  readonly send?: number;
}

/**
 * Attack and decay, both exponential.
 *
 * Exponential ramps cannot touch zero, hence the near-silent floor. The tiny
 * attack matters more than it looks: a gain that jumps straight to full clicks,
 * and on a phone speaker that click is louder than the note underneath it.
 */
function shape(gain: GainNode, when: number, env: Envelope): number {
  const attack = env.attack ?? 0.004;
  const peak = Math.max(0.0002, env.peak);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(peak, when + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + attack + env.decay);
  return when + attack + env.decay + 0.02;
}

function route(bus: Bus, node: AudioNode, send: number): void {
  node.connect(bus.dry);
  if (send > 0) {
    const tap = bus.ctx.createGain();
    tap.gain.value = send;
    node.connect(tap);
    tap.connect(bus.send);
  }
}

interface ToneOptions extends Envelope {
  readonly freq: number;
  readonly type?: OscillatorType;
  /** Glide to this frequency across the decay. */
  readonly slideTo?: number;
  /** A lowpass that opens or closes with the note. */
  readonly filter?: { from: number; to?: number; q?: number };
}

function tone(bus: Bus, when: number, options: ToneOptions): void {
  const start = when + options.at;
  const osc = bus.ctx.createOscillator();
  const gain = bus.ctx.createGain();

  osc.type = options.type ?? "triangle";
  osc.frequency.setValueAtTime(options.freq, start);
  if (options.slideTo) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(20, options.slideTo),
      start + options.decay,
    );
  }

  let tail: AudioNode = gain;
  if (options.filter) {
    const filter = bus.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = options.filter.q ?? 0.8;
    filter.frequency.setValueAtTime(options.filter.from, start);
    if (options.filter.to) {
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(40, options.filter.to),
        start + options.decay,
      );
    }
    gain.connect(filter);
    tail = filter;
  }

  const end = shape(gain, start, options);
  osc.connect(gain);
  route(bus, tail, options.send ?? 0);
  osc.start(start);
  osc.stop(end);
}

interface NoiseOptions extends Envelope {
  readonly type?: BiquadFilterType;
  readonly from: number;
  readonly to?: number;
  readonly q?: number;
}

/** The transient. Short, filtered, and the reason a hit sounds like a hit. */
function noiseBurst(bus: Bus, when: number, options: NoiseOptions): void {
  const start = when + options.at;
  const source = bus.ctx.createBufferSource();
  source.buffer = bus.noise;
  // A different window of the same noise each time, so repeats do not phase
  // against one another.
  source.playbackRate.value = 0.9 + ((start * 7.3) % 1) * 0.3;

  const filter = bus.ctx.createBiquadFilter();
  filter.type = options.type ?? "lowpass";
  filter.Q.value = options.q ?? 1;
  filter.frequency.setValueAtTime(options.from, start);
  if (options.to) {
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(40, options.to),
      start + options.decay,
    );
  }

  const gain = bus.ctx.createGain();
  const end = shape(gain, start, { ...options, attack: options.attack ?? 0.001 });

  source.connect(filter);
  filter.connect(gain);
  route(bus, gain, options.send ?? 0);
  source.start(start, ((start * 3.1) % 1) * 1.5);
  source.stop(end);
}

/** The body. A low sine falling in pitch — this is what "weight" actually is. */
function thump(bus: Bus, when: number, options: ToneOptions): void {
  tone(bus, when, { type: "sine", ...options });
}

// -------------------------------------------------------------- the sounds

/** Combos climb a whole tone at a time, so a run of clears rises in pitch. */
function step(level: number): number {
  return Math.pow(1.122, Math.min(level, 8));
}

/**
 * How loud each sound sits relative to the others.
 *
 * Set against measurement rather than by ear-guessing: tools/audio-preview.mjs
 * reports the loudest 300 ms of each voice, and these are the trims that put
 * them where they belong. A placement is the floor because it happens
 * constantly; a bullseye is the ceiling because it happens once a session and
 * should feel like it.
 */
const TRIM: Record<Sound, number> = {
  place: 1.76,
  spin: 2.54,
  denied: 1.6,
  spoke: 1.62,
  stripe: 1.17,
  pure: 0.99,
  ring: 1.02,
  gameOver: 0.386,
  bullseye: 0.97,
};

/**
 * Everything the game can say, as a graph on the given bus starting at `when`.
 *
 * Pure with respect to the context, so the offline renderer and the live player
 * produce the same thing — the WAV previews are not an impression of the game's
 * sound, they are the game's sound.
 */
export function schedule(bus: Bus, sound: Sound, level = 0, when = 0): void {
  // Every voice in this call goes through one trim, dry and wet alike, so the
  // balance can be tuned without touching the sound design.
  const gain = TRIM[sound];
  const dry = bus.ctx.createGain();
  dry.gain.value = gain;
  dry.connect(bus.dry);
  const send = bus.ctx.createGain();
  send.gain.value = gain;
  send.connect(bus.send);
  bus = { ctx: bus.ctx, dry, send, noise: bus.noise };

  const rise = step(level);
  // Enough drift that a run of placements does not sound mechanical, small
  // enough that nobody hears it as out of tune.
  const jitter = 1 + (((when * 91.7) % 1) - 0.5) * 0.06;

  switch (sound) {
    case "place": {
      // A block set down on wood: click, then a short low knock.
      noiseBurst(bus, when, { at: 0, from: 2400 * jitter, to: 900, peak: 0.22, decay: 0.03 });
      thump(bus, when, {
        at: 0,
        freq: 200 * jitter,
        slideTo: 110,
        peak: 0.5,
        decay: 0.1,
        send: 0.05,
      });
      tone(bus, when, { at: 0.004, freq: 430 * jitter, peak: 0.07, decay: 0.05 });
      break;
    }

    case "spoke": {
      // The bread-and-butter clear. Bright, quick, and it climbs with the combo.
      const base = 523 * rise;
      noiseBurst(bus, when, { at: 0, from: 6000, to: 2000, peak: 0.14, decay: 0.02 });
      thump(bus, when, { at: 0, freq: 150, slideTo: 90, peak: 0.34, decay: 0.14 });
      tone(bus, when, { at: 0, freq: base, peak: 0.3, decay: 0.16, send: 0.2 });
      tone(bus, when, { at: 0.028, freq: base * 1.5, peak: 0.16, decay: 0.14, send: 0.25 });
      break;
    }

    case "ring": {
      // The prize. A real chord, and a real low end under it.
      const base = 523 * rise;
      noiseBurst(bus, when, { at: 0, from: 7000, to: 1500, peak: 0.2, decay: 0.035 });
      thump(bus, when, { at: 0, freq: 96, slideTo: 54, peak: 0.72, decay: 0.34, send: 0.1 });
      [1, 1.26, 1.5].forEach((ratio, i) => {
        tone(bus, when, {
          at: i * 0.042,
          freq: base * ratio,
          peak: 0.28,
          decay: 0.38,
          send: 0.32,
        });
      });
      break;
    }

    case "pure": {
      // A bell. The partials are deliberately not whole multiples — that
      // inharmonicity is the difference between a bell and an organ.
      const base = 784 * rise;
      noiseBurst(bus, when, { at: 0, from: 9000, to: 3000, peak: 0.12, decay: 0.015 });
      [
        [1, 0.34, 0.7],
        [2.01, 0.2, 0.55],
        [3.02, 0.12, 0.42],
        [4.21, 0.07, 0.3],
      ].forEach(([ratio, peak, decay]) => {
        tone(bus, when, {
          at: 0,
          type: "sine",
          freq: base * ratio!,
          peak: peak!,
          decay: decay!,
          send: 0.45,
        });
      });
      thump(bus, when, { at: 0, freq: 180, slideTo: 120, peak: 0.3, decay: 0.2 });
      break;
    }

    case "stripe": {
      // A detonation, not a chime: something tears across the board.
      noiseBurst(bus, when, {
        at: 0,
        type: "bandpass",
        from: 700,
        to: 7000,
        q: 1.2,
        peak: 0.34,
        decay: 0.2,
        send: 0.3,
      });
      tone(bus, when, {
        at: 0,
        type: "sawtooth",
        freq: 180,
        slideTo: 1100,
        peak: 0.22,
        decay: 0.24,
        filter: { from: 700, to: 5000, q: 2.5 },
        send: 0.25,
      });
      thump(bus, when, { at: 0, freq: 110, slideTo: 48, peak: 0.7, decay: 0.3 });
      break;
    }

    case "bullseye": {
      // The whole disc just went. It gets the sub, a rising sweep and a run up
      // the scale, and it is allowed to be the loudest thing in the game.
      thump(bus, when, { at: 0, freq: 80, slideTo: 38, peak: 0.95, decay: 0.65, send: 0.15 });
      noiseBurst(bus, when, {
        at: 0,
        type: "bandpass",
        from: 400,
        to: 9000,
        q: 0.9,
        peak: 0.3,
        decay: 0.42,
        send: 0.4,
      });
      [523, 659, 784, 1047, 1319, 1568].forEach((freq, i) => {
        tone(bus, when, {
          at: i * 0.052,
          freq,
          peak: 0.3,
          decay: 0.4,
          send: 0.5,
        });
      });
      break;
    }

    case "spin": {
      // The ring turning under a thumb. Air, and something mechanical in it.
      noiseBurst(bus, when, {
        at: 0,
        type: "bandpass",
        from: 500,
        to: 2800,
        q: 1.4,
        peak: 0.18,
        decay: 0.2,
        send: 0.2,
      });
      tone(bus, when, {
        at: 0,
        type: "sine",
        freq: 320,
        slideTo: 880,
        peak: 0.17,
        decay: 0.18,
        send: 0.15,
      });
      break;
    }

    case "denied": {
      // A soft, muffled no. Not a buzzer — the player has done nothing wrong,
      // the board has.
      noiseBurst(bus, when, { at: 0, from: 420, peak: 0.22, decay: 0.06 });
      thump(bus, when, { at: 0, freq: 130, slideTo: 88, peak: 0.38, decay: 0.1 });
      break;
    }

    case "gameOver": {
      // Warm and falling. An ending, not a failure.
      [440, 349, 262].forEach((freq, i) => {
        tone(bus, when, {
          at: i * 0.14,
          freq,
          peak: 0.3,
          decay: 0.45,
          filter: { from: 2600, to: 900 },
          send: 0.5,
        });
      });
      thump(bus, when, { at: 0.28, freq: 131, slideTo: 65, peak: 0.6, decay: 0.7, send: 0.2 });
      break;
    }
  }
}

// -------------------------------------------------------------- the player

let ctx: AudioContext | null = null;
let bus: Bus | null = null;
let muted = readString("muted") === "1";

function live(): Bus | null {
  if (bus) return bus;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  try {
    ctx = new Ctor();
    bus = createBus(ctx, ctx.destination);
    return bus;
  } catch {
    return null;
  }
}

/** Call from a real user gesture; browsers refuse to start audio otherwise. */
export function unlock(): void {
  live();
  if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  writeString("muted", next ? "1" : "0");
  if (!next) unlock();
}

export function play(sound: Sound, level = 0): void {
  if (muted) return;
  const target = live();
  if (!target || !ctx) return;
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});

  try {
    schedule(target, sound, level, ctx.currentTime);
  } catch {
    // A voice that will not build is not worth interrupting a turn for.
  }
}
