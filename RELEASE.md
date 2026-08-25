# Shiftle — release notes

Paste the relevant section into TestFlight's **What to Test**. Newest first.

---

## 1.0 (18)

Two things now change as free play goes deeper: the blocks get harder, and every
ten depths the whole palette swaps.

### What to test

**Every ten depths, all eight colours change at once.** Same board, same shapes,
same rules, an entirely new set of sweets — and the background moves with them,
a little. There are four palettes and then it cycles back round.

**Can you still tell the eight apart in every palette?** This is the thing to
report. A line only pays a spin if every cell matches, so if two colours ever
start looking like each other in one of the new palettes, that is the bug that
matters most.

**Wood is the new second tier**, at depth 3. The ladder is now candy → wood →
glass → crystal → diamond, ordered by hardness. Wooden blocks are painted, not
bare timber — the colour stays, the grain is what changes.

**And check the other modes are still untouched.** Time attack, the daily and
the levels stay plain candy in the palette you picked, however long you play.

### Fixed since build 17

- Nothing. This build only adds the above.

---

## 1.0 (17)

The blocks themselves now change as free play goes deeper. Still nothing about
how it plays.

### What to test

**Play free play a long way and watch the blocks.** Every three depths they
change material: candy → glazed → glass → crystal → diamond. Candy is what you
have always seen; diamond has cut faces, a bright edge and glints on some
blocks. Depth 12 is the last one.

**Can you still tell the colours apart?** This is the thing to report. Every
tier paints the same colour underneath and only changes the shine, because a
line only pays a spin if every cell matches. If a crystal or diamond block ever
looks like two colours, or two different colours start looking the same, that is
a bug and an important one.

**Can you still tell stone apart from a diamond block?** Stone stays plain grey
on purpose and does not follow the ladder. At depth 12 there is a lot of shine
on the board — check the threat still reads as a threat.

**And check the other modes are untouched.** Time attack, the daily and the
levels should all still be plain candy however long you play.

### Fixed since build 16

- Nothing. This build only adds the above.

---

## 1.0 (16)

Free play now looks like it is getting deeper. Nothing about how it plays has
changed — the ramp is the same ramp.

### What to test

**Play free play for a while and watch the screen, not the board.** Every 22
pieces the round goes a depth deeper, and now three things happen: light sweeps
across the disc as it lands, the background settles into a richer version of
whatever theme you chose, and one more segment lights up around the rim of the
dish.

**The rim is a counter.** Twelve segments, one per depth, filling clockwise from
the top. You should be able to see how deep you are without reading the number
in the header. Past twelve it fills again in a hotter colour.

**Check it still looks like your theme.** Sky should still be blue and
Bubblegum should still be pink at depth 9 — deeper and richer, never greyer and
never darker. If any theme looks washed out or muddy at depth, that is the bug
to report.

**And check the clock mode is untouched.** Time attack has no depth and should
look exactly as it did in build 15 — no rim segments, no colour change. Same for
the daily and the levels.

### Fixed since build 15

- Nothing. This build only adds the above.

---

## 1.0 (15)

A start screen build. The menu itself, nothing about how the game plays.

### What to test

**The start screen.** The disc is the game's face and four fifths of it was
behind the buttons — 246 of its 312 pixels, measured on an iPhone 14. The
column now measures itself and the disc takes the space above it, so the whole
circle is visible on any phone. Does it look like the front of a game?

**Your records, on the front page.** Streak, levels cleared, best free-play
score and best time attack score now sit on one line under the mode buttons,
instead of being scattered between them. A fresh install shows none of them
rather than a row of zeros.

**The three other modes are tiles now**, side by side, rather than three
full-width buttons. Check they are still easy to hit with a thumb — "Mot
klockan" wraps to two lines in Swedish and is the tightest one.

### Fixed since build 14

- The start screen showed most of the disc behind the buttons on every phone.

---

## 1.0 (14)

The biggest build so far. Two new modes, twice as many levels, a new mechanic in
the middle of the board, and a reason to come back tomorrow.

### What to test

**The core (new).** The hole in the middle now fills as you clear lines. When it
glows, **tap it** — the whole disc is swept, stone included. It pays for what it
takes, so holding it while the board fills is worth more. Does it feel worth
saving, or do you just fire it the moment it lights up?

**Time attack (new mode).** Forty seconds, and the clock never stops. Only
clearing buys seconds back, and it drains faster the longer you last. Rounds
should run about a minute for a first go and two or three minutes when you get
good. Too stressful? Not stressful enough?

**Free play now ends.** It used to run forever. Stone creeps in from the rim as
you go deeper, the pieces get heavier, and spins get scarce. The depth is shown
in the header and announces itself — you should never be surprised. A line with
stone in it will not clear; only a stripe or a bullseye shifts one.

**Prism blocks (new).** Occasionally a piece carries a rainbow block. Any line
containing one counts as single-colour, which pays a push. Worth planning
around?

**Forty levels.** 21–40 are new and use the core, prisms and stone. Are any of
them impossible, or dull?

**Daily streaks.** Play the daily on consecutive days — a flame badge appears on
the menu, and the result screen shows a fortnight of squares. Playing yesterday
and not yet today should keep the streak and pulse the badge, not zero it.

**Earned themes.** Four new palettes unlock on lifetime score, at 150k / 500k /
1.5M / 4M. Locked ones show a padlock and a progress bar names the next one.

### Fixed since build 13

- Tapping a **locked theme** raised a notice that wiped the menu underneath it,
  so dismissing it left an empty screen with no way back but force-quitting.
  Notices now sit on top of what they cover. The same bug stranded you on four
  other screens, including the one that fires when you unlock a theme.
- The **Menu button** at the bottom of the level list was squashed flat by the
  scroll.

### Known and deliberate

- Free play rounds are longer than before (the core rescues boards). If it drags,
  say so — the ramp is one number.
- Three levels (16, 36, 39) need planning ahead and are meant to take retries.
- The **Time attack leaderboard needs creating** in App Store Connect as
  `com.nomarcus.shiftle.time` before scores will post.

---

## 1.0 (12) and earlier

Daily puzzle, free play, twenty levels, Game Center, sharing, 8-bit sound.
