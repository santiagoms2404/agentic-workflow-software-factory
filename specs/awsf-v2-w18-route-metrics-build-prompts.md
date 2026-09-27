# AWSF v2 W18 — Route Metrics: build prompts

> **Plan:** [`awsf-v2-w18-route-metrics.html`](awsf-v2-w18-route-metrics.html) · **Spine:** [`awsf-v2-plan.html`](awsf-v2-plan.html) § Milestone M18 → W18
> **Tickets:** [`tickets/awsf-v2-w18-route-metrics/`](tickets/awsf-v2-w18-route-metrics/) — one file per task, each carrying the same prompt this file's Section B holds.

This file exists because this repository's invariant-12 fence requires it:
`core/test/unit/meta/ticket-plan-sync.test.ts` asserts a `<stem>-build-prompts.md` exists for every
plan source with a ticket set, and that each ticket's prompt is **byte-identical** to its
`### Tnn — ` block below. Both artifacts are generated from one source string, so they cannot drift.

# Section A — Conventions

**Read first, on every task.** `AGENTS.md` in full · `specs/awsf-v2-w18-route-metrics.html`
(Problem, Solution, Decisions already taken, Identifier Spine and Execution in full, then the
task's own section) · `specs/tickets/awsf-v2-w18-route-metrics/README.md`.

**Execution.** Every milestone runs as one AWSF `shift` the owner starts from Marimba
(`awsf new <task> "<request>" --workflow shift --plan awsf-v2-w18-route-metrics --milestone Mx`).
The shift carries each ticket's `## Build prompt` verbatim, followed by its `## Handoff`, and adds
host-authored non-goals that hand committing, markers and Handoff edits back to the host and the
owner. Every prompt below is written for that: its EXECUTION, COMMIT, MARKERS and HANDOFF blocks
ask the builder to write none of `specs/**`. A manual session follows the same boundary.

**The builder's write boundary.** `core/src/**`, `core/test/**`, `dashboard/**`, `prompts/**`,
plus `docs/cheatsheet.html` after gate G18-A. Never `specs/**`, `docs/driving/**`, `AGENTS.md`,
`awsf.config.yaml`, `core/src/state/**`, `core/src/observability/migrations/**`, or a root
`.claude/` directory.

**Four owner gates.**
- **G18-M**, one owner commit before M1 (Q1, decided 2026-09-26): migration 0007
  (`core/src/observability/migrations/0007-phase-route.sql`) adds `route_adapter`,
  `route_provider`, `route_model`, `route_effort` and `effort_source` to `phases`, and the
  terminal-version pins in `sqlite.test.ts` and `migration-0004.test.ts` move to 7. T01's
  projector fills the columns; T01 stops if the migration is absent.
- **G18-A**, one owner commit before M1: builder `writes` gains `docs/cheatsheet.html`. Tickets
  T06 and T17 add a CLI command and its cheatsheet line in one change, and stop if the gate is
  missing.
- **G18-C**, one owner commit after M1 lands: wire `awsf attribute`. A shift builder cannot add an
  owner-act command: `boundary-claims.test.ts` requires the guard's verbs (protected
  `docs/driving/**`) to equal exactly the `main.ts` arms that construct `processOwnerTerminal()`.
  T03 builds `attributeCommand` unregistered; the owner adds its `main.ts` arm, `CLI_COMMANDS`
  entry, cheatsheet `commands` and `owner-acts` lines, and guard verb in one commit.
- **G18-B**, one owner commit after M4 lands: wire `awsf prove` the same way (T13 builds
  `proveCommand` unregistered), and `workflows.enabled` gains `prove` with the cheatsheet's
  `workflow|prove` line.

**The never-do list**, with why each is tempting:
- **Do not read `agent_sessions` token columns.** They hold the last call only (F8); sum the
  phase's `usage` events.
- **Do not write a migration.** The directory is protected; migration 0007 is the owner's gate
  G18-M, and the projector alone fills its columns.
- **Do not write to SQLite outside `projector.ts`**, and never import `node:sqlite` in a new file.
- **Do not route on a metric.** Advice is printed; the owner types `--route` (D5).
- **Do not present a list-price equivalent as spend.** Always `≈ list $`, through
  `formatListEquivalent`; `cost-display.ts` keeps refusing subscription spend (D1).
- **Do not add a dashboard write or a dependency.** One POST route exists (archive); charts are
  hand-drawn SVG; icons come from `lucide-vue-next`.
- **Do not copy the owner's run data into a fixture.** Fixtures are synthetic (invariant 1).
- **Do not name a file with `manifest` or `receipt` in it** (invariant 10's fence reads tracked
  basenames).
- **Never** put an agent, model or AI tool in a commit identity, message or trailer.

# Section B — Task prompts (recommended)

### T01 — Per-phase facts: route, effort and its source, tokens by kind, and tool classes

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M1. Its builder route is
  claude/anthropic/claude:opus@xhigh and its review route claude/anthropic/claude:opus@high,
  both set by the owner's --route flags. The host owns routing. Do not change it.
  Manual: Opus 5.5 at xhigh, or the nearest route live quota allows.

