# Build Prompts — AWSF v2 W11, The five-stage ladder

Companion to [`awsf-v2-w11-five-stage-ladder.html`](./awsf-v2-w11-five-stage-ladder.html) and
[`tickets/awsf-v2-w11-five-stage-ladder/`](./tickets/awsf-v2-w11-five-stage-ladder/). Created
2026-08-25, revised 2026-08-26 after the owner review.

**These prompts build the approved deep plan.** Twenty fresh sessions execute twenty numbered
tasks in plan order. **Every task is offline and spends no agent quota.** No task in this
workstream makes a live provider call, and no test it writes may touch the network.

## Gates before execution

1. **The owner decided all eight Questionables on 2026-08-26, and every one took the plan's
   recommendation.** They are constraints, not suggestions, and **nothing in this workstream is
   still an open question.** The four that reach T01 are settled before the first task runs:
   stage granularity is recorded per stage with no default (Q4), an unrunnable stage becomes a
   stated absence rather than a hand-written envelope (Q5), a schema misfit blocks only its
   consumers (Q6), and the captures live under `core/test/fixtures/stages/` with timestamps
   normalized rather than dropped (Q7). Q1 fixed the code name as `stages` — **no task renames
   it.** Q2 promoted T08 from contingent to committed. Q3, Q8 confirmed the plan as authored.
   Do not re-litigate one; if a decision looks wrong once you are inside the work, that is an
   Amendment for the owner, not a change to make in a task.
2. **W03, W04, W05 and W06 are all `[x]` in `specs/awsf-v2-plan.html`.** This workstream consumes
   all four and adds no mechanism of its own. Confirm before T01.
3. **There is no owner-authored commit gate in this workstream, and that is a claim it makes about
   itself.** `INV-6` asserts the diff touches no path in `policy.protected_paths`. If a task finds
   it cannot finish without one, that task has discovered a routed mechanism: stop, write the
   finding, and route it to the workstream that owns it. Do not widen.
4. `CLAUDE.md`, `docs/TESTING.md` and `docs/UI_REVIEW.md` do not exist in this repository. Do not
   invent them. Read `AGENTS.md`, this plan, the named source files, and the `package.json`
   scripts instead.

## Conventions used by every prompt

- Read `AGENTS.md` in full. Invariants 1, 9 and 10 are directly in scope; 2, 11 and 12 govern
  markers, commits and tickets.
- **Flip this leaf plan's own markers.** In `specs/awsf-v2-w11-five-stage-ladder.html`, move the
  current task's checklist items `[]`→`[wip]`→`[x]`, and move the containing milestone header to
  `[wip]` on its first task and `[x]` only on its last. Flip the matching ticket's `state:` in the
  same commit.
- **Do not flip `specs/awsf-v2-plan.html`'s W11 marker before T20.** T20 alone closes the spine
  marker and `specs/tickets/awsf-v2-plan/W11.md`, after every leaf marker is `[x]`.
- **The seven things no task in this workstream may do**, restated in every prompt because each is
  a rule a plausible convenience would break: read either frozen candidate record
  (`specs/awsf-v2-candidates.md`, `specs/awsf-v2-candidates-GPT-version.md`); write a stage name
  that is not in `core/test/fixtures/stages/stages.json`; add an entry to `ENVELOPE_SCHEMAS`; write
  any path matched by `policy.protected_paths`; put a skill, a slash command, or a
  read-this-document instruction into any stage's prompt or gate; build any code path that starts
  one stage because another finished; let a test touch the network or spend quota.
- **Capture before contract.** No file under `core/src/stages/` may exist until M1's fixtures are
  committed. `AC-1` is observed in the commit record, so adding fixtures afterwards does not repair
  a violation.
- Never add a runtime report, receipt, or manifest file; never commit live task or session state.
- Append the modified date and an Amendment with the commit SHA after each completed task. Never
  put an agent, model, or AI tool in commit identity or message.

# Section B — Task prompts (recommended)

### T01 — Run the ladder by hand, and record the stage list

