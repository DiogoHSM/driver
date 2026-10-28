# Pesquisa 1: skills de processo e metodologia

Data: 2026-10-26. Fonte: subagent de pesquisa (Opus). Dados de repositório (stars, licença, último push, arquivos SKILL.md) coletados via `gh api` em 2026-10-26. Relatório bruto mantido em inglês; síntese em português em [skills-landscape.md](skills-landscape.md).

## Summary table

| Package | License | Stars | Last push | DRIVER phases | Verdict |
|---|---|---|---|---|---|
| obra/superpowers | MIT | ~306k | 2026-10-23 | D, R, I, V, Rel | **ADOPT** (as a dependency, not copied in) + INSPIRE |
| mattpocock/skills (`grilling` / `grill-me`) | MIT | ~304k | 2026-10-19 | D | **INSPIRE** |
| github/spec-kit | MIT | ~143k | 2026-10-26 | D, R, I, V | **INSPIRE** |
| BMAD-METHOD | MIT (+ trademark notice) | ~55k | 2026-10-20 | D, R, I, V, E | **INSPIRE** |
| EveryInc/compound-engineering-plugin | MIT | ~26k | 2026-10-27 | D, R, I, V, **E**, Rel | **INSPIRE** (Evolve) |
| anthropics/skills | Mixed: Apache-2.0 per skill; docx/pdf/pptx/xlsx are source-available only | ~184k | 2026-10-09 | (none are process skills) | IGNORE |
| anthropics/claude-plugins-official | Apache-2.0 | ~45k | 2026-10-27 | R, I, V | **ADOPT** feature-dev and code-review as dependencies |
| snarktank/ralph and official `ralph-loop` | MIT / Apache-2.0 | ~22k | 2026-02-02 | I | INSPIRE |
| ruvnet/ruflo (formerly claude-flow) | MIT | ~80k | 2026-10-27 | I | IGNORE (but see the visual-UI answer) |
| eyaltoledano/claude-task-master | MIT + Commons Clause | ~28k | 2026-04-28 | R | IGNORE |
| buildermethods/agent-os | MIT | ~5.5k | 2026-10-07 | D, R | INSPIRE (lightly) |

## Per-package notes

### 1. superpowers — github.com/obra/superpowers
- **What it is:** 15 skills that form a full pipeline: brainstorming, writing-plans, then subagent-driven-development or executing-plans, then verification-before-completion and requesting-code-review, then finishing-a-development-branch. Also TDD, systematic-debugging and git-worktree skills. Maps to every DRIVER phase except Evolve.
- **How it talks to the user:** Free text, deliberately. Brainstorming asks exactly one question per message, "a single sentence with no list of example answers," open questions first. It offers a short menu only when the user is stuck. It does not use AskUserQuestion. Approaches go out in a message of their own: two or three options, one recommended. Writing-plans and finishing end with numbered options in chat.
- **Where state lives:** specs in `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` (committed); plans in `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`; git-ignored runtime folder `.superpowers/` with `sdd/<plan>/progress.md` (a ledger) and `brainstorm/<session>/{content,state}`.
- **Worth adopting:** a ledger that survives compaction ("trust the ledger and `git log` over your own recollection"); the Iron Law gate in verification (IDENTIFY, RUN, READ, VERIFY) with a "Red Flags – STOP" list and a "Rationalization Prevention" table; writing-plans' 4-point self-review.
- **Verdict: ADOPT.** MIT, modular, already installed. DRIVER should call `superpowers:*` skills as a declared dependency rather than copying them in. Copying with attribution is legally fine, but the files change weekly and would go stale.

### 2. grill-me — github.com/mattpocock/skills
- **Where it lives:** `skills/productivity/grill-me/SKILL.md` is a one-line wrapper that calls `grilling`. A sibling, `grill-with-docs`, runs `grilling` plus `domain-modeling`.
- **What it does:** interviews the user relentlessly, treating the plan as a **design tree**. Each round asks the whole **frontier**: every decision whose prerequisites are already settled. Questions are numbered, each carries a recommended answer (`❓ **Q1** - **title**: body` then `➡️ recommended`), worded so that **"yes" accepts the recommendation**. Done when the frontier is empty; does not act until the user confirms shared understanding. Maps to Discover.
- **How it talks to the user:** free text, numbered batches. No AskUserQuestion.
- **Where state lives:** `grilling` writes nothing. `domain-modeling` writes `GLOSSARY.md` and ADRs in `docs/adr/NNNN-*.md`. `to-spec` publishes to the issue tracker with a `ready-for-agent` label.
- **Worth adopting:** frontier-based batching. Facts are the agent's job (looked up by non-blocking subagents); decisions are the user's.
- **Verdict: INSPIRE.** About 25 lines, MIT, trivial to vendor. But DRIVER will want the design tree persisted to disk, and `grilling` keeps it only in conversation.

### 3. GitHub Spec Kit — github.com/github/spec-kit
- **What it does:** `/speckit-constitution`, then `-specify`, `-plan`, `-tasks`, `-implement`, then `-converge`, repeating until "Converged." Optional `clarify`, `checklist`, `analyze`. Maps to D, R, I, V.
- **How it talks to the user:** `clarify` asks at most **5 questions per session**, **one at a time**, picked from a taxonomy scan (Clear / Partial / Missing) ranked by Impact × Uncertainty. Each question is 2–5 multiple-choice options as a markdown table with `**Recommended:** Option X`, or a short answer of at most 5 words, with a "Why it matters" line. Answers are written back into the spec.
- **Where state lives:** `specs/NNN-<slug>/{spec.md,plan.md,tasks.md}`, `.specify/feature.json`, `/memory/constitution.md`.
- **Worth adopting:** `converge` (compare codebase against spec/plan/tasks, append only unbuilt work, never edit spec or plan); a constitution every later step is held to.
- **Verdict: INSPIRE.** Python CLI plus templates; heavier than a plugin should carry.

