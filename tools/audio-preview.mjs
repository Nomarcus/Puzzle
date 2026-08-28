/**
 * Renders every sound the game makes to a WAV file.
 *
 * I cannot hear anything from here, and neither can a screenshot. This drives
 * the real `schedule()` from src/platform/audio.ts through an
 * OfflineAudioContext, so what lands in tools/out/audio is not an impression of
 * the game's sound — it is the game's sound, the same graph the app builds.
 *
 * It also prints peak and RMS per sound, which is the part I can judge: a voice
 * that clips, one that is inaudible, and one that is wildly louder than its
 * neighbours all show up here.
 *
 * Run: node tools/audio-preview.mjs
 */

import { chromium } from "playwright";
import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";

const OUT = "tools/out/audio";
const RATE = 48000;

/** Single hits, and the sequences that show whether they sit together. */
const TAKES = [
  { name: "01-start", seconds: 3.0, events: [["start", 0, 0, 2]] },
  { name: "02-place", seconds: 1.6, events: [["place", 0, 0, 3]] },
  {
    name: "03-place-run",
    seconds: 4.0,
    // Eight in a row at the pace someone actually plays. This is the take that
    // matters: a placement sound is judged by the hundredth one, not the first.
    events: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ["place", 0, i * 0.42, [5, 3, 4, 1, 2, 5, 0, 3][i]]),
  },
  { name: "04-spoke", seconds: 2.0, events: [["spoke", 0, 0, 2]] },
  {
    name: "05-spoke-combo",
    seconds: 4.0,
    // A six-clear run. The combo walks up the scale, so this is a melody.
    events: [0, 1, 2, 3, 4, 5].map((level) => ["spoke", level, level * 0.42, 0]),
  },
  { name: "06-ring", seconds: 3.0, events: [["ring", 0, 0, 2]] },
  {
    name: "07-ring-inner-to-outer",
    seconds: 4.2,
    // The same clear on six different rings: inner is the smallest circle and
    // rings highest, outer is the lowest.
    events: [5, 4, 3, 2, 1, 0].map((degree, i) => ["ring", 0, i * 0.6, degree]),
  },
  { name: "08-pure", seconds: 3.4, events: [["pure", 0, 0, 2]] },
  { name: "09-stripe", seconds: 2.6, events: [["stripe", 0, 0, 2]] },
  { name: "10-spin", seconds: 1.8, events: [["spin", 0, 0, 3]] },
  { name: "11-denied", seconds: 1.2, events: [["denied", 0, 0, 0]] },
  { name: "12-game-over", seconds: 4.0, events: [["gameOver", 0, 0, 0]] },
  {
    name: "13-bonus",
    seconds: 5.5,
    // The signature, at its three sizes: a stripe, a pure clear, a bullseye.
    events: [
      ["bonus", 0, 0, 3],
      ["bonus", 1, 1.6, 2],
      ["bonus", 2, 3.2, 4],
    ],
  },
  { name: "14-stone", seconds: 2.0, events: [["stone", 0, 0, 3]] },
  {
    // Stone arrives every few pieces once the ramp is running, so what matters
    // is not how it sounds once but whether a run of them wears you down.
    name: "15-stone-run",
    seconds: 4.0,
    events: [
      ["stone", 0, 0, 4],
      ["place", 0, 0.55, 3],
      ["stone", 0, 1.0, 2],
      ["place", 0, 1.5, 4],
      ["stone", 0, 2.0, 5],
      ["place", 0, 2.5, 1],
      ["stone", 0, 3.0, 3],
    ],
  },
  { name: "16-deeper", seconds: 3.0, events: [["deeper", 0, 0, 0]] },
  {
    name: "17-a-typical-turn",
    seconds: 5.5,
    // What a good minute of play actually sounds like, back to back.
    events: [
      ["place", 0, 0, 4],
      ["place", 0, 0.5, 2],
      ["spoke", 0, 1.0, 3],
      ["place", 0, 1.7, 5],
      ["spin", 0, 2.2, 2],
      ["ring", 1, 2.7, 4],
      ["pure", 2, 3.4, 1],
      ["bonus", 1, 3.4, 2],
    ],
  },
];

/**
 * The music bed. Rendered with `scheduleBar()` directly rather than the live
 * `MusicPlayer` — a bar is a pure function of its index, so this is the same
 * graph the game plays, just driven by hand instead of a lookahead timer.
 *
 * `worldSchedule` is a list of `[atBar, world]` breakpoints — the world in
 * effect at a given bar is whichever breakpoint's `atBar` is the largest one
 * not after it. `intensityRamp` is `[start, end]`, interpolated linearly
 * across the take. `extra` layers one-shot sounds on top, same shape as
 * `events` above. `fanfare` reproduces what `fanfare()` in audio.ts schedules
 * — that function only knows the live singleton context, so the shape is
 * copied here rather than called.
 */
