#!/usr/bin/env bash
# Stop: typecheck the project, only if a code file changed since the last pass.
# Blocks stopping (exit 2) on errors, at most 3 times in a row to avoid loops.
set -u
cd "${CLAUDE_PROJECT_DIR:?}" || exit 0
pending=.claude/.typecheck-pending; tries=.claude/.typecheck-tries
[ -f "$pending" ] || exit 0
if out=$(node_modules/.bin/tsc --noEmit -p tsconfig.json 2>&1); then rm -f "$pending" "$tries"; exit 0; fi
n=$(( $(cat "$tries" 2>/dev/null || echo 0) + 1 )); echo $n > "$tries"
if [ $n -gt 3 ]; then
  rm -f "$pending" "$tries"
  echo '{"systemMessage":"typecheck still failing after 3 attempts — check manually"}'; exit 0
fi
{ echo "Typecheck failed (attempt $n/3) — fix before finishing:"; echo "$out" | grep -E 'error|\.tsx?[:(]' | head -30; } >&2
exit 2
