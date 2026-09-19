# `awsf-v2-w10-mf-adapter` — ticket set

Execution surface for [`../../awsf-v2-w10-mf-adapter.html`](../../awsf-v2-w10-mf-adapter.html), the deep
plan for **W10 — the `mf` adapter and native fusion**: fusion expressed as a compiled workflow, where each
model consultation is a phase and the external tool stops being a candidate executable.

- **Deep plan:** [`../../awsf-v2-w10-mf-adapter.html`](../../awsf-v2-w10-mf-adapter.html)
- **Spine:** [`../../awsf-v2-plan.html`](../../awsf-v2-plan.html) § Implementation Phases → Milestone M10 → W10
- **Spine ticket:** [`../awsf-v2-plan/W10.md`](../awsf-v2-plan/W10.md)
- **Prompt source:** [`../../awsf-v2-w10-mf-adapter-build-prompts.md`](../../awsf-v2-w10-mf-adapter-build-prompts.md)
  § Section B — each ticket's `## Build prompt` is byte-identical to its block there.

Twenty-three tickets, `T01`…`T23`, across seven milestones. One ticket is one fresh session.

> **Scope grew on 2026-09-15.** The owner reviewed the plan, took the recommended option on Q1–Q7, and then
> answered Q8 **against** the recommendation: all six of the tool's commands, not two. That added milestone **M4
> (debate)** and milestone **M6 (collaborate)** and renumbered routing to M5 and the close to M7 — 16 tasks to 23.
> The plan's second amendment records what changed and which earlier refusal was withdrawn.

---

## This workstream is optional, and M1 is allowed to end it

Nothing in v2 waits on W10. **Milestone M1 is a decision milestone and it costs no quota.** If its two
offline proofs do not hold, the honest ending is to record the evidence gap in the spine and close the
workstream unbuilt — the spine sanctions that outcome by name and it is not a failure. What this
workstream may never do is graduate on a guarantee the broker never saw.

---

## The fork is already decided, and the two refusals are not re-openable here

The plan chose **option (c) — fusion is a recipe** — and refused (a) and (b) on read evidence. A session
that thinks it has found a cheaper path should read the plan's "The fork, decided" section before acting;
both refusals name the file and line they rest on.

- **(b) opaque is refused because there is no executable.** `mf` v1's launcher is a `bash` wrapper that
  `exec`s an interactive session; v2 has no executable at all and is a Pi extension driven by slash
  commands in a TUI. AWSF's broker needs a name, an argv array, a filtered environment, an FD handshake
  and a decodable terminal event. Building a headless entry point for the tool is work in **another
  repository**, which the spine's Shared Invariants name as owner-side and never a ticket.
- **(a) native is refused on cost.** It needs a fourth broker registration class, a third barrier
  settlement mode carrying an amount, a composite branch in `restoreReservation`, an orchestration layer,
  and a second spawn discipline beside the broker's — to deliver a registration, a reservation, a
  worktree, a permission session and a retained envelope per child. Which is the definition of a phase.

---

## Gates before execution

**A session that starts a gated task before its gate has landed should stop and say so rather than work
around it.**

### G10-A — who owns the compiled-recipe admission path (shapes **T07**)

The generators do not share: `compileShift(manifest, bodies, config)` turns ticket bodies into phases and
`compileFusion(roster, request)` turns a model roster into phases, and an abstraction over both would be a
taxonomy nothing reads. **The admission and recovery half does share** — a compiled recipe that is not in
`WORKFLOW_RECIPES` needs a workflow id, a ceiling admission, a binding digest, and a byte-identical rebuild
on resume. **Whichever workstream lands that first owns it; the second consumes it.** W17 is core and W10
optional, so the expected order is W17 first, but this is deliberately **not** a blocking gate — an
optional workstream must not stall on a core one's schedule. T07's prompt is written to work either way.

### G10-B — the `task3.5` merge (blocks **T14** onward, so all of **M5**)

Per-phase route selection is commit `b47b2a7` on branch `task3.5`, and `git merge-base --is-ancestor
b47b2a7 HEAD` reports it is **not** an ancestor of `main`. Measured 2026-09-15: `task3.5` is 27 commits
ahead of `main`, `main` 8 ahead, merge base `8268258`; a trial merge conflicts in seventeen files and
`core/src/cli/commands/production-run.ts` — which M5 edits — is the largest of them. W17 records the same
gate as G17-M.

Note what the flag actually is, because the spine describes it as a command-line option and it is not:
**`routing.phase_routes` is durable config in `awsf.config.yaml`**, a `Record` keyed by phase id, read by
`requestedPhaseRoute` in `core/src/workflow/phase-routing.ts`. An N-slot roster is therefore an
owner-authored commit to a protected file, not a flag on a command.

