# Shiftle — iOS handoff

Everything below is ready in this repository. What remains is the part that
needs a Mac, Xcode and an Apple Developer account.

## What Shiftle is

A block puzzle on a round board. You drag arcs, wedges and curved bricks onto a
disc of rings and sectors. A full ring pops, and so does a full spoke. Complete
one of each with the same move and the entire disc is swept — the bullseye.

Two special moves, and they are the same rule stated on the two axes. Drag
around the disc to **spin** a ring one sector; drag in or out to **push** a
spoke one ring. Both wrap, which makes the board a torus and means neither
needs a wrap-around rule explained — a ring has no edge, and a push simply
carries a block off the rim and back in at the hub.

Some pieces carry a **striped block**, marked with a white cross. When a
striped block is caught in a clear it detonates, taking the lines that cross
it, and detonations chain. Two going off in the same move sweep the whole disc.

Spins are common: every ring cleared buys one back. Pushes are the prize, and
the only thing that pays for one is clearing a line in a **single colour**, or
a bullseye. That is what gives the palette a job. Both act as lives: the round
ends only when nothing fits *and* neither power remains.

Four modes on the menu. **Daily** derives its board, piece pack and sequence
from the UTC date so every player in the world gets the identical puzzle,
rationed to 60 pieces, one attempt per day. **Levels** is forty hand-built puzzles in
two sets of twenty, each a fixed board, a fixed goal and a fixed number of
pieces. **Free
play** is the high-score chase; it gets harder the longer it lasts and every
round ends. **Time attack** is the short, stressful one — the clock never stops
and only clearing lines buys seconds back. All four are described below.

## Free play gets harder, and now it ends

Free play used to be literally endless. The bot said so: **0 of 20 rounds
finished** within 4,000 pieces on standard or large *curves*, and 10–15% on
*mixed*. A leaderboard over that ranks patience, not skill — the top score
belongs to whoever sat there longest.

So free play now ramps. Three dials move together as a round goes deeper, and
`npm run ramp` measures them:

1. **The deal gets heavier.** Whatever pack you chose, the weights blend toward
   fat bricks and rosettes, and the single dot — the piece that patches a
   one-cell hole — becomes rare. It never reaches zero; a bag that could not
   fill a gap would make boards unsolvable.
2. **Lives get scarce.** The spin cap falls from three to one and the refill
   costs more clears. Nothing banked is confiscated; the cap only limits the
   next refill.
3. **The rim turns to stone.** Every so often an empty cell on the outermost
   ring with room left becomes a blockage, and the interval shrinks all the way
   to one stone per piece.

**All three are telegraphed.** The depth is on screen, it announces itself when
it changes, and stone lands where you can watch it land. That is the whole
difference between this and the games it is answering: Block Blast gets harder
by quietly handing you pieces that do not fit, which is why losing to it feels
like a swindle. Getting harder is fine; hiding it is not.

### Two things the bot corrected, both of which I had backwards

**The spin price was inert.** Making a spin cost two rings and then three did
nothing at all — the bot's numbers were byte-identical with the dial on and off.
Playing a full round it sat at the three-spin cap for **92% of its turns** and
spent four spins in 359 pieces. You cannot make lives expensive for somebody who
is never short of one. The cap had to come down, not the price.

**Stone was a gift.** As first written it was an ordinary filled cell that took
two clears to break — and the harder the ramp pushed, the *longer* rounds ran.
On a board where the goal is completing lines, anything that counts as filled is
help, and stone lands on the rim, where a completed ring is the biggest prize in
the game. So the rule is now the opposite: **a line containing stone does not
clear.** Stone is a hole that cannot be filled. It kills its ring and its spoke
until it is shifted, and only a striped block detonating across it or the sweep
from a bullseye will do that — which finally gives stripes and the bullseye a
job they did not have. Spins and pushes still move stone like any other cell, so
you can herd it into one spoke and keep the rest of the disc alive.

Neither would have been caught by playing it. Both showed up the moment a bot
played a few hundred rounds.

### The result

| | rounds that end | median length |
|---|---|---|
| before | 0–65% (0% on curves) | never, or thousands of pieces |
| after | **100% on every disc and pack** | 155–224 pieces |

Score spreads stay four- to eightfold between a bad run and a good one, which is
the part that makes the leaderboard worth having: a ramp that killed everybody in
the same place would end rounds without making them a contest. Read those as a
floor — a person plays better than this bot.

Levels and the daily do **not** ramp, and cannot: both are the same puzzle for
everybody, so a ramp reacting to how far you got would make two players' boards
diverge. `createGame` defaults to no ramp; free play is the only caller that
passes one.

## Progression

Every mode ends in a number, and until now that number went into a high score
and nowhere else. A player who has beaten their record has nothing left to be
moving toward, which is the point at which people stop.

So every point ever scored, in any mode, adds to one lifetime total, and the
total unlocks **four new themes** — Lagoon, Sherbet, Bubblegum, Lemonade — at
150k, 500k, 1.5M and 4M. Measured against play: a free-play round is worth
roughly 100,000, so the first is about two rounds and the last about forty.
Someone who only plays the daily gets there eventually too, which is the point
of counting every mode.

Two deliberate constraints:

- **One currency.** Two would need explaining, and a player would have to work
  out which one they were earning.
- **Cosmetic only, always.** Progression that changes how the game plays turns
  a puzzle into a treadmill, and the appeal of this one is that everybody's
  board is the same board. A theme you earned changes nothing about a
  leaderboard and is still worth having.

Locked themes are **shown, not hidden** — dimmed with a padlock and the colour
they will be still visible, because a reward nobody knows about is not a
reward. The first three stay free: a game that opens with one option and a row
of padlocks looks mean, and the first choice a player makes should be a real
one. A bar under the swatches names the next one and how far off it is,
measured from the *previous* unlock rather than from zero — from zero it would
sit near full for the whole last stretch and look broken.

## The daily streak

Levels give a player somewhere to get to and free play gives them a number to
beat. The daily gives them a reason to come back — but only if coming back is
*visible*.

