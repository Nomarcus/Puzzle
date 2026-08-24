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

Two modes. **Free play** runs indefinitely — it is a high-score chase, not a
puzzle with an ending. **Daily** derives its board, piece pack and sequence from
the UTC date so every player in the world gets the identical puzzle, and it is
rationed to 60 pieces so every attempt is the same length as well as the same
puzzle. One attempt per day.

### One thing worth deciding before the endless leaderboard goes live

"Runs indefinitely" turns out to be literal. With the bot playing properly,
`npm run endless` says free play essentially never ends on the default packs:
0 of 12 rounds finished within 6,000 placements on standard or large *curves*,
and 1 or 2 of 12 on *mixed*. Only *chunks* reliably kills you (12 of 12 on
small and standard, median about 770 and 1,700 pieces).

So the three packs are not difficulty settings, they are three different games:
chunks has an ending, curves does not, mixed is nearly endless. That is fine for
a relaxing mode, but it means the **endless leaderboard ranks patience rather
than skill** — the top score belongs to whoever sat there longest.

The daily is unaffected: it is rationed to 60 pieces, so it already measures
points per piece, which is skill. If the endless board should measure skill too,
the usual fix is a difficulty ramp — the deal gets meaner the longer a round
lasts, so every run ends eventually without an arbitrary cap. That is a rules
change and has not been made; it is Marcus's call.

## State of the project

| Area | Status |
|---|---|
| Game engine | Done. Pure, deterministic, 68 unit tests. |
| Rendering, input, UI | Done. Swedish and English, three themes. |
| iPad | Done. The playable column is capped and centred; the background fills the rest. |
| Balance | Measured with `npm run balance`. Free play does not reliably end — see below. |
| iOS project | Generated and committed at `ios/`. |
| App icon and splash | Generated from the game's own renderer. |
| Particles and sound | Done. Sound is one synthesised instrument, tuned to a D major pentatonic; pitch follows the disc. `npm run audio` renders every voice to WAV. |
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

The whole palette is one made-up instrument — somewhere between a kalimba, a
handpan and a glass bowl — built from struck partials rather than oscillators,
so it reads as something being hit rather than switched on. There are no audio
files; it is all synthesis, and `npm run audio` renders every voice to WAV in
`tools/out/audio/` so it can be judged without a build.

The bonus banners are **spoken** — BULLSEYE, FULLTRÄFF, ALL ONE COLOUR — by a
synthesised voice rather than a recording. A vowel is three resonances, so
parking bandpass filters at the right frequencies over a buzzing source gives
something the ear reads as speech with no audio file, no licensing and no
second language to record. It reads the banner string itself rather than a
per-word table, so text added later is spoken without anybody authoring
anything — but it always speaks the **English** wording, whatever the menu is
set to. Arcade voices are English everywhere, and the banner on screen still
reads in the player's language. It is not real speech and is not trying
to be — closer to how a cartoon animal talks — but the syllables, the vowel
colours and the rhythm all come from the real word.

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
                asks whether a round ever ends at all
ios/            the Xcode project
```

`npm test` runs the engine tests, `npm run play` drives the real game in a
headless browser at iPhone size and writes screenshots to `tools/out/`.
