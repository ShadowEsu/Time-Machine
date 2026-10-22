import { request } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { startUiServer, type UiServer } from "../src/ui/server.ts";
import { main } from "../src/main.ts";

const roots: string[] = [];
const servers: UiServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
async function start(): Promise<UiServer> {
  const root = mkdtempSync(join(tmpdir(), "tm-ui-test-"));
  roots.push(root);
  const assetsDir = join(root, "ui");
  mkdirSync(assetsDir);
  writeFileSync(join(assetsDir, "index.html"), "<!doctype html><title>Time Machine</title>");
  writeFileSync(join(assetsDir, "asset-manifest.json"), JSON.stringify(["index.html"]));
  writeFileSync(join(root, "private.txt"), "must not be served");
  const server = await startUiServer({ assetsDir, userDataDir: join(root, "state") });
  servers.push(server);
  return server;
}
async function raw(server: UiServer, path: string, headers: Record<string, string> = {}, body?: string): Promise<{ status: number; body: string; headers: import("node:http").IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = request(`${server.origin}/`, { method: body === undefined ? "GET" : "POST", path, headers }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers }));
    });
    req.on("error", reject);
    req.end(body);
  });
}
const auth = (s: UiServer): Record<string, string> => ({ Authorization: `Bearer ${new URL(s.url).hash.slice("#token=".length)}`, Origin: s.origin, "Content-Type": "application/json" });
const call = (s: UiServer, value: unknown) => raw(s, "/api/call", auth(s), JSON.stringify(value));

describe("local browser boundary", () => {
  test("public shell has security headers but engine calls and event streams require this launch's bearer token", async () => {
    const s = await start();
    const shell = await raw(s, "/");
    expect(shell.status).toBe(200);
    expect(shell.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(shell.headers["referrer-policy"]).toBe("no-referrer");
    expect((await raw(s, "/api/call", { "Content-Type": "application/json" }, '{"method":"bootstrap"}')).status).toBe(401);
    expect((await raw(s, "/api/events")).status).toBe(401);
    expect((await raw(s, "/api/call", { ...auth(s), Authorization: "Bearer wrong" }, '{"method":"bootstrap"}')).status).toBe(401);
    const boot = await call(s, { method: "bootstrap" });
    expect(boot.status).toBe(200);
    const data = JSON.parse(boot.body).data;
    expect(data).toMatchObject({ preview: false, projects: [], license: { active: expect.any(Boolean), freeProjectLimit: expect.any(Number) } });
    // The browser app is the only runtime, so the desktop-only fields are gone.
    for (const gone of ["runtime", "hotkey", "hotkeyActive"]) expect(data, gone).not.toHaveProperty(gone);
    expect(shell.headers["access-control-allow-origin"]).toBeUndefined();
  });
  test("rejects rebinding, foreign and null origins, and cross-site fetches even with the bearer token", async () => {
    const s = await start();
    const variants: Record<string, string>[] = [{ Host: "attacker.example" }, { Origin: "https://attacker.example" }, { Origin: "null" }, { "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Site": "same-site" }];
    for (const headers of variants) {
      expect((await raw(s, "/api/call", { ...auth(s), ...headers }, '{"method":"bootstrap"}')).status).toBe(403);
    }
    expect((await raw(s, "/", { Host: "localhost" })).status).toBe(403);
    expect((await raw(s, "/api/events?token=wrong", auth(s))).status).toBe(404);
  });
  test("only serves manifest assets; raw and encoded traversal, unknown files and the manifest stay private", async () => {
    const s = await start();
    for (const path of ["/../private.txt", "/%2e%2e/private.txt", "/fonts/%2e%2e/private.txt", "/..\\private.txt", "/asset-manifest.json", "/private.txt", "/index.html/extra", "/?token=secret"]) {
      const response = await raw(s, path);
      expect(response.status).not.toBe(200);
      expect(response.body).not.toContain("must not be served");
    }
  });
  test("validates strict call schemas, JSON type and bounded bodies before dispatch", async () => {
    const s = await start();
    for (const value of [null, [], { method: "bootstrap", extra: true }, { method: "addProject", path: "relative" }, { method: "openExternal", url: "file:///etc/passwd" }, { method: "setSettings", patch: { theme: "wrong" } }]) {
      expect((await call(s, value)).status).toBe(400);
    }
    expect((await raw(s, "/api/call", auth(s), "{")).status).toBe(400);
    expect((await raw(s, "/api/call", { ...auth(s), "Content-Type": "text/plain" }, '{}')).status).toBe(415);
    expect((await raw(s, "/api/call", auth(s), JSON.stringify({ method: "copy", text: "x".repeat(300_000) }))).status).toBe(413);
  });
  test("persists browser settings, streams real settings events, and refuses credential storage", async () => {
    const s = await start();
    const controller = new AbortController();
    const events = await fetch(`${s.origin}/api/events`, { headers: auth(s), signal: controller.signal });
    expect(events.status).toBe(200);
    const reader = events.body!.getReader();
    await reader.read(); // ready comment
    expect(JSON.parse((await call(s, { method: "setSettings", patch: { theme: "light" } })).body)).toMatchObject({ ok: true, data: { theme: "light" } });
    const event = new TextDecoder().decode((await reader.read()).value);
    expect(event).toContain('"type":"settings"');
    expect(event).toContain('"theme":"light"');
    controller.abort();
    await reader.cancel().catch(() => undefined);
    const denied = JSON.parse((await call(s, { method: "setCredential", name: "gemini", value: "never-store-this-key" })).body);
    expect(denied).toMatchObject({ ok: false, error: { kind: "usage" } });
    const stateDir = join(roots.at(-1)!, "state");
    expect(readFileSync(join(stateDir, "settings.json"), "utf8")).toContain('"light"');
    const assetsDir = join(roots.at(-1)!, "ui");
    await s.close();
    const next = await startUiServer({ assetsDir, userDataDir: stateDir });
    servers.push(next);
    expect(JSON.parse((await call(next, { method: "bootstrap" })).body).data.settings.theme).toBe("light");
    expect((await raw(next, "/api/call", { ...auth(next), Authorization: auth(s).Authorization! }, '{"method":"bootstrap"}')).status).toBe(401);
    expect(JSON.parse((await call(next, { method: "chooseFolder" })).body).ok).toBe(false);
    await next.close();
    await expect(fetch(next.origin)).rejects.toThrow();
  });
  test("CLI rejects invalid UI ports and flags before starting a server", async () => {
    for (const args of [["ui", "--port", "0"], ["ui", "--port", "65536"], ["ui", "--port", "1e3"], ["ui", "extra"], ["ui", "--json"], ["timeline", "--no-open"]]) {
      let err = "";
      const code = await main(args, { cwd: tmpdir(), env: {}, stdout: () => undefined, stderr: (s) => { err += s; }, isTTY: false });
      expect(code).toBe(64);
      expect(err).not.toBe("");
    }
  });
});
