# `awsf-v2-w17-shift` — ticket set

Execution surface for [`../../awsf-v2-w17-shift.html`](../../awsf-v2-w17-shift.html), the deep plan for
**W17 — `shift`**: sequential unattended execution of one milestone's tickets, as one attempt whose
recipe is compiled from the tickets themselves.

- **Deep plan:** [`../../awsf-v2-w17-shift.html`](../../awsf-v2-w17-shift.html)
- **Spine:** [`../../awsf-v2-plan.html`](../../awsf-v2-plan.html) § Implementation Phases → Milestone M17 → W17
- **Spine ticket:** [`../awsf-v2-plan/W17.md`](../awsf-v2-plan/W17.md)
- **Prompt source:** [`../../awsf-v2-w17-shift-build-prompts.md`](../../awsf-v2-w17-shift-build-prompts.md)
  § Section B — each ticket's `## Build prompt` is byte-identical to its block there.

Eighteen tickets, `T01`…`T18`, across six milestones. One ticket is one fresh session.

---

## Gates before execution

Two ordering gates, and one open-decision gate. **A session that starts a gated task before its gate
has landed should stop and say so rather than work around it.**

### G17 — the protected-config amendment (blocks **T05**)

`awsf.config.yaml`'s `workflows.enabled` must gain `shift` as an **owner-authored commit before T05
builds**. No agent can write that file: `path-policy` rejects `protected-path` independently of the
write globs, and `adopt.ts` and the production runner both refuse a workflow the effective config does
not enable. Inventing an owner-authorized protected-change mechanism to route around this is the
boundary working, not a bug.

**Reordered 2026-09-25: G17 now follows T05.** Before T05, `load.ts` refused `shift` as an unknown
id, so a config commit that came first would have broken every command. The owner's commit
lands after T05 and must also add `workflow|shift` to `docs/cheatsheet.html`'s workflow facts in
the same commit. The plan's 2026-09-25 amendment has the evidence.

### G17-M — the merge (blocks **T11** onward, and ideally **T05**)

`main` and `task3.5` must be **merged before T11 starts**. Measured 2026-09-15 from merge-base
`8268258`: `main` is 8 commits ahead, `task3.5` is 27; `core/src/cli/commands/production-run.ts` is
**+547/−98** on `main` against **+96/−17** on `task3.5`; a trial merge conflicts in **17 files**.

M4, M5 and M6 all live inside `production-run.ts`'s blast radius. So does the ref at seal time, which
the 2026-09-03 amendment called the single most necessary piece. And `dashboard/src/run-failures.ts`,
the failure classifier, **exists only on `task3.5`** (commit `2bc217d`) — it is not on `main` at all.

`task3.5` also already edits two files T05 and T06 touch — `core/src/config/workflow-ids.ts` (it adds
`AGENT_PHASE_IDS`) and `core/src/workflow/review-routing.ts` (it adds `ReviewRouteMode` and a
`same-provider-degraded` mode). Editing either on `main` first **adds two new conflicts to the
seventeen**, so T05 and T06 are best taken after the merge too, and T06 must be authored against the
post-merge `review-routing.ts` regardless.

**What is unblocked today:** M1 entirely, M3 entirely, and T04 — all new files under
`core/src/workflow/shift/`, `core/src/contracts/` and `core/src/persistence/`, none of which either
branch touches.

### The Questionables — all seven DECIDED 2026-09-15

**Nothing here is waiting on an owner decision any more.** All seven Questionables in the plan's
`#questionables` section were decided on 2026-09-15 to the plan's own recommendation, each with a
`DECIDED` block carrying the reasoning and its full option set. Read them there; the two that
change what a session does are:

- **Q1 (blocks T06):** `reviewBuildPhaseId` is amended to require the build producers to resolve to
  **exactly one distinct provider**, not exactly one build phase. T06 was already written to this,
  so the decision made it consistent rather than changing it. **Do not** relax it to "at least one".
- **Q7 (shapes G17):** `shift` ships **disabled**. The owner's config commit adds it to
  `workflows.enabled` and routes no agent to it; enabling is a later, separate act.

**Q6 is decided but not closed.** One readout plus one freshly built preview is what M5 builds, and
**T18's bounded live drive is its falsifier**. If that drive shows the readout is not enough, record
the finding in the plan's Q6 and in `R5` — do not quietly redesign the readout without it.

