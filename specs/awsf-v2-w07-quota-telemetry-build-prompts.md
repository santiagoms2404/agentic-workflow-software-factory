# Build Prompts — AWSF v2 W07, Quota telemetry as a readout

Companion to [`awsf-v2-w07-quota-telemetry.html`](./awsf-v2-w07-quota-telemetry.html) and
[`tickets/awsf-v2-w07-quota-telemetry/`](./tickets/awsf-v2-w07-quota-telemetry/). Created
2026-08-24.

**These prompts build the approved deep plan.** Twenty fresh sessions execute twenty numbered
tasks in plan order. **Every task is offline and spends no agent quota.** Task 1 makes one bounded
live invocation of `quota-axi`, which reads provider quota endpoints and cannot spend the quota it
measures; that is the only process this workstream starts outside the test suite.

## Gates before execution

1. **The owner decided all nine Questionables on 2026-08-24.** Every one is a constraint, not a
   suggestion: Q1 adds legal edge `L26`; Q2 puts the threshold in `awsf.config.yaml`; Q3 ships the
   median comparison as advisory; Q4 keys the threshold by adapter id; Q5 sets the floor at 0.1.29;
   Q6 sets 2500 ms / 8000 ms timeouts; Q7 keeps the snapshot journal-only; Q8 builds a three-leg
   fence; Q9 makes retention of an unreadable payload automatic. **Nothing in this plan is still an
   open question** — the only two things it waits on are the owner commits behind G7-A and G7-B.
2. **Gate G7-A blocks M3 onward.** The per-route threshold lives in `awsf.config.yaml`, which is a
   protected path. The owner lands one amendment commit restating that file's durable-intent line to
   distinguish measured quota state (still forbidden) from a durable quota policy threshold
   (permitted). **It is the permission only — the commit adds no `quota_stop` block.**
   `RoutingSchema` carries `additionalProperties: false` and `load.ts` hard-fails, so a block written
   before T07's schema change would break every command with
   `/routing/quota_stop: Unexpected property`. T07 extends the schema (`core/src/config/**` is not
   protected); actual values are a separate optional owner commit afterwards, and absent means the
   stop is disabled. **No agent may write `awsf.config.yaml`.** M1 and M2 do not wait on it.
3. **Gate G7-B blocks M6.** Q1 is decided: the stop gets its own legal edge, `L26 — RUNNING →
   AWAITING_OWNER`, actor `host`, not a spawn site, not interactive, not a correction edge.
   `core/src/state/**` is a protected path, so the owner lands one commit touching two files — the
   edge in `core/src/state/task-machine.ts` and its guard in `core/src/state/guards.ts`. **No
   migration is needed**: `0001-initial.sql` declares `from_state`, `to_state` and `edge_id` with no
   `CHECK`. The test-side mirrors in `core/test/unit/_lifecycle-tables.ts` and
   `core/test/unit/transitions.test.ts` are agent work and belong to T15. M1–M5 do not wait on it.
4. W04's deep plan is complete and its spine marker is `[x]`. The readout resolves the project
   through `awsf.project.yaml` and the plan repository it names.
5. `CLAUDE.md` and `docs/TESTING.md` do not exist in this repository. Do not invent them. Read
   `AGENTS.md`, this plan, the named source files, and the package scripts instead.

## Conventions used by every prompt

- Read `AGENTS.md` in full. Invariants 1, 3, 7, 9 and 10 are all directly in scope.
- **Flip this leaf plan's own markers.** In `specs/awsf-v2-w07-quota-telemetry.html`, move the
  current task's checklist items `[]`→`[wip]`→`[x]`, and move the containing milestone header to
  `[wip]` on its first task and `[x]` only on its last. Flip the matching ticket's `state:` in the
  same commit.
- **Do not flip `specs/awsf-v2-plan.html`'s W07 marker before T20.** T20 alone closes the spine
  marker and `specs/tickets/awsf-v2-plan/W07.md`, after every leaf marker is `[x]`.
- **The five things no task in this workstream may do**, restated in every prompt because each one
  is a rule a plausible convenience would break: let quota influence routing in any form; add a
  timer, scheduler, or automatic resume; derive a per-task cost from two window readings; import
  `node:child_process` outside `transport-broker.ts`; add a dependency outside the invariant 7
  allowlist.
- Never add a runtime report, receipt, or manifest file; never commit live task or session state.
- Append the modified date and an Amendment with the commit SHA after each completed task. Never put
  an agent, model, or AI tool in commit identity or message.

# Section B — Task prompts (recommended)

### T01 — Capture one real reading, scrub it, and write its provenance

