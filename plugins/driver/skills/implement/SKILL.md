---
name: implement
description: Run the DRIVER Implement phase. Pick the next ready or reopened block, build it with tests first, verify every acceptance criterion with evidence, record artifacts and tests, write the handoff and close the block, one at a time or in parallel with subagents, then advance to validate. Use after Route is confirmed, when the plan is in phase implement, when a block needs rework, or when the user asks to build, continue or run blocks in parallel.
user-invocable: true
argument-hint: "[B-nnn | parallel]"
disable-model-invocation: false
allowed-tools: AskUserQuestion, Read, Write, Edit, Glob, Grep, Agent, Skill, Bash(driver *), mcp__driver__plan_ops, mcp__driver__set_block_state, mcp__driver__plan_status, mcp__driver__block_doc, mcp__driver__req_doc, mcp__driver__backlog
---

# Implement

Read `${CLAUDE_SKILL_DIR}/../../references/driver-conventions.md` first. It defines the tools, the `"$n"` rule, the reducer rules, the file formats and the hard rules. This skill does not repeat them.

Goal: turn blocks into working, verified output, one block at a time (or several in parallel), and keep the plan honest about what is done. You build and you close blocks. You do not change the plan's shape without triage.

Anything that shows up mid-phase and would change the plan (a failed criterion, a new request, something you noticed) goes through `${CLAUDE_SKILL_DIR}/../../references/triage.md` before you touch the plan. Do not restate it here; follow it.

Language: talk to the user in the user's language. Say nothing before a tool call: text before a tool call is condensed in the terminal and not seen. Orientation goes inside the final message. End every final message with the user's next step: one item at a time (name the block and what you will do), or the Autopilot button in the DRIVER pane / `/driver auto on`.

Autopilot: when the autopilot is on, never ask; follow its rules in your instructions and `triage.md` section 4.

Never: approve a gate, rebaseline, use `--force`, edit `plan.json` or any file under the plan folder by hand, store a credential value (env var names only), push.

Project commands (tests, build, git, gh) are not pre-approved by this skill: they go through the user's normal permission mode, so a permission prompt for them is expected.

## Step 1: Pick the work

1. Call `mcp__driver__plan_status`. Phase `discover` or `route`: **stop** and point to the right skill (`driver:discover` or `driver:route`). Phase `validate` or later with implement work still open: continue here anyway (rework and reopened blocks live in this skill).
2. List, from the status: blocks in `needs_rework` (first: they were already approved once), `resumable` blocks (`blocked` with reason exactly `waiting on B-nnn`, B-nnn one of their dependencies and now `done`), and `ready` blocks. Use `scope: "phase"`, `phase: "implement"` to get titles, and keep only blocks whose phase is `implement`: the status lists validate blocks too once the plan is in validate. Name any ready, resumable or reopened validate block for `driver:validate recheck` and leave it alone.
   A resumable block is resumed only when **every** `dependsOn` is `done`; the reason names just one. If another is still open, keep it blocked. To stop it showing as resumable, update the reason: `in_progress` and then `blocked` with `waiting on <the open one>` (both moves are legal, and `blocked` to `in_progress` does not check dependencies, so the check is yours).
3. An argument `B-nnn` picks that block. `parallel` goes to step 6. Otherwise recommend one block and say why: rework first, then `high` risk, then the longest remaining dependency chain.
4. Two or more independent ready blocks (no `dependsOn` between them, no obvious shared files): offer parallel in the final message, with the single-block recommendation as the default.
5. Nothing ready and nothing in progress: go to step 8.

## Step 2: Understand the block

1. Read `.claude/driver/blocks/B-nnn.md`, every linked `.claude/driver/requirements/R-nnn.md`, and the Handoff of each dependency (what it delivered and where).
2. Read the block's `provider`. For each name in `credentials`, check that the env var is set (`test -n "$NAME"`, never print it). A missing one: `set_block_state` to `blocked` with reason `needs credential NAME`, tell the user the name to set, and pick another block.
3. Resuming a `needs_rework` block: read the reason and the report it cites (`validate/B-nnn.md`). The fix addresses that evidence and nothing more. A fix that needs more than the original criteria asked for is not rework: triage it.
4. An item from the always-ask list in `triage.md` (spending money, payment data, deleting for good, publishing outside this machine, and so on) is the user's decision, whatever mode is on.

