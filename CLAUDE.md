# DRIVER

Claude Code plugin that enforces the DRIVER method (Discover · Route · Implement · Validate · Evolve · Release) on any project, with a block-graph plan and a live diagram.

## Status
`plan.json` v1 implemented and committed (ADR-010). Live diagram mod implemented and visually approved on 2026-10-29 (ADR-011): `src/shared`, support CLI, `mod/` with a vertical SVG on Desktop (commit `77a61a1`). `protectCommand` guard rebuilt with a shell scanner (PER-619, commit `358f67a`). `discover` and `route` skills written (ADR-012, PER-620, B-005 of the plan in `.claude/driver/`): `plugins/driver/skills/`, `plugins/driver/references/driver-conventions.md`, `test/skills.spec.ts`; commit `6110754`. After the first dogfooding, ADR-013 (PER-669): interview by interest, summary as the final message, silent tools `discover_log`, `block_doc`, `req_doc`, guard hardened for `sed`/`perl`/`ruby`. Second dogfooding on 2026-11-11 in the Desktop app (coffee-app project): Discover and Route approved; it produced ADR-014 ("Next" line in the panel, main button Approve, Continue or Start that triggers Claude, `mod/next.ts`) and ADR-015 (next-step rule in the system prompt and optional autopilot in Implement, `mod/autopilot.ts`), plus the plan root being resolved again when the session changes folder. On 2026-11-12: ADR-016 (three-level triage of changes after the gate, after-baseline mark, reopened phase, next-cycle backlog, `Confirm baseline` button) and ADR-017 (superpowers optional); B-005 and B-013 done; `implement`, `validate`, `evolve` and `release` skills written and reviewed (B-006, B-014, PER-670), with `plugins/driver/references/triage.md`. Pending: manual end-to-end check of the six skills in the app. After that: B-007, B-008 and B-009.

## Read before touching
- Guardrails ("before touching X, read Y" table): `.claude/GUARDRAILS.md`
- Vision and status: `.claude/docs/PROJECT-SUMMARY.md`
- Decisions (ADRs): `.claude/docs/DECISIONS.md`
- Architecture and stack: `.claude/docs/ARCHITECTURE.md`, `.claude/docs/STACK.md`
- Plans: `.claude/plans/2026-10-27-plan-json-v1.md` (plan.json), `.claude/plans/2026-10-30-skills-discover-route.md` (skills), `.claude/plans/2026-11-11-skills-implement-validate-evolve-release.md` (four skills and ADR-016)
- Conventions the skills follow: `plugins/driver/references/driver-conventions.md` and `plugins/driver/references/triage.md`
- Research synthesis: `docs/research/skills-landscape.md` (raw reports 01 to 03 in the same folder)
- Original idea document: `docs/vision/initial-definition.md`

## Commands
- `cd plugins/driver && npm test` (vitest, `*.spec.ts`) · `npm run typecheck` · `npm run build` (generates `dist/cli.js`, committed)
- `claude plugin test plugins/driver` (mod tests, `mod/test/*.test.tsx`) · `tsc -p plugins/driver` (mod typecheck, after the engine generates `.claude-plugin/types`)
- `claude plugin validate .` at the root after touching manifests, `hooks.json` or `skills/*/SKILL.md`
- Hard rule: `src/shared/` imports nothing from outside itself (no zod, no `node:*`); the mod only imports from there

## Conventions
- Everything in the repository is in English: docs, code, comments, commit messages (ADR-018). Skills talk to the user in the user's language.
- New design decision → ADR in `DECISIONS.md` before implementing.
- Vendored skills carry a header with origin, version and license (ADR-003).
