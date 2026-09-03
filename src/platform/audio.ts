/**
 * Shiftle's sound chip.
 *
 * Everything the game says is synthesised as if by a 1985 console: two pulse
 * channels, a triangle for the bass, and a noise channel. No samples, nothing
 * to license, and the bundle stays tiny.
 *
 * Square waves alone do not make something sound 8-bit. Four things do, and
 * they are all here:
 *
 * **Stepped volume.** A real chip has sixteen volume levels and changes them
 * once a frame. Nothing glides. An exponential fade — however short — reads as
 * modern immediately, so every envelope here is a staircase of
 * setValueAtTime at 60 Hz, quantised to 4 bits.
 *
 * **Duty cycles.** WebAudio's "square" is a 50% pulse, which is the least
 * characteristic of the four a chip can make. The thin, nasal 12.5% lead is the
 * sound people actually remember, so the pulses are built as PeriodicWaves from
 * the Fourier series of a pulse train and the duty is a parameter.
 *
 * **Arpeggios, not chords.** With two pulse channels you cannot play a triad,
 * so chiptunes flicker between the notes at about 60 Hz and let the ear fuse
 * them. That flutter is the genre's signature more than any waveform is.
 *
 * **LFSR noise.** The percussion is a 15-bit shift register, exactly as the NES
 * does it, including the short mode where the register is 93 steps long and the
 * "noise" comes out metallic and pitched. That is where the zaps come from.
 *
 * No reverb: a chip had none. What it often had was an echo faked in the
 * tracker, so the send bus is a feedback delay instead.
 *
 * Two things survive from the acoustic version because they are design, not
 * timbre. Pitch comes from **where on the disc** something happened — inner
 * ring highest, spokes around the dial — so the board still plays itself. And
 * everything is quantised to a **D major pentatonic**, which has no semitone in
 * it, so nothing a player does can clash and the music has a key to live in.
 *
 *   D  E  F#  A  B      (D4 = 293.66 Hz)
 *
 * `schedule()` works on any BaseAudioContext, so tools/audio-preview.mjs
 * renders these exact voices offline. The WAVs are the game's sound, not an
 * impression of it.
 */

import { readString, writeString } from "./storage.js";
import { MusicPlayer } from "./music.js";

export type Sound =
  | "start"
  | "bonus"
  | "place"
  | "spoke"
  | "ring"
  | "pure"
  | "stripe"
  | "spin"
  | "denied"
  | "gameOver"
  /** The ramp dropping a stone on the rim. */
  | "stone"
  /** One depth deeper. The floor moving. */
  | "deeper"
  /** The countdown, in the last seconds of a timed round. */
  | "tick"
  /** Seconds bought back by a clear. */
  | "gainTime"
  /** The hub reaching full charge. */
  | "coreReady"
  /** The hub going off. The biggest thing the chip does. */
  | "coreFire";

// -------------------------------------------------------------------- scale

const PENTATONIC = [0, 2, 4, 7, 9];
const ROOT = 293.66; // D4

/**
 * The nth note of the scale, wrapping into higher octaves. Negative indices go
 * below the root. Nothing can produce a wrong note, which is why callers hand
 * it a raw ring or sector index.
 */
export function note(index: number): number {
  const length = PENTATONIC.length;
  const degree = ((index % length) + length) % length;
  const octave = Math.floor(index / length);
  return ROOT * Math.pow(2, octave + PENTATONIC[degree]! / 12);
}

// --------------------------------------------------------------- the chip

/** Frames a second. A real chip updates its envelopes on the video frame. */
const FRAME = 1 / 60;
/** Volume is four bits. Sixteen levels, and no values in between. */
const LEVELS = 15;

export interface Bus {
  readonly ctx: BaseAudioContext;
  readonly dry: GainNode;
  /** The tracker echo. Voices send as much of themselves here as they want. */
  readonly send: GainNode;
  /** Long-mode LFSR: hiss. Short-mode: metallic and almost pitched. */
  readonly noiseLong: AudioBuffer;
  readonly noiseShort: AudioBuffer;
  /** One PeriodicWave per duty cycle, made once. */
  readonly pulses: Map<number, PeriodicWave>;
  /** The stepped triangle. The bass channel, and audible on a phone. */
  readonly triangle: PeriodicWave;
}

/**
 * The NES noise channel: a 15-bit shift register, fed back from bit 0 XOR
 * bit 1. Flip the tap to bit 6 and the sequence closes after 93 steps, which
 * stops being noise and starts being a rough metallic tone — the sound every
 * laser and every explosion of the era is built from.
 *
 * Each step is held for a few samples so the buffer covers a useful range once
 * playbackRate shifts it.
 */