## Step 3: Start and build

1. Once, per project, if the folder is a git repo: look for an existing decision whose title contains `Commit per block`, by reading the documents in `.claude/driver/decisions/` (`plan_status` does not return decisions). Absent: ask the user with `AskUserQuestion` whether to commit each closed block locally (never pushed) and record the answer with `decision.add`, title `Commit per block: yes` or `Commit per block: no`, reason in one line. With the autopilot on, do not ask: default to yes and record it with the title `Autopilot: Commit per block: yes`, so Evolve shows it to the user.
2. `set_block_state` to `in_progress` (refused while a dependency is not `done`; read the reason).
3. Write the code. Tests first when the block produces code:
   - If the skill `superpowers:test-driven-development` is available, invoke it through the Skill tool and follow it.
   - Otherwise follow this: write one failing test for one acceptance criterion, run it and see it fail for the right reason, write the least code that passes, run it, refactor, repeat per criterion. Never write the test after the code and call it TDD.
   - Non-code output (a document, a deck, a spreadsheet) has no test-first step: define how each criterion will be checked before you produce the output.
4. Stay inside the block's spec. New ideas go to triage (level 2 or 3), not into the diff. A failure of a dependency's output goes to triage level 1 against that block.
5. Credentials: read from the environment by name. Never write a value into code, logs, tests or the Handoff.

## Step 4: Verify with evidence

Done is a claim that needs proof. If the skill `superpowers:verification-before-completion` is available, invoke it through the Skill tool. Either way, for each acceptance criterion in `blocks/B-nnn.md`:

1. Identify what proves it (a test, a command, a file, a screenshot).
2. Run it now, fresh, in full.
3. Read the real output, including exit code and failures.
4. Compare with the criterion. Pass only if the output says so.

A criterion with no proof is not met. A skipped, flaky or "probably fine" check is `unknown` or `fail`, never `pass`. Run the project's type check and linter too when they exist. If a criterion fails, fix and repeat from 1; if it cannot be met inside this block, triage.

## Step 5: Record and close

Main session only (a subagent never does this part, step 6).

1. One `mcp__driver__plan_ops` batch, with `expectedRevision`: `block.set` with the artifacts and the tests.

   ```json
   {"op":"block.set","id":"B-004","patch":{
     "addArtifacts":["app/api/waitlist/route.ts","tests/api/waitlist.test.ts"],
     "addTests":[{"layer":"integration","ref":"tests/api/waitlist.test.ts","result":"pass"}]}}
   ```

   Paths are relative to the project root. `layer` is one of `unit`, `integration`, `e2e`, `visual`, `perf`, `security`, `acceptance`, `manual`. `ref` names the test file, command or review; `result` is `pass`, `fail` or `unknown`. Record a failing test as `fail`: a block with a `fail` record cannot close. An entry with the same `ref` replaces the earlier one, so a rerun is recorded under the same `ref`.
2. `mcp__driver__block_doc` with `handoff`: two to five lines on what was delivered, where, what was verified and what the next block must know. Never write a credential value.
3. `set_block_state` to `in_review` (refused without an artifact and a Handoff).
4. Set the verification, as the conventions describe: `block.set` with `{"verification":{"passes":true,"at":"2026-01-01T00:00:00Z","by":{"kind":"model","id":"main"}}}`. The system overwrites `at` and `by`. Set it only after step 4 passed for every criterion.
5. `set_block_state` to `done`.
6. If the commit decision is yes: commit the block's files locally with a message naming the block (`B-004: signup API`). Stage only what the block touched. Never `--no-verify`, never push. Not a git repo or decision no: skip.
7. Report in one line and go to step 1 for the next block. With the autopilot on, keep going without asking.

## Step 6: Parallel blocks

Used when the user picks `parallel` or accepts the offer. Pick the independent ready blocks (a sensible batch: 2 to 4).

