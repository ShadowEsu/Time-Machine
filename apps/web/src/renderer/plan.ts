// Plan: what is free, what the license adds, and what always stays free, said from the code and the published terms.
// The only limit in the app is how many projects it lists at once (FREE_PROJECT_LIMIT, checked when adding one).
// Buying happens on the Time Machine site; nothing here sells a feature that is not built. Signing in here only lists the
// keys the site already issued to that email, so one can be saved on this computer.
import type { AccountLicenses, LicenseStatus, SiteStatus } from "../shared/api.js";
import { esc, plural } from "../shared/format.js";

export const LICENSE_PRICE = "$50";

/** The license as Settings held it: the status on this computer, the key being pasted, and the last save or remove error. */
export interface LicenseView {
  status: LicenseStatus;
  draft: string;
  working: boolean;
  error: string | null;
}

/** Signing in to get a key. Held in memory only: quitting tm ui signs out and forgets it all. */
export interface AccountView {
  /** What the site has open; null while it is read, "error" when it could not be reached. */
  site: SiteStatus | null | "error";
  step: "email" | "code" | "keys";
  email: string;
  code: string;
  working: boolean;
  error: string | null;
  /** The keys the site lists for the signed-in email, once signed in. */
  account: AccountLicenses | null;
  /** When the last code was sent (ms), so Send a new code can wait out the site's limit; null before one is sent. */
  sentAt: number | null;
}

export const SIGNED_OUT: AccountView = { site: null, step: "email", email: "", code: "", working: false, error: null, account: null, sentAt: null };

/** How long Send a new code waits after a send: the site answers a send too soon with Retry-After: 60. */
export const RESEND_WAIT_MS = 60_000;

/** Whole seconds left before another code can be sent; 0 when it can be now. */
export const resendWait = (sentAt: number | null, now: number): number => (sentAt === null ? 0 : Math.max(0, Math.ceil((sentAt + RESEND_WAIT_MS - now) / 1000)));

/** The resend button's words: "Send a new code in 58 s" while it waits. */
export const resendLabel = (left: number): string => (left > 0 ? `Send a new code in ${left} s` : "Send a new code");

