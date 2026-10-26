# ADR 0014: Plain folder projects, auto save, run notes and sources

Date: 25 October 2026. Status: accepted for the night build on `design/app-night`, pending Security review. The engine side is built in `packages/core` and the `tm ui` engine. The app's screens for it are a separate lane on the same branch.

## Context

Until now every project had to be a Git repository. People also want to protect documents, notes, research data, trial runs and AI agent workspaces. These folders usually have no repository, and their owners should not need one. The founder asked for backups of more than code. The rule that we never touch the user's folder still holds.

## Decision

- **A shadow Git dir in the store.** A plain folder's history lives in `<store>/projects/<hash of the path>/shadow.git`, where the path is the native real path, so its letter case is the one on disk and one folder spelled two ways is one project. The folder itself gets nothing: no `.git`, no `timemachine.yml`, no `.claude` folder.
- **Git sees the folder only from inside the folder.** For a folder project, `resolveProject` puts the shadow dir and the folder in two private keys of the project's environment. The git helpers in `git.ts` turn them into `GIT_DIR` and `GIT_WORK_TREE` only for a command whose working directory is that exact folder. A command run in a copy, a temp dir or anywhere else gets neither. Values inherited from a parent process are dropped first.
- **Adding is explicit.** `tm init` in the folder, or Add in the app (`protect()` in core), makes the shadow dir. Any other command in a folder that was never added is refused and creates nothing. A folder project always wins, from the folder or any subfolder: `resolveProject` never asks Git which repository the folder is in once the store knows it, so a `.git` made around it, in it or in a subfolder later can't move its history, and that `.git`'s config (`core.worktree`, `core.fsmonitor`, hooks, filters) is never read. Saving skips such a `.git` as it skips any nested repository. Every Git command also runs with hooks and `core.fsmonitor` off and without the system config (`GIT_CONFIG_NOSYSTEM`).
- **Every file is stored on its own.** A folder's save point is an empty Git commit plus each file saved as a blob in the store. All files go through the path untracked files use in a Git project, so the secret name check, the secret content check and `capture.maxFileMB` (5 MB by default) apply to every file.
- **Settings in the store.** A folder's `timemachine.yml` lives in its store folder, and every setting comes from there, saving included (`checkpoint.ts` reads `configRoot(p)`). A `timemachine.yml` inside the folder is only a file that gets saved: it can't switch saving off, record `.env` values or break saving. A check is optional. Without one, a check reports BLOCKED and says a check is optional for a folder.
- **The store is private.** It holds a copy of every saved file, and Sources offers folders such as Documents that are 0700. The store home and each project store are 0700 (an existing, more open store home is tightened the next time it is used), saved files and manifests 0400, and `notes.json`, `recovery-copies.json` and recovery reports 0600. A plain recovery or open copy is made with the source folder's mode, or 0700.
- **Words.** A folder's save point says "Files: N files in the folder" and never "Code: commit …".

## What is and is not saved for a folder

**Saved:** every regular file in the folder and its subfolders, up to the size cap, that does not look secret. A `.gitignore` in the folder is still respected. Key names and fingerprints from `.env` are recorded, never values. Platform, Node and Git versions are recorded.

**Not saved:** secret files by name (such as `.env`, `*.pem`, `id_rsa`), files whose text looks like a secret, files over the size cap, symbolic links, nested Git repositories, folders that can't be read, and files the folder's `.gitignore` skips. Every save point lists what it did not save, with the reason: "notes/secret: could not be read", "interview.wav: over the 5 MB limit (capture.maxFileMB in <settings path>)". Databases, deployed versions and external services are not captured.

## Recovery and undo

- **A copy only.** A folder has no repository, so a recovery makes no branch. It saves the current state first, then writes a copy of plain files next to the folder (`<name>-recovered-<id>`), or inside a folder the person picks (`dest`, `tm recover --to`). The copy has no `.git`. Saved files get back the modified time they were saved with, when the save point recorded it (`files[].mtimeMs`, optional, so older manifests still read). The result has `copyOnly: true` and `branch: ""`, and its manual steps and report say no branch was made.
- **Safe copies too.** `tm open` and the app's open give a copy of plain files for a folder. Checks still run in a temporary Git worktree of the shadow history, removed afterwards.
- **A folder that was moved or deleted.** Its history is in the store, so `resolveProject` still finds it by its old path (`missing: true`): its save points list, open and come back as copies (`dest`), with nothing to save first. Saving is refused with a sentence that says how to bring a version back or relink. `relinkProject(ctx, newRoot)` (`tm relink <old> <new>`) moves the store folder to the new path's name and records the move in `project.json`; the project keeps its save points, settings, notes and check history. The new path must be an existing folder outside the store, not protected already and not inside another protected folder.
- **Put one file back (core, CLI and app).** `restorePaths(ctx, id, paths, { dryRun })` (`tm restore <cp> [--dry-run] -- <path>...`; in the app, Compare with now) is the one place Time Machine writes in the person's folder, and only the paths they name. For a folder and a Git project alike it refuses unsafe paths, paths inside `.git`, secrets files, config files and paths the save point lacks, by name; saves the folder first (trigger `before-restore`) and does not replace a file whose current version that save left out; writes each file through a temp file with its saved mode (masked to `0o777`) and today's time, as a checkout does, so build tools see the change; never through a symbolic link; and deletes nothing (files the save point lacks are `kept`). Just before a file lands it is looked at again: a file there is replaced by a rename only if its size, mtime, ctime, inode and device are what the plan read, else it is skipped as "changed while putting back"; a file that was not there is hard-linked into place (an exclusive copy where the disk has no hard links), so one that appeared meanwhile is never replaced (Security R1, 26 Oct). A Git project gets files only: no index change, no commit (`note: "Files written; nothing committed."`). Audit: `restore <id> <n> paths`.
- **Undo rules.** Undo takes `branch: ""` for a folder. It removes the copy only when all of these hold: the store's `recovery-copies.json` recorded this copy for this save point; the copy has the expected name; and no file in it is new or changed. Files the person deleted from the copy do not block undo, because no work is lost. Undo never touches the folder or any save point.

