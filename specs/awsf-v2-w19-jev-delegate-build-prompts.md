# AWSF v2 W19 — Jev and the Delegate: build prompts

> **Plan:** [`awsf-v2-w19-jev-delegate.html`](awsf-v2-w19-jev-delegate.html) · **Spine:** [`awsf-v2-plan.html`](awsf-v2-plan.html) § Milestone M19 → W19
> **Tickets:** [`tickets/awsf-v2-w19-jev-delegate/`](tickets/awsf-v2-w19-jev-delegate/) — one file per task, each carrying the same prompt this file's Section B holds.

This file exists because this repository's invariant-12 fence requires it:
`core/test/unit/meta/ticket-plan-sync.test.ts` asserts a `<stem>-build-prompts.md` exists for every
plan source with a ticket set, and that each ticket's prompt is **byte-identical** to its
`### Tnn — ` block below. Both artifacts are generated from one source, so they cannot drift.

# Section A — Conventions

**Read first, on every task.** `AGENTS.md` in full · `specs/awsf-v2-w19-jev-delegate.html` (Problem, Solution,
Decisions already taken, Identifier Spine and Execution in full, then the task's own section) ·
`specs/tickets/awsf-v2-w19-jev-delegate/README.md`.

**What Jev is, in one line.** A hosted classifier: a state and typed questions in (noul = yes/no
probability, choice = one declared option, score = a position on 2 to 10 described levels),
typed answers out. It writes nothing, runs nothing and holds no identity. Code decides.

**Execution.** M1 to M3 run **manually, one ticket per session**, as W18 does since 2026-09-28:
they build the authority every later shift runs under, and T08 and T09 write protected paths as
owner gates. M4 to M8 run as **one AWSF `shift` per milestone**, normally under a Delegate lease the
owner grants, so W19 is the first user of what it builds. A shift carries each ticket's
`## Build prompt` verbatim, followed by its `## Handoff`.

**The builder's write boundary.** `core/src/**`, `core/test/**`, `dashboard/**`, `prompts/**`,
`docs/cheatsheet.html`. Never `specs/**`, `AGENTS.md`, `awsf.config.yaml`, `awsf.project.yaml`,
`core/src/state/**`, `core/src/policy/**`, `core/src/observability/migrations/**`,
`core/src/execution/transport-broker.ts`, `docs/driving/**`, or a root `.claude/` directory, except
where a ticket names an owner gate the owner authorizes in a manual session.

**Owner gates.**
- **G19-A**, before M1: `AGENTS.md` gains invariant 13 (the Delegate and the single Jev transport).
- **G19-S**, with T08: the `delegate` actor on the task-machine edges delegated acts traverse
  (`core/src/state/**`).
- **G19-C**, with T09: the `delegate` verb family wired — `main.ts` arm, `CLI_COMMANDS`, the
  cheatsheet's `commands` and `owner-acts` lines, and the Marimba guard verb, in one commit.
- **G19-Q**, before M3's live drive: `awsf.config.yaml` sets `routing.quota_stop`, so a spent window
  parks a phase instead of failing it.
- **G19-D**, before M6's pilot: the Marimba compaction profile names the Jev extension
  (`docs/driving/**`), and the owner's pi settings load it (machine-local).
- **G19-T**, before M7's shifts: every role's `tools.allow` names the Jev tools.
- **G19-W**, before M8: W18's T17 has landed.

**The never-do list**, with why each is tempting:
- **Do not let a Jev answer move lifecycle state or appear as a BLOCKED reason.** `errors.ts`
  admits six deterministic sources; a probability is not one of them.
- **Do not call the Jev endpoint outside `core/src/decision/jev-transport.ts`.** No `fetch` anywhere
  else in `core/src`; the fence checks it.
- **Do not give an agent phase a credential.** Phases reach Jev only through the host's decision
  socket; the key stays in the host process.
- **Do not let the Delegate land, publish, attest a journey, grant protected files, attribute, or
  grant or extend its own lease.** The authority type cannot express them.
- **Do not record a Delegate act as the owner's.** Every act names `actor: delegate` and its lease.
- **Do not treat confidence as authorization.** Every act passes the policy table and the lease.
- **Do not make Jev do arithmetic.** Quota windows, call counts, dates and costs stay in code.
- **Do not let `core/src/workflow/**` or the routing resolver reach quota or Delegate modules.**
- **Do not spawn outside the transport broker or use a shell** (invariants 3 and 4).
- **Do not write SQLite outside `projector.ts` or add a migration.** Decision records ride `events`.
- **Do not add a dependency.** Native `fetch` and `node:` builtins only.
- **Do not copy the owner's run data into a fixture**, and name no file with `manifest` or
  `receipt` in it (invariants 1 and 10).
- **Never** put an agent, model or AI tool in a commit identity, message or trailer.

# Section B — Task prompts (recommended)

### T01 — The Jev transport, its fence and the project switch

```
ROUTING
  Manual (this milestone's path): Opus 5.5 at high or xhigh, or the nearest route live
  quota allows. The owner runs this ticket in one session and does the bookkeeping after it.
  Managed: not planned for M1. It builds the authority later shifts run under, and some of
  its tickets write protected paths a shift builder cannot reach. If a host ever runs it,
  host configuration owns routing.

TASK 1 of 28. Plan: specs/awsf-v2-w19-jev-delegate.html, milestone M1, task 1.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Manual: write inside core/src/**, core/test/**, dashboard/**, prompts/**, docs/cheatsheet.html.
  Never write specs/** (plan markers, ticket state, Handoff), AGENTS.md, awsf.config.yaml,
  awsf.project.yaml, core/src/state/**, core/src/policy/**,
  core/src/observability/migrations/**, core/src/execution/transport-broker.ts,
  docs/driving/**, or a .claude/ directory at the repository root, unless this ticket names the path above.
  Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  None inside W19.
  Gates: Gate G19-A (the AGENTS.md invariant 13 text) should be committed at your base. This ticket does not need it to build, but its fence is what that invariant names.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red
  base is reported, not fixed inside this ticket. Inside a shift, the previous ticket's
  tests gate passed on the head you start from.

READ FIRST
  AGENTS.md in full; Section A of specs/awsf-v2-w19-jev-delegate-build-prompts.md
  specs/awsf-v2-w19-jev-delegate.html - Problem (the smoke facts), Solution (DD1, DD2), the Identifier Spine, task 1
  ../ten-levels-of-jev/apps/ten-levels/src/core/client.ts, types.ts, helpers.ts - the reference
    client this task ports (it sits beside this checkout; read it, copy nothing unreviewed)
  core/test/unit/meta/adapter-fence.test.ts - the FETCH pattern the new fence reuses
  core/src/policy/redaction.ts - scrubCredentialString and its siblings (protected; read only)
  core/src/registry/catalog-schema.ts, catalog.ts - where the project switch is declared

DO
  Create core/src/decision/jev-transport.ts: the only module that calls the Jev endpoint.
    One provider, OpenRouter: POST https://openrouter.ai/api/alpha/decisions, model
    ~typesafe/jev-latest by default (Q7: the moving alias; the resolved model is recorded on
    every call). Native fetch, Authorization: Bearer from OPENROUTER_API_KEY read once at
    construction (Q6), redirect: "error", a total deadline of 30 s including retries, at most
    3 attempts on 429, 502, 503 and 529 with jittered backoff capped at 8 s, no retry on any
    other status, a network error or a contract error.
  Port the reference client's request validation (1 to 255 choice options, 2 to 10 score
    levels, non-empty instructions) and its strict response validation (every declared answer
    present with the declared type, distributions over exactly the declared keys summing to
    1 +/- 0.025, a choice that is one of the declared options, a score inside its range with
    the declared legend). An invalid response is a ContractError, never a partial answer.
  Return the full result: answers, usage, the resolved model, elapsedMs, attempts, and cost as
    { amount, source } where source is reported (a finite non-negative usage.cost), estimated
    (tokens x the configured rate; the only rate is $0.042 per million input tokens, output
    free, measured 2026-09-28) or unknown. Unknown is never zero.
  Before any request leaves, run the state through core/src/policy/redaction.ts. Record
    whether redaction changed anything; never record what it removed.
  Refuse to send when the project's switch is off: the catalog gains an optional
    decision: { jev: on | off }, default on, validated in catalog-schema.ts. A refusal is a
    typed result (refused-by-switch), not an exception the caller must remember to catch.
  A missing key is a typed unavailable result naming OPENROUTER_API_KEY, never a mock and
    never the key's value.
  Add core/test/unit/meta/jev-transport-fence.test.ts: no file under core/src except
    core/src/decision/jev-transport.ts matches the adapter fence's FETCH pattern or names
    the decisions endpoint, and the fence proves it catches both spellings.

DO NOT
  Add a TypeSafe transport, a provider fallback, or a second place that builds the request.
  Read the key from pi's auth.json or any file. The environment variable is the only source.
  Log, journal or print the key, the Authorization header, or redacted material.
  Add a dependency. Native fetch and node: builtins only (invariant 7).

BUILDER READY
  Offline tests with fetch stubbed: success, each retried status, a non-retried 4xx, a
    malformed body, an undeclared choice, a distribution that does not sum to 1, a timeout,
    a redirect, a missing key, and the switch turned off.
  A test proves redaction runs before the body is serialized.
  The fence test is green and fails on a planted fetch in another core/src file.
  npm run typecheck and npm run lint exit 0; npm run test:unit passes.

OWNER ACCEPTANCE
  None for this ticket alone. M1's acceptance is task 3's list.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(decision): add the single Jev transport, its fence and the project switch
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket is delivered and verified (manual) or its milestone lands
  (shift): task 1's rows in specs/awsf-v2-w19-jev-delegate.html and this ticket's state move together in one
  commit (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes (manual: your final report), give dated findings for T02, T03, T21:
  contradictions with their prompts (which wins, and why), moved or renamed files, scope
  they can skip or must absorb. The owner copies them into those tickets' ## Handoff.
  Edit no ticket file.
```

### T02 — Versioned question sets and the journaled decision record

```
ROUTING
  Manual (this milestone's path): Opus 5.5 at high or xhigh, or the nearest route live
  quota allows. The owner runs this ticket in one session and does the bookkeeping after it.
  Managed: not planned for M1. It builds the authority later shifts run under, and some of
  its tickets write protected paths a shift builder cannot reach. If a host ever runs it,
  host configuration owns routing.

TASK 2 of 28. Plan: specs/awsf-v2-w19-jev-delegate.html, milestone M1, task 2.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Manual: write inside core/src/**, core/test/**, dashboard/**, prompts/**, docs/cheatsheet.html.
  Never write specs/** (plan markers, ticket state, Handoff), AGENTS.md, awsf.config.yaml,
  awsf.project.yaml, core/src/state/**, core/src/policy/**,
  core/src/observability/migrations/**, core/src/execution/transport-broker.ts,
  docs/driving/**, or a .claude/ directory at the repository root, unless this ticket names the path above.
  Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T01. Manual: each delivered and verified before you start. In a shift,
  a predecessor in the same selection needs only its host-recorded gates on this head.
  Gates: None.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red
  base is reported, not fixed inside this ticket. Inside a shift, the previous ticket's
  tests gate passed on the head you start from.

READ FIRST
  AGENTS.md in full; Section A of specs/awsf-v2-w19-jev-delegate-build-prompts.md
  specs/awsf-v2-w19-jev-delegate.html - Solution (DD2, DD3), the Identifier Spine, task 2
  core/src/persistence/journal.ts - the append-only Journal
  core/src/persistence/task-attributions.ts - the task-scoped JSONL record W18 added
  core/src/observability/projector.ts - how a session-level event row is projected
  core/src/contracts/registry.ts - how a contract is registered

DO
  Create core/src/decision/question-set.ts: a QuestionSet is { id, version, questions,
    thresholds } plus a pure policy function from typed answers to a typed outcome. Ids are
    kebab-case, versions are integers, and a registry refuses a duplicate id@version.
  Create core/src/decision/question-sets/stop-judgment.ts, version 1: progressing (noul),
    next_act (choice over the acts the caller allows for that stop, plus wait_for_owner and
    other), risk (score, three levels). These are the questions the 2026-09-28 smoke call
    asked; its answer (raise at 0.75, confidence 0.68) is the fixture of a correct "wait".
  Create core/src/contracts/decision-record.ts (awsf.decision/v1, TypeBox, registered): id,
    questionSet id@version, requested model, resolved model, outcome (answered, unavailable,
    refused-by-switch, contract-error), answers, usage, cost { amount, source }, elapsedMs,
    attempts, redacted (boolean), the caller (a stop, a phase hook, a tool, the replay), and
    the redacted request and response bodies when together under 16 KiB, else their sha256.
  Create core/src/decision/decide.ts: decide(questionSet, state, context) calls the
    transport, validates, applies the set's policy, appends the record to the task's
    decisions.jsonl through Journal, and returns { outcome, answers, policyResult, recordId }.
    An unavailable or refused call returns its outcome; the caller's own fallback applies.
  Project each record as one events row of type decision (INSERT OR IGNORE by id) in
    projector.ts, and make awsf db rebuild replay every task's decisions.jsonl.

DO NOT
  Write a migration. Decision records ride the existing events table.
  Let a question set compute arithmetic, dates or counts. Those stay in its policy code.
  Put a decision's outcome in a BLOCKED reason. errors.ts admits six sources and Jev is not
    one of them (INV-2).

BUILDER READY
  A test registers a set, refuses a duplicate id@version, and round-trips a record.
  A test builds the smoke call's answers and proves stop-judgment's policy returns wait.
  A rebuild test: a synthetic task with three decision records projects three rows, and a
    rebuild from nothing yields the same rows.
  npm run typecheck and npm run lint exit 0; npm run test:unit passes.

OWNER ACCEPTANCE
  None for this ticket alone.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(decision): add versioned question sets and the journaled decision record
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket is delivered and verified (manual) or its milestone lands
  (shift): task 2's rows in specs/awsf-v2-w19-jev-delegate.html and this ticket's state move together in one
  commit (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes (manual: your final report), give dated findings for T03, T05, T08, T17, T21:
  contradictions with their prompts (which wins, and why), moved or renamed files, scope
  they can skip or must absorb. The owner copies them into those tickets' ## Handoff.
  Edit no ticket file.
```

### T03 — Testing Strategy for M1, and the doctor row

```
ROUTING
  Manual (this milestone's path): Opus 5.5 at high or xhigh, or the nearest route live
  quota allows. The owner runs this ticket in one session and does the bookkeeping after it.
  Managed: not planned for M1. It builds the authority later shifts run under, and some of
  its tickets write protected paths a shift builder cannot reach. If a host ever runs it,
  host configuration owns routing.

TASK 3 of 28. Plan: specs/awsf-v2-w19-jev-delegate.html, milestone M1, task 3.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Manual: write inside core/src/**, core/test/**, dashboard/**, prompts/**, docs/cheatsheet.html.
  Never write specs/** (plan markers, ticket state, Handoff), AGENTS.md, awsf.config.yaml,
  awsf.project.yaml, core/src/state/**, core/src/policy/**,
  core/src/observability/migrations/**, core/src/execution/transport-broker.ts,
  docs/driving/**, or a .claude/ directory at the repository root, unless this ticket names the path above.
  Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T01, T02. Manual: each delivered and verified before you start. In a shift,
  a predecessor in the same selection needs only its host-recorded gates on this head.
  Gates: None.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red
  base is reported, not fixed inside this ticket. Inside a shift, the previous ticket's
  tests gate passed on the head you start from.

READ FIRST
  AGENTS.md in full; Section A of specs/awsf-v2-w19-jev-delegate-build-prompts.md
  specs/awsf-v2-w19-jev-delegate.html - task 3 and the Validation section
  core/src/cli/commands/doctor.ts - the existing row shape

DO
  awsf doctor gains one Jev row: the project switch, whether OPENROUTER_API_KEY is set (never
    its value or length), the requested model, and the fence status. It makes no network call.
  A journey test drives decide() over a stubbed transport for each outcome (answered,
    unavailable, refused-by-switch, contract-error) and asserts one record per call, the
    projection rows, and an identical rebuild.
  Record the unit count at the base SHA and after.

DO NOT
  Make a live call from any test. The live smoke is the owner's act, run once on 2026-09-28.

BUILDER READY
  node --experimental-strip-types --test core/test/unit/decision-*.test.ts passes.
  The journey test passes. npm run typecheck, npm run lint and npm run test:unit pass.

OWNER ACCEPTANCE
  The owner runs awsf doctor on their machine and sees the Jev row with the key reported as
    set or unset, and nothing else about it.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: test(decision): prove the decision service end to end and report it in doctor
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket is delivered and verified (manual) or its milestone lands
  (shift): task 3's rows in specs/awsf-v2-w19-jev-delegate.html and this ticket's state move together in one
  commit (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes (manual: your final report), give dated findings for T07:
  contradictions with their prompts (which wins, and why), moved or renamed files, scope
  they can skip or must absorb. The owner copies them into those tickets' ## Handoff.
  Edit no ticket file.
```

### T04 — Stop facts: one host-built record for every stop

```
ROUTING
  Manual (this milestone's path): Opus 5.5 at high or xhigh, or the nearest route live
  quota allows. The owner runs this ticket in one session and does the bookkeeping after it.
  Managed: not planned for M2. It builds the authority later shifts run under, and some of
  its tickets write protected paths a shift builder cannot reach. If a host ever runs it,
  host configuration owns routing.

TASK 4 of 28. Plan: specs/awsf-v2-w19-jev-delegate.html, milestone M2, task 4.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Manual: write inside core/src/**, core/test/**, dashboard/**, prompts/**, docs/cheatsheet.html.
  Never write specs/** (plan markers, ticket state, Handoff), AGENTS.md, awsf.config.yaml,
  awsf.project.yaml, core/src/state/**, core/src/policy/**,
  core/src/observability/migrations/**, core/src/execution/transport-broker.ts,
  docs/driving/**, or a .claude/ directory at the repository root, unless this ticket names the path above.
  Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  None inside W19.
  Gates: None.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red
  base is reported, not fixed inside this ticket. Inside a shift, the previous ticket's
  tests gate passed on the head you start from.

READ FIRST
  AGENTS.md in full; Section A of specs/awsf-v2-w19-jev-delegate-build-prompts.md
  specs/awsf-v2-w19-jev-delegate.html - Problem (the stop inventory), Solution (DD4), task 4
  core/src/contracts/phase-recovery.ts - the six checkpoint kinds
  core/src/state/task-machine.ts, core/src/state/errors.ts - edges and BLOCKED codes
  core/src/cli/commands/production-run.ts - where ceiling-pause, quota-pause and
    ticket-block checkpoints are written, and the quota boundary snapshot
  core/src/contracts/review-output.ts - findings (file, line, text)
  core/src/quota/readout.ts - the readout rows

DO
  Create core/src/delegate/stop-facts.ts: pure buildStopFacts(status, records, config) for
    every stop kind: the parked checkpoints ceiling-pause, quota-pause and ticket-block;
    AWAITING_OWNER after gating (L12), after review (L15) and at the quota stop (L26); and
    BLOCKED on any edge with its reason code.
  Facts: task, attempt, workflow, tier, lifecycle state, stop kind, edge, reason code, calls
    spent, ceiling, MAX_CALL_CEILING, the next phase and its route, shift tickets done and
    remaining, correction counts, the last round's gate rows (name, passed), the review
    verdict and its findings, and the latest boundary quota readout rows (provider, window,
    percent remaining, resets at, pace reserve) when journaled.
  Every field is read from the status and the journal. Nothing is inferred and nothing
    calls a provider.

DO NOT
  Read the owner's database or a live quota probe. The facts are what the journal holds.
  Put the builder's or reviewer's prose in a fact field other than the verbatim findings.

BUILDER READY
  One synthetic fixture per stop kind (nine), each producing the expected facts.
  npm run typecheck and npm run lint exit 0; npm run test:unit passes.

OWNER ACCEPTANCE
  None for this ticket alone.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(delegate): build one fact record for every stop a run makes
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket is delivered and verified (manual) or its milestone lands
  (shift): task 4's rows in specs/awsf-v2-w19-jev-delegate.html and this ticket's state move together in one
  commit (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes (manual: your final report), give dated findings for T05, T10:
  contradictions with their prompts (which wins, and why), moved or renamed files, scope
  they can skip or must absorb. The owner copies them into those tickets' ## Handoff.
  Edit no ticket file.
```

### T05 — The shadow policy and its journaled proposals

```
ROUTING
  Manual (this milestone's path): Opus 5.5 at high or xhigh, or the nearest route live
  quota allows. The owner runs this ticket in one session and does the bookkeeping after it.
  Managed: not planned for M2. It builds the authority later shifts run under, and some of
  its tickets write protected paths a shift builder cannot reach. If a host ever runs it,
  host configuration owns routing.

TASK 5 of 28. Plan: specs/awsf-v2-w19-jev-delegate.html, milestone M2, task 5.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Manual: write inside core/src/**, core/test/**, dashboard/**, prompts/**, docs/cheatsheet.html.
  Never write specs/** (plan markers, ticket state, Handoff), AGENTS.md, awsf.config.yaml,
  awsf.project.yaml, core/src/state/**, core/src/policy/**,
  core/src/observability/migrations/**, core/src/execution/transport-broker.ts,
  docs/driving/**, or a .claude/ directory at the repository root, unless this ticket names the path above.
  Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T02, T04. Manual: each delivered and verified before you start. In a shift,
  a predecessor in the same selection needs only its host-recorded gates on this head.
  Gates: None.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red
  base is reported, not fixed inside this ticket. Inside a shift, the previous ticket's
  tests gate passed on the head you start from.

READ FIRST
  AGENTS.md in full; Section A of specs/awsf-v2-w19-jev-delegate-build-prompts.md
  specs/awsf-v2-w19-jev-delegate.html - Solution (DD4, DD5), the act table in Decisions already taken, task 5
  core/src/cli/commands/raise.ts - MAX_GRANT_CALLS and the ceiling arithmetic
  core/src/cli/commands/shift.ts - raiseActsNeeded

DO
  Create core/src/delegate/policy.ts: a pure, closed table from (stop facts, stop-judgment
    answers, quota plan when present) to a ProposedAct with a rationale code. Acts: raise
    (calls), resume, wait-until (at), cancel, replacement-review, rework (finding index),
    degrade-review, route-fallback (role, route), continue, land-shadow, wait-for-owner.
  Numbers decide first, in code: a ceiling-pause proposes raise with raiseActsNeeded's call
    count when the ceiling can reach it; a quota-pause defers to the quota plan (task 10) and
    proposes wait-for-owner until it exists. Jev refines only judgment: progressing below 0.7
    turns a raise into wait-for-owner, and next_act below its bar of 0.85 confidence becomes
    wait-for-owner.
  land-shadow is proposed after an approving review and is never executable (INV-3).
  Hook the runner: whenever a run stops, build the facts, ask stop-judgment through decide(),
    and append a delegate.proposal record to the task's delegate.jsonl, whether or not a lease
    exists. An unavailable decision still records a proposal (wait-for-owner, reason
    jev-unavailable).

DO NOT
  Execute anything. This task only records proposals.
  Let a proposal change lifecycle state, the ceiling, or a checkpoint.

BUILDER READY
  A table test covers every stop kind x each rationale code.
  A test proves an unavailable decision records wait-for-owner.
  A test proves land-shadow cannot be turned into an executable act by any input.
  npm run typecheck and npm run lint exit 0; npm run test:unit passes.

OWNER ACCEPTANCE
  None for this ticket alone.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(delegate): journal a shadow proposal at every stop
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket is delivered and verified (manual) or its milestone lands
  (shift): task 5's rows in specs/awsf-v2-w19-jev-delegate.html and this ticket's state move together in one
  commit (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes (manual: your final report), give dated findings for T06, T07, T11:
  contradictions with their prompts (which wins, and why), moved or renamed files, scope
  they can skip or must absorb. The owner copies them into those tickets' ## Handoff.
  Edit no ticket file.
```

### T06 — Agreement and earned autonomy, computed at read time

```
ROUTING
  Manual (this milestone's path): Opus 5.5 at high or xhigh, or the nearest route live
  quota allows. The owner runs this ticket in one session and does the bookkeeping after it.
  Managed: not planned for M2. It builds the authority later shifts run under, and some of
  its tickets write protected paths a shift builder cannot reach. If a host ever runs it,
  host configuration owns routing.

TASK 6 of 28. Plan: specs/awsf-v2-w19-jev-delegate.html, milestone M2, task 6.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Manual: write inside core/src/**, core/test/**, dashboard/**, prompts/**, docs/cheatsheet.html.
  Never write specs/** (plan markers, ticket state, Handoff), AGENTS.md, awsf.config.yaml,
  awsf.project.yaml, core/src/state/**, core/src/policy/**,
  core/src/observability/migrations/**, core/src/execution/transport-broker.ts,
  docs/driving/**, or a .claude/ directory at the repository root, unless this ticket names the path above.
  Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T05. Manual: each delivered and verified before you start. In a shift,
  a predecessor in the same selection needs only its host-recorded gates on this head.
  Gates: None.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red
  base is reported, not fixed inside this ticket. Inside a shift, the previous ticket's
  tests gate passed on the head you start from.

READ FIRST
  AGENTS.md in full; Section A of specs/awsf-v2-w19-jev-delegate-build-prompts.md
  specs/awsf-v2-w19-jev-delegate.html - Decisions already taken (Q8), Solution (DD6), task 6
  core/src/cli/commands/attempt.ts - how owner acts are recorded on the attempt

DO
  Create core/src/delegate/agreement.ts: pure pairing at read time. For each proposal, the
    next act on that attempt by any actor is its outcome: match, mismatch, or none. Nothing is
    written when the owner acts; the pairing is computed from records that already exist.
  Create core/src/delegate/autonomy.ts: code-decided acts (raise, resume, wait-until,
    cancel) are live from the first lease. Judgment acts (rework, replacement-review,
    degrade-review, route-fallback, continue) unlock per act when at least 7 of that act's
    last 8 paired proposals matched, counting live shadow and replay pairs with their source
    kept. land-shadow never unlocks.
  Expose autonomyFor(act, pairs, leaseAutonomy): leaseAutonomy "all" (the owner's switch)
    unlocks every judgment act for that lease and is reported as owner-all, never as earned.

DO NOT
  Store a running tally. Every number is recomputed from the journal.
  Count a mismatch as a match because the outcomes were similar. The table is exact.

BUILDER READY
  Tests: 7 of 8 unlocks, 6 of 8 does not, replay pairs count and are labeled, owner-all
    unlocks and is labeled, land-shadow never unlocks under any input.
  npm run typecheck and npm run lint exit 0; npm run test:unit passes.

OWNER ACCEPTANCE
  None for this ticket alone.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(delegate): pair proposals with owner acts and derive earned autonomy
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket is delivered and verified (manual) or its milestone lands
  (shift): task 6's rows in specs/awsf-v2-w19-jev-delegate.html and this ticket's state move together in one
  commit (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes (manual: your final report), give dated findings for T07, T09, T11:
  contradictions with their prompts (which wins, and why), moved or renamed files, scope
  they can skip or must absorb. The owner copies them into those tickets' ## Handoff.
  Edit no ticket file.
```

### T07 — Testing Strategy for M2, and the historical replay

```
ROUTING
  Manual (this milestone's path): Opus 5.5 at high or xhigh, or the nearest route live
  quota allows. The owner runs this ticket in one session and does the bookkeeping after it.
  Managed: not planned for M2. It builds the authority later shifts run under, and some of
  its tickets write protected paths a shift builder cannot reach. If a host ever runs it,
  host configuration owns routing.

TASK 7 of 28. Plan: specs/awsf-v2-w19-jev-delegate.html, milestone M2, task 7.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Manual: write inside core/src/**, core/test/**, dashboard/**, prompts/**, docs/cheatsheet.html.
  Never write specs/** (plan markers, ticket state, Handoff), AGENTS.md, awsf.config.yaml,
  awsf.project.yaml, core/src/state/**, core/src/policy/**,
  core/src/observability/migrations/**, core/src/execution/transport-broker.ts,
  docs/driving/**, or a .claude/ directory at the repository root, unless this ticket names the path above.
  Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T03, T05, T06. Manual: each delivered and verified before you start. In a shift,
  a predecessor in the same selection needs only its host-recorded gates on this head.
  Gates: None.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red
  base is reported, not fixed inside this ticket. Inside a shift, the previous ticket's
  tests gate passed on the head you start from.

READ FIRST
  AGENTS.md in full; Section A of specs/awsf-v2-w19-jev-delegate-build-prompts.md
  specs/awsf-v2-w19-jev-delegate.html - task 7
  core/src/observability/rebuild.ts - how every task's journal is walked

DO
  awsf delegate replay [--project P] [--live]: walks every task's journal, rebuilds the stop
    facts at each historical stop and the act the owner took next, and runs the shadow policy.
    Without --live it uses no Jev answers (numbers-only policy) and makes no network call.
    With --live it asks stop-judgment once per stop. Results append to the state root's
    delegate/replays.jsonl and count toward autonomy as source replay.
  Build the command unregistered in main.ts: the delegate verb family is wired by the
    owner in gate G19-C (T09), because boundary-claims requires the arm and the guard verb in
    one commit. Test it with an injected terminal.
  A journey test: a synthetic journal with five stops and the owner's acts replays into five
    pairs with the expected agreement.

DO NOT
  Write into any task's attempt directory. Replay output lives in the state root only.
  Copy any of the owner's journal content into a fixture.

BUILDER READY
  The replay journey passes offline. npm run typecheck, npm run lint and npm run test:unit
    pass, with the count recorded at the base and after.

OWNER ACCEPTANCE
  After G19-C, the owner runs awsf delegate replay (offline first, then --live) on their
    state root and reads the per-act agreement. Report the counts; commit nothing from it.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(delegate): replay past stops to seed the shadow record
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket is delivered and verified (manual) or its milestone lands
  (shift): task 7's rows in specs/awsf-v2-w19-jev-delegate.html and this ticket's state move together in one
  commit (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes (manual: your final report), give dated findings for T12, T26:
  contradictions with their prompts (which wins, and why), moved or renamed files, scope
  they can skip or must absorb. The owner copies them into those tickets' ## Handoff.
  Edit no ticket file.
```

### T08 — The Delegate actor: authority type, task-machine edges and the invariant

```
ROUTING
  Manual (this milestone's path): Opus 5.5 at high or xhigh, or the nearest route live
  quota allows. The owner runs this ticket in one session and does the bookkeeping after it.
  Managed: not planned for M3. It builds the authority later shifts run under, and some of
  its tickets write protected paths a shift builder cannot reach. If a host ever runs it,
  host configuration owns routing.

TASK 8 of 28. Plan: specs/awsf-v2-w19-jev-delegate.html, milestone M3, task 8.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Manual: write inside core/src/**, core/test/**, dashboard/**, prompts/**, docs/cheatsheet.html.
  This ticket also writes, in a manual session and only with the owner's explicit
  authorization in that session:
  core/src/state/task-machine.ts and core/src/state/guards.ts (gate G19-S)
  Never write specs/** (plan markers, ticket state, Handoff), AGENTS.md, awsf.config.yaml,
  awsf.project.yaml, core/src/state/**, core/src/policy/**,
  core/src/observability/migrations/**, core/src/execution/transport-broker.ts,
  docs/driving/**, or a .claude/ directory at the repository root, unless this ticket names the path above.
  Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T02. Manual: each delivered and verified before you start. In a shift,
  a predecessor in the same selection needs only its host-recorded gates on this head.
  Gates: Gate G19-A (AGENTS.md invariant 13) must be committed at your base. G19-S is this ticket.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red
  base is reported, not fixed inside this ticket. Inside a shift, the previous ticket's
  tests gate passed on the head you start from.

READ FIRST
  AGENTS.md in full; Section A of specs/awsf-v2-w19-jev-delegate-build-prompts.md
  specs/awsf-v2-w19-jev-delegate.html - Decisions already taken, the act table, Solution (DD7), task 8
  core/src/state/task-machine.ts, guards.ts, errors.ts - edges, actors, reason sources
  core/src/cli/tty.ts - OwnerTerminal and processOwnerTerminal
  core/src/cli/commands/raise.ts, cancel.ts, rework.ts, review.ts, degrade-review.ts,
    seed.ts, and resumeProductionCommand in production-run.ts
  core/test/unit/meta/boundary-claims.test.ts - how owner acts are derived

DO
  Enumerate, from the code and not from this prompt, the exact edge each delegable act takes:
    resume from a parked checkpoint or the quota stop, rework (L19), replacement review (L25),
    cancel (L22 and the parked-checkpoint cancel). Add "delegate" to the actors of exactly
    those edges, with interactive false. Record the list in your report.
  Create core/src/delegate/authority.ts: ActAuthority = { kind: "owner", terminal } |
    { kind: "delegate", leaseId, decisionIds, autonomyBasis }. Every delegable command accepts
    it; the owner branch keeps its interactive check unchanged; the delegate branch requires a
    lease check result (task 9 supplies it) and records actor delegate with the lease id.
  raise, degrade-review and seed record actor delegate in their own records the same way.
  Add core/test/unit/meta/delegate-authority-fence.test.ts: no edge into LANDING or
    PUBLISHED names delegate; land.ts, publish.ts, journey.ts, grant.ts and attribute.ts do not
    import the authority type; and no journal record written under delegate authority carries
    actor human or owner.

DO NOT
  Add delegate to an edge you did not trace to a delegable act.
  Weaken the owner branch: an owner act still needs an interactive terminal.
  Add a reason source to errors.ts. Jev never becomes a seventh (INV-2).

BUILDER READY
  Tests per edge: the delegate actor passes where listed and is refused everywhere else.
  The fence test passes and fails on a planted import in land.ts.
  npm run typecheck and npm run lint exit 0; npm run test:unit passes.

OWNER ACCEPTANCE
  The owner reads the edge list in the report and commits the task-machine change as G19-S.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(state): admit the delegate actor on the edges delegated acts traverse
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket is delivered and verified (manual) or its milestone lands
  (shift): task 8's rows in specs/awsf-v2-w19-jev-delegate.html and this ticket's state move together in one
  commit (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes (manual: your final report), give dated findings for T09, T11:
  contradictions with their prompts (which wins, and why), moved or renamed files, scope
  they can skip or must absorb. The owner copies them into those tickets' ## Handoff.
  Edit no ticket file.
```

### T09 — The lease: grant, revoke, autonomy, and its record

```
ROUTING
  Manual (this milestone's path): Opus 5.5 at high or xhigh, or the nearest route live
  quota allows. The owner runs this ticket in one session and does the bookkeeping after it.
  Managed: not planned for M3. It builds the authority later shifts run under, and some of
  its tickets write protected paths a shift builder cannot reach. If a host ever runs it,
  host configuration owns routing.

TASK 9 of 28. Plan: specs/awsf-v2-w19-jev-delegate.html, milestone M3, task 9.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Manual: write inside core/src/**, core/test/**, dashboard/**, prompts/**, docs/cheatsheet.html.
  This ticket also writes, in a manual session and only with the owner's explicit
  authorization in that session:
  docs/driving/marimba/delegation-guard.sh, marimba-guard-rules.mts and the driving
    documents boundary-claims names (gate G19-C)
  Never write specs/** (plan markers, ticket state, Handoff), AGENTS.md, awsf.config.yaml,
  awsf.project.yaml, core/src/state/**, core/src/policy/**,
  core/src/observability/migrations/**, core/src/execution/transport-broker.ts,
  docs/driving/**, or a .claude/ directory at the repository root, unless this ticket names the path above.
  Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T06, T08. Manual: each delivered and verified before you start. In a shift,
  a predecessor in the same selection needs only its host-recorded gates on this head.
  Gates: G19-S (T08) must be committed at your base. G19-C is this ticket.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red
  base is reported, not fixed inside this ticket. Inside a shift, the previous ticket's
  tests gate passed on the head you start from.

READ FIRST
  AGENTS.md in full; Section A of specs/awsf-v2-w19-jev-delegate-build-prompts.md
  specs/awsf-v2-w19-jev-delegate.html - Decisions already taken (Q1, Q8, Q9), Solution (DD8), task 9
  core/src/cli/commands/attribute.ts - the most recent owner act wired by an owner gate
  core/src/persistence/task-attributions.ts - the task-scoped record to copy
  core/test/unit/meta/boundary-claims.test.ts, marimba-guard.test.ts
  docs/cheatsheet.html - the commands and owner-acts lists

DO
  Create core/src/contracts/delegate-lease.ts (awsf.delegate-lease/v1): lease id, task,
    granted at, acts (from the delegable set only), caps { ceiling (<= MAX_CALL_CEILING),
    continuations (<= 2), reworks (<= 1), jevUsd }, autonomy (earned | all), degradeReview
    (boolean), fallbackRoutes (role -> route), optional endsAt, and the grant's reason.
    Revocation and autonomy changes are later records; the latest valid state wins.
  Persist to the task's delegate-leases.jsonl through Journal, append-only. Continuation
    tasks carry the parent's lease id; the lease record lists them.
  awsf delegate grant TASK --acts a,b --reason "..." [--autonomy earned|all]
    [--ceiling N] [--continuations N] [--jev-usd X] [--degrade-review]
    [--fallback-route role=route] [--until ISO]: interactive owner terminal, credential-free
    reason, and a confirmation screen that lists every act, cap and fallback before writing.
    Defaults (Q1): raise, resume, cancel, replacement review, rework, continue; degrade-review
    only with its flag; ceiling 20, continuations 2, reworks 1, jevUsd 0.50, autonomy earned.
  awsf delegate revoke TASK --reason "...", and awsf delegate autonomy TASK earned|all
    --reason "...": interactive owner acts.
  core/src/delegate/lease-check.ts: pure check(lease, act, facts, spend) -> allowed with the
    autonomy basis, or refused with a reason (not granted, revoked, expired, cap reached,
    task ended, act never delegable, autonomy not earned).
  G19-C: register the delegate family in main.ts and CLI_COMMANDS, the cheatsheet's commands
    and owner-acts lists, the guard verb in delegation-guard.sh, marimba-guard-rules.mts and
    marimba-guard.test.ts, and every driving document boundary-claims names. awsf status shows
    the active lease, its caps, used amounts and autonomy.

DO NOT
  Let a lease name land, publish, journey, grant, attribute, seed outside a continuation, or
    delegate itself. The contract's act union cannot express them.
  Accept a lease from a piped stdin. Marimba is denied the whole verb family.

BUILDER READY
  Tests: grant writes one record after confirmation and none when declined; each refusal
    reason in lease-check; revoke and autonomy change the effective state; the guard denies
    awsf delegate; boundary-claims and cheatsheet-reconciliation pass.
  npm run typecheck and npm run lint exit 0; npm run test:unit passes.

OWNER ACCEPTANCE
  The owner grants a lease on a throwaway task at their terminal, reads the confirmation
    screen, revokes it, and sees both in awsf status.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(delegate): add the owner's lease commands and wire the delegate verb
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket is delivered and verified (manual) or its milestone lands
  (shift): task 9's rows in specs/awsf-v2-w19-jev-delegate.html and this ticket's state move together in one
  commit (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes (manual: your final report), give dated findings for T11:
  contradictions with their prompts (which wins, and why), moved or renamed files, scope
  they can skip or must absorb. The owner copies them into those tickets' ## Handoff.
  Edit no ticket file.
```

### T10 — The quota plan: when to resume, when to wait, when to stop

```
ROUTING
  Manual (this milestone's path): Opus 5.5 at high or xhigh, or the nearest route live
  quota allows. The owner runs this ticket in one session and does the bookkeeping after it.
  Managed: not planned for M3. It builds the authority later shifts run under, and some of
  its tickets write protected paths a shift builder cannot reach. If a host ever runs it,
  host configuration owns routing.

TASK 10 of 28. Plan: specs/awsf-v2-w19-jev-delegate.html, milestone M3, task 10.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Manual: write inside core/src/**, core/test/**, dashboard/**, prompts/**, docs/cheatsheet.html.
  Never write specs/** (plan markers, ticket state, Handoff), AGENTS.md, awsf.config.yaml,
  awsf.project.yaml, core/src/state/**, core/src/policy/**,
  core/src/observability/migrations/**, core/src/execution/transport-broker.ts,
  docs/driving/**, or a .claude/ directory at the repository root, unless this ticket names the path above.
  Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T04. Manual: each delivered and verified before you start. In a shift,
  a predecessor in the same selection needs only its host-recorded gates on this head.
  Gates: None.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red
  base is reported, not fixed inside this ticket. Inside a shift, the previous ticket's
  tests gate passed on the head you start from.

READ FIRST
  AGENTS.md in full; Section A of specs/awsf-v2-w19-jev-delegate-build-prompts.md
  specs/awsf-v2-w19-jev-delegate.html - Problem (quota facts), Decisions already taken (Q3a, Q3b), DD9, task 10
  core/src/quota/parse.ts, readout.ts, probe.ts - what the host already reads
  core/test/unit/meta/quota-fence.test.ts - workflow code may not reach quota
  core/src/metrics/phase-facts.ts - per-phase routes (W18 M1)

DO
  Create core/src/delegate/quota-plan.ts: pure planResume({ windows, expectedDraw, now,
    config }) over the readout's five_hour and seven_day windows (percent remaining, resets
    at, pace reserve) returns resume-now, wait-until(at) or stop(reason).
  Rule (starting values, all in config.delegate.quota with these defaults): resume when the
    five-hour window has at least expectedDraw + 10 points and the weekly window at least 15%;
    wait until the limiting window's reset plus 5 minutes when it is the five-hour window, or
    the weekly window and it resets within 6 hours; otherwise stop (weekly-limiter).
  expectedDraw(route, phase kind): the median drop in percent between consecutive boundary
    snapshots around past phases on that route, from the journal; 15 points when fewer than 3
    samples exist. Label it planning-only: it is never shown, stored or exported as a task's
    cost (the replacement guarantee for decision 5's account-wide rule).
  Unknown, stale or unparseable quota is stop(quota-unknown), never resume.

DO NOT
  Import this module from core/src/workflow/** or the routing resolver. Extend
    quota-fence.test.ts so neither may reach core/src/delegate/**.
  Ask Jev anything here. This is arithmetic.

BUILDER READY
  Table tests over synthetic windows: each branch, the fallback draw, stale data, a weekly
    reset 5 h vs 7 h away, and a window that recovers exactly at the threshold.
  The extended quota fence passes. npm run typecheck, npm run lint, npm run test:unit pass.

OWNER ACCEPTANCE
  None for this ticket alone.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(delegate): plan resume, wait or stop from the five-hour and weekly windows
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket is delivered and verified (manual) or its milestone lands
  (shift): task 10's rows in specs/awsf-v2-w19-jev-delegate.html and this ticket's state move together in one
  commit (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes (manual: your final report), give dated findings for T11, T14:
  contradictions with their prompts (which wins, and why), moved or renamed files, scope
  they can skip or must absorb. The owner copies them into those tickets' ## Handoff.
  Edit no ticket file.
```

### T11 — The runner hands stops to the Delegate: raise, resume, wait, cancel, notify

```
ROUTING
  Manual (this milestone's path): Opus 5.5 at high or xhigh, or the nearest route live
  quota allows. The owner runs this ticket in one session and does the bookkeeping after it.
  Managed: not planned for M3. It builds the authority later shifts run under, and some of
  its tickets write protected paths a shift builder cannot reach. If a host ever runs it,
  host configuration owns routing.

TASK 11 of 28. Plan: specs/awsf-v2-w19-jev-delegate.html, milestone M3, task 11.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Manual: write inside core/src/**, core/test/**, dashboard/**, prompts/**, docs/cheatsheet.html.
  Never write specs/** (plan markers, ticket state, Handoff), AGENTS.md, awsf.config.yaml,
  awsf.project.yaml, core/src/state/**, core/src/policy/**,
  core/src/observability/migrations/**, core/src/execution/transport-broker.ts,
  docs/driving/**, or a .claude/ directory at the repository root, unless this ticket names the path above.
  Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T05, T06, T08, T09, T10. Manual: each delivered and verified before you start. In a shift,
  a predecessor in the same selection needs only its host-recorded gates on this head.
  Gates: G19-S and G19-C committed. G19-Q (routing.quota_stop set) is needed for a real quota pause but not for this ticket's tests.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red
  base is reported, not fixed inside this ticket. Inside a shift, the previous ticket's
  tests gate passed on the head you start from.

READ FIRST
  AGENTS.md in full; Section A of specs/awsf-v2-w19-jev-delegate-build-prompts.md
  specs/awsf-v2-w19-jev-delegate.html - Solution (DD7 to DD10), Execution, task 11
  core/src/cli/commands/production-run.ts - the phase loop, checkpoint writes, and
    resumeProductionCommand
  core/src/cli/main.ts - the run and resume arms
  core/src/registry/placement.ts, placement-schema.ts - the machine-local layer
  core/src/execution/transport-broker.ts - how a command is run (protected; read only)

DO
  In awsf run and the resume path: when the task has an active lease, hand each stop to
    core/src/delegate/drive.ts instead of exiting. drive builds the facts, reads the latest
    proposal, runs lease-check, and for a code-decided act performs it through ActAuthority
    delegate, then continues the run in-process:
      ceiling-pause -> raise by the proposal's calls (one or more MAX_GRANT_CALLS acts, each
                       journaled) -> resume
      quota-pause and the L26 stop -> quota plan: resume-now -> resume; wait-until -> journal
                       delegate.wait { until } and wait in this process; stop -> hand back
      a proposal of cancel -> cancel
  awsf run on a parked attempt with an active lease continues from the checkpoint through the
    same path, so a crashed or restarted process recovers from the journal.
  Everything the Delegate cannot do hands back: journal delegate.handback { reason } and exit
    as today, with nextAction naming the owner act.
  After every act and every handback, run the notify hook when the placement layer declares
    delegate.notify.argv: an argv array run through the transport broker with a one-line
    summary on stdin, no shell, a 10 s limit, its failure journaled and never blocking.
  Every act record carries actor delegate, the lease id, the decision record ids and the
    autonomy basis.

DO NOT
  Import node:child_process or spawn outside the broker (invariants 3 and 4).
  Retry a failed act. A refused or failed act hands back.
  Keep waiting after the lease is revoked or ends. Re-read the lease before every act and
    after every wait.

BUILDER READY
  Journey tests on a stub route with a fake clock: a leased shift hits a ceiling-pause and
    continues after a delegated raise and resume; a quota-pause waits until the planned time
    and resumes; a revoked lease hands back mid-wait; Jev unavailable hands back; a restarted
    run resumes from the journal; the notify argv receives one line per act.
  npm run typecheck and npm run lint exit 0; npm run test:unit passes.

OWNER ACCEPTANCE
  None for this ticket alone. M3's acceptance is task 12's list.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(delegate): let a leased run handle ceiling, quota and cancel stops itself
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket is delivered and verified (manual) or its milestone lands
  (shift): task 11's rows in specs/awsf-v2-w19-jev-delegate.html and this ticket's state move together in one
  commit (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes (manual: your final report), give dated findings for T12, T13, T14, T15:
  contradictions with their prompts (which wins, and why), moved or renamed files, scope
  they can skip or must absorb. The owner copies them into those tickets' ## Handoff.
  Edit no ticket file.
```

### T12 — Testing Strategy for M3: a leased shift through ceiling and quota stops

```
ROUTING
  Manual (this milestone's path): Opus 5.5 at high or xhigh, or the nearest route live
  quota allows. The owner runs this ticket in one session and does the bookkeeping after it.
  Managed: not planned for M3. It builds the authority later shifts run under, and some of
  its tickets write protected paths a shift builder cannot reach. If a host ever runs it,
  host configuration owns routing.

TASK 12 of 28. Plan: specs/awsf-v2-w19-jev-delegate.html, milestone M3, task 12.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Manual: write inside core/src/**, core/test/**, dashboard/**, prompts/**, docs/cheatsheet.html.
  Never write specs/** (plan markers, ticket state, Handoff), AGENTS.md, awsf.config.yaml,
  awsf.project.yaml, core/src/state/**, core/src/policy/**,
  core/src/observability/migrations/**, core/src/execution/transport-broker.ts,
  docs/driving/**, or a .claude/ directory at the repository root, unless this ticket names the path above.
  Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T07, T11. Manual: each delivered and verified before you start. In a shift,
  a predecessor in the same selection needs only its host-recorded gates on this head.
  Gates: G19-Q must be committed before the owner's live drive.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red
  base is reported, not fixed inside this ticket. Inside a shift, the previous ticket's
  tests gate passed on the head you start from.

READ FIRST
  AGENTS.md in full; Section A of specs/awsf-v2-w19-jev-delegate-build-prompts.md
  specs/awsf-v2-w19-jev-delegate.html - task 12, Execution, Validation

DO
  Add a journey that runs a three-ticket synthetic shift under a lease through one
    ceiling-pause, one quota-pause and one ticket-block (handed back), and asserts the journal
    tells the whole story: proposals, decisions, acts with actor delegate, the wait, the
    handback, and no record claiming the owner.
  Add a meta-test: every delegate.act record names a lease that allowed it at that time.
  Record the unit count at the base SHA and after.

DO NOT
  Spend quota in any test. The live drive is the owner's.

BUILDER READY
  The journey and the meta-test pass. npm run typecheck, npm run lint and npm run test:unit
    pass.

OWNER ACCEPTANCE
  w19-m3 journey: the owner grants a lease on a real small shift before leaving it overnight,
    and in the morning reads awsf status, the journal's delegate records and the notify
    messages, and confirms every act matches what they would have done.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: test(delegate): prove a leased shift through ceiling and quota stops
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket is delivered and verified (manual) or its milestone lands
  (shift): task 12's rows in specs/awsf-v2-w19-jev-delegate.html and this ticket's state move together in one
  commit (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes (manual: your final report), give dated findings for T16, T26:
  contradictions with their prompts (which wins, and why), moved or renamed files, scope
  they can skip or must absorb. The owner copies them into those tickets' ## Handoff.
  Edit no ticket file.
```

### T13 — Rework, replacement review and degrade-review under the lease

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M4 under the owner's --route
  flags, normally with a Delegate lease the owner granted. The host owns routing. Do not
  change it.
  Manual: Opus 5.5 at high, or the nearest route live quota allows.

TASK 13 of 28. Plan: specs/awsf-v2-w19-jev-delegate.html, milestone M4, task 13.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**, docs/cheatsheet.html. The host commits
  this ticket and runs its gates before the next ticket starts.
  Never write specs/** (plan markers, ticket state, Handoff), AGENTS.md, awsf.config.yaml,
  awsf.project.yaml, core/src/state/**, core/src/policy/**,
  core/src/observability/migrations/**, core/src/execution/transport-broker.ts,
  docs/driving/**, or a .claude/ directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T11. Manual: each delivered and verified before you start. In a shift,
  a predecessor in the same selection needs only its host-recorded gates on this head.
  Gates: None beyond M3's.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red
  base is reported, not fixed inside this ticket. Inside a shift, the previous ticket's
  tests gate passed on the head you start from.

READ FIRST
  AGENTS.md in full; Section A of specs/awsf-v2-w19-jev-delegate-build-prompts.md
  specs/awsf-v2-w19-jev-delegate.html - Decisions already taken (Q1, Q8), DD11, task 13
  core/src/cli/commands/rework.ts - the defect, the credential rejection, maxCorrections 0
  core/src/cli/commands/review.ts - L25 eligibility
  core/src/cli/commands/degrade-review.ts

DO
  Add question set finding-pick v1: a choice over the review's findings keyed by index, plus
    none. Its policy returns a finding only at confidence >= 0.85. The defect passed to rework
    is that finding's text with its file and line, copied verbatim by code. At most one
    delegated rework per attempt (the lease cap).
  Replacement review: only when the host's L25 eligibility holds (evidence-gate-absent or
    evidence-gate-failed). No Jev question.
  degrade-review: only when the lease has --degrade-review and the act is needed before a
    continuation's start or after a route fallback collapses the builder/reviewer provider
    pair.
  Each goes through drive.ts, lease-check and autonomyFor; a locked act hands back with
    reason autonomy-not-earned.

DO NOT
  Let Jev write or edit defect text. Code copies it.
  Retry a rework that aborted on credential-shaped output. It ends BLOCKED and task 15
    decides what follows.

BUILDER READY
  Journey tests for each act on stub routes, including a locked act handing back and an
    owner-all lease letting it run with basis owner-all.
  npm run typecheck and npm run lint exit 0; npm run test:unit passes.

OWNER ACCEPTANCE
  None for this ticket alone.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(delegate): delegate rework, replacement review and degrade-review
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket is delivered and verified (manual) or its milestone lands
  (shift): task 13's rows in specs/awsf-v2-w19-jev-delegate.html and this ticket's state move together in one
  commit (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes (manual: your final report), give dated findings for T16:
  contradictions with their prompts (which wins, and why), moved or renamed files, scope
  they can skip or must absorb. The owner copies them into those tickets' ## Handoff.
  Edit no ticket file.
```

### T14 — Route fallback when a provider's window is spent

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M4 under the owner's --route
  flags, normally with a Delegate lease the owner granted. The host owns routing. Do not
  change it.
  Manual: Opus 5.5 at high, or the nearest route live quota allows.

TASK 14 of 28. Plan: specs/awsf-v2-w19-jev-delegate.html, milestone M4, task 14.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**, docs/cheatsheet.html. The host commits
  this ticket and runs its gates before the next ticket starts.
  Never write specs/** (plan markers, ticket state, Handoff), AGENTS.md, awsf.config.yaml,
  awsf.project.yaml, core/src/state/**, core/src/policy/**,
  core/src/observability/migrations/**, core/src/execution/transport-broker.ts,
  docs/driving/**, or a .claude/ directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T10, T11. Manual: each delivered and verified before you start. In a shift,
  a predecessor in the same selection needs only its host-recorded gates on this head.
  Gates: None beyond M3's.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red
  base is reported, not fixed inside this ticket. Inside a shift, the previous ticket's
  tests gate passed on the head you start from.

READ FIRST
  AGENTS.md in full; Section A of specs/awsf-v2-w19-jev-delegate-build-prompts.md
  specs/awsf-v2-w19-jev-delegate.html - Decisions already taken (Q3c), DD12, task 14
  core/src/workflow/phase-routing.ts - requestedPhaseRoute and overrides
  core/src/workflow/phase-recovery.ts - the binding checks resume enforces
  core/test/unit/meta/quota-fence.test.ts

DO
  When the quota plan returns stop and the lease names a fallback route for the next phase's
    role, append a delegate route-override record (awsf.delegate-route-override/v1: role,
    route, lease id, the quota facts that caused it) and resume.
  The routing resolver reads the override exactly as it reads an owner's --route. It never
    reads quota: the Delegate chose the route, the resolver only applies it.
  Extend the recovery binding so a journaled delegate override is an admitted change and any
    other route change still refuses.
  If the override leaves builder and reviewer on one provider, degrade-review is required;
    without the lease flag the Delegate hands back.

DO NOT
  Let core/src/workflow/** or the resolver import core/src/quota/** or core/src/delegate/**.
  Change awsf.config.yaml or any snapshot.

BUILDER READY
  Tests: an override applies to the role's remaining phases only; resume accepts it and
    refuses an unjournaled change; the collapsed pair without the flag hands back; the quota
    fence passes.
  npm run typecheck and npm run lint exit 0; npm run test:unit passes.

OWNER ACCEPTANCE
  None for this ticket alone.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(delegate): fall back to a leased route when a provider window is spent
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket is delivered and verified (manual) or its milestone lands
  (shift): task 14's rows in specs/awsf-v2-w19-jev-delegate.html and this ticket's state move together in one
  commit (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes (manual: your final report), give dated findings for T16:
  contradictions with their prompts (which wins, and why), moved or renamed files, scope
  they can skip or must absorb. The owner copies them into those tickets' ## Handoff.
  Edit no ticket file.
```

### T15 — Continuation after a ticket block or a BLOCKED attempt

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M4 under the owner's --route
  flags, normally with a Delegate lease the owner granted. The host owns routing. Do not
  change it.
  Manual: Opus 5.5 at high, or the nearest route live quota allows.

TASK 15 of 28. Plan: specs/awsf-v2-w19-jev-delegate.html, milestone M4, task 15.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**, docs/cheatsheet.html. The host commits
  this ticket and runs its gates before the next ticket starts.
  Never write specs/** (plan markers, ticket state, Handoff), AGENTS.md, awsf.config.yaml,
  awsf.project.yaml, core/src/state/**, core/src/policy/**,
  core/src/observability/migrations/**, core/src/execution/transport-broker.ts,
  docs/driving/**, or a .claude/ directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T11. Manual: each delivered and verified before you start. In a shift,
  a predecessor in the same selection needs only its host-recorded gates on this head.
  Gates: None beyond M3's.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red
  base is reported, not fixed inside this ticket. Inside a shift, the previous ticket's
  tests gate passed on the head you start from.

READ FIRST
  AGENTS.md in full; Section A of specs/awsf-v2-w19-jev-delegate-build-prompts.md
  specs/awsf-v2-w19-jev-delegate.html - Decisions already taken (Q14), DD13, task 15
  core/src/cli/commands/new.ts, seed.ts, start.ts, cancel.ts
  core/src/workflow/candidate-seed.ts - seeds need a BLOCKED or CANCELLED source
  core/src/state/errors.ts - EDGE_BLOCKER_CODES

DO
  Add question set failure-kind v1 over bounded evidence (the failing gate's output tail and
    any envelope error, at most 8 KiB): code_bug, wrong_test, environment, provider_fault,
    other.
  Continue only from a ticket-block checkpoint, or BLOCKED with correction-budget-exhausted,
    review-unavailable, review-malformed, silence or crash. Never from permission-breach,
    preflight-failed, any L21 or L24 code, quota-exhausted or budget-exhausted.
  code_bug and wrong_test continue; provider_fault continues; environment and other hand
    back. Confidence below 0.8 hands back.
  A continuation: cancel the parked attempt when it is parked; awsf new --continues with a
    request code composes from the original request and the failing ticket's id and gate;
    seed from the source candidate; degrade-review when needed and leased; start; run under
    the same lease. At most the lease's continuations cap (2).
  Verify whether a shift can select from a given ticket. If it can, the continuation selects
    the failed ticket onward; if not, it reselects the milestone on the seeded candidate.
    Record which in your report.

DO NOT
  Retry the same task. The shift never retries itself; a continuation is a new task.
  Continue from any code outside the admitted list.

BUILDER READY
  Journey tests: a ticket-block continues once and the child finishes; a second failure
    continues again; a third hands back at the cap; permission-breach never continues.
  npm run typecheck and npm run lint exit 0; npm run test:unit passes.

OWNER ACCEPTANCE
  None for this ticket alone.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(delegate): continue a blocked shift as a bounded, seeded follow-up task
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket is delivered and verified (manual) or its milestone lands
  (shift): task 15's rows in specs/awsf-v2-w19-jev-delegate.html and this ticket's state move together in one
  commit (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes (manual: your final report), give dated findings for T16:
  contradictions with their prompts (which wins, and why), moved or renamed files, scope
  they can skip or must absorb. The owner copies them into those tickets' ## Handoff.
  Edit no ticket file.
```

### T16 — Testing Strategy for M4

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M4 under the owner's --route
  flags, normally with a Delegate lease the owner granted. The host owns routing. Do not
  change it.
  Manual: Opus 5.5 at high, or the nearest route live quota allows.

TASK 16 of 28. Plan: specs/awsf-v2-w19-jev-delegate.html, milestone M4, task 16.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**, docs/cheatsheet.html. The host commits
  this ticket and runs its gates before the next ticket starts.
  Never write specs/** (plan markers, ticket state, Handoff), AGENTS.md, awsf.config.yaml,
  awsf.project.yaml, core/src/state/**, core/src/policy/**,
  core/src/observability/migrations/**, core/src/execution/transport-broker.ts,
  docs/driving/**, or a .claude/ directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T12, T13, T14, T15. Manual: each delivered and verified before you start. In a shift,
  a predecessor in the same selection needs only its host-recorded gates on this head.
  Gates: None beyond M3's.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red
  base is reported, not fixed inside this ticket. Inside a shift, the previous ticket's
  tests gate passed on the head you start from.

READ FIRST
  AGENTS.md in full; Section A of specs/awsf-v2-w19-jev-delegate-build-prompts.md
  specs/awsf-v2-w19-jev-delegate.html - task 16, Validation

DO
  One journey: a leased two-milestone shift meets a review asking for changes (delegated
    rework), a spent weekly window with a leased fallback route, and a ticket block
    (continuation), and ends at AWAITING_OWNER with land-shadow proposed and not taken.
  A meta-test proves no input sequence makes the Delegate land, publish, journey, grant or
    attribute.

DO NOT
  Spend quota in a test.

BUILDER READY
  Both pass. npm run typecheck, npm run lint and npm run test:unit pass, with the count at the
    base and after.

OWNER ACCEPTANCE
  w19-m4 journey: the owner reads the journal of one real leased overnight shift that hit a
    judgment act or a continuation, and confirms the choice and its evidence.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: test(delegate): prove judgment acts, route fallback and continuation end to end
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket is delivered and verified (manual) or its milestone lands
  (shift): task 16's rows in specs/awsf-v2-w19-jev-delegate.html and this ticket's state move together in one
  commit (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes (manual: your final report), give dated findings for T26, T28:
  contradictions with their prompts (which wins, and why), moved or renamed files, scope
  they can skip or must absorb. The owner copies them into those tickets' ## Handoff.
  Edit no ticket file.
```

### T17 — The decision socket: the host answers typed questions for its phases

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M5 under the owner's --route
  flags, normally with a Delegate lease the owner granted. The host owns routing. Do not
  change it.
  Manual: Opus 5.5 at high, or the nearest route live quota allows.

TASK 17 of 28. Plan: specs/awsf-v2-w19-jev-delegate.html, milestone M5, task 17.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**, docs/cheatsheet.html. The host commits
  this ticket and runs its gates before the next ticket starts.
  Never write specs/** (plan markers, ticket state, Handoff), AGENTS.md, awsf.config.yaml,
  awsf.project.yaml, core/src/state/**, core/src/policy/**,
  core/src/observability/migrations/**, core/src/execution/transport-broker.ts,
  docs/driving/**, or a .claude/ directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T02. Manual: each delivered and verified before you start. In a shift,
  a predecessor in the same selection needs only its host-recorded gates on this head.
  Gates: None.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red
  base is reported, not fixed inside this ticket. Inside a shift, the previous ticket's
  tests gate passed on the head you start from.

READ FIRST
  AGENTS.md in full; Section A of specs/awsf-v2-w19-jev-delegate-build-prompts.md
  specs/awsf-v2-w19-jev-delegate.html - Solution (DD14), Questionables, task 17
  core/src/adapters/env.ts - filterEnv
  core/src/policy/sandbox-broker.ts - what a phase process can reach (protected; read)
  core/src/adapters/pi-codex.ts - buildSpec and the clean-room flags

DO
  Create core/src/decision/socket.ts: for the life of each agent phase the host listens on a
    unix socket in the attempt's private directory and passes its path to the phase as
    AWSF_DECISION_SOCKET (added to filterEnv's allowlist). Newline-delimited JSON:
    { id, set } for a registered question set, or { id, raw: { state, questions } } for the
    agent-authored tools of M7. The host validates, redacts, calls decide(), journals the
    record with the phase as caller, and replies { answers, recordId } or { error }.
  Caps per phase: 300 calls and the lease's jevUsd when a lease exists. Over a cap the socket
    replies error: cap.
  First verify the sandbox lets a phase process connect to the socket path. If it does not,
    stop and report what it allows.

DO NOT
  Pass OPENROUTER_API_KEY or any credential to a phase.
  Use node:child_process. A socket server is node:net.

BUILDER READY
  Tests over a real socket in a tmp dir: a registered set, a raw block, an invalid block, a
    cap, a closed socket, and a phase env that carries the socket path and no key.
  npm run typecheck and npm run lint exit 0; npm run test:unit passes.

OWNER ACCEPTANCE
  None for this ticket alone.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(decision): serve typed questions to agent phases over a host socket
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket is delivered and verified (manual) or its milestone lands
  (shift): task 17's rows in specs/awsf-v2-w19-jev-delegate.html and this ticket's state move together in one
  commit (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes (manual: your final report), give dated findings for T18, T19, T23, T24:
  contradictions with their prompts (which wins, and why), moved or renamed files, scope
  they can skip or must absorb. The owner copies them into those tickets' ## Handoff.
  Edit no ticket file.
```

### T18 — jev-guard for pi roles: bash gate, result screen, reviewer-injection screen

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M5 under the owner's --route
  flags, normally with a Delegate lease the owner granted. The host owns routing. Do not
  change it.
  Manual: Opus 5.5 at high, or the nearest route live quota allows.

TASK 18 of 28. Plan: specs/awsf-v2-w19-jev-delegate.html, milestone M5, task 18.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**, docs/cheatsheet.html. The host commits
  this ticket and runs its gates before the next ticket starts.
  Never write specs/** (plan markers, ticket state, Handoff), AGENTS.md, awsf.config.yaml,
  awsf.project.yaml, core/src/state/**, core/src/policy/**,
  core/src/observability/migrations/**, core/src/execution/transport-broker.ts,
  docs/driving/**, or a .claude/ directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T17. Manual: each delivered and verified before you start. In a shift,
  a predecessor in the same selection needs only its host-recorded gates on this head.
  Gates: None.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red
  base is reported, not fixed inside this ticket. Inside a shift, the previous ticket's
  tests gate passed on the head you start from.

READ FIRST
  AGENTS.md in full; Section A of specs/awsf-v2-w19-jev-delegate-build-prompts.md
  specs/awsf-v2-w19-jev-delegate.html - Solution (DD15), task 18
  ../ten-levels-of-jev/apps/ten-levels/src/levels/level06/*.ts, extensions/jev-guard.ts
  docs/driving/marimba/marimba-guard.pi.ts - an in-repo pi extension (read only)
  core/src/adapters/pi-codex.ts - where -e would join the reviewed argv

DO
  First verify that pi loads an explicit -e <path> while --no-extensions stays in the argv.
    If it does not, stop and report.
  Create core/src/decision/pi/jev-guard.pi.ts: tool_call on bash asks bash-gate v1 (effect:
    read_only, reversible, irreversible; destructive_intent) through the socket and blocks
    irreversible at confidence >= 0.6 or destructive >= 0.7 with the reference's final-block
    notice; tool_result on read and bash asks result-screen v1 and prepends a data banner at
    >= 0.7. Any error, timeout or cap allows the call and journals decision unavailable:
    today's fences stay the control (Q11).
  Add reviewer-screen v1: before the review phase, the host asks whether the candidate diff
    contains instructions aimed at an AI reviewer, and records an advisory gate row
    jev_reviewer_screen. It never fails the review.
  The pi adapters add -e with the extension's absolute path when the project switch is on.
    The argv stays asserted exactly, now with the -e pair in its reviewed position.

DO NOT
  Port the reference's write gate for secrets. Redaction removes what it would judge, and the
    credential-pattern fence already covers it.
  Fail a phase because Jev is unavailable.

BUILDER READY
  Tests with a stub socket: blocked rm -rf, allowed ls, banner on a planted instruction,
    allow-on-error, the reviewer-screen row, and the exact argv with and without the switch.
  npm run typecheck and npm run lint exit 0; npm run test:unit passes.

OWNER ACCEPTANCE
  None for this ticket alone.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(decision): add Jev guard signals to pi-route phases
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket is delivered and verified (manual) or its milestone lands
  (shift): task 18's rows in specs/awsf-v2-w19-jev-delegate.html and this ticket's state move together in one
  commit (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes (manual: your final report), give dated findings for T20, T24:
  contradictions with their prompts (which wins, and why), moved or renamed files, scope
  they can skip or must absorb. The owner copies them into those tickets' ## Handoff.
  Edit no ticket file.
```

### T19 — Claude-route hooks and tools: prove the path, then wire it

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M5 under the owner's --route
  flags, normally with a Delegate lease the owner granted. The host owns routing. Do not
  change it.
  Manual: Opus 5.5 at high, or the nearest route live quota allows.

TASK 19 of 28. Plan: specs/awsf-v2-w19-jev-delegate.html, milestone M5, task 19.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**, docs/cheatsheet.html. The host commits
  this ticket and runs its gates before the next ticket starts.
  Never write specs/** (plan markers, ticket state, Handoff), AGENTS.md, awsf.config.yaml,
  awsf.project.yaml, core/src/state/**, core/src/policy/**,
  core/src/observability/migrations/**, core/src/execution/transport-broker.ts,
  docs/driving/**, or a .claude/ directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T17. Manual: each delivered and verified before you start. In a shift,
  a predecessor in the same selection needs only its host-recorded gates on this head.
  Gates: None.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red
  base is reported, not fixed inside this ticket. Inside a shift, the previous ticket's
  tests gate passed on the head you start from.

READ FIRST
  AGENTS.md in full; Section A of specs/awsf-v2-w19-jev-delegate-build-prompts.md
  specs/awsf-v2-w19-jev-delegate.html - Decisions already taken (Q12, Q13), Questionables, task 19
  core/src/adapters/claude-code.ts - the argv
  core/test/unit/meta/execution-isolation.test.ts - no root .claude/

DO
  Prove, with the installed claude CLI's own help and a stub run, whether a phase can receive
    (a) PreToolUse and PostToolUse hooks from a settings file passed on the command line and
    (b) tools from an MCP server config passed on the command line, both from the attempt's
    private directory and neither discovered from the worktree.
  If both hold: pass them in the reviewed argv, with a hook script and a small stdio MCP
    server under core/src/decision/claude/ that talk to the decision socket, carrying the
    same bash gate, result screen and (for M7) tool set as the pi route.
  If either fails: change no adapter, and return the evidence so the task closes [f] and M7's
    tools stay pi-only.

DO NOT
  Create a .claude/ directory in the worktree or the repository root.
  Pass a credential to the claude process.

BUILDER READY
  Either the wired path with tests like task 18's, or a report of the exact flags tried and
    what the CLI did. npm run typecheck, npm run lint and npm run test:unit pass.

OWNER ACCEPTANCE
  The owner decides from the report whether the task is [x] or [f].

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(decision): carry Jev hooks and tools to claude-route phases
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket is delivered and verified (manual) or its milestone lands
  (shift): task 19's rows in specs/awsf-v2-w19-jev-delegate.html and this ticket's state move together in one
  commit (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes (manual: your final report), give dated findings for T20:
  contradictions with their prompts (which wins, and why), moved or renamed files, scope
  they can skip or must absorb. The owner copies them into those tickets' ## Handoff.
  Edit no ticket file.
```

### T20 — Testing Strategy for M5

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M5 under the owner's --route
  flags, normally with a Delegate lease the owner granted. The host owns routing. Do not
  change it.
  Manual: Opus 5.5 at high, or the nearest route live quota allows.

TASK 20 of 28. Plan: specs/awsf-v2-w19-jev-delegate.html, milestone M5, task 20.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**, docs/cheatsheet.html. The host commits
  this ticket and runs its gates before the next ticket starts.
  Never write specs/** (plan markers, ticket state, Handoff), AGENTS.md, awsf.config.yaml,
  awsf.project.yaml, core/src/state/**, core/src/policy/**,
  core/src/observability/migrations/**, core/src/execution/transport-broker.ts,
  docs/driving/**, or a .claude/ directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T18, T19. Manual: each delivered and verified before you start. In a shift,
  a predecessor in the same selection needs only its host-recorded gates on this head.
  Gates: None.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red
  base is reported, not fixed inside this ticket. Inside a shift, the previous ticket's
  tests gate passed on the head you start from.

READ FIRST
  AGENTS.md in full; Section A of specs/awsf-v2-w19-jev-delegate-build-prompts.md
  specs/awsf-v2-w19-jev-delegate.html - task 20

DO
  A journey on the stub route: a builder phase issues a destructive command and a read of a
    planted instruction; the gate blocks, the banner appears, both decisions are journaled,
    and with the socket stopped the same phase completes on today's fences.

DO NOT
  Spend quota in a test.

BUILDER READY
  The journey passes. npm run typecheck, npm run lint and npm run test:unit pass, with the
    count at the base and after.

OWNER ACCEPTANCE
  w19-m5 journey: the owner reads one real shift's journal and sees guard decisions on the
    builder's bash calls, none of which stopped legitimate work.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: test(decision): prove guard signals and their fallback end to end
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket is delivered and verified (manual) or its milestone lands
  (shift): task 20's rows in specs/awsf-v2-w19-jev-delegate.html and this ticket's state move together in one
  commit (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes (manual: your final report), give dated findings for T25, T28:
  contradictions with their prompts (which wins, and why), moved or renamed files, scope
  they can skip or must absorb. The owner copies them into those tickets' ## Handoff.
  Edit no ticket file.
```

### T21 — The compaction question set, tiers and cut point for Marimba

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M6 under the owner's --route
  flags, normally with a Delegate lease the owner granted. The host owns routing. Do not
  change it.
  Manual: Opus 5.5 at high, or the nearest route live quota allows.

TASK 21 of 28. Plan: specs/awsf-v2-w19-jev-delegate.html, milestone M6, task 21.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**, docs/cheatsheet.html. The host commits
  this ticket and runs its gates before the next ticket starts.
  Never write specs/** (plan markers, ticket state, Handoff), AGENTS.md, awsf.config.yaml,
  awsf.project.yaml, core/src/state/**, core/src/policy/**,
  core/src/observability/migrations/**, core/src/execution/transport-broker.ts,
  docs/driving/**, or a .claude/ directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T01, T02. Manual: each delivered and verified before you start. In a shift,
  a predecessor in the same selection needs only its host-recorded gates on this head.
  Gates: None to build. G19-D (the owner's driving-document commit and pi settings) comes before the pilot.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red
  base is reported, not fixed inside this ticket. Inside a shift, the previous ticket's
  tests gate passed on the head you start from.

READ FIRST
  AGENTS.md in full; Section A of specs/awsf-v2-w19-jev-delegate-build-prompts.md
  specs/awsf-v2-w19-jev-delegate.html - Solution (DD16), task 21
  ../ten-levels-of-jev/apps/ten-levels/src/levels/level07/*.ts, extensions/jev-compact.ts
  docs/driving/marimba/compaction/ - the current profile (read only)

DO
  Add question sets compaction v1 (switched_gears, at_boundary, needs_history, mid_operation)
    and cut-point v1 (a choice over turns keyed by index, plus none), with the reference's
    pure tier policy (silent, notice, recommend, request) and its token lines taken from the
    Marimba profile's existing lines, not the reference's demo values.
  Create core/src/decision/pi/jev-compact.pi.ts for Marimba's own pi session: turn_end asks
    compaction through core/src/decision/jev-transport.ts directly, because Marimba is the
    owner's session and not an AWSF phase; it records each decision as a pi session entry and
    injects the tier message only when not silent; session_before_compact adds the cut point
    to the instructions.

DO NOT
  Write under docs/driving/**. The profile change is G19-D.
  Replace the self-compact extension. This adds a judgment to it.

BUILDER READY
  Tests of the tier policy at each line and of the cut point's floor. npm run typecheck,
    npm run lint and npm run test:unit pass.

OWNER ACCEPTANCE
  None for this ticket alone.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(decision): add Jev compaction judgment for Marimba's pi session
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket is delivered and verified (manual) or its milestone lands
  (shift): task 21's rows in specs/awsf-v2-w19-jev-delegate.html and this ticket's state move together in one
  commit (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes (manual: your final report), give dated findings for T22:
  contradictions with their prompts (which wins, and why), moved or renamed files, scope
  they can skip or must absorb. The owner copies them into those tickets' ## Handoff.
  Edit no ticket file.
```

### T22 — Testing Strategy for M6, and the Marimba pilot

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M6 under the owner's --route
  flags, normally with a Delegate lease the owner granted. The host owns routing. Do not
  change it.
  Manual: Opus 5.5 at high, or the nearest route live quota allows.

TASK 22 of 28. Plan: specs/awsf-v2-w19-jev-delegate.html, milestone M6, task 22.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**, docs/cheatsheet.html. The host commits
  this ticket and runs its gates before the next ticket starts.
  Never write specs/** (plan markers, ticket state, Handoff), AGENTS.md, awsf.config.yaml,
  awsf.project.yaml, core/src/state/**, core/src/policy/**,
  core/src/observability/migrations/**, core/src/execution/transport-broker.ts,
  docs/driving/**, or a .claude/ directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T21. Manual: each delivered and verified before you start. In a shift,
  a predecessor in the same selection needs only its host-recorded gates on this head.
  Gates: G19-D before the pilot.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red
  base is reported, not fixed inside this ticket. Inside a shift, the previous ticket's
  tests gate passed on the head you start from.

READ FIRST
  AGENTS.md in full; Section A of specs/awsf-v2-w19-jev-delegate-build-prompts.md
  specs/awsf-v2-w19-jev-delegate.html - task 22, Notes (the 2026-09-24 pilot figures)

DO
  A simulated session of four prompts with a gear change at the third proves the tier
    sequence and one cut point, offline.

DO NOT
  Run the pilot yourself. It is the owner's, on their quota.

BUILDER READY
  The simulation passes. npm run typecheck, npm run lint and npm run test:unit pass.

OWNER ACCEPTANCE
  w19-m6 pilot: the owner runs the same four read-only prompts as the 2026-09-24 pilot
    (572k tokens, 23 turns, 1 compaction) with the extension loaded, and records tokens,
    turns, compactions and whether any compaction lost live work.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: test(decision): prove Marimba's compaction tiers and record the pilot
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket is delivered and verified (manual) or its milestone lands
  (shift): task 22's rows in specs/awsf-v2-w19-jev-delegate.html and this ticket's state move together in one
  commit (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes (manual: your final report), give dated findings for T28:
  contradictions with their prompts (which wins, and why), moved or renamed files, scope
  they can skip or must absorb. The owner copies them into those tickets' ## Handoff.
  Edit no ticket file.
```

### T23 — ask_jev_file and ask_jev_files for every configured role

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M7 under the owner's --route
  flags, normally with a Delegate lease the owner granted. The host owns routing. Do not
  change it.
  Manual: Opus 5.5 at high, or the nearest route live quota allows.

TASK 23 of 28. Plan: specs/awsf-v2-w19-jev-delegate.html, milestone M7, task 23.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**, docs/cheatsheet.html. The host commits
  this ticket and runs its gates before the next ticket starts.
  Never write specs/** (plan markers, ticket state, Handoff), AGENTS.md, awsf.config.yaml,
  awsf.project.yaml, core/src/state/**, core/src/policy/**,
  core/src/observability/migrations/**, core/src/execution/transport-broker.ts,
  docs/driving/**, or a .claude/ directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T17. Manual: each delivered and verified before you start. In a shift,
  a predecessor in the same selection needs only its host-recorded gates on this head.
  Gates: G19-T (tools.allow gains the Jev tools) must be committed before a real shift can call them.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red
  base is reported, not fixed inside this ticket. Inside a shift, the previous ticket's
  tests gate passed on the head you start from.

READ FIRST
  AGENTS.md in full; Section A of specs/awsf-v2-w19-jev-delegate-build-prompts.md
  specs/awsf-v2-w19-jev-delegate.html - Decisions already taken (Q13), task 23
  ../ten-levels-of-jev/apps/ten-levels/src/levels/level08, level09, extensions
  awsf.config.yaml - each role's tools.allow (protected; read only)

DO
  Create core/src/decision/pi/jev-tools.pi.ts registering ask_jev_file_bool,
    ask_jev_file_choice and ask_jev_file_score (one file, flat parameters, an other option
    added when missing) and ask_jev_files (paths, globs or directories and a raw question
    block; expansion and pruning in code; the 255-file cap; one socket call per file with at
    most 16 in flight). Files are read by the extension inside the worktree only; the agent
    receives answers, never content.
  Every call's decision record carries the files' byte counts, so M8 can estimate what was
    not read.
  Load it with the guard on pi routes and, if task 19 succeeded, on claude routes.

DO NOT
  Read a path outside the worktree. Resolve and refuse before any call.
  Answer exact lookups. The descriptions say grep is for those.

BUILDER READY
  Tests on a fixture tree: each tool, pruning reasons, the cap, a path escape refused, and an
    answer without file content. npm run typecheck, npm run lint, npm run test:unit pass.

OWNER ACCEPTANCE
  None for this ticket alone.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(decision): let every role ask Jev about files without reading them
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket is delivered and verified (manual) or its milestone lands
  (shift): task 23's rows in specs/awsf-v2-w19-jev-delegate.html and this ticket's state move together in one
  commit (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes (manual: your final report), give dated findings for T25:
  contradictions with their prompts (which wins, and why), moved or renamed files, scope
  they can skip or must absorb. The owner copies them into those tickets' ## Handoff.
  Edit no ticket file.
```

### T24 — ask_jev over state, paths and an argv command

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M7 under the owner's --route
  flags, normally with a Delegate lease the owner granted. The host owns routing. Do not
  change it.
  Manual: Opus 5.5 at high, or the nearest route live quota allows.

TASK 24 of 28. Plan: specs/awsf-v2-w19-jev-delegate.html, milestone M7, task 24.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**, docs/cheatsheet.html. The host commits
  this ticket and runs its gates before the next ticket starts.
  Never write specs/** (plan markers, ticket state, Handoff), AGENTS.md, awsf.config.yaml,
  awsf.project.yaml, core/src/state/**, core/src/policy/**,
  core/src/observability/migrations/**, core/src/execution/transport-broker.ts,
  docs/driving/**, or a .claude/ directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T17, T18. Manual: each delivered and verified before you start. In a shift,
  a predecessor in the same selection needs only its host-recorded gates on this head.
  Gates: G19-T before a real shift.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red
  base is reported, not fixed inside this ticket. Inside a shift, the previous ticket's
  tests gate passed on the head you start from.

READ FIRST
  AGENTS.md in full; Section A of specs/awsf-v2-w19-jev-delegate-build-prompts.md
  specs/awsf-v2-w19-jev-delegate.html - task 24
  ../ten-levels-of-jev/apps/ten-levels/src/levels/level10/*.ts, extensions/ask-jev.ts

DO
  Add ask_jev to jev-tools.pi.ts: state (short), paths (up to 20 files), command as an argv
    array, and questions_json. Code assembles one state within the budget or refuses with a
    split, as the reference does.
  The command is sent to the host over the socket, screened by bash-gate, and run by the host
    through the transport broker with the phase's cwd, a 60 s limit and a 200 KB output cap,
    only when classified read_only at confidence >= 0.8. Its output goes into the state; the
    agent never sees it.
  Carry the reference's tool description as the teaching.

DO NOT
  Run the command inside the pi process or through a shell. The reference used exec with a
    shell string; AWSF runs argv through the broker only (invariants 3 and 4).

BUILDER READY
  Tests: an assembled state, a refused over-budget state with its split, a refused
    non-read-only command, and a read-only command whose output reaches Jev and not the
    agent. npm run typecheck, npm run lint and npm run test:unit pass.

OWNER ACCEPTANCE
  None for this ticket alone.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(decision): add ask_jev over state, paths and a screened argv command
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket is delivered and verified (manual) or its milestone lands
  (shift): task 24's rows in specs/awsf-v2-w19-jev-delegate.html and this ticket's state move together in one
  commit (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes (manual: your final report), give dated findings for T25:
  contradictions with their prompts (which wins, and why), moved or renamed files, scope
  they can skip or must absorb. The owner copies them into those tickets' ## Handoff.
  Edit no ticket file.
```

### T25 — Testing Strategy for M7, and the token comparison

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M7 under the owner's --route
  flags, normally with a Delegate lease the owner granted. The host owns routing. Do not
  change it.
  Manual: Opus 5.5 at high, or the nearest route live quota allows.

TASK 25 of 28. Plan: specs/awsf-v2-w19-jev-delegate.html, milestone M7, task 25.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**, docs/cheatsheet.html. The host commits
  this ticket and runs its gates before the next ticket starts.
  Never write specs/** (plan markers, ticket state, Handoff), AGENTS.md, awsf.config.yaml,
  awsf.project.yaml, core/src/state/**, core/src/policy/**,
  core/src/observability/migrations/**, core/src/execution/transport-broker.ts,
  docs/driving/**, or a .claude/ directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T20, T23, T24. Manual: each delivered and verified before you start. In a shift,
  a predecessor in the same selection needs only its host-recorded gates on this head.
  Gates: G19-T before the owner's comparison.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red
  base is reported, not fixed inside this ticket. Inside a shift, the previous ticket's
  tests gate passed on the head you start from.

READ FIRST
  AGENTS.md in full; Section A of specs/awsf-v2-w19-jev-delegate-build-prompts.md
  specs/awsf-v2-w19-jev-delegate.html - task 25

DO
  A journey: a builder phase answers a relevance question over a fixture tree with
    ask_jev_files, opens only the picked file, and the journal shows the bytes not read.

DO NOT
  Claim a saving from a stub. The comparison is the owner's live pair.

BUILDER READY
  The journey passes. npm run typecheck, npm run lint and npm run test:unit pass.

OWNER ACCEPTANCE
  w19-m7 comparison: the owner runs one small ticket twice on the same route, tools off then
    on, and records tokens, calls, time and the outcome of each.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: test(decision): prove the Jev tools end to end and record the comparison
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket is delivered and verified (manual) or its milestone lands
  (shift): task 25's rows in specs/awsf-v2-w19-jev-delegate.html and this ticket's state move together in one
  commit (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes (manual: your final report), give dated findings for T28:
  contradictions with their prompts (which wins, and why), moved or renamed files, scope
  they can skip or must absorb. The owner copies them into those tickets' ## Handoff.
  Edit no ticket file.
```

### T26 — The Delegate and Jev read model

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M8 under the owner's --route
  flags, normally with a Delegate lease the owner granted. The host owns routing. Do not
  change it.
  Manual: Opus 5.5 at high, or the nearest route live quota allows.

TASK 26 of 28. Plan: specs/awsf-v2-w19-jev-delegate.html, milestone M8, task 26.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**, docs/cheatsheet.html. The host commits
  this ticket and runs its gates before the next ticket starts.
  Never write specs/** (plan markers, ticket state, Handoff), AGENTS.md, awsf.config.yaml,
  awsf.project.yaml, core/src/state/**, core/src/policy/**,
  core/src/observability/migrations/**, core/src/execution/transport-broker.ts,
  docs/driving/**, or a .claude/ directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T07, T12, T16. Manual: each delivered and verified before you start. In a shift,
  a predecessor in the same selection needs only its host-recorded gates on this head.
  Gates: G19-W: W18's T17 has landed.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red
  base is reported, not fixed inside this ticket. Inside a shift, the previous ticket's
  tests gate passed on the head you start from.

READ FIRST
  AGENTS.md in full; Section A of specs/awsf-v2-w19-jev-delegate-build-prompts.md
  specs/awsf-v2-w19-jev-delegate.html - Solution (DD17), task 26
  dashboard/shared/route-metrics.ts, core/src/metrics/payload.ts - W18's module and API

DO
  Create core/src/metrics/delegate-rows.ts (read-only SQL, type DatabaseSync from sqlite.ts):
    per stop and per act, the metrics of the plan's M1 to M5: owner-wait hours avoided (each
    delegated act to the owner's next interactive act on that task, capped at 24 h, labeled an
    upper bound), agreement per act (from task 6), reversals (a closed table: the owner
    cancels, revokes or reworks after a delegated act in the same attempt), stops by kind per
    week, Jev spend by cost source, and bytes judged instead of read with a labeled
    list-price equivalent from W18's rate card.
  Every row carries the resolved Jev model and question-set version (Q7).
  Extend GET /api/v1/metrics with a delegate block; the route stays read-only.

DO NOT
  Present an estimate as spend or as measured. Labels travel with values (W18 INV-3).

BUILDER READY
  Tests on a synthetic database for each metric and a rebuild parity test.
  npm run typecheck and npm run lint exit 0; npm run test:unit passes.

OWNER ACCEPTANCE
  None for this ticket alone.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(metrics): compute the Delegate and Jev rows at read time
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket is delivered and verified (manual) or its milestone lands
  (shift): task 26's rows in specs/awsf-v2-w19-jev-delegate.html and this ticket's state move together in one
  commit (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes (manual: your final report), give dated findings for T27:
  contradictions with their prompts (which wins, and why), moved or renamed files, scope
  they can skip or must absorb. The owner copies them into those tickets' ## Handoff.
  Edit no ticket file.
```

### T27 — The Delegate view in the metrics tab, with the Jev model facet

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M8 under the owner's --route
  flags, normally with a Delegate lease the owner granted. The host owns routing. Do not
  change it.
  Manual: Opus 5.5 at high, or the nearest route live quota allows.

TASK 27 of 28. Plan: specs/awsf-v2-w19-jev-delegate.html, milestone M8, task 27.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**, docs/cheatsheet.html. The host commits
  this ticket and runs its gates before the next ticket starts.
  Never write specs/** (plan markers, ticket state, Handoff), AGENTS.md, awsf.config.yaml,
  awsf.project.yaml, core/src/state/**, core/src/policy/**,
  core/src/observability/migrations/**, core/src/execution/transport-broker.ts,
  docs/driving/**, or a .claude/ directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T26. Manual: each delivered and verified before you start. In a shift,
  a predecessor in the same selection needs only its host-recorded gates on this head.
  Gates: G19-W.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red
  base is reported, not fixed inside this ticket. Inside a shift, the previous ticket's
  tests gate passed on the head you start from.

READ FIRST
  AGENTS.md in full; Section A of specs/awsf-v2-w19-jev-delegate-build-prompts.md
  specs/awsf-v2-w19-jev-delegate.html - task 27 and its mockup
  dashboard/src/routes/metrics.vue, metrics-lens.ts, metrics-chart.ts

DO
  Add a Delegate view: act tiles (proposed, taken, matched, reversed), the wait-avoided
    series by week, stops by kind by week, and a table of acts with their evidence links.
  Add the facet jevModel (and questionSet) to the lens, so versions of Jev can be compared
    side by side (Q7).
  Hand-drawn SVG, the tab's tokens, all seven palettes and both modes. The view writes
    nothing.

DO NOT
  Add a dependency or a write route.

BUILDER READY
  Component tests and the palette sweep pass. npm run typecheck, npm run lint and
    npm run test:unit pass.

OWNER ACCEPTANCE
  None for this ticket alone.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(dashboard): add the Delegate view and the Jev model facet
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket is delivered and verified (manual) or its milestone lands
  (shift): task 27's rows in specs/awsf-v2-w19-jev-delegate.html and this ticket's state move together in one
  commit (invariant 12). Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes (manual: your final report), give dated findings for T28:
  contradictions with their prompts (which wins, and why), moved or renamed files, scope
  they can skip or must absorb. The owner copies them into those tickets' ## Handoff.
  Edit no ticket file.
```

### T28 — Testing Strategy for M8, and the workstream's closing duties

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M8 under the owner's --route
  flags, normally with a Delegate lease the owner granted. The host owns routing. Do not
  change it.
  Manual: Opus 5.5 at high, or the nearest route live quota allows.

TASK 28 of 28. Plan: specs/awsf-v2-w19-jev-delegate.html, milestone M8, task 28.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**, docs/cheatsheet.html. The host commits
  this ticket and runs its gates before the next ticket starts.
  Never write specs/** (plan markers, ticket state, Handoff), AGENTS.md, awsf.config.yaml,
  awsf.project.yaml, core/src/state/**, core/src/policy/**,
  core/src/observability/migrations/**, core/src/execution/transport-broker.ts,
  docs/driving/**, or a .claude/ directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T16, T20, T22, T25, T27. Manual: each delivered and verified before you start. In a shift,
  a predecessor in the same selection needs only its host-recorded gates on this head.
  Gates: G19-W.

BASELINE
  Run npm run test:unit at your base SHA before any change and record the count. A red
  base is reported, not fixed inside this ticket. Inside a shift, the previous ticket's
  tests gate passed on the head you start from.

READ FIRST
  AGENTS.md in full; Section A of specs/awsf-v2-w19-jev-delegate-build-prompts.md
  specs/awsf-v2-w19-jev-delegate.html - task 28, Validation, the spine block for W19

DO
  A parity test: the API's delegate block, the view's numbers and awsf metrics agree on one
    synthetic database.
  Assemble the closing record: each task's final state, every gate's commit, the measured
    results of w19-m3 to w19-m7, and the acceptance criteria AC-1 to AC-10 with their
    evidence or their [f].

DO NOT
  Flip any marker. The owner does, in the bookkeeping commit.

BUILDER READY
  Parity passes. npm run typecheck, npm run lint and npm run test:unit pass.

OWNER ACCEPTANCE
  w19-jev-delegate: the owner opens the Delegate view in Chrome on their own data, in two
    palettes and both modes, and accepts or returns it.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: test(metrics): prove Delegate view parity and close W19
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after this ticket is delivered and verified (manual) or its milestone lands
  (shift): task 28's rows in specs/awsf-v2-w19-jev-delegate.html and this ticket's state move together in one
  commit (invariant 12). Return the evidence. Edit neither file.
  This is the workstream's closing ticket: the same commit moves the spine's Milestone M19
  / W19 marker in specs/awsf-v2-plan.html and specs/tickets/awsf-v2-plan/W19.md.

HANDOFF
  In your envelope's notes (manual: your final report), give dated findings for the workstream's closing record (T28) and the spine:
  contradictions with their prompts (which wins, and why), moved or renamed files, scope
  they can skip or must absorb. The owner copies them into those tickets' ## Handoff.
  Edit no ticket file.
```
