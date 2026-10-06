# AWSF v3 W01 — Driver checks: build prompts

> **Plan:** [`awsf-v3-w01-driver-checks.html`](awsf-v3-w01-driver-checks.html) · **Spine:** [`awsf-v3-plan.html`](awsf-v3-plan.html) § Workstreams → Milestone M1 → W01
> **Tickets:** [`tickets/awsf-v3-w01-driver-checks/`](tickets/awsf-v3-w01-driver-checks/) — one file per task, each carrying the same prompt this file's Section B holds.

This file exists because this repository's invariant-12 fence requires it:
`core/test/unit/meta/ticket-plan-sync.test.ts` asserts a `<stem>-build-prompts.md` exists for every
plan source with a ticket set, and that each ticket's prompt is **byte-identical** to its
`### Tnn — ` block below.

# Section A — Conventions

**Read first, on every task.** `AGENTS.md` in full · `specs/awsf-v3-w01-driver-checks.html` (Problem,
Solution, K1's fields, Identifier Spine and Execution in full, then the task's own section) ·
`specs/tickets/awsf-v3-w01-driver-checks/README.md`.

**What W01 is, in one line.** K1: `awsf start` refuses DRAFT→PREPARED until the host has measured
seven fields and the owner has confirmed the request. K2: `awsf next --json` inventories every legal
edge, separating implemented CLI steps, implemented host waits and explicitly unavailable edges. The guard denies owner acts in every documented spelling. Every cancel and
stop carries a cause.

**Execution.** Managed by default (spine decision 7): one `build-review` attempt per ticket, tier
derived by `awsf new`. External prerequisites must have landed. In an owner-approved accumulating
shift, selected predecessors need host-committed, gate-passing heads in that worktree, not separate
canonical landings or marker changes mid-shift. Manual execution is a logged exception for a factory that cannot carry the
work. From T11's landing on, every task, these included, is prepared through `awsf preflight` and
the owner's `awsf confirm`.

**The builder's write boundary.** `core/src/**` outside protected paths, `core/test/**`,
`dashboard/**`, `prompts/**`, `docs/cheatsheet.html`. Never `specs/**`, `AGENTS.md`,
`awsf.config.yaml`, `awsf.project.yaml`, `core/src/state/**`, `core/src/policy/**`,
`core/src/observability/migrations/**`, `core/src/execution/transport-broker.ts`,
`docs/driving/**`, or a root `.claude/` directory.

**Owner gates.**
- **G01-F**, before T08: the owner confirms or corrects the forensics draft's eight `driver` rows;
  the result is a dated Amendment of the plan and freezes K1's field list.
- **G01-G**, with or after T04: the guard fix in `docs/driving/marimba/marimba-guard-rules.mts` and
  `delegation-guard.sh`, flipping T04's pinned rows.
- **G01-C**, after T10 and before T11: `awsf confirm` wired in one commit (arm, `CLI_COMMANDS`,
  K2's owner-act table, cheatsheet `commands` and `owner-acts`, guard `.sh` and `.mts`,
  `marimba-guard.test.ts`, `docs/driving/skills/awsf/cookbooks/owner_acts.md` and any other driving
  document that enumerates owner acts).
- **G01-S** is not taken: the owner decided W01-Q2 for `awsf start` on 2026-10-04, so L1's guard stays
  unchanged.

**K2's availability contract.** The edge ids in `steps + waits + unavailable` partition
`LEGAL_EDGES` filtered by the current state, exactly once. A CLI step or host wait needs an actual
task-transition invocation, directly or through `CallBudget.authorize()`. A phase correction is
not such an invocation. Unavailable entries retain the machine's actors and an explanation but
have no verb, argv or executable who; neither the renderer, a lease nor a later panel may turn
that explanation into an action. L10 and L16 currently require this classification. Implementing
those edges is separate scope, not permission granted by T05.

**K1's field ids**, used by every M4 and M5 ticket: `suite`, `write-boundary`, `protected-paths`,
`git-storage`, `duplicate`, `request-shape`, `prior-attempts` (measured) and `confirmation`
(attested). The plan's K1 table defines each.

**The never-do list**, with why each is tempting:
- **Do not let a driver statement satisfy a K1 field.** `--where`, `--read` and `--consulted` are
  inputs the host checks against the request text, the configuration and the journal.
- **Do not add a bypass.** No `--skip-preflight`, and `--stub` does not skip K1. A flag the driver
  can type is a hole in the check.
- **Do not seal an attempt on a K1 refusal.** It stays DRAFT with zero calls reserved.
- **Do not edit `core/src/state/**` or `docs/driving/**`.** They are protected; the owner commits
  G01-G and G01-C.
- **Do not register `awsf confirm` in `main.ts`.** `boundary-claims.test.ts` needs the arm and the
  guard verb in one commit, which is G01-C.
- **Do not delete a worktree, file or directory from `core/src`.** `no-destructive-paths` forbids
  `worktree remove|prune`, `rmSync`, `unlinkSync`, and the probe reads modes only.
- **Do not add a migration.** Records ride attempt evidence and `events` rows through `projector.ts`.
- **Do not spawn outside the transport broker or use a shell** (invariants 3 and 4).
- **Do not add a dependency** (invariant 7).
- **Do not copy the owner's run data into a fixture**, and name no file with `manifest` or
  `receipt` in it (invariants 1, 9 and 10).
