// The app window: projects, the project journal with its entry detail, Check it works, the Rewind
// (the dial scene, or the plain sheet), Compare, Agents, Storage, Settings, onboarding and the Inspector.
// Plain TypeScript, one render function.
import type { CheckpointResult, CleanStoreResult, DiffResult, FindGoodResult, InitResult, OpenResult, RecoverResult, TimelineEntry, TimelineResult, VerdictRecord, VerifyResult } from "@timetm/core";
import type { AgentRow, AppEvent, AutoSave, Bootstrap, Call, CallOf, HookPreview, IsolationInfo, LicenseStatus, Method, ProjectEntry, ProjectPreview, ProjectStatus, Purpose, Results, RunNote, Settings, SourceRow, StorageResult, StoreProject, TmBridge, Verdict } from "../shared/api.js";
import { askConsentValid, type AskProvider } from "../shared/ask.js";
import { PRICING_URL } from "../shared/links.js";
import { tmCommand } from "../shared/commands.js";
import { bytes, checkSource, clock, dayLabel, esc, plural, pointAt, pointClock, pointTime, pointTitle, pointWhen, sameSecondLine, savePointPhrase, seconds, sentenceStart, shortTitle, triggerLabel, triggerSentence, twinOrdinal, verdictKey, verdictWord, versionPhrase, versionTimePhrase, when } from "../shared/format.js";
import { branchShift, changeSummary, checkReason, clockParts, damagedReason, gitLine, goBackLabel, goBackShort, isDamagedReason, lastWorking as lastWorkingOf, legendItems, newestByTime, passStreaks, projectStatus, railAge, type ChangeKinds, type StatusButton } from "./status.js";
import { filterPalette, reduceMotionItem, savePointItem, type PaletteItem } from "./palette.js";
import { dialAngle, dialIndex } from "./dial.js";
import { anywayBody, goBackSteps, REVIEW_KEY, reviewKey } from "./rewind-copy.js";
import { crossings, homeX, nearestTick, sceneX, stepIndex, type Step } from "./scrub.js";
import { verdictWas } from "./journal.js";
import { resetProjectCaches } from "./project-caches.js";
import { claudeChannel, PLANNED_AGENTS, type Channel } from "./channels.js";
import { renderAskPanel } from "./ask-panel.js";
import { renderDeployChips, renderUnlinkedDeploys } from "./deploys.js";
import { FEATURES_CHANGED } from "./feature-dom.js";
import { renderFeatureSettings } from "./feature-settings.js";
import { checkLede, hookStepActions, setupStrip, welcomeWords } from "./first-run.js";
import { plainNotSaved, shortSkip } from "./coverage.js";
import { BEAD_IN_MS, beadDelay, BLOCK_STAGGER_MAX, BLOCK_STAGGER_MS, blockDelay, ENTER_KEEP_MS, entranceDelay, FLICK_MS, GLIDE_MS, LEAVE_MS, PAGE_IN_MS, RING_MS, rowDelay, VERDICT_MS } from "./motion.js";
import { DialogFocus } from "./dialog-focus.js";
import { SPLASH_OUT } from "./splash.js";
import { ToastTimer } from "./toast.js";
import { confirmButtons, type ConfirmCopy } from "./confirm.js";
import { thinConfirm, thinReview, thinSummary } from "./thin-view.js";
import { dialCandidates, fitRow, placeLabels, type Box } from "./label-fit.js";
import { tailHtml, type LogTailView } from "./log-tail.js";
import { acceptRecord, checkBodyHtml } from "./check-record.js";
import { overviewPage, saveState, type DigestPoint } from "./overview.js";
import { hasCheck, PURPOSES, purposeIcon, unitCount } from "./purpose.js";
import { ADD_FULL, ADD_STEPS, addFullCard, autoSaveRow, buildOffered, checkStepCopy, defaultAutoSave, firstCheckChoice, folderWhenChoices, foundBefore, pathLede, pathProblem, pathSetupNote, purposeCards, savedOnlyToast, skipNote, type AddStep } from "./add-flow.js";
import { licenseAfterSave, planPage, resendLabel, resendWait, SIGNED_OUT, usage, type AccountView } from "./plan.js";
import { LABS_KEY, SOURCE_PURPOSE, sourcesPage, WHOLE_FOLDER, wholeFolderAsk } from "./sources.js";
import { changedLine, filterBar, filtered, nameCount, noPinned, noteBlock, noteSaveWords, pinIcon, rowTitle, shownTitle, unitWords, type JournalFilter, type NoteDraft } from "./runs.js";
import { restoreRoute, ROUTE_KEY } from "./route.js";

export interface StartOptions {
  preview: boolean;
  /** The preview shows the timeline strip inside the page. The real app uses a global hotkey. */
  onStrip?: (projectId: string) => void;
  /** Extra buttons in the preview banner, such as "Show the overlay card". */
  previewActions?: { label: string; run: () => void }[];
}

type Screen = "welcome" | "overview" | "onboarding" | "history" | "rewind" | "compare" | "agents" | "storage" | "settings" | "plan" | "sources";

/** Screens that belong to the selected project. The others are app wide. */
const PROJECT_SCREENS: readonly Screen[] = ["history", "rewind", "compare"];

interface CheckState {
  phase: "saving" | "checking" | "done";
  cp: string | null;
  skipped: boolean;
  result: VerifyResult | null;
  error: string | null;
  /** When the check started, for the running sheet's clock, and when it ended: the one duration the sheet shows. */
  startedAt: number;
  endedAt: number | null;
  /** The lines the running check printed so far, once its log has any: until then the copy is still being made. */
  live: string[] | null;
  /** The control that opened the sheet, so closing it puts focus back there. */
  opener: string;
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
  step: AddStep;
  /** What the folder is for, picked first. It sets the words and whether a check is required. */
  purpose: Purpose | null;
  path: string | null;
  /** What adding the folder would give, read at step 2 with nothing written. Steps 3 and 4 work from it until the project is added. */
  preview: ProjectPreview | null;
  /** The project once it is added: at Finish, or earlier when Try it now or a Git project's Claude Code step needs it. */
  project: ProjectEntry | null;
  /** True when this flow put the project in the list, so Cancel or Back takes it out again. */
  added: boolean;
  init: InitResult | null;
  current: string;
  /** "none": no check, only save versions. Offered only when the purpose does not need one. */
  choice: "detected" | "build" | "custom" | "none";
  custom: string;
  working: boolean;
  trying: boolean;
  tryResult: VerifyResult | null;
  hook: HookPreview | null;
  /** Why the Claude Code lines could not be prepared. Finishing still works without them. */
  hookError: string | null;
  hookDone: string | null;
  /** When to save besides Save now: on change while the app is open, or not. Starts at the engine's default for the project. */
  autoSave: AutoSave;
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
  navOpen: boolean;
  connection: { state: "connecting" | "connected" | "disconnected"; message?: string } | null;
  pageError: string | null;
  inspector: boolean;
  /** The entry detail for `selected`: the right column when the window is wide, a full sheet when narrow. */
  drawer: boolean;
  /** The Ask column on the right of project screens. ⌘J shows or hides it. */
  askOpen: boolean;
  /** Folded runs of automatic saves the user opened, by the id of their newest save point. */
  unfolded: Set<string>;
  /** A journal entry briefly tinted after a citation brought it into view. */
  lit: string | null;
  /** The time of the newest "agent-turn ended" audit line per project, refreshed with sidebar state. */
  lastTurn: Map<string, string>;
  /** Deploy chip HTML per save point id, from the deploys module. Empty when nothing is linked. */
  deployChips: Map<string, string>;
  /** The open ⋯ menu, if any. */
  menu: string | null;
  /** "Jump to…" (⌘K): the typed text and the highlighted row. */
  palette: { q: string; i: number } | null;
  /** The shortcut sheet (?). */
  keysSheet: boolean;
  records: Record[];
  storage: StorageResult | null;
  /** Projects with history in the store that the app does not list, read with Storage. */
  storeProjects: StoreProject[] | null;
  agents: AgentRow[] | null;
  /** Every project's save points for Overview, oldest first; "error" when one could not be read. Read when Overview opens. */
  overview: Map<string, DigestPoint[] | "error">;
  /** Well-known folders on this computer for Sources: null while read, "error" when they could not be. */
  sources: SourceRow[] | null | "error";
  /** Sources › Labs preview: planned connectors with sample data. Kept in this browser. */
  labs: boolean;
  /** Names, notes and pins of the selected project's save points, by id. Read after the timeline, and again after each change. */
  notes: Map<string, RunNote>;
  /** The journal shows every save point, or only pinned ones. */
  journalFilter: JournalFilter;
  /** The name and note being typed in the open detail, and whether they are being saved. */
  noteDraft: NoteDraft | null;
  noteSaving: boolean;
  isolation: IsolationInfo | null;
  /** A store clean up: first a preview of what goes, then the real removal. One project at a time. */
  cleanup: { projectId: string; result: CleanStoreResult | null; working: boolean } | null;
  /** Thin old auto saves: one project at a time. First the engine's preview, then Review, then Remove N behind the confirm. */
  thin: { projectId: string; working: boolean; preview: Results["thinPreview"] | null; review: boolean; removed: number | null } | null;
  hookSheet: { projectId: string; preview: HookPreview; done: string | null; error: string | null; working: boolean } | null;
  demoBusy: boolean;
  /** The demo's three steps on History: drag to the save point that works, go back to it, then undo or keep it. */
  coach: { projectId: string; target: string; went: boolean } | null;
  openResult: OpenResult | null;
  /** The last check result per save point in this session, for evidence lines (time taken, network). */
  verifyResults: Map<string, VerifyResult>;
  /** The end of each check run's log in this session, by log path. Shown and copied only. */
  logTails: Map<string, LogTailView>;
  /**
   * The newest sealed record of a verdict this session did not check (checkRecord), by `storedKey`; null while it is read
   * or when none fits. Kept apart from verifyResults, whose readers say "checked at" for a check of this session.
   * Read by the detail and the Inspector only; never sent to Ask, a report or an export.
   */
  storedChecks: Map<string, VerdictRecord | null>;
  /** Paths changed in each save point since the one before it. Read in the background for the journal and the Rewind. */
  changes: Map<string, string[]>;
  /** How many checks in a row passed for each save point, from the audit log. */
  passes: Map<string, number>;
  /** The project and newest save point whose changes were last read (loadChanges), so a read is not repeated. */
  changesFor: string;
  /** A confirm before removing a project, going back to a version without proof, or protecting a whole folder (with its path
   *  and what it is for, so either answer can carry on into the Add flow). */
  confirm: (ConfirmCopy & { act: "remove" | "tv-use" | "thin" | "whole-folder" | "restore" | "forget"; id: string | null; path?: string; purpose?: Purpose | null }) | null;
  /** A button that shows its pressed state because its shortcut just fired. */
  flash: { sel: string; until: number } | null;
  /** The last rewind in this session, until it is undone or a new one replaces it. ⌘Z undoes it. */
  undo: { projectId: string; result: RecoverResult; working: boolean } | null;
  /** The license on this computer, the key being pasted in Settings, and the last save or remove error. */
  license: { status: LicenseStatus; draft: string; working: boolean; error: string | null };
  /** Sign in to get your key, on Plan. In memory only; the sign-in token itself stays in the server. */
  account: AccountView;
  /** The copy "Bring back a copy…" made for a project whose folder is gone, so its notice can say where it is. */
  copyMade: { projectId: string; dir: string } | null;
  /** The service Ask would send to, from the keys set: null with no key, undefined until read. */
  askProvider: AskProvider | null | undefined;
}

class ApiFailure extends Error {}

const RECORDED: Method[] = ["init", "setCheck", "checkpoint", "diff", "open", "verify", "findGood", "recover", "undoRecover", "log", "hookInstall", "forget", "demo", "cleanStore"];
const TITLES: Partial<{ [M in Method]: string }> = {
  init: "Set up", setCheck: "Change the check", checkpoint: "Save now", diff: "Compare", open: "Try it in a copy", verify: "Check it works",
  findGood: "Find the last working version", recover: "Use this version", undoRecover: "Undo this rewind", log: "Audit log", hookInstall: "Connect Claude Code", forget: "Disconnect Claude Code", demo: "Try the demo",
  cleanStore: "Clean up storage",
};

/** Shown instead of "Add these lines" when the hook command did not answer its version check. */
const hookNotRunning = "This command does not run on this computer yet, so we won’t add it. Claude Code would fail at every prompt and nothing would be saved.";

let bridge: TmBridge;
let opts: StartOptions;
let st: State;
let root: HTMLElement;
/** The toast host lives outside the redraw tree, so a redraw never restarts a toast, moves focus off Dismiss, or repeats it to a screen reader. */
let toastHost: HTMLElement;
const toastTimer = new ToastTimer(() => dismissToast());
let announcer: HTMLElement;
const dialogFocus = new DialogFocus();
let addReturn: { screen: Screen; focus: string | null } | null = null;

