// Fixed meanings. Never change without an ADR (see docs/adr/0005-exit-codes.md).
export const VERDICTS = ["PASS", "FAIL", "INCOMPLETE", "BLOCKED", "ERROR"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const EXIT_CODES: Record<Verdict, number> = {
  PASS: 0,
  FAIL: 1,
  INCOMPLETE: 2,
  BLOCKED: 3,
  ERROR: 4,
};

export const EXIT_USAGE = 64;

/** Plain words used by the app. The CLI shows the engine words. */
export const APP_WORDS: Record<Verdict | "UNVERIFIED", string> = {
  PASS: "Works",
  FAIL: "Broken",
  INCOMPLETE: "Couldn’t check",
  BLOCKED: "Needs something",
  ERROR: "Check crashed",
  UNVERIFIED: "Not checked yet",
};
