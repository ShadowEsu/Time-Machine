# ADR 0013: One-time price for the web app

Date: 22 October 2026. Status: accepted (founder decision). Supersedes ADR 0002.

## Decision

- The product is the open source `tm` command line tool plus the local web app (`tm ui`). The Mac app is gone.
- One plan only. The web app costs **$50 once**. No subscription, no renewal, no free tier. The web app does not run without a license.
- The `tm` command line tool stays free under MIT (ADR 0010). Every command, including recovery, works without a license, so a restore is always possible through the open source tool.
- Paid users get updates to the web app while we ship them. We do not say "forever" or "lifetime".
- Payment runs through Stripe Checkout. The key is shown on the thanks page. No email is sent with the key.
- A buyer can sign in on the website with a one-time code sent to the email they paid with, and see every key for that email. Keys are derived from Stripe's own records, so the site keeps no license database.
- A key is `TM1.<payload>.<signature>`: an Ed25519 signature over a purchase id, the plan and the issue date. It holds no name or email. The app verifies it offline with the public key in `packages/core/src/license.ts`. Nothing phones home.
- The purchase id is a one-way code of the Stripe session id, so the thanks page and the sign-in page give the same key, and the real session id is not in the key.

## Alternatives considered

- **The Ladder subscription (ADR 0002).** A falling monthly price with a floor. Needs accounts, renewal emails, cancel flows and California automatic renewal compliance. Too much to run for a solo founder, and it makes the lawyer review longer. Superseded.
- **A free tier of the web app.** Considered as a limit on the number of projects. Dropped: one plan is simpler to explain, build and support, and the free open source tool already covers everyone who does not pay.
- **Freemium with cloud features.** Would need hosted storage, accounts and billing, all out of scope in the build brief.

## Cost

- No recurring revenue. Each sale is paid once.
- Support for paid users has no end date, so updates are promised only "while we ship them".
- Fewer people try the web app before paying. The demo and the command line tool have to carry the first impression.
- A leaked signing key means every key must be reissued with a new public key.

## Migration path

- Keys stay valid. The public key is embedded in each release; a key signed today still verifies in later releases that keep that public key.
- A future plan, for example teams, would be a new `plan` value or a new key prefix, verified by the same code path. Existing keys are not touched.
