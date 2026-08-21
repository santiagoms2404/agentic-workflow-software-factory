# Build Prompts — AWSF v2 W03, awsf init

Companion to [`awsf-v2-w03-awsf-init.html`](./awsf-v2-w03-awsf-init.html). Created 2026-08-21
alongside the plan and [`tickets/awsf-v2-w03-awsf-init/`](./tickets/awsf-v2-w03-awsf-init/).

**These prompts write implementation code.** This is the deep plan for workstream W03, and these
nine prompts build it, one task at a time.

Each prompt is **self-contained** and written for a **fresh session with no prior context**. Copy
one, paste it, let it run to completion, review what it produced, clear context, move to the next.

---

## Why there is no Section A

This plan's three milestones hold nine tasks, and every milestone-level instruction that would go
in a Section A prompt — the marker rule, the read-first set, the never-do list — is identical
across all nine. Stating it once in **Conventions** below and once per prompt is enough. **Section
B is the whole file.**

---

## Before anything: two gates

1. **Owner approval of this deep plan.** The owner has read `specs/awsf-v2-w03-awsf-init.html` —
   especially its **six Questionables** — and approved it, or has resolved them via an exported
   `plan-sota-review v1` block applied before task 1 begins. **A decided Questionable is a
   constraint, not an assignment** — the prompts below hand each one to its task as something to
   apply. Where a Questionable is still undecided when a task starts, that task proceeds on the
   plan's stated recommendation and the ticket's `state` stays `todo` rather than `done` until the
   owner confirms it — do not silently treat a recommendation as a decision in the ticket's own
   bookkeeping.
2. **The fixture in the plan's "What Was Measured" section has been read.** It is real, quoted
   output, not a description — the sequence T04/T05 implement was already run by hand once, in a
   throwaway temporary directory, before this plan was authored.

---

## Decisions this plan already made — do not re-litigate these

| # | Decision | Status |
|---|---|---|
| D1 | **Baseline first, plan as a later governed output.** `awsf init` never produces a plan, a design, or a ticket — that is W05's job, running later against the repository this command creates. | settled — spine W03 scope |
| D2 | **No provider is contacted at any point.** Mechanically proven by T08's import-graph fence, not merely asserted. | settled — spine W03 scope |
| D3 | **The config is built as a typed object and round-tripped through the real loader**, never hand-written YAML trusted on faith. | derived in this plan — see Solution |
| D4 | **`git init` goes through `systemGitRunner`/`runSystemCommand`**, the one file allowed to import `node:child_process` — no new call site. | settled — AGENTS.md invariant 3 |
| D5 | **The baseline commit reuses `commitAsHost`/`HOST_AUTHOR`** from `core/src/git/commit.ts`, proven in this plan's fixture to work against a repository with no prior `HEAD`. | measured 2026-08-21 |
| D6 | **Invariant 11's mechanical fence (`no-agent-coauthor.test.ts`) has no jurisdiction over a target-project repository `awsf init` creates elsewhere** — the guarantee is upheld by construction (D5), and proven directly by T05's own integration test. | settled — see Questionable Q3 |

---

## Model selection

`EFFORT` is the session-level reasoning control (`/effort low|medium|high|xhigh|max`), calibrated
to the hardest judgement in the task. No prompt in this file fans out to sub-agents — every task is
small enough for one session.

---

## Conventions used by every prompt

- **Read first**, always: `specs/awsf-v2-w03-awsf-init.html` (the named milestone/task in full),
  `AGENTS.md` (all twelve invariants), and whatever source files that task's own `READ FIRST` names.
- **Marker discipline**: flip this plan's own checklist items and milestone `<h3>` to `[wip]` on
  start and `[x]` on completion, in `specs/awsf-v2-w03-awsf-init.html`. Flip the matching
  `specs/tickets/awsf-v2-w03-awsf-init/T<nn>.md`'s `state:` in the same commit. **Never** touch
  `specs/awsf-v2-plan.html`'s W03 marker — task 9 is the only task that does.
- **Never do**: write implementation code beyond what the task names, add a dependency outside the
  D2-allowlist (AGENTS.md invariant 7), add a new `node:child_process` import site, let `init.ts` or
  `init-template.ts` import anything under `core/src/adapters/`, `core/src/workflow/`, or
  `core/src/gates/`.

---

# Section B — Task prompts (recommended)

