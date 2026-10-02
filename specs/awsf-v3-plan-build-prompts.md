# Build Prompts — AWSF v3, the spine

Companion to [`awsf-v3-plan.html`](./awsf-v3-plan.html). Created 2026-10-02 alongside the plan and
[`tickets/awsf-v3-plan/`](./tickets/awsf-v3-plan/).

**Every prompt in this file is a meta-prompt.** It authors one workstream's deep plan and stops at
the owner-review gate. None of them writes implementation code. The deep plan a prompt produces
carries its own build prompts, and those write code later. W05 is the one exception in shape: its
deep plan already exists as v2's W19, so its prompt re-cuts that plan instead of authoring a new one.

Each prompt is written for a fresh session with no prior context. Copy one, run it to completion,
review what it produced, clear context, move to the next.

---

## Why there is no Section A

Each milestone in this spine holds exactly one workstream, so a milestone prompt and a workstream
prompt would be the same prompt written twice. Section B is the whole file.

---

## Before anything: four gates

1. **Owner approval of the spine.** No deep plan is authored before the owner approves
   `specs/awsf-v3-plan.html`, recorded as an exported `plan-sota-review v1` block or an Amendment.
2. **GR, the reliability gate (intent decision 13).** No workstream that widens what runs without
   the owner lands that widening before W02 is `[x]`. It binds W05, W06, W07 (its agent-driven
   half), W08, W10, W13 and W14, each of which lists W02 in `depends_on`.
3. **GA, the amendment gate.** Every invariant or protected-path change is proposed one at a time
   and lands as an owner-authored commit before the build that depends on it. No session invents a
   way for an agent to write a protected path.
4. **GM, manual deep-plan authoring.** No factory role can write `specs/*.html` today, so every
   session in this file is a manual, logged exception until W03 lands a closure path. Implementation
   inside each deep plan defaults to managed execution through the factory (decision 7).

W18 closed on 2026-10-02 in the owner's bookkeeping commit. No prompt here depends on it.

---

## Decisions already taken — do not reopen these

The spine's thirteen Questionables were also decided by the owner on 2026-10-02, each as
recommended. Each prompt below hands its workstream's decisions over under
`DECIDED 2026-10-02 - APPLY, DO NOT REOPEN`.

All fourteen are in `specs/awsf-v3-intent.md` and the spine's Shared Invariants section. The
assessment's Q1–Q16 are closed by them.

| # | Decision |
|---|---|
| 1 | Subscriptions first. API or paid compute is an exception with a stated budget. |
| 2 | No frontier output in training data. |
| 3 | MacBook Pro M5 Pro, 64 GB, is the planning baseline; AWSF runs there in a Linux VM; WSL until it arrives. |
| 4 | Landing stays human-only through v3. |
| 5 | Routing is an owner-approved policy, superseding v2 intent decision 5. |
| 6 | No unattended daemon. A foreground harness the owner launches is allowed. |
| 7 | The factory builds AWSF by default. Direct sessions are a logged exception. |
| 8 | A light planning tier; closed v2 specs leave the priming path; reference docs generated from code. |
| 9 | The harness: dashboard panel first, then a native app; one card per run; owner acts only prepared; the intent list. |
| 10 | The user-testing validator: scripted checks from AC ids first, agent exploration second. |
| 11 | W19 rebased; M3–M4 finished as planned; M5 → W07, M6–M7 → W09, M8 → W10. |
| 12 | Smart Health deploys to a staging channel; production release is an owner act. |
| 13 | Reliability before autonomy (gate GR). |
| 14 | No model emits an owner act, in any harness, in any spelling. |

---

## Conventions used by every prompt

**Marker discipline.** You are authoring. Do not flip any marker in `specs/awsf-v3-plan.html` and do
not change any `state:` in `specs/tickets/awsf-v3-plan/`. A spine marker moves to `[wip]` in the
owner's commit approving that deep plan, and to `[x]` only when the deep plan's final milestone
lands, with the ticket state in the same commit (invariants 2 and 12). Every marker in the deep plan
you author starts `[]`.

**The authoring precondition.** Workstream N's deep plan is authored after every workstream in its
`depends_on` has an approved deep plan (spine marker at least `[wip]`). Landing preconditions, GR
above all, belong to the deep plans and are stated in each prompt.

**What every deep plan owes.** Ordered milestones with a testing strategy and offline validation
commands each · resolution of the Questionables the spine assigns it · evidence and the cheapest
unused upgrade for every decision-bearing claim · for every boundary, what it does not cover · each
amendment written for GA, never as one of its own tasks · one writable repository per milestone · a
trap for every new stop kind, in W02's format once it lands · its own build prompts and ticket set,
which the sync fence pairs against it · no skill in the execution path.

**The fence's traps, measured in this repository.** Tickets carry their Section B block byte for
byte, with `## Handoff` above `## Build prompt`. No tracked file name may match `/manifest/i` or
`/receipt/i`. Credential-shaped prose (for example `Bearer` or `Basic` followed by a long word)
fails `dashboard/shared/credential-patterns.ts`. No session id, attempt id or machine path in any
committed file. Corpus-count tests are property checks: bump nothing.

**Never, in any of these sessions:** write implementation code · edit `AGENTS.md`,
`awsf.config.yaml`, `awsf.project.yaml` or anything under `docs/driving/` · edit
`specs/awsf-v3-intent.md` or the assessment · flip a spine marker · name an agent, model or tool as
author, committer or co-author.

---

# Section B — Task prompts (recommended)

Fifteen prompts, one per workstream, in the spine's order. Headings are numbered `T<nn>` because the
sync fence parses this section with a `T`-anchored pattern. The workstream identity is the `W<nn>`
in the title, and the ticket is `specs/tickets/awsf-v3-plan/W<nn>.md`.

### T01 — W01 · Driver checks

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5.5 · EFFORT high
  GPT     codex:gpt-6-sol · reasoning high
  WHY     K1 touches the first lifecycle edge, which is protected, and the evidence it rests
          on is a draft the owner has not confirmed.

TASK 1 of 15. Plan: specs/awsf-v3-plan.html. Milestone: M1.
WORKSTREAM: W01 - Driver checks (intent X1, Phase A).
REPOSITORY: this AWSF checkout. You write only the deep plan, its build prompts and its ticket set.

You are authoring a DEEP PLAN. You write no implementation code.

