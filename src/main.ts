/**
 * App shell: menu, mode selection, theme and language, game over.
 *
 * The canvas owns both the game and the animated menu backdrop; everything
 * here is DOM, because menus are text and buttons and there is no reason to
 * hand-draw those.
 */

import { type GameState, createGame, isGameOver } from "./engine/game.js";
import { chooseMove } from "./engine/bot.js";
import { dateKey, hashSeed } from "./engine/rng.js";
import { dailyPuzzle } from "./engine/daily.js";
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
import { type Lang, type StringKey, lang, setLang, t } from "./ui/strings.js";
import { haptic } from "./platform/haptics.js";
import { isMuted, setMuted, unlock as unlockAudio } from "./platform/audio.js";
import { shareResult } from "./platform/share.js";
import { type ShareCard, renderShareDataUrl, renderShareImage } from "./render/share-card.js";
import { LEADERBOARDS, signIn, submitScore } from "./platform/gamecenter.js";
import {
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

function stopEverything(): void {
  screen?.destroy();
  screen = null;
  menu?.stop();
  menu = null;
  document.querySelector(".hud")?.remove();
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
function gameHud(mode: "daily" | "endless"): void {
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
    const state = screen?.getState();
    if (!state || state.score === 0) return startGame(mode, lastVariant);
    confirmThen(t("restartAsk"), mode === "daily" ? t("usesAttempt") : t("loseScore"), () => {
      if (mode === "daily") {
        bankDaily(state);
        showMenu();
        return;
      }
      startGame(mode, lastVariant);
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

  const endless = el("button", "big alt", t("endless"));
  endless.dataset.action = "endless";
  endless.addEventListener("click", showSetup);
  node.append(endless);

  const best = readNumber("best", 0);
  if (best > 0) node.append(el("div", "best", `${t("best")} ${localeNumber(best)}`));

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
  document.querySelectorAll(".overlay").forEach((node) => node.remove());
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
    // Free play has no ending; the daily is rationed so every attempt is the
    // same length as well as the same puzzle.
    rules: puzzle ? { pieceLimit: puzzle.pieceLimit } : undefined,
  });
  screen = new GameScreen(canvas, game, {
    theme,
    haptic,
    onGameOver: (final) => showGameOver(final, mode),
  });
  screen.start();
  gameHud(mode);
}

/** What the shareable picture says. The disc itself carries the rest. */
function shareCardFor(state: GameState, mode: "daily" | "endless", puzzle: number): ShareCard {
  return {
    title: mode === "daily" ? `Shiftle #${puzzle}` : "Shiftle",
    score: localeNumber(state.score),
    stats: [
      [t("rings"), String(state.stats.ringsCleared)],
      [t("pureClears"), String(state.stats.pureClears)],
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
  // exactly what they are about to post.
  const preview = renderShareDataUrl(state.board, theme, card);
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

  const share = el("button", "big", t("share"));
  share.dataset.action = "share";
  share.addEventListener("click", () => {
    void renderShareImage(state.board, theme, card).then((image) =>
      shareResult(shareLine(result), image),
    );
  });
  node.append(share);

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

// Lets tools/play.mjs drive and inspect a real session in a real browser.
if (import.meta.env.DEV) {
  (window as unknown as { __shiftle: unknown }).__shiftle = {
    state: () => screen?.getState() ?? null,
    start: startGame,
    menu: showMenu,

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

    /** Is the animation loop still running? */
    frameAlive: () => screen?.isRunning() ?? false,

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

showMenu();
