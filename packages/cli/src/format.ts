// Human output. Every line is built from the same result object the --json flag prints,
// so the two can never disagree.
import type { CheckpointResult, DemoResult, HookInstallResult, DiffResult, FindGoodResult, InitResult, IntegrityReport, LicenseStatus, LogResult, OpenResult, RecoverResult, RestoreResult, StatusResult, StoreProject, ThinPreview, TimelineResult, UndoRecoverResult, Verdict, VerifyResult } from "@timetm/core";

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
/** The local time zone's short name at that moment, like PDT or GMT+9. */
const zone = (d: Date): string => new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(d).find((x) => x.type === "timeZoneName")?.value ?? "";
const list = (title: string, items: string[]): string[] => (items.length ? [`${title}`, ...items.map((i) => `  ${i}`)] : []);
const bytes = (n: number): string => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(1)} GB`);

const NO_CHECK = "No test command found, so save points can't be checked yet. Set verify.command in timemachine.yml, then run tm init again to approve it.";

export function fmtInit(r: InitResult): string {
  const noCheck = !r.verifyCommand.trim();
  if (r.kind === "folder") {
    return [
      `Protected this folder. Its settings are in the store, never in the folder: ${r.configPath}`,
      noCheck
        ? `  Check     none. A check is optional for a plain folder. To add one, set verify.command in ${r.configPath}, then run tm init again to approve it.`
        : `  Check     ${r.verifyCommand}${r.approvedCheck === null ? "   (not approved on this computer; run tm init to approve it)" : "   (approved on this computer)"}`,
      "Next: tm checkpoint -m \"first save point\"",
    ].join("\n");
  }
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
  const settings = `  Settings  ${r.configPath}`;
  if (r.kind === "folder") {
    if (r.check === null) return ["Set up as a plain folder. No check is set up; a check is optional for a folder.", settings].join("\n");
    return [r.approved ? "Set up as a plain folder. The check is approved on this computer." : "Set up as a plain folder, but the check is not approved on this computer. Run tm init to approve it.", `  Check     ${r.check}`, settings].join("\n");
  }
  if (!r.initialized) return `Not set up: this project has no timemachine.yml. Run tm init.\n${settings}`;
  if (r.check === null) return ["Set up, but there is no check yet. Set verify.command in timemachine.yml, then run tm init to approve it.", settings].join("\n");
  if (!r.approved) return ["Set up, but the check is not approved on this computer.", `  Check     ${r.check}`, settings, "When the check is right, run tm init to approve it."].join("\n");
  return ["Set up. The check is approved on this computer.", `  Check     ${r.check}`, settings].join("\n");
}

export function fmtLicense(r: LicenseStatus): string {
  if (r.active) return `Licensed, purchase ${r.id}, issued ${r.issued}.`;
  if (r.problem !== null) return `License problem: ${r.problem}`;
  return `No license on this computer. The web app lists up to ${r.freeProjectLimit} projects at a time without one. A license, $50 once at https://time-machine-site.vercel.app/#pricing, lifts that limit: run tm license <key>. The tm command line tool stays free and open source.`;
}

/** A .env key's value is kept only when listed as plain; every other key keeps only its name. */
const plainWords = (line: string): string => line.replace(/^Secret values in (.+?): (.+)$/, "Values in $1 not saved: $2");

