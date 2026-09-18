# awsf-v2-w10-mf-adapter - build prompts

Prompt source for [`./awsf-v2-w10-mf-adapter.html`](./awsf-v2-w10-mf-adapter.html), the deep plan for **W10 - the `mf`
adapter and native fusion**. Each `### Tnn` block below is carried byte-identically as the
`## Build prompt` of the matching ticket in [`./tickets/awsf-v2-w10-mf-adapter/`](./tickets/awsf-v2-w10-mf-adapter/); the
invariant-12 fence compares the two.

**Optional workstream.** Nothing in v2 waits on W10. Milestone M1 is a decision milestone that
costs no quota and is allowed to end the workstream with a recorded evidence gap.

---

# Section A — Conventions every prompt inherits

These are stated once here and once in `specs/tickets/awsf-v2-w10-mf-adapter/README.md`. Every Section B
prompt below assumes them and does not repeat them.

**Read first, on every task.** `AGENTS.md` in full; `specs/awsf-v2-w10-mf-adapter.html` - Purpose, Problem,
"The fork, decided", Solution and the Identifier Spine in full, then the task's own milestone;
then `specs/tickets/awsf-v2-w10-mf-adapter/README.md`.

**The baseline rule.** Run `npm run test:unit` at the exact base SHA your task starts from,
before changing anything, and record the count in the commit body. A red baseline blocks a
correct build, and neither `doctor` nor `lint` catches one.

**Marker discipline - both files, always.** This plan is one workstream of a parent spine, so
there are two marker sets. (1) This leaf plan's own markers in `specs/awsf-v2-w10-mf-adapter.html` - flipped on
every task, including the first. (2) The spine's workstream marker in `specs/awsf-v2-plan.html`
section Milestone M10 / W10 - not flipped until T16, the only ticket that writes to the spine.
Flip the ticket's own `state:` in the same commit as the HTML marker.

**The commit rule.** Commit once the task's Definition of Done is green, as one Conventional
Commit, with a body saying what changed and why. Never put an agent, model or AI tool in a
commit identity, message or trailers - AGENTS.md invariant 11, and a meta-test scans for it.

**The handoff duty.** Every prompt ends with one. Append dated, numbered entries to the
`## Handoff` section of the tickets whose `depends_on` names your id.

**Why `## Handoff` sits above `## Build prompt`.** The sync fence splits a ticket body on
`## Build prompt\n\n` and compares everything after it against Section B byte for byte, so a
handoff appended below the prompt would break the fence on its first entry.

---

# Section B — Task prompts (recommended)

### T01 — The N-model phase list, and what it compiles to

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     The whole workstream turns on whether a runtime phase list compiles at all; a wrong
          reading of the compiler here sends four later milestones down the wrong road.

TASK 1 of 23. Plan: specs/awsf-v2-w10-mf-adapter.html, milestone M1.
PREDECESSORS: none. This is the first task.

READ FIRST
  AGENTS.md IN FULL
  specs/awsf-v2-w10-mf-adapter.html - Purpose, Problem, "The fork, decided", Solution and the
    Identifier Spine IN FULL, then milestone M1
  specs/tickets/awsf-v2-w10-mf-adapter/README.md
  core/src/workflow/compiler.ts IN FULL - compileWorkflow at :153, compileWorkflowStructure,
    reviewBuildPhaseId at :135, and assertEarnedDescription
  core/src/workflow/phase.ts - PhaseDefinition, AgentPhaseDefinition, LocalPhaseDefinition
  core/src/workflow/recipes/build-review.ts - the shape a fusion recipe copies, including the
    host review-context phase that composes several outputs at zero call cost
  core/src/workflow/catalog.ts - the module-load assertion a compiled recipe must never trip

DO
  Add core/test/unit/workflow/fusion-compile.test.ts.
  Build a HAND-WRITTEN fixture phase list - no generator yet, that is T07 - shaped as N
    opinion agent phases, one kind:"code" composer phase, one fusing agent phase, in that order.
  Give every phase a unique id and a description that passes assertEarnedDescription.
  Assert compileWorkflowStructure returns minimumCalls === N + 1 for N = 2, 3, 4 and 5, and
    that the host composer contributes zero.
  Assert reviewBuildPhaseId returns the FUSING phase's id when a review phase is present, and
    that the opinion phases are not counted - they carry a different schema id.
  Assert WORKFLOW_IDS and WORKFLOW_RECIPES are unchanged by anything in this task.
  Use an already-registered schema id for the opinion phases as a placeholder and leave a
    comment naming T04 as the task that replaces it with awsf.opinion-output/v1.

DO NOT
  Do not register a fusion recipe in WORKFLOW_RECIPES. One line satisfies catalog.ts's
    module-load assertion, and it makes minimumCallsFor and correctionsFundableFor report a
    number that is wrong for every roster but one.
  Do not write a generator. A hand fixture is the point of this task: it proves the compiler
    accepts a runtime phase list before anything is designed around that fact.
  Do not touch core/src/workflow/compiler.ts. If the fixture does not compile, that is the
    finding, not a bug to patch.
  Do not spend any quota. Every assertion here runs with no provider process.

DONE WHEN
  npm run test:unit - green at the exact base SHA BEFORE any change, count recorded
  npm run test:unit - green after, with the new test file passing, count recorded
  The compile assertions have each been seen to FAIL once, by inducing one drift and reverting it
  npm run typecheck and npm run lint - clean

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (fusion, contracts, compiler, budget,
  routing, config), never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the
  body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w10-mf-adapter.html, on this task and every task:
  the task's `<code class="status">` checklist items, [] -> [x] (or [f] with the reason).
  Do NOT flip this milestone's <h3> header - its last task does that.
  Do NOT touch specs/awsf-v2-plan.html. Only T23 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to
  their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task did it, or must absorb because it could not
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt. Append nothing if there is nothing; an empty Handoff is a real answer.
```

### T02 — Three registrations before the first GO, and the refutation of the composite path

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     This is the spine's cheapest unused upgrade and the test that settles the fork; it
          reads the launcher barrier's settlement seam, which is concurrency-shaped code.

TASK 2 of 23. Plan: specs/awsf-v2-w10-mf-adapter.html, milestone M1.
PREDECESSORS: T01 is [x].

READ FIRST
  specs/awsf-v2-w10-mf-adapter.html - Problem section IN FULL, especially the table of four
    refusals the code already makes, then milestone M1 task 2
  core/src/execution/transport-broker.ts - startProcess and its four registration classes
  core/src/execution/launcher-barrier.ts - ReservationLedger at :333, BarrierSettlement,
    runLauncherBarrier and the order of its steps
  core/src/execution/call-budget.ts - reserve, reserveComposite at :392, settle at :419,
    spendOnGo at :400, releaseOnRegistrationFailure at :409, restoreReservation at :446
  core/src/adapters/interface.ts - AgentPhaseProcessRegistration and its evidence type
  core/test/unit/execution/call-budget.test.ts - the existing composite reservation tests

DO
  Add core/test/unit/workflow/fusion-registrations.test.ts.
  Stand a FAKE broker in place of the real one: record every registration passed to
    startProcess and every barrier step, and start no process at all.
  Drive T01's N = 3 fixture through it. Assert THREE agent-phase registrations exist, each
    with a distinct phaseId and phaseOrdinal, and that the first GO arrives only after the
    third registration exists.
  Assert each registration names its own reservation id, and that every reservation is
    kind:"single" with cost 1.
  Write the REFUTATION of option (a), as two assertions with the reason in the message:
    - one reserveComposite(2) reservation handed to three registrations spends WHOLE at the
      first GO, and the second raises ReservationNotHeld - cite launcher-barrier.ts:333 in the
      assertion message, because the reason is that the ledger seam takes no amount
    - restoreReservation refuses a composite record with InterruptedTurnRefused
      ("recovery-ambiguous"), so a composite reservation cannot be recovered after a crash
  Add core/test/unit/meta/fusion-spawn-fence.test.ts asserting no module under
    core/src/workflow/fusion/ imports node:child_process. The directory may not exist yet;
    write the fence so an absent directory passes and a violating file fails.

DO NOT
  Do not describe the gap as ledger arithmetic anywhere - in code, comment or commit body.
    settle(id, spent) exists and handles the halfway composite exactly. The gap is that the
    barrier's ReservationLedger seam has no method that takes an amount, so no launch can
    reach settle with one. The arithmetic version suggests a ledger redesign that is not needed.
  Do not add a settlement mode, a registration class, or any amount-carrying ledger method.
    This task PROVES they would be needed; it does not build them.
  Do not start a real process or spend quota.

DONE WHEN
  npm run test:unit - green at the exact base SHA before any change, count recorded
  npm run test:unit - three registrations before the first GO, offline, asserted and passing
  npm run test:unit - both refutation assertions pass and each has been seen to fail once
  npm run typecheck and npm run lint - clean

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (fusion, contracts, compiler, budget,
  routing, config), never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the
  body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w10-mf-adapter.html, on this task and every task:
  the task's `<code class="status">` checklist items, [] -> [x] (or [f] with the reason).
  Do NOT flip this milestone's <h3> header - its last task does that.
  Do NOT touch specs/awsf-v2-plan.html. Only T23 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to
  their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task did it, or must absorb because it could not
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt. Append nothing if there is nothing; an empty Handoff is a real answer.
```

