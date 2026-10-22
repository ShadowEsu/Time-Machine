import { CallSchema } from "../../../../apps/desktop/src/shared/api.js";
import type { AppEvent, CallOf, Method, Res, Results, TmBridge } from "../../../../apps/desktop/src/shared/api.js";

type Connection = { state: "connecting" | "connected" | "disconnected"; message?: string };
const browserWindow = window as unknown as Window & { tm: TmBridge; tmConnection?: Connection };
const REOPEN = "Open the full URL printed by tm ui, including its #token fragment, to connect this browser.";

/** Installs the transport before the shared renderer is imported. No preview/mock engine exists here. */
export function installBrowserBridge(): boolean {
  let token = new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
  history.replaceState(null, "", location.pathname);
  try {
    if (token) sessionStorage.setItem("tm-ui-token", token);
    else token = sessionStorage.getItem("tm-ui-token") ?? "";
  } catch { /* Private sessions may disable storage; the initial fragment still works in memory. */ }
  if (!/^[a-f0-9]{64}$/.test(token)) token = "";
  const listeners = new Set<(event: AppEvent) => void>();
  const controllers = new Set<AbortController>();
  let stopped = false;
  const setConnection = (connection: Connection): void => {
    browserWindow.tmConnection = connection;
    window.dispatchEvent(new CustomEvent("tm:connection", { detail: connection }));
  };
  setConnection(token ? { state: "connecting" } : { state: "disconnected", message: REOPEN });
  const notify = (event: AppEvent): void => {
    for (const listener of listeners) {
      try { listener(event); } catch { /* One view must not disconnect the other subscribers. */ }
    }
  };
  const request = async <M extends Method>(call: CallOf<M>): Promise<Res<Results[M]>> => {
    if (!token) return { ok: false, error: { kind: "usage", message: REOPEN } };
    const controller = new AbortController();
    controllers.add(controller);
    try {
      const response = await fetch("/api/call", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(call), signal: controller.signal, credentials: "omit", redirect: "error",
      });
      const result: Res<Results[M]> = await response.json();
      if (!response.ok && response.status === 401) setConnection({ state: "disconnected", message: REOPEN });
      if (typeof result !== "object" || result === null || typeof result.ok !== "boolean") throw new Error("Invalid server reply");
      return result;
    } catch {
      const message = "Disconnected from the local app. Keep the tm ui terminal running, then reopen its full URL if it restarted.";
      setConnection({ state: "disconnected", message });
      return { ok: false, error: { kind: "disconnected", message } };
    } finally { controllers.delete(controller); }
  };
  const call: TmBridge["call"] = async <M extends Method>(value: CallOf<M>): Promise<Res<Results[M]>> => {
    try {
      const parsed = CallSchema.safeParse(value);
      if (!parsed.success) return { ok: false, error: { kind: "usage", message: "The browser sent an invalid app action." } };
      if (!token) return { ok: false, error: { kind: "usage", message: REOPEN } };
      if (parsed.data.method === "copy") {
        if (!navigator.clipboard?.writeText) return { ok: false, error: { kind: "usage", message: "Clipboard access is unavailable. Select the displayed text and copy it manually." } };
        await navigator.clipboard.writeText(parsed.data.text);
        return { ok: true, data: true as Results[M] };
      }
      if (parsed.data.method === "openExternal") {
        // Opening synchronously preserves the user's click gesture. Both sides use the shared HTTPS allowlist.
        window.open(parsed.data.url, "_blank", "noopener,noreferrer");
      }
      return await request(value);
    } catch {
      return { ok: false, error: { kind: "usage", message: "The browser could not complete that action. Check browser permissions and try again." } };
    }
  };
  browserWindow.tm = Object.freeze({ call, onEvent: (listener: (event: AppEvent) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } });

  const stream = async (): Promise<void> => {
    while (!stopped && token) {
      const controller = new AbortController();
      controllers.add(controller);
      try {
        const response = await fetch("/api/events", { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, credentials: "omit", redirect: "error" });
        if (response.status === 401) {
          setConnection({ state: "disconnected", message: REOPEN });
          return;
        }
        if (!response.ok || !response.body) throw new Error("Event stream unavailable");
        setConnection({ state: "connected" });
        // A reconnection can have missed CLI/hook edits; refresh every remembered project through the real engine.
        const bootstrap = await request({ method: "bootstrap" });
        if (bootstrap.ok) for (const project of bootstrap.data.projects) notify({ type: "changed", projectId: project.id });
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!stopped) {
          const next = await reader.read();
          if (next.done) throw new Error("Event stream closed");
          buffer += decoder.decode(next.value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (frame.startsWith("data: ")) notify(JSON.parse(frame.slice(6)) as AppEvent);
          }
        }
      } catch {
        if (!stopped) setConnection({ state: "disconnected", message: "Disconnected from the local app. Keep the tm ui terminal running. Reconnecting…" });
      } finally { controllers.delete(controller); controller.abort(); }
      // Safari 17 supports the shared renderer but predates Promise.withResolvers.
      if (!stopped) await new Promise<void>((resolve) => { setTimeout(resolve, 2000); });
    }
  };
  window.addEventListener("pagehide", () => { stopped = true; for (const controller of controllers) controller.abort(); }, { once: true });
  // Pasting a restarted server's URL into this tab only changes the fragment, which browsers do not reload.
  // Reload so the new token is read, stored and scrubbed from the address bar like a fresh open.
  window.addEventListener("hashchange", () => {
    if (new URLSearchParams(location.hash.slice(1)).has("token")) location.reload();
  });
  if (token) void stream();
  return Boolean(token);
}
