# Checkout setup

Not done yet. Checkout stays closed until these steps are done. While it is closed, `POST /api/checkout` and `GET /api/license` answer `503 checkout_closed` and `/api/health` shows `checkout: false`. Nothing can be bought by mistake.

What is sold: a one-time $50 license for the web app (`tm ui`), one plan. See ADR 0013. Without a license the web app lists up to 3 projects at a time; the key lifts that limit. The `tm` command line tool stays free and open source and never needs a key, so recovery is always possible with it.

## Who does this

The seller of record: an adult account holder, or a company with an adult officer. Stripe needs one. See `docs/legal/README.md`.

## 1. Make the keypairs

On your own computer, in the repo:

```sh
node scripts/license-keygen.mjs
```

It prints a public key and a private key and writes nothing. Run it twice:

- **The release keypair**, once. Its public key goes in `LICENSE_PUBLIC_KEY` in `packages/core/src/license.ts` and `SELLER_PUBLIC_KEY` in `site/api/_lib/checkout.js` (a test keeps them equal); run `pnpm test` and commit that change. Every release accepts keys signed with its private key, forever, so that private key signs keys only for real payments: it goes into Vercel only in step 6.
- **A throwaway test keypair.** Its private key is what Vercel uses in test mode (step 3). Keys it signs work only with `TM_LICENSE_PUBLIC_KEY` set to its public key, never in a normal release.
- Save all of them in `.private/LICENSE_SIGNING_KEY.md` on your computer. That folder is never in the repo. Never paste a private key in chat, in an issue, or in a commit.

## 2. Stripe account, test mode first

1. Create or open the Stripe account. Finish the business details Stripe asks for.
2. Stay in **test mode** for the whole setup. Copy the test secret key (it starts with `sk_test_`).
3. Optional: make a product and a one-time price of exactly $50 USD and copy its price id (`price_...`). Without it, the site sends the price inline on each checkout. Either way the site tags each session it creates as `tm-web` and only turns tagged, paid, full-price USD sessions into keys, so other products on the same Stripe account never mint a Time Machine key.

## 3. Vercel settings on `time-machine-site`

Project `time-machine-site`, team `shadowesus-projects`. Settings, Environment Variables. Set these for **Preview** only. The Production deployment refuses a test key (step 6), so test mode runs on a preview deployment:

| Name | Value | Required |
|---|---|---|
| `STRIPE_SECRET_KEY` | The Stripe **test** secret key (`sk_test_` or `rk_test_`). Checkout stays closed with any other key, see step 6 | yes |
| `TM_LICENSE_PRIVATE_KEY` | The **throwaway** test private key from step 1. With a test Stripe key, checkout stays closed if this is the release private key | yes |
| `SITE_ORIGIN` | The preview deployment's address, or leave it unset | no. Without it the site uses the request host |
| `STRIPE_PRICE_ID` | The `price_...` id from step 2 | no |

Redeploy after saving. Environment variables apply to new deployments only.

## 4. Check health

Open `/api/health` on the preview deployment. It must show `"checkout": true`. If it shows `false`, one of the two required settings is missing, the Stripe key is not a test key, the signing key is the release key, the private key is not 43 base64url characters, or this is the Production deployment. No secret value is ever shown there.

## 5. One test purchase

1. Open the preview deployment, go to Pricing, and press the buy button. It must open a `checkout.stripe.com` page.
2. Pay with the Stripe test card `4242 4242 4242 4242`, any future expiry, any CVC.
3. Stripe returns to `/thanks?session=cs_test_...`. The page shows a key that starts with `TM1.`. Reloading the page shows the same key.
4. On your computer run `TM_LICENSE_PUBLIC_KEY=<throwaway public key> tm license <key>`. It must print `License saved on this computer.` and `TM_LICENSE_PUBLIC_KEY=<throwaway public key> tm license` must then say `Licensed`. Without that setting the key is refused, which is right: a test purchase never unlocks a normal release.
5. `tm license --remove` forgets it again.

## 6. Live mode: locked

Live mode is locked. Do not put a live key (`sk_live_` or `rk_live_`) in Vercel, and do not take real payments, until the attorney and Preston both approve it in writing. That needs, at least: a seller of record who can sign (see `docs/legal/README.md`) and lawyer-reviewed terms and privacy with one refund rule.

