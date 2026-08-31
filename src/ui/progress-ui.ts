/**
 * The screens that tell a player what they are playing toward.
 *
 * Three things live here: the progression strip on the menu, the lines the
 * result screen shows after a round, and the World Passport.
 *
 * They are kept out of `main.ts` because they share a set of rules that are
 * easy to break one screen at a time:
 *
 * - **One currency.** Everything measured here is the lifetime total the game
 *   has always had. Nothing invents a second score, and the mastery bonus is
 *   labelled as progress so it can never be mistaken for a leaderboard point.
 * - **At most one primary and one secondary goal.** A menu that lists six
 *   things to chase is a menu with nothing to chase.
 * - **Never a fabricated near-miss.** A distance to a record is only shown when
 *   there is a record and the round genuinely came close to it. A first-ever
 *   score is not "nearly a record" — there was nothing to be near.
 * - **Nothing is only a colour or only an icon.** Every reward is words and a
 *   number as well, because sound and haptics can be off and a pattern is not a
 *   label.
 */

import { el } from "./dom.js";
import { t } from "./strings.js";
import {
  UNLOCKS,
  nextUnlock,
  unlockProgress,
} from "../engine/progress.js";
import { type ModeId, type Beaten, type Save, isDiscovered, recordsFor } from "../engine/save.js";
import { type Goal, RECORD_LABELS, goalById } from "../engine/mastery.js";
import { WORLDS, type DepthWorld } from "../render/world.js";

/** Group digits the way the rest of the app does. */
type NumberFormat = (value: number) => string;

export interface ProgressCopy {
  readonly localeNumber: NumberFormat;
  readonly themeLabel: (id: string) => string;
}

/**
 * The strip under the menu buttons: where you are, and the one next thing.
 *
 * Two lines at most. The bar is the primary goal — the next theme — and the
 * line under it is the secondary, which is whatever the player is closest to in
 * the mode they last played.
 */
export function progressStrip(
  lifetime: number,
  copy: ProgressCopy,
  secondary: string | null,
): HTMLDivElement {
  const box = el("div", "progress-strip");
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", t("progress"));

  const next = nextUnlock(lifetime);
  const head = el("div", "progress-head");

  if (next) {
    const remaining = Math.max(0, next.at - lifetime);
    const label = t("toUnlock")
      .replace("%n", copy.localeNumber(remaining))
      .replace("%s", copy.themeLabel(next.theme));
    head.append(el("span", "progress-goal", label));
  } else {
    head.append(el("span", "progress-goal", t("allUnlocked")));
  }
  box.append(head);

  const bar = el("div", "progress-bar");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  const pct = Math.round(unlockProgress(lifetime) * 100);
  bar.setAttribute("aria-valuenow", String(pct));
  const fill = el("i");
  fill.style.width = `${pct}%`;
  bar.append(fill);
  box.append(bar);

  if (secondary) {
    box.append(el("div", "progress-second", secondary));
  }
  return box;
}

/**
 * The single most useful thing to aim at next, in the mode last played.
 *
 * Returns null rather than inventing something. A player with no records yet is
 * better served by nothing here than by a target pulled out of the air.
 */
export function secondaryGoal(
  save: Save,
  mode: ModeId | null,
  copy: ProgressCopy,
): string | null {
  const goal = goalById(save.mastery.activeId);
  if (goal) {
    return `${t("masteryGoal")}: ${goalText(goal)} · ${save.mastery.progress}/${goal.target}`;
  }

  // No chosen goal, so fall back to the nearest undiscovered world — the thing
  // every free-play round is moving toward whether or not the player has
  // thought about it.
  //
  // Only once they have actually seen one, though. On a fresh save nothing is
  // discovered, so the first miss is Candy, which is depth zero and the very
  // first thing anybody sees. "Next world: Candy" is true and useless, and a
  // pointer at something you are already standing on is worse than none.
  const seenAny = WORLDS.some((w) => isDiscovered(save, w.id));
  const missing = seenAny ? WORLDS.find((w) => !isDiscovered(save, w.id)) : undefined;
  if (missing) return `${t("nextWorldUp")}: ${missing.label}`;

  if (mode) {
    const records = recordsFor(save, mode);
    if (records.score > 0) return `${t("recScore")}: ${copy.localeNumber(records.score)}`;
  }
  return null;
}

export function goalText(goal: Goal): string {
  const text = t(goal.text as Parameters<typeof t>[0]).replace("%n", String(goal.target));
  // World goals carry no number worth showing (the target is always "you got
  // there once") — their id names the world instead, and the world's own
  // label is the one place that name lives, so it is looked up here rather
  // than duplicated onto the goal itself.
  if (!goal.id.startsWith("world-")) return text;
  const world = WORLDS.find((w) => w.id === goal.id.slice(6));
  return text.replace("%s", world?.label ?? "");
}

