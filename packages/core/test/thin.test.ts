// Thinning old auto saves: only save points with trigger "auto" can go. Working (PASS), pinned, named,
// noted, recovery-linked, newest 20 and last-24-hour save points always stay.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import * as tm from "@timetm/core";
import { tempDir } from "../../../fixtures/demo/setup.ts";

const DAY = 86_400_000;

interface History {
  ctx: tm.Ctx;
  store: string;
}

/** A plain folder with 33 save points: auto saves, plus one manual, one PASS, one pinned, one named and a recovery. */
async function history(): Promise<History> {
  const root = tempDir("thin");
  const dir = join(root, "notes");
  const store = join(root, "store");
  const ctx: tm.Ctx = { cwd: dir, tmHome: store, env: { ...process.env, TM_HOME: store } };
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "draft.md"), "v0\n");
  tm.protect(ctx);
  for (let i = 1; i <= 32; i++) {
    writeFileSync(join(dir, "draft.md"), `version ${i}\n`);
    await tm.checkpoint(ctx, i === 2 ? { note: "Saved by you", trigger: "app" } : { note: "Auto save", trigger: "auto" });
  }
  await tm.setCheck(ctx, "test -f draft.md");
  expect((await tm.verify(ctx, "cp-0003")).verdict).toBe("PASS");
  tm.setNote(ctx, { id: "cp-0004", pinned: true });
  tm.setNote(ctx, { id: "cp-0005", title: "Before the big rewrite" });
  const r = await tm.recover(ctx, "cp-0006"); // also saves cp-0033, trigger recover
  await tm.undoRecover(ctx, { id: r.id, branch: "", copyDir: r.copyDir });
  return { ctx, store: tm.storeDirFor(ctx) };
}

