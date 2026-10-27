// Put it back while something else writes (Security R1, PoC 44a0f4d): an edit that lands after the save made first and
// before the write is never overwritten, and a file that appears there in that gap is never replaced.
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, type Stats } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import * as tm from "@timetm/core";
import { tempDir } from "../../../fixtures/demo/setup.ts";

const hook: { after?: () => void; frozen?: Stats } = {};
// A coarse clock (HFS+, exFAT): the file's stat after a same-size edit reads exactly as before it (Security A4).
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  const fstatSync = ((...args: Parameters<typeof real.fstatSync>) => {
    const st = real.fstatSync(...args);
    return hook.frozen && "ino" in st && st.ino === hook.frozen.ino ? hook.frozen : st;
  }) as typeof real.fstatSync;
  return { ...real, default: { ...real, fstatSync }, fstatSync };
});
vi.mock("../src/folder.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/folder.ts")>();
  return {
    ...real,
    checkpoint: async (...args: Parameters<typeof real.checkpoint>) => {
      const r = await real.checkpoint(...args);
      // An agent writes in the gap between the save made first and the restore's write.
      if (args[1]?.trigger === "before-restore") hook.after?.();
      return r;
    },
  };
});

function thesis(name: string): { root: string; dir: string; ctx: tm.Ctx } {
  const root = tempDir(name);
  const dir = join(root, "Thesis");
  const home = join(root, "store");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "chapter-1.md"), "# One\n");
  writeFileSync(join(dir, "chapter-2.md"), "# Two\n");
  const ctx: tm.Ctx = { cwd: dir, tmHome: home, env: { ...process.env, TM_HOME: home } };
  tm.protect(ctx);
  return { root, dir, ctx };
}

describe("putting a file back while something else writes", () => {
  test("an edit made after the save first is kept in the folder, named as skipped, and the other files still come back", async () => {
    const { dir, ctx } = thesis("restore-race");
    await tm.checkpoint(ctx, { note: "first" });
    writeFileSync(join(dir, "chapter-1.md"), "user edit\n");
    writeFileSync(join(dir, "chapter-2.md"), "broken\n");
    // The same size as the edit it replaces, so only the bytes (or a fine clock) tell them apart (Security N1).
    hook.after = () => writeFileSync(join(dir, "chapter-1.md"), "AGENT EDT\n");

    const r = await tm.restorePaths(ctx, "cp-0001", ["chapter-1.md", "chapter-2.md"]);
    hook.after = undefined;
    expect(readFileSync(join(dir, "chapter-1.md"), "utf8")).toBe("AGENT EDT\n");
    expect(r.restored).toEqual(["chapter-2.md"]);
    expect(r.skipped).toEqual(["chapter-1.md: it changed while putting back, so it was not replaced"]);
    expect(readFileSync(join(dir, "chapter-2.md"), "utf8")).toBe("# Two\n");
  });

  test("a same-size edit the clock can't see is still never overwritten: the bytes are compared", async () => {
    const { dir, ctx } = thesis("restore-race-tick");
    await tm.checkpoint(ctx, { note: "first" });
    const file = join(dir, "chapter-1.md");
    writeFileSync(file, "user edit\n");
    hook.after = () => {
      const before = statSync(file);
      writeFileSync(file, "AGENT EDT\n");
      hook.frozen = before;
    };
    const r = await tm.restorePaths(ctx, "cp-0001", ["chapter-1.md"]);
    hook.after = undefined;
    hook.frozen = undefined;
    expect(readFileSync(file, "utf8")).toBe("AGENT EDT\n");
    expect(r.skipped).toEqual(["chapter-1.md: it changed while putting back, so it was not replaced"]);
  });

  test("a file that appears where the save point has one, after the save first, is never replaced", async () => {
    const { dir, ctx } = thesis("restore-race-added");
    writeFileSync(join(dir, "appendix.md"), "# Appendix\n");
    await tm.checkpoint(ctx, { note: "with appendix" });
    rmSync(join(dir, "appendix.md"));
    hook.after = () => writeFileSync(join(dir, "appendix.md"), "AGENT WROTE THIS\n");

    const r = await tm.restorePaths(ctx, "cp-0001", ["appendix.md"]);
    hook.after = undefined;
    expect(readFileSync(join(dir, "appendix.md"), "utf8")).toBe("AGENT WROTE THIS\n");
    expect(r.restored).toEqual([]);
    expect(r.skipped).toEqual(["appendix.md: a file appeared there while putting back, so it was not replaced"]);
  });
});
