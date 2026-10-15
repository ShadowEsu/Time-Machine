# ADR 0005: Exit codes

Date: 14 October 2026. Status: accepted.

## Decision

- Verdicts keep their fixed codes: PASS 0, FAIL 1, INCOMPLETE 2, BLOCKED 3, ERROR 4.
- Commands that are not verdicts (checkpoint, timeline, diff, log, recover) exit 0 on success and 4 on an internal error.
- Usage errors (bad flags, unknown command, missing confirmation when there is no terminal) exit **64** (`EX_USAGE`), so they never collide with INCOMPLETE.

## Alternatives

- Letting the argument parser use its default exit code 2. Collides with INCOMPLETE. Rejected.
