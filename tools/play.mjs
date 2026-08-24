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

// --- sound can be switched off, and the choice sticks ----------------------
const sound = page.locator('[data-action="sound"]');
const soundLabelBefore = await sound.textContent();
await sound.click();
await page.waitForTimeout(150);
check("the sound toggle flips", (await sound.textContent()) !== soundLabelBefore);
await sound.click();
await page.waitForTimeout(150);
check("the sound toggle flips back", (await sound.textContent()) === soundLabelBefore);

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

// --- levels ----------------------------------------------------------------
// The level flow is where a mode-switching bug would hide: a goal that never
// completes, a lock that never opens, a strip left on screen afterwards.
await page.evaluate(() => window.__shiftle.clearLevels());
await page.evaluate(() => window.__shiftle.menu());
await page.waitForTimeout(300);
await page.locator('[data-action="levels"]').click();
await page.waitForTimeout(300);

check("the level grid opens", (await page.locator(".level-tile").count()) === 20);
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
check("and the clock is the tense kind, not a comfortable one", opening !== null && opening <= 35, `${opening}s`);

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

await browser.close();
await server.close();

const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  console.error(`\n${failed.length} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed.");
