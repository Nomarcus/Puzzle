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

Four modes. **Levels** is twenty hand-built puzzles, each a fixed board, a fixed
goal and a fixed number of pieces. **Free play** is the high-score chase; it
gets harder the longer it lasts and every round ends. **Daily** derives its
board, piece pack and sequence from the UTC date so every player in the world
gets the identical puzzle, rationed to 60 pieces, one attempt per day.
**Challenge** hands somebody else the exact round you just played, as a short
code. All four are described below.

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

## Challenges: the same round, sent to somebody

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

## The twenty levels

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
| Game engine | Done. Pure, deterministic, 94 unit tests. |
| Levels | Done. Twenty of them, difficulty measured with `npm run levels`. |
| Free play ramp | Done. Every round ends on every setup; measured with `npm run ramp`. |
| Challenges | Done. Fifteen-character codes, no backend. |
| Rendering, input, UI | Done. Swedish and English, three themes. |
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

1. Create two leaderboards with exactly these IDs:
   - `com.nomarcus.shiftle.daily` — Today's puzzle
   - `com.nomarcus.shiftle.endless` — Free play
   Both: integer score format, high score is best, no decimals.
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
                the difficulty ramp; `npm run levels` the twenty levels
ios/            the Xcode project
```

`npm test` runs the engine tests, `npm run play` drives the real game in a
headless browser at iPhone size and writes screenshots to `tools/out/`.
