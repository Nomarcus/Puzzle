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
  | "gameOver";

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

interface PulseOptions {
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

function pulse(bus: Bus, when: number, options: PulseOptions): void {
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
 * The triangle channel: the bass. On the real chip it has no volume control at
 * all — it is on or it is off — so this only steps it coarsely, which keeps
 * that flat, boxy low end.
 */
function tri(
  bus: Bus,
  when: number,
  options: { at?: number; freq: number; peak: number; decay: number; bend?: number; send?: number },
): void {
  const start = safe(when + (options.at ?? 0));
  const osc = bus.ctx.createOscillator();
  osc.type = "triangle";

  const gain = bus.ctx.createGain();
  const end = stair(gain, start, options.peak, options.decay, 0.6);

  const frames = Math.max(1, Math.round((end - start) / FRAME));
  for (let i = 0; i < frames; i++) {
    const semitones = (options.bend ?? 0) * (i / frames);
    osc.frequency.setValueAtTime(options.freq * Math.pow(2, semitones / 12), start + i * FRAME);
  }

  osc.connect(gain);
  route(bus, gain, options.send ?? 0);
  osc.start(start);
  osc.stop(end);
}

interface NoiseOptions {
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

function noise(bus: Bus, when: number, options: NoiseOptions): void {
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
  start: 0.62,
  bonus: 0.72,
  place: 0.72,
  spoke: 0.45,
  stripe: 0.378,
  pure: 0.45,
  ring: 0.49,
  gameOver: 0.36,
  denied: 0.76,
  spin: 1.32,
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
      tri(bus, when, { freq: 104 + shade * 7, peak: 0.42, decay: 0.042 });
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
      tri(bus, when, { freq: note(degree - 10), peak: 0.4, decay: 0.16 });
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
      tri(bus, when, { freq: note(degree - 12), peak: 0.55, decay: 0.4, bend: -5 });
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
      tri(bus, when, { freq: note(degree - 7), peak: 0.42, decay: 0.44 });
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
      tri(bus, when, { freq: note(degree - 12), peak: 0.5, decay: 0.26, bend: -7 });
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
      tri(bus, when, { at: 0.225, freq: note(degree - 5), peak: 0.5, decay: 0.36 });
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
        freq: note(degree - 12),
        peak: 0.6,
        decay: 0.5 + tier * 0.2,
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
      tri(bus, when, { at: 0.48, freq: note(degree - 19), peak: 0.5, decay: 0.5, bend: -7 });
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

/**
 * `at` is where on the disc it happened, as a scale degree. Callers pass a raw
 * ring or sector index; anything out of range wraps into another octave, so no
 * caller can produce a wrong note.
 */
export function play(sound: Sound, level = 0, at = 0): void {
  if (muted) return;
  const target = live();
  if (!target || !ctx) return;
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});

  try {
    schedule(target, sound, level, ctx.currentTime, at);
  } catch {
    // A voice that will not build is not worth interrupting a turn for.
  }
}
