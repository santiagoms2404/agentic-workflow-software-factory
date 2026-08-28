# Build Prompts — AWSF v2 W12, The non-technical cheatsheet

Companion to [`awsf-v2-w12-cheatsheet.html`](./awsf-v2-w12-cheatsheet.html) and
[`tickets/awsf-v2-w12-cheatsheet/`](./tickets/awsf-v2-w12-cheatsheet/). Created 2026-08-27,
revised twice on 2026-08-27 after two owner reviews.

**These prompts build the approved deep plan.** Twenty-three fresh sessions execute twenty-three
numbered tasks in plan order, with one declared fork. **Every task is offline and spends no agent
quota except T19 and T20**, the two graduation runs, which spend it on real tasks rather than on
tests. No other task makes a live provider call, and no test any of them writes may touch the network.

Four tasks — T02, T19, T20 and the handover half of T23 — are **driven by the owner as a person**.
The session prepares, observes, records and classifies. It never drives the walkthrough on the
owner's behalf: doing so destroys the only measurement this workstream has.

## Gates before execution

1. **Twelve Questionables are decided and one is dissolved. Nothing here is still open**, and this
   workstream waits on no owner commit. Do not re-litigate a decision; if one looks wrong from
   inside the work, that is an Amendment for the owner, not a change to make in a task.
2. **The four decisions that shape the most work.** Q10: `docs/cheatsheet.html` is the **only**
   authored file — no markdown twin, no renderer, nothing generated. Q11: every fact class in the
   reference half is bound to its source by **set equality in both directions**, and a class with no
   extractable source is not documented at all. Q5: commands in prose are **exempt**, and the
   document's up-front warning that the reader does not type them is what pays for the exemption —
   so the warning is asserted. Q12: the written example is one small reproducible task; the
   graduation drives **two** real tasks and the delta between the runs is evidence.
3. **W03, W07, W08 and W11 are all `[x]` in `specs/awsf-v2-plan.html`.** Confirmed 2026-08-27.
   Confirm again before T01.
4. **This workstream adds no command and changes none.** `INV-7`. A friction point that could only
   be answered by changing the factory is routed to its owning workstream and recorded. The one new
   file under `core/` is this workstream's own meta-test.
5. **There is no owner-authored commit gate.** The diff touches no path matched by
   `policy.protected_paths`. If a task finds it needs one, it has discovered a routed mechanism.
6. `CLAUDE.md`, `docs/TESTING.md` and `docs/UI_REVIEW.md` do not exist in this repository. Do not
   invent them.

## Conventions used by every prompt

- Read `AGENTS.md` in full. Invariants 1 and 10 are directly in scope; 2, 11 and 12 govern markers,
  commits and tickets.
- **Flip this leaf plan's own markers.** In `specs/awsf-v2-w12-cheatsheet.html`, move the current
  task's checklist items `[]`→`[wip]`→`[x]`, and move the containing milestone header to `[wip]` on
  its first task and `[x]` only on its last. Flip the matching ticket's `state:` in the same commit.
- **Do not flip `specs/awsf-v2-plan.html`'s W12 marker before T23.** T23 alone closes the spine
  marker and `specs/tickets/awsf-v2-plan/W12.md`, after every leaf marker is `[x]` or `[f]`.
- **The eight things no task in this workstream may do**, restated in every prompt because each is a
  rule a plausible convenience would break: read either frozen candidate record
  (`specs/awsf-v2-candidates.md`, `specs/awsf-v2-candidates-GPT-version.md`); add or change a CLI
  command; write any path matched by `policy.protected_paths`; commit a report, receipt or manifest
  file; commit a live task, attempt, session or run identifier or an absolute machine path; narrow
  the command matcher to restore a green; document a fact class that has no fence, or a subset of
  one; create a markdown copy of the cheatsheet.
- **The fences land before the document.** No file at `docs/cheatsheet.html` exists until M2's tests
  are committed. Observed in the commit record, so adding a fence afterwards does not repair a
  violation.
- **Placeholders only.** Worked examples use `TASK` and `PROJECT`, matching the landed convention in
  `docs/driving/`. One placeholder vocabulary in this repository, not two.
- **The measured stale facts are the workstream's own evidence.** `TASK_STATES` has 11 entries and
  `LEGAL_EDGES` has 27; `README.md` says ten and says both 24 and twenty-five; the guard's header
  says six owner acts and its loop at line 118 iterates seven. Read the export and the loop, never
  the prose and never the header.
- Never add a runtime report, receipt or manifest file; never commit live task or session state.
- Append the modified date and an Amendment with the commit SHA after each completed task. Never put
  an agent, model, or AI tool in commit identity, message, or trailers.

## Reading order and the one fork

T01 → T02 → T03 → T04 is M1 and needs the owner as a person. T05 → {T06, T07} → T08 → T09 → T10 is
M2 and **starts from nothing**: it does not wait on M1. T11 is the join. M3 is T11 → T12 → {T13,
T14} → T15, M4 is T16 → T17 → T18, M5 is T19 → T20 → T21 → T22, and T23 closes. Reading a dependency
off the task numbers would serialize two independent milestones.

# Section B — Task prompts (recommended)

### T01 — Freeze the observation protocol, adapted for a driver who cannot be surprised

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6 · reasoning high
  WHY     this defines what counts as evidence for the whole workstream, and the adaptation it makes
          - measuring consultation rather than surprise - is what keeps the acceptance test runnable

TASK 1 of 23. Plan: specs/awsf-v2-w12-cheatsheet.html, milestone M1.
PREDECESSORS: none. Confirm all twelve Questionables read DECIDED and Q13 reads DISSOLVED, and that
W03, W07, W08 and W11 are [x] in specs/awsf-v2-plan.html.

READ FIRST
  AGENTS.md - in full, especially invariants 1, 2 and 10
  specs/awsf-v2-w12-cheatsheet.html - the Questionables IN FULL, "What This Builds, and What It
    Refuses to Build" including the author-driven-run card, "The Friction Log Starts Non-Empty", M1
  specs/awsf-v2-plan.html - the W12 block and the In Plain Language section, which is the register
  specs/tickets/awsf-v2-w11-five-stage-ladder/README.md - "What T01's run found", the six inherited
    stops and the entry-precondition table
  docs/driving/skills/awsf/SKILL.md and docs/driving/commands/prime-awsf.md - what driving and
    priming actually are, since the reader drives a session rather than typing commands
  README.md - the install blocks, which are what "install" currently means

DO
  Write the walkthrough as six numbered legs in the spine's order - install, prime, ask marimba for
  one job, watch it, read a refusal, stop at an owner act with its evidence. State for each leg what
  the driver is asked to ACHIEVE, never which command to type.
  Define a friction entry as ANY CONSULTATION of a source other than the document in order to
  proceed: the source tree, a plan, a previous transcript, the dashboard used as a substitute for an
  explanation, or unaided memory of how it works.
  Define the second entry class: anything that behaved differently from expectation, recorded even
  when the driver already knew the reason.
  State what is recorded - what was consulted, what question it answered, where on the leg it
  happened. Not a diagnosis and not a fix.
  State the limit IN WRITING: an author-driven run cannot prove the document is comprehensible to
  somebody new, only that it is sufficient to drive with. No later task may report the stronger claim.
  State that THIS SAME PROTOCOL RUNS UNCHANGED IN M5, TWICE, so the two runs are comparable. A
  protocol adjusted between runs makes the delta meaningless.
  Commit the protocol to specs/tickets/awsf-v2-w12-cheatsheet/README.md BEFORE the drive.

DO NOT
  Write a sentence of the cheatsheet. Write the protocol as a script of commands. Re-decide any
  Questionable. Create docs/cheatsheet.html.

