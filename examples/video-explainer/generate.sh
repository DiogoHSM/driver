#!/usr/bin/env bash
# Regenerates this example with the real DRIVER CLI and fixed timestamps.
# Usage: bash examples/video-explainer/generate.sh   (after `npm run build` in plugins/driver)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CLI="$HERE/../../plugins/driver/dist/cli.js"
rm -rf "$HERE/.claude" "$HERE/docs"

NOW=2026-10-24T09:00:00Z
ACTOR=model:orchestrator
d() { node "$CLI" --cwd "$HERE" --root "$HERE" --actor "$ACTOR" --now "$NOW" "$@" >/dev/null; }
# Handoff is the last section of a fresh block doc, so appending fills it (required for in_review).
handoff() { printf '%s\n' "$2" >> "$HERE/.claude/driver/blocks/$1.md"; }
# Gate approval needs a typed "yes" on a terminal, so run it on a pty with expect (as the user would).
EXP="$(mktemp)"; trap 'rm -f "$EXP"' EXIT
cat > "$EXP" <<'TCL'
set timeout 20
spawn -noecho {*}$argv
expect "confirm:"
send "yes\r"
expect eof
lassign [wait] pid spawnid os code
exit $code
TCL
approve() { expect "$EXP" node "$CLI" --cwd "$HERE" --root "$HERE" --actor user:diogo --now "$NOW" gate approve "$1" >/dev/null; }
as_user() { local prev=$ACTOR; ACTOR=user:diogo; "$@"; ACTOR=$prev; }

d init video-explainer --packs driver-video

d req add "Video explains the product in under 90 seconds" --kind functional --source user
d req add "Narration is voiced and captioned" --kind functional --source user

d block add "Creative brief" --phase discover
d block add "Storyboard" --phase route --depends B-001
d block add "Scene composition" --phase implement --depends B-002 --req R-001 \
  --provider video-composition:hyperframes:cli
d block add "Narration voiceover" --phase implement --depends B-002 --req R-002 \
  --provider text-to-speech:elevenlabs:api --credentials ELEVENLABS_API_KEY
d block add "Render check" --phase validate --depends B-003,B-004

NOW=2026-10-24T10:00:00Z
d block status B-001 in_progress
d block set B-001 --add-artifact .claude/driver/discover/brief.md
handoff B-001 "Delivered; see artifacts listed in plan.json."
d block status B-001 in_review
as_user d block set B-001 --verified true
d block status B-001 done

NOW=2026-10-24T11:00:00Z
approve route
d phase advance

d block status B-002 in_progress

d export mermaid --out docs/plan.mmd
node "$CLI" --cwd "$HERE" --root "$HERE" validate --replay
