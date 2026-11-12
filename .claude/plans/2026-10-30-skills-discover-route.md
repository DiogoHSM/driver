# Plan: Discover and Route skills (B-005)

## Context

`plan.json` v1 (`6dfb08a`), the live diagram mod (`77a61a1`) and the reworked guard (`358f67a`) are committed. DRIVER's own plan in `.claude/driver/` is in the Implement phase with B-005 "Discover and Route skills" in progress. Today the plugin has the CLI, the `mcp__driver__*` tools, hooks and the panel, but no skills: whoever uses DRIVER has to know how to call `plan_ops` by hand. The research (`docs/research/skills-landscape.md`, section 6) points to Discover and Route as the weakest point of the current manual pipeline and as the next step after the mod.

Expected result: two skills in the core (`plugins/driver/skills/discover/`, `plugins/driver/skills/route/`) that run the Discover interview (one question per turn with `AskUserQuestion`, options with a recommendation, assumption log on disk, non-goals, ADR-008 proportionality) and the Route decomposition (blocks with acceptance criteria, dependencies, risk, requirement coverage, validated diagram), writing to the plan only through the mod tools or the CLI. ADR-012 records the format and the decisions before the code. Dogfooding on a copy of `examples/web-waitlist` and, afterwards, on this repository.

## Facts gathered (do not re-explore)

- Skill format: `skills/<name>/SKILL.md` with frontmatter `name`, `description` (together ≤ 1,536 chars), optional `user-invocable`, `argument-hint`, `disable-model-invocation`, `allowed-tools`; body in markdown; support files alongside (`${CLAUDE_SKILL_DIR}`). No `context: fork` (the interview needs the history). The manifest does not need a `skills` key (directory convention). Precedent for `user-invocable: true` in the impeccable plugin. Slash name for a plugin skill not verified locally (`/driver:discover` likely); confirm on first load.
- superpowers 7.0.0 installed at `~/.claude/plugins/cache/claude-plugins-official/superpowers/7.0.0/skills/`: `brainstorming` (225 lines, free text, one question per message, spec in `docs/superpowers/specs/`), `writing-plans` (204 lines, 5-point self-review: spec coverage, step scan, type consistency, review focus, proportion). Neither uses `AskUserQuestion`. `grilling` (mattpocock) and spec-kit are not on the machine: only the notes in `docs/research/01-process-skills.md`.
- Writing to the plan: `mcp__driver__plan_ops` (1 to 25 ops; `block.add {title, phase, dependsOn?, requirements?, risk?, provider?}`, `req.add {title, kind functional|nonfunctional|constraint|non-goal, source user|assumed, ref?}`, `decision.add {title, reason?}`, `block.set {id, patch}`, `block.retire`, `req.retire`, `phase.advance`; `"$0"` references ids created in the batch), `mcp__driver__set_block_state`, `mcp__driver__plan_status`. Fallback: `driver` CLI via Bash. `block.add` creates `blocks/B-nnn.md` with empty sections `## Spec`, `## Acceptance criteria`, `## Notes`, `## Handoff`; `req.add` through the tool does not create `requirements/R-nnn.md` (the skill writes it). `discover/` is born empty in `init`. Only `plan.json`, `events.jsonl`, `log/*`, `.mod/*` are protected.
- Reducer preconditions: `in_progress` requires deps `done` and phase ≤ `currentPhase`; `in_review` requires ≥ 1 artifact and a filled `## Handoff`; `done` requires `verification.passes === true`; `blocked`/`needs_rework` require a reason; `phase.advance` to route requires an approved route gate (user only: `/driver approve route` in the composer or the panel button; the first approval creates baseline 1 and D-nnn); `req.coverage` is a warning until release.
- Gate hook: in `discover` subagents are allowed; from `route` on only with the route gate approved (Route runs after approval, so it can use subagents).
- Conventions from the examples: assumption = `req.add source:"assumed" ref:"discover/assumptions.md"`; non-goal = `kind:"non-goal"`; Discover block with artifact `discover/interview.md`.
- Vision (4.1, 4.2, 5, 7, 11): interview in ≥ 3 iterations for larger projects (context and breadth; requirements and constraints; confirmation and non-goals), "I don't know" option in every question, assumption log becomes a contract, diagram always present in Route, block with input, output, acceptance criterion, dependencies and risk, versioned plan (baseline), definition of done per block and phase, risk matrix; only two human gates; domain identification in the first iteration "without engineering".
- Rules to compose: grilling decision frontier (ask every decision whose prerequisites are resolved; facts belong to the agent via subagents, decisions to the user; ends when the frontier empties; recommendation such that "yes" accepts it); spec-kit clarify format (2 to 5 options, `Recommended`, "why it matters" line, impact × uncertainty ranking, per-round cap); compound-engineering (one question per turn, test of already-made decisions against the log). `AskUserQuestion`: 1 to 4 questions per call, 2 to 4 options each, automatic "Other" option.

