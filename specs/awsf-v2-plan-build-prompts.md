# Build Prompts — AWSF v2, the spine

Companion to [`awsf-v2-plan.html`](./awsf-v2-plan.html). Created 2026-08-20 alongside the plan and
[`tickets/awsf-v2-plan/`](./tickets/awsf-v2-plan/).

**Every prompt in this file is a META-PROMPT.** It authors one workstream's deep plan and stops at
the owner-review gate. **None of them writes implementation code.** The deep plan a prompt produces
carries its own build prompts, and those are what write code later.

Each prompt is **self-contained** and written for a **fresh session with no prior context**. Copy
one, paste it, let it run to completion, review what it produced, clear context, move to the next.

---

## Why there is no Section A

v1's prompts file had a Section A (one prompt per milestone) and a Section B (one per task), because
a v1 milestone held up to five tasks. **In this spine each milestone holds exactly one workstream**,
so a milestone prompt and a workstream prompt would be the same prompt written twice. Section B is
the whole file.

---

## Before anything: two gates

1. **Owner approval of the spine.** The owner has read `specs/awsf-v2-plan.html` — especially its
   five Questionables — and approved the workstream list, the dependencies and the ceiling. No
   workstream's deep plan is authored before that approval is recorded, either as an exported
   `plan-sota-review v1` block or as a note in the plan's Amendments.
2. **Four of the five Questionables are already decided.** They were surfaced without recommended
   defaults on purpose; the owner then took Q1, Q2, Q4 and Q5 on 2026-08-21 via an exported
   `plan-sota-review v1` block. **A decided Questionable is a constraint, not an assignment.** The
   prompts below hand each one to its workstream as something to *apply*, with the reasoning that
   settled it, and no session re-litigates one. **Q3 is still open** and gates W14, which v2
   declares rather than builds; W14's prompt refuses to author its deep plan without an answer.

---

## Decisions already made — do not re-litigate these

A downstream session must not spend a context window re-deriving any of this. All of it is in the
spine's Solution and Shared Invariants sections; it is restated here so a prompt stands alone.

| # | Decision | Status |
|---|---|---|
| D1 | **The host advances lifecycle state, models supply structured facts, and a human authorises anything that lands.** v1's line, unchanged in v2. No workstream relocates it. | settled |
| D2 | **v2's ceiling is published source with evidence.** Build and publish are built; deploy and monitor are declared as W13 and W14 and not built. Environment configuration, release migrations, rollback orchestration, operational acceptance and any resident background process are out of scope. | settled |
| D3 | **A project may span several repositories; a task owns exactly one.** Cross-repo work is a parent coordination record plus declared contract artifacts between single-repo children. | settled |
| D4 | **The registry has two layers** — a committed catalog and a machine-local placement layer — and **the state root is in neither.** Forced by `core/src/config/load.ts` refusing absolute machine paths, and by `doctor`/`gc`/`db rebuild` each operating over one root. | settled |
| D5 | **marimba's boundary is enforced at the tool surface.** It keeps `--dangerously-skip-permissions`; the guard denies delegation-shaped tool names and the six owner-act command shapes. **The TTY check is a terminal-shape test, not an authorisation boundary, and no document may describe it as one.** | settled |
| D6 | **Invariant and protected-config changes are owner-authored commits that land before the build depending on them.** Each names the invariant, what it blocks with evidence, the replacement guarantee in still-checkable form, its cost, and the alternative that avoids the amendment entirely. **Do not invent a mechanism that lets an agent write `AGENTS.md` or `awsf.config.yaml`** — `path-policy` rejecting `protected-path` is the boundary working. | settled |
| D7 | **Quota is a readout, never a router.** No timer, no automatic resume, and no per-task cost derived from an account-wide percentage. | settled |
| D8 | **No workstream puts a skill in the execution path.** A gate never depends on a document having been read; `pi-codex` launches with `--no-skills` and cannot reach one. | settled |
| D9 | **Work that cannot land from a managed worktree is owner-side and stays out of every task graph** — shell functions, installed skills, machine-local settings, the `plan-sota` rename, upstream contributions, and the Darwin checklist. | settled |
| D10 | **The two frozen candidate records are not read.** `specs/awsf-v2-candidates.md` and `specs/awsf-v2-candidates-GPT-version.md` carry claims their own headers mark false. **`specs/awsf-v2-candidates-fuse-version.md` is the only detail source**, and its §10 supersedes six of its own earlier statements — read §10 before acting on §3 or §6. | settled |

---

## Model selection

`EFFORT` is the session-level reasoning control (`/effort low|medium|high|xhigh|max`), calibrated
to the hardest judgement in the workstream. **No prompt in this file fans out to sub-agents.**
Authoring one coherent plan document is tightly coupled work: the integration tax of splitting it
across workers exceeds anything parallelism would buy, and the orchestrator would end up rewriting
the seams anyway.

| Shape | Route |
|---|---|
| **Architecture with a live fork or a schema that others depend on** (W04, W05, W10) | Opus 5 · `xhigh`. These are the ones where a wrong shape is expensive to unpick later. |
| **Design work with settled evidence** (W01, W06, W07, W08, W09, W11, W13, W14) | Opus 5 · `high`. |
| **Mechanical work whose diagnosis is already complete** (W02, W03, W12) | Sonnet 5 · `medium`. Cheaper, and nothing here needs a judgement call the spine has not already made. |

---

## Conventions used by every prompt

**Marker discipline — read this once, it applies fourteen times.**

- You are authoring a deep plan. **Do NOT flip that workstream's marker in
  `specs/awsf-v2-plan.html`.** A spine marker moves to `[wip]` when the owner approves the deep
  plan, and to `[x]` only when that deep plan's own final phase completes. The deep plan's own
  build prompts do both.
- Every marker in the deep plan **you author** starts `[]`. You are authoring, not building.
- If you do flip a spine marker, you have broken AGENTS.md invariant 2, which is enforced by
  review rather than by a test — which is exactly why it is stated here.

**The precondition is authoring, not building.** The default plan-sota convention is "confirm the
prior unit is `[x]` first". That convention does not fit this spine, and following it literally
would serialize fourteen planning sessions behind fourteen builds. Here the precondition for
authoring workstream N's deep plan is that **every workstream N depends on has had its own deep plan
authored and approved** — spine marker at least `[wip]`. Each prompt below names its own
predecessors explicitly. There is one place where authoring order and build order deliberately
disagree, ordering gate **G1**, and both prompts that touch it say so.

**Read-first set, shared by every prompt** unless a prompt adds to it:

> `specs/awsf-v2-plan.html` — this workstream's block IN FULL, plus "Shared Invariants and
> Constraints" and the Questionable(s) assigned to this workstream ·
> `specs/awsf-v2-candidates-fuse-version.md` — this workstream's section, **and §10 first** ·
> `AGENTS.md` — all twelve invariants · `README.md` · the source files the workstream's block names.
> Do **not** read `specs/awsf-v2-candidates.md` or `specs/awsf-v2-candidates-GPT-version.md`.

**This repository has no `CLAUDE.md`, no `docs/TESTING.md` and no `docs/UI_REVIEW.md`.** Do not go
looking for them and do not create them. The testing conventions are readable from
`core/test/unit/meta/` and from v1's plan's Testing Pyramid and Validation sections; the dashboard
conventions are readable from `core/test/unit/dashboard-*.test.ts`.

**What every authored deep plan owes:** ordered implementation phases, each with a testing strategy
and validation commands that run offline · resolution of its assigned spine Questionables in its own
Questionables section · evidence plus the cheapest unused upgrade for every decision-bearing claim ·
for every mechanism it calls a boundary, what that mechanism does not cover · any amendment it needs,
written as an owner-authored commit that precedes its build · and its own
`specs/tickets/<stem>/` set, which the plan-aware sync fence pairs against it the moment it exists.

**Never do, in any of these sessions:** write implementation code · commit anything · flip a spine
marker · modify `specs/awsf-v2-intent.md`, either candidate record, or anything under `core/` ·
put a task id, attempt id, session id or machine path into any file you write · name an agent, model
or AI tool as author, committer or co-author anywhere.

**When you finish:** hand the deep plan to the owner and stop. Surface every open decision rather
than resolving it quietly. The owner-review gate is the end of your session.

---

# Section B — Task prompts (recommended)

Fourteen prompts, one per workstream, in the spine's order. **W09 and W10 are optional to v2's
completion** — nothing waits on either, and either may end unbuilt with its evidence gap recorded.
**W13 and W14 are declared and not built in v2**: their prompts exist so the declaration is
actionable when the time comes, and neither should be run before v2's core has landed.

Headings below are numbered `T<nn>` because the ticket/plan sync fence parses this section with a
`T`-anchored pattern. **The workstream identity is the `W<nn>` in the title**, and the ticket for
each is `specs/tickets/awsf-v2-plan/W<nn>.md`. The mapping is one-to-one and is recorded in that
directory's `README.md`.

---

### T01 — W01 · marimba's operating contract

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     this contract governs every later planning session in the spine, and its
          subject is a boundary that was described wrongly once already.

You are authoring a DEEP PLAN. You write no implementation code.

WORKSTREAM: W01 - marimba's operating contract. Spine milestone M1.
PREDECESSORS: none. This workstream can start immediately.

