/**
 * Screenshot helper. Boots the vite dev server, loads a page, saves a PNG.
 * Usage: node tools/shoot.mjs <path> <out.png> [width] [height]
 */
import { chromium } from "playwright";
import { createServer } from "vite";

const [, , pagePath = "/preview.html", out = "tools/out/shot.png", w = "1250", h = "780"] =
  process.argv;

const server = await createServer({ server: { port: 5199, host: "127.0.0.1" }, logLevel: "warn" });
await server.listen();

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({
  viewport: { width: Number(w), height: Number(h) },
  deviceScaleFactor: 2,
});

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  // The dev server has no favicon; that 404 is not a page error.
  const text = m.text();
  if (m.type() === "error" && !text.includes("favicon") && !text.includes("404")) {
    errors.push(text);
  }
});

await page.goto(`http://127.0.0.1:5199${pagePath}`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await page.screenshot({ path: out, fullPage: true });

await browser.close();
await server.close();

if (errors.length) {
  console.error("Page errors:\n" + errors.join("\n"));
  process.exit(1);
}
console.log(`Wrote ${out}`);
