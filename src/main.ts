/**
 * App shell: menu, mode selection, theme and language, game over.
 *
 * The canvas owns both the game and the animated menu backdrop; everything
 * here is DOM, because menus are text and buttons and there is no reason to
 * hand-draw those.
 */

import { type GameState, createGame, depthOf, isGameOver } from "./engine/game.js";
import { filledCount, stoneCount } from "./engine/board.js";
import { coreReady } from "./engine/core.js";
import { chooseMove } from "./engine/bot.js";
import { applyMove } from "./engine/game.js";
import { FREE_PLAY_RAMP } from "./engine/ramp.js";
import { TIME_ATTACK } from "./engine/timeattack.js";
import { dateKey, hashSeed } from "./engine/rng.js";
import { dailyPuzzle } from "./engine/daily.js";
import {
  type Challenge,
  decodeChallenge,
  encodeChallenge,
  formatCode,
  newChallenge,
} from "./engine/challenge.js";
import {
  LEVELS,
  type Level,
  goalProgress,
  levelBoard,
  levelCore,
  levelByNumber,
  levelSeed,
} from "./engine/levels.js";
import {
  type PackId,
  type SizeId,
  DEFAULT_PACK,
  DEFAULT_SIZE,
  PACKS,
  SIZES,
  sizeById,
} from "./engine/variants.js";
import { THEMES } from "./render/theme.js";
import { GameScreen } from "./ui/game-screen.js";
import { MenuScene } from "./ui/menu-scene.js";
import { type Lang, type StringKey, hasString, lang, setLang, t } from "./ui/strings.js";
import { haptic } from "./platform/haptics.js";
import { isMuted, play as playSound, setMuted, unlock as unlockAudio } from "./platform/audio.js";
import { shareResult } from "./platform/share.js";
import { type ShareCard, renderShareDataUrl, renderShareImage } from "./render/share-card.js";
import {
  LEADERBOARDS,
  isAvailable as gameCenterAvailable,
  refresh as refreshGameCenter,
  showLeaderboard,
  signIn,
  submitScore,
  useTestDouble as useGameCenterTestDouble,
} from "./platform/gamecenter.js";
import {
  hydrate,
  readJson,
  readNumber,
  readString,
  writeJson,
  writeNumber,
  writeString,
} from "./platform/storage.js";

interface DailyResult {
  readonly date: string;
  readonly puzzle: number;
  readonly score: number;
  readonly ringsCleared: number;
  readonly bestCombo: number;
  readonly spinsLeft: number;
}

const ICON_QUIT =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';
/** Three podium bars. A trophy or a star reads as mud at 21 pixels; this does not. */
const ICON_LEADERBOARD =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V13h5v8M9.5 21V4h5v17M15 21v-6h5v6M2.5 21h19" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_RESTART =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 12a8.5 8.5 0 1 1-2.49-6.01" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M20.5 2.5v5.5H15" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** One sweet per letter, matching the block palette. */
const TITLE_COLOURS = ["#FF2D42", "#FF7A00", "#FFC400", "#4FD31A", "#00CFC9", "#0A7CFF", "#A03CF0"];

const canvas = document.querySelector<HTMLCanvasElement>("#board")!;
const app = document.querySelector<HTMLDivElement>("#app")!;

let theme = THEMES.find((option) => option.id === readString("theme")) ?? THEMES[0]!;
let screen: GameScreen | null = null;
let menu: MenuScene | null = null;
/** What the round in progress is being played on, so restart can repeat it. */
let lastVariant: { size: SizeId; pack: PackId } = { size: DEFAULT_SIZE, pack: DEFAULT_PACK };

// ------------------------------------------------------------------ helpers

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function overlay(className: string): HTMLDivElement {
  document.querySelectorAll(".overlay").forEach((node) => node.remove());
  const node = el("div", `overlay ${className}`);
  app.append(node);
  return node;
}

function applyThemeChrome(): void {
  document.body.style.background = theme.backdrop[1];
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.backdrop[0]);
}

function todayResult(): DailyResult | null {
  const stored = readJson<DailyResult | null>("daily", null);
  return stored && stored.date === dateKey(new Date()) ? stored : null;
}

/** The shareable line. The mandala image is generated separately. */
export function shareLine(result: DailyResult): string {
  const score = result.score.toLocaleString(lang() === "sv" ? "sv-SE" : "en-GB");
  return `Shiftle #${result.puzzle} · ${score} ${t("points")} · ⟳${result.spinsLeft} ${t("left")}`;
}

function localeNumber(value: number): string {
  return value.toLocaleString(lang() === "sv" ? "sv-SE" : "en-GB");
}

/** Both ids double as string keys, so the labels come straight from the table. */
function variantLabel(size: SizeId, pack: PackId): string {
  return `${t(size as StringKey)} · ${t(pack as StringKey)}`;
}

function savedSize(): SizeId {
  const stored = readString("size");
  return SIZES.some((option) => option.id === stored) ? (stored as SizeId) : DEFAULT_SIZE;
}

function savedPack(): PackId {
  const stored = readString("pack");
  return PACKS.some((option) => option.id === stored) ? (stored as PackId) : DEFAULT_PACK;
}

/**
 * Which levels are done. Stored as a list rather than a high-water mark: a
 * player who skips ahead by beating a hard one should keep that, and a list
 * survives levels being reordered or inserted later.
 */
function levelsDone(): number[] {
  const stored = readJson<number[]>("levels", []);
  return Array.isArray(stored) ? stored.filter((n) => typeof n === "number") : [];
}

function markLevelDone(number: number): void {
  const done = levelsDone();
  if (done.includes(number)) return;
  writeJson("levels", [...done, number].sort((a, b) => a - b));
}

/** The first level is always open; the rest wait for the one before them. */
function levelUnlocked(number: number): boolean {
  return number === 1 || levelsDone().includes(number - 1);
}

