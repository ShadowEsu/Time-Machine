---
name: setup
description: Set up Time Machine save points in the current project. Use when the user asks to set up, enable or turn on Time Machine (tm) for this project.
---

# Set up Time Machine in this project

The Time Machine plugin already provides the Claude Code hooks and the MCP server. They act only in a project whose check the user approved with `tm init` on this computer. A `timemachine.yml` that came with the repo is not enough. This skill creates the file if needed, confirms the check with the user, and records the approval.

Follow these steps in order. Run the commands from the project folder.

## 1. Check that `tm` is installed

Run `command -v tm && tm --version`.

If `tm` is not found, stop here. Tell the user the plugin needs the `tm` command, and point them to the install guide: https://time-machine.company/install.md (if their network blocks that address, the same guide is at https://time-machine-site.vercel.app/install.md). Do not install it yourself unless the user asks.

## 2. Check that this is a Git project

Run `git rev-parse --show-toplevel`. Time Machine needs a Git repository with at least one commit. If there is none, tell the user and ask before running `git init` or making a commit.

## 3. Ask tm what is missing

Run `tm status --json`. It prints `initialized`, `approved` and `check`, and changes nothing. Tell the user in one plain line what you found:

- `initialized` is false: "tm is installed but this project isn't set up (no timemachine.yml)." Go to step 4.
- `check` is null: "This project is set up, but it has no check yet (verify.command is empty)." Go to step 5.
- `approved` is false: "This project is set up, but the check isn't approved on this computer." Go to step 5.
- `approved` is true: "Time Machine is already set up here. The check is approved on this computer." Show the `check` and stop, unless the user wants to change it.

If `tm` says `status` is an unknown command, this `tm` is older. Go on with step 4.

## 4. Create timemachine.yml if there is none

If `timemachine.yml` already exists at the Git root (for example it came with the repo), leave it as it is and go to step 5.

Otherwise run `tm init --no-approve`. It writes `timemachine.yml` with a guessed check (for example `npm test`) and install step (for example `npm ci`), and approves nothing, so the plugin does not run the guess yet. If it finds no test command, it says so and leaves `verify.command` empty.

## 5. Confirm the check with the user

Show the user the `verify` section of `timemachine.yml`: `verify.command`, `verify.setup` if present, and `verify.network`. Say that Time Machine will run them on this computer at the end of each Claude turn. Ask the user to confirm that `verify.command` is the command that tells them the project works, and that the commands are safe to run. If they want a different command, edit `verify.command` in `timemachine.yml` to what they say. If `verify.command` is empty, ask the user which command tells them the project works and set it. Without one, save points can't be checked and the plugin stays off here. Do not guess further. If the user does not confirm, stop here.

## 6. Approve the check

After the user confirmed, run `tm init` (without `--no-approve`). It keeps the file as it is and records the approval of the check now in the file, outside the project. Show the user the `Approved` line it prints. If `timemachine.yml` changes later, run `tm init` again only after the user confirms the new check.

## 7. Optional: the demo

Run `tm demo` only if the user asks for it. It builds a small synthetic project in a temporary folder and does not touch this project.

## Never do this

- Never run `tm hook install`. The plugin already provides the hooks. If a project also has hooks from `tm hook install`, the plugin steps aside there, so nothing saves twice.
- Never run `tm init` without `--no-approve` before the user confirmed the check.
- Never run destructive commands, `tm recover`, or anything that changes the user's branch as part of setup.

## When you are done

Tell the user that from now on Time Machine saves before each prompt and before risky shell commands in this project, and checks the project when Claude stops. Tell them each save point keeps the first 120 characters of their prompt, on this computer: Time Machine uploads it nowhere, and Ask in `tm ui`, if they turn it on, sends it and says so first. Before a risky command it shows one line, for example "Time Machine saved cp-0007 before git reset --hard." Save points are listed with `tm timeline`.
