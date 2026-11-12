# Landscape of skills, tools and infrastructure for DRIVER

Date: 2026-10-26. Consolidation of three parallel research efforts (raw reports in English in this folder):

- [01-process-skills.md](01-process-skills.md): process and methodology skills
- [02-domain-packs.md](02-domain-packs.md): tools per domain for the capability registry
- [03-plugin-infra.md](03-plugin-infra.md): what the Claude Code plugin system allows today

Verdicts: **ADOPT** (declare as a plugin dependency or vendor), **INSPIRE** (rewrite our own version borrowing the technique), **IGNORE**.

## 1. What changes in decisions already taken

Three findings call for revising ADRs. The ADRs have already been updated in `.claude/docs/DECISIONS.md`.

| Finding | Impact |
|---|---|
| Plugins **can declare dependencies** on other plugins with a semver range (`^`, `~`, `=`), resolved against git tags `<plugin>--v<version>`. Automatic install, conflict detection, `claude plugin prune`. | ADR-003 revised: a pinned-version dependency is the default form. Vendoring only for loose skills without a plugin (e.g. `grilling`, 25 lines) or when the upstream does not publish tags. |
| **Workflow does not accept human input mid-run.** Gates have to stay in the main conversation. | ADR-006 confirmed and detailed: one Workflow per Implement/Validate batch, subagents for isolated blocks, gates outside the Workflow. |
| The desktop app's session tools (`start_session` etc.) **are not publicly documented.** The documented path is `claude --bg` + cross-session messaging (`SendMessage`). | ADR-006: nested sessions in v2 use the documented path, not the desktop's internal tools. |

Two findings confirm decisions without changes: no existing plugin draws a live plan graph beside the chat (ADR-002 has an open field), and no maintained skill covers personal finance or a content calendar (the `driver-finance` and `driver-social` packs need original work, ADR-005).

## 2. Process skills: verdict table

| Package | License | Last activity | Phases | Verdict | Why |
|---|---|---|---|---|---|
| obra/superpowers | MIT | Oct 2026 | D, R, I, V, Rel | **ADOPT** as a dependency | Complete, modular pipeline, already installed. Changes every week, so a pinned dependency, not a copy. |
| mattpocock/skills (`grilling`) | MIT | Oct 2026 | D | **INSPIRE** (or vendor) | 25 lines. The "frontier" technique is the core of Discover, but DRIVER needs to persist the tree on disk. |
| github/spec-kit | MIT | Oct 2026 | D, R, I, V | **INSPIRE** | The `clarify` format (multiple choice with a recommendation) and `converge`. Heavy Python CLI to embed. |
| BMAD Method | MIT + trademark | Oct 2026 | D, R, I, V, E | **INSPIRE** | Menu of elicitation methods. Depends on its own Python runtime and the "BMAD" mark is protected. |
| EveryInc/compound-engineering | MIT | Oct 2026 | D, R, I, V, **E**, Rel | **INSPIRE** (maybe adopt `ce-compound`) | Best reference for Evolve. AskUserQuestion as a rule, "decisions already taken" test, `mode:return-to-caller`. |
| anthropics/skills | Apache-2.0 per skill; docx/pdf/pptx/xlsx are source-available | Oct 2026 | no process skills | **IGNORE** (except skill-creator) | There are no process skills. Document skills cannot be redistributed. |
| anthropics/claude-plugins-official | Apache-2.0 | Oct 2026 | R, I, V | **ADOPT** feature-dev and code-review | code-explorer, code-architect and code-reviewer agents; multi-agent review with confidence. |
| ralph / ralph-loop | MIT / Apache-2.0 | Feb 2026 | I | **INSPIRE** | `passes: true/false` per story as the stop condition of Implement. |
| ruflo (ex claude-flow) | MIT | Oct 2026 | I | **IGNORE** | Swarm too heavy to compose. Only ruflo-console is interesting, as a mod reference. |
| claude-task-master | MIT + Commons Clause | Apr 2026 | R | **IGNORE** | License is not open source. Stalled. |
| agent-os | MIT | Oct 2026 | D, R | **INSPIRE** (light) | Codebase pattern extraction in Discover. |

### Techniques to borrow, by phase

