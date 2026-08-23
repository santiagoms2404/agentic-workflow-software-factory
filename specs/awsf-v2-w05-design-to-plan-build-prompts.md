# Build Prompts — AWSF v2 W05, Design → architecture-review → plan

Companion to [`awsf-v2-w05-design-to-plan.html`](./awsf-v2-w05-design-to-plan.html). Created 2026-08-22 alongside the plan and
[`tickets/awsf-v2-w05-design-to-plan/`](./tickets/awsf-v2-w05-design-to-plan/).

**These prompts write implementation code.** This is the deep plan for workstream W05, and these
twenty-eight prompts build it, one task at a time.

Each prompt is **self-contained** and written for a **fresh session with no prior context**. Copy
one, paste it, let it run to completion, review what it produced, clear context, move to the next.

---

## Why there is no Section A

Seven milestones hold twenty-eight tasks, and every milestone-level instruction that would go in a
Section A prompt — the marker rule, the read-first set, the never-do list — is identical across all
twenty-eight. Stating it once in **Conventions** below and once per prompt is enough. **Section B is
the whole file.**

---

## Before anything: three gates

1. **Owner approval of this deep plan — given on 2026-08-23.** One Questionable arrives settled
   from the spine (Q-A / spine Q5) and was **approved as implemented**. Of this plan's own six,
   **all six were decided on that date** — Q1 through Q6.
   Five took the recommended option. **`Q5` went the other way**: the owner named the
   three-repository project this factory exists to serve, the recommendation's premise was checked
   against source and found false, and the chain now reads every repository a project declares
   while still writing only into the one it runs in. That decision added tasks **7**, **11** and
   **25**. **A decided Questionable is a constraint, not an assignment: implement it, do not
   re-litigate it.**
2. **Ordering gate `G1` — composition before roles.** `specs/awsf-v2-w06-prompt-composition.html`
   must exist and its centralisation milestone must be `[x]` **before milestone M7 starts**.
   Milestones M1–M6 have no such precondition and may complete first; that overlap is deliberate
   and is the reason M7 is small. **Task 21's first act is to check this.**
3. **The owner's `awsf.config.yaml` amendment — and its sequence is the reverse of gate `G2`'s
   usual direction.** `loadConfig` rejects any `workflows.enabled` entry that is not in
   `KNOWN_WORKFLOW_IDS`, so an amendment landing before **task 22** would break every `awsf`
   command rather than just this route. It lands **after task 22 and before task 24**, and task 24
   refuses to proceed without it. Its exact text is written out in the plan's *Amendment Required
   Before the Route Runs* section.

---

## Decisions this plan already made — do not re-litigate these

| # | Decision | Status |
|---|---|---|
| D1 | **`AC`/`INV` ids are unique per plan**, and a cross-plan reference is written `<plan-stem>#INV-n`. A declaration is never qualified. | **spine Q5 — DECIDED 2026-08-21** |
| D2 | **A recipe phase cannot reach an installed skill**, on either route: `pi-codex.ts:621` passes `--no-skills`; the Claude adapter's eight-name tool map has no skill-invoking member. Every stage is a compiled recipe with a typed envelope. | source-verified |
| D3 | **The architecture review's verdict is an envelope, not a transition.** No new task state, no new legal edge. `isReviewPhase` selects the L11 spawn site *by schema id*, so a distinct schema id is the mechanism. | source-verified |
| D4 | **The zero-blocker gate is not correctable and is not attached to the review phase.** It lives on the host `plan-context` phase, so the planning call is never reserved when the review is not clear. | derived in this plan — see the warning card in Solution |
| D5 | **The stated limit rides the passing gate note**, and `limitations` is required non-empty. A zero blocker count is envelope consistency, never a clean design. | derived in this plan |
| D6 | **The host carries the identifier set forward; the model never retypes it.** The planner's only job is to map steps onto identifiers. | derived in this plan |
| D7 | **The render phase emits the plan, its build prompts and its ticket set together.** `ticket-plan-sync` skips a plan with no ticket set, so anything less makes the coverage gate vacuous on this chain's own output. | **Q4 — DECIDED 2026-08-23** |
| D8 | **A new `awsf.design-plan-output/v1`; `awsf.plan-output/v1` is untouched.** The migration to a `/v2` that absorbs the join is named, not taken. | **Q1 — DECIDED 2026-08-23** |
| D9 | **Two new roles, `designer` and `architecture-reviewer`**, because production resolves a phase's prompts through its `owner` and two phases with one owner get one prompt. | **Q3 — DECIDED 2026-08-23** |
| D10 | **The chain READS every repository the project's catalog declares, and WRITES only into the one the attempt runs in.** A `design-context` host phase resolves them through W04's catalog and placement layers and records each one's head revision. **No policy change**: `path-policy` judges write targets only, and `sandbox-broker` already binds the whole filesystem read-only before binding the worktree writable. | **Q5 — DECIDED 2026-08-23**, against its own recommendation, after the premise was checked against source and found false |
| D10b | **The reproducibility unit is a repository revision, not a byte.** `design_evidence_present` proves which revision was *available*, never which files were opened — weaker than `review_evidence_present`, and the right unit for a phase that explores rather than judges. | derived in this plan; carried on the passing gate note |
| D11 | **A blocking verdict stops the attempt at `AWAITING_OWNER`**, findings journalled, no automatic resume. The owner override is `L19`: interactive, recorded, and it draws on a correction allowance. | **Q6 — DECIDED 2026-08-23** |
| D12b | **Cross-provider independence for the architecture review is a config choice, not the automatic inversion.** `isReviewPhase` gates the inversion block by schema id, so this phase is invisible to it; the amendment puts the reviewer on the adapter the designer is not on. Fresh-session independence — `continuity: none` — holds unconditionally. | source-verified; see "What the distinct schema id costs" |
| D12 | **`awsf-plan-html/v1` is extended additively and its format id does not move.** A plan declaring no identifiers is a legitimate shape. The trigger for a real bump — making the spine mandatory — is written into the module comment. | derived in this plan |

---

## Model selection

`EFFORT` is the session-level reasoning control (`/effort low|medium|high|xhigh|max`), calibrated to
the hardest judgement in the task. **No prompt in this file fans out to sub-agents** — every task is
small enough for one session. The tasks carrying real design judgement are 1, 3, 6, 7, 10, 14, 15,
18, 19 and 23; the ones where a wrong answer is hardest to notice later are **11** (the
uncorrectable gate) and **17** (the induced drift). Those are the ones worth the better model.

---

## Conventions used by every prompt

- **Read first**, always: `specs/awsf-v2-w05-design-to-plan.html` (the named milestone and task in
  full), `AGENTS.md` (all twelve invariants, 1, 10 and 12 in particular), and whatever source files
  that task's own `READ FIRST` names.
- **Marker discipline — the positive and the negative, together.** Flip **this leaf plan's** current
  task checklist items to `[wip]` on start and `[x]` on completion in
  `specs/awsf-v2-w05-design-to-plan.html`. A milestone `<h3>` moves to `[wip]` when its first task
  starts, stays `[wip]` through intermediate tasks, and moves to `[x]` only when its final task
  completes. Flip the matching `specs/tickets/awsf-v2-w05-design-to-plan/T<nn>.md`'s `state:` in
  the **same commit**. **Never** touch `specs/awsf-v2-plan.html`'s W05 marker — **task 25 is the
  only task that does.**
- **Never do**: write implementation code beyond what the task names; add a dependency outside the
  D2 allowlist (invariant 7); add a `node:child_process` import site (invariant 3); use
  `shell: true` (invariant 4); commit a runtime artifact, receipt or manifest (invariant 10); write
  `AGENTS.md`, `awsf.config.yaml`, `awsf.project.yaml`, `core/src/state/**` or `core/src/policy/**`
  (protected paths); name an agent, model or AI tool in a commit (invariant 11).
- **No skill goes anywhere in an execution path.** If a task's design starts to read as "and then
  it invokes the plan skill", the design is wrong — see D2.
- **One vocabulary landmine, inherited from W04 and still live.**
  `no-destructive-paths.test.ts` scans **file contents** across `core/src` — comments included —
  for nine patterns. A renderer and a registry module naturally reach for two of them. Write "no
  upstream write path exists" and "reclaiming a worktree" instead, and invariant 8's fence stays
  green for the right reason.

---

# Section B — Task prompts (recommended)

Twenty-eight prompts, one per task, in plan order — ticket number equals the plan's own task number.

### T01 — Thread one INV and one AC through v1 by hand

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT xhigh
  CLAUDE  claude:opus · /effort xhigh
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     this task can reopen a Questionable the owner already decided, and the argument for
          doing so has to be strong enough to survive the owner reading it.

TASK 1 of 28. Plan: specs/awsf-v2-w05-design-to-plan.html, milestone M1.
PREDECESSORS: none. This is the first task, and it runs BEFORE any code exists.

This task writes no code and spends no quota. Its output is a written finding.

