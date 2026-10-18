# ADR 0007: The action connector (v2)

Date: 15 October 2026. Status: proposed. Nothing here is built. Work starts only after the gate below.

## Context

Agents now act outside code. Claude custom connectors and ChatGPT developer mode let an assistant send email, post to Slack, edit Notion pages, move calendar events and touch payments. Today the only safety in ChatGPT developer mode is a confirm prompt before a write. Once the action runs, there is no record across apps and no way back.

Time Machine already does this for code: save first, prove which version works, recover without touching your folder. This ADR proposes the same idea for actions, with the same honesty rule. We never say "undo anything". Each app gets only the reversal it can really do, and every result says what was not reversed.

## Decision

Build one **remote MCP server** (Streamable HTTP with OAuth) that people add as a custom connector in Claude and in ChatGPT developer mode.

- It sits in front of the person's apps. Sign in to those apps goes through **Composio** auth, so we do not build and host an OAuth app per service.
- It records every **write action** on one timeline: which assistant, which app, what changed, and when.
- Before each write it does the one thing that makes that write reversible, if anything can.
- Read actions pass through and are not recorded.

| App | Before it runs | The way back | What we say after |
|---|---|---|---|
| Gmail | Hold the email in our outbox for a recall window, then send | Cancel inside the window | After delivery: "Sent. It can't be unsent." |
| Slack | Record the channel and message timestamp | Delete the message | "Deleted. People may have seen it already." |
| Notion | Snapshot the page | Restore the old content | "Restored the page text. Comments and shares were not changed." |
| Google Calendar | Snapshot the event | Revert or recreate it | "Reverted. Guests may have had an update email." |
| Stripe | Above a set amount, hold for the person's approval | A refund | "Refunded. This is a refund, not an undo. Fees may not come back." |

Every timeline entry has a plain status: **Reversible now**, **Reversible until 10:42**, or **Can't be reversed**. An entry is never shown as reversible unless the reversal path has been tested for that app.

## Change to the build brief

The brief's "Never" list says we never unsend emails or payments. This ADR changes one word of that:

- **Emails** move from "Never" to **"hold and recall only"**. We can hold an email before it is sent and cancel it inside the window. After delivery we still never claim to unsend it.
- **Payments** stay in "Never" as an undo. A refund is offered and is always called a refund.

The founder must approve this change before the brief is edited.

## Risks

- **Prompt injection.** A web page or an email the assistant reads can tell it to send, delete or pay. Our server cannot tell a real request from an injected one. Mitigations: hold windows on email, approval above a money threshold, a clear timeline, and no tool that deletes the timeline itself. We still say plainly that injection is possible.
- **Data we hold.** Holding an email means we store its body until it sends. Snapshots of Notion pages and calendar events are copies of private data. Rules: keep the least needed, encrypt at rest, delete held content after the recall window, delete snapshots after a set retention, and never put content in logs. This needs a new Privacy section and a lawyer review.
- **OAuth scopes.** Write scopes on Gmail and Slack are broad and Google may require a security review for restricted Gmail scopes. Ask for the smallest scope per app. Show every scope before connect. One click disconnect that also deletes stored tokens and snapshots.
- **A third party in the path.** Composio holds the tokens. If it is down, writes fail closed: the action does not run without a record.
- **Being wrong about reversal.** An app can change its API. A reversal that silently fails is worse than none. Each reversal is checked after it runs, and a failure is shown as "Couldn't reverse".
- **Scope creep.** This is a second product. It must not slow the code MVP or the Mac app.

## Alternatives

- **A browser extension that watches clicks.** Sees too much, breaks often, and cannot hold a send. Rejected.
- **Build each OAuth app ourselves.** More control and no third party, but weeks of review per provider. Kept as the migration path below.
- **Record only, no reversal.** Simple and honest, but a log alone does not solve the problem. Kept as the fallback for apps with no safe reversal.
- **Do nothing and stay on code.** Valid. This is why the gate exists.

## Cost

- A hosted server, which the MVP does not have: accounts, OAuth, a database for the timeline, and uptime.
- Composio fees per connected account at scale.
- A security review before any public launch, and likely a Google verification for Gmail scopes.
- Founder time taken from the code product.

## Migration path

Start with Gmail hold and recall and Slack delete only. If one provider's terms or price through Composio stop working, move that provider to our own OAuth app. The timeline format is ours and stays the same, so entries survive the move.

## Gate to start

All of these first:

1. The code MVP has shipped: `timetm` is on npm and a stranger can run `npx timetm init` to a verified recovery branch.
2. The founder signs off on this ADR and on the brief change above, in writing in this file.
3. Who signs for money and data is settled (`docs/legal/README.md`), because this product holds other people's private messages.

Until then the connector is labeled **Planned** everywhere it is mentioned.