## Auto save while the app is open

- `features.autoSave` is `"off"` or `"change"`, set with `setFeature`. New plain folders with purpose documents, research or agents start with `"change"`. Every other project starts with `"off"`.
- While `tm ui` runs, the engine watches each such folder with a recursive `fs.watch`. Where that is not available, or the watch breaks, it polls once a minute instead.
- A save happens 20 seconds after the last change, at most once a minute per project, through the same per-project queue as every other action. It never runs while a check, search or rewind is running on that project. It calls `checkpoint` with skip-if-unchanged, note "Auto save" and trigger `"auto"`.
- Changes under `.git` and `node_modules`, in the Time Machine store, and to system and editor files (`JUNK_FILE_NAMES` and `isJunkFile` in core: `.DS_Store`, `Thumbs.db`, `desktop.ini`, `~$*`, `*.swp`, `.#*`) are ignored.
- Watches and timers never keep the process alive. The gated `server.ts` does not call `Engine.close()`, so watches end when the process exits.
- Nothing runs while the app is closed.

## Run notes

A person can give a save point a title (80 characters at most), a note (2000 at most) and a pin. They live in `notes.json` in the project's store, never in a save point (manifests are sealed) and never in the project folder. Input is checked with Zod. The file is written to a temp file, then renamed. Text that looks like a secret is refused, with the same check and message in the engine and in the browser preview. A damaged file is reported, never silently replaced.

## Thinning old auto saves

Auto save can add a save point every minute, so old ones can be thinned. It runs only when a person asks, after a preview. Nothing thins on its own.

- **Only auto saves can go.** A save point with any trigger other than `"auto"` always stays.
- **These always stay:** a save point whose check passed (so the newest PASS stays too), one that is pinned or has a title or note in run notes, one named by a recover or undo-recover entry in the audit log, the newest 20 save points, and anything from the last 24 hours. Unreadable save points stay for a person to look at.
- **Older auto saves:** one per hour for 7 days, then one per day. Going from newest to oldest, an auto save goes only when another save point from the same hour (or day) already stays. So the newest one in each hour or day stays.
- **Preview.** `thinPreview` reads only. It lists each save point that can go, with its time and the reason, how many stay, about how many bytes it frees, and the save points that can't be read right now (`unreadable`).
- **Apply.** `thinApply` takes the store lock and runs the preview again. If any id is not in that fresh preview, it refuses the whole call and removes nothing. While any save point can't be read, it also refuses ("cp-0005 can't be read; nothing was removed"): that save point's manifest is the only record of which saved files it needs. Then it removes each save point's manifest first, then its `refs/tm/<id>` pin, its bundle and its check logs, and the saved files no kept save point uses. Shared saved files stay. It writes a `thin` entry to the audit log. In the app, apply goes through the same per-project queue as every other action.
- **Bundles stay complete.** Each bundle holds only the commits earlier save points did not have. So the bundles of kept save points after the first removed one are rebuilt against the earlier kept ones.
- **Numbers are never reused.** The store's counter keeps counting, so a new save point never takes a thinned one's number. Verdicts of removed save points drop out, because the manifest they were sealed to is gone.
- Notes of removed save points cannot exist, because a noted save point always stays. Signed verdict lines and audit lines are never rewritten.

## Sources

`sources` reports whether well-known folders exist: iCloud Drive, Dropbox, Google Drive, OneDrive, Obsidian, Documents and Desktop. It checks fixed paths under the home folder with `stat`. It lists `~/Library/CloudStorage` once, by name only, to find drives whose folder name carries an account. It never opens a file and never lists inside any of these folders. Each row only offers to protect that folder as a plain folder project.

## Alternatives

