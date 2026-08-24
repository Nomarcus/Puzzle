/**
 * Shiftle's instrument.
 *
 * Still synthesised — no audio files, nothing to license, the bundle stays
 * tiny. But this is not a set of game beeps with reverb on them any more. The
 * whole palette is one made-up instrument, somewhere between a kalimba, a
 * handpan and a glass bowl, and it exists so the game sounds like itself
 * rather than like every other block puzzle.
 *
 * Three ideas hold it together.
 *
 * **Struck, not blown.** Every voice is a stack of partials with
 * frequency-dependent decays — high partials die first, exactly as they do on
 * a real struck object — over a scrap of filtered noise for the strike itself.
 * That is why it reads as something being hit rather than as an oscillator
 * being switched on. (Karplus-Strong would be the textbook route, but a
 * feedback delay loop in WebAudio is clamped to one render quantum, which caps
 * the pitch around 375 Hz and puts half the keyboard out of tune. Additive
 * partials cost more nodes and behave the same on every engine.)
 *
 * **The board is the keyboard.** Pitch is not decoration: it comes from where
 * on the disc something happened. The inner ring is the smallest circle, so it
 * rings highest; the outer ring is the lowest. Spokes are laid out around the
 * dial like a clock face, one scale degree per sector. Fill the disc and it
 * plays itself — and no square-grid game can copy that.
 *
 * **One scale, so nothing can clash.** Everything is quantised to a D major
 * pentatonic. A pentatonic contains no semitone, so any two notes that happen
 * to land together are consonant no matter what the player does — and it gives
 * the music something to be written against.
 *
 *   D  E  F#  A  B      (D4 = 293.66 Hz)
 *
 * `schedule()` works on any BaseAudioContext, so tools/audio-preview.mjs
 * renders these exact voices offline. The WAVs are not an impression of the
 * game's sound; they are the game's sound.
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

// -------------------------------------------------------------------- scale

/** Semitone offsets of a major pentatonic, and the root they sit on. */
const PENTATONIC = [0, 2, 4, 7, 9];
const ROOT = 293.66; // D4

/**
 * The nth note of the scale, counting up from the root and wrapping into
 * higher octaves. Negative indices go below it. Nothing can produce a wrong
 * note, which is why callers can hand it a raw ring or sector index.
 */
export function note(index: number): number {
  const length = PENTATONIC.length;
  const degree = ((index % length) + length) % length;
  const octave = Math.floor(index / length);
  return ROOT * Math.pow(2, octave + PENTATONIC[degree]! / 12);
}

// ------------------------------------------------------------------- the bus

export interface Bus {
  readonly ctx: BaseAudioContext;
  /** Voices connect here. */
  readonly dry: GainNode;
  /** ...and, as much of themselves as they want reverb on, here. */
  readonly send: GainNode;
  /** One buffer of white noise, shared by every strike. */
  readonly noise: AudioBuffer;
}

/** A fixed sequence, so the game sounds identical every launch. */
function fill(data: Float32Array, seed: number, shape?: (i: number, n: number) => number): void {
  let state = seed;
  for (let i = 0; i < data.length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const value = (state / 0x7fffffff) % 1;
    data[i] = shape ? value * shape(i, data.length) : value;
  }
}

function makeNoise(ctx: BaseAudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
  fill(buffer.getChannelData(0), 0x2f6e2b1);
  return buffer;
}

/**
 * The room, as decaying noise.
 *
 * Longer and softer than a game normally gets away with — 1.8 seconds — because
 * this instrument is meant to ring. The two channels use different seeds, which
 * is what makes it feel wide rather than like one echo.
 */
function makeRoom(ctx: BaseAudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 1.8);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  const curve = (i: number, n: number) => Math.pow(1 - i / n, 2.2);
  fill(buffer.getChannelData(0), 0x1a3f77d, curve);
  fill(buffer.getChannelData(1), 0x5c81b3f, curve);
  return buffer;
}

export function createBus(ctx: BaseAudioContext, destination: AudioNode): Bus {
  const master = ctx.createGain();
  master.gain.value = 0.62;

  // Glue, and a ceiling. Six clears landing together would otherwise tear.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -14;
  limiter.knee.value = 8;
  limiter.ratio.value = 8;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.18;

  master.connect(limiter);
  limiter.connect(destination);

  const dry = ctx.createGain();
  dry.connect(master);

  const reverb = ctx.createConvolver();
  reverb.buffer = makeRoom(ctx);
  const wet = ctx.createGain();
  wet.gain.value = 0.55;
  reverb.connect(wet);
  wet.connect(master);

  const send = ctx.createGain();
  send.connect(reverb);

  return { ctx, dry, send, noise: makeNoise(ctx) };
}

