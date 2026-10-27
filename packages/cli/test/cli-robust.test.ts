// Dogfood 25 Oct, CLI (cli#11-#17, #23-#25, #30-#33 and the gaps): per-command help, exit codes, folder
// words, tm list / thin / doctor / relink, and a folder that was moved or deleted reached with -C.
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { once } from "node:events";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { tempDir } from "../../../fixtures/demo/setup.ts";
import { main } from "../src/main.ts";

interface Run { code: number; out: string; err: string }
async function run(cwd: string, env: NodeJS.ProcessEnv, ...argv: string[]): Promise<Run> {
  let out = "";
  let err = "";
  const code = await main(argv, { cwd, env, stdout: (s) => { out += s; }, stderr: (s) => { err += s; }, isTTY: false });
  return { code, out, err };
}

/** A plain folder with a store of its own, not set up yet. */
function folder(): { root: string; dir: string; env: NodeJS.ProcessEnv; home: string } {
  const root = tempDir("cli-robust");
  const dir = join(root, "Thesis");
  const home = join(root, "store");
  mkdirSync(dir);
  writeFileSync(join(dir, "chapter-1.md"), "# One\n");
  return { root, dir, home, env: { ...process.env, TM_HOME: home } };
}

describe("help and usage (cli#11, #13, #30)", () => {
  test("each command has its own help with usage, options and an example; an unknown command with --help is 64", async () => {
    const { dir, env } = folder();
    const h = await run(dir, env, "checkpoint", "--help");
    expect(h.code).toBe(0);
    expect(h.out).toMatch(/^Usage: tm checkpoint \[-m <note>\]/);
    expect(h.out).toContain("--if-changed");
    expect(h.out).toContain("Example:\n  tm checkpoint -m");
    for (const c of ["init", "status", "timeline", "open", "recover", "relink", "list", "thin", "doctor", "log", "license"]) {
      expect((await run(dir, env, c, "--help")).out).toContain(`Usage: tm ${c}`);
    }
    expect((await run(dir, env, "frob", "--help")).code).toBe(64);
    expect((await run(dir, env, "--help")).out).toContain("tm <command> --help");
  });

  test("an unknown option and a missing value are said in plain words", async () => {
    const { dir, env } = folder();
    expect(await run(dir, env, "checkpoint", "--frob")).toEqual({ code: 64, out: "", err: "tm: Unknown option --frob. Run tm checkpoint --help.\n" });
    expect((await run(dir, env, "open", "cp-0001", "--dir")).err).toBe("tm: --dir needs a value. Run tm open --help.\n");
    expect((await run(dir, env, "checkpoint", "--trigger", "bogus")).err).toBe("tm: --trigger must be one of manual, auto, app, mcp.\n");
  });
});

describe("a plain folder in folder words (cli#12, #14, #15, #16, #17, #25, #31, #32)", () => {
  test("status, init, checkpoint, timeline and log", async () => {
    const { root, dir, env } = folder();
    expect(await run(dir, env, "status")).toEqual({ code: 0, out: "Not set up here. Run tm init.\n", err: "" });

    const init = await run(dir, env, "init");
    expect(init.code).toBe(0);
    expect(init.out).toContain("A check is optional for a plain folder");
    const settings = /in the store, never in the folder: (\S+)/.exec(init.out)?.[1] ?? "";
    expect(settings).toMatch(/timemachine\.yml$/);
    expect((await run(dir, env, "status")).out).toContain(`Settings  ${settings}`);

    writeFileSync(join(dir, ".env"), "A=1\n");
    writeFileSync(join(dir, "big.bin"), Buffer.alloc(6 * 1024 * 1024));
    const saved = await run(dir, env, "checkpoint", "-m", "first");
    expect(saved.code).toBe(0);
    expect(saved.out).toContain("Values in .env not saved: A");
    expect(saved.out).toContain(`big.bin: over the 5 MB limit (capture.maxFileMB in ${settings})`);
    expect(saved.out.trimEnd().endsWith("Next: tm timeline")).toBe(true);
    expect(saved.out).not.toContain("tm verify");

    const tl = await run(dir, env, "timeline");
    expect(tl.out).toMatch(/^History of .*Thesis \(times in \S+\)$/m);
    expect(tl.out).toMatch(/^cp-0001\s+not checked\s+\d{4}-\d\d-\d\d \d\d:\d\d {2}first$/m);

    expect((await run(dir, env, "log")).out).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d \S+ {2}init/m);
    expect((await run(dir, env, "open", "cp-9999")).code).toBe(64);

    writeFileSync(join(root, "afile.txt"), "x");
    expect((await run(dir, env, "open", "cp-0001", "--dir", join(root, "afile.txt"))).err).toContain("is a file, not a folder");
    expect((await run(dir, env, "license", "--remove")).out).toMatch(/^There was no license on this computer\./);
  });
});