## Design decisions (ADR-012, to be written before the code)

1. **Skills in the core, one per phase, native plugin skill format.** `plugins/driver/skills/discover/SKILL.md` and `plugins/driver/skills/route/SKILL.md`, `user-invocable: true`, description that triggers from context ("start a project or feature with DRIVER" / "plan after the route gate"). Skill text in English; the interview happens in the user's language.
2. **Interview with `AskUserQuestion`, one question per turn**, options with `(Recommended)` first and "why it matters" in the description, explicit "I don't know" option when it fits (triggers research by a subagent or a suggestion). Decision frontier kept in `discover/interview.md`; test of already-made decisions against `discover/assumptions.md` and the plan's requirements.
3. **Proportionality (closes ADR-008):** size class decided in the first round (S: single task / M: feature or module / L: product or system), which fixes minimum rounds, per-round question cap and the block range in Route. Detailed mechanism below.
4. **No dependency on superpowers in this round.** Discover has its own style (visual options, persistence on disk) and Route reuses the `writing-plans` self-review by copying the checklist, not by calling it. The pinned dependency (ADR-003) is left for B-006 (Implement uses `subagent-driven-development`).
5. **During the interview, only files; the plan receives one batch at the end.** The decision tree goes to `discover/interview.md` on every answer (survives compaction); requirements, assumptions, non-goals and the class decision enter through `plan_ops` in one batch (≤ 25 ops per call) after the "play it back" is accepted. Reason: nothing is erased in the plan (ADR-010 item 7); requirements added early and changed later would become `retire` noise with a decision. The panel shows the "Discovery interview" block in progress meanwhile. Never `plan.json` directly, never a gate, never deleting.
6. **Discover and Route have their own block in the plan** ("Discovery interview", phase discover; "Route plan", phase route, depending on the first), with artifacts, Handoff and `verification.passes` set by the model with the user's acceptance as evidence (same criterion used in the B-002 to B-004 dogfooding).
7. **Shared conventions outside `skills/`**, in `plugins/driver/references/driver-conventions.md`, so they are not swept up as a skill; each SKILL.md opens with "read that file first".

## Discover protocol

**0. Start.** `plan_status`. No plan → `driver init <name>` via Bash. Phase beyond discover → *amend* mode: interview only the argument's topic, add requirements and warn that Route needs to replan. Existing `discover/interview.md` → *resume*: read the tree, report "N resolved, frontier: …" and continue, without re-asking a resolved node. Create or reuse the "Discovery interview" block and set it `in_progress`.

**1. Classification (round 1, single call with two questions).** Q1 domain: three options inferred from the argument plus "I don't know". Q2 size by effort: "One afternoon", "A few days", "A few weeks", "Months or a team". "I don't know" → infer from the description, record as an assumption and say so.

**2. Proportionality (closes ADR-008).**

| Class | Signal | Rounds | Questions/round | Blocks in Route |
|---|---|---|---|---|
| XS | one afternoon | 1 + play back | 3 | 2 to 4 |
| S | days | 2 + play back | 4 | 4 to 8 |
| M | weeks | 3 + play back | 6 | 8 to 15 |
| L | months | 3+ until the frontier empties | 8 | 15 to 30 |

Money, personal data, production, irreversible actions or a regulated domain raise the Discover depth by one class (not the number of blocks). The class becomes `decision.add "Project size class: M"` in the output batch. Reclassification offered once after round 1.

**3. Themes per round.** 1: context and breadth (goal, users, success signal, existing assets, deadline, budget). 2: requirements and constraints (features, NFRs, providers and credential variable names, ADR-004). 3: confirmation and non-goals (multiSelect of candidates). Smaller classes merge themes.

**4. Frontier loop (one question per turn).** (1) Recompute the frontier: open nodes whose `dependsOn` are resolved or assumed. (2) Test of already-made decisions: if `assumptions.md`, a previous answer or the repository already answers it, mark it resolved with a reference; do not ask. (3) Fact or decision? Fact (answerable by repo, docs or web without user preference) → background read subagent (sonnet), node `researching`, interview continues; the finding becomes a resolved fact or a recommendation. (4) Rank decisions by impact × uncertainty (impact = nodes unlocked + cost of reverting; uncertainty = no safe default). (5) Ask the top-ranked one with `AskUserQuestion`. (6) Record the answer, open child nodes, append to `interview.md` right away. (7) Close the round at the cap or when the theme's frontier is empty.

