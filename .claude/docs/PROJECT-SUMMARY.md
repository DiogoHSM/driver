# DRIVER

## What it is
Claude Code plugin that enforces a structured, traceable and iterative process on any project: Discover · Route · Implement · Validate · Evolve · Release. The plan is a graph of blocks with state, rendered as a live diagram beside the chat. The plugin composes existing skills (superpowers, impeccable, hyperframes etc.) instead of reinventing them, and suggests the "ideal stack" of tools per domain for people who do not know it.

## Goals
- Formalize the manual pipeline already in use (/iniciar, /planejar, /executar, /gerenciar, /auditar, /encerrar) as a reusable method.
- Plan graph with per-block state as the central artifact; diagram as rendering (mod in the desktop app, Mermaid as the CLI fallback).
- Only two human gates: Discover→Route and Evolve→Release.
- Capability registry per domain: suggest and load tools per block, never everything at once.
- Packs per domain: `driver` (core) + `driver-web`, `driver-mobile`, `driver-finance`, `driver-social`, `driver-video`.

## Phases (summary)
| Phase | Essence | Composes from |
|---|---|---|
| Discover | Understand | brainstorming + grill-me style interview + assumptions log |
| Route | Plan | writing-plans + plan graph + diagram |
| Implement | Build | subagent-driven-development + worktrees + domain packs |
| Validate | Verify | verification-before-completion + code-review + tests per layer |
| Evolve | Iterate | loop-back controller with decision log and impact analysis (new) |
| Release | Publish | finishing-a-development-branch + checklist + rollback |

