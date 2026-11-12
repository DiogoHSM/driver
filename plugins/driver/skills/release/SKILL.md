---
name: release
description: Run the DRIVER Release phase. Walk a generic release checklist (rollback plan, documentation, observability, pending credentials), ask where the code goes (keep local, merge, or push and open a PR), record the release in the plan and close with the backlog for the next cycle. Use after the release gate is approved, when the plan is in phase release, or when the user asks to ship, release or wrap up.
user-invocable: true
argument-hint: "[version]"
disable-model-invocation: false
allowed-tools: AskUserQuestion, Read, Write, Glob, Grep, Skill, Bash(driver *), mcp__driver__plan_ops, mcp__driver__set_block_state, mcp__driver__plan_status, mcp__driver__block_doc, mcp__driver__backlog
---

# Release

Read `${CLAUDE_SKILL_DIR}/../../references/driver-conventions.md` first. It defines the tools, the reducer rules, the file formats, the artifact path convention and the hard rules. This skill does not repeat them.

Goal: ship what the user approved, record it in the plan, and leave the next cycle's pending items where Discover can find them. You prepare and verify. The `release` gate is the user's and is already approved when you start.

Language: talk to the user in the user's language. `release/checklist.md` is a user document: write it entirely in the user's language, headings included. Other files keep English headings.

Orientation: never write text before a tool call; it is condensed in the terminal and not seen. Orientation lines go inside a question's text or the final message.

Never write `plan.json`. Never edit a block document with Write, Edit, `sed`, redirection or heredocs: use `mcp__driver__block_doc`. Write is for `release/checklist.md` only (Read first if it exists). Never store a credential value anywhere: env var names only.

Project commands (tests, build, git, gh) are not pre-approved by this skill: they go through the user's normal permission mode, so a permission prompt for them is expected.

## Step 1: Start

1. Call `mcp__driver__plan_status`.
2. Gate `release` not approved: **stop**. Tell the user to press Approve release gate in the DRIVER pane or type `/driver approve release`, and end the turn. Never approve it, never hint it is done.
3. Phase still `evolve` with the gate approved: if `plan_status` reports the approval as unverified, stop and tell the user; do not advance. Otherwise run `phase.advance` once. If the reducer refuses, read why and report it (usually blocks still open behind).
4. Run `driver validate`. Any error (including `gate.releaseIncomplete` or requirement coverage in release) is a stop: report it and the next step; do not release around it.
5. Find the block: `mcp__driver__plan_status` with `scope: "phase"`, `phase: "release"`. The release block is the active block of phase `release`, found by phase and not by title. Create it with `block.add` (phase release, `dependsOn` the "Evolve review" block) only if there is none. Move it to `in_progress` only if its status is `not_started`.
6. Version: the argument if given. Otherwise ask inside step 3 with the destination question (not a git repo: ask the version alone), proposing one from the last release in `plan.json` `releases[]` or the project's version file.

## Step 2: Checklist

Generic core checklist only; domain packs add their own items later. Work through these, read-only checks first, and record the result of each in `.claude/driver/release/checklist.md` (template: `${CLAUDE_SKILL_DIR}/templates/checklist.md`):

| Item | What to check |
|---|---|
| Rollback plan | How to undo this release (revert commit, previous deploy, data migration down). Write it in one paragraph. If it cannot be undone, say so; that is a question for the user. |
| Documentation | README, setup and usage notes, the changelog or release notes match what was built. Fix stale lines in files you own. |
| Observability | Where a failure would show up (logs, errors, alerts), when the project runs anywhere. Mark "not applicable" for a local-only tool. |
| Pending credentials | Every `provider.credentials` name across the plan: is it set where the release needs it? Names only. Never read, print or ask for a value. A missing one blocks the release step that needs it. |
| Tests and build | On the expected branch, tests and build pass (run them and read the output, do not assume). |

A failed item is fixed if it is yours to fix and small, otherwise recorded and put to the user. Fixes made at release time are limited to documentation; anything that touches behaviour goes through `${CLAUDE_SKILL_DIR}/../../references/triage.md`.

## Step 3: Destination of the code

If the project is not a git repo, skip the question: the code stays local, and step 4 passes `--commit none`.

Otherwise ask once with `AskUserQuestion`, in the user's language, recommended option first:

- **Keep local.** Nothing leaves the machine. Recommended when there is no remote or the user did not say otherwise.
- **Merge.** Merge the work branch into the base branch locally.
- **Push and open a PR.** Pushes and opens a pull request.

If the skill `superpowers:finishing-a-development-branch` is available, invoke it through the Skill tool and follow its protocol for the chosen destination. If not, follow the plain steps: confirm tests pass, confirm the branch and base, do the action, confirm the result with the command output.

Anything that publishes outside this machine (push, a PR, a tag, a deploy, a package publish, a post) is always a question, even when the autopilot is on. Name the exact action and target in the question and wait for a clear yes. A refusal or silence means keep local.

## Step 4: Record the release

1. The commit. In a git repo, run `git rev-parse HEAD` as a call of its own and paste the SHA it prints as a literal in the next command; never use command substitution (the Bash guard refuses it). Use the real SHA, never invent one. Not a git repo: there is no SHA, use `none`.
2. Run `driver release add --version <version> --commit <sha>` (`--commit none` outside a git repo). `--blocks B-001,B-002` is optional; without it the CLI records every block that is `done`. Release is recorded after the destination action succeeded, not before.
3. `block.set` on the release block: `addArtifacts` `.claude/driver/release/checklist.md`.
4. Fill `## Handoff` with `mcp__driver__block_doc`: version, commit, destination chosen and result, rollback note, anything the user must do by hand.
5. `set_block_state` to `in_review`, set the verification (conventions, section 2), `set_block_state` to `done`. The evidence is the checklist and the command output of step 3.

## Step 5: Close with the backlog

Call `mcp__driver__backlog` with no items.

- Pending items: the next step is `/driver:discover amend`, which reads the backlog (`mcp__driver__backlog`) and offers its entries as the starting topics. List them in the final message.
- Empty: the cycle is closed. Say so.

## Final message

In the user's language, as the last thing in the turn with no tool call after it: version and commit, where the code went, the rollback note in one line, what the user still has to do by hand (if anything), and the next step, always: `/driver:discover amend` when there is a backlog; with an empty backlog, say the cycle is closed and nothing is left to press, and that a new cycle starts with `/driver:discover amend`. End the turn.

## Red flags

| Thought | Reality |
|---|---|
| "The user wants it live, I will push." | Publishing outside the machine is always a question, autopilot or not. |
| "I will approve the gate so the release can start." | Only the user approves. Say what to press and end the turn. |
| "Tests passed earlier, no need to run them again." | Run, read the output, then claim. Evidence before assertion. |
| "I will use `--force` to get past the refusal." | Never. Read why it refused and fix the cause. |
| "The API key is missing, I will ask the user to paste it." | Never ask for a value. Name the variable and where it must be set. |
| "I will invent a commit SHA, it is only a record." | Use `git rev-parse HEAD`. The record must be true. |
| "Rollback is obvious, skip it." | Write it down. If it cannot be undone, ask. |
| "I will record the release before pushing, to save a step." | Record after the destination action succeeded. |
| "I will edit the release block doc with Edit." | Block docs are written only with `mcp__driver__block_doc`. |
