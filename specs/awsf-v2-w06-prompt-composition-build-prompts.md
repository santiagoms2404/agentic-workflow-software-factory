# Build Prompts — AWSF v2 W06, Prompt composition

Companion to [`awsf-v2-w06-prompt-composition.html`](./awsf-v2-w06-prompt-composition.html) and
[`tickets/awsf-v2-w06-prompt-composition/`](./tickets/awsf-v2-w06-prompt-composition/). Created
2026-08-22.

**These prompts build the approved deep plan.** Ten fresh sessions execute ten numbered tasks in
plan order. Tasks 1–8 and 10 are offline. Task 9 spends provider quota and requires immediate owner
approval. No offline suite may invoke it.

## Gates before execution

1. The owner approved this deep plan on 2026-08-23. All five Questionables are settled constraints:
   Q1 one common file plus a closed reviewer overlay; Q2 the structural four-point rubric plus the
   omitted-evidence rule; Q3 three tasks × five repetitions per arm (30 route runs); Q4 safety
   non-inferiority with token deltas descriptive; Q5 journal detail plus a handle-free Amendment.
2. W05's deep plan is the authoring predecessor, but build order reverses one edge. W05 milestone M7,
   “G1 — the route, the two roles, and the close,” waits until this plan's M1 is `[x]`. W05 M1–M6 do
   not wait.
3. `CLAUDE.md` and `docs/TESTING.md` do not exist in this repository at authoring time. Do not invent
   them. Read `AGENTS.md`, this plan, the named source, and the package scripts instead.

## Conventions used by every prompt

- Read `AGENTS.md` in full. Invariants 1 and 10 are directly in scope. Keep aliases interactive-only.
- Flip this leaf plan's current task checklist items to `[wip]` on start and `[x]` on completion in
  `specs/awsf-v2-w06-prompt-composition.html`. Move its milestone header to `[wip]` on the first task
  and `[x]` only on the milestone's final task. Flip the matching ticket state in the same commit.
- Do not flip `specs/awsf-v2-plan.html`'s W06 marker before T10. T10 alone closes the spine marker and
  `specs/tickets/awsf-v2-plan/W06.md` after every leaf marker is complete.
- Never add a dependency outside the allowlist, a `node:child_process` import, `shell: true`, a
  runtime report/receipt/manifest, live task/session state, an adapter prompt-delivery branch, or an
  alias block in a headless role.
- Append the modified date and an Amendment with the commit SHA after each completed task. Never put
  an agent, model, or AI tool in commit identity or message. The owner identity rule in `AGENTS.md`
  applies.

# Section B — Task prompts (recommended)

### T01 — Characterise the three sites and define the one-site fence

```
[MODEL: Opus 5 or GPT-5.6 · EFFORT: high — the source fence must define the right boundary before extraction]

TASK 1 of 10. Plan: specs/awsf-v2-w06-prompt-composition.html, milestone M1.
PREDECESSORS: none. Confirm the owner approved the plan. W05 M7 remains blocked.

READ FIRST
  AGENTS.md - in full, especially invariants 1 and 10
  specs/awsf-v2-w06-prompt-composition.html - Purpose, Solution, G1, and M1 task 1
  specs/awsf-v2-plan.html - Shared Invariants and the W05/W06 blocks
  specs/awsf-v2-w05-design-to-plan.html - Ordering Gate G1 and milestone M7
  core/src/cli/commands/production-run.ts - route prompt loading and compiled-prompt persistence
  core/src/cli/commands/review-phase.ts - readCommittedPrompt and resolveReviewRoute
  core/src/cli/commands/rework.ts - readCommittedPrompt and resolveRoute

DO
  Add characterization fixtures for exact user/system bytes and every current containment,
  symlink-escape, and credential rejection across all three paths. Define a meta-test whose
  mechanically counted composition site is code that reads agent.prompt.system or joins a shared
  system block. Permit one named future module and prove the test red on a temporary second site.
  Cover the six configured roles plus synthetic designer and architecture-reviewer definitions
  from W05. Observe the baseline: no shared block and no alias input.

DO NOT
  Extract or centralise yet. Add shared prose. Add W05 role files. Contact a provider. Change an
  existing expected byte. Treat three callers as three composition implementations.

DEFINITION OF DONE
  Every box in M1 task 1. Focused new tests green after the induced-red proof is restored.
  Mark this leaf task and T01 together; leave M1 [wip], leave the spine W06 marker untouched.
```