describe("thinning auto saves", () => {
  let h: History;
  beforeAll(async () => {
    h = await history();
  });

  test("nothing from the last 24 hours goes", () => {
    expect(tm.thinPreview(h.ctx).remove).toEqual([]);
  });

  test("ten days on: only old auto saves go; PASS, pinned, named, recovery-linked, manual and the newest 20 stay", async () => {
    const now = Date.now() + 10 * DAY;
    const p = tm.thinPreview(h.ctx, { now });
    const gone = p.remove.map((r) => r.id);
    const t = await tm.timeline(h.ctx);
    const byId = new Map(t.checkpoints.map((c) => [c.id, c]));
    expect(gone.length).toBeGreaterThan(5);
    for (const id of ["cp-0002", "cp-0003", "cp-0004", "cp-0005", "cp-0006"]) expect(gone).not.toContain(id);
    for (const c of t.checkpoints.slice(-20)) expect(gone).not.toContain(c.id);
    for (const id of gone) expect(byId.get(id)?.trigger).toBe("auto");
    expect(p.keep).toBe(t.checkpoints.length - gone.length);
    expect(p.bytesFreed).toBeGreaterThan(0);
    expect(p.remove[0]).toMatchObject({ id: expect.stringMatching(/^cp-/), at: expect.any(String), reason: expect.stringMatching(/same day/) });
  });

  test("apply refuses a stale or foreign id and removes nothing", async () => {
    const now = Date.now() + 10 * DAY;
    const before = (await tm.timeline(h.ctx)).checkpoints.length;
    await expect(tm.thinApply(h.ctx, ["cp-0003"], { now })).rejects.toThrow(/cp-0003 can't be thinned/);
    await expect(tm.thinApply(h.ctx, ["cp-0099"], { now })).rejects.toThrow(/cp-0099 can't be thinned/);
    expect((await tm.timeline(h.ctx)).checkpoints).toHaveLength(before);
  });

  test("apply removes exactly the previewed save points; the kept ones still diff and recover", async () => {
    const now = Date.now() + 10 * DAY;
    const ids = tm.thinPreview(h.ctx, { now }).remove.map((r) => r.id);
    expect(await tm.thinApply(h.ctx, ids, { now })).toEqual({ removed: ids.length });
    for (const id of ids) {
      expect(existsSync(join(h.store, "checkpoints", `${id}.json`))).toBe(false);
      expect(existsSync(join(h.store, "bundles", `${id}.bundle`))).toBe(false);
    }
    const kept = (await tm.timeline(h.ctx)).checkpoints;
    expect(kept.map((c) => c.id)).not.toEqual(expect.arrayContaining(ids));
    expect(kept.every((c) => c.verdict !== "ERROR")).toBe(true);
    expect(kept.find((c) => c.id === "cp-0003")?.verdict).toBe("PASS");
    expect((await tm.diff(h.ctx, "cp-0003", "cp-0005")).files.changed).toEqual(["draft.md"]);
    // A second preview has nothing left to thin (before the recovery below adds a newer save point).
    expect(tm.thinPreview(h.ctx, { now }).remove).toEqual([]);
    const r = await tm.recover(h.ctx, "cp-0005");
    expect(readFileSync(join(r.copyDir, "draft.md"), "utf8")).toBe("version 5\n");
    expect(tm.notes(h.ctx)["cp-0004"]?.pinned).toBe(true);
    expect((await tm.log(h.ctx)).entries.some((e) => e.action === "thin")).toBe(true);
  });
});

/** 30 auto saves of one file. cp-0004 and cp-0005 hold the same bytes, and so do cp-0006 and the newest, cp-0030. */
async function sharedHistory(): Promise<History> {
  const root = tempDir("thin-shared");
  const dir = join(root, "notes");
  const store = join(root, "store");
  const ctx: tm.Ctx = { cwd: dir, tmHome: store, env: { ...process.env, TM_HOME: store } };
  mkdirSync(dir, { recursive: true });
  tm.protect(ctx);
  for (let i = 1; i <= 30; i++) {
    writeFileSync(join(dir, "draft.md"), i === 4 || i === 5 ? "shared by 4 and 5\n" : i === 6 || i === 30 ? "shared by 6 and 30\n" : `version ${i}\n`);
    await tm.checkpoint(ctx, { note: "Auto save", trigger: "auto" });
  }
  return { ctx, store: tm.storeDirFor(ctx) };
}

describe("thinning never deletes a saved file a kept save point needs", () => {
  let h: History;
  beforeAll(async () => {
    h = await sharedHistory();
  });

  test("while a save point can't be read, the preview names it and apply removes nothing", async () => {
    const now = Date.now() + 10 * DAY;
    const manifest = join(h.store, "checkpoints", "cp-0005.json");
    chmodSync(manifest, 0o000); // any read error or failed integrity check does the same
    try {
      const p = tm.thinPreview(h.ctx, { now });
      expect(p.unreadable).toEqual(["cp-0005"]);
      const ids = p.remove.map((r) => r.id);
      expect(ids).toContain("cp-0004");
      await expect(tm.thinApply(h.ctx, ids, { now })).rejects.toThrow("cp-0005 can't be read; nothing was removed");
    } finally {
      chmodSync(manifest, 0o400);
    }
    expect((await tm.timeline(h.ctx)).checkpoints).toHaveLength(30);
    const r = await tm.recover(h.ctx, "cp-0005");
    expect(readFileSync(join(r.copyDir, "draft.md"), "utf8")).toBe("shared by 4 and 5\n");
  });

  test("a saved file shared by a removed and a kept save point survives, and the kept one recovers whole", async () => {
    const now = Date.now() + 10 * DAY;
    const p = tm.thinPreview(h.ctx, { now });
    expect(p.unreadable).toEqual([]);
    const ids = p.remove.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(["cp-0004", "cp-0006"]));
    expect(ids).not.toContain("cp-0005");
    expect(ids).not.toContain("cp-0030");
    expect(await tm.thinApply(h.ctx, ids, { now })).toEqual({ removed: ids.length });
    for (const [id, text] of [["cp-0005", "shared by 4 and 5\n"], ["cp-0030", "shared by 6 and 30\n"]] as const) {
      const r = await tm.recover(h.ctx, id);
      expect(readFileSync(join(r.copyDir, "draft.md"), "utf8")).toBe(text);
      expect(r.notRestored.join("\n")).not.toMatch(/saved copy is missing/);
    }
  });
});