DONE WHEN
  The protocol is committed in the ticket README, all six legs stated in achievement terms, both
  entry classes defined, the stated limit written, and the M5 re-use rule written.
  npm run test:unit passes.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    docs(w12): freeze the friction-log observation protocol
  Body: why the measure is consultation rather than surprise, and what that limits the runs to proving.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.

MARKERS
  Flip specs/awsf-v2-w12-cheatsheet.html milestone M1 header to [wip] and task 1's checklist to [x].
  Flip specs/tickets/awsf-v2-w12-cheatsheet/T01.md state to done.
  Do NOT touch specs/awsf-v2-plan.html.
```

### T02 — Drive the factory with no document, and record every consultation

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6 · reasoning medium
  WHY     the session records and captures; the driving is the owner's, and a session reasoning
          harder here is a session tempted to explain rather than write down what happened

TASK 2 of 23. Plan: specs/awsf-v2-w12-cheatsheet.html, milestone M1.
PREDECESSORS: T01 is [x] and the protocol is committed. THE OWNER IS PRESENT AND DRIVING.

READ FIRST
  specs/awsf-v2-w12-cheatsheet.html - M1 task 2, and the Q1/Q6/Q9 decisions
  specs/tickets/awsf-v2-w12-cheatsheet/README.md - the frozen protocol, in full
  AGENTS.md - invariant 1, which governs everything you are about to write down

DO
  The OWNER drives one job end to end through marimba in this checkout, per Q6's decided scope, with
  no guide open. You observe and record.
  Record every consultation as it happens, numbered in occurrence order, with the leg it occurred on,
  what was consulted, and what question it answered.
  Record what marimba invoked at each leg - the commands, the states the work passed through, the
  gate that decided. THIS IS THE RAW MATERIAL OF THE REFERENCE HALF and it is cheapest to capture
  while driving. M4 is written from it rather than from reading the source.
  Record where the drive ended, whether or not that is the end of the script.
  Record every place the factory behaved differently from expectation, including any of the three
  measured stale-document facts if they are encountered in use.
  Keep raw notes OUTSIDE this repository. Scrub every task, attempt, session and run id and every
  absolute machine path before anything lands.

DO NOT
  Drive the walkthrough yourself. Explain or hint. Fix anything you observe breaking. Tidy the
  owner's words into better ones. Write any part of the cheatsheet.

IF THE DRIVE DISAGREES WITH WHAT ANYBODY EXPECTED, THE DRIVE WINS. Write the disagreement into the
ticket README rather than resolving it in favour of the expectation.

DONE WHEN
  The numbered friction log and the per-leg capture of what marimba invoked are both in
  specs/tickets/awsf-v2-w12-cheatsheet/README.md. No identifier or machine path survives the scrub.
  npm run test:unit passes.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    docs(w12): record the unguided drive, its consultations and what marimba invoked
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.

MARKERS
  Flip task 2's checklist to [x] in specs/awsf-v2-w12-cheatsheet.html and
  specs/tickets/awsf-v2-w12-cheatsheet/T02.md state to done.
  Do NOT touch specs/awsf-v2-plan.html.
```

### T03 — Classify every entry, and route what needs a change to the factory

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6 · reasoning high
  WHY     every misclassification becomes either a silently dropped friction point or a workstream
          widening, and both are invisible in the finished document

TASK 3 of 23. Plan: specs/awsf-v2-w12-cheatsheet.html, milestone M1.
PREDECESSORS: T02 is [x].

READ FIRST
  specs/awsf-v2-w12-cheatsheet.html - "The Friction Log Starts Non-Empty" IN FULL, the scope table's
    six temptations, and M1 task 3
  specs/tickets/awsf-v2-w12-cheatsheet/README.md - the recorded entries
  specs/tickets/awsf-v2-w11-five-stage-ladder/README.md - the T03/T04 routing table, which is the
    shape a routed request takes here
  specs/awsf-v2-plan.html - Shared Invariants and Constraints, "Owner-side work", and the workstream
    blocks, so a route names a workstream that exists

DO
  Merge W11 T01's six inherited stops, marked INHERITED rather than OBSERVED. Check each against the
  drive: an inherited stop the owner did not hit is a stop that has been fixed since, and saying so
  is a finding.
  Give every entry EXACTLY ONE disposition: document | route | owner-side | accepted absence.
  SPLIT every entry into the half it belongs to - walkthrough or reference - because the two are
  written by different milestones in different registers.
  For each ROUTE, name the owning workstream from the spine and write the request in W11 T04's shape
  - what is missing, why this workstream cannot supply it, what would close it.
  For each OWNER-SIDE, confirm it against the spine's owner-side list. An owner-side label is how
  work disappears.
  For each ACCEPTED ABSENCE, write the reason and what evidence would reopen it.

DO NOT
  Change any code. Add or change any command. Write a starter project template. Leave any entry
  unclassified or unassigned to a half. Merge two entries because they look similar.

DONE WHEN
  Every entry carries exactly one disposition and one half, every route names an existing workstream
  and carries a written request, every accepted absence carries a reason.
  npm run test:unit passes.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    docs(w12): classify every friction entry and route what needs a change
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.

MARKERS
  Flip task 3's checklist to [x] in specs/awsf-v2-w12-cheatsheet.html and
  specs/tickets/awsf-v2-w12-cheatsheet/T03.md state to done.
  Do NOT touch specs/awsf-v2-plan.html.
```

### T04 — M1 Testing Strategy

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6 · reasoning medium
  WHY     mechanical completeness and cleanliness checks over a record that already exists

TASK 4 of 23. Plan: specs/awsf-v2-w12-cheatsheet.html, milestone M1. CLOSES M1.
PREDECESSORS: T01, T02 and T03 are [x] or [f] with their blocks named.

READ FIRST
  specs/awsf-v2-w12-cheatsheet.html - M1 task 4 and the spine's AC-1, INV-4
  AGENTS.md - invariants 1 and 10
  core/test/unit/meta/ - the junk-drawer and no-live-state meta-tests, to see what already checks this

DO
  Verify the friction log is complete: every entry numbered, one disposition each, one half each.
  Verify the stated limit on what an author-driven run proves is written in the log, not only in the
  plan.
  Verify no report, receipt or manifest file was committed by this milestone.
  Grep this milestone's diff for identifier shapes and absolute machine paths. Reuse the repository's
  existing predicates rather than writing a second copy.
  Verify every ROUTE entry names a workstream that exists in specs/awsf-v2-plan.html.
  Run npm run test:unit, npm run lint and npm run typecheck.

DO NOT
  Add a new test file in this milestone - M2 owns the new meta-test. Weaken any existing check to
  make this milestone pass.

DONE WHEN
  Every M1 checklist row is green or [f] with its block named. npm run test:unit passes, lint and
  typecheck exit 0.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    test(w12): verify the friction log is complete and carries no live state
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.

MARKERS
  Flip milestone M1's header to [x] in specs/awsf-v2-w12-cheatsheet.html and every remaining
  checklist box in it. Flip specs/tickets/awsf-v2-w12-cheatsheet/T04.md state to done.
  THEN append an Amendment to specs/awsf-v2-w12-cheatsheet.html recording the CLOSE of milestone M1:
    - what is now observably true
    - every task in it and its final state, naming any [f] row and the block that holds it
    - the friction it hit, and what a later milestone must now do differently
    - the decisions made inside the milestone that the plan did not already carry
    - the landing commit SHAs and the suite counts at close
  Append the modified date to the metadata header in the same commit.
  Do NOT touch specs/awsf-v2-plan.html.
```

