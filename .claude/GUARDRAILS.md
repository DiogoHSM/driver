# Guardrails · DRIVER

> **Always loaded.** This file is the project's only *lazy loading* contract: it tells Claude which docs to read before touching each area. Docs not listed here are only read when Claude opens them explicitly.

**Last review**: 2026-11-12 (six skills, ADR-016 triage)

---

## Before editing

Use this table as a checklist. Before modifying a file that fits a category, **read the matching doc(s)**.

**If the doc does not exist yet**: read `~/.claude/templates/docs/<NAME>.md`, create `.claude/docs/<NAME>.md` with real knowledge of the project, and only then proceed.

| When touching… | Read first | Why |
|---|---|---|
| `plugins/driver/src/schema.ts`, `schema/plan.v1.schema.json`, fixtures | `DECISIONS.md` (ADR-010), `.claude/plans/2026-10-27-plan-json-v1.md` | the format is a contract with the mod, hooks, skills and packs; a change of shape needs an ADR and, if it breaks, a new `schemaVersion` |
| `src/state-machine.ts`, `src/reducer.ts` | `DECISIONS.md` (ADR-010 items 3 and 4) | transitions and gate revocation are method rules, not code detail |
| `src/store.ts`, any write to `.claude/driver/` | `DECISIONS.md` (ADR-010 item 5), `ARCHITECTURE.md` | single writer, lock, root in the main worktree |
| `hooks/**` | `docs/research/03-plugin-infra.md` §3, `DECISIONS.md` (ADR-009, ADR-010 item 11) | the hook gate is the only real guarantee; approval can never come from the model |
| `plugins/driver/mod/**`, `types/index.d.ts` | `DECISIONS.md` (ADR-011, ADR-014, ADR-015), `docs/research/05-mod-design.md`, `docs/research/03-plugin-infra.md` §2 | no Node/DOM in the mod; only import `src/shared`; render never writes state; approval only from origin `composer`/`ui.press` + ticket; the panel always shows the next step and the main button triggers Claude through `$.prompt.submit`, which never approves anything |
| `plugins/driver/src/shared/**` | `DECISIONS.md` (ADR-011 item 2) | no dependencies (no zod, no `node:*`): the mod imports from here; a layout/SVG change has a golden test |
| `plugins/driver/skills/**`, `plugins/driver/references/**` | `DECISIONS.md` (ADR-017, ADR-016, ADR-015, ADR-014, ADR-013, ADR-012, ADR-008, ADR-006, ADR-003), `plugins/driver/references/triage.md`, `docs/research/07-skills-design.md`, `docs/research/skills-landscape.md` §2 | skills write to the plan only through the tools; they never approve a gate; interview by interest with a budget per class; text for the user never comes before a tool call (the summary and the block list are the final message of the turn); files in `.claude/driver/` only through the silent tools; a change after the gate goes through triage and never restarts the cycle on its own; a skill only advances the phase from its own phase and with no open work behind it; `allowed-tools` does not pre-approve the terminal beyond the driver CLI; `test/skills.spec.ts` checks frontmatter, paths, cited ops and dashes |
| `plugins/driver-*/` (packs) | `DECISIONS.md` (ADR-004, ADR-005), `docs/research/02-domain-packs.md` | the core does not know providers; pack data goes in `ext` |
| `.claude-plugin/*.json`, `package.json` | `STACK.md`, `DECISIONS.md` (ADR-003) | pinned versions; `claude plugin validate` after editing |
| New architectural decision | `DECISIONS.md` (read + add an ADR) | project convention: ADR before code |
| Scope/goals | `PROJECT-SUMMARY.md` | alignment |

---

## Fixed project rules

- Never approve a gate (`gates.route`, `gates.release`), run `rebaseline` or use `--force` from code called by the model. These actions require a typed `yes` in an interactive terminal (ADR-010 item 14); do not create a bypass through a flag or env var.
- Never loosen the `protect-plan` hook to "make a test easier": if a legitimate command is denied, add a test case and adjust the rule with the reviewer.
- Never edit `plan.json` by hand or through `Write/Edit`; always through the CLI or a tool.
- Never delete a block or requirement; mark it `retired` citing `D-xxx`.
- Never write credential values into the plan; only variable names.
- Everything in the repository is in English: docs, code, comments, commit messages (ADR-018). Skills talk to the user in the user's language.
- No commit unless the user asks. Never `--no-verify`.

---

## Before running destructive or irreversible actions

- [ ] If it involves a protected branch or a remote, the user authorized this specific operation.
- [ ] If it involves `rm -rf` outside `node_modules`/`dist`, confirm.

There is no cloud, database or deploy in this project yet.

---

## Continuous updates

- Every doc created/removed in `.claude/docs/`: update the table above.
- New risk area: add a row. Keep it short.
