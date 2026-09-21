# AWSF v2 W17 — `shift`: build prompts

> **Plan:** [`awsf-v2-w17-shift.html`](awsf-v2-w17-shift.html) · **Spine:** [`awsf-v2-plan.html`](awsf-v2-plan.html) § Milestone M17 → W17
> **Tickets:** [`tickets/awsf-v2-w17-shift/`](tickets/awsf-v2-w17-shift/) — one addressable file per task, each carrying the same prompt this file's Section B holds.

This file exists because this repository's invariant-12 fence requires it: `core/test/unit/meta/ticket-plan-sync.test.ts` asserts a `<stem>-build-prompts.md` exists for every plan source with a ticket set, and that each ticket's prompt is **byte-identical** to its `### Tnn — ` block below. Both artifacts are generated from one source string, so they cannot drift.

# Section A — Conventions

**Read first, on every task.** `AGENTS.md` in full · `specs/awsf-v2-w17-shift.html` (Purpose, Problem, Solution and Identifier Spine in full, then the task's own section) · `specs/tickets/awsf-v2-w17-shift/README.md`.

**The baseline rule.** Run `npm run test:unit` at the **exact base SHA your task starts from**, before changing anything, and record the count. A red baseline blocks a correct build, and neither `doctor` nor `lint` catches one.

**Marker discipline — both files, always.** Flip **this leaf plan's** own markers on **every** task: task *n*'s checklist boxes in `specs/awsf-v2-w17-shift.html`, plus the milestone header on a milestone's last task. Flip this ticket's `state:` in the same commit. Do **not** touch `specs/awsf-v2-plan.html`'s Milestone M17 / W17 marker — **only T18 does that**.

**Two ordering gates.**
- **G17** — `awsf.config.yaml`'s `workflows.enabled` gains `shift` as an **owner-authored commit before T05 builds**. No agent can write that file; `path-policy` rejects `protected-path` independently of the write globs.
- **G17-M** — `main` and `task3.5` are **merged before T11 starts**. M4, M5 and M6 live inside `production-run.ts`, which is +547/−98 on `main` against +96/−17 on `task3.5` from merge-base `8268258`, one of seventeen conflicted files.

**The never-do list**, stated once with why each is tempting:
- **Do not launch a run per ticket.** `task-machine.ts:115` makes `L20` `actors: ["human"], interactive: true`, the only route into `LANDED`, with no tier exemption. Nine attempts halt on ticket 1.
- **Do not register a placeholder `shift` recipe in `WORKFLOW_RECIPES`.** One line satisfies the module-load assertion and makes `minimumCallsFor` report a fiction for every real shift.
- **Do not relax `reviewBuildPhaseId` to "at least one".** It admits a shift whose builders run on different routes — the ambiguous inversion the rule exists to refuse.
- **Do not reach for `rework` as automatic recovery.** Every rework phase is `maxCorrections: 0`, and that path *rejects* credential-shaped provider output where a normal run scrubs it.
- **Do not let a shift raise its own ceiling.** `awsf raise` requires an interactive terminal by design; a run that can widen itself is not bounded by a checkpoint.
- **Do not hard-code a browser preview step.** `PROJECT_DELIVERY_POSTURES` already declares the answer; a browser in the judgment layer bakes this repository's shape into every project.
- **Do not add an exemption to the invariant-8 meta-tests.** If a write cannot pass them as written, the write is the wrong shape.
- **Never** put an agent, model, or AI tool in a commit identity, message, or trailers.

# Section B — Task prompts (recommended)


### T01 — The shift manifest contract and the plan-ticket body reader

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     two new pure modules, but the digest choice decides whether every later resume works

TASK 1 of 18. Plan: specs/awsf-v2-w17-shift.html, milestone M1.
PREDECESSORS: none. This is the first task.

READ FIRST
  AGENTS.md - the twelve invariants, IN FULL
  specs/awsf-v2-w17-shift.html - the plan. Purpose, Problem, Solution and Identifier Spine IN FULL,
    then this task's own section
  specs/tickets/awsf-v2-w17-shift/README.md - Conventions, gates, never-do list
  core/src/persistence/plan-tickets.ts - IN FULL. `ticketData` parses frontmatter and
    STOPS; nothing in core/src has ever read a ticket body. Note its fingerprint cache
  core/src/contracts/ticket.ts and core/src/contracts/registry.ts - how a TypeBox contract
    is declared and registered. Copy that shape exactly; do not hand-write a JSON Schema
  core/test/unit/meta/ticket-plan-sync.test.ts :113-137 - the EXACT split the fence uses
    to find a ticket's prompt. Your reader must use the same split or the two will disagree

DO
  Create core/src/contracts/shift-manifest.ts declaring ShiftManifestSchema with $id
    "awsf.shift-manifest/v1": plan, milestones (ordered array of milestone ids, minItems 1,
    in the owner's selection order), tickets (ordered array of {id, path, digest, tier?,
    workflow?}), manifestDigest. Register it in contracts/registry.ts.
  A shift selects ONE OR MORE milestones. `milestones` is a list even when it holds one -
    there is no singular form and no one-milestone special case.
  Create core/src/persistence/plan-ticket-body.ts. It extracts the single "## Build prompt"
    fenced block from a plan-ticket file and refuses a file with zero or more than one.
  Digest the WHOLE ticket file's bytes, not the prompt block. An appended ## Handoff entry
    must change the digest - that is the point: the resume has to notice it.
  Write down IN THE FILE why the digest covers the whole file rather than the prompt.

DO NOT
  Do NOT edit core/src/persistence/plan-tickets.ts. Its cache and its exported shape stay
    byte-unchanged, and a test asserts that. Widening it is the tempting convenience here.
  Do NOT invent a second definition of where a prompt begins. Reuse the fence's split.

DONE WHEN
  npx tsx --test core/test/unit/shift-manifest.test.ts - the manifest round-trips through
    TypeBox validation, and a one-byte change to any ticket file changes manifestDigest
  npx tsx --test core/test/unit/plan-ticket-body.test.ts - zero-block and two-block files
    are both refused by name; a real ticket in specs/tickets/ parses
  npm run test:unit - green. RECORD THE BASELINE COUNT FIRST, at the exact base SHA
  npm run typecheck and npm run lint - exit 0

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative
    rejected, and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (shift, compiler, budget, ref,
    readout, adopt) - never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in
  the body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS leaf plan's own markers in specs/awsf-v2-w17-shift.html: task 1's checklist boxes
  from [] to [x] (or [f] with the reason in the commit body). The leaf markers are
  flipped on EVERY task, including this one.
  Flip this ticket's `state:` to done (or failed) in the same commit.
  Do NOT touch specs/awsf-v2-plan.html's Milestone M17 / W17 marker - only T18 does that.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append
  to their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt: the prompt is the authored record, the Handoff is the correction layer.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T02 — Milestone selection and its refusals

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     the refusals are the whole value: a selection that silently drops a ticket spends a
          night on the wrong work

TASK 2 of 18. Plan: specs/awsf-v2-w17-shift.html, milestone M1.
PREDECESSORS: T01 are [x]

