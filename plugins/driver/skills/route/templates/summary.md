# route/summary.md (you write this one)

If `.claude/driver/route/summary.md` exists, Read it first, then Write it. Then show the same text in full as the final message of the turn, with no tool call after it. This is a user document: write it entirely in the user's language, headings included. Keep it compact.

Structure:

1. One line: the list below is the plan, and the DRIVER pane shows the same graph when it is open.
2. Blocks grouped by phase: id, title, depends on, risk. Mark blocks that can run in parallel.
3. Block count against the class range (implement and validate blocks only).
4. The critical path.
5. High-risk blocks with their mitigation in a few words.
6. Closing line: reply "ok" to confirm, or say what to change (blocks, order, split).

## Worked example (English)

The user wrote `/driver:discover "waitlist page for an app"`. Language: English.

```
# Block plan

The list below is the plan; the DRIVER pane shows the same graph when it is open.

**Implement**
- B-003 Waitlist table (depends on: B-002) | low risk | parallel with B-004
- B-004 Signup API (depends on: B-003) | medium risk
- B-005 Landing page (depends on: B-002) | low risk | parallel with B-003

**Validate**
- B-006 API tests (depends on: B-004) | low risk
- B-007 Visual review of the page (depends on: B-005) | low risk

**Blocks:** 5 in implement and validate, within the 4 to 8 range of class S.
**Critical path:** B-002, B-003, B-004, B-006.
**High risk:** none.

Reply "ok" to confirm, or say what to change (blocks, order, split).
```