describe("tm list, thin, doctor and a folder that moved (cli gaps, cli#6, writer#1)", () => {
  test("list shows every project, doctor finds a missing saved copy (exit 2), thin says why nothing can go", async () => {
    const { root, dir, env, home } = folder();
    await run(dir, env, "init");
    await run(dir, env, "checkpoint");
    const listed = await run(root, env, "list");
    expect(listed.out).toContain(dir.split("/").at(-1) ?? "");
    expect(listed.out).toMatch(/Plain folder, 1 save point, [\d.]+ (B|KB|MB)/);
    expect(JSON.parse((await run(root, env, "list", "--json")).out).projects).toHaveLength(1);

    expect((await run(root, env, "doctor"))).toMatchObject({ code: 0, out: expect.stringContaining("Every save point is whole.") });
    const projects = readdirSync(join(home, "projects"));
    const objects = join(home, "projects", projects[0] ?? "", "objects");
    for (const sub of readdirSync(objects)) rmSync(join(objects, sub), { recursive: true });
    const doc = await run(root, env, "doctor");
    expect(doc.code).toBe(2);
    expect(doc.out).toContain("the saved copy of chapter-1.md is gone from the store");

    const opened = await run(dir, env, "open", "cp-0001", "--dir", join(root, "copy"));
    expect(opened.code).toBe(2);
    expect(opened.out).toContain("the saved copy of chapter-1.md is gone from the store");
    expect((await run(dir, env, "timeline")).out).toMatch(/cp-0001\s+DAMAGED/);

    const thin = await run(dir, env, "thin");
    expect(thin.code).toBe(0);
    expect(thin.out).toMatch(/^Nothing to thin\./);
  });

  test("a deleted folder is reached with -C: timeline, recover --to, then relink", async () => {
    const { root, dir, env } = folder();
    await run(dir, env, "init");
    await run(dir, env, "checkpoint", "-m", "keep me");
    renameSync(dir, join(root, "Thesis-moved"));

    const tl = await run(root, env, "timeline", "-C", "Thesis");
    expect(tl.code).toBe(0);
    expect(tl.out).toContain("is not there any more");
    expect(tl.out).toContain("keep me");

    mkdirSync(join(root, "out"));
    const r = await run(root, env, "recover", "cp-0001", "-C", "Thesis", "--to", "out");
    expect(r.code).toBe(0);
    expect(r.out).toContain("Saved first     nothing, the folder was not there");
    expect(readdirSync(join(root, "out"))).toEqual(["Thesis-recovered-cp-0001"]);
    expect((await run(root, env, "checkpoint", "-C", "Thesis")).code).toBe(4);

    const linked = await run(root, env, "relink", "Thesis", "Thesis-moved");
    expect(linked.code).toBe(0);
    expect(linked.out).toContain("Its save points, settings and notes came along.");
    expect((await run(join(root, "Thesis-moved"), env, "checkpoint")).out).toContain("Saved cp-0002");
  });
});