### T03 — Testing Strategy - M1, and the fork decision record

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     This task decides whether the workstream continues at all, and writes that decision
          where the next session reads it.

TASK 3 of 23. Plan: specs/awsf-v2-w10-mf-adapter.html, milestone M1.
PREDECESSORS: T01 and T02 are [x].

READ FIRST
  specs/awsf-v2-w10-mf-adapter.html - milestone M1 IN FULL, and the optional-workstream card
    above it
  specs/awsf-v2-plan.html - section Milestone M10 / W10 IN FULL, including its checklist
  The two test files T01 and T02 added

DO
  Confirm both M1 proofs are green and each has been seen to fail once by induced drift.
  Make the spawn fence from T02 assert BOTH prohibitions: no node:child_process import, and
    no import of core/src/cli/commands/raise.ts, from any module under core/src/workflow/fusion/.
  Write the milestone-closing Amendment in specs/awsf-v2-w10-mf-adapter.html. It must record:
    - that the fork is settled at option (c), with the two measured refusals as evidence
    - that the gap is supervision and attribution, NOT ledger arithmetic
    - the exact counts from npm run test:unit at the base SHA and at the landing SHA
    - the close-unbuilt branch, named explicitly, so a later session knows it exists
  If either proof did NOT hold: mark the failing rows [f], write the Amendment as a
    close-unbuilt record naming the evidence gap, and STOP the workstream here. Do not flip
    the spine marker either way - T16 owns that, and an unbuilt close leaves it at [].

DO NOT
  Do not take a live capture. The fit already failed at the broker; a capture taken before the
    fork is chosen buys nothing, and the fork is only just being recorded here.
  Do not start milestone M2 in this session.
  Do not flip specs/awsf-v2-plan.html's W10 marker.

DONE WHEN
  npm run test:unit - whole suite green, count recorded in the commit body
  npm run typecheck and npm run lint - clean
  core/test/unit/meta/fusion-spawn-fence.test.ts asserts both prohibitions and has been seen
    to fail once for each
  The M1 Amendment exists and records the fork decision with its measured evidence

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (fusion, contracts, compiler, budget,
  routing, config), never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the
  body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w10-mf-adapter.html, on this task and every task:
  the task's `<code class="status">` checklist items, [] -> [x] (or [f] with the reason).
  This is the LAST task of milestone M1: also flip that milestone's <h3> header to [x]
  and every remaining checklist box in it.
  THEN append an Amendment to specs/awsf-v2-w10-mf-adapter.html recording the CLOSE of M1:
    - what the milestone accomplished, in terms of what is now observably true
    - every task in it and its final state, naming any [f] row and the block that holds it
    - the friction it hit: what took longer than the plan expected, what the plan got wrong,
      what a later milestone must now do differently because of it
    - the decisions made inside the milestone that the plan did not already carry
    - the landing commit SHA(s) and the suite counts at close
  Append the modified date to the metadata header in the same commit.
  Do NOT touch specs/awsf-v2-plan.html. Only T23 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to
  their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task did it, or must absorb because it could not
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt. Append nothing if there is nothing; an empty Handoff is a real answer.
```

### T04 — The opinion envelope contract

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT medium
  CLAUDE  claude:opus · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  WHY     A TypeBox contract in an established pattern; the judgement is in what the schema
          refuses, not in how it is written.

TASK 4 of 23. Plan: specs/awsf-v2-w10-mf-adapter.html, milestone M2.
PREDECESSORS: T03 is [x] and milestone M1 is [x].

READ FIRST
  specs/awsf-v2-w10-mf-adapter.html - milestone M2 IN FULL
  core/src/contracts/envelope-base.ts - ENVELOPE_BASE_PROPERTIES and why they are SPREAD into
    each envelope rather than referenced
  core/src/contracts/review-output.ts and core/src/contracts/plan-output.ts - two envelopes to
    pattern-match against
  core/src/contracts/registry.ts - how schemaForId resolves, and what compilePhase checks
  core/src/contracts/json-schema.ts - injectOutputSchema and PREVIOUS_ENVELOPE_PLACEHOLDER

DO
  Add core/src/contracts/opinion-output.ts declaring awsf.opinion-output/v1: the base envelope
    properties spread in, plus a position, its reasoning, a stated confidence, and what
    evidence would change it.
  Constrain artifacts to an EMPTY array at the schema level, so an opinion cannot claim a file
    at all. This is one of the two independent refusals INV-2 rests on.
  Register it in core/src/contracts/registry.ts.
  Add core/test/unit/contracts/opinion-output.test.ts: a fixture opinion envelope validates;
    one carrying a single artifact claim is refused BY THE SCHEMA, not by a gate.
  Assert the schema id is not awsf.build-output/v1 and that reviewBuildPhaseId ignores phases
    carrying it.
  Replace T01's placeholder schema id in fusion-compile.test.ts with this one.

DO NOT
  Do not give the opinion envelope a diff, a patch, a file list, or any field that could carry
    one. The shortest path from "a model with an opinion" to "a model that implements it" is
    one schema field, and it would be added for a good reason.
  Do not reuse awsf.build-output/v1 for opinion phases. The exactly-one-build-producer rule at
    compiler.ts:135 is what keeps a fusion recipe compilable under review, and it works here
    only because the opinions carry a different schema.
  Do not put a credential-shaped value in any fixture - AGENTS.md invariant 9, and a meta-test
    scans for it.

DONE WHEN
  npm run test:unit - green at the base SHA before any change, count recorded
  npm run test:unit - the opinion contract validates its fixture and refuses an artifact claim
  npm run test:unit - fusion-compile.test.ts still passes against the real schema id
  npm run typecheck and npm run lint - clean

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (fusion, contracts, compiler, budget,
  routing, config), never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the
  body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w10-mf-adapter.html, on this task and every task:
  the task's `<code class="status">` checklist items, [] -> [x] (or [f] with the reason).
  Do NOT flip this milestone's <h3> header - its last task does that.
  Do NOT touch specs/awsf-v2-plan.html. Only T23 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to
  their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task did it, or must absorb because it could not
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt. Append nothing if there is nothing; an empty Handoff is a real answer.
```

### T05 — The opinion role, and the write refusal

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT medium
  CLAUDE  claude:opus · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  WHY     Prompt authoring plus a policy assertion; the care is in making the two refusals
          independent rather than one restated twice.

TASK 5 of 23. Plan: specs/awsf-v2-w10-mf-adapter.html, milestone M2.
PREDECESSORS: T04 is [x].

READ FIRST
  specs/awsf-v2-w10-mf-adapter.html - milestone M2 IN FULL, and the "what (c) gets for nothing"
    list in the fork section
  awsf.config.yaml - the planner and reviewer agents; both already declare writes: [] with a
    readonly tool profile, which is the shape an opinion slot copies
  core/src/policy/path-policy.ts - evaluatePathPolicy and the outside-write-globs reason
  prompts/reviewer/system.md and prompts/reviewer/user.md - a read-only role's prompt pair
  The fusion-harness v2 prompt library, for the merge contract the fuser prompt is derived from
    - read it; do not invent one

DO
  Add prompts/opinion/system.md and prompts/opinion/user.md. The user prompt must carry
    {output_schema}, and {previous_envelope} where a previous envelope is delivered, exactly as
    injectOutputSchema and renderPrevious require.
  Add prompts/fuser/system.md and prompts/fuser/user.md, derived from the tool's own merge
    contract. The fuser is told plainly that it is the only writer and that its sources are
    read-only research it may discard.
  Add a test driving evaluatePathPolicy with an opinion role's writes: [] over a plausible
    claimed path, asserting the violation reason is exactly outside-write-globs.
  Add a test asserting a fusion phase list has exactly ONE phase whose role declares a
    non-empty writes, for every N from 2 to 5.

DO NOT
  Do not add a writer lease, a lock file, a writer token, or a worktree per role. The tool
    needs a lease because its slots run concurrently; AWSF's phase loop awaits each turn, so
    single-writer is structural here. Adding a lease would be protecting against a race that
    the loop makes impossible, and it would imply a concurrency this factory does not have.
  Do not give an opinion role an exec, edit or write tool. readonly is read/grep/find/ls and
    nothing else, and the reviewer role's own comment explains why that matters.
  Do not edit awsf.config.yaml. It is protected: path-policy rejects protected-path
    independently of the write globs, and adding an agent there is an owner act.

