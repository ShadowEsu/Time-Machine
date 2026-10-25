// Builds the standalone CLI and the web app it serves with `tm ui`.
import { copyFileSync, cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const cli = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(cli, "../..");
const renderer = join(root, "apps/web/src/renderer");
const out = join(cli, "dist");
const ui = join(out, "ui");
rmSync(ui, { recursive: true, force: true });
mkdirSync(ui, { recursive: true });
const coreAlias = {
  name: "core-source",
  setup(b) {
    b.onResolve({ filter: /^@timetm\/core(\/verdict)?$/ }, ({ path }) => ({ path: join(root, "packages/core/src", path.endsWith("/verdict") ? "verdict.ts" : "index.ts") }));
  },
};
await build({
  entryPoints: [join(cli, "src/bin.ts")], outfile: join(out, "tm.js"), bundle: true, platform: "node", format: "esm", target: "node22", minify: true, legalComments: "eof", plugins: [coreAlias],
  banner: { js: "import { createRequire as __tmRequire } from 'node:module'; const require = __tmRequire(import.meta.url);" },
});
const web = { bundle: true, platform: "browser", format: "esm", target: ["chrome120", "safari17", "firefox120"], minify: true, legalComments: "eof", plugins: [coreAlias] };
await build({ ...web, entryPoints: [join(cli, "src/ui/entry.js")], outfile: join(ui, "app.js"), external: ["./renderer/index.js"] });
await build({ ...web, entryPoints: [join(renderer, "index.ts")], outfile: join(ui, "renderer/index.js") });
for (const name of ["styles.css", "features.css", "states.css"]) copyFileSync(join(renderer, name), join(ui, name));
copyFileSync(join(cli, "src/ui/browser.css"), join(ui, "browser.css"));
cpSync(join(renderer, "fonts"), join(ui, "fonts"), { recursive: true });
const html = readFileSync(join(renderer, "index.html"), "utf8");
writeFileSync(join(ui, "index.html"), html);
const assets = [];
function list(dir, prefix = "") {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const name = `${prefix}${item.name}`;
    if (item.isDirectory()) list(join(dir, item.name), `${name}/`);
    else if (item.isFile()) assets.push(name);
    else throw new Error(`Unexpected non-file UI asset: ${name}`);
  }
}
list(ui);
writeFileSync(join(ui, "asset-manifest.json"), `${JSON.stringify(assets.sort(), null, 2)}\n`);
console.log(`Built CLI and local browser app in ${out}`);
