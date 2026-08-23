/**
 * App shell: menu, mode selection, theme choice, game over.
 *
 * The canvas owns the game itself; everything here is DOM, because menus are
 * text and buttons and there is no reason to hand-draw those.
 */

import { type GameState, createGame } from "./engine/game.js";
import { dailyNumber, dailySeed, dateKey, hashSeed } from "./engine/rng.js";
import { THEMES } from "./render/theme.js";
import { GameScreen } from "./ui/game-screen.js";
import { haptic } from "./platform/haptics.js";
import { readJson, readNumber, readString, writeJson, writeNumber, writeString } from "./platform/storage.js";

interface DailyResult {
  readonly date: string;
  readonly puzzle: number;
  readonly score: number;
  readonly ringsCleared: number;
  readonly bestCombo: number;
  readonly spinsLeft: number;
}

const canvas = document.querySelector<HTMLCanvasElement>("#board")!;
const app = document.querySelector<HTMLDivElement>("#app")!;

let theme = THEMES.find((t) => t.id === readString("theme")) ?? THEMES[0]!;
let screen: GameScreen | null = null;

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

function overlay(): HTMLDivElement {
  document.querySelectorAll(".overlay").forEach((node) => node.remove());
  const node = el("div", "overlay");
  app.append(node);
  return node;
}

function applyThemeChrome(): void {
  document.body.style.background = theme.backdrop[1];
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme.backdrop[0]);
}

function todayResult(): DailyResult | null {
  const stored = readJson<DailyResult | null>("daily", null);
  return stored && stored.date === dateKey(new Date()) ? stored : null;
}

/** The shareable line. The mandala image is generated separately. */
export function shareLine(result: DailyResult): string {
  return `Shiftle #${result.puzzle} · ${result.score.toLocaleString("sv-SE")} p · ⟳${result.spinsLeft} kvar`;
}

// --------------------------------------------------------------------- menu

function showMenu(): void {
  screen?.destroy();
  screen = null;
  applyThemeChrome();

  const node = overlay();
  node.append(el("div", "title", "Shiftle"));
  node.append(el("div", "tagline", "Fyll en cirkel. Snurra en ring om du behöver."));

  const done = todayResult();
  const daily = el("button", "big", done ? `Dagens klar · ${done.score} p` : "Dagens pussel");
  daily.disabled = done !== null;
  daily.addEventListener("click", () => startGame("daily"));
  node.append(daily);

  const endless = el("button", "big alt", "Spela fritt");
  endless.addEventListener("click", () => startGame("endless"));
  node.append(endless);

  const best = readNumber("best", 0);
  if (best > 0) {
    const stats = el("div", "stats");
    const stat = el("div", "stat");
    stat.append(el("b", undefined, best.toLocaleString("sv-SE")), el("span", undefined, "REKORD"));
    stats.append(stat);
    node.append(stats);
  }

  const swatches = el("div", "swatches");
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
    swatches.append(swatch);
  }
  node.append(swatches);
}

// --------------------------------------------------------------------- game

function startGame(mode: "daily" | "endless"): void {
  document.querySelectorAll(".overlay").forEach((n) => n.remove());
  applyThemeChrome();

  const seed = mode === "daily" ? dailySeed(new Date()) : hashSeed(`endless:${Date.now()}`);
  const state = createGame({ seed, mode });

  screen?.destroy();
  screen = new GameScreen(canvas, state, {
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

  const node = overlay();
  node.append(el("div", "title", mode === "daily" ? `#${result.puzzle}` : "Slut"));
  node.append(el("div", "score-big", state.score.toLocaleString("sv-SE")));

  const stats = el("div", "stats");
  const entries: Array<[string, string]> = [
    ["RINGAR", String(state.stats.ringsCleared)],
    ["EKAR", String(state.stats.spokesCleared)],
    ["BÄSTA KOMBO", `x${state.stats.bestCombo}`],
  ];
  for (const [label, value] of entries) {
    const stat = el("div", "stat");
    stat.append(el("b", undefined, value), el("span", undefined, label));
    stats.append(stat);
  }
  node.append(stats);

  if (mode === "daily") {
    const share = el("button", "big", "Dela resultat");
    share.addEventListener("click", () => {
      void navigator.share?.({ text: shareLine(result) }).catch(() => {});
    });
    node.append(share);
  } else {
    const again = el("button", "big", "En gång till");
    again.addEventListener("click", () => startGame("endless"));
    node.append(again);
  }

  const back = el("button", "big alt", "Meny");
  back.addEventListener("click", showMenu);
  node.append(back);
}

// --------------------------------------------------------------------- boot

window.addEventListener("resize", () => screen?.resize());
window.addEventListener("orientationchange", () => screen?.resize());

// Lets tools/play.mjs drive and inspect a real session in a real browser.
// Dev-only, so it never ships in the App Store build.
if (import.meta.env.DEV) {
  (window as unknown as { __shiftle: unknown }).__shiftle = {
    state: () => screen?.getState() ?? null,
    start: startGame,
    menu: showMenu,
  };
}

showMenu();
