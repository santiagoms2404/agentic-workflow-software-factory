# Ticket set — AWSF v2 W11, the five-stage ladder

This directory is the addressable execution surface for
[`../../awsf-v2-w11-five-stage-ladder.html`](../../awsf-v2-w11-five-stage-ladder.html).
The readable concatenated source is
[`../../awsf-v2-w11-five-stage-ladder-build-prompts.md`](../../awsf-v2-w11-five-stage-ladder-build-prompts.md)
§ Section B. Each ticket's build-prompt body is byte-identical to its Section B block, and the
tickets were **generated from that file rather than transcribed**, so the two cannot drift by hand.

## Frontmatter schema

```yaml
id: T01                 # filename and plan task number, zero-padded
title: "..."            # quoted; exact Section B heading
milestone: M1           # derived from the containing plan phase
state: todo             # todo | wip | done | failed; mirrors plan markers
depends_on: []          # plan dependency chain
serves: [INV-1]         # the plan task's own identifier-spine claims
```

`tier` and `workflow` are omitted: this plan defines neither vocabulary for its own tasks. The
plan-sync fence treats an absent optional field as a legitimate shape and a present-but-wrong one as
the defect, so inventing a taxonomy to fill them would be the error. **`serves` is present on all
twenty tickets** — every task in this workstream either produces evidence for a declaration or
asserts one.

## Derived-field rules

Every field below was derived rather than read off the plan. Edit the rule here rather than
re-deriving it downstream.

- **`milestone`**: M1 for T01–T05, M2 for T06–T09, M3 for T10–T12, M4 for T13–T16, M5 for T17–T19,
  M6 for T20.
- **`depends_on`**: T01 has none. Three rules, in this order of precedence:
  1. **A milestone's final Testing-Strategy task depends on every substantive task in its
     milestone**, not only the immediately preceding one — T05 on [T01–T04], T09 on [T06–T08],
     T12 on [T10, T11], T16 on [T13–T15], T19 on [T17, T18] — because a testing task exercises the
     whole milestone.
  2. **M3 and M4 both branch from M2 and neither depends on the other.** T13 depends on **T09**,
     not on T12. This is the one place the chain forks, it is deliberate, and it is what lets the
     fence work proceed while a misfitting stage blocks part of M3. Reading `n-1` off the task
     numbers here would serialize two independent milestones.
  3. **M5 joins the fork**: T17 depends on **both** T12 and T16. T20 depends on every milestone's
     final task — [T05, T09, T12, T16, T19] — because it certifies the whole workstream.
- **`serves`**: copied from the plan task's own `<code class="serves">` claims. The sync fence's
  MIRROR rule compares the two as sets and fails when they differ, so this field is never edited on
  one side alone.
- **`state`**: mirrors both the containing milestone marker and the task's own checklist. Flip the
  HTML markers and the ticket state in the same commit.

## Five derived rules that live in the work itself, recorded here because each has a wrong answer that produces a plausible result with no error anywhere

These are not frontmatter fields. They are recorded here because each is a decision a later session
would otherwise reconstruct from an assumption that reads as obviously correct and is wrong.

### The stage list is an OUTPUT of T01, never an input to anything

The five stages are enumerated in **no source this workstream is permitted to read**. The spine's
W11 block names the workstream and its constraints and never lists the stages. The intent's W11 row
stops at *"capture pass first, then the governed workflow"*. The fused candidate record names the
ladder six times and enumerates it none — §8 records the gap explicitly as
*"Ladder stage envelopes | Produced once, by hand, as prose"*. The list exists in the frozen
candidate record, which is off limits, and correctly so: a list lifted from frozen prose is exactly
the remembered-prose input the capture-first ordering refuses.

**Consequence for anyone reading a ticket:** every ticket before T02 refers to stages positionally
as S1–S5. `core/test/fixtures/stages/stages.json` is the only place stage names exist, and
`core/src/stages/contract.ts` is joined to it by an equality test rather than by convention. If a
name in the module and a name in the fixture disagree, **the fixture is right** — that is what
T09's induced-drift check exists to enforce.

