# Checkout setup

Not done yet. Checkout stays closed until the founder completes these steps. While it is closed, `POST /api/checkout` and `GET /api/license` answer `503 checkout_closed` and `/api/health` shows `checkout: false`. Nothing can be bought by mistake.

What is sold: the web app (`tm ui`) for $50 once, one plan, no free tier. See ADR 0013. The `tm` command line tool stays free and open source and never needs a key, so recovery is always possible with it.

## Who does this

An adult account holder. Stripe needs one, and `docs/legal/README.md` explains why a minor cannot be the seller of record. A parent or guardian, or a company with an adult officer, holds the Stripe account.

## 1. Make the signing keypair once

On your own computer, in the repo:

```sh
node scripts/license-keygen.mjs
```

It prints a public key and a private key and writes nothing.

- Save both in `.private/LICENSE_SIGNING_KEY.md` on your computer. That folder is never in the repo. Never paste the private key in chat, in an issue, or in a commit.
- Put the public key in `LICENSE_PUBLIC_KEY` in `packages/core/src/license.ts`, run `pnpm test`, and commit that change. Every release carries this public key.
- The private key goes only into Vercel, in step 3.

## 2. Stripe account, test mode first

1. Create or open the Stripe account. Finish the business details Stripe asks for.
2. Stay in **test mode** for the whole setup. Copy the test secret key (it starts with `sk_test_`).
3. Optional: make a product and a one-time price of $50 and copy its price id (`price_...`). Without it, the site sends the price inline on each checkout.

## 3. Vercel settings on `time-machine-site`

Project `time-machine-site`, team `shadowesus-projects`. Settings, Environment Variables. Set these for Production (and Preview if you want to test previews):

| Name | Value | Required |
|---|---|---|
| `STRIPE_SECRET_KEY` | The Stripe secret key. Test key first, live key later | yes |
| `TM_LICENSE_PRIVATE_KEY` | The private key from step 1, exactly as printed | yes |
| `SITE_ORIGIN` | `https://time-machine-site.vercel.app`, or the custom domain | no. Without it the site uses the request host |
| `STRIPE_PRICE_ID` | The `price_...` id from step 2 | no |

Redeploy after saving. Environment variables apply to new deployments only.

## 4. Check health

Open https://time-machine-site.vercel.app/api/health. It must show `"checkout": true`. If it shows `false`, one of the two required settings is missing or the private key is not 43 base64url characters. No secret value is ever shown there.

## 5. One test purchase

1. Open the site, go to Pricing, and press the buy button. It must open a `checkout.stripe.com` page.
2. Pay with the Stripe test card `4242 4242 4242 4242`, any future expiry, any CVC.
3. Stripe returns to `/thanks?session=cs_test_...`. The page shows a key that starts with `TM1.`. Reloading the page shows the same key.
4. On your computer run `tm license <key>`. It must print `License saved on this computer.` and `tm license` must then say `Licensed`.
5. `tm license --remove` forgets it again.

## 6. Go live

1. In Stripe, switch to live mode and finish activation.
2. Replace `STRIPE_SECRET_KEY` in Vercel with the live key (`sk_live_`). Keep the same `TM_LICENSE_PRIVATE_KEY`.
3. Redeploy, check `/api/health` again, and buy once for real with your own card, then refund it in Stripe.
4. Update the legal drafts before the first paid user: `docs/legal/TERMS.md` still describes subscriptions.

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
- It never signs a key for a session that is not `paid` in `payment` mode.