/** What a level asks for, in words. */
function goalText(level: Level): string {
  const key = (
    {
      score: "goalScore",
      rings: "goalRings",
      spokes: "goalSpokes",
      pure: "goalPure",
      stripes: "goalStripes",
      bullseye: "goalBullseye",
      cores: "goalCores",
      combo: "goalCombo",
    } as const
  )[level.goal.kind];

  // "Rensa 1 ringar" is wrong in both languages, and neither can be fixed by
  // bolting an (s) on the end — Swedish inflects the adjective as well. The
  // four goals that count things carry a written-out singular.
  const single = `${key}1` as StringKey;
  if (level.goal.target === 1 && hasString(single)) return t(single);

  return t(key).replace("%n", localeNumber(level.goal.target));
}

/**
 * Tears the current screen down completely: the running game or menu scene, the
 * corner buttons, the goal strip, and any overlay on top of them.
 *
 * The overlay used to be somebody else's job — startGame and startLevel each
 * cleared it themselves — so a start path that forgot left the previous screen
 * sitting over a live round. Every start path already calls this, so it is the
 * one place that can be relied on to do all of it.
 */
function stopEverything(): void {
  document.querySelectorAll(".overlay").forEach((node) => node.remove());
  document.querySelectorAll(".goal-strip").forEach((node) => node.remove());
  document.querySelectorAll(".hud").forEach((node) => node.remove());
  screen?.destroy();
  screen = null;
  menu?.stop();
  menu = null;
}

/**
 * Records a daily run as finished. Quitting or restarting counts as the
 * attempt — otherwise the same seed could be replayed until it went well, and
 * a leaderboard everyone can retry is not worth having.
 */
function bankDaily(state: GameState): void {
  writeJson("daily", {
    date: dateKey(new Date()),
    puzzle: dailyPuzzle(new Date()).number,
    score: state.score,
    ringsCleared: state.stats.ringsCleared,
    bestCombo: state.stats.bestCombo,
    spinsLeft: state.spins,
  } satisfies DailyResult);
  if (state.score > readNumber("best", 0)) writeNumber("best", state.score);
}

/** A card with one way out. For telling the player something, not asking. */
function notice(title: string, body: string): void {
  const node = overlay("confirm");
  const card = el("div", "card");
  card.append(el("div", "card-title", title));
  card.append(el("p", "confirm-body", body));

  const ok = el("button", "big", t("ok"));
  ok.dataset.action = "notice-ok";
  ok.addEventListener("click", () => node.remove());
  card.append(ok);

  node.append(card);
}

function confirmThen(title: string, body: string, onConfirm: () => void): void {
  // A card over a dimmed board, not a full-screen wash — the question is small
  // and the player should still see the round they are about to give up.
  const node = overlay("confirm");
  const card = el("div", "card");

  card.append(el("div", "card-title", title));
  card.append(el("p", "confirm-body", body));

  const yes = el("button", "big warm", t("confirm"));
  yes.addEventListener("click", onConfirm);
  card.append(yes);

  const no = el("button", "big alt", t("cancel"));
  no.addEventListener("click", () => node.remove());
  card.append(no);

  node.append(card);
}

/** The quit and restart buttons that sit in the top corners while playing. */
/**
 * The quit and restart corners.
 *
 * `restart` is passed in for a challenge, which cannot be restarted by looking
 * at the current mode — the round it has to rebuild is the one in the code.
 */
function gameHud(mode: "daily" | "endless" | "challenge" | "time", restartRound?: () => void): void {
  const hud = el("div", "hud");

  const quit = el("button", "icon");
  quit.innerHTML = ICON_QUIT;
  quit.dataset.action = "quit";
  quit.setAttribute("aria-label", t("quit"));
  quit.addEventListener("click", () => {
    const state = screen?.getState();
    if (!state || state.score === 0) return showMenu();
    confirmThen(t("quitAsk"), mode === "daily" ? t("usesAttempt") : t("loseScore"), () => {
      if (mode === "daily") bankDaily(state);
      showMenu();
    });
  });

  const restart = el("button", "icon");
  restart.innerHTML = ICON_RESTART;
  restart.dataset.action = "restart";
  restart.setAttribute("aria-label", t("restart"));
  restart.addEventListener("click", () => {
    const again = restartRound ?? (() => startGame(mode as "daily" | "endless", lastVariant));
    const state = screen?.getState();
    if (!state || state.score === 0) return again();
    confirmThen(t("restartAsk"), mode === "daily" ? t("usesAttempt") : t("loseScore"), () => {
      if (mode === "daily") {
        bankDaily(state);
        showMenu();
        return;
      }
      again();
    });
  });

  hud.append(quit, restart);
  app.append(hud);
}

// --------------------------------------------------------------------- menu

function titleNode(): HTMLDivElement {
  const node = el("div", "title");
  "Shiftle".split("").forEach((letter, i) => {
    const span = el("span", undefined, letter);
    span.style.setProperty("--c", TITLE_COLOURS[i % TITLE_COLOURS.length]!);
    span.style.setProperty("--d", `${i * 0.08}s`);
    node.append(span);
  });
  return node;
}

