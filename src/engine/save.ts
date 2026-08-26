/**
 * Everything the player has to show for themselves, in one versioned record.
 *
 * ## Why a new blob rather than more loose keys
 *
 * The game already stores `best`, `bestTime`, `levels`, `history`, `lifetime`
 * and `theme` as individual keys, written the day each feature landed. That
 * worked while there were six of them. This adds per-mode records, world
 * discovery, a mastery goal and three audio switches, and doing that as another
 * dozen loose keys would leave no way to migrate them together or to tell a
 * half-written save from an old one.
 *
 * So the new state is one JSON value under one key, carrying its own `version`.
 * **The old keys are left exactly where they are and keep working** — a player
 * updating from the last build keeps their high score, their streak, their
 * cleared levels and their theme, because nothing touches them.
 *
 * ## The rule that matters most here
 *
 * A broken or unknown save must never stop the game starting. Every read goes
 * through `loadSave`, which validates field by field and falls back to a fresh
 * default for anything it cannot make sense of. There is no path out of here
 * that throws, and no shape of stored data that can produce one — a player whose
 * storage got truncated loses their records, which is sad, and still gets a game
 * they can play, which is the point.
 */

export const SAVE_VERSION = 1;

/** The modes that keep records. `challenge` is deliberately absent: it is */
/** somebody else's board, so a record there would not be comparable. */
export type ModeId = "daily" | "endless" | "level" | "time";

export interface ModeRecords {
  /** Highest score in this mode. */
  score: number;
  /** Deepest free-play depth. Zero in modes that do not ramp. */
  depth: number;
  bestCombo: number;
  ringsCleared: number;
  coresFired: number;
  /** Seconds survived. Time attack only. */
  survived: number;
}

export interface WorldProgress {
  /** Deepest depth reached inside this world, ever. */
  bestDepth: number;
}

export interface MasteryState {
  /**
   * Which trio is on offer. Advances only when a goal is completed, never with
   * the clock — a goal that expired overnight would punish somebody for having
   * a life, and the brief rules that out.
   */
  round: number;
  /** The chosen goal's id, or null when nothing is picked yet. */
  activeId: string | null;
  /** Best progress seen toward the active goal, so a bad round cannot undo it. */
  progress: number;
  /** How many goals have ever been completed. Shown, never spent. */
  completed: number;
}

export interface AudioPrefs {
  music: boolean;
  sfx: boolean;
  haptics: boolean;
}

export interface Save {
  version: number;
  records: Partial<Record<ModeId, ModeRecords>>;
  /** Keyed by world id. A world present here has been discovered. */
  worlds: Record<string, WorldProgress>;
  mastery: MasteryState;
  audio: AudioPrefs;
}

export function emptyRecords(): ModeRecords {
  return { score: 0, depth: 0, bestCombo: 0, ringsCleared: 0, coresFired: 0, survived: 0 };
}

export function freshSave(): Save {
  return {
    version: SAVE_VERSION,
    records: {},
    worlds: {},
    mastery: { round: 0, activeId: null, progress: 0, completed: 0 },
    audio: { music: true, sfx: true, haptics: true },
  };
}

const MODES: readonly ModeId[] = ["daily", "endless", "level", "time"];

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readRecords(raw: unknown): ModeRecords {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    score: num(r.score),
    depth: num(r.depth),
    bestCombo: num(r.bestCombo),
    ringsCleared: num(r.ringsCleared),
    coresFired: num(r.coresFired),
    survived: num(r.survived),
  };
}

/**
 * Reads a stored save, whatever state it is in.
 *
 * `wasMuted` carries the old single mute switch forward. Somebody who had the
 * whole game silenced must not be handed music on first launch just because
 * music is now a separate setting — so an old mute turns *everything* off, and
 * they can turn back on whichever part they actually wanted.
 */