const FANFARE_SHAPES = { record: [0, 2, 4], world: [0, 3, 5], unlock: [0, 4, 7] };

const MUSIC_TAKES = [
  {
    name: "18-music-2min",
    // Marcus asked for at least two minutes of the adaptive bed on its own,
    // sweeping through depth so every layer gets heard: bare at the top,
    // full by the end, with the world's timbre changing along the way.
    bars: 56, // 56 * 2.4s = 134.4s
    worldSchedule: [[0, 0], [14, 1], [28, 2], [42, 3]],
    intensityRamp: [0.05, 1],
  },
  {
    name: "19-music-normal-play",
    // A steady mid-round bed with ordinary placements landing on it — what
    // most of a session actually sounds like.
    bars: 8,
    worldSchedule: [[0, 4]],
    intensityRamp: [0.55, 0.55],
    extra: [
      ["place", 0, 1.1, 4],
      ["place", 0, 3.4, 2],
      ["spoke", 0, 6.0, 3],
      ["place", 0, 8.2, 5],
      ["spin", 0, 11.0, 2],
      ["ring", 1, 14.5, 4],
      ["place", 0, 17.0, 1],
    ],
  },
  {
    name: "20-music-combo",
    // The six-clear combo run, over the bed, so the duck can be judged
    // against something playing rather than silence.
    bars: 5,
    worldSchedule: [[0, 1]],
    intensityRamp: [0.6, 0.6],
    extra: [0, 1, 2, 3, 4, 5].map((level) => ["spoke", level, 1.0 + level * 0.42, 0]),
  },
  {
    name: "21-music-deeper",
    // One depth deeper: the floor moving under a bed already playing.
    bars: 4,
    worldSchedule: [[0, 2]],
    intensityRamp: [0.5, 0.5],
    extra: [["deeper", 0, 3.5, 0]],
  },
  {
    name: "22-music-world-transition",
    // A world change lands on a bar line, so the timbre visibly (audibly)
    // moves at the boundary rather than at a random point mid-bar.
    bars: 8,
    worldSchedule: [[0, 0], [4, 5]],
    intensityRamp: [0.6, 0.6],
    extra: [["deeper", 0, 9.6, 0]],
  },
  {
    name: "23-music-record",
    bars: 4,
    worldSchedule: [[0, 3]],
    intensityRamp: [0.5, 0.5],
    fanfare: { kind: "record", atSeconds: 3.5 },
  },
  {
    name: "24-music-unlock",
    bars: 4,
    worldSchedule: [[0, 3]],
    intensityRamp: [0.5, 0.5],
    fanfare: { kind: "unlock", atSeconds: 3.5 },
  },
  {
    name: "25-music-corefire",
    // The biggest thing the chip does, over the bed — the duck is largest
    // here (0.25) and this is the take that shows whether that is enough.
    bars: 4,
    worldSchedule: [[0, 6]],
    intensityRamp: [0.7, 0.7],
    extra: [["coreFire", 0, 3.5, 0]],
  },
];

await mkdir(OUT, { recursive: true });

const server = await createServer({ server: { port: 5218, host: "127.0.0.1" }, logLevel: "warn" });
await server.listen();
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
await page.goto("http://127.0.0.1:5218/", { waitUntil: "networkidle" });

const results = [];

