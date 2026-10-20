// A local identity, not Apple Developer ID. Keep the encrypted key and p12 outside the checkout.
// developerIdIdentity only looks up an Apple-issued identity the owner installed. It creates nothing.
import { createPrivateKey, randomBytes, X509Certificate } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { pickIdentity } from "./signing-plan.mjs";

const name = "Time Machine Self Signed";
const directory = join(homedir(), ".timemachine-signing");

// Never log arguments: security needs passwords as arguments for keychain operations.
function run(command, args, secret = "", input) {
  const r = spawnSync(command, args, { encoding: "utf8", input, env: { ...process.env, ...(secret ? { TIMETM_SIGNING_PASSWORD: secret } : {}) } });
  if (r.error || r.status !== 0) {
    const detail = String(r.error?.message ?? r.stderr).replaceAll(secret || "\0", "[redacted]");
    throw new Error(`${command} failed: ${detail}`);
  }
  return r.stdout;
}

export function ensureSigningIdentity() {
  process.umask(0o077);
  if (process.platform !== "darwin") throw new Error("Local signing needs macOS.");
  const passwordPath = join(directory, "password");
  const keyPath = join(directory, "private-key.pem");
  const certPath = join(directory, "certificate.pem");
  const p12Path = join(directory, "identity.p12");
  const keychain = join(directory, "signing.keychain-db");
  const complete = join(directory, "ready");
  if (!existsSync(directory)) {
    mkdirSync(directory, { mode: 0o700 });
    writeFileSync(passwordPath, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
  }
  if (!existsSync(complete)) {
    // Resume a partial setup without replacing any existing key or certificate.
    const password = readFileSync(passwordPath, "utf8");
    if (!existsSync(keyPath)) run("openssl", ["genrsa", "-aes256", "-passout", `file:${passwordPath}`, "-out", keyPath, "3072"]);
    chmodSync(keyPath, 0o600);
    // Feed the decrypted key only through stdin. No plaintext key is written to disk or argv.
    // This also avoids passphrase prompts in OpenSSL subprocesses with a closed terminal.
    const key = createPrivateKey({ key: readFileSync(keyPath), passphrase: password }).export({ type: "pkcs8", format: "pem" });
    if (!existsSync(certPath)) run("openssl", ["req", "-new", "-x509", "-sha256", "-days", "3650", "-key", "/dev/stdin", "-out", certPath,
      "-subj", `/CN=${name}/`, "-addext", "basicConstraints=critical,CA:FALSE", "-addext", "keyUsage=critical,digitalSignature", "-addext", "extendedKeyUsage=critical,codeSigning"], "", key);
    chmodSync(certPath, 0o600);
    // Explicit PKCS#12 algorithms readable by macOS security import.
    if (!existsSync(p12Path)) run("openssl", ["pkcs12", "-export", "-inkey", "/dev/stdin", "-in", certPath, "-out", p12Path,
      "-passout", "env:TIMETM_SIGNING_PASSWORD", "-keypbe", "PBE-SHA1-3DES", "-certpbe", "PBE-SHA1-3DES", "-macalg", "sha1", "-name", name], password, key);
    chmodSync(p12Path, 0o600);
    if (!existsSync(keychain)) run("security", ["create-keychain", "-p", password, keychain], password);
    run("security", ["unlock-keychain", "-p", password, keychain], password);
    run("security", ["import", p12Path, "-k", keychain, "-P", password, "-T", "/usr/bin/codesign"], password);
    run("security", ["set-key-partition-list", "-S", "apple-tool:,apple:,codesign:", "-s", "-k", password, keychain], password);
    // User-local code-signing trust only. No system trust, sudo or Apple enrollment.
    run("security", ["add-trusted-cert", "-r", "trustRoot", "-p", "codeSign", "-k", keychain, certPath]);
    writeFileSync(complete, `${name}\n`, { mode: 0o600, flag: "wx" });
  }
  chmodSync(directory, 0o700);
  for (const path of [passwordPath, keyPath, certPath, p12Path, keychain, complete]) chmodSync(path, 0o600);
  const password = readFileSync(passwordPath, "utf8");
  run("security", ["unlock-keychain", "-p", password, keychain], password);
  // codesign also needs the identity in the user search list, even with --keychain.
  // Keep every existing entry and append only our own dedicated keychain.
  const searchList = [...run("security", ["list-keychains", "-d", "user"]).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (!searchList.includes(keychain)) run("security", ["list-keychains", "-d", "user", "-s", ...searchList, keychain]);
  const certificate = new X509Certificate(readFileSync(certPath));
  const fingerprint = certificate.fingerprint.replaceAll(":", "");
  const identities = run("security", ["find-identity", "-v", "-p", "codesigning", keychain]);
  if (!identities.includes(fingerprint)) throw new Error("The saved certificate is not a valid code-signing identity in the dedicated keychain.");
  return { name, fingerprint, sha256: certificate.fingerprint256, keychain };
}

// Finds a Developer ID Application identity in the user's keychain search list. Throws if it is
// missing, ambiguous or not Developer ID.
export function developerIdIdentity(requested) {
  if (process.platform !== "darwin") throw new Error("Developer ID signing needs macOS.");
  return pickIdentity(run("security", ["find-identity", "-v", "-p", "codesigning"]), requested);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const identity = ensureSigningIdentity();
  console.log(`${identity.name}\nSHA-256: ${identity.sha256}\nSaved in ${directory}. Keep this directory backed up privately.`);
}