READ FIRST
  AGENTS.md - the twelve invariants, IN FULL
  specs/awsf-v2-w17-shift.html - the plan. Purpose, Problem, Solution and Identifier Spine IN FULL,
    then this task's own section
  specs/tickets/awsf-v2-w17-shift/README.md - Conventions, gates, never-do list
  core/src/backlog.ts - the `ready` computation and PlanBacklogTicket. You are not
    replacing it; you are selecting a milestone out of the same records
  core/src/cli/commands/new.ts and core/src/cli/commands/workflows.ts - how tier is
    DERIVED rather than taken on trust. Mirror that discipline
  core/src/contracts/ticket.ts - TICKET_WORKFLOWS. It must NOT gain "shift"

DO
  Create core/src/workflow/shift/select.ts with selectShiftTickets(plan, milestones, records).
  `milestones` is an ORDERED LIST of one or more milestone ids. One milestone is the common
    case, not a special case - there is no singular overload.
  Return the selected milestones' tickets in ONE topological order over depends_on across
    the whole selection, tie-broken by the milestone's position in the list and then by
    ticket id, so the order is deterministic and reproducible.
  Select only state: todo. REFUSE BY NAME a SELECTED milestone holding a wip or failed
    ticket - do not skip it. A half-done milestone is the owner's decision, not the
    expander's.
  Refuse: a depends_on edge leaving THE SELECTION whose target is not done; a cycle; an
    empty expansion; a repeated milestone id; a named milestone holding no tickets at all.
    Each gets its own named error class.
  An edge from one selected milestone INTO ANOTHER is not a refusal - it is inside the
    selection, and honouring it is what the single topological order is for.
  Derive the shift's tier as the maximum of the selected tickets' declared tiers, across
    every selected milestone.
  Add a meta-test asserting no ticket anywhere declares workflow: shift and that
    TICKET_WORKFLOWS does not contain it.

DO NOT
  Do NOT widen TICKET_WORKFLOWS. A ticket names its own route; the shift is the container.
  Do NOT parse ticket ids for a naming convention. Compare them literally, the way
    dashboard/src/session-stacks.ts already does.
  Do NOT require the selected milestones to be contiguous. M1,M3 with M2 skipped is
    legitimate when M3 does not depend on M2; when it does, the leaving-the-selection
    check already refuses it. A contiguity rule would refuse a correct selection.

DONE WHEN
  npx tsx --test core/test/unit/shift-select.test.ts - every refusal fires on its own
    fixture directory, and the accepted case returns the exact expected order
  The same test covers a THREE-MILESTONE selection: one topological order across all three,
    a cross-milestone depends_on edge honoured rather than refused, and a non-contiguous
    M1,M3 selection accepted when M3 is independent of M2
  npm run test:unit, npm run typecheck, npm run lint - green, count recorded

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative
    rejected, and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (shift, compiler, budget, ref,
    readout, adopt) - never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in
  the body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS leaf plan's own markers in specs/awsf-v2-w17-shift.html: task 2's checklist boxes
  from [] to [x] (or [f] with the reason in the commit body). The leaf markers are
  flipped on EVERY task, including this one.
  Flip this ticket's `state:` to done (or failed) in the same commit.
  Do NOT touch specs/awsf-v2-plan.html's Milestone M17 / W17 marker - only T18 does that.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append
  to their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt: the prompt is the authored record, the Handoff is the correction layer.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T03 — Testing strategy for M1 - selection and manifest

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  WHY     fixture construction and coverage over code two prior tasks already shaped

TASK 3 of 18. Plan: specs/awsf-v2-w17-shift.html, milestone M1.
PREDECESSORS: T01, T02 are [x]

READ FIRST
  AGENTS.md - the twelve invariants, IN FULL
  specs/awsf-v2-w17-shift.html - the plan. Purpose, Problem, Solution and Identifier Spine IN FULL,
    then this task's own section
  specs/tickets/awsf-v2-w17-shift/README.md - Conventions, gates, never-do list
  core/test/fixtures/ - how fixture trees are laid out and scrubbed in this repository
  specs/awsf-v2-w17-shift.html - milestone M1's Testing Strategy task IN FULL

DO
  Build the fixture ticket directories M1's tests need, under core/test/fixtures/.
  Close every M1 checklist row that is not yet green.
  Assert plan-tickets.ts's exported shape is byte-identical to its pre-T01 state.
  Prove the digest property in both directions: identical bytes give an identical
    manifestDigest across two processes, and one changed byte does not.

DO NOT
  Do NOT quote any run id, session id, task id or machine path into a fixture - AGENTS.md
    invariant 1. Scrub before committing.

DONE WHEN
  npx tsx --test core/test/unit/shift-select.test.ts and shift-manifest.test.ts - green
  npm run test:unit, npm run typecheck, npm run lint - green, counts recorded
  npm test - full suite in one invocation, git status --porcelain clean afterwards

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative
    rejected, and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (shift, compiler, budget, ref,
    readout, adopt) - never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in
  the body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS leaf plan's own markers in specs/awsf-v2-w17-shift.html: task 3's checklist boxes
  from [] to [x] (or [f] with the reason in the commit body). The leaf markers are
  flipped on EVERY task, including this one.
  Flip this ticket's `state:` to done (or failed) in the same commit.
  Do NOT touch specs/awsf-v2-plan.html's Milestone M17 / W17 marker - only T18 does that.
  This is the LAST task of milestone M1: flip that milestone's <h3> header to [x]
  and every remaining checklist box in it.
  THEN append an Amendment to specs/awsf-v2-w17-shift.html recording the CLOSE of M1:
    - what the milestone accomplished, in terms of what is now observably true
    - every task in it and its final state, naming any [f] row and the block that holds it
    - the friction it hit: what took longer than the plan expected, what the plan got
      wrong, what a later milestone must now do differently because of it
    - the decisions made inside the milestone that the plan did not already carry
    - the landing commit SHA(s) and the suite counts at close
  Append the modified date and the agent/session ids to the metadata header in the
  same commit.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append
  to their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt: the prompt is the authored record, the Handoff is the correction layer.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T04 — compileShift - the ticket-phase group and the review tail

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     this is the mechanism the whole workstream exists for, and it must be a pure function
          of recorded bytes or every resume breaks

TASK 4 of 18. Plan: specs/awsf-v2-w17-shift.html, milestone M2.
PREDECESSORS: T01, T02 are [x]

READ FIRST
  AGENTS.md - the twelve invariants, IN FULL
  specs/awsf-v2-w17-shift.html - the plan. Purpose, Problem, Solution and Identifier Spine IN FULL,
    then this task's own section
  specs/tickets/awsf-v2-w17-shift/README.md - Conventions, gates, never-do list
  core/src/workflow/compiler.ts - IN FULL. compileWorkflow at :153, compilePhase,
    assertEarnedDescription, and reviewBuildPhaseId at :135 which you will hit
  core/src/workflow/recipes/build-review.ts and simple-sdlc.ts - the exact PhaseDefinition
    shape to generate, including gates: [] and the schemaId/outputSchema pairing rule
  core/src/workflow/phase-recovery.ts :143 - reducePhaseContext keys by envelope.schema
    and LAST WINS. That is the sequential semantic a shift needs; assert it, do not assume
  core/src/workflow/recipe-support.ts - requireHostExecution and loadUserPrompt

