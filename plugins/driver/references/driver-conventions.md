# DRIVER conventions (shared by the phase skills)

Read this whole file before you touch the plan. It holds the tools, the reducer rules, the file formats and the hard rules. The phase skills (`discover`, `route`) assume you know it.

DRIVER is a method with six phases: Discover, Route, Implement, Validate, Evolve, Release. The plan is a graph of blocks stored in `.claude/driver/`. Two human gates guard it. The `route` gate sits between Discover and Route: the user approves it after Discover, and Route then advances to Implement without a gate. The `release` gate sits between Evolve and Release. Only the user can approve a gate.

## 1. Where things live

Project root `.claude/driver/` (the "driver dir"). **Artifact paths are relative to the project root.** Discover artifacts are `.claude/driver/discover/interview.md`, `.claude/driver/discover/assumptions.md` and `.claude/driver/discover/non-goals.md`; the Route artifact is `.claude/driver/route/risks.md`. Use this form in `artifacts`, `ref` and `addArtifacts`. The table below shows paths inside the driver dir.

| Path | Who writes it |
|---|---|
| `plan.json`, `events.jsonl`, `log/`, `.mod/` | Never you. Only the tools and the CLI. |
| `blocks/B-nnn.md` | The tool creates it with `id`/`title` frontmatter, a `# B-nnn title` heading and four empty sections. You fill it with Edit only, never Write. |
| `requirements/R-nnn.md` | You. `req.add` may create a stub (`id`/`title` frontmatter and heading): if it exists, Read it, then Write the full file keeping those fields. |
| `decisions/D-nnn.md` | The tool creates it on `decision.add` (`id`/`title` frontmatter, the reason below). You normally do not edit it. |
| `discover/interview.md`, `assumptions.md`, `non-goals.md` | You. |
| `route/risks.md` | You. |
| `exports/plan.mmd` | `driver export mermaid`. Gitignored, never an artifact. |

## 2. Tools

Write to the plan only through these three tools. Pass `expectedRevision` (the `revision` from your last status call) to every write.

### `mcp__driver__plan_status`

Read-only. Input: `scope` (`summary` | `phase` | `block`), `phase`, `block`. Scope `summary` returns the phase, gates, counts, ready blocks, blocks in progress and blocked blocks, with bare ids and no titles. To find a block by title, call it with `scope: "phase"` and `phase: "<phase>"`: that returns each non-retired block of the phase with `id`, `title`, `status` and `deps`. Match by title. Scope `block` (with `block: "B-nnn"`) returns one block record and an excerpt of its doc. Call it first, and again after each batch.

### `mcp__driver__plan_ops`

Input: `{ "ops": [...], "expectedRevision": 12 }`. One to 25 ops, applied atomically (all or nothing, one revision). Op shapes:

```json
{"op":"block.add","title":"Landing page UI","phase":"implement","dependsOn":["B-002"],"requirements":["R-001"],"risk":"medium",
 "provider":{"capability":"database","provider":"supabase","access":"cli","credentials":["SUPABASE_URL"]}}
{"op":"block.set","id":"B-003","patch":{"addArtifacts":[".claude/driver/discover/interview.md"],"risk":"high"}}
{"op":"req.add","title":"Visitors can join with an email","kind":"functional","source":"user"}
{"op":"req.add","title":"Works on mobile","kind":"nonfunctional","source":"assumed","ref":".claude/driver/discover/assumptions.md"}
{"op":"decision.add","title":"Project size class: S","reason":"User estimated a few days"}
{"op":"block.retire","id":"B-004","decision":"D-003","reason":"Superseded by B-009"}
{"op":"req.retire","id":"R-005","decision":"D-003","reason":"Dropped by the user"}
{"op":"phase.advance"}
```

Rules:

- `block.add`: `title` and `phase` are required. `dependsOn`, `requirements`, `risk` (`low` | `medium` | `high`) and `provider` are optional. `provider.access` is `cli`, `mcp` or `api`. `credentials` holds env var names only (`^[A-Z][A-Z0-9_]*$`).
- `req.add`: `kind` is `functional`, `nonfunctional`, `constraint` or `non-goal`. `source` is `user` or `assumed`. `ref` is optional.
- `block.set` patch keys: `title`, `dependsOn`, `requirements`, `provider`, `artifacts` (replace), `addArtifacts` (append), `tests`, `addTests`, `risk`, `verification`. Anything else is refused.
- `verification` needs `passes`, `at` and `by` to pass validation. The system overwrites `at` and `by` with the real time and actor, so send placeholders: `{"passes":true,"at":"2026-01-01T00:00:00Z","by":{"kind":"model","id":"main"}}`. The CLI does the same in one flag: `driver block set B-001 --verified true`.
- **The `"$n"` rule.** Inside one batch, `"$0"` is the id created by the first op that creates something, `"$1"` the second, and so on. Only creating ops count (`block.add`, `req.add`, `decision.add`), in batch order. Example: ops `[req.add, req.add, block.add]` create `$0` and `$1` (requirements) and `$2` (the block). Use `"$n"` in `dependsOn`, `requirements`, `decision` and `id` fields. Across batches use the real ids from the result (`created B-004, B-005`).
- The tool refuses `gate approve`, `rebaseline`, forced moves and anything not listed above.

