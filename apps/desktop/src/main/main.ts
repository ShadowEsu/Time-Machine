// Electron main process. It owns the windows, the menu bar item, the overlay and the
// global hotkey. Every engine call goes through Engine, which calls @timetm/core.
import { join } from "node:path";
import * as tm from "@timetm/core";
import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, shell, Tray, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from "electron";
import { CallSchema, OverlayActionSchema, type AppEvent, type Bootstrap, type OverlayAction, type OverlayContent, type ProjectEntry, type Res, type ShortcutAction, type Verdict } from "../shared/api.js";
import { verdictCard } from "../shared/cards.js";
import { verdictWord } from "../shared/format.js";
import { Engine } from "./engine.js";
import { trayIcon, type DotState } from "./icon.js";
import { AppState } from "./state.js";
import { StoreWatcher } from "./watch.js";

const HOTKEY = "CommandOrControl+Shift+T";
const isMac = process.platform === "darwin";
const OUT = __dirname;

if (process.env.TM_DESKTOP_USER_DATA) app.setPath("userData", process.env.TM_DESKTOP_USER_DATA);

let state: AppState;
let engine: Engine;
let mainWindow: BrowserWindow | null = null;
let overlay: BrowserWindow | null = null;
let overlayReady: Promise<void> | null = null;
let tray: Tray | null = null;
let quitting = false;

/** What we last knew per project, so a card is shown once per new verdict. */
const auditSeen = new Map<string, number>();
const newestVerdict = new Map<string, Verdict | null>();
const lastCard = new Map<string, string>();

function webPreferences(preload: string): Electron.WebPreferences {
  return { preload: join(OUT, preload), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false };
}

