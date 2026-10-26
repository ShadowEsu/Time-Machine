// A check's own words in the save point detail: the command, its exit code, the network and the engine's reason. Pure, so
// the window and the tests agree. The record comes from a check run in this session or from the store (checkRecord),
// which core already cleaned of secrets; every field still goes through esc() here. Shown and copied only: never sent to
// Ask, a report or an export.
import type { TimelineEntry } from "@timetm/core";
import type { Res, VerdictRecord } from "../shared/api.js";
import { esc } from "../shared/format.js";

/** The engine's reason is clipped to this many code points on screen, like a log line. */
export const REASON_CHARS = 300;

/**
 * The stored record the detail may show for save point `c`, or null. Only a record of this exact save point whose verdict
 * is the one the timeline shows: anything else would describe a different check.
 */
export function acceptRecord(r: Res<VerdictRecord | null>, c: Pick<TimelineEntry, "id" | "verdict">): VerdictRecord | null {
  return r.ok && r.data && r.data.checkpoint === c.id && r.data.verdict === c.verdict ? r.data : null;
}

/** The command, how it exited with the network setting, and the reason clipped, each line as text. `ran` hides what a check that never started lacks. */
export function checkBodyHtml(vr: VerdictRecord, ran: boolean, withReason: boolean): string {
  const exit = vr.exitCode === null ? "no exit code" : `exit code ${vr.exitCode}`;
  const net = vr.network.policy === "deny" ? "network off" : "network on";
  const chars = Array.from(vr.reason);
  const reason = chars.length > REASON_CHARS ? `${chars.slice(0, REASON_CHARS - 3).join("")}...` : vr.reason;
  return `<div class="cw-b sel-text">${vr.command.trim() ? `<div><span class="cw-p" aria-hidden="true">$ </span>${esc(vr.command)}</div>` : ""}${ran ? `<div>${esc(`${exit} · ${net}`)}</div>` : ""}${withReason ? `<div class="cw-r">${esc(reason)}</div>` : ""}</div>`;
}