**What is unblocked today:** M1, M2, M3 **and M4** entirely. Every file they add is new — under
`core/src/workflow/fusion/`, `core/src/contracts/`, `prompts/` and `core/test/` — and neither branch touches any
of them. Debate landing before the gate is deliberate: it needs nothing from the routing work, so it lengthens
the useful pre-merge run by three tasks.

### G10-C — the protected-config removal (blocks the code half of **T22**)

Retiring `composite-fusion` requires the `adapters.fusion` entry to leave `awsf.config.yaml` as an
**owner-authored commit first**. `load.ts` validates adapter kinds against `KNOWN_ADAPTER_KINDS`, so
removing the kind while the config still declares it breaks config load. No agent can write that file:
`path-policy` rejects `protected-path` independently of the write globs, and inventing an
owner-authorized protected-change mechanism to route around it is the boundary working.

### The Questionables

**Eight of the nine are decided.** The owner reviewed the plan on 2026-09-15 and took the recommended option on
Q1–Q7; Q8 was then answered directly, **against** the recommendation, as all six commands. Each is marked
*Decided* in the plan and is a constraint rather than a question — do not re-open one without saying so.

Three of the eight change how a session behaves and are repeated here so a ticket cannot miss them:

- **Q2 — W10 stops after M4 and waits for the merge.** The stopping point moved: it was M3, and M4 (debate) is
  not gated by G10-B, so the pre-merge run now ends at **T13** rather than T10.
- **Q3 — the three-provider inversion is W16's decision, not this workstream's.** T15 inherits it.
- **Q7 — a roster is durable config.** Changing which models are consulted is an owner-authored commit to a
  protected file, never a flag on a command.

**`Q9` was opened by the Q8 decision and decided the same day: two tasks, two ceilings.** A collaboration's stage
one and stage two are separate tasks, because `tiers.ts` makes `committed` task-lifetime rather than
attempt-lifetime — two stages in one task would share one ceiling, and with three planners and four delegated
tasks that is nine calls against a shipped T2 ceiling of five.

**Q9 also corrected a wrong clause in its own recommendation, and M6 depends on the correction.** The
recommendation claimed the journal already makes a delegation plan addressable across tasks. It does not. The one
mechanism that crosses a task boundary is `awsf seed` / `adopt`, and it carries **Git objects only** —
`CandidateAdoptionEvidenceSchema` pins `sourceEvidenceCopied: Literal(false)` and `sourceApprovalsCopied:
Literal(false)`, and its header says it *never copies a source envelope*. So **the delegation plan travels as a
committed artifact**: stage one commits it as its candidate, and stage two is seeded from that SHA and reads the
file out of its own tree. Two consequences every M6 ticket inherits:

- **`INV-6` is already enforced and must not be rebuilt.** `seed.ts:39` refuses a non-interactive terminal with
  `CandidateSeedRejected("requires an interactive owner terminal")`. T19 asserts that refusal; it does not build
  a second owner gate beside it.
- **Stage two never reaches stage one's journal.** It is a different task. The committed plan is the only input,
  which is also what makes it reproducible — a blob at a known SHA rather than a journal row.

**Nothing is outstanding.** Every Questionable in this plan is decided.

### Documents and capabilities that do not exist and must not be invented

- There is **no fusion adapter**. `core/src/adapters/fusion.ts`, named in `config/schema.ts`'s comment,
  has never existed; `registry.ts` returns `null` for the kind and calls it v1.1 scope.
- There is **no compiled recipe anywhere in the tree**. All eight recipes under
  `core/src/workflow/recipes/` are static `as const` objects.
- There is **no headless entry point** in either generation of the owner's tool.
- `core/src/workflow/phase-routing.ts` and `core/src/contracts/route-selection.ts` **do not exist on
  `main`**. They arrive with the `task3.5` merge. A task before M4 that needs them is mis-sequenced.

---

## Conventions used by every prompt

### Read first, on every task

`AGENTS.md` in full · `specs/awsf-v2-w10-mf-adapter.html` (Purpose, Problem, "The fork, decided",
Solution and the Identifier Spine in full, then the task's own milestone) · this README.

### The baseline rule

Run `npm run test:unit` **at the exact base SHA your task starts from**, before changing anything, and
record the count in the commit body. A red baseline blocks a correct build, and neither `doctor` nor
`lint` catches one.

### Marker discipline — both files, always

This plan is one workstream of a parent spine, so there are **two** marker sets and every prompt addresses
both:

1. **This leaf plan's own markers**, in `specs/awsf-v2-w10-mf-adapter.html`. **Flipped on every task,
   including the first**: the task's checklist `<code class="status">` items, plus the milestone's `<h3>`
   header on that milestone's last task.
2. **The spine's workstream marker**, in `specs/awsf-v2-plan.html` § Milestone M10 / W10. **Not flipped
   until T23**, which is the only ticket that writes to the spine at all — and which leaves it at `[]`
   deliberately when the workstream closes unbuilt.

Flip the ticket's own `state:` in the same commit as the HTML marker. The plan's status markers stay the
source of truth.

### The commit rule

Commit once the task's Definition of Done is green, as one Conventional Commit, with a body saying what
changed and **why** — the decision behind the shape, the alternative rejected, and any row left `[f]` with
the block that holds it. `scope` is this plan's own vocabulary for the area (`fusion`, `contracts`,
`compiler`, `budget`, `routing`, `config`), never a file path. **Never** put an agent, model or AI tool in
a commit identity, message or trailers — AGENTS.md invariant 11, and a meta-test scans for it.

