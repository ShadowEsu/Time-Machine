// Save point names (their message, else "Save at 2:58:48 AM", seconds on every time) and the one home-folder shortener
// (a path that starts with the home folder, as given or after realpath, at a "/" boundary, reads ~).
import { afterEach, describe, expect, test } from "vitest";
import { clock, homeHtml, homePath, nameLine, namePhrase, namePoint, pointClock, pointMessage, setHomes, when } from "../src/shared/format.ts";
import { goBackLabel, projectStatus } from "../src/renderer/status.ts";

const seconds = (iso: string): string => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
const today = (h: number, m: number, s: number): string => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, s).toISOString();
};

describe("home paths", () => {
  afterEach(() => setHomes([]));

  test("a path that starts with the home folder reads ~, only up to a / boundary", () => {
    setHomes(["/Users/me"]);
    expect(homePath("/Users/me")).toBe("~");
    expect(homePath("/Users/me/code/tips")).toBe("~/code/tips");
    expect(homePath("/Users/meg/code")).toBe("/Users/meg/code");
    expect(homePath("/Users/me.old/code")).toBe("/Users/me.old/code");
  });

  test("the home folder inside another path stays as it is", () => {
    setHomes(["/Users/me"]);
    expect(homePath("/backup/Users/me/code")).toBe("/backup/Users/me/code");
    expect(homePath("/Volumes/Work/Users/me")).toBe("/Volumes/Work/Users/me");
    expect(homePath("~/Users/me/notes")).toBe("~/Users/me/notes");
  });

  test("/var and /private/var: the home as given and after realpath both read ~, and neither is matched inside the other", () => {
    setHomes(["/var/folders/ab/T/home", "/private/var/folders/ab/T/home"]);
    expect(homePath("/var/folders/ab/T/home/tips")).toBe("~/tips");
    expect(homePath("/private/var/folders/ab/T/home/tips")).toBe("~/tips");
    // Known only as given, the realpath form is a different path: the given home sits inside it, not at its start.
    setHomes(["/var/folders/ab/T/home"]);
    expect(homePath("/private/var/folders/ab/T/home/tips")).toBe("/private/var/folders/ab/T/home/tips");
  });

  test("in a sentence, each path that starts with the home folder reads ~", () => {
    setHomes(["/Users/me"]);
    expect(homePath("Can’t find tips at /Users/me/code/tips. If it moved, choose it.")).toBe("Can’t find tips at ~/code/tips. If it moved, choose it.");
    expect(homePath("A copy is ready at /Users/me.")).toBe("A copy is ready at ~.");
  });

  test("with no home known nothing changes, and a root is never a home", () => {
    expect(homePath("/Users/me/code")).toBe("/Users/me/code");
    setHomes(["/"]);
    expect(homePath("/Users/me/code")).toBe("/Users/me/code");
  });

  test("page HTML: text, titles and accessible names read ~; what a button acts on and what someone typed keep the full path", () => {
    setHomes(["/Users/me/"]);
    const html = '<span class="path" title="/Users/me/code">/Users/me/code</span><button data-act="reveal-dir" data-path="/Users/me/code" aria-label="Show /Users/me/code">Show</button><input value="/Users/me/a" placeholder="/Users/me/b"><textarea>/Users/me/c</textarea><p>&quot;/Users/me/d&quot;</p>';
    expect(homeHtml(html)).toBe('<span class="path" title="~/code">~/code</span><button data-act="reveal-dir" data-path="/Users/me/code" aria-label="Show ~/code">Show</button><input value="/Users/me/a" placeholder="/Users/me/b"><textarea>/Users/me/c</textarea><p>&quot;~/d&quot;</p>');
  });
});