```
[MODEL: Opus 5 · EFFORT: high — this is the workstream's only live invocation and the scrub list is the whole evidence chain]

TASK 1 of 20. Plan: specs/awsf-v2-w07-quota-telemetry.html, milestone M1.
PREDECESSORS: none. Confirm the owner approved the plan. G7-A is not needed for M1.

READ FIRST
  AGENTS.md - in full, especially invariants 1, 7, 9 and 10
  specs/awsf-v2-w07-quota-telemetry.html - The Runtime Contract, Relevant Files, and M1 task 1
  core/test/fixtures/providers/claude/PROVENANCE.md - the provenance idiom to copy exactly
  core/test/fixtures/providers/claude/capture-probe.ts - the probe idiom to copy exactly
  core/test/unit/meta/no-credentials-in-fixtures.test.ts - the sweep the new files must survive

DO
  Create core/test/fixtures/quota-axi/. Write capture-probe.ts importing the module's own argv
  builder rather than hard-coding argv, so the argv under test and the argv that produced the
  bytes are the same argv by construction. Spend ONE bounded live invocation of
  `quota-axi --provider claude,codex --json` resolved on PATH. Write nominal.json as CAPTURED then
  SCRUBBED. Scrub and record: any account identity or label, any email- or address-shaped string,
  every absolute or home-relative path including cache and auth-source paths, and any sourcesTried
  entry naming a machine location. KEEP timestamps - they are what the parser reads - and record
  the capture instant beside them so a test can pin `now`. Write PROVENANCE.md recording what ran,
  the resolved version, exit code, byte count, whether stderr was empty, every scrub and its
  reason, and the NAMED ABSENCE: no fixture exists for the bytes quota-axi emits when it is itself
  rate-limited, because they cannot be summoned safely; the next natural occurrence is retained.

DO NOT
  Pass --full, --refresh, --tui or --once. Use npx. Add quota-axi to any package.json. Write the
  parser yet. Commit any absolute path, account id, or credential-shaped value. Invent bytes and
  present them as captured.

DEFINITION OF DONE
  Every box in M1 task 1. no-credentials-in-fixtures.test.ts green over the new directory.
  Mark this leaf task and T01 together; leave M1 [wip] and the spine W07 marker untouched.
```

### T02 — Derive the six transformation fixtures, each named as a transformation

```
[MODEL: Sonnet 5 · EFFORT: medium — mechanical transformation work with one sharp fixture in it]

TASK 2 of 20. Plan: specs/awsf-v2-w07-quota-telemetry.html, milestone M1.
PREDECESSORS: T01 is done and M1 is [wip].

READ FIRST
  AGENTS.md - invariants 1 and 9
  specs/awsf-v2-w07-quota-telemetry.html - The Runtime Contract and M1 task 2
  core/test/fixtures/quota-axi/PROVENANCE.md and nominal.json - the bytes to transform
  core/test/fixtures/providers/claude/PROVENANCE.md - how a derived file is recorded

DO
  Derive six files from nominal.json, each by a stated transformation recorded in one sentence in
  PROVENANCE.md: derived-semantics-partial.json (quotaSemantics.status partial with
  unresolvedWindowIds); derived-state-unauthenticated.json (state.status reporting an auth problem
  with its reason and remedy, no usable window); derived-stale.json (raw windows retained while
  effective availability, pace, runway and selection are all unknown); derived-exhausted-now.json
  (zero runway); derived-runway-unknown.json (unmeasurable bounds named, no conclusion invented);
  and derived-windows-disagree.json, where windows[] reports generous headroom while
  effectiveAvailability reports little. That last one is what AC-5 is proved against.

DO NOT
  Write any derived file from scratch. Mix captured and invented bytes without saying which is
  which. Contact a provider. Write the parser yet.

DEFINITION OF DONE
  Every box in M1 task 2. no-credentials-in-fixtures.test.ts still green.
  Mark this leaf task and T02 together; leave M1 [wip] and the spine W07 marker untouched.
```

### T03 — Testing Strategy: the pure parser over the fixtures

```
[MODEL: Opus 5 · EFFORT: high — the render-source rule and the null-versus-zero discipline are both decided here]

TASK 3 of 20. Plan: specs/awsf-v2-w07-quota-telemetry.html, milestone M1, final task.
PREDECESSORS: T01 and T02 are done and M1 is [wip].

READ FIRST
  AGENTS.md - in full
  specs/awsf-v2-w07-quota-telemetry.html - The Runtime Contract including the derived-field rule,
    the Identifier Spine, and M1 task 3
  core/src/adapters/stream/usage.ts - the collect-every-fault discipline to copy
  core/test/fixtures/quota-axi/ - every fixture from T01 and T02

DO
  Write core/src/quota/parse.ts as a pure function of (rawText, now) returning a readout record
  and a fault list. Read quotaSemantics.effectiveAvailability and NEVER index windows[] except by
  an id that came out of the effective figure - effectiveAvailability selects the binding window,
  and the reset instant is then dereferenced from that named window and no other. Detect state
  structurally from state.status and quotaSemantics.status; the parser takes no exit code and has
  no parameter for one. Minutes-to-reset is null - never zero, never inferred - for runway.status
  unknown, for a stale report, and for unresolved semantics. Malformed input produces a fault list
  and an unavailable record, never a throw. Prove `now` is a parameter by asserting two pinned
  instants against one fixture produce two minute figures.

DO NOT
  Read the clock, the filesystem, or spawn anything from this module. Accept an exit code. Return
  0 where the answer is unknown. Throw on malformed input. Add any field a router could branch on.

DEFINITION OF DONE
  Every box in M1 task 3, including derived-windows-disagree.json rendering the effective figure.
  npm run test:unit, npm run typecheck and npm run lint green.
  Mark this leaf task and T03 together, move M1 to [x], and leave the spine W07 marker untouched.
```

### T04 — The probe as an injected capability

