---
name: discover
description: Run the DRIVER Discover phase. A structured interview that turns a project idea into requirements, accepted premises and non-goals in .claude/driver, then hands off to the human route gate. Use when starting a project or feature with DRIVER, when the plan is in phase discover, or when the user asks to define, scope or interview for a project.
user-invocable: true
argument-hint: "[one-line project idea | amend <topic>]"
disable-model-invocation: false
allowed-tools: AskUserQuestion, Read, Write, Edit, Glob, Grep, Agent, Skill, Bash(driver *), mcp__driver__plan_ops, mcp__driver__set_block_state, mcp__driver__plan_status
---

# Discover

Read `${CLAUDE_SKILL_DIR}/../../references/driver-conventions.md` first. It defines the tools, the reducer rules, the file formats, the artifact path convention and the hard rules. This skill does not repeat them.

Goal: interview the user until the decisions that shape the project are settled, assumed or deferred, then put requirements, premises and non-goals into the plan and hand off to the user's `route` gate. You interview. You do not design, estimate blocks or write code.

Principles:

- One question per turn, asked with `AskUserQuestion`. Formats and worked examples: `${CLAUDE_SKILL_DIR}/question-format.md`. Read it before your first question.
- Facts are yours, decisions are the user's. Research facts with subagents. Ask only what needs a human preference.
- Files first, plan last. The decision tree lives in `.claude/driver/discover/interview.md` and is updated after every answer, so a context compaction loses nothing. The plan gets one batch at the end.
- "Not sure" never blocks the interview.
- Match the ceremony to the project size (step 2). A one-afternoon script does not get a 30-question interview.
- Ask in the user's language. Keep file headings in English.
- A block that is `done` is never moved. The only legal path out of `done` is `needs_rework`, and this skill uses it in exactly one place: step 9 rework, before the gate is approved.

## Step 0: Start

1. Call `mcp__driver__plan_status`.
2. No plan yet: run `driver init <directory-name>` with Bash, then call status again.
3. Phase is past discover: **amend mode** (see Modes). Never reopen the Discovery block.
4. `.claude/driver/discover/interview.md` exists. Read it, then:
   - `status: closed` and the phase is still `discover`: go to **step 9** (gate check or rework). Do not use amend mode.
   - `status: closed` and the phase is past discover: amend mode.
   - `status: open`: **resume mode**. Say "N settled, frontier: ..." in one line and continue the loop. Never re-ask a settled node. If the file has a `batch-applied:` line, the exit batch already ran (fully or partly): continue at step 8.3 under the resume rules there, never re-add what is in the plan.
5. Find the block: call `mcp__driver__plan_status` with `scope: "phase"` and `phase: "discover"`. That result lists titles (the summary scope returns bare ids only). Match the block titled "Discovery interview" by title. Create it with `block.add` (phase discover) only if it is absent. Move it to `in_progress` only if its status is `not_started`. In amend mode, skip this and follow the Modes section.

## Step 1: Classify (round 1)

Make one `AskUserQuestion` call with two questions. This is the only call that bundles questions.

- **Domain**: three options inferred from the argument (for example web app, document or deck, data or automation) and "Not sure".
- **Size**, by effort: "An afternoon", "A few days", "A few weeks", "Months or a team".

"Not sure" on either: infer from the description, log the guess as an assumption (`A-nn`), and say so in one line. Do not offer reclassification here. It is offered once, at the end of round 1 (step 4.7).

## Step 2: Proportionality

| Class | Signal | Rounds | Max questions per round | Route implement and validate blocks |
|---|---|---|---|---|
| XS | an afternoon | 1 + play back | 3 | 2 to 4 |
| S | a few days | 2 + play back | 4 | 4 to 8 |
| M | a few weeks | 3 + play back | 6 | 8 to 15 |
| L | months or a team | 3 or more, until the frontier is empty | 8 | 15 to 30 |

The block range counts implement and validate blocks only. The Discovery interview, Route plan, Evolve review and Release blocks are fixed overhead and do not count.

XS gets lighter ceremony: no reclassification question, non-goals are stated in the play back instead of a multiSelect question, and round 1 covers all themes.

Money, personal data, production systems, irreversible actions or a regulated domain raise the Discover depth by one class. They do not change the block range. Record the final class in the exit batch as `decision.add` with title `Project size class: M`.

Create `.claude/driver/discover/interview.md` now from `${CLAUDE_SKILL_DIR}/templates/interview.md`, with the class, domain and language filled in.

## Step 3: Themes per round

| Round | Theme |
|---|---|
| 1 | Context and breadth: goal, users, success signal, existing assets, deadline, budget |
| 2 | Requirements and constraints: features, non-functional needs, external providers and the env var names of their credentials (names only) |
| 3 | Confirmation and non-goals: a multiSelect of candidate non-goals, then the play back |