DO
  Create core/src/workflow/shift/compile.ts exporting compileShift(manifest, bodies, config).
  Per ticket emit three phases in order: t<NN>-brief (engineer, awsf.plan-output/v1, host),
    t<NN>-build (agent, owner builder, awsf.build-output/v1, maxCorrections 1),
    t<NN>-tests (code, owner host, awsf.test-output/v1).
  Then ONCE at the end: shift-review-context (code, awsf.review-context/v1) and
    shift-review (agent, owner reviewer, awsf.review-output/v1).
  The brief phase carries the ticket's ## Build prompt block VERBATIM as the segment's
    intent, plus its ## Handoff section, which reads AFTER the prompt and corrects it.
  Assert minimumCalls === tickets.length + 1 directly.
  Generated descriptions must carry the ticket's TITLE - assertEarnedDescription refuses a
    description that normalises to its own phase id.
  Read no file, no clock and no provider. The caller supplies the bytes.

DO NOT
  Do NOT call a model to summarise a ticket. The owner wrote the prompt and it was
    reviewed; a paraphrase costs a call to lose fidelity.
  Do NOT register anything in WORKFLOW_RECIPES. That is T05's decision and it is not
    a registration.

DONE WHEN
  npx tsx --test core/test/unit/shift-compile.test.ts - phase shape, ordering,
    minimumCalls === N + 1, earned descriptions, and the previous_envelope chain from
    ticket n-1's build envelope into ticket n's builder
  The same manifest and bytes compile to a byte-identical recipe twice, in the same
    process and in a fresh one
  npm run test:unit, npm run typecheck, npm run lint - green, counts recorded

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative
    rejected, and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (shift, compiler, budget, ref,
    readout, adopt) - never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in
  the body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS leaf plan's own markers in specs/awsf-v2-w17-shift.html: task 4's checklist boxes
  from [] to [x] (or [f] with the reason in the commit body). The leaf markers are
  flipped on EVERY task, including this one.
  Flip this ticket's `state:` to done (or failed) in the same commit.
  Do NOT touch specs/awsf-v2-plan.html's Milestone M17 / W17 marker - only T18 does that.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append
  to their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt: the prompt is the authored record, the Handoff is the correction layer.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T05 — The compiled-workflow vocabulary, split from the shipped catalogue

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     a module-load assertion welds the id vocabulary to the recipe registry; getting the
          split wrong crashes the CLI at import rather than failing a test

TASK 5 of 18. Plan: specs/awsf-v2-w17-shift.html, milestone M2.
PREDECESSORS: T04 are [x]

READ FIRST
  AGENTS.md - the twelve invariants, IN FULL
  specs/awsf-v2-w17-shift.html - the plan. Purpose, Problem, Solution and Identifier Spine IN FULL,
    then this task's own section
  specs/tickets/awsf-v2-w17-shift/README.md - Conventions, gates, never-do list
  core/src/workflow/catalog.ts - IN FULL. The assertion at :29-33 throws at MODULE LOAD
    if WORKFLOW_IDS and WORKFLOW_RECIPES disagree. Adding "shift" to the id list without
    a static recipe crashes every command
  core/src/config/workflow-ids.ts and core/src/config/load.ts - KNOWN_WORKFLOW_IDS and
    where membership is actually checked
  core/src/cli/commands/start.ts :58 and :142, core/src/workflow/candidate-seed.ts :102
    and :121, core/src/cli/commands/workflows.ts - every workflowRecipe() caller

DO
  Create core/src/workflow/compiled-ids.ts with COMPILED_WORKFLOW_IDS = ["shift"].
  Leave catalog.ts's existing assertion text and meaning UNCHANGED for shipped recipes.
    Add a SECOND assertion: every compiled id has a compiler and appears in no shipped recipe.
  Teach config/load.ts to admit workflows.enabled members from either vocabulary, and to
    REFUSE a compiled id as project.default_workflow. A shift is always an explicit act.
  Give every workflowRecipe() caller a compiled path rather than a null and a message
    about an unknown recipe.
  awsf workflows lists compiled ids in their own section and says a shift's phase count is
    selection-dependent rather than printing a number that would be wrong.

DO NOT
  Do NOT register a placeholder shift recipe in WORKFLOW_RECIPES to satisfy the assertion.
    It is one line and it makes minimumCallsFor and correctionsFundableFor report a fiction.
  Do NOT edit core/src/config/workflow-ids.ts before the main/task3.5 merge if you can
    avoid it - task3.5 already adds AGENT_PHASE_IDS there. If you must, say so in HANDOFF.

DONE WHEN
  GATE G17: awsf.config.yaml's workflows.enabled has gained `shift` as an OWNER-AUTHORED
    commit BEFORE this task builds. No agent can write that file - path-policy rejects
    protected-path independently of the write globs. If it has not landed, STOP and say so
  npx tsx --test core/test/unit/shift-catalog.test.ts - every shipped recipe still resolves
    unchanged; a compiled id is refused as default_workflow
  Adding a compiled id to WORKFLOW_RECIPES makes the new assertion go red - PROVEN by
    inducing it and watching it fail, then reverting
  npm run test:unit, npm run typecheck, npm run lint - green, counts recorded

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative
    rejected, and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (shift, compiler, budget, ref,
    readout, adopt) - never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in
  the body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS leaf plan's own markers in specs/awsf-v2-w17-shift.html: task 5's checklist boxes
  from [] to [x] (or [f] with the reason in the commit body). The leaf markers are
  flipped on EVERY task, including this one.
  Flip this ticket's `state:` to done (or failed) in the same commit.
  Do NOT touch specs/awsf-v2-plan.html's Milestone M17 / W17 marker - only T18 does that.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append
  to their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt: the prompt is the authored record, the Handoff is the correction layer.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T06 — Review inversion for a workflow with many builders

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT xhigh
  CLAUDE  claude:opus · /effort xhigh
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     amending a compile-time invariant that guards a cross-provider guarantee; the tempting
          relaxation lets a genuinely ambiguous inversion through

TASK 6 of 18. Plan: specs/awsf-v2-w17-shift.html, milestone M2.
PREDECESSORS: T04 are [x]

READ FIRST
  AGENTS.md - the twelve invariants, IN FULL
  specs/awsf-v2-w17-shift.html - the plan. Purpose, Problem, Solution and Identifier Spine IN FULL,
    then this task's own section
  specs/tickets/awsf-v2-w17-shift/README.md - Conventions, gates, never-do list
  core/src/workflow/compiler.ts :120-142 - reviewBuildPhaseId and
    InvalidReviewBuildProducerCount, and note it is called from compileWorkflowStructure,
    so it fires on the RECOVERY path too
  core/src/cli/commands/production-run.ts :1143-1167 - what the single build phase is
    actually USED for: providerFor(buildPhaseId), then oppositeProvider against the pair
  core/src/workflow/review-routing.ts - providerPairFrom refuses anything but exactly two
    distinct providers. READ THE POST-MERGE VERSION: task3.5 adds ReviewRouteMode and a
    "same-provider-degraded" mode, and this task must state what a shift does under it

DO
  Give CompiledWorkflow a reviewBuildPhaseIds: readonly string[] beside the existing
    single id. The single id keeps its EXACT current value for every shipped recipe.
  Amend the rule to: the build producers must resolve to exactly ONE DISTINCT PROVIDER.
    That is what was always being checked; the single-phase form was incidental.
  Keep refusing a review workflow with ZERO build producers, same error class, same
    message shape.
  Make production-run.ts resolve workerProvider from the build producers and REFUSE when
    they disagree, naming the disagreeing phases rather than reporting a count.
  Write down in the file why the rule moved, and what it still refuses.

