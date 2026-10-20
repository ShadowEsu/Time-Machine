# Publish `timetm` to npm (for Preston)

The package is ready. Publishing is one command once your npm account has two factor turned on. Agents never publish. Only you do.

**Status on 19 October 2026: not published.** `timetm` is not on npm. The account exists (`npm login` as prestonsusanto worked), but `npm publish` returned E403 because two factor is not turned on for publishing. Turning it on (section 1, item 3) is the only blocker.

Checked on 17 October 2026 on this Mac: `npm pack` makes 4 files (`LICENSE`, `README.md`, `dist/tm.js`, `package.json`), 151.9 kB. Installed from that tarball in an empty folder with a fresh home folder, `tm --version` printed `0.1.0`, `tm --help` worked, and `npx timetm demo` ran the full rescue (cp-0003 PASS, recovery branch made). Since 19 October, CI also runs the package check from step 3 on every push and pull request.

## 1. Make the npm account (once, about 5 minutes)

1. Go to https://www.npmjs.com/signup and create an account. Use an email you read.
2. Verify the email from npm's message.
3. Turn on two factor: avatar > Account > Two-Factor Authentication > "Authorization and publishing". Use an authenticator app.

## 2. Check the name is still free

```sh
npm view timetm
```

A `404 Not Found` means it is free. If it shows a package, stop and tell the agent. Do not publish under another name without a decision.

## 3. Build and test the exact code you publish

```sh
cd ~/projects/Time-Machine
git switch main
git pull
pnpm install --frozen-lockfile
pnpm test
pnpm build
node scripts/check-cli-package.mjs
```

Every test must pass (2 are skipped on macOS; they run only on Linux).

`scripts/check-cli-package.mjs` checks the package exactly as `npm publish` would ship it. It runs `npm pack` into a temporary folder and fails unless the tarball holds exactly these 4 files: `LICENSE`, `README.md`, `dist/tm.js`, `package.json`. It also fails if the packed name or version differs from `packages/cli/package.json`. Then it unpacks the tarball outside the repo, so there is no `node_modules` to fall back on, and runs the bundled `tm --version` (must print the package version) and `tm --help`. It prints `check-cli-package: timetm-0.1.0.tgz ok (...)` on success and removes its temporary folder either way. Do not publish if it fails.

## 4. Log in and look before you publish

```sh
npm login
cd packages/cli
npm publish --dry-run
```

The dry run must list exactly 4 files: `LICENSE`, `README.md`, `dist/tm.js`, `package.json`, about 152 kB. Name `timetm`, version `0.1.0`.

## 5. Publish (the one command)

```sh
npm publish --access public
```

npm asks for your two factor code. That is it.

## 6. Check it worked

In a new terminal:

```sh
cd "$(mktemp -d)"
npx timetm@0.1.0 --version   # prints 0.1.0
npx timetm@0.1.0 demo        # breaks and rescues a demo project
```

Also open https://www.npmjs.com/package/timetm.

## 7. Then tell the agent (BOSS or the Time Machine pane)

The agent updates everything that says "not on npm yet": the site status line and FAQ, `README.md`, `docs/GUIDE.md`, `docs/PLAN.md`, and the hook fallback note. Then it redeploys the site. After that, the waitlist gets its first real email: "it is on npm".

## If something goes wrong

- **`E403` or "You do not have permission":** the name was taken in the meantime, or two factor is not set for publishing. Do not retry under a new name; tell the agent.
- **Published a broken version:** within 72 hours, `npm unpublish timetm@0.1.0` works. After that, publish `0.1.1` with the fix and run `npm deprecate timetm@0.1.0 "Use 0.1.1"`.
- **Never** paste your npm password or token into a chat or a file in the repo.