- **`git init` in the user's folder:** simplest, but it writes `.git` into their folder and can mix with their own tools. Rejected.
- **`git init --separate-git-dir`:** keeps the repository in the store but still writes a `.git` file into the folder. Rejected.
- **Committing folder files into the snapshot tree:** would show files as "code", but the tracked path has no size cap and screens only changed files. Rejected in favour of per-file storage.
- **Recovery as a linked worktree:** made undo simpler, but left a hidden `.git` in the copy pointing into the store. Replaced by plain copies.

## Open items

- The 5 MB cap applies to documents too, so large PDFs, scans and media are listed as not saved. A higher default for folders is a product call.

## Security review checklist

Gated files changed: `packages/core/src/checkpoint.ts`, only for Security's F4 (25 Oct): line 9 imports `configRoot`, and line 153 reads `loadConfig(configRoot(p))` instead of `loadConfig(p.root)`. Approved in the CoreFix brief; Security re-checks it.

- `packages/core/src/git.ts`: maps the shadow keys to `GIT_DIR`/`GIT_WORK_TREE` only when the command runs in the folder itself; strips them from every git environment.
- `packages/core/src/project.ts`: folder detection by walking up to a store shadow dir, precedence over repositories, creation only with `create: "write"`, store-inside-project refusal before creating, inherited shadow keys dropped, `configRoot`.
- `packages/core/src/folder.ts`: `protect()`, folder wording for summaries, `checkpoint` wrapper, `hookInstall` refused for folders.
- `packages/core/src/index.ts`: exports `checkpoint` and `hookInstall` through `folder.ts`, plus `protect`, `notes`, `setNote`, `sources`.
- `packages/core/src/materialize.ts`: `plain` option writes saved files into a new folder with no worktree; folder wording for restored files.
- `packages/core/src/recover.ts`: folder recovery without a branch, plain copy, `recovery-copies.json`, folder undo rules, worktree HEAD parsing.
- `packages/core/src/restore.ts`: `restorePaths`, the only write into the person's folder: path checks, the save first and its hold check, temp file and rename per file, no symbolic links followed, nothing deleted.
- `packages/core/src/git.ts`: `gitBlob` reads a blob's bytes as they are, with the same shadow mapping as `gitTry`.
- `packages/core/src/open.ts`: plain safe copy for folders.
- `packages/core/src/verify.ts`: reads a folder's check from the store; folder BLOCKED message.
- `packages/core/src/init.ts`: makes a folder project, writes its `timemachine.yml` in the store, no guessed check for folders.
- `packages/core/src/setCheck.ts`: writes a folder's check in the store, creating the file there if needed.
- `packages/core/src/consent.ts`, `checkRecord.ts`, `history.ts`, `logTail.ts`: read a folder's settings from the store.
- `packages/core/src/timeline.ts`: folder wording for timeline entries.
- `packages/core/src/notes.ts`: run notes sidecar, Zod, atomic write, secret refusal, damaged file refusal.
- `packages/core/src/sources.ts`: stat-only checks on fixed paths, one name-only listing of `~/Library/CloudStorage`.
- `packages/core/src/secret-patterns.ts`: secret text patterns moved out of `secrets.ts` with no Node imports, plus the shared note refusal message.
- `packages/core/src/secrets.ts`: imports and re-exports `looksSecret`.
- `packages/core/src/types.ts`: `RecoverResult.copyOnly`, `RunNote`, `SourceId`, `SourceRow`, `ThinPreview`.
- `packages/core/src/thin.ts`: thinning rule, preview, apply under the store lock with a fresh preview, deletion of manifests, pins, bundles, logs and unshared saved files, bundle rebuild, audit entry.
- `packages/core/src/store.ts`: exports `blobPath`.
- `packages/core/src/audit.ts`: `auditEntries`, a sync reader that `log` now uses.
- `apps/web/src/server/engine.ts`: adds plain folders (free limit checked before anything is written), purpose, `setPurpose`, `notes`, `setNote`, `sources`, `thinPreview`, `thinApply` (queued), auto save wiring and defaults, `close()`.
- `apps/web/src/server/autosave.ts`: the watcher, debounce, rate limit, busy wait, ignored paths and poll fallback.
- `apps/web/src/shared/api.ts`: `kind`, `purpose`, `autoSave`, the new calls and their Zod schemas, `undoRecover` accepting `branch: ""`.
- `apps/web/preview/fake.ts`: preview data only; imports `secret-patterns.ts` for the note check; runs the same thinning rule on preview data.
- `packages/cli/src/format.ts`: `tm recover` output for a copy-only recovery.
- `docs/GUIDE.md`: user docs for folders, auto save and run notes.
- Tests: `packages/core/test/folder.test.ts`, `notes.test.ts`, `sources.test.ts`, `thin.test.ts`, `apps/web/test/engine.test.ts`, `engine-autosave.test.ts`.

## Migration path

Projects saved before this change load as `kind: "git"`, `purpose: "code"` and `autoSave: "off"`. Nothing changes for them. Removing a folder project from the app keeps its store folder and shadow history; adding the folder again finds them.