### 4. BMAD Method — github.com/bmad-code-org/BMAD-METHOD
- **What it does:** persona agents (analyst, PM, architect, PO, UX, dev), ~30 skills including `bmad-advanced-elicitation`, `bmad-party-mode`, `bmad-retrospective`. Sizes its process to the work. v7 alpha; v6.12 stable.
- **How it talks to the user:** menu-driven. Advanced-elicitation shows 5 critique methods (pre-mortem, red team, Socratic…) plus Reshuffle, halting after each.
- **Where state lives:** `_bmad/` scripts and config (rendered via `uv run _bmad/scripts/render_skill.py`); outputs in `_bmad-output/<initiative>/<type>-<slug>/`, some as HTML "keepsakes".
- **Worth adopting:** the elicitation-method menu as a reusable refinement checkpoint; "party mode".
- **Verdict: INSPIRE.** MIT code, but trademark covers "BMad/BMAD" and skills depend on its Python runtime.

### 5. Compound Engineering — github.com/EveryInc/compound-engineering-plugin
- **What it does:** 36 `ce-*` skills around brainstorm, plan, work, review, then **compound**: write down what was learned. Also `lfg`, `ce-debug`, `ce-commit-push-pr`, `ce-worktree`. Runs on 14 agent hosts. Best fit for **Evolve**.
- **How it talks to the user:** **one question per turn through the host's blocking question tool** (AskUserQuestion in Claude Code), falling back to numbered choices. Matches by capability, never probes for the tool.
- **Where state lives:** `<root>/plans/`, `<root>/solutions/<category>/`, `CONCEPTS.md`; `<root>` defaults to `docs`, configurable via `.compound-engineering/config.yaml`. Plans as `.md` or `.html`, never both.
- **Worth adopting:** `ce-compound` records one learning per run into categorized `solutions/`; a **"settled-decisions" test** that stops re-asking decided questions; a `mode:return-to-caller` token so one skill can call another and get a structured result back.
- **Verdict: INSPIRE** (possibly ADOPT `ce-compound` as optional dependency). MIT, but each skill relies on its own `references/` folder.

### 6. Anthropic official
- **anthropics/skills:** 19 artifact/document skills, no process skills. docx/pdf/pptx/xlsx are **not open source**. **IGNORE**, except skill-creator for writing DRIVER's own skills.
- **claude-plugins-official** (Apache-2.0), 40 plugins. Process-oriented: **feature-dev** (7 phases: Discovery, Codebase Exploration, Clarifying Questions, Architecture Design, Implementation, Quality Review, Summary; code-explorer, code-architect, code-reviewer agents; TodoWrite tracking), **code-review** (multi-agent with confidence scoring), **pr-review-toolkit**, **code-simplifier**, **commit-commands**, **hookify**, **ralph-loop**, **project-artifact**, **playground**.
- **Verdict: ADOPT** feature-dev's agents and code-review as dependencies for Route and Validate.

### 7. Extras
- **ralph** (MIT): autonomous loop, fresh context per story. State: `prd.json` (stories with `passes: true/false`) + append-only `progress.txt`. **INSPIRE:** machine-readable pass/fail per story as stopping condition for Implement.
- **ruflo** (ex claude-flow, MIT): heavy swarm harness (100+ agents, vector memory). **IGNORE** as methodology.
- **claude-task-master:** **IGNORE.** MIT + Commons Clause (not OSI). Last push April 2026. State in `.taskmaster/`.
- **agent-os** (MIT): discover/deploy/index standards + shape spec. **INSPIRE** lightly: extracting codebase standards in Discover.
- **cc-sessions:** stale (last push 2025-12-17).

## Does any of these render a live visual of plan state inside the agent UI?

Not as a live graph of plan state. Closest five:

1. **ruflo-console**: Claude Code plugin ("agent cockpit") on runtime mods, CC ≥ 2.1.287; Overview, Cost, Swarm graph, Events, Missions pages beside the chat. Shows swarm state, not a methodology plan.
2. **project-artifact** (official): tabbed HTML status page via the `Artifact` tool to a private claude.ai URL; refresh redeploys. Separate view, refreshes only when asked.
3. **superpowers' visual companion**: localhost server serving newest HTML from `.superpowers/brainstorm/<id>/content`; clicks come back via `state/events`. Mockups and diagrams during brainstorming only.
4. **playground** (official): one-off HTML explorers (concept-map, code-map).
5. **Compound Engineering** (HTML plans) and **BMAD** (HTML keepsakes): static documents.

**Gap confirmed:** a live DRIVER phase/block graph, updated by hooks from the on-disk plan and rendered in a side pane, does not exist.

## Recommended composition for DRIVER

| DRIVER phase | Built from |
|---|---|
| Discover | grilling frontier + Spec Kit clarify format (multiple choice with a recommendation, "yes" accepts) + Compound Engineering's AskUserQuestion-first rule |
| Route | superpowers writing-plans (dependency) |
| Implement | superpowers subagent-driven-development (dependency), with ralph-style pass/fail per block |
| Validate | superpowers verification-before-completion + official code-review |
| Evolve | Compound Engineering `ce-compound` pattern into `solutions/` |
| Release | superpowers finishing-a-development-branch |

Every MIT and Apache-2.0 package here allows copying markdown skill files with license and attribution kept. Exceptions: Task Master (Commons Clause), Anthropic's document skills (source-available only), BMAD's trademarked name.
