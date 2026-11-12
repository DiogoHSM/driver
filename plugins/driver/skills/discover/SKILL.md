---
name: discover
description: Run the DRIVER Discover phase. A short interview about the product, with technical areas decided only if the user wants, that turns a project idea into requirements, accepted premises and non-goals in .claude/driver, then hands off to the human route gate. Use when starting a project or feature with DRIVER, when the plan is in phase discover, or when the user asks to define, scope or interview for a project.
user-invocable: true
argument-hint: "[one-line project idea | amend <topic>]"
disable-model-invocation: false
allowed-tools: AskUserQuestion, Read, Write, Edit, Glob, Grep, Agent, Skill, Bash(driver *), mcp__driver__plan_ops, mcp__driver__set_block_state, mcp__driver__plan_status, mcp__driver__discover_log, mcp__driver__block_doc, mcp__driver__req_doc, mcp__driver__backlog
---

# Discover

Read `${CLAUDE_SKILL_DIR}/../../references/driver-conventions.md` first. It defines the tools, the reducer rules, the file formats, the artifact path convention and the hard rules. This skill does not repeat them.

Goal: settle the decisions that shape the project, asking the user only what only the user can answer, then put requirements, premises and non-goals into the plan and hand off to the user's `route` gate. You interview. You do not design, estimate blocks or write code.

Principles:

- One question per turn, asked with `AskUserQuestion`. Formats and worked examples: `${CLAUDE_SKILL_DIR}/question-format.md`. Read it before your first question.
- Product questions are the user's. Technical details are the user's only if the user picks that area. Everything else you decide and log as an assumption with a reason.
- Every budget is a ceiling, not a target. A node with a safe default that is cheap to reverse is not asked.
- Facts are yours. Research facts with subagents. Ask only what needs a human preference.
- The log is silent. You record every answer with `mcp__driver__discover_log` and never write the interview files by hand (see "The silent log").
- "Not sure" never blocks the interview.
- **Language.** Everything the user sees is in the user's language: question text, headers, option labels (including the "(Recommended)" suffix, "Not sure / decide for me" and "That is enough, summarize", translated), descriptions and the summary. Only `discover/summary.md` is a user document written entirely in the user's language, headings included. Every other file keeps English headings.
- **No text before a tool call.** Text you write before a tool call in the same turn is condensed in the terminal and the user does not see it. So orientation lines ("Core done, 2 area questions to go, then the summary"), "I assumed X" notes, the remaining-count notice and the size note go inside the next question's text, or in the final summary. Never in a separate message before a tool call. Only name steps that exist and will happen.
- A block that is `done` is never moved. The only legal path out of `done` is `needs_rework`, and this skill uses it in exactly one place: step 10 rework, before the gate is approved.
- Secrets: if the user types a secret value in a free-text answer, never log the value. Log the env var name instead, and tell the user inside the next question or the summary to rotate that secret.

Flow: Start, Classify, Core, Areas gate, Area questions, Checkpoint (M and L only), Summary, Accept, Exit batch, Gate handoff, After the gate.

## The silent log

Everything about the interview lives in `.claude/driver/discover/interview.jsonl`, written only by the CLI. The tool `mcp__driver__discover_log` (CLI: `driver discover log`, JSON on stdin; `driver discover show` prints the state) appends to it and regenerates `interview.md`, `assumptions.md` and `non-goals.md` in the same folder. These three files are read-only output for the user and for Route.

Input is `{ meta?, nodes?, nonGoals? }`, all optional.

- `meta` keys: `goal`, `class` (XS, S, M, L), `domain`, `language`, `stage` (core, areas, summary, closed), `areas` (the list offered), `chosenAreas`, `checkpoint` (none, pre-mortem, red-team, socratic, skipped), `accepted` (boolean), `batchApplied` (string).
- `nodes[]` keys: `id` (Q-nn; omit to create the next one), `question`, `area` ("core" or the area name), `dependsOn`, `kind` (fact, decision), `status` (open, researching, settled, assumed, deferred), `answer`, `source` (user, research, assumed), `options` (the ones shown), `why` (required when `status` is assumed), `requirement` (R-nnn).
- `nonGoals[]` keys: `id` (N-nn; omit to create), `statement`, `reason`, `requirement`.

