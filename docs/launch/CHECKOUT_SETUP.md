# Checkout setup

Not done yet. Checkout stays closed until these steps are done. The owner's ordered list, with who does each step, is `docs/launch/OWNER_CHECKLIST_PAYMENTS.md`. While it is closed, `POST /api/checkout` and `GET /api/license` answer `503 checkout_closed` and `/api/health` shows `checkout: false`. Nothing can be bought by mistake.

What is sold: a one-time $50 license for the web app (`tm ui`), one plan. See ADR 0013. Without a license the web app lists up to 3 projects at a time; the key lifts that limit. The `tm` command line tool stays free and open source and never needs a key, so recovery is always possible with it.

## Who does this

The seller of record: an adult account holder, or a company with an adult officer. Stripe needs one. See `docs/legal/README.md`.

## 1. Make the keypairs

Two keypairs, made two different ways.

**A throwaway test keypair**, for test mode. On your own computer, in the repo:

```sh
node scripts/license-keygen.mjs
```

It prints a public key and a private key and writes nothing. The private key is what Vercel uses in test mode (step 3). Keys it signs work only with `TM_LICENSE_PUBLIC_KEY` set to its public key, never in a normal release. Keep the pair in `.private/LICENSE_SIGNING_KEY.md` on your computer; that folder is never in the repo.

**The release keypair**, for live mode (step 6). **Made on 2026-11-01.** Its public key is `LICENSE_PUBLIC_KEY` in `packages/core/src/license.ts` and `SELLER_PUBLIC_KEY` in `site/api/_lib/checkout.js` (a test keeps them equal and pins the value). Its private half exists only in Vercel, as the Production variable `TM_LICENSE_PRIVATE_KEY` of type Secret (Sensitive). One process made the pair in memory and wrote the private half only to the stdin of `vercel env add TM_LICENSE_PRIVATE_KEY --environment production --sensitive`, printing only the public half. The private half never went through argv, an env var, a file, a log or chat. `/api/health` on Production shows `"releaseKey": true` when that variable matches the committed public key.

There is no backup. **Never delete or overwrite that Vercel variable.** Every release accepts keys signed with it forever. If it is ever lost, make a new pair the same way and ship a release that accepts both public keys, so keys already sold keep working.

## 2. Stripe account, test mode first

1. Create or open the Stripe account. Finish the business details Stripe asks for.
2. Stay in **test mode** for the whole setup. Make a restricted test key (`rk_test_`) under Developers, API keys, Create restricted key, with only: Checkout Sessions **Write**, and **Read** for Checkout Sessions, PaymentIntents, Charges, Refunds and Disputes. The same permissions go on the live key later, so the test run proves them. A test secret key (`sk_test_`) also works.
3. No product or price is needed. The site sends the $50 price inline on every checkout, card only, tags each session it creates as `tm-web`, and only turns tagged, paid USD sessions at exactly $50 (before any promotion code) into keys, so other products on the same Stripe account never mint a Time Machine key.

## 3. Vercel settings on `time-machine-site`

Project `time-machine-site`, team `shadowesus-projects`. Settings, Environment Variables. Set these for **Preview** only. The Production deployment refuses a test key (step 6), so test mode runs on a preview deployment:

| Name | Value | Required |
|---|---|---|
| `STRIPE_SECRET_KEY` | The Stripe **test** key (`rk_test_` or `sk_test_`). Checkout stays closed with any other key, see step 6 | yes |
| `TM_LICENSE_PRIVATE_KEY` | The **throwaway** test private key from step 1. With a test Stripe key, checkout stays closed if this is the release private key | yes |
| `SITE_ORIGIN` | Leave it unset | no. Without it the site sends the buyer back to the host they bought on |

Redeploy after saving. Environment variables apply to new deployments only.

## 4. Check health

Open `/api/health` on the preview deployment. It must show `"checkout": true` and `"releaseKey": false`. If `checkout` shows `false`, one of the two required settings is missing, the Stripe key is not a test key, the signing key is the release key, the private key is not 43 base64url characters, or this is the Production deployment. No secret value is ever shown there.

## 5. One test purchase

1. Open the preview deployment, go to Pricing, and press the buy button. It must open a `checkout.stripe.com` page.
2. Pay with the Stripe test card `4242 4242 4242 4242`, any future expiry, any CVC.
3. Stripe returns to `/thanks?session=cs_test_...`. The page shows a key that starts with `TM1.`. Reloading the page shows the same key.
4. On your computer run `TM_LICENSE_PUBLIC_KEY=<throwaway public key> tm license <key>`. It must print `License saved on this computer.` and `TM_LICENSE_PUBLIC_KEY=<throwaway public key> tm license` must then say `Licensed`. Without that setting the key is refused, which is right: a test purchase never unlocks a normal release.
5. `tm license --remove` forgets it again.

## 6. Live mode: behind an exact Production gate

Live checkout opens only when all four of these hold, checked by `isCheckoutConfigured` in `site/api/_lib/checkout.js` before any Stripe call:

1. The deployment is Production (`VERCEL_ENV` is `production`). Preview and local runs are never live.
2. `TM_CHECKOUT_LIVE` is exactly `1`.
3. `STRIPE_SECRET_KEY` is a restricted live key: it starts with `rk_live_`, with nothing before it and no space or newline. A live secret key (`sk_live_`) is refused.
4. `TM_LICENSE_PRIVATE_KEY` is the release private key from step 1, so real money only ever buys keys every release accepts. `/api/health` shows `"releaseKey": true` exactly when this holds.

Anything else answers `503 checkout_closed` from checkout, license and account, and `/api/health` shows `checkout: false`. The Production deployment never takes a test key, with or without the flag, and no other deployment takes a live key.

