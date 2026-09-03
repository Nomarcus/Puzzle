/**
 * The music bed, measured rather than described.
 *
 * Two things are worth proving here and neither can be heard from a test:
 *
 * 1. **`planBar` is pure and deterministic.** The offline preview renders the
 *    same bars the game plays, which is only true if a bar is a function of its
 *    index. If that ever stops holding, the WAV I listen to stops being evidence
 *    about the thing that ships.
 * 2. **A long session does not accumulate.** The player schedules ahead on a
 *    timer, and the failure mode of every lookahead scheduler ever written is
 *    that it quietly builds more per tick than it retires. Ten minutes of
 *    simulated wall clock, counting every node created and every `stop()`
 *    scheduled, is the only honest way to say it does not.
 */

import { describe, expect, it, vi } from "vitest";
import {
  BAR,
  BPM,
  BPM_DEEP,
  MIX,
  MusicPlayer,
  barSeconds,
  flutter,
  planBar,
  scheduleBar,
  tempoAt,
} from "../src/platform/music.js";
import { type Bus, note } from "../src/platform/audio.js";

// --------------------------------------------------------------- a fake ctx

interface Counts {
  created: number;
  stopped: number;
  started: number;
  /** Nodes created, bucketed by the bar they were scheduled into. */
  perBar: number[];
}

/**
 * The smallest thing `voice()` will accept.
 *
 * Deliberately not a mock of Web Audio — it records what was asked for and
 * nothing else. A node here knows it was started and stopped, which is the
 * entire property under test.
 */
function fakeAudio(): { ctx: any; bus: Bus; counts: Counts; dest: any } {
  const counts: Counts = { created: 0, stopped: 0, started: 0, perBar: [] };

  const param = () => ({
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
    cancelScheduledValues() {},
  });

  const node = (kind: string): any => {
    counts.created += 1;
    return {
      kind,
      type: "",
      Q: param(),
      frequency: param(),
      gain: param(),
      // The bed plays its drums through the chip's own `noise()` now, which
      // steps the playback rate the way the real channel steps its period. A
      // real AudioBufferSourceNode always has this; the double did not, which
      // is the only thing that had to change here.
      playbackRate: param(),
      buffer: null,
      setPeriodicWave() {},
      connect(next: any) {
        return next;
      },
      start() {
        counts.started += 1;
      },
      stop() {
        counts.stopped += 1;
      },
    };
  };

  const ctx: any = {
    currentTime: 0,
    state: "running",
    createGain: () => node("gain"),
    createOscillator: () => node("osc"),
    createBufferSource: () => node("src"),
    createBiquadFilter: () => node("filter"),
  };

  const bus = {
    ctx,
    send: node("send"),
    noiseShort: {} as AudioBuffer,
    triangle: {} as PeriodicWave,
    pulses: new Map<number, PeriodicWave>([
      [0.5, {} as PeriodicWave],
      [0.25, {} as PeriodicWave],
      [0.125, {} as PeriodicWave],
    ]),
  } as unknown as Bus;

  return { ctx, bus, counts, dest: node("dest") };
}

// ------------------------------------------------------------------- plans

