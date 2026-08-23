/**
 * The reported trigger: clearing a column. Fires a spoke clear over and over
 * through the real pipeline and watches for the loop dying or the tray
 * emptying.
 */
import { chromium } from "playwright";
import { createServer } from "vite";

const server = await createServer({ server: { port: 5207, host: "127.0.0.1" }, logLevel: "warn" });
await server.listen();
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 586, height: 863 } });

const problems = [];
page.on("pageerror", (e) => problems.push("PAGE: " + e.message + "\n" + (e.stack || "")));
page.on("console", (m) => {
  const text = m.text();
  if (m.type() === "error" && !text.includes("favicon") && !text.includes("404")) {
    problems.push("CONSOLE: " + text);
  }
});

await page.goto("http://127.0.0.1:5207/", { waitUntil: "networkidle" });
await page.waitForTimeout(500);
await page.locator(".swatch").nth(1).click();
await page.waitForTimeout(300);
await page.locator('[data-action="endless"]').click();
await page.waitForTimeout(200);
await page.locator('[data-action="start"]').click();
await page.waitForTimeout(400);

const report = await page.evaluate(async () => {
  const api = window.__shiftle;
  const bad = [];
  for (let i = 0; i < 60; i++) {
    const primed = api.primeSpoke(i % 8);
    if (!primed) break;
    // Drop the single cell that completes the spoke.
    const ok = api.play({ type: "place", slot: 0, r: 0, s: primed.sector });
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));

    const s = api.state();
    if (!ok) bad.push(`turn ${i}: move refused`);
    if (!api.frameAlive()) bad.push(`turn ${i}: animation loop stopped`);
    if (s && s.tray.every((slot) => slot === null)) bad.push(`turn ${i}: tray empty`);
    if (s && s.stats.spokesCleared === 0) bad.push(`turn ${i}: no spoke cleared`);
  }
  const s = api.state();
  return { bad, spokes: s?.stats.spokesCleared, alive: api.frameAlive(), tray: s?.tray.filter(Boolean).length };
});

console.log(JSON.stringify(report));
await page.screenshot({ path: "tools/out/22-spoke.png" });
await browser.close();
await server.close();
console.log(problems.length ? "PROBLEMS:\n" + problems.join("\n---\n") : "no problems");
