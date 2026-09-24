# Lifecycle — a map, not a summary

**This document contains no state list, edge list, edge count, rejection
class or ordering.** It names the post-landing state and edge only: `PUBLISHED`
is reached from `LANDED` through `L27`. It says which file owns each of those, so you can read
the answer from the thing that is executed rather than from a paragraph that once
described it.

That is deliberate and it is the rule for every reference in this tree. A
lifecycle summary is the highest-value thing to copy and the fastest thing to go
wrong: an edge is renamed, a rejection is reordered, a state is added, and the
copy keeps answering confidently in the old vocabulary. The sources below are
pure, single-sourced and covered by the unit suite; a sentence here is none of
those.

## Where each question is answered

| When you need | Read |
|---|---|
| the task states, the legal edges between them, and the order in which a rejection is decided | `core/src/state/task-machine.ts` |
| what evidence an edge demands before it may be taken | `core/src/state/guards.ts` |
| the risk tiers, the call ceilings, and the reservation arithmetic that keeps two paths from both slipping under one | `core/src/state/tiers.ts` |
| what happens *inside* an executing state — the phase submachine, the correction allowance, and the causes that are correctable versus the ones that block immediately | `core/src/state/phase-machine.ts` |
| the error class raised by each refusal | `core/src/state/errors.ts` |
| which phases a workflow has, in what order, and what its minimum call count is | `core/src/workflow/recipes/`, indexed by `core/test/unit/workflow/recipes.test.ts` |
| how a failed gate escalates into a counted transition | `core/src/workflow/` |
| what a gate actually measures | `core/src/gates/` |
| the tuning that is committed rather than compiled — adapters, routing, per-agent model and harness, workflows, gates, risk, policy, observability | `awsf.config.yaml`, validated by `core/src/config/schema.ts` |
| why an edge exists at all, and what was decided when it was added | the Amendments in `specs/awsf-plan.html` for a v1 edge, or in the v2 deep plan that added it (`specs/awsf-v2-w*.html`) |

## Three properties of these sources worth knowing before you read them

They change how you read the files, and none of them is a fact that can go stale
in the way a transcribed edge can.

**Everything under `core/src/state/` is pure.** No I/O, no clock, no filesystem,
no process spawning — enforced by a meta-test. So a guard cannot go and look at
the world: anything it checks was *supplied* to it as evidence by a command. When
a refusal surprises you, the question is usually what the command gathered, not
what the guard decided.

**Rejection is ordered, and the order is part of the contract.** A transition
that violates several rules at once refuses for a specific one of them, and which
one is fixed rather than incidental. So an error message names the first thing
wrong, not the only thing wrong — do not read a single refusal as a clean bill of
health for everything it did not mention.

**Phase state is failed by default and success is earned.** The submachine
constructs a phase failed-equivalent; only a clean exit through validation flips
it to the state that means it worked. This is the one property most likely to be
misread from the outside, and `run_and_observe.md` says what to do about it.

## The vocabularies you will meet

Named here only so you know where each one lives, because they are easy to
confuse and a driving session reports in all four:

- **Lifecycle states** — the attempt's own state, in the task machine.
- **Phase states** — the submachine inside an executing lifecycle state. Not the
  same vocabulary and not the same file.
- **Blocker codes** — the class of a refusal, carried on the status display
  beside the state. The detail beside the code is the instance.
- **Gate ids** — what the host measured. A gate row is per phase, per gate, and
  is the half that disagrees with a phase's own envelope.

Reporting one of these where another is meant is the most common way a driving
session's report becomes unusable. Say which vocabulary you are speaking.
