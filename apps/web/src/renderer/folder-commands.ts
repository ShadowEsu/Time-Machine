// The "Use it in your folder" text (sequence S3s), as one pure function with no dependencies. Proven by harness.sh
// (rows s1-s5, x1-x3, j2, inject1-5 and S3S a-f/j/l/q, each run in zsh and bash): see RESULTS.md, sections "S3s:
// secret-looking files" and "r7: --no-overwrite-ignore". Needs git 2.23 or later (git switch).
// The app never runs this text. The engine supplies the lists below; it must render at copy time.

export interface FolderCommandsInput {
  /** The folder, absolute. */
  folder: string;
  /** The user's home folder, absolute. A folder inside it is written ~/'rest' (the shell expands the ~). */
  home: string;
  /** The save point id, e.g. cp-0003. */
  id: string;
  /** A branch name that does not exist yet, for the working version (e.g. use-cp-0003; pick -2, -3... when taken). */
  use: string;
  /** A branch name that does not exist yet, for the folder as it is (e.g. tm/before/cp-0003). */
  save: string;
  /** The commit the recovery branch points at. */
  recoverySha: string;
  /** The branch the folder is on. Unused when detachedSha is set. */
  orig: string;
  /** The commit, when the folder's HEAD is detached. */
  detachedSha?: string;
  /**
   * Paths (relative to the folder, as `git ls-files -z` gives them) left out of the save commit: every untracked,
   * unignored file and every tracked file with uncommitted edits for which checkpoint's containsSecret(path, bytes) is
   * true, or that is over capture.maxFileMB, or that can't be read.
   */
  excluded: string[];
  /** Ignored files at paths the saved version tracks, none of them secret-looking: saved with `git add -f`. */
  forceAdd?: string[];
  /** Ignored secret-looking files at paths the saved version tracks. Any of them means no block is offered. */
  secretCollisions?: string[];
}

export type FolderCommands =
  | { offer: true; commands: string; back: string; leftInPlace: string[]; localNote: string }
  | { offer: false; reason: string };

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const SHA = /^[0-9a-f]{7,64}$/;
const BARE = /^[A-Za-z0-9_./@%+=:,-]+$/;

/** Always single-quoted for bash and zsh; a ' is written '\''. */
function quoted(word: string): string {
  return `'${word.replace(/'/g, "'\\''")}'`;
}

/** A word for bash and zsh, left bare when it has only characters neither shell treats specially. */
function word(w: string): string {
  return BARE.test(w) ? w : quoted(w);
}

function folderWord(folder: string, home: string): string {
  const h = home.replace(/\/+$/, "");
  if (h && folder === h) return "~";
  if (h && folder.startsWith(`${h}/`)) return `~/${quoted(folder.slice(h.length + 1))}`;
  return quoted(folder);
}

export function folderCommands(i: FolderCommandsInput): FolderCommands {
  const forceAdd = i.forceAdd ?? [];
  const collisions = [...(i.secretCollisions ?? []), ...forceAdd.filter((p) => i.excluded.includes(p))];
  if (collisions.length) {
    const p = collisions[0]!;
    return { offer: false, reason: `This version tracks ${p}, which looks secret. Move your copy somewhere safe first.` };
  }
  const names = [i.folder, i.home, i.id, i.use, i.save, i.orig, ...i.excluded, ...forceAdd];
  if (names.some((n) => CONTROL.test(n))) return { offer: false, reason: "A name here has a control character, so the commands can't be shown safely." };
  if (!SHA.test(i.recoverySha) || (i.detachedSha !== undefined && !SHA.test(i.detachedSha))) return { offer: false, reason: "The saved version's commit is not known." };
  if (!i.id || !i.use || !i.save || (i.detachedSha === undefined && !i.orig)) return { offer: false, reason: "A branch name is missing." };

  const dir = folderWord(i.folder, i.home);
  const quiet = "git -c core.hooksPath=/dev/null";
  // Every switch refuses rather than overwrite an ignored file at a path the target tracks (git 2.23+, like switch itself).
  const sw = `${quiet} switch --no-overwrite-ignore`;
  const orig = i.detachedSha ?? i.orig;
  const add = i.excluded.length
    ? [`git add -A -- . ${i.excluded.map((p) => quoted(`:(exclude,literal)${p}`)).join(" ")} &&`, `git reset -q -- ${i.excluded.map((p) => quoted(`:(literal)${p}`)).join(" ")} &&`]
    : ["git add -A &&"];
  const commands = [
    `cd ${dir} &&`,
    `git branch ${word(i.use)} ${i.recoverySha} &&`,
    `${sw} -c ${word(i.save)} &&`,
    ...add,
    ...(forceAdd.length ? [`git add -f -- ${forceAdd.map(quoted).join(" ")} &&`] : []),
    `${quiet} -c commit.gpgsign=false -c user.name="Time Machine" -c user.email=tm@localhost commit -q --allow-empty -m ${quoted(`tm: folder before using ${i.id}`)} &&`,
    `${sw} ${word(i.use)}`,
  ].join("\n");
  const back = [
    `cd ${dir}`,
    `${sw} ${word(i.save)}`,
    `git reset -q --soft ${word(orig)}`,
    `${sw} ${i.detachedSha ? `--detach ${i.detachedSha}` : word(i.orig)}`,
    "git reset -q",
    `git branch -D ${word(i.save)}`,
    `git update-ref -d ${word(`refs/heads/${i.use}`)} ${i.recoverySha}`,
  ].join(" && ");
  return {
    offer: true,
    commands,
    back,
    leftInPlace: [...i.excluded],
    localNote: `${i.save} is a local safety branch. Don't push it or merge it; use the go-back line.`,
  };
}