- **Never** put an agent, model or AI tool in a commit identity, message or trailer.

# Section B — Task prompts (recommended)

### T01 — The driver cause, and attributing a cancelled attempt

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 1 of 13. Plan: specs/awsf-v3-w01-driver-checks.html, milestone M1, task 1.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  None inside W01.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w01-driver-checks-build-prompts.md
  specs/awsf-v3-w01-driver-checks.html - Problem, Solution, the Identifier Spine, task 1
  core/src/contracts/attribution-record.ts - ATTRIBUTION_CAUSES and the record schema
  core/src/cli/commands/attribute.ts - the owner act and its BLOCKED-only check
  core/src/metrics/attribution.ts - the heuristic table, which must not change
  core/src/persistence/task-attributions.ts, core/src/observability/projector.ts - storage and
    the attribution events row
  dashboard/src/metrics-run.ts and the metrics view - the mirrored vocabulary

DO
  Add "driver" to ATTRIBUTION_CAUSES. Define it in the contract's comment: a check before the
    first provider call would have refused this run, had it existed or been run; not a verdict
    on the model that drove it. Keep the schema id awsf.attribution/v1: every existing record
    stays valid when the union widens.
  Let awsf attribute take a CANCELLED attempt as well as a BLOCKED one. Every other state is
    still refused, and the error names both admissible states. The terminal prompt says which
    state the attempt is in.
  Add a test that pins HEURISTIC_ATTRIBUTION_RULES: the heuristic never answers driver or owner.
  Mirror "driver" in dashboard/src/metrics-run.ts and give it a label in the metrics view.
  Update the attribute usage string in core/src/cli/main.ts and the cheatsheet so both name the
    six causes.

DO NOT
  Change the heuristic table, or teach it to answer driver.
  Add a field to the record, a new schema id, or a migration. Causes ride the existing
    attribution events row.
  Register any new command.

