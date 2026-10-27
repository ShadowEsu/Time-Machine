#!/usr/bin/env node
// Local end-to-end proof of the $50 purchase, with no network and no real Stripe or Supabase.
// It drives the real site handlers (checkout, license, auth, account) with a fake fetch that answers like
// Stripe and Supabase, signs with a throwaway keypair from scripts/license-keygen.mjs, then feeds the key
// to the built tm CLI and checks the app accepts it. Keys stay in memory; the CLI store is a temp dir.
// Run from the repository root: node scripts/checkout-e2e-local.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handleCheckout } from "../site/api/_lib/checkout.js";
import { handleLicense } from "../site/api/_lib/license.js";
import { handleAccount, handleAuth } from "../site/api/_lib/auth.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "packages/cli/dist/tm.js");
const ORIGIN = "http://localhost:3000";
const SUPABASE = "https://fake-project.supabase.test";
const SESSION = "cs_test_e2eLocalSynthetic0123456789";
const PI = "pi_test_e2eLocalSynthetic0123";
const EMAIL = "buyer@example.test";
const CODE = "123456";
const TOKEN = "synthetic.e2e.access-token-0123456789";

let failures = 0;
function check(label, ok, detail = "") {
  if (!ok) failures += 1;
  process.stdout.write(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `: ${detail}` : ""}\n`);
}
const short = (key) => `${key.slice(0, 12)}…${key.slice(-6)} (${key.length} chars)`;

// 1. A throwaway pair from the real keygen script, parsed from its output. Nothing touches the disk.
const keygen = execFileSync(process.execPath, [join(ROOT, "scripts/license-keygen.mjs")], { encoding: "utf8" });
const pub = /Public key \(32 bytes, base64url\):\s+([A-Za-z0-9_-]{43})/.exec(keygen)?.[1];
const priv = /Private key \(32 bytes, base64url\):\s+([A-Za-z0-9_-]{43})/.exec(keygen)?.[1];
if (!pub || !priv) throw new Error("scripts/license-keygen.mjs printed no keypair.");
check("throwaway keypair from scripts/license-keygen.mjs", true, `public ${pub.slice(0, 8)}…`);

const ENV = {
  STRIPE_SECRET_KEY: "sk_test_synthetic",
  SITE_ORIGIN: ORIGIN,
  TM_LICENSE_PRIVATE_KEY: priv,
  SUPABASE_URL: SUPABASE,
  SUPABASE_ANON_KEY: "synthetic-anon-key",
};

// 2. A fake fetch that answers like Stripe and Supabase. Any other address throws, so nothing real is called.
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const calls = [];
let created = null;
// Like Stripe: the payment intent is an id, or the object with its latest charge when the caller expands it.
// With TM_E2E_PROMO=1 the session is paid with a 50% promotion code: $25 charged, amount_subtotal still $50.
const PROMO = process.env.TM_E2E_PROMO === "1";
const paidSession = (expanded) => ({
  id: SESSION, object: "checkout.session", mode: "payment", payment_status: "paid", status: "complete",
  created: created?.at ?? Math.floor(Date.now() / 1000), livemode: false,
  payment_intent: expanded ? { id: PI, object: "payment_intent", latest_charge: { id: "ch_test_e2e", object: "charge", refunded: false, amount_refunded: 0 } } : PI,
  metadata: { product: "tm-web" }, currency: "usd", amount_subtotal: 5000, amount_total: PROMO ? 2500 : 5000,
  ...(PROMO ? { total_details: { amount_discount: 2500, amount_shipping: 0, amount_tax: 0 }, discounts: [{ promotion_code: "promo_test_calhacks50", coupon: "calhacks50" }] } : {}),
  customer_details: { email: EMAIL },
});
async function fakeFetch(input, init = {}) {
  const url = new URL(String(input));
  const method = init.method ?? "GET";
  calls.push(`${method} ${url.origin}${url.pathname}`);
  if (url.origin === "https://api.stripe.com") {
    if (init.headers?.Authorization !== `Bearer ${ENV.STRIPE_SECRET_KEY}`) return json({ error: { message: "bad key" } }, 401);
    if (method === "POST" && url.pathname === "/v1/checkout/sessions") {
      created = { form: Object.fromEntries(new URLSearchParams(init.body)), at: Math.floor(Date.now() / 1000) };
      return json({ id: SESSION, object: "checkout.session", url: `https://checkout.stripe.com/c/pay/${SESSION}` });
    }
    const expand = url.searchParams.getAll("expand[]");
    if (method === "GET" && url.pathname === `/v1/checkout/sessions/${SESSION}`) return json(paidSession(expand.includes("payment_intent.latest_charge")));
    if (method === "GET" && url.pathname === "/v1/checkout/sessions") {
      const mine = url.searchParams.get("customer_details[email]") === EMAIL;
      return json({ object: "list", data: mine ? [paidSession(expand.includes("data.payment_intent.latest_charge"))] : [], has_more: false });
    }
    if (method === "GET" && url.pathname === "/v1/disputes" && url.searchParams.get("payment_intent") === PI) return json({ object: "list", data: [], has_more: false });
  }
  if (url.origin === SUPABASE) {
    const body = init.body ? JSON.parse(init.body) : null;
    if (method === "POST" && url.pathname === "/auth/v1/otp") return json({});
    if (method === "POST" && url.pathname === "/auth/v1/verify") {
      return body?.token === CODE && body?.email === EMAIL ? json({ access_token: TOKEN, expires_in: 3600 }) : json({ msg: "Token has expired or is invalid" }, 403);
    }
    if (method === "GET" && url.pathname === "/auth/v1/user") {
      return init.headers?.Authorization === `Bearer ${TOKEN}` ? json({ id: "00000000-0000-4000-8000-000000000000", email: EMAIL, email_confirmed_at: "2026-10-25T00:00:00Z" }) : json({ msg: "invalid JWT" }, 401);
    }
  }
  throw new Error(`Unexpected request in the local e2e: ${method} ${url.origin}${url.pathname}`);
}
const deps = { env: ENV, fetch: fakeFetch, log: (message) => process.stdout.write(`     server log: ${message}\n`) };
const browser = { origin: ORIGIN, host: "localhost:3000", ip: "127.0.0.1" };
const jsonBody = (value) => {
  const text = JSON.stringify(value);
  return { contentLength: String(Buffer.byteLength(text)), readBody: async () => text };
};

