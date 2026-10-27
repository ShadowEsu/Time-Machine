// Each test file gets its own temp folder as TMPDIR and removes it when the file is done. Everything a test makes
// with tmpdir() lands in it: tempDir(), the engine's own temp folders (a demo project, a check's copy), and the
// temp folders of the tm processes a test starts, since they inherit the environment. A test that forgets to clean
// up, or fails before its own cleanup, leaves nothing behind in the real temp folder.
import { chmodSync, lstatSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

const before = process.env.TMPDIR;
const mine = mkdtempSync(join(tmpdir(), "tm-vitest-"));
process.env.TMPDIR = mine;

/** Makes `dir` and every folder under it usable again (a test may leave one at mode 000), so it can be removed. */
function unlock(dir: string): void {
  try {
    chmodSync(dir, 0o700);
  } catch {
    return;
  }
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const path = join(dir, name);
    try {
      if (lstatSync(path).isDirectory()) unlock(path);
    } catch {
      // Gone already.
    }
  }
}

afterAll(() => {
  if (before === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = before;
  try {
    rmSync(mine, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    unlock(mine);
    rmSync(mine, { recursive: true, force: true, maxRetries: 3 });
  }
});
