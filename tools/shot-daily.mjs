/** Screenshots a daily round, which shows the piece ration in the header. */
import { chromium } from "playwright";
import { createServer } from "vite";

const server = await createServer({ server: { port: 5202, host: "127.0.0.1" }, logLevel: "warn" });
await server.listen();
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto("http://127.0.0.1:5202/", { waitUntil: "networkidle" });
await page.waitForTimeout(700);
await page.locator('[data-action="daily"]').click();
await page.waitForTimeout(700);

const trayY = 844 - 168 - 14 + 84;
const cy = 80 + (844 - 168 - 14 - 80) / 2;
const radius = Math.min(390 * 0.485, (844 - 168 - 14 - 80) / 2 - 10);

for (let i = 0; i < 6; i++) {
  const a = ((i * 61 - 90) * Math.PI) / 180;
  await page.mouse.move(16 + 119.3 * ((i % 3) + 0.5), trayY);
  await page.mouse.down();
  const tx = 195 + radius * 0.82 * Math.cos(a);
  const ty = cy + radius * 0.82 * Math.sin(a) + 76;
  for (let k = 1; k <= 10; k++) {
    await page.mouse.move(16 + 119.3 * ((i % 3) + 0.5) + (tx - (16 + 119.3 * ((i % 3) + 0.5))) * k / 10, trayY + (ty - trayY) * k / 10);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
}

const state = await page.evaluate(() => window.__shiftle.state());
console.log(`daily: limit=${state.rules.pieceLimit} placed=${state.stats.piecesPlaced} spokeClears=${state.spokeClears}`);
await page.screenshot({ path: "tools/out/12-daily.png" });

await browser.close();
await server.close();
console.log(errors.length ? "ERRORS: " + errors.join(" | ") : "no errors");
