# Preflight a task

Resolve the request before spending a provider call. This cookbook supplies
judgment. `awsf preflight`, owner confirmation and `awsf start` supply the
mechanical checks. Reading this file substitutes for none of them.

## 1. Write the request, then cut it

The request becomes input to later phases. Ambiguity is therefore paid for again
by the planner, builder and reviewer. Resolve the missing facts before launch,
and keep the ask short enough that the owner can check it without reconstructing
the conversation.

**The intent is the owner's. The precision is yours.** Use these labels, in
order, with nonempty content:

- **Ask:** the outcome in the owner's words.
- **Where:** the allowed write paths.
- **Done means:** observable acceptance that can be checked.
- **Out of scope:** the work this task must not absorb.

The parser lives in `core/src/preflight/fields.ts`. Do not prepend a narrative
that hides or changes the ask. `how_to_prompt_for_the_owner.md` explains how to
resolve a short owner request into these fields without substituting your own
intent.

A hypothetical request has this shape. These example paths are not claims about
this repository and must not be submitted unchanged:

```text
Ask: Reject an empty label without changing valid labels.
Where: core/src/labels.ts and core/test/unit/labels.test.ts.
Done means: An empty label returns the specified validation error, valid labels
retain their existing result, and the regression tests and required gates pass.
Out of scope: Renaming labels, changing stored records or redesigning the UI.
```

“Improve validation” gives a worker no stopping condition. A named input, expected
result and preserved behavior do. When acceptance is visual or interactive,
specify the observation and who will verify it instead of pretending a unit test
proves the whole experience. If the intended result is still unclear, ask the
owner before creating the task.

## 2. Choose a workflow whose tier matches the risk

```bash
just awsf workflows
just awsf routes list
```

A recipe fixes its tier. `new` derives it and refuses a conflicting explicit
`--tier`. Read the enabled recipes, phases, minimum calls, ceiling and correction
headroom from the catalogue. Do not choose a cheaper recipe to evade the review
or write policy that the change needs.

`choose_the_workflow_and_tier.md` explains the choice. The sources are
`awsf.config.yaml`, `core/src/workflow/catalog.ts`, the recipes and
`core/src/state/tiers.ts`.

Judge risk by consequences, not line count. A small process-control or persistence
change can need stronger review than a large documentation change. Check which
quality evidence the recipe buys, including whether it plans first, reviews the
candidate independently or reruns checks after documentation changes.

If the change needs evidence the selected recipe omits, change the proposal
before launch. If the only reason for selecting a weaker route is insufficient
budget, tell the owner. A cheaper route must not conceal the risk. Unfamiliar
code may justify a separate read-only survey before proposing writing work,
but a survey result is not authority to implement it.

## 3. Resolve the request against the repository

Before `new`, turn the owner's outcome into a source-grounded request. This is
investigation, not implementation. Do not edit code or a managed worktree while
resolving the ask.

| Input to resolve | Evidence to collect |
|---|---|
| Named paths and symbols | Open their current definitions and callers. Correct a moved or renamed reference before passing it to a worker. |
| Claimed behavior | Read the condition that produces it and the relevant tests. Distinguish an observed failure from an explanation that has not been verified. |
| Ambiguous terms | Identify the actual store, view, command or repository meant. Two components with similar names are not interchangeable. |
| Prior attempts | Read the recorded cause and relevant gate or review evidence. Carry forward established facts and identify what has changed since that attempt. |

For example, “the list hides these tickets” is a symptom. A source reference to
the exact filename filter, the filenames it excludes and a reproducing test is
a usable fact. Do not claim a filter is the cause merely because its name looks
relevant. If the source does not establish the cause, say what remains unknown
and choose a workflow that can investigate it.

Cite current locations rather than line numbers copied from a stale handoff.
Put resolved scope and acceptance into the request without prescribing an
unverified implementation. This applies to direct build routes too. A recipe
without a planner gives nobody a separate phase to repair a mistaken premise.

If work belongs to a registered plan, read its ticket and the matching Section B
prompt. Select the exact plan and ticket. A shift selects complete milestones
instead. Do not recreate already completed work or edit a ticket's canonical
prompt to make an attempt easier to launch.

Resolve actual write scope versus read-only context. Inspect the configured role
write globs and protected paths. A protected-path refusal requires the prescribed
owner authorization, not a wider glob or a rewritten request that conceals the
write. If repository facts change the scope the owner asked for, explain that
before creating a replacement task.

## 4. Read the headroom before starting

The catalogue's `corrections fundable` is a margin, not a promise of success.
Compare it with the recipe and the likely correction needs. The host's admission
checks decide whether the declared route can be funded.

