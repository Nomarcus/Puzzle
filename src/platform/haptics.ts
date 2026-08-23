/**
 * Haptics.
 *
 * Does nothing in a browser. On iOS the Capacitor Haptics plugin is picked up
 * off the global at runtime, so the web build carries no native dependency and
 * stays testable here.
 */

import type { HapticKind } from "../ui/game-screen.js";

interface CapacitorHaptics {
  impact(options: { style: string }): Promise<void>;
  notification(options: { type: string }): Promise<void>;
}

function plugin(): CapacitorHaptics | null {
  const global = window as unknown as { Capacitor?: { Plugins?: { Haptics?: CapacitorHaptics } } };
  return global.Capacitor?.Plugins?.Haptics ?? null;
}

const IMPACT: Record<string, string> = {
  light: "LIGHT",
  medium: "MEDIUM",
  heavy: "HEAVY",
};

export function haptic(kind: HapticKind): void {
  const haptics = plugin();
  if (!haptics) return;

  // Fire and forget — a dropped haptic must never interrupt a turn.
  if (kind === "success") {
    void haptics.notification({ type: "SUCCESS" }).catch(() => {});
    return;
  }
  void haptics.impact({ style: IMPACT[kind] ?? "LIGHT" }).catch(() => {});
}
