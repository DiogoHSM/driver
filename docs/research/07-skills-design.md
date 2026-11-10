# Design: DRIVER `discover` and `route` skills

Raw design produced by the planning agent (opus) on 2026-10-30, lightly edited. The approved plan is `.claude/plans/2026-10-30-skills-discover-route.md`; the decisions are ADR-012 and the closed ADR-008 in `.claude/docs/DECISIONS.md`. Where this document and the plan differ, the plan wins.

## Frontmatter

**discover**

```yaml
name: discover
description: Run the DRIVER Discover phase. A structured interview that turns a project idea into requirements, accepted premises and non-goals in .claude/driver, then hands off to the human route gate. Use when starting a project with DRIVER, when the plan is in phase discover, or when the user asks to define, scope or interview for a project.
user-invocable: true
argument-hint: "[one-line project idea | amend <topic>]"
disable-model-invocation: false
allowed-tools: AskUserQuestion, Read, Write, Edit, Glob, Grep, Agent, Bash(driver *), mcp__driver__plan_ops, mcp__driver__set_block_state, mcp__driver__plan_status
```

**route**

```yaml
name: route
description: Run the DRIVER Route phase. Decompose approved requirements into a block graph with dependencies, acceptance criteria, risk and providers, validate the diagram with the user, then advance to implement. Use after gate route is approved, or when Evolve asks for a re-plan.
user-invocable: true
argument-hint: "[replan <reason>]"
disable-model-invocation: false
allowed-tools: (same list)
```

Both skills leave model invocation on, because Discover hands off with "invoke the `route` skill" and the model can only do that if invocation is allowed. Neither one uses `context: fork`.

## Discover protocol

**0. Start.** Call `plan_status`.
- If there is no plan, run `driver init <dir-name>` through Bash.
- If the phase is past discover, switch to **amend mode**: interview only the topic named in the argument, add requirements, then tell the user that Route must re-plan.
- If `discover/interview.md` exists, **resume**: read the tree, report "N settled, frontier: ...", and carry on. Never re-ask a settled node.
- Find or create the block "Discovery interview" (phase discover) and move it to `in_progress`.

**1. Classify (round 1, the only bundled call).** Ask one AskUserQuestion call with two questions:
- Q1 *Domain*: three options inferred from the argument (for example web app / document or deck / data or spreadsheet), plus "Not sure".
- Q2 *Size*, using concrete effort options: "An afternoon", "A few days", "A few weeks", "Months or a team".
"Not sure" on either question: infer from the description, log the guess as an assumption, and say so.

**2. Proportionality (ADR-008).**

| Class | Signal | Rounds | Max questions/round | Route target blocks |
|---|---|---|---|---|
| XS | afternoon | 1 + playback | 3 | 2 to 4 |
| S | days | 2 + playback | 4 | 4 to 8 |
| M | weeks | 3 + playback | 6 | 8 to 15 |
| L | months | 3+ until frontier empty | 8 | 15 to 30 |

**Risk bump:** money, personal data, production systems, irreversible actions or regulated domains raise Discover depth by one class. Block count does not change. Record the class as `decision.add "Project size class: M"` in the exit batch.

**3. Round themes.**
- Round 1: context and breadth (goal, users, success signal, existing assets, deadline, budget).
- Round 2: specific requirements and constraints (features, NFRs, providers and credential env names per ADR-004).
- Round 3: confirmation plus explicit non-goals (a multiSelect of candidate non-goals).
Smaller classes merge the themes into fewer rounds.

**4. Frontier loop (one question per turn).** Repeat:
1. Recompute the frontier: open nodes whose `dependsOn` are all settled or assumed.
2. **Settled-decisions test:** if `assumptions.md`, an earlier answer or the repo already answers a node, mark it settled with a reference. Do not ask it.
3. **Fact or decision?** A fact can be answered from the repo, docs or the web without the user's preference. Dispatch a background read-only Agent (sonnet), mark the node `researching`, and keep interviewing. Results become settled facts, or they become the recommendation in a later question.
4. Rank the remaining decisions by impact × uncertainty: impact = downstream nodes unlocked plus cost of reversal; uncertainty = no safe default.
5. Ask the top decision with AskUserQuestion.
6. Record the answer, add the child nodes it opens, and append to `interview.md` immediately (this survives compaction).
7. Stop the round at the cap or when the theme's frontier is empty.

