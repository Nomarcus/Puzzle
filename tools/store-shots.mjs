/** Genuine App Store screenshots rendered from the production Shiftle UI. */
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "vite";

const out = "tools/out/store";
await mkdir(out, { recursive: true });

const server = await createServer({ server: { port: 5210, host: "127.0.0.1" }, logLevel: "warn" });
await server.listen();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 428, height: 926 },
  deviceScaleFactor: 3,
  hasTouch: true,
});

await page.goto("http://127.0.0.1:5210/", { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await page.locator('[data-action="endless"]').click();
await page.waitForTimeout(250);
await page.locator('[data-action="start"]').click();
await page.waitForTimeout(450);

const primed = await page.evaluate(() => window.__shiftle.primeStripe(2));
await page.waitForTimeout(350);
await page.screenshot({ path: `${out}/01-gameplay.png` });

await page.evaluate((sector) => window.__shiftle.play({ type: "place", slot: 0, r: 0, s: sector }), primed.sector);
await page.waitForTimeout(140);
await page.screenshot({ path: `${out}/02-stripe.png` });

await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/03-board.png` });

await browser.close();
await server.close();
