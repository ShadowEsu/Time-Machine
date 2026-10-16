// Electron main process. It owns the windows, the menu bar item, the overlay and the
// global hotkey. Every engine call goes through Engine, which calls @timetm/core.
import { join } from "node:path";
import * as tm from "@timetm/core";
import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, session, shell, Tray, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from "electron";
import { CallSchema, OverlayActionSchema, type AppEvent, type Bootstrap, type OverlayAction, type OverlayContent, type ProjectEntry, type Res, type ShortcutAction, type Verdict } from "../shared/api.js";
import { verdictCard } from "../shared/cards.js";
import { verdictWord } from "../shared/format.js";
import { Engine } from "./engine.js";
import { trayIcon } from "./icon.js";
import { agentTurnStart, dotState, placeOn, projectVerdict, shouldShowBreakCard } from "./rules.js";
import { AppState } from "./state.js";
import { StoreWatcher } from "./watch.js";

const isMac = process.platform === "darwin";
const OUT = __dirname;

if (process.env.TM_DESKTOP_USER_DATA) app.setPath("userData", process.env.TM_DESKTOP_USER_DATA);

let state: AppState;
let engine: Engine;
let mainWindow: BrowserWindow | null = null;
let overlay: BrowserWindow | null = null;
let overlayReady: Promise<void> | null = null;
let pill: BrowserWindow | null = null;
let pillReady: Promise<void> | null = null;
/** The project the pill is showing, so it is only redrawn when that changes. */
let pillProject: string | null = null;
/** The display the last card or strip appeared on. Its buttons open the window there. */
let overlayDisplay: Electron.Display | null = null;
let tray: Tray | null = null;
let quitting = false;
/** The global shortcut registered right now, or null when none is. */
let activeHotkey: string | null = null;

/** What we last knew per project. */
const auditSeen = new Map<string, number>();
const lastVerdict = new Map<string, { id: string; verdict: Verdict } | null>();
/** When the agent turn in progress started, per project. Absent when no turn is in progress. */
const turnStart = new Map<string, string>();

function webPreferences(preload: string): Electron.WebPreferences {
  return { preload: join(OUT, preload), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false };
}

function lockDown(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.on("will-attach-webview", (e) => e.preventDefault());
}

function send(e: AppEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("tm:event", e);
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: "Time Machine",
    backgroundColor: "#fafafa",
    ...(isMac ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 18, y: 18 }, vibrancy: "sidebar" as const } : {}),
    webPreferences: webPreferences("preload.cjs"),
  });
  lockDown(win);
  win.once("ready-to-show", () => win.show());
  win.on("close", (e) => {
    // On a Mac the app keeps running in the menu bar when the window closes.
    if (isMac && !quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on("closed", () => {
    mainWindow = null;
  });
  void win.loadFile(join(OUT, "index.html"));
  return win;
}

/** Shows the app window. With a display, moves it there first if it sits on another one. */
function showMain(display?: Electron.Display): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow();
  const win = mainWindow;
  if (display && screen.getDisplayMatching(win.getBounds()).id !== display.id) win.setBounds(placeOn(display.workArea, win.getBounds()));
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  // A click in a panel or a global shortcut does not make the app active by itself.
  if (isMac) app.focus({ steal: true });
  return win;
}

function cursorDisplay(): Electron.Display {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

// Overlay windows: small panels that never take focus. They are created with
// focusable: false, shown only with showInactive(), and nothing here calls show() or
// focus() on them. On a Mac they are non activating panels at the "floating" level, so
// typing in the terminal or editor goes on uninterrupted.

function panelWindow(width: number, height: number): BrowserWindow {
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    ...(isMac ? { type: "panel", hiddenInMissionControl: true } : {}),
    webPreferences: webPreferences("preload-overlay.cjs"),
  });
  lockDown(win);
  // "floating" sits above normal windows but below the menu bar, Spotlight and screen savers.
  win.setAlwaysOnTop(true, "floating");
  // On every Space, but never over a full screen app.
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  void win.loadFile(join(OUT, "overlay.html"));
  return win;
}

