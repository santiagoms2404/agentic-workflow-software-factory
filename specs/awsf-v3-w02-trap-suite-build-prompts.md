# AWSF v3 W02 — Trap suite: build prompts

> **Plan:** [`awsf-v3-w02-trap-suite.html`](awsf-v3-w02-trap-suite.html) · **Spine:** [`awsf-v3-plan.html`](awsf-v3-plan.html) § Workstreams → Milestone M2 → W02
> **Tickets:** [`tickets/awsf-v3-w02-trap-suite/`](tickets/awsf-v3-w02-trap-suite/) — one file per task, each carrying the same prompt this file's Section B holds.

This file exists because this repository's invariant-12 fence requires it:
`core/test/unit/meta/ticket-plan-sync.test.ts` asserts a `<stem>-build-prompts.md` exists for every
plan source with a ticket set, and that each ticket's prompt is **byte-identical** to its
`### Tnn — ` block below.

# Section A — Conventions

**Read first, on every task.** `AGENTS.md` in full · `specs/awsf-v3-w02-trap-suite.html` (Problem,
Solution with "The trap, defined" and "The population and the cut", the Identifier Spine and
Execution in full, then the task's own section) · `specs/tickets/awsf-v3-w02-trap-suite/README.md`.

**What W02 is, in one line.** K5: every stop up to a dated cut is rebuilt on the stub adapter and
either refused before any provider call by a trap whose mutant proves it, or recorded with the
reason no trap can exist; every stop after the cut names its trap or its reason; and `awsf doctor`
reports the machine facts behind the stops a trap cannot reach.

**Execution.** Managed by default (spine decision 7): one `build-review` attempt per ticket, tier
derived by `awsf new`. K1 binds every start: `awsf preflight`, the owner's `awsf confirm`, then
`awsf start`. External prerequisites must have landed. In an owner-approved accumulating shift,
selected predecessors need host-committed, gate-passing heads in that worktree, not separate
canonical landings or marker changes mid-shift. Manual execution is a logged exception for a
factory that cannot carry the work.

**The builder's write boundary.** `core/src/**` outside protected paths, `core/test/**`,
`dashboard/**`, `prompts/**`, `docs/cheatsheet.html`. Never `specs/**`, `package.json`,
`AGENTS.md`, `awsf.config.yaml`, `awsf.project.yaml`, `core/src/state/**`, `core/src/policy/**`,
`core/src/observability/migrations/**`, `core/src/execution/transport-broker.ts`,
`docs/driving/**`, or a root `.claude/` directory.

**Owner gates.**
- **G02-S**, after T01 and before T02: the owner confirms or corrects every row of the seed ledger
  T01 lands; recorded as a dated Amendment of the plan. A confirmed row that adds a trappable
  family adds its task to M4 in the same Amendment.
- **G02-L**, after T04: the owner's commit adds `test:traps` to `package.json` and to `npm test`,
  and, per W02-Q5, the `traps` gate to `awsf.config.yaml` with its record in `awsf.project.yaml`.
- **G02-Q**, only if W02-Q7 takes a threshold: `routing.quota_stop` in `awsf.config.yaml`.
- **G02-D**, after T05 and before T16: the cancel and attribute examples and `gotchas.md` under
  `docs/driving/**` gain the trap link.

**The trap contract**, used by every ticket from T03 on. A trap is four things that agree: a
catalogue entry `TR-NN` in `core/src/traps/catalogue.ts`; one test
`core/test/traps/TR-NN-<slug>.test.ts` on `core/test/traps/_harness.ts`; one marker pair
`// trap-refusal-begin TR-NN` … `// trap-refusal-end TR-NN` around the refusing code in `core/src`;
and a mutant, the trap run against a scratch copy of the source with the marked block deleted,
which must fail. Every trap asserts the named refusal, `callsReserved` 0, zero adapter invocations,
and an attempt still DRAFT or PREPARED. A seed that cannot have a trap is a no-trap entry of one
kind: `fixed`, `after-spend`, `owner`, `unexplained` or `not-a-stop`.

**Seed numbers and families.** `#1`–`#36` are the forensics draft's rows; `#37`–`#47` are the plan's
Notes numbering. `T1`–`T7` are the draft's trap families, never ticket ids.

**Owner decisions.** W02-Q1–Q8 were decided on 2026-10-07, each as recommended. Every prompt
applies them; the plan's Questionables record each one.

**The never-do list**, with why each is tempting:
- **Do not add a switch that disables a refusal.** No flag, environment variable or exported
  option. The mutant deletes source in a scratch copy; a switch is a bypass any caller can reach.
- **Do not count a trap whose mutant stays green.** A trap that has never failed proves nothing.
- **Do not call a check after the first provider call a trap.** It is an `after-spend` mitigation.
- **Do not make a hermetic test read the owner's state root**, and do not commit a stop ledger the
  fence would turn red: a red base refuses every K1 start.
- **Do not copy the owner's run data into a fixture.** Rebuild preconditions from the recorded
  blocker text; name no file with `manifest` or `receipt` in it (invariants 1, 9 and 10).
- **Do not give doctor a repair path**, or list anything for removal (invariant 8).
- **Do not spawn outside the transport broker or use a shell** in `core/src` (invariants 3 and 4).
- **Do not edit `package.json`, a gate file or `docs/driving/**`.** They are the owner's.
- **Do not add a migration or a dependency** (invariants 6 and 7).
- **Never** put an agent, model or AI tool in a commit identity, message or trailer.

# Section B — Task prompts (recommended)

### T01 — Replay the seed stops on the stub adapter and pin today's outcome

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 1 of 16. Plan: specs/awsf-v3-w02-trap-suite.html, milestone M1, task 1.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  None inside W02. W01 is closed (spine M1 [x]). W02-Q1 decided by the owner.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w02-trap-suite-build-prompts.md
  specs/awsf-v3-w02-trap-suite.html - Solution ("The trap, defined", "The population and the
    cut"), Notes ("The seed ledger, proposed"), task 1
  specs/awsf-v3-w01-driver-checks.html - Notes ("The forensics map"), the 2026-10-07 Amendments
  core/test/journeys/k1-driver-checks.test.ts, core/test/fixtures/k1-preflight.ts - prepareK1,
    startUnderK1 and the INV-1-shaped assertions to reuse
  core/test/journeys/production-runner.test.ts - the production runner on stub routes, its fake
    broker
  core/src/state/errors.ts - EDGE_BLOCKER_CODES (protected, read only)
  docs/driving/skills/awsf/references/gotchas.md - the eleven live gotchas (protected, read only)

DO
  Create core/src/traps/seeds.ts: one row per population stop up to the cut (the 47 rows in the
    plan's Notes) and per live gotcha (gotchas 1-11 and the handoff's C5 and C8 items). Each row:
    source (project, task, attempt; or gotcha id), date, recorded blocker code, family, outcome
    (refused | gap | fixed | after-spend | owner | unexplained | not-a-stop) and one evidence line.
  For every seed whose preconditions can be rebuilt before any provider call, add a replay test
    under core/test/traps/replay/ that builds them in a synthetic repository and state root on the
    stub adapter and asserts today's outcome: the named refusal with callsReserved 0, or a pinned
    KNOWN GAP asserting that a provider call is reached, with a comment naming the M4 task that
    will flip it.
  For every other seed, record its no-trap kind and the evidence that rules a trap out: the
    blocker's own detail, or the fixing commit and the regression test that keeps it fixed
    (search git log and the tests; name both).
  Add core/src/traps/population.ts with the pure population rule (registered project, BLOCKED or
    CANCELLED, workflow not prove, terminal at or before the cut) and a test that applies it to a
    synthetic state root and selects exactly the expected attempts, prove replays excluded.
  Check the plan's proposed classification row by row. Every disagreement goes in your handoff
    with its evidence, for G02-S.

DO NOT
  Copy any journal, status file or provider output from the owner's state root into a fixture.
    Rebuild each precondition from the recorded blocker text.
  Fix a gap you find. M4 flips gaps; this ticket pins them.
  Add a refusal marker, a catalogue module or an npm script.

BUILDER READY
  Every seed row is present and has an outcome and evidence; the row count equals the plan's.
  node --experimental-strip-types --test "core/test/traps/**/*.test.ts" passes, each KNOWN GAP
    asserting what happens today.
  npm run test:unit passes; npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  G02-S: the owner confirms or corrects the ledger, row by row, before T02 starts.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: test(traps): replay the seed stops on the stub adapter and pin today's outcome
  Body: what changed and why, the test counts, the classification totals, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands and G02-S is recorded: task 1's rows in
  specs/awsf-v3-w02-trap-suite.html and this ticket's state move together in one commit
  (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T02, T08-T12 and G02-S: each disagreement
  with the plan's proposed ledger and its evidence, each gap and the task that should take it, any
  seed whose family M4 does not hold. The owner copies them into those tickets' ## Handoff.
  Edit no ticket file.
```

### T02 — The trap catalogue and its population rule

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 2 of 16. Plan: specs/awsf-v3-w02-trap-suite.html, milestone M2, task 2.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T01 landed. G02-S recorded as a dated Amendment of the plan.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w02-trap-suite-build-prompts.md
  specs/awsf-v3-w02-trap-suite.html - Solution ("The trap, defined"), the G02-S Amendment, task 2
  core/src/traps/seeds.ts, core/src/traps/population.ts - T01's ledger and rule
  core/src/contracts/attribution-record.ts - the style of a closed vocabulary with its comment

DO
  Create core/src/traps/catalogue.ts:
    TRAP_CUT, the cut instant W02-Q1 decided.
    NO_TRAP_KINDS: fixed, after-spend, owner, unexplained, not-a-stop, each defined in a comment
      as the plan's Solution defines it.
    Trap entries: id TR-NN, family, title, seeds (ledger keys), refusal point (k1-field | start |
      run-before-l4 | owner-act | shift-admission) and the refusal's error or record name.
    No-trap entries: seed, kind, evidence.
  Turn the confirmed ledger into entries: each refused seed joins a trap (one trap may cover
    several seeds of one shape), each no-trap seed becomes a no-trap entry, and each gap seed is
    listed as pending under the M4 task id that will build its trap.
  Make population.ts the one population rule: the seed ledger's test and the later awsf traps
    readout both import it.
  Tests: trap ids unique and contiguous from TR-01; every ledger seed in exactly one entry or one
    pending list; every no-trap kind from the closed set; TRAP_CUT parses as an instant.

DO NOT
  Write a trap test, a marker or the harness. T03 and T04 do.
  Add a field to the ledger rows that G02-S did not confirm.
  Put the catalogue under core/test: awsf traps and awsf attribute read it at runtime.

BUILDER READY
  The catalogue accounts for every ledger row.
  npm run test:unit passes; npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  None for this ticket alone. M2's acceptance is task 4's list.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(traps): add the trap catalogue, its cut and the population rule
  Body: what changed and why, the test counts, the catalogue's size by trap and by kind.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 2's rows in
  specs/awsf-v3-w02-trap-suite.html and this ticket's state move together in one commit
  (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T03, T04, T05 and T06: the catalogue's final
  shape, the id assigned to each existing refusal, and the pending list per M4 task. The owner
  copies them into those tickets' ## Handoff. Edit no ticket file.
```

### T03 — The harness, the mutant, and the catalogue fence

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 3 of 16. Plan: specs/awsf-v3-w02-trap-suite.html, milestone M2, task 3.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T02 landed.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w02-trap-suite-build-prompts.md
  specs/awsf-v3-w02-trap-suite.html - "The trap, defined", INV-1, INV-2, INV-3, INV-7, task 3,
    W02-Q4
  core/src/traps/catalogue.ts - the entries the fence checks
  core/test/journeys/k1-driver-checks.test.ts, core/test/fixtures/k1-preflight.ts,
    core/test/journeys/production-runner.test.ts - the fixtures the harness generalizes
  core/test/unit/meta/_walk.ts and child-process-fence.test.ts - how fences walk the tree
  core/src/state/errors.ts - EDGE_BLOCKER_CODES (protected, read only)

DO
  core/test/traps/_harness.ts: a synthetic repository and state root, this checkout's
    configuration with offline gates only, stub routes, the production runner's fake broker
    (recording bwrap by its resolved path, as 7bc48b5 does), and assertRefusedBeforeSpend(): the
    refusal's name, callsReserved 0, zero stub adapter invocations, lifecycle DRAFT or PREPARED,
    and no attempt worktree for a preparation-time refusal. Move shared fixtures out of journey
    files into core/test/fixtures/ where both layers need them.
  core/test/traps/_mutate.ts: copy the source tree a trap imports to a scratch directory, link
    node_modules, delete the lines between one "// trap-refusal-begin TR-NN" and its
    "// trap-refusal-end TR-NN", run that trap's file against the copy with node and an argv
    array (no shell), and require a non-zero exit whose output names the trap's refusal
    assertion. A marker pair missing from the copy is itself a failure.
  A helper each trap file calls as its last test to run its own mutant (W02-Q4).
  core/test/unit/meta/trap-catalogue.test.ts: each catalogue trap id has exactly one test file
    and exactly one balanced, non-nested marker pair in core/src, outside protected paths; each
    marker names a catalogued trap; every EDGE_BLOCKER_CODES (edge, code) pair is covered by a
    trap's family or a no-trap kind, through an explicit coverage table in the catalogue.
  Planted defects for the fence, each red: an unmarked refusal's trap (mutant stays green), a
    duplicate id, a marker with no entry, an entry with no test, an uncovered blocker code.

DO NOT
  Add a refusal switch, flag or exported option to core/src to make mutation easier.
  Import node:child_process anywhere under core/src.
  Write a real trap. T04 adopts the first ones.

BUILDER READY
  The fence passes on the T02 catalogue, with pending entries allowed only under M4 task ids.
  A demonstration trap in a test-only fixture source tree goes green, and red under its mutant.
  npm run test:unit passes; npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  None for this ticket alone. M2's acceptance is task 4's list.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: test(traps): add the trap harness, the source mutant and the catalogue fence
  Body: what changed and why, the test counts, one mutant's measured run time.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 3's rows in
  specs/awsf-v3-w02-trap-suite.html and this ticket's state move together in one commit
  (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T04 and T08-T12: the harness API, the marker
  rules as built, the mutant's cost, and any refusal shape the marker pair cannot isolate. The
  owner copies them into those tickets' ## Handoff. Edit no ticket file.
```

### T04 — Testing Strategy for M2: the first traps from existing refusals, and the gate's code half

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 4 of 16. Plan: specs/awsf-v3-w02-trap-suite.html, milestone M2, task 4.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T02 and T03 landed.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w02-trap-suite-build-prompts.md
  specs/awsf-v3-w02-trap-suite.html - task 4, G02-L, W02-Q5
  specs/awsf-v3-plan.html - Amendments of 2026-10-02 (how the journeys gate's code half landed)
  core/src/traps/catalogue.ts, core/test/traps/_harness.ts, core/test/traps/_mutate.ts
  core/test/journeys/k1-driver-checks.test.ts - the eight K1 field journeys (C7)
  core/src/preflight/fields.ts - each field's refusal (C6)
  core/src/cli/commands/production-run.ts - the grant refusal before L4 (W01 T12)
  core/src/config/schema.ts - KNOWN_GATE_IDS; and every test config that copies awsf.config.yaml
    and deletes "journeys" (find them by that deletion line)

DO
  Adopt K1's eight field refusals as traps, one per field (suite, write-boundary,
    protected-paths, git-storage, duplicate, request-shape, prior-attempts, confirmation), with
    the ids T02 assigned: marker pair around each evaluator's refusal in core/src/preflight/,
    a trap file on the harness rebuilding its seed's shape, and a passing mutant. The four stale
    journeys stay where they are.
  Adopt the runner's grant check as the trap for #34's run-time half: refused before L4 with the
    attempt PREPARED.
  Adopt every live gotcha G02-S classified as an existing refusal (gotchas 1, 2 and 9 proposed).
  The gate's code half, as the journeys gate's landed: "traps" in KNOWN_GATE_IDS, a deletion line
    for it in every test config that copies the shipped gates, gate|traps and its prose in
    docs/cheatsheet.html, and the unit tests that bind every configured gate passing on a
    configuration that includes it.
  Measure node --experimental-strip-types --test "core/test/traps/**/*.test.ts" alone on the
    host, wall time, and return it for G02-L's timeout.

DO NOT
  Edit package.json, awsf.config.yaml or awsf.project.yaml. G02-L is the owner's.
  Remove or weaken a K1 journey; the traps sit beside them.

BUILDER READY
  Every adopted trap is green and its mutant red; the catalogue fence passes with these entries.
  npm run test:unit and npm run test:journeys pass; npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  M2's acceptance: the owner sees one trap fail when its marked refusal is deleted, and lands
  G02-L with the measured timeout.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: test(traps): adopt the existing refusals as traps and add the traps gate id
  Body: what changed and why, the test counts, the layer's measured wall time.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands and G02-L lands: task 4's rows and the M2
  header in specs/awsf-v3-w02-trap-suite.html and this ticket's state move together in one
  commit (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T05-T16 and G02-L: the measured time, the
  test configs changed, and any existing refusal that could not be isolated by markers. The
  owner copies them into those tickets' ## Handoff. Edit no ticket file.
```

### T05 — The trap link on the cause record

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 5 of 16. Plan: specs/awsf-v3-w02-trap-suite.html, milestone M3, task 5.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T02 landed.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w02-trap-suite-build-prompts.md
  specs/awsf-v3-w02-trap-suite.html - task 5, W02-Q2, W02-Q3
  core/src/contracts/attribution-record.ts - awsf.attribution/v1
  core/src/cli/commands/attribute.ts, cancel.ts - both owner acts and their pre-prompt checks
  core/src/persistence/task-attributions.ts, core/src/observability/projector.ts - storage and
    the attribution events row
  core/src/metrics/causes.ts, core/src/metrics/attribution.ts, dashboard/src/metrics-run.ts -
    every reader of the record
  core/src/traps/catalogue.ts - NO_TRAP_KINDS

DO
  Add awsf.attribution/v2: v1's fields plus a required trap, either { kind: "trap", id } with a
    well-formed TR-NN, or { kind: "none", because, reason } with because from NO_TRAP_KINDS. An id
    the catalogue lacks is accepted when well-formed (W02-Q2): naming a trap before it exists is
    the visible gap awsf traps reports.
  awsf attribute and awsf cancel take --trap TR-NN or --no-trap <kind> "<why>", validated before
    the confirmation prompt and before any process is signalled, with the credential check
    --reason already has. Per W02-Q3, cause owner may omit both and records { kind: "none",
    because: "owner" } with its reason as the text; every other cause must give one.
  The prompt shows the link beside the cause and reason. A declined act writes nothing.
  Readers accept v1 and v2; a v1 record counts as written before the link existed. The projector
    writes the link into the existing attribution events row, and awsf db rebuild reproduces it.
  Every test and journey that attributes or cancels passes a link where one is required; the
    cheatsheet and both usage strings show the flags.

DO NOT
  Add a migration or a projection column. The events row carries the record.
  Let any non-owner path write a link. attribute and cancel stay owner acts.
  Edit docs/driving/**. G02-D updates the driving examples.

BUILDER READY
  Tests: a required link missing, a malformed id, an unknown kind, or a credential-shaped reason
    is refused with nothing written and no signal sent; an owner cancel with no link records the
    owner kind; a confirmed act writes one v2 record and one events row; rebuild reproduces it.
  npm run test:unit and npm run test:journeys pass; npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  None for this ticket alone. M3's acceptance is task 7's list.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(attribution): name a trap or a no-trap reason on every cause record
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 5's rows in
  specs/awsf-v3-w02-trap-suite.html and this ticket's state move together in one commit
  (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T06, T07 and G02-D: the record's final shape,
  every driving example that now needs a link, and every reader touched. The owner copies them
  into those tickets' ## Handoff. Edit no ticket file.
```

### T06 — awsf traps, the coverage readout

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 6 of 16. Plan: specs/awsf-v3-w02-trap-suite.html, milestone M3, task 6.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T02 and T05 landed.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w02-trap-suite-build-prompts.md
  specs/awsf-v3-w02-trap-suite.html - task 6, W02-Q2, Notes (the W08 handoff on mp-s5-checks)
  core/src/traps/catalogue.ts, core/src/traps/population.ts
  core/src/cli/commands/metrics.ts, core/src/metrics/causes.ts - how causes are read today
  core/src/cli/commands/next.ts - a read-only command with --json and a registered schema
  core/src/cli/main.ts - CLI_COMMANDS
  specs/design/awsf-v3-plan/frame-index.json - frame mp-s5-checks, the K5 card (data shape only)

DO
  awsf traps [--json]: read-only, no lock, no owner terminal, not an owner act; registered in
    CLI_COMMANDS and the cheatsheet. It reads the catalogue and every registered project's state
    root through the population rule.
  core/src/contracts/traps-readout.ts: awsf.traps/v1 with the cut; catalogue counts by trap and
    by no-trap kind; the stops since the cut split into linked to a catalogued trap, linked to a
    no-trap reason, linked to a trap the catalogue lacks, and unlinked, each listed by project,
    task and attempt; the next free trap id; and, per project, whether the newest landed
    attempt's gate rows include a passing traps gate and at which base.
  Exit 1 while any stop since the cut is unlinked or names a missing trap, else 0. The text form
    says which and that the command reports and never repairs.

DO NOT
  Run the trap layer from the command. Its result comes from landed gate rows.
  Write to the state root or the projection.

BUILDER READY
  Tests over a synthetic state root with a pre-cut stop, a post-cut linked stop, a post-cut
    unlinked stop, a post-cut stop naming TR-99, a prove replay and a landed attempt with a traps
    gate row: exact lists, counts, next id and exit code; every --json output validates.
  npm run test:unit passes; npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  None for this ticket alone. M3's acceptance is task 7's list.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(traps): report trap coverage of every stop since the cut
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 6's rows in
  specs/awsf-v3-w02-trap-suite.html and this ticket's state move together in one commit
  (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T07, T13 and T16: the schema, the exit rule,
  and the doctor row it should feed. The owner copies them into those tickets' ## Handoff. Edit
  no ticket file.
```

### T07 — Testing Strategy for M3

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 7 of 16. Plan: specs/awsf-v3-w02-trap-suite.html, milestone M3, task 7.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T05 and T06 landed.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w02-trap-suite-build-prompts.md
  specs/awsf-v3-w02-trap-suite.html - M3, AC-3
  The tests T05 and T06 added

DO
  Fill any gap in M3's proof: an attribute or cancel with a missing required link, a malformed
    id, an unknown kind or a credential-shaped reason refused with nothing written and no signal;
    a v1 then a v2 record for one attempt, the latest winning; awsf traps over a synthetic state
    root with one stop of each kind returning the exact lists and exit code.
  One journey through main(): a stub task is cancelled with --cause factory --no-trap fixed
    "<why>", and awsf traps then counts it as linked; a second is cancelled naming a missing
    TR-NN, and awsf traps exits 1 naming it.
  Run the full set of layers this milestone touches.

DO NOT
  Change the record or the readout's shape. Return a contradiction instead.

BUILDER READY
  npm run test:unit, npm run test:journeys and npm run test:traps pass; npm run typecheck and
  npm run lint exit 0.

OWNER ACCEPTANCE
  M3's acceptance: the owner attributes one real post-cut stop with a link, and awsf traps on the
  owner's state root lists it as linked.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: test(traps): prove trap links and the coverage readout end to end
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 7's rows and the M3 header in
  specs/awsf-v3-w02-trap-suite.html and this ticket's state move together in one commit
  (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T16: the readout's result on any real state
  you were shown, and remaining gaps. The owner copies them into that ticket's ## Handoff. Edit
  no ticket file.
```

### T08 — The launch environment: an executable that does not resolve refuses before L4

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 8 of 16. Plan: specs/awsf-v3-w02-trap-suite.html, milestone M4, task 8.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T01 and T03 landed. G02-S recorded.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w02-trap-suite-build-prompts.md
  specs/awsf-v3-w02-trap-suite.html - Problem (the launch environment), task 8
  core/src/adapters/interface.ts, claude-code.ts (isAvailable around line 346), pi-codex.ts,
    pi-openrouter.ts, antigravity.ts, stub.ts
  core/src/execution/transport-broker.ts - resolveExecutable and ExecutableNotFound (protected,
    import only)
  core/src/cli/commands/production-run.ts - where the run reaches L4 and reserves its first call
  core/test/traps/replay/ - T01's pinned gaps for #11 and #17

DO
  Each adapter's isAvailable() resolves its executable with resolveExecutable against the
    environment the broker will give the child, and on failure reports the name, the PATH
    searched and any obstruction (not ENOENT) it met.
  Before L4, the runner asks every adapter the recipe's phases will use, review included, and
    refuses with a typed error naming the adapter, the phase and the PATH, leaving the attempt
    PREPARED with zero calls reserved.
  Mark the refusal with the trap's marker pair; add the trap on the harness rebuilding #17's
    shape (a PATH holding the executable for one environment and not the launch environment)
    and its mutant; flip the replay pins for #11 and #17 to the trap.
  Add the entry to the catalogue, replacing its pending row.

DO NOT
  Spawn the executable to test it. Resolution is the check.
  Change the stub adapter's availability.

BUILDER READY
  The trap is green and its mutant red; the catalogue fence passes.
  npm run test:unit, npm run test:journeys and npm run test:traps pass (or the node --test
    spelling before G02-L); npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  None for this ticket alone. M4's acceptance is task 12's list.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(run): refuse before L4 when a phase's executable does not resolve
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 8's rows in
  specs/awsf-v3-w02-trap-suite.html and this ticket's state move together in one commit
  (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T12 and T13: the resolution helper doctor
  should share, and any adapter whose executable is not a single name. The owner copies them into
  those tickets' ## Handoff. Edit no ticket file.
```

### T09 — Quota at run start: an exhausted window refuses before L4

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 9 of 16. Plan: specs/awsf-v3-w02-trap-suite.html, milestone M4, task 9.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T01 and T03 landed. G02-S recorded. W02-Q7 decided.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w02-trap-suite-build-prompts.md
  specs/awsf-v3-w02-trap-suite.html - Problem (the quota pause), task 9, W02-Q7, G02-Q
  core/src/quota/probe.ts, readout.ts, routes.ts
  core/src/cli/commands/production-run.ts - the phase-boundary probe (around 3054-3130) and the
    resume check (around 3815)
  core/test/unit/meta/quota-fence.test.ts - what may and may not read quota
  core/test/traps/replay/ - T01's pin for #42

DO
  Before L4, one probe through probeQuota over the routes the recipe's phases will use. A window
    the readout reports exhausted or rejected refuses with a typed error naming the provider,
    the window and its reset time, the attempt PREPARED, zero calls reserved (#42's shape).
  When routing.quota_stop is configured, a route below its threshold refuses the same way. When
    the probe is unavailable, do not refuse: journal the unknown reading as the boundary probe
    does.
  Keep it in the run's start: nothing under core/src/workflow imports the quota module, route
    resolution never reads it, and the refusal chooses no route. The quota fence stays unchanged
    and green.
  Mark the refusal; add the trap (exhausted window at start) and, on a test configuration with a
    threshold, a second trap (below threshold); add their mutants; flip #42's pin.
  Record #18, #22, #39, #41 and #43 as after-spend in the catalogue, naming the phase-boundary
    pause as the mitigation, unless T01 found one already exhausted at its start.

DO NOT
  Edit awsf.config.yaml. A threshold for this project is G02-Q, the owner's.
  Retry, wait or reroute. A refusal stops; W06 owns routing.

BUILDER READY
  Both traps green and both mutants red; the catalogue fence and the quota fence pass.
  npm run test:unit, npm run test:journeys and npm run test:traps pass; npm run typecheck and
    npm run lint exit 0.

OWNER ACCEPTANCE
  None for this ticket alone. M4's acceptance is task 12's list.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(run): refuse before L4 when a phase's quota window is exhausted
  Body: what changed and why, the test counts, the probe's added latency at run start.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 9's rows in
  specs/awsf-v3-w02-trap-suite.html and this ticket's state move together in one commit
  (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T12, T13 and W06: the probe's cost, the
  readout fields reused, and what a route policy would replace. The owner copies them into those
  tickets' ## Handoff. Edit no ticket file.
```

### T10 — A shift ticket that demands a path the shift cannot write

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 10 of 16. Plan: specs/awsf-v3-w02-trap-suite.html, milestone M4, task 10.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T01 and T03 landed. G02-S recorded.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w02-trap-suite-build-prompts.md
  specs/awsf-v3-w02-trap-suite.html - task 10
  specs/awsf-v3-w01-driver-checks.html - K1's fields (write-boundary, protected-paths), the
    forensics map row #27
  core/src/preflight/fields.ts - the path-token scan and the shift reach rule
  core/src/cli/commands/preflight.ts - how a shift's selection reaches preflight
  core/src/workflow/shift/select.ts, core/src/contracts/shift-selection-record.ts - the sealed
    selection and its ticket ids
  core/test/traps/replay/ - T01's pin for #27's remainder

DO
  For a shift, K1's path scan also reads each selected ticket's DO block from the registered
    plan's ticket set. Every path-shaped token there that lies outside the shift builder's reach
    must be classified with --read, or write-boundary refuses, naming the ticket and the token.
  Reuse the protected-paths tokenizer and its --read rule, so a read-only mention costs one flag.
  Mark the refusal; add the trap rebuilding #27's shape (a selected ticket whose DO block names
    a specs/ path) and its mutant; flip the pin.

DO NOT
  Parse prose outside the DO block, or guess intent from verbs.
  Change what a shift builder may write.

BUILDER READY
  The trap green and its mutant red; existing K1 tests and journeys unchanged in meaning.
  npm run test:unit, npm run test:journeys and npm run test:traps pass; npm run typecheck and
    npm run lint exit 0.

OWNER ACCEPTANCE
  None for this ticket alone. M4's acceptance is task 12's list.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(preflight): refuse a shift whose tickets name a path it cannot write
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 10's rows in
  specs/awsf-v3-w02-trap-suite.html and this ticket's state move together in one commit
  (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T12 and W03: tickets in this repository that
  the new rule would refuse today. The owner copies them into those tickets' ## Handoff. Edit no
  ticket file.
```

### T11 — Known open defects refused before spend

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 11 of 16. Plan: specs/awsf-v3-w02-trap-suite.html, milestone M4, task 11.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T01 and T03 landed. G02-S recorded.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w02-trap-suite-build-prompts.md
  specs/awsf-v3-w02-trap-suite.html - task 11, the seed ledger rows #12, #14, #21, #24
  core/src/traps/seeds.ts - T01's findings on whether each defect is still open
  core/src/cli/commands/rework.ts - what a rework carries to its first call
  core/src/policy/redaction.ts - the credential patterns (protected, read only)
  core/test/unit/meta/no-credentials-in-fixtures.test.ts

DO
  For each open defect T01 found and G02-S confirmed, refuse at the first point that can see its
    precondition, before any call. Proposed for #12 and #14: awsf rework refuses before its first
    call when the recorded gate output it would carry is credential-shaped, and its message
    advises cancel and a new task.
  For each defect T01 found already fixed (proposed: #21 and #24), add a fixed no-trap entry
    citing the fixing commit and the regression test, and delete its replay pin.
  Mark each refusal; add each trap and its mutant; flip the pins.
  Build every credential-shaped test input at run time from fragments; never commit one as a
    literal.

DO NOT
  Edit core/src/policy/**. Read its patterns; do not change them.
  Fix the underlying defect inside this ticket unless the owner's G02-S Amendment says to; a
    fix would make the seed fixed, which is a different ticket's acceptance.

BUILDER READY
  Each trap green and its mutant red; the catalogue fence passes.
  npm run test:unit, npm run test:journeys and npm run test:traps pass; npm run typecheck and
    npm run lint exit 0.

OWNER ACCEPTANCE
  None for this ticket alone. M4's acceptance is task 12's list.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(rework): refuse before spend when known open defects would stop the run
  Body: what changed and why, the test counts, each defect's disposition.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 11's rows in
  specs/awsf-v3-w02-trap-suite.html and this ticket's state move together in one commit
  (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T12: each defect still open, its refusal, and
  the cheapest fix that would turn it into a fixed entry. The owner copies them into that
  ticket's ## Handoff. Edit no ticket file.
```

### T12 — The confirmed remainder, and Testing Strategy for M4

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 12 of 16. Plan: specs/awsf-v3-w02-trap-suite.html, milestone M4, task 12.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T04, T08, T09, T10 and T11 landed, and any task the G02-S Amendment added to M4.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w02-trap-suite-build-prompts.md
  specs/awsf-v3-w02-trap-suite.html - M4, AC-4, the G02-S Amendment
  core/src/traps/catalogue.ts - every entry still pending
  core/test/traps/replay/ - every KNOWN GAP pin still present
  core/test/unit/meta/k1-forensics-map.test.ts

DO
  For every seed G02-S confirmed as trappable that tasks 8-11 did not take (proposed candidates:
    gotchas 7 and 11, a retry --adopt-as target bypassing K1, a later phase's grant accepted at
    PREPARED, #8 and #38 if T01 found them reproducible), build its refusal, marker, trap and
    mutant; or, with the owner's recorded agreement in the plan, its no-trap entry.
  Leave no KNOWN GAP pin under core/test/traps/replay/ and no pending catalogue entry: each pin is
    now a trap, or deleted with its seed's no-trap entry.
  Point each W02 row of k1-forensics-map.test.ts at its trap id or no-trap kind.
  Run every layer.

DO NOT
  Mark a seed after-spend to avoid building its refusal; that needs the owner's recorded
    agreement.
  Change a trap built by tasks 8-11 except to fix it.

BUILDER READY
  Every M4 trap green and its mutant red; the fence passes with no pending entry.
  npm run test:unit, npm run test:journeys and npm run test:traps pass; npm run typecheck and
    npm run lint exit 0.

OWNER ACCEPTANCE
  M4's acceptance: the owner reads the catalogue's final list and confirms each no-trap entry's
  reason.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: test(traps): trap the confirmed remainder and close every replay gap
  Body: what changed and why, the test counts, the catalogue's size by trap and by kind.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 12's rows and the M4 header in
  specs/awsf-v3-w02-trap-suite.html and this ticket's state move together in one commit
  (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T16: the final catalogue counts and any seed
  whose classification moved since G02-S. The owner copies them into that ticket's ## Handoff.
  Edit no ticket file.
```

### T13 — Doctor's environment rows: storage, executables, logins and quota

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 13 of 16. Plan: specs/awsf-v3-w02-trap-suite.html, milestone M5, task 13.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  None inside W02. W02-Q6 and W02-Q8 decided.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w02-trap-suite-build-prompts.md
  specs/awsf-v3-w02-trap-suite.html - Problem (doctor), M5, task 13, W02-Q6, W02-Q8
  core/src/cli/commands/doctor.ts, core/src/decision/jev-doctor.ts - today's report and an added
    row
  core/src/cli/main.ts - the doctor arm
  core/src/preflight/fields.ts - the git-storage mode signature (C6)
  core/src/execution/transport-broker.ts - resolveExecutable, runSystemCommand (protected, import
    only)
  core/src/quota/probe.ts, readout.ts, core/src/cli/commands/quota.ts - the one quota probe
  specs/design/awsf-v3-plan/frame-index.json - frame mp-s5-checks, the Doctor card (data shape)

DO
  core/src/doctor/: one pure module per row over facts a caller gathered, each returning ok, warn
    or finding with its detail, and a gatherer that reads them.
  storage: the Git common directory, the worktree root and the state root, with K1's git-storage
    mode signature.
  executables: each configured adapter's executable, git, bwrap and quota-axi, resolved with
    resolveExecutable against doctor's environment; no process started.
  providers and quota: one quota-axi probe through probeQuota, giving each provider's login state
    from its status (W02-Q8) and each route's windows, runway and reset against any configured
    threshold. A provider whose login the probe cannot read says "not measured".
  Findings per W02-Q6: DrvFs storage, an unresolvable configured executable or bwrap, a provider
    logged out, an unavailable quota probe. Low quota warns.
  awsf doctor --json emits awsf.doctor/v1, one object per row by name, existing lines included.
    The text form prints each row by name before the summary, as the Jev row does.

DO NOT
  Start a provider CLI, read a credential, or write anything.
  Change the meaning of an existing doctor line or the Jev row.

BUILDER READY
  Tests with fixtures: storage reading 0777 on every entry, a PATH missing a configured CLI, a
    quota readout with an exhausted window and one with an unreadable login; each row by name in
    text and JSON; the exit code per W02-Q6.
  npm run test:unit passes; npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  None for this ticket alone. M5's acceptance is task 15's list.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(doctor): report storage, executables, logins and quota by name
  Body: what changed and why, the test counts, the probe's latency.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 13's rows in
  specs/awsf-v3-w02-trap-suite.html and this ticket's state move together in one commit
  (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T14, T15, W08 and W11: the row model, the JSON
  schema, and whether pi's login is what quota-axi reads. The owner copies them into those
  tickets' ## Handoff. Edit no ticket file.
```

### T14 — Doctor's repository rows: branches, worktrees, the baseline, and open markers

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 14 of 16. Plan: specs/awsf-v3-w02-trap-suite.html, milestone M5, task 14.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T13 landed.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w02-trap-suite-build-prompts.md
  specs/awsf-v3-w02-trap-suite.html - M5, task 14
  core/src/doctor/ - T13's row model
  core/src/preflight/baseline-worktree.ts - baselineWorktreeName and the seed paths (C5)
  core/src/cli/commands/operator.ts - gcCommand, which keeps its own list
  core/src/registry/plan-source.ts - resolving the registered plans and their ticket sets
  core/src/contracts/shift-selection-record.ts - a landed shift's selected ticket ids
  core/test/unit/meta/no-destructive-paths.test.ts

DO
  branches: local branches whose tip the default branch contains, or whose task's attempts are
    all terminal, read with git for-each-ref through runSystemCommand.
  worktrees: linked worktrees in total, under the factory's worktree root, belonging to a
    terminal attempt, and belonging to no attempt, from git worktree list --porcelain.
  baseline: the project's awsf-baseline-<project> tree present or absent, its HEAD against the
    default branch, dirty or foreign, and its seeded node_modules older than the repository's
    lockfile.
  markers: landed shift attempts whose selected tickets are not done in the registered plan's
    ticket set, listed; landed attempts with a plan ref and no ticket selection, counted as
    unmapped.
  All four warn under W02-Q6, never findings.

DO NOT
  Remove, prune, delete or list anything for removal. awsf gc stays the only list of candidates.
  Write to a ticket, a plan or the state root.

BUILDER READY
  Tests with fixtures: a stale branch, a worktree with no attempt, a dirty baseline, a stale
    seeded node_modules, a landed shift with a todo ticket; each row by name in text and JSON.
  npm run test:unit passes; npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  None for this ticket alone. M5's acceptance is task 15's list.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(doctor): report stale branches, worktrees, the baseline and open markers
  Body: what changed and why, the test counts, the rows' cost on a checkout with 200 worktrees.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 14's rows in
  specs/awsf-v3-w02-trap-suite.html and this ticket's state move together in one commit
  (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T15 and W03: how open markers are matched and
  what an unmapped landing would need to become mapped. The owner copies them into those tickets'
  ## Handoff. Edit no ticket file.
```

### T15 — Testing Strategy for M5

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 15 of 16. Plan: specs/awsf-v3-w02-trap-suite.html, milestone M5, task 15.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T13 and T14 landed.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w02-trap-suite-build-prompts.md
  specs/awsf-v3-w02-trap-suite.html - M5, AC-5, INV-4
  core/src/doctor/, core/src/cli/commands/doctor.ts and their tests

DO
  A fence: doctor.ts and core/src/doctor/** import no write, append, rename, remove, mkdir or lock
    API from node:fs or node:fs/promises, open no database writer, and start no process except
    through runSystemCommand. A planted write import fails it.
  Fill any gap in the fixtures M5 lists, and prove each row's name appears in text and JSON.
  A journey through main(): awsf doctor --json on a synthetic checkout and state root returns
    every AC-5 row by name and the exit code W02-Q6 decided.
  Run every layer this milestone touches.

DO NOT
  Change a row's meaning. Return a contradiction instead.

BUILDER READY
  npm run test:unit and npm run test:journeys pass; npm run typecheck and npm run lint exit 0.

OWNER ACCEPTANCE
  M5's acceptance: the owner runs awsf doctor on this machine and reads each row by name.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: test(doctor): fence doctor read-only and prove every row by name
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 15's rows and the M5 header in
  specs/awsf-v3-w02-trap-suite.html and this ticket's state move together in one commit
  (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T16, W08, W11 and W12. The owner copies them
  into those tickets' ## Handoff. Edit no ticket file.
```

### T16 — The GR record, and the workstream's closing duties

```
ROUTING
  Managed (default): host configuration owns the route, the review inversion and the effort.
  Manual (a logged exception): Opus 5.5 at high, or codex:gpt-6-sol at high, by live quota.

TASK 16 of 16. Plan: specs/awsf-v3-w02-trap-suite.html, milestone M6, task 16.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed: write inside the builder's boundary in Section A. Leave every change uncommitted for
  the host, and return the envelope with the proposed message.
  Manual: the same boundary; commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T04, T07, T12 and T15 landed. G02-L and G02-D landed; G02-Q landed if W02-Q7 took a threshold.
  Every stop since the cut attributed with a trap link by the owner.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red base is
  reported, not fixed inside this ticket.

READ FIRST
  AGENTS.md; Section A of specs/awsf-v3-w02-trap-suite-build-prompts.md
  specs/awsf-v3-w02-trap-suite.html - M6, AC-6, Notes (the handoff findings), every Amendment
  specs/awsf-v3-plan.html - gate GR and the W02 block

DO
  Run each layer alone and record its count: npm run test:unit, test:contract, test:sim,
    test:journeys, test:traps; npm run typecheck and npm run lint.
  Run awsf traps and awsf doctor --json read-only on the state roots and checkout you are given,
    and record their output.
  Fix only what blocks those commands inside the builder's boundary; anything else is returned.
  Write the closing record for the owner's Amendment: each task's final state and landing SHA,
    gate counts, the catalogue's size by trap and by no-trap kind, decisions W02-Q1-Q8 as taken,
    surprises, and the handoff findings for W05-W08 and W10-W14, updated from the plan's Notes
    to what was built.

DO NOT
  Attribute, cancel or link a stop. Those are owner acts.
  Claim GR. The owner's bookkeeping commit earns it.

BUILDER READY
  Every layer green; awsf traps exits 0 on the given state roots; doctor names every AC-5 row.

OWNER ACCEPTANCE
  The owner reads the closing record against AC-6 and gate GR, runs awsf traps on the real state
  roots, and lands the candidate.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: test(traps): record the trap suite's closing state at the cut and after it
  Body: what changed and why, every layer's count, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket's candidate lands: task 16's rows, the M6 header and the
  Validation checklist in specs/awsf-v3-w02-trap-suite.html, this ticket's state, and the
  spine's Milestone M2 / W02 marker with specs/tickets/awsf-v3-plan/W02.md move together in one
  commit (invariant 12). That commit opens gate GR. Return the evidence. Edit none of them.

HANDOFF
  In your envelope's notes, give the closing record above and dated findings for W05-W08 and
  W10-W14. The owner copies them into those tickets' ## Handoff. Edit no ticket file.
```
