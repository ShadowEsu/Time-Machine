# CLAUDE.md

Coding guidelines adapted from [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) (MIT).

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

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

## 4. Goal-Driven Execution

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

---

## Project rules for Time Machine

Read `docs/BUILD_BRIEF.md` before starting any work. It is the source of truth for scope.

- **Scope is the P0 MVP only** (requirements C01 to C14, tests V01 to V12): GitHub repo, captured files, allowlisted config, environment definition, verification command. No hosted dashboard, no auth, no billing, no database snapshots, no deployment rollback, no business-automation replay, until the founder explicitly changes it.
- **Every bug fix starts with a failing test.** That is the product thesis; the codebase has to live by it.
- **Never touch the user's working copy or current branch** when opening, verifying, or recovering. Use separate worktrees. Never push, merge, or deploy.
- **Never promise universal undo.** Every checkpoint and report states what was not captured and what needs manual recovery. An unverified checkpoint is never shown as working.
- **Secret values are never stored.** Only key names. This applies to the store, logs, reports, and tests.
- **Clearly separate planned from implemented** features in docs, help text, and the website.
- **Result meanings are fixed:** PASS 0, FAIL 1, INCOMPLETE 2, BLOCKED 3, ERROR 4. Never change them without an ADR.
- **No real customer data in fixtures, logs, examples, or tests.** Synthetic data only.
- **TypeScript strict, no `any`.** Validate every external input with Zod.
- **Record consequential decisions** as short ADRs in `docs/adr/` (choice, alternatives, cost, migration path).
- **Never claim** "guaranteed", "undo anything", "replays any app", "zero setup", "enterprise ready", or certifications we do not hold, in code, docs, or the website.
- **Writing style for docs and site copy:** short, plain sentences. No em dashes.