describe("tm restore puts one file back (writer#10)", () => {
  test("--dry-run says what would come back; a skipped path exits 2; no path is a usage error", async () => {
    const { dir, env } = folder();
    await run(dir, env, "init");
    await run(dir, env, "checkpoint", "-m", "first");
    writeFileSync(join(dir, "chapter-1.md"), "garbage\n");

    const help = await run(dir, env, "restore", "--help");
    expect(help.code).toBe(0);
    expect(help.out).toContain("Usage: tm restore <cp> [--dry-run] -- <path> [<path>...]");
    expect(help.out).toContain("--dry-run");
    expect((await run(dir, env, "restore", "cp-0001")).code).toBe(64);
    expect((await run(dir, env, "restore", "cp-0001", "--dry-run", "--to", "x", "--", "chapter-1.md")).code).toBe(64);

    const dry = await run(dir, env, "restore", "cp-0001", "--dry-run", "--", "chapter-1.md");
    expect(dry).toEqual({
      code: 0,
      err: "",
      out: "Dry run: would put back 1 file from cp-0001. Nothing was written.\n  Changed 1, added 0, already the same 0\n  Saved first     nothing, this was a dry run\nWould restore\n  chapter-1.md\n",
    });
    expect(readFileSync(join(dir, "chapter-1.md"), "utf8")).toBe("garbage\n");

    const r = await run(dir, env, "restore", "cp-0001", "--", "chapter-1.md", "nope.md");
    expect(r.code).toBe(2);
    expect(r.out).toContain("Put back 1 file from cp-0001 into your folder.");
    expect(r.out).toContain("Saved first     cp-0002, your folder before this restore");
    expect(r.out).toContain("Skipped\n  nope.md: not in cp-0001");
    expect(readFileSync(join(dir, "chapter-1.md"), "utf8")).toBe("# One\n");

    const json = await run(dir, env, "restore", "cp-0001", "--json", "--", "chapter-1.md");
    expect(json.code).toBe(0);
    expect(JSON.parse(json.out)).toMatchObject({ restored: [], savedBefore: null, diff: { added: 0, changed: 0, same: 1 } });

    rmSync(dir, { recursive: true });
    const gone = await run(dir.replace(/Thesis$/, ""), env, "restore", "cp-0001", "-C", "Thesis", "--", "chapter-1.md");
    expect(gone.code).toBe(4);
    expect(gone.err).toMatch(/^tm: Can't find .*Thesis; use recover to a chosen folder/);
  });
});

describe("tm ui on a busy port (cli#23)", () => {
  test("says the port is in use and which to try, exit 64, using the store TM_HOME names and giving it back (Security R2)", async () => {
    const { root, dir, env, home } = folder();
    // A packaged CLI next to its browser assets, so tm ui gets as far as binding the port.
    mkdirSync(join(root, "bin", "ui"), { recursive: true });
    writeFileSync(join(root, "bin", "tm.js"), "");
    writeFileSync(join(root, "bin", "ui", "index.html"), "<!doctype html><title>Time Machine</title>");
    writeFileSync(join(root, "bin", "ui", "asset-manifest.json"), JSON.stringify(["index.html"]));
    const busy = createServer();
    busy.listen(0, "127.0.0.1");
    await once(busy, "listening");
    const address = busy.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      let err = "";
      const code = await main(["ui", "--port", String(port), "--no-open"], { cwd: dir, env, stdout: () => undefined, stderr: (s) => { err += s; }, isTTY: false, script: join(root, "bin", "tm.js") });
      expect({ code, err }).toEqual({ code: 64, err: `tm: Port ${port} is in use (maybe another tm ui). Use --port ${port + 1}.\n` });
      // The app's files were opened in the store this run names, not the one in the real home folder, and its lock is gone.
      expect(readdirSync(join(home, "ui"))).not.toContain("server.lock");
    } finally {
      busy.close();
    }
  });
});