function loaded(win: BrowserWindow): Promise<void> {
  return new Promise((resolve) => win.webContents.once("did-finish-load", () => resolve()));
}

function ensureOverlay(): Promise<void> {
  if (overlay && !overlay.isDestroyed() && overlayReady) return overlayReady;
  overlay = panelWindow(400, 200);
  overlayReady = loaded(overlay);
  return overlayReady;
}

async function showOverlay(content: Exclude<OverlayContent, { kind: "pill" }>): Promise<void> {
  await ensureOverlay();
  if (!overlay) return;
  // The card and the pill never show at the same time.
  hidePill();
  overlayDisplay = cursorDisplay();
  const wa = overlayDisplay.workArea;
  if (content.kind === "card") {
    const w = 400;
    overlay.setBounds({ x: wa.x + wa.width - w - 8, y: wa.y + 8, width: w, height: 200 });
  } else {
    const w = Math.min(1000, Math.round(wa.width * 0.85));
    const h = 170;
    overlay.setBounds({ x: wa.x + Math.round((wa.width - w) / 2), y: wa.y + wa.height - h - 12, width: w, height: h });
  }
  overlay.webContents.send("overlay:content", content);
  overlay.showInactive();
}

function hideOverlay(): void {
  if (overlay && !overlay.isDestroyed()) overlay.hide();
  void refreshPill();
}

function hidePill(): void {
  pillProject = null;
  if (pill && !pill.isDestroyed()) pill.hide();
}

/** The "agent is working" pill: shown only while a Claude Code turn is in progress. */
async function refreshPill(): Promise<void> {
  const p = state.projects.find((x) => turnStart.has(x.id));
  if (!p || !state.settings.agentPill || overlay?.isVisible()) {
    hidePill();
    return;
  }
  if (pillProject === p.id && pill?.isVisible()) return;
  if (!pill || pill.isDestroyed() || !pillReady) {
    pill = panelWindow(320, 36);
    pillReady = loaded(pill);
  }
  await pillReady;
  if (!pill || overlay?.isVisible()) return;
  const wa = cursorDisplay().workArea;
  pill.setBounds({ x: wa.x + Math.round((wa.width - 320) / 2), y: wa.y + wa.height - 36 - 12, width: 320, height: 36 });
  pill.webContents.send("overlay:content", { kind: "pill", projectId: p.id, projectName: p.name, agent: "Claude Code" } satisfies OverlayContent);
  pillProject = p.id;
  pill.showInactive();
}

function navigateFrom(a: OverlayAction): void {
  const display = overlayDisplay ?? cursorDisplay();
  hideOverlay();
  if (a.kind === "dismiss") return;
  state.activeId = a.projectId;
  const win = showMain(display);
  const go = (): void => {
    if (a.kind === "rewind") send({ type: "navigate", projectId: a.projectId, screen: "rewind", target: a.target });
    else if (a.kind === "compare") send({ type: "navigate", projectId: a.projectId, screen: "compare", a: a.a, b: a.b });
    else send({ type: "navigate", projectId: a.projectId, screen: "history", ...(a.target ? { target: a.target } : {}) });
  };
  if (win.webContents.isLoading()) win.webContents.once("did-finish-load", go);
  else go();
}

async function showStrip(): Promise<void> {
  const p = state.active();
  if (!p) {
    showMain(cursorDisplay());
    return;
  }
  try {
    const t = await tm.timeline(engine.ctx(p));
    const points = t.checkpoints.slice(-24).map((c) => ({ id: c.id, verdict: c.verdict, note: c.note, createdAt: c.createdAt }));
    await showOverlay({ kind: "strip", projectId: p.id, projectName: p.name, points, hideAfterMs: 10000 });
  } catch {
    showMain(cursorDisplay());
  }
}

// Store changes: progress for the window, the agent pill, and a card when PASS turns into FAIL.

function setTurn(id: string, entries: tm.AuditEntry[]): void {
  const since = agentTurnStart(entries, Date.now());
  if (since) turnStart.set(id, since);
  else turnStart.delete(id);
}

