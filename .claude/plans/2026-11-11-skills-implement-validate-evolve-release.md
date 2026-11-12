# Plan: B-006, Implement, Validate, Evolve and Release skills, with ADR-016

## Context

Discover and Route have a skill; the next four phases do not. In the second dogfooding (coffee-app) Claude improvised these phases: Validate failed blocks and turned them into new blocks in implement with no mark, the current phase stopped saying where the work was, and the autopilot turned off when leaving Implement. ADR-016 (accepted on 2026-11-11) fixes the rule: three-level triage for every change after the gate, no level restarts the cycle on its own, a new baseline suggested in Evolve, autopilot valid in the Validate and Implement loop.

Expected result: a project goes from the route gate to the published release driven by skills, with the panel showing what entered after the baseline and where the work went back to, and with every reply ending on the next step.

Prerequisite: B-005 closed (Diogo's visual check in the app is still missing). Steps 1 and 2 below do not depend on it and can start earlier.

## Decisions this plan makes (reject here whatever you do not want)

1. **Split B-006 into three blocks** (level 2 of ADR-016 itself: same requirement R-001, only splits the work). A new block "ADR-016 engine and panel" (steps 1 and 2), on which B-006 comes to depend; B-006 keeps Implement and Validate (step 3); a new block "Evolve and Release skills" (step 4) depends on B-006. Reason: the whole B-006 does not fit in one session and steps 1 and 2 are testable on their own.
2. **Superpowers as optional support, not a hard dependency.** Revisits ADR-003 for the core only (new ADR-017): the DRIVER skills carry the complete protocol in their own text and, if the superpowers plugin is installed, invoke `test-driven-development`, `verification-before-completion` and `finishing-a-development-branch` through the Skill tool. Reason: whoever installs DRIVER should not be forced to install another plugin from another marketplace, and a dependency across marketplaces requires extra user configuration.
3. **"After baseline" mark derived, with no new field in `plan.json`.** A block or requirement is after the baseline when its id does not appear in any `baselines[].added` or `.reqAdded`. Existing plans work without migration; `schemaVersion` stays 1.
4. **Next-cycle items outside `plan.json`**: a `backlog.jsonl` file in the plan folder, written by a new silent tool, with a generated `backlog.md`. Reason: a deferred requirement inside the plan would require touching coverage, the release gate and rebaseline; outside the plan it revokes nothing and becomes input to the next Discover (`amend`).
5. **A parallel subagent does not write artifacts or tests to the plan.** It builds, fills in its own block's Handoff (the mod already allows it) and returns a report; the main session checks, records artifacts and tests and closes the block. No permission change in the mod.
6. **"Confirm baseline N" button in the panel**, through the same path as gate approval (user origin and ticket, ADR-011). Reason: rebaseline today requires a terminal, which stalls the ordinary user in Evolve. It remains impossible for the model.
7. **Commit per block in the user's project**: the Implement skill asks once per project whether to commit locally each closed block and records the answer as a decision. Never pushes.

## Step 1: engine (`plugins/driver/src/`)

Everything in `src/shared/` follows the hard rule of importing nothing from outside.

- `src/shared/plan-doc.ts`, `src/shared/view.ts`, `types/index.d.ts`: `PlanDoc` gains `baselines?: {n, added, reqAdded}[]`. `BlockView` gains `afterBaseline?: boolean` and `waitingOn?: string[]` (unfinished dependencies of a `blocked` block). `PlanView` gains `reqsAfterBaseline: number` and `openBehind: Phase[]` (phases before the current one with an active unfinished block). `summarize` gains `rework` (blocks in `needs_rework`) and `resumable` (`blocked` blocks whose dependencies have already closed); `ready` does not change.
- `src/backlog.ts` (new, modeled on `src/discover-log.ts`): appends an entry `{id N-nn of the cycle, title, origin, decision, at}` to `backlog.jsonl` and regenerates `backlog.md`. CLI: `driver backlog add|show` in `src/cli.ts`. The folder is already protected by the guard only for the plan files; `backlog.*` goes into the "only through the tools" list of the conventions.
- `src/cli.ts`: `rebaseline` accepts `--via-mod` with a ticket, as `gate approve` already does (`test/cli-mod.spec.ts` is the model).
- `src/validate.ts`: new warning `phases.openBehind` when the current phase is evolve or release and there is an unfinished active block in implement or validate (warning only; the `gate.releaseIncomplete` error remains the barrier).
- `mod/hooks.ts` `claim()`: do not unblock by spawn a `blocked` block with non-empty `waitingOn` (deny the spawn with the reason).
- Guard: fix the false positive seen today (`status --block` inside a `for` loop was read as a gate approval) in `src/shared/protect.ts`, with a case in `test/protect.spec.ts`. GUARDRAILS rule: add the test case, do not loosen.
- Tests: `view.spec.ts`, `validate.spec.ts`, `cli.spec.ts`, new `backlog.spec.ts`, `protect.spec.ts`, `types.spec.ts`. Regenerate `schema/plan.v1.schema.json` only if the schema changes (it should not).

## Step 2: mod (`plugins/driver/mod/`, drawing in `src/shared/svg.ts` and `layout.ts`)

- **Mark on the card**: `+` glyph in the bottom right corner, in the same row as the `!` and the `▲` (`nodeVertical`, counted in `badges`), a line in the tooltip, an entry in the legend; the same in `rows.ts`, `render-board.tsx` and `render-terminal.tsx`. Header: `baseline 1 · +4 since` when applicable.
- **Loop**: the phase band listed in `openBehind` gets the label `↺ reopened` and the current-phase frame; a dashed arrow on the right margin links the current phase to it (reuses the `backward` edge drawing, class `.eb`).
- **`mod/next.ts`**: `SKILLS` now names `driver:implement`, `driver:validate`, `driver:evolve`, `driver:release`. `primaryAction` looks at `openBehind` before offering `Start <next>`: when there is work behind, the button is `Continue implement` and the Next line says what is missing and why. In evolve with the release gate pending and items after the baseline, the Next line suggests confirming the baseline before approving.
- **`mod/autopilot.ts`**: verdict and text per phase (implement and validate), "all done" = both phases done, `AUTOPILOT_RULE` with the triage (decides levels 1 and 2; at level 3 it adopts the recommended exit and records it, except for the ADR-015 item 4 list). Button and panel phrases (`pane.tsx:235, 275, 293`) and those in `command.ts` stop saying only Implement.
- **New tool** `mcp__driver__backlog` in `mod/tools.ts` (pattern of the six existing ones; refused for a subagent).
- **`Confirm baseline N` button** in `pane.tsx`, visible in the evolve phase when there are items after the baseline; two-step confirmation like the gate's; `mod/approve.ts` gains `rebaselineViaMod`.
- Tests: `pane.test.tsx`, `autopilot.test.tsx`, `tools.test.tsx`, `hooks.test.tsx`; snapshots of `svg.spec.ts`, `layout.spec.ts`, `rows.spec.ts`.

## Step 3: Implement and Validate skills (`plugins/driver/skills/`)

Same format as Discover and Route: full frontmatter, first line telling to read `references/driver-conventions.md`, numbered steps, "Red flags" table, text in English, conversation in the user's language, no speech before a tool call, final message with the next step.

**`implement/SKILL.md`** (`argument-hint: "[B-nnn | parallel]"`)
1. `plan_status`; list ready, rework and resumable blocks; recommend one (high risk or critical path first) and say why. Two or more independent: offer parallel.
2. Read `blocks/B-nnn.md`, the linked `requirements/R-nnn.md` and the `provider`; missing credential (variable name only) marks `blocked`.
3. `in_progress`; build; test first when it is code (invoke `superpowers:test-driven-development` if it exists, otherwise follow the built-in summary).
4. Verification by the rule identify, run, read, check against each acceptance criterion; record `addArtifacts` and `addTests`; Handoff through `block_doc`; `in_review`, `verification`, `done`. Local commit per decision 7.
5. Parallel: one subagent per block, explicit `model`, marker `DRIVER-BLOCK: B-nnn` in the prompt, `isolation: worktree` when the project is git and the blocks may touch the same files; the main session integrates one at a time and closes the blocks (decision 5).
6. A change that shows up midway: ADR-016 triage (support file `references/triage.md`, shared with Validate and Evolve).
7. End of phase: `phase.advance` to validate and next step (`Start validate` or, with autopilot, continue straight on).

**`validate/SKILL.md`** (`argument-hint: "[B-nnn | recheck]"`)
1. For each ready validation block: `in_progress`, run the layers the project type calls for, and the acceptance against the R documents, not only against the plan.
2. Report in `validate/B-nnn.md` (template in `validate/templates/report.md`), `addTests` on the validation block.
3. Failure: triage. Level 1 takes the origin block to `needs_rework` with the report as the reason and the validation block to `blocked` ("waiting on B-nnn"); levels 2 and 3 per ADR-016, with the backlog tool for "next cycle".
4. The triage message ends by offering item by item or autopilot.
5. `recheck`: resumes the `resumable` blocks and runs only what the rework touched.
6. All validated and nothing open behind: `phase.advance` to evolve.

## Step 4: Evolve and Release skills

**`evolve/SKILL.md`** (`argument-hint: "[review | round <reason>]"`), owner of the "Evolve review" block:
1. Gathers: items after the baseline, decisions since the baseline (autopilot ones highlighted), backlog, `driver validate` (coverage), and the vision's criterion: every requirement with a passing test or retired with a decision.
2. Optional checkpoint by class (pre-mortem, red team), as in Discover.
3. Writes `evolve/review.md` in the user's language (template) and presents it as the final message with a recommendation: ready for release, one more round (local adjustment in implement or `driver:route replan`), and confirm baseline N+1 with the panel button.
4. One learning per round in `evolve/learnings.md`.
5. Never approves the gate: says what to press and ends the turn. The approval already starts `driver:release` (ADR-014).

**`release/SKILL.md`** (`argument-hint: "[version]"`), owner of the release block:
1. Generic core checklist (packs add to it later, ADR-005): rollback plan, documentation, observability when applicable, credential pending items.
2. Code destination: keep local, merge, or push and PR. Publishing outward always asks, even with autopilot.
3. `driver release add` through Bash, artifacts, Handoff, block `done`.
4. Closes with the backlog: if there are pending items, the next step is `/driver:discover amend`.

## Step 5: documentation and closing

- `references/driver-conventions.md`: intro and section 1 with the four skills and the new paths (`validate/`, `evolve/`, `backlog.*`); line 110 now allows `done` to `needs_rework` at level 1; `backlog` tool in section 2.
- `test/skills.spec.ts`: require the six skills.
- ADR-017 (optional superpowers) and an addendum to ADR-016 (baseline button, backlog outside the plan) in `DECISIONS.md` before the code of each.
- `ARCHITECTURE.md`, `PROJECT-SUMMARY.md`, `CLAUDE.md`, skills line of `GUARDRAILS.md` (ADR-006, 014, 015, 016, 017).
- Linear: new issue in the DRIVER project for B-006; plan copied to `.claude/plans/2026-11-11-skills-implement-validate-evolve-release.md`.
- Commit only on request.

## Execution

| Step | Who | Model |
|---|---|---|
| ADRs, block split in the plan, conventions | main session | |
| 1 engine | subagent | sonnet |
| 2 mod | subagent, after 1 | sonnet |
| 3 and 4 skills (two subagents in parallel, after 2) | subagents | sonnet |
| Adversarial review of the four skills and the triage | subagent | opus |
| 5 docs and closing | main session | |

## Verification

```bash
npm --prefix plugins/driver test
npm --prefix plugins/driver run typecheck
~/.local/bin/claude plugin test plugins/driver
~/.local/bin/claude plugin validate .
```

Manual, in the app, after reloading the plugin:
1. **coffee-app reproduction** on a copy of `examples/web-waitlist`: take it to validate, force an acceptance failure. Expected: origin block in rework, validation block blocked with "waiting on", implement band with `↺ reopened`, `Continue implement` button, no new block.
2. Ask for an adjustment that serves an existing requirement: new block with `+`, one warning line, no question.
3. Ask for something out of scope: question with the three exits; choose "next cycle" and check `backlog.md`.
4. Autopilot on in validate: goes through the loop and stops on its own with implement and validate done.
5. Evolve: `review.md` lists the `+` items, the `Confirm baseline 2` button works only by my click, and the model is refused when it tries.
6. Approve release: `driver:release` starts on its own and ends pointing to the backlog.
7. In the real coffee-app: open the panel and check that B-021 to B-024 appear with `+` with no migration.