DONE WHEN
  npm run test:unit - green at the base SHA before any change, count recorded
  npm run test:unit - the path-policy refusal passes and has been seen to fail once
  npm run test:unit - the one-writer assertion passes at N = 2, 3, 4 and 5
  npm run typecheck and npm run lint - clean

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (fusion, contracts, compiler, budget,
  routing, config), never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the
  body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w10-mf-adapter.html, on this task and every task:
  the task's `<code class="status">` checklist items, [] -> [x] (or [f] with the reason).
  Do NOT flip this milestone's <h3> header - its last task does that.
  Do NOT touch specs/awsf-v2-plan.html. Only T23 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to
  their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task did it, or must absorb because it could not
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt. Append nothing if there is nothing; an empty Handoff is a real answer.
```

### T06 — Testing Strategy - M2

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT medium
  CLAUDE  claude:opus · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  WHY     Closing a milestone: prove both refusals separately, then write the record.

TASK 6 of 23. Plan: specs/awsf-v2-w10-mf-adapter.html, milestone M2.
PREDECESSORS: T04 and T05 are [x].

READ FIRST
  specs/awsf-v2-w10-mf-adapter.html - milestone M2 IN FULL
  The test files T04 and T05 added
  core/test/unit/meta/ - the credential-pattern and junk-drawer fences

DO
  Confirm the schema refusal and the path-policy refusal are asserted in SEPARATE tests, each
    seen to fail once. They are two independent guarantees; one test covering both would let
    either regress silently behind the other.
  Confirm no fixture added in M2 contains a credential-shaped value, and that nothing added is
    a receipt or manifest file (AGENTS.md invariants 9 and 10).
  Write the milestone-closing Amendment in specs/awsf-v2-w10-mf-adapter.html for M2.

DO NOT
  Do not start milestone M3 in this session.
  Do not flip specs/awsf-v2-plan.html's W10 marker.

DONE WHEN
  npm run test:unit - whole suite green, count recorded
  npm run typecheck and npm run lint - clean
  The credential-pattern and junk-drawer meta-tests both pass
  The M2 Amendment exists and names every decision M2 took that the plan did not already carry

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (fusion, contracts, compiler, budget,
  routing, config), never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the
  body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w10-mf-adapter.html, on this task and every task:
  the task's `<code class="status">` checklist items, [] -> [x] (or [f] with the reason).
  This is the LAST task of milestone M2: also flip that milestone's <h3> header to [x]
  and every remaining checklist box in it.
  THEN append an Amendment to specs/awsf-v2-w10-mf-adapter.html recording the CLOSE of M2:
    - what the milestone accomplished, in terms of what is now observably true
    - every task in it and its final state, naming any [f] row and the block that holds it
    - the friction it hit: what took longer than the plan expected, what the plan got wrong,
      what a later milestone must now do differently because of it
    - the decisions made inside the milestone that the plan did not already carry
    - the landing commit SHA(s) and the suite counts at close
  Append the modified date to the metadata header in the same commit.
  Do NOT touch specs/awsf-v2-plan.html. Only T23 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to
  their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task did it, or must absorb because it could not
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt. Append nothing if there is nothing; an empty Handoff is a real answer.
```

### T07 — compileFusion - the generator, pure and digest-reproducible

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     The first generated recipe in the tree, and it has to be reproducible across a
          process boundary or recovery cannot trust it.

TASK 7 of 23. Plan: specs/awsf-v2-w10-mf-adapter.html, milestone M3.
PREDECESSORS: T03 and T06 are [x], so milestones M1 and M2 are both [x].

READ FIRST
  specs/awsf-v2-w10-mf-adapter.html - milestone M3 IN FULL, including the G10-A card
  specs/awsf-v2-w17-shift.html - its M2 milestone and core/src/workflow/shift/compile.ts, if
    that workstream has landed. THIS IS THE G10-A CHECK, and it runs both ways:
      - if W17 has landed a compiled-recipe ADMISSION path (a compiled recipe getting a
        workflow id, a ceiling admission, a binding digest and a byte-identical rebuild on
        resume), CONSUME it. Do not write a second one.
      - if it has not, build the narrow version under core/src/workflow/ rather than under
        core/src/workflow/fusion/, so W17 can consume it later, and say so in the Handoff.
    Either way the GENERATORS stay separate: ticket bodies and a model roster have nothing in
    common, and an abstraction over both would be a taxonomy nothing reads.
  core/src/workflow/compiler.ts - compileWorkflow, admitWorkflow, compileWorkflowStructure
  core/src/workflow/catalog.ts - the module-load assertion
  core/test/unit/meta/quota-fence.test.ts - the TRANSITIVE fence; workflow code may not reach
    the quota module even through an intermediate file

DO
  Add core/src/workflow/fusion/roster.ts: a slot is an adapter id, an optional provider
    assertion, a model, an effort and a stable slot id. Refuse a roster below 2 slots, above 5,
    with duplicate slot ids, or naming an adapter the effective config does not declare or has
    disabled - each refusal by its own named error.
  Add core/src/workflow/fusion/compile.ts exporting compileFusion(roster, request) returning a
    WorkflowDefinition: N opinion phases with ids derived from slot ids, one opinion-context
    host phase, one fuse phase, in that order, every description passing assertEarnedDescription.
  Keep it PURE: no file read, no clock, no provider, no config beyond what is handed in.
  Add a binding digest over the roster, and a test compiling the same roster in TWO separate
    processes and comparing the phase lists byte for byte.
  Assert WORKFLOW_IDS and WORKFLOW_RECIPES are still unchanged.

DO NOT
  Do not register the compiled recipe in WORKFLOW_RECIPES, at any point, for any reason.
  Do not import anything from core/src/quota/ - not directly and not through an intermediate
    file. The quota fence follows the full relative-import graph.
  Do not make compileFusion read awsf.config.yaml itself. It is handed what it needs; a pure
    function that reads a file is not pure, and the reproducibility test is what catches it.
  Do not build a DAG scheduler. compileWorkflow takes an ordered array. Collaboration-style
    delegation is explicitly out of scope - see the plan's Q8.

DONE WHEN
  npm run test:unit - green at the base SHA before any change, count recorded
  npm run test:unit - compileFusion produces the right phase list for N = 2..5 and every
    roster refusal fires by its own error
  npm run test:unit - the two-process reproducibility test passes and has been seen to fail
    once by perturbing one roster byte
  npm run test:unit - the quota fence passes, including its transitive leg
  npm run typecheck and npm run lint - clean

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (fusion, contracts, compiler, budget,
  routing, config), never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the
  body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w10-mf-adapter.html, on this task and every task:
  the task's `<code class="status">` checklist items, [] -> [x] (or [f] with the reason).
  Do NOT flip this milestone's <h3> header - its last task does that.
  Do NOT touch specs/awsf-v2-plan.html. Only T23 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to
  their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task did it, or must absorb because it could not
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt. Append nothing if there is nothing; an empty Handoff is a real answer.
```

### T08 — The opinion-context host composer

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     It edits production-run.ts's host dispatch chain, which is the busiest file in the
          repository and the one the pending merge touches hardest.

TASK 8 of 23. Plan: specs/awsf-v2-w10-mf-adapter.html, milestone M3.
PREDECESSORS: T04 and T07 are [x].

READ FIRST
  specs/awsf-v2-w10-mf-adapter.html - milestone M3 task 8, and the "host composer is a pattern,
    not an invention" bullet in the fork section
  core/src/contracts/review-context.ts - the precedent contract
  core/src/workflow/recipes/build-review.ts - the review-context phase's own comment, which
    states exactly why a host phase exists here: the reviewer has one envelope slot and needs
    more than one phase's output in it
  core/src/cli/commands/production-run.ts - composeReviewEvidence, and the phase.schemaId
    dispatch chain that binds host phases (the REVIEW_CONTEXT, DESIGN_CONTEXT and PLAN_CONTEXT
    branches are the three existing instances)

DO
  Add core/src/contracts/fusion-context.ts declaring awsf.fusion-context/v1: the original
    request, and every opinion with its slot id, provider, resolved model and a digest over its
    envelope bytes.
  Bind a host composer in production-run.ts's schemaId dispatch chain, beside the three
    existing context branches. It reserves nothing and spends nothing.
  Carry a FAILED opinion as a named failure rather than omitting it, so the fuser can see a
    source was asked and did not answer.
  Refuse to compose with fewer than two SUCCESSFUL opinions, matching the floor the owner's
    own tool enforces.
  Journal the composed envelope, so the fused result's sources are reconstructable without
    re-reading provider output.
  Add a test asserting a fusion recipe's minimumCalls is unchanged by the composer's presence.

DO NOT
  Do not make the composer an agent phase. It costs a provider call the moment it becomes one,
    and the whole reason the pattern exists is that it does not.
  Do not silently drop a failed opinion. A fuser that cannot tell "nobody asked" from "it did
    not answer" will merge as though the source agreed.
  Do not hand the fuser raw provider output. It gets the validated envelopes and the digests.

DONE WHEN
  npm run test:unit - green at the base SHA before any change, count recorded
  npm run test:unit - the composer runs with zero calls, minimumCalls unchanged
  npm run test:unit - the fewer-than-two-successes refusal fires, and a failed opinion is
    carried as a named failure rather than dropped
  npm run typecheck and npm run lint - clean

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (fusion, contracts, compiler, budget,
  routing, config), never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the
  body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w10-mf-adapter.html, on this task and every task:
  the task's `<code class="status">` checklist items, [] -> [x] (or [f] with the reason).
  Do NOT flip this milestone's <h3> header - its last task does that.
  Do NOT touch specs/awsf-v2-plan.html. Only T23 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to
  their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task did it, or must absorb because it could not
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt. Append nothing if there is nothing; an empty Handoff is a real answer.
```

### T09 — Ceiling admission, and recovery from the accepted prefix

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     Recovery and ledger restoration; the failure mode of getting it wrong is a run that
          re-asks a question the owner already paid for.

TASK 9 of 23. Plan: specs/awsf-v2-w10-mf-adapter.html, milestone M3.
PREDECESSORS: T07 and T08 are [x].

