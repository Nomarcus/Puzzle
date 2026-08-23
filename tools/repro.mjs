/** Reproduces the reported view: cream theme, desktop-ish window, long game. */
import { chromium } from "playwright";
import { createServer } from "vite";

const server = await createServer({ server: { port: 5205, host: "127.0.0.1" }, logLevel: "warn" });
await server.listen();
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 586, height: 863 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto("http://127.0.0.1:5205/", { waitUntil: "networkidle" });
await page.waitForTimeout(600);

// Pick the cream theme, as in the report.
await page.locator(".swatch").nth(1).click();
await page.waitForTimeout(400);
await page.locator('[data-action="endless"]').click();
await page.waitForTimeout(250);
await page.locator('[data-action="start"]').click();
await page.waitForTimeout(500);

const box = await page.evaluate(() => {
  const app = document.querySelector("#app");
  const canvas = document.querySelector("#board");
  const r = app.getBoundingClientRect();
  const c = canvas.getBoundingClientRect();
  return {
    app: { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) },
    canvas: { w: Math.round(c.width), h: Math.round(c.height) },
    dpr: window.devicePixelRatio,
    safeBottom: getComputedStyle(document.documentElement).getPropertyValue("--safe-bottom"),
  };
});
console.log(JSON.stringify(box));

const state = await page.evaluate(() => window.__shiftle.state());
console.log(`tray=${JSON.stringify(state.tray.map((s) => s && s.pieceId))}`);
await page.screenshot({ path: "tools/out/19-repro.png" });

// Jam the disc so every tray piece is dead: the state the report showed.
await page.evaluate(() => window.__shiftle.jam(1));
await page.waitForTimeout(500);
await page.screenshot({ path: "tools/out/21-stuck-cream.png" });

const jammed = await page.evaluate(() => window.__shiftle.state());
console.log(`jammed: over=${jammed.over} spins=${jammed.spins} tray=${jammed.tray.filter(Boolean).length}`);

await browser.close();
await server.close();
console.log(errors.length ? "ERRORS: " + errors.join(" | ") : "no errors");
