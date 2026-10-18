# Time Machine agent integration research

Status: research only. No integrations were changed or exercised.

## Summary

- **Cursor, Codex CLI, Gemini CLI, and GitHub Copilot have the lifecycle hooks needed for the full flow.**
- **Windsurf/Cascade supports automatic saving and end-of-response checking.** Its response hook is asynchronous and cannot require the agent to continue.
- **Cline needs a surface-specific integration.** Its extension hook documentation and newer CLI/SDK plugin system are different. Do not advertise one adapter as covering both.
- **Aider is a Git-based integration, not an MCP integration.** Its auto-test feature can check after edits, but that is not a general end-of-turn hook.
- The existing checkpoint, risk detection, verification, and regression comparison logic is reusable. The installer, agent attribution, payload parsing, and continuation output are Claude-specific today.
- **MCP availability alone does not make saving or checking automatic.** Normal MCP tool calls remain agent-directed unless a lifecycle hook invokes them.

## Capability and configuration table

“Before prompt” means after submission but before the agent starts processing. “After turn” means the agent finishes a turn, not the application exits.

| Agent | Before prompt | Before shell command | After turn / stop | Hook configuration and format | MCP support and configuration | Minimal honest Time Machine integration |
|---|---|---|---|---|---|---|
| **Cursor Agent** | **Yes:** `beforeSubmitPrompt` | **Yes:** `beforeShellExecution`. Alternatively `preToolUse` filtered to `Shell`. | **Yes:** `stop`. Can return `followup_message`. | Project `.cursor/hooks.json`; user `~/.cursor/hooks.json`. JSON: `{"version":1,"hooks":{"event":[{"command":"…"}]}}`. Unlike Claude, native entries do not need nested matcher groups. | **Yes.** Project `.cursor/mcp.json`; user `~/.cursor/mcp.json`. JSON `mcpServers` with `command`, `args`, and optional `env`. | **Full native hooks plus optional MCP.** Cursor also imports `.claude/settings.json` hooks and maps `Bash` to `Shell`. This is a useful compatibility path, not proof that the existing Time Machine kit works unchanged. [Hooks](https://cursor.com/docs/hooks.md), [Claude compatibility](https://cursor.com/docs/reference/third-party-hooks.md), [MCP](https://cursor.com/docs/mcp.md). |
| **OpenAI Codex CLI** | **Yes:** `UserPromptSubmit` | **Yes:** `PreToolUse`, matcher `Bash`. Covers shell and unified execution. | **Yes:** `Stop`, including `stop_hook_active`. Can require continuation. | User `~/.codex/hooks.json` or inline `[hooks]` in `~/.codex/config.toml`. Project equivalents under `.codex/`. JSON uses Claude-style event → matcher groups → handlers. Inline TOML is also supported. Project configuration requires trust. Hook definitions require review and trust through `/hooks`. | **Yes.** `~/.codex/config.toml` or trusted-project `.codex/config.toml`. TOML `[mcp_servers.<name>]`, with `command`, `args`, and optional `cwd`. | **Full hooks plus optional MCP.** This is not a “notify-only” integration under the current documentation. Existing normalized Time Machine hook inputs are a close match. [Hooks](https://developers.openai.com/codex/hooks), [MCP](https://developers.openai.com/codex/mcp). |
| **Gemini CLI** | **Yes:** `BeforeAgent` | **Yes:** `BeforeTool`, matcher `run_shell_command` | **Yes:** `AfterAgent`, once per completed turn. Includes `stop_hook_active`; can reject the response and request correction. | Project `.gemini/settings.json`; user `~/.gemini/settings.json`. JSON `hooks` object with event arrays, matcher groups, and nested `{"type":"command","command":"…"}` handlers. **Timeouts are milliseconds.** | **Yes.** Same settings files, top-level `mcpServers` containing `command`, `args`, and optional environment settings. | **Full hooks plus optional MCP.** Event names and timeout units need translation. Core input fields closely match the existing handler. [Hook setup](https://geminicli.com/docs/hooks/), [Reference](https://geminicli.com/docs/hooks/reference/), [MCP](https://geminicli.com/docs/tools/mcp-server/). |
| **Windsurf / Cascade** | **Yes:** `pre_user_prompt` | **Yes:** `pre_run_command` | **Yes, observational:** `post_cascade_response`, asynchronously after the response. It cannot block completion or force another turn. | Windsurf project `.windsurf/hooks.json`; user `~/.codeium/windsurf/hooks.json`. JSON `hooks` object with event arrays containing `command`, optional `powershell`, `show_output`, and `working_directory`. Current redirected Devin Desktop docs prefer `.devin/hooks.json`, with `.windsurf/hooks.json` as a fallback. | **Yes.** Windsurf documentation identifies `~/.codeium/windsurf/mcp_config.json`, JSON `mcpServers`. Current redirected Devin Desktop docs specify `~/.config/devin/mcp_config.json`, or `$XDG_CONFIG_HOME/devin/mcp_config.json`. **Use the file opened by the installed product’s “Open MCP config file” action.** | **Hooks for automatic save and check; MCP for agent-directed inspection and recovery.** Do not promise automatic agent correction after a failed check. Detect Windsurf versus Devin Desktop before choosing paths. [Hooks](https://docs.windsurf.com/windsurf/cascade/hooks), [Windsurf MCP](https://docs.windsurf.com/windsurf/cascade/mcp), [Current Cascade MCP](https://docs.devin.ai/desktop/cascade/mcp). |
| **Cline** | **Extension documentation: yes**, `UserPromptSubmit`. CLI/SDK plugins expose `beforeRun`, which is a run boundary rather than a universal prompt-submission contract. | **Yes:** extension `PreToolUse`; SDK plugin `beforeTool`. Tool names and argument shapes need surface-specific mapping. | **Extension: do not assume a general stop hook.** Its hook README still labels `TaskComplete` “coming soon.” **CLI/SDK: yes**, plugin `afterRun`; current CLI source also dispatches `agent_end` for completed runs. | Extension: executable, extensionless scripts in `.clinerules/hooks/<Event>` or `~/Documents/Cline/Hooks/<Event>`. Enable Hooks in settings. This is **not** a `hooks.json` system. New CLI/SDK plugins are `.ts`/`.js` modules under `.cline/plugins/` or `~/.cline/plugins/`, exporting `AgentPlugin` with a `hooks` object. Plugins are explicitly not available in the IDE extensions yet. | **Yes.** CLI: `~/.cline/data/settings/cline_mcp_settings.json`, overridable by `CLINE_MCP_SETTINGS_PATH`. Extension: use **MCP Servers → Configure → Configure MCP Servers** to open its actual `cline_mcp_settings.json`. JSON `mcpServers`. It is not VS Code’s normal `settings.json`. | **Extension MVP: MCP plus supported prompt/pre-tool hooks, with end checking described as manual or task-completion-specific.** CLI/SDK can support a dedicated plugin, but its 3-second plugin-hook timeout makes inline verification unsuitable. Do not imply SDK plugin support covers the extension. [Extension hook README](https://github.com/cline/cline/blob/main/.clinerules/hooks/README.md), [Plugins](https://docs.cline.bot/customization/plugins.md), [SDK lifecycle API](https://docs.cline.bot/sdk/plugins), [CLI dispatch source](https://github.com/cline/cline/blob/main/apps/cli/src/utils/hooks.ts), [MCP](https://docs.cline.bot/mcp/mcp-overview.md). |
| **GitHub Copilot agent mode** | **Yes.** Copilot harness: `userPromptSubmitted`, alias `UserPromptSubmit`. VS Code Local harness: `UserPromptSubmit`. | **Yes.** Copilot harness: `preToolUse`, alias `PreToolUse`. Local harness: `PreToolUse`. | **Yes.** Copilot harness: `agentStop`, alias `Stop`. Local harness: `Stop`. Do not substitute `sessionEnd`, which is session termination. | Project `.github/hooks/*.json`. Copilot format: `{"version":1,"hooks":{"preToolUse":[{"type":"command","bash":"…","timeoutSec":30}]}}`. User Copilot hooks: `~/.copilot/hooks/*.json`. VS Code Local native format uses PascalCase events and direct `command` entries without numeric `version`. **The selected harness owns the payload and behavior.** | **Yes.** VS Code workspace `.vscode/mcp.json`, top-level `servers`. Portable Copilot configuration: workspace-root `.mcp.json` or `~/.copilot/mcp-config.json`, top-level `mcpServers`. | **Full hooks plus optional MCP, with the harness named explicitly.** Prefer native configuration instead of relying on cross-tool imports. Local desktop integration first. Cloud hooks run in an ephemeral sandbox, not on the user’s Mac. [VS Code harness guide](https://code.visualstudio.com/docs/agent-customization/hooks), [Copilot hook reference](https://docs.github.com/en/copilot/reference/hooks-reference), [Local hook reference](https://code.visualstudio.com/docs/agents/reference/hooks-reference.md), [MCP configuration](https://code.visualstudio.com/docs/agents/reference/mcp-configuration.md). |
| **Aider** | **No documented native lifecycle hook.** Dirty-file commits are not prompt hooks. | **No documented general pre-shell hook.** | **No general stop hook.** `auto-test` runs after AI edits, not after every turn. Auto-commits offer a Git event boundary. | `.aider.conf.yml` in the home directory, Git root, or current directory. YAML. Relevant settings: `auto-commits`, `dirty-commits`, `auto-test`, `test-cmd`, and `git-commit-verify`. Git hooks use `$GIT_DIR/hooks`, unless `core.hooksPath` changes it. | **No native upstream MCP client support established.** The upstream MCP request remains open. Community servers that expose Aider to another client are the opposite direction from Aider calling Time Machine. No native MCP config path to provide. | **Git-commit-based capture plus optional after-edit checking.** Retain Aider’s auto/dirty commits. A composed `post-commit` hook can checkpoint. `auto-test` can run Time Machine after edits. Neither protects arbitrary risky shell commands. [Git integration](https://aider.chat/docs/git.html), [Lint and test](https://aider.chat/docs/usage/lint-test.html), [YAML config](https://aider.chat/docs/config/aider_conf.html), [Open MCP request](https://github.com/Aider-AI/aider/issues/3314), [Git hooks](https://git-scm.com/docs/githooks). |

### Product/version caveats

- The current Windsurf documentation redirects to Devin Desktop documentation. It changes some paths and distinguishes Cascade from Devin Local. Those are separate integration targets.
- Gemini’s documentation currently carries a notice about some users transitioning to Antigravity CLI. This report covers the requested **Gemini CLI**, not Antigravity.
- Cline’s extension README and current CLI/SDK docs describe different generations of extensibility. The report deliberately preserves that distinction.
- VS Code’s hooks experience is marked Preview. Current documentation distinguishes the Local harness from the Copilot harness.

## Adapter details that matter

### Cursor

Map:

- `beforeSubmitPrompt` → Time Machine `prompt`.
- `beforeShellExecution.command` → `tool_input.command`.
- `stop` → Time Machine `stop`.

Use the workspace root or `CURSOR_PROJECT_DIR` for prompt and stop events. Do not assume those payloads contain Claude’s `cwd`.

For a fresh regression, emit Cursor’s documented JSON:

```json
{"followup_message":"Time Machine regression details"}
```

Use `loop_count` to limit continuation. Return explicit valid permission output for pre-command hooks.

Cursor’s Claude compatibility layer maps hook names and `Bash` to `Shell`. However, Time Machine currently writes only a message to stderr and exits `2` on regression. That is not enough evidence to claim the full Cursor stop behavior works unchanged.

Sources: [Native schemas](https://cursor.com/docs/hooks.md), [Compatibility schemas](https://cursor.com/docs/reference/third-party-hooks.md).

### Codex CLI

This is the closest fit to the existing handler:

- Shell inputs use `tool_input.command`.
- Shared fields include `cwd`.
- Prompt input uses `prompt`.
- Stop input includes `stop_hook_active`.
- Stop can continue the agent using exit `2` with a reason on stderr, or JSON `{"decision":"block","reason":"…"}`.

Do not copy Claude’s `asyncRewake` setting. Codex has its own async hook semantics. A before-command snapshot must complete before the command runs, so it must remain synchronous.

Codex also supports lifecycle handlers that call an already-connected MCP tool. That could invoke `checkpoint`, but Time Machine’s existing MCP tools do not implement its complete regression-comparison and continuation contract. Command hooks are the smaller first integration.

Source: [Codex hooks](https://developers.openai.com/codex/hooks).

### Gemini CLI

Map `BeforeAgent`, `BeforeTool`, and `AfterAgent` onto the three existing semantic events.

An `AfterAgent` hook can request correction with JSON `decision: "deny"` and a reason, or exit `2` with stderr feedback. Preserve the `stop_hook_active` guard.

Use Gemini timeout units. A Claude timeout value of `600` copied literally means **600 milliseconds**, not ten minutes.

Source: [Gemini hook reference](https://geminicli.com/docs/hooks/reference/).

### Windsurf / Cascade

Normalize:

- `tool_info.user_prompt` → prompt.
- `tool_info.command_line` → shell command.
- `tool_info.cwd` → command working directory.

Prompt and response hooks run from the configured workspace context.

`post_cascade_response` is asynchronous. It can save and verify, then publish a real result to Time Machine. It cannot block completion or make Cascade fix the regression. Only pre-hooks can block actions through exit `2`.

Source: [Cascade hooks](https://docs.windsurf.com/windsurf/cascade/hooks).

### Cline

The extension adapter must use its nested inputs, such as `userPromptSubmit` and `preToolUse`, rather than Claude’s input fields. Its documented output is:

```json
{"cancel":false}
```

`contextModification` can add context to a later model request. It is not an end-of-turn continuation mechanism.

The extension hook documentation gives a 30-second execution limit. SDK plugin hooks have a separate 3-second timeout. Neither should silently truncate Time Machine’s potentially longer verification work.

For MCP, use Cline’s own configuration UI to locate extension settings. Portable, remote, and alternate-editor installations can move the storage directory.

Sources: [Extension hooks](https://github.com/cline/cline/blob/main/.clinerules/hooks/README.md), [SDK plugins](https://docs.cline.bot/sdk/plugins), [MCP](https://docs.cline.bot/mcp/mcp-overview.md).

### GitHub Copilot

Prefer one explicitly supported harness first.

For the Copilot harness, PascalCase aliases select snake_case payloads resembling the current Time Machine input. For example, `PreToolUse` reports `tool_input` and Claude-style tool names.

**Important output difference:** Copilot treats stop-hook exit `2` as a warning by default. To require continuation, emit:

```json
{"decision":"block","reason":"Time Machine regression details"}
```

Preserve `stop_hook_active`.

In the VS Code Local harness, tool names and argument shapes differ. Its Claude-format parser also ignores matcher values. Therefore, blindly importing the existing `Bash` matcher is not a sufficient shell filter.

Sources: [Copilot input and output contracts](https://docs.github.com/en/copilot/reference/hooks-reference), [VS Code harness differences](https://code.visualstudio.com/docs/agent-customization/hooks).

### Aider

A practical after-edit configuration can use existing Time Machine commands:

```yaml
auto-test: true
test-cmd: "tm checkpoint --if-changed --trigger aider:after-edit && tm verify"
```

This is a **proposed configuration, not an exercised integration**. Preserve or compose the user’s existing test command.

Important boundaries:

- Checkpoint before verification. `verify` alone does not capture current edits.
- Do not use `tm hook stop` as the test command. Its exit code is about whether to wake an agent, not whether the project passes.
- Aider skips pre-commit hooks by default. `git-commit-verify: true` enables them.
- A `post-commit` hook runs after the commit. It cannot save the pre-edit state or intercept arbitrary shell commands.
- Compose existing Git hooks. Do not replace them.

Sources: [Aider Git integration](https://aider.chat/docs/git.html), [After-edit tests](https://aider.chat/docs/usage/lint-test.html), [Git hook reference](https://git-scm.com/docs/githooks).

## What the current repository can reuse

### Files and responsibilities

| File | Relevant implementation | Reuse and limits |
|---|---|---|
| `packages/core/src/hooks.ts:19-42` | `isRisky(command: string): boolean` and risky-command patterns | Reuse across adapters. It is a heuristic, not complete shell analysis. It does not make external database or deployment actions reversible. |
| `packages/core/src/hooks.ts:44-57` | Input schema and `agent-turn.json` state | Input schema currently accepts only `cwd`, `prompt`, `tool_input.command`, and `stop_hook_active`. Normalize provider payloads before core execution. |
| `packages/core/src/hooks.ts:68-104` | Claude attribution and `runHook(ctx, event, input)` | Reuse checkpoint timing, secret screening, clipped prompt notes, audit events, and unchanged-state skipping. Replace hard-coded `"Claude Code"` and `claude-code:*` triggers before advertising another agent. |
| `packages/core/src/hooks.ts:119-136` | Stop checkpoint, verification, and regression comparison | Reuse the policy: notify only for a new FAIL whose newest earlier checked checkpoint passed. Already-checked and continuation cases avoid repeated waking. |
| `packages/core/src/hooks.ts:149-193` | Desired hooks and installer | Reuse merge/idempotency principles. Paths and configuration shape are specifically `.claude/settings.json`. This is not a general agent installer. |
| `packages/core/src/hooks.ts:212-250` | Pinned `npx` command, command probe, and hook status | Reuse executable discovery concepts. Existing status only checks Claude configuration and whether the command prints the expected version. It does not prove provider trust or actual lifecycle delivery. |
| `packages/cli/src/main.ts:168-185` | CLI hook transport | Reads stdin JSON, calls core, writes messages to stderr, and returns `0` or `2`. `--json` prints internal `HookResult`, **not a provider hook response schema**. |
| `packages/cli/src/mcp.ts:30-72` | Seven MCP tools | Reuse `checkpoint`, `timeline`, `diff`, `verify`, `find_good`, `recover`, and `log` across all MCP-capable clients. |
| `packages/cli/src/mcp.ts:81-143` | MCP initialization, requests, tool calls, stdio loop | Agent-neutral newline-delimited JSON-RPC server. Supports protocol versions `2025-06-18`, `2025-03-26`, and `2024-11-05`. No HTTP transport or lifecycle subscription mechanism is implemented here. |
| `packages/core/src/types.ts:19-22` and `packages/core/src/manifest.ts:20` | Agent metadata | Agent names are strings, not a Claude-only enum. Supporting honest provider attribution does not need a new manifest family. |

### Architecture

```text
Provider hook
  → provider-specific input normalization
  → shared risk/checkpoint/verify/regression logic
  → provider-specific output and continuation response

Provider MCP client
  → tm mcp
  → the same packages/core functions
```

Keep the engine shared. Provider adapters should translate configuration and lifecycle contracts, not duplicate checkpoint or recovery logic.

### Important existing limits

1. **Agent attribution is hard-coded.** Running the current hooks from Cursor or Codex would still label save points as Claude Code.
2. **Turn state is one file per project.** `[INFERENCE]` Concurrent agent sessions can overwrite each other’s stored prompt. Do not claim concurrent multi-agent attribution is supported.
3. **MCP is bound to its startup project context.** Its tools do not accept a project path. Start the server in the intended project directory. Do not invent an unsupported `tm --cwd` option.
4. **MCP does not enforce lifecycle behavior.** Its server instructions advise saving before risky changes, but do not schedule saves or end checks.
5. **A successful MCP response is not necessarily PASS.** A completed `verify` call can return FAIL, INCOMPLETE, BLOCKED, or ERROR. Read the verdict in its result.
6. **The pinned `npx` fallback depends on publishing.** The repo guide says that fallback is unavailable until `timetm` is on npm. This research did not check registry publication.

### Existing tests to extend

- `packages/core/test/agents.test.ts`: installation, risk detection, secret screening, regression waking, duplicate handling.
- `packages/core/test/attribution.test.ts`: agent names and prompt attribution.
- `packages/core/test/desktop-support.test.ts`: turn-start and turn-end audit behavior.
- `packages/core/test/review-fixes.test.ts`: secret handling and stale-prompt cleanup.
- `packages/cli/test/mcp.test.ts`: MCP initialization, tool discovery, tool calls, and malformed input.

These tests were inspected, not run.

## Recommended MVP order

This is a recommendation, not an implementation commitment.

| Order | Target | Why |
|---|---|---|
| **1** | **Cursor native hooks** | Covers the founder’s named audience with all three lifecycle boundaries. Existing Claude import support provides a useful compatibility reference. Native output fixes attribution and continuation ambiguity. |
| **2** | **Codex CLI hooks** | Closest documented payload and stop semantics to the current implementation. Smallest translation layer after shared agent attribution is corrected. |
| **3** | **Gemini CLI hooks** | Complete lifecycle support and close input shape. Main differences are event names and millisecond timeouts. Keep the Gemini versus Antigravity distinction visible. |
| **4** | **GitHub Copilot in one named VS Code harness** | Complete lifecycle support. Requires explicit stop JSON and harness-specific tool handling. Do not silently bundle Local, Copilot, CLI, and cloud as one tested integration. |
| **5** | **Windsurf / Cascade** | Automatic saving and checking are possible. Ship with the honest limit that the asynchronous response hook does not require agent correction. Product path migration needs care. |
| **6** | **Cline** | Offer MCP first. Add extension pre-hooks separately from any CLI/SDK plugin. Do not promise a general extension end-of-turn check until the selected release has that contract. |
| **7** | **Aider** | Offer a documented Git/after-edit workflow. Do not describe it as native lifecycle-hook or MCP support. |

MCP setup documentation can accompany the hook integrations. For clients without a complete hook adapter, label it **“agent-directed tools”**, not **“automatic protection.”**

## Evidence and handoff

- Evidence gathered: primary vendor documentation, upstream source, upstream issue status, and local repository code.
- No builds, tests, agent smoke sessions, installs, or configuration changes were run.
- Before calling an integration supported, the main agent should exercise the three boundaries in the named product version: prompt save, pre-command save ordering, and final checkpoint verification.
- A regression continuation should occur once. Hook failures must not create a false PASS.