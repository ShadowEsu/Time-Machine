// Local Mac artifact by default: self-signed, no notarization, publishing or installation.
// Opt-in Apple release: TM_SIGN_IDENTITY (Developer ID Application) and TM_NOTARY_PROFILE, or package:release.
import { spawnSync } from "node:child_process";
import { closeSync, cpSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { iconIcns } from "./app-icon.mjs";
import { developerIdIdentity, ensureSigningIdentity } from "./setup-signing.mjs";
import { checkNotary, codesignArgs, finishSteps, signingConfig } from "./signing-plan.mjs";

const here = dirname(dirname(fileURLToPath(import.meta.url)));
const release = join(here, "release");
const app = join(release, "Time Machine.app");
const zip = join(release, "Time Machine.zip");
const bundleId = "dev.timetm.desktop";
const config = signingConfig(process.env, { release: process.argv.includes("--release") });
// Look up the identity before the slow build, so a missing certificate fails at once.
const identity = config.mode === "local" ? ensureSigningIdentity() : developerIdIdentity(config.identity);
const signer = config.mode === "local" ? { mode: "local", fingerprint: identity.fingerprint, keychain: identity.keychain } : { mode: "developer-id", fingerprint: identity.fingerprint };
const meta = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
const copyright = readFileSync(join(here, "../../LICENSE"), "utf8").match(/^Copyright .+$/m)?.[0];
if (!copyright) throw new Error("No copyright line in LICENSE");

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
  // Dock, Finder and About icon, drawn by app-icon.mjs. Without it the app shows Electron's icon.
  const icon = iconIcns();
  const iconPath = join(temp, "Time Machine.icns");
  writeFileSync(iconPath, icon);
  // Exact tool and Electron versions. Only bundled output and minimal metadata go into the app.
  // Do not use asar: the bundled CLI is run by Electron's Node through an absolute filesystem path.
  run("pnpm", ["dlx", "@electron/packager@19.0.1", stage, "Time Machine", "--platform=darwin", `--arch=${process.arch}`, `--electron-version=${meta.devDependencies.electron}`,
    `--app-bundle-id=${bundleId}`, `--helper-bundle-id=${bundleId}.helper`, "--app-category-type=public.app-category.developer-tools", "--darwin-dark-mode-support", "--no-asar", "--no-prune",
    `--icon=${iconPath}`, `--app-version=${meta.version}`, `--build-version=${meta.version}`, `--app-copyright=${copyright}. MIT License.`, `--out=${join(temp, "packed")}`]);
  const built = join(temp, "packed", `Time Machine-darwin-${process.arch}`, "Time Machine.app");
  // The bundle must name our icon in Info.plist and carry exactly these bytes.
  const plist = spawnSync("plutil", ["-extract", "CFBundleIconFile", "raw", "-o", "-", join(built, "Contents/Info.plist")], { encoding: "utf8" });
  const iconFile = plist.status === 0 ? plist.stdout.trim() : "";
  const bundled = iconFile && join(built, "Contents/Resources", iconFile.endsWith(".icns") ? iconFile : `${iconFile}.icns`);
  if (!bundled || !readFileSync(bundled).equals(icon)) throw new Error(`The app bundle does not use the Time Machine icon (CFBundleIconFile: ${iconFile || "missing"}).`);
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
  const sign = (path, executable) => run("codesign", codesignArgs(signer, path, executable));
  for (const path of code) sign(path, path.includes("/Contents/MacOS/") || path.endsWith("/chrome_crashpad_handler"));
  for (const path of bundles) sign(path, path.endsWith(".app"));
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", built]);
  mkdirSync(release, { recursive: true });
  // Replaces only this script's named local artifacts, never another installed app.
  rmSync(app, { recursive: true, force: true });
  renameSync(built, app);
  for (const step of finishSteps({ app, zip, notaryProfile: config.mode === "local" ? undefined : config.notaryProfile })) {
    if (step.remove) rmSync(step.remove, { force: true });
    else if (step.run) run(...step.run);
    else {
      const [command, args] = step.notarize;
      const r = spawnSync(command, args, { cwd: here, encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] });
      if (r.stdout) console.log(r.stdout.trim());
      console.log(`Notarization accepted: ${checkNotary(r.stdout ?? "", r.error ? undefined : r.status, step.profile)}`);
    }
  }
  if (config.mode === "local") {
    console.log(`Local self-signed build: ${app}\nZIP: ${zip}\nCertificate SHA-256: ${identity.sha256}\nNot signed or notarized by Apple. Gatekeeper may reject it; use the README's first-open instructions only for a build from the official repository.`);
  } else if (config.notaryProfile) {
    console.log(`Developer ID build, notarized and stapled: ${app}\nZIP of the stapled app: ${zip}\nSigned by: ${identity.name}`);
  } else {
    console.log(`Developer ID build: ${app}\nZIP: ${zip}\nSigned by: ${identity.name}\nNot notarized. Gatekeeper blocks a downloaded copy until it is. Set TM_NOTARY_PROFILE or run package:release.`);
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