```
[MODEL: Opus 5 · EFFORT: max — this is the only task in the workstream that produces evidence rather than consuming it, and every later task is written against what it records]

TASK 1 of 20. Plan: specs/awsf-v2-w11-five-stage-ladder.html, milestone M1.
PREDECESSORS: none. Confirm the owner decided all eight Questionables, and that W03, W04, W05 and
W06 are [x] in specs/awsf-v2-plan.html.

READ FIRST
  AGENTS.md - in full, especially invariants 1, 9 and 10
  specs/awsf-v2-w11-five-stage-ladder.html - The Capture Pass in full, the Problem section, and M1 task 1
  core/src/cli/commands/init.ts - W03's host-only bootstrap
  core/src/cli/commands/project.ts - W04's register and resolve surface
  core/src/workflow/recipes/design-to-plan.ts - W05's seven phases
  core/src/workflow/recipes/simple-sdlc.ts - v1's build chain
  core/src/adapters/stub.ts - the zero-quota route and its eight scripted behaviours
  core/test/unit/cli/design-to-plan-route.test.ts - the existing offline world() this run mirrors

DO
  Work in a temporary directory OUTSIDE this repository. Drive a throwaway project through the
  ladder against W03 through W06 AS THEY ACTUALLY STAND, on the stub route, spending no quota.
  Record the ordered stage list as OBSERVED: exactly five entries, each carrying id, ordinal,
  owner (host or a role name), producer (the command or workflow id that produced it), granularity
  (task or phase, per Q4's decision), and entryPrecondition.
  Record each stage's output EXACTLY as it left its producer. Do not reformat, reorder, truncate or
  tidy. An output longer or messier than expected IS the finding.
  Record, per stage, whether the output came from the host or from an agent on the stub route.

DO NOT
  Read either frozen candidate record. Reconstruct a stage from the spine's prose. Synthesize a
  stage you could not run - per Q5, record it as a stated absence naming what would close it.
  Write any file under core/src/. Commit anything to core/src/ in this task.

IF THE RUN DISAGREES WITH WHAT ANYBODY REMEMBERS, THE RUN WINS. Write the disagreement into the
ticket README rather than resolving it in favour of the memory.

DONE WHEN
  The five stage records and five raw outputs exist as working notes ready for T02 to scrub and
  land, and the ticket records what the run found - including anything surprising.
  Flip THIS leaf plan's M1 header to [wip] and task 1's checklist to [x]. Do NOT touch
  specs/awsf-v2-plan.html.
```

### T02 — Scrub the captures and land them as fixtures

```
[MODEL: Sonnet 5 · EFFORT: high — mechanical work with one judgement call (timestamp normalization) that Q7 has already decided]

TASK 2 of 20. Plan: specs/awsf-v2-w11-five-stage-ladder.html, milestone M1.
PREDECESSORS: T01 is [x].

READ FIRST
  specs/awsf-v2-w11-five-stage-ladder.html - The Capture Pass, M1 task 2, and Q7's decision
  AGENTS.md - invariants 1, 9 and 10
  core/src/policy/redaction.ts - CREDENTIAL_PATTERNS, imported rather than restated
  core/test/unit/meta/no-credentials-in-fixtures.test.ts - the existing scrub predicates
  core/test/fixtures/quota-axi/ - W07's precedent for a scrubbed capture in this tree
  core/test/unit/meta/junk-drawer.test.ts - what invariant 10 actually bans

DO
  Create core/test/fixtures/stages/ and write stages.json plus S1.json through S5.json from T01's
  notes.
  Scrub per invariant 1: no session id, attempt id, run id, or real task id. Normalize every
  timestamp to ONE fixed instant - keep the field, change the value, per Q7.
  Scrub per invariant 9: nothing matching CREDENTIAL_PATTERNS.
  Replace every absolute machine path with a stable placeholder.
  Give each fixture a header field stating what it is, whether its stage ran on the host or the
  stub, and - for agent-produced stages - the one-line limit that it samples SHAPE and not CONTENT.
  Confirm no basename matches *receipt* or *manifest* and no extension is .log/.db/.sqlite.

DO NOT
  Tidy an output beyond the scrub rules above. Write any file under core/src/.

DONE WHEN
  The fixtures are committed, `git ls-files core/test/fixtures/stages/` lists six files, and
  core/src/stages/ still does not exist.
  Flip this leaf plan's task 2 checklist to [x]. Do NOT touch specs/awsf-v2-plan.html.
```

### T03 — Schema-fit every capture against the thirteen landed schemas

```
[MODEL: Opus 5 · EFFORT: high — the fit must be measured by the parser, and the temptation to read an output and decide it "looks like" a build envelope is the whole failure mode]

TASK 3 of 20. Plan: specs/awsf-v2-w11-five-stage-ladder.html, milestone M1.
PREDECESSORS: T02 is [x].

READ FIRST
  specs/awsf-v2-w11-five-stage-ladder.html - M1 task 3 and INV-2
  core/src/contracts/registry.ts - ENVELOPE_SCHEMAS and its thirteen ids
  core/src/contracts/parse-envelope.ts - the parser this task drives
  core/src/contracts/stored-envelope.ts - ValidationViolation and its five-kind vocabulary

DO
  For each of S1 through S5, drive parse-envelope.ts against EVERY id in ENVELOPE_SCHEMAS and
  record the result. The fit is measured, never judged.
  Write core/test/fixtures/stages/schema-fit.json: per stage, either { fits: "<schema-id>" } or
  { misfit: { closest: "<schema-id>", violations: [...] } } carrying the real ValidationViolation[]
  the parser produced.
  Where two schemas both validate, record both and name which one the stage's producer actually
  declares - a stage validating against a schema its producer never claims is itself a finding.

DO NOT
  Edit core/src/contracts/registry.ts. ENVELOPE_SCHEMAS keeps exactly thirteen entries and this
  task does not open that file for writing.

DONE WHEN
  schema-fit.json covers all five stages and every recorded claim was produced by the parser.
  Flip this leaf plan's task 3 checklist to [x]. Do NOT touch specs/awsf-v2-plan.html.
```

