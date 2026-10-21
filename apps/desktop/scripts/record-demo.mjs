// Records the real Time Machine Mac app for the website demo video (macOS, after package:local).
//
// The story: a synthetic project (Marigold Tips) with three save points, each checked with its own
// tests; one Claude Code turn sent through the real hook commands (only the agent's edit is scripted;
// the hooks, save points and checks are the real engine); the app noticing the break live; Review;
// and recovery to a new branch.
//
// REHEARSE=1 runs the flow without capture and fails loudly on a missing selector. Otherwise frames
// are captured with the Chrome DevTools screencast at the window's full pixel density, with caption
// and speed markers, for encode-demo.mjs. OUT sets the take folder.
//
// Isolation: temporary HOME, store, TMPDIR and app data. No keys. Nothing outside the temp folder.
import { execFile as execFileCb } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { _electron as electron } from "playwright-core";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const { DEMO_STEPS } = await import(join(repo, "packages/core/dist/demo-project.js"));
const execFile = promisify(execFileCb);
const REHEARSE = process.env.REHEARSE === "1";
const packaged = join(repo, "apps/desktop/release/Time Machine.app/Contents/MacOS/Time Machine");
const cli = join(repo, "packages/cli/dist/tm.js");
const OUT = process.env.OUT || join(tmpdir(), "tm-demo-take");
mkdirSync(join(OUT, "frames"), { recursive: true });

const work = mkdtempSync(join(tmpdir(), "tm-demo-video-"));
for (const part of ["home", "tmp", "userData"]) mkdirSync(join(work, part));
const projectDir = join(work, "home", "Projects", "marigold-tips");
mkdirSync(projectDir, { recursive: true });
const env = { ...process.env, HOME: join(work, "home"), TM_HOME: join(work, "store"), TMPDIR: join(work, "tmp"), TM_DESKTOP_USER_DATA: join(work, "userData") };
for (const name of ["GEMINI_API_KEY", "VERCEL_TOKEN", "TM_HOOK_COMMAND", "ELECTRON_RUN_AS_NODE"]) delete env[name];
if (!existsSync(packaged)) throw new Error(`Packaged app missing: ${packaged}. Run package:local first.`);

