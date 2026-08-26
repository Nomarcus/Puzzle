import { chromium } from "playwright";
import { createServer } from "vite";
const server = await createServer({ server: { port: 5311, host: "127.0.0.1" }, logLevel: "warn" });
await server.listen();
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];
for (const [name, w, h] of [["phone", 390, 844], ["ipad", 834, 1112]]) {
  const page = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: name === "phone", hasTouch: true });
  page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
  await page.goto("http://127.0.0.1:5311/", { waitUntil: "networkidle" });
  await page.evaluate(() => {
    localStorage.setItem("shiftle:lifetime", "220000");
    localStorage.setItem("shiftle:save", JSON.stringify({
      version: 1,
      records: { endless: { score: 84000, depth: 11, bestCombo: 7, ringsCleared: 41, coresFired: 3, survived: 0 } },
      worlds: { candy: { bestDepth: 1 }, fruit: { bestDepth: 3 }, woodland: { bestDepth: 5 },
                toybox: { bestDepth: 7 }, animal: { bestDepth: 9 }, crystal: { bestDepth: 11 } },
      mastery: { round: 0, activeId: null, progress: 0, completed: 0 },
      audio: { music: true, sfx: true, haptics: true },
    }));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  console.log(`${name}: progressbar ${await page.locator(".progress-strip").count()}, passknapp ${await page.locator('[data-action="passport"]').count()}, ljudpiller ${await page.locator('[data-action^="audio-"]').count()}`);
  console.log(`${name}: h-scroll ${await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)}`);
  await page.screenshot({ path: `/home/user/Puzzle/tools/out/ui-${name}-menu.png` });
  await page.locator('[data-action="passport"]').click();
  await page.waitForTimeout(600);
  console.log(`${name}: passkort ${await page.locator(".passport-card").count()}, låsta ${await page.locator(".passport-card.locked").count()}`);
  await page.screenshot({ path: `/home/user/Puzzle/tools/out/ui-${name}-passport.png` });
  await page.locator('.passport-screen [data-action="menu"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-action="goals"]').click();
  await page.waitForTimeout(400);
  console.log(`${name}: målknappar ${await page.locator('[data-action^="goal-"]').count()}`);
  await page.screenshot({ path: `/home/user/Puzzle/tools/out/ui-${name}-goals.png` });
  await page.close();
}
await b.close(); await server.close();
if (errors.length) { console.error("SIDFEL:\n" + errors.join("\n")); process.exit(1); }
console.log("inga sidfel");