### T04 — Route every misfit to W05, and bound the block to what consumes it

```
[MODEL: Opus 5 · EFFORT: high — this is the task that keeps "adds no new mechanism" true, and the wrong move here is a small helpful edit to core/src/contracts/]

TASK 4 of 20. Plan: specs/awsf-v2-w11-five-stage-ladder.html, milestone M1.
PREDECESSORS: T03 is [x].

READ FIRST
  specs/awsf-v2-w11-five-stage-ladder.html - What This Consumes (both tables), M1 task 4, INV-2, INV-6, and Q6's decision
  specs/awsf-v2-w05-design-to-plan.html - the workstream that owns envelope schemas
  core/test/fixtures/stages/schema-fit.json - T03's output

DO
  For each misfitting stage, write the amendment request into this plan's Notes and the ticket
  README: which stage, what its output carries that no landed schema holds, which id came closest
  and by which violations, and what W05 would have to add.
  Per Q6, block ONLY the tasks that consume that stage. Mark them [f] with the block named. M1's
  remaining work, M4's fence, and M2's contract for the fitting stages all continue.
  If NO stage misfits, say so explicitly in the ticket README. "Every capture fit a landed schema"
  is the strongest possible confirmation this workstream adds no mechanism - record it as a result,
  not as a silence.

DO NOT
  Open core/src/contracts/ for editing under any circumstance. The route is a written request to
  another workstream, not a patch.

DONE WHEN
  Every misfit is routed and every block is bounded, or the no-misfit result is recorded.
  Flip this leaf plan's task 4 checklist to [x]. Do NOT touch specs/awsf-v2-plan.html.
```

### T05 — M1 Testing Strategy

```
[MODEL: Sonnet 5 · EFFORT: high — the ordering assertion in this test is what makes AC-1 mechanical rather than aspirational]

TASK 5 of 20. Plan: specs/awsf-v2-w11-five-stage-ladder.html, milestone M1.
PREDECESSORS: T01, T02, T03 and T04 are [x] (or [f] with a named block).

READ FIRST
  specs/awsf-v2-w11-five-stage-ladder.html - M1 task 5, AC-1, AC-2, AC-3
  core/src/policy/redaction.ts - CREDENTIAL_PATTERNS
  core/test/unit/meta/no-credentials-in-fixtures.test.ts - the absolute-path predicate to reuse
  core/src/contracts/registry.ts - ENVELOPE_SCHEMAS, imported for the key check

DO
  Create core/test/unit/stages/fixtures.test.ts.
  Assert every fixture parses as JSON; stages.json holds exactly five entries with contiguous
  ordinals 1-5 and all six required fields on each.
  Import CREDENTIAL_PATTERNS and reuse the existing absolute-path predicate. Do NOT write a second
  copy of either.
  Assert no value in any capture matches the shapes a session, attempt or run id takes in this
  project's own records.
  Assert schema-fit.json covers all five stages and every `fits` value is a key of ENVELOPE_SCHEMAS
  AS IMPORTED, then RE-VERIFY each `fits` claim by running the parser again. The table is checked,
  not trusted.
  Assert core/src/stages/ does not exist. T06 deletes this assertion and nothing before it does.

DONE WHEN
  npm run test:unit, npm run typecheck and npm run lint are green.
  Flip this leaf plan's task 5 checklist to [x] and the M1 header to [x]. Do NOT touch
  specs/awsf-v2-plan.html.
```

### T06 — The stage record, values only, joined to the fixture

```
[MODEL: Opus 5 · EFFORT: high — the values-only discipline and the fixture join are what stop the contract drifting back into memory]

TASK 6 of 20. Plan: specs/awsf-v2-w11-five-stage-ladder.html, milestone M2.
PREDECESSORS: M1 is [x]. The fixtures are committed.

READ FIRST
  specs/awsf-v2-w11-five-stage-ladder.html - M2 task 6, INV-1, INV-6, and Q1's decision on the name
  core/src/publish/authorize.ts - the values-only input-record idiom this file follows
  core/src/state/guards.ts - the header idiom: it decides whether, never how, and never looks
  core/src/contracts/registry.ts - ENVELOPE_SCHEMAS
  core/test/fixtures/stages/stages.json - the source of every stage name

DO
  Create core/src/stages/contract.ts declaring the five stage records with the six fields
  stages.json carries - VALUES ONLY: no handles, no paths to read, no functions, no promises.
  Declare STAGE_ORDER as a readonly tuple of the five ids and derive the stage id type from it, so
  the order and the vocabulary cannot disagree - the construction PUBLISH_REFUSAL_ORDER uses.
  TRANSCRIBE, do not generate. A generator would put a build step in the path and make the
  fixture's authority indirect; T09's equality test is the join instead.
  Each record's schemaId is a key of ENVELOPE_SCHEMAS AS IMPORTED, never a string literal typed
  twice. A stage recorded as a misfit in M1 carries no schemaId and is marked blocked.
  Imports are type-only plus ENVELOPE_SCHEMAS. No node: import, no clock, no filesystem, nothing
  from core/src/execution/**.
  Delete the "core/src/stages/ does not exist" assertion from T05's test IN THIS SAME COMMIT, so
  the barrier is lifted deliberately and visibly.

DONE WHEN
  npm run test:unit, npm run typecheck and npm run lint are green.
  Flip this leaf plan's M2 header to [wip] and task 6's checklist to [x]. Do NOT touch
  specs/awsf-v2-plan.html.
```

