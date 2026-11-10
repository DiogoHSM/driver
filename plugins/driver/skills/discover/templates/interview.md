---
class: S
domain: web
round: 1
language: en
status: open
reclassified: no
checkpoint: none
batch-applied: -
---

# Discovery interview

Goal: <one sentence, the user's words>

## Decision tree

| id | question | dependsOn | kind | status | answer | source |
|---|---|---|---|---|---|---|
| Q-01 | What kind of deliverable is this? | - | decision | settled | Web app | user |
| Q-02 | How much effort do you estimate? | - | decision | settled | A few days (class S) | user |
| Q-03 | Which framework does the repo use? | - | fact | settled | Next.js 15 (package.json) | research |
| Q-04 | Where are sign-up emails stored? | Q-01 | decision | assumed | Supabase table (A-03) | assumed |
| Q-05 | Is a confirmation email needed? | Q-01 | decision | open | | |

Columns:

- `id`: `Q-nn`, numbered in the order the node was created. Never renumber.
- `dependsOn`: node ids this node needs settled first, or `-`.
- `kind`: `fact` (answerable without the user's preference) or `decision`.
- `status`: `open`, `researching`, `settled`, `assumed`, `deferred`.
- `source`: `user`, `research` or `assumed`.

Frontmatter fields that must survive compaction:

- `reclassified`: `no` until the single reclassification question (end of round 1) is asked, then `yes`. Update it at once.
- `checkpoint`: `none`, `pre-mortem`, `red-team`, `socratic` or `skipped`. Update it as soon as the user answers the checkpoint question.
- `batch-applied`: `-` until the exit batch runs. After each successful `plan_ops` call, replace it with the ids from the result, for example `batch-applied: R-001..R-012, D-001`. On resume or rework, add only requirements that are not yet in the plan.

## Rounds

### Round 1: context and breadth

**Q-01** (2026-10-30T10:02:00Z)
Question: What kind of deliverable is this?
Options shown: Web app (Recommended) / Document or deck / Data or automation / Not sure
Answer: Web app

**Q-02** (2026-10-30T10:02:00Z)
Question: How much effort do you estimate?
Options shown: An afternoon / A few days (Recommended) / A few weeks / Months or a team
Answer: A few days