READ FIRST
  specs/awsf-v2-w05-design-to-plan.html - milestone M1 in full, plus "Decisions This Workstream
    Inherits" and Questionable Q-A
  specs/awsf-v2-plan.html - Questionable Q5 IN FULL, including its retained option set
  specs/awsf-plan.html - v1. Skim its structure, then read two or three milestones closely
  specs/tickets/awsf-plan/ - the matching ticket set
  core/test/unit/meta/ticket-plan-sync.test.ts - the fence the coverage gate extends

WHAT Q5 DECIDED, SO YOU CAN TEST IT RATHER THAN REOPEN IT ON TASTE
  AC/INV ids are UNIQUE PER PLAN. A cross-plan reference is written <plan-stem>#INV-n.
  The reasoning: the id is what the coverage gate joins on, and ticket-plan-sync is already
  per plan set - same scope as the machinery underneath means one scope to reason about.
  Both wider options need an allocator across plans and repositories, which is shared mutable
  state, and TicketStore's own comment says there is intentionally no database, cache, or index.

DO
  Pick ONE real architectural invariant and ONE real acceptance criterion that specs/awsf-plan.html
  already states in prose. Do not invent them.
  Write out, in a scratch file outside the repository:
    - the declaration lines they would carry in this plan's proposed grammar
    - the serves claim on the task that satisfies each
    - the ticket-side claim on the matching file in specs/tickets/awsf-plan/
    - the gate assertion, by hand
  Then answer the two questions the exercise exists for:
    1. Would deleting the AC from the plan while leaving it on the ticket turn the gate red?
       Would deleting it from BOTH go unnoticed, and is that acceptable?
    2. Across specs/awsf-plan.html, how many statements of the same kind would need to reference
       an identifier declared in a DIFFERENT plan? Count them. Write the number down.
  Record the outcome in specs/awsf-v2-w05-design-to-plan.html - a paragraph in Notes and an entry
  in Amendments - as either:
    Q5 CONFIRMED as decided, with the crossing count as the supporting number, or
    Q5 REOPENED WITH EVIDENCE, with the count, the examples, and what per-project would cost.

DO NOT
  Commit the hand-threaded lines into specs/awsf-plan.html or its tickets. v1 is history and
  task 18 is where a plan opts in for real.
  Write any implementation code.
  Re-litigate Q5 on taste. If you reopen it, the count is the argument.

STOP WHEN
  The plan carries a written finding with a number in it, and if the finding reopens Q5, the
  owner has been asked before task 3 starts.

MARKERS
  Flip THIS leaf plan's markers in specs/awsf-v2-w05-design-to-plan.html: milestone M1's <h3> to
  [wip] on start, this task's checklist items to [x] on completion. Flip
  specs/tickets/awsf-v2-w05-design-to-plan/T01.md's state: in the same commit.
  NEVER touch specs/awsf-v2-plan.html's W05 marker - task 28 is the only task that does.
```

### T02 — Testing Strategy — the evidence is a number, not an impression

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT low
  CLAUDE  claude:sonnet · /effort low
  GPT     codex:gpt-5.6-terra · reasoning low
  WHY     recording and verifying an answer that already exists.

TASK 2 of 28. Plan: specs/awsf-v2-w05-design-to-plan.html, milestone M1.
PREDECESSORS: T01 must be [x] in specs/awsf-v2-w05-design-to-plan.html.

READ FIRST
  specs/awsf-v2-w05-design-to-plan.html - milestone M1 task 2
  AGENTS.md - invariant 10, which is why the evidence lives in the plan and not in a report file

DO
  Confirm and record:
    git diff --stat            - specs/awsf-plan.html and specs/tickets/awsf-plan/ are UNCHANGED
    npm run test:unit          - green before any of this plan's code exists
  Confirm the Notes paragraph from T01 states the crossing count and the Q5 outcome in a sentence
  a reader could disagree with. If it reads as an impression rather than a finding, rewrite it.
  Close milestone M1: its <h3> marker to [x].

DO NOT
  Add a report file, a receipt, or a manifest anywhere in the repository - AGENTS.md invariant 10.
  Start milestone M2.

STOP WHEN
  M1 is [x], both tickets are state: done, and the finding is legible to someone who was not here.

MARKERS
  Flip THIS leaf plan's markers in specs/awsf-v2-w05-design-to-plan.html and the matching
  specs/tickets/awsf-v2-w05-design-to-plan/T02.md state: in the same commit.
  NEVER touch specs/awsf-v2-plan.html's W05 marker - task 28 is the only task that does.
```

### T03 — The identifier grammar, and the parser extended to return it

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     a grammar that is too loose is unfixable later, and a parser that ignores a malformed
          id instead of refusing it makes every downstream gate lie.

TASK 3 of 28. Plan: specs/awsf-v2-w05-design-to-plan.html, milestone M2.
PREDECESSORS: T02 must be [x], and M1's Q5 finding must be recorded. If M1 reopened Q5 and the
owner has not answered, STOP - the grammar depends on the answer.

READ FIRST
  core/src/registry/plan-source.ts - IN FULL. parseAwsfPlanHtmlV1, ParsedPlanTask,
    IMPLEMENTED_PLAN_FORMATS, UnsupportedPlanFormatError, PlanGrammarMismatchError
  core/test/unit/registry/plan-source.test.ts - every existing assertion; none may change
  specs/awsf-v2-w05-design-to-plan.html - milestone M2 task 3, and the "grammar extension" part
    of the Solution section
  specs/awsf-v2-plan.html - Questionable Q5, for the qualified-reference form

DO
  Create core/src/registry/plan-spine.ts. It is PURE: no filesystem, no clock, no child_process.
  It owns the identifier grammar and nothing else.
    - declaration form: <code class="inv">INV-n</code> and <code class="ac">AC-n</code> inside
      the plan's own spine section, each paired with a non-empty statement
    - claim form: <code class="serves">AC-n</code> inside a task's block; bare for a local
      identifier, <plan-stem>#AC-n for one declared in another plan
    - patterns: ^INV-[1-9][0-9]*$ and ^AC-[1-9][0-9]*$. No leading zero.
  Extend parseAwsfPlanHtmlV1 so ParsedPlanTask carries serves: readonly string[] and the parse
  result carries the plan-level declaration list.
  A string that starts INV- or AC- and does NOT match the full pattern is a HARD FAILURE by name,
  with its own error class in the closed hierarchy plan-source.ts already uses. Never a skip.
  A plan that declares zero identifiers parses exactly as it does today.