function lockDown(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
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

function showMain(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow();
  else {
    mainWindow.show();
    mainWindow.focus();
  }
  return mainWindow;
}

// Overlay: a small panel that never takes focus.

function ensureOverlay(): Promise<void> {
  if (overlay && !overlay.isDestroyed() && overlayReady) return overlayReady;
  overlay = new BrowserWindow({
    width: 400,
    height: 200,
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
  lockDown(overlay);
  overlay.setAlwaysOnTop(true, "floating");
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  const win = overlay;
  overlayReady = new Promise((resolve) => win.webContents.once("did-finish-load", () => resolve()));
  void win.loadFile(join(OUT, "overlay.html"));
  return overlayReady;
}

async function showOverlay(content: OverlayContent): Promise<void> {
  await ensureOverlay();
  if (!overlay) return;
  const wa = screen.getPrimaryDisplay().workArea;
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
}

function navigateFrom(a: OverlayAction): void {
  hideOverlay();
  if (a.kind === "dismiss") return;
  state.activeId = a.projectId;
  const win = showMain();
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
    showMain();
    return;
  }
  try {
    const t = await tm.timeline(engine.ctx(p));
    const points = t.checkpoints.slice(-24).map((c) => ({ id: c.id, verdict: c.verdict, note: c.note, createdAt: c.createdAt }));
    await showOverlay({ kind: "strip", projectId: p.id, projectName: p.name, points, hideAfterMs: 10000 });
  } catch {
    showMain();
  }
}

// Store changes: progress for the window, a card when a verdict is new.

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
  void refreshTray();

  const points = t.checkpoints.map((c) => ({ id: c.id, verdict: c.verdict, note: c.note, createdAt: c.createdAt }));
  const newest = points.at(-1);
  const before = newestVerdict.get(p.id) ?? null;
  newestVerdict.set(p.id, newest?.verdict ?? null);
  if (!newest?.verdict || !fresh.some((e) => e.action === "verify" && e.target === newest.id)) return;
  const key = `${newest.id}:${newest.verdict}`;
  if (lastCard.get(p.id) === key) return;
  lastCard.set(p.id, key);
  // The window already shows results of actions taken in it.
  if (!state.settings.overlayCards || mainWindow?.isFocused() || engine.busy.get(p.id) === "Finding the last working version") return;
  const card = verdictCard(p.id, p.name, points, before);
  if (card) await showOverlay(card);
}

async function primeWatchState(): Promise<void> {
  for (const p of state.projects) {
    try {
      const ctx = engine.ctx(p);
      auditSeen.set(p.id, (await tm.log(ctx)).entries.length);
      newestVerdict.set(p.id, (await tm.timeline(ctx)).checkpoints.at(-1)?.verdict ?? null);
    } catch {
      // A moved project is shown as a problem in the window.
    }
  }
}

// Menu bar item.

async function refreshTray(): Promise<void> {
  if (!tray) return;
  const statuses = await Promise.all(state.projects.map((p) => engine.status(p)));
  const withPoints = statuses.filter((s) => s.newest);
  // Green only when every project's newest save point has a real PASS. Red on any FAIL.
  let dot: DotState = "none";
  if (withPoints.some((s) => s.newest?.verdict === "FAIL")) dot = "fail";
  else if (withPoints.length && withPoints.every((s) => s.newest?.verdict === "PASS")) dot = "pass";
  tray.setImage(nativeImage.createFromBuffer(trayIcon(dot), { scaleFactor: 2 }));
  const active = state.active();
  const lines: MenuItemConstructorOptions[] = statuses.map((s) => {
    const p = state.find(s.projectId);
    const word = s.problem ? "Can't find it" : s.newest ? verdictWord(s.newest.verdict) : "No save points yet";
    return { label: `${p?.name ?? "Project"}: ${word}`, enabled: false };
  });
  const menu = Menu.buildFromTemplate([
    ...(lines.length ? lines : [{ label: "No projects yet", enabled: false }]),
    { type: "separator" },
    { label: active ? `Save now (${active.name})` : "Save now", enabled: !!active, click: () => void trayAction("save") },
    { label: "Check it works", enabled: !!active, click: () => void trayAction("check") },
    { label: "Show timeline", accelerator: HOTKEY, registerAccelerator: false, click: () => void showStrip() },
    { type: "separator" },
    { label: "Open Time Machine", click: () => showMain() },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(dot === "pass" ? "Time Machine: works" : dot === "fail" ? "Time Machine: something is broken" : "Time Machine: not checked yet");
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

// IPC: one validated entry point for the window, one for the overlay.

function fromOurWindow(e: IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
  const url = e.senderFrame?.url ?? "";
  return url.startsWith("file://");
}

async function handleCall(e: IpcMainInvokeEvent, raw: unknown): Promise<Res<unknown>> {
  if (!fromOurWindow(e)) return { ok: false, error: { kind: "usage", message: "Calls are only accepted from the app window." } };
  const parsed = CallSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: { kind: "usage", message: `The app sent a call the engine does not accept: ${parsed.error.issues[0]?.message ?? "invalid"}` } };
  const call = parsed.data;
  switch (call.method) {
    case "bootstrap": {
      const data: Bootstrap = { platform: process.platform, settings: state.settings, projects: state.projects, hotkey: HOTKEY, storeDir: process.env.TM_HOME ?? join(app.getPath("home"), ".timemachine"), preview: false };
      return { ok: true, data };
    }
    case "chooseFolder": {
      const owner = BrowserWindow.fromWebContents(e.sender);
      const opts: Electron.OpenDialogOptions = { title: "Choose a project folder", properties: ["openDirectory"], buttonLabel: "Choose" };
      const r = owner ? await dialog.showOpenDialog(owner, opts) : await dialog.showOpenDialog(opts);
      return { ok: true, data: r.canceled ? null : (r.filePaths[0] ?? null) };
    }
    case "setSettings": {
      const settings = state.updateSettings(call.patch);
      send({ type: "settings", settings });
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
      const r = await engine.run(call);
      if (r.ok && (call.method === "addProject" || call.method === "demo" || call.method === "removeProject")) {
        watcher?.sync();
        await primeWatchState();
        void refreshTray();
      }
      return r;
    }
  }
}

let watcher: StoreWatcher | null = null;

void app.whenReady().then(async () => {
  state = new AppState(app.getPath("userData"));
  engine = new Engine(state);
  appMenu();
  ipcMain.handle("tm:call", handleCall);
  ipcMain.on("overlay:act", (e, raw: unknown) => {
    if (!fromOurWindow(e)) return;
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
  if (!globalShortcut.register(HOTKEY, () => void showStrip())) {
    // Another app owns the hotkey. The menu bar item still offers Show timeline.
  }
  if (process.env.TM_DESKTOP_TEST === "1") {
    // Lets the screenshot script show the overlay without waiting for a real agent turn.
    (globalThis as Record<string, unknown>).__tmDesktop = { showOverlay, showStrip, verdictCard, state: () => state };
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
