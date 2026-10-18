#!/usr/bin/env bash
# Times a stranger's first run: init -> save -> an agent breaks it -> find-good -> recover.
# Uses the packed npm package, a fresh HOME, an empty npm cache and a real public repo.
# Usage: scripts/time-first-run.sh [repo-url]   (default: sindresorhus/slugify)
# Run from the repo root after `pnpm build`. Network is needed for the clone and npm install.
set -u
REPO=${1:-https://github.com/sindresorhus/slugify.git}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d "${TMPDIR:-/tmp}/tm-first-run.XXXX")
(cd "$ROOT/packages/cli" && npm pack --pack-destination "$T" >/dev/null 2>&1) || { echo "npm pack failed"; exit 1; }
TB=$(ls "$T"/timetm-*.tgz)
export HOME=$T/home TM_HOME=$T/home/.timemachine npm_config_cache=$T/npm-cache
mkdir -p "$HOME"
git config --global user.email synthetic@example.test
git config --global user.name Synthetic
git config --global init.defaultBranch main
now() { python3 -c 'import time; print(time.time())'; }
lap() { printf "%-22s %6.1f s  exit %s\n" "$1" "$(python3 -c "print($(now) - $S)")" "$2"; }

git clone -q --depth 1 "$REPO" "$T/app" || exit 1
cd "$T/app"
tm() { npx --yes --package "$TB" -- tm "$@"; }
START=$(now)
S=$(now); tm init >"$T/init.txt" 2>&1; lap "init" $?; sed 's/^/    /' "$T/init.txt"
S=$(now); tm checkpoint -m "works" >/dev/null 2>&1; lap "checkpoint" $?
# An agent breaks the entry file.
MAIN=$(node -e 'const p=require("./package.json"); console.log((typeof p.exports === "string" && p.exports) || p.main || "index.js")')
echo 'throw new Error("an agent broke this");' >>"$MAIN"
S=$(now); tm checkpoint -m "Agent: refactor" >/dev/null 2>&1; lap "checkpoint (broken)" $?
S=$(now); tm find-good >"$T/find.txt" 2>&1; lap "find-good" $?; sed 's/^/    /' "$T/find.txt"
GOOD=$(grep -o 'cp-[0-9]*' "$T/find.txt" | tail -1)
S=$(now); tm recover "$GOOD" >"$T/recover.txt" 2>&1; lap "recover $GOOD" $?; sed -n '1,5p' "$T/recover.txt" | sed 's/^/    /'
printf "TOTAL init to recovery branch: %.1f s\n" "$(python3 -c "print($(now) - $START)")"
echo "Work folder: $T"
