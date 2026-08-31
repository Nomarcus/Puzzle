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
// Read off the running game once a round exists, rather than duplicated here —
// a copy of this number has gone stale before and sent every simulated drag
// aiming at the wrong point, which broke placement in every test downstream.
let LIFT;

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

// --- music, effects and haptics are three switches, not one ----------------
// They have to be independent, and they have to survive a reload: a player who
// turns music off and finds it back on next launch has effectively no setting.
for (const key of ["music", "sfx", "haptics"]) {
  const pill = page.locator(`[data-action="audio-${key}"]`);
  check(`there is a switch for ${key}`, (await pill.count()) === 1);
  const before = await pill.getAttribute("aria-pressed");
  await pill.click();
  await page.waitForTimeout(120);
  check(`${key} flips`, (await pill.getAttribute("aria-pressed")) !== before);
}

// Independence: three taps above left all three off, so the others must still
// be off when one is turned back on.
await page.locator('[data-action="audio-sfx"]').click();
await page.waitForTimeout(120);
check(
  "and they are independent of each other",
  (await page.locator('[data-action="audio-sfx"]').getAttribute("aria-pressed")) === "true" &&
    (await page.locator('[data-action="audio-music"]').getAttribute("aria-pressed")) === "false",
);

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(500);
check(
  "and the choice survives a reload",
  (await page.locator('[data-action="audio-music"]').getAttribute("aria-pressed")) === "false" &&
    (await page.locator('[data-action="audio-sfx"]').getAttribute("aria-pressed")) === "true",
);

// Back on, so the rest of the suite runs with the game in its normal state.
await page.locator('[data-action="audio-music"]').click();
await page.locator('[data-action="audio-haptics"]').click();
await page.waitForTimeout(150);

// --- how much finger travel it takes to move a lifted piece ----------------
// The player's own choice, cycled one tap at a time, and it has to stick.
{
  const pill = page.locator('[data-action="sensitivity"]');
  check("there is a sensitivity setting", (await pill.count()) === 1);

  const start = (await pill.textContent()) ?? "";
  await pill.click();
  await page.waitForTimeout(80);
  const afterOne = (await pill.textContent()) ?? "";
  check("tapping it changes the level", afterOne !== start, `"${start}" -> "${afterOne}"`);

  await pill.click();
  await pill.click();
  await page.waitForTimeout(80);
  const afterThree = (await pill.textContent()) ?? "";
  check("three taps is a full cycle, back to the start", afterThree === start, `"${start}" vs "${afterThree}"`);

  // Move it off the default and check the choice survives a reload, the same
  // bar the audio switches have to clear.
  await pill.click();
  await page.waitForTimeout(80);
  const chosen = (await pill.textContent()) ?? "";
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const afterReload = (await page.locator('[data-action="sensitivity"]').textContent()) ?? "";
  check("and the choice survives a reload", afterReload === chosen, `"${chosen}" vs "${afterReload}"`);
}

// --- the World Passport, on a save where nothing has been discovered yet ---
// The withheld-look trick only works if the ungrown state actually renders:
// ten named cards and no crash, rather than an empty grid or a page error.
{
  await page.locator('[data-action="passport"]').click();
  await page.waitForTimeout(200);
  const cards = page.locator(".passport-card");
  check("the passport shows all ten worlds", (await cards.count()) === 10, `${await cards.count()}`);
  check(
    "none are discovered yet on a fresh save",
    (await page.locator(".passport-card:not(.locked)").count()) === 0,
  );
  await shot("19-passport-blank");
  await page.locator('.passport-screen [data-action="menu"]').click();
  await page.waitForTimeout(150);
}

// --- choosing a mastery goal ------------------------------------------------
// Chosen, never assigned: three on offer, and picking one has to stick.
{
  await page.locator('[data-action="goals"]').click();
  await page.waitForTimeout(200);
  const options = page.locator('[data-action^="goal-"]');
  check("three goals are on offer", (await options.count()) === 3, `${await options.count()}`);
  await shot("20-goals");

  const first = options.first();
  check("none is picked yet", (await first.getAttribute("aria-pressed")) === "false");
  await first.click();
  await page.waitForTimeout(150);
  check("picking one marks it picked", (await page.locator('[data-action^="goal-"]').first().getAttribute("aria-pressed")) === "true");

  // Leave and come back: the choice has to have actually been saved, not just
  // painted on the button that was clicked.
  await page.locator('.levels [data-action="menu"]').click();
  await page.waitForTimeout(150);
  await page.locator('[data-action="goals"]').click();
  await page.waitForTimeout(200);
  check(
    "and it is still picked after leaving and coming back",
    (await page.locator('[data-action^="goal-"]').first().getAttribute("aria-pressed")) === "true",
  );
  await page.locator('.levels [data-action="menu"]').click();
  await page.waitForTimeout(150);
}

