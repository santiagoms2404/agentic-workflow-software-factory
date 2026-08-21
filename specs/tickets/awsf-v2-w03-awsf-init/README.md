# Tickets — AWSF v2 W03: awsf init

One file per task in `specs/awsf-v2-w03-awsf-init.html`, `T01`–`T09`, mirroring that plan's own
numbering. Prompts are carried byte-identical to their block in
`specs/awsf-v2-w03-awsf-init-build-prompts.md`; do not paraphrase either side.

## Derived-field rule

Per the ticket-authoring convention (`plan-sota` Create Plan workflow, step 10), any field not
read directly off the plan must have its derivation rule written down here rather than re-derived
downstream.

- **`milestone`** is the `M`-number of the phase the ticket's numbered task belongs to in
  `specs/awsf-v2-w03-awsf-init.html`: `M1` → `T01`–`T03`, `M2` → `T04`–`T05`, `M3` → `T06`–`T09`.
  Ticket number equals the plan's own `<h4>N.` task number exactly — `T03` is milestone M1's
  Testing Strategy task, not a merged M1/M2 boundary, and `T09` is the plan's single combined
  "full suite, marker flips, and the spine's W03 marker" task, not two separate tickets.
- **`depends_on`** follows the plan's own top-to-bottom task order with no presumed parallelism —
  every task in this plan reads or extends the output of the task immediately before it, so each
  ticket depends on exactly its predecessor (`T01` depends on none).
- **`tier`** and **`workflow`** are omitted entirely. This plan defines no risk-tier or named
  workflow-route vocabulary for its own tasks — those concepts belong to the target repositories
  `awsf init` creates, not to the meta-work of building the command itself. Inventing a taxonomy
  here to fill the field would misrepresent that.
- **`state`** mirrors this plan's own checklist/milestone status markers (`[]`/`[wip]`/`[x]`/`[f]`
  → `todo`/`wip`/`done`/`failed`) and is flipped in the same commit as the plan marker, per
  AGENTS.md invariant 12.

## Sync

`core/test/unit/meta/ticket-plan-sync.test.ts` pairs this directory with
`specs/awsf-v2-w03-awsf-init.html` automatically once both exist — no separate registration step.