DO NOT
  Do NOT relax the check to "at least one". That admits a shift whose builders run on
    different routes, which is exactly the ambiguous inversion the rule exists to refuse.
  Do NOT change providerPairFrom. N builders on one provider plus one reviewer on the
    other already yields exactly two distinct providers.

DONE WHEN
  npx tsx --test core/test/unit/shift-inversion.test.ts - build producers on two different
    providers are REFUSED by name; zero producers still throws InvalidReviewBuildProducerCount
  Every shipped recipe compiles unchanged, and reviewBuildPhaseId returns the same value
    it returned before for each of them
  npm run test:unit, npm run typecheck, npm run lint - green, counts recorded

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative
    rejected, and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (shift, compiler, budget, ref,
    readout, adopt) - never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in
  the body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS leaf plan's own markers in specs/awsf-v2-w17-shift.html: task 6's checklist boxes
  from [] to [x] (or [f] with the reason in the commit body). The leaf markers are
  flipped on EVERY task, including this one.
  Flip this ticket's `state:` to done (or failed) in the same commit.
  Do NOT touch specs/awsf-v2-plan.html's Milestone M17 / W17 marker - only T18 does that.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append
  to their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt: the prompt is the authored record, the Handoff is the correction layer.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T07 — Testing strategy for M2 - the compiler

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  WHY     closing coverage over three tasks' work, with two negative tests that must be watched
          to fail before they are trusted

TASK 7 of 18. Plan: specs/awsf-v2-w17-shift.html, milestone M2.
PREDECESSORS: T04, T05, T06 are [x]

READ FIRST
  AGENTS.md - the twelve invariants, IN FULL
  specs/awsf-v2-w17-shift.html - the plan. Purpose, Problem, Solution and Identifier Spine IN FULL,
    then this task's own section
  specs/tickets/awsf-v2-w17-shift/README.md - Conventions, gates, never-do list
  specs/awsf-v2-w17-shift.html - milestone M2's Testing Strategy task IN FULL
  core/test/unit/meta/ - how this repository writes a fence that is proven to bite

DO
  Close every M2 checklist row that is not yet green.
  Prove the reproducibility property across a process boundary, not just in one run.
  Prove both amended rules by inducing the violation, watching red, then reverting.

DO NOT
  Do NOT leave any induced violation in the tree. Revert each one in the same session.

DONE WHEN
  npx tsx --test core/test/unit/shift-compile.test.ts, shift-catalog.test.ts and
    shift-inversion.test.ts - all green
  npm run test:unit, npm run typecheck, npm run lint - green, counts recorded
  npm test - full suite in one invocation, git status --porcelain clean afterwards

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative
    rejected, and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (shift, compiler, budget, ref,
    readout, adopt) - never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in
  the body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS leaf plan's own markers in specs/awsf-v2-w17-shift.html: task 7's checklist boxes
  from [] to [x] (or [f] with the reason in the commit body). The leaf markers are
  flipped on EVERY task, including this one.
  Flip this ticket's `state:` to done (or failed) in the same commit.
  Do NOT touch specs/awsf-v2-plan.html's Milestone M17 / W17 marker - only T18 does that.
  This is the LAST task of milestone M2: flip that milestone's <h3> header to [x]
  and every remaining checklist box in it.
  THEN append an Amendment to specs/awsf-v2-w17-shift.html recording the CLOSE of M2:
    - what the milestone accomplished, in terms of what is now observably true
    - every task in it and its final state, naming any [f] row and the block that holds it
    - the friction it hit: what took longer than the plan expected, what the plan got
      wrong, what a later milestone must now do differently because of it
    - the decisions made inside the milestone that the plan did not already carry
    - the landing commit SHA(s) and the suite counts at close
  Append the modified date and the agent/session ids to the metadata header in the
  same commit.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append
  to their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt: the prompt is the authored record, the Handoff is the correction layer.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T08 — Batch admission, refused at zero cost

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  WHY     arithmetic over existing functions, but the readout's wording is what the owner acts on
          at 11pm

TASK 8 of 18. Plan: specs/awsf-v2-w17-shift.html, milestone M3.
PREDECESSORS: T04 are [x]

READ FIRST
  AGENTS.md - the twelve invariants, IN FULL
  specs/awsf-v2-w17-shift.html - the plan. Purpose, Problem, Solution and Identifier Spine IN FULL,
    then this task's own section
  specs/tickets/awsf-v2-w17-shift/README.md - Conventions, gates, never-do list
  core/src/state/tiers.ts - IN FULL. DEFAULT_CALL_CEILINGS at :33, MIN/MAX_CALL_CEILING
    at :46 and :57, ceilingFor at :86, fitsCeiling
  core/src/execution/call-budget.ts - admitWorkflow and what CallCeilingExceeded carries
  core/src/cli/commands/raise.ts - MAX_GRANT_CALLS = 5 per act, and that the act REQUIRES
    an interactive terminal
  core/src/cli/commands/production-run.ts :1608-1614 - coldCorrectionHeadroom is
    max(0, remaining - futureInitialCalls). At ceiling === minimumCalls it is zero everywhere
  specs/awsf-v2-w17-shift.html - milestone M3's ticket-count table IN FULL. It is the test cases

DO
  Create core/src/cli/commands/shift.ts with
    `awsf shift plan <stem> --milestone <Mx>[,<My>,...]`. The flag takes a comma-separated
    list and may also be repeated; both spell the same ordered selection. A range syntax is
    deliberately NOT added - one spelling, not two.
  BEFORE writing anything, print: the ordered ticket ids and titles, minimumCalls = N + 1,
    the attempt's ceiling, the remaining headroom, and - when it does not fit - the exact
    number of awsf raise acts and the calls each must grant.
  State the cold-correction consequence in words: at ceiling === minimumCalls every
    builder's declared maxCorrections: 1 buys nothing, so the shift has no correction round.
  Reuse CallCeilingExceeded for the refusal rather than minting a new class, so the
    dashboard's failure classifier meets a name it already knows.
  DISTINGUISH THE TWO REFUSALS in the message: a selection that needs raise acts, and one
    that no raise can fund because minimumCalls exceeds MAX_CALL_CEILING = 20. With
    multi-milestone selection the second is reachable in ordinary use - 19 tickets is the
    hard maximum for one shift - where with a single milestone it was hypothetical.

DO NOT
  Do NOT spawn, reserve, or write to the ledger from this command. It reads and prints.
  Do NOT invent a shift-scoped ceiling. The ceiling arithmetic is one function over one
    number and a fourth source is how a bound stops being a bound.