// --- how to play: nine steps are taller than a phone ------------------------
// This screen reused .overlay.result, which centres its content with no
// scrolling — fine for a short result card, but nine steps plus a title and a
// button ran off the bottom of the screen with no way to reach the rest.
{
  await page.locator('[data-action="how"]').click();
  await page.waitForTimeout(250);
  const metrics = await page.evaluate(() => {
    const el = document.querySelector(".overlay.how-screen");
    if (!el) return null;
    const style = getComputedStyle(el);
    return { overflowY: style.overflowY, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
  });
  check("the how-to-play screen is present and scrollable", metrics?.overflowY === "auto", JSON.stringify(metrics));
  check(
    "and its content is actually taller than the screen (the bug this guards)",
    (metrics?.scrollHeight ?? 0) > (metrics?.clientHeight ?? 0),
    JSON.stringify(metrics),
  );
  await shot("24-how-to-play");

  // The close button has to be reachable by scrolling, not just present in the
  // DOM — that is the actual bug, not merely whether overflow is set.
  const reached = await page.evaluate(() => {
    const el = document.querySelector(".overlay.how-screen");
    if (!el) return false;
    el.scrollTop = el.scrollHeight;
    const button = el.querySelector("button");
    if (!button) return false;
    const box = button.getBoundingClientRect();
    return box.top >= 0 && box.bottom <= window.innerHeight;
  });
  check("scrolling to the bottom brings \"Got it\" fully into view", reached === true);

  await page.locator(".overlay.how-screen button").click();
  await page.waitForTimeout(200);
}

// --- start a free game -----------------------------------------------------
// Selected by data-action, not by label — the UI ships in two languages.
await page.locator('[data-action="endless"]').click();
await page.waitForTimeout(300);
check("free play asks which disc to use", await page.locator(".setup").isVisible());
await shot("07-setup");
await page.locator('.choices [data-choice="standard"]').click();
await page.locator('.choices [data-choice="mixed"]').click();
await page.locator('[data-action="start"]').click();
await page.waitForTimeout(500);
await shot("02-fresh-board");

LIFT = await page.evaluate(() => window.__shiftle.dragLift());

let before = await state();
check("game started with a full tray", before && before.tray.every((s) => s !== null));
check("the chosen disc is the one dealt", before?.spec.rings === 6 && before?.spec.sectors === 10,
  `${before?.spec.rings}x${before?.spec.sectors}`);
check("starts with one spin", before?.spins === 1, `spins=${before?.spins}`);

// --- geometry, mirrored from ui/game-screen.ts measure() -------------------
const headerBottom = 74 + 82;
const trayTop = VIEWPORT.height - 168 - 14;
const boardRadius = Math.min(VIEWPORT.width * 0.485, (trayTop - headerBottom) / 2 - 10);
const cx = VIEWPORT.width / 2;
const cy = headerBottom + (trayTop - headerBottom) / 2;
const slotWidth = (VIEWPORT.width - 32) / 3;
const slotCentre = (i) => ({ x: 16 + slotWidth * (i + 0.5), y: trayTop + 84 });

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

// --- a tap must never place a piece -----------------------------------------
// At this lift, the resting aim (finger position minus lift) already lands on
// the board — that is the whole point of the lift. Without a deadzone, a
// plain tap on a tray piece would place it the instant it was picked up. This
// is what the slop threshold in game-screen.ts exists to prevent.
{
  const snapshot = await state();
  const slot = snapshot.tray.findIndex((s) => s !== null);
  const at = slotCentre(slot);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await state();
  check(
    "a tap on a tray piece never places it",
    after.stats.piecesPlaced === snapshot.stats.piecesPlaced,
    `placed ${snapshot.stats.piecesPlaced} -> ${after.stats.piecesPlaced}`,
  );
}

// A drag that moves less than the slop threshold is the same as a tap.
{
  const slop = await page.evaluate(() => window.__shiftle.dragSlop());
  const snapshot = await state();
  const slot = snapshot.tray.findIndex((s) => s !== null);
  const at = slotCentre(slot);
  await drag(at, { x: at.x + Math.max(1, slop - 2), y: at.y });
  const after = await state();
  check(
    "a drag under the sensitivity threshold does not place either",
    after.stats.piecesPlaced === snapshot.stats.piecesPlaced,
    `slop=${slop}, placed ${snapshot.stats.piecesPlaced} -> ${after.stats.piecesPlaced}`,
  );
}

// --- the lift means barely any travel is needed to reach the board ---------
// This is the geometry the lift actually governs: the aim point (finger minus
// lift) lands within a few pixels of the disc's edge the instant a piece
// leaves the tray, rather than requiring most of a hand's travel first.
// Tested as pure geometry off the real layout and the real lift, not against
// board state, so it cannot flake on a crowded board — a multi-cell piece can
// legally have nowhere to land near a given cell even when the cell itself is
// squarely on the disc.
{
  const layout = await page.evaluate(() => window.__shiftle.layout());
  // The middle slot, not the first: it is the one whose x already sits under
  // the board's centre, so this measures what the lift governs (the vertical
  // reach) without an unrelated horizontal offset mixed in.
  const slotBox = await page.evaluate(() => window.__shiftle.slotBox(1));
  const restY = slotBox.y + slotBox.height / 2;
  const aimY = restY - LIFT;
  const aimX = slotBox.x + slotBox.width / 2;
  const distance = Math.hypot(aimX - cx, aimY - layout.boardCy);
  // Measured: at the old lift of 76 this fell short by ~72px; at 140 it falls
  // short by ~8px. Not zero — the resting aim is a hair below the board's
  // bottom edge by design, so a plain tap still cannot place a piece — but a
  // small, deliberate movement is all that is left to reach it.
  const shortfall = distance - boardRadius;
  check(
    "barely any travel is needed to reach the board from a resting thumb",
    shortfall > 0 && shortfall <= 15,
    `shortfall=${shortfall.toFixed(1)}px (was ~72px at the old lift)`,
  );
}


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

// --- quit and restart ------------------------------------------------------
const beforeButtons = await state();
check("score is on the board before testing the buttons", beforeButtons.score > 0);

// Restart mid-round asks first, and cancelling leaves the round untouched.
await page.locator('[data-action="restart"]').click();
await page.waitForTimeout(250);
check("restart asks before throwing the round away", await page.locator(".confirm").isVisible());
await shot("06-confirm");

await page.locator(".confirm .big.alt").click();
await page.waitForTimeout(250);
const afterCancel = await state();
check(
  "cancelling keeps the round going",
  afterCancel !== null && afterCancel.score === beforeButtons.score,
  `score=${afterCancel?.score}`,
);

// Confirming a restart deals a fresh board.
await page.locator('[data-action="restart"]').click();
await page.waitForTimeout(200);
await page.locator(".confirm .big.warm").click();
await page.waitForTimeout(450);
const afterRestart = await state();
check("restart deals a fresh board", afterRestart?.score === 0, `score=${afterRestart?.score}`);

// Quitting with nothing at stake goes straight back, no question asked.
await page.locator('[data-action="quit"]').click();
await page.waitForTimeout(400);
check("quit returns to the menu", await page.locator(".title").isVisible());

await page.locator('[data-action="endless"]').click();
await page.waitForTimeout(300);
await page.locator('[data-action="start"]').click();
await page.waitForTimeout(400);

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

// --- the large disc with the chunky pack -----------------------------------
await page.locator('[data-action="quit"]').click();
await page.waitForTimeout(200);
if (await page.locator(".confirm").isVisible()) {
  await page.locator(".confirm .big.warm").click();
  await page.waitForTimeout(300);
}
await page.locator('[data-action="endless"]').click();
await page.waitForTimeout(250);
await page.locator('.choices [data-choice="large"]').click();
await page.locator('.choices [data-choice="chunks"]').click();
await page.locator('[data-action="start"]').click();
await page.waitForTimeout(450);

const big = await state();
check("the large disc is 7 rings by 12 sectors", big?.spec.rings === 7 && big?.spec.sectors === 12,
  `${big?.spec.rings}x${big?.spec.sectors}`);

// Geometry differs on this board, so recompute the radius before dropping.
const bigRadius = Math.min(VIEWPORT.width * 0.485, (trayTop - headerBottom) / 2 - 10);
for (let turn = 0; turn < 16; turn++) {
  const snapshot = await state();
  if (!snapshot || snapshot.over) break;
  const slot = snapshot.tray.findIndex((s) => s !== null);
  if (slot < 0) break;
  const frac = 0.5 + (turn % 4) * 0.13;
  const a = ((turn * 53 - 90) * Math.PI) / 180;
  await drag(slotCentre(slot), {
    x: cx + bigRadius * frac * Math.cos(a),
    y: cy + bigRadius * frac * Math.sin(a) + LIFT,
  });
}
await shot("08-large-chunks");
check("no errors across every disc size", problems.length === 0, problems.join(" | "));

// --- clearing a column, then carrying on -----------------------------------
// The reported trigger. Clear a spoke with a real drag, then place another
// piece with another real drag and check the round is still playable.
const primed = await page.evaluate(() => window.__shiftle.primeSpoke(2));
await page.waitForTimeout(250);

const specNow = (await state()).spec;
const holeFrac = 0.34 + (1 - 0.34) * (0.5 / specNow.rings);
const holeAngle = (-Math.PI / 2) + (primed.sector + 0.5) * ((Math.PI * 2) / specNow.sectors);
await drag(slotCentre(0), {
  x: cx + bigRadius * holeFrac * Math.cos(holeAngle),
  y: cy + bigRadius * holeFrac * Math.sin(holeAngle) + LIFT,
});
await page.waitForTimeout(400);

const cleared = await state();
check("a real drag clears a column", cleared.stats.spokesCleared > 0, `spokes=${cleared.stats.spokesCleared}`);
check("the tray still holds pieces after a column clears", cleared.tray.some((s) => s !== null));

// And the very next placement must still work.
const nextSlot = cleared.tray.findIndex((s) => s !== null);
const nextAngle = (-Math.PI / 2) + 3 * ((Math.PI * 2) / specNow.sectors);
await drag(slotCentre(nextSlot), {
  x: cx + bigRadius * 0.8 * Math.cos(nextAngle),
  y: cy + bigRadius * 0.8 * Math.sin(nextAngle) + LIFT,
});
await page.waitForTimeout(300);

const afterClear = await state();
check(
  "the round is still playable after a column clear",
  afterClear.stats.piecesPlaced > cleared.stats.piecesPlaced,
  `placed ${cleared.stats.piecesPlaced} -> ${afterClear.stats.piecesPlaced}`,
);
await shot("23-after-column");

// --- the push: the other axis ----------------------------------------------
await page.evaluate(() => window.__shiftle.givePush(2));
await page.waitForTimeout(200);
const withPush = await state();
check("pushes can be held", withPush?.pushes === 2, `pushes=${withPush?.pushes}`);

// Straight out from the hub along one spoke: radial travel, no arc travel.
const spokeAngle = (-90 * Math.PI) / 180;
const from = { x: cx + bigRadius * 0.5 * Math.cos(spokeAngle), y: cy + bigRadius * 0.5 * Math.sin(spokeAngle) };
const to = { x: cx + bigRadius * 0.95 * Math.cos(spokeAngle), y: cy + bigRadius * 0.95 * Math.sin(spokeAngle) };
await drag(from, to);
await page.waitForTimeout(320);

const afterPush = await state();
check(
  "dragging out along a spoke spends a push, not a spin",
  afterPush.pushes === withPush.pushes - 1 && afterPush.spins === withPush.spins,
  `pushes ${withPush.pushes}->${afterPush.pushes}, spins ${withPush.spins}->${afterPush.spins}`,
);
await shot("18-push");

// --- being stuck, and dying ------------------------------------------------
// Jam the disc with a spin still in hand: the round must stay alive and say so.
const jammed = await page.evaluate(() => window.__shiftle.jam(1));
await page.waitForTimeout(400);
check("a jammed disc with a spin left is not game over", jammed?.over === false);
check("no result card while a spin remains", !(await page.locator(".overlay").isVisible()));

// Grabbing a dead piece must be refused, not silently ignored.
const beforeDead = await state();
await drag(slotCentre(0), { x: cx, y: cy - bigRadius * 0.8 + LIFT });
const afterDead = await state();
check(
  "a piece with nowhere to go cannot be placed",
  afterDead.score === beforeDead.score,
  `score=${afterDead.score}`,
);
await shot("09-stuck");

// Now with no spins left: the board is dead and the card follows after a beat.
await page.evaluate(() => window.__shiftle.jam(0));
await page.waitForTimeout(300);
// Asked before the screenshot: capturing a retina page costs the best part of
// a second, which is most of the beat we are trying to measure.
check("the dead board is held on screen before the card", !(await page.locator(".overlay").isVisible()));
await shot("10-death-beat");

await page.waitForTimeout(1400);
check("the result card arrives after the beat", await page.locator(".overlay").isVisible());
check(
  "the result previews the picture that gets shared",
  (await page.locator(".card-preview").count()) === 1,
);
check("there is a share button", (await page.locator('[data-action="share"]').count()) === 1);
await shot("11-game-over");

// --- the result screen: what changed, and the way straight back in ---------
{
  const lines = await page.locator(".result-line").count();
  check("the result shows at most three lines", lines <= 3, `${lines} lines`);
  // At minimum: the first round on a fresh save always discovers Candy.
  check("and at least one, on a round that discovered a world", lines >= 1, `${lines} lines`);
  check(
    "there is an immediate replay button",
    (await page.locator('[data-action="replay"]').count()) === 1,
  );

  const beforeReplay = await state();
  await page.locator('[data-action="replay"]').click();
  await page.waitForTimeout(400);
  const afterReplay = await state();
  check(
    "tapping it starts a fresh round without going through the menu",
    afterReplay !== null && !afterReplay.over && afterReplay.score === 0,
    `over=${afterReplay?.over}, score=${afterReplay?.score}`,
  );
  // Not the round that was showing a moment ago.
  check(
    "the fresh round is not the dead board reused",
    beforeReplay?.over === true && afterReplay?.over === false,
  );
}

// --- the World Passport, with a real discovered world on it ----------------
// The card that matters is the one drawing a real render of a world's blocks,
// which is the one part of this screen that can actually fail — a canvas draw
// throwing would leave a card with a name and nothing under it.
{
  await page.evaluate(() => window.__shiftle.menu());
  await page.waitForTimeout(200);
  await page.locator('[data-action="passport"]').click();
  await page.waitForTimeout(250);
  const discovered = await page.locator(".passport-card:not(.locked)").count();
  check(
    "at least one world is discovered after a finished round",
    discovered >= 1,
    `${discovered}/10`,
  );
  check("no errors drawing the discovered swatches", problems.length === 0, problems.join(" | "));
  await shot("21-passport-discovered");
  await page.locator('.passport-screen [data-action="menu"]').click();
  await page.waitForTimeout(200);
}

// --- levels ----------------------------------------------------------------
// The level flow is where a mode-switching bug would hide: a goal that never
// completes, a lock that never opens, a strip left on screen afterwards.
await page.evaluate(() => window.__shiftle.clearLevels());
await page.evaluate(() => window.__shiftle.menu());
await page.waitForTimeout(300);
await page.locator('[data-action="levels"]').click();
await page.waitForTimeout(300);

{
  const tiles = await page.locator(".level-tile").count();
  const expected = await page.evaluate(() => window.__shiftle.levelCount());
  check("the level grid opens with a tile per level", tiles === expected && tiles >= 40, `${tiles} tiles`);
}
check(
  "only the first level is open to begin with",
  (await page.locator(".level-tile:not(.locked)").count()) === 1,
);
await shot("15-levels");

// Level 1 asks for spokes, which the bot can do. Play it out through the real
// screen so the goal, the strip and the unlock all go through the live path.
await page.evaluate(() => window.__shiftle.level(1));
await page.waitForTimeout(500);
check("the goal is on screen while playing", await page.locator(".goal-strip").isVisible());

// The strip is DOM and the header is canvas, so nothing stops them overlapping
// except the row the layout reserves. It shipped once sitting straight through
// the piece counter.
{
  const strip = await page.locator(".goal-strip").boundingBox();
  const { headerY } = await page.evaluate(() => window.__shiftle.layout());
  // The header's lowest text is the push label, drawn at headerY + 78.
  check(
    "the goal strip clears the header instead of sitting on it",
    strip !== null && strip.y > headerY + 78,
    `strip top ${strip?.y}, header bottom ${headerY + 78}`,
  );
  check(
    "and stays on one line",
    strip !== null && strip.height < 40,
    `${strip?.height}px tall`,
  );
  check(
    "and above the board rather than over it",
    strip !== null &&
      strip.y + strip.height <
        (await page.evaluate(() => window.__shiftle.layout())).boardCy -
          (await page.evaluate(() => window.__shiftle.layout())).boardRadius,
  );
}

const startProgress = await page.evaluate(() => window.__shiftle.levelProgress());
check(
  "the goal starts at nothing",
  startProgress?.level === 1 && startProgress.done === 0 && !startProgress.met,
  JSON.stringify(startProgress),
);

for (let i = 0; i < 40; i++) {
  const done = await page.evaluate(() => !document.querySelector(".goal-strip"));
  if (done) break;
  await page.evaluate(() => window.__shiftle.botMove());
  await page.waitForTimeout(45);
}
await page.waitForTimeout(1400);

check(
  "finishing the goal ends the level and banks it",
  (await page.evaluate(() => window.__shiftle.levelsDone())).includes(1),
  JSON.stringify(await page.evaluate(() => window.__shiftle.levelsDone())),
);
check("the win screen offers the next level", (await page.locator('[data-action="next-level"]').count()) === 1);
check("the goal strip is gone once the level is over", (await page.locator(".goal-strip").count()) === 0);
await shot("16-level-won");

await page.locator('[data-action="level-select"]').click();
await page.waitForTimeout(300);
check(
  "clearing a level unlocks the next one",
  (await page.locator(".level-tile:not(.locked)").count()) === 2,
);
check("the cleared level is marked", (await page.locator(".level-tile.done").count()) === 1);

await page.evaluate(() => window.__shiftle.clearLevels());
await page.evaluate(() => window.__shiftle.menu());
await page.waitForTimeout(250);

// --- challenges ------------------------------------------------------------
// The whole feature is "your friend plays exactly the round you played", so the
// checks that matter are that a code survives the trip out and back, and that
// a mistyped one is refused rather than quietly becoming a different round.
// Challenges are no longer on the menu — the button was removed — but the
// codec and the #c= route are still live, so the flow is driven by hook.
await page.evaluate(() => window.__shiftle.challenge());
await page.waitForTimeout(200);
check("the challenge screen opens", await page.locator('[data-action="challenge-new"]').isVisible());
check(
  "but nothing on the menu points at it any more",
  (await page.locator('[data-action="challenge"]').count()) === 0,
);

await page.locator('[data-action="challenge-code"]').fill("NOT A REAL CODE AT ALL");
await page.locator('[data-action="challenge-take"]').click();
await page.waitForTimeout(150);
check(
  "rubbish in the code box is refused",
  await page.locator('[data-action="challenge-new"]').isVisible(),
);

await page.locator('[data-action="challenge-new"]').click();
await page.waitForTimeout(400);

const duel = await page.evaluate(() => window.__shiftle.state());
check("a challenge deals a rationed round", duel?.rules.pieceLimit === 60);
check("a challenge never ramps", duel?.ramp.piecesPerDepth === 0);
check("a challenge deals a fixed sequence, not an adaptive one", duel?.fairDeal === false);

// Play it out so the result screen appears with a code on it.
for (let i = 0; i < 90; i++) {
  const done = await page.evaluate(() => {
    const api = window.__shiftle;
    const state = api.state();
    if (!state || state.over) return true;
    return !api.botMove();
  });
  if (done) break;
}
await page.waitForTimeout(1800);

const code = (await page.evaluate(() => window.__shiftle.challengeCode())) ?? "";
check("the result hands you a code to send on", /^[0-9A-Z-]{15,}$/.test(code), code);

const decoded = await page.evaluate((value) => window.__shiftle.decodeChallenge(value), code);
check("that code reads back as a real challenge", decoded !== null && decoded.pieces === 60);
check(
  "and it carries the score you just got, so the next player has a target",
  decoded?.score === Math.round((await page.evaluate(() => window.__shiftle.lastScore())) ?? -1),
  `${decoded?.score}`,
);

const opened = await page.evaluate((value) => window.__shiftle.challenge(value), code);
await page.waitForTimeout(200);
check("pasting a code offers the round it names", opened === true);
check(
  "and shows the number to beat",
  (await page.locator('[data-action="challenge-play"]').count()) === 1,
);

await page.evaluate(() => window.__shiftle.menu());
await page.waitForTimeout(250);

// --- time attack -----------------------------------------------------------
// The clock lives in the screen, not the engine, so this is the only place it
// can be tested at all.
await page.evaluate(() => window.__shiftle.timeAttack());
await page.waitForTimeout(500);

const opening = await page.evaluate(() => window.__shiftle.clock());
check("a timed round opens with a clock running", opening !== null && opening > 20, `${opening}s`);
check("and the clock is the tense kind, not a comfortable one", opening !== null && opening <= 45, `${opening}s`);

const drained = await page.evaluate(async () => {
  const before = window.__shiftle.clock();
  await new Promise((done) => setTimeout(done, 900));
  return { before, after: window.__shiftle.clock() };
});
check("and the clock actually runs down", drained.after < drained.before,
  `${drained.before?.toFixed(1)} -> ${drained.after?.toFixed(1)}`);

// Clearing has to buy time back, or the mode is just a timer.
const bought = await page.evaluate(async () => {
  const api = window.__shiftle;
  for (let i = 0; i < 120; i++) {
    const before = api.clock();
    const state = api.state();
    if (!state || state.over) break;
    if (!api.botMove()) break;
    const after = api.clock();
    if (after > before) return { before, after };
  }
  return null;
});
check("clearing a line buys seconds back", bought !== null,
  bought ? `${bought.before.toFixed(1)} -> ${bought.after.toFixed(1)}` : "never gained time");

// Wound down rather than waited out: a test that sat through a real round is a
// test nobody runs. `ranOutOfTime` is read while the screen is still up — the
// result screen tears it down.
const ended = await page.evaluate(async () => {
  window.__shiftle.burnClock(999);
  await new Promise((done) => setTimeout(done, 200));
  const ranOut = window.__shiftle.ranOutOfTime();
  await new Promise((done) => setTimeout(done, 2000));
  return { ranOut, title: document.querySelector(".how-title")?.textContent };
});
check("running out of time ends the round", ended.ranOut === true);
check("and the result says time, not game over", ended.title === "Time!" || ended.title === "Tiden är ute!", ended.title);

// resultProgress() draws its own "play again" button; the time result screen
// used to also draw a second, older one by hand, so the card showed two.
const replayButtons = await page.locator('[data-action="replay"], [data-action="again"]').count();
check("the time result shows exactly one play-again button", replayButtons === 1, `${replayButtons} found`);
await shot("22-time-result");

await page.evaluate(() => window.__shiftle.menu());
await page.waitForTimeout(250);

// --- notices must never strand the player -----------------------------------
// A notice used to go through overlay(), which clears the screen before it
// draws — so dismissing one left nothing behind and the only way out was to
// force-quit. Every notice in the app is checked here.
await page.evaluate(() => window.__shiftle.setLifetime(0));
await page.evaluate(() => window.__shiftle.menu());
await page.waitForTimeout(250);

// Tapping a theme you have not earned yet.
await page.locator('.swatch.locked').first().click();
await page.waitForTimeout(200);
check("a locked theme explains itself", (await page.locator('[data-action="notice-ok"]').count()) === 1);
check("and the menu is still underneath it", (await page.locator(".overlay.menu").count()) === 1);

await page.locator('[data-action="notice-ok"]').click();
await page.waitForTimeout(200);
check(
  "dismissing it leaves you back on the menu, not a dead screen",
  (await page.locator('[data-action="daily"]').count()) === 1,
);
check("with the notice gone", (await page.locator('[data-action="notice-ok"]').count()) === 0);

// The same hazard on a result screen: earning a theme raises a notice there,
// and that one used to destroy the play-again and menu buttons.
await page.evaluate(() => window.__shiftle.notice("Test", "Body"));
await page.waitForTimeout(200);
check("a notice over the menu never removes it",
  (await page.locator(".overlay.menu").count()) === 1);
await page.locator('[data-action="notice-ok"]').click();
await page.waitForTimeout(150);
check("and dismissing still leaves a way out",
  (await page.locator('[data-action="daily"]').count()) === 1);

await page.evaluate(() => window.__shiftle.menu());
await page.waitForTimeout(200);

// --- progression -----------------------------------------------------------
await page.evaluate(() => window.__shiftle.setLifetime(0));
await page.evaluate(() => window.__shiftle.menu());
await page.waitForTimeout(250);
{
  const total = await page.locator(".swatch").count();
  const locked = await page.locator(".swatch.locked").count();
  check("the menu shows every theme, earned or not", total === 7, `${total} swatches`);
  check("and locks the earned ones to begin with", locked === 4, `${locked} locked`);
  check("but never the first three — the opening choice is a real one",
    total - locked === 3);
  // The progress strip replaced the old unlock line: same information, one bar
  // instead of two on the same screen.
  check("with one thing named to play toward",
    (await page.locator(".progress-strip").count()) === 1);
}

// A lifetime total past the first threshold opens exactly one more.
await page.evaluate(() => window.__shiftle.setLifetime(200000));
await page.evaluate(() => window.__shiftle.menu());
await page.waitForTimeout(250);
check("scoring enough unlocks one",
  (await page.locator(".swatch.locked").count()) === 3);

await page.evaluate(() => window.__shiftle.setLifetime(9000000));
await page.evaluate(() => window.__shiftle.menu());
await page.waitForTimeout(250);
check("and everything eventually", (await page.locator(".swatch.locked").count()) === 0);
// Everything earned, so the strip says so rather than naming a next theme.
check("with nothing left to chase",
  (await page.locator(".progress-strip").count()) === 1 &&
    !(await page.locator(".progress-goal").textContent())?.includes("→"));

await page.evaluate(() => window.__shiftle.setLifetime(0));

// --- the daily streak ------------------------------------------------------
// Retention lives or dies on this being visible and correct across midnight,
// so both the badge and the fortnight strip are driven with a planted history.
// Dated relative to today, not to fixed days: a fixed history is months stale
// by the time anyone runs this, and the check passes without testing anything.
await page.evaluate(() => {
  const day = (back) => new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
  window.__shiftle.setHistory({ [day(2)]: 4000, [day(1)]: 5200, [day(0)]: 6100 });
});
await page.evaluate(() => window.__shiftle.menu());
await page.waitForTimeout(300);

{
  const shown = await page.evaluate(() => window.__shiftle.streak());
  check("three days running counts as three", shown.length === 3, `length ${shown.length}`);
  check("and the badge is on the menu", (await page.locator(".streak").count()) === 1);
  check("with no warning, because today is already played",
    (await page.locator(".streak.at-risk").count()) === 0);
}

// Yesterday but not today: the streak stands, and the badge asks for it.
await page.evaluate(() => {
  const day = (back) => new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
  window.__shiftle.setHistory({ [day(3)]: 4000, [day(2)]: 5200, [day(1)]: 6100 });
});
await page.evaluate(() => window.__shiftle.menu());
await page.waitForTimeout(250);
{
  const shown = await page.evaluate(() => window.__shiftle.streak());
  check("a streak survives a day not yet played", shown.length === 3 && shown.atRisk === true,
    `length ${shown.length} atRisk ${shown.atRisk}`);
  check("and the badge says so", (await page.locator(".streak.at-risk").count()) === 1);
}

// A day genuinely missed.
await page.evaluate(() => {
  const day = (back) => new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
  window.__shiftle.setHistory({ [day(5)]: 4000, [day(4)]: 5200, [day(3)]: 6100 });
});
await page.evaluate(() => window.__shiftle.menu());
await page.waitForTimeout(250);
check("a missed day breaks it",
  (await page.evaluate(() => window.__shiftle.streak())).length === 0);

await page.evaluate(() => window.__shiftle.setHistory({}));
await page.evaluate(() => window.__shiftle.menu());
await page.waitForTimeout(200);
check("and no badge for somebody who has never played",
  (await page.locator(".streak").count()) === 0);

// --- the menu layout -------------------------------------------------------
// The bug this pins, measured on this exact viewport: the disc was sized
// against the window (312px across) while the column was sized against its own
// content (681px of an 844px screen), so **246 of the disc's 312 pixels sat
// behind buttons** — four fifths of the game's face. The column now measures
// itself and the disc takes the band above it, so the numbers below are read
// off the real layout rather than a screenshot being squinted at.
await page.evaluate(() => {
  localStorage.removeItem("shiftle:best");
  localStorage.removeItem("shiftle:bestTime");
  window.__shiftle.clearLevels();
  window.__shiftle.setHistory({});
});
await page.evaluate(() => window.__shiftle.menu());
await page.waitForTimeout(400);

check(
  "a fresh install shows no records row rather than a row of noughts",
  (await page.locator(".records").count()) === 0,
);

// A save with something in it: a streak, levels, and both records.
await page.evaluate(() => {
  const day = (back) => new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
  localStorage.setItem("shiftle:best", "72904");
  localStorage.setItem("shiftle:bestTime", "12480");
  localStorage.setItem("shiftle:levels", JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
  window.__shiftle.setHistory({ [day(3)]: 4000, [day(2)]: 5200, [day(1)]: 6100, [day(0)]: 7000 });
});
await page.evaluate(() => window.__shiftle.menu());
await page.waitForTimeout(400);
await shot("15-menu");

{
  const chips = await page.evaluate(() =>
    [...document.querySelectorAll(".records .record")].map((c) => ({
      text: c.textContent,
      top: Math.round(c.getBoundingClientRect().top),
    })),
  );
  check("a played save shows all four records", chips.length === 4,
    chips.map((c) => c.text).join(" "));
  check(
    "and they sit on one line, not four rows",
    new Set(chips.map((c) => c.top)).size === 1,
    chips.map((c) => c.top).join(","),
  );
}

{
  const tiles = await page.evaluate(() =>
    [...document.querySelectorAll(".mode-row .big")].map((b) => {
      const box = b.getBoundingClientRect();
      return { action: b.dataset.action, top: Math.round(box.top), height: Math.round(box.height) };
    }),
  );
  check("the three other modes are all on the menu", tiles.length === 3,
    tiles.map((t) => t.action).join(","));
  check("side by side on one row", new Set(tiles.map((t) => t.top)).size === 1,
    tiles.map((t) => t.top).join(","));
  // Swedish "Mot klockan" wraps to two lines inside its tile. The tiles have to
  // stay the same height anyway, or the row reads as broken.
  check("and the same height even where the label wraps",
    new Set(tiles.map((t) => t.height)).size === 1,
    tiles.map((t) => t.height).join(","));
  check("each tall enough to hit with a thumb", tiles.every((t) => t.height >= 44),
    tiles.map((t) => t.height).join(","));
}

{
  const layout = await page.evaluate(() => {
    const disc = window.__shiftle.menuDisc();
    const column = document.querySelector(".overlay.menu")?.firstElementChild;
    const box = column?.getBoundingClientRect();
    return { disc, columnTop: box ? box.top : null, height: window.innerHeight };
  });
  const { disc, columnTop } = layout;
  check("the menu knows where its column starts", disc !== null && columnTop !== null);
  check(
    "the whole circle is on screen — nothing clipped off the top",
    disc.top >= 0,
    `top=${disc.top.toFixed(1)}`,
  );
  check(
    "and none of it is behind the column",
    disc.bottom <= columnTop + 1,
    `disc bottom ${disc.bottom.toFixed(1)} vs column top ${columnTop.toFixed(1)}`,
  );
  // The band could be satisfied by a tiny disc, which would pass the two checks
  // above and still lose the logo. It has to stay the biggest thing up there.
  check(
    "and it is still a logo, not a token",
    disc.radius >= 120,
    `radius=${disc.radius.toFixed(1)} of ${(layout.height * 0.5).toFixed(0)} available`,
  );
}

// Swedish is the longer language and the one Marcus reads. The disc must
// survive the column growing under it. Switched with the real pill, so this
// also proves the refit runs on a rebuild and not only on first paint.
await page.locator('.langs .pill', { hasText: "SV" }).click();
await page.waitForTimeout(400);
await shot("16-menu-sv");
{
  const sv = await page.evaluate(() => {
    const disc = window.__shiftle.menuDisc();
    const box = document.querySelector(".overlay.menu")?.firstElementChild?.getBoundingClientRect();
    return { disc, columnTop: box ? box.top : null };
  });
  check("the circle is clear of the Swedish column too",
    sv.disc.bottom <= sv.columnTop + 1 && sv.disc.radius >= 120,
    `radius=${sv.disc.radius.toFixed(1)} bottom=${sv.disc.bottom.toFixed(1)} column=${sv.columnTop.toFixed(1)}`);
}
await page.locator('.langs .pill', { hasText: "EN" }).click();
await page.waitForTimeout(300);

await page.evaluate(() => {
  localStorage.removeItem("shiftle:best");
  localStorage.removeItem("shiftle:bestTime");
  window.__shiftle.clearLevels();
  window.__shiftle.setHistory({});
});
await page.evaluate(() => window.__shiftle.menu());
await page.waitForTimeout(250);

// --- the core --------------------------------------------------------------
// The hub charges from clears and sweeps the disc when tapped. The tap has to
// be checked before the spin gesture, since the hub sits inside the disc.
await page.evaluate(() => window.__shiftle.start("endless"));
await page.waitForTimeout(400);

const charged = await page.evaluate(async () => {
  const api = window.__shiftle;
  for (let i = 0; i < 500; i++) {
    const state = api.state();
    if (!state || state.over) break;
    if (api.coreReady()) break;
    if (!api.botMove()) break;
  }
  // The move that fills the core is often a big clear, which leaves nothing to
  // sweep — the engine refuses to fire on an empty board rather than wasting
  // the charge, so lay some pieces back down before firing.
  for (let i = 0; i < 40 && api.filledCells() < 10; i++) {
    if (!api.botMove()) break;
    if (!api.coreReady()) break;
  }
  return { ready: api.coreReady(), charge: api.charge(), filled: api.filledCells() };
});
check("clearing charges the core until it is full", charged.ready === true, `charge ${charged.charge}`);
check("and there is a board to sweep when it fires", charged.filled > 0, `${charged.filled} cells`);

// Fired by tapping the middle of the disc, exactly as a player would.
const swept = await page.evaluate(async () => {
  const api = window.__shiftle;
  const before = { score: api.state().score, filled: api.filledCells() };
  api.tapCentre();
  await new Promise((done) => setTimeout(done, 700));
  return { before, after: { score: api.state().score, filled: api.filledCells(), charge: api.charge() } };
});
check("tapping the middle fires it and sweeps the disc",
  swept.after.filled < swept.before.filled,
  `${swept.before.filled} -> ${swept.after.filled} cells`);
check("the sweep scores", swept.after.score > swept.before.score,
  `+${swept.after.score - swept.before.score}`);
check("and the core empties", swept.after.charge === 0);

await page.evaluate(() => window.__shiftle.menu());
await page.waitForTimeout(250);

// --- the level grid --------------------------------------------------------
// Quitting a level used to come back here without stopping the round, so the
// abandoned board carried on animating behind a translucent list.
await page.locator('[data-action="levels"]').click();
await page.waitForTimeout(300);
check("the level list has a pinned way out", await page.locator('.hud [data-action="menu"]').isVisible());
check("and nothing is still playing behind it", (await page.evaluate(() => window.__shiftle.state())) === null);
{
  const box = await page.locator('.hud [data-action="menu"]').boundingBox();
  check("the way out is reachable without scrolling", box !== null && box.y < 200, `y=${box?.y}`);
}

// A scrolling flex column shrinks every child that lets it. The tiles have a
// min-height and survived; the Menu button had none and came out 38px tall
// instead of 62 — a thin sliver with the text pressed against both edges.
{
  await page.evaluate(() => {
    const list = document.querySelector(".overlay.levels");
    if (list) list.scrollTop = list.scrollHeight;
  });
  await page.waitForTimeout(250);
  const menu = await page.locator(".overlay.levels .big").last().boundingBox();
  check(
    "and the button at the bottom is not squashed by the scroll",
    menu !== null && menu.height >= 56,
    `${menu?.height}px tall`,
  );
}
await page.evaluate(() => window.__shiftle.menu());
await page.waitForTimeout(200);

// --- the free play ramp ----------------------------------------------------
// Free play used to never end: 0 of 20 bot rounds finished inside 4,000 pieces
// on curves. These pin the two halves of the fix in the real screen — the depth
// is visible, and stone actually arrives on the board.
await page.evaluate(() => window.__shiftle.start("endless"));
await page.waitForTimeout(400);

const free = await page.evaluate(() => window.__shiftle.state());
check("free play runs the ramp", (free?.ramp.piecesPerDepth ?? 0) > 0);
check("free play is not rationed — it ramps instead", free?.rules.pieceLimit === 0);

const ramped = await page.evaluate(async () => {
  const api = window.__shiftle;
  for (let i = 0; i < 400; i++) {
    const state = api.state();
    if (!state || state.over) break;
    if (api.stoneOnBoard() > 0 && api.depth() > 0) break;
    if (!api.botMove()) break;
  }
  return { stone: api.stoneOnBoard(), depth: api.depth(), over: api.state()?.over ?? true };
});
check("the round goes deeper as it runs", ramped.depth > 0, `depth ${ramped.depth}`);
check("and the rim turns to stone", ramped.stone > 0, `${ramped.stone} stones`);

await page.evaluate(() => window.__shiftle.menu());
await page.waitForTimeout(250);

// --- what depth looks like -------------------------------------------------
// The ramp changed the rules every 22 pieces and changed nothing you could see,
// so depth 8 looked exactly like depth 0. These pin the two halves of the fix
// on the real screen: the ground deepens, and it deepens into the theme's own
// hue rather than drifting toward some shared colour.
//
// The backdrop is sampled from the canvas itself rather than from the numbers
// that produced it — the sheet is baked offscreen and blitted, so reading the
// source would prove the maths and not the picture.
const sampleGround = () =>
  page.evaluate(() => {
    const canvas = document.querySelector("#board");
    const ctx = canvas.getContext("2d");
    // Top-left corner: backdrop everywhere, on every disc size.
    const d = ctx.getImageData(6, 6, 1, 1).data;
    const [r, g, b] = [d[0] / 255, d[1] / 255, d[2] / 255];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    // Chroma, not HSL saturation. HSL saturation is scale-invariant, so a blue
    // washed halfway to white still reports 100% and the bleaching failure
    // sails straight past it. Chroma is the distance from grey, which is what
    // both failure modes — mud and bleach — actually destroy.
    const c = max - min;
    if (max === min) return { h: 0, c: 0, l };
    let h;
    if (max === r) h = ((g - b) / c + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / c + 2) / 6;
    else h = ((r - g) / c + 4) / 6;
    return { h: h * 360, c, l };
  });

await page.evaluate(() => window.__shiftle.start("endless"));
await page.waitForTimeout(500);
// Read off a fresh board, and it is the same for every round: depth 0 is depth
// 0 whichever seed dealt it, so this stays valid even if the dive below has to
// deal a new round to find one the bot survives.
const shallow = await sampleGround();
check("a fresh round starts at the top", (await page.evaluate(() => window.__shiftle.depth())) === 0);
check("and opens in the player's own palette, not a world's",
  (await page.evaluate(() => window.__shiftle.era())) === "candy");

// Free play is seeded from the clock, so how deep the bot gets varies from run
// to run — and on an unlucky board it dies before depth 4 and every check below
// it fails for no reason at all. Seen live: one run reported four failures and
// the next reported none. So this deals a fresh round and tries again rather
// than judging the feature on one bad deal.
let dived = { depth: 0, over: true };
for (let attempt = 0; attempt < 5 && dived.depth < 3; attempt++) {
  if (attempt > 0) {
    await page.evaluate(() => window.__shiftle.start("endless"));
    await page.waitForTimeout(400);
  }
  dived = await page.evaluate(async () => {
    const api = window.__shiftle;
    for (let i = 0; i < 1200; i++) {
      const state = api.state();
      if (!state || state.over) break;
      if (api.depth() >= 3) break;
      if (!api.botMove()) break;
    }
    return { depth: api.depth(), over: api.state()?.over ?? true };
  });
}
await page.waitForTimeout(1400);

check("and the blocks harden as it goes deeper",
  (await page.evaluate(() => window.__shiftle.material())) !== "candy",
  `material=${await page.evaluate(() => window.__shiftle.material())} at depth ${dived.depth}`);

if (dived.depth >= 3) {
  const deep = await sampleGround();
  check("the ground deepens as the round goes on",
    deep.l < shallow.l - 0.01,
    `lightness ${(shallow.l * 100).toFixed(1)}% -> ${(deep.l * 100).toFixed(1)}% at depth ${dived.depth}`);
  // The failure this guards is specific: blending toward gold cancels to grey
  // and compositing it bleaches toward white. Both drop the saturation.
  check("and gets richer rather than greyer",
    deep.c >= shallow.c - 0.005,
    `chroma ${shallow.c.toFixed(3)} -> ${deep.c.toFixed(3)}`);
  // The bound is the cap the code actually enforces, not a guess: a world may
  // turn the ground by up to twenty degrees and `rotate()` clamps there. That is
  // what keeps an earned Theme recognisable — Sky plus Ocean still has to feel
  // like Sky — and it is the same number the unit tests assert.
  check("and it is still the same theme, not a drift toward some other colour",
    Math.abs(deep.h - shallow.h) <= 21,
    `hue ${shallow.h.toFixed(1)} -> ${deep.h.toFixed(1)}`);
  // Never anywhere near a dark theme, which is the whole art brief.
  check("and never anywhere near a dark screen", deep.l > 0.4,
    `lightness ${(deep.l * 100).toFixed(1)}%`);
} else {
  check("the bot reached a depth worth measuring", false, `only got to ${dived.depth}`);
}

// --- the depth worlds ------------------------------------------------------
// The hard rule is that a world's pattern may never change what colour a block
// reads as, because colour is what decides whether a line pays. That is checked
// by *sampling the drawn board* rather than by trusting the pattern specs — the
// specs are unit-tested, but only the canvas knows what actually landed.
const worldColours = () =>
  page.evaluate(() => {
    const canvas = document.querySelector("#board");
    const ctx = canvas.getContext("2d");
    const dpr = canvas.width / canvas.clientWidth;
    const l = window.__shiftle.layout();
    // Walk a ring of samples at the middle radius and keep the ones that landed
    // on a saturated cell, so this measures blocks and not the plate.
    const cx = (canvas.clientWidth / 2) * dpr;
    const cy = l.boardCy * dpr;
    const r = l.boardRadius * 0.72 * dpr;
    const out = [];
    for (let i = 0; i < 180; i++) {
      const a = (i / 180) * Math.PI * 2;
      const d = ctx.getImageData(Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a)), 1, 1).data;
      const [red, green, blue] = [d[0] / 255, d[1] / 255, d[2] / 255];
      const max = Math.max(red, green, blue), min = Math.min(red, green, blue);
      const chroma = max - min;
      if (chroma < 0.25) continue;
      out.push(chroma);
    }
    return out;
  });

