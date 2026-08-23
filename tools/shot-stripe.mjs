/** Captures a striped block in the tray, on the board, and detonating. */
import { chromium } from "playwright";
import { createServer } from "vite";

const server = await createServer({ server: { port: 5208, host: "127.0.0.1" }, logLevel: "warn" });
await server.listen();
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto("http://127.0.0.1:5208/", { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await page.locator('[data-action="endless"]').click();
await page.waitForTimeout(250);
await page.locator('[data-action="start"]').click();
await page.waitForTimeout(500);

const primed = await page.evaluate(() => window.__shiftle.primeStripe(2));
await page.waitForTimeout(400);
await page.screenshot({ path: "tools/out/24-stripe-tray.png" });

const before = await page.evaluate(() => window.__shiftle.state());
const events = await page.evaluate((sector) => window.__shiftle.peek({ type: "place", slot: 0, r: 0, s: sector }), primed.sector);
console.log("events: " + JSON.stringify({
  rings: events.clears.rings, spokes: events.clears.spokes,
  stripes: events.stripesFired, sweep: events.sweep, bullseye: events.bullseye,
  pure: events.pureClears, score: events.scoreDelta,
}));
const ok = await page.evaluate((sector) => window.__shiftle.play({ type: "place", slot: 0, r: 0, s: sector }), primed.sector);
await page.waitForTimeout(140);
await page.screenshot({ path: "tools/out/25-stripe-fires.png" });
await page.waitForTimeout(800);

const after = await page.evaluate(() => window.__shiftle.state());
const filled = after.board.cells.filter((c) => c !== 0).length;
console.log(`played=${ok} stripes=${after.stats.stripesFired} rings=${after.stats.ringsCleared} spokes=${after.stats.spokesCleared} filled=${filled} score=${after.score} (was ${before.score})`);

await browser.close();
await server.close();
console.log(errors.length ? "ERRORS: " + errors.join(" | ") : "no errors");