READ FIRST
  specs/awsf-v2-plan.html - the W01 block IN FULL, plus "Shared Invariants and Constraints"
  specs/awsf-v2-candidates-fuse-version.md - section 10 first, then 2.8 and 0.1
  AGENTS.md - all twelve invariants
  docs/driving/ - the whole tree the contract joins
  core/test/unit/meta/driving-routes.test.ts and execution-isolation.test.ts

DO
  Invoke /plan-sota with QUESTIONABLE true to author specs/awsf-v2-w01-marimba-contract.html,
  its own -build-prompts.md, and specs/tickets/awsf-v2-w01-marimba-contract/ with a README
  recording any derived-field rule. Break the workstream into ordered implementation phases,
  each with its own testing strategy and offline validation commands.

  The contract is command-free, lives inside docs/driving/, and is delivered as an APPENDED
  system prompt. The guard's tests and its captured refusals land with it. The guard's
  INSTALLATION is an owner act and is not a task.

THREE CLAIMS THE CONTRACT MUST NOT RESTATE
  "bounded by construction" - processOwnerTerminal() checks stdin.isTTY, which is a terminal
    SHAPE test. script -qec yields isTTY=true and a scripted answer clears the confirmation.
  "it inherits two existing fences" - driving-routes.test.ts hardcodes the current router, so a
    new contract's routes are unchecked. It does inherit the tree walk, the credential and shell
    sweeps, and fenced-command reconciliation.
  "no awsf command mutates outside the state root" - defaultWorktreeRoot returns a SIBLING
    directory, and land fast-forwards the canonical repository by design.
  Replace them with what is true: no push path exists, nothing is auto-deleted, writes are
  confined to a managed worktree by path-policy, and canonical movement happens only through a
  human-approved local fast-forward.

COLLISION TO WRITE DOWN RATHER THAN DISCOVER
  A pre-repository architecture review needs a fresh subagent that did not write the proposal,
  and the guard denies exactly that tool. It resolves by SCOPE, not by reversal: the guard is
  delivered per invocation, so a review session launched without marimba's settings keeps the
  tool. State it in the contract as an exception. W05's deep plan will depend on that statement.

NAMED ABSENCE
  It is proven that --settings LOADS the named file. It is NOT proven that it EXCLUDES project
  settings when both exist, and the repository root now has no .claude/ so nothing tests the
  interaction. Either run the probe and record it, or carry it as a named absence with its cost.

INVARIANTS THIS WORKSTREAM TOUCHES
  1 (no live task state in the contract or any fixture), 2 (markers are earned),
  10 (no runtime artifact carries the evidence - tests and captures do).

DO NOT
  Write implementation code. Commit. Flip W01's marker in specs/awsf-v2-plan.html. Read
  specs/awsf-v2-candidates.md or specs/awsf-v2-candidates-GPT-version.md. Describe any
  terminal-shape check as an authorisation boundary.

STOP WHEN
  The deep plan is authored, every open decision is surfaced, and the owner has it in hand.
```

### T02 — W02 · Evidence readability

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  WHY     the diagnosis is already complete and measured; this plan sequences known work
          rather than deciding anything architectural.

You are authoring a DEEP PLAN. You write no implementation code.

WORKSTREAM: W02 - Evidence readability. Spine milestone M2.
PREDECESSORS: none. Independent of everything else; it blocks nothing and improves the surface
every other workstream is watched through.

READ FIRST
  specs/awsf-v2-plan.html - the W02 block IN FULL, plus "Shared Invariants and Constraints"
  specs/awsf-v2-candidates-fuse-version.md - section 10 first, then 2.9 IN FULL
  dashboard/src/components/EventLog.vue and dashboard/src/display.ts
  core/src/contracts/normalized-events.ts, core/src/observability/projector.ts and queries.ts
  core/src/policy/redaction.ts, dashboard/shared/types.ts
  core/test/unit/dashboard-display.test.ts, dashboard-mechanics.test.ts, dashboard-parity.test.ts

DO
  Invoke /plan-sota with QUESTIONABLE true to author specs/awsf-v2-w02-evidence-readability.html,
  its own -build-prompts.md, and specs/tickets/awsf-v2-w02-evidence-readability/ with a README
  recording any derived-field rule. Ordered phases, each with a testing strategy and offline
  validation commands.

  Four pieces, in this order of leverage: per-kind summarisers replacing the five-key guess
  chain; delta compaction; a rendered view beside the raw JSON with rendered as the default; and
  the clipped run-card layout fix.

MEASURED FACTS TO BUILD ON, NOT RE-DERIVE
  85.3% of all projection rows are text.delta; 92.2% in the worst phase; 918 KB of payload bytes
  against 742 KB for everything else. The largest run reassembles to 5,490 characters across
  1,282 chunks - about four characters per row.
  The tool name already reaches the client through the name column. Nothing needs plumbing.
  display.ts exports thirteen formatters; EventLog.vue imports one.

THE CORRECTION THAT BOUNDS THE DESIGN
  Reassembly is SEMANTICALLY EQUAL and NOT BYTE-IDENTICAL: the store holds the reserialised
  envelope, the deltas hold what the model emitted, pretty-printed. So a compacted row may say it
  reconstructs the phase output; it may NOT claim to BE the stored envelope. And the deltas are
  the only surviving record of the model's own formatting, so storage compaction is NOT proposed
  here and would lose something the envelope does not carry.

THREE COLLISIONS, EACH WITH ITS ADAPTATION
  Redaction runs per event and reassembly crosses events, so a credential split across two chunks
  is reassembled by any concatenating renderer. This is a NEW exposure created by compaction.
  Adaptation: redaction runs again over the reassembled text, in the same code path that
  reassembles it, proven by a fixture that splits a credential-shaped value across a boundary
  deliberately. That fixture is the one cheapest upgrade still unrun.
  Invariant 9: thinking is never persisted. Define the fold on text.delta ALONE - a rule written
  over "delta kinds" is one edit from persisting a fold of reasoning content.
  Invariant 1: the source screenshots carry run and session ids. None is quoted into this
  repository or any fixture.

ONE STANDING CONSTRAINT
  Eighteen assertions pin formatCost across three files. Reuse must EXTEND the formatters rather
  than perturb them.

DO NOT
  Write implementation code. Commit. Flip W02's marker. Read either frozen candidate record.
  Propose storage-layer compaction.

STOP WHEN
  The deep plan is authored, every open decision is surfaced, and the owner has it in hand.
```

### T03 — W03 · awsf init

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  WHY     the smallest workstream in the spine, fully deterministic, and its design decision
          (host-only, no model) is already taken.

You are authoring a DEEP PLAN. You write no implementation code.

WORKSTREAM: W03 - awsf init. Spine milestone M3.
PREDECESSORS: none. Independent; it is W04's predecessor, not anyone's dependent.

READ FIRST
  specs/awsf-v2-plan.html - the W03 block IN FULL, plus "Shared Invariants and Constraints"
  specs/awsf-v2-candidates-fuse-version.md - section 10 first, then 2.3
  AGENTS.md - invariant 11 in particular
  core/src/config/load.ts and the existing CLI command surface under core/src/cli/commands/

DO
  Invoke /plan-sota with QUESTIONABLE true to author specs/awsf-v2-w03-awsf-init.html, its own
  -build-prompts.md, and specs/tickets/awsf-v2-w03-awsf-init/ with a README recording any
  derived-field rule. Ordered phases, each with a testing strategy and offline validation.

  The command is deterministic and host-owned with NO model: create the directory, git init,
  write a minimal config, and make a baseline commit under the owner's identity. That is all of
  it. Making it host-only is what removes the greenfield chicken-and-egg entirely, rather than
  solving it with a pre-repository execution mode.

THE ORDERING IT FIXES
  Two contradictory shapes existed in the source record - one put the plan inside the baseline
  commit, the other created the baseline first and produced the plan as a governed phase output.
  The inversion is right: baseline first, plan as output. It is the only one of the two in which
  the plan is produced by a phase that has somewhere to run.

CHEAPEST UNUSED UPGRADE
  One throwaway run of the intended sequence in a temporary directory, recorded as the deep
  plan's first fixture. It is the only thing that turns "no provider is needed" from a design
  claim into an observation.

INVARIANTS THIS WORKSTREAM TOUCHES
  11 (the baseline commit's author and committer are the owner's own identity - the
  no-agent-coauthor fence scans this repository's history, and the new command must not be what
  breaks the same rule elsewhere), 1, 10.

DO NOT
  Write implementation code. Commit. Flip W03's marker. Read either frozen candidate record.
  Invent a pre-repository execution mode. Let the command call a provider for any reason.

STOP WHEN
  The deep plan is authored, every open decision is surfaced, and the owner has it in hand.