// Spread across the worlds a real round passes through. The span is two depths
// precisely so this is possible: the bot's median round is depth ~14 and it
// could not be driven past 15, which at the old ten-depth span meant only two
// worlds were ever reachable. `npm run worlds` still draws all ten plus a second
// lap through this same renderer, which is where the deep ones are judged.
for (const target of [0, 2, 6, 12]) {
  // Free play is seeded from the clock and how deep the bot gets varies, so a
  // single unlucky deal would fail a check about the renderer. Deal again rather
  // than judging the world system on one bad board.
  let got = { depth: -1, world: "", over: true };
  for (let attempt = 0; attempt < 6 && got.depth < target; attempt++) {
    await page.evaluate(() => window.__shiftle.start("endless"));
    await page.waitForTimeout(300);
    got = await page.evaluate(async (want) => {
      const api = window.__shiftle;
      for (let i = 0; i < 2000; i++) {
        const state = api.state();
        if (!state || state.over) break;
        if (api.depth() >= want) break;
        if (!api.botMove()) break;
      }
      return { depth: api.depth(), world: api.world(), over: api.state()?.over ?? true };
    }, target);
  }
  if (got.depth < target) {
    check(`the bot reached depth ${target}`, false, `only got to ${got.depth} in six rounds`);
    continue;
  }
  // A fresh board is nearly empty, so the sample ring would land in the holes
  // and measure the plate. Lay some pieces down first.
  await page.evaluate(async () => {
    const api = window.__shiftle;
    for (let i = 0; i < 24 && api.filledCells() < 24; i++) {
      if (!api.botMove()) break;
    }
  });
  await page.waitForTimeout(900);
  const chromas = await worldColours();
  const mean = chromas.reduce((a, b) => a + b, 0) / Math.max(1, chromas.length);
  check(
    `depth ${target} is the ${got.world} world and its blocks keep their colour`,
    chromas.length > 20 && mean > 0.35,
    `${chromas.length} samples, mean chroma ${mean.toFixed(3)}`,
  );
  await shot(`20-world-${got.world}`);
}