/** "12 Oct 2026" for a key's issue date, or the site's own words when they are not a date. */
function issuedOn(issued: string): string {
  const d = new Date(issued);
  return Number.isNaN(d.getTime()) ? issued : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Sign in to get your key: email, then the six digit code the site emails, then the keys bought with that email, each with
 * Use this key. A key is never shown: the row names its purchase and date. When the site has not opened sign-in, or cannot
 * be reached, the panel says so and the paste-key field under it stays the way in. `now` drives the resend countdown.
 */
export function signInPanel(a: AccountView, now = Date.now()): string {
  const head = (pill = ""): string => `<div class="si-top"><h3 id="signin-h" tabindex="-1">${a.step === "keys" ? "Your keys" : "Sign in to get your key"}</h3>${pill}</div>`;
  const busy = a.working ? "disabled" : "";
  const error = a.error ? `<div class="note bad" role="alert" id="signin-error">${esc(a.error)}</div>` : "";
  if (a.site === null) return `<div class="si-card" aria-busy="true">${head()}<p class="si-p">Checking whether sign-in is open…</p></div>`;
  if (a.site === "error") return `<div class="si-card">${head('<span class="lic-pill">Can’t reach the site</span>')}<p class="si-p">We couldn’t reach the Time Machine site just now. Paste your key below instead.</p></div>`;
  if (!a.site.auth) return `<div class="si-card">${head('<span class="lic-pill">Not open yet</span>')}<p class="si-p">Sign-in is not open yet. When it is, you can get your key here with your email. Until then, paste your key below.</p></div>`;
  const describedBy = (help: string): string => `${help}${a.error ? " signin-error" : ""}`;
  if (a.step === "email") {
    return `<div class="si-card">${head()}<form class="si-form" data-form="signin-email" novalidate>
      <label class="set-l" for="signin-email">Email you bought with</label>
      <p class="set-d" id="signin-email-d">We email you a 6-digit code. Your email goes to the Time Machine site only, and this app keeps nothing after you quit.</p>
      <div class="set-keyin"><input id="signin-email" class="field" data-model="signin-email" type="email" value="${esc(a.email)}" placeholder="you@example.com" autocomplete="email" spellcheck="false" autocapitalize="off" aria-invalid="${!!a.error}" aria-describedby="${describedBy("signin-email-d")}" ${busy}><button class="btn dark" type="submit" ${busy}>${a.working ? "Sending…" : "Send code"}</button></div>
      ${error}</form></div>`;
  }
  if (a.step === "code") {
    const left = resendWait(a.sentAt, now);
    return `<div class="si-card">${head()}<form class="si-form" data-form="signin-code" novalidate>
      <label class="set-l" for="signin-code">Code</label>
      <p class="set-d" id="signin-code-d">We sent a 6-digit code to <b class="sel-text">${esc(a.email)}</b>. It can take a minute to arrive.</p>
      <div class="set-keyin"><input id="signin-code" class="field mono si-code" data-model="signin-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" value="${esc(a.code)}" placeholder="123456" spellcheck="false" aria-invalid="${!!a.error}" aria-describedby="${describedBy("signin-code-d")}" ${busy}><button class="btn dark" type="submit" ${busy}>${a.working ? "Signing in…" : "Sign in"}</button></div>
      ${error}
      <div class="row-btns"><button class="btn link small" type="button" data-act="signin-resend" ${a.working || left ? "disabled" : ""}>${resendLabel(left)}</button><button class="btn link small" type="button" data-act="signin-restart" ${busy}>Use a different email</button></div></form></div>`;
  }
  const keys = a.account?.licenses ?? [];
  const rows = keys.map((k) => `<li class="si-key"><span class="si-kt"><span>Purchase <span class="mono lic-id">${esc(k.id)}</span></span><small>${esc(`Issued ${issuedOn(k.issued)}`)}</small></span><button class="btn" data-act="account-use" data-id="${esc(k.id)}" ${busy}>Use this key</button></li>`).join("");
  const who = a.account?.email ?? a.email;
  return `<div class="si-card">${head()}<p class="si-p">Signed in as <b class="sel-text">${esc(who)}</b> until tm ui stops.</p>
    ${keys.length ? `<ul class="si-keys">${rows}</ul>` : `<p class="si-p">No keys for this email yet. A key appears here once a license is bought with it.</p>`}
    ${error}
    <div class="row-btns"><button class="btn link small" type="button" data-act="signin-signout" ${busy}>Sign out</button><button class="btn link small" type="button" data-act="signin-restart" ${busy}>Use a different email</button></div></div>`;
}

/** What each column says. Every line is true of the shipped app or its published terms. */
export function planLines(limit: number): { free: string[]; license: string[]; always: string[] } {
  return {
    free: [`Up to ${plural(limit, "project")} at once`, "Every save, check, compare and restore", "Runs on this computer. Nothing is uploaded."],
    license: ["As many projects as you like", "On any number of your own computers", "Works offline: the key is checked on this computer", "Updates while we ship them", "Refund within 14 days by email", "No subscription"],
    always: ["Every restore stays free, with or without a license.", "The tm command, the Claude Code hooks and the MCP server never need a key."],
  };
}

/** Usage against the free limit, as a share for the bar: 0 to 100. */
export function usage(used: number, limit: number): number {
  return Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
}

/** The license card and the key field, moved here from Settings. The key itself is never shown back. `signIn` goes between
 *  the card and the key field on the free plan, so the field reads as the other way in. */
export function licensePanel(l: LicenseView, used: number, signIn = ""): string {
  const s = l.status;
  const busy = l.working ? "disabled" : "";
  const error = l.error ? `<div class="note bad" role="alert" id="license-error">${esc(l.error)}</div>` : "";
  if (s.active) {
    return `<div class="lic-card on"><div class="lic-top"><span class="lic-eye">This computer</span><span class="lic-pill on">Active</span></div>
      <p class="lic-big">Add as many projects as you like.</p>
      <p class="lic-p">Licensed. Purchase <span class="mono sel-text lic-id">${esc(s.id ?? "")}</span>, issued ${esc(s.issued ?? "")}.</p></div>
      <div class="set-row"><div class="set-t"><span class="set-l">Remove</span><p class="set-d">${esc(`The app goes back to ${plural(s.freeProjectLimit, "project")}. Keep a copy of the key if you want to use it again.`)}</p></div><div class="set-c"><button class="btn" data-act="license-remove" ${busy}>${l.working ? "Removing…" : "Remove from this computer"}</button></div></div>
      ${error}`;
  }
  const shown = Math.min(used, s.freeProjectLimit);
  const problem = s.problem ? `<div class="note warn">${esc(s.problem)}</div>` : "";
  return `<div class="lic-card"><div class="lic-top"><span class="lic-eye">This computer</span><span class="lic-pill">Free plan</span></div>
      <p class="lic-big">${esc(`${shown} of ${plural(s.freeProjectLimit, "project")}`)}</p>
      <span class="lic-bar" aria-hidden="true"><i style="width:${usage(used, s.freeProjectLimit)}%"></i></span>
      <p class="lic-p">${esc(used >= s.freeProjectLimit ? "The free app is full. Remove a project to add another, or add a license." : `${plural(s.freeProjectLimit - used, "more project")} before the free limit.`)}</p></div>
    ${problem}${signIn}
    <form class="set-key" data-form="license" novalidate>
      <div class="set-t"><label class="set-l" for="license-key">${signIn ? "Or paste your key" : "Your key"}</label><p class="set-d" id="license-key-d">The key is checked on this computer, with no network call. It is saved under your Time Machine folder.</p></div>
      <div class="set-keyin"><input id="license-key" class="field mono" data-model="license-key" type="text" value="${esc(l.draft)}" placeholder="TM1.…" autocomplete="off" spellcheck="false" autocapitalize="off" aria-invalid="${!!l.error}" aria-describedby="license-key-d${l.error ? " license-error" : ""}" ${busy}><button class="btn dark" type="submit" ${busy}>${l.working ? "Saving…" : "Save key"}</button></div>
      ${error}
    </form>`;
}

/** The Plan page: the two plans side by side, what always stays free, then this computer's license and the way to get a key. */
export function planPage(l: LicenseView, used: number, a: AccountView): string {
  const limit = l.status.freeProjectLimit;
  const lines = planLines(limit);
  const list = (xs: string[]): string => `<ul class="pl-lines">${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  const active = l.status.active;
  const checkout = a.site !== null && a.site !== "error" && a.site.checkout;
  const buy = checkout
    ? '<div class="row-btns"><button class="btn dark" data-act="license-buy">Buy a license</button></div><p class="pl-note">You pay on the Time Machine site. Then sign in below to get your key.</p>'
    : '<div class="row-btns"><button class="btn dark" data-act="license-buy">See pricing</button></div><p class="pl-note">Checkout is not open yet. The pricing page says when it is.</p>';
  return `<div class="page b9-page pl-page" id="plan-page" tabindex="-1" role="region" aria-label="Plan"><div class="b9">
    <header class="b9-head"><h1 id="plan-h" tabindex="-1">Plan</h1><p class="voice b9-voice">${esc(`Free for up to ${plural(limit, "project")}. One license, ${LICENSE_PRICE} once, lifts the limit.`)}</p></header>
    <section class="pl-cols" aria-label="Plans">
      <article class="pl-card${active ? "" : " now"}" aria-labelledby="pl-free-h"><div class="pl-top"><h2 id="pl-free-h">Free</h2>${active ? "" : '<span class="lic-pill">Your plan</span>'}</div><p class="pl-price">$0</p>${list(lines.free)}</article>
      <article class="pl-card${active ? " now" : ""}" aria-labelledby="pl-lic-h"><div class="pl-top"><h2 id="pl-lic-h">License</h2>${active ? '<span class="lic-pill on">Your plan</span>' : ""}</div><p class="pl-price">${LICENSE_PRICE} <span>once</span></p>${list(lines.license)}
        ${active ? "" : buy}</article>
    </section>
    <section class="b9-know" aria-labelledby="pl-always-h"><div><h2 id="pl-always-h">Always free</h2>${lines.always.map((x) => `<p>${esc(x)}</p>`).join("")}</div></section>
    <section id="license" aria-labelledby="license-h"><div class="b9-day"><h2 id="license-h" tabindex="-1">This computer</h2></div>${licensePanel(l, used, active ? "" : signInPanel(a))}</section>
  </div></div>`;
}
