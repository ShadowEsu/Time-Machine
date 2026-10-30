import { describe, expect, test } from "vitest";
import type { ProjectEntry, ProjectStatus } from "../src/shared/api.ts";
import { esc, verdictWord, when } from "../src/shared/format.ts";
import { activityStrip, digest, digestLine, overviewPage, reportLine, saveState, spread, type DigestPoint, type OverviewInput } from "../src/renderer/overview.ts";
import { checkRecommended, hasCheck, kindLabel, projectMeta, unitCount } from "../src/renderer/purpose.ts";

const now = new Date(2026, 9, 25, 7, 0).getTime();
const hoursAgo = (h: number): string => new Date(now - h * 3_600_000).toISOString();
const pt = (n: number, h: number, verdict: DigestPoint["verdict"], agent = false): DigestPoint => ({
  id: `cp-${String(n).padStart(4, "0")}`, createdAt: hoursAgo(h), verdict, agent: agent ? { name: "Claude Code", prompt: "fix it" } : null,
});

describe("since you last looked", () => {
  test("counts only the window, and a break only where a pass turned into a fail", () => {
    const pts = [pt(1, 20, "PASS"), pt(2, 11, null, true), pt(3, 10, "FAIL", true), pt(4, 6, "PASS"), pt(5, 2, "FAIL", true), pt(6, 1, "FAIL")];
    const d = digest(pts, now, 12);
    expect(d.saves).toBe(5);
    expect(d.checked).toBe(4);
    expect(d.works).toBe(1);
    // cp-3 broke after cp-1 passed (outside the window, still the one before it); cp-5 broke after cp-4; cp-6 was already broken.
    expect(d.breaks).toBe(2);
    expect(d.agentSaves).toBe(3);
    expect(d.agents).toEqual(["Claude Code"]);
    expect(d.lastWorking?.id).toBe("cp-0004");
    expect(d.newest?.id).toBe("cp-0006");
  });

  test("a quiet day says so, and nothing older counts", () => {
    const d = digest([pt(1, 30, "PASS")], now);
    expect(d.saves).toBe(0);
    expect(d.lastWorking?.id).toBe("cp-0001");
    expect(digestLine(d, "code")).toBe("Quiet in the last 24 hours.");
    expect(reportLine([{ name: "a", d, checks: true }])).toBe("Quiet. Nothing was saved in the last 24 hours.");
  });

  test("the headline adds up every project, and speaks of checks only for projects that have one", () => {
    const broke = { name: "app", d: digest([pt(1, 3, "PASS"), pt(2, 2, "FAIL")], now), checks: true };
    const unchecked = { name: "pricing-page", d: digest([pt(1, 4, null), pt(2, 1, null)], now), checks: true };
    const folder = { name: "thesis-notes", d: digest([pt(1, 5, null), pt(2, 3, null), pt(3, 2, null), pt(4, 1, null)], now), checks: false };
    expect(reportLine([broke, unchecked])).toBe("4 saves in the last 24 hours across 2 projects. Broke once, shown below.");
    expect(reportLine([unchecked, folder])).toBe("6 saves in the last 24 hours across 2 projects. pricing-page has 2 not checked yet.");
    expect(reportLine([folder])).toBe("4 saves in the last 24 hours.");
    expect(reportLine([{ name: "app", d: digest([pt(1, 3, "PASS")], now), checks: true }, folder])).toBe("5 saves in the last 24 hours across 2 projects. Nothing broke.");
    expect(reportLine([unchecked, { ...unchecked, name: "site" }])).toBe("4 saves in the last 24 hours across 2 projects. 2 projects have saves not checked yet.");
  });

  test("research says runs, and an agent that made every save is named once", () => {
    const d = digest([pt(1, 3, "PASS", true), pt(2, 2, "FAIL", true)], now);
    expect(digestLine(d, "research")).toBe("2 runs, 2 checked. Broke once. Claude Code made all of them.");
    expect(digestLine(d, "documents", () => "“Swapped the loader”")).toBe("2 save points, 2 checked. Broke once, at “Swapped the loader”. Claude Code made all of them.");
  });

  test("a break is named once, with true counts of the save points since that fail (the demo's shape)", () => {
    const d = digest([pt(1, 6, null), pt(2, 5, null), pt(3, 4, "PASS"), pt(4, 3, "FAIL"), pt(5, 3, "FAIL"), pt(6, 2, "FAIL"), pt(7, 1, "FAIL")], now);
    expect(d.breaks).toBe(1);
    expect(d.brokeAt?.id).toBe("cp-0004");
    expect(digestLine(d, "code", () => "“Agent: fixed lint warnings”")).toBe("7 save points, 5 checked. Broke once, at “Agent: fixed lint warnings”; the 3 save points since fail their check.");
    const mixed = digest([pt(1, 4, "PASS"), pt(2, 3, "FAIL"), pt(3, 2, null), pt(4, 1, "FAIL")], now);
    expect(digestLine(mixed, "code", () => "x")).toBe("4 save points, 3 checked. Broke once, at x; 1 of the 2 save points since fails its check.");
  });

  test("a project that can't be read is said by name, never counted as a quiet day (writer#3)", () => {
    expect(reportLine([], 24, (n) => n, ["Thesis"])).toBe("Can’t read Thesis right now.");
    expect(reportLine([{ name: "shop", d: digest([pt(1, 1, null)], now), checks: false }], 24, (n) => n, ["Thesis", "big"])).toBe("1 save in the last 24 hours. Can’t read 2 projects right now.");
    const html = page({ projects: [entry("a", "Thesis", "folder", "documents")], timelines: new Map([["a", "error"]]) });
    expect(html).toContain("Can’t read");
    expect(html).not.toContain("Quiet.");
  });

  test("Needs something counts as not checked (cli#10)", () => {
    const d = digest([pt(1, 1, "BLOCKED"), pt(2, 1, "BLOCKED"), pt(3, 1, "PASS")], now);
    expect(d.checked).toBe(1);
    expect(digest([pt(1, 1, "BLOCKED")], now).everChecked).toBe(false);
  });
});

