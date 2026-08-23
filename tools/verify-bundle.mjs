import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
const errors = [];
page.on("pageerror", e => errors.push("PAGE: " + e.message));
page.on("console", m => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });

await page.goto("file:///home/user/Puzzle/tools/out/shiftle.html");
await page.waitForTimeout(900);
console.log("menu visible:", await page.locator(".title").isVisible());
await page.screenshot({ path: "/home/user/Puzzle/tools/out/bundle-menu.png" });

await page.locator('[data-action="endless"]').click();
await page.waitForTimeout(700);
await page.screenshot({ path: "/home/user/Puzzle/tools/out/bundle-game.png" });

// Drag a piece from the tray out to the rim. The target cell is read 76px
// above the fingertip (DRAG_LIFT), so aim the pointer that far below it.
const trayY = 844 - 168 - 14 + 84;
const cy = 80 + (844 - 168 - 14 - 80) / 2;
const targetY = cy - 160 + 76;
await page.mouse.move(80, trayY);
await page.mouse.down();
for (let i = 1; i <= 12; i++) await page.mouse.move(80 + (195-80)*i/12, trayY + (targetY-trayY)*i/12);
await page.mouse.up();
await page.waitForTimeout(500);
await page.screenshot({ path: "/home/user/Puzzle/tools/out/bundle-placed.png" });

console.log("errors:", errors.length ? errors.join(" | ") : "none");
await browser.close();