### `mcp__driver__set_block_state`

Input: `block`, `status` (`in_progress` | `blocked` | `in_review` | `done` | `needs_rework`), `reason`, `owner`, `expectedRevision`. It cannot move a block back to `not_started`.

### CLI fallback

If the tools are not available, use Bash: `driver <command>`, or `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js <command>`. Useful commands: `init <name>`, `status`, `validate`, `export mermaid`, `block set <id> --verified true`, `block status <id> <status> [--reason ...]`, `req add`, `phase advance`, `decision add`. Batches go through `driver apply` with the same JSON on stdin. Use a quoted heredoc, which keeps `"$n"` literal and passes the guard:

```
driver apply <<'EOF'
{"ops":[...],"expectedRevision":12}
EOF
```

Never use an unquoted heredoc delimiter, and keep backticks out of the command line.

### Revisions and refusals

Keep the `revision` from your last status call and pass it as `expectedRevision`. A stale revision is refused: call status again, check what changed, then redo the write. A refusal always carries a reason. Read it, fix the cause, then call again. Never retry the same call blindly, and never work around a refusal with a different path.

## 3. Reducer preconditions

Legal block moves (from `src/state-machine.ts`). Any move not listed is refused:

| From | Legal moves |
|---|---|
| `not_started` | `in_progress` |
| `in_progress` | `in_review`, `blocked` |
| `blocked` | `in_progress` |
| `in_review` | `done`, `needs_rework` |
| `done` | `needs_rework` |
| `needs_rework` | `in_progress` |
| any | `not_started` (only the user, through rebaseline) |

A block that is `done` is never moved by the phase skills. The only legal exit from `done` is `needs_rework`, and only Discover step 9 (rework before the gate is approved) uses it.

| Move | Requires |
|---|---|
| block to `in_progress` | every `dependsOn` block is `done`, and the block phase is at or before the current phase |
| block to `in_review` | at least one artifact on the block, and a filled `## Handoff` section in its `blocks/B-nnn.md` |
| block to `done` | `verification.passes === true` and no test record on the block with `result: "fail"` |
| block to `blocked` or `needs_rework` | a `reason` |
| `phase.advance` to route | gate `route` approved by the user |
| `phase.advance` to release | gate `release` approved by the user |
| `block.retire`, `req.retire` | an existing decision id and a reason |
| `needs_rework` | clears the old verification, so redo review and verification |

Coverage: a requirement that is not a non-goal and has no block gives a `req.coverage` warning. It is only a warning until Release.

## 4. File formats

Exact templates are in the skills (`discover/templates/`, `route/templates/`). Summary:

- `discover/interview.md`: frontmatter (`class`, `domain`, `round`, `language`, `status`, `reclassified`, `checkpoint`, `batch-applied`), then `## Decision tree` (table) and `## Rounds` (log).
- `discover/assumptions.md`: one `## A-nn <statement>` section per premise, with `Why assumed`, `Source node`, `Accepted`, `Requirement`.
- `discover/non-goals.md`: one line per item: `- N-nn <statement> (reason) -> R-nnn`.
- `requirements/R-nnn.md`: frontmatter `id`, `title`, `kind`, `source`; sections `## Statement`, `## Acceptance signal`, `## Origin`, `## Notes`.
- `blocks/B-nnn.md`: `## Spec`, `## Acceptance criteria`, `## Notes` (`Input:`, `Output:`, `Risk:`, `Provider:`), `## Handoff`. Keep the section order. Never rename a heading.
- `route/risks.md`: risk matrix plus a definition of done per phase.

Handoff: when you finish a block, write two to five lines under `## Handoff` (what was delivered, where, what the next block needs to know). The reducer refuses `in_review` while it is empty.

## 5. Hard rules

1. Never approve a gate and never imply it is approved. Only the user can, by typing `/driver approve route` (or `release`) in the composer or pressing Approve in the pane. Say what to type, then end your turn.
2. Never rebaseline and never pass `--force`. If a baseline change is needed, tell the user.
3. Never write `plan.json`, `events.jsonl`, `log/` or `.mod/`, by any route (Write, Edit, Bash redirection, scripts). Read `plan.json` with Read only.
4. Never delete a block, requirement or file in the driver dir. To remove something from the plan, retire it with `block.retire` or `req.retire` citing a decision made by `decision.add`.
5. Credentials appear only as env var names (`SUPABASE_URL`). Never write a value, never ask the user to paste one.
6. Subagents never write to the plan. They read, research and report. Only you call the plan tools. A subagent may write a file only when you gave it that exact path.
7. A work product is not proof. A block is `done` only when the evidence says so (a passing check, or the user's explicit acceptance).
8. If a hook or the tool denies an action, stop and tell the user what was denied. Do not look for another way.

## 6. Language

Talk to the user in the language they write in. Questions, options, play backs and summaries use that language. File headings, ids, keys, table headers and `Why assumed`-style labels stay in English so that tools and later skills can read them. Statements inside the files (requirement text, answers) follow the user's language.