### The misfit route is a written request, never a patch

If a captured stage output validates against none of the thirteen ids in `ENVELOPE_SCHEMAS`, the
owning workstream is **W05**, which landed every one of them. T04's whole job is to write the
amendment request and stop. The wrong move — and it is a small, helpful-looking one — is to add a
fourteenth entry to `core/src/contracts/registry.ts` so that M2 can proceed. That single edit turns
"adds no new mechanism" from a property into a slogan, and nothing mechanical catches it, because
adding a schema is a legal thing for an agent to do in this repository.

**Per the owner's decision on Q6, taken 2026-08-26, the block is bounded**: only the tasks that
consume the misfitting stage are blocked. M1 finishes, M4's fence proceeds — it depends on no stage
fitting — and M2 declares the fitting stages. Do not stall the workstream, and do not un-stall it by
patching. The accepted cost is that a half-green acceptance may sit in the tree while W05 is
amended; that is visible in the plan's own markers rather than hidden.

### The stop is an absence, and it must never be implemented as a message

`INV-4` says nothing advances a project from one stage to the next. That is a claim about what does
**not** exist in `core/src`, and it is stronger than any state or flag could be: it says nothing is
*capable* of advancing, rather than that nothing currently does.

The plausible wrong implementation is a stopping message, a `stopped: true` field, or a new
lifecycle state — all of which are things that can be added and therefore things that can be
removed. Priced from W08, which has just paid this bill: a new lifecycle state costs one
owner-authored commit into the protected `core/src/state/**`, one migration into the protected
migrations directory, a widened lifecycle matrix, and a whole milestone. **This workstream's stop
costs none of that and asserts more.**

The visible cost is real and Q2's readout is what pays it: an absence is invisible in the
projection, so a stopped project looks identical to a finished one until something *reads* the
journal and says so.

### The fence's third leg is the one that matters, and it is the one that looks cuttable

Legs one and two catch a stage that *asks* for a skill — a slash command in a prompt, an import
reaching the driving tree. Leg three catches a gate that passes **because a document said the right
thing**. That shape names no skill, imports nothing unusual, reads as ordinary evidence-gathering,
and is the only one of the three a well-meaning task in M2 could plausibly introduce.

Measured while authoring: **no test in this repository currently covers a recipe or a gate reaching
for a skill.** `core/test/unit/meta/execution-isolation.test.ts` pins pi's `--no-skills` in exact
argv order and asserts `.claude/` does not exist at the repository root, and its own header states
that `claude-code` has no verified equivalent flag. Both assertions are about the *launch surface*.
Neither says anything about a prompt or a gate. That gap is what M4 closes.

Per Q8, leg three is scoped to this workstream's own gates. Some existing gates legitimately read
the repository — the diff and command-evidence gates do — so a fence over all gates would fail on
day one for a reason that is not a defect. **The limit goes in the test header**, so nobody later
reads a green fence as a claim about all gates.

### Invariant 1 reaches the plan's own mockup, not only the fixtures

The plan's M2 section carries a mockup of the proposed readout. **Every identifier in it is
elided**, because a plan is a committed file and invariant 1 keeps live task and session state out
of every committed file in this repository. The same rule governs the captures: T02 removes session,
attempt and run ids and normalizes every timestamp to one fixed instant — keeping the field, per
Q7, because a stage output whose shape includes a timestamp must keep it to remain a faithful shape
sample.

That normalization is the one edit T02 makes to a capture, and it sits in tension with T01's rule
against tidying. The resolution is written into both: **invariant 1 wins over fidelity**, and each
fixture's header records that the field was touched and why.

## No gate on this ticket set, and that is itself a claim

Unlike W08, this workstream has **no owner-authored commit gate**. `INV-6` asserts the diff touches
no path matched by `policy.protected_paths`, introduces no lifecycle state, no legal edge, no
migration, no catalog field and no envelope schema, and completes with no owner commit. `AC-7`
checks it by enumerating the protected globs **from the loaded config** rather than from a copied
list, so a glob added later is covered without editing the check.

