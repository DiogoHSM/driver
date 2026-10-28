#!/usr/bin/env bash
# Regenerates this example with the real DRIVER CLI and fixed timestamps.
# Usage: bash examples/web-waitlist/generate.sh   (after `npm run build` in plugins/driver)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CLI="$HERE/../../plugins/driver/dist/cli.js"
rm -rf "$HERE/.claude" "$HERE/docs"

NOW=2026-10-20T09:00:00Z
ACTOR=model:orchestrator
# --root stops the CLI from resolving the enclosing git repo; the example is its own project.
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

d init web-waitlist --packs driver-web

d req add "Visitors can join the waitlist with an email" --kind functional --source user
d req add "Confirmation email is sent after signup" --kind functional --source user
d req add "Signup flow works end to end on mobile" --kind nonfunctional --source assumed --ref discover/assumptions.md

d block add "Discovery interview" --phase discover
d block add "Plan and gate 1" --phase route --depends B-001
d block add "Landing page UI" --phase implement --depends B-002 --req R-001
d block add "Signup API" --phase implement --depends B-003 --req R-001 \
  --provider database:supabase:cli --credentials SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY --risk medium
d block add "Confirmation email" --phase implement --depends B-003 --req R-002 \
  --provider transactional-email:resend:api --credentials RESEND_API_KEY
d block add "E2E signup check" --phase validate --depends B-004,B-005 --req R-003
d block add "Evolve review" --phase evolve --depends B-006
d block add "Deploy to Vercel" --phase release --depends B-007 \
  --provider hosting:vercel:cli --credentials VERCEL_TOKEN

# Discover
NOW=2026-10-20T10:00:00Z
d block status B-001 in_progress
d block set B-001 --add-artifact .claude/driver/discover/interview.md
handoff B-001 "Delivered; see artifacts listed in plan.json."
d block status B-001 in_review
as_user d block set B-001 --verified true
d block status B-001 done

# Gate 1
NOW=2026-10-21T10:00:00Z
approve route
d phase advance

# Route
d block status B-002 in_progress
d block set B-002 --add-artifact .claude/driver/plan.json
handoff B-002 "Delivered; see artifacts listed in plan.json."
d block status B-002 in_review
as_user d block set B-002 --verified true
d block status B-002 done
d phase advance

# Implement
NOW=2026-10-22T09:00:00Z
d block status B-003 in_progress
d block set B-003 --add-artifact src/app/page.tsx --test test/landing.test.ts:unit:pass
handoff B-003 "Delivered; see artifacts listed in plan.json."
d block status B-003 in_review
as_user d block set B-003 --verified true
d block status B-003 done

NOW=2026-10-23T09:00:00Z
d block status B-004 in_progress
d block set B-004 --add-artifact supabase/migrations/001_waitlist.sql,src/app/api/signup/route.ts \
  --test test/signup.test.ts:integration:pass
handoff B-004 "Delivered; see artifacts listed in plan.json."
d block status B-004 in_review

d block status B-005 in_progress
d block status B-005 blocked --reason "Waiting for RESEND_API_KEY (Resend domain verification pending)"

# Mermaid diagram next to the driver dir (exports/ is gitignored by init)
d export mermaid --out docs/plan.mmd
node "$CLI" --cwd "$HERE" --root "$HERE" validate --replay