Creating a node needs `question` and `kind`. Updates are by `id`; an absent field keeps its value. A node that becomes `assumed` gets its `A-nn` automatically. A call with no keys returns whether an interview exists (`exists`), the current state and the frontier (open nodes whose `dependsOn` are all settled or assumed).

Rules:

- Call it once after each answer. One call carries the answered node plus any new child nodes and assumptions the answer opens. A new node that depends on another node created in the same call does not work (an explicit unknown id is refused): create the parent in a first call and the child in a second.
- Log assumptions the moment you decide them: `status: assumed`, `source: assumed`, `answer` (the choice), `why` (one line).
- A node you actually asked always carries `options`. If the user picked an option, `source: user`. If the user answered "Not sure", log it `status: assumed`, `source: assumed`, with `options` present. So asked-but-undecided and never-asked nodes can be told apart, and the progress count can be rebuilt after a compaction (asked questions = nodes with `options`, plus the areas gate and always-ask questions already counted in the progress text).
- Areas are not nodes. They live only in `meta.areas` and `meta.chosenAreas`. Never log a node per offered area.
- Never use `sed`, shell redirection or heredocs on files under `.claude/driver/`, and never edit `interview.jsonl`, `interview.md`, `assumptions.md` or `non-goals.md`. Use the tools. In Discover, Write is for exactly one file, `.claude/driver/discover/summary.md` (Route writes `route/summary.md` and `route/risks.md`); always Read the file first if it exists, then Write. Requirement files are written with `mcp__driver__req_doc`, block documents with `mcp__driver__block_doc`.

## Step 0: Start

1. Call `mcp__driver__plan_status`.
2. No plan yet: run `driver init <directory-name>` with Bash, then call status again.
3. Phase is past discover: **amend mode** (see Modes). Never reopen the Discovery block.
4. Call `mcp__driver__discover_log` with no keys and apply this precedence, in this exact order:
   1. `exists` is false: fresh start, go to step 1 (Classify). The default `stage: core` of an empty state means nothing.
   2. Else, `meta.batchApplied` is set, or `meta.accepted` is true and `stage` is not `closed`: continue the exit batch (step 9) under its idempotency rule. Do not show the summary again and do not ask for acceptance again.
   3. Else, `stage` is `summary`: Read `.claude/driver/discover/summary.md` and show it in full as your final message (step 7), unless the user's current message already replies to it (then go to step 8).
   4. Else, `stage` is `closed`: if the phase is still `discover`, go to step 10; if the phase is past discover, amend mode.
   5. Else, resume the interview from the frontier. Put "N settled, frontier: ..." and the progress count inside the next question's text. Never re-ask a settled node.
5. Find the block: call `mcp__driver__plan_status` with `scope: "phase"` and `phase: "discover"`. That result lists titles (the summary scope returns bare ids only). Match the block titled "Discovery interview" by title. Create it with `block.add` (phase discover) only if it is absent. Move it to `in_progress` only if its status is `not_started`. In amend mode, skip this and follow the Modes section.

## Step 1: Classify

Make one `AskUserQuestion` call with two questions. This is the only call that bundles questions, and it is not counted in the progress number or in any budget. It is not logged as nodes: log only `meta` (`class`, `domain`, `language`, `goal` from the argument if any, `stage: "core"`).

- **Domain**: three options inferred from the argument (for example web app, document or deck, data or automation) and "Not sure".
- **Size**, by effort: "An afternoon", "A few days", "A few weeks", "Months or a team".

"Not sure" on either: infer from the description, and say so inside the next question's text. If later answers contradict the size, say so in one line inside the Summary (step 7) and let the user change it there.

## Step 2: Proportionality

Every number is a ceiling, not a target.

