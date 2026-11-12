# DRIVER

A Claude Code plugin that runs any project through one method: **D**iscover, **R**oute, **I**mplement, **V**alidate, **E**volve, **R**elease.

The plan is a graph of blocks with state, kept in `.claude/driver/plan.json` inside your project and drawn as a live diagram next to the chat. Two human gates decide when planning may become building and when a cycle may ship. Everything else is tracked, checked and resumable.

> Status: `0.1.0`, early. The core, the live pane and the six phase skills exist. Domain packs are planned, not built.

## Why

Long agent sessions drift: the plan lives in the chat, "done" means "the model said so", and a change of scope quietly restarts everything. DRIVER fixes three things.

- **The plan is a file, not a conversation.** Blocks, dependencies, requirements and decisions live in `plan.json`, with an append-only ledger (`events.jsonl`). A new session picks up exactly where the last one stopped.
- **Done needs evidence.** A block reaches `done` only with a handoff, an artifact and a passing verification. A failing test record blocks it.
- **The model cannot approve its own work.** Gates, new baselines and forced moves need an action that only you can take: a click in the pane or a command typed at the prompt. Hooks enforce this; it is not a prompt convention.

## The six phases

| Phase | What happens | Ends with |
|---|---|---|
| Discover | A short interview about the product. Technical areas are asked only if you want to decide them. Produces requirements, accepted assumptions and non-goals. | **Gate: route** (you approve) |
| Route | Requirements become a block graph: dependencies, acceptance criteria, risk, providers. You confirm the plan; baseline 1 is recorded. | Phase advances to implement |
| Implement | Blocks are built one at a time, or in parallel by subagents in worktrees. Test first when it is code. Each block is verified against its acceptance criteria before it closes. | All implement blocks done |
| Validate | Each validation block runs the test layers the project needs and checks acceptance against the requirement documents. Failures go through triage, never straight into new work. | All validate blocks done |
| Evolve | A review of the cycle: what entered after the baseline, decisions taken on autopilot, requirement coverage, backlog. Recommends release or another round. | **Gate: release** (you approve) |
| Release | Checklist (rollback, docs, observability, credentials), where the code goes, the release record, and the backlog for the next cycle. | Cycle closed |

### Changes after the plan is approved

Every change that shows up after the route gate is triaged into one of three levels, and none of them restarts the cycle on its own:

1. **Fix.** A criterion failed. The original block goes back to rework.
2. **Adjustment.** New work that serves an existing requirement. It becomes a new block, marked `+` (added after the baseline).
3. **Scope change.** A question with three exits: this cycle, next cycle (recorded in the backlog), or re-plan.

## The pane

With the plugin loaded in the Claude desktop app or VS Code, a DRIVER pane opens beside the chat as soon as a plan exists:

- a vertical diagram of the block graph, grouped by phase, with status, risk and the `+` mark;
- a **Next** line that always says what the next step is;
- one main button that changes with the state: `Approve route gate`, `Start implement`, `Continue implement`, `Confirm baseline N`, `Approve release gate`;
- an optional **Autopilot** for Implement and Validate, which keeps going block by block and stops on anything that needs you.

In a terminal the same plan is drawn as text rows.

## Install

Requires Claude Code 2.1.287 or newer and Node.js on the PATH.

Clone the repository, then inside Claude Code:

```
/plugin marketplace add /path/to/driver
/plugin install driver@driver
```

No other plugin is required. If [superpowers](https://github.com/obra/superpowers) is installed, the Implement, Validate and Release skills use it as optional support.

## Use

Start in your project folder:

```
/driver:discover "a waitlist page for my app"
```

Answer the interview, read the summary, then approve the gate with the button in the pane or by typing:

```
/driver approve route
```

From there the pane's main button (or the matching skill) moves the work forward:

| Command | Purpose |
|---|---|
| `/driver:discover [idea \| amend <topic>]` | Start a project, or amend requirements for a new cycle |
| `/driver:route [replan <reason>]` | Build or rebuild the block graph |
| `/driver:implement [B-nnn \| parallel]` | Build the next ready block, a given block, or several in parallel |
| `/driver:validate [B-nnn \| recheck]` | Run validation, or recheck after rework |
| `/driver:evolve [review \| round <reason>]` | Review the cycle, or start another round on purpose |
| `/driver:release [version]` | Run the release checklist and record the release |
| `/driver status` | Print the plan state |
| `/driver approve <route\|release>` | Approve a gate (typed by you only) |
| `/driver baseline` | Confirm a new baseline (typed by you only) |
| `/driver auto <on\|off>` | Switch the autopilot |
| `/driver export` | Export the diagram as Mermaid |

## What it writes in your project

Everything lives under `.claude/driver/`:

```
plan.json            canonical snapshot of the plan
events.jsonl         append-only ledger of every change
blocks/B-nnn.md      spec, acceptance, notes and handoff per block
requirements/R-nnn.md
decisions/D-nnn.md
discover/            interview, assumptions, non-goals, summary
route/               risks
validate/            one report per validation block
evolve/              cycle review and learnings
release/             checklist
backlog.md           items deferred to the next cycle
```

`plan.json` is never edited by hand. The only writers are the `driver` CLI and the `mcp__driver__*` tools, under a lock; a hook refuses direct edits. Credential values are never stored, only variable names.

## Repository layout

```
.claude-plugin/marketplace.json   marketplace manifest
plugins/driver/
  src/            core: schema, validator, reducer, state machine, store, CLI
  src/shared/     dependency-free code shared with the mod (layout, SVG, rules)
  mod/            the pane, the mcp__driver__* tools, /driver, hooks
  hooks/          gate check and plan protection
  skills/         the six phase skills and their templates
  references/     conventions and triage rules the skills follow
  schema/         JSON Schema for plan.json
  dist/cli.js     bundled CLI, committed so hooks need no build
examples/         two small projects generated by the real CLI
docs/             vision and research
.claude/docs/     architecture, stack and decision records (ADRs)
```

## Develop

```bash
npm install
npm --prefix plugins/driver test
npm --prefix plugins/driver run typecheck
npm --prefix plugins/driver run build
claude plugin test plugins/driver
claude plugin validate .
```

Design decisions are recorded as ADRs in [.claude/docs/DECISIONS.md](.claude/docs/DECISIONS.md) before they are implemented. Architecture is in [.claude/docs/ARCHITECTURE.md](.claude/docs/ARCHITECTURE.md).

## Roadmap

- End-to-end check of the six skills in the desktop app.
- Domain packs as separate plugins in the same marketplace: `driver-web`, `driver-mobile`, `driver-finance`, `driver-social`, `driver-video`. Each adds questions, providers, validators and checklists; the core knows no provider.

## License

[MIT](LICENSE).
