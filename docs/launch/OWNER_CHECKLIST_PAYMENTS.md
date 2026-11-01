# Owner checklist: taking real money

Status: not started. Checkout is closed today. `/api/health` shows `checkout: false` and `auth: false`.

These are the steps, in order, before the $50 web app license can take real payments. Each step says who does it. Do them in order: each one depends on the one before. Details for steps 2 to 5 are in `docs/launch/CHECKOUT_SETUP.md`.

What is built: checkout, the thanks page key, sign-in by email code, the account key list, and the app's sign-in calls. What is not done: every step below. No real payment has been taken.

## 1. Seller of record and Stripe account

- **Who:** an adult who can sign contracts, or a company with an adult officer (`docs/legal/README.md`).
- **Do:** create the Stripe account in that person's or company's name and finish the business details Stripe asks for.
- **URL:** https://dashboard.stripe.com/register
- **Then:** stay in test mode. At https://dashboard.stripe.com/test/apikeys, Create restricted key (`rk_test_`) with only: Checkout Sessions **Write**, and **Read** for Checkout Sessions, PaymentIntents, Charges, Refunds and Disputes. The live key in step 7 gets the same permissions. Do not make or use a live key yet.

## 2. Keypairs

- **Who:** the owner, on their own computer, in the repo.
- **Throwaway pair, for test mode:** `node scripts/license-keygen.mjs` (prints a pair, writes nothing). Keep it in `.private/LICENSE_SIGNING_KEY.md`, which is never in the repo.
- **Release pair, for live mode: done on 2026-11-01** (`CHECKOUT_SETUP.md` section 1). The private key is only in Vercel Production as `TM_LICENSE_PRIVATE_KEY` (Sensitive), and its public key is committed in `LICENSE_PUBLIC_KEY` and `SELLER_PUBLIC_KEY`. Never delete or overwrite that variable: there is no backup. Live checkout refuses any other signing key.

## 3. Vercel settings, test values first

- **Who:** the owner (an external change, so it is the owner's call).
- **URL:** https://vercel.com/shadowesus-projects/time-machine-site/settings/environment-variables
- **Or command, from `site/`:** `vercel env add <NAME> preview` now, and `vercel env add <NAME> production` at step 7.
- **Test values go on Preview only.** The Production deployment refuses a test key (`VERCEL_ENV` is `production`), so test mode runs on a preview deployment.

| Name | Value now (Preview) | Value at step 7 (Production) |
|---|---|---|
| `STRIPE_SECRET_KEY` | the `rk_test_` key from step 1 | the restricted live key (`rk_live_`), pasted by the owner in the Vercel UI |
| `TM_LICENSE_PRIVATE_KEY` | the throwaway private key from step 2 | already set: the release private key (step 2). Do not change it |
| `TM_CHECKOUT_LIVE` | leave unset | exactly `1` |
| `SUPABASE_ANON_KEY` | the Supabase project's anon key | same |
| `SITE_ORIGIN` | leave unset, so the preview's own address is used | `https://time-machine-site.vercel.app` (never `time-machine.company`, which some networks block) |

- **Then:** make a preview deployment so the settings apply, and open `/api/health` on it. It should show `"checkout": true`. It shows `"auth": true` only after step 4. Production keeps showing `"checkout": false` until step 9.

## 4. Supabase sign-in email

- **Who:** the owner. The Supabase project `jaymini-prod` is shared with other apps, so first decide: share its sign-in pool, or move Time Machine to its own project (`CHECKOUT_SETUP.md` section 7).
- **Where:** the Supabase dashboard for the chosen project, https://supabase.com/dashboard/project/<project-ref>/auth
- **Email templates** (Authentication, Email Templates): put `{{ .Token }}` in both the **Magic Link** and **Confirm signup** templates. Without it the email has only a link, and the site asks for a code.
- **Custom SMTP** (Authentication, SMTP Settings): set a sender with a neutral name. The built-in sender delivers only to team members and allows 2 emails per hour for the whole project.
- **Rate limits** (Authentication, Rate Limits): raise the email limit above 2 per hour.
- **URL configuration:** set Site URL to `https://time-machine-site.vercel.app`.
- **Then:** `/api/health` on the preview deployment should show `"auth": true`.

## 5. One test-mode run, end to end

- **Who:** the owner, or the lead with the owner.
- **Local proof first, no network:** `node scripts/checkout-e2e-local.mjs`. It should end with `PASS`.
- **Then a real Stripe test run on the preview deployment:** follow `CHECKOUT_SETUP.md` section 5 (pay with card `4242 4242 4242 4242`, get a `TM1.` key, `TM_LICENSE_PUBLIC_KEY=<throwaway public key> tm license <key>`), then section 7 step 6 (sign in on the site with the same email and see the same key).
- **Also check:** refund that test payment in full in the Stripe dashboard, reload the thanks page, and see that no key is shown.

## 6. Lawyer review

- **Who:** a lawyer, paid by the seller of record.
- **What:** `site/terms.html` and `site/privacy.html`. Points to cover: the seller's name, the refund rule (a full refund or an open or lost dispute stops the key from being shown again, but a key already saved keeps working offline), the revocation wording, and Supabase as a processor of the sign-in email.
- **Then:** written approval from the lawyer and from the owner.

## 7. Turn on live mode

- **Who:** the owner, only after the written approval in step 6.
- **Do, in Vercel, on Production only, each as a Sensitive variable:** paste the restricted live key into `STRIPE_SECRET_KEY` yourself, set `SITE_ORIGIN` to `https://time-machine-site.vercel.app`, and set `SUPABASE_ANON_KEY` if sign-in is on. `TM_LICENSE_PRIVATE_KEY` is already the release private key; do not change it. Redeploy, check that `/api/health` on Production shows `"releaseKey": true`, and only then set `TM_CHECKOUT_LIVE` to exactly `1`, last.
- **The code checks all of it:** live checkout opens only on Production, with `TM_CHECKOUT_LIVE` exactly `1`, an `rk_live_` key and the release signing key (`CHECKOUT_SETUP.md` section 6). Anything else stays closed and calls nothing.
- **After setting `TM_CHECKOUT_LIVE`, do not redeploy yet.** Settings apply only to the next deploy, which is step 9, after Security's GO.

## 8. Security GO

- **Who:** Security.
- **Ask for:** a re-review of the L1 fix (`site/api/_lib/auth.js`, commit `96deb2a`; L2 and L5 are on `main` from PR #32) and of the live settings from step 7.
- **Then:** wait for a written GO.

## 9. Deploy

- **Who:** the owner.
- **Command, from `site/`:** `vercel --prod`
- **Then:** open `/api/health` and check `"checkout": true` and `"releaseKey": true` (and `"auth": true` if sign-in is on).
- **First live purchase, with your own card:** buy once for $50 on the live site, check the `/thanks` key works with `tm license <key>` in a normal release, then refund that payment in full in the Stripe Dashboard (Payments, the payment, Refund), reload the same `/thanks` page and check that it says the purchase was refunded and shows no key.
