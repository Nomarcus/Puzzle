/**
 * Renders the icon and splash source squares, then hands them to
 * @capacitor/assets to slice every size iOS asks for.
 */
import { chromium } from "playwright";
import { createServer } from "vite";
import { mkdir } from "node:fs/promises";

await mkdir("assets", { recursive: true });

const server = await createServer({ server: { port: 5201, host: "127.0.0.1" }, logLevel: "warn" });
await server.listen();

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto("http://127.0.0.1:5201/icon.html", { waitUntil: "networkidle" });
await page.waitForTimeout(500);

await page.locator("#icon").screenshot({ path: "assets/icon.png" });
await page.locator("#splash").screenshot({ path: "assets/splash.png" });

await browser.close();
await server.close();
console.log("Wrote assets/icon.png (1024) and assets/splash.png (2732)");
