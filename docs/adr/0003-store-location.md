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