Nine prompts, one per task, in plan order — ticket number equals the plan's own task number
exactly. Tasks 1–3 are milestone M1, 4–5 are M2, 6–9 are M3 (task 9 is the plan's single combined
"full suite, marker flips, and the spine's W03 marker" task). The ticket for each is
`specs/tickets/awsf-v2-w03-awsf-init/T<nn>.md`, carrying the same prompt verbatim.

### T01 — Enumerate the schema's minimal shape

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  WHY     mechanical enumeration against a fixed schema, no design judgment.

TASK 1 of 9. Plan: specs/awsf-v2-w03-awsf-init.html, milestone M1.
PREDECESSORS: none. This is the first task.

READ FIRST
  specs/awsf-v2-w03-awsf-init.html - Milestone M1 task 1 in full
  core/src/config/schema.ts - in full
  core/src/config/load.ts - in full, the hand-written rejections beyond TypeBox structure
  core/src/state/tiers.ts - MIN_CALL_CEILING / MAX_CALL_CEILING

DO
  Enumerate, for each of AwsfConfigSchema's twelve top-level keys, the smallest value that
  satisfies both the TypeBox structure and load.ts's hand-written checks. Write the table as
  code comments beside where buildMinimalConfig will live (T02 implements it against this
  table). Honor these locked decisions: exactly one adapter, kind "claude-code", enabled
  true; workflows.enabled: ["intake"], matching project.default_workflow; agents: [];
  gates: {}; pricing.models: {}; call-ceiling values referencing MIN_CALL_CEILING /
  MAX_CALL_CEILING, never repeated as new literals.

DO NOT
  Write buildMinimalConfig itself, or any other implementation code. This task is the
  enumeration only - T02 implements against it.

DEFINITION OF DONE
  The plan's task 1 checklist, every box.
  Flip task 1's checklist boxes and milestone M1 to [wip] in
  specs/awsf-v2-w03-awsf-init.html, and T01.md's state to wip then done in the same commit.
  Do NOT touch specs/awsf-v2-plan.html.
```

### T02 — Implement buildMinimalConfig as a typed object

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  WHY     a typed object construction against a table already decided.

TASK 2 of 9. Plan: specs/awsf-v2-w03-awsf-init.html, milestone M1.
PREDECESSORS: T01 (its enumeration table).

READ FIRST
  specs/awsf-v2-w03-awsf-init.html - Milestone M1 task 2 in full
  T01's enumeration output
  core/src/config/schema.ts

DO
  Implement core/src/config/init-template.ts exporting
  buildMinimalConfig(slug: string): AwsfConfig - a pure, typed object construction (typed
  against Static<typeof AwsfConfigSchema>), no I/O, no YAML serialization inside the
  function itself. Reject an invalid slug inside the function with a clear, named error,
  before loadConfig ever runs.

DO NOT
  Write the test for this function - T03 carries the Testing Strategy for this milestone.

DEFINITION OF DONE
  The plan's task 2 checklist, every box.
  Flip task 2's checklist boxes in specs/awsf-v2-w03-awsf-init.html, and T02.md's state to
  done in the same commit. Do NOT touch specs/awsf-v2-plan.html.
```

### T03 — Testing Strategy for buildMinimalConfig

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  WHY     a round-trip test against an existing loader, plus the compiler check.

TASK 3 of 9. Plan: specs/awsf-v2-w03-awsf-init.html, milestone M1.
PREDECESSORS: T02 (buildMinimalConfig).

READ FIRST
  specs/awsf-v2-w03-awsf-init.html - Milestone M1 task 3 in full, and the "What Was
    Measured" section (the fixture's real output)
  T02's implementation
  core/src/config/load.ts

DO
  Write core/test/unit/config/init-template.test.ts: round-trip proof
  (buildMinimalConfig -> stringify with the yaml package -> loadConfig -> deepEqual) for at
  least two valid slugs; an invalid-slug rejection test confirming the rejection originates
  in buildMinimalConfig, not downstream; an assertion that ceiling values equal the imported
  MIN_CALL_CEILING/MAX_CALL_CEILING constants rather than duplicated literals.

DEFINITION OF DONE
  node --experimental-strip-types --test core/test/unit/config/init-template.test.ts -> green
  npm run typecheck -> clean
  Flip task 3's checklist boxes and milestone M1 to [x] in specs/awsf-v2-w03-awsf-init.html,
  and T03.md's state to done in the same commit. Do NOT touch specs/awsf-v2-plan.html.