describe("purpose words", () => {
  test("units, kinds and which purposes need a check", () => {
    expect(unitCount("research", 1)).toBe("1 run");
    expect(unitCount("code", 3)).toBe("3 save points");
    expect(kindLabel("folder")).toBe("Folder");
    expect(kindLabel("git")).toBe("Git project");
    expect(checkRecommended("code")).toBe(true);
    for (const p of ["documents", "research", "agents", "other"] as const) expect(checkRecommended(p)).toBe(false);
  });
});

const entry = (id: string, name: string, kind: ProjectEntry["kind"], purpose: ProjectEntry["purpose"]): ProjectEntry => ({
  id, path: `/Users/you/${name}`, name, addedAt: "2026-10-24T00:00:00Z", demo: false, features: { ask: false, vercel: null, autoSave: "off" }, kind, purpose,
});
const status = (id: string, newest: DigestPoint | null): ProjectStatus => ({ projectId: id, newest: newest && { id: newest.id, verdict: newest.verdict, createdAt: newest.createdAt }, lastWorking: null, problem: null, problemKind: null });
const page = (over: Partial<OverviewInput>): string => overviewPage({
  projects: [], statuses: new Map(), timelines: new Map(), checks: new Set(), now, badge: (v) => `<span class="vb">${verdictWord(v)}</span>`, freeLimit: 3, enter: "", ...over,
});