### T05 — Normalize the three invocation forms in one extractor

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6 · reasoning high
  WHY     this repairs a landed test whose green is currently vacuous over the README; the failure
          mode is restoring the green by narrowing the matcher, which looks exactly like a test fix

TASK 5 of 23. Plan: specs/awsf-v2-w12-cheatsheet.html, milestone M2.
PREDECESSORS: none. M2 does not wait on M1 - the fork is declared in the plan's Implementation
Phases header. Do not read a dependency off the task numbers.

READ FIRST
  core/test/unit/meta/doc-reconciliation.test.ts - IN FULL, including the driving-tree header block
    and commandText(source, html), which already reads <code> out of the v1 plan
  core/test/unit/meta/_driving.ts - the vacuous-until-it-lands warning and the junk-drawer caution
  core/src/cli/main.ts - CLI_COMMANDS, and note `db rebuild` is the one two-word command
  package.json - the root scripts; justfile - the targets, each a thin npm wrapper
  README.md - the install, usage and verification blocks, written in the invisible form
  specs/awsf-v2-w12-cheatsheet.html - "The Mechanical Half" IN FULL and M2 task 5

DO
  Reproduce the gap FIRST: assert the current matcher extracts nothing from
  "npm run awsf -- land TASK". The repair must have a failing test before it has a fix.
  Normalize `npm run awsf -- <rest>` and `just awsf <rest>` to `awsf <rest>` ahead of the existing
  AWSF_CLI match, in ONE place used by every consumer of the extractor.
  Preserve the two-word `db rebuild` case through the normalization.
  Keep `just awsf ...` still resolving as a justfile target as well - both claims are true of that line.
  Run the widened fence over README.md and the v1 plan's Validation section. If it goes red, record
  EVERY offender in the ticket README before changing anything.
  Repair each offender at its owner - the README's own text, or a routed request to the command's
  workstream.

DO NOT
  Narrow the matcher to restore a green. Widen the driving-tree fence's scope from fenced blocks to
  prose. Edit a command's implementation to match a document.

DONE WHEN
  The gap test fails without the normalization and passes with it. npm run test:unit passes.
  Any README offender is recorded with its disposition. npm run lint and npm run typecheck exit 0.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    fix(meta): see all three awsf invocation forms in the doc-reconciliation fence
  Body: the measured gap, why the README form was invisible, and every offender the widening exposed.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.

MARKERS
  Flip milestone M2's header to [wip] and task 5's checklist to [x] in
  specs/awsf-v2-w12-cheatsheet.html. Flip specs/tickets/awsf-v2-w12-cheatsheet/T05.md state to done.
  Do NOT touch specs/awsf-v2-plan.html.
```

### T06 — The six fact classes, set-equal in both directions

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6 · reasoning high
  WHY     this is the mechanism that makes "documents everything" a test rather than a promise, and
          the direction that catches staleness is the one nobody thinks to write

TASK 6 of 23. Plan: specs/awsf-v2-w12-cheatsheet.html, milestone M2.
PREDECESSORS: T05 is [x].

READ FIRST
  specs/awsf-v2-w12-cheatsheet.html - the Problem's third problem IN FULL, the Solution's fact-class
    table, Q11, and M2 task 6
  core/src/cli/main.ts - CLI_COMMANDS
  core/src/state/task-machine.ts - TASK_STATES (11) and LEGAL_EDGES (27)
  core/src/state/tiers.ts - TIERS, DEFAULT_CALL_CEILINGS, MAX_CALL_CEILING
  core/src/config/load.ts - the loader, which is how the config must be read
  docs/driving/marimba/delegation-guard.sh - THE VERB LOOP AT LINE 118, not the header comment
  README.md - the lifecycle paragraph and the diagram label, both of which are stale

DO
  Extract each class from its source: CLI_COMMANDS; TASK_STATES; LEGAL_EDGES; the guard's verb loop;
  workflows and gates THROUGH THE CONFIG LOADER rather than by parsing YAML; TIERS and
  DEFAULT_CALL_CEILINGS.
  Read the guard's LOOP, never its header comment, and say so in the extractor's own comment with
  the measured discrepancy - the header says six and the loop iterates seven.
  Define ONE machine-readable marker per class - a data attribute on the element carrying the set -
  so extraction from the document is exact rather than a prose scan. Write the convention into the
  test header; T16 writes the document against it.
  Assert SET EQUALITY per class. Make each failure message name the class, the DIRECTION, and the
  differing entries.
  Repair README.md's stale lifecycle numbers as part of this task, recording the measurement that
  shows they were wrong. The fence makes this mandatory rather than optional.

DO NOT
  Assert subset in either direction - equality is the whole point. Parse awsf.config.yaml by hand.
  Read the guard's header for a count. Add a fact class whose source is prose. Widen the marker
  convention to admit a class you could not extract.

DONE WHEN
  Six classes extract from their sources and from the document, six set-equality assertions exist,
  and README.md's lifecycle numbers match the exports. npm run test:unit passes with the document
  still absent - the class fences are inert until M4 writes it, and that is expected.
  npm run lint and npm run typecheck exit 0.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    test(w12): bind six fact classes to their sources by set equality
  Body: the three measured stale facts, why both directions are asserted, and the README repair.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.

MARKERS
  Flip task 6's checklist to [x] in specs/awsf-v2-w12-cheatsheet.html and
  specs/tickets/awsf-v2-w12-cheatsheet/T06.md state to done.
  Do NOT touch specs/awsf-v2-plan.html.
```

### T07 — Check commands where they are shown, and make the reader warning load-bearing

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6 · reasoning high
  WHY     the prose exemption is paid for by an asserted sentence, and the header explaining that
          trade is as much of the deliverable as the assertion

TASK 7 of 23. Plan: specs/awsf-v2-w12-cheatsheet.html, milestone M2.
PREDECESSORS: T05 is [x]. Independent of T06.

READ FIRST
  core/test/unit/meta/doc-reconciliation.test.ts - the driving-tree header block, whose
    prose-exemption trade this test now FOLLOWS rather than departs from
  core/test/unit/meta/_driving.ts - the junk-drawer caution about `receipt` and `manifest` basenames
  specs/awsf-v2-w12-cheatsheet.html - "The Mechanical Half" leg three, Q5 IN FULL including the note
    about the truncated owner reason, and M2 task 7

DO
  Add core/test/unit/meta/cheatsheet-reconciliation.test.ts scoped to docs/cheatsheet.html, and state
  in its header WHY it is a separate file from doc-reconciliation.test.ts.
  Assert every command in a command block resolves against CLI_COMMANDS, the root scripts, or a
  justfile target - using T05's extractor, never a second copy of it.
  Leave commands named in PROSE exempt, and write the reason into the header: the reader drives a
  session rather than a terminal, so the hazard a ban would have addressed is answered by the
  document's own warning instead.
  Assert the reader warning EXISTS and appears BEFORE the first command block. Make the failure
  message say what the warning is for, so somebody who trips it understands why it is load-bearing.
  Make the fence fail LOUDLY when the document is missing. It has one known path and its absence is
  a defect.

DO NOT
  Copy the extractor. Assert the prose rule the plan originally recommended - Q5 replaced it.
  Accept a warning that sits after the first command block. Name the test file anything containing
  `receipt` or `manifest`.

IF Q5's TRUNCATED OWNER NOTE IS CLARIFIED BEFORE THIS TASK and it carried a further condition, that
arrives as an Amendment. Read the Amendments section before starting.