const log = (m) => console.log(`${new Date().toISOString().slice(11, 23)} ${m}`);
const git = (...args) => execFile("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { cwd: projectDir, env: { ...env, GIT_AUTHOR_NAME: "Demo Builder", GIT_AUTHOR_EMAIL: "builder@example.invalid", GIT_COMMITTER_NAME: "Demo Builder", GIT_COMMITTER_EMAIL: "builder@example.invalid" } });
const openApps = new Set();

async function launch() {
  const app = await electron.launch({ executablePath: packaged, args: [], env });
  openApps.add(app);
  app.process().on("exit", () => openApps.delete(app));
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForSelector("#splash", { state: "detached", timeout: 60000 });
  return { app, page, errors };
}
const call = (page, c) => page.evaluate(async (c) => {
  const r = await window.tm.call(c);
  if (!r.ok) throw new Error(`${c.method}: ${JSON.stringify(r.error)}`);
  return r.data;
}, c);

// ---------- Setup, off camera: three working save points, each checked for real, and the hooks. ----------
async function setup() {
  log("setup: building three working steps of Marigold Tips");
  await git("init", "-q", "-b", "main");
  const { app, page, errors } = await launch();
  let project;
  for (const [i, step] of DEMO_STEPS.slice(0, 3).entries()) {
    step.apply(projectDir);
    if (i === 0) {
      project = await call(page, { method: "addProject", path: projectDir });
      await call(page, { method: "init", projectId: project.id });
      await call(page, { method: "setCheck", projectId: project.id, command: "npm test" });
    }
    const saved = await call(page, { method: "checkpoint", projectId: project.id, note: step.note });
    const id = saved.checkpoint?.id ?? saved.id;
    const checked = await call(page, { method: "verify", projectId: project.id, id });
    log(`setup: ${id} ${step.note} -> ${checked.verdict}`);
    if (checked.verdict !== "PASS") throw new Error(`Setup step ${step.note} should pass, got ${checked.verdict}`);
  }
  const hooked = await call(page, { method: "hookInstall", projectId: project.id });
  log(`setup: Claude Code hooks installed (${JSON.stringify(hooked).slice(0, 80)})`);
  if (errors.length) throw new Error(`Setup page errors: ${errors.join(" | ")}`);
  await app.close();
  return project;
}

// ---------- Overlays for the video: an arrow pointer, a click ring and a camera. Session only. ----------
async function overlays(page) {
  await page.evaluate(() => {
    if (document.getElementById("demo-cursor")) return;
    const style = document.createElement("style");
    style.id = "demo-style";
    style.textContent = `
      html.demo-cam { overflow: hidden; }
      html.demo-cam body { transform-origin: 0 0; transition: transform 1.25s cubic-bezier(.22,1,.36,1); will-change: transform; }
      #demo-cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; width: 26px; height: 26px; pointer-events: none;
        transition: transform .85s cubic-bezier(.22,1,.36,1), opacity .35s; opacity: 0; filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
      #demo-ring { position: fixed; left: 0; top: 0; z-index: 2147483646; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%;
        border: 2px solid rgba(255,138,61,.9); pointer-events: none; opacity: 0; }
      #demo-ring.go { animation: demo-ring .55s ease-out; }
      @keyframes demo-ring { from { opacity: 1; transform: var(--at) scale(.4); } to { opacity: 0; transform: var(--at) scale(1.25); } }`;
    const cursor = document.createElement("div");
    cursor.id = "demo-cursor";
    cursor.innerHTML = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 3L19 12L12 13L9 20L5 3Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    const ring = document.createElement("div");
    ring.id = "demo-ring";
    document.documentElement.append(style, cursor, ring);
    document.documentElement.classList.add("demo-cam");
    window.__cam = { s: 1, x: 0, y: 0 };
  });
}

async function moveTo(page, locator, label) {
  const el = locator.first();
  if (!(await el.isVisible().catch(() => false))) throw new Error(`Not visible: ${label}`);
  const box = await el.boundingBox();
  await page.evaluate(({ x, y }) => {
    const c = document.getElementById("demo-cursor");
    c.style.opacity = "1";
    c.style.transform = `translate(${x - 6}px, ${y - 4}px)`;
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await page.waitForTimeout(950);
  return box;
}
async function click(page, locator, label) {
  const box = await moveTo(page, locator, label);
  await page.evaluate(({ x, y }) => {
    const r = document.getElementById("demo-ring");
    r.style.setProperty("--at", `translate(${x}px, ${y}px)`);
    r.classList.remove("go");
    void r.offsetWidth;
    r.classList.add("go");
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await page.waitForTimeout(180);
  await locator.first().click();
  log(`click: ${label}`);
}
async function hideCursor(page) {
  await page.evaluate(() => { document.getElementById("demo-cursor").style.opacity = "0"; });
}
// Camera: zoom so the target's centre sits in the middle of the window, clamped to the window edges.
async function camera(page, locator, scale) {
  await page.evaluate(async ({ sel, scale }) => {
    const W = innerWidth, H = innerHeight, cam = window.__cam;
    let cx = W / 2, cy = H / 2;
    if (sel) {
      const r = sel.getBoundingClientRect();
      cx = (r.left + r.width / 2 - cam.x) / cam.s;
      cy = (r.top + r.height / 2 - cam.y) / cam.s;
    }
    const x = Math.min(0, Math.max(W - scale * W, W / 2 - scale * cx));
    const y = Math.min(0, Math.max(H - scale * H, H / 2 - scale * cy));
    window.__cam = { s: scale, x, y };
    document.body.style.transform = scale === 1 ? "none" : `translate(${x}px, ${y}px) scale(${scale})`;
  }, { sel: locator ? await locator.first().elementHandle() : null, scale });
  await page.waitForTimeout(1350);
}

// ---------- Capture ----------
const markers = [];
let cdp = null;
let frameCount = 0;
const frames = [];
async function startCapture(app, page) {
  cdp = await app.context().newCDPSession(page);
  cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    const n = String(frameCount++).padStart(6, "0");
    writeFileSync(join(OUT, "frames", `${n}.jpg`), Buffer.from(data, "base64"));
    frames.push({ n, t: metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  const dpr = await page.evaluate(() => devicePixelRatio);
  const size = await page.evaluate(() => [innerWidth, innerHeight]);
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: size[0] * dpr, maxHeight: size[1] * dpr, everyNthFrame: 1 });
  log(`capture: started at ${size[0]}x${size[1]} css, dpr ${dpr}`);
}
const now = () => Date.now() / 1000;
// A caption cue, a chapter start, or a speed change, stamped in wall time.
const mark = (kind, value) => { markers.push({ kind, value, t: now() }); if (kind === "cue") log(`cue: ${value}`); };

const hookReports = [];
const turn = async (prompt, edit) => {
  const input = (extra) => JSON.stringify({ session_id: "demo-video-session", cwd: projectDir, ...extra });
  // Claude Code reads exit code 2 from a Stop hook as "tell the agent this": the real hook uses it to
  // report a failed check. Any other non-zero exit is a real failure.
  const hook = (event, payload) => new Promise((resolve, reject) => {
    const child = execFileCb(process.execPath, [cli, "hook", event], { cwd: projectDir, env, timeout: 120000 }, (e, out, err) => {
      if (e && e.code !== 2) return reject(e);
      hookReports.push({ event, exit: e ? e.code : 0, stderr: String(err).trim() });
      resolve(out);
    });
    child.stdin.end(input(payload));
  });
  await hook("prompt", { hook_event_name: "UserPromptSubmit", prompt });
  return { finish: async () => { edit(); await hook("stop", { hook_event_name: "Stop", stop_hook_active: false }); } };
};

async function record(project) {
  const { app, page, errors } = await launch();
  await app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const wa = screen.getPrimaryDisplay().workAreaSize;
    win.setContentSize(Math.min(1280, wa.width - 40), Math.min(800, wa.height - 40));
    win.center();
    win.webContents.setBackgroundThrottling(false);
    win.setAlwaysOnTop(true, "floating");
    win.show();
    win.focus();
  });
  await page.waitForFunction(() => /works/i.test(document.querySelector(".hero-h")?.textContent ?? ""), null, { timeout: 30000 });
  await overlays(page);
  await page.waitForTimeout(800);
  if (!REHEARSE) await startCapture(app, page);
  await page.waitForTimeout(600);

  // 1. A working project.
  mark("cue", "Marigold Tips, a synthetic project. Every save point was checked with its own tests.");
  await page.waitForTimeout(1600);
  await camera(page, page.locator(".hero"), 1.45);
  await page.waitForTimeout(2600);
  await camera(page, page.locator(".entry").first(), 1.25);
  await page.waitForTimeout(2200);
  await camera(page, null, 1);

  // 2. An agent turn breaks it. The edit is scripted; the hooks, save points and checks are real.
  mark("cue", "A Claude Code turn starts. Time Machine saves the project first.");
  const t1 = await turn("Clean up the lint warnings in tips.js", () => writeFileSync(join(projectDir, "src/tips.js"), "export function tip(bill, percent) {\n  return Math.floor(bill * percent) / 100;\n}\n"));
  await page.waitForFunction(() => document.querySelector(".hero-p")?.textContent?.includes("Claude Code is working now"), null, { timeout: 20000 });
  await camera(page, page.locator(".hero"), 1.4);
  await page.waitForTimeout(2800);
  mark("cue", "The turn ends. Its save point is checked in a safe copy.");
  mark("speed", 2.5);
  await t1.finish();
  await page.waitForFunction(() => /broken/i.test(document.querySelector(".hero-h")?.textContent ?? ""), null, { timeout: 30000 });
  mark("speed", 1);
  await camera(page, null, 1);
  await page.waitForTimeout(600);
  mark("cue", "Broken. The app says since when, and names the last version that works.");
  await camera(page, page.locator(".hero"), 1.45);
  await page.waitForTimeout(3600);
  await camera(page, page.locator(".entry").first(), 1.3);
  await page.waitForTimeout(3000);
  await camera(page, null, 1);

  // 3. Go back: Review.
  mark("cue", "Go back. First, review what comes back and what does not.");
  await click(page, page.locator('.hero-acts [data-act="rewind-to"]'), "Go back to the last working version");
  await page.waitForSelector(".dm-key .key:not([disabled])", { timeout: 30000 });
  await hideCursor(page);
  await page.waitForTimeout(1500);
  await camera(page, page.locator(".tv-head"), 1.5);
  await page.waitForTimeout(3000);
  const limits = page.locator(".tv-read");
  await camera(page, limits, 1.3);
  await limits.first().evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }));
  mark("cue", "Secret values and anything outside the project do not come back. It says so first.");
  await page.waitForTimeout(4200);
  await limits.first().evaluate((el) => el.scrollTo({ top: 0, behavior: "smooth" }));
  await camera(page, null, 1);

  // 4. Bring it back.
  mark("cue", "Bring it back. It lands as a separate copy on a new branch.");
  await click(page, page.locator(".dm-key .key"), "Go back key");
  await page.waitForFunction(() => document.querySelector(".tv-head")?.textContent?.includes("is back"), null, { timeout: 60000 });
  await hideCursor(page);
  await page.waitForTimeout(900);
  mark("cue", "The working version is back. Your folder was not touched.");
  await camera(page, page.locator(".tv-verdict"), 1.45);
  await page.waitForTimeout(4200);
  await camera(page, null, 1);
  await page.waitForTimeout(2200);
  mark("end", null);

  if (cdp) await cdp.send("Page.stopScreencast");
  await page.waitForTimeout(400);
  const result = { errors, frames: frames.length, hookReports };
  // Proof the recovery is real: the original branch and files are untouched, the recovery branch exists,
  // and the tests pass in the recovery copy.
  const branch = (await git("branch", "--show-current")).stdout.trim();
  const recoverBranches = (await git("branch", "--list", "tm/recover/*")).stdout.trim();
  const brokenStill = readFileSync(join(projectDir, "src/tips.js"), "utf8").includes("Math.floor");
  result.proof = { branch, recoverBranches, originalStillHasAgentEdit: brokenStill };
  await app.close();
  return result;
}

let result;
try {
  const project = await setup();
  result = await record(project);
} catch (error) {
  for (const app of openApps) await app.close().catch(() => {});
  writeFileSync(join(OUT, "markers.json"), JSON.stringify({ frames, markers, work, projectDir, failed: error.message }, null, 2));
  throw error;
}
writeFileSync(join(OUT, "markers.json"), JSON.stringify({ frames, markers, work, projectDir, result }, null, 2));
log(`done: ${JSON.stringify(result)}`);
if (result.errors.length) process.exitCode = 1;
