import { describe, expect, test } from "vitest";
import type { ProjectEntry, ProjectStatus } from "../src/shared/api.ts";
import { clock, esc, keepTimes, namePoint, pointMessage, verdictWord, when } from "../src/shared/format.ts";
import { activityStrip, digest, digestLine, overviewPage, reportLine, saveState, spread, type DigestPoint, type OverviewInput } from "../src/renderer/overview.ts";
import { checkRecommended, hasCheck, kindLabel, projectMeta, unitCount } from "../src/renderer/purpose.ts";
import { railLine } from "../src/renderer/rewind-copy.ts";

const now = new Date(2026, 9, 25, 7, 0).getTime();
const hoursAgo = (h: number): string => new Date(now - h * 3_600_000).toISOString();
const pt = (n: number, h: number, verdict: DigestPoint["verdict"], agent = false): DigestPoint => ({
  id: `cp-${String(n).padStart(4, "0")}`, createdAt: hoursAgo(h), verdict, agent: agent ? { name: "Claude Code", prompt: "fix it" } : null, note: "", trigger: "auto", subject: null,
});
/** A save point with its own message (a note), so it is named by it. */
const said = (n: number, h: number, verdict: DigestPoint["verdict"], note: string): DigestPoint => ({ ...pt(n, h, verdict), note });

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
    expect(reportLine([broke, unchecked])).toBe("4 saves in the last 24 hours across 2 projects. Broke once, in app.");
    const twice = { name: "site", d: digest([pt(1, 5, "PASS"), pt(2, 4, "FAIL"), pt(3, 3, "PASS"), pt(4, 2, "FAIL")], now), checks: true };
    expect(reportLine([broke, twice])).toBe("6 saves in the last 24 hours across 2 projects. Broke 3 times across 2 projects, shown below.");
    expect(reportLine([twice])).toBe("4 saves in the last 24 hours. Broke twice, in site.");
    expect(reportLine([unchecked, folder])).toBe("6 saves in the last 24 hours across 2 projects. pricing-page has 2 not checked yet.");
    expect(reportLine([folder])).toBe("4 saves in the last 24 hours.");
    expect(reportLine([{ name: "app", d: digest([pt(1, 3, "PASS")], now), checks: true }, folder])).toBe("5 saves in the last 24 hours across 2 projects. Nothing broke.");
    expect(reportLine([unchecked, { ...unchecked, name: "site" }])).toBe("4 saves in the last 24 hours across 2 projects. 2 projects have saves not checked yet.");
  });

  test("research says runs, and an agent that made every save is named once", () => {
    const d = digest([pt(1, 3, "PASS", true), pt(2, 2, "FAIL", true)], now);
    // An agent's save point is named by its prompt, as on History.
    expect(digestLine(d, "research")).toBe(`2 runs, 2 checked (1 works, 1 broken). Broke once, at “Fix it” (${clock(d.brokeAt!.createdAt)}). Claude Code made all of them.`);
    expect(digestLine(d, "documents")).toBe(`2 save points, 2 checked (1 works, 1 broken). Broke once, at “Fix it” (${clock(d.brokeAt!.createdAt)}). Claude Code made all of them.`);
    const unnamed = digest([pt(1, 3, "PASS"), pt(2, 2, "FAIL")], now);
    expect(digestLine(unnamed, "code")).toBe(`2 save points, 2 checked (1 works, 1 broken). Broke once, at the save at ${clock(unnamed.brokeAt!.createdAt)}.`);
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
    expect(html).toContain(keepTimes(esc(saveState(last, now))));
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

// B5: what the card says agrees with what it draws, names a break the way History names it, and offers the way back.
const dots = (html: string, kind: string): number => (html.match(new RegExp(`class="ovs-dot b-${kind}"`, "g")) ?? []).length;
const card = (id: string, tl: DigestPoint[], extra: Partial<OverviewInput> = {}): string => page({
  projects: [entry(id, `p-${id}`, "git", "code")], statuses: new Map([[id, status(id, tl.at(-1) ?? null)]]), timelines: new Map([[id, tl]]), checks: new Set([id]), ...extra,
});

describe("the count matches the diamonds", () => {
  test("every broken mark on the strip is counted in the line beside it, and only those", () => {
    // The demo's shape: a pass, then four fails in a row. One break, four red diamonds.
    const tl = [pt(1, 6, null), pt(2, 5, null), pt(3, 4, "PASS"), said(4, 3, "FAIL", "Agent: fixed lint warnings"), pt(5, 3, "FAIL"), pt(6, 2, "FAIL"), pt(7, 1, "FAIL")];
    const html = card("a", tl);
    expect(dots(html, "fail")).toBe(4);
    expect(html).toContain("7 save points, 5 checked (1 works, 4 broken).");
    expect(html).not.toContain("1 broke.");
  });

  test("a save point a few seconds ahead of this clock is drawn and counted alike", () => {
    // The engine's clock can run a little ahead of the window's: the line and the strip take the same save points.
    const ahead: DigestPoint = { ...pt(3, 0, "FAIL"), createdAt: new Date(now + 30_000).toISOString() };
    const tl = [pt(1, 2, "PASS"), pt(2, 1, "FAIL"), ahead];
    const d = digest(tl, now);
    const strip = activityStrip(tl, now);
    expect(strip.match(/class="ovs-dot /g)).toHaveLength(d.saves);
    expect(dots(strip, "fail")).toBe(d.fails);
    expect(card("a", tl)).toContain("3 save points, 3 checked (1 works, 2 broken).");
  });

  test("a project that works counts its green marks in words too", () => {
    const html = card("a", [pt(1, 3, null), pt(2, 2, "PASS")]);
    expect(dots(html, "pass")).toBe(1);
    expect(html).toContain("2 save points, 1 checked (1 works).");
  });

  test("for any history, the dots and the counts in words agree", () => {
    const verdicts: DigestPoint["verdict"][] = ["PASS", "FAIL", null, "ERROR", "BLOCKED", "INCOMPLETE"];
    let seed = 7;
    const rnd = (n: number): number => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
    for (let run = 0; run < 40; run++) {
      const tl = Array.from({ length: 1 + rnd(12) }, (_, i) => ({ ...pt(i + 1, 30 - i * 2.4 - rnd(3) / 10, verdicts[rnd(verdicts.length)] ?? null), createdAt: new Date(now - (26 - i * 2.4) * 3_600_000 + rnd(90) * 1000).toISOString() }));
      const d = digest(tl, now);
      const strip = activityStrip(tl, now);
      expect((strip.match(/class="ovs-dot /g) ?? []).length).toBe(d.saves);
      expect(dots(strip, "fail")).toBe(d.fails);
      expect(dots(strip, "pass")).toBe(d.works);
    }
  });
});

describe("a project that broke offers the way back", () => {
  const tl = [said(1, 4, "PASS", "Added dark mode"), said(2, 3, "FAIL", "Agent: fixed lint warnings"), pt(3, 2, "FAIL")];

  test("it says where it broke by the save point's name, and how many since fail", () => {
    const d = digest(tl, now);
    expect(d.brokeAt?.id).toBe("cp-0002");
    const html = card("a", tl);
    expect(html).toContain(`Broke once, at “Agent: fixed lint warnings” (<span class="nw">${esc(clock(tl[1]!.createdAt))}</span>); the 1 save point since fails its check.`);
    const mixed = digest([pt(1, 4, "PASS"), pt(2, 3, "FAIL"), pt(3, 2, null), pt(4, 1, "FAIL")], now);
    expect(digestLine(mixed, "code")).toContain("; 1 of the 2 save points since fails its check.");
    const twice = digest([pt(1, 5, "PASS"), pt(2, 4, "FAIL"), pt(3, 3, "PASS"), said(4, 2, "FAIL", "Swapped the loader")], now);
    expect(digestLine(twice, "code")).toContain(`Broke twice, last at “Swapped the loader” (${clock(twice.brokeAt!.createdAt)}).`);
  });

  test("Bring back is the card's one primary, for the newest version that works, named as History names it", () => {
    const html = card("a", tl);
    expect(html.match(/class="btn dark/g)).toHaveLength(1);
    expect(html).toContain('data-act="ov-bring" data-id="a" data-v="cp-0001"');
    expect(html).toContain(`Bring back “Added dark mode” <span class="b-sub"><span class="nw">${esc(clock(tl[0]!.createdAt))}</span></span>`);
    // A name someone gave it in History is the name here too.
    const given = card("a", tl, { name: (pid, p) => namePoint(p, tl, pointMessage(p, pid === "a" && p.id === "cp-0001" ? "Dark mode, final" : ""), new Date(now)) });
    expect(given).toContain("Bring back “Dark mode, final”");
  });

  test("a working project, one with no check, one with a problem, or one that never worked offers no Bring back", () => {
    expect(card("a", [pt(1, 3, "FAIL"), pt(2, 2, "PASS")])).not.toContain('data-act="ov-bring"');
    expect(card("a", [pt(1, 3, "FAIL"), pt(2, 2, "FAIL")])).not.toContain('data-act="ov-bring"');
    expect(card("a", tl, { checks: new Set() })).not.toContain('data-act="ov-bring"');
    const sick: ProjectStatus = { ...status("a", tl.at(-1)!), problem: "We can't find p-a at /srv/code/p-a. Its history is safe in the store.", problemKind: "missing" };
    expect(card("a", tl, { statuses: new Map([["a", sick]]) })).not.toContain('data-act="ov-bring"');
  });

  test("while a brought back copy is ready, the row says so beside Broken, as the sidebar does, and its one primary shows the copy", () => {
    const html = card("a", tl, { ready: new Set(["a"]) });
    // The chip stays Broken: the folder still is.
    expect(html).toContain('<span class="vb">Broken</span>');
    expect(html).toContain(`<span class="ov-ready">${esc(railLine("", true))}</span>`);
    expect(html.match(/class="btn dark/g)).toHaveLength(1);
    expect(html).toContain('data-act="ov-copy" data-id="a">Show the copy</button>');
    expect(html).not.toContain('data-act="ov-bring"');
  });

  test("after Keep it or Undo, the row is plain again: Bring back while it is still broken, nothing once it works", () => {
    const html = card("a", tl, { ready: new Set() });
    expect(html).not.toContain("copy ready");
    expect(html).not.toContain('data-act="ov-copy"');
    expect(html).toContain('data-act="ov-bring" data-id="a"');
    const fixed = card("a", [...tl, pt(4, 1, "PASS")], { ready: new Set() });
    expect(fixed).not.toContain('data-act="ov-copy"');
    expect(fixed).not.toContain('data-act="ov-bring"');
    // Another project's ready copy is not this one's.
    expect(card("a", tl, { ready: new Set(["b"]) })).not.toContain("copy ready");
  });

  test("after a bring back, your broken version reads as History reads it: Broken, and Bring back again once the copy is kept", () => {
    // The save made before going back is never checked; the app says what its row says (carriedVerdict), the folder unchanged.
    const saved: DigestPoint = { ...pt(4, 1, null), trigger: "recover", note: "Before recovering cp-0001" };
    const after = [...tl, saved];
    const kept = card("a", after, { shown: new Map([["a", "FAIL"]]) });
    expect(kept).toContain('<span class="vb">Broken</span>');
    expect(kept).toContain('data-act="ov-bring" data-id="a" data-v="cp-0001"');
    const ready = card("a", after, { shown: new Map([["a", "FAIL"]]), ready: new Set(["a"]) });
    expect(ready).toContain('<span class="vb">Broken</span><span class="ov-ready">');
    // Not known (another project's changes are not read): as the sidebar, it is not checked, and nothing is offered.
    expect(card("a", after)).not.toContain('data-act="ov-bring"');
  });

  test("two projects' Bring back buttons are told apart by project, though their save point ids repeat", () => {
    const html = page({
      projects: [entry("a", "one", "git", "code"), entry("b", "two", "git", "code")],
      statuses: new Map([["a", status("a", tl.at(-1)!)], ["b", status("b", tl.at(-1)!)]]),
      timelines: new Map([["a", tl], ["b", tl]]), checks: new Set(["a", "b"]),
    });
    expect(html).toContain('data-act="ov-bring" data-id="a" data-v="cp-0001"');
    expect(html).toContain('data-act="ov-bring" data-id="b" data-v="cp-0001"');
  });
});

describe("no mid-token wraps", () => {
  test("times and paths on a card stay whole; a path breaks only after a slash", () => {
    const tl = [pt(1, 3, "PASS"), pt(2, 2, "PASS")];
    const html = card("a", tl);
    expect(html).toContain(`<span class="nw">${esc(when(tl[1]!.createdAt, new Date(now)))}</span>`);
    const sick: ProjectStatus = { ...status("a", null), problem: "We can't find p-a at /srv/code/my-app. Its history is safe in the store.", problemKind: "missing" };
    const gone = card("a", [], { statuses: new Map([["a", sick]]), timelines: new Map() });
    expect(gone).toContain('<span class="nw">/<wbr>srv/<wbr>code/<wbr>my-app.</span>');
    expect(gone).toContain('<span class="nw">p-a</span>');
  });
});

describe("names an agent or a person wrote are text, never markup (Security SHOULD-73a)", () => {
  const H = `<img src=x onerror=alert(1)>"'&`;
  const E = esc(H);
  const clean = (html: string): void => {
    expect(html).not.toContain("<img");
    expect(html).not.toContain(`"'&`);
  };

  test("a hostile commit subject, History name and id render escaped in the Bring back label, its data-v, the line and the facts", () => {
    // The version that works carries a hostile id and a hostile History name; where it broke, a hostile commit subject.
    const good: DigestPoint = { ...pt(1, 4, "PASS"), id: H };
    const broke: DigestPoint = { ...pt(2, 3, "FAIL"), subject: H };
    const named = (_: string, p: DigestPoint) => namePoint(p, [p], pointMessage(p, p.id === H ? H : ""), new Date(now));
    const html = card("a", [good, broke, pt(3, 2, "FAIL")], { name: named });
    clean(html);
    expect(html).toContain(`data-act="ov-bring" data-id="a" data-v="${E}"`);
    expect(html).toContain(`Bring back “${E}” <span class="b-sub">`);
    expect(html).toContain(`Broke once, at “${E}” (`);
    // Not broken now (the newest is not checked yet): the facts name the last version that works.
    const facts = card("a", [good, pt(2, 2, null)], { name: named });
    clean(facts);
    expect(facts).toContain(`Last working version: “${E}” (`);
  });

  test("a hostile problem sentence and project id render escaped, on the copy-ready row too", () => {
    const sick: ProjectStatus = { ...status("a", null), problem: `We can't find ${H} at /srv/${H}.`, problemKind: "missing" };
    const gone = card("a", [], { statuses: new Map([["a", sick]]), timelines: new Map() });
    clean(gone);
    expect(gone).toContain(E);
    const tl = [pt(1, 3, "PASS"), pt(2, 2, "FAIL")];
    const ready = card(H, tl, { ready: new Set([H]) });
    clean(ready);
    expect(ready).toContain(`data-act="ov-copy" data-id="${E}">Show the copy</button>`);
  });
});