**5. Question shape.**
- `header` up to 12 characters.
- 2 to 3 real options plus a final "Not sure / decide for me", using AskUserQuestion's 2 to 4 option limit.
- Put the recommended option first, with label suffix "(Recommended)".
- Each `description` states the consequence. The question text ends with "Why it matters: ...".
- Ask in the user's language.

**6. "Not sure" handling. Never block.**
- Fact-like: research it, then re-ask with the finding as the recommendation.
- Preference with a safe default: adopt the recommendation and log it as `A-nn` (assumed).
- High impact with no safe default: offer a quick diagram or prototype, or defer the node to round 3.

**7. Optional checkpoint (M and L).** Before playback, offer an AskUserQuestion: "Pre-mortem / Red team / Socratic / Skip (Recommended for S)". Run the chosen method, and add any new nodes to the frontier.

**8. Exit.**
1. **Play it back** in chat: goal, requirements, assumptions, non-goals, class.
2. AskUserQuestion: "Accept all (Recommended) / Change some / Something missing". Loop until the user accepts.
3. **One `plan_ops` batch**: `req.add` for every requirement, assumed premise (`source:"assumed"`, `ref:"discover/assumptions.md"`) and non-goal (`kind:"non-goal"`), plus the size decision. Split at 25 ops per call. Rationale: nothing is ever deleted (ADR-010 item 7), so adding requirements mid-interview and then changing them would leave retire noise that needs a decision.
4. Write `requirements/R-nnn.md`, and back-fill the R ids into `assumptions.md` and `non-goals.md`.
5. Discovery block: `block.set addArtifacts` [the 3 discover files], write `## Handoff`, move to `in_review`, then `block.set verification {passes:true}` (the user's acceptance is the evidence), then `done`.
6. Tell the user: "Type `/driver approve route` or press Approve in the pane." End the turn.

**9. After the gate.**
- On the next turn, check `plan_status`. If the gate is approved, run `phase.advance` and invoke the `route` skill.
- If the user declines, ask what is wrong, move the discovery block `done → needs_rework` (with a reason) and then `in_progress`, reopen the affected nodes, and repeat from step 8.

## Discover artefacts

All under `.claude/driver/`.

- **`discover/interview.md`**: frontmatter `class`, `domain`, `round`, `language`, `status: open|closed`; `## Decision tree` table: `id (Q-nn) | question | dependsOn | kind fact|decision | status open|researching|settled|assumed|deferred | answer | source user|research|assumed`; `## Rounds` log: question, options shown, answer, timestamp.
- **`discover/assumptions.md`**: `## A-nn <statement>` with `Why assumed`, `Source node Q-nn`, `Accepted: yes|pending`, `Requirement: R-nnn`.
- **`discover/non-goals.md`**: `- N-nn <statement> (reason) -> R-nnn`.
- **`requirements/R-nnn.md`**: frontmatter `id`, `title`, `kind`, `source`. Sections `## Statement`, `## Acceptance signal` (observable, testable), `## Origin` (Q-nn or A-nn), `## Notes`.

## Route protocol

1. Call `plan_status`. Gate route not approved: stop and tell the user. Phase still discover: run `phase.advance`. Create or reuse the block "Route plan" (phase route, depends on the discovery block) and move it to `in_progress`.
2. **Inputs:** read `plan.json` (Read tool only), the R docs, the discover files and the size class. For brownfield work, optionally spawn a feature-dev `code-explorer` agent.
3. **Decomposition rules.**
   - **implement:** one deliverable per block that one agent finishes in one session (about one PR). Each block has an observable output.
   - **validate:** at least one block per requirement group, with layers that fit the domain. Acceptance is checked against the R docs, not only the plan.
   - **evolve:** exactly one "Evolve review" block.
   - **release:** one block with the release checklist.
   - `dependsOn` holds only real artifact dependencies (maximise parallelism). Root implement blocks depend on the route block.
   - Every non-non-goal requirement is linked to at least one implement block and at least one validate block. Non-goals are linked to none.
   - Risk is `high` for irreversible actions, money or personal data, new tech, or a block that rests on an assumed premise. `medium` for an external integration. Otherwise `low`.
   - Set `provider {capability, provider, access, credentials[]}` whenever a block needs an external capability.
   - Stay inside the class target block count. Going over needs a stated reason.
4. **Batch strategy:** `block.add` ops with `"$n"` references for `dependsOn`, at 25 ops or fewer per call. If there are more than 25, the first batch creates the roots and later batches use real ids. Then fill each `blocks/B-nnn.md` with Write.
5. **Self-review**, fixed in place: (a) requirement coverage; (b) block scan: every block has an output, an acceptance criterion and a size that fits one session; (c) dependency sanity: no cycles, no fake edges; (d) review focus: high-risk blocks have a validate partner and a mitigation; (e) proportion against the target count. Then run `driver validate`. Zero `req.coverage` warnings are required.
6. **Diagram validated:** point to the live pane, run `driver export mermaid`, and paste the Mermaid in chat for CLI users. AskUserQuestion: "Looks right (Recommended) / Adjust blocks / Adjust order / Re-split". Loop until the user picks "Looks right".
7. **Finish:** route block gets `addArtifacts` [`route/risks.md`, `exports/plan.mmd`] and a Handoff, then `in_review`, verification true, `done`. Run `phase.advance` to implement. Report the ready blocks.
8. **Replan mode (for Evolve later):** never edit done blocks. Add new blocks. Retire superseded ones with `block.retire` citing a `decision.add`. Rebaseline is user-only: tell the user to run it.

## Route artefacts

- **`blocks/B-nnn.md`**: `## Spec` purpose and scope; `## Acceptance criteria` a definition-of-done checklist, each item testable; `## Notes` with `Input:`, `Output:`, `Risk: level, why, mitigation`, `Provider:`; `## Handoff` left empty.
- **`route/risks.md`**: matrix `block | risk | likelihood L/M/H | impact L/M/H | mitigation | owner block`, plus a phase-level definition of done for each phase.

## Shared conventions

File `plugins/driver/references/driver-conventions.md`, outside `skills/` so it is not scanned as a skill. Each SKILL.md opens with "Read `${CLAUDE_SKILL_DIR}/../../references/driver-conventions.md` first." Contents:
- **Tools:** write through `plan_ops`, `set_block_state` and `plan_status` only. Fall back to `driver` (or `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js`). Always pass `expectedRevision` from the last status call. On refusal, read the reason and fix it. Never retry blindly.
- **Language:** talk to the user in their language. Keep file headings in English.
- **Hard rules:** never approve a gate or imply approval, never run rebaseline or `--force`, never write `plan.json`, `events.jsonl`, `log/` or `.mod/`, never delete (retire with a decision), credentials only as env var names, no subagent writes to the plan.
- File templates (the formats above) and the transition preconditions table.

## Tests

**Automatic** (new file `test/skills.spec.ts`): frontmatter parses and has `name` equal to the folder name, plus `description`; descriptions under 1024 characters; every `${CLAUDE_SKILL_DIR}` path resolves; every `mcp__driver__*` name and op name exists in `mod/tools.ts`; no `context: fork`; no em dashes. Also run `claude plugin validate` in CI.

**Manual dogfood:**
1. Copy `examples/web-waitlist` to a fresh directory without `.claude/`. Run the discover skill with "waitlist landing page".
2. Expect: class S, 2 rounds, at least 1 "Not sure" path logged as `A-nn`, 3 discover files, R docs equal in number to the plan's requirements (including at least 1 non-goal), and the discovery block `done`.
3. Approve in the pane. Expect the route skill to start automatically, produce 4 to 8 blocks, `driver validate` clean, `route/risks.md`, `exports/plan.mmd`, and phase implement.
4. Re-run discover. Expect the amend message and no re-asked questions.
5. Then use it on this repo for B-005.

## Risks and open points

1. AskUserQuestion allows only 2 to 4 options, so "Not sure" leaves room for 3 real options. The automatic "Other" field covers free text. `askUserQuestionTimeout` can auto-continue an unanswered question: treat an auto answer as "Not sure" and never treat it as acceptance.
2. Interview length: class L could run past 30 turns. Mitigation: the per-round cap and compaction-proof files.
3. A user with no idea of size gets an inferred class. Offer a one-time reclassification after round 1.
4. Requirements are written to the plan only at exit, so the pane shows nothing during the interview. The alternative is incremental `req.add` with retire noise.
5. This design does not invoke superpowers `writing-plans`, because it writes its own plan file. Only its self-review is adapted, which diverges from the ADR-003 composition table (deferred to B-006).
6. `${CLAUDE_PLUGIN_ROOT}` substitution inside skill bodies is unverified. The relative `${CLAUDE_SKILL_DIR}` path is the fallback.
7. The model sets `verification.passes` itself on the Discover and Route blocks, with the user's acceptance as evidence.
