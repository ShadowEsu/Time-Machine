// Builds the Electron app into out/, or with --preview the browser preview into preview/dist/.
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { iconPng } from "./app-icon.mjs";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const coreSrc = resolve(here, "../../packages/core/src");
const preview = process.argv.includes("--preview");

/** The app builds the engine from source, so it never needs a separate core build first. */
const coreAlias = {
  name: "core-alias",
  setup(b) {
    b.onResolve({ filter: /^@timetm\/core(\/verdict)?$/ }, (args) => ({
      path: join(coreSrc, args.path.endsWith("/verdict") ? "verdict.ts" : "index.ts"),
    }));
  },
};

const common = { bundle: true, sourcemap: "linked", logLevel: "warning", legalComments: "none", plugins: [coreAlias] };
const web = { ...common, platform: "browser", format: "iife", target: "chrome120" };

if (preview) {
  const out = join(here, "preview/dist");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  await build({ ...web, entryPoints: [join(here, "preview/entry.ts")], outfile: join(out, "app.js"), sourcemap: false });
  for (const f of ["styles.css", "features.css"]) copyFileSync(join(here, "src/renderer", f), join(out, f));
  // Fonts ship with the app (SIL OFL 1.1, licences alongside). No network fonts.
  cpSync(join(here, "src/renderer/fonts"), join(out, "fonts"), { recursive: true });
  copyFileSync(join(here, "preview/index.html"), join(out, "index.html"));
  console.log(`Preview built in ${out}. Open index.html in a browser.`);
} else {
  const out = join(here, "out");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const node = { ...common, platform: "node", format: "cjs", target: "node22", external: ["electron"] };
  // The Claude Code hooks call this copy of the CLI with the app's own Node, so they never
  // depend on a package name on npm. The npx fallback is pinned to the same version.
  const cliVersion = JSON.parse(readFileSync(resolve(here, "../../packages/cli/package.json"), "utf8")).version;
  await Promise.all([
    build({ ...node, entryPoints: [join(here, "src/main/main.ts")], outfile: join(out, "main.cjs"), define: { __TM_CLI_VERSION__: JSON.stringify(cliVersion) } }),
    build({ ...node, entryPoints: [join(here, "src/preload/main.ts")], outfile: join(out, "preload.cjs") }),
    build({ ...node, entryPoints: [join(here, "src/preload/overlay.ts")], outfile: join(out, "preload-overlay.cjs") }),
    build({
      ...common,
      platform: "node",
      format: "esm",
      target: "node22",
      entryPoints: [resolve(here, "../../packages/cli/src/bin.ts")],
      outfile: join(out, "tm.mjs"),
      banner: { js: "import { createRequire as __tmRequire } from 'node:module'; const require = __tmRequire(import.meta.url);" },
    }),
    build({ ...web, entryPoints: [join(here, "src/renderer/index.ts")], outfile: join(out, "renderer.js") }),
    build({ ...web, entryPoints: [join(here, "src/renderer/overlay.ts")], outfile: join(out, "overlay.js") }),
  ]);
  for (const f of ["index.html", "overlay.html", "styles.css", "features.css"]) copyFileSync(join(here, "src/renderer", f), join(out, f));
  cpSync(join(here, "src/renderer/fonts"), join(out, "fonts"), { recursive: true });
  // Dock and About panel icon for unpackaged runs; the packaged app uses the .icns from package-local.
  writeFileSync(join(out, "icon.png"), iconPng(512));
  console.log(`App built in ${out}.`);
}
