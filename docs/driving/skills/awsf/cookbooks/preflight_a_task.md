# Preflight a task

What to settle **before** the first call is reserved. Everything here is
judgment. Nothing here is a substitute for a check a command should perform —
see the last section, which names two that are not written yet and says so.

## 1. Write the request, then cut it

The request text is not incidental. It is recorded by `awsf new`, and the
production runner renders it into the plan envelope that every later phase reads
(`core/src/cli/commands/production-run.ts`). A sloppy request is not a small
tax; it is paid again by every agent in the chain, and at the top tier it is
paid against a ceiling of a handful of calls.

**The intent is the owner's. The precision is yours.** Four lines, in order:

- **The ask** — one sentence, in the owner's words.
- **Where** — the files or directories this is allowed to touch.
- **Done means** — the observable condition that ends the task.
- **Out of scope** — what a well-meaning agent would otherwise drag in.

If "Done means" cannot be written as something a command can check, the task is
not ready to launch. That is the highest-value moment in the whole preflight and
no CLI can do it for you.

When the owner has given you one sentence and the other three lines have to be
found, `how_to_prompt_for_the_owner.md` is how — including what a "Done means"
that only looks like a condition reads like, and what you may never put in a
request.

## 2. Choose the workflow and the tier

The workflows and their phases are defined in `core/src/workflow/recipes/` and
pinned by the recipe tests; which of them this project will run, and the default
tier, are in `awsf.config.yaml`; the per-tier call ceilings are in
`core/src/state/tiers.ts`. Read them there — a number copied here goes stale in
silence. `awsf workflows` prints the catalogue from the live registry — tier,
minimum provider calls, ceiling, correction headroom and phase list per enabled
recipe — and `choose_the_workflow_and_tier.md` is the long version of how to read
it.

That cookbook is the long version of this section. The short version:

- The tier is about **risk of the change**, not size of the task. Security,
  process control, persistent data, cross-component or weakly-tested work sits
  at the top — and the top tier is what pays for the opposite-provider review.
- Buying more workflow than the change needs spends the ceiling on ceremony.
  Buying less means the escalation you turn out to need is refused mid-run,
  after calls are already spent.
- If you find yourself choosing the tier to fit the budget rather than the risk,
  stop and say so. That is a decision for the owner, not a parameter.

## 3. Resolve the request against the repository

**This is the step that decides whether a run is worth starting, and it is the
one a driving session exists to perform.** The owner supplies intent. Intent
names outcomes — "the backlog view reads the spine and the deep plans", "the
cards are scrollable". Outcomes are blocked by *facts*: a filter that excludes
the filenames in question, a poll that re-resolves on every tick, a helper the
test must use instead of the obvious one. The owner does not have those facts to
hand, and the planner is not being paid to discover them.

A request that states the outcome and omits the blocking facts makes the planner
rediscover them at full price, mid-run, with one correction round. It usually
rediscovers some of them and misses the rest, and the run completes against a
plan that was wrong in a way nobody reads until the review.

So before `awsf new`, resolve the request. For every claim it makes or assumes:

- **Every path and symbol it names must exist where it says.** Open it. If it
  moved, correct the request — do not launch a request that points at a line
  number from an older session.
- **Every behaviour it asserts must be read in the code, not believed.** Quote
  the actual expression into the request. "The store filter is `/^T\d\d\.md$/`
  and the spine plan's tickets are `WNN.md`" is a fact the planner can act on;
  "the backlog does not show spine tickets" is a symptom it has to re-derive.
- **Every noun the owner used that maps to more than one thing in the tree must
  be disambiguated** before it reaches an agent.
- **Anything a previous attempt on this task already discovered belongs in the
  request.** A failed drive's findings are the most valuable input the next one
  has, and they are lost unless a human carries them forward.

Grep, read, and open files freely — this costs nothing and no call is reserved
yet. `awsf scout` exists for the same purpose when the surface is unfamiliar and
you would rather buy one read-only pass than guess; it is the cheapest workflow
for exactly this.

Then put what you resolved into the request's **Where** and **Done means**
lines. You are not writing the plan. You are removing the questions the planner
would otherwise answer wrongly.

**This applies to every workflow, not only the plan-carrying ones.** `build` and
`build-review` have no planner at all, so an unresolved fact is not rediscovered
by anybody — the builder simply builds against the wrong assumption. The thinner
the recipe, the more the request has to carry.

## 4. Read the correction headroom, and prepare the raise before you need it

```bash
just awsf workflows
```

