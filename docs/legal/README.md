# Legal drafts

Status: **drafts only. Not in effect. Not legal advice.** A licensed lawyer must review them before anything is sold or any account is created.

| File | Covers | Needed by |
|---|---|---|
| `TERMS.md` | The website, the web app, the one-time license | First paid user |
| `PRIVACY.md` | What we collect and what never leaves your computer | Waitlist launch |

The free CLI is covered by its open source license (decision open, see the brief). These terms do not restrict it.

## What is recorded when someone agrees

Sign-in (the site's `/account` page and the app's Plan screen) and Buy each need an unticked box agreeing to the Terms and Privacy Policy, with the age line from `TERMS.md` (13 or older to sign in; 18 or older, or the paying parent or guardian, to buy). The box sends the versions it shows, set in `site/api/_lib/agreement.js` (`TERMS_VERSION`, `PRIVACY_VERSION`, named by each page's "Last updated" date). `/api/auth` and `/api/checkout` refuse a missing box with 400 `agreement_required` and other versions with 400 `agreement_outdated`, before calling Supabase or Stripe. We record `agreed_at`, `terms_version` and `privacy_version`: for sign-in, in the Supabase Auth user's metadata (sent when a code first creates the account, and written again on every successful sign-in, so an email that already had an account gets it too; the latest sign-in overwrites the earlier record, and the signed-in person can edit their own metadata); for checkout, in the Stripe Checkout Session's metadata. Change a version whenever its page's words change, in `agreement.js`, `site/account.html`, `site/assets/buy.js` and `apps/web/src/shared/agreement.ts` together (tests keep them equal).

## Blockers before these can go live

1. **Who signs.** Pick the seller of record before taking money: an adult operating as the seller, or a company formed with an adult officer. Stripe needs an adult account holder.
2. **Business name and address** for the `[Operator]` placeholders. Use a business address, not a home address, because this repo is public.
3. **Lawyer review** of liability limits, the "yours to keep" license, and California automatic renewal rules (Bus. & Prof. Code 17600 and AB 2863).
4. **Support email** for the `[Contact]` placeholder.

## Rules these drafts follow

- Plain words. Short sentences. No em dashes.
- No "guaranteed", "undo anything", or "free forever".
- Every limit the product has is stated, matching the build brief.
- Cancel online in the same number of steps as sign-up.
