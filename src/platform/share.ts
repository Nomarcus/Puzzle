/**
 * Sharing a result.
 *
 * Prefers a real image share, because the mandala is the point — a line of
 * text is a poor substitute for the disc you actually left behind. Falls back
 * through text sharing to the clipboard, so the same call does something
 * sensible in a browser during development.
 *
 * The image path goes through the Web Share API rather than the Capacitor
 * plugin: WKWebView has supported sharing files that way since iOS 15, and it
 * avoids pulling in the Filesystem plugin just to hand over one PNG.
 */

interface SharePlugin {
  share(options: { title?: string; text?: string; dialogTitle?: string }): Promise<unknown>;
}

function plugin(): SharePlugin | null {
  const global = window as unknown as { Capacitor?: { Plugins?: { Share?: SharePlugin } } };
  return global.Capacitor?.Plugins?.Share ?? null;
}

async function shareImage(text: string, image: Blob): Promise<boolean> {
  if (!navigator.share || !navigator.canShare) return false;

  const file = new File([image], "shiftle.png", { type: "image/png" });
  if (!navigator.canShare({ files: [file] })) return false;

  try {
    await navigator.share({ files: [file], text });
    return true;
  } catch {
    // Dismissed, or the sheet refused the payload. Fall through to text.
    return false;
  }
}

export async function shareResult(text: string, image?: Blob | null): Promise<boolean> {
  if (image && (await shareImage(text, image))) return true;

  const share = plugin();
  if (share) {
    try {
      await share.share({ title: "Shiftle", text });
      return true;
    } catch {
      return false;
    }
  }

  if (navigator.share) {
    try {
      await navigator.share({ text });
      return true;
    } catch {
      return false;
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