DONE WHEN
  The new test exists, fails loudly with the document absent, and its header states the exemption and
  its reason. npm run test:unit reports the expected loud failure, not a vacuous pass.
  npm run lint and npm run typecheck exit 0.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    test(w12): fence the cheatsheet's commands and make its reader warning load-bearing
  Body: why prose keeps its exemption here, and what the asserted warning buys instead.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.

MARKERS
  Flip task 7's checklist to [x] in specs/awsf-v2-w12-cheatsheet.html and
  specs/tickets/awsf-v2-w12-cheatsheet/T07.md state to done.
  Do NOT touch specs/awsf-v2-plan.html.
```

### T08 — The structure fences: the index, and nothing external

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6 · reasoning medium
  WHY     two set-shaped assertions over a document structure, in a file that already exists

TASK 8 of 23. Plan: specs/awsf-v2-w12-cheatsheet.html, milestone M2.
PREDECESSORS: T07 is [x]. This task edits the SAME test file as T07, which is why it is serialized
after it rather than run in parallel - the dependency is the file, not the logic.

READ FIRST
  specs/awsf-v2-w12-cheatsheet.html - M2 task 8, INV-8, INV-9, AC-7, AC-8, and Q10's second
    consequence, which is where these two fences come from
  core/test/unit/meta/cheatsheet-reconciliation.test.ts - T07's file, which this extends

DO
  Assert SET EQUALITY between the index entries and the section ids, in BOTH directions, with the
  failure message naming the direction.
  Assert the document contains no external reference - no http or protocol-relative URL, no script
  source, no external stylesheet, no remote font, no remote image.
  Write into the header WHY a hand-written index needs a fence at all: with no renderer it is the one
  part of a single-file document that can silently disagree with the rest of it.
  Write into the header that self-containment used to be a property of a generator and is now an
  assertion, because Q10 removed the generator.

DO NOT
  Assert subset in either direction. Put these in a second test file - keep them beside T07's so the
  document has one fence file, and say in the ticket that the serialization is deliberate.

DONE WHEN
  Both assertions exist and fail loudly with the document absent.
  npm run test:unit reports the expected loud failure. npm run lint and npm run typecheck exit 0.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    test(w12): fence the cheatsheet's index against its sections and bar external references
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.

MARKERS
  Flip task 8's checklist to [x] in specs/awsf-v2-w12-cheatsheet.html and
  specs/tickets/awsf-v2-w12-cheatsheet/T08.md state to done.
  Do NOT touch specs/awsf-v2-plan.html.
```

### T09 — Ship the companion specimens, so a vacuous green is impossible

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6 · reasoning medium
  WHY     known-shape tests against in-memory specimens, with exact expected output pinned; the
          design decisions were spent in T06, T07 and T08

TASK 9 of 23. Plan: specs/awsf-v2-w12-cheatsheet.html, milestone M2.
PREDECESSORS: T06, T07 and T08 are [x].

READ FIRST
  core/test/unit/meta/doc-reconciliation.test.ts - the existing specimen test, "the driving-tree
    scanner reads fences and not prose, and its matchers bite", which is the pattern to follow
  core/test/unit/meta/_driving.ts - the warning this task answers
  specs/awsf-v2-w12-cheatsheet.html - M2 task 9 and AC-3, AC-4, AC-6, AC-7

DO
  Build ONE in-memory specimen for the command leg carrying: a real command in each of the three
  invocation forms; an invented command in each of the three; a command named in PROSE, which must
  NOT be reported; and the warning placed both before and after the first command block.
  Build, PER FACT CLASS, one synthetic document with a MISSING entry and one with an INVENTED entry,
  and assert each is reported with its direction named. That is twelve cases.
  Build two index specimens: a section with no entry, and an entry pointing at no section.
  Build one external-reference specimen per reference kind the assertion claims to catch.
  Assert the extractors' EXACT output over every specimen, not merely that they found something.
  State in the header that deleting these tests leaves fences that report green forever, quoting
  _driving.ts's own warning as the precedent.

DO NOT
  Assert only that arrays are non-empty. Cover one direction per class and call it done. Omit the
  prose case - proving the exemption is deliberate is as important as proving the check bites.

DONE WHEN
  npm run test:unit passes with every specimen green and the real document still absent.
  npm run lint and npm run typecheck exit 0.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    test(w12): pin every fence matcher against in-memory specimens
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.

MARKERS
  Flip task 9's checklist to [x] in specs/awsf-v2-w12-cheatsheet.html and
  specs/tickets/awsf-v2-w12-cheatsheet/T09.md state to done.
  Do NOT touch specs/awsf-v2-plan.html.
```

### T10 — M2 Testing Strategy

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6 · reasoning medium
  WHY     induced-failure passes over tests that already exist; the judgement was spent in T05–T09

TASK 10 of 23. Plan: specs/awsf-v2-w12-cheatsheet.html, milestone M2. CLOSES M2.
PREDECESSORS: T05, T06, T07, T08 and T09 are [x].

READ FIRST
  specs/awsf-v2-w12-cheatsheet.html - M2 task 10 and AC-2, AC-3, AC-4, AC-6, AC-7
  core/test/unit/meta/cheatsheet-reconciliation.test.ts and doc-reconciliation.test.ts

DO
  Remove the T05 normalization and watch leg one go red. Restore it and watch it return green.
  Confirm an invented command is reported in all three invocation forms, and that a command named in
  prose is NOT reported.
  Confirm deleting the warning goes red, and moving it after the first command block goes red.
  Confirm ALL SIX CLASSES go red in BOTH directions - twelve induced failures, each observed and
  recorded with the message the failure produced.
  Confirm the index fence goes red in both directions.
  Confirm the README's repaired lifecycle numbers are recorded with the export that measured them.
  Run npm run test:unit, npm run lint, npm run typecheck and record the counts.

DO NOT
  Declare a leg or a direction proven without having watched it go red. Skip the restore step.
  Accept a failure message that does not name the class and the direction.

DONE WHEN
  Every M2 checklist row is green. Every induced failure was observed and recorded.
  npm run test:unit passes; lint and typecheck exit 0.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    test(w12): prove every fence leg and every fact class bites in both directions
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.

MARKERS
  Flip milestone M2's header to [x] in specs/awsf-v2-w12-cheatsheet.html and every remaining
  checklist box in it. Flip specs/tickets/awsf-v2-w12-cheatsheet/T10.md state to done.
  THEN append an Amendment to specs/awsf-v2-w12-cheatsheet.html recording the CLOSE of milestone M2:
    - what is now observably true, including what the widened extractor exposed in the README
    - every task in it and its final state, naming any [f] row and the block that holds it
    - the friction it hit, and what a later milestone must now do differently
    - the decisions made inside the milestone that the plan did not already carry
    - the landing commit SHAs and the suite counts at close
  Append the modified date to the metadata header in the same commit.
  Do NOT touch specs/awsf-v2-plan.html.
```

### T11 — Build the shell: the Forest ramp, both themes, the index, and nothing external

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6 · reasoning high
  WHY     with no renderer the skeleton is authored once and every later task writes into it; a
          structure decided loosely here is one that fights every task after it

TASK 11 of 23. Plan: specs/awsf-v2-w12-cheatsheet.html, milestone M3. THE JOIN.
PREDECESSORS: T04 AND T10 are both [x]. M3 needs the friction log and the fences.

READ FIRST
  specs/awsf-v2-w12-cheatsheet.html - the Solution's "One authored file" section, Q3, Q10, INV-8,
    INV-9, and M3 task 11 including the mockup
  the owner's external technical-reference document - its Forest token block for both themes, the
    theme toggle, the sticky rail nav, the section-head pattern, the dot status language, and its
    stated rules: inline SVG, no CDN, works offline
  core/test/unit/meta/cheatsheet-reconciliation.test.ts - the index fence, the external-reference
    fence, and T06's marker convention, all of which the shell must satisfy from its first commit

