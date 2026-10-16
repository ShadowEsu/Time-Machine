// The app window: projects, History, save point detail, Check it works, the Rewind (the Time
// View, or the plain wizard sheet), Compare, Settings, onboarding and the Inspector.
// Plain TypeScript, one render function.
import type { CheckpointResult, CleanStoreResult, DiffResult, FindGoodResult, InitResult, OpenResult, RecoverResult, TimelineEntry, TimelineResult, VerifyResult } from "@timetm/core";
import type { AgentRow, AppEvent, Bootstrap, Call, CallOf, HookPreview, IsolationInfo, Method, ProjectEntry, ProjectStatus, Results, Settings, ShortcutAction, StorageRow, TmBridge, Verdict } from "../shared/api.js";
import { tmCommand } from "../shared/commands.js";
import { bytes, clock, dayLabel, esc, plural, seconds, triggerLabel, triggerSentence, verdictKey, verdictWord, when } from "../shared/format.js";
import { goBackLabel, lastWorking as lastWorkingOf, projectStatus, shortTitle, type StatusButton } from "./status.js";
import { filterPalette, type PaletteItem } from "./palette.js";

export interface StartOptions {
  preview: boolean;
  /** The preview shows the timeline strip inside the page. The real app uses a global hotkey. */
  onStrip?: (projectId: string) => void;
  /** Extra buttons in the preview banner, such as "Show the overlay card". */
  previewActions?: { label: string; run: () => void }[];
}

type Screen = "welcome" | "onboarding" | "history" | "rewind" | "compare" | "agents" | "storage" | "settings";

/** Screens that belong to the selected project. The others are app wide. */
const PROJECT_SCREENS: readonly Screen[] = ["history", "rewind", "compare"];

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
  /** Find runs only when no working version is known. Review shows one version and Use. Done has Undo. */
  step: "find" | "review" | "done";
  /** True when this Rewind started with a search, so the step bar shows Find. */
  searched: boolean;
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
  /** b is "now" to compare with the project folder as it is: we save it first (only if something changed). */
  compare: { a: string | null; b: string | null; now: { id: string; skipped: boolean } | null; result: DiffResult | null; loading: boolean; error: string | null };
  onboarding: OnboardingState;
  inspector: boolean;
  /** The save point drawer over History, showing `selected`. */
  drawer: boolean;
  /** The open ⋯ menu, if any. */
  menu: string | null;
  /** "Jump to…" (⌘K): the typed text and the highlighted row. */
  palette: { q: string; i: number } | null;
  /** The shortcut sheet (?). */
  keysSheet: boolean;
  records: Record[];
  storage: StorageRow[] | null;
  agents: AgentRow[] | null;
  isolation: IsolationInfo | null;
  /** A store clean up: first a preview of what goes, then the real removal. One project at a time. */
  cleanup: { projectId: string; result: CleanStoreResult | null; working: boolean } | null;
  /** The shortcut being typed in Settings, before Save. */
  hotkeyDraft: string | null;
  hotkeyActive: boolean;
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
  /** The last rewind in this session, until it is undone or a new one replaces it. ⌘Z undoes it. */
  undo: { projectId: string; result: RecoverResult; working: boolean } | null;
}

class ApiFailure extends Error {}

const RECORDED: Method[] = ["init", "setCheck", "checkpoint", "diff", "open", "verify", "findGood", "recover", "undoRecover", "log", "hookInstall", "demo", "cleanStore"];
const TITLES: Partial<{ [M in Method]: string }> = {
  init: "Set up", setCheck: "Change the check", checkpoint: "Save now", diff: "Compare", open: "Try it in a safe copy", verify: "Check it works",
  findGood: "Find the last working version", recover: "Use this version", undoRecover: "Undo this rewind", log: "Audit log", hookInstall: "Connect Claude Code", demo: "Try the demo",
  cleanStore: "Clean up storage",
};

/** Shown instead of "Add these lines" when the hook command did not answer its version check. */
const hookNotRunning = "This command does not run on this Mac yet, so we won't add it. Claude Code would fail at every prompt and nothing would be saved.";

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

