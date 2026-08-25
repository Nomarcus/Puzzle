/**
 * The safe-area insets, in pixels.
 *
 * Measured off a real element rather than read off the custom property that
 * index.html parks on :root. Reading it directly means parsing whatever the
 * engine hands back for a custom property, and whether `env()` inside one is
 * substituted at that point is engine-dependent — Chromium resolves it to
 * "0px", but this ships in WKWebView and a literal "env(...)" string would
 * parse to NaN and quietly become zero. On a notched phone that is the
 * difference between the score sitting under the Dynamic Island and not.
 *
 * Going through `var()` on a real property is resolved by the normal cascade
 * everywhere, and it keeps the insets overridable, which is the only way to
 * test this without a notched device.
 */
let insetProbe: HTMLDivElement | null = null;

export function safeInsets(): { top: number; bottom: number } {
  if (!insetProbe) {
    insetProbe = document.createElement("div");
    insetProbe.setAttribute("aria-hidden", "true");
    insetProbe.style.cssText =
      "position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;" +
      "padding-top:var(--safe-top);padding-bottom:var(--safe-bottom);";
    document.body.append(insetProbe);
  }

  const style = getComputedStyle(insetProbe);
  const top = Number.parseFloat(style.paddingTop);
  const bottom = Number.parseFloat(style.paddingBottom);
  return {
    top: Number.isFinite(top) ? top : 0,
    bottom: Number.isFinite(bottom) ? bottom : 0,
  };
}