DONE WHEN
  npx tsx --test core/test/unit/shift-budget.test.ts - the plan's whole table as cases,
    including N = 31 refused for exceeding MAX_CALL_CEILING rather than a tier
  A meta-test asserts nothing under core/src/workflow/shift/ imports raise.ts
  npm run test:unit, npm run typecheck, npm run lint - green, counts recorded

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative
    rejected, and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (shift, compiler, budget, ref,
    readout, adopt) - never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in
  the body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS leaf plan's own markers in specs/awsf-v2-w17-shift.html: task 8's checklist boxes
  from [] to [x] (or [f] with the reason in the commit body). The leaf markers are
  flipped on EVERY task, including this one.
  Flip this ticket's `state:` to done (or failed) in the same commit.
  Do NOT touch specs/awsf-v2-plan.html's Milestone M17 / W17 marker - only T18 does that.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append
  to their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt: the prompt is the authored record, the Handoff is the correction layer.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T09 — Ceiling exhaustion mid-shift is a checkpoint, not a failure

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     recovery semantics across a durable checkpoint, where getting the resume wrong either
          re-spends a call or strands the run

TASK 9 of 18. Plan: specs/awsf-v2-w17-shift.html, milestone M3.
PREDECESSORS: T08 are [x]

READ FIRST
  AGENTS.md - the twelve invariants, IN FULL
  specs/awsf-v2-w17-shift.html - the plan. Purpose, Problem, Solution and Identifier Spine IN FULL,
    then this task's own section
  specs/tickets/awsf-v2-w17-shift/README.md - Conventions, gates, never-do list
  core/src/workflow/phase-recovery.ts - IN FULL, and how a checkpoint records the prefix
  core/src/cli/commands/production-run.ts - resumeProductionCommand and checkpointAt
  core/src/cli/commands/raise.ts - the interactive-terminal refusal, in full

DO
  Make a shift that reaches its ceiling stop with the accepted prefix durable, exactly as
    any other ceiling stop does, and record the TICKET it stopped before in the checkpoint.
  Make the stop message name the ticket id, not only the phase id. "t14-build" means
    nothing to someone reading it over breakfast.
  Prove that after an owner raise, awsf resume continues from the accepted prefix without
    re-running any completed phase and without re-spending any settled call.

DO NOT
  Do NOT make the shift widen its own ceiling, or call raise.ts, or read a terminal.
    A running shift that can raise itself is not bounded by a checkpoint at all.

DONE WHEN
  npx tsx --test core/test/journeys/shift-ceiling.test.ts - a fixture-adapter shift stops
    at the ceiling, the prefix is durable, and a resume after a granted raise completes
  The ledger's history() shows no call reserved after the stop
  npm run test:unit, npm run typecheck, npm run lint - green, counts recorded

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative
    rejected, and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (shift, compiler, budget, ref,
    readout, adopt) - never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in
  the body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS leaf plan's own markers in specs/awsf-v2-w17-shift.html: task 9's checklist boxes
  from [] to [x] (or [f] with the reason in the commit body). The leaf markers are
  flipped on EVERY task, including this one.
  Flip this ticket's `state:` to done (or failed) in the same commit.
  Do NOT touch specs/awsf-v2-plan.html's Milestone M17 / W17 marker - only T18 does that.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append
  to their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt: the prompt is the authored record, the Handoff is the correction layer.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T10 — Testing strategy for M3 - one ceiling

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  WHY     closing coverage, plus one fence that must be watched to fail

TASK 10 of 18. Plan: specs/awsf-v2-w17-shift.html, milestone M3.
PREDECESSORS: T08, T09 are [x]

READ FIRST
  AGENTS.md - the twelve invariants, IN FULL
  specs/awsf-v2-w17-shift.html - the plan. Purpose, Problem, Solution and Identifier Spine IN FULL,
    then this task's own section
  specs/tickets/awsf-v2-w17-shift/README.md - Conventions, gates, never-do list
  specs/awsf-v2-w17-shift.html - milestone M3's Testing Strategy task IN FULL

DO
  Close every M3 checklist row that is not yet green.
  Add the raise.ts import to a shift module, watch the fence go red, then revert it.

DO NOT
  Do NOT leave the induced import in the tree.

DONE WHEN
  npx tsx --test core/test/unit/shift-budget.test.ts and
    core/test/journeys/shift-ceiling.test.ts - green
  npm run test:unit, npm run typecheck, npm run lint - green, counts recorded
  npm test - full suite in one invocation, git status --porcelain clean afterwards

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative
    rejected, and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (shift, compiler, budget, ref,
    readout, adopt) - never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in
  the body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS leaf plan's own markers in specs/awsf-v2-w17-shift.html: task 10's checklist boxes
  from [] to [x] (or [f] with the reason in the commit body). The leaf markers are
  flipped on EVERY task, including this one.
  Flip this ticket's `state:` to done (or failed) in the same commit.
  Do NOT touch specs/awsf-v2-plan.html's Milestone M17 / W17 marker - only T18 does that.
  This is the LAST task of milestone M3: flip that milestone's <h3> header to [x]
  and every remaining checklist box in it.
  THEN append an Amendment to specs/awsf-v2-w17-shift.html recording the CLOSE of M3:
    - what the milestone accomplished, in terms of what is now observably true
    - every task in it and its final state, naming any [f] row and the block that holds it
    - the friction it hit: what took longer than the plan expected, what the plan got
      wrong, what a later milestone must now do differently because of it
    - the decisions made inside the milestone that the plan did not already carry
    - the landing commit SHA(s) and the suite counts at close
  Append the modified date and the agent/session ids to the metadata header in the
  same commit.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append
  to their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt: the prompt is the authored record, the Handoff is the correction layer.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T11 — A failing ticket blocks the attempt, and the prefix resumes

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     the decision is simple and its proof is not: nothing later may reserve a call, and
          everything earlier must survive

TASK 11 of 18. Plan: specs/awsf-v2-w17-shift.html, milestone M4.
PREDECESSORS: T07 are [x]

READ FIRST
  AGENTS.md - the twelve invariants, IN FULL
  specs/awsf-v2-w17-shift.html - the plan. Purpose, Problem, Solution and Identifier Spine IN FULL,
    then this task's own section
  specs/tickets/awsf-v2-w17-shift/README.md - Conventions, gates, never-do list
  GATE G17-M: main and task3.5 MUST be merged before this task starts. Confirm it and
    STOP if they are not - this milestone lives inside production-run.ts
  core/src/cli/commands/production-run.ts - acceptPhase, checkpointAt, and the BLOCKED path
  core/src/state/errors.ts - the six DETERMINISTIC_REASON_SOURCES and the per-edge
    blocker vocabulary
  core/src/cli/commands/rework.ts - IN FULL, to see why it is NOT the recovery instrument

DO
  Make a red t<NN>-tests phase block the attempt with a reason naming the TICKET ID and
    the failing gate, and record the accepted prefix in the recovery checkpoint.
  Prove no later ticket's phase reserves a call after the block, against the ledger's
    history() rather than against a log line.
  Make awsf resume re-run only the blocked ticket's phases, with the earlier tickets'
    commits still on the worktree head.
  Make an environmental failure distinguishable from a ticket failure in the record: the
    blocker carries one of the six deterministic reason sources, and a `gate` source must
    read differently from a `process` one.
  Add a meta-test asserting no shift module imports rework.ts, and write down why:
    every rework phase is maxCorrections 0, and that path REJECTS credential-shaped
    provider output where a normal run scrubs it.

DO NOT
  Do NOT make the shift skip a failed ticket and continue. Ticket n+1 was selected
    BECAUSE it follows ticket n; building it on a tree the gates rejected produces work
    nobody can review independently.
  Do NOT reach for rework as an automatic recovery. A blocked shift surfaces.