| Class | Signal | Core questions | Area questions in total | Areas gate | Checkpoint | Route blocks |
|---|---|---|---|---|---|---|
| XS | an afternoon | 2 | 0 | skipped | no | 2 to 4 |
| S | a few days | 4 | 3 | 1 question | no | 4 to 8 |
| M | a few weeks | 6 | 6 | 1 question | up to 3 exchanges | 8 to 15 |
| L | months or a team | 8 | 9 | 1 question | up to 3 exchanges | 15 to 30 |

- Area questions are the total across all chosen areas, and at most 3 in any one area.
- Always-ask questions (step 4): at most 2 in the whole interview, outside both budgets, every class.
- The block range counts implement and validate blocks only; the Discovery interview, Route plan, Evolve review and Release blocks are fixed overhead and do not count.
- Record the size class in the exit batch with `decision.add` (title `Project size class: M`) and nowhere else in the plan.

Size never goes up because of risk. What the user decides in detail depends on the areas they pick.

## Step 3: Core

Core nodes are product questions only the user can answer:

1. The goal and the success signal (how will they know it worked).
2. The audience.
3. The must-have capabilities.
4. What is out (candidate non-goals).

Loop, until the core budget is spent, the core nodes are all settled or assumed, or the user picks "That is enough, summarize":

1. **Apply the default test to every node before asking it.** If it has a safe default and is cheap to reverse, do not ask. Log it as an assumption with the choice and a one-line reason. Also do not ask what the repository, an earlier answer or an existing assumption already answers: mark it `settled` with the source.
2. **Fact or decision?** A fact can be answered from the repo, the docs or the web without the user's preference. Start a read-only subagent in the background for each fact: `Agent` with `subagent_type: "Explore"`, `model: sonnet`, `run_in_background: true`. Tell it to report and not write anything, and not to call any `mcp__driver__*` tool. Log the node as `researching` and keep interviewing. When the report arrives, the node becomes a settled fact or the recommendation of a later question.
3. **Rank the remaining decisions** by impact times uncertainty. Impact is what it unlocks plus the cost of reversing it. Uncertainty is high when there is no safe default.
4. **Ask the top one** (see "Asking a question"), then log the answer.

Put the expected maximum in the first question's text ("(1 of ~4)"). Non-goals the user names, or that you state in the summary, are logged with `nonGoals` before the summary is shown, in every class.

When the core is done, log `meta.stage: "areas"` (S, M, L) or `"summary"` (XS, which skips steps 4 to 6).

## Step 4: Areas gate (S, M and L)

Ask one multiSelect `AskUserQuestion`: "Which areas do you want to decide in detail?". Offer 2 to 4 areas derived from the domain. Examples:

- Web app or site: infrastructure and hosting; data and privacy; design and content; metrics.
- Document or deck: audience and tone; structure and length; visuals and branding; delivery and format.
- Data or automation: data sources and quality; scheduling and triggers; error handling and alerts; outputs and storage.

Selecting nothing is allowed and means "decide everything for me". Log `meta.areas` and `meta.chosenAreas` only. Right after the gate, the next question's text states the real remaining total ("(6 of ~9: 3 more questions in your areas, then the summary)").

- **Chosen area**: up to 3 questions in it, and no more than the class total (step 5).
- **Area not chosen**: you decide every node in it and log each as an assumption with the choice and a reason. These decisions appear in the Summary grouped by area.

**Always-ask exception (closed list).** A decision in a skipped area, or one you would otherwise assume, is asked when it is one of these:

- it spends money;
- it collects payment, health, identity-document or minors' data;
- it deletes or overwrites data that cannot be restored;
- it creates a legal or contractual commitment.

Ask only when no safe default exists. At most 2 such questions in the whole interview, outside both budgets, in every class including XS. These are NOT triggers: deploying a site, choosing hosting or a database, and a contact e-mail field. A newsletter list or a waitlist with only an e-mail is not sensitive data.

## Step 5: Area questions

