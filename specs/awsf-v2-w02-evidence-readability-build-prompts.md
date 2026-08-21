# Build Prompts — AWSF v2 W02, evidence readability

Companion to [`awsf-v2-w02-evidence-readability.html`](./awsf-v2-w02-evidence-readability.html). Created
2026-08-20 alongside the plan and
[`tickets/awsf-v2-w02-evidence-readability/`](./tickets/awsf-v2-w02-evidence-readability/).

**These prompts write implementation code.** This is the deep plan for spine workstream W02, and
these five prompts build it — one per **task**, matching the plan's own `<h4>` numbering, the same
granularity `awsf-v2-w01-marimba-contract-build-prompts.md` uses (nine task prompts across five
milestones there; five task prompts across four milestones here). Each prompt is **self-contained**
and written for a **fresh session with no prior context**. Copy one, paste it, let it run to
completion, review what it produced, clear context, move to the next.

---

## Before anything: one gate — cleared

**Owner approval of this deep plan.** All three Questionables (Q1 credential-pattern location, Q2
rendered-view depth, Q3 card-height fix shape) were **decided 2026-08-21**, each taking the
recommended option, via an exported `plan-sota-review v1` block — see the plan's Amendments. No
prompt below changes shape as a result, since every one already built toward the recommended
option; task 2's opening check (confirm Q1 is decided) now passes rather than blocks.

---

## Decisions already made — do not re-litigate these

| # | Decision | Status |
|---|---|---|
| D1 | **Reassembly is semantically equal to the stored envelope, not byte-identical.** A folded row's rendered text may say it reconstructs the phase output; it may never claim to *be* the stored envelope. | measured 2026-08-20, in the plan's Solution and Phase 2 |
| D2 | **Storage-layer compaction is out of scope, permanently.** Nothing in this plan proposes dropping a `text.delta` row from the database. Folding is a display-time operation only. | spine W02 scope, restated in Notes |
| D3 | **The fold is defined on the literal string `"text.delta"`, never a category of "delta kinds."** Invariant 9 — `thinking.delta` is already excluded upstream by `isPersistableKind`; this plan's fold adds a defensive second guarantee at its own boundary. | Collision 2, Phase 2 |
| D4 | **No screenshot, run id, or session id from the twelve source captures is quoted anywhere in this repository.** Invariant 1. Every test fixture in this plan is synthetic. | Collision 3, spine and this plan's Notes |
| D5 | **`formatCost`'s eighteen pinning assertions are extended, never perturbed.** New formatters are additive exports to `display.ts`; nothing about `formatCost`'s signature or body changes. | spine constraint, task 1 |
| D6 | **The clipped-card fix changes only `.card-wrap`'s declared height.** `.card-metrics-grid` gets no scrolling or clipping of its own — `dashboard-parity.test.ts` already asserts against that. | task 5 |

---

## Model selection

`EFFORT` is the session-level reasoning control (`/effort low|medium|high|xhigh|max`), calibrated to
the hardest judgement in the task. No prompt in this file fans out to sub-agents — each task is one
component or one module plus its test file, small enough that fan-out overhead would exceed the
savings.

