# Design 5: live plan-graph pane (mod)

Date: 2026-10-28. Source: design subagent (Opus) over ADR-009/010, the v1 code and `claude-code.d.ts` 2.1.312. Raw report kept in English; the approved plan (PT-BR) is `.claude/plans/2026-10-28-mod-diagrama.md` and the decision is ADR-011.

## Findings that changed the brief

- **Trust anchor.** `command.run` carries `e.origin`; only the person's own Enter is `{kind:'composer'}`. A `ui.press` is also person-initiated. The model can produce neither. The approval channel is therefore "composer origin or pane press, plus a one-shot hashed ticket". Without the origin check, any nonce or token scheme is forgeable.
- **Ticket delivery.** `$.process.run` takes `{cwd, env, stdin, timeoutMs}`. Secrets go over stdin: `ps eww` shows env to the same user and `ps` shows argv.
- **Case-insensitive bypass.** `protectPlan` matches paths case-sensitively; on APFS `.Claude/Driver/plan.json` gets past it. Fix with `realPath` and case-insensitive comparison, in node and in the mod.
- **Workflow prompts** may be a fixed placeholder, so the `DRIVER-BLOCK` marker can be missing; fallback stays `currentPhase`.

## File layout

```
plugins/driver/
  hooks/hooks.json          + "modules": ["../mod/index.tsx"]; the 3 shell hooks stay
  mod/index.tsx             register(): session.start wiring
  mod/state.ts              typed atoms, poller (idempotent ensurePoller)
  mod/cli.ts                runCli(args,{stdin}) → {ok,json,error}; node discovery
  mod/pane.tsx              ui.render Pane, surface switch
  mod/render-terminal.tsx   Box/Text renderer
  mod/tools.ts              set_block_state, plan_ops, plan_status
  mod/hooks.ts              agent.spawn, classic.SubagentStop, tool.call guard
  mod/approve.ts            ticket + /driver approve
  mod/test/*.test.tsx       claude plugin test
  src/shared/               dependency-free (no zod, no node:*, no DOM)
    phases.ts palette.ts plan-doc.ts view.ts gate.ts protect.ts layout.ts svg.ts rows.ts
  types/index.d.ts          PluginState['driver'] contract
```

Toolchain: `schema.ts` re-exports `PHASES`/`BLOCK_STATUSES` from `shared/phases.ts` and builds `z.enum` on top; node `hooks.ts` imports `gate.ts` and `protect.ts` (one implementation). A vitest type test keeps the hand-written `PlanDoc` compatible with `PlanV1`. Current `tsconfig.json` becomes `tsconfig.node.json`; a new root `tsconfig.json` extends `./.claude-plugin/types/tsconfig.json` (engine-written at first load) with `include: mod, src/shared, types` and `types: []`, so any `node:` import under `src/shared` fails typecheck. Vitest files become `*.spec.ts` (`claude plugin test` collects `*.test.ts(x)`). tsup stays CLI-only. Gitignore `.claude-plugin/types/` and `.claude/driver/.mod/`.

New CLI surface: `where --json`; `apply --json` (ops on stdin, one lock, one validation, one write, one event per op, `"$0"` back-references); global `--expect-revision N`; `block owner <id> <agentId> --from <prev>` (CAS op `block.owner`); `gate approve <g> --via-mod` (ticket check); `status --json`.

## Data flow

- `session.start`: `where`; register tools and commands; auto-open the pane only when `e.isInteractive && e.surface !== 'terminal' && planExists`; `ensurePoller`.
- Poller: `$.clock.every(1000)` with the pane open, `5000` closed. Each tick stats `plan.json` and compares `(mtimeMs, size)`; only on change read, parse, `shapeCheck`, compare `revision`, write `$.state` only if it changed. Force a tick after every mod write. Hooks never use cached state. `ensurePoller` runs from `session.start`, `command.run`, `ui.press`, `tool.call` and the first `ui.render` (timers die on hot reload).
- `$.state.driver`: `paths`, `load` (`none | ok{rev} | invalid{issues,lastGoodRev} | error{message}`), `view: PlanView` (~150 bytes per block), `ui` (focus, collapseDone, showRetired, selected, confirm), `detail`, `claims`.
- Pane states: no plan → folder-name `Input` + **Initialize** button (`driver init`); invalid plan → `validate --json` errors first, last good view dimmed under a "stale since rev N" banner; headless → never `ui.open`, tools/hooks/commands keep working.

