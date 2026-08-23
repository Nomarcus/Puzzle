/** Captures the bullseye: the burst mid-flight, then the swept disc. */
import { chromium } from "playwright";
import { createServer } from "vite";

const server = await createServer({ server: { port: 5203, host: "127.0.0.1" }, logLevel: "warn" });
await server.listen();
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto("http://127.0.0.1:5203/", { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await page.locator('[data-action="endless"]').click();
await page.waitForTimeout(250);
await page.locator('[data-action="start"]').click();
await page.waitForTimeout(500);

const before = await page.evaluate(() => window.__shiftle.primeBullseye());
await page.waitForTimeout(300);
await page.screenshot({ path: "tools/out/13-primed.png" });

// Geometry mirrored from ui/game-screen.ts measure().
const headerBottom = 74 + 38;
const trayTop = 844 - 168 - 14;
const radius = Math.min(390 * 0.485, (trayTop - headerBottom) / 2 - 10);
const cx = 195;
const cy = headerBottom + (trayTop - headerBottom) / 2;

// Ring 0 is the innermost; sector 3 on a 10-sector disc.
const state = await page.evaluate(() => window.__shiftle.state());
const sectors = state.spec.sectors;
const ringMid = radius * (0.34 + (1 - 0.34) * (0.5 / state.spec.rings));
const angle = (-Math.PI / 2) + (before.hole.s + 0.5) * (Math.PI * 2 / sectors);
const tx = cx + ringMid * Math.cos(angle);
const ty = cy + ringMid * Math.sin(angle);

const slotX = 16 + ((390 - 32) / 3) * 0.5;
const slotY = trayTop + 84;
await page.mouse.move(slotX, slotY);
await page.mouse.down();
for (let k = 1; k <= 14; k++) {
  await page.mouse.move(slotX + (tx - slotX) * k / 14, slotY + (ty + 76 - slotY) * k / 14);
  await page.waitForTimeout(8);
}
await page.mouse.up();

for (const [wait, name] of [[50, "14a"], [120, "14b"], [180, "14c"]]) {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `tools/out/${name}-burst.png`, clip: { x: 0, y: 300, width: 390, height: 400 } });
}
await page.waitForTimeout(700);
await page.screenshot({ path: "tools/out/15-swept.png" });

const after = await page.evaluate(() => window.__shiftle.state());
const filled = after.board.cells.filter((c) => c !== 0).length;
console.log(`score=${after.score} filledAfter=${filled} spins=${after.spins}`);
await browser.close();
await server.close();
console.log(errors.length ? "ERRORS: " + errors.join(" | ") : "no errors");