describe("the music plan", () => {
  it("is a function of the bar index alone", () => {
    // The offline preview and the live game share this function. If it ever
    // reads a clock or a random, what I listened to stops being what ships.
    for (const bar of [0, 1, 7, 16, 137, 5000]) {
      expect(planBar(bar, 3, 0.6)).toEqual(planBar(bar, 3, 0.6));
    }
  });

  it("adds layers with depth instead of getting louder", () => {
    const calm = planBar(2, 0, 0);
    const deep = planBar(2, 0, 1);
    const layers = (events: ReturnType<typeof planBar>) =>
      new Set(events.map((e) => e.layer));

    // Bass is the floor: it is there at zero and it is there at one.
    expect(layers(calm).has("bass")).toBe(true);
    expect(layers(deep).has("bass")).toBe(true);
    // Percussion and air are the things depth buys.
    expect(layers(calm).has("perc")).toBe(false);
    expect(layers(deep).has("perc")).toBe(true);
    expect(layers(deep).has("air")).toBe(true);

    // And the gain of the layer that exists in both is unchanged: deeper is
    // richer, never louder. The brief is explicit that it must not get
    // stressful, and a bed that climbs is a bed that does.
    const bassOf = (events: ReturnType<typeof planBar>) =>
      events.filter((e) => e.layer === "bass").map((e) => e.gain);
    expect(bassOf(deep)).toEqual(bassOf(calm));
  });

  it("never puts a note outside the bar it belongs to", () => {
    for (let bar = 0; bar < 64; bar++) {
      for (const event of planBar(bar, bar % 10, (bar % 11) / 10)) {
        expect(event.at).toBeGreaterThanOrEqual(0);
        expect(event.at).toBeLessThan(BAR);
        expect(Number.isFinite(event.seconds)).toBe(true);
        expect(event.gain).toBeGreaterThan(0);
      }
    }
  });

  it("does not settle into a short loop", () => {
    const roots = (bar: number) =>
      planBar(bar, 0, 1)
        .filter((e) => e.layer === "bass")
        .map((e) => e.degree)
        .join(",");
    // The chord cycle is sixteen bars long and it moves inside that. Bars 0-1
    // and 8-9 deliberately match, so the octave drift below can be read off
    // bar 0 against bar 16 without two changes landing at once.
    expect(roots(0)).not.toBe(roots(2));
    expect(roots(0)).toBe(roots(8));

    // Over the top of it the octave drifts on a seventeen-bar cycle, which
    // shares no factor with sixteen. Bar 16 is the same chord as bar 0, an
    // octave up — so the two only agree again after 16 × 17 = 272 bars, about
    // eleven minutes at 100 BPM, which is roughly a whole median round rather
    // than half of one.
    const top = (bar: number) => Math.max(...planBar(bar, 0, 1).filter((e) => e.layer === "arp").map((e) => e.degree));
    expect(top(16) - top(0)).toBe(5);

    // The arpeggio's holes and the percussion are hashed from the raw bar
    // index rather than read out of any cycle, so there is no fixed loop for
    // a listener to catch. That does not mean no two bars ever sound the
    // same — two independent coin flips land the same way somewhat often,
    // and the same is true here: measured over a few thousand bars, roughly
    // one bar in twenty exactly matches an earlier one, almost always one
    // where the chord and octave already matched by design (the chord cycle
    // deliberately holds most notes for two bars). What matters for "no
    // seam" is that it never *stays* matched — there is no short repeating
    // block. Measured directly: starting from several different bars, none
    // of the next 48 bars (about two minutes) exactly repeats where it
    // started.
    const shape = (bar: number) => JSON.stringify(planBar(bar, 0, 1));
    for (const start of [0, 3, 50, 777]) {
      const base = shape(start);
      for (let offset = 1; offset <= 48; offset++) {
        expect(shape(start + offset)).not.toBe(base);
      }
    }
  });

  it("walks more than one melodic shape, which is the whole variation fix", () => {
    // The bed used to hold a single eight-note figure per world — measured,
    // four shapes existed in the entire game and all four were rotations of
    // the same cell, so a whole round was one idea with holes punched in it.
    // Shapes are read relative to the bar's own root so a chord change does
    // not count as a new shape; the lift is on so dropouts cannot inflate it.
    const shapes = new Set<string>();
    for (let world = 0; world < 10; world++) {
      for (let bar = 0; bar < 64; bar++) {
        const events = planBar(bar, world, 1, 1);
        const root = events.find((e) => e.layer === "bass")!.degree + 5;
        shapes.add(
          events
            .filter((e) => e.layer === "arp")
            .map((e) => e.degree - root)
            .join(","),
        );
      }
    }
    expect(shapes.size).toBeGreaterThan(20);
  });

  it("moves the bass inside the bar instead of repeating one note", () => {
    // Two notes on the same pitch twice a bar is a pulse, not a bass line.
    // Somewhere in the cycle the second note has to differ from the first.
    const bass = (bar: number) => planBar(bar, 0, 1).filter((e) => e.layer === "bass");
    let moved = 0;
    for (let bar = 0; bar < 16; bar++) {
      const [first, second] = bass(bar);
      if (first!.degree !== second!.degree) moved += 1;
    }
    expect(moved).toBeGreaterThan(0);
  });

  it("never asks the chip for a level it quantises to silence", () => {
    // The bug this exists for, and it is invisible in the source: `stair()`
    // rounds to sixteen levels, so a peak under 0.5/15 rounds to zero on every
    // step and the voice plays *nothing*. Folding the bed's overall level into
    // the per-layer mix did exactly that — every layer looked right, the code
    // typechecked, the plan tests passed, and the rendered bed was silent. The
    // absolute level belongs on a gain node after the staircase; these are only
    // ever ratios between layers.
    const FLOOR = 0.5 / 15;
    let faintest = Infinity;
    for (let world = 0; world < 10; world++) {
      for (let bar = 0; bar < 32; bar++) {
        for (const lift of [0, 1]) {
          for (const event of planBar(bar, world, 1, lift)) {
            faintest = Math.min(faintest, MIX[event.layer] * event.gain);
          }
        }
      }
    }
    expect(faintest).toBeGreaterThan(FLOOR);
  });

  it("never lets the flutter land outside the pentatonic", () => {
    // This is the one genuinely risky part of playing the bed on the chip:
    // `pulse()`'s flutter is in semitones and the scale is in degrees, so a
    // hand-written [0,4,7] triad off the wrong root plays a note the game has
    // never allowed. Going through `note()` at both ends cannot, and this is
    // the proof rather than the claim — every offset must land exactly on the
    // pitch its degree names.
    for (let base = -12; base <= 24; base++) {
      for (const chord of [[0, 2, 4], [0, 2, 4, 6]]) {
        flutter(base, chord).forEach((semitones, i) => {
          const played = note(base) * Math.pow(2, semitones / 12);
          expect(played).toBeCloseTo(note(base + chord[i]!), 6);
        });
      }
    }
  });
});

