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
  levels: { sv: "Banor", en: "Levels" },
  levelN: { sv: "Bana", en: "Level" },
  locked: { sv: "Låst", en: "Locked" },
  levelDone: { sv: "Klarad!", en: "Complete!" },
  levelFailed: { sv: "Inte den här gången", en: "Not this time" },
  nextLevel: { sv: "Nästa bana", en: "Next level" },
  retry: { sv: "Försök igen", en: "Try again" },
  allLevelsDone: {
    sv: "Alla banor klarade. Spela fritt för rekordet.",
    en: "Every level cleared. Free play is where the record lives.",
  },
  goal: { sv: "MÅL", en: "GOAL" },
  goalScore: { sv: "Nå %n poäng", en: "Reach %n points" },
  goalRings: { sv: "Rensa %n ringar", en: "Clear %n rings" },
  goalSpokes: { sv: "Rensa %n ekar", en: "Clear %n spokes" },
  goalPure: { sv: "Gör %n enfärgade rensningar", en: "Make %n single-colour clears" },
  goalStripes: { sv: "Utlös %n randiga block", en: "Set off %n striped blocks" },
  goalBullseye: { sv: "Landa en fullträff", en: "Land a bullseye" },
  goalCombo: { sv: "Nå kombo x%n", en: "Reach a combo of %n" },
  depth: { sv: "DJUP", en: "DEPTH" },
  challenge: { sv: "Utmaning", en: "Challenge" },
  challengeBlurb: {
    sv: "Samma skiva, samma bitar, samma antal drag. Skicka koden till en kompis och se vem som får ut mest.",
    en: "Same disc, same pieces, same number of moves. Send the code to a friend and see who gets more out of it.",
  },
  challengeNew: { sv: "Starta en utmaning", en: "Start a challenge" },
  challengePlay: { sv: "Anta utmaningen", en: "Take it on" },
  challengePaste: { sv: "Klistra in en kod", en: "Paste a code" },
  challengeTake: { sv: "Öppna koden", en: "Open code" },
  challengeBad: { sv: "Ingen giltig kod där.", en: "No valid code in that." },
  challengeBeat: { sv: "att slå", en: "to beat" },
  challengeTarget: { sv: "Du skulle slå", en: "You were chasing" },
  challengeWon: { sv: "Du slog den!", en: "You beat it!" },
  challengeLost: { sv: "Inte riktigt", en: "Not quite" },
  challengeSend: { sv: "Skicka vidare", en: "Pass it on" },
  challengeMessage: {
    sv: "Jag fick %s i Shiftle. Samma skiva, samma bitar — slå det:",
    en: "I got %s in Shiftle. Same disc, same pieces — beat it:",
  },
  depthHint: {
    sv: "Ju djupare du kommer, desto tyngre bitar, dyrare snurr och mer sten på kanten.",
    en: "The deeper you get, the heavier the pieces, the dearer the spins, and the more stone on the rim.",
  },
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
  how6: {
    sv: "I fritt spel växer sten in från kanten ju djupare du kommer. En rad med sten i rensas inte — bara en rand eller en fullträff tar bort den. Snurr och skjut flyttar den.",
    en: "In free play, stone creeps in from the rim the deeper you get. A line with stone in it will not clear — only a stripe or a bullseye removes it. Spins and pushes move it.",
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