await page.evaluate(() => window.__shiftle.menu());
await page.waitForTimeout(250);

// --- and none of it reaches the clock -------------------------------------
// Marcus asked for depth in free play only. The gate is the ramp itself rather
// than a mode name, so this checks the thing that does the gating.
//
// Note this drives the real button. `__shiftle.start` is startGame, which only
// knows daily and endless, so start("time") quietly runs free play under the
// wrong name — a check written that way passes while testing nothing.
await page.evaluate(() => window.__shiftle.menu());
await page.waitForTimeout(250);
await page.evaluate(() => window.__shiftle.timeAttack());
await page.waitForTimeout(500);
const timed = await page.evaluate(async () => {
  const api = window.__shiftle;
  for (let i = 0; i < 200; i++) {
    const state = api.state();
    if (!state || state.over) break;
    if (!api.botMove()) break;
  }
  return { depth: api.depth(), perDepth: api.state()?.ramp.piecesPerDepth ?? -1 };
});
check("time attack carries no ramp at all", timed.perDepth === 0, `piecesPerDepth=${timed.perDepth}`);
check("and its blocks stay the sweet they have always been",
  (await page.evaluate(() => window.__shiftle.material())) === "candy");
check("and it never leaves the palette the player chose",
  (await page.evaluate(() => window.__shiftle.era())) === "candy");
