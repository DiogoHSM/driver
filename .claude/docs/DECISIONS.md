# Architectural Decisions · DRIVER

## [ADR-001] Claude Code plugin, not a standalone tool
**Date:** 2026-10-26
**Status:** Accepted

### Context
The original idea was an independent AI tool that would generalize the execution of any project (from a spreadsheet to a complex system). The assessment flagged excessive complexity: per-domain executors, a permission model, dozens of integrations and orchestration would all have to be built from scratch.

### Decision
DRIVER is a Claude Code plugin. Claude Code is the harness: it provides the executor, permissions, subagents, worktrees, hooks, checkpoints and UI. The plugin builds only the process layer.

### Alternatives considered
- Standalone tool on top of the Agent SDK: discarded because of the cost of rebuilding what Claude Code already provides.
- Just a set of loose skills: insufficient, because the state graph and the diagram would be missing.

### Consequences
Total dependency on the Claude Code ecosystem. The living diagram depends on the desktop app (mod), with a Mermaid fallback for the CLI.

---

## [ADR-002] The central artifact is the plan graph, not the diagram
**Date:** 2026-10-26
**Status:** Accepted

### Context
The original document treated the diagram as the project's "nervous system". LLM-generated diagrams are unstable and cannot be versioned.

### Decision
The living artifact is a graph of blocks in a file (format to be defined), with per-block state, dependencies, artifacts and linked requirements. The diagram is a rendering of that graph. Phase → epic → block hierarchy for large projects.

### Consequences
Solves hundreds of blocks (hierarchical collapse), export (serialization), versioning (graph diff) and the CLI fallback (Mermaid). The graph format is the most important design decision of the project and is still open.

---

## [ADR-003] Compose existing skills: pinned dependency by default, vendoring as the exception
**Date:** 2026-10-26 (revised the same day after the infrastructure research)
**Status:** Accepted

### Context
superpowers, grill-me, impeccable, hyperframes and others already cover a good part of the process. Depending on them at runtime carries risk on both sides: upstream may change for the worse, or DRIVER may want to diverge. The research confirmed that plugins can declare `dependencies` in `plugin.json` with a semver range (`^`, `~`, `=`), resolved against git tags `<plugin>--v<version>`, with automatic installation and conflict detection.

### Decision
- Plugins that DRIVER uses directly (official superpowers, feature-dev, code-review) come in as a **declared dependency with a pinned version** (`=x.y.z` or `~x.y`). Updating is deliberate: DRIVER only raises the version after review.
- **Vendoring** (a copy with attribution, version and license in the header) only for: loose skills with no published plugin (e.g. `grilling` by Matt Pocock, 25 lines, MIT) or upstreams that do not publish version tags.
- Domain skills (impeccable, hyperframes, ElevenLabs...) are never vendored nor fixed dependencies; they are suggested and installed on demand through the capability registry (ADR-004).
- Anthropic's document skills (docx/pdf/pptx/xlsx) are source-available without redistribution: reference only.

### Alternatives considered
- Vendor everything (original decision): loses superpowers' weekly updates and accumulates drift. Rejected after confirming that version pinning resolves the risk of unwanted change.
- Dependency without pinning: exposes DRIVER to upstream changes without review.
- Rewrite everything: repeats good work.

### Consequences
DRIVER needs to publish its own tags via `claude plugin tag`. Cross-marketplace dependencies require `allowCrossMarketplaceDependenciesOn` in the root marketplace. If superpowers does not publish tags in the expected format, it falls under the vendoring exception.

---

## [ADR-004] Per-block capability registry, loaded on demand
**Date:** 2026-10-26
**Status:** Accepted

### Context
Autonomous execution needs many integrations (Vercel, Supabase, Railway, Clerk, Resend, Google, ElevenLabs, Figma...). Dozens of MCPs on at the same time degrade tool selection and consume context.

### Decision
Integrations are an attribute of the block, not of the project. A capability registry maps capability → providers → form of access (CLI preferred, MCP when there is no CLI, direct API). Discover suggests providers to those who do not know them. Route records the provider per block and the credentials needed. Implement loads only what the block needs. Credentials are a requirement raised in Discover.

### Consequences
Nothing is loaded by default. A permission model per action type (reversible runs, irreversible confirms, destructive in production requires a gate) needs to be defined before autonomous execution.

---

## [ADR-005] Core + packs per domain
**Date:** 2026-10-26
**Status:** Accepted

### Decision
`driver` (core: phases, graph, gates, mod, Evolve) + packs `driver-web`, `driver-mobile`, `driver-finance`, `driver-social`, `driver-video`. Each pack contributes: domain interview questions, entries in the capability registry, validators and a release checklist. The core does not know providers.

### Consequences
Avoids the excessive generalization of the standalone version. Packs can evolve independently.

---

## [ADR-006] Parallelism: subagents and worktrees in v1; nested sessions in v2
**Date:** 2026-10-26
**Status:** Accepted

### Context
The desktop app exposes tools for one session to start and control others. Nested sessions are expensive and opaque to the orchestrator.

### Decision
v1 uses subagents (explicit model, background, `isolation: worktree` when blocks edit the same files) and the Workflow tool for homogeneous batches without a human gate. Nested sessions only in v2, for long, independent blocks that the user wants to follow separately, and only with a file-based state protocol that all sessions write and the mod reads.

Constraints confirmed in the research:
- Workflow **does not accept human input in the middle of execution**. Gates stay in the main conversation; one Workflow per Implement or Validate batch.
- The desktop app's session tools (`start_session` etc.) are not publicly documented. v2 uses the documented path: `claude --bg` + cross-session messaging (`SendMessage`), which is plain text, a 50-message queue and never grants approval.
- Headless (`-p`, SDK, cloud): the mod does not draw, only hooks work. The plugin needs to degrade to this mode.

---

## [ADR-007] Name of the fifth phase: Evolve
**Date:** 2026-10-26
**Status:** Accepted

### Context
Candidates: Evolve, Examine, Evaluate.

### Decision
Evolve. Examine and Evaluate mean "verify", which is already Validate. Evolve names the novel part of the method: deciding where to go back to, recording why, and re-baselining the plan and graph.

---

## [ADR-009] Graph in `.claude/driver/plan.json`; mod renders; gates enforced by hook
**Date:** 2026-10-26 (accepted on 2026-10-27 with the format defined in ADR-010)
**Status:** Accepted

