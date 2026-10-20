import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import * as tm from "@timetm/core";
import { git, write } from "../../../fixtures/demo/build.ts";
import { tempDir, writeConfig } from "../../../fixtures/demo/setup.ts";
import { resolveProject } from "../src/project.ts";
import { withLock } from "../src/store.ts";

// Takes the store lock the way withLock lays it out on disk, then either dies hard or holds it.
const TAKE_LOCK = `
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const [lock, token, mode] = process.argv.slice(1);
fs.mkdirSync(lock);
fs.writeFileSync(path.join(lock, "owner"), JSON.stringify({ pid: process.pid, host: os.hostname(), token }));
if (mode === "hold") { process.stdout.write("held\\n"); setInterval(() => {}, 1000); }
else process.kill(process.pid, "SIGKILL");
`;

async function project(): Promise<{ ctx: tm.Ctx; store: string; lock: string }> {
  const root = tempDir("lock");
  const dir = join(root, "app");
  mkdirSync(dir);
  git(dir, "init", "-q");
  write(dir, "a.txt", "one\n");
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "first");
  writeConfig(dir);
  const tmHome = join(root, "store");
  const ctx: tm.Ctx = { cwd: dir, tmHome, env: { ...process.env, TM_HOME: tmHome } };
  await tm.checkpoint(ctx, { note: "first" });
  const store = tm.storeDirFor(ctx);
  return { ctx, store, lock: join(store, "lock") };
}

const leftovers = (store: string): string[] => readdirSync(store).filter((n) => n.startsWith("lock"));
// The lock is shared with a real child process and polled against the real clock, so fake timers
// cannot drive it. A waiter that should NOT get the lock has no event to await; a short real wait is the check.
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A pid that existed a moment ago and is gone now. */
function deadPid(): number {
  const r = spawnSync(process.execPath, ["-e", ""]);
  if (!r.pid) throw new Error("could not start a child process");
  return r.pid;
}

describe("store lock", () => {
  test("a lock left by a killed command is taken back at once", async () => {
    const { ctx, store, lock } = await project();
    const child = spawnSync(process.execPath, ["-e", TAKE_LOCK, lock, "killed-token"]);
    expect(child.signal).toBe("SIGKILL");
    expect(existsSync(join(lock, "owner"))).toBe(true);

    write(ctx.cwd, "a.txt", "two\n");
    const started = Date.now();
    const r = await tm.checkpoint(ctx, { note: "retry" });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(r.checkpoint.id).toBe("cp-0002");
    expect(leftovers(store)).toEqual([]);
  });

  test("a lock held by a running command is not taken", async () => {
    const { ctx, store, lock } = await project();
    const child = spawn(process.execPath, ["-e", TAKE_LOCK, lock, "live-token", "hold"], { stdio: ["ignore", "pipe", "inherit"] });
    try {
      await once(child.stdout, "data");
      let settled = false;
      write(ctx.cwd, "a.txt", "two\n");
      const pending = tm.checkpoint(ctx, { note: "waits" }).finally(() => {
        settled = true;
      });
      await sleep(1_500);
      expect(settled).toBe(false);
      expect(JSON.parse(readFileSync(join(lock, "owner"), "utf8"))).toMatchObject({ token: "live-token" });

      // Once the holder dies, the waiter takes over without the two minute wait.
      child.kill("SIGKILL");
      const r = await pending;
      expect(r.checkpoint.id).toBe("cp-0002");
      expect(leftovers(store)).toEqual([]);
    } finally {
      child.kill("SIGKILL");
    }
  });

  const cases: { name: string; owner?: () => { pid: number; host: string; token: string } }[] = [
    { name: "no owner file (an older version, or a crash before the owner was written)" },
    { name: "an owner on another machine", owner: () => ({ pid: deadPid(), host: `not-${hostname()}`, token: "remote" }) },
    { name: "an owner this user may not signal", owner: () => ({ pid: 1, host: hostname(), token: "other-user" }) },
  ];
  test.each(cases)("a fresh lock with $name is left alone", async ({ owner }) => {
    const { ctx, lock } = await project();
    mkdirSync(lock);
    const body = owner ? JSON.stringify(owner()) : null;
    if (body) writeFileSync(join(lock, "owner"), body);

    let settled = false;
    const pending = tm.checkpoint(ctx, { note: "waits" }).then(
      () => (settled = true),
      () => (settled = true),
    );
    await sleep(1_000);
    expect(settled).toBe(false);
    expect(existsSync(lock)).toBe(true);
    if (body) expect(readFileSync(join(lock, "owner"), "utf8")).toBe(body);

    rmSync(lock, { recursive: true, force: true });
    await pending;
  });

  test("withLock records its owner and only removes its own lock", async () => {
    const { ctx, lock } = await project();
    const p = resolveProject(ctx);
    const owner: unknown = await withLock(p, async () => JSON.parse(readFileSync(join(lock, "owner"), "utf8")));
    expect(owner).toEqual({ pid: process.pid, host: hostname(), token: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(existsSync(lock)).toBe(false);

    // If another command took the lock over meanwhile, releasing must not delete theirs.
    await withLock(p, async () => {
      writeFileSync(join(lock, "owner"), JSON.stringify({ pid: process.pid, host: hostname(), token: "someone-else" }));
    });
    expect(existsSync(lock)).toBe(true);
    rmSync(lock, { recursive: true, force: true });
  });
});