function emptyOnboarding(): OnboardingState {
  return { step: 1, purpose: null, path: null, preview: null, project: null, added: false, init: null, current: "", choice: "detected", custom: "", working: false, trying: false, tryResult: null, hook: null, hookError: null, hookDone: null, autoSave: "off", first: null, error: null };
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
    // A stopped check proves nothing, so the save point keeps the verdict it had.
    if (!v.stopped) st.verifyResults.set(v.checkpoint, v);
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

/** The project's folder is not where it was: the statuses say so, or the timeline the engine read from the store does.
 *  Its history then shows read only, with "It moved…" and "Bring back a copy…". */
function folderMissing(p: ProjectEntry | null): boolean {
  if (!p) return false;
  if (st.statuses.get(p.id)?.problemKind === "missing") return true;
  const t = p.id === st.projectId ? st.timeline : null;
  return !!t && "missing" in t && t.missing === true;
}

/** A save point's time of day, told apart from this project's other save points (seconds when two share a minute, "#N" when two share a second). For rulers, lists and ids, not sentences. */
const ptClock = (c: TimelineEntry): string => pointClock(c, points());
/** `ptClock` with the day in front when it is not today. */
const ptWhen = (c: TimelineEntry): string => pointWhen(c, points());
/** `ptClock` without the "#N", for a heading or readout that says which twin elsewhere. */
const ptTime = (c: TimelineEntry): string => pointTime(c, points());
/** When a save point was made, for a sentence: "8:16 PM", or "the second save at 8:16:05 PM" for one of two in a second. */
const ptAt = (c: TimelineEntry): string => pointAt(c, points());

/** The check sheet's quiet Done beside a main action. At <= 360 px it hides and the sheet's head shows a text Done. */
const QUIET_DONE = '<button class="btn quiet ck-dq" data-act="close-check">Done</button>';

/** An engine reason, escaped, with the names you type (a setting, the config file, a command) set in mono. */
function reasonHtml(text: string): string {
  return esc(text).replace(/\b(verify\.command|verify\.network|timemachine\.yml|npm test)\b/g, '<code class="mono">$1</code>');
}

/** The open project's last version that works, while it checks. A project with no check now is never offered one: its old
 *  Works badges stay as history, but nothing points back to "the last version that works" (Design re-check 1). */
function lastWorking(): TimelineEntry | null {
  return checksOn(project()) ? lastWorkingOf(points()) : null;
}

/** The save point Check it works is running on right now, so its button, row and bead show the work: "new" while
 *  it is still saving where you are first. Null when no check runs. */
function checkRunning(): string | null {
  const c = st.check;
  if (!c || c.phase === "done" || c.error) return null;
  return c.cp ?? "new";
}

/** Project verdicts and agent states for the sidebar. Both are niceties: a failure leaves the screens working. */
async function refreshStatuses(): Promise<void> {
  const [statuses, agents] = await Promise.all([bridge.call({ method: "statuses" }), bridge.call({ method: "agents" }), loadLastTurns()]);
  if (statuses.ok) st.statuses = new Map(statuses.data.map((s) => [s.projectId, s]));
  if (agents.ok) st.agents = agents.data;
}

/** One light read of the statuses alone. Redraws only when a project's state changed: a folder went missing or came
 *  back, a new save point, a new verdict. When the open project's folder went or came back, its History is read again. */
async function pollStatuses(): Promise<void> {
  const r = await bridge.call({ method: "statuses" });
  if (!r.ok || st.busy) return;
  const key = (list: Iterable<ProjectStatus>): string => JSON.stringify([...list].map((s) => [s.projectId, s.problemKind, s.problem, s.newest?.id ?? null, s.newest?.verdict ?? null]));
  if (key(r.data) === key(st.statuses.values())) return;
  const p = project();
  const wasGone = folderMissing(p);
  st.statuses = new Map(r.data.map((s) => [s.projectId, s]));
  if (p && PROJECT_SCREENS.includes(st.screen) && folderMissing(p) !== wasGone) await loadTimeline();
  if (!st.busy) render();
}

/** The rail's "3 min" and "2 h" move on without a redraw. */
function tickAges(): void {
  root.querySelectorAll<HTMLElement>(".pj-age[data-at]").forEach((el) => {
    const age = railAge(el.dataset.at ?? "");
    if (el.textContent !== age) el.textContent = age;
  });
}

/** Which service Ask would send to, from the keys set, so the rail never says Ask sends anything while no key exists. */
async function loadAskProvider(): Promise<void> {
  const r = await bridge.call({ method: "credentials" });
  st.askProvider = r.ok ? r.data.provider : null;
  render();
}

/** Reads the open project's save points with their names, so a list never shows without the names it had (writer#13). */
async function loadTimeline(): Promise<void> {
  const p = project();
  if (!p) return;
  try {
    const [timeline] = await Promise.all([api({ method: "timeline", projectId: p.id }), loadNotes(false)]);
    st.timeline = timeline;
    st.timelineError = null;
    const ids = points().map((c) => c.id);
    if (!st.selected || !ids.includes(st.selected)) st.selected = ids.at(-1) ?? null;
    void loadChanges();
    void loadDeployChips();
    void loadPasses();
  } catch (e) {
    st.timeline = null;
    st.timelineError = msg(e);
  }
}

/** Deploy chips for the journal, matched by recorded commit in the deploys module. Empty when nothing is linked. */
async function loadDeployChips(): Promise<void> {
  const p = project();
  if (!p) return;
  try {
    const chips = await renderDeployChips(p.id, points(), bridge);
    if (st.projectId !== p.id) return;
    st.deployChips = chips;
  } catch {
    st.deployChips = new Map();
  }
  if (st.screen === "history") render();
}

/** Names, notes and pins for the selected project, read straight from the bridge. None yet is an empty list; a read that
 *  fails keeps the names already shown, so a hiccup never strips every row back to "Auto save". */
async function loadNotes(redraw = true): Promise<void> {
  const p = project();
  if (!p) return;
  const r = await bridge.call({ method: "notes", projectId: p.id });
  if (st.projectId !== p.id || !r.ok) return;
  st.notes = new Map(Object.entries(r.data));
  if (redraw && st.screen === "history") render();
}

/**
 * Saves the open detail's name and note, then reads the notes again: setNote sends no live event. An empty name and note
 * with no pin removes the note. The pin is left as it is.
 */
async function saveNote(id: string): Promise<void> {
  const p = project();
  const draft = st.noteDraft?.id === id ? st.noteDraft : null;
  if (!p || !draft || st.noteSaving) return;
  st.noteSaving = true;
  render();
  try {
    const words = noteSaveWords(draft, st.notes.get(id));
    await api({ method: "setNote", projectId: p.id, id, title: draft.title.trim(), note: draft.note });
    st.noteDraft = null;
    await loadNotes();
    toast(words.toast);
  } catch (e) {
    toast(msg(e));
  }
  st.noteSaving = false;
  render();
  root.querySelector<HTMLElement>('form[data-form="note"] [type="submit"]')?.focus({ preventScroll: true });
}

/** Pins or unpins a save point, then reads the notes again. */
async function togglePin(id: string): Promise<void> {
  const p = project();
  if (!p || st.noteSaving) return;
  const pinned = !st.notes.get(id)?.pinned;
  st.noteSaving = true;
  render();
  try {
    await api({ method: "setNote", projectId: p.id, id, pinned });
    await loadNotes();
    toast(pinned ? "Pinned. Find it under Pinned in History." : "Unpinned.");
  } catch (e) {
    toast(msg(e));
  }
  st.noteSaving = false;
  render();
  root.querySelector<HTMLElement>(`[data-act="pin"][data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
}

/** Opens one save point's detail in its project's History, from anywhere (a toast's "See what"). */
async function openSavePoint(projectId: string, id: string): Promise<void> {
  if (st.projectId !== projectId || !PROJECT_SCREENS.includes(st.screen)) await selectProject(projectId);
  else await loadTimeline();
  st.screen = "history";
  st.selected = id;
  st.drawer = true;
  render();
}

async function selectProject(id: string, screen: Screen = "history"): Promise<void> {
  resetProjectCaches(st, id);
  st.screen = screen;
  void bridge.call({ method: "setActive", projectId: id });
  await loadTimeline();
  render();
}

/** A short note in the work area, never over the rail: an ink pill. A verdict, when the note is about one, leads with its glyph;
 *  when the action can be taken back, Undo sits in it as a sky key; another one-step action ("See what") takes the same key. */
function toast(text: string, verdict?: Verdict | null, opts: { undo?: () => void; action?: { label: string; run: () => void } } = {}): void {
  const action = opts.undo ? { label: "Undo", run: opts.undo } : opts.action;
  const card = document.createElement("div");
  card.className = "toast enter";
  card.innerHTML = `${verdict !== undefined ? glyph(verdict) : ""}<span class="toast-t">${esc(text)}</span>${action ? `<button type="button" class="toast-undo">${esc(action.label)}</button>` : ""}<button type="button" class="btn link toast-x">Dismiss</button>`;
  card.addEventListener("pointerenter", () => toastTimer.hold("hover"));
  card.addEventListener("pointerleave", () => toastTimer.release("hover"));
  card.addEventListener("focusin", () => toastTimer.hold("focus"));
  card.addEventListener("focusout", (e) => {
    if (!(e.relatedTarget instanceof Node && card.contains(e.relatedTarget))) toastTimer.release("focus");
  });
  card.querySelector(".toast-x")?.addEventListener("click", dismissToast);
  if (action) card.querySelector(".toast-undo")?.addEventListener("click", () => {
    dismissToast();
    action.run();
  });
  toastHost.replaceChildren(card);
  toastRoom(card);
  toastTimer.start();
}

/** The page card ends above a showing toast, by the toast's height, so the toast never sits on a card or a button (dev#39). */
function toastRoom(card: HTMLElement | null): void {
  const html = document.documentElement;
  html.classList.toggle("toasting", !!card);
  if (card) html.style.setProperty("--toast-room", `${Math.ceil(card.offsetHeight)}px`);
}

function dismissToast(): void {
  toastTimer.stop();
  const card = toastHost.querySelector<HTMLElement>(".toast:not(.leave)");
  if (!card) return;
  toastRoom(null);
  if (reducedMotion()) return card.remove();
  card.classList.add("leave");
  card.inert = true;
  card.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(6px)" }], { duration: LEAVE_MS, easing: "cubic-bezier(.22,1,.36,1)", fill: "forwards" }).onfinish = () => card.remove();
}

// Small view helpers

const isMac = (): boolean => st.boot.platform === "darwin";
const device = (): string => "this computer";
/** The button that opens a copy's folder: Finder on a Mac, else the path is copied. */
const revealLabel = (): string => (isMac() ? "Show in Finder" : "Copy local path");

/**
 * Our own symbol for each agent the app lists, drawn here in the orange family: Claude Code a C with a block cursor,
 * Codex a prompt (>_), Gemini the twins sign (two pillars, joined). Never a provider's logo or a lookalike of one; the
 * symbols differ by shape, not only by shade, and the name is always written beside them. Any other agent gets its initials.
 */
const AGENT_GLYPHS: { [K in "claude" | "codex" | "gemini"]: string } = {
  claude: '<path d="M15.24 7.76A6 6 0 1 0 15.24 16.24"/><rect x="15.2" y="10.3" width="4.2" height="3.4" rx=".7" fill="currentColor" stroke="none"/>',
  codex: '<path d="M5.5 7.5 10 12l-4.5 4.5"/><path d="M12.5 17h6"/>',
  gemini: '<path d="M9.2 7.7v8.6M14.8 7.7v8.6"/><path d="M5.6 6.2c4.1 1.9 8.7 1.9 12.8 0M5.6 17.8c4.1-1.9 8.7-1.9 12.8 0"/>',
};
function agentMark(name: string): string {
  const kind = /claude/i.test(name) ? "claude" : /codex/i.test(name) ? "codex" : /gemini/i.test(name) ? "gemini" : null;
  if (kind) return `<span class="amark am-${kind}" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false">${AGENT_GLYPHS[kind]}</svg></span>`;
  const words = name.split(" ");
  const initials = words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : name.slice(0, 2);
  return `<span class="amark" aria-hidden="true">${esc(initials)}</span>`;
}
function keys(k: string): string {
  if (isMac()) return k.replace("Mod+", "⌘").replace("Shift+", "⇧").replace("Enter", "↵");
  return k.replace("Mod+", "Ctrl+");
}
function badge(v: Verdict | null, cls = ""): string {
  return `<span class="vb v-${verdictKey(v)}${cls ? ` ${cls}` : ""}">${vIcon(v)}${esc(verdictWord(v))}</span>`;
}
/** Shown next to the first verdict someone sees, until they hide it. It names the words once, where they appear. */
function verdictTip(): string {
  if (st.settings.verdictTipSeen) return "";
  return `<div class="note tip" role="note"><p><b>Reading verdicts.</b> Works means your check passed in a copy. Broken means it failed. Not checked yet means no check has run. Each save point keeps its verdict in History, so you can find the last version that works.</p><button class="btn ghost" data-act="tip-hide">Hide this tip</button></div>`;
}
function glyph(v: Verdict | null): string {
  return `<i class="g v-${verdictKey(v)}" aria-hidden="true"></i>`;
}
/** The buddy: the small white machine (a screen with two eyes, a dial with a sky pointer) that is the app's mark and voice. */
function buddy(cls = ""): string {
  return `<svg class="buddy${cls ? ` ${cls}` : ""}" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><rect x="4.5" y="9.5" width="31" height="23" rx="7" fill="#141414"/><rect x="3" y="8" width="31" height="23" rx="7" fill="#fff" stroke="#141414" stroke-width="1.8"/><rect x="7.5" y="12.5" width="11" height="8" rx="2.4" fill="#141414"/><circle class="eye" cx="11" cy="16.5" r="1.4" fill="#5fd39a"/><circle class="eye" cx="15" cy="16.5" r="1.4" fill="#5fd39a"/><circle cx="26" cy="19.5" r="6" fill="#fff" stroke="#141414" stroke-width="1.8"/><path d="M26 19.5l-3.2-3.4" stroke="#0d4a8f" stroke-width="2.2" stroke-linecap="round"/><rect x="7.5" y="23.5" width="11" height="3.4" rx="1.7" fill="#cfe6ff" stroke="#141414" stroke-width="1.2"/></svg>`;
}
/**
 * An empty list: the buddy at 64 px, one sentence and one action, centred where the list would be. For the palette's
 * no-match, Agents, Storage and History's all-clear as well as the project lists. `line` and `voice` are plain text and are
 * escaped here; `action` is the caller's own button markup, so it keeps its data-act.
 */
function emptyState({ line, voice, action }: { line: string; voice?: string; action?: string }): string {
  return `<div class="empty-state">${buddy("big")}<p class="es-line">${esc(line)}</p>${voice ? `<p class="es-voice voice">${esc(voice)}</p>` : ""}${action ? `<div class="row-btns">${action}</div>` : ""}</div>`;
}
/** A verdict's shape as a small icon: a check for Works, a cross for Broken, a ring for everything else. */
function vIcon(v: Verdict | null): string {
  const path = v === "PASS" ? '<path d="M3.5 8.4l2.9 2.9L12.6 5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'
    : v === "FAIL" ? '<path d="M4.8 4.8l6.4 6.4M11.2 4.8l-6.4 6.4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'
      : v === "ERROR" ? '<path d="M8 4.2v4.6M8 11.4v.4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'
        : v === "BLOCKED" || v === "INCOMPLETE" ? '<path d="M4.5 8h7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'
          : '<circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" stroke-width="2"/>';
  return `<svg class="vi" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${path}</svg>`;
}
/** A row's time: "2:43:36 AM" whole on one line, and a same-second ordinal ("#3") on a line of its own below it. */
function timeParts(t: string): string {
  const { time, ord } = clockParts(t);
  return `<span class="tm-t">${esc(time)}</span>${ord ? `<span class="tm-o">${esc(ord)}</span>` : ""}`;
}
/** Times inside a sentence never break in the middle: "2:08:05 AM" stays on one line. Takes and returns escaped HTML. */
function keepTimes(html: string): string {
  return html.replace(/\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp]\.?[Mm]\.?)?(?: #\d+)?/g, (t) => `<span class="nw">${t}</span>`);
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

/** What a save point was made as, before anyone named it. `author` is the author line shown beside it, if any, so the agent is named once. */
function madeTitle(c: TimelineEntry, author: string | null = null): string {
  // The engine names the save it makes before a rewind by save point id. Say it by time instead.
  const before = c.trigger === "recover" ? /^Before recovering (\S+)$/.exec(c.note) : null;
  if (before?.[1]) return `Before going back to ${pointName(before[1])}`;
  const made = pointTitle(c, author);
  // An untitled save is named by what it did ("309 files deleted"), once its diff is read.
  return (made.trim() ? "" : changeWords(c)) || rowTitle(made, c.trigger, st.changes.get(c.id));
}

/** A save point's title: the name it was given, else what it was made as. Every place that shows a save point uses it: rows, the Rewind, Compare. */
function title(c: TimelineEntry, author: string | null = null): string {
  return shownTitle(madeTitle(c, author), st.notes.get(c.id));
}

/** Coverage lines in plain words. Git details add the commit, never replace the words. Tool versions are a code project's. */
function savedLines(c: TimelineEntry): string[] {
  const code = project()?.purpose === "code";
  return c.coverage.captured.flatMap((line) => {
    if (line.startsWith("Code:")) {
      const words = line.includes("uncommitted") ? "Your code, including work you had not committed yet" : "Your code";
      return st.settings.showGitDetails ? `${words} (${line.slice(6)})` : words;
    }
    const files = /^Files: (\d+) files? not in Git$/.exec(line);
    if (files) return otherFiles(Number(files[1]));
    const cfg = /^Config: .+ in (.+) \((\d+) saved, (\d+) name only\)$/.exec(line);
    if (cfg) return `Settings in ${cfg[1]}: ${plural(Number(cfg[2]), "value")} saved, ${plural(Number(cfg[3]), "secret")} by name only`;
    if (line.startsWith("Dependencies:")) return `Package lock files: ${line.slice(14)}`;
    if (line.startsWith("Environment:")) {
      if (!code && !st.settings.showGitDetails) return [];
      const tools = line.slice(13).split(", ").filter((x) => !x.startsWith("platform "));
      return st.settings.showGitDetails ? `Tool versions: ${line.slice(13)}` : `Tool versions: ${tools.join(", ")}`;
    }
    return line;
  });
}
function notSavedLines(c: TimelineEntry): string[] {
  const code = project()?.purpose === "code";
  return [...c.coverage.missing, ...c.coverage.manual].map((line) => plainNotSaved(line, code));
}

/** A line of what a rewind brought back, in plain words. Git details add the commit. `dirty`: the save point held work that was not committed yet. */
function plainRestored(line: string, dirty: boolean): string {
  const code = /^Code at commit (\S+)$/.exec(line);
  if (code) return codeLine(st.settings.showGitDetails ? code[1]! : null, dirty);
  const files = /^(\d+) saved files?$/.exec(line);
  if (files) return otherFiles(Number(files[1]));
  return line.startsWith("Config: ") ? `Settings: ${line.slice(8)}` : line;
}

/** The code line in what comes back. A revert brings back commits; this says when uncommitted work comes back too. */
function codeLine(commit: string | null, dirty: boolean): string {
  return `${commit ? `Code, commit ${commit}` : "Code"}${dirty ? ", including work that was not committed yet" : ""}`;
}

/** Files Git does not track, said without Git. A plain folder has no code to sit next to. Git details add the Git words. */
function otherFiles(n: number): string {
  if (project()?.kind === "folder") return `${plural(n, "file")} we saved from your folder`;
  return `${plural(n, "other file")} we saved next to your code${st.settings.showGitDetails ? " (not tracked by Git)" : ""}`;
}

// Views

/** A rail destination's small line icon, drawn in the text colour. The label beside it carries the meaning. */
function navIcon(name: "overview" | "sources"): string {
  const paths = {
    overview: '<rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1.4"/><rect x="11" y="3.5" width="5.5" height="5.5" rx="1.4"/><rect x="3.5" y="11" width="5.5" height="5.5" rx="1.4"/><rect x="11" y="11" width="5.5" height="5.5" rx="1.4"/>',
    sources: '<ellipse cx="10" cy="5.5" rx="6" ry="2.3"/><path d="M4 5.5v4.5c0 1.3 2.7 2.3 6 2.3s6-1 6-2.3V5.5M4 10v4.5c0 1.3 2.7 2.3 6 2.3s6-1 6-2.3V10"/>',
  };
  return `<svg class="nav-ic" viewBox="0 0 20 20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}

/** A small page icon before what a save point changed. Decorative: the file names beside it carry the meaning. */
const FILE_ICON = '<svg class="e-fi" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M4 2.5h5l3 3v8H4z"/><path d="M9 2.5v3h3"/></svg>';

/** The rail: the buddy and the name, Jump to, Overview, what is protected with its verdict, the agents, then where the history lives, the plan, Storage and Settings. */
function sidebar(mobile = false): string {
  const inProject = PROJECT_SCREENS.includes(st.screen);
  const items = st.projects
    .map((p) => {
      const s = st.statuses.get(p.id);
      // A project with no check shows when it saved, not a verdict it can never get.
      const checks = checksOn(p);
      const v = checks ? (s?.newest?.verdict ?? null) : null;
      // Before the statuses arrive the rail says it is reading, never "No save points yet" (cli#27). A store that can't be
      // written is not a missing folder: it says so, and the server's sentence is in the title (cli#5).
      // The open project's time is told the way its rows and header tell it: seconds only when another save shares the minute.
      const shown = p.id === st.projectId && s?.newest ? entry(s.newest.id) : null;
      const label = !s ? "Loading…" : s.problemKind === "missing" ? "Can’t find it" : s.problemKind === "permission" ? "Can’t save" : s.problem ? "Needs a look" : !s.newest ? "No save points yet" : checks ? verdictWord(v) : shown ? `Saved ${ptWhen(shown)}` : saveState(s.newest);
      const age = s?.newest && !s.problem ? `<span class="pj-age" data-at="${esc(s.newest.createdAt)}" title="${esc(`Last saved ${when(s.newest.createdAt)}`)}">${esc(railAge(s.newest.createdAt))}</span>` : "";
      const on = p.id === st.projectId && inProject;
      // The purpose icon carries the status dot on its corner. The name gets the whole first line; the status and the age
      // share the second, the age on the right.
      return `<button class="it project-it${on ? " on" : ""}" data-act="project" data-id="${p.id}" ${on ? 'aria-current="page"' : ""} title="${esc(s?.problem && s.problemKind !== "missing" ? s.problem : p.path)}">
        <span class="pj-ic">${purposeIcon(p.purpose, "sm")}<span class="dot v-${verdictKey(s?.problem ? "ERROR" : v)}" aria-hidden="true"></span></span><span class="nm"><span>${esc(p.name)}</span><small class="project-verdict"><span>${esc(label)}</span>${age}</small></span></button>`;
    })
    .join("");
  const claude = claudeChannel(st.agents ?? [], st.lastTurn);
  const agent = (ch: Channel): string =>
    `<button class="it ag" data-act="agents" title="${esc(`${ch.name}: ${ch.line}`)}">${agentMark(ch.name)}<span class="nm"><span>${esc(ch.name)}</span><small>${esc(ch.short)}</small></span>${ch.state === "working" ? '<i class="breath" aria-hidden="true"></i>' : ""}</button>`;
  // Codex and Gemini each get their own quiet row, marked Planned: they are not connected and do nothing yet.
  const planned = PLANNED_AGENTS.map((a) => `<button class="it ag off" data-act="agents" title="${esc(`${a.name}: planned, not connected`)}">${agentMark(a.name)}<span class="nm"><span>${esc(a.name)}</span><small>Planned</small></span></button>`).join("");
  const total = st.storage?.storeBytes;
  const lic = st.license.status;
  const used = st.projects.length;
  // The plan card: the free plan's projects against its limit, or the license. It opens Plan, where the license lives.
  const planAttrs = st.screen === "plan" ? 'class="plan on" aria-current="page"' : 'class="plan"';
  const plan = lic.active
    ? `<button ${planAttrs} data-act="plan"><span class="plan-r"><span>License</span><b>Active</b></span><small>Every restore stays free</small></button>`
    : `<button ${planAttrs} data-act="plan"><span class="plan-r"><span>Free plan</span><b>${esc(`${used} of ${plural(lic.freeProjectLimit, "project")}`)}</b></span><span class="bar" aria-hidden="true"><i style="width:${usage(used, lic.freeProjectLimit)}%"></i></span><small>See what a license adds</small></button>`;
  // History itself stays here; Ask, when a project has it on, sends titles and changes to the service its key is for, so
  // the rail says so. Until a key exists nothing can be sent, and the rail says that instead (dev#26).
  const askOn = st.askProvider !== undefined && st.projects.some((x) => askConsentValid(x.features, st.askProvider ?? null));
  const askWords = !askOn || st.askProvider === undefined ? "" : st.askProvider === null ? " · Ask is on, but needs a key" : ` · Ask sends titles and changes to ${st.askProvider === "gemini" ? "Gemini" : "Claude"}`;
  // A modal panel is a div: an aside may be a region, never a dialog.
  const tag = mobile ? "div" : "aside";
  return `<${tag} class="side${mobile ? " mobile-side" : ""}" ${mobile ? 'id="mobile-navigation" role="dialog" aria-modal="true" aria-label="Navigation"' : 'aria-label="Navigation"'}>
    <div class="brand">${buddy()}<span>Time Machine</span>${mobile ? '<button class="btn quiet nav-close" data-act="nav-close" aria-label="Close navigation">Close</button>' : ""}</div>
    <button class="search" data-act="palette"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M11 11l3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg><span>Jump to…</span><kbd class="kc">${esc(keys("Mod+K"))}</kbd></button>
    ${st.projects.length ? `<button class="it nav-it${st.screen === "overview" ? " on" : ""}" data-act="overview"${st.screen === "overview" ? ' aria-current="page"' : ""}>${navIcon("overview")}<span class="nm">Overview</span></button>` : ""}
    <div class="group">Protected</div>
    ${items || '<div class="side-empty">No folders yet. Protect one below.</div>'}
    <button class="it add${st.screen === "onboarding" ? " on" : ""}" data-act="add"${addFull() ? ` title="${esc(ADD_FULL)}"` : ""}><span class="plus" aria-hidden="true">+</span>${addFull() ? `<span class="nm"><span>Protect a folder</span><small>${esc(ADD_FULL)}</small></span>` : '<span class="nm">Protect a folder</span>'}<kbd>${keys("Mod+N")}</kbd></button>
    <button class="it nav-it${st.screen === "sources" ? " on" : ""}" data-act="sources"${st.screen === "sources" ? ' aria-current="page"' : ""}>${navIcon("sources")}<span class="nm">Sources</span></button>
    <button class="group group-b${st.screen === "agents" ? " on" : ""}" data-act="agents">Agents</button>
    ${st.agents ? agent(claude) : `<div class="it ag">${agentMark("Claude Code")}<span class="nm">Claude Code<small>Reading connection…</small></span></div>`}
    ${planned}
    <div class="side-foot">
      <div class="stored">${esc(`History is saved on ${device()}${askWords}`)}</div>
      ${plan}
      <button class="it${st.screen === "storage" ? " on" : ""}" data-act="storage"><span class="nm">Storage</span>${total !== undefined ? `<small class="ct">${esc(bytes(total))}</small>` : ""}</button>
      <button class="it${st.screen === "settings" ? " on" : ""}" data-act="settings"><span class="nm">Settings</span><kbd>${keys("Mod+,")}</kbd></button>
    </div>
  </${tag}>`;
}

/** From this width the rail sits beside the page; below it, the rail is the navigation sheet (styles.css, 860 px). */
const RAIL_MIN = 861;

function navigation(): string {
  return st.navOpen ? `<div class="scrim nav-scrim ${once("scrim:nav")}" data-leave="navigation">${sidebar(true)}</div>` : "";
}

/** The link to tm ui: while it connects the strip is sky and says so; once it drops, it says why and offers Reconnect. */
function connectionBanner(): string {
  const c = st.connection;
  if (!c || c.state === "connected") return "";
  // The title already says "Disconnected"; the bridge's sentence starts by saying it again, so that clause is dropped here.
  const said = (c.message ?? "Keep tm ui running in your terminal. Live history and actions need that connection.").replace(/^Disconnected from the local app\.\s*/, "");
  return `<div class="connection-banner" data-state="${c.state}" role="status">${buddy("conn-buddy")}<div><b>${c.state === "connecting" ? "Connecting to your local app" : "Disconnected from your local app"}</b><p>${esc(said)}</p></div><button class="btn" data-act="reconnect">Reconnect</button></div>`;
}

/**
 * First run, in the shape of Unvibe's Today: the buddy says hello beside the display line and the voice line, then the two ways
 * in as cards (your own project in ink, the demo outlined), how it works and what to know. Every sentence is one this page, the
 * add steps or the demo sheet already said.
 */
function welcome(): string {
  const hour = new Date().getHours();
  const hello = hour >= 5 && hour < 12 ? "Good morning." : hour >= 12 && hour < 18 ? "Good afternoon." : "Good evening.";
  const arrow = '<svg class="wl-arrow" viewBox="0 0 20 20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h11M11 5.5 15.5 10 11 14.5"/></svg>';
  const play = '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M7.2 5.6v8.8l7-4.4z" fill="currentColor"/></svg>';
  // Agents, tests and branches only once a code project is here; until then, words true for any folder (writer#24).
  const words = welcomeWords(st.projects.some((p) => p.purpose === "code"), device());
  return `<div class="welcome wl"><div class="wl-in">
    <header class="wl-hi">${buddy("hero")}<p class="wl-hello voice">${hello}</p><div class="wl-t"><h1>Let’s keep your work safe.</h1><p class="voice welcome-v">Get back the version that worked.</p></div></header>
    <section class="wl-go" aria-labelledby="wl-go-h"><div><h2 id="wl-go-h">Something of your own</h2><p>Code, documents, research or an agent’s workspace. Any folder works. Git is not needed.</p></div><button class="btn big wl-add" data-act="add">Protect a folder<kbd>${keys("Mod+N")}</kbd></button></section>
    <button class="wl-demo" data-act="demo"><span class="wl-demo-ic">${play}</span><span class="wl-demo-t"><b>Try the demo</b><span>Marigold Tips in a temporary folder, broken on purpose. Your projects are not touched.</span></span>${arrow}</button>
    <div class="wl-cols">
      <section aria-labelledby="wl-how-h"><h2 id="wl-how-h">How it works</h2><ol class="wl-steps">
        ${words.how.map(([t, line]) => `<li><b>${esc(t)}</b><span>${esc(line)}</span></li>`).join("")}</ol></section>
      <section aria-labelledby="wl-know-h"><h2 id="wl-know-h">Good to know</h2><ul class="wl-know">
        ${words.know.map((line) => `<li>${esc(line)}</li>`).join("")}</ul></section>
    </div>
    <p class="foot local-note">Local browser app · Keep <span class="mono">tm ui</span> running in your terminal.</p>
  </div></div>`;
}

/** Who made a save point, as shown on its author chip. */
function authorOf(c: TimelineEntry): string {
  return c.agent?.name ?? triggerLabel(c.trigger);
}

/** An author chip carries a mark only for an agent (its supplied official mark, or its initials); You, Demo and Before rewind are words. */
function authorChip(name: string): string {
  const agent = /claude|codex|openai|gemini|cursor|agent/i.test(name);
  return `<span class="chip${agent ? "" : " plain"}">${agent ? agentMark(name) : ""}${esc(name)}</span>`;
}

/** Runs of save points made by the same agent, as recorded by the engine. Never guessed from the trigger. */
function sessions(pts: TimelineEntry[]): { name: string; from: number; to: number }[] {
  const out: { name: string; from: number; to: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const name = pts[i]?.agent?.name;
    if (!name) continue;
    let j = i;
    while (j + 1 < pts.length && pts[j + 1]?.agent?.name === name) j++;
    out.push({ name, from: i, to: j });
    i = j;
  }
  return out;
}

/** A short line on what the check found, from recorded evidence only. */
function checkSummary(c: TimelineEntry): string {
  const vr = st.verifyResults.get(c.id);
  const same = vr && vr.verdict === c.verdict ? vr : null;
  switch (c.verdict) {
    case "PASS": {
      const n = st.passes.get(c.id) ?? 0;
      const count = n > 1 ? `Passed its check ${n} times in a row` : "check passed";
      return same ? `${count}${n > 1 ? ", the last" : ""} in ${seconds(same.durationMs)}` : count;
    }
    case "FAIL":
      return same?.exitCode != null ? `check failed, exit code ${same.exitCode}` : "check failed";
    case "INCOMPLETE":
      return "check did not finish";
    case "BLOCKED":
      return "check needs something";
    case "ERROR":
      return "check crashed";
    default:
      return "";
  }
}

/** What Time Machine ran for this save point. Evidence, kept apart from anything an agent claimed. */
function weRan(c: TimelineEntry): string {
  const vr = st.verifyResults.get(c.id);
  const same = vr && vr.verdict === c.verdict ? vr : null;
  const what = same ? `${same.command} in a copy` : `Your check, in a copy on ${device()}`;
  const result: { [V in Verdict]: string } = { PASS: "Passed", FAIL: "Failed", INCOMPLETE: "It did not finish", BLOCKED: "It could not start: it needs something", ERROR: "The check itself crashed" };
  return c.verdict ? `${what}. ${result[c.verdict]}${same ? `, ${seconds(same.durationMs)}` : ""}.` : "Nothing yet. This save point is not checked.";
}

/** An agent's own claim is never evidence. The hook does not record the reply yet, and the box says so. */
function provenance(c: TimelineEntry): string {
  return c.agent
    ? `<div class="said two"><div><b>Agent said</b><span class="nr">Not recorded. Recording replies is planned.</span></div><div><b>We ran</b><span>${esc(weRan(c))}</span></div></div>`
    : `<div class="said"><b>We ran</b><span>${esc(weRan(c))}</span></div>`;
}

/**
 * Whether a project checks its save points (hasCheck): whether a check command is set now, read from the agents list
 * (each project's current check). Until that is read, a project that has been checked counts as checking. Without a
 * command it just saves versions: the app says when it saved, never "Not checked yet", and offers no Check it works.
 * `pts` defaults to what is known: the open project's timeline, else the one Overview read.
 */
function checksOn(p: ProjectEntry | null, pts?: readonly DigestPoint[]): boolean {
  if (!p) return true;
  const row = st.agents?.find((a) => a.projectId === p.id);
  if (row && row.claudeCode !== "unavailable") return hasCheck(row.check !== null, false);
  const read = st.overview.get(p.id);
  const known = pts ?? (p.id === st.projectId ? points() : Array.isArray(read) ? read : []);
  const s = st.statuses.get(p.id);
  const ever = known.some((c) => c.verdict !== null) || (s?.newest?.verdict ?? null) !== null || !!s?.lastWorking;
  return hasCheck(null, ever);
}

/** A journal row: the time, then the title, then who made it, its verdict and what changed, then one quiet action.
 *  `was` is the checked save point before it, when its verdict was different. `lastGood` marks the way back. */
function journalEntry(c: TimelineEntry, lastGood: boolean, was: TimelineEntry | undefined): string {
  const author = authorOf(c);
  const changed = st.changes.get(c.id);
  const summary = checkSummary(c);
  const shown = title(c, author);
  // What changed, by kind and folder ("309 files deleted"), else the paths read for the row titles. A title that already
  // names them is not said twice.
  const files = changeWords(c) || changedLine(changed);
  const what = files && files !== shown ? `<span class="e-files" title="${esc((changed ?? []).slice(0, 12).join(", "))}">${FILE_ICON}<span>${esc(files)}</span></span>` : "";
  const facts = summary ? summary[0]!.toUpperCase() + summary.slice(1) : "";
  // The save point under the History playhead is tinted, so the ruler and the record read as one.
  const picked = !st.drawer && c.id === st.selected && c.id !== points().at(-1)?.id;
  const running = checkRunning();
  const checking = c.id === running || (running === "new" && c.id === points().at(-1)?.id);
  const cls = ["entry", lastGood ? "lw" : "", st.drawer && c.id === st.selected ? "on" : "", picked ? "sel" : "", st.lit === c.id ? "lit" : "", checking ? "checking" : ""].filter(Boolean).join(" ");
  const busy = st.busy ? "disabled" : "";
  const p = project();
  const kind = p?.kind ?? "git";
  const damaged = damagedReason(c);
  // One action per row, in words: bring back the way out, check what is not checked, open the rest. A folder that is gone
  // or a damaged save point has nothing to run: the row only opens.
  const act = damaged || folderMissing(p) ? '<span class="go" aria-hidden="true">Open</span>'
    : lastGood ? `<button class="go" data-act="rewind-to" data-id="${esc(c.id)}" aria-label="${esc(goBackLabel(c, points()))}" ${busy}>Bring back</button>`
    : c.verdict === null && checksOn(p) ? `<button class="go${checking ? " running" : ""}" data-act="verify-one" data-id="${esc(c.id)}" aria-label="${esc(`Check ${versionPhrase(c, points())}`)}" ${busy}>Check</button>`
      : '<span class="go" aria-hidden="true">Open</span>';
  // While its check runs, the row says Checking where its verdict goes; the verdict lands there when the check ends.
  // A project with no check has no verdict to show, so its rows carry none. A damaged save point says so, never "crashed".
  const verdict = damaged ? `<span class="vb v-damaged" title="${esc(damaged)}"><i class="g" aria-hidden="true"></i>Damaged</span>`
    : checking ? '<span class="vb v-checking"><i class="g" aria-hidden="true"></i>Checking</span>' : c.verdict === null && !checksOn(p) ? "" : badge(c.verdict);
  const all = points();
  const before = all[all.findIndex((x) => x.id === c.id) - 1];
  const shift = branchShift(c, before, kind);
  return `<article class="${cls}${damaged ? " damaged" : ""}" id="e-${esc(c.id)}" data-act="open" data-id="${esc(c.id)}" data-vid="${esc(c.id)}" data-v="${damaged ? "damaged" : verdictKey(c.verdict)}">
    <div class="when">${timeParts(ptClock(c))}</div>
    <div class="body">
      <h3><button class="e-t" data-act="open" data-id="${esc(c.id)}">${esc(shown)}</button>${st.notes.get(c.id)?.pinned ? `<span class="e-pin">${pinIcon(true)}<span class="sr-only">Pinned</span></span>` : ""}${lastGood ? '<span class="wayback">Last version that works</span>' : ""}</h3>
      <div class="meta">${authorChip(author)}${verdict}${shift ? `<span class="chip br-chip">${esc(shift)}</span>` : ""}${damaged ? (damaged === shown ? "" : `<span class="dmg">${esc(damaged)}</span>`) : what}${was ? `<span class="was">${keepTimes(esc(`Before it: ${verdictWord(was.verdict)}, ${ptAt(was)}`))}</span>` : ""}${facts && !damaged ? `<span>${esc(facts)}</span>` : ""}<span class="chip-slot">${st.deployChips.get(c.id) ?? ""}</span>${st.settings.showGitDetails ? `<span class="mono">${esc(kind === "folder" ? c.id : `${c.id} · ${gitLine(c, kind)}`)}</span>` : ""}</div>
    </div>${act}</article>`;
}

/** An automatic save no one checked: before a prompt or a risky command. Runs of them fold. */
function isAutoSave(c: TimelineEntry | undefined): boolean {
  return !!c && c.verdict === null && (c.trigger === "claude-code:prompt" || c.trigger === "claude-code:pre-bash");
}

/** One frame of the ruler's flag: a save point's time and verdict, plus its title for the one under the playhead. */
function flagFrame(c: TimelineEntry | undefined, on: boolean): string {
  if (!c) return '<span class="rf empty"></span>';
  const verdict = on ? badge(c.verdict) : `<span class="rf-v">${glyph(c.verdict)}<span>${esc(verdictWord(c.verdict))}</span></span>`;
  return `<span class="rf${on ? " on" : ""}"><b class="rf-t">${esc(ptClock(c))}</b>${verdict}${on ? `<span class="rf-n">${esc(title(c))}</span>` : ""}</span>`;
}

/** The History ruler draws at most this many save points. */
const RULER_MAX = 60;
let rulerWin = { project: "", start: 0, follow: true };
/**
 * The save points the ruler draws: the newest 60, moved just enough to keep the selected one in view, so the keys,
 * the drag and what a screen reader hears always name the same save point. It stays put while you drag inside it.
 */
function rulerWindow(all: TimelineEntry[]): TimelineEntry[] {
  const max = Math.max(0, all.length - RULER_MAX);
  if (rulerWin.project !== (st.projectId ?? "")) rulerWin = { project: st.projectId ?? "", start: max, follow: true };
  let start = rulerWin.follow ? max : Math.min(rulerWin.start, max);
  const si = all.findIndex((c) => c.id === st.selected);
  if (si >= 0 && si < start) start = si;
  else if (si >= start + RULER_MAX) start = si - RULER_MAX + 1;
  rulerWin = { project: rulerWin.project, start, follow: start === max };
  return all.slice(start, start + RULER_MAX);
}

/**
 * The ruler on the project page, in its well: past on the left, now on the right, agent sessions above, each
 * save point a bead in its verdict's shape. It is one control. Press anywhere along it and drag, or focus it and
 * use the arrow keys: the playhead moves to each save point and a flag above it reads the verdict live, with the
 * save points either side. The last version that works wears a sky halo and its own flag.
 */
function homeRuler(all: TimelineEntry[]): string {
  const pts = rulerWindow(all);
  const start = pts[0] ? all.indexOf(pts[0]) : 0;
  const n = pts.length;
  const sel = pts.findIndex((c) => c.id === st.selected);
  const cur = sel < 0 ? n - 1 : sel;
  const c = pts[cur];
  const lw = lastWorking();
  const wayBack = lw && pts.at(-1)?.verdict !== "PASS" ? lw : null;
  const clips = sessions(pts).map((s) => `<span class="clip" style="left:${homeX(s.from, n) - 1}%;width:${homeX(s.to, n) - homeX(s.from, n) + 2}%"><span>${esc(s.name)}</span></span>`).join("");
  const running = checkRunning();
  const newestId = points().at(-1)?.id;
  const ticks = pts
    .map((p, i) => `<span class="rt-tk b-${verdictKey(p.verdict)}${i > cur ? " after" : ""}${i === cur ? " on" : ""}${p === wayBack ? " lw" : ""}${coachStep() === 1 && p.id === st.coach?.target ? " aim" : ""}${p.id === running || (running === "new" && p.id === newestId) ? " checking" : ""}${p.id === newestId ? " nowtk" : ""}" data-vid="${esc(p.id)}" data-v="${verdictKey(p.verdict)}" data-carry="tk:${esc(p.id)}" style="--x:${homeX(i, n)}" title="${esc(`${ptWhen(p)} · ${title(p)} · ${verdictWord(p.verdict)}`)}">${vIcon(p.verdict)}</span>`)
    .join("");
  // Labels for Now, the last working, the selected and the first save point, in that order of importance.
  // fitRulerLabels measures them after the draw: a less important one hides, the last working one moves.
  const lwi = lw ? pts.indexOf(lw) : -1;
  const marks = [...new Set([n - 1, lwi, cur, 0])].filter((i) => i >= 0);
  const shift = (i: number): number => (n === 1 ? -50 : i === 0 ? -15 : i === n - 1 ? -85 : -50);
  const labels = marks.map((i) => {
    const p = pts[i];
    const t = esc(p ? ptClock(p) : "");
    const now = i === n - 1 && p?.id === points().at(-1)?.id;
    return `<span class="rlab${i === cur ? " on" : ""}${now ? " now" : ""}" data-i="${i}"${i === lwi ? " data-lw" : ""} style="left:${homeX(i, n)}%;transform:translateX(${shift(i)}%)">${now ? `Now<span class="rl-t"> ${t}</span>` : t}</span>`;
  }).join("");
  const wbi = wayBack ? pts.indexOf(wayBack) : -1;
  // Placed by transform from --x, like the playhead, so when the last version that works changes the flag glides to it.
  const lwFlag = wbi >= 0 ? `<span class="lwflag" data-carry="lwf" style="--x:${homeX(wbi, n)};--s:${Math.max(-50, Math.min(-12, shift(wbi)))}%">Last version that works</span>` : "";
  const flag = `<div class="rflag" data-carry="flag" aria-hidden="true" style="--x:${homeX(cur, n)}">${flagFrame(pts[cur - 1], false)}${flagFrame(c, true)}${flagFrame(pts[cur + 1], false)}</div>`;
  const today = pts.every((p) => dayLabel(p.createdAt) === "Today");
  const u = unitWords(project()?.purpose ?? "code");
  const many = u.many.charAt(0).toUpperCase() + u.many.slice(1);
  const head = all.length <= n ? (today ? `Today’s ${u.many}` : many) : start + n === all.length ? `The last ${n} ${u.many}` : `${many} ${start + 1} to ${start + n} of ${all.length}`;
  const density = n <= 14 ? "d1" : n <= 28 ? "d2" : "d3";
  // Every shape the ruler draws is named; a project with no check has one, Saved.
  const checks = checksOn(project());
  const legend = legendItems(checks, pts.map((p) => p.verdict)).map((x) => `<span><span class="lg b-${verdictKey(x.v)}">${vIcon(x.v)}</span>${esc(x.word)}</span>`).join("");
  return `<div class="rwell">
    <div class="rw-h"><b>${esc(head)}</b><span class="rw-hint">Drag along it, or use ← →</span><span class="legend" aria-hidden="true">${legend}</span></div>
    <div class="hruler ${density}${historyScrub ? " scrubbing" : ""}${rulerByPointer ? " by-pointer" : ""}" role="slider" tabindex="0" aria-label="Save points, oldest on the left. Use the arrow keys, or drag along it." aria-valuemin="1" aria-valuemax="${n}" aria-valuenow="${cur + 1}" aria-valuetext="${esc(c ? `${ptWhen(c)}, ${title(c)}, ${c.verdict === null && !checks ? "Saved" : verdictWord(c.verdict)}` : "")}">
    <div class="lane">${clips}</div><div class="base"></div>${ticks}
    <span class="ph${cur === n - 1 ? " now" : ""}" data-carry="hph" style="--x:${homeX(cur, n)}"></span>${labels}${lwFlag}${flag}</div></div>`;
}

/**
 * Setup on History, until the project has its first verdict and Claude Code is connected or the strip
 * was hidden. The demo project has no setup to do, so it never shows one.
 */
function setupView(p: ProjectEntry, pts: TimelineEntry[]): string {
  if (p.demo || !pts.length || !checksOn(p, pts)) return "";
  const row = st.agents?.find((a) => a.projectId === p.id);
  // Only a check that ran and gave Works or Broken ticks "Check it works"; Couldn't check and the others do not.
  const strip = setupStrip({ verdict: pts.some((x) => x.verdict === "PASS" || x.verdict === "FAIL"), connected: st.agents ? row?.claudeCode === "connected" : null, hidden: st.settings.setupHidden.includes(p.id) });
  if (!strip) return "";
  const done = '<span class="n" aria-hidden="true">✓</span><span class="sr-only">Done: </span>';
  const num = (n: number): string => `<span class="n" aria-hidden="true">${n}</span>`;
  // The same buttons as the project's row on Agents.
  const connect =
    strip.connect === "done" || !row ? ""
      : row.claudeCode === "needs-approval" && row.check ? `<button class="btn" data-act="approve-check" data-id="${p.id}">Approve this check</button>`
        : row.claudeCode === "not-connected" || row.claudeCode === "partial" ? `<button class="btn" data-act="hook" data-id="${p.id}">${row.claudeCode === "partial" ? "Add the missing lines" : "Connect"}</button>`
          : '<button class="btn" data-act="agents">Open Agents</button>';
  const cmd = row?.check ? `<code class="mono">${esc(row.check)}</code>` : "your check";
  const card = (cls: string, mark: string, title: string, body: string, extra = ""): string =>
    `<li class="s3 ${cls}"${cls === "now" ? ' aria-current="step"' : ""}><b>${mark}${title}</b><span>${body}</span>${extra}</li>`;
  return `<section class="setup" aria-labelledby="setup-h"><div class="setup-h"><h2 id="setup-h">${esc(strip.check === "done" ? `Set up ${p.name}` : `Finish setting up ${p.name}`)}</h2>${strip.canHide ? `<button class="btn link setup-hide" data-act="setup-hide" data-id="${p.id}">Hide</button>` : ""}</div><ol class="steps3">
    ${card("done", done, "Add the project", "Your first save point is made.")}
    ${card(strip.check === "done" ? "done" : "now", strip.check === "done" ? done : num(2), "Check it works", `Runs ${cmd} in a copy, never in your folder.`)}
    ${card(strip.connect === "done" ? "done" : strip.connect === "current" ? "now" : "", strip.connect === "done" ? done : num(3), "Connect Claude Code (optional)", "Saves before each prompt.", connect)}
  </ol></section>`;
}

/** The project page: the status in one sentence and the way out in the voice, one main action, the ruler, the journal, then what does not come back. */
function history(): string {
  const p = project();
  if (!p) return welcome();
  // While History reads, the page shows its own shape in quiet blocks, so the record lands in place instead of jumping in.
  if (!st.timeline && !st.timelineError) {
    const row = '<div class="sk-row"><i class="sk sk-t"></i><i class="sk-g"></i><span><i class="sk sk-l"></i><i class="sk sk-m"></i></span></div>';
    // On a phone the placeholder page is taller than the window and holds no control, so the scroller itself takes focus.
    return `<div class="page proj" tabindex="0" role="region" aria-label="${esc(`Reading ${p.name}`)}"><div class="doc" role="status">
      <section class="hero"><div class="eyebrow hero-e"><span>${esc(p.name)}</span></div><h1 class="hero-h sk-head"><span class="sr-only">Reading ${esc(p.name)}</span><span aria-hidden="true">&nbsp;</span></h1>
        <p class="hero-p">Loading saved versions from your local history.</p><div class="hero-acts" aria-hidden="true"><i class="sk sk-btn"></i></div>
        <div class="honest sk-honest" aria-hidden="true"><i class="sk sk-dt"></i><i class="sk sk-dd"></i><i class="sk sk-dd"></i></div></section>
      <div class="sk-ruler" aria-hidden="true"></div><div aria-hidden="true">${row.repeat(3)}</div>
    </div></div>`;
  }
  if (st.timelineError && !st.timeline) {
    // The engine names the folder's full path (engine.ts); the page says it in plain words, and the path is a Git detail.
    // A folder that is gone gets its cause and the ways out instead of a second "can't" under the heading.
    const moved = st.timelineError.includes(`We can't find ${p.name} at ${p.path}.`) || st.statuses.get(p.id)?.problemKind === "missing";
    const cause = moved
      ? `Can’t find ${p.name} at ${p.path}. If it moved, choose where it is now. Its history is kept outside the folder.`
      : st.timelineError.replaceAll(` at ${p.path}`, "").replaceAll("'", "’");
    const where = !moved && st.settings.showGitDetails && st.timelineError.includes(` at ${p.path}`) ? `<p class="mono fail-path sel-text">${esc(p.path)}</p>` : "";
    const ways = `${moved ? '<button class="btn dark" data-act="relink">It moved…</button><button class="btn" data-act="reload">Try again</button>' : '<button class="btn dark" data-act="reload">Try again</button>'}<button class="btn ghost" data-act="remove" data-id="${p.id}">Remove from the app</button>`;
    return `<div class="fail-page"><div class="fail-in">${buddy("big")}<h1>${esc(moved ? `Can’t find ${p.name}` : `We can’t read ${p.name}`)}</h1>${failCard(cause, ways)}${where}</div></div>`;
  }
  const gone = folderMissing(p);
  const pts = points();
  const newest = pts.at(-1);
  const checked = newest ? st.verifyResults.get(newest.id) : undefined;
  const s = projectStatus(pts, checked && checked.verdict === newest?.verdict ? checked.at : null, checksOn(p, pts));
  const lw = lastWorking();
  const working = st.agents?.some((a) => a.projectId === p.id && a.working);
  const command = checked?.command ?? st.agents?.find((a) => a.projectId === p.id)?.check ?? null;
  const facts = (rows: [string, string[]][]): string =>
    `<dl class="honest">${rows.filter(([, v]) => v.length).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${keepTimes(v.map(esc).join(" · "))}</dd>`).join("")}</dl>`;
  const honest =
    s.v === "FAIL" && lw ? facts([["What does not come back", [...notSavedLines(lw), `Changes after ${ptAt(lw)}, unless you redo them. They stay saved in History.`]]])
      : newest ? facts([["Saved", savedLines(newest)], ["Not saved", notSavedLines(newest)]]) : "";
  // A folder that is gone shows its history read only: the notice and its two ways out take the place of the main action.
  const goneCard = gone
    ? `<div class="note bad gone-card" role="status"><p>${esc(`Can’t find ${p.name} at ${p.path}. If it moved, choose it; if it is gone, bring a version back as a copy somewhere else.`)}</p>
      <div class="row-btns"><button class="btn dark" data-act="relink">It moved…</button>${newest ? `<button class="btn" data-act="copy-elsewhere" data-id="${esc(st.selected ?? newest.id)}">Bring back a copy…</button>` : ""}</div>
      ${st.copyMade?.projectId === p.id ? `<p class="gone-done">${esc(`A copy is ready at ${st.copyMade.dir}.`)} <button class="btn link" data-act="reveal-dir" data-path="${esc(st.copyMade.dir)}">Show in Finder</button></p>` : ""}</div>`
    : "";
  // Git words (the branch) only for a project that is a Git repository; a plain folder's history lives in the store.
  const branch = p.kind !== "folder" && newest?.branch ? `${esc(newest.branch)} · ` : "";
  const header = `<section class="hero" data-vid="hero" data-v="${esc(s.head)}">
    <div class="hero-e"><span class="dot v-${verdictKey(s.v)}" aria-hidden="true"></span><span>${esc(p.name)}</span>${command ? `<span class="hero-cmd">checks with <code class="mono">${esc(command)}</code></span>` : ""}${st.settings.showGitDetails ? `<span class="path">${branch}${esc(p.path)}</span>` : ""}</div>
    <h1 class="hero-h"><span class="hh">${keepTimes(esc(s.head))}</span></h1>${s.voice ? `<p class="hero-when">${keepTimes(esc(s.voice))}</p>` : ""}
    <p class="hero-p">${keepTimes(esc(s.body))}${working ? " Claude Code is working now. We check again when its turn ends." : ""}</p>
    ${gone ? goneCard : `<div class="hero-acts">${statusButton(s.primary, true)}${s.secondary ? statusButton(s.secondary, false) : ""}</div>`}
  </section>`;
  const u = st.undo && st.undo.projectId === p.id && st.screen === "history" ? st.undo : null;
  const undoBar = u
    ? `<div class="undo-card">${glyph(u.result.lastVerdict)}<p>You went back to ${esc(pointName(u.result.id))}. ${u.result.copyOnly ? "It is in a copy next to your folder" : `It is on a new branch${st.settings.showGitDetails ? `, <span class="mono">${esc(u.result.branch)}</span>,` : ""} and in a copy`}. Your folder was not touched.</p><div class="row-btns">${undoButton("")}<button class="btn quiet" data-act="undo-dismiss">Keep it</button></div></div>`
    : "";
  if (!pts.length) {
    return `<div class="page proj"><div class="doc">${header}${gone ? "" : `<div class="empty-dir journal-empty"><p>${esc(checksOn(p) ? "Save now to make your first save point, then check that it works in a copy." : "Save now to keep the first version of this folder.")}</p><button class="btn" data-act="save">Save now</button></div>`}</div></div>`;
  }
  // The journal, newest first, one white card per day.
  const days: { day: string; date: string; rows: string[] }[] = [];
  const perDay = new Map<string, number>();
  // A save point whose record can't be read has no time; it gets its own card at the end, not a day of its own mid-list.
  const readable = pts.filter((c) => !Number.isNaN(new Date(c.createdAt).getTime()));
  const pinnedOnly = st.journalFilter === "pinned";
  const unreadable = pinnedOnly ? [] : pts.filter((c) => !readable.includes(c));
  const shown = filtered(readable, st.notes, st.journalFilter);
  for (const c of shown) perDay.set(dayLabel(c.createdAt), (perDay.get(dayLabel(c.createdAt)) ?? 0) + 1);
  // Newest first by time, not by id: a clock change or an imported store never splits one date into two groups (cli#8).
  const newestFirst = newestByTime(shown);
  const was = verdictWas(readable);
  for (let i = 0; i < newestFirst.length; i++) {
    const c = newestFirst[i];
    if (!c) continue;
    const day = dayLabel(c.createdAt);
    if (days.at(-1)?.day !== day) days.push({ day, date: new Date(c.createdAt).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }), rows: [] });
    const rows = days.at(-1)!.rows;
    // Two or more automatic saves in a row fold into one line, unless one of them is open.
    let j = i;
    while (isAutoSave(newestFirst[j]) && dayLabel(newestFirst[j]?.createdAt ?? "") === day) j++;
    const run = newestFirst.slice(i, j);
    if (!pinnedOnly && run.length >= 2 && !st.unfolded.has(c.id) && !run.some((x) => x.id === st.selected && st.drawer)) {
      const oldest = run.at(-1);
      rows.push(`<button class="fold" data-act="unfold" data-id="${esc(c.id)}"><span class="when"></span><span class="body">${esc(`${plural(run.length, "automatic save")} · ${oldest ? ptTime(oldest) : ""} to ${ptTime(c)}`)}</span><span class="go">Show</span></button>`);
      i = j - 1;
      continue;
    }
    rows.push(journalEntry(c, c.id === lw?.id && newest?.verdict !== "PASS", was.get(c.id)));
    const older = newestFirst[i + 1];
    // Only say "broke here" when two neighbouring checks prove it.
    if (!pinnedOnly && older && c.verdict === "FAIL" && older.verdict === "PASS") rows.push(`<div class="broke-rule"><span>${keepTimes(esc(`Broke here: ${ptAt(older)} works, ${ptAt(c)} is broken`))}</span></div>`);
  }
  if (unreadable.length) {
    days.push({ day: "Damaged", date: "", rows: [...unreadable].reverse().map((c) => journalEntry(c, false, undefined)) });
    perDay.set("Damaged", unreadable.length);
  }
  // Each day's header names it ("Today", "Monday", "14 Oct"), then its full date and how many it holds; it sticks to the top while its rows scroll.
  const journal = days.map((d) => `<div class="day"><h2>${esc(d.day)}</h2><span>${esc(d.date ? `${d.date} · ` : "")}${esc(unitCount(p.purpose, perDay.get(d.day) ?? 0))}</span></div><div class="list">${d.rows.join("")}</div>`).join("");
  const pinnedCount = readable.filter((c) => st.notes.get(c.id)?.pinned).length;
  return `<div class="page proj"><div class="doc">${header}${undoBar}${coachView()}
    ${homeRuler(pts)}
    ${setupView(p, pts)}
    <div class="jf-row">${filterBar(st.journalFilter, pinnedCount, p.purpose)}</div>
    <section class="journal" aria-label="History" id="list">${journal || (pinnedOnly ? noPinned(p.purpose) : "")}</section>
    ${honest ? `<section class="know" aria-labelledby="know-h">${buddy()}<div><h2 id="know-h">Good to know</h2>${honest}</div></section>` : ""}
    <div class="mount" data-mount="unlinked:${esc(p.id)}"></div>
  </div></div>`;
}

/** The demo's next step on this project, 1 to 3, or 0 when there is none. */
function coachStep(): number {
  const c = st.coach;
  if (!c || c.projectId !== st.projectId) return 0;
  if (c.went) return 3;
  return st.selected === c.target || st.rewind?.target === c.target ? 2 : 1;
}

/** The demo's three steps in plain words. The first names the save point to find by its time. */
function coachSteps(): string[] {
  const t = st.coach ? entry(st.coach.target) : null;
  return [t ? `Drag the ruler to ${ptAt(t)}, the last green dot` : "Drag the ruler to the last green dot", "Go back to it", "Undo it, or keep it"];
}

function coachView(): string {
  const step = coachStep();
  if (!step) return "";
  return `<section class="coach" aria-label="Demo">
    <div class="coach-h"><b>Bring back the version that works</b><button class="btn ghost" data-act="coach-hide">Hide</button></div>
    ${steps(step, coachSteps())}</section>`;
}

/**
 * A save point named the way people say it in a sentence: "the 8:16 PM version", or "the second save at 8:16:05 PM"
 * when it shares its second. `at` says just when ("8:16 PM"). Git details add the id. `sentenceStart` capitalises it.
 */
function pointName(id: string, form: "version" | "at" = "version"): string {
  const c = entry(id);
  if (!c) return id;
  const said = form === "at" ? ptAt(c) : versionPhrase(c, points());
  return st.settings.showGitDetails ? `${said} (${c.id})` : said;
}

/** A version named in a heading by its time alone ("the 8:16:05 PM version"); the line under it says which twin. Git details add the id. */
function headName(id: string): string {
  const c = entry(id);
  if (!c) return id;
  const said = versionTimePhrase(c, points());
  return st.settings.showGitDetails ? `${said} (${c.id})` : said;
}

/** A save point in a list or a mono field, where "#N" may tell twins apart. Git details add the id. */
function pointLabel(c: TimelineEntry): string {
  return st.settings.showGitDetails ? `${ptWhen(c)} (${c.id})` : ptWhen(c);
}

/** A project screen action from the status rule: the main one filled, the other a quiet link. Shortcuts sit inside, so they are learned by seeing them. */
function statusButton(b: StatusButton, primary: boolean): string {
  const data = `${b.id ? ` data-id="${esc(b.id)}"` : ""}${b.a ? ` data-a="${esc(b.a)}"` : ""}${b.b ? ` data-b="${esc(b.b)}"` : ""}`;
  const key = { save: "Mod+S", check: "Mod+Enter", "rewind-to": "Mod+Shift+R", rewind: "Mod+Shift+R", compare: "" }[b.act];
  // The main Check it works shows the check running in it (seen through the scrim) until the verdict lands. It checks the newest.
  const runningOn = checkRunning();
  const running = primary && b.act === "check" && (runningOn === "new" || runningOn === points().at(-1)?.id);
  return `<button class="btn ${primary ? "big dark" : "link"}${running ? " running" : ""}" data-act="${b.act}"${data}${b.title ? ` title="${esc(b.title)}"` : ""} ${st.busy ? "disabled" : ""}><span>${keepTimes(esc(b.label))}</span>${key ? `<kbd>${esc(keys(key))}</kbd>` : ""}</button>`;
}

/** One plain sentence on what a verdict means for this save point. Isolation names only with Git details. */
function verdictSentence(c: TimelineEntry): string {
  const how = st.settings.showGitDetails ? ` (basic isolation, ${c.isolation ?? "host"} mode)` : "";
  switch (c.verdict) {
    case "PASS":
      return `It passed its check in a copy on ${device()}${how}.`;
    case "FAIL":
      return `It failed its check in a copy on ${device()}${how}.`;
    case "INCOMPLETE":
      return "We couldn’t finish the check. We won’t call it working until we can.";
    case "BLOCKED":
      return "The check needs something before it can run.";
    case "ERROR":
      return "The check itself crashed. This doesn’t mean the project is broken.";
    default:
      return "Saved, but we don’t know yet if it works.";
  }
}

/**
 * What the check said, in its own words: the command, its exit code, the engine's reason, the end of what it printed
 * and where its log is kept. From a check that ran in this session, or the save point's newest sealed record; with
 * neither it says so. Never test counts: the engine reports how the check exited, not what its tests were.
 */
function checkWords(vr: VerdictRecord | null, v: Verdict | null, withReason = true): string {
  if (!v) return "";
  if (!vr) return `<div class="cw none"><b>What the check said</b><p>Check it again to see what it printed here.</p></div>`;
  // A check that never started (nothing set up) has no exit code and no time worth showing.
  const ran = vr.exitCode !== null || !!vr.log;
  // Said already by the sheet's card, with nothing else to add: no empty block.
  if (!withReason && !ran && !vr.command.trim()) return "";
  const p = project();
  if (vr.log && p && !st.logTails.has(vr.log)) void loadLogTail(p.id, vr);
  return `<section class="cw v-${verdictKey(v)}" aria-label="What the check said">
    <div class="cw-h"><b>What the check said</b>${ran && withReason ? `<span class="mono">${esc(seconds(vr.durationMs))}</span>` : ""}</div>
    ${checkBodyHtml(vr, ran, withReason)}
    ${vr.log ? tailHtml(vr.log, st.logTails.get(vr.log)) : ""}
    ${vr.log ? `<button class="btn link small" data-act="reveal" data-path="${esc(vr.log)}">Copy the log’s path</button>` : ""}
  </section>`;
}

/** Reads the end of one check run's log once, then redraws. Its lines are shown and copied only. */
async function loadLogTail(projectId: string, vr: VerdictRecord): Promise<void> {
  const log = vr.log;
  if (!log || st.logTails.has(log)) return;
  st.logTails.set(log, { state: "loading" });
  const r = await bridge.call({ method: "checkLogTail", projectId, id: vr.checkpoint });
  st.logTails.set(log, r.ok ? { state: "done", tail: r.data } : { state: "error" });
  render();
}

/** A save point and the verdict the timeline shows for it: a verdict that changes (a hook's check) is read again. */
const storedKey = (c: TimelineEntry): string => `${c.id} ${c.verdict}`;

/**
 * Reads a save point's newest sealed check record once per verdict, for a verdict this session did not check, then
 * redraws. Called directly on the bridge, so it is never recorded into the Inspector's records. Used only when it is this
 * save point's record with the verdict the timeline shows.
 */
async function loadStoredCheck(projectId: string, c: TimelineEntry): Promise<void> {
  const key = storedKey(c);
  st.storedChecks.set(key, null);
  const record = acceptRecord(await bridge.call({ method: "checkRecord", projectId, id: c.id }), c);
  if (!record || st.projectId !== projectId) return;
  st.storedChecks.set(key, record);
  render();
}

/**
 * The files a save point changed since the one before it, from the diffs History already read. Each file can be put
 * back into the live folder from this save point (writer#10; "I just want my file back"), unless the folder is gone or
 * the save point is damaged.
 */
function filesChanged(c: TimelineEntry): string {
  const changed = st.changes.get(c.id);
  if (!changed?.length) return "";
  const p = project();
  const canPut = !!p && !folderMissing(p) && !damagedReason(c) && !st.busy;
  const shown = changed.slice(0, 8);
  const words = changeWords(c);
  // A file this save point deleted is not in it: it comes back from the version before, which the button and confirm name.
  const removed = new Set(p ? changeKinds.get(`${p.id} ${c.id}`)?.removed ?? [] : []);
  const before = p ? changeFrom.get(`${p.id} ${c.id}`) : undefined;
  const put = (f: string): string => {
    if (!canPut) return "";
    if (removed.has(f)) return before ? `<button class="btn link small" data-act="put-back" data-id="${esc(before)}" data-path="${esc(f)}" aria-label="${esc(`Put ${f} back from the version before, where it still was`)}">Put it back</button>` : "";
    return `<button class="btn link small" data-act="put-back" data-id="${esc(c.id)}" data-path="${esc(f)}" aria-label="${esc(`Put ${f} back from this version`)}">Put it back</button>`;
  };
  const held = changed.filter((f) => !removed.has(f));
  const all = canPut && held.length > 1 && held.length <= 200 ? `<button class="btn link small" data-act="put-back" data-id="${esc(c.id)}" data-paths="${esc(JSON.stringify(held))}">${esc(`Put all ${held.length} back`)}</button>` : "";
  return `<div class="files"><b>${esc(words ? `Since the save point before: ${words}` : `${plural(changed.length, "file")} changed since the save point before`)}</b>${shown.map((f) => `<span class="file-row"><span>${esc(f)}</span>${put(f)}</span>`).join("")}${changed.length > shown.length ? `<span class="muted">${esc(`and ${changed.length - shown.length} more`)}</span>` : ""}${all}</div>`;
}

/** A restore's skip reason in the app's words: no store ids unless Git details are on, no settings paths. */
function restoreSkip(line: string): string {
  const short = shortSkip(line);
  return st.settings.showGitDetails ? short : short.replace(/: not in cp-\d+$/, ": not in that version").replace(/ \(cp-\d+ left it out\)/, "");
}

/** The paths a Put-back button carries, as JSON of strings; anything else is an empty list. */
function pathList(text: string): string[] {
  try {
    const v: unknown = JSON.parse(text);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
  } catch {
    return [];
  }
}

/** Puts the listed files back into the live folder from a save point, after a save of what is there now. */
async function putBack(id: string, paths: string[]): Promise<void> {
  const p = project();
  const c = entry(id);
  if (!p || !c || st.busy || !paths.length) return;
  st.busy = "Putting files back";
  render();
  try {
    const r = await api({ method: "restorePaths", projectId: p.id, id, paths });
    await loadTimeline();
    // The compare view is now out of date: the folder changed. It reads again.
    if (st.screen === "compare") await runDiff();
    const before = r.savedBefore ? entry(r.savedBefore) : null;
    const what = r.restored.length === 1 ? `${r.restored[0]} is back` : r.restored.length ? `${r.restored.length} files are back` : "Nothing needed to change";
    const saved = before ? ` What was there is saved as ${ptAt(before)}.` : "";
    const skipped = r.skipped.length ? ` Left alone: ${r.skipped.slice(0, 2).map(restoreSkip).join("; ")}${r.skipped.length > 2 ? ` and ${r.skipped.length - 2} more` : ""}.` : "";
    const note = r.note ? ` ${r.note}` : "";
    toast(`${what}.${saved}${skipped}${note}`);
  } catch (e) {
    toast(msg(e));
  }
  st.busy = null;
  render();
  // Focus goes back to that file's Put it back if it is still there, else to the page's heading, never to the page body.
  const back = paths.length === 1 ? `[data-act="put-back"][data-path="${CSS.escape(paths[0] ?? "")}"]` : "";
  refocus(back);
  // The status read redraws the page, and the heading refocus() may have used has no key to survive that, so again after it.
  void refreshStatuses().then(() => {
    render();
    refocus(back);
  });
}

/** The entry detail: the right column when the window is wide, a full sheet when it is narrow. Esc closes it. */
function detail(): string {
  const c = st.drawer ? entry(st.selected) : null;
  const p = project();
  if (!c || !p) return "";
  const busy = st.busy ? "disabled" : "";
  const author = authorOf(c);
  // Two save points in one second: the heading keeps the time, the line under it says which one (Design b3+4, ruling 4).
  const twin = sameSecondLine(c, points());
  const pts = points();
  const isNewest = pts.at(-1)?.id === c.id;
  const vr = st.verifyResults.get(c.id);
  const same = (vr && vr.verdict === c.verdict ? vr : null) ?? st.storedChecks.get(storedKey(c)) ?? null;
  if (!same && c.verdict !== null && !st.storedChecks.has(storedKey(c))) void loadStoredCheck(p.id, c);
  const lw = lastWorking();
  // One ink button: bring back a version that works, otherwise check it. A folder without a check brings back any version as a copy.
  // A folder that is gone brings a version back as a copy somewhere else; a damaged save point offers nothing to run.
  const checks = checksOn(p, pts);
  const gone = folderMissing(p);
  const damaged = damagedReason(c);
  const primary = damaged ? ""
    : gone ? `<button class="btn big dark" data-act="copy-elsewhere" data-id="${c.id}" ${busy}>Bring back a copy…</button>`
    : (c.verdict === "PASS" || !checks) && !isNewest
    ? `<button class="btn big dark" data-act="use" data-id="${c.id}" ${busy}>Bring back this version</button>`
    : checks ? `<button class="btn big dark${checkRunning() === c.id ? " running" : ""}" data-act="verify-one" data-id="${c.id}" ${busy}>${c.verdict ? "Check it again" : "Check it works"}</button>` : "";
  // A broken save point compares with the last version that works: that is what broke it. The newest compares with now too:
  // the folder may have changed since (writer#11). Nothing compares with a folder that is gone.
  const compare = damaged || gone ? ""
    : c.verdict === "FAIL" && lw && lw.id !== c.id
    ? `<button class="btn link" data-act="compare" data-a="${lw.id}" data-b="${c.id}">${esc(`What changed since ${ptAt(lw)}`)}</button>`
    : `<button class="btn link" data-act="compare" data-a="${c.id}" data-b="now">Compare with now</button>`;
  const opened = st.openResult && st.openResult.id === c.id
    ? `<div class="note">A copy of this version is ready. Your project folder was not touched.${st.openResult.missing.length ? ` Missing: ${esc(st.openResult.missing.join(", "))}.` : ""}<div class="row-btns" style="margin-top:8px"><button class="btn" data-act="reveal-dir" data-path="${esc(st.openResult.dir)}">${revealLabel()}</button></div><div class="mono muted sel-text" style="margin-top:6px">${esc(st.openResult.dir)}</div></div>`
    : "";
  // Git details name the person's own HEAD and branch; the snapshot commit is Time Machine's, so it is labelled as such.
  // A plain folder has no Git of its own: only its id, how it was made, and its check command.
  const git = st.settings.showGitDetails
    ? `<div class="git"><div><span class="k">id</span> ${esc(c.id)}</div>${p.kind === "folder" ? "" : `<div><span class="k">your code</span> ${esc(gitLine(c, p.kind))}</div><div><span class="k">snapshot</span> ${esc(short(c.commit))} (made by Time Machine)</div><div><span class="k">ref</span> refs/tm/${esc(c.id)}</div>`}<div><span class="k">trigger</span> ${esc(c.trigger)}</div>${checks ? `<div><span class="k">check</span> ${esc(tmCommand({ method: "verify", projectId: p.id, id: c.id }, p.path) ?? "")}</div>` : ""}</div>`
    : "";
  const dmgNote = damaged ? `<div class="note bad"><p>${esc(`This save point is damaged: ${damaged}`)}</p><p>Time Machine won’t check it or bring it back.</p></div>` : "";
  const tag = window.innerWidth < 1100 ? "div" : "aside";
  return `<${tag} class="rcol detail ${once("detail")}" ${tag === "div" ? 'role="dialog" aria-modal="true"' : 'role="region"'} aria-label="${esc(sentenceStart(savePointPhrase(c, points())))}">
    <header class="rc-top"><span class="eyebrow">${esc(`${dayLabel(c.createdAt)} · ${author}`)}</span>
      <button class="btn quiet" data-act="close-drawer" aria-label="Close">Close<kbd>Esc</kbd></button></header>
    <div class="rc-body">
      <h2 class="sp-h"><span class="sp-t">${esc(twin.time)}</span><span class="voice">${esc(title(c, author))}</span></h2>
      ${st.notes.get(c.id)?.title ? `<p class="sp-twin">${esc(`Saved as: ${madeTitle(c, author)}`)}</p>` : ""}
      ${twin.line ? `<p class="sp-twin">${esc(twin.line)}</p>` : ""}
      <div class="meta">${damaged ? '<span class="vb vb-lg v-damaged">Damaged</span>' : c.verdict === null && !checks ? "" : badge(c.verdict, "vb-lg")}${authorChip(author)}<span class="chip-slot">${st.deployChips.get(c.id) ?? ""}</span></div>
      ${damaged ? dmgNote : `<p class="sp-v">${esc(c.verdict === null && !checks ? "Kept on this computer, outside the folder. Compare it or bring it back as a copy." : verdictSentence(c))}</p>`}
      ${noteBlock(c.id, st.notes.get(c.id), st.noteDraft?.id === c.id ? st.noteDraft : { id: c.id, title: st.notes.get(c.id)?.title ?? "", note: st.notes.get(c.id)?.note ?? "" }, p.purpose, st.noteSaving)}
      ${damaged ? "" : checkWords(same ?? null, c.verdict)}
      ${c.agent ? provenance(c) : ""}
      ${damaged ? "" : `<div class="sp-acts">${primary}<div class="sp-links"><button class="btn link" data-act="try" data-id="${c.id}" ${busy}>Open a copy</button>${compare}</div></div>
      <p class="sp-note">A copy is a separate folder with this version in it. Your project is not touched.</p>`}
      ${opened}
      ${filesChanged(c)}
      <div class="sp-cols"><div class="kv"><span class="h">What’s saved</span>${li(savedLines(c), "Nothing listed")}</div>
        <div class="kv no"><span class="h">What’s not saved</span>${li(notSavedLines(c), "Nothing listed")}</div></div>
      ${git}
      <button class="btn link small" data-act="inspector">Open in Inspector<kbd>${esc(keys("Mod+I"))}</kbd></button>
    </div>
  </${tag}>`;
}

/** A ⋯ button with a small menu. One menu is open at a time. `cls` marks a menu that only phones show. */
function menuButton(key: string, label: string, items: string[], cls = ""): string {
  const open = st.menu === key;
  return `<span class="mn${cls ? ` ${cls}` : ""}"><button class="btn ghost mn-b" data-act="menu" data-v="${key}" aria-label="${esc(label)}" aria-expanded="${open}">⋯</button>${open ? `<div class="mn-l ${once(`menu:${key}`)}" role="group" aria-label="${esc(label)}">${items.join("")}</div>` : ""}</span>`;
}

/** Minutes and seconds since a check started, for the running sheet: "0:07". */
function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** What the running sheet says it is doing: saving first, then making the copy until the check prints its first line. */
function checkPhase(c: CheckState): string {
  if (c.phase === "saving") return "Saving where you are first.";
  return c.live?.length ? "Running your check." : "Making a copy of that version.";
}

/**
 * Check it works, as a sheet. While it runs: the buddy's screen blinks, the time runs in mono and Stop is there.
 * Then the verdict as a card: Works green, Broken red with what the check said, and Couldn't check, Needs something
 * and Check crashed each with their one plain sentence and one way to try again.
 */
function checkSheet(): string {
  const c = st.check;
  const p = project();
  if (!c || !p) return "";
  const done = c.phase === "done" || !!c.error;
  // A save point that failed its integrity check is damaged: the check never ran, and nothing about the check crashed.
  const broken = !!c.result && isDamagedReason(c.result.reason) && c.result.verdict === "ERROR";
  // The second row says what really happened: only Works and Broken mean the check ran to the end.
  const ran = c.result && !c.result.stopped && (c.result.verdict === "PASS" || c.result.verdict === "FAIL");
  const short: { [V in Verdict]: string } = { PASS: "", FAIL: "", INCOMPLETE: "Made a copy; the check didn’t finish", BLOCKED: "The check couldn’t start", ERROR: "Made a copy; the check itself crashed" };
  const second = broken ? "Didn’t check: this save point is damaged"
    : !c.result || ran ? "Made a copy and ran your check" : c.result.stopped ? "Made a copy; you stopped the check" : short[c.result.verdict];
  const rows = [
    // A damaged save point was never saved by this check: the row says it used one, never "Saved".
    { label: broken ? "Used the save point you chose" : c.skipped ? "Nothing changed since the last save point, so we used it" : "Saved the current version", state: c.phase === "saving" ? "run" : "ok", t: c.cp && st.settings.showGitDetails ? c.cp : "" },
    { label: second, state: c.phase === "checking" ? "run" : c.phase === "done" ? (ran ? "ok" : "no") : "wait", t: "" },
  ];
  // One duration: from the press to the verdict, saving, copying and checking together, so it matches the clock.
  const took = done && c.result && c.endedAt !== null ? `<p class="ck-took">Took <span class="mono">${esc(seconds(c.endedAt - c.startedAt))}</span> (save + copy + check)</p>` : "";
  const list = `<div class="steplist">${rows
    .map((r) => `<div class="r">${r.state === "run" ? '<span class="spin" aria-hidden="true"></span>' : r.state === "ok" ? '<span class="ok" aria-hidden="true">✓</span>' : r.state === "no" ? '<span class="ok muted" aria-hidden="true">–</span>' : '<span class="ok muted" aria-hidden="true">·</span>'}<span>${esc(r.label)}</span><span class="t">${esc(r.t)}</span></div>`)
    .join("")}</div>${took}`;
  const lw = lastWorking();
  const target = c.cp ? entry(c.cp) : null;
  const about = `<div class="ck-e">${esc(p.name)}${target ? ` · ${esc(versionPhrase(target, points()))}` : ""}</div>`;
  let body = "";
  let acts = "";
  if (!done) {
    const live = c.live?.length ? c.live.join("\n") : "";
    // What the check prints, once it prints something: the done sheet's terminal block, rising in once. The sheet keeps
    // room for it (styles.css), so Stop stays where it is when it arrives.
    body = `<div class="ck-run">${buddy("big ck-buddy")}<div>${about}<h2 id="ck-h">Checking ${esc(p.name)}</h2><p class="ck-ph">${esc(checkPhase(c))}</p></div>
      <span class="ck-el mono" aria-hidden="true">${esc(elapsed(Date.now() - c.startedAt))}</span></div><div class="ck-bar" aria-hidden="true"><i></i></div>${list}
      ${live ? `<div class="cw-o ck-live ${once(`ck-live:${c.startedAt}`)}"><div class="cw-oh"><span>What it prints so far</span></div><pre class="cw-out" tabindex="0" aria-live="off" aria-label="What the check has printed so far">${esc(live)}</pre></div>` : ""}`;
    // Stop holds its place from the first moment, so it never jumps in. It can stop the check, not the save before it.
    acts = `<button class="btn" data-act="stop-check" ${c.phase === "checking" ? "" : 'disabled title="Stop works once the check starts"'}>Stop the check</button>`;
  } else if (c.error) {
    body = `${about}<h2 id="ck-h">The check didn’t run.</h2><div class="ck-card v-error"><p>${esc(c.error)}</p></div>`;
    acts = `${QUIET_DONE}<button class="btn dark" data-act="${c.cp ? "verify-one" : "check"}" ${c.cp ? `data-id="${esc(c.cp)}"` : ""} data-autofocus>Try again</button>`;
  } else if (c.result) {
    const r = c.result;
    const head: { [V in Verdict]: string } = {
      PASS: "It works.", FAIL: "It’s broken.", INCOMPLETE: "We couldn’t finish the check.", BLOCKED: "The check needs something first.", ERROR: "The check itself crashed.",
    };
    const extra =
      broken ? " Time Machine won’t check it or bring it back. Pick another save point."
      : r.verdict === "FAIL" ? (lw ? ` The last version that works is ${savePointPhrase(lw, points())}: ${shortTitle(lw)}.` : " No earlier save point has passed yet.")
        : r.verdict === "ERROR" ? " This is a problem with the check, not necessarily your project."
          : r.verdict === "PASS" ? ` Checked in a copy on ${device()}. The network was ${r.network.policy === "deny" ? "off" : "on"} during the check.` : "";
    const v = r.stopped ? "none" : verdictKey(r.verdict);
    body = `${about}<div class="ck-card v-${v} ${stampOnce(`check:${r.checkpoint}:${r.verdict}`)}">
        <h2 id="ck-h" class="ck-v">${r.stopped ? "" : `<span class="ck-i" aria-hidden="true">${vIcon(r.verdict)}</span>`}<span>${esc(r.stopped ? "You stopped the check." : broken ? "This save point is damaged." : head[r.verdict])}</span></h2>
        <p>${r.stopped ? "The save point keeps the verdict it had." : reasonHtml(checkReason(r.reason) + extra)}</p>
        ${r.verdict !== "PASS" && !r.stopped && !broken ? checkWords(r, r.verdict, false) : ""}
      </div>${r.stopped ? "" : verdictTip()}${list}
      ${st.settings.showGitDetails ? `<div class="git"><div><span class="k">verdict</span> ${esc(r.verdict)} · exit ${esc(String(r.exitCode))} · ${esc(r.isolation)} mode</div><div><span class="k">command</span> ${esc(r.command)}</div>${r.log ? `<div><span class="k">log</span> ${esc(r.log)}</div>` : ""}</div>` : ""}`;
    // A broken or unfinished result carries the log's path in its check block; Works and a stopped check offer it here.
    const log = r.log && (r.verdict === "PASS" || r.stopped) ? `<button class="btn link" data-act="reveal" data-path="${esc(r.log)}">Copy the log’s path</button>` : "";
    const goBack = r.verdict === "FAIL" && !r.stopped && lw ? lw : null;
    const again = !r.stopped && !broken && (r.verdict === "INCOMPLETE" || r.verdict === "BLOCKED" || r.verdict === "ERROR");
    acts = goBack ? `${log}${QUIET_DONE}<button class="btn dark" data-act="rewind-to" data-id="${goBack.id}" title="${esc(goBackLabel(goBack, points()))}" data-autofocus>${esc(goBackShort(goBack, points()))}</button>`
      : again ? `${log}${QUIET_DONE}<button class="btn dark" data-act="verify-one" data-id="${esc(r.checkpoint)}" data-autofocus>Check it again</button>`
        : `${log}<button class="btn dark" data-act="close-check" data-autofocus>Done</button>`;
  }
  // On a very narrow phone (<= 360) a quiet Done moves up into the sheet's head as a text button, so the sticky bar
  // holds the one main action (Design b3+4, ruling 2). Only one of the two Dones is ever shown.
  const topDone = acts.includes("ck-dq") ? '<button class="btn link ck-top-done" data-act="close-check">Done</button>' : "";
  return `<div class="scrim ck-scrim ${once("scrim:check")}" data-leave="check"><div class="sheet ck${done ? " ck-done" : ""}" role="dialog" aria-modal="true" aria-labelledby="ck-h">
    ${topDone}${body}
    <p class="sp-note">Your project folder is not touched. The check runs in a separate copy.</p>
    <div class="row-btns ck-acts">${acts}</div>
  </div></div>`;
}

/** Review, then Done. A search first only when no working version was known. */
function rewindSteps(r: RewindState): string {
  const labels = r.searched ? ["Find", "Review", "Done"] : ["Review", "Done"];
  return steps(r.step === "done" ? labels.length : r.step === "review" ? labels.length - 1 : 1, labels);
}

/** The plain Rewind sheet, for Simple rewind: the dial scene's reading and actions in one column, without the dial. */
function rewind(): string {
  const r = st.rewind;
  const p = project();
  if (!r || !p) return "";
  const c = entry(stageId());
  const tried = r.find?.tried ?? r.progress.map((x) => ({ id: x.checkpoint, verdict: asVerdict(x.verdict), reason: "" }));
  const triedRows = r.step === "find" && tried.length
    ? `<div class="tried">${tried.map((t) => { const e = entry(t.id); return `<div class="r"><span class="mono">${esc(e ? ptClock(e) : t.id)}</span><span>${esc(e ? title(e) : "")}</span>${badge(t.verdict)}</div>`; }).join("")}</div>`
    : "";
  const pane = c ? tvRead(r, c) : { read: `<div class="note warn">That save point is not in the history of ${esc(p.name)}.</div>`, key: tvKey("find", "Find the last working version", "enter", keys("Mod+Enter")), alts: [] };
  return `<div class="scrim rw-scrim ${once("scrim:rewind")}" data-leave="rewind"><div class="sheet rw rw-sheet step-${r.step}" role="dialog" aria-modal="true" aria-label="${esc(`Rewind ${p.name}`)}">
    <div class="rw-main"><div class="rw-head">${rewindSteps(r)}</div>
      <div class="tv-read">${triedRows}${pane.read}</div>
      ${rwFoot(r, pane)}</div>
  </div></div>`;
}

/** The Rewind's foot, kept at the sheet's foot while the reading scrolls: the quiet alternatives, then Not now (or Undo when it is done) and the main key. */
function rwFoot(r: RewindState, pane: { key: string; alts: string[] }): string {
  const quiet = r.step === "done" && r.result
    ? undoButton("quiet", "Undo")
    : `<button class="btn quiet" data-act="tv-exit" data-key="esc" ${r.recovering ? "disabled" : ""}>Not now<kbd>Esc</kbd></button>`;
  return `<div class="rw-foot">${pane.alts.length ? `<div class="rw-alts">${pane.alts.join("")}</div>` : ""}<div class="rw-btns">${quiet}${pane.key}</div></div>`;
}

/** What Undo does, said plainly before anyone presses it. */
function undoNote(res: RecoverResult): string {
  if (res.copyOnly) return '<p class="rw-undo-note">Undo removes the copy. Every save point stays, including your version from just before. Undo stops if you changed anything in the copy.</p>';
  return `<p class="rw-undo-note">Undo removes the new branch${st.settings.showGitDetails ? ` ${esc(res.branch)}` : ""} and the copy. Every save point stays, including your version from just before. Undo stops if you changed anything in the copy or added commits to the branch.</p>`;
}
function undoButton(size: string, label = "Undo this rewind"): string {
  const u = st.undo;
  return `<button class="btn ${size}" data-act="undo-rewind" data-key="undo" ${!u || u.working || st.busy ? "disabled" : ""}>${u?.working ? "Undoing…" : esc(label)}<kbd>${esc(keys("Mod+Z"))}</kbd></button>`;
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
    if (line === "Code") return codeLine(st.settings.showGitDetails ? short(c.commit) : null, c.dirty);
    const files = /^(\d+) saved files?$/.exec(line);
    if (files) return otherFiles(Number(files[1]));
    if (line.startsWith("Config values: ")) return `Settings: ${line.slice(15)}`;
    return line;
  });
}

function evidenceFor(c: TimelineEntry, v: Verdict | null): string {
  const vr = st.verifyResults.get(c.id);
  const same = vr && vr.verdict === v ? vr : null;
  const where = `In a copy on ${device()}${st.settings.showGitDetails ? ` (basic isolation, ${c.isolation ?? "host"} mode)` : ""}`;
  const took = same ? ` in ${seconds(same.durationMs)}` : "";
  const net = same ? (same.network.enforcedBy ? ", network off" : ", network on") : "";
  switch (v) {
    case "PASS":
      return `Passed its check${took}. ${where}${net}.`;
    case "FAIL":
      return `Failed its check${took}${same?.exitCode != null && st.settings.showGitDetails ? ` (exit code ${same.exitCode})` : ""}. ${where}${net}.`;
    case "INCOMPLETE":
      return "We couldn’t finish the check, so we won’t call it working.";
    case "BLOCKED":
      return "The check needs something before it can run.";
    case "ERROR":
      return "The check itself crashed. This doesn’t mean the project is broken.";
    default:
      return "Saved, not checked. We don’t know yet if it works.";
  }
}

/** What changed since the save point before, by path in a sunken mono block. The diff gives paths without a kind, so no marks. */
function rwFiles(c: TimelineEntry, prev: TimelineEntry | null): string {
  const box = (inner: string): string => `<div class="files rw-files">${inner}</div>`;
  if (!prev) return box('<span class="rw-fn">The first save point. Nothing before it to compare with.</span>');
  const paths = st.changes.get(c.id);
  if (!paths) return box('<span class="rw-fn">Reading what changed…</span>');
  if (!paths.length) return box('<span class="rw-fn">No file changes since the save point before.</span>');
  const shown = paths.slice(0, 8);
  const more = paths.length - shown.length;
  return box(`<b>${esc(plural(paths.length, "file"))} changed since the save point before</b>${shown.map((f) => `<span class="sel-text">${esc(f)}</span>`).join("")}${more ? `<span class="rw-fn">and ${esc(String(more))} more</span>` : ""}`);
}

/** The Rewind's main key: an ink pill with its shortcut in it. It takes focus when the sheet opens. */
function tvKey(act: string, label: string, key: string, keyLabel: string, disabled = false): string {
  return `<button class="btn dark big rw-key" data-act="${act}" data-key="${key}" data-autofocus ${disabled ? "disabled" : ""}><span>${esc(label)}</span>${keyLabel ? `<kbd>${esc(keyLabel)}</kbd>` : ""}</button>`;
}
/** A quiet alternative beside the key. */
function tvAlt(act: string, label: string, key: string, keyLabel: string, disabled = false): string {
  return `<button class="btn link" data-act="${act}" data-key="${key}" ${disabled ? "disabled" : ""}>${esc(label)}${keyLabel ? `<kbd>${esc(keyLabel)}</kbd>` : ""}</button>`;
}

/** A version, said the way people say it: the time in the display face (never "#N"; the meta line says which twin), its title in the voice. The verdict is the pill under it. */
function versionHead(c: TimelineEntry, lead = `${sentenceStart(headName(c.id))}.`): string {
  return `${keepTimes(esc(lead))} <span class="voice">${esc(title(c, authorOf(c)))}</span>`;
}

/**
 * The reading of the Rewind, in the dial scene and in the plain sheet: Find, Review, Done.
 * The key and its quiet alternatives come apart from the reading: they sit in the sheet's foot.
 */
function tvRead(r: RewindState, c: TimelineEntry): { read: string; key: string; alts: string[] } {
  const newest = points().at(-1);
  const v = shownVerdict(c);
  const git = st.settings.showGitDetails;
  const mainKey = keys("Mod+Enter");
  const cols = (a: string, b: string, yes: string[], no: string[]): string =>
    `<div class="tv-cols"><div class="kv"><span class="h">${esc(a)}</span>${li(yes, "Nothing listed")}</div><div class="kv no"><span class="h">${esc(b)}</span>${li(no, "Nothing listed")}</div></div>`;
  const nth = twinOrdinal(c, points());
  const meta = `<p class="rw-meta">${keepTimes(esc(`${dayLabel(c.createdAt)} ${nth ? `· the ${nth} save at ${ptTime(c)}` : ptTime(c)} · ${authorOf(c)}`))}</p>`;
  const error = r.error ? `<div class="note bad">${esc(r.error)}</div>` : "";

  if (r.step === "done" && r.result) {
    const res = r.result;
    const loc = (label: string, value: string, button: string): string =>
      `<div class="rw-loc"><span class="k">${esc(label)}</span><span class="mono sel-text v">${esc(value)}</span>${button}</div>`;
    return {
      read: `<h2 class="tv-head ${stampOnce(`done:${res.branch || res.copyDir}`)}">${keepTimes(esc(`${sentenceStart(headName(res.id))} is back.`))} <span class="voice">Your folder wasn’t touched.</span></h2>
      ${checksOn(project()) ? `<div class="rw-proof">${badge(res.lastVerdict)}<span>${res.lastVerdict ? `Last check: ${esc(verdictWord(res.lastVerdict))}, in a copy on ${device()}.` : "Not checked yet. Run Check it works before you rely on it."}</span></div>` : ""}
      <p class="rw-lede">${res.copyOnly ? "It is in a copy next to your folder. This folder has no Git repo, so no branch was made. Copy back the files you want to keep." : "It is on a new branch, with a copy next to your project. Your folder was not touched, so switching is your call."}</p>
      <div class="rw-where">
        ${res.copyOnly ? "" : loc("New branch, local only", res.branch, `<button class="btn quiet" data-act="copy" data-text="${esc(res.branch)}" aria-label="Copy the branch name">Copy</button>`)}
        ${loc("Open this folder", res.copyDir, `<button class="btn quiet" data-act="reveal-dir" data-path="${esc(res.copyDir)}">${revealLabel()}</button>`)}
      </div>
      <section class="report" aria-labelledby="rw-report-h"><h3 id="rw-report-h">What came back</h3>
        ${cols("Brought back", "Not brought back", res.restored.map((line) => plainRestored(line, entry(res.id)?.dirty ?? false)), res.notRestored.map((line) => plainNotSaved(line, project()?.purpose === "code")))}
        <div class="kv todo"><span class="h">Things to do by hand</span>${li(res.manualSteps, "Nothing")}</div>
        <p class="endline">${res.copyOnly ? "Your current version was saved first. Nothing was deleted." : "Your current version was saved first. Nothing was pushed, merged, deployed or deleted."}</p>
        <div class="row-btns"><button class="btn link" data-act="copy-report" data-path="${esc(res.reportPath)}">Copy the report as text</button></div>
      </section>
      ${git ? `<div class="git">${res.copyOnly ? "" : `<div><span class="k">new branch</span> ${esc(res.branch)} (local only)</div>`}<div><span class="k">copy</span> ${esc(res.copyDir)}</div>${res.savedBefore ? `<div><span class="k">saved first</span> ${esc(res.savedBefore)}</div>` : ""}<div><span class="k">report</span> ${esc(res.reportPath)}</div></div>` : ""}
      ${undoNote(res)}`,
      key: tvKey("tv-done", "Done", "enter", mainKey),
      alts: [],
    };
  }

  if (r.finding) {
    return {
      read: `<h2 class="tv-head">Finding the last version that works</h2>${meta}
        <div class="rw-proof"><span class="vb v-checking"><i class="g" aria-hidden="true"></i>Checking</span><span>${esc(sentenceStart(pointName(c.id)))}, ${r.progress.length + 1} of up to ${points().length}. Newest first, each in a copy.</span></div>
      ${cols("Comes back", "Does not come back", comesBackLines(c), notSavedLines(c))}`,
      key: tvKey("tv-wait", "Checking…", "enter", "", true),
      alts: ['<button class="btn link" data-act="stop-check">Stop the search</button>', '<span class="key-note">Esc leaves this view. The search keeps going and tells you when it is done.</span>'],
    };
  }

  if (r.find && !r.find.found && !r.target) {
    const last = r.find.tried.at(-1);
    const why =
      r.find.stopped ? (r.find.tried.length === 1 ? "You stopped the search. The one save point checked before that did not pass." : r.find.tried.length ? `You stopped the search. None of the ${plural(r.find.tried.length, "save point")} checked before that passed.` : "You stopped the search before any save point was checked.")
        : r.find.verdict === "FAIL" ? (r.find.tried.length === 1 ? "The only save point did not pass its check." : `None of the ${plural(r.find.tried.length, "save point")} passed its check.`)
        : r.find.verdict === "BLOCKED" ? `We had to stop. ${last?.reason ?? ""}`
          : `We couldn’t check every save point, so we won’t call any of them working. ${last?.reason ?? ""}`;
    return {
      read: `<h2 class="tv-head">${r.find.stopped ? "Search stopped." : "No working version found."}</h2><div class="note warn">${esc(why)}</div>
      ${cols("Comes back", "Does not come back", comesBackLines(c), notSavedLines(c))}`,
      key: tvKey("tv-exit", "Back to where I was", "enter", mainKey),
      alts: r.find.stopped ? [tvAlt("find", "Search again", "", "")] : [],
    };
  }

  // Review: the version, its proof, what changed, what going back will do. Bringing it back is the key only when it is proven,
  // or when the project has no check: then it only saves versions, so the key makes the copy and nothing is checked (MF4).
  const checks = checksOn(project());
  const tr = r.tryResult && r.tryResult.checkpoint === c.id ? r.tryResult : null;
  const kind = reviewKey(checks, v, !!tr);
  const head = r.trying ? versionHead(c, `Trying ${pointName(c.id)} in a copy.`) : versionHead(c);
  const ev = !checks ? ""
    : r.trying ? `<span class="vb v-checking"><i class="g" aria-hidden="true"></i>Checking</span><span>Rebuilding it in a separate folder and running your check. Your real folder hasn’t changed.</span>`
      : `${badge(v, stampOnce(`ev:${c.id}:${v ?? ""}`))}<span>${tr && tr.verdict === v && v !== "PASS" && v !== "FAIL" ? `${reasonHtml(checkReason(tr.reason))} ` : ""}${esc(evidenceFor(c, v))}</span>`;
  const warn = !checks || r.trying || r.recovering ? ""
    : tr && tr.verdict !== "PASS" ? `<div class="note warn">We couldn’t confirm this version works. You can still go back to it, but it is not proven.</div>`
      : kind !== "bring-back" ? `<div class="note">No passing check is recorded for this version. Try it first: we open it in a copy and run your check.</div>` : "";
  const opened = r.openResult && r.openResult.id === c.id
    ? `<div class="note rw-opened"><span>A copy you can open is ready. Your folder was not touched.</span> <span class="mono sel-text">${esc(r.openResult.dir)}</span> <button class="btn quiet" data-act="reveal-dir" data-path="${esc(r.openResult.dir)}">${revealLabel()}</button></div>` : "";
  const busy = r.trying || r.recovering || !!st.busy;
  const notNewest = !!newest && newest.id !== c.id;
  const all = points();
  const prev = all[all.findIndex((x) => x.id === c.id) - 1] ?? null;
  const compare = notNewest ? [tvAlt("tv-compare", "See what changed", "c", "C", busy)] : [];
  const key = r.recovering ? tvKey("tv-use", "Bringing it back…", "enter", "", true) : tvKey(REVIEW_KEY[kind].act, REVIEW_KEY[kind].label, "enter", mainKey, busy);
  const alts = kind === "bring-back" || kind === "copy" ? compare : [
    ...(r.trying ? ['<button class="btn link" data-act="stop-check">Stop the check</button>'] : []),
    `<span class="key-note">${tr ? "Opens it in a copy again and runs your check." : "Opens it in a copy and runs your check. Your folder is not touched."}</span>`,
    tvAlt("tv-use-anyway", "Go back anyway", "use", "", busy),
    ...compare,
    ...(tr ? [`<button class="btn link" data-act="rw-open" ${r.opening || busy ? "disabled" : ""}>${r.opening ? "Making a copy…" : "Make a copy I can open"}</button>`] : []),
  ];
  return {
    read: `${r.trying ? "" : '<p class="rw-kicker">You’re going back to</p>'}<h2 class="tv-head">${head}</h2>${meta}
      ${ev ? `<div class="rw-proof">${ev}</div>` : ""}
      ${r.find?.found === c.id ? `<p class="rw-found">We checked ${esc(plural(r.find.tried.length, "save point"))}, newest first, each in a copy. This is the newest one that passed.</p>` : ""}
    ${error}${warn}${opened}
    ${rwFiles(c, prev)}
    ${goBackSteps({ folder: project()?.kind === "folder", id: c.id, gitDetails: st.settings.showGitDetails })}
    ${cols("Comes back", "Does not come back", comesBackLines(c), notSavedLines(c))}`,
    key,
    alts,
  };
}

function tvRuler(r: RewindState, pts: TimelineEntry[], cur: number): string {
  const n = pts.length;
  const x = (i: number): number => sceneX(i, n);
  const checking = checkingId();
  const half = (0.5 / n) * 100 * 0.7;
  const clips = sessions(pts).map((s) => `<span class="clip" style="left:${x(s.from) - half}%;width:${x(s.to) - x(s.from) + half * 2}%"><span>${esc(s.name)} session</span></span>`);
  const bars = pts
    .map((c, i) => {
      if (i === 0) return "";
      const ch = st.changes.get(c.id);
      const h = ch ? Math.max(3, Math.min(24, 4 + 6 * Math.log2(1 + ch.length))) : 3;
      return `<i class="${ch ? "" : "unk"}" style="left:${x(i)}%;--h:${(h / 24).toFixed(3)}" title="${esc(ch ? `${plural(ch.length, "file")} changed` : "Not read yet")}"></i>`;
    })
    .join("");
  const still = r.finding || r.trying || r.recovering || r.step === "done";
  // On entry the playhead glides back from Now. Each tick it crosses flicks as it passes, and a Works save
  // point it lands on rings once. Timed from the entry, so a redraw during the glide carries them on.
  const since = performance.now() - sceneIn;
  const moving = !reducedMotion();
  const crossed = moving ? crossings(pts.map((_, i) => x(i)), cur, GLIDE_MS) : new Map<number, number>();
  const ring = moving && shownVerdict(pts[cur] ?? null) === "PASS" ? entranceDelay(GLIDE_MS, since, RING_MS) : null;
  const ticks = pts
    .map((c, i) => {
      const v = shownVerdict(c);
      const cross = crossed.get(i);
      const at = i === cur ? ring : cross === undefined ? null : entranceDelay(cross, since, FLICK_MS);
      const cls = ["tvt", i === cur ? "on" : "", c.id === checking ? "checking" : "", at === null ? "" : i === cur ? "ring" : "flick"].filter(Boolean).join(" ");
      return `<button class="${cls}" style="left:${x(i)}%${at === null ? "" : `;--d:${Math.round(at)}ms`}" tabindex="-1" ${still ? "" : `data-act="tv-go" data-id="${esc(c.id)}"`} title="${esc(`${ptClock(c)} · ${title(c)} · ${verdictWord(v)}`)}">${c.id === checking ? '<i class="g v-checking-tick" aria-hidden="true"></i>' : glyph(v)}</button>`;
    })
    .join("");
  const near = (i: number): boolean => Math.abs(i - cur) < Math.max(1, n * 0.09);
  const labels = pts
    .map((c, i) => {
      const show = n <= 12 || i === cur || ((i === 0 || i === n - 1) && !near(i));
      return show ? `<span class="${i === cur ? "on" : ""}" style="left:${x(i)}%">${esc(ptClock(c))}</span>` : "";
    })
    .join("");
  const veilText = r.step === "done" && r.result ? "Your other version is saved" : "These stay saved";
  const veil = cur < n - 1 ? `<div class="tv-veil" data-carry="veil" style="--x:${x(cur)}"></div><span class="tv-veil-l">${esc(veilText)}</span>` : "";
  const fork =
    r.step === "done" && r.result
      ? `<svg class="tv-fork" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" vector-effect="non-scaling-stroke" d="M ${x(cur)} 100 C ${x(cur)} 50, ${x(cur)} 30, ${x(cur) + 2.5} 30 L 100 30"/></svg>
        <span class="fork-l" style="--x:${x(cur)}">${esc(r.result.copyOnly ? "Copy" : st.settings.showGitDetails ? `${r.result.branch} · new branch, local only` : "New branch, local only")}</span>`
      : "";
  // Every shape on the ruler is named: the three common ones always, the rare ones when a save point has them.
  // A project with no check shows only "Saved", the same rule as History's ruler (Design MF4).
  const legend = legendItems(checksOn(project()), pts.map((c) => shownVerdict(c)))
    .map(({ v, word }) => `<span>${glyph(v)}${esc(word)}</span>`)
    .join("");
  return `<footer class="tv-ruler ${once("tv-ruler", "rise")}${fork ? " forked" : ""}">
    <div class="tv-track">
      ${fork}
      <div class="tv-lane">${clips.join("")}</div>
      <div class="tv-band" aria-hidden="true">${bars}</div>
      <div class="tv-ticks" aria-hidden="true">${ticks}</div>
      <div class="tv-labels" aria-hidden="true">${labels}</div>
      ${veil}
      <div class="tv-ph" data-carry="ph" style="--x:${x(cur)}" aria-hidden="true"></div>
    </div>
    <div class="tv-legend" aria-hidden="true">${legend}<span class="sp"></span><span><kbd>J</kbd><kbd>L</kbd> step</span><span><kbd>⇧J</kbd><kbd>⇧L</kbd> verdict change</span></div>
  </footer>`;
}

/** The save points the dial and the ruler show, set by the last draw of the scene. Dragging the dial reads it. */
let sceneIds: string[] = [];
/** True while the dial is being dragged. */
let dialDrag = false;
/** True while the History ruler is being dragged. */
let historyScrub = false;
/** True when a press, not a key, last focused the History ruler: it keeps focus for the keys, but no ring or flag after letting go. */
let rulerByPointer = false;

/** The dial: a white knurled dial with one detent per save point, its verdict mark around the edge, then the time it points at. */
function dialModule(pts: TimelineEntry[], cur: number, still: boolean, back: number): string {
  const n = pts.length;
  const checking = checkingId();
  const lw = lastWorking();
  const lwi = lw ? pts.indexOf(lw) : -1;
  const dets = pts
    .map((c, i) => {
      const a = dialAngle(i, n);
      const dot = c.id === checking ? '<i class="g v-checking-tick"></i>' : glyph(shownVerdict(c));
      return `<span class="det ${i === cur ? "on" : ""}" style="transform:rotate(${a}deg)"><span class="dg" style="transform:rotate(${-a}deg)">${dot}</span></span>`;
    })
    .join("");
  // Labels for the selected, the last working, the newest and the first one, most important first. fitDialLabels places them.
  const labels = [...new Set([cur, lwi, n - 1, 0])]
    .map((i) => {
      const p = pts[i];
      return p ? `<b class="dl${i === cur ? " on" : ""}" data-i="${i}">${esc(ptClock(p))}</b>` : "";
    })
    .join("");
  const c = pts[cur];
  const a = dialAngle(cur, n);
  return `<section class="dialmod" aria-label="Choose a save point">
    <div class="silk"><span>Save points</span><span>${esc(String(n))}</span></div>
    <div class="dial ${still ? "still" : ""} ${dialDrag ? "drag" : ""}">
      <div class="dets" aria-hidden="true">${dets}</div><div class="dlabs" aria-hidden="true">${labels}</div>
      <div class="knob" role="slider" tabindex="0" data-carry="knob" style="transform:rotate(${a}deg)" aria-label="Save point. Turn it, or press J and L or the arrow keys." aria-valuemin="1" aria-valuemax="${n}" aria-valuenow="${cur + 1}" aria-valuetext="${esc(c ? `${ptClock(c)}, ${title(c)}, ${verdictWord(shownVerdict(c))}` : "")}" ${still ? 'aria-disabled="true"' : ""}></div>
    </div>
    <div class="rw-when"><b>${esc(c ? ptTime(c) : "")}</b><span>${esc(back ? `${plural(back, "save point")} back` : "The newest save point")}</span></div>
    ${c ? rewindFacts(c) : ""}
    <div class="rw-turn">Turn it, or use <kbd>←</kbd><kbd>→</kbd></div>
  </section>`;
}

/** Under the dial, what is known about the save point it points at: its verdict, who saved it, how many files changed, and
 *  where it was checked. Only recorded facts; a line with nothing to say is left out. */
function rewindFacts(c: TimelineEntry): string {
  const v = shownVerdict(c);
  const changed = st.changes.get(c.id);
  const rows = [
    v !== null || checksOn(project()) ? `<li>${badge(v)}</li>` : "",
    `<li>${authorChip(authorOf(c))}</li>`,
    changed ? `<li class="rwf-files">${FILE_ICON}<span>${esc(changed.length ? `${plural(changed.length, "file")} changed` : "No files changed")}</span></li>` : "",
    v ? '<li class="rwf-safe">Checked in a copy</li>' : "",
  ].join("");
  return `<ul class="rw-facts" aria-label="About this save point">${rows}</ul>`;
}

/** The Rewind with the dial: a sheet over History. The reading and its foot on the left, the dial on the right, the ruler in a well under both. */
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
  sceneIds = pts.map((x) => x.id);
  const still = r.finding || r.trying || r.recovering || r.step === "done";
  const pane = tvRead(r, c);
  // The reading comes first in the document, so its main key is the first control named to take focus; the dial follows it.
  return `<div class="scrim rw-scrim ${once("tv")}" data-leave="tv"><div class="sheet rw tv step-${r.step}" role="dialog" aria-modal="true" aria-label="${esc(`Rewind ${p.name}`)}">
    <section class="rw-main" aria-label="Selected save point"><div class="rw-head">${rewindSteps(r)}</div>
      <div class="tv-read">${pane.read}</div>
      ${rwFoot(r, pane)}</section>
    ${dialModule(pts, cur, still, all.length - 1 - ci)}
    ${tvRuler(r, pts, cur)}
  </div></div>`;
}

function compare(): string {
  const p = project();
  const pts = points();
  if (!p) return welcome();
  const c = st.compare;
  const name = (id: string | null): string => (id === "now" ? "now" : id ? pointName(id) : "");
  const opt = (sel: string | null): string =>
    `<option value="now" ${sel === "now" ? "selected" : ""}>Now: your folder as it is</option>` +
    // The verdict comes before the title, so a long title is what gets cut off, never the verdict.
    [...pts].reverse().map((x) => `<option value="${x.id}" ${x.id === sel ? "selected" : ""}>${esc(`${pointLabel(x)} · ${verdictWord(x.verdict)} · ${title(x, authorOf(x))}`)}</option>`).join("");
  // A picker is the native select, see-through, over a pill face that shows its whole label on as many lines as it needs,
  // so a phone never cuts the title off (Design checklist row 7). The select keeps the keys, the name and the system list.
  const picker = (label: string, model: string, sel: string | null): string => {
    const e = sel && sel !== "now" ? entry(sel) : undefined;
    const nowSub = sel === "now" && c.now && c.result ? (c.now.skipped ? "Nothing changed since the last save point." : "Saved just now, so we could compare.") : "";
    const face = sel === "now"
      ? `<span class="cmp-fw"><b>Now</b></span><span class="cmp-ft">Your folder as it is</span>${nowSub ? `<span class="cmp-fs">${esc(nowSub)}</span>` : ""}`
      : e ? `<span class="cmp-fw"><span class="mono">${esc(pointLabel(e))}</span>${badge(e.verdict)}<span class="cmp-fa">${esc(authorOf(e))}</span></span><span class="cmp-ft">${esc(title(e, authorOf(e)))}</span>` : "";
    return `<label class="cmp-l"><span class="cmp-lt">${label}</span><span class="cmp-pick"><span class="cmp-face" aria-hidden="true">${face}</span><select data-model="${model}">${opt(sel)}</select></span></label>`;
  };
  let body = "";
  if (c.loading) body = '<div class="cmp-wait" role="status"><span class="spin" aria-hidden="true"></span><span>Comparing…</span></div>';
  else if (c.error) body = `<div class="note bad">${esc(c.error)}</div>`;
  else if (c.result) {
    const d = c.result;
    const statusWord = (s: string): string => ({ M: "changed", A: "added", D: "removed", T: "type", R: "renamed", C: "copied" })[s[0] ?? ""] ?? s;
    const parts: string[] = [];
    if (d.code.length) parts.push(plural(d.code.length, "file") + " of code changed");
    const filesN = d.files.added.length + d.files.removed.length + d.files.changed.length;
    if (filesN) parts.push(plural(filesN, "other file") + " changed");
    const cfgN = d.config.added.length + d.config.removed.length + d.config.changed.length;
    if (cfgN) parts.push(plural(cfgN, "setting") + " changed");
    if (d.dependencies.changed.length) parts.push("packages changed");
    if (d.environment.changed.length) parts.push("the environment changed");
    // The engine names each file and how it changed, not its lines: a row per file, added on the Works tint, removed on the Broken one.
    type Row = { k: string; s: string; t: string };
    const trio = (x: { added: string[]; removed: string[]; changed: string[] }): Row[] => [
      ...x.added.map((t) => ({ k: "added", s: "added", t })), ...x.removed.map((t) => ({ k: "removed", s: "removed", t })), ...x.changed.map((t) => ({ k: "changed", s: "changed", t })),
    ];
    const sections: { h: string; rows: Row[]; foot?: string }[] = [
      { h: "Code", rows: d.code.map((x) => { const k = statusWord(x.status); return { k: k === "added" || k === "removed" ? k : "changed", s: st.settings.showGitDetails ? x.status : k, t: x.path }; }) },
      { h: "Other files we saved", rows: trio(d.files) },
      { h: "Settings", rows: trio(d.config), foot: "Values are never shown. Only key names were saved." },
      { h: "Packages", rows: d.dependencies.changed.map((t) => ({ k: "changed", s: "changed", t })) },
      { h: "Environment", rows: d.environment.changed.map((t) => ({ k: "changed", s: "changed", t })) },
    ];
    // Comparing a save point with now: a file that version has (changed or removed since) can be put back from it,
    // one at a time or all of them, after a save of what is there now (writer#10; "I just want my file back").
    const fromId = c.a && c.a !== "now" && c.b === "now" ? c.a : null;
    const ca = fromId ? entry(fromId) : null;
    const canPut = !!fromId && !!ca && !folderMissing(p) && !damagedReason(ca) && !st.busy;
    const putRow = (r: Row): string => canPut && r.k !== "added" ? `<button class="btn link small" data-act="put-back" data-id="${esc(fromId ?? "")}" data-path="${esc(r.t)}" aria-label="${esc(`Put ${r.t} back from ${name(c.a)}`)}">Put it back</button>` : "";
    const sec = (x: { h: string; rows: Row[]; foot?: string }): string => `<section class="cmp-sec" aria-label="${esc(x.h)}"><h2 class="cmp-ch">${esc(x.h)}</h2>
      <ul class="cmp-files">${x.rows.map((r) => `<li class="cf cf-${r.k}"><span class="mono sel-text cf-p">${esc(r.t)}</span><span class="cf-s">${esc(r.s)}</span>${x.h === "Code" || x.h === "Other files we saved" ? putRow(r) : ""}</li>`).join("")}</ul>${x.foot ? `<p class="small muted">${esc(x.foot)}</p>` : ""}</section>`;
    const changed = sections.filter((x) => x.rows.length);
    const putAll = canPut ? [...sections[0]?.rows ?? [], ...sections[1]?.rows ?? []].filter((r) => r.k !== "added").map((r) => r.t) : [];
    const still = sections.filter((x) => !x.rows.length).map((x) => x.h);
    const ea = entry(d.a);
    const eb = entry(d.b);
    const from = name(c.a);
    const to = name(c.b);
    // The same version on both sides is a choice to change, not an empty result (Design b7+8, P3-3).
    const same = c.a === c.b ? `Both sides are ${c.a === "now" ? "your folder as it is" : from}. Pick another one to compare.` : `No differences between ${from} and ${to}.`;
    // One sticker card, like Unvibe's brief: the buddy and the sentence, then a row per file under each kind of change.
    body = (parts.length
      ? `<div class="cmp-result"><div class="cmp-rh">${buddy()}<p class="cmp-sum">${esc(`From ${from} to ${to}: ${parts.join(", ")}.`)}</p></div>${changed.map(sec).join("")}${still.length && project()?.purpose === "code" ? `<p class="cmp-none">${esc(`No change: ${still.join(" · ")}`)}</p>` : ""}${putAll.length > 1 && putAll.length <= 200 ? `<div class="row-btns"><button class="btn" data-act="put-back" data-id="${esc(fromId ?? "")}" data-paths="${esc(JSON.stringify(putAll))}">${esc(`Put all ${putAll.length} back from ${from}`)}</button></div>` : ""}</div>`
      : `<div class="cmp-result cmp-same">${emptyState({ line: same })}</div>`) +
      (ea?.verdict === "PASS" && eb?.verdict !== "PASS" ? `<div class="row-btns"><button class="btn big dark" data-act="rewind-to" data-id="${ea.id}" title="${esc(goBackLabel(ea, points()))}">${esc(goBackShort(ea, points()))}</button><span class="small muted">${esc(`That version passed its check. ${c.b === "now" ? "Now" : sentenceStart(pointName(d.b))} ${eb?.verdict ? `is ${verdictWord(eb.verdict)}` : "has not been checked"}.`)}</span></div>` : "");
  }
  const heading = c.a && c.a !== "now" && c.b === "now" ? `What changed since ${pointName(c.a, "at")}` : "Compare";
  return `<div class="page"><div class="col">
    <div class="cmp-intro"><h1>${esc(heading)}</h1><p class="lede">What changed between a save point and now, or between any two save points.</p></div>
    <div class="cmp-head">${picker("From", "cmp-a", c.a)}${picker("To", "cmp-b", c.b)}<button class="btn quiet cmp-swap" data-act="cmp-swap">Swap</button></div>
    ${body}</div></div>`;
}

const LOADING = '<span class="spin" role="status" aria-label="Loading"></span>';
/** An empty project list: one line that says what to do, and the button that does it. No illustration, no dead end. */
const NO_PROJECTS = '<div class="empty-dir"><p>Protect a folder to see it here.</p><button class="btn" data-act="add">Protect a folder</button></div>';
/** A list while it reads (Agents, Storage): quiet rows in the card's own shape, announced once as Loading. */
function listLoading(rows: number): string {
  return `<div class="b9-list b9-sk" role="status" aria-label="Loading">${'<div class="b9-row" aria-hidden="true"><i></i><i></i></div>'.repeat(rows)}</div>`;
}

/**
 * Agents, in History's canvas: the display title and its voice line, then one white card per list. First a row per coding
 * agent (Claude Code with its real state, the others marked Planned), then Claude Code's connection in each project.
 */
function agentsScreen(): string {
  if (st.pageError) return pageFailure("Agents");
  const agentWords: { [K in AgentRow["claudeCode"]]: string } = {
    connected: "Connected. It saves before each prompt and checks after each turn.",
    "not-running": "Connected, but the command does not run yet. Nothing is saved until it does.",
    partial: "Partly connected.",
    "not-connected": "Not connected.",
    "needs-approval": "The Time Machine plugin is installed, but this project’s check is not approved on this computer, so the plugin does nothing here yet.",
    unreadable: "Its .claude/settings.json is not plain JSON, so we left it alone.",
    unavailable: "We can’t read this project right now.",
  };
  const pluginWords: { [K in AgentRow["claudeCode"]]?: string } = {
    connected: "Connected through the Time Machine plugin. It saves before each prompt and risky command, and checks after each turn.",
    "not-running": "The Time Machine plugin is on, but the tm on your PATH is missing or is another program, so nothing is saved. Put Time Machine’s tm on your PATH, then reload.",
  };
  const rows = (st.agents ?? []).map((a) => {
    const words =
      a.claudeCode === "partial"
        ? `Partly connected. Missing: ${a.missing.join(", ")}.`
        : ((a.via === "plugin" ? pluginWords[a.claudeCode] : undefined) ?? agentWords[a.claudeCode]) + (a.pluginOff ? " The Time Machine plugin is installed but turned off for this project." : "");
    const working = a.working ? `<p class="b9-sub b9-now"><i class="breath" aria-hidden="true"></i>Claude Code is working now${a.workingSince ? `, since ${esc(clock(a.workingSince))}` : ""}.</p>` : "";
    const approve = a.claudeCode === "needs-approval" && a.check ? `<p class="b9-sub">The check it would run: <code class="mono">${esc(a.check)}</code></p>` : "";
    // Disconnect is tm forget: offered wherever Time Machine acts or has lines here (Security T5).
    const disconnect = a.claudeCode === "connected" || a.claudeCode === "not-running" || a.claudeCode === "partial" ? `<button class="btn ghost" data-act="forget" data-id="${a.projectId}">Disconnect</button>` : "";
    const btn =
      a.claudeCode === "needs-approval"
        ? a.check
          ? `<button class="btn dark" data-act="approve-check" data-id="${a.projectId}">Approve this check</button>`
          : `<button class="btn" data-act="project" data-id="${a.projectId}">Set a check first</button>`
        : a.claudeCode === "partial"
          ? `<span class="row-btns"><button class="btn" data-act="hook" data-id="${a.projectId}">Add the missing lines</button>${disconnect}</span>`
          : a.claudeCode === "not-connected"
            ? `<button class="btn" data-act="hook" data-id="${a.projectId}">Connect</button>`
            : disconnect;
    const path = st.settings.showGitDetails && a.settingsPath ? `<p class="mono b9-path sel-text">${esc(a.settingsPath)}</p>` : "";
    return `<div class="b9-row"><div class="b9-main"><p class="b9-t">${esc(a.name)}</p><p class="b9-sub">Claude Code: ${esc(words)}</p>${approve}${working}${path}</div>${btn}</div>`;
  });
  const stateWord: { [K in Channel["state"]]: string } = { working: "Working", idle: "Idle", partial: "Partly connected", "not-connected": "Not connected", planned: "Planned" };
  // A planned agent's row is its mark, its name and the Planned pill; the section's one line says what Planned means.
  const channel = (ch: Channel): string =>
    `<div class="b9-row b9-ch is-${ch.state}">${agentMark(ch.name)}<div class="b9-main"><p class="b9-t">${esc(ch.name)}</p>${ch.line ? `<p class="b9-sub">${esc(ch.line)}</p>` : ""}</div><span class="b9-pill">${ch.state === "working" ? '<i class="breath" aria-hidden="true"></i>' : ""}${esc(stateWord[ch.state])}</span></div>`;
  const channels = st.agents
    ? `<div class="b9-list">${[claudeChannel(st.agents, st.lastTurn), ...PLANNED_AGENTS.map((a): Channel => ({ ...a, state: "planned", line: "", short: "Planned" }))].map(channel).join("")}</div>`
    : listLoading(1 + PLANNED_AGENTS.length);
  const projects = !st.agents ? listLoading(3) : rows.length ? `<div class="b9-list">${rows.join("")}</div>` : NO_PROJECTS;
  // With every agent connected the page has no buttons, so the scroller itself takes focus: the keys can scroll it. Its id
  // lets focusKey() keep that focus when the lists arrive and the page is drawn again.
  return `<div class="page b9-page" id="agents-page" tabindex="0" role="region" aria-label="Agents"><div class="b9">
    <header class="b9-head"><h1>Agents</h1><p class="voice b9-voice">Connections and activity come from local hook events, never from your screen.</p></header>
    <section aria-labelledby="b9-agents-h"><div class="b9-day"><h2 id="b9-agents-h">Agent channels</h2></div>
      <p class="b9-lede">${esc(`Claude Code is built and connects through hooks. ${new Intl.ListFormat("en", { type: "conjunction" }).format(PLANNED_AGENTS.map((a) => a.name))} are planned: not built or connected yet.`)}</p>${channels}</section>
    <section aria-labelledby="b9-cc-h"><div class="b9-day"><h2 id="b9-cc-h">Claude Code in each project</h2></div>
      <p class="b9-lede">Claude Code can save before each prompt and before risky commands, and check after each turn. We show the exact lines before we add them.</p>${projects}</section>
    <section class="b9-know" aria-labelledby="b9-know-h">${buddy()}<div><h2 id="b9-know-h">Good to know</h2><p>What an agent says about its own tests is never shown as a check. We run your check ourselves, in a copy.</p></div></section>
  </div></div>`;
}

/**
 * Storage, in History's canvas: the display title, what all projects take on this computer as the voice line, then one white
 * card with a row per project, its size in mono on the right. Clean up shows what would go before anything goes.
 */
function storageScreen(): string {
  if (st.pageError) return pageFailure("Storage");
  const cleanRow = (projectId: string): string => {
    const c = st.cleanup?.projectId === projectId ? st.cleanup : null;
    if (!c) return `<button class="btn quiet" data-act="clean-preview" data-id="${projectId}" ${st.cleanup?.working ? "disabled" : ""}>Clean up old check logs…</button><button class="btn quiet" data-act="thin-preview" data-id="${projectId}" ${st.thin?.working ? "disabled" : ""}>Thin old auto saves…</button>`;
    if (c.working) return LOADING;
    if (!c.result) return "";
    if (c.result.applied) return `<span class="b9-done" role="status" tabindex="-1" id="clean-result-${projectId}">Removed ${esc(plural(c.result.files.length, "old check log"))}, ${esc(bytes(c.result.bytes))}.</span>`;
    if (!c.result.files.length) return `<span class="b9-done" role="status" tabindex="-1" id="clean-result-${projectId}">No old check logs to remove. Each save point keeps only its newest one.</span><button class="btn quiet" data-act="clean-cancel" data-id="${projectId}">Done</button>`;
    return `<span class="b9-would">${esc(plural(c.result.files.length, "old check log"))}, <span class="mono">${esc(bytes(c.result.bytes))}</span></span><span class="row-btns"><button class="btn quiet" data-act="clean-cancel" data-id="${projectId}">Never mind</button><button class="btn dark" data-act="clean-apply" data-id="${projectId}">Remove them</button></span>`;
  };
  const all = st.storage?.rows ?? [];
  const rows = all.map((r) => {
    // A moved project: the engine can't find its store from the folder (storeDir is ""), so it has no size and nothing to
    // clean up. Its store is untouched, so the row says it can't be read, as Agents does, instead of "0 B".
    if (!r.storeDir) return `<div class="b9-row b9-st"><p class="b9-t">${esc(r.name)}</p><p class="b9-sub b9-unread">We can’t read this project right now.</p>
      <span class="row-btns b9-acts"><button class="btn ghost" data-act="remove" data-id="${r.projectId}">Remove from app</button></span></div>`;
    // The clean-up choice goes on its own line under the row, away from the row's Remove from app.
    const asking = st.cleanup?.projectId === r.projectId && !st.cleanup.working && !!st.cleanup.result?.files.length && !st.cleanup.result.applied;
    return `<div class="b9-row b9-st"><p class="b9-t">${esc(r.name)}</p>${st.settings.showGitDetails ? `<p class="mono b9-path sel-text">${esc(r.storeDir)}</p>` : ""}
      <span class="b9-num mono">${esc(bytes(r.bytes))}<span class="sr-only"> on ${device()}</span></span>
      <span class="row-btns b9-acts">${asking ? "" : cleanRow(r.projectId)}<button class="btn ghost" data-act="remove" data-id="${r.projectId}">Remove from app</button></span>${asking ? `<div class="b9-ask">${cleanRow(r.projectId)}</div>` : ""}${thinRow(r.projectId)}</div>`;
  });
  // The total is the whole store on disk, removed projects' history included, so it matches what the disk says; what it
  // can't count (a code project's own .git) is named.
  const unread = all.filter((r) => !r.storeDir).map((r) => r.name);
  const voice = st.storage ? `${bytes(st.storage.storeBytes)} on ${device()}${unread.length ? `, not counting ${new Intl.ListFormat("en", { type: "conjunction" }).format(unread)}` : ""}.` : "";
  const list = !st.storage ? listLoading(3) : rows.length ? `<div class="b9-list b9-stl">${rows.join("")}</div>` : NO_PROJECTS;
  // History kept in the store for folders the app does not list: set up with tm init, or removed from the app earlier.
  const kept = st.storeProjects?.length
    ? `<section aria-labelledby="b9-kept-h"><div class="b9-day"><h2 id="b9-kept-h">History of folders not in the app</h2><span>Kept on ${esc(device())}</span></div><div class="b9-list b9-stl">${st.storeProjects
      .map((s) => `<div class="b9-row b9-st"><p class="b9-t">${esc(s.name)}</p><p class="b9-sub">${esc(`${plural(s.savePoints, "save point")}${s.lastSaved ? `, last ${when(s.lastSaved)}` : ""}${s.exists ? "" : ". The folder is no longer there"}`)}</p>${st.settings.showGitDetails ? `<p class="mono b9-path sel-text">${esc(s.path)}</p>` : ""}
        <span class="b9-num mono">${esc(bytes(s.bytes))}</span><span class="row-btns b9-acts">${s.exists ? `<button class="btn quiet" data-act="store-add" data-path="${esc(s.path)}">Add to the app</button>` : ""}</span></div>`)
      .join("")}</div></section>`
    : "";
  // On phones the page is the scroller, and while the list reads nothing in it can take focus: like Agents, the page
  // itself is a named region that can, so the keys can still scroll it.
  return `<div class="page b9-page" id="storage-page" tabindex="0" role="region" aria-label="Storage"><div class="b9">
    <header class="b9-head"><h1>Storage</h1>${voice ? `<p class="voice b9-voice">${esc(voice)}</p>` : '<p class="b9-voice b9-voice-sk" aria-hidden="true"><i class="sk"></i></p>'}
      <p class="b9-lede">Save points are stored on ${device()}, outside your project folders, so deleting a project does not delete its history. This is not a full computer backup.</p>${st.storage?.note ? `<p class="b9-lede">${esc(st.storage.note)}</p>` : ""}</header>
    ${list}
    ${kept}
    <section class="b9-know" aria-labelledby="b9-know-h">${buddy()}<div><h2 id="b9-know-h">Good to know</h2>
      <p>Clean up only removes old check logs: a log goes when a newer check of the same save point replaced it. Save points and their newest check logs stay. First we list what would go, then you choose Remove them.${st.settings.showGitDetails ? ` Store: <span class="mono sel-text">${esc(st.boot.storeDir)}</span>` : ""}</p>
      <p>Thin old auto saves removes automatic saves that newer ones cover. Working, pinned and named save points always stay, and so do auto saves from the last 24 hours and your newest 20. First we list what would go, then you choose Remove.</p></div></section>
  </div></div>`;
}

/** Which Settings section is open. A wide page shows one at a time beside the section list; a narrow one stacks them all. */
let settingsSection = "appearance";

/** A section's small line icon in the Settings list. Drawn in the text colour; the label carries the meaning. */
function setIcon(name: string): string {
  const paths: { [icon: string]: string } = {
    appearance: '<circle cx="10" cy="10" r="6.5"/><path d="M10 3.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" stroke="none"/>',
    rewind: '<path d="M4.6 10.6a5.6 5.6 0 1 0 1.9-4.6"/><path d="M5.2 3.4v3.2h3.2"/>',
    project: '<path d="M3 6.6A1.6 1.6 0 0 1 4.6 5h3.1l1.7 1.8h6A1.6 1.6 0 0 1 17 8.4v6A1.6 1.6 0 0 1 15.4 16H4.6A1.6 1.6 0 0 1 3 14.4z"/>',
    local: '<rect x="3" y="4.5" width="14" height="11" rx="2.2"/><path d="M6.6 8.4l2.1 1.6-2.1 1.6M10.6 12h3"/>',
    checks: '<circle cx="10" cy="10" r="6.5"/><path d="M7 10.2l2.1 2.1 4-4.3"/>',
    license: '<circle cx="7" cy="10" r="3.3"/><path d="M10.3 10h6.4M14.2 10v2.6M16.7 10v2"/>',
  };
  return `<svg class="set-ic" viewBox="0 0 20 20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? ""}</svg>`;
}

