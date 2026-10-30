// Overview: everything protected on this computer, and the morning report. "Since you last looked" counts what each
// project's own history recorded over the last 12 hours: saves, checks, breaks and the last version that works.
// Read from the timeline the engine already keeps. Nothing here is guessed or sent anywhere.
import type { TimelineEntry } from "@timetm/core";
import type { ProjectEntry, ProjectStatus, Purpose, Verdict } from "../shared/api.js";
import { esc, plural, verdictKey, when } from "../shared/format.js";
import { ADD_FULL } from "./add-flow.js";
import { projectMeta, purposeIcon, unitCount } from "./purpose.js";

/** The report looks back this far. */
export const DIGEST_HOURS = 24;

export type DigestPoint = Pick<TimelineEntry, "id" | "createdAt" | "verdict" | "agent">;

export interface Digest {
  /** Save points made in the window. */
  saves: number;
  /** Of those, how many have a verdict. */
  checked: number;
  /** Of those, how many passed. */
  works: number;
  /** Of those, how many failed their check: the red marks on the strip. */
  fails: number;
  /** Save points in the window that failed right after a checked save point that passed: where it broke. */
  breaks: number;
  /** The newest of those: where it broke last. Null when it did not break in the window. */
  brokeAt: DigestPoint | null;
  /** Save points after `brokeAt`, and how many of them failed their check too. */
  since: number;
  failingSince: number;
  /** Save points in the window an agent made, and which agents. */
  agentSaves: number;
  agents: string[];
  /** The newest save point that passed, at any time. Null when none has. */
  lastWorking: DigestPoint | null;
  /** The newest save point, at any time. */
  newest: DigestPoint | null;
  /** True when any save point, at any time, has a verdict. */
  everChecked: boolean;
}

/** Counts one project's save points (oldest first) over the `hours` before `now`. */
export function digest(points: readonly DigestPoint[], now: number, hours = DIGEST_HOURS): Digest {
  const from = now - hours * 3_600_000;
  const out: Digest = { saves: 0, checked: 0, works: 0, fails: 0, breaks: 0, brokeAt: null, since: 0, failingSince: 0, agentSaves: 0, agents: [], lastWorking: null, newest: points.at(-1) ?? null, everChecked: false };
  let before: Verdict | null = null;
  for (const p of points) {
    const t = Date.parse(p.createdAt);
    const inside = !Number.isNaN(t) && t >= from && t <= now + 60_000;
    // "Needs something" means the check could not run: it counts as not checked (cli#10).
    const checked = !!p.verdict && p.verdict !== "BLOCKED";
    if (checked) out.everChecked = true;
    if (p.verdict === "PASS") out.lastWorking = p;
    if (inside) {
      out.saves++;
      if (checked) out.checked++;
      if (p.verdict === "PASS") out.works++;
      if (p.verdict === "FAIL") out.fails++;
      if (p.verdict === "FAIL" && before === "PASS") {
        out.breaks++;
        out.brokeAt = p;
        out.since = 0;
        out.failingSince = 0;
      } else if (out.brokeAt) {
        out.since++;
        if (p.verdict === "FAIL") out.failingSince++;
      }
      if (p.agent) {
        out.agentSaves++;
        if (!out.agents.includes(p.agent.name)) out.agents.push(p.agent.name);
      }
    }
    if (p.verdict) before = p.verdict;
  }
  return out;
}

/** One project in the headline: its name, its digest, and whether it has a check at all. */
export interface ReportRow {
  name: string;
  d: Digest;
  checks: boolean;
}

/**
 * The report's headline across every project: "8 saves in the last 24 hours across 3 projects. pricing-page has 2 not
 * checked yet." Checks are spoken of only for projects that have one; a folder that just saves versions never makes the
 * line say "not checked". `name` dresses a project's name where the line says it (the page keeps it on one line).
 * `unread` names the projects whose history could not be read: they are said, never counted as quiet (writer#3).
 */
export function reportLine(rows: readonly ReportRow[], hours = DIGEST_HOURS, name = (n: string): string => n, unread: readonly string[] = []): string {
  const busy = rows.filter((r) => r.d.saves);
  const saves = busy.reduce((n, r) => n + r.d.saves, 0);
  const cant = unread.length ? `Can’t read ${unread.length === 1 ? name(unread[0] ?? "") : plural(unread.length, "project")} right now.` : "";
  if (!saves) return cant || `Quiet. Nothing was saved in the last ${hours} hours.`;
  const line = reportBody(busy, saves, hours, name);
  return cant ? `${line} ${cant}` : line;
}

