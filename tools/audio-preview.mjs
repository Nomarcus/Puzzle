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
  { name: "09-bullseye", seconds: 4.0, events: [["bullseye", 0, 0, 0]] },
  { name: "10-spin", seconds: 1.8, events: [["spin", 0, 0, 3]] },
  { name: "11-denied", seconds: 1.2, events: [["denied", 0, 0, 0]] },
  { name: "12-game-over", seconds: 4.0, events: [["gameOver", 0, 0, 0]] },
  {
    name: "13-voice-english",
    seconds: 6.0,
    // Exactly what the banners say, read by the formant voice.
    events: [
      ["say:BULLSEYE!", 0, 0, 4],
      ["say:STRIPE!", 0, 1.5, 3],
      ["say:ALL ONE COLOUR!", 0, 2.7, 2],
      ["say:DOUBLE STRIPE!", 0, 4.4, 3],
    ],
  },
  {
    name: "14-voice-swedish",
    seconds: 6.0,
    // The same code, the Swedish strings. Nothing is hand-authored per word.
    events: [
      ["say:FULLTR\u00c4FF!", 0, 0, 4],
      ["say:RAND!", 0, 1.4, 3],
      ["say:ENF\u00c4RGAT!", 0, 2.4, 2],
      ["say:DUBBELRAND!", 0, 4.0, 3],
    ],
  },
  {
    name: "15-bullseye-with-voice",
    seconds: 4.5,
    // How it actually lands: the sweep, then the voice a beat behind it.
    events: [
      ["bullseye", 0, 0, 0],
      ["say:BULLSEYE!", 0, 0.11, 4],
    ],
  },
  {
    name: "16-a-typical-turn",
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
        if (sound.startsWith("say:")) {
          audio.speak(bus, sound.slice(4), at, { degree: degree ?? 2 });
        } else {
          audio.schedule(bus, sound, level, at, degree ?? 0);
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

// --- do the formants actually make vowels? ---------------------------------
// The voice claims to be vowel-shaped, and I cannot hear it. What can be
// checked is the physics: an "ah" should carry more energy around 1150 Hz than
// around 2300 Hz, and an "ee" the other way round. If that holds, the
// resonances are where they were put and the vowels are distinguishable.
const vowelCheck = await page.evaluate(async ({ rate }) => {
  const audio = await import("/src/platform/audio.ts");

  const energyAt = (samples, freq) => {
    // One Goertzel-ish bin: correlate against a sine and a cosine at freq.
    let re = 0;
    let im = 0;
    const step = (2 * Math.PI * freq) / rate;
    for (let i = 0; i < samples.length; i++) {
      re += samples[i] * Math.cos(step * i);
      im += samples[i] * Math.sin(step * i);
    }
    return Math.hypot(re, im) / samples.length;
  };

  const band = (samples, centre) => {
    // A little either side, so a harmonic landing off-centre still counts.
    let total = 0;
    for (let f = centre * 0.85; f <= centre * 1.15; f += 25) total += energyAt(samples, f);
    return total;
  };

  const render = async (text) => {
    const ctx = new OfflineAudioContext(1, Math.ceil(rate * 0.8), rate);
    const bus = audio.createBus(ctx, ctx.destination);
    audio.speak(bus, text, 0, { degree: 2 });
    const buffer = await ctx.startRendering();
    // The sustained middle of the syllable, past the consonant transient.
    return buffer.getChannelData(0).slice(Math.floor(rate * 0.12), Math.floor(rate * 0.32));
  };

  const ah = await render("MA");
  const ee = await render("MI");

  return {
    ahLow: band(ah, 1150),
    ahHigh: band(ah, 2300),
    eeLow: band(ee, 1150),
    eeHigh: band(ee, 2300),
  };
}, { rate: RATE });

await browser.close();
await server.close();

const ratio = (a, b) => (b === 0 ? Infinity : a / b);
const ahIsOpen = ratio(vowelCheck.ahLow, vowelCheck.ahHigh);
const eeIsClosed = ratio(vowelCheck.eeHigh, vowelCheck.eeLow);

console.log("\nvowel check");
console.log("-".repeat(54));
console.log(`  "ah" energy at 1150 Hz vs 2300 Hz   ${ahIsOpen.toFixed(1)}x`);
console.log(`  "ee" energy at 2300 Hz vs 1150 Hz   ${eeIsClosed.toFixed(1)}x`);

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

if (ahIsOpen < 1.5) problems.push('the "ah" vowel is not open — F2 is in the wrong place');
if (eeIsClosed < 1.5) problems.push('the "ee" vowel is not closed — F2 is in the wrong place');

console.log(`\n${results.length} takes written to ${OUT}/`);
console.log(problems.length ? `problems: ${problems.join(", ")}` : "no clipping, nothing silent, vowels distinguishable");
process.exit(problems.length ? 1 : 0);