DONE WHEN
  npx tsx --test core/test/journeys/shift-blocked.test.ts - a six-ticket shift with a red
    gate on ticket 3 blocks there, prefix durable, tail unreserved, resume completes
  npm run test:unit, npm run typecheck, npm run lint - green, counts recorded

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative
    rejected, and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (shift, compiler, budget, ref,
    readout, adopt) - never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in
  the body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS leaf plan's own markers in specs/awsf-v2-w17-shift.html: task 11's checklist boxes
  from [] to [x] (or [f] with the reason in the commit body). The leaf markers are
  flipped on EVERY task, including this one.
  Flip this ticket's `state:` to done (or failed) in the same commit.
  Do NOT touch specs/awsf-v2-plan.html's Milestone M17 / W17 marker - only T18 does that.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append
  to their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt: the prompt is the authored record, the Handoff is the correction layer.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T12 — The ref at seal time, and the per-ticket candidate record

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     it is small and it is the piece everything else's safety rests on; it also sits beside
          invariant 8's source scans, which must stay green without an exemption

TASK 12 of 18. Plan: specs/awsf-v2-w17-shift.html, milestone M4.
PREDECESSORS: T07 are [x]

READ FIRST
  AGENTS.md - the twelve invariants, IN FULL
  specs/awsf-v2-w17-shift.html - the plan. Purpose, Problem, Solution and Identifier Spine IN FULL,
    then this task's own section
  specs/tickets/awsf-v2-w17-shift/README.md - Conventions, gates, never-do list
  GATE G17-M: main and task3.5 MUST be merged before this task starts. Confirm and STOP
    if not - seal time is inside production-run.ts, the most diverged file in the pair
  core/src/git/worktrees.ts :255-269 - createWorktree runs `git worktree add --detach`.
    That is why every candidate this factory has produced is a dangling commit
  core/test/unit/meta/no-destructive-paths.test.ts and no-land-route.test.ts - the two
    source scans invariant 8 rests on. Your ref write must PASS them, not be exempted
  core/src/cli/commands/production-run.ts - acceptPhase, which already stores candidateSha
    on every accepted phase in the recovery prefix

DO
  Create core/src/git/candidate-ref.ts and write a ref at seal time under
    refs/awsf/candidates/<project>/<taskId>/<attempt> pointing at the sealed candidate SHA.
  Use a plain non-forcing update-ref. No force, no delete path.
  Project every ticket's own candidate SHA against its ticket id. The data already exists
    in the accepted-phase prefix - this is a projection, not a new record.
  Write the ref for EVERY sealed attempt, not only a shift's. A dangling candidate is not
    a shift-specific hazard.

DO NOT
  Do NOT write a branch, and do NOT write one ref per ticket. Each ticket's commit is an
    ancestor of the tip, so the tip ref alone makes every one of them reachable.
  Do NOT add an exemption to the invariant-8 meta-tests. If the write cannot pass them as
    written, the write is the wrong shape.

DONE WHEN
  npx tsx --test core/test/unit/candidate-ref.test.ts - the ref is created, is not a
    branch, and re-running the write on the same SHA is idempotent
  In a throwaway repository created by `git init`, the sealed candidate survives an
    aggressive pruning collection pass WITH the ref present, and is unreachable without it
  The invariant-8 meta-tests are green with NO exemption added, and a test says so
  npm run test:unit, npm run typecheck, npm run lint - green, counts recorded

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative
    rejected, and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (shift, compiler, budget, ref,
    readout, adopt) - never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in
  the body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS leaf plan's own markers in specs/awsf-v2-w17-shift.html: task 12's checklist boxes
  from [] to [x] (or [f] with the reason in the commit body). The leaf markers are
  flipped on EVERY task, including this one.
  Flip this ticket's `state:` to done (or failed) in the same commit.
  Do NOT touch specs/awsf-v2-plan.html's Milestone M17 / W17 marker - only T18 does that.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append
  to their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt: the prompt is the authored record, the Handoff is the correction layer.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T13 — Testing strategy for M4 - failure, durability, and the ref

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  WHY     closing coverage over git behaviour, which must never be tested against this repository

TASK 13 of 18. Plan: specs/awsf-v2-w17-shift.html, milestone M4.
PREDECESSORS: T11, T12 are [x]

READ FIRST
  AGENTS.md - the twelve invariants, IN FULL
  specs/awsf-v2-w17-shift.html - the plan. Purpose, Problem, Solution and Identifier Spine IN FULL,
    then this task's own section
  specs/tickets/awsf-v2-w17-shift/README.md - Conventions, gates, never-do list
  specs/awsf-v2-w17-shift.html - milestone M4's Testing Strategy task IN FULL
  core/test/journeys/ - how this repository drives the fixture adapter offline

DO
  Close every M4 checklist row that is not yet green.
  Every git assertion runs against a temporary-directory `git init` round trip. Never
    against this checkout.

DO NOT
  Do NOT spend any quota. The fixture adapter makes the red gate deterministic.

DONE WHEN
  npx tsx --test core/test/journeys/shift-blocked.test.ts and
    core/test/unit/candidate-ref.test.ts - green
  npm run test:unit, npm run typecheck, npm run lint - green, counts recorded
  npm test - full suite in one invocation, git status --porcelain clean afterwards

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative
    rejected, and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (shift, compiler, budget, ref,
    readout, adopt) - never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in
  the body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS leaf plan's own markers in specs/awsf-v2-w17-shift.html: task 13's checklist boxes
  from [] to [x] (or [f] with the reason in the commit body). The leaf markers are
  flipped on EVERY task, including this one.
  Flip this ticket's `state:` to done (or failed) in the same commit.
  Do NOT touch specs/awsf-v2-plan.html's Milestone M17 / W17 marker - only T18 does that.
  This is the LAST task of milestone M4: flip that milestone's <h3> header to [x]
  and every remaining checklist box in it.
  THEN append an Amendment to specs/awsf-v2-w17-shift.html recording the CLOSE of M4:
    - what the milestone accomplished, in terms of what is now observably true
    - every task in it and its final state, naming any [f] row and the block that holds it
    - the friction it hit: what took longer than the plan expected, what the plan got
      wrong, what a later milestone must now do differently because of it
    - the decisions made inside the milestone that the plan did not already carry
    - the landing commit SHA(s) and the suite counts at close
  Append the modified date and the agent/session ids to the metadata header in the
  same commit.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append
  to their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt: the prompt is the authored record, the Handoff is the correction layer.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T14 — One AWAITING_OWNER, and the per-ticket readout

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     this is the surface the owner reads after a night away, and the invariant it must not
          break is the one that keeps landing human

TASK 14 of 18. Plan: specs/awsf-v2-w17-shift.html, milestone M5.
PREDECESSORS: T12, T13 are [x]

READ FIRST
  AGENTS.md - the twelve invariants, IN FULL
  specs/awsf-v2-w17-shift.html - the plan. Purpose, Problem, Solution and Identifier Spine IN FULL,
    then this task's own section
  specs/tickets/awsf-v2-w17-shift/README.md - Conventions, gates, never-do list
  GATE G17-M: confirm main and task3.5 are merged. STOP if not
  core/src/state/task-machine.ts :115 - L20 is actors ["human"], interactive: true, the
    only route into LANDED, with no tier exemption
  core/src/state/errors.ts :20-30 - why a clock is absent from the deterministic sources
  core/src/cli/commands/production-run.ts :2329-2380 - the AWAITING_OWNER transition and
    the review evidence recorded there
  specs/awsf-v2-w17-shift.html - milestone M5 task 14's mockup IN FULL. It is the target shape

