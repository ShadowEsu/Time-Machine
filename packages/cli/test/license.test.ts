// tm license: shows, saves and forgets the web app key on this computer. The CLI itself never needs one.
import { generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, test } from "vitest";
import { FREE_PROJECT_LIMIT, signLicense } from "@timetm/core";
import { tempDir } from "../../../fixtures/demo/setup.ts";
import { main } from "../src/main.ts";

interface Run { code: number; out: string; err: string }
async function run(cwd: string, env: NodeJS.ProcessEnv, argv: string[]): Promise<Run> {
  let out = "";
  let err = "";
  const code = await main(argv, { cwd, env, stdout: (s) => { out += s; }, stderr: (s) => { err += s; }, isTTY: false, stdin: Readable.from([""]) });
  return { code, out, err };
}

function keys(): { pub: string; priv: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    pub: publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64url"),
    priv: privateKey.export({ type: "pkcs8", format: "der" }).subarray(-32).toString("base64url"),
  };
}

function home(): { root: string; tmHome: string; env: NodeJS.ProcessEnv } {
  const root = tempDir("clilicense");
  const tmHome = join(root, "store");
  return { root, tmHome, env: { ...process.env, TM_HOME: tmHome } };
}

const payload = { v: 1 as const, id: "cs_test_abcdefgh", plan: "web" as const, issued: "2026-10-22" };
const free = { active: false, id: null, issued: null, problem: null, freeProjectLimit: FREE_PROJECT_LIMIT };
const FREE_LINE = `Free. The web app lists up to ${FREE_PROJECT_LIMIT} projects. The CLI and every restore are free. Buy once for $50 at https://time-machine-site.vercel.app/#pricing\n`;

describe("tm license", () => {
  test("shows free without making a store, saves a key, shows it, and forgets it", async () => {
    const k = keys();
    const { root, tmHome, env } = home();
    const signed = { ...env, TM_LICENSE_PUBLIC_KEY: k.pub };
    expect(await run(root, signed, ["license"])).toEqual({ code: 0, out: FREE_LINE, err: "" });
    expect(JSON.parse((await run(root, signed, ["license", "--json"])).out)).toEqual(free);
    expect(existsSync(tmHome)).toBe(false);

    const key = signLicense(payload, k.priv);
    const saved = await run(root, signed, ["license", key]);
    expect(saved).toEqual({ code: 0, out: "License saved on this computer.\nLicensed, purchase cs_test_abcdefgh, issued 2026-10-22.\n", err: "" });
    expect(JSON.parse(readFileSync(join(tmHome, "license.json"), "utf8")).key).toBe(key);
    expect(await run(root, signed, ["license"])).toEqual({ code: 0, out: "Licensed, purchase cs_test_abcdefgh, issued 2026-10-22.\n", err: "" });
    expect(JSON.parse((await run(root, signed, ["license", "--json"])).out)).toEqual({ ...free, active: true, id: payload.id, issued: payload.issued });

    const removed = await run(root, signed, ["license", "--remove"]);
    expect(removed).toEqual({ code: 0, out: `License removed from this computer.\n${FREE_LINE}`, err: "" });
    expect(existsSync(join(tmHome, "license.json"))).toBe(false);
    expect(JSON.parse((await run(root, signed, ["license", "--remove", "--json"])).out)).toEqual(free);
  });

  test("a key from another seller is refused with exit 64 and nothing is saved", async () => {
    const k = keys();
    const { root, tmHome, env } = home();
    const key = signLicense(payload, keys().priv);
    const r = await run(root, { ...env, TM_LICENSE_PUBLIC_KEY: k.pub }, ["license", key]);
    expect(r.code).toBe(64);
    expect(r.err).toContain("signature does not match");
    expect(existsSync(tmHome)).toBe(false);
    // Without the override the embedded seller key applies, so a test key is refused there too.
    expect((await run(root, env, ["license", key])).code).toBe(64);
    expect((await run(root, env, ["license", "hello"])).err).toContain("not a Time Machine license key");
    // A saved key that no longer verifies is reported as a problem, not as licensed.
    await run(root, { ...env, TM_LICENSE_PUBLIC_KEY: k.pub }, ["license", signLicense(payload, k.priv)]);
    const status = await run(root, env, ["license"]);
    expect(status.code).toBe(0);
    expect(status.out).toMatch(/^License problem: .*signature does not match/);
    expect(JSON.parse((await run(root, env, ["license", "--json"])).out)).toMatchObject({ active: false, problem: expect.stringContaining("signature") });
  });

  test("usage errors exit 64", async () => {
    const { root, env } = home();
    expect((await run(root, env, ["license", "a", "b"])).code).toBe(64);
    expect(await run(root, env, ["license", "TM1.x.y", "--remove"])).toMatchObject({ code: 64, err: "tm: --remove takes no key.\n" });
    expect((await run(root, env, ["status", "--remove"])).code).toBe(64);
    expect((await run(root, { ...env, TM_LICENSE_PUBLIC_KEY: "short" }, ["license"])).code).toBe(64);
  });
});