- A **badge on the menu** the moment there is a streak to show, from day one —
  now the first chip in the records row, still carrying its own `streak` class
  and its own pulse.
- On the daily's result screen: the current streak, the longest ever, and a
  **fortnight of squares** with the gaps left in. The gaps are the reason to
  draw it.
- The streak rides along in the **share text**, because that is the part
  somebody else reacts to.

One detail that matters more than it looks: **a streak does not break at
midnight.** It breaks when a whole day goes by unplayed. Somebody who played
yesterday and has not opened the app yet today still has their streak, and the
badge says so and pulses instead of showing a zero that is not true. Showing
the zero is both wrong and the most demoralising possible moment to be wrong.

The arithmetic is in `src/engine/streak.ts`, kept out of the UI so the awkward
cases are tested rather than eyeballed: month boundaries, leap days, and the
alive-but-unplayed state. Days are compared as timestamps, not as strings —
"2026-03-01" follows "2026-02-28" and no amount of string arithmetic knows that.

## The start screen, and why the disc kept losing

The menu is the only screen somebody sees before deciding whether to play, and
for most of the project it was showing the game's face with the game's face
covered up.

The cause was that **two things sized themselves against different rulers**. The
disc sized itself against the window — `height * 0.21` for its radius. The DOM
column sized itself against its own contents, and it kept gaining contents: a
tagline, three full-width buttons, a record line between each of them. Neither
knew about the other, and the column won because it was painted on top.

Measured on a 390×844 iPhone before the fix: the column ran to **681 pixels of
an 844-pixel screen**, and **246 of the disc's 312 pixels were behind buttons**.
Four fifths of the logo, invisible.

The fix is one direction of dependency. The column measures itself and tells the
scene where it starts (`MenuScene.fitAbove`); the scene fits the disc into the
band above that, centred in it, with a margin at each end so the circle never
touches the status bar or the first button. That is self-correcting: a taller
phone gets a bigger logo rather than a bigger gap, and it cannot regress the
next time something is added to the menu — a heavier column simply gets a
smaller disc rather than eating the one behind it.

What made the band big enough to be worth having:

- The tagline went. The title says it and the disc says it better.
- Levels, free play and time attack became **three tiles on one row** instead of
  three full-width buttons.
- The five scattered record lines became **one row of chips** — streak, levels
  cleared, best free-play score, best time attack — which is also the answer to
  "can I see my high score on the front page": all of it, on one line, without
  opening anything.

Each chip is dropped when it is zero, so a fresh install shows nothing there
rather than a row of noughts. That is the difference between a record and a
reminder that you have not got one, and it is why the row is built as
`recordsRow()` returning `null` rather than an empty div: the column is a flex
stack with a gap, and a zero-height child still costs a gap of dead space on the
one install where the screen is emptiest.

The measurement is pinned rather than eyeballed. `MenuScene.discBox()` reports
where the disc actually landed, and `npm run play` asserts against the real
layout in both languages: the circle is fully on screen, none of it is behind
the column, and the radius is still above 120px so the band cannot be satisfied
by shrinking the logo to a token. Swedish is checked separately because it is
the longer language — "Mot klockan" wraps to two lines inside its tile — and it
is the one Marcus reads.

## What depth looks like

The ramp changed the rules every 22 pieces and changed nothing you could see, so
depth 8 looked exactly like depth 0 and a long run felt like a short one that
had gone on a while. Three things now move with the depth. The maths is in
`src/render/depth.ts`, kept out of the draw calls so it is tested rather than
eyeballed.

**The rim of the dish is a counter.** Twelve segments, one per depth, filling
clockwise from the top and walking lemon to orange as they go; past twelve it
fills again in a hotter colour, because depth is unbounded in the engine and the
rim has to say something at depth 30 as well as at depth 3. This is the part you
can *count* — the number in the header says the same thing, but nobody reads a
header. It rides the plate's existing edge, and that is a constraint rather than
a preference: concentric growth rings were the first design and the band outside
the board is `pad * 4`, about six pixels on a phone, so twelve rings landed on
top of each other. The disc is already 0.485 of the content width, so there was
nothing to grow into either.

**The ground deepens into the theme's own hue.** Hue held exactly, saturation
pushed, lightness dropped a little, graded so the bottom deepens more than the
top and the light still reads as coming from above. Every theme intensifies into
itself: Sky to a deep vivid blue, Bubblegum to a deep pink, Mint to a deep
emerald, with no per-theme colour to hand-pick and no way to drift off-brand.

**And the moment lands.** A depth change spread over 22 pieces is a change
nobody notices, so light sweeps across the disc as it arrives and the new
palette settles in behind it. Without this the other two are invisible, which is
why it is not optional polish.

### Three rules, and the two designs that broke on the third

1. **Depth modifies the theme, it never replaces it.** Four of the seven themes
   are earned with lifetime score; if depth overwrote the colours, choosing
   Bubblegum would stop meaning anything.
2. **Block colour is untouched.** A line only pays a spin if every cell shares
   one colour, and the eight hues are spaced by lightness for colour-blind
   players. Nothing here goes near `theme.blocks`.
3. **It cannot drain the colour.** Dark slate, neon, a violet gradient — the
   whole default way of signalling depth is the look the brief rules out.

Rule 3 took three attempts, and the first two looked right in the source and
wrong on the screen:

- **Blending the backdrop toward gold cancels to grey.** Sky's blue and gold are
  near-complementary, so interpolating between them in RGB destroys the
  saturation. By depth 9 the screen was mud.
- **Compositing the gold in `overlay` bleaches instead.** Sky's blue channel is
  already at maximum, so overlay screens it and the whole screen washed out
  toward white.

Blue cannot travel to gold at all: the short way round the wheel passes through
green, which fights the green blocks, and the long way passes through violet.
Holding the hue and pushing the saturation sidesteps it — and is the better idea
anyway, because it needs no shared target colour.

A third thing had to be dialled back rather than redesigned: the pools of light
and the halo were first given depth responses of 0.55 and 0.95 alpha, and five
full-screen washes at those strengths bleach the deepened ground straight back
to the pastel it started as. They are gentle now, and the halo is deepened
alongside the ground it sits on rather than staying at the theme's own colour.

