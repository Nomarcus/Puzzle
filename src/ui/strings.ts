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
  pushes: { sv: "SKJUT", en: "PUSH" },
  rings: { sv: "RINGAR", en: "RINGS" },
  pieces: { sv: "BITAR", en: "PIECES" },
  spokes: { sv: "EKAR", en: "SPOKES" },
  bestCombo: { sv: "BÄSTA KOMBO", en: "BEST COMBO" },
  combo: { sv: "KOMBO", en: "COMBO" },
  share: { sv: "Dela resultat", en: "Share result" },
  again: { sv: "En gång till", en: "Play again" },
  menu: { sv: "Meny", en: "Menu" },
  leaderboard: { sv: "Topplista", en: "Leaderboard" },
  leaderboardDaily: { sv: "Dagens topplista", en: "Today’s leaderboard" },
  leaderboardEndless: { sv: "Topplista fritt spel", en: "Free play leaderboard" },
  gameCenter: { sv: "Game Center", en: "Game Center" },
  gameCenterSignedOut: {
    sv: "Du är inte inloggad i Game Center. Logga in under Inställningar ▸ Game Center, så dyker topplistan upp här.",
    en: "You are not signed in to Game Center. Sign in under Settings ▸ Game Center and the leaderboard will open here.",
  },
  ok: { sv: "Okej", en: "OK" },
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
    sv: "Dra runt på skivan för att snurra en ring. Dra in eller ut för att skjuta en hel eke. Ringar ger snurr, enfärgade rensningar ger skjut.",
    en: "Drag around the disc to spin a ring. Drag in or out to push a whole spoke. Rings buy spins; single-colour clears buy pushes.",
  },
  how4: {
    sv: "Ring och eke i samma drag sopar hela brädet. Det är den stora.",
    en: "A ring and a spoke in the same move sweeps the whole board. That is the big one.",
  },
  how5: {
    sv: "Randiga block rensar tvärs över. Får du med två i samma drag sopas hela skivan.",
    en: "Striped blocks clear the lines that cross them. Two in one move sweeps the whole disc.",
  },
  gotIt: { sv: "Kör!", en: "Got it!" },
  how: { sv: "Så spelar du", en: "How to play" },

  quit: { sv: "Avsluta", en: "Quit" },
  restart: { sv: "Börja om", en: "Restart" },
  quitAsk: { sv: "Avsluta omgången?", en: "Quit this round?" },
  restartAsk: { sv: "Börja om?", en: "Start over?" },
  loseScore: { sv: "Din poäng försvinner.", en: "You will lose your score." },
  usesAttempt: {
    sv: "Dagens försök är förbrukat och räknas med poängen du har nu.",
    en: "This uses up today’s attempt and keeps the score you have now.",
  },
  cancel: { sv: "Fortsätt spela", en: "Keep playing" },
  confirm: { sv: "Ja", en: "Yes" },

  stuckHint: { sv: "Inget passar — snurra en ring", en: "Nothing fits — spin a ring" },
  stuckPush: { sv: "Inget passar — skjut en eke", en: "Nothing fits — push a spoke" },
  stuckOver: { sv: "Inget passar längre", en: "Nothing fits any more" },
  bullseye: { sv: "FULLTRÄFF!", en: "BULLSEYE!" },
  pure: { sv: "ENFÄRGAT!", en: "ALL ONE COLOUR!" },
  stripe: { sv: "RAND!", en: "STRIPE!" },
  doubleStripe: { sv: "DUBBELRAND!", en: "DOUBLE STRIPE!" },
  stripes: { sv: "RANDER", en: "STRIPES" },
  pureClears: { sv: "ENFÄRGADE", en: "PURE" },
  soundOn: { sv: "Ljud på", en: "Sound on" },
  soundOff: { sv: "Ljud av", en: "Sound off" },

  setupTitle: { sv: "Välj skiva", en: "Choose your disc" },
  sizeLabel: { sv: "SKIVA", en: "DISC" },
  packLabel: { sv: "BITAR", en: "PIECES" },
  start: { sv: "Starta", en: "Start" },
  small: { sv: "Liten", en: "Small" },
  standard: { sv: "Standard", en: "Standard" },
  large: { sv: "Stor", en: "Large" },
  mixed: { sv: "Blandat", en: "Mixed" },
  curves: { sv: "Kurvor", en: "Curves" },
  chunks: { sv: "Klumpar", en: "Chunks" },
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
