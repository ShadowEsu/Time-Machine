// Local-only transport for the same validated Engine used by the desktop app.
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import * as tm from "@timetm/core";
import { Credentials } from "../../../../apps/desktop/src/main/credentials.js";
import type { Cipher } from "../../../../apps/desktop/src/main/credentials.js";
import { Engine } from "../../../../apps/desktop/src/main/engine.js";
import { AppState } from "../../../../apps/desktop/src/main/state.js";
import { StoreWatcher } from "../../../../apps/desktop/src/main/watch.js";
import { CallSchema } from "../../../../apps/desktop/src/shared/api.js";
import type { AppEvent, Bootstrap, Call, ProjectEntry, Res } from "../../../../apps/desktop/src/shared/api.js";
import type { Io } from "../main.js";
import { VERSION } from "../version.js";

const MAX_BODY = 256 * 1024;
const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
};
// Inline styles are used by the shared renderer for positioning. Scripts never allow inline code.
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'";
const unavailableCipher: Cipher = {
  isEncryptionAvailable: () => false,
  encryptString: () => { throw new Error("Browser credential persistence is unavailable."); },
  decryptString: () => { throw new Error("Browser credential persistence is unavailable."); },
};

export interface UiServerOptions {
  assetsDir: string;
  userDataDir?: string;
  port?: number;
  /** The actual bundled CLI, for hooks that survive npm bin symlinks. */
  script?: string;
}
export interface UiServer {
  origin: string;
  /** The only URL printed or opened: the bearer token is in its fragment, never a request URL. */
  url: string;
  close(): Promise<void>;
  closed: Promise<unknown>;
}

function loadAssets(dir: string): Map<string, { bytes: Buffer; type: string }> {
  const root = realpathSync(dir);
  const names: unknown = JSON.parse(readFileSync(join(root, "asset-manifest.json"), "utf8"));
  if (!Array.isArray(names) || !names.length || names.length > 128) throw new Error("Invalid UI asset manifest. Reinstall timetm.");
  const assets = new Map<string, { bytes: Buffer; type: string }>();
  for (const name of names) {
    if (typeof name !== "string" || name.length > 200 || !/^[A-Za-z0-9_./-]+$/.test(name) || name.split("/").some((part) => !part || part === "." || part === "..") || !MIME[extname(name)]) {
      throw new Error("Invalid UI asset name. Reinstall timetm.");
    }
    const file = realpathSync(join(root, name));
    if (!file.startsWith(`${root}${sep}`) || !statSync(file).isFile()) throw new Error("UI asset escapes its package directory.");
    assets.set(`/${name}`, { bytes: readFileSync(file), type: MIME[extname(name)]! });
  }
  if (!assets.has("/index.html")) throw new Error("UI assets are incomplete. Reinstall timetm.");
  return assets;
}

function respond(res: ServerResponse, status: number, value: Res<unknown>): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

