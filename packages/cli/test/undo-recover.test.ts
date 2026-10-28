// tm recover --undo: the CLI side of the app's "Undo this rewind". It finds the recovery by save point, branch
// or copy folder, removes only that recovery's branch and copy, and refuses to guess between several.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { git } from "../../../fixtures/demo/build.ts";
import { setupDemo, type Demo } from "../../../fixtures/demo/setup.ts";
import { main } from "../src/main.ts";

interface Run { code: number; out: string; err: string }
async function run(demo: Demo, ...argv: string[]): Promise<Run> {
  let out = "";
  let err = "";
  const code = await main(argv, { cwd: demo.dir, env: demo.ctx.env ?? {}, stdout: (s) => { out += s; }, stderr: (s) => { err += s; }, isTTY: false });
  return { code, out, err };
}
async function recover(demo: Demo, id: string): Promise<{ branch: string; copyDir: string }> {
  const r = await run(demo, "recover", id, "--json");
  expect(r.code).toBe(0);
  return JSON.parse(r.out) as { branch: string; copyDir: string };
}
const branches = (demo: Demo): string => git(demo.dir, "branch", "--list", "tm/recover/*").trim();
const count = async (demo: Demo): Promise<number> => (JSON.parse((await run(demo, "timeline", "--json")).out) as { checkpoints: unknown[] }).checkpoints.length;

describe("tm recover --undo", () => {
  test("by save point: removes that recovery's branch and copy, keeps the folder, its branch and every save point", async () => {
    const demo = await setupDemo();
    const r = await recover(demo, "cp-0003");
    const head = git(demo.dir, "rev-parse", "--abbrev-ref", "HEAD").trim();
    const app = readFileSync(join(demo.dir, "timemachine.yml"), "utf8");
    const saves = await count(demo);

    const u = await run(demo, "recover", "--undo", "cp-0003");
    expect(u.code).toBe(0);
    expect(u.out).toContain("Undid the recovery of cp-0003.");
    expect(u.out).toContain(`Removed branch  ${r.branch}`);
    expect(branches(demo)).toBe("");
    expect(existsSync(r.copyDir)).toBe(false);
    expect(git(demo.dir, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe(head);
    expect(readFileSync(join(demo.dir, "timemachine.yml"), "utf8")).toBe(app);
    expect(await count(demo)).toBe(saves);

    const again = await run(demo, "recover", "--undo", "cp-0003");
    expect(again.code).toBe(4);
    expect(again.err).toContain("There is no recovery of cp-0003 to undo.");
  });

  test("two recoveries of one save point: refuses to guess, lists both, and undoes the one named by branch or copy folder", async () => {
    const demo = await setupDemo();
    const first = await recover(demo, "cp-0003");
    const second = await recover(demo, "cp-0003");
    expect(second.branch).not.toBe(first.branch);

    const ambiguous = await run(demo, "recover", "--undo", "cp-0003");
    expect(ambiguous.code).toBe(64);
    expect(ambiguous.err).toContain("cp-0003 has 2 recoveries");
    expect(ambiguous.err).toContain(first.branch);
    expect(ambiguous.err).toContain(second.branch);
    expect(branches(demo)).toContain(first.branch);

    const byBranch = await run(demo, "recover", "--undo", second.branch, "--json");
    expect(byBranch.code).toBe(0);
    expect(JSON.parse(byBranch.out)).toMatchObject({ id: "cp-0003", removedBranch: second.branch });
    expect(existsSync(second.copyDir)).toBe(false);
    expect(existsSync(first.copyDir)).toBe(true);

    const byCopy = await run(demo, "recover", "--undo", first.copyDir);
    expect(byCopy.code).toBe(0);
    expect(byCopy.out).toContain("Removed copy");
    expect(existsSync(first.copyDir)).toBe(false);
    expect(branches(demo)).toBe("");
  });

  test("--to does not apply with --undo", async () => {
    const demo = await setupDemo();
    const r = await run(demo, "recover", "--undo", "cp-0003", "--to", demo.dir);
    expect(r.code).toBe(64);
    expect(r.err).toContain("--to does not apply with --undo.");
  });
});