DO
  Create docs/cheatsheet.html with the Forest token block for BOTH themes and the toggle the owner's
  reference document uses, so the page respects the reader's system setting and remembers an
  explicit choice.
  Build the sticky index and the section-head pattern, with ONE SECTION ID PER SECTION so the index
  fence has something exact to join against.
  Adopt the dot status language for anything that has a state, and never mark something built that
  is not.
  Keep it self-contained from the first commit: no CDN, no external script, no remote font, no
  remote image.
  Confirm the index fence and the external-reference fence both go GREEN against the shell before any
  prose is written. The structure is checked before it carries content.

DO NOT
  Create a markdown copy. Add a build step. Load a font or a stylesheet from anywhere. Write
  walkthrough or reference prose in this task - the shell only.

DONE WHEN
  docs/cheatsheet.html exists as a themed, self-contained shell with an index and section ids, and
  the index and external-reference fences are green against it.
  npm run test:unit passes; lint and typecheck exit 0.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    docs(w12): create the cheatsheet shell in the Forest design, self-contained
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.

MARKERS
  Flip milestone M3's header to [wip] and task 11's checklist to [x] in
  specs/awsf-v2-w12-cheatsheet.html. Flip specs/tickets/awsf-v2-w12-cheatsheet/T11.md state to done.
  Do NOT touch specs/awsf-v2-plan.html.
```

### T12 — Write the six legs, in the reader's order, against the friction log

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6 · reasoning high
  WHY     this is the workstream's deliverable, written in a register this repository has one other
          example of, for a reader who has none of the author's context

TASK 12 of 23. Plan: specs/awsf-v2-w12-cheatsheet.html, milestone M3.
PREDECESSORS: T11 is [x].

READ FIRST
  specs/awsf-v2-w12-cheatsheet.html - the Solution, the scope table, the spine, and M3 IN FULL
    including the mockup, which shows the two-register join and where the warning goes
  specs/tickets/awsf-v2-w12-cheatsheet/README.md - the classified friction log; every DOCUMENT entry
    assigned to the WALKTHROUGH half is a thing this task must answer at the point it occurred
  specs/awsf-v2-plan.html - the In Plain Language section, which is the register to write in
  docs/driving/skills/awsf/SKILL.md - the posture rules that bind this document too
  README.md - the engineer-facing owner of install; point at it, restate none of it

DO
  Write the six legs into the shell, in the order the reader travels them.
  WRITE THE READER WARNING BEFORE THE FIRST COMMAND BLOCK - there is no need to type any of these,
  the assistant runs them - because the prose exemption is paid for by that sentence and a fence
  asserts it is there.
  Answer each DOCUMENT entry assigned to this half at the exact point on the leg where it occurred.
  Not in a gotchas section at the end, which is where an answer goes to be missed.
  Write it for a person driving marimba: what to ask for, and how to read what comes back. The reader
  personally performs installation and the owner acts, and nothing else.
  Give every leg a SHORT behind-the-curtain note that links into the reference half, so the two
  registers join rather than sit apart. Two or three sentences, not a section.
  Use TASK and PROJECT as the only placeholders.
  State up front what the walkthrough COSTS, decided against W11 T01's measured finding that the
  owner-typed run cannot reach the stub route, rather than assumed.
  Use ONE SMALL REPRODUCIBLE TASK as the worked example, per Q12. The next reader must be able to run
  the example; a one-off real task cannot be re-run by them.

DO NOT
  Name any lifecycle state, edge id, tier ceiling, gate id, blocker code, workflow id, schema id or
  model id in THIS half - the reference half owns those, behind fences. Add a command reference
  table. Create a markdown copy. Use one of the graduation tasks as the worked example.

DONE WHEN
  All six legs are written, the warning precedes the first command block, every walkthrough-half
  DOCUMENT entry is answered in place, and the cost is stated up front.
  npm run test:unit passes with the command fence and the warning fence now running over real content.
  npm run lint and npm run typecheck exit 0.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    docs(w12): write the six-leg walkthrough against the friction log
  Body: which entries are answered where, and any deliberately answered later in a following task.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.

MARKERS
  Flip task 12's checklist to [x] in specs/awsf-v2-w12-cheatsheet.html and
  specs/tickets/awsf-v2-w12-cheatsheet/T12.md state to done.
  Do NOT touch specs/awsf-v2-plan.html.
```

### T13 — Write the two hard legs: reading a refusal, and stopping at a signature

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6 · reasoning high
  WHY     these two legs must be readable by someone who did not cause what they are reading, and
          both carry the highest risk of leaking live state into a committed file

TASK 13 of 23. Plan: specs/awsf-v2-w12-cheatsheet.html, milestone M3.
PREDECESSORS: T12 is [x].

READ FIRST
  specs/awsf-v2-w12-cheatsheet.html - M3 task 13, INV-3 and INV-5
  AGENTS.md - invariant 1, in full
  docs/driving/marimba/delegation-guard.sh - THE LOOP AT LINE 118, not the header's count
  docs/driving/skills/awsf/cookbooks/read_a_blocked_attempt.md and owner_acts.md - the agent-facing
    treatment of the same two subjects. Read them so this document does not restate them
  specs/awsf-v2-plan.html - the camera-versus-wall correction in the In Plain Language section

DO
  Write leg five so a reader can read a refusal they did not cause: what refused, what it was
  protecting, what was NOT spent, and what the reader may now decide.
  Teach the distinction the whole spine is built on - a thing that STOPS something, and a record that
  REPORTS something afterwards - in plain words. A reader who confuses them trusts the wrong one.
  Write leg six from the guard's verb loop. Say plainly that these are the acts a person performs and
  an assistant is refused.
  Name exactly what evidence must be in hand before the reader decides - and STOP there. The document
  does not tell the reader which way to decide.
  Use only placeholders in every worked refusal and every worked owner act.

DO NOT
  Paste a real refusal, a real identifier, or a real machine path. Recommend a decision to the reader.
  Restate the cookbooks. Count the owner acts from the guard's header comment.

DONE WHEN
  Legs five and six are written, every example uses placeholders only, and a scan of the document
  finds no identifier that is not TASK or PROJECT and no absolute machine path.
  npm run test:unit passes; lint and typecheck exit 0.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    docs(w12): write the refusal and owner-act legs with placeholders only
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.

MARKERS
  Flip task 13's checklist to [x] in specs/awsf-v2-w12-cheatsheet.html and
  specs/tickets/awsf-v2-w12-cheatsheet/T13.md state to done.
  Do NOT touch specs/awsf-v2-plan.html.