READ FIRST
  specs/awsf-v2-w10-mf-adapter.html - milestone M3 task 9, and the tier/ceiling table in the
    Solution section IN FULL
  core/src/state/tiers.ts IN FULL - MAX_CALL_CEILING, DEFAULT_CALL_CEILINGS, ceilingFor,
    fitsCeiling, assertWorkflowFitsTier
  core/src/execution/call-budget.ts - admitWorkflow and restoreReservation at :446
  core/src/cli/commands/raise.ts - CeilingRaiseNotInteractive and why raising is an owner act
  core/src/cli/commands/production-run.ts - the phase loop's per-phase reserve, and the
    accepted-prefix recovery path

DO
  Refuse a roster whose minimumCalls exceeds the attempt's RESOLVED ceiling, at compile time,
    with a message naming the shortfall in calls and what would close it - a configured ceiling
    change or an owner raise - and naming neither as automatic.
  Assert the refusal costs nothing: no reservation created, no process in existence.
  Prove prefix recovery: a crash between opinion 2 and opinion 3 resumes with opinions 1 and 2
    accepted, their cost-1 reservations restored through restoreReservation, and neither
    re-asked.
  Refuse a resume whose recorded roster no longer compiles to the same phase list. Refuse it;
    do not silently re-plan.
  Extend the M1 spawn fence to assert no module under core/src/workflow/fusion/ imports
    raise.ts, if T03 did not already.

DO NOT
  Do not change MAX_CALL_CEILING, DEFAULT_CALL_CEILINGS, or ceilingFor. The plan measured this:
    no code change is required at any N from 2 to 5. MAX_CALL_CEILING is 20 and the bound is
    deliberately in code rather than config, because a bound the config could raise would be a
    bound the config could remove.
  Do not let a fusion raise its own ceiling. awsf raise requires an interactive terminal by
    design; a run that can widen itself is not bounded by a checkpoint at all.
  Do not create a reservation whose kind is not "single" or whose cost is not 1. That is the
    only shape restoreReservation admits, and prefix recovery depends on it.

DONE WHEN
  npm run test:unit - green at the base SHA before any change, count recorded
  npm run test:unit - the ceiling refusal fires at N = 5 against a resolved ceiling of 5 and
    names the shortfall; the same roster is admitted at a resolved ceiling of 6
  npm run test:unit - the refusal creates no reservation and starts no process
  npm run test:unit - prefix recovery resumes without re-asking a completed opinion, and a
    changed roster refuses the resume
  npm run typecheck and npm run lint - clean

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (fusion, contracts, compiler, budget,
  routing, config), never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the
  body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w10-mf-adapter.html, on this task and every task:
  the task's `<code class="status">` checklist items, [] -> [x] (or [f] with the reason).
  Do NOT flip this milestone's <h3> header - its last task does that.
  Do NOT touch specs/awsf-v2-plan.html. Only T23 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to
  their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task did it, or must absorb because it could not
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt. Append nothing if there is nothing; an empty Handoff is a real answer.
```

### T10 — Testing Strategy - M3

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     A whole-fusion journey on the stub route is the first end-to-end proof, and it must
          cost zero quota to be worth having.

TASK 10 of 23. Plan: specs/awsf-v2-w10-mf-adapter.html, milestone M3.
PREDECESSORS: T07, T08 and T09 are [x].

READ FIRST
  specs/awsf-v2-w10-mf-adapter.html - milestone M3 IN FULL
  core/test/journeys/ - the existing zero-quota journey shape, which this one copies
  core/src/adapters/stub.ts - the fixture route, which reports a provider without reaching one

DO
  Add a journey driving a whole N = 3 fusion end to end on the FIXTURE route: three opinions,
    the host composition, one fused result, four recorded phase results, zero quota.
  Confirm the ceiling refusal, the reproducibility test and the prefix-recovery test all pass
    and have each been seen to fail once.
  Write the milestone-closing Amendment for M3.
  In the Amendment, record the G10-A outcome explicitly: which workstream owns the compiled-
    recipe admission path, and whether this one built it or consumed it.
  Also record, as a decision point for the owner rather than a task: whether W16 has landed.
    If it has not, a fusion above two models cannot be routed at all, and the honest question
    of whether to continue to M4 belongs here rather than at M5.

DO NOT
  Do not spend quota. The journey runs on the fixture route; that is what makes it repeatable.
  Do not start milestone M4 in this session. Note that M4, debate, is NOT gated by G10-B - it
    needs nothing from the routing work. M5 is the milestone the merge blocks.
  Do not flip specs/awsf-v2-plan.html's W10 marker.

DONE WHEN
  npm run test:unit - the N = 3 fusion journey runs end to end on the stub route with zero quota
  npm run test:unit - whole suite green, count recorded
  npm run typecheck and npm run lint - clean
  The M3 Amendment exists, records the G10-A outcome, and states the W16 decision point

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (fusion, contracts, compiler, budget,
  routing, config), never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the
  body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w10-mf-adapter.html, on this task and every task:
  the task's `<code class="status">` checklist items, [] -> [x] (or [f] with the reason).
  This is the LAST task of milestone M3: also flip that milestone's <h3> header to [x]
  and every remaining checklist box in it.
  THEN append an Amendment to specs/awsf-v2-w10-mf-adapter.html recording the CLOSE of M3:
    - what the milestone accomplished, in terms of what is now observably true
    - every task in it and its final state, naming any [f] row and the block that holds it
    - the friction it hit: what took longer than the plan expected, what the plan got wrong,
      what a later milestone must now do differently because of it
    - the decisions made inside the milestone that the plan did not already carry
    - the landing commit SHA(s) and the suite counts at close
  Append the modified date to the metadata header in the same commit.
  Do NOT touch specs/awsf-v2-plan.html. Only T23 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to
  their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task did it, or must absorb because it could not
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt. Append nothing if there is nothing; an empty Handoff is a real answer.
```

### T11 — Rounds - generalising the compiler from one pass to R

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     One emission has to serve two commands without becoming two code paths that merely
          look alike; the byte-identity assertion is what keeps them one.

TASK 11 of 23. Plan: specs/awsf-v2-w10-mf-adapter.html, milestone M4.
PREDECESSORS: T10 is [x], so milestone M3 is [x].
  NOT gated by G10-B. Debate needs nothing from the routing work, which is why it sits before
  the merge gate rather than after it.

READ FIRST
  specs/awsf-v2-w10-mf-adapter.html - milestone M4 IN FULL, including the cost table, and
    Questionable Q8 and its 2026-09-15 amendment
  core/src/workflow/fusion/compile.ts and roster.ts - what T07 built; this generalises it
  core/src/state/tiers.ts - MAX_CALL_CEILING = 20 and why the bound is in code, not config
  core/src/workflow/compiler.ts - compileWorkflowStructure and minimumCalls

DO
  Add a round count to the roster contract, defaulting to 1, refused below 1 and ABOVE 4.
    Four is where the largest roster the tool can express (5 models) reaches MAX_CALL_CEILING
    exactly at 20 calls, so a fifth round could never be admitted for any roster; refusing it
    by name in the contract beats refusing it by arithmetic three layers down.
  Add compileDebate(roster, question) emitting R x N opinion phases and R host composers, with
    phase ids carrying BOTH the round and the slot, so round 2's model A is distinguishable
    from round 1's in every record that names a phase.
  Assert minimumCalls === R x N for every cell of the plan's cost table. Composers contribute
    zero.
  Prove the two commands are ONE emission: a debate at R = 1 with a fusing phase appended must
    be byte-identical to the fusion recipe for the same roster. Assert it.
  Admit the compiled debate by digest. Do not register it.

DO NOT
  Do not add a judge, a summariser, or a final merge phase. The command is an N-way debate with
    no judge; the absence is the feature, and a plausible "just summarise it at the end" turns
    it into a fusion with extra rounds.
  Do not fork compileFusion into a near-copy. If the two cannot share one emission, say so in
    the Handoff rather than shipping two generators that drift.
  Do not change MAX_CALL_CEILING. Five models over four rounds is exactly 20, so no roster the
    tool can express could ever need it raised - that is a property worth asserting, not a
    constraint worth relaxing.