```

### T04 — W04 · Project registry v1

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT xhigh
  CLAUDE  claude:opus · /effort xhigh
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     the hinge of the whole spine. Four workstreams wait on it, it owns two open
          Questionables, and it has to redefine a mechanically-enforced invariant.

You are authoring a DEEP PLAN. You write no implementation code.

WORKSTREAM: W04 - Project registry v1. Spine milestone M4.
PREDECESSORS: W03 (its deep plan authored and approved - spine marker at least [wip]).

READ FIRST
  specs/awsf-v2-plan.html - the W04 block IN FULL, "Shared Invariants and Constraints", and
    Questionables Q1 and Q2 IN FULL
  specs/awsf-v2-candidates-fuse-version.md - section 10 first (10.2 matters here), then 2.3 and
    the F-1/F-2 rows
  AGENTS.md - invariant 12 in particular
  core/src/config/load.ts, core/src/cli/commands/ticket.ts, core/src/persistence/ticket-store.ts
  core/test/unit/meta/ticket-plan-sync.test.ts
  The three Smart Health repositories - see BEFORE THE SCHEMA FREEZES below

DO
  Invoke /plan-sota with QUESTIONABLE true to author specs/awsf-v2-w04-project-registry.html, its
  own -build-prompts.md, and specs/tickets/awsf-v2-w04-project-registry/ with a README recording
  any derived-field rule. Ordered phases, each with a testing strategy and offline validation.

  TWO LAYERS, and the split is forced by code rather than chosen. A committed CATALOG: project
  identity, which repository holds the plan and which hold code, per-repository default branch
  and gate commands, delivery posture, and the relationships between them. A machine-local
  PLACEMENT layer: where each clone sits on this machine, and per-project worktree roots. THE
  STATE ROOT IS IN NEITHER - one per machine, projects namespaced inside it, because doctor, gc
  and db rebuild each operate over one root.

  config/load.ts refuses absolute machine paths outright, so a committed catalog physically
  cannot hold a clone location. That is the forcing, and it is not negotiable.

THE SCOPE CUT THAT MAKES IT PLANABLE
  Each task and each landing stays SINGLE-REPOSITORY. AttemptStatus carries one repository and
  one worktree; landing is atomic per repository; a partial cross-repo landing has no rollback
  story. Cross-repo work is a parent coordination record plus declared contract artifacts
  between single-repo children.

TWO SPINE QUESTIONABLES ARE DECIDED - APPLY THEM, DO NOT RE-LITIGATE THEM
  Both were taken by the owner on 2026-08-21. Record in your own Questionables section HOW you
  implement each, and what it costs you. Do not re-open the choice.

  Q1 - DECIDED: the cross-repo contract is an IMMUTABLE, CONTENT-ADDRESSED ARTIFACT COMMITTED IN
    EACH CHILD REPOSITORY. The parent coordination record names {child repository, contract
    digest}, and a meta-test asserts each child's copy hashes to what the parent names - the same
    shape as the ticket/plan sync fence, which is a byte-identity check between two copies of one
    prompt. WHY, so you can defend it: it keeps a child's gate reading its contract from INSIDE
    its own worktree. The parent-owned alternative would have made a gate reach across the
    boundary path-policy exists to hold, which is a new hole opened for a convenience. The
    generated-package alternative needs a publication step v2 does not have and reintroduces
    cross-repository build ordering, which decision D3 refused.
    YOU OWN THE MECHANISM: the digest fence is one of your tasks. The shape is settled.

  Q2 - DECIDED: the catalog stays NARROW AND VERSIONED - plan repository, target repositories,
    per-repository default branch and gate commands. Config loading is REFUSED, and the reason
    will still hold later: it creates a precedence question between a project's config, the
    machine's config, and the committed awsf.config.yaml, which is a PROTECTED PATH no agent can
    write. A precedence rule letting a project config override it is a route around path-policy
    that needs no amendment to take.
    ONE CONSEQUENCE TO CARRY, so it is not mistaken for a gap: the catalog RECORDS per-repository
    gate commands and does not RESOLVE them. Resolution stays with the existing gate machinery,
    which looks the record up.
    A FRAMING ERROR IN THAT QUESTIONABLE, recorded rather than hidden: its third option bundled
    per-project worktree roots (already IN, in the placement layer, by decision D4) with
    state-root reach (already OUT, by the same decision). Only the state-root half was ever open.
    Do not treat either half as undecided.

THE COLLISION YOU OWN
  Invariant 12 currently assumes a plan and its tickets share one checkout. A separate plan
  repository breaks that. You owe a NEW mechanically-checked source-of-truth relation - not a
  relaxation of the fence, and the redefinition must be proven to fail on an induced drift.
  The v1 ticket move belongs here and nowhere else: ticketStoreFor resolves specs/tickets and
  TicketStore reads that exact directory with NO recursion, so moving v1's flat tickets today
  would silently make awsf ticket list and awsf backlog return nothing.

BEFORE THE SCHEMA FREEZES
  Read the three Smart Health repositories and write down what a catalog would actually have to
  say about them. This is the workstream's cheapest unused upgrade, it costs about an hour, it
  needs no code, and it is the difference between a schema that fits a real project and one that
  fits an imagined one. It also directly informs Q1.

INVARIANTS THIS WORKSTREAM TOUCHES
  12 (redefined, not relaxed), 1 (no machine path in any committed file), 10.

DO NOT
  Write implementation code. Commit. Flip W04's marker. Read either frozen candidate record.
  Let a task own two repositories. Put the state root in either layer. Move v1's tickets in a
  session that has not yet given the store a plan to resolve against.

STOP WHEN
  The deep plan is authored, Q1 and Q2 are APPLIED with your implementation and its cost recorded
  in your Questionables section, every other open decision is surfaced, and the owner has it in
  hand.
```

### T05 — W05 · Design → architecture-review → plan

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT xhigh
  CLAUDE  claude:opus · /effort xhigh
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     the best leverage per unit cost in the whole candidate set, and the identifier spine
          it introduces is joined on by a gate - a wrong scope here is expensive to unpick.

You are authoring a DEEP PLAN. You write no implementation code.

WORKSTREAM: W05 - Design, architecture review, and plan as compiled recipes. Spine milestone M5.
PREDECESSORS: W04 (its deep plan authored and approved - spine marker at least [wip]).

ORDERING GATE G1 - READ THIS TWICE
  Your deep plan is AUTHORED BEFORE W06's, because W06 must know which roles it is centralising
  for. But your new agent role's PROMPT PATH must LAND AFTER W06's centralisation of prompt
  composition. Authoring order and build order deliberately disagree on this one edge. Write it
  into your plan as an explicit precondition on the phase that adds the architecture-reviewer
  role, so a builder cannot miss it.

READ FIRST
  specs/awsf-v2-plan.html - the W05 block IN FULL, the W06 block, "Shared Invariants and
    Constraints", and Questionable Q5 IN FULL
  specs/awsf-v2-candidates-fuse-version.md - section 10 first, then 2.3
  AGENTS.md - invariant 12 in particular
  core/test/unit/meta/ticket-plan-sync.test.ts - the fence your coverage gate extends
  The existing recipe surface under core/src/workflow/ and the envelope contracts under
    core/src/contracts/

DO
  Invoke /plan-sota with QUESTIONABLE true to author specs/awsf-v2-w05-design-to-plan.html, its
  own -build-prompts.md, and specs/tickets/awsf-v2-w05-design-to-plan/ with a README recording
  any derived-field rule. Ordered phases, each with a testing strategy and offline validation.

  requirements -> design -> architecture-review -> plan as COMPILED RECIPES with typed envelopes,
  a deterministic zero-blocker gate, and the INV-n / AC-n spine threaded design -> ticket ->
  gate as a coverage gate extending the existing ticket/plan-sync meta-test. Design-before-plan
  stays split. The architecture review's verdict is an ENVELOPE, not a transition.

WHY COMPILED IS NOT A STYLE CHOICE
  A recipe CANNOT invoke an installed skill: pi-codex launches with --no-skills, so a phase on
  that route cannot reach one. Anything shaped like "a plan recipe emitting an HTML plan" must
  become a compiled recipe with a typed envelope. This is the concrete form of the rule that no
  gate depends on a document having been read.

THE LIMIT TO STATE RATHER THAN HIDE
  A zero-blocker count proves ENVELOPE CONSISTENCY, not that the reviewer found everything. The
  gate is deterministic about the shape of the verdict and says nothing about the quality of the
  review. Put that where a reader of a green gate will see it.

ONE SPINE QUESTIONABLE IS DECIDED - APPLY IT, DO NOT RE-LITIGATE IT
  Q5 - DECIDED by the owner on 2026-08-21: AC/INV ids are UNIQUE PER PLAN, and a cross-plan
    reference is written <plan-stem>#INV-n.
    WHY, so you can defend it: the id is what the coverage gate joins on, and the gate you are
    extending - ticket-plan-sync - is already per plan set. Same scope as the machinery
    underneath means one scope to reason about instead of two. Both wider options need an
    allocator handing out the next free id across several plans and repositories, which is shared
    mutable state; this repository has refused that consistently, and TicketStore's own comment
    says there is intentionally no database, cache, or index.
    THE APPARENT COST DISAPPEARS once references are qualified: <plan-stem>#INV-n is unambiguous,
    needs no allocator, and is the same shape as the file-path references used everywhere here.
    Record in your own Questionables section HOW you implement it, not whether to.

CHEAPEST UNUSED UPGRADE, AND IT IS NOW THE FALSIFIER FOR Q5
  Thread one INV and one AC through an existing v1 plan by hand - design line, ticket line, gate
  assertion - and see whether the coverage gate would have caught a deliberately dropped one, and
  which scope the join actually needs. About an hour.