// ------------------------------------------------------------------- voices

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
 * Attack and decay, both exponential.
 *
 * Exponential ramps cannot touch zero, hence the near-silent floor. The tiny
 * attack matters more than it looks: a gain that jumps straight to full clicks,
 * and on a phone speaker that click is louder than the note underneath it.
 */
function shape(gain: GainNode, when: number, peak: number, attack: number, decay: number): number {
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
  return when + attack + decay + 0.02;
}

interface Partial {
  /** Multiple of the fundamental. Deliberately not whole numbers. */
  readonly ratio: number;
  readonly gain: number;
  /** Fraction of the voice's decay this partial gets. */
  readonly decay: number;
}

interface StruckOptions {
  readonly at?: number;
  readonly freq: number;
  readonly peak: number;
  readonly decay: number;
  readonly attack?: number;
  readonly send?: number;
  /** Detune in cents for a second, slightly-off copy. Makes it shimmer. */
  readonly beat?: number;
  readonly type?: OscillatorType;
}

/**
 * One struck note.
 *
 * The partial table is the instrument's character: the ratios decide whether it
 * reads as wood, metal or glass, and the per-partial decays decide how it
 * settles. A real struck object loses its high partials first, which is why
 * these get shorter decays the higher they go.
 */
function struck(bus: Bus, when: number, partials: readonly Partial[], options: StruckOptions): void {
  const start = when + (options.at ?? 0);
  const attack = options.attack ?? 0.003;

  for (const partial of partials) {
    // A detuned twin beats slowly against the original. That is the whole
    // trick behind glass and singing bowls, and it costs one oscillator.
    const voices = options.beat ? [-options.beat / 2, options.beat / 2] : [0];

    for (const cents of voices) {
      const osc = bus.ctx.createOscillator();
      const gain = bus.ctx.createGain();
      osc.type = options.type ?? "sine";
      osc.frequency.value = options.freq * partial.ratio * Math.pow(2, cents / 1200);

      const end = shape(
        gain,
        start,
        (options.peak * partial.gain) / voices.length,
        attack,
        options.decay * partial.decay,
      );
      osc.connect(gain);
      route(bus, gain, options.send ?? 0);
      osc.start(start);
      osc.stop(end);
    }
  }
}

interface NoiseOptions {
  readonly at?: number;
  readonly peak: number;
  readonly decay: number;
  readonly attack?: number;
  readonly type?: BiquadFilterType;
  readonly from: number;
  readonly to?: number;
  readonly q?: number;
  readonly send?: number;
}

/** The strike itself. Short, filtered, and the reason a note sounds hit. */
function noiseBurst(bus: Bus, when: number, options: NoiseOptions): void {
  const start = when + (options.at ?? 0);
  const source = bus.ctx.createBufferSource();
  source.buffer = bus.noise;
  source.playbackRate.value = 0.9 + ((start * 7.3) % 1) * 0.3;

  const filter = bus.ctx.createBiquadFilter();
  filter.type = options.type ?? "lowpass";
  filter.Q.value = options.q ?? 1;
  filter.frequency.setValueAtTime(options.from, start);
  if (options.to) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, options.to), start + options.decay);
  }

  const gain = bus.ctx.createGain();
  const end = shape(gain, start, options.peak, options.attack ?? 0.001, options.decay);

  source.connect(filter);
  filter.connect(gain);
  route(bus, gain, options.send ?? 0);
  source.start(start, ((start * 3.1) % 1) * 1.5);
  source.stop(end);
}

/** The body. A low sine falling in pitch — this is what "weight" actually is. */
function thump(
  bus: Bus,
  when: number,
  options: { at?: number; freq: number; to: number; peak: number; decay: number; send?: number },
): void {
  const start = when + (options.at ?? 0);
  const osc = bus.ctx.createOscillator();
  const gain = bus.ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(options.freq, start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, options.to), start + options.decay);

  const end = shape(gain, start, options.peak, 0.004, options.decay);
  osc.connect(gain);
  route(bus, gain, options.send ?? 0);
  osc.start(start);
  osc.stop(end);
}