**5. Question shape.** `header` ≤ 12 chars; 2 to 3 real options + "I don't know / you decide" (limit of 4); recommended first with suffix "(Recommended)"; each `description` states the consequence; the text ends with "Why it matters: …"; in the user's language.

**6. "I don't know" never blocks.** Fact type → research and re-ask with the finding as the recommendation. Preference with a safe default → adopt it and record `A-nn` (assumed). High impact with no default → offer a quick diagram (Mermaid in the chat) or defer to round 3.

**7. Optional checkpoint (M and L).** Before the play back: "Pre-mortem / Red team / Socratic / Skip (Recommended for S)". New nodes enter the frontier.

**8. Output.** Play back in the chat (goal, requirements, assumptions, non-goals, class). `AskUserQuestion`: "Accept all (Recommended) / Change something / Something is missing", in a loop until accepted. One `plan_ops` batch: `req.add` for requirements, assumptions (`source:"assumed"`, `ref:"discover/assumptions.md"`) and non-goals (`kind:"non-goal"`) plus the class decision (split at 25). Write `requirements/R-nnn.md` and fill the R ids in `assumptions.md` and `non-goals.md`. Discovery block: `addArtifacts` of the three files, `## Handoff`, `in_review`, `verification {passes:true}`, `done`. Say: "Type `/driver approve route` or use Approve in the panel." End the turn.

**9. After the gate.** On the next turn, `plan_status`: approved → `phase.advance` and invoke the `route` skill. Refused → ask what is wrong, Discovery block `done → needs_rework` (reason) → `in_progress`, reopen the affected nodes, repeat step 8.

### Discover artifacts (in `.claude/driver/`)
- `discover/interview.md`: frontmatter `class`, `domain`, `round`, `language`, `status open|closed`; `## Decision tree` (table `Q-nn | question | dependsOn | kind fact|decision | status open|researching|settled|assumed|deferred | answer | source user|research|assumed`); `## Rounds` (question, options shown, answer, timestamp).
- `discover/assumptions.md`: `## A-nn <statement>` with `Why assumed`, `Source node Q-nn`, `Accepted yes|pending`, `Requirement R-nnn`.
- `discover/non-goals.md`: `- N-nn <statement> (reason) -> R-nnn`.
- `requirements/R-nnn.md`: frontmatter `id`, `title`, `kind`, `source`; sections `## Statement`, `## Acceptance signal` (observable, testable), `## Origin` (Q-nn or A-nn), `## Notes`.

## Route protocol

1. `plan_status`. Route gate not approved → stop and warn. Phase still discover → `phase.advance`. Create or reuse "Route plan" (phase route, depends on the Discovery block), `in_progress`.
2. Inputs: `plan.json` (read only), R docs, discover files, class. Brownfield: optionally a `feature-dev:code-explorer` agent.
3. Decomposition rules: **implement**: one deliverable per block that an agent finishes in one session (≈ one PR), with an observable output; **validate**: ≥ 1 block per requirement group, layers according to the domain, acceptance against the R docs and not only against the plan; **evolve**: exactly one "Evolve review" block; **release**: one block with a checklist. `dependsOn` only for real artifact dependencies (maximize parallelism); implement roots depend on the Route block. Every requirement that is not a non-goal links to ≥ 1 implement block and ≥ 1 validate block; non-goals to none. Risk `high` for irreversible action, money, personal data, new technology or a block resting on an assumed premise; `medium` for external integration; otherwise `low`. `provider {capability, provider, access, credentials[]}` when there is an external capability. Within the class range; exceeding it requires a stated reason.
4. Batches: `block.add` with `"$n"` in `dependsOn`, ≤ 25 ops per call; above that, the first batch creates the roots and the following ones use real ids. Then, Write into each `blocks/B-nnn.md`.
5. Self-review (adapted from writing-plans): (a) requirement coverage; (b) block scan: output, acceptance criterion and one-session size; (c) dependency sanity: no cycle, no false edge; (d) review focus: `high` blocks have a validate pair and mitigation; (e) proportion against the class range. Then `driver validate`: zero `req.coverage` warnings.
6. Validated diagram: point to the panel, `driver export mermaid`, paste the Mermaid in the chat for whoever is on the CLI. `AskUserQuestion`: "Looks right (Recommended) / Adjust blocks / Adjust order / Split", in a loop until "Looks right".
7. End: Route block with `addArtifacts` [`route/risks.md`, `exports/plan.mmd`] and Handoff, `in_review`, verification, `done`; `phase.advance` to implement; report the ready blocks.
8. Replan mode (for Evolve, later): never edit a `done` block; add new ones; `block.retire` the superseded ones citing `decision.add`; rebaseline belongs to the user.