```

### T04 — initCommand: directory, git init, config write, baseline commit

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     sequencing four host operations correctly, including the precondition that
          keeps commitAsHost's `git add --all` from sweeping unrelated files into the
          baseline commit, deserves careful reasoning rather than a mechanical pass.

TASK 4 of 9. Plan: specs/awsf-v2-w03-awsf-init.html, milestone M2.
PREDECESSORS: T03 (Milestone M1 complete, buildMinimalConfig proven).

READ FIRST
  specs/awsf-v2-w03-awsf-init.html - Milestone M2 task 4 in full, and Questionables Q1, Q2,
    Q5, Q6 (confirm their decided verdicts, or proceed on the stated recommendation if
    still open)
  core/src/git/commit.ts
  core/src/git/changes.ts - systemGitRunner, runGit
  the "What Was Measured" section's fixture output

DO
  Implement core/src/cli/commands/init.ts exporting initCommand({ path, slug }):
    1. Precondition - refuse if `path` exists and is non-empty (Q2), before any filesystem
       mutation beyond the existence check itself.
    2. mkdir recursive if `path` is absent.
    3. git init via systemGitRunner(path) / runGit() - reuse the existing helper, no new
       child_process import site anywhere in this file.
    4. buildMinimalConfig(slug), serialized, written to <path>/awsf.config.yaml.
    5. commitAsHost({ repository: path, message: "chore: awsf init baseline" }) (Q5's
       fixed message).
    6. Return the produced commit SHA and resolved path.

DO NOT
  Write a README or any file beyond the config - the plan's fixture already proved the
  config alone is sufficient for a non-empty commit.

DEFINITION OF DONE
  The plan's task 4 checklist, every box (implementation only - T05 carries the test).
  Flip task 4's checklist boxes in specs/awsf-v2-w03-awsf-init.html, and T04.md's state to
  done in the same commit. Do NOT touch specs/awsf-v2-plan.html.
```

### T05 — Testing Strategy for initCommand

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  WHY     a temp-directory integration test against an already-implemented command.

TASK 5 of 9. Plan: specs/awsf-v2-w03-awsf-init.html, milestone M2.
PREDECESSORS: T04 (initCommand).

READ FIRST
  specs/awsf-v2-w03-awsf-init.html - Milestone M2 task 5 in full
  T04's implementation

DO
  Write core/test/unit/cli/init-command.test.ts. Cover, per the plan's own checklist:
  happy path against a fresh empty temp directory with commit-count, author/committer, and
  clean-tree assertions; the refusal case against a non-empty target, proving refusal
  happens before any git init or commit and the pre-existing file is untouched; the re-run
  refusal case (a .git-holding directory is non-empty); guaranteed cleanup of every temp
  directory the test creates.

DEFINITION OF DONE
  node --experimental-strip-types --test core/test/unit/cli/init-command.test.ts -> green
  Flip task 5's checklist boxes and milestone M2 to [x] in specs/awsf-v2-w03-awsf-init.html,
  and T05.md's state to done in the same commit. Do NOT touch specs/awsf-v2-plan.html.
```

### T06 — Wire init into core/src/cli/main.ts

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  WHY     CLI dispatch wiring against an existing, well-understood file.

TASK 6 of 9. Plan: specs/awsf-v2-w03-awsf-init.html, milestone M3.
PREDECESSORS: T05 (Milestone M2 complete).

READ FIRST
  specs/awsf-v2-w03-awsf-init.html - Milestone M3 task 6 in full
  core/src/cli/main.ts - in full; note where the generic configPath/loadConfig section
    falls, and why `init` must be handled strictly before it
  T04's initCommand signature

DO
  Add "init" to the frozen CLI_COMMANDS array. Add a new top-level branch in main() for
  init, positioned before the generic config-load section, that parses arguments per Q1's
  decided/recommended shape (a path argument defaulting to cwd, plus the project slug),
  calls initCommand, and reports the resulting commit SHA and path via out(...). Update
  USAGE.

DEFINITION OF DONE
  The branch compiles and a manual smoke invocation produces a commit exactly like the
  fixture in the plan's "What Was Measured" section.
  Flip task 6's checklist boxes in specs/awsf-v2-w03-awsf-init.html, and T06.md's state to
  done in the same commit. Do NOT touch specs/awsf-v2-plan.html.
```

