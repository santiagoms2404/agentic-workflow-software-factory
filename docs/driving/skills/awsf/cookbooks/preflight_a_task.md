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

## 3. Run the diagnosis, then read it

```bash
just awsf doctor
```

Findings are evidence, not a chore list. The command has no repair path on
purpose: a stale lock or an orphan process is something the owner decides about,
never something a driving session tidies away before anyone has seen it.

## 4. Launch, then observe

```bash
just awsf new TASK "the four-line request"
just awsf start TASK
just awsf run TASK
```

Report the handle and watch. Do not improvise a status board between the steps;
read state when the next decision needs it, against the task the owner named.
`run_and_observe.md` takes over from here.

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