function makeLfsr(ctx: BaseAudioContext, short: boolean): AudioBuffer {
  const hold = 8;
  const steps = Math.floor((ctx.sampleRate * 1.5) / hold);
  const buffer = ctx.createBuffer(1, steps * hold, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  let reg = 1;
  for (let i = 0; i < steps; i++) {
    const bit = (reg & 1) ^ ((reg >> (short ? 6 : 1)) & 1);
    reg = (reg >> 1) | (bit << 14);
    // The channel outputs the inverse of bit 0, as a square: full or nothing.
    const value = (reg & 1) === 0 ? 1 : -1;
    for (let j = 0; j < hold; j++) data[i * hold + j] = value;
  }
  return buffer;
}

/**
 * A pulse wave of the given duty, from the Fourier series of a pulse train:
 * the nth sine coefficient is (2 / nπ) · sin(nπd). At d = 0.5 the even terms
 * vanish and this is the familiar square.
 */
function makePulse(ctx: BaseAudioContext, duty: number): PeriodicWave {
  const harmonics = 40;
  const real = new Float32Array(harmonics);
  const imag = new Float32Array(harmonics);
  for (let n = 1; n < harmonics; n++) {
    imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

/**
 * The chip's triangle, which is not a triangle.
 *
 * A real one is a 4-bit counter walking up and down 32 steps, so it is a
 * staircase, and a staircase has harmonics a smooth ramp does not. That matters
 * for more than authenticity: WebAudio's built-in "triangle" is mathematically
 * pure, almost all fundamental, and a 70 Hz fundamental on a phone speaker is
 * simply not there — the driver cannot move that slowly. The steps put energy
 * into the harmonics the speaker *can* reproduce, and the ear reconstructs the
 * missing fundamental from them. That is where the bass comes from on a
 * device with no bass.
 *
 * Built by taking the DFT of the actual step sequence rather than approximating
 * it, so it is the real waveform and not something that resembles it.
 */
function makeStepTriangle(ctx: BaseAudioContext): PeriodicWave {
  const steps = 32;
  const table = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const counter = i < 16 ? 15 - i : i - 16;
    table[i] = (counter / 15) * 2 - 1;
  }

  const harmonics = 32;
  const real = new Float32Array(harmonics);
  const imag = new Float32Array(harmonics);
  for (let n = 1; n < harmonics; n++) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < steps; i++) {
      const phase = (2 * Math.PI * n * i) / steps;
      re += table[i]! * Math.cos(phase);
      im -= table[i]! * Math.sin(phase);
    }
    real[n] = (2 * re) / steps;
    imag[n] = (2 * im) / steps;
  }
  return ctx.createPeriodicWave(real, imag);
}

export function createBus(ctx: BaseAudioContext, destination: AudioNode): Bus {
  const master = ctx.createGain();
  master.gain.value = 0.5;

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -12;
  limiter.knee.value = 6;
  limiter.ratio.value = 8;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.15;

  master.connect(limiter);
  limiter.connect(destination);

  const dry = ctx.createGain();
  dry.connect(master);

  // A tracker echo, not a room: one short delay fed back on itself, darkened a
  // little each pass so it does not fizz.
  const delay = ctx.createDelay(0.5);
  delay.delayTime.value = 0.115;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.32;
  const damp = ctx.createBiquadFilter();
  damp.type = "lowpass";
  damp.frequency.value = 3200;
  const echo = ctx.createGain();
  echo.gain.value = 0.42;

  delay.connect(damp);
  damp.connect(feedback);
  feedback.connect(delay);
  damp.connect(echo);
  echo.connect(master);

  const send = ctx.createGain();
  send.connect(delay);

  const pulses = new Map<number, PeriodicWave>();
  for (const duty of [0.125, 0.25, 0.5]) pulses.set(duty, makePulse(ctx, duty));

  return {
    ctx,
    dry,
    send,
    noiseLong: makeLfsr(ctx, false),
    noiseShort: makeLfsr(ctx, true),
    pulses,
    triangle: makeStepTriangle(ctx),
  };
}

// -------------------------------------------------------------- envelopes