Every row ends with `corrections fundable: N`. That number is the ceiling minus
the calls the route must spend to finish once, and on a route whose agents start
cold it is **the number of correctable defects the entire run can survive** —
not per phase, and not per agent. A `0 (none)` means the first envelope defect
anywhere ends the attempt on its first occurrence, and `awsf start` refuses such
a route outright rather than letting you discover it mid-run.

`N` is not a budget to spend down to zero. Weigh it against the change:

- **`N` is `0`** — `start` refuses. The raise is mandatory, and the refusal
  names the exact call count.
- **`N` is `1` and the change is one file with one obvious edit** — proceed. One
  spare is a real margin for a small change.
- **`N` is `1` and the change spans several files, more than one subsystem, or
  anything the owner has already attempted and failed** — recommend a raise
  before starting. A margin of one means a single re-prompt anywhere in the run
  consumes the whole reserve, and the next correctable defect is terminal from
  zero.

The raise is an **owner act**. Prepare it, state why, and let the owner run it:

```bash
awsf raise TASK <calls> --reason "<why this run needs the headroom>"
```

It must happen **after `awsf new` and before `awsf start`** — the attempt has to
exist, and a sealed attempt refuses the grant, so the window closes the moment a
run blocks. It costs nothing, spends no call, invalidates no gate, is recorded on
that task alone, and cannot be undone. `owner_acts.md` carries the rest.

Do not raise reflexively on every task. A raise the owner did not need is spend
they may take later on a run that does, and the ceiling is the checkpoint the
whole budget rests on.

## 5. Run the diagnosis, then read it

```bash
just awsf doctor
```

Findings are evidence, not a chore list. The command has no repair path on
purpose: a stale lock or an orphan process is something the owner decides about,
never something a driving session tidies away before anyone has seen it.

## 6. Launch, then observe

```bash
just awsf new TASK "the four-line request"
# the owner raises here, if step 4 called for it
just awsf start TASK
just awsf run TASK
```

Report the handle and watch. Do not improvise a status board between the steps;
read state when the next decision needs it, against the task the owner named.
`run_and_observe.md` takes over from here.

## The green flag

Say the run is ready only when all six are true. Any "no" is reported to the
owner as a "no" with its reason, never worked around and never launched anyway.

1. **"Done means" is a condition a command can check.** Not "the view is
   correct" — the observable thing that ends the task.
2. **Every path, symbol and asserted behaviour in the request was opened and
   confirmed in this session.** Nothing carried on faith from an older handoff,
   nothing quoting a line number nobody re-read.
3. **Everything a previous attempt on this task discovered is in the request.**
   If the owner has tried this before, that history is an input, not trivia.
4. **The recipe was chosen for the risk and the shape of the work**, and the
   owner has been told which one and why — not merely which one.
5. **`corrections fundable` was read for that recipe and weighed against the
   change**, and if it is short, the exact `awsf raise` was put in front of the
   owner with its reason written.
6. **The write boundary covers the change.** Compare the files the request
   allows against the `writes` globs of every agent on the route in
   `awsf.config.yaml`. A builder cannot touch what its globs exclude and a
   documenter cannot either; a task whose change lands outside every boundary
   cannot succeed and must be routed to the owner as a configuration decision
   before a call is spent, not discovered as a `permission-breach` mid-run.

The owner's request is the owner's. **Sharpening it is the job; silently
substituting a different task is not.** When resolving the repository changes
what the task should be, say so and let the owner decide — do not launch your
reading of it as though it were theirs.

## What is deliberately not in this document

Two checks that look like they belong here are **CLI work wearing a cookbook's
costume**. Writing them as prose would hide a defect behind a paragraph asking a
human to remember, so they are named instead:

- *"Check the configured prompt files exist before you start."* **Landed.**
  `awsf start` composes every configured prompt of the selected recipe, with the
  escape checks it already performs on those paths, before it creates a worktree
  or contacts an adapter. A missing or unreadable prompt file is refused at zero
  provider cost. Do not write the check as a sentence here; the command owns it.
- *"Check you are in the right repository."* **Still open, and routed.** Prose
  cannot prevent a wrong working directory. `awsf start` verifies that the
  attempt's recorded repository is the Git top level it resolves to, which
  catches a moved or nested path — it does not display the resolved canonical
  repository and its HEAD for a human to confirm at a TTY, which is the half
  that catches the *right* repository chosen for the *wrong* task. That half is
  an owner decision between O1 (confirm at the TTY on every `start`) and O2
  (display without confirming), recorded in the plan's Amendments, and it is
  not yours to settle from a cookbook.

`awsf start` also refuses a route whose declared correction rounds its ceiling
cannot fund, and names the `awsf raise` that lifts it. That refusal costs nothing
and leaves the attempt a draft, so the remedy is still available when you read it
— see `choose_the_workflow_and_tier.md`.
