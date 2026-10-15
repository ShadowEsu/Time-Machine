// The app window: projects, History, save point detail, Check it works, the Rewind (the Time
// View, or the plain wizard sheet), Compare, Settings, onboarding and the Inspector.
// Plain TypeScript, one render function.
import type { CheckpointResult, DiffResult, FindGoodResult, InitResult, OpenResult, RecoverResult, TimelineEntry, TimelineResult, VerifyResult } from "@timetm/core";
import type { AppEvent, Bootstrap, Call, CallOf, HookPreview, Method, ProjectEntry, ProjectStatus, Results, Settings, ShortcutAction, StorageRow, TmBridge, Verdict } from "../shared/api.js";
import { tmCommand } from "../shared/commands.js";
import { bytes, clock, dayLabel, esc, plural, seconds, triggerLabel, triggerSentence, verdictKey, verdictWord, when } from "../shared/format.js";

export interface StartOptions {
  preview: boolean;
  /** The preview shows the timeline strip inside the page. The real app uses a global hotkey. */
  onStrip?: (projectId: string) => void;
  /** Extra buttons in the preview banner, such as "Show the overlay card". */
  previewActions?: { label: string; run: () => void }[];
}

type Screen = "welcome" | "onboarding" | "history" | "rewind" | "compare" | "settings";

interface CheckState {
  phase: "saving" | "checking" | "done";
  cp: string | null;
  skipped: boolean;
  result: VerifyResult | null;
  error: string | null;
}

/** Where the user was before the Rewind, so Esc puts them back exactly there. */
interface ReturnPoint {
  screen: Screen;
  selected: string | null;
  listScroll: number;
  pageScroll: number;
}

interface RewindState {
  step: "find" | "try" | "use" | "done";
  /** "scene" is the Time View. "sheet" is the plain wizard, for Reduce motion or Simple rewind. */
  mode: "scene" | "sheet";
  returnTo: ReturnPoint;
  target: string | null;
  finding: boolean;
  find: FindGoodResult | null;
  progress: { checkpoint: string; verdict: string }[];
  trying: boolean;
  tryResult: VerifyResult | null;
  opening: boolean;
  openResult: OpenResult | null;
  recovering: boolean;
  result: RecoverResult | null;
  error: string | null;
}

interface OnboardingState {
  step: 1 | 2 | 3;
  path: string | null;
  project: ProjectEntry | null;
  init: InitResult | null;
  current: string;
  choice: "detected" | "build" | "custom";
  custom: string;
  working: boolean;
  trying: boolean;
  tryResult: VerifyResult | null;
  hook: HookPreview | null;
  hookDone: string | null;
  /** The save point made right after setup. Saved, not checked, until a check runs. */
  first: { id: string } | null;
  error: string | null;
}

interface Record {
  title: string;
  command: string | null;
  json: unknown;
  at: string;
}

interface State {
  boot: Bootstrap;
  settings: Settings;
  projects: ProjectEntry[];
  statuses: Map<string, ProjectStatus>;
  projectId: string | null;
  screen: Screen;
  timeline: TimelineResult | null;
  timelineError: string | null;
  selected: string | null;
  busy: string | null;
  check: CheckState | null;
  rewind: RewindState | null;
  compare: { a: string | null; b: string | null; result: DiffResult | null; loading: boolean; error: string | null };
  onboarding: OnboardingState;
  inspector: boolean;
  records: Record[];
  storage: StorageRow[] | null;
  hookSheet: { projectId: string; preview: HookPreview; done: string | null; error: string | null; working: boolean } | null;
  toast: string | null;
  demoBusy: boolean;
  openResult: OpenResult | null;
  /** The last check result per save point in this session, for evidence lines (time taken, network). */
  verifyResults: Map<string, VerifyResult>;
  /** Paths changed in each save point since the one before it. Read in the background for the Time View. */
  changes: Map<string, string[]>;
  /** A button that shows its pressed state because its shortcut just fired. */
  flash: { sel: string; until: number } | null;
}

class ApiFailure extends Error {}

const RECORDED: Method[] = ["init", "setCheck", "checkpoint", "diff", "open", "verify", "findGood", "recover", "log", "hookInstall", "demo"];
const TITLES: Partial<{ [M in Method]: string }> = {
  init: "Set up", setCheck: "Change the check", checkpoint: "Save now", diff: "Compare", open: "Try it in a safe copy", verify: "Check it works",
  findGood: "Find the last working version", recover: "Use this version", log: "Audit log", hookInstall: "Connect Claude Code", demo: "Try the demo",
};

let bridge: TmBridge;
let opts: StartOptions;
let st: State;
let root: HTMLElement;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function emptyOnboarding(): OnboardingState {
  return { step: 1, path: null, project: null, init: null, current: "", choice: "detected", custom: "", working: false, trying: false, tryResult: null, hook: null, hookDone: null, first: null, error: null };
}

// Engine calls

async function api<M extends Method>(call: CallOf<M>): Promise<Results[M]> {
  const r = await bridge.call(call);
  if (RECORDED.includes(call.method)) {
    const p = "projectId" in call ? st.projects.find((x) => x.id === call.projectId) : null;
    st.records.unshift({
      title: TITLES[call.method] ?? call.method,
      command: tmCommand(call as Call, p?.path ?? null),
      json: r.ok ? r.data : { error: r.error },
      at: new Date().toISOString(),
    });
    st.records.length = Math.min(st.records.length, 20);
  }
  if (!r.ok) throw new ApiFailure(r.error.message);
  if (call.method === "verify") {
    const v = r.data as VerifyResult;
    st.verifyResults.set(v.checkpoint, v);
  }
  return r.data;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function project(): ProjectEntry | null {
  return st.projects.find((p) => p.id === st.projectId) ?? null;
}

function points(): TimelineEntry[] {
  return st.timeline?.checkpoints ?? [];
}

function entry(id: string | null): TimelineEntry | null {
  return points().find((c) => c.id === id) ?? null;
}

function lastWorking(excludeNewest = true): TimelineEntry | null {
  const pts = points();
  const newest = pts.at(-1);
  return [...pts].reverse().find((c) => c.verdict === "PASS" && (!excludeNewest || c.id !== newest?.id)) ?? null;
}

async function refreshStatuses(): Promise<void> {
  try {
    const list = await api({ method: "statuses" });
    st.statuses = new Map(list.map((s) => [s.projectId, s]));
  } catch {
    // Statuses are a nicety. The screens still work.
  }
}

async function loadTimeline(): Promise<void> {
  const p = project();
  if (!p) return;
  try {
    st.timeline = await api({ method: "timeline", projectId: p.id });
    st.timelineError = null;
    const ids = points().map((c) => c.id);
    if (!st.selected || !ids.includes(st.selected)) st.selected = ids.at(-1) ?? null;
  } catch (e) {
    st.timeline = null;
    st.timelineError = msg(e);
  }
}

async function selectProject(id: string, screen: Screen = "history"): Promise<void> {
  if (st.projectId !== id) {
    st.projectId = id;
    st.timeline = null;
    st.selected = null;
    st.changes = new Map();
    changesFor = "";
  }
  st.screen = screen;
  void bridge.call({ method: "setActive", projectId: id });
  await loadTimeline();
  render();
}

function toast(text: string): void {
  st.toast = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    st.toast = null;
    render();
  }, 4200);
  render();
}

// Small view helpers

const isMac = (): boolean => st.boot.platform === "darwin";
function keys(k: string): string {
  if (isMac()) return k.replace("Mod+", "⌘").replace("Shift+", "⇧").replace("Enter", "↵");
  return k.replace("Mod+", "Ctrl+");
}
function badge(v: Verdict | null, cls = ""): string {
  return `<span class="vb v-${verdictKey(v)} ${cls}"><i class="g" aria-hidden="true"></i>${esc(verdictWord(v))}</span>`;
}
function glyph(v: Verdict | null): string {
  return `<i class="g v-${verdictKey(v)}" aria-hidden="true"></i>`;
}
function li(items: string[], empty: string): string {
  return items.length ? items.map((x) => `<div class="li"><span>${esc(x)}</span></div>`).join("") : `<div class="muted small">${esc(empty)}</div>`;
}
function steps(current: number, labels: string[]): string {
  return `<div class="steps" aria-label="Step ${current} of ${labels.length}">${labels
    .map((l, i) => `${i ? '<span class="bar"></span>' : ""}<span class="s ${i + 1 === current ? "on" : i + 1 < current ? "done" : ""}"><span class="n">${i + 1}</span>${esc(l)}</span>`)
    .join("")}</div>`;
}
function short(sha: string): string {
  return sha.slice(0, 7);
}

/** Coverage lines in plain words. Git details add the commit, never replace the words. */
function savedLines(c: TimelineEntry): string[] {
  return c.coverage.captured.map((line) => {
    if (line.startsWith("Code:")) return st.settings.showGitDetails ? `Code, ${line.slice(6)}` : "Code";
    if (line.startsWith("Files:")) return `Files outside Git: ${line.slice(7)}`;
    if (line.startsWith("Config:")) return `Settings: ${line.slice(8)}`;
    if (line.startsWith("Dependencies:")) return `Packages: ${line.slice(14)}`;
    return line;
  });
}
function notSavedLines(c: TimelineEntry): string[] {
  return [...c.coverage.missing, ...c.coverage.manual].map((line) => {
    const m = /^Secret values in (.+?): (.+)$/.exec(line);
    return m ? `Secret values. We kept the names: ${m[2]} (in ${m[1]})` : line;
  });
}

function statusLine(): { v: Verdict | null; text: string } {
  const pts = points();
  const newest = pts.at(-1);
  if (!newest) return { v: null, text: "No save points yet" };
  const lw = lastWorking();
  switch (newest.verdict) {
    case "PASS":
      return { v: "PASS", text: `Works. The newest save point, ${newest.id}, passed its check.` };
    case "FAIL":
      return { v: "FAIL", text: lw ? `Broken. Last working version: ${lw.id}, ${when(lw.createdAt)}, ${lw.note}.` : "Broken. No earlier save point has passed yet." };
    case "INCOMPLETE":
      return { v: "INCOMPLETE", text: "Couldn't check the newest save point." };
    case "BLOCKED":
      return { v: "BLOCKED", text: "Needs something before it can be checked." };
    case "ERROR":
      return { v: "ERROR", text: "The last check crashed." };
    default:
      return { v: null, text: `Saved, not checked. Newest save point ${newest.id}, ${when(newest.createdAt)}. Press Check it works to find out.` };
  }
}

// Views

function sidebar(): string {
  const items = st.projects
    .map((p) => {
      const s = st.statuses.get(p.id);
      const v = s?.newest?.verdict ?? null;
      const label = s?.problem ? "Can't find it" : s?.newest ? verdictWord(v) : "No save points yet";
      return `<button class="it ${p.id === st.projectId && st.screen !== "settings" && st.screen !== "onboarding" ? "on" : ""}" data-act="project" data-id="${p.id}" title="${esc(`${p.name}: ${label}`)}">
        ${glyph(s?.problem ? "ERROR" : v)}<span class="nm">${esc(p.name)}</span><span class="sr-only">${esc(label)}</span></button>`;
    })
    .join("");
  return `<aside class="side">
    <div class="brand"><span class="mark" aria-hidden="true"></span>Time Machine</div>
    <div class="sec">Projects</div>
    ${items || '<div class="muted small" style="padding:4px 8px">No projects yet</div>'}
    <button class="it" data-act="add"><span class="plus">+</span><span class="nm">Add project</span><kbd>${keys("Mod+N")}</kbd></button>
    <button class="it" data-act="demo"><span class="plus">▸</span><span class="nm">Try the demo</span></button>
    <div class="grow"></div>
    <button class="it ${st.screen === "settings" ? "on" : ""}" data-act="settings"><span class="plus">⚙</span><span class="nm">Settings</span><kbd>${keys("Mod+,")}</kbd></button>
    <button class="it ${st.inspector ? "on" : ""}" data-act="inspector"><span class="plus">{}</span><span class="nm">Inspector</span><kbd>${keys("Mod+I")}</kbd></button>
    <div class="store-mini"><span>Save points are kept outside your project folders.</span>${st.settings.showGitDetails ? `<span class="mono">${esc(st.boot.storeDir)}</span>` : ""}</div>
  </aside>`;
}

function welcome(): string {
  return `<div class="welcome"><div class="inner">
    <div class="mini-ruler" aria-hidden="true">${glyph("PASS")}${glyph("PASS")}${glyph(null)}${glyph("PASS")}${glyph("FAIL")}${glyph("FAIL")}${glyph("FAIL")}<span class="ph"></span></div>
    <h1>Save points that know if they work.</h1>
    <p class="lede">Save your project as you go. We check each version in a safe copy. When something breaks, find the last one that works and put it on a new branch. Your folder and branch are not touched.</p>
    <div class="row-btns"><button class="btn dark big" data-act="add">Add a project</button><button class="btn big" data-act="demo">Try the demo</button></div>
    <p class="foot">Works on this Mac. Your code is not uploaded. Time Machine is not universal undo: every result says what was not restored.</p>
  </div></div>`;
}