check("and it never leaves the first world",
  (await page.evaluate(() => window.__shiftle.world())) === "candy");
check("so its depth never leaves zero, however long the round runs",
  timed.depth === 0, `depth=${timed.depth}`);

await page.evaluate(() => window.__shiftle.menu());
await page.waitForTimeout(250);

// --- safe-area insets ------------------------------------------------------
// Nothing here has a notch, so this drives the insets by hand. The layout used
// to parse the custom property directly, and whether env() is substituted at
// that point is engine-dependent — on WebKit a literal "env(...)" would parse
// to NaN and silently become zero, putting the score under the Dynamic Island.
await page.evaluate(() => window.__shiftle.start("endless"));
await page.waitForTimeout(400);

const flat = await page.evaluate(() => window.__shiftle.layout());
const inset = await page.evaluate(() => {
  const root = document.documentElement;
  root.style.setProperty("--safe-top", "59px");
  root.style.setProperty("--safe-bottom", "34px");
  return window.__shiftle.remeasure();
});
check(
  "a top safe-area inset pushes the header down by exactly that much",
  inset.headerY - flat.headerY === 59,
  `${flat.headerY} -> ${inset.headerY}`,
);
check(
  "a bottom safe-area inset lifts the tray by exactly that much",
  flat.trayTop - inset.trayTop === 34,
  `${flat.trayTop} -> ${inset.trayTop}`,
);
await shot("14-safe-area");