export function fmtCheckpoint(r: CheckpointResult): string {
  const c = r.checkpoint;
  if (r.skipped) return `Nothing changed since ${c.id}, so no new checkpoint was saved.`;
  return [
    `Saved ${c.id}${c.note ? `  "${c.note}"` : ""}`,
    ...c.coverage.captured.map((x) => `  ${x}`),
    ...list("Not saved", [...c.coverage.missing, ...c.coverage.manual].map(plainWords)),
    ...(r.kind === "folder" ? ["Next: tm timeline"] : ["Not checked yet.", `Next: tm verify ${c.id}`]),
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
  if (r.isolation === "confined") lines.push("           Writes outside the copy and the system temp folders were blocked.");
  if (r.log) lines.push(`           Log: ${r.log}`);
  if (r.verdict === "FAIL") lines.push("Next: tm find-good");
  return lines.join("\n");
}

export function fmtTimeline(r: TimelineResult, s: Style): string {
  const gone = r.missing ? [`${r.project} is not there any more. Its save points are safe in the store: tm open <id> --dir <folder> or tm recover <id> --to <folder> brings one back; tm relink ${r.project} <new path> if it moved.`] : [];
  if (!r.checkpoints.length) return [...gone, "No checkpoints yet.", ...(r.missing ? [] : ["Next: tm checkpoint -m \"first save point\""])].join("\n");
  const at = r.checkpoints.find((c) => c.createdAt)?.createdAt;
  const rows = [...r.checkpoints].reverse().flatMap((c) => {
    const verdict = c.damaged ? "DAMAGED" : (c.verdict ?? "not checked");
    // A plain folder has no commits to show.
    const commit = r.kind === "folder" ? "" : `${pad(c.commit.slice(0, 7), 7)}  `;
    const row = `${pad(c.id, 9)} ${s.verdict(c.damaged ? "ERROR" : c.verdict, pad(verdict, 11))} ${pad(when(c.createdAt), 16)}  ${commit}${c.damaged && !c.createdAt ? "" : c.note}`;
    return c.damaged ? [row, `          ${c.damaged}`] : [row];
  });
  return [`History of ${r.project}${at ? ` (times in ${zone(new Date(at))})` : ""}`, ...gone, ...rows].join("\n");
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
    ...(r.missing.length ? ["INCOMPLETE: something saved is missing from this copy. Run tm doctor to see what else is damaged."] : []),
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
    r.copyOnly
      ? `Recovery copy ready for ${r.id}. Nothing was pushed, merged or deployed. Your folder was not touched.`
      : `Recovery ready for ${r.id}. Nothing was pushed, merged or deployed. Your folder and branch were not touched.`,
    `  Branch          ${r.copyOnly ? "none, a plain folder has no Git repository" : r.branch}`,
    `  Recovery copy   ${r.copyDir}`,
    `  Saved first     ${r.savedBefore === null ? "nothing, the folder was not there" : `${r.savedBefore}, your state before this recovery`}`,
    `  Last check      ${r.lastVerdict ?? "not checked yet"}`,
    ...list("Restored", r.restored),
    ...list("Not restored", r.notRestored),
    ...list("Manual steps", r.manualSteps),
    `Report: ${r.reportPath}`,
    ...(r.missing.length ? ["INCOMPLETE: something saved is missing from this copy. Run tm doctor to see what else is damaged."] : []),
  ].join("\n");
}

export function fmtRestore(r: RestoreResult): string {
  const n = r.restored.length;
  const files = `${n} file${n === 1 ? "" : "s"}`;
  const head = r.dryRun
    ? `Dry run: ${n ? `would put back ${files} from ${r.id}` : `nothing to put back from ${r.id}`}. Nothing was written.`
    : n ? `Put back ${files} from ${r.id} into your folder.` : `Nothing was put back from ${r.id}.`;
  return [
    head,
    `  Changed ${r.diff.changed}, added ${r.diff.added}, already the same ${r.diff.same}`,
    `  Saved first     ${r.savedBefore ? `${r.savedBefore}, your folder before this restore` : r.dryRun ? "nothing, this was a dry run" : "nothing, nothing needed writing"}`,
    ...list(r.dryRun ? "Would restore" : "Restored", r.restored),
    ...list(`Kept (not in ${r.id}, left as they are)`, r.kept),
    ...list("Skipped", r.skipped),
    ...(r.note ? [r.note] : []),
  ].join("\n");
}

export function fmtUndoRecover(r: UndoRecoverResult): string {
  return [
    `Undid the recovery of ${r.id}.`,
    ...(r.removedBranch ? [`  Removed branch  ${r.removedBranch}`] : []),
    r.removedCopy ? `  Removed copy    ${r.removedCopy}` : "  The recovery copy was already gone.",
    "Your folder, your branch and every save point were not touched.",
  ].join("\n");
}

