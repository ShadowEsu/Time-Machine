// Real packaged-app regression, macOS only. Run package:local first. No network or real projects.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";

const work = mkdtempSync(join(tmpdir(), "tm-native-smoke-"));
for (const part of ["home", "tmp", "userData"]) mkdirSync(join(work, part));
const app = await electron.launch({
  executablePath: resolve(dirname(fileURLToPath(import.meta.url)), "../release/Time Machine.app/Contents/MacOS/Time Machine"),
  args: [],
  env: { ...process.env, HOME: join(work, "home"), TM_HOME: join(work, "store"), TMPDIR: join(work, "tmp"), TM_DESKTOP_USER_DATA: join(work, "userData"), TM_DESKTOP_TEST: "1" },
});
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
  await page.click(".dm-key .key");
  await page.waitForFunction(() => document.querySelector(".tv-head")?.textContent?.includes("is back"));
  assert.deepEqual([git("branch", "--show-current"), git("rev-parse", "HEAD"), git("status", "--porcelain")], before);
  assert.equal(git("branch", "--list", "tm/recover/*").replace(/^\+\s*/, ""), "tm/recover/cp-0003");
  assert(await announcer.evaluate(el => el === document.getElementById("app-announcements")), "Announcements must survive redraws");
  assert.match(await page.locator("#app-announcements").innerText(), /is back/);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(work, "recovery.png") });
  console.log(`PASS: demo Broken state, modal focus, nested focus return, persistent announcements, recovery and untouched source. Evidence: ${work}`);
} finally {
  await app.close();
}