function showMenu(): void {
  stopEverything();
  applyThemeChrome();

  menu = new MenuScene(canvas, theme);
  menu.start();

  const node = overlay("menu");
  node.append(titleNode());
  node.append(el("div", "tagline", t("tagline")));

  const done = todayResult();
  const daily = el(
    "button",
    "big",
    done ? `${t("dailyDone")} · ${localeNumber(done.score)}` : t("daily"),
  );
  daily.dataset.action = "daily";
  daily.disabled = done !== null;
  daily.addEventListener("click", () => startGame("daily"));
  node.append(daily);

  // Today's disc is worth showing: the daily rotates size and pack, so the
  // player can see at a glance that it is a different puzzle from yesterday.
  const today = dailyPuzzle(new Date());
  node.append(el("div", "best", `#${today.number} · ${variantLabel(today.size, today.pack)}`));

  const levels = el("button", "big warm", t("levels"));
  levels.dataset.action = "levels";
  levels.addEventListener("click", showLevels);
  node.append(levels);

  const cleared = levelsDone().length;
  if (cleared > 0) node.append(el("div", "best", `${cleared} / ${LEVELS.length}`));

  const endless = el("button", "big alt", t("endless"));
  endless.dataset.action = "endless";
  endless.addEventListener("click", showSetup);
  node.append(endless);

  const best = readNumber("best", 0);
  if (best > 0) node.append(el("div", "best", `${t("best")} ${localeNumber(best)}`));

  const timed = el("button", "big hot", t("timeAttack"));
  timed.dataset.action = "time";
  timed.addEventListener("click", startTimeAttack);
  node.append(timed);

  const timeBest = readNumber("bestTime", 0);
  if (timeBest > 0) node.append(el("div", "best", `${t("timeBest")} ${localeNumber(timeBest)}`));

  const row = el("div", "swatches");
  for (const option of THEMES) {
    const swatch = el("button", "swatch");
    swatch.style.background = `linear-gradient(${option.backdrop[0]}, ${option.backdrop[1]})`;
    swatch.setAttribute("aria-pressed", String(option.id === theme.id));
    swatch.setAttribute("aria-label", option.label);
    swatch.addEventListener("click", () => {
      theme = option;
      writeString("theme", option.id);
      showMenu();
    });
    row.append(swatch);
  }
  node.append(row);

  const langs = el("div", "langs");
  for (const code of ["sv", "en"] as Lang[]) {
    const pill = el("button", "pill", code.toUpperCase());
    pill.setAttribute("aria-pressed", String(code === lang()));
    pill.addEventListener("click", () => {
      setLang(code);
      showMenu();
    });
    langs.append(pill);
  }
  const sound = el("button", "pill wide", isMuted() ? t("soundOff") : t("soundOn"));
  sound.dataset.action = "sound";
  sound.setAttribute("aria-pressed", String(!isMuted()));
  sound.addEventListener("click", () => {
    setMuted(!isMuted());
    sound.textContent = isMuted() ? t("soundOff") : t("soundOn");
    sound.setAttribute("aria-pressed", String(!isMuted()));
  });
  langs.append(sound);

  const help = el("button", "pill wide", t("how"));
  help.addEventListener("click", showHowTo);
  langs.append(help);
  node.append(langs);

  // Only when there is a native side to open. A button that does nothing is
  // worse than no button, so the browser build simply never shows one.
  //
  // In the corner rather than down among the language pills: this is the way
  // in to the leaderboards, not a setting, and it has to be findable without
  // reading the whole menu.
  if (gameCenterAvailable()) {
    const hud = el("div", "hud menu-hud");
    const boards = el("button", "icon");
    boards.innerHTML = ICON_LEADERBOARD;
    boards.dataset.action = "leaderboard";
    boards.setAttribute("aria-label", t("leaderboard"));
    // Game Center refuses to show anything to a signed-out player, and a tap
    // that does nothing at all is the thing this button was supposed to avoid.
    boards.addEventListener("click", () => {
      void showLeaderboard().then((shown) => {
        if (!shown) notice(t("gameCenter"), t("gameCenterSignedOut"));
      });
    });
    hud.append(boards);
    node.append(hud);
  }
}

/**
 * The level grid.
 *
 * Twenty tiles, and the state of each one is the whole screen: done, open, or
 * still locked. No stars, no percentages — a level is a question with a yes or
 * no answer, and dressing that up would only obscure which one to play next.
 */
function showLevels(): void {
  // Quitting a level came here without stopping the round, so the abandoned
  // board and its score carried on animating behind a translucent overlay.
  stopEverything();
  applyThemeChrome();
  menu = new MenuScene(canvas, theme);
  menu.start();

  const done = levelsDone();
  const node = overlay("result levels");

  // Twenty tiles do not fit on a phone, so this screen scrolls — which means
  // the way out cannot live at the bottom of it. Appended to the app rather
  // than to the overlay so it stays pinned while the tiles scroll under it.
  const hud = el("div", "hud");
  const close = el("button", "icon");
  close.innerHTML = ICON_QUIT;
  close.dataset.action = "menu";
  close.setAttribute("aria-label", t("menu"));
  close.addEventListener("click", showMenu);
  hud.append(close);
  app.append(hud);

  node.append(el("div", "how-title", t("levels")));

  const grid = el("div", "level-grid");
  for (const level of LEVELS) {
    const complete = done.includes(level.number);
    const open = levelUnlocked(level.number);

    const tile = el("button", `level-tile${complete ? " done" : ""}${open ? "" : " locked"}`);
    tile.dataset.level = String(level.number);
    tile.disabled = !open;
    tile.setAttribute(
      "aria-label",
      `${t("levelN")} ${level.number}${open ? ` — ${goalText(level)}` : ` — ${t("locked")}`}`,
    );
    tile.append(el("b", undefined, String(level.number)));
    tile.append(el("span", undefined, open ? goalText(level) : t("locked")));
    if (open) tile.addEventListener("click", () => startLevel(level));
    grid.append(tile);
  }
  node.append(grid);

  if (done.length === LEVELS.length) node.append(el("div", "confirm-body", t("allLevelsDone")));

  const back = el("button", "big alt", t("menu"));
  back.addEventListener("click", showMenu);
  node.append(back);
}

/** Pick a disc and a piece pack before a free round. */
function showSetup(): void {
  let size = savedSize();
  let pack = savedPack();

  const node = overlay("confirm setup");
  const card = el("div", "card");
  card.append(el("div", "card-title", t("setupTitle")));

  const group = <T extends string>(
    labelKey: StringKey,
    options: readonly T[],
    selected: T,
    onPick: (value: T) => void,
  ) => {
    card.append(el("div", "choice-label", t(labelKey)));
    const row = el("div", "choices");
    for (const option of options) {
      const pill = el("button", "choice", t(option as StringKey));
      pill.dataset.choice = option;
      pill.setAttribute("aria-pressed", String(option === selected));
      pill.addEventListener("click", () => {
        onPick(option);
        row.querySelectorAll(".choice").forEach((other) => {
          other.setAttribute("aria-pressed", String((other as HTMLElement).dataset.choice === option));
        });
      });
      row.append(pill);
    }
    card.append(row);
  };

  group(
    "sizeLabel",
    SIZES.map((option) => option.id),
    size,
    (value) => {
      size = value;
      writeString("size", value);
    },
  );
  group(
    "packLabel",
    PACKS.map((option) => option.id),
    pack,
    (value) => {
      pack = value;
      writeString("pack", value);
    },
  );

  const go = el("button", "big", t("start"));
  go.dataset.action = "start";
  go.addEventListener("click", () => startGame("endless", { size, pack }));
  card.append(go);

  const back = el("button", "big alt", t("menu"));
  back.addEventListener("click", showMenu);
  card.append(back);

  node.append(card);
}