### T07 — The resolver: where is this project, and what does the owner do next

```
[MODEL: Opus 5 · EFFORT: high — purity is the whole property, and the easy mistake is opening a database inside the module]

TASK 7 of 20. Plan: specs/awsf-v2-w11-five-stage-ladder.html, milestone M2.
PREDECESSORS: T06 is [x].

READ FIRST
  specs/awsf-v2-w11-five-stage-ladder.html - M2 task 7, INV-5, INV-6, and the Notes on why this module sits outside core/src/workflow/
  core/src/registry/resolve.ts - ResolvedProject, the input type
  core/src/observability/queries.ts - listSessions, phasesForSession, envelopesForPhase, transitionsForSession
  core/src/stages/contract.ts - T06's output

DO
  Create core/src/stages/resolve.ts: a pure function from a ResolvedProject plus journal rows to
  { current, next, ownerAct, evidence }. Same inputs, same answer, every time. It is called nowhere
  in its own file.
  Journal rows arrive as ARGUMENTS, read by the caller through queries.ts. The resolver opens no
  database and holds no handle.
  `evidence` names the stored envelope that establishes the current stage - its schema id and the
  phase it belongs to - so the answer cites what it rests on.
  `ownerAct` is the command the owner types next, resolved from the stage contract. It is a STRING
  THE OWNER READS, and nothing in core/src executes it.
  Answer both edges: no session at all resolves to "before S1"; every stage complete resolves to
  "past S5". Neither is an error.

DO NOT
  Import anything from core/src/execution/**. Spawn. Write. Perform a lifecycle transition. Add a
  timer of any kind.

DONE WHEN
  npm run test:unit, npm run typecheck and npm run lint are green.
  Flip this leaf plan's task 7 checklist to [x]. Do NOT touch specs/awsf-v2-plan.html.
```

### T08 — The read-only readout

```
[MODEL: Sonnet 5 · EFFORT: medium — a thin command over an existing resolver, in the shape of two commands that already exist]

TASK 8 of 20. Plan: specs/awsf-v2-w11-five-stage-ladder.html, milestone M2.
PREDECESSORS: T07 is [x].

DECIDED 2026-08-26: Q2 selected the read-only readout, so THIS TASK IS COMMITTED. It is also the
one thing the owner review changed. Build it; do not treat it as optional. It settles a debt the
rest of the plan incurs - INV-4's absence is invisible in the projection, so without this readout a
stopped project and a finished one look identical.

READ FIRST
  specs/awsf-v2-w11-five-stage-ladder.html - M2 task 8, the mockup, Q2's decision, and INV-5
  core/src/cli/commands/project.ts and core/src/cli/commands/quota.ts - the two closest read-only commands
  core/src/cli/main.ts - the dispatch site
  core/test/unit/meta/no-land-route.test.ts - why no API route is added

DO
  Create core/src/cli/commands/stage.ts and wire it in main.ts beside project and quota.
  It resolves the project through the registry, reads the journal through queries.ts, calls the
  resolver, and prints.
  The rendered line for a stopped project says what stopped it and what the owner types, because
  INV-4's absence is invisible in the projection and this readout is the only thing that makes it
  legible.

DO NOT
  Add any flag that acts - no --advance, no --next, no --run. Add an API route. Print an absolute
  path.

DONE WHEN
  npm run test:unit, npm run typecheck and npm run lint are green.
  Flip this leaf plan's task 8 checklist to [x]. Do NOT touch specs/awsf-v2-plan.html.
```

### T09 — M2 Testing Strategy

