import { describe, expect, test } from "vitest";
import type { LicenseStatus } from "../src/shared/api.ts";
import { licenseAfterSave, licensePanel, planLines, planPage, RESEND_WAIT_MS, resendLabel, resendWait, SIGNED_OUT, signInPanel, usage, type AccountView, type LicenseView } from "../src/renderer/plan.ts";

const free: LicenseStatus = { active: false, id: null, issued: null, problem: null, freeProjectLimit: 3 };
const view = (status: LicenseStatus): LicenseView => ({ status, draft: "", working: false, error: null });

describe("Plan", () => {
  test("says what is free, what $50 once adds and what always stays free", () => {
    const l = planLines(3);
    expect(l.free[0]).toBe("Up to 3 projects at once");
    expect(l.license).toEqual(expect.arrayContaining(["As many projects as you like", "Works offline: the key is checked on this computer", "Refund within 14 days by email", "No subscription"]));
    expect(l.always.join(" ")).toContain("never need a key");
    const html = planPage(view(free), 2, SIGNED_OUT);
    expect(html).toContain("$50 <span>once</span>");
    expect(html).toContain("See pricing");
    expect(html).toContain("Checkout is not open yet.");
    // Usage and the key field live here now.
    expect(html).toContain("2 of 3 projects");
    expect(html).toContain('data-form="license"');
  });

  test("a license on this computer hides the buy button and offers Remove", () => {
    const html = planPage(view({ ...free, active: true, id: "p_1", issued: "2026-10-20" }), 5, { ...SIGNED_OUT, site: { checkout: true, auth: true } });
    expect(html).not.toContain("Buy a license");
    expect(html).not.toContain("Sign in to get your key");
    expect(html).not.toContain("See pricing");
    expect(html).toContain('data-act="license-remove"');
  });

  test("a full free plan says so, and the bar never runs past full", () => {
    expect(licensePanel(view(free), 3)).toContain("The free app is full.");
    expect(usage(5, 3)).toBe(100);
    expect(usage(1, 3)).toBe(33);
  });

  test("a refused key shows the engine's sentence under the field, and a saved one clears the draft", () => {
    const saving: LicenseView = { status: free, draft: "hello-world", working: true, error: null };
    const refused = licenseAfterSave(saving, { error: "That is not a Time Machine license key." });
    expect(refused).toEqual({ status: free, draft: "hello-world", working: false, error: "That is not a Time Machine license key." });
    const html = licensePanel(refused, 1);
    expect(html).toContain('<div class="note bad" role="alert" id="license-error">That is not a Time Machine license key.</div>');
    expect(html).toContain('aria-invalid="true" aria-describedby="license-key-d license-error"');
    expect(html).toContain('value="hello-world"');
    const on: LicenseStatus = { ...free, active: true, id: "p_1", issued: "2026-10-20" };
    expect(licenseAfterSave(saving, { status: on })).toEqual({ status: on, draft: "", working: false, error: null });
  });

  describe("sign in to get your key", () => {
    const open = { checkout: false, auth: true };
    const at = (over: Partial<AccountView>): AccountView => ({ ...SIGNED_OUT, site: open, ...over });

    test("sits between the license card and the paste-key field, which stays", () => {
      const html = planPage(view(free), 1, at({}));
      const card = html.indexOf("lic-card");
      const signIn = html.indexOf("Sign in to get your key");
      const paste = html.indexOf('data-form="license"');
      expect(card).toBeLessThan(signIn);
      expect(signIn).toBeLessThan(paste);
      expect(html).toContain("Or paste your key");
    });

    test("when the site has not opened sign-in, it says so and the paste-key field stays the way in", () => {
      const html = planPage(view(free), 1, at({ site: { checkout: false, auth: false } }));
      expect(html).toContain("Sign-in is not open yet.");
      expect(html).not.toContain('data-form="signin-email"');
      expect(html).toContain('data-form="license"');
      expect(signInPanel(at({ site: "error" }))).toContain("couldn’t reach the Time Machine site");
      expect(signInPanel(at({ site: null }))).toContain("Checking whether sign-in is open");
    });

    test("email, then Send code, then the 6-digit code and Sign in", () => {
      const email = signInPanel(at({}));
      expect(email).toContain('data-form="signin-email"');
      expect(email).toContain('type="email"');
      expect(email).toContain("Send code");
      const code = signInPanel(at({ step: "code", email: "a@b.co" }));
      expect(code).toContain('data-form="signin-code"');
      expect(code).toContain('autocomplete="one-time-code"');
      expect(code).toContain("a@b.co");
      expect(code).toContain(">Sign in<");
      expect(code).toContain('data-act="signin-restart"');
    });

    test("lists the keys for the email with Use this key, and never shows a key", () => {
      const html = signInPanel(at({ step: "keys", account: { email: "a@b.co", licenses: [{ key: "TM1.secretpayload.sig", id: "p_9", issued: "2026-10-20T10:00:00Z" }] } }));
      expect(html).toContain('data-act="account-use" data-id="p_9"');
      expect(html).toContain("Use this key");
      expect(html).toContain("p_9");
      expect(html).not.toContain("TM1.");
      expect(signInPanel(at({ step: "keys", account: { email: "a@b.co", licenses: [] } }))).toContain("No keys for this email yet.");
      expect(html).toContain('data-act="signin-signout"');
      expect(html).toContain(">Sign out<");
    });

    test("once signed in the heading says Your keys; before, it says how to get one", () => {
      expect(signInPanel(at({ step: "keys", account: { email: "a@b.co", licenses: [] } }))).toContain(">Your keys</h3>");
      expect(signInPanel(at({ step: "code", email: "a@b.co" }))).toContain(">Sign in to get your key</h3>");
    });

    test("Send a new code counts down for a minute after a send, as the site's Retry-After does", () => {
      const sent = 1_000_000;
      expect(resendWait(sent, sent + 1_000)).toBe(59);
      expect(resendWait(sent, sent + RESEND_WAIT_MS)).toBe(0);
      expect(resendWait(null, sent)).toBe(0);
      expect(resendLabel(58)).toBe("Send a new code in 58 s");
      expect(resendLabel(0)).toBe("Send a new code");
      const waiting = signInPanel(at({ step: "code", email: "a@b.co", sentAt: sent }), sent + 2_000);
      expect(waiting).toMatch(/data-act="signin-resend" disabled[^>]*>Send a new code in 58 s</);
      expect(signInPanel(at({ step: "code", email: "a@b.co", sentAt: sent }), sent + RESEND_WAIT_MS)).toMatch(/data-act="signin-resend" >Send a new code</);
    });

    test("errors are said in an alert tied to the field", () => {
      const html = signInPanel(at({ step: "code", email: "a@b.co", error: "That code didn't match." }));
      expect(html).toContain('role="alert"');
      expect(html).toContain("That code didn&#39;t match.");
      expect(html).toContain('aria-describedby="signin-code-d signin-error"');
    });

    test("an open checkout turns See pricing into Buy a license", () => {
      const html = planPage(view(free), 1, at({ site: { checkout: true, auth: true } }));
      expect(html).toContain("Buy a license");
      expect(html).not.toContain("Checkout is not open yet.");
    });
  });
});