```
[MODEL: Sonnet 5 · EFFORT: medium — an established injection pattern, with one argv rule that must be exact]

TASK 4 of 20. Plan: specs/awsf-v2-w07-quota-telemetry.html, milestone M2.
PREDECESSORS: M1 is [x].

READ FIRST
  AGENTS.md - invariants 3 and 7
  specs/awsf-v2-w07-quota-telemetry.html - The Runtime Contract and M2 task 4
  core/src/execution/transport-broker.ts - runSystemCommand, SystemCommandOptions, resolveExecutable
  core/src/cli/commands/production-run.ts - how runCommand is already taken as an injected capability

DO
  Write core/src/quota/probe.ts taking runCommand and resolveExecutable as parameters matching
  SystemCommandOptions. Argv is exactly ["--provider", "<csv>", "--json"]. The executable is
  quota-axi resolved against the spec's own PATH. Build the provider CSV from this project's
  ENABLED configured routes only - never a full sweep, because a sweep touches auth sources for
  providers the project does not use and buys nothing. Add a test enumerating every argv
  construction site and asserting that --refresh, --tui, --once, --full and the string npx appear
  in no code path.

DO NOT
  Import node:child_process. Add quota-axi to any package.json. Use npx. Sweep every provider.
  Read the parser's output in this task; the probe returns bytes and a status.

DEFINITION OF DONE
  Every box in M2 task 4. child-process-fence.test.ts and dependency-allowlist.test.ts still green.
  Mark this leaf task and T04 together; leave M2 [wip] and the spine W07 marker untouched.
```

### T05 — The version floor and the failure posture, both written down

```
[MODEL: Opus 5 · EFFORT: high — two corrections the source left open, neither written down anywhere before]

TASK 5 of 20. Plan: specs/awsf-v2-w07-quota-telemetry.html, milestone M2.
PREDECESSORS: T04 is done and M2 is [wip].

READ FIRST
  AGENTS.md - in full
  specs/awsf-v2-w07-quota-telemetry.html - The Runtime Contract, Questionables Q5 and Q6, M2 task 5
  core/test/fixtures/quota-axi/PROVENANCE.md - the version the capture was taken from
  core/src/execution/transport-broker.ts - the timeoutMs the capability already carries

DO
  Set the floor at 0.1.29 - the version the source pinned and the version the M1 capture came
  from - checked by running `quota-axi --version` and comparing NUMERICALLY, not by string
  equality. A lower version is refused with reason code version-below-floor naming both the found
  version and the floor. State in the module that the floor is NECESSARY AND NOT SUFFICIENT: a
  higher version emitting an unreadable payload is caught by the parser's fault list, not here.
  Ship two hard timeouts as configuration, not literals: 8000 ms for the interactive preflight
  readout and 2500 ms for the phase-boundary probe, both passed through the capability's own
  timeoutMs. Make fail-open structural rather than a branch: the threshold comparison takes a
  KNOWN minute figure and nothing else, so an unavailable record has nothing to compare and cannot
  reach the stop by any path. Close the reason codes as a union of exactly seven:
  executable-not-found, timeout, nonzero-exit, unparseable, version-below-floor,
  semantics-unresolved, stale. Journal every failure - a silent skip is the defect this task exists
  to prevent. RETENTION (Q9, decided): on unparseable or
  nonzero-exit, write the raw bytes to the attempt's private uncommitted area at mode 0o600 - the
  same idiom production-run.ts already uses for raw/<run-id> - and journal the PATH rather than the
  bytes, so the next natural rate-limited response is kept by the system instead of depending on the
  owner noticing it.

DO NOT
  Compare versions as strings. Let a failed read stop a run. Use a free-text failure string. Skip a
  failure silently. Hard-code either timeout as a literal in a call site. COMMIT the retained bytes,
  journal them, or relax their 0o600 mode - a rate-limited payload may carry account identity, which
  is why only the path is journalled.

DEFINITION OF DONE
  Every box in M2 task 5. Mark this leaf task and T05 together; leave M2 [wip] and the spine W07
  marker untouched.
```

### T06 — Testing Strategy: the probe against a scripted fake

```
[MODEL: Sonnet 5 · EFFORT: medium — offline table-driven tests over an injected fake]

TASK 6 of 20. Plan: specs/awsf-v2-w07-quota-telemetry.html, milestone M2, final task.
PREDECESSORS: T04 and T05 are done and M2 is [wip].

READ FIRST
  AGENTS.md - invariant 3
  specs/awsf-v2-w07-quota-telemetry.html - M2 task 6 and the Identifier Spine (AC-2, INV-4)
  core/src/quota/probe.ts and core/src/quota/parse.ts - what is under test
  core/test/fixtures/quota-axi/derived-stale.json - the exit-code trap

DO
  Drive every test with a fake runCommand returning a scripted CommandResult; spawn nothing. Prove:
  a version below the floor produces version-below-floor (the red-on-lower-version proof the spine
  asks for by name); a timeout condition produces the timeout code and an unavailable record rather
  than an exception; exit code 0 carrying derived-stale.json produces `stale`, proving state is
  read structurally and not from the exit code; exit code 1 carrying a well-formed payload is still
  parsed structurally; and the argv enumeration test asserts the four barred flags and the string
  npx are absent.

DO NOT
  Spawn a real process anywhere in the suite. Reach the network. Weaken an assertion to make a test
  pass.

DEFINITION OF DONE
  Every box in M2 task 6. npm run test:unit, npm run typecheck and npm run lint green.
  Mark this leaf task and T06 together, move M2 to [x], and leave the spine W07 marker untouched.
```

