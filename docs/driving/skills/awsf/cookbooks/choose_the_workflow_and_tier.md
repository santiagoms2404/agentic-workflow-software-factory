# Choose the workflow and the tier

Two dials are set before the first call is reserved, and both are pinned into the
attempt when it is created. This document is **how to choose**. It names no
workflow, no phase list and no ceiling, because those are supplied by the
configuration and the code and would go stale here in silence.

`preflight_a_task.md` §2 carries the short version, at the moment of use. This is
the long one.

## Where "what exists" actually comes from

Read them, in this order, rather than remembering them:

- `awsf.config.yaml` — `workflows.enabled` is the set this project will run, and
  `risk.default` is the tier an attempt gets when `--tier` is not given. It is
  the only committed tuning surface.
- `core/src/workflow/recipes/` — one file per recipe: its phases, their kinds and
  their order. `core/test/unit/workflow/recipes.test.ts` pins the whole catalogue
  against a hand-written expectation, so the test is a second readable index.
- `core/src/state/tiers.ts` — the per-tier call ceilings and the reservation
  arithmetic, including `assertWorkflowFitsTier`.

Note the shape of that list: **the ceilings live beside the code that enforces
them**, and the tier that pays for a mandatory opposite-provider review is stated
in the same file that defines the number. Any answer you give about a ceiling
should have come from there in the last minute.

## The tier is about risk, not size

The tier is a statement about what a wrong change costs, not about how much
typing it involves. A one-line change to a permission check is riskier than a
thousand-line rename.

Escalate when the change touches any of: security or permission decisions,
process control and spawning, persistent data or its migrations, a boundary more
than one component depends on, or code the existing suite barely exercises. The
last one is the quietest and the most common: **weak test coverage is itself a
risk tier input**, because it removes the thing that would otherwise catch the
mistake.

The top tier is also what buys the mandatory review on the opposite provider.
That is not a bonus; it is the reason the top tier's ceiling is what it is. If
you want the review, you are choosing the tier that pays for it.

## The workflow is about which phases the change needs

Ask what evidence you want to exist when the run ends, and pick the recipe that
produces it.

- A change you will read yourself needs fewer phases than one you will land.
- A change whose shape is uncertain wants a planning phase before a building one,
  because a plan is a cheap place to be wrong.
- A change that must be defended wants a review phase, and a review phase implies
  the tier that funds it.

Buying more workflow than the change needs spends the ceiling on ceremony.
Buying less means the escalation you turn out to need is refused mid-run, after
calls are already spent.

## The two dials are coupled, and the coupling is enforced

A recipe declares a minimum number of provider calls, and a recipe whose minimum
cannot fit the selected tier is **refused before execution, at compile time** —
not halfway through, when the refusal would already have cost the calls it is
refusing (`assertWorkflowFitsTier`, `core/src/state/tiers.ts`).

So the pairing is checked for you, and the check is early and free. What is not
checked for you is the direction: nothing stops you from selecting a tier whose
ceiling comfortably fits a workflow that is wrong for the change.

Host-side phases matter here and are easy to misread. Some phases in a recipe run
on the host and reserve no call at all, so a recipe's phase count is not its
price. Read `minimumCalls` on the recipe, never the length of its phase list.

## The failure mode worth naming

**If you find yourself choosing the tier to fit the budget rather than the risk,
stop and say so.** That is a decision for the owner, not a parameter — and it is
usually the moment a task should be split instead, because two correctly-tiered
tasks are cheaper than one that is under-tiered and has to be re-run.

The mirror image is choosing the tier to buy a review you want for comfort. That
is also the owner's decision, and it is honest to say which one you are doing.

## Both dials are frozen at creation

The workflow, the tier and a snapshot of the effective configuration are recorded
when the attempt is created, and the owner acts that re-enter a running attempt
refuse if the configuration has drifted since — see `gotchas.md`. Changing your
mind about either dial means a new attempt, and a new attempt carries the spend
of the old one forward. Choose deliberately the first time; that is most of what
this document is for.

## What is deliberately not in this document

No table of recipes, no phase lists, no ceilings, no default. Every one of those
is single-sourced in `awsf.config.yaml` and `core/src/`, and a copy here would be
a second source of truth that goes wrong quietly — a renamed recipe, a changed
ceiling — with nothing to catch it.

The gap behind that restraint is closed. `awsf workflows` prints the catalogue
from the live registry: one row per enabled recipe with its tier, its minimum
provider calls, its ceiling, how many correction rounds that ceiling can fund,
and its ordered phase list, above a header line of the configured tier ceilings.
Run it instead of reading a table here.

The restraint itself stands and is the reason the command exists rather than a
table: the command reads `awsf.config.yaml` and the shipped recipes at the moment
you ask, so it cannot go stale the way a copy in prose does. The diagnosis command
still reports locks, processes, projection health and the size of the state
matrix, and still does not report the catalogue — that is `awsf workflows`' job.

Read `corrections fundable` before you commit to a route. It is
`ceiling − minimum calls`, and a `0 (none)` means every correction round the
recipe declares is unpayable on a route whose agents start cold: the first
envelope defect ends the attempt on its first occurrence. `awsf start` refuses
such a route rather than letting you discover it mid-run, and names the
`awsf raise` that lifts it while the attempt is still a draft.
