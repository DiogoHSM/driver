# non-goals.md (generated, read-only)

Do not create or edit this file. `driver discover log` regenerates it from `.claude/driver/discover/interview.jsonl`. Add items through the `nonGoals` key of `mcp__driver__discover_log`: `statement`, `reason`, and later `requirement`. The `N-nn` id is assigned automatically.

What it contains, one line per item: `N-nn <statement> (reason) -> R-nnn`. The requirement id appears after the exit batch, when you send `requirement` on the non-goal.

Non-goals are promises: the plan builds and tests none of them. A non-goal the user later wants is not edited away. Retire its requirement with `req.retire` citing a decision, then add a normal requirement.
