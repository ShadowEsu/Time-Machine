# Waitlist emails: double opt-in and unsubscribe

The email flow is built. Preston still needs to set up Supabase, Resend, DNS and Vercel, then ask BOSS or the coding agent to redeploy. Real provider setup and delivery have not been verified.

## What happens

1. Someone submits the form. The server saves a pending signup and sends a confirmation email through Resend. It returns `200 {"ok":true,"pending":true}`, with no referral code or card.
2. They click the confirmation link. A valid link redirects to `/confirmed.html?code=CODE` and sends a welcome email. An invalid, used or expired link redirects to `/confirmed.html?error=invalid`.
3. Only confirmed, subscribed people count in list positions and totals. Only confirmed, subscribed friends earn referral credit. Referral codes are 10 lowercase letters or digits.
4. Both emails include an unsubscribe link. Opening it with GET only shows a page. Pressing its unsubscribe button sends POST and stops the subscription. A later signup does not silently subscribe that person again.

The only automatic emails are confirmation and welcome. There is no launch campaign or bulk send. The database stores SHA-256 token hashes, not the raw links. Confirmation links are single-use and expire after 7 days. Confirmation resends have a 10-minute cooldown. Unsubscribe links do not expire. Confirmation replaces the first unsubscribe link with a new one in the welcome email. People can unsubscribe at any time using the current link.

## Preston: connect the services

For the complete database steps, use [Supabase setup](SUPABASE_SETUP.md). Apply migrations `0001`, `0002` and `0003` in order before opening the form.

1. Go to https://resend.com and create a free account, or sign in to the account you want to use.
2. Open **Domains**, click **Add domain**, and enter `unvibe.site`. If it is already listed, open it instead.
3. Open the DNS settings where you manage `unvibe.site`. Add the exact DNS records Resend shows, including each type, name and value. Do not copy example values from another domain or remove unrelated records.
4. Back in Resend, click **Verify** and wait until the sending domain is verified.
5. Open **API Keys**, click **Create API Key**, and create a key allowed to send from this domain. Save it in your password manager. Do not paste it into chat, docs or source code.
6. Open https://vercel.com, select **time-machine-site**, then **Settings → Environment Variables**. Add the settings below for **Production** and **Preview**. Mark secret values **Sensitive** if that switch is available.

| Vercel name | Status | Value |
|---|---|---|
| `SUPABASE_URL` | Required | Supabase Project URL, starting with `https://` |
| `SUPABASE_SERVICE_ROLE_KEY` | Required, secret | Supabase service role key |
| `RESEND_API_KEY` | Required, secret | The Resend API key |
| `WAITLIST_FROM` | Optional, default | `Time Machine <timemachine@unvibe.site>` |
| `SITE_URL` | Optional, default | `https://time-machine-site.vercel.app` |

The sender must use a domain verified in your Resend account. `SITE_URL` is the public site address used in email links. Set it explicitly if you use another address.

After saving the variables, tell BOSS or the coding agent: "Supabase, Resend and DNS are configured. Please redeploy time-machine-site." Existing deployments do not pick up new variables.

## What the status means

After redeployment, `/api/health` should show `{"ok":true,"waitlist":true,"email":true}`. This checks configuration presence and the Supabase URL shape only. It does not contact the providers, check migrations or prove email delivery.

- No Resend key: signup returns `503`. Email is not configured.
- Resend send failure: signup returns `502`. The saved row stays pending. The 10-minute cooldown still applies before another confirmation attempt.
- Welcome send failure: the row stays confirmed. The confirmation token is already consumed. There is no automatic welcome retry.
- `GET /api/waitlist?code=CODE` returns `{"ok":true,"position":…,"referrals":…,"total":…}` for a confirmed, subscribed person. Pending or unsubscribed codes return `404`.

Use synthetic data for local checks. Do not send real email or run a live signup test without separate founder approval.