// 3. checkout -> license -> auth send -> auth verify -> account.
const checkout = await handleCheckout({ method: "POST", ...browser }, deps);
check("POST /api/checkout", checkout.status === 200 && checkout.body.url === `https://checkout.stripe.com/c/pay/${SESSION}`, `${checkout.status} ${checkout.body.url ?? checkout.body.error}`);
const lifetime = Number(created?.form.expires_at) - (created?.at ?? 0);
check("  session is $50 one-time, tagged, returns to localhost, expires, promotion codes allowed", created?.form.mode === "payment"
  && created.form["line_items[0][price_data][unit_amount]"] === "5000" && created.form["metadata[product]"] === "tm-web"
  && created.form.allow_promotion_codes === "true"
  && created.form.success_url === `${ORIGIN}/thanks?session={CHECKOUT_SESSION_ID}` && lifetime >= 30 * 60 && lifetime <= 31 * 60,
  `success_url ${created?.form.success_url}, expires in ${Math.round(lifetime / 60)} min, allow_promotion_codes ${created?.form.allow_promotion_codes}`);
if (PROMO) process.stdout.write("     promotion code on: the paid session charges $25.00 (amount_total 2500) of a $50.00 subtotal\n");

const license = await handleLicense({ method: "GET", session: SESSION, ip: browser.ip }, deps);
const key = license.body.key;
check("GET /api/license (key minted)", license.status === 200 && /^TM1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key ?? ""), `${license.status} ${key ? short(key) : license.body.error} id ${license.body.id} issued ${license.body.issued}`);