### Context
Infrastructure research: Claude Code's native Tasks are off by default in new models and have undocumented fields and storage. The plan mode file is per session and has no documented format. Mods can draw a panel beside the chat (SVG only on Desktop and VS Code; Box/Text or Raster in the terminal), read files via `$.fs`, react to events and register tools that the model calls. `AskUserQuestion` can be auto-continued by `askUserQuestionTimeout`.

### Decision
- Source of truth: `.claude/driver/plan.json`, owned by DRIVER, with blocks, states, edges, linked requirements, provider per block and an `approved` flag per gate. Markdown per block for long text.
- The core mod mirrors the file into `$.state` and draws: SVG on Desktop/VS Code, Box/Text layout in the terminal. Mermaid generated to a file as a universal fallback (CLI without mod, headless, export).
- The mod registers `mcp__driver__set_block_state` so the model can change state without hand-writing JSON.
- Gates are enforced by a `PreToolUse` hook (or a `tool.call` guard in the mod) that refuses Agent/Workflow in the next phase while the plan does not record `approved: true`. A prompt alone is not a gate.

### Consequences
Minimum CLI 2.1.287. The mods API is early access: recheck `claude-code.d.ts` on every release. No existing mod does this; it is the novel part of the plugin.

---

## [ADR-010] `plan.json` v1 format: canonical snapshot, single writer, event ledger
**Date:** 2026-10-27
**Status:** Accepted
**Plan:** `.claude/plans/2026-10-27-plan-json-v1.md`

### Context
ADR-009 fixed the file, not the format. Consumers of the file: mod (polling via `$.fs`, draws SVG or Box/Text), shell `PreToolUse` hook (needs to answer "gate approved?" with a `jq` expression), the `mcp__driver__set_block_state` tool, Mermaid exporter, phase skills. Decisive fact: the file lives in git, so each subagent worktree has a stale copy.

