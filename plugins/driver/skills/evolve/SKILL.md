---
name: evolve
description: Run the DRIVER Evolve phase. Review the finished cycle against the plan (what entered after the baseline, decisions, backlog, requirement coverage), write the review in the user's language, recommend release or another round, and point the user at the baseline and release gate buttons. Use when validate is complete, when the plan is in phase evolve, or when the user asks to review, wrap up or start another round.
user-invocable: true
argument-hint: "[review | round <reason>]"
disable-model-invocation: false
allowed-tools: AskUserQuestion, Read, Write, Glob, Grep, Agent, Skill, Bash(driver *), mcp__driver__plan_ops, mcp__driver__set_block_state, mcp__driver__plan_status, mcp__driver__block_doc, mcp__driver__req_doc, mcp__driver__backlog
---

# Evolve

Read `${CLAUDE_SKILL_DIR}/../../references/driver-conventions.md` first. It defines the tools, the reducer rules, the file formats, the artifact path convention and the hard rules. This skill does not repeat them. Anything that would change the approved plan goes through `${CLAUDE_SKILL_DIR}/../../references/triage.md`; read it before step 5.

Goal: look at what the cycle really delivered, show the user the difference between the plan they approved and the plan that exists now, and recommend the next move. You review. You do not build, and you do not approve anything.

Evolve owns the block titled "Evolve review". The `release` gate sits after it and is the user's.

Language: talk to the user in the user's language. `evolve/review.md` is a user document: write it entirely in the user's language, headings included. `evolve/learnings.md` keeps English headings, text in the user's language. Every other file keeps English headings.

Orientation: never write text before a tool call; it is condensed in the terminal and not seen. Orientation lines go inside a question's text or inside the final message. Only name steps that exist and will happen.

Never write `plan.json`. Never edit a block document with Write, Edit, `sed`, redirection or heredocs: use `mcp__driver__block_doc`. Write is for `evolve/review.md` and `evolve/learnings.md` only (Read first if the file exists). Those two files have no tool; they live in `.claude/driver/evolve/`.

## Step 1: Start

1. Call `mcp__driver__plan_status`.
2. Phase `validate`: every implement and validate block must be `done` (`scope: "phase"` for each). Otherwise **stop**: say what is open and that Implement or Validate has to finish it. Do not advance. All done: run `phase.advance` once.
3. Phase past `evolve` (release): the review is closed. Say so and point at `driver:release`. Stop.
4. Find the block: `mcp__driver__plan_status` with `scope: "phase"`, `phase: "evolve"`. Match "Evolve review" by title. Create it with `block.add` (phase evolve, `dependsOn` every validate block) only if it is absent. Move it to `in_progress` only if its status is `not_started`. A block in `needs_rework` goes to `in_progress`.
5. Mode: the argument `round <reason>` means **round mode** (step 6). No argument or `review`: review mode. If `driver validate` reports `phases.openBehind` the cycle is not finished; the review may still be written, but never recommend release in that case.

## Step 2: Gather

Read, never write:

- `mcp__driver__plan_status` (summary): `afterBaseline` lists the blocks added after the baseline, `reqsAfterBaseline` counts the requirements, `openBehind` lists earlier phases with unfinished work, `rework` and `resumable` list what is still in the loop. **After the baseline** means not recorded in any confirmed baseline; the DRIVER pane shows it with a `+`. Count both kinds. Do not derive this yourself from the plan file.
- The decisions made since the last baseline, from `plan.json` and `.claude/driver/decisions/`. Decisions whose title starts with `Autopilot:` were taken without the user: collect them separately, they go first in the review.
- The backlog: `mcp__driver__backlog` with no items.
- `driver validate`: coverage warnings (`req.coverage`) and `phases.openBehind`.
- Every `requirements/R-nnn.md` and the validate evidence on the blocks. The vision's criterion: **every requirement either has a passing test or was retired with a decision.** The check is the same one `driver validate` makes at release: a requirement passes only if a `done` block linked to it has `verification.passes`. Requirements of kind `non-goal` are skipped; a retired one needs its decision. A passing test record alone is not enough. List the failures with the missing evidence.
- Open questions and assumptions: `discover/summary.md` and `discover/assumptions.md` (read only).

Never trust a work product as proof (conventions, hard rule 7): a `done` block counts only with its verification.

## Step 3: Checkpoint (optional, by class)

The class is in the plan decisions (`Project size class: X`). Classes XS and S skip this step without asking. Classes M and L: ask once with `AskUserQuestion`: "Pre-mortem", "Red team", "Skip", translated; recommend Skip unless the project has money, personal data or production in it. Pre-mortem: imagine the release failed in a week and list why. Red team: attack the requirements marked `assumed` and the high-risk blocks. At most 3 exchanges. What it finds is classified in step 5 like any other finding. If the user already chose in this cycle (the review file says so), do not ask again.

