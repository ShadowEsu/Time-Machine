// Run notes: a title, a note and a pin on a save point, for research and trial runs. Kept in a sidecar
// file in the project's store, never in a save point and never in the project folder.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import * as tm from "@timetm/core";
import { setupDemo } from "../../../fixtures/demo/setup.ts";

describe("run notes", () => {
  test("set, merge, pin and clear notes; stored only in the store, written atomically", async () => {
    const { ctx, dir } = await setupDemo();
    const store = tm.storeDirFor(ctx);
    expect(tm.notes(ctx)).toEqual({});

    const first = tm.setNote(ctx, { id: "cp-0003", title: "  Baseline run, seed 42 ", note: "Reference run." });
    expect(first).toMatchObject({ title: "Baseline run, seed 42", note: "Reference run.", pinned: false });
    expect(Date.parse(first.updated)).not.toBeNaN();

    // Leaving a field out keeps it.
    expect(tm.setNote(ctx, { id: "cp-0003", pinned: true })).toMatchObject({ title: "Baseline run, seed 42", note: "Reference run.", pinned: true });
    expect(tm.setNote(ctx, { id: "cp-0005", note: "Currency changed." })).toMatchObject({ note: "Currency changed.", pinned: false });
    expect(Object.keys(tm.notes(ctx)).sort()).toEqual(["cp-0003", "cp-0005"]);

    // An empty title and note, unpinned, removes the note.
    tm.setNote(ctx, { id: "cp-0005", note: "" });
    expect(Object.keys(tm.notes(ctx))).toEqual(["cp-0003"]);

    const saved = JSON.parse(readFileSync(join(store, "notes.json"), "utf8")) as unknown;
    expect(saved).toMatchObject({ version: 1, notes: { "cp-0003": { pinned: true } } });
    expect(readdirSync(store).filter((f) => f.includes(".tmp"))).toEqual([]);
    expect(existsSync(join(dir, "notes.json"))).toBe(false);
    // The save point itself is unchanged: its manifest still passes its integrity check.
    expect((await tm.timeline(ctx)).checkpoints.find((c) => c.id === "cp-0003")?.verdict).not.toBe("ERROR");
  });

  test("refuses long text, unknown save points and text that looks like a secret", async () => {
    const { ctx } = await setupDemo();
    expect(() => tm.setNote(ctx, { id: "cp-0001", title: "x".repeat(81) })).toThrow(/80/);
    expect(() => tm.setNote(ctx, { id: "cp-0001", note: "x".repeat(2001) })).toThrow(/2000/);
    expect(() => tm.setNote(ctx, { id: "cp-0099", title: "Missing" })).toThrow(/no checkpoint cp-0099/);
    expect(() => tm.setNote(ctx, { id: "../x", title: "Bad" })).toThrow(/not a checkpoint ID/);
    expect(() => tm.setNote(ctx, { id: "cp-0001", note: "key sk-live-4f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c" })).toThrow(/secret/);
    expect(tm.notes(ctx)).toEqual({});
  });

  test("a damaged notes file is reported, not silently replaced", async () => {
    const { ctx } = await setupDemo();
    writeFileSync(join(tm.storeDirFor(ctx), "notes.json"), "{not json");
    expect(() => tm.notes(ctx)).toThrow(/damaged/);
    expect(() => tm.setNote(ctx, { id: "cp-0001", title: "x" })).toThrow(/damaged/);
  });
});
