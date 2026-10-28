# Pesquisa 3: infraestrutura de plugin do Claude Code

Data: 2026-10-26. Fonte: subagent de pesquisa (Opus), docs oficiais em code.claude.com, repos oficiais e CLI local (versão 2.1.305). Relatório bruto em inglês; síntese em português em [skills-landscape.md](skills-landscape.md).

Labels: **[C]** confirmed in docs or local files, **[I]** inferred, **[NF]** not found.

Installed CLI: **2.1.305**. `claude plugin --help` lists `init`, `install`, `update`, `tag`, `validate`, `test` (a mod's tests), `eval`, `details`, `prune`, `configure`. `claude --help` has `-w/--worktree [name]`, `--tmux` (needs `--worktree`), `--bg`, `-n/--name`, `--agent`/`--agents`, `--plugin-dir`.

## 1. Plugin anatomy

**Manifest** (`.claude-plugin/plugin.json`) [C] ([manifest reference](https://code.claude.com/docs/en/plugins-reference)):
- Only `name` is required.
- Other fields: `displayName`, `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`, `metadata`, `defaultEnabled`, `dependencies`, `settings` (only `agent` and `subagentStatusLine` take effect), `userConfig`, `types` (the mod's `$.state` contract), `channels`.
- Component keys: `skills`, `commands`, `agents`, `hooks`, `mcpServers`, `lspServers`, `outputStyles`, `workflows`, and under `experimental`: `themes`, `monitors`, `evals`.
- Default layout: `skills/`, `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`, `output-styles/`, `workflows/`, `themes/`, `monitors/monitors.json`, `bin/` (on the Bash `PATH`), `settings.json`.
- Path variables: `${CLAUDE_PLUGIN_ROOT}` changes on every update, never write state there. `${CLAUDE_PLUGIN_DATA}` (`~/.claude/plugins/data/<id>/`) survives updates. `${CLAUDE_PROJECT_DIR}` is the project root.
- A `CLAUDE.md` at the plugin root is not loaded.

**Mods** are a plugin component [C]. `hooks/hooks.json` holds `{"modules": ["./register.tsx"]}` instead of the usual hook map ([mods overview](https://code.claude.com/docs/en/plugins/mods/overview.md)). One plugin can ship a mod, skills, agents, workflows and MCP servers together.

**marketplace.json** (`.claude-plugin/marketplace.json`) [C] ([marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference.md)):
- Required: `name`, `owner`, `plugins[]`. Optional: `description`, `version`, `metadata.pluginRoot`, `forceRemoveDeletedPlugins`, `allowCrossMarketplaceDependenciesOn`, `renames`.
- Each entry: `name`, `source`, plus `version`, `strict`, `dependencies`, `category`, `tags`, `relevance`, `defaultEnabled`.
- Source types: relative `./path`, `github`, `url`, `git-subdir` (all take `ref` and `sha` pins), `npm`, `archive` (with `sha256`), `command`.

**Versioning** [C]: `version` in plugin.json pins users until changed. `claude plugin update` applies after restart or `/reload-plugins`. `claude plugin tag --push` creates a `<name>--v<version>` git tag after validating.

**Dependencies: yes** [C] ([dependencies](https://code.claude.com/docs/en/plugins/dependencies.md)):
- Entry forms: `"name"`, `"name@marketplace"`, or `{name, version, marketplace}`.
- `version` is npm-style semver (`^2.0`, `~2.1.0`, `=2.1.0`), resolved against `<plugin>--v<version>` git tags.
- Missing dependencies install automatically. Conflicting ranges fail. `claude plugin prune` removes orphans.
- Cross-marketplace dependencies need `allowCrossMarketplaceDependenciesOn` in the root marketplace.
- Local dev: `claude --plugin-dir ./dep --plugin-dir ./mine`.
- For mods, the dependency's `$` contract types are laid next to the dependent mod [C, plugin-authoring reference.md].
- Copying skill files in is only needed for loose skills not packaged as a plugin [I].

## 2. Mods / UI panels

[C] Sources: [overview](https://code.claude.com/docs/en/plugins/mods/overview.md), [interface](https://code.claude.com/docs/en/plugins/mods/interface.md), [gallery](https://code.claude.com/docs/en/plugins/mods/gallery.md), local `plugin-authoring` skill (`reference.md` + `types/claude-code.d.ts`, ~22k lines).

**What a mod is:** JS/TS event handlers `($, e, next)` running inside Claude Code. No DOM, no Node; everything through `$`. API is early access and changes between releases. Needs CLI ≥2.1.287 (Desktop ≥2.1.286); on by default.

**Where it draws:** a pane (`$.ui.open({id, title})` + `on('ui.render', {component:'Pane'})`) docked beside the transcript in a wide fullscreen terminal, above the prompt otherwise; a band above the prompt (`AbovePrompt`); `$.ui.status`, `$.ui.toast`, `$.ui.log`; can restyle spinner, messages, tool-call rows.

**What it can render:** an element tree from `$.ui.resolve(e)`, JSX via `h`. Not HTML, not React, not a webview.

| Element | Terminal | Desktop | VS Code |
|---|---|---|---|
| `Box`, `Text`, `Button`, `Input`, `Select`, `Link`, `Code`, `Markdown` | Yes | Yes | Yes |
| `Svg` (≤131,072 chars; image, or sandboxed frame when `isInteractive`) | No | Yes | Yes |
| `Raster` (colored character-cell grid) | Yes | No | No |
| `Image` (kitty, Ghostty, iTerm2) | Yes | No | No |
| `Client` (second file for animation and pointer input; no mods API; talks back via `ui.message`) | Yes | Yes | No |

**How it gets data:**
- Events: `tool.call`, `turn.start`, `turn.step`, `turn.complete`, `session.start`, `session.append`, `prompt.submit`, `agent.offer`, `skill.prompt`, and every settings-hook event as `classic.<Event>` (e.g. `classic.SubagentStop`).
- Reactive `$.state`: writing redraws views that read it. Survives hot reloads; resets on `/clear`, `/resume`, `/branch`.
- `$.store`: persistent KV under `~/.claude/plugins/store/`.
- `$.fs`, `$.clock.every`/`after`, `$.process.spawn`.
- No `$.fs.watch` [NF]: poll with `$.clock`, spawn a watcher, or react to `tool.call` on Write/Edit [I].
- `$.tool.register` exposes a model-callable tool (`mcp__<plugin>__<name>`). `$.command.register` adds a no-model-turn slash command.
- `$.agent.spawn` / `$.agent.list`; `$.model.complete` for a single model call.

**Where it works:** terminal CLI, Desktop Code tab, VS Code (≥2.1.299). Hooks run but nothing draws in `claude -p`, SDK, cloud sessions.

**Existing mods:** samples in [claude-code-playground/claude-code/mods](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods) (`token-weather`, `blast-radius`, `replay-theater`); built-ins in [claude-code/mods](https://github.com/anthropics/claude-code/tree/main/mods) (`diff`, `agents-md`, `sec-default`, `telemetry`). **No mod draws a plan/task graph or kanban** [NF]. The native `/workflows` view and Desktop "plan"/"tasks" panes cannot be extended by mods [I].

## 3. Hooks

[C] [Hooks reference](https://code.claude.com/docs/en/hooks.md), 33 events:

> SessionStart, Setup, UserPromptSubmit, UserPromptExpansion, PreToolUse, PermissionRequest, PermissionDenied, PostToolUse, PostToolUseFailure, PostToolBatch, Notification, MessageDisplay, SubagentStart, SubagentStop, TaskCreated, TaskCompleted, Stop, StopFailure, TeammateIdle, InstructionsLoaded, ConfigChange, CwdChanged, DirectoryAdded, FileChanged, WorktreeCreate, WorktreeRemove, PreCompact, PostCompact, PreModelSwitch, PostModelSwitch, Elicitation, ElicitationResult, SessionEnd.

- Hook types: `command`, `http`, `mcp_tool`, `prompt`, `agent` (experimental). Command hooks can set `async: true` or `asyncRewake: true`.
- Context injection via `hookSpecificOutput.additionalContext` on SessionStart, SubagentStart, UserPromptSubmit, UserPromptExpansion, Pre/PostToolUse, PostToolUseFailure, PostToolBatch, Stop, SubagentStop, PostModelSwitch. Over 10k chars goes to a file. SessionStart also accepts `watchPaths`, `initialUserMessage`, `sessionTitle`, `reloadSkills`.
- Input fields: `session_id`, `transcript_path`, `cwd`, `agent_id`, `agent_type`, `tool_name`, `tool_input`, `tool_use_id`.
- Hook → file → mod: a command hook can write JSON under `${CLAUDE_PLUGIN_DATA}` or `.claude/driver/`, and a mod reads it with `$.fs` [I]. Redundant inside one plugin: the mod can subscribe to `classic.SubagentStop` / `classic.TaskCompleted` and write `$.state` directly [C]. Keep shell hooks for headless runs.

## 4. Orchestration primitives

- **Subagents** [C] ([sub-agents](https://code.claude.com/docs/en/sub-agents.md)): model chosen per-call `model` → frontmatter `model` → `CLAUDE_CODE_SUBAGENT_MODEL` → session model. Background by default. `SendMessage` resumes with full history (Explore and Plan are one-shot). Limit 20 concurrent (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`), nesting 3 deep. Frontmatter: `isolation: worktree`, `background`, `effort`, `maxTurns`, `skills`, `memory`. `permissionMode`, `hooks`, `mcpServers` ignored for plugin agents.
- **Workflow tool** [C] ([workflows](https://code.claude.com/docs/en/workflows.md)): JS script with `agent()`, `parallel()`, `pipeline()`, `phase()`, `log()`, `args`. `agent(prompt, {schema})` returns validated JSON. All paid plans (Pro must enable in `/config`). Limits: 16 concurrent (`CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS`), 1,000 agents per run, 4,096 items per `parallel()`/`pipeline()`. **No mid-run user input.** Resumes in the same session only. `Date.now()` and `Math.random()` throw. Ships in `workflows/`, runs as `/plugin:name`. Docs advise: for sign-off between stages, one workflow per stage.
- **Worktrees** [C] ([worktrees](https://code.claude.com/docs/en/worktrees.md)): `claude -w <name>` creates `.claude/worktrees/<name>` on branch `worktree-<name>`; `--tmux` opens a tmux session. `EnterWorktree`/`ExitWorktree` tools, `.worktreeinclude`, `worktree.baseRef` (`fresh` default branches from remote default branch, **not current HEAD**). Edits into the main checkout are blocked. `-p` runs leave worktrees behind.
- **Nested sessions / desktop `ccd_session_mgmt` tools:** desktop docs describe only in prose ("Claude can list your other Code tab sessions, read what each has been doing, and send messages between them"; sees 20 most recent) ([desktop](https://code.claude.com/docs/en/desktop.md)) [C]. Tool names (`start_session`, `set_remote_control`…) not publicly documented [NF]. Documented cross-surface version: [cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging.md): `ListAgents` + `SendMessage` (with `notify_when_idle`), plain text, ~1M chars/message, 50-message queue, incoming messages never grant approval. `claude --bg` + `claude agents` (research preview) is the CLI way to start background sessions. Agent teams experimental, off by default.

**When to use which [I]:**

| Need | Use |
|---|---|
| One block, focused, result back in context, maybe resumed | Subagent (`model` explicit, background) |
| Many similar blocks, fixed fan-out, cross-checks, no human gates | Workflow (one per phase) |
| Parallel blocks editing overlapping files | Subagent with `isolation: worktree`, or `claude -w` |
| Long-lived independent streams the user may attach to | `claude --bg`, or Desktop sessions + SendMessage |
| Must work headless | Subagent or Workflow (no mod UI; hooks only) |

## 5. Plan/state persistence

- **Native plan file:** location only implied (`~/.claude/plans/` or `plansDirectory` setting, under protected paths in [permission-modes](https://code.claude.com/docs/en/permission-modes.md)) [I]. Per-session, undocumented format. Unsuitable as source of truth.
- **Native task graph:** `TaskCreate`/`TaskGet`/`TaskUpdate`/`TaskList`; `TaskUpdate` "updates task status, dependencies…" [C, [tools reference](https://code.claude.com/docs/en/tools-reference.md)]. On by default only on Opus 4.7, Sonnet 4.6, Haiku 4.5 and earlier; newer models need `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` [C]. Field names (`blockedBy`), storage path, programmatic access by plugins not confirmed [NF]. `TaskCreated`/`TaskCompleted` hooks exist [C].
- **What other plugins do:** markdown with YAML frontmatter under `.claude/` or `docs/` [I].
- **Recommended for DRIVER [I]:** canonical `.claude/driver/plan.json` with the block graph, states and edges; markdown per block where needed. Mod mirrors into `$.state`, `$.store` as cache.

## 6. Skill mechanics

[C] [Skills](https://code.claude.com/docs/en/skills.md).

- **Frontmatter:** `name`, `description` (with `when_to_use`, together ≤1,536 chars), `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context: fork`, `agent`, `background` (default `true` with fork), `hooks`, `paths`, `shell`.
- **Body:** `` !`cmd` `` context injection, `$ARGUMENTS`/`$0`/`$name`, `${CLAUDE_SKILL_DIR}`.
- **Forked subagent:** `context: fork` + `agent: <type>`. Skill body becomes the prompt; subagent sees **none of the conversation history**. `background: false` to wait.
- **One skill calling another:** no direct mechanism. Model calls the `Skill` tool; a subagent can preload skills via `skills`; user can stack `/a /b`. "Invoke Skill X" in the body is the practical pattern [I].
- **Approval gates:** `AskUserQuestion` waits indefinitely unless `askUserQuestionTimeout` is set (then auto-continues) [C], so a prompt-only gate can be bypassed. Stronger: a mod `tool.call` guard or `PreToolUse` hook refusing `Agent`/`Workflow` for a phase until the plan file records `approved: true` [I]. `disable-model-invocation: true` keeps phase skills from auto-triggering.

## Top 5 implications for DRIVER's architecture

- **Build the live diagram as a mod pane inside the DRIVER plugin.** `Svg` for the graph on Desktop and VS Code, `Box`/`Text` (or `Raster`) for the terminal, nothing under `-p`. Register a tool such as `mcp__driver__set_block_state` that the model calls, updating `$.state` and redrawing.
- **One canonical plan file in the repo, `.claude/driver/plan.json`.** Don't rely on native Tasks (off by default on newer models, undocumented fields) or plan-mode files. Mod and hooks read the same file. `$.state` is only the view.
- **Keep approval gates in the main conversation.** Workflows can't take mid-run input: one workflow per Implement/Validate batch, subagents for single blocks, `isolation: worktree` for overlapping edits. Enforce gates with a guard hook, not just prompt text.
- **Declare companion plugins as real `dependencies`** with semver ranges; tag DRIVER releases with `claude plugin tag`.
- **Avoid building on undocumented desktop session tools.** Use subagents and workflows for nested work; `claude --bg` + `SendMessage` for long-lived parallel streams. Pin minimum CLI ≥2.1.287 for mods; recheck the mod API against `claude-code.d.ts` each release.