```

### T14 — Write the boundaries, the ownership declaration, and the limits

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6 · reasoning medium
  WHY     the content is settled by the plan's own invariants; the work is stating each one plainly
          with its reason

TASK 14 of 23. Plan: specs/awsf-v2-w12-cheatsheet.html, milestone M3.
PREDECESSORS: T12 is [x]. Independent of T13.

READ FIRST
  specs/awsf-v2-w12-cheatsheet.html - M3 task 14, INV-2, INV-5, INV-6, Q1's cost block, and the
    accepted absences recorded by T03
  docs/driving/skills/awsf/SKILL.md - the hard rules, especially "never open private/", and the
    reason it is said out loud rather than merely omitted
  specs/tickets/awsf-v2-w12-cheatsheet/README.md - the accepted absences

DO
  State what the reader must never be asked to do and must never do alone: push anything, edit a
  protected file, repair state by hand, or work around a refusal.
  Give each a one-sentence reason. A rule without a reason is a rule a reader routes around the first
  time it is inconvenient.
  Declare IN THE DOCUMENT that it owns the reader's route and the six fenced fact classes, and
  nothing else, pointing at the files that own the rest.
  State that nothing in the factory reads this document and no outcome depends on having read it.
  Carry the accepted absences from T03 into an honest limits section - what this document does not
  cover and who owns it.
  State the acceptance limit in the document itself: it has been driven by its author and not yet by
  anyone else, so it is known to be sufficient to drive with and not known to be understandable to
  somebody new.
  Add every section written in this milestone to the index, so the index fence stays green.

DO NOT
  Omit a forbidden act because naming it might suggest it. A path left unmentioned is avoided by
  habit; a path named as forbidden is avoided by rule. Soften a limit into a promise.

DONE WHEN
  The boundary section, the ownership declaration and the limits section are written and indexed, and
  the acceptance limit appears in the document rather than only in the plan.
  npm run test:unit passes; lint and typecheck exit 0.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    docs(w12): state the reader's boundaries and what this document does not own
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.

MARKERS
  Flip task 14's checklist to [x] in specs/awsf-v2-w12-cheatsheet.html and
  specs/tickets/awsf-v2-w12-cheatsheet/T14.md state to done.
  Do NOT touch specs/awsf-v2-plan.html.
```

### T15 — M3 Testing Strategy

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6 · reasoning medium
  WHY     induced failures against the real file, plus scans; the design work was spent in M2

TASK 15 of 23. Plan: specs/awsf-v2-w12-cheatsheet.html, milestone M3. CLOSES M3.
PREDECESSORS: T11, T12, T13 and T14 are [x].

READ FIRST
  specs/awsf-v2-w12-cheatsheet.html - M3 task 15, INV-1, INV-3, AC-3, AC-4, AC-5, AC-7, AC-8
  core/test/unit/meta/cheatsheet-reconciliation.test.ts

DO
  Insert an invented command into a REAL command block. Watch the suite go red and name the file and
  the command. Remove it and watch it return green.
  Delete the reader warning and watch it go red. Move it to after the first command block and watch
  it go red. Restore it.
  Remove a section's index entry and watch it go red. Add an entry pointing at no section and watch
  it go red.
  Inject an external reference and watch it go red. Remove it, and open the document with the network
  disabled.
  Confirm every DOCUMENT entry assigned to the walkthrough half is answered, and record WHERE in the
  ticket README.
  Scan the document for identifiers that are not TASK or PROJECT and for absolute machine paths.
  Run npm run test:unit, npm run lint, npm run typecheck.

DO NOT
  Declare a leg proven without having watched it go red on the REAL file. Assert the fact classes
  here - they are M4's, because the reference half does not exist yet.

DONE WHEN
  Every M3 checklist row is green or [f] with its block named. Every induced failure was observed on
  the real document. npm run test:unit passes; lint and typecheck exit 0.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    test(w12): prove the command, warning, index and offline fences bite on the real document
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.

MARKERS
  Flip milestone M3's header to [x] in specs/awsf-v2-w12-cheatsheet.html and every remaining
  checklist box in it. Flip specs/tickets/awsf-v2-w12-cheatsheet/T15.md state to done.
  THEN append an Amendment to specs/awsf-v2-w12-cheatsheet.html recording the CLOSE of milestone M3:
    - what is now observably true
    - every task in it and its final state, naming any [f] row and the block that holds it
    - the friction it hit, and what a later milestone must now do differently
    - the decisions made inside the milestone that the plan did not already carry
    - the landing commit SHAs and the suite counts at close
  Append the modified date to the metadata header in the same commit.
  Do NOT touch specs/awsf-v2-plan.html.
```

### T16 — Write the reference half, to satisfy the fences rather than to look complete

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6 · reasoning high
  WHY     this is the half the review added and the half most likely to drift into the rejected
          shape; every judgement here is about what may be written rather than how to write it

TASK 16 of 23. Plan: specs/awsf-v2-w12-cheatsheet.html, milestone M4.
PREDECESSORS: T15 is [x].

READ FIRST
  specs/awsf-v2-w12-cheatsheet.html - the Solution's fact-class table, Q11 IN FULL, the scope table's
    first row, INV-2, and M4 task 16
  core/test/unit/meta/cheatsheet-reconciliation.test.ts - T06's marker convention; the markers are
    the contract this task writes to
  specs/tickets/awsf-v2-w12-cheatsheet/README.md - T02's captured record of what marimba invoked at
    each leg, and the friction entries assigned to the REFERENCE half

DO
  Write one section per fact class, each carrying its FULL set in T06's marker, and add each section
  to the index so the index fence stays green.
  Write what marimba invokes at each of the six legs, TAKEN FROM T02'S CAPTURED RECORD of the real
  drive rather than from reading the source. A drive that was observed beats a source that was read.
  Explain each class in a sentence a reader can use - what a state means, what a gate decides, what
  an act costs - BESIDE the fenced set rather than instead of it.
  Answer every DOCUMENT entry from the friction log assigned to this half.

DO NOT
  Document any fact class that has no fence. If a class cannot be extracted from a source, it does
  not go in - that is a finding about the factory, and it gets routed.
  Write a SUBSET of a class because the full set is long: the fence asserts equality and a subset is
  a red suite. This is the likeliest way to fail this task.
  Copy a count or a list from a document rather than from the source. Create a markdown copy.

DONE WHEN
  All six class sections exist with complete sets in the markers and entries in the index, the
  per-leg behind-the-curtain content is written from T02's capture, and every reference-half DOCUMENT
  entry is answered.
  npm run test:unit passes with all six set-equality assertions now live against a real document.
  npm run lint and npm run typecheck exit 0.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    docs(w12): write the reference half behind six set-equality fences
  Body: which classes are covered, and anything the owner wanted covered that had no extractable
  source and was routed instead.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.

MARKERS
  Flip milestone M4's header to [wip] and task 16's checklist to [x] in
  specs/awsf-v2-w12-cheatsheet.html. Flip specs/tickets/awsf-v2-w12-cheatsheet/T16.md state to done.
  Do NOT touch specs/awsf-v2-plan.html.
```

### T17 — Author the figures: inline SVG, theme-aware, offline

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6 · reasoning high
  WHY     hand-authored SVG whose text must fit its card in two themes is precision work, and a
          figure that overflows is only visible to someone who looks at it

TASK 17 of 23. Plan: specs/awsf-v2-w12-cheatsheet.html, milestone M4.
PREDECESSORS: T16 is [x].

READ FIRST
  specs/awsf-v2-w12-cheatsheet.html - M4 task 17 and INV-9
  the owner's external technical-reference document - its figure conventions and its stated rules:
    diagrams are inline SVG, no CDN, no external script, theme-aware through token variables, a
    diagram must show a MECHANISM, and every text element must fit inside its card and its viewBox
  docs/cheatsheet.html - the sections the figures serve

DO
  Author each figure as hand-written inline SVG using semantic classes that inherit the theme tokens.
  Draw only figures that show a mechanism. If a paragraph carries it as well, write the paragraph.
  MEASURE every text element against its card and the viewBox. Do not eyeball it.
  Keep every figure legible in BOTH themes, checked by rendering under each.

DO NOT
  Use a CDN, an external script, a remote font or a remote image. Draw a diagram that restates a
  heading with boxes and arrows.

DONE WHEN
  Every figure the document needs exists, shows a mechanism, fits its viewBox, and renders legibly in
  both themes. The external-reference fence is still green.
  npm run test:unit passes; lint and typecheck exit 0.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    docs(w12): author the cheatsheet's inline SVG figures
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.