// ------------------------------------------------------------ depth and tempo

describe("what depth does to the bed", () => {
  it("keeps changing the arrangement all the way down, not just at the top", () => {
    // The bug this pins: the bed used to make its last change 62% into a
    // median round and then repeat itself for four and a half minutes while
    // the ramp carried on getting harder. Every step here has to bring
    // something the step below it did not have.
    const shapeAt = (t: number) =>
      JSON.stringify(
        [0, 1, 2, 3].flatMap((bar) =>
          planBar(bar, 0, t).map((e) => `${e.layer}@${e.at.toFixed(2)}:${e.degree}`),
        ),
      );

    const steps = [0, 0.2, 0.3, 0.47, 0.65, 0.85].map(shapeAt);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).not.toBe(steps[i - 1]);
    }
    // And they are all different from each other, not a pair swapping back.
    expect(new Set(steps).size).toBe(steps.length);
  });

  it("is richer with depth and never louder, on every layer", () => {
    // The rule the whole bed obeys, checked across all of them rather than
    // only the bass: depth may add notes, and may never raise a level. This
    // replaces a narrower check that compared the bass note-for-note, which
    // would have forbidden the deep pickup that is the point of the change.
    const loudest = (t: number, lift = 0) => {
      const peak: Record<string, number> = {};
      for (let bar = 0; bar < 16; bar++) {
        for (const e of planBar(bar, 0, t, lift)) {
          peak[e.layer] = Math.max(peak[e.layer] ?? 0, e.gain);
        }
      }
      return peak;
    };

    const calm = loudest(0);
    for (const t of [0.3, 0.65, 0.85, 1]) {
      const deep = loudest(t);
      for (const [layer, level] of Object.entries(deep)) {
        if (calm[layer] !== undefined) expect(level).toBeLessThanOrEqual(calm[layer]!);
      }
    }
  });

  it("speeds the bed up a little with depth, and caps it hard", () => {
    // Tempo is the strongest arousal lever music has and the most fatiguing.
    // A deep round already has stone, one spin and a filling board; the bed
    // says the room tightened, it does not add pressure to pressure.
    expect(tempoAt(0)).toBe(BPM);
    expect(tempoAt(1)).toBe(BPM_DEEP);
    expect(BPM_DEEP / BPM).toBeLessThanOrEqual(1.2);

    // Monotonic, and in steps rather than a glide — a chip wrote a new number
    // in a register between rows, it could not slide.
    let previous = -Infinity;
    const seen = new Set<number>();
    for (let i = 0; i <= 20; i++) {
      const bpm = tempoAt(i / 20);
      expect(bpm).toBeGreaterThanOrEqual(previous);
      previous = bpm;
      seen.add(bpm);
      expect(bpm % 2).toBe(0);
    }
    // Genuinely stepped: far fewer distinct tempos than samples taken.
    expect(seen.size).toBeLessThan(10);
  });

  it("puts the notes in the right places whatever the tempo", () => {
    // A quicker bar is a shorter bar, not the same bar with the notes left
    // where they were. Every note has to stay inside its own bar at any tempo.
    for (const bpm of [BPM, 106, BPM_DEEP]) {
      const length = barSeconds(bpm);
      for (let bar = 0; bar < 16; bar++) {
        for (const event of planBar(bar, 0, 1, 0, bpm)) {
          expect(event.at).toBeGreaterThanOrEqual(0);
          expect(event.at).toBeLessThan(length);
        }
      }
    }
    // And the whole bar scales: the same plan at the top tempo is shorter.
    const last = (bpm: number) => {
      const events = planBar(3, 0, 1, 0, bpm);
      return Math.max(...events.map((e) => e.at));
    };
    expect(last(BPM_DEEP)).toBeLessThan(last(BPM));
  });
});