For each chosen area, use the same loop as step 3 (default test first, facts to subagents, ranking, one question, log). Stay inside the per-area cap (3) and the class total (S 3, M 6, L 9). A skipped question in a chosen area is fine: log the assumption. When all chosen areas are done, log `meta.stage: "summary"`, or go to step 6 for M and L.

## Step 6: Checkpoint (classes M and L only)

Ask once: "Pre-mortem", "Red team", "Socratic", "Skip", translated. Recommend Skip unless the project has money or production in it. Pre-mortem: imagine the project failed in a month and list why. Red team: attack the assumptions. Socratic: ask the user to justify the riskiest requirement. Run the chosen method for at most 3 exchanges. Nodes it surfaces are logged and handled like any node (default test first). Log `meta.checkpoint` as soon as the user answers. If `checkpoint` is already set to anything but `none`, never ask again. Classes XS and S skip this step without asking.

## Asking a question

Details and examples are in `${CLAUDE_SKILL_DIR}/question-format.md`. The short version:

- `header` up to 12 characters. Real options, recommended first with the suffix "(Recommended)" translated into the user's language, then "Not sure / decide for me" (translated). The tool allows 2 to 4 options.
- Every `description` states the consequence of that choice. The question text ends with "Why it matters: ..." (translated).
- **Progress in the question text**, for example "(3 of ~6)". Count every question after the classify call (core, areas gate, area questions, always-ask questions). The number after `~` is your current estimate of the total and may change; never above the ceilings in step 2.
- **From the third question on**, one option is "That is enough, summarize" (translated). Picking it: create and assume, each with a `why`, every remaining decision the plan needs (in chosen and unchosen areas), log `checkpoint: skipped` if the class had a checkpoint, and jump to the Summary. With the 4-option limit, that leaves at most 2 real options plus "Not sure / decide for me" plus "enough".
- The tool adds an "Other" field by itself. Do not add your own.
- If the answer comes back empty or looks auto-generated (timeout), treat it as "Not sure". Never treat it as acceptance.
- A high-impact node with no safe default is simply asked.

## "Not sure"

| Kind of node | What you do |
|---|---|
| Fact | Research it with a subagent. Re-ask with the finding as the recommended option (new information, so this is not a repeat). |
| Preference with a safe default | Adopt the recommendation. Log it as an assumption with the reason (`source: assumed`, `options` present). Mention it in the next question's text. |
| High impact, no safe default | Defer the node (`status: deferred`). It is listed under open questions in the summary. |

A deferred node that is still open at the Summary is listed under open questions, and turns into an assumption with the recommended default when the user accepts.

## Step 7: Summary

The summary is the last thing in your turn: plain message text in the user's language, and **no tool call after it in this turn**. Text written before a tool call is condensed in the terminal; only the final message of a turn is reliably shown in full. Never put a question tool after the summary, and never ask "is the summary above correct?" with `AskUserQuestion`.

Order inside the turn:

1. Log the non-goals with `nonGoals` and any last assumptions, and `meta.stage: "summary"`.
2. If `.claude/driver/discover/summary.md` exists, Read it. Then write the full summary text to it with Write, using `${CLAUDE_SKILL_DIR}/templates/summary.md` as the structure. Headings are in the user's language.
3. Then, as the final message and with no tool call after it, show the same text in full.

Structure: goal; what will be built; what you decided (the user's answers); what I decided for you (each assumption with its reason, grouped by area); what stays out; open questions if any; size class. If the answers contradict the size, add one line saying so and offer to change the class. End with one line asking the user to reply "accept", or say what to change, ask why something was decided, or open a skipped area (in the user's language). Keep it readable: one short paragraph or a few bullets per section. End the turn.

## Step 8: Accept

The user's next message decides:

- **Accept** (an explicit acceptance, in any wording): go to step 9. Never claim the user accepted without an explicit acceptance in their message. Silence, a timeout, "ok but..." or a question is not acceptance.
- **A change**: update the log (the node, or the class in `meta`), Read and rewrite `summary.md`, and show the full summary again as the final message, with no tool call after it.
- **A "why" question**: answer it from the log, then repeat the closing line. If the answer shows a wrong assumption, treat it as a change.
- **Open a skipped area**: ask that area's questions (max 3, step 5), log the answers, then write and show the summary again (step 7).

