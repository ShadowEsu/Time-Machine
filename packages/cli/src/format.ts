// Human output. Every line is built from the same result object the --json flag prints,
// so the two can never disagree.
import type { CheckpointResult, DemoResult, HookInstallResult, DiffResult, FindGoodResult, InitResult, LogResult, OpenResult, RecoverResult, TimelineResult, Verdict, VerifyResult } from "@timetm/core";

export interface Style {
  verdict: (v: Verdict | null, text: string) => string;
}

export function makeStyle(color: boolean): Style {
  const codes: Record<Verdict, string> = { PASS: "32", FAIL: "31", INCOMPLETE: "33", BLOCKED: "33", ERROR: "35" };
  return { verdict: (v, text) => (color && v ? `\x1b[${codes[v]}m${text}\x1b[0m` : text) };
}

const MEANING: Record<Verdict, string> = {
  PASS: "works",
  FAIL: "is broken",
  INCOMPLETE: "could not be fully checked",
  BLOCKED: "needs something before it can be checked",
  ERROR: "check crashed",
};

const pad = (s: string, n: number): string => s.padEnd(n);
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;
const two = (n: number): string => String(n).padStart(2, "0");
/** Local time, minutes precision. */
const when = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
};
const list = (title: string, items: string[]): string[] => (items.length ? [`${title}`, ...items.map((i) => `  ${i}`)] : []);

export function fmtInit(r: InitResult): string {
  return [
    r.created ? `Created ${r.configPath}` : `Kept your existing ${r.configPath}`,
    `  Check     ${r.verifyCommand || "(none yet, add verify.command)"}`,
    ...(r.verifySetup ? [`  Setup     ${r.verifySetup}   (runs first in each fresh copy)`] : []),
    `  Network   ${r.network === "deny" ? `off during checks (${r.sandbox})` : "on during checks"}`,
    "Next: tm checkpoint -m \"first save point\"",
  ].join("\n");
}

export function fmtCheckpoint(r: CheckpointResult): string {
  const c = r.checkpoint;
  if (r.skipped) return `Nothing changed since ${c.id}, so no new checkpoint was saved.`;
  return [
    `Saved ${c.id}${c.note ? `  "${c.note}"` : ""}`,
    ...c.coverage.captured.map((x) => `  ${x}`),
    ...list("Not saved", [...c.coverage.missing, ...c.coverage.manual]),
    "Not checked yet.",
    `Next: tm verify ${c.id}`,
  ].join("\n");
}

export function networkLabel(r: VerifyResult): string {
  return r.network.policy === "deny" ? `network off${r.network.enforcedBy ? ` via ${r.network.enforcedBy}` : ""}` : "network on";
}

export function fmtVerify(r: VerifyResult, s: Style): string {
  const lines = [
    `${s.verdict(r.verdict, pad(r.verdict, 10))} ${r.checkpoint} ${MEANING[r.verdict]} (${r.isolation} mode, ${networkLabel(r)}, ${secs(r.durationMs)})`,
    `           ${r.reason}`,
  ];
  if (r.log) lines.push(`           Log: ${r.log}`);
  if (r.verdict === "FAIL") lines.push("Next: tm find-good");
  return lines.join("\n");
}

export function fmtTimeline(r: TimelineResult, s: Style): string {
  if (!r.checkpoints.length) return "No checkpoints yet.\nNext: tm checkpoint -m \"first save point\"";
  const rows = [...r.checkpoints].reverse().map((c) => {
    const verdict = c.verdict ?? "not checked";
    return `${pad(c.id, 9)} ${s.verdict(c.verdict, pad(verdict, 11))} ${pad(when(c.createdAt), 16)}  ${pad(c.commit.slice(0, 7), 7)}  ${c.note}`;
  });
  return [`History of ${r.project}`, ...rows].join("\n");
}

