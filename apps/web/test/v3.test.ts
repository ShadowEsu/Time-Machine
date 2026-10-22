// App v3: the Rewind dial's geometry and the agent channels. No Electron needed.
import { describe, expect, test } from "vitest";
import type { AgentRow } from "../src/shared/api.ts";
import { when } from "../src/shared/format.ts";
import { claudeChannel, PLANNED_AGENTS } from "../src/renderer/channels.ts";
import { DIAL_SPAN, DIAL_START, dialAngle, dialIndex } from "../src/renderer/dial.ts";

describe("rewind dial", () => {
  test("detents spread over 270 degrees, oldest at the lower left, newest at the lower right", () => {
    expect(dialAngle(0, 6)).toBe(DIAL_START);
    expect(dialAngle(5, 6)).toBe(DIAL_START + DIAL_SPAN);
    expect(dialAngle(0, 1)).toBe(0);
  });

  test("a pointer lands on the nearest detent, and past either end it stays at that end", () => {
    // Straight up is the middle of the arc.
    expect(dialIndex(0, -100, 7)).toBe(3);
    // Lower left is the oldest, lower right the newest.
    expect(dialIndex(-100, 100, 7)).toBe(0);
    expect(dialIndex(100, 100, 7)).toBe(6);
    // Straight down is past both ends: it clamps, never wraps around.
    expect(dialIndex(1, 100, 7)).toBe(6);
    expect(dialIndex(-1, 100, 7)).toBe(0);
    // Every detent can be reached at its own angle.
    for (let i = 0; i < 9; i++) {
      const a = (dialAngle(i, 9) * Math.PI) / 180;
      expect(dialIndex(Math.sin(a) * 100, -Math.cos(a) * 100, 9)).toBe(i);
    }
  });
});

describe("agent channels", () => {
  const row = (over: Partial<AgentRow>): AgentRow => ({
    projectId: "p1", name: "marigold-tips", claudeCode: "connected", settingsPath: "/x/.claude/settings.json", missing: [], working: false, workingSince: null, ...over,
  });
  const now = new Date(2026, 9, 16, 18, 0);
  const at = (h: number, m: number): string => new Date(2026, 9, 16, h, m).toISOString();

  test("Claude Code says working only while a turn is open, with when it started", () => {
    const ch = claudeChannel([row({ working: true, workingSince: at(17, 40) })], new Map(), now);
    expect(ch.state).toBe("working");
    expect(ch.line).toBe(`Working in marigold-tips since ${when(at(17, 40), now)}.`);
  });

  test("idle names the last turn from the audit log, or says none was recorded", () => {
    expect(claudeChannel([row({})], new Map([["p1", at(16, 2)]]), now).line).toBe(`Idle. Last turn ended ${when(at(16, 2), now)} in marigold-tips.`);
    expect(claudeChannel([row({})], new Map(), now).line).toBe("Connected to marigold-tips. No turn recorded yet.");
  });

  test("without hooks it is not connected, and never invents activity", () => {
    const ch = claudeChannel([row({ claudeCode: "not-connected" })], new Map([["p1", at(16, 2)]]), now);
    expect(ch.state).toBe("not-connected");
    expect(ch.line).not.toMatch(/Working|Idle|turn/);
    expect(claudeChannel([], new Map(), now).line).toBe("Add a project first.");
  });

  test("Codex, Gemini CLI and Cursor are planned, not connected", () => {
    expect(PLANNED_AGENTS.map((a) => a.name)).toEqual(["Codex", "Gemini CLI", "Cursor"]);
  });
});