for (const take of [...TAKES, ...MUSIC_TAKES]) {
  const rendered = await page.evaluate(
    async ({ take, rate, fanfareShapes }) => {
      const audio = await import("/src/platform/audio.ts");
      const music = await import("/src/platform/music.ts");

      // Music takes give a bar count rather than a duration, so the real BAR
      // length (not a copy of it) decides how long the render needs to be.
      const seconds = take.bars ? take.bars * music.BAR + 1.0 : take.seconds;
      const ctx = new OfflineAudioContext(2, Math.ceil(rate * seconds), rate);
      const bus = audio.createBus(ctx, ctx.destination);

      for (const [sound, level, at, degree] of take.events ?? []) {
        audio.schedule(bus, sound, level, at, degree ?? 0);
      }

      if (take.bars) {
        const worldAt = (bar) => {
          let current = take.worldSchedule[0][1];
          for (const [atBar, world] of take.worldSchedule) {
            if (atBar <= bar) current = world;
          }
          return current;
        };
        const [i0, i1] = take.intensityRamp;
        for (let bar = 0; bar < take.bars; bar++) {
          const intensity = take.bars > 1 ? i0 + ((i1 - i0) * bar) / (take.bars - 1) : i0;
          music.scheduleBar(bus, bus.ctx.destination, bar, worldAt(bar), intensity, bar * music.BAR);
        }
        for (const [sound, level, at, degree] of take.extra ?? []) {
          audio.schedule(bus, sound, level, at, degree ?? 0);
        }
        if (take.fanfare) {
          const steps = fanfareShapes[take.fanfare.kind];
          steps.forEach((degree, i) => {
            audio.schedule(bus, "bonus", Math.min(3, i), take.fanfare.atSeconds + i * 0.11, degree);
          });
        }
      }

      const buffer = await ctx.startRendering();
      const left = buffer.getChannelData(0);
      const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;

      // 16-bit PCM, interleaved.
      let peak = 0;
      const frames = buffer.length;
      const bytes = new ArrayBuffer(44 + frames * 4);
      const view = new DataView(bytes);
      const ascii = (offset, text) => {
        for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
      };

      ascii(0, "RIFF");
      view.setUint32(4, 36 + frames * 4, true);
      ascii(8, "WAVEfmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 2, true);
      view.setUint32(24, rate, true);
      view.setUint32(28, rate * 4, true);
      view.setUint16(32, 4, true);
      view.setUint16(34, 16, true);
      ascii(36, "data");
      view.setUint32(40, frames * 4, true);

      // Loudness over a sliding 300 ms window, not over the whole take: a
      // short sound in a long take is mostly silence, and averaging that in
      // makes a loud noise look quiet. The loudest window is what the ear
      // actually reports back, and it is comparable between takes.
      // Energy below ~180 Hz, as a one-pole lowpass over the mix. "More bass"
      // is a claim that ought to be checkable rather than asserted.
      const cutoff = 180;
      const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / rate);
      let lp = 0;
      let lowSum = 0;

      const window = Math.floor(rate * 0.3);
      let running = 0;
      let loudest = 0;
      const squares = new Float64Array(frames);

      for (let i = 0; i < frames; i++) {
        const l = left[i];
        const r = right[i];
        peak = Math.max(peak, Math.abs(l), Math.abs(r));
        squares[i] = (l * l + r * r) / 2;

        lp += alpha * ((l + r) / 2 - lp);
        lowSum += lp * lp;

        running += squares[i];
        if (i >= window) running -= squares[i - window];
        if (i >= window) loudest = Math.max(loudest, running / window);

        view.setInt16(44 + i * 4, Math.max(-1, Math.min(1, l)) * 32767, true);
        view.setInt16(46 + i * 4, Math.max(-1, Math.min(1, r)) * 32767, true);
      }

      let binary = "";
      const raw = new Uint8Array(bytes);
      for (let i = 0; i < raw.length; i++) binary += String.fromCharCode(raw[i]);

      return {
        wav: btoa(binary),
        peak,
        loudness: Math.sqrt(loudest),
        low: Math.sqrt(lowSum / frames),
      };
    },
    { take, rate: RATE, fanfareShapes: FANFARE_SHAPES },
  );

  await writeFile(`${OUT}/${take.name}.wav`, Buffer.from(rendered.wav, "base64"));
  results.push({
    name: take.name,
    peak: rendered.peak,
    loudness: rendered.loudness,
    low: rendered.low,
  });
}

await browser.close();
await server.close();

const db = (value) => (value <= 0 ? "-inf" : (20 * Math.log10(value)).toFixed(1));

console.log("\ntake                   peak      peak dB   loudest 300ms   below 180Hz");
console.log("-".repeat(72));
const problems = [];
for (const row of results) {
  const flag = row.peak >= 0.999 ? "  CLIPPING" : row.peak < 0.02 ? "  NEARLY SILENT" : "";
  if (flag) problems.push(`${row.name}:${flag.trim()}`);
  console.log(
    row.name.padEnd(22) +
      row.peak.toFixed(3).padStart(6) +
      db(row.peak).padStart(11) +
      db(row.loudness).padStart(15) +
      db(row.low).padStart(13) +
      flag,
  );
}

console.log(`\n${results.length} takes written to ${OUT}/`);
console.log(problems.length ? `problems: ${problems.join(", ")}` : "no clipping, nothing silent");
process.exit(problems.length ? 1 : 0);
