/**
 * Renders the five material tiers on the real disc, one PNG and one JPEG each.
 *
 * Uses the game's own renderer through tools/materials.html rather than a
 * mock-up, so what comes out is a screenshot of the thing itself. Run it after
 * touching src/render/material.ts — every tier of this ladder was tuned by
 * looking at the output, and three of the first attempts were wrong in ways
 * that only showed up on screen.
 */
import { chromium } from "playwright";
import { createServer } from "vite";
const server = await createServer({ server: { port: 5266, host: "127.0.0.1" }, logLevel: "warn" });
await server.listen();
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 620, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto("http://127.0.0.1:5266/tools/materials.html", { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__ready === true, { timeout: 30000 });
await page.waitForTimeout(400);
const shots = await page.evaluate(() => window.__shots);
for (const s of shots) {
  await page.locator(`#m-${s.id}`).screenshot({ path: `/home/user/Puzzle/tools/out/mat-${s.id}.png` });
  await page.locator(`#m-${s.id}`).screenshot({ path: `/home/user/Puzzle/tools/out/mat-${s.id}.jpg`, type: "jpeg", quality: 90 });
  console.log(`${s.label.padEnd(9)} djup ${s.depth}`);
}
await browser.close();
await server.close();
if (errors.length) { console.error("FEL:\n" + errors.join("\n")); process.exit(1); }
console.log("inga sidfel");