function showHowTo(): void {
  const node = overlay("result");
  node.append(el("div", "how-title", t("howTitle")));

  const steps = el("div", "how");
  (
    [
      ["1", t("how1")],
      ["2", t("how2")],
      ["3", t("how3")],
      ["★", t("how4")],
      ["◆", t("how5")],
      ["▣", t("how6")],
      ["⏱", t("how7")],
      ["◉", t("how8")],
      ["◈", t("how9")],
    ] as Array<[string, string]>
  ).forEach(
    ([num, text]) => {
      const step = el("div", "step");
      step.append(el("b", undefined, num), el("p", undefined, text));
      steps.append(step);
    },
  );
  node.append(steps);

  const ok = el("button", "big alt", t("gotIt"));
  ok.addEventListener("click", showMenu);
  node.append(ok);
}

// --------------------------------------------------------------------- game

function startGame(mode: "daily" | "endless", variant?: { size: SizeId; pack: PackId }): void {
  // Here rather than on each button: every way into a round goes through this,
  // so daily, free play, play again and restart all get the same send-off.
  playSound("start", 0, 2);
  stopEverything();
  applyThemeChrome();

  // The daily's seed is vetted before anyone sees it, so a day nobody could
  // get a round out of never ships.
  const puzzle = mode === "daily" ? dailyPuzzle(new Date()) : null;
  const setup = puzzle
    ? { size: puzzle.size, pack: puzzle.pack }
    : (variant ?? { size: savedSize(), pack: savedPack() });
  lastVariant = setup;

  const game = createGame({
    seed: puzzle ? puzzle.seed : hashSeed(`endless:${Date.now()}`),
    mode,
    spec: sizeById(setup.size).spec,
    pack: setup.pack,
    // The daily is rationed so every attempt is the same length as well as the
    // same puzzle. Free play is not rationed — it ramps instead, so a round
    // ends because the disc beat you rather than because a counter ran out.
    rules: puzzle ? { pieceLimit: puzzle.pieceLimit } : undefined,
    ramp: puzzle ? undefined : FREE_PLAY_RAMP,
  });
  screen = new GameScreen(canvas, game, {
    theme,
    haptic,
    onGameOver: (final) => showGameOver(final, mode),
  });
  screen.start();
  gameHud(mode);
}

// ---------------------------------------------------------------- time attack

/**
 * Time attack.
 *
 * The other modes run out of space; this one runs out of time. It is the most
 * stressful thing in the game on purpose — the clock never stops, and only
 * clearing lines puts seconds back — and the most directly competitive, because
 * there is nothing in the score but how fast you can think. No ration to pace
 * yourself against and no ramp to plan around.
 *
 * Always the standard disc and the mixed pack. The other modes let you pick;
 * this one cannot, or two scores would not be comparable, and comparing scores
 * is the entire point of it.
 */
function startTimeAttack(): void {
  stopEverything();
  applyThemeChrome();
  playSound("start");

  const game = createGame({
    seed: hashSeed(`time:${Date.now()}`),
    mode: "time",
    spec: sizeById("standard").spec,
    pack: "mixed",
    // The adaptive deal stays on. Being handed three dead pieces is annoying in
    // a mode you can think your way out of and unplayable in one you cannot.
    fairDeal: true,
  });

  screen = new GameScreen(canvas, game, {
    theme,
    haptic,
    clock: TIME_ATTACK,
    onGameOver: (final) => showTimeResult(final),
  });
  screen.start();
  gameHud("time", startTimeAttack);
}

function showTimeResult(state: GameState): void {
  // Read before the screen is torn down: it owns the clock, because the engine
  // is a pure function of moves and has no idea what time it is.
  const survived = screen?.getElapsed() ?? 0;
  stopEverything();
  applyThemeChrome();
  menu = new MenuScene(canvas, theme);
  menu.start();

  const beat = state.score > readNumber("bestTime", 0);
  if (beat) writeNumber("bestTime", state.score);
  if (state.score > readNumber("best", 0)) writeNumber("best", state.score);
  void submitScore(LEADERBOARDS.time, state.score);

  const node = overlay("result");
  node.append(el("div", "how-title", t("timeUp")));
  node.append(el("div", "score-big", localeNumber(state.score)));

  const stats = el("div", "stats");
  for (const [value, label] of [
    [`${Math.round(survived)}s`, t("timeSurvived")],
    [String(state.stats.ringsCleared), t("rings")],
    [`x${state.stats.bestCombo}`, t("bestCombo")],
  ] as const) {
    const stat = el("div", "stat");
    stat.append(el("b", undefined, value));
    stat.append(el("span", undefined, label));
    stats.append(stat);
  }
  node.append(stats);
  if (!beat) node.append(el("div", "best", `${t("timeBest")} ${localeNumber(readNumber("bestTime", 0))}`));

  const again = el("button", "big hot", t("again"));
  again.dataset.action = "again";
  again.addEventListener("click", startTimeAttack);
  node.append(again);

  if (gameCenterAvailable()) {
    const boards = el("button", "big alt", t("leaderboard"));
    boards.dataset.action = "leaderboard";
    boards.addEventListener("click", () => {
      void showLeaderboard(LEADERBOARDS.time).then((shown) => {
        if (!shown) notice(t("gameCenter"), t("gameCenterSignedOut"));
      });
    });
    node.append(boards);
  }

  const back = el("button", "big alt", t("menu"));
  back.dataset.action = "menu";
  back.addEventListener("click", showMenu);
  node.append(back);
}