DONE WHEN
  npm run test:unit - green at the base SHA before any change, count recorded
  npm run test:unit - every cell of the R x N table compiles to the stated minimumCalls
  npm run test:unit - the R = 1 byte-identity assertion passes and has been seen to fail once
  npm run test:unit - a fifth round is refused by the roster contract, by name, before compiling
  npm run typecheck and npm run lint - clean

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (fusion, contracts, compiler, budget,
  routing, config), never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the
  body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w10-mf-adapter.html, on this task and every task:
  the task's `<code class="status">` checklist items, [] -> [x] (or [f] with the reason).
  Do NOT flip this milestone's <h3> header - its last task does that.
  Do NOT touch specs/awsf-v2-plan.html. Only T23 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to
  their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task did it, or must absorb because it could not
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt. Append nothing if there is nothing; an empty Handoff is a real answer.
```

### T12 — The debate contract, and the proof that nobody writes

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT medium
  CLAUDE  claude:opus · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  WHY     The strictest recipe this factory can compile; the care is in asserting the absence
          rather than inferring it from a missing phase.

TASK 12 of 23. Plan: specs/awsf-v2-w10-mf-adapter.html, milestone M4.
PREDECESSORS: T11 is [x].

READ FIRST
  specs/awsf-v2-w10-mf-adapter.html - milestone M4 task 12, and INV-2 in the Identifier Spine
  core/src/contracts/opinion-output.ts and fusion-context.ts - what T04 and T08 built
  core/src/workflow/compiler.ts - reviewBuildPhaseId, and what it returns with no build producer
  prompts/opinion/ - the read-only contract a debate round reuses

DO
  Reuse the fusion composer's envelope contract for each round's composition: every position
    with its slot id, provider and digest. One contract serves both commands.
  Tell a round-2 model plainly, in the prompt, that it is reading POSITIONS rather than
    instructions - a model handed three confident paragraphs will otherwise treat them as a
    brief.
  Assert a compiled debate has ZERO phases declaring a non-empty writes, at every N and every R.
  Assert a compiled debate carries no awsf.build-output/v1 phase, so reviewBuildPhaseId returns
    null and a debate can never carry a review phase. That is correct: there is no candidate to
    review.
  Assert the final round's composition is the output and that no phase follows it.

DO NOT
  Do not let a debate produce a candidate, a diff, or an artifact claim. If a debate could
    write, it would be a fusion whose merge step was performed by whichever model went last.
  Do not give a debate a review phase to "check the positions". There is nothing to invert
    against and no candidate to audit.
  Do not reuse the fusion prompt for a debate round. The fuser is told it is the only writer;
    a debate round must be told the opposite.

DONE WHEN
  npm run test:unit - green at the base SHA before any change, count recorded
  npm run test:unit - the zero-writer assertion passes at every N and R, seen to fail once
  npm run test:unit - reviewBuildPhaseId returns null for every compiled debate
  npm run test:unit - nothing follows the final composition, asserted
  npm run typecheck and npm run lint - clean

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (fusion, contracts, compiler, budget,
  routing, config), never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the
  body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w10-mf-adapter.html, on this task and every task:
  the task's `<code class="status">` checklist items, [] -> [x] (or [f] with the reason).
  Do NOT flip this milestone's <h3> header - its last task does that.
  Do NOT touch specs/awsf-v2-plan.html. Only T23 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to
  their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task did it, or must absorb because it could not
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt. Append nothing if there is nothing; an empty Handoff is a real answer.
```

### T13 — Testing Strategy - M4

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT medium
  CLAUDE  claude:opus · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  WHY     Closing a milestone, with the ceiling refusal proven at both boundaries that matter.

TASK 13 of 23. Plan: specs/awsf-v2-w10-mf-adapter.html, milestone M4.
PREDECESSORS: T11 and T12 are [x].

READ FIRST
  specs/awsf-v2-w10-mf-adapter.html - milestone M4 IN FULL
  core/test/journeys/ - the zero-quota journey shape
  core/src/adapters/stub.ts - the fixture route

DO
  Add a journey running a 2-model 2-round debate end to end on the FIXTURE route: four phase
    results, two compositions, zero quota. Two-by-two is the only debate that fits the shipped
    T2 ceiling of 5, so it is also the only one a default-configured factory can run.
  Prove the ceiling refusal at both ends: a 5-model 4-round debate compiles at a resolved
    ceiling of 20 and is refused at 19 naming the shortfall.
  Write the milestone-closing Amendment for M4. Record what the debate cost table looks like
    against the SHIPPED ceiling, so the owner sees that every debate beyond two-by-two is a
    deliberate act with a raised ceiling behind it.

DO NOT
  Do not spend quota. Every row here runs on the fixture route.
  Do not start milestone M5 in this session, and check G10-B first - M5 is the milestone the
    task3.5 merge blocks.
  Do not flip specs/awsf-v2-plan.html's W10 marker.

DONE WHEN
  npm run test:unit - the 2x2 debate journey runs end to end on the stub route with zero quota
  npm run test:unit - the ceiling refusal fires at 19 and passes at 20
  npm run test:unit - whole suite green, count recorded
  npm run typecheck and npm run lint - clean
  The M4 Amendment exists and prices every debate against the shipped ceiling

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (fusion, contracts, compiler, budget,
  routing, config), never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the
  body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w10-mf-adapter.html, on this task and every task:
  the task's `<code class="status">` checklist items, [] -> [x] (or [f] with the reason).
  This is the LAST task of milestone M4: also flip that milestone's <h3> header to [x]
  and every remaining checklist box in it.
  THEN append an Amendment to specs/awsf-v2-w10-mf-adapter.html recording the CLOSE of M4:
    - what the milestone accomplished, in terms of what is now observably true
    - every task in it and its final state, naming any [f] row and the block that holds it
    - the friction it hit: what took longer than the plan expected, what the plan got wrong,
      what a later milestone must now do differently because of it
    - the decisions made inside the milestone that the plan did not already carry
    - the landing commit SHA(s) and the suite counts at close
  Append the modified date to the metadata header in the same commit.
  Do NOT touch specs/awsf-v2-plan.html. Only T23 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to
  their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task did it, or must absorb because it could not
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt. Append nothing if there is nothing; an empty Handoff is a real answer.
```

### T14 — The roster's per-phase route surface

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     It must consume the existing route resolver rather than grow a second one, and the
          file it edits is the one the pending merge changes most.

TASK 14 of 23. Plan: specs/awsf-v2-w10-mf-adapter.html, milestone M5.
PREDECESSORS: T07 is [x], and G10-B has landed - main and task3.5 are MERGED.
  Milestone M4 precedes this one in the plan but does not block it: debate needs nothing from
  the routing work, and this task needs nothing from debate.

READ FIRST
  specs/awsf-v2-w10-mf-adapter.html - milestone M5 IN FULL, including the G10-B card
  core/src/workflow/phase-routing.ts - requestedPhaseRoute, effectivePhaseRoute,
    routeSelectionProvenance and retainedRolePolicy (POST-MERGE; this file arrives with the
    task3.5 merge and does not exist on main)
  core/src/contracts/route-selection.ts - RequestedRouteProvenance, EffectiveRouteProvenance,
    ObservedRouteProvenance and how the three compose
  core/src/config/schema.ts - PhaseRouteSelectionSchema and routing.phase_routes
  core/src/adapters/pi-codex.ts - SAFE_MODEL_SELECTOR at :119 and its rationale IN FULL

DO
  Resolve every opinion phase's route through the EXISTING requestedPhaseRoute /
    effectivePhaseRoute pair. A slot's explicit provider assertion that disagrees with the
    adapter's reported provider is a refusal, never a fallback.
  Assert every fusion phase carries a full RouteSelectionProvenance - requested, effective, and
    observed after the turn - and that all N + 1 are DISTINCT records rather than one repeated.
  Assert role policy is retained: a routed opinion slot changes only model, effort and the
    adapter/provider pair, and retainedRolePolicy confirms prompt, tools, writes, continuity,
    purpose and colour are reference-identical to the configured role.
  Put one line in the plan and in this task's commit body that a reader cannot miss:
    phase_routes is durable config in a PROTECTED file, so an N-slot roster is an
    owner-authored commit, not a command-line flag.

DO NOT
  Do not relax SAFE_MODEL_SELECTOR in pi-codex.ts to reach a second provider. Its comment
    explains exactly why the slash is refused: pi --model accepts a provider/id form, so a
    slash names a second provider from inside a flag already told which provider to use, and
    --provider loses. A different provider through the same binary is a different adapter,
    which is W16.
  Do not add a second routing surface. A roster expressed anywhere but through the existing
    resolver is a second answer to "which model runs this phase", and the two drift apart at
    the first change.
  Do not edit awsf.config.yaml. Adding phase_routes entries is an owner act.

DONE WHEN
  npm run test:unit - green at the base SHA before any change, count recorded
  npm run test:unit - N + 1 distinct route-provenance records for an N-slot fusion, each with
    requested, effective and observed populated
  npm run test:unit - retainedRolePolicy holds for every routed opinion slot
  npm run test:unit - a disagreeing provider assertion refuses rather than falling back
  npm run typecheck and npm run lint - clean

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (fusion, contracts, compiler, budget,
  routing, config), never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the
  body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w10-mf-adapter.html, on this task and every task:
  the task's `<code class="status">` checklist items, [] -> [x] (or [f] with the reason).
  Do NOT flip this milestone's <h3> header - its last task does that.
  Do NOT touch specs/awsf-v2-plan.html. Only T23 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to
  their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task did it, or must absorb because it could not
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt. Append nothing if there is nothing; an empty Handoff is a real answer.
```

### T15 — Inversion against the fuser, and a refusal that names the third provider

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     Review independence is the constraint most likely to be quietly weakened, and this
          task has to improve a refusal without taking a decision that belongs elsewhere.

TASK 15 of 23. Plan: specs/awsf-v2-w10-mf-adapter.html, milestone M5.
PREDECESSORS: T14 is [x].

