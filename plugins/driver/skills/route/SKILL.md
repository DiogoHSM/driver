---
name: route
description: Run the DRIVER Route phase. Decompose approved requirements into a block graph with dependencies, acceptance criteria, risk and providers, validate the diagram with the user, then advance to implement. Use after gate route is approved, when the Discover skill hands off, or when Evolve asks for a re-plan.
user-invocable: true
argument-hint: "[replan <reason>]"
disable-model-invocation: false
allowed-tools: AskUserQuestion, Read, Write, Edit, Glob, Grep, Agent, Bash(driver *), mcp__driver__plan_ops, mcp__driver__set_block_state, mcp__driver__plan_status
---

# Route

Read `${CLAUDE_SKILL_DIR}/../../references/driver-conventions.md` first. It defines the tools, the `"$n"` reference rule, the reducer rules, the file formats, the artifact path convention and the hard rules. This skill does not repeat them.

Goal: turn the approved requirements into a graph of blocks that agents can build and verify, show the diagram to the user, and move the plan to Implement. You plan. You do not implement.

Route has no human gate of its own. The `route` gate sits between Discover and Route and is already approved when you start. The user's check is the diagram validation in step 6. Route ends with `phase.advance` to Implement and no gate.

A block that is `done` is never moved. The only legal path out of `done` is `needs_rework`, and this skill does not use it.

## Step 1: Start

1. Call `mcp__driver__plan_status`.
2. Gate `route` not approved: **stop**. Tell the user to type `/driver approve route` or press Approve in the pane, and end your turn. Never approve it, never hint it is done.
3. Phase still `discover` with the gate approved: run `phase.advance` once.
4. Find the block: call `mcp__driver__plan_status` with `scope: "phase"` and `phase: "route"`. That result lists titles (the summary scope returns bare ids only). Match the block titled "Route plan" by title. Create it with `block.add` (phase route, `dependsOn` the "Discovery interview" block, whose id you read from a `scope: "phase"`, `phase: "discover"` call) only if it is absent. Move it to `in_progress` only if its status is `not_started`. In replan mode, follow the replan section instead.
5. Mode: an argument starting with `replan` means **replan mode** (see the end). Implement blocks already exist in the plan: also replan mode.

## Step 2: Gather inputs

- Read `.claude/driver/plan.json` with Read only. Never write it.
- Read every `.claude/driver/requirements/R-nnn.md`, plus `.claude/driver/discover/interview.md`, `assumptions.md` and `non-goals.md` in the same folder.
- The size class is in the plan decisions (`Project size class: X`) and in `interview.md`. It sets the block range: XS 2 to 4, S 4 to 8, M 8 to 15, L 15 to 30. The range counts implement and validate blocks only. The Route plan, Evolve review and Release blocks (and the Discovery blocks) are fixed overhead and do not count.
- Brownfield project: if there is code, start one read-only `feature-dev:code-explorer` subagent (`run_in_background: true`) to map the modules the blocks will touch. Wait for it before step 3. It never writes to the plan.

## Step 3: Decompose

| Phase | Rule |
|---|---|
| implement | One deliverable per block that one agent finishes in one session (about one pull request). The output is observable: a route, a file, a command, a table. |
| validate | At least one block per requirement group. Layers fit the domain (unit, integration, end to end, visual review, data check). Acceptance is checked against the `requirements/R-nnn.md` files, not only against the plan. |
| evolve | Exactly one block, titled "Evolve review". Fixed overhead, not counted in the range. |
| release | One block with the release checklist (build, deploy, smoke test, rollback note). Fixed overhead, not counted in the range. |

Further rules:

- `dependsOn` only for a real artifact dependency (block B needs something A produces). Maximise parallelism. No ordering edges "to be tidy". The root implement blocks depend on the Route plan block.
- Every requirement that is not a non-goal links to at least one implement block and at least one validate block (the `requirements` field of `block.add`). That includes assumed requirements (`source: "assumed"`): only non-goals are exempt. Non-goals link to no block.
- **Risk.** `high`: irreversible action, money, personal data, new technology for the team, or a block that rests on an assumed (`A-nn`) premise. `medium`: external integration. Otherwise `low`.
- **Provider.** When a block needs an external capability, set `provider {capability, provider, access, credentials[]}`. `access` is `cli`, `mcp` or `api`. `credentials` are env var names only.
- Stay inside the class range, counting implement and validate blocks only. Going over requires a stated reason in the Route plan Handoff.
- Block titles are short imperative noun phrases ("Signup API", not "Implement the API for signups").

## Step 4: Write the blocks

