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

## 2. Choose the workflow and the tier

The workflows, their phases and the per-tier call ceilings are defined in
`awsf.config.yaml`, pinned by the recipe tests, and reported by the diagnosis
command. Read them there. This cookbook explains *how to choose*; the CLI
supplies *what exists*, because a number copied here goes stale in silence.

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
npm run awsf -- doctor
```

Findings are evidence, not a chore list. The command has no repair path on
purpose: a stale lock or an orphan process is something the owner decides about,
never something a driving session tidies away before anyone has seen it.

## 4. Launch, then observe

```bash
npm run awsf -- new TASK "the four-line request"
npm run awsf -- start TASK
npm run awsf -- run TASK
```

Report the handle and watch. Do not improvise a status board between the steps;
read state when the next decision needs it, against the task the owner named.

## What is deliberately not in this document

Two checks that look like they belong here are **CLI work wearing a cookbook's
costume**. Writing them as prose would hide a defect behind a paragraph asking a
human to remember, so they are named instead:

- *"Check the configured prompt files exist before you start."* A run invoked
  before its state-root prompt files exist should be refused by the command that
  can detect it at zero cost, using the escape checks that command already
  performs on those paths — not by a sentence here.
- *"Check you are in the right repository."* Prose cannot prevent a wrong
  working directory. A displayed resolved canonical repository and its HEAD,
  confirmed at a TTY, can.

Both cost a real run each, on the record, and both are carried as named backlog
in the plan's Amendments. Until they land they are open defects, not habits this
document has quietly absorbed.