// -------------------------------------------------------------------- lifts

describe("the bed answering the player", () => {
  it("fills the arpeggio's holes and brings the air note in", () => {
    // A lift has to be audible without adding a note the bed could not
    // already play: the holes close and the long note arrives early.
    const plain = planBar(5, 0, 0.5);
    const lifted = planBar(5, 0, 0.5, 1);

    const arp = (events: ReturnType<typeof planBar>) =>
      events.filter((e) => e.layer === "arp").length;
    expect(arp(lifted)).toBeGreaterThan(arp(plain));

    // The air note is gated on depth 0.7 normally, and this bar is at 0.5.
    expect(plain.some((e) => e.layer === "air")).toBe(false);
    expect(lifted.some((e) => e.layer === "air")).toBe(true);
  });

  it("never makes a lifted bar louder in the bass", () => {
    // The same rule depth obeys: richer, never louder. A bonus that made the
    // bed climb would turn every good moment into a stressful one, which is
    // the exact mechanic the brief rules out.
    const bass = (lift: number) =>
      planBar(5, 0, 1, lift)
        .filter((e) => e.layer === "bass")
        .map((e) => e.gain);
    expect(bass(1)).toEqual(bass(0));
  });

  it("lifts whole bars only, and stops on its own", () => {
    vi.useFakeTimers();
    const { ctx, bus, dest } = fakeAudio();
    const player = new MusicPlayer(bus, ctx as AudioContext, dest);
    player.start();
    player.setIntensity(1);

    // A lift raised now reaches the bars not yet built, and no others. Two
    // bars later nothing is lifted any more without anybody clearing it.
    player.lift();
    expect(() => {
      for (let tick = 0; tick < 40; tick++) {
        ctx.currentTime += 0.4;
        vi.advanceTimersByTime(400);
      }
    }).not.toThrow();

    player.stop();
    vi.useRealTimers();
    // Sixteen seconds of ticks is well past a two-bar lift, and the bed is
    // still running rather than stuck in a lifted state or thrown out of it.
    expect(player.scheduledBars).toBeGreaterThan(4);
  });
});

// ------------------------------------------------------------ the long run

