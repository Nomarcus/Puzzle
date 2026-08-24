/**
 * The one place that knows Capacitor exists.
 *
 * Everything else in platform/ used to reach for `window.Capacitor.Plugins.X`
 * and take `undefined` as "we are in a browser". That is wrong on a device:
 * the native bridge injects `Capacitor.PluginHeaders` listing what is
 * available natively, but it never fills `Capacitor.Plugins` — only a
 * JS-side `registerPlugin()` call does that. With nothing importing
 * `@capacitor/core`, that call never happened, so every plugin looked absent
 * on iOS as well and the native paths were silently dead.
 *
 * So the core runtime is imported here, once, and plugins are registered
 * properly. `registerPlugin` is safe in a browser: it hands back a proxy that
 * rejects, which is why `available()` is asked first rather than the calls
 * being wrapped in hope.
 */

import { Capacitor, registerPlugin } from "@capacitor/core";

export { registerPlugin };

/** True inside the app, false in any browser. */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Whether a plugin has a native implementation on this platform. Reads the
 * headers the native bridge injected, so it is honest about what is really
 * there rather than about what we hoped to find.
 */
export function hasPlugin(name: string): boolean {
  return Capacitor.isPluginAvailable(name);
}
