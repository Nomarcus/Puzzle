/**
 * Static checks on the native side, because none of it can be compiled here.
 *
 * These exist because of a real bug that shipped: GameConnect.swift was
 * written on the assumption that Capacitor discovers plugins by scanning the
 * Objective-C runtime. It does not — it registers exactly what
 * `capacitor.config.json` lists in `packageClassList`, which `cap sync`
 * generates from the npm packages in package.json. A plugin living in the app
 * target appears nowhere on that list, so it was never registered, no plugin
 * header was injected, and every Game Center call was a silent no-op. No
 * error, no warning, nothing in the logs — just a feature that did not exist.
 *
 * Nothing here needs Xcode. Run: node tools/verify-ios.mjs
 */

import { readFile, readdir } from "node:fs/promises";

const APP = "ios/App/App";
const PBXPROJ = "ios/App/App.xcodeproj/project.pbxproj";

const problems = [];
const notes = [];

function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) problems.push(label);
}

const pbxproj = await readFile(PBXPROJ, "utf8");
const swiftFiles = (await readdir(APP)).filter((name) => name.endsWith(".swift"));

// --- every Swift file is actually compiled ---------------------------------
for (const file of swiftFiles) {
  check(
    `${file} is in the Sources build phase`,
    pbxproj.includes(`${file} in Sources`),
    pbxproj.includes(file) ? "" : "not referenced by the project at all",
  );
}

// --- app-local plugins are registered somewhere ----------------------------
const sources = await Promise.all(
  swiftFiles.map(async (file) => ({ file, text: await readFile(`${APP}/${file}`, "utf8") })),
);

const localPlugins = sources
  .filter(({ text }) => /class\s+(\w+)\s*:\s*CAPPlugin\s*,\s*CAPBridgedPlugin/.test(text))
  .map(({ file, text }) => ({
    file,
    className: /class\s+(\w+)\s*:\s*CAPPlugin\s*,\s*CAPBridgedPlugin/.exec(text)[1],
    jsName: /jsName\s*=\s*"([^"]+)"/.exec(text)?.[1] ?? null,
  }));

check("there is at least one app-local plugin to check", localPlugins.length > 0, `${localPlugins.length} found`);

// cap sync regenerates this and it is gitignored, so it may not exist yet.
let packageClassList = [];
try {
  const config = JSON.parse(await readFile(`${APP}/capacitor.config.json`, "utf8"));
  packageClassList = config.packageClassList ?? [];
} catch {
  notes.push("capacitor.config.json not found — run `npm run ios:sync` first");
}

const allSwift = sources.map(({ text }) => text).join("\n");

for (const plugin of localPlugins) {
  const listed = packageClassList.includes(plugin.className);
  // The only other way it can reach the bridge: explicit registration in a
  // CAPBridgeViewController subclass's capacitorDidLoad().
  const registered = new RegExp(`registerPluginInstance\\(\\s*${plugin.className}\\(\\)`).test(allSwift);
  check(
    `${plugin.className} is registered with the bridge`,
    listed || registered,
    listed ? "via packageClassList" : registered ? "via registerPluginInstance" : "NOTHING registers it — it will silently not exist",
  );
  check(`${plugin.className} declares a jsName`, plugin.jsName !== null, plugin.jsName ?? "");
}

// --- whatever registers them has to be the class the app actually loads ----
const registrars = sources.filter(({ text }) => text.includes("registerPluginInstance"));
if (registrars.length > 0) {
  const storyboard = await readFile(`${APP}/Base.lproj/Main.storyboard`, "utf8");
  const customClass = /<viewController[^>]*customClass="([^"]+)"/.exec(storyboard)?.[1] ?? null;

  const registrarClasses = registrars.map(
    ({ text }) => /class\s+(\w+)\s*:\s*CAPBridgeViewController/.exec(text)?.[1] ?? null,
  );
  check(
    "the storyboard loads the view controller that registers the plugins",
    customClass !== null && registrarClasses.includes(customClass),
    `storyboard uses ${customClass}, registrars are ${registrarClasses.join(", ") || "none"}`,
  );

  const module = /<viewController[^>]*customModule="([^"]+)"/.exec(storyboard)?.[1] ?? null;
  check(
    "that view controller is resolved from the app target, not from Capacitor",
    module === "App",
    `customModule=${module}`,
  );
}

// --- entitlements reach both configurations --------------------------------
const entitlementRefs = (pbxproj.match(/CODE_SIGN_ENTITLEMENTS = /g) ?? []).length;
check(
  "both build configurations point at the entitlements file",
  entitlementRefs === 2,
  `${entitlementRefs} reference(s)`,
);

try {
  const entitlements = await readFile(`${APP}/App.entitlements`, "utf8");
  check(
    "the Game Center entitlement is present",
    entitlements.includes("com.apple.developer.game-center"),
  );
} catch {
  check("App.entitlements exists", false);
}

for (const note of notes) console.log(`note: ${note}`);
console.log(problems.length ? `\n${problems.length} problem(s)` : "\nNative wiring looks right.");
process.exit(problems.length ? 1 : 0);