```
[MODEL: Sonnet 5 · EFFORT: high — the induced drift is the point of the task, not a formality]

TASK 9 of 20. Plan: specs/awsf-v2-w11-five-stage-ladder.html, milestone M2.
PREDECESSORS: T06, T07 and T08 are [x].

READ FIRST
  specs/awsf-v2-w11-five-stage-ladder.html - M2 task 9, INV-1, INV-5
  core/test/fixtures/stages/stages.json and core/src/stages/contract.ts - the two sides of the join

DO
  Create core/test/unit/stages/contract.test.ts: contract.ts's five records are deep-equal to
  stages.json's five entries, field by field, in order. STAGE_ORDER has five members matching the
  fixture's ordinals, and every schemaId present is a key of ENVELOPE_SCHEMAS.
  Create core/test/unit/stages/resolve.test.ts: the resolver at each of the five positions plus
  both edges, over canned journal rows built in the test rather than read from a database. Add a
  purity assertion: two calls with the same inputs return deep-equal answers and leave the inputs
  unmodified.
  PROVE THE JOIN BITES: rename one stage in contract.ts only, watch contract.test.ts go red,
  restore it, watch it go green. Record the exact failure text in the ticket.
  A readout test over a canned projection asserting the printed output contains no absolute path,
  and that the command exposes no acting flag.

DONE WHEN
  npm run test:unit, npm run typecheck and npm run lint are green, and the induced drift is
  recorded.
  Flip this leaf plan's task 9 checklist to [x] and the M2 header to [x]. Do NOT touch
  specs/awsf-v2-plan.html.
```

### T10 — Enumerate the four boundaries and name what holds each

```
[MODEL: Opus 5 · EFFORT: high — three different mechanisms across four boundaries is a normal result and smoothing it into one is the error]

TASK 10 of 20. Plan: specs/awsf-v2-w11-five-stage-ladder.html, milestone M3.
PREDECESSORS: M2 is [x].

READ FIRST
  specs/awsf-v2-w11-five-stage-ladder.html - The Stops in full, M3 task 10, INV-4, AC-4, and Q3's decision
  core/src/state/task-machine.ts - TASK_STATES, LEGAL_EDGES, spawnSite, and the AWAITING_OWNER edges
  core/test/fixtures/stages/stages.json - the five stages the boundaries sit between

DO
  Write core/test/fixtures/stages/boundaries.json: four rows, each naming the earlier stage, the
  later stage, which of the three mechanisms holds it - terminal-seal, awaiting-owner, or no-path -
  and the owner act that crosses it.
  Derive the mechanism from what M1's run actually showed, not from what would be tidiest.
  For a terminal-seal row: name the terminal state and confirm against LEGAL_EDGES AS IMPORTED that
  no edge leaves it with spawnSite: true.
  For an awaiting-owner row: name the stopping edge and confirm every edge out of AWAITING_OWNER
  carries actor human or owner.
  For a no-path row: name the host command that returns and state what would have had to exist for
  the next stage to begin.

DO NOT
  Write core/src/state/**. It is a protected path; this task reads and enumerates it.

DONE WHEN
  boundaries.json holds four rows, each with its mechanism confirmed against the edge table.
  Flip this leaf plan's M3 header to [wip] and task 10's checklist to [x]. Do NOT touch
  specs/awsf-v2-plan.html.
```

### T11 — The static scan: nothing in core/src advances a stage

```
[MODEL: Opus 5 · EFFORT: high — a transitive walk, because a direct-import scan is satisfied by one intermediate file]

TASK 11 of 20. Plan: specs/awsf-v2-w11-five-stage-ladder.html, milestone M3.
PREDECESSORS: T10 is [x].

READ FIRST
  specs/awsf-v2-w11-five-stage-ladder.html - M3 task 11 and INV-4
  core/test/unit/meta/no-land-route.test.ts - the absence-scan idiom, offenders reported as an empty list
  core/test/unit/meta/quota-fence.test.ts - the transitive relative-import walk
  specs/awsf-v2-w07-quota-telemetry.html - why a stop with a timer behind it is not a stop

DO
  Create core/test/unit/meta/no-stage-advance.test.ts.
  Assert nothing reachable from core/src/stages/** imports the transport broker, the process
  controller, or any spawn site - following the TRANSITIVE walk, not a direct-import check.
  Assert no timer primitive - setTimeout, setInterval, setImmediate, or a scheduled callback -
  appears anywhere under core/src/stages/**.
  Assert `awsf stage` exposes no flag whose effect is to start the next stage. Check the parsed
  flag list, not prose in a help string.
  Write the header stating what this fence buys and what it does not: it proves no advancing path
  exists in core/src, and it says nothing about what a person types.

DONE WHEN
  npm run test:unit, npm run typecheck and npm run lint are green.
  Flip this leaf plan's task 11 checklist to [x]. Do NOT touch specs/awsf-v2-plan.html.
```

### T12 — M3 Testing Strategy