BUILDER READY
  Tests: attributing a CANCELLED attempt writes one record and one events row; a DRAFT, RUNNING
    or LANDED attempt is refused with nothing written; driver is accepted; an unknown cause is
    refused.
  awsf db rebuild reproduces the events row for a driver attribution of a cancelled attempt.
  npm run test:unit passes; npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  None for this ticket alone. M1's acceptance is task 3's list.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(attribution): add the driver cause and attribute cancelled attempts
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 1's rows in
  specs/awsf-v3-w01-driver-checks.html and this ticket's state move together in one commit
  (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T02 and T03: contradictions with their
  prompts (which wins, and why), moved or renamed files, scope they can skip or must absorb.
  The owner copies them into those tickets' ## Handoff. Edit no ticket file.
```

### T02 — awsf cancel requires a reason and a cause

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 2 of 13. Plan: specs/awsf-v3-w01-driver-checks.html, milestone M1, task 2.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T01 landed: the driver cause exists and a cancelled attempt can be attributed.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w01-driver-checks-build-prompts.md
  specs/awsf-v3-w01-driver-checks.html - Problem, the Identifier Spine, task 2, W01-Q6
  core/src/cli/commands/cancel.ts - the confirmation, the termination and line 98's fixed detail
  core/src/cli/commands/attribute.ts - assertAttributeReason, which this ticket reuses
  core/src/persistence/task-attributions.ts - appendTaskAttribution
  core/src/cli/main.ts - the cancel arm
  Every test under core/test that cancels an attempt (grep for cancelCommand and "cancel")

DO
  awsf cancel <task> --cause <cause> --reason "<why>". Both are required. A missing value, a
    cause outside ATTRIBUTION_CAUSES, or a credential-shaped reason is refused before the
    confirmation prompt and before any process is signalled, with nothing written.
  unknown is an admissible cause (W01-Q6's recommendation: the metrics count it as no cause).
  Show the cause and the reason in the prompt, beside the existing write-off lines.
  On confirmation: the CANCELLED transition carries the reason as its detail in place of
    "explicit CLI cancellation". After the transition persists, append one attribution record
    for the attempt with the cause and the reason, and project it. A failure between the two
    leaves a cancelled attempt without a record, which T03's readout reports.
  A declined cancel writes nothing, as today.
  Update the cancel arm in main.ts, its usage text, the cheatsheet, and every test and journey
    that cancels.

DO NOT
  Change which states may be cancelled, or the order of the machine's checks.
  Write the record before the transition: a record for an attempt that did not cancel is worse
    than a cancel the readout flags.
  Edit docs/driving/**. The driving docs' cancel examples are the owner's to update.

BUILDER READY
  Tests: each refused input writes nothing and sends no signal; a confirmed cancel writes the
    reason as the transition detail and exactly one attribution record; a declined one writes
    nothing; a RUNNING cancel still terminates the recorded tree first.
  npm run test:journeys passes with every cancelling journey updated.
  npm run test:unit passes; npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  None for this ticket alone. M1's acceptance is task 3's list.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(cancel): require a cause and a reason, and record both
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 2's rows in
  specs/awsf-v3-w01-driver-checks.html and this ticket's state move together in one commit
  (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T03 and T13: contradictions with their
  prompts (which wins, and why), moved or renamed files, scope they can skip or must absorb.
  The owner copies them into those tickets' ## Handoff. Edit no ticket file.
```

### T03 — Testing Strategy for M1, and the cause readout

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 3 of 13. Plan: specs/awsf-v3-w01-driver-checks.html, milestone M1, task 3.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T01 and T02 landed.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w01-driver-checks-build-prompts.md
  specs/awsf-v3-w01-driver-checks.html - Purpose, AC-1 and AC-2, task 3, W01-Q6
  core/src/cli/commands/metrics.ts and core/src/metrics/ - how awsf metrics reads the projection
  core/src/metrics/attribution.ts - blockingPhase and the heuristic
  core/src/observability/projector.ts - the attribution events row

DO
  Add a causes readout to awsf metrics (text and --json): stops (BLOCKED) and cancels
    (CANCELLED) for the window the command already takes, counted by cause, where an owner
    record wins over the heuristic.
  List each one without a cause: a BLOCKED attempt with no owner record whose heuristic answers
    unknown, and a CANCELLED attempt with no record or with the cause unknown. Name each by
    project, task and attempt.
  Read only through the projection's read model. Write nothing.
  Write the M1 tests the plan's task 3 lists, offline, on synthetic fixtures.

DO NOT
  Add a projection column or a migration.
  Treat unknown as a cause in the counts that measure the target.
  Read the owner's state root in a test.

BUILDER READY
  Tests: a fixture set with one BLOCKED attempt per heuristic outcome, one owner-attributed
    block, one cancel with each cause and one legacy cancel with no record produces the
    expected counts and the expected "without a cause" list.
  npm run test:unit (count against the base), npm run test:journeys, npm run typecheck and
    npm run lint pass.

OWNER ACCEPTANCE
  Journey w01-m1: on a throwaway stub task, run awsf cancel without --reason and see it refused
    with nothing written; cancel with --cause owner and a reason; see the cancel listed by cause
    in awsf metrics and absent from the "without a cause" list.
  Optional, owner-side: begin the backfill with awsf attribute on past cancels.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(metrics): report stops and cancels by cause, and those without one
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 3's rows and Milestone M1's marker in
  specs/awsf-v3-w01-driver-checks.html and this ticket's state move together in one commit
  (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T13 and for W02 (the cause readout W02's
  "stop without a trap" check can extend). The owner copies them into the tickets' ## Handoff.
  Edit no ticket file.
```

### T04 — The owner-act spelling matrix, in both harnesses

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 4 of 13. Plan: specs/awsf-v3-w01-driver-checks.html, milestone M2, task 4.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  None inside W01. Gate G01-G (the guard fix, an owner commit) may already be at your base, or
  may land after this ticket. Read the base to tell which.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w01-driver-checks-build-prompts.md
  specs/awsf-v3-w01-driver-checks.html - Problem (the guard), Execution (G01-G), task 4, W01-Q7
  docs/driving/marimba/marimba-guard-rules.mts - OWNER_ACTS, normalizeCommand,
    ownerActViolation, lifecycleCommand (protected; read only)
  docs/driving/marimba/delegation-guard.sh - fence 2's case (protected; read only)
  core/test/unit/meta/marimba-guard-pi.test.ts, marimba-guard.test.ts - the two harness tests
  core/test/unit/meta/doc-reconciliation.test.ts - how it extracts awsf invocation forms

DO
  Create core/test/unit/meta/_owner-act-spellings.ts: the spellings W01-Q7 decides, as
    templates over an act. The recommended set is: awsf <act>; just awsf <act>;
    npm run awsf -- <act>; npm run awsf --silent -- <act>; npm --prefix <dir> run awsf -- <act>;
    npm run --silent awsf -- <act>; node --experimental-strip-types core/src/cli/main.ts <act>.
    If the owner decided otherwise, use their set and say so in your notes.
  In marimba-guard-pi.test.ts: one row per OWNER_ACTS entry per spelling, through
    ownerActViolation and through the pi binding's tool_call handler.
  In marimba-guard.test.ts: the same rows through the spawned shell hook.
  Add a doc-sourced row: every awsf invocation prefix found in README.md and docs/** shell
    fences maps to a spelling in the table, so a newly documented spelling without a guard row
    turns red.
  For each row the guard at your base does not deny, assert null and label it
    KNOWN GAP F17 with a comment naming gate G01-G, as the file already pins its known evasion.
    If G01-G is at your base, every row asserts denial and no row is pinned.

DO NOT
  Edit docs/driving/** to make a row pass. The fix is G01-G, the owner's commit.
  Restate OWNER_ACTS in the test. Iterate the imported list, so a new act gets its rows.
  Widen the match in a way the file's pinned over-denial rows would contradict.

BUILDER READY
  Both harness tests iterate every act and every spelling, and agree with each other row by row.
  The doc-sourced row is green, and turns red on a planted fence line in a fixture using a new
    spelling.
  npm run test:unit passes; npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  Gate G01-G: the owner commits the guard fix (the plan's G01-G card) and flips every pinned
  KNOWN GAP F17 row to deny in the same commit. The milestone is not complete before it lands.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: test(guard): cover every owner act in every documented spelling
  Body: what changed and why, the rows pinned as the F17 gap, the test counts.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate and G01-G have both landed: task 4's rows and
  Milestone M2's marker in specs/awsf-v3-w01-driver-checks.html and this ticket's state move
  together in one commit (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for the owner's G01-G commit (the exact rows to
  flip) and for T07 (the parity test reads the same OWNER_ACTS). Edit no ticket file.
```

### T05 — The next-steps model

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 5 of 13. Plan: specs/awsf-v3-w01-driver-checks.html, milestone M3, task 5.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  None inside W01.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w01-driver-checks-build-prompts.md
  specs/awsf-v3-w01-driver-checks.html - Problem, M3 and its diagram, task 5, the K2 output
    shape in Notes
  core/src/state/task-machine.ts - TASK_STATES, LEGAL_EDGES, ACTORS (protected; read only)
  core/src/cli/main.ts - the command arms; an owner act is an arm that constructs
    processOwnerTerminal()
  core/test/unit/meta/boundary-claims.test.ts - how the owner acts are derived from main.ts
  Every module in core/src/cli/commands/ that calls transition() or CallBudget.authorize(), to
    trace the actual task-transition invocation, plus core/src/workflow/engine.ts to distinguish
    intra-phase corrections from lifecycle transitions

DO
  Create core/src/lifecycle/next-steps.ts, outside core/src/state:
    EDGE_INVOCATIONS: exactly one tagged classification per LEGAL_EDGES entry: an implemented
      CLI invocation, an implemented host-internal invocation, or unavailable. Trace positive
      provenance to the module and call site requesting the task transition, directly or through
      CallBudget.authorize(); do not infer from names. An unavailable entry explains the missing
      implementation without inventing a caller. L10 and L16 currently have none: rework's human
      actor is not their host/owner actor, and phase corrections do not request task transitions.
    OWNER_ACT_COMMANDS: the verbs whose arms construct an owner terminal today.
    NON_TRANSITION_ACTS: raise, grant, journey and attribute with the lifecycle states each is
      legal in, read from each command's own checks, and the read-only status and watch.
    nextSteps(input): pure. Input is the attempt's state, identity and revision. Output is
      awsf.next/v1: steps (kind edge, act or read; edge, to, verb, argv, who, interactive,
      spendsCalls, requires), waits (implemented host-internal edges, who host), and unavailable
      (edge, to, actors from LEGAL_EDGES, reason not-implemented, non-empty detail). Unavailable
      entries have no verb, argv or who, and authorize nothing. who on CLI steps is owner when
      the verb is an owner act, driver otherwise. requires is empty until T11 fills it.
  Create core/src/contracts/next-steps.ts: the TypeBox schema, registered as the other record
    schemas are, and a validator.

DO NOT
  Import anything impure into next-steps.ts. No file, clock, Git or process.
  Add anything under core/src/state/**.
  Import docs/driving/** from core/src. The guard list is compared in a test (T07), not read at
    runtime.
  Change any command's behaviour or implement L10/L16. This ticket adds a model and changes no
    output yet. Never put an unavailable edge in steps or waits to make coverage pass.

BUILDER READY
  Tests: nextSteps over every TASK_STATES value returns edge ids across steps, waits and
    unavailable equal to LEGAL_EDGES filtered by from, exactly once each; every output validates
    against the schema; EDGE_INVOCATIONS has exactly one entry per edge; OWNER_ACT_COMMANDS
    equals the set boundary-claims derives from main.ts. L10/L16 are unavailable, preserve their
    machine actors, and cannot validate with a verb, argv or who.
  npm run test:unit passes; npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  None for this ticket alone. M3's acceptance is task 7's list.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(lifecycle): derive the legal next steps from the task machine
  Body: what changed and why, the edge-to-verb table as traced, the test counts.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 5's rows in
  specs/awsf-v3-w01-driver-checks.html and this ticket's state move together in one commit
  (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T06, T07 and T11, and the edge-to-verb
  table for W05 (its Delegate acts map onto these edges). Edit no ticket file.
```

### T06 — awsf next, and the prose rendered from it

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 6 of 13. Plan: specs/awsf-v3-w01-driver-checks.html, milestone M3, task 6.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T05 landed, or host-committed and gate-passing earlier in the approved accumulating shift:
  nextSteps and awsf.next/v1 exist.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w01-driver-checks-build-prompts.md
  specs/awsf-v3-w01-driver-checks.html - M3, task 6, INV-4
  core/src/lifecycle/next-steps.ts, core/src/contracts/next-steps.ts - T05's model
  core/src/cli/commands/attempt.ts - nextActionFor, which this ticket replaces
  core/src/cli/main.ts - CLI_COMMANDS, CLI_BOOLEAN_FLAGS, every out(... nextAction ...)
  core/test/unit/meta/cheatsheet-reconciliation.test.ts - the commands fact class
  docs/cheatsheet.html

DO
  Add core/src/cli/commands/next.ts and its arm: awsf next <task> [--attempt n] [--json].
    It locates and reads the attempt, writes nothing, and takes no owner terminal. --json
    prints the awsf.next/v1 object; without it, the rendered sentence and one line per step,
    wait and unavailable edge. Label unavailable entries with their explanation, never as a
    command, automatic wait or recommended next action.
  Add next to CLI_COMMANDS and to the cheatsheet's commands list and command reference.
  Replace nextActionFor with renderNextAction(nextSteps(...)) in every caller under
    core/src/cli/commands/. Keep the persisted nextAction field; it is now rendered.
  Update every test that pinned the old sentences to assert the rendered text. The rendered
    AWAITING_OWNER sentence names review and journey, which the old one omitted.

DO NOT
  Make next an owner act or give it a side effect.
  Keep a hand-written step sentence anywhere outside the renderer.
  Rewrite nextAction in existing attempt records. Old records keep their old text.
  Recommend an unavailable edge or supply it with a command. Render its explanation separately.

BUILDER READY
  Tests: awsf next and awsf next --json on one stub attempt per reachable state; the JSON
    validates against the schema; the text output equals the persisted nextAction after each
    transition. GATING/REVIEWING outputs explicitly label L10/L16 unavailable, and neither the
    rendered action nor waits claim they have an implemented invocation.
  cheatsheet-reconciliation and doc-reconciliation pass with the new command.
  npm run test:unit and npm run test:journeys pass; npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  None for this ticket alone. M3's acceptance is task 7's list.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(cli): add awsf next and render nextAction from the legal steps
  Body: what changed and why, the sentences that changed, the test counts.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 6's rows in
  specs/awsf-v3-w01-driver-checks.html and this ticket's state move together in one commit
  (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T07, T11 and W08 (the text and JSON the
  panel will read). Edit no ticket file.
```

### T07 — Testing Strategy for M3

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 7 of 13. Plan: specs/awsf-v3-w01-driver-checks.html, milestone M3, task 7.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T05 and T06 landed, or host-committed and gate-passing earlier in the approved accumulating
  shift.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w01-driver-checks-build-prompts.md
  specs/awsf-v3-w01-driver-checks.html - M3, task 7, INV-4 and INV-5
  core/src/lifecycle/next-steps.ts, core/src/cli/commands/next.ts
  core/test/unit/meta/boundary-claims.test.ts - reuse ownerActsIn()'s derivation approach; it is
    local and unexported, not an importable helper or a reason to maintain a second verb list
  docs/driving/marimba/marimba-guard-rules.mts - OWNER_ACTS (protected; tests may import it,
    as core/test/unit/cli/relate.test.ts does)

DO
  A property test: for every state in TASK_STATES, the edge ids in steps plus waits plus
    unavailable equal LEGAL_EDGES filtered by from, exactly once each. Implemented entries' who
    follows from the invocation and OWNER_ACT_COMMANDS; unavailable actors equal the machine's
    actors and have no who. Planted missing, extra or duplicate edges turn it red.
  Availability tests: L10/L16 appear only in unavailable with reason not-implemented and a
    non-empty explanation. Planted fake commands, fake host waits or changed unavailable actors
    fail. Schema validation rejects verb, argv or who on an unavailable entry. A renderer test
    refuses to recommend either unavailable edge; the text exposes their explanations.
  A parity test: OWNER_ACT_COMMANDS equals the main.ts-derived owner-act set and the guard's
    OWNER_ACTS, as sets.
  A fence: no source file under core/src/cli outside the renderer holds a literal next-step
    sentence of the form "run `awsf". Prove the fence bites on a planted line.
  A schema test over one stub attempt per state.

DO NOT
  Snapshot the output. The spine asks for a property test, so a changed table must fail for a
    reason, not for a diff.

BUILDER READY
  The property, availability, parity, fence and schema tests are green. Each property,
    availability, parity and fence check has a planted-defect case that fails.
  npm run test:unit (count against the base), npm run test:journeys, npm run typecheck and
    npm run lint pass.

OWNER ACCEPTANCE
  Journey w01-m3: run awsf next --json on a stub attempt at DRAFT and at AWAITING_OWNER; check
  that every step the CLI would accept is listed with the right owner, and that land, journey,
  rework, review and cancel show who: owner. Also inspect pure synthetic GATING and REVIEWING
  outputs: L10/L16 are visible as unavailable with the machine's actors and an explanation, no
  command or who, and never a recommended action. Do not move a live attempt to create fixtures.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: test(lifecycle): hold awsf next equal to the task machine for every state
  Body: what changed and why, the planted-defect cases, the test counts.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 7's rows and Milestone M3's marker in
  specs/awsf-v3-w01-driver-checks.html and this ticket's state move together in one commit
  (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T11 and for W05 (who values it extends).
  Edit no ticket file.
```

### T08 — The preflight record and its fields

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 8 of 13. Plan: specs/awsf-v3-w01-driver-checks.html, milestone M4, task 8.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  Gate G01-F: the owner's confirmed forensics rows are recorded as an Amendment in
  specs/awsf-v3-w01-driver-checks.html. If that Amendment changes K1's field list, the
  Amendment wins over this prompt. Without it, stop and report.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w01-driver-checks-build-prompts.md
  specs/awsf-v3-w01-driver-checks.html - K1's fields (the table and Freshness), the G01-F
    Amendment, the Identifier Spine, task 8
  docs/driving/skills/awsf/cookbooks/preflight_a_task.md - the four lines and the green flag
    this replaces (protected; read only)
  core/src/policy/path-policy.ts - matchesPathGlob (protected; read only, import it)
  awsf.config.yaml - agents' writes, policy.protected_paths, workflows (read only)
  core/src/workflow/shift/ - what a shift builder can write
  core/src/contracts/attribution-record.ts - the house style for a record schema

DO
  Create core/src/contracts/driver-preflight.ts with two TypeBox schemas and validators:
    awsf.driver-preflight/v1: project, taskId, attempt, sessionId, baseSha, configDigest,
      requestDigest, where, read, consulted, fields (one per field id: id, kind measured or
      attested, passed, reason), suite (source landed-attempt or preflight-run, gate rows),
      protectedPlan (path, phase), at.
    awsf.request-confirmation/v1: project, taskId, attempt, requestDigest, pathsDigest, at.
  Create core/src/preflight/fields.ts: one pure evaluator per measured field, over facts a
    caller gathered, each returning pass or a refusal with a reason a person can act on:
    suite, write-boundary, protected-paths, git-storage, duplicate, request-shape,
    prior-attempts. And confirmation's check: a record exists whose digests match.
  The protected-paths scan: extract path-shaped tokens from the whole request, match them
    against policy.protected_paths, and require each match in where or read. Its false
    positives are resolved by read, never by loosening the scan.
  Shift rules: a where entry outside what a shift builder can write fails write-boundary; a
    protected where entry on a shift fails protected-paths.
  The freshness rule as one pure function: given a record, the current base, digests and the
    re-measured git-storage and duplicate facts, pass or the first stale or failing field.

DO NOT
  Read a file, run Git or ask the clock in fields.ts. Callers gather; evaluators judge.
  Accept a driver statement for any field. where, read and consulted are inputs, checked.
  Add a field the G01-F Amendment did not keep, or drop one it kept.

BUILDER READY
  Tests: each evaluator's pass and each refusal reason; the shift rules; the scan on the
    request text of forensics #34's shape (a protected path named as context), refused until
    it is classified; the freshness function on every stale input.
  npm run test:unit passes; npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  None for this ticket alone. M4's acceptance is task 13's list.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(preflight): add the driver preflight record and its field evaluators
  Body: what changed and why, the field list as frozen by G01-F, the test counts.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 8's rows in
  specs/awsf-v3-w01-driver-checks.html and this ticket's state move together in one commit
  (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T09 to T13 and for W02 (the refusal reasons
  as trap expectations). Edit no ticket file.
```

### T09 — awsf preflight measures, reuses or runs the suite, and journals the record

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 9 of 13. Plan: specs/awsf-v3-w01-driver-checks.html, milestone M4, task 9.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T08 landed. T06 landed (next lists preflight at DRAFT).

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w01-driver-checks-build-prompts.md
  specs/awsf-v3-w01-driver-checks.html - K1's fields, W01-Q5, task 9, the Fences table
  core/src/preflight/fields.ts, core/src/contracts/driver-preflight.ts - T08's work
  core/src/cli/commands/start.ts - how start resolves the base, creates a worktree and seeds it
  core/src/cli/commands/production-run.ts - how gates run and are recorded as rows
  core/src/git/worktrees.ts, core/src/git/changes.ts - createWorktree, seedWorktreePaths,
    assertClean, runGit
  core/src/observability/attempt-evidence.ts, core/src/observability/projector.ts
  core/test/unit/meta/no-destructive-paths.test.ts - what core/src may never contain

DO
  Add core/src/cli/commands/preflight.ts and its arm:
    awsf preflight <task> --where <glob>... [--read <path>...] [--consulted <session-id>...]
    [--json]. DRAFT only. Not an owner act: no owner terminal.
  Gather every fact: the base L1 would pin (HEAD, or a replay or seed base, exactly as start
    resolves it); the configuration and its digest; the request and its digest; the recipe's
    writing agents; the journal's attempts for this task and its continuation chain; other
    tasks' request digests and plan refs; the modes of the Git common directory's HEAD and
    config files and of the worktree root, read with stat and never written.
  Suite: reuse the landed attempt's recorded gate rows when its candidate SHA is the base and
    the gate configuration digest matches. Otherwise run every configured gate in the
    project's baseline worktree: created once under the worktree root, re-pointed at the base
    with a detached checkout after assertClean, seed paths applied, gates run through the
    existing runner and the transport broker. Never remove or prune it.
  Evaluate with T08's evaluators and append one driver-preflight evidence record, whether or
    not every field passed. The projector writes one events row for it, and awsf db rebuild
    reproduces it.
  Print one line per field (pass, or the refusal's reason) and, with --json, the record.
  Register preflight in CLI_COMMANDS and the cheatsheet, and add it to next-steps.ts's
    non-transition acts at DRAFT with who: driver.

DO NOT
  Create a worktree per run, or delete one. Invariant 8 and no-destructive-paths forbid it.
  Write a probe file to test modes.
  Run gates in the owner's checkout.
  Accept a flag that marks a field passed.

BUILDER READY
  Tests on synthetic repositories: a reused suite (landed candidate at the base) runs no gate;
    a missing record runs every gate once in the baseline worktree and a second run at the same
    base reuses that worktree; a dirty baseline worktree is refused, not cleaned; each field's
    refusal is recorded.
  npm run test:unit and npm run test:journeys pass; npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  None for this ticket alone. M4's acceptance is task 13's list.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(preflight): add awsf preflight with suite reuse and a reusable baseline worktree
  Body: what changed and why, the measured suite time on this host, the test counts.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 9's rows in
  specs/awsf-v3-w01-driver-checks.html and this ticket's state move together in one commit
  (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T10 to T13 and for W02 (the baseline
  worktree, which doctor can report). Edit no ticket file.
```

### T10 — awsf confirm, built unregistered

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 10 of 13. Plan: specs/awsf-v3-w01-driver-checks.html, milestone M4, task 10.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T08 and T09 landed. W01-Q3 decided; this prompt assumes its recommendation, awsf confirm. If
  the owner decided otherwise, stop and report.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w01-driver-checks-build-prompts.md
  specs/awsf-v3-w01-driver-checks.html - K1's confirmation row, Execution (G01-C), task 10,
    W01-Q3
  core/src/cli/commands/attribute.ts - the owner-terminal shape this act copies, and its
    header comment on why it was first built unregistered
  core/src/cli/tty.ts - OwnerTerminal
  core/test/unit/meta/boundary-claims.test.ts - why the arm cannot land without the guard verb

DO
  Add core/src/cli/commands/confirm.ts exporting confirmCommand(options). The medium first: a
    non-interactive terminal is refused before anything is read.
  Show the owner, in order: the task and attempt; the four request lines; where and read from
    the latest preflight record; each consulted prior attempt with its blocker and its cause, if
    one is recorded; each field's result from that record, or that none exists yet.
  On yes, append one request-confirmation evidence record bound to the request digest and the
    digest of where and read; the projector writes its events row. On no, write nothing.
  Write the header comment: built unregistered; gate G01-C wires the arm, CLI_COMMANDS, the
    owner-act table in next-steps.ts, the cheatsheet and the guard verb in one owner commit.

DO NOT
  Add a confirm arm to main.ts, or confirm to CLI_COMMANDS or the cheatsheet. Any of these
    without the guard verb turns boundary-claims or cheatsheet-reconciliation red.
  Accept a flag that records a confirmation without the terminal.

BUILDER READY
  Tests drive confirmCommand with a fake owner terminal: non-interactive is refused with
    nothing read; declined writes nothing; confirmed writes one record with the right digests;
    a later request edit makes the record stale under T08's freshness function.
  npm run test:unit passes; npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  Gate G01-C, after this ticket lands and before T11 lands: the owner wires awsf confirm in one
  commit, as the plan's G01-C card lists.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(confirm): add the owner's request confirmation, unregistered until G01-C
  Body: what changed and why, the exact G01-C file list, the test counts.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 10's rows in
  specs/awsf-v3-w01-driver-checks.html and this ticket's state move together in one commit
  (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give the exact G01-C diff list for the owner, and dated findings for
  T11 and W08 (the record W08's card must write). Edit no ticket file.
```

### T11 — awsf start refuses L1 without a fresh record and a confirmation

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.
  This ticket edits many tests. If awsf workflows shows corrections fundable of 1 or less for
  its route, prepare an awsf raise for the owner before start.

TASK 11 of 13. Plan: specs/awsf-v3-w01-driver-checks.html, milestone M5, task 11.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T06, T09 and T10 landed, and gate G01-C is at your base (awsf confirm is wired and denied to
  the driver). W01-Q2 and W01-Q4 decided; this prompt assumes their recommendations. If the
  owner decided otherwise, stop and report.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w01-driver-checks-build-prompts.md
  specs/awsf-v3-w01-driver-checks.html - K1's fields and Freshness, INV-1 and INV-2, task 11,
    W01-Q2, W01-Q4, Risks R3 and R4
  core/src/cli/commands/start.ts - startCommand, its ordering comments and its test seams
  core/src/cli/main.ts - the start arm, its --stub injection, and the intake path that calls
    startCommand inline
  core/src/preflight/fields.ts, core/src/cli/commands/preflight.ts, confirm.ts
  core/src/lifecycle/next-steps.ts
  Every test that calls startCommand or runs awsf start (39 call sites in 23 files at 0da3640)

DO
  In startCommand, after the DRAFT check and before config side effects, the worktree and any
    adapter: unless the workflow is prove or intake, read the latest driver-preflight and
    request-confirmation records, re-measure git-storage and duplicate, and apply T08's
    freshness function. On failure, append one preflight-refused evidence record naming the
    field and its reason, leave the attempt in DRAFT, and throw a typed error that names the
    field and the command that fixes it (awsf preflight, or the owner's awsf confirm).
  The --stub injection in main.ts keeps its adapter preflight and does not skip K1.
  Add a fence test: start.ts is the only module under core/src that requests a transition
    from DRAFT to PREPARED. Prove it bites on a planted second site.
  In next-steps.ts, fill the L1 step's requires with each missing, stale or failing field.
  Add one shared test helper that runs the real preflight path on a synthetic repository and
    writes a real confirmation record, and move every test that starts an attempt onto it.

DO NOT
  Fire L2 or any transition on a K1 refusal. The attempt stays DRAFT and reserves nothing.
  Add a seam the CLI can reach that skips K1. A programmatic test seam is allowed only if no
    CLI path can set it, and the helper above is preferred.
  Edit core/src/state/**.

BUILDER READY
  Tests: one refusal per field on the stub adapter, each leaving DRAFT with callsReserved 0 and
    one preflight-refused record; stale refusals for HEAD, configuration, request and paths;
    prove and intake start without records; awsf start --stub true still refuses without
    records; the fence and its planted-defect case.
  npm run test:unit, npm run test:contract, npm run test:sim and npm run test:journeys pass;
    npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  None for this ticket alone. M5's acceptance is task 13's list. From this landing on, the
  owner confirms each new task with awsf confirm before it starts.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(start): refuse DRAFT to PREPARED without a fresh preflight and a confirmation
  Body: what changed and why, the tests moved onto the helper, the test counts.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 11's rows in
  specs/awsf-v3-w01-driver-checks.html and this ticket's state move together in one commit
  (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T12, T13 and W02 (the refusal records and
  the helper W02's traps can reuse). Edit no ticket file.
```

### T12 — The runner refuses a writing phase that lacks its recorded grant

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 12 of 13. Plan: specs/awsf-v3-w01-driver-checks.html, milestone M5, task 12.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message. This task is prepared under K1:
  the driver runs awsf preflight and the owner runs awsf confirm before awsf start.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T09 landed (the record carries the protected-path plan). T11 landed.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w01-driver-checks-build-prompts.md
  specs/awsf-v3-w01-driver-checks.html - Problem (a grant cannot exist at L1), the
    protected-paths row, task 12, Rejected (every grant at L4)
  core/src/cli/commands/grant.ts - when a grant is legal and what it binds
  core/src/cli/commands/production-run.ts - route resolution before any reservation, and
    protectedGrantSubject
  core/src/workflow/protected-grants.ts - readProtectedState

DO
  Before an agent phase reserves its first call, read the latest driver-preflight record's
    protectedPlan and the attempt's recorded grants. Refuse when the phase's role writes a
    planned path and no grant for that phase is recorded.
  For the first writing phase the refusal comes before L4: the attempt stays PREPARED, where
    awsf grant is legal, with zero calls reserved, and the error names the phase, the paths and
    the awsf grant line the owner runs.
  For a later writing phase the refusal comes before that phase's reservation. Earlier phases'
    calls are already spent, and the error says so.
  Journal the refusal as evidence. In next-steps.ts, list grant with who: owner and the phase it
    is owed to.

DO NOT
  Require grants for phases that write no planned path.
  Issue, imply or pre-fill a grant. Granting is the owner's act.
  Edit core/src/policy/** or core/src/execution/transport-broker.ts.

BUILDER READY
  Tests: a build-review attempt whose record plans a protected builder path refuses before L4
    with zero calls reserved and runs after a recorded grant; a plan with no protected path
    runs unchanged; a later-phase case refuses at that phase's boundary and reports the spent
    calls.
  npm run test:unit and npm run test:journeys pass, the protected-grant journeys included;
    npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  None for this ticket alone. M5's acceptance is task 13's list.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(run): refuse a writing phase that lacks its planned protected grant
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 12's rows in
  specs/awsf-v3-w01-driver-checks.html and this ticket's state move together in one commit
  (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T13 and W02 (the later-phase case as a
  trap candidate). Edit no ticket file.
```

### T13 — Testing Strategy for M4, the forensics map, and the workstream's closing duties

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 13 of 13. Plan: specs/awsf-v3-w01-driver-checks.html, milestone M5, task 13.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message. This task is prepared under K1.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T03, T04, T07, T11 and T12 landed; G01-G landed.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w01-driver-checks-build-prompts.md
  specs/awsf-v3-w01-driver-checks.html - the whole plan; the G01-F Amendment; Notes (the
    forensics map, the handoff findings)
  specs/awsf-v3-plan.html - W01's block: its stop-when and its checklist
  core/src/preflight/, core/src/cli/commands/{preflight,confirm,start,next,cancel}.ts

DO
  One journey per K1 field on the stub adapter: the attempt stays DRAFT, callsReserved is 0,
    and one preflight-refused record names the field. Name each test with its field id, so W02
    can adopt them as traps.
  Journeys for the stale cases: HEAD moved, configuration changed, request edited, and paths
    edited after confirmation.
  A full stub journey: new, preflight, confirm, start, run, and a cancel with a cause, which
    awsf metrics then counts.
  Re-check the forensics map in the plan's Notes against the G01-F rows: name the test that
    refuses each in-reach row, and the reason and taker for each out-of-reach row.
  Run the whole suite and record every count.

DO NOT
  Mark anything done. Markers and states are the owner's bookkeeping.
  Add a trap layer or an npm script. test:traps is W02's (spine Q2).

BUILDER READY
  The journeys above are green; npm run test:unit, npm run test:contract, npm run test:sim,
    npm run test:journeys, npm run typecheck and npm run lint all pass, with counts.
  Your notes carry the closing record: each task's final state, landing SHAs, gate counts,
    decisions taken (W01-Q1 to W01-Q7), surprises, and the handoff findings for W02, W05, W08
    and W10, updated from the plan's Notes.

OWNER ACCEPTANCE
  Journey w01-m4: on a throwaway task, see awsf start refuse with the field named and no call
  spent; run awsf preflight, then awsf confirm, then see awsf start prepare it.
  Journey w01-driver-checks, the workstream: every row of the forensics map is refused by a
  named test or recorded as out of K1's reach with its taker; awsf next lists every legal step
  with its owner; the guard denies every spelling; awsf metrics lists no new stop or cancel
  without a cause.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: test(preflight): prove each K1 refusal and close the driver-checks workstream
  Body: what changed and why, the forensics map's result, every suite count.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 13's rows and Milestone M5's marker in
  specs/awsf-v3-w01-driver-checks.html and this ticket's state, and the spine's Milestone M1
  (W01) rows in specs/awsf-v3-plan.html with specs/tickets/awsf-v3-plan/W01.md's state, all in
  one commit with a dated Amendment in each plan (invariants 2 and 12). Return the evidence.
  Edit none of these files.

HANDOFF
  Your closing record is the handoff. The owner persists its W02, W05, W08 and W10 findings in
  those spine tickets' ## Handoff sections. Edit no ticket file.
```
