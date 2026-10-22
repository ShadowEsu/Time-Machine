#!/usr/bin/env node
// Pack the intended bounded payload, then exercise the real CLI+UI outside the workspace.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliDir = resolve(dirname(fileURLToPath(import.meta.url)), "../packages/cli");
const pkg = JSON.parse(readFileSync(join(cliDir, "package.json"), "utf8"));
const work = mkdtempSync(join(tmpdir(), "tm-pack-"));
const baseFiles = ["LICENSE", "README.md", "dist/tm.js", "package.json"];
const requiredAssets = ["index.html", "app.js", "renderer/index.js", "styles.css", "features.css", "browser.css", "agents/claude.svg", "agents/openai.svg", "agents/gemini.svg", "agents/cursor.svg"];
// An asset manifest is not an escape hatch: names, count, byte sizes and the exact tarball list are checked.
const allowedAsset = /^(?:index\.html|app\.js|renderer\/index\.js|(?:styles|features|browser)\.css|agents\/(?:claude|openai|gemini|cursor)\.svg|fonts\/[A-Za-z0-9_-]+\.(?:woff2|txt))$/;
let child;
let packed;
let files;
try {
  let npmCommand = "npm";
  let npmArgs = ["pack", "--json", "--pack-destination", work];
  if (process.platform === "win32") {
    // Avoid cmd.exe argument interpolation; invoke npm's JS entry with Node instead.
    const candidates = [process.env.npm_execpath, join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")];
    const npmCli = candidates.find((path) => path && /npm-cli\.js$/.test(path) && existsSync(path));
    assert.ok(npmCli, "Could not locate npm-cli.js; run this checker through npm or pnpm.");
    npmCommand = process.execPath;
    npmArgs = [npmCli, ...npmArgs];
  }
  [packed] = JSON.parse(execFileSync(npmCommand, npmArgs, { cwd: cliDir, encoding: "utf8" }));
  files = packed.files.map((file) => file.path).sort();
  assert.equal(packed.name, pkg.name);
  assert.equal(packed.version, pkg.version);
  const manifest = JSON.parse(readFileSync(join(cliDir, "dist/ui/asset-manifest.json"), "utf8"));
  assert.ok(Array.isArray(manifest) && manifest.length >= requiredAssets.length && manifest.length <= 128, "UI manifest count is out of bounds");
  assert.equal(new Set(manifest).size, manifest.length, "Duplicate UI assets");
  for (const asset of manifest) assert.ok(typeof asset === "string" && allowedAsset.test(asset), `Unexpected UI asset: ${asset}`);
  for (const asset of requiredAssets) assert.ok(manifest.includes(asset), `Missing required UI asset: ${asset}`);
  const expected = [...baseFiles, "dist/ui/asset-manifest.json", ...manifest.map((name) => `dist/ui/${name}`)].sort();
  assert.deepEqual(files, expected, "Tarball must contain only the intended CLI, UI assets and package documentation");
  const assetFiles = packed.files.filter((file) => file.path.startsWith("dist/ui/"));
  assert.ok(assetFiles.every((file) => file.size <= 2 * 1024 * 1024), "A UI asset exceeds 2 MiB");
  assert.ok(assetFiles.reduce((sum, file) => sum + file.size, 0) <= 10 * 1024 * 1024, "UI exceeds 10 MiB");
  execFileSync("tar", ["-xzf", join(work, packed.filename), "-C", work]);
  const unpacked = join(work, "package");
  assert.deepEqual(JSON.parse(readFileSync(join(unpacked, "dist/ui/asset-manifest.json"), "utf8")), manifest, "Packed UI manifest differs from build");
  const bin = join(unpacked, "dist/tm.js");
  const env = { ...process.env, TM_HOME: join(work, "store"), TM_UI_USER_DATA: join(work, "ui-state") };
  delete env.GEMINI_API_KEY;
  delete env.VERCEL_TOKEN;
  delete env.TM_HOOK_COMMAND;
  const run = (args) => execFileSync(process.execPath, [bin, ...args], { cwd: work, env, encoding: "utf8" });
  const version = run(["--version"]).trim();
  assert.equal(version, pkg.version);
  assert.ok(run(["--help"]).includes("ui [--port N] [--no-open]"));
  child = spawn(process.execPath, [bin, "ui", "--no-open"], { cwd: work, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let errors = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { errors += chunk; });
  const startup = AbortSignal.timeout(15_000);
  let match;
  while (!(match = output.match(/http:\/\/127\.0\.0\.1:\d+\/#token=[a-f0-9]{64}/))) {
    assert.equal(child.exitCode, null, `UI exited before listening: ${errors}`);
    await once(child.stdout, "data", { signal: startup });
  }
  const url = new URL(match[0]);
  const headers = { Authorization: `Bearer ${url.hash.slice("#token=".length)}`, Origin: url.origin, "Content-Type": "application/json" };
  const post = async (call) => {
    const response = await fetch(`${url.origin}/api/call`, { method: "POST", headers, body: JSON.stringify(call), signal: AbortSignal.timeout(120_000) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.ok, true, result.error?.message);
    return result.data;
  };
  const shell = await fetch(url.origin);
  assert.equal(shell.status, 200);
  assert.ok((await shell.text()).includes('type="module" src="app.js"'));
  for (const asset of manifest) {
    const response = await fetch(`${url.origin}/${asset}`);
    assert.equal(response.status, 200, `Unpacked UI asset ${asset} did not load`);
    assert.ok(Number(response.headers.get("content-length")) > 0);
    await response.arrayBuffer();
  }
  assert.equal((await fetch(`${url.origin}/api/call`, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"method":"bootstrap"}' })).status, 401);
  const boot = await post({ method: "bootstrap" });
  assert.equal(boot.runtime, "browser");
  assert.equal(boot.preview, false);
  const demo = await post({ method: "demo" });
  assert.ok(demo.project.id && demo.result.recover.copyDir, "Installed UI did not execute real demo recovery");
  const timeline = await post({ method: "timeline", projectId: demo.project.id });
  assert.ok(timeline.checkpoints.some((point) => point.verdict === "PASS"));
  assert.ok(timeline.checkpoints.some((point) => point.verdict === "FAIL"));
  const exit = once(child, "exit");
  child.kill("SIGINT");
  const [code] = await exit;
  assert.equal(code, 130, "UI did not use the CLI's clean interrupt exit");
  await assert.rejects(fetch(url.origin, { signal: AbortSignal.timeout(1000) }), "UI still served requests after shutdown");
  child = undefined;
  console.log(`check-cli-package: ${packed.filename} ok (${files.length} bounded files, ${packed.size} bytes packed; unpacked CLI, assets, authenticated real-engine demo and shutdown)`);
} finally {
  if (child && child.exitCode === null) {
    const exit = once(child, "exit");
    child.kill("SIGTERM");
    await exit;
  }
  rmSync(work, { recursive: true, force: true });
}