```
[MODEL: Opus 5 · EFFORT: high — four behavioural tests on the stub route, plus proving the static scan bites]

TASK 12 of 20. Plan: specs/awsf-v2-w11-five-stage-ladder.html, milestone M3.
PREDECESSORS: T10 and T11 are [x].

READ FIRST
  specs/awsf-v2-w11-five-stage-ladder.html - M3 task 12, The Stops, INV-4, AC-4
  core/test/journeys/t2-production.test.ts - the RouteLog idiom that records every provider contacted
  core/test/unit/cli/design-to-plan-route.test.ts - the offline world()
  core/test/fixtures/stages/boundaries.json - T10's output

DO
  Create core/test/unit/stages/stops.test.ts: four tests, one per boundary, each driving the earlier
  stage to completion in a temporary directory on the stub route.
  Each test asserts THE ABSENCE TRIPLE after completion: listSessions returns no session beyond the
  ones the earlier stage created; no new attempt directory exists on disk; the route log recorded no
  provider launch.
  Each test also asserts the mechanism boundaries.json names for that row is the mechanism actually
  in play. A row claiming terminal-seal whose stage ends in AWAITING_OWNER is a wrong row and goes
  red.
  Add a wait-and-see assertion at one boundary: after the earlier stage completes, advance nothing
  and re-observe the triple a second time, so a deferred advance has somewhere to show up.
  PROVE THE STATIC SCAN BITES: add a setTimeout under core/src/stages/ in a throwaway edit, watch
  no-stage-advance.test.ts go red, remove it, watch it go green. Record the exact failure text.

DONE WHEN
  npm run test:unit, npm run typecheck and npm run lint are green, with no network and no quota.
  Flip this leaf plan's task 12 checklist to [x] and the M3 header to [x]. Do NOT touch
  specs/awsf-v2-plan.html.
```

### T13 — Fence leg one: the composed prompt carries no skill-invocation shape

```
[MODEL: Opus 5 · EFFORT: high — scanning the composed bytes rather than one role fragment is what makes this leg mean anything]

TASK 13 of 20. Plan: specs/awsf-v2-w11-five-stage-ladder.html, milestone M4.
PREDECESSORS: M2 is [x]. M4 does not wait on M3.

READ FIRST
  specs/awsf-v2-w11-five-stage-ladder.html - No Skill In The Path in full, M4 task 13, INV-3
  core/src/workflow/prompt-composition.ts - W06's single composition site
  core/test/unit/meta/prompt-composition-site.test.ts - the fence that keeps it single
  core/test/unit/meta/execution-isolation.test.ts - read its header; it states exactly what it does and does not cover

DO
  Create core/test/unit/meta/no-skill-in-stages.test.ts.
  For every stage in the contract whose owner is a role rather than the host, resolve its prompt
  THROUGH W06's single composition site, so the scan reads the bytes that actually reach a provider.
  Assert the composed bytes contain no leading-slash command invocation, no SKILL.md, no skills/
  path segment, and no .claude path.
  Assert the composed bytes contain no instruction of the form "read <document> before" - the shape
  that makes a phase depend on a document without ever naming a skill. Keep the pattern list short,
  name each one in a comment, and state in the header that it catches shapes rather than intentions.
  Report offenders as file plus matched text.

DONE WHEN
  npm run test:unit, npm run typecheck and npm run lint are green.
  Flip this leaf plan's M4 header to [wip] and task 13's checklist to [x]. Do NOT touch
  specs/awsf-v2-plan.html.
```

### T14 — Fence leg two: nothing reachable from the stage module reaches a document tree

```
[MODEL: Opus 5 · EFFORT: high — the transitive walk is the technique; a direct scan here would be a fence that passes while the violation exists]

TASK 14 of 20. Plan: specs/awsf-v2-w11-five-stage-ladder.html, milestone M4.
PREDECESSORS: T13 is [x].

READ FIRST
  specs/awsf-v2-w11-five-stage-ladder.html - M4 task 14, INV-3, INV-5
  core/test/unit/meta/quota-fence.test.ts - this repository's first transitive fence, and its header explaining why
  core/test/unit/meta/execution-isolation.test.ts - what it already covers
  core/test/unit/meta/_driving.ts - the driving-document tree constants

DO
  Extend no-skill-in-stages.test.ts with the import leg, following quota-fence.test.ts's transitive
  relative-import walk.
  Assert nothing transitively reachable from core/src/stages/** resolves a path into docs/driving/**
  or any .claude path, and report EVERY HOP of an offending chain rather than only the endpoint.
  Assert the same reach contains no import from core/src/execution/** - INV-5's absence, which
  shares this walk for free.
  Restate in the header what execution-isolation.test.ts already covers (pi's pinned --no-skills
  argv order, and the absence of .claude/ at the repository root) and what this fence adds that
  neither of those asserts, so a later reader does not delete one believing the other covers it.

DONE WHEN
  npm run test:unit, npm run typecheck and npm run lint are green.
  Flip this leaf plan's task 14 checklist to [x]. Do NOT touch specs/awsf-v2-plan.html.
```

### T15 — Fence leg three: no gate reaches its verdict by reading a file

