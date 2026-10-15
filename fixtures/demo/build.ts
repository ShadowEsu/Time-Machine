// Synthetic demo project: "Marigold Tips", a tiny TypeScript app.
// Checkpoints 1 to 3 work. Then an agent "fixes lint" and breaks rounding,
// someone changes a config value, and a dependency gets added.
// All data is synthetic. The secret below is fake and never valid anywhere.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const FAKE_SECRET = "sk_test_51SyntheticDemoKeyDoNotUse0000000000";
export const FAKE_TOKEN = "ghp_SyntheticDemoTokenDoNotUse000000000000";

export interface DemoStep {
  note: string;
  expect: "PASS" | "FAIL";
  apply: (dir: string) => void;
}

const GIT_ENV = {
  GIT_AUTHOR_NAME: "Demo Builder",
  GIT_AUTHOR_EMAIL: "builder@example.invalid",
  GIT_COMMITTER_NAME: "Demo Builder",
  GIT_COMMITTER_EMAIL: "builder@example.invalid",
};

export function git(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
    cwd: dir,
    env: { ...process.env, ...GIT_ENV },
    encoding: "utf8",
  }).trim();
}

export function write(dir: string, path: string, content: string): void {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function commit(dir: string, message: string, paths: string[] = ["-A"]): void {
  git(dir, "add", ...paths);
  git(dir, "commit", "-q", "-m", message);
}

const TIPS_OK = `export function tip(bill: number, percent: number): number {
  return Math.round(bill * percent) / 100;
}
`;

const TIPS_BROKEN = `export function tip(bill: number, percent: number): number {
  return Math.floor(bill * percent) / 100;
}
`;

export const DEMO_STEPS: DemoStep[] = [
  {
    note: "Initial tip calculator",
    expect: "PASS",
    apply: (dir) => {
      write(dir, "package.json", JSON.stringify({ name: "marigold-tips", private: true, type: "module", scripts: { test: "node --test" } }, null, 2) + "\n");
      write(dir, ".gitignore", "node_modules/\n.env\n");
      write(dir, ".env", `PORT=3000\nSTRIPE_SECRET_KEY=${FAKE_SECRET}\n`);
      write(dir, "config/app.json", JSON.stringify({ currency: "USD" }, null, 2) + "\n");
      write(dir, "src/tips.ts", TIPS_OK);
      write(dir, "test/tips.test.ts", `import { test } from "node:test";
import assert from "node:assert/strict";
import { tip } from "../src/tips.ts";

test("tip rounds to the nearest cent", () => {
  assert.equal(tip(10.05, 15), 1.51);
});
`);
      commit(dir, "Initial tip calculator");
    },
  },
  {
    note: "Added split bill",
    expect: "PASS",
    apply: (dir) => {
      write(dir, "src/split.ts", `export function split(total: number, people: number): number {
  return Math.round((total / people) * 100) / 100;
}
`);
      write(dir, "test/split.test.ts", `import { test } from "node:test";
import assert from "node:assert/strict";
import { split } from "../src/split.ts";

test("split divides evenly", () => {
  assert.equal(split(30, 4), 7.5);
});
`);
      commit(dir, "Added split bill");
    },
  },
  {
    note: "Added dark mode",
    expect: "PASS",
    apply: (dir) => {
      write(dir, "src/theme.ts", `import { readFileSync } from "node:fs";

export function themes(): string[] {
  return JSON.parse(readFileSync(new URL("../data/themes.json", import.meta.url), "utf8")) as string[];
}
`);
      write(dir, "test/theme.test.ts", `import { test } from "node:test";
import assert from "node:assert/strict";
import { themes } from "../src/theme.ts";

test("dark mode exists", () => {
  assert.ok(themes().includes("dark"));
});
`);
      commit(dir, "Added dark mode", ["src/theme.ts", "test/theme.test.ts"]);
      // The agent created this data file but never committed it.
      write(dir, "data/themes.json", JSON.stringify(["light", "dark"]) + "\n");
    },
  },
  {
    note: "Agent: fixed lint warnings",
    expect: "FAIL",
    apply: (dir) => {
      write(dir, "src/tips.ts", TIPS_BROKEN);
      commit(dir, "Fix lint warnings", ["src/tips.ts"]);
    },
  },
  {
    note: "Changed currency",
    expect: "FAIL",
    apply: (dir) => {
      write(dir, "config/app.json", JSON.stringify({ currency: "EUR" }, null, 2) + "\n");
      commit(dir, "Change currency to EUR", ["config/app.json"]);
    },
  },
  {
    note: "Added a dependency",
    expect: "FAIL",
    apply: (dir) => {
      write(dir, "package.json", JSON.stringify({ name: "marigold-tips", private: true, type: "module", scripts: { test: "node --test" }, dependencies: { "left-pad": "1.3.0" } }, null, 2) + "\n");
      write(dir, "package-lock.json", JSON.stringify({ name: "marigold-tips", lockfileVersion: 3, packages: { "node_modules/left-pad": { version: "1.3.0" } } }, null, 2) + "\n");
      commit(dir, "Add left-pad", ["package.json", "package-lock.json"]);
    },
  },
];

/** Creates the demo repo in `dir`. Calls `afterStep` after each step so a test can save a checkpoint. */
export async function buildDemo(dir: string, afterStep?: (step: DemoStep, index: number) => Promise<void> | void): Promise<void> {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  for (const [i, step] of DEMO_STEPS.entries()) {
    step.apply(dir);
    await afterStep?.(step, i);
  }
}
