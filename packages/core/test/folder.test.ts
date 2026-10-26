// Plain folders: a folder outside any Git repository can be protected. Its history lives in a
// shadow Git dir in the store, and nothing is ever created or changed inside the folder.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import * as tm from "@timetm/core";
import { tempDir } from "../../../fixtures/demo/setup.ts";

const SECRET = "sk-live-4f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c";

/** Every entry in a folder, dotfiles included, with its kind, bytes hash, mode and modification time. */
function listing(dir: string, rel = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(join(dir, rel)).sort()) {
    const path = rel ? `${rel}/${name}` : name;
    const st = lstatSync(join(dir, path));
    if (st.isDirectory()) {
      out[`${path}/`] = `dir ${st.mode} ${st.mtimeMs}`;
      Object.assign(out, listing(dir, path));
    } else {
      out[path] = `${createHash("sha256").update(readFileSync(join(dir, path))).digest("hex")} ${st.mode} ${st.mtimeMs}`;
    }
  }
  return out;
}

/** A plain folder of notes with its own store, outside any Git repository. */
function notesFolder(): { dir: string; ctx: tm.Ctx; store: string } {
  const root = tempDir("folder");
  const dir = join(root, "thesis-notes");
  const store = join(root, "store");
  mkdirSync(join(dir, "chapters"), { recursive: true });
  writeFileSync(join(dir, "chapters", "01-intro.md"), "# Introduction\n\nFirst draft.\n");
  writeFileSync(join(dir, "references.bib"), "@book{knuth1984, title={Literate Programming}}\n");
  writeFileSync(join(dir, ".env"), `OPENAI_API_KEY=${SECRET}\n`);
  return { dir, ctx: { cwd: dir, tmHome: store, env: { ...process.env, TM_HOME: store } }, store };
}

/** Every saved file in the store, unpacked, so a test can look for a value in all of them. */
function storeText(store: string): string {
  const parts: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".gz")) parts.push(gunzipSync(readFileSync(full)).toString("latin1"));
      else parts.push(readFileSync(full).toString("latin1"));
    }
  };
  walk(store);
  return parts.join("\n");
}

