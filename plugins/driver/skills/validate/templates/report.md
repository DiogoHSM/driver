# Validation report: B-015 Waitlist end to end

Written by the Validate skill into `.claude/driver/validate/B-015.md`. Headings stay in English; the text is in the user's language. Read the file first if it exists, then rewrite it.

## Verdict

pass | fail | partial. One sentence: what the user can rely on now and what they cannot.

## Scope

- Validate block: B-015. Checks the output of: B-004, B-005, B-009.
- Requirements: R-001, R-003.
- Build or commit checked (short hash, or the file version) and the date.
- Not run, and why (missing service, missing credential by variable name only, out of scope).

## Layers run

| Layer | What ran (command or step) | Result | Evidence |
|---|---|---|---|
| unit | `npm test` | pass | 42 passed, 0 failed |
| e2e | `npm run test:e2e -- waitlist` | fail | step 4: duplicate email returns 500 |
| visual | Opened `/` at 375 px and 1280 px | pass | no overflow, form visible |

`Layer` is one of unit, integration, e2e, visual, perf, security, acceptance, manual. `Result` is pass, fail or unknown, the same value recorded with `addTests`.

## Requirements

One row per requirement, checked against its Acceptance signal in `requirements/R-nnn.md`.

| Requirement | Acceptance signal | Observed | Result |
|---|---|---|---|
| R-001 | A visitor joins with an email and sees a confirmation | Joined with a test address, banner shown | pass |
| R-003 | A repeated email is not stored twice | Second post returned 500, row count 1 | fail |

## Block criteria

| Block | Criterion | Observed | Result |
|---|---|---|---|
| B-004 | The same email posted twice returns 200 and one row remains | Returns 500 | fail |

## Findings

One entry per finding. One finding, one decision.

### F-1 Duplicate email returns 500

- Severity: high | medium | low.
- Evidence: command, output excerpt, file and line.
- Owner block: B-004 (the block whose criterion fails).
- Triage level: 1 (fix) | 2 (adjustment) | 3 (scope change), with the one-line reason.
- Action taken: B-004 to `needs_rework` and B-015 blocked with `waiting on B-004`; or decision D-nnn and new block B-nnn; or a backlog entry for the next cycle.

## Recheck

Added by `driver:validate recheck`, never replacing the findings above.

- Date, and what the fix changed.
- Rerun: the checks tied to the reworked block and its requirements, plus the fast regression suite.
- Not rerun, and why.
- Verdict after the recheck.

The plan keeps one test record per `ref`, the latest result. Earlier results and their history live here.

## Residual risk

What passed but remains uncertain: sampling limits, untested environments, assumptions (A-nn) the result rests on. Write "none" only when truly nothing.
