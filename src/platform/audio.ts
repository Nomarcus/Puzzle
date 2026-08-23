/**
 * Sound, synthesised rather than sampled.
 *
 * Every noise the game makes is a few oscillators and an envelope, so the app
 * ships no audio files: nothing to license, nothing to download, and the whole
 * bundle stays tiny.
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
  | "spin"
  | "denied"
  | "gameOver";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = readString("muted") === "1";

function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.28;
    master.connect(ctx.destination);
    return ctx;
  } catch {
    return null;
  }
}

/** Call from a real user gesture; browsers refuse to start audio otherwise. */
export function unlock(): void {
  const audio = context();
  if (audio && audio.state === "suspended") void audio.resume().catch(() => {});
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  writeString("muted", next ? "1" : "0");
  if (!next) unlock();
}

interface NoteOptions {
  readonly type?: OscillatorType;
  readonly peak?: number;
  readonly slideTo?: number;
}

function note(freq: number, delay: number, duration: number, options: NoteOptions = {}): void {
  const audio = ctx;
  if (!audio || !master) return;

  const start = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const gain = audio.createGain();

  osc.type = options.type ?? "triangle";
  osc.frequency.setValueAtTime(freq, start);
  if (options.slideTo) osc.frequency.exponentialRampToValueAtTime(options.slideTo, start + duration);

  // A tiny attack instead of an instant one: a hard edge clicks on phone
  // speakers, and the click is louder than the note.
  const peak = options.peak ?? 0.5;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(gain);
  gain.connect(master);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/** A major triad from a root, used for the bigger clears. */
const TRIAD = [1, 1.26, 1.5];

export function play(sound: Sound, level = 0): void {
  if (muted) return;
  const audio = context();
  if (!audio) return;
  if (audio.state === "suspended") void audio.resume().catch(() => {});

  // Combos climb a whole tone at a time, so a run of clears rises in pitch.
  const step = Math.pow(1.122, Math.min(level, 8));

  switch (sound) {
    case "place":
      note(180, 0, 0.07, { type: "sine", peak: 0.35 });
      break;

    case "spoke":
      note(523 * step, 0, 0.1, { peak: 0.4 });
      note(659 * step, 0.055, 0.12, { peak: 0.36 });
      break;

    case "ring":
      TRIAD.forEach((ratio, i) => {
        note(523 * step * ratio, i * 0.05, 0.26, { peak: 0.42 });
      });
      note(261 * step, 0, 0.34, { type: "sine", peak: 0.3 });
      break;

    case "bullseye":
      // The whole disc just went; it gets a run up the scale and a low thump.
      [523, 659, 784, 1047, 1319, 1568].forEach((freq, i) => {
        note(freq, i * 0.055, 0.42, { peak: 0.42 });
      });
      note(98, 0, 0.5, { type: "sine", peak: 0.5 });
      break;

    case "pure":
      // Bright and bell-like, clearly not the ordinary clear.
      [784, 1047, 1319].forEach((freq, i) => {
        note(freq, i * 0.04, 0.3, { type: "sine", peak: 0.45 });
      });
      break;

    case "spin":
      note(320, 0, 0.16, { type: "sine", peak: 0.3, slideTo: 880 });
      break;

    case "denied":
      note(120, 0, 0.14, { type: "square", peak: 0.18 });
      break;

    case "gameOver":
      [440, 349, 262].forEach((freq, i) => {
        note(freq, i * 0.13, 0.34, { peak: 0.38 });
      });
      break;
  }
}