/** One Settings row: the name and what it does on the left, its control on the right. */
function setRow(label: string, desc: string, control = ""): string {
  return `<div class="set-row"><div class="set-t"><span class="set-l">${label}</span>${desc ? `<p class="set-d">${desc}</p>` : ""}</div>${control ? `<div class="set-c">${control}</div>` : ""}</div>`;
}

function settings(): string {
  if (st.pageError) return pageFailure("Settings");
  const s = st.settings;
  // A theme is a tile with a small picture of the app in it: the rail, a heading, two lines and the main button.
  // System shows both halves, light on the left, dark on the right.
  const preview = '<span class="tt-side"><i></i><i></i><i></i></span><span class="tt-main"><i class="tt-h"></i><i class="tt-l"></i><i class="tt-l"></i><i class="tt-pill"></i></span>';
  const tile = (v: Settings["theme"], label: string): string =>
    `<button class="theme-tile${s.theme === v ? " on" : ""}" aria-pressed="${s.theme === v}" data-act="theme" data-v="${v}"><span class="tt-prev tt-${v}" aria-hidden="true">${v === "system" ? `<span class="tt-half tt-light">${preview}</span><span class="tt-half tt-dark">${preview}</span>` : preview}</span><span class="tt-name">${label}</span></button>`;
  const sw = (key: "showGitDetails" | "reduceMotion", on: boolean, label: string): string => `<button class="switch ${on ? "on" : ""}" role="switch" aria-checked="${on}" aria-label="${esc(label)}" data-act="toggle" data-key="${key}"></button>`;
  const osCalm = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const iso = st.isolation;
  const network = !iso ? LOADING
    : iso.networkSandbox ? `When a project turns the network off for checks, ${esc(iso.networkSandbox)} blocks it.`
      : `Nothing on ${device()} can block the network during a check. A project that asks for no network gets Needs something, never Works.`;
  const sections: { id: string; group: string; label: string; title: string; intro: string; icon: string; body: string }[] = [
    { id: "appearance", group: "Preferences", label: "Appearance", title: "Appearance", intro: "How Time Machine looks on this computer. A change applies at once.", icon: "appearance", body:
      `<div class="set-row set-theme"><div class="set-t"><span class="set-l" id="theme-l">Theme</span><p class="set-d">System follows your computer’s light or dark setting.</p></div><div class="theme-tiles" role="group" aria-labelledby="theme-l">${tile("system", "System")}${tile("light", "Light")}${tile("dark", "Dark")}</div></div>`
      + setRow("Show Git details", "Adds save point IDs, commits, commands and logs next to the plain words. It never replaces them and never changes a verdict.", sw("showGitDetails", s.showGitDetails, "Show Git details"))
      + setRow("Reduce motion", `Nothing moves on its own: no breathing dot, no spinning dial, no gliding rows. A check still shows its progress. ${osCalm ? "Your computer already asks for less motion, so Time Machine stays still either way." : "When this is off, Time Machine follows your computer’s own Reduce motion setting."}`, sw("reduceMotion", s.reduceMotion, "Reduce motion")) },
    { id: "rewind", group: "Preferences", label: "Rewind style", title: "Rewind style", intro: "How going back to a save point looks. Both styles take the same steps.", icon: "rewind", body:
      setRow("Going back", "Simple shows the same steps as a plain sheet. With Reduce motion on, the dial does not spin. It moves straight to each save point.",
        `<div class="seg" role="group" aria-label="Going back"><button class="${s.simpleRewind ? "" : "on"}" aria-pressed="${!s.simpleRewind}" data-act="rewind-style" data-v="scene">Dial</button><button class="${s.simpleRewind ? "on" : ""}" aria-pressed="${s.simpleRewind}" data-act="rewind-style" data-v="sheet">Simple</button></div>`) },
    ...st.projects.map((p) => ({ id: `features:${p.id}`, group: "Projects", label: esc(p.name), title: esc(p.name), intro: "Its check, when it saves, and optional extras.", icon: "project", body: `<div class="mount" data-mount="features:${esc(p.id)}"></div>` })),
    { id: "local", group: "Time Machine", label: "Local browser app", title: "Local browser app", intro: "Time Machine runs in your browser, served from this computer.", icon: "local", body:
      `<div class="browser-capabilities"><p class="set-p">Your projects, saves, checks and recovery run on this computer through <span class="mono">tm ui</span>. Keep it running in your terminal.</p><p class="set-p muted">Keyboard shortcuts in this tab still work where your browser allows them. Every action is also available from the controls or Jump to.</p></div>` },
    { id: "checks", group: "Time Machine", label: "Checks", title: "Checks", intro: "Where your checks run and what they can reach.", icon: "checks", body:
      setRow("Where checks run", `In a copy on ${device()}, never in your folder. Checks use the tools installed on ${device()}.${s.showGitDetails ? ' <span class="mono muted">Basic isolation (host mode): a separate Git worktree.</span>' : ""}`)
      + setRow("Network during checks", network)
      + `<p class="set-planned"><span class="planned">Planned</span> Stronger isolation with Docker or Apple container.</p>` },
    { id: "license", group: "Time Machine", label: "Plan and license", title: "Plan and license", intro: "What your plan covers on this computer.", icon: "license", body:
      setRow("Your plan", esc(st.license.status.active ? "License active on this computer. Add as many projects as you like." : `Free: ${st.projects.length} of ${plural(st.license.status.freeProjectLimit, "project")}. Every restore stays free.`), '<button class="btn" data-act="plan">Open Plan</button>') },
  ];
  if (!sections.some((x) => x.id === settingsSection)) settingsSection = "appearance";
  const nav = sections.map((x, i) => `${x.group !== sections[i - 1]?.group ? `<p class="set-g">${x.group}</p>` : ""}<button class="set-it${x.id === settingsSection ? " on" : ""}" data-act="settings-section" data-v="${esc(x.id)}"${x.id === settingsSection ? ' aria-current="true"' : ""}>${setIcon(x.icon)}<span>${x.label}</span></button>`).join("");
  const body = sections.map((x, i) => `<section class="set-sec${x.id === settingsSection ? " on" : ""}" aria-labelledby="set-h-${i}"><h2 class="set-h" id="set-h-${i}" tabindex="-1">${x.title}</h2><p class="set-intro">${esc(x.intro)}</p>${x.body}</section>`).join("");
  return `<div class="page set-page"><div class="set-grid">
    <nav class="set-nav" aria-label="Settings sections"><h1 tabindex="-1">Settings</h1>${nav}</nav>
    <div class="set-body">${body}</div>
  </div></div>`;
}