async function onStoreChange(p: ProjectEntry): Promise<void> {
  send({ type: "changed", projectId: p.id });
  const ctx = engine.ctx(p);
  let entries: tm.AuditEntry[];
  let t: tm.TimelineResult;
  try {
    entries = (await tm.log(ctx)).entries;
    t = await tm.timeline(ctx);
  } catch {
    return;
  }
  const seen = auditSeen.get(p.id) ?? 0;
  const fresh = entries.slice(seen);
  auditSeen.set(p.id, entries.length);
  for (const e of fresh) if (e.action === "verify" && e.target) send({ type: "progress", projectId: p.id, checkpoint: e.target, verdict: e.result });
  setTurn(p.id, entries);

  const points = t.checkpoints.map((c) => ({ id: c.id, verdict: c.verdict, note: c.note, createdAt: c.createdAt }));
  const before = lastVerdict.get(p.id) ?? null;
  const after = projectVerdict(points);
  lastVerdict.set(p.id, after);
  void refreshTray();
  const show = shouldShowBreakCard(before, after, {
    cardsOn: state.settings.overlayCards,
    windowFocused: mainWindow?.isFocused() ?? false,
    findingGood: engine.busy.get(p.id) === "Finding the last working version",
  });
  if (!show || !after) {
    void refreshPill();
    return;
  }
  // The card is about the save point that just broke, even if a newer unchecked one exists.
  const card = verdictCard(p.id, p.name, points.slice(0, points.findIndex((x) => x.id === after.id) + 1), "PASS");
  if (card) await showOverlay(card);
  else void refreshPill();
}

async function primeWatchState(): Promise<void> {
  for (const p of state.projects) {
    try {
      const ctx = engine.ctx(p);
      const entries = (await tm.log(ctx)).entries;
      auditSeen.set(p.id, entries.length);
      setTurn(p.id, entries);
      lastVerdict.set(p.id, projectVerdict((await tm.timeline(ctx)).checkpoints));
    } catch {
      // A moved project is shown as a problem in the window.
    }
  }
}

// Menu bar item.

