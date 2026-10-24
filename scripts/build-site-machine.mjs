// Builds the site's 3D machine (S5 "The Stack") into one same-origin file: site/assets/machine/machine.js.
//
//   node scripts/build-site-machine.mjs
//
// Inputs, kept out of site/ (the Vercel root deploys everything under it):
//   scripts/site-machine/src/scene.js (entry) and stage.js
//   vendor/three-0.186.1/ (three@0.186.1 copied unmodified from its npm tarball; sha256s in commit d0d37b5)
// Outputs, the only files site/ ships for the machine:
//   site/assets/machine/machine.js       esbuild 0.28.2, esm, minified, legal comments kept (three's MIT header)
//   site/assets/machine/LICENSE-three.txt a byte copy of the vendored LICENSE
//
// `three` and `three/addons/*` resolve to the vendored copy only, so nothing comes from node_modules (the build fails
// if anything does). Same inputs give a byte-identical machine.js. The build fails above the budget: 208,000 bytes
// after gzip -9 (BOSS, S5 build spec §8).
import { createRequire } from "node:module";
import { copyFileSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = path.join(ROOT, "vendor/three-0.186.1");
const SRC = path.join(ROOT, "scripts/site-machine/src");
const OUT = path.join(ROOT, "site/assets/machine");
const ESBUILD_VERSION = "0.28.2";
const BUDGET_GZ = 208000;

// The repo pins esbuild in packages/cli (pnpm-lock.yaml); use that copy and no other version.
const esbuild = createRequire(path.join(ROOT, "packages/cli/package.json"))("esbuild");
if (esbuild.version !== ESBUILD_VERSION) {
  console.error(`esbuild ${esbuild.version} found, ${ESBUILD_VERSION} required (pnpm install --frozen-lockfile --filter timetm)`);
  process.exit(1);
}

const vendoredThree = {
  name: "vendored-three",
  setup(b) {
    b.onResolve({ filter: /^three$/ }, () => ({ path: path.join(VENDOR, "build/three.module.js") }));
    b.onResolve({ filter: /^three\/addons\// }, (a) => ({ path: path.join(VENDOR, "examples/jsm", a.path.slice("three/addons/".length)) }));
  },
};

const result = await esbuild.build({
  entryPoints: [path.join(SRC, "scene.js")],
  outfile: path.join(OUT, "machine.js"),
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  legalComments: "eof",
  plugins: [vendoredThree],
  metafile: true,
  logLevel: "warning",
});

const inputs = Object.keys(result.metafile.inputs);
const stray = inputs.filter((i) => !i.startsWith("vendor/three-0.186.1/") && !i.startsWith("scripts/site-machine/src/"));
if (stray.length) {
  console.error("inputs outside vendor/three-0.186.1 and scripts/site-machine/src:\n  " + stray.join("\n  "));
  process.exit(1);
}
copyFileSync(path.join(VENDOR, "LICENSE"), path.join(OUT, "LICENSE-three.txt"));

const bytes = readFileSync(path.join(OUT, "machine.js"));
const gz = gzipSync(bytes, { level: 9 }).length;
console.log(`machine.js ${bytes.length} B min, ${gz} B gzip -9 (budget ${BUDGET_GZ}), ${inputs.length} inputs`);
if (gz > BUDGET_GZ) {
  console.error(`over budget by ${gz - BUDGET_GZ} B`);
  process.exit(1);
}
