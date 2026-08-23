/**
 * Plays the real game in a real browser at iPhone size.
 *
 * Unit tests prove the rules are right; this proves you can actually put a
 * piece somewhere with a finger, and that spinning a ring does what the
 * gesture promises. It writes screenshots along the way so the look can be
 * reviewed without a device.
 */
import { chromium } from "playwright";
import { createServer } from "vite";
import { mkdir } from "node:fs/promises";

const OUT = "tools/out";
const VIEWPORT = { width: 390, height: 844 }; // iPhone 14 / 15
const LIFT = 76; // must match DRAG_LIFT in ui/game-screen.ts

await mkdir(OUT, { recursive: true });

const server = await createServer({ server: { port: 5200, host: "127.0.0.1" }, logLevel: "warn" });
await server.listen();

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

const problems = [];
page.on("pageerror", (e) => problems.push("PAGE ERROR: " + e.message));
page.on("console", (m) => {
  const text = m.text();
  if (m.type() === "error" && !text.includes("favicon") && !text.includes("404")) {
    problems.push("CONSOLE: " + text);
  }
});

const state = () => page.evaluate(() => window.__shiftle.state());
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });

async function drag(from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / 12,
      from.y + ((to.y - from.y) * i) / 12,
    );
    await page.waitForTimeout(12);
  }
  await page.mouse.up();
  await page.waitForTimeout(260);
}

const checks = [];
function check(label, ok, detail = "") {
  checks.push({ label, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

await page.goto("http://127.0.0.1:5200/", { waitUntil: "networkidle" });
await page.waitForTimeout(400);
await shot("01-menu");
check("menu renders", await page.locator(".title").isVisible());

// --- start a free game -----------------------------------------------------
await page.getByText("Spela fritt").click();
await page.waitForTimeout(500);
await shot("02-fresh-board");

let before = await state();
check("game started with a full tray", before && before.tray.every((s) => s !== null));
check("starts with one spin", before?.spins === 1, `spins=${before?.spins}`);

// --- geometry, mirrored from ui/game-screen.ts measure() -------------------
const headerBottom = 34 + 52;
const trayTop = VIEWPORT.height - 132 - 12;
const boardRadius = Math.min(VIEWPORT.width * 0.46, (trayTop - headerBottom) / 2 - 6);
const cx = VIEWPORT.width / 2;
const cy = headerBottom + (trayTop - headerBottom) / 2;
const slotWidth = (VIEWPORT.width - 32) / 3;
const slotCentre = (i) => ({ x: 16 + slotWidth * (i + 0.5), y: trayTop + 66 });

/** A point on the disc, then pushed down by LIFT so the drag lands there. */
const onDisc = (ringFraction, angleDeg) => {
  const radius = boardRadius * ringFraction;
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
};

// --- place pieces ----------------------------------------------------------
let placed = 0;
for (let slot = 0; slot < 3; slot++) {
  const snapshot = await state();
  if (!snapshot || snapshot.tray[slot] === null) continue;

  const drop = onDisc(0.86, slot * 40 - 40);
  await drag(slotCentre(slot), { x: drop.x, y: drop.y + LIFT });

  const after = await state();
  if (after.score > snapshot.score) placed++;
}
check("dragging pieces onto the disc places them", placed > 0, `${placed}/3 landed`);
await shot("03-after-placing");

// --- spin a ring -----------------------------------------------------------
const spun = await state();
const spinStart = onDisc(0.86, 0);
const spinEnd = onDisc(0.86, 34); // well past the 40% commit threshold
await drag(spinStart, spinEnd);
await page.waitForTimeout(320);

const afterSpin = await state();
check(
  "spinning a ring on the disc spends a spin",
  afterSpin.spins === spun.spins - 1,
  `${spun.spins} -> ${afterSpin.spins}`,
);
await shot("04-after-spin");

// --- spinning with none left is refused ------------------------------------
const broke = await state();
if (broke.spins === 0) {
  await drag(onDisc(0.86, 120), onDisc(0.86, 154));
  const stillBroke = await state();
  check("a spin with none left is refused", stillBroke.spins === 0);
}

// --- a longer session, to shake out crashes --------------------------------
for (let turn = 0; turn < 24; turn++) {
  const snapshot = await state();
  if (!snapshot || snapshot.over) break;
  const slot = snapshot.tray.findIndex((s) => s !== null);
  if (slot < 0) break;
  const drop = onDisc(0.55 + (turn % 3) * 0.16, turn * 47);
  await drag(slotCentre(slot), { x: drop.x, y: drop.y + LIFT });
}
const final = await state();
check("survives a long session without errors", problems.length === 0, problems.join(" | "));
check("score accumulated", final.score > 0, `score=${final.score}`);
console.log(
  `\nFinal: score=${final.score} placed=${final.stats.piecesPlaced} ` +
    `rings=${final.stats.ringsCleared} spokes=${final.stats.spokesCleared} over=${final.over}`,
);
await shot("05-late-game");

await browser.close();
await server.close();

const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  console.error(`\n${failed.length} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed.");