## Step 4: Write the review

Follow `${CLAUDE_SKILL_DIR}/templates/review.md`. Read `evolve/review.md` first if it exists, then Write it. It holds: the cycle in numbers, what entered after the baseline, the Autopilot decisions, requirement coverage against the criterion, the backlog, risks left, and the recommendation.

Findings are not fixed here. Each one is classified by triage (`${CLAUDE_SKILL_DIR}/../../references/triage.md`): level 1 and 2 are ordinary work that sends the plan back to Implement, level 3 is a question with three exits (this cycle, next cycle through `mcp__driver__backlog` plus `decision.add`, re-plan). The always-ask list is always a question.

## Step 5: Recommend

Pick exactly one recommendation and give the reason in one or two lines:

| Situation | Recommendation |
|---|---|
| Criterion met, nothing open behind, no unresolved finding | **Ready for release.** |
| Findings that triage as level 1 or 2 | **One more round, local.** Name the blocks; work goes back to `driver:implement`. |
| The plan shape no longer fits (several blocks, new dependencies, a requirement replaced) | **One more round, re-plan.** Run `driver:route replan <reason>`. |
| Items waiting for a decision | Ask first (`AskUserQuestion`, recommended exit first), then recommend. |

Baseline: when anything entered after the baseline, recommend confirming baseline N+1 before the release gate, so the release is approved against the plan as it really is. Say it as one line, for the user to act on: press **Confirm baseline N+1** in the DRIVER pane or type `/driver baseline`. You cannot do it and never try. Confirming a baseline after the release gate was approved revokes that approval, so the order is baseline first, gate second.

## Step 6: Round mode (`round <reason>`)

Used to start another round on purpose. Classify the reason with triage (`${CLAUDE_SKILL_DIR}/../../references/triage.md`) and act as it says: a fix or an adjustment is recorded with `decision.add` and `block.add` (or `needs_rework` for a failed criterion) and the user is told to continue Implement; a scope change is asked with the three exits; a re-plan invokes `driver:route replan <reason>`. Do not move `done` blocks except through `needs_rework`. The Evolve review block stays `in_progress`; the review is rewritten when the round ends.

## Step 7: Learning and finish

1. One learning per round, appended to `.claude/driver/evolve/learnings.md` (Read first, then Write the whole file with the new entry added; template `${CLAUDE_SKILL_DIR}/templates/learnings.md`). One sentence: what to do differently next time, with the evidence. No learning if nothing was learned; do not invent one.
2. When the recommendation is ready for release and the user has the review: `block.set` on the Evolve review block with `addArtifacts` `.claude/driver/evolve/review.md` and `.claude/driver/evolve/learnings.md` (only the files that exist). Fill `## Handoff` with `mcp__driver__block_doc` (what was reviewed, the recommendation, what the user must press). Then `set_block_state` to `in_review`, set the verification (conventions, section 2), `set_block_state` to `done`. The evidence is the written review and the criterion check. When the recommendation is another round, leave the block `in_progress`.
3. Never approve the gate and never say it is approved. Approving the release gate starts `driver:release` by itself.

## Final message

The review text, in full, in the user's language, as the last thing in the turn with no tool call after it. It ends with the user's next step, in this form:

- ready for release: if there are items after the baseline, "Press Confirm baseline N+1 in the DRIVER pane (or type `/driver baseline`), then press Approve release gate (or type `/driver approve release`). Approving starts the release."; with none, only the second part;
- another round: what to press or type: the Continue implement button (shown when work is open behind), `/driver:implement B-nnn`, or `/driver:route replan <reason>`. The autopilot is not offered here; it only runs in Implement and Validate.

End the turn.

## Red flags

| Thought | Reality |
|---|---|
| "The gate is basically approved, I will start the release." | Only the user approves. Say what to press and end the turn. |
| "I will confirm the baseline to save the user a click." | Never. Only the user's own click or command does it. |
| "The tests pass, so every requirement is covered." | Check each requirement for a passing test or a retire decision. List the gaps. |
| "That Autopilot decision was fine, no need to mention it." | Show every `Autopilot:` decision first. The user did not take it. |
| "This small finding I can fold into a done block." | `done` leaves only through `needs_rework`; new work is a new block. Use triage. |
| "Implement still has an open block, but release is near." | `phases.openBehind` means the cycle is not done. Do not recommend release. |
| "I will push the next-cycle ideas into the plan." | They go to `mcp__driver__backlog` and a decision, not into the plan. |
| "I will write the review in English, it is a file." | `review.md` is a user document, in the user's language. |
| "I will edit the Evolve block doc with Edit." | Block docs are written only with `mcp__driver__block_doc`. |
