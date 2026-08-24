/**
 * Local persistence.
 *
 * Reads and writes stay synchronous, because they happen while a screen is
 * being built. localStorage is that synchronous store, and on the web it is
 * the whole story.
 *
 * On iOS it is not enough on its own. A WKWebView's localStorage lives with
 * the app's website data, which the system is free to clear under storage
 * pressure and which is not reliably carried through a backup or a restore.
 * For a game whose only lasting possession is a high score — and whose daily
 * is honest only because it remembers that today has been played — losing it
 * is not a cosmetic failure.
 *
 * So every write is mirrored into Capacitor Preferences, which is
 * NSUserDefaults and durable, and `hydrate()` puts back anything localStorage
 * has lost. Preferences is asynchronous, so it is the backup rather than the
 * source of truth: the fast path never waits on it.
 */

import { hasPlugin, isNative, registerPlugin } from "./native.js";

const PREFIX = "shiftle:";

interface PreferencesPlugin {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
}

const PREFERENCES = "Preferences";
const nativeStore = registerPlugin<PreferencesPlugin>(PREFERENCES);

function durable(): PreferencesPlugin | null {
  return isNative() && hasPlugin(PREFERENCES) ? nativeStore : null;
}

/**
 * Everything worth surviving a wipe. Listed rather than discovered, because
 * Preferences has no way to enumerate keys and guessing is worse than saying.
 */
const MIRRORED = ["best", "daily", "theme", "lang", "muted", "size", "pack"] as const;

/**
 * Restores anything localStorage has lost. Returns true if it put something
 * back, so the caller can redraw a screen that has already been built from the
 * emptier version.
 *
 * Deliberately one-way: Preferences only ever fills gaps. A value present in
 * localStorage is the newer one, because that is where every write lands first.
 */
export async function hydrate(): Promise<boolean> {
  const store = durable();
  if (!store) return false;

  let restored = false;
  for (const key of MIRRORED) {
    if (readString(key) !== null) continue;
    try {
      const { value } = await store.get({ key: PREFIX + key });
      if (value === null || value === undefined) continue;
      writeLocal(key, value);
      restored = true;
    } catch {
      // A key that will not come back is not worth failing a launch over.
    }
  }
  return restored;
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    // Private browsing, or storage turned off. Losing a preference is fine.
  }
}

export function readString(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function writeString(key: string, value: string): void {
  writeLocal(key, value);
  // Fire and forget: the game must never wait on a native round trip to
  // record a score.
  void durable()?.set({ key: PREFIX + key, value }).catch(() => {});
}

export function readNumber(key: string, fallback = 0): number {
  const raw = readString(key);
  const value = raw === null ? NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function writeNumber(key: string, value: number): void {
  writeString(key, String(value));
}

export function readJson<T>(key: string, fallback: T): T {
  const raw = readString(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    writeString(key, JSON.stringify(value));
  } catch {
    // Unserialisable value — not worth taking the game down for.
  }
}