### The blocks harden as you go: candy to diamond

Five tiers, one every three depths — candy, wood, glass, crystal, diamond —
ordered by **hardness** rather than preciousness, which is what let wood in at
all: wood is not more precious than a sweet, but sugar is soft, wood is solid,
glass is harder, crystal harder, diamond hardest. Wooden blocks are *painted*,
never bare timber — bare wood is brown, brown is unsaturated, and an unsaturated
block has started to look like stone.

in `src/render/material.ts`. Candy is what the game has always looked like and
what every mode other than free play still is. Past depth 12 there is nothing
further to become and the rim counter carries the reward on alone.

It is a **finish** ladder, never a colour ladder, and that is forced rather than
chosen: a line only pays a spin if every cell shares one colour, and the eight
hues are spaced by lightness so they stay apart for colour-blind players. So
every tier paints the same `colour.base` underneath and changes only what
happens on top — specular width, edge light, facet cuts, glints.

Three attempts went wrong on screen while looking right in the source, and all
three are the same mistake in different clothes — putting white on a block:

- **The rim light was drawn outside the clip.** Half of every stroke straddled
  the path and landed in the gap between cells, so the board grew a white grid
  and every block read a shade paler than it is. Clipped, only the inner half
  survives and it reads as an edge rather than a border.
- **The facet faces were far too strong.** At `facetDepth 0.46` a wash over half
  a cell does not read as a cut face, it reads as a *second colour* — and on a
  board where a line only pays if every cell matches, a block that looks like
  two is worse than a block with no facets at all. They are at 0.12 and 0.17 now,
  and what says "cut" is the two faces meeting, not the join between them.
- **A crisp white line down each cut read as a scratch**, and enough of them as
  a grid laid over the board.

One trap worth knowing about for anything added here later: **stone must stay
obviously not-a-block.** Stone is the one thing on the disc that is not a sweet
to be cleared, and "hard shiny mineral" is exactly what the top of this ladder
is. What keeps them apart is saturation — a diamond block is a fully saturated
red with facets cut into it and stone has no hue at all — so no tier may drain
the body's colour. Stone deliberately does not follow the ladder.

Together with the rim counter this is where the continuous reward comes from:
five materials times twelve rim segments is sixty visibly different states per
lap, and the rim starts a new lap in a hotter colour each time it fills. A tier
lands every three depths, roughly every 66 pieces.

`npm run materials` renders all five on the real disc. Every tier was tuned by
looking at that output.

### Depth Worlds

Ten worlds, one every **two** depths, then the same ten again on a deeper lap.
`src/render/world.ts` is the **single depth-driven table** in the renderer:
everything asks `worldAt(depth)` and reads what it needs off the answer. There is
deliberately no `if (depth < 10)` anywhere in the drawing code.

| Depth | World | Pattern | Finish → late |
|---|---|---|---|
| 0–1 | Candy | none | candy → glazed |
| 2–3 | Fruit | seeds | glazed → matte |
| 4–5 | Woodland | grain | wood |
| 6–7 | Toy Box | studs | plastic |
| 8–9 | Animal | spots | matte → satin |
| 10–11 | Crystal Cave | facets | crystal → diamond |
| 12–13 | Ocean | bubbles | pearl |
| 14–15 | Space | speckles | glass → crystal |
| 16–17 | Arcade | grid | glow |
| 18–19 | Lava | cracks | matte → molten |

**Two depths per world, not the ten the brief first asked for, and that is a
measurement rather than a preference.** `npx vite-node tools/ramp.ts 24` puts the
median round at 272–347 pieces — depth ~14 — and the browser bot could not be
driven past 15. At a ten-depth span a normal round saw Candy and Fruit and the
other eight worlds were content nobody would ever reach. At two, a median round
travels through **eight** of them and a good one sees all ten. A world lands
roughly every 44 pieces.

`from` is derived from the world's index rather than written down, so the span
and the boundaries cannot drift apart — which is exactly what changing ten to two
would otherwise have done silently.

Past depth 20 the same ten return with a lap trim — a little more sparkle, a
slightly stronger ground, the alternate pattern variant. Pattern *strength*
deliberately does not climb: it is the one dial that would cost legibility.

**Worlds own the finish.** `material.ts` used to be a depth ladder of its own and
the two collided — `materialAt(20)` was already *diamond*, so a wood world at
depth 20 came out as grain plus facets plus sparkle. Three signatures on a cell
sixteen pixels wide is exactly the mush this had to avoid. It is now a vocabulary
of twelve finishes, and the world names the one it wants.

**The rhythm** is a world every two depths and a finish step at the halfway
mark, which at this span is every odd depth — so *something* changes at every
single depth, without a second concept being introduced to do it.

#### The readability rule, made enforceable

A pattern may never change what colour a block reads as. Three mechanisms:

1. **Patterns draw in the block's own light or dark shade**, at bounded alpha.
   Those are the colours the bevel is already made of, so a mark can shift
   lightness a little and hue not at all.
2. **Caps are data, not intentions.** Every pattern is a row in `PATTERNS`
   carrying its ink, alpha and stroke width, and a test checks them. White is
   capped at **0.30** — for scale, the striped marker is white at **0.92** across
   the full width of the cell. No pattern may draw both a full arc and a full
   radial line, because that pair *is* the striped mark.
3. **Measured on the canvas.** `npm run play` samples the drawn board in each
   reachable world and asserts the blocks keep their chroma. Measured: depth 0
   mean chroma **0.861**, depth 10 **0.530** — both far above the 0.25 floor that
   separates a block from the plate.

#### Which worlds a test can actually reach

The two-depth span is what makes the browser suite able to test this at all: it
now checks Candy, Fruit, Toy Box and Ocean by playing to them, sampling the drawn
board in each. `npm run worlds` still draws all ten plus a second lap through the
same renderer at full size, and that contact sheet is how each world was tuned —
the first pass of seeds and studs was invisible on a phone-sized cell and only
showed up there.

