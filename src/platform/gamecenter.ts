/**
 * Game Center.
 *
 * The native half lives in the app itself, at ios/App/App/GameConnect.swift.
 * The web side registers the JS proxy through Capacitor and only uses it when
 * the signed native bridge reports that GameConnect exists.
 */

import { hasPlugin, isNative, registerPlugin } from "./native.js";

export const LEADERBOARDS = {
  daily: "com.nomarcus.shiftle.daily",
  endless: "com.nomarcus.shiftle.endless",
  time: "com.nomarcus.shiftle.time",
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

const NAME = "GameConnect";
const native = registerPlugin<GameConnectPlugin>(NAME);

/** A browser-only stand-in used by the development harness. */
let double: GameConnectPlugin | null = null;

export function useTestDouble(implementation: GameConnectPlugin | null): void {
  double = implementation;
}

function nativeAvailable(): boolean {
  const runningNative = isNative();
  const available = runningNative && hasPlugin(NAME);

  // Intentionally concise: these lines are useful in Safari/Xcode device logs
  // when diagnosing a signed TestFlight build, and harmless in a browser.
  if (runningNative) {
    console.info(`[Shiftle/GameConnect] native=${runningNative} pluginAvailable=${available}`);
  }

  return available;
}

function plugin(): GameConnectPlugin | null {
  if (double) return double;
  return nativeAvailable() ? native : null;
}

/** Whether there is a native side at all. False in every browser. */
export function isAvailable(): boolean {
  return plugin() !== null;
}

let signedIn = false;

export function isSignedIn(): boolean {
  return signedIn;
}

/** Safe to call on every launch; GameKit decides whether a prompt is needed. */
export async function signIn(): Promise<boolean> {
  const connect = plugin();
  if (!connect) {
    if (isNative()) console.warn("[Shiftle/GameConnect] signIn skipped: plugin unavailable");
    return false;
  }
  try {
    const result = await connect.signIn();
    signedIn = result?.authenticated === true;
    console.info(`[Shiftle/GameConnect] signIn authenticated=${signedIn}`);
    return signedIn;
  } catch (error) {
    console.error("[Shiftle/GameConnect] signIn failed", error);
    signedIn = false;
    return false;
  }
}

/** Re-reads the native state when the app comes back to the foreground. */
export async function refresh(): Promise<boolean> {
  const connect = plugin();
  if (!connect) return false;
  try {
    const result = await connect.isAuthenticated();
    signedIn = result?.authenticated === true;
    return signedIn;
  } catch (error) {
    console.warn("[Shiftle/GameConnect] refresh failed", error);
    return signedIn;
  }
}

export async function submitScore(leaderboard: LeaderboardId, score: number): Promise<void> {
  const connect = plugin();
  if (!connect) return;
  const value = Math.max(0, Math.round(score));
  try {
    await connect.submitScore({ leaderboardID: leaderboard, totalScoreAmount: value });
  } catch (error) {
    console.warn("[Shiftle/GameConnect] score submission failed", error);
  }
}

/** Opens the Game Center overlay, signing in first when necessary. */
export async function showLeaderboard(leaderboard?: LeaderboardId): Promise<boolean> {
  const connect = plugin();
  if (!connect) return false;
  if (!signedIn) await signIn();
  try {
    const result = await connect.showLeaderboard(leaderboard ? { leaderboardID: leaderboard } : {});
    return result?.shown === true;
  } catch (error) {
    console.error("[Shiftle/GameConnect] showLeaderboard failed", error);
    return false;
  }
}