/**
 * A ratchet: a run of tiny wooden ticks that speeds up and settles.
 *
 * This is the spin, and it is the most deliberately odd thing in here. A ring
 * turning under a thumb is a mechanism, not a breath, so it gets clicks rather
 * than the whoosh every other game reaches for — closer to a thumb run along a
 * comb, or an old rotary dial coming back.
 */
function ratchet(
  bus: Bus,
  when: number,
  options: { ticks: number; span: number; freq: number; peak: number; send?: number },
): void {
  for (let i = 0; i < options.ticks; i++) {
    const t = i / (options.ticks - 1);
    // Eased, so it accelerates away and settles rather than running at a
    // constant machine rate.
    const eased = t - Math.sin(t * Math.PI * 2) / (Math.PI * 2);

    noiseBurst(bus, when, {
      at: eased * options.span,
      type: "bandpass",
      from: options.freq * (1 + t * 0.5),
      to: options.freq * 0.6,
      q: 2.5,
      // Each tick quieter than the last: the wheel is slowing.
      peak: options.peak * (1 - t * 0.55),
      decay: 0.02,
      send: options.send ?? 0.12,
    });
  }
}

// ------------------------------------------------------------- instruments

/** Wood. A kalimba tine, or a block set on a table: warm, short, no shimmer. */
const TINE: readonly Partial[] = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 2.76, gain: 0.28, decay: 0.42 },
  { ratio: 5.4, gain: 0.1, decay: 0.18 },
];

/**
 * Metal. A handpan: the octave and the fifth are tuned in, which is what makes
 * one sound like a chord being struck rather than a note.
 */
const PAN: readonly Partial[] = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 2.01, gain: 0.5, decay: 0.72 },
  { ratio: 3.02, gain: 0.28, decay: 0.5 },
  { ratio: 4.94, gain: 0.1, decay: 0.3 },
  { ratio: 6.31, gain: 0.05, decay: 0.18 },
];

/** Glass. Few partials, very long, and it beats against itself. */
const GLASS: readonly Partial[] = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 2, gain: 0.32, decay: 0.65 },
  { ratio: 5.43, gain: 0.06, decay: 0.25 },
];

// -------------------------------------------------------------- the sounds

/**
 * How loud each sound sits relative to the others.
 *
 * Set against measurement rather than by ear: tools/audio-preview.mjs reports
 * the loudest 300 ms of each voice, and these are the trims that put them where
 * they belong. A placement is the floor because it happens constantly; a
 * bullseye is the ceiling because it happens once a session.
 */
const TRIM: Record<Sound, number> = {
  place: 1.07,
  spin: 0.69,
  denied: 1.37,
  spoke: 0.72,
  stripe: 0.93,
  pure: 0.59,
  ring: 0.572,
  gameOver: 0.292,
  bullseye: 0.63,
};

/**
 * Everything the game can say.
 *
 * `level` is the combo, which walks everything up the scale, so a run of clears
 * is a melody rather than a siren. `at` is where on the disc it happened, as a
 * scale degree — the caller derives it from the ring or the sector.
 */
