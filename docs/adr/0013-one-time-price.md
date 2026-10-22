# ADR 0013: One-time price for the web app

Date: 22 October 2026. Status: accepted (founder decision). Supersedes ADR 0002.

## Decision

- The product is the free MIT CLI (`tm`) plus the local web app (`tm ui`). The Mac app is gone.
- The web app costs **$50 once**. No subscription, no renewal, no account.
- Free web app: lists up to 3 projects. Paid: unlimited projects, and updates while we ship them. We do not say "forever" or "lifetime".
- The CLI never needs a license. No restore is ever gated, free or paid.
- Payment runs through Stripe Checkout. The key is shown once on the thanks page. No email is sent.
- A key is `TM1.<payload>.<signature>`: an Ed25519 signature over a purchase id, the plan and the issue date. It holds no name or email. The app verifies it offline with the public key in `packages/core/src/license.ts`. Nothing phones home.
- The purchase id is a one-way code of the Stripe session id, so reloading the thanks page gives the same key and the real session id is not in the key.

## Alternatives considered

- **The Ladder subscription (ADR 0002).** A falling monthly price with a floor. Needs accounts, renewal emails, cancel flows and California automatic renewal compliance. Too much to run for a solo founder, and it makes the lawyer review longer. Superseded.
- **Freemium with cloud features.** Would need hosted storage, accounts and billing, all out of scope in the build brief.

## Cost

- No recurring revenue. Each sale is paid once.
- Support for paid users has no end date, so updates are promised only "while we ship them".
- A leaked signing key means every key must be reissued with a new public key.

## Migration path

- Keys stay valid. The public key is embedded in each release; a key signed today still verifies in later releases that keep that public key.
- A future plan, for example teams, would be a new `plan` value or a new key prefix, verified by the same code path. Existing keys are not touched.