// ------------------------------------------------------------- result lines

export interface RoundOutcome {
  readonly beaten: readonly Beaten[];
  /** Worlds discovered for the first time in this round. */
  readonly discovered: readonly string[];
  /** Lifetime before and after, so the strip can animate between them. */
  readonly lifetimeBefore: number;
  readonly lifetimeAfter: number;
  readonly mastery: { goal: Goal | null; progress: number; target: number; completed: boolean };
  /** How far the round fell short of the mode's score record, if it did. */
  readonly shortOfRecord: number | null;
}

/**
 * At most three lines, ranked.
 *
 * The cap is the point. A wall of badges is the thing that makes a result screen
 * feel like a slot machine, and the brief rules it out — so this picks the three
 * that actually mattered and drops the rest on the floor.
 */
export function resultLines(outcome: RoundOutcome, copy: ProgressCopy): string[] {
  const lines: string[] = [];

  for (const world of outcome.discovered) {
    const found = WORLDS.find((w) => w.id === world);
    if (found) lines.push(t("worldFound").replace("%s", found.label));
  }

  for (const beat of outcome.beaten) {
    const label = t(RECORD_LABELS[beat.kind] as Parameters<typeof t>[0]);
    lines.push(`${t("newRecord")} · ${label}: ${copy.localeNumber(beat.from)} → ${copy.localeNumber(beat.to)}`);
  }

  const { goal, progress, target, completed } = outcome.mastery;
  if (goal) {
    lines.push(
      completed
        ? `${t("masteryDone")} ${goalText(goal)}`
        : `${t("masteryGoal")}: ${progress}/${target}`,
    );
  }

  // Only a real near-miss, and only when there is a record to be near. The
  // threshold is deliberately tight: "600 points off" is encouraging, "48,000
  // points off" is a fabricated milestone dressed as one.
  if (lines.length < 3 && outcome.shortOfRecord !== null && outcome.shortOfRecord > 0) {
    lines.push(t("toRecord").replace("%n", copy.localeNumber(outcome.shortOfRecord)));
  }

  return lines.slice(0, 3);
}

/** How close a round came to the record, or null when it is not worth saying. */
export function shortOfRecord(score: number, record: number): number | null {
  if (record <= 0 || score >= record) return null;
  const gap = record - score;
  // Within a fifth of the record counts as close. Further than that and the
  // number is discouraging rather than motivating, so it is simply not shown.
  return gap <= record * 0.2 ? gap : null;
}

// --------------------------------------------------------- the World Passport

/**
 * Ten cards, one per world, in the order they are met.
 *
 * An undiscovered world shows its name and a blank swatch rather than being
 * hidden entirely. Hiding it would leave a player with no idea there is
 * anything after where they got to; showing the name and withholding the look
 * is what makes the next one worth reaching.
 */
export function passportGrid(save: Save, copy: ProgressCopy): HTMLDivElement {
  const grid = el("div", "passport");
  const found = WORLDS.filter((w) => isDiscovered(save, w.id)).length;

  const count = el("div", "passport-count");
  count.textContent = t("worldsFound")
    .replace("%n", copy.localeNumber(found))
    .replace("%m", copy.localeNumber(WORLDS.length));
  grid.append(count);

  const cards = el("div", "passport-grid");
  for (const world of WORLDS) {
    cards.append(passportCard(world, save, copy));
  }
  grid.append(cards);
  return grid;
}

function passportCard(world: DepthWorld, save: Save, copy: ProgressCopy): HTMLDivElement {
  const known = isDiscovered(save, world.id);
  const card = el("div", `passport-card${known ? "" : " locked"}`);

  const swatch = el("canvas", "passport-swatch");
  swatch.width = 132;
  swatch.height = 132;
  swatch.dataset.world = world.id;
  swatch.dataset.known = known ? "1" : "0";
  card.append(swatch);

  card.append(el("div", "passport-name", world.label));

  const detail = el("div", "passport-detail");
  if (known) {
    const best = save.worlds[world.id]?.bestDepth ?? 0;
    detail.textContent = `${t("bestDepthIn")} ${copy.localeNumber(best)}`;
  } else {
    detail.textContent = t("undiscovered");
  }
  card.append(detail);

  // The state is in the text as well as the styling, so a screen reader and a
  // player who cannot tell the two card treatments apart both get it.
  card.setAttribute("aria-label", `${world.label} — ${detail.textContent}`);
  return card;
}

/** Every theme id an unlock names, for the menu's label lookup. */
export const UNLOCK_IDS = UNLOCKS.map((u) => u.theme);