function history(): string {
  const p = project();
  if (!p) return welcome();
  if (st.timelineError && !st.timeline) {
    return `<div class="empty"><h2>We can't read ${esc(p.name)}</h2><p>${esc(st.timelineError)}</p><div class="row-btns"><button class="btn" data-act="reload">Try again</button><button class="btn ghost" data-act="remove" data-id="${p.id}">Remove from the app</button></div></div>`;
  }
  const pts = points();
  const s = statusLine();
  const broken = s.v === "FAIL";
  const busy = st.busy;
  const header = `<div class="tbar">
    <div class="ttl"><h1>${esc(p.name)}</h1>
      <div class="status">${badge(s.v)}<span>${esc(s.text)}</span></div>
      <div class="path">${esc(p.path)}${st.settings.showGitDetails && pts.at(-1)?.branch ? ` · branch ${esc(pts.at(-1)?.branch ?? "")}` : ""}</div></div>
    <div class="bigbtns">
      <button class="btn big ${broken ? "" : "dark"}" data-act="save" ${busy ? "disabled" : ""}>Save now <kbd>${keys("Mod+S")}</kbd></button>
      <button class="btn big" data-act="check" ${busy ? "disabled" : ""}>Check it works <kbd>${keys("Mod+Enter")}</kbd></button>
      <button class="btn big ${broken ? "dark" : ""}" data-act="rewind" ${busy || !pts.length ? "disabled" : ""}><span class="tri"></span>Find the last working version <kbd>${keys("Mod+Shift+R")}</kbd></button>
    </div></div>`;
  if (!pts.length) {
    return `${header}<div class="empty"><h2>No save points yet</h2><p>Press Save now to make the first one. Then Check it works to see if it passes.</p><button class="btn dark" data-act="save">Save now</button></div>`;
  }
  const selIdx = pts.findIndex((c) => c.id === st.selected);
  const shown = pts.slice(-40);
  const ruler = `<div class="ruler"><div class="ticks" role="slider" aria-label="Save points" aria-valuemin="1" aria-valuemax="${pts.length}" aria-valuenow="${selIdx + 1}" aria-valuetext="${esc(st.selected ? `${st.selected}, ${verdictWord(entry(st.selected)?.verdict ?? null)}` : "")}">
      ${shown.map((c) => `<button class="tk ${pts.indexOf(c) > selIdx ? "after" : ""}" data-act="select" data-id="${c.id}" title="${esc(`${c.id} · ${when(c.createdAt)} · ${c.note} · ${verdictWord(c.verdict)}`)}">${glyph(c.verdict)}</button>`).join("")}
      <span class="ph" id="playhead"></span></div>
    <div class="tlab"><span>${esc(when(shown[0]?.createdAt ?? ""))}</span><span>${esc(shown.length > 1 ? `${shown.length} save points` : "")}</span><span>newest ${esc(when(shown.at(-1)?.createdAt ?? ""))}</span></div></div>`;

  const rows: string[] = [];
  let lastDay = "";
  const newestFirst = [...pts].reverse();
  newestFirst.forEach((c, i) => {
    const day = dayLabel(c.createdAt);
    if (day !== lastDay) {
      rows.push(`<div class="day">${esc(day)}</div>`);
      lastDay = day;
    }
    rows.push(`<button class="row ${c.id === st.selected ? "on" : ""}" data-act="select" data-id="${c.id}">
      <span class="tm">${esc(clock(c.createdAt))}</span>
      <span style="min-width:0"><div class="t1">${esc(c.note)}</div><div class="t2"><span>${esc(c.id)}</span><span>${esc(triggerLabel(c.trigger))}</span>${st.settings.showGitDetails ? `<span class="mono">${esc(short(c.commit))}${c.dirty ? " + uncommitted" : ""}</span>` : ""}</div></span>
      ${badge(c.verdict)}</button>`);
    const older = newestFirst[i + 1];
    // Only say "broke here" when two neighbouring checks prove it.
    if (older && c.verdict === "FAIL" && older.verdict === "PASS") rows.push(`<div class="broke-rule">Broke here: ${esc(older.id)} works, ${esc(c.id)} is broken</div>`);
  });

  const anyPass = pts.some((c) => c.verdict === "PASS");
  const first = pts.length === 1 ? pts[0] : null;
  const hint = first
    ? `<div class="hintbar">${glyph(first.verdict)}<span>${first.verdict === "PASS" ? `Your first save point passed its check. It is your first way back. Press ${esc(keys("Mod+S"))} to save again.` : `This is your first save point. ${first.verdict ? esc(verdictWord(first.verdict)) : "Saved, not checked"}. Press ${esc(keys("Mod+S"))} to save again, or Check it works to find out if it passes.`}</span></div>`
    : !anyPass ? `<div class="hintbar">${glyph(null)}<span>No version has passed a check yet. When one does, it becomes your way back.</span><button class="btn" data-act="check" ${busy ? "disabled" : ""}>Check it works</button></div>` : "";
  return `${header}${ruler}${hint}<div class="split"><div class="list" id="list">${rows.join("")}</div>${detail()}</div>`;
}

function detail(): string {
  const c = entry(st.selected);
  const p = project();
  if (!c || !p) return `<aside class="detail"><p class="muted">Pick a save point.</p></aside>`;
  const newest = points().at(-1);
  const evidence =
    c.verdict === null
      ? "Not checked yet. Saved, but we don't know if it works."
      : c.verdict === "PASS"
        ? "Passed its check in a safe copy (basic isolation, on this Mac)."
        : c.verdict === "FAIL"
          ? "Failed its check in a safe copy (basic isolation, on this Mac)."
          : c.verdict === "INCOMPLETE"
            ? "We couldn't check this version. We won't call it working until we can."
            : c.verdict === "BLOCKED"
              ? "The check needs something before it can run."
              : "The check itself crashed. This doesn't mean the project is broken.";
  const git = st.settings.showGitDetails
    ? `<div class="git"><div><span class="k">id</span> ${esc(c.id)}</div><div><span class="k">commit</span> ${esc(c.commit)}</div><div><span class="k">branch</span> ${esc(c.branch ?? "(detached)")}${c.dirty ? " · had uncommitted changes" : ""}</div><div><span class="k">trigger</span> ${esc(c.trigger)}</div><div><span class="k">ref</span> refs/tm/${esc(c.id)}</div><div><span class="k">check</span> ${esc(tmCommand({ method: "verify", projectId: p.id, id: c.id }, p.path) ?? "")}</div></div>`
    : "";
  const busy = st.busy ? "disabled" : "";
  return `<aside class="detail">
    <div><h2>${esc(c.note)}</h2><div class="meta">${esc(c.id)} · ${esc(dayLabel(c.createdAt))} ${esc(clock(c.createdAt))} · ${esc(triggerLabel(c.trigger))}</div></div>
    <div class="vblock">${badge(c.verdict, "lg")}<p>${esc(evidence)}</p><div class="row-btns"><button class="btn" data-act="verify-one" data-id="${c.id}" ${busy}>${c.verdict ? "Check again" : "Check this one"}</button></div></div>
    <div class="cols"><div class="kv"><span class="h">What's saved</span>${li(savedLines(c), "Nothing listed")}</div>
      <div class="kv no"><span class="h">What's not saved</span>${li(notSavedLines(c), "Nothing listed")}</div></div>
    <div class="row-btns">
      <button class="btn dark" data-act="use" data-id="${c.id}" ${busy}>Use this version</button>
      <button class="btn" data-act="try" data-id="${c.id}" ${busy}>Try it in a safe copy</button>
      ${newest && newest.id !== c.id ? `<button class="btn" data-act="compare" data-a="${c.id}" data-b="${newest.id}">Compare with newest</button>` : ""}
    </div>
    ${st.openResult && st.openResult.id === c.id ? `<div class="note">A safe copy of ${esc(c.id)} is ready. Your project folder was not touched.${st.openResult.missing.length ? ` Missing: ${esc(st.openResult.missing.join(", "))}.` : ""}<div class="row-btns" style="margin-top:8px"><button class="btn" data-act="reveal" data-path="${esc(st.openResult.dir)}">Show in Finder</button></div>${st.settings.showGitDetails ? `<div class="mono muted" style="margin-top:6px">${esc(st.openResult.dir)}</div>` : ""}</div>` : ""}
    ${git}
  </aside>`;
}

function checkSheet(): string {
  const c = st.check;
  const p = project();
  if (!c || !p) return "";
  const rows = [
    { label: c.skipped ? `Nothing changed since ${c.cp ?? "the last save point"}, so we used it` : "Saved the current version", state: c.phase === "saving" ? "run" : "ok", t: c.cp ?? "" },
    { label: "Made a safe copy and ran your check", state: c.phase === "checking" ? "run" : c.phase === "done" ? "ok" : "wait", t: c.result ? seconds(c.result.durationMs) : "" },
  ];
  const list = `<div class="steplist">${rows
    .map((r) => `<div class="r">${r.state === "run" ? '<span class="spin"></span>' : r.state === "ok" ? '<span class="ok">✓</span>' : '<span class="ok muted">·</span>'}<span>${esc(r.label)}</span><span class="t">${esc(r.t)}</span></div>`)
    .join("")}</div>`;
  let result = "";
  if (c.error) result = `<div class="note bad">${esc(c.error)}</div>`;
  else if (c.result) {
    const r = c.result;
    const lw = lastWorking();
    const head: { [V in Verdict]: string } = {
      PASS: "It works.", FAIL: "It's broken.", INCOMPLETE: "We couldn't finish the check.", BLOCKED: "The check needs something first.", ERROR: "The check itself crashed.",
    };
    const extra =
      r.verdict === "FAIL" ? (lw ? ` The last version that worked is ${lw.id}, ${when(lw.createdAt)}, ${lw.note}.` : " No earlier save point has passed yet.")
        : r.verdict === "ERROR" ? " This is a problem with the check, not necessarily your project."
          : r.verdict === "PASS" ? ` Checked in a safe copy (basic isolation) in ${seconds(r.durationMs)}. The network was ${r.network.policy === "deny" ? "off" : "on"} during the check.` : "";
    result = `<div class="big-verdict ${stampOnce(`check:${r.checkpoint}:${r.verdict}`)}">${glyph(r.verdict)}<span>${esc(head[r.verdict])}</span></div>
      <p>${esc(r.reason + extra)}</p>
      ${st.settings.showGitDetails ? `<div class="git"><div><span class="k">verdict</span> ${esc(r.verdict)} · exit ${esc(String(r.exitCode))} · ${esc(r.isolation)} mode</div><div><span class="k">command</span> ${esc(r.command)}</div>${r.log ? `<div><span class="k">log</span> ${esc(r.log)}</div>` : ""}</div>` : ""}`;
  }
  const done = c.phase === "done" || !!c.error;
  const lw = lastWorking();
  return `<div class="scrim ${once("scrim:check")}"><div class="sheet" role="dialog" aria-modal="true" aria-label="Check it works">
    <h2>Checking ${esc(p.name)}</h2>${list}${result}
    <p class="small muted">Your project folder is not touched. The check runs in a separate copy.</p>
    <div class="row-btns" style="justify-content:flex-end">
      ${done && c.result?.verdict === "FAIL" && lw ? `<button class="btn" data-act="rewind-to" data-id="${lw.id}">Rewind to ${esc(lw.id)}</button>` : ""}
      ${done && c.result?.log ? `<button class="btn ghost" data-act="reveal" data-path="${esc(c.result.log)}">Show log</button>` : ""}
      <button class="btn dark" data-act="close-check" ${done ? "" : "disabled"}>Done</button></div>
  </div></div>`;
}

