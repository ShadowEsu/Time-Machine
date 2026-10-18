# Waitlist email: not connected

The site sends no email. This is a founder decision, not unfinished work.

## What happens today

1. Someone submits the waitlist form.
2. The server saves the signup in Supabase as pending and unconfirmed.
3. It answers `200 {"ok":true,"pending":true}`. The answer is the same for new and existing emails, so nobody can probe who is on the list. It holds no referral code, no place in line and no token.
4. The form says: "Saved as pending and unconfirmed. No email has been sent."

Pending signups do not count in anyone's place in line, in the total, or in referral credit. Only rows with `confirmed_at` set and `unsubscribed_at` empty count. No row is confirmed by the site today, and the site has no confirmation or unsubscribe links.

`/api/health` answers `{"ok":true,"waitlist":true,"email":false}` once Supabase is set up. `email:false` is on purpose. It does not close the form. Only `waitlist:false` does.

No email service key is needed or read. `RESEND_API_KEY`, `WAITLIST_FROM` and `SITE_URL` are not used by the site.

## Before any waitlist email is added

Preston already has email agents that handle sending. Nothing on the site connects to them. Before any email is sent to people on the waitlist, Preston or BOSS must:

1. Explain how the existing email agents work: who sends, from which address, and where they read the list from.
2. Approve the exact flow in writing: which emails go out, when, to whom, and with what wording.
3. Decide how a signup becomes confirmed and how people unsubscribe.
4. Approve the matching update to the privacy page before anything is sent.

Until all four are done, nobody writes code that sends, schedules or queues waitlist email.

## History

A Resend double opt-in flow was drafted on 18 October 2026 and removed before it was ever deployed (commits `5c48d8f` and `0defa5a`, removed in `3752993`). It is in git history for reference only. It is not approved.
