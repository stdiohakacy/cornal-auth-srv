#!/usr/bin/env bash
# PostToolUse (Edit|Write|MultiEdit): format + lint only the edited file, errors only.
# Silent on success (0 tokens). On error: exit 2 so Claude sees it and fixes it.
set -u
cd "${CLAUDE_PROJECT_DIR:?}" || exit 0
f=$(jq -r '.tool_input.file_path // empty')
case "$f" in *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs) ;; *) exit 0 ;; esac
case "$f" in "$PWD"/*) ;; *) exit 0 ;; esac
case "$f" in */node_modules/*|*/.claude/*|*/.next/*|*/dist/*) exit 0 ;; esac
[ -f "$f" ] || exit 0
touch .claude/.typecheck-pending
node_modules/.bin/prettier --write --log-level=silent "$f" >/dev/null 2>&1 || true
out=$(node_modules/.bin/oxlint --quiet --type-aware "$f" 2>&1) && exit 0
{ echo "Lint errors in ${f#$PWD/} — fix them:"; echo "$out" | grep -v '^\s*$' | head -40; } >&2
exit 2