### T02 — Extract the prompt bundle and migrate all three callers

```
[MODEL: Opus 5 or GPT-5.6 · EFFORT: high — three lifecycle paths must converge without byte drift]

TASK 2 of 10. Plan: specs/awsf-v2-w06-prompt-composition.html, milestone M1.
PREDECESSORS: T01 is done and M1 is [wip]. W05 M7 remains blocked.

READ FIRST
  AGENTS.md - in full
  specs/awsf-v2-w06-prompt-composition.html - Solution, Boundaries, M1 task 2
  core/src/cli/commands/production-run.ts, review-phase.ts, rework.ts - the characterized sites
  core/src/adapters/system-prompt-file.ts - unchanged private materialisation boundary
  core/test/unit/workflow/prompt-composition.test.ts and the new site-count meta-test

DO
  Create the approved single prompt-bundle module. Move config-relative path containment, physical
  symlink containment, credential checking, user-prompt loading, and role-system loading into it.
  Remove all three local readCommittedPrompt copies and make production, replacement review, and
  owner rework consume the returned bundle. In M1 the shared component is empty and final system
  bytes must equal the old role bytes exactly, including final newlines.

DO NOT
  Add shared content, separators for an empty component, evidence digests, adapter changes, or a
  benchmark switch. Touch writeSystemPromptFile/assertPrivateSystemPrompt or descriptor privacy.

DEFINITION OF DONE
  Every box in M1 task 2. Characterization and site-count tests green, npm run typecheck:core and
  npm run lint green. Mark this leaf task and T02 together; keep M1 [wip] and spine W06 untouched.
```

### T03 — Testing Strategy and the G1 release point

```
[MODEL: Sonnet 5 or GPT-5.6 · EFFORT: medium — this is an offline gate sweep with one scheduling consequence]

TASK 3 of 10. Plan: specs/awsf-v2-w06-prompt-composition.html, milestone M1.
PREDECESSORS: T02 is done and M1 is [wip].

READ FIRST
  AGENTS.md - in full
  specs/awsf-v2-w06-prompt-composition.html - Ordering Gate G1 and M1 task 3
  specs/awsf-v2-w05-design-to-plan.html - milestone M7 precondition and task 23
  package.json - exact offline scripts
  all files changed by T01-T02

DO
  Run the exact M1 focused tests, full npm run test:unit, npm run typecheck:core, and npm run lint.
  Repeat the site-count induced-red proof if it was not retained as test evidence. Confirm system
  bytes remain role-only and exact for all roles and all three paths. When every M1 box is green,
  mark M1 [x]. This is the G1 release point W05 M7 reads.

DO NOT
  Start M2, add shared prose, run a provider, or flip the spine's W06 marker. Do not mark M1 [x] on
  inspection alone.

DEFINITION OF DONE
  Every command and box in M1 task 3 passes. Mark task 3, M1, and T03 done in one commit. Leave
  specs/awsf-v2-plan.html W06 unchanged. Record that W05 M7 is now unblocked, not completed.
```

### T04 — Add the shared source, role policy, and exact separator contract

