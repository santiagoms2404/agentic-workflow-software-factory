# /prime-awsf

Orient a driving session in AWSF — the tier above the factory, where the owner
decides what to ask for, prepares it, launches it, watches it, and reads what
came back.

Read the following in this order. Each is the source of truth for what it
covers, and nothing here restates any of it: a copy is a second source of truth
that goes wrong quietly.

1. `../skills/awsf/SKILL.md` — **the judgment layer, and the entry
   point this command exists to serve.** It carries the posture, the hard rules,
   and the routes table that says which cookbook answers which request. Read its
   table now; read the cookbook a request calls for when the request arrives,
   and no more. Everything below is a source that table points at.

   This is first for a reason that was learned the expensive way: the skill said
   *"run `/prime-awsf` first"* while this command never pointed back, so a
   session primed from the cheatsheet knew every source of truth and none of the
   judgment for using them — including the preflight that resolves a request
   against the repository before a call is reserved. A pointer that goes one way
   is how a driving session arrives well-read and unprepared.
2. `AGENTS.md` — the invariants a session working *on* this repository may not
   break. Invariant 1 is the one that shapes this command: no committed file
   ever encodes which task, attempt or session is running.
3. **The lifecycle contract** — `core/src/state/task-machine.ts` for the task
   states, the legal edges and the ordered rejection contract;
   `core/src/state/guards.ts` for the evidence each edge demands;
   `core/src/state/tiers.ts` for the risk tiers and their call ceilings. The
   numbers live there and only there.
4. **The phase submachine and the escalation ladder** —
   `core/src/state/phase-machine.ts` for what happens inside an executing state,
   and `core/src/workflow/` for the recipes, the correction allowance, and the
   escalation from a failed gate to a counted state transition.
5. `awsf.config.yaml` — the only committed tuning surface: adapters, routing,
   the per-agent model/prompt/harness/tools dial, workflows, gates, risk,
   policy, observability. `core/src/config/schema.ts` is what validates it.
6. **The state-root layout** — `core/src/persistence/platform-paths.ts` resolves
   where durable state lives per platform and names every file inside an attempt
   directory. `private/` is one of them and is never opened; see the skill's
   hard rules.
7. `specs/awsf-plan.html` — the plan, its status markers, and its Amendments,
   which are where measured traps and past decisions are recorded.

## Preflight

Confirm the toolchain before driving anything, rather than after:

```bash
npm install
npm test
npm run lint
just awsf doctor
```

The diagnosis command is read-only by construction and has no repair path — a
finding is evidence for the owner, never permission to alter an attempt.

## Then stop

Priming ends here. **Do not print a status board.** Volunteered state is guessed
state: it is stale on arrival, because state printed before the request
describes a system the very next run changes, and probing to look prepared is
how a session ends up confidently wrong in its first message.

There is a second reason, specific to this repository. A command that opened
with a live status board would be one edit away from a committed file encoding
which attempt is running — `AGENTS.md` invariant 1, breached by the document
meant to teach it. State is read when a request needs it, against the task the
owner names, and it stays out of every file here.