The bot's depth varies per deal, so both the dive and the world loop deal again
rather than judging the renderer on one unlucky board.

#### Free play only, structurally

Unchanged and still structural: exactly one `createGame` call passes a ramp, so
the daily, the levels, the challenges and time attack run on `NO_RAMP`, their
depth is zero by construction, and `worldAt(0)` is Candy with no pattern. No mode
string is consulted anywhere.

### The palette half of a world

Marcus's ask, and the one part of the depth ladder that changes the board rather
than the light on it: same disc, same shapes, an entirely new set of eight. In
`src/render/palette.ts`. Four eras, then it cycles — depth is unbounded, so
coming back round to candy after forty reads as a lap rather than as running out.

**A whole-palette swap is safe where shifting one colour is not.** The pure-clear
rule does not care which eight colours are on the board, only that there are
eight and that they can be told apart. Eight moving together keeps every gap;
one moving alone would drift toward a neighbour and two distinct blocks would
start reading as a match.

The eras are **rigid rotations of the shipped eight**, not hand-picked hexes,
and that is a correction rather than a first instinct. Hand-picking was tried:
of four candidate palettes, three came in *worse than what already ships* —
hues crowded to 12.6 degrees against the shipped floor of 17.4, and saturation
fell to 49% against a floor of 78%. A rigid rotation cannot do that, because it
preserves every gap exactly. The bar is enforced in the tests.

**A measurement that corrected our own documentation.** `theme.ts` says the eight
are "spaced by lightness so they stay distinguishable for colour-blind players".
That is only half true: the smallest lightness gap between neighbours in the
shipped palette is **zero** — orange and lemon are both at 50% lightness and are
told apart by hue alone, 17.4 degrees. So lightness spacing could not be used as
the bar, because the palette everybody has played since day one would fail it.
The bar is therefore "no worse than what ships", deliberately a floor rather than
an ideal. If the shipped palette should be improved for colour-blind players
that is a change to all eight at once and its own piece of work, not something to
smuggle in behind a feature about going deeper.

The ground rotates with the era too, capped at 20 degrees — Marcus asked for the
background to keep changing "but not too much", and a theme that turns far enough
stops being the one the player chose and earned.

The swap arrives by **substituting the whole Theme** (`themeForDepth`) rather
than threading a palette through every draw call, because `theme` already reaches
the board, the tray, the particles, the drifters and the share card. One
substitution keeps them in step; a tray still holding the last era's sweets
beside this era's board would be the obvious bug. `GameScreen` therefore keeps
`baseTheme` (what the player chose) separate from `theme` (that, transformed).

### It is free play only, and the gate is structural

Marcus asked for this in free play and explicitly not in time attack. Only one
`createGame` call in the app passes a ramp — the free-play path — so the daily,
the levels, the challenges and time attack all run on `NO_RAMP`, their depth is
structurally zero, and everything above is gated on the depth rather than on a
mode name somebody has to remember to check. `npm run play` drives the real time
attack button and asserts both `piecesPerDepth === 0` and `depth === 0` after a
full round.

### How it was measured

The backdrop is sampled **off the canvas** rather than from the numbers that
produced it — the sheet is baked offscreen and blitted, so reading the source
would prove the maths and not the picture. The metric is **chroma**, not HSL
saturation: HSL saturation is scale-invariant, so a blue washed halfway to white
still reports 100% and the bleaching failure sails straight past it. Measured
between depth 0 and depth 4 on a real round: lightness 75.7% → 72.4%, chroma
0.486 → 0.522, hue 199.4 → 198.5. Deeper, more colourful, same theme.

## Wild blocks

Colour was the thinnest system in the game. It has exactly one job — a line
cleared in a single colour pays a **push** — and with eight colours falling at
random, a pure line was mostly luck. The bot managed **1.0 a round**.

Now a piece occasionally carries a **prism block**, painted as the whole
palette swept across one cell. A line containing one counts as single-colour
whatever else is in it, so the decision is *where to spend it*: hold it for a
line you are about to complete.

It arrives the way a stripe does — one cell of one piece, about every
twenty-five placements — and the two are mutually exclusive, because two
readable marks on a fingernail-sized cell is one too many.

**The first version was inert and the measurement said so.** It only let a wild
*agree* with an already-uniform line, and pure clears went from 1.0 a round to
1.1 — even at ten percent wilds. Five-of-a-colour is about as unlikely as six;
turning an impossible requirement into a slightly less impossible one is not a
mechanic. Letting the wild carry the line outright takes it to **10.9 a round**,
and makes the *frequency* the dial, which is the thing a bot can actually
measure. At ten percent it reaches 25 a round, by which point a pure line has
stopped being an event — hence four.

**No dealt sequence changed.** The wild is drawn off the same roll as the
stripe rather than a new one. A new draw in the stream would have silently
rewritten every daily ever played, because a day's seed is chosen by playing
that day through with the bot.

## The core

The hub in the middle was a hole the rings were drawn around. It is now the
game's battery, and it is the thing the whole board points at.

Every cleared line feeds it — a spoke 1, a ring 3, a single-colour line 2 more,
a striped block 2. At **34** it fills, glows and pulses. **Tap it** and the
whole disc is swept: every block, and every stone the free-play ramp has
crusted the rim with, which is the only reliable answer to a stoned board.

What makes it more than a bomb is *when* you fire it. It pays **per cell it
takes**, so a full core is worth more the longer you hold it, and holding it
means playing on a board you are deliberately letting fill. That is the whole
decision, it needs no explanation, and it is the same decision at every level
of play.

### Two corrections from measurement

**Scoring it as a clear paid it three times a bullseye.** Running a sweep
through `clearScore` counts every ring and every spoke as a simultaneous line,
so a standard disc handed the core a sixteen-line multiplier — 33,660 points
for a move that needs no setup. It now pays per cell swept, which is both fairer
and truer to what the move is.

**A generous core flattened the leaderboard.** At capacity 12 it fired every
forty pieces and free play's score spread collapsed from four- to eightfold down
to **1.5x** — everybody fires roughly the same number of cores, so everybody
scores roughly the same. A mechanic that homogenises outcomes is worse than no
mechanic on a game whose point is a leaderboard.