| Task | Milestone | Model | Effort | Why |
|---|---|---|---|---|
| 1 — Per-kind summarisers, plus Testing Strategy | M1 | Sonnet 5 | medium | mechanical dispatch-table work against fields already named in the plan field-by-field |
| 2 — Write the fold module | M2 | Sonnet 5 | high | the boundary conditions (contiguity, run-closing, the Q1-gated re-redaction call) are security-relevant and need care |
| 3 — The fold's boundary and redaction tests, plus Testing Strategy | M2 | Sonnet 5 | high | the split-credential fixture is adversarial by design — it must actually try to defeat task 2's adaptation, not merely restate it |
| 4 — Rendered view, plus Testing Strategy | M3 | Sonnet 5 | medium | reuses a proven precedent (`PhaseInspector.vue`'s toggle) with no new mechanism to design |
| 5 — Clipped run cards, plus Testing Strategy | M4 | Sonnet 5 | low | one CSS value change plus a regex test update |

---

## Conventions used by every prompt

**Marker discipline — read this once, it applies five times.**

- **Flip THIS plan's markers on every task, including the first.** In
  `specs/awsf-v2-w02-evidence-readability.html`: the milestone's `<h3>` marker to `[wip]` when you
  start its first task and `[x]` when the milestone's last task's checklist is fully green, and each
  checklist `<code class="status">` item in your task as you complete it. Flip the matching ticket's
  `state:` in `specs/tickets/awsf-v2-w02-evidence-readability/` **in the same commit** — AGENTS.md
  invariant 12.
- **Do NOT flip the spine's W02 marker** in `specs/awsf-v2-plan.html`, or `W02.md`'s state in
  `specs/tickets/awsf-v2-plan/`, until **task 5**. Task 5 is the only task that touches them.
- Both halves matter. A session that reads only the negative leaves every marker alone, and the next
  task's "confirm the prior task is `[x]`" precondition fails for no reason.
- Append the date to the plan's `modified` metadata row and add an Amendment entry with the commit
  SHA when your task completes. Never overwrite a metadata row; every one of them is append-only.

**Read first, every time.** `specs/awsf-v2-w02-evidence-readability.html` — your milestone and task
in full, plus the Problem and Solution sections · `AGENTS.md` — invariants 1, 9, 10, 11 in particular
· this file's Decisions table above · the files your task's checklist names. There is no
`docs/TESTING.md` in this repository; each prompt below names the specific existing suite to extend.

**Never, in any of the five.**

- Never propose or implement storage-layer compaction. Every `text.delta` row stays in the database
  exactly as it is today — this plan only changes how already-fetched rows are rendered.
- Never write a fold rule over a category of "delta kinds." The literal string `"text.delta"` is the
  only test the fold predicate may use.
- Never quote a screenshot, run id, session id, or machine path from this workstream's source
  material into a fixture, a test, or this repository. Every fixture is synthetic.
- Never touch `formatCost`'s existing body or signature. Add new exports; do not edit that function.
- Never let a test `skip`. A fence that skips reports green and catches nothing.
- Never name an agent, model or AI tool as commit author, committer or co-author — invariant 11.
- Never add a dependency. The allowlist is invariant 7 and it is enforced.

---

# Section B — Task prompts (recommended)

Five prompts, one per task, in plan order. Task 1 is milestone M1, tasks 2–3 are M2, task 4 is M3,
and task 5 is M4. The ticket for each is
`specs/tickets/awsf-v2-w02-evidence-readability/T<nn>.md`, carrying the same prompt verbatim.

### T01 — Per-kind summarisers, plus Testing Strategy

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  WHY     dispatch-table work against fields the plan already names field-by-field.

TASK 1 of 5. Plan: specs/awsf-v2-w02-evidence-readability.html, milestone M1.
PREDECESSORS: none. This is the first task.

READ FIRST
  specs/awsf-v2-w02-evidence-readability.html - milestone M1 in full, plus Problem and Solution
  dashboard/src/components/EventLog.vue - summary(), the five-key chain being replaced
  dashboard/src/display.ts - the thirteen existing exports; formatUsage, formatTokens,
    costAuthorityLabel, modelProvenanceLabel are reused, formatCost is NOT touched
  dashboard/shared/types.ts - EventItem, the shape every summariser consumes
  core/src/observability/projector.ts - applyEvent(), to confirm which literal `type` strings
    actually reach the events table (tool_call, text.delta, usage, quota, notice, run.started,
    model.resolved, run.completed, run.failed, run.cancelled, compiled_prompt, ceiling_grant)
  core/test/unit/dashboard-display.test.ts - the runtime-import test pattern to follow for the
    new test file; this is a real Node test importing pure functions, not a source-regex check

DO
  Create dashboard/src/event-summary.ts exporting summarizeEvent(item: EventItem): string,
  dispatching on item.type to one internal function per kind (exported individually so tests
  can call them directly). Implement all twelve kinds plus the em-dash fallback exactly as
  task 1's checklist specifies field-by-field. Add formatUsageBreakdown to display.ts as a new,
  additive export. Wire EventLog.vue to call summarizeEvent(event) in place of summary(); delete
  summary(). Create core/test/unit/dashboard-event-summary.test.ts with one test per kind plus
  the fallback case, following dashboard-display.test.ts's runtime-import pattern.

DO NOT
  Touch formatCost's body or signature. Implement folding (task 2/3) or the rendered/raw toggle
  (task 4) - this task only replaces the summary line. Flip the spine's W02 marker.

STOP WHEN
  All of task 1's checklist items are checked, dashboard-event-summary.test.ts is green,
  dashboard-display.test.ts's eighteen formatCost assertions are unchanged and green,
  dashboard-mechanics.test.ts and dashboard-parity.test.ts stay green, and vue-tsc is clean.
```

### T02 — Write the fold module

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT high
  CLAUDE  claude:sonnet · /effort high
  GPT     codex:gpt-5.6-terra · reasoning high
  WHY     the fold's contiguity boundary and the Q1-gated re-redaction call are security-relevant
          and need care even before the adversarial fixture in task 3 tries to defeat them.

TASK 2 of 5. Plan: specs/awsf-v2-w02-evidence-readability.html, milestone M2.
PREDECESSORS: Task 1 must be [x] in specs/awsf-v2-w02-evidence-readability.html before this
  task starts. Confirm it before touching any file.

BEFORE YOU START
  Questionable Q1 in the plan's Questionables section must be decided by the owner - it fixes
  the location of the shared credential-matching predicate this task needs. If it is still
  undecided when you start, stop and surface that rather than guessing; do not implement the
  re-redaction call against a location the owner has not approved.

READ FIRST
  specs/awsf-v2-w02-evidence-readability.html - milestone M2 in full: the correction on
    reassembly (semantically equal, NOT byte-identical), Collision 1, Collision 2, and Q1
  dashboard/src/components/EventLog.vue - the load() paging loop; confirm the full ordered
    events array is already in memory client-side before any fold would run
  dashboard/shared/types.ts - EventItem, especially firstSourceSeq/lastSourceSeq/runId, which
    the fold's contiguity check is built on
  core/src/policy/redaction.ts - CREDENTIAL_PATTERNS, containsCredential, scrubCredentialString;
    read in full regardless of Q1's outcome, since the predicate's behaviour must match exactly
  core/src/contracts/normalized-events.ts - isPersistableKind, TERMINAL_EVENT_KINDS

DO
  Create dashboard/src/delta-fold.ts exporting foldTextDeltaRuns(events: EventItem[]):
  DisplayRow[] exactly as task 2's checklist specifies: a run starts and continues only on the
  literal type "text.delta", same runId, strict firstSourceSeq contiguity; closing a run
  concatenates payload.text in order and applies the credential-matching predicate (at the
  location Q1 decided) to the concatenated string before returning it. Wire EventLog.vue to
  render folded rows.

  If Q1 was decided as option A: move CREDENTIAL_PATTERNS, containsCredential and
  scrubCredentialString into dashboard/shared/credential-patterns.ts and update
  core/src/policy/redaction.ts to import them from there rather than declaring its own copy;
  widen dashboard/tsconfig.json's include list only if the import actually requires it.
  If option B or C: follow the plan's Notes on what each implies instead.

DO NOT
  Fold across a tool_call, a terminal event, or a runId boundary, under any circumstance.
  Write a fold predicate over anything broader than the literal string "text.delta". Propose
  or implement any storage-layer change - the database keeps every row. Write task 3's test
  file yet - this task ends once the module and its wiring exist; the adversarial fixture is
  a separate task so it is written and reviewed as its own unit of work. Flip the spine's W02
  marker.

STOP WHEN
  All of task 2's checklist items are checked, dashboard/src/delta-fold.ts exists and exports
  foldTextDeltaRuns with the Q1-decided re-redaction call in place, EventLog.vue renders folded
  rows, and vue-tsc is clean. Task 2 does not require dashboard-delta-fold.test.ts to exist yet
  - that is task 3.
```

### T03 — The fold's boundary and redaction tests, plus Testing Strategy

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT high
  CLAUDE  claude:sonnet · /effort high
  GPT     codex:gpt-5.6-terra · reasoning high
  WHY     the split-credential fixture must be written to genuinely try to defeat task 2's
          re-redaction call, not merely restate it - an adversarial-test task warrants the
          same care as the code it is testing.

TASK 3 of 5. Plan: specs/awsf-v2-w02-evidence-readability.html, milestone M2.
PREDECESSORS: Task 2 must be [x] in specs/awsf-v2-w02-evidence-readability.html before this
  task starts. Confirm it before touching any file.

READ FIRST
  specs/awsf-v2-w02-evidence-readability.html - milestone M2 in full, task 3's checklist
  dashboard/src/delta-fold.ts - as task 2 left it; read the actual fold predicate and the
    re-redaction call before writing fixtures against them
  core/src/contracts/normalized-events.ts - isPersistableKind, TERMINAL_EVENT_KINDS
  core/test/unit/observability/projector.test.ts - the existing server-side thinking.delta
    assertion this task's client-side test adds to, not replaces
  core/src/policy/redaction.ts (or dashboard/shared/credential-patterns.ts if Q1 moved it) -
    the exact CREDENTIAL_PATTERNS the split-credential fixture must defeat if it can

DO
  Create core/test/unit/dashboard-delta-fold.test.ts covering: a contiguous fold; a tool_call
  breaking a fold in two; a terminal event closing a fold; the defensive thinking.delta
  fixture; and the split-credential fixture (two adjacent chunks whose credential-shaped value
  is invisible in either alone, complete once joined - assert the folded row's reassembledText
  is redacted). Run the full set named in task 3's Testing Strategy checklist, including the
  untouched projector.test.ts assertion and the dashboard-mechanics/parity suites.

DO NOT
  Weaken or work around task 2's fold predicate or re-redaction call to make a test pass - if a
  fixture reveals a real gap, fix task 2's module and say so, do not adjust the fixture to stop
  triggering it. Quote any real run id, session id, or screenshot content into a fixture; every
  fixture is synthetic. Flip the spine's W02 marker.

STOP WHEN
  All of task 3's checklist items are checked, dashboard-delta-fold.test.ts is green including
  the split-credential fixture, projector.test.ts's existing assertion is unchanged and green,
  dashboard-mechanics.test.ts and dashboard-parity.test.ts stay green, and vue-tsc is clean.
```

### T04 — Rendered view beside the raw JSON, plus Testing Strategy

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  WHY     reuses PhaseInspector.vue's proven toggle precedent; no new mechanism to design.

TASK 4 of 5. Plan: specs/awsf-v2-w02-evidence-readability.html, milestone M3.
PREDECESSORS: Task 3 must be [x] in specs/awsf-v2-w02-evidence-readability.html before this
  task starts. Confirm it before touching any file.

READ FIRST
  specs/awsf-v2-w02-evidence-readability.html - milestone M3 in full, and its mockup figure
  dashboard/src/components/PhaseInspector.vue - the view-toggle / rawPrompts precedent this
    task imitates: lines ~74-82 (the button pair, the rawPrompts Set, the default state)
  core/test/unit/dashboard-parity.test.ts - the existing rendered-safe / >raw< assertions
    against PhaseInspector.vue, which prove the pattern already works and is already tested
  dashboard/src/components/EventLog.vue - as left by task 1 (summarizeEvent) and tasks 2-3
    (foldTextDeltaRuns / folded rows), both of which this task's rendered view calls into

DO
  Add a rawRows reactive Set to EventLog.vue mirroring PhaseInspector.vue's rawPrompts. On an
  expanded row, render a view-toggle button pair labelled "rendered" / "raw"; default (row id
  not in rawRows) is rendered. Rendered view calls summarizeEvent(row) for an ordinary row or
  row.reassembledText for a folded row - the same functions the collapsed-row summary already
  calls, so the two views can never disagree. Raw view stays JSON.stringify(row.payload, null,
  2) for an ordinary row; for a folded row it shows the array of the individual chunk payloads
  it was built from. Extend core/test/unit/dashboard-mechanics.test.ts's existing "event paging
  and settings expose required read-only, text-labelled surfaces" test with assertions for
  view-toggle, both button labels, and the rendered default.

DO NOT
  Build a second, richer per-kind detail panel unless Questionable Q2 was decided as option B -
  the default build is the one-line summary reused, per Q2's recommended option A. Introduce
  v-html or any unescaped rendering of payload content - summarizeEvent already returns plain
  text. Flip the spine's W02 marker.

STOP WHEN
  All of task 4's checklist items are checked, the extended dashboard-mechanics.test.ts and
  dashboard-parity.test.ts are green, vue-tsc is clean, and a manual dev-server check (via the
  run skill) confirms rendered is the default and raw is one click away for both an ordinary
  and a folded row.
```

### T05 — Fix the clipped run cards, plus Testing Strategy

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT low
  CLAUDE  claude:sonnet · /effort low
  GPT     codex:gpt-5.6-terra · reasoning low
  WHY     one CSS value change plus a regex test update; the only task not about the event log.

TASK 5 of 5. Plan: specs/awsf-v2-w02-evidence-readability.html, milestone M4.
PREDECESSORS: Task 4 must be [x] in specs/awsf-v2-w02-evidence-readability.html before this
  task starts. Confirm it before touching any file. This is the ONLY task that also flips the
  spine's W02 marker - see below.

READ FIRST
  specs/awsf-v2-w02-evidence-readability.html - milestone M4 in full, and Questionable Q3
  dashboard/src/styles/dashboard.css - .card-wrap, .session-card, .card-metrics-grid
    (lines ~82-134): the fixed 420px height, overflow: hidden, and the fifth
    partial-metric row's v-if condition
  dashboard/src/components/SessionCard.vue - the card-metrics-grid template, in particular the
    fifth <div v-if="session.usage.costPartial">
  core/test/unit/dashboard-parity.test.ts - the existing assertion that card-metrics-grid never
    gets overflow: hidden|auto; this task's fix must not need to touch that assertion

DO
  In dashboard/src/styles/dashboard.css, change .card-wrap's height from 420px to 452px, per
  Questionable Q3's recommended option A. Do not add overflow or scrolling to
  card-metrics-grid. Extend core/test/unit/dashboard-mechanics.test.ts's existing .card-wrap /
  .session-card assertions to require the new height value.

MARKER DISCIPLINE FOR THIS TASK ONLY
  This is the plan's final task. In addition to this plan's own task 5 markers, its milestone
  M4 marker, and T05's ticket state, ALSO flip the spine's W02 marker to [x] in
  specs/awsf-v2-plan.html and W02.md's state in specs/tickets/awsf-v2-plan/ - in the same
  commit as this task's other marker flips. Add the spine's own Amendment entry too. No earlier
  task touches either of these two files.

DO NOT
  Remove .session-card's overflow: hidden. Add overflow or scroll behaviour to
  .card-metrics-grid - dashboard-parity.test.ts already forbids it. Flip the spine's W02 marker
  before this task, or flip any OTHER spine workstream's marker.

STOP WHEN
  All of task 5's checklist items are checked, dashboard-mechanics.test.ts and
  dashboard-parity.test.ts are green, a manual dev-server check (via the run skill) confirms a
  costPartial: true session card shows all five metrics rows uncut, the plan's own Validation
  Commands section is fully checked, and the spine's W02 marker is [x].
```