/** Saves a key on this computer. Returns the engine's reason when it refuses the key, else null. The reason is also held
 *  under the key field; st.license is read again after the call, so nothing writes to the object that was current before it. */
async function applyLicense(key: string): Promise<string | null> {
  st.license = { ...st.license, working: true, error: null };
  render();
  let outcome: { status: LicenseStatus } | { error: string };
  try {
    outcome = { status: await api({ method: "setLicense", key }) };
  } catch (e) {
    outcome = { error: msg(e) };
  }
  st.license = licenseAfterSave(st.license, outcome);
  if ("error" in outcome) return outcome.error;
  toast("License saved on this computer.");
  return null;
}

async function saveLicense(): Promise<void> {
  const key = st.license.draft.trim();
  if (!key) {
    st.license.error = "Paste the key from your purchase page first. It starts with TM1.";
    render();
    root.querySelector<HTMLInputElement>("#license-key")?.focus();
    return;
  }
  await applyLicense(key);
  render();
  // The field and its button were disabled while saving, and on success they are gone: focus lands on License itself.
  root.querySelector<HTMLElement>(st.license.error ? "#license-key" : "#license-h")?.focus();
}

/** Use this key, from the keys the site lists for the signed-in email. The key goes straight to the engine, never into a field. */
async function useAccountKey(id: string): Promise<void> {
  const key = st.account.account?.licenses.find((k) => k.id === id)?.key;
  if (!key) return;
  st.account = { ...st.account, error: null };
  const error = await applyLicense(key);
  // The site's key is never in the field, so its refusal is said in the sign-in panel only.
  st.license = { ...st.license, error: null };
  st.account = { ...st.account, error };
  render();
  root.querySelector<HTMLElement>(error ? "#signin-h" : "#license-h")?.focus();
}