### T07 — Verify the G7-A amendment, then read the threshold

```
[MODEL: Opus 5 · EFFORT: high — this task's first act is to stop if a gate has not opened]

TASK 7 of 20. Plan: specs/awsf-v2-w07-quota-telemetry.html, milestone M3.
PREDECESSORS: M2 is [x]. GATE G7-A: the owner's amendment commit must have landed.

READ FIRST
  AGENTS.md - in full
  specs/awsf-v2-w07-quota-telemetry.html - The Ordering Gate G7-A, Questionable Q2, M3 task 7
  specs/awsf-v2-plan.html - Shared Invariants, gate G2, and the owner-side work list
  awsf.config.yaml - the routing and policy.protected_paths blocks
  core/src/config/schema.ts and core/src/config/load.ts - the shape and the load-time boundary
  core/src/workflow/phase-launch-authorization.ts - ConfiguredPhaseRoute, which defines "route"

DO
  FIRST confirm the owner-authored commit has landed and that awsf.config.yaml's durable-intent
  line now distinguishes measured quota state from a durable quota policy threshold. IF IT HAS NOT,
  STOP: mark this task [f] with the reason and do not proceed. Otherwise extend
  core/src/config/schema.ts with the OPTIONAL routing.quota_stop block: a `default` entry and a
  `by_adapter` map, each carrying `minutes` and `probe_timeout_ms`. Absent means the stop is
  disabled, so a project that configures nothing behaves exactly as it does today. Key the
  threshold by ADAPTER ID, matching ConfiguredPhaseRoute.adapterId. Add a schema test refusing any
  percentage, reset instant, or window id, so the amended intent line is mechanically checked where
  the original never was.

DO NOT
  Write awsf.config.yaml or awsf.project.yaml - path-policy rejects protected-path independently of
  every write glob, and inventing an owner-authorized protected-change mechanism is the boundary
  working, not an obstacle. Accept a measured value in the schema. Make the stop on by default.

DEFINITION OF DONE
  Every box in M3 task 7. Mark this leaf task and T07 together; leave M3 [wip] and the spine W07
  marker untouched.
```

### T08 — Testing Strategy: the threshold configuration

```
[MODEL: Haiku 4.5 · EFFORT: low — schema tests over a small optional block]

TASK 8 of 20. Plan: specs/awsf-v2-w07-quota-telemetry.html, milestone M3, final task.
PREDECESSORS: T07 is done and M3 is [wip].

READ FIRST
  specs/awsf-v2-w07-quota-telemetry.html - M3 task 8
  core/src/config/schema.ts and core/src/config/load.ts - what is under test

DO
  Config tests only, with no probe, no process and no network. Prove: a config with no quota_stop
  block loads and yields a disabled stop; a `default` entry alone applies to every adapter; a
  by_adapter entry overrides the default for that adapter alone; a block carrying a percentage, a
  resetsAt, or a window id is refused by name; and a negative or non-integer `minutes` is refused.

DO NOT
  Spawn anything. Reach the network. Change load.ts's existing absolute-path or credential-shape
  refusals.

DEFINITION OF DONE
  Every box in M3 task 8. npm run test:unit, npm run typecheck and npm run lint green.
  Mark this leaf task and T08 together, move M3 to [x], and leave the spine W07 marker untouched.
```

### T09 — Map configured routes to measurable providers

```
[MODEL: Opus 5 · EFFORT: high — one wrong mapping produces a plausible wrong number with no error anywhere]

TASK 9 of 20. Plan: specs/awsf-v2-w07-quota-telemetry.html, milestone M4.
PREDECESSORS: M3 is [x].

READ FIRST
  specs/awsf-v2-w07-quota-telemetry.html - Questionable Q4, M4 task 9, and the ticket README's
    derived-field rules
  specs/tickets/awsf-v2-w07-quota-telemetry/README.md - the mapping rule, recorded so it is edited
    rather than re-derived
  awsf.config.yaml - the adapters block
  core/src/registry/catalog.ts and core/src/registry/plan-source.ts - W04's per-project resolution
  core/src/config/schema.ts - KNOWN_ADAPTER_KINDS

DO
  Write core/src/quota/routes.ts. Resolve the project through awsf.project.yaml and its plan
  repository, so the readout reports on THIS project's configured routes rather than on whatever
  the machine happens to be signed into. Map by ADAPTER KIND, NEVER by adapter id:
  claude-code -> claude, pi-codex -> codex. An adapter id is an owner-chosen label, and a project
  that named its Codex route `claude` would otherwise report the wrong provider's window silently.
  `fixture` maps to nothing and is reported as spends-no-quota rather than omitted. `antigravity`
  maps to nothing measurable and is reported as unmeasurable with that reason.
  `composite-fusion` reports the kinds of its members, or unmeasurable if they cannot be resolved.
  A disabled adapter is neither probed nor reported.

DO NOT
  Map by adapter id. Omit an unmappable route silently. Probe a disabled adapter. Guess a provider
  for a composite whose members do not resolve.

DEFINITION OF DONE
  Every box in M4 task 9. Mark this leaf task and T09 together; leave M4 [wip] and the spine W07
  marker untouched.
```