Smaller classes merge themes: XS covers all three in one round, S merges 2 and 3. Update `round:` in the frontmatter at each change.

## Step 4: The frontier loop

A decision tree node is one question. A node is on the **frontier** when it is open and every node it depends on is settled or assumed. Repeat until the round cap or until the theme's frontier is empty:

1. **Recompute the frontier** from `## Decision tree`.
2. **Settled-decisions test.** If `assumptions.md`, an earlier answer, the plan requirements or the repository already answers a node, mark it `settled` with the source and move on. Do not ask it.
3. **Fact or decision?** A fact can be answered from the repo, the docs or the web without the user's preference ("which Node version does the repo use"). Start a read-only subagent in the background for each fact: `Agent` with `subagent_type: "Explore"` (read-only), `model: sonnet`, `run_in_background: true`. Tell it to report and not write anything. Mark the node `researching` and keep interviewing. When the report arrives, the node becomes a settled fact or the recommendation of a later question.
4. **Rank the decisions** by impact times uncertainty. Impact is the nodes it unlocks plus the cost of reversing it. Uncertainty is high when there is no safe default.
5. **Ask the top one** with `AskUserQuestion` (step 5).
6. **Record at once.** Append to `## Rounds`, update the node row, add the child nodes the answer opens. Use Edit. Do this before you ask the next question.
7. **Stop the round** at the cap for the class, or when the theme's frontier is empty. Say which round you finished and what comes next. At the end of round 1 (classes S and above), offer reclassification once ("Keep class S?"), then set `reclassified: yes` or `no` in the frontmatter. If `reclassified` is already set, never offer it again.

Never ask two decisions in one turn (except step 1 and the exit questions). Never ask what you can read.

## Step 5: Question shape

Details and examples are in `${CLAUDE_SKILL_DIR}/question-format.md`. The short version:

- `header` up to 12 characters. Two or three real options plus a last option "Not sure / decide for me" (the tool allows 2 to 4 options).
- Recommended option first, label ending in `(Recommended)`. Every `description` states the consequence of that choice.
- The question text ends with `Why it matters: ...`.
- The tool adds an "Other" field by itself. Do not add your own.
- If the answer comes back empty or looks auto-generated (timeout), treat it as "Not sure". Never treat it as acceptance.

## Step 6: "Not sure"

| Kind of node | What you do |
|---|---|
| Fact | Research it with a subagent. Re-ask with the finding as the recommended option (new information, so this is not a repeat). |
| Preference with a safe default | Adopt the recommendation. Write `A-nn` in `assumptions.md` (Accepted: pending). Tell the user in one line. |
| High impact, no safe default | Offer a quick Mermaid sketch in the chat, or defer the node (`status: deferred`). |

Deferral by class: M and L defer to round 3. XS and S have no round 3, so a deferred node goes straight to the play back as an open question. On "Accept all" (step 8.2), a deferred node that is still open becomes an assumption `A-nn` with the recommended default, and is listed in the Discovery block Handoff.

## Step 7: Optional checkpoint (classes M and L)

Before the play back, ask once: "Pre-mortem", "Red team", "Socratic", "Skip". Recommend Skip for S and below. Pre-mortem: imagine the project failed in a month and list why. Red team: attack the assumptions. Socratic: ask the user to justify the riskiest requirement. Run the chosen method for at most five exchanges. Nodes it surfaces go into the tree and the frontier. Set `checkpoint:` in the frontmatter (`none`, `pre-mortem`, `red-team`, `socratic` or `skipped`) as soon as the user answers. If `checkpoint` is already set to anything but `none`, never ask again.

## Step 8: Exit

1. **Play it back** in the chat: goal, requirements (with kind), assumptions, non-goals (for XS, state them here), deferred questions, class. Keep it under one screen.
2. Ask with `AskUserQuestion`: "Accept all (Recommended)", "Change something", "Something is missing". Loop until the user accepts. Update the files after each change. On "Accept all": turn every still-open deferred node into an assumption `A-nn` with the recommended default, and set every `Accepted: pending` in `assumptions.md` to `Accepted: yes`.
3. **Write the plan in one batch** with `mcp__driver__plan_ops` (max 25 ops per call, split if needed, `expectedRevision` from the last status):
   - one `req.add` per requirement (`source: "user"`),
   - one `req.add` per assumption: `kind` is required and chosen by the content of the assumption (`functional`, `nonfunctional` or `constraint`; default `constraint`), `source: "assumed"`, `ref: ".claude/driver/discover/assumptions.md"`,
   - one `req.add` per non-goal (`kind: "non-goal"`, `source: "user"`),
   - one `decision.add` for the size class.

   Assumed requirements need implement and validate coverage in Route like any other requirement. Only non-goals are exempt.

   Right after each successful `plan_ops` call, write the ids from its result into `interview.md` (the frontmatter field `batch-applied`, or a line in a `## Exit` section) as `batch-applied: R-001..R-0nn, D-00n`. With several calls, extend the value. This line is what makes the exit idempotent.

   **Resume and rework rule.** If a `batch-applied` line exists (step 0.4 resume, or step 9 rework): compare the ids with `plan_status` and the requirements in the plan, then add only requirements that are not yet in the plan. A requirement the user changed is retired with `req.retire` plus a `decision.add` and then re-added as a new one. Never re-add an existing requirement.