DO NOT
  Change IMPLEMENTED_PLAN_FORMATS or bump the format id. The extension is additive and optional;
  write the trigger for a real bump - making the spine mandatory - into the module comment.
  Loosen any existing heading pattern. The parser refuses foreign forms on purpose.
  Edit any file under specs/ other than this plan's own markers.
  Touch core/src/state/**, core/src/policy/**, AGENTS.md or awsf.config.yaml - protected paths.

DEFINITION OF DONE
  npm run test:unit && npm run typecheck && npm run lint, and every plan currently in specs/
  parses to the same task list as before. Full checklist: milestone M2 task 3 in the plan HTML.

MARKERS
  Flip THIS leaf plan's markers in specs/awsf-v2-w05-design-to-plan.html and
  specs/tickets/awsf-v2-w05-design-to-plan/T03.md in the same commit.
  NEVER touch specs/awsf-v2-plan.html's W05 marker - task 28 is the only task that does.
```

### T04 — The ticket-side claim, as one optional field

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  WHY     one field and one written rule; the judgement was already made in the plan.

TASK 4 of 28. Plan: specs/awsf-v2-w05-design-to-plan.html, milestone M2.
PREDECESSORS: T03 must be [x].

READ FIRST
  core/test/unit/meta/ticket-plan-sync.test.ts - the Ticket interface and the frontmatter
    vocabulary test, especially the comment explaining why tier and workflow are optional
  core/src/contracts/ticket.ts - TicketSchema. You are NOT modifying it; read it to see why
  specs/awsf-v2-w05-design-to-plan.html - milestone M2 task 4, and the derived-field rule in Notes
  specs/tickets/awsf-v2-w04-project-registry/README.md - the shape a derived-field rule takes

DO
  Teach the ticket reader in core/test/unit/meta/ticket-plan-sync.test.ts about one new OPTIONAL
  frontmatter field: serves: [AC-2, INV-1]. ONE field, not two - the prefix already discriminates
  an invariant from an acceptance criterion, and a second field would be a second vocabulary.
  Absent is a legitimate shape; present-but-malformed is the defect. Reuse plan-spine.ts's
  patterns rather than restating them.
  Create specs/tickets/awsf-v2-w05-design-to-plan/README.md if it does not exist, and write the
  serves derivation rule into it: it is READ OFF the plan, never derived. A reviewer who disagrees
  with a claim edits the plan and the ticket follows.

DO NOT
  Modify core/src/contracts/ticket.ts, TicketStore, or intakeRequest. W04 decided that the store's
  vocabulary and the fence's vocabulary stay separate and named the divergence as a known gap.
  This task does not quietly close it while doing something else.
  Add the coverage assertions yet - that is task 17.

DEFINITION OF DONE
  npm run test:unit && npm run typecheck. Full checklist: milestone M2 task 4 in the plan HTML.

MARKERS
  Flip THIS leaf plan's markers and specs/tickets/awsf-v2-w05-design-to-plan/T04.md in the same
  commit. NEVER touch specs/awsf-v2-plan.html's W05 marker.
```

### T05 — Testing Strategy — prove the parser refuses what it should

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  WHY     fixture-driven tests against a grammar that already exists.

TASK 5 of 28. Plan: specs/awsf-v2-w05-design-to-plan.html, milestone M2.
PREDECESSORS: T04 must be [x].

READ FIRST
  core/test/unit/registry/plan-source.test.ts - the shape these tests follow
  specs/awsf-v2-w05-design-to-plan.html - milestone M2 task 5

DO
  Write core/test/unit/registry/plan-spine.test.ts with fixtures held in memory, one failing case
  per rule, each with a distinguishable message:
    INV-01                       - leading zero, fails by name
    AC-1 and AC-3, no AC-2       - gap; contiguity is what makes a silent deletion visible
    AC-1 declared twice          - duplicate
    other-plan#INV-1 declared    - a declaration is never qualified
    a plan declaring nothing     - passes; this is a legitimate shape
  Add an assertion that every plan currently in specs/ parses to the same task list as before -
  read the committed files, not a fixture.

DO NOT
  Widen the parser to make a test pass. If a real plan fails, the parser is right and the plan
  needs looking at - report it rather than loosening the grammar.

DEFINITION OF DONE
  npm run test:unit && npm run typecheck && npm run lint. Close milestone M2: <h3> to [x].
  Full checklist: milestone M2 task 5 in the plan HTML.

MARKERS
  Flip THIS leaf plan's markers and specs/tickets/awsf-v2-w05-design-to-plan/T05.md in the same
  commit. NEVER touch specs/awsf-v2-plan.html's W05 marker.
```

### T06 — The design and architecture-review envelopes

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     a contract shipped wrong is a versioned migration later; the identifier patterns here
          travel into the agent's own prompt and become the rule the model is held to.

TASK 6 of 28. Plan: specs/awsf-v2-w05-design-to-plan.html, milestone M3.
PREDECESSORS: T05 must be [x] and milestone M2 must be [x].

READ FIRST
  core/src/contracts/envelope-base.ts - IN FULL. phaseEnvelope, ENVELOPE_BASE_PROPERTIES,
    HOST_OWNED_FIELD_NAMES, and the comment on WORKTREE_RELATIVE_PATH_PATTERN explaining why a
    rule belongs in the structure rather than only in a gate
  core/src/contracts/review-output.ts - REVIEW_SEVERITIES, BLOCKING_SEVERITIES, severityRank,
    ReviewFindingSchema
  core/src/contracts/plan-output.ts - the existing planning envelope, for shape not for copying
  specs/awsf-v2-w05-design-to-plan.html - milestone M3 task 6, and the envelope table in Solution

DO
  core/src/contracts/design-output.ts - awsf.design-output/v1 via phaseEnvelope, carrying:
    answeredRequest, components[], decisions[], invariants[], acceptanceCriteria[], openQuestions[]
  Identifier patterns are STRUCTURAL, on the schema: ^INV-[1-9][0-9]*$, ^AC-[1-9][0-9]*$,
  ^D-[1-9][0-9]*$ - so the rule reaches the designer through the emitted JSON Schema rather than
  only firing at gate time.
  Every acceptanceCriteria[] entry carries verifiedBy: how anyone would observe it holding. An
  acceptance criterion with no stated observation is prose.
  core/src/contracts/architecture-review-output.ts - awsf.architecture-review-output/v1 carrying
    reviewedDesign, verdict, findings[], limitations with minItems: 1.
  A finding's subject is a declared identifier or a named component - NOT a file path. An
  architecture review judges claims, and the repository it would name may not exist yet.

DO NOT
  Redeclare the severity vocabulary. Import REVIEW_SEVERITIES and BLOCKING_SEVERITIES from
  review-output.ts. One ordered vocabulary, one place to change it.
  Declare any field named in HOST_OWNED_FIELD_NAMES, in either case form.
  Hand-write a JSON Schema or an example envelope anywhere. One TypeBox definition, three
  emissions - core/test/unit/meta/no-handwritten-schema.test.ts enforces it.

DEFINITION OF DONE
  npm run test:unit && npm run typecheck && npm run lint.
  Full checklist: milestone M3 task 6 in the plan HTML.

MARKERS
  Flip THIS leaf plan's markers and specs/tickets/awsf-v2-w05-design-to-plan/T06.md in the same
  commit. NEVER touch specs/awsf-v2-plan.html's W05 marker.
```

### T07 — awsf.design-context/v1 — the repositories the design is about

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     this is the one envelope in the chain carrying machine-local absolute paths, and two
          invariants bite on it at once.

TASK 7 of 28. Plan: specs/awsf-v2-w05-design-to-plan.html, milestone M3.
PREDECESSORS: T06 must be [x].

WHY THIS PHASE EXISTS - read it before the instructions
  The project this factory is being built for keeps its plans in one repository and its code in
  two others. A chain that could only reason about the repository it runs in would be the wrong
  deliverable. This envelope is what tells the designer and the reviewer which repositories the
  design is about, and what records which revision of each was there.
  NOTHING NEEDED PERMISSION. path-policy judges write targets only, and sandbox-broker binds
  --ro-bind / / before binding the worktree writable - its own comment says "writes: [] confines
  WRITES and confines reads not at all". What was missing was supply and record, not access.

READ FIRST
  core/src/policy/sandbox-broker.ts - bwrapSpec, and the comment above the tmpfs line
  core/src/policy/path-policy.ts - its three violation reasons, all write-target reasons
  core/src/registry/catalog-schema.ts and core/src/registry/placement-schema.ts - where a
    project's repositories are declared and where each one's machine-local path lives
  core/src/contracts/review-context.ts - the host-composed context precedent
  specs/awsf-v2-w05-design-to-plan.html - milestone M3 task 7, "Reading three repositories,
    writing one" in Solution, and Questionable Q5

DO
  core/src/contracts/design-context.ts - awsf.design-context/v1 via phaseEnvelope, carrying
  targets[]: one entry per repository the project's catalog declares, each with repositoryId, the
  absolute path resolved from the machine-local placement layer, defaultBranch, and the headSha
  the host read at composition time.
  targets is minItems: 1 and always includes the plan repository itself, so a single-repository
  project is the DEGENERATE CASE of one path rather than a second path.
  WRITE THE REPRODUCIBILITY UNIT INTO THE MODULE COMMENT: headSha pins WHICH REVISION WAS
  AVAILABLE, not which files were opened. That is weaker than review_evidence_present's
  byte-level digest, and it is the right unit here - a designer explores a codebase where a
  reviewer judges a fixed diff.
  Register it in ENVELOPE_SCHEMAS and EnvelopeTypeById and export it from contracts/index.ts.

DO NOT
  Add a read glob, a read policy, or any new policy surface. Nothing forbids the read.
  Let this envelope be committed. It carries machine-local absolute paths: invariant 1 (no live
  task state in a committed file) and invariant 10 (no runtime artifact committed) both bite.
  It is journalled, and the render phase must never carry a target path into a rendered file.
  Give it a field the host cannot compute from the catalog, the placement layer, and git.
  Make it fetch, clone, or update anything. It reads what is on disk.

DEFINITION OF DONE
  npm run test:unit && npm run typecheck && npm run lint.
  Full checklist: milestone M3 task 7 in the plan HTML.

MARKERS
  Flip THIS leaf plan's markers and specs/tickets/awsf-v2-w05-design-to-plan/T07.md in the same
  commit. NEVER touch specs/awsf-v2-plan.html's W05 marker.
```

### T08 — The plan-context and design-plan envelopes, and registration

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     the literal-zero field is the load-carrying idea in this task and it is easy to write
          as an ordinary integer without noticing what was lost.

TASK 8 of 28. Plan: specs/awsf-v2-w05-design-to-plan.html, milestone M3.
PREDECESSORS: T07 must be [x].

READ FIRST
  core/src/contracts/review-context.ts - the existing host-composed context envelope; this is the
    precedent for plan-context
  core/src/contracts/registry.ts - ENVELOPE_SCHEMAS, EnvelopeTypeById, schemaForId. An envelope
    not registered here is unusable rather than silently unvalidated
  core/test/unit/meta/ticket-plan-sync.test.ts - the ticket id and milestone vocabularies a
    rendered plan must satisfy
  specs/awsf-v2-w05-design-to-plan.html - milestone M3 task 8, and Questionable Q1

DO
  core/src/contracts/plan-context.ts - awsf.plan-context/v1, HOST-composed, carrying:
    the identifier set the host copied from the design, the review verdict, the non-blocking
    findings the planner must still answer, and blockingFindingCount as Type.Literal(0).
  WRITE THE REASON FOR THE LITERAL INTO THE MODULE COMMENT: a plan context composed from a review
  that still reports a blocker is not merely gate-failing, it is UNREPRESENTABLE. The gate and the
  schema then agree by construction rather than by coincidence.
  core/src/contracts/design-plan-output.ts - awsf.design-plan-output/v1 carrying milestones[] and
    steps[], each step with id, title, milestone, files, serves, dependsOn and buildPrompt, plus
    testStrategy, risks and openQuestions.
  Step ids match ^T[0-9]{2}$ and milestone ids ^M[0-9]+$ - the vocabularies the sync fence already
  checks, so a rendered ticket set is well-formed before any gate sees it.
  Register all four of this milestone's envelopes in ENVELOPE_SCHEMAS and EnvelopeTypeById and
  export them from contracts/index.ts.

DO NOT
  Modify awsf.plan-output/v1 in any way. Questionable Q1 decided this route gets its own contract
  and named the migration; adding an optional field to the shared one would make the coverage join
  satisfiable by omission, which is not a gate.
  Give the plan context a field the host cannot compute from stored envelopes.

DEFINITION OF DONE
  npm run test:unit && npm run typecheck && npm run lint. emitAllEnvelopeJsonSchemas() includes
  all four new ids. Full checklist: milestone M3 task 8 in the plan HTML.

MARKERS
  Flip THIS leaf plan's markers and specs/tickets/awsf-v2-w05-design-to-plan/T08.md in the same
  commit. NEVER touch specs/awsf-v2-plan.html's W05 marker.
```

### T09 — Testing Strategy — rejection proved one field at a time

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  WHY     contract tests against schemas that already exist.

TASK 9 of 28. Plan: specs/awsf-v2-w05-design-to-plan.html, milestone M3.
PREDECESSORS: T08 must be [x].

READ FIRST
  core/test/unit/contracts/ - the existing envelope tests, for shape
  specs/awsf-v2-w05-design-to-plan.html - milestone M3 task 9

DO
  Contract tests under core/test/unit/contracts/ for all four new envelopes:
    each emits its JSON Schema, validates a good payload, and rejects an unknown field AT EVERY
    DEPTH - inside steps[] and findings[], not only at the top level
    a payload with blockingFindingCount: 1 fails awsf.plan-context/v1, proving the literal
    a review payload with limitations: [] fails, and the violation names the field
    emitAllEnvelopeJsonSchemas() includes all four ids, proving registration
  Close milestone M3: <h3> to [x].

DO NOT
  Reach around schemaForId to validate a payload. If a test needs to, the registration is missing.

DEFINITION OF DONE
  npm run test:unit && npm run typecheck && npm run lint, with no-handwritten-schema green.
  Full checklist: milestone M3 task 9 in the plan HTML.

MARKERS
  Flip THIS leaf plan's markers and specs/tickets/awsf-v2-w05-design-to-plan/T09.md in the same
  commit. NEVER touch specs/awsf-v2-plan.html's W05 marker.
```

### T10 — spine_declared

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  WHY     set arithmetic over an envelope, with the judgement already recorded in the plan.

TASK 10 of 28. Plan: specs/awsf-v2-w05-design-to-plan.html, milestone M4.
PREDECESSORS: T09 must be [x] and milestone M3 must be [x].
PARALLEL: T10, T11 and T12 all depend on T09 alone and may be built in any order or at once.
T15 rejoins on all three.

READ FIRST
  core/src/gates/interface.ts - GATE_IDS, GateReport, and the note-on-every-check behaviour
  core/src/gates/review.ts - verdictConsistent, for the shape a gate takes here
  core/src/registry/plan-spine.ts - the patterns and set helpers from task 3; reuse them
  specs/awsf-v2-w05-design-to-plan.html - milestone M4 task 10

DO
  core/src/gates/design-spine.ts, exporting spineDeclared(design, expectation) -> GateReport:
    answeredRequest, trimmed, equals the owner-recorded request; the note reports BOTH when they
      differ, because a note that says only "mismatch" cannot be acted on
    INV, AC and D identifiers are contiguous from 1, unique, and each carries a non-empty statement
    at least one AC - a design with nothing to verify has produced no acceptance boundary
    no declaration is qualified by a plan stem: Q5's rule enforced at the point of DECLARATION
  Register spine_declared in GATE_IDS.

DO NOT
  Read the filesystem, a clock, or the network. Everything the gate needs is in the envelope or
  in the expectation the host passes it.
  Duplicate the identifier patterns - import them from plan-spine.ts.

DEFINITION OF DONE
  npm run test:unit && npm run typecheck && npm run lint.
  Full checklist: milestone M4 task 10 in the plan HTML.

MARKERS
  Flip THIS leaf plan's markers and specs/tickets/awsf-v2-w05-design-to-plan/T10.md in the same
  commit. NEVER touch specs/awsf-v2-plan.html's W05 marker.
```

### T11 — design_evidence_present

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  WHY     set comparison between a catalog and a context, with the judgement already recorded.

TASK 11 of 28. Plan: specs/awsf-v2-w05-design-to-plan.html, milestone M4.
PREDECESSORS: T09 must be [x] and milestone M3 must be [x].
PARALLEL: T10, T11 and T12 all depend on T09 alone. No two of them call each other, so they may
be built in any order or at the same time. T15 rejoins on all three.

READ FIRST
  core/src/gates/interface.ts - GATE_IDS, GateReport, and the note-on-every-check behaviour
  core/src/workflow/review-evidence.ts - the fitness/presence split, and the byte-level standard
    this gate deliberately does not meet
  core/src/contracts/design-context.ts - task 7's envelope
  specs/awsf-v2-w05-design-to-plan.html - milestone M4 task 11, and the warning card
    "The reproducibility unit is a revision, not a byte" in Solution

DO
  core/src/gates/design-evidence.ts, exporting designEvidencePresent(context, catalog)
  -> GateReport:
    every repository the catalog declares appears EXACTLY ONCE in targets; the note NAMES any that
      are missing, because a design written without one of its repositories looks complete
    every target resolved to an existing path and a non-empty headSha
    the plan repository is among the targets and is the one the attempt's worktree belongs to
  THE PASSING NOTE CARRIES THE LIMIT, in the same discipline as the two review gates: this proves
  which revisions were AVAILABLE to the designer, never which files it read.
  Register design_evidence_present in GATE_IDS and attach it to the design-context phase.

DO NOT
  Make it correctable. A missing or unresolvable repository is a REGISTRY FAULT, and no model turn
  fixes a registry. It fails before the design call is reserved.
  Soften a missing repository to a warning. A design against two repositories out of three is
  exactly the failure this gate exists to catch.
  Read the filesystem inside the gate. The host composed the context; this function decides.

DEFINITION OF DONE
  npm run test:unit && npm run typecheck && npm run lint.
  Full checklist: milestone M4 task 11 in the plan HTML.

MARKERS
  Flip THIS leaf plan's markers and specs/tickets/awsf-v2-w05-design-to-plan/T11.md in the same
  commit. NEVER touch specs/awsf-v2-plan.html's W05 marker.
```

### T12 — architecture_verdict_consistent, and the limit written onto the green row

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     the stated limit is the part of this workstream most likely to be quietly trimmed for
          tidiness, and the wording has to survive that.

TASK 12 of 28. Plan: specs/awsf-v2-w05-design-to-plan.html, milestone M4.
PREDECESSORS: T09 must be [x].
PARALLEL: T10, T11 and T12 all depend on T09 alone; no two of them call each other.

READ FIRST
  core/src/gates/review.ts - verdictConsistent IN FULL, especially the four checks and how each
    note reads on a PASS as well as a fail
  core/src/gates/interface.ts - GateReport's comment: "a passing report still explains every
    check it performed". That behaviour is what this task rides
  specs/awsf-v2-w05-design-to-plan.html - milestone M4 task 12, and "The limit belongs on the
    green row, not in a footnote" in Solution

DO
  core/src/gates/architecture-review.ts, exporting architectureVerdictConsistent(review, design)
  -> GateReport with these checks:
    reviewedDesign echoes the design envelope's summary exactly - the reviewedSha pattern applied
      to an artifact that has no SHA yet
    every finding's subject resolves to a declared identifier or a named component; the note lists
      any that do not
    accept carries no high or critical finding
    concern carries at least one finding with all four of subject, title, detail and evidence
    limitations is non-empty, and the note says what the reviewer declared it did not check
  THE PASSING NOTE CARRIES THE STATED LIMIT, in words close to:
    "N blocking of M finding(s); this gate checks the verdict's shape, not the review's
     thoroughness - a zero here is envelope consistency, never a clean design"
  Register architecture_verdict_consistent in GATE_IDS.

DO NOT
  Shorten or soften the limit sentence to make output tidier. Task 15 asserts it is present in the
  PASSING report precisely so that a later tidy-up fails a test instead of losing the sentence.
  Give this gate the zero-blocker rule. That is task 13, on a different phase, and the separation
  is the point.

DEFINITION OF DONE
  npm run test:unit && npm run typecheck && npm run lint.
  Full checklist: milestone M4 task 12 in the plan HTML.

MARKERS
  Flip THIS leaf plan's markers and specs/tickets/awsf-v2-w05-design-to-plan/T12.md in the same
  commit. NEVER touch specs/awsf-v2-plan.html's W05 marker.
```

### T13 — architecture_review_clear — the deterministic zero-blocker gate

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT xhigh
  CLAUDE  claude:opus · /effort xhigh
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     the single easiest thing in this workstream to build wrong: attach it to the review
          phase, give it a correction round, and the chain quietly buys a softened verdict.

TASK 13 of 28. Plan: specs/awsf-v2-w05-design-to-plan.html, milestone M4.
PREDECESSORS: T12 must be [x].

READ FIRST
  specs/awsf-v2-w05-design-to-plan.html - milestone M4 task 13, the warning card "Why the
    zero-blocker gate must not be correctable" in Solution, and Questionable Q6
  core/src/gates/review.ts - the fitness-versus-gate split at the top of review_evidence_present;
    this task borrows that vocabulary
  core/src/state/task-machine.ts - the ten states and twenty-five edges. READ ONLY. It is a
    protected path and it is not modified by this or any task in this plan
  core/src/workflow/engine.ts - authorizeCorrection and how a gate violation becomes a correction

THE SHAPE, STATED BEFORE THE INSTRUCTIONS BECAUSE IT IS THE WHOLE TASK
  Every other gate in this chain fails because the party who can fix it is still in the session.
  This one is different: the party at fault is the DESIGNER, whose session closed two phases ago.
  A correction round here would resume the REVIEWER and ask it to try again against an unchanged
  design - which is asking it to produce a different verdict about the same artifact. That is an
  incentive to soften a finding, and it is the one correction this chain must never buy.

DO
  Add architectureReviewClear(review, carriedIdentifiers) -> GateReport to
  core/src/gates/architecture-review.ts:
    blocking findings number zero AND the verdict is accept
    the identifier set carried into the plan context equals the design's exactly, so the planner
      cannot be handed a set the reviewer never saw
    the passing note carries the SAME stated limit as task 12 - this is the row a reader of a
      green run actually sees
  Register architecture_review_clear in GATE_IDS.
  Write the reason into the module comment, in one sentence a reader can disagree with: this gate
  is attached to the host plan-context phase, NOT to the review phase, and appears in no phase's
  correction path.
  Specify - in the comment, for task 26 to implement - that on failure the attempt stops at
  AWAITING_OWNER with the findings journalled, THROUGH THE EXISTING EDGES ONLY.

DO NOT
  Add it to the architecture-review phase's gate list.
  Add a task state, a legal edge, or any file under core/src/state/. LEGAL_EDGES.length stays 25
  and core/test/unit/transitions.test.ts stays untouched - it already pins that in four places.
  Add a bypass flag, an override option, or a "warn only" mode. Questionable Q6 decided the
  override is an owner act through L19, taken in the open and drawing on a correction allowance.

DEFINITION OF DONE
  npm run test:unit && npm run typecheck && npm run lint, with transitions.test.ts green and
  unmodified. Full checklist: milestone M4 task 13 in the plan HTML.

MARKERS
  Flip THIS leaf plan's markers and specs/tickets/awsf-v2-w05-design-to-plan/T13.md in the same
  commit. NEVER touch specs/awsf-v2-plan.html's W05 marker.
```

### T14 — spine_carried

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  WHY     set arithmetic plus one lookup, against rules the plan already states exactly.

TASK 14 of 28. Plan: specs/awsf-v2-w05-design-to-plan.html, milestone M4.
PREDECESSORS: T10 must be [x]. T13 may or may not be done; the two branches are independent.

READ FIRST
  core/src/registry/plan-source.ts - resolvePlanSources, which is how a qualified reference
    resolves without an allocator
  core/src/registry/plan-spine.ts - task 3's grammar module
  specs/awsf-v2-w05-design-to-plan.html - milestone M4 task 14, and Q-A's five rules

DO
  Add spineCarried(planEnvelope, context, knownStems) -> GateReport to
  core/src/gates/design-spine.ts:
    every identifier in the plan context is served by at least one step; the note NAMES any that
      are not, because "coverage failed" is not actionable and "AC-3 is served by nothing" is
    no step serves an identifier the context does not carry
    a <plan-stem>#INV-n reference resolves against the catalog's own plan list; an unresolvable
      stem fails and the note names the stem
    step ids are T01..Tnn contiguous with no gaps, and dependsOn points only at earlier steps
  Register spine_carried in GATE_IDS.

DO NOT
  Build an index, a cache, or a registry of identifiers. The resolved plan-source list is already
  in hand and that is the whole of Q5's "no allocator" claim.
  Accept a bare identifier that is not in the context because "it probably means another plan".
  A cross-plan reference is qualified or it is wrong.

DEFINITION OF DONE
  npm run test:unit && npm run typecheck && npm run lint.
  Full checklist: milestone M4 task 14 in the plan HTML.

MARKERS
  Flip THIS leaf plan's markers and specs/tickets/awsf-v2-w05-design-to-plan/T14.md in the same
  commit. NEVER touch specs/awsf-v2-plan.html's W05 marker.
```

### T15 — Testing Strategy — determinism asserted, not assumed

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  WHY     fixture tests against four pure functions.

TASK 15 of 28. Plan: specs/awsf-v2-w05-design-to-plan.html, milestone M4.
PREDECESSORS: T11, T13 AND T14 must all be [x] - this task rejoins M4's three branches.

READ FIRST
  core/test/unit/gates/verdict-consistent.test.ts - the shape these tests follow
  specs/awsf-v2-w05-design-to-plan.html - milestone M4 task 15

DO
  core/test/unit/gates/design-spine.test.ts, core/test/unit/gates/architecture-review.test.ts
  and core/test/unit/gates/design-evidence.test.ts:
    every gate passes its good fixture and fails each bad one INDIVIDUALLY, with the failing
      check named in the assertion
    DETERMINISM: run each gate twice over one frozen envelope and deep-equal the two checks
      arrays. Five gates, five assertions
    THE STATED LIMIT is asserted present in the PASSING report of both review gates AND of
      design_evidence_present, so none of the three can be trimmed away later
    A THREE-REPOSITORY FIXTURE whose catalog declares three targets and whose context carries two
      turns design_evidence_present red, and the note names the missing repository. This is the
      fixture that would have caught this workstream's own falsified assumption - it is not
      optional
  Confirm core/test/unit/transitions.test.ts is untouched and still pins twenty-five edges.
  Close milestone M4: <h3> to [x].

DO NOT
  Assert on the exact full text of a note beyond the load-carrying clause; a test that pins every
  word makes the note unmaintainable and teaches the next author to delete it.

DEFINITION OF DONE
  npm run test:unit && npm run typecheck && npm run lint.
  Full checklist: milestone M4 task 15 in the plan HTML.

MARKERS
  Flip THIS leaf plan's markers and specs/tickets/awsf-v2-w05-design-to-plan/T15.md in the same
  commit. NEVER touch specs/awsf-v2-plan.html's W05 marker.
```

### T16 — spineCoverage as one pure function, shared by both surfaces

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     one function serving a runtime gate and an offline fence is what stops the two from
          drifting, and the interface has to work for both without leaking either.

TASK 16 of 28. Plan: specs/awsf-v2-w05-design-to-plan.html, milestone M5.
PREDECESSORS: T15 must be [x] and milestone M4 must be [x].

READ FIRST
  core/test/unit/meta/ticket-plan-sync.test.ts - IN FULL. Its PlanSet type, planSets(), tickets(),
    and the way every failure message names WHICH plan drifted
  core/src/registry/plan-spine.ts - task 3's module, which this function joins
  specs/awsf-v2-w05-design-to-plan.html - milestone M5 task 16

DO
  Add spineCoverage(declared, planTasks, tickets, knownStems) -> violations[] to
  core/src/registry/plan-spine.ts. It is PURE: it reads no file and knows nothing about node:test.
  Each violation names the plan label, the identifier, and which of the four rules it broke.
  The SAME function backs spine_carried at run time and the meta-test offline, so the runtime gate
  and the offline fence cannot drift apart. If the two need different inputs, change the inputs -
  do not fork the function.

DO NOT
  Put filesystem access, test framework imports, or a plan-source resolution call inside it. The
  caller resolves and passes in; this function decides.

DEFINITION OF DONE
  npm run test:unit && npm run typecheck && npm run lint.
  Full checklist: milestone M5 task 16 in the plan HTML.

MARKERS
  Flip THIS leaf plan's markers and specs/tickets/awsf-v2-w05-design-to-plan/T16.md in the same
  commit. NEVER touch specs/awsf-v2-plan.html's W05 marker.
```

### T17 — Extend ticket-plan-sync with the coverage assertions

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     this is invariant 12's fence. Getting the conditional-engagement rule wrong either
          fails every existing plan or makes the new assertions vacuous.

TASK 17 of 28. Plan: specs/awsf-v2-w05-design-to-plan.html, milestone M5.
PREDECESSORS: T16 must be [x].

READ FIRST
  core/test/unit/meta/ticket-plan-sync.test.ts - IN FULL, including the header comment about
    invariant 12 and the comment in "frontmatter values stay inside their vocabularies" explaining
    why tier and workflow are optional. That comment is the precedent this task mirrors
  AGENTS.md - invariant 12 in its current amended form
  specs/awsf-v2-w05-design-to-plan.html - milestone M5 task 17

DO
  Add four assertions to core/test/unit/meta/ticket-plan-sync.test.ts, each in its OWN NAMED TEST
  so a failure is reported under its own name rather than inside whichever assertion ran first:
    COVERAGE  - every identifier the plan declares is served by at least one of its tasks
    ORPHANS   - no task and no ticket claims an identifier the plan does not declare, unless it is
                qualified and resolvable
    MIRROR    - a ticket's serves equals its plan task's served set EXACTLY, the same relation the
                fence already enforces for milestone and state
    Q5        - identifiers are unique and contiguous within a plan, and a qualified reference
                resolves to a stem in the resolved plan-source list
  CONDITIONAL ENGAGEMENT: a plan declaring no identifiers whose tickets claim none PASSES. Write
  the reason as a comment beside the existing tier/workflow note it mirrors.

DO NOT
  Change any of the ten assertions already there.
  Make the new assertions unconditional. Every plan currently in specs/ declares nothing, and a
  fence that fails all of them on day one gets weakened rather than satisfied.
  Edit AGENTS.md. Invariant 12's text is already true of this change - it strengthens what the
  fence proves without changing what the invariant claims. If you find yourself wanting to edit
  it, the scope drifted.

DEFINITION OF DONE
  npm run test:unit - green with every existing plan set unchanged.
  Full checklist: milestone M5 task 17 in the plan HTML.

MARKERS
  Flip THIS leaf plan's markers and specs/tickets/awsf-v2-w05-design-to-plan/T17.md in the same
  commit. NEVER touch specs/awsf-v2-plan.html's W05 marker.
```

### T18 — This plan opts in, and becomes the first real instance

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  WHY     writing down claims the plan already argues, in a grammar that already exists.

TASK 18 of 28. Plan: specs/awsf-v2-w05-design-to-plan.html, milestone M5.
PREDECESSORS: T17 must be [x].

READ FIRST
  specs/awsf-v2-w05-design-to-plan.html - Purpose, Solution and Notes IN FULL. The identifiers you
    declare must be statements this plan ALREADY makes, given numbers - not new claims invented
    to fill a section
  specs/awsf-v2-w05-design-to-plan.html - milestone M5 task 18, and Questionable Q2

DO
  Add a spine section to specs/awsf-v2-w05-design-to-plan.html declaring this workstream's own
  INV and AC statements in the task-3 grammar. Candidates already argued in the plan:
    an invariant about no new task state or legal edge
    an invariant about no skill anywhere in an execution path
    an acceptance criterion about a deliberately dropped identifier turning the gate red
    an acceptance criterion about the stated limit being present on a passing gate row
  Every AC carries how anyone would observe it holding.
  Add the serves claim to each task that satisfies one, and the matching serves: field to each
  ticket in specs/tickets/awsf-v2-w05-design-to-plan/.
  Record in specs/tickets/awsf-v2-w05-design-to-plan/README.md that serves is read off the plan,
  never derived.

DO NOT
  Edit any other plan in specs/. v1 stays history and the other v2 plans opt in when their own
  workstreams choose to - Questionable Q2 decided this.
  Declare an identifier this plan does not already argue for. A spine of restated summary lines
  satisfies every gate and means nothing; that risk is named in the plan and this is where it
  would enter.

DEFINITION OF DONE
  npm run test:unit - the coverage assertions from task 17 now ENGAGE on this plan set and pass.
  Full checklist: milestone M5 task 18 in the plan HTML.

MARKERS
  Flip THIS leaf plan's markers and specs/tickets/awsf-v2-w05-design-to-plan/T18.md in the same
  commit. NEVER touch specs/awsf-v2-plan.html's W05 marker.
```

### T19 — Testing Strategy — three induced drifts, watched going red

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     this is the task that decides whether the coverage gate is real. A session that
          reports "it would have caught it" instead of running it has failed the task.

TASK 19 of 28. Plan: specs/awsf-v2-w05-design-to-plan.html, milestone M5.
PREDECESSORS: T18 must be [x].

READ FIRST
  specs/awsf-v2-w05-design-to-plan.html - milestone M5 task 19
  specs/awsf-v2-w04-project-registry.html - milestone M4's induced-drift task, for the standard
    of evidence this repository expects

DO
  Fixture tests first: core/test/unit/registry/plan-spine.test.ts gains one failing case per rule,
  each with a distinguishable message.
  Then THREE INDUCED DRIFTS against the real committed plan set. For each: make the change, RUN
  npm run test:unit, RECORD THE EXACT FAILURE TEXT, restore, and confirm green.
    1. Delete one AC declaration from specs/awsf-v2-w05-design-to-plan.html. The gate must go red
       NAMING THAT IDENTIFIER.
    2. Delete the serves: line from one ticket while leaving the plan intact. The MIRROR assertion
       must catch it.
    3. Change one claim to no-such-plan#AC-1. The unresolvable stem must be NAMED.
  Record all three failure texts in this plan's Amendments. The evidence is the message, not the
  exit code - a message that says only "assertion failed" is a finding about the test, not proof.
  Close milestone M5: <h3> to [x].

DO NOT
  Report an induced drift you did not actually run.
  Fix a fixture when a drift fails to go red. If the gate does not bite, THE GATE IS WRONG - fix
  the gate.
  Leave any drift in place. The suite must be green with everything restored before this task
  closes.

DEFINITION OF DONE
  npm run test:unit && npm run typecheck && npm run lint, all green with everything restored, and
  three failure texts in Amendments. Full checklist: milestone M5 task 19 in the plan HTML.

MARKERS
  Flip THIS leaf plan's markers and specs/tickets/awsf-v2-w05-design-to-plan/T19.md in the same
  commit. NEVER touch specs/awsf-v2-plan.html's W05 marker.
```

### T20 — renderPlanDocument — the plan and its build prompts

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     the renderer is the inverse of a parser that refuses foreign forms, so every emitted
          byte has to be the shape the parser already accepts.

TASK 20 of 28. Plan: specs/awsf-v2-w05-design-to-plan.html, milestone M6.
PREDECESSORS: T19 must be [x] and milestone M5 must be [x].

READ FIRST
  core/src/registry/plan-source.ts - parseAwsfPlanHtmlV1 IN FULL. Its regexes are the contract
    this renderer must satisfy, character for character
  core/test/unit/meta/ticket-plan-sync.test.ts - sectionBPrompts(), and the "every plan task
    carries a checklist" test. A rendered plan must not be born failing either one
  specs/awsf-v2-w05-design-to-plan.html - milestone M6 task 20
  specs/awsf-v2-w04-project-registry-build-prompts.md - the Section B format to emit

DO
  core/src/registry/plan-render.ts, exporting renderPlanDocument(envelope) -> Map<relative path,
  contents>. PURE: envelope in, file contents out. It writes nothing itself.
  Emit awsf-plan-html/v1 exactly as parseAwsfPlanHtmlV1 accepts it: milestone headings with status
  markers, numbered task headings, A CHECKLIST PER TASK, and the spine section carrying
  declarations and claims.
  Emit <stem>-build-prompts.md with a "# Section B - Task prompts (recommended)" block and one
  "### T<nn> - <title>" heading per step, in the shape the sync fence parses today.
  ALL markers render as [] and every ticket state as todo. A rendered plan claims no completed
  work - AGENTS.md invariant 2, applied to a document a machine wrote.

DO NOT
  Read a clock, a random source, or the filesystem. Rendering the same envelope twice must produce
  byte-identical output.
  Emit a receipt, a manifest, or a run log - AGENTS.md invariant 10.
  Emit any marker other than []. A renderer that can write [x] is a renderer that can lie.

DEFINITION OF DONE
  npm run test:unit && npm run typecheck && npm run lint.
  Full checklist: milestone M6 task 20 in the plan HTML.

MARKERS
  Flip THIS leaf plan's markers and specs/tickets/awsf-v2-w05-design-to-plan/T20.md in the same
  commit. NEVER touch specs/awsf-v2-plan.html's W05 marker.
```

### T21 — The ticket set, its README, and byte-identity by construction

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     the one string written twice is the property that makes invariant 12 structural here,
          and it is lost the moment either side is reformatted independently.

TASK 21 of 28. Plan: specs/awsf-v2-w05-design-to-plan.html, milestone M6.
PREDECESSORS: T20 must be [x].

READ FIRST
  core/test/unit/meta/ticket-plan-sync.test.ts - the tickets() reader and the byte-identity
    assertion. Note exactly how each side is trimmed
  specs/tickets/awsf-v2-w04-project-registry/README.md - the derived-field rule format
  specs/awsf-v2-w05-design-to-plan.html - milestone M6 task 21, and Questionable Q4

DO
  Extend renderPlanDocument to emit specs/tickets/<stem>/T<nn>.md per step, with frontmatter that
  PARSES - title ALWAYS QUOTED, because a task title routinely contains a colon and YAML reads
  that as a nested mapping.
  THE TICKET BODY'S BUILD PROMPT AND THE SECTION B BLOCK ARE THE SAME STRING, taken ONCE from the
  envelope. Not two formatters producing matching output - one string, written twice.
  Emit specs/tickets/<stem>/README.md with the derived-field rules for the set it just wrote.
  depends_on is carried from the envelope's dependsOn, never a blind n-1 chain, so declared
  parallelism survives rendering.

DO NOT
  Emit anything else. A receipt, a manifest, or an index file violates invariant 10 and the
  renderer has no reason to want one.
  Format the two copies of a build prompt separately, even if the output currently matches. The
  claim in this plan is that byte-identity is a property of the code, and two formatters make it
  a coincidence again.

DEFINITION OF DONE
  npm run test:unit && npm run typecheck && npm run lint.
  Full checklist: milestone M6 task 21 in the plan HTML.

MARKERS
  Flip THIS leaf plan's markers and specs/tickets/awsf-v2-w05-design-to-plan/T21.md in the same
  commit. NEVER touch specs/awsf-v2-plan.html's W05 marker.
```

### T22 — Testing Strategy — the round trip is the correctness claim

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  WHY     a round-trip test against two functions that already exist.

TASK 22 of 28. Plan: specs/awsf-v2-w05-design-to-plan.html, milestone M6.
PREDECESSORS: T21 must be [x].

READ FIRST
  specs/awsf-v2-w05-design-to-plan.html - milestone M6 task 22

DO
  core/test/unit/registry/plan-render.test.ts:
    parseAwsfPlanHtmlV1(render(e)) returns the milestones, task numbers, checklists and
      identifiers that e declared
    every rendered ticket's frontmatter parses with the same yaml reader the fence uses, asserted
      on a title CONTAINING A COLON
    a rendered set run through spineCoverage produces ZERO violations - the renderer's output
      satisfies M5's gate, which is why M5 came first
    rendering the same envelope twice produces byte-identical output
    edge cases that would corrupt a downstream reader silently: a colon in a title, a backtick in
      a build prompt, an apostrophe in a statement
  Close milestone M6: <h3> to [x].

DO NOT
  Loosen the parser to make the round trip pass. If it needs loosening, the renderer is emitting a
  grammar the format does not have - fix the renderer.

DEFINITION OF DONE
  npm run test:unit && npm run typecheck && npm run lint.
  Full checklist: milestone M6 task 22 in the plan HTML.

MARKERS
  Flip THIS leaf plan's markers and specs/tickets/awsf-v2-w05-design-to-plan/T22.md in the same
  commit. NEVER touch specs/awsf-v2-plan.html's W05 marker.
```

### T23 — Confirm G1, then write the two role prompts

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     prompt text is the least testable artifact in the repository, and the reviewer prompt
          in particular decides whether the limitations field is answered or padded.

TASK 23 of 28. Plan: specs/awsf-v2-w05-design-to-plan.html, milestone M7.
PREDECESSORS: T22 must be [x], milestone M6 must be [x], AND ordering gate G1 below must hold.

ORDERING GATE G1 - THE FIRST THING THIS MILESTONE DOES
  specs/awsf-v2-w06-prompt-composition.html MUST EXIST and its centralisation milestone MUST be
  [x] before any box in milestone M7 is checked. W06 turns three independent system-prompt
  composition sites into one. Every task in M7 touches a role's prompt path, and adding a role
  before the sites are one site creates the fourth copy this gate exists to prevent.
  If W06's plan does not exist or its centralisation is not [x], STOP AND REPORT. Do not build the
  role prompts "so they are ready" - that is exactly the fourth copy, arriving early.

READ FIRST
  specs/awsf-v2-w06-prompt-composition.html - confirm the centralisation milestone reads [x].
    This is your first act
  prompts/reviewer/system.md and prompts/reviewer/user.md - the existing reviewer, for tone and
    for what a role prompt does and does not carry
  core/src/contracts/json-schema.ts - {output_schema} and {previous_envelope}
  core/test/unit/meta/no-handwritten-schema.test.ts - what a prompt may never restate
  specs/awsf-v2-w05-design-to-plan.html - milestone M7 task 23, and Questionable Q3

DO
  prompts/designer/system.md and prompts/designer/user.md.
  prompts/architecture-reviewer/system.md and prompts/architecture-reviewer/user.md.
  Each user prompt declares {output_schema} and {previous_envelope} and restates NO shape by hand.
  The architecture-reviewer prompt carries one instruction that is the point of the role: STATE
  WHAT YOU DID NOT CHECK. limitations is required non-empty, and a reviewer that has not been
  asked will fill it with something worthless.

DO NOT
  Duplicate whatever shared block W06 introduced. If a sentence belongs to every role, it belongs
  in W06's one place - noticing that is part of this task.
  Write a JSON Schema, an example envelope, or a TypeScript interface into any prompt file.
  Give either role a write glob. Both are readonly: a reviewer that cannot fix cannot quietly fix,
  and a designer that can write is a builder.

DEFINITION OF DONE
  npm run test:unit - no-handwritten-schema.test.ts green over the four new files.
  Full checklist: milestone M7 task 23 in the plan HTML.

MARKERS
  Flip THIS leaf plan's markers and specs/tickets/awsf-v2-w05-design-to-plan/T23.md in the same
  commit. NEVER touch specs/awsf-v2-plan.html's W05 marker.
```

### T24 — The recipe, the workflow id, and the registration

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  WHY     data-shaped recipe assembly against a compiler that refuses everything wrong at
          construction time.

TASK 24 of 28. Plan: specs/awsf-v2-w05-design-to-plan.html, milestone M7.
PREDECESSORS: T23 must be [x]. Ordering gate G1 still applies to this whole milestone.

READ FIRST
  core/src/workflow/recipes/simple-sdlc.ts - the tier-2 recipe with a host review-context phase
  core/src/workflow/compiler.ts - compileWorkflow, assertEarnedDescription, minimumCalls
  core/src/config/schema.ts - KNOWN_WORKFLOW_IDS
  core/test/unit/workflow/recipes.test.ts - the "exactly seven" assertion you are updating
  specs/awsf-v2-w05-design-to-plan.html - milestone M7 task 24, and the phase table in Solution

DO
  core/src/workflow/recipes/design-to-plan.ts - six phases in order, tier: 2, three agent phases,
  as const satisfies WorkflowRecipe:
    request           engineer  awsf.plan-output/v1
    design            agent     awsf.design-output/v1                  gate spine_declared
    architecture-review agent   awsf.architecture-review-output/v1     gate architecture_verdict_consistent
    plan-context      code      awsf.plan-context/v1                   gate architecture_review_clear
    plan              agent     awsf.design-plan-output/v1             gate spine_carried
    plan-render       code      awsf.document-output/v1
  Each description is EARNED - assertEarnedDescription rejects one that merely restates the phase
  id, and it fails at compile time rather than at run time.
  Add design-to-plan to KNOWN_WORKFLOW_IDS in core/src/config/schema.ts. THIS IS THE TASK THAT
  MUST PRECEDE THE OWNER'S CONFIG AMENDMENT.
  Register it in SUPPORTED in core/src/cli/commands/production-run.ts and in the recipe list in
  core/test/unit/workflow/recipes.test.ts, whose "exactly seven" assertion becomes eight with the
  phase order and call count spelled out.

DO NOT
  Write awsf.config.yaml. It is a protected path and the amendment is an owner act - see the
  plan's "Amendment Required Before the Route Runs" section.
  Give the architecture-review phase the awsf.review-output/v1 schema id. isReviewPhase selects
  the L11 spawn site BY SCHEMA ID, and reusing it would turn this phase into a task-machine
  transition, which the whole design refuses.
  Extend isReviewPhase to cover the architecture review in order to get automatic provider
  inversion. That is the same test, and it would drag the phase back into the transition
  machinery. Cross-provider here is a CONFIG choice - the owner's amendment puts the reviewer on
  the adapter the designer is not on - and fresh-session independence holds regardless, because
  both roles carry continuity: none.
  Add a fourth composition site, a new runner, or a new CLI command.

DEFINITION OF DONE
  npm run test:unit && npm run typecheck && npm run lint. compileWorkflow(designToPlan, 2) admits:
  minimumCalls is 3 against a tier-2 ceiling of 5.
  Full checklist: milestone M7 task 24 in the plan HTML.

MARKERS
  Flip THIS leaf plan's markers and specs/tickets/awsf-v2-w05-design-to-plan/T24.md in the same
  commit. NEVER touch specs/awsf-v2-plan.html's W05 marker.
```

### T25 — Bind design-context, and resolve the targets through W04's registry

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     the task where a plausible-looking policy change would undo the reason this design is
          cheap, and where the single-writable-worktree property is either proven or assumed.

TASK 25 of 28. Plan: specs/awsf-v2-w05-design-to-plan.html, milestone M7.
PREDECESSORS: T24 must be [x]. Ordering gate G1 still applies to this whole milestone.

READ FIRST
  core/src/cli/commands/production-run.ts - the code-phase branch keyed by REVIEW_CONTEXT_SCHEMA_ID
  core/src/registry/resolve.ts, catalog.ts, placement.ts - W04's resolution, already built
  core/src/git/changes.ts - systemGitRunner, for reading another repository's head revision
  core/src/policy/sandbox-broker.ts and core/src/policy/path-policy.ts - the two files this task
    must READ and must NOT change
  specs/awsf-v2-w05-design-to-plan.html - milestone M7 task 25, and Questionable Q5

DO
  Bind design-context in the phase loop: the host composes it from the project's catalog plus the
  machine-local placement layer - both already built by W04 - and reads each target's headSha with
  the existing systemGitRunner.
  The composed target paths reach the designer and the architecture reviewer as ordinary envelope
  content, so both phases know where to read WITHOUT a prompt naming a path.
  VERIFY, do not assume: path-policy judges write targets only, and sandbox-broker already binds
  the whole filesystem read-only before binding the worktree writable.
  ASSERT THE WRITE BOUNDARY: a run over a three-repository project touches no file outside the
  plan repository's worktree.
  ASSERT THE DEGENERATE CASE: a project whose catalog declares one repository composes a one-entry
  targets and behaves exactly as it did before this task.

DO NOT
  Add a read glob, a read policy, a second writable root, or any new policy surface. If this task
  starts editing core/src/policy/**, stop - it is a protected path AND the change is unnecessary.
  Fetch, clone, or update a target repository. The chain reads what is on disk and records its
  revision; a chain that fetched would make another repository's state its business mid-attempt.
  Write anything outside the attempt's worktree.
  Add a task state or a legal edge. LEGAL_EDGES.length stays 25.

DEFINITION OF DONE
  npm run test:unit && npm run typecheck && npm run lint, with core/src/policy/** unchanged.
  Full checklist: milestone M7 task 25 in the plan HTML.

MARKERS
  Flip THIS leaf plan's markers and specs/tickets/awsf-v2-w05-design-to-plan/T25.md in the same
  commit. NEVER touch specs/awsf-v2-plan.html's W05 marker - task 28 does that.
```

### T26 — Bind the remaining two host phases inside the one composition site

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT xhigh
  CLAUDE  claude:opus · /effort xhigh
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     this task edits the file ordering gate G1 is about. Adding a branch is correct; adding
          a second way to compose a prompt is the failure the gate exists to prevent.

TASK 26 of 28. Plan: specs/awsf-v2-w05-design-to-plan.html, milestone M7.
PREDECESSORS: T25 must be [x]. Ordering gate G1 still applies.

READ FIRST
  core/src/cli/commands/production-run.ts - IN FULL, especially the routePrompts composition
    around the recipe loop, isReviewPhase, requestOutput, and the code-phase branch keyed by
    REVIEW_CONTEXT_SCHEMA_ID. That branch is the precedent for both new host phases
  core/src/gates/architecture-review.ts - the module comment from task 13 specifying the stop
  core/src/state/task-machine.ts - READ ONLY. The edges the stop must travel
  specs/awsf-v2-w05-design-to-plan.html - milestone M7 task 26, and the G1 section

DO
  Bind plan-context: the host composes it from the STORED design and review envelopes, in the
  phase loop, keyed by its schema id - the same way review-context already is.
  Bind plan-render: it writes its three files into the managed worktree and the host commits them;
  no_protected_paths and diff_matches_claims run against that commit.
  On a failed architecture_review_clear, the attempt stops at AWAITING_OWNER with the findings
  journalled, THROUGH THE EXISTING EDGES ONLY.
  ASSERT THE COUNT: a test counts the independent system-prompt composition sites and fails if the
  number rose. After W06 that number is 1, and this task must leave it at 1.

DO NOT
  Add a new runner, a new CLI command, or a new system-prompt composition path. awsf new with
  --workflow design-to-plan reaches the route through machinery that already exists.
  Change isReviewPhase. The architecture-review phase must NOT be deferred to the L11 spawn site.
  Add a task state or a legal edge. LEGAL_EDGES.length stays 25 and transitions.test.ts stays
  untouched.
  Reach outside the managed worktree to write the rendered plan. v1 of this chain runs where the
  plan repository IS the subject repository. Questionable Q5, which asks whether that should ever
  widen, is STILL OPEN - and it does not change this instruction either way, because reaching
  across a worktree boundary is forbidden regardless of how it lands.

DEFINITION OF DONE
  npm run test:unit && npm run typecheck && npm run lint, with transitions.test.ts green and
  unmodified and the composition-site count at 1.
  Full checklist: milestone M7 task 26 in the plan HTML.

MARKERS
  Flip THIS leaf plan's markers and specs/tickets/awsf-v2-w05-design-to-plan/T26.md in the same
  commit. NEVER touch specs/awsf-v2-plan.html's W05 marker.
```

### T27 — The owner amendment lands, then the route runs end to end

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     the two end-to-end passes are where every earlier claim either holds together or does
          not, and the blocking pass is the one that proves the stop is real.

TASK 27 of 28. Plan: specs/awsf-v2-w05-design-to-plan.html, milestone M7.
PREDECESSORS: T26 must be [x], AND the owner's awsf.config.yaml amendment must have landed.

THE OWNER ACT THIS TASK WAITS ON - ordering gate G2
  One owner-authored commit adds two agents: entries (designer, architecture-reviewer) and
  design-to-plan to workflows.enabled in awsf.config.yaml. The exact text is written out in the
  plan's "Amendment Required Before the Route Runs" section so the owner commits text rather than
  an intention.
  ITS SEQUENCE RUNS THE OPPOSITE WAY TO G2'S USUAL DIRECTION, AND THAT IS NOT A SLIP: loadConfig
  rejects any workflows.enabled entry not in KNOWN_WORKFLOW_IDS, so an amendment landing before
  task 24 would break EVERY awsf command, not just this route.
  No agent may write awsf.config.yaml - path-policy rejects protected-path independently of the
  write globs, and inventing an owner-authorized protected-change mechanism to route around it is
  the boundary working.

READ FIRST
  specs/awsf-v2-w05-design-to-plan.html - milestone M7 task 27 and the Amendment section
  core/src/adapters/stub.ts - the fixture adapter these passes run on
  core/src/cli/commands/production-run.ts - ProductionConfigSnapshotMismatch, and why the
    amendment invalidates any attempt already in flight

DO
  Confirm the amendment landed by OBSERVING THE COMMIT. Never by writing the file.
  npm run test:unit - the config loads with the amended file, proving the vocabulary landed in the
  right order.
  PASS ONE, on the stub fixture adapter with canned envelopes: request -> design -> review ->
  context -> plan -> render. Offline, no provider, no quota. The rendered output must pass
  ticket-plan-sync INCLUDING the new coverage assertions - the chain's product satisfies the
  chain's own gate.
  PASS TWO, whose canned review carries one high finding: NO plan context is composed, NO planning
  call is reserved, the attempt stops, and the findings are in the journal.

DO NOT
  Write awsf.config.yaml, AGENTS.md, or anything under core/src/state/ or core/src/policy/.
  Spend quota. Both passes run on the fixture adapter.
  Proceed if pass two produces a plan. If it does, the zero-blocker gate is not where task 13 put
  it, and that is a defect in the binding rather than in the test.

DEFINITION OF DONE
  Both passes behaved as written, and npm run test:unit && npm run typecheck && npm run lint.
  Full checklist: milestone M7 task 27 in the plan HTML.

MARKERS
  Flip THIS leaf plan's markers and specs/tickets/awsf-v2-w05-design-to-plan/T27.md in the same
  commit. NEVER touch specs/awsf-v2-plan.html's W05 marker - task 28 does that.
```

### T28 — Testing Strategy, full suite, and the workstream's close

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  WHY     one sweep of commands that have all been run before, plus the marker discipline that
          makes the close honest.

TASK 28 of 28. Plan: specs/awsf-v2-w05-design-to-plan.html, milestone M7.
PREDECESSORS: T27 must be [x] and every earlier task must be [x].

THIS IS THE ONLY TASK THAT TOUCHES THE SPINE.

READ FIRST
  specs/awsf-v2-w05-design-to-plan.html - milestone M7 task 28 and the Validation Commands section
  specs/awsf-v2-plan.html - milestone M5's block and its seven workstream checklist boxes
  AGENTS.md - invariants 2 and 11

DO
  npm run test:unit && npm run typecheck && npm run lint - all green, every meta-test included,
  doc-reconciliation.test.ts among them.
  Add one line to README.md naming the new workflow route. One line - a route is not a feature
  tour, and every backticked command in README.md is a claim doc-reconciliation checks.
  Confirm every milestone marker in specs/awsf-v2-w05-design-to-plan.html reads [x] and every
  ticket in specs/tickets/awsf-v2-w05-design-to-plan/ reads state: done, flipped in the same
  commit as their markers.
  ONLY NOW: flip milestone M5's marker in specs/awsf-v2-plan.html to [x], check its seven
  workstream boxes, and flip specs/tickets/awsf-v2-plan/W05.md to state: done - all in ONE commit.
  Record in this plan's Amendments what was built, what was refused, and the Q5 outcome from M1.

DO NOT
  Check a spine box the work does not support. If the Q5 hand-threading reopened the decision and
  the owner has not answered, that box stays [] and the workstream stays open.
  Name an agent, model, or AI tool as author, committer, co-author or collaborator in any commit -
  AGENTS.md invariant 11, mechanically enforced. Session metadata belongs in the plan's metadata
  block, never in the commit.
  Commit a runtime artifact, receipt or manifest - invariant 10.

DEFINITION OF DONE
  The full Validation Commands checklist in specs/awsf-v2-w05-design-to-plan.html is checked, the
  spine's M5 marker is [x], and the workstream is closed.
```
