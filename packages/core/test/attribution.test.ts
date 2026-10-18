// Agent attribution: each save point records which agent and prompt made it.
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import * as tm from "@timetm/core";
import { FAKE_TOKEN, write } from "../../../fixtures/demo/build.ts";
import { setupDemo } from "../../../fixtures/demo/setup.ts";

const manifestPath = (ctx: tm.Ctx, id: string): string => join(tm.storeDirFor(ctx), "checkpoints", `${id}.json`);
const entryOf = async (ctx: tm.Ctx, id: string): Promise<tm.TimelineEntry | undefined> => (await tm.timeline(ctx)).checkpoints.find((c) => c.id === id);

describe("agent attribution", () => {
  test("the prompt hook records the agent and its prompt, clipped to one line", async () => {
    const { dir, ctx } = await setupDemo();
    write(dir, "draft.txt", "x\n");
    const long = `Add dark mode\n\n to the settings page ${"and more ".repeat(30)}`;
    const r = await tm.runHook(ctx, "prompt", { cwd: dir, prompt: long });
    expect(r.checkpoint).toBe("cp-0007");
    const e = await entryOf(ctx, "cp-0007");
    expect(e?.agent?.name).toBe("Claude Code");
    expect(e?.agent?.prompt).toMatch(/^Add dark mode to the settings page and more/);
    expect(e?.agent?.prompt).not.toContain("\n");
    expect((e?.agent?.prompt ?? "").length).toBeLessThanOrEqual(120);
  });

  test("a secret looking prompt is never stored, in the manifest or the timeline", async () => {
    const { dir, ctx } = await setupDemo();
    write(dir, "draft.txt", "x\n");
    await tm.runHook(ctx, "prompt", { cwd: dir, prompt: `deploy with ${FAKE_TOKEN} now` });
    expect(readFileSync(manifestPath(ctx, "cp-0007"), "utf8")).not.toContain(FAKE_TOKEN);
    const e = await entryOf(ctx, "cp-0007");
    expect(e?.agent?.name).toBe("Claude Code");
    expect(e?.agent?.prompt).toMatch(/hidden/);
    expect(JSON.stringify(await tm.timeline(ctx))).not.toContain(FAKE_TOKEN);
  });

  test("the save point at the end of a turn carries the turn's prompt, even when nothing changed before it", async () => {
    const { dir, ctx } = await setupDemo();
    const before = await tm.runHook(ctx, "prompt", { cwd: dir, prompt: "add a footer" });
    expect(before.checkpoint).toBeNull();
    write(dir, "src/footer.js", "export const footer = 1;\n");
    const after = await tm.runHook(ctx, "stop", { cwd: dir });
    expect(after.checkpoint).toBe("cp-0007");
    const e = await entryOf(ctx, "cp-0007");
    expect(e?.agent).toEqual({ name: "Claude Code", prompt: "add a footer" });
  });

  test("the agent is derived from the trigger: MCP is an agent, the app and the CLI are a person", async () => {
    const { dir, ctx } = await setupDemo();
    write(dir, "a.txt", "1\n");
    await tm.checkpoint(ctx, { trigger: "mcp" });
    write(dir, "a.txt", "2\n");
    await tm.checkpoint(ctx, { trigger: "app" });
    expect((await entryOf(ctx, "cp-0007"))?.agent).toEqual({ name: "MCP agent" });
    expect((await entryOf(ctx, "cp-0008"))?.agent).toBeNull();
  });

  test("old manifests without an agent still load, and an added agent breaks the seal", async () => {
    const { ctx } = await setupDemo();
    const raw = readFileSync(manifestPath(ctx, "cp-0002"), "utf8");
    expect(raw).not.toContain('"agent"');
    const e = await entryOf(ctx, "cp-0002");
    expect(e?.agent).toBeNull();
    expect(e?.verdict).toBeNull();

    const path = manifestPath(ctx, "cp-0003");
    const m = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    chmodSync(path, 0o644);
    writeFileSync(path, JSON.stringify({ ...m, agent: { name: "Claude Code", prompt: "forged" } }));
    expect((await entryOf(ctx, "cp-0003"))?.verdict).toBe("ERROR");
  });
});