```
[MODEL: Opus 5 · EFFORT: max — the hardest leg, the one that catches the failure the standing constraint is actually written against, and the one a reviewer will want cut]

TASK 15 of 20. Plan: specs/awsf-v2-w11-five-stage-ladder.html, milestone M4.
PREDECESSORS: T14 is [x].

READ FIRST
  specs/awsf-v2-w11-five-stage-ladder.html - No Skill In The Path, M4 task 15, INV-3, and Q8's decision
  core/src/gates/interface.ts - the gate contract and its context shape
  core/src/gates/architecture-review.ts and core/src/gates/design-spine.ts - W05's envelope-only gates
  core/src/gates/git-diff.ts and core/src/gates/command-evidence.ts - gates that legitimately observe the repository, and why Q8 scopes this leg away from them
  core/test/unit/meta/quota-fence.test.ts - the TypeScript AST technique

DO
  For every gate the stage contract names, walk its run closure and that closure's transitive reach
  with the TypeScript AST, and assert no filesystem read appears - no readFile, no readFileSync, no
  existsSync, no directory walk.
  SCOPE THE FENCE TO THIS WORKSTREAM'S OWN GATES, per Q8. Widening it to all gates would fail on day
  one for a reason that is not a defect.
  Assert POSITIVELY as well: each named gate's inputs are drawn from context.envelope,
  context.previousEnvelope, or host-resolved evidence passed in as an argument. A gate reading an
  ambient value is the same defect wearing different clothes.
  Write the header stating the limit plainly: this proves a gate does not READ a document. It does
  not prove the document is irrelevant to whoever wrote the gate, and no test can.

DONE WHEN
  npm run test:unit, npm run typecheck and npm run lint are green.
  Flip this leaf plan's task 15 checklist to [x]. Do NOT touch specs/awsf-v2-plan.html.
```

### T16 — M4 Testing Strategy

```
[MODEL: Sonnet 5 · EFFORT: high — three induced failures, each with its message recorded; a fence nobody has watched fail is decoration]

TASK 16 of 20. Plan: specs/awsf-v2-w11-five-stage-ladder.html, milestone M4.
PREDECESSORS: T13, T14 and T15 are [x].

READ FIRST
  specs/awsf-v2-w11-five-stage-ladder.html - M4 task 16 and AC-5
  specs/awsf-v2-candidates-fuse-version.md - section 10.3, where the plan-aware sync fence was proven with a ghost ticket directory

DO
  INDUCE LEG ONE: add a skill-shaped line to one stage's role prompt in a throwaway edit, watch the
  suite go red naming that prompt, revert, watch it go green.
  INDUCE LEG TWO: add an import chain from core/src/stages/ reaching docs/driving/ THROUGH ONE
  INTERMEDIATE FILE - the shape a direct scan would miss - watch it go red naming every hop, revert,
  watch it go green.
  INDUCE LEG THREE: add a readFileSync to one gate closure, watch it go red, revert, watch it go
  green.
  Record all three observations in the ticket WITH THE EXACT FAILURE TEXT each produced. An induced
  failure whose message does not identify the offender is a fence that will waste an hour the day it
  fires for real - if that happens, improve the message before closing this task.

DONE WHEN
  All three violations are removed and npm run test:unit, npm run typecheck and npm run lint are
  green.
  Flip this leaf plan's task 16 checklist to [x] and the M4 header to [x]. Do NOT touch
  specs/awsf-v2-plan.html.
```

### T17 — The world: one temporary directory, five stages, scripted adapters

```
[MODEL: Opus 5 · EFFORT: max — the longest journey in the repository, and the one that has to stay fast enough that people run it]

TASK 17 of 20. Plan: specs/awsf-v2-w11-five-stage-ladder.html, milestone M5.
PREDECESSORS: M3 and M4 are both [x].

READ FIRST
  specs/awsf-v2-w11-five-stage-ladder.html - M5 task 17 and AC-6
  core/test/unit/cli/design-to-plan-route.test.ts - the offline world() this EXTENDS
  core/test/journeys/t2-production.test.ts - the RouteLog idiom and the scripted-adapter shape
  core/test/journeys/publish.test.ts - the bareFixture helper, if publication is one of the stages
  core/src/cli/commands/init.ts - stage one's producer if the capture says so

DO
  Create core/test/journeys/five-stage.test.ts, EXTENDING the existing offline world(). Do not
  invent a second harness.
  Begin from an empty directory through W03's initCommand, so the journey covers the bootstrap
  rather than starting from a repository that already exists.
  Every agent phase runs on the stub adapter with a scripted envelope. No live provider, no network,
  no quota anywhere in the file.
  If publication is one of the five stages, its remote is a bare repository created in the temporary
  directory.
  Where Q5's absence applies, cover the four reachable stages, mark the fifth [f], and name the
  blocker in the test's own header rather than skipping silently.

DONE WHEN
  npm run test:journeys is green and the new file's runtime is recorded in the ticket.
  Flip this leaf plan's M5 header to [wip] and task 17's checklist to [x]. Do NOT touch
  specs/awsf-v2-plan.html.
```