describe("save point names", () => {
  const at = today(2, 58, 48);
  const t = seconds(at);

  test("every time shown carries its seconds, a save point alone in its minute too", () => {
    expect(clock(at)).toBe(t);
    expect(when(at)).toBe(t);
    const c = { id: "cp-0001", createdAt: at };
    expect(pointClock(c, [c])).toBe(t);
  });

  test("a save point is named by its message, its time after it", () => {
    const c = { id: "cp-0002", createdAt: at };
    const n = namePoint(c, [c], "Added dark mode");
    expect(n).toEqual({ name: "“Added dark mode”", time: t });
    expect(nameLine(n)).toBe(`“Added dark mode” · ${t}`);
    expect(namePhrase(n)).toBe(`“Added dark mode” (${t})`);
  });

  test("with no message its time names it: Save at 2:58:48 AM", () => {
    const c = { id: "cp-0002", createdAt: at };
    const n = namePoint(c, [c], "  ");
    expect(n).toEqual({ name: `Save at ${t}`, time: "" });
    expect(nameLine(n)).toBe(`Save at ${t}`);
    expect(namePhrase(n)).toBe(`the save at ${t}`);
  });

  test("a long message is clipped, so a button or a heading keeps one line", () => {
    const c = { id: "cp-0002", createdAt: at };
    const name = namePoint(c, [c], "Moved the settings page into its own route and fixed the tests").name;
    expect(name).toBe("“Moved the settings page into its own ro…”");
  });

  test("twins in one second keep #N in the Inspector's time, never in a name", () => {
    const a = { id: "cp-0003", createdAt: at };
    const b = { id: "cp-0004", createdAt: at };
    expect(pointClock(b, [a, b])).toBe(`${t} #4`);
    expect(namePoint(b, [a, b], "").name).toBe(`Save at ${t}`);
    expect(namePoint(b, [a, b], "Broke it").time).toBe(t);
  });

  test("what names it: a name someone gave, the agent's prompt, a note someone wrote, the commit subject; never how it was made", () => {
    const auto = { note: "Auto save", trigger: "auto", agent: null, subject: null };
    expect(pointMessage(auto)).toBe("");
    expect(pointMessage({ ...auto, note: "Saved by you", trigger: "app" })).toBe("");
    expect(pointMessage({ ...auto, note: "Before recovering cp-0003", trigger: "recover" })).toBe("");
    expect(pointMessage({ ...auto, note: "Before risky command: rm -rf dist", trigger: "claude-code:pre-bash", agent: { name: "Claude Code", prompt: "clean up" } })).toBe("");
    expect(pointMessage({ ...auto, note: "Added dark mode", trigger: "app" })).toBe("Added dark mode");
    expect(pointMessage({ ...auto, note: "After agent turn", trigger: "claude-code:stop", agent: { name: "Claude Code", prompt: "add dark mode" } })).toBe("Add dark mode");
    expect(pointMessage({ ...auto, subject: "Fix the parser" })).toBe("Fix the parser");
    expect(pointMessage({ ...auto, note: "Added dark mode" }, "Before the demo")).toBe("Before the demo");
  });

  test("the status names the way back by its message, its time beside it; with none, by its time", () => {
    const pt = (n: number, verdict: "PASS" | "FAIL" | null, createdAt: string, note: string) => ({ id: `cp-000${n}`, verdict, createdAt, note, trigger: "app", agent: null });
    const works = today(2, 50, 7);
    const broken = projectStatus([pt(1, "PASS", works, "Added dark mode"), pt(2, "FAIL", at, "Added a dependency")]);
    expect(broken.primary).toEqual({ label: "Bring back “Added dark mode”", sub: seconds(works), act: "rewind-to", id: "cp-0001", title: `Bring back “Added dark mode” · ${seconds(works)}` });
    expect(broken.body).toContain(`“Added dark mode” (${seconds(works)}) still works.`);
    expect(broken.voice).toBe(`Since ${t}.`);
    const unnamed = projectStatus([pt(1, "PASS", works, "Auto save"), pt(2, "FAIL", at, "Auto save")]);
    expect(unnamed.primary).toEqual({ label: `Bring back the save at ${seconds(works)}`, act: "rewind-to", id: "cp-0001", title: `Bring back the save at ${seconds(works)}` });
    expect(unnamed.body).toContain(`The save at ${seconds(works)} still works.`);
    expect(goBackLabel(pt(1, "PASS", works, "Added dark mode"), [])).toBe(`Bring back “Added dark mode” · ${seconds(works)}`);
    expect(projectStatus([pt(1, "PASS", at, "Added dark mode")]).voice).toBe(`Saved “Added dark mode” at ${t}.`);
    expect(projectStatus([pt(1, "PASS", at, "Auto save")]).voice).toBe(`Saved ${t}.`);
  });
});