/** Nothing may be scheduled before the context started. */
function safe(when: number): number {
  return Math.max(0, when);
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

/**
 * A staircase, not a fade.
 *
 * The whole 8-bit envelope: hold a level for a frame, drop to the next of
 * sixteen, hold again. `curve` bends where the loudness goes — 1 is a straight
 * line down, higher numbers drop fast and hang on quietly, which is what a
 * percussive chip envelope does.
 */
function stair(
  gain: GainNode,
  when: number,
  peak: number,
  decay: number,
  curve = 1.6,
): number {
  const frames = Math.max(2, Math.min(200, Math.round(decay / FRAME)));
  for (let i = 0; i < frames; i++) {
    const t = i / frames;
    const level = Math.round(peak * Math.pow(1 - t, curve) * LEVELS) / LEVELS;
    gain.gain.setValueAtTime(level, when + i * FRAME);
  }
  const end = when + frames * FRAME;
  gain.gain.setValueAtTime(0, end);
  return end + 0.01;
}

// ----------------------------------------------------------------- voices

export interface PulseOptions {
  readonly at?: number;
  readonly freq: number;
  readonly duty?: number;
  readonly peak: number;
  readonly decay: number;
  readonly curve?: number;
  readonly send?: number;
  /** Stepped pitch slide, in semitones, across the note. */
  readonly bend?: number;
  /** Notes to flicker between, as semitone offsets. The chiptune chord. */
  readonly arp?: readonly number[];
  /** Frames each arpeggio note is held for. Two or three is typical. */
  readonly arpRate?: number;
  /** Fast pitch wobble, in cents. */
  readonly vibrato?: number;
}

export function pulse(bus: Bus, when: number, options: PulseOptions): void {
  const start = safe(when + (options.at ?? 0));
  const osc = bus.ctx.createOscillator();
  const wave = bus.pulses.get(options.duty ?? 0.25);
  if (wave) osc.setPeriodicWave(wave);
  else osc.type = "square";

  const gain = bus.ctx.createGain();
  const end = stair(gain, start, options.peak, options.decay, options.curve);

  // Pitch is stepped too. A chip changes its period register on a frame
  // boundary and holds it; sliding smoothly is the one thing it cannot do.
  const frames = Math.max(1, Math.round((end - start) / FRAME));
  const arp = options.arp;
  const arpRate = options.arpRate ?? 2;

  for (let i = 0; i < frames; i++) {
    const t = i / frames;
    let semitones = (options.bend ?? 0) * t;
    if (arp && arp.length > 0) semitones += arp[Math.floor(i / arpRate) % arp.length]!;
    if (options.vibrato) {
      semitones += (Math.sin(i * 0.9) * options.vibrato) / 100;
    }
    osc.frequency.setValueAtTime(options.freq * Math.pow(2, semitones / 12), start + i * FRAME);
  }

  osc.connect(gain);
  route(bus, gain, options.send ?? 0);
  osc.start(start);
  osc.stop(end);
}

/**
 * The bass channel, in two layers.
 *
 * The stepped triangle is the character, and its steps put energy into
 * harmonics a phone speaker can actually move — but that is energy taken *out*
 * of the fundamental, which is what a pair of headphones reproduces and what
 * anybody means by "more bass". Measured below 180 Hz, the authentic waveform
 * on its own is quieter than the pure one it replaced.
 *
 * So both: the staircase for the tone, and a sine underneath holding the
 * fundamental up. One chip channel became two oscillators, which is the one
 * liberty taken with the hardware here, and it is the difference between bass
 * that is technically present and bass that is felt.
 *
 * On the real chip the triangle has no volume control at all — it is on or it
 * is off — so this only steps it coarsely, which keeps the flat, boxy low end.
 */
export function tri(
  bus: Bus,
  when: number,
  options: {
    at?: number;
    freq: number;
    peak: number;
    decay: number;
    bend?: number;
    send?: number;
    /** How much pure fundamental sits under the staircase. */
    sub?: number;
  },
): void {
  const start = safe(when + (options.at ?? 0));
  const gain = bus.ctx.createGain();
  const end = stair(gain, start, options.peak, options.decay, 0.6);
  const frames = Math.max(1, Math.round((end - start) / FRAME));

  const shaped = bus.ctx.createOscillator();
  shaped.setPeriodicWave(bus.triangle);

  const sub = bus.ctx.createOscillator();
  sub.type = "sine";
  const subGain = bus.ctx.createGain();
  subGain.gain.value = options.sub ?? 1.5;

  for (let i = 0; i < frames; i++) {
    const freq = options.freq * Math.pow(2, ((options.bend ?? 0) * (i / frames)) / 12);
    shaped.frequency.setValueAtTime(freq, start + i * FRAME);
    sub.frequency.setValueAtTime(freq, start + i * FRAME);
  }

  shaped.connect(gain);
  sub.connect(subGain);
  subGain.connect(gain);
  route(bus, gain, options.send ?? 0);

  shaped.start(start);
  shaped.stop(end);
  sub.start(start);
  sub.stop(end);
}

export interface NoiseOptions {
  readonly at?: number;
  readonly peak: number;
  readonly decay: number;
  readonly curve?: number;
  /** 0.25 is deep and slow, 4 is a bright hiss. */
  readonly rate: number;
  readonly rateTo?: number;
  /** Short mode: metallic and nearly pitched. Where lasers come from. */
  readonly short?: boolean;
  readonly send?: number;
}

export function noise(bus: Bus, when: number, options: NoiseOptions): void {
  const start = safe(when + (options.at ?? 0));
  const source = bus.ctx.createBufferSource();
  source.buffer = options.short ? bus.noiseShort : bus.noiseLong;
  source.playbackRate.setValueAtTime(options.rate, start);

  const gain = bus.ctx.createGain();
  const end = stair(gain, start, options.peak, options.decay, options.curve);

  if (options.rateTo) {
    // Stepped, like everything else the chip does.
    const frames = Math.max(1, Math.round((end - start) / FRAME));
    for (let i = 0; i < frames; i++) {
      const t = i / frames;
      source.playbackRate.setValueAtTime(
        options.rate * Math.pow(options.rateTo / options.rate, t),
        start + i * FRAME,
      );
    }
  }

  source.connect(gain);
  route(bus, gain, options.send ?? 0);
  source.start(start, ((start * 3.7) % 1) * 1.2);
  source.stop(end);
}

// -------------------------------------------------------------- the sounds

/**
 * How loud each sound sits relative to the others.
 *
 * Set against measurement rather than by ear: tools/audio-preview.mjs reports
 * the loudest 300 ms of each voice. A placement is the floor because it happens
 * constantly; the bonus is the ceiling because it is the moment the game is for.
 */
const TRIM: Record<Sound, number> = {
  start: 0.156,
  bonus: 0.239,
  place: 0.185,
  spoke: 0.089,
  stripe: 0.102,
  pure: 0.118,
  ring: 0.116,
  gameOver: 0.093,
  denied: 0.09,
  spin: 0.157,
  // Set by tools/audio-preview.mjs against the same loudest-300ms target as
  // the rest. Both were first set by ear and both were wrong: stone came out at
  // -14.7 dB, louder than a ring clear and nearly the bonus, and a run of them
  // drowned everything else. Stone happens every few pieces once the ramp is
  // going, so it belongs down among the small events — noticeable, never a
  // flinch. Going one depth deeper is rare and significant, so it sits about
  // where game over does.
  stone: 0.093,
  deeper: 0.079,
  // The tick fires up to five times in the last five seconds, over whatever
  // else is playing, so it is set low enough to sit under a clear rather than
  // cut through it.
  tick: 0.1,
  gainTime: 0.085,
  // The core is the loudest thing in the game, above even the bonus signature,
  // because it is the rarest and the biggest. Set against the same
  // loudest-300ms measurement as everything else.
  coreReady: 0.115,
  coreFire: 0.2,
};

export function schedule(bus: Bus, sound: Sound, level = 0, when = 0, at = 0): void {
  const gain = TRIM[sound];
  const dry = bus.ctx.createGain();
  dry.gain.value = gain;
  dry.connect(bus.dry);
  const send = bus.ctx.createGain();
  send.gain.value = gain;
  send.connect(bus.send);
  bus = { ...bus, dry, send };

  const degree = at + Math.min(level, 7);

  switch (sound) {
    case "place": {
      // The sound heard most, so the only one that has to survive its own
      // hundredth repeat. It used to be a 12.5% pulse with a bend on it: the
      // thin nasal lead, playing a different note every time, sliding as it
      // went. Fine once, exhausting over a round — a gesture where a tick was
      // wanted.
      //
      // No pulse channel at all now. A dull noise tick and a short low knock:
      // an event, not a note. The ring still colours it, but as brightness
      // rather than melody — the inner rings tick a shade sharper, the outer
      // duller. Enough that a run of placements is not a metronome, far too
      // little to sing.
      const shade = at % 5;
      noise(bus, when, { peak: 0.34, decay: 0.028, rate: 1.35 + shade * 0.11, curve: 2.8 });
      tri(bus, when, { freq: 88 + shade * 6, peak: 0.72, decay: 0.085 });
      break;
    }

    case "coreReady": {
      // The hub filling. A rising arpeggio that resolves upward and *stays*
      // there, ringing, rather than decaying like every other cue — a sound
      // that has not finished is what makes a player look for the thing that
      // is now waiting for them.
      pulse(bus, when, {
        freq: note(degree),
        duty: 0.25,
        peak: 0.4,
        decay: 0.28,
        arp: [0, 4, 7, 12],
        arpRate: 2,
        send: 0.45,
      });
      pulse(bus, when, {
        at: 0.24,
        freq: note(degree + 12),
        duty: 0.125,
        peak: 0.36,
        decay: 0.75,
        vibrato: 26,
        send: 0.6,
      });
      tri(bus, when, { at: 0.24, freq: note(degree - 5), peak: 0.9, decay: 0.7, sub: 2 });
      break;
    }

    case "coreFire": {
      // The disc going up. A downward noise sweep for the detonation, then the
      // whole scale flung upward on both pulse channels over a bass that bends
      // up under it — the one cue allowed to be longer than the animation.
      noise(bus, when, { peak: 0.85, decay: 0.34, rate: 3.6, rateTo: 0.28, curve: 1.6, send: 0.4 });
      noise(bus, when, { at: 0.02, peak: 0.4, decay: 0.12, rate: 1.4, short: true });

      [0, 2, 4, 5, 7].forEach((step, i) => {
        pulse(bus, when, {
          at: 0.06 + i * 0.045,
          freq: note(degree + step),
          duty: 0.25,
          peak: 0.42,
          decay: 0.1,
          curve: 1,
          send: 0.35,
        });
      });
      pulse(bus, when, {
        at: 0.29,
        freq: note(degree + 9),
        duty: 0.5,
        peak: 0.46,
        decay: 0.6,
        arp: [0, 4, 7],
        arpRate: 2,
        vibrato: 20,
        send: 0.55,
      });
      tri(bus, when, { freq: note(degree - 17), peak: 1.1, decay: 0.75, bend: 7, sub: 2.4 });
      break;
    }

    case "tick": {
      // The last five seconds. Rising, so the fifth is plainly worse than the
      // first, and short enough to sit under whatever else is playing — this
      // fires while the player is at their busiest.
      pulse(bus, when, {
        freq: note(2 + at * 2),
        duty: 0.5,
        peak: 0.4,
        decay: 0.055,
        curve: 1.4,
      });
      noise(bus, when, { peak: 0.12, decay: 0.02, rate: 2.6, curve: 3 });
      break;
    }

    case "gainTime": {
      // Seconds back on the clock. Short, bright and up the scale, so it reads
      // as relief in a mode where nothing else does.
      pulse(bus, when, {
        freq: note(degree + 7),
        duty: 0.125,
        peak: 0.34,
        decay: 0.14,
        arp: [0, 5],
        arpRate: 2,
        send: 0.3,
      });
      tri(bus, when, { freq: note(degree - 5), peak: 0.6, decay: 0.16 });
      break;
    }

    case "stone": {
      // Something landing that is not a sweet. Deliberately unmusical: no pulse
      // channel, nothing in the scale. A slow, deep noise thud with a short-mode
      // rattle over it and a triangle knock underneath.
      //
      // It has to be plainly heavier than a placement without being alarming —
      // it happens every few pieces once the ramp is running, and a sound that
      // startles at that rate is a sound people turn off.
      noise(bus, when, { peak: 0.5, decay: 0.13, rate: 0.5, rateTo: 0.22, curve: 2.2 });
      noise(bus, when, { at: 0.01, peak: 0.16, decay: 0.05, rate: 1.1, short: true, curve: 2.6 });
      tri(bus, when, { freq: 62, peak: 1.0, decay: 0.2, bend: -4, sub: 2.2 });
      break;
    }

    case "deeper": {
      // The floor moving. Two notes down the scale on a fat 50% duty, low, with
      // the triangle sliding under them — the same descent as game over, but
      // half the length and nowhere near the bottom, so it reads as a warning
      // rather than an ending.
      [0, -3].forEach((step, i) => {
        pulse(bus, when, {
          at: i * 0.11,
          freq: note(-5 + step),
          duty: 0.5,
          peak: 0.34,
          decay: 0.14,
          curve: 1,
          send: 0.3,
        });
      });
      tri(bus, when, { freq: note(-19), peak: 1.0, decay: 0.42, bend: -3, sub: 2.4 });
      noise(bus, when, { at: 0.22, peak: 0.2, decay: 0.16, rate: 0.4, rateTo: 0.2, curve: 2 });
      break;
    }

    case "spoke": {
      // A quick run up. Two notes rather than a chord, because that is what a
      // pulse channel can actually do in a hurry.
      pulse(bus, when, {
        freq: note(degree),
        duty: 0.25,
        peak: 0.42,
        decay: 0.2,
        arp: [0, 7],
        arpRate: 2,
        send: 0.25,
      });
      tri(bus, when, { freq: note(degree - 12), peak: 0.78, decay: 0.26 });
      noise(bus, when, { peak: 0.14, decay: 0.04, rate: 3.4, curve: 2.2 });
      break;
    }

    case "ring": {
      // A whole circle. A proper arpeggiated chord, flickering through the
      // triad, over a triangle bass that bends down under it.
      pulse(bus, when, {
        freq: note(degree),
        duty: 0.5,
        peak: 0.38,
        decay: 0.42,
        arp: [0, 4, 7, 12],
        arpRate: 2,
        send: 0.4,
      });
      pulse(bus, when, {
        at: 0.03,
        freq: note(degree + 5),
        duty: 0.125,
        peak: 0.2,
        decay: 0.36,
        arp: [0, 7],
        arpRate: 3,
        send: 0.4,
      });
      tri(bus, when, { freq: note(degree - 14), peak: 1.05, decay: 0.55, bend: -5 });
      noise(bus, when, { peak: 0.2, decay: 0.07, rate: 3.8, rateTo: 1.4, curve: 2 });
      break;
    }

    case "pure": {
      // One colour all the way round. A rising figure with vibrato on the tail
      // — the chiptune equivalent of a held, singing note.
      pulse(bus, when, {
        freq: note(degree),
        duty: 0.25,
        peak: 0.4,
        decay: 0.5,
        arp: [0, 5, 12],
        arpRate: 3,
        vibrato: 22,
        send: 0.45,
      });
      tri(bus, when, { freq: note(degree - 12), peak: 0.82, decay: 0.55 });
      break;
    }

    case "stripe": {
      // A laser. Short-mode noise plus a pulse falling fast through an octave
      // and a half: this is exactly how the era made things explode.
      noise(bus, when, {
        peak: 0.34,
        decay: 0.22,
        rate: 3.6,
        rateTo: 0.5,
        short: true,
        curve: 1.4,
        send: 0.3,
      });
      pulse(bus, when, {
        freq: note(degree + 7),
        duty: 0.125,
        peak: 0.32,
        decay: 0.2,
        bend: -18,
        curve: 1.2,
      });
      tri(bus, when, { freq: note(degree - 14), peak: 1.0, decay: 0.36, bend: -7 });
      break;
    }

    case "spin": {
      // A menu tick with a slide in it: short, dry, and it gets out of the way.
      pulse(bus, when, {
        freq: note(at),
        duty: 0.125,
        peak: 0.3,
        decay: 0.11,
        bend: 5,
        curve: 1.1,
      });
      noise(bus, when, { peak: 0.13, decay: 0.06, rate: 1.6, rateTo: 3.2, curve: 1.8 });
      tri(bus, when, { freq: note(at - 14), peak: 0.6, decay: 0.12 });
      break;
    }

    case "denied": {
      // The buzz. Fat 50% duty, low, bent down — every "no" on every console.
      pulse(bus, when, {
        freq: note(-9),
        duty: 0.5,
        peak: 0.36,
        decay: 0.13,
        bend: -3,
        curve: 0.9,
      });
      tri(bus, when, { freq: note(-16), peak: 0.75, decay: 0.16, bend: -3 });
      break;
    }

    case "start": {
      // The level-start fanfare: four notes up the scale, brisk, then the top
      // one held with the bass under it.
      [0, 2, 4].forEach((step, i) => {
        pulse(bus, when, {
          at: i * 0.075,
          freq: note(degree + step),
          duty: 0.25,
          peak: 0.4,
          decay: 0.09,
          curve: 1,
        });
      });
      pulse(bus, when, {
        at: 0.225,
        freq: note(degree + 7),
        duty: 0.25,
        peak: 0.42,
        decay: 0.4,
        vibrato: 18,
        send: 0.4,
      });
      tri(bus, when, { at: 0.225, freq: note(degree - 12), peak: 0.95, decay: 0.5 });
      noise(bus, when, { at: 0.225, peak: 0.16, decay: 0.05, rate: 3.2, curve: 2 });
      break;
    }

    case "bonus": {
      // The signature: the power-up. A pulse climbing the whole scale in
      // frame-length steps, then the chord arpeggiating over a bending bass.
      //
      // `level` is how big the moment was — 0 a stripe, 1 a pure clear, 2 the
      // bullseye. It buys length, another octave on the climb and a fatter tail.
      const tier = Math.min(2, Math.max(0, Math.round(level)));
      const climb = 6 + tier * 3;

      for (let i = 0; i < climb; i++) {
        pulse(bus, when, {
          at: i * 0.035,
          freq: note(degree + i),
          duty: i % 2 === 0 ? 0.125 : 0.25,
          peak: 0.34,
          decay: 0.05,
          curve: 0.8,
        });
      }

      const land = climb * 0.035;
      pulse(bus, when, {
        at: land,
        freq: note(degree + climb),
        duty: 0.5,
        peak: 0.42,
        decay: 0.5 + tier * 0.2,
        arp: [0, 4, 7],
        arpRate: 2,
        vibrato: 20,
        send: 0.5,
      });
      tri(bus, when, {
        at: land,
        freq: note(degree - 14),
        peak: 1.15,
        decay: 0.65 + tier * 0.25,
        bend: 7,
      });
      noise(bus, when, {
        at: land,
        peak: 0.26,
        decay: 0.16 + tier * 0.06,
        rate: 4,
        rateTo: 1.2,
        curve: 1.8,
        send: 0.35,
      });
      break;
    }

    case "gameOver": {
      // The descent. Four notes down, the last bent through the floor with the
      // bass following it. Nobody has ever needed this explained.
      [0, -2, -4].forEach((step, i) => {
        pulse(bus, when, {
          at: i * 0.16,
          freq: note(degree + step),
          duty: 0.5,
          peak: 0.34,
          decay: 0.15,
          curve: 1,
        });
      });
      pulse(bus, when, {
        at: 0.48,
        freq: note(degree - 7),
        duty: 0.25,
        peak: 0.36,
        decay: 0.55,
        bend: -12,
        curve: 1.1,
        send: 0.45,
      });
      tri(bus, when, { at: 0.48, freq: note(degree - 19), peak: 1.0, decay: 0.68, bend: -7 });
      break;
    }
  }
}

// -------------------------------------------------------------- the player

let ctx: AudioContext | null = null;
let bus: Bus | null = null;
let master: GainNode | null = null;
let music: MusicPlayer | null = null;

/**
 * Three switches where there used to be one.
 *
 * The old `muted` key is still read, once, as the migration: somebody who had
 * the whole game silenced gets silence across all three rather than being handed
 * music on first launch because music became its own setting. `main.ts` pushes
 * the stored preferences in through `applyPrefs` as soon as the save is loaded,
 * so this default only ever applies for the instant before that happens.
 */
const legacyMuted = readString("muted") === "1";
let prefs = { music: !legacyMuted, sfx: !legacyMuted, haptics: !legacyMuted };

function live(): Bus | null {
  if (bus) return bus;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  try {
    ctx = new Ctor();

    // destination <- limiter <- master <- [effects, music]
    //
    // The limiter is the answer to several things happening at once: a core
    // firing over a combo over the music used to be able to push past full
    // scale, and clipping on a phone speaker is the ugliest sound the game can
    // make. Set gently — this is a safety net, not a loudness effect.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.18;
    limiter.connect(ctx.destination);

    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(limiter);

    bus = createBus(ctx, master);
    music = new MusicPlayer(bus, ctx, master);
    return bus;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------- settings

export interface AudioPrefs {
  readonly music: boolean;
  readonly sfx: boolean;
  readonly haptics: boolean;
}

export function prefsOf(): AudioPrefs {
  return { ...prefs };
}

/** Applied from the save. Starts or stops the bed to match. */
export function applyPrefs(next: AudioPrefs): void {
  const wasMusic = prefs.music;
  prefs = { ...next };
  if (!prefs.music && wasMusic) stopMusic();
  if (prefs.music && !wasMusic && wantsMusic) startMusic();
}

export function sfxEnabled(): boolean {
  return prefs.sfx;
}

export function hapticsEnabled(): boolean {
  return prefs.haptics;
}

// ------------------------------------------------------------------ music

/** Whether the current screen wants a bed at all. Menus do not. */
let wantsMusic = false;

export function startMusic(): void {
  wantsMusic = true;
  if (!prefs.music) return;
  const target = live();
  if (!target || !ctx || !music) return;
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  music.start();
}

export function stopMusic(): void {
  wantsMusic = false;
  music?.stop();
}

/** Queued to the next bar line, so a world change lands musically. */
export function setMusicWorld(index: number): void {
  music?.setWorld(index);
}

export function setMusicIntensity(value: number): void {
  music?.setIntensity(value);
}

/** For the tests: how many bars the bed has scheduled, and whether it runs. */
export function musicState(): { running: boolean; nodes: number } {
  return { running: music?.running ?? false, nodes: liveNodeCount };
}

/**
 * Dips the bed for a moment so a big event has room.
 *
 * Only the events that are genuinely big — a placement or a spin ducking the
 * music would make the whole bed pump in time with ordinary play, which is
 * exactly the cheap trick this is meant to avoid.
 */
const DUCKS: Partial<Record<Sound, number>> = {
  bonus: 0.22,
  coreFire: 0.25,
  coreReady: 0.15,
  deeper: 0.18,
};

/**
 * The events the bed answers by lifting for a couple of bars.
 *
 * The same set that ducks, and that is not a coincidence: the thing that earns
 * a moment of room is the thing worth answering. The bed dips for the event and
 * comes back *lifted*, so the duck is the run-up rather than a hole.
 *
 * Deliberately the big four only. A lift on every placement or spin would be
 * the same pumping trick the ducking rules out, one layer further up.
 */
const LIFTS: ReadonlySet<Sound> = new Set<Sound>(["bonus", "coreFire", "coreReady", "deeper"]);

function duck(amount: number): void {
  if (!music || !ctx) return;
  const g = music.gain.gain;
  const now = ctx.currentTime;
  try {
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(Math.max(0.2, 1 - amount), now + 0.05);
    g.linearRampToValueAtTime(1, now + 0.55);
  } catch {
    // Automation on a closed context is not worth a thrown turn.
  }
}

/** Counts one-shot nodes started, so a long session can be checked for leaks. */
let liveNodeCount = 0;

/** Call from a real user gesture; browsers refuse to start audio otherwise. */
export function unlock(): void {
  live();
  if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
}

/** True only when everything is off. Kept for the menu's one-tap toggle. */
export function isMuted(): boolean {
  return !prefs.music && !prefs.sfx;
}

/**
 * The old single switch, still here because the menu still offers it.
 *
 * It now writes all three, which is the behaviour somebody tapping "sound off"
 * expects. The legacy key is kept in step so a downgrade does not surprise them.
 */
export function setMuted(next: boolean): void {
  prefs = { music: !next, sfx: !next, haptics: !next };
  writeString("muted", next ? "1" : "0");
  if (next) stopMusic();
  else {
    unlock();
    if (wantsMusic) startMusic();
  }
}

/**
 * `at` is where on the disc it happened, as a scale degree. Callers pass a raw
 * ring or sector index; anything out of range wraps into another octave, so no
 * caller can produce a wrong note.
 */
export function play(sound: Sound, level = 0, at = 0): void {
  if (!prefs.sfx) return;
  const target = live();
  if (!target || !ctx) return;
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});

  try {
    schedule(target, sound, level, ctx.currentTime, at);
    liveNodeCount += 1;
    const amount = DUCKS[sound];
    if (amount !== undefined && prefs.music) duck(amount);
    if (prefs.music && LIFTS.has(sound)) music?.lift();
  } catch {
    // A voice that will not build is not worth interrupting a turn for.
  }
}

/**
 * A short rising run, for the handful of moments that deserve one.
 *
 * A personal best, a new world and a theme unlock are the only things loud
 * enough to interrupt what the player is looking at, and they get three notes
 * rather than a new voice — the chip already has the sound, it just has not been
 * asked to play a phrase before.
 */
export function fanfare(kind: "record" | "world" | "unlock"): void {
  if (!prefs.sfx) return;
  const target = live();
  if (!target || !ctx) return;
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});

  const shape: Record<typeof kind, readonly number[]> = {
    record: [0, 2, 4],
    world: [0, 3, 5],
    unlock: [0, 4, 7],
  };
  const steps = shape[kind];
  try {
    const now = ctx.currentTime;
    steps.forEach((degree, i) => {
      schedule(target, "bonus", Math.min(3, i), now + i * 0.11, degree);
      liveNodeCount += 1;
    });
    if (prefs.music) duck(0.25);
  } catch {
    // Same rule as a single voice: never worth interrupting a turn.
  }
}

/** Called when the app is backgrounded, so nothing keeps running unheard. */
export function suspendAudio(): void {
  music?.stop();
  if (ctx && ctx.state === "running") void ctx.suspend().catch(() => {});
}

/** Called when the app comes back. Only restarts what was wanted. */
export function resumeAudio(): void {
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  if (wantsMusic && prefs.music) startMusic();
}