/** Send code: the site emails a six digit code to that address. */
async function sendSignInCode(): Promise<void> {
  const email = st.account.email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    st.account = { ...st.account, step: "email", error: "Type the email you bought the license with." };
    render();
    root.querySelector<HTMLInputElement>("#signin-email")?.focus();
    return;
  }
  st.account = { ...st.account, email, working: true, error: null };
  render();
  try {
    await api({ method: "signIn", email });
    st.account = { ...st.account, step: "code", code: "", working: false, sentAt: Date.now() };
  } catch (e) {
    st.account = { ...st.account, working: false, error: msg(e) };
  }
  render();
  root.querySelector<HTMLInputElement>(st.account.step === "code" ? "#signin-code" : "#signin-email")?.focus();
}

/** Sign in: the code for a session the server holds in memory, then the keys bought with that email. */
async function verifySignIn(): Promise<void> {
  const code = st.account.code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) {
    st.account = { ...st.account, error: "The code is the 6 digits in the email we sent." };
    render();
    root.querySelector<HTMLInputElement>("#signin-code")?.focus();
    return;
  }
  st.account = { ...st.account, code, working: true, error: null };
  render();
  try {
    await api({ method: "verifyCode", email: st.account.email, code });
    const account = await api({ method: "accountLicenses" });
    st.account = account
      ? { ...st.account, step: "keys", code: "", working: false, account }
      : { ...st.account, step: "email", code: "", working: false, error: "Sign-in ended before your keys could be read. Send a new code." };
  } catch (e) {
    st.account = { ...st.account, working: false, error: msg(e) };
  }
  render();
  root.querySelector<HTMLElement>(st.account.step === "keys" ? "#signin-h" : st.account.step === "code" ? "#signin-code" : "#signin-email")?.focus();
}

async function removeLicenseKey(): Promise<void> {
  st.license = { ...st.license, working: true, error: null };
  render();
  try {
    st.license = { status: await api({ method: "removeLicense" }), draft: "", working: false, error: null };
    toast("License removed from this computer.");
  } catch (e) {
    st.license = { ...st.license, working: false, error: msg(e) };
  }
  render();
  root.querySelector<HTMLElement>(st.license.error ? "#license [data-act=license-remove]" : "#license-h")?.focus();
}

function onboarding(): string {
  const o = st.onboarding;
  const purpose = o.purpose ?? "code";
  let body = "";
  if (o.step === 1) {
    const full = addFull();
    body = `${full ? addFullCard(st.license.status.freeProjectLimit) : ""}${purposeCards(o.purpose, o.working || full)}
      <div class="row-btns ob-acts"><button class="btn ghost" data-act="ob-cancel">Cancel</button><button class="btn link" data-act="demo">Try the demo instead</button></div>`;
  } else if (o.step === 2) {
    // Path errors are said under the field (the engine's own sentences: a file, not there, empty); the free limit keeps its card above.
    const err = o.error && !freeLimitHit(o.error) ? o.error : null;
    const pick = st.boot.platform === "darwin" ? `<button type="button" class="btn" data-act="ob-pick" ${o.working ? "disabled" : ""}>Choose a folder…</button>` : "";
    const example = st.boot.platform === "win32" ? "C:\\Users\\you\\project" : purpose === "code" ? "~/projects/my-app" : purpose === "research" ? "~/Research/trial-3" : "~/Documents/Thesis";
    body = `<div><p class="ad-chose">${purposeIcon(purpose, "sm")}<span>${esc(PURPOSES[purpose].label)}</span></p><h1>Which folder?</h1><p class="lede">${esc(pathLede(purpose))}</p></div>
      <div class="panel"><form id="local-project-form" class="path-form" data-form="local-project" aria-busy="${o.working}" novalidate>
        <label for="local-project-path">Folder</label>
        <div class="path-in"><input id="local-project-path" class="field" data-model="ob-path" type="text" value="${esc(o.path ?? "")}" placeholder="${esc(example)}" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="4096" aria-describedby="local-project-help${err ? " onboarding-path-error" : ""}" aria-invalid="${!!err}" ${o.working ? "disabled" : ""}>${pick}</div>
        ${err ? `<p id="onboarding-path-error" class="path-err" role="alert">${esc(err)}</p>` : ""}
        <p id="local-project-help" class="small muted">${pick ? "Choose it, or type its path." : "Type its path."} <span class="mono">~</span> is your home folder.</p>
        <div class="row-btns"><button type="submit" class="btn dark" ${o.working ? "disabled" : ""}>${o.working ? "Reading the folder…" : "Next"}</button><button type="button" class="btn ghost" data-act="ob-back" ${o.working ? "disabled" : ""}>Back</button>${o.working ? '<span class="spin" role="status" aria-label="Reading the folder"></span>' : ""}</div>
      </form>
      <p class="small muted">${esc(pathSetupNote(purpose))}</p></div>`;
  } else if (o.step === 3 && o.preview) {
    const pv = o.preview;
    const p = o.project ?? { ...pv, purpose };
    const copy = checkStepCopy(p.purpose, p.name);
    const code = p.purpose === "code";
    const ck = obCheck(o);
    const detected = ck.command;
    const build = buildOffered(p.purpose, pv.scripts, detected);
    const setup = ck.setup.trim();
    const optRow = (key: OnboardingState["choice"], title: string, cmd: string, rec: boolean, note = ""): string =>
      `<label class="opt ${o.choice === key ? "on" : ""}"><input type="radio" name="check" data-act="ob-choice" data-v="${key}" ${o.choice === key ? "checked" : ""}><span><div class="t">${esc(title)}</div>${cmd ? `<div class="d mono">${esc(cmd)}</div>` : ""}${note ? `<div class="d">${esc(note)}</div>` : ""}</span><span class="small muted">${rec ? "recommended" : ""}</span></label>`;
    const fv = o.tryResult && o.first && o.tryResult.checkpoint === o.first.id ? o.tryResult.verdict : null;
    const found = foundBefore(pv.existingSavePoints, p.purpose);
    const firstNote = o.first
      ? `<div class="first-sp">${glyph(fv)}<span><b>${pv.existingSavePoints ? "A new save point is made." : "Your first save point is made."}</b> ${fv ? `Checked: ${esc(verdictWord(fv))}.` : o.choice === "none" ? "It is saved on this computer." : "Saved, not checked. Try the check below to find out if it works."}</span></div>`
      : found ? `<div class="first-sp">${glyph(null)}<span><b>${esc(found)}</b> They stay, and new ones are added after them.</span></div>` : "";
    // A check already in the project's own timemachine.yml is emptied by this choice; it says so (Security B6).
    const skipRow = `<label class="opt ${o.choice === "none" ? "on" : ""}"><input type="radio" name="check" data-act="ob-choice" data-v="none" ${o.choice === "none" ? "checked" : ""}><span><div class="t">${esc(copy.skip.title)}</div><div class="d">${esc(skipNote(copy.skip.note, !!detected && !ck.created, p.kind))}</div></span><span class="small muted">${detected || code ? "" : "recommended"}</span></label>`;
    const placeholder = p.purpose === "research" ? "for example: python check_run.py" : code ? "for example: npm test" : "for example: ./check.sh";
    body = `<div><h1>${esc(copy.heading)}</h1><p class="mono ob-where sel-text">${esc(pv.path)}</p><p class="lede">${esc(copy.lede)} ${code || detected ? esc(checkLede({ verifyCommand: detected, created: ck.created }, build)) : ""}</p></div>
      ${firstNote}
      <div class="panel">
        ${code ? "" : skipRow}
        ${detected ? optRow("detected", detected === "npm run build" ? "Build it" : "Run the tests", detected, true, checkSource(detected, ck.created)) : ""}
        ${build ? optRow("build", "Build it", "npm run build", false) : ""}
        <label class="opt ${o.choice === "custom" ? "on" : ""}"><input type="radio" name="check" data-act="ob-choice" data-v="custom" ${o.choice === "custom" ? "checked" : ""}><span style="display:grid;gap:6px"><div class="t" id="ob-custom-label">My own command</div><input class="field" data-model="ob-custom" aria-labelledby="ob-custom-label" aria-describedby="ob-custom-hint" placeholder="${esc(placeholder)}" value="${esc(o.custom)}" autocomplete="off" autocapitalize="none" spellcheck="false"><div class="d" id="ob-custom-hint">Any command that ends without an error when ${code ? "your project works, like npm test or pytest" : "a version is good, like a script that runs your analysis"}.</div></span><span></span></label>
        ${code ? skipRow : ""}
        ${o.choice === "none" ? "" : `${setup ? `<p class="small muted">Installs first with <span class="mono">${esc(setup)}</span>, then runs the check.</p>` : ""}
        <p class="small muted">Checks run in a copy, never in your folder.${ck.network === "deny" ? " The internet is off during checks." : ` The internet stays on during checks on ${device()}, because no sandbox was found.`}</p>
        <div class="row-btns"><button class="btn" data-act="ob-try" ${o.trying || o.working ? "disabled" : ""}>${o.trying ? "Checking…" : "Try it now"}</button>
          ${o.trying ? '<span class="spin"></span>' : o.tryResult ? `${badge(o.tryResult.verdict, stampOnce(`ob:${o.tryResult.at}`))}<span class="small muted">${reasonHtml(o.tryResult.reason)} ${esc(seconds(o.tryResult.durationMs))}</span>` : ""}</div>
        ${o.tryResult && o.tryResult.verdict === "FAIL" ? `<div class="note">It doesn’t pass right now. That’s OK. We’ll save it as Broken, and the next version that passes becomes your first working save point.</div>` : o.project || o.trying ? "" : `<p class="small muted">${esc(`Try it now adds ${p.name} to Time Machine and saves a version to check. Back takes it out again.`)}</p>`}
        ${o.tryResult && !o.tryResult.stopped ? verdictTip() : ""}`}
      </div>
      <div class="row-btns ob-acts"><button class="btn dark" data-act="ob-next2" ${o.working || o.trying ? "disabled" : ""}>Next: when to save</button><button class="btn ghost" data-act="ob-back" ${o.working || o.trying ? "disabled" : ""}>Back</button></div>`;
  } else if (o.step === 4 && o.preview) {
    // A plain folder gets no Claude Code lines (the engine refuses them there); it chooses only when to save.
    const folder = o.preview.kind === "folder";
    const h = folder ? null : o.hook;
    const a = folder ? hookStepActions(null, false) : hookStepActions(h, !!o.hookDone);
    body = `<div><h1>When should we save?</h1><p class="lede">Save points are cheap. More of them means a closer way back.${folder ? " Save now always works too." : ""}</p></div>
      <div class="panel">${folder ? folderWhenChoices(o.autoSave, keys("Mod+S")) : `
        <label class="opt on"><input type="checkbox" checked disabled><span><div class="t">When I press Save now</div><div class="d">Always on. ${esc(keys("Mod+S"))} in the app, or choose Save now from More actions.</div></span><span></span></label>
        <div class="opt"><span></span><span><div class="t">Before and after each Claude Code turn, and before risky commands</div><div class="d">Saves before each prompt and right before risky commands like rm -rf or git reset --hard. For mv or sed -i, go back to the save point from before that prompt. ${h?.plugin ? "The Time Machine plugin is already on in Claude Code, so nothing is added here. Choosing the check in the last step approved it on this computer, so the plugin runs that check in this project." : "We add three lines to Claude Code’s settings for this project. You can also do this later from Agents."}</div>
          ${h && !h.plugin ? hookLines(h) : ""}
          ${o.hookDone ? `<div class="note" style="margin-top:8px">${esc(o.hookDone)}</div>` : o.hookError ? `<div class="note warn" style="margin-top:8px">We couldn’t prepare the lines: ${esc(o.hookError)} You can finish now and connect later from Agents.</div>` : h && !h.plugin && !h.runs ? `<div class="note bad" style="margin-top:8px">${esc(hookNotRunning)}</div>` : ""}</span><span class="small muted">${h?.plugin ? "on" : "recommended"}</span></div>
        ${autoSaveRow(o.autoSave)}`}
      </div>
      <div class="row-btns ob-acts"><button class="btn dark" data-act="${a.primary.act}" ${o.working ? "disabled" : ""}>${o.working ? "Finishing…" : esc(a.primary.label)}</button>${a.skip ? `<button class="btn" data-act="ob-finish" ${o.working ? "disabled" : ""}>${esc(a.skip)}</button>` : ""}<button class="btn ghost" data-act="ob-back" ${o.working ? "disabled" : ""}>Back</button></div>`;
  }
  return `<div class="page ob-page"><div class="col narrow">
    ${steps(o.step, [...ADD_STEPS])}
    ${o.error ? (freeLimitHit(o.error) ? freeLimitCard() : o.step === 2 ? "" : `<div id="onboarding-error" class="note bad" role="alert">${esc(o.error)}</div>`) : ""}
    ${body}</div></div>`;
}

/** The engine refused a project because the free app is full (engine.ts addProject). Only that refusal, never a path error. */
function freeLimitHit(error: string): boolean {
  const l = st.license.status;
  return !l.active && st.projects.length >= l.freeProjectLimit && /lists up to \d+ projects/.test(error);
}

/** The free plan lists as many projects as it can: the Protect buttons and step 1 say so before anything is picked. */
function addFull(): boolean {
  const l = st.license.status;
  return !l.active && st.projects.length >= l.freeProjectLimit;
}

/** The check the Add flow works from: what setup gave once the project is added, else what the preview says it would give. */
function obCheck(o: OnboardingState): { command: string; setup: string; network: "allow" | "deny"; created: boolean } {
  if (o.init) return { command: o.init.verifyCommand, setup: o.init.verifySetup, network: o.init.network, created: o.init.created };
  const c = o.preview?.check;
  return { command: c?.command ?? "", setup: c?.setup ?? "", network: c?.network ?? "allow", created: !c?.exists };
}

/** The free limit is not an error in the work: a sky card with the plan, its one button, and where a key goes. Fixed text. */
function freeLimitCard(): string {
  const limit = st.license.status.freeProjectLimit;
  return `<div id="onboarding-error" class="limit-card" role="alert">${buddy("big")}<div class="limit-t">
    <h2 class="limit-big" id="limit-h" tabindex="-1">The free app lists up to ${esc(plural(limit, "project"))}.</h2>
    <p>Remove one in Storage to add another. A license, $50 once, lifts that limit. If you already have a key, paste it on Plan. Every restore stays free.</p>
    <div class="row-btns"><button class="btn" data-act="storage">Open Storage</button><button class="btn" data-act="license-buy">See pricing</button><button class="btn link" data-act="plan">Paste a key</button></div>
  </div></div>`;
}

function hookSheet(): string {
  const h = st.hookSheet;
  if (!h) return "";
  const p = st.projects.find((x) => x.id === h.projectId);
  return `<div class="scrim ${once("scrim:hook")}" data-leave="hook"><div class="sheet hook" role="dialog" aria-modal="true" aria-label="Connect Claude Code">
    <div class="hook-head">${agentMark("Claude Code")}<h2>Connect Claude Code to ${esc(p?.name ?? "this project")}?</h2></div>
    <p>We’ll add these lines to Claude Code’s settings for this project and keep everything already there:</p>
    ${hookLines(h.preview)}
    <p class="small muted">Claude Code will then save before each prompt and before risky commands, and check after each turn. If a turn breaks a working version, Claude is told.</p>
    ${!h.preview.runs && !h.done ? `<div class="note bad">${esc(hookNotRunning)}</div>` : ""}${h.error ? `<div class="note bad" role="alert">${esc(h.error)}</div>` : ""}${h.done ? `<p class="hook-done" role="status">${esc(h.done)}</p>` : ""}
    <div class="row-btns ck-acts"><button class="btn quiet" data-act="hook-close">${h.done ? "Done" : "Cancel"}</button>${h.done || !h.preview.runs ? "" : `<button class="btn dark" data-act="hook-do" ${h.working ? "disabled" : ""}>Add these lines</button>`}</div>
  </div></div>`;
}

function confirmView(): string {
  const c = st.confirm;
  if (!c) return "";
  return `<div class="scrim confirm-scrim ${once("scrim:confirm")}" data-leave="confirm"><div class="sheet confirm" role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body">
    <h2 id="confirm-title">${keepTimes(esc(c.title))}</h2>
    <p id="confirm-body">${esc(c.body)}</p>
    <div class="row-btns">${c.act === "whole-folder" ? `<button class="btn dark" data-act="whole-pick">${st.boot.platform === "darwin" ? "Choose a folder…" : "Type a smaller folder"}</button><button class="btn" data-act="confirm-do">${esc(c.action)}</button>` : confirmButtons(c.action)}</div>
  </div></div>`;
}

/** The hook lines in plain words. The exact lines, with their long command paths, open with Git details or on request, in the
 *  terminal panel the check's own output uses: they are what Claude Code will run. */
function hookLines(h: HookPreview): string {
  const words: { [event: string]: string } = { UserPromptSubmit: "Before each prompt: save", "PreToolUse (Bash)": "Before a risky command: save", Stop: "When a turn ends: save, then check" };
  return `<ul class="hook-words">${h.lines.map((l) => `<li>${esc(words[l.event] ?? l.event)}</li>`).join("")}</ul>
    <details class="hook-exact" ${st.settings.showGitDetails ? "open" : ""}><summary>Show the exact lines</summary><div class="cw-o"><div class="cw-oh"><span>In <span class="mono sel-text">${esc(h.settingsPath)}</span></span></div><pre class="cw-out">${esc(h.lines.map((l) => `${l.event}: ${l.command}`).join("\n"))}</pre></div></details>`;
}

/** Where focus goes back to when the Inspector closes. On a wide window it is not a dialog, so nothing else returns it. */
let inspectorReturn: string | null = null;
function toggleInspector(open = !st.inspector): void {
  if (open && !st.inspector) inspectorReturn = focusKey();
  const wasInside = !!document.activeElement?.closest(".drawer");
  const fromDetail = !!document.activeElement?.closest(".rcol.detail");
  st.inspector = open;
  render();
  if (open) {
    // Opened from the detail's own link: focus follows into the Inspector. Mod+I from elsewhere leaves it where it is.
    if (fromDetail) root.querySelector<HTMLElement>('[data-leave="inspector"] [data-act="inspector"]')?.focus({ preventScroll: true });
    return;
  }
  if (!inspectorReturn || !(wasInside || document.activeElement === document.body)) return;
  const back = [...root.querySelectorAll<HTMLElement>(inspectorReturn)].find((el) => el.getClientRects().length > 0 && !el.closest("[inert], .leave"));
  back?.focus({ preventScroll: true });
}

/** Close the save point's detail. When the focus was in it and is now lost, it goes back to that save point's row. */
function closeDrawer(): void {
  const id = st.selected;
  st.drawer = false;
  render();
  if (id && (!document.activeElement || document.activeElement === document.body)) root.querySelector<HTMLElement>(`#e-${CSS.escape(id)} .e-t`)?.focus({ preventScroll: true });
}

function inspector(): string {
  if (!st.inspector) return "";
  const rec = st.records[0];
  const c = entry(st.selected);
  const p = project();
  // A long result scrolls; the scroller takes focus and has a name, so the keyboard can read it.
  const block = (title: string, command: string | null, json: unknown): string => `<section class="insp-b" aria-label="${esc(title)}"><div class="kv"><span class="h">${esc(title)}</span></div>
    ${command ? `<pre class="code cmd">${esc(command)}</pre><div class="row-btns"><button class="btn quiet" data-act="copy" data-text="${esc(command)}">Copy as command</button></div>` : '<p class="small muted">No tm command for this. It is app only.</p>'}
    <pre class="code" tabindex="0" aria-label="${esc(`Engine result: ${title}`)}">${esc(JSON.stringify(json, null, 2))}</pre></section>`;
  // Narrow windows open it over the save point's full sheet, so there it is a dialog of its own (a div: aside can't be one).
  const tag = window.innerWidth < 1100 ? "div" : "aside";
  return `<${tag} class="drawer ${once("drawer")}" data-leave="inspector" ${tag === "div" ? 'role="dialog" aria-modal="true"' : ""} aria-label="Inspector"><header><h2>Inspector</h2><button class="btn quiet" data-act="inspector">Close<kbd>${esc(keys("Mod+I"))}</kbd></button></header>
    <div class="body">
      <p class="small muted">The raw engine result and the same action as a tm command. The app and the CLI call the same engine.</p>
      ${rec ? block(`Last action: ${rec.title} · ${when(rec.at)}`, rec.command, rec.json) : '<p class="muted">No actions yet. Press Save now or Check it works.</p>'}
      ${c && p ? savePointBlock(c, p) : ""}
      ${st.records.length > 1 ? `<div class="kv"><span class="h">Earlier</span>${st.records.slice(1, 8).map((r) => `<div class="mono small muted">${esc(when(r.at))} · ${esc(r.title)}</div>`).join("")}</div>` : ""}
    </div></${tag}>`;
}

/** The Inspector's view of one save point: the exact commit, its last check, and the same actions as tm commands. */
function savePointBlock(c: TimelineEntry, p: ProjectEntry): string {
  const vr = st.verifyResults.get(c.id) ?? st.storedChecks.get(storedKey(c)) ?? undefined;
  const newest = points().at(-1);
  const cmds: { label: string; call: Call }[] = [
    { label: "Check it", call: { method: "verify", projectId: p.id, id: c.id } },
    { label: "Open a copy", call: { method: "open", projectId: p.id, id: c.id } },
    { label: "Use this version", call: { method: "recover", projectId: p.id, id: c.id } },
    ...(newest && newest.id !== c.id ? [{ label: `Compare with ${newest.id}`, call: { method: "diff" as const, projectId: p.id, a: c.id, b: newest.id } }] : []),
  ];
  const rows = cmds
    .map(({ label, call }) => {
      const cmd = tmCommand(call, p.path) ?? "";
      return `<div class="cmdrow"><span class="small muted">${esc(label)}</span><pre class="code cmd">${esc(cmd)}</pre><button class="btn quiet" data-act="copy" data-text="${esc(cmd)}">Copy as command</button></div>`;
    })
    .join("");
  const check = vr
    ? `<div><span class="k">last check</span> ${esc(vr.verdict)} · exit ${esc(String(vr.exitCode))} · ${esc(seconds(vr.durationMs))} · ${esc(vr.isolation)} mode</div><div><span class="k">command</span> ${esc(vr.command)}</div>${vr.log ? `<div><span class="k">log</span> ${esc(vr.log)}</div>` : ""}`
    : `<div><span class="k">last check</span> ${c.verdict ? `${esc(c.verdict)} (check again to see its command and log here)` : "not checked yet"}</div>`;
  return `<section class="insp-b" aria-label="${esc(`Selected save point ${c.id}`)}"><div class="kv"><span class="h">Selected save point: ${esc(c.id)}</span></div>
    <div class="git"><div><span class="k">commit</span> ${esc(c.commit)}</div><div><span class="k">ref</span> refs/tm/${esc(c.id)}</div><div><span class="k">branch</span> ${esc(c.branch ?? "(detached)")}${c.dirty ? " · had uncommitted changes" : ""}</div><div><span class="k">trigger</span> ${esc(c.trigger)}${c.agent ? ` · agent ${esc(c.agent.name)}` : ""}</div>${check}</div>
    ${vr?.log ? `<div class="row-btns"><button class="btn quiet" data-act="reveal" data-path="${esc(vr.log)}">Show log</button><button class="btn ghost" data-act="copy" data-text="${esc(vr.log)}">Copy log path</button></div>` : ""}
    ${rows}
    <pre class="code" tabindex="0" aria-label="${esc(`Save point ${c.id} as JSON`)}">${esc(JSON.stringify(c, null, 2))}</pre></section>`;
}

function busyScrim(): string {
  if (!st.demoBusy) return "";
  return `<div class="scrim ${once("scrim:demo")}" data-leave="demo"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="demo-title" aria-describedby="demo-description" aria-busy="true">
    <h2 id="demo-title">Building the demo…</h2>
    <div class="steplist"><div class="r"><span class="spin" aria-hidden="true"></span><span id="demo-description">Making Marigold Tips in a temporary folder, then breaking it on purpose. The real engine checks each save point to find the newest one that passes. You choose whether to go back to it.</span></div></div>
    <p class="small muted">Your projects are not touched.</p></div></div>`;
}

// Motion helpers. The window is redrawn from state, so these carry movement across redraws.

/** Keys seen in the last draw. An entrance animation plays only the first time its key appears. */
let seenOnce = new Set<string>();
let drawOnce = new Set<string>();
/** When each entrance began, and the class that finds its element after a draw. A redraw while it still plays keeps the
 *  class and sets --in to the time already spent, so a sheet that is drawn again 50 ms after it opened carries on
 *  instead of jumping to its end. */
const onceIn = new Map<string, { at: number; tag: string }>();
let onceTags = 0;
function once(key: string, cls = "enter"): string {
  drawOnce.add(key);
  const now = performance.now();
  let e = onceIn.get(key);
  if (!seenOnce.has(key) || !e) {
    e = { at: now, tag: `in-${++onceTags}` };
    onceIn.set(key, e);
  }
  return now - e.at < ENTER_KEEP_MS ? `${cls} ${e.tag}` : "";
}
/** After a draw: each entrance still playing starts where it was. Entrances whose key left the screen are forgotten. */
function applyOnce(): void {
  const now = performance.now();
  for (const [key, e] of onceIn) {
    if (!seenOnce.has(key)) onceIn.delete(key);
    else if (now - e.at < ENTER_KEEP_MS) root.querySelectorAll<HTMLElement>(`.${e.tag}`).forEach((el) => el.style.setProperty("--in", `${Math.round(e.at - now)}ms`));
  }
}
/** The verdict stamp plays once, when a verdict is new on screen. */
function stampOnce(key: string): string {
  return once(`stamp:${key}`, "stamp");
}

/** Inline styles of elements marked data-carry, so a redraw can animate from where they were. */
const carried = new Map<string, string>();
/** Carried moves under way: a redraw in the middle of one resumes it rather than jumping to its end. */
const moving = new Map<string, { from: string; to: string; at: number }>();
/** The tail applyCarry adds to resume a move; a captured style drops it, so it stays the plain target. */
const RESUMED = /;transition-delay:-[\d.]+ms$/;
function captureCarry(): void {
  document.querySelectorAll<HTMLElement>("[data-carry]").forEach((el) => carried.set(el.dataset.carry ?? "", (el.getAttribute("style") ?? "").replace(RESUMED, "")));
}
function applyCarry(): void {
  // Reduced motion: the dial and playhead jump straight to the new save point; nothing spins or glides.
  if (reducedMotion()) return;
  const t = performance.now();
  const moves: [HTMLElement, string][] = [];
  document.querySelectorAll<HTMLElement>("[data-carry]").forEach((el) => {
    const key = el.dataset.carry ?? "";
    const before = carried.get(key);
    const now = el.getAttribute("style") ?? "";
    const m = moving.get(key);
    // Redrawn mid-move with the same target: the new element starts the move again with the time
    // already spent behind it, so it carries on from the same point of the same curve.
    if (m && m.to === now && before === now && t - m.at < parseFloat(getComputedStyle(el).transitionDuration) * 1000) {
      el.setAttribute("style", `${m.from};transition:none`);
      moves.push([el, `${now};transition-delay:${(m.at - t).toFixed(1)}ms`]);
      return;
    }
    if (before === undefined || before === now) return;
    moving.set(key, { from: before, to: now, at: t });
    el.setAttribute("style", `${before};transition:none`);
    moves.push([el, now]);
  });
  if (!moves.length) return;
  void document.body.offsetWidth;
  for (const [el, now] of moves) el.setAttribute("style", now);
}

/** When the Rewind last opened: the beats of its entry are timed from here. */
let sceneIn = -Infinity;
/** Entering the Rewind: the playhead glides in from Now on the right, and the dial turns back from the newest detent. */
function enterScene(): void {
  sceneIn = performance.now();
  carried.clear();
  moving.clear();
  carried.set("ph", "--x:100");
  carried.set("veil", "--x:100");
  carried.set("knob", "transform:rotate(135deg)");
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
  if (!(a instanceof HTMLElement) || a === document.body || a.closest(".mount")) return null;
  // A ⋯ menu item goes away with its menu, so what it opens returns focus to the ⋯ that opened the menu.
  const menu = !st.menu && a.closest(".mn-l") ? a.closest(".mn")?.querySelector<HTMLElement>(".mn-b")?.dataset.v : undefined;
  if (menu) return `.mn-b[data-v="${CSS.escape(menu)}"]`;
  if (a.dataset.act) {
    // Every data attribute that tells same-act controls apart: two switches share "toggle", Put it back rows share an id. The
    // phone bar's main button repeats an action the page also has, so it is told apart too (Design 9d76bd5 P2).
    const part = (k: "id" | "v" | "key" | "path"): string => (a.dataset[k] ? `[data-${k}="${CSS.escape(a.dataset[k] ?? "")}"]` : "");
    const bar = a.classList.contains("tb-main") ? ".tb-main" : ":not(.tb-main)";
    return `[data-act="${CSS.escape(a.dataset.act)}"]${part("id")}${part("v")}${part("key")}${part("path")}${bar}`;
  }
  if (a.dataset.model) return `[data-model="${CSS.escape(a.dataset.model)}"]`;
  if (a.id) return `#${CSS.escape(a.id)}`;
  // refocus() can leave focus on the page heading; it keeps it through redraws (Design re-check 83bce7a P2).
  if (a.matches("main h1")) return "main h1";
  if (a.classList.contains("knob")) return ".knob";
  if (a.classList.contains("hruler")) return ".hruler";
  return null;
}

/** After a sheet or panel closes: if focus fell to the page body (it was opened by a shortcut, so no control opened it), focus goes
 *  to the first visible control that opens it (`sel`), else to the page's heading. */
function refocus(sel: string): void {
  if (document.activeElement && document.activeElement !== document.body) return;
  const shown = (el: HTMLElement): boolean => el.getClientRects().length > 0 && !el.closest("[inert], .leave");
  const back = (sel ? [...root.querySelectorAll<HTMLElement>(sel)].find(shown) : undefined) ?? root.querySelector<HTMLElement>("main h1");
  if (back && !back.matches("button, a, input, select, textarea, [tabindex]")) back.tabIndex = -1;
  back?.focus({ preventScroll: true });
}
/** What opens Ask: its toolbar button, or ⋯ on a phone, where Ask sits in that menu. */
const ASK_BACK = ".toolbar .ask-t, .toolbar .mn-b";

/** Ask opened from its button or ⌘J. Beside the page (≥ 1100 px) focus goes into the column, as it does into a sheet: to the
 *  question field when it takes typing, else the column's heading. On a phone Ask is a dialog and takes focus itself. */
function focusAsk(): void {
  if (window.innerWidth < 1100) return;
  const field = root.querySelector<HTMLElement>(".ask-col textarea:not(:disabled)");
  (field ?? root.querySelector<HTMLElement>("#ask-h"))?.focus({ preventScroll: true });
}

/** The bar above every screen: where you are, Back to now when you are looking at the past, Ask, Check it works, and ⋯ for the rest.
 *  On phones it is the buddy, a project switcher that opens the rail, Jump to and ⋯; Ask and the shortcuts move into ⋯. */
