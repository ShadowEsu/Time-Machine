// Work to undo if the process is interrupted (Ctrl-C) in the middle of a check.
const tasks = new Set<() => void>();

export function onInterrupt(fn: () => void): () => void {
  tasks.add(fn);
  return () => tasks.delete(fn);
}

/** Runs every registered cleanup once. The CLI calls this on SIGINT and SIGTERM. */
export function runInterruptCleanups(): void {
  for (const fn of [...tasks]) {
    tasks.delete(fn);
    try {
      fn();
    } catch {
      // Keep cleaning the rest.
    }
  }
}
