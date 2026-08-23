import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.nomarcus.shiftle",
  appName: "Shiftle",
  webDir: "dist",
  ios: {
    // The game paints its own background right to the edges, and the canvas
    // reads the safe-area insets itself, so the web view is allowed to fill
    // the screen.
    contentInset: "never",
    backgroundColor: "#2E9BE8",
    // The disc is drawn every frame; bouncing the web view on top of that
    // just makes drags feel loose.
    scrollEnabled: false,
    limitsNavigationsToAppBoundDomains: true,
  },
  server: {
    // Everything is bundled; the app never talks to a server.
    androidScheme: "https",
  },
};

export default config;
