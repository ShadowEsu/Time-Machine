# Time Machine Privacy Policy

**DRAFT. Not in effect. Needs lawyer review.** Last updated: [date].

Short version: your code stays on your computer. Features you turn on may send a summary of your history to Google, or read your deploys from Vercel, as described below. We collect as little as we can and we never sell it. Save points never store secret values. Keys for features you connect are read from your own environment and never stored by the web app.

## 1. What stays on your computer

The `tm` tool and the web app keep everything locally: save points, Git bundles, file copies, check logs, the audit log, and the names of settings you choose. We cannot see any of it. For settings, Time Machine stores only key names and a keyed fingerprint, never the values.

## 2. What we collect

| What | When | Why |
|---|---|---|
| Email address | You join the waitlist or create an account | To reach you about your account, and product news if you opt in |
| Billing details | You buy the web app license | Stripe processes payment. We never see your full card number or your email from checkout |
| License key contents | You buy the web app license | An opaque purchase id, the plan and the issue date, signed by us. Nothing about you |
| Website visits | You visit the site | Cookieless, aggregate page counts. No ad tracking |
| Usage events | Only if you turn on telemetry | To improve the product |
| Support messages | You contact us | To help you |

**Telemetry is off by default.** If you turn it on, it sends event names, durations, verdict codes, app version and OS version. It never sends code, file names, paths, commit messages, branch names, setting names or values, or anything from your check output. You can turn it off at any time.

## 3. What we never do

- Upload your code or project files.
- Store secret values in save points. Keys you add for connected features are the exception: they are stored encrypted on your Mac.
- Sell or share your personal information for advertising.
- Use your data to train AI models.

## 4. Who we share with

Only service providers that help us run Time Machine, under contract: payment (Stripe), email delivery, and website hosting. We may share information if the law requires it.

**Features you turn on that talk to other services.** These are off until you turn them on, and they talk to the other service directly from your Mac with your own key. We do not receive this data.

- **Ask about your history** (per project): sends your question and a summary of that project's history to Google's Gemini API. The summary has save point times, titles and notes, agent prompts, check results, check commands and exit codes, and the names of changed files. It never has file contents, check output or secret values. With a free Gemini key, Google may use this to improve its products and people at Google may read it ([Gemini API terms](https://ai.google.dev/gemini-api/terms)). Your key is stored encrypted on your Mac.
- **Vercel deploys** (per project): reads your teams, projects and recent deploy metadata directly from Vercel. Only the token and Vercel project identifiers are sent to Vercel. Your local save points, source files and file contents are not sent. Matching happens on your Mac by commit hash. The token is stored encrypted on your Mac, or read from `VERCEL_TOKEN` in the environment. No deploy is changed, promoted or rolled back.

## 5. How long we keep it

Account data: while your account is open, then deleted within 90 days. Billing records: as long as tax law requires. Telemetry: 13 months at most. Waitlist emails: until you unsubscribe or we launch and you do not sign up within 6 months.

## 6. Your rights

You can ask to see, correct, export or delete your data. Email [Contact]. We answer within 30 days. If you live in California, the EU, the UK or another place with privacy laws, you have the rights those laws give you, and we will not treat you differently for using them.

## 7. Children

Time Machine is not for children under 13. We do not knowingly collect data from them. If you think we have, contact us and we will delete it.

## 8. Security

We use encryption in transit, least privilege access, and keep the data we hold small on purpose. No system is perfectly secure. If a breach affects you, we will tell you as the law requires.

## 9. Where data is processed

Our providers may process data in the United States and other countries, with legal safeguards for international transfers.

## 10. Changes

We will email you and post a notice at least 30 days before any material change.

## 11. Contact

[Operator], [Contact]