### Route artifacts
- `blocks/B-nnn.md`: `## Spec` (purpose and scope), `## Acceptance criteria` (testable checklist = definition of done), `## Notes` (`Input:`, `Output:`, `Risk: level, why, mitigation`, `Provider:`), empty `## Handoff`.
- `route/risks.md`: matrix `block | risk | probability L/M/H | impact L/M/H | mitigation | owner block` and definition of done per phase.

## File layout

```
plugins/driver/skills/
  discover/SKILL.md            interview protocol (≈ 200 lines)
  discover/question-format.md  question format and examples (support, read on demand)
  discover/templates/          interview.md, assumptions.md, non-goals.md, requirement.md
  route/SKILL.md               decomposition, self-review, diagram
  route/templates/block.md     filled Spec / Acceptance criteria / Notes
  route/templates/risks.md
plugins/driver/references/driver-conventions.md   tools, formats, preconditions, hard rules, language
plugins/driver/test/skills.spec.ts
.claude/docs/DECISIONS.md    ADR-012 (phase skills) and ADR-008 → Accepted with the mechanism above
```

Frontmatter: `name` equal to the folder, `description` that triggers from context, `user-invocable: true`, `argument-hint` (`"[one-line idea | amend <topic>]"` / `"[replan <reason>]"`), `disable-model-invocation: false` (Discover needs to invoke Route after the gate), no `context: fork`; `allowed-tools` restricted to `AskUserQuestion, Read, Write, Edit, Glob, Grep, Agent, Bash(driver *), mcp__driver__*` (if the engine accepts the pattern; otherwise omit).

## Open points for Diogo

- Class L may exceed 30 interview turns; the per-round cap and the compaction-proof files are the mitigation. Acceptable?
- The batch at the end (decision 5) leaves the panel without requirements during the interview. The alternative is incremental `req.add` with retire noise. I recommend the batch.
- `verification.passes` set by the model on the Discovery and Route blocks (decision 6). The alternative is to require the user, which adds two more stalls to the flow.
- The slash name (`/driver:discover`) and `allowed-tools` with `Bash(driver *)` are confirmed on first load.

## Execution

1. Linear: issue "Discover and Route skills" in the DRIVER project (PER-6xx); plan copied to `.claude/plans/2026-10-30-skills-discover-route.md`; the agent's raw design in `docs/research/07-skills-design.md`.
2. Me: ADR-012 in `DECISIONS.md` and ADR-008 closed.
3. **sonnet** subagent: `skills/_shared/conventions.md`, `skills/discover/*`, `skills/route/*`, `test/skills.spec.ts`; `claude plugin validate .`; `npm test`.
4. Me: first load (the mod's hot reload already covers the plugin); check the slash name; dogfooding on a copy of `examples/web-waitlist` (see Verification).
5. **opus** subagent: adversarial review of the skills (questions that violate the cap, paths where the skill tries to approve a gate or write `plan.json`, re-entry, a user who answers "I don't know" to everything, an S project that receives L ceremony).
6. Docs: ARCHITECTURE (skills stop being future), PROJECT-SUMMARY, CLAUDE.md, GUARDRAILS (`skills/**` → ADR-012). B-005 → in_review → done in the plan. Commit only on request.

## Verification

```bash
claude plugin validate .
npm --prefix plugins/driver test            # includes test/skills.spec.ts
```

`test/skills.spec.ts`: frontmatter parses, `name` equals the folder, `description` < 1,024 chars, every `${CLAUDE_SKILL_DIR}` path resolves, every `mcp__driver__*` and every op cited exists in `mod/tools.ts`, no `context: fork`, no em dash.

Manual dogfooding (clean copy of `examples/web-waitlist` without `.claude/driver`): `/driver:discover "waitlist landing page"` → class S, 2 rounds, at least one "I don't know" recorded as `A-nn`, the three discover files, R docs equal in number to the plan's requirements (with ≥ 1 non-goal), Discovery block `done`. Approve in the panel → Route starts on its own, 4 to 8 blocks, clean `driver validate`, `route/risks.md`, `exports/plan.mmd`, phase implement. Run `/driver:discover` again → amend message, no repeated question. Afterwards, use it in this repository on B-005.
