/**
 * Haptics.
 *
 * Does nothing in a browser. On iOS the Capacitor Haptics plugin is registered
 * through the core runtime — reading `window.Capacitor.Plugins.Haptics`
 * directly, as this used to, found nothing even on a device, because only
 * `registerPlugin()` ever puts anything there. Every buzz in the game was
 * silently dropped.
 *
 * Also gated on the player's own Haptics switch, the same `save.audio.haptics`
 * that Music and SFX each get their own copy of. That switch used to only ever
 * change what `audio.ts` itself did — nothing here ever read it, so turning
 * Vibration off in settings left the phone buzzing exactly as before.
 */

import type { HapticKind } from "../ui/game-screen.js";
import { hasPlugin, isNative, registerPlugin } from "./native.js";
import { hapticsEnabled } from "./audio.js";

interface CapacitorHaptics {
  impact(options: { style: string }): Promise<void>;
  notification(options: { type: string }): Promise<void>;
}

const NAME = "Haptics";
const native = registerPlugin<CapacitorHaptics>(NAME);

function plugin(): CapacitorHaptics | null {
  return isNative() && hasPlugin(NAME) ? native : null;
}

const IMPACT: Record<string, string> = {
  light: "LIGHT",
  medium: "MEDIUM",
  heavy: "HEAVY",
};

export function haptic(kind: HapticKind): void {
  if (!hapticsEnabled()) return;
  const haptics = plugin();
  if (!haptics) return;

  // Fire and forget — a dropped haptic must never interrupt a turn.
  if (kind === "success") {
    void haptics.notification({ type: "SUCCESS" }).catch(() => {});
    return;
  }
  void haptics.impact({ style: IMPACT[kind] ?? "LIGHT" }).catch(() => {});
}