1. In the main session, move each chosen block to `in_progress` first, so the plan shows the work.
2. Spawn one subagent per block with the Agent tool, in a single message so they run together, `run_in_background: true`, an explicit `model` (`sonnet` for implementation, `opus` only for a hard design block), and `isolation: "worktree"` when the project is a git repo and the blocks may touch the same files.
3. Each prompt starts with the marker line `DRIVER-BLOCK: B-nnn` and carries: the spec and acceptance criteria copied from the block document, the linked requirements, the Handoff of its dependencies, the test-first protocol of step 3, the verification protocol of step 4, the credentials by name only, and these rules: build only this block; fill the Handoff of this block with `mcp__driver__block_doc`; do not record artifacts or tests, do not change any block state, do not call any other `mcp__driver__*` tool; if a check fails or something outside the block is needed, stop and report it; finish with a report listing the files created or changed, each check run with its real result, and anything unmet.
4. The plan lives in the main checkout. A subagent in a worktree never trusts the plan copy inside its worktree and never writes there.
5. When a subagent reports, integrate one at a time. First read the block with `mcp__driver__plan_status` (`scope: "block"`): spawning gave the block to the subagent, and when it stops without a handoff the plan moves the block to `blocked` with reason "agent ended without handoff". If it is `blocked` with that reason, move it to `in_progress` (owner `main`) first. If it is still `in_progress` and owned by the ended agent (possible with worktree isolation, where the hook may have seen the worktree's copy of the plan), take it over with `in_progress` and owner `main` if the tool allows it; if it refuses, say so to the user. Then merge or copy its worktree changes, run the checks yourself (step 4), and record and close that block (step 5). Verify what the report claims; a report is not proof.
6. A failed report: triage it (`triage.md`, level 1 for an unmet criterion). Only the main session triages; the subagent never moves a block it does not own.
7. A block that needs a credential or a user decision is marked `blocked` by you, with the reason, and its subagent is not started.

## Step 7: Rework

A block in `needs_rework` follows the same steps: `in_progress` (the old verification is already cleared), fix against the cited evidence, verify from scratch (step 4), record tests (rerun under the same `ref` so the record is replaced: `addTests` replaces the entry with that `ref`, and any `fail` entry left over blocks `done`), a new Handoff, `in_review`, verification, `done`. Then check `plan_status` for `resumable` blocks (validate blocks waiting on this one) and tell the user they can resume with `driver:validate recheck`.

## Step 8: End of the phase

1. Call `mcp__driver__plan_status`. Advance only if `currentPhase` is `implement` and every implement block is `done` (none `needs_rework`, none `blocked`): `phase.advance` to validate. The reducer does not refuse a move with work open behind, so the check is yours. If `currentPhase` is `validate` or later, never advance here: a reworked block that is now `done` hands back to `driver:validate recheck`. A refusal carries the reason; read it and report.
2. Blocks still `blocked` or waiting on the user: list them with the reason and what the user must do. Do not advance.
3. Final message, in the user's language: what was built (block list), anything recorded by triage, and the next step. After `phase.advance`: "start Validate" (`driver:validate`), or the Autopilot button / `/driver auto on` to run Validate alone. In phase validate or later: `driver:validate recheck`. Otherwise name the block you will do next.

## Red flags

| Thought | Reality |
|---|---|
| "The tests pass in my head, I will mark it done." | Run it, read the output, compare with each criterion. Evidence first. |
| "I will write the tests after, it is faster." | Tests after the code only describe what the code does. Write one failing test first. |
| "This extra feature is small, I will add it to the block." | New work is triage level 2 or 3. Nothing grows silently. |
| "The subagent said it passed, I will close the block." | A report is not proof. Run the checks yourself, then close. |
| "Let the subagent record the artifacts and tests." | It fills the Handoff only. You record and close. |
| "The credential is missing, I will hard-code a placeholder." | Mark the block `blocked` with the variable name. Never a value. |
| "A criterion fails but is close, I will record `pass`." | `fail` or `unknown`. A failing record blocks `done` on purpose. |
| "I will fix the dependency's bug inside this block." | That is level 1 on the dependency: `needs_rework` there, evidence cited. |
| "I will edit the block document with Edit." | Block documents are written only with `mcp__driver__block_doc`. |
| "Autopilot is on, I can decide the payment provider." | The always-ask list is the user's, always. Mark the block `blocked`. |
| "Commit and push so nothing is lost." | Local commits only, and only if the user said yes. Never push. |
| "The pane will tell them what is next." | End the message with the next step. Always. |