READ FIRST
  specs/awsf-v2-w10-mf-adapter.html - "Review independence once several providers have touched
    the work" in the Solution section IN FULL, and Questionable Q3
  specs/awsf-v2-w16-openrouter-adapter.html - its M4 milestone and the inversion Questionable.
    THAT WORKSTREAM OWNS THE THREE-PROVIDER DECISION. This task inherits it.
  core/src/workflow/review-routing.ts POST-MERGE - providerPairFrom at :36, oppositeProvider,
    runMandatoryReview, and the same-provider-degraded mode task3.5 adds
  core/src/cli/commands/production-run.ts - the inversion block around :1140-1170

DO
  Prove the reviewer is selected by exclusion from the FUSING phase's provider, not from any
    opinion's - the fuser is the recipe's single build producer and it authored the candidate.
  Prove that a provider which gave an opinion may still review, when it is not the fuser, and
    say in a comment why that is the honest rule: an opinion is an input the fuser consumed and
    may have discarded, not the authorship of the candidate.
  Run a two-provider fusion at N = 2 with a review phase end to end on the stub route.
  Make the three-provider refusal NAME THE THIRD PROVIDER AND THE PHASE IT CAME FROM, rather
    than reporting a count. Assert the message exactly.
  Assert a fusion recipe reaching runMandatoryReview passes no mode of its own, so the
    configured route decides.

DO NOT
  Do not widen providerPairFrom. W16's M4 owns that decision and calls it a Questionable rather
    than a task, for the same reason: two workstreams deciding one rule is how the rule ends up
    with two answers.
  Do not select same-provider-degraded from this recipe, ever, and do not select it as a
    fallback from a transport failure. It exists to be named explicitly in durable config.
  Do not add a substitute reviewer, a fallback provider, or a retry beyond the one the shipped
    route already holds.

DONE WHEN
  npm run test:unit - green at the base SHA before any change, count recorded
  npm run test:unit - inversion keys off the fusing phase, proven by a test that fails if it
    keys off an opinion
  npm run test:unit - the N = 2 fusion with a review passes inversion end to end on the stub route
  npm run test:unit - the three-provider refusal names its culprit, asserted on the exact message
  npm run typecheck and npm run lint - clean

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (fusion, contracts, compiler, budget,
  routing, config), never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the
  body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w10-mf-adapter.html, on this task and every task:
  the task's `<code class="status">` checklist items, [] -> [x] (or [f] with the reason).
  Do NOT flip this milestone's <h3> header - its last task does that.
  Do NOT touch specs/awsf-v2-plan.html. Only T23 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to
  their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task did it, or must absorb because it could not
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt. Append nothing if there is nothing; an empty Handoff is a real answer.
```

### T16 — Testing Strategy - M5

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT medium
  CLAUDE  claude:opus · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  WHY     Closing a milestone against a freshly merged tree; the risk is a fence that passed
          before the merge and does not after.

TASK 16 of 23. Plan: specs/awsf-v2-w10-mf-adapter.html, milestone M5.
PREDECESSORS: T14 and T15 are [x].

READ FIRST
  specs/awsf-v2-w10-mf-adapter.html - milestone M5 IN FULL
  core/test/unit/meta/quota-fence.test.ts - its transitive leg and the named route functions

DO
  Confirm every M5 assertion passes against the POST-MERGE tree, not against a pre-merge
    recollection of it.
  Confirm the quota fence still passes with the new workflow modules present, including its
    transitive leg and its semantic check of the named route resolvers.
  Write the milestone-closing Amendment for M4. Record which of W16 M4's answers the owner has
    taken, if any, and leave it stated as open if none has been.

DO NOT
  Do not start milestone M6 in this session. Collaborate is the most expensive milestone in
    this plan and the one whose earlier refusal was withdrawn, so it begins deliberately.
  Do not flip specs/awsf-v2-plan.html's W10 marker.

DONE WHEN
  npm run test:unit - whole suite green against the post-merge tree, count recorded
  npm run typecheck and npm run lint - clean
  The quota fence passes, transitive leg included
  The M5 Amendment exists and states the W16 inversion decision or records it as still open

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (fusion, contracts, compiler, budget,
  routing, config), never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the
  body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w10-mf-adapter.html, on this task and every task:
  the task's `<code class="status">` checklist items, [] -> [x] (or [f] with the reason).
  This is the LAST task of milestone M5: also flip that milestone's <h3> header to [x]
  and every remaining checklist box in it.
  THEN append an Amendment to specs/awsf-v2-w10-mf-adapter.html recording the CLOSE of M5:
    - what the milestone accomplished, in terms of what is now observably true
    - every task in it and its final state, naming any [f] row and the block that holds it
    - the friction it hit: what took longer than the plan expected, what the plan got wrong,
      what a later milestone must now do differently because of it
    - the decisions made inside the milestone that the plan did not already carry
    - the landing commit SHA(s) and the suite counts at close
  Append the modified date to the metadata header in the same commit.
  Do NOT touch specs/awsf-v2-plan.html. Only T23 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to
  their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task did it, or must absorb because it could not
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt. Append nothing if there is nothing; an empty Handoff is a real answer.
```

### T17 — The delegation plan contract

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     Everything stage two needs must be in this envelope, because the envelope is the only
          thing a resume still has. A missing field here is discovered at recovery time.

TASK 17 of 23. Plan: specs/awsf-v2-w10-mf-adapter.html, milestone M6.
PREDECESSORS: T16 is [x], so milestone M5 is [x].

READ FIRST
  specs/awsf-v2-w10-mf-adapter.html - milestone M6 IN FULL, especially the paragraph explaining
    which earlier objection was withdrawn and why, plus INV-5, INV-6 and AC-10
  Questionable Q9 IN FULL - DECIDED 2026-09-15 as TWO TASKS, two ceilings, and it corrected a
    wrong clause in its own recommendation. Read the correction: the journal does NOT make an
    envelope addressable across tasks.
  core/src/contracts/candidate-adoption.ts IN FULL - the only mechanism that crosses a task
    boundary. It carries GIT OBJECTS ONLY: sourceEvidenceCopied is Literal(false),
    sourceApprovalsCopied is Literal(false), and the header says it never copies a source
    envelope. This is why the plan travels as a committed file rather than as an envelope.
  core/src/contracts/opinion-output.ts, fusion-context.ts - the envelope patterns to follow
  core/src/contracts/envelope-base.ts - ENVELOPE_BASE_PROPERTIES and the spread convention
  specs/awsf-v2-w17-shift.html - its manifest contract; this is the same manifest-to-recipe
    shape with the manifest written by a model instead of read off tickets

DO
  Add core/src/contracts/delegation-plan.ts declaring awsf.delegation-plan/v1: an ordered set of
    tasks, each with a stable id, a statement of work, the slot it is delegated to, its declared
    dependencies, and whether it writes.
  Build stage one as a compiled recipe: N read-only planning phases plus ONE read-only architect
    merge phase. minimumCalls = N + 1, and no phase in it writes.
  Give the architect phase the read-only role, not a builder role. It proposes the delegation
    and implements none of it.
  Journal the emitted plan as a validated envelope before anything reads it, AND write the
    validated plan into the worktree so the host can commit it as stage one's candidate. The
    COMMITTED BLOB is what crosses to task two; the journal row is the within-task record.
  Add a test that reconstructs the plan from the committed file alone, with no journal access -
    that is the exact reading stage two will do.

DO NOT
  Do not let the architect phase write. A phase that can both decide the work and do the first
    piece of it is the delegation this plan's owner act exists to interrupt.
  Do not put anything in stage two's path that is not in this file. If stage two needs a fact,
    it belongs in the committed plan; a fact read from live state or from a journal row at
    compile time breaks INV-5 the moment the run is resumed in another task.
  Do not extend seed/adopt to carry an envelope. Those two Literal(false) fields are the
    contract's whole design statement, and the committed-file route needs no change to them.

