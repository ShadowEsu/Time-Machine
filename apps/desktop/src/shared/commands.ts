// The `tm` command that does the same thing as an app action. Shown in the Inspector
// with a Copy button, so every button has a ramp to the CLI.
import type { Call } from "./api.js";

export function shellQuote(s: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Null when the action has no CLI equivalent (it is app only). */
export function tmCommand(call: Call, projectPath: string | null): string | null {
  const inProject = (cmd: string): string => (projectPath ? `cd ${shellQuote(projectPath)} && ${cmd} --json` : `${cmd} --json`);
  switch (call.method) {
    case "init":
      return inProject("tm init");
    case "setCheck":
      return projectPath ? `# Set verify.command to ${shellQuote(call.command)} in ${shellQuote(`${projectPath}/timemachine.yml`)}` : null;
    case "checkpoint":
      return inProject(`tm checkpoint${call.note ? ` -m ${shellQuote(call.note)}` : ""} --trigger app${call.ifChanged ? " --if-changed" : ""}`);
    case "timeline":
      return inProject("tm timeline");
    case "diff":
      return inProject(`tm diff ${call.a} ${call.b}`);
    case "open":
      return inProject(`tm open ${call.id}`);
    case "verify":
      return inProject(`tm verify ${call.id}`);
    case "findGood":
      return inProject("tm find-good");
    case "recover":
      return inProject(`tm recover ${call.id}`);
    case "log":
      return inProject("tm log");
    case "hookInstall":
    case "hookPreview":
      return inProject("tm hook install");
    case "demo":
      return "tm demo --json";
    default:
      return null;
  }
}
