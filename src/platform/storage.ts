/**
 * Local persistence.
 *
 * Wrapped rather than used directly so the Capacitor Preferences plugin can be
 * dropped in for the iOS build without touching any call sites, and so a
 * browser with storage disabled degrades to defaults instead of throwing.
 */

const PREFIX = "shiftle:";

export function readString(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    // Private browsing, or storage turned off. Losing a preference is fine.
  }
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
