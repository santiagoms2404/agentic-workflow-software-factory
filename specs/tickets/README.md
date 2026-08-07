# Tickets — AWSF T01–T30

One file per bounded task, split from
[`../awsf-plan-build-prompts.md`](../awsf-plan-build-prompts.md) § Section B on 2026-08-06.
**Every build prompt is carried verbatim** — this split added frontmatter and cross-links, and
changed no prompt text.

`awsf-plan.html` remains the authority for task content and status. These files exist so the
thirty tasks become individually addressable, countable, and boardable — the shape a future
`awsf backlog` (plan Milestone M9, T31–T34) consumes.

## Frontmatter schema

| Field | Type | Source |
|---|---|---|
| `id` | `T01`–`T30`, zero-padded | filename; maps to the plan's task number (`T05` = plan task 5) |
| `title` | string | the Section B heading |
| `milestone` | `M1`–`M8` | the plan's Milestones & Tasks grouping |
| `tier` | `0` \| `1` \| `2` | **derived** — see below |
| `state` | `todo` \| `wip` \| `done` \| `failed` | mirrors the plan's `[]` / `[wip]` / `[x]` / `[f]` markers |
| `depends_on` | list of ids | the plan's Notes § Critical dependency chain |
| `workflow` | one of the six recipes | **derived** from `tier` |

`tier` is an integer, not `T0`/`T1`/`T2`, because the plan's risk tiers and its task ids would
otherwise collide (`T1` the tier vs. `T1` the task).

### Derived: `tier`

The plan assigns risk tiers to *work*, not to its own build tasks, so these are derived by one
stated rule rather than read off the plan:

- **tier 2** — failure is silent by nature, the ticket owns a safety boundary, or it spends live
  quota on a real repository: **T09–T12** (all of M3, which the plan itself marks ⚠), **T17**
  (permission / path / sandbox boundary, gate G4), **T21** (the human landing gate, gate G6),
  **T29–T30** (the two live pilots).
- **tier 1** — every other ticket.
- **tier 0** — none. Every ticket in this plan writes code or config.

A reviewer who disagrees should edit the field here, not re-derive it downstream.

### Derived: `workflow`

From the plan's own workflow/tier table (§ The Phase Contract):

- tier 2 → `build-review` (cross-provider reviewer, the plan's T2 route)
- tier 1 → `plan-build-test`

One exception, flagged in the ticket body: **T04** is `build`, because its Definition of Done is a
**RED** suite and every recipe ending in a `tests` phase gates on green. No recipe currently fits
"write failing tests." That is recorded as demand evidence, not fixed by inventing a seventh
recipe here.

### `depends_on`

Strict predecessor within each milestone, except where the plan's Notes § Critical dependency
chain grants parallelism:

- `T13`, `T14` both depend on `T12` — M4's two adapter tasks are parallelizable after M3
- `T15` depends on both
- `T17`, `T18` both depend on `T16`; `T19` depends on both — the plan's `T16 → T17/T18 → T19 → T20`

## Keeping state in sync

The plan's status markers are the source of truth. When a task's marker flips in
`awsf-plan.html`, flip `state:` here in the same commit. As of 2026-08-06: **T01–T05 `done`,
T06–T30 `todo`.**

This is **mechanically enforced** (AGENTS.md invariant 12) by
`core/test/unit/meta/ticket-plan-sync.test.ts`, which fails the build on drift. The plan carries
no per-task status marker — only milestone `<h3>` markers and per-task checklists — so `state` is
checked against both: a task in an `[x]` milestone must be `done`, a task in a `[]` milestone must
not be, and where a task has its own checklist, all-boxes-`[x]` and `done` must agree. Two tasks
(T28, T29) carry no checklist in the plan and are checked against their milestone marker alone.

The same test asserts each build prompt is byte-identical to its Section B block, so the tickets
can never fork from the file they were cut from. Ticket coverage is checked as a *contiguous
prefix* of the plan's tasks: M9's T31–T34 have no tickets yet and are legitimately uncovered;
adding `T31.md` extends the check to them automatically.

**`title` must be quoted.** Several task titles contain `:` (`Stream layer: LineFramer…`,
`Pilot 1: a real T1 task`), which YAML reads as a nested mapping. All thirty are double-quoted.
