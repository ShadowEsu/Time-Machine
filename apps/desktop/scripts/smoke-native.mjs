// Real packaged-app regression, macOS only. Run package:local first. No network or real projects.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";

const work = mkdtempSync(join(tmpdir(), "tm-native-smoke-"));
for (const part of ["home", "tmp", "userData"]) mkdirSync(join(work, part));
const executablePath = resolve(dirname(fileURLToPath(import.meta.url)), "../release/Time Machine.app/Contents/MacOS/Time Machine");
// Keys and a hook command from this shell must not reach the app: the run stays offline and isolated.
const env = { ...process.env, HOME: join(work, "home"), TM_HOME: join(work, "store"), TMPDIR: join(work, "tmp"), TM_DESKTOP_USER_DATA: join(work, "userData"), TM_DESKTOP_TEST: "1" };
for (const name of ["GEMINI_API_KEY", "VERCEL_TOKEN", "TM_HOOK_COMMAND"]) delete env[name];
const app = await electron.launch({ executablePath, args: [], env });
let closed = false;
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const modalContainsFocus = () => page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].filter(el => !el.closest(".leave"));
    return dialogs.at(-1)?.contains(document.activeElement) ?? false;
  });
  await page.waitForSelector("#splash", { state: "detached" });
  const announcer = await page.locator("#app-announcements").elementHandle();
  await page.locator('.welcome [data-act="demo"]').focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector('[aria-labelledby="demo-title"]');
  await page.keyboard.press("Tab");
  assert(await modalContainsFocus(), "The busy demo must contain keyboard focus");
  await page.waitForSelector(".dm-key .key:not([disabled])", { timeout: 120000 });
  await page.keyboard.press("Escape");
  // This assertion fails if the newly saved pre-recovery state is never checked in the background.
  await page.waitForFunction(() => /Broken/.test(document.querySelector(".hero-h")?.textContent ?? ""), null, { timeout: 15000 });
  assert.match(await page.locator(".entry .said").first().innerText(), /Failed/);

  await page.locator('[data-act="palette"]').focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector(".pal-q");
  for (const key of ["Shift+Tab", "Tab"]) {
    await page.keyboard.press(key);
    assert(await modalContainsFocus(), "Tab must not reach the background");
  }
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-act")), "palette");

  const projects = JSON.parse(readFileSync(join(work, "userData/projects.json"), "utf8")).projects;
  const git = (...args) => execFileSync("git", args, { cwd: projects[0].path, encoding: "utf8" }).trim();
  const before = [git("branch", "--show-current"), git("rev-parse", "HEAD"), git("status", "--porcelain")];
  await page.click('.hero-acts [data-act="rewind-to"]');
  await page.waitForSelector(".dm-key .key:not([disabled])");
  await page.keyboard.press("Meta+k");
  await page.waitForSelector(".pal-q");
  await page.keyboard.press("Escape");
  assert(await modalContainsFocus(), "Closing a nested dialog must return to Rewind");
  // At the minimum window size, keyboard users must be able to read every recovery limit.
  const windowSize = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const size = win.getContentSize();
    win.setContentSize(960, 640);
    return size;
  });
  // setContentSize returns before the renderer relays out; PageDown on the old layout scrolls nothing.
  await page.waitForFunction(() => innerWidth === 960 && innerHeight === 640);
  await page.waitForFunction(() => { const r = document.querySelector(".tv-read"); return !!r && r.scrollHeight > r.clientHeight; });
  await page.locator(".tv-read").focus();
  assert(await page.locator(".tv-read").evaluate(el => el === document.activeElement), "Recovery limits must be keyboard-focusable");
  await page.keyboard.press("PageDown");
  await page.waitForFunction(() => document.querySelector(".tv-read")?.scrollTop > 0);
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), windowSize);
  await page.click(".dm-key .key");
  await page.waitForFunction(() => document.querySelector(".tv-head")?.textContent?.includes("is back"));
  assert.deepEqual([git("branch", "--show-current"), git("rev-parse", "HEAD"), git("status", "--porcelain")], before);
  assert.equal(git("branch", "--list", "tm/recover/*").replace(/^\+\s*/, ""), "tm/recover/cp-0003");
  assert(await announcer.evaluate(el => el === document.getElementById("app-announcements")), "Announcements must survive redraws");
  assert.match(await page.locator("#app-announcements").innerText(), /is back/);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(work, "recovery.png") });

  // A second launch with the same data hands over to the running copy and exits.
  const second = spawnSync(executablePath, [], { env, timeout: 30000 });
  assert.equal(second.status, 0, `A second copy must exit at once (status ${second.status}, signal ${second.signal})`);
  assert(!page.isClosed(), "The first copy must keep running");

  // A save point made from the terminal shows up in the open window by itself, without a reload.
  await page.keyboard.press("Escape");
  writeFileSync(join(projects[0].path, "terminal-note.txt"), "saved from the terminal\n");
  const cli = resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/cli/dist/tm.js");
  const made = JSON.parse(execFileSync(process.execPath, [cli, "checkpoint", "-m", "Saved from the terminal", "--json"], { cwd: projects[0].path, env, encoding: "utf8" }));
  const liveId = made.checkpoint.id;
  await page.waitForSelector(`#e-${liveId}`, { timeout: 15000 });
  assert.match(await page.locator(`#e-${liveId}`).innerText(), /Saved from the terminal/);
  await page.screenshot({ path: join(work, "live-update.png") });

  // A Claude Code turn from another process shows up live: working while it runs, then its save point.
  // The hook lines run `<tm> hook prompt` and `<tm> hook stop` in the project with Claude Code's JSON on stdin.
  const installed = await page.evaluate(projectId => window.tm.call({ method: "hookInstall", projectId }), projects[0].id);
  assert(installed.ok, `The app's own bundled hook command must install: ${JSON.stringify(installed)}`);
  const hook = (event, payload) => execFileSync(process.execPath, [cli, "hook", event], { cwd: projects[0].path, env, input: JSON.stringify({ session_id: "smoke-session", cwd: projects[0].path, ...payload }), encoding: "utf8", timeout: 120000 });
  hook("prompt", { hook_event_name: "UserPromptSubmit", prompt: "Add a tip slider" });
  const agentWorking = () => page.evaluate(() => ({
    pill: !!document.querySelector(".side .it.ag .breath"),
    hero: document.querySelector(".hero-p")?.textContent?.includes("Claude Code is working now") ?? false,
  }));
  await page.waitForFunction(() => !!document.querySelector(".side .it.ag .breath") && !!document.querySelector(".hero-p")?.textContent?.includes("Claude Code is working now"), null, { timeout: 15000 });
  // The agent edits a file during its turn, so the stop hook saves a new point instead of reusing the last one.
  writeFileSync(join(projects[0].path, "src/slider.js"), "export const slider = { min: 0, max: 30 };\n");
  // Every save point after the break holds the broken rounding, so the check fails and no earlier PASS is the newest checked one: exit 0.
  hook("stop", { hook_event_name: "Stop", stop_hook_active: false });
  const turn = JSON.parse(execFileSync(process.execPath, [cli, "timeline", "--json"], { cwd: projects[0].path, env, encoding: "utf8" })).checkpoints.at(-1);
  assert.equal(turn.trigger, "claude-code:stop");
  assert.deepEqual(turn.agent, { name: "Claude Code", prompt: "Add a tip slider" });
  assert.equal(turn.verdict, "FAIL");
  await page.waitForFunction(id => !!document.querySelector(`#e-${id} .meta .vb.v-fail`) && !document.querySelector(".side .it.ag .breath"), turn.id, { timeout: 15000 });
  assert.equal(await page.locator(`#e-${turn.id} .e-t`).innerText(), "Add a tip slider");
  assert.match(await page.locator(`#e-${turn.id} .meta .chip`).innerText(), /Claude Code/);
  assert.deepEqual(await agentWorking(), { pill: false, hero: false }, "The working state must clear when the turn ends");
  await page.waitForFunction(() => document.querySelector(".side .it.ag")?.getAttribute("title")?.includes("Last turn ended"), null, { timeout: 15000 });
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(work, "agent-live.png") });

  // Quitting while a check runs stops the check and removes its temporary copy.
  const slow = `sleep ${4000 + Math.floor(Math.random() * 900)}`;
  const running = () => {
    try {
      return execFileSync("pgrep", ["-f", slow], { encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  };
  const call = c => page.evaluate(c => window.tm.call(c), c);
  assert((await call({ method: "setCheck", projectId: projects[0].id, command: slow })).ok);
  const saved = await call({ method: "checkpoint", projectId: projects[0].id, note: "Smoke: slow check" });
  assert(saved.ok, JSON.stringify(saved));
  void call({ method: "verify", projectId: projects[0].id, id: saved.data.checkpoint.id }).catch(() => {});
  for (let i = 0; i < 100 && !running(); i++) await new Promise(r => setTimeout(r, 100));
  assert(running(), "The slow check must start");
  closed = true;
  await app.close();
  for (let i = 0; i < 40 && running(); i++) await new Promise(r => setTimeout(r, 100));
  const left = running();
  if (left) execFileSync("pkill", ["-f", slow]);
  assert.equal(left, "", "Quitting must stop a running check");
  assert.deepEqual(readdirSync(join(work, "tmp")).filter(n => n.startsWith("tm-verify-")), [], "Quitting must remove the check's temporary copy");
  console.log(`PASS: demo Broken state, modal focus, nested focus return, persistent announcements, recovery, untouched source, single copy, terminal save point shown live, Claude Code turn shown live (working, then its checked save point), and no check left after quit. Evidence: ${work}`);
} finally {
  if (!closed) await app.close();
}