```
[MODEL: Opus 5 or GPT-5.6 · EFFORT: high — prompt semantics and reviewer treatment are decision-bearing]

TASK 4 of 10. Plan: specs/awsf-v2-w06-prompt-composition.html, milestone M2.
PREDECESSORS: T03 is done, M1 is [x], and owner Questionable verdicts Q1-Q2 are applied.

READ FIRST
  AGENTS.md - in full
  specs/awsf-v2-w06-prompt-composition.html - Solution, Roles centralised, Q1-Q2, M2 task 4
  specs/awsf-v2-w05-design-to-plan.html - decided two-role shape and M7 role prompts
  prompts/*/system.md - every current role contract, reviewer in full
  core/src/workflow/prompt-composition.ts and its tests

DO
  Implement Q1's approved shared source and exact prose only through the central composer. Preserve
  role bytes as an exact prefix, own one separator rule, and render the approved closed role policy.
  Cover all six current roles plus W05's designer and architecture-reviewer fixtures. Fail unknown
  roles closed. Keep the reviewer evidence/dissent/limitations contract intact under Q1's approved
  non-compression treatment. Prove synthetic interactive alias bytes have no input path.

DO NOT
  Copy the block into role files or command callers. Add an alias heading or alias substitution.
  Replace role prompts. Change adapters. Start route evidence or reviewer gates from T05-T06.

DEFINITION OF DONE
  Every box in M2 task 4 and focused composition tests pass offline. Mark task 4 and T04 together;
  keep M2 [wip]. The spine W06 marker remains unchanged.
```

### T05 — Put shared bytes in immutable route evidence and refuse drift

```
[MODEL: Opus 5 or GPT-5.6 · EFFORT: xhigh — immutable evidence and pre-spend refusal cross three lifecycle routes]

TASK 5 of 10. Plan: specs/awsf-v2-w06-prompt-composition.html, milestone M2.
PREDECESSORS: T04 is done and M2 is [wip].

READ FIRST
  AGENTS.md - invariants 1, 6, and 10
  specs/awsf-v2-w06-prompt-composition.html - Composition contract, Boundaries, M2 task 5
  core/src/observability/attempt-evidence.ts and projector.ts compiled-prompt handling
  core/src/cli/commands/review-record.ts - RecordedRoute reconstruction
  production-run.ts, review-phase.ts, rework.ts - persistence and reservation order
  core/src/config/effective-config.ts - path-only snapshot evidence

DO
  Compatibly extend existing compiled-prompt system evidence with role, shared, and final SHA-256
  digests plus composition version while retaining full composed text. Persist before launch spend
  on every route; make owner rework persist its own system/user compiled prompts. Compare current
  final digest against governing recorded builder/reviewer evidence before rework/replacement review
  reservation or GO. Legacy full-text evidence may derive only the final digest. Add exact mismatch,
  timing, and legacy fixtures.

DO NOT
  Add a receipt, manifest, migration, second store, config prompt bytes, or live handles. Modify an
  adapter. Invent a shared digest for legacy evidence. Permit snapshot equality to override digest
  inequality.

DEFINITION OF DONE
  Every box in M2 task 5. Focused evidence and review-record tests green; induced role/shared drift
  refuses both later routes before call spend. Mark task 5 and T05 together; keep M2 [wip].
```

### T06 — Gate reviewer evidence specificity and non-compression

```
[MODEL: Opus 5 or GPT-5.6 · EFFORT: high — the gate must reject vague agreement without demanding fabricated findings]

TASK 6 of 10. Plan: specs/awsf-v2-w06-prompt-composition.html, milestone M2.
PREDECESSORS: T05 is done, M2 is [wip], and owner Q2 is applied exactly.

READ FIRST
  AGENTS.md - in full
  specs/awsf-v2-w06-prompt-composition.html - Q2, Boundaries, M2 task 6
  core/src/gates/review.ts - concrete and verdictConsistent in full
  core/src/contracts/review-output.ts and review-context.ts
  core/test/unit/gates/review-evidence-present.test.ts and review-diff.test.ts
  prompts/reviewer/{system,user}.md - in full

DO
  Implement Q2's deterministic specificity floor without changing accept/concern semantics. Add
  canned detailed concern, vague evidence, tersely agreeable output, legitimate clean accept,
  deletion-only, file-wide, bounded-diff, and omitted-file fixtures. Require limitations only when
  the supplied context makes one necessary; never reward finding count or force fake line numbers.
  Assert reviewer composition preserves approved non-compression bytes.

DO NOT
  Add model calls, subjective snapshot tests, a minimum finding count, or a rule that turns every
  limitation into a finding. Let token brevity offset lost evidence.

DEFINITION OF DONE
  Every box in M2 task 6 and the focused reviewer suites pass offline. Mark task 6 and T06 together;
  keep M2 [wip] and spine W06 unchanged.
```