### The handoff duty

Every prompt ends with one. Before finishing, open the ticket files whose `depends_on` names your id and
append dated, numbered entries (`C1`, `C2`, …) to their `## Handoff` section: contradictions between their
prompt and what is now true, moved or renamed files their `READ FIRST` names, findings that change what
they should do, options you rejected, and scope they can now skip or must absorb. Say plainly which source
wins when two disagree. An empty Handoff is a real answer.

### Why the Handoff section comes first

`## Handoff` sits **above** `## Build prompt` in every ticket. The sync fence splits a ticket body on
`## Build prompt\n\n` and compares **everything after it** against Section B byte for byte, so a handoff
appended below the prompt would break the fence on its first entry. Above it, the Handoff can grow forever
without the two artifacts disagreeing.

### The never-do list

Each of these is a plausible convenience that would break a locked decision.

- **Do not describe the gap as ledger arithmetic.** `settle(id, spent)` exists at `call-budget.ts:419` and
  its own comment describes the halfway composite exactly. The gap is that the launcher barrier's
  `ReservationLedger` seam (`launcher-barrier.ts:333`) has no method that takes an amount, so no launch can
  reach `settle` with one. The arithmetic version suggests a ledger redesign that is not needed, and a
  session that believes it will spend the workstream on the wrong thing.
- **Do not register a fusion recipe in `WORKFLOW_RECIPES`.** One line satisfies `catalog.ts`'s module-load
  assertion, and it makes `minimumCallsFor` and `correctionsFundableFor` report a number that is wrong for
  every roster but one.
- **Do not relax `SAFE_MODEL_SELECTOR` in `pi-codex.ts`.** Its comment explains exactly why a `/` is
  refused: `pi --model` accepts a `provider/id` form, so a slash names a second provider from inside a flag
  already told which provider to use, and `--provider` loses. A different provider through the same binary
  is a different adapter — that is W16.
- **Do not widen `providerPairFrom`.** W16 § M4 owns the three-provider inversion decision and calls
  widening it a Questionable rather than a task. Two workstreams deciding one rule is how the rule ends up
  with two answers.
- **Do not select `same-provider-degraded` from a fusion recipe**, and never as a fallback from a transport
  failure. It exists to be named explicitly in durable config.
- **Do not add a writer lease, a lock file, a writer token, or a worktree per role.** The owner's tool
  needs a lease because its slots run concurrently; AWSF's phase loop awaits each turn, so single-writer is
  structural. A lease here would protect against a race the loop makes impossible and would imply a
  concurrency this factory does not have.
- **Do not give an opinion envelope a diff, a patch or a file list.** The shortest path from "a model with
  an opinion" to "a model that implements it" is one schema field, and it would be added for a good reason.
- **Do not change `MAX_CALL_CEILING`, `DEFAULT_CALL_CEILINGS` or `ceilingFor`.** The plan measured it: no
  code change is needed at any N from 2 to 5. The bound is deliberately in code rather than config, because
  a bound the config could raise would be a bound the config could remove.
- **Do not let a fusion raise its own ceiling.** `awsf raise` requires an interactive terminal by design; a
  run that can widen itself is not bounded by a checkpoint at all.
- **Do not create a reservation whose `kind` is not `"single"` or whose `cost` is not `1`.** That is the
  only shape `restoreReservation` admits, and prefix recovery depends on it.
- **Do not build a DAG *scheduler*.** Collaboration is in scope as of the Q8 decision, but M6 delivers it by
  *flattening* a validated graph to a topological order and letting the existing sequential phase loop run it. A
  scheduler that executes tasks as dependencies clear would be a concurrency this factory does not have, and
  getting one would need a second spawn discipline beside the broker's.
- **Do not add a judge to a debate.** The command is N-way with no judge; the absence is the feature. A final
  "just summarise it" phase turns a debate into a fusion with extra rounds.
- **Do not let a debate or a collaboration's stage one write.** A debate has no writer at all. An architect that
  can both decide the work and do the first piece of it is the delegation INV-6's owner act exists to interrupt.