await page.evaluate(() => {
  document.documentElement.style.removeProperty("--safe-top");
  document.documentElement.style.removeProperty("--safe-bottom");
  window.__shiftle.remeasure();
});

// --- Game Center -----------------------------------------------------------
// There is no native plugin in a browser, so nothing here would ever be
// exercised until it broke on a device. __shiftle.fakeGameCenter() installs a
// stand-in that records what it was asked to do.
// The bug this pins: nothing imported @capacitor/core, so `Capacitor.Plugins`
// was never populated — not just in a browser but on a device too, where the
// injected bridge lists plugins in `PluginHeaders` and fills `Plugins` never.
// Every native integration looked absent on iOS and failed silently.
check(
  "the Capacitor runtime is loaded, so plugins can register at all",
  await page.evaluate(() => typeof window.Capacitor?.registerPlugin === "function"),
);
check(
  "no leaderboard button without a native plugin",
  (await page.locator('[data-action="leaderboard"]').count()) === 0,
);

await page.evaluate(() => window.__shiftle.fakeGameCenter());
await page.evaluate(() => window.__shiftle.menu());
await page.waitForTimeout(300);
check(
  "the menu offers the leaderboard once Game Center is there",
  (await page.locator('[data-action="leaderboard"]').count()) === 1,
);
await shot("13-menu-leaderboard");