4. Read the created ids from the result. Write `.claude/driver/requirements/R-nnn.md` for each requirement, assumption and non-goal, using `${CLAUDE_SKILL_DIR}/templates/requirement.md` (the tool may have created a stub with `id` and `title`: Read it first, then Write the full file, keeping those two fields). Then back-fill the R ids into `assumptions.md` and `non-goals.md` (formats: `${CLAUDE_SKILL_DIR}/templates/assumptions.md`, `${CLAUDE_SKILL_DIR}/templates/non-goals.md`). Set `status: closed` in `interview.md`.
5. Close the Discovery block: `block.set` with `addArtifacts` for the three files `.claude/driver/discover/interview.md`, `.claude/driver/discover/assumptions.md` and `.claude/driver/discover/non-goals.md`; write `## Handoff` in its `.claude/driver/blocks/B-nnn.md` (include the deferred nodes that became assumptions); `set_block_state` to `in_review`; verification (see conventions, section 2); `set_block_state` to `done`. The user's acceptance in step 8.2 is the evidence.
6. Tell the user: type `/driver approve route` or press Approve in the pane. Approval does not start a model turn: "then send any message, or run `/driver:route`". **End your turn.** Do not start Route in the same turn.

## Step 9: After the gate

On the user's next message (or when step 0.4 sends you here), call `plan_status`.

- Gate `route` approved: run `phase.advance` (once), then invoke the `route` skill with the `Skill` tool.
- Not approved and the user says something is wrong: **rework**. The Discovery block is `done` but the gate is not approved, so this is the one place this skill leaves `done`. Sequence: `set_block_state` `done` to `needs_rework` (with a reason), then `needs_rework` to `in_progress`. Note that `needs_rework` clears the old verification, so review and verification are redone at the next close. Set `status: open` in `interview.md`, reopen the affected nodes, repeat step 4 for those nodes and step 8 after (apply the resume and rework rule in 8.3: never re-add existing requirements).
- Not approved and the user says nothing about it: remind them once what to type. Do not advance.

## Modes

- **Resume**: step 0.4. Continue from the frontier.
- **Amend** (phase past discover, or `amend <topic>`): a scoped interview on one topic, with the same files (append new `Q-nn`, `A-nn`, `N-nn`). The Discovery block is `done` and is never reopened. Instead:
  1. Create a new block titled `Discovery amend: <topic>` with `block.add` (phase discover, no `dependsOn`) and put it `in_progress`. Look it up by title with `plan_status` `scope: "phase"` first, so a resumed amend does not create a second one.
  2. Run steps 4 to 8, scoped to that topic. New `req.add` ops only. To change an existing requirement, retire it with `req.retire` plus a `decision.add`, then add the new one. The `batch-applied` rule of step 8.3 applies.
  3. Close the amend block exactly like the Discovery block: `addArtifacts`, `## Handoff`, `in_review`, verification, `done`.
  4. Tell the user Route must re-plan (`/driver:route replan <reason>`). Gates stay as they are.

## Red flags

| Thought | Reality |
|---|---|
| "I will batch five questions to go faster." | One decision per turn. Batches lose answers and hide dependencies. |
| "The user said not sure, I will ask again." | Never re-ask without new information. Research, adopt a safe default as `A-nn`, or defer. A re-ask is fine only with a new finding. |
| "I can add the requirements to the plan as we go." | Nothing is ever deleted. Early requirements that change become retire noise. One batch at the end. |
| "The user seems happy, I will approve the gate for them." | Only the user approves. Say what to type and stop. |
| "This is a small script, but the full interview is safer." | Ceremony scales with size. XS gets one round. |
| "I will edit plan.json to fix the revision." | Never. Call status again and retry with the new revision. |
| "I already know the answer from the repo." | Then mark the node settled with the source. Do not ask it. |
| "A subagent can add the requirements." | Subagents read and report. Only you write to the plan. |
| "The interview is in my context, files can wait." | Compaction erases context. Update `interview.md` after every answer. |
| "Asking for the API key now saves time." | Names of env vars only. Never values. |
| "The Discovery block is done, I will reopen it to amend." | Never move a `done` block outside step 9 rework. Amend uses a new block. |
| "The batch failed halfway, I will run it again." | Read the `batch-applied` line and the plan first. Add only what is missing. |