**If a task cannot finish without an owner commit, it has discovered a routed mechanism.** Its first
act is to say so — naming the owning workstream from the plan's routing table — rather than to
widen this workstream to absorb it.

## What no ticket in this set may do

Seven things, each a rule a plausible convenience would break:

1. Read either frozen candidate record (`specs/awsf-v2-candidates.md`,
   `specs/awsf-v2-candidates-GPT-version.md`).
2. Write a stage name that is not in `core/test/fixtures/stages/stages.json`.
3. Add an entry to `ENVELOPE_SCHEMAS`.
4. Write any path matched by `policy.protected_paths` — `awsf.config.yaml`, `awsf.project.yaml`,
   `AGENTS.md`, `core/src/state/**`, `core/src/policy/**`,
   `core/src/observability/migrations/**`, `core/src/execution/transport-broker.ts`.
5. Put a skill, a slash command, or a read-this-document instruction into any stage's prompt or gate.
6. Build any code path that starts one stage because another finished.
7. Let a test touch the network or spend quota.

**And one ordering rule that outranks all seven:** no file under `core/src/stages/` may exist until
M1's fixtures are committed. `AC-1` is observed in the commit record, so adding the fixtures
afterwards does not repair a violation — it only hides it from a reader who does not check `git log`.

## Eight decided Questionables, and which ticket each one reaches

**All eight were decided by the owner on 2026-08-26, and every one took the plan's
recommendation.** They are constraints this ticket set implements. **Nothing in this workstream is
still an open question**, and it waits on no owner commit — see the section above.

| Questionable | Decision | Reaches |
| --- | --- | --- |
| Q1 — the code name | `stages`; no task renames it | T06 onward |
| **Q2 — does W11 add a command** | **read-only `awsf stage`; T08 is committed, not contingent** | T08, T09, T11 |
| Q3 — what an inter-stage stop is addressed to | the absence stands; the readout names the act | T10, T11, T12 |
| Q4 — is a stage a task or phases inside one | mixed, recorded per stage, no default | T01, T06 |
| Q5 — a stage that cannot be run | stated absence; four of five travel | T01, T17 |
| Q6 — misfit blast radius | block only what consumes it | T04 |
| Q7 — fixture home and scrub rule | `core/test/fixtures/stages/`; timestamps normalized, not dropped | T02 |
| Q8 — fence leg three scope | this workstream's gates only; leg three is built | T15 |

**Q2 is the only decision that changed the set.** It promoted T08 from a contingent task to a
committed one, which removed its gate block, made T09's readout test and T11's flag assertion
unconditional, and resolved W12's dependency on W11: this workstream does change a command the
reader will type, and the cheatsheet will document it. Every other decision confirmed the tickets as
generated, so no ticket was added, removed, or resequenced.

## What T01's run found — 2026-08-26

One throwaway project was driven through the ladder in a temporary directory outside this
repository, against W03–W06 as they stand, on the stub route, spending no quota. The working notes
are at **`/tmp/awsf-w11-t01-capture/`** (`NOTES.md` explains the layout and how to re-run the
harness). They are *not* fixtures: they carry session ids, attempt ids, real timestamps and absolute
machine paths, and T02 is the task that scrubs them per Q7 and lands them under
`core/test/fixtures/stages/`.

**The run reached all five stages and published.** No stage needed Q5's stated-absence treatment.

### The five stages, as observed

| # | id | owner | producer | granularity | output came from | exit stop |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `init` | host | `awsf init` | command | host | the command returns |
| 2 | `project-register` | host | `awsf project register` | command | host | the command returns |
| 3 | `design-to-plan` | host + 3 roles | `design-to-plan` (workflow id) | task, 7 phases | host **and** agents | `AWAITING_OWNER` |
| 4 | `build` | host + 2 roles | `plan-build-test` (workflow id) | task, 4 phases | host **and** agents | `AWAITING_OWNER` |
| 5 | `publish` | host | `awsf publish` | command | host | `PUBLISHED` |