**Discover**
- Decision frontier (grilling): each round asks every decision whose prerequisites are already resolved. Facts belong to the agent (non-blocking subagents); decisions belong to the user. Done when the frontier empties.
- Question format (spec-kit `clarify`): 2 to 5 options with `Recommended:` highlighted, a "why it matters" field, "yes" accepts the recommendation. Maximum questions per round ranked by impact × uncertainty.
- One question per turn via AskUserQuestion (compound engineering). This is what preserves the visual choice experience that Diogo likes. Note: superpowers' brainstorming uses free text, not AskUserQuestion.
- "Decisions already taken" test (compound engineering): never re-ask what is already in the assumptions log.
- Constitution (spec-kit): fixed principles that all following phases respect.

**Route**
- superpowers' writing-plans as a dependency, with the 4-point self-review (spec coverage, step sweep, type consistency, review focus).
- spec-kit's `converge`: compare the codebase against the plan and append only what is missing, without editing the original plan. Useful for the re-baseline in Evolve.

**Implement**
- superpowers' subagent-driven-development as a dependency.
- Ledger that survives compaction (superpowers): "trust the ledger and `git log`, not memory".
- `passes: true/false` per block (ralph) as an objective completion condition.

**Validate**
- superpowers' Iron Law (IDENTIFY, RUN, READ, VERIFY) with a table of forbidden rationalizations.
- Official code-review with confidence scoring.

**Evolve**
- `ce-compound`: one learning per round in `solutions/<category>/`.
- Elicitation menu (BMAD): pre-mortem, red team, Socratic, as a reusable checkpoint before Gate 2.
- `mode:return-to-caller`: a skill calls a skill and receives a structured result. This is the composition hook DRIVER needs.

**Release**
- superpowers' finishing-a-development-branch (merge / push+PR / keep / discard).

## 3. Capability registry: default ideal stack

Ten entries that DRIVER suggests by default. CLI always preferred when it exists (zero context cost until it is called). Full tables per domain in [02-domain-packs.md](02-domain-packs.md).

| # | Capability | Default provider | Access | Alternative |
|---|---|---|---|---|
| 1 | Design quality | impeccable (Paul Bakaus, Apache-2.0, 89k★) | skill + `npx impeccable` | official frontend-design |
| 2 | Web deploy | Vercel | CLI + official plugin | Netlify, Cloudflare, Railway |
| 3 | Database + auth + storage | Supabase | CLI for migrations; read-only, project-scoped MCP for SQL | Neon, Better Auth, Clerk |
| 4 | Payments | Stripe | official plugin, test mode first | |
| 5 | Transactional email | Resend | CLI + skills (MIT) | Postmark |
| 6 | Mobile | Expo + EAS CLI; MobileBuildMCP for native iOS | CLI | mobile-mcp for device control |
| 7 | Video | HyperFrames (HeyGen, Apache-2.0) | CLI + skills | Remotion (paid license for companies with 3+) |
| 8 | Voice | ElevenLabs CLI / hosted MCP | CLI | Kokoro (free local) + whisper.cpp (transcription) |
| 9 | Data and spreadsheets | DuckDB CLI + `gws` (Google Workspace CLI) | CLI | Anthropic's xlsx skill (reference only) |
| 10 | Social | Postiz | CLI (28+ platforms) | Typefully |

### Recent changes that invalidate common assumptions

- The local ElevenLabs MCP was archived (Aug 2026). Use the hosted MCP or the CLI.
- `@railway/mcp-server` was archived (May 2026). The MCP now ships in the CLI: `railway mcp`.
- XcodeBuildMCP became `getsentry/MobileBuildMCP`.
- Auth.js / next-auth in maintenance since Jul 2026. Better Auth is the practical successor.
- Superdesign stalled since Aug 2026 and overlaps impeccable. Avoid.

### Gaps that require original work

- **Personal finance:** no maintained skill. Anthropic's `financial-services` is professional modeling. `knowledge-work-plugins/finance` is generic. `driver-finance` will be largely original.
- **Content calendar:** no strong skill. `knowledge-work-plugins/marketing` is the closest. Same for `driver-social`.
- **Live plan graph:** no existing mod. The closest are ruflo-console (swarm cockpit) and the official project-artifact (static HTML page via Artifact). DRIVER's mod is unprecedented.

### Licenses that prevent vendoring

