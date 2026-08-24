/**
 * Game Center.
 *
 * The native half lives in the app itself, at ios/App/App/GameConnect.swift,
 * rather than coming from a plugin on npm. This side resolves it off the global
 * at runtime rather than importing anything, so the web build carries no native
 * dependency and every call is a no-op when the plugin is absent — which is
 * what keeps the whole game testable in a browser.
 *
 * The leaderboard ids must match what is created in App Store Connect.
 */

export const LEADERBOARDS = {
  daily: "com.nomarcus.shiftle.daily",
  endless: "com.nomarcus.shiftle.endless",
} as const;

export type LeaderboardId = (typeof LEADERBOARDS)[keyof typeof LEADERBOARDS];

interface GameConnectPlugin {
  signIn(): Promise<{ authenticated?: boolean }>;
  isAuthenticated(): Promise<{ authenticated?: boolean }>;
  submitScore(options: {
    leaderboardID: string;
    totalScoreAmount: number;
  }): Promise<{ submitted?: boolean; reason?: string }>;
  showLeaderboard(options: { leaderboardID?: string }): Promise<{ shown?: boolean }>;
}

function plugin(): GameConnectPlugin | null {
  const global = window as unknown as {
    Capacitor?: { Plugins?: { GameConnect?: GameConnectPlugin } };
  };
  return global.Capacitor?.Plugins?.GameConnect ?? null;
}

/** Whether there is a native side at all. False in every browser. */
export function isAvailable(): boolean {
  return plugin() !== null;
}

/**
 * Whether the player is actually signed in.
 *
 * Cached because the UI asks on every menu render and the answer only changes
 * when the player signs in or out — which, on iOS, means leaving the app.
 */
let signedIn = false;

export function isSignedIn(): boolean {
  return signedIn;
}

/**
 * Safe to call on every launch: GameKit decides whether to prompt and only ever
 * does so once. Returns whether the player ended up signed in.
 */
export async function signIn(): Promise<boolean> {
  const connect = plugin();
  if (!connect) return false;
  try {
    const result = await connect.signIn();
    signedIn = result?.authenticated === true;
    return signedIn;
  } catch {
    signedIn = false;
    return false;
  }
}

/** Re-reads the native state. Worth doing when the app comes back to the front. */
export async function refresh(): Promise<boolean> {
  const connect = plugin();
  if (!connect) return false;
  try {
    const result = await connect.isAuthenticated();
    signedIn = result?.authenticated === true;
    return signedIn;
  } catch {
    return signedIn;
  }
}

export async function submitScore(leaderboard: LeaderboardId, score: number): Promise<void> {
  const connect = plugin();
  if (!connect) return;
  // Game Center takes whole numbers, and a negative one would be rejected.
  const value = Math.max(0, Math.round(score));
  try {
    await connect.submitScore({ leaderboardID: leaderboard, totalScoreAmount: value });
  } catch {
    // A failed submission must never interrupt the game.
  }
}

/**
 * Opens the Game Center overlay. Signs in first if the player has not yet —
 * tapping a leaderboard button is exactly the moment a sign-in prompt makes
 * sense, and it is the only place in the game that asks.
 */
export async function showLeaderboard(leaderboard?: LeaderboardId): Promise<boolean> {
  const connect = plugin();
  if (!connect) return false;
  if (!signedIn) await signIn();
  try {
    const result = await connect.showLeaderboard(leaderboard ? { leaderboardID: leaderboard } : {});
    return result?.shown === true;
  } catch {
    return false;
  }
}