### T10 — Render the readout

```
[MODEL: Opus 5 · EFFORT: high — the closed field list here is the fence leg that makes the routing convenience unbuildable]

TASK 10 of 20. Plan: specs/awsf-v2-w07-quota-telemetry.html, milestone M4.
PREDECESSORS: T09 is done and M4 is [wip].

READ FIRST
  specs/awsf-v2-w07-quota-telemetry.html - The Runtime Contract, Questionable Q8, M4 task 10
  core/src/quota/parse.ts and core/src/quota/routes.ts - the inputs
  core/src/cli/main.ts - how a command is registered

DO
  Write core/src/quota/readout.ts and core/src/cli/commands/quota.ts. One row per configured route:
  adapter id, provider, effective percent remaining, MINUTES TO RESET, the configured threshold,
  and a verdict of above, below, disabled or unknown. The row STATES IN WORDS that the figure is
  account-wide and that another client moves it - the same sentence the adjudication used to strip
  this candidate's attribution claim, placed where the number is read rather than in a design
  document. An unavailable route shows its reason code and its remedy where the tool supplies one,
  never a blank and never a zero. CLOSE the readout record's field list and assert it exhaustively:
  no comparator, no sort order, no rank, no preferred or recommended field, and no boolean that
  answers "should I use this provider".

DO NOT
  Add any field a router could branch on. Order routes by any metric. Render a zero where the
  answer is unknown. Spend agent quota. Make more than one probe invocation per run.

DEFINITION OF DONE
  Every box in M4 task 10. Mark this leaf task and T10 together; leave M4 [wip] and the spine W07
  marker untouched.
```

### T11 — Testing Strategy: the readout over the fixtures

```
[MODEL: Sonnet 5 · EFFORT: medium — rendering tests plus one deliberate induced failure]

TASK 11 of 20. Plan: specs/awsf-v2-w07-quota-telemetry.html, milestone M4, final task.
PREDECESSORS: T09 and T10 are done and M4 is [wip].

READ FIRST
  specs/awsf-v2-w07-quota-telemetry.html - M4 task 11 and the Identifier Spine (AC-5)
  core/test/fixtures/quota-axi/derived-windows-disagree.json - the sharpest test in the milestone
  core/src/quota/readout.ts and core/src/quota/routes.ts - what is under test

DO
  Rendering tests over the M1 fixtures with an injected fake runCommand, plus a snapshot of the
  rendered text so a wording change is a visible diff rather than an accident. Prove:
  derived-windows-disagree.json renders the EFFECTIVE figure (AC-5); an adapter id that collides
  with another provider's name still reports its own kind's provider; each of the seven reason
  codes renders a distinct, non-blank row; and the exhaustive field-list assertion FAILS when a
  `preferred` field is added - add one temporarily, watch it go red, then restore.

DO NOT
  Leave the temporary field in place. Spawn a real process. Reach the network.

DEFINITION OF DONE
  Every box in M4 task 11. npm run test:unit, npm run typecheck and npm run lint green.
  Mark this leaf task and T11 together, move M4 to [x], and leave the spine W07 marker untouched.
```

### T12 — The observed-median query and its history floor

```
[MODEL: Sonnet 5 · EFFORT: medium — one read-side query with a deliberate refusal to answer on thin data]

TASK 12 of 20. Plan: specs/awsf-v2-w07-quota-telemetry.html, milestone M5.
PREDECESSORS: M4 is [x].

READ FIRST
  AGENTS.md - invariant 6
  specs/awsf-v2-w07-quota-telemetry.html - milestone M5's correction note, Questionable Q3, M5 task 12
  core/src/observability/queries.ts - PhaseRow and the file's own rules
  specs/awsf-v2-plan.html - Questionable Q4 as decided, for the upgrade's wording

DO
  Add observedPhaseDurationMedian(db, phaseKey) to core/src/observability/queries.ts as a SELECT on
  a readonly connection with columns named explicitly. Count only phases with both started_at and
  ended_at and a succeeded status - a phase that crashed is not an observation of how long that
  phase takes. HISTORY FLOOR: fewer than five completed observations returns insufficient-history,
  never a number, because a median of two is a number with the authority of a measurement and the
  reliability of a guess. Return a duration AND a count, and render the count beside the median so
  the reader sees what the figure rests on.

DO NOT
  Add a write path - invariant 6 keeps SQLite writes to sqlite.ts, projector.ts and the protected
  migrations directory, and this milestone touches none of them. Return a number below the floor.
  Wire the median to the stop condition; that is Q3 and it is deliberately not taken here.

DEFINITION OF DONE
  Every box in M5 task 12. Mark this leaf task and T12 together; leave M5 [wip] and the spine W07
  marker untouched.
```

### T13 — Testing Strategy: the median and the three-way verdict