describe("project cards", () => {
  test("the meta line names the kind once for code, and the purpose for everything else", () => {
    expect(projectMeta({ kind: "git", purpose: "code" })).toBe("Git project");
    expect(projectMeta({ kind: "folder", purpose: "documents" })).toBe("Folder · Documents and notes");
    expect(projectMeta({ kind: "folder", purpose: "research" })).toBe("Folder · Research and experiments");
    expect(projectMeta({ kind: "folder", purpose: "agents" })).toBe("Folder · AI agent workspace");
  });

  test("a project has a check when a command is set now; until that is read, when it has ever been checked", () => {
    expect(hasCheck(false, true)).toBe(false);
    expect(hasCheck(true, false)).toBe(true);
    expect(hasCheck(null, true)).toBe(true);
    expect(hasCheck(null, false)).toBe(false);
  });

  test("a project with no check shows when it was saved, never Not checked yet, and says not checked nowhere", () => {
    const p = entry("a", "thesis-notes", "folder", "documents");
    const last = pt(1, 2, null);
    const html = page({ projects: [p], statuses: new Map([["a", status("a", last)]]), timelines: new Map([["a", [last]]]) });
    expect(saveState(last, now)).toBe(`Saved ${when(last.createdAt, new Date(now))}`);
    expect(saveState(null, now)).toBe("Nothing saved yet");
    expect(html).toContain(esc(saveState(last, now)));
    expect(html).not.toContain("Not checked yet");
    expect(html).not.toMatch(/not checked|None of them checked/i);
    // A code project keeps its verdict badge.
    const c = entry("b", "pricing-page", "git", "code");
    const code = page({ projects: [c], statuses: new Map([["b", status("b", last)]]), timelines: new Map([["b", [last]]]), checks: new Set(["b"]) });
    expect(code).toContain("Not checked yet");
  });

  test("while a project's status and history read, its card holds quiet bars, never a made-up state", () => {
    const html = page({ projects: [entry("a", "thesis-notes", "folder", "documents")] });
    expect(html).toContain('class="sk ov-sk-pill"');
    expect(html).toContain('class="ov-wait"');
    expect(html).toContain("Reading your history…");
    expect(html).not.toContain("Nothing saved yet");
  });

  test("a project's name in the headline is one unbreakable piece, escaped like the rest", () => {
    const last = pt(1, 2, null);
    const html = page({ projects: [entry("b", "pricing-page", "git", "code")], statuses: new Map([["b", status("b", last)]]), timelines: new Map([["b", [last]]]), checks: new Set(["b"]) });
    expect(html).toContain('<span class="ov-nm">pricing-page</span> has 1 not checked yet.');
    const odd = page({ projects: [entry("c", "a<b>", "git", "code")], statuses: new Map([["c", status("c", last)]]), timelines: new Map([["c", [last]]]), checks: new Set(["c"]) });
    expect(odd).toContain('<span class="ov-nm">a&lt;b&gt;</span>');
  });

  test("the activity strip puts the last 24 hours on an axis, with 6 hour ticks and a now end", () => {
    const html = activityStrip([pt(1, 30, "PASS"), pt(2, 18, "PASS"), pt(3, 6, "FAIL"), pt(4, 1, null)], now);
    // Only the three inside the window, each as its verdict, placed by time.
    expect(html.match(/class="ovs-dot /g)).toHaveLength(3);
    expect(html).toContain('class="ovs-dot b-pass" style="--x:25%;');
    expect(html).toContain('class="ovs-dot b-fail" style="--x:75%;');
    expect(html).toMatch(/class="ovs-dot b-none" style="--x:95\.8\d*%;/);
    expect(html.match(/class="ovs-tick"/g)).toHaveLength(5);
    expect(html).toContain(">now<");
    expect(html).toContain('aria-label="Last 24 hours: 3 save points. 1 works, 1 broken, 1 not checked."');
    expect(activityStrip([], now)).toContain('aria-label="Last 24 hours: nothing saved."');
  });

  test("the strip zooms to the last hour or 6 hours when that is where everything happened", () => {
    const min = (m: number): number => m / 60;
    const hour = activityStrip([pt(1, min(40), null), pt(2, min(10), null)], now);
    expect(hour).toContain(">1h ago<");
    expect(hour.match(/class="ovs-tick"/g)).toHaveLength(5);
    expect(hour).toContain('aria-label="Last hour: 2 save points. 2 not checked."');
    const six = activityStrip([pt(1, 5, null), pt(2, 2, null)], now);
    expect(six).toContain(">6h ago<");
    expect(six).toContain("Last 6 hours:");
    expect(activityStrip([pt(1, 7, null)], now)).toContain(">24h ago<");
  });

  test("dots never sit on top of each other", () => {
    const xs = spread([100, 100, 100, 99.9, 50], 4);
    const sorted = [...xs].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(4 - 1e-9);
    expect(Math.max(...xs)).toBeLessThanOrEqual(100);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    // Too many to fit: they share the axis evenly instead of leaving it.
    const many = spread(Array.from({ length: 40 }, () => 100), 4);
    expect(Math.min(...many)).toBeGreaterThanOrEqual(0);
    expect(new Set(many.map((x) => x.toFixed(3))).size).toBe(40);
  });
});