1. Build the `block.add` ops in dependency order. In one batch, a block refers to an earlier block in the same batch as `"$n"`, where n is the index among creating ops (see conventions). At most 25 ops per call.
2. More than 25 blocks: the first call creates the roots and the first layers, later calls use the real ids from the result.
3. Pass `expectedRevision` from the last status call. Read the `created` list in the result and keep the id mapping.
4. Fill each `.claude/driver/blocks/B-nnn.md` with the Edit tool only, never Write. The tool-generated doc already has `id` and `title` frontmatter and a `# B-nnn title` heading that must stay. Edit the content under the four headings, following `${CLAUDE_SKILL_DIR}/templates/block.md` (it shows the file as it exists, frontmatter and heading included). Leave `## Handoff` empty. A block without acceptance criteria is not finished.
5. Write `.claude/driver/route/risks.md` using `${CLAUDE_SKILL_DIR}/templates/risks.md`.

## Step 5: Self-review

Fix problems in place, without asking the user. Check five things:

1. **Coverage.** Every requirement (not a non-goal) is linked to at least one implement and one validate block. List the gaps, add blocks or links.
2. **Block scan.** Every block has an output, at least one testable acceptance criterion and a size that fits one session. Split blocks that do not.
3. **Dependency sanity.** No cycles. No edge without a real artifact behind it. No block that could start earlier.
4. **Review focus.** Each `high` block has a validate partner and a written mitigation in `risks.md`.
5. **Proportion.** The count of implement and validate blocks sits inside the class range (fixed overhead blocks do not count). Explain any excess.

Then run `driver validate`. Zero `req.coverage` warnings are required. Any other error: read it, fix it, run it again.

## Step 6: Validate the diagram with the user

1. Run `driver export mermaid`. It writes `.claude/driver/exports/plan.mmd` (gitignored, so it is not an artifact).
2. Tell the user the live diagram is in the pane. For a terminal-only user, paste the Mermaid text in the chat (read it from `.claude/driver/exports/plan.mmd`).
3. Add three lines: how many blocks, the critical path (longest dependency chain), the `high` risk blocks.
4. Ask with `AskUserQuestion` (header `Diagram`): "Looks right (Recommended)", "Adjust blocks", "Adjust order", "Re-split". For an adjustment, ask what to change (one question), apply it with `block.set`, `block.add`, or `block.retire` plus `decision.add`, re-run steps 5 and 6.1, and ask again. Loop until "Looks right". An empty or timed-out answer is not acceptance.

## Step 7: Finish

1. `block.set` on the Route plan block: `addArtifacts` `.claude/driver/route/risks.md`.
2. Write the Route plan `## Handoff`: block count, critical path, high-risk blocks, any excess over the range and why.
3. `set_block_state` to `in_review`, set the verification (conventions, section 2), `set_block_state` to `done`. The user's "Looks right" is the evidence.
4. Run `phase.advance` (Route to Implement). If the reducer refuses, read why and report it.
5. Report to the user: the ready blocks (from `plan_status`) and the next step ("start Implement with the first ready block").

## Replan mode (`replan <reason>`)

Used when Evolve found the plan no longer fits, or the user added requirements in Discover amend mode.

- Never edit or move a block that is `done`. Never reuse its id. Never use `needs_rework`.
- Create a new block titled `Route replan: <reason>` (phase route, no `dependsOn` on unfinished work) with `block.add`, and put it `in_progress`. Look it up by title with `plan_status` `scope: "phase"`, `phase: "route"` first, so a resumed replan does not create a second one. It is bookkeeping for the replan and does not count in the class range.
- Add new blocks for new work. Retire superseded blocks with `block.retire`, citing a `decision.add` that states the reason (create the decision first in the same batch and use `"$n"`).
- Link new requirements to new implement and validate blocks. Re-run the self-review and `driver validate`.
- Update `.claude/driver/route/risks.md` (add rows, mark retired ones). Never delete rows.
- Validate the diagram again (step 6). Phase moves only if it must (`phase.advance` is not needed when the plan is already in implement).
- Close the `Route replan: <reason>` block like the Route plan block (step 7.1 to 7.3): artifact `.claude/driver/route/risks.md`, `## Handoff`, `in_review`, verification, `done`. The user's "Looks right" is the evidence.
- **Rebaseline is the user's.** The baseline records the plan as approved. If the change is large, say: "The user has to run the rebaseline command in a terminal". Never run it.

## Red flags

| Thought | Reality |
|---|---|
| "The gate is surely approved, I will advance." | Read `plan_status`. If the gate is not approved, stop. |
| "One big block is simpler." | A block an agent cannot finish in one session cannot be reviewed. Split it. |
| "I will chain these blocks in order to be safe." | False edges kill parallelism. Only real artifact dependencies. |
| "Non-goals need a block to be safe." | Non-goals link to nothing. The plan does not build them. |
| "That block is done, I will tweak its criteria." | Never edit done blocks. Add a new block and retire if superseded. |
| "No validate block for this requirement, the implement block tests it." | Validate is separate and checks the R doc. Add it. |
| "The diagram looks fine to me, no need to ask." | The user validates the diagram. Ask, and wait for "Looks right". |
| "Over the range by a few blocks, nobody will mind." | State the reason in the Handoff or merge blocks. |
| "I will delete this wrong block." | Retire it with a decision. Nothing is deleted. |
