/**
 * Bundles the game into one self-contained HTML file.
 *
 * Used for the shareable web build: everything inlined, no network requests,
 * so it can be dropped anywhere and just run. The iOS build goes through
 * Capacitor and uses the normal dist/ output instead.
 */
import { build } from "vite";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const out = process.argv[2] ?? "tools/out/shiftle.html";

await build({ logLevel: "warn", build: { outDir: "dist" } });

const html = await readFile("dist/index.html", "utf8");

// Pull out the pieces we need. The CSS is authored inline in index.html, so
// Vite leaves it in place; only the JS gets emitted as a separate asset.
const style = html.match(/<style>[\s\S]*?<\/style>/)?.[0] ?? "";
const scriptSrc = html.match(/<script[^>]*src="([^"]+)"[^>]*><\/script>/)?.[1];
if (!scriptSrc) throw new Error("No script tag found in the built HTML");

const code = await readFile(resolve("dist", scriptSrc.replace(/^\.?\//, "")), "utf8");

// A literal </script> inside the bundle would close the tag early.
const safeCode = code.replace(/<\/script>/gi, "<\\/script>");

const page = `<title>Shiftle</title>
${style}
<div id="app"><canvas id="board"></canvas></div>
<script type="module">
${safeCode}
</script>
`;

await mkdir(dirname(out), { recursive: true });
await writeFile(out, page, "utf8");

const kb = (Buffer.byteLength(page) / 1024).toFixed(0);
console.log(`Wrote ${out} (${kb} KB, fully self-contained)`);
