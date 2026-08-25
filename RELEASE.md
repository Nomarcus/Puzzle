# Shiftle — release notes

Paste the relevant section into TestFlight's **What to Test**. Newest first.

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
