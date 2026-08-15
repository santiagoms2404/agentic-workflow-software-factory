# Run and observe

Launching is one command. Observing is the part that goes wrong.

## The sequence

```bash
just awsf start TASK
just awsf run TASK
```

`start` prepares the attempt and reports the base it prepared against. `run`
executes the compiled workflow and returns when the attempt stops moving — which
is not the same as when it succeeded.

Report the handle after each: the task, the attempt, the lifecycle state, and
calls spent against the ceiling. Then read state only when the next decision
needs it. Do not poll between the two commands to look busy; volunteered state is
stale on arrival, because state printed before the request describes a system the
very next run changes.

## What you may run freely, and one thing that is not read-only

Status, watching, the dashboard and journal reads are **read-only**. Run them
whenever a decision needs them.

```bash
just awsf status TASK
just awsf watch TASK
just awsf dash
```

`watch` polls the same status projection `status` prints and emits only revisions
it has not already shown, then returns on its own when the attempt reaches a
terminal state. It is the right command when you are waiting; `status` is the
right command when you are deciding.

Rebuilding the projection is **not** read-only and must never be described as
such. It is **non-destructive and idempotent**: it builds a fresh database aside,
links the live one out of the way under a retained name, and renames the new file
into place. Safe at any time, still a write.

```bash
just awsf db rebuild
```

## Reading the status display

The status display is line-oriented on purpose and every meter says what to do
with it. Read it top to bottom rather than skimming for a number:

- the **State** line carries the lifecycle state, the blocker code and detail when
  there is one, and the single next action;
- the **Phase** and **Rounds** lines say what is executing and how much
  intra-phase correction it has left;
- the **Calls** line is the handle you report — spent and reserved against the
  ceiling, with what remains;
- the **Model** line names the resolved identity *and its provenance*, and the
  provenance matters: a route-attributed identity is what the host inferred,
  never what the provider stream said;
- the **Owner re-entries** line is the attempt-scoped allowance that the owner
  acts draw on, and it is not the same allowance as the per-phase correction
  budget above it.

Two lines are absent and their absence is not evidence of health: **gate rows and
the last envelope are not printed.** See `read_a_blocked_attempt.md`.

## When a run is stuck

In this order, and no further than the step that answers you:

1. **Which phase is still running.** The status display names it and its state.
2. **What that phase is actually running.** The projection's process rows carry
   the recorded process identity and the argv the barrier registered. Read them
   through the dashboard or the projection; a locator that reached the child on
   argv is redacted out of that record on purpose, so its absence there is
   correct and not a gap.
3. **Whether anything is alive at all.** The diagnosis command compares each
   recorded process against the running ones and reports an orphan or a missing
   pid as a finding.

```bash
just awsf doctor
```

Then stop. **Stopping a run is an owner act** — see `owner_acts.md` — and it is
not something a driving session performs because a run looked slow. A run that is
merely slow and a run that is stuck look identical from outside for exactly as
long as the phase's own timeout.

## Every phase starts failed

This is the sentence to carry out of this document.

A phase is constructed **failed-equivalent**. It starts queued, any abnormal exit
records a failure, and only a clean exit through validation flips it to the one
state that means it worked (`core/src/state/phase-machine.ts`, whose header
states the rule directly: *success must be earned*).

So:

- a phase showing failed **may simply never have completed** — the failure is the
  default, not a verdict about the work;
- a phase still queued **never started**, and says nothing at all;
- only the earned success state is a claim, and it is the only one you may
  report as one.

**Do not dress up a partial run as a success.** The temptation is strongest when
most phases look fine and one is ambiguous, which is precisely the shape a
half-finished run has.

## Exit codes say less than they look like they say

`awsf run` exits non-zero unless the attempt came to rest awaiting the owner. An
attempt that blocked, and an attempt that was cancelled, and a genuine host error
all leave the same non-zero exit. **Read the state, not the code.** The owner
commands are worse in this respect and are covered in `gotchas.md`: a declined
confirmation also exits non-zero, and a decline is not a failure.

## What is deliberately not in this document

No instruction to run `status` on a fixed cadence, and no example that names a
real task. Both are the same mistake in different clothes: a document that
encodes a live attempt, or a habit that produces one. Every example here uses the
placeholder `TASK`.