```
[MODEL: Haiku 4.5 · EFFORT: low — query tests against a seeded in-memory projection]

TASK 13 of 20. Plan: specs/awsf-v2-w07-quota-telemetry.html, milestone M5, final task.
PREDECESSORS: T12 is done and M5 is [wip].

READ FIRST
  specs/awsf-v2-w07-quota-telemetry.html - M5 task 13
  core/src/observability/queries.ts - the new query
  core/src/quota/readout.ts - where the verdict is rendered

DO
  Query tests against an in-memory projection seeded from journal records, plus a rendering test
  for the three-way verdict. Prove: four observations return insufficient-history and five return a
  median with its count; even and odd observation counts both produce the expected median; a
  crashed phase with a started_at and no ended_at is excluded from both the median and the count;
  and the readout renders `fits`, `does not fit`, or `insufficient history` - rendering the third
  rather than falling back to the threshold verdict, so a reader is never shown a comparison that
  did not happen.

DO NOT
  Let the median become the stop condition. Fall back to the threshold verdict when history is
  thin. Spend quota.

DEFINITION OF DONE
  Every box in M5 task 13. npm run test:unit, npm run typecheck and npm run lint green.
  Mark this leaf task and T13 together, move M5 to [x], and leave the spine W07 marker untouched.
```

### T14 — The snapshot record, labelled non-attributable in the record itself

```
[MODEL: Opus 5 · EFFORT: high — this is where the workstream's lost claim must stay lost]

TASK 14 of 20. Plan: specs/awsf-v2-w07-quota-telemetry.html, milestone M6.
PREDECESSORS: M5 is [x].

READ FIRST
  AGENTS.md - invariants 1, 9 and 10
  specs/awsf-v2-w07-quota-telemetry.html - Problem item 2, Questionable Q7, M6 task 14, and the
    Notes section "Where a real per-task denominator actually comes from"
  core/src/observability/attempt-evidence.ts - the AttemptEvidence union
  core/src/observability/projector.ts - applyAttemptEvidence and its missing default clause
  core/src/contracts/normalized-events.ts - QuotaEventSchema and why it must NOT be reused
  core/src/persistence/journal.ts - scrubCredentials and stringifyRedacted on every append

DO
  Add { type: "quota-snapshot", ... } to the AttemptEvidence union. The record carries an explicit
  attribution: "none" field and a scope: "account-window" field - THE LABEL IS A FIELD, NOT A
  COMMENT, so a reader parsing the journal a year from now sees it without reading this plan. It
  also carries the boundary it sits at (the phase key just completed and the one not yet started),
  the effective percent, the minutes to reset, the reason code when unavailable, and the resolved
  quota-axi version. Journal-only: applyAttemptEvidence has no default clause, so an unhandled type
  is a silent no-op and no table is needed.

DO NOT
  Reuse the normalized `quota` event kind - that one is a provider-signalled refusal from inside a
  run, commented "quota is never a retry", and conflating a blocking refusal with advisory context
  makes both unreadable. Touch core/src/observability/migrations/**, which is a protected path.
  Compute any delta, rate, or task cost from two readings.

DEFINITION OF DONE
  Every box in M6 task 14. Mark this leaf task and T14 together; leave M6 [wip] and the spine W07
  marker untouched.
```


### T15 — Verify the L26 amendment, then move the test-side tables

```
[MODEL: Opus 5 · EFFORT: high — this task's first act is to stop if a protected-path gate has not opened]

TASK 15 of 20. Plan: specs/awsf-v2-w07-quota-telemetry.html, milestone M6.
PREDECESSORS: T14 is done and M6 is [wip]. GATE G7-B: the owner's L26 commit must have landed.

READ FIRST
  AGENTS.md - in full, especially invariant 2
  specs/awsf-v2-w07-quota-telemetry.html - the ordering gate G7-B, Questionable Q1 IN FULL, M6 task 15
  core/src/state/task-machine.ts - LEGAL_EDGES, EdgeId, SPAWN_SITE_EDGES, CORRECTION_EDGES
  core/src/state/guards.ts - GUARDS is Readonly<Record<EdgeId, ...>>, so a missing guard is a
    typecheck error; read L20's guard, which is what closes the gating-bypass objection
  core/test/unit/_lifecycle-tables.ts - the hand-maintained mirror and the illegal-pair classes
  core/test/unit/transitions.test.ts - assert.equal(LEGAL_EDGES.length, 25) at line 67
  core/src/observability/migrations/0001-initial.sql - the transitions table, which has no CHECK
    on from_state, to_state or edge_id

DO
  FIRST confirm the owner-authored G7-B commit has landed: L26 is in LEGAL_EDGES as
  { from: "RUNNING", to: "AWAITING_OWNER", actors: ["host"], spawnSite: false, interactive: false },
  and its guard exists in core/src/state/guards.ts. IF IT HAS NOT, STOP: mark this task [f] with the
  reason and do not proceed. Confirm the guard REFUSES a transition whose evidence carries no known
  minute figure - that is where INV-4 becomes a property of the machine rather than of how a
  comparison happens to be written, and it is the whole reason the edge was worth its amendment.
  Confirm L26 is neither a spawn site nor a correction edge, so SPAWN_SITE_EDGES and
  CORRECTION_EDGES are unchanged and the derived spawnSite/to cross-check still holds. Then move the
  pair out of the illegal set in _lifecycle-tables.ts and add L26 to its mirror - a SINGLE-CELL
  amendment, exactly as that file records L25's was, so only the "everything else" class changes.
  Update assert.equal(LEGAL_EDGES.length, 25) to 26 and the edge-id list beside it. Finally confirm
  no migration was needed by projecting one L26 row against the untouched schema.

DO NOT
  Write core/src/state/** - it is a protected path and path-policy rejects protected-path
  independently of every write glob. Invent an owner-authorized protected-change mechanism to route
  around it. Touch core/src/observability/migrations/**. Add L26 to SPAWN_SITE_EDGES or
  CORRECTION_EDGES. Recompute the first three illegal-pair classes.

DEFINITION OF DONE
  Every box in M6 task 15. Mark this leaf task and T15 together; leave M6 [wip] and the spine W07
  marker untouched.
```