function toolbar(): string {
  const p = project();
  const inProject = !!p && PROJECT_SCREENS.includes(st.screen);
  const page: { [K in Screen]: string } = { welcome: "Welcome", overview: "Overview", onboarding: "Protect a folder", history: "History", rewind: "History", compare: "What changed", agents: "Agents", storage: "Storage", settings: "Settings", plan: "Plan", sources: "Sources" };
  const crumb = inProject ? `<button class="cr-p" data-act="history">${esc(p.name)}</button><span aria-hidden="true">/</span><span>${esc(page[st.screen])}</span>` : `<span>${esc(page[st.screen])}</span>`;
  const newest = points().at(-1);
  const past = inProject && (st.screen === "compare" || (st.drawer && !!st.selected && st.selected !== newest?.id));
  const busy = st.busy ? "disabled" : "";
  // A folder that is gone has nothing to save or check: its page offers "It moved…" and "Bring back a copy…" instead.
  const tools = inProject && newest && !folderMissing(p)
    ? [
        `<button data-act="save" ${busy}>Save now<kbd>${esc(keys("Mod+S"))}</kbd></button>`,
        // A project with no check is never offered one: running it would store a verdict and turn the project into a checked one.
        ...(checksOn(p) ? [`<button data-act="check" ${busy}>Check it works<kbd>${esc(keys("Mod+Enter"))}</kbd></button>`, `<button data-act="find" ${busy}>Find the last working version</button>`] : []),
        `<button data-act="compare">Compare with now<kbd>${esc(keys("Mod+Shift+C"))}</kbd></button>`,
        `<button data-act="inspector">Open Inspector<kbd>${esc(keys("Mod+I"))}</kbd></button>`,
      ]
    : [];
  const phoneOnly = [
    '<button class="mn-phone" data-act="palette">Jump to…</button>',
    inProject ? `<button class="mn-phone" data-act="ask-toggle">${st.askOpen ? "Hide Ask" : "Ask"}</button>` : "",
    '<button class="mn-phone" data-act="keys">Keyboard shortcuts</button>',
  ];
  const more = menuButton("tools", "More actions", [...phoneOnly, ...tools], tools.length ? "" : "mn-phone-only");
  const ask = inProject ? `<button class="btn quiet ask-t${st.askOpen ? " on" : ""}" data-act="ask-toggle" aria-pressed="${st.askOpen}"><span>Ask</span><kbd class="kc">${esc(keys("Mod+J"))}</kbd></button>` : "";
  // The toolbar's Check it works steps aside when it is already the page's main button, and while a save point's detail
  // is open: the detail has its own Check it again, and the breadcrumb keeps its room. It stays in ⋯.
  const ready = inProject && !!newest && !folderMissing(p) && st.screen === "history" && !st.drawer;
  const checkFirst = ready && checksOn(p) && projectStatus(points()).primary.act !== "check";
  const check = checkFirst ? `<button class="btn tb-check" data-act="check" ${busy}>Check it works</button>` : "";
  // A phone keeps one action beside ⋯ (dev#36): Check it works, or Save now when checking is already the page's big button.
  const phoneMain = ready ? (checkFirst ? `<button class="btn tb-main" data-act="check" ${busy}>Check it works</button>` : `<button class="btn tb-main" data-act="save" ${busy}>Save now</button>`) : "";
  const v = p ? (st.statuses.get(p.id)?.newest?.verdict ?? null) : null;
  // The phone's project switcher names the project, so its accessible name starts with what it shows.
  const switcher = `<button class="nav-toggle" data-act="nav-toggle" aria-expanded="${st.navOpen}" ${st.navOpen ? 'aria-controls="mobile-navigation"' : ""}>${p ? `<span class="dot v-${verdictKey(v)}" aria-hidden="true"></span><span class="nt-n">${esc(p.name)}</span><span class="sr-only">, open projects</span>` : '<span class="nt-n">Projects</span>'}<svg class="chev" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  return `<div class="toolbar">${buddy("tb-buddy")}${switcher}<nav class="crumb" aria-label="Where you are">${crumb}</nav>
    ${past ? `<button class="pill" data-act="now">Back to now<kbd>${esc(keys("Mod+↑"))}</kbd></button>` : ""}
    <span class="tb-sp"></span>
    <button class="icon-b jump" data-act="palette" aria-label="Jump to…"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M11 11l3 3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button>${ask}${check}${phoneMain}${more}</div>`;
}

/** Everything "Jump to…" can reach: actions first, then projects, then recent save points. */
function paletteItems(): PaletteItem[] {
  const p = project();
  const pts = points();
  const lw = lastWorking();
  const newest = pts.at(-1);
  const items: PaletteItem[] = [];
  if (p && newest) {
    items.push({ group: "Actions", label: "Save now", hint: keys("Mod+S"), keycap: true, act: "save" });
    if (checksOn(p)) items.push({ group: "Actions", label: "Check it works", hint: keys("Mod+Enter"), keycap: true, act: "check" });
    if (lw && newest.verdict !== "PASS") items.push({ group: "Actions", label: goBackLabel(lw, points()), hint: "last working version", act: "rewind-to", id: lw.id });
    if (checksOn(p)) items.push({ group: "Actions", label: "Find the last working version", hint: "", act: "find" });
    items.push({ group: "Actions", label: lw ? `Compare ${versionPhrase(lw, points())} with now` : "Compare with now", hint: keys("Mod+Shift+C"), keycap: true, act: "compare", ...(lw ? { a: lw.id, b: "now" } : {}) });
  }
  items.push(
    { group: "Actions", label: "Overview", hint: "everything protected", act: "overview" },
    { group: "Actions", label: "Plan", hint: "free and license", act: "plan" },
    { group: "Actions", label: "Sources", hint: "folders and connectors", act: "sources" },
    { group: "Actions", label: "Agents", hint: "connections", act: "agents" },
    { group: "Actions", label: "Storage", hint: "space and clean up", act: "storage" },
    { group: "Actions", label: "Settings", hint: keys("Mod+,"), keycap: true, act: "settings" },
    reduceMotionItem(st.settings.reduceMotion),
    { group: "Actions", label: "Protect a folder", hint: keys("Mod+N"), keycap: true, act: "add" },
    { group: "Actions", label: "Show shortcuts", hint: "?", keycap: true, act: "keys" },
  );
  for (const x of st.projects) {
    const s = st.statuses.get(x.id);
    const checks = checksOn(x);
    const v = checks ? (s?.newest?.verdict ?? null) : null;
    items.push({ group: "Projects", label: x.name, hint: s?.problem ? "Can’t find it" : checks ? verdictWord(v) : saveState(s?.newest ?? null), act: "project", id: x.id, verdict: s?.problem ? "ERROR" : v });
  }
  // Save points go by the name they were given in their detail; a project with no check names no verdict.
  const checks = checksOn(project(), pts);
  for (const c of [...pts].reverse().slice(0, 12)) {
    items.push(savePointItem(c, ptWhen(c), title(c), st.notes.get(c.id), c.verdict === null && !checks ? "" : verdictWord(c.verdict)));
  }
  return items;
}

function paletteList(): string {
  const pal = st.palette;
  if (!pal) return "";
  const shown = filterPalette(paletteItems(), pal.q);
  // Nothing matches: the buddy and one sentence as a status, and no listbox at all, so a listbox is never empty.
  if (!shown.length) return `<div class="pal-none" role="status">${emptyState({ line: `Nothing matches “${pal.q}”.` })}</div>`;
  const groups: { name: string; rows: string[] }[] = [];
  shown.forEach((it, i) => {
    if (groups.at(-1)?.name !== it.group) groups.push({ name: it.group, rows: [] });
    const data = `${it.id ? ` data-id="${esc(it.id)}"` : ""}${it.a ? ` data-a="${esc(it.a)}"` : ""}${it.b ? ` data-b="${esc(it.b)}"` : ""}`;
    const hint = !it.hint ? "" : it.keycap ? `<kbd>${esc(it.hint)}</kbd>` : `<span class="pal-h">${esc(it.hint)}</span>`;
    // A save point's time and title are two parts, so a phone can give the title a line of its own (Design b7+8, P3-4).
    const label = it.title ? `<span class="pal-w">${esc(it.label)}</span><span class="pal-sep"> · </span><span class="pal-t">${esc(it.title)}</span>` : esc(it.label);
    groups.at(-1)!.rows.push(`<button class="pal-i${it.title ? " pal-sp" : ""}${i === pal.i ? " on" : ""}" id="pal-o${i}" role="option" aria-selected="${i === pal.i}" data-act="${it.act}"${data} data-pi="${i}">${it.verdict !== undefined ? glyph(it.verdict) : '<span class="pal-dot" aria-hidden="true"></span>'}<span class="pal-l">${label}</span>${hint}</button>`);
  });
  return `<div class="pal-lb" id="pal-lb" role="listbox" aria-label="Matching projects and actions">${groups
    .map((g, k) => `<div class="pal-sec" role="group" aria-labelledby="pal-g${k}"><div class="pal-g" id="pal-g${k}">${esc(g.name)}</div>${g.rows.join("")}</div>`)
    .join("")}</div>`;
}

/** The row the arrows are on, for the field's aria-activedescendant. None when nothing matches: there is no listbox then. */
function paletteActive(): string | null {
  const pal = st.palette;
  return pal && filterPalette(paletteItems(), pal.q).length ? `pal-o${pal.i}` : null;
}

/** Redraw Jump to's rows in place and keep the field pointing at the selected one, so a screen reader says each row the
 *  arrows reach while focus stays in the field (the WAI-ARIA combobox pattern). */
function drawPaletteList(): void {
  const list = root.querySelector(".pal-list");
  if (list) list.innerHTML = paletteList();
  const q = root.querySelector<HTMLInputElement>(".pal-q");
  if (!q) return;
  const active = paletteActive();
  q.setAttribute("aria-expanded", String(!!active));
  if (active) q.setAttribute("aria-activedescendant", active);
  else q.removeAttribute("aria-activedescendant");
}

function paletteView(): string {
  if (!st.palette) return "";
  // The field is a combobox over the listbox: expanded while there are rows, and pointing at the row the arrows are on.
  const active = paletteActive();
  return `<div class="scrim pal-scrim ${once("scrim:pal")}" data-leave="pal"><div class="pal" role="dialog" aria-modal="true" aria-label="Jump to">
    <div class="pal-top"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M11 11l3 3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg><input class="pal-q" data-model="pal" role="combobox" aria-expanded="${!!active}" aria-controls="pal-lb" aria-autocomplete="list"${active ? ` aria-activedescendant="${active}"` : ""} placeholder="Jump to a project, a save point or an action…" value="${esc(st.palette.q)}" aria-label="Jump to" autocomplete="off" spellcheck="false"></div>
    <div class="pal-list">${paletteList()}</div>
    <div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>Esc</kbd> close</span></div>
  </div></div>`;
}

/** Only shortcuts that work today. */
function keysSheetView(): string {
  if (!st.keysSheet) return "";
  const row = (k: string, what: string): string => `<div class="ks-r"><span class="ks-k">${k.split(" ").map((x) => `<kbd>${esc(keys(x))}</kbd>`).join("")}</span><span>${esc(what)}</span></div>`;
  return `<div class="scrim ${once("scrim:keys")}" data-leave="keys"><div class="sheet ks" role="dialog" aria-modal="true" aria-label="Shortcuts">
    <div class="sheet-head"><h2>Shortcuts</h2><button class="btn quiet" data-act="close-keys">Close<kbd>Esc</kbd></button></div>
    <div class="ks-cols">
      <div><h3 class="ks-h">Everywhere</h3>${row("Mod+K", "Jump to…")}${row("Mod+S", "Save now")}${row("Mod+Enter", "Check it works")}${row("Mod+Shift+R", "Go back to a working version")}${row("Mod+Shift+C", "Compare with now")}${row("Mod+↑", "Back to now")}${row("Mod+Z", "Undo the last rewind")}${row("Mod+J", "Show or hide Ask")}${row("Mod+N", "Add project")}${row("Mod+,", "Settings")}${row("Mod+I", "Inspector")}${row("?", "Show shortcuts")}</div>
      <div><h3 class="ks-h">History</h3>${row("↑ ↓", "Previous or next save point")}${row("Enter", "Open the save point")}${row("Space", "Go back to it")}${row("C", "Compare with now")}${row("Esc", "Close the save point")}
        <h3 class="ks-h">Going back</h3>${row("J L", "Turn the dial one save point")}${row("Shift+J Shift+L", "Next verdict change")}${row("T", "Try it first")}${row("C", "Compare with now")}${row("Enter", "Go back to it, or try it first if it is not proven")}${row("Mod+Enter", "The same, wherever focus is")}${row("Esc", "Back to now, no change")}</div>
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
    refocus('[data-act="palette"]');
  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    pal.i = n ? (pal.i + (e.key === "ArrowDown" ? 1 : n - 1)) % n : 0;
    drawPaletteList();
    root.querySelector(".pal-i.on")?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    root.querySelector<HTMLButtonElement>(".pal-i.on")?.click();
  } else return false;
  e.preventDefault();
  return true;
}

/** The page being drawn. A new page, or a new onboarding step, starts scrolled to the top. */
let drawnPage = "";

/** The Ask column: the frame is drawn here, the panel inside it by the Ask module, kept across redraws. */
function askColumn(): string {
  const p = project();
  if (!p) return "";
  const tag = window.innerWidth < 1100 ? "div" : "aside";
  return `<${tag} class="rcol ask-col ${once("ask-col")}" ${tag === "div" ? 'role="dialog" aria-modal="true"' : ""} aria-label="${esc(`Ask about ${p.name}`)}">
    <header class="rc-top"><h2 class="ask-h" id="ask-h" tabindex="-1">Ask</h2><span class="small muted ask-about">about ${esc(p.name)}</span><span class="tb-sp"></span><button class="btn ghost" data-act="ask-toggle" aria-label="Hide Ask">Hide<kbd>${esc(keys("Mod+J"))}</kbd></button></header>
    <div class="mount ask-mount" data-mount="ask:${esc(p.id)}"></div>
  </${tag}>`;
}

/** Feature panels drawn by their own modules. Each host is made once and moved between redraws, so its state survives. */
const mounts = new Map<string, { el: HTMLElement; cleanup: (() => void) | null }>();

function mountFeature(key: string, el: HTMLElement): (() => void) | null {
  const [kind, projectId = ""] = key.split(":");
  if (kind === "ask") return renderAskPanel(el, { projectId, api: bridge, onCite: cite, onOpenSettings: () => void openAskSettings(projectId) });
  if (kind === "unlinked") return renderUnlinkedDeploys(el, projectId, bridge);
  if (kind === "features") return renderFeatureSettings(el, projectId, bridge);
  return null;
}

/** Settings > <project>, at its Ask row (dev#25). The row is drawn once the project's settings are read, so focus waits for it. */
async function openAskSettings(projectId: string): Promise<void> {
  settingsSection = `features:${projectId}`;
  await openPage("settings");
  const deadline = performance.now() + 3000;
  const land = (): void => {
    const row = root.querySelector<HTMLElement>(`#ft-ask-${CSS.escape(projectId)}`);
    if (row) {
      row.scrollIntoView({ block: "start" });
      row.focus({ preventScroll: true });
    } else if (performance.now() < deadline && st.screen === "settings") requestAnimationFrame(land);
  };
  land();
}

/** Put each kept host where its slot is, and give back focus and scroll positions the move took away. */
function placeMounts(focused: Element | null, scrolled: [HTMLElement, number][]): void {
  root.querySelectorAll<HTMLElement>("[data-mount]").forEach((slot) => {
    const key = slot.dataset.mount ?? "";
    let m = mounts.get(key);
    if (!m) {
      const el = document.createElement("div");
      el.className = slot.className;
      m = { el, cleanup: null };
      mounts.set(key, m);
      m.cleanup = mountFeature(key, el);
    }
    slot.replaceWith(m.el);
  });
  for (const [el, top] of scrolled) el.scrollTop = top;
  if (focused instanceof HTMLElement && focused.isConnected) focused.focus({ preventScroll: true });
}

/** Forget the feature hosts of a project that left the app. */
function dropMounts(projectId: string): void {
  for (const [key, m] of mounts) {
    if (!key.endsWith(`:${projectId}`)) continue;
    m.cleanup?.();
    mounts.delete(key);
  }
}

/** A citation from Ask: bring that entry into view and tint it briefly. It does not open anything. */
function cite(id: string): void {
  if (!entry(id)) return;
  if (st.screen !== "history") {
    st.screen = "history";
    st.rewind = null;
  }
  st.selected = id;
  st.lit = id;
  st.drawer = false;
  if (window.innerWidth < 1100) st.askOpen = false;
  render();
  document.getElementById(`e-${id}`)?.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
  setTimeout(() => {
    if (st.lit !== id) return;
    st.lit = null;
    document.getElementById(`e-${id}`)?.classList.remove("lit");
  }, 1400);
}

/** The page on screen and when it appeared. The Rewind sits over History, so it is the same page. */
let pageIn = { key: "", at: 0 };
/** When each project's journal first showed its rows. Rows rise in only that first time. */
const journalIn = new Map<string, number>();
/** When each project's History ruler first showed its beads. They pop in, left to right, only that first time. */
const rulerIn = new Map<string, number>();
/** The save point under the History playhead and when it got there: the bead it lands on settles in. */
let selIn: { id: string | null; at: number } = { id: null, at: -Infinity };
/** What each verdict mark (a bead, a row, the status) showed in the last draw, by project, and when one changed. */
const shownVerdicts = new Map<string, string>();
const verdictIn = new Map<string, number>();
/** Where the last press landed (the middle of what was pressed), and when. */
let lastPress = { x: 0, y: 0, at: -Infinity };
/** A page's blocks rise over this long; the bead the playhead lands on and the ruler's labels settle over these. */
const BLOCK_IN_MS = 300;
const SEL_IN_MS = 220;
const LABEL_IN_MS = 200;
/** Projects whose History has been drawn: a save point new to one of them arrives with a landing, the first draw does not. */
const verdictProjects = new Set<string>();

/** A verdict mark whose verdict differs from the last draw is noted, so its change plays once wherever it is drawn; so is
 *  a save point that arrives while its project is on screen (a save, a hook). While the check sheet is open its own card
 *  shows the verdict; the page's marks land when it closes and they show. */
function trackVerdicts(now: number): void {
  if (st.check) return;
  const pid = st.projectId ?? "";
  const known = verdictProjects.has(pid);
  const marks = root.querySelectorAll<HTMLElement>("[data-vid]");
  marks.forEach((el) => {
    const key = `${pid} ${el.dataset.vid ?? ""}`;
    const v = el.dataset.v ?? "";
    const was = shownVerdicts.get(key);
    if (was === undefined ? known : was !== v) verdictIn.set(key, now);
    shownVerdicts.set(key, v);
  });
  if (marks.length) verdictProjects.add(pid);
}

/**
 * A new page fades in and its blocks rise one after another; a project's journal rows and its ruler's beads come in
 * one after another, once. The bead under the playhead settles when the playhead lands; a verdict that changed lands
 * once. A sheet, menu or column that opens from a press grows from where the press was. Redraws continue all of it.
 */
function applyEntrances(scene: boolean): void {
  const now = performance.now();
  const key = `${st.screen === "rewind" ? "history" : st.screen}:${st.screen === "onboarding" ? st.onboarding.step : ""}:${PROJECT_SCREENS.includes(st.screen) ? (st.projectId ?? "") : ""}`;
  if (key !== pageIn.key) pageIn = { key, at: now };
  // Noted under Reduce motion too, so a change seen then never plays later.
  trackVerdicts(now);
  if (st.selected !== selIn.id) selIn = { id: st.selected, at: now };
  if (reducedMotion()) return;
  const enter = (el: HTMLElement, cls: string, delay: number | null): void => {
    if (delay === null) return;
    el.classList.add(cls);
    el.style.animationDelay = `${delay}ms`;
  };
  const sincePage = now - pageIn.at;
  const page = root.querySelector<HTMLElement>(".main > .toolbar + *");
  // The page's own blocks: History's status, ruler, journal..., the sections of Agents and Storage. A feature host keeps its state, so it stays still.
  const blocks = page ? [...page.querySelectorAll<HTMLElement>(":scope > .doc > *, :scope > .b9 > *")].filter((el) => !el.classList.contains("mount")) : [];
  if (page) enter(page, blocks.length ? "page-fade" : "page-in", entranceDelay(0, sincePage, PAGE_IN_MS));
  const startOf = (el: Element | null): number => {
    const i = el ? blocks.indexOf(el as HTMLElement) : -1;
    return i < 0 ? 0 : Math.min(i, BLOCK_STAGGER_MAX) * BLOCK_STAGGER_MS;
  };
  // The journal's rows rise themselves, so the journal block does not.
  blocks.forEach((el, i) => {
    if (el.id !== "list") enter(el, "block-in", blockDelay(i, sincePage, BLOCK_IN_MS));
  });
  if (!st.projectId || scene) return;
  // An entrance that starts with its block: offset by the block's turn, unless the part came in after the page did.
  const after = (since: number, block: Element | null): number => Math.max(0, startOf(block) - (since - pageIn.at));
  const rows = root.querySelectorAll<HTMLElement>("#list > .day, #list > .list > *");
  if (rows.length) {
    const since = journalIn.get(st.projectId) ?? now;
    journalIn.set(st.projectId, since);
    const t = now - since - after(since, root.querySelector("#list"));
    rows.forEach((row, i) => enter(row, "row-in", rowDelay(i, t)));
  }
  const ruler = root.querySelector<HTMLElement>(".hruler");
  if (ruler) {
    const since = rulerIn.get(st.projectId) ?? now;
    rulerIn.set(st.projectId, since);
    const t = now - since - after(since, ruler.closest(".rwell"));
    const beads = [...ruler.querySelectorAll<HTMLElement>(".rt-tk")];
    const base = ruler.querySelector<HTMLElement>(".base");
    if (base) enter(base, "base-in", entranceDelay(0, t, BEAD_IN_MS + 160));
    beads.forEach((b, i) => enter(b, "tk-in", beadDelay(i, t)));
    const labelsAt = beads.length ? (beadDelay(beads.length - 1, 0) ?? 0) + 80 : 0;
    ruler.querySelectorAll<HTMLElement>(".rlab, .lwflag, .lane").forEach((el) => enter(el, "lab-in", entranceDelay(labelsAt, t, LABEL_IN_MS)));
    const on = ruler.querySelector<HTMLElement>(".rt-tk.on");
    if (on && selIn.at > since + 50) enter(on, "tk-sel", entranceDelay(0, now - selIn.at, SEL_IN_MS));
  }
  root.querySelectorAll<HTMLElement>("[data-vid]").forEach((el) => {
    const at = verdictIn.get(`${st.projectId ?? ""} ${el.dataset.vid ?? ""}`);
    const delay = at === undefined ? null : entranceDelay(0, now - at, VERDICT_MS);
    if (delay === null) return;
    el.classList.add("v-land");
    el.style.setProperty("--vd", `${delay}ms`);
  });
  if (now - lastPress.at < 700) {
    root.querySelectorAll<HTMLElement>(".scrim.enter > .sheet, .scrim.enter > .pal, .rcol.enter, .drawer.enter, .mn-l.enter").forEach((el) => {
      const r = el.getBoundingClientRect();
      el.style.transformOrigin = `${Math.round(lastPress.x - r.left)}px ${Math.round(lastPress.y - r.top)}px`;
    });
  }
}

/** A sheet, the Rewind, the Inspector or a toast that was on screen, and where it sat. */
interface Leaving {
  el: HTMLElement;
  parent: ".main" | ".app";
}

/**
 * What closed fades out. The old element stays for a moment over the new draw, inert and not
 * clickable, so nothing waits for it. Web animations keep their time when a later redraw moves
 * the element again, so a fade is never restarted or cut.
 */
function placeLeaving(old: Leaving[]): void {
  for (const { el, parent } of old) {
    const host = root.querySelector(parent);
    if (!host) continue;
    if (!el.classList.contains("leave")) {
      if (reducedMotion() || root.querySelector(`[data-leave="${CSS.escape(el.dataset.leave ?? "")}"]:not(.leave)`)) continue;
      el.classList.remove("enter");
      el.classList.add("leave");
      el.inert = true;
      el.setAttribute("aria-hidden", "true");
      const timing: KeyframeAnimationOptions = { duration: LEAVE_MS, easing: "cubic-bezier(.22,1,.36,1)", fill: "forwards" };
      const sheet = el.querySelector<HTMLElement>(":scope > .sheet, :scope > .pal");
      sheet?.animate([{ transform: "none" }, { transform: "scale(.97)" }], timing);
      const to = el.classList.contains("drawer") ? "translateX(24px)" : "none";
      el.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: to }], timing).onfinish = () => el.remove();
    }
    host.append(el);
  }
}

/**
 * The running check's clock: one text update a second while a check runs, without a redraw. It stops when the check
 * ends. The same tick reads the end of the check's log so far (the engine writes it as the check prints) and puts the
 * lines in place, so the sheet shows what the check is doing without redrawing while it runs.
 */
let checkClock: number | null = null;
let liveTailBusy = false;
function tickCheckClock(): void {
  const running = !!st.check && st.check.phase !== "done" && !st.check.error;
  if (running && checkClock === null) {
    checkClock = window.setInterval(() => {
      const el = root.querySelector(".ck-el");
      if (el && st.check) el.textContent = elapsed(Date.now() - st.check.startedAt);
      void liveTail();
    }, 1000);
  } else if (!running && checkClock !== null) {
    window.clearInterval(checkClock);
    checkClock = null;
  }
}

/** The time a check log's name carries (`cp-0001-2026-10-25T19-01-02-003Z.log`), or null when the name is not one. */
export function logStamp(path: string): number | null {
  const m = /-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.log$/.exec(path);
  if (!m) return null;
  return Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
}

/**
 * One read of the running check's log end, shown in the sheet's live block. Skipped while a read is still out. An
 * earlier run's log of the same save point is not this run's: only a log stamped after this check began is shown.
 */
async function liveTail(): Promise<void> {
  const c = st.check;
  const p = project();
  if (liveTailBusy || !c || !p || c.phase !== "checking" || !c.cp) return;
  liveTailBusy = true;
  try {
    const r = await bridge.call({ method: "checkLogTail", projectId: p.id, id: c.cp });
    if (st.check !== c || c.phase !== "checking" || !r.ok || !r.data || r.data.binary || r.data.hidden || !r.data.lines.length) return;
    const at = logStamp(r.data.log);
    if (at === null || at < c.startedAt - 60_000) return;
    // Kept in the state, so a redraw while the check runs shows the same lines instead of an empty block.
    c.live = r.data.lines;
    const pre = root.querySelector<HTMLElement>(".ck-live pre");
    const phase = root.querySelector(".ck-ph");
    if (phase) phase.textContent = checkPhase(c);
    // The first lines draw the block (it rises in once); later ones change its text in place, kept at the newest line.
    if (!pre) return render();
    pre.textContent = r.data.lines.join("\n");
    pre.scrollTop = pre.scrollHeight;
  } finally {
    liveTailBusy = false;
  }
}

/** While Send a new code waits out the site's limit, its count goes down each second in place. At 0 the button is enabled in
 * place too: a redraw would move the caret in the code field while the visitor is typing (Design P2). */
let resendClock: number | null = null;
function tickResendClock(): void {
  const waiting = st.screen === "plan" && st.account.step === "code" && resendWait(st.account.sentAt, Date.now()) > 0;
  if (waiting && resendClock === null) {
    resendClock = window.setInterval(() => {
      const left = resendWait(st.account.sentAt, Date.now());
      const el = root.querySelector<HTMLButtonElement>('[data-act="signin-resend"]');
      if (el) {
        el.textContent = resendLabel(left);
        if (!left) el.disabled = st.account.working;
      }
      if (!left) tickResendClock();
    }, 1000);
  } else if (!waiting && resendClock !== null) {
    window.clearInterval(resendClock);
    resendClock = null;
  }
}

function render(): void {
  const pageKey = `${st.screen}:${st.screen === "onboarding" ? st.onboarding.step : ""}`;
  const pageScroll = pageKey === drawnPage ? (document.querySelector(".page")?.scrollTop ?? 0) : 0;
  drawnPage = pageKey;
  const focus = focusKey();
  const mountFocus = document.activeElement?.closest(".mount") ? document.activeElement : null;
  const scrolled: [HTMLElement, number][] = [];
  for (const m of mounts.values()) {
    if (!m.el.isConnected) continue;
    for (const el of [m.el, ...m.el.querySelectorAll<HTMLElement>("*")]) if (el.scrollTop) scrolled.push([el, el.scrollTop]);
  }
  captureCarry();
  const leaving: Leaving[] = [...root.querySelectorAll<HTMLElement>("[data-leave]")].map((el) => ({ el, parent: el.parentElement?.classList.contains("main") ? ".main" : ".app" }));
  drawOnce = new Set();
  const scene = st.screen === "rewind" && st.rewind?.mode === "scene";
  const main =
    st.screen === "welcome" ? welcome()
      : st.screen === "onboarding" ? onboarding()
        : st.screen === "rewind" ? history()
          : st.screen === "compare" ? compare()
            : st.screen === "overview" ? overviewScreen()
            : st.screen === "plan" ? planPage(st.license, st.projects.length, st.account)
            : st.screen === "sources" ? sourcesPage({ projects: st.projects, sources: st.sources, claude: st.agents ? claudeChannel(st.agents, st.lastTurn) : null, labs: st.labs, platform: st.boot.platform, agentMark })
            : st.screen === "agents" ? agentsScreen()
              : st.screen === "storage" ? storageScreen()
                : st.screen === "settings" ? settings()
                  : history();
  // The right column holds the entry detail when one is open, else Ask when it is shown. Only on project screens. It stays
  // under Check it works (a sheet over the whole window), so closing the sheet returns to the button that opened it.
  const inProject = !!project() && PROJECT_SCREENS.includes(st.screen) && !scene;
  const right = !inProject || st.hookSheet || st.demoBusy ? "" : st.drawer && entry(st.selected) ? detail() : st.askOpen ? askColumn() : "";
  const appCls = right ? (right.includes('class="rcol detail') ? "has-detail" : "has-ask") : "";
  // Below 861 px the rail lives only in the navigation sheet (nav-toggle). It is not drawn hidden as well, so every
  // destination exists once, in the sheet, and nothing finds a copy that cannot be seen or pressed.
  const rail = window.innerWidth < RAIL_MIN ? "" : scene ? sidebar().replace('<aside class="side"', '<aside inert class="side"') : sidebar();
  // The first Tab stop skips the rail and the bar to the page itself (writer#26). A button, not a #link: the URL's hash is the bridge's.
  root.innerHTML = `<div class="shell"><button class="skip" data-act="skip">Skip to the page</button>
    ${opts.preview ? `<aside class="banner" aria-label="Preview"><span><b>Preview with demo data.</b> Download the app to use it on your projects.</span>${(opts.previewActions ?? []).map((a, i) => `<button class="btn" data-act="preview" data-i="${i}">${esc(a.label)}</button>`).join("")}</aside>` : ""}
    ${connectionBanner()}<div class="app ${appCls}">${rail}<main class="main" ${scene ? "inert" : ""}>${toolbar()}${main}${hookSheet()}${busyScrim()}</main>${right}${st.check ? checkSheet() : ""}${st.screen === "rewind" ? (scene ? timeView() : rewind()) : ""}${inspector()}${paletteView()}${keysSheetView()}${navigation()}${confirmView()}</div></div>`;
  // The toast sits over the work area: past the rail, and short of a right column when one is open.
  toastHost.dataset.right = appCls;
  seenOnce = drawOnce;
  applyOnce();
  const page = document.querySelector(".page");
  if (page) page.scrollTop = pageScroll;
  placeMounts(mountFocus, scrolled);
  fitSessions();
  fitRulerLabels();
  fitDialLabels();
  applyCarry();
  applyFlash();
  applyEntrances(scene);
  dialogFocus.sync(root, focus);
  // A redrawn heading has no tabindex, so the focus sync can't take it: it gets one and the focus back.
  if (focus === "main h1" && (document.activeElement === document.body || document.activeElement === null)) {
    const h = root.querySelector<HTMLElement>("main h1");
    if (h) {
      h.tabIndex = -1;
      h.focus({ preventScroll: true });
    }
  }
  applyRoving();
  tickCheckClock();
  const livePre = root.querySelector<HTMLElement>(".ck-live pre");
  if (livePre) livePre.scrollTop = livePre.scrollHeight;
  tickResendClock();
  const coach = st.screen === "history" ? coachStep() : 0;
  const announcement = st.demoBusy ? "Building the demo…"
    : st.check?.error ?? (st.check?.result ? `${verdictWord(st.check.result.verdict)}. ${checkReason(st.check.result.reason)}`
      : st.check ? "Checking your project in a copy…"
        : st.screen === "rewind" ? [...root.querySelectorAll(".rw .tv-head, .rw .rw-proof > .vb")].map((el) => el.textContent?.trim() ?? "").join(" ")
          : coach ? `Step ${coach} of 3: ${coachSteps()[coach - 1]}.` : "");
  if (announcer.textContent !== announcement) announcer.textContent = announcement;
  placeLeaving(leaving);
  // Kept for this tab on every draw, so a reload or Reconnect comes back here (route.ts).
  const route = JSON.stringify({ screen: st.screen, projectId: st.projectId, drawer: st.drawer, selected: st.drawer ? st.selected : null });
  if (route !== keptRoute) {
    keptRoute = route;
    try {
      sessionStorage.setItem(ROUTE_KEY, route);
    } catch {
      // Storage can be off; a reload then starts on Overview.
    }
  }
}

/** The route last written to sessionStorage, so a draw that changes nothing writes nothing. */
let keptRoute = "";

/** Lists that move between their rows with ↑/↓ (Home and End too) and take one Tab stop each: the journal's rows and
 *  Overview's cards, which can be long. Enter opens the row, as a click does. The rail keeps a Tab stop on every button,
 *  as a navigation list does, so a Tab user meets each project (Design note). Jump to keeps its own arrows (paletteKey). */
const ROVING: readonly string[] = [".journal .e-t, .journal .fold", ".ov-list .ov-open"];
/** The row each list last moved to, by data-id, so a redraw keeps its Tab stop there. */
const roveAt: { [list: string]: string } = {};
/** How far each key moves along a roving list. */
const ROVE_STEP: { [key: string]: number | undefined } = { ArrowDown: 1, ArrowUp: -1, Home: -Infinity, End: Infinity };

/** After a draw: in each list exactly one row is in the Tab order, the focused one, else the last one moved to, else the open one, else the first. */
function applyRoving(): void {
  for (const sel of ROVING) {
    const rows = [...root.querySelectorAll<HTMLElement>(sel)];
    const at = rows.find((r) => r === document.activeElement)
      ?? rows.find((r) => r.dataset.id === roveAt[sel])
      ?? rows.find((r) => r.matches(".on, [aria-current]") || !!r.closest(".entry.on, .entry.sel"))
      ?? rows[0];
    for (const r of rows) r.tabIndex = r === at ? 0 : -1;
  }
}

/** ↑/↓, Home and End on a row of a roving list move focus along it. True when the key was used. */
function roveKey(e: KeyboardEvent): boolean {
  const t = e.target;
  const move = ROVE_STEP[e.key];
  if (move === undefined || !(t instanceof HTMLElement) || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
  const sel = ROVING.find((s) => t.matches(s));
  if (!sel) return false;
  e.preventDefault();
  const rows = [...root.querySelectorAll<HTMLElement>(sel)];
  const to = rows[Math.min(rows.length - 1, Math.max(0, rows.indexOf(t) + move))];
  if (!to) return true;
  for (const r of rows) r.tabIndex = r === to ? 0 : -1;
  roveAt[sel] = to.dataset.id ?? "";
  to.focus();
  return true;
}

/** "These stay saved" sits on the session lane. A session it would cover ends before it, or hides when too little is left. */
function fitSessions(): void {
  const label = document.querySelector<HTMLElement>(".tv-veil-l");
  const clips = document.querySelectorAll<HTMLElement>(".tv-lane .clip");
  clips.forEach((el) => {
    el.style.maxWidth = "";
    el.style.visibility = "";
  });
  if (!label) return;
  const edge = label.getBoundingClientRect().left - 6;
  clips.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.right <= edge) return;
    const room = edge - r.left;
    if (room < 48) el.style.visibility = "hidden";
    else el.style.maxWidth = `${room}px`;
  });
}