## SVG renderer (desktop/vscode)

Columns are phase swimlanes with sub-columns by local depth. Constants: `NW=176 NH=44 CG=40 RG=10 LP=14 LG=28 M=12 HH=34 LEG=30 MAXR=12 MINW=92 PX_PER_COL=8`.

1. Visible set: drop retired (unless `showRetired`) and filtered phases; `deps(b) = dependsOn ∩ visible`.
2. Local depth per phase: `d(b)=0` without in-phase deps, else `1+max d(dep)`; memoised DFS; a cycle drops that edge and marks `cyc`.
3. Column wrapping: a depth group with `n>MAXR` splits into `ceil(n/MAXR)` physical columns; `S_p` per phase.
4. Lane expansion (`focus:'auto'`): only `currentPhase` expanded; greedily add neighbours while `naturalWidth ≤ bodyColumns·PX_PER_COL·1.25`; `'all'` expands everything; a collapsed lane is `MINW` wide with a stacked status bar and counts.
5. Geometry: `laneW_p = 2·LP + S_p·NW + (S_p−1)·CG` (or `MINW`); `laneX_0 = M`; `laneX_{p+1} = laneX_p + laneW_p + LG`.
6. Row order: one forward barycenter pass (key = mean slot of placed deps, tie by id); second pass for dep-less nodes using successors.
7. `x = laneX_p + LP + col·(NW+CG)`; `y = M + HH + slot·(NH+RG)`.
8. `H = M + HH + maxSlots·(NH+RG) + LEG + M`; `W = laneX_5 + laneW_5 + M`; `<svg viewBox="0 0 W H">`, no `width` (fits the slot).

Edges: cubic béziers right-middle → left-middle, `k = max(20,(x2−x1−NW)/2)`; backward edges loop below, dashed red; edges into a collapsed lane end in a stub. Pending dep `#6b7280` 1.5; done dep `#9ca3af` opacity .5; selected block's edges `#2563eb` 2.

Nodes: `<g class="n s-<status>">`, rect `rx=6`, line 1 = id (mono 10px bold) + status glyph right-aligned, line 2 = title cut at 25 chars. Glyphs `○ ● ■ ◐ ✓ ↺`; strokes 1 gray / 2.5 blue / 2.5 red / 2 amber / 1.5 green / 2.5 orange dashed. Opaque pastel cards with `#111827` text (readable on dark and light); lanes `rgba(127,127,127,.08)`. Badges: owner pill (`main` or 6 chars of agent id), red `!` on blocked/needs_rework, `▲` high risk, retired at opacity .35 with struck title. `<title>` tooltip (with `isInteractive`) holding id, title, status/since/by, owner, deps, reqs, tests, reason, XML-escaped. Gate markers: vertical line in the gap before `route` and before `release`, solid green + pill `✓ gate route · diogo` or dashed amber + pill `gate route · pending`. Current phase: accent stroke and bold header; later phases at .6. Legend at the bottom. One `<style>` with short classes, integer coordinates, no inline `style=`.

Budget: ~4k fixed + ~520 per node + ~75 per edge (60 blocks ≈ 42k; 200 ≈ 131k). Fallback ladder above 120k: collapse done blocks per phase into `✓ 37 done` (same function as the toggle), then first-line tooltips only, then the terminal renderer with a notice. Cache by `(revision, ui, bodyColumns bucket)` in a module `Map`. `alt` = textual summary.

## Terminal renderer

