// Local Mac artifact only. No Developer ID, notarization, publishing or installation.
import { spawnSync } from "node:child_process";
import { closeSync, cpSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureSigningIdentity } from "./setup-signing.mjs";

const here = dirname(dirname(fileURLToPath(import.meta.url)));
const release = join(here, "release");
const app = join(release, "Time Machine.app");
const zip = join(release, "Time Machine.zip");
const entitlements = join(here, "scripts/entitlements.local.plist");
const bundleId = "dev.timetm.desktop";
const identity = ensureSigningIdentity();
const meta = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));

function run(command, args) {
  const r = spawnSync(command, args, { cwd: here, encoding: "utf8", stdio: "inherit" });
  if (r.error || r.status !== 0) throw new Error(`${command} failed${r.error ? `: ${r.error.message}` : ` (exit ${r.status})`}`);
}

const temp = mkdtempSync(join(tmpdir(), "timetm-package-"));
try {
  run(process.execPath, [join(here, "scripts/build.mjs")]);
  const stage = join(temp, "stage");
  mkdirSync(stage);
  cpSync(join(here, "out"), join(stage, "out"), { recursive: true });
  writeFileSync(join(stage, "package.json"), JSON.stringify({ name: "timetm-desktop", productName: "Time Machine", version: meta.version, main: "out/main.cjs", license: "MIT" }));
  // Exact tool and Electron versions. Only bundled output and minimal metadata go into the app.
  // Do not use asar: the bundled CLI is run by Electron's Node through an absolute filesystem path.
  run("pnpm", ["dlx", "@electron/packager@19.0.1", stage, "Time Machine", "--platform=darwin", `--arch=${process.arch}`, `--electron-version=${meta.devDependencies.electron}`,
    `--app-bundle-id=${bundleId}`, `--helper-bundle-id=${bundleId}.helper`, "--app-category-type=public.app-category.developer-tools", "--darwin-dark-mode-support", "--no-asar", "--no-prune", `--out=${join(temp, "packed")}`]);
  const built = join(temp, "packed", `Time Machine-darwin-${process.arch}`, "Time Machine.app");
  const code = [];
  const bundles = [];
  const magic = new Set([0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca]);
  function walk(path) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      for (const child of readdirSync(path)) walk(join(path, child));
      // Postorder: all nested code first, then its containing bundle.
      if (path.endsWith(".app") || path.endsWith(".framework")) bundles.push(path);
    } else if (stat.isFile() && stat.size >= 4) {
      const fd = openSync(path, "r");
      const header = Buffer.allocUnsafe(4);
      try { readSync(fd, header, 0, 4, 0); } finally { closeSync(fd); }
      if (magic.has(header.readUInt32BE())) code.push(path);
    }
  }
  walk(built);
  const sign = (path, executable) => run("codesign", ["--force", "--sign", identity.fingerprint, "--keychain", identity.keychain, "--options", "runtime", "--timestamp=none",
    ...(executable ? ["--entitlements", entitlements] : []), path]);
  for (const path of code) sign(path, path.includes("/Contents/MacOS/") || path.endsWith("/chrome_crashpad_handler"));
  for (const path of bundles) sign(path, path.endsWith(".app"));
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", built]);
  mkdirSync(release, { recursive: true });
  // Replaces only this script's named local artifacts, never another installed app.
  rmSync(app, { recursive: true, force: true });
  renameSync(built, app);
  rmSync(zip, { force: true });
  run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, zip]);
  console.log(`Local self-signed build: ${app}\nZIP: ${zip}\nCertificate SHA-256: ${identity.sha256}\nNot signed or notarized by Apple. Gatekeeper may reject it; use the README's first-open instructions only for a build from the official repository.`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
