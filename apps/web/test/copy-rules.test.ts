// The repo's copy rules (CLAUDE.md, docs/BUILD_BRIEF.md) on the night build's new screens: no banned claims, no em dashes,
// and research or trial-run words never turn into health or clinical claims.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

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
    });
  }
});