DO
  Build the AWAITING_OWNER readout. Per ticket: id, title, its own candidate SHA, and its
    gate result - sourced from the manifest and the accepted-phase records, never recomputed.
  List the review's findings once, for the accumulated diff, with the blocking count stated
    separately from the total.
  Print the ref, so the owner can reach the candidate with ordinary git and no worktree.
  Render a shift with a failed ticket in the same shape, that ticket's row red and the
    tail marked not-run.
  Add a meta-test confirming no module this workstream adds can produce L20 or supply a
    reason a timer could turn into L21, and that awsf land still refuses a non-interactive
    stdin.

DO NOT
  Do NOT make the readout start anything. It is a status projection.
  Do NOT add a timeout, a deadline, an auto-advance, or anything a clock could drive.

DONE WHEN
  npx tsx --test core/test/unit/shift-readout.test.ts - golden readout for a clean
    five-ticket shift and for one blocked at ticket 3
  The INV-1 fence goes red when deliberately violated, then green again after reverting
  npm run test:unit, npm run typecheck, npm run lint - green, counts recorded

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative
    rejected, and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (shift, compiler, budget, ref,
    readout, adopt) - never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in
  the body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS leaf plan's own markers in specs/awsf-v2-w17-shift.html: task 14's checklist boxes
  from [] to [x] (or [f] with the reason in the commit body). The leaf markers are
  flipped on EVERY task, including this one.
  Flip this ticket's `state:` to done (or failed) in the same commit.
  Do NOT touch specs/awsf-v2-plan.html's Milestone M17 / W17 marker - only T18 does that.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append
  to their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt: the prompt is the authored record, the Handoff is the correction layer.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T15 — The candidate is built fresh, and the preview follows delivery

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     two live-drive findings land here at once, and the tempting shortcut bakes this
          repository's shape into every project the factory is pointed at

TASK 15 of 18. Plan: specs/awsf-v2-w17-shift.html, milestone M5.
PREDECESSORS: T14 are [x]

READ FIRST
  AGENTS.md - the twelve invariants, IN FULL
  specs/awsf-v2-w17-shift.html - the plan. Purpose, Problem, Solution and Identifier Spine IN FULL,
    then this task's own section
  specs/tickets/awsf-v2-w17-shift/README.md - Conventions, gates, never-do list
  core/src/registry/catalog-schema.ts :7 and :59 - PROJECT_DELIVERY_POSTURES and the
    optional per-repository delivery field. It has had NO reader since it was added
  AGENTS.md invariant 3 and core/test/unit/meta/child-process-fence.test.ts
  core/test/unit/meta/no-skill-in-stages.test.ts and publish-fence.test.ts
  specs/awsf-v2-w17-shift.html - milestone M5 task 15 IN FULL, and the two live-drive findings in Notes

DO
  Make the preview step BUILD the candidate fresh before showing it, and record what it
    built and when. REFUSE a preview served from an existing bundle - do not show one
    with a caveat. Gates never render a page, and a stale bundle once made a correct
    landing read as a total regression.
  Derive the preview's form from the project's declared delivery posture: service serves
    locally; docs and none render the diff readout alone; mobile is NAMED AND NOT BUILT.
  Derive visual-review classification from the candidate's own diff against the posture,
    not from a new ticket field. A derived answer cannot go stale the way a flag does.
  Keep exactly one preview server alive at a time, and say where it is in the readout.

DO NOT
  Do NOT hard-code a browser step. An emulator is not a browser, and writing one into the
    judgment layer bakes this repository's shape into every project.
  Do NOT add a ticket field for visual review. Derive it.
  Do NOT add a writable route, import node:child_process outside the broker, or reach for
    a skill in the execution path.

DONE WHEN
  A stale bundle makes the preview step REFUSE, and the test asserts the refusal names
    staleness rather than a missing file
  Each delivery posture selects its own preview form, including mobile selecting the
    named-not-built path
  The child-process, publish, credential and skill fences are green with NO new exemption
  npm run test:unit, npm run typecheck, npm run lint - green, counts recorded

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative
    rejected, and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (shift, compiler, budget, ref,
    readout, adopt) - never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in
  the body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS leaf plan's own markers in specs/awsf-v2-w17-shift.html: task 15's checklist boxes
  from [] to [x] (or [f] with the reason in the commit body). The leaf markers are
  flipped on EVERY task, including this one.
  Flip this ticket's `state:` to done (or failed) in the same commit.
  Do NOT touch specs/awsf-v2-plan.html's Milestone M17 / W17 marker - only T18 does that.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append
  to their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt: the prompt is the authored record, the Handoff is the correction layer.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T16 — Testing strategy for M5 - the single owner gate

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  WHY     closing coverage over three fences that must each be watched to bite

TASK 16 of 18. Plan: specs/awsf-v2-w17-shift.html, milestone M5.
PREDECESSORS: T14, T15 are [x]

READ FIRST
  AGENTS.md - the twelve invariants, IN FULL
  specs/awsf-v2-w17-shift.html - the plan. Purpose, Problem, Solution and Identifier Spine IN FULL,
    then this task's own section
  specs/tickets/awsf-v2-w17-shift/README.md - Conventions, gates, never-do list
  specs/awsf-v2-w17-shift.html - milestone M5's Testing Strategy task IN FULL

DO
  Close every M5 checklist row that is not yet green.
  Violate INV-1, INV-2 and INV-3 deliberately, one at a time, watch each fence go red,
    and revert each in the same session.

DO NOT
  Do NOT leave any induced violation in the tree.

DONE WHEN
  npx tsx --test core/test/unit/shift-readout.test.ts - green
  npx tsx --test core/test/unit/meta/ - every fence green after the reverts
  npm run test:unit, npm run typecheck, npm run lint - green, counts recorded
  npm test - full suite in one invocation, git status --porcelain clean afterwards

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative
    rejected, and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (shift, compiler, budget, ref,
    readout, adopt) - never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in
  the body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS leaf plan's own markers in specs/awsf-v2-w17-shift.html: task 16's checklist boxes
  from [] to [x] (or [f] with the reason in the commit body). The leaf markers are
  flipped on EVERY task, including this one.
  Flip this ticket's `state:` to done (or failed) in the same commit.
  Do NOT touch specs/awsf-v2-plan.html's Milestone M17 / W17 marker - only T18 does that.
  This is the LAST task of milestone M5: flip that milestone's <h3> header to [x]
  and every remaining checklist box in it.
  THEN append an Amendment to specs/awsf-v2-w17-shift.html recording the CLOSE of M5:
    - what the milestone accomplished, in terms of what is now observably true
    - every task in it and its final state, naming any [f] row and the block that holds it
    - the friction it hit: what took longer than the plan expected, what the plan got
      wrong, what a later milestone must now do differently because of it
    - the decisions made inside the milestone that the plan did not already carry
    - the landing commit SHA(s) and the suite counts at close
  Append the modified date and the agent/session ids to the metadata header in the
  same commit.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append
  to their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt: the prompt is the authored record, the Handoff is the correction layer.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T17 — Milestone chaining, and shift as an adoption source

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     most of this is recognising mechanisms that already exist; the risk is building a
          second one beside them

