/**
 * App shell: menu, mode selection, theme and language, game over.
 *
 * The canvas owns both the game and the animated menu backdrop; everything
 * here is DOM, because menus are text and buttons and there is no reason to
 * hand-draw those.
 */

import { type GameState, createGame } from "./engine/game.js";
import { dailyNumber, dailySeed, dateKey, hashSeed } from "./engine/rng.js";
import { THEMES } from "./render/theme.js";
import { GameScreen } from "./ui/game-screen.js";
import { MenuScene } from "./ui/menu-scene.js";
import { type Lang, lang, setLang, t } from "./ui/strings.js";
import { haptic } from "./platform/haptics.js";
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

/** One sweet per letter, matching the block palette. */
const TITLE_COLOURS = ["#FF2D42", "#FF7A00", "#FFC400", "#4FD31A", "#00CFC9", "#0A7CFF", "#A03CF0"];

const canvas = document.querySelector<HTMLCanvasElement>("#board")!;
const app = document.querySelector<HTMLDivElement>("#app")!;

let theme = THEMES.find((option) => option.id === readString("theme")) ?? THEMES[0]!;
let screen: GameScreen | null = null;
let menu: MenuScene | null = null;

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

function stopEverything(): void {
  screen?.destroy();
  screen = null;
  menu?.stop();
  menu = null;
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

  const endless = el("button", "big alt", t("endless"));
  endless.dataset.action = "endless";
  endless.addEventListener("click", () => startGame("endless"));
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
  const help = el("button", "pill wide", t("how"));
  help.addEventListener("click", showHowTo);
  langs.append(help);
  node.append(langs);
}

function showHowTo(): void {
  const node = overlay("result");
  node.append(el("div", "how-title", t("howTitle")));

  const steps = el("div", "how");
  ([["1", t("how1")], ["2", t("how2")], ["3", t("how3")]] as Array<[string, string]>).forEach(
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

function startGame(mode: "daily" | "endless"): void {
  document.querySelectorAll(".overlay").forEach((node) => node.remove());
  stopEverything();
  applyThemeChrome();

  const seed = mode === "daily" ? dailySeed(new Date()) : hashSeed(`endless:${Date.now()}`);
  screen = new GameScreen(canvas, createGame({ seed, mode }), {
    theme,
    haptic,
    onGameOver: (final) => showGameOver(final, mode),
  });
  screen.start();
}

function showGameOver(state: GameState, mode: "daily" | "endless"): void {
  if (state.score > readNumber("best", 0)) writeNumber("best", state.score);

  const result: DailyResult = {
    date: dateKey(new Date()),
    puzzle: dailyNumber(new Date()),
    score: state.score,
    ringsCleared: state.stats.ringsCleared,
    bestCombo: state.stats.bestCombo,
    spinsLeft: state.spins,
  };
  if (mode === "daily") writeJson("daily", result);

  const node = overlay("result");
  node.append(el("div", "how-title", mode === "daily" ? `#${result.puzzle}` : t("gameOver")));
  node.append(el("div", "score-big", localeNumber(state.score)));

  const stats = el("div", "stats");
  const entries: Array<[string, string]> = [
    [t("rings"), String(state.stats.ringsCleared)],
    [t("spokes"), String(state.stats.spokesCleared)],
    [t("bestCombo"), `x${state.stats.bestCombo}`],
  ];
  for (const [label, value] of entries) {
    const stat = el("div", "stat");
    stat.append(el("b", undefined, value), el("span", undefined, label));
    stats.append(stat);
  }
  node.append(stats);

  if (mode === "daily") {
    const share = el("button", "big", t("share"));
    share.addEventListener("click", () => {
      void navigator.share?.({ text: shareLine(result) }).catch(() => {});
    });
    node.append(share);
  } else {
    const again = el("button", "big", t("again"));
    again.addEventListener("click", () => startGame("endless"));
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

window.addEventListener("resize", onResize);
window.addEventListener("orientationchange", onResize);

// Lets tools/play.mjs drive and inspect a real session in a real browser.
if (import.meta.env.DEV) {
  (window as unknown as { __shiftle: unknown }).__shiftle = {
    state: () => screen?.getState() ?? null,
    start: startGame,
    menu: showMenu,
  };
}

showMenu();
