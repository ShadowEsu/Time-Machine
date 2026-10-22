# Checkout setup

Not done yet. Checkout stays closed until the founder completes these steps. While it is closed, `POST /api/checkout` and `GET /api/license` answer `503 checkout_closed` and `/api/health` shows `checkout: false`. Nothing can be bought by mistake.

What is sold: the web app (`tm ui`) for $50 once. See ADR 0013. The CLI is free and never needs a key. No restore is ever gated.

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

## What the API never does

- It never stores the buyer's name or email. Stripe keeps the payment record; the site keeps nothing.
- It never emails the key. The thanks page is the only place it appears, and reloading it works.
- It never returns Stripe's error text or any secret to the browser. Those go to the Vercel function log only.
- It never signs a key for a session that is not `paid` in `payment` mode.
