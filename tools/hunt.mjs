/**
 * Plays a long session in a real browser looking for the reported freeze:
 * a board that renders but a tray that does not, with nothing clickable.
 */
import { chromium } from "playwright";
import { createServer } from "vite";

const server = await createServer({ server: { port: 5206, host: "127.0.0.1" }, logLevel: "warn" });
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

await page.goto("http://127.0.0.1:5206/", { waitUntil: "networkidle" });
await page.waitForTimeout(500);
await page.locator(".swatch").nth(1).click();
await page.waitForTimeout(300);
await page.locator('[data-action="endless"]').click();
await page.waitForTimeout(200);
await page.locator('[data-action="start"]').click();
await page.waitForTimeout(400);

// Drive the engine directly so hundreds of turns run quickly, while the real
// renderer paints every one of them.
const result = await page.evaluate(async () => {
  const api = window.__shiftle;
  let emptyTray = 0;
  let turns = 0;
  for (let i = 0; i < 400; i++) {
    const s = api.state();
    if (!s || s.over) break;
    if (s.tray.every((slot) => slot === null)) { emptyTray++; break; }
    if (!api.botMove()) break;
    turns++;
    if (i % 25 === 0) await new Promise((r) => requestAnimationFrame(r));
  }
  const s = api.state();
  return { turns, emptyTray, over: s?.over, score: s?.score, alive: api.frameAlive() };
});

console.log(JSON.stringify(result));
await page.waitForTimeout(400);
await page.screenshot({ path: "tools/out/20-hunt.png" });
await browser.close();
await server.close();
console.log(problems.length ? "PROBLEMS:\n" + problems.join("\n---\n") : "no problems");
