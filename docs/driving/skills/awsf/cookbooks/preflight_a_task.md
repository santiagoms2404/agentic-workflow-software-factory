# Preflight a task

Resolve the request before spending a provider call. This cookbook supplies
judgment. `awsf preflight`, owner confirmation and `awsf start` supply the
mechanical checks. Reading this file substitutes for none of them.

## 1. Write the request, then cut it

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

## 3. Resolve the request against the repository

Before `new`, open every path and symbol the request names. Verify each claimed
behavior in the source. Distinguish a symptom from the condition that causes it,
and include facts a prior attempt already discovered. Cite current locations,
not line numbers copied from a stale handoff.

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

Say preparation is ready only when the request is resolved, its scope and route
match, the necessary budget and permissions exist, baseline evidence is valid,
closure obligations are satisfied, and the owner has confirmed the exact input.
A refusal is reported with its cause and remedy. It is never worked around.

The command owns prompt readability, repository identity, route admission,
freshness and the measured preflight fields. The driving session still owns the
judgment that this is the repository and change the owner intended. No mechanical
identity check can discover an unstated intention.
