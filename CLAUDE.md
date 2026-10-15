# CLAUDE.md

## Project

Time Machine: a flight recorder plus undo button for AI agents. It records every agent action with a pre-action snapshot, holds risky actions for approval, and lets users undo one action, rewind to a moment, or rewind, fix and replay on a new branch.

The full research and build plan lives in the Claude Doc "Time Machine — research and build plan":
https://claude.ai/code/artifact/6b3bc04e-2877-4b1e-aa5c-704d147bb0a4

Planned surfaces (nothing is built yet):
- `@timemachine/sdk` (npm): `tm.wrap(tool)` for agent builders
- `tm` CLI + MCP proxy + Claude Code / Codex / Gemini CLI hooks
- Desktop overlay app (Tauri 2) with Undo / Rewind / Stop / Approve
- Web console for teams (audit, approvals, SSO)
- Story website using scroll-beat-kit (https://github.com/buildwithomar/scroll-beat-kit)

Ground rules for this product:
- Never claim "Fully restored" unless every action was restored; report per action.
- Local-first by default; redact secrets at write time.
- The STOP flag lives outside the agent's context.

## Coding guidelines

Adapted from https://github.com/multica-ai/andrej-karpathy-skills (MIT). Bias toward caution over speed; for trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
