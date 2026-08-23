/**
 * Swedish and English.
 *
 * The language is picked from the device on first launch and can be changed in
 * the menu. Kept as one flat table rather than a framework — there are a few
 * dozen strings and a puzzle game has no prose.
 */

import { readString, writeString } from "../platform/storage.js";

export type Lang = "sv" | "en";

const TABLE = {
  tagline: {
    sv: "Fyll en cirkel. Snurra en ring om du behöver.",
    en: "Fill a circle. Spin a ring if you need to.",
  },
  daily: { sv: "Dagens pussel", en: "Daily puzzle" },
  dailyDone: { sv: "Dagens klar", en: "Today’s done" },
  endless: { sv: "Spela fritt", en: "Free play" },
  best: { sv: "REKORD", en: "BEST" },
  score: { sv: "POÄNG", en: "SCORE" },
  spins: { sv: "SNURR", en: "SPINS" },
  rings: { sv: "RINGAR", en: "RINGS" },
  spokes: { sv: "EKAR", en: "SPOKES" },
  bestCombo: { sv: "BÄSTA KOMBO", en: "BEST COMBO" },
  combo: { sv: "KOMBO", en: "COMBO" },
  share: { sv: "Dela resultat", en: "Share result" },
  again: { sv: "En gång till", en: "Play again" },
  menu: { sv: "Meny", en: "Menu" },
  gameOver: { sv: "Slut", en: "Game over" },
  left: { sv: "kvar", en: "left" },
  points: { sv: "p", en: "pts" },
  howTitle: { sv: "Så spelar du", en: "How to play" },
  how1: {
    sv: "Dra en bit från brickan ut på skivan.",
    en: "Drag a piece from the tray onto the disc.",
  },
  how2: {
    sv: "Fyll en hel ring eller en hel eke — den poppar.",
    en: "Fill a whole ring or a whole spoke — it pops.",
  },
  how3: {
    sv: "Dra på skivan för att snurra en ring ett steg. Du tjänar snurr genom att rensa.",
    en: "Drag on the disc to spin a ring one step. You earn spins by clearing.",
  },
  gotIt: { sv: "Kör!", en: "Got it!" },
  how: { sv: "Så spelar du", en: "How to play" },
} as const;

export type StringKey = keyof typeof TABLE;

function detect(): Lang {
  const stored = readString("lang");
  if (stored === "sv" || stored === "en") return stored;
  const preferred = navigator.languages ?? [navigator.language];
  // Swedish for Swedish speakers, English for everyone else.
  return preferred.some((tag) => tag.toLowerCase().startsWith("sv")) ? "sv" : "en";
}

let current: Lang = detect();

export function lang(): Lang {
  return current;
}

export function setLang(next: Lang): void {
  current = next;
  writeString("lang", next);
  document.documentElement.lang = next;
}

export function t(key: StringKey): string {
  return TABLE[key][current];
}

document.documentElement.lang = current;