## Status
- 2026-10-26: initial definition; landscape research done (`docs/research/skills-landscape.md`).
- 2026-10-27: `plan.json` v1 format decided (ADR-010) and implemented in `plugins/driver`: zod schema + JSON Schema, validator, reducer and state machine, store with lock and ledger, `driver` CLI, gate and protection hooks, Mermaid exporter, two examples (`examples/`). Adversarial review in `docs/research/04-review-plan-json-v1.md`. Plan in `.claude/plans/2026-10-27-plan-json-v1.md`; issue PER-611. Nothing committed yet.
- 2026-10-28: initial commit `6dfb08a`. Live diagram mod implemented (ADR-011, issue PER-618): dependency-free `src/shared`, support CLI, `mod/` (SVG/terminal pane, `mcp__driver__*` tools, `/driver`, `agent.spawn` hooks), 563 vitest tests + 29 in `claude plugin test`; adversarial review in `docs/research/06-review-mod.md`. Dogfooding started: DRIVER's own plan in `.claude/driver/` (phase discover, route gate pending). Mod loaded in this session's Desktop: `mcp__driver__*` tools operating (writing via `$.process.run` confirmed). Pending: visual check of the panel, `/driver approve route` by Diogo and commit.
- 2026-10-29: panel redone after three unreadable or poor attempts (horizontal SVG without scale, text list, card board): vertical SVG sized in pixels with `isInteractive`, one-line bar with a block `Select`, native detail; mobile keeps the card board. ADR-011 item 3 updated. Visual check on Desktop approved by Diogo; panel dogfooding begins. 606 vitest tests + 44 in `claude plugin test`. Commit `77a61a1`. Then PER-619: the `protectCommand` guard gained a shell scanner (quotes, comments, arithmetic, `${}`, `$'…'`) and now treats a heredoc body as stdin of the command that opens it; a line break outside quotes separates commands (old gap closed). Four opus reviews; 335 guard tests. Commit `358f67a`. DRIVER's own plan advanced in the panel: Discover and Route done, B-003 and B-004 delivered, B-005 in progress.
- 2026-10-30: `discover` and `route` skills written (ADR-012, ADR-008 closed with the proportionality table, issue PER-620, plan in `.claude/plans/2026-10-30-skills-discover-route.md`, raw design in `docs/research/07-skills-design.md`): `plugins/driver/skills/{discover,route}/` with templates and `references/driver-conventions.md`; `test/skills.spec.ts`. Slash confirmed on load: `/driver:discover`, `/driver:route`. Panel top reorganized into two lines (Show/Hide done, Show/Hide retired, "Open" block) and gates as a full sentence. Guard: a `sed -i`/`perl -pi` script is no longer read as a glob (false positive on `.*`). Adversarial opus review of the skills: 16 findings applied (see ADR-012, consequences). Pending: dogfooding on a copy of `examples/web-waitlist`, B-005 → done, commit.
- 2026-11-10: commit `6110754` (skills, panel top, D-002 putting B-006 and B-007 in parallel). First dogfooding of the skills on a copy of `examples/web-waitlist`: the protocol worked, but the interview ran long, the acceptance summary did not appear in the terminal and the screen filled with diffs. ADR-013 (issue PER-669): interview by interest (product core with a budget per class, technical areas by choice, closed "always ask" list), summary and block list as the final message of the turn, silent logging through the `discover_log`, `block_doc` and `req_doc` tools, write refusal for subagents. Guard rebuilt for `sed`/`perl`/`ruby` (script that writes or executes, glued flags, `-I`, braces, indirect `cd`) after two opus audits; panel without gate pills. 891 vitest tests + 49 from the mod. Pending: second dogfooding (preferably in the Desktop app), B-005 → done, commit.
- 2026-11-11: second dogfooding in the Desktop app with a new project (coffee-app): Discover and Route approved by Diogo. Three mod fixes: plan path resolved again when the session changes folder (the app starts in a fallback folder), root found by walking up folders outside git (CLI and gate hook), panel opens when the plan appears. ADR-014: always-visible "Next" line, main button becomes Approve, Continue or Start, and approving a gate advances the phase and triggers Claude. ADR-015: permanent system prompt rule (every reply ends with the next step) and optional autopilot in Implement, with five brakes. 899 vitest tests + 63 from the mod. New requirements for B-006: optional parallelism through subagents with a worktree, list of ready blocks with a recommendation and reason, owner subagent recording artifacts and tests of its own block. No commit.
- 2026-11-12: ADR-016 (three-level triage of every change after the gate, baseline 1 closed at the end of Route, new baseline suggested in Evolve, autopilot in Implement and Validate) and ADR-017 (superpowers as optional support). Engine and panel (B-013): derived `+` mark for what entered after the baseline, reopened-phase strip with an arrow, `Continue implement` button when there is work behind, `Confirm baseline N` button and `/driver baseline` only by user action, next-cycle backlog outside the plan (`backlog` tool, `backlog.jsonl`), `plan_status` with `rework`, `resumable`, `openBehind` and `afterBaseline`. `implement`, `validate`, `evolve` and `release` skills written (B-006, B-014, issue PER-670, plan in `.claude/plans/2026-11-11-skills-implement-validate-evolve-release.md`), with a shared `references/triage.md`; two adversarial opus reviews (engine: 10 findings; skills: 20 findings) applied. B-005 and B-013 done after a screenshot check in coffee-app.
- 2026-11-12 (later): the repository moved to English (ADR-018): `README.md` written, every doc, plan, research note and skill template example translated, two files renamed (`docs/vision/initial-definition.md`, `.claude/plans/2026-10-28-mod-diagram.md`). Commit history and the existing content of this repository's own plan folder stay as they were.
- Pending: manual end-to-end check of the six skills in the app (list in the Verification section of the 2026-11-11 plan), including Discover amend mode, the `Confirm baseline` button, autopilot going through the loop and parallelism with a worktree.
- Next: B-007 and B-008, then B-009.

## Stakeholders
- Diogo Martins (author, only user for now)

## Links
- Repository: local, `~/Developer/Github/driver` (no remote yet)
- Linear: DRIVER project (Personal team), https://linear.app/data4ward/project/driver-d7f69613b00d
- Original idea document: see the 2026-10-26 session history; method version in [DECISIONS.md](DECISIONS.md)
- Research: `docs/research/skills-landscape.md`