TASK 1 of 17. Plan: specs/awsf-v2-w18-route-metrics.html, milestone M1, task 1.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**.
  The host commits this ticket and runs its gates before the next ticket starts. Never
  write specs/** (plan markers, ticket state, Handoff), docs/driving/**, AGENTS.md,
  awsf.config.yaml, core/src/state/**, core/src/observability/migrations/**, or a .claude/
  directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  None. This is the first ticket. Gate G18-M must be committed at your base:
  core/src/observability/migrations/0007-phase-route.sql exists and adds route_adapter,
  route_provider, route_model, route_effort and effort_source to phases. If it is absent, stop
  and report. Gate G18-A should also be committed; this ticket does not need it.

BASELINE
  Marimba's preflight ran npm run test:unit, typecheck and lint at this milestone's base.
  Inside a shift, the previous ticket's tests gate passed on the head you start from.
  A manual session runs npm run test:unit first and records the count.

READ FIRST
  AGENTS.md - the twelve invariants, in full
  specs/awsf-v2-w18-route-metrics.html - Problem (F2 and F8), Solution (DD1, DD2), the
    Identifier Spine, then task 1
  core/src/observability/projector.ts - the agent-start case (route_resolution events) and
    the agent case (it REPLACES agent_sessions token columns on every call: F8)
  core/src/observability/queries.ts - the read pattern: import type { DatabaseSync } from
    ./sqlite.ts, never node:sqlite. core/test/unit/meta/sqlite-write-fence.test.ts is why
  core/src/contracts/route-selection.ts - RouteSelectionProvenance
  core/src/contracts/normalized-events.ts - usage and tool.completed
  core/src/observability/migrations/0001-initial.sql - phases, events, agent_sessions
  core/src/observability/migrations/0007-phase-route.sql - the owner's columns this task fills

DO
  Create core/src/observability/phase-route.ts, beside the projector so the projector imports
    nothing from core/src/metrics/. Pure resolvePhaseRoute({ phase, routeEvent,
    configSnapshot }) returns adapterId, adapterKind, provider, model, effort, effortSource and,
    when the event exists, journalSource:
      journal            the phase's route_resolution event exists; its effective block wins and
                         requested.sources.effort is kept as journalSource
      config-phase-route the snapshot's routing.phase_routes names the phase key
      config-agent       the snapshot agent whose name equals the phase owner (a shift's
                         tNN-build phase has owner builder, so it resolves through builder)
      unknown            none of the above. Never guess
  In core/src/observability/projector.ts, fill route_adapter, route_provider, route_model,
    route_effort and effort_source on every agent phase: in the phase case, from the latest
    route_resolution event for that phase when one exists (effort_source journal), else from the
    session's config_snapshot_json through resolvePhaseRoute; in the agent-start case, when
    evidence.route is present, overwrite them with the event's effective values. A
    snapshot-derived value never replaces a journal-derived one. awsf db rebuild backfills
    legacy phases because it replays the same records.
  Carry model identity as two fields, never merged: the observed resolvedModel with its
    modelProvenance, and the requested selector.
  Create core/src/metrics/tool-class.ts: a frozen, case-insensitive table. read -> read;
    grep, glob, find, ls -> search; edit, write -> edit; bash -> exec; anything else -> other.
  Tokens by kind per phase: sum the phase's usage events. payload_json holds
    $.usage.inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens and
    reasoningRelation. Keep reasoningRelation per phase.
  Turns per phase = its run.started events. Minutes = ended_at - started_at, null while open.
    Tool errors = tool_call rows with status error. Tool time = sum of $.durationMs.
  Create core/src/metrics/phase-facts.ts: readPhaseFacts(db) runs read-only SQL over
    sessions, phases (including the five route columns), events and agent_sessions (call_count, model_provenance,
    cost_authority, context_tokens, context_window) and returns one PhaseFacts per agent phase.
  Write focused tests under core/test/unit/ (metrics-*.test.ts) on synthetic databases built
    through the projector's own functions, never on a copy of the owner's database.

DO NOT
  Read agent_sessions input, output, cache or reasoning token columns. For every role with more
    than one call they hold the last call only (F8, measured 17 of 17).
  Write or edit anything under core/src/observability/migrations/. Migration 0007 is the
    owner's (G18-M). Your only SQLite writes are in projector.ts (invariant 6).
  Let a snapshot-derived route replace a journal-derived one.
  Import node:sqlite in any new file.
  Invent an effort, a provider or a model when the sources are silent. unknown is an answer.

BUILDER READY
  A test resolves each effortSource value from its own fixture, including a shift's t01-build.
  A test covers every tool name in F6: read, bash, Read, grep, edit, Grep, Glob, find, write,
    Bash, ls, Edit, Write.
  A test builds a role with two calls, the second smaller than the first, and proves the phase
    tokens are the sum while agent_sessions holds only the second.
  A test rebuilds a synthetic journal from nothing: a legacy phase gets config-agent values, a
    new phase gets journal values, and a second rebuild is identical.
  git diff --stat shows nothing under core/src/observability/migrations/.
  npm run typecheck and npm run lint exit 0; npm run test:unit passes.

OWNER ACCEPTANCE
  None for this ticket alone. M1's journey is task 3's list.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(metrics): record each phase's route and effort and sum its tokens by kind
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after the milestone lands: task 1's rows in specs/awsf-v2-w18-route-metrics.html and
  this ticket's state move together in one commit (invariant 12).
  Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T02 and T03: contradictions with their
  prompts (which wins, and why), moved or renamed files, scope they can skip or must absorb.
  The owner copies them into those tickets' ## Handoff at landing. Edit no ticket file.
```

### T02 — Role-row outcomes and the block-attribution heuristic

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M1. Its builder route is
  claude/anthropic/claude:opus@xhigh and its review route claude/anthropic/claude:opus@high,
  both set by the owner's --route flags. The host owns routing. Do not change it.
  Manual: Opus 5.5 at xhigh, or the nearest route live quota allows.

TASK 2 of 17. Plan: specs/awsf-v2-w18-route-metrics.html, milestone M1, task 2.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**.
  The host commits this ticket and runs its gates before the next ticket starts. Never
  write specs/** (plan markers, ticket state, Handoff), docs/driving/**, AGENTS.md,
  awsf.config.yaml, core/src/state/**, core/src/observability/migrations/**, or a .claude/
  directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T01. Inside the shift its host commit is already on the head you build on. Read its
  phase-facts module before writing yours.

BASELINE
  Marimba's preflight ran npm run test:unit, typecheck and lint at this milestone's base.
  Inside a shift, the previous ticket's tests gate passed on the head you start from.
  A manual session runs npm run test:unit first and records the count.

READ FIRST
  specs/awsf-v2-w18-route-metrics.html - Problem (F5, F7), task 2 in full
  core/src/metrics/phase-facts.ts and route-resolution.ts - T01's output
  core/src/observability/migrations/0001-initial.sql - transitions, envelopes, gate_results
  core/src/observability/queries.ts - gatesForSession, envelopesForPhase, transitionsForSession
  The design's metric catalog, restated in task 2: first pass, clean completion, refuted
    claims, honest stops, guardrail hits, recovered by correction

DO
  Create core/src/metrics/role-rows.ts. A RoleRow is one role in one session: every agent phase
    whose owner is that role. Fields: route (adapter, provider, model, effort), effortSource,
    identity provenance, calls, phases, minutes, corrections, firstPass, settled, failedHere,
    tokens by kind, costAuthority, tools by class, toolErrors, gates { pass, total,
    firstRoundFail[] }, guardrailHits, refuted, honestStops, claims, recovered, corrected; and
    run fields: state group (LANDED, AWAITING_OWNER, OPEN, CANCELLED, BLOCKED), workflow, tier,
    project, plan ref, review verdict, owner re-entries, rework phases, started, ended.
  One named pure function and one test per definition:
    settled           every phase of the role is terminal and the run is not in flight
    firstPass         settled, every phase SUCCEEDED, each with correction_count 0
    guardrail hit     a failed writes_within_globs or no_protected_paths gate on the role's
                      phases, or a phase error_code PermissionBreach
    cleanCompletion   firstPass and zero guardrail hits
    claim             an envelope round with a producer_status
    refuted claim     producer_status success on a round where any claim gate failed. Claim
                      gates are every gate on that phase and round EXCEPT envelope_valid and
                      json_parses (contract adherence) and the two guardrail gates
    honest stop       producer_status failure
    recovered         round-0 gates failed and the final round passed within max_corrections
    corrected         correction_count > 0
    failedHere        the run is BLOCKED in one of this role's phases
  Create core/src/metrics/attribution.ts: pure heuristicAttribution(run) over the blocking
    phase's error_code and owner and the BLOCKED transition's reason_code, as one frozen table:
      CommandPhaseFailure after a build, PhaseGateFailure, EnvelopeValidationFailure,
      ReplacementReviewInconsistent, ReplacementReviewMalformed, PermissionBreach   -> model
      AdapterError, OwnerReworkCredentialRejected, a bare Error from a host phase   -> factory
      ExecutableNotFound                                                            -> environment
      phase-abort, or no code                                                       -> unknown
    blockedHere = failedHere and the effective attribution is model. T03 adds the owner's
    override; until then the effective attribution is the heuristic.

DO NOT
  Count a blocked run against a route unless its attribution is model.
  Treat a missing review or an empty findings list as evidence of quality. A clean review is
    also what a reviewer that misses defects produces.
  Mix roles: a planner's corrections never appear in a builder's row.
  Read the owner's database in a test.

BUILDER READY
  One test per definition above, each on its own synthetic fixture, including a refuted claim
    (success on a round whose diff_matches_claims failed) beside an honest stop.
  A test for every row of the attribution table, and one for an unknown code.
  npm run typecheck and npm run lint exit 0; npm run test:unit passes.

OWNER ACCEPTANCE
  None for this ticket alone. The heuristic's split on real data (14 model, 6 factory,
  2 environment, 1 unknown) is checked by the owner through T06's CLI, not here.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(metrics): derive role-row outcomes and a heuristic block attribution
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after the milestone lands: task 2's rows in specs/awsf-v2-w18-route-metrics.html and
  this ticket's state move together in one commit (invariant 12).
  Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T03 and T04: contradictions with their
  prompts (which wins, and why), moved or renamed files, scope they can skip or must absorb.
  The owner copies them into those tickets' ## Handoff at landing. Edit no ticket file.
```

### T03 — Testing Strategy for M1, and the owner's attribution override

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M1. Its builder route is
  claude/anthropic/claude:opus@xhigh and its review route claude/anthropic/claude:opus@high,
  both set by the owner's --route flags. The host owns routing. Do not change it.
  Manual: Opus 5.5 at xhigh, or the nearest route live quota allows.

TASK 3 of 17. Plan: specs/awsf-v2-w18-route-metrics.html, milestone M1, task 3.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**.
  The host commits this ticket and runs its gates before the next ticket starts. Never
  write specs/** (plan markers, ticket state, Handoff), docs/driving/**, AGENTS.md,
  awsf.config.yaml, core/src/state/**, core/src/observability/migrations/**, or a .claude/
  directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T01 and T02, both already on the shift's head.

BASELINE
  Marimba's preflight ran npm run test:unit, typecheck and lint at this milestone's base.
  Inside a shift, the previous ticket's tests gate passed on the head you start from.
  A manual session runs npm run test:unit first and records the count.

READ FIRST
  specs/awsf-v2-w18-route-metrics.html - Solution (DD5), Questionable Q6, task 3
  core/src/persistence/task-relations.ts and core/src/cli/commands/relate.ts - the task-scoped
    record this copies, and the comment explaining why a sealed attempt must not be reopened
  core/src/cli/commands/degrade-review.ts - the owner-act shape: interactive terminal, reason,
    credential scrub, named refusal classes
  core/src/cli/commands/dashboard-projection.ts - projectRelation; copy it for attributions
  core/src/observability/rebuild.ts and core/src/cli/commands/operator.ts - how awsf db rebuild
    walks task roots. Verify how relations survive a rebuild before writing the replay
  core/test/unit/meta/boundary-claims.test.ts - why this command stays unregistered: the guard's
    verbs must equal exactly the main.ts arms that construct processOwnerTerminal()

DO
  Add awsf attribute <task> --attempt <n> --cause <model|factory|environment|owner|unknown>
    --reason "<why>" in core/src/cli/commands/attribute.ts. It requires an interactive owner
    terminal and a non-empty, credential-free reason, as degrade-review does. It refuses an
    attempt that is not BLOCKED and an unknown cause, each with a named error class.
  Declare awsf.attribution/v1 in core/src/contracts/attribution-record.ts (TypeBox, registered
    like every contract): project, taskId, attempt, cause, reason, at.
  core/src/persistence/task-attributions.ts appends the record to attributions.jsonl beside the
    task's attempt directories through Journal, exactly as task-relations.ts does: append-only,
    a torn tail refuses. The latest record for an attempt wins; earlier records stay.
  Add projectAttribution to core/src/observability/projector.ts: one session-level events row,
    type attribution, id derived from the record, INSERT OR IGNORE. The command calls it through
    createDashboardProjection as relate calls projectRelation. awsf db rebuild replays every
    task's attributions file.
  Role-rows gain attribution, attributionSource (owner or heuristic) and heuristicAttribution.
  Do not register it. Export attributeCommand and test it with a fake owner terminal, as the
    degrade-review tests do. The owner wires its main.ts arm, CLI_COMMANDS, the cheatsheet and
    the guard verb together in gate G18-C after this milestone lands.
  Write core/test/journeys/metrics-facts.test.ts: four synthetic runs (a three-ticket shift with
    one correction, a build-review, a blocked run with PermissionBreach, a blocked run with
    ExecutableNotFound). Project them live, build rows, rebuild the database from nothing, build
    rows again: identical. Then record an override on the PermissionBreach run: blockedHere
    flips, and survives a second rebuild.

DO NOT
  Write into any attempt directory, or reopen a sealed attempt.
  Add a POST route or any dashboard write. The dashboard only composes this command (T09).
  Accept a reason from a piped stdin; the terminal check comes before anything is written.
  Add a main.ts arm, a CLI_COMMANDS entry or a cheatsheet line for attribute, or edit
    docs/driving/**. Any one of them without the others turns boundary-claims or
    cheatsheet-reconciliation red.

BUILDER READY
  The journey test above passes, and so do unit tests for every refusal of awsf attribute.
  boundary-claims and cheatsheet-reconciliation pass unchanged.
  npm run test:unit, npm run typecheck and npm run lint all pass.

OWNER ACCEPTANCE (journey w18-m1)
  Read the journey test's rebuild evidence in the returned notes: live rows equal rebuilt rows,
    and the override survives a second rebuild.
  After gate G18-C wires the command: on a scratch copy of the state root, run awsf attribute
    against one BLOCKED run at a real terminal, rebuild the copy, see the attribution survive,
    and see the same command refused from a pipe.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(metrics): add the owner's attribution override and prove projection parity
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after the milestone lands: task 3's rows in specs/awsf-v2-w18-route-metrics.html and
  this ticket's state move together in one commit (invariant 12).
  Milestone M1's header moves with it, because this task closes the milestone.
  Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T04, T06 and T09: contradictions with their
  prompts (which wins, and why), moved or renamed files, scope they can skip or must absorb.
  The owner copies them into those tickets' ## Handoff at landing. Edit no ticket file.
```

### T04 — The pure metrics module: intervals, depth, frontier, verdicts and the recommendation rule

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M2. Its builder route is
  claude/anthropic/claude:opus@high and its review route claude/anthropic/claude:opus@high,
  both set by the owner's --route flags. The host owns routing. Do not change it.
  Manual: Opus 5.5 at high, or the nearest route live quota allows.

TASK 4 of 17. Plan: specs/awsf-v2-w18-route-metrics.html, milestone M2, task 4.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**.
  The host commits this ticket and runs its gates before the next ticket starts. Never
  write specs/** (plan markers, ticket state, Handoff), docs/driving/**, AGENTS.md,
  awsf.config.yaml, core/src/state/**, core/src/observability/migrations/**, or a .claude/
  directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T02 (landed with M1). Its RoleRow type is this module's input.

BASELINE
  Marimba's preflight ran npm run test:unit, typecheck and lint at this milestone's base.
  Inside a shift, the previous ticket's tests gate passed on the head you start from.
  A manual session runs npm run test:unit first and records the count.

READ FIRST
  specs/awsf-v2-w18-route-metrics.html - Solution (DD3), Identifier Spine (INV-4), task 4
  The design's method, restated in task 4: Beta prior of strength 4, the recommendation rule,
    overkill at 1.5x, underpowered when an upper bound sits below the best lower bound
  core/src/metrics/role-rows.ts - RoleRow
  dashboard/shared/credential-patterns.ts and core/src/policy/redaction.ts - the precedent for
    runtime code in dashboard/shared imported by core
  dashboard/tsconfig.json and tsconfig.json - both projects must type-check the module

DO
  Create dashboard/shared/route-metrics.ts with:
    wilson(k, n, z = 1.96) -> { p, lo, hi }; p is null when n is 0
    depth(interval, n): raised when the half-width is at most 0.15, flat when rows exist but the
      interval is wider, sunk with no rows
    stats(rows): every aggregate the prototype's stats() computes: settled, runs, landed, first
      pass and clean completion with intervals, counts per state group, blocked here,
      corrections per row, rework runs, gate checks and pass rate, the top first-round failure,
      median minutes, turns and tool calls per row, tool mix and tool error rate, tokens by
      kind, list-equivalent total, per row and per landed run (a function argument supplies the
      per-row price, so this module holds no prices), cost authority, identity and effort-source
      tallies, recovered and corrected, landed per agent-hour
    lens: facets role, model, effort, terminal state, workflow, project, evidence source, plus a
      route focus. The facet list is data, so T15 adds task class without editing the filter
    frontier(rows, role, y, x): y in first pass, clean completion, not blocked here, run landed;
      x in list-equivalent per row, median minutes. Only routes with 5 or more settled rows
      shape the Pareto line; the rest are returned as hollow points
    verdicts: insufficient (n < 5), underpowered (upper bound below the best route's lower
      bound), overkill candidate (at least 1.5x the cost of an eligible route whose interval
      overlaps; its text says to confirm on paired replays), frontier otherwise
    recommend(rows, role, taskClass, source): the cheapest route whose first-pass interval
      overlaps the best route's; when no route has 5 settled rows, rank by a Beta prior (mean
      from a supplied prior table, strength 4) and label the result prior only
    flatColumns(groups, columns): a column identical across two or more groups is flat
  Write core/test/unit/metrics-module.test.ts: Wilson on textbook values; depth at n 0 and at a
    half-width of exactly 0.15; frontier ties; each verdict; the prior branch; flat columns.

DO NOT
  Put a price, a benchmark score or any I/O in this module; T05 supplies data.
  Return any score for a model outside one role and one route (INV-4).
  Add public numbers into a local statistic. A prior is shown beside local numbers only.
  Add a dependency. The dependency-allowlist fence refuses it.

BUILDER READY
  metrics-module.test.ts passes; both typecheck:core and typecheck:dashboard compile the module.
  npm run test:unit, npm run typecheck and npm run lint all pass.

OWNER ACCEPTANCE
  None for this ticket alone. M2's journey is task 6's list.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(metrics): add one pure module for intervals, frontier, verdicts and advice
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after the milestone lands: task 4's rows in specs/awsf-v2-w18-route-metrics.html and
  this ticket's state move together in one commit (invariant 12).
  Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T05, T06, T08 and T11: contradictions with their
  prompts (which wins, and why), moved or renamed files, scope they can skip or must absorb.
  The owner copies them into those tickets' ## Handoff at landing. Edit no ticket file.
```

### T05 — The dated rate card, the list-price equivalent, and the metrics API

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M2. Its builder route is
  claude/anthropic/claude:opus@high and its review route claude/anthropic/claude:opus@high,
  both set by the owner's --route flags. The host owns routing. Do not change it.
  Manual: Opus 5.5 at high, or the nearest route live quota allows.

TASK 5 of 17. Plan: specs/awsf-v2-w18-route-metrics.html, milestone M2, task 5.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**.
  The host commits this ticket and runs its gates before the next ticket starts. Never
  write specs/** (plan markers, ticket state, Handoff), docs/driving/**, AGENTS.md,
  awsf.config.yaml, core/src/state/**, core/src/observability/migrations/**, or a .claude/
  directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T01 (landed with M1) and T04, already on the shift's head.

BASELINE
  Marimba's preflight ran npm run test:unit, typecheck and lint at this milestone's base.
  Inside a shift, the previous ticket's tests gate passed on the head you start from.
  A manual session runs npm run test:unit first and records the count.

READ FIRST
  specs/awsf-v2-w18-route-metrics.html - Decisions already taken (D1, D2), Solution (DD4),
    Risks R6 and R7, task 5
  core/src/adapters/cost-display.ts - the refusal D1 keeps, and why
  core/src/api/routes.ts - API_ROUTE_TABLE and the handler map
  core/test/unit/meta/no-write-route.test.ts - the exact route list and the forbidden substrings
  dashboard/shared/types.ts - response types
  The design's rate card, benchmark table and untested routes, restated below

DO
  Create dashboard/shared/rate-card.ts: one frozen row per model id, per 1M tokens, with tier,
    note, checkedAt "2026-09-26" and an https source per row:
      claude-fable-5-1   in 10    cache write 12.5  cache read 0.25  out 50
      claude-opus-5-5    in 4     cache write 5     cache read 0.2   out 20
      claude-opus-5      in 5     cache write 6.25  cache read 0.5   out 25
      claude-sonnet-5    in 2     cache write 2.5   cache read 0.2   out 10
      claude-haiku-4-5   in 1     cache write 1.25  cache read 0.1   out 5
      gpt-6-astra        in 10    cache write 0     cache read 1     out 50
      gpt-6-sol          in 2     cache write 0     cache read 0.2   out 10
      gpt-6-luna         in 0.1   cache write 0     cache read 0.01  out 0.5
      gpt-5.6-sol        in 4     cache write 0     cache read 0.4   out 20
      gpt-5.6-terra      in 2     cache write 0     cache read 0.2   out 12
    Anthropic rows cite https://platform.claude.com/docs/en/about-claude/pricing and OpenAI rows
    https://developers.openai.com/api/docs/pricing. A TypeBox schema validates the card in a test.
    The card lists its limitations: cache writes at the 5-minute rate (a 1-hour write bills 2x
    input); OpenAI short-context rates; OpenAI charges no cache write.
  Price a row by its observed resolvedModel. A selector prices only when it is itself a rate-card
    id. Anything else is unpriced, with the reason. Never map an alias by guesswork.
  listEquivalentUsd(tokens, rate): input, cache read, cache write and output at their rates;
    add reasoning as output only when reasoningRelation is additive.
  Create dashboard/shared/benchmark-priors.ts: the design's benchmark rows with sources and
    checkedAt, the role each informs, and the untested routes to show (Opus 5.5 medium, Sonnet 5
    medium, GPT-6 Sol high, GPT-5.6 Terra medium).
  formatListEquivalent(usd) renders "≈ list $x.xx" and nothing shorter.
  Create core/src/metrics/payload.ts and add GET /api/v1/metrics (route name metrics) returning
    MetricsResponse: schema "awsf.route-metrics/v1", extractedAt, runs with their phases,
    role-rows, the rate card, the priors, the untested routes. Types in dashboard/shared/types.ts.
  Add "GET /api/v1/metrics" to EXPECTED in no-write-route.test.ts.

DO NOT
  Touch formatCost or anything else in cost-display.ts. Add a test instead that
    formatCost("unavailable", 12.3) still returns "— subscription".
  Put prices in awsf.config.yaml pricing. It is protected and has no reader.
  Add any non-GET route, or a route name containing land, approv, retry or cancel.
  Present a list-equivalent anywhere without its "≈ list" label.

BUILDER READY
  Tests: the card validates; listEquivalentUsd on a fixture of each reasoning relation; an
    unresolved selector is unpriced; formatCost's refusal is unchanged; the API route returns a
    schema-valid payload from a synthetic database.
  no-write-route.test.ts passes with the new entry.
  npm run test:unit, npm run typecheck and npm run lint all pass.

OWNER ACCEPTANCE
  Confirm the OpenAI rows against the cited page; the Claude rows were cross-checked against
  the Claude API reference while this plan was authored.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(metrics): add a dated rate card, the list-price equivalent and GET /api/v1/metrics
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after the milestone lands: task 5's rows in specs/awsf-v2-w18-route-metrics.html and
  this ticket's state move together in one commit (invariant 12).
  Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T06, T07 and T13: contradictions with their
  prompts (which wins, and why), moved or renamed files, scope they can skip or must absorb.
  The owner copies them into those tickets' ## Handoff at landing. Edit no ticket file.
```

### T06 — Testing Strategy for M2, and the awsf metrics readout

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M2. Its builder route is
  claude/anthropic/claude:opus@high and its review route claude/anthropic/claude:opus@high,
  both set by the owner's --route flags. The host owns routing. Do not change it.
  Manual: Opus 5.5 at high, or the nearest route live quota allows.

TASK 6 of 17. Plan: specs/awsf-v2-w18-route-metrics.html, milestone M2, task 6.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**.
  The host commits this ticket and runs its gates before the next ticket starts. Never
  write specs/** (plan markers, ticket state, Handoff), docs/driving/**, AGENTS.md,
  awsf.config.yaml, core/src/state/**, core/src/observability/migrations/**, or a .claude/
  directory at the repository root.
  This ticket also edits docs/cheatsheet.html, which the builder may write only after the
  owner's gate G18-A. Check agents[builder].writes in awsf.config.yaml first. If
  docs/cheatsheet.html is not there, stop and report: the cheatsheet-reconciliation fence
  will be red at this ticket's own tests gate.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T03 (landed with M1), T04 and T05, already on the shift's head.

BASELINE
  Marimba's preflight ran npm run test:unit, typecheck and lint at this milestone's base.
  Inside a shift, the previous ticket's tests gate passed on the head you start from.
  A manual session runs npm run test:unit first and records the count.

READ FIRST
  specs/awsf-v2-w18-route-metrics.html - task 6 and Validation's last row
  core/src/cli/main.ts - CLI_COMMANDS, parseArgs, the multi-word command precedent (shift plan)
  core/src/cli/commands/routes.ts - a read-only command that spends nothing
  core/src/metrics/payload.ts and dashboard/shared/route-metrics.ts - T05 and T04

DO
  Add awsf metrics [--role R] [--source production|proving-ground] [--started-before ISO]
    [--json] in core/src/cli/commands/metrics.ts. It opens the database read-only, builds the
    payload through core/src/metrics/payload.ts, and prints a role x route table: n, settled,
    first pass with its interval, depth, list-equivalent per row with its label, verdict.
    --json prints exactly the API payload. It spawns nothing and writes nothing.
  Add "metrics" to CLI_COMMANDS and <li><code>metrics</code></li> to the commands list in
    docs/cheatsheet.html, in this same change.
  Write core/test/unit/metrics-parity.test.ts: one synthetic database; the module's stats, the
    API payload's stats and awsf metrics --json agree to the digit.

DO NOT
  Compute a statistic in the CLI. Every number comes from dashboard/shared/route-metrics.ts.
  Print a bare "$". Use formatListEquivalent.

BUILDER READY
  metrics-parity.test.ts and metrics-module.test.ts pass; cheatsheet-reconciliation passes.
  npm run test:unit, npm run typecheck and npm run lint all pass.

OWNER ACCEPTANCE (journey w18-m2)
  Run awsf metrics --started-before 2026-09-26T23:16:19Z against the real database. It should
    show 46 runs, 62 role-rows, 8 routes, 10 cells and 6 refuted claims, and the heuristic split
    14 model, 6 factory, 2 environment, 1 unknown. Each difference needs a definition-level
    explanation in the returned notes.
  Run awsf metrics --json and open GET /api/v1/metrics from awsf dash: the same numbers.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(metrics): add awsf metrics and prove API and CLI parity
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after the milestone lands: task 6's rows in specs/awsf-v2-w18-route-metrics.html and
  this ticket's state move together in one commit (invariant 12).
  Milestone M2's header moves with it, because this task closes the milestone.
  Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T07, T13, T15 and T16: contradictions with their
  prompts (which wins, and why), moved or renamed files, scope they can skip or must absorb.
  The owner copies them into those tickets' ## Handoff at landing. Edit no ticket file.
```

### T07 — The metrics tab shell: routes, lens rail, summary and the run-card button

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M3. Its builder route is
  claude/anthropic/claude:opus@high and its review route claude/anthropic/claude:opus@high,
  both set by the owner's --route flags. The host owns routing. Do not change it.
  Manual: Opus 5.5 at high, or the nearest route live quota allows.

TASK 7 of 17. Plan: specs/awsf-v2-w18-route-metrics.html, milestone M3, task 7.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**.
  The host commits this ticket and runs its gates before the next ticket starts. Never
  write specs/** (plan markers, ticket state, Handoff), docs/driving/**, AGENTS.md,
  awsf.config.yaml, core/src/state/**, core/src/observability/migrations/**, or a .claude/
  directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T04 and T05 (landed with M2): the module and GET /api/v1/metrics.

BASELINE
  Marimba's preflight ran npm run test:unit, typecheck and lint at this milestone's base.
  Inside a shift, the previous ticket's tests gate passed on the head you start from.
  A manual session runs npm run test:unit first and records the count.

READ FIRST
  specs/awsf-v2-w18-route-metrics.html - milestone M3's intro and mockup, task 7
  dashboard/src/App.vue - readRoute and the canvas route's hash-query state
  dashboard/src/components/TopNav.vue, SessionCard.vue, SessionFilterRow.vue
  dashboard/src/session-filters.ts - the filter-ladder grammar the rail must reuse
  dashboard/src/theme.ts - seven palettes; AWSF Classic is dark only
  dashboard/src/styles/morphism.css and dashboard.css - neumorphic wells, pills and tokens
  core/test/unit/dashboard-*.test.ts - how dashboard modules are tested (pure .ts modules)

DESIGN INPUTS
  Frames for this ticket: rm-matrix-forest-dark, rm-matrix-forest-light, rm-run-forest-dark,
  rm-run-forest-light (the rail, summary and view bar appear on every frame; the run frames
  show the run card and its controls).
  Index: specs/design/awsf-v2-w18-route-metrics/frame-index.json (tracked). Images:
    docs/design/route-metrics/frames/<id>.png (ignored; delivered by the owner's binding).
  Viewport: 1500 px wide. Palettes in the frames: forest, navy (navy-sky), rust (warm-rust).
  Open every frame named above with your image tool BEFORE any visual decision. The
  visual-inspection gate checks that you did. If a frame will not open, stop and report.
  Compare: geometry, type, colour, hierarchy and depth, interaction states (the index's
  comparison list). Do not compare numbers: the frames hold the owner's data as of
  2026-09-26 and the tab renders whatever the projection holds.
  Overrides that win over the pixels: O1 no palette picker in the nav; O2 the archive control
  keeps its current form; O3 the attribution override is a composed command, not a click;
  O4 the frames' numbers are not targets; O5 all seven palettes, both modes.

DO
  Hash routes #/metrics and #/metrics/run/<sessionId> in App.vue's readRoute. Keep the view and
    the lens in the hash query, as the canvas route does, so Back restores them. TopNav lists
    metrics between canvas and settings.
  dashboard/src/routes/metrics.vue loads GET /api/v1/metrics through the existing usePolling.
  Lens rail: the count tile (runs in lens, recorded, never reached an agent, "option counts are
    role-rows"); Evidence source (production live; proving ground disabled, titled "M4 adds
    controlled replays"); Role (role dots); Model (circle Anthropic, diamond OpenAI); Effort;
    Terminal state (state dots); Workflow; Project. Each is a well with its select-all / only...
    control, built from session-filters.ts (toggleFilterValue, selectAllState,
    toggleAllFilterValues). Reuse them; do not fork them.
  Summary row: role-rows in lens (runs, settled); first-pass yield with its interval; runs
    landed with blocked-here model-attributed rows; list-equivalent per landed run captioned
    "list-price equivalent, not spend".
  View bar: Matrix, Frontier, Ledger, Run pills, the route-focus note, Reset lens. The views
    themselves are placeholders filled by T08 and T09.
  SessionCard.vue: add a metrics control (lucide ChartColumn; accessible name "Open run <id> in
    metrics"; href #/metrics/run/<sessionId>) as a sibling of the archive button, after the
    card's closing </a>. The archive control is unchanged (O2).
  Put lens state and its URL encoding in the pure dashboard/src/metrics-lens.ts and test it
    from core/test/unit/dashboard-metrics-lens.test.ts over a synthetic payload in
    core/test/fixtures/metrics/payload.json.

DO NOT
  Nest the metrics control inside the card's <a> element.
  Add a palette picker to the nav (O1).
  Add a chart library or any dependency. Charts are hand-drawn SVG (invariant 7). Icons come
    only from lucide-vue-next.
  Hard-code a palette colour. Use the dashboard's tokens.
  Write anything from the tab: no fetch other than GET, no POST, no localStorage state the
    owner depends on.

BUILDER READY
  Frames opened (the visual-inspection gate). dashboard-metrics-lens.test.ts passes.
  npm run test:unit, npm run typecheck, npm run lint and npm run dash:build all pass.
  Your envelope lists each frame id you compared and each deviation you chose, with its reason.

OWNER ACCEPTANCE
  None for this ticket alone. M3's journey is task 10's list.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(dashboard): add the metrics tab shell, its lens rail and the run-card control
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after the milestone lands: task 7's rows in specs/awsf-v2-w18-route-metrics.html and
  this ticket's state move together in one commit (invariant 12).
  Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T08, T09 and T10: contradictions with their
  prompts (which wins, and why), moved or renamed files, scope they can skip or must absorb.
  The owner copies them into those tickets' ## Handoff at landing. Edit no ticket file.
```

### T08 — The Matrix and Frontier views

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M3. Its builder route is
  claude/anthropic/claude:opus@high and its review route claude/anthropic/claude:opus@high,
  both set by the owner's --route flags. The host owns routing. Do not change it.
  Manual: Opus 5.5 at high, or the nearest route live quota allows.

TASK 8 of 17. Plan: specs/awsf-v2-w18-route-metrics.html, milestone M3, task 8.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**.
  The host commits this ticket and runs its gates before the next ticket starts. Never
  write specs/** (plan markers, ticket state, Handoff), docs/driving/**, AGENTS.md,
  awsf.config.yaml, core/src/state/**, core/src/observability/migrations/**, or a .claude/
  directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T04 (landed with M2) and T07, already on the shift's head.

BASELINE
  Marimba's preflight ran npm run test:unit, typecheck and lint at this milestone's base.
  Inside a shift, the previous ticket's tests gate passed on the head you start from.
  A manual session runs npm run test:unit first and records the count.

READ FIRST
  specs/awsf-v2-w18-route-metrics.html - task 8
  dashboard/shared/route-metrics.ts - depth, frontier, verdicts
  dashboard/src/metrics-lens.ts and routes/metrics.vue - T07's shell
  dashboard/src/App.vue - readRoute and the canvas route's hash-query state
  dashboard/src/components/TopNav.vue, SessionCard.vue, SessionFilterRow.vue
  dashboard/src/session-filters.ts - the filter-ladder grammar the rail must reuse
  dashboard/src/theme.ts - seven palettes; AWSF Classic is dark only
  dashboard/src/styles/morphism.css and dashboard.css - neumorphic wells, pills and tokens
  core/test/unit/dashboard-*.test.ts - how dashboard modules are tested (pure .ts modules)

DESIGN INPUTS
  Frames for this ticket: rm-matrix-forest-dark, rm-matrix-forest-light, rm-matrix-navy-dark,
  rm-matrix-navy-light, rm-matrix-rust-dark, rm-frontier-forest-dark, rm-frontier-forest-light.
  Index: specs/design/awsf-v2-w18-route-metrics/frame-index.json (tracked). Images:
    docs/design/route-metrics/frames/<id>.png (ignored; delivered by the owner's binding).
  Viewport: 1500 px wide. Palettes in the frames: forest, navy (navy-sky), rust (warm-rust).
  Open every frame named above with your image tool BEFORE any visual decision. The
  visual-inspection gate checks that you did. If a frame will not open, stop and report.
  Compare: geometry, type, colour, hierarchy and depth, interaction states (the index's
  comparison list). Do not compare numbers: the frames hold the owner's data as of
  2026-09-26 and the tab renders whatever the projection holds.
  Overrides that win over the pixels: O1 no palette picker in the nav; O2 the archive control
  keeps its current form; O3 the attribution override is a composed command, not a click;
  O4 the frames' numbers are not targets; O5 all seven palettes, both modes.

DO
  Matrix: role columns in the order intake, scout, planner, designer, architecture-reviewer,
    builder, reviewer, documenter (observed roles only); route rows tested first, then by
    provider, price and effort; each row labeled "Model · effort" over "$in / $out · prior".
  Tiles: an SVG ring of first-pass yield ("–" when nothing settled), "n X · Y landed", the
    list-equivalent per row, a red badge counting blocked-here model-attributed rows, and the
    depth class raised / flat / sunk from the module. An empty cell reads "no runs". "Show
    untested routes" adds the untested rows with their priors. The depth legend matches the
    frames.
  A tile click focuses its route, narrows the role lens and opens the Ledger grouped by run.
  Frontier: role pills; y pills First-pass yield, Clean completion, Not blocked here, Run landed;
    x pills "≈ list $ per role-row" and "Median minutes per role-row", one axis at a time;
    log-scale x with ticks; 95% Wilson whiskers; circle Anthropic, diamond OpenAI; hollow marks
    under 5 settled rows; the Pareto line in the accent colour; the two zone labels ("cheap and
    strong", "costly and weak", or fast and slow for minutes); a tooltip on hover and on focus;
    verdict cards beneath, tagged frontier, overkill? or underpowered.
  Put scale, tick and label-collision helpers in the pure dashboard/src/metrics-chart.ts and
    test them in core/test/unit/dashboard-metrics-chart.test.ts.

DO NOT
  Compare routes across roles in one chart. The Frontier shows one role at a time.
  Compute a statistic in a component. Every number comes from the module.
  Add a chart library or any dependency. Charts are hand-drawn SVG (invariant 7). Icons come
    only from lucide-vue-next.
  Hard-code a palette colour. Use the dashboard's tokens.
  Write anything from the tab: no fetch other than GET, no POST, no localStorage state the
    owner depends on.

BUILDER READY
  Frames opened (the visual-inspection gate). dashboard-metrics-chart.test.ts passes.
  npm run test:unit, npm run typecheck, npm run lint and npm run dash:build all pass.
  Your envelope lists each frame id you compared and each deviation, with its reason.

OWNER ACCEPTANCE
  None for this ticket alone. M3's journey is task 10's list.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(dashboard): add the Matrix and Frontier views
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after the milestone lands: task 8's rows in specs/awsf-v2-w18-route-metrics.html and
  this ticket's state move together in one commit (invariant 12).
  Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T09 and T10: contradictions with their
  prompts (which wins, and why), moved or renamed files, scope they can skip or must absorb.
  The owner copies them into those tickets' ## Handoff at landing. Edit no ticket file.
```

### T09 — The Ledger and Run views

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M3. Its builder route is
  claude/anthropic/claude:opus@high and its review route claude/anthropic/claude:opus@high,
  both set by the owner's --route flags. The host owns routing. Do not change it.
  Manual: Opus 5.5 at high, or the nearest route live quota allows.

TASK 9 of 17. Plan: specs/awsf-v2-w18-route-metrics.html, milestone M3, task 9.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**.
  The host commits this ticket and runs its gates before the next ticket starts. Never
  write specs/** (plan markers, ticket state, Handoff), docs/driving/**, AGENTS.md,
  awsf.config.yaml, core/src/state/**, core/src/observability/migrations/**, or a .claude/
  directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T03 (landed with M1: the awsf attribute spelling), T04 (landed with M2) and T07.

BASELINE
  Marimba's preflight ran npm run test:unit, typecheck and lint at this milestone's base.
  Inside a shift, the previous ticket's tests gate passed on the head you start from.
  A manual session runs npm run test:unit first and records the count.

READ FIRST
  specs/awsf-v2-w18-route-metrics.html - Questionable Q6 and task 9
  core/src/cli/commands/attribute.ts - the exact command and flags to compose
  core/test/unit/meta/no-write-route.test.ts - why the tab composes instead of writing
  dashboard/src/App.vue - readRoute and the canvas route's hash-query state
  dashboard/src/components/TopNav.vue, SessionCard.vue, SessionFilterRow.vue
  dashboard/src/session-filters.ts - the filter-ladder grammar the rail must reuse
  dashboard/src/theme.ts - seven palettes; AWSF Classic is dark only
  dashboard/src/styles/morphism.css and dashboard.css - neumorphic wells, pills and tokens
  core/test/unit/dashboard-*.test.ts - how dashboard modules are tested (pure .ts modules)

DESIGN INPUTS
  Frames for this ticket: rm-ledger-forest-dark, rm-ledger-forest-light, rm-run-forest-dark,
  rm-run-forest-light. The run frames show a LANDED run; the attribution panel is specified
  below and in the plan's M3 mockup, not in a frame.
  Index: specs/design/awsf-v2-w18-route-metrics/frame-index.json (tracked). Images:
    docs/design/route-metrics/frames/<id>.png (ignored; delivered by the owner's binding).
  Viewport: 1500 px wide. Palettes in the frames: forest, navy (navy-sky), rust (warm-rust).
  Open every frame named above with your image tool BEFORE any visual decision. The
  visual-inspection gate checks that you did. If a frame will not open, stop and report.
  Compare: geometry, type, colour, hierarchy and depth, interaction states (the index's
  comparison list). Do not compare numbers: the frames hold the owner's data as of
  2026-09-26 and the tab renders whatever the projection holds.
  Overrides that win over the pixels: O1 no palette picker in the nav; O2 the archive control
  keeps its current form; O3 the attribution override is a composed command, not a click;
  O4 the frames' numbers are not targets; O5 all seven palettes, both modes.

DO
  Ledger: group by Route, Role, Model, Effort, Workflow, Project or Run; column families Outcome,
    Verification, Work, Tokens, Cost, Provenance, with Outcome, Verification, Work and Cost on by
    default; the terminal-state strip and one column per state; sortable headers carrying
    aria-sort; a flat column dimmed, marked "· flat" and titled "flat across every group: no
    signal in this lens"; a sticky first column. Grouped by run, a row opens the Run view.
  Run: the picker (the lens applies to it); the mini card with its two controls; the fact grid
    (task and attempt, project, workflow and tier, terminal state, review verdict, wall time,
    owner rework, list-equivalent); the phase strip (width by minutes, at least 0.3, colour by
    status) and its legend; the per-role table (role and identity provenance, route, turns,
    minutes, tool mix R S E X O, gates, first pass, cache read and output, list-equivalent,
    list-equivalent by token kind as bars).
  For a BLOCKED run: the heuristic cause, the owner's recorded override with its reason and date,
    and five cause pills that compose awsf attribute <task> --attempt <n> --cause <c> --reason
    "<why>" in a read-only field with a copy button (navigator.clipboard, with a select-all
    fallback). The panel says "Run this in a terminal. The dashboard records nothing itself."
  Put grouping, sorting, flat detection and the phase-strip layout in the pure
    dashboard/src/metrics-ledger.ts and metrics-run.ts, tested in core/test/unit/.

DO NOT
  Send the composed command anywhere, or add a route that could (O3, Q6).
  Add a chart library or any dependency. Charts are hand-drawn SVG (invariant 7). Icons come
    only from lucide-vue-next.
  Hard-code a palette colour. Use the dashboard's tokens.
  Write anything from the tab: no fetch other than GET, no POST, no localStorage state the
    owner depends on.

BUILDER READY
  Frames opened (the visual-inspection gate). The ledger and run helper tests pass.
  npm run test:unit, npm run typecheck, npm run lint and npm run dash:build all pass.
  Your envelope lists each frame id you compared and each deviation, with its reason.

OWNER ACCEPTANCE
  None for this ticket alone. M3's journey is task 10's list.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(dashboard): add the Ledger and Run views and the attribution command composer
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after the milestone lands: task 9's rows in specs/awsf-v2-w18-route-metrics.html and
  this ticket's state move together in one commit (invariant 12).
  Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T10: contradictions with their
  prompts (which wins, and why), moved or renamed files, scope they can skip or must absorb.
  The owner copies them into those tickets' ## Handoff at landing. Edit no ticket file.
```

### T10 — Testing Strategy for M3: palettes, modes, accessibility and the visual record

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M3. Its builder route is
  claude/anthropic/claude:opus@high and its review route claude/anthropic/claude:opus@high,
  both set by the owner's --route flags. The host owns routing. Do not change it.
  Manual: Opus 5.5 at high, or the nearest route live quota allows.

TASK 10 of 17. Plan: specs/awsf-v2-w18-route-metrics.html, milestone M3, task 10.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**.
  The host commits this ticket and runs its gates before the next ticket starts. Never
  write specs/** (plan markers, ticket state, Handoff), docs/driving/**, AGENTS.md,
  awsf.config.yaml, core/src/state/**, core/src/observability/migrations/**, or a .claude/
  directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T07, T08 and T09, all on the shift's head.

BASELINE
  Marimba's preflight ran npm run test:unit, typecheck and lint at this milestone's base.
  Inside a shift, the previous ticket's tests gate passed on the head you start from.
  A manual session runs npm run test:unit first and records the count.

READ FIRST
  specs/awsf-v2-w18-route-metrics.html - task 10, Risks R8
  specs/design/awsf-v2-w18-route-metrics/frame-index.json - comparison list and overrides
  dashboard/src/App.vue - readRoute and the canvas route's hash-query state
  dashboard/src/components/TopNav.vue, SessionCard.vue, SessionFilterRow.vue
  dashboard/src/session-filters.ts - the filter-ladder grammar the rail must reuse
  dashboard/src/theme.ts - seven palettes; AWSF Classic is dark only
  dashboard/src/styles/morphism.css and dashboard.css - neumorphic wells, pills and tokens
  core/test/unit/dashboard-*.test.ts - how dashboard modules are tested (pure .ts modules)

DESIGN INPUTS
  Frames for this ticket: all eleven ids in the index.
  Index: specs/design/awsf-v2-w18-route-metrics/frame-index.json (tracked). Images:
    docs/design/route-metrics/frames/<id>.png (ignored; delivered by the owner's binding).
  Viewport: 1500 px wide. Palettes in the frames: forest, navy (navy-sky), rust (warm-rust).
  Open every frame named above with your image tool BEFORE any visual decision. The
  visual-inspection gate checks that you did. If a frame will not open, stop and report.
  Compare: geometry, type, colour, hierarchy and depth, interaction states (the index's
  comparison list). Do not compare numbers: the frames hold the owner's data as of
  2026-09-26 and the tab renders whatever the projection holds.
  Overrides that win over the pixels: O1 no palette picker in the nav; O2 the archive control
  keeps its current form; O3 the attribution override is a composed command, not a click;
  O4 the frames' numbers are not targets; O5 all seven palettes, both modes.

DO
  core/test/unit/dashboard-metrics-tokens.test.ts: every CSS custom property the metrics files
    use is defined for all seven palettes in both modes (AWSF Classic dark only), and no metrics
    file carries a literal hex colour outside the existing role-colour table.
  core/test/unit/dashboard-metrics-labels.test.ts: every dollar amount the metrics files render
    goes through formatListEquivalent; the run card's metrics control sits outside the
    <a class="session-card"> element.
  Accessibility: every control is a button or a link with an accessible name; pills carry
    aria-pressed; focus is visible; prefers-reduced-motion is honoured. Add a static test for
    the names and the aria attributes.
  Fix whatever these tests find in T07-T09's files.
  Return the visual record in your envelope: for each of the eleven frame ids, what matches and
    each deviation (O1-O5 and anything else), with its reason.

DO NOT
  Claim visual fidelity from a passing test. The owner's comparison decides it.
  Add a chart library or any dependency. Charts are hand-drawn SVG (invariant 7). Icons come
    only from lucide-vue-next.
  Hard-code a palette colour. Use the dashboard's tokens.
  Write anything from the tab: no fetch other than GET, no POST, no localStorage state the
    owner depends on.

BUILDER READY
  Every frame opened (the visual-inspection gate). The token, label and accessibility tests pass.
  npm run test:unit, npm run typecheck, npm run lint and npm run dash:build all pass.

OWNER ACCEPTANCE (journey w18-m3)
  Marimba builds the candidate fresh and serves it. In Chrome at 1500 px, beside each frame:
    Matrix, Frontier, Ledger and Run in Forest dark and light; Matrix in Navy / sky dark and
    light and Warm rust dark. Then spot-check the other four palettes.
  Open a run card's metrics control; open a BLOCKED run and copy its composed command.
  Record each accepted deviation.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: test(dashboard): prove the metrics tab's tokens, labels and accessibility
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after the milestone lands: task 10's rows in specs/awsf-v2-w18-route-metrics.html and
  this ticket's state move together in one commit (invariant 12).
  Milestone M3's header moves with it, because this task closes the milestone.
  Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T13, T15 and T17: contradictions with their
  prompts (which wins, and why), moved or renamed files, scope they can skip or must absorb.
  The owner copies them into those tickets' ## Handoff at landing. Edit no ticket file.
```

### T11 — The frozen corpus, the seeded-defect reviewer suite and the route-arm scorer

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M4. Its builder route is
  claude/anthropic/claude:opus@xhigh and its review route claude/anthropic/claude:opus@high,
  both set by the owner's --route flags. The host owns routing. Do not change it.
  Manual: Opus 5.5 at xhigh, or the nearest route live quota allows.

TASK 11 of 17. Plan: specs/awsf-v2-w18-route-metrics.html, milestone M4, task 11.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**.
  The host commits this ticket and runs its gates before the next ticket starts. Never
  write specs/** (plan markers, ticket state, Handoff), docs/driving/**, AGENTS.md,
  awsf.config.yaml, core/src/state/**, core/src/observability/migrations/**, or a .claude/
  directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T04 (landed with M2): wilson and the interval helpers.

BASELINE
  Marimba's preflight ran npm run test:unit, typecheck and lint at this milestone's base.
  Inside a shift, the previous ticket's tests gate passed on the head you start from.
  A manual session runs npm run test:unit first and records the count.

READ FIRST
  specs/awsf-v2-w18-route-metrics.html - Decisions (D3), Solution (DD7), Questionable Q8, task 11
  core/src/workflow/prompt-benchmark.ts - arms, repetitions, order in pair, invalidation
  core/src/contracts/review-output.ts - ReviewFindingSchema: file and a nullable line
  core/src/contracts/registry.ts - how a TypeBox contract is declared and registered

DO
  Create core/src/contracts/proving-ground.ts: awsf.proving-ground-item/v1 in TypeBox, registered.
    Fields: id, kind (review or build), taskClass, role, baseSha (40 hex, a commit on main),
    request. A review item adds seed { patch (path), defectClass, expected: [{ file, lineStart,
    lineEnd }] }. A build item adds gates (configured gate ids) and acceptance.
  Create five review items under core/src/metrics/proving-ground/, each a JSON item and a small
    seed patch, one planted defect per item, in these five classes:
      an off-by-one at a boundary
      a missing await on a promise whose result is used
      an inverted guard condition
      a wrong key in a copy-pasted lookup
      a new write path that skips the credential scrub
    Pin each to a recent commit on main, and prove each patch applies there with git apply
    --check before you return. Author every defect for this suite.
  Create core/src/metrics/route-arm-score.ts. Arms are route specs, two or more. Each repetition
    records its randomized order. A pair is invalid when the observed provider or model differs
    from its arm, usage authority is none, the envelope stayed invalid, or the replay paused at
    a ceiling; each reason is named. A finding matches a planted defect when its file is equal
    and its line lies within the expected range +/-3. A null-line finding on the right file is
    file-only, reported apart from recall. Per arm: recall, false alarms, file-only, invalid
    pairs. Build items score first pass on their gates.
  Tests in core/test/unit/metrics-route-arm-score.test.ts on synthetic findings.

DO NOT
  Copy a defect, a diff or a request from a real run or a real escape. The owner approves the
    five patches before funding the suite (Q8).
  Edit prompt-benchmark.ts or its tests. They stay byte-unchanged.
  Name any file with manifest or receipt in it.

BUILDER READY
  The item schema validates all five items; each patch applies at its pinned SHA (git apply
    --check output in your envelope); the scorer tests pass.
  npm run test:unit, npm run typecheck and npm run lint all pass.

OWNER ACCEPTANCE
  Read the five patches. Each plants exactly one defect of its class and nothing else.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(metrics): add the frozen corpus, five seeded-defect items and the route-arm scorer
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after the milestone lands: task 11's rows in specs/awsf-v2-w18-route-metrics.html and
  this ticket's state move together in one commit (invariant 12).
  Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T12, T13 and T14: contradictions with their
  prompts (which wins, and why), moved or renamed files, scope they can skip or must absorb.
  The owner copies them into those tickets' ## Handoff at landing. Edit no ticket file.
```

### T12 — The prove workflow: a seeded candidate at a pinned base, reviewed on the arm's route

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M4. Its builder route is
  claude/anthropic/claude:opus@xhigh and its review route claude/anthropic/claude:opus@high,
  both set by the owner's --route flags. The host owns routing. Do not change it.
  Manual: Opus 5.5 at xhigh, or the nearest route live quota allows.

TASK 12 of 17. Plan: specs/awsf-v2-w18-route-metrics.html, milestone M4, task 12.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**.
  The host commits this ticket and runs its gates before the next ticket starts. Never
  write specs/** (plan markers, ticket state, Handoff), docs/driving/**, AGENTS.md,
  awsf.config.yaml, core/src/state/**, core/src/observability/migrations/**, or a .claude/
  directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T11, already on the shift's head.

BASELINE
  Marimba's preflight ran npm run test:unit, typecheck and lint at this milestone's base.
  Inside a shift, the previous ticket's tests gate passed on the head you start from.
  A manual session runs npm run test:unit first and records the count.

READ FIRST
  specs/awsf-v2-w18-route-metrics.html - DD7, Q7, Risks R9, task 12
  core/src/workflow/compiled-ids.ts and core/src/workflow/shift/compile.ts and bind.ts - the
    compiled-workflow precedent to copy
  core/src/workflow/compiler.ts - reviewBuildPhaseId and why it refuses zero or split producers
  core/src/cli/commands/production-run.ts - the review inversion block that calls
    reviewWorkerProvider, providerPairFrom and oppositeProvider
  core/src/cli/commands/start.ts - the worktree base: seed?.integrationBaseSha ?? HEAD
  core/src/git/worktrees.ts - createWorktree
  core/src/cli/commands/land.ts and journey.ts - where a replay must be refused

DO
  Add "prove" to COMPILED_WORKFLOW_IDS. Register no placeholder in WORKFLOW_RECIPES.
  Create core/src/workflow/prove/compile.ts: compileProve(item, arm, config), pure.
    A review item compiles to: seed (code, owner host: one host commit applying the item's patch
    on the pinned base, emitting awsf.build-output/v1), review-context (code), reviewer (agent,
    owner reviewer, maxCorrections 1).
    A build item compiles to: brief (host, the item's request), build (agent, owner builder),
    tests (host, the item's gates). No review tail.
  Create core/src/workflow/prove/bind.ts for start, the runner and resume, as shift's bind.ts.
  production-run.ts: add review mode seeded, taken only for a prove attempt whose build producer
    is the host seed phase. The reviewer route is the arm's explicit --route reviewer= and is
    required; its absence is refused by name. compiler.ts: reviewBuildPhaseId accepts the seed
    phase as the one build producer for prove only.
  The attempt status carries replay: { itemId, itemDigest, arm, repetition, order, baseSha }.
    start.ts creates the worktree at replay.baseSha through createWorktree, the seam a seed's
    integrationBaseSha already uses.
  land.ts and journey.ts refuse a prove attempt with a named error: a replay is measurement,
    never delivery.
  Tests: every shipped recipe compiles to the value it compiled to before; a review workflow
    with zero producers still throws its original error class; seeded mode refuses a missing
    reviewer route; land and journey refuse a replay.

DO NOT
  Relax reviewBuildPhaseId for any workflow but prove.
  Add a reset, force, checkout-over or delete spelling. The worktree starts at the pinned SHA.
  Enable prove in awsf.config.yaml. That is gate G18-B, the owner's, after M4 lands.
  Import raise.ts or rework.ts from any prove module.

BUILDER READY
  The tests above pass, and every existing compiler, review-routing and shift test still passes.
  The invariant-8 meta-tests pass with no exemption added.
  npm run test:unit, npm run typecheck and npm run lint all pass.

OWNER ACCEPTANCE
  None for this ticket alone. M4's journey is task 14's list.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(workflow): add the prove workflow with a seeded candidate and an explicit review route
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after the milestone lands: task 12's rows in specs/awsf-v2-w18-route-metrics.html and
  this ticket's state move together in one commit (invariant 12).
  Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T13 and T14: contradictions with their
  prompts (which wins, and why), moved or renamed files, scope they can skip or must absorb.
  The owner copies them into those tickets' ## Handoff at landing. Edit no ticket file.
```

### T13 — awsf prove, and the proving-ground evidence source end to end

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M4. Its builder route is
  claude/anthropic/claude:opus@xhigh and its review route claude/anthropic/claude:opus@high,
  both set by the owner's --route flags. The host owns routing. Do not change it.
  Manual: Opus 5.5 at xhigh, or the nearest route live quota allows.

TASK 13 of 17. Plan: specs/awsf-v2-w18-route-metrics.html, milestone M4, task 13.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**.
  The host commits this ticket and runs its gates before the next ticket starts. Never
  write specs/** (plan markers, ticket state, Handoff), docs/driving/**, AGENTS.md,
  awsf.config.yaml, core/src/state/**, core/src/observability/migrations/**, or a .claude/
  directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T05, T06 (landed with M2), T07 (landed with M3) and T12, on the shift's head.

BASELINE
  Marimba's preflight ran npm run test:unit, typecheck and lint at this milestone's base.
  Inside a shift, the previous ticket's tests gate passed on the head you start from.
  A manual session runs npm run test:unit first and records the count.

READ FIRST
  specs/awsf-v2-w18-route-metrics.html - DD8, Q7, task 13
  core/src/cli/commands/new.ts and degrade-review.ts - task creation and the owner-act shape
  core/src/workflow/route-flags.ts - how a --route spec is parsed and checked against a workflow
  core/src/metrics/payload.ts, core/src/cli/commands/metrics.ts, dashboard/src/routes/metrics.vue

DO
  Add awsf prove <task> --item <id> --arm "<route spec>" --rep <n> [--order <k>] --reason "<why>"
    in core/src/cli/commands/prove.ts: an interactive owner terminal and a credential-free
    reason; refuse an unknown item, an arm route that does not reach the item's role, and a
    repeated (item, arm, repetition). It creates the task with the replay record, prints the
    awsf start and awsf cancel commands for it, and spawns nothing.
  Do not register it. Export proveCommand and test it with a fake owner terminal. The owner
    wires its main.ts arm, CLI_COMMANDS, the cheatsheet and the guard verb together in gate
    G18-B after this milestone lands (core/test/unit/meta/boundary-claims.test.ts is why).
  The projector writes the replay record once, as a session-level event. Role-rows gain source
    (proving-ground when the session's workflow is prove, production otherwise) and the replay's
    item, arm, repetition and order.
  Production statistics exclude proving-ground rows unless the Evidence source ladder selects
    them. The rail's proving-ground pill turns live, with its count.
  awsf metrics --source proving-ground prints the route-arm scores from T11 per item and arm.

DO NOT
  Let a replay row enter a production statistic by default.
  Add a main.ts arm, a CLI_COMMANDS entry or a cheatsheet line for prove, or edit
    docs/driving/**.
  Add a --yes or any non-interactive path to awsf prove.

BUILDER READY
  Tests for every refusal of awsf prove, the source tag, the default exclusion, and the
    --source proving-ground readout on a synthetic database.
  boundary-claims and cheatsheet-reconciliation pass unchanged.
  npm run test:unit, npm run typecheck, npm run lint and npm run dash:build all pass.

OWNER ACCEPTANCE
  None for this ticket alone. M4's journey is task 14's list.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(metrics): add awsf prove and keep replays apart as the proving-ground source
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after the milestone lands: task 13's rows in specs/awsf-v2-w18-route-metrics.html and
  this ticket's state move together in one commit (invariant 12).
  Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T14 and T17: contradictions with their
  prompts (which wins, and why), moved or renamed files, scope they can skip or must absorb.
  The owner copies them into those tickets' ## Handoff at landing. Edit no ticket file.
```

### T14 — Testing Strategy for M4: one replay end to end, and replays never land

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M4. Its builder route is
  claude/anthropic/claude:opus@xhigh and its review route claude/anthropic/claude:opus@high,
  both set by the owner's --route flags. The host owns routing. Do not change it.
  Manual: Opus 5.5 at xhigh, or the nearest route live quota allows.

TASK 14 of 17. Plan: specs/awsf-v2-w18-route-metrics.html, milestone M4, task 14.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**.
  The host commits this ticket and runs its gates before the next ticket starts. Never
  write specs/** (plan markers, ticket state, Handoff), docs/driving/**, AGENTS.md,
  awsf.config.yaml, core/src/state/**, core/src/observability/migrations/**, or a .claude/
  directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T11, T12 and T13, all on the shift's head.

BASELINE
  Marimba's preflight ran npm run test:unit, typecheck and lint at this milestone's base.
  Inside a shift, the previous ticket's tests gate passed on the head you start from.
  A manual session runs npm run test:unit first and records the count.

READ FIRST
  specs/awsf-v2-w18-route-metrics.html - task 14
  core/test/journeys/shift-milestone.test.ts - a compiled-workflow journey to copy
  core/test/unit/meta/shift-no-raise-import.test.ts, shift-no-rework-import.test.ts,
    shift-owner-gate-fence.test.ts - fences to extend to prove modules

DO
  core/test/journeys/prove-replay.test.ts: awsf prove with a fake owner terminal; start at the
    pinned base of a throwaway two-commit repository; the seed commit; a fixture review;
    AWAITING_OWNER; awsf land refused by name; cancel; rows tagged proving-ground; the scorer's
    recall read back.
  Extend the fences to prove modules: no import of raise.ts or rework.ts, nothing that can
    produce L20.
  Cover the scorer's edges in core/test/unit/metrics-route-arm-score.test.ts: every
    invalidation reason, the +/-3 window's edges, a file-only finding, the recorded order.

DO NOT
  Call a provider, or read the owner's state root.
  Add an exemption to any invariant-8 meta-test.

BUILDER READY
  prove-replay.test.ts and the extended fences pass.
  npm run test:unit, npm run typecheck and npm run lint all pass.

OWNER ACCEPTANCE (journey w18-m4)
  Read the five seed patches (Q8).
  After landing and gate G18-B: run one awsf prove on the cheapest arm, start and run it, see
    AWAITING_OWNER, see awsf land refuse it, cancel it, and see it under the proving-ground
    source in the tab. Then fund and start the D3 suite (40 replays) when ready.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: test(metrics): run one replay end to end and prove replays never land
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after the milestone lands: task 14's rows in specs/awsf-v2-w18-route-metrics.html and
  this ticket's state move together in one commit (invariant 12).
  Milestone M4's header moves with it, because this task closes the milestone.
  Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T17: contradictions with their
  prompts (which wins, and why), moved or renamed files, scope they can skip or must absorb.
  The owner copies them into those tickets' ## Handoff at landing. Edit no ticket file.
```

### T15 — The ticket task class: field, fence vocabulary and comparisons within a class

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M5. Its builder route is
  claude/anthropic/claude:opus@high and its review route claude/anthropic/claude:opus@high,
  both set by the owner's --route flags. The host owns routing. Do not change it.
  Manual: Opus 5.5 at high, or the nearest route live quota allows.

TASK 15 of 17. Plan: specs/awsf-v2-w18-route-metrics.html, milestone M5, task 15.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**.
  The host commits this ticket and runs its gates before the next ticket starts. Never
  write specs/** (plan markers, ticket state, Handoff), docs/driving/**, AGENTS.md,
  awsf.config.yaml, core/src/state/**, core/src/observability/migrations/**, or a .claude/
  directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T04, T06 (landed with M2) and T07 (landed with M3).

BASELINE
  Marimba's preflight ran npm run test:unit, typecheck and lint at this milestone's base.
  Inside a shift, the previous ticket's tests gate passed on the head you start from.
  A manual session runs npm run test:unit first and records the count.

READ FIRST
  specs/awsf-v2-w18-route-metrics.html - Decisions (D6), task 15
  core/src/contracts/ticket.ts - TICKET_WORKFLOWS and the vocabulary style
  core/src/persistence/plan-tickets.ts - ticketData: how tier and workflow are validated
  core/test/unit/meta/ticket-plan-sync.test.ts - the frontmatter-vocabulary test
  core/src/workflow/prompt-benchmark.ts - PROMPT_BENCHMARK_CORPUS task classes
  core/src/workflow/shift/bind.ts - shiftTicketOf

DO
  Export TICKET_TASK_CLASSES from core/src/contracts/ticket.ts: bounded-source-change,
    contract-envelope-change, evidence-heavy-defect-review. One constant.
  plan-tickets.ts reads an optional task_class and treats a value outside the vocabulary exactly
    as it treats a bad tier. ticket-plan-sync.test.ts's vocabulary test checks task_class.
  The row builder joins a shift build phase to its ticket through shiftTicketOf and reads the
    ticket's class; every other row is unclassified, a value of its own.
  The lens gains a Task class facet. recommend and the verdicts run within the selected class.

DO NOT
  Edit any ticket file. Classifying existing tickets is owner-side.
  Widen TICKET_WORKFLOWS or touch the shift fences.
  Compare two classes against each other in one verdict.

BUILDER READY
  Tests: a valid class is read; an invalid one makes the ticket unreadable; the fence rejects it;
    a shift row gets its ticket's class; a non-shift row is unclassified; recommend filters by
    class.
  npm run test:unit, npm run typecheck, npm run lint and npm run dash:build all pass.

OWNER ACCEPTANCE
  None for this ticket alone. M5's journey is task 17's list.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(tickets): add an optional task class and compare routes within it
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after the milestone lands: task 15's rows in specs/awsf-v2-w18-route-metrics.html and
  this ticket's state move together in one commit (invariant 12).
  Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T16 and T17: contradictions with their
  prompts (which wins, and why), moved or renamed files, scope they can skip or must absorb.
  The owner copies them into those tickets' ## Handoff at landing. Edit no ticket file.
```

### T16 — The advisory: awsf metrics --advise and the route evidence in awsf shift plan

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M5. Its builder route is
  claude/anthropic/claude:opus@high and its review route claude/anthropic/claude:opus@high,
  both set by the owner's --route flags. The host owns routing. Do not change it.
  Manual: Opus 5.5 at high, or the nearest route live quota allows.

TASK 16 of 17. Plan: specs/awsf-v2-w18-route-metrics.html, milestone M5, task 16.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**.
  The host commits this ticket and runs its gates before the next ticket starts. Never
  write specs/** (plan markers, ticket state, Handoff), docs/driving/**, AGENTS.md,
  awsf.config.yaml, core/src/state/**, core/src/observability/migrations/**, or a .claude/
  directory at the repository root.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T06 (landed with M2) and T15, on the shift's head.

BASELINE
  Marimba's preflight ran npm run test:unit, typecheck and lint at this milestone's base.
  Inside a shift, the previous ticket's tests gate passed on the head you start from.
  A manual session runs npm run test:unit first and records the count.

READ FIRST
  specs/awsf-v2-w18-route-metrics.html - Decisions (D5), DD6, Q4, task 16
  core/src/cli/commands/shift.ts - shiftPlanReadout and its caller in main.ts
  core/test/unit/meta/shift-no-raise-import.test.ts - an import fence to copy

DO
  Add --advise to awsf metrics: [--plan <stem> --milestone <Mx>[,...]] [--role builder|reviewer].
    For each role the selection runs and each task class in it, print the configured route, the
    recommendation with depth, n, interval and list-equivalent per row, and its exact
    --route role=adapter/provider/model@effort spelling, or "insufficient evidence: keep the
    configured route". Every block ends "advisory: the runner never routes on this".
  awsf shift plan prints the same block after its admission lines. The admission logic and every
    refusal stay as they are.
  core/test/unit/meta/metrics-advisory-fence.test.ts: no file under core/src/workflow/ or
    core/src/execution/, and none of production-run.ts, review-phase.ts, rework.ts, start.ts,
    new.ts, imports core/src/metrics/ or dashboard/shared/route-metrics.ts. Prove the matcher
    bites on an in-memory specimen.

DO NOT
  Change a route, a default, or a config value from anything this ticket computes.
  Edit docs/driving/** or CONTRACT.md.

BUILDER READY
  Tests for the advise output on a synthetic database, the shift plan block, and the fence.
  npm run test:unit, npm run typecheck and npm run lint all pass.

OWNER ACCEPTANCE
  None for this ticket alone. M5's journey is task 17's list.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(metrics): show advisory route evidence in awsf metrics and awsf shift plan
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after the milestone lands: task 16's rows in specs/awsf-v2-w18-route-metrics.html and
  this ticket's state move together in one commit (invariant 12).
  Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for T17: contradictions with their
  prompts (which wins, and why), moved or renamed files, scope they can skip or must absorb.
  The owner copies them into those tickets' ## Handoff at landing. Edit no ticket file.
```

### T17 — Testing Strategy for M5, awsf metrics export, and the workstream's closing duties

```
ROUTING
  Managed (the expected path): one AWSF shift runs milestone M5. Its builder route is
  claude/anthropic/claude:opus@high and its review route claude/anthropic/claude:opus@high,
  both set by the owner's --route flags. The host owns routing. Do not change it.
  Manual: Opus 5.5 at high, or the nearest route live quota allows.

TASK 17 of 17. Plan: specs/awsf-v2-w18-route-metrics.html, milestone M5, task 17.
REPOSITORY: this checkout (AWSF). One repository.

EXECUTION
  Managed (shift): write only inside core/src/**, core/test/**, dashboard/**, prompts/**.
  The host commits this ticket and runs its gates before the next ticket starts. Never
  write specs/** (plan markers, ticket state, Handoff), docs/driving/**, AGENTS.md,
  awsf.config.yaml, core/src/state/**, core/src/observability/migrations/**, or a .claude/
  directory at the repository root.
  This ticket also edits docs/cheatsheet.html, which the builder may write only after the
  owner's gate G18-A. Check agents[builder].writes in awsf.config.yaml first. If
  docs/cheatsheet.html is not there, stop and report: the cheatsheet-reconciliation fence
  will be red at this ticket's own tests gate.
  Manual: the same boundary. Commit only with the owner's explicit authorization.
  Unknown context: read only, and ask before any write.

PREDECESSORS
  T03, T06, T10, T14 (landed with M1-M4), T15 and T16 on the shift's head.

BASELINE
  Marimba's preflight ran npm run test:unit, typecheck and lint at this milestone's base.
  Inside a shift, the previous ticket's tests gate passed on the head you start from.
  A manual session runs npm run test:unit first and records the count.

READ FIRST
  specs/awsf-v2-w18-route-metrics.html - the Identifier Spine, Validation Commands, task 17
  specs/awsf-v2-plan.html - Milestone M18 / W18, its checklist
  core/test/unit/meta/junk-drawer.test.ts - the names an export may never have

DO
  Add awsf metrics export: write awsf.route-metrics/v1 JSON Lines under
    <state root>/exports/route-metrics/: a header line (schema, extractedAt, the rate card's
    checkedAt, the row count, the rows' sha256), then one role-row per line. Refuse a path
    outside the state root and a name matching /manifest|receipt/i. Print the path and digest.
  Add "metrics export" to CLI_COMMANDS and <li><code>metrics export</code></li> to the commands
    list in docs/cheatsheet.html, in this same change.
  core/test/journeys/metrics-workstream.test.ts: one synthetic state root with a shift, a
    build-review, a blocked run and a replay: projection, an attribution, the API payload, the
    advisory, the export, and the export read back equal to the API rows.
  Run npm test (all four layers) and confirm git status --porcelain is clean afterwards.
  Return the closing record: each task's final state, the milestone landing SHAs you can see,
    gate counts, frame deviations accepted at M3, Questionable outcomes, and evidence for each
    row of the spine's M18 checklist.

DO NOT
  Write an export anywhere inside the repository.
  Flip any marker or ticket state, in this plan or the spine.

BUILDER READY
  metrics-workstream.test.ts passes; npm test passes all four layers; the export refusals are
    tested.
  npm run typecheck, npm run lint and npm run dash:build all pass.

OWNER ACCEPTANCE (journeys w18-m5 and w18-route-metrics)
  Run awsf shift plan for any plan's milestone and read the advisory block.
  Run awsf metrics export and open the file it names; it is in the state root.
  In Chrome, beside the eleven frames: the whole tab, with the proving-ground pill live and the
    Task class facet present; spot-check all seven palettes in both modes.
  At landing: this plan's M5 header and task 17's rows, this ticket's state, the spine's
    Milestone M18 / W18 marker and specs/tickets/awsf-v2-plan/W18.md move together.

COMMIT
  Managed: leave the tree for the host and put the proposed message in your envelope.
  Manual: commit only when the owner says so, as the owner, with no trailer.
  Proposed: feat(metrics): add awsf metrics export and close W18 with one workstream journey
  Body: what changed and why, the test counts, anything unresolved.
  Never name an agent, model or tool in an identity, a message or a trailer.

MARKERS
  Owner-side, after the milestone lands: task 17's rows in specs/awsf-v2-w18-route-metrics.html and
  this ticket's state move together in one commit (invariant 12).
  Milestone M5's header moves with it, because this task closes the milestone.
  Return the evidence. Edit neither file.

HANDOFF
  In your envelope's notes, give dated findings for the spine record (specs/awsf-v2-plan.html Amendments): contradictions with their
  prompts (which wins, and why), moved or renamed files, scope they can skip or must absorb.
  The owner copies them into those tickets' ## Handoff at landing. Edit no ticket file.
```