At capacity 34 it fires about every sixty-five pieces, and the spread comes
back to **3.7x, against 3.6x with no core at all** — so the core costs the
leaderboard nothing while adding the decision. `npm run core` is the tool.

(That figure measured 5.6x when the core shipped and 3.7x once wild blocks
existed. Wilds hand out frequent single-colour clears, which lifts a bad run
more than a good one and so compresses the ratio. The number to watch is the
*comparison* with no core, which has stayed level.)

Rounds are longer with it: free play's bot median went from about 235 pieces to
320. Worth watching, but nothing about the ranking got worse.

## Time attack

The other modes run out of space; this one runs out of time, and it is the most
directly competitive thing in the game. There is nothing in the score but how
fast you can think — no ration to pace yourself against, no ramp to plan
around, and no way to sit and stare at the board.

- **Forty seconds on the clock**, and forty is also the ceiling.
- The clock **speeds up** the longer you last: +15% per 50 seconds survived,
  with no upper limit.
- Clears buy time: a spoke **+1.5 s**, a ring **+4 s**, a bullseye **+8 s**,
  each striped block **+1 s**.
- Always the standard disc and the mixed pack. The other modes let you choose;
  this one cannot, or two scores would not be comparable — and comparing scores
  is the whole point of it.

None of this is in the engine. `applyMove` is a pure function of moves and knows
nothing about wall-clock time, which is what makes replays, the daily's seed
vetting and the balance bot possible — so the clock belongs to the screen. The
arithmetic lives in `src/engine/timeattack.ts` where it can be tested on its
own.

### How the numbers were picked

Five standards of play were modelled — from someone clearing a spoke every eight
seconds to someone doing it every two — against each candidate clock, reading
four numbers off every run: does everyone die, how far apart are the best and
worst, how much of the round is spent under ten seconds, and how many clears
paid nothing.

| | struggling | ok | good | strong | expert |
|---|---|---|---|---|---|
| round lasts | 48 s | 59 s | 80 s | 122 s | 209 s |

A four-and-a-half-fold gap between a beginner and an expert — the widest of
anything tried — and about a quarter of a good player's round spent in the red.
It opened at thirty seconds first, which measured slightly tenser and felt mean
to start on.

Two things that measurement caught, both of which I had wrong first:

**A capped drain is not an ending.** The clock originally stopped speeding up at
2.2× — and at that rate, someone clearing a spoke every second and a ring every
five earns 2.3 seconds per second and *never dies*. The test that plays that
standard ran to its own hour-long ceiling. Exactly the same mistake the free
play ramp made with stone: any dial meant to end a round has to grow without
bound, or it is a plateau rather than an ending.

**A clock that opens higher than it caps ignores the player.** A version that
started at 45 seconds and capped at 25 measured beautifully — most tense of
anything tried — and played terribly, because above the cap a clear is worth
nothing, so the first twenty seconds of every round silently swallowed
everything the player did. A mode whose one mechanic is "clearing buys time"
cannot have a phase where clearing buys no time.

**One more leaderboard is needed in App Store Connect:**
`com.nomarcus.shiftle.time` — Time attack. Same settings as the other two
(integer, high score is best, no decimals, at least one localisation).

## Challenges: the same round, sent to somebody

**Not on the menu.** The button was removed at Marcus's request — the mode
worked, but time attack is the competitive hook now and two of them on one menu
is one too many. Everything below still works and is still tested; a challenge
opens from a `#c=CODE` link, and putting the button back is one line in
`showMenu`.


This is what a deterministic engine is *for*. A whole round — disc, pack,
ration and the exact sequence of pieces — is a seed and three small numbers, so
it fits in a fifteen-character code:

```
7F67S-FS1W1-HSYNF
```

Your friend types or pastes that and plays the round you played, piece for
piece, with your score on screen as the target. **No server, no account, no
network call.** The code also carries the sender's score, so a challenge passed
down a group chat keeps raising its own bar.

Deliberately not a global leaderboard. Being four thousandth on a public board
tells a new player nothing; beating the number a friend just sent them is a
game.

Details worth knowing:

- The deal is **fixed, never adaptive**. Free play's dealer reads the board to
  avoid handing you dead pieces; two players who played differently would get
  different pieces, so a challenge uses the daily's approach instead and vets
  its seed with the bot up front.
- The alphabet is **Crockford base32** — no I, L, O or U — so nothing reads as a
  different character in a text message, and the decoder maps those back anyway.
- The decoder **scans for the code inside whatever it was pasted in**, so
  pasting the whole message works.
- Two check characters. The first attempt used a digit sum and the test that
  feeds it every possible single-character typo caught it **accepting** one that
  decoded to a different score on the same seed — the worst failure this feature
  can have. It now rejects every single-character typo.
- On the web a challenge also opens from `#c=CODE` in the address bar. On the
  device it is pasted: a link cannot open the app without a registered domain
  and an apple-app-site-association file behind it. Worth doing later if Shiftle
  gets a domain.

## The forty levels

Free play and the daily are both the same game with the difficulty left to
chance. Levels are the opposite: a fixed board, a fixed goal and a fixed number
of pieces, the same for everybody, retryable until you get it. That is where a
new player learns what the pieces do, and it is the only part of the game that
can teach one idea at a time.

A level is four things, and every one of them is a lever:

- **the disc** — small (5×8), standard (6×10) or large (7×12);
- **the pack** — curves, chunks or mixed, which decides what you are given;
- **a starting pattern** — blocks already on the board when it opens;
- **a goal and a budget** — what to achieve, and how many pieces you get.

`src/engine/levels.ts` holds all of it. Nothing about it is a special case in
the engine: a level is `createGame()` with a pre-filled board, a seed derived
from the level number, and a piece limit — so levels are as deterministic and as
testable as everything else, and a level plays exactly like free play does.

**Seven goal types**, chosen so they pull in different directions:

| Goal | What it asks for | What it teaches |
|---|---|---|
| `spokes` | Clear *n* spokes | The basic move |
| `rings` | Clear *n* rings | Committing to the long line |
| `score` | Reach *n* points | Efficiency — chains, not singles |
| `stripes` | Set off *n* striped blocks | Aiming a detonation |
| `pure` | *n* single-colour clears | Sorting by colour, and the push economy |
| `combo` | Reach a combo of *n* | Setting up before cashing in |
| `bullseye` | Ring and spoke in one move | The whole game at once |

**Eleven starting patterns**, all generated procedurally from the board's
dimensions rather than stored as grids — `rim`, `hub`, `ringShort` (a ring one
cell short), `quarter`, `spokes`, `speckle`, `checker`, `cross`, `chorus`,
`spiral` and `empty`. That means the same pattern works on any disc size, and a
level is four lines of description rather than a map.

### The curve, and how the targets were set

The targets are not guesses. `npm run levels` plays every level with the bot a
few hundred times and reports the distribution; each target was then set from a
measured percentile. Roughly: **levels 1–4 at the bot's p10** (nearly free —
these teach), **5–12 at its p50** (a real attempt), **13–20 at its p75** (you
will retry).

Bot win rates at 200 runs each:

```
L1–4     97 96 89 95 %        teaching
L5–12    50 60 62  2 63 57 53 55 %    the middle
L13–20    8 30 27  2 38 41  1 25 %    the stretch
```

The three levels sitting at 1–2% are 8, 16 and 19 — the pure-clear and bullseye
goals. They are not broken: the bot's **best** result on each is exactly the
target, so they are reachable, but reaching them takes planning a move or two
ahead and the bot only ever looks one move deep. Those are the levels that
reward a person over a machine, which is the point of having them. `npm run
levels` labels them separately rather than flagging them as too hard.

The tool also watches for the other failure: a run that ends **stuck**, out of
room rather than out of pieces. That is the one loss that teaches nothing, and
it is what re-shaped two levels — the `checker` pattern was originally on every
other sector and strangled half of all runs, and level 20 opens with three spins
in hand for the same reason.

### The second twenty

Levels 1–20 teach the board. Levels 21–40 teach what is built on top of it, and
they are longer and less forgiving.

- **The core** gets four levels, with the capacity lowered to 8–9 so the puzzle
  is the *decision* — hold it or fire it — rather than the grind of charging.
  Free play's core needs 34, which is more than any level's whole budget: asked
  for two firings at full capacity, the bot won 0% of the time. That is not a
  hard level, it is an impossible one.
- **Prism blocks** get three, with the wild rate raised, so a level about
  single-colour clears actually has the tool for it.
- **Stone** appears as a *starting condition* in five. Two cells of the rim,
  never more: stone that arrives gradually is a clock, stone sitting there from
  the first move is far harsher, and at four the bot ended out of room rather
  than out of pieces in 43–65% of runs. Two, plus a raised stripe rate to dig
  with, is a puzzle instead of a wall.

### The bug the level tool was hiding

`npm run levels` nudges the bot onto different seeds, to see whether a level
survives more than one line of play. That is the right question for a *pattern*
and the wrong one for a shipped level, because **a level ships exactly one
deal**. Level 26's real deal died on piece **eight of forty-two** while the tool
reported it playing the full budget.

Two fixes. `levelSeed()` now **vets its seed the way the daily does** — the bot
plays the level through, and a deal it cannot get three-quarters of the way down
is rejected and reseeded, cached per launch. And the tool has a `shipped`
column reporting what the real seed does, so the average can never hide it
again. All forty now play their full budget on the deal players get.

### In the app

The menu's **Levels** button opens a grid of twenty tiles; cleared ones are
marked, and the next one unlocks when the one before it is done. Progress is
stored under `levels.done` and mirrored into Preferences like the high scores.
A goal strip sits above the board while a level is being played and ticks over
when the goal is met. Finishing pops a result screen with **Next level**; a run
that ends short offers **Try again**.

Levels do not touch the leaderboards — they are single-player practice, and the
Game Center boards stay for the daily and free play.

## State of the project

| Area | Status |
|---|---|
| Game engine | Done. Pure, deterministic, 134 unit tests. |
| Levels | Done. Forty of them, difficulty measured with `npm run levels`. |
| Free play ramp | Done. Every round ends on every setup; measured with `npm run ramp`. |
| Time attack | Done. Clock tuned against five modelled standards of play. |
| The core | Done. Charge, tap-to-sweep, tuned with `npm run core`. |
| Wild blocks | Done. Frequency measured against the pure-clear rate. |
| Daily streak | Done. Badge, fortnight strip, and it survives midnight correctly. |
| Progression | Done. Seven themes, four of them earned. Cosmetic only. |
| Challenges | Built and tested, but **not on the menu** — see below. |
| Rendering, input, UI | Done. Swedish and English, seven themes. |
| Depth visuals | Done. Rim counter, deepening ground, arrival sweep, a five-tier material ladder from candy to diamond, and a palette era every ten depths. Free play only; the clock mode is untouched by construction. |
| Start screen | Done. The disc fits the band the column leaves it; records on one row. Pinned by `npm run play` in both languages. |
| iPad | Done. The playable column is capped and centred; the background fills the rest. |
| Balance | Measured with `npm run balance` and `npm run ramp`. |
| iOS project | Generated and committed at `ios/`. |
| App icon and splash | Generated from the game's own renderer. |
| Particles and sound | Done. 8-bit chip synthesis — pulse, triangle and LFSR noise — tuned to a D major pentatonic, with pitch following the disc. `npm run audio` renders every voice to WAV. |
| Game Center | Native plugin written and committed. Needs two leaderboards created in App Store Connect. |
| Share image | Done. The final disc renders to a 1080px card. |

## Key facts

- **Bundle ID**: `com.nomarcus.shiftle`
- **Display name**: Shiftle
- **Xcode project**: `ios/App/App.xcodeproj`
- **Orientation**: portrait only
- **Capacitor 8** — dependencies come from **Swift Package Manager**, so there
  is **no `Podfile` and no `pod install`**. Xcode resolves packages on open.