/** A measured box, as a plain object so it can be copied and moved. */
function rectOf(el: Element): Box {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

/**
 * Ruler labels never touch. In order (Now, the last working one, the selected one, the first) a label
 * that comes within 8 px of one already kept hides; the last working one moves left of its tick instead,
 * and Now drops its time if that is still not enough (the hero already names that time).
 */
function fitRulerLabels(): void {
  const ruler = document.querySelector<HTMLElement>(".hruler");
  if (!ruler) return;
  const labs = [...ruler.querySelectorAll<HTMLElement>(".rlab")];
  for (const el of labs) {
    el.style.marginLeft = "";
    el.classList.remove("rl-c", "rl-hide");
  }
  // A session of one or two save points is narrower than its name: an empty sliver reads as a stray mark, so it goes.
  ruler.querySelectorAll<HTMLElement>(".clip").forEach((el) => el.classList.toggle("clip-x", el.clientWidth < 48));
  const shown = labs.filter((el) => el.getClientRects().length > 0);
  const ticks = ruler.querySelectorAll(".rt-tk");
  const row = shown.map((el) => {
    const box = rectOf(el);
    const tick = ticks[Number(el.dataset.i)];
    const t = tick ? rectOf(tick) : box;
    const now = el.classList.contains("now");
    let short: Box | null = null;
    if (now && el.querySelector(".rl-t")?.getClientRects().length) {
      el.classList.add("rl-c");
      short = rectOf(el);
      el.classList.remove("rl-c");
    }
    return { box, tickX: (t.left + t.right) / 2, lastWorking: "lw" in el.dataset, now, short };
  });
  const fit = fitRow(row);
  shown.forEach((el, i) => {
    if (fit.hidden[i]) el.classList.add("rl-hide");
    if (fit.dx[i]) el.style.marginLeft = `${fit.dx[i]}px`;
    if (fit.nowShort && el.classList.contains("now")) el.classList.add("rl-c");
  });
  // The "Last version that works" flag hangs left of its bead, but near the right end of a narrow ruler it would still
  // reach past the ruler (and give the page a sideways scroll): move it back in by what sticks out.
  const lw = ruler.querySelector<HTMLElement>(".lwflag");
  if (lw) {
    lw.style.marginLeft = "";
    const out = lw.getBoundingClientRect().right - ruler.getBoundingClientRect().right;
    if (out > 0) lw.style.marginLeft = `${-Math.ceil(out)}px`;
  }
  // A session chip shows its whole name or not at all, and never touches the flag (dev#36): a cut "Claude…" says nothing.
  const flag = lw?.getBoundingClientRect() ?? null;
  ruler.querySelectorAll<HTMLElement>(".clip:not(.clip-x)").forEach((el) => {
    const name = el.firstElementChild;
    const cut = !!name && name.scrollWidth > name.clientWidth + 1;
    const b = el.getBoundingClientRect();
    const hits = !!flag && b.left < flag.right + 4 && b.right > flag.left - 4 && b.top < flag.bottom + 4 && b.bottom > flag.top - 4;
    if (cut || hits) el.classList.add("clip-x");
  });
}

/** Dial labels stay inside the card, off every dot, the card's own words and each other. A less important one hides first. */
function fitDialLabels(): void {
  const dial = document.querySelector<HTMLElement>(".dial");
  const card = dial?.closest<HTMLElement>(".dialmod");
  if (!dial || !card) return;
  const d = rectOf(dial);
  const center = { x: (d.left + d.right) / 2, y: (d.top + d.bottom) / 2 };
  // Each dot with 3 px around it, so a selected dot (drawn 1.45 times larger) is covered too.
  const dots = [...dial.querySelectorAll(".det .dg")].map((el) => {
    const b = rectOf(el);
    return { left: b.left - 3, top: b.top - 3, right: b.right + 3, bottom: b.bottom + 3 };
  });
  const c = rectOf(card);
  const frame = { left: c.left + 8, top: c.top + 8, right: c.right - 8, bottom: c.bottom - 8 };
  const labs = [...dial.querySelectorAll<HTMLElement>(".dl")];
  const first = labs[0];
  if (!first) return;
  // The dial is zoomed on small windows, so measure where the layer's corner is and how many screen
  // pixels one of its CSS pixels covers, instead of assuming 1.
  first.style.left = "0px";
  first.style.top = "0px";
  const origin = rectOf(first);
  first.style.left = "100px";
  const scale = (rectOf(first).left - origin.left) / 100 || 1;
  first.style.left = "0px";
  const cands = labs.map((el) => {
    const dot = dots[Number(el.dataset.i)];
    const r = el.getBoundingClientRect();
    if (!dot) return [];
    const half = (dot.right - dot.left) / 2;
    return dialCandidates({ x: dot.left + half, y: (dot.top + dot.bottom) / 2 }, center, r.width, r.height, half + 3, frame);
  });
  const words = [...card.querySelectorAll(".silk span, .rw-when, .rw-turn")].filter((el) => el.getClientRects().length).map(rectOf);
  placeLabels(cands, frame, [...dots, ...words], 6).forEach((k, i) => {
    const el = labs[i];
    const b = k === null ? undefined : cands[i]?.[k];
    if (!el) return;
    if (!b) return void (el.style.visibility = "hidden");
    el.style.left = `${(b.left - origin.left) / scale}px`;
    el.style.top = `${(b.top - origin.top) / scale}px`;
    el.style.visibility = "visible";
  });
}

/** The theme, and Reduce motion as the .calm class, which stills what the computer's own setting stills (styles.css). */
function applyAppearance(): void {
  if (st.settings.theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", st.settings.theme);
  document.documentElement.classList.toggle("calm", st.settings.reduceMotion);
}

// Actions

async function saveNow(): Promise<void> {
  const p = project();
  if (!p || st.busy) return;
  // Save now is disabled while it runs, which drops its focus; the one that had focus (the phone bar's or the page's) gets
  // it back once enabled (Design c1e5296 and 9d76bd5 P2).
  const had = document.activeElement instanceof HTMLElement && document.activeElement.matches('[data-act="save"]') ? document.activeElement : null;
  const back = had ? (had.matches(".tb-main") ? '.tb-main[data-act="save"]' : '[data-act="save"]:not(.tb-main)') : null;
  st.busy = "Saving";
  render();
  try {
    const r: CheckpointResult = await api({ method: "checkpoint", projectId: p.id, note: "Saved by you" });
    st.selected = r.checkpoint.id;
    await loadTimeline();
    st.selected = r.checkpoint.id;
    st.busy = null;
    // The same name the journal gives this save point, with seconds when two share a minute.
    const saved = entry(r.checkpoint.id);
    // A folder that only saves versions is never told "Not checked yet"; files left out are said every time, plainly.
    const missing = r.checkpoint.coverage.missing;
    const left = missing.length ? ` Left out: ${shortSkip(missing[0] ?? "")}${missing.length > 1 ? ` and ${missing.length - 1} more` : ""}.` : "";
    toast(`Saved ${saved ? `${twinOrdinal(saved, points()) ? "as " : ""}${ptAt(saved)}` : when(r.checkpoint.createdAt)}.${checksOn(p) ? " Not checked yet." : ""}${left}`, null, missing.length ? { action: { label: "See what", run: () => void openSavePoint(p.id, r.checkpoint.id) } } : {});
  } catch (e) {
    st.busy = null;
    toast(msg(e));
  }
  render();
  if (back) refocus(back);
  void refreshStatuses().then(() => {
    render();
    if (back) refocus(back);
  });
}

async function hideVerdictTip(): Promise<void> {
  try {
    st.settings = await api({ method: "setSettings", patch: { verdictTipSeen: true } });
  } catch (e) {
    toast(msg(e));
  }
  render();
}

async function checkNow(id?: string): Promise<void> {
  const p = project();
  // A project with no check only saves versions: running one would store "Needs something" and flip it into check mode (MF4).
  if (!p || st.busy || !checksOn(p)) return;
  st.busy = "Checking";
  // Closing the sheet puts focus back on what opened it; a shortcut opened it from the page's Check it works.
  const from = focusKey();
  const opener = from && /data-act="(check|verify-one)"/.test(from) ? from : '[data-act="check"]';
  st.check = { phase: id ? "checking" : "saving", cp: id ?? null, skipped: false, result: null, error: null, startedAt: Date.now(), endedAt: null, live: null, opener };
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
    st.check = { ...st.check, phase: "done", result, endedAt: Date.now() };
    // The end of the log is read with the timeline, so the verdict arrives with what the check printed.
    await Promise.all([loadTimeline(), result.log && !result.stopped ? loadLogTail(p.id, result) : null]);
    st.selected = target;
  } catch (e) {
    st.check = { ...st.check, phase: "done", error: msg(e) };
  }
  st.busy = null;
  await refreshStatuses();
  render();
}

/** Closes the check sheet and puts focus back on the control that opened it (dev#35), not on whatever had it before. */
function closeCheck(): void {
  const back = st.check?.opener ?? null;
  st.check = null;
  render();
  if (!back) return;
  const el = [...root.querySelectorAll<HTMLElement>(back)].find((x) => x.getClientRects().length > 0 && !x.closest("[inert], .leave"));
  el?.focus({ preventScroll: true });
}

/** Settings > Appearance > Reduce motion, or the computer's own setting when that is off (WCAG 2.2.2: loops can be stopped). */
function reducedMotion(): boolean {
  return st.settings.reduceMotion || (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

/** The dial scene, unless the user asked for the plain sheet. Reduce motion keeps the dial, without movement. */
function rewindMode(): RewindState["mode"] {
  return st.settings.simpleRewind ? "sheet" : "scene";
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
  // The newest save point already works: nothing to find, and checking it again would only repeat a pass (dev#9).
  const latest = points().at(-1);
  if (!target && !search && checksOn(p) && latest?.verdict === "PASS") {
    const before = points().at(-2);
    toast("The newest version already works.", "PASS", before ? { action: { label: "Go back anyway", run: () => void startRewind(before.id) } } : {});
    return;
  }
  const back = st.screen === "rewind" && st.rewind ? st.rewind.returnTo : here();
  st.check = null;
  st.screen = "rewind";
  enterScene();
  // Known answer: a recorded Works save point after which the project broke. Go straight to it, no search.
  // A project with no check never searches (a search runs the check): it opens on the selected save point, else the one before now.
  const pts = points();
  const known = target ?? (!checksOn(p) ? (st.selected ?? pts.at(-2)?.id ?? pts.at(-1)?.id) : !search && pts.at(-1)?.verdict !== "PASS" ? lastWorking()?.id : undefined);
  if (known) {
    st.rewind = newRewind(known, back);
    render();
    void loadChanges();
    void loadChangeOf(known);
    return;
  }
  st.rewind = newRewind(null, back);
  await findGood();
}

async function findGood(): Promise<void> {
  const p = project();
  if (!p || st.busy || !checksOn(p)) return;
  st.rewind = { ...newRewind(null, st.rewind?.returnTo), finding: true, searched: true };
  st.busy = "Finding";
  render();
  void loadChanges();
  try {
    const r = await api({ method: "findGood", projectId: p.id });
    st.rewind = { ...st.rewind, finding: false, find: r, target: r.found, step: r.found ? "review" : "find" };
    void loadChangeOf(r.found);
  } catch (e) {
    st.rewind = { ...st.rewind, finding: false, error: msg(e) };
  }
  st.busy = null;
  await loadTimeline();
  await refreshStatuses();
  if (st.screen !== "rewind" && st.rewind) {
    const found = st.rewind.find?.found;
    if (found) toast(`Found it. ${sentenceStart(pointName(found))} is the last one that works. Press ${keys("Mod+Shift+R")} to see it.`, "PASS");
    else toast(st.rewind.find?.stopped ? "Search stopped. No save point was marked as working." : "We could not find a version that passes its check.");
    return;
  }
  render();
}

/** Leave the Rewind, back to where the user was. After a finished go back, History leads with Undo. */
function exitRewind(): void {
  const r = st.rewind;
  const finished = r?.step === "done" ? r.result : null;
  const back = r?.returnTo ?? { screen: "history" as Screen, selected: st.selected, listScroll: 0, pageScroll: 0 };
  // A running search keeps going in the background. Everything else is let go.
  if (!r?.finding) st.rewind = null;
  st.screen = back.screen;
  const ids = points().map((c) => c.id);
  if (back.selected && ids.includes(back.selected)) st.selected = back.selected;
  // After going back, the detail would offer the same Go back again. History leads with the undo bar instead.
  if (finished) st.drawer = false;
  render();
  const list = document.getElementById("list");
  if (list) list.scrollTop = back.listScroll;
  const page = document.querySelector(".page");
  if (page) page.scrollTop = back.pageScroll;
  if (!finished) return;
  root.querySelector<HTMLElement>('.undo-card [data-act="undo-rewind"]')?.focus({ preventScroll: true });
  toast(`Brought back ${pointName(finished.id)}. Your folder wasn’t touched. ${keys("Mod+Z")} undoes it.`, finished.lastVerdict);
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
  void loadChangeOf(id);
}

function tvStep(how: Step): void {
  const pts = points();
  const i = pts.findIndex((c) => c.id === st.rewind?.target);
  if (i < 0) return;
  tvGo(pts[stepIndex(pts.map((c) => verdictKey(shownVerdict(c))), i, how)]?.id);
}

/** How many checks in a row passed for each save point, from the audit log, for "3 checks passed". */
async function loadPasses(): Promise<void> {
  const p = project();
  if (!p) return;
  const r = await bridge.call({ method: "log", projectId: p.id });
  if (!r.ok || project()?.id !== p.id) return;
  st.passes = passStreaks(r.data.entries);
  render();
}

/** Read what changed in each save point, oldest first, without blocking anything. */
async function loadChanges(): Promise<void> {
  const p = project();
  const pts = points().slice(-40);
  const key = `${p?.id ?? ""}:${pts.at(-1)?.id ?? ""}`;
  if (!p || st.changesFor === key) return;
  st.changesFor = key;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (!a || !b || st.changes.has(b.id)) continue;
    const r = await bridge.call({ method: "diff", projectId: p.id, a: a.id, b: b.id });
    if (st.projectId !== p.id) return;
    if (!r.ok) {
      // Read again next time, so a hiccup never leaves a row without what it changed (writer#13).
      st.changesFor = "";
      continue;
    }
    keepChange(p.id, b.id, r.data);
  }
  if (st.projectId === p.id && (st.screen === "history" || st.screen === "rewind")) render();
}

/** The Rewind's target can be older than the save points loadChanges reads: read its own change list with the same diff. */
async function loadChangeOf(id: string | null): Promise<void> {
  const p = project();
  const pts = points();
  const i = pts.findIndex((c) => c.id === id);
  const a = pts[i - 1];
  const b = pts[i];
  if (!p || !a || !b || st.changes.has(b.id)) return;
  const r = await bridge.call({ method: "diff", projectId: p.id, a: a.id, b: b.id });
  if (!r.ok || st.projectId !== p.id) return;
  keepChange(p.id, b.id, r.data);
  if (st.screen === "rewind" && st.rewind?.target === b.id) render();
}

/** What each save point changed by kind (added, deleted, changed), by project and id, for the rows' summaries. */
const changeKinds = new Map<string, ChangeKinds>();
/** The save point each kept diff started from (the one before), by project and id: where a deleted file still is. */
const changeFrom = new Map<string, string>();

/** Keeps one diff: the paths for the titles and the Rewind, and the kinds for the summaries. Git's own A/D lines count too.
 *  The paths list what was changed and deleted before what was added, top-level files before deep ones, so the few files
 *  someone edited are not buried under hundreds of new notes. */
function keepChange(projectId: string, id: string, d: DiffResult): void {
  const code = (s: string): string[] => d.code.filter((x) => x.status.startsWith(s)).map((x) => x.path);
  const k: ChangeKinds = {
    added: [...code("A"), ...d.files.added],
    removed: [...code("D"), ...d.files.removed],
    changed: [...d.code.filter((x) => !/^[AD]/.test(x.status)).map((x) => x.path), ...d.files.changed],
  };
  const depth = (f: string): number => f.split("/").length;
  const byDepth = (xs: readonly string[]): string[] => [...xs].sort((a, b) => depth(a) - depth(b));
  st.changes.set(id, [...byDepth(k.changed), ...byDepth(k.removed), ...byDepth(k.added)]);
  changeKinds.set(`${projectId} ${id}`, k);
  changeFrom.set(`${projectId} ${id}`, d.a);
}

/** A save point's change in a few words ("309 files deleted"), or "" before its diff is read. */
function changeWords(c: TimelineEntry): string {
  const p = project();
  const k = p ? changeKinds.get(`${p.id} ${c.id}`) : undefined;
  return k ? changeSummary(k) : "";
}

async function rewindTry(): Promise<void> {
  const p = project();
  const r = st.rewind;
  if (!p || !r?.target || st.busy || !checksOn(p)) return;
  r.trying = true;
  r.tryResult = null;
  st.busy = "Checking";
  render();
  try {
    const v = await api({ method: "verify", projectId: p.id, id: r.target });
    if (v.stopped) toast("Check stopped. The save point keeps the verdict it had.");
    else r.tryResult = v;
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
    if (st.coach?.projectId === p.id) st.coach.went = true;
    r.step = "done";
  } catch (e) {
    r.error = msg(e);
  }
  r.recovering = false;
  st.busy = null;
  // The pressed key was disabled while it worked, so focus moved on. Draw the outcome now and give its key the focus:
  // Done when it is back, the key again when it failed. Later redraws keep it there.
  render();
  root.querySelector<HTMLElement>(`.rw [data-act="${r.step === "done" ? "tv-done" : "tv-use"}"]`)?.focus({ preventScroll: true });
  await loadTimeline();
  await refreshStatuses();
  render();
}

/** The control that was pressed went away with the redraw, so focus goes to the ruler, the page's main control, not to nothing. */
function refocusRuler(): void {
  if (document.activeElement === document.body) root.querySelector<HTMLElement>(".hruler")?.focus({ preventScroll: true });
}

/** Undo the last rewind: the engine removes its branch and copy, only if both are untouched. */
async function undoRewind(): Promise<void> {
  const u = st.undo;
  if (!u || u.working || st.busy) return;
  u.working = true;
  st.busy = "Undoing the rewind";
  render();
  try {
    const r = await api({ method: "undoRecover", projectId: u.projectId, id: u.result.id, branch: u.result.branch, copyDir: u.result.copyDir });
    st.undo = null;
    if (st.coach?.projectId === u.projectId) st.coach = null;
    st.busy = null;
    if (st.screen === "rewind" && st.rewind?.step === "done") {
      st.rewind = { ...st.rewind, result: null, step: "review" };
      exitRewind();
    }
    await loadTimeline();
    render();
    refocusRuler();
    toast(r.removedBranch ? `Rewind undone. Removed the new branch${r.removedCopy ? " and the copy" : ""}. Every save point is still here.` : `Rewind undone. Removed the copy. Every save point is still here.`);
  } catch (e) {
    u.working = false;
    st.busy = null;
    toast(msg(e));
    // The refused Undo stays offered: redraw it enabled and put focus back on it, so focus never drops to the page.
    render();
    root.querySelector<HTMLElement>('.rw [data-act="undo-rewind"], .undo-card [data-act="undo-rewind"]')?.focus({ preventScroll: true });
  }
  void refreshStatuses().then(render);
}

async function openCompare(a?: string, b?: string): Promise<void> {
  const pts = points();
  const newest = pts.at(-1);
  const older = lastWorking()?.id ?? pts.at(-2)?.id ?? newest?.id ?? null;
  st.compare = { a: a ?? older, b: b ?? "now", now: null, result: null, loading: false, error: null };
  st.screen = "compare";
  // Below 1100 px a save point's detail is a sheet over the page, so it closes and Compare is what shows; wider, it stays beside it.
  if (st.drawer && window.innerWidth < 1100) st.drawer = false;
  const diff = runDiff();
  // runDiff draws the loading state before it waits. When the control that opened Compare went with the page, focus starts on From.
  refocus('[data-model="cmp-a"]');
  await diff;
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
  st.busy = "Making a copy";
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
    // The engine's demo ends with its own recovery. Undo just that branch and copy, so the one
    // recovery in the demo is the one the user makes. If it can't be undone, the user's recovery
    // gets the next free branch name, which is still correct.
    const own = r.result.recover;
    await bridge.call({ method: "undoRecover", projectId: r.project.id, id: own.id, branch: own.branch, copyDir: own.copyDir });
    st.demoBusy = false;
    await refreshStatuses();
    await selectProject(r.project.id);
    // Land on History at Now, broken, with the three steps: drag back to the version find-good found,
    // go back to it, then undo or keep it.
    const found = r.result.findGood.found;
    if (!found) return toast("Demo ready, but no working version was found.");
    st.coach = { projectId: r.project.id, target: found, went: false };
    render();
    root.querySelector<HTMLElement>(".hruler")?.focus({ preventScroll: true });
    // Recovery saves the broken state before it creates a branch. That new save point has no
    // verdict yet: check it for real without delaying History or guessing that it failed.
    const before = own.savedBefore;
    if (before) void bridge.call({ method: "verify", projectId: r.project.id, id: before }).then(async (checked) => {
      if (!checked.ok) throw new ApiFailure(checked.error.message);
      await refreshStatuses();
      if (st.projectId === r.project.id) {
        st.verifyResults.set(checked.data.checkpoint, checked.data);
        await loadTimeline();
        render();
      }
    }).catch((e: unknown) => toast(`The demo’s saved state could not be checked: ${msg(e)}`));
  } catch (e) {
    st.demoBusy = false;
    toast(msg(e));
  }
}

/** Step 2: what adding the folder would give, read with nothing written. The engine's own sentences (a file, not there) show under the field. */
async function obNext1(): Promise<void> {
  const o = st.onboarding;
  if (o.working) return;
  const path = (o.path ?? "").trim();
  o.path = path;
  const problem = pathProblem(path);
  if (problem) {
    o.error = problem;
    render();
    root.querySelector<HTMLInputElement>('[data-model="ob-path"]')?.focus();
    return;
  }
  o.working = true;
  o.error = null;
  render();
  const purpose = o.purpose ?? "code";
  try {
    const pv = await api({ method: "previewProject", path, purpose });
    const listed = st.projects.find((p) => p.path === pv.path);
    if (listed) throw new ApiFailure(`${listed.name} is already protected. Open it from the list.`);
    st.onboarding = { ...o, step: 3, preview: pv, project: null, added: false, init: null, first: null, tryResult: null, current: "", choice: firstCheckChoice(purpose, pv.check.command), custom: "", working: false, autoSave: defaultAutoSave(pv.kind, purpose) };
  } catch (e) {
    st.onboarding = { ...o, working: false, error: msg(e) };
  }
  render();
  if (st.onboarding.error) root.querySelector<HTMLElement>(freeLimitHit(st.onboarding.error) ? "#limit-h" : '[data-model="ob-path"]')?.focus();
  else if (st.onboarding.step === 3) root.querySelector<HTMLButtonElement>(st.onboarding.choice === "none" ? '[data-act="ob-next2"]' : '[data-act="ob-try"]')?.focus();
}

/** Adds the folder step 2 previewed, once something needs the project: Try it now, a Git project's Claude Code step, or Finish. */
async function obEnsureAdded(): Promise<ProjectEntry | null> {
  const o = st.onboarding;
  if (o.project) return o.project;
  const pv = o.preview;
  if (!pv) return null;
  const listed = st.projects.some((p) => p.path === pv.path);
  const proj = await api({ method: "addProject", path: pv.path, purpose: o.purpose ?? "code" });
  if (!st.projects.some((p) => p.id === proj.id)) st.projects.push(proj);
  o.project = proj;
  o.added = !listed;
  const init = await api({ method: "init", projectId: proj.id });
  resetProjectCaches(st, proj.id);
  void bridge.call({ method: "setActive", projectId: proj.id });
  o.init = init;
  o.current = init.verifyCommand;
  return proj;
}

/** Back to the folder, or Cancel: a project this flow put in the list comes out again, as Remove from app does (its store history stays). */
function obDrop(): void {
  const o = st.onboarding;
  const p = o.project;
  // Try it now may have written timemachine.yml into the folder; Back takes it out too, so "Back takes it out again" holds.
  const made = o.init?.created === true;
  // A timemachine.yml that was already there: if this flow changed its check (Try it now, or No tests yet), Back puts the
  // command it had back (Security B6), so backing out leaves the folder as it was.
  const original = o.init && !made ? o.init.verifyCommand : null;
  const giveBack = p && original !== null && o.current !== original
    // Only while the command is still the one this flow set: an edit made meanwhile in the file wins (Security N2).
    ? bridge.call({ method: "setProjectConfig", projectId: p.id, patch: { command: original }, ifCommand: o.current })
    : Promise.resolve(null);
  o.project = null;
  o.init = null;
  o.first = null;
  o.tryResult = null;
  o.hook = null;
  o.hookError = null;
  o.current = "";
  if (!p || !o.added) {
    void giveBack.then((r) => r && !r.ok && toast(r.error.message));
    return;
  }
  o.added = false;
  st.projects = st.projects.filter((x) => x.id !== p.id);
  if (st.projectId === p.id) resetProjectCaches(st, st.projects[0]?.id ?? null);
  void giveBack
    .then(async (back) => {
      // A give-back that could not be made (the check changed meanwhile) is said, not dropped (Security F3), and a
      // failed removal adds to that message instead of replacing it (G2).
      const said = back && !back.ok ? back.error.message : "";
      const r = await bridge.call({ method: "removeProject", projectId: p.id, ...(made ? { dropSettings: true as const } : {}) });
      const msg = [said, r.ok ? "" : r.error.message].filter(Boolean).join(" ");
      if (msg) toast(msg);
    });
}

function obCommand(): string {
  const o = st.onboarding;
  return o.choice === "detected" ? obCheck(o).command : o.choice === "build" ? "npm run build" : o.custom.trim();
}

/** Sets the chosen check on the added project. False, with the reason in o.error, when no check is chosen. */
async function obApplyCheck(): Promise<boolean> {
  const o = st.onboarding;
  const cmd = obCommand();
  // Only saving versions: a check this flow already set (Try it now) is emptied, so nothing is checked from now on.
  if (o.choice === "none") {
    if (o.project && o.current.trim()) {
      await api({ method: "setProjectConfig", projectId: o.project.id, patch: { command: "" } });
      o.current = "";
    }
    return true;
  }
  if (!cmd) {
    o.error = "Pick a check, or type your own command.";
    return false;
  }
  if (!o.project) return false;
  if (cmd !== o.current) {
    await api({ method: "setCheck", projectId: o.project.id, command: cmd });
    o.current = cmd;
  }
  return true;
}

async function obTry(): Promise<void> {
  const o = st.onboarding;
  if (!o.preview || o.trying) return;
  o.trying = true;
  o.error = null;
  o.tryResult = null;
  render();
  try {
    if (o.choice === "none" || obCommand()) {
      const proj = await obEnsureAdded();
      if (proj && (await obApplyCheck())) {
        o.first = o.first ?? (await api({ method: "checkpoint", projectId: proj.id, ...(o.preview.existingSavePoints ? {} : { note: "First save point" }), ifChanged: true })).checkpoint;
        o.tryResult = await api({ method: "verify", projectId: proj.id, id: o.first.id });
      }
    } else o.error = "Pick a check, or type your own command.";
  } catch (e) {
    o.error = msg(e);
  }
  o.trying = false;
  render();
}

async function obNext2(): Promise<void> {
  const o = st.onboarding;
  if (!o.preview) return;
  o.error = null;
  if (o.choice !== "none" && !obCommand()) {
    o.error = "Pick a check, or type your own command.";
    return render();
  }
  o.working = true;
  render();
  try {
    // A Git project's last step shows the exact Claude Code lines, which are read for the added project. A plain folder has
    // none, so it is added at Finish. If the lines can't be prepared, step 4 says so and Finish still works.
    if (o.preview.kind !== "folder") {
      await obEnsureAdded();
      if (await obApplyCheck()) {
        try {
          o.hook = o.project ? await api({ method: "hookPreview", projectId: o.project.id }) : null;
          o.hookError = null;
        } catch (e) {
          o.hook = null;
          o.hookError = msg(e);
        }
        o.step = 4;
      }
    } else o.step = 4;
  } catch (e) {
    o.error = msg(e);
  }
  o.working = false;
  render();
  if (o.error && freeLimitHit(o.error)) root.querySelector<HTMLElement>("#limit-h")?.focus();
}

/** Add the Claude Code lines, then finish. If adding fails, stay on the step with Finish still one click away. */
async function obConnectFinish(): Promise<void> {
  const o = st.onboarding;
  if (!o.project) return;
  o.working = true;
  o.error = null;
  render();
  try {
    const r = await api({ method: "hookInstall", projectId: o.project.id });
    o.hookDone = r.added.length ? `Added: ${r.added.join(", ")}.` : "Claude Code was already connected. Nothing changed.";
  } catch (e) {
    o.error = msg(e);
    o.working = false;
    return render();
  }
  await obFinish();
}

/** Finish: the folder is added now (a Git project already was, for its Claude Code step), with the check and when to save. */
async function obFinish(): Promise<void> {
  const o = st.onboarding;
  if (!o.preview) return;
  o.working = true;
  o.error = null;
  render();
  try {
    const proj = await obEnsureAdded();
    if (!proj || !(await obApplyCheck())) {
      o.working = false;
      return render();
    }
    // Saving on change is the one choice step 4 stores; it is sent only when it differs from what the engine set.
    if (o.autoSave !== proj.features.autoSave) {
      const updated = await api({ method: "setFeature", projectId: proj.id, change: { feature: "autoSave", autoSave: o.autoSave } });
      st.projects = st.projects.map((x) => (x.id === updated.id ? updated : x));
    }
    // Try it now made the first save point already: the one Finish makes for files changed since takes the usual note.
    await api({ method: "checkpoint", projectId: proj.id, ...(o.preview.existingSavePoints || o.first ? {} : { note: "First save point" }), ifChanged: true });
    st.settings = await api({ method: "setSettings", patch: { onboarded: true } });
    const id = proj.id;
    st.onboarding = emptyOnboarding();
    await refreshStatuses();
    // Whether it checks at all follows its check now (checksOn), so the list of checks is read before History draws.
    st.agents = await api({ method: "agents" }).catch(() => st.agents);
    await selectProject(id);
    const v = points().at(-1)?.verdict ?? null;
    const name = st.projects.find((x) => x.id === id)?.name ?? "it";
    toast(o.choice === "none" ? savedOnlyToast(name) : v === "PASS" ? "You’re set. Your newest save point passed its check." : v ? `You’re set. Your newest save point is ${verdictWord(v).toLowerCase()}.` : "You’re set. Your newest save point is saved, not checked. A tick turns green only after a check passes.", o.choice === "none" ? null : v);
  } catch (e) {
    o.error = msg(e);
    o.working = false;
    render();
    if (freeLimitHit(o.error)) root.querySelector<HTMLElement>("#limit-h")?.focus();
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

/** Approves the project's current check on this computer, the same as tm init. The plugin acts there from the next prompt. */
async function approveCheck(projectId: string): Promise<void> {
  const name = st.projects.find((p) => p.id === projectId)?.name ?? "this project";
  try {
    const r = await api({ method: "init", projectId });
    toast(r.approvedCheck ? `Approved. The Time Machine plugin now saves and checks in ${name}.` : `${name} has no check to approve. Set one first.`);
  } catch (e) {
    toast(msg(e));
  }
  st.agents = await api({ method: "agents" }).catch(() => st.agents);
  render();
}

/** tm forget for one project: the check's approval and Time Machine's hook lines go. Save points stay. */
async function forgetProject(projectId: string): Promise<void> {
  const name = st.projects.find((p) => p.id === projectId)?.name ?? "this project";
  try {
    const r = await api({ method: "forget", projectId });
    toast(r.unreadable.length ? `Disconnected ${name}, but its ${r.unreadable.map((x) => x.split("/").pop()).join(" and ")} is not plain JSON or is a link to another file, so we left it alone. Remove any tm hook lines in it by hand.` : `Disconnected. Claude Code no longer saves or checks in ${name}. Its save points stay.`);
  } catch (e) {
    toast(msg(e));
  }
  st.agents = await api({ method: "agents" }).catch(() => st.agents);
  render();
  refocus(`[data-act="hook"][data-id="${CSS.escape(projectId)}"], [data-act="approve-check"][data-id="${CSS.escape(projectId)}"]`);
}

/** An error says what happened in plain words, and its way forward sits in the same card. `alert` only where it was announced before. */
function failCard(cause: string, actions: string, alert = false): string {
  return `<div class="note bad fail-card"><p${alert ? ' role="alert"' : ""}>${esc(cause)}</p><div class="row-btns">${actions}</div></div>`;
}

function pageFailure(title: string): string {
  // While the connection banner is up it carries the cause and the one action (Reconnect), so the page waits quietly under it.
  if (st.connection && st.connection.state !== "connected") {
    return `<div class="page"><div class="col"><h1>${esc(title)}</h1><div class="wait-sk" aria-hidden="true"><i></i><i></i><i></i></div></div></div>`;
  }
  return `<div class="page"><div class="col"><h1>${esc(title)}</h1>${failCard(st.pageError ?? "Couldn’t read local data.", '<button class="btn" data-act="page-retry">Try again</button>', true)}</div></div>`;
}

/** The app-wide pages that read their own data when they open. */
type AppPage = "overview" | "agents" | "storage" | "settings" | "plan" | "sources";
const APP_PAGES: readonly Screen[] = ["overview", "agents", "storage", "settings", "plan", "sources"];
const isAppPage = (s: Screen): s is AppPage => APP_PAGES.includes(s);

/** Overview: every project's save points, read straight from the bridge (not recorded). One that can't be read says so on its card. */
async function loadOverview(): Promise<void> {
  const reads = await Promise.all(st.projects.map(async (p) => [p.id, await bridge.call({ method: "timeline", projectId: p.id })] as const));
  st.overview = new Map(reads.map(([id, r]) => [id, r.ok ? r.data.checkpoints : "error"]));
}

function overviewScreen(): string {
  if (!st.projects.length) return welcome();
  const lic = st.license.status;
  const checks = new Set(st.projects.filter((p) => checksOn(p)).map((p) => p.id));
  const strips = st.projects.some((p) => Array.isArray(st.overview.get(p.id)));
  return overviewPage({ projects: st.projects, statuses: st.statuses, timelines: st.overview, checks, now: Date.now(), badge: (v) => badge(v), freeLimit: lic.active ? null : lic.freeProjectLimit, enter: strips ? once("ov-strips", "draw") : "" });
}

/** A failed read stays an error, never an invented empty list. */
async function openPage(screen: AppPage): Promise<void> {
  st.screen = screen;
  st.drawer = false;
  st.pageError = null;
  if (screen === "storage") {
    st.storage = null;
    st.cleanup = null;
    st.thin = null;
  }
  if (screen === "sources") st.sources = null;
  render();
  try {
    if (screen === "storage") {
      const [storage, kept] = await Promise.all([api({ method: "storage" }), bridge.call({ method: "storeProjects" })]);
      st.storage = storage;
      st.storeProjects = kept.ok ? kept.data : null;
    }
    else if (screen === "overview") await Promise.all([loadOverview(), refreshStatuses()]);
    else if (screen === "sources") {
      const [found, agents] = await Promise.all([bridge.call({ method: "sources" }), st.agents ? null : api({ method: "agents" })]);
      st.sources = found.ok ? found.data : "error";
      if (agents) st.agents = agents;
    } else if (screen === "plan") {
      // What the site has open decides the sign-in panel; a site that can't be reached leaves the paste-key field as the way in.
      const [status, site] = await Promise.all([st.license.working ? null : api({ method: "license" }), bridge.call({ method: "siteStatus" })]);
      if (status) st.license = { ...st.license, status };
      st.account = { ...st.account, site: site.ok ? site.data : "error" };
    } else if (screen === "agents") {
      st.agents = await api({ method: "agents" });
      await loadLastTurns();
    } else if (screen === "settings") {
      st.isolation = await api({ method: "isolation" });
      if (!st.license.working) st.license = { ...st.license, status: await api({ method: "license" }) };
    }
  } catch (e) {
    if (st.screen === screen) st.pageError = msg(e);
  }
  if (st.screen === screen) render();
}

/** When each project's last Claude Code turn ended, from the audit log's "agent-turn ended" lines. */
async function loadLastTurns(): Promise<void> {
  const logs = await Promise.all(st.projects.map(async (p) => [p.id, await bridge.call({ method: "log", projectId: p.id })] as const));
  for (const [id, r] of logs) {
    const ended = r.ok ? r.data.entries.filter((x) => x.action === "agent-turn" && x.result === "ended").at(-1) : undefined;
    if (ended) st.lastTurn.set(id, ended.at);
  }
}

async function setSetting(patch: Partial<Settings>): Promise<void> {
  try {
    st.settings = await api({ method: "setSettings", patch });
    applyAppearance();
  } catch (e) {
    toast(msg(e));
  }
  render();
}

/** Forgets a project in the app. Its save points stay in the store and its folder is not touched. */
async function removeProject(id: string): Promise<void> {
  try {
    st.projects = await api({ method: "removeProject", projectId: id });
    dropMounts(id);
    if (st.projectId === id) resetProjectCaches(st, st.projects[0]?.id ?? null);
    toast("Removed from the app. Its save points stay in the store.");
    if (st.screen === "storage" || (st.screen === "overview" && st.projects.length)) await openPage(st.screen);
    else if (st.projectId) await selectProject(st.projectId);
    else {
      st.screen = "welcome";
      render();
    }
  } catch (e) {
    toast(msg(e));
  }
}

/** The Mac's own folder chooser. Null when the person cancels; a refusal (another system) is said in a toast. */
async function chooseFolder(): Promise<string | null> {
  const picked = await bridge.call({ method: "pickFolder" });
  if (!picked.ok) {
    toast(picked.error.message);
    return null;
  }
  return picked.data.path;
}

/** "It moved…": choose where the folder is now, and the project points there, keeping its history (writer#2). */
async function relinkFolder(): Promise<void> {
  const p = project();
  if (!p || st.busy) return;
  const path = await chooseFolder();
  if (!path) return;
  st.busy = "Finding your folder";
  render();
  try {
    const moved = await api({ method: "relinkProject", projectId: p.id, path });
    st.projects = st.projects.map((x) => (x.id === p.id ? moved : x));
    st.projectId = moved.id;
    st.copyMade = null;
    await refreshStatuses();
    await loadTimeline();
    toast(`Found it. ${moved.name} is at ${moved.path} now, with its history.`);
  } catch (e) {
    toast(msg(e));
  }
  st.busy = null;
  render();
}

/** "Bring back a copy…" for a folder that is gone: choose where the copy goes, then the version is copied there (writer#1). */
async function copyElsewhere(id: string): Promise<void> {
  const p = project();
  if (!p || !entry(id) || st.busy) return;
  const dest = await chooseFolder();
  if (!dest) return;
  st.busy = "Making a copy";
  render();
  try {
    const r = await api({ method: "recover", projectId: p.id, id, dest });
    st.copyMade = { projectId: p.id, dir: r.copyDir };
    toast(`A copy of ${pointName(id)} is ready.`, null, { action: { label: revealLabel(), run: () => void bridge.call({ method: "reveal", path: r.copyDir }) } });
  } catch (e) {
    toast(msg(e));
  }
  st.busy = null;
  render();
}

/** The Thin old auto saves line under a project's Storage row: reading, the preview with Review and Remove N, or what went. */
function thinRow(projectId: string): string {
  const t = st.thin?.projectId === projectId ? st.thin : null;
  if (!t) return "";
  if (t.working) return `<div class="b9-ask th-ask">${LOADING}</div>`;
  if (t.removed !== null) return `<div class="b9-ask th-ask"><span class="b9-done" role="status" tabindex="-1" id="thin-result-${projectId}">${esc(t.removed ? `Removed ${plural(t.removed, "auto save")}.` : "Nothing was removed.")}</span></div>`;
  if (!t.preview) return "";
  const n = t.preview.remove.length;
  const acts = n
    ? `<span class="row-btns"><button class="btn quiet" data-act="thin-review" data-id="${projectId}" aria-expanded="${t.review}">${t.review ? "Hide the list" : "Review"}</button><button class="btn quiet" data-act="thin-cancel" data-id="${projectId}">Never mind</button><button class="btn dark" data-act="thin-ask" data-id="${projectId}">${esc(`Remove ${n}`)}</button></span>`
    : `<span class="row-btns"><button class="btn quiet" data-act="thin-cancel" data-id="${projectId}">OK</button></span>`;
  return `<div class="b9-ask th-ask"><p class="b9-would" id="thin-line-${projectId}" tabindex="-1">${esc(thinSummary(t.preview))}</p>${acts}${t.review && n ? thinReview(t.preview) : ""}</div>`;
}

/** Reads which auto saves could go. Nothing is removed here. */
async function thinPreview(projectId: string): Promise<void> {
  if (st.thin?.working) return;
  st.thin = { projectId, working: true, preview: null, review: false, removed: null };
  render();
  try {
    const preview = await api({ method: "thinPreview", projectId });
    st.thin = { projectId, working: false, preview, review: false, removed: null };
  } catch (e) {
    st.thin = null;
    toast(msg(e));
  }
  render();
  document.getElementById(`thin-line-${projectId}`)?.focus({ preventScroll: true });
}

/** Removes exactly the previewed auto saves (the engine refuses any other id), then reads Storage and History again. */
async function thinApply(projectId: string): Promise<void> {
  const t = st.thin?.projectId === projectId ? st.thin : null;
  if (!t?.preview || t.working) return;
  const ids = t.preview.remove.map((r) => r.id);
  st.thin = { ...t, working: true };
  render();
  try {
    const r = await api({ method: "thinApply", projectId, ids });
    st.thin = { projectId, working: false, preview: null, review: false, removed: r.removed };
    st.storage = await api({ method: "storage" });
    if (st.projectId === projectId) await loadTimeline();
  } catch (e) {
    st.thin = { ...t, working: false };
    toast(msg(e));
  }
  render();
  document.getElementById(`thin-result-${projectId}`)?.focus({ preventScroll: true });
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
    else if (result.files.length) {
      // The choice is now Never mind or Remove them. Never mind gets focus, so Enter right away keeps the logs.
      render();
      root.querySelector<HTMLElement>(`[data-act="clean-cancel"][data-id="${CSS.escape(projectId)}"]`)?.focus();
      return;
    }
  } catch (e) {
    st.cleanup = null;
    toast(msg(e));
  }
  render();
  // The pressed button is gone (replaced by "Removed …" or "No old check logs to remove."), so focus goes to that line, not <body>.
  document.getElementById(`clean-result-${projectId}`)?.focus({ preventScroll: true });
}

/**
 * Opens the Add flow at "What do you want to protect?". From Sources, `path` prefills the folder and `purpose` is the one
 * that fits that folder: the flow then opens on the folder step with both filled in, and Back still changes the purpose.
 */
function startAdd(path: string | null = null, purpose: Purpose | null = null): void {
  addReturn = { screen: st.screen === "onboarding" ? (project() ? "history" : "welcome") : st.screen, focus: focusKey() };
  // On a full free plan step 1 says so first, even when a Sources row already chose what the folder is for.
  st.onboarding = { ...emptyOnboarding(), path, purpose, step: purpose && !addFull() ? 2 : 1 };
  st.screen = "onboarding";
  render();
  if (st.onboarding.step === 2) root.querySelector<HTMLInputElement>('[data-model="ob-path"]')?.focus();
  else if (addFull()) root.querySelector<HTMLElement>("#ad-full .btn")?.focus();
  else root.querySelector<HTMLElement>(".ad-card")?.focus();
}

function cancelAdd(): void {
  if (st.onboarding.working || st.onboarding.trying) return;
  obDrop();
  st.screen = addReturn?.screen ?? (project() ? "history" : "welcome");
  st.onboarding = emptyOnboarding();
  render();
  if (addReturn?.focus) root.querySelector<HTMLElement>(addReturn.focus)?.focus();
  addReturn = null;
}

async function onClick(el: HTMLElement): Promise<void> {
  const d = el.dataset;
  // Any action closes an open ⋯ menu and the palette. Opening them is the only exception.
  if (d.act !== "menu") st.menu = null;
  if (d.act !== "palette") st.palette = null;
  if (d.act !== "nav-toggle") st.navOpen = false;
  switch (d.act) {
    case "skip": {
      const page = root.querySelector<HTMLElement>("main .page") ?? root.querySelector<HTMLElement>("main");
      if (page && !page.hasAttribute("tabindex")) page.tabIndex = -1;
      return void page?.focus({ preventScroll: true });
    }
    case "page-retry":
      if (isAppPage(st.screen)) return openPage(st.screen);
      return;
    case "nav-toggle":
      st.navOpen = !st.navOpen;
      return render();
    case "nav-close":
      return render();
    case "reconnect":
      window.location.reload();
      return;
    case "ob-cancel":
      return cancelAdd();
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
      render();
      return refocus("");
    case "project":
      if (d.id) await selectProject(d.id);
      return;
    case "source-add": {
      const row = st.sources !== "error" ? st.sources?.find((x) => x.id === d.id) : undefined;
      const purpose = row ? SOURCE_PURPOSE[row.id] : null;
      // A whole Documents, Desktop or cloud folder: offer a smaller folder before all of it (writer#31).
      if (row && WHOLE_FOLDER[row.id]) {
        st.confirm = { ...wholeFolderAsk(row.label), action: "Protect all of it", act: "whole-folder", id: null, path: row.path, purpose };
        return render();
      }
      return startAdd(d.path ?? null, purpose);
    }
    case "pin":
      if (d.id) await togglePin(d.id);
      return;
    case "journal-filter":
      st.journalFilter = d.v === "pinned" ? "pinned" : "all";
      render();
      return refocus(`[data-act="journal-filter"][data-v="${st.journalFilter}"]`);
    case "labs":
      st.labs = !st.labs;
      try {
        localStorage.setItem(LABS_KEY, st.labs ? "on" : "off");
      } catch {
        // A browser that keeps nothing still shows the preview for this visit.
      }
      render();
      return refocus('[data-act="labs"]');
    case "add":
      return startAdd();
    case "demo":
      return runDemo();
    case "overview":
    case "plan":
    case "sources":
    case "agents":
    case "storage":
    case "settings":
      return openPage(d.act);
    case "settings-section":
      settingsSection = d.v ?? "appearance";
      if (st.screen !== "settings") return openPage("settings");
      render();
      document.querySelector(".page")?.scrollTo(0, 0);
      return;
    case "now":
      return backToNow();
    case "find":
      return startRewind(undefined, true);
    case "inspector":
      return toggleInspector();
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
      if (st.coach?.went) st.coach = null;
      render();
      return refocusRuler();
    case "coach-hide":
      st.coach = null;
      render();
      return refocusRuler();
    case "tv-go":
      return tvGo(d.id);
    case "tv-try":
      return tvTry();
    case "tv-use":
      return rewindDo();
    case "tv-use-anyway": {
      const r = st.rewind;
      const c = r?.target ? entry(r.target) : null;
      if (!c || st.busy) return;
      const why = c.verdict === "FAIL" ? "Its check failed, so it may not work." : c.verdict ? "Its check did not pass, so it may not work." : "It is not checked, so we don’t know if it works.";
      st.confirm = {
        act: "tv-use", id: c.id, action: "Go back anyway",
        title: `Go back to ${pointName(c.id)} without a check that passed?`,
        body: anywayBody(why, project()?.kind === "folder"),
      };
      return render();
    }
    case "confirm-cancel":
      st.confirm = null;
      return render();
    case "confirm-do": {
      const c = st.confirm;
      st.confirm = null;
      render();
      if (c?.act === "tv-use") return rewindDo();
      if (c?.act === "remove" && c.id) return removeProject(c.id);
      if (c?.act === "forget" && c.id) return forgetProject(c.id);
      if (c?.act === "thin" && c.id) return thinApply(c.id);
      if (c?.act === "whole-folder") return startAdd(c.path ?? null, c.purpose ?? null);
      if (c?.act === "restore" && c.id) return putBack(c.id, pathList(c.path ?? "[]"));
      return;
    }
    case "whole-pick": {
      const c = st.confirm;
      st.confirm = null;
      render();
      if (c?.act !== "whole-folder") return;
      // The Mac's chooser; elsewhere the Add flow opens on the folder's path, to be typed further.
      if (st.boot.platform !== "darwin") return startAdd(`${c.path ?? ""}/`, c.purpose ?? null);
      const path = await chooseFolder();
      if (path) startAdd(path, c.purpose ?? null);
      return;
    }
    case "tv-compare":
      if (st.rewind?.target) return openCompare(st.rewind.target, "now");
      return;
    case "rewind-style":
      return setSetting({ simpleRewind: d.v === "sheet" });
    case "reload":
      // Everything that goes with the list is read again with it: names, what changed, the status.
      st.changesFor = "";
      await Promise.all([loadTimeline(), refreshStatuses()]);
      return render();
    case "open": {
      // From the palette on another screen: show History first, then the drawer.
      if (st.screen !== "history") {
        st.screen = "history";
        st.rewind = null;
      }
      if (st.selected !== d.id) st.openResult = null;
      // Picked in Jump to, or a row opened with Enter: focus goes into the detail it opened, on Close, as a phone's sheet does
      // (writer#26). A row clicked with the pointer keeps it, so the next click lands where the eye is.
      const into = !!el.closest(".pal") || el.matches(":focus-visible");
      st.selected = d.id ?? null;
      st.drawer = true;
      render();
      if (into) root.querySelector<HTMLElement>('.rcol.detail [data-act="close-drawer"]')?.focus({ preventScroll: true });
      return;
    }
    case "close-drawer":
      return closeDrawer();
    case "ask-toggle":
      st.askOpen = !st.askOpen;
      if (st.askOpen) st.drawer = false;
      render();
      return st.askOpen ? focusAsk() : refocus(ASK_BACK);
    case "unfold":
      if (d.id) st.unfolded.add(d.id);
      return render();
    case "save":
      return saveNow();
    case "check":
      return checkNow();
    case "verify-one":
      return checkNow(d.id);
    case "stop-check": {
      const p = project();
      if (p) void bridge.call({ method: "stopCheck", projectId: p.id });
      return;
    }
    case "tip-hide":
      return hideVerdictTip();
    case "close-check":
      return closeCheck();
    case "rewind":
      return startRewind();
    case "rewind-to":
    case "use":
      return startRewind(d.id);
    case "rw-open":
      return rewindOpen();
    case "put-back": {
      const c = d.id ? entry(d.id) : null;
      if (!c || st.busy) return;
      // One file (data-path) or a list (data-paths, JSON): every Put-back button names what it puts back.
      const paths = d.path ? [d.path] : d.paths ? pathList(d.paths) : [];
      if (!paths.length) return;
      const what = paths.length === 1 ? paths[0] : `all ${paths.length} files`;
      st.confirm = {
        act: "restore", id: c.id, path: JSON.stringify(paths), action: paths.length === 1 ? "Put it back" : "Put them back",
        title: `Put ${what} back from ${pointName(c.id)}?`,
        body: "We save what is in your folder first, so today's version stays in History. Files that are not in that save point are left alone, and nothing is deleted.",
      };
      return render();
    }
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
        const r = await bridge.call({ method: "copy", text: d.path });
        toast(r.ok ? "Local path copied. Open it in your editor or file manager." : r.error.message);
      }
      return;
    case "store-add":
      // A folder that already has history: the Add flow opens on the folder step with its path filled in.
      return startAdd(d.path ?? null);
    case "reveal-dir":
      // A copy's folder opens in Finder; where that can't happen, its path is copied instead.
      if (d.path) {
        const r = await bridge.call({ method: "reveal", path: d.path });
        if (!r.ok) {
          const c = await bridge.call({ method: "copy", text: d.path });
          toast(c.ok ? "Local path copied. Open it in your file manager." : r.error.message);
        }
      }
      return;
    case "relink":
      return relinkFolder();
    case "copy-elsewhere":
      if (d.id) await copyElsewhere(d.id);
      return;
    case "copy":
      if (d.text !== undefined) {
        const r = await bridge.call({ method: "copy", text: d.text });
        toast(r.ok ? "Copied." : r.error.message);
      }
      return;
    case "copy-report":
      if (d.path) {
        try {
          const text = await api({ method: "readReport", path: d.path });
          const copied = await bridge.call({ method: "copy", text });
          toast(copied.ok ? "Recovery report copied as Markdown." : copied.error.message);
        } catch (e) {
          toast(msg(e));
        }
      }
      return;
    case "license-remove":
      return removeLicenseKey();
    case "signin-resend":
      return sendSignInCode();
    case "signin-restart":
    case "signin-signout": {
      // Leaving the keys list ends the sign-in: the server forgets its token, so a different email starts clean.
      const out = d.act === "signin-signout" || st.account.step === "keys";
      if (out) {
        try {
          await api({ method: "signOut" });
        } catch (e) {
          toast(msg(e));
          return;
        }
      }
      // The site limits sends per computer, not per email, so the wait before another code carries over.
      st.account = { ...SIGNED_OUT, site: st.account.site, email: d.act === "signin-signout" ? "" : st.account.email, sentAt: st.account.sentAt };
      render();
      if (d.act === "signin-signout") toast("Signed out. A key you saved stays on this computer.", null);
      root.querySelector<HTMLInputElement>("#signin-email")?.focus();
      return;
    }
    case "account-use":
      if (d.id) await useAccountKey(d.id);
      return;
    case "license-buy":
      return void bridge.call({ method: "openExternal", url: PRICING_URL });
    case "theme":
      return setSetting({ theme: d.v === "light" || d.v === "dark" ? d.v : "system" });
    case "toggle":
      if (d.key === "showGitDetails") return setSetting({ showGitDetails: !st.settings.showGitDetails });
      if (d.key === "reduceMotion") return setSetting({ reduceMotion: !st.settings.reduceMotion });
      return;
    case "reduce-motion":
      // From Jump to: the same switch as Settings > Appearance. Nothing on screen may move to show it, so a toast says it.
      await setSetting({ reduceMotion: !st.settings.reduceMotion });
      toast(st.settings.reduceMotion ? "Reduce motion is on." : "Reduce motion is off.");
      return refocus('[data-act="palette"]');
    case "thin-preview":
      if (d.id) await thinPreview(d.id);
      return;
    case "thin-review": {
      const t = st.thin;
      if (t && t.projectId === d.id) t.review = !t.review;
      render();
      return refocus(`[data-act="thin-review"][data-id="${d.id ?? ""}"]`);
    }
    case "thin-cancel":
      st.thin = null;
      render();
      return refocus(`[data-act="thin-preview"][data-id="${d.id ?? ""}"]`);
    case "thin-ask": {
      const name = st.projects.find((x) => x.id === d.id)?.name;
      const t = st.thin;
      const preview = t && t.projectId === d.id ? t.preview : null;
      if (!d.id || !name || !preview?.remove.length) return;
      st.confirm = { ...thinConfirm(name, preview), act: "thin", id: d.id };
      return render();
    }
    case "clean-preview":
      if (d.id) await cleanStore(d.id, false);
      return;
    case "clean-apply":
      if (d.id) await cleanStore(d.id, true);
      return;
    case "clean-cancel":
      st.cleanup = null;
      render();
      if (d.id) root.querySelector<HTMLElement>(`[data-act="clean-preview"][data-id="${CSS.escape(d.id)}"]`)?.focus();
      return;
    case "setup-hide":
      if (d.id) await setSetting({ setupHidden: [...st.settings.setupHidden.filter((x) => x !== d.id), d.id] });
      return render();
    case "remove": {
      const name = st.projects.find((x) => x.id === d.id)?.name;
      if (!d.id || !name) return;
      st.confirm = {
        act: "remove", id: d.id, action: "Remove from app",
        title: `Remove ${name} from the app?`,
        body: "The app stops showing it. Its save points stay in the store on this computer, and your project folder is not touched. Add it again any time.",
      };
      return render();
    }
    case "forget": {
      const name = st.projects.find((x) => x.id === d.id)?.name;
      if (!d.id || !name) return;
      st.confirm = {
        act: "forget", id: d.id, action: "Disconnect",
        title: `Disconnect Claude Code from ${name}?`,
        body: "Claude Code stops saving and checking here. This computer stops approving the project’s check, so the Time Machine plugin does nothing in it, and the lines Time Machine added to .claude/settings.json come out. Other tools’ hooks stay, and so do the save points. Connect again any time.",
      };
      return render();
    }
    case "hook":
      if (d.id) await openHookSheet(d.id);
      return;
    case "approve-check":
      if (d.id) await approveCheck(d.id);
      return;
    case "hook-do":
      return doHook();
    case "hook-close": {
      const id = st.hookSheet?.projectId;
      st.hookSheet = null;
      // Connecting from History's setup strip or from Agents: either way the rail and the strip read it again.
      st.agents = await api({ method: "agents" }).catch(() => st.agents);
      render();
      // A connect replaces the button that opened the sheet. Focus goes to that project's next button, else the page heading.
      return refocus(id ? `[data-act="hook"][data-id="${CSS.escape(id)}"], [data-act="approve-check"][data-id="${CSS.escape(id)}"]` : "");
    }
    case "ob-next1":
      return obNext1();
    case "ob-choice":
      if (d.v === "detected" || d.v === "build" || d.v === "custom" || d.v === "none") st.onboarding.choice = d.v;
      return render();
    case "ob-autosave":
      if (d.v === "change" || d.v === "off") st.onboarding.autoSave = d.v;
      render();
      return refocus(st.onboarding.preview?.kind === "folder" ? `[data-act="ob-autosave"][data-v="${st.onboarding.autoSave}"]` : '[data-act="ob-autosave"]');
    case "ob-purpose": {
      const picked = Object.keys(PURPOSES).find((k): k is Purpose => k === d.v);
      if (!picked) return;
      st.onboarding = { ...st.onboarding, purpose: picked, step: 2, error: null };
      render();
      root.querySelector<HTMLInputElement>('[data-model="ob-path"]')?.focus();
      return;
    }
    case "ob-try":
      return obTry();
    case "ob-next2":
      return obNext2();
    case "ob-pick": {
      // The Mac's folder chooser; a chosen folder goes straight on, as typing it and pressing Next would.
      const path = await chooseFolder();
      if (!path || st.screen !== "onboarding" || st.onboarding.step !== 2) return;
      st.onboarding.path = path;
      return obNext1();
    }
    case "ob-back": {
      const o = st.onboarding;
      if (o.working || o.trying) return;
      // Back to the folder takes out a project the flow already added, so the list counts only what was finished.
      if (o.step === 3) obDrop();
      o.step = o.step === 4 ? 3 : o.step === 3 ? 2 : 1;
      o.error = null;
      return render();
    }
    case "ob-connect-finish":
      return obConnectFinish();
    case "ob-finish":
      return obFinish();
    case "preview":
      opts.previewActions?.[Number(d.i)]?.run();
      return;
    default:
      return;
  }
}

/** The in-page keyboard shortcuts. */
type ShortcutAction = "save" | "check" | "rewind" | "inspector" | "settings" | "add" | "compare";

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
      return toggleInspector();
    case "settings":
      // Focus lands on the page's heading, so Tab goes into Settings instead of walking the rail first.
      void openPage("settings").then(() => root.querySelector<HTMLElement>(".set-nav h1")?.focus());
      return;
    case "add":
      return startAdd();
  }
}