### T16 — The stop at the boundary, and what never follows it

```
[MODEL: Opus 5 · EFFORT: high — the host-side wiring of a brand-new edge out of the busiest state]

TASK 16 of 20. Plan: specs/awsf-v2-w07-quota-telemetry.html, milestone M6.
PREDECESSORS: T14 and T15 are done and M6 is [wip].

READ FIRST
  specs/awsf-v2-w07-quota-telemetry.html - Questionable Q1 IN FULL, M6's state diagram, M6 task 16
  core/src/state/task-machine.ts - L26 as landed, and L19/L20/L25 as the only ways out toward work
  core/src/state/guards.ts - L21's comment, which is this repository's own statement of INV-5
  core/src/cli/commands/production-run.ts - the phase loop at
    `for (const [index, phase] of compiled.phases.entries())`
  core/src/quota/probe.ts and core/src/quota/readout.ts - the inputs

DO
  Take the snapshot at EVERY phase boundary in the production-run loop and journal it whether or not
  the threshold is configured. When the threshold is crossed at a boundary, take L26 to
  AWAITING_OWNER rather than launching the next phase. The threshold fires only on a KNOWN minute
  figure; unavailable, unknown, stale and unresolved all continue, and now cannot even form a legal
  transition because the guard refuses evidence without one. The transition's reason names the
  threshold and the observed figure, so the owner reads why they were handed the task rather than
  inferring it.

DO NOT
  Give L12 or L15 a quota condition - entangling quota with the tier fork out of GATING or with
  review-verdict consistency would put a quota test inside two guards that exist for other reasons.
  Add a timer, scheduled wake, automatic resume, or retry loop; leaving AWAITING_OWNER toward work
  is L19, L20 or L25, every one human- or owner-actored and interactive, and L21's existing comment
  already says a task waiting on the owner waits forever. Stop at BLOCKED, which is terminal for the
  attempt. Compute a task cost from two readings.

DEFINITION OF DONE
  Every box in M6 task 16. Mark this leaf task and T16 together; leave M6 [wip] and the spine W07
  marker untouched.
```

### T17 — Testing Strategy: the snapshot, the stop, and the silence after it

```
[MODEL: Opus 5 · EFFORT: high — the clock-advance assertion is the one a timer would fail, and the guard-refusal is what makes fail-open structural]

TASK 17 of 20. Plan: specs/awsf-v2-w07-quota-telemetry.html, milestone M6, final task.
PREDECESSORS: T14, T15 and T16 are done and M6 is [wip].

READ FIRST
  specs/awsf-v2-w07-quota-telemetry.html - M6 task 17 and the Identifier Spine
    (AC-3, AC-4, INV-3, INV-4, INV-5)
  core/src/adapters/stub.ts - the fixture adapter these tests drive
  core/src/persistence/journal.ts - what a round-tripped journal line looks like
  core/src/state/guards.ts - L20's guard, exercised here rather than restated

DO
  End-to-end on the fixture adapter with an injected fake runCommand and an injected clock, offline
  and spending no agent quota. Prove: a journal line round-trips with attribution: "none" present,
  asserted on the PARSED line; a multi-phase run with the threshold uncrossed journals one snapshot
  per boundary and reaches GATING with no L26 recorded; a figure below the threshold at a
  mid-RUNNING boundary records an L26 transition with actor host, spawn_site 0, and a reason naming
  both the threshold and the figure; an UNAVAILABLE reading attempting L26 produces a GUARD
  VIOLATION, not merely an unused value - that is the assertion making INV-4 structural; a task
  suspended by L26 with no candidate and no gates run CANNOT take L20 to LANDING, answering the
  gating-bypass objection by exercising L20's existing guard rather than adding a rule; after the
  stop the injected clock is advanced well past every timeout and NO FURTHER TRANSITION IS RECORDED;
  and projection of a journal carrying both the new evidence type and an L26 transition succeeds,
  writing no row for the evidence and one for the transition with no schema change.

DO NOT
  Use a real clock. Spawn a real process. Reach the network. Weaken the clock-advance assertion or
  the guard-refusal assertion - they are the only two tests that would catch, respectively, an
  accidental timer and a stop on a broken gauge.

DEFINITION OF DONE
  Every box in M6 task 17, including transitions.test.ts, actors.test.ts, rejection-order.test.ts and
  evidence.test.ts, all of which read the mirror table T15 moved. npm run test:unit, npm run
  typecheck and npm run lint green. Mark this leaf task and T17 together, move M6 to [x], and leave
  the spine W07 marker untouched.
```

### T18 — The transitive import fence

