// Builds the browser preview (the real renderer with an in-memory demo engine) into preview/dist/.
// The real web app is built and served by the CLI: packages/cli/scripts/build.mjs, then `tm ui`.
import { copyFileSync, cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const coreSrc = resolve(here, "../../packages/core/src");

/** The preview builds the engine types from source, so it never needs a separate core build first. */
const coreAlias = {
  name: "core-alias",
  setup(b) {
    b.onResolve({ filter: /^@timetm\/core(\/verdict)?$/ }, (args) => ({
      path: join(coreSrc, args.path.endsWith("/verdict") ? "verdict.ts" : "index.ts"),
    }));
  },
};

const out = join(here, "preview/dist");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
await build({
  bundle: true, logLevel: "warning", legalComments: "none", plugins: [coreAlias],
  platform: "browser", format: "iife", target: "chrome120",
  entryPoints: [join(here, "preview/entry.ts")], outfile: join(out, "app.js"),
});
for (const f of ["styles.css", "features.css"]) copyFileSync(join(here, "src/renderer", f), join(out, f));
// Fonts ship with the app (SIL OFL 1.1, licences alongside). No network fonts.
cpSync(join(here, "src/renderer/fonts"), join(out, "fonts"), { recursive: true });
copyFileSync(join(here, "preview/index.html"), join(out, "index.html"));
console.log(`Preview built in ${out}. Open index.html in a browser.`);
