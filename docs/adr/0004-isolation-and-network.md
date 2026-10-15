# ADR 0004: Safe copy isolation and network policy

Date: 14 October 2026. Status: accepted.

## Decision

- **Default isolation is host mode:** `git worktree add --detach` into a temp folder, captured files written back, then the verify command runs there with a clean environment and a time limit. The user's working copy and branch are never touched.
- **Container mode** (Docker, OrbStack, Apple `container`) is a later adapter. Every verdict records which mode ran, and a host mode PASS is always labeled host.
- **Network policy** is set in `timemachine.yml` as `network: allow` or `network: deny`.
  - `deny` is enforced with a sandbox (Anthropic's `srt`, Seatbelt on macOS, bubblewrap on Linux) when one is installed.
  - If `deny` is set and no sandbox is available, verify fails closed with **BLOCKED** and says how to fix it. It never silently runs with the network on.
  - `tm init` writes `deny` only when a sandbox is found, otherwise `allow` with a comment.

## Alternatives

- Docker by default: many builders do not have it. Rejected as default.
- Pretending to block the network with fake proxy variables: unreliable and dishonest. Rejected.

## Cost

Host mode is weaker isolation than a container. We say so on every verdict.

## Amendment, 15 October 2026

- **Sandboxes used today:** `sandbox-exec` on macOS, `bwrap` or `unshare` (a network namespace) on Linux. Anthropic's `srt` is not wired in yet. The fail closed rule is unchanged.
- **Setup has the network.** `verify.setup` (for example `npm ci`) runs outside the sandbox so it can install dependencies. Only `verify.command` runs under the network policy. A failing setup gives FAIL and the check does not run.
- Reason: with deny on, an install step could never work, so people would turn deny off entirely. This keeps the check itself offline, which is what the policy is for.