describe("plain folder projects", () => {
  test("a plain folder is added and saved, and the folder gets no .git and no changed file or time", async () => {
    const { dir, ctx } = notesFolder();
    const before = listing(dir);

    const added = tm.protect(ctx);
    expect(added).toMatchObject({ root: expect.stringMatching(/thesis-notes$/), kind: "folder" });
    const { checkpoint } = await tm.checkpoint(ctx, { note: "First draft" });
    expect(checkpoint.id).toBe("cp-0001");
    expect(checkpoint.files).toBe(2);
    expect(checkpoint.coverage.captured.join("\n")).not.toMatch(/Code: commit/);
    expect(checkpoint.coverage.restorable).not.toContain("Code");

    const t = await tm.timeline(ctx);
    expect(t.checkpoints.map((c) => c.id)).toEqual(["cp-0001"]);
    expect(t.project).toBe(added.root);
    expect(existsSync(join(dir, ".git"))).toBe(false);
    expect(listing(dir)).toEqual(before);
  });

  test("change a file, save, recover: the copy has the old words and the folder is untouched", async () => {
    const { dir, ctx } = notesFolder();
    tm.protect(ctx);
    await tm.checkpoint(ctx, { note: "First draft" });
    writeFileSync(join(dir, "chapters", "01-intro.md"), "# Introduction\n\nRewritten.\n");
    await tm.checkpoint(ctx, { note: "Rewrite" });

    const d = await tm.diff(ctx, "cp-0001", "cp-0002");
    expect(d.files.changed).toEqual(["chapters/01-intro.md"]);
    expect(d.code).toEqual([]);

    const before = listing(dir);
    const r = await tm.recover(ctx, "cp-0001");
    expect(r.copyOnly).toBe(true);
    expect(r.branch).toBe("");
    expect(r.manualSteps.join("\n")).toMatch(/No branch was made/);
    expect(readFileSync(join(r.copyDir, "chapters", "01-intro.md"), "utf8")).toContain("First draft.");
    expect(readFileSync(join(r.copyDir, "references.bib"), "utf8")).toContain("knuth1984");
    expect(r.copyDir.startsWith(`${dir}/`)).toBe(false);
    expect(listing(dir)).toEqual(before);
    expect(readFileSync(join(dir, "chapters", "01-intro.md"), "utf8")).toContain("Rewritten.");
    expect(existsSync(join(dir, ".git"))).toBe(false);

    // Undo removes only the copy: there is no branch.
    const u = await tm.undoRecover(ctx, { id: r.id, branch: "", copyDir: r.copyDir });
    expect(u).toEqual({ id: "cp-0001", removedBranch: "", removedCopy: r.copyDir });
    expect(existsSync(r.copyDir)).toBe(false);
    expect(listing(dir)).toEqual(before);
  });

  test("the recovery copy is plain files only: no .git, exactly the old save point, and undo refuses a changed or unknown copy", async () => {
    const { dir, ctx } = notesFolder();
    tm.protect(ctx);
    await tm.checkpoint(ctx, { note: "First draft" });
    writeFileSync(join(dir, "chapters", "01-intro.md"), "# Introduction\n\nRewritten.\n");
    writeFileSync(join(dir, "later.md"), "Added later.\n");
    await tm.checkpoint(ctx, { note: "Rewrite" });

    const r = await tm.recover(ctx, "cp-0001");
    expect(existsSync(join(r.copyDir, ".git"))).toBe(false);
    expect(Object.keys(listing(r.copyDir))).toEqual(["chapters/", "chapters/01-intro.md", "references.bib"]);
    expect(readFileSync(join(r.copyDir, "chapters", "01-intro.md"), "utf8")).toBe("# Introduction\n\nFirst draft.\n");

    // A copy with new work in it is left alone.
    writeFileSync(join(r.copyDir, "mine.md"), "My new work.\n");
    await expect(tm.undoRecover(ctx, { id: r.id, branch: "", copyDir: r.copyDir })).rejects.toThrow(/has changes \(mine\.md\)/);
    expect(existsSync(join(r.copyDir, "mine.md"))).toBe(true);

    // A folder with the right name that this recovery did not make is left alone too.
    const fake = `${r.copyDir}-2`;
    mkdirSync(fake);
    await expect(tm.undoRecover(ctx, { id: r.id, branch: "", copyDir: fake })).rejects.toThrow(/not the recovery copy/);
    expect(existsSync(fake)).toBe(true);
  });

  test("a .env file in the folder is not saved, and its value is nowhere in the store", async () => {
    const { dir, ctx, store } = notesFolder();
    tm.protect(ctx);
    const { checkpoint } = await tm.checkpoint(ctx);
    expect(checkpoint.coverage.manual.join("\n")).toMatch(/Secret values in \.env: OPENAI_API_KEY/);
    const o = await tm.open(ctx, "cp-0001");
    expect(existsSync(join(o.dir, ".env"))).toBe(false);
    expect(existsSync(join(o.dir, "references.bib"))).toBe(true);
    // The safe copy is plain files too, with no .git linking it to the store.
    expect(existsSync(join(o.dir, ".git"))).toBe(false);
    expect(Object.keys(listing(o.dir))).toEqual(["chapters/", "chapters/01-intro.md", "references.bib"]);
    expect(o.restored).toEqual(["2 saved files"]);
    expect(storeText(store)).not.toContain(SECRET);
    expect(existsSync(join(dir, ".env"))).toBe(true);
  });

  test("the 5 MB size cap and content secret screening still apply", async () => {
    const { dir, ctx } = notesFolder();
    writeFileSync(join(dir, "scan.tif"), Buffer.alloc(6 * 1024 * 1024, 1));
    writeFileSync(join(dir, "keys.txt"), `token: ${SECRET}\n`);
    tm.protect(ctx);
    const { checkpoint } = await tm.checkpoint(ctx);
    expect(checkpoint.coverage.missing.join("\n")).toMatch(/scan\.tif is over the 5 MB limit/);
    expect(checkpoint.coverage.manual.join("\n")).toMatch(/keys\.txt looks like it contains a secret/);
    expect(checkpoint.files).toBe(2);
  });

  test("the check is optional, lives in the store, and runs in a separate copy", async () => {
    const { dir, ctx, store } = notesFolder();
    const before = listing(dir);
    const init = await tm.init(ctx);
    expect(init.configPath.startsWith(store)).toBe(true);
    expect(init.verifyCommand).toBe("");
    await tm.checkpoint(ctx);
    const blocked = await tm.verify(ctx, "cp-0001");
    expect(blocked.verdict).toBe("BLOCKED");
    expect(blocked.reason).toMatch(/optional/);

    const set = await tm.setCheck(ctx, "test -f references.bib && test -f chapters/01-intro.md");
    expect(set.configPath.startsWith(store)).toBe(true);
    expect((await tm.verify(ctx, "cp-0001")).verdict).toBe("PASS");
    expect((await tm.findGood(ctx)).found).toBe("cp-0001");
    expect(tm.status(ctx).check).toBe("test -f references.bib && test -f chapters/01-intro.md");
    expect(listing(dir)).toEqual(before);
  });

  test("a folder that was never added is refused without creating anything, and a subfolder finds its project", async () => {
    const { dir, ctx } = notesFolder();
    const before = listing(dir);
    await expect(tm.checkpoint(ctx)).rejects.toThrow(/not inside a Git repository/);
    expect(listing(dir)).toEqual(before);

    const added = tm.protect(ctx);
    await tm.checkpoint(ctx);
    const sub = await tm.timeline({ ...ctx, cwd: join(dir, "chapters") });
    expect(sub.project).toBe(added.root);
    expect(sub.checkpoints).toHaveLength(1);
  });

  test("Claude Code hooks are never written into a plain folder", async () => {
    const { dir, ctx } = notesFolder();
    tm.protect(ctx);
    const before = listing(dir);
    await expect(tm.hookInstall(ctx, { command: "tm" })).rejects.toThrow(/plain folder/);
    expect(listing(dir)).toEqual(before);
  });
});
