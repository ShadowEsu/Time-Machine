// Human output. Every line is built from the same result object the --json flag prints,
// so the two can never disagree.
import type { CheckpointResult, DemoResult, HookInstallResult, DiffResult, FindGoodResult, InitResult, LicenseStatus, LogResult, OpenResult, RecoverResult, StatusResult, TimelineResult, Verdict, VerifyResult } from "@timetm/core";

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

const NO_CHECK = "No test command found, so save points can't be checked yet. Set verify.command in timemachine.yml, then run tm init again to approve it.";

export function fmtInit(r: InitResult): string {
  const noCheck = !r.verifyCommand.trim();
  return [
    r.created ? `Created ${r.configPath}` : `Kept your existing ${r.configPath}`,
    `  Check     ${noCheck ? "(none)" : r.verifyCommand}`,
    ...(r.verifySetup ? [`  Setup     ${r.verifySetup}   (runs first in each fresh copy)`] : []),
    `  Network   ${r.network === "deny" ? `off during checks (${r.sandbox})` : "on during checks"}`,
    ...(noCheck
      ? [NO_CHECK]
      : [
          r.approvedCheck === null
            ? "  Approval  not recorded. When the check above is right, run tm init to let plugin hooks and MCP tools run it on this computer."
            : `  Approved  ${r.approvedCheck}   (plugin hooks and MCP tools may run it on this computer)`,
          "Next: tm checkpoint -m \"first save point\"",
        ]),
  ].join("\n");
}

export function fmtStatus(r: StatusResult): string {
  if (!r.initialized) return "Not set up: this project has no timemachine.yml. Run tm init.";
  if (r.check === null) return "Set up, but there is no check yet. Set verify.command in timemachine.yml, then run tm init to approve it.";
  if (!r.approved) return ["Set up, but the check is not approved on this computer.", `  Check     ${r.check}`, "When the check is right, run tm init to approve it."].join("\n");
  return ["Set up. The check is approved on this computer.", `  Check     ${r.check}`].join("\n");
}

export function fmtLicense(r: LicenseStatus): string {
  if (r.active) return `Licensed, purchase ${r.id}, issued ${r.issued}.`;
  if (r.problem !== null) return `License problem: ${r.problem}`;
  return "No license on this computer. The web app needs one. Buy once for $50 at https://time-machine-site.vercel.app/#pricing, then run tm license <key>. The tm command line tool stays free and open source.";
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
    "",
    "Now protect your own project:",
    "  cd <your project>",
    "  tm init",
    "Then add the Claude Code plugin, so it saves before each prompt and risky command:",
    "  /plugin marketplace add ShadowEsu/Time-Machine",
    "  /plugin install time-machine@time-machine",
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