The counting rule is recorded in `stages.observed.json` and stated here because it is a judgement
and not a reading: **one entry per producer of durable project state that the owner starts by hand
and that stops when it returns.** `awsf land` is deliberately *not* a stage — it is the owner act
that crosses the `AWAITING_OWNER` stop the producing stage ended at. Count `awsf land` as a stage
and the ladder has seven entries, not five.

### Six things the run disagrees with, or that the plan's field vocabulary cannot hold

1. **`granularity` needs a third value, and Q4 already said so.** The plan's field spec says
   `task` or `phase`. Three of the five stages are neither: `awsf init`, `awsf project register`
   and `awsf publish` run with no task, no session row and no attempt directory in existence.
   Q4's own decision text anticipated this — *"Three different granularities across five stages is
   an expected result and must not be smoothed"* — so the run and the decision agree and only the
   two-value field spec is short. Recorded as `command`. **`phase` was not observed at all**: no
   stage in this ladder is a set of phases sharing a task with another stage.
2. **`owner` cannot be one value for a task stage.** Stage 3 has four owners across seven phases
   (`host`, `designer`, `architecture-reviewer`, `planner`) and stage 4 has three across four
   (`host`, `planner`, `builder`). The captures carry a `phaseOwners` list beside the single-value
   field; T06 needs to decide whether the contract carries one owner or the list.
3. **Three of the five stages emit no envelope at all.** Only stages 3 and 4 produce anything in
   `ENVELOPE_SCHEMAS`. Stages 1, 2 and 5 produce a stdout line and a command return value. T03
   therefore measured three explicit misfits. T04 routes them to W05 under `INV-2`, even though the
   missing type is a host-command envelope rather than another workflow-phase envelope. W11 does
   not invent or register that envelope.
4. **Two of the four boundaries are crossed by hand-editing a file, not by a command.** `awsf init`
   writes only `awsf.config.yaml`; no command in `CLI_COMMANDS` produces an `awsf.project.yaml`, so
   the owner authors and commits the catalog between stages 1 and 2. And the configuration
   `awsf init` writes enables only `intake`, declares zero agents and names no adapter any later
   stage can reach, so the owner replaces it and supplies the role prompts between stages 2 and 3.
   Both files are protected paths in the configuration this repository ships.
5. **`awsf init` creates the branch `master`.** `initCommand` runs `git init` with no `-b`, so the
   default branch is whatever the machine's Git is configured for. Every later stage reads
   `default_branch` from the catalog the owner wrote, so a catalog saying `main` against a
   repository on `master` is a mismatch the owner has to notice.
6. **The owner-typed `awsf run` cannot reach the stub route.** Measured:
   `ProductionRouteUnavailable: configured adapter "stub" is unavailable: adapter kind has no
   production binding`. `adapters.stub` is `kind: fixture`, which `registeredAdapter` answers with
   `null` on purpose, so a zero-quota capture is only reachable by injecting `adapterFor` through
   `runProductionCommand`'s `infrastructure` seam. The capture did that; **M5's journey must too.**

### Entry preconditions, measured by removing them

Each was measured rather than read off the code. Full transcripts in `raw/PROBES-*.json`.

| Stage | Precondition removed | What the run did |
| --- | --- | --- |
| 1 | target directory not empty | `InitTargetNotEmptyError`, nothing written |
| 2 | no `awsf.project.yaml` authored | exit 1, `ENOENT … awsf.project.yaml` |
| 3 | no placement from stage 2 | `BLOCKED` at `design-context`, **0 calls spent**, `ENOENT … placement.yaml` |
| 3 | `workflows.enabled` omits `design-to-plan` | `awsf new` **accepts it**; `awsf start` refuses: *"workflow design-to-plan is not enabled by …"* |
| 3 | attempt worktree outside the resolved `worktreeRoot` | `BLOCKED` at `design_evidence_present`, 0 calls spent (capture generation `g2`) |
| 5 | attempt not `LANDED` | throws `TerminalAttempt` before any Git process is spawned |

The `awsf new` / `awsf start` split in row four is worth carrying into T08: `awsf new` records a
workflow the configuration does not enable, and the refusal arrives one command later.

