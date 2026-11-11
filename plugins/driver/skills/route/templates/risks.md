# Risks and definition of done

## Risk matrix

Likelihood and impact use L (low), M (medium), H (high). One row per risk. A `high` block has at least one row. The owner block is the one that mitigates the risk.

| block | risk | likelihood | impact | mitigation | owner block |
|---|---|---|---|---|---|
| B-004 | Duplicate sign-ups under concurrent requests | M | M | Unique index on email, insert with conflict handling | B-004 |
| B-005 | Confirmation email provider rejects the sender domain | M | H | Verify the domain before release, fall back to a plain log in dev | B-009 |
| B-008 | Rests on assumption A-03 (Supabase for storage) | L | H | Confirm A-03 with the user before B-004 starts | B-002 |
| B-010 | Production deploy exposes service keys | L | H | Env vars set in the host dashboard only, secret scan in the validate block | B-009 |

## Definition of done per phase

| Phase | Done when |
|---|---|
| discover | Requirements, assumptions and non-goals are written, the user accepted the summary, the route gate is approved. |
| route | Every non-goal-free requirement has an implement and a validate block, `driver validate` shows no `req.coverage` warning, the user replied confirming the block list. |
| implement | Every implement block is `done` with artifacts, a Handoff and its acceptance criteria met. |
| validate | Every validate block is `done` with test results recorded against the requirements, and no open `needs_rework`. |
| evolve | The Evolve review block records what changed, what was learned and whether a replan is needed. |
| release | The release checklist passed, the release gate is approved by the user, the release is recorded. |

Adapt the rows to the domain: replace test layers with the checks that fit (visual review for a deck, a data check for a spreadsheet). Keep the table headers in English.