EXECUTION
  Manual, logged exception (gate GM): no factory role can write specs/*.html until W03 lands.
  Record this session in the deep plan's Amendments as a direct-session exception.
  The deep plan's implementation tasks default to managed execution through the factory.

PREDECESSORS
  None. This workstream can start once the owner approves the spine.

READ FIRST
  AGENTS.md - all thirteen invariants
  specs/awsf-v3-plan.html - the W01 block IN FULL, "Shared Invariants and Constraints",
    Questionable Q1, and Notes
  specs/awsf-v3-intent.md - Terms (K1, K2) and decisions 13 and 14
  specs/awsf-v3-assessment-and-direction.md - N3, F17, A10, A12 and the codes table
  core/src/state/task-machine.ts - LEGAL_EDGES and edge L1
  core/src/cli/commands/cancel.ts, attribute.ts, core/src/contracts/attribution-record.ts
  core/src/cli/main.ts - where status.nextAction is printed
  docs/driving/marimba/marimba-guard-rules.mts and core/test/unit/meta/marimba-guard-pi.test.ts

DO
  Invoke /plan-sota with QUESTIONABLE true to author specs/awsf-v3-w01-driver-checks.html, its
  -build-prompts.md, and specs/tickets/awsf-v3-w01-driver-checks/ with a README.
  Cover four parts, each with its own milestone or a stated reason to share one:
  K1 - edge L1 (DRAFT -> PREPARED) refuses without a driver preflight record: suite green at
       HEAD, write boundary covers the named paths, grant present for protected paths, native
       Git storage, no duplicate task, the four-line request with named paths confirmed, prior
       attempts consulted.
  K2 - awsf next --json: the legal next steps and who may take each, from LEGAL_EDGES and
       OWNER_ACTS. The prose nextAction becomes derived from it.
  The guard fix (A10) - the owner-act matcher also matches npm run awsf [--silent] -- <act>,
       with a test per owner act per spelling.
  Causes (A12) - a driver attribution cause, a required reason on awsf cancel, a cause on
       every cancelled attempt.

DECIDED 2026-10-02 - APPLY, DO NOT REOPEN
  Q1 - the host measures every field it can observe, including prior attempts consulted (the
       record cites each prior attempt id, checked against the journal). The only attested
       field is the confirmed four-line request, checked by the owner's recorded confirmation.

AMENDMENTS AND OWNER-SIDE WORK
  docs/driving/** is protected: the guard fix lands as an owner commit under GA.
  If K1 changes edge L1 in core/src/state/**, that is a second owner commit. Write down the
  alternative that avoids it: enforce K1 in the command that fires L1.
  A projection column for causes is a migration, which is protected.
  Backfilling causes from the forensics draft is an owner act per attempt, never a task.
  CHEAPEST UNUSED UPGRADE: the owner confirms the forensics draft's causes before K1's field
  list freezes. Say whether the plan waits for it.

DO NOT
  Write implementation code. Edit a protected path. Flip a marker. Let any K1 field be
  satisfied by the driver's say-so without naming it as attested.

BUILDER READY
  node --experimental-strip-types --test core/test/unit/meta/ticket-plan-sync.test.ts passes
  with the new ticket set, npm run test:unit is green, and git status --porcelain shows only
  the new files under specs/.

OWNER ACCEPTANCE
  The owner reviews the deep plan, including how it applies Q1, then approves it or returns a
  plan-sota-review v1 block for a session to apply.

COMMIT
  Manual: commit only if the owner authorizes it in this session, as Santiago Marin
  <santiagomarinsuarez@me.com>. Otherwise leave the files uncommitted and return a proposed
  message: docs(specs): author the AWSF v3 W01 driver-checks deep plan
  Never name an agent, model or tool in commit identity, message or trailers.

MARKERS
  Flip nothing. W01 moves to [wip] in the owner's approving commit, with W01.md's state.

HANDOFF
  Return dated findings for W02, W05, W08 and W10: the K1 field list, the K2 output shape and
  the cause vocabulary. The owner persists them in those tickets' Handoff sections.

STOP WHEN
  The deep plan is authored, every open decision is surfaced, and the owner has it in hand.
```

### T02 — W02 · Trap suite

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5.5 · EFFORT high
  GPT     codex:gpt-6-sol · reasoning high
  WHY     this workstream's completion opens gate GR for seven others, so "every known trap"
          must be defined so that it can actually close.

TASK 2 of 15. Plan: specs/awsf-v3-plan.html. Milestone: M2.
WORKSTREAM: W02 - Trap suite (intent X2, Phase A).
REPOSITORY: this AWSF checkout. You write only the deep plan, its build prompts and its ticket set.

You are authoring a DEEP PLAN. You write no implementation code.

EXECUTION
  Manual, logged exception (gate GM). Record this session in the deep plan's Amendments.
  The deep plan's implementation tasks default to managed execution through the factory.

PREDECESSORS
  W01's deep plan approved (spine marker at least [wip]). Traps assert K1's refusals, and
  W01's cause record names the trap a stop needs.

READ FIRST
  AGENTS.md - invariants 3, 4, 6 and 10
  specs/awsf-v3-plan.html - the W02 block IN FULL, gate GR, Questionables Q2 and Q13, Notes
  specs/awsf-v3-intent.md - Terms (K5), decision 13
  specs/awsf-v3-assessment-and-direction.md - "To prevent future friction"
  W01's deep plan - the K1 field list and the cause vocabulary
  core/src/cli/commands/doctor.ts - what it checks today, and that it has no repair path
  core/test/journeys/ - how the production runner is driven on stub routes
  git show 07b20f9 7bc48b5 - the regression and its fix
  awsf.config.yaml - gates (what the runner runs), recorded in awsf.project.yaml

DO
  Invoke /plan-sota with QUESTIONABLE true to author specs/awsf-v3-w02-trap-suite.html, its
  -build-prompts.md, and specs/tickets/awsf-v3-w02-trap-suite/ with a README.
  K5 - a trap suite on the stub adapter. Each trap reproduces a recorded stop's preconditions
       and asserts refusal before any provider call (zero reserved calls). Seed it from every
       past stop and the live gotchas. Define the catalogue's dated cut and the rule for every
       stop after it: a trap, or a recorded reason none is possible.
  awsf doctor - Git storage on a native filesystem, provider CLIs present and logged in, quota
       windows, stale branches and worktrees, open markers on landed work. Read-only; probes
       that spawn go through core/src/execution/transport-broker.ts (invariant 3).
  Use the 07b20f9 episode in the rationale: a new bwrap check needed the resolved path the real
  broker records, the journeys' fake broker recorded a bare bwrap, 31 protected-grant journeys
  went BLOCKED, and it landed because the gates do not run journeys.

DECIDED 2026-10-02 - APPLY, DO NOT REOPEN
  Q2 - a separate test:traps layer on the stub adapter. Every cause record names a trap id or
       the reason none is possible, and a cause naming a missing trap is a red test.
  Q13 - test:journeys becomes a full landing gate, timeout 2,400 s. Make landing it this deep
        plan's first task. A trial on 2026-10-02 failed 74 journeys and 2 unit tests: the
        journey harness's fake runner answers only test, typecheck and lint, the loader's
        KNOWN_GATE_IDS and the cheatsheet know only those three, and a prove replay binds every
        configured gate. Fix those, then the owner commits the gate to awsf.config.yaml's gates
        (recorded in awsf.project.yaml).

AMENDMENTS AND OWNER-SIDE WORK
  Any further gate, the trap layer included, edits awsf.config.yaml's gates and its record in
  awsf.project.yaml, both protected: an owner commit under GA.
  Confirming the seed list from the forensics draft is the owner's.
  CHEAPEST UNUSED UPGRADE: replay the forensics list's stops on the stub adapter before fixing
  the trap format.

DO NOT
  Write implementation code. Edit a protected path. Give doctor a repair path. Call a trap
  green without a mutation check that turns it red when its refusal is removed.

BUILDER READY
  node --experimental-strip-types --test core/test/unit/meta/ticket-plan-sync.test.ts passes
  with the new ticket set, npm run test:unit is green, and git status --porcelain shows only
  the new files under specs/.

OWNER ACCEPTANCE
  The owner reviews the deep plan, including how it applies Q2 and Q13, then approves it or
  returns a plan-sota-review v1 block.

COMMIT
  Manual: commit only if the owner authorizes it in this session, as Santiago Marin
  <santiagomarinsuarez@me.com>. Otherwise leave the files uncommitted and return a proposed
  message: docs(specs): author the AWSF v3 W02 trap-suite deep plan
  Never name an agent, model or tool in commit identity, message or trailers.

MARKERS
  Flip nothing. W02's [x] opens gate GR, so its final milestone must state that condition.

HANDOFF
  Return dated findings for W05-W08, W10-W14: the trap format, where it lives, and how each
  deep plan adds traps for its own new stop kinds.

STOP WHEN
  The deep plan is authored, every open decision is surfaced, and the owner has it in hand.
```

### T03 — W03 · Ticket closure

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5.5 · EFFORT high
  GPT     codex:gpt-6-sol · reasoning high
  WHY     the tempting answer widens a write glob and removes the only fence in front of the
          plan a worker is judged against.

TASK 3 of 15. Plan: specs/awsf-v3-plan.html. Milestone: M3.
WORKSTREAM: W03 - Ticket closure (intent X3, Phase A; promoted from v2 W15).
REPOSITORY: this AWSF checkout. You write only the deep plan, its build prompts and its ticket set.

You are authoring a DEEP PLAN. You write no implementation code.

EXECUTION
  Manual, logged exception (gate GM): this is the workstream that retires GM.
  Record this session in the deep plan's Amendments.

PREDECESSORS
  None. This workstream can start once the owner approves the spine.

READ FIRST
  AGENTS.md - invariants 2 and 12
  specs/awsf-v3-plan.html - the W03 block IN FULL, gate GM, and Notes
  specs/awsf-v2-plan-build-prompts.md - the T15 (W15) prompt: its contradiction, its fixed
    first task, and why a widened write scope is not the answer at any width
  awsf.config.yaml - every role's writes, and policy.protected_paths
  core/src/cli/commands/land.ts - confirm it still flips nothing
  core/test/unit/meta/ticket-plan-sync.test.ts - what it checks, and what it does not

THE CONTRADICTION THIS WORKSTREAM RESOLVES
  Every ticket prompt requires the plan marker and ticket state to flip in one commit. No role
  can write specs/*.html. Nothing in core/src flips either. So no factory task closes its own
  ticket, and plans drift from code (W18 M5 sat on main with its markers open until a manual
  bookkeeping commit on 2026-10-02).

DO
  Before anything: confirm no role's writes was widened into specs/ since v2 W15 was declared.
  If one was, report it and stop.
  Invoke /plan-sota with QUESTIONABLE true to author specs/awsf-v3-w03-ticket-closure.html, its
  -build-prompts.md, and specs/tickets/awsf-v3-w03-ticket-closure/ with a README.
  Milestone one, task one, is fixed: an owner-authored amendment adding specs/*.html to
  policy.protected_paths, landed under GA before any closure mechanism is designed.
  Closure is an owner-confirmed act that changes markers and ticket states only, in one commit.
  Include decision 8's light tier: a task with no deep plan, closed by the same path.

THE PROPERTY FIXED REGARDLESS OF DESIGN
  Whatever closes a ticket cannot change what that ticket asked for.

AMENDMENTS AND OWNER-SIDE WORK
  The protected-path amendment above. Any change to land.ts's confirmation is an owner act's
  surface and must stay at the owner's terminal.

DO NOT
  Write implementation code. Widen any role's writes into specs/. Let a closing commit touch an
  acceptance row, a prompt byte or a declaration.

BUILDER READY
  node --experimental-strip-types --test core/test/unit/meta/ticket-plan-sync.test.ts passes
  with the new ticket set, npm run test:unit is green, and git status --porcelain shows only
  the new files under specs/.

OWNER ACCEPTANCE
  The owner reviews the deep plan and approves it or returns a plan-sota-review v1 block.

COMMIT
  Manual: commit only if the owner authorizes it in this session, as Santiago Marin
  <santiagomarinsuarez@me.com>. Otherwise leave the files uncommitted and return a proposed
  message: docs(specs): author the AWSF v3 W03 ticket-closure deep plan
  Never name an agent, model or tool in commit identity, message or trailers.

MARKERS
  Flip nothing. When W03 is [x], gate GM is retired and later deep plans may be authored
  through the factory.

HANDOFF
  Return dated findings for W09 (what counts as a closed spec) and for every later deep-plan
  session (how to author through the factory once GM is retired).

STOP WHEN
  The deep plan is authored, every open decision is surfaced, and the owner has it in hand.
```

### T04 — W04 · Session record

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5.5 · EFFORT high
  GPT     codex:gpt-6-sol · reasoning high
  WHY     the record feeds metrics, evals and training, and its location is an open decision
          with a protected-path cost either way.

TASK 4 of 15. Plan: specs/awsf-v3-plan.html. Milestone: M4.
WORKSTREAM: W04 - Session record (intent X4, Phase A).
REPOSITORY: this AWSF checkout. You write only the deep plan, its build prompts and its ticket set.

You are authoring a DEEP PLAN. You write no implementation code.

EXECUTION
  Manual, logged exception (gate GM). Record this session in the deep plan's Amendments.
  The deep plan's implementation tasks default to managed execution through the factory.

PREDECESSORS
  None. This workstream can start once the owner approves the spine.

READ FIRST
  AGENTS.md - invariants 1, 6, 7, 9 and 10
  specs/awsf-v3-plan.html - the W04 block IN FULL, Questionables Q4 and Q11, gate GM
  specs/awsf-v3-intent.md - decision 7 and the acceptance targets
  specs/awsf-v3-assessment-and-direction.md - A14 and the KPI table
  core/src/observability/ - projector.ts, sqlite.ts and migrations/
  dashboard/shared/credential-patterns.ts

DO
  Invoke /plan-sota with QUESTIONABLE true to author specs/awsf-v3-w04-session-record.html, its
  -build-prompts.md, and specs/tickets/awsf-v3-w04-session-record/ with a README.
  The driving-session archive moves into the state root, scrubbed with AWSF's credential
  patterns and projected, so the dashboard shows each driving session cycle by cycle across
  compactions (A14). Measure owner asks captured. Log and count direct-session exceptions.

DECIDED 2026-10-02 - APPLY, DO NOT REOPEN
  Q4 - the archiver lives in AWSF core; the harness writes the core format.
  Q11 - direct sessions are derived from git and the journal: any code commit on main no
        factory landing produced. Each needs a journaled reason record; one without shows as
        unexplained in awsf metrics.

AMENDMENTS AND OWNER-SIDE WORK
  Every migration is protected: an owner commit under GA.
  Invariant 7 only if a runtime dependency is needed; Node built-ins are the default.
  Moving the existing machine-local archive into the state root is owner-side.

DO NOT
  Write implementation code. Commit a session record or any runtime artefact (invariant 10).
  Write a machine path into a committed file.

BUILDER READY
  node --experimental-strip-types --test core/test/unit/meta/ticket-plan-sync.test.ts passes
  with the new ticket set, npm run test:unit is green, and git status --porcelain shows only
  the new files under specs/.

OWNER ACCEPTANCE
  The owner reviews the deep plan, including how it applies Q4 and Q11, then approves it or
  returns a plan-sota-review v1 block.

COMMIT
  Manual: commit only if the owner authorizes it in this session, as Santiago Marin
  <santiagomarinsuarez@me.com>. Otherwise leave the files uncommitted and return a proposed
  message: docs(specs): author the AWSF v3 W04 session-record deep plan
  Never name an agent, model or tool in commit identity, message or trailers.

MARKERS
  Flip nothing.

HANDOFF
  Return dated findings for W08 and W10: the record format and where it lives.

STOP WHEN
  The deep plan is authored, every open decision is surfaced, and the owner has it in hand.
```

### T05 — W05 · Authority

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5.5 · EFFORT high
  GPT     codex:gpt-6-sol · reasoning high
  WHY     the deep plan already exists; this is a re-cut of a live plan with seven tickets done,
          plus one new milestone and one invariant amendment.

THE DEEP PLAN FOR THIS WORKSTREAM IS ALREADY AUTHORED.
specs/awsf-v2-w19-jev-delegate.html was written on 2026-09-28 with its build prompts and a
twenty-eight-ticket set at specs/tickets/awsf-v2-w19-jev-delegate/. M1-M2 (tasks 1-7) are [x]
on main. Do not author a second plan, and do not re-home it under awsf-v3-w05-authority: that
would orphan its ticket set and the SHAs its records cite. The owner confirmed this on 2026-10-02.

TASK 5 of 15. Plan: specs/awsf-v3-plan.html. Milestone: M5.
WORKSTREAM: W05 - Authority (intent X5, Phase B; carries v2 W19).
REPOSITORY: this AWSF checkout. You edit only W19's plan, its build prompts and its ticket set,
plus the Handoff sections of specs/tickets/awsf-v3-plan/W07.md, W09.md and W10.md.

EXECUTION
  Manual, logged exception (gate GM). Record this session in W19's Amendments.

PREDECESSORS
  W01's and W02's deep plans approved (spine markers at least [wip]). Delegate acts are expressed
  in K2's actor model, and GR binds this workstream.

READ FIRST
  AGENTS.md - invariants 12 and 13
  specs/awsf-v3-plan.html - the W05 block IN FULL, gate GR, and Notes ("Reading decisions 11
    and 13 together")
  specs/awsf-v3-intent.md - decisions 1, 11 and 13
  specs/awsf-v2-w19-jev-delegate.html - IN FULL, with its Amendments
  specs/awsf-v2-w19-jev-delegate-build-prompts.md and specs/tickets/awsf-v2-w19-jev-delegate/
  W01's deep plan - K2's actor model
  The local ref backup/w19-jev-delegate-pre-rebase-6d6b79d holds the pre-rebase SHAs W19 cites.

DO
  Invoke /plan-sota's Update Plan workflow on specs/awsf-v2-w19-jev-delegate.html.
  Keep M1-M4 as planned (decision 11).
  Move M5 (guardrail signals) to v3 W07, M6 (compaction judgment) and M7 (cheap reads) to v3
  W09, and M8 (the Delegate in the metrics tab) to v3 W10. Remove their tasks from W19's plan,
  Section B and ticket set, keeping task numbers and ticket ids contiguous, and record each
  move in an Amendment with what was carried.
  Add one milestone after M4: the OpenAI Decisions API as a shadow backend beside Jev. Its own
  single transport module, no agent phase holding its credential, proposals journaled side by
  side and compared at read time, and no path to lifecycle state. If the API still has no
  published docs or price, declare the milestone with that precondition rather than design
  against guesses.
  Apply GR: no lease is granted for a live night, and no leased live drive runs, until W02 is
  [x]. If the owner instead reads decision 13 as binding on landing M3-M4's code, M3-M4 wait for
  W02, and the plan says so.
  Write the carried tasks' content as dated findings into the Handoff sections of W07.md,
  W09.md and W10.md in specs/tickets/awsf-v3-plan/, above their Build prompt.

AMENDMENTS AND OWNER-SIDE WORK
  Invariant 13: propose the text for a second decision provider (its own single transport
  module, no agent phase receives its credential). It lands as an owner commit before the
  shadow milestone's build. Do not edit AGENTS.md yourself.
  W19's gates continue: G19-S, G19-C, G19-Q, G19-D, G19-T, G19-W. G19-D, G19-T and G19-W move
  with the milestones that need them.
  The Decisions API budget is a decision 1 exception, stated before its first call.

DO NOT
  Author a second plan. Write implementation code. Reopen W19's Q1-Q20 or D1-D3. Change any
  [x] marker or done ticket. Edit the v2 spine.

BUILDER READY
  node --experimental-strip-types --test core/test/unit/meta/ticket-plan-sync.test.ts passes
  for both awsf-v2-w19-jev-delegate and awsf-v3-plan, npm run test:unit is green, and git
  status --porcelain shows only the files named above.

OWNER ACCEPTANCE
  The owner reviews the re-cut and the invariant 13 proposal, then approves them or returns a
  plan-sota-review v1 block.

COMMIT
  Manual: commit only if the owner authorizes it in this session, as Santiago Marin
  <santiagomarinsuarez@me.com>. Otherwise leave the files uncommitted and return a proposed
  message: docs(specs): re-cut W19 as AWSF v3 W05 and add the Decisions API shadow
  Never name an agent, model or tool in commit identity, message or trailers.

MARKERS
  Flip nothing in the v3 spine. W05 moves to [wip] in the owner's approving commit and to [x]
  when the re-cut plan's final milestone lands.

STOP WHEN
  The owner has the re-cut plan in hand, or has returned it with an exported
  plan-sota-review v1 block for a session to apply.
```

### T06 — W06 · Routing within subscriptions

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5.5 · EFFORT xhigh
  GPT     codex:gpt-6-sol · reasoning xhigh
  WHY     this reverses a v2 decision, and a router that improvises spends the owner's quota
          where no one sees it.

TASK 6 of 15. Plan: specs/awsf-v3-plan.html. Milestone: M6.
WORKSTREAM: W06 - Routing within subscriptions (intent X6, Phase B).
REPOSITORY: this AWSF checkout. You write only the deep plan, its build prompts and its ticket set.

You are authoring a DEEP PLAN. You write no implementation code.

EXECUTION
  Manual, logged exception (gate GM), until W03 is [x]. Record this session in the deep plan's
  Amendments. The deep plan's implementation tasks default to managed execution.

PREDECESSORS
  W02's and W05's deep plans approved. The policy composes with W19's leases and its M4
  fallback route. GR: no policy-chosen route runs before W02 is [x].

READ FIRST
  AGENTS.md - invariants 3, 4, 7 and 13
  specs/awsf-v3-plan.html - the W06 block IN FULL, gate GR, Questionable Q3
  specs/awsf-v3-intent.md - decisions 1 and 5
  specs/awsf-v3-assessment-and-direction.md - N4 and F15
  specs/awsf-v2-w18-route-metrics.html - what the metrics can and cannot separate
  specs/awsf-v2-w19-jev-delegate.html - M4's route fallback, as re-cut by W05
  awsf.config.yaml - routing (no_fallback: true) and role routes

DO
  Invoke /plan-sota with QUESTIONABLE true to author specs/awsf-v3-w06-routing.html, its
  -build-prompts.md, and specs/tickets/awsf-v3-w06-routing/ with a README.
  Task class, route metrics and quota windows feed a route policy the owner approves. It
  chooses within bounds, journals every choice with the policy version and inputs, fails closed,
  and never spends on an API outside a lease. Provider failover. Lean delegation profiles (F15:
  20,897 -> 1,215 loaded tokens). Cache-stable prompt prefixes.

DECIDED 2026-10-02 - APPLY, DO NOT REOPEN
  Q3 - bounds per task class per provider window, plus a daily ceiling. The stricter of policy
       and lease wins, and only a lease authorises API spend.

AMENDMENTS AND OWNER-SIDE WORK
  The policy lives in awsf.config.yaml, a protected path: the owner writes it under GA.
  The v2 spine amendment recording decision 5's supersession is owner work.

DO NOT
  Write implementation code. Derive a per-task cost from an account-wide percentage. Let any
  runtime path reach an API route without a lease.

BUILDER READY
  node --experimental-strip-types --test core/test/unit/meta/ticket-plan-sync.test.ts passes
  with the new ticket set, npm run test:unit is green, and git status --porcelain shows only
  the new files under specs/.

OWNER ACCEPTANCE
  The owner reviews the deep plan, including how it applies Q3, then approves it or returns a
  plan-sota-review v1 block.

COMMIT
  Manual: commit only if the owner authorizes it in this session, as Santiago Marin
  <santiagomarinsuarez@me.com>. Otherwise leave the files uncommitted and return a proposed
  message: docs(specs): author the AWSF v3 W06 routing deep plan
  Never name an agent, model or tool in commit identity, message or trailers.

MARKERS
  Flip nothing.

HANDOFF
  Return dated findings for W08 and W10: how a harness or a local provider is routed.

STOP WHEN
  The deep plan is authored, every open decision is surfaced, and the owner has it in hand.
```

### T07 — W07 · User-testing validator

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5.5 · EFFORT high
  GPT     codex:gpt-6-sol · reasoning high
  WHY     the tooling choice can pull a runtime dependency into AWSF, and this host cannot
          drive a browser the usual way.

TASK 7 of 15. Plan: specs/awsf-v3-plan.html. Milestone: M7.
WORKSTREAM: W07 - User-testing validator (intent X7, Phase B).
REPOSITORY: this AWSF checkout. You write only the deep plan, its build prompts and its ticket set.

You are authoring a DEEP PLAN. You write no implementation code.

EXECUTION
  Manual, logged exception (gate GM), until W03 is [x]. Record this session in the deep plan's
  Amendments. The deep plan's implementation tasks default to managed execution.

PREDECESSORS
  W02's and W05's deep plans approved. W05's re-cut hands this workstream W19's M5; read this
  ticket's Handoff for what was carried. GR binds the agent-driven half.

READ FIRST
  AGENTS.md - invariants 3, 4 and 7
  specs/awsf-v3-plan.html - the W07 block IN FULL, gate GR, Questionable Q7
  specs/awsf-v3-intent.md - decision 10
  specs/tickets/awsf-v3-plan/W07.md - its Handoff (W19 M5's tasks)
  specs/awsf-v2-w05-design-to-plan.html - how AC ids thread from design to gates
  awsf.project.yaml - the preview build

DO
  Invoke /plan-sota with QUESTIONABLE true to author
  specs/awsf-v3-w07-user-testing-validator.html, its -build-prompts.md, and
  specs/tickets/awsf-v3-w07-user-testing-validator/ with a README.
  First: scripted browser checks generated from acceptance-criterion ids, run against the
  preview build before the owner's journey. A failing check stops the run with its AC id as
  the cause.
  Second: agent-driven exploration that never saw the code, reports gaps and never fixes them.
  It lands after GR.
  Carry W19 M5: the decision socket, the guard for pi roles and the Claude-route hooks.
  From WSL, headless Chrome's one-shot --screenshot works and its remote-debugging protocol
  does not. Design within that, or name the host it needs.

DECIDED 2026-10-02 - APPLY, DO NOT REOPEN
  Q7 - a browser-automation tool that ships its own Linux browser inside WSL, kept in the
       harness repository or its own package and invoked by the host as an argv gate. AWSF's
       dependency allowlist stays unchanged.

AMENDMENTS AND OWNER-SIDE WORK
  Invariant 7 only if a runtime dependency enters AWSF; the zero-dependency path is the
  default. Browser installation is owner-side.

DO NOT
  Write implementation code. Give the validator a write path. Let exploration land before GR.

BUILDER READY
  node --experimental-strip-types --test core/test/unit/meta/ticket-plan-sync.test.ts passes
  with the new ticket set, npm run test:unit is green, and git status --porcelain shows only
  the new files under specs/.

OWNER ACCEPTANCE
  The owner reviews the deep plan, including how it applies Q7, then approves it or returns a
  plan-sota-review v1 block.

COMMIT
  Manual: commit only if the owner authorizes it in this session, as Santiago Marin
  <santiagomarinsuarez@me.com>. Otherwise leave the files uncommitted and return a proposed
  message: docs(specs): author the AWSF v3 W07 user-testing-validator deep plan
  Never name an agent, model or tool in commit identity, message or trailers.

MARKERS
  Flip nothing.

HANDOFF
  Return dated findings for W13: what a validated build is, so staging receives only those.

STOP WHEN
  The deep plan is authored, every open decision is surfaced, and the owner has it in hand.
```

### T08 — W08 · Marimba harness v1

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5.5 · EFFORT xhigh
  GPT     codex:gpt-6-sol · reasoning xhigh
  WHY     a new repository, two writable repositories across milestones, and the schema that
          keeps every owner act out of a model's reach.

TASK 8 of 15. Plan: specs/awsf-v3-plan.html. Milestone: M8.
WORKSTREAM: W08 - Marimba harness v1 (intent X8, Phase B).
REPOSITORY: this AWSF checkout for this session. You write only the deep plan, its build prompts
and its ticket set. The harness repository does not exist yet and you do not create it.

You are authoring a DEEP PLAN. You write no implementation code.

EXECUTION
  Manual, logged exception (gate GM), until W03 is [x]. Record this session in the deep plan's
  Amendments. The deep plan's implementation tasks default to managed execution, the harness's
  through its own AWSF registration.

PREDECESSORS
  W01's, W02's and W04's deep plans approved. K3 builds on K2, native capture uses W04's
  format, and GR binds this workstream.

READ FIRST
  AGENTS.md - invariants 1, 3, 4, 11 and 13
  specs/awsf-v3-plan.html - the W08 block IN FULL, gate GR, Questionables Q4 and Q5
  specs/awsf-v3-intent.md - Terms (L1-L4, K3, K4), decisions 6, 9 and 14
  specs/awsf-v3-assessment-and-direction.md - N3, Q5-Q8
  W01's and W04's deep plans
  docs/driving/marimba/marimba-guard-rules.mts - the shared guard rules
  awsf.project.yaml and the project registry code under core/src/registry/

DO
  Invoke /plan-sota with QUESTIONABLE true to author specs/awsf-v3-w08-marimba-harness.html,
  its -build-prompts.md, and specs/tickets/awsf-v3-w08-marimba-harness/ with a README.
  A separate repository registered as an AWSF project and built through the factory. L1-L4
  with Sol in L3.
  K3 - each turn's output matches a schema of legal driver steps; owner acts are absent from
       every action schema, in every spelling (decision 14).
  K4 - read-only actions run freely; one card per run covers new, start and run with the route
       and estimated calls; owner acts are only ever prepared.
  The intents of decision 9. Native session capture in W04's format. The guard rules reused.
  The first surface is a text panel in the AWSF dashboard, launched and kept in the foreground
  like awsf dash (decision 6).
  Milestones that write AWSF and milestones that write the harness repository are separate.

DECIDED 2026-10-02 - APPLY, DO NOT REOPEN
  Q5 - marimba-harness, under the WSL home directory on the Linux filesystem. TypeScript on
       Node with type stripping and the built-in test runner, like AWSF. Shared code is copied
       under a byte-equality fence, never imported across repositories.
  Q4 - the session archiver lives in AWSF core; the harness writes W04's format.

AMENDMENTS AND OWNER-SIDE WORK
  Creating the repository, its placement and Sol's login are owner-side.
  Any change to docs/driving/ is an owner commit under GA.

DO NOT
  Write implementation code. Create the repository. Put an owner act in any schema a model
  fills. Introduce a background process.

BUILDER READY
  node --experimental-strip-types --test core/test/unit/meta/ticket-plan-sync.test.ts passes
  with the new ticket set, npm run test:unit is green, and git status --porcelain shows only
  the new files under specs/.

OWNER ACCEPTANCE
  The owner reviews the deep plan, including how it applies Q5, then approves it or returns a
  plan-sota-review v1 block.

COMMIT
  Manual: commit only if the owner authorizes it in this session, as Santiago Marin
  <santiagomarinsuarez@me.com>. Otherwise leave the files uncommitted and return a proposed
  message: docs(specs): author the AWSF v3 W08 marimba-harness deep plan
  Never name an agent, model or tool in commit identity, message or trailers.

MARKERS
  Flip nothing.

HANDOFF
  Return dated findings for W09, W10, W14 and W15: the intent list, the K3 schema source, and
  how a surface or a pull attaches to the harness.

STOP WHEN
  The deep plan is authored, every open decision is surfaced, and the owner has it in hand.
```

### T09 — W09 · Context engine

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5.5 · EFFORT high
  GPT     codex:gpt-6-sol · reasoning high
  WHY     the target is a twentyfold cut in driver tokens without losing what the driver needs.

TASK 9 of 15. Plan: specs/awsf-v3-plan.html. Milestone: M9.
WORKSTREAM: W09 - Context engine (intent X9, Phase C).
REPOSITORY: this AWSF checkout. You write only the deep plan, its build prompts and its ticket set.

You are authoring a DEEP PLAN. You write no implementation code.

EXECUTION
  Manual, logged exception (gate GM) only if W03 is not yet [x]; otherwise author it through
  the factory as W03's deep plan describes.

PREDECESSORS
  W03's, W05's and W08's deep plans approved. Closure tells which specs are closed, W05's
  re-cut hands this workstream W19's M6-M7 (read this ticket's Handoff), and the harness is the
  driver the index serves.

READ FIRST
  AGENTS.md - invariants 1 and 10
  specs/awsf-v3-plan.html - the W09 block IN FULL
  specs/awsf-v3-intent.md - decision 8 and the acceptance targets
  specs/tickets/awsf-v3-plan/W09.md - its Handoff (W19 M6-M7's tasks)
  W03's and W08's deep plans
  W04's session record - the source of the per-turn token measurement

DO
  Invoke /plan-sota with QUESTIONABLE true to author specs/awsf-v3-w09-context-engine.html, its
  -build-prompts.md, and specs/tickets/awsf-v3-w09-context-engine/ with a README.
  A capability index the driver reads first, with detail on demand. W19 M6 (compaction
  judgment) and M7 (cheap reads and ask_jev) folded in. Reference docs generated from code
  where they can be, with a drift test. Closed v2 specs out of the priming path.
  Baseline: a median 168k prompt tokens per driver turn. Target: under 10k, with no drop in the
  intent suite's score.

AMENDMENTS AND OWNER-SIDE WORK
  docs/driving/** is protected; W19's G19-D and G19-T carry over with M6-M7.
  The owner's machine-local priming setup is owner-side.

DO NOT
  Write implementation code. Delete a spec: leaving the priming path is not deletion.

BUILDER READY
  node --experimental-strip-types --test core/test/unit/meta/ticket-plan-sync.test.ts passes
  with the new ticket set, npm run test:unit is green, and git status --porcelain shows only
  the new files under specs/.

OWNER ACCEPTANCE
  The owner reviews the deep plan and approves it or returns a plan-sota-review v1 block.

COMMIT
  Manual: commit only if the owner authorizes it in this session, as Santiago Marin
  <santiagomarinsuarez@me.com>. Otherwise leave the files uncommitted and return a proposed
  message: docs(specs): author the AWSF v3 W09 context-engine deep plan
  Never name an agent, model or tool in commit identity, message or trailers.

MARKERS
  Flip nothing.

STOP WHEN
  The deep plan is authored, every open decision is surfaced, and the owner has it in hand.
```

### T10 — W10 · Data loop and local model

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5.5 · EFFORT xhigh
  GPT     codex:gpt-6-sol · reasoning xhigh
  WHY     the data rule (no frontier output) must be a fence, and most of the work is
          owner-side hardware the plan must keep out of its task graph.

TASK 10 of 15. Plan: specs/awsf-v3-plan.html. Milestone: M10.
WORKSTREAM: W10 - Data loop and local model (intent X10, Phase C; reshapes v2 W16).
REPOSITORY: this AWSF checkout. You write only the deep plan, its build prompts and its ticket set.

You are authoring a DEEP PLAN. You write no implementation code.

EXECUTION
  Manual, logged exception (gate GM) only if W03 is not yet [x].

PREDECESSORS
  W01's, W02's, W04's, W05's and W08's deep plans approved. Labels come from attributions,
  records and K4 confirmations; the suites come from W02 and W08; W05's re-cut hands this
  workstream W19's M8 (read this ticket's Handoff). GR binds promotion to L3.

READ FIRST
  AGENTS.md - invariants 3, 4, 7 and 9
  specs/awsf-v3-plan.html - the W10 block IN FULL, gate GR, Questionable Q6
  specs/awsf-v3-intent.md - decisions 1, 2 and 3
  specs/awsf-v3-assessment-and-direction.md - Q1-Q3 with alternatives
  specs/awsf-v2-w16-openrouter-adapter.html - M1 done; what reshapes into the local provider
  specs/tickets/awsf-v3-plan/W10.md - its Handoff (W19 M8's tasks)

DO
  Invoke /plan-sota with QUESTIONABLE true to author specs/awsf-v3-w10-local-model.html, its
  -build-prompts.md, and specs/tickets/awsf-v3-w10-local-model/ with a README.
  Labels from owner confirmations and attributions. The intent and trap suites as evals. A
  local provider through pi (OpenRouter stays the paid exception). A LoRA fine-tune on the Mac.
  An A/B against Sol on the same suites, reported with intervals. W19 M8 carried.
  Every training record carries provenance, and a fence rejects any record containing
  frontier-model output (decision 2).

DECIDED 2026-10-02 - APPLY, DO NOT REOPEN
  Q6 - run all three bases (9B, 27B, 35B-A3B) untuned on the suites first, then fine-tune 9B
       first with 35B-A3B as the challenger, served by an MLX-based stack on the Mac.

AMENDMENTS AND OWNER-SIDE WORK
  The Mac, model downloads, training runs, rented GPUs and any hosted teacher are owner-side,
  each with a stated budget. None is a task.

DO NOT
  Write implementation code. Plan a training run as a task. Promote a local model to L3 on
  anything but the A/B and GR.

BUILDER READY
  node --experimental-strip-types --test core/test/unit/meta/ticket-plan-sync.test.ts passes
  with the new ticket set, npm run test:unit is green, and git status --porcelain shows only
  the new files under specs/.

OWNER ACCEPTANCE
  The owner reviews the deep plan, including how it applies Q6, then approves it or returns a
  plan-sota-review v1 block.

COMMIT
  Manual: commit only if the owner authorizes it in this session, as Santiago Marin
  <santiagomarinsuarez@me.com>. Otherwise leave the files uncommitted and return a proposed
  message: docs(specs): author the AWSF v3 W10 local-model deep plan
  Never name an agent, model or tool in commit identity, message or trailers.

MARKERS
  Flip nothing.

STOP WHEN
  The deep plan is authored, every open decision is surfaced, and the owner has it in hand.
```

### T11 — W11 · Agent readiness

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5.5 · EFFORT high
  GPT     codex:gpt-6-sol · reasoning high
  WHY     the checks read another repository, and a score is easy to make meaningless.

TASK 11 of 15. Plan: specs/awsf-v3-plan.html. Milestone: M11.
WORKSTREAM: W11 - Agent readiness for registered projects (intent X11, Phase C).
REPOSITORY: this AWSF checkout. You write only the deep plan, its build prompts and its ticket set.

You are authoring a DEEP PLAN. You write no implementation code.

EXECUTION
  Manual, logged exception (gate GM) only if W03 is not yet [x].

PREDECESSORS
  W02's deep plan approved. The dev-environment category reuses doctor's environment checks.

READ FIRST
  AGENTS.md - invariant 10
  specs/awsf-v3-plan.html - the W11 block IN FULL, Questionable Q12
  specs/awsf-v3-assessment-and-direction.md - the talk's eight categories, N9, Q8
  W02's deep plan - doctor's environment checks
  core/src/registry/ - how a registered project and its placement are resolved

DO
  Invoke /plan-sota with QUESTIONABLE true to author specs/awsf-v3-w11-agent-readiness.html,
  its -build-prompts.md, and specs/tickets/awsf-v3-w11-agent-readiness/ with a README.
  Readiness checks in eight categories: style, build, testing, docs, dev environment,
  observability, security, task discovery. A score and recommended actions per project, Smart
  Health first, AWSF second. Readiness reads a project and never writes it; recommendations
  become backlog items.

DECIDED 2026-10-02 - APPLY, DO NOT REOPEN
  Q12 - pass/fail per check, rolled up per category, no single total. Results live in the
        journal and projection, never in a committed file (invariant 10).

DO NOT
  Write implementation code. Write to a scored repository.

BUILDER READY
  node --experimental-strip-types --test core/test/unit/meta/ticket-plan-sync.test.ts passes
  with the new ticket set, npm run test:unit is green, and git status --porcelain shows only
  the new files under specs/.

OWNER ACCEPTANCE
  The owner reviews the deep plan, including how it applies Q12, then approves it or returns a
  plan-sota-review v1 block.

COMMIT
  Manual: commit only if the owner authorizes it in this session, as Santiago Marin
  <santiagomarinsuarez@me.com>. Otherwise leave the files uncommitted and return a proposed
  message: docs(specs): author the AWSF v3 W11 agent-readiness deep plan
  Never name an agent, model or tool in commit identity, message or trailers.

MARKERS
  Flip nothing.

HANDOFF
  Return dated findings for W13: Smart Health's readiness before deploy.

STOP WHEN
  The deep plan is authored, every open decision is surfaced, and the owner has it in hand.
```

### T12 — W12 · Mac host

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5.5 · EFFORT medium
  GPT     codex:gpt-6-sol · reasoning medium
  WHY     decision 3 settles the design; the work is separating owner-side setup from the
          little that lands from a worktree.

TASK 12 of 15. Plan: specs/awsf-v3-plan.html. Milestone: M12.
WORKSTREAM: W12 - Mac host (intent X12, Phase D).
REPOSITORY: this AWSF checkout. You write only the deep plan, its build prompts and its ticket set.

You are authoring a DEEP PLAN. You write no implementation code.

EXECUTION
  Manual, logged exception (gate GM) only if W03 is not yet [x].

PREDECESSORS
  W02's deep plan approved. The VM host is accepted by doctor and the trap suite.

READ FIRST
  AGENTS.md - invariants 3 and 4
  specs/awsf-v3-plan.html - the W12 block IN FULL
  specs/awsf-v3-intent.md - decision 3
  specs/awsf-v3-assessment-and-direction.md - R6, N9, Q4
  core/src/execution/transport-broker.ts - the bwrap-only sandbox
  W02's deep plan - doctor's checks and the traps

DO
  Invoke /plan-sota with QUESTIONABLE true to author specs/awsf-v3-w12-mac-host.html, its
  -build-prompts.md, and specs/tickets/awsf-v3-w12-mac-host/ with a README.
  AWSF in a Linux VM on the Mac, keeping bwrap. The task graph holds only what lands from a
  worktree: host detection, doctor checks and traps for the VM host. A Seatbelt port only if
  the VM gets in the way, as its own decision with its own security proof.
  DrvFs reports 0777 for every inode, so permission checks that pass in temp-directory
  fixtures refuse on real Windows-mount worktrees. Make that a fixture.

AMENDMENTS AND OWNER-SIDE WORK
  The purchase, the VM, provider logins and moving the state root are owner-side.

DO NOT
  Write implementation code. Plan a sandbox port as part of this workstream without the
  owner's decision.

BUILDER READY
  node --experimental-strip-types --test core/test/unit/meta/ticket-plan-sync.test.ts passes
  with the new ticket set, npm run test:unit is green, and git status --porcelain shows only
  the new files under specs/.

OWNER ACCEPTANCE
  The owner reviews the deep plan and approves it or returns a plan-sota-review v1 block.

COMMIT
  Manual: commit only if the owner authorizes it in this session, as Santiago Marin
  <santiagomarinsuarez@me.com>. Otherwise leave the files uncommitted and return a proposed
  message: docs(specs): author the AWSF v3 W12 mac-host deep plan
  Never name an agent, model or tool in commit identity, message or trailers.

MARKERS
  Flip nothing.

STOP WHEN
  The deep plan is authored, every open decision is surfaced, and the owner has it in hand.
```

### T13 — W13 · Deploy

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5.5 · EFFORT xhigh
  GPT     codex:gpt-6-sol · reasoning xhigh
  WHY     a staging publish is an external mutation invariant 8 does not describe, so this
          workstream needs a new mechanically checked guarantee.

TASK 13 of 15. Plan: specs/awsf-v3-plan.html. Milestone: M13.
WORKSTREAM: W13 - Deploy (intent X13, Phase D; carried from v2 W13).
REPOSITORY: this AWSF checkout. You write only the deep plan, its build prompts and its ticket set.

You are authoring a DEEP PLAN. You write no implementation code.

EXECUTION
  Manual, logged exception (gate GM) only if W03 is not yet [x].

PREDECESSORS
  W02's, W07's and W11's deep plans approved. Staging receives builds the validator passed, on
  a project readiness has scored. GR binds a factory-run staging publish.

READ FIRST
  AGENTS.md - invariant 8 IN FULL
  specs/awsf-v3-plan.html - the W13 block IN FULL, gate GR, Questionable Q8
  specs/awsf-v3-intent.md - decision 12
  specs/awsf-v3-assessment-and-direction.md - N8, Q16
  specs/awsf-v2-plan-build-prompts.md - the T13 (W13) prompt
  core/src/publish/authorize.ts and argv.ts - the shape the deploy guarantee should copy
  awsf.config.yaml - policy.protected_operations

DO
  Invoke /plan-sota with QUESTIONABLE true to author specs/awsf-v3-w13-deploy.html, its
  -build-prompts.md, and specs/tickets/awsf-v3-w13-deploy/ with a README.
  For Smart Health: a reproducible build published to a staging channel from a landed
  revision. Release to production is an owner act. Milestones that write Smart Health's
  repositories are separate from milestones that write AWSF.

DECIDED 2026-10-02 - APPLY, DO NOT REOPEN
  Q8 - a store test track. Confirm Smart Health has no separately released backend before
       writing the deploy amendment; if it has one, report it rather than redesign.

AMENDMENTS AND OWNER-SIDE WORK
  Propose the deploy amendment: a pure authorization table, one argv constructor, and no path
  from a pre-LANDED state. Name the alternative that avoids it: the owner runs the staging
  publish by hand from a landed revision. It lands as an owner commit under GA.
  Store or staging accounts and CI secrets are owner-side.

DO NOT
  Write implementation code. Plan any path to production that is not the owner's act.

BUILDER READY
  node --experimental-strip-types --test core/test/unit/meta/ticket-plan-sync.test.ts passes
  with the new ticket set, npm run test:unit is green, and git status --porcelain shows only
  the new files under specs/.

OWNER ACCEPTANCE
  The owner reviews the deep plan and the amendment, including how it applies Q8, then approves
  them or returns a plan-sota-review v1 block.

COMMIT
  Manual: commit only if the owner authorizes it in this session, as Santiago Marin
  <santiagomarinsuarez@me.com>. Otherwise leave the files uncommitted and return a proposed
  message: docs(specs): author the AWSF v3 W13 deploy deep plan
  Never name an agent, model or tool in commit identity, message or trailers.

MARKERS
  Flip nothing.

HANDOFF
  Return dated findings for W14: what was published where, so signals can be pulled from it.

STOP WHEN
  The deep plan is authored, every open decision is surfaced, and the owner has it in hand.
```

### T14 — W14 · Monitor and signals

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5.5 · EFFORT high
  GPT     codex:gpt-6-sol · reasoning high
  WHY     the easy design is a timer, and a timer is the daemon this project has refused three
          times.

TASK 14 of 15. Plan: specs/awsf-v3-plan.html. Milestone: M14.
WORKSTREAM: W14 - Monitor and signals (intent X14, Phase D; carried from v2 W14).
REPOSITORY: this AWSF checkout. You write only the deep plan, its build prompts and its ticket set.

You are authoring a DEEP PLAN. You write no implementation code.

EXECUTION
  Manual, logged exception (gate GM) only if W03 is not yet [x].

PREDECESSORS
  W02's, W08's and W13's deep plans approved. Pulls happen when the harness opens, and they
  watch what deploy published. GR binds signals that create backlog work.

READ FIRST
  AGENTS.md - invariants 3 and 13
  specs/awsf-v3-plan.html - the W14 block IN FULL, gate GR, Questionable Q9
  specs/awsf-v3-intent.md - decision 6
  specs/awsf-v2-plan.html - Questionable Q3 (monitor without residency)
  W08's and W13's deep plans

DO
  Invoke /plan-sota with QUESTIONABLE true to author specs/awsf-v3-w14-monitor-signals.html,
  its -build-prompts.md, and specs/tickets/awsf-v3-w14-monitor-signals/ with a README.
  Signals pulled when the harness opens or by external CI, fed to intake and the backlog with
  their source. A fence that no AWSF code registers a timer, service or background process.

DECIDED 2026-10-02 - APPLY, DO NOT REOPEN
  Q9 - pull when the harness opens; external CI only once a source proves it needs a schedule.
       List the sources, each with what it costs to read.

AMENDMENTS AND OWNER-SIDE WORK
  A signal source that needs credentials gets its own single transport module and keeps the
  credential out of every agent phase. CI accounts and secrets are owner-side.

DO NOT
  Write implementation code. Introduce a timer, service or resident process.

BUILDER READY
  node --experimental-strip-types --test core/test/unit/meta/ticket-plan-sync.test.ts passes
  with the new ticket set, npm run test:unit is green, and git status --porcelain shows only
  the new files under specs/.

OWNER ACCEPTANCE
  The owner reviews the deep plan, including how it applies Q9, then approves it or returns a
  plan-sota-review v1 block.

COMMIT
  Manual: commit only if the owner authorizes it in this session, as Santiago Marin
  <santiagomarinsuarez@me.com>. Otherwise leave the files uncommitted and return a proposed
  message: docs(specs): author the AWSF v3 W14 monitor-signals deep plan
  Never name an agent, model or tool in commit identity, message or trailers.

MARKERS
  Flip nothing.

STOP WHEN
  The deep plan is authored, every open decision is surfaced, and the owner has it in hand.
```

### T15 — W15 · Surfaces

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5.5 · EFFORT high
  GPT     codex:gpt-6-sol · reasoning high
  WHY     each new surface is a new way to reach the harness, and none may become a way to
          reach an owner act.

TASK 15 of 15. Plan: specs/awsf-v3-plan.html. Milestone: M15.
WORKSTREAM: W15 - Surfaces (intent X15, Phase D).
REPOSITORY: this AWSF checkout for this session. You write only the deep plan, its build prompts
and its ticket set. The app's own repository is the harness repository or a new one.

You are authoring a DEEP PLAN. You write no implementation code.

EXECUTION
  Manual, logged exception (gate GM) only if W03 is not yet [x].

PREDECESSORS
  W08's and W12's deep plans approved, and W08's harness proven by its own acceptance drive
  before this deep plan's first build. The native app needs the Mac.

READ FIRST
  AGENTS.md - invariants 1, 11 and 13
  specs/awsf-v3-plan.html - the W15 block IN FULL
  specs/awsf-v3-intent.md - decisions 6, 9 and 14
  W08's deep plan - the K3 schema source and the confirmation card

DO
  Invoke /plan-sota with QUESTIONABLE true to author specs/awsf-v3-w15-surfaces.html, its
  -build-prompts.md, and specs/tickets/awsf-v3-w15-surfaces/ with a README.
  The native macOS app (orb, hotkey, local Spanish and English speech) and phone
  notifications, behind the same harness with the same K3 and K4. Notifications are sent only
  by a session the owner started or by external CI (decision 6).

AMENDMENTS AND OWNER-SIDE WORK
  Apple developer and notification-service accounts, and speech-model downloads, are
  owner-side.

DO NOT
  Write implementation code. Give any surface a path to execute an owner act.

BUILDER READY
  node --experimental-strip-types --test core/test/unit/meta/ticket-plan-sync.test.ts passes
  with the new ticket set, npm run test:unit is green, and git status --porcelain shows only
  the new files under specs/.

OWNER ACCEPTANCE
  The owner reviews the deep plan and approves it or returns a plan-sota-review v1 block.

COMMIT
  Manual: commit only if the owner authorizes it in this session, as Santiago Marin
  <santiagomarinsuarez@me.com>. Otherwise leave the files uncommitted and return a proposed
  message: docs(specs): author the AWSF v3 W15 surfaces deep plan
  Never name an agent, model or tool in commit identity, message or trailers.

MARKERS
  Flip nothing. W15's [x] closes the last v3 workstream; the spine's own Validation rows are
  then checked in the owner's closing commit.

STOP WHEN
  The deep plan is authored, every open decision is surfaced, and the owner has it in hand.
```