MARKERS
  Flip task 17's checklist to [x] in specs/awsf-v2-w12-cheatsheet.html and
  specs/tickets/awsf-v2-w12-cheatsheet/T17.md state to done.
  Do NOT touch specs/awsf-v2-plan.html.
```

### T18 — M4 Testing Strategy

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6 · reasoning medium
  WHY     the full fence set re-run against the finished document, with every class observed failing

TASK 18 of 23. Plan: specs/awsf-v2-w12-cheatsheet.html, milestone M4. CLOSES M4.
PREDECESSORS: T16 and T17 are [x].

READ FIRST
  specs/awsf-v2-w12-cheatsheet.html - M4 task 18 and AC-6, AC-7, AC-8
  core/test/unit/meta/cheatsheet-reconciliation.test.ts

DO
  Confirm all six classes are set-equal against the REAL document, and re-run the twelve induced
  failures against it rather than only against specimens.
  Confirm the index fence is green over the added reference sections and still bites in both
  directions.
  Confirm the no-external-reference scan is green, and OPEN THE DOCUMENT WITH THE NETWORK DISABLED -
  the scan and the render are different claims.
  Confirm every figure is legible in both themes and no text overflows its card.
  Run npm run test:unit, npm run lint, npm run typecheck and record the counts.

DO NOT
  Accept a class proven only against a specimen. Skip the offline open.

DONE WHEN
  Every M4 checklist row is green or [f] with its block named. npm run test:unit passes; lint and
  typecheck exit 0.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    test(w12): prove every fence and every class against the finished document
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.

MARKERS
  Flip milestone M4's header to [x] in specs/awsf-v2-w12-cheatsheet.html and every remaining
  checklist box in it. Flip specs/tickets/awsf-v2-w12-cheatsheet/T18.md state to done.
  THEN append an Amendment to specs/awsf-v2-w12-cheatsheet.html recording the CLOSE of milestone M4:
    - what is now observably true, including which fact classes are fenced and which were routed
    - every task in it and its final state, naming any [f] row and the block that holds it
    - the friction it hit, and what a later milestone must now do differently
    - the decisions made inside the milestone that the plan did not already carry
    - the landing commit SHAs and the suite counts at close
  Append the modified date to the metadata header in the same commit.
  Do NOT touch specs/awsf-v2-plan.html.
```

### T19 — Run one: the dashboard visual redesign

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6 · reasoning medium
  WHY     the session records and observes; the driving is the owner's and the engineering is the
          factory's. THIS TASK SPENDS PROVIDER QUOTA.

TASK 19 of 23. Plan: specs/awsf-v2-w12-cheatsheet.html, milestone M5. THIS IS THE ACCEPTANCE TEST.
PREDECESSORS: T18 is [x]. THE OWNER IS PRESENT AND DRIVING.

READ FIRST
  specs/awsf-v2-w12-cheatsheet.html - M5 IN FULL, especially the delta diagram, Q12, and Q1's cost
    block
  specs/tickets/awsf-v2-w12-cheatsheet/README.md - the T01 protocol, unchanged
  docs/cheatsheet.html - the document being tested
  AGENTS.md - invariant 1

DO
  Write the request as A REQUEST - a paragraph of what is wanted: the dashboard carried to the Forest
  palette in a desktop view, keeping its existing structure. NOT a plan, a task breakdown or an
  acceptance list. W12 supplies the request; THE FACTORY plans it.
  The OWNER drives it end to end through marimba by FOLLOWING THE DOCUMENT AND NOTHING ELSE, to the
  owner act with the evidence that act requires.
  Record every consultation of any source other than the document, verbatim, with where on the leg it
  happened and what question it answered.
  Record where the driver looked FIRST before consulting.
  Record what the reference half was used for, and what in it was never opened.
  Record the run's cost, and whether it matched what the document said it would cost.
  State the limit in the record: the driver is the factory's author, so this proves the document is
  SUFFICIENT TO DRIVE WITH and not that it is COMPREHENSIBLE TO SOMEBODY NEW.
  Scrub and keep raw notes outside the repository.

DO NOT
  Plan the task. Coach. Adjust the protocol because the run is going badly. Edit the document - T20
  needs it unchanged so the delta means something. Report the run as a clean external pass.
  Substitute yourself for the driver.

IF THE FACTORY FAILS THE TASK for reasons unrelated to the document, that is recorded as its own
finding and does not fail this task's document rows. T21 keeps the two claims apart.

DONE WHEN
  Every consultation is recorded verbatim in specs/tickets/awsf-v2-w12-cheatsheet/README.md with
  where the driver looked first, the reference half's used and unused sections are recorded, the cost
  is recorded, the stated limit is written, and no identifier or machine path survives the scrub.
  npm run test:unit passes.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    docs(w12): record graduation run one and every consultation it needed
  Body: what the run proves and what it does not, what the factory produced, and the cost.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.

MARKERS
  Flip milestone M5's header to [wip] and task 19's checklist to [x] in
  specs/awsf-v2-w12-cheatsheet.html. Flip specs/tickets/awsf-v2-w12-cheatsheet/T19.md state to done.
  Do NOT touch specs/awsf-v2-plan.html.
```

### T20 — Run two: the backlog view, and the delta between the runs

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6 · reasoning medium
  WHY     the same observation job as T19, plus one comparison; the interpretation rules are already
          written in the plan and this task applies them. THIS TASK SPENDS PROVIDER QUOTA.

TASK 20 of 23. Plan: specs/awsf-v2-w12-cheatsheet.html, milestone M5.
PREDECESSORS: T19 is [x]. THE OWNER IS PRESENT AND DRIVING. THE DOCUMENT IS UNCHANGED SINCE T19.

READ FIRST
  specs/awsf-v2-w12-cheatsheet.html - M5 task 20, AC-10, the delta diagram and its caption
  specs/tickets/awsf-v2-w12-cheatsheet/README.md - the T01 protocol and run one's record

DO
  Write the second request as a paragraph - the dashboard's backlog view brought up to date so it
  reads the spine, the deep plans and the ticket states - and let the FACTORY plan it.
  Run THE SAME PROTOCOL, UNCHANGED. A protocol adjusted between runs makes the delta meaningless.
  Record consultations exactly as in run one, so the two counts are comparable.
  Record THE DELTA: how many consultations each run needed, which sections were consulted in the
  first and not the second, and which were never opened in either.
  INTERPRET IT HONESTLY, against the plan's three readings:
    - a fall means the document is being learned from
    - FLAT OR RISING IS A FINDING ABOUT THE DOCUMENT, not about the driver
    - a fall to zero is checked against whether the driver read it or remembered it, and recorded
      either way
  Record a section never opened in either run as a finding about the document's shape, not as proof
  it is unnecessary.
  State the same limit as run one.

DO NOT
  EDIT THE DOCUMENT between the two runs or during this one - repairs happen in T21, and an edit
  mid-series makes the delta a measurement of the edit. Adjust the protocol. Plan the task. Report a
  flat count as a neutral result.

DONE WHEN
  Run two's consultations and the delta are recorded and interpreted in the ticket README, the
  reading it fell under is named, and no identifier or machine path survives the scrub.
  npm run test:unit passes.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    docs(w12): record graduation run two and the delta between the runs
  Body: the two consultation counts, which reading the delta fell under, and what the factory produced.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.

MARKERS
  Flip task 20's checklist to [x] in specs/awsf-v2-w12-cheatsheet.html and
  specs/tickets/awsf-v2-w12-cheatsheet/T20.md state to done.
  Do NOT touch specs/awsf-v2-plan.html.
```

