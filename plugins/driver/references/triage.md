# Triage of changes after the route gate

Shared by the Implement, Validate and Evolve skills. Read `driver-conventions.md` first; this file does not repeat it.

Once the route gate is approved, the plan the user signed is the baseline. Anything that would change it goes through this triage **before** you touch the plan: a failed check, a request from the user, something you noticed while building. No level restarts the cycle on its own, and none needs a new baseline to keep working.

## 1. Classify

Ask the questions in order and stop at the first yes.

| # | Question | Level |
|---|----------|-------|
| a | Does it add or change a requirement, touch a non-goal, fall in the always-ask list (spending money, payment data, health, identity-document or minors data, deleting for good, a legal commitment, publishing outside this machine), or make a `done` block wrong in a way its own acceptance criteria do not describe? | 3, scope change |
| b | Did a block fail an acceptance criterion that is already written in its `blocks/B-nnn.md` or in a linked `requirements/R-nnn.md`? | 1, fix |
| c | Is it new work that serves a requirement already in the plan, without changing what any other block delivers? | 2, adjustment |

If none is a clear yes, treat it as level 3. A wrong level 2 is visible later (the block carries the after-baseline mark and Evolve lists it); a wrong level 1 hides new scope inside an old block, so when a fix needs more than the original criteria asked for, it is not level 1.

## 2. Act

### Level 1, fix

1. Move the block that failed to `needs_rework` with `mcp__driver__set_block_state`. The reason names the evidence: `validate/B-015.md: criterion 3 fails, export drops the last row`. The move is legal from `done` and from `in_review`. A block that is still `in_progress` has not been handed off: it is simply not finished, so keep working on it and skip this step.
2. If a validate block found it, that validate block waits, and it always ends `blocked`. The reason is exactly `waiting on B-nnn` (that wording is what marks it as resumable later), and B-nnn must be one of its dependencies. Do step 1 first, then move the validate block, and add the dependency with `block.set` only once the validate block is `in_progress` (a `done` block is refused a new unfinished dependency). Never leave it in `needs_rework`: Implement would pick it up. The path depends on where it is:
   - `in_progress`: add the dependency if it is missing, then `blocked`.
   - `in_review`: `needs_rework` (reason: the finding), then `in_progress`, then add the dependency if it is missing, then `blocked`.
   - `done`: the same path as `in_review`: `needs_rework` (reason: the finding), `in_progress`, dependency if missing, `blocked`.
3. Do not create a block. Do not ask. Tell the user in one line and go on.

Only the main session triages. A subagent that finds a failure reports it and stops; it never moves a block it does not own.

Rework is ordinary work: `needs_rework` to `in_progress`, fix, verify again from scratch (the old verification is cleared), hand off, `done`. Then resume whatever waited on it.

### Level 2, adjustment

1. One batch with `mcp__driver__plan_ops`: `decision.add` saying what and why, then `block.add` for the new work, linked to the requirement it serves and depending on the blocks it builds on.
   New work must be validated too. Pick the validate block that covers the same requirement:
   - not `done` yet: add the new block to its `dependsOn` with `block.set`. The link alone does not hold back a validate block that is `in_progress` (`in_progress` to `in_review` or `done` does not check dependencies): if it is `in_progress`, also move it to `blocked` with reason `waiting on <new id>`. If it is `in_review`, take the path of level 1 (`needs_rework`, `in_progress`, `blocked`).
   - already `done`: never give a `done` block a new dependency. Add a new validate block in the same batch (`block.add`, phase validate, depending on the new work).
2. Fill the block document with `mcp__driver__block_doc` (spec and acceptance criteria) before starting it.
3. Tell the user in one line: `Added B-024 (compact calculator) for R-006; it shows as added after the baseline.` Do not ask. Go on.

### Level 3, scope change

Do not change the plan yet. Assess, then ask.

1. **Impact.** Which requirements and blocks it touches, which `done` blocks would need rework, a size estimate in blocks, and what it does to the release.
2. **Ask once** with `AskUserQuestion`, the recommended exit first:
   - **This cycle.** Recommended when it is small and makes no `done` block wrong. Then: `req.add` (or the change), `decision.add`, the new blocks, as in level 2. A new requirement gets its document filled in the same step with `mcp__driver__req_doc` (statement and acceptance signal).
   - **Next cycle.** Recommended when the release should not wait. Record it with `mcp__driver__backlog` and a `decision.add`; the plan does not change.
   - **Re-plan now.** Only when the shape of the plan changes (several blocks, new dependencies, a requirement replaced). Invoke the `driver:route` skill in replan mode.
3. An item from the always-ask list is always a question, whatever else is on.

## 3. Say what happens next

The reply that reports a triage ends with the two ways to go on, in the user's language:

- one item at a time, asking as you go, or
- keep going alone until it is done: the Autopilot button in the DRIVER pane, or `/driver auto on`.

## 4. With the autopilot on

- Levels 1 and 2: decide and act as above, no question.
- Level 3: take the recommended exit and record it with `decision.add`, title starting `Autopilot:`, so Evolve can show it to the user. Prefer **next cycle** when in doubt: it changes nothing that was approved. The autopilot never takes **re-plan now**, because Route asks the user: when that is the recommended exit, take **next cycle** and record it.
- The always-ask list is never decided by the autopilot. Mark the block `blocked` with the reason and move to another one; with nothing else to do, stop and say what is needed.

## 5. What triage never does

- It never rebaselines and never approves a gate. A new baseline is confirmed by the user, and Evolve is where it is suggested.
- It never edits a `done` block in place. `done` leaves only through `needs_rework`.
- It never retires a block that is `in_progress`.
- It never turns several findings into one vague block. One finding, one decision.

## Red flags

| Thought | Reality |
|---------|---------|
| "The fix is bigger than the criterion, but it is the same screen." | Same screen is not the same criterion. That is level 2 or 3. |
| "I will add a block for the failed check, it is cleaner." | A failed existing criterion is rework on the block that owns it. |
| "The user asked for it, so it is in scope." | The user asking makes it wanted, not planned. Classify it. |
| "It is small, I will fold it into the block I am on." | Then nothing records that the plan grew. Level 2 costs one batch. |
| "This needs a new baseline before I continue." | It does not. Work goes on; Evolve suggests the baseline. |
| "The autopilot is on, so I can decide the payment provider." | Never. That list is the user's, always. |