function reportBody(busy: readonly ReportRow[], saves: number, hours: number, name: (n: string) => string): string {
  const head = `${plural(saves, "save")} in the last ${hours} hours${busy.length > 1 ? ` across ${plural(busy.length, "project")}` : ""}.`;
  const checked = busy.filter((r) => r.checks);
  const breaks = checked.reduce((n, r) => n + r.d.breaks, 0);
  if (breaks) return `${head} ${breaks === 1 ? "Broke once" : `Broke ${breaks} times`}, shown below.`;
  const waiting = checked.filter((r) => r.d.saves > r.d.checked);
  const [only] = waiting;
  if (waiting.length === 1 && only) return `${head} ${name(only.name)} has ${only.d.saves - only.d.checked} not checked yet.`;
  if (waiting.length > 1) return `${head} ${waiting.length} projects have saves not checked yet.`;
  return checked.some((r) => r.d.checked) ? `${head} Nothing broke.` : head;
}

/**
 * One project's line in the report, in its own word for a save point: "7 save points, 5 checked. Broke once, at “Agent:
 * fixed lint warnings”; the 3 save points since fail their check. Claude Code made 2." `name` says a save point the way
 * the app names it; true counts only, so the line agrees with the red marks beside it.
 */
export function digestLine(d: Digest, purpose: ProjectEntry["purpose"], name: (p: DigestPoint) => string = () => ""): string {
  if (!d.saves) return `Quiet in the last ${DIGEST_HOURS} hours.`;
  const parts = [unitCount(purpose, d.saves)];
  // The counts match the strip beside them: each Works and Broken mark is counted.
  if (d.checked) parts.push(`${d.checked} checked${d.fails ? ` (${[d.works ? `${d.works} works` : "", `${d.fails} broken`].filter(Boolean).join(", ")})` : ""}`);
  const at = d.brokeAt ? name(d.brokeAt) : "";
  const fail = (n: number): string => (n === 1 ? "fails its check" : "fail their check");
  const after = !d.failingSince ? ""
    : d.failingSince === d.since ? `; the ${unitCount(purpose, d.since)} since ${fail(d.since)}`
      : `; ${d.failingSince} of the ${unitCount(purpose, d.since)} since ${fail(d.failingSince)}`;
  const broke = d.breaks ? ` ${d.breaks === 1 ? "Broke once" : `Broke ${d.breaks} times`}${at ? `, ${d.breaks === 1 ? "at" : "last at"} ${at}` : ""}${after}.` : "";
  const who = d.agentSaves ? ` ${d.agents.length === 1 ? d.agents[0] : "Agents"} made ${d.agentSaves === d.saves ? (d.saves === 1 ? "it" : "all of them") : d.agentSaves}.` : "";
  return `${parts.join(", ")}.${broke}${who}`;
}

/** A project without a check says when it was saved instead of a verdict: "Saved 2:16 AM". */
export function saveState(newest: Pick<DigestPoint, "createdAt"> | null, now = Date.now()): string {
  return newest ? `Saved ${when(newest.createdAt, new Date(now))}` : "Nothing saved yet";
}

/** The scales a strip can take, smallest first: it zooms to the smallest that holds every save point of the last day. */
const STRIP_SCALES = [
  { hours: 1, ticks: [0, 15, 30, 45, 60].map((m) => m / 60), name: "Last hour", start: "1h ago", mid: "30m ago" },
  { hours: 6, ticks: [0, 1, 2, 3, 4, 5, 6], name: "Last 6 hours", start: "6h ago", mid: "3h ago" },
  { hours: 24, ticks: [0, 6, 12, 18, 24], name: "Last 24 hours", start: "24h ago", mid: "12h ago" },
] as const;
/** The longest a strip looks back. */
export const STRIP_HOURS = 24;
/** The space a dot keeps from the next, as a share of the axis: a 10 px dot on a phone-width card. */
const DOT_GAP = 4;
const pct = (x: number): string => `${Math.round(x * 100) / 100}%`;

/**
 * Positions on a 0 to 100 axis moved apart so no two are closer than `gap`, each as near its own time as it can be, and
 * none off the axis. When they cannot all fit, they share the axis evenly. Returned in the order given.
 */
export function spread(xs: readonly number[], gap: number): number[] {
  const order = xs.map((x, i) => ({ x: Math.min(100, Math.max(0, x)), i })).sort((a, b) => a.x - b.x || a.i - b.i);
  const g = order.length > 1 ? Math.min(gap, 100 / (order.length - 1)) : gap;
  for (let k = 1; k < order.length; k++) order[k]!.x = Math.max(order[k]!.x, order[k - 1]!.x + g);
  for (let k = order.length - 1; k >= 0; k--) order[k]!.x = Math.min(order[k]!.x, k === order.length - 1 ? 100 : order[k + 1]!.x - g);
  const out = new Array<number>(xs.length);
  for (const o of order) out[o.i] = Math.max(0, o.x);
  return out;
}