### Decision
1. **Canonical snapshot in JSON**, not an event log as the source: the hook and the mod need a cheap read. `requirements` and `blocks` are objects indexed by id (`R-001`, `B-001`) for O(1) lookup in `jq` and stable diffs.
2. **Two counters:** `revision` goes up on every write (CAS and change detection by the mod); `baseline` goes up only on re-baseline in Evolve (0 until Gate 1).
3. **Block states** in snake_case: `not_started · in_progress · blocked · in_review · done · needs_rework`. Every transition stamps `statusSince`, `statusBy` (`{kind: model|user|hook, id}`) and, in blocked/needs_rework, `statusReason`. `not_started → in_progress` records `owner` and works as a claim under lock.
4. **Gates** in `gates.route` and `gates.release` (key = phase released). Approval only by user command, never by the model. Automatic revocation by the writer: `release` falls on re-baseline, when a block leaves `done`, when the phase goes back from evolve/release, or when a requirement enters or leaves after Gate 1; `route` falls only when the phase goes back to discover. (Revised on 2026-10-27: the initial version revoked `route` on every requirement change, which made it impossible to add a requirement in Evolve without going back to Discover. Gate 1 approves the understanding; later changes are a matter for the re-baseline and Gate 2.)
5. **Single writer:** a TS core (pure reducer + node adapter) used by the `driver` CLI and by the mod tools. Protocol: root resolved by the main worktree (`git rev-parse --git-common-dir`), lock by `mkdir .lock` (stale after 30 s, retry up to 5 s), validate before writing, `.tmp` + fsync + rename, deterministic serialization, then append an event to `events.jsonl`. The orchestrator is the normal writer; subagents return a structured result.
6. **Ledger** `events.jsonl` committed (`merge=union`), rotated to `log/REL-n.jsonl` at every Release. `plan.json` holds only the current state; history lives in the ledger and in git.
7. **Nothing is deleted:** blocks and requirements removed by Evolve get `retired: {at, decision, reason}` citing a `D-xxx`. Ids are allocated only by the writer from `nextId`, never reused.
8. **Long text outside the JSON:** `blocks/<id>.md`, `requirements/<id>.md`, `decisions/<id>.md`; path implied by the id.
9. **Credentials** only as environment variable names in `provider.credentials`; values never enter the file.
10. **Extensibility:** `ext` per pack (`ext['driver-web']`); optional reserved fields `estimate`, `parent`/`epics`, `impact`; readers ignore unknown fields; `schemaVersion` only goes up on a breaking change.
11. **Hooks:** `PreToolUse` on `Agent|Task|Workflow` reads the `DRIVER-BLOCK: B-xxx` marker from the prompt (fallback `currentPhase`) and denies if the phase gate is not approved; missing file → allow, unreadable → deny. `PreToolUse` on `Edit|Write|MultiEdit|Bash` denies direct writes to `plan.json`/`events.jsonl` (including redirection, `sed -i`, `tee`, `mv`, `cp`, `rm` via Bash) and `gate approve` coming from the model. `SubagentStop` moves to `blocked` the `in_progress` block whose `owner` ended without a handoff. Hooks look for the plan first in the main worktree, then in `cwd`.
12. **Additional reducer guards:** a block does not start in a phase later than `currentPhase`; `release` only approves with `route` approved; `release.add` requires the `release` gate; `needs_rework` clears `verification`; `in_review` requires a filled `## Handoff` section in `blocks/<id>.md` (store check, `--force` for the user). The invariant `phases.currentValid` (block started in a phase later than the current one) is a warning, not an error, to allow `phase back` with already completed blocks. Requirement coverage (`req.coverage`) is a warning until the validate phase and an error from then on, so that requirements can enter in Implement and Evolve before getting a block.
13. **CLI:** `--root <dir>` or `DRIVER_ROOT` override the git-based resolution (needed for examples inside another repository). Root = main worktree via `git worktree list --porcelain`, then `--show-toplevel`, then `cwd`. Default actor `model:main`; `DRIVER_ACTOR` or `--actor kind:id` to change it.
14. **User-only actions require an interactive terminal** (adversarial review of 2026-10-27): `gate approve`, `rebaseline` and `--force` open `/dev/tty` and ask for a typed `yes`; without a tty (the case of the model's Bash tool) the CLI refuses. `--actor user:x` alone grants nothing. The protection hook still denies, after normalizing quotes and expansions, Bash commands that invoke these actions or wrap them in `script`/`expect`/`unbuffer`. Known limit, demonstrated in the review: a script written to a file and run under a pseudoterminal (`script`, `expect`, `pty.spawn`) defeats the confirmation; for that reason the hook denies any use of these wrappers in Bash, not only alongside `driver`. This raises the bar, it does not close it; the model-proof channel is the mod command (`$.command.register`) in v2. Pending item recorded: the orchestrator only knows a subagent's `agent_id` after creating it, so `--owner` covers the case when the id is passed in the claim; mapping via `SubagentStart` is left for the mod phase.
15. **Decisions recorded in the plan:** `decisions` (optional, `D-xxx` → title, date, reason, actor), created by `decision add`, by `gate approve route` and by `rebaseline`. Retiring a block or requirement requires citing an existing decision (`ref.decision`).

### Alternatives considered
- Event log as the source of truth, derived snapshot: every consumer would have to fold the log; the `jq` hook would get expensive. Rejected.
- Edges in a separate `edges[]` list: redundant with `dependsOn` in v1; other relations come in as a new field.
- Hash-based ids (avoids collision in human merges): loses readability; `driver renumber` repairs collisions.
- Claude Code native Tasks as storage: off by default in new models, undocumented fields (see ADR-009).

### Consequences
Hooks require `node` on the PATH (the gate check has a pure `jq` fallback). Worktree branches never touch `plan.json`, so merging back does not conflict. `$.fs` capabilities (exclusive create, rename, stat) need to be confirmed before the mod; the fallback is the CLI's `$.process.spawn`.

---

## [ADR-011] Living diagram mod: panel in the core, approval by user origin + ticket, owner claim on `agent.spawn`
**Date:** 2026-10-28
**Status:** Accepted
**Plan:** `.claude/plans/2026-10-28-mod-diagram.md` · **Design:** `docs/research/05-mod-design.md`

### Context
ADR-009 anticipated the mod; `plan.json` v1 left two gaps that only the mod closes: the model-proof gate approval channel (the TTY confirmation falls to a pseudoterminal) and the `agent_id` → block mapping. Facts about the mods API (2.1.312): the module has no Node or DOM (it does not import zod or `node:*`); `command.run` carries `e.origin`, and only the user's Enter is `composer`; `ui.press` is also initiated by the person; `agent.spawn` sees the prompt and returns `agentId`, including for Workflow agents; `$.process.run` accepts `stdin`.

### Decision
1. **Mod inside the core plugin** (`plugins/driver/mod/`), listed in `hooks/hooks.json` under `modules`, living alongside the shell hooks (which keep applying in headless).
2. **Dependency-free shared code in `src/shared/`** (phases, palette, `PlanView` projection, gate verdict, protection rules, layout, SVG, terminal lines). The node code (zod schema, shell hooks, mermaid) imports from there; the mod does too. A root `tsconfig.json` with `types: []` prevents `node:*` in `src/shared`. Vitest tests become `*.spec.ts`; `*.test.tsx` is left for `claude plugin test`.
3. **Rendering:** on Desktop and VS Code, **vertical** SVG: phases as stacked bands, 56 px cards with 13 px text, orthogonal edges, gates as a line with a pill between the bands. The drawing is made at the panel width in pixels (`bodyColumns × 9` minus 16 of margin; the original 8 left a ninth of the panel empty on Desktop, measured on 2026-11-11) and passed to the `Svg` element with explicit `width`/`height` and `isInteractive` (hover, `<title>` as tooltip), so it is never rescaled: a narrow panel scrolls instead of shrinking. Palette equal to Mermaid's with fixed dark text on opaque cards (legible in dark and light), status glyphs for color blindness, a 131k-char budget with a degradation ladder (collapse `done` per phase, short tooltips, fall back to the card board). Since clicks inside the SVG do not reach the plugin, block selection is a `Select` in the bar (or an `Input` with the id above 64 drawn blocks). Mobile: native card board (`Box`/`Button`). Terminal: one line per block, a button per line, automatic focus on the current phase. The horizontal swimlane layout stays in `src/shared/layout.ts` for export.
4. **Writes always through the CLI** via `$.process.run(['node', dist/cli.js, ...])`; new commands: `where`, `apply --json` (atomic, one revision for several ops), `--expect-revision`, `block owner` (CAS), `status --json`. Reads via `$.fs` with 1 s polling (5 s with the panel closed) and detection by `mtime`/`size`/`revision`.
5. **Tools for the model** (`mcp__driver__set_block_state`, `plan_ops`, `plan_status`), not deferred, with structured errors from the reducer; they never expose `gate approve`, `rebaseline`, `--force` or `not_started`.
6. **Model-proof approval channel:** `/driver approve <gate>` only with `e.origin.kind === 'composer'` (or a panel button via `ui.press`); the mod writes a one-shot ticket `{gate, revision, sha256(nonce), exp 15 s}` in `.claude/driver/.mod/` and calls `gate approve --via-mod` with the nonce through **stdin**; the CLI deletes the ticket before validating, requires `plan.revision` equal to the one the user saw, and compares the hash in constant time. The model does not produce a composer `command.run` nor `ui.press`; `gate approve`, `via-mod` and writes to `.claude/driver/` are denied in Bash by tokens (not by phrase), and the guard only applies where a plan exists. Strength of the channel = strength of the protection of `plan.json` itself, which the 2026-10-28 review showed can be bypassed by a script in a file and `cd` chains: therefore the channel **raises the bar and is auditable** (every approval records `approvedVia: tty|mod` and, in the mod, the ticket hash; the mod alerts on any gate that becomes approved without having been issued by the session, with a red banner when `approvedVia` is missing or the ticket is unknown), it is not model-proof. Risk explicitly accepted: inline interpreters (`node -e`, `python -c`) with concatenated strings are not blocked, because denying them in every project with a plan would generate too many false positives; the defense is tamper evidence, not prevention. Rejected: nonce in a plain file (readable), token in env or `$.store` (visible via `ps eww` and `cat`).
7. **Owner claim on `agent.spawn`:** the mod reads `DRIVER-BLOCK: B-xxx` from the prompt, applies the same gate verdict as the shell hook (closes the gap for Workflow agents), and after `next` records `in_progress --owner <agentId>` or transfers with `block owner --from main`. `classic.SubagentStop` only redraws (the shell hook does the orphan handling). The mod's `tool.call` guard repeats `protectPlan` with `realPath` and case-insensitive comparison (fixes the `.Claude/Driver` bypass on APFS, in node as well).

### Consequences
Adversarial review (`docs/research/06-review-mod.md`) required: guards by basename and by token independent of directory, guard scope restricted to projects with a plan, gate also for resumed agents (`SendMessage`), ticket with a 20 s window and a `via`/`ticket` record in the event. Dependency on `node` on the PATH of the GUI app (discovered via `zsh -lc`, cached in `$.store`, `userConfig nodePath`; degradation documented). Mods API is early access: `claude-code.d.ts` 2.1.312 pinned, recheck per release. First-load checklist in the plan.

Visual iteration (2026-10-29): the first SVG (horizontal swimlanes, 10 px font, no `width`) came out unreadable on Desktop, which drew it at the reduced intrinsic size; a text list and a board of native cards were tested and rejected as too poor. The cause was scale, not format: item 3 now describes the vertical SVG sized in pixels. HTML/webview and Mermaid do not exist in the mod panel; if the SVG is still not enough, the alternative is a local page served by the CLI and opened in the Desktop browser, outside the mod and without the approval button.

Guard refinement (2026-10-29, PER-619): `protectCommand` treated every heredoc line as a command and denied code with `(` and `$` (a regex in a test, for example) with the user-only action message. Semantics adopted, the same as bash's: a heredoc body is the stdin of the command that opens it, not a sequence of commands; it is judged by that command. Shell on the line (`bash <<EOF`, `cat <<EOF | sh`) → body recursed as commands; `xargs` over the CLI → body becomes arguments; interpreter (`python3 -`, `node -`) with a body that mentions a protected file or after `cd` into the plan directory → denied with its own message (`MSG_SCRIPT`, the same rule as `python -c`); body with an unquoted delimiter → each `$( … )` and backtick is recursed, because the shell expands them. `<<` inside quotes or after `#` does not open a heredoc; `"$( … )"` reopens command context (the idiom of `git commit -m "$(cat <<'EOF'`). At the same time the normalizer started treating a line break as `;` (before, it collapsed into a space, and `echo hi` followed by `driver gate approve route` on another line got through), grouping parentheses are discarded (`(driver rebaseline)` is judged as `driver rebaseline`) and a command name coming from a substitution or variable is denied with `MSG_SUBST`. Two reviews (the first, adversarial, was interrupted by a security classifier; the second audited the classification against bash 3.2 and zsh 5.9) added: comment only after an unescaped separator, `${ … }`, `$[ … ]` and `$'…'` in the scanner, heredoc opened on a continued line or read by the line following a `|`, terminator `EOF)` inside `$( … )`, `patch`/`git apply` with a body that mentions a protected file, `cd` context inherited by the recursed body, `$( … )` in argument position judged as a command, wrappers with options (`sudo -E`, `nice -n`, `timeout`), `case`/functions/keywords discarded and names compared case-insensitively. Separators (`|`, `;`, `&`) inside quotes, `[[ ]]`, `(( ))` and `${ }` no longer split the command (they were the source of old false positives such as `grep -E 'a|(b)$'`); in exchange, the code passed to `bash -c`/`eval` is judged recursively as the commands it contains. A quoted string is only judged as commands when the line has a known code executor (shells, `eval`, `source`, `su`, `watch`, `find`, `xargs`, `ssh`, `npx`/`npm`/`pnpm`/`yarn`, `tmux`, `make`, `docker`, `git -c alias.*=!`/`core.sshCommand=` adjustments etc.): it is a blocklist by nature, and an executor outside it (`git config alias.x '!…'` followed by `git x`, `osascript`/`perl` with `system(…)`) gets through. Accepted cost: `eval "$(…)"` and `bash -c "$X"` are denied (opaque code coming from an expansion); an inline script that mentions `plan.json` is denied even when it only reads; a commit message with `;` is denied if the same line contains the word `bash` (`brew install bash && git commit -m "a; …"`); `driver 'gate approve' route` gets through because bash delivers a single argv and the CLI does not split arguments. Out of reach, recorded: a function defined on an earlier line and called with a heredoc, `bash <<< $'…\x20…'`, zsh's `exec {fd}<<EOF`, code written to a file and executed later. Adjustment of 2026-10-30: the script of an in-place editor (`sed -i`, `perl -pi`, `ruby -i`; the value of `-e`/`-f` or the first operand) is not a path and is taken out of target judgment; before, an `s/.*/x/` applied to a file in `.claude/` was read as a glob able to cover `.mod` and denied.

---

## [ADR-012] Phase skills: Discover and Route as native core skills, interview by options, writes only through the tools
**Date:** 2026-10-30
**Status:** Accepted

### Context
With the CLI, `mcp__driver__*` tools, hooks and panel ready, whoever uses DRIVER still needs to know how to call `plan_ops` by hand. The research (`docs/research/skills-landscape.md`, sections 2 and 6) points to Discover and Route as the weakest link of the manual pipeline and indicates what to compose: the decision frontier from grilling, the question format of spec-kit's `clarify`, one question per turn with `AskUserQuestion` (compound-engineering), the self-review of `writing-plans`. `grilling` and spec-kit are not installed; superpowers 7.0.0 is, but `brainstorming` uses free text and `writing-plans` writes a plan in markdown, not blocks in the graph. Raw design in `docs/research/07-skills-design.md`; plan in `.claude/plans/2026-10-30-skills-discover-route.md`.

### Decision
1. **One skill per phase, in the core, in the native plugin skill format:** `plugins/driver/skills/discover/SKILL.md` and `plugins/driver/skills/route/SKILL.md`, `user-invocable: true`, invocation by the model allowed (Discover invokes Route after the gate), no `context: fork` (the interview needs the history). Skill text in English; the conversation happens in the user's language. Shared conventions in `plugins/driver/references/driver-conventions.md`, outside `skills/`.
2. **Interview by options, one question per turn:** `AskUserQuestion` with 2 to 3 real options plus "I don't know / you decide", the recommended one first with the `(Recommended)` suffix, the consequence in the description and "Why it matters" in the text. Decision frontier (grilling) persisted in `discover/interview.md` on every answer; facts are established by background read-only subagents, decisions belong to the user; already-made decisions are tested against `discover/assumptions.md`, earlier answers and the repository. "I don't know" never blocks: research, a safe default recorded as an `A-nn` assumption, or deferral.
3. **Proportionality** through the ADR-008 mechanism (below), decided in the first round by estimated effort and recorded as a `D-nnn` decision.
4. **No dependency on superpowers in this round.** Discover has its own style; Route copies the self-review checklist from `writing-plans` (coverage, sweep, dependencies, review focus, proportion). The pinned dependency of ADR-003 is left for B-006, where Implement uses `subagent-driven-development`.
5. **During the interview only files; the plan receives a batch at the end.** Requirements, assumptions (`source: assumed`, `ref: discover/assumptions.md`), non-goals (`kind: non-goal`) and the class decision enter through `plan_ops` after the accepted play back, in batches of up to 25 ops. Reason: nothing is deleted (ADR-010 item 7). The skill writes `requirements/R-nnn.md`, `discover/*.md`, `blocks/B-nnn.md` and `route/risks.md` with Write/Edit; `plan.json`, `events.jsonl`, `log/` and `.mod/` stay out of reach; gate, rebaseline and `--force` stay with the user.
6. **Each skill has a block in the plan** ("Discovery interview" in discover, "Route plan" in route depending on the first), with artifacts (paths relative to the project root, such as `.claude/driver/discover/interview.md`), Handoff and `verification.passes` marked by the model with the user's explicit acceptance as evidence. Route ends with `phase.advance` to implement; there is no human gate between Route and Implement (vision, section 5). A `done` block is never reopened: amend (Discover after the gate) and replan (Route) create new blocks ("Discovery amend: <topic>", "Route replan: <reason>"); the only exception is rework of the Discovery before the gate, via the path `done → needs_rework → in_progress`. The output batch is idempotent: the created ids are recorded in `interview.md` and a re-entry only adds what is missing.
7. **Route decomposes into implement, validate, evolve and release blocks** with observable output, an acceptance criterion as the definition of done, `dependsOn` only for real dependencies, coverage of every requirement by ≥ 1 implement and ≥ 1 validate, risk by a fixed rule, `provider` when there is an external capability, a risk matrix in `route/risks.md`, a diagram validated by the user (panel and `export mermaid`) and `driver validate` without a `req.coverage` warning.

### Consequences
Rejected: superpowers' `brainstorming` as Discover (free text, no persistence, no visual options); incremental `req.add` during the interview (retire noise); a human gate at the end of Route (only two gates). Accepted risks: class L may exceed 30 turns (mitigation: ceiling per round and compaction-proof files); the panel does not show requirements until the end of the interview; the model's `verification.passes` on the skills' blocks. Confirmed on first load (2026-10-30): slash `/driver:discover` and `/driver:route`; `allowed-tools` with `Bash(driver *)` accepted by `claude plugin validate`. Opus adversarial review of the same date: 7 mandatory fixes (block lookup by title via `plan_status scope: phase`, idempotent output batch, an interview closed before the gate goes back to the gate step, amend/replan without reopening a `done` block, `kind` of assumptions, block range only implement and validate, text of the `route` gate in the conventions) and 9 improvements applied (reclassification at the end of round 1 with flags in the frontmatter, "never re-ask without new information", assumptions become `Accepted: yes` on acceptance, a notice that approving the gate does not start a model turn, block docs only with Edit, artifacts relative to the root and `exports/plan.mmd` outside the artifacts because it is gitignored, quoted heredoc in the CLI fallback, transition table in the conventions, research subagents of type `Explore`).

---

## [ADR-013] Interview by interest: product core, areas by choice, summary as the final message, silent logging
**Date:** 2026-11-10
**Status:** Accepted (revises ADR-008 and items 2 and 5 of ADR-012)

### Context
First dogfooding of the skills (copy of `examples/web-waitlist`, class S). The protocol worked, but Diogo pointed out four problems: (1) the interview was too long for the size, because "personal data" (an email field) raised the depth to class M and the per-round ceiling became a target; (2) low-impact technical questions asked to someone who may not want to decide them, without relevant decisions being allowed to be made behind their back; (3) the acceptance summary did not appear: text written before a tool call is condensed in the terminal, and the question "is the summary above correct?" was left without a summary; (4) every answer produced a diff of `interview.md` on screen, and the `sed` edits ran into the guard.

### Decision
1. **Product core, always asked.** After classification (domain and size), the interview asks only what only the user knows: goal and success signal, audience, indispensable capabilities, what stays out. Total core budget, counted in questions and not in rounds: XS 2, S 4, M 6, L 8. It is a ceiling, not a target: a node with a safe default becomes an assumption without a question.
2. **Technical areas by choice.** After the core, a multiple-choice question: "In which areas do you want to decide the details?", with 2 to 4 areas derived from the domain (for web: infrastructure and hosting, data and privacy, design and content, metrics). Area checked: up to 3 questions. Area not checked: the model decides and records each decision as an `A-nn` assumption with the choice and the reason in one line. XS skips the areas question (everything decided by the model and shown in the summary).
3. **Always-ask exception.** A decision that is costly to reverse, spends money, collects sensitive data (payment, health, documents, minors) or acts on production is asked even with the area skipped. Replaces the class bump of ADR-008: a contact email is not a trigger.
4. **Progress and early exit.** Every question carries the progress ("3 of ~6"). From the third question after classification, one of the options is "Enough, summarize": open nodes become assumptions with the recommended default. Checkpoint (pre-mortem, red team, socratic) only for classes M and L.
5. **Summary as the final message of the turn.** The summary is running text in the user's language, with no tool call after it in the same turn: goal, what will be built, what the user decided, what the model decided for them (with reason), what stays out, open questions. It ends by asking for "accepted" or what to change; the user may also ask why a decision was made or open a skipped area. The same text is written to `.claude/driver/discover/summary.md`. Acceptance comes in the user's next message; only then does the output batch run.
6. **Silent logging through the `mcp__driver__discover_log` tool.** The source of truth of the interview becomes `.claude/driver/discover/interview.jsonl` (append-only, written only by the CLI). The tool calls `driver discover log` (JSON on stdin) and the CLI regenerates `interview.md`, `assumptions.md` and `non-goals.md` from the log; the model no longer edits these three files. With no write arguments the tool returns the state (meta, nodes, non-goals, frontier) for resumption. Contract:
   - input `{ meta?, nodes?, nonGoals? }`, all optional;
   - `meta`: `goal`, `class` (XS|S|M|L), `domain`, `language`, `stage` (core|areas|summary|closed), `areas` (list offered), `chosenAreas`, `reclassified` (bool), `checkpoint` (none|pre-mortem|red-team|socratic|skipped), `batchApplied` (string); absent keys stay as they are;
   - `nodes[]`: `id` (`Q-nn`; absent creates the next), `question`, `area` (core or area name), `dependsOn[]`, `kind` (fact|decision), `status` (open|researching|settled|assumed|deferred), `answer`, `source` (user|research|assumed), `options[]` (shown), `why` (reason, required when `status` is assumed), `requirement` (`R-nnn`, filled in after the batch); update is by `id`, an absent field stays as it is; a node that becomes `assumed` gets an automatic `A-nn`;
   - `nonGoals[]`: `id` (`N-nn`; absent creates), `statement`, `reason`, `requirement`;
   - output: created ids, counts per status and the frontier (open nodes whose `dependsOn` are settled or assumed).
7. **Route follows the same pattern** (added the same day, after Diogo ran Route in the terminal): confirmation of the plan stops being a tool question about a diagram that the terminal does not show. The turn ends with the list of blocks per phase (id, title, dependencies, risk, what runs in parallel), count against the range, critical path and high-risk blocks, in the user's language, also written to `.claude/driver/route/summary.md`; confirmation comes in the next message. Block documents are filled in by the `mcp__driver__block_doc` tool (`driver block doc`, JSON on stdin: `{blocks:[{id, spec?, acceptance?[], notes?, handoff?}]}`, 1 to 30 per call), which rewrites only the named sections, preserves frontmatter and title, refuses a `done` or retired block and does not touch `plan.json`. The skills no longer use Write, Edit, `sed` or redirection in `blocks/` nor in the generated files of `discover/`.
8. **Guard.** `sed -i`, `perl -pi` and `ruby -i` after a `cd` into the plan folder are only denied when the operand is protected, is a glob or does not exist (before, any in-place edit there was denied, including of `discover/interview.md`). An unexpected exception in the guard still denies the call, but the case that caused it becomes a test. A change to the guard goes through adversarial review (GUARDRAILS).

9. **Adjustments from the adversarial review (same day).** Budgets per class, all ceilings: core XS 2, S 4, M 6, L 8; area questions in total XS 0, S 3, M 6, L 9 (at most 3 per area); "always ask" at most 2, outside the budgets and valid for every class, by a closed list (spends money; collects payment, health, document or minors' data; deletes data irreversibly; creates a legal commitment). Hosting, choosing a database and an email field are not triggers. Acceptance is recorded (`meta.accepted`) before the output batch, which first reads the requirements already in the plan and only adds what is missing. Only decisions that the product must fulfill become requirements (classification and area choice stay in the log). Requirement files go through the `mcp__driver__req_doc` tool. A section body cannot contain a level 1 or 2 heading outside a code block, and the reducer requires exactly one `## Handoff`. The mod refuses writes coming from a subagent, except state and the document of the block it owns. The two summaries (`discover/summary.md`, `route/summary.md`) are user documents, in their language, headings included.
10. **Guard, second round.** In addition to item 8: a `sed` script with `w` near a protected file or with `e` is denied, with or without `-i`; `perl`/`ruby` code in any flag cluster counts as an inline script, and in-place editing by them inside the plan folder remains denied; script glued to the flag, BSD sed's `-I`, `--in-place=SUF` and `-l N` are recognized; braces, `{a..b}` sequences and zsh alternation count as expansion; a `cd` that reaches the plan folder via `..`, `pushd` or a variable counts as being in it; relative `log/*` is protected there.

### Consequences
The depth of the interview now depends on the user's interest, not only on size: someone who is not technical answers the core and reviews the summary; someone who wants to decide infra checks the area. The class still fixes the Route block range. Costs: more decisions made by the model (mitigation: none is left out of the summary and the exception in item 3); acceptance costs one extra turn; `interview.jsonl` is one more file and the CLI gains a markdown renderer. `interview.jsonl` does not enter the list of files protected by the guard in this round (the skill forbids editing it; protecting it is a future decision if dogfooding shows manual editing). Rejected: keeping rounds with smaller ceilings (does not solve "who decides what"); putting the summary in the tool's question field (size limit, no formatting).

---

## [ADR-014] Next step always visible: the panel says what to do and the main button triggers Claude

**Date:** 2026-11-11 · **Status:** Accepted · **Issue:** PER-669 (second dogfooding)

**Context.** In the second dogfooding (new project, Desktop app) Discover and Route went well, but the handoff between them left the user lost: approving the gate and clicking "Advance to route" changed the phase in the plan and nothing else happened, because the panel only writes to the plan and does not trigger the model. In addition, the panel offered "Advance to implement" with the route phase having no blocks, and "Advance to validate" with implement at 0 of 12.

**Decision.**
1. The panel always shows a "Next: ..." line with the next step, derived only from the `PlanView` (pure function `nextStep`). No plan state is left without a visible next step, except a completed release.
2. The main button has three forms, in this order:
   - **Approve `<gate>` gate** when the method asks for a gate and it is not approved (rule of ADR-011, unchanged, with the two confirmations and the ticket). Once the gate is approved, the mod advances the phase and triggers Claude, with no second click.
   - **Continue `<phase>`** when the current phase has no blocks or has an active block that is not completed. It does not write to the plan; it only triggers Claude.
   - **Start `<next phase>`** when all active blocks of the current phase are completed and the next one does not depend on a pending gate. It advances the phase and triggers Claude.
   The "Advance to ..." button ceases to exist: advancing with the phase incomplete remains possible through the `plan_ops` tool and the CLI (the reducer does not change), but the panel does not offer it.
3. "Triggering Claude" is `$.prompt.submit` with a short, fixed text that names the phase and the skill (`driver:discover`, `driver:route`); for phases that still have no skill, the text asks for `plan_status`, the list of ready blocks with a recommendation and reason, and the question of which to start with. The submission is its own turn, queues if the session is busy and reaches the model with origin `plugin`.
4. A typed `/driver approve <gate>` does the same as the button: approves, advances and triggers.
5. The prompt sent by the mod never approves anything: approval still requires origin `composer` or `ui.press` plus a ticket. A prompt with origin `plugin` is only a work request, equal to a user message, and goes through the same gate hooks.

**Alternatives discarded.** Only filling the message field with `/driver:route` (my initial proposal): it still requires knowing that an Enter is missing, and the user asked that approving carry things forward. Firing without a click on detecting an approved gate in polling: it would spend a turn on an approval made in another terminal or session.

**Consequences.** Whoever approves a gate accepts spending the following turn; this is stated in the confirmation text ("Approve and start ..."). The phase skills must end every final message with the user's next step (already a rule in ADR-013 for Discover and Route; it applies to those of B-006).

## [ADR-015] Next step in every response and optional autopilot in Implement

**Date:** 2026-11-11 · **Status:** Accepted · **Issue:** PER-669 (second dogfooding)

**Context.** In the coffee-app Implement, Claude closed a block, made the requested commit and ended the response without saying what came next. The author knows it is enough to ask it to continue; an ordinary user is left stuck. The request was: there should always be a hint, a question, or an option to turn on automatic mode and let Claude decide everything until the end of the implementation.

**Decision.**
1. **Permanent rule in the prompt.** In a project with a plan, the mod adds a section to the system prompt (`prompt.compose`, id `driver:next-step`, scope `session`): every final response of the main session ends with the user's next step, as a question with options or as the exact action to take; after a side task (commit, question) the response returns to the plan, lists the ready blocks and recommends one with the reason. It applies in any phase and does not depend on a skill.
2. **Autopilot**, off by default, turned on by the user in the panel ("Autopilot" button) or by `/driver auto on|off`. It only acts in the implement phase. When on, at the end of each turn of the main session the mod reads the plan and, if there is work, sends the next request via `$.prompt.submit`. The request text tells Claude to choose the block, decide on its own whatever has a safe default, record non-obvious choices with `decision.add` and not ask questions.
3. **The autopilot stops by itself** (turns off and warns in the panel and by toast) when: all implement blocks are completed; there is no block ready or in progress (what remains is blocked); the turn was interrupted by the user, refused or died from an error; the plan did not change revision in two consecutive automatic turns; or it went past 60 automatic turns in one activation.
4. **What the autopilot never decides.** The closed "always ask" list from ADR-013 (spending money, payment, health, document or minors' data, irreversible deletion, legal commitment), plus publishing or sending outside (push, deploy, store) and a missing credential. In these cases Claude marks the block as `blocked` with the reason and moves on to another ready block; with no other, the autopilot stops by item 3. Gates remain human: the autopilot does not approve, and could not (ADR-011).
5. The autopilot state lives in `$.state` (session), not in the plan: closing the session turns it off.

**Alternatives discarded.** An end-of-turn hook that only demands the next step when it is missing: it would require judging the response text. Autopilot covering validate and evolve: those phases still have no skill and Evolve decides scope; left for after B-006.

**Consequences.** The autopilot spends turns without asking; the five brakes in item 3 limit the cost, and the "plan unchanged" one catches an unproductive loop. Decisions made in automatic mode stay in `decisions/` for review in Evolve.

## [ADR-016] Change after the gate: three-level triage, baseline suggested in Evolve, autopilot in the Validate and Implement loop

**Date:** 2026-11-11 · **Status:** Accepted, implementation in B-006 · **Issue:** PER-669 (second dogfooding)

**Context.** In coffee-app, Validate failed three blocks and the user brought usage feedback from the iPhone. With no Validate or Evolve skill, Claude created four new blocks in implement (decisions D-004 and D-005) with the phase at validate. The engine accepted it: the plan approved at the gate grew with no mark or warning, the current phase stopped saying where the work is, and the validation blocks were left in progress waiting for a fix. The user asked whether that wasn't already Evolve and a new cycle, and set the limit: an arbitrary change cannot restart the cycle; DRIVER evaluates, suggests and always offers the next step, including continuing to decide on its own.

**Decision.**
1. **Triage of every change that appears after the route gate**, done by Claude before touching the plan:
   - **Level 1, fix.** Something failed against an acceptance criterion that already exists. The originating block goes to `needs_rework` with the report as the reason and is worked on again. No new block is created and no question is asked.
   - **Level 2, adjustment.** New work that serves an already approved requirement and does not change what other blocks deliver. It enters as a new block, with `decision.add`, a one-line notice to the user, and the work proceeds without a question, with or without autopilot.
   - **Level 3, scope change.** New or changed requirement, touching a non-goal, an item on the "always ask" list (ADR-013), or invalidation of an already completed block. Claude evaluates the impact (affected blocks, estimated size) and asks with three outcomes, one recommended: enter this cycle; wait for the next cycle (pending item recorded, the current release does not wait); replan now (back to Route, only when the structure of the plan changes).
2. **No level restarts the cycle on its own.** Rebaseline ceases to be a precondition for working: the blocks and requirements that came in after the current baseline are marked in the plan and in the panel. In the Evolve review DRIVER shows the difference from the baseline and suggests confirming the next one, all at once. The act remains the user's alone (ADR-010, ADR-011).
3. **The current phase follows the work.** While there is rework or adjustment in implement with the phase at validate, the panel shows the loop (Validate back to Implement) instead of leaving validate as the only active phase; the validation block waiting for a fix does not stay in progress, it is `blocked` with the block holding it as the reason.
4. **Next step in the triage.** The response that communicates the triage ends with the two ways to proceed: one item at a time with a question, or continue on its own until closing (autopilot).
5. **Autopilot in the loop.** Revises item 2 of ADR-015: the autopilot applies in implement and validate and in the back and forth between the two. When on, it decides levels 1 and 2; at level 3 it adopts the recommended outcome and records the decision, except for what it never decides (ADR-015 item 4), where it stops. The brakes of ADR-015 item 3 apply equally; "everything completed" becomes implement and validate completed.

**Alternatives discarded.** Stopping and requiring a new cycle for every block created after the gate: turns a small adjustment into ceremony, and the user refused. Blocking `block.add` after the gate without a rebaseline: the same rigidity, imposed by the engine. Asking at level 2 too: one more stop per adjustment, with no real user decision at stake. Leaving it as is: the route gate loses its meaning when the plan grows without a mark.

**Consequences.** The classification between level 2 and 3 is the model's judgment; the "after the baseline" mark and the review in Evolve are what make a classification mistake visible. It requires from the engine: an origin mark per block and requirement relative to the baseline, a list of next-cycle pending items, and the phase rule from item 3. It requires from the mod: a mark on the card, the loop in the panel, autopilot in two phases. The Validate and Evolve skills (B-006) carry the triage.

**Addendum (2026-11-11, B-006 plan).**
1. **The "after the baseline" mark is derived**, with no new field in `plan.json`: a block or requirement is after the baseline when its id does not appear in any `baselines[].added` or `.reqAdded`. Existing plans work without migration and `schemaVersion` stays at 1. Known limit: if the route gate is revoked and approved again, what was created in the interval appears as later.
   **Correction from the adversarial review (same date).** Baseline 1 is born at the approval of the route gate, before Route creates the blocks; derived only from there, every block of the plan would come out marked. Baseline 1 now **closes at the end of Route**: on the `phase.advance` from route to implement, the reducer adds to baseline 1 the active blocks and requirements still outside it and records `closedAt` in the entry (optional field; `baselines[]` is a loose object, no version change). It is the plan the user confirmed in step 6 of Route. Without `closedAt`, the view marks nothing. Plans that have already passed Route are closed once, on the next write, by the internal op `baseline.close`, computed from the ledger (what was created before the phase change to implement); without a ledger, it closes with everything that exists.
2. **Next-cycle pending items stay outside `plan.json`**, in `backlog.jsonl` in the plan folder, written by the silent tool `mcp__driver__backlog`, with `backlog.md` generated. A requirement deferred inside the plan would force changes to coverage, the release gate and rebaseline; outside it nothing is revoked and the list becomes input to the next Discover (`amend`).
3. **The new baseline can be confirmed in the panel**, `Confirm baseline N` button, through the same path as the gate approval of ADR-011 (user origin and ticket). The terminal remains valid. For the model it stays impossible. The baseline entry stores `via` and `ticket`, and the panel applies to it the same forgery detection as the gates (alerts when the baseline changes without a ticket issued by it).
4. **The wait of a validation block is derived**: a `blocked` block with an uncompleted dependency. The view exposes whom it is waiting for and when it can be resumed; a subagent spawn does not unblock a block in this situation.

## [ADR-017] Superpowers as optional support for the core skills

**Date:** 2026-11-11 · **Status:** Accepted · **Revisits:** ADR-003 (only for the core) and ADR-012 item 4

**Context.** ADR-003 anticipated superpowers as a pinned dependency, and ADR-012 postponed the pin to B-006, where Implement would use `subagent-driven-development`. A cross-marketplace dependency requires the user to allow `allowCrossMarketplaceDependenciesOn`, and whoever installs DRIVER would become obliged to install another plugin. The audience that dogfooding showed is the ordinary user, for whom each extra installation step weighs.

**Decision.**
1. The core skills carry the complete protocol in their own text: test first, verification by evidence (identify, run, read, check), destination of the code at release.
2. If the superpowers plugin is installed, the skill invokes the equivalent through the Skill tool (`test-driven-development`, `verification-before-completion`, `finishing-a-development-branch`) and follows the result; if it is not, it follows its own text. No version is pinned in the manifest.
3. ADR-003 continues to apply to packs and to vendored skills: header with origin, version and license.

**Alternatives discarded.** Hard pinned dependency: heavier installation and breakage when upstream changes major version. Vendoring the superpowers skills: the plugin is published and versioned, and ADR-003 reserves copying for those that are not.

**Consequences.** The own text needs to be maintained; in exchange DRIVER works on its own. Behavior varies a little depending on whether superpowers is installed or not, which dogfooding should cover in both cases.

## [ADR-018] The repository is written in English

**Date:** 2026-11-12 · **Status:** Accepted · **Revisits:** the language convention in `CLAUDE.md` and `.claude/GUARDRAILS.md` (docs in Brazilian Portuguese, code in English)

**Context.** The repository was mixed: code, skills and panel texts in English; ADRs, plans, vision, part of the research and the worked examples inside the skill templates in Portuguese. The plugin is meant to be published, and a reader who does not read Portuguese could not follow the decisions behind it.

**Decision.**
1. Every file in the repository is written in English: `README.md`, `CLAUDE.md`, `.claude/docs/`, `.claude/plans/`, `docs/`, code, comments, skill texts and the examples in skill templates. New commit messages are in English.
2. File names follow the same rule. `docs/vision/initial-definition.md` becomes `docs/vision/initial-definition.md` and `.claude/plans/2026-10-28-mod-diagram.md` becomes `.claude/plans/2026-10-28-mod-diagram.md`.
3. Skills keep talking to the user in the user's language, and user documents (`discover/summary.md`, `evolve/review.md`) are still written in that language. Only the examples shipped in the repository changed.
4. Existing commit messages are not rewritten: the author decided the history stays as it is.
5. The DRIVER plan of this repository (`.claude/driver/`) keeps its existing Portuguese titles, block documents and ledger. `events.jsonl` is append-only and `validate --replay` checks it against `plan.json`, so translating it would mean editing the plan by hand, which the fixed rules forbid. New blocks, requirements and decisions are written in English.

**Alternatives discarded.** Translating only the README and the user-facing docs: the ADRs are the most useful reading for a contributor and would stay closed. Keeping two languages side by side: double maintenance for a single author. Rewriting the plan ledger: breaks the one-writer rule for no gain to the reader.

**Consequences.** The no em dash rule checked by `test/skills.spec.ts` stays. The plan folder of this repository is the one place where Portuguese remains, and it fades as the plan moves on.

## [ADR-008] Proportionality of ceremony
**Date:** 2026-10-26 (closed on 2026-10-30 by ADR-012)
**Status:** Accepted

### Context
A minimum of 3 interview rounds with no duration limit puts off small projects (a deck, a script).

### Decision
The depth of Discover and the number of Route blocks scale with a size class decided in the first round of the interview, by the effort estimated by the user:

| Class | Signal | Rounds | Questions per round | Blocks in Route |
|---|---|---|---|---|
| XS | one afternoon | 1 + play back | 3 | 2 to 4 |
| S | a few days | 2 + play back | 4 | 4 to 8 |
| M | a few weeks | 3 + play back | 6 | 8 to 15 |
| L | months or a team | 3 or more, until the frontier empties | 8 | 15 to 30 |

Money, personal data, production, irreversible actions or a regulated domain raise the depth of Discover by one class, without changing the block range. The class is recorded as a decision in the plan; the user may reclassify once, at the end of the first round; exceeding the block range requires a stated reason.

**Revision of 2026-11-10 (ADR-013):** the "Rounds" and "Questions per round" columns and the class bump for risk cease to apply. The class fixes the budget of the interview core (XS 2, S 4, M 6, L 8 questions in total) and the block range; technical depth comes from the areas the user chooses.

The block range counts only implement and validate blocks. The fixed blocks of each plan ("Discovery interview", "Route plan", "Evolve review" and the release block) are constant overhead and do not count; without this, XS would not fit in 2 to 4 (revision of 2026-10-30). XS also waives the reclassification question and the non-goals question: both enter the play back.