DONE WHEN
  npm run test:unit - green at the base SHA before any change, count recorded
  npm run test:unit - stage one compiles with minimumCalls = N + 1 and no writing phase
  npm run test:unit - the delegation plan validates, and is reconstructable from the COMMITTED
    file alone, with no journal access
  npm run typecheck and npm run lint - clean

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (fusion, contracts, compiler, budget,
  routing, config), never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the
  body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w10-mf-adapter.html, on this task and every task:
  the task's `<code class="status">` checklist items, [] -> [x] (or [f] with the reason).
  Do NOT flip this milestone's <h3> header - its last task does that.
  Do NOT touch specs/awsf-v2-plan.html. Only T23 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to
  their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task did it, or must absorb because it could not
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt. Append nothing if there is nothing; an empty Handoff is a real answer.
```

### T18 — The validator - acyclic, declared, and one writer per task

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     A model proposed this graph, so every property stage two depends on has to be checked
          rather than assumed; graph validation is where a plausible shortcut costs correctness.

TASK 18 of 23. Plan: specs/awsf-v2-w10-mf-adapter.html, milestone M6.
PREDECESSORS: T17 is [x].

READ FIRST
  specs/awsf-v2-w10-mf-adapter.html - milestone M6 task 18, and AC-11 IN FULL
  core/src/workflow/fusion/roster.ts - the refusal style this follows: one named error per way
    a thing can be wrong, never a generic "invalid"
  core/src/workflow/compiler.ts - InvalidPhaseDefinition and how construction-time refusals read

DO
  Refuse a graph that is not acyclic, and NAME THE CYCLE rather than reporting that one exists.
  Refuse a dependency naming a task id that is not in the same plan, by name.
  Refuse a task delegated to a slot the roster does not declare, by name.
  Enforce that the flattened topological order never places two writers where one has not
    finished. Under AWSF's sequential phase loop this is the whole of "exactly one writer at a
    time", and it needs no lease and no token to hold.
  Assert every refusal costs nothing: no reservation created, no process in existence.
  Build the fixture graph set the Testing Strategy task will reuse: a chain, a fan-out, a
    diamond, a cycle, a dangling dependency, and two writers.

DO NOT
  Do not write a scheduler. The graph is FLATTENED to a topological order and the existing
    sequential phase loop runs it. A scheduler that executes tasks as dependencies clear would
    be a concurrency this factory does not have, and getting one would need a second spawn
    discipline beside the broker's.
  Do not add a writer lease or a lock file. The ordering is the guarantee.
  Do not repair a bad graph. A cycle is a refusal, not something to break by dropping an edge -
    the architect gets told, and the owner sees it.

DONE WHEN
  npm run test:unit - green at the base SHA before any change, count recorded
  npm run test:unit - every fixture graph compiles to the expected order or is refused by its
    own named error, and the cycle refusal names the cycle
  npm run test:unit - the two-writer graph is refused, and every refusal creates no reservation
  npm run typecheck and npm run lint - clean

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (fusion, contracts, compiler, budget,
  routing, config), never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the
  body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w10-mf-adapter.html, on this task and every task:
  the task's `<code class="status">` checklist items, [] -> [x] (or [f] with the reason).
  Do NOT flip this milestone's <h3> header - its last task does that.
  Do NOT touch specs/awsf-v2-plan.html. Only T23 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to
  their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task did it, or must absorb because it could not
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt. Append nothing if there is nothing; an empty Handoff is a real answer.
```

### T19 — Stage two, and the owner act between the stages

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     The stop between the stages is the whole of INV-6, and a stop that is documented
          rather than proven is not a stop.

TASK 19 of 23. Plan: specs/awsf-v2-w10-mf-adapter.html, milestone M6.
PREDECESSORS: T17 and T18 are [x].

READ FIRST
  specs/awsf-v2-w10-mf-adapter.html - milestone M6 task 19, INV-6, AC-10, and Questionable Q9
    IN FULL including its correction
  core/src/cli/commands/seed.ts IN FULL - especially :39, which refuses a non-interactive
    terminal. THIS IS INV-6, already enforced. You assert it; you do not build it.
  core/src/contracts/candidate-adoption.ts - what seed carries, and what it refuses to carry
  core/src/state/tiers.ts - the comment saying committed is TASK-lifetime, not attempt-lifetime.
    This is what made Q9 a real choice: two stages in one task would share one ceiling.
  core/src/state/task-machine.ts - AWAITING_OWNER and the acts that leave it
  core/src/workflow/fusion/compile.ts - T07's digest and two-process reproducibility test, which
    this reuses rather than reinvents

DO
  Add compileDelegation(plan, roster) emitting one agent phase per task in topological order
    plus one integration phase. Pure: it reads the COMMITTED PLAN OUT OF THE SEEDED TREE and the
    roster, nothing else. Not a journal row - stage two is a different task and cannot reach
    stage one's journal.
  Prove reproducibility the same way T07 did: compile twice across a process boundary from the
    same committed plan, compare bytes, and check the binding digest against the blob.
  End stage one at AWAITING_OWNER with the delegation plan rendered for reading. Stage two is a
    SEPARATE TASK seeded from stage one's candidate.
  Assert seed's existing refusal rather than rebuilding it: seed.ts:39 already throws
    CandidateSeedRejected("requires an interactive owner terminal"). That is INV-6, shipped.
  Assert NO code path compiles stage two from a provider turn, or from a journal row the seeded
    tree does not carry. The committed plan is the only input.
  Inherit the one-writer property from T18's validator rather than re-checking it differently
    here - two checks of one rule is how the rule ends up with two answers.
  Prove the lineage question the decision costs: "which plan did this run execute" is answered
    by the seeded candidate SHA, not by a task id. Assert it rather than assuming it.

DO NOT
  Do not let stage two start without the owner act. A model deciding what work happens next and
    then doing it unattended is a larger delegation than anything this factory currently does,
    and the stop is the difference.
  Do not compile stage two from the architect's live response, and do not reach for stage one's
    journal. The committed plan in the seeded tree is the input.
  Do not extend seed or adopt to carry an envelope. sourceEvidenceCopied: Literal(false) is the
    contract's design statement, and the committed-file route needs no change to it.
  Do not build an owner gate. seed already is one, and a second one would be a weaker guarantee
    beside a stronger one that was not read.
  Do not let a collaboration raise its own ceiling. awsf raise requires an interactive terminal
    by design, and the two-task split exists so neither stage needs a raise the other bought.

DONE WHEN
  npm run test:unit - green at the base SHA before any change, count recorded
  npm run test:unit - stage two's two-process reproducibility test passes, seen to fail once by
    perturbing one byte of the committed plan
  npm run test:unit - seed's non-interactive refusal is asserted, and stage two has no other
    route in
  npm run test:unit - no code path compiles stage two from a provider turn or from stage one's
    journal, asserted
  npm run typecheck and npm run lint - clean

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (fusion, contracts, compiler, budget,
  routing, config), never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the
  body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w10-mf-adapter.html, on this task and every task:
  the task's `<code class="status">` checklist items, [] -> [x] (or [f] with the reason).
  Do NOT flip this milestone's <h3> header - its last task does that.
  Do NOT touch specs/awsf-v2-plan.html. Only T23 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to
  their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task did it, or must absorb because it could not
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt. Append nothing if there is nothing; an empty Handoff is a real answer.
```

### T20 — Testing Strategy - M6

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     Closing the most expensive milestone in the plan, and the one whose earlier refusal
          was withdrawn - so it carries the least prior thought and deserves the most checking.

TASK 20 of 23. Plan: specs/awsf-v2-w10-mf-adapter.html, milestone M6.
PREDECESSORS: T17, T18 and T19 are [x].

READ FIRST
  specs/awsf-v2-w10-mf-adapter.html - milestone M6 IN FULL
  The fixture graph set T18 built
  core/test/journeys/ - the zero-quota journey shape

DO
  Run every fixture graph: each either compiles to the expected order or is refused by its own
    named error.
  Add a two-stage collaboration journey on the FIXTURE route, end to end, zero quota, stopping
    at the owner act between the stages.
  Prove the owner stop STOPS: seed refuses a non-interactive terminal and stage two has no
    other route in. Documented stopping is not proven stopping.
  Write the milestone-closing Amendment for M6. Record: what the two-task split cost in
    practice versus what Q9 predicted, whether the committed-plan route held up under recovery,
    and what the earlier withdrawn objection cost in rework - that last one is the entry a later
    session will actually use.

DO NOT
  Do not spend quota. Every row runs on the fixture route.
  Do not start milestone M7 in this session. It is the only milestone that spends quota.
  Do not flip specs/awsf-v2-plan.html's W10 marker.

DONE WHEN
  npm run test:unit - every fixture graph behaves as specified
  npm run test:unit - the two-stage journey runs end to end on the stub route with zero quota
  npm run test:unit - the owner stop is proven to stop
  npm run test:unit - whole suite green, count recorded
  npm run typecheck and npm run lint - clean
  The M6 Amendment exists and records what the two-task split cost against Q9's prediction, and
    the rework the withdrawn objection cost

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (fusion, contracts, compiler, budget,
  routing, config), never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the
  body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w10-mf-adapter.html, on this task and every task:
  the task's `<code class="status">` checklist items, [] -> [x] (or [f] with the reason).
  This is the LAST task of milestone M6: also flip that milestone's <h3> header to [x]
  and every remaining checklist box in it.
  THEN append an Amendment to specs/awsf-v2-w10-mf-adapter.html recording the CLOSE of M6:
    - what the milestone accomplished, in terms of what is now observably true
    - every task in it and its final state, naming any [f] row and the block that holds it
    - the friction it hit: what took longer than the plan expected, what the plan got wrong,
      what a later milestone must now do differently because of it
    - the decisions made inside the milestone that the plan did not already carry
    - the landing commit SHA(s) and the suite counts at close
  Append the modified date to the metadata header in the same commit.
  Do NOT touch specs/awsf-v2-plan.html. Only T23 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to
  their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task did it, or must absorb because it could not
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt. Append nothing if there is nothing; an empty Handoff is a real answer.
```

### T21 — One bounded two-provider live fusion

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     The only quota this workstream spends. One drive, recorded properly, is worth more
          than three taken casually.

TASK 21 of 23. Plan: specs/awsf-v2-w10-mf-adapter.html, milestone M7.
PREDECESSORS: T10, T13, T16 and T20 are [x], so milestones M3, M4, M5 and M6 are all [x].

READ FIRST
  specs/awsf-v2-w10-mf-adapter.html - milestone M7 IN FULL, and the tier/ceiling table
  core/test/fixtures/providers/ and its PROVENANCE.md convention - which bytes are captured
    and which are transformed
  AGENTS.md invariants 1, 9 and 10 - no live task state, no credential-shaped value, no
    runtime artifact, all committed-file rules this capture must satisfy

