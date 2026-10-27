// What a save point keeps and leaves out, in plain words. A project that is not code hears no code words (writer#24).

/** A line of what is not saved, in plain words. Secret values keep only their names. */
export function plainNotSaved(line: string, code: boolean): string {
  const m = /^Secret values in (.+?): (.+)$/.exec(line);
  if (m) return `The values of ${m[2]} in ${m[1]}. We kept the names.`;
  if (line === "Databases, deployed versions and external services are not captured") {
    return code ? "Database contents, anything already deployed, and changes in other services" : "Files over the size limit, secrets files, and files you cannot read";
  }
  return line;
}

/**
 * A skip reason in the few words a toast has room for: the settings path that follows the size limit is for the
 * save point's detail and Settings, not for a passing notice. "interview.wav: over the 5 MB limit (capture.maxFileMB
 * in /…/timemachine.yml)" becomes "interview.wav: over the 5 MB limit".
 */
export function shortSkip(line: string): string {
  return line.replace(/ \(capture\.maxFileMB in [^)]*\)$/, "");
}