// ----------------------------------------------------------------- challenges

/**
 * The challenge screen: start one, or take one somebody sent you.
 *
 * Everything here works with no network at all, which is the point. A code is
 * the entire round — disc, pack, ration, piece sequence and the score to beat —
 * so it travels by whatever people already use to talk to each other.
 */
function showChallenge(incoming?: Challenge): void {
  stopEverything();
  applyThemeChrome();
  menu = new MenuScene(canvas, theme);
  menu.start();

  const node = overlay("result challenge");
  node.append(el("div", "how-title", t("challenge")));
  node.append(el("p", "how-line", t("challengeBlurb")));

  if (incoming) {
    node.append(
      el(
        "div",
        "goal-line",
        `${variantLabel(incoming.size, incoming.pack)} · ${incoming.pieces} ${t("pieces").toLowerCase()}`,
      ),
    );
    if (incoming.score > 0) {
      node.append(el("div", "how-title", localeNumber(incoming.score)));
      node.append(el("div", "best", t("challengeBeat")));
    }
    const go = el("button", "big", t("challengePlay"));
    go.dataset.action = "challenge-play";
    go.addEventListener("click", () => startChallenge(incoming));
    node.append(go);
  } else {
    const go = el("button", "big", t("challengeNew"));
    go.dataset.action = "challenge-new";
    go.addEventListener("click", () => {
      startChallenge({ ...newChallenge(String(Date.now())), score: 0 });
    });
    node.append(go);
  }

  // Pasting is how a code actually arrives — out of a message, usually with the
  // rest of the sentence still attached, which the decoder is built to survive.
  const field = el("input", "code-field") as HTMLInputElement;
  field.type = "text";
  field.placeholder = t("challengePaste");
  field.autocapitalize = "characters";
  field.spellcheck = false;
  field.dataset.action = "challenge-code";
  node.append(field);

  const take = el("button", "big alt", t("challengeTake"));
  take.dataset.action = "challenge-take";
  const status = el("div", "best", "");
  take.addEventListener("click", () => {
    const found = decodeChallenge(field.value);
    if (!found) {
      status.textContent = t("challengeBad");
      playSound("denied");
      return;
    }
    showChallenge(found);
  });
  node.append(take);
  node.append(status);

  const back = el("button", "big alt", t("menu"));
  back.dataset.action = "menu";
  back.addEventListener("click", showMenu);
  node.append(back);
}

function startChallenge(challenge: Challenge): void {
  stopEverything();
  applyThemeChrome();
  playSound("start");

  const game = createGame({
    seed: challenge.seed,
    mode: "challenge",
    spec: sizeById(challenge.size).spec,
    pack: challenge.pack,
    // Fixed, never adaptive: an adaptive deal reads the board, so two players
    // who played differently would get different pieces and the challenge would
    // not be the same round at all.
    fairDeal: false,
    rules: { pieceLimit: challenge.pieces },
  });

  screen = new GameScreen(canvas, game, {
    theme,
    haptic,
    onGameOver: (final) => showChallengeResult(challenge, final),
  });
  screen.start();
  gameHud("challenge", () => startChallenge(challenge));
}

/**
 * The result of a challenge round, and the code to send on.
 *
 * The code always carries *this* player's score, so a challenge passed down a
 * group chat keeps raising its own bar — each person sends on the number to
 * beat rather than the one they were beating.
 */
function showChallengeResult(challenge: Challenge, state: GameState): void {
  stopEverything();
  applyThemeChrome();
  menu = new MenuScene(canvas, theme);
  menu.start();

  if (state.score > readNumber("best", 0)) writeNumber("best", state.score);

  const node = overlay("result challenge");
  const beat = challenge.score > 0 && state.score > challenge.score;
  const lost = challenge.score > 0 && !beat;

  node.append(el("div", "how-title", beat ? t("challengeWon") : lost ? t("challengeLost") : t("gameOver")));
  node.append(el("div", "score-big", localeNumber(state.score)));
  if (challenge.score > 0) {
    node.append(el("div", "best", `${t("challengeTarget")} ${localeNumber(challenge.score)}`));
  }

  const code = encodeChallenge({ ...challenge, score: state.score });
  const shown = el("div", "code-shown", formatCode(code));
  node.append(shown);

  const send = el("button", "big", t("challengeSend"));
  send.dataset.action = "challenge-send";
  send.addEventListener("click", () => {
    void shareResult(
      `${t("challengeMessage").replace("%s", localeNumber(state.score))}\n\n${formatCode(code)}`,
    );
  });
  node.append(send);

  const again = el("button", "big alt", t("again"));
  again.dataset.action = "again";
  again.addEventListener("click", () => startChallenge(challenge));
  node.append(again);

  const back = el("button", "big alt", t("menu"));
  back.dataset.action = "menu";
  back.addEventListener("click", showMenu);
  node.append(back);
}

// --------------------------------------------------------------------- levels

/** The quit/restart corners plus the goal strip, for a level. */
function levelHud(level: Level): { refresh: (state: GameState) => void } {
  const hud = el("div", "hud");

  const quit = el("button", "icon");
  quit.innerHTML = ICON_QUIT;
  quit.dataset.action = "quit";
  quit.setAttribute("aria-label", t("quit"));
  quit.addEventListener("click", showLevels);

  const restart = el("button", "icon");
  restart.innerHTML = ICON_RESTART;
  restart.dataset.action = "restart";
  restart.setAttribute("aria-label", t("restart"));
  restart.addEventListener("click", () => startLevel(level));

  hud.append(quit, restart);
  app.append(hud);

  // The goal, always on screen. A level whose objective you have to remember
  // is a level you are playing blind.
  const strip = el("div", "goal-strip");
  strip.append(el("b", undefined, `${t("levelN")} ${level.number}`));
  const text = el("span", "goal-text", goalText(level));
  const count = el("span", "goal-count");
  strip.append(text, count);
  app.append(strip);

  return {
    refresh(state: GameState) {
      const progress = goalProgress(level.goal, state);
      count.textContent =
        level.goal.kind === "score"
          ? `${localeNumber(progress.done)} / ${localeNumber(progress.target)}`
          : `${progress.done} / ${progress.target}`;
      strip.classList.toggle("met", progress.met);
    },
  };
}

