# Tickets — AWSF v2 W05: Design → architecture-review → plan

One file per task in `specs/awsf-v2-w05-design-to-plan.html`, `T01`–`T28`, mirroring that plan's
own numbering. Prompts are carried byte-identical to their block in
`specs/awsf-v2-w05-design-to-plan-build-prompts.md`; do not paraphrase either side.

## Derived-field rule

Per the ticket-authoring convention (`plan-sota` Create Plan workflow, step 10), any field not read
directly off the plan must have its derivation rule written down here rather than re-derived
downstream.

- **`milestone`** is the `M`-number of the phase the ticket's numbered task belongs to in
  `specs/awsf-v2-w05-design-to-plan.html`: `M1` → `T01`–`T02`, `M2` → `T03`–`T05`, `M3` →
  `T06`–`T09`, `M4` → `T10`–`T15`, `M5` → `T16`–`T19`, `M6` → `T20`–`T22`, `M7` → `T23`–`T28`.
  Ticket number equals the plan's own `<h4>N.` task number exactly.

- **`depends_on`** follows the plan's stated dependency chain **including its one granted
  parallelism**, not a blind `n-1` chain:

  | Ticket | Depends on | Why |
  |---|---|---|
  | `T01` | — | the first task, and it runs before any code exists |
  | `T10`, `T11`, `T12` | `T09` | **M4 opens three branches.** `spine_declared` reads the design envelope, `design_evidence_present` reads the design context, and `architecture_verdict_consistent` reads the review envelope. No two of them call each other, so they may be built in any order or at the same time. |
  | `T13` | `T12` | the review-gate branch continues: the zero-blocker gate joins the module task 12 created |
  | `T14` | `T10` | the identifier-gate branch continues: `spine_carried` joins the module task 10 created |
  | `T15` | `T11`, `T13`, `T14` | M4's testing task asserts over all five gates, so it waits on all three branches rejoining |
  | everywhere else | its immediate predecessor | each task reads or extends the output of the one before it |

- **`tier`** and **`workflow`** are omitted entirely. This plan defines no risk-tier or named
  workflow-route vocabulary **for its own tasks**. The tier-2 recipe and the `design-to-plan`
  workflow id discussed throughout belong to the artifact being built, not to the meta-work of
  building it, and borrowing them here would misdescribe both. The sync fence treats both fields as
  optional and checks them only when present.

- **`state`** mirrors this plan's own checklist and milestone status markers
  (`[]`/`[wip]`/`[x]`/`[f]` → `todo`/`wip`/`done`/`failed`) and is flipped in the same commit as
  the plan marker, per AGENTS.md invariant 12.

- **`serves`** is absent from every ticket until **task 18**, which is the task that gives this plan
  a spine section to read them off. From then on it is **read off the plan, never derived** — a
  reviewer who disagrees with a claim edits the plan, and the ticket follows. The field is optional
  by design: a ticket set whose plan declares no identifiers carries none, and that is a legitimate
  shape rather than a defect.

## Two ordering facts these tickets encode and must not be reordered around

1. **`T23` refuses to start until W06's centralisation milestone is `[x]`.** Ordering gate **G1**.
   `depends_on: [T22]` records task order; it cannot record another plan's marker, so the
   precondition is stated in `T23`'s own prompt, in its first checklist box in the plan, in the
   build prompts' *Before anything: three gates*, and here. **`T01`–`T22` do not need it**, and
   that is the point: six of seven milestones are independent of W06, so this workstream's build
   and W06's build overlap rather than queue.

2. **`T24` comes before the owner's `awsf.config.yaml` amendment, and the amendment comes before
   `T27`.** `core/src/config/load.ts` rejects any `workflows.enabled` entry that is not in
   `KNOWN_WORKFLOW_IDS`, so an amendment landing first makes `loadConfig` refuse the file and
   **every** `awsf` command stops, not just this route. The task order cannot encode an owner act,
   so the sequence is stated in the plan's *Amendment Required Before the Route Runs* section and
   repeated in `T27`'s prompt.

3. **`T25` comes before `T26`, and both edit the same file.** Task 25 binds `design-context` and
   task 26 binds `plan-context` and `plan-render`, all inside the one system-prompt composition
   site `production-run.ts` already has. Splitting them is what keeps each diff readable; ordering
   them is what keeps two sessions from editing the same loop concurrently. **Neither may add a
   second composition site** — task 26 asserts the count did not rise.

## Sync

`core/test/unit/meta/ticket-plan-sync.test.ts` pairs this directory with
`specs/awsf-v2-w05-design-to-plan.html` automatically once both exist — no separate registration
step, because the pairing is resolved through the registered plan source rather than through
directory adjacency. From **task 17** onward that same fence also joins on the `INV`/`AC`
identifiers, and from **task 18** onward this plan is one of the sets it joins.
