# ADR 0003: Checkpoint store lives outside the project

Date: 14 October 2026. Status: accepted.

## Decision

- The store lives at `$TM_HOME` if set, otherwise `~/.timemachine`. One folder per project, keyed by a hash of the project's absolute path.
- Content addressed blobs (SHA-256 of the plaintext, gzip compressed) under `objects/`.
- One immutable JSON manifest per checkpoint under `checkpoints/`.
- Append-only audit log `audit.jsonl`.
- Each checkpoint commit is also pinned in the project at `refs/tm/<id>` so `git gc` keeps it, and written as a `git bundle` into the store so deleting the project does not delete it.

## Alternatives

- `.timemachine/` inside the project: dies with an agent's `rm -rf`. Rejected.
- Only `refs/tm/*`: lives inside `.git`, same problem. Kept as a convenience, not the source of truth.

## Cost and migration

A small amount of disk outside the project. The store has a `storeVersion` so later formats can migrate.

## Amendment, 15 October 2026 (security review)

- Verdicts are signed with the store key and bound to the exact manifest they were made for. Unsigned, forged or stale lines are ignored, so an old verdict can never stick to a new checkpoint.
- Checkpoint numbers come from a counter file and are never reused, even if a manifest is deleted.
- The signature catches accidental edits and edits by tools that do not read the key. It does not stop someone who can read `~/.timemachine/key`. We say this plainly and do not call it tamper proof.
- `TM_HOME` is made absolute, and a store inside the project is refused.
- Files are never saved if their name marks them as secret (`.env*` except examples, `.npmrc`, `*.pem`, `*.key` and similar), or if their content matches a secret pattern. Edited tracked files that now hold a secret keep their last committed version in the save point.
- Restores never write through a symbolic link, and saved paths must stay inside the project.