async function refreshTray(): Promise<void> {
  if (!tray) return;
  const statuses = await Promise.all(state.projects.map((p) => engine.status(p)));
  const newest = statuses.flatMap((s) => (s.newest ? [s.newest.verdict] : []));
  const agentIn = state.projects.find((p) => turnStart.has(p.id));
  const busyIn = state.projects.find((p) => engine.busy.has(p.id));
  const dot = dotState(newest, !!agentIn || !!busyIn);
  tray.setImage(nativeImage.createFromBuffer(trayIcon(dot), { scaleFactor: 2 }));
  const active = state.active();
  const lines: MenuItemConstructorOptions[] = statuses.map((s) => {
    const p = state.find(s.projectId);
    const word = s.problem ? "Can't find it" : s.newest ? verdictWord(s.newest.verdict) : "No save points yet";
    return { label: `${p?.name ?? "Project"}: ${word}${turnStart.has(s.projectId) ? " · Claude Code is working" : ""}`, enabled: false };
  });
  const hotkey = activeHotkey ? { accelerator: activeHotkey, registerAccelerator: false } : {};
  const menu = Menu.buildFromTemplate([
    ...(lines.length ? lines : [{ label: "No projects yet", enabled: false }]),
    { type: "separator" },
    { label: active ? `Save now (${active.name})` : "Save now", enabled: !!active, click: () => void trayAction("save") },
    { label: "Check it works", enabled: !!active, click: () => void trayAction("check") },
    { label: "Show timeline", enabled: !!active, click: () => void showStrip() },
    { type: "separator" },
    { label: "Open Time Machine", ...hotkey, click: () => showMain(cursorDisplay()) },
    {
      label: "Settings…",
      click: () => {
        showMain(cursorDisplay());
        send({ type: "shortcut", action: "settings" });
      },
    },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  const broken = statuses.find((s) => s.newest?.verdict === "FAIL");
  const tip =
    dot === "fail"
      ? `Time Machine: ${state.find(broken?.projectId ?? "")?.name ?? "a project"} is broken`
      : dot === "working"
        ? agentIn
          ? `Time Machine: Claude Code is working in ${agentIn.name}`
          : `Time Machine: ${engine.busy.get(busyIn?.id ?? "") ?? "Working"} in ${busyIn?.name ?? "a project"}`
        : dot === "pass"
          ? "Time Machine: works"
          : "Time Machine: not checked yet";
  tray.setToolTip(tip);
}

async function trayAction(kind: "save" | "check"): Promise<void> {
  const p = state.active();
  if (!p) return;
  const saved = await engine.run({ method: "checkpoint", projectId: p.id, note: "Saved from the menu bar", ifChanged: kind === "check" });
  if (kind === "check" && saved.ok) await engine.run({ method: "verify", projectId: p.id, id: (saved.data as tm.CheckpointResult).checkpoint.id });
  send({ type: "changed", projectId: p.id });
}

function createTray(): void {
  try {
    tray = new Tray(nativeImage.createFromBuffer(trayIcon("none"), { scaleFactor: 2 }));
    // macOS and Linux open the menu on click by themselves. Windows needs a nudge.
    if (process.platform === "win32") tray.on("click", () => tray?.popUpContextMenu());
    void refreshTray();
  } catch {
    tray = null; // Some Linux desktops have no tray. The app still works.
  }
}

// Global shortcut: shows the app window on the display the pointer is on.

/** Swaps the global shortcut. Keeps the old one and returns false when the new one is taken. */
function applyHotkey(next: string | null): boolean {
  const prev = activeHotkey;
  if (prev) globalShortcut.unregister(prev);
  activeHotkey = null;
  if (!next) return true;
  const show = (): void => void showMain(cursorDisplay());
  let ok = false;
  try {
    ok = globalShortcut.register(next, show);
  } catch {
    ok = false;
  }
  if (ok) {
    activeHotkey = next;
    return true;
  }
  if (prev && globalShortcut.register(prev, show)) activeHotkey = prev;
  return false;
}

function appMenu(): void {
  const shortcut = (label: string, accelerator: string, action: ShortcutAction): MenuItemConstructorOptions => ({
    label,
    accelerator,
    // The window handles the keys itself, so the same shortcuts work in the browser preview.
    registerAccelerator: false,
    click: () => {
      showMain();
      send({ type: "shortcut", action });
    },
  });
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    { label: "File", submenu: [shortcut("Add project", "CmdOrCtrl+N", "add"), { type: "separator" }, isMac ? { role: "close" } : { role: "quit" }] },
    { role: "editMenu" },
    {
      label: "Project",
      submenu: [
        shortcut("Save now", "CmdOrCtrl+S", "save"),
        shortcut("Check it works", "CmdOrCtrl+Enter", "check"),
        shortcut("Find the last working version", "CmdOrCtrl+Shift+R", "rewind"),
        shortcut("Compare", "CmdOrCtrl+Shift+C", "compare"),
        { type: "separator" },
        shortcut("Inspector", "CmdOrCtrl+I", "inspector"),
        shortcut("Settings", "CmdOrCtrl+,", "settings"),
      ],
    },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// IPC: one validated entry point for the app window, one for the overlay windows. The
// preloads expose only typed functions; every payload is parsed with Zod here.

function fromFile(e: IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
  return (e.senderFrame?.url ?? "").startsWith("file://");
}

function fromOverlay(e: Electron.IpcMainEvent): boolean {
  return fromFile(e) && [overlay, pill].some((w) => w && !w.isDestroyed() && w.webContents === e.sender);
}

async function handleCall(e: IpcMainInvokeEvent, raw: unknown): Promise<Res<unknown>> {
  if (!fromFile(e) || !mainWindow || mainWindow.isDestroyed() || e.sender !== mainWindow.webContents) {
    return { ok: false, error: { kind: "usage", message: "Calls are only accepted from the app window." } };
  }
  const parsed = CallSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: { kind: "usage", message: `The app sent a call the engine does not accept: ${parsed.error.issues[0]?.message ?? "invalid"}` } };
  const call = parsed.data;
  switch (call.method) {
    case "bootstrap": {
      const data: Bootstrap = {
        platform: process.platform,
        settings: state.settings,
        projects: state.projects,
        hotkey: state.settings.hotkey ?? "",
        hotkeyActive: activeHotkey !== null,
        storeDir: process.env.TM_HOME ?? join(app.getPath("home"), ".timemachine"),
        preview: false,
      };
      return { ok: true, data };
    }
    case "chooseFolder": {
      const owner = BrowserWindow.fromWebContents(e.sender);
      const opts: Electron.OpenDialogOptions = { title: "Choose a project folder", properties: ["openDirectory"], buttonLabel: "Choose" };
      const r = owner ? await dialog.showOpenDialog(owner, opts) : await dialog.showOpenDialog(opts);
      return { ok: true, data: r.canceled ? null : (r.filePaths[0] ?? null) };
    }
    case "setSettings": {
      const next = call.patch.hotkey;
      if (next !== undefined && next !== activeHotkey && !applyHotkey(next)) {
        return { ok: false, error: { kind: "usage", message: "Another app already uses that shortcut. Pick a different one." } };
      }
      const settings = state.updateSettings(call.patch);
      send({ type: "settings", settings });
      void refreshTray();
      void refreshPill();
      return { ok: true, data: settings };
    }
    case "reveal": {
      if (!engine.allowedPaths.has(call.path)) return { ok: false, error: { kind: "usage", message: "That folder is not one this app made or added." } };
      shell.showItemInFolder(call.path);
      return { ok: true, data: true };
    }
    case "copy":
      clipboard.writeText(call.text);
      return { ok: true, data: true };
    case "setActive":
      state.activeId = call.projectId;
      void refreshTray();
      return { ok: true, data: true };
    default: {
      const pending = engine.run(call);
      // The dot shows "working" while the app runs an action.
      void refreshTray();
      const r = await pending;
      if (r.ok && (call.method === "addProject" || call.method === "demo" || call.method === "removeProject")) {
        watcher?.sync();
        await primeWatchState();
      }
      void refreshTray();
      return r;
    }
  }
}

let watcher: StoreWatcher | null = null;

void app.whenReady().then(async () => {
  state = new AppState(app.getPath("userData"));
  engine = new Engine(state);
  // No window of this app needs the camera, microphone, notifications or anything else.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, done) => done(false));
  appMenu();
  ipcMain.handle("tm:call", handleCall);
  ipcMain.on("overlay:act", (e, raw: unknown) => {
    if (!fromOverlay(e)) return;
    const r = OverlayActionSchema.safeParse(raw);
    if (r.success) navigateFrom(r.data);
  });
  ipcMain.on("overlay:hover", () => {
    // The overlay pauses its own timer while hovered. Nothing to do here.
  });
  await primeWatchState();
  watcher = new StoreWatcher(state, (p) => void onStoreChange(p));
  mainWindow = createMainWindow();
  createTray();
  // If another app owns the shortcut, the menu bar item still opens the window.
  applyHotkey(state.settings.hotkey);
  // A turn whose stop hook never ran goes stale after an hour. Look again now and then.
  setInterval(() => {
    if (!turnStart.size) return;
    const now = Date.now();
    for (const [id, since] of turnStart) if (agentTurnStart([{ at: since, action: "agent-turn", result: "started" }], now) === null) turnStart.delete(id);
    void refreshPill();
    void refreshTray();
  }, 60_000);
  void refreshPill();
  if (process.env.TM_DESKTOP_TEST === "1") {
    // Lets the screenshot script show the overlay without waiting for a real agent turn.
    (globalThis as Record<string, unknown>).__tmDesktop = { showOverlay, showStrip, refreshPill, verdictCard, state: () => state, turnStart };
  }
  app.on("activate", () => showMain());
});

app.on("before-quit", () => {
  quitting = true;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  watcher?.close();
});

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});