Loop until acceptance. On acceptance, still-open deferred nodes become assumptions with the recommended default (step 9).

## Step 9: Exit batch

The existence check in 9.2 and 9.3 precedes every write to the plan, on a first run, on resume and on rework.

1. As soon as the user's message accepts, and before anything else, call `mcp__driver__discover_log` with `meta.accepted: true`. Log still-open deferred nodes as assumptions with the recommended default in the same call.
2. Read `.claude/driver/plan.json` with Read and list the existing requirement titles (`plan_status` does not return requirements). Call `mcp__driver__discover_log` with no keys to read the final nodes, `A-nn` ids and non-goals.
3. **What becomes a requirement.** Only nodes that state something the product must do or respect. Never the classify answers (domain, size), never area selection. Send `req.add` only for items whose title is not already in the plan:
   - settled user product decisions: `req.add` with `source: "user"`;
   - assumed decisions that constrain the build: `req.add` with `source: "assumed"`, `ref: ".claude/driver/discover/assumptions.md"`, and a required `kind` chosen by content (`functional`, `nonfunctional` or `constraint`; default `constraint`);
   - non-goals: `req.add` with `kind: "non-goal"`, `source: "user"`;
   - everything else stays in the log only.

   Add one `decision.add` for the size class (title `Project size class: M`) unless one already exists. Max 25 ops per call, split if needed, `expectedRevision` from the last status. Assumed requirements need implement and validate coverage in Route like any other requirement; only non-goals are exempt.
4. Right after each successful `plan_ops` call, call `mcp__driver__discover_log` with `meta.batchApplied` set to the ids from the result (for example `R-001..R-012, D-001`; with several calls, extend the value). Then send `requirement` (R-nnn) on each node and each `nonGoals` entry so the generated files link to the plan.
5. **Resume and rework.** Run 9.2 and 9.3 again first. A requirement the user changed is retired with `req.retire` plus a `decision.add`, then re-added as a new one. Never re-add an existing title.
6. Write the requirement documents with `mcp__driver__req_doc`: one call, `{ requirements: [ { id, statement, acceptance, origin, notes } ] }` for each requirement, assumption and non-goal (1 to 30 per call), following `${CLAUDE_SKILL_DIR}/templates/requirement.md`. Then call the log with `meta.stage: "closed"`.
7. Close the Discovery block: `block.set` with `addArtifacts` for `.claude/driver/discover/interview.md`, `.claude/driver/discover/assumptions.md`, `.claude/driver/discover/non-goals.md` and `.claude/driver/discover/summary.md`; write its `## Handoff` with `mcp__driver__block_doc` (`handoff` on the Discovery block, which is `in_progress`; include the deferred nodes that became assumptions); `set_block_state` to `in_review`; verification (see conventions, section 2); `set_block_state` to `done`. The evidence is `meta.accepted: true` in the log.
8. **Gate handoff.** Tell the user: type `/driver approve route` or press Approve in the pane. Approving moves the plan to route and starts the Route skill by itself, with no further message needed (ADR-014); say so, and add the fallback "if nothing starts, run `/driver:route`". **End your turn.** Do not start Route in the same turn.

## Step 10: After the gate

On the user's next message (or when step 0.4 sends you here), call `plan_status`.

- Gate `route` approved: if `plan_status` reports the approval as unverified, stop and tell the user; do not advance. Otherwise run `phase.advance` only if the phase is still `discover` (the pane usually advanced it already), then invoke the `driver:route` skill with the `Skill` tool.
- Not approved and the user says something is wrong: **rework**. The Discovery block is `done` but the gate is not approved, so this is the one place this skill leaves `done`. Sequence: `set_block_state` `done` to `needs_rework` (with a reason), then `needs_rework` to `in_progress`. `needs_rework` clears the old verification, so review and verification are redone at the next close. Log `meta.accepted: false`, the affected nodes as `open` and `meta.stage: "areas"`, ask them (default test first), then go through steps 7 to 9 again (the existence check of step 9 applies: never re-add existing requirements).
- Not approved and the user says nothing about it: remind them once what to type. Do not advance.