/** How long the winning move is left on screen before the card. */
const WIN_BEAT = 900;

function startLevel(level: Level): void {
  playSound("start", 0, 2);
  stopEverything();
  applyThemeChrome();

  const game = createGame({
    seed: levelSeed(level),
    mode: "level",
    spec: sizeById(level.size).spec,
    pack: level.pack,
    board: levelBoard(level),
    core: levelCore(level),
    rules: { ...level.rules, pieceLimit: level.budget },
  });

  let settled = false;
  const finish = (won: boolean, state: GameState) => {
    if (settled) return;
    settled = true;
    if (won) markLevelDone(level.number);
    window.setTimeout(() => {
      document.querySelector(".goal-strip")?.remove();
      showLevelResult(level, state, won);
    }, won ? WIN_BEAT : 0);
  };

  const hud = levelHud(level);

  screen = new GameScreen(canvas, game, {
    theme,
    haptic,
    onChange: (state) => {
      hud.refresh(state);
      // Won the moment the goal is met, rather than at the end of the budget.
      // Playing on after the objective is done is busywork.
      if (goalProgress(level.goal, state).met) finish(true, state);
    },
    // The engine ends the round when the budget runs out or nothing fits. If
    // the goal is not met by then, that is the loss.
    onGameOver: (state) => finish(goalProgress(level.goal, state).met, state),
  });
  screen.start();
  hud.refresh(game);
}

function showLevelResult(level: Level, state: GameState, won: boolean): void {
  document.querySelector(".hud")?.remove();
  playSound(won ? "bonus" : "gameOver", won ? 2 : 0, 4);

  const node = overlay("result");
  node.append(el("div", "how-title", won ? t("levelDone") : t("levelFailed")));
  node.append(el("div", "score-big", localeNumber(state.score)));

  const progress = goalProgress(level.goal, state);
  node.append(
    el(
      "div",
      "confirm-body",
      `${goalText(level)} — ${
        level.goal.kind === "score" ? localeNumber(progress.done) : progress.done
      } / ${level.goal.kind === "score" ? localeNumber(progress.target) : progress.target}`,
    ),
  );

  const next = won ? levelByNumber(level.number + 1) : null;
  if (next) {
    const go = el("button", "big", t("nextLevel"));
    go.dataset.action = "next-level";
    go.addEventListener("click", () => startLevel(next));
    node.append(go);
  }

  const again = el("button", won ? "big alt" : "big warm", t("retry"));
  again.dataset.action = "retry";
  again.addEventListener("click", () => startLevel(level));
  node.append(again);

  const back = el("button", "big alt", t("levels"));
  back.dataset.action = "level-select";
  back.addEventListener("click", showLevels);
  node.append(back);
}

/** What the shareable picture says. The disc itself carries the rest. */
function shareCardFor(state: GameState, mode: "daily" | "endless", puzzle: number): ShareCard {
  return {
    title: mode === "daily" ? `Shiftle #${puzzle}` : "Shiftle",
    score: localeNumber(state.score),
    stats: [
      [t("rings"), String(state.stats.ringsCleared)],
      [t("stripes"), String(state.stats.stripesFired)],
      [t("bestCombo"), `x${state.stats.bestCombo}`],
    ],
  };
}

function showGameOver(state: GameState, mode: "daily" | "endless"): void {
  document.querySelector(".hud")?.remove();
  if (state.score > readNumber("best", 0)) writeNumber("best", state.score);

  // No-ops unless a Game Center plugin is actually present, so the web build
  // behaves exactly the same.
  void submitScore(mode === "daily" ? LEADERBOARDS.daily : LEADERBOARDS.endless, state.score);

  const result: DailyResult = {
    date: dateKey(new Date()),
    puzzle: dailyPuzzle(new Date()).number,
    score: state.score,
    ringsCleared: state.stats.ringsCleared,
    bestCombo: state.stats.bestCombo,
    spinsLeft: state.spins,
  };
  if (mode === "daily") writeJson("daily", result);

  const node = overlay("result");
  const card = shareCardFor(state, mode, result.puzzle);

  // Show the picture itself rather than a summary of it, so the player can see
  // exactly what they are about to post. Drawing it is the only part of this
  // screen that can fail, and failing here would leave the player staring at
  // the empty overlay we just put up — so it falls back to text instead.
  let preview: string | null = null;
  try {
    preview = renderShareDataUrl(state.board, theme, card);
  } catch (error) {
    console.error("Shiftle: could not draw the share card", error);
  }
  if (preview) {
    const image = el("img", "card-preview");
    image.src = preview;
    image.alt = `${card.title} — ${card.score}`;
    node.append(image);
  } else {
    // Canvas encoding refused; fall back to plain text rather than nothing.
    node.append(el("div", "how-title", card.title));
    node.append(el("div", "score-big", card.score));
  }
  node.append(el("div", "confirm-body", variantLabel(lastVariant.size, lastVariant.pack)));

  // Encoded now, not on the tap. Two reasons: the card has just been drawn for
  // the preview, so doing it twice is waste — and iOS only lets a share sheet
  // open while the tap that asked for it is still live. Waiting on a PNG encode
  // first is exactly how that gets spent.
  let shareImage: Blob | null = null;
  const encoding = renderShareImage(state.board, theme, card)
    .then((blob) => {
      shareImage = blob;
    })
    .catch(() => {
      // Text is still shareable; the picture is a bonus.
    });

  const share = el("button", "big", t("share"));
  share.dataset.action = "share";
  share.addEventListener("click", () => {
    // Ready by now in every realistic case — the player has to read the card
    // first. If it somehow is not, the await costs the picture, not the share.
    if (shareImage) {
      void shareResult(shareLine(result), shareImage);
      return;
    }
    void encoding.then(() => shareResult(shareLine(result), shareImage));
  });
  node.append(share);

  // Straight to the board this score went to. This is the moment a player
  // cares where they placed, so it is the moment to offer it.
  if (gameCenterAvailable()) {
    const board = mode === "daily" ? LEADERBOARDS.daily : LEADERBOARDS.endless;
    const boards = el("button", "big alt", t(mode === "daily" ? "leaderboardDaily" : "leaderboardEndless"));
    boards.dataset.action = "leaderboard";
    boards.addEventListener("click", () => {
      void showLeaderboard(board).then((shown) => {
        if (!shown) notice(t("gameCenter"), t("gameCenterSignedOut"));
      });
    });
    node.append(boards);
  }

  if (mode === "endless") {
    const again = el("button", "big warm", t("again"));
    again.dataset.action = "again";
    again.addEventListener("click", () => startGame("endless", lastVariant));
    node.append(again);
  }

  const back = el("button", "big alt", t("menu"));
  back.addEventListener("click", showMenu);
  node.append(back);
}

