#!/usr/bin/env node
// Checks the npm package exactly as `npm publish` would ship it. Run after `pnpm build`.
// Packs packages/cli into a temporary folder, requires the documented file list, unpacks the
// tarball outside the workspace (no node_modules to fall back on) and runs the bundled CLI.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliDir = resolve(dirname(fileURLToPath(import.meta.url)), "../packages/cli");
const pkg = JSON.parse(readFileSync(join(cliDir, "package.json"), "utf8"));
const expected = ["LICENSE", "README.md", "dist/tm.js", "package.json"];
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const work = mkdtempSync(join(tmpdir(), "tm-pack-"));

const fail = (message) => {
  console.error(`check-cli-package: ${message}`);
  process.exitCode = 1;
};

try {
  const [packed] = JSON.parse(execFileSync(npm, ["pack", "--json", "--pack-destination", work], { cwd: cliDir, encoding: "utf8" }));
  const files = packed.files.map((f) => f.path).sort();
  if (packed.name !== pkg.name || packed.version !== pkg.version) fail(`packed ${packed.name}@${packed.version}, expected ${pkg.name}@${pkg.version}`);
  if (files.join("\n") !== expected.join("\n")) fail(`tarball files are [${files.join(", ")}], expected [${expected.join(", ")}]`);

  execFileSync("tar", ["-xzf", join(work, packed.filename), "-C", work]);
  const bin = join(work, "package", "dist", "tm.js");
  const run = (args) => execFileSync(process.execPath, [bin, ...args], { cwd: work, encoding: "utf8" });
  const version = run(["--version"]).trim();
  if (version !== pkg.version) fail(`tm --version printed "${version}", expected "${pkg.version}"`);
  if (!run(["--help"]).includes("--version")) fail("tm --help did not print usage");

  if (!process.exitCode) console.log(`check-cli-package: ${packed.filename} ok (${files.length} files, ${packed.size} bytes packed, tm --version ${version})`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