const send = await handleAuth({ method: "POST", ...browser, ...jsonBody({ action: "send", email: EMAIL }) }, deps);
check("POST /api/auth send", send.status === 200 && send.body.ok === true, String(send.status));
const wrong = await handleAuth({ method: "POST", ...browser, ...jsonBody({ action: "verify", email: EMAIL, code: "000000" }) }, deps);
check("POST /api/auth verify, wrong code", wrong.status === 401 && wrong.body.error === "bad_code", `${wrong.status} ${wrong.body.error}`);
const verify = await handleAuth({ method: "POST", ...browser, ...jsonBody({ action: "verify", email: EMAIL, code: CODE }) }, deps);
check("POST /api/auth verify", verify.status === 200 && verify.body.token === TOKEN, `${verify.status} expiresIn ${verify.body.expiresIn}`);

const account = await handleAccount({ method: "GET", authorization: `Bearer ${verify.body.token}`, ip: browser.ip }, deps);
const listed = account.body.licenses ?? [];
check("GET /api/account (lists the same key)", account.status === 200 && account.body.email === EMAIL && listed.length === 1 && listed[0].key === key, `${account.status} ${account.body.email} ${listed.length} key(s)`);

// 4. The app accepts the key: the built CLI with the throwaway public key and a temp store.
if (!existsSync(CLI)) {
  process.stdout.write("     packages/cli/dist/tm.js missing, running pnpm -s build\n");
  execFileSync("pnpm", ["-s", "build"], { cwd: ROOT, stdio: "inherit" });
}
const home = mkdtempSync(join(tmpdir(), "tm-e2e-home-"));
const releaseHome = mkdtempSync(join(tmpdir(), "tm-e2e-release-"));
try {
  const baseEnv = { ...process.env };
  delete baseEnv.TM_LICENSE_PUBLIC_KEY;
  const tm = (args, env) => spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, env: { ...baseEnv, ...env }, encoding: "utf8" });
  const save = tm(["license", key], { TM_LICENSE_PUBLIC_KEY: pub, TM_HOME: home });
  check("tm license <key>", save.status === 0 && save.stdout.includes("License saved on this computer."), `exit ${save.status}: ${(save.stdout || save.stderr).trim().split("\n").join(" / ")}`);
  const status = tm(["license", "--json"], { TM_LICENSE_PUBLIC_KEY: pub, TM_HOME: home });
  const parsed = status.status === 0 ? JSON.parse(status.stdout) : {};
  check("tm license status is Active", parsed.active === true && parsed.id === license.body.id, `exit ${status.status}, active ${parsed.active}, id ${parsed.id}`);
  // A test-mode key never works in a normal release, which checks the embedded release public key.
  const release = tm(["license", key], { TM_HOME: releaseHome });
  check("release build refuses the throwaway key", release.status !== 0, `exit ${release.status}: ${release.stderr.trim()}`);
} finally {
  rmSync(home, { recursive: true, force: true });
  rmSync(releaseHome, { recursive: true, force: true });
}

// 5. A live Stripe key opens nothing until the attorney sign-off value is set.
const liveCalls = calls.length;
const live = await handleCheckout({ method: "POST", ...browser, ip: "127.0.0.2" }, { ...deps, env: { ...ENV, STRIPE_SECRET_KEY: "sk_live_x" } });
check("live key without STRIPE_LIVE_OK refused", live.status === 503 && live.body.error === "checkout_closed" && calls.length === liveCalls, `${live.status} ${live.body.error}, Stripe calls ${calls.length - liveCalls}`);

process.stdout.write(`\nFake upstream calls (${calls.length}): ${[...new Set(calls)].join(", ")}\n`);
process.stdout.write(failures === 0 ? "PASS: checkout to app works end to end on this computer, with mocked Stripe and Supabase.\n" : `FAIL: ${failures} step(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
