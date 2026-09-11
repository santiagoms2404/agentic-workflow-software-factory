# awsf — driving the factory

The judgment layer over the AWSF CLI. This document decides *which* command to
run and how to read the result; the commands hold the knowledge.

Run `/prime-awsf` first if this session has not been primed.

## Posture

- **Thin skill, fat CLI.** Every action is a command a human could type. Reading
  the journal, the status store or the SQLite projection directly is expected;
  hand-rolling a Git operation, a lifecycle transition, a call reservation or a
  journal write is not. **If a command is wrong, fix the command** — do not
  route around it, and never let this document stand in for a display the CLI
  should have.
- **You do no worker work.** A driving session never implements the task, never
  edits a managed worktree, and never hand-edits an envelope or anything under
  the state root. It drives AWSF and reports.
- **Report the handle every time.** Every report names the task, the attempt,
  the lifecycle state, and calls spent against the tier ceiling. Those four are
  what the next command and the owner both key off.
- **Reference, never restate.** No schema, edge id, tier ceiling, gate id,
  blocker code or model id belongs in these documents. Point at
  `core/src/contracts/`, `core/src/state/`, `awsf.config.yaml` and
  `specs/awsf-plan.html`, all of which are single-sourced and tested.

## What you may run freely

Status, watching, the dashboard, and journal reads are **read-only**:

```bash
just awsf status TASK
just awsf watch TASK
just awsf dash
```

Rebuilding the projection is **not** read-only, and must never be described as
such. It is **non-destructive and idempotent**: it builds a fresh database
aside, links the live one out of the way under a retained name, and renames the
new file into place. Safe to run at any time, still a write.

```bash
just awsf db rebuild
```

## What only the owner may do

`journey`, `land`, `cancel`, `rework`, `review`, `degrade-review`, `raise` and `publish` are owner acts.
Prepare them and explain them; never perform one, and never recommend
performing one without the evidence its edge requires. Landing is authorised
by the owner at a terminal — the terminal check is a shape test, not the
authorisation boundary, and the boundary marimba operates under is the
per-invocation tool-surface denial.

## Hard rules

1. **No skill is ever in the execution path.** No gate, transition, guard,
   reservation or accounting decision may depend on this document being read or
   followed. If one ever would, that is a defect in the CLI and is fixed there.
2. **No live task state, ever.** Never record which task, attempt or session is
   running, and never print an unrequested status board (`AGENTS.md`
   invariant 1). Worked examples here use the placeholder `TASK` for that
   reason, and carry no session ids, continuity locators or machine paths.
3. **Never open `private/`.** The continuity locator and the materialized system
   prompts live there, host-private. This is said out loud rather than merely
   omitted, because a directory left unmentioned is avoided by habit and a
   directory named as forbidden is avoided by rule.
4. **No push, no deletion, no external mutation, no credential access.** Landing
   is a local fast-forward the owner authorizes; no push path exists to use.

## Routes

Load what the request calls for, and no more. Reading the whole tree to answer
one question is how a session arrives with a summary instead of an answer.

| When the request is | Read |
|---|---|
| prepare and launch a new task | `cookbooks/preflight_a_task.md` |
| write the request text, or sharpen one the owner gave you | `cookbooks/how_to_prompt_for_the_owner.md` |
| decide the workflow and the tier | `cookbooks/choose_the_workflow_and_tier.md` |
| launch a run, watch it, or work out whether it is stuck | `cookbooks/run_and_observe.md` |
| an attempt is blocked or waiting, and something has to be decided | `cookbooks/read_a_blocked_attempt.md` |
| the owner is weighing `journey`, `land`, `cancel`, `rework`, `review`, `degrade-review`, `raise` or `publish` | `cookbooks/owner_acts.md` |
| where does a journal, envelope, gate row, process record or raw capture live | `references/evidence_map.md` |
| which source owns a state, an edge, a guard, a ceiling or a recipe | `references/lifecycle.md` |
| something behaved surprisingly, or a refusal looks like a bug | `references/gotchas.md` |

Paths are relative to this file. A route pointing at a document that does not
exist is the same drift these rules exist to prevent, so the suite asserts that
every path in this table resolves — the table cannot quietly outlive the tree.

The order above is roughly the order a task moves through, and the three
references are lookups rather than reading. `/prime-awsf` is the entry point for
a session that has not been primed; it is not in this table because it is a
command, not a route.