The code enforces this: `isCheckoutConfigured` in `site/api/_lib/checkout.js` refuses any Stripe key that is not a test key, refuses a test key on the Production deployment (`VERCEL_ENV` is `production`), and refuses a test key paired with the release private key, so checkout, license and account answer `checkout_closed` and never call Stripe. The written approval is recorded by setting `STRIPE_LIVE_OK` to `yes-attorney-cleared` in Vercel. Nobody sets it before that approval exists.

After that approval, and only then, set together: the live Stripe key, `TM_LICENSE_PRIVATE_KEY` to the release private key from step 1, and `STRIPE_LIVE_OK`. Even then, a session Stripe marks as test mode (`livemode: false`) never gets a key signed with the release key: `/api/license` answers `402 test_purchase` and `/api/account` leaves it out.

Until then, everything above runs in Stripe test mode only, with test keys (`sk_test_`), test cards and the throwaway keypair.

## 7. Sign-in so a buyer can see their key again

The site has no license database. When a buyer signs in, the site asks Stripe for the paid sessions under that email and derives the same keys the thanks page showed. Sign-in uses a one-time code sent by email through Supabase Auth.

1. Use the same Supabase project as the waitlist (`docs/launch/SUPABASE_SETUP.md`).
2. In Supabase, Authentication, Providers: turn **Email** on. Turn **Confirm email** off and keep **Enable email OTP** on, so a new sign-in creates the user and sends a code in one step.
3. In Authentication, Email Templates, edit **Magic Link** so it shows the code: put `{{ .Token }}` in the body. Without it the mail holds only a link, and the site's form asks for a code.
4. In Vercel, set `SUPABASE_ANON_KEY` to the project's anon key (`SUPABASE_URL` is already set for the waitlist). The site never falls back to `SUPABASE_KEY`: sign-in stays off until `SUPABASE_ANON_KEY` is set on purpose. Redeploy and check that `/api/health` shows `"auth": true`.
5. Supabase's built-in email sender is for testing only. It allows a few messages per hour and may be delayed. Before launch, set a custom SMTP provider in Authentication, SMTP Settings, and raise the rate limits in Authentication, Rate Limits.

**Decide this first.** The waitlist project `jaymini-prod` is shared with another app. Turning on Supabase Auth there puts every Time Machine sign-in into that project's `auth.users` table, next to the other app's users. Two options:

- Accept the shared sign-in pool. Simplest. Both apps then see the same users table, and a change to Auth settings affects both.
- Move the Time Machine site to its own Supabase project. Cleaner, but the free organization allows 2 projects and both are used, so one would need to go or the plan would change. The waitlist schema would move with it (`docs/launch/SUPABASE_SETUP.md`).

Until one is chosen and `SUPABASE_ANON_KEY` is set, sign-in answers `503 auth_closed` and the thanks page remains the only place a key is shown. The built-in email sender limit above applies either way.
6. Test it: on the site, open the sign-in page, enter the email used for the test purchase, enter the code from the mail, and check that the same `TM1.` key appears.

A sign-in only ever shows keys for the email that paid. Codes expire after the time set in Supabase (one hour by default). The site keeps nothing about the sign-in; the browser holds the session until the tab closes.

## What the API never does

- It never stores the buyer's name or email. Stripe keeps the payment record, Supabase Auth keeps the sign-in email, and the site keeps nothing.
- It never emails the key. The thanks page is the only place it appears, and reloading it works.
- It never returns Stripe's error text or any secret to the browser. Those go to the Vercel function log only.
- It never signs a key for a session that is not `paid` in `payment` mode, not tagged `tm-web`, or below the $50 price, and never signs a release key for a test-mode session.
- It never shows a key for a payment that is fully refunded, or that has a dispute or inquiry open or lost. The thanks page and sign-in read that state from Stripe on every request, so a partial refund, a won dispute or a closed inquiry shows the key again, and a status Stripe adds later shows no key until the rule is updated. A key already saved on a computer keeps working: keys are checked offline and cannot be taken back.
- It never lets one client keep asking Stripe: per IP, `/api/checkout` allows 10 sessions and `/api/license` 30 lookups per 10 minutes, then answers `429 rate_limited` without calling Stripe. Counts live in each function instance only. An unpaid checkout page closes after 31 minutes.

To test it on the preview deployment: refund a test purchase in full in the Stripe Dashboard, reload its `/thanks` page, and check that it says the purchase was refunded and shows no key.
