# AWSF v3 W03 — Ticket closure: build prompts

> **Plan:** [`awsf-v3-w03-ticket-closure.html`](awsf-v3-w03-ticket-closure.html) · **Spine:** [`awsf-v3-plan.html`](awsf-v3-plan.html) § Workstreams → Milestone M3 → W03
> **Tickets:** [`tickets/awsf-v3-w03-ticket-closure/`](tickets/awsf-v3-w03-ticket-closure/) — one file per task, each carrying the same prompt this file's Section B holds.

This file exists because this repository's invariant-12 fence requires it:
`core/test/unit/meta/ticket-plan-sync.test.ts` asserts a `<stem>-build-prompts.md` exists for every
plan source with a ticket set, and that each ticket's prompt is **byte-identical** to its
`### Tnn — ` block below.

# Section A — Conventions

**Read first, on every task.** `AGENTS.md` in full · `specs/awsf-v3-w03-ticket-closure.html`
(Problem, Solution with "Closure, defined" and "What a ticket asked for", the Identifier Spine and
Execution in full, then the task's own section) · `specs/tickets/awsf-v3-w03-ticket-closure/README.md`.

**What W03 is, in one line.** A landed task's markers and ticket state move together in one
owner-confirmed commit that can change nothing else; a light-tier ticket closes the same way; and
a new plan set enters only as new files, which retires gate GM.

**The property fixed regardless of design.** Whatever closes a ticket cannot change what that
ticket asked for.

**Execution.** M1 (T01, T02) is owner work under GA: a session may prepare the diff and its
evidence, and the owner commits it. M2–M7 are managed by default (spine decision 7): one
`build-review` attempt per ticket, tier derived by `awsf new`. K1 binds every start:
`awsf preflight`, the owner's `awsf confirm`, then `awsf start`. External prerequisites must have
landed. In an owner-approved accumulating shift, selected predecessors need host-committed,
gate-passing heads in that worktree, not separate canonical landings or marker changes mid-shift.
From T06's landing on, every W03 attempt is created with
`--plan awsf-v3-w03-ticket-closure --ticket Tnn`. Manual execution of M2–M7 is a logged exception.

**The builder's write boundary.** `core/src/**` outside protected paths, `core/test/**`,
`dashboard/**`, `prompts/**`, `docs/cheatsheet.html`. Never `specs/**`, `package.json`,
`AGENTS.md`, `awsf.config.yaml`, `awsf.project.yaml`, `core/src/state/**`, `core/src/policy/**`,
`core/src/observability/migrations/**`, `core/src/execution/transport-broker.ts`,
`docs/driving/**`, or a root `.claude/` directory.

**Owner gates.**
- **T01**, first: `specs/*.html` in `policy.protected_paths`, with the five-stage test
  adjustments and W03-Q9 in the same commit.
- **T02**, after T01, per W03-Q2: `specs/*-build-prompts.md` and `specs/tickets/*/**`.
- **G03-C**, after T08 and before T09: `close` wired as an owner act in `core/src/cli/main.ts`,
  `core/src/lifecycle/next-steps.ts`, the delegation guard, `OWNER_ACTS` and the driving
  documents, in one owner commit, as G01-C did for `confirm`.
- **G03-I**, before T11 (W03-Q5 took the flat store): invariant 12 names the light tier.
- **G03-W**, after T13: the `plan-author` role and workflow in `awsf.config.yaml`, and
  design-to-plan restored if W03-Q9 removed it.

**Closure, defined.** A closing commit differs from its parent only in status-token values
(`<code class="status">[v]</code>`, after-value `""`, `wip` or `x`) in registered plan files and the
frontmatter `state:` value (after-value `todo`, `wip` or `done`) in ticket files; no path is added,
removed, renamed or re-moded; and the result passes the invariant-12 agreement checks. Closure never
writes `[f]` or `failed`.

**What a ticket asked for.** A plan ticket: its build prompt block, `title`, `milestone`,
`depends_on`, `serves`, its task's checklist row texts with status tokens masked, and the plan's
declarations. A light ticket: every frontmatter field except `state`, and its body. Handoff sections
are excluded. Closure compares them at the attempt's base and at canonical HEAD, resolving files
through the registered plan source, never through a sealed path.

**Owner decisions.** W03-Q1–Q9 were decided on 2026-10-09, each as recommended. Every prompt
applies them; the plan's Questionables record each one.

**The never-do list**, with why each is tempting:
- **Do not widen any role's `writes` into `specs/`**, at any width. The sync fence checks that plan
  and tickets agree, never that either is unchanged.
- **Do not let closure write anything but status tokens and state values.** No Amendment, Handoff,
  metadata or prose, even "just a date".
- **Do not infer a landing's ticket** from a task id, a request or a directory. Only a sealed
  selection maps a landing.
- **Do not change `land` or its confirmation.** Closure follows a landing as its own owner act.
- **Do not let closure decide.** Every row it moves is shown and confirmed by the owner.
- **Do not reset, force, delete or push** (invariant 8), and do not commit with an agent identity
  or a trailer (invariant 11).
- **Do not exempt a modification** of an existing protected path. Admission creates, it never edits.
- **Do not edit `package.json`, a gate file, `AGENTS.md` or `docs/driving/**`.** They are the owner's.
- **Do not add a migration or a dependency** (invariants 6 and 7).
- **Never** put an agent, model or AI tool in a commit identity, message or trailer.

# Section B — Task prompts (recommended)

### T01 — Owner amendment: specs/*.html in policy.protected_paths

```
ROUTING
  Owner-authored. A manual session may prepare the diff and the evidence; the owner commits.
  Manual preparation: Opus 5.5 at medium, or codex:gpt-6-sol at medium, by live quota.

TASK 1 of 15. Plan: specs/awsf-v3-w03-ticket-closure.html, milestone M1, task 1.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Owner work under gate GA. Never selected into a shift and never run as a managed attempt: it
  edits a protected file. A preparing session works in a separate worktree and hands the owner a
  patch and its evidence.

PREDECESSORS
  The owner's approval of this deep plan. Nothing else in W03 starts until this lands.
  W03-Q9 decided.

BASELINE
  Run npm run test:unit at the base SHA before any change and record the count.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w03-ticket-closure-build-prompts.md
  specs/awsf-v3-w03-ticket-closure.html - Execution (the T01 card), Notes ("Measured while
    authoring"), W03-Q9
  specs/awsf-v2-plan-build-prompts.md - T15, "YOUR DEEP PLAN'S FIRST TASK IS FIXED IN ADVANCE"
  awsf.config.yaml - policy.protected_paths, workflows.enabled
  core/src/policy/path-policy.ts - globSource, evaluatePathPolicy
  core/test/journeys/five-stage.test.ts - the W11 file-list test and the design-to-plan stage

DO
  Add specs/*.html to policy.protected_paths in awsf.config.yaml. Change nothing else in that list.
  Apply W03-Q9 in the same commit: as recommended, remove design-to-plan from workflows.enabled.
  Adjust core/test/journeys/five-stage.test.ts in the same commit so it stays green: the W11
    changed-file test exempts plan files protected by a later amendment, naming this one, and the
    design-to-plan stage runs on a test configuration that drops specs/*.html, with a comment
    naming task 12 as the task that removes the exemption.
  Run npm run test:unit, npm run test:journeys, npm run test:traps, npm run typecheck and
    npm run lint on the commit's content, each alone, and record the counts.
  Record a path-policy check: a builder-shaped write to specs/awsf-v3-plan.html is refused with
    protected-path under the committed config.

DO NOT
  Add any other protected path here; T02 is its own commit (GA: one change at a time).
  Design or build any closure or admission mechanism in this commit.
  Widen any role's writes.

BUILDER READY
  The diff is the config lines, the five-stage adjustments and nothing else.
  Every listed command exits 0 on the commit's content.

OWNER ACCEPTANCE
  The owner reads the diff and the counts, and commits it as their own.

COMMIT
  Owner-authored, as Santiago Marin <santiagomarinsuarez@me.com>, with no trailer.
  Proposed: chore(config): protect plan files (W03 task 1)
  Body: the change, the measured breakage it repairs in the five-stage journey, the
  design-to-plan decision, the test counts.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side: task 1's rows in specs/awsf-v3-w03-ticket-closure.html and this ticket's state move
  together in one bookkeeping commit after this lands (invariant 12). Closure does not exist yet.

HANDOFF
  Dated findings for T02, T12 and T14: every test the amendment touched, the exemption's exact
  location, and the measured suite times. The owner copies them into those tickets' ## Handoff.
```

### T02 — Owner amendment: build prompts and paired ticket sets protected

```
ROUTING
  Owner-authored. A manual session may prepare the diff and the evidence; the owner commits.
  Manual preparation: Opus 5.5 at medium, or codex:gpt-6-sol at medium, by live quota.

TASK 2 of 15. Plan: specs/awsf-v3-w03-ticket-closure.html, milestone M1, task 2.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Owner work under gate GA. Never selected into a shift and never run as a managed attempt.

PREDECESSORS
  T01 landed. W03-Q2 decided as recommended; if the owner declined it, this task is removed from
  the plan by the review before anything starts.

BASELINE
  Run npm run test:unit at the base SHA before any change and record the count.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w03-ticket-closure-build-prompts.md
  specs/awsf-v3-w03-ticket-closure.html - Execution (the T02 card), W03-Q2
  awsf.config.yaml - the intake role's writes, policy.protected_paths
  core/src/cli/commands/production-run.ts - intake's ticket gate and plan-render's write

DO
  Add specs/*-build-prompts.md and specs/tickets/*/** to policy.protected_paths, in a commit of
    their own.
  Record a matchesPathGlob check: specs/tickets/awsf-v3-plan/W03.md and
    specs/awsf-v3-plan-build-prompts.md match; specs/tickets/T01.md does not.
  Adjust any test the change turns red in the same commit, naming task 12 where the cause is
    plan-render.
  Run npm run test:unit, npm run test:journeys, npm run test:traps, npm run typecheck and
    npm run lint on the commit's content, each alone, and record the counts.

DO NOT
  Narrow intake's writes in this commit; the protected path is the fence.
  Protect specs/tickets/*.md: that is the light tier's store.

BUILDER READY
  The diff is the two config lines and any named test adjustment.
  Every listed command exits 0 on the commit's content.

OWNER ACCEPTANCE
  The owner reads the diff and the counts, and commits it as their own.

COMMIT
  Owner-authored, as Santiago Marin <santiagomarinsuarez@me.com>, with no trailer.
  Proposed: chore(config): protect build prompts and paired ticket sets (W03 task 2)
  Body: the change, the glob checks, the test counts.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side: task 2's rows and this ticket's state move together in one bookkeeping commit after
  this lands, and M1 moves to [x] if task 1 is complete.

HANDOFF
  Dated findings for T11 and T12: anything intake or plan-render now refuses that the plan did not
  name.
```

### T03 — The agreement rules as one module

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 3 of 15. Plan: specs/awsf-v3-w03-ticket-closure.html, milestone M2, task 3.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T01 landed.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md (invariant 12); Section A of specs/awsf-v3-w03-ticket-closure-build-prompts.md
  specs/awsf-v3-w03-ticket-closure.html - Identifier Spine (INV-6), task 3
  core/test/unit/meta/ticket-plan-sync.test.ts - every rule it asserts, and its messages
  core/src/registry/plan-source.ts, core/src/registry/plan-spine.ts - the parser and spine rules
  core/src/persistence/plan-ticket-body.ts - ticket parsing

DO
  Create core/src/registry/plan-agreement.ts: every rule the sync fence asserts, as pure
    functions over parsed plans, parsed tickets and Section B blocks, each returning violations
    that carry the plan label and the message the fence prints today. Coverage, milestone match,
    marker against state, checklist against state, a checklist per task, Section B equality and
    title, backward and existing dependencies, finished dependencies with the declared
    exception, vocabularies, and the four identifier-spine rules.
  Make core/test/unit/meta/ticket-plan-sync.test.ts call the module. It keeps its test names,
    discovers the sets as today, and reads files only to feed the module.
  Add unit tests for the module on small in-memory plans: one passing set and one failing input
    per rule.

DO NOT
  Change what any rule accepts. The corpus must pass and fail exactly as before.
  Read a file, a clock or the environment inside the module.
  Touch any plan, prompt or ticket file.

BUILDER READY
  The sync fence passes on the real corpus with the same test count as at your base.
  A planted Section B drift, a duplicate task number and a done ticket under an idle milestone
    each still fail it (planted in a scratch copy, never committed).
  npm run test:unit passes; npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  At landing: the review accepts, and the fence's output on the corpus is unchanged.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: refactor(registry): move the invariant-12 rules into one module
  Body: what moved, the unchanged test count, the planted-drift results.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 3's rows and this ticket's state move
  together in one commit. Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T04, T11 and T12: the module's entry points
  and anything in the fence that was not a pure rule.
```

### T04 — The closure delta and the asked-for comparison

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 4 of 15. Plan: specs/awsf-v3-w03-ticket-closure.html, milestone M2, task 4.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T03 landed.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count.

READ FIRST
  AGENTS.md (invariants 2 and 12); Section A of
    specs/awsf-v3-w03-ticket-closure-build-prompts.md ("Closure, defined", "What a ticket asked
    for")
  specs/awsf-v3-w03-ticket-closure.html - Solution, Identifier Spine (INV-1, INV-2), task 4
  core/src/registry/plan-source.ts - the status-token and serves grammar the parser reads
  core/src/registry/plan-agreement.ts - T03's module
  core/src/persistence/plan-ticket-body.ts, core/src/contracts/ticket.ts - both ticket shapes

DO
  Create core/src/closure/delta.ts: given before and after maps of path to bytes, accept only a
    change that alters status-token values in plan files and the frontmatter state value in
    ticket files, adds or removes no path, and passes T03's agreement rules on the after tree.
    Return each accepted change with its path, task number, row index, old and new value. Refuse
    any other difference with the path and the first differing offset and its context.
  Mask exactly the grammar the parser reads: the value inside a status code element, and the
    value of the one frontmatter state line. Reject an after-value outside the closure
    vocabulary, including the failed marker and the failed state.
  Create core/src/closure/asked-for.ts: the ask of a plan ticket and of a light ticket, as
    Section A defines it, and a comparison of two trees that names each field that differs.
    Handoff sections are excluded.
  Unit tests for both modules on small in-memory fixtures.

DO NOT
  Read a file, a clock or the environment in either module.
  Mask anything the parser does not read as a marker or a state.
  Accept a failed marker or state.

BUILDER READY
  Each refusal kind has a test, and each accepted change kind has a test.
  npm run test:unit passes; npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  At landing: the review accepts, and the masking matches the parser's grammar exactly.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(closure): the closure delta and the asked-for comparison
  Body: what each module accepts and refuses, the test counts.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 4's rows and this ticket's state move
  together in one commit. Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T05, T07 and T11: the entry points, the
  refusal shapes, and any grammar case the parser reads that you found surprising.
```

### T05 — Testing Strategy for M2

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 5 of 15. Plan: specs/awsf-v3-w03-ticket-closure.html, milestone M2, task 5.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T03 and T04 landed.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w03-ticket-closure-build-prompts.md
  specs/awsf-v3-w03-ticket-closure.html - task 5, Notes ("Risks", R1)
  core/src/closure/delta.ts, core/src/closure/asked-for.ts, core/src/registry/plan-agreement.ts
  core/test/unit/meta/ticket-plan-sync.test.ts - how the registered sets are discovered

DO
  Under core/test/unit/closure/, add corpus tests over every registered plan source and its
    tickets, read from the working tree and held in memory:
  every single status-token flip to each closure value, and every ticket state flip, is
    accepted by the delta exactly when T03's rules accept the flipped tree;
  a one-byte change in each other byte class is refused: an acceptance row, a declaration
    statement, a Section B prompt, a ticket prompt, title, depends_on, serves, milestone, a
    Handoff, a metadata row; and an added or a removed file;
  a failed marker, a failed state and an out-of-vocabulary value are refused;
  the asked-for comparison refuses each ask change and ignores Handoff edits and status flips.
  Keep the corpus run within the unit gate's timeout: sample tokens per plan if a full sweep is
    too slow, and record the measured time either way.

DO NOT
  Write any change to a real plan, prompt or ticket file; mutate copies in memory.
  Skip a plan because it is large or old.

BUILDER READY
  The corpus tests pass; the measured time is recorded.
  npm run test:unit passes; npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  At landing: the review accepts, and the byte classes match "Closure, defined".

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: test(closure): prove the delta over every registered plan
  Body: plans and tokens covered, refusals per class, the measured time.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 5's rows, M2's marker and this ticket's
  state move together in one commit. Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T07 and T15: corpus size, timing, and any
  plan whose grammar the delta handled specially.
```

### T06 — A sealed ticket selection on any plan attempt

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 6 of 15. Plan: specs/awsf-v3-w03-ticket-closure.html, milestone M3, task 6.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T01 landed.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count.

READ FIRST
  AGENTS.md (invariants 1, 6 and 10); Section A of
    specs/awsf-v3-w03-ticket-closure-build-prompts.md
  specs/awsf-v3-w03-ticket-closure.html - Problem, task 6
  core/src/cli/commands/shift.ts - sealShiftSelection
  core/src/contracts/shift-selection-record.ts - the sealed record
  core/src/cli/main.ts - the new arm, --plan and resolvePlanRef
  core/src/doctor/markers.ts, core/src/doctor/repository.ts - the unmapped case

DO
  Add --ticket to awsf new: with --plan, one or more ticket ids of that stem, sealed as id,
    registered path and file digest, the way sealShiftSelection seals a shift's tickets, and
    journaled with the attempt.
  Refuse before the attempt exists: a ticket outside the stem's registered set, a duplicate id,
    --ticket on a shift, and --ticket with --plan absent (task 11 adds the light-tier form).
  Show the selection in awsf status and its JSON form.
  Make doctor's markers row map an attempt with a single-attempt selection exactly as it maps a
    shift.
  Update docs/cheatsheet.html with the flag.
  Unit tests for each refusal, and a journey through main on the stub route that creates,
    lands and reads back a selected attempt.

DO NOT
  Infer a ticket from a task id, a request or a directory.
  Change how a shift seals or checks its selection.
  Add a migration: the selection rides the attempt's journal.

BUILDER READY
  Each refusal has a test; the journey passes; doctor maps the selected attempt.
  npm run test:unit passes; npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  At landing: the review accepts, and the flag's refusals happen before any attempt exists.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(cli): seal a ticket selection on any plan attempt
  Body: the flag, its refusals, the doctor change, the test counts.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 6's rows, M3's marker and this ticket's
  state move together in one commit. Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T07 and T11: where the selection is
  journaled, how to read it back, and the record's name.
```

### T07 — closeCommand: propose, confirm, check, commit, record

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at xhigh, by live quota.

TASK 7 of 15. Plan: specs/awsf-v3-w03-ticket-closure.html, milestone M4, task 7.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T04 and T06 landed. W03-Q1 decided.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count.

READ FIRST
  AGENTS.md (invariants 2, 8, 11, 12 and 13); Section A of
    specs/awsf-v3-w03-ticket-closure-build-prompts.md
  specs/awsf-v3-w03-ticket-closure.html - Solution, Identifier Spine, Execution, task 7, W03-Q1
  core/src/cli/commands/land.ts - the owner-act shape to follow: actor, terminal, lease, recovery
  core/src/git/land.ts, core/src/git/changes.ts - Git through the runner, never a shell
  core/src/closure/delta.ts, core/src/closure/asked-for.ts, core/src/registry/plan-agreement.ts
  core/src/observability/projector.ts - how an attempt event becomes a row

DO
  Create core/src/cli/commands/close.ts exporting closeCommand, called directly by tests; G03-C
    wires it into the CLI. Refuse in this order: a non-human actor or a non-interactive
    terminal; an attempt that is not LANDED or has no selection; a candidate that is not an
    ancestor of canonical HEAD; a dirty canonical checkout; a selected ticket whose ask changed
    between the attempt's base and HEAD.
  Create core/src/closure/propose.ts: for each selected ticket, its task's rows with their
    current markers. For a shift, offer only tickets the host recorded as built in the landed
    candidate and list the others as not closable.
  Let the owner confirm all rows or choose row by row. Derive the ticket state from its rows
    (all complete is done, otherwise wip) and the milestone marker from its tasks. A closure
    that leaves every row open is still recorded.
  Build the after bytes by token substitution only. Run the delta and the agreement rules on the
    after tree before writing anything. Show every path and row with old and new values, then
    ask for the final confirmation.
  Commit once with the checkout's configured identity, refusing when it is unset, and the fixed
    message chore(specs): close stem ids after short-candidate, with no trailer. Publish by
    compare-and-swap on HEAD. Re-check the committed diff with the delta.
  Create core/src/contracts/closure-record.ts and journal a closure record on the attempt: rows
    closed, rows left open, the commit, before and after blob ids. Project it through
    core/src/observability/projector.ts as an event row. Journal an intent before the commit so
    an interruption is finished or reported on the next run, never repeated.
  Unit tests for each refusal, each derivation and the interruption cases.

DO NOT
  Change core/src/cli/commands/land.ts or its confirmation.
  Reset, force, delete a branch or push. Write any byte the delta would refuse.
  Accept a lease, the Delegate or a non-interactive caller.
  Wire the verb into core/src/cli/main.ts: that is G03-C, an owner commit.

BUILDER READY
  Every refusal leaves the checkout byte-identical, shown by a test.
  A closure's commit diff passes the delta, shown by a test.
  npm run test:unit passes; npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  At landing: the review accepts. G03-C follows task 8.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(closure): the closure act, unwired
  Body: the refusal order, the derivations, the record, the test counts.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 7's rows and this ticket's state move
  together in one commit. Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T08, T09, T10 and G03-C: the function's
  signature and what the CLI arm must pass it, the record's name, and the refusal messages.
```

### T08 — Spine roll-up, approvals and owner rows

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 8 of 15. Plan: specs/awsf-v3-w03-ticket-closure.html, milestone M4, task 8.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T07 landed. W03-Q6 decided.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count.

READ FIRST
  AGENTS.md (invariants 2 and 12); Section A of
    specs/awsf-v3-w03-ticket-closure-build-prompts.md
  specs/awsf-v3-w03-ticket-closure.html - task 8, W03-Q6
  specs/awsf-v3-plan.html - how a spine milestone links to its deep plan
  core/src/closure/propose.ts, core/src/cli/commands/close.ts - task 7's act

DO
  Spine roll-up: when a closure leaves every milestone of a deep plan complete, find the spine
    milestone section that links to that plan's file, offer that workstream's rows for the owner
    to choose, derive the spine ticket's state and the spine milestone marker, and include them
    in the same commit under the same delta and agreement checks.
  Approval: an attempt whose selection is a spine ticket closes that ticket's rows the owner
    chooses, such as the authored-and-approved row, with the spine ticket's state derived.
  Owner rows, per W03-Q6: a commit option on the act takes a commit reachable from HEAD as
    evidence; the owner chooses rows from any task; the same checks apply; record it as a
    project-level closure record in the journal.
  Unit tests over fixture spines and deep plans for each roll-up case and each refusal: an
    unreachable commit, a spine with no link to the plan, a link to two sections.

DO NOT
  Find a spine row by matching its prose. The link in the spine section is the only mapping.
  Move a spine row the owner did not choose.

BUILDER READY
  Each case and refusal has a test.
  npm run test:unit passes; npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  At landing: the review accepts. The owner then makes G03-C.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(closure): roll up to the spine and close owner rows
  Body: the roll-up rule, the evidence kinds, the test counts.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 8's rows and this ticket's state move
  together in one commit. Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for G03-C, T09 and T13: the CLI options the arm
  must accept, and how a plan-author attempt's selection must look for approval to work.
```

### T09 — Status, doctor, K2 and K1 read closure

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 9 of 15. Plan: specs/awsf-v3-w03-ticket-closure.html, milestone M4, task 9.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T08 landed, and G03-C landed. W03-Q3 decided.

BASELINE
  Run npm run test:unit and npm run test:traps at your base SHA before any change and record the
  counts.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w03-ticket-closure-build-prompts.md
  specs/awsf-v3-w03-ticket-closure.html - task 9, W03-Q3
  specs/awsf-v3-w02-trap-suite.html - "The trap, defined"
  core/src/lifecycle/next-steps.ts - K2, with close wired by G03-C
  core/src/doctor/markers.ts, core/src/doctor/repository.ts
  core/src/preflight/fields.ts - K1's fields and their evaluators
  core/src/traps/catalogue.ts - the next free trap id

DO
  K2: awsf next lists close for a LANDED attempt with a selection and no closure record, as an
    owner act the driver prepares.
  Status: awsf status and its JSON form show closed, open by the owner's choice, or not closed.
  Doctor: the markers row reads closure records and reports the three states separately.
  K1, per W03-Q3: a field refuses DRAFT to PREPARED while any attempt in the project that landed
    after the field's cut has a selection and no closure record, naming each attempt and the
    command that closes it. The cut is the landing time of this ticket's candidate, fixed in
    code. Add it as a trap under W02's contract: a catalogue entry at the next free id, a test
    under core/test/traps, a refusal marker pair, and a mutant that turns it red.
  Update docs/cheatsheet.html.

DO NOT
  Count a landing before the cut.
  Treat a closure that left rows open as unclosed.
  Add a flag or variable that skips the field.

BUILDER READY
  The trap passes and its mutant fails; the catalogue fence holds.
  npm run test:unit and npm run test:traps pass; npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  At landing: the review accepts, and the refusal message names what to close.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(closure): status, doctor, next and K1 read closure records
  Body: each reader, the K1 field and its trap id, the cut, the test counts.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: run awsf close on it. Task 9's rows and this
  ticket's state move in that closure.

HANDOFF
  In your envelope's notes, give dated findings for T10 and T15: the trap id, the cut, and the
  K1 message text.
```

### T10 — Testing Strategy for M4

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 10 of 15. Plan: specs/awsf-v3-w03-ticket-closure.html, milestone M4, task 10.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T05, T07, T08 and T09 landed.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count.

READ FIRST
  AGENTS.md (invariants 8 and 11); Section A of
    specs/awsf-v3-w03-ticket-closure-build-prompts.md
  specs/awsf-v3-w03-ticket-closure.html - task 10, Notes ("Risks")
  core/test/journeys/production-runner.test.ts - the stub route and its fake broker
  core/test/journeys/human-gate.test.ts - how an owner act is driven through main in a journey

DO
  Create core/test/journeys/closure.test.ts. A fixture project with a plan, its prompts and its
    tickets; a build-review attempt with a selection on the stub route; landed; then closed
    through main. Assert the fixture's agreement rules pass on the result and the commit's diff
    is markers and states only.
  Add refusal journeys, each asserting the checkout is byte-identical afterwards: a
    non-interactive terminal, a wrong actor, an attempt not LANDED, no selection, a candidate
    not in HEAD, a dirty checkout, a changed ask, an unset identity, and HEAD moved during
    confirmation.
  Add a shift journey that closes several tickets in one commit and rolls a completed fixture
    deep plan up to its fixture spine.
  Add an interruption journey: a closure stopped after its intent and before its commit is
    finished or reported on the next run, never repeated.

DO NOT
  Use the owner's state root or the real plans as fixtures.
  Weaken an invariant-8 or invariant-11 fence to make a journey pass.

BUILDER READY
  Every journey passes; the invariant-8 fences pass over the new code.
  npm run test:unit, npm run test:journeys and npm run test:traps pass; npm run typecheck and
    npm run lint exit 0.

OWNER ACCEPTANCE
  At landing: the review accepts. M4 is complete when this closes.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: test(closure): journeys for the closure act
  Body: journeys added, refusals covered, the test counts.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: run awsf close on it. Task 10's rows, M4's
  marker and this ticket's state move in that closure.

HANDOFF
  In your envelope's notes, give dated findings for T11, T14 and T15: fixture helpers worth
  reusing, and any refusal the act lacked that a journey exposed.
```

### T11 — Light tickets start, close and keep their state out of intake's reach

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 11 of 15. Plan: specs/awsf-v3-w03-ticket-closure.html, milestone M5, task 11.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T07 landed. W03-Q5 decided as recommended, and G03-I landed. If the owner chose another home
  for the light tier, the review rewrites this prompt before it starts.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count.

READ FIRST
  AGENTS.md (invariant 12 as amended at G03-I); Section A of
    specs/awsf-v3-w03-ticket-closure-build-prompts.md
  specs/awsf-v3-w03-ticket-closure.html - task 11, W03-Q5
  core/src/persistence/ticket-store.ts, core/src/contracts/ticket.ts - the flat store
  core/src/cli/commands/ticket.ts - awsf ticket new and refine
  core/src/cli/commands/production-run.ts - intake's ticket gate
  core/src/cli/commands/close.ts, core/src/closure/delta.ts, core/src/closure/asked-for.ts

DO
  Let awsf new take --ticket without --plan to select one flat light ticket from the plans
    root's ticket store, sealed with its digest like task 6's selection.
  Let closeCommand close a light ticket's LANDED attempt by changing only that file's state
    line, under the same delta and asked-for rules. A light ticket has no rows, so the owner
    confirms the state.
  Make intake's ticket gate refuse a new ticket whose state is not todo, and a refine that
    changes state.
  Extend core/src/registry/plan-agreement.ts to check the flat store's vocabularies and
    dependency cycles.
  Update docs/cheatsheet.html.
  Tests: a journey that runs awsf ticket new on the stub route, starts a build-review attempt
    with --ticket, lands it and closes it; and a refusal test for each rule.

DO NOT
  Let closure change any flat-ticket field but state.
  Let intake move a state.
  Treat a paired plan ticket as light.

BUILDER READY
  The journey and every refusal test pass.
  npm run test:unit and npm run test:journeys pass; npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  At landing: the review accepts. M5 is complete when this closes.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(closure): the light tier starts and closes through the same act
  Body: the selection, the closure, the intake rule, the test counts.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: run awsf close on it. Task 11's rows, M5's
  marker and this ticket's state move in that closure.

HANDOFF
  In your envelope's notes, give dated findings for T15 and W09: how many light tickets exist,
  and how a reader tells a closed light ticket from an open one.
```

### T12 — Plan admission, and design-to-plan on it

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at xhigh, by live quota.

TASK 12 of 15. Plan: specs/awsf-v3-w03-ticket-closure.html, milestone M6, task 12.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T02 and T03 landed. W03-Q7 decided.

BASELINE
  Run npm run test:unit and npm run test:journeys at your base SHA before any change and record
  the counts.

READ FIRST
  AGENTS.md (invariants 2 and 12); Section A of
    specs/awsf-v3-w03-ticket-closure-build-prompts.md
  specs/awsf-v3-w03-ticket-closure.html - task 12, W03-Q7, INV-4
  core/src/registry/plan-render.ts, core/src/workflow/recipes/design-to-plan.ts
  core/src/cli/commands/production-run.ts - plan-render's host write and noProtectedPaths
  core/src/gates/git-diff.ts, core/src/contracts/protected-capability.ts - the exemption shape
  core/test/journeys/five-stage.test.ts - task 1's exemption

DO
  Create core/src/registry/plan-admission.ts: given one new stem, write exactly its plan, its
    build prompts, its ticket README and its tickets. Refuse a path that exists at the base and
    any other path. Every marker idle, every state todo.
  Derive tickets in the host from Section B and a frontmatter table, so prompt equality holds by
    construction. Run the parser and the agreement rules on the admitted set before committing.
  Add an admission capability that core/src/gates/git-diff.ts accepts in noProtectedPaths for
    exactly the admitted, newly created paths. A modification of an existing protected path is
    still refused.
  Move design-to-plan's plan-render host write onto admission.
  Remove task 1's design-to-plan exemption from core/test/journeys/five-stage.test.ts, so the
    journey passes under the shipped protected paths.
  Journal an admission record and project it as an event row.
  Unit tests for each refusal.

DO NOT
  Exempt any path that exists at the base.
  Touch core/src/policy: the capability is checked where the gate runs.
  Write a marker or state other than idle and todo.

BUILDER READY
  Every refusal has a test; the five-stage journey passes with no exemption.
  npm run test:unit and npm run test:journeys pass; npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  At landing: the review accepts, and the capability admits nothing but new paths.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(registry): admit new plan sets create-only
  Body: what admission writes and refuses, the capability, the five-stage result, the counts.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: run awsf close on it. Task 12's rows and this
  ticket's state move in that closure.

HANDOFF
  In your envelope's notes, give dated findings for T13, T14 and G03-W: the admission entry point
  and the frontmatter table's shape.
```

### T13 — The plan-author recipe, code half

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 13 of 15. Plan: specs/awsf-v3-w03-ticket-closure.html, milestone M6, task 13.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T08 and T12 landed.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w03-ticket-closure-build-prompts.md
  specs/awsf-v3-w03-ticket-closure.html - task 13, Notes ("Handoff findings")
  core/src/workflow/recipes/design-to-plan.ts - a recipe with a host phase
  core/src/registry/plan-admission.ts - task 12's admission
  core/src/policy/path-policy.ts - writeTargetAllowed and session-runtime output, read only
  core/src/workflow/output-ownership.ts - phase output kinds

DO
  Create core/src/workflow/recipes/plan-author.ts: an author phase that writes a plan, its build
    prompts and a ticket frontmatter table into its session-runtime output and returns an
    envelope naming them; a host phase that admits them through task 12; then a
    cross-provider review.
  Create the author prompts under prompts/plan-author/: the repository's plan grammar, the
    identifier spine rules, Section B equality, Handoff above the prompt, all markers idle and
    states todo, and the rule that authoring earns no marker.
  Require the attempt to carry a selection naming one spine ticket, so task 8's approval path
    closes it after landing.
  Run on test configurations that declare the role; the shipped configuration is G03-W.
  Unit tests for the recipe's compilation and the host phase's refusals.

DO NOT
  Give the role any repository write glob.
  Reuse the planner's read-only profile for the author.

BUILDER READY
  The recipe compiles on a test configuration; its unit tests pass.
  npm run test:unit passes; npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  At landing: the review accepts. The owner then makes G03-W.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(workflow): the plan-author recipe, code half
  Body: the phases, the role's profile, the selection rule, the test counts.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: run awsf close on it. Task 13's rows and this
  ticket's state move in that closure.

HANDOFF
  In your envelope's notes, give dated findings for G03-W, T14 and T15: the exact role block the
  owner's configuration needs, and the envelope's size limits.
```

### T14 — Testing Strategy for M6

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 14 of 15. Plan: specs/awsf-v3-w03-ticket-closure.html, milestone M6, task 14.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T10, T12 and T13 landed.

BASELINE
  Run npm run test:unit and npm run test:journeys at your base SHA before any change and record
  the counts.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w03-ticket-closure-build-prompts.md
  specs/awsf-v3-w03-ticket-closure.html - task 14, W03-Q8
  core/test/journeys/closure.test.ts - task 10's fixtures
  core/test/journeys/five-stage.test.ts

DO
  Create core/test/journeys/plan-author.test.ts. On the stub route, a scripted author writes a
    fixture deep plan for a fixture spine ticket. The host admits it, the reviewer reads it, the
    owner lands it, and awsf close closes the fixture spine's authored-and-approved row and moves
    the fixture spine ticket to wip.
  Add refusal journeys: a scripted author that also emits a change to an existing plan, an
    existing stem, a non-idle marker or a non-todo state is refused before commit, with the
    checkout unchanged.
  Assert the five-stage journey passes under the shipped protected paths.

DO NOT
  Use the real spine or a real plan as a fixture.
  Call a provider.

BUILDER READY
  Every journey passes.
  npm run test:unit, npm run test:journeys and npm run test:traps pass; npm run typecheck and
    npm run lint exit 0.

OWNER ACCEPTANCE
  At landing: the review accepts. M6 is complete when this closes and G03-W has landed.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: test(workflow): journeys for plan-author and admission
  Body: journeys added, refusals covered, the test counts.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: run awsf close on it. Task 14's rows, M6's
  marker and this ticket's state move in that closure.

HANDOFF
  In your envelope's notes, give dated findings for T15 and later deep-plan sessions: what the
  stub author proved and what only a live run can measure.
```

### T15 — The closing record, and the workstream's closing duties

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at medium, or codex:gpt-6-sol at medium, by live quota.

TASK 15 of 15. Plan: specs/awsf-v3-w03-ticket-closure.html, milestone M7, task 15.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T10, T11 and T14 landed. G03-W landed.

BASELINE
  Run every suite listed under BUILDER READY at your base SHA and record the counts.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w03-ticket-closure-build-prompts.md
  specs/awsf-v3-w03-ticket-closure.html - in full, its Amendments, every ticket's Handoff
  specs/awsf-v3-plan.html - gate GM and the W03 block

DO
  Re-check every W03 closure's commit with the delta, from the journal's closure records, and
    list each with its SHA.
  Add any test the closing record needs to prove a row, and only that.
  Assemble the closing record in your envelope's notes: each task's final state, landing and
    closure SHAs, gate counts, decisions taken, surprises, and the dated handoff findings for
    W09 (what counts as a closed spec) and for every later deep-plan session (how to author
    through the factory now that GM is retired).

DO NOT
  Write the closing record into any committed file; the owner records it.
  Close this ticket yourself.

BUILDER READY
  npm run test:unit, npm run test:contract, npm run test:sim, npm run test:journeys and
    npm run test:traps pass, each run alone; npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  At landing: the owner reads the closing record and lands it.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: test(closure): the W03 closing record
  Body: the suite counts and any test added.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: run awsf close on it. Task 15's rows, M7's
  marker and this ticket's state move in that closure, which rolls W03 up to the spine and
  retires gate GM. The narrative Amendment, if wanted, is a separate owner commit.

HANDOFF
  The closing record is the handoff.
```