export async function startUiServer(options: UiServerOptions): Promise<UiServer> {
  if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)) throw new tm.TmError("usage", "UI port must be an integer between 1 and 65535.");
  const assets = loadAssets(options.assetsDir);
  const home = process.env.TM_HOME ?? join(homedir(), ".timemachine");
  const userData = options.userDataDir ?? process.env.TM_UI_USER_DATA ?? join(home, "ui");
  const state = new AppState(userData);
  const credentials = new Credentials(join(userData, "credentials.json"), unavailableCipher, process.env);
  const own = options.script ? `${tm.shellQuote(process.execPath)} ${tm.shellQuote(realpathSync(options.script))}` : null;
  const engine = new Engine(state, {
    candidates: process.env.TM_HOOK_COMMAND ? [process.env.TM_HOOK_COMMAND] : [...(own ? [own] : []), ...tm.npxHookCandidates(VERSION)],
    version: VERSION,
  }, { credentials, fetch: globalThis.fetch });
  const token = randomBytes(32).toString("hex");
  const expectedAuth = Buffer.from(`Bearer ${token}`);
  const streams = new Set<ServerResponse>();
  const auditSeen = new Map<string, number>();
  let stopping = false;
  let origin = "";
  let host = "";

  const send = (event: AppEvent): void => {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const stream of streams) {
      if (stream.destroyed || stream.writableLength > 256 * 1024) {
        streams.delete(stream);
        stream.destroy();
      } else stream.write(data);
    }
  };
  const prime = async (): Promise<void> => {
    for (const p of state.projects) {
      if (auditSeen.has(p.id)) continue;
      try { auditSeen.set(p.id, (await tm.log(engine.ctx(p))).entries.length); } catch { /* Moved projects stay visible as errors. */ }
    }
  };
  await prime();
  const onStoreChange = async (p: ProjectEntry): Promise<void> => {
    if (stopping) return;
    send({ type: "changed", projectId: p.id });
    try {
      const entries = (await tm.log(engine.ctx(p))).entries;
      const seen = auditSeen.get(p.id) ?? 0;
      auditSeen.set(p.id, entries.length);
      for (const entry of entries.slice(seen)) {
        if (entry.action === "verify" && entry.target) send({ type: "progress", projectId: p.id, checkpoint: entry.target, verdict: entry.result });
      }
    } catch { /* The next changed event lets the UI show a moved/unreadable project. */ }
  };
  let watcher: StoreWatcher | undefined;
  const dispatch = async (call: Call): Promise<Res<unknown>> => {
    switch (call.method) {
      case "bootstrap": {
        const localBrandMarks = process.env.TM_UI_BRAND_MARKS === "1" && ["claude", "openai", "gemini", "cursor"].every((name) => assets.has(`/agents/${name}.svg`));
        const data: Bootstrap = { runtime: "browser", localBrandMarks, platform: process.platform, settings: state.settings, projects: state.projects, hotkey: "", hotkeyActive: false, storeDir: home, preview: false };
        return { ok: true, data };
      }
      case "chooseFolder":
        return { ok: false, error: { kind: "usage", message: "Browsers cannot choose a local folder path. Use Add project and enter its absolute local path." } };
      case "setCredential":
        return { ok: false, error: { kind: "usage", message: "The browser app does not store API keys. Set GEMINI_API_KEY or VERCEL_TOKEN in the environment before running tm ui." } };
      case "setSettings": {
        if (call.patch.hotkey !== undefined || call.patch.overlayCards !== undefined || call.patch.agentPill !== undefined) {
          return { ok: false, error: { kind: "usage", message: "Global shortcuts and menu-bar overlays are available only in the desktop app." } };
        }
        const settings = state.updateSettings(call.patch);
        send({ type: "settings", settings });
        return { ok: true, data: settings };
      }
      case "setActive":
        if (!state.find(call.projectId)) return { ok: false, error: { kind: "not_found", message: "That project is no longer in the list." } };
        state.activeId = call.projectId;
        return { ok: true, data: true };
      case "reveal":
        return { ok: false, error: { kind: "usage", message: "A browser cannot reveal a local folder. Copy the displayed path and open it in your file manager." } };
      case "copy":
        return { ok: false, error: { kind: "usage", message: "Use the browser Clipboard API to copy text." } };
      case "openExternal":
        // Already validated by the shared HTTPS allowlist; the browser opens it, not the server.
        return { ok: true, data: true };
      default: {
        const result = await engine.run(call);
        if (result.ok) {
          if (call.method === "addProject" || call.method === "demo" || call.method === "removeProject") {
            watcher?.sync();
            await prime();
            const p = state.active();
            if (p) send({ type: "changed", projectId: p.id });
          }
          if ("projectId" in call && ["checkpoint", "verify", "findGood", "recover", "undoRecover", "init", "setCheck", "hookInstall", "setFeature", "cleanStore"].includes(call.method)) {
            send({ type: "changed", projectId: call.projectId });
          }
        }
        return result;
      }
    }
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    res.setHeader("Content-Security-Policy", CSP);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    const refuse = (status: number, message: string): void => respond(res, status, { ok: false, error: { kind: "usage", message } });
    const path = req.url ?? "";
    const api = path.startsWith("/api/");
    const site = req.headers["sec-fetch-site"];
    if (req.headers.host !== host || (req.headers.origin !== undefined && req.headers.origin !== origin) || (site !== undefined && site !== "same-origin" && (api || site !== "none"))) {
      refuse(403, "Only this local app origin is allowed.");
      return;
    }
    if (stopping) { refuse(503, "Time Machine is shutting down."); return; }
    // Match the raw request target: never normalize percent encoding or dot segments into a valid asset.
    if (!/^\/[A-Za-z0-9_./-]*$/.test(path) || path.split("/").some((part) => part === "." || part === "..")) {
      refuse(404, "Not found.");
      return;
    }
    if (api) {
      const supplied = Buffer.from(req.headers.authorization ?? "");
      if (supplied.length !== expectedAuth.length || !timingSafeEqual(supplied, expectedAuth)) {
        refuse(401, "Open the full URL printed by tm ui, including its #token fragment, to connect.");
        return;
      }
      if (path === "/api/events" && req.method === "GET") {
        if (streams.size >= 16) { refuse(429, "Too many open app tabs. Close another tab and retry."); return; }
        res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", Connection: "keep-alive" });
        res.write(": connected\n\n");
        streams.add(res);
        res.once("close", () => streams.delete(res));
        return;
      }
      if (path !== "/api/call" || req.method !== "POST") { refuse(404, "Not found."); return; }
      if (req.headers["content-type"]?.split(";")[0]?.trim() !== "application/json") { refuse(415, "Calls must be JSON."); return; }
      if (req.headers["content-encoding"] !== undefined || Number(req.headers["content-length"] ?? 0) > MAX_BODY) { refuse(413, "Call body is too large or encoded."); req.resume(); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const part of req.iterator({ destroyOnReturn: false })) {
        const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
        size += chunk.length;
        if (size > MAX_BODY) { refuse(413, "Call body is too large."); req.resume(); return; }
        chunks.push(chunk);
      }
      let raw: unknown;
      try { raw = JSON.parse(Buffer.concat(chunks, size).toString("utf8")); }
      catch { refuse(400, "Call body must be valid JSON."); return; }
      const parsed = CallSchema.safeParse(raw);
      if (!parsed.success) { refuse(400, `The app sent an invalid call: ${parsed.error.issues[0]?.message ?? "invalid"}`); return; }
      respond(res, 200, await dispatch(parsed.data));
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") { refuse(405, "Only GET and HEAD are supported for app assets."); return; }
    const asset = assets.get(path === "/" ? "/index.html" : path);
    if (!asset) { refuse(404, "Not found."); return; }
    res.writeHead(200, { "Content-Type": asset.type, "Content-Length": asset.bytes.length });
    res.end(req.method === "HEAD" ? undefined : asset.bytes);
  };
  const server = createServer({ requestTimeout: 15_000, headersTimeout: 10_000, maxHeaderSize: 16 * 1024 }, (req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) respond(res, 500, { ok: false, error: { kind: "internal", message: "The local app could not complete that call. Check folder permissions and try again." } });
      else res.destroy();
    });
  });
  server.maxConnections = 64;
  const listening = once(server, "listening");
  server.listen(options.port ?? 0, "127.0.0.1");
  await listening;
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not bind the local app.");
  host = `127.0.0.1:${address.port}`;
  origin = `http://${host}`;
  watcher = new StoreWatcher(state, (p) => { void onStoreChange(p); });
  const heartbeat = setInterval(() => {
    for (const stream of streams) {
      if (stream.destroyed || stream.writableLength > 256 * 1024) { streams.delete(stream); stream.destroy(); }
      else stream.write(": heartbeat\n\n");
    }
  }, 15_000);
  const closed = once(server, "close");
  return {
    origin, url: `${origin}/#token=${token}`, closed,
    close: async () => {
      if (stopping) { await closed; return; }
      stopping = true;
      watcher?.close();
      clearInterval(heartbeat);
      tm.runInterruptCleanups();
      for (const stream of streams) stream.end();
      streams.clear();
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}

/** OS launchers receive an argument array, never a shell command or interpolated path. */
function launchBrowser(url: string, stderr: Io["stderr"]): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "rundll32.exe" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const child = spawn(command, args, { stdio: "ignore", detached: true, shell: false });
  child.once("error", () => stderr("tm: Could not open a browser. Open the full local URL above manually.\n"));
  child.once("exit", (code) => { if (code) stderr("tm: The browser launcher failed. Open the full local URL above manually.\n"); });
  child.unref();
}

export async function runUi(io: Io, options: { port?: number; open: boolean }): Promise<number> {
  if (!io.script) throw new tm.TmError("usage", "Run tm ui from the packaged CLI so its browser assets can be located.");
  const script = realpathSync(io.script);
  const server = await startUiServer({ assetsDir: resolve(dirname(script), "ui"), script, ...(options.port !== undefined ? { port: options.port } : {}) });
  // prepend makes synchronous watcher/check/socket cleanup happen before bin.ts exits on a signal.
  const stop = (): void => { void server.close(); };
  process.prependOnceListener("SIGINT", stop);
  process.prependOnceListener("SIGTERM", stop);
  try {
    io.stdout(`Time Machine is running locally. Keep this terminal open.\n${server.url}\nPress Ctrl+C to stop. Do not share this URL.\n`);
    if (options.open) launchBrowser(server.url, io.stderr);
    await server.closed;
    return 0;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await server.close();
  }
}