Anthropic's document skills (docx/pdf/pptx/xlsx): source-available, no redistribution. Reference, never copy. claude-task-master: Commons Clause. BMAD: MIT code but protected name.

## 4. Infrastructure: what the plugin can do today

Installed CLI: 2.1.305. Mods require ≥ 2.1.287.

| Question | Answer | Source |
|---|---|---|
| Can a plugin contain mod + skills + agents + hooks + workflows + MCP? | Yes, all together. | confirmed |
| Versioned dependency between plugins? | Yes, semver against tags `<plugin>--v<version>`. | confirmed |
| Can a mod draw a panel beside the chat? | Yes. Elements: Box, Text, Button, Select, Markdown on all surfaces. **SVG only on Desktop and VS Code.** Terminal uses Box/Text or Raster. It is not HTML or a webview. | confirmed |
| How does a mod receive state? | Reactive `$.state` (resets on `/clear`), persistent `$.store`, events (`tool.call`, `classic.SubagentStop`, `classic.TaskCompleted`...), `$.fs` to read a file. No `fs.watch`: poll with `$.clock` or react to `tool.call` of Write/Edit. | confirmed |
| Can a mod expose a tool for the model to call? | Yes, `$.tool.register` → `mcp__driver__<name>`. | confirmed |
| Does Workflow accept human approval mid-run? | **No.** One workflow per step; gate in the main conversation. | confirmed |
| Is a gate via AskUserQuestion reliable? | Partially: `askUserQuestionTimeout` can auto-continue. Reinforce with a `PreToolUse` hook or a `tool.call` guard in the mod that refuses Agent/Workflow until `approved: true` in the plan. | inferred |
| Does a skill call a skill? | No direct mechanism. "Invoke skill X" in the body is the practical pattern. `context: fork` + `agent` runs the skill in a subagent without history. | confirmed |
| Do native tasks with dependencies work as a graph? | Not as a source of truth: off by default on new models, undocumented fields and storage. `TaskCreated`/`TaskCompleted` hooks exist. | confirmed / not found |
| Desktop nested sessions? | Undocumented tools. Documented path: `claude --bg` + cross-session `SendMessage` (plain text, queue of 50, never grants approval). | confirmed |

### Orchestration matrix

| Need | Use |
|---|---|
| One focused block, result returns to context | Subagent (explicit model, background) |
| Many similar blocks, fixed fan-out, no human gate | Workflow (one per step) |
| Parallel blocks that edit the same files | Subagent with `isolation: worktree` or `claude -w` |
| Long, independent streams the user wants to follow | `claude --bg` + SendMessage (v2) |
| Headless (`-p`, SDK, cloud) | Subagent or Workflow; the mod does not draw, only hooks |

## 5. Implications for the DRIVER architecture

1. **Canonical graph in `.claude/driver/plan.json`**, owned by DRIVER. Blocks, states, edges, linked requirements, provider per block, `approved` flag per gate. Markdown per block when long text is needed. The mod's `$.state` is only a view.
2. **Mod as the graph panel**, inside the core plugin. SVG on Desktop/VS Code, Box/Text layout in the terminal, Mermaid in a file as the universal fallback. Registered tool `mcp__driver__set_block_state` so the model updates state without writing JSON by hand.
3. **Gates enforced by hook**, not only by prompt. `PreToolUse` refuses Agent/Workflow in the next phase while the plan does not have `approved: true`.
4. **superpowers, feature-dev and code-review as pinned dependencies.** `grilling` vendored (25 lines, MIT). Nothing from Anthropic's document skills copied.
5. **Discover with AskUserQuestion, one question per turn**, decision frontier, options with a recommendation, assumptions log on disk and the already-taken-decisions test.
6. **Evolve inspired by `ce-compound`**: one learning per round, downstream impact analysis on the graph, re-baseline via `converge` logic.
7. **Packs as separate plugins in the same marketplace**, depending on the core. `driver-finance` and `driver-social` will have more original work than the others.
8. **Minimum CLI 2.1.287** declared. The mods API is early access; recheck `claude-code.d.ts` on every release.

## 6. Recommended next step

Plan graph format (`plan.json`). It is the design decision everything else depends on: mod, gate hooks, traceability, packs. After it: Discover and Route, which are where the current manual pipeline is weakest.