### T07 — Testing Strategy

```
[MODEL: Sonnet 5 or GPT-5.6 · EFFORT: medium — broad offline regression and induced drift proofs]

TASK 7 of 10. Plan: specs/awsf-v2-w06-prompt-composition.html, milestone M2.
PREDECESSORS: T06 is done and M2 is [wip].

READ FIRST
  AGENTS.md - in full
  specs/awsf-v2-w06-prompt-composition.html - M2 task 7 and Validation Commands
  package.json - offline suite definitions
  all files changed by T04-T06

DO
  Run the exact focused composition, route-evidence, review-record, reviewer-specificity, and adapter
  commands from M2 task 7, then npm run test:unit, npm run typecheck:core, and npm run lint. Induce
  one shared-byte drift against recorded evidence and observe rework and replacement review refuse
  before spend, then restore and rerun green. Confirm adapter descriptors are unchanged except for
  the private file's content. Mark M2 [x] only after every box passes.

DO NOT
  Contact a provider, run task 9, weaken a fixture, or put benchmark work in an npm test script.
  Do not flip the spine W06 marker.

DEFINITION OF DONE
  Every box in M2 task 7. Mark task 7, M2, and T07 done together. M1 and M2 are [x]; M3 remains [].
```

### T08 — Freeze the benchmark protocol and validate its arithmetic offline

```
[MODEL: Opus 5 or GPT-5.6 · EFFORT: xhigh — pre-registration must prevent post-result metric shopping]

TASK 8 of 10. Plan: specs/awsf-v2-w06-prompt-composition.html, milestone M3.
PREDECESSORS: T07 is done and M2 is [x]. Q3-Q5 are decided: three task classes × five repetitions
per arm (30 route runs), safety non-inferiority with tokens descriptive, and journal detail plus a
handle-free plan Amendment. No live call yet.

READ FIRST
  AGENTS.md - invariants 1 and 10
  specs/awsf-v2-w06-prompt-composition.html - M3, Q2-Q5, Benchmark record shape
  core/src/observability/attempt-evidence.ts - token, phase correction, and review evidence fields
  core/src/cli/commands/review-record.ts and core/src/gates/review.ts
  package.json - prove benchmark is absent from offline scripts

DO
  Freeze the decided corpus: bounded source change, contract/envelope change, and evidence-heavy
  defect review, each with five baseline and five candidate runs (30 total), alternating arm order
  by pair. Record M1 baseline revision, M2 candidate revision, provider/model identities, validity
  rules, and stop conditions before spend. Predeclare input tokens, output tokens, parse-correction
  count, and reviewer specificity only.
  Implement only pure synthetic-row pairing/scoring arithmetic needed to prevent manual arithmetic
  drift, and test missing authority, invalid pairs, correction sums, specificity, medians, and paired
  differences offline. Keep live identifiers out of fixtures.

DO NOT
  Run a provider, inspect candidate-arm live results, add a fifth metric, create a benchmark report,
  add a feature flag, or register the paid route under npm test.

DEFINITION OF DONE
  Every box in M3 task 8. The protocol and thresholds are fixed in the approved plan/amendment and
  pure arithmetic tests are green. Mark task 8 and T08 together; keep M3 [wip].
```

