---
name: setup
description: Set up Time Machine save points in the current project. Use when the user asks to set up, enable or turn on Time Machine (tm) for this project.
---

# Set up Time Machine in this project

The Time Machine plugin already provides the Claude Code hooks and the MCP server. They act only in a project whose check the user approved with `tm init` on this computer. A `timemachine.yml` that came with the repo is not enough. This skill creates the file if needed, confirms the check with the user, and records the approval.

Follow these steps in order. Run the commands from the project folder.

## 1. Check that `tm` is installed

Run `command -v tm && tm --version`.

If `tm` is not found, stop here. Tell the user the plugin needs the `tm` command, and point them to the install guide: https://time-machine-site.vercel.app/install.md. Do not install it yourself unless the user asks.

## 2. Check that this is a Git project

Run `git rev-parse --show-toplevel`. Time Machine needs a Git repository with at least one commit. If there is none, tell the user and ask before running `git init` or making a commit.

## 3. Create timemachine.yml if there is none

If `timemachine.yml` already exists at the Git root (for example it came with the repo), leave it as it is and go to step 4.

Otherwise run `tm init --no-approve`. It writes `timemachine.yml` with a guessed check (for example `npm test`) and install step (for example `npm ci`), and approves nothing, so the plugin does not run the guess yet.

## 4. Confirm the check with the user

Show the user the `verify` section of `timemachine.yml`: `verify.command`, `verify.setup` if present, and `verify.network`. Say that Time Machine will run them on this computer at the end of each Claude turn. Ask the user to confirm that `verify.command` is the command that tells them the project works, and that the commands are safe to run. If they want a different command, edit `verify.command` in `timemachine.yml` to what they say. Do not guess further. If the user does not confirm, stop here.

## 5. Approve the check

After the user confirmed, run `tm init` (without `--no-approve`). It keeps the file as it is and records the approval of the check now in the file, outside the project. Show the user the `Approved` line it prints. If `timemachine.yml` changes later, run `tm init` again only after the user confirms the new check.

## 6. Optional: the demo

Run `tm demo` only if the user asks for it. It builds a small synthetic project in a temporary folder and does not touch this project.

## Never do this

- Never run `tm hook install`. The plugin already provides the hooks. If a project also has hooks from `tm hook install`, the plugin steps aside there, so nothing saves twice.
- Never run `tm init` without `--no-approve` before the user confirmed the check.
- Never run destructive commands, `tm recover`, or anything that changes the user's branch as part of setup.

## When you are done

Tell the user that from now on Time Machine saves before each prompt and before risky shell commands in this project, and checks the project when Claude stops. Save points are listed with `tm timeline`.