### T21 — Close the residue: answer it, route it, or name it as an absence

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6 · reasoning high
  WHY     every consultation is a fork between editing a sentence and widening the workstream, and
          the wrong choice produces a plausible result with no error anywhere

TASK 21 of 23. Plan: specs/awsf-v2-w12-cheatsheet.html, milestone M5.
PREDECESSORS: T20 is [x] or [f] with its block named. Both runs are recorded.

READ FIRST
  specs/awsf-v2-w12-cheatsheet.html - M5 task 21, AC-11, INV-7, and the scope table
  specs/tickets/awsf-v2-w12-cheatsheet/README.md - both runs' records and the T03 dispositions

DO
  Give every recorded consultation FROM BOTH RUNS exactly one disposition, using T03's four
  categories.
  Answer every DOCUMENT consultation at the point on the leg where it happened, then RE-RUN EVERY
  FENCE - the class fences, the index fence, the warning fence and the offline fence.
  Write every ROUTE request against its owning workstream and mark the corresponding plan row [f]
  with the block named.
  Record every ACCEPTED ABSENCE in the document's limits section AND in the ticket README.
  Record what the factory PRODUCED for each real task and whether each landed - SEPARATELY from what
  the document proved, because they are different claims.

DO NOT
  Build anything to close a consultation. One that needs a command is a route. Answer a consultation
  by moving it to a gotchas section. Merge two because they look similar. Let a factory failure be
  recorded as a document failure, or the reverse.

DONE WHEN
  Every consultation from both runs carries one disposition, every DOCUMENT answer is in place, every
  fence is green again, every ROUTE has a written request and a named [f] row, and each factory
  result is recorded separately.
  npm run test:unit passes; lint and typecheck exit 0.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    docs(w12): close every consultation from both graduation runs
  Body: what was answered, what was routed and to whom, what was accepted as an absence, and what the
  factory produced for each task.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.

MARKERS
  Flip task 21's checklist to [x] in specs/awsf-v2-w12-cheatsheet.html and
  specs/tickets/awsf-v2-w12-cheatsheet/T21.md state to done.
  Do NOT touch specs/awsf-v2-plan.html.
```

### T22 — M5 Testing Strategy

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6 · reasoning medium
  WHY     completeness and honesty checks over a record, plus a full fence re-run after T21's edits

TASK 22 of 23. Plan: specs/awsf-v2-w12-cheatsheet.html, milestone M5. CLOSES M5.
PREDECESSORS: T19, T20 and T21 are [x] or [f] with their blocks named.

READ FIRST
  specs/awsf-v2-w12-cheatsheet.html - M5 task 22, AC-9, AC-10, AC-11, Q7, and the M5 loop banner
  specs/tickets/awsf-v2-w12-cheatsheet/README.md - both graduation records

DO
  Verify every consultation from both runs appears with exactly one disposition.
  Verify the delta is recorded and interpreted, and that the record NAMES WHICH OF THE THREE READINGS
  it fell under.
  Verify the record states plainly what the runs prove and what they do not, and NAMES THE DEFERRED
  TWO-READER ATTEMPT AS FUTURE WORK rather than as a pending gate.
  Re-run npm run test:unit over the edited document, including every induced-failure leg.
  Verify any row that cannot be made green is [f] with its blocking workstream named IN THE PLAN, not
  in the ticket alone.

DO NOT
  Let an author-driven run be recorded as a clean external pass. Close a row green on the strength of
  a review rather than the runs. Treat the deferred second-reader attempt as blocking. Accept a delta
  that was recorded but not interpreted.

DONE WHEN
  Every M5 checklist row is green or [f] with its block named. npm run test:unit passes; lint and
  typecheck exit 0.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    test(w12): verify the graduation record is complete and honest about its strength
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.

MARKERS
  Flip milestone M5's header to [x] in specs/awsf-v2-w12-cheatsheet.html and every remaining
  checklist box in it. Flip specs/tickets/awsf-v2-w12-cheatsheet/T22.md state to done.
  THEN append an Amendment to specs/awsf-v2-w12-cheatsheet.html recording the CLOSE of milestone M5:
    - what is now observably true, and precisely what the two runs prove and do not
    - the delta and the reading it fell under
    - every task in it and its final state, naming any [f] row and the block that holds it
    - what the factory produced for each real task, recorded separately from what the document proved
    - the landing commit SHAs and the suite counts at close
  Append the modified date to the metadata header in the same commit.
  Do NOT touch specs/awsf-v2-plan.html.
```

### T23 — Close, and hand over the owner-side package

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6 · reasoning high
  WHY     this closes v2's core, and the spine Amendment it writes is the record of what the whole
          expansion delivered as much as of what this workstream did

TASK 23 of 23. Plan: specs/awsf-v2-w12-cheatsheet.html, milestone M6. CLOSES THE WORKSTREAM AND v2.
PREDECESSORS: T04, T10, T15, T18 and T22 are all [x] or [f] with their blocks named.

READ FIRST
  specs/awsf-v2-w12-cheatsheet.html - IN FULL, every marker and every Amendment
  specs/awsf-v2-plan.html - the W12 block, its checklist, and the W13/W14 preconditions naming W12
  specs/tickets/awsf-v2-plan/W12.md - the spine ticket this task closes
  the owner's external technical-reference document - §08's workstream table and §19's extension
    template, which is the shape the handover must take
  AGENTS.md - invariant 2, which this task is the last chance to breach

DO
  Confirm every marker in this plan reads [x] or [f], and that every [f] names its blocking workstream.
  Run npm test and record the suite counts and wall time. Run npm run lint and npm run typecheck.
  Append the M6 closing Amendment to this plan.
  IN THE SAME COMMIT, flip specs/awsf-v2-plan.html's Milestone M12 / W12 marker and its checklist,
  and flip specs/tickets/awsf-v2-plan/W12.md's state to done.
  THEN append an Amendment to specs/awsf-v2-plan.html recording the CLOSE of W12:
    - what this workstream delivered against the spine's claim for it, claim by claim
    - which spine Questionables it touched, and how
    - the friction and the surprises, including anything the spine assumed wrongly
    - anything it routed to another workstream rather than building, and to which one
    - every row that closed [f], with the block that holds it
    - the landing commit SHA and this plan's final suite counts
  IF ANY ROW CLOSED [f], state EXPLICITLY in the spine Amendment whether W12 satisfies the
  "v2's core lands (W01-W08, W11, W12 all [x])" precondition that W13 and W14 both name, per Q9.
  PREPARE THE OWNER-SIDE HANDOVER, which is NOT committed to this repository: the corrected §08 rows
  for the external technical-reference document (W11 is now [x], W12's state changes, and W01's "six
  owner-act command shapes" is seven), a new marimba subsection describing how a person drives the
  factory, a link to the cheatsheet, and the extension prompt in the shape that document's own §19
  specifies. Hand it to the owner as text.
  Name the deferred two-reader attempt as future work with what it would prove.

DO NOT
  Flip any marker for W09, W10, W13 or W14. Flip W12 before every leaf marker is settled. Close a row
  green on the strength of a review rather than the evidence its row names. Commit the handover
  package into this repository.

DONE WHEN
  Every marker in both plans is settled, npm test passes with its counts recorded, lint and typecheck
  exit 0, both Amendments are written, and the owner has the handover package.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    docs(w12): close the cheatsheet workstream and v2's core
  Body: what W12 delivered, what it routed, every [f] row with its block, and the Q9 answer on the
  W13/W14 precondition.
  Include both plans' marker flips and both tickets' `state:` changes IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.

MARKERS
  This is the only ticket that writes to specs/awsf-v2-plan.html. Append the modified date and the
  agent name there too, per that plan's own metadata convention.
```