function rewind(): string {
  const r = st.rewind;
  const p = project();
  if (!r || !p) return history();
  const idx = { find: 1, try: 2, use: 3, done: 4 }[r.step];
  const target = entry(r.target);
  let body = "";
  if (r.step === "find") {
    const tried = r.find?.tried ?? r.progress.map((x) => ({ id: x.checkpoint, verdict: x.verdict as Verdict, reason: "" }));
    const triedRows = tried
      .map((t) => {
        const c = entry(t.id);
        return `<div class="r"><span class="mono">${esc(t.id)}</span><span>${esc(c?.note ?? "")}${t.reason && st.settings.showGitDetails ? ` <span class="muted small">${esc(t.reason)}</span>` : ""}</span>${badge(t.verdict)}</div>`;
      })
      .join("");
    if (r.finding) {
      body = `<div class="panel"><h3>Finding the last version that works</h3><p class="muted">Checking newest first, each one in a safe copy. Your folder is not touched.</p>
        <div class="tried">${triedRows}<div class="r"><span class="spin"></span><span class="muted">Checking the next save point…</span><span></span></div></div></div>`;
    } else if (r.find && !r.find.found) {
      const last = r.find.tried.at(-1);
      const why =
        r.find.verdict === "FAIL" ? `None of the ${plural(r.find.tried.length, "save point")} passed its check.`
          : r.find.verdict === "BLOCKED" ? `We had to stop. ${last?.reason ?? ""}`
            : `We couldn't check every save point, so we won't call any of them working. ${last?.reason ?? ""}`;
      body = `<div class="panel"><h3>No working version found</h3><div class="tried">${triedRows}</div><div class="note warn">${esc(why)}</div>
        <div class="row-btns"><button class="btn" data-act="history">Back to History</button></div></div>`;
    } else if (target) {
      const known = !r.find;
      body = `<div class="panel">${r.find ? `<div class="tried">${triedRows}</div>` : ""}
        <div class="big-verdict ${stampOnce(`rw:${target.id}:${target.verdict ?? ""}`)}">${glyph(target.verdict)}<span>${esc(target.id)} ${target.verdict === "PASS" ? "works." : `is ${verdictWord(target.verdict).toLowerCase()}.`}</span></div>
        <p>${esc(target.note)} · ${esc(when(target.createdAt))}${known && target.verdict === "PASS" ? " · checked before, in a safe copy" : ""}</p>
        ${target.verdict !== "PASS" ? `<div class="note warn">This save point has not passed a check. The next step checks it in a safe copy.</div>` : ""}
        <div class="cols"><div class="kv"><span class="h">Comes back</span>${li(comesBackLines(target), "Nothing listed")}</div><div class="kv no"><span class="h">Does not come back</span>${li(notSavedLines(target), "Nothing listed")}</div></div>
        <div class="row-btns"><button class="btn dark" data-act="rw-next-try">Next: Try it <kbd>↵</kbd></button>${known ? '<button class="btn" data-act="rw-find">Search again</button>' : ""}<button class="btn ghost" data-act="history">Pick a different one</button></div></div>`;
    } else {
      body = `<div class="panel"><div class="note warn">${esc(r.target ?? "That save point")} is not in the history of ${esc(p.name)}.</div>
        <div class="row-btns"><button class="btn dark" data-act="rw-find">Find the last working version</button><button class="btn ghost" data-act="history">Back to History</button></div></div>`;
    }
  } else if (r.step === "try" && target) {
    const tr = r.tryResult;
    body = `<div class="panel"><h3>Try ${esc(target.id)} in a safe copy</h3>
      <p class="muted">We rebuild ${esc(target.id)} in a separate folder and run your check there. Your real folder hasn't changed.</p>
      ${r.trying ? '<div class="steplist"><div class="r"><span class="spin"></span><span>Rebuilding and running your check…</span></div></div>' : ""}
      ${tr ? `<div class="big-verdict ${stampOnce(`rwtry:${tr.at}`)}">${glyph(tr.verdict)}<span>${esc(target.id)} ${tr.verdict === "PASS" ? "works." : `: ${verdictWord(tr.verdict)}.`}</span></div><p>${esc(tr.reason)} ${esc(seconds(tr.durationMs))}, safe copy (basic isolation).</p>` : ""}
      ${tr && tr.verdict !== "PASS" ? `<div class="note warn">We couldn't confirm ${esc(target.id)} works. You can still use it, but it is not proven.</div>` : ""}
      ${r.openResult ? `<div class="note">A copy you can open is ready.${st.settings.showGitDetails ? ` <span class="mono">${esc(r.openResult.dir)}</span>` : ""} <button class="btn" data-act="reveal" data-path="${esc(r.openResult.dir)}">Show in Finder</button></div>` : ""}
      <div class="row-btns">
        ${!tr && !r.trying ? '<button class="btn dark" data-act="rw-try">Check it in a safe copy</button>' : ""}
        ${tr ? `<button class="btn ${tr.verdict === "PASS" ? "dark" : ""}" data-act="rw-next-use">${tr.verdict === "PASS" ? "Next: Use this version" : "Use it anyway"}</button>` : ""}
        <button class="btn" data-act="rw-open" ${r.opening ? "disabled" : ""}>${r.opening ? "Making a copy…" : "Make a copy I can open"}</button>
        <button class="btn ghost" data-act="rw-back-find">Back</button></div></div>`;
  } else if (r.step === "use" && target) {
    body = `<div class="panel confirm"><h3>Use the ${esc(target.id)} version?</h3>
      <p>We will:</p><ol><li>Save your current version first, so nothing is lost.</li><li>Make a new local branch, <span class="mono">tm/recover/${esc(target.id)}</span>, at that version.</li><li>Build a recovery copy next to your project folder.</li></ol>
      <p><b>We will not push, merge, deploy or delete anything. Your folder and branch are not touched.</b></p>
      ${r.tryResult?.verdict !== "PASS" && target.verdict !== "PASS" ? `<div class="note warn">${esc(target.id)} has not passed a check.</div>` : ""}
      <div class="row-btns"><button class="btn ghost" data-act="rw-back-try" ${r.recovering ? "disabled" : ""}>Cancel</button><button class="btn dark" data-act="rw-do" ${r.recovering ? "disabled" : ""}>${r.recovering ? "Working…" : "Do it"}</button></div></div>`;
  } else if (r.step === "done" && r.result) {
    const res = r.result;
    body = `<div class="panel"><div class="big-verdict ${stampOnce(`rwdone:${res.branch}`)}">${glyph(res.lastVerdict)}<span>${esc(res.id)} is ready on a new branch.</span></div>
      <p>Last check: ${esc(verdictWord(res.lastVerdict))}${res.lastVerdict ? " (safe copy, basic isolation)" : ". Run Check it works before you rely on it"}.</p>
      <div class="git"><div><span class="k">new branch</span> ${esc(res.branch)} (local only)</div><div><span class="k">recovery copy</span> ${esc(res.copyDir)}</div><div><span class="k">saved first</span> your current version, as ${esc(res.savedBefore)}</div>${st.settings.showGitDetails ? `<div><span class="k">report</span> ${esc(res.reportPath)}</div>` : ""}</div>
      <div class="cols"><div class="kv"><span class="h">Brought back</span>${li(res.restored, "Nothing")}</div><div class="kv no"><span class="h">Not brought back</span>${li(res.notRestored, "Nothing listed")}</div></div>
      <div class="kv todo"><span class="h">Things to do by hand</span>${li(res.manualSteps, "Nothing")}</div>
      <div class="note"><b>Your folder and branch were not touched.</b> Nothing was pushed, merged, deployed or deleted.</div>
      <div class="row-btns"><button class="btn dark" data-act="history">Done</button><button class="btn" data-act="reveal" data-path="${esc(res.copyDir)}">Show recovery copy</button><button class="btn" data-act="copy-report" data-path="${esc(res.reportPath)}">Copy report</button></div></div>`;
  }
  return `<div class="scrim ${once("scrim:rewind")}"><div class="sheet wide rw-sheet" role="dialog" aria-modal="true" aria-label="${esc(`Rewind ${p.name}`)}">
    <div class="sheet-head"><div><h2>Rewind ${esc(p.name)}</h2><p class="muted">Find the last working version, try it in a safe copy, then use it on a new branch.</p></div>
      <button class="btn ghost" data-act="tv-exit" ${r.recovering ? "disabled" : ""}>Close<kbd>Esc</kbd></button></div>
    ${steps(idx, ["Find", "Try", "Use", "Done"])}
    ${r.error ? `<div class="note bad">${esc(r.error)}</div>` : ""}
    ${body}
  </div></div>`;
}

// The Time View: the Rewind as a full window scene (design spec 3.1). It draws the same
// Rewind state the plain wizard uses and calls the same engine actions.

const VERDICTS: readonly string[] = ["PASS", "FAIL", "INCOMPLETE", "BLOCKED", "ERROR"];
function asVerdict(s: string): Verdict | null {
  return VERDICTS.includes(s) ? (s as Verdict) : null;
}

/** A recorded verdict only: from the timeline, or from a check that just finished in this search. */
function shownVerdict(c: TimelineEntry | null): Verdict | null {
  if (!c) return null;
  const live = st.rewind?.progress.filter((x) => x.checkpoint === c.id).at(-1);
  return live ? asVerdict(live.verdict) : c.verdict;
}

/** The save point being checked right now, if any. */
function checkingId(): string | null {
  const r = st.rewind;
  if (!r) return null;
  if (r.trying) return r.target;
  if (!r.finding) return null;
  const pts = points();
  const last = r.progress.at(-1);
  if (!last) return pts.at(-1)?.id ?? null;
  const i = pts.findIndex((c) => c.id === last.checkpoint);
  return i > 0 ? (pts[i - 1]?.id ?? null) : null;
}

/** The save point on the stage, under the playhead. */
function stageId(): string | null {
  const r = st.rewind;
  if (!r) return null;
  if (r.finding) return checkingId() ?? r.progress.at(-1)?.checkpoint ?? null;
  return r.target ?? r.find?.tried.at(-1)?.id ?? points().at(-1)?.id ?? null;
}

/** What a rewind to this save point brings back, in plain words. From the engine's coverage report. */
function comesBackLines(c: TimelineEntry): string[] {
  return c.coverage.restorable.map((line) => {
    if (line === "Code") return st.settings.showGitDetails ? `Code, commit ${short(c.commit)}` : "Code";
    const files = /^(\d+) saved files?$/.exec(line);
    if (files) return `${plural(Number(files[1]), "file")} outside Git`;
    if (line.startsWith("Config values: ")) return `Settings: ${line.slice(15)}`;
    return line;
  });
}

function evidenceFor(c: TimelineEntry, v: Verdict | null): string {
  const vr = st.verifyResults.get(c.id);
  const same = vr && vr.verdict === v ? vr : null;
  const where = `Safe copy, basic isolation (${c.isolation ?? "host"} mode), on this Mac`;
  const took = same ? ` in ${seconds(same.durationMs)}` : "";
  const net = same ? (same.network.enforcedBy ? ", network off" : ", network on") : "";
  switch (v) {
    case "PASS":
      return `Passed its check${took}. ${where}${net}.`;
    case "FAIL":
      return `Failed its check${took}${same?.exitCode != null ? ` (exit code ${same.exitCode})` : ""}. ${where}${net}.`;
    case "INCOMPLETE":
      return "We couldn't finish the check, so we won't call it working.";
    case "BLOCKED":
      return "The check needs something before it can run.";
    case "ERROR":
      return "The check itself crashed. This doesn't mean the project is broken.";
    default:
      return "Saved, not checked. We don't know yet if it works.";
  }
}

function mosaic(c: TimelineEntry, prev: TimelineEntry | null): string {
  if (!prev) return `<div class="cd-foot">The first save point. Nothing before it to compare with.</div>`;
  const paths = st.changes.get(c.id);
  if (!paths) return `<div class="cd-foot">Reading what changed…</div>`;
  if (!paths.length) return `<div class="cd-foot">No file changes since ${esc(prev.id)}.</div>`;
  const groups = new Map<string, string[]>();
  for (const f of paths) {
    const top = f.includes("/") ? f.slice(0, f.indexOf("/")) : "top level";
    groups.set(top, [...(groups.get(top) ?? []), f]);
  }
  // Few files: name them. Many files: one grey square each, grouped by folder.
  const named = paths.length <= 8;
  const file = (f: string): string => (named ? `<span class="fc" title="${esc(f)}"><i></i>${esc(f.slice(f.lastIndexOf("/") + 1))}</span>` : `<i title="${esc(f)}"></i>`);
  const rows = [...groups]
    .slice(0, 4)
    .map(([g, fs]) => `<div class="mz"><span class="mz-l">${esc(g)}</span><span class="mz-s ${named ? "named" : ""}">${fs.slice(0, 24).map(file).join("")}</span></div>`)
    .join("");
  return `<div class="mosaic">${rows}</div><div class="cd-foot">${esc(plural(paths.length, "file"))} changed since ${esc(prev.id)}</div>`;
}

function tvCard(c: TimelineEntry, k: number, prev: TimelineEntry | null, still: boolean): string {
  const v = shownVerdict(c);
  const on = k === 0;
  const checking = checkingId() === c.id;
  const cls = ["tv-card", on ? "on" : "", k < 0 ? "ahead" : "", on && v === "PASS" && !checking ? "earned" : "", checking ? "checking" : ""].filter(Boolean).join(" ");
  const go = k > 0 && !still ? `data-act="tv-go" data-id="${esc(c.id)}"` : "";
  const mark = checking ? '<span class="vb v-checking"><i class="g" aria-hidden="true"></i>Checking</span>' : badge(v, on ? `${stampOnce(`card:${c.id}:${v ?? ""}`)}` : "");
  return `<div class="${cls}" data-carry="card-${esc(c.id)}" style="--k:${Math.max(k, -1)}" ${go}>
    <div class="cd-top"><span class="cd-g">${glyph(v)}</span><span class="cd-when">${esc(clock(c.createdAt))}</span><span class="cd-id">${esc(c.id)}</span><span class="cd-who">${esc(triggerLabel(c.trigger))}</span><span class="cd-v">${mark}</span></div>
    <div class="cd-title">${esc(c.note)}</div>
    ${on ? `<div class="cd-sum">${esc(triggerSentence(c.trigger))}</div>` : ""}
    ${on ? (checking ? `<div class="cd-run"><span class="spin"></span><span>Rebuilding ${esc(c.id)} in a safe copy and running your check. Your folder is not touched.</span></div>` : mosaic(c, prev)) : ""}
  </div>`;
}

function tvButton(act: string, label: string, key: string, keyLabel: string, primary: boolean, disabled = false): string {
  return `<button class="btn big ${primary ? "dark" : ""}" data-act="${act}" data-key="${key}" ${disabled ? "disabled" : ""}>${esc(label)}<kbd>${esc(keyLabel)}</kbd></button>`;
}

function tvRead(r: RewindState, c: TimelineEntry): string {
  const newest = points().at(-1);
  const v = shownVerdict(c);
  const cols = (a: string, b: string, yes: string[], no: string[]): string =>
    `<div class="tv-cols"><div class="kv"><span class="h">${esc(a)}</span>${li(yes, "Nothing listed")}</div><div class="kv no"><span class="h">${esc(b)}</span>${li(no, "Nothing listed")}</div></div>`;
  const meta = `<div class="tv-meta">${esc(dayLabel(c.createdAt))} ${esc(clock(c.createdAt))} · ${esc(c.note)} · ${esc(triggerLabel(c.trigger))}</div>`;
  const error = r.error ? `<div class="note bad">${esc(r.error)}</div>` : "";

  if (r.step === "done" && r.result) {
    const res = r.result;
    return `<div class="tv-verdict"><h2 class="tv-head ${stampOnce(`done:${res.branch}`)}">${esc(res.id)} is ready on a new branch.</h2>
        <div class="tv-ev">${badge(res.lastVerdict, "lg")}<span>Last check: ${esc(verdictWord(res.lastVerdict))}${res.lastVerdict ? `, in a safe copy with basic isolation (${esc(c.isolation ?? "host")} mode) on this Mac.` : ". Run Check it works before you rely on it."}</span></div>
        <div class="git"><div><span class="k">new branch</span> ${esc(res.branch)} (local only)</div><div><span class="k">recovery copy</span> ${esc(res.copyDir)}</div><div><span class="k">saved first</span> your current version, as ${esc(res.savedBefore)}</div></div></div>
      ${cols("Brought back", "Not brought back", res.restored, res.notRestored)}
      <div class="kv todo"><span class="h">Things to do by hand</span>${li(res.manualSteps, "Nothing")}</div>
      <div class="note"><b>Your folder and branch were not touched.</b> Nothing was pushed, merged, deployed or deleted.</div>
      <div class="tv-acts">${tvButton("tv-done", "Done", "enter", "↵", true)}<button class="btn big" data-act="reveal" data-path="${esc(res.copyDir)}">Show recovery copy</button><button class="btn big" data-act="copy-report" data-path="${esc(res.reportPath)}">Copy report</button></div>`;
  }

  if (r.finding) {
    const tried = r.progress.length;
    return `<div class="tv-verdict" aria-live="polite"><h2 class="tv-head">Finding the last version that works</h2>
        <div class="tv-ev"><span class="vb lg v-checking"><i class="g" aria-hidden="true"></i>Checking</span><span>${esc(c.id)}, ${tried + 1} of up to ${points().length}. Newest first, each in a safe copy.</span></div>
        ${meta}</div>
      ${cols("Comes back", "Does not come back", comesBackLines(c), notSavedLines(c))}
      <div class="tv-acts"><span class="muted small">Esc leaves this view. The search keeps going and tells you when it is done.</span></div>`;
  }

  if (r.find && !r.find.found && !r.target) {
    const last = r.find.tried.at(-1);
    const why =
      r.find.verdict === "FAIL" ? `None of the ${plural(r.find.tried.length, "save point")} passed its check.`
        : r.find.verdict === "BLOCKED" ? `We had to stop. ${last?.reason ?? ""}`
          : `We couldn't check every save point, so we won't call any of them working. ${last?.reason ?? ""}`;
    return `<div class="tv-verdict"><h2 class="tv-head">No working version found.</h2><div class="note warn">${esc(why)}</div></div>
      ${cols("Comes back", "Does not come back", comesBackLines(c), notSavedLines(c))}
      <div class="tv-acts">${tvButton("tv-exit", "Back to where I was", "enter", "↵", true)}</div>`;
  }

  if (r.step === "use") {
    const proven = v === "PASS";
    return `<div class="tv-verdict"><h2 class="tv-head">Use the ${esc(c.id)} version?</h2>${meta}</div>
      ${error}
      <div class="tv-confirm" role="group" aria-label="Confirm">
        <div class="cf-h">We will</div>
        <ol><li>Save your current version first, so nothing is lost.</li><li>Make a new local branch, <span class="mono">tm/recover/${esc(c.id)}</span>, at that version.</li><li>Build a recovery copy next to your project folder.</li></ol>
        <p><b>We will not push, merge, deploy or delete anything. Your folder and branch are not touched.</b></p>
        ${proven ? "" : `<div class="note warn">${esc(c.id)} has not passed a check. It is not proven to work.</div>`}
      </div>
      ${cols("Comes back", "Does not come back", comesBackLines(c), notSavedLines(c))}
      <div class="tv-acts">${tvButton("tv-cancel", "Cancel", "esc", "Esc", false, r.recovering)}${tvButton("tv-do", r.recovering ? "Working…" : "Do it", "enter", "↵", true, r.recovering)}</div>`;
  }

  const tr = r.tryResult && r.tryResult.checkpoint === c.id ? r.tryResult : null;
  const proven = v === "PASS";
  const head = r.trying ? `Trying ${c.id} in a safe copy`
    : proven ? `${c.id} works.`
      : v === null ? `${c.id} is saved, not checked.`
        : `${c.id}: ${verdictWord(v)}.`;
  const ev = r.trying
    ? `<span class="vb lg v-checking"><i class="g" aria-hidden="true"></i>Checking</span><span>Rebuilding it in a separate folder and running your check. Your real folder hasn't changed.</span>`
    : `${badge(v, `lg ${stampOnce(`ev:${c.id}:${v ?? ""}`)}`)}<span>${esc(tr && tr.verdict === v && v !== "PASS" && v !== "FAIL" ? `${tr.reason} ` : "")}${esc(evidenceFor(c, v))}</span>`;
  const warn = r.trying ? ""
    : tr && tr.verdict !== "PASS" ? `<div class="note warn">We couldn't confirm ${esc(c.id)} works. You can still use it, but it is not proven.</div>`
      : !proven ? `<div class="note">No passing check is recorded for ${esc(c.id)}. Try it first: we rebuild it in a safe copy and run your check.</div>` : "";
  const opened = r.openResult && r.openResult.id === c.id
    ? `<div class="note">A copy you can open is ready. Your folder was not touched.${st.settings.showGitDetails ? ` <span class="mono">${esc(r.openResult.dir)}</span>` : ""} <button class="btn" data-act="reveal" data-path="${esc(r.openResult.dir)}">Show in Finder</button></div>` : "";
  const busy = r.trying || !!st.busy;
  const notNewest = newest && newest.id !== c.id;
  return `<div class="tv-verdict" aria-live="polite"><h2 class="tv-head">${esc(head)}</h2>${meta}<div class="tv-ev">${ev}</div></div>
    ${error}${warn}${opened}
    ${cols("Comes back", "Does not come back", comesBackLines(c), notSavedLines(c))}
    <div class="tv-acts">
      ${tvButton("tv-try", tr ? "Try it again" : "Try it first", "t", "T", !proven, busy)}
      ${notNewest ? tvButton("tv-compare", "Compare with now", "c", "C", false, busy) : ""}
      ${tvButton("tv-use", "Use this version", proven ? "enter" : "use", proven ? "↵" : "", proven, busy)}
      ${r.step === "try" ? `<button class="btn big ghost" data-act="rw-open" ${r.opening || busy ? "disabled" : ""}>${r.opening ? "Making a copy…" : "Make a copy I can open"}</button>` : ""}
    </div>`;
}

function tvRuler(r: RewindState, pts: TimelineEntry[], cur: number): string {
  const n = pts.length;
  const x = (i: number): number => ((i + 0.5) / n) * 100;
  const checking = checkingId();
  // Agent sessions as clips: runs of save points made by Claude Code.
  const clips: string[] = [];
  for (let i = 0; i < n; i++) {
    if (!pts[i]?.trigger.startsWith("claude-code")) continue;
    let j = i;
    while (j + 1 < n && pts[j + 1]?.trigger.startsWith("claude-code")) j++;
    const half = (0.5 / n) * 100 * 0.7;
    clips.push(`<span class="clip" style="left:${x(i) - half}%;width:${x(j) - x(i) + half * 2}%"><span>Claude Code session</span></span>`);
    i = j;
  }
  const bars = pts
    .map((c, i) => {
      if (i === 0) return "";
      const ch = st.changes.get(c.id);
      const h = ch ? Math.max(3, Math.min(24, 4 + 6 * Math.log2(1 + ch.length))) : 3;
      return `<i class="${ch ? "" : "unk"}" style="left:${x(i)}%;height:${h.toFixed(1)}px" title="${esc(ch ? `${plural(ch.length, "file")} changed` : "Not read yet")}"></i>`;
    })
    .join("");
  const still = r.finding || r.trying || r.recovering || r.step === "done";
  const ticks = pts
    .map((c, i) => {
      const v = shownVerdict(c);
      const cls = ["tvt", i === cur ? "on" : "", c.id === checking ? "checking" : ""].filter(Boolean).join(" ");
      return `<button class="${cls}" style="left:${x(i)}%" tabindex="-1" ${still ? "" : `data-act="tv-go" data-id="${esc(c.id)}"`} title="${esc(`${clock(c.createdAt)} · ${c.note} · ${verdictWord(v)}`)}">${c.id === checking ? '<i class="g v-checking-tick" aria-hidden="true"></i>' : glyph(v)}</button>`;
    })
    .join("");
  const near = (i: number): boolean => Math.abs(i - cur) < Math.max(1, n * 0.09);
  const labels = pts
    .map((c, i) => {
      const show = n <= 12 || i === cur || ((i === 0 || i === n - 1) && !near(i));
      return show ? `<span class="${i === cur ? "on" : ""}" style="left:${x(i)}%">${esc(clock(c.createdAt))}</span>` : "";
    })
    .join("");
  const curEntry = pts[cur];
  const veilText = r.step === "done" && r.result ? `Your other version is saved as ${r.result.savedBefore}` : "These stay saved";
  const veil = cur < n - 1 ? `<div class="tv-veil" data-carry="veil" style="left:${x(cur)}%"><span>${esc(veilText)}</span></div>` : "";
  const fork =
    r.step === "done" && r.result
      ? `<svg class="tv-fork" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" vector-effect="non-scaling-stroke" d="M ${x(cur)} 100 C ${x(cur)} 50, ${x(cur)} 30, ${x(cur) + 2.5} 30 L 100 30"/></svg>
        <span class="fork-l" style="left:calc(${x(cur)}% + 34px)">${esc(r.result.branch)} · new branch, local only</span>`
      : "";
  return `<footer class="tv-ruler ${once("tv-ruler", "rise")}${fork ? " forked" : ""}">
    <div class="tv-track">
      ${fork}
      <div class="tv-lane">${clips.join("")}</div>
      <div class="tv-band" aria-hidden="true">${bars}</div>
      <div class="tv-ticks" role="slider" tabindex="0" aria-label="Save points. J and L step, Shift J and Shift L jump to the next verdict change." aria-valuemin="1" aria-valuemax="${n}" aria-valuenow="${cur + 1}" aria-valuetext="${esc(curEntry ? `Save point ${cur + 1} of ${n}. ${clock(curEntry.createdAt)}, ${curEntry.note}. ${verdictWord(shownVerdict(curEntry))}.` : "")}">${ticks}</div>
      <div class="tv-labels" aria-hidden="true">${labels}</div>
      ${veil}
      <div class="tv-ph" data-carry="ph" style="left:${x(cur)}%" aria-hidden="true"></div>
    </div>
    <div class="tv-legend" aria-hidden="true"><span>${glyph("PASS")}Works</span><span>${glyph("FAIL")}Broken</span><span>${glyph(null)}Not checked yet</span><span class="sp"></span><span><kbd>J</kbd><kbd>L</kbd> step</span><span><kbd>⇧J</kbd><kbd>⇧L</kbd> verdict change</span></div>
  </footer>`;
}

function timeView(): string {
  const r = st.rewind;
  const p = project();
  const all = points();
  if (!r || !p || !all.length) return "";
  const sid = stageId();
  let ci = all.findIndex((c) => c.id === sid);
  if (ci < 0) ci = all.length - 1;
  const end = Math.max(Math.min(all.length, 60), Math.min(all.length, ci + 21));
  const pts = all.slice(Math.max(0, end - 60), end);
  const cur = pts.findIndex((c) => c.id === all[ci]?.id);
  const c = pts[cur];
  if (!c) return "";
  const still = r.finding || r.trying || r.recovering || r.step === "done";
  const cards = pts
    .map((x, i) => ({ x, i, k: cur - i }))
    .filter((o) => o.k >= -1 && o.k <= 6)
    .map((o) => tvCard(o.x, o.k, pts[o.i - 1] ?? all[all.indexOf(o.x) - 1] ?? null, still))
    .join("");
  const newest = all.at(-1);
  const done = r.step === "done" && r.result;
  const now = newest
    ? `<button class="tv-now" data-act="tv-exit" aria-label="Back to now">
        <span class="eyebrow">Now</span>
        <span class="nw-t">${esc(newest.note)}</span>
        <span class="nw-m">${esc(newest.id)} · ${esc(clock(newest.createdAt))}</span>
        ${badge(shownVerdict(newest))}
        <span class="nw-h ${done ? stampOnce("nw-saved") : ""}">${done ? `Saved first as ${esc(r.result?.savedBefore ?? "")}` : "Your folder is untouched"}</span>
      </button>`
    : "";
  const idx = { find: 1, try: 2, use: 3, done: 4 }[r.step];
  return `<div class="tv ${once("tv")} step-${r.step}" role="dialog" aria-modal="true" aria-label="${esc(`Rewind ${p.name}`)}" tabindex="-1">
    <header class="tv-top">
      <div class="tv-name"><span class="tri" aria-hidden="true"></span><span>Rewind</span><b>${esc(p.name)}</b></div>
      ${steps(idx, ["Find", "Try", "Use", "Done"])}
      <button class="btn ghost" data-act="${r.step === "use" ? "tv-cancel" : "tv-exit"}" data-key="esc" ${r.recovering ? "disabled" : ""}>${r.step === "use" ? "Cancel" : "Back to now"}<kbd>Esc</kbd></button>
    </header>
    <div class="tv-body">
      <div class="tv-depth" aria-hidden="true"><div class="tv-stack">${cards}</div></div>
      ${now}
      <section class="tv-read" aria-label="Selected save point">${tvRead(r, c)}</section>
    </div>
    ${tvRuler(r, pts, cur)}
  </div>`;
}

function compare(): string {
  const p = project();
  const pts = points();
  if (!p) return welcome();
  const c = st.compare;
  const opt = (sel: string | null): string =>
    [...pts].reverse().map((x) => `<option value="${x.id}" ${x.id === sel ? "selected" : ""}>${esc(`${x.id} · ${when(x.createdAt)} · ${x.note} · ${verdictWord(x.verdict)}`)}</option>`).join("");
  let body = "";
  if (c.loading) body = '<div class="steplist"><div class="r"><span class="spin"></span><span>Comparing…</span></div></div>';
  else if (c.error) body = `<div class="note bad">${esc(c.error)}</div>`;
  else if (c.result) {
    const d = c.result;
    const statusWord = (s: string): string => ({ M: "changed", A: "added", D: "removed", T: "type", R: "renamed", C: "copied" })[s[0] ?? ""] ?? s;
    const parts: string[] = [];
    if (d.code.length) parts.push(plural(d.code.length, "file") + " of code changed");
    const filesN = d.files.added.length + d.files.removed.length + d.files.changed.length;
    if (filesN) parts.push(plural(filesN, "file") + " outside Git changed");
    const cfgN = d.config.added.length + d.config.removed.length + d.config.changed.length;
    if (cfgN) parts.push(plural(cfgN, "setting") + " changed");
    if (d.dependencies.changed.length) parts.push("packages changed");
    if (d.environment.changed.length) parts.push("the environment changed");
    const list = (items: { s: string; t: string }[], none: string): string =>
      items.length ? `<ul>${items.map((i) => `<li><span class="st">${esc(i.s)}</span><span class="mono sel-text">${esc(i.t)}</span></li>`).join("")}</ul>` : `<span class="muted">${esc(none)}</span>`;
    const trio = (x: { added: string[]; removed: string[]; changed: string[] }): { s: string; t: string }[] => [
      ...x.added.map((t) => ({ s: "added", t })), ...x.removed.map((t) => ({ s: "removed", t })), ...x.changed.map((t) => ({ s: "changed", t })),
    ];
    const ea = entry(d.a);
    const eb = entry(d.b);
    body = `<p class="lede">${esc(parts.length ? `Between ${d.a} and ${d.b}: ${parts.join(", ")}.` : `No differences between ${d.a} and ${d.b}.`)}</p>
      <div class="panel">
        <div class="dsec"><span class="h">Code</span>${list(d.code.map((x) => ({ s: st.settings.showGitDetails ? x.status : statusWord(x.status), t: x.path })), "No change")}</div>
        <div class="dsec"><span class="h">Files outside Git</span>${list(trio(d.files), "No change")}</div>
        <div class="dsec"><span class="h">Settings</span><div>${list(trio(d.config), "No change")}${cfgN ? '<p class="small muted" style="margin-top:6px">Values are never shown. Only key names were saved.</p>' : ""}</div></div>
        <div class="dsec"><span class="h">Packages</span>${list(d.dependencies.changed.map((t) => ({ s: "changed", t })), "No change")}</div>
        <div class="dsec"><span class="h">Environment</span>${list(d.environment.changed.map((t) => ({ s: "changed", t })), "No change")}</div>
      </div>
      ${ea?.verdict === "PASS" && eb?.verdict === "FAIL" ? `<div class="row-btns"><button class="btn dark" data-act="rewind-to" data-id="${ea.id}"><span class="tri"></span>Rewind to ${esc(ea.id)}</button></div>` : ""}`;
  }
  return `<div class="page"><div class="col">
    <div><h1>Compare</h1><p class="lede">What changed between two save points.</p></div>
    <div class="cmp-head"><select class="field" data-model="cmp-a" aria-label="Older save point">${opt(c.a)}</select><span class="muted">→</span><select class="field" data-model="cmp-b" aria-label="Newer save point">${opt(c.b)}</select><button class="btn" data-act="cmp-swap">Swap</button><button class="btn ghost" data-act="history">Back to History</button></div>
    ${body}</div></div>`;
}

function settings(): string {
  const s = st.settings;
  const seg = (v: Settings["theme"], label: string): string => `<button class="${s.theme === v ? "on" : ""}" data-act="theme" data-v="${v}">${label}</button>`;
  const sw = (key: "showGitDetails" | "overlayCards", on: boolean, label: string): string => `<button class="switch ${on ? "on" : ""}" role="switch" aria-checked="${on}" aria-label="${esc(label)}" data-act="toggle" data-key="${key}"></button>`;
  const storage = st.storage
    ? st.storage.map((r) => `<div class="tr"><div><div>${esc(r.name)}</div>${s.showGitDetails ? `<div class="mono muted">${esc(r.storeDir)}</div>` : ""}</div><span class="mono">${esc(bytes(r.bytes))}</span><button class="btn ghost" data-act="remove" data-id="${r.projectId}">Remove from app</button></div>`).join("") || '<span class="muted">No projects yet.</span>'
    : '<span class="spin"></span>';
  const agents = st.projects.map((p) => `<div class="tr"><div>${esc(p.name)}</div><span></span><button class="btn" data-act="hook" data-id="${p.id}">Connect Claude Code</button></div>`).join("") || '<span class="muted">Add a project first.</span>';
  return `<div class="page"><div class="col">
    <div><h1>Settings</h1></div>
    <div class="panel"><h3>General</h3>
      <div class="setrow"><span class="l">Appearance</span><div class="seg">${seg("system", "System")}${seg("light", "Light")}${seg("dark", "Dark")}</div></div>
      <div class="setrow"><span class="l">Rewind style</span><div class="toggle"><div class="seg"><button class="${s.simpleRewind ? "" : "on"}" data-act="rewind-style" data-v="scene">Time View</button><button class="${s.simpleRewind ? "on" : ""}" data-act="rewind-style" data-v="sheet">Simple</button></div><span class="muted">Simple shows the same four steps as a plain sheet. It is used on its own when Reduce motion is on.</span></div></div>
      <div class="setrow"><span class="l">Show Git details</span><div class="toggle">${sw("showGitDetails", s.showGitDetails, "Show Git details")}<span class="muted">Adds commit IDs, commands and logs next to the plain words. It never replaces them and never changes a verdict.</span></div></div>
    </div>
    <div class="panel"><h3>Overlays</h3>
      <div class="setrow"><span class="l">Corner cards</span><div class="toggle">${sw("overlayCards", s.overlayCards, "Corner cards")}<span class="muted">A small card in the top right when a check on the newest save point gives a new result. It never takes focus and hides on its own.</span></div></div>
      <div class="setrow"><span class="l">Timeline strip</span><div><span class="chip">${esc(keys("Mod+Shift+T"))}</span> <span class="muted">from any app</span></div></div>
    </div>
    <div class="panel"><h3>Checks</h3>
      <div class="setrow"><span class="l">Safe copy method</span><div>Basic isolation (host mode). Checks run in a separate Git worktree on this Mac, never in your folder. <span class="planned">planned</span> <span class="muted">Stronger isolation with Docker or Apple container.</span></div></div>
    </div>
    <div class="panel"><h3>Storage</h3>
      <p class="muted">Save points are stored on this Mac, outside your project folders, so deleting a project does not delete its history. This is not a full Mac backup.</p>
      <div class="table">${storage}</div>
      <div><span class="planned">planned</span> <span class="muted">Clean up older save points. Pinned and working save points will always stay.</span></div>
    </div>
    <div class="panel"><h3>Agent connections</h3>
      <p class="muted">Claude Code can save before each prompt and before risky commands, and check after each turn. We show the exact lines before we add them.</p>
      <div class="table">${agents}</div>
      <div><span class="planned">planned</span> <span class="muted">Cursor, Codex and Gemini CLI.</span></div>
    </div>
  </div></div>`;
}

function onboarding(): string {
  const o = st.onboarding;
  let body = "";
  if (o.step === 1) {
    body = `<div><h1>Which project should we look after?</h1><p class="lede">Pick the folder of a project that uses Git. We only read the folder you pick.</p></div>
      <div class="panel"><div class="row-btns"><button class="btn dark" data-act="ob-choose">Choose folder…</button><span class="mono muted">${esc(o.path ?? "No folder chosen")}</span></div>
      <p class="small muted">We'll add one small settings file, timemachine.yml, to this folder. Nothing else in it changes. Save points are stored outside it.</p></div>
      <div class="row-btns"><button class="btn dark" data-act="ob-next1" ${!o.path || o.working ? "disabled" : ""}>${o.working ? "Setting up…" : "Continue"}</button><button class="btn ghost" data-act="demo">Try the demo instead</button></div>`;
  } else if (o.step === 2 && o.project) {
    const detected = o.init?.verifyCommand ?? "";
    const optRow = (key: OnboardingState["choice"], title: string, cmd: string, rec: boolean): string =>
      `<label class="opt ${o.choice === key ? "on" : ""}"><input type="radio" name="check" data-act="ob-choice" data-v="${key}" ${o.choice === key ? "checked" : ""}><span><div class="t">${esc(title)}</div>${cmd ? `<div class="d mono">${esc(cmd)}</div>` : ""}</span><span class="small muted">${rec ? "recommended" : ""}</span></label>`;
    const fv = o.tryResult && o.first && o.tryResult.checkpoint === o.first.id ? o.tryResult.verdict : null;
    const firstNote = o.first
      ? `<div class="first-sp">${glyph(fv)}<span><b>Your first save point is made: ${esc(o.first.id)}.</b> ${fv ? `Checked: ${esc(verdictWord(fv))}.` : "Saved, not checked. Try the check below to find out if it works."}</span></div>`
      : "";
    body = `<div><h1>How should we check that ${esc(o.project.name)} works?</h1><p class="lede">A check is a command. If it finishes without an error, the version works.</p></div>
      ${firstNote}
      <div class="panel">
        ${detected ? optRow("detected", detected === "npm run build" ? "Build it" : "Run the tests", detected, true) : ""}
        ${detected !== "npm run build" ? optRow("build", "Build it", "npm run build", false) : ""}
        <label class="opt ${o.choice === "custom" ? "on" : ""}"><input type="radio" name="check" data-act="ob-choice" data-v="custom" ${o.choice === "custom" ? "checked" : ""}><span style="display:grid;gap:6px"><div class="t">My own command</div><input class="field" data-model="ob-custom" placeholder="for example: npm test" value="${esc(o.custom)}"></span><span></span></label>
        <p class="small muted">Checks run in a safe copy, never in your folder.${o.init?.network === "deny" ? " The internet is off during checks." : " The internet stays on during checks on this Mac, because no sandbox was found."}</p>
        <div class="row-btns"><button class="btn" data-act="ob-try" ${o.trying ? "disabled" : ""}>${o.trying ? "Checking…" : "Try it now"}</button>
          ${o.trying ? '<span class="spin"></span>' : o.tryResult ? `${badge(o.tryResult.verdict, stampOnce(`ob:${o.tryResult.at}`))}<span class="small muted">${esc(o.tryResult.reason)} ${esc(seconds(o.tryResult.durationMs))}</span>` : ""}</div>
        ${o.tryResult && o.tryResult.verdict === "FAIL" ? `<div class="note">It doesn't pass right now. That's OK. We'll save it as Broken, and the next version that passes becomes your first working save point.</div>` : ""}
      </div>
      <div class="row-btns"><button class="btn dark" data-act="ob-next2" ${o.working || o.trying ? "disabled" : ""}>Continue</button><button class="btn ghost" data-act="ob-back">Back</button></div>`;
  } else if (o.step === 3 && o.project) {
    const h = o.hook;
    body = `<div><h1>When should we save?</h1><p class="lede">Save points are cheap. More of them means a closer way back.</p></div>
      <div class="panel">
        <label class="opt on"><input type="checkbox" checked disabled><span><div class="t">When I press Save now</div><div class="d">Always on. ${esc(keys("Mod+S"))} in the app, or from the menu bar.</div></span><span></span></label>
        <div class="opt"><span></span><span><div class="t">Before and after each Claude Code turn, and before risky commands</div><div class="d">Adds hooks to ${esc(h?.settingsPath ?? ".claude/settings.json")}. We show the exact lines first.</div>
          ${h ? `<pre class="code" style="margin-top:8px">${esc(h.lines.map((l) => `${l.event}: ${l.command}`).join("\n"))}</pre>` : ""}
          ${o.hookDone ? `<div class="note" style="margin-top:8px">${esc(o.hookDone)}</div>` : `<div class="row-btns" style="margin-top:8px"><button class="btn" data-act="ob-hook" ${o.working ? "disabled" : ""}>Add these lines</button></div>`}</span><span class="small muted">recommended</span></div>
        <div class="opt"><span></span><span><div class="t">Every hour while files are changing</div><div class="d">Not built yet.</div></span><span class="planned">planned</span></div>
      </div>
      <div class="row-btns"><button class="btn dark" data-act="ob-finish" ${o.working ? "disabled" : ""}>${o.working ? "Saving…" : "Finish"}</button><button class="btn ghost" data-act="ob-back">Back</button></div>`;
  }
  return `<div class="page"><div class="col narrow">
    <div class="dots3" aria-label="Step ${o.step} of 3"><i class="${o.step >= 1 ? "on" : ""}"></i><i class="${o.step >= 2 ? "on" : ""}"></i><i class="${o.step >= 3 ? "on" : ""}"></i></div>
    ${o.error ? `<div class="note bad">${esc(o.error)}</div>` : ""}
    ${body}</div></div>`;
}

function hookSheet(): string {
  const h = st.hookSheet;
  if (!h) return "";
  const p = st.projects.find((x) => x.id === h.projectId);
  return `<div class="scrim ${once("scrim:hook")}"><div class="sheet" role="dialog" aria-modal="true" aria-label="Connect Claude Code">
    <h2>Connect Claude Code to ${esc(p?.name ?? "this project")}?</h2>
    <p>We'll add these lines to <span class="mono">${esc(h.preview.settingsPath)}</span> and keep everything already there:</p>
    <pre class="code cmd">${esc(h.preview.lines.map((l) => `${l.event}: ${l.command}`).join("\n"))}</pre>
    <p class="small muted">Claude Code will then save before each prompt and before risky commands, and check after each turn. If a turn breaks a working version, Claude is told.</p>
    ${h.error ? `<div class="note bad">${esc(h.error)}</div>` : ""}${h.done ? `<div class="note">${esc(h.done)}</div>` : ""}
    <div class="row-btns" style="justify-content:flex-end"><button class="btn ghost" data-act="hook-close">${h.done ? "Done" : "Cancel"}</button>${h.done ? "" : `<button class="btn dark" data-act="hook-do" ${h.working ? "disabled" : ""}>Add these lines</button>`}</div>
  </div></div>`;
}

function inspector(): string {
  if (!st.inspector) return "";
  const rec = st.records[0];
  const c = entry(st.selected);
  const p = project();
  const block = (title: string, command: string | null, json: unknown): string => `<div style="display:grid;gap:8px"><div class="kv"><span class="h">${esc(title)}</span></div>
    ${command ? `<pre class="code cmd">${esc(command)}</pre><div class="row-btns"><button class="btn" data-act="copy" data-text="${esc(command)}">Copy as command</button></div>` : '<p class="small muted">No tm command for this. It is app only.</p>'}
    <pre class="code">${esc(JSON.stringify(json, null, 2))}</pre></div>`;
  return `<aside class="drawer ${once("drawer")}" role="complementary" aria-label="Inspector"><header><h2>Inspector</h2><span class="muted small">${esc(keys("Mod+I"))}</span><button class="btn ghost" data-act="inspector">Close</button></header>
    <div class="body">
      <p class="small muted">The raw engine result and the same action as a tm command. The app and the CLI call the same engine.</p>
      ${rec ? block(`Last action: ${rec.title} · ${when(rec.at)}`, rec.command, rec.json) : '<p class="muted">No actions yet. Press Save now or Check it works.</p>'}
      ${c && p ? block(`Selected save point: ${c.id}`, tmCommand({ method: "timeline", projectId: p.id }, p.path), c) : ""}
      ${st.records.length > 1 ? `<div class="kv"><span class="h">Earlier</span>${st.records.slice(1, 8).map((r) => `<div class="mono small muted">${esc(when(r.at))} · ${esc(r.title)}</div>`).join("")}</div>` : ""}
    </div></aside>`;
}

function busyScrim(): string {
  if (!st.demoBusy) return "";
  return `<div class="scrim ${once("scrim:demo")}"><div class="sheet"><h2>Building the demo</h2>
    <div class="steplist"><div class="r"><span class="spin"></span><span>Making Marigold Tips, a small app with tests, then breaking it on purpose. The real engine finds the last working version and prepares a recovery branch.</span></div></div>
    <p class="small muted">This takes a few seconds. It happens in a new temporary folder.</p></div></div>`;
}

// Motion helpers. The window is redrawn from state, so these carry movement across redraws.

/** Keys seen in the last draw. An entrance animation plays only the first time its key appears. */
let seenOnce = new Set<string>();
let drawOnce = new Set<string>();
function once(key: string, cls = "enter"): string {
  drawOnce.add(key);
  return seenOnce.has(key) ? "" : cls;
}
/** The verdict stamp plays once, when a verdict is new on screen. */
function stampOnce(key: string): string {
  return once(`stamp:${key}`, "stamp");
}

/** Inline styles of elements marked data-carry, so a redraw can animate from where they were. */
const carried = new Map<string, string>();
function captureCarry(): void {
  document.querySelectorAll<HTMLElement>("[data-carry]").forEach((el) => carried.set(el.dataset.carry ?? "", el.getAttribute("style") ?? ""));
}
function applyCarry(): void {
  const moves: [HTMLElement, string][] = [];
  document.querySelectorAll<HTMLElement>("[data-carry]").forEach((el) => {
    const before = carried.get(el.dataset.carry ?? "");
    const now = el.getAttribute("style") ?? "";
    if (before === undefined || before === now) return;
    el.setAttribute("style", `${before};transition:none`);
    moves.push([el, now]);
  });
  if (!moves.length) return;
  void document.body.offsetWidth;
  for (const [el, now] of moves) el.setAttribute("style", now);
}

/** Entering the Time View: the playhead glides in from Now on the right. */
function enterScene(): void {
  carried.clear();
  carried.set("ph", "left:100%");
  carried.set("veil", "left:100%");
}

/** A shortcut fired: its button shows the pressed state for about 120 ms, so shortcuts are learned by seeing them. */
function flash(sel: string): void {
  st.flash = { sel, until: Date.now() + 120 };
  applyFlash();
}
function applyFlash(): void {
  const f = st.flash;
  if (!f) return;
  const left = f.until - Date.now();
  const el = root.querySelector<HTMLElement>(f.sel);
  if (left <= 0 || !el) {
    if (left <= 0) st.flash = null;
    return;
  }
  el.classList.add("kf");
  setTimeout(() => el.classList.remove("kf"), left);
}

/** A selector for the focused control, so focus survives a redraw. */
function focusKey(): string | null {
  const a = document.activeElement;
  if (!(a instanceof HTMLElement) || a === document.body) return null;
  if (a.dataset.act) return `[data-act="${CSS.escape(a.dataset.act)}"]${a.dataset.id ? `[data-id="${CSS.escape(a.dataset.id)}"]` : ""}`;
  if (a.dataset.model) return `[data-model="${CSS.escape(a.dataset.model)}"]`;
  if (a.classList.contains("tv-ticks")) return ".tv-ticks";
  return null;
}

function render(): void {
  const scroll = document.getElementById("list")?.scrollTop ?? 0;
  const pageScroll = document.querySelector(".page")?.scrollTop ?? 0;
  const focus = focusKey();
  captureCarry();
  drawOnce = new Set();
  const scene = st.screen === "rewind" && st.rewind?.mode === "scene";
  const main =
    st.screen === "welcome" ? welcome()
      : st.screen === "onboarding" ? onboarding()
        : st.screen === "rewind" ? (scene ? history() : `${history()}${rewind()}`)
          : st.screen === "compare" ? compare()
            : st.screen === "settings" ? settings()
              : history();
  root.innerHTML = `<div class="shell">
    ${opts.preview ? `<div class="banner"><span><b>Preview with demo data.</b> Download the app to use it on your projects.</span>${(opts.previewActions ?? []).map((a, i) => `<button class="btn" data-act="preview" data-i="${i}">${esc(a.label)}</button>`).join("")}</div>` : ""}
    <div class="app">${scene ? sidebar().replace('<aside class="side">', '<aside class="side" inert>') : sidebar()}<main class="main" ${scene ? "inert" : ""}><div class="dragbar"></div>${main}${st.check ? checkSheet() : ""}${hookSheet()}${busyScrim()}</main>${scene ? timeView() : ""}${inspector()}${st.toast ? `<div class="toast ${once(`toast:${st.toast}`)}" role="status">${esc(st.toast)}</div>` : ""}</div></div>`;
  seenOnce = drawOnce;
  const list = document.getElementById("list");
  if (list) list.scrollTop = scroll;
  const page = document.querySelector(".page");
  if (page) page.scrollTop = pageScroll;
  placePlayhead();
  applyCarry();
  applyFlash();
  const tv = root.querySelector<HTMLElement>(".tv");
  const again = focus ? root.querySelector<HTMLElement>(focus) : null;
  if (again && !(again instanceof HTMLButtonElement && again.disabled)) again.focus({ preventScroll: true });
  else if (tv && !tv.contains(document.activeElement)) tv.focus({ preventScroll: true });
}

function placePlayhead(): void {
  const ph = document.getElementById("playhead");
  if (!ph || !st.selected) return;
  const tick = document.querySelector<HTMLElement>(`.ruler .tk[data-id="${st.selected}"]`);
  if (tick) ph.style.left = `${tick.offsetLeft + tick.offsetWidth / 2 - 0.75}px`;
  else ph.style.display = "none";
}

function applyTheme(): void {
  if (st.settings.theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", st.settings.theme);
}

// Actions

async function saveNow(): Promise<void> {
  const p = project();
  if (!p || st.busy) return;
  st.busy = "Saving";
  render();
  try {
    const r: CheckpointResult = await api({ method: "checkpoint", projectId: p.id, note: "Saved by you" });
    st.selected = r.checkpoint.id;
    await loadTimeline();
    st.selected = r.checkpoint.id;
    st.busy = null;
    toast(`Saved as ${r.checkpoint.id}. Not checked yet.`);
  } catch (e) {
    st.busy = null;
    toast(msg(e));
  }
  void refreshStatuses().then(render);
}

async function checkNow(id?: string): Promise<void> {
  const p = project();
  if (!p || st.busy) return;
  st.busy = "Checking";
  st.check = { phase: id ? "checking" : "saving", cp: id ?? null, skipped: false, result: null, error: null };
  render();
  try {
    let target = id;
    if (!target) {
      const saved = await api({ method: "checkpoint", projectId: p.id, note: "Saved before a check", ifChanged: true });
      target = saved.checkpoint.id;
      st.check = { ...st.check, phase: "checking", cp: target, skipped: saved.skipped };
      render();
    }
    const result = await api({ method: "verify", projectId: p.id, id: target });
    st.check = { ...st.check, phase: "done", result };
    await loadTimeline();
    st.selected = target;
  } catch (e) {
    st.check = { ...st.check, phase: "done", error: msg(e) };
  }
  st.busy = null;
  await refreshStatuses();
  render();
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The Time View, unless the user asked for the plain sheet or the system asks for less motion. */
function rewindMode(): RewindState["mode"] {
  return st.settings.simpleRewind || reducedMotion() ? "sheet" : "scene";
}

function here(): ReturnPoint {
  return {
    screen: st.screen === "rewind" ? "history" : st.screen,
    selected: st.selected,
    listScroll: document.getElementById("list")?.scrollTop ?? 0,
    pageScroll: document.querySelector(".page")?.scrollTop ?? 0,
  };
}

function newRewind(target: string | null, returnTo: ReturnPoint = here()): RewindState {
  return {
    step: "find", mode: rewindMode(), returnTo, target, finding: false, find: null, progress: [], trying: false, tryResult: null,
    opening: false, openResult: null, recovering: false, result: null, error: null,
  };
}

async function startRewind(target?: string): Promise<void> {
  const p = project();
  if (!p) return;
  // A search that is still running in the background: step back into it.
  if (st.rewind?.finding && !target) {
    st.screen = "rewind";
    render();
    return;
  }
  if (st.busy) return;
  const back = st.screen === "rewind" && st.rewind ? st.rewind.returnTo : here();
  st.check = null;
  st.screen = "rewind";
  enterScene();
  if (target) {
    st.rewind = newRewind(target, back);
    render();
    void loadChanges();
    return;
  }
  st.rewind = newRewind(null, back);
  await findGood();
}

async function findGood(): Promise<void> {
  const p = project();
  if (!p || st.busy) return;
  st.rewind = { ...newRewind(null, st.rewind?.returnTo), finding: true };
  st.busy = "Finding";
  render();
  void loadChanges();
  try {
    const r = await api({ method: "findGood", projectId: p.id });
    st.rewind = { ...st.rewind, finding: false, find: r, target: r.found };
  } catch (e) {
    st.rewind = { ...st.rewind, finding: false, error: msg(e) };
  }
  st.busy = null;
  await loadTimeline();
  await refreshStatuses();
  if (st.screen !== "rewind" && st.rewind) {
    const found = st.rewind.find?.found;
    toast(found ? `Found it. ${found} is the last version that works. Press ${keys("Mod+Shift+R")} to see it.` : "We could not find a version that passes its check.");
    return;
  }
  render();
}

/** Leave the Rewind with no change, back to exactly where the user was. */
function exitRewind(): void {
  const r = st.rewind;
  const finished = r?.step === "done" ? r.result : null;
  const back = r?.returnTo ?? { screen: "history" as Screen, selected: st.selected, listScroll: 0, pageScroll: 0 };
  // A running search keeps going in the background. Everything else is let go.
  if (!r?.finding) st.rewind = null;
  st.screen = back.screen;
  const ids = points().map((c) => c.id);
  if (back.selected && ids.includes(back.selected)) st.selected = back.selected;
  render();
  const list = document.getElementById("list");
  if (list) list.scrollTop = back.listScroll;
  const page = document.querySelector(".page");
  if (page) page.scrollTop = back.pageScroll;
  if (finished) toast(`${finished.branch} is ready. Your folder and branch were not touched. Nothing was pushed.`);
}

/** Put the Time View playhead on another save point. Nothing runs until Try or Use. */
function tvGo(id: string | undefined): void {
  const r = st.rewind;
  if (!id || !r || r.finding || r.trying || r.recovering || r.step === "done" || r.target === id) return;
  if (!entry(id)) return;
  r.target = id;
  r.step = "find";
  r.error = null;
  render();
}

function tvStep(how: "back" | "forward" | "prevChange" | "nextChange" | "first" | "last"): void {
  const pts = points();
  const i = pts.findIndex((c) => c.id === st.rewind?.target);
  if (i < 0) return;
  const v = (j: number): string => verdictKey(shownVerdict(pts[j] ?? null));
  let j = i;
  if (how === "back") j = i - 1;
  else if (how === "forward") j = i + 1;
  else if (how === "first") j = 0;
  else if (how === "last") j = pts.length - 1;
  else if (how === "prevChange") {
    j = i - 1;
    while (j > 0 && v(j) === v(j + 1)) j--;
  } else {
    j = i + 1;
    while (j < pts.length - 1 && v(j) === v(j - 1)) j++;
  }
  tvGo(pts[Math.max(0, Math.min(pts.length - 1, j))]?.id);
}

/** Read what changed in each save point, oldest first, without blocking anything. */
let changesFor = "";
async function loadChanges(): Promise<void> {
  const p = project();
  const pts = points().slice(-40);
  const key = `${p?.id ?? ""}:${pts.at(-1)?.id ?? ""}`;
  if (!p || changesFor === key) return;
  changesFor = key;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (!a || !b || st.changes.has(b.id)) continue;
    const r = await bridge.call({ method: "diff", projectId: p.id, a: a.id, b: b.id });
    if (st.projectId !== p.id) return;
    if (!r.ok) continue;
    const d = r.data;
    st.changes.set(b.id, [...d.code.map((x) => x.path), ...d.files.added, ...d.files.removed, ...d.files.changed]);
  }
  if (st.screen === "rewind" && st.rewind?.mode === "scene") render();
}

async function rewindTry(): Promise<void> {
  const p = project();
  const r = st.rewind;
  if (!p || !r?.target || st.busy) return;
  r.trying = true;
  r.tryResult = null;
  st.busy = "Checking";
  render();
  try {
    r.tryResult = await api({ method: "verify", projectId: p.id, id: r.target });
  } catch (e) {
    r.error = msg(e);
  }
  r.trying = false;
  st.busy = null;
  await loadTimeline();
  render();
}

async function tvTry(): Promise<void> {
  const r = st.rewind;
  if (!r?.target || st.busy || r.finding || r.recovering) return;
  r.step = "try";
  await rewindTry();
}

async function rewindOpen(): Promise<void> {
  const p = project();
  const r = st.rewind;
  if (!p || !r?.target) return;
  r.opening = true;
  render();
  try {
    r.openResult = await api({ method: "open", projectId: p.id, id: r.target });
  } catch (e) {
    r.error = msg(e);
  }
  r.opening = false;
  render();
}

async function rewindDo(): Promise<void> {
  const p = project();
  const r = st.rewind;
  if (!p || !r?.target || st.busy) return;
  r.recovering = true;
  st.busy = "Recovering";
  render();
  try {
    r.result = await api({ method: "recover", projectId: p.id, id: r.target });
    r.step = "done";
  } catch (e) {
    r.error = msg(e);
  }
  r.recovering = false;
  st.busy = null;
  await loadTimeline();
  await refreshStatuses();
  render();
}

async function openCompare(a?: string, b?: string): Promise<void> {
  const pts = points();
  const newest = pts.at(-1);
  const older = lastWorking()?.id ?? pts.at(-2)?.id ?? newest?.id ?? null;
  st.compare = { a: a ?? older, b: b ?? newest?.id ?? null, result: null, loading: false, error: null };
  st.screen = "compare";
  await runDiff();
}

async function runDiff(): Promise<void> {
  const p = project();
  const { a, b } = st.compare;
  if (!p || !a || !b) {
    render();
    return;
  }
  st.compare.loading = true;
  render();
  try {
    st.compare.result = await api({ method: "diff", projectId: p.id, a, b });
    st.compare.error = null;
  } catch (e) {
    st.compare.error = msg(e);
  }
  st.compare.loading = false;
  render();
}

async function tryCopy(id: string): Promise<void> {
  const p = project();
  if (!p || st.busy) return;
  st.busy = "Making a safe copy";
  render();
  try {
    st.openResult = await api({ method: "open", projectId: p.id, id });
  } catch (e) {
    toast(msg(e));
  }
  st.busy = null;
  render();
}

async function runDemo(): Promise<void> {
  if (st.demoBusy) return;
  st.demoBusy = true;
  render();
  try {
    const r = await api({ method: "demo" });
    if (!st.projects.some((p) => p.id === r.project.id)) st.projects.push(r.project);
    st.demoBusy = false;
    await refreshStatuses();
    await selectProject(r.project.id);
    toast(`Demo ready. ${r.result.findGood.found ?? "No save point"} was the last working version, and a recovery branch was made.`);
  } catch (e) {
    st.demoBusy = false;
    toast(msg(e));
  }
}

async function obChoose(): Promise<void> {
  try {
    const path = await api({ method: "chooseFolder" });
    if (path) st.onboarding = { ...st.onboarding, path, error: null };
  } catch (e) {
    st.onboarding.error = msg(e);
  }
  render();
}

async function obNext1(): Promise<void> {
  const o = st.onboarding;
  if (!o.path) return;
  o.working = true;
  o.error = null;
  render();
  try {
    const proj = await api({ method: "addProject", path: o.path });
    if (!st.projects.some((p) => p.id === proj.id)) st.projects.push(proj);
    const init = await api({ method: "init", projectId: proj.id });
    st.projectId = proj.id;
    void bridge.call({ method: "setActive", projectId: proj.id });
    // The first save point, made for the user. It stays "Saved, not checked" until a check runs.
    const first = await api({ method: "checkpoint", projectId: proj.id, note: "First save point", ifChanged: true });
    st.onboarding = { ...o, step: 2, project: proj, init, first: first.checkpoint, current: init.verifyCommand, choice: init.verifyCommand ? "detected" : "custom", custom: "", working: false };
  } catch (e) {
    st.onboarding = { ...o, working: false, error: msg(e) };
  }
  render();
}

function obCommand(): string {
  const o = st.onboarding;
  return o.choice === "detected" ? (o.init?.verifyCommand ?? "") : o.choice === "build" ? "npm run build" : o.custom.trim();
}

async function obApplyCheck(): Promise<boolean> {
  const o = st.onboarding;
  const cmd = obCommand();
  if (!o.project) return false;
  if (!cmd) {
    o.error = "Pick a check, or type your own command.";
    return false;
  }
  if (cmd !== o.current) {
    await api({ method: "setCheck", projectId: o.project.id, command: cmd });
    o.current = cmd;
  }
  return true;
}

async function obTry(): Promise<void> {
  const o = st.onboarding;
  if (!o.project) return;
  o.trying = true;
  o.error = null;
  o.tryResult = null;
  render();
  try {
    if (await obApplyCheck()) {
      const id = o.first?.id ?? (await api({ method: "checkpoint", projectId: o.project.id, note: "First save point", ifChanged: true })).checkpoint.id;
      o.tryResult = await api({ method: "verify", projectId: o.project.id, id });
    }
  } catch (e) {
    o.error = msg(e);
  }
  o.trying = false;
  render();
}

async function obNext2(): Promise<void> {
  const o = st.onboarding;
  if (!o.project) return;
  o.working = true;
  o.error = null;
  render();
  try {
    if (await obApplyCheck()) {
      o.hook = await api({ method: "hookPreview", projectId: o.project.id });
      o.step = 3;
    }
  } catch (e) {
    o.error = msg(e);
  }
  o.working = false;
  render();
}

async function obHook(): Promise<void> {
  const o = st.onboarding;
  if (!o.project) return;
  o.working = true;
  render();
  try {
    const r = await api({ method: "hookInstall", projectId: o.project.id });
    o.hookDone = r.added.length ? `Added: ${r.added.join(", ")}.` : "Claude Code was already connected. Nothing changed.";
  } catch (e) {
    o.error = msg(e);
  }
  o.working = false;
  render();
}

async function obFinish(): Promise<void> {
  const o = st.onboarding;
  if (!o.project) return;
  o.working = true;
  render();
  try {
    await api({ method: "checkpoint", projectId: o.project.id, note: "First save point", ifChanged: true });
    st.settings = await api({ method: "setSettings", patch: { onboarded: true } });
    const id = o.project.id;
    st.onboarding = emptyOnboarding();
    await refreshStatuses();
    await selectProject(id);
    const v = points().at(-1)?.verdict ?? null;
    toast(v === "PASS" ? "You're set. Your newest save point passed its check." : v ? `You're set. Your newest save point is ${verdictWord(v).toLowerCase()}.` : "You're set. Your newest save point is saved, not checked. A tick turns green only after a check passes.");
  } catch (e) {
    o.error = msg(e);
    o.working = false;
    render();
  }
}

async function openHookSheet(projectId: string): Promise<void> {
  try {
    const preview = await api({ method: "hookPreview", projectId });
    st.hookSheet = { projectId, preview, done: null, error: null, working: false };
  } catch (e) {
    toast(msg(e));
  }
  render();
}

async function doHook(): Promise<void> {
  const h = st.hookSheet;
  if (!h) return;
  h.working = true;
  render();
  try {
    const r = await api({ method: "hookInstall", projectId: h.projectId });
    h.done = r.added.length ? `Added: ${r.added.join(", ")}. Saved in ${r.settingsPath}.` : "Claude Code was already connected. Nothing changed.";
  } catch (e) {
    h.error = msg(e);
  }
  h.working = false;
  render();
}

async function openSettings(): Promise<void> {
  st.screen = "settings";
  st.storage = null;
  render();
  try {
    st.storage = await api({ method: "storage" });
  } catch {
    st.storage = [];
  }
  render();
}

async function setSetting(patch: Partial<Settings>): Promise<void> {
  try {
    st.settings = await api({ method: "setSettings", patch });
    applyTheme();
  } catch (e) {
    toast(msg(e));
  }
  render();
}

function startAdd(): void {
  st.onboarding = emptyOnboarding();
  st.screen = "onboarding";
  render();
}

async function onClick(el: HTMLElement): Promise<void> {
  const d = el.dataset;
  switch (d.act) {
    case "project":
      if (d.id) await selectProject(d.id);
      return;
    case "add":
      return startAdd();
    case "demo":
      return runDemo();
    case "settings":
      return openSettings();
    case "inspector":
      st.inspector = !st.inspector;
      return render();
    case "history":
      if (st.screen === "rewind") return exitRewind();
      st.screen = "history";
      st.rewind = null;
      await loadTimeline();
      return render();
    case "tv-exit":
    case "tv-done":
      if (!st.rewind?.recovering) exitRewind();
      return;
    case "tv-go":
      return tvGo(d.id);
    case "tv-try":
      return tvTry();
    case "tv-use":
      if (st.rewind && !st.busy) {
        st.rewind.step = "use";
        render();
      }
      return;
    case "tv-cancel":
      if (st.rewind && !st.rewind.recovering) {
        st.rewind.step = st.rewind.tryResult?.checkpoint === st.rewind.target ? "try" : "find";
        render();
      }
      return;
    case "tv-do":
      return rewindDo();
    case "tv-compare":
      if (st.rewind?.target) return openCompare(st.rewind.target, points().at(-1)?.id);
      return;
    case "rewind-style":
      return setSetting({ simpleRewind: d.v === "sheet" });
    case "reload":
      await loadTimeline();
      return render();
    case "select":
      st.selected = d.id ?? null;
      st.openResult = null;
      return render();
    case "save":
      return saveNow();
    case "check":
      return checkNow();
    case "verify-one":
      return checkNow(d.id);
    case "close-check":
      st.check = null;
      return render();
    case "rewind":
      return startRewind();
    case "rewind-to":
    case "use":
      return startRewind(d.id);
    case "rw-find":
      return findGood();
    case "rw-next-try":
      if (st.rewind) st.rewind.step = "try";
      render();
      if (st.rewind && !st.rewind.tryResult) await rewindTry();
      return;
    case "rw-try":
      return rewindTry();
    case "rw-open":
      return rewindOpen();
    case "rw-next-use":
      if (st.rewind) st.rewind.step = "use";
      return render();
    case "rw-back-find":
      if (st.rewind) st.rewind.step = "find";
      return render();
    case "rw-back-try":
      if (st.rewind) st.rewind.step = "try";
      return render();
    case "rw-do":
      return rewindDo();
    case "try":
      if (d.id) await tryCopy(d.id);
      return;
    case "compare":
      return openCompare(d.a, d.b);
    case "cmp-swap":
      st.compare = { ...st.compare, a: st.compare.b, b: st.compare.a };
      return runDiff();
    case "reveal":
      if (d.path) {
        const r = await bridge.call({ method: "reveal", path: d.path });
        if (!r.ok) toast(r.error.message);
      }
      return;
    case "copy":
      if (d.text !== undefined) {
        await bridge.call({ method: "copy", text: d.text });
        toast("Copied.");
      }
      return;
    case "copy-report":
      if (d.path) {
        try {
          const text = await api({ method: "readReport", path: d.path });
          await bridge.call({ method: "copy", text });
          toast("Recovery report copied as Markdown.");
        } catch (e) {
          toast(msg(e));
        }
      }
      return;
    case "theme":
      return setSetting({ theme: d.v === "light" || d.v === "dark" ? d.v : "system" });
    case "toggle":
      if (d.key === "showGitDetails") return setSetting({ showGitDetails: !st.settings.showGitDetails });
      if (d.key === "overlayCards") return setSetting({ overlayCards: !st.settings.overlayCards });
      return;
    case "remove":
      if (d.id) {
        try {
          st.projects = await api({ method: "removeProject", projectId: d.id });
          if (st.projectId === d.id) st.projectId = st.projects[0]?.id ?? null;
          toast("Removed from the app. Its save points stay in the store.");
          if (st.screen === "settings") await openSettings();
          else if (st.projectId) await selectProject(st.projectId);
          else {
            st.screen = "welcome";
            render();
          }
        } catch (e) {
          toast(msg(e));
        }
      }
      return;
    case "hook":
      if (d.id) await openHookSheet(d.id);
      return;
    case "hook-do":
      return doHook();
    case "hook-close":
      st.hookSheet = null;
      return render();
    case "ob-choose":
      return obChoose();
    case "ob-next1":
      return obNext1();
    case "ob-choice":
      if (d.v === "detected" || d.v === "build" || d.v === "custom") st.onboarding.choice = d.v;
      return render();
    case "ob-try":
      return obTry();
    case "ob-next2":
      return obNext2();
    case "ob-back":
      st.onboarding.step = st.onboarding.step === 3 ? 2 : 1;
      return render();
    case "ob-hook":
      return obHook();
    case "ob-finish":
      return obFinish();
    case "preview":
      opts.previewActions?.[Number(d.i)]?.run();
      return;
    default:
      return;
  }
}

function shortcut(action: ShortcutAction): void {
  const inProject = !!project() && st.screen !== "onboarding" && st.screen !== "rewind";
  switch (action) {
    case "save":
      if (inProject) void saveNow();
      return;
    case "check":
      if (inProject) void checkNow();
      return;
    case "rewind":
      if (inProject && points().length) void startRewind();
      return;
    case "compare":
      if (inProject && points().length) void openCompare();
      return;
    case "inspector":
      st.inspector = !st.inspector;
      return render();
    case "settings":
      void openSettings();
      return;
    case "add":
      return startAdd();
  }
}

/** The Rewind's own keys. Returns true when the key was used. */
function rewindKey(e: KeyboardEvent): boolean {
  const r = st.rewind;
  if (!r || st.screen !== "rewind" || e.metaKey || e.ctrlKey || e.altKey) return false;
  const k = e.key;
  if (r.mode === "sheet") {
    if (r.recovering) return false;
    if (k === "Escape") exitRewind();
    else if (k === "Enter") root.querySelector<HTMLButtonElement>(".rw-sheet .btn.dark:not([disabled])")?.click();
    else return false;
    return true;
  }
  if (k === "Escape") {
    flash('.tv [data-key="esc"]');
    if (r.recovering) return true;
    if (r.step === "use") {
      r.step = r.tryResult?.checkpoint === r.target ? "try" : "find";
      render();
    } else exitRewind();
    return true;
  }
  if (k === "Enter") {
    // Enter never waits for an animation. It does the main action now.
    flash('.tv [data-key="enter"]');
    if (r.finding || r.trying || r.recovering || st.busy) return true;
    if (r.step === "done" || (r.find && !r.find.found && !r.target)) {
      exitRewind();
      return true;
    }
    const c = entry(r.target);
    if (!c) return true;
    if (r.step === "use") void rewindDo();
    else if (shownVerdict(c) === "PASS") {
      r.step = "use";
      render();
    } else void tvTry();
    return true;
  }
  if (r.finding || r.trying || r.recovering || r.step === "done") return false;
  const lower = k.toLowerCase();
  if (lower === "j" || k === "ArrowLeft") tvStep(e.shiftKey ? "prevChange" : "back");
  else if (lower === "l" || k === "ArrowRight") tvStep(e.shiftKey ? "nextChange" : "forward");
  else if (k === "Home") tvStep("first");
  else if (k === "End") tvStep("last");
  else if (lower === "t" && !e.shiftKey && r.step !== "use") {
    flash('.tv [data-key="t"]');
    void tvTry();
  } else if (lower === "c" && !e.shiftKey && r.step !== "use" && r.target && points().at(-1)?.id !== r.target) {
    flash('.tv [data-key="c"]');
    void openCompare(r.target, points().at(-1)?.id);
  } else return false;
  return true;
}

function onKey(e: KeyboardEvent): void {
  const mod = isMac() ? e.metaKey : e.ctrlKey;
  const k = e.key.toLowerCase();
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
  if (k === "escape" && st.inspector) {
    st.inspector = false;
    render();
    return;
  }
  if (!typing && rewindKey(e)) {
    e.preventDefault();
    return;
  }
  if (mod && e.shiftKey && k === "r") return void (e.preventDefault(), shortcut("rewind"));
  if (mod && e.shiftKey && k === "c") return void (e.preventDefault(), shortcut("compare"));
  if (mod && e.shiftKey && k === "t" && opts.onStrip) {
    e.preventDefault();
    const p = project();
    if (p) opts.onStrip(p.id);
    return;
  }
  if (mod && k === "s") return void (e.preventDefault(), flash('[data-act="save"]'), shortcut("save"));
  if (mod && k === "enter") return void (e.preventDefault(), flash('[data-act="check"]'), shortcut("check"));
  if (mod && k === "i") return void (e.preventDefault(), shortcut("inspector"), flash('.side [data-act="inspector"]'));
  if (mod && k === ",") return void (e.preventDefault(), flash('.side [data-act="settings"]'), shortcut("settings"));
  if (mod && k === "n") return void (e.preventDefault(), shortcut("add"));
  if (k === "escape") {
    if (st.check && (st.check.phase === "done" || st.check.error)) st.check = null;
    else if (st.hookSheet && !st.hookSheet.working) st.hookSheet = null;
    render();
    return;
  }
  if (typing || st.screen !== "history" || st.check) return;
  const pts = points();
  const i = pts.findIndex((c) => c.id === st.selected);
  // History list is newest first, so Down goes back in time.
  if (k === "arrowdown" || k === "j" || k === "arrowleft") st.selected = pts[Math.max(0, i - 1)]?.id ?? st.selected;
  else if (k === "arrowup" || k === "l" || k === "arrowright") st.selected = pts[Math.min(pts.length - 1, i + 1)]?.id ?? st.selected;
  else if (k === "c" && st.selected && pts.at(-1)?.id !== st.selected) return void openCompare(st.selected, pts.at(-1)?.id);
  else if (k === " " && st.selected) return void (e.preventDefault(), startRewind(st.selected));
  else return;
  e.preventDefault();
  render();
}

function onEvent(ev: AppEvent): void {
  switch (ev.type) {
    case "navigate":
      void (async () => {
        await selectProject(ev.projectId, "history");
        if (ev.screen === "rewind" && ev.target) await startRewind(ev.target);
        else if (ev.screen === "compare") await openCompare(ev.a, ev.b);
        else {
          if (ev.target) st.selected = ev.target;
          render();
        }
      })();
      return;
    case "progress":
      if (st.rewind?.finding && ev.projectId === st.projectId) {
        st.rewind.progress.push({ checkpoint: ev.checkpoint, verdict: ev.verdict });
        render();
      }
      return;
    case "changed":
      void refreshStatuses().then(async () => {
        // Do not re-render while an action is running. It re-reads when it ends.
        if (ev.projectId === st.projectId && !st.busy && (st.screen === "history" || st.screen === "compare")) await loadTimeline();
        if (!st.busy) render();
      });
      return;
    case "settings":
      st.settings = ev.settings;
      applyTheme();
      render();
      return;
    case "shortcut":
      shortcut(ev.action);
      return;
  }
}

export async function start(b: TmBridge, o: StartOptions): Promise<void> {
  bridge = b;
  opts = o;
  const el = document.getElementById("root");
  if (!el) return;
  root = el;
  const boot = await b.call({ method: "bootstrap" });
  if (!boot.ok) {
    root.textContent = boot.error.message;
    return;
  }
  st = {
    boot: boot.data, settings: boot.data.settings, projects: boot.data.projects, statuses: new Map(), projectId: boot.data.projects[0]?.id ?? null,
    screen: boot.data.projects.length ? "history" : "welcome", timeline: null, timelineError: null, selected: null, busy: null, check: null, rewind: null,
    compare: { a: null, b: null, result: null, loading: false, error: null }, onboarding: emptyOnboarding(), inspector: false, records: [], storage: null,
    hookSheet: null, toast: null, demoBusy: false, openResult: null, verifyResults: new Map(), changes: new Map(), flash: null,
  };
  if (isMac()) document.documentElement.classList.add("mac");
  if (!o.preview) document.documentElement.classList.add("native");
  applyTheme();
  root.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("scrim") && st.check && (st.check.phase === "done" || st.check.error)) {
      st.check = null;
      render();
      return;
    }
    const act = target.closest<HTMLElement>("[data-act]");
    if (act && !(act instanceof HTMLButtonElement && act.disabled)) void onClick(act);
  });
  root.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.model === "ob-custom") {
      st.onboarding.custom = t.value;
      st.onboarding.choice = "custom";
      document.querySelectorAll(".opt").forEach((x) => x.classList.toggle("on", x.contains(t)));
      const radio = t.closest(".opt")?.querySelector<HTMLInputElement>('input[type="radio"]');
      if (radio) radio.checked = true;
    }
  });
  root.addEventListener("change", (e) => {
    const t = e.target as HTMLSelectElement;
    if (t.dataset.model === "cmp-a") st.compare.a = t.value;
    else if (t.dataset.model === "cmp-b") st.compare.b = t.value;
    else return;
    void runDiff();
  });
  window.addEventListener("keydown", onKey);
  window.addEventListener("resize", placePlayhead);
  b.onEvent(onEvent);
  await refreshStatuses();
  if (st.projectId) await loadTimeline();
  render();
}