COLLISION ALREADY RESOLVED FOR YOU
  The architecture review needs a fresh subagent; marimba's guard denies delegation-shaped tools;
  the guard is per-invocation so a review session launched without marimba's settings keeps the
  tool. W01's contract states this as an exception. DEPEND on that statement rather than
  rediscovering it.

OUT OF SCOPE, PERMANENTLY
  The planf3 -> plan-sota rename. The skill and its memory files live outside every managed
  worktree; it is owner-side migration work, it was executed on 2026-08-20, and it must not
  re-enter any task graph.

INVARIANTS THIS WORKSTREAM TOUCHES
  12 (extended by the coverage gate), 1, 10.

DO NOT
  Write implementation code. Commit. Flip W05's marker. Read either frozen candidate record.
  Put a skill anywhere in an execution path. Let the zero-blocker gate be read as a clean design.

STOP WHEN
  The deep plan is authored, Q5 is APPLIED and its hand-threading check is scheduled as a task,
  G1 is written into the phase it constrains, every other open decision is surfaced, and the owner
  has it in hand.
```

### T06 — W06 · Prompt composition

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     the internal order is the whole point and is easy to get backwards, and the
          benchmark has to be designed before it runs or it measures nothing.

You are authoring a DEEP PLAN. You write no implementation code.

WORKSTREAM: W06 - Prompt composition and the shared per-role block. Spine milestone M6.
PREDECESSORS: W05 (its deep plan authored and approved - spine marker at least [wip]), because
you must know which roles you are centralising for.

ORDERING GATE G1 - READ THIS TWICE
  Your centralisation LANDS BEFORE W05's new agent-role prompt path does, even though W05's deep
  plan was authored before yours. Authoring order and build order deliberately disagree on this
  one edge. Say so in your plan, and name the W05 phase that waits on you.

READ FIRST
  specs/awsf-v2-plan.html - the W06 block IN FULL, the W05 block, and "Shared Invariants and
    Constraints"
  specs/awsf-v2-candidates-fuse-version.md - section 10 first, then 2.5
  core/src/cli/commands/production-run.ts, review-phase.ts and rework.ts - the three independent
    composition sites
  Whatever materialises the system prompt privately - writeSystemPromptFile at mode 0600 and
    assertPrivateSystemPrompt at launch

DO
  Invoke /plan-sota with QUESTIONABLE true to author specs/awsf-v2-w06-prompt-composition.html,
  its own -build-prompts.md, and specs/tickets/awsf-v2-w06-prompt-composition/ with a README
  recording any derived-field rule. Ordered phases, each with a testing strategy and offline
  validation.

  THE ORDER IS THE DESIGN: centralise composition FIRST, add the shared per-role block SECOND,
  measure it THIRD. "One natural insertion point" described a desirable design, not the code -
  there are three independent composition sites today. Written the other way round, this
  workstream creates a fourth copy of the thing it exists to remove.

WHAT THE MECHANISM ALREADY GIVES FREE
  Both routes APPEND rather than replace, and the host materialises the prompt privately. No
  adapter change is needed to deliver a shared block.

TWO CALLS DO NOT MEASURE ANYTHING
  One sample per arm cannot separate a prompt effect from model variance. The benchmark is
  REPEATED MATCHED TASKS with its metrics declared IN ADVANCE: input tokens, output tokens,
  PARSE-CORRECTION COUNT, and reviewer evidence specificity. Parse corrections are the metric
  neither source record had and the one that catches this work's own failure mode - a style
  block that makes prose terser can make envelopes fail validation more often, and the
  correction allowance quietly pays for it. Record the benchmark OUTSIDE the offline suites: it
  spends quota and must not sit in a suite that claims to be free.

OVERLOOKED BY BOTH SOURCE RECORDS
  Shared prompt bytes must enter the SAME immutable route evidence as the role prompts.
  Otherwise rework and a replacement review can read different instructions under one config
  snapshot, and the snapshot stops being a record of what ran.

THE ROLE THAT MUST NOT BE COMPRESSED
  The reviewer. A tersely agreeable reviewer is the rubber-stamped closure that cross-provider
  review exists to prevent, and terseness is the most obvious thing a shared style block would do
  to it. Reviewer-evidence regression fixtures are a gate, not a nicety.

INVARIANTS THIS WORKSTREAM TOUCHES
  1, 10. Aliases stay interactive-only and reach no headless role.

DO NOT
  Write implementation code. Commit. Flip W06's marker. Read either frozen candidate record.
  Write the shared block before the three sites are one site. Claim a benchmark result from
  fewer than repeated matched runs.

STOP WHEN
  The deep plan is authored, G1 is written into it from your side, every open decision is
  surfaced, and the owner has it in hand.
```

### T07 — W07 · Quota telemetry

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT high
  CLAUDE  claude:sonnet · /effort high
  GPT     codex:gpt-5.6-terra · reasoning high
  WHY     small in surface, but its rules are each the residue of a specific failure and its
          headline claim was falsified - precision matters more than breadth here.

You are authoring a DEEP PLAN. You write no implementation code.

WORKSTREAM: W07 - Quota telemetry as a readout. Spine milestone M7.
PREDECESSORS: W04 (its deep plan authored and approved - spine marker at least [wip]), because
this needs the registry's per-project shape.

READ FIRST
  specs/awsf-v2-plan.html - the W07 block IN FULL, "Shared Invariants and Constraints", and
    Questionable Q4 IN FULL
  specs/awsf-v2-candidates-fuse-version.md - section 10 first, then 2.7 IN FULL and 0.2
  The existing normalized event contracts, which already carry provider-authoritative per-call
    usage - the number that DOES have task identity attached

DO
  Invoke /plan-sota with QUESTIONABLE true to author specs/awsf-v2-w07-quota-telemetry.html, its
  own -build-prompts.md, and specs/tickets/awsf-v2-w07-quota-telemetry/ with a README recording
  any derived-field rule. Ordered phases, each with a testing strategy and offline validation.

  Three pieces: the preflight readout the owner reads before starting, the phase-boundary
  snapshot, and the import fence.

