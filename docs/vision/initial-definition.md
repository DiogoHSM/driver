# Initial Project Definition (original document, 2026-10-26)

> Source document, written before the decision to become a plugin (see `.claude/docs/DECISIONS.md`, ADR-001). Kept as a historical record. Parts superseded by ADRs are marked.

Name (candidates): Sixfold · Loopcraft · AnyForge
Status: Initial definition, pre-automation
Method: DRIVER: Discover · Route · Implement · Validate · Evolve · Release

---

## 1. Vision

An AI tool that generalizes the execution of any project by applying a structured, traceable and iterative process. The same harness should deliver anything from a financial spreadsheet or a slide deck to a complex system with authentication, database, workers, backend, frontend and mobile app.

The tool is not a chat. It is a process orchestrator: it interviews, plans, builds, validates, evolves and publishes, with state visible in every phase and the ability to return to any earlier phase at any moment.

*(Superseded by ADR-001: DRIVER is a Claude Code plugin, not a standalone tool.)*

## 2. Central principle

The diagram is the nervous system of the project. It is not a disposable slide. It is a living artifact that:

- shows the phases and blocks in a visual flow;
- follows all the later phases;
- displays order, status, outputs and dependencies;
- indicates "you are here";
- shows loop-back arrows (Validate → Implement, Evolve → Route, etc.);
- is clickable: each block opens details, artifacts, dependencies and status;
- is exportable as project documentation.

*(Refined by ADR-002: the artifact is the graph; the diagram is rendering.)*

## 3. The DRIVER method

| Letter | Phase | Essence |
|---|---|---|
| D | Discover | Understand |
| R | Route | Plan |
| I | Implement | Build/execute |
| V | Validate | Verify/test |
| E | Evolve | Iterate/refine |
| R | Release | Publish/expose |

The Evolve → Implement and Evolve → Route cycle can happen as many times as needed before Release.

## 4. Phases

### 4.1 Discover
Purpose: understand the problem, the context and the requirements.

Activities:
- Structured interview in a form, with at least 3 rounds of questions: (1) context and breadth; (2) specific requirements and constraints; (3) confirmation + explicit non-goals. *(See ADR-008 on proportionality.)*
- The interview can be long. There is no duration limit.
- A "don't know" option on any question, which triggers a suggestion or research instead of blocking the interview.
- The tool can draw diagrams or assemble quick visual prototypes to help the user decide requirements.
- Assumptions log: everything the tool assumed when the user did not specify. It becomes a contract and avoids rework.

Artifacts: interview form (versioned), assumptions log, list of non-goals, visual prototypes attached as versioned requirements, auxiliary diagrams.

Exit criterion: critical questions answered + assumptions accepted.
Human gate: explicit approval before advancing to Route.

### 4.2 Route
Purpose: plan the full path, visual and verifiable.

Activities:
- Always present a flow/process diagram.
- Break the phases into blocks in a visual flow. Each block contains: input, output, acceptance criterion, dependencies, risk.
- Plan versioning (plan v1, v2…). Changes after approval generate a visible diff.
- Definition of done per block and per phase.

Artifacts: flow diagram (living artifact), versioned plan, acceptance criteria per block, risk matrix.

Exit criterion: plan approved with the diagram validated.
Human gate: explicit approval before advancing to Implement. *(Revised in section 5: only two mandatory gates.)*

### 4.3 Implement
Purpose: build/execute what was planned.

Activities:
- Execute block by block, keeping traceability with the plan and with Discover.
- If it makes sense, assemble a design system or visual prototype as part of the implementation.
- Incremental checkpoints to allow rollback.
- Environment parity (dev / staging / prod) from the start, when applicable.
- The diagram is updated in real time: each block changes state as it advances.

Artifacts: implementation per block, design system / visual prototype (when applicable), rollback checkpoints, environment configuration.

Exit criterion: blocks implemented with traceable state.
Allowed loop: go back to Route or Discover if the implementation reveals that the plan or the understanding is wrong.

### 4.4 Validate
Purpose: verify whether what was built meets what was understood and planned.

Activities:
- Tests in layers: unit, integration, e2e, visual, performance, security (adapted to the project type).
- Acceptance test against the original Discover requirements, not only against the plan.
- The diagram shows test status per block.

Artifacts: test reports per layer, validation status per block, evidence (logs, screenshots, results).

Exit criterion: blocks validated or a clear identification of what needs to evolve.
Allowed loop: direct return to Implement or Route.

### 4.5 Evolve
Purpose: iterate and refine before exposing.

Activities:
- Decision log: why did it go back? What changed?
- Impact analysis: if it goes back to Route, which downstream blocks are affected?
- Re-baseline: update plan + diagram after the evolution.
- It can return to Implement (local adjustment) or Route (structural change). As many times as needed.

Artifacts: decision log, impact analysis, re-baselined plan and diagram.

Exit criterion: project ready for Release.
Human gate: explicit approval before advancing to Release.

### 4.6 Release
Purpose: publish/expose.

Activities: release checklist, rollback plan, observability configured, documentation and handoff.

Artifacts: release record, rollback plan, documentation, observability dashboard.

Exit criterion: project published and monitored.

## 5. Human gates

| Gate | Transition | Reason |
|---|---|---|
| Gate 1 | Discover → Route | The cost of getting the understanding wrong is high |
| Gate 2 | Evolve → Release | The cost of exposing something immature is high |

The rest can be automatic.

## 6. State machine per block

Not started · In progress · Blocked (with visible reason) · In review · Done · Needs rework. The diagram is the live view of that state.

## 7. Traceability

```
Requirement (Discover) → Plan block (Route) → Implementation (Implement)
                       → Test (Validate) → Release (Release)
```

## 8. Cross-cutting concerns

Context memory across phases · parallelism visible in the diagram · blockers visible with a reason · multi-project dashboard · persistent assumptions and decisions log · versioning of plan, requirements and artifacts.

## 9. Generalization by domain

*(Superseded by ADR-005: core + packs `driver-web`, `driver-mobile`, `driver-finance`, `driver-social`, `driver-video`.)*

Original examples: complex system (web + mobile), financial spreadsheet, slide deck, generic automation/process.

## 10. Automation model (future vision)

1. Interview the user and adapt the questions to the domain.
2. Generate the diagram automatically from Discover.
3. Plan blocks with inputs, outputs, criteria and dependencies.
4. Execute each block with traceability.
5. Validate with tests appropriate to the domain.
6. Iterate with a decision log and impact analysis.
7. Publish with a checklist, rollback and observability.

## 11. Open questions (with answers from the 2026-10-26 evaluation)

- Identify the domain in the first iteration: direct question or classification of the first free answer. Not worth engineering.
- Minimum level of detail per block for reliable automation: open, depends on the graph format.
- "Well evaluated" in Evolve: every Discover requirement has a passing test or was explicitly withdrawn with a recorded decision.
- Hundreds of blocks: hierarchy phase → epic → block, collapsible (ADR-002).
- Versioning of artifacts across phases: open.
- Prioritization in the multi-project dashboard: blocked blocks and pending gates first.

## 12. Candidate names

Sixfold · Loopcraft · AnyForge. Warnings: "Sixfold" is already a brand in logistics; "DRIVER" is generic for search, but works as the name of the method. Decision open.
