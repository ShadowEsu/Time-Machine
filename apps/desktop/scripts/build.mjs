// Builds the Electron app into out/, or with --preview the browser preview into preview/dist/.
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

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
  copyFileSync(join(here, "src/renderer/styles.css"), join(out, "styles.css"));
  copyFileSync(join(here, "preview/index.html"), join(out, "index.html"));
  console.log(`Preview built in ${out}. Open index.html in a browser.`);
} else {
  const out = join(here, "out");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const node = { ...common, platform: "node", format: "cjs", target: "node22", external: ["electron"] };
  await Promise.all([
    build({ ...node, entryPoints: [join(here, "src/main/main.ts")], outfile: join(out, "main.cjs") }),
    build({ ...node, entryPoints: [join(here, "src/preload/main.ts")], outfile: join(out, "preload.cjs") }),
    build({ ...node, entryPoints: [join(here, "src/preload/overlay.ts")], outfile: join(out, "preload-overlay.cjs") }),
    build({ ...web, entryPoints: [join(here, "src/renderer/index.ts")], outfile: join(out, "renderer.js") }),
    build({ ...web, entryPoints: [join(here, "src/renderer/overlay.ts")], outfile: join(out, "overlay.js") }),
  ]);
  for (const f of ["index.html", "overlay.html", "styles.css"]) copyFileSync(join(here, "src/renderer", f), join(out, f));
  console.log(`App built in ${out}.`);
}