Before turning it on, the owner's checklist (`docs/launch/OWNER_CHECKLIST_PAYMENTS.md`) needs: a seller of record (see `docs/legal/README.md`), final terms and privacy with one refund rule, and one support address. Then, on Production only, as Sensitive variables: the owner pastes the restricted live key (`rk_live_`, the same permissions as the step 2 test key) into `STRIPE_SECRET_KEY` in the Vercel UI, `TM_LICENSE_PRIVATE_KEY` already holds the release private key (step 1), and `SITE_ORIGIN` is `https://time-machine-site.vercel.app`, the host every network reaches (never `time-machine.company`, which some networks block). Check `/api/health` shows `"releaseKey": true` on Production, then set `TM_CHECKOUT_LIVE` to `1` last.

A session's mode always has to match the key's: a live server never gives a key for a test-mode session (`/api/license` answers `402 test_purchase` and `/api/account` leaves it out), and a test server never gives one for a live-mode session.

## 7. Sign-in so a buyer can see their key again

The site has no license database. When a buyer signs in, the site asks Stripe for the paid sessions under that email and derives the same keys the thanks page showed. Sign-in uses a one-time code sent by email through Supabase Auth.

1. Use the same Supabase project as the waitlist (`docs/launch/SUPABASE_SETUP.md`).
2. In Supabase, Authentication, Providers: turn **Email** on, keep **Confirm email** on, and keep **Enable email OTP** on. Never turn Confirm email off: with it off, anyone can sign up with a buyer's email and a password of their choosing, and Supabase marks that email as confirmed at once. The account page refuses a password session (it accepts only sessions signed in with a code, see step 7), so it would not show that buyer's keys, but the account in Supabase would still be theirs to sign in to. A new sign-in still takes one step with Confirm email on: Supabase creates the user and sends the code in the **Confirm signup** mail, and the site's code check accepts it.
3. In Authentication, Email Templates, put `{{ .Token }}` in the body of both **Confirm signup** (a buyer's first sign-in) and **Magic Link** (every sign-in after that). Without it the mail holds only a link, and the site's form asks for a code.
   Keep **Phone** sign-in off. The account page accepts only a session that signed in with a code (`amr` method `otp`), and a phone code counts as one too.
4. In Vercel, set `SUPABASE_ANON_KEY` to the project's anon key (`SUPABASE_URL` is already set for the waitlist). The site never falls back to `SUPABASE_KEY`: sign-in stays off until `SUPABASE_ANON_KEY` is set on purpose. Redeploy and check that `/api/health` shows `"auth": true`.
5. Supabase's built-in email sender is for testing only. It allows a few messages per hour and may be delayed. Before launch, set a custom SMTP provider in Authentication, SMTP Settings, and raise the rate limits in Authentication, Rate Limits.

**Decide this first.** The waitlist project `jaymini-prod` is shared with another app. Turning on Supabase Auth there puts every Time Machine sign-in into that project's `auth.users` table, next to the other app's users. Two options:

- Accept the shared sign-in pool. Simplest. Both apps then see the same users table, and a change to Auth settings affects both.
- Move the Time Machine site to its own Supabase project. Cleaner, but the free organization allows 2 projects and both are used, so one would need to go or the plan would change. The waitlist schema would move with it (`docs/launch/SUPABASE_SETUP.md`).

Until one is chosen and `SUPABASE_ANON_KEY` is set, sign-in answers `503 auth_closed`, `/api/health` shows `auth: false`, the site's Sign in links stay hidden, and the thanks page remains the only place a key is shown. The built-in email sender limit above applies either way.
6. Test it: on the site, open the sign-in page, enter the email used for the test purchase, enter the code from the mail, and check that the same `TM1.` key appears.
7. Before sign-in opens, run the takeover test once on a test Supabase project with a test purchase. First sign up the buyer's email with a password (`POST /auth/v1/signup`). Then sign in as the buyer with the emailed code. Then sign in with that password (`POST /auth/v1/token?grant_type=password`) and call `/api/account` with its token. It must answer `401`. The account page refuses any session whose `amr` is not only `otp`, because a password set before the buyer confirmed the email survives that confirmation.

A sign-in only ever shows keys for the email that paid. Codes expire after the time set in Supabase (one hour by default). The site keeps nothing about the sign-in; the browser holds the session until the tab closes.

## What the API never does

- It never stores the buyer's name or email. Stripe keeps the payment record, Supabase Auth keeps the sign-in email, and the site keeps nothing.
- It never emails the key. The thanks page is the only place it appears, and reloading it works.
- It never returns Stripe's error text or any secret to the browser. Those go to the Vercel function log only.
- It never signs a key for a session that is not `paid` in `payment` mode, not tagged `tm-web`, or not opened at exactly the $50 price, or whose mode (test or live) differs from the Stripe key's.
- It never offers a payment method that settles later: checkout is card only (Apple Pay and Google Pay ride on cards), so a paid session has its key at once.
- It never shows a key for a payment that is fully refunded, or that has a dispute or inquiry open or lost. The thanks page and sign-in read that state from Stripe on every request, so a partial refund, a won dispute or a closed inquiry shows the key again, and a status Stripe adds later shows no key until the rule is updated. A key already saved on a computer keeps working: keys are checked offline and cannot be taken back.
- It never lets one client keep asking Stripe: per IP, `/api/checkout` allows 10 sessions and `/api/license` 30 lookups per 10 minutes, then answers `429 rate_limited` without calling Stripe. Counts live in each function instance only. An unpaid checkout page closes after 31 minutes.

To test it on the preview deployment: refund a test purchase in full in the Stripe Dashboard, reload its `/thanks` page, and check that it says the purchase was refunded and shows no key.
