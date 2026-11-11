# interview.md (generated, read-only)

Do not create or edit this file. `driver discover log` regenerates it from `.claude/driver/discover/interview.jsonl` after every call to `mcp__driver__discover_log`. Read it to resume or to review.

What it contains:

- Frontmatter from `meta`: `class`, `domain`, `language`, `stage` (core, areas, summary, closed), `areas`, `chosenAreas`, `checkpoint`, `accepted`, `batchApplied`.
- The goal, in the user's words.
- A decision tree table, one row per node: `id` (Q-nn), `question`, `area` ("core" or an area name), `dependsOn`, `kind` (fact or decision), `status` (open, researching, settled, assumed, deferred), `answer`, `source` (user, research, assumed), and the requirement id once the exit batch has run.
- The frontier: open nodes whose dependencies are all settled or assumed.

To change anything, call the tool with the node `id` and the new fields. Never use `sed`, shell redirection or heredocs on it.