### Documents that do not exist and must not be invented

There is no away-mode implementation, no queue, no batch runner, and no `shift` recipe file anywhere
in the tree. The 2026-09-03 spine amendment records a **candidate** and adopts nothing. Nothing in
`core/src/workflow/recipes/` is compiled; all eight are static.

---

## Conventions used by every prompt

### Read first, on every task

`AGENTS.md` in full · `specs/awsf-v2-w17-shift.html` (Purpose, Problem, Solution and Identifier Spine
in full, then the task's own section) · this README.

**Then your own ticket file, `specs/tickets/awsf-v2-w17-shift/T<NN>.md`, with `<NN>` taken from the
prompt's `TASK <n> of 18` line, and its `## Handoff` section in full, before changing anything.** The
build prompt you were handed does not name this file, because every prompt must stay byte-identical to its
Section B block. The Handoff is where earlier sessions record what changed after the prompt was written:
files that moved, scope already done or newly absorbed, and findings that overturn the prompt. Where the
Handoff and the prompt disagree, the Handoff wins unless it says otherwise. An empty Handoff is a real
answer, but you only know it is empty by opening the file.

### The baseline rule

Run `npm run test:unit` **at the exact base SHA your task starts from**, before changing anything,
and record the count in the commit body. A red baseline blocks a correct build, and neither `doctor`
nor `lint` catches one.

### Marker discipline — both files, always

This plan is one workstream of a parent spine, so there are **two** marker sets and every prompt
addresses both:

1. **This leaf plan's own markers**, in `specs/awsf-v2-w17-shift.html`. **Flipped on every task,
   including the first**: the task's checklist `<code class="status">` items, plus the milestone's
   `<h3>` header on that milestone's last task.
2. **The spine's workstream marker**, in `specs/awsf-v2-plan.html` § Milestone M17 / W17. **Not
   flipped until T18**, which is the only ticket that writes to the spine at all.

Flip the ticket's own `state:` in the same commit as the HTML marker. The plan's status markers stay
the source of truth.

### The commit rule

Commit once the task's Definition of Done is green, as one Conventional Commit, with a body saying
what changed and **why** — the decision behind the shape, the alternative rejected, and any row left
`[f]` with the block that holds it. `scope` is this plan's own vocabulary for the area (`shift`,
`compiler`, `budget`, `ref`, `readout`, `adopt`), never a file path. **Never** put an agent, model or
AI tool in a commit identity, message or trailers — AGENTS.md invariant 11, and a meta-test scans for
it.

### The handoff duty

Every prompt ends with one. Before finishing, open the ticket files whose `depends_on` names your id
and append dated, numbered entries (`C1`, `C2`, …) to their `## Handoff` section: contradictions
between their prompt and what is now true, moved or renamed files their `READ FIRST` names, findings
that change what they should do, options you rejected, and scope they can now skip or must absorb.
Say plainly which source wins when two disagree. An empty Handoff is a real answer.

### Why the Handoff section comes first

`## Handoff` sits **above** `## Build prompt` in every ticket. The sync fence splits a ticket body on
`## Build prompt\n\n` and compares **everything after it** against Section B byte for byte, so a
handoff appended below the prompt would break the fence on its first entry. Above it, the Handoff can
grow forever without the two artifacts disagreeing.

### The never-do list

Each of these is a plausible convenience that would break a locked decision.

- **Do not launch a run per ticket.** `task-machine.ts:115` makes `L20` `actors: ["human"],
  interactive: true` — the only route into `LANDED`, with no tier exemption, and `errors.ts:22`
  records that `AWAITING_OWNER` has no timeout by design. Nine attempts halt on ticket 1. Tempting
  because "a runner that starts runs" is the obvious reading of the request.
- **Do not register a placeholder `shift` recipe in `WORKFLOW_RECIPES`.** One line satisfies
  `catalog.ts`'s module-load assertion, and it makes `minimumCallsFor` and `correctionsFundableFor`
  report a number that is wrong for every real shift.
- **Do not relax `reviewBuildPhaseId` to "at least one".** It admits a shift whose builders run on
  different routes, which is exactly the ambiguous inversion the rule exists to refuse.