await page.locator('[data-action="leaderboard"]').click();
await page.waitForTimeout(300);
let gc = await page.evaluate(() => window.__shiftle.gameCenterCalls());
check(
  "the leaderboard button signs in and opens the overlay",
  gc.some((c) => c.method === "signIn") && gc.some((c) => c.method === "showLeaderboard"),
  gc.map((c) => c.method).join(", "),
);

// A finished round has to reach the right board.
await page.evaluate(() => window.__shiftle.start("endless"));
await page.waitForTimeout(400);
// Something on the scoreboard first, so this proves a real score travels
// rather than that zero does.
for (let i = 0; i < 6; i++) {
  await page.evaluate(() => window.__shiftle.botMove());
  await page.waitForTimeout(60);
}
await page.evaluate(() => window.__shiftle.jam(0));
await page.waitForTimeout(1800);
gc = await page.evaluate(() => window.__shiftle.gameCenterCalls());
const submitted = gc.filter((c) => c.method === "submitScore").pop();
check(
  "finishing a free round submits to the endless board",
  submitted?.options?.leaderboardID === "com.nomarcus.shiftle.endless",
  submitted ? String(submitted.options.leaderboardID) : "nothing submitted",
);
check(
  "the score submitted is the round's, as a whole number",
  Number.isInteger(submitted?.options?.totalScoreAmount) &&
    submitted.options.totalScoreAmount > 0,
  String(submitted?.options?.totalScoreAmount),
);
check(
  "the result screen links to that board",
  (await page.locator('[data-action="leaderboard"]').count()) === 1,
);
await shot("12-game-center");