### T18 — The envelope join at each boundary

```
[MODEL: Opus 5 · EFFORT: high — comparing by shape rather than by bytes is the difference between a join test and a snapshot of a scripted adapter]

TASK 18 of 20. Plan: specs/awsf-v2-w11-five-stage-ladder.html, milestone M5.
PREDECESSORS: T17 is [x].

READ FIRST
  specs/awsf-v2-w11-five-stage-ladder.html - M5 task 18, AC-6, INV-2
  core/src/observability/queries.ts - envelopesForPhase
  core/test/fixtures/stages/S1.json through S5.json - the captured shapes

DO
  At each boundary, read the stored envelope from the projection through envelopesForPhase and
  assert its schema id equals the one that stage's record in the contract names.
  Compare against the captured fixture BY SHAPE, NOT BYTES: the schema id and the presence of every
  required field. The captured bytes are one run's output; asserting them would make the journey a
  snapshot test of a scripted adapter, which proves nothing about the join.
  Assert the later stage's input is derived from the earlier stage's STORED ENVELOPE, and that
  nothing in the chain reconstructs a value from a file the earlier stage happened to write.
  Record the route log at the end and assert it contains no provider launch beyond the scripted
  stub, using the RouteLog idiom rather than a count.

DONE WHEN
  npm run test:journeys is green.
  Flip this leaf plan's task 18 checklist to [x]. Do NOT touch specs/awsf-v2-plan.html.
```

### T19 — M5 Testing Strategy

```
[MODEL: Sonnet 5 · EFFORT: high — the surrounding evidence: it cost nothing, touched nothing, and left the suite where it found it]

TASK 19 of 20. Plan: specs/awsf-v2-w11-five-stage-ladder.html, milestone M5.
PREDECESSORS: T17 and T18 are [x].

READ FIRST
  specs/awsf-v2-w11-five-stage-ladder.html - M5 task 19, AC-6, AC-7, INV-6
  awsf.config.yaml - policy.protected_paths, enumerated from the loaded config rather than copied

DO
  npm run test:journeys green, with the new file's runtime recorded. A journey that takes minutes is
  a journey nobody runs.
  Add a no-network assertion: nothing in the file resolves a hostname or opens a socket, and the
  only remote any part of it knows is a path inside the temporary directory.
  Add a no-residue assertion: after the test, the temporary directory is removed and nothing was
  written inside this repository's own tree or state root.
  AC-7's protected-path check: enumerate policy.protected_paths FROM THE LOADED CONFIG and assert
  the workstream's changed-file list intersects none of them. Never from a copied glob list, so a
  glob added later is covered without editing this check.
  npm run test - the full suite - green, with the count recorded alongside the command that produced
  it.

DONE WHEN
  Every command above is green and its count is recorded.
  Flip this leaf plan's task 19 checklist to [x] and the M5 header to [x]. Do NOT touch
  specs/awsf-v2-plan.html.
```

### T20 — Close the leaf, then close the spine

```
[MODEL: Sonnet 5 · EFFORT: medium — the only task permitted to touch the spine, and it earns that by checking everything below it first]

TASK 20 of 20. Plan: specs/awsf-v2-w11-five-stage-ladder.html, milestone M6.
PREDECESSORS: M1 through M5 are all [x], or [f] with a named blocker.

READ FIRST
  specs/awsf-v2-w11-five-stage-ladder.html - M6 task 20, and every milestone header
  specs/awsf-v2-plan.html - the W11 block
  specs/tickets/awsf-v2-plan/W11.md - the spine ticket
  AGENTS.md - invariants 2, 11 and 12

DO
  Confirm every milestone header and every checklist item in this leaf plan is [x], or [f] with its
  blocker named in the Amendments. A silent [] anywhere means this task is not ready to run.
  Confirm every ticket's state: in specs/tickets/awsf-v2-w11-five-stage-ladder/ mirrors this plan's
  markers.
  npm run test, npm run typecheck, npm run lint - all green, with the counts recorded.
  core/test/unit/meta/ticket-plan-sync.test.ts green, resolving this plan through the registered
  plan source.
  Append the modified date and an Amendment recording WHAT M1'S CAPTURE ACTUALLY FOUND - the stage
  list, and whether any stage misfitted. That finding is the workstream's most reusable output and
  it must not live only in a fixture.
  ONLY NOW: flip the W11 marker in specs/awsf-v2-plan.html and the state in
  specs/tickets/awsf-v2-plan/W11.md, in the same commit.

DO NOT
  Name an agent, model or AI tool in commit identity or message.

DONE WHEN
  The spine's W11 marker is [x] and every command above is green.
```
