/**
 * The white screen Marcus hit: "spin twice in a row and the page goes blank."
 *
 * Drives real spin gestures through a real browser and, after each one, asks
 * the canvas two questions a screenshot cannot answer: is the drawing
 * transform still the one we set, and is there still more than one colour on
 * screen. A blank page shows up here as a runaway transform and a canvas that
 * has collapsed to a single flat colour.
 */
import { chromium } from "playwright";
import { createServer } from "vite";
import { mkdir } from "node:fs/promises";

const OUT = "tools/out";
const VIEWPORT = { width: 390, height: 844 };
const SPINS = 14;

await mkdir(OUT, { recursive: true });

const server = await createServer({ server: { port: 5209, host: "127.0.0.1" }, logLevel: "warn" });
await server.listen();

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

const problems = [];
page.on("pageerror", (e) => problems.push("PAGE ERROR: " + (e.stack ?? e.message)));
page.on("console", (m) => {
  const text = m.text();
  if (m.type() === "error" && !text.includes("favicon") && !text.includes("404")) {
    problems.push("CONSOLE: " + text);
  }
});
page.on("crash", () => problems.push("PAGE CRASHED"));

const headerBottom = 74 + 82;
const trayTop = VIEWPORT.height - 168 - 14;
const boardRadius = Math.min(VIEWPORT.width * 0.485, (trayTop - headerBottom) / 2 - 10);
const cx = VIEWPORT.width / 2;
const cy = headerBottom + (trayTop - headerBottom) / 2;

const onDisc = (ringFraction, angleDeg) => {
  const radius = boardRadius * ringFraction;
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
};

/** A tangential swipe: the spin gesture, well past the commit threshold. */
async function spinGesture(fromDeg, toDeg, ringFraction = 0.86) {
  const from = onDisc(ringFraction, fromDeg);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    const p = onDisc(ringFraction, fromDeg + ((toDeg - fromDeg) * i) / 12);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(8);
  }
  await page.mouse.up();
  await page.waitForTimeout(180);
}

/**
 * What the canvas actually looks like. The transform tells us whether a frame
 * leaked a save; the colour count tells us whether anything is still visible.
 */
const probe = () =>
  page.evaluate(() => {
    const canvas = document.querySelector("#board");
    const ctx = canvas.getContext("2d");
    const m = ctx.getTransform();

    // Sample a coarse grid rather than every pixel; we only need "is there
    // more than one thing on screen".
    const seen = new Set();
    const step = 24;
    for (let y = step; y < canvas.height; y += step) {
      for (let x = step; x < canvas.width; x += step) {
        const d = ctx.getImageData(x, y, 1, 1).data;
        seen.add(`${d[0]},${d[1]},${d[2]}`);
      }
    }

    return {
      transform: [m.a, m.b, m.c, m.d, m.e, m.f].map((v) => Math.round(v * 100) / 100),
      colours: seen.size,
      alive: window.__shiftle?.frameAlive?.() ?? null,
      spins: window.__shiftle?.state?.()?.spins ?? null,
    };
  });

await page.goto("http://127.0.0.1:5209/", { waitUntil: "networkidle" });
await page.waitForTimeout(300);
await page.locator('[data-action="endless"]').click();
await page.waitForTimeout(200);
await page.locator('[data-action="start"]').click();
await page.waitForTimeout(400);

// A jammed disc in one colour: every spin completes a line, so this is the
// clear-by-spin path over and over, which is where the bug lives.
await page.evaluate(() => window.__shiftle.jam(60));
await page.waitForTimeout(200);

const baseline = await probe();
console.log("baseline", JSON.stringify(baseline));

let worst = { colours: Infinity, at: -1 };
let drifted = null;

for (let i = 0; i < SPINS; i++) {
  await spinGesture(i * 30, i * 30 + 34);
  const now = await probe();
  if (now.colours < worst.colours) worst = { colours: now.colours, at: i };
  const same = now.transform.every((v, k) => Math.abs(v - baseline.transform[k]) < 0.01);
  if (!same && !drifted) drifted = { at: i, transform: now.transform };
  console.log(`spin ${i + 1}: colours=${now.colours} spins=${now.spins} transform=${JSON.stringify(now.transform)}`);
}

await page.screenshot({ path: `${OUT}/spin-stress.png` });

console.log("\n--- verdict ---");
if (drifted) {
  problems.push(`TRANSFORM DRIFTED at spin ${drifted.at + 1}: ${JSON.stringify(drifted.transform)}`);
}
// A live board has the backdrop, the plate, eight block colours and the tray.
// Anything under a handful of distinct colours means the screen has gone flat.
if (worst.colours < 6) {
  problems.push(`SCREEN WENT FLAT at spin ${worst.at + 1}: only ${worst.colours} distinct colours`);
}
const final = await probe();
if (!final.alive) problems.push("ANIMATION LOOP DIED");

if (problems.length === 0) console.log("(no problems)");
for (const p of problems) console.log(p);

await browser.close();
await server.close();
process.exit(problems.length ? 1 : 0);
