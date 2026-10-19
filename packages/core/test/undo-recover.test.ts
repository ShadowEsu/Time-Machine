// D04: undo a recovery. It removes only what the recovery made, and only while it is untouched.
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import * as tm from "@timetm/core";
import { git, write } from "../../../fixtures/demo/build.ts";
import { setupDemo, snapshotState } from "../../../fixtures/demo/setup.ts";

const hasBranch = (dir: string, b: string): boolean => git(dir, "branch", "--list", b).trim() !== "";

describe("undoRecover", () => {
  test("removes the recovery branch and copy, keeps every save point, and never touches the folder", async () => {
    const { dir, ctx } = await setupDemo();
    const r = await tm.recover(ctx, "cp-0003");
    const before = snapshotState(dir);
    const ids = (await tm.timeline(ctx)).checkpoints.map((c) => c.id);

    const u = await tm.undoRecover(ctx, { id: r.id, branch: r.branch, copyDir: r.copyDir });

    expect(u).toEqual({ id: "cp-0003", removedBranch: r.branch, removedCopy: r.copyDir });
    expect(hasBranch(dir, r.branch)).toBe(false);
    expect(existsSync(r.copyDir)).toBe(false);
    expect((await tm.timeline(ctx)).checkpoints.map((c) => c.id)).toEqual(ids);
    expect(ids).toContain(r.savedBefore);
    expect({ ...snapshotState(dir), branches: undefined }).toEqual({ ...before, branches: undefined });
    expect((await tm.log(ctx)).entries.at(-1)?.action).toBe("undo-recover");
  });

  test("refuses when the recovery copy has changes, and leaves it alone", async () => {
    const { ctx } = await setupDemo();
    const r = await tm.recover(ctx, "cp-0003");
    write(r.copyDir, "src/tips.js", "export const mine = 1;\n");
    await expect(tm.undoRecover(ctx, { id: r.id, branch: r.branch, copyDir: r.copyDir })).rejects.toThrow(/changes/i);
    expect(existsSync(join(r.copyDir, "src/tips.js"))).toBe(true);
    expect(hasBranch(ctx.cwd, r.branch)).toBe(true);
  });

  test("refuses when the branch has new commits", async () => {
    const { ctx } = await setupDemo();
    const r = await tm.recover(ctx, "cp-0003");
    git(r.copyDir, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "my work");
    await expect(tm.undoRecover(ctx, { id: r.id, branch: r.branch, copyDir: r.copyDir })).rejects.toThrow(/new commits/i);
    expect(hasBranch(ctx.cwd, r.branch)).toBe(true);
    expect(existsSync(r.copyDir)).toBe(true);
  });

  test("removes the branch when the person already deleted the recovery copy by hand", async () => {
    const { dir, ctx } = await setupDemo();
    const r = await tm.recover(ctx, "cp-0003");
    rmSync(r.copyDir, { recursive: true, force: true });

    const u = await tm.undoRecover(ctx, { id: r.id, branch: r.branch, copyDir: r.copyDir });

    expect(u).toEqual({ id: "cp-0003", removedBranch: r.branch, removedCopy: null });
    expect(hasBranch(dir, r.branch)).toBe(false);
    expect(git(dir, "worktree", "list", "--porcelain")).not.toContain(r.copyDir);
  });

  test("only removes branches that a recovery of that save point made", async () => {
    const { ctx } = await setupDemo();
    await tm.recover(ctx, "cp-0003");
    await expect(tm.undoRecover(ctx, { id: "cp-0003", branch: "main", copyDir: "/tmp/x" })).rejects.toThrow(/recovery branch/i);
    expect(hasBranch(ctx.cwd, "main")).toBe(true);
  });
});