/** The Rewind's own keys, in the Time View and the plain sheet. Returns true when the key was used. */
function rewindKey(e: KeyboardEvent): boolean {
  const r = st.rewind;
  const mod = isMac() ? e.metaKey : e.ctrlKey;
  // ⌘↵ is the main key's own shortcut, wherever focus is in the Rewind. Plain Enter does the same away from a button.
  const modEnter = mod && e.key === "Enter" && !e.shiftKey && !e.altKey;
  if (!r || st.screen !== "rewind") return false;
  // ⌘Z on the Done step: the sheet is modal, so the page's ⌘Z never sees it. Same rule as there: only while Undo is offered.
  if (mod && e.key.toLowerCase() === "z" && !e.shiftKey && !e.altKey && r.step === "done") {
    if (st.undo && !st.undo.working) {
      flash('[data-act="undo-rewind"]');
      void undoRewind();
    }
    return true;
  }
  if ((e.metaKey || e.ctrlKey || e.altKey) && !modEnter) return false;
  const k = e.key;
  if (k === "Escape") {
    flash('[data-key="esc"]');
    if (!r.recovering) exitRewind();
    return true;
  }
  if (k === "Enter") {
    if (!modEnter && e.target instanceof HTMLElement && e.target.closest("button, summary, a[href]")) return false;
    // Enter never waits for an animation. It does the main action now: Use when proven, else Try.
    flash('[data-key="enter"]');
    if (r.finding || r.trying || r.recovering || st.busy) return true;
    if (r.step === "done" || (r.find && !r.find.found && !r.target)) {
      exitRewind();
      return true;
    }
    const c = entry(r.target);
    if (!c) return true;
    if (REVIEW_KEY[reviewKey(checksOn(project()), shownVerdict(c), !!r.tryResult && r.tryResult.checkpoint === c.id)].act === "tv-use") void rewindDo();
    else void tvTry();
    return true;
  }
  if (r.finding || r.trying || r.recovering || r.step === "done") return false;
  const lower = k.toLowerCase();
  const arrow = k.startsWith("Arrow") || k === "Home" || k === "End";
  if (arrow && !(e.target instanceof HTMLElement && e.target.classList.contains("knob"))) return false;
  const scene = r.mode === "scene";
  if (scene && (lower === "j" || k === "ArrowLeft" || k === "ArrowDown")) tvStep(e.shiftKey ? "prevChange" : "back");
  else if (scene && (lower === "l" || k === "ArrowRight" || k === "ArrowUp")) tvStep(e.shiftKey ? "nextChange" : "forward");
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
  const t = e.target;
  // Any key puts the History ruler back to keyboard focus, so its ring and flag show again.
  if (rulerByPointer) {
    rulerByPointer = false;
    root.querySelector(".hruler")?.classList.remove("by-pointer");
  }
  const typing = t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable);
  if (dialogFocus.trapTab(e)) return;
  if (paletteKey(e)) return;
  if (roveKey(e)) return;
  if (st.keysSheet && (k === "escape" || k === "?")) {
    st.keysSheet = false;
    render();
    refocus("");
    return;
  }
  const modal = dialogFocus.current;
  if (modal && !modal.matches(".tv, .rw-sheet")) {
    if (k === "escape") {
      e.preventDefault();
      if (st.confirm) st.confirm = null;
      else if (st.check && (st.check.phase === "done" || st.check.error)) return closeCheck();
      else if (st.hookSheet && !st.hookSheet.working) st.hookSheet = null;
      else if (st.navOpen) st.navOpen = false;
      else if (st.inspector) st.inspector = false;
      else if (st.drawer) st.drawer = false;
      else if (st.askOpen) {
        st.askOpen = false;
        render();
        return refocus(ASK_BACK);
      }
      render();
    }
    return;
  }
  if (mod && k === "k") return void (e.preventDefault(), openPalette());
  if (mod && k === "j" && PROJECT_SCREENS.includes(st.screen) && st.screen !== "rewind" && project()) {
    e.preventDefault();
    st.askOpen = !st.askOpen;
    if (st.askOpen) st.drawer = false;
    render();
    if (!st.askOpen) refocus(ASK_BACK);
    else if (window.innerWidth >= 1100) focusAsk();
    else root.querySelector<HTMLElement>(".ask-mount textarea, .ask-mount input, .ask-mount button")?.focus();
    return;
  }
  if (k === "?" && !typing && !mod) return void (e.preventDefault(), (st.keysSheet = true), render());
  if (k === "escape" && st.menu) {
    // Back to the ⋯ that opened it: a menu item can share its action with a toolbar button, so focus by action would land there.
    const menu = st.menu;
    st.menu = null;
    render();
    root.querySelector<HTMLElement>(`.mn-b[data-v="${CSS.escape(menu)}"]`)?.focus({ preventScroll: true });
    return;
  }
  if (k === "escape" && st.inspector) {
    toggleInspector(false);
    return;
  }
  if (k === "escape" && st.screen === "onboarding" && st.onboarding.step <= 2 && !st.onboarding.project) {
    e.preventDefault();
    cancelAdd();
    return;
  }
  if (!typing && rewindKey(e)) {
    e.preventDefault();
    return;
  }
  if (modal) return;
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
    if (st.check && (st.check.phase === "done" || st.check.error)) return closeCheck();
    else if (st.hookSheet && !st.hookSheet.working) st.hookSheet = null;
    else if (st.drawer && st.screen === "history") return closeDrawer();
    else if (st.askOpen && t instanceof Element && t.closest(".ask-col")) {
      // Beside the page Ask stays open: Esc from inside it goes back to the Ask button, as Hide and ⌘J do.
      render();
      return void root.querySelector<HTMLElement>(".toolbar .ask-t")?.focus({ preventScroll: true });
    } else if (st.askOpen && window.innerWidth < 1100 && PROJECT_SCREENS.includes(st.screen)) {
      st.askOpen = false;
      render();
      return refocus(ASK_BACK);
    }
    render();
    return;
  }
  if (typing || st.screen !== "history" || st.check) return;
  if (t instanceof HTMLButtonElement && (k === "enter" || k === " ")) return;
  const pts = points();
  const found = pts.findIndex((c) => c.id === st.selected);
  // Nothing selected means the playhead is on Now, so the first step back is the save point before it.
  const i = found < 0 ? pts.length - 1 : found;
  const onRuler = t instanceof HTMLElement && t.classList.contains("hruler");
  const to = (how: Step): string | null => pts[stepIndex(pts.map((c) => verdictKey(c.verdict)), i, how)]?.id ?? st.selected;
  // History list is newest first, so Down goes back in time. With Shift, a step goes to where the verdict changed.
  if (k === "arrowdown" || k === "j" || k === "arrowleft") st.selected = to(e.shiftKey ? "prevChange" : "back");
  else if (k === "arrowup" || k === "l" || k === "arrowright") st.selected = to(e.shiftKey ? "nextChange" : "forward");
  else if (onRuler && (k === "home" || k === "end")) st.selected = to(k === "home" ? "first" : "last");
  else if (k === "c" && st.selected) return void openCompare(st.selected, "now");
  else if (k === " " && st.selected) return void (e.preventDefault(), startRewind(st.selected));
  else if (k === "enter" && (st.selected || onRuler) && !(e.target instanceof HTMLButtonElement)) {
    st.selected = pts[i]?.id ?? null;
    st.drawer = true;
  } else return;
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
        if (st.screen === "overview") await loadOverview();
        if (!st.busy) render();
      });
      return;
    case "saved": {
      // A save that left files out says so at once, with the way to see the save point (writer#5). The list itself
      // arrives with the "changed" event that follows.
      if (!ev.skipped.length) return;
      const name = st.projects.find((x) => x.id === ev.projectId)?.name ?? "A project";
      const shown = ev.skipped.slice(0, 2).map(shortSkip).join("; ");
      const more = ev.skipped.length > 2 ? ` and ${ev.skipped.length - 2} more` : "";
      toast(`${name} was saved, but some files were left out: ${shown}${more}.`, null, { action: { label: "See what", run: () => void openSavePoint(ev.projectId, ev.checkpoint) } });
      return;
    }
    case "settings":
      st.settings = ev.settings;
      applyAppearance();
      render();
      return;
  }
}

export async function start(b: TmBridge, o: StartOptions): Promise<void> {
  bridge = b;
  opts = o;
  const el = document.getElementById("root");
  if (!el) return;
  root = el;
  // Keep this node outside the redraw tree so assistive technology observes text updates.
  announcer = document.createElement("div");
  announcer.id = "app-announcements";
  announcer.className = "sr-only";
  announcer.setAttribute("role", "status");
  announcer.setAttribute("aria-live", "polite");
  announcer.setAttribute("aria-atomic", "true");
  document.body.append(announcer);
  toastHost = document.createElement("div");
  toastHost.className = "toast-host";
  toastHost.setAttribute("role", "status");
  document.body.append(toastHost);
  const boot = await b.call({ method: "bootstrap" });
  if (!boot.ok) {
    // The splash would otherwise fade out over the error for most of a second; the error is the screen now.
    document.getElementById("splash")?.remove();
    root.innerHTML = `<main class="launch-error">${buddy("big")}<h1>Can’t connect to Time Machine</h1><div class="note bad fail-card"><p role="alert">${esc(boot.error.message)}</p><p class="fail-how">Keep tm ui running in your terminal and reopen the complete local URL it printed.</p><div class="row-btns"><button class="btn dark" id="retry-launch">Try again</button></div></div></main>`;
    root.querySelector("#retry-launch")?.addEventListener("click", () => window.location.reload());
    return;
  }
  st = {
    boot: boot.data, settings: boot.data.settings, projects: boot.data.projects, statuses: new Map(), projectId: boot.data.projects[0]?.id ?? null,
    screen: boot.data.projects.length ? "overview" : "welcome", timeline: null, timelineError: null, selected: null, busy: null, check: null, rewind: null,
    compare: { a: null, b: null, now: null, result: null, loading: false, error: null }, onboarding: emptyOnboarding(), inspector: false, drawer: false,
    navOpen: false, pageError: null, connection: (window as Window & { tmConnection?: State["connection"] }).tmConnection ?? null,
    askOpen: false, unfolded: new Set(), lit: null, lastTurn: new Map(), deployChips: new Map(),
    menu: null, palette: null, keysSheet: false, records: [], storage: null,
    agents: null, overview: new Map(), sources: null, labs: false, notes: new Map(), journalFilter: "all", noteDraft: null, noteSaving: false, isolation: null, cleanup: null, thin: null,
    hookSheet: null, demoBusy: false, coach: null, openResult: null, verifyResults: new Map(), logTails: new Map(), storedChecks: new Map(), changes: new Map(), passes: new Map(), changesFor: "", confirm: null, flash: null, undo: null,
    license: { status: boot.data.license, draft: "", working: false, error: null },
    account: { ...SIGNED_OUT },
    copyMade: null,
    askProvider: undefined,
    storeProjects: null,
  };
  if (isMac()) document.documentElement.classList.add("mac");
  document.documentElement.classList.add("browser-runtime");
  applyAppearance();
  try {
    st.labs = localStorage.getItem(LABS_KEY) === "on";
    // The page this tab was on before a reload or Reconnect (route.ts).
    const kept = restoreRoute(sessionStorage.getItem(ROUTE_KEY), st.projects.map((p) => p.id));
    if (kept) Object.assign(st, { screen: kept.screen, projectId: kept.projectId ?? st.projectId, drawer: kept.drawer, selected: kept.selected });
  } catch {
    // Storage can be off; the app then starts on Overview, and Sources without the labs rows.
  }
  // Whatever was drawn under the launch splash arrives again as it lifts: the page, its ruler's beads, its rows.
  window.addEventListener(SPLASH_OUT, () => {
    pageIn = { key: "", at: 0 };
    journalIn.clear();
    rulerIn.clear();
    render();
  }, { once: true });
  // Where a press landed, so a sheet, menu or column that opens from it grows out of that spot.
  root.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest("[data-act]");
    if (!el) return;
    const r = el.getBoundingClientRect();
    lastPress = { x: r.left + r.width / 2, y: r.top + r.height / 2, at: performance.now() };
  }, true);
  root.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("nav-scrim")) {
      st.navOpen = false;
      render();
      return;
    }
    if (target.classList.contains("scrim") && st.check && (st.check.phase === "done" || st.check.error)) {
      closeCheck();
      return;
    }
    if (target.classList.contains("scrim") && (st.palette || st.keysSheet || st.confirm)) {
      const pal = !!st.palette;
      st.palette = null;
      st.keysSheet = false;
      st.confirm = null;
      render();
      refocus(pal ? '[data-act="palette"]' : "");
      return;
    }
    // Feature panels handle their own clicks.
    if (target.closest(".mount")) return;
    const act = target.closest<HTMLElement>("[data-act]");
    if (act && !(act instanceof HTMLButtonElement && act.disabled)) void onClick(act);
    else if (st.menu && !target.closest(".mn-l")) {
      st.menu = null;
      render();
    }
  });
  root.addEventListener("submit", (e) => {
    if (!(e.target instanceof HTMLFormElement)) return;
    if (e.target.dataset.form === "signin-email" || e.target.dataset.form === "signin-code") {
      e.preventDefault();
      void (e.target.dataset.form === "signin-email" ? sendSignInCode() : verifySignIn());
      return;
    }
    if (e.target.dataset.form === "license") {
      e.preventDefault();
      void saveLicense();
      return;
    }
    if (e.target.dataset.form === "note") {
      e.preventDefault();
      if (e.target.dataset.id) void saveNote(e.target.dataset.id);
      return;
    }
    if (e.target.dataset.form !== "local-project") return;
    e.preventDefault();
    void obNext1();
  });
  root.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.model === "ob-path") {
      st.onboarding.path = t.value;
      return;
    }
    if (t.dataset.model === "note-title" || t.dataset.model === "note-text") {
      const form = t.closest<HTMLFormElement>('form[data-form="note"]');
      const id = form?.dataset.id;
      if (!form || !id) return;
      st.noteDraft = { id, title: form.querySelector<HTMLInputElement>('[data-model="note-title"]')?.value ?? "", note: form.querySelector<HTMLTextAreaElement>('[data-model="note-text"]')?.value ?? "" };
      // No redraw while typing: the count and the button's words change in place.
      const count = form.querySelector("#rn-count");
      if (count) count.textContent = nameCount(st.noteDraft.title);
      const save = form.querySelector<HTMLButtonElement>('[type="submit"]');
      if (save && !st.noteSaving) save.textContent = noteSaveWords(st.noteDraft, st.notes.get(id)).button;
      return;
    }
    if (t.dataset.model === "signin-email") {
      st.account.email = t.value;
      return;
    }
    if (t.dataset.model === "signin-code") {
      st.account.code = t.value;
      return;
    }
    if (t.dataset.model === "license-key") {
      st.license.draft = t.value;
      return;
    }
    if (t.dataset.model === "pal" && st.palette) {
      st.palette = { q: t.value, i: 0 };
      drawPaletteList();
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
  let layoutBand = window.innerWidth < RAIL_MIN ? 0 : window.innerWidth < 1100 ? 1 : 2;
  // Labels are measured; measure them again once the mono font is in, since its widths differ from the fallback's.
  void document.fonts?.ready.then(() => {
    fitRulerLabels();
    fitDialLabels();
  });
  window.addEventListener("resize", () => {
    const band = window.innerWidth < RAIL_MIN ? 0 : window.innerWidth < 1100 ? 1 : 2;
    if (band !== layoutBand) {
      layoutBand = band;
      if (band !== 0) st.navOpen = false;
      render();
    } else {
      fitSessions();
      fitRulerLabels();
      fitDialLabels();
    }
    const shown = toastHost.querySelector<HTMLElement>(".toast:not(.leave)");
    if (shown) toastRoom(shown);
  });
  window.addEventListener("tm:connection", (e) => {
    const before = st.connection?.state;
    st.connection = (e as CustomEvent<NonNullable<State["connection"]>>).detail;
    render();
    if (st.connection.state === "connected" && before === "disconnected") {
      void (async () => {
        const fresh = await bridge.call({ method: "bootstrap" });
        if (fresh.ok) {
          st.projects = fresh.data.projects;
          st.settings = fresh.data.settings;
          applyAppearance();
        }
        await refreshStatuses();
        if (st.projectId) await loadTimeline();
        render();
      })();
    }
  });
  // The dial: press and drag around it, or scroll over it. It moves the selection only.
  const dialTo = (e: PointerEvent): void => {
    const dial = root.querySelector<HTMLElement>(".dial");
    if (!dial) return;
    const r = dial.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) > 24) tvGo(sceneIds[dialIndex(dx, dy, sceneIds.length)]);
  };
  root.addEventListener("pointerdown", (e) => {
    const dial = (e.target as HTMLElement).closest<HTMLElement>(".dial");
    if (!dial || dial.classList.contains("still") || e.button !== 0) return;
    e.preventDefault();
    dialDrag = true;
    dial.classList.add("drag");
    dialTo(e);
  });
  window.addEventListener("pointermove", (e) => {
    if (dialDrag) dialTo(e);
  });
  window.addEventListener("pointerup", () => {
    if (!dialDrag) return;
    dialDrag = false;
    root.querySelector(".dial")?.classList.remove("drag");
    root.querySelector<HTMLElement>(".knob")?.focus({ preventScroll: true });
  });
  // The History ruler: press anywhere along it and drag. The save point under the pointer is selected as
  // it moves, and letting go opens it. Only a change of save point redraws.
  const scrubHistory = (e: PointerEvent): void => {
    const ruler = root.querySelector<HTMLElement>(".hruler");
    const pts = rulerWindow(points());
    if (!ruler || !pts.length) return;
    const box = ruler.getBoundingClientRect();
    const i = nearestTick(pts.map((_, k) => homeX(k, pts.length)), ((e.clientX - box.left) / box.width) * 100);
    const id = pts[i]?.id;
    if (!id || id === st.selected) return;
    st.selected = id;
    render();
  };
  root.addEventListener("pointerdown", (e) => {
    const ruler = (e.target as HTMLElement).closest<HTMLElement>(".hruler");
    if (!ruler || e.button !== 0) return;
    // No text selection while dragging. Focus stays on the ruler, so the arrow keys carry on from here.
    e.preventDefault();
    ruler.focus({ preventScroll: true });
    historyScrub = true;
    rulerByPointer = true;
    ruler.classList.add("scrubbing", "by-pointer");
    scrubHistory(e);
  });
  window.addEventListener("pointermove", (e) => {
    if (historyScrub) scrubHistory(e);
  });
  window.addEventListener("pointerup", () => {
    if (!historyScrub) return;
    historyScrub = false;
    st.drawer = true;
    render();
  });
  window.addEventListener("pointercancel", () => {
    if (!historyScrub) return;
    historyScrub = false;
    render();
  });
  // The Rewind's ruler takes the same drag: the save point under the pointer goes on the stage. Focus
  // stays where it was (the dial), so the keys carry on from wherever the drag let go.
  let sceneScrub = false;
  const scrubScene = (e: PointerEvent): void => {
    const track = root.querySelector<HTMLElement>(".tv-track");
    if (!track || !sceneIds.length) return;
    const box = track.getBoundingClientRect();
    tvGo(sceneIds[nearestTick(sceneIds.map((_, k) => sceneX(k, sceneIds.length)), ((e.clientX - box.left) / box.width) * 100)]);
  };
  root.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !(e.target as HTMLElement).closest(".tv-track")) return;
    e.preventDefault();
    sceneScrub = true;
    scrubScene(e);
  });
  window.addEventListener("pointermove", (e) => {
    if (sceneScrub) scrubScene(e);
  });
  for (const end of ["pointerup", "pointercancel"] as const) {
    window.addEventListener(end, () => {
      sceneScrub = false;
    });
  }
  let lastWheel = 0;
  root.addEventListener("wheel", (e) => {
    if (!(e.target as HTMLElement).closest(".dial:not(.still)")) return;
    e.preventDefault();
    if (e.timeStamp - lastWheel < 90) return;
    lastWheel = e.timeStamp;
    tvStep(e.deltaY > 0 ? "forward" : "back");
  }, { passive: false });
  document.addEventListener(FEATURES_CHANGED, () => void loadDeployChips());
  void bridge.call({ method: "storage" }).then((r) => {
    if (r.ok && !st.storage) {
      st.storage = r.data;
      render();
    }
  });
  b.onEvent(onEvent);
  // A folder that vanishes sends no event: the statuses are read again every 5 s while the tab is shown, so the rail says
  // "Can't find it" within 5 s (writer#2). The rail's ages tick in place every 30 s, and at once when the tab is shown
  // again, since a hidden tab's timers are held back (writer#19).
  window.setInterval(() => {
    if (!document.hidden && !st.busy && st.connection?.state !== "disconnected") void pollStatuses();
  }, 5000);
  window.setInterval(tickAges, 30_000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) tickAges();
  });
  void loadAskProvider();
  document.addEventListener(FEATURES_CHANGED, () => void loadAskProvider());
  // A check set or emptied in Settings changes whether a project checks at all (checksOn), so each project's check is read again.
  document.addEventListener(FEATURES_CHANGED, () => void api({ method: "agents" }).then((a) => { st.agents = a; render(); }, () => undefined));
  await refreshStatuses();
  if (st.projectId) await loadTimeline();
  if (st.screen === "overview") await loadOverview();
  render();
  // A page kept from before the reload reads its own data, as when it is opened from the rail.
  if (isAppPage(st.screen) && st.screen !== "overview") void openPage(st.screen);
}