/**
 * The last day as a slim axis: each save point a dot where it was made, Works green, Broken red, the rest neutral ink, as
 * on History's ruler. When everything happened in the last hour or 6 hours, the axis shows just that. Read as one image;
 * its label says the same counts in words.
 */
export function activityStrip(points: readonly DigestPoint[], now: number, opts: { purpose?: Purpose; checks?: boolean } = {}): string {
  const { purpose = "code", checks = true } = opts;
  const day = points.filter((c) => {
    const t = Date.parse(c.createdAt);
    return t >= now - STRIP_HOURS * 3_600_000 && t <= now;
  });
  const oldest = Math.min(...day.map((c) => Date.parse(c.createdAt)));
  const scale = (day.length && STRIP_SCALES.find((s) => oldest >= now - s.hours * 3_600_000)) || STRIP_SCALES[2];
  const span = scale.hours * 3_600_000;
  const start = now - span;
  const count = (test: (v: Verdict | null) => boolean, word: string): string => {
    const n = day.filter((c) => test(c.verdict)).length;
    return n ? `${n} ${word}` : "";
  };
  const verdicts = checks
    ? [count((v) => v === "PASS", "works"), count((v) => v === "FAIL", "broken"), count((v) => v === null, "not checked"), count((v) => v !== null && v !== "PASS" && v !== "FAIL", "could not be checked")].filter(Boolean)
    : [];
  const label = day.length ? `${scale.name}: ${unitCount(purpose, day.length)}.${verdicts.length ? ` ${verdicts.join(", ")}.` : ""}` : `${scale.name}: nothing saved.`;
  const at = day.map((c) => ((Date.parse(c.createdAt) - start) / span) * 100);
  const xs = spread(at, DOT_GAP);
  const dots = day.map((c, i) => `<i class="ovs-dot b-${verdictKey(c.verdict)}" style="--x:${pct(xs[i] ?? 0)};--t:${Math.round((xs[i] ?? 0)) / 100}"></i>`).join("");
  const ticks = scale.ticks.map((h) => `<i class="ovs-tick" style="--x:${pct((h / scale.hours) * 100)};--t:${Math.round((h / scale.hours) * 100) / 100}"></i>`).join("");
  // Every tick is drawn; only the ends and the middle are named, so a phone-width card never crowds them.
  const labels = `<span style="--x:0%">${scale.start}</span><span style="--x:50%">${scale.mid}</span><span style="--x:100%">now</span>`;
  return `<div class="ovs" role="img" aria-label="${esc(label)}"><div class="ovs-axis">${ticks}${dots}</div><div class="ovs-l" aria-hidden="true">${labels}</div></div>`;
}

export interface OverviewInput {
  projects: readonly ProjectEntry[];
  statuses: ReadonlyMap<string, ProjectStatus>;
  /** Each project's save points, oldest first; "error" when they could not be read; absent while they are read. */
  timelines: ReadonlyMap<string, readonly DigestPoint[] | "error">;
  /** The projects that have a check (hasCheck). The others show when they were saved, not a verdict. */
  checks: ReadonlySet<string>;
  now: number;
  /** The app's verdict badge, so a status reads the same here as on History. */
  badge: (v: Verdict | null) => string;
  /** The free plan's limit, or null with a license. */
  freeLimit: number | null;
  /** The classes that play the strips' first draw, or "" once it has played. */
  enter: string;
  /** A save point said the way the app names it, among its project's save points: "“Added dark mode”". */
  pointName?: (p: DigestPoint, all: readonly DigestPoint[]) => string;
}

