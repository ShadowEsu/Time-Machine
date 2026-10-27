// The repo's copy rules (CLAUDE.md, docs/BUILD_BRIEF.md) on the night build's new screens: no banned claims, no em dashes,
// and research or trial-run words never turn into health or clinical claims.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { plainNotSaved, shortSkip } from "../src/renderer/coverage.ts";
import { welcomeWords } from "../src/renderer/first-run.ts";
import { noteBlock } from "../src/renderer/runs.ts";

const dir = join(import.meta.dirname, "../src/renderer");
const files = ["overview.ts", "purpose.ts", "add-flow.ts", "plan.ts", "sources.ts", "runs.ts"];

describe("copy rules on the new screens", () => {
  for (const f of files) {
    test(f, () => {
      const text = readFileSync(join(dir, f), "utf8");
      expect(text).not.toContain("—");
      expect(text).not.toMatch(/guaranteed|undo anything|replays any app|zero setup|enterprise ready/i);
      expect(text).not.toMatch(/clinical|patient|diagnos|HIPAA|medical/i);
    });
  }
});

describe("plain words in every renderer file", () => {
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
    test(f, () => {
      const text = readFileSync(join(dir, f), "utf8");
      expect(text).not.toContain("\u2014");
      // No Please, and no softeners: "simply", "easy", or "just" before a verb ("just now" and "just before" are times).
      expect(text).not.toMatch(/\b(please|simply|easy|easily)\b/i);
      expect(text).not.toMatch(/\bjust (save|do|use|press|click|open|add|type|pick)\b/i);
      // One word for every copy the app makes (writer#35), and no desktop app: tm ui is a browser app (dev#28).
      expect(text).not.toMatch(/safe cop(y|ies)|recovery cop(y|ies)|desktop app/i);
    });
  }
});

// A documents or research project hears no code words (writer#24): no agent, tests, branch or deploys on its screens.
describe("folder words on a project that is not code", () => {
  const code = /\b(agent|tests?|branch|commit|deploy(ed|s)?)\b/i;

  test("Welcome's How it works and Good to know", () => {
    const plain = welcomeWords(false, "this Mac");
    for (const line of [...plain.how.flat(), ...plain.know]) expect(line).not.toMatch(code);
    const withCode = welcomeWords(true, "this Mac");
    expect(withCode.how.flat().join(" ")).toMatch(/agent/);
  });

  test("what is not saved", () => {
    const engine = "Databases, deployed versions and external services are not captured";
    expect(plainNotSaved(engine, false)).toBe("Files over the size limit, secrets files, and files you cannot read");
    expect(plainNotSaved(engine, false)).not.toMatch(code);
    expect(plainNotSaved(engine, true)).toBe("Database contents, anything already deployed, and changes in other services");
  });

  test("a skip reason in a toast drops the settings path, which the detail keeps", () => {
    expect(shortSkip("interview.wav: over the 5 MB limit (capture.maxFileMB in /Users/x/.timemachine/projects/ab/timemachine.yml)")).toBe("interview.wav: over the 5 MB limit");
    expect(shortSkip("notes/secret: could not be read")).toBe("notes/secret: could not be read");
  });

  test("the name field's example", () => {
    const html = noteBlock("cp-0001", undefined, { id: "cp-0001", title: "", note: "" }, "documents", false);
    expect(html).toContain('placeholder="for example: Draft before advisor notes"');
  });
});