### T09 — Run the quota-spending benchmark and record the result

```
[MODEL: Opus 5 or GPT-5.6 · EFFORT: high — controlled live execution, evidence accounting, and stop discipline]

TASK 9 of 10. Plan: specs/awsf-v2-w06-prompt-composition.html, milestone M3.
PREDECESSORS: T08 is done, M3 is [wip], the decided 30-run protocol is frozen, and the owner
approves spend NOW.

READ FIRST
  AGENTS.md - invariants 1 and 10
  specs/awsf-v2-w06-prompt-composition.html - M3 task 9, Q3-Q5 decisions, Benchmark record shape
  the approved protocol Amendment - exact corpus, repetitions, alternation, thresholds, abort rules
  core/src/observability/attempt-evidence.ts - authoritative metric sources

DO
  After explicit owner approval, run the approved repeated matched corpus on clean separate M1
  baseline and M2 candidate worktrees/state namespaces. Keep task inputs, config, providers/models,
  and gates identical except composed shared bytes. Complete the approved repeated count in both
  arms for every retained task: five baseline and five candidate runs for each of three tasks, 30
  valid route runs total. Read only the four declared metrics. Count parse corrections even when
  final envelopes pass. Leave detailed rows and outputs in journal/status evidence. Append only
  the approved handle-free aggregate to the plan Amendment and apply thresholds unchanged.

DO NOT
  Claim a result from one sample per arm or incomplete pairs. Commit raw output, report, receipt,
  manifest, journal path, task/attempt/session id, or provider handle. Replace invalid pairs silently.
  Waive reviewer or parse-correction regressions for token savings. Put this command in an offline suite.

DEFINITION OF DONE
  Every box in M3 task 9, including approved repetitions and aggregate result. If a safety threshold
  fails, mark task/phase failed or leave open and follow the plan's revision rule. If it passes, mark
  task 9 and T09 done; keep M3 [wip] for T10's offline close.
```

### T10 — Testing Strategy, global validation, and workstream close

```
[MODEL: Opus 5 or GPT-5.6 · EFFORT: high — final evidence reconciliation and the only spine-marker transition]

TASK 10 of 10. Plan: specs/awsf-v2-w06-prompt-composition.html, milestone M3.
PREDECESSORS: T09 is done with repeated matched results meeting every predeclared safety threshold.

READ FIRST
  AGENTS.md - all invariants, especially marker and identity rules
  specs/awsf-v2-w06-prompt-composition.html - M3 task 10 and global Validation Commands
  specs/awsf-v2-plan.html - W06 checklist and marker
  specs/tickets/awsf-v2-plan/W06.md - spine ticket state
  specs/tickets/awsf-v2-w06-prompt-composition/README.md - sync and derived-field rules
  package.json - exact commands

DO
  Run npm run test:unit, contract, sim, journeys, typecheck, lint, the focused ticket-plan-sync test,
  and git diff --check. Confirm no offline script made a provider call and no runtime benchmark
  artifact is tracked. Reconcile all M1-M3 task markers with T01-T10 states. Mark this task, M3, and
  T10 done. Only after every leaf marker is [x], flip the spine's W06 milestone/checklist and
  specs/tickets/awsf-v2-plan/W06.md to done in the same commit. Append the final Amendment and commit
  SHA under the owner's identity.

DO NOT
  Re-run or resize the benchmark after seeing results unless the approved protocol requires it.
  Close W06 on offline tests alone. Flip W05 markers. Commit live identifiers or name an agent/model
  in commit identity/message.

DEFINITION OF DONE
  Every M3 task 10 and global validation box passes. Leaf M1-M3 are [x], T01-T10 are done, spine W06
  and its W06 ticket are synchronized in the same commit. Evidence: exact command exits and the
  predeclared benchmark verdict, not a two-call anecdote.
```
