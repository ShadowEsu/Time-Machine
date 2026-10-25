# Owner checklist: taking real money

Status: not started. Checkout is closed today. `/api/health` shows `checkout: false` and `auth: false`.

These are the steps, in order, before the $50 web app license can take real payments. Each step says who does it. Do them in order: each one depends on the one before. Details for steps 2 to 5 are in `docs/launch/CHECKOUT_SETUP.md`.

What is built: checkout, the thanks page key, sign-in by email code, the account key list, and the app's sign-in calls. What is not done: every step below. No real payment has been taken.

## 1. Seller of record and Stripe account

- **Who:** an adult who can sign contracts: a parent, or a company with an adult officer. Not the founder alone, who is a student (`docs/legal/README.md`).
- **Do:** create the Stripe account in that person's or company's name and finish the business details Stripe asks for.
- **URL:** https://dashboard.stripe.com/register
- **Then:** stay in test mode. Copy the test secret key (starts with `sk_test_`) from https://dashboard.stripe.com/test/apikeys. Do not copy or use the live key yet.

## 2. Keypairs

- **Who:** Preston, on his own computer, in the repo.
- **Command:** `node scripts/license-keygen.mjs` (prints a pair, writes nothing).
- **Release pair:** the repo already holds a release public key (`LICENSE_PUBLIC_KEY` in `packages/core/src/license.ts`, equal to `SELLER_PUBLIC_KEY` in `site/api/_lib/checkout.js`). If you hold its private half, keep it and skip making a new one. If nobody holds it, make a new pair, put the new public key in both places in one commit, and run `pnpm vitest run site/api packages/core/test/license.test.ts`. No key has been sold yet, so nothing breaks.
- **Throwaway pair:** run the command again. This pair is for test mode only.
- **Where private keys go:** the release private key goes into Vercel only, and only in step 7. Keep your own private backup in `.private/LICENSE_SIGNING_KEY.md`, which is never in the repo. Never paste a private key in chat, an issue or a commit.

## 3. Vercel settings, test values first

- **Who:** Preston (an external change, so it is his call).
- **URL:** https://vercel.com/shadowesus-projects/time-machine-site/settings/environment-variables
- **Or command, from `site/`:** `vercel env add <NAME> preview` now, and `vercel env add <NAME> production` at step 7.
- **Test values go on Preview only.** The Production deployment refuses a test key (`VERCEL_ENV` is `production`), so test mode runs on a preview deployment.

| Name | Value now (Preview) | Value at step 7 (Production) |
|---|---|---|
| `STRIPE_SECRET_KEY` | the `sk_test_` key from step 1 | the live key |
| `TM_LICENSE_PRIVATE_KEY` | the throwaway private key from step 2 | the release private key |
| `SUPABASE_ANON_KEY` | the Supabase project's anon key | same |
| `SITE_ORIGIN` | leave unset, so the preview's own address is used | `https://time-machine-site.vercel.app`, or the custom domain |

- **Then:** make a preview deployment so the settings apply, and open `/api/health` on it. It should show `"checkout": true`. It shows `"auth": true` only after step 4. Production keeps showing `"checkout": false` until step 9.

## 4. Supabase sign-in email

- **Who:** Preston. The Supabase project `jaymini-prod` is shared with other apps, so first decide: share its sign-in pool, or move Time Machine to its own project (`CHECKOUT_SETUP.md` section 7).
- **Where:** the Supabase dashboard for the chosen project, https://supabase.com/dashboard/project/<project-ref>/auth
- **Email templates** (Authentication, Email Templates): put `{{ .Token }}` in both the **Magic Link** and **Confirm signup** templates. Without it the email has only a link, and the site asks for a code.
- **Custom SMTP** (Authentication, SMTP Settings): set a sender with a neutral name. The built-in sender delivers only to team members and allows 2 emails per hour for the whole project.
- **Rate limits** (Authentication, Rate Limits): raise the email limit above 2 per hour.
- **URL configuration:** set Site URL to the `SITE_ORIGIN` value.
- **Then:** `/api/health` on the preview deployment should show `"auth": true`.

## 5. One test-mode run, end to end

- **Who:** Preston, or the lead with him.
- **Local proof first, no network:** `node scripts/checkout-e2e-local.mjs`. It should end with `PASS`.
- **Then a real Stripe test run on the preview deployment:** follow `CHECKOUT_SETUP.md` section 5 (pay with card `4242 4242 4242 4242`, get a `TM1.` key, `TM_LICENSE_PUBLIC_KEY=<throwaway public key> tm license <key>`), then section 7 step 6 (sign in on the site with the same email and see the same key).
- **Also check:** refund that test payment in full in the Stripe dashboard, reload the thanks page, and see that no key is shown.

## 6. Lawyer review

- **Who:** a lawyer, paid by the seller of record.
- **What:** `site/terms.html` and `site/privacy.html`. Points to cover: the seller's name, the refund rule (a full refund or an open or lost dispute stops the key from being shown again, but a key already saved keeps working offline), the revocation wording, and Supabase as a processor of the sign-in email.
- **Then:** written approval from the lawyer and from Preston.

## 7. Turn on live mode

- **Who:** Preston, only after the written approval in step 6.
- **Do, all at once in Vercel, on Production:** set `STRIPE_SECRET_KEY` to the live key, `TM_LICENSE_PRIVATE_KEY` to the release private key, `SUPABASE_ANON_KEY`, `SITE_ORIGIN`, and `STRIPE_LIVE_OK` to exactly `yes-attorney-cleared`.
- **Do not redeploy yet.** Settings apply only to the next deploy.

## 8. Security GO

- **Who:** Security.
- **Ask for:** a re-review of the L1 fix (`site/api/_lib/auth.js`, commit `96deb2a`; L2 and L5 are on `main` from PR #32) and of the live settings from step 7.
- **Then:** wait for a written GO.

## 9. Deploy

- **Who:** Preston.
- **Command, from `site/`:** `vercel --prod`
- **Then:** open `/api/health` and check `"checkout": true` and `"auth": true`. Make one real $50 purchase with your own card, check the key works with `tm license <key>` in a normal release, and refund it if you want.
