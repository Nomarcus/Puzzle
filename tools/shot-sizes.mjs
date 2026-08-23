/**
 * The same screens at phone and tablet size, side by side.
 *
 * The board is capped to a comfortable column, so on a tablet most of what a
 * player sees is background. This is how we look at whether that background
 * carries the screen or leaves it empty.
 */
import { chromium } from "playwright";
import { createServer } from "vite";
import { mkdir } from "node:fs/promises";

const OUT = "tools/out";
const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "phone-max", width: 430, height: 932 },
  { name: "ipad", width: 834, height: 1194 },
  { name: "ipad-pro", width: 1024, height: 1366 },
];

await mkdir(OUT, { recursive: true });

const server = await createServer({ server: { port: 5211, host: "127.0.0.1" }, logLevel: "warn" });
await server.listen();
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

const problems = [];

for (const size of SIZES) {
  const page = await browser.newPage({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  page.on("pageerror", (e) => problems.push(`${size.name} PAGE ERROR: ${e.message}`));
  page.on("console", (m) => {
    const text = m.text();
    if (m.type() === "error" && !text.includes("favicon") && !text.includes("404")) {
      problems.push(`${size.name} CONSOLE: ${text}`);
    }
  });

  await page.goto("http://127.0.0.1:5211/", { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/size-${size.name}-menu.png` });

  await page.locator('[data-action="endless"]').click();
  await page.waitForTimeout(250);
  await page.locator('[data-action="start"]').click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/size-${size.name}-game.png` });

  // Something on the board, so the disc is not empty in the shot.
  for (let i = 0; i < 9; i++) {
    await page.evaluate(() => window.__shiftle.botMove());
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/size-${size.name}-played.png` });

  console.log(`${size.name}: ${size.width}x${size.height} ✓`);
  await page.close();
}

console.log("\n--- problems ---");
console.log(problems.length ? problems.join("\n") : "(none)");

await browser.close();
await server.close();
process.exit(problems.length ? 1 : 0);
