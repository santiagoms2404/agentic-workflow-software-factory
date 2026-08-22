# Tickets — AWSF v2 W04: Project registry v1

One file per task in `specs/awsf-v2-w04-project-registry.html`, `T01`–`T21`, mirroring that plan's
own numbering. Prompts are carried byte-identical to their block in
`specs/awsf-v2-w04-project-registry-build-prompts.md`; do not paraphrase either side.

## Derived-field rule

Per the ticket-authoring convention (`plan-sota` Create Plan workflow, step 10), any field not read
directly off the plan must have its derivation rule written down here rather than re-derived
downstream.

- **`milestone`** is the `M`-number of the phase the ticket's numbered task belongs to in
  `specs/awsf-v2-w04-project-registry.html`: `M1` → `T01`–`T05`, `M2` → `T06`–`T08`, `M3` →
  `T09`–`T11`, `M4` → `T12`–`T15`, `M5` → `T16`–`T18`, `M6` → `T19`–`T21`. Ticket number equals the
  plan's own `<h4>N.` task number exactly — `T05` is milestone M1's Testing Strategy task, not a
  merged M1/M2 boundary, and `T21` is the plan's single combined "full suite, marker flips, and the
  spine's W04 marker" task, not three separate tickets.

- **`depends_on`** follows the plan's stated dependency chain **including its two granted
  parallelisms**, not a blind `n-1` chain:

  | Ticket | Depends on | Why |
  |---|---|---|
  | `T01` | — | the first task |
  | `T02`, `T04` | `T01` | the catalog schema and the placement schema share **only** the extracted machine-path guard, and neither reads the other. They may be built in either order or at the same time. |
  | `T05` | `T03`, `T04` | M1's testing task asserts over both loaders, so it waits on both branches rejoining |
  | `T13`, `T14` | `T12` | the local fence and the central reconciliation share **only** the digest record from `T12`. The local fence takes one repository root and the reconciliation takes a resolved project; neither calls the other, and their asymmetry is the design. |
  | `T15` | `T13`, `T14` | M4's induced-drift proof exercises both fences against one fixture |
  | everywhere else | its immediate predecessor | each task reads or extends the output of the one before it |

- **`tier`** and **`workflow`** are omitted entirely. This plan defines no risk-tier or named
  workflow-route vocabulary for its own tasks — those concepts belong to the target repositories a
  registered project contains, not to the meta-work of building the registry. Inventing a taxonomy
  here to fill the field would misrepresent that. The sync fence treats both as optional and checks
  them only when present.

- **`state`** mirrors this plan's own checklist/milestone status markers
  (`[]`/`[wip]`/`[x]`/`[f]` → `todo`/`wip`/`done`/`failed`) and is flipped in the same commit as
  the plan marker, per AGENTS.md invariant 12.

## Two ordering facts these tickets encode and must not be reordered around

1. **`T16` refuses to start until the owner-authored AGENTS.md invariant 12 amendment has landed.**
   Ordering gate **G2**. `depends_on: [T15]` records the task order; it cannot record an owner act,
   so the precondition is stated in `T16`'s own `PREDECESSORS` line and repeated in the build
   prompts' *Before anything: three gates*. Tasks `T01`–`T15` do not need the amendment.
2. **`T19` comes before `T20`, and the order is the whole point.** `ticketStoreFor` resolves
   `specs/tickets` and `TicketStore` reads that exact directory with no recursion, so moving v1's
   flat tickets before the store can resolve a plan would silently make `awsf ticket list` and
   `awsf backlog` return nothing. That move was attempted once and reversed for exactly this reason
   — see `specs/awsf-v2-candidates-fuse-version.md` §10.2. `T19` gives the store a plan to resolve
   against; `T20` moves the files, and captures the pre-move output as its first act.

## Sync

`core/test/unit/meta/ticket-plan-sync.test.ts` pairs this directory with
`specs/awsf-v2-w04-project-registry.html` automatically once both exist — no separate registration
step. From task 17 onward that pairing is resolved through the project registry rather than through
directory adjacency; the assertions it makes are unchanged.
