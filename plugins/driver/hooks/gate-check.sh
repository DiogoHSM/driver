#!/usr/bin/env bash
# DRIVER gate check (PreToolUse on Agent|Task|Workflow|SendMessage). Pure bash + jq: no node needed.
# No plan.json -> allow (project does not use DRIVER). Plan present but unreadable -> deny.
# Same semantics as `driver hook gate-check` (src/hooks.ts).
set -u

deny() {
  printf '%s\n' "$1" | jq -Rn '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:input}}' 2>/dev/null ||
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"DRIVER: gate check failed"}}\n'
  exit 0
}

input=$(cat)
have_jq=1
command -v jq >/dev/null 2>&1 || have_jq=0

cwd=""
if [ "$have_jq" = 1 ]; then
  cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null) || cwd=""
fi
[ -n "$cwd" ] || cwd=$PWD

# DRIVER_ROOT, then the main worktree (linked worktrees hold a stale committed copy), then cwd.
# Main worktree = first non-bare entry of `git worktree list --porcelain`.
main=$(git -C "$cwd" worktree list --porcelain 2>/dev/null | awk '
  /^worktree / { p = substr($0, 10) }
  /^bare$/     { p = "" }
  /^$/         { if (p != "" && !done) { print p; done = 1 } }
  END          { if (p != "" && !done) print p }') || main=""
# in a submodule the list reports the gitdir under .git/modules/, not a working tree
case "$main" in */.git/modules/*) main="" ;; esac
[ -n "$main" ] || main=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || main=""
plan=""
for root in "${DRIVER_ROOT:-}" "$main" "$cwd"; do
  if [ -n "$root" ] && [ -f "$root/.claude/driver/plan.json" ]; then plan="$root/.claude/driver/plan.json"; break; fi
done
[ -n "$plan" ] || exit 0

[ "$have_jq" = 1 ] || deny "DRIVER: jq is not installed; cannot verify gates (fail closed)."
printf '%s' "$input" | jq -e 'type == "object"' >/dev/null 2>&1 ||
  deny "DRIVER: hook input is not valid JSON; refusing (fail closed)."

prompt=$(printf '%s' "$input" | jq -r '(.tool_input.prompt // .tool_input.description // .tool_input.message // "") | tostring')
block=""
if [[ $prompt =~ DRIVER-BLOCK:[[:space:]]*(B-[0-9]+) ]]; then block=${BASH_REMATCH[1]}; fi

verdict=$(jq -r --arg b "$block" '
  (if $b != "" and (.blocks[$b] | type) == "object" then .blocks[$b].phase else .currentPhase end) as $ph
  | (if $b != "" and (.blocks[$b] | type) == "object" then "block \($b) (\($ph))" else "current phase (\($ph))" end) as $where
  | if $ph != "discover" and (.gates.route.approved != true)
      then "DRIVER: gate route is not approved; \($where) cannot run agents. Ask the user to run, in their own terminal: driver gate approve route"
    elif $ph == "release" and (.gates.release.approved != true)
      then "DRIVER: gate release is not approved; \($where) cannot run agents. Ask the user to run, in their own terminal: driver gate approve release"
    else "" end' "$plan" 2>/dev/null) || deny "DRIVER: plan.json is unreadable; refusing to run agents (fail closed)."

[ -z "$verdict" ] || deny "$verdict"
exit 0
