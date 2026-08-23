/**
 * Renders the share card and the result screen that previews it.
 * Saves the card at full size so it can be judged as a posted image.
 */
import { chromium } from "playwright";
import { createServer } from "vite";
import { writeFile } from "node:fs/promises";

const server = await createServer({ server: { port: 5204, host: "127.0.0.1" }, logLevel: "warn" });
await server.listen();
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto("http://127.0.0.1:5204/", { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await page.locator('[data-action="endless"]').click();
await page.waitForTimeout(250);
await page.locator('[data-action="start"]').click();
await page.waitForTimeout(500);

// Play a spread of pieces so the disc has a pattern worth looking at.
const headerBottom = 74 + 38;
const trayTop = 844 - 168 - 14;
const radius = Math.min(390 * 0.485, (trayTop - headerBottom) / 2 - 10);
const cx = 195;
const cy = headerBottom + (trayTop - headerBottom) / 2;
const slotX = (i) => 16 + ((390 - 32) / 3) * (i + 0.5);

for (let turn = 0; turn < 14; turn++) {
  const state = await page.evaluate(() => window.__shiftle.state());
  if (!state || state.over) break;
  const slot = state.tray.findIndex((s) => s !== null);
  if (slot < 0) break;
  const a = ((turn * 67 - 90) * Math.PI) / 180;
  const frac = 0.5 + (turn % 3) * 0.16;
  const tx = cx + radius * frac * Math.cos(a);
  const ty = cy + radius * frac * Math.sin(a) + 76;
  const sx = slotX(slot);
  await page.mouse.move(sx, trayTop + 84);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) {
    await page.mouse.move(sx + (tx - sx) * k / 10, trayTop + 84 + (ty - (trayTop + 84)) * k / 10);
  }
  await page.mouse.up();
  await page.waitForTimeout(120);
}

const dataUrl = await page.evaluate(() => window.__shiftle.shareCard());
if (dataUrl) {
  await writeFile("tools/out/16-share-card.png", Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log("card written");
} else {
  console.log("card came back null");
}

// Force the result screen so the preview can be seen in context.
await page.evaluate(() => window.__shiftle.jam(0));
await page.waitForTimeout(1800);
await page.screenshot({ path: "tools/out/17-result.png" });

const hasPreview = await page.locator(".card-preview").count();
console.log(`preview in result screen: ${hasPreview === 1 ? "yes" : "no"}`);

await browser.close();
await server.close();
console.log(errors.length ? "ERRORS: " + errors.join(" | ") : "no errors");