### Two measurements T02 and T19 will want

- **One task's journal is 793,310 bytes across 101 lines.** 474,094 of those bytes — 59.8% — are
  repeated copies of `configSnapshotJson`, because every `attempt.updated` event embeds the whole
  `AttemptStatus`. The stage-3 capture file is 988 KB almost entirely for this reason. If the
  fixtures are to stay readable, the journal is the part to summarize rather than carry.
- **The `tests` phase passed with zero commands.** With `gates: {}` in both the config and the
  catalog, `tests-0.json` reads `"summary":"all configured commands passed"` with
  `"commands":[]`. A stage-4 fixture taken from a project with no configured gates records a
  vacuous pass, and any test written against it must not read that field as evidence a suite ran.

## T03/T04 result — three schema misfits routed to W05

`core/test/fixtures/stages/schema-fit.json` was measured with `parse-envelope.ts` against every one
of the thirteen landed schema ids. S3 fits `awsf.document-output/v1` and S4 fits
`awsf.test-output/v1`. S1, S2 and S5 fit none. The routed block is named
**`W05-HOST-COMMAND-ENVELOPES`**.

| Stage | Output no landed schema holds | Closest id and exact violation groups | W05 amendment request |
| --- | --- | --- | --- |
| S1 `init` | `kind`, printed `line`, `commitSha`, initialized `path` | `awsf.design-context/v1`, tied at 16 violations with `awsf.scout-output/v1` and `awsf.intake-output/v1`; missing-required and type/literal violations at `/schema`, `/producerStatus`, `/summary`, `/artifacts`, `/notesForNextPhase`, `/targets`; unexpected properties `/kind`, `/line`, `/commitSha`, `/path` | Add and register `awsf.init-output/v1` with the common envelope fields and those four command-result fields, then bind `awsf init` to emit it losslessly. |
| S2 `project-register` | `kind`, printed `line`, returned `resolvedProject`, exact `placementFileBytes` | the same closest-id tie, 16 total, and six missing/type pairs as S1; unexpected properties `/kind`, `/line`, `/resolvedProject`, `/placementFileBytes` | Add and register `awsf.project-register-output/v1` carrying the returned project and placement bytes plus the common envelope fields, then bind `awsf project register` to emit it losslessly. |
| S5 `publish` | `kind`, full `terminalLines`, structured `result`, exact `finalStatusBytes` | the same closest-id tie, 16 total, and six missing/type pairs as S1; unexpected properties `/kind`, `/terminalLines`, `/result`, `/finalStatusBytes` | Add and register `awsf.publish-output/v1` carrying the display, result and final-status bytes plus the common envelope fields, then bind `awsf publish` to emit it losslessly. |

Per Q6, only **T18**, which requires a stored typed envelope at every boundary, is failed under this
block. T05, M2, M3, M4 and T17 continue. T06 already represents a misfitting stage with no
`schemaId`, so it does not force-fit one. Within T18, the route-log assertion remains unblocked.
No file under `core/src/contracts/` was edited.

## Shared read-first set

Every fresh session reads `AGENTS.md`, the named task and containing milestone in the HTML plan, and
the source files its own prompt names. `CLAUDE.md`, `docs/TESTING.md` and `docs/UI_REVIEW.md` do not
exist in this repository and must not be invented to satisfy a template.

## Sync rule

`core/test/unit/meta/ticket-plan-sync.test.ts` resolves this plan through the registered plan source
and checks task coverage, milestone, marker and checklist state, title, dependency ordering, exact
Section B prompt bytes, and the identifier-spine COVERAGE / ORPHANS / MIRROR rules. The HTML plan is
the status source of truth.

## T19 verification record — 2026-08-26

- `node --experimental-strip-types --test core/test/journeys/five-stage.test.ts`: 3/3 passed in
  47.83 seconds. The end-to-end journey took 16.09 seconds.
- `npm run test:journeys`: 107/107 passed in 200.14 seconds.
- `npm run test`: 1,718/1,718 passed in 681.02 seconds wall time: unit 1,488, contract 53,
  simulation 70, journeys 107.