## Modes

- **Resume**: step 0.4. Continue from the frontier.
- **Amend** (phase past discover, or `amend <topic>`): a scoped interview on one topic, with the same log (new `Q-nn`, `A-nn`, `N-nn` are appended). The Discovery block is `done` and is never reopened. Instead:
  1. Read the backlog with `mcp__driver__backlog` (no items). If it has entries, offer them as the starting topics (with `amend` and no topic, or as suggestions next to the given one).
  2. Create a new block titled `Discovery amend: <topic>` with `block.add` (phase discover, no `dependsOn`) and put it `in_progress`. Look it up by title with `plan_status` `scope: "phase"` first, so a resumed amend does not create a second one. Log `meta.stage: "core"` and `meta.accepted: false`.
  3. Run steps 3 to 9, scoped to that topic (core questions only about the topic; `summary.md` is rewritten after Reading it). New `req.add` ops only. To change an existing requirement, retire it with `req.retire` plus a `decision.add`, then add the new one. The existence check of step 9 applies.
  4. Close the amend block exactly like the Discovery block: `addArtifacts`, `## Handoff`, `in_review`, verification, `done`.
  5. Tell the user Route must re-plan (`/driver:route replan <reason>`). Gates stay as they are.

## Red flags

| Thought | Reality |
|---|---|
| "I will batch five questions to go faster." | One decision per turn. Batches lose answers and hide dependencies. |
| "The user said not sure, I will ask again." | Never re-ask without new information. Research, adopt a safe default as an assumption, or defer. A re-ask is fine only with a new finding. |
| "I can add the requirements to the plan as we go." | Nothing is ever deleted. Early requirements that change become retire noise. One batch at the end. |
| "The user seems happy, I will approve the gate for them." | Only the user approves. Say what to type and stop. |
| "This is a small script, but the full interview is safer." | Ceremony scales with size. XS gets two core questions and no areas. |
| "I will edit plan.json to fix the revision." | Never. Call status again and retry with the new revision. |
| "I already know the answer from the repo." | Then mark the node settled with the source. Do not ask it. |
| "A subagent can add the requirements." | Subagents read and report. Only you write to the plan. |
| "The interview is in my context, the log can wait." | Compaction erases context. Call `mcp__driver__discover_log` after every answer. |
| "Asking for the API key now saves time." | Names of env vars only. Never values. |
| "The Discovery block is done, I will reopen it to amend." | Never move a `done` block outside step 10 rework. Amend uses a new block. |
| "The batch failed halfway, I will run it again." | Read `plan.json` and `meta.batchApplied` first. Add only titles that are missing. |
| "I will put the summary before the question tool." | Text before a tool call is condensed in the terminal. The summary is the final message, with no tool call after it. |
| "I will say where we are before the next question." | Text before a tool call is not seen. Put the orientation inside the question text. |
| "This e-mail field is personal data, so I must go deeper." | A contact e-mail alone is not a trigger and never raises the size. The always-ask list is closed. |
| "Hosting is expensive to get wrong, I will ask." | Choosing hosting, a database or deploying a site is not a trigger. Assume it with a reason. |
| "I will edit interview.md directly." | The three generated files belong to the CLI. Use `mcp__driver__discover_log`. Never `sed`, redirection or heredocs on `.claude/driver/`. |
| "The user did not object, so they accepted." | Acceptance must be explicit in their message. Otherwise show the summary again. |
| "This low-impact detail deserves a question." | If it has a safe default and is cheap to reverse, log an assumption with a reason instead. |
| "I will write the requirement files with Write." | Use `mcp__driver__req_doc`. |
| "The user pasted a key in the answer, I will log it." | Log the env var name only and tell the user to rotate the key. |