TASK 17 of 18. Plan: specs/awsf-v2-w17-shift.html, milestone M6.
PREDECESSORS: T13, T16 are [x]

READ FIRST
  AGENTS.md - the twelve invariants, IN FULL
  specs/awsf-v2-w17-shift.html - the plan. Purpose, Problem, Solution and Identifier Spine IN FULL,
    then this task's own section
  specs/tickets/awsf-v2-w17-shift/README.md - Conventions, gates, never-do list
  core/src/cli/commands/new.ts :44-53 - --continues validation, and that it records
    continuesTask on the attempt
  dashboard/src/session-stacks.ts - groupSessionStacks joins over exactly two recorded
    relationships and compares task ids LITERALLY, never parsing a naming convention
  core/src/cli/commands/adopt.ts :70 and :188 - SUPPORTED gates the adoption SOURCE and
    admits only build-review and simple-sdlc
  core/src/workflow/candidate-seed.ts - validateInheritedSeed, which gates the TARGET

DO
  Chain three shifts with --continues in a journey and assert groupSessionStacks returns
    ONE stack containing all three, in chronological order.
  Assert the stack still forms when the three task ids share no prefix.
  Admit a sealed shift as an adoption SOURCE in adopt.ts. Leave the TARGET as a shipped
    T2 review workflow - validateInheritedSeed already requires that, and a continuation
    for an unrun tail is ordinary work.
  Record in the adoption evidence WHICH tickets the source shift completed, so the
    continuation's owner intent can name the tail rather than restating the milestone.

DO NOT
  Do NOT introduce a naming convention for shift task ids. The stack is derived from
    recorded relationships, not from parsed names.
  Do NOT build adoption INTO a shift. A seeded shift would have to reconcile an inherited
    diff against a compiled manifest - a second reconciliation surface, for a case that
    adopting into build-review already serves. This is declined in the plan.

DONE WHEN
  npx tsx --test core/test/journeys/shift-chain.test.ts - three chained shifts form one
    stack, with and without a shared id prefix
  npx tsx --test core/test/journeys/shift-adopt.test.ts - a sealed shift is admitted as an
    adoption source and its completed ticket list reaches the adoption evidence
  npm run test:unit, npm run typecheck, npm run lint - green, counts recorded

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative
    rejected, and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (shift, compiler, budget, ref,
    readout, adopt) - never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in
  the body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS leaf plan's own markers in specs/awsf-v2-w17-shift.html: task 17's checklist boxes
  from [] to [x] (or [f] with the reason in the commit body). The leaf markers are
  flipped on EVERY task, including this one.
  Flip this ticket's `state:` to done (or failed) in the same commit.
  Do NOT touch specs/awsf-v2-plan.html's Milestone M17 / W17 marker - only T18 does that.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append
  to their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt: the prompt is the authored record, the Handoff is the correction layer.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T18 — Testing strategy for M6, and the workstream's closing duties

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     the only task that spends quota, the only one that writes to the spine, and the one
          that decides whether the workstream's claim was actually earned

TASK 18 of 18. Plan: specs/awsf-v2-w17-shift.html, milestone M6.
PREDECESSORS: T03, T07, T10, T13, T16, T17 are [x]

READ FIRST
  AGENTS.md - the twelve invariants, IN FULL
  specs/awsf-v2-w17-shift.html - the plan. Purpose, Problem, Solution and Identifier Spine IN FULL,
    then this task's own section
  specs/tickets/awsf-v2-w17-shift/README.md - Conventions, gates, never-do list
  specs/awsf-v2-w17-shift.html - IN FULL, every milestone and every acceptance row
  specs/awsf-v2-plan.html - Milestone M17 / W17 IN FULL, and the 2026-09-03 away-mode amendment
  specs/tickets/awsf-v2-plan/W17.md - the spine ticket whose state this task flips

DO
  Write core/test/journeys/shift-milestone.test.ts: selection through AWAITING_OWNER on
    the fixture route, asserting the readout, the ref and the per-ticket record.
  Assert every AC and INV row from the Identifier Spine in one place, so a reader can see
    the whole claim discharged rather than scattered.
  Run ONE BOUNDED LIVE DRIVE - the only quota this workstream spends. One real milestone,
    unattended, end to end. Open the sealed candidate and look at it. Record what you saw,
    including anything the readout failed to surface, in the closing amendment.
  Close every remaining checklist row in the plan.

DO NOT
  Do NOT declare the workstream done on a green suite alone. The suite is not the
    acceptance bar; the live drive is. If the drive was not run, this task closes [f].
  Do NOT flip the spine marker before every marker in this plan reads [x].

DONE WHEN
  npx tsx --test core/test/journeys/shift-milestone.test.ts - green
  npm test - the full suite in one invocation, git status --porcelain clean afterwards
  npx tsx --test core/test/unit/meta/ticket-plan-sync.test.ts - this plan pairs with its
    ticket set and its build prompts; all eleven identifier-spine rows green
  The live drive completed, reached AWAITING_OWNER exactly once, and its candidate was
    built fresh and looked at

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative
    rejected, and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (shift, compiler, budget, ref,
    readout, adopt) - never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in
  the body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS leaf plan's own markers in specs/awsf-v2-w17-shift.html: task 18's checklist boxes
  from [] to [x] (or [f] with the reason in the commit body). The leaf markers are
  flipped on EVERY task, including this one.
  Flip this ticket's `state:` to done (or failed) in the same commit.
  Do NOT touch specs/awsf-v2-plan.html's Milestone M17 / W17 marker - only T18 does that.
  This is the LAST task of milestone M6: flip that milestone's <h3> header to [x]
  and every remaining checklist box in it.
  THEN append an Amendment to specs/awsf-v2-w17-shift.html recording the CLOSE of M6:
    - what the milestone accomplished, in terms of what is now observably true
    - every task in it and its final state, naming any [f] row and the block that holds it
    - the friction it hit: what took longer than the plan expected, what the plan got
      wrong, what a later milestone must now do differently because of it
    - the decisions made inside the milestone that the plan did not already carry
    - the landing commit SHA(s) and the suite counts at close
  Append the modified date and the agent/session ids to the metadata header in the
  same commit.
  AFTER every marker in specs/awsf-v2-w17-shift.html reads [x], and in the SAME commit,
  flip specs/awsf-v2-plan.html's Milestone M17 / W17 marker and its checklist to [x],
  and flip specs/tickets/awsf-v2-plan/W17.md's state to done.
  THEN append an Amendment to specs/awsf-v2-plan.html recording the CLOSE of W17:
    - what this workstream delivered against the spine's claim for it, claim by claim
    - which of its own Questionables it resolved, and how
    - the friction and the surprises, including anything it found that the spine or the
      2026-09-03 away-mode amendment assumed wrongly
    - anything it routed elsewhere rather than building, and to which workstream
    - every row that closed [f], with the block that holds it
    - the landing commit SHA and this plan's final suite counts
  This is the ONLY ticket that writes to specs/awsf-v2-plan.html. Append the modified date
  and the agent/session ids there too.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append
  to their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt: the prompt is the authored record, the Handoff is the correction layer.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```
