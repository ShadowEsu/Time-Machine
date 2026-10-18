// V12: human and JSON output agree. V14 (CLI side): host mode is always labeled.
import { beforeAll, describe, expect, test } from "vitest";
import { setupDemo, type Demo } from "../../../fixtures/demo/setup.ts";
import { main } from "../src/main.ts";

interface Run { code: number; out: string; err: string }
async function run(demo: Demo, ...argv: string[]): Promise<Run> {
  let out = "";
  let err = "";
  const code = await main(argv, {
    cwd: demo.dir,
    env: demo.ctx.env ?? {},
    stdout: (s) => { out += s; },
    stderr: (s) => { err += s; },
    isTTY: false,
  });
  return { code, out, err };
}

let demo: Demo;
beforeAll(async () => {
  demo = await setupDemo();
});

describe("CLI output", () => {
  test("V12 verify: human and JSON agree on verdict, isolation and exit code", async () => {
    for (const id of ["cp-0003", "cp-0004"]) {
      const human = await run(demo, "verify", id);
      const json = await run(demo, "verify", id, "--json");
      const parsed = JSON.parse(json.out) as { verdict: string; isolation: string; checkpoint: string };
      expect(human.code).toBe(json.code);
      expect(human.out).toContain(parsed.verdict);
      expect(human.out).toContain(parsed.checkpoint);
      expect(human.out).toContain(`${parsed.isolation} mode`);
    }
  });

  test("V12 timeline: every checkpoint in JSON appears in human output with its verdict", async () => {
    const human = await run(demo, "timeline");
    const json = JSON.parse((await run(demo, "timeline", "--json")).out) as { checkpoints: { id: string; note: string; verdict: string | null }[] };
    expect(json.checkpoints).toHaveLength(6);
    for (const c of json.checkpoints) {
      const line = human.out.split("\n").find((l) => l.includes(c.id));
      expect(line).toBeDefined();
      expect(line).toContain(c.verdict ?? "not checked");
      expect(line).toContain(c.note);
    }
  });

  test("V14 a host mode PASS says host mode in plain output", async () => {
    const r = await run(demo, "verify", "cp-0002");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/PASS.*host mode/);
  });

  test("usage errors exit 64, never 2", async () => {
    expect((await run(demo, "nope")).code).toBe(64);
    expect((await run(demo, "verify", "--bogus")).code).toBe(64);
  });
});
