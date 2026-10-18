# Waitlist emails: double opt-in and unsubscribe (options for Preston, not built)

Today the waitlist sends no email at all. Signing up stores the row; nothing confirms it and nothing goes out. Before the first email to the list, two things should exist:

1. **Confirm (double opt-in):** after signup, one email with a confirm link. Only confirmed rows get later emails. This keeps typos and fake signups off the list, and it makes referral credit harder to game with made-up addresses.
2. **Unsubscribe:** a one-click link in every email that works for at least 30 days, honored within 10 business days (FTC CAN-SPAM guide: https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business). Each email also needs a real postal address under CAN-SPAM.

## Options to send the emails

| Option | What it needs from you | Trade-off |
|---|---|---|
| **Resend on `unvibe.site`** (Unvibe already sends through Resend on that domain) | OK to send Time Machine mail from an `unvibe.site` address, and the Resend API key added to Vercel `time-machine-site` | Fastest. Mail comes from the Unvibe domain, which may confuse people who signed up for Time Machine |
| **Resend on a Time Machine domain** | Buy a domain (free ones found earlier: timetm.dev, gettimemachine.dev, rewindtm.dev, usetimetm.com), verify it in Resend (3 DNS records), add the key to Vercel | Clean brand and better deliverability. Needs the domain first |
| **Do nothing until launch** | Nothing | Fine while no email is sent. Must be built before the first "it is on npm" email |

## What the agent builds once you pick

A `confirmed_at` column and a random confirm token in Supabase, a `/api/confirm` link, an unsubscribe token and `/api/unsubscribe`, one plain confirm email, and a change so only confirmed signups count for referral credit. Tests first, synthetic data only. No email is sent until you approve the exact text.
