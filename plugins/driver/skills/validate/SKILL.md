---
name: validate
description: Run the DRIVER Validate phase. For each validate block, run the test layers the project needs, check acceptance against the requirement documents, write a report, record tests, and send every failure through triage so the origin block goes to rework and the validate block waits. Then recheck after fixes and advance to evolve. Use after Implement is complete, when the plan is in phase validate, when a fix has landed and blocks wait on it, or when the user asks to test, check or validate the work.
user-invocable: true
argument-hint: "[B-nnn | recheck]"
disable-model-invocation: false
allowed-tools: AskUserQuestion, Read, Write, Glob, Grep, Agent, Skill, Bash(driver *), mcp__driver__plan_ops, mcp__driver__set_block_state, mcp__driver__plan_status, mcp__driver__block_doc, mcp__driver__req_doc, mcp__driver__backlog
---

# Validate

Read `${CLAUDE_SKILL_DIR}/../../references/driver-conventions.md` first. It defines the tools, the `"$n"` rule, the reducer rules, the file formats and the hard rules. This skill does not repeat them.

Goal: find out, with evidence, whether what was built meets what the user asked for. You are the skeptic. You check against the requirement documents, not only against the plan, and you report what is true even when it is bad news.

Every validation failure and every change that shows up mid-phase goes through `${CLAUDE_SKILL_DIR}/../../references/triage.md` before you touch the plan. Do not restate it here; follow it.

Language: talk to the user in the user's language. Say nothing before a tool call: text before a tool call is condensed in the terminal and not seen. The report `validate/B-nnn.md` is a document for the user: write it in the user's language, keeping the English headings of the template. End every final message with the user's next step: one item at a time (name it), or the Autopilot button in the DRIVER pane / `/driver auto on`.

Autopilot: when the autopilot is on, never ask; follow its rules in your instructions and `triage.md` section 4.

Never: approve a gate, rebaseline, use `--force`, edit `plan.json` or any file under the plan folder by hand (the report and block documents have their own rules below), store a credential value (env var names only), push, or change code to make a check pass. Fixing is Implement's job.

Project commands (tests, build, git, gh) are not pre-approved by this skill: they go through the user's normal permission mode, so a permission prompt for them is expected.

## Step 1: Pick the block

1. Call `mcp__driver__plan_status`. Phase `implement` with implement blocks still open: **stop**, say so, and point to `driver:implement`. Implement all `done`: `phase.advance` to validate first (read a refusal and report it).
2. Use `scope: "phase"`, `phase: "validate"` for titles. An argument `B-nnn` picks that block; `recheck` goes to step 6. Otherwise take the ready validate blocks (dependencies `done`), highest-risk requirement first.
3. Read `.claude/driver/blocks/B-nnn.md`, the Handoff of each dependency, and every linked `.claude/driver/requirements/R-nnn.md`: the `## Acceptance signal` of each requirement is the real bar, and a block criterion that is weaker than it does not lower it.
4. `set_block_state` to `in_progress`.

## Step 2: Run the layers

1. Choose the layers the project and the block need: `unit`, `integration`, `e2e`, `visual`, `perf`, `security`, `acceptance`, `manual` (the values of `layer` in test records). A web app: the suite plus an end to end run of the user flow. A CLI: real commands with real arguments. A deck or document: a visual review of every page against the requirement. A data task: a check of counts and samples against the source. When unsure, prefer the layer closest to what the user will see.
2. If the skill `superpowers:verification-before-completion` is available, invoke it through the Skill tool. Either way: for each criterion, identify the proof, run it now and in full, read the real output, compare with the criterion. A criterion without proof is `unknown`, never `pass`.
3. Run everything that exists: the test suite, the type check, the linter, the build. A check you could not run (missing credential, missing service) is `unknown` with the reason. A missing credential is a name for the user to set, never a value.
4. Check each requirement end to end against its Acceptance signal, not each block in isolation. Look for what no block covers: an edge case, an error path, a state the user can reach that nobody tested.
5. Independent checks may run in parallel subagents (read-only, explicit `model`; the prompt says not to call any `mcp__driver__*` tool and not to edit code). Their reports are leads; you rerun anything you rely on.
6. Do not edit the code under test, the tests, or the criteria to make a result pass.

## Step 3: Write the report

1. If `.claude/driver/validate/B-nnn.md` exists, Read it first. Then write it with Write, following `${CLAUDE_SKILL_DIR}/templates/report.md` (create the folder if needed). One row per criterion and per requirement signal, with the command or step you used and the observed result.
2. Record the results with `mcp__driver__plan_ops` (`expectedRevision` from the last status): `block.set` on the validate block.

   ```json
   {"op":"block.set","id":"B-015","patch":{
     "addArtifacts":[".claude/driver/validate/B-015.md"],
     "addTests":[{"layer":"e2e","ref":"npm run test:e2e","result":"pass"},
                 {"layer":"acceptance","ref":"R-003 acceptance signal","result":"fail"}]}}
   ```

   One test entry per distinct check. `result` is `pass`, `fail` or `unknown`; a `fail` entry keeps the block from closing, which is the point.

## Step 4: Close or triage

**Everything passed** (no `fail`, no `unknown` that matters):

1. `mcp__driver__block_doc` with `handoff`: two to five lines on what was checked, the verdict, and any residual risk the user should know. Never a credential value.
2. `set_block_state` to `in_review`, set the verification (`block.set` with `{"verification":{"passes":true,"at":"2026-01-01T00:00:00Z","by":{"kind":"model","id":"main"}}}`; the system overwrites `at` and `by`), then `set_block_state` to `done`.
3. Go to step 1 for the next block.

