// Command construction for package-local.mjs. Nothing here runs codesign, notarytool or a build.
// The Developer ID path is checked only as argument lists; it has not run against Apple.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { checkNotary, codesignArgs, finishSteps, pickIdentity, releaseEntitlements, signingConfig } from "../scripts/signing-plan.mjs";

// Vitest runs from the repository root.
const desktop = join(process.cwd(), "apps/desktop");
const app = "/x/release/Time Machine.app";
const zip = "/x/release/Time Machine.zip";
const hashA = "A".repeat(40);
const hashB = "B".repeat(40);
const devId = "Developer ID Application: Example Person (ABCDE12345)";
const identities = `  1) ${hashA} "${devId}"\n  2) ${hashB} "Time Machine Self Signed"\n     2 valid identities found\n`;

describe("default local build", () => {
  test("no settings means the local self-signed build", () => {
    expect(signingConfig({})).toEqual({ mode: "local" });
    expect(signingConfig({ TM_SIGN_IDENTITY: " ", TM_NOTARY_PROFILE: "" })).toEqual({ mode: "local" });
  });

  test("codesign arguments are exactly the ones used before Developer ID support", () => {
    const signer = { mode: "local" as const, fingerprint: "F1", keychain: "/k/signing.keychain-db" };
    // Copied from package-local.mjs at e8c6552, with entitlements = join(here, "scripts/entitlements.local.plist").
    const entitlements = join(desktop, "scripts/entitlements.local.plist");
    const today = (path: string, executable: boolean): string[] => ["--force", "--sign", "F1", "--keychain", "/k/signing.keychain-db", "--options", "runtime", "--timestamp=none",
      ...(executable ? ["--entitlements", entitlements] : []), path];
    for (const executable of [true, false]) expect(codesignArgs(signer, "/a/b", executable)).toEqual(today("/a/b", executable));
  });

  test("finishing is the old remove and ditto, nothing else", () => {
    expect(finishSteps({ app, zip, notaryProfile: undefined })).toEqual([
      { remove: zip },
      { run: ["ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, zip]] },
    ]);
  });
});

describe("Developer ID release", () => {
  test("settings are opt-in and package:release needs both", () => {
    expect(signingConfig({ TM_SIGN_IDENTITY: devId })).toEqual({ mode: "developer-id", identity: devId, notaryProfile: undefined });
    expect(signingConfig({ TM_SIGN_IDENTITY: devId, TM_NOTARY_PROFILE: "tm-notary" }, { release: true })).toEqual({ mode: "developer-id", identity: devId, notaryProfile: "tm-notary" });
    expect(() => signingConfig({ TM_NOTARY_PROFILE: "tm-notary" })).toThrow(/TM_SIGN_IDENTITY is not/);
    expect(() => signingConfig({}, { release: true })).toThrow(/package:release needs TM_SIGN_IDENTITY/);
    expect(() => signingConfig({ TM_SIGN_IDENTITY: devId }, { release: true })).toThrow(/TM_NOTARY_PROFILE/);
  });

  test("identity lookup finds by name or hash and fails loudly otherwise", () => {
    expect(pickIdentity(identities, devId)).toEqual({ name: devId, fingerprint: hashA });
    expect(pickIdentity(identities, hashA.toLowerCase())).toEqual({ name: devId, fingerprint: hashA });
    expect(() => pickIdentity(identities, "Developer ID Application: Someone Else (ZZZZZ99999)")).toThrow(/was not found.*find-identity -v -p codesigning/);
    expect(() => pickIdentity("     0 valid identities found\n", devId)).toThrow(/was not found/);
    expect(() => pickIdentity(identities, "Time Machine Self Signed")).toThrow(/not a Developer ID Application identity/);
    const twice = `  1) ${hashA} "${devId}"\n  2) ${hashB} "${devId}"\n`;
    expect(() => pickIdentity(twice, devId)).toThrow(/matches 2 certificates.*SHA-1 hash/);
  });

  test("codesign uses a secure timestamp, hardened runtime and the release entitlements", () => {
    const signer = { mode: "developer-id" as const, fingerprint: hashA };
    expect(codesignArgs(signer, "/a/Main", true)).toEqual(["--force", "--sign", hashA, "--options", "runtime", "--timestamp", "--entitlements", releaseEntitlements, "/a/Main"]);
    expect(codesignArgs(signer, "/a/lib.dylib", false)).toEqual(["--force", "--sign", hashA, "--options", "runtime", "--timestamp", "/a/lib.dylib"]);
    expect(releaseEntitlements).toBe(join(desktop, "scripts/entitlements.release.plist"));
  });

  test("release entitlements keep JIT and drop the library validation exception", () => {
    const keys = [...readFileSync(releaseEntitlements, "utf8").matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]);
    expect(keys).toEqual(["com.apple.security.cs.allow-jit"]);
    const local = readFileSync(join(desktop, "scripts/entitlements.local.plist"), "utf8");
    expect(local).toContain("com.apple.security.cs.disable-library-validation");
  });

  test("Developer ID without a notary profile signs and zips only", () => {
    expect(finishSteps({ app, zip, notaryProfile: undefined }).some((s) => "notarize" in s)).toBe(false);
  });

  test("notarize, staple, then zip the stapled app again, then verify", () => {
    const ditto = { run: ["ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, zip]] };
    expect(finishSteps({ app, zip, notaryProfile: "tm-notary" })).toEqual([
      { remove: zip },
      ditto,
      { notarize: ["xcrun", ["notarytool", "submit", zip, "--keychain-profile", "tm-notary", "--wait", "--output-format", "json"]], profile: "tm-notary" },
      { run: ["xcrun", ["stapler", "staple", app]] },
      { remove: zip },
      ditto,
      { run: ["codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]] },
      { run: ["spctl", ["--assess", "--type", "execute", "-vv", app]] },
    ]);
  });

  test("only Accepted passes; anything else names the notarytool log command", () => {
    expect(checkNotary(JSON.stringify({ id: "sub-1", status: "Accepted", message: "ok" }), 0, "tm-notary")).toBe("sub-1");
    expect(() => checkNotary(JSON.stringify({ id: "sub-2", status: "Invalid" }), 0, "tm-notary"))
      .toThrow(/not Accepted \(status "Invalid", exit 0\).*\n.*xcrun notarytool log sub-2 --keychain-profile tm-notary/);
    expect(() => checkNotary(JSON.stringify({ id: "sub-3", status: "Accepted" }), 1, "tm-notary")).toThrow(/xcrun notarytool log sub-3/);
    expect(() => checkNotary("Error: HTTP 401", 69, "tm-notary")).toThrow(/exit 69, no submission result/);
    expect(() => checkNotary("", undefined, "tm-notary")).toThrow(/exit unknown/);
  });
});
