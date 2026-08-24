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
| Particles and sound | Done. Sound is synthesised, no audio files. |
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

## Game Center

Everything on this side is done and committed. There is **no plugin to install**
— the native half is written into the app itself at
`ios/App/App/GameConnect.swift`, about a hundred lines of GameKit exposed to
the web layer as a Capacitor plugin. Capacitor discovers it through the
Objective-C runtime, so there is no registration step either.

What is already in the repository:

- `ios/App/App/GameConnect.swift` — sign-in, score submission and the Game
  Center overlay.
- `ios/App/App/App.entitlements` — the `com.apple.developer.game-center`
  entitlement, with `CODE_SIGN_ENTITLEMENTS` already set on both the Debug and
  Release configurations of the App target.
- `src/platform/gamecenter.ts` — the web side. Resolves the plugin off the
  global at runtime and no-ops when it is absent, which is why the browser
  build still runs.
- Leaderboard buttons in the menu and on the result screen. They only appear
  when the native plugin is actually present, so nothing on the web shows a
  button that cannot work.

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