export function schedule(bus: Bus, sound: Sound, level = 0, when = 0, at = 0): void {
  const gain = TRIM[sound];
  const dry = bus.ctx.createGain();
  dry.gain.value = gain;
  dry.connect(bus.dry);
  const send = bus.ctx.createGain();
  send.gain.value = gain;
  send.connect(bus.send);
  bus = { ctx: bus.ctx, dry, send, noise: bus.noise };

  const degree = at + Math.min(level, 7);

  switch (sound) {
    case "place": {
      // A wooden tine, tuned to the ring it landed on, under a soft thock.
      noiseBurst(bus, when, { from: 2000, to: 700, peak: 0.2, decay: 0.026 });
      struck(bus, when, TINE, { freq: note(at - 5), peak: 0.34, decay: 0.26, send: 0.14 });
      thump(bus, when, { freq: 150, to: 96, peak: 0.34, decay: 0.09 });
      break;
    }

    case "spoke": {
      // The bread-and-butter clear: the same tine struck harder, with the
      // handpan an octave below holding it up.
      noiseBurst(bus, when, { from: 5000, to: 1800, peak: 0.13, decay: 0.018 });
      struck(bus, when, TINE, { freq: note(degree), peak: 0.34, decay: 0.42, send: 0.3 });
      struck(bus, when, PAN, {
        at: 0.012,
        freq: note(degree - 5),
        peak: 0.2,
        decay: 0.5,
        send: 0.35,
      });
      thump(bus, when, { freq: 140, to: 88, peak: 0.3, decay: 0.13 });
      break;
    }

    case "ring": {
      // A whole circle closed. The handpan struck three times in quick
      // succession up the scale — a rolled chord, not a stab.
      noiseBurst(bus, when, { from: 6000, to: 1500, peak: 0.18, decay: 0.03 });
      [0, 2, 4].forEach((step, i) => {
        struck(bus, when, PAN, {
          at: i * 0.05,
          freq: note(degree + step),
          peak: 0.3 - i * 0.04,
          decay: 0.9,
          send: 0.45,
        });
      });
      thump(bus, when, { freq: 96, to: 54, peak: 0.72, decay: 0.34, send: 0.1 });
      break;
    }

    case "pure": {
      // One colour, all the way round. Glass: slow to speak, slow to fade, and
      // beating gently against itself the whole time.
      noiseBurst(bus, when, { from: 8000, to: 3000, peak: 0.08, decay: 0.012 });
      struck(bus, when, GLASS, {
        freq: note(degree + 5),
        peak: 0.4,
        decay: 1.5,
        attack: 0.03,
        beat: 12,
        send: 0.6,
      });
      struck(bus, when, GLASS, {
        at: 0.09,
        freq: note(degree + 8),
        peak: 0.22,
        decay: 1.2,
        attack: 0.04,
        beat: 14,
        send: 0.6,
      });
      thump(bus, when, { freq: 175, to: 117, peak: 0.28, decay: 0.22 });
      break;
    }

    case "stripe": {
      // A detonation tearing across the disc: the ratchet at speed, a handpan
      // struck flat with a triangle edge on it, and a sub underneath.
      ratchet(bus, when, { ticks: 9, span: 0.13, freq: 2600, peak: 0.2, send: 0.25 });
      struck(bus, when, PAN, {
        freq: note(degree),
        peak: 0.3,
        decay: 0.6,
        type: "triangle",
        send: 0.35,
      });
      thump(bus, when, { freq: 110, to: 46, peak: 0.72, decay: 0.32 });
      break;
    }

    case "bullseye": {
      // Everything went. The instrument gets played: five notes up the scale on
      // the handpan, glass over the top, and the deepest sub in the game.
      thump(bus, when, { freq: 78, to: 37, peak: 0.95, decay: 0.7, send: 0.15 });
      noiseBurst(bus, when, {
        type: "bandpass",
        from: 500,
        to: 8000,
        q: 0.9,
        peak: 0.22,
        decay: 0.4,
        send: 0.45,
      });
      [0, 1, 2, 3, 4].forEach((step, i) => {
        struck(bus, when, PAN, {
          at: i * 0.058,
          freq: note(degree + step),
          peak: 0.3,
          decay: 1.1,
          send: 0.5,
        });
      });
      struck(bus, when, GLASS, {
        at: 0.29,
        freq: note(degree + 10),
        peak: 0.22,
        decay: 1.6,
        attack: 0.05,
        beat: 16,
        send: 0.65,
      });
      break;
    }

    case "spin": {
      // The signature. A mechanism turning, not air moving.
      ratchet(bus, when, { ticks: 11, span: 0.22, freq: 1800, peak: 0.26 });
      struck(bus, when, TINE, { at: 0.2, freq: note(at), peak: 0.16, decay: 0.3, send: 0.3 });
      break;
    }

    case "denied": {
      // A tine stopped by a thumb: it starts to speak and is damped. The player
      // has done nothing wrong, the board has.
      noiseBurst(bus, when, { from: 500, peak: 0.2, decay: 0.05 });
      struck(bus, when, TINE, { freq: note(-7), peak: 0.3, decay: 0.055 });
      thump(bus, when, { freq: 128, to: 86, peak: 0.34, decay: 0.09 });
      break;
    }

    case "gameOver": {
      // The instrument settling. Three notes down the scale, the last left to
      // ring out into the room.
      [4, 2, 0].forEach((step, i) => {
        struck(bus, when, PAN, {
          at: i * 0.17,
          freq: note(step - 5),
          peak: 0.3,
          decay: i === 2 ? 1.8 : 0.8,
          send: 0.6,
        });
      });
      thump(bus, when, { at: 0.34, freq: 110, to: 55, peak: 0.6, decay: 0.8, send: 0.2 });
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