- **No network access of our own.** The whole game is bundled; there is no
  server, no analytics and no account system. The one thing that leaves the
  device is a Game Center score, and that goes through GameKit to Apple.
- `ITSAppUsesNonExemptEncryption` is already set to `false`, so TestFlight
  will not ask about export compliance on each upload.

## Build steps

```bash
git clone https://github.com/Nomarcus/Puzzle.git
cd Puzzle
git checkout claude/simple-puzzle-game-iphone-ho2201
npm ci
npm run ios:sync      # vite build + cap sync ios
npx cap open ios      # or: open ios/App/App.xcodeproj
```

`npm run ios:sync` is not optional. Capacitor's own `ios/.gitignore` excludes
`ios/App/App/public/`, which is where the compiled web bundle lands, so a fresh
clone has an empty one and the app would launch to a blank screen. Run it after
cloning and again whenever the web source changes. (The Codemagic workflow
already does both steps, so CI builds are unaffected.)

In Xcode, on the **App** target:

1. **Signing & Capabilities** → set your Team; let Xcode manage signing.
2. Set **Marketing Version** and **Build** (currently `1.0` / `1`).
3. Select **Any iOS Device (arm64)** → **Product ▸ Archive** → **Distribute App**
   → **App Store Connect** → **Upload**.

## Sharing

The result screen previews a 1080x1080 card built from the player's final
disc, and the share button hands that PNG to the system share sheet through the
Web Share API. WKWebView has supported sharing files that way since iOS 15, so
no Filesystem plugin is needed. If the sheet refuses the image the code falls
back to sharing text, then to the clipboard.

## The sound, and what the music has to fit

Everything is synthesised as if by a 1985 console: two pulse channels, a
triangle for the bass, and a noise channel. No audio files. `npm run audio`
renders every voice to WAV in `tools/out/audio/` so it can be judged without a
build.

Square waves alone do not make something sound 8-bit. Four things do, and the
chip in `src/platform/audio.ts` does all four:

- **Stepped volume.** Sixteen levels, changed once a frame, never gliding. Any
  exponential fade reads as modern immediately.
- **Duty cycles.** The pulses are built as PeriodicWaves from the Fourier
  series of a pulse train, so 12.5% and 25% are available — WebAudio's built-in
  "square" is only the 50% one, which is the least characteristic of the four.
- **Arpeggios, not chords.** Two pulse channels cannot play a triad, so the
  voices flicker between the notes at 60 Hz and let the ear fuse them. That
  flutter is the genre's signature more than any waveform.
- **LFSR noise.** A 15-bit shift register, as the NES does it, including the
  short mode where it closes after 93 steps and comes out metallic and nearly
  pitched. That is where the lasers come from.

There is no reverb, because a chip had none. What it had was an echo faked in
the tracker, so the send bus is a short feedback delay instead.

Two things matter for writing music against it:

- **The scale is D major pentatonic** — D, E, F#, A, B, with D4 at 293.66 Hz.
  Everything the game plays is quantised to it. A pentatonic has no semitone in
  it, so nothing the player does can produce a clash, and anything written in D
  will sit on top of it.
- **Pitch comes from the board.** The inner ring is the smallest circle so it
  rings highest, the outer ring lowest; spokes walk round the dial one scale
  degree per sector. A combo walks up the scale, so a run of clears is a
  melody. This is why the game sounds like itself: the disc is the keyboard,
  and a square-grid game cannot do it.

The bonus moments — a stripe, a single-colour clear, the bullseye — all get the
same **signature**: the power-up. A pulse climbing the whole scale in
frame-length steps, then the chord arpeggiating over a bass that bends upward.
It is sized by how big the moment was, and sits about 8 dB above anything else
the game plays, which is deliberate.

Pressing play has its own fanfare, and game over walks back down the scale.

## One native detail worth knowing: the silent switch

The game synthesises its sound with WebAudio. In a WKWebView that respects the
iOS silent switch by default, so a player with the ringer off hears nothing —
which is usually correct, but arcade games normally opt out.

To make sound play regardless, set the audio session category to `.playback`
in `AppDelegate.swift`:

```swift
import AVFoundation
// in application(_:didFinishLaunchingWithOptions:)
try? AVAudioSession.sharedInstance().setCategory(.playback, options: [.mixWithOthers])
try? AVAudioSession.sharedInstance().setActive(true)
```

`.mixWithOthers` keeps the player's music going instead of stopping it. This is
a judgement call, not a bug — leave it out and the silent switch silences the
game, which many people prefer. There is a sound toggle in the menu either way.

## Two bugs worth knowing about, because both were invisible

Game Center did not work in build 12, and not only the buttons: **nothing**
worked, including the automatic sign-in and the score submission. Both failed
without an error, a warning or a log line. Two separate causes, both now fixed.

**1. Nothing imported `@capacitor/core`.** Every platform module reached for
`window.Capacitor.Plugins.X` directly and read `undefined` as "we must be in a
browser". That is wrong on a device: the bridge iOS injects fills
`Capacitor.PluginHeaders`, listing what is available natively, and never fills
`Capacitor.Plugins` — only a JS-side `registerPlugin()` call does that, and with
the core runtime never imported, that call never happened. So on iOS every
plugin looked absent. Haptics never fired once, on any build. Sharing survived
only because it tries the Web Share API before the plugin. Storage was fine; it
uses `localStorage` directly.

`src/platform/native.ts` now owns the core import and registers plugins
properly.

**2. Capacitor never registered `GameConnectPlugin`.** It was written on the
assumption that Capacitor finds plugins by scanning the Objective-C runtime. It
does not. `CapacitorBridge.registerPlugins()` registers exactly what
`capacitor.config.json` lists in `packageClassList`, and `cap sync` generates
that list from the npm packages in `package.json`. A plugin living in the app
target is in no package, so it appeared nowhere and was never loaded — no
plugin header injected, and the JS side correctly reported Game Center as
unavailable.