- **Do not compile a collaboration's stage two from the architect's live response, or from stage one's journal.**
  Stage two is a different task and cannot reach that journal. The committed plan in the seeded tree is the only
  input, and a blob at a known SHA is what keeps the recipe reproducible on resume.
- **Do not extend `seed` or `adopt` to carry an envelope.** `sourceEvidenceCopied: Literal(false)` and
  `sourceApprovalsCopied: Literal(false)` are that contract's whole design statement. The committed-file route
  needs no change to them, which is why it is the route.
- **Do not build an owner gate between a collaboration's stages.** `awsf seed` already is one. A new weaker
  guarantee beside a stronger one that was not read is the exact mistake the spine's revision rule was written
  for.
- **Do not take a live capture before M7.** The fit already failed at the broker, so a capture taken before
  the fork was chosen buys nothing. M7 is the only milestone that spends quota, and it spends it once.
- **Do not declare the workstream done on a green suite.** The suite is not the acceptance bar; T21's one
  bounded live drive is, and per-phase attribution is what it has to show.

---

## Frontmatter schema

```yaml
---
id: T01                 # matches the filename; maps to the plan's <h4> task number
title: "..."            # ALWAYS quoted; must equal the Section B heading exactly
milestone: M1           # the plan's milestone block this task lives in
state: todo             # todo | wip | done | failed — mirrors []/[wip]/[x]/[f]
depends_on: [T04]       # [] for the first; the plan's real dependency chain
serves: [AC-1, INV-5]   # this task's Identifier Spine claims, mirrored as a set
---
```

**Deliberately absent fields, and why.**

- **`tier`** — this plan defines no per-task risk tier. It defines a tier for the *recipe* a fusion
  compiles to (T2, per Questionable Q1), which is a property of a run rather than of a build task.
  Inventing a per-task tier to fill the field would be a taxonomy nothing reads.
- **`workflow`** — this plan defines no per-task execution route. A fusion recipe is deliberately **not**
  in `WORKFLOW_IDS` (INV-5), so there is no honest value to put here.

An absent optional field is a legitimate shape; a present-but-wrong one is the defect.

---

## Derived-field rules

Every field not read verbatim off the plan, with its derivation:

- **`milestone`** — read off the `<h3><code class="status">[...]</code> Milestone Mn:` block the task's
  `<h4>` lives inside. Not derived; the fence compares it.
- **`serves`** — the set of `<code class="serves">` values inside the task's `<h4>` slice, mirrored
  exactly. The fence's MIRROR rule fails when either side is edited alone.
- **`depends_on`** — derived from the plan's stated dependency structure, **not** a blind `n−1` chain.
  Three rules: a task depends on the tasks whose output it reads; a milestone's final Testing Strategy task
  depends on every substantive task in its milestone; and T23, the closing task, depends on every
  milestone-closing task plus T21 and T22. Granted parallelism is real — **T14 depends on T07 alone**, not on
  M3's or M4's closing task, so the routing work can start as soon as the generator exists and G10-B has landed,
  whether or not debate has been built yet.
- **`state`** — `todo` at authoring. The fence cross-checks it against both the milestone marker and the
  task's own checklist, so it can only move when the plan moves.
- **`title`** — byte-identical to the Section B `### Tnn — <title>` heading. Both artifacts are emitted
  from one source string for exactly this reason.

---

## Execution order

```
T01 ──> T02 ──> T03  (M1 closes — the fork is recorded, or the workstream ends here)
                 │
                 └──> T04 ──> T05 ──> T06  (M2 closes)
                                       │
                                       └──> T07 ─┬──> T08 ──> T09 ──> T10  (M3 closes)
                                                 │                     │
                                                 │                     └──> T11 ──> T12 ──> T13  (M4 closes)
                                                 │                                          ▲
                                                 │                          ═══ PRE-MERGE RUN ENDS HERE ═══
                                                 │
                                                 └──> T14 ──> T15 ──> T16  (M5 closes)   [G10-B blocks T14]
                                                                       │
                                                                       └──> T17 ──> T18 ──> T19 ──> T20  (M6 closes)
                                                                                                     │
                       T10, T13, T16, T20 ──────────────────────────────> T21 ──> T22 ──> T23  (M7 + W10 close)
                                                                                    ▲
                                                                          [G10-C blocks T22]
```

**The pre-merge run is T01 through T13** — thirteen tasks, four milestones, zero quota. Per the Q2 decision the
workstream stops there and waits for the `task3.5` merge. **T14 is where it resumes.**

It forks once, after **T07**: the M4 debate work and the M5 routing work both descend from the generator and neither
needs the other. **T23 is the only join that matters across milestones**: it waits on T10, T13, T16, T20, T21 and
T22, because it asserts every acceptance row in one place and it is the only ticket that writes to the spine.

Reading order for a fresh session: this README, then the plan's Purpose / Problem / "The fork, decided" /
Solution and Identifier Spine, then your ticket.