```
[MODEL: Opus 5 · EFFORT: high — the repository's first transitive fence, and it must be seen red]

TASK 18 of 20. Plan: specs/awsf-v2-w07-quota-telemetry.html, milestone M7.
PREDECESSORS: M6 is [x].

READ FIRST
  specs/awsf-v2-w07-quota-telemetry.html - Questionable Q8, M7 task 18, the Identifier Spine (INV-1)
  core/test/unit/meta/child-process-fence.test.ts - the fence idiom, which is a DIRECT scan
  core/test/unit/meta/_walk.ts - walkFiles and relRepo
  core/src/workflow/ - every file the closure starts from

DO
  Write core/test/unit/meta/quota-fence.test.ts. Build the relative-import graph across core/src/**
  using walkFiles, compute the reachable closure from every file under core/src/workflow/**, and
  assert core/src/quota/** is not in it. State in the file's header that this is the repository's
  FIRST transitive fence and why: the spine's rule is "may not reach the module at all", and a
  direct-import scan is satisfied by one intermediate file. PROVE IT RED before trusting it - add a
  temporary import of the quota module into a workflow file TWO HOPS AWAY, watch the fence name the
  path it found, then restore. The failure message prints the whole path, not just the endpoints.

DO NOT
  Settle for a direct-import scan. Leave the temporary import in place. Declare the fence done
  without having seen it fail - a fence nobody has seen fail is decoration.

DEFINITION OF DONE
  Every box in M7 task 18. Mark this leaf task and T18 together; leave M7 [wip] and the spine W07
  marker untouched.
```

### T19 — The routing-absence fence and the no-derived-cost fence

```
[MODEL: Opus 5 · EFFORT: high — leg three is what makes the routing convenience unbuildable rather than merely unbuilt]

TASK 19 of 20. Plan: specs/awsf-v2-w07-quota-telemetry.html, milestone M7.
PREDECESSORS: T18 is done and M7 is [wip].

READ FIRST
  specs/awsf-v2-w07-quota-telemetry.html - Questionable Q8, M7 task 19, the Identifier Spine
    (INV-2, INV-3), and the Risks table
  core/src/cli/commands/production-run.ts - which holds BOTH the route resolution and the phase loop
  core/src/workflow/review-routing.ts, core/src/cli/commands/review-phase.ts,
    core/src/cli/commands/rework.ts, core/src/cli/commands/start.ts - the other resolution sites
  core/src/quota/readout.ts - the record whose field list is closed

DO
  STATE THE WEAK LEG PLAINLY in the test file's header: the routing resolver and the legitimate
  consumer share one file, so no path glob can bar one while permitting the other, and pretending
  otherwise would be the weaker choice. Leg two, signatures: no route-resolution function accepts,
  returns, or closes over a type exported from core/src/quota/**, asserted over the named
  resolution sites. Leg three, shape: the readout record's exported field list is asserted
  exhaustively, so a comparator, rank, ordering or `preferred` field cannot be added at all. Add a
  source scan asserting no identifier matching quota plus delta, cost, spent, or per-task exists in
  core/src. Prove all three legs red, one at a time, then restore.

DO NOT
  Split production-run.ts - that is a refactor of the largest command in the repository for the
  benefit of one test, and it is scope this workstream does not own. Hide the weak leg. Leave any
  induced failure in place.

DEFINITION OF DONE
  Every box in M7 task 19. Mark this leaf task and T19 together; leave M7 [wip] and the spine W07
  marker untouched.
```

### T20 — Testing Strategy and the close

```
[MODEL: Sonnet 5 · EFFORT: medium — a full offline sweep, then the only marker flip in the workstream]

TASK 20 of 20. Plan: specs/awsf-v2-w07-quota-telemetry.html, milestone M7, final task.
PREDECESSORS: T18 and T19 are done and M7 is [wip]. Every earlier milestone is [x].

READ FIRST
  AGENTS.md - invariants 2 and 12
  specs/awsf-v2-w07-quota-telemetry.html - the Validation Commands section, the Amendments section,
    and M7 task 20
  specs/awsf-v2-plan.html - the W07 block and its checklist, which this task closes
  specs/tickets/awsf-v2-plan/W07.md - the spine ticket that flips in the same commit
  core/test/fixtures/quota-axi/PROVENANCE.md - the named absence, re-checked here

DO
  Run the full offline suite: npm run test:unit, npm run typecheck and npm run lint, with NO NETWORK
  and NO AGENT QUOTA spent anywhere in it. Confirm ticket-plan-sync.test.ts is green - every task has
  a ticket, states mirror markers, and each ticket's prompt is byte-identical to its Section B block.
  Confirm the identifier-spine coverage rows are green. Confirm every milestone is [x] and every
  ticket is done. RECORD BOTH AMENDMENTS in this plan's Amendments section with their commit SHAs -
  G7-A's config change and G7-B's L26 - so the plan that asked for them also records that they
  landed. Re-check the named absence: if T05's retention path captured a rate-limited response,
  scrub it, promote it to a fixture and say so in PROVENANCE.md; if it did not, the absence and its
  retention plan both stand. ONLY THEN flip W07's marker in specs/awsf-v2-plan.html to [x] and
  specs/tickets/awsf-v2-plan/W07.md to done, in the same commit.

DO NOT
  Flip the spine marker before every leaf box is [x] - invariant 2 says markers are earned. Let the
  named absence become a stale note. Commit a retained payload without scrubbing it. Lower any
  assertion to reach green.

DEFINITION OF DONE
  Every box in M7 task 20 and every box in the Validation Commands section. M7 is [x], the spine W07
  marker is [x], and specs/tickets/awsf-v2-plan/W07.md is done in the same commit.
```
