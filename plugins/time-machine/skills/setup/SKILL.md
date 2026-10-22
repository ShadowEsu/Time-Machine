---
name: setup
description: Set up Time Machine save points in the current project. Use when the user asks to set up, enable or turn on Time Machine (tm) for this project.
---

# Set up Time Machine in this project

The Time Machine plugin already provides the Claude Code hooks and the MCP server. They act only in a project that has `timemachine.yml` at its Git root. This skill creates that file.

Follow these steps in order. Run the commands from the project folder.

## 1. Check that `tm` is installed

Run `command -v tm && tm --version`.

If `tm` is not found, stop here. Tell the user the plugin needs the `tm` command, and point them to the install guide: https://time-machine-site.vercel.app/install.md. Do not install it yourself unless the user asks.

## 2. Check that this is a Git project

Run `git rev-parse --show-toplevel`. Time Machine needs a Git repository with at least one commit. If there is none, tell the user and ask before running `git init` or making a commit.

## 3. Create timemachine.yml

Run `tm init`. It writes `timemachine.yml` at the Git root with a guessed check (for example `npm test`) and install step (for example `npm ci`). It keeps an existing file.

## 4. Confirm the check with the user

Show the user the `verify` section of `timemachine.yml`: `verify.command` and, if present, `verify.setup`. Ask the user to confirm that `verify.command` is the command that tells them the project works. If they want a different command, edit `verify.command` in `timemachine.yml` to what they say. Do not guess further.

## 5. Look for hooks from an earlier `tm hook install`

If `.claude/settings.json` in this project has commands ending in `hook prompt`, `hook pre-bash` or `hook stop`, Time Machine hooks were installed there before. With the plugin enabled, each would run twice. Tell the user, and ask before removing those lines.

## 6. Optional: the demo

Run `tm demo` only if the user asks for it. It builds a small synthetic project in a temporary folder and does not touch this project.

## Never do this

- Never run `tm hook install`. The plugin already provides the hooks, so installing them again in `.claude/settings.json` would make every save point twice.
- Never run destructive commands, `tm recover`, or anything that changes the user's branch as part of setup.

## When you are done

Tell the user that from now on Time Machine saves before each prompt and before risky shell commands in this project, and checks the project when Claude stops. Save points are listed with `tm timeline`.
