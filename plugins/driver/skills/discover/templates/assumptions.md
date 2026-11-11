# assumptions.md (generated, read-only)

Do not create or edit this file. `driver discover log` regenerates it from `.claude/driver/discover/interview.jsonl`. A node becomes an assumption when you log it with `status: "assumed"`, `source: "assumed"`, an `answer` (the choice) and a `why` (one line). The `A-nn` id is assigned automatically.

What it contains, one entry per assumption:

- `A-nn` and the choice made.
- Why it was assumed (the `why` field).
- The source node (`Q-nn`) and its area.
- The requirement id (`R-nnn`), once the exit batch has run and you sent `requirement` on the node.

The user reviews the same list, grouped by area, in the summary. Route marks blocks that depend on an assumption as high risk.
