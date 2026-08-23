/**
 * Sharing a result.
 *
 * Prefers the Capacitor plugin, which gives the real iOS share sheet, and
 * falls back to the Web Share API and then the clipboard so the same call
 * works in a browser during development.
 */

interface SharePlugin {
  share(options: { title?: string; text?: string; dialogTitle?: string }): Promise<unknown>;
}

function plugin(): SharePlugin | null {
  const global = window as unknown as { Capacitor?: { Plugins?: { Share?: SharePlugin } } };
  return global.Capacitor?.Plugins?.Share ?? null;
}

export async function shareResult(text: string): Promise<boolean> {
  const share = plugin();
  if (share) {
    try {
      await share.share({ title: "Shiftle", text });
      return true;
    } catch {
      return false; // The player dismissed the sheet.
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
