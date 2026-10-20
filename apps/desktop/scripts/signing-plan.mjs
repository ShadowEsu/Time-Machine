// Pure command construction for package-local.mjs. No processes run here, so tests can check
// every argument list. The default is the local self-signed build. Developer ID signing and
// notarization are opt-in through TM_SIGN_IDENTITY and TM_NOTARY_PROFILE.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scripts = dirname(fileURLToPath(import.meta.url));
export const localEntitlements = join(scripts, "entitlements.local.plist");
export const releaseEntitlements = join(scripts, "entitlements.release.plist");
const developerIdPrefix = "Developer ID Application:";

const setting = (value) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

// release: true is package:release. It needs both settings, so a release is never left unnotarized by accident.
export function signingConfig(env, { release = false } = {}) {
  const identity = setting(env.TM_SIGN_IDENTITY);
  const notaryProfile = setting(env.TM_NOTARY_PROFILE);
  if (release && (!identity || !notaryProfile)) {
    throw new Error("package:release needs TM_SIGN_IDENTITY (a \"Developer ID Application: ...\" identity or its SHA-1 hash) and TM_NOTARY_PROFILE (an xcrun notarytool store-credentials profile). See \"Before Apple notarization\" in apps/desktop/README.md.");
  }
  if (!identity && notaryProfile) throw new Error("TM_NOTARY_PROFILE is set but TM_SIGN_IDENTITY is not. Notarization needs a Developer ID Application identity.");
  if (!identity) return { mode: "local" };
  return { mode: "developer-id", identity, notaryProfile };
}

// Picks the requested identity from `security find-identity -v -p codesigning` output.
// Lines look like:   1) 0123...ABCD "Developer ID Application: Name (TEAMID)"
export function pickIdentity(output, requested) {
  const want = requested.trim();
  const found = new Map();
  for (const m of output.matchAll(/^\s*\d+\)\s+([0-9A-Fa-f]{40})\s+"(.+)"\s*$/gm)) {
    const [, hash, name] = m;
    if (hash.toUpperCase() === want.toUpperCase() || name === want) found.set(hash.toUpperCase(), name);
  }
  if (found.size === 0) {
    throw new Error(`Signing identity "${want}" was not found. \`security find-identity -v -p codesigning\` lists the valid identities on this Mac. Install the Developer ID Application certificate with its private key and Apple's intermediate certificate first.`);
  }
  if (found.size > 1) {
    throw new Error(`Signing identity "${want}" matches ${found.size} certificates (${[...found.keys()].join(", ")}). Set TM_SIGN_IDENTITY to one SHA-1 hash.`);
  }
  const [[fingerprint, name]] = [...found];
  if (!name.startsWith(developerIdPrefix)) {
    throw new Error(`"${name}" is not a Developer ID Application identity. Notarization needs one. Unset TM_SIGN_IDENTITY for the local self-signed build.`);
  }
  return { name, fingerprint };
}

// signer: { mode: "local", fingerprint, keychain } or { mode: "developer-id", fingerprint }.
// Local keeps the exact arguments used before Developer ID support. Developer ID adds Apple's
// secure timestamp and the release entitlements, which notarization requires.
export function codesignArgs(signer, path, executable) {
  if (signer.mode === "local") {
    return ["--force", "--sign", signer.fingerprint, "--keychain", signer.keychain, "--options", "runtime", "--timestamp=none",
      ...(executable ? ["--entitlements", localEntitlements] : []), path];
  }
  return ["--force", "--sign", signer.fingerprint, "--options", "runtime", "--timestamp",
    ...(executable ? ["--entitlements", releaseEntitlements] : []), path];
}

// Steps after the signed app is in release/. Each step is { remove }, { run: [command, args] }
// or { notarize: [command, args], profile }. A ZIP cannot be stapled, so the stapled app is zipped again.
export function finishSteps({ app, zip, notaryProfile }) {
  const zipApp = [{ remove: zip }, { run: ["ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, zip]] }];
  if (!notaryProfile) return zipApp;
  return [
    ...zipApp,
    { notarize: ["xcrun", ["notarytool", "submit", zip, "--keychain-profile", notaryProfile, "--wait", "--output-format", "json"]], profile: notaryProfile },
    { run: ["xcrun", ["stapler", "staple", app]] },
    ...zipApp,
    { run: ["codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]] },
    { run: ["spctl", ["--assess", "--type", "execute", "-vv", app]] },
  ];
}

// Reads `notarytool submit --wait --output-format json`. Returns the submission ID only when
// Apple accepted it. Anything else throws with the command that prints Apple's log.
export function checkNotary(stdout, exitStatus, profile) {
  let parsed;
  try { parsed = JSON.parse(stdout); } catch { parsed = undefined; }
  const id = typeof parsed?.id === "string" ? parsed.id : undefined;
  const status = typeof parsed?.status === "string" ? parsed.status : undefined;
  if (status === "Accepted" && exitStatus === 0 && id) return id;
  const log = id ? `\nRead Apple's log: xcrun notarytool log ${id} --keychain-profile ${profile}` : "";
  const what = status ? `status "${status}", exit ${exitStatus ?? "unknown"}` : `exit ${exitStatus ?? "unknown"}, no submission result`;
  throw new Error(`Notarization was not Accepted (${what}). The app was not stapled.${log}`);
}