// The setting has to actually reach the drag. It is only read when a round's
// GameScreen is built — same as the theme — so changing it takes hold on the
// next round, and that is what this checks: cycle the setting, start a fresh
// round, and confirm the real threshold `onMove` checks against moved in the
// direction the label promises: "low" sensitivity asking for more travel than
// "high".
{
  const seen = {};
  for (let i = 0; i < 3; i++) {
    const level = await page.evaluate(() => window.__shiftle.cycleSensitivity());
    await page.evaluate(() => window.__shiftle.start("endless"));
    await page.waitForTimeout(200);
    seen[level] = await page.evaluate(() => window.__shiftle.dragSlop());
  }
  check(
    "the sensitivity setting changes the real drag threshold",
    seen.low > seen.standard && seen.standard > seen.high,
    JSON.stringify(seen),
  );
  // Back to the default, in a fresh round, so the rest of the suite sees
  // standard behaviour.
  while ((await page.evaluate(() => window.__shiftle.cycleSensitivity())) !== "standard") {
    /* keep cycling */
  }
  await page.evaluate(() => window.__shiftle.start("endless"));
  await page.waitForTimeout(200);
}

// --- a striped piece keeps its marker while it is being dragged ------------
// The ghost preview used to draw every piece as a plain block once it found a
// legal home — the one thing worth knowing before committing (that this is
// the striped piece, not a plain one) was the one thing it dropped. Measured
// directly: the piece's own material is the same "wedge" shape used
// elsewhere, cell index 1 of "wedge3" is [dr,ds]=[1,0], so once a target is
// found the striped cell sits at (target.r+1, target.s).
{
  await page.evaluate(() => window.__shiftle.start("endless"));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__shiftle.primeStripedDrag());
  await page.waitForTimeout(150);

  const layout = await page.evaluate(() => window.__shiftle.layout());
  const slotBox = await page.evaluate(() => window.__shiftle.slotBox(0));
  const from = { x: slotBox.x + slotBox.width / 2, y: slotBox.y + slotBox.height / 2 };

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 2, from.y - 2);
  await page.waitForTimeout(40);
  // Straight up onto the board — an empty disc, so anywhere on it is legal.
  await page.mouse.move(from.x, layout.boardCy);
  await page.waitForTimeout(120);

  const debug = await page.evaluate(() => window.__shiftle.dragDebug());
  check("a target is found for the striped drag", debug?.hasTarget === true, JSON.stringify(debug));

  if (debug?.hasTarget) {
    const brightness = await page.evaluate(
      async ({ r, s, dpr }) => {
        const canvasModule = await import("/src/render/canvas.ts");
        const layout = window.__shiftle.layout();
        const spec = window.__shiftle.state().spec;
        const board = canvasModule.computeLayout(
          spec,
          window.innerWidth / 2,
          layout.boardCy,
          layout.boardRadius,
        );
        const g = canvasModule.cellGeometry(board, r, s);
        const midR = (g.innerRadius + g.outerRadius) / 2;
        const midA = (g.startAngle + g.endAngle) / 2;
        const x = Math.round((g.cx + midR * Math.cos(midA)) * dpr);
        const y = Math.round((g.cy + midR * Math.sin(midA)) * dpr);
        const canvas = document.querySelector("canvas");
        const ctx = canvas.getContext("2d");
        const size = 14;
        const data = ctx.getImageData(x - size / 2, y - size / 2, size, size).data;
        let max = 0;
        for (let i = 0; i < data.length; i += 4) {
          max = Math.max(max, (data[i] + data[i + 1] + data[i + 2]) / 3);
        }
        return max;
      },
      { r: debug.targetR + 1, s: debug.targetS, dpr: 2 },
    );
    // The striped marker is white at 0.92 alpha over the block's own colour —
    // bright enough that its brightest pixel sits well above 220/255 even
    // blended at the ghost's 45% preview alpha. A plain block's brightest
    // point (a bevel highlight) does not reach that.
    check(
      "and the striped marker is actually visible in the ghost preview",
      brightness > 200,
      `brightest pixel ${brightness.toFixed(0)}/255 at the striped cell`,
    );
  }

  await page.mouse.move(from.x, from.y);
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.evaluate(() => window.__shiftle.start("endless"));
  await page.waitForTimeout(200);
}

await browser.close();
await server.close();

const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  console.error(`\n${failed.length} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed.");
