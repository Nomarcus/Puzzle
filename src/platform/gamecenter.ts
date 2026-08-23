/**
 * Game Center leaderboards.
 *
 * Resolved off the global at runtime rather than imported, so the web build
 * carries no native dependency and stays testable in a browser. Every call is
 * a no-op unless a native plugin is actually present.
 *
 * The leaderboard ids must match what is created in App Store Connect.
 */

export const LEADERBOARDS = {
  daily: "com.nomarcus.shiftle.daily",
  endless: "com.nomarcus.shiftle.endless",
} as const;

interface GameConnectPlugin {
  signIn(): Promise<unknown>;
  submitScore(options: { leaderboardID: string; totalScoreAmount: number }): Promise<unknown>;
  showLeaderboard(options: { leaderboardID: string }): Promise<unknown>;
}

function plugin(): GameConnectPlugin | null {
  const global = window as unknown as {
    Capacitor?: { Plugins?: { GameConnect?: GameConnectPlugin } };
  };
  return global.Capacitor?.Plugins?.GameConnect ?? null;
}

export function isAvailable(): boolean {
  return plugin() !== null;
}

/** Safe to call on every launch; the system only prompts once. */
export async function signIn(): Promise<boolean> {
  const connect = plugin();
  if (!connect) return false;
  try {
    await connect.signIn();
    return true;
  } catch {
    return false;
  }
}

export async function submitScore(leaderboard: string, score: number): Promise<void> {
  const connect = plugin();
  if (!connect) return;
  try {
    await connect.submitScore({ leaderboardID: leaderboard, totalScoreAmount: score });
  } catch {
    // A failed submission must never interrupt the game.
  }
}

export async function showLeaderboard(leaderboard: string): Promise<void> {
  const connect = plugin();
  if (!connect) return;
  try {
    await connect.showLeaderboard({ leaderboardID: leaderboard });
  } catch {
    // Nothing to do — the player just does not get the overlay.
  }
}