- **Do not reach for `rework` as automatic recovery.** Every rework phase is `maxCorrections: 0`, so
  a raise buys no correction margin there, and that path *rejects* provider output matching a
  credential pattern where a normal run scrubs it. A blocked shift surfaces.
- **Do not let a shift raise its own ceiling.** `awsf raise` requires an interactive terminal by
  design; a run that can widen itself is not bounded by a checkpoint at all.
- **Do not hard-code a browser preview step.** `PROJECT_DELIVERY_POSTURES` already declares the
  answer per project; a browser in the judgment layer bakes this repository's shape into every
  project the factory is pointed at.
- **Do not add an exemption to the invariant-8 meta-tests.** If the ref write cannot pass
  `no-destructive-paths` and `no-land-route` as written, the write is the wrong shape.
- **Do not widen `TICKET_WORKFLOWS`.** A ticket names its own route; the shift is the container.
- **Do not parse ticket ids for a naming convention.** `session-stacks.ts` compares them literally
  and the chaining test must still pass when three shifts share no id prefix.
- **Do not declare the workstream done on a green suite.** The suite is not the acceptance bar; T18's
  one bounded live drive is.

---

## Frontmatter schema

```yaml
---
id: T01                 # matches the filename; maps to the plan's <h4> task number
title: "..."            # ALWAYS quoted; must equal the Section B heading exactly
milestone: M1           # the plan's milestone block this task lives in
state: todo             # todo | wip | done | failed — mirrors []/[wip]/[x]/[f]
depends_on: [T04]       # [] for the first; the plan's real dependency chain
serves: [AC-2, INV-4]   # this task's Identifier Spine claims, mirrored as a set
---
```

**Deliberately absent fields, and why.**

- **`tier`** — this plan defines no per-task risk tier. A shift's tier is *derived at selection time*
  from the maximum of its selected tickets' tiers (T02), which is a runtime property of a selection,
  not a property of a build task. Inventing a per-task tier to fill the field would be a taxonomy
  nothing reads.
- **`workflow`** — this plan defines no per-task execution route. `TICKET_WORKFLOWS` deliberately does
  **not** contain `shift` (T02 adds a meta-test asserting that), so there is no honest value to put
  here.

An absent optional field is a legitimate shape; a present-but-wrong one is the defect.

---

## Derived-field rules

Every field not read verbatim off the plan, with its derivation:

- **`milestone`** — read off the `<h3><code class="status">[...]</code> Milestone Mn:` block the
  task's `<h4>` lives inside. Not derived; the fence compares it.
- **`serves`** — the set of `<code class="serves">` values inside the task's `<h4>` slice, mirrored
  exactly. The fence's MIRROR rule fails when either side is edited alone.
- **`depends_on`** — derived from the plan's stated dependency structure, **not** a blind `n−1`
  chain. Three rules: a task depends on the tasks whose output it reads; a milestone's final Testing
  Strategy task depends on **every substantive task in its milestone**; and T18, the closing task,
  depends on every milestone-closing task plus T17. Granted parallelism is real — T05, T06 and T08
  all depend on T04 alone and can run in any order.
- **`state`** — `todo` at authoring. The fence cross-checks it against both the milestone marker and
  the task's own checklist, so it can only move when the plan moves.

---

## Execution order

```
T01 ─┬─> T02 ─┬─> T03  (M1 closes)
     │        │
     └────────┴─> T04 ─┬─> T05 ─┐
                       ├─> T06 ─┼─> T07  (M2 closes)
                       │        │
                       └─> T08 ─┴─> T09 ──> T10  (M3 closes)

T07 ─┬─> T11 ─┬─> T13  (M4 closes) ──┐
     └─> T12 ─┘                      │
                                     ├─> T14 ──> T15 ──> T16  (M5 closes)
                                     │                    │
                                     └────────────────────┴─> T17 ──> T18  (M6 + W17 close)
```

It forks twice — after T01/T02 into the compiler and after T04 into T05/T06/T08 — and joins at each
milestone's Testing Strategy task. **T18 is the only join that matters across milestones**: it waits
on T03, T07, T10, T13, T16 and T17, because it asserts every acceptance row in one place.

Reading order for a fresh session: this README, then the plan's Purpose/Problem/Solution and
Identifier Spine, then your ticket.