export function fmtDiff(r: DiffResult): string {
  const set = (label: string, x: { added: string[]; removed: string[]; changed: string[] }): string[] =>
    [...x.added.map((k) => `  + ${label} ${k}`), ...x.removed.map((k) => `  - ${label} ${k}`), ...x.changed.map((k) => `  ~ ${label} ${k}`)];
  const lines = [
    `Changes from ${r.a} to ${r.b}`,
    ...r.code.map((c) => `  ${c.status} ${c.path}`),
    ...set("file", r.files),
    ...set("config", r.config),
    ...r.dependencies.changed.map((d) => `  ~ dependencies ${d}`),
    ...r.environment.changed.map((e) => `  ~ environment ${e}`),
  ];
  if (lines.length === 1) lines.push("  No differences.");
  return lines.join("\n");
}

export function fmtOpen(r: OpenResult): string {
  return [
    `Opened ${r.id} in a separate copy (${r.isolation} mode). Your folder was not touched.`,
    `  ${r.dir}`,
    ...list("Restored", r.restored),
    ...list("Missing", r.missing),
    ...list("Do by hand", r.manual),
  ].join("\n");
}

export function fmtFindGood(r: FindGoodResult, s: Style): string {
  const lines = r.tried.map((t) => `  ${pad(t.id, 9)} ${s.verdict(t.verdict, pad(t.verdict, 10))} ${t.reason}`);
  if (r.found) lines.push(`${s.verdict("PASS", "PASS")}  ${r.found} is the newest version that works.`, `Next: tm recover ${r.found}`);
  else if (r.verdict === "BLOCKED") lines.push(`${s.verdict("BLOCKED", "BLOCKED")}  Checks cannot run yet. Fix the reason above, then try again.`);
  else lines.push(`${s.verdict(r.verdict, r.verdict)}  No checkpoint passed.`);
  return lines.join("\n");
}

export function fmtRecover(r: RecoverResult): string {
  return [
    `Recovery ready for ${r.id}. Nothing was pushed, merged or deployed. Your folder and branch were not touched.`,
    `  Branch          ${r.branch}`,
    `  Recovery copy   ${r.copyDir}`,
    `  Saved first     ${r.savedBefore}, your state before this recovery`,
    `  Last check      ${r.lastVerdict ?? "not checked yet"}`,
    ...list("Restored", r.restored),
    ...list("Not restored", r.notRestored),
    ...list("Manual steps", r.manualSteps),
    `Report: ${r.reportPath}`,
  ].join("\n");
}

export function fmtLog(r: LogResult): string {
  if (!r.entries.length) return "The audit log is empty.";
  return r.entries.map((e) => `${e.at}  ${pad(e.action, 10)} ${pad(e.target ?? "", 9)} ${e.result}`).join("\n");
}

export function fmtDemo(r: DemoResult, s: Style): string {
  return [
    `Built a demo project, Marigold Tips, in ${r.dir}`,
    ...r.checkpoints.map((c) => `  ${pad(c.id, 9)} ${pad(c.note, 28)}${c.note.startsWith("Agent") ? "  <- an agent's lint fix broke it here" : ""}`),
    "",
    "$ tm find-good",
    fmtFindGood(r.findGood, s),
    "",
    `$ tm recover ${r.recover.id}`,
    fmtRecover(r.recover),
    "",
    "Try it yourself:",
    `  cd ${r.dir}`,
    "  tm timeline",
  ].join("\n");
}

export function fmtHookInstall(r: HookInstallResult & { command: string; absolute: boolean }): string {
  return [
    r.added.length ? `Added Claude Code hooks to ${r.settingsPath}: ${r.added.join(", ")}` : `Claude Code hooks were already in ${r.settingsPath}`,
    "  Before each prompt and before risky shell commands, a checkpoint is saved if anything changed.",
    "  When Claude stops, the newest checkpoint is checked. If it passed before and fails now, Claude is told which checkpoint last worked.",
    `The hooks run: ${r.command}`,
    ...(r.absolute ? ["  If you move or delete this folder, run tm hook install again."] : []),
    "Claude Code runs project hooks only after you trust the folder.",
    "For the MCP server too: claude mcp add timemachine -- tm mcp",
  ].join("\n");
}