Phase headers `▸ IMPLEMENT 5/9 done ● current` (folded phases on one line); gate lines `── gate route ✓ diogo 10-21 ──` / `── gate release ✗ pending · /driver approve release ──` (yellow). Each block is `Button plain key=B-xxx`: `{indent}{glyph} B-004 {title…} {owner} ← B-003,B-007 +2` (unmet deps only; indent 2×depth, max 3). `room = viewport.rows − 4`; `auto` focus expands only the current phase; overflow windows around the selection with `↑ 4 more` / `↓ 9 more`.

## Interaction

Hotkeys: `1-6` phase, `a` all, `d` collapse done, `r` retired, `e` export Mermaid, `g` approve pending gate, `x` close detail, `i` init. Selection: row buttons on terminal; a `Select` of visible blocks under the SVG on desktop/vscode (SVG presses do not reach the plugin). Detail: handler re-reads `plan.json` and `blocks/<id>.md` (6k chars), writes `detail`; `Markdown` of the doc; poller refreshes on revision change. Approve in two steps: button → `ui.confirm` → "Approve gate route at revision 42 (baseline 1)?" with **Approve** (`y`, primary) and **Cancel** (`n`). Export runs `export mermaid`, shows the path, offers **Copy** via `$.ui.copy`.

## Model-callable tools (`isDeferred:false`)

Errors: exit 1/2 → `{deny: "DRIVER refused: <stderr .error>"}`; spawn failure/timeout 15 s → `{deny: "DRIVER CLI unavailable: …; fall back to driver via Bash"}`; success → `ok rev 43; created B-012`. Always `--actor model:${agentId ?? 'main'}`, `--root`, `--json`, `--expect-revision` when given.

- `set_block_state {block, status: in_progress|blocked|in_review|done|needs_rework, reason?, owner?, expectedRevision?}` → `block status`; never `not_started` nor `--force`; pre-checks `reason` for blocked/needs_rework.
- `plan_ops {ops: Op[] (1..25), expectedRevision?}`: `block.add`, `block.set`, `req.add`, `decision.add`, `block.retire|req.retire`, `phase.advance`; `"$0"`/`"$1"` reference created ids; JSON on stdin to `driver apply --json`; atomic.
- `plan_status {scope?: summary|phase|block, phase?, block?}`: read-only from a fresh projection, no spawn; returns phase, gates, counts, **ready** blocks (not_started with all deps done at or before current phase), in-progress with owners, blocked with reasons; `block` returns the record and 1.5k of its doc.

## Hooks

- `agent.spawn` (fail-closed `.catch`): fresh read (no plan → `next`; unreadable → deny); marker `DRIVER-BLOCK:\s*(B-\d+)` in `prompt`, then `description`, fallback `currentPhase`; `gateVerdict` (same function as the node hook; closes the workflow-agent gap); contention: block `in_progress` owned by an agent other than main/this orchestrator that `$.agent.list()` shows running → deny; `r = await next(e)`; no `agentId` → no claim; claim: `not_started|needs_rework|blocked` → `block status … in_progress --owner <agentId>`; `in_progress` owned by `main`/empty/not-running agent → `block owner <id> <agentId> --from <current>`; `done|in_review` → nothing. Record `claims[agentId]`; a failed claim after spawn → `$.ui.toast` + `$.session.append` so the orchestrator knows.
- `classic.SubagentStop`: `await next(e)` (the shell hook does the orphan write; do not fight over the lock), drop `claims`, force a tick, toast if the block became `blocked`.
- `tool.call` on `Write|Edit|MultiEdit|Bash`: run `shared/protect.ts::protectPlan` plus `$.fs.stat(dir,{resolve:true}).realPath` and case-insensitive comparison against `driverDir`. The shell hook fails open without `node` on the GUI PATH; only the mod resolves symlinks and case aliases. `PROTECTED_FILE` also covers `.claude/driver/.mod/`.

## Slash command `/driver`

