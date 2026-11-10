# Assumptions

Each assumption is a premise the project rests on that the user did not state. The log is a contract: the user reviews it at the play back, and Route marks blocks that depend on an assumption as high risk.

## A-01 The project targets a single language (English)

- Why assumed: the user answered "Not sure" and the brief is in English
- Source node: Q-06
- Accepted: pending
- Requirement: R-004

## A-03 Sign-ups are stored in a Supabase table

- Why assumed: the user answered "Not sure"; Supabase credentials already exist in the environment
- Source node: Q-04
- Accepted: yes
- Requirement: R-006

Rules:

- Number `A-nn` in creation order. Never renumber.
- `Accepted` is `pending` until the user confirms it at the play back, then `yes`. A rejected assumption becomes a question again (reopen its node).
- `Requirement` is filled in at the exit, after `req.add` returns the ids. Before that, write `-`.