export function loadSave(raw: unknown, wasMuted = false): Save {
  const fresh = freshSave();
  if (raw === null || typeof raw !== "object") {
    if (wasMuted) fresh.audio = { music: false, sfx: false, haptics: false };
    return fresh;
  }

  const stored = raw as Record<string, unknown>;
  const save = freshSave();

  // Version is read but not branched on yet: there is only one. It exists so
  // the next change has somewhere to hang a migration instead of guessing from
  // which fields happen to be present.
  save.version = SAVE_VERSION;

  const records = (stored.records ?? {}) as Record<string, unknown>;
  for (const mode of MODES) {
    if (records[mode] !== undefined) save.records[mode] = readRecords(records[mode]);
  }

  const worlds = stored.worlds;
  if (worlds !== null && typeof worlds === "object") {
    for (const [id, value] of Object.entries(worlds as Record<string, unknown>)) {
      // Ids are written by us, but a hand-edited or corrupted store can hold
      // anything, and an id used as an object key is a cheap injection route.
      if (!/^[a-z0-9-]{1,24}$/.test(id)) continue;
      const entry = (value ?? {}) as Record<string, unknown>;
      save.worlds[id] = { bestDepth: num(entry.bestDepth) };
    }
  }

  const mastery = (stored.mastery ?? {}) as Record<string, unknown>;
  save.mastery = {
    round: num(mastery.round),
    activeId: typeof mastery.activeId === "string" ? mastery.activeId : null,
    progress: num(mastery.progress),
    completed: num(mastery.completed),
  };

  const audio = stored.audio;
  if (audio !== null && typeof audio === "object") {
    const a = audio as Record<string, unknown>;
    save.audio = {
      music: bool(a.music, !wasMuted),
      sfx: bool(a.sfx, !wasMuted),
      haptics: bool(a.haptics, !wasMuted),
    };
  } else if (wasMuted) {
    // First run after the update, and the old switch said silence.
    save.audio = { music: false, sfx: false, haptics: false };
  }

  return save;
}

export function recordsFor(save: Save, mode: ModeId): ModeRecords {
  return save.records[mode] ?? emptyRecords();
}

/** One personal best that a round improved, ready to be shown. */
export interface Beaten {
  readonly kind: keyof ModeRecords;
  readonly from: number;
  readonly to: number;
}

/**
 * Folds a finished round into the records and reports what improved.
 *
 * Returns the beaten list in a fixed order of importance rather than the order
 * the fields happen to sit in, because the result screen shows only the top few
 * and "deepest ever" matters more than "one more ring than last time".
 */
export function applyRound(
  save: Save,
  mode: ModeId,
  round: Partial<ModeRecords>,
): { save: Save; beaten: Beaten[] } {
  const before = recordsFor(save, mode);
  const after: ModeRecords = { ...before };
  const beaten: Beaten[] = [];

  const order: (keyof ModeRecords)[] = [
    "depth",
    "score",
    "survived",
    "bestCombo",
    "coresFired",
    "ringsCleared",
  ];

  for (const key of order) {
    const value = num(round[key], 0);
    if (value > before[key]) {
      // A first-ever value is not a beaten record — there was nothing to beat,
      // and calling it one is exactly the fabricated milestone the brief bans.
      if (before[key] > 0) beaten.push({ kind: key, from: before[key], to: value });
      after[key] = value;
    }
  }

  return {
    save: { ...save, records: { ...save.records, [mode]: after } },
    beaten,
  };
}

/**
 * Marks a world reached, and how deep inside it the player got.
 *
 * Returns whether this was the first time, which is the whole reason the result
 * screen has something to say about it.
 */
export function discoverWorld(
  save: Save,
  worldId: string,
  depth: number,
): { save: Save; firstTime: boolean } {
  const existing = save.worlds[worldId];
  const bestDepth = Math.max(existing?.bestDepth ?? 0, num(depth));
  if (existing && bestDepth === existing.bestDepth) return { save, firstTime: false };
  return {
    save: { ...save, worlds: { ...save.worlds, [worldId]: { bestDepth } } },
    firstTime: existing === undefined,
  };
}

export function isDiscovered(save: Save, worldId: string): boolean {
  return save.worlds[worldId] !== undefined;
}
