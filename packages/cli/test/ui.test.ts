import { generateKeyPairSync } from "node:crypto";
import { request } from "node:http";
import { connect } from "node:net";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { signLicense } from "@timetm/core";
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
  test("listens on loopback only: the same port on this computer's network addresses refuses the connection", async () => {
    const s = await start();
    const { hostname, port } = new URL(s.origin);
    expect(hostname).toBe("127.0.0.1");
    // Link-local IPv6 needs a zone id to dial, so only IPv4 and routable IPv6 addresses are tried.
    const lan = Object.values(networkInterfaces()).flat()
      .filter((a) => a !== undefined && !a.internal && !a.address.startsWith("fe80:")).map((a) => a!.address);
    for (const address of lan) {
      const outcome = await new Promise<string>((resolve) => {
        const sock = connect({ host: address, port: Number(port), timeout: 2000 });
        sock.once("connect", () => { sock.destroy(); resolve("connected"); });
        sock.once("timeout", () => { sock.destroy(); resolve("timeout"); });
        sock.once("error", (e: NodeJS.ErrnoException) => resolve(e.code ?? "error"));
      });
      expect(outcome, address).not.toBe("connected");
    }
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
  test.skipIf(process.platform === "win32")("a settings folder it can't write is named as the app's own folder, not the store (Security F10)", async () => {
    const s = await start();
    const state = join(roots[roots.length - 1] ?? "", "state");
    chmodSync(state, 0o500);
    try {
      expect(JSON.parse((await call(s, { method: "setSettings", patch: { theme: "light" } })).body)).toEqual({
        ok: false,
        error: { kind: "permission", message: `Time Machine can't save its settings in ${state}. Check that folder's permissions.` },
      });
    } finally {
      chmodSync(state, 0o700);
    }
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
  test("checks license keys against TM_LICENSE_PUBLIC_KEY, the same override the CLI honours", async () => {
    const pair = (): { pub: string; priv: string } => {
      const { publicKey, privateKey } = generateKeyPairSync("ed25519");
      return { pub: publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64url"), priv: privateKey.export({ type: "pkcs8", format: "der" }).subarray(-32).toString("base64url") };
    };
    const seller = pair();
    const stranger = pair();
    const payload = { v: 1 as const, id: "cs_test_uiwebkey", plan: "web" as const, issued: "2026-10-22" };
    const saved = { home: process.env.TM_HOME, key: process.env.TM_LICENSE_PUBLIC_KEY };
    const root = mkdtempSync(join(tmpdir(), "tm-ui-license-"));
    roots.push(root);
    process.env.TM_HOME = join(root, "store");
    try {
      process.env.TM_LICENSE_PUBLIC_KEY = seller.pub;
      const s = await start();
      const foreign = JSON.parse((await call(s, { method: "setLicense", key: signLicense(payload, stranger.priv) })).body);
      expect(foreign.ok).toBe(false);
      const active = JSON.parse((await call(s, { method: "setLicense", key: signLicense(payload, seller.priv) })).body);
      expect(active).toMatchObject({ ok: true, data: { active: true, id: "cs_test_uiwebkey", issued: "2026-10-22", problem: null } });
      expect(JSON.parse((await call(s, { method: "license" })).body).data.active).toBe(true);
      process.env.TM_LICENSE_PUBLIC_KEY = "short";
      await expect(start()).rejects.toThrow("TM_LICENSE_PUBLIC_KEY must be a raw Ed25519 public key");
    } finally {
      for (const [name, value] of [["TM_HOME", saved.home], ["TM_LICENSE_PUBLIC_KEY", saved.key]] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
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