`/driver` | `/driver status` opens the pane (`columns: 72`) and returns a status text. `/driver export` runs `export mermaid` and returns the path plus a fenced mermaid block. `/driver init <name>`. `/driver approve <route|release>`: require `e.origin.kind === 'composer'` (else "approval must be typed by you"); read plan, `R = revision`; `nonce` = 32 random bytes hex; `$.fs.write(<driverDir>/.mod/ticket.json, {gate, revision:R, sha256(nonce), exp: now+15s})`; `runCli(['gate','approve',gate,'--via-mod'], {stdin: nonce})` with `--actor user:<git user.name>`; the CLI reads and **unlinks** the ticket first, checks `exp`, `gate`, `plan.revision === R`, compares `sha256(stdin)` with `timingSafeEqual`, applies `gate.approve` as user; reply plus `context: ["User approved gate route via /driver at rev R"]`.

Why the model cannot forge it: it raises neither a composer `command.run` nor a `ui.press`; `gate approve` via Bash is denied; a script-file bypass still needs a matching ticket written into `.claude/driver/.mod/`, which Write/Edit and Bash write verbs deny; reading the ticket yields a hash; the nonce travels on stdin. The channel is exactly as strong as the plan file's own protection, which beats the TTY path (defeated by pty wrappers). Rejected: plain nonce file (readable, raceable); `DRIVER_MOD_TOKEN` env + `$.store` (visible via `ps eww` and `cat`).

## Tests

- vitest (`*.spec.ts`): golden SVG for web-waitlist; no node overlaps; forward edges have `x2 > x1`; stable output under key-order shuffles; `apply` atomicity; `--via-mod` (expired, wrong hash, wrong revision, replay); `block owner` CAS; `where`; type test `PlanV1` ⊂ `PlanDoc`.
- `claude plugin test` (`mod/test/*.test.tsx`) looping `['terminal','desktop']` with stand-ins for `fs.*`, `process.run` (records argv/stdin), `command.register`, `tool.register`, `ui.open`, `agent.spawn`, mocked clock: terminal shows `B-004`, glyph `●`, `IMPLEMENT` header, `gate route ✓`, pressing a row opens the detail; desktop has an `Svg` with `alt`, `B-004`, `<title>`, length < 120k; 200-block plan under budget with `✓ … done`; no plan → **Initialize** → argv `init`; invalid plan draws issues; `set_block_state` argv; exit 1 → deny with message; `plan_ops` stdin with `$0`; `plan_status` makes no `process.run`; `agent.spawn` denies with gate closed, claims with `--owner a1`, transfers with `--from main`; `/driver approve` from plugin origin refused without write, from composer writes the ticket with the nonce only on stdin; `tool.call` Write to `.Claude/Driver/plan.json` → deny.
- Untested: real paint and scaling, sandboxed tooltips, dark mode, node PATH in Desktop, real lock contention, hot reload.

## Risks and first-load checks (Desktop, `CLAUDE_CODE_PLUGIN_DIRS`, `CLAUDE_CODE_PLUGIN_DIR_WATCH=1`)

1. `$.process.run(['node',…])` under the GUI PATH: discover node via `zsh -lc 'command -v node'`, cache in `$.store`, `userConfig nodePath`. Degradation: tools return the Bash command to run; `/driver approve` falls back to TTY.
2. Which `e.origin.kind` a Desktop-typed `/driver approve` carries; if not `composer`, keep refusing and rely on the pane button. Never widen to `sdk` blindly.
3. `crypto.getRandomValues`/`crypto.subtle` in the mod environment; fallback `openssl rand -hex 32` with the CLI hashing.
4. Wide SVG scales or scrolls? Tall SVG scrolls? `<title>` shows? `PX_PER_COL=8` and 6.4 px/char right?
5. Does `session.start` re-fire after hot reload? May render start a timer?
6. `claude plugin validate` with `hooks` + `modules` in one `hooks.json`; module importing `../src/shared/*.ts`; engine not overwriting the root `tsconfig.json`.
7. `claude plugin test` skipping `*.spec.ts` and `node_modules`.
8. Order of shell `PreToolUse` vs `agent.spawn`; `agentId` present for local workflow agents.
9. Shared lock between mod writes and Bash writes (5 s retry): `process.run` timeout 15 s; `LockTimeoutError` as a retryable deny.
10. Mod API is early access: pin `claude-code.d.ts` 2.1.312 and recheck each release.