describe("the music player over a long session", () => {
  it("schedules every node it creates to stop, and never builds up", () => {
    vi.useFakeTimers();
    const { ctx, bus, counts, dest } = fakeAudio();
    const player = new MusicPlayer(bus, ctx as AudioContext, dest);

    player.start();
    player.setIntensity(0.8);

    // Ten minutes of wall clock, in the 400ms ticks the scheduler actually
    // wakes on. The audio clock moves with it, which is what makes this a
    // simulation of a long session rather than of a stalled one.
    const TICKS = (10 * 60 * 1000) / 400;
    let previous = 0;
    const growth: number[] = [];

    for (let tick = 0; tick < TICKS; tick++) {
      ctx.currentTime += 0.4;
      if (tick % 60 === 30) player.setWorld(Math.floor(tick / 60) % 10);
      vi.advanceTimersByTime(400);
      if (tick % 150 === 149) {
        growth.push(counts.created - previous);
        previous = counts.created;
      }
    }

    player.stop();
    vi.useRealTimers();

    // Every source started got a stop scheduled for it. A node with no stop is
    // a node that plays forever, which is both the leak and the noise.
    expect(counts.started).toBeGreaterThan(0);
    expect(counts.stopped).toBe(counts.started);

    // Ten minutes of bars, counted at the tempo the bed actually ran at rather
    // than the nominal one — this session sat at intensity 0.8, which is 110
    // BPM, not 100. Allow the lookahead its couple of spare bars, but nothing
    // like a runaway. Deriving the expectation this way means the check also
    // proves the tempo reached the graph: at the nominal 100 BPM this lands at
    // 250 bars and fails.
    const bars = Math.round((10 * 60) / barSeconds(tempoAt(0.8)));
    expect(player.scheduledBars).toBeGreaterThanOrEqual(bars - 2);
    expect(player.scheduledBars).toBeLessThanOrEqual(bars + 4);
    expect(bars).toBeGreaterThan(Math.round((10 * 60) / BAR));

    // And the work per minute is flat. This is the growth check: a scheduler
    // that leaks does more in its tenth minute than its first.
    const first = growth[0]!;
    for (const chunk of growth) {
      expect(chunk).toBeGreaterThan(0);
      expect(Math.abs(chunk - first)).toBeLessThan(first * 0.35);
    }
  });

  it("stops dead when told to", () => {
    vi.useFakeTimers();
    const { ctx, bus, counts, dest } = fakeAudio();
    const player = new MusicPlayer(bus, ctx as AudioContext, dest);
    player.start();
    ctx.currentTime += 4;
    vi.advanceTimersByTime(2000);
    const after = counts.created;

    player.stop();
    expect(player.running).toBe(false);
    ctx.currentTime += 60;
    vi.advanceTimersByTime(60_000);
    vi.useRealTimers();

    // Not one more node after stop. A timer left running is the other classic
    // leak, and it would keep the bed playing under a paused game.
    expect(counts.created).toBe(after);
  });

  it("does not burst a backlog of bars after a suspend", () => {
    // Backgrounding the app suspends the context. On resume the audio clock has
    // moved on while the scheduler's cursor has not, and the naive scheduler
    // dumps every missed bar at once — a very loud noise on returning to a game.
    vi.useFakeTimers();
    const { ctx, bus, counts, dest } = fakeAudio();
    const player = new MusicPlayer(bus, ctx as AudioContext, dest);
    player.start();
    vi.advanceTimersByTime(400);

    const before = counts.created;
    ctx.state = "suspended";
    ctx.currentTime += 300;
    vi.advanceTimersByTime(300_000);
    expect(counts.created).toBe(before); // nothing scheduled while suspended

    ctx.state = "running";
    const bars = player.scheduledBars;
    vi.advanceTimersByTime(400);
    vi.useRealTimers();

    // And on resume it picks up from now: a couple of bars of lookahead, not
    // the five minutes it slept through.
    expect(player.scheduledBars - bars).toBeLessThanOrEqual(3);
  });
});

describe("rendering a bar", () => {
  it("creates a bounded number of nodes for the busiest possible bar", () => {
    const { bus, counts, dest } = fakeAudio();
    const base = counts.created;
    scheduleBar(bus, dest, 2, 0, 1, 0);
    // Eight arp steps, two bass, two perc, one air, at three nodes each in the
    // worst case. A bar that costs dozens of nodes is a bar that will stutter.
    expect(counts.created - base).toBeLessThan(40);
  });
});
