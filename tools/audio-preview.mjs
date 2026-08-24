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
  { name: "01-place", seconds: 1.6, events: [["place", 0, 0, 3]] },
  {
    name: "02-place-run",
    seconds: 2.6,
    // Four placements at different radii. The disc is the keyboard, so this is
    // what filling it in actually sounds like.
    events: [
      ["place", 0, 0, 5],
      ["place", 0, 0.28, 3],
      ["place", 0, 0.56, 4],
      ["place", 0, 0.84, 1],
    ],
  },
  { name: "03-spoke", seconds: 2.0, events: [["spoke", 0, 0, 2]] },
  {
    name: "04-spoke-combo",
    seconds: 4.0,
    // A six-clear run. The combo walks up the scale, so this is a melody.
    events: [0, 1, 2, 3, 4, 5].map((level) => ["spoke", level, level * 0.42, 0]),
  },
  { name: "05-ring", seconds: 3.0, events: [["ring", 0, 0, 2]] },
  {
    name: "06-ring-inner-to-outer",
    seconds: 4.2,
    // The same clear on six different rings: inner is the smallest circle and
    // rings highest, outer is the lowest.
    events: [5, 4, 3, 2, 1, 0].map((degree, i) => ["ring", 0, i * 0.6, degree]),
  },
  { name: "07-pure", seconds: 3.4, events: [["pure", 0, 0, 2]] },
  { name: "08-stripe", seconds: 2.6, events: [["stripe", 0, 0, 2]] },
  { name: "09-spin", seconds: 1.8, events: [["spin", 0, 0, 3]] },
  { name: "10-denied", seconds: 1.2, events: [["denied", 0, 0, 0]] },
  { name: "11-game-over", seconds: 4.0, events: [["gameOver", 0, 0, 0]] },
  {
    name: "12-bonus",
    seconds: 5.5,
    // The signature, at its three sizes: a stripe, a pure clear, a bullseye.
    events: [
      ["bonus", 0, 0, 3],
      ["bonus", 1, 1.6, 2],
      ["bonus", 2, 3.2, 4],
    ],
  },
  {
    name: "13-a-typical-turn",
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

await mkdir(OUT, { recursive: true });

const server = await createServer({ server: { port: 5218, host: "127.0.0.1" }, logLevel: "warn" });
await server.listen();
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
await page.goto("http://127.0.0.1:5218/", { waitUntil: "networkidle" });

const results = [];

for (const take of TAKES) {
  const rendered = await page.evaluate(
    async ({ take, rate }) => {
      const audio = await import("/src/platform/audio.ts");
      const ctx = new OfflineAudioContext(2, Math.ceil(rate * take.seconds), rate);
      const bus = audio.createBus(ctx, ctx.destination);

      for (const [sound, level, at, degree] of take.events) {
        audio.schedule(bus, sound, level, at, degree ?? 0);
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
      const window = Math.floor(rate * 0.3);
      let running = 0;
      let loudest = 0;
      const squares = new Float64Array(frames);

      for (let i = 0; i < frames; i++) {
        const l = left[i];
        const r = right[i];
        peak = Math.max(peak, Math.abs(l), Math.abs(r));
        squares[i] = (l * l + r * r) / 2;

        running += squares[i];
        if (i >= window) running -= squares[i - window];
        if (i >= window) loudest = Math.max(loudest, running / window);

        view.setInt16(44 + i * 4, Math.max(-1, Math.min(1, l)) * 32767, true);
        view.setInt16(46 + i * 4, Math.max(-1, Math.min(1, r)) * 32767, true);
      }

      let binary = "";
      const raw = new Uint8Array(bytes);
      for (let i = 0; i < raw.length; i++) binary += String.fromCharCode(raw[i]);

      return { wav: btoa(binary), peak, loudness: Math.sqrt(loudest) };
    },
    { take, rate: RATE },
  );

  await writeFile(`${OUT}/${take.name}.wav`, Buffer.from(rendered.wav, "base64"));
  results.push({ name: take.name, peak: rendered.peak, loudness: rendered.loudness });
}

await browser.close();
await server.close();

const db = (value) => (value <= 0 ? "-inf" : (20 * Math.log10(value)).toFixed(1));

console.log("\ntake                   peak      peak dB   loudest 300ms");
console.log("-".repeat(58));
const problems = [];
for (const row of results) {
  const flag = row.peak >= 0.999 ? "  CLIPPING" : row.peak < 0.02 ? "  NEARLY SILENT" : "";
  if (flag) problems.push(`${row.name}:${flag.trim()}`);
  console.log(
    row.name.padEnd(22) +
      row.peak.toFixed(3).padStart(6) +
      db(row.peak).padStart(11) +
      db(row.loudness).padStart(15) +
      flag,
  );
}

console.log(`\n${results.length} takes written to ${OUT}/`);
console.log(problems.length ? `problems: ${problems.join(", ")}` : "no clipping, nothing silent");
process.exit(problems.length ? 1 : 0);
