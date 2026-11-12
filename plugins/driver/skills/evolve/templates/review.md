# evolve/review.md (you write this one)

Path: `.claude/driver/evolve/review.md`. Read it first if it exists, then Write it. This is a user document: write it entirely in the user's language, headings included. Then show the same text in full as the final message of the turn, with no tool call after it. Keep it compact.

Structure:

1. **Cycle in numbers.** Blocks done, rework rounds, blocks and requirements added after baseline N, backlog items.
2. **Decisions taken by the Autopilot.** Every decision whose title starts with `Autopilot:`, first, one line each with the reason. Write "none" when there are none.
3. **Added after the baseline.** The blocks and requirements with the `+` mark: id, title, why it entered (decision id).
4. **Requirement coverage.** The criterion: each requirement has a passing test or was retired with a decision. A table, one row per requirement: id, evidence (block and test, or decision), status. Failures first.
5. **Backlog for the next cycle.** What `mcp__driver__backlog` returned.
6. **Risks left.** High-risk blocks that were not fully verified, assumptions still open, what the checkpoint found if one ran.
7. **Recommendation.** One of: ready for release; one more round, local; one more round, re-plan. One or two lines of reason.
8. **Your next step.** What to press or type, in order, ending with the line that starts the next phase.

## Worked example (English)

The user wrote `/driver:discover "waitlist page for an app"`. Language: English.

```
# Cycle review

**In numbers.** 12 blocks done, 1 rework round, 2 blocks and 1 requirement after baseline 1, 3 backlog items.

**Autopilot decisions.**
- D-007 Autopilot: compact calculator enters this cycle (fits in one block and invalidates no completed one).

**After the baseline.**
- B-021 Compact calculator (D-007)
- B-022 Calculator test (D-007)
- R-009 Calculate the dose amount

**Coverage.** Every requirement has a passing test or was retired with a decision.

| Requirement | Evidence | Status |
|---|---|---|
| R-001 | B-006 signup test, passed | ok |
| R-009 | B-022 unit test, passed | ok |

**Backlog.** Dark mode; export CSV; invite by link.

**Remaining risks.** No high-risk block without verification.

**Recommendation.** Ready for release: the criterion was met and nothing is left open behind.

**Your next step.** Click Confirm baseline 2 in the pane (or type /driver baseline), then Approve release gate (or /driver approve release). Approving starts the release.
```