**Anything failed** (also an `unknown` that hides a real risk):

1. Do not close the validate block and do not set its verification.
2. Classify each finding with `triage.md` section 1. Several findings are several triages: one finding, one decision.
3. Level 1 (a written criterion failed): find the block that owns the criterion. Move it to `needs_rework` with `set_block_state`, reason like `validate/B-015.md: criterion 3 fails, export drops the last row`. Make the validate block wait: move it to `blocked` with reason exactly `waiting on B-nnn`, following the path `triage.md` gives for its current status (it also says when to add B-nnn to its `dependsOn`, and that it always ends `blocked`). Keep the report: it is the evidence.
4. Level 2 (new work for an existing requirement): one batch with `decision.add`, `block.add` and the `dependsOn` link, as `triage.md` says. No question. If the validate block that gets the new dependency is `in_progress`, the link alone does not stop it from closing (`in_progress` to `in_review` or `done` does not check dependencies): also move it to `blocked` with reason `waiting on <new id>`.
5. Level 3 (scope change): assess, then ask once with the three exits (`triage.md`). "Next cycle" is recorded with `mcp__driver__backlog` (title, detail, `origin` like `validate/B-015.md`, `decision` the D-nnn you created) plus `decision.add`.
6. Tell the user in one line per finding, then go on with the next validate block that does not depend on the failed work.

## Step 5: Say what happens next

When triage ran, the last message ends with the two ways to go on, in the user's language: one item at a time (name the block that now needs fixing, usually the reopened implement block, and offer `driver:implement B-nnn`), or keep going alone through fix, recheck and the rest: the Autopilot button in the DRIVER pane, or `/driver auto on`.

## Step 6: Recheck after fixes

Argument `recheck`, or any time a reopened block has been fixed.

1. `mcp__driver__plan_status`: the `resumable` blocks are `blocked` with reason exactly `waiting on B-nnn`, B-nnn one of their dependencies and now `done`. That test looks only at the block named in the reason, so before resuming check that **every** `dependsOn` is `done`. If another is still open, do not resume: keep it blocked and update the reason with `in_progress` and then `blocked` `waiting on <the open one>` (both legal; `blocked` to `in_progress` does not check dependencies). Resume the rest: `set_block_state` to `in_progress`. A block held by `needs user: ...` is not in that list: resume it only when the user has settled what the reason names **and** every `dependsOn` is `done`. If the user's part is settled and a dependency is still open, restate the reason as `waiting on <the open one>`; if the reason says `also waiting on B-nnn` and B-nnn is `done` while the user's part is open, restate it without that part.
2. Run only what the fix touched: the layers and criteria tied to the reworked block and the requirements it serves, plus the fast suite for regressions. State in the report which checks were rerun and which were not, and why.
3. Update the existing report (Read it, then Write it): add to its "Recheck" section the date, the evidence and the verdict. Keep the first findings visible. Record each rerun with `addTests` under the **same `ref`**: it replaces the earlier entry (and a leftover `fail` entry blocks `done`), so the history lives in the report's Recheck section, not in the plan.
4. Pass: close as in step 4. Fail again on a finding that already failed once: do not triage it again. Move the validate block to `blocked` with reason `needs user: <finding>` (deliberately not a `waiting on` reason, so it never shows as resumable), stop working on it, and tell the user in plain words that the same finding failed twice. This also keeps the autopilot from looping.

## Step 7: End of the phase

1. Call `mcp__driver__plan_status`. Advance only if `currentPhase` is `validate`, every validate block is `done`, and `openBehind`, `rework` and `resumable` are all empty (no implement block in `needs_rework`, no `blocked` block): `phase.advance` to evolve. The reducer does not refuse a move with work open behind, so the check is yours. A refusal carries the reason; read it and report.
2. Anything open behind: do not advance. Say which block holds things up and the step that unblocks it.
3. Final message, in the user's language: verdict per requirement (passes, fails, unknown), what triage did, and the next step. After `phase.advance`: "start Evolve" (`driver:evolve`), or the Autopilot button / `/driver auto on`.

## Red flags

| Thought | Reality |
|---|---|
| "The block criteria pass, so the requirement is met." | Check the Acceptance signal in `requirements/R-nnn.md`. The plan can be weaker than the user. |
| "The test is flaky, I will record `pass` and move on." | A flaky check is `unknown` with the reason. Never `pass`. |
| "I will patch the code to get a green run." | You validate. Fixing is Implement's: level 1 sends the block to `needs_rework`. |
| "I will edit the failing test, it is wrong." | If the test is wrong, say so in the report and triage it; do not edit it to pass. |
| "One bundled block for all findings is tidier." | One finding, one decision. Never one vague block. |
| "I will close the validate block, the failure is minor." | A `fail` record blocks `done`. Triage it. |
| "The subagent's report says all green." | Leads, not proof. Rerun what you rely on. |
| "I will move the validate block back to `not_started`." | Not legal. Use `blocked` with `waiting on B-nnn`. |
| "A new request came in, I will just add it." | Classify it with `triage.md` first. |
| "The autopilot is on, I will decide the legal question." | The always-ask list is the user's, always. |
| "Nothing to add, the report speaks for itself." | End with the next step. Always. |