Read minimum calls, remaining task spend and correction margin together. A
recipe's host phases do not cost provider calls. A cold correction does, while
an eligible same-session continuation has different accounting. The displayed
margin does not guarantee a particular number of recoverable failures.

A previously failed attempt, unfamiliar envelope shape or multi-phase change is
a reason to examine headroom carefully. It is not a rule to raise every task.
Explain which likely correction or required later review the additional calls
would fund. If no bounded amount makes the proposal sensible, narrow the work
with the owner rather than increasing the ceiling reflexively.

When more budget is justified, prepare the exact owner command and its reason:

```bash
# Owner only. N is the justified number of additional calls.
awsf raise TASK --calls N --reason "WHY"
```

A task must exist before it can receive a raise. Obtain a needed raise before
starting. Do not wait until a sealed attempt makes it unavailable, and do not
edit configuration mid-attempt to bypass the budget. A raise spends no call
itself but widens what later execution may spend. Retry carries prior spend.

## 5. Measure readiness and obtain owner confirmation

First verify the canonical repository and base revision. Diagnose the environment
without repairing it:

```bash
just awsf doctor
```

After creating the DRAFT task with its resolved request and selection, run the
host preflight. The following is a placeholder, not a task to submit:

```bash
just awsf preflight TASK --where core/src/example.ts
```

Repeat `--where` for allowed writes, `--read` for read-only paths and
`--consulted` for prior attempt evidence actually read. They are measured inputs,
not switches that mark fields passed. Read every refusal and name its cause.
Preflight can run configured gates in a baseline worktree, or reuse eligible
landed gate evidence. It therefore writes runtime evidence and can take time.

The **owner** then runs `awsf confirm TASK`. Present the exact request, paths
and measured results before asking for that decision. You may not invoke the
command or answer its prompt. Rerun preflight after an attestation when needed
to record the now-satisfied field. `start` rechecks the confirmation and all
freshness bindings against the current base.

Task-specific acceptance can require more than the configured candidate gates.
For this repository, `npm test` includes all five test layers, while the project
catalog's candidate gates are a different set. Verify the plan's full list and
report each original exit code. A green manual suite never replaces K1.

Read the configured argv and timeouts, not just the gate names. A command that
passes manually but exceeds its managed timeout will still stop the attempt.
Separate an existing baseline failure from a failure introduced by the proposed
change. Preserve the original output and exit status, and do not turn a failure
into green by weakening a check or reading only the last successful command.
If the evidence is stale, rerun the required check rather than citing an older
result as current.

Missing closure records for earlier eligible landings are owner work. Read the
refusal, prepare `awsf close` with its supporting evidence, and stop until the
owner resolves it. Never flip plan markers or create a different task to evade
closure.

## 6. Prepare, then hand the owner the launch

Once the recorded checks and owner decisions are satisfied:

```bash
just awsf start TASK
```

Report the task, attempt, lifecycle state and spend against the ceiling. Show the
base and request actually prepared. Then hand the owner `awsf run TASK` to
invoke personally. **A driving session must not invoke `run`**, including a
normally automatic run, because it can request an owner correction decision.
`run_and_observe.md` takes over after that boundary.

## The green flag

Use this checklist to explain readiness. It is a readout of evidence, not a
second set of switches that can override the command:

| Check | What must be established |
|---|---|
| Intent | The owner recognizes the exact ask, exclusions and observable acceptance. |
| Repository | The canonical repository, base revision, referenced files and selected plan or ticket are the intended ones. |
| Scope | Actual writes fit the role's globs and any exact protected authorization. Read-only context is identified separately. |
| Workflow and route | The recipe supplies the necessary evidence, the route is admitted and any required review remains independent unless explicitly degraded by the owner. |
| Budget | Remaining task headroom funds the declared route and required correction reservations. A needed owner raise has been recorded. |
| Baseline | Required checks have valid evidence for the bound revision and executable commands fit their configured timeouts. |
| Prior work | Relevant attempt findings were read and outstanding closure obligations were resolved through the owner path. |
| Confirmation | The owner confirmed the exact request and measured paths, and the host's freshness checks still hold. |

An unknown item is not ready. Report a refusal with its cause, evidence and the
next permitted remedy. Do not create a new identity, remove a selection or
rewrite retained evidence to make the same blocked work appear admissible.

The command owns prompt readability, repository identity, route admission,
freshness and the measured preflight fields. The driving session still owns the
judgment that this is the repository and change the owner intended. No mechanical
identity check can discover an unstated intention.