function lastWorking(): TimelineEntry | null {
  return lastWorkingOf(points());
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
    st.drawer = false;
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

/** A save point's title. Agent save points read like "Claude Code: add dark mode". Safety saves keep their command. */
function title(c: TimelineEntry): string {
  const a = c.agent;
  if (!a?.prompt || c.trigger === "claude-code:pre-bash") return c.note;
  return c.trigger === "claude-code:prompt" ? `Before ${a.name}: ${a.prompt}` : `${a.name}: ${a.prompt}`;
}

/** Coverage lines in plain words. Git details add the commit, never replace the words. */
function savedLines(c: TimelineEntry): string[] {
  return c.coverage.captured.map((line) => {
    if (line.startsWith("Code:")) {
      const words = line.includes("uncommitted") ? "Your code, including work you had not committed yet" : "Your code";
      return st.settings.showGitDetails ? `${words} (${line.slice(6)})` : words;
    }
    const files = /^Files: (.+) not in Git$/.exec(line);
    if (files) return `${files[1]} that Git does not track`;
    const cfg = /^Config: .+ in (.+) \((\d+) saved, (\d+) name only\)$/.exec(line);
    if (cfg) return `Settings in ${cfg[1]}: ${plural(Number(cfg[2]), "value")} saved, ${plural(Number(cfg[3]), "secret")} by name only`;
    if (line.startsWith("Dependencies:")) return `Package lock files: ${line.slice(14)}`;
    if (line.startsWith("Environment:")) {
      const tools = line.slice(13).split(", ").filter((x) => !x.startsWith("platform "));
      return st.settings.showGitDetails ? `Tool versions: ${line.slice(13)}` : `Tool versions: ${tools.join(", ")}`;
    }
    return line;
  });
}
function notSavedLines(c: TimelineEntry): string[] {
  return [...c.coverage.missing, ...c.coverage.manual].map((line) => {
    const m = /^Secret values in (.+?): (.+)$/.exec(line);
    return m ? `Secret values. We kept the names: ${m[2]} (in ${m[1]})` : line;
  });
}


// Views

function sidebar(): string {
  const inProject = PROJECT_SCREENS.includes(st.screen);
  const items = st.projects
    .map((p) => {
      const s = st.statuses.get(p.id);
      const v = s?.newest?.verdict ?? null;
      const label = s?.problem ? "Can't find it" : s?.newest ? verdictWord(v) : "No save points yet";
      return `<button class="it ${p.id === st.projectId && inProject ? "on" : ""}" data-act="project" data-id="${p.id}" title="${esc(`${p.name}: ${label}`)}">
        ${glyph(s?.problem ? "ERROR" : v)}<span class="nm">${esc(p.name)}</span><span class="sr-only">${esc(label)}</span></button>`;
    })
    .join("");
  const nav = (screen: Screen, icon: string, label: string, key: string): string =>
    `<button class="it ${st.screen === screen ? "on" : ""}" data-act="${screen}"><span class="plus" aria-hidden="true">${icon}</span><span class="nm">${label}</span>${key ? `<kbd>${keys(key)}</kbd>` : ""}</button>`;
  return `<aside class="side">
    <div class="brand"><span class="mark" aria-hidden="true"></span>Time Machine</div>
    <div class="sec">Projects</div>
    ${items || '<div class="muted small" style="padding:4px 8px">No projects yet</div>'}
    <button class="it ${st.screen === "onboarding" ? "on" : ""}" data-act="add"><span class="plus" aria-hidden="true">+</span><span class="nm">Add project</span><kbd>${keys("Mod+N")}</kbd></button>
    <div class="side-rule" role="separator"></div>
    ${nav("agents", "⌁", "Agents", "")}
    ${nav("storage", "▢", "Storage", "")}
    ${nav("settings", "⚙", "Settings", "Mod+,")}
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
  const newest = pts.at(-1);
  const checked = newest ? st.verifyResults.get(newest.id) : undefined;
  const s = projectStatus(pts, checked && checked.verdict === newest?.verdict ? checked.at : null);
  const header = `<section class="hero">
    ${st.settings.showGitDetails ? `<div class="hero-name"><span class="path mono">${esc(p.path)}${newest?.branch ? ` · branch ${esc(newest.branch)}` : ""}</span></div>` : ""}
    <div class="hero-v">${badge(s.v)}</div>
    <h1 class="hero-h">${esc(s.head)}</h1>
    <p class="hero-p">${esc(s.body)}</p>
    <div class="hero-acts">${statusButton(s.primary, true)}${s.secondary ? statusButton(s.secondary, false) : ""}</div>
  </section>`;
  if (!pts.length) return header;
  const selIdx = pts.findIndex((c) => c.id === st.selected);
  const shown = pts.slice(-40);
  const sel = entry(st.selected);
  const ruler = `<div class="ruler"><div class="ticks" role="slider" aria-label="Save points" aria-valuemin="1" aria-valuemax="${pts.length}" aria-valuenow="${selIdx + 1}" aria-valuetext="${esc(sel ? `${when(sel.createdAt)}, ${title(sel)}, ${verdictWord(sel.verdict)}` : "")}">
      ${shown.map((c) => `<button class="tk ${pts.indexOf(c) > selIdx ? "after" : ""}" data-act="open" data-id="${c.id}" title="${esc(`${when(c.createdAt)} · ${title(c)} · ${verdictWord(c.verdict)}`)}">${glyph(c.verdict)}</button>`).join("")}
      <span class="ph" id="playhead"></span></div>
    <div class="tlab"><span>${esc(when(shown[0]?.createdAt ?? ""))}</span><span>Now</span></div></div>`;

  const lw = lastWorking();
  const rows: string[] = [];
  let lastDay = "";
  const newestFirst = [...pts].reverse();
  newestFirst.forEach((c, i) => {
    const day = dayLabel(c.createdAt);
    if (day !== lastDay) {
      rows.push(`<div class="day">${esc(day)}</div>`);
      lastDay = day;
    }
    const hint = c.id === lw?.id && newest?.verdict !== "PASS" ? '<span class="wayback">Last version that works</span>' : "";
    rows.push(`<button class="row ${c.id === st.selected && st.drawer ? "on" : ""}" data-act="open" data-id="${c.id}">
      <span class="tm">${esc(clock(c.createdAt))}</span>
      <span class="rt"><span class="t1">${esc(title(c))}</span><span class="t2">${hint}<span>${esc(triggerLabel(c.trigger))}</span>${st.settings.showGitDetails ? `<span class="mono">${esc(c.id)} · ${esc(short(c.commit))}${c.dirty ? " + uncommitted" : ""}</span>` : ""}</span></span>
      ${badge(c.verdict)}</button>`);
    const older = newestFirst[i + 1];
    // Only say "broke here" when two neighbouring checks prove it.
    if (older && c.verdict === "FAIL" && older.verdict === "PASS") rows.push(`<div class="broke-rule">Broke here: ${esc(when(older.createdAt))} works, ${esc(when(c.createdAt))} is broken</div>`);
  });

  const u = st.undo && st.undo.projectId === p.id && st.screen === "history" ? st.undo : null;
  const undoBar = u
    ? `<div class="hintbar">${glyph(u.result.lastVerdict)}<span>You went back to the ${esc(pointName(u.result.id))} version. It is on a new branch${st.settings.showGitDetails ? `, ${esc(u.result.branch)},` : ""} and in a recovery copy. Your folder was not touched.</span>${undoButton("")}<button class="btn ghost" data-act="undo-dismiss">Keep it</button></div>`
    : "";
  return `<div class="page proj">${header}${undoBar}<section class="hist" aria-label="History"><div class="hist-h"><h2>History</h2><span class="muted small">${esc(plural(pts.length, "save point"))}, newest first</span></div>${ruler}<div class="list" id="list">${rows.join("")}</div></section></div>${drawer()}`;
}

/** A save point named the way people say it: by its time. Git details add the id. */
function pointName(id: string): string {
  const c = entry(id);
  if (!c) return id;
  return st.settings.showGitDetails ? `${when(c.createdAt)} (${c.id})` : when(c.createdAt);
}

/** A project screen button from the status rule. Its shortcut sits inside it, so shortcuts are learned by seeing them. */
function statusButton(b: StatusButton, primary: boolean): string {
  const data = `${b.id ? ` data-id="${esc(b.id)}"` : ""}${b.a ? ` data-a="${esc(b.a)}"` : ""}${b.b ? ` data-b="${esc(b.b)}"` : ""}`;
  const key = { save: "Mod+S", check: "Mod+Enter", "rewind-to": "Mod+Shift+R", rewind: "Mod+Shift+R", compare: "" }[b.act];
  return `<button class="btn big ${primary ? "dark" : ""}" data-act="${b.act}"${data} ${st.busy ? "disabled" : ""}>${b.act.startsWith("rewind") ? '<span class="tri"></span>' : ""}${esc(b.label)}${key ? `<kbd>${esc(keys(key))}</kbd>` : ""}</button>`;
}

/** One plain sentence on what a verdict means for this save point. Isolation names only with Git details. */
function verdictSentence(c: TimelineEntry): string {
  const how = st.settings.showGitDetails ? ` (basic isolation, ${c.isolation ?? "host"} mode)` : "";
  switch (c.verdict) {
    case "PASS":
      return `It passed its check in a safe copy on this Mac${how}.`;
    case "FAIL":
      return `It failed its check in a safe copy on this Mac${how}.`;
    case "INCOMPLETE":
      return "We couldn't finish the check. We won't call it working until we can.";
    case "BLOCKED":
      return "The check needs something before it can run.";
    case "ERROR":
      return "The check itself crashed. This doesn't mean the project is broken.";
    default:
      return "Saved, but we don't know yet if it works.";
  }
}

/** The save point drawer: slides over History, Esc closes it. One primary action by verdict. */
function drawer(): string {
  const c = st.drawer ? entry(st.selected) : null;
  const p = project();
  if (!c || !p) return "";
  const busy = st.busy ? "disabled" : "";
  const works = c.verdict === "PASS";
  const primary = works
    ? `<button class="btn big dark" data-act="use" data-id="${c.id}" ${busy}><span class="tri"></span>Use this version</button>`
    : `<button class="btn big dark" data-act="verify-one" data-id="${c.id}" ${busy}>Check it works</button>`;
  const more = [
    works ? `<button data-act="verify-one" data-id="${c.id}" ${busy}>Check again</button>` : `<button data-act="use" data-id="${c.id}" ${busy}>Use this version</button>`,
    `<button data-act="inspector">Open in Inspector<kbd>${esc(keys("Mod+I"))}</kbd></button>`,
  ];
  const opened = st.openResult && st.openResult.id === c.id
    ? `<div class="note">A safe copy of this version is ready. Your project folder was not touched.${st.openResult.missing.length ? ` Missing: ${esc(st.openResult.missing.join(", "))}.` : ""}<div class="row-btns" style="margin-top:8px"><button class="btn" data-act="reveal" data-path="${esc(st.openResult.dir)}">Show in Finder</button></div>${st.settings.showGitDetails ? `<div class="mono muted" style="margin-top:6px">${esc(st.openResult.dir)}</div>` : ""}</div>`
    : "";
  const git = st.settings.showGitDetails
    ? `<div class="git"><div><span class="k">id</span> ${esc(c.id)}</div><div><span class="k">commit</span> ${esc(c.commit)}</div><div><span class="k">branch</span> ${esc(c.branch ?? "(detached)")}${c.dirty ? " · had uncommitted changes" : ""}</div><div><span class="k">trigger</span> ${esc(c.trigger)}</div><div><span class="k">ref</span> refs/tm/${esc(c.id)}</div><div><span class="k">check</span> ${esc(tmCommand({ method: "verify", projectId: p.id, id: c.id }, p.path) ?? "")}</div></div>`
    : "";
  return `<aside class="spd ${once("spd")}" role="dialog" aria-label="${esc(`Save point from ${when(c.createdAt)}`)}">
    <header class="sp-top"><span class="eyebrow">${esc(dayLabel(c.createdAt))} ${esc(clock(c.createdAt))} · ${esc(triggerLabel(c.trigger))}</span>
      ${menuButton("sp", "More actions for this save point", more)}
      <button class="btn ghost" data-act="close-drawer" aria-label="Close">Close<kbd>Esc</kbd></button></header>
    <div class="sp-body">
      <h2 class="sp-h">${esc(title(c))}</h2>
      <div class="sp-v">${badge(c.verdict)}<span>${esc(verdictSentence(c))}</span></div>
      <div class="row-btns">${primary}<button class="btn big" data-act="try" data-id="${c.id}" ${busy}>Try it first</button><button class="btn big" data-act="compare" data-a="${c.id}" data-b="now">Compare with now</button></div>
      ${opened}
      <div class="cols"><div class="kv"><span class="h">What's saved</span>${li(savedLines(c), "Nothing listed")}</div>
        <div class="kv no"><span class="h">What's not saved</span>${li(notSavedLines(c), "Nothing listed")}</div></div>
      ${git}
    </div>
  </aside>`;
}

/** A ⋯ button with a small menu. One menu is open at a time. */
function menuButton(key: string, label: string, items: string[]): string {
  const open = st.menu === key;
  return `<span class="mn"><button class="btn ghost mn-b" data-act="menu" data-v="${key}" aria-label="${esc(label)}" aria-expanded="${open}" aria-haspopup="menu">⋯</button>${open ? `<div class="mn-l" role="menu">${items.join("")}</div>` : ""}</span>`;
}

function checkSheet(): string {
  const c = st.check;
  const p = project();
  if (!c || !p) return "";
  const rows = [
    { label: c.skipped ? "Nothing changed since the last save point, so we used it" : "Saved the current version", state: c.phase === "saving" ? "run" : "ok", t: c.cp && st.settings.showGitDetails ? c.cp : "" },
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
      r.verdict === "FAIL" ? (lw ? ` The last version that works is from ${when(lw.createdAt)}: ${shortTitle(lw)}.` : " No earlier save point has passed yet.")
        : r.verdict === "ERROR" ? " This is a problem with the check, not necessarily your project."
          : r.verdict === "PASS" ? ` Checked in a safe copy on this Mac in ${seconds(r.durationMs)}. The network was ${r.network.policy === "deny" ? "off" : "on"} during the check.` : "";
    result = `<div class="big-verdict ${stampOnce(`check:${r.checkpoint}:${r.verdict}`)}">${glyph(r.verdict)}<span>${esc(head[r.verdict])}</span></div>
      <p>${esc(r.reason + extra)}</p>
      ${st.settings.showGitDetails ? `<div class="git"><div><span class="k">verdict</span> ${esc(r.verdict)} · exit ${esc(String(r.exitCode))} · ${esc(r.isolation)} mode</div><div><span class="k">command</span> ${esc(r.command)}</div>${r.log ? `<div><span class="k">log</span> ${esc(r.log)}</div>` : ""}</div>` : ""}`;
  }
  const done = c.phase === "done" || !!c.error;
  const lw = lastWorking();
  const goBack = done && c.result?.verdict === "FAIL" && lw ? lw : null;
  return `<div class="scrim ${once("scrim:check")}"><div class="sheet" role="dialog" aria-modal="true" aria-label="Check it works">
    <h2>Checking ${esc(p.name)}</h2>${list}${result}
    <p class="small muted">Your project folder is not touched. The check runs in a separate copy.</p>
    <div class="row-btns" style="justify-content:flex-end">
      ${done && c.result?.log ? `<button class="btn ghost" data-act="reveal" data-path="${esc(c.result.log)}">Show log</button>` : ""}
      <button class="btn ${goBack ? "" : "dark"}" data-act="close-check" ${done ? "" : "disabled"}>Done</button>
      ${goBack ? `<button class="btn dark" data-act="rewind-to" data-id="${goBack.id}"><span class="tri"></span>${esc(goBackLabel(goBack))}</button>` : ""}</div>
  </div></div>`;
}

/** Review, then Done. A search first only when no working version was known. */
function rewindSteps(r: RewindState): string {
  const labels = r.searched ? ["Find", "Review", "Done"] : ["Review", "Done"];
  return steps(r.step === "done" ? labels.length : r.step === "review" ? labels.length - 1 : 1, labels);
}

/** The plain Rewind sheet, for Reduce motion or Simple rewind. Same steps and actions as the Time View. */
function rewind(): string {
  const r = st.rewind;
  const p = project();
  if (!r || !p) return history();
  const c = entry(stageId());
  const tried = r.find?.tried ?? r.progress.map((x) => ({ id: x.checkpoint, verdict: asVerdict(x.verdict), reason: "" }));
  const triedRows = r.step === "find" && tried.length
    ? `<div class="tried">${tried.map((t) => { const e = entry(t.id); return `<div class="r"><span class="mono">${esc(e ? clock(e.createdAt) : t.id)}</span><span>${esc(e ? title(e) : "")}</span>${badge(t.verdict)}</div>`; }).join("")}</div>`
    : "";
  const body = c ? tvRead(r, c) : `<div class="note warn">That save point is not in the history of ${esc(p.name)}.</div><div class="tv-acts">${tvButton("find", "Find the last working version", "enter", "↵", true)}</div>`;
  return `<div class="scrim ${once("scrim:rewind")}"><div class="sheet wide rw-sheet" role="dialog" aria-modal="true" aria-label="${esc(`Rewind ${p.name}`)}">
    <div class="sheet-head"><div><h2>Go back in ${esc(p.name)}</h2>${rewindSteps(r)}</div>
      <button class="btn ghost" data-act="tv-exit" ${r.recovering ? "disabled" : ""}>Close<kbd>Esc</kbd></button></div>
    ${triedRows}${body}
  </div></div>`;
}

/** What Undo does, said plainly before anyone presses it. */
function undoNote(res: RecoverResult): string {
  return `<p class="small muted">Undo removes the new branch${st.settings.showGitDetails ? ` ${esc(res.branch)}` : ""} and the recovery copy. Every save point stays, including your version from just before. Undo stops if you changed anything in the recovery copy or added commits to the branch.</p>`;
}
function undoButton(size: string): string {
  const u = st.undo;
  return `<button class="btn ${size}" data-act="undo-rewind" data-key="undo" ${!u || u.working || st.busy ? "disabled" : ""}>${u?.working ? "Undoing…" : "Undo this rewind"}<kbd>${esc(keys("Mod+Z"))}</kbd></button>`;
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
  const where = `In a safe copy on this Mac${st.settings.showGitDetails ? ` (basic isolation, ${c.isolation ?? "host"} mode)` : ""}`;
  const took = same ? ` in ${seconds(same.durationMs)}` : "";
  const net = same ? (same.network.enforcedBy ? ", network off" : ", network on") : "";
  switch (v) {
    case "PASS":
      return `Passed its check${took}. ${where}${net}.`;
    case "FAIL":
      return `Failed its check${took}${same?.exitCode != null && st.settings.showGitDetails ? ` (exit code ${same.exitCode})` : ""}. ${where}${net}.`;
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
  if (!paths.length) return `<div class="cd-foot">No file changes since the save point before.</div>`;
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
  return `<div class="mosaic">${rows}</div><div class="cd-foot">${esc(plural(paths.length, "file"))} changed since the save point before</div>`;
}

function tvCard(c: TimelineEntry, k: number, prev: TimelineEntry | null, still: boolean): string {
  const v = shownVerdict(c);
  const on = k === 0;
  const checking = checkingId() === c.id;
  const cls = ["tv-card", on ? "on" : "", k < 0 ? "ahead" : "", on && v === "PASS" && !checking ? "earned" : "", checking ? "checking" : ""].filter(Boolean).join(" ");
  const go = k > 0 && !still ? `data-act="tv-go" data-id="${esc(c.id)}"` : "";
  const mark = checking ? '<span class="vb v-checking"><i class="g" aria-hidden="true"></i>Checking</span>' : badge(v, on ? `${stampOnce(`card:${c.id}:${v ?? ""}`)}` : "");
  return `<div class="${cls}" data-carry="card-${esc(c.id)}" style="--k:${Math.max(k, -1)}" ${go}>
    <div class="cd-top"><span class="cd-g">${glyph(v)}</span><span class="cd-when">${esc(clock(c.createdAt))}</span>${st.settings.showGitDetails ? `<span class="cd-id">${esc(c.id)}</span>` : ""}<span class="cd-who">${esc(triggerLabel(c.trigger))}</span><span class="cd-v">${mark}</span></div>
    <div class="cd-title">${esc(title(c))}</div>
    ${on ? `<div class="cd-sum">${esc(triggerSentence(c.trigger))}</div>` : ""}
    ${on ? (checking ? `<div class="cd-run"><span class="spin"></span><span>Rebuilding this version in a safe copy and running your check. Your folder is not touched.</span></div>` : mosaic(c, prev)) : ""}
  </div>`;
}

function tvButton(act: string, label: string, key: string, keyLabel: string, primary: boolean, disabled = false): string {
  return `<button class="btn big ${primary ? "dark" : ""}" data-act="${act}" data-key="${key}" ${disabled ? "disabled" : ""}>${esc(label)}<kbd>${esc(keyLabel)}</kbd></button>`;
}

/** What a version is, said the way people say it. */
function versionHead(c: TimelineEntry, v: Verdict | null): string {
  const name = `The ${pointName(c.id)} version`;
  const rest: { [K in Verdict | "none"]: string } = {
    PASS: "works.", FAIL: "is broken.", INCOMPLETE: "couldn't be checked.", BLOCKED: "needs something before it can be checked.", ERROR: "had a check that crashed.", none: "is not checked yet.",
  };
  return `${name} ${rest[v ?? "none"]}`;
}

/** Use, said before anyone presses it. This is the confirmation: nothing here touches the folder, and Undo is one key. */
function useWill(c: TimelineEntry): string {
  return `<div class="will"><span class="h">When you use it, we</span><ol><li>Save your current version first, so nothing is lost.</li><li>Put this version on a new local branch${st.settings.showGitDetails ? `, <span class="mono">tm/recover/${esc(c.id)}</span>` : ""}.</li><li>Build a recovery copy next to your project folder.</li></ol>
    <p><b>Nothing is pushed, merged, deployed or deleted. Your folder and branch are not touched.</b> You can undo it.</p></div>`;
}

/** The reading pane of the Rewind, in the Time View and in the plain sheet: Find, Review, Done. */
function tvRead(r: RewindState, c: TimelineEntry): string {
  const newest = points().at(-1);
  const v = shownVerdict(c);
  const git = st.settings.showGitDetails;
  const cols = (a: string, b: string, yes: string[], no: string[]): string =>
    `<div class="tv-cols"><div class="kv"><span class="h">${esc(a)}</span>${li(yes, "Nothing listed")}</div><div class="kv no"><span class="h">${esc(b)}</span>${li(no, "Nothing listed")}</div></div>`;
  const meta = `<div class="tv-meta">${esc(dayLabel(c.createdAt))} ${esc(clock(c.createdAt))} · ${esc(title(c))} · ${esc(triggerLabel(c.trigger))}</div>`;
  const error = r.error ? `<div class="note bad">${esc(r.error)}</div>` : "";

  if (r.step === "done" && r.result) {
    const res = r.result;
    return `<div class="tv-verdict"><h2 class="tv-head ${stampOnce(`done:${res.branch}`)}">The ${esc(pointName(res.id))} version is ready on a new branch.</h2>
        <div class="tv-ev">${badge(res.lastVerdict, "lg")}<span>${res.lastVerdict ? `Last check: ${esc(verdictWord(res.lastVerdict))}, in a safe copy on this Mac.` : "Not checked yet. Run Check it works before you rely on it."}</span></div></div>
      <div class="facts"><div>Your current version was saved first. It is in History.</div><div>A recovery copy of this version is next to your project folder.</div></div>
      ${git ? `<div class="git"><div><span class="k">new branch</span> ${esc(res.branch)} (local only)</div><div><span class="k">recovery copy</span> ${esc(res.copyDir)}</div><div><span class="k">saved first</span> ${esc(res.savedBefore)}</div><div><span class="k">report</span> ${esc(res.reportPath)}</div></div>` : ""}
      ${cols("Brought back", "Not brought back", res.restored, res.notRestored)}
      <div class="kv todo"><span class="h">Things to do by hand</span>${li(res.manualSteps, "Nothing")}</div>
      <div class="note"><b>Your folder and branch were not touched.</b> Nothing was pushed, merged, deployed or deleted.</div>
      ${undoNote(res)}
      <div class="tv-acts">${tvButton("tv-done", "Done", "enter", "↵", true)}${undoButton("big")}<button class="btn big ghost" data-act="reveal" data-path="${esc(res.copyDir)}">Show recovery copy</button><button class="btn big ghost" data-act="copy-report" data-path="${esc(res.reportPath)}">Copy report</button></div>`;
  }

  if (r.finding) {
    return `<div class="tv-verdict" aria-live="polite"><h2 class="tv-head">Finding the last version that works</h2>
        <div class="tv-ev"><span class="vb lg v-checking"><i class="g" aria-hidden="true"></i>Checking</span><span>The ${esc(pointName(c.id))} version, ${r.progress.length + 1} of up to ${points().length}. Newest first, each in a safe copy.</span></div>
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

  // Review: the version, what comes back, what Use will do. Use is the primary action only when it is proven.
  const tr = r.tryResult && r.tryResult.checkpoint === c.id ? r.tryResult : null;
  const proven = v === "PASS";
  const head = r.trying ? `Trying the ${pointName(c.id)} version in a safe copy` : versionHead(c, v);
  const ev = r.trying
    ? `<span class="vb lg v-checking"><i class="g" aria-hidden="true"></i>Checking</span><span>Rebuilding it in a separate folder and running your check. Your real folder hasn't changed.</span>`
    : `${badge(v, `lg ${stampOnce(`ev:${c.id}:${v ?? ""}`)}`)}<span>${esc(tr && tr.verdict === v && v !== "PASS" && v !== "FAIL" ? `${tr.reason} ` : "")}${esc(evidenceFor(c, v))}</span>`;
  const warn = r.trying || r.recovering ? ""
    : tr && tr.verdict !== "PASS" ? `<div class="note warn">We couldn't confirm this version works. You can still use it, but it is not proven.</div>`
      : !proven ? `<div class="note">No passing check is recorded for this version. Try it first: we rebuild it in a safe copy and run your check.</div>` : "";
  const opened = r.openResult && r.openResult.id === c.id
    ? `<div class="note">A copy you can open is ready. Your folder was not touched.${git ? ` <span class="mono">${esc(r.openResult.dir)}</span>` : ""} <button class="btn" data-act="reveal" data-path="${esc(r.openResult.dir)}">Show in Finder</button></div>` : "";
  const busy = r.trying || r.recovering || !!st.busy;
  const notNewest = newest && newest.id !== c.id;
  return `<div class="tv-verdict" aria-live="polite"><h2 class="tv-head">${esc(head)}</h2>${meta}<div class="tv-ev">${ev}</div></div>
    ${error}${warn}${opened}
    ${cols("Comes back", "Does not come back", comesBackLines(c), notSavedLines(c))}
    ${useWill(c)}
    <div class="tv-acts">
      ${tvButton("tv-try", tr ? "Try it again" : "Try it first", "t", "T", !proven, busy)}
      ${notNewest ? tvButton("tv-compare", "Compare with now", "c", "C", false, busy) : ""}
      ${tvButton("tv-use", r.recovering ? "Working…" : proven ? "Use this version" : "Use it anyway", proven ? "enter" : "use", proven ? "↵" : "", proven, busy)}
      ${tr ? `<button class="btn big ghost" data-act="rw-open" ${r.opening || busy ? "disabled" : ""}>${r.opening ? "Making a copy…" : "Make a copy I can open"}</button>` : ""}
    </div>`;
}

function tvRuler(r: RewindState, pts: TimelineEntry[], cur: number): string {
  const n = pts.length;
  const x = (i: number): number => ((i + 0.5) / n) * 100;
  const checking = checkingId();
  // Agent sessions as clips: runs of save points made by the same agent. Only the agent the engine
  // recorded counts, never a guess from the trigger, so the app and the CLI agree.
  const agentOf = (c: TimelineEntry | undefined): string | null => c?.agent?.name ?? null;
  const clips: string[] = [];
  for (let i = 0; i < n; i++) {
    const name = agentOf(pts[i]);
    if (!name) continue;
    let j = i;
    while (j + 1 < n && agentOf(pts[j + 1]) === name) j++;
    const half = (0.5 / n) * 100 * 0.7;
    clips.push(`<span class="clip" style="left:${x(i) - half}%;width:${x(j) - x(i) + half * 2}%"><span>${esc(name)} session</span></span>`);
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
      return `<button class="${cls}" style="left:${x(i)}%" tabindex="-1" ${still ? "" : `data-act="tv-go" data-id="${esc(c.id)}"`} title="${esc(`${clock(c.createdAt)} · ${title(c)} · ${verdictWord(v)}`)}">${c.id === checking ? '<i class="g v-checking-tick" aria-hidden="true"></i>' : glyph(v)}</button>`;
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
  const veilText = r.step === "done" && r.result ? "Your other version is saved" : "These stay saved";
  const veil = cur < n - 1 ? `<div class="tv-veil" data-carry="veil" style="left:${x(cur)}%"><span>${esc(veilText)}</span></div>` : "";
  const fork =
    r.step === "done" && r.result
      ? `<svg class="tv-fork" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" vector-effect="non-scaling-stroke" d="M ${x(cur)} 100 C ${x(cur)} 50, ${x(cur)} 30, ${x(cur) + 2.5} 30 L 100 30"/></svg>
        <span class="fork-l" style="left:calc(${x(cur)}% + 34px)">${esc(st.settings.showGitDetails ? `${r.result.branch} · new branch, local only` : "New branch, local only")}</span>`
      : "";
  return `<footer class="tv-ruler ${once("tv-ruler", "rise")}${fork ? " forked" : ""}">
    <div class="tv-track">
      ${fork}
      <div class="tv-lane">${clips.join("")}</div>
      <div class="tv-band" aria-hidden="true">${bars}</div>
      <div class="tv-ticks" role="slider" tabindex="0" aria-label="Save points. J and L step, Shift J and Shift L jump to the next verdict change." aria-valuemin="1" aria-valuemax="${n}" aria-valuenow="${cur + 1}" aria-valuetext="${esc(curEntry ? `Save point ${cur + 1} of ${n}. ${clock(curEntry.createdAt)}, ${title(curEntry)}. ${verdictWord(shownVerdict(curEntry))}.` : "")}">${ticks}</div>
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
        <span class="nw-t">${esc(title(newest))}</span>
        <span class="nw-m">${esc(clock(newest.createdAt))}</span>
        ${badge(shownVerdict(newest))}
        <span class="nw-h ${done ? stampOnce("nw-saved") : ""}">${done ? "Saved first, so nothing was lost" : "Your folder is untouched"}</span>
      </button>`
    : "";
  return `<div class="tv ${once("tv")} step-${r.step}" role="dialog" aria-modal="true" aria-label="${esc(`Rewind ${p.name}`)}" tabindex="-1">
    <header class="tv-top">
      <div class="tv-name"><span class="tri" aria-hidden="true"></span><span>Go back</span><b>${esc(p.name)}</b></div>
      ${rewindSteps(r)}
      <button class="btn ghost" data-act="tv-exit" data-key="esc" ${r.recovering ? "disabled" : ""}>Back to now<kbd>Esc</kbd></button>
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
  const name = (id: string | null): string => (id === "now" ? "now" : id ? `the ${pointName(id)} version` : "");
  const opt = (sel: string | null): string =>
    `<option value="now" ${sel === "now" ? "selected" : ""}>Now: your folder as it is</option>` +
    [...pts].reverse().map((x) => `<option value="${x.id}" ${x.id === sel ? "selected" : ""}>${esc(`${pointName(x.id)} · ${title(x)} · ${verdictWord(x.verdict)}`)}</option>`).join("");
  const sideCard = (side: string | null, id: string): string => {
    const e = entry(id);
    const sub = side === "now" && c.now
      ? c.now.skipped ? "Nothing changed since the last save point." : "Saved just now, so we could compare."
      : e ? `${when(e.createdAt)} · ${triggerLabel(e.trigger)}` : "";
    return `<div class="cmp-side"><span class="eyebrow">${esc(side === "now" ? "Now" : e ? when(e.createdAt) : id)}</span><span class="t1">${esc(e ? title(e) : id)}</span><span class="small muted">${esc(sub)}</span>${badge(e?.verdict ?? null)}</div>`;
  };
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
    const from = name(c.a);
    const to = name(c.b);
    body = `<div class="cmp-sides">${sideCard(c.a, d.a)}<span class="muted" aria-hidden="true">→</span>${sideCard(c.b, d.b)}</div>
      <p class="lede">${esc(parts.length ? `From ${from} to ${to}: ${parts.join(", ")}.` : `No differences between ${from} and ${to}.`)}</p>
      <div class="panel">
        <div class="dsec"><span class="h">Code</span>${list(d.code.map((x) => ({ s: st.settings.showGitDetails ? x.status : statusWord(x.status), t: x.path })), "No change")}</div>
        <div class="dsec"><span class="h">Files outside Git</span>${list(trio(d.files), "No change")}</div>
        <div class="dsec"><span class="h">Settings</span><div>${list(trio(d.config), "No change")}${cfgN ? '<p class="small muted" style="margin-top:6px">Values are never shown. Only key names were saved.</p>' : ""}</div></div>
        <div class="dsec"><span class="h">Packages</span>${list(d.dependencies.changed.map((t) => ({ s: "changed", t })), "No change")}</div>
        <div class="dsec"><span class="h">Environment</span>${list(d.environment.changed.map((t) => ({ s: "changed", t })), "No change")}</div>
      </div>
      ${ea?.verdict === "PASS" && eb?.verdict !== "PASS" ? `<div class="row-btns"><button class="btn big dark" data-act="rewind-to" data-id="${ea.id}"><span class="tri"></span>${esc(goBackLabel(ea))}</button><span class="small muted">${esc(`That version passed its check. ${c.b === "now" ? "Now" : `The ${pointName(d.b)} version`} ${eb?.verdict ? `is ${verdictWord(eb.verdict)}` : "has not been checked"}.`)}</span></div>` : ""}`;
  }
  const heading = c.a && c.a !== "now" && c.b === "now" ? `What changed since ${pointName(c.a)}` : "Compare";
  return `<div class="page"><div class="col">
    <div><h1>${esc(heading)}</h1><p class="lede">What changed between a save point and now, or between any two save points.</p></div>
    <div class="cmp-head"><select class="field" data-model="cmp-a" aria-label="From">${opt(c.a)}</select><span class="muted">→</span><select class="field" data-model="cmp-b" aria-label="To">${opt(c.b)}</select><button class="btn" data-act="cmp-swap">Swap</button></div>
    ${body}</div></div>`;
}

const LOADING = '<span class="spin" role="status" aria-label="Loading"></span>';

function agentsScreen(): string {
  const agentWords: { [K in AgentRow["claudeCode"]]: string } = {
    connected: "Connected. It saves before each prompt and checks after each turn.",
    "not-running": "Connected, but the command does not run yet. Nothing is saved until it does.",
    partial: "Partly connected.",
    "not-connected": "Not connected.",
    unreadable: "Its .claude/settings.json is not plain JSON, so we left it alone.",
    unavailable: "We can't read this project right now.",
  };
  const rows = st.agents
    ? st.agents.map((a) => {
        const words = a.claudeCode === "partial" ? `Partly connected. Missing: ${a.missing.join(", ")}.` : agentWords[a.claudeCode];
        const working = a.working ? `<div class="small">Claude Code is working now${a.workingSince ? `, since ${esc(clock(a.workingSince))}` : ""}.</div>` : "";
        const btn = a.claudeCode === "not-connected" || a.claudeCode === "partial" ? `<button class="btn dark" data-act="hook" data-id="${a.projectId}">${a.claudeCode === "partial" ? "Add the missing lines" : "Connect"}</button>` : "<span></span>";
        return `<div class="tr"><div><div class="t1">${esc(a.name)}</div><div class="small muted">Claude Code: ${esc(words)}</div>${working}${st.settings.showGitDetails && a.settingsPath ? `<div class="mono muted">${esc(a.settingsPath)}</div>` : ""}</div>${btn}</div>`;
      }).join("") || '<span class="muted">Add a project first.</span>'
    : LOADING;
  return `<div class="page"><div class="col">
    <div><h1>Agents</h1><p class="lede">Claude Code can save before each prompt and before risky commands, and check after each turn. We show the exact lines before we add them.</p></div>
    <div class="panel"><div class="table agents">${rows}</div></div>
    <div><span class="planned">planned</span> <span class="muted">Cursor, Codex and Gemini CLI.</span></div>
  </div></div>`;
}

function storageScreen(): string {
  const cleanRow = (projectId: string): string => {
    const c = st.cleanup?.projectId === projectId ? st.cleanup : null;
    if (!c) return `<button class="btn" data-act="clean-preview" data-id="${projectId}" ${st.cleanup?.working ? "disabled" : ""}>Clean up</button>`;
    if (c.working) return LOADING;
    if (!c.result) return "";
    if (c.result.applied) return `<span class="small muted">Removed ${esc(plural(c.result.files.length, "old check log"))}, ${esc(bytes(c.result.bytes))}.</span>`;
    if (!c.result.files.length) return '<span class="small muted">Nothing to clean up.</span>';
    return `<span class="small muted">${esc(plural(c.result.files.length, "old check log"))}, ${esc(bytes(c.result.bytes))}</span><button class="btn dark" data-act="clean-apply" data-id="${projectId}">Remove them</button>`;
  };
  const rows = st.storage
    ? st.storage.map((r) => `<div class="tr"><div><div class="t1">${esc(r.name)}</div><div class="small muted">${esc(bytes(r.bytes))} on this Mac</div>${st.settings.showGitDetails ? `<div class="mono muted">${esc(r.storeDir)}</div>` : ""}</div><span class="row-btns">${cleanRow(r.projectId)}<button class="btn ghost" data-act="remove" data-id="${r.projectId}">Remove from app</button></span></div>`).join("") || '<span class="muted">No projects yet.</span>'
    : LOADING;
  return `<div class="page"><div class="col">
    <div><h1>Storage</h1><p class="lede">Save points are stored on this Mac, outside your project folders, so deleting a project does not delete its history. This is not a full Mac backup.</p></div>
    <div class="panel"><div class="table">${rows}</div></div>
    <p class="small muted">Clean up removes old check logs that a newer check replaced. Save points are never removed. We show what goes before anything is removed.${st.settings.showGitDetails ? ` Store: <span class="mono">${esc(st.boot.storeDir)}</span>` : ""}</p>
    <div><span class="planned">planned</span> <span class="muted">Thinning old save points. Pinned and working save points will always stay.</span></div>
  </div></div>`;
}

function settings(): string {
  const s = st.settings;
  const seg = (v: Settings["theme"], label: string): string => `<button class="${s.theme === v ? "on" : ""}" data-act="theme" data-v="${v}">${label}</button>`;
  const sw = (key: "showGitDetails" | "overlayCards" | "agentPill", on: boolean, label: string): string => `<button class="switch ${on ? "on" : ""}" role="switch" aria-checked="${on}" aria-label="${esc(label)}" data-act="toggle" data-key="${key}"></button>`;
  const iso = st.isolation;
  const network = !iso ? LOADING
    : iso.networkSandbox ? `When a project turns the network off for checks, ${esc(iso.networkSandbox)} blocks it.`
      : "Nothing on this Mac can block the network during a check. A project that asks for no network gets Needs something, never Works.";
  const hk = s.hotkey;
  const hotkeyState = st.boot.preview ? "The browser preview has no shortcut." : !hk ? "Off." : st.hotkeyActive ? "On." : "Not active. Another app may already use it.";
  return `<div class="page"><div class="col">
    <div><h1>Settings</h1></div>
    <div class="panel"><h3>Appearance</h3>
      <div class="setrow"><span class="l">Theme</span><div class="seg">${seg("system", "System")}${seg("light", "Light")}${seg("dark", "Dark")}</div></div>
      <div class="setrow"><span class="l">Show Git details</span><div class="toggle">${sw("showGitDetails", s.showGitDetails, "Show Git details")}<span class="muted">Adds save point IDs, commits, commands and logs next to the plain words. It never replaces them and never changes a verdict.</span></div></div>
    </div>
    <div class="panel"><h3>Rewind style</h3>
      <div class="setrow"><span class="l">Going back</span><div class="toggle"><div class="seg"><button class="${s.simpleRewind ? "" : "on"}" data-act="rewind-style" data-v="scene">Time View</button><button class="${s.simpleRewind ? "on" : ""}" data-act="rewind-style" data-v="sheet">Simple</button></div><span class="muted">Simple shows the same steps as a plain sheet. It is used on its own when Reduce motion is on.</span></div></div>
    </div>
    <div class="panel"><h3>Shortcut</h3>
      <div class="setrow"><span class="l">Open Time Machine</span><div style="display:grid;gap:6px">
        <div class="row-btns"><input class="field hotkey" data-model="hotkey" aria-label="Shortcut" placeholder="for example: Control+Alt+T" value="${esc(st.hotkeyDraft ?? hk ?? "")}"><button class="btn" data-act="hotkey-save">Save</button>${hk ? '<button class="btn ghost" data-act="hotkey-off">Turn off</button>' : ""}</div>
        <span class="muted">Works from any app. ${esc(hotkeyState)} Use two modifier keys, one of them Control or Command, plus a key.</span></div></div>
      <div class="setrow"><span class="l">Timeline strip</span><div class="muted">Open it from the menu bar.</div></div>
    </div>
    <div class="panel"><h3>Overlays</h3>
      <div class="setrow"><span class="l">Corner cards</span><div class="toggle">${sw("overlayCards", s.overlayCards, "Corner cards")}<span class="muted">Only when a project that worked breaks. It never takes focus and hides on its own.</span></div></div>
      <div class="setrow"><span class="l">Agent pill</span><div class="toggle">${sw("agentPill", s.agentPill, "Agent pill")}<span class="muted">A small pill while a connected agent is working. It goes away when the turn ends.</span></div></div>
    </div>
    <div class="panel"><h3>Checks</h3>
      <div class="setrow"><span class="l">Where checks run</span><div>In a safe copy on this Mac, never in your folder. Checks use the tools installed on this Mac.${s.showGitDetails ? ' <span class="mono muted">Basic isolation (host mode): a separate Git worktree.</span>' : ""}</div></div>
      <div class="setrow"><span class="l">Network during checks</span><div>${network}</div></div>
      <div><span class="planned">planned</span> <span class="muted">Stronger isolation with Docker or Apple container.</span></div>
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
      ? `<div class="first-sp">${glyph(fv)}<span><b>Your first save point is made.</b> ${fv ? `Checked: ${esc(verdictWord(fv))}.` : "Saved, not checked. Try the check below to find out if it works."}</span></div>`
      : "";
    body = `<div><h1>How should we check that ${esc(o.project.name)} works?</h1><p class="lede">A check is a command. If it finishes without an error, the version works. ${!detected ? "We could not guess one from your project, so type yours." : o.init?.created ? "We picked one from your project. Change it if it is not right." : "Your timemachine.yml already has one. Change it if it is not right."}</p></div>
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
        <div class="opt"><span></span><span><div class="t">Before and after each Claude Code turn, and before risky commands</div><div class="d">Saves before each prompt and right before risky commands like rm -rf or git reset --hard. For mv or sed -i, go back to the save point from before that prompt. Adds hooks to ${esc(h?.settingsPath ?? ".claude/settings.json")}. We show the exact lines first.</div>
          ${h ? `<pre class="code" style="margin-top:8px">${esc(h.lines.map((l) => `${l.event}: ${l.command}`).join("\n"))}</pre>` : ""}
          ${o.hookDone ? `<div class="note" style="margin-top:8px">${esc(o.hookDone)}</div>` : h && !h.runs ? `<div class="note bad" style="margin-top:8px">${esc(hookNotRunning)}</div>` : `<div class="row-btns" style="margin-top:8px"><button class="btn" data-act="ob-hook" ${o.working ? "disabled" : ""}>Add these lines</button></div>`}</span><span class="small muted">recommended</span></div>
        <div class="opt"><span></span><span><div class="t">Every hour while files are changing</div><div class="d">Not built yet.</div></span><span class="planned">planned</span></div>
      </div>
      <div class="row-btns"><button class="btn dark" data-act="ob-finish" ${o.working ? "disabled" : ""}>${o.working ? "Saving…" : "Finish"}</button><button class="btn ghost" data-act="ob-back">Back</button></div>`;
  }
  return `<div class="page"><div class="col narrow">
    ${steps(o.step, ["Pick a folder", "Choose the check", "Choose when to save"])}
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
    ${!h.preview.runs && !h.done ? `<div class="note bad">${esc(hookNotRunning)}</div>` : ""}${h.error ? `<div class="note bad">${esc(h.error)}</div>` : ""}${h.done ? `<div class="note">${esc(h.done)}</div>` : ""}
    <div class="row-btns" style="justify-content:flex-end"><button class="btn ghost" data-act="hook-close">${h.done ? "Done" : "Cancel"}</button>${h.done || !h.preview.runs ? "" : `<button class="btn dark" data-act="hook-do" ${h.working ? "disabled" : ""}>Add these lines</button>`}</div>
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
      ${c && p ? savePointBlock(c, p) : ""}
      ${st.records.length > 1 ? `<div class="kv"><span class="h">Earlier</span>${st.records.slice(1, 8).map((r) => `<div class="mono small muted">${esc(when(r.at))} · ${esc(r.title)}</div>`).join("")}</div>` : ""}
    </div></aside>`;
}

/** The Inspector's view of one save point: the exact commit, its last check, and the same actions as tm commands. */
function savePointBlock(c: TimelineEntry, p: ProjectEntry): string {
  const vr = st.verifyResults.get(c.id);
  const newest = points().at(-1);
  const cmds: { label: string; call: Call }[] = [
    { label: "Check it", call: { method: "verify", projectId: p.id, id: c.id } },
    { label: "Open a safe copy", call: { method: "open", projectId: p.id, id: c.id } },
    { label: "Use this version", call: { method: "recover", projectId: p.id, id: c.id } },
    ...(newest && newest.id !== c.id ? [{ label: `Compare with ${newest.id}`, call: { method: "diff" as const, projectId: p.id, a: c.id, b: newest.id } }] : []),
  ];
  const rows = cmds
    .map(({ label, call }) => {
      const cmd = tmCommand(call, p.path) ?? "";
      return `<div class="cmdrow"><span class="small muted">${esc(label)}</span><pre class="code cmd">${esc(cmd)}</pre><button class="btn ghost" data-act="copy" data-text="${esc(cmd)}">Copy as command</button></div>`;
    })
    .join("");
  const check = vr
    ? `<div><span class="k">last check</span> ${esc(vr.verdict)} · exit ${esc(String(vr.exitCode))} · ${esc(seconds(vr.durationMs))} · ${esc(vr.isolation)} mode</div><div><span class="k">command</span> ${esc(vr.command)}</div>${vr.log ? `<div><span class="k">log</span> ${esc(vr.log)}</div>` : ""}`
    : `<div><span class="k">last check</span> ${c.verdict ? `${esc(c.verdict)} (run before this session; check again to see its command and log here)` : "not checked yet"}</div>`;
  return `<div style="display:grid;gap:8px"><div class="kv"><span class="h">Selected save point: ${esc(c.id)}</span></div>
    <div class="git"><div><span class="k">commit</span> ${esc(c.commit)}</div><div><span class="k">ref</span> refs/tm/${esc(c.id)}</div><div><span class="k">branch</span> ${esc(c.branch ?? "(detached)")}${c.dirty ? " · had uncommitted changes" : ""}</div><div><span class="k">trigger</span> ${esc(c.trigger)}${c.agent ? ` · agent ${esc(c.agent.name)}` : ""}</div>${check}</div>
    ${vr?.log ? `<div class="row-btns"><button class="btn" data-act="reveal" data-path="${esc(vr.log)}">Show log</button><button class="btn ghost" data-act="copy" data-text="${esc(vr.log)}">Copy log path</button></div>` : ""}
    ${rows}
    <pre class="code">${esc(JSON.stringify(c, null, 2))}</pre></div>`;
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

/** The bar above every screen: where you are, Back to now when you are looking at the past, and ⋯ for the rest. */
function toolbar(): string {
  const p = project();
  const inProject = !!p && PROJECT_SCREENS.includes(st.screen);
  const where = inProject ? p.name : "";
  const newest = points().at(-1);
  const past = inProject && (st.screen === "compare" || (st.drawer && !!st.selected && st.selected !== newest?.id));
  const busy = st.busy ? "disabled" : "";
  const more = inProject && newest
    ? menuButton("tools", "More actions", [
        `<button data-act="save" ${busy}>Save now<kbd>${esc(keys("Mod+S"))}</kbd></button>`,
        `<button data-act="check" ${busy}>Check it works<kbd>${esc(keys("Mod+Enter"))}</kbd></button>`,
        `<button data-act="find" ${busy}>Find the last working version</button>`,
        `<button data-act="compare">Compare with now<kbd>${esc(keys("Mod+Shift+C"))}</kbd></button>`,
        `<button data-act="inspector">Open Inspector<kbd>${esc(keys("Mod+I"))}</kbd></button>`,
      ])
    : "";
  return `<div class="toolbar"><span class="tb-where">${esc(where)}</span>
    ${past ? `<button class="pill" data-act="now">Back to now<kbd>${esc(keys("Mod+↑"))}</kbd></button>` : ""}
    <span class="tb-sp"></span>
    <button class="jump" data-act="palette" aria-label="Jump to"><span>Jump to…</span><kbd>${esc(keys("Mod+K"))}</kbd></button>${more}</div>`;
}

/** Everything "Jump to…" can reach: actions first, then projects, then recent save points. */
function paletteItems(): PaletteItem[] {
  const p = project();
  const pts = points();
  const lw = lastWorking();
  const newest = pts.at(-1);
  const items: PaletteItem[] = [];
  if (p && newest) {
    items.push({ group: "Actions", label: "Save now", hint: keys("Mod+S"), act: "save" }, { group: "Actions", label: "Check it works", hint: keys("Mod+Enter"), act: "check" });
    if (lw && newest.verdict !== "PASS") items.push({ group: "Actions", label: goBackLabel(lw), hint: "last working version", act: "rewind-to", id: lw.id });
    items.push({ group: "Actions", label: "Find the last working version", hint: "", act: "find" });
    items.push({ group: "Actions", label: lw ? `Compare the ${when(lw.createdAt)} version with now` : "Compare with now", hint: keys("Mod+Shift+C"), act: "compare", ...(lw ? { a: lw.id, b: "now" } : {}) });
  }
  items.push(
    { group: "Actions", label: "Agents", hint: "connections", act: "agents" },
    { group: "Actions", label: "Storage", hint: "space and clean up", act: "storage" },
    { group: "Actions", label: "Settings", hint: keys("Mod+,"), act: "settings" },
    { group: "Actions", label: "Add project", hint: keys("Mod+N"), act: "add" },
    { group: "Actions", label: "Show shortcuts", hint: "?", act: "keys" },
  );
  for (const x of st.projects) {
    const s = st.statuses.get(x.id);
    items.push({ group: "Projects", label: x.name, hint: s?.problem ? "Can't find it" : verdictWord(s?.newest?.verdict ?? null), act: "project", id: x.id, verdict: s?.problem ? "ERROR" : (s?.newest?.verdict ?? null) });
  }
  for (const c of [...pts].reverse().slice(0, 12)) {
    items.push({ group: "Save points", label: `${when(c.createdAt)} · ${title(c)}`, hint: verdictWord(c.verdict), act: "open", id: c.id, verdict: c.verdict });
  }
  return items;
}

function paletteList(): string {
  const pal = st.palette;
  if (!pal) return "";
  const shown = filterPalette(paletteItems(), pal.q);
  if (!shown.length) return `<div class="pal-empty muted">Nothing matches “${esc(pal.q)}”.</div>`;
  let group = "";
  return shown
    .map((it, i) => {
      const head = it.group !== group ? `<div class="pal-g">${esc((group = it.group))}</div>` : "";
      const data = `${it.id ? ` data-id="${esc(it.id)}"` : ""}${it.a ? ` data-a="${esc(it.a)}"` : ""}${it.b ? ` data-b="${esc(it.b)}"` : ""}`;
      return `${head}<button class="pal-i ${i === pal.i ? "on" : ""}" role="option" aria-selected="${i === pal.i}" data-act="${it.act}"${data} data-pi="${i}">${it.verdict !== undefined ? glyph(it.verdict) : '<span class="pal-dot" aria-hidden="true"></span>'}<span class="pal-l">${esc(it.label)}</span><span class="pal-h">${esc(it.hint)}</span></button>`;
    })
    .join("");
}

function paletteView(): string {
  if (!st.palette) return "";
  return `<div class="scrim pal-scrim ${once("scrim:pal")}"><div class="pal" role="dialog" aria-modal="true" aria-label="Jump to">
    <input class="pal-q" data-model="pal" placeholder="Jump to a project, a save point or an action…" value="${esc(st.palette.q)}" aria-label="Jump to" autocomplete="off" spellcheck="false">
    <div class="pal-list" role="listbox">${paletteList()}</div>
    <div class="pal-foot muted"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>Esc</kbd> close</span></div>
  </div></div>`;
}

/** Only shortcuts that work today. */
function keysSheetView(): string {
  if (!st.keysSheet) return "";
  const row = (k: string, what: string): string => `<div class="ks-r"><span class="ks-k">${k.split(" ").map((x) => `<kbd>${esc(keys(x))}</kbd>`).join("")}</span><span>${esc(what)}</span></div>`;
  return `<div class="scrim ${once("scrim:keys")}"><div class="sheet ks" role="dialog" aria-modal="true" aria-label="Shortcuts">
    <div class="sheet-head"><h2>Shortcuts</h2><button class="btn ghost" data-act="close-keys">Close<kbd>Esc</kbd></button></div>
    <div class="ks-cols">
      <div><div class="ks-h">Everywhere</div>${row("Mod+K", "Jump to…")}${row("Mod+S", "Save now")}${row("Mod+Enter", "Check it works")}${row("Mod+Shift+R", "Go back to the last working version")}${row("Mod+Shift+C", "Compare with now")}${row("Mod+↑", "Back to now")}${row("Mod+Z", "Undo the last rewind")}${row("Mod+N", "Add project")}${row("Mod+,", "Settings")}${row("Mod+I", "Inspector")}${row("?", "Show shortcuts")}</div>
      <div><div class="ks-h">History</div>${row("↑ ↓", "Previous or next save point")}${row("Enter", "Open the save point")}${row("Space", "Go back to it")}${row("C", "Compare with now")}${row("Esc", "Close the drawer")}
        <div class="ks-h">Going back</div>${row("J L", "Step one save point")}${row("Shift+J Shift+L", "Next verdict change")}${row("T", "Try it first")}${row("C", "Compare with now")}${row("Enter", "Use this version, or try it if it is not proven")}${row("Esc", "Back to now, no change")}</div>
    </div></div></div>`;
}

function openPalette(): void {
  st.palette = st.palette ? null : { q: "", i: 0 };
  st.menu = null;
  render();
  root.querySelector<HTMLInputElement>(".pal-q")?.focus();
}

/** Keys while "Jump to…" is open. Returns true when the key was used. */
function paletteKey(e: KeyboardEvent): boolean {
  const pal = st.palette;
  if (!pal) return false;
  const n = filterPalette(paletteItems(), pal.q).length;
  if (e.key === "Escape") {
    st.palette = null;
    render();
  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    pal.i = n ? (pal.i + (e.key === "ArrowDown" ? 1 : n - 1)) % n : 0;
    const list = root.querySelector(".pal-list");
    if (list) list.innerHTML = paletteList();
    root.querySelector(".pal-i.on")?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    root.querySelector<HTMLButtonElement>(".pal-i.on")?.click();
  } else return false;
  e.preventDefault();
  return true;
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
            : st.screen === "agents" ? agentsScreen()
              : st.screen === "storage" ? storageScreen()
                : st.screen === "settings" ? settings()
                  : history();
  root.innerHTML = `<div class="shell">
    ${opts.preview ? `<div class="banner"><span><b>Preview with demo data.</b> Download the app to use it on your projects.</span>${(opts.previewActions ?? []).map((a, i) => `<button class="btn" data-act="preview" data-i="${i}">${esc(a.label)}</button>`).join("")}</div>` : ""}
    <div class="app">${scene ? sidebar().replace('<aside class="side">', '<aside class="side" inert>') : sidebar()}<main class="main" ${scene ? "inert" : ""}>${toolbar()}${main}${st.check ? checkSheet() : ""}${hookSheet()}${busyScrim()}</main>${scene ? timeView() : ""}${inspector()}${paletteView()}${keysSheetView()}${st.toast ? `<div class="toast ${once(`toast:${st.toast}`)}" role="status">${esc(st.toast)}</div>` : ""}</div></div>`;
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
    toast(`Saved at ${when(r.checkpoint.createdAt)}. Not checked yet.`);
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
    step: target ? "review" : "find", searched: false, mode: rewindMode(), returnTo, target, finding: false, find: null, progress: [], trying: false, tryResult: null,
    opening: false, openResult: null, recovering: false, result: null, error: null,
  };
}

/** Back to now: close the drawer and leave Compare, so the project screen shows the present again. */
function backToNow(): void {
  st.drawer = false;
  st.menu = null;
  if (st.screen === "compare") st.screen = "history";
  st.selected = points().at(-1)?.id ?? null;
  render();
}

/** `search` runs find-good even when a working version is already known. */
async function startRewind(target?: string, search = false): Promise<void> {
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
  // Known answer: a recorded Works save point after which the project broke. Go straight to it, no search.
  const known = target ?? (!search && points().at(-1)?.verdict !== "PASS" ? lastWorking()?.id : undefined);
  if (known) {
    st.rewind = newRewind(known, back);
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
  st.rewind = { ...newRewind(null, st.rewind?.returnTo), finding: true, searched: true };
  st.busy = "Finding";
  render();
  void loadChanges();
  try {
    const r = await api({ method: "findGood", projectId: p.id });
    st.rewind = { ...st.rewind, finding: false, find: r, target: r.found, step: r.found ? "review" : "find" };
  } catch (e) {
    st.rewind = { ...st.rewind, finding: false, error: msg(e) };
  }
  st.busy = null;
  await loadTimeline();
  await refreshStatuses();
  if (st.screen !== "rewind" && st.rewind) {
    const found = st.rewind.find?.found;
    toast(found ? `Found it. The ${pointName(found)} version is the last one that works. Press ${keys("Mod+Shift+R")} to see it.` : "We could not find a version that passes its check.");
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
  if (finished) toast(`The ${pointName(finished.id)} version is ready on a new branch. Your folder was not touched. Nothing was pushed. ${keys("Mod+Z")} undoes it.`);
}

/** Put the Time View playhead on another save point. Nothing runs until Try or Use. */
function tvGo(id: string | undefined): void {
  const r = st.rewind;
  if (!id || !r || r.finding || r.trying || r.recovering || r.step === "done" || r.target === id) return;
  if (!entry(id)) return;
  r.target = id;
  r.step = "review";
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
  r.step = "review";
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
    st.undo = { projectId: p.id, result: r.result, working: false };
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

/** Undo the last rewind: the engine removes its branch and recovery copy, only if both are untouched. */
async function undoRewind(): Promise<void> {
  const u = st.undo;
  if (!u || u.working || st.busy) return;
  u.working = true;
  st.busy = "Undoing the rewind";
  render();
  try {
    const r = await api({ method: "undoRecover", projectId: u.projectId, id: u.result.id, branch: u.result.branch, copyDir: u.result.copyDir });
    st.undo = null;
    st.busy = null;
    if (st.screen === "rewind" && st.rewind?.step === "done") {
      st.rewind = { ...st.rewind, result: null, step: "review" };
      exitRewind();
    }
    await loadTimeline();
    toast(`Rewind undone. Removed the new branch${r.removedCopy ? " and the recovery copy" : ""}. Every save point is still here.`);
  } catch (e) {
    u.working = false;
    st.busy = null;
    toast(msg(e));
  }
  void refreshStatuses().then(render);
}

async function openCompare(a?: string, b?: string): Promise<void> {
  const pts = points();
  const newest = pts.at(-1);
  const older = lastWorking()?.id ?? pts.at(-2)?.id ?? newest?.id ?? null;
  st.compare = { a: a ?? older, b: b ?? "now", now: null, result: null, loading: false, error: null };
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
    // "Now" is the folder as it is. Save it first, only if something changed, so the engine compares two save points.
    let nowId: string | null = null;
    if (a === "now" || b === "now") {
      const saved = await api({ method: "checkpoint", projectId: p.id, note: "Saved to compare with now", ifChanged: true });
      nowId = saved.checkpoint.id;
      st.compare.now = { id: nowId, skipped: saved.skipped };
      if (!saved.skipped) await loadTimeline();
    }
    st.compare.result = await api({ method: "diff", projectId: p.id, a: a === "now" ? (nowId ?? a) : a, b: b === "now" ? (nowId ?? b) : b });
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
    toast(r.result.findGood.found ? `Demo ready. The ${pointName(r.result.findGood.found)} version was the last one that works, and a recovery branch was made.` : "Demo ready.");
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

/** Agents, Storage or Settings. Each reads its own data; a failure leaves that part empty, never the screen. */
async function openPage(screen: "agents" | "storage" | "settings"): Promise<void> {
  st.screen = screen;
  st.drawer = false;
  if (screen === "storage") {
    st.storage = null;
    st.cleanup = null;
  }
  if (screen === "agents") st.agents = null;
  render();
  if (screen === "storage") await api({ method: "storage" }).then((r) => (st.storage = r), () => (st.storage = []));
  else if (screen === "agents") await api({ method: "agents" }).then((r) => (st.agents = r), () => (st.agents = []));
  else await api({ method: "isolation" }).then((r) => (st.isolation = r), () => undefined);
  if (st.screen === screen) render();
}

async function setSetting(patch: Partial<Settings>): Promise<void> {
  try {
    st.settings = await api({ method: "setSettings", patch });
    if ("hotkey" in patch) {
      st.hotkeyActive = patch.hotkey != null;
      st.hotkeyDraft = null;
    }
    applyTheme();
  } catch (e) {
    toast(msg(e));
  }
  render();
}

/** Store clean up: a preview first, then the removal of exactly the files the preview showed. */
async function cleanStore(projectId: string, apply: boolean): Promise<void> {
  if (st.cleanup?.working) return;
  const shown = st.cleanup?.projectId === projectId ? st.cleanup.result : null;
  if (apply && !shown) return;
  st.cleanup = { projectId, result: shown, working: true };
  render();
  try {
    const result = await api(apply ? { method: "cleanStore", projectId, apply, files: shown?.files ?? [] } : { method: "cleanStore", projectId, apply });
    st.cleanup = { projectId, result, working: false };
    if (apply) st.storage = await api({ method: "storage" });
  } catch (e) {
    st.cleanup = null;
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
  // Any action closes an open ⋯ menu and the palette. Opening them is the only exception.
  if (d.act !== "menu") st.menu = null;
  if (d.act !== "palette") st.palette = null;
  switch (d.act) {
    case "menu":
      st.menu = st.menu === d.v ? null : (d.v ?? null);
      return render();
    case "palette":
      return openPalette();
    case "keys":
      st.keysSheet = true;
      return render();
    case "close-keys":
      st.keysSheet = false;
      return render();
    case "project":
      if (d.id) await selectProject(d.id);
      return;
    case "add":
      return startAdd();
    case "demo":
      return runDemo();
    case "agents":
    case "storage":
    case "settings":
      return openPage(d.act);
    case "now":
      return backToNow();
    case "find":
      return startRewind(undefined, true);
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
    case "undo-rewind":
      return undoRewind();
    case "undo-dismiss":
      st.undo = null;
      return render();
    case "tv-go":
      return tvGo(d.id);
    case "tv-try":
      return tvTry();
    case "tv-use":
      return rewindDo();
    case "tv-compare":
      if (st.rewind?.target) return openCompare(st.rewind.target, "now");
      return;
    case "rewind-style":
      return setSetting({ simpleRewind: d.v === "sheet" });
    case "reload":
      await loadTimeline();
      return render();
    case "open":
      // From the palette on another screen: show History first, then the drawer.
      if (st.screen !== "history") {
        st.screen = "history";
        st.rewind = null;
      }
      if (st.selected !== d.id) st.openResult = null;
      st.selected = d.id ?? null;
      st.drawer = true;
      return render();
    case "close-drawer":
      st.drawer = false;
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
    case "rw-open":
      return rewindOpen();
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
      if (d.key === "agentPill") return setSetting({ agentPill: !st.settings.agentPill });
      return;
    case "hotkey-save": {
      const v = (st.hotkeyDraft ?? st.settings.hotkey ?? "").trim();
      return setSetting({ hotkey: v || null });
    }
    case "hotkey-off":
      return setSetting({ hotkey: null });
    case "clean-preview":
      if (d.id) await cleanStore(d.id, false);
      return;
    case "clean-apply":
      if (d.id) await cleanStore(d.id, true);
      return;
    case "remove":
      if (d.id) {
        try {
          st.projects = await api({ method: "removeProject", projectId: d.id });
          if (st.projectId === d.id) st.projectId = st.projects[0]?.id ?? null;
          toast("Removed from the app. Its save points stay in the store.");
          if (st.screen === "storage") await openPage("storage");
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
      if (st.screen === "agents") st.agents = await api({ method: "agents" }).catch(() => st.agents);
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
      void openPage("settings");
      return;
    case "add":
      return startAdd();
  }
}

/** The Rewind's own keys, in the Time View and the plain sheet. Returns true when the key was used. */
function rewindKey(e: KeyboardEvent): boolean {
  const r = st.rewind;
  if (!r || st.screen !== "rewind" || e.metaKey || e.ctrlKey || e.altKey) return false;
  const k = e.key;
  if (k === "Escape") {
    flash('[data-key="esc"]');
    if (!r.recovering) exitRewind();
    return true;
  }
  if (k === "Enter") {
    // Enter never waits for an animation. It does the main action now: Use when proven, else Try.
    flash('[data-key="enter"]');
    if (r.finding || r.trying || r.recovering || st.busy) return true;
    if (r.step === "done" || (r.find && !r.find.found && !r.target)) {
      exitRewind();
      return true;
    }
    const c = entry(r.target);
    if (!c) return true;
    if (shownVerdict(c) === "PASS") void rewindDo();
    else void tvTry();
    return true;
  }
  if (r.finding || r.trying || r.recovering || r.step === "done") return false;
  const lower = k.toLowerCase();
  const scene = r.mode === "scene";
  if (scene && (lower === "j" || k === "ArrowLeft")) tvStep(e.shiftKey ? "prevChange" : "back");
  else if (scene && (lower === "l" || k === "ArrowRight")) tvStep(e.shiftKey ? "nextChange" : "forward");
  else if (scene && k === "Home") tvStep("first");
  else if (scene && k === "End") tvStep("last");
  else if (lower === "t" && !e.shiftKey) {
    flash('[data-key="t"]');
    void tvTry();
  } else if (lower === "c" && !e.shiftKey && r.target && points().at(-1)?.id !== r.target) {
    flash('[data-key="c"]');
    void openCompare(r.target, "now");
  } else return false;
  return true;
}

function onKey(e: KeyboardEvent): void {
  const mod = isMac() ? e.metaKey : e.ctrlKey;
  const k = e.key.toLowerCase();
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
  if (paletteKey(e)) return;
  if (st.keysSheet && (k === "escape" || k === "?")) {
    st.keysSheet = false;
    render();
    return;
  }
  if (mod && k === "k") return void (e.preventDefault(), openPalette());
  if (k === "?" && !typing && !mod) return void (e.preventDefault(), (st.keysSheet = true), render());
  if (k === "escape" && st.menu) {
    st.menu = null;
    render();
    return;
  }
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
  if (mod && k === "i") return void (e.preventDefault(), shortcut("inspector"));
  if (mod && k === "arrowup" && !typing && PROJECT_SCREENS.includes(st.screen) && st.screen !== "rewind") return void (e.preventDefault(), flash('[data-act="now"]'), backToNow());
  if (mod && k === ",") return void (e.preventDefault(), flash('.side [data-act="settings"]'), shortcut("settings"));
  if (mod && k === "n") return void (e.preventDefault(), shortcut("add"));
  // Undo a rewind only where its button is: the Done step and History.
  const undoHere = st.screen === "history" || (st.screen === "rewind" && st.rewind?.step === "done");
  if (mod && k === "z" && !e.shiftKey && !typing && undoHere && st.undo && !st.undo.working) return void (e.preventDefault(), flash('[data-act="undo-rewind"]'), undoRewind());
  if (k === "escape") {
    if (st.check && (st.check.phase === "done" || st.check.error)) st.check = null;
    else if (st.hookSheet && !st.hookSheet.working) st.hookSheet = null;
    else if (st.drawer && st.screen === "history") st.drawer = false;
    render();
    return;
  }
  if (typing || st.screen !== "history" || st.check) return;
  const pts = points();
  const i = pts.findIndex((c) => c.id === st.selected);
  // History list is newest first, so Down goes back in time.
  if (k === "arrowdown" || k === "j" || k === "arrowleft") st.selected = pts[Math.max(0, i - 1)]?.id ?? st.selected;
  else if (k === "arrowup" || k === "l" || k === "arrowright") st.selected = pts[Math.min(pts.length - 1, i + 1)]?.id ?? st.selected;
  else if (k === "c" && st.selected) return void openCompare(st.selected, "now");
  else if (k === " " && st.selected) return void (e.preventDefault(), startRewind(st.selected));
  else if (k === "enter" && st.selected && !(e.target instanceof HTMLButtonElement)) st.drawer = true;
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
          if (ev.target) {
            st.selected = ev.target;
            st.drawer = true;
          }
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
    compare: { a: null, b: null, now: null, result: null, loading: false, error: null }, onboarding: emptyOnboarding(), inspector: false, drawer: false, menu: null, palette: null, keysSheet: false, records: [], storage: null,
    agents: null, isolation: null, cleanup: null, hotkeyDraft: null, hotkeyActive: boot.data.hotkeyActive,
    hookSheet: null, toast: null, demoBusy: false, openResult: null, verifyResults: new Map(), changes: new Map(), flash: null, undo: null,
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
    if (target.classList.contains("scrim") && (st.palette || st.keysSheet)) {
      st.palette = null;
      st.keysSheet = false;
      render();
      return;
    }
    const act = target.closest<HTMLElement>("[data-act]");
    if (act && !(act instanceof HTMLButtonElement && act.disabled)) void onClick(act);
    else if (st.menu && !target.closest(".mn-l")) {
      st.menu = null;
      render();
    }
  });
  root.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.model === "hotkey") {
      st.hotkeyDraft = t.value;
      return;
    }
    if (t.dataset.model === "pal" && st.palette) {
      st.palette = { q: t.value, i: 0 };
      const list = root.querySelector(".pal-list");
      if (list) list.innerHTML = paletteList();
      return;
    }
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
