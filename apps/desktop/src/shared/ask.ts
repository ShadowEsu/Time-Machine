// What Ask about your history sends, for the consent screen. main/ask.ts builds the request from
// the same facts, so this text and that code change together. See ADR 0008.

export const ASK_CONSENT = {
  title: "Ask about your history",
  summary: "Ask a question about this project's save points. Time Machine sends a short summary of the history to Google's Gemini API and shows the answer with the save points it relies on.",
  sent: [
    "Your question",
    "The newest 50 save points: when each was made, its title and note",
    "Which agent made it and the prompt it was given, when Time Machine recorded one",
    "Each check result, the check command and its exit code",
    "The names of the files that changed between save points, and how many",
    "What each save point did not save, such as databases, and the names (not values) of secret settings",
  ],
  neverSent: [
    "The contents of your files",
    "Check output and logs",
    "Anything from your other projects",
  ],
  where: "It goes from this Mac straight to Google's Gemini API, using your own Gemini API key. Time Machine runs no server in between and keeps no copy of the answers.",
  freeTier: "With a free Gemini API key, Google may use what is sent to improve its products, and people at Google may read it. Google says it does not do this for paid keys. Read Google's terms before you turn this on.",
  termsUrl: "https://ai.google.dev/gemini-api/terms",
  accuracy: "Text matching known secret values or credential patterns is filtered, but this cannot recognize every secret. Do not include secrets in your question or save point notes. Answers can be wrong. Check a save point before you rely on it.",
  off: "It stays off until you turn it on for this project. Turn it off any time and nothing more is sent.",
} as const;

/** Sample questions. The preview has canned answers for these. */
export const ASK_EXAMPLES = ["When did it last work?", "What changed after the last working save?", "What did Claude Code do today?"] as const;