export function fmtRelink(r: { root: string; kind: string; store: string }): string {
  return [`Time Machine now protects ${r.root}. Its save points, settings and notes came along.`, `Next: tm timeline -C ${r.root}`].join("\n");
}

export function fmtList(projects: StoreProject[]): string {
  if (!projects.length) return "No projects in the store yet. Run tm init in a folder to protect it.";
  return projects.map((p) => [
    `${p.root}${p.missing ? "   (the folder is gone; its history is safe)" : ""}`,
    `  ${p.kind === "folder" ? "Plain folder" : "Git project"}, ${p.savePoints} save point${p.savePoints === 1 ? "" : "s"}, ${bytes(p.sizeBytes)}${p.lastSaved ? `, last saved ${when(p.lastSaved)}` : ""}`,
  ].join("\n")).join("\n");
}

export function fmtThin(r: ThinPreview, removed: number | null): string {
  if (!r.remove.length) {
    return [
      "Nothing to thin. Only auto saves older than a day can go, and one per hour (last 7 days) or per day stays.",
      "Working, pinned, named, recovery-linked and the newest 20 save points always stay.",
      ...(r.unreadable.length ? [`Can't be read: ${r.unreadable.join(", ")}. Run tm doctor.`] : []),
    ].join("\n");
  }
  const rows = r.remove.map((x) => `  ${pad(x.id, 9)} ${pad(when(x.at), 16)}  ${x.reason}`);
  if (removed !== null) return [`Removed ${removed} old auto save${removed === 1 ? "" : "s"}, about ${bytes(r.bytesFreed)} freed. ${r.keep} save points stay.`, ...rows].join("\n");
  return [
    `${r.remove.length} old auto save${r.remove.length === 1 ? "" : "s"} can go, about ${bytes(r.bytesFreed)}. ${r.keep} save points stay.`,
    ...rows,
    ...(r.unreadable.length ? [`Nothing can be removed while these can't be read: ${r.unreadable.join(", ")}. Run tm doctor.`] : ["Run tm thin --apply to remove them."]),
  ].join("\n");
}

export function fmtDoctor(reports: IntegrityReport[]): string {
  if (!reports.length) return "No projects in the store yet.";
  const lines = reports.flatMap((r) => {
    const bad = r.damaged.length + r.missingBlobs.length;
    return [
      `${bad ? "DAMAGED" : "OK     "}  ${r.root}${r.missing ? "   (the folder is gone)" : ""}  (${r.checked} save point${r.checked === 1 ? "" : "s"} checked)`,
      ...r.damaged.map((d) => `  ${pad(d.id, 9)} ${d.reason}`),
      ...r.missingBlobs.map((b) => `  ${pad(b.id, 9)} ${b.reason}`),
      ...r.notes.map((n) => `  ${n}`),
    ];
  });
  const damaged = reports.filter((r) => r.damaged.length || r.missingBlobs.length).length;
  lines.push(damaged ? `${damaged} of ${reports.length} project${reports.length === 1 ? "" : "s"} have damage. Damaged save points can't be fully brought back; the others are fine.` : "Every save point is whole.");
  return lines.join("\n");
}

export function fmtLog(r: LogResult): string {
  if (!r.entries.length) return "The audit log is empty.";
  return r.entries.map((e) => {
    const d = new Date(e.at);
    const at = Number.isNaN(d.getTime()) ? e.at : `${when(e.at)}:${two(d.getSeconds())} ${zone(d)}`;
    return `${at}  ${pad(e.action, 10)} ${pad(e.target ?? "", 9)} ${e.result}`;
  }).join("\n");
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
    "  Each save point keeps the first 120 characters of your prompt, on this computer. Time Machine uploads it nowhere; Ask in tm ui, if you turn it on, sends it and says so first.",
    "  When Claude stops, the newest checkpoint is checked. If it passed before and fails now, Claude is told which checkpoint last worked.",
    `The hooks run: ${r.command}`,
    ...(r.absolute ? ["  If you move or delete this folder, run tm hook install again."] : []),
    "Claude Code runs project hooks only after you trust the folder.",
    "For the MCP server too: claude mcp add timemachine -- tm mcp",
  ].join("\n");
}
