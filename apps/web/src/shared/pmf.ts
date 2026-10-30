// The four-question survey (Sean Ellis wording, unchanged). It shows once, as an inline card, after the 5th successful Ask
// or 7 days after the app was first opened, whichever comes first. Answers stay in the window until the person presses
// Send; only then does the app send them, with the app version and a random survey ID (PMF_SENDS). The Ask count and the
// first-use date stay on this computer: they only decide when the card shows. No Zod here, so the window bundle stays small.

export const PMF_ASKS = 5;
export const PMF_DAYS = 7;
export const PMF_TEXT_MAX = 2000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const PMF_Q1 = "How would you feel if you could no longer use Time Machine?";
export const PMF_Q1_OPTIONS = [
  ["very", "Very disappointed"],
  ["somewhat", "Somewhat disappointed"],
  ["not", "Not disappointed"],
  ["na", "N/A, I no longer use it"],
] as const;
export type PmfFeeling = (typeof PMF_Q1_OPTIONS)[number][0];
export const PMF_FEELINGS = PMF_Q1_OPTIONS.map(([value]) => value) as [PmfFeeling, ...PmfFeeling[]];
export const PMF_Q2 = "What type of people do you think would most benefit from Time Machine?";
export const PMF_Q3 = "What is the main benefit you receive from Time Machine?";
export const PMF_Q4 = "How can we improve Time Machine for you?";

/** The consent line next to Send. It names every field pmfPayload sends, and nothing else is sent. */
export const PMF_SENDS =
  "Send shares your answers, the app version and a random survey ID made for this computer (not taken from your hardware, your name or your folders) with the Time Machine team. Nothing is sent until you press Send, and nothing else is sent. Closing this sends nothing. Don’t include passwords, keys or other people’s personal details.";

/** Send is blocked when an answer looks like a key or password (core's secret patterns, the same check as run notes). */
export const PMF_LOOKS_SECRET = "That looks like a key or password. Take it out and try again.";

export interface PmfAnswers {
  q1: PmfFeeling;
  q2: string;
  q3: string;
  q4: string;
}

/** Exactly what Send posts to the site's /api/feedback. */
export interface PmfPayload extends PmfAnswers {
  installId: string;
  appVersion: string;
}

export interface PmfMarks {
  shownAt?: string | undefined;
  closedAt?: string | undefined;
  sentAt?: string | undefined;
  installId?: string | undefined;
}

/** The settings the survey reads. */
export interface PmfSettings {
  firstUseAt: string | null;
  askCount: number;
  pmf: PmfMarks;
}

/** Whole days since the app was first opened. 0 when unknown or in the future. */
export function daysSince(firstUseAt: string | null, now: number): number {
  const at = firstUseAt ? Date.parse(firstUseAt) : Number.NaN;
  if (!Number.isFinite(at) || now <= at) return 0;
  return Math.floor((now - at) / DAY_MS);
}

/** After the 5th successful Ask, or 7 days after first use, whichever comes first. */
export function pmfTriggered(s: PmfSettings, now: number): boolean {
  return s.askCount >= PMF_ASKS || daysSince(s.firstUseAt, now) >= PMF_DAYS;
}

/**
 * Whether the card is drawn now. `session`: the card was already shown in this app session. `blocked`: work is in progress
 * (a running action, a rewind, adding a project, an open sheet), when the card never shows.
 * Once shown, it stays for that session only; it never comes back after No thanks, after Send, or in a later session.
 */
export function pmfCardShown(s: PmfSettings, now: number, view: { session: boolean; blocked: boolean }): boolean {
  if (view.blocked || s.pmf.closedAt || s.pmf.sentAt) return false;
  if (view.session) return true;
  if (s.pmf.shownAt) return false;
  return pmfTriggered(s, now);
}

/** The answers as sent: text trimmed and cut to PMF_TEXT_MAX characters, the survey ID and the app version. No other key. */
export function pmfPayload(a: PmfAnswers, facts: { installId: string; appVersion: string }): PmfPayload {
  const text = (v: string): string => v.trim().slice(0, PMF_TEXT_MAX);
  return { q1: a.q1, q2: text(a.q2), q3: text(a.q3), q4: text(a.q4), installId: facts.installId, appVersion: facts.appVersion.slice(0, 32) };
}