DO
  Check live quota on both routes before starting. If either is thin, stop and say so rather
    than half-spending it.
  Run ONE live fusion: N = 2 on the two providers AWSF already reaches, at T2, with a review
    phase - four calls, inside the shipped ceiling of 5, needing no raise.
  Record each phase's provider, resolved model and cost as SEPARATE rows, so a reader can see
    which model said what and what each turn cost.
  Confirm the run-failure surface shows per-phase rows and no composite row anywhere.
  Land the captured evidence as a committed fixture with a PROVENANCE.md saying which bytes
    are captured and which are transformed. Strip every run id, session id and attempt id.
  Record what the drive cost in the Amendment - in calls, and in whatever the two routes can
    honestly say about money, which on a subscription route is nothing.

DO NOT
  Do not run a second drive to "confirm" the first. One bounded drive is the acceptance bar;
    a campaign is how an optional workstream spends a core one's quota.
  Do not attempt N greater than 2. AWSF reaches two providers without W16, and a third slot
    cannot be routed at all - pi-codex refuses a slash selector by design.
  Do not commit a run id, session id, attempt id or any credential-shaped value. Invariant 1
    keeps live task state out of every committed file; invariant 9 has a meta-test.
  Do not claim a cost figure either subscription route cannot support. Neither can say what a
    run actually cost, and a number that looks measured is worse than none.

DONE WHEN
  One live fusion completed: two opinions, host composition, one fused candidate, one inverted review
  Per-phase provider, resolved model and cost each recorded separately
  The run-failure surface shows per-phase rows and no composite row
  The fixture is committed with its PROVENANCE.md and carries no live task state
  npm run test:unit, npm run typecheck and npm run lint - all clean

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (fusion, contracts, compiler, budget,
  routing, config), never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the
  body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w10-mf-adapter.html, on this task and every task:
  the task's `<code class="status">` checklist items, [] -> [x] (or [f] with the reason).
  Do NOT flip this milestone's <h3> header - its last task does that.
  Do NOT touch specs/awsf-v2-plan.html. Only T23 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to
  their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task did it, or must absorb because it could not
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt. Append nothing if there is nothing; an empty Handoff is a real answer.
```

### T22 — Retire composite-fusion, or record why it stays

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT medium
  CLAUDE  claude:opus · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  WHY     A removal across several files with one half behind a protected-config gate; the
          judgement is in not starting the code half before the owner's half lands.

TASK 22 of 23. Plan: specs/awsf-v2-w10-mf-adapter.html, milestone M7.
PREDECESSORS: T21 is [x].

READ FIRST
  specs/awsf-v2-w10-mf-adapter.html - milestone M7 task 22, the G10-C card, and Questionable Q4
  core/src/config/schema.ts - KNOWN_ADAPTER_KINDS at :23 and the comment naming adapters/fusion.ts
  core/src/adapters/registry.ts - the composite-fusion case returning null, calling it v1.1 scope
  core/src/quota/routes.ts - every composite-fusion branch and its two reason codes
  awsf.config.yaml - adapters.fusion, declared and disabled
  core/test/unit/quota/routes.test.ts - the tests that cover the composite branches

DO
  Check G10-C FIRST: has the owner removed the adapters.fusion entry from awsf.config.yaml as
    their own commit? If NOT, stop here, say so, and leave this task at [] rather than starting
    the code half - load.ts validates adapter kinds against KNOWN_ADAPTER_KINDS, so removing
    the kind while the config still declares it breaks config load.
  State the evidence plainly in the commit body: registry.ts returns null for the kind and
    calls it v1.1 scope, the adapters/fusion.ts its schema comment names has never existed, the
    config declared it disabled, and under the chosen fork no composite adapter is ever
    constructed.
  Drop composite-fusion from KNOWN_ADAPTER_KINDS, remove the adapters/fusion.ts sentence from
    the schema comment, and remove registry.ts's dead case.
  Remove core/src/quota/routes.ts's composite branches and their two reason codes, and REMOVE
    rather than skip the tests that covered them.
  If the owner chose to KEEP the declaration: record that with its reason and close this row
    [f]. That is a legitimate answer, not a failure.

DO NOT
  Do not edit awsf.config.yaml. path-policy rejects protected-path independently of the write
    globs, and inventing an owner-authorized protected-change mechanism to route around it is
    the boundary working, not a bug.
  Do not skip a test that covered removed code. A skipped test is a claim nobody is checking;
    delete it with the code it covered.
  Do not remove the code half before the config half. The order matters and it is one way only.

DONE WHEN
  G10-C has landed, or this task is left at [] with the reason stated
  npm run test:unit - green after the removal, count recorded, with no skipped test left behind
  npm run typecheck and npm run lint - clean
  No reference to composite-fusion remains in core/src/, or the [f] row records why it does

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (fusion, contracts, compiler, budget,
  routing, config), never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the
  body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w10-mf-adapter.html, on this task and every task:
  the task's `<code class="status">` checklist items, [] -> [x] (or [f] with the reason).
  Do NOT flip this milestone's <h3> header - its last task does that.
  Do NOT touch specs/awsf-v2-plan.html. Only T23 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to
  their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task did it, or must absorb because it could not
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt. Append nothing if there is nothing; an empty Handoff is a real answer.
```

### T23 — Testing Strategy - M7, and the workstream close

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     The only ticket that writes to the spine, and the one that has to be honest about
          whether this optional workstream graduated or closed with a gap.

TASK 23 of 23. Plan: specs/awsf-v2-w10-mf-adapter.html, milestone M7.
PREDECESSORS: T10, T13, T16, T20, T21 and T22 are [x] or [f] with a recorded reason.

READ FIRST
  specs/awsf-v2-w10-mf-adapter.html IN FULL, especially the Identifier Spine and the
    Validation Commands section
  specs/awsf-v2-plan.html - section Milestone M10 / W10 IN FULL, including every checklist row
  specs/tickets/awsf-v2-plan/W10.md
  core/test/unit/meta/ticket-plan-sync.test.ts - the fence that will check what you write

DO
  Walk the plan's Validation Commands list and run every row. Record the result of each.
  Confirm every AC row in the Identifier Spine is asserted by a NAMED test, and every INV row
    by a named test or meta-test. List them in the closing Amendment by file and test name.
  Confirm the suite is green and no test added by this workstream is skipped.
  Then take the close decision, and take it honestly:
    - GRADUATED: every plan marker reads [x] or [f] with a recorded block, and the live drive
      in T14 produced per-phase attribution. Flip the spine.
    - CLOSED UNBUILT: a milestone could not produce its evidence. Do NOT flip the spine marker.
      Record the evidence gap by name in the spine Amendment and leave W10 at []. The spine
      already sanctions this outcome and it is not a failure.
  Write both Amendments as the MARKERS block below specifies.

DO NOT
  Do not flip the spine marker on a green suite alone. The suite is not the acceptance bar for
    this workstream; T14's one bounded live drive is, and per-phase attribution is what it had
    to show.
  Do not claim per-role supervision the broker never saw. Every guarantee this workstream
    claims must name the registration, the reservation or the envelope that carries it.
  Do not leave a checklist row unchecked and unmarked. [f] with a named block is an answer; a
    blank box is not.

DONE WHEN
  Every row in the plan's Validation Commands section is run and its result recorded
  npm run test:unit - whole suite green at the closing SHA, count recorded
  npm run typecheck and npm run lint - clean
  node --test core/test/unit/meta/ticket-plan-sync.test.ts - this plan, its build-prompts file
    and its ticket set agree, byte-identity leg and identifier-spine mirror included
  Every AC and INV is named against the test that asserts it, in the closing Amendment
  The spine is flipped, or the evidence gap is recorded and the spine marker is left at []

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (fusion, contracts, compiler, budget,
  routing, config), never a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the
  body, and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w10-mf-adapter.html, on this task and every task:
  the task's `<code class="status">` checklist items, [] -> [x] (or [f] with the reason).
  This is the LAST task of milestone M7 AND of the whole plan. Do 7a for M7
  first: flip its <h3> to [x], flip every remaining checklist box, and append the
  milestone-closing Amendment to specs/awsf-v2-w10-mf-adapter.html.
  THEN, once every marker in specs/awsf-v2-w10-mf-adapter.html reads [x] or [f], and IN THE SAME COMMIT:
    - flip specs/awsf-v2-plan.html section Milestone M10 / W10's <h3> marker and its
      checklist to [x]
    - flip specs/tickets/awsf-v2-plan/W10.md's `state:` to done
    - append an Amendment to specs/awsf-v2-plan.html recording the CLOSE of W10: what it
      delivered against the spine's claim for it claim by claim, which spine Questionables it
      resolved and how, the friction and surprises a later workstream now inherits, anything
      it routed elsewhere rather than building, every row that closed [f] with the block that
      holds it, the landing SHA and this plan's final suite counts
  This is the ONLY ticket that writes to specs/awsf-v2-plan.html.
  IF THE WORKSTREAM CLOSED UNBUILT instead: do NOT flip the spine marker. Record the evidence
  gap by name in the spine Amendment and leave W10 at []. The spine already sanctions this and
  it is not a failure.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to
  their `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task did it, or must absorb because it could not
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which
  source wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their
  build prompt. Append nothing if there is nothing; an empty Handoff is a real answer.
```