function card(p: ProjectEntry, i: number, input: OverviewInput): string {
  const s = input.statuses.get(p.id);
  const tl = input.timelines.get(p.id);
  const checks = input.checks.has(p.id);
  // A missing folder, a store that can't be written and any other problem each say what they are (cli#5).
  const problem = s?.problemKind === "missing" ? "Can’t find it" : s?.problemKind === "permission" ? "Can’t save" : s?.problem ? "Needs a look" : "";
  const status = problem ? `<span class="vb v-error">${problem}</span>`
    : !s ? '<i class="sk ov-sk-pill" aria-hidden="true"></i>'
      : s.newest && checks ? input.badge(s.newest.verdict)
        : `<span class="vb v-none">${esc(saveState(s.newest ?? null, input.now))}</span>`;
  const head = `<button class="ov-open" data-act="project" data-id="${esc(p.id)}" title="${esc(p.path)}">${purposeIcon(p.purpose)}<span class="ov-name"><b>${esc(p.name)}</b><small>${esc(projectMeta(p))}</small></span><span class="ov-status">${status}</span></button>`;
  let body: string;
  // A problem says its sentence; its history, when it could still be read from the store, shows under it.
  if (s?.problem && !Array.isArray(tl)) body = `<p class="ov-dig">${esc(s.problem)}</p>`;
  // While its history reads, the card holds the strip's and the sentence's shape in quiet bars, so nothing jumps in.
  else if (tl === undefined) body = '<div class="ov-wait" aria-hidden="true"><i class="sk ov-sk-strip"></i><i class="sk ov-sk-line"></i><i class="sk ov-sk-fact"></i></div>';
  else if (tl === "error") body = '<p class="ov-dig">We can’t read its history right now.</p>';
  else {
    const d = digest(tl, input.now);
    // A project with a check says how its versions stand; one without already said when it was saved.
    const facts = checks
      ? [d.newest ? `Last saved ${when(d.newest.createdAt, new Date(input.now))}` : "", d.lastWorking ? `Last working version ${when(d.lastWorking.createdAt, new Date(input.now))}` : d.everChecked ? "No version has passed its check yet" : ""].filter(Boolean)
      : [];
    // While it is still broken, the line that says where it broke carries the way back: the last version that works.
    const way = checks && d.breaks && d.lastWorking && d.newest?.verdict === "FAIL" && !s?.problem
      ? `<div class="ov-go"><button class="btn dark" data-act="ov-bring" data-p="${esc(p.id)}" data-id="${esc(d.lastWorking.id)}">${esc(`Bring back ${input.pointName?.(d.lastWorking, tl) || "the last version that works"}`)}</button></div>` : "";
    body = `${s?.problem ? `<p class="ov-dig">${esc(s.problem)}</p>` : ""}${activityStrip(tl, input.now, { purpose: p.purpose, checks })}<p class="ov-dig${d.breaks ? " broke" : ""}">${d.breaks ? '<i class="g v-fail" aria-hidden="true"></i>' : ""}${esc(digestLine(d, p.purpose, (x) => input.pointName?.(x, tl) ?? ""))}</p>${way}${facts.length ? `<p class="ov-facts">${facts.map((f) => `<span>${esc(f)}</span>`).join("")}</p>` : ""}`;
  }
  return `<li class="ov-proj" style="--i:${i}">${head}${body}</li>`;
}

/** The Overview page. The default screen once something is protected. */
export function overviewPage(input: OverviewInput): string {
  const n = input.projects.length;
  const rows: ReportRow[] = input.projects.flatMap((p) => {
    const t = input.timelines.get(p.id);
    return Array.isArray(t) ? [{ name: p.name, d: digest(t, input.now), checks: input.checks.has(p.id) }] : [];
  });
  const unread = input.projects.filter((p) => input.timelines.get(p.id) === "error").map((p) => p.name);
  const reading = rows.length + unread.length < input.projects.length;
  const plan = input.freeLimit === null ? "" : `<span>${esc(`${n} of ${plural(input.freeLimit, "project")} on the free plan`)}</span>`;
  // A project's name in the headline stays whole on one line ("pricing-page", never "pricing-" then "page"). It is marked
  // with two private-use characters, escaped with the rest of the line, then wrapped.
  const headline = esc(reportLine(rows, DIGEST_HOURS, (name) => `\u{E000}${name}\u{E001}`, unread)).replace(/\u{E000}(.*?)\u{E001}/gu, '<span class="ov-nm">$1</span>');
  return `<div class="page b9-page ov-page" id="overview-page" tabindex="-1" role="region" aria-label="Overview"><div class="b9">
    <header class="b9-head"><h1>Overview</h1><p class="b9-voice">${esc(`${plural(n, "thing")} protected on this computer.`)}</p></header>
    <section class="ov-report" aria-labelledby="ov-r-h"><div class="b9-day"><h2 id="ov-r-h">Since you last looked</h2><span>${esc(`The last ${DIGEST_HOURS} hours, from your local history`)}</span></div>
      ${reading ? '<p class="ov-big ov-big-sk" aria-busy="true"><span class="sr-only">Reading your history…</span><i class="sk" aria-hidden="true"></i><i class="sk" aria-hidden="true"></i></p>' : `<p class="ov-big">${headline}</p>`}</section>
    <section aria-labelledby="ov-p-h"><div class="b9-day"><h2 id="ov-p-h">Protected</h2>${plan}</div>
      <ul class="ov-list${input.enter ? ` ${input.enter}` : ""}">${input.projects.map((p, i) => card(p, i, input)).join("")}</ul>
      <div class="row-btns ov-add"><button class="btn" data-act="add">Protect a folder</button><button class="btn link" data-act="sources">See folders found on this computer</button></div>
      ${input.freeLimit !== null && input.projects.length >= input.freeLimit ? `<p class="ov-full">${esc(ADD_FULL)}. <button class="btn link" data-act="storage">Open Storage</button></p>` : ""}</section>
  </div></div>`;
}