The fix is the documented one for app-local plugins:
`ios/App/App/MainViewController.swift` subclasses `CAPBridgeViewController`,
overrides `capacitorDidLoad()` and calls
`bridge?.registerPluginInstance(GameConnectPlugin())`. `Main.storyboard` points
at that class instead of `CAPBridgeViewController`.

**Both are now checked.** `npm run ios:sync` ends with `tools/verify-ios.mjs`,
which reads the Xcode project, the storyboard, the platform sources and the
generated config, and fails if:

- a plugin the web side registers has no native implementation, from either an
  npm package or the app target — the general form of bug 2, now covering
  Haptics, Share and Preferences as well as GameConnect;
- an app-local plugin is registered by nothing;
- the storyboard does not load the class that does the registering;
- a Swift file is missing from the Sources build phase;
- the entitlements are not wired to both build configurations.

None of it needs Xcode. `npm run play` separately pins that the Capacitor
runtime is loaded at all, and that the safe-area insets reach the canvas
layout.

Neither bug could be caught by playing the game in a browser, which is why they
survived two builds.

### Two more of the same shape, found while looking

- **Safe-area insets.** The canvas layout read `--safe-top` off `:root` and
  parsed it. Whether `env()` inside a custom property is substituted at that
  point is engine-dependent; Chromium resolves it, and a literal `env(...)`
  string would parse to `NaN` and quietly become zero — putting the score under
  the Dynamic Island. It now measures a real element through `var()`, which the
  cascade resolves everywhere, and `npm run play` drives a fake notch to prove
  the layout moves by exactly the inset.
- **The share sheet.** The share button encoded a 1080px PNG and *then* called
  `navigator.share()`. iOS only opens a share sheet while the tap that asked for
  it is still live, and waiting on an encode is a good way to spend that. The
  card is now encoded when the result screen appears — which it was doing
  anyway for the preview — so the tap shares a blob that is already in hand.
- **High scores.** `localStorage` in a WKWebView is website data: the system
  may clear it under pressure and it does not reliably survive a restore. Every
  write is now mirrored into Capacitor Preferences (NSUserDefaults), and a
  `hydrate()` at launch puts back anything that has gone missing. Reads stay
  synchronous; the durable store is the backup, never the fast path.

## Game Center

Everything on this side is done and committed. There is **no plugin to install**
— the native half is written into the app itself at
`ios/App/App/GameConnect.swift`, about a hundred lines of GameKit exposed to
the web layer as a Capacitor plugin. It is registered with the bridge by
`MainViewController.capacitorDidLoad()`, which is the step Capacitor needs for
a plugin that does not come from an npm package.

What is already in the repository:

- `ios/App/App/GameConnect.swift` — sign-in, score submission and the Game
  Center overlay.
- `ios/App/App/MainViewController.swift` — registers the plugin with the
  bridge. Without it Capacitor never loads the plugin at all; see above.
- `ios/App/App/App.entitlements` — the `com.apple.developer.game-center`
  entitlement, with `CODE_SIGN_ENTITLEMENTS` already set on both the Debug and
  Release configurations of the App target.
- `src/platform/gamecenter.ts` — the web side. Resolves the plugin off the
  global at runtime and no-ops when it is absent, which is why the browser
  build still runs.
- A leaderboard icon in the top-right corner of the menu, and a full button on
  the result screen pointing at the board that round's score went to. Both only
  appear when the native plugin is really present, so nothing on the web shows
  a button that cannot work — which also means **you will not see them in the
  browser test page, only on a device.**
- A signed-out player who taps either one gets told to sign in under
  Settings ▸ Game Center, rather than a tap that does nothing.

**What still needs a human, in App Store Connect:**

1. Create three leaderboards with exactly these IDs:
   - `com.nomarcus.shiftle.daily` — Today's puzzle
   - `com.nomarcus.shiftle.endless` — Free play
   - `com.nomarcus.shiftle.time` — Time attack
   All three: integer score format, high score is best, no decimals.
2. Add at least one localisation per leaderboard (English works; Swedish too if
   you want it) — App Store Connect will not accept a leaderboard without one.

**In Xcode:** the entitlement file is already wired, so opening
**Signing & Capabilities** should show Game Center already on. If it does not,
add it there — Xcode will then match the entitlement that is already committed.
The capability also has to exist on the App ID in the Developer portal; Xcode's
automatic signing normally does that for you the first time you archive.

Until the leaderboards exist in App Store Connect, submissions fail silently
and the overlay opens empty. Nothing else in the game is affected, so a first
TestFlight build works fine without them.

### Testing it

The plugin is exercised in the browser through a stand-in, so this is not
untested code: `npm run play` installs a fake `GameConnect`, clicks the
leaderboard buttons, and asserts that a finished round submits the round's real
score to the right board. On a device, sign-in happens at launch and the
overlay opens from either leaderboard button.

## App Store Connect answers

- **Category**: Games ▸ Puzzle
- **Age rating**: 4+
- **App Privacy**: nothing is collected by us — no analytics, no accounts, no
  backend. Worth a moment on the questionnaire though: the app submits scores
  to Game Center, so it does hand gameplay data to Apple, tied to the player's
  Game Center identity. We never receive or store any of it. Most puzzle games
  in this position either declare nothing or declare "Gameplay Content ▸ App
  Functionality"; declaring it is the safer of the two and costs nothing.
- **Third-party content**: none. All art is generated by the app's own code.

## Where things live

```
src/engine/     pure game rules — no DOM, no Math.random, fully testable
src/render/     canvas drawing: the disc, the candy bevel, the tray
src/input/      the two gestures (drag to place, drag on the disc to spin)
src/ui/         screens, menus, the animation loop
src/platform/   storage, haptics, share, Game Center — all no-op on the web
tools/          bot, balance sweeps, browser tests, icon generation
                `npm run balance` sweeps every disc and pack; `npm run endless`
                asks whether a round ever ends at all; `npm run ramp` measures
                the difficulty ramp; `npm run levels` the forty levels;
                `npm run materials` renders the five block materials
ios/            the Xcode project
```

`npm test` runs the engine tests, `npm run play` drives the real game in a
headless browser at iPhone size and writes screenshots to `tools/out/`.
