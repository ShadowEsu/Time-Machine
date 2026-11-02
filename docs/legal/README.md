# Legal pages

Status: **in effect from 2 November 2026** (owner decision, 2 November 2026: the seller is Unvibe, buyers write to support@unvibe.site, and the DRAFT label is dropped). Not legal advice.

| File | Covers | Needed by |
|---|---|---|
| `TERMS.md` | The website, the web app, the one-time license | First paid user |
| `PRIVACY.md` | What we collect and what never leaves your computer | Waitlist launch |

The free CLI is covered by its open source license (decision open, see the brief). These terms do not restrict it.

## What is recorded when someone agrees

Sign-in (the site's `/account` page and the app's Plan screen) and Buy each need an unticked box agreeing to the Terms and confirming the Privacy Policy was read, with the age line from `TERMS.md` (13 or older to sign in; 18 or older, or the paying parent or guardian, to buy). The box sends the versions it shows, set in `site/api/_lib/agreement.js`: `TERMS_VERSION` and `PRIVACY_VERSION` name each page's "Last updated" date, with a letter suffix when its words change twice on one day (`privacy-2026-10-28b`); `BOX_VERSION` names the box wording (`agree-box-2026-10-29`). `/api/auth` and `/api/checkout` refuse a missing box with 400 `agreement_required` and other or missing versions with 400 `agreement_outdated`, before calling Supabase or Stripe. We record `agreed_at`, `terms_version`, `privacy_version` and `box_version`: for sign-in, in the Supabase Auth user's metadata (sent when a code first creates the account, and written again on every successful sign-in, so an email that already had an account gets it too; the latest sign-in overwrites the earlier record, and the signed-in person can edit their own metadata); for checkout, in the Stripe Checkout Session's metadata. Change a page version whenever that page's words change, and the box version whenever the box wording changes, in `agreement.js`, `site/account.html`, `site/assets/buy.js` and `apps/web/src/shared/agreement.ts` together (tests keep them equal).

## Decided

1. **Seller:** Unvibe.
2. **Support mailbox:** support@unvibe.site, never a person's own address.
3. **Refund:** full refund within 14 days of purchase by email; after that, none unless the law requires one.
4. **Still open:** a business address, lawyer review of liability limits and the "yours to keep" license, and the tax route (Stripe Tax).

`site/api/_lib/legal-identity.test.mjs` fails if any shipped file brings back a DRAFT label, an `[Operator]` placeholder or a personal address, or if an agree box and the server record different consent versions.

## Rules these drafts follow

- Plain words. Short sentences. No em dashes.
- No "guaranteed", "undo anything", or "free forever".
- Every limit the product has is stated, matching the build brief.
- Cancel online in the same number of steps as sign-up.
