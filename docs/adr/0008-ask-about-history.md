# ADR 0008: Ask about your history

Date: 16 October 2026. Status: accepted by the founder. The engine side, the window contract, the preview answers and the tests are built. The window views are built too: the Ask panel (`renderer/ask-panel.ts`) and the per project controls in Settings > Features (`renderer/feature-settings.ts`). They show in the app once the new app design mounts them.

## Decision

A person can ask a plain question about one project's history, such as "When did it last work?", and get a short answer that names the save points it relies on.

- **Off by default, per project.** Each project in `projects.json` has `features.ask`, false until the person turns it on. The `ask` call refuses while it is off and sends nothing. Projects saved before this change load with it off.
- **Google's Gemini API or Anthropic's Claude API, with the person's own key.** One request per question, from the app's process straight to the provider. Time Machine runs no server in between.
  - Gemini: `POST https://generativelanguage.googleapis.com/v1beta/interactions`, model `gemini-3.5-flash-lite`, thinking level low, `store: false`.
  - Claude (added 25 October 2026): `POST https://api.anthropic.com/v1/messages`, `anthropic-version: 2023-06-01`, model `claude-sonnet-4-5` unless the environment sets `TM_ASK_MODEL` to another Claude model. Same system instruction, same history text, same redaction; the reply's JSON object is read from the text, since this endpoint has no JSON mode here.
  - When both keys are set, Gemini is used, so a person who set it up keeps it. `credentials` tells the window which one is in use (`provider: "gemini" | "anthropic" | null`), never the key.
- **Answers only from the history.** The system instruction says to answer only from the history sent, to name save points by time and title, to say "I can't tell from the history" when it can't, and to write short plain sentences with no em dashes. The history is marked as data, not instructions, because agent prompts and notes are inside it.
- **A checked reply.** The request asks for JSON (`response_format` with a JSON Schema). The reply is checked with Zod: `{ answer, cites }`. Cites keep only ids that were in the history sent. The result also says how many save points were sent (`basis`), so the panel can say "Based on N save points". Anything else becomes one plain sentence ("Gemini sent an answer this app could not read, so nothing is shown"), never the raw reply.
- **Escaped in the window.** The panel escapes every character of the answer before it is drawn, and shows cites as time chips built from the save points, never from model text.
- **Every failure is one plain sentence.** Wrong key, rate limit, Google errors, no connection, a 30 second timeout, an unfinished answer.

## What is sent

Built from the engine only (`main/ask.ts`), for the newest 50 save points:

- when each save point was made, its title and note
- the agent's name and the prompt it was given, when the hooks recorded one (core already hides secret looking prompts)
- the verdict, the check command and its exit code
- the paths of files that changed between consecutive save points, and how many (up to 20 paths each)
- the "not saved" lines, which name secret settings but never hold their values
- the question

Every string goes through `secretScreen` from core first: text that looks like a key, or holds a value from the project's `.env` files, is left out. A question that holds one is refused before anything is sent.

**Not read or included automatically:** file contents, check output and logs, other projects. Filtering removes recognized credential patterns and known project secret values. It cannot recognize every possible secret in a note, prompt or question, so the consent screen also warns people not to include secrets. `ASK_CONSENT` in `shared/ask.ts` links Google's terms. With a free Gemini key, Google may use what is sent to improve its products and people may read it. The consent text says so.

## Keys

No key is ever in `projects.json`, `settings.json` or a log, and none reaches the window, which only learns whether each key is set and which provider Ask uses. Where each key is read from, first match wins:

| Key | Environment | Stored |
| --- | --- | --- |
| Gemini | `GEMINI_API_KEY` | `credentials.json` in the app's userData folder, encrypted with Electron `safeStorage` (the macOS Keychain) |
| Anthropic | `ANTHROPIC_API_KEY` | the same file, the same way |
| Vercel (ADR 0009) | `VERCEL_TOKEN` | the same file, the same way |

`tm ui` (the browser app) has no Keychain access, so it stores nothing: it reads the environment of the terminal that starts it, and `setCredential` is refused there. The Mac app's userData `credentials.json` is used only when encryption works; if the Mac can't encrypt, the key is not saved. From a source checkout, the app also reads `apps/desktop/.env`. Those values go only to the key store, never into `process.env`, so checks and hooks never inherit them. `TM_ASK_MODEL` is read from the environment of the app's process and is not a secret.

## Alternatives

- **A local model.** Nothing leaves the Mac, but it means a multi gigabyte download, slow answers on smaller Macs, and a second runtime to ship and update. Worth revisiting if people ask for it.
- **No AI.** Filters and search on the timeline answer "when did it last work" without any model. They do not answer "what changed after it broke" in a sentence. The timeline stays the source of truth either way.
- **Our own server with our key.** Simpler for people, but then Time Machine holds history from every user and pays per question. That needs accounts and billing, which are out of scope.
- **A larger model** (`gemini-3.8-flash`). Better at long histories, but slower, about 2.5 times the input price, and the free tier on the key we tested allows 20 requests a day. The model is one constant, easy to change.

## Cost

Nothing for Time Machine: each person uses their own key. A question sends roughly 5,000 tokens and gets a few hundred back. On a paid key that is about a quarter of a cent per question at today's `gemini-3.5-flash-lite` prices ($0.30 per million input tokens, $2.50 per million output tokens). The free tier costs nothing but has daily limits, and Google may use the content. With an Anthropic key the same question costs more per token on `claude-sonnet-4-5`; check Anthropic's current prices before relying on a number.

## How to turn it off

Turn Ask off for the project from the Ask panel menu or Settings > Features (both call `setFeature` with `change: { feature: "ask", enabled: false }`). Nothing more is sent. Remove the key in Settings > Features (`setCredential` with `value: null`) to delete it from this Mac. A key set in the environment stays until it is removed there. Answers are not stored by the app.

## Migration path

The model, endpoint and size caps are constants in `server/ask.ts`. Another provider adds one more request function beside `callGemini` and `callAnthropic`, and its lines in the consent text (`ASK_CONSENT_ANTHROPIC` in `shared/ask.ts` shows the pattern). The context builder and the opt-in stay.

## Sources

Checked 16 October 2026: [text generation](https://ai.google.dev/gemini-api/docs/text-generation), [Interactions REST reference](https://ai.google.dev/api/interactions-api), [structured output](https://ai.google.dev/gemini-api/docs/structured-output), [pricing](https://ai.google.dev/gemini-api/docs/pricing), and [Gemini API terms](https://ai.google.dev/gemini-api/terms).

The Claude request follows the [Messages API](https://docs.anthropic.com/en/api/messages) as of 25 October 2026. It was built offline: no request reached Anthropic, and the tests use a stand-in fetch.