### T07 — Close the documentation-reconciliation fence

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Haiku 4.5 · EFFORT low
  CLAUDE  claude:haiku · /effort low
  GPT     codex:gpt-5.6-terra · reasoning low
  WHY     a one-line documentation addition and a fence run.

TASK 7 of 9. Plan: specs/awsf-v2-w03-awsf-init.html, milestone M3.
PREDECESSORS: T06 (init reachable from the CLI).

READ FIRST
  specs/awsf-v2-w03-awsf-init.html - Milestone M3 task 7
  core/test/unit/meta/doc-reconciliation.test.ts - in full
  README.md

DO
  Add one documented invocation of `awsf init` to README.md, in whatever section already
  documents the other CLI commands.

DEFINITION OF DONE
  node --experimental-strip-types --test core/test/unit/meta/doc-reconciliation.test.ts
  -> green
  Flip task 7's checklist boxes in specs/awsf-v2-w03-awsf-init.html, and T07.md's state to
  done in the same commit. Do NOT touch specs/awsf-v2-plan.html.
```

### T08 — The no-provider import-graph fence

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     a static import-graph walker is exactly the kind of meta-test that is silently
          vacuous if written carelessly; get the walk and the allowlist right and prove
          the fence actually bites.

TASK 8 of 9. Plan: specs/awsf-v2-w03-awsf-init.html, milestone M3.
PREDECESSORS: T07 (documentation fence green).

READ FIRST
  specs/awsf-v2-w03-awsf-init.html - Milestone M3 task 8 in full, the card explaining what
    this fence proves and does not prove
  an existing tree-scoped meta-test for the walking pattern this repository already uses
    (e.g. core/test/unit/meta/child-process-fence.test.ts or core/test/unit/meta/_walk.ts)
  core/src/cli/commands/init.ts
  core/src/config/init-template.ts

DO
  Write core/test/unit/meta/init-no-provider.test.ts: walk the static import graph starting
  from core/src/cli/commands/init.ts and core/src/config/init-template.ts, and assert every
  reachable module matches a small, commented allowlist (config, git,
  execution/transport-broker, Node builtins, the yaml package) that contains nothing under
  core/src/adapters/, nothing under core/src/workflow/, and nothing under core/src/gates/.
  Prove the fence bites: temporarily add a scratch import of an adapter module to init.ts,
  confirm the test goes red, then discard the scratch import.

DEFINITION OF DONE
  node --experimental-strip-types --test core/test/unit/meta/init-no-provider.test.ts
  -> green, over the real (non-scratch) tree
  Flip task 8's checklist boxes in specs/awsf-v2-w03-awsf-init.html, and T08.md's state to
  done in the same commit. Do NOT touch specs/awsf-v2-plan.html.
```

### T09 — Full suite, marker flips, and the spine's W03 marker

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  WHY     running three already-defined gates, then a bookkeeping pass that is the ONLY
          task in this whole build sequence permitted to touch the spine file.

TASK 9 of 9. Plan: specs/awsf-v2-w03-awsf-init.html, milestone M3.
PREDECESSORS: T08 (the no-provider fence green).

READ FIRST
  specs/awsf-v2-w03-awsf-init.html - Milestone M3 task 9 in full, and the Implementation
    Phases intro (the "Two marker sets" card)
  specs/awsf-v2-plan.html - Milestone M3 / W03 block

DO
  Run, in order, fixing any failure before proceeding to the next:
    npm run test:unit    (whole suite, no count regression against the pre-work baseline)
    npm run typecheck
    npm run lint
  Then verify every checklist item and every milestone <h3> in
  specs/awsf-v2-w03-awsf-init.html reads [x], and every file in
  specs/tickets/awsf-v2-w03-awsf-init/ reads state: done. Only then, in the same commit,
  flip specs/awsf-v2-plan.html's Milestone M3 / W03 <h3> status marker to [x] - this is the
  one and only task in this whole build sequence permitted to touch that file. Add an
  Amendment entry to specs/awsf-v2-w03-awsf-init.html's #amendments section naming the
  commit SHA and date this workstream landed.

DEFINITION OF DONE
  All three commands green. specs/awsf-v2-plan.html's W03 marker reads [x], and
  specs/awsf-v2-w03-awsf-init.html carries a matching Amendment entry, both in the same
  commit. Flip task 9's checklist boxes and milestone M3 to [x] in
  specs/awsf-v2-w03-awsf-init.html, and T09.md's state to done, all in the same commit.
```