// --------------------------------------------------------------------- boot

function onResize(): void {
  screen?.resize();
  menu?.measure();
}

// iOS refuses to start audio outside a user gesture, so take the first one.
app.addEventListener("pointerdown", () => unlockAudio(), { once: true });

window.addEventListener("resize", onResize);
window.addEventListener("orientationchange", onResize);

// A player can sign into Game Center from the Settings app while Shiftle is in
// the background. Re-reading on the way back means the leaderboard works
// without a relaunch.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void refreshGameCenter();
});

// Lets tools/play.mjs drive and inspect a real session in a real browser.
if (import.meta.env.DEV) {
  (window as unknown as { __shiftle: unknown }).__shiftle = {
    state: () => screen?.getState() ?? null,
    start: startGame,
    menu: showMenu,

    /** The level flow, for the browser tests. */
    levels: showLevels,
    level: (number: number) => {
      const level = levelByNumber(number);
      if (!level) return false;
      startLevel(level);
      return true;
    },
    levelProgress: () => {
      const state = screen?.getState();
      const number = Number(document.querySelector(".goal-strip b")?.textContent?.match(/\d+/)?.[0]);
      const level = Number.isFinite(number) ? levelByNumber(number) : null;
      if (!state || !level) return null;
      return { level: level.number, ...goalProgress(level.goal, state) };
    },
    levelCount: () => LEVELS.length,
    levelsDone,
    clearLevels: () => writeJson("levels", []),

    /** Time attack, for the browser tests. */
    timeAttack: () => {
      startTimeAttack();
      return true;
    },
    clock: () => screen?.getClock() ?? null,
    ranOutOfTime: () => screen?.ranOutOfTime() ?? false,
    /** Winds the clock down without waiting for it, so a test can reach zero. */
    burnClock: (seconds: number) => screen?.burnClock(seconds) ?? false,

    /** The challenge flow. */
    challenge: (code?: string) => {
      const found = code ? decodeChallenge(code) : undefined;
      if (code && !found) return false;
      showChallenge(found ?? undefined);
      return true;
    },
    challengeCode: () => document.querySelector(".code-shown")?.textContent ?? null,
    encodeChallenge,
    decodeChallenge,
    /** The score of the round that just finished, read off the result screen. */
    lastScore: () => {
      const shown = document.querySelector(".score-big")?.textContent ?? "";
      const digits = shown.replace(/[^0-9]/g, "");
      return digits ? Number(digits) : null;
    },

    /** The core, for the browser tests. */
    charge: () => screen?.getState()?.charge ?? 0,
    coreReady: () => {
      const state = screen?.getState();
      return state ? coreReady(state.core, state.charge) : false;
    },
    filledCells: () => {
      const state = screen?.getState();
      return state ? filledCount(state.board) : 0;
    },
    /** Taps the middle of the disc, the way a player fires the core. */
    tapCentre: () => screen?.tapCentre() ?? false,

    /** The ramp, for the browser tests. */
    depth: () => {
      const state = screen?.getState();
      return state ? depthOf(state) : 0;
    },
    stoneOnBoard: () => {
      const state = screen?.getState();
      return state ? stoneCount(state.board) : 0;
    },

    /**
     * Stands in for the native Game Center plugin so the leaderboard buttons
     * can be driven in a browser. Without it this whole feature would only
     * ever be exercised on a device, which is to say never until it broke.
     *
     * Records what it was asked to do; tools/play.mjs reads that back.
     */
    fakeGameCenter: () => {
      const calls: Array<{ method: string; options?: unknown }> = [];
      useGameCenterTestDouble({
        signIn: async () => {
          calls.push({ method: "signIn" });
          return { authenticated: true };
        },
        isAuthenticated: async () => ({ authenticated: true }),
        submitScore: async (options: unknown) => {
          calls.push({ method: "submitScore", options });
          return { submitted: true };
        },
        showLeaderboard: async (options: unknown) => {
          calls.push({ method: "showLeaderboard", options });
          return { shown: true };
        },
      } as never);
      (window as unknown as { __gameCenterCalls?: unknown }).__gameCenterCalls = calls;
      return true;
    },

    gameCenterCalls: () =>
      (window as unknown as { __gameCenterCalls?: unknown[] }).__gameCenterCalls ?? [],

    /**
     * Jams the disc so nothing in the tray fits, for testing the stuck and
     * game-over states without playing a whole round to get there.
     *
     * One hole per sector, each in a different ring, so no two holes touch and
     * no ring or spoke is complete. Only a single-cell piece could fit, and the
     * tray is dealt three larger ones.
     */
    jam: (spins = 1) => {
      const current = screen?.getState();
      if (!current || !screen) return null;

      const cells = new Uint8Array(current.board.cells.length).fill(3);
      for (let s = 0; s < current.spec.sectors; s++) {
        cells[(s % current.spec.rings) * current.spec.sectors + s] = 0;
      }

      const board = { spec: current.spec, cells };
      const tray = [
        { pieceId: "brick33", colour: 1 },
        { pieceId: "arc4", colour: 2 },
        { pieceId: "rosette", colour: 4 },
      ];
      const jammed: GameState = {
        ...current,
        board,
        tray,
        spins,
        over: isGameOver(board, tray, spins),
      };
      screen.replaceState(jammed);
      return jammed;
    },

    /**
     * Sets the disc one cell short of a bullseye, with a single-cell piece in
     * the tray, so the burst and the sweep can be captured without playing a
     * whole round to reach one.
     */
    /** Plays one bot move against the live screen, animations and all. */
    botMove: () => {
      const current = screen?.getState();
      if (!current || !screen) return false;
      const move = chooseMove(current);
      if (!move) return false;
      // Through the screen, so effects, particles and sound all run.
      return screen.playMove(move);
    },

    /** Applies an explicit move through the screen, effects and all. */
    play: (move: unknown) => screen?.playMove(move as never) ?? false,

    /** The events from applying a move against the current state, unrendered. */
    peek: (move: unknown) => {
      const current = screen?.getState();
      if (!current) return null;
      const result = applyMove(current, move as never);
      return result ? result.events : null;
    },

    /** Is the animation loop still running? */
    frameAlive: () => screen?.isRunning() ?? false,

    /** Where the header, tray and disc ended up, for the safe-area checks. */
    layout: () => screen?.getLayout() ?? null,

    /** Re-measures, so a test can change the insets and see the effect. */
    remeasure: () => {
      screen?.resize();
      return screen?.getLayout() ?? null;
    },

    /**
     * Sets one spoke a single cell short, with a matching piece in the tray,
     * so a spoke clear can be triggered on demand and repeatedly.
     */
    primeSpoke: (sector = 2) => {
      const current = screen?.getState();
      if (!current || !screen) return null;
      const { rings, sectors } = current.spec;
      const s = ((sector % sectors) + sectors) % sectors;

      const cells = new Uint8Array(current.board.cells.length);
      // Everything but the innermost cell of this spoke, plus a little
      // unrelated clutter so the board is not suspiciously clean.
      for (let r = 1; r < rings; r++) cells[r * sectors + s] = 3;
      for (const [r, c] of [[2, (s + 3) % sectors], [4, (s + 5) % sectors]] as Array<[number, number]>) {
        if (r < rings) cells[r * sectors + c] = 6;
      }

      const primed: GameState = {
        ...current,
        board: { spec: current.spec, cells },
        tray: [{ pieceId: "dot", colour: 3 }, { pieceId: "arc2", colour: 5 }, { pieceId: "brick", colour: 7 }],
      };
      screen.replaceState(primed);
      return { sector: s };
    },

    /** Puts a striped block in the tray so the detonation can be captured. */
    primeStripe: (sector = 2) => {
      const current = screen?.getState();
      if (!current || !screen) return null;
      const { rings, sectors } = current.spec;
      const s = ((sector % sectors) + sectors) % sectors;

      const cells = new Uint8Array(current.board.cells.length);
      // A ring one cell short, plus blocks off it that only a stripe reaches.
      for (let c = 0; c < sectors; c++) if (c !== s) cells[c] = 6;
      for (let r = 2; r < rings; r++) cells[r * sectors + s] = 8;
      for (const [r, c] of [[3, (s + 4) % sectors], [4, (s + 6) % sectors]] as Array<[number, number]>) {
        if (r < rings) cells[r * sectors + c] = 2;
      }

      const primed: GameState = {
        ...current,
        board: { spec: current.spec, cells },
        tray: [{ pieceId: "dot", colour: 6, striped: 0 }, { pieceId: "arc2", colour: 4 }, { pieceId: "brick", colour: 1 }],
      };
      screen.replaceState(primed);
      return { sector: s };
    },

    /** Hands the player pushes, for exercising the spoke gesture. */
    givePush: (n = 1) => {
      const current = screen?.getState();
      if (!current || !screen) return null;
      screen.replaceState({ ...current, pushes: n });
      return n;
    },

    /** Renders the share card for whatever is on the board right now. */
    shareCard: () => {
      const current = screen?.getState();
      if (!current) return null;
      return renderShareDataUrl(current.board, theme, shareCardFor(current, "daily", 142));
    },

    primeBullseye: () => {
      const current = screen?.getState();
      if (!current || !screen) return null;
      const { rings, sectors } = current.spec;
      const hole = { r: 0, s: 3 };

      const cells = new Uint8Array(current.board.cells.length);
      for (let s = 0; s < sectors; s++) {
        if (s !== hole.s) cells[hole.r * sectors + s] = ((s % 8) + 1);
      }
      for (let r = 1; r < rings; r++) cells[r * sectors + hole.s] = ((r % 8) + 1);
      // Some unrelated blocks, so the sweep visibly takes more than two lines.
      for (const [r, s] of [[2, 6], [3, 8], [4, 1], [1, 7], [5, 5]] as Array<[number, number]>) {
        if (r < rings && s < sectors) cells[r * sectors + s] = ((r + s) % 8) + 1;
      }

      const primed: GameState = {
        ...current,
        board: { spec: current.spec, cells },
        tray: [{ pieceId: "dot", colour: 4 }, null, null],
      };
      screen.replaceState(primed);
      return { hole };
    },
  };
}

// Safe on every launch: the system only ever prompts once.
void signIn();

// The menu goes up straight away rather than waiting on a native round trip —
// a blank frame at launch is a worse trade than a menu that corrects itself a
// moment later. It only redraws if something was actually restored.
/**
 * A challenge can arrive in the address bar as #c=CODE. That is how one gets
 * shared on the web build; on the device the code is pasted instead, because a
 * link cannot open the app without a registered domain behind it.
 */
function challengeFromUrl(): Challenge | null {
  const hash = location.hash;
  if (!hash.includes("c=")) return null;
  return decodeChallenge(hash.slice(hash.indexOf("c=") + 2));
}

const invited = challengeFromUrl();
if (invited) showChallenge(invited);
else showMenu();
void hydrate().then((restored) => {
  if (restored && document.querySelector(".overlay.menu")) showMenu();
});