THE RUNTIME CONTRACT, SETTLED AND UNCHANGED BY REVIEW
  Render from quotaSemantics.effectiveAvailability and NEVER from windows[].
  Detect state STRUCTURALLY from state.status, never by exit code.
  Never use the refresh or TUI flags.
  Spawn on PATH rather than import.
  Fixture-first parsing.
  Import fence barring core/src/workflow/** and the routing resolver from reaching the module.

THE CLAIM THIS WORKSTREAM LOSES
  The phase-boundary snapshot was called "the leverage" - a real denominator for the call
  ledger's proxy unit. An account-window percentage CANNOT do that: another client on the same
  account moves the same number, the figure is an integer percentage, and nothing in the payload
  carries task identity. What survives is journalling the snapshot as EXPLICITLY
  NON-ATTRIBUTABLE context, labelled as such in the record, and NEVER computing a task cost from
  two readings. If a real per-task denominator is wanted, it comes from the existing per-call
  usage events.

TWO SMALLER CORRECTIONS THE SOURCE LEFT OPEN
  The source pins one version while also recommending an unpinned fetch that may resolve to a
  different one. Name a VERSION FLOOR and check it.
  A phase-boundary probe needs a stated FAILURE POSTURE: hard timeout, fail-open, and what is
  journalled when the read fails. Neither is written down anywhere yet.

ONE SPINE QUESTIONABLE IS DECIDED - APPLY IT, DO NOT RE-LITIGATE IT
  Q4 - DECIDED by the owner on 2026-08-21: the unit is ABSOLUTE TIME REMAINING, minutes to window
    reset, with the threshold CONFIGURED PER ROUTE rather than hard-coded.
    WHY NOT THE PERCENTAGE: it is an integer percentage of an account-wide window another client
    moves. That is the same defect the adjudication used to strip this candidate's attribution
    claim; using the number as a THRESHOLD inherits it at coarse resolution.
    WHY NOT ESTIMATED CALLS: it is the right eventual unit and it is not buildable yet. It divides
    a ceiling, which is an authorisation rather than a prediction, by a per-call consumption
    nobody has recorded. Its wrong direction stops work that could have run. It becomes buildable
    once provider-authoritative per-call usage has history.
    WHY TIME: the owner reasons in it, the reset clock does not move when another client consumes
    the account, and the reset time is a reported field rather than a derived one.
    SHIP THE UPGRADE NAMED ALONGSIDE THE THRESHOLD, not implied: compare the remaining window
    against the next phase's OBSERVED MEDIAN DURATION, which the projection already records. That
    turns a magic number into a comparison against measured history, and it is a versioned change
    rather than a drift. The catch it answers is real - time to reset says when the window resets,
    not how much work fits before then - so state it rather than bury it.
    Record in your own Questionables section HOW you implement it, not whether to.

CHEAPEST UNUSED UPGRADE
  Scrub one real capture into a fixture IN THE TREE. Today the fixture-first rule is satisfied
  only by captures held outside the repository, which is exactly the residual the rule exists to
  prevent. Rate-limited-response bytes cannot be summoned safely; retain the next natural
  occurrence and record that as a named absence.

INVARIANTS THIS WORKSTREAM TOUCHES
  1, 9 (scrubbed captures only), 10.

DO NOT
  Write implementation code. Commit. Flip W07's marker. Read either frozen candidate record.
  Let quota influence routing in any form. Add a timer or an automatic resume. Derive a per-task
  cost from two window readings.

STOP WHEN
  The deep plan is authored, Q4 is APPLIED with its upgrade named rather than implied, every open
  decision is surfaced, and the owner has it in hand.
```

### T08 — W08 · Publish

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     it carries v2's ceiling and the only invariant amendment v2's core requires; the
          truth table has to be total before any code depends on it being so.

You are authoring a DEEP PLAN. You write no implementation code.

WORKSTREAM: W08 - Publish. Spine milestone M8.
PREDECESSORS: W04 (its deep plan authored and approved - spine marker at least [wip]), because
the remote allowlist lives in the catalog.

ORDERING GATE G2
  The invariant 8 amendment lands as an OWNER-AUTHORED COMMIT before this workstream's build
  starts. You DRAFT the amendment inside your deep plan; you do not land it, and no agent can -
  path-policy rejects protected-path independently of the write globs. Do not invent a mechanism
  that routes around that; it is the boundary working.

READ FIRST
  specs/awsf-v2-plan.html - the W08 block IN FULL, "Shared Invariants and Constraints", and the
    W13 block (so you can see the line you must not cross)
  specs/awsf-v2-candidates-fuse-version.md - section 10 first, then 2.4 and the F-4/F-5 rows
  AGENTS.md - invariant 8 verbatim, and invariant 9
  core/test/unit/meta/no-destructive-paths.test.ts and no-land-route.test.ts

DO
  Invoke /plan-sota with QUESTIONABLE true to author specs/awsf-v2-w08-publish.html, its own
  -build-prompts.md, and specs/tickets/awsf-v2-w08-publish/ with a README recording any
  derived-field rule. Ordered phases, each with a testing strategy and offline validation.

  authorizePublish(status, repository, remote, refspec) as a PURE FUNCTION with an explicit truth
  table, a SINGLE fenced push argv site, and the whole thing tested against a LOCAL BARE REMOTE
  WITH NO NETWORK. Post-landed, human-initiated, exact-revision publication only.

THE AMENDMENT, AND WHAT IT COSTS - STATE THIS BEFORE ASKING FOR IT
  Invariant 8 today: "no push, force, or auto-delete path exists anywhere in core/src", enforced
  by a source scan. The amendment restates it as "no push path from any pre-LANDED state" and
  replaces the scan with a state-aware check. That trades a mechanically-checked ABSENCE for a
  mechanically-checked CONDITION - strictly weaker.
  THE ALTERNATIVE THAT AVOIDS THE AMENDMENT ENTIRELY: keep landing as the end of the line and let
  the owner push by hand, which costs the evidence trail this workstream exists to produce.
  Write both, with the cost, per decision D6's required shape.

STATE IS ONE DIMENSION AND ONLY ONE
  A state-aware meta-test is NECESSARY AND NOT SUFFICIENT. The command also needs: an allowlisted
  remote and branch; canonical HEAD equal to the landed candidate; a clean checkout; a non-force
  non-delete refspec; credential non-persistence under invariant 9; idempotent retry on the same
  SHA; and a scrubbed record of what the remote accepted. None of that is in the source
  candidate, and a plan that ships only the state check has shipped the smallest part.

WHAT PUBLISH IS NOT
  Publication is SOURCE PUBLICATION. The framing that reads it as the last mile to production is
  wrong and must not appear anywhere in your plan. Deploy is W13 and it is declared, not built.

CHEAPEST UNUSED UPGRADE
  Write the truth table BEFORE writing the function and check each row against a local bare
  remote by hand. About an hour, no network, and it is the only way to find out whether the table
  is total before the code depends on it.

INVARIANTS THIS WORKSTREAM TOUCHES
  8 (amended - by the owner, before the build), 9 (credential non-persistence), 1, 10.

DO NOT
  Write implementation code. Commit. Flip W08's marker. Read either frozen candidate record.
  Land the amendment yourself. Let any test touch the network. Absorb any deployment scope.

STOP WHEN
  The deep plan is authored, the amendment is drafted in D6's shape with its alternative, every
  open decision is surfaced, and the owner has it in hand.
```

### T09 — W09 · agy adapter

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     the deliverable is partly a discipline of description, and this is the workstream
          where the camera-called-a-wall habit did the most damage.

You are authoring a DEEP PLAN. You write no implementation code.
This workstream is OPTIONAL to v2's completion. Nothing waits on it, and it may honourably end
unbuilt with its evidence gap recorded.

WORKSTREAM: W09 - the agy adapter, parser first. Spine milestone M9.
PREDECESSORS: W06 (its deep plan authored and approved - spine marker at least [wip]), because
the documenter role's prompt path goes through centralised composition.

READ FIRST
  specs/awsf-v2-plan.html - the W09 block IN FULL, plus "Shared Invariants and Constraints"
  specs/awsf-v2-candidates-fuse-version.md - section 10 first, then 2.1 and the DR3 row
  core/src/policy/path-policy.ts and core/src/policy/sandbox-broker.ts
  The existing adapter surface and its fixture conventions

DO
  Invoke /plan-sota with QUESTIONABLE true to author specs/awsf-v2-w09-agy-adapter.html, its own
  -build-prompts.md, and specs/tickets/awsf-v2-w09-agy-adapter/ with a README recording any
  derived-field rule. Ordered phases, each with a testing strategy and offline validation.

  SPLIT THE GRADUATION IN TWO. Parser graduation is fixture-first work that proceeds NOW with the
  route left DISABLED. Permission graduation waits for captured bytes proving either a provider
  tool-scoping flag or an OS boundary. If neither ever arrives, the ladder still runs on the two
  verified routes. When it does graduate, it graduates for the DOCUMENTER ROLE ONLY.

THE WORD THAT MUST NOT APPEAR
  "Bounded". The route is DETECTION-BOUNDED. path-policy compares a worktree fingerprint AFTER
  the provider returns, and sandbox-broker degrades to tool-policy where bwrap is absent - the
  case on the development machine. Detection covers one tool's target parameter and says nothing
  about shell execution, messaging, scheduling or web search, three of which are
  external-mutation shaped and already named in policy.protected_operations. THE ROUTE IS REFUSED
  FOR ANY ROLE WHERE PREVENTION IS REQUIRED. Accepting a detection-only route is the owner's
  decision and was recorded; describing it as prevention is not the owner's to accept.

WHAT IS SETTLED - BUILD ON IT, DO NOT RE-DERIVE IT
  The stream emits a four-event NDJSON protocol with stream-authoritative model identity.
  Plan mode steers rather than enforces; a write executed under it.
  No tool allow/deny flag and no system-prompt flag are exposed.
  A Windows-accessible working directory is required.
  The adapter is disabled today and returns an unverified-adapter error.
  A separate portability run found the executable does not resolve under its configured name on
  this machine at all. Start from that fact rather than around it.

THE OPEN ITEM NEITHER SOURCE RECORD CLOSED - THIS IS THE CHEAPEST UNUSED UPGRADE
  Does a tool event arrive BEFORE or AFTER the provider has executed that tool? Detection cannot
  claim timely abort without event-order evidence, and no fixture establishes it. One capture
  with a write and a shell call settles it.

TWO FURTHER NAMED ABSENCES
  No containment capture across the WSL/Windows boundary is retained - one adversarial throwaway
  run would close it. And the raw byte streams earlier sessions saw exist at no citable path and
  in no fixture in the tree.

INVARIANTS THIS WORKSTREAM TOUCHES
  9 (fixtures are scrubbed), 1, 10.

DO NOT
  Write implementation code. Commit. Flip W09's marker. Read either frozen candidate record.
  Use the word "bounded" for this route. Enable the route - that is a separate owner act.
  Claim timely abort without event-order evidence.

STOP WHEN
  The deep plan is authored, every open decision is surfaced, and the owner has it in hand.
```

### T10 — W10 · mf adapter

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT xhigh
  CLAUDE  claude:opus · /effort xhigh
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     one side of its fork is a real supervision redesign through the broker, and the
          source record got the reason for the gap wrong in a way that suggests the wrong fix.

You are authoring a DEEP PLAN. You write no implementation code.
This workstream is OPTIONAL to v2's completion. Nothing waits on it, and it may honourably end
at the opaque option or unbuilt, with its evidence gap recorded.

WORKSTREAM: W10 - the mf adapter and native fusion. Spine milestone M10.
PREDECESSORS: W04 (its deep plan authored and approved - spine marker at least [wip]). This is
the first real customer of W04's multi-repo capability.

READ FIRST
  specs/awsf-v2-plan.html - the W10 block IN FULL, plus "Shared Invariants and Constraints"
  specs/awsf-v2-candidates-fuse-version.md - section 10 first, then 2.2 and the DR4 row
  core/src/execution/transport-broker.ts
  The call-budget reservation ledger, including settle() and its comment

DO
  Invoke /plan-sota with QUESTIONABLE true to author specs/awsf-v2-w10-mf-adapter.html, its own
  -build-prompts.md, and specs/tickets/awsf-v2-w10-mf-adapter/ with a README recording any
  derived-field rule. Ordered phases, each with a testing strategy and offline validation.

THE DECISIVE FINDING
  Only the OUTER process crosses transport-broker. No constituent provider launch gets a
  registration, a reservation id, or its own GO. Everything the source record promised about
  per-role supervision rests on processes AWSF never sees.

THE OVERSTATEMENT, CORRECTED - THIS ONE MATTERS
  Partial settlement is NOT blocked by the ledger. settle(id, spent) exists and its own comment
  describes exactly the halfway composite. The all-or-nothing spend is a convenience over settle,
  not the only route. THE GAP IS SUPERVISION AND ATTRIBUTION, NOT ARITHMETIC. Stating it the
  other way suggests a ledger redesign that is not needed, and you would spend the workstream on
  the wrong thing.

THE FORK, STATED AS A FORK
  (a) NATIVE - AWSF orchestrates the two workers and the fuser through its own broker, so every
      child has a registration, a worktree, a permission session and a retained envelope, and the
      external tool stops being the executable. The intent PREFERS this.
  (b) OPAQUE - the tool stays and the promise shrinks to one composite that spends its declared
      cost at the outer GO, with no per-child supervision and no per-role worktree claim.
  The per-role worktree recommendation belongs to (a) only, and it is unvalidated in either.
  Choose explicitly, and if you choose (b) write out the shrunken promise rather than implying it.

WHAT IS ALREADY IMPLEMENTED - DO NOT REBUILD IT
  Reserve-the-full-cost-before-any-launch, with the composite cost equal to workers plus one.
  PATH resolution with a blocked result when the executable is absent.

CHEAPEST UNUSED UPGRADE
  A fake-broker test standing in for the external tool, proving three registrations exist before
  the first GO. No quota, and it settles whether (a) is buildable. A LIVE CAPTURE COMES AFTER THE
  FORK IS CHOSEN, NEVER BEFORE - the fit already fails at the broker, so a capture taken first
  buys nothing.

INVARIANTS THIS WORKSTREAM TOUCHES
  3 (node:child_process stays confined to transport-broker - a native option must not create a
  second spawn site), 1, 9, 10.

DO NOT
  Write implementation code. Commit. Flip W10's marker. Read either frozen candidate record.
  Describe the gap as ledger arithmetic. Claim per-role supervision the broker never saw. Take a
  live capture before the fork is chosen.

STOP WHEN
  The deep plan is authored, the fork is chosen with its cost, every open decision is surfaced,
  and the owner has it in hand.
```

### T11 — W11 · The five-stage ladder

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     it consumes four workstreams and must add no mechanism of its own; knowing which
          is which is the judgement it turns on.

You are authoring a DEEP PLAN. You write no implementation code.

WORKSTREAM: W11 - the five-stage ladder. Spine milestone M11.
PREDECESSORS: W03, W04, W05 and W06 (each with its deep plan authored and approved - spine
marker at least [wip]).

READ FIRST
  specs/awsf-v2-plan.html - the W11 block IN FULL, the W03/W04/W05/W06 blocks, and "Shared
    Invariants and Constraints"
  specs/awsf-v2-candidates-fuse-version.md - section 10 first, then 2.3 and the sequencing in 6
  v1's zero-quota stub journeys, as the shape the end-to-end test should take

DO
  Invoke /plan-sota with QUESTIONABLE true to author specs/awsf-v2-w11-five-stage-ladder.html,
  its own -build-prompts.md, and specs/tickets/awsf-v2-w11-five-stage-ladder/ with a README
  recording any derived-field rule. Ordered phases, each with a testing strategy and offline
  validation.

THE CAPTURE PASS IS THE FIRST TASK, NOT A PRELIMINARY
  The stage envelopes have been produced exactly ONCE, by hand, as prose. There is no fixture, no
  schema, and no evidence of what a stage output actually looks like. Building the workflow first
  means designing envelopes around remembered prose. Capture first, land the envelopes in the
  tree as fixtures, then write the governed workflow against them.
  That capture pass is also this workstream's cheapest unused upgrade. It is already first.

IT ADDS NO NEW MECHANISM
  It consumes W03's host-owned bootstrap, W04's registry, W05's compiled recipes and typed
  envelopes, and W06's centralised composition. If your plan finds it needs a new mechanism, that
  is a signal the mechanism belongs to the workstream that owns it - say so and route it there
  rather than building it here.

STANDING CONSTRAINT, AND THIS IS THE WORKSTREAM MOST LIKELY TO BREAK IT
  No skill in the execution path, at any stage. A gate never depends on a document having been
  read. A five-stage ladder reads naturally as a document someone follows; it must not be one.

INVARIANTS THIS WORKSTREAM TOUCHES
  1, 10, and the phase/gate contracts v1 already fixed.

DO NOT
  Write implementation code. Commit. Flip W11's marker. Read either frozen candidate record.
  Write the workflow before the envelopes are captured. Put a skill in any stage. Spend quota on
  the end-to-end test - it runs on the stub route.

STOP WHEN
  The deep plan is authored, every open decision is surfaced, and the owner has it in hand.
```

### T12 — W12 · The cheatsheet

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  WHY     writing, plus one mechanical reconciliation. The hard decision - what "done" means -
          is already taken.

You are authoring a DEEP PLAN. You write no implementation code.

WORKSTREAM: W12 - the non-technical cheatsheet. Spine milestone M12.
PREDECESSORS: W03, W07, W08 and W11 - every workstream that adds or changes a command the reader
will type. The cheatsheet cannot be FINISHED while any of those is still moving, so its later
phases wait on those workstreams being [x], not merely authored.

READ FIRST
  specs/awsf-v2-plan.html - the W12 block IN FULL, the "In Plain Language" section as the
    register to write in, and "Shared Invariants and Constraints"
  specs/awsf-v2-candidates-fuse-version.md - section 10 first, then 2.6 and the DR7 row
  README.md and docs/driving/ - what already exists for a reader
  core/test/unit/meta/doc-reconciliation.test.ts - the mechanism that will check your commands

DO
  Invoke /plan-sota with QUESTIONABLE true to author specs/awsf-v2-w12-cheatsheet.html, its own
  -build-prompts.md, and specs/tickets/awsf-v2-w12-cheatsheet/ with a README recording any
  derived-field rule. Ordered phases, each with a testing strategy and offline validation.

ACCEPTANCE IS A WALKTHROUGH, NOT COVERAGE
  On a clean machine, the intended reader installs, primes, creates one throwaway task, observes
  it, reads a blocked attempt, and stops at an owner act with the right evidence in hand. That is
  testable.
  "Every command and flow" is NOT. Taken literally it duplicates the routed command tree and
  violates the one-owner rule - two documents claiming the same truth, drifting apart at the
  first change. Write acceptance as the walkthrough and say why.

THE MECHANICAL HALF
  Every command the document names must exist in the CLI table, checked by a test, the way
  doc-reconciliation already checks the README and v1's Validation section. A cheatsheet that
  names a command the factory does not have should fail a test, not a review.

CHEAPEST UNUSED UPGRADE
  Ask the intended reader to attempt the walkthrough against the factory AS IT STANDS TODAY,
  before v2 changes anything. Whatever stops them is the list this document has to answer,
  gathered for free and before the writing starts.

WHY IT IS LAST
  Two "this goes last" claims existed in the source record and both could not hold. The
  resolution: the ladder is last among executable capabilities; the cheatsheet is the final
  artifact after it. A guide to a moving surface is a guide that is wrong.

INVARIANTS THIS WORKSTREAM TOUCHES
  1 (no live task state in any example - use placeholders that cannot be mistaken for real ids),
  10.

DO NOT
  Write implementation code. Commit. Flip W12's marker. Read either frozen candidate record.
  Define acceptance as coverage. Duplicate the routed command tree.

STOP WHEN
  The deep plan is authored, every open decision is surfaced, and the owner has it in hand.
```

### T13 — W13 · Deploy

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     external mutation, and a boundary that has to be named for what it actually prevents.

DO NOT RUN THIS PROMPT YET.
W13 is DECLARED, NOT BUILT IN v2. Its deep plan is authored only after v2's core has landed -
W01 through W08, W11 and W12 all [x] in specs/awsf-v2-plan.html - AND after the owner has taken
the decision this workstream is waiting on. Running it early is exactly the accidental widening
the declaration exists to prevent.

You are authoring a DEEP PLAN. You write no implementation code.

WORKSTREAM: W13 - Deploy. Spine milestone M13.
PREDECESSORS: v2's core, complete. Plus an owner decision that does not exist yet.

READ FIRST
  specs/awsf-v2-plan.html - the W13 block IN FULL, the W08 block (the line you must not have
    crossed), and "Shared Invariants and Constraints"
  specs/awsf-v2-candidates-fuse-version.md - section 10 first, then the F-4 and F-5 rows
  AGENTS.md - all twelve invariants as they stand at that time, which may not be as they stand
    today
  specs/awsf-v2-w08-publish.html - what publish actually shipped

DO
  Invoke /plan-sota with QUESTIONABLE true to author specs/awsf-v2-w13-deploy.html, its own
  -build-prompts.md, and specs/tickets/awsf-v2-w13-deploy/ with a README recording any
  derived-field rule.

  BEFORE ANY OF THAT: confirm that no workstream absorbed deployment scope while W13 sat
  declared. If one did, that is the finding, and it is worth more than the plan.

WHAT IT NEEDS THAT IT DOES NOT HAVE
  An owner decision on what deployment means for the owner's projects.
  An amendment in decision D6's shape - the invariant, what it blocks with evidence, the
  replacement guarantee in still-checkable form, its cost, and the alternative that avoids it.
  A target that is not hypothetical.
  If any of the three is still missing, say so and stop. A plan written around an absent decision
  is the thing this declaration exists to prevent.

THE LINE IT MUST NOT CROSS
  Environment configuration, release migrations, rollback orchestration and operational
  acceptance were all explicitly out of scope for v2. Whether they are in scope now is an owner
  decision, not an inference from this workstream existing.

INVARIANTS THIS WORKSTREAM TOUCHES
  Whatever the amendment names, plus 1 and 10. And the standing rule: a human authorises anything
  that lands, and external mutation gets a boundary named for what it actually prevents.

DO NOT
  Write implementation code. Commit. Flip W13's marker. Read either frozen candidate record.
  Start before v2's core is [x]. Infer the missing decision from the fact that this prompt exists.

STOP WHEN
  The deep plan is authored, every open decision is surfaced, and the owner has it in hand - or
  you have reported that a precondition is missing and stopped without authoring.
```

### T14 — W14 · Monitor

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     the only known design is the one this project has twice refused, so the work is
          finding a different one or saying plainly that there isn't one.

DO NOT RUN THIS PROMPT YET.
W14 is DECLARED, NOT BUILT IN v2. Its deep plan is authored only after v2's core has landed -
W01 through W08, W11 and W12 all [x] in specs/awsf-v2-plan.html - AND after Questionable Q3 has
an answer.

You are authoring a DEEP PLAN. You write no implementation code.

WORKSTREAM: W14 - Monitor. Spine milestone M14.
PREDECESSORS: v2's core, complete. Plus an answer to Q3.

READ FIRST
  specs/awsf-v2-plan.html - the W14 block IN FULL, Questionable Q3 IN FULL, and "Shared
    Invariants and Constraints"
  specs/awsf-v2-candidates-fuse-version.md - section 10 first
  specs/awsf-v2-w07-quota-telemetry.html - its phase-boundary stop solves "when do we look,
    without a timer" for quota, and this workstream may be able to borrow the shape
  The journal and projection query surface - what can already be answered on demand

DO
  Invoke /plan-sota with QUESTIONABLE true to author specs/awsf-v2-w14-monitor.html, its own
  -build-prompts.md, and specs/tickets/awsf-v2-w14-monitor/ with a README recording any
  derived-field rule.

  BEFORE ANY OF THAT: confirm no resident background process entered v2 under another
  workstream's name while W14 sat declared. If one did, that is the finding.

THE QUESTION THIS WORKSTREAM IS WAITING ON
  Q3 - can monitoring be built without a resident process at all, and what is it if it cannot?
  Every version proposed so far has been the resident-daemon shape this project has REFUSED
  TWICE. A resident background process was explicitly out of scope for v2.
  Three shapes, from the spine: on-demand only (queries against the journal and projection);
  host-triggered sampling at owner-initiated checkpoints; or a written declaration that it cannot
  be done without residency. THE THIRD IS A LEGITIMATE OUTCOME and would be the third refusal,
  this time written down with its reasoning rather than re-litigated later.

ONE PROPERTY IS FIXED REGARDLESS OF THE DESIGN
  If it resides, it is out of scope. That is a test your deep plan can be held to from its first
  line.

INVARIANTS THIS WORKSTREAM TOUCHES
  1 and 10, plus whatever an amendment names if the chosen design needs one.

DO NOT
  Write implementation code. Commit. Flip W14's marker. Read either frozen candidate record.
  Start before v2's core is [x] and Q3 is answered. Extend the dashboard into something resident
  - it watches, and it does not reside.

STOP WHEN
  The deep plan is authored, every open decision is surfaced, and the owner has it in hand - or
  you have reported that Q3 is still open and stopped without authoring.
```

### T15 — W15 · Ticket closure

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     the tempting answer is a one-line config change that removes the only fence standing
          in front of the plan a worker is judged against.

DO NOT RUN THIS PROMPT YET.
W15 is DECLARED, NOT BUILT IN v2. Its deep plan is authored only after v2's core has landed -
W01 through W08, W11 and W12 all [x] in specs/awsf-v2-plan.html - AND after the owner has decided
between host-owned closure and closure that stays manual.

You are authoring a DEEP PLAN. You write no implementation code.

WORKSTREAM: W15 - Ticket closure. Spine milestone M15.
PREDECESSORS: v2's core, complete. Plus the owner's decision named above.

READ FIRST
  specs/awsf-v2-plan.html - the W15 block IN FULL and "Shared Invariants and Constraints"
  specs/tickets/awsf-v2-w12-cheatsheet/README.md - the friction log, entries O28, O34, O35, O36,
    and the two blocks W01-TICKET-PROMPT-FIDELITY and OWNER-BUILDER-WRITE-SCOPE
  core/src/cli/commands/land.ts - confirm for yourself that it still flips nothing
  awsf.config.yaml - every role's `writes`, and `policy.protected_paths`
  core/test/unit/meta/ticket-plan-sync.test.ts - what it checks, and what it does not

THE CONTRADICTION THIS WORKSTREAM EXISTS TO RESOLVE
  Every ticket prompt requires the plan marker and the ticket `state:` to flip in the same commit.
  No role can write specs/*.html. Nothing in core/src flips either one. So no task driven through
  the factory can close its own ticket, and every one so far was closed by hand afterwards.

DO
  Invoke /plan-sota with QUESTIONABLE true to author specs/awsf-v2-w15-ticket-closure.html, its
  own -build-prompts.md, and specs/tickets/awsf-v2-w15-ticket-closure/ with a README recording
  any derived-field rule.

  BEFORE ANY OF THAT: confirm no role's `writes` was widened into specs/ under another
  workstream's name while W15 sat declared. If one was, that is the finding, and report it before
  authoring anything.

YOUR DEEP PLAN'S FIRST TASK IS FIXED IN ADVANCE
  Milestone one, task one: an owner-authored amendment adding `specs/*.html` to
  policy.protected_paths in awsf.config.yaml. It lands under gate G2, BEFORE any closure
  mechanism is designed or built.
  Verified expressible: path-policy's globSource compiles a single `*` to `[^/]*`, so
  `specs/*.html` matches every plan file and leaves intake's `specs/tickets/**` untouched.
  path-policy rejects a protected path INDEPENDENTLY of the write globs, so this fence holds even
  against a glob widened later - including one widened by this workstream.
  WHY IT IS FIRST AND NOT LAST: this workstream is the first thing that will want to touch specs/
  write access, and a fence written by the session doing the widening is a weaker fence than one
  that was already standing. Do not reorder it, and do not fold it into the milestone that builds
  the mechanism.

THE PROPERTY THAT IS FIXED REGARDLESS OF THE DESIGN
  Whatever closes a ticket must not be able to change what that ticket asked for. Hold your first
  line to it.

WHY A WIDENED WRITE SCOPE IS NOT THE ANSWER, AT ANY WIDTH
  specs/ is not in policy.protected_paths, so the write glob is the ONLY fence in front of it.
  A role that can write specs/** can edit the plan's AC-n and INV-n declarations, the ticket's
  acceptance rows and the Section B prompt bytes, all three consistently, and
  ticket-plan-sync.test.ts still passes - it checks that plan and tickets AGREE, never that
  either is unchanged. Narrowing does not rescue it: that same test requires a task's plan
  checklist and its ticket state to move together, so a scope covering specs/tickets/** alone
  produces a candidate that fails its own configured gates.

INVARIANTS THIS WORKSTREAM TOUCHES
  2 and 12 directly. If the chosen shape needs a protected-config or invariant amendment, gate G2
  applies: the owner-authored commit lands BEFORE the build that needs it.

DO NOT
  Write implementation code. Commit. Flip W15's marker. Read either frozen candidate record.
  Start before v2's core is [x] and the owner's decision is taken. Widen any role's `writes` into
  specs/ - if your design needs that, you have found the wrong design.

STOP WHEN
  The deep plan is authored, every open decision is surfaced, and the owner has it in hand - or
  you have reported that the owner's decision is still open and stopped without authoring.
```

### T16 — W16 · The pi/OpenRouter adapter

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     the deep plan already exists; what remains is a review that has to resist a number
          that looks like money and a routing rule that quietly admits only two providers.

THE DEEP PLAN FOR THIS WORKSTREAM IS ALREADY AUTHORED.
specs/awsf-v2-w16-openrouter-adapter.html was written on 2026-09-15, with its build prompts and a
twelve-ticket set at specs/tickets/awsf-v2-w16-openrouter-adapter/. So this prompt is NOT the
usual "author a deep plan" meta-prompt. Do not author a second one. Do not rewrite the one that
exists unless a review says to.

WORKSTREAM: W16 - the pi/OpenRouter adapter. Spine milestone M16. OPTIONAL to v2's completion.
PREDECESSORS: none. Nothing above this workstream waits on it, and its deep plan was authored
without waiting on anything.

WHAT REMAINS
  The owner-review gate, and then execution through that plan's own ticket set - T01 through T12,
  in order, each in a fresh session. This ticket is the spine's record of the workstream; it is
  not the thing that builds it.

READ FIRST
  specs/awsf-v2-plan.html - the W16 block IN FULL, plus "Shared Invariants and Constraints"
  specs/awsf-v2-w16-openrouter-adapter.html - What Already Exists, then the Questionables IN FULL
  specs/tickets/awsf-v2-w16-openrouter-adapter/README.md - the gates before T01 may run
  core/src/adapters/pi-codex.ts - the reviewed shape the new adapter is modelled on

WHAT THE REVIEW MUST NOT LET THROUGH
  A cost authority claimed on the strength of a provider-shaped number. The Codex route reported
  an equally convincing figure and was demoted to catalog-estimate because pi computes it locally
  from a rate card. Four evidence items gate the promotion in that plan and one of them - reading
  pi's own OpenRouter cost path - is unread. Holding at catalog-estimate with that recorded is
  written in as a complete outcome, and the review should be willing to take it.
  Any relaxation of PI_PROVIDER, of PiCodexAdapter's argv, or of ENV_ALLOWLIST. All three are
  out of scope by construction and the plan says so; a review that lets one in has removed the
  reason the workstream is a second adapter at all.

THE OWNER DECISIONS THIS WORKSTREAM NEEDED - ALL THREE TAKEN 2026-09-15
  Q1 - a pi-level retry is ONE call. The ceiling counts host-launched processes.
  Q2 - any distinct provider may review. Open-weight routes are admissible for reviewer phases.
  Q3 - the provider string is the unit of inversion, with NO per-recipe cap on OpenRouter phases.
  Q2 and Q3 went against the plan's recommendations. NEITHER NEEDS CODE: oppositeProvider already
  asks only that a reviewer be DIFFERENT, and providerPairFrom's exactly-two rule already refuses a
  recipe whose builder and reviewer both resolve to openrouter - the case Q3's rejected cap was
  meant to prevent. The deep plan's T11 proves both rather than asserting them.
  WHAT IS STILL UNTAKEN, and was deliberately not put to the owner: whether the factory should ever
  invert across THREE providers. That is a change to a rule every workstream shares, not a decision
  W16 is entitled to make. A three-provider recipe stays refused at preflight.

INVARIANTS THIS WORKSTREAM TOUCHES
  1, 3, 7, 9, 11 and 12. It adds no push path, no resident process, no skill in the execution
  path, and no credential anywhere in core/src.

DO NOT
  Author a second deep plan. Write implementation code from this ticket. Flip W16's marker in
  specs/awsf-v2-plan.html - the deep plan's own T12 does that, and it is the only thing that may.
  Enable the route in awsf.config.yaml; that is a separate owner act after the workstream lands.

STOP WHEN
  The owner has reviewed the deep plan and either approved it - at which point execution moves to
  specs/tickets/awsf-v2-w16-openrouter-adapter/T01.md - or returned it with an exported
  plan-sota-review v1 block for a session to apply.
```

### T17 — W17 · shift, a milestone as one attempt

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     the deep plan already exists; what remains is a review that has to hold one
          structural amendment to a compile-time invariant, and refuse the obvious
          shape the lifecycle cannot support.

THE DEEP PLAN FOR THIS WORKSTREAM IS ALREADY AUTHORED.
specs/awsf-v2-w17-shift.html was written on 2026-09-15, with its build prompts and an
eighteen-ticket set at specs/tickets/awsf-v2-w17-shift/. So this prompt is NOT the usual
"author a deep plan" meta-prompt. Do not author a second one. Do not rewrite the one that
exists unless a review says to.

WORKSTREAM: W17 - shift: sequential unattended execution of one milestone's tickets.
Spine milestone M17. It SUPERSEDES the "away mode" candidate recorded in this plan's
2026-09-03 amendment, which adopted nothing and moved no marker.
PREDECESSORS: W04 (for the project registry's delivery posture) is [x]. Nothing else above
this workstream waits on it.

WHAT REMAINS
  The owner-review gate, and then execution through that plan's own ticket set - T01
  through T18, in order, each in a fresh session. This ticket is the spine's record of the
  workstream; it is not the thing that builds it.

READ FIRST
  specs/awsf-v2-plan.html - the W17 block IN FULL, the 2026-09-03 away-mode amendment IN
    FULL, and "Shared Invariants and Constraints"
  specs/awsf-v2-w17-shift.html - Purpose, Problem, Solution, Identifier Spine and the
    Questionables IN FULL
  specs/tickets/awsf-v2-w17-shift/README.md - the two gates before its T01 may run
  core/src/state/task-machine.ts :115 - L20, the reason the obvious shape was rejected
  core/src/workflow/compiler.ts :120-160 - reviewBuildPhaseId and compileWorkflow

THE MEASUREMENT THIS WORKSTREAM STARTS FROM
  A shift is a NEW WORKFLOW TYPE, not a command that launches other runs. L20 is
  actors ["human"], interactive: true, the only route into LANDED, with no tier exemption,
  and errors.ts:22 records that AWAITING_OWNER has no timeout by design. A shift of nine
  independent attempts halts on ticket 1 and waits for a person. Unattended sequencing
  therefore requires the tickets to be PHASES OF ONE ATTEMPT.
  Granularity is one shift per MILESTONE, not per plan, and that is arithmetic rather than
  taste: minimumCalls is N + 1, MAX_CALL_CEILING is 20, and the eleven authored v2 deep
  plans hold 184 tickets in 60 milestones - median 3, maximum 6. A milestone always fits.
  A whole plan never does: W05's 31 tickets would need 32 calls.

WHAT THE REVIEW MUST NOT LET THROUGH
  A relaxation of reviewBuildPhaseId to "at least one build producer". The plan amends it
  to "exactly one distinct build PROVIDER", which is what production-run.ts:1157 was always
  checking; "at least one" admits a shift whose builders run on different routes, which is
  the ambiguous inversion the rule exists to refuse.
  A placeholder shift recipe registered in WORKFLOW_RECIPES to satisfy catalog.ts's
  module-load assertion. It is one line and it makes minimumCallsFor report a fiction.
  Any path by which a running shift reaches awsf raise, or by which a clock reaches L21.
  A batch that retries itself through rework: every rework phase is maxCorrections 0 and
  that path rejects credential-shaped provider output where a normal run scrubs it.

THE DECISIONS ARE ALREADY TAKEN - ALL SEVEN, 2026-09-15
  The owner directed that the plan's own recommendation be applied to every Questionable,
  so none of them is waiting on a review. Each carries a DECIDED block with its reasoning
  and its full option set. Nothing in this workstream is blocked on a decision.
  Q1 reviewBuildPhaseId requires ONE DISTINCT BUILD PROVIDER, not one build phase.
  Q2 a ticket-phase carries the ticket's own ## Build prompt verbatim, plus its ## Handoff.
  Q3 pre-flight `awsf raise` on the shift's task; the global T2 dial and a shift-scoped
     ceiling are both refused. Measured: 54 of 60 milestones need no raise at all.
  Q4 nothing further on seeding - one attempt seeds once, so the blocker is dissolved.
  Q5 the manifest lives in the state root beside the attempt, which is what INV-4 assumes.
  Q6 one readout plus one freshly built preview - DECIDED BUT NOT CLOSED. T18's bounded
     live drive is its falsifier, and R5 stays on the risk register until it has run.
  Q7 shift ships DISABLED; enabling it is a separate owner act after the workstream lands.
  What a review should still refuse: relaxing Q1's rule to "at least one build producer",
  and any quiet redesign of the Q6 readout that skips the live drive.

TWO ORDERING GATES
  G17   - awsf.config.yaml's workflows.enabled gains `shift` as an OWNER-AUTHORED commit
          before that plan's T05 builds. No agent can write that file.
  G17-M - main and task3.5 are merged before that plan's T11 starts. Measured 2026-09-15:
          production-run.ts is +547/-98 on main against +96/-17 on task3.5 from merge-base
          8268258, and a trial merge conflicts in 17 files. The ref at seal time and the
          dashboard's failure classifier both live on the far side of that merge.

INVARIANTS THIS WORKSTREAM TOUCHES
  1, 2, 3, 8, 9, 11 and 12. It adds no push path, no resident process, no skill in the
  execution path, and no writable dashboard route. It needs ONE protected-config amendment
  (workflows.enabled) and NO invariant amendment.

DO NOT
  Author a second deep plan. Write implementation code from this ticket. Flip W17's marker
  in specs/awsf-v2-plan.html - that plan's own T18 does that, and it is the only thing that
  may. Enable the workflow in awsf.config.yaml from this ticket; that is gate G17 and it is
  the owner's commit.

STOP WHEN
  The owner has reviewed the deep plan and either approved it - at which point execution
  moves to specs/tickets/awsf-v2-w17-shift/T01.md - or returned it with an exported
  plan-sota-review v1 block for a session to apply.
```
