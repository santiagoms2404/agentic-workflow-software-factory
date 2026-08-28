# Ticket set — AWSF v2 W12, the non-technical cheatsheet

This directory is the addressable execution surface for
[`../../awsf-v2-w12-cheatsheet.html`](../../awsf-v2-w12-cheatsheet.html).
The readable concatenated source is
[`../../awsf-v2-w12-cheatsheet-build-prompts.md`](../../awsf-v2-w12-cheatsheet-build-prompts.md)
§ Section B. Each ticket's build-prompt body is byte-identical to its Section B block, and the
tickets were **generated from that file rather than transcribed**, so the two cannot drift by hand.

**This directory is also where this workstream's evidence lives.** The friction log from M1 and the
two graduation records from M5 are recorded here, the way W11 recorded its capture findings, because
`AGENTS.md` invariant 10 permits no committed report, receipt or manifest file. Both sections below
are empty at authoring time.

**Revised twice on 2026-08-27, after two owner reviews.** The first decided eight Questionables and
grew the workstream from sixteen tasks in five milestones to twenty-two in six. The second decided
the last four, dissolved the thirteenth, **removed a renderer and a markdown twin**, and added a
second graduation run — twenty-three tasks in six milestones. The plan's Amendments record both.

## Gates before execution

1. **Twelve Questionables are decided and one is dissolved. Nothing here is still open**, and this
   workstream waits on no owner commit. Do not re-litigate a decision; if one looks wrong from
   inside the work, that is an Amendment for the owner.
2. **The four decisions that shape the most work:**
   - **Q10 — `docs/cheatsheet.html` is the only authored file.** No markdown twin, no renderer,
     nothing generated. One file cannot drift from itself.
   - **Q11 — every fact class is bound to its source by set equality, in both directions.** A class
     with no extractable source is not documented at all.
   - **Q5 — commands in prose are exempt**, and the document's up-front warning that the reader does
     not type them is what pays for the exemption. The warning is therefore asserted.
   - **Q12 — one small reproducible task in the written example; two real tasks in the graduation**,
     and the delta in consultations between the runs is evidence.
3. **W03, W07, W08 and W11 must all read `[x]` in `specs/awsf-v2-plan.html`.** All four were `[x]`
   on 2026-08-27. T01 re-confirms.
4. **There is no owner-authored commit gate.** The diff touches no path matched by
   `policy.protected_paths` — `awsf.config.yaml`, `awsf.project.yaml`, `AGENTS.md`,
   `core/src/state/**`, `core/src/policy/**`, `core/src/observability/migrations/**`,
   `core/src/execution/transport-broker.ts`. A task that cannot finish without one has discovered a
   routed mechanism: say so, name the owning workstream, and do not widen.
5. `CLAUDE.md`, `docs/TESTING.md` and `docs/UI_REVIEW.md` do not exist in this repository and must
   not be invented to satisfy a template.

## Frontmatter schema

```yaml
id: T01                 # filename and plan task number, zero-padded
title: "..."            # quoted; exact Section B heading
milestone: M1           # derived from the containing plan phase
state: todo             # todo | wip | done | failed; mirrors plan markers
depends_on: []          # plan dependency chain, including the declared fork
serves: [AC-1]          # the plan task's own identifier-spine claims
```

`tier` and `workflow` are omitted: this plan defines neither vocabulary for its own tasks. The
plan-sync fence treats an absent optional field as a legitimate shape and a present-but-wrong one as
the defect. **`serves` is present on all twenty-three tickets.**

## Derived-field rules

Every field below was derived rather than read off the plan. Edit the rule here rather than
re-deriving it downstream.

- **`milestone`**: M1 for T01–T04, M2 for T05–T10, M3 for T11–T15, M4 for T16–T18, M5 for T19–T22,
  M6 for T23.
- **`depends_on`**: five rules, in this order of precedence.
  1. **M1 and M2 are independent, and neither waits on the other.** `T05.depends_on` is **`[]`**,
     not `[T04]`. M1 needs the owner present; M2 needs nobody. **Reading `n-1` off the task numbers
     here would serialize two independent milestones** — the same mistake W11's ticket README had to
     write down for its own fork.
  2. **M3 is the join.** T11 depends on **both** T04 and T10: the document needs the friction log
     and the fences.
  3. **Two sibling pairs branch and neither depends on the other.** T06 (the fact classes) and T07
     (the command and warning fences) both depend on T05 and are independent — they share an
     extractor and nothing else. T13 (the hard legs) and T14 (the boundaries) both depend on T12 and
     touch different parts of the document.
  4. **One dependency is a file, not a logic.** `T08.depends_on` is `[T07]` because both edit
     `cheatsheet-reconciliation.test.ts`, and serializing them avoids two sessions writing one file.
     Their assertions are unrelated. This is recorded so nobody later "corrects" it into a logical
     dependency that does not exist.
  5. **A milestone's final Testing-Strategy task depends on every substantive task in its
     milestone** — T04 on [T01–T03], T10 on [T05–T09], T15 on [T11–T14], T18 on [T16, T17], T22 on
     [T19–T21]. **T23 depends on every milestone's final task** — [T04, T10, T15, T18, T22] —
     because it certifies the whole workstream and closes the spine.
- **`serves`**: copied from the plan task's own `<code class="serves">` claims. The sync fence's
  MIRROR rule compares the two as sets, so this field is never edited on one side alone.
- **`state`**: mirrors both the containing milestone marker and the task's own checklist. Flip the
  HTML markers and the ticket state in the same commit.

## Execution order

```
T01 → T02 → T03 → T04                       M1 · friction log (the owner drives, no document)
T05 → { T06, T07 } → T08 → T09 → T10        M2 · the fences (starts from nothing, parallel with M1)
        ↘                          ↙
          T11 → T12 → { T13, T14 } → T15    M3 · the shell and the walkthrough half (the join)
                      ↓
              T16 → T17 → T18               M4 · the reference half and the figures
                      ↓
          T19 → T20 → T21 → T22             M5 · two graduation runs (they spend quota)
                      ↓
                     T23                    M6 · close the leaf, the spine, and hand over
```

## Frozen observation protocol

This protocol is committed before the first drive. It controls what the driver observes and records;
it supplies no answer about how the factory works.

### The six legs

1. **Install.** Achieve a ready copy of this checkout on the machine: the supported toolchain is
   available, the repository dependencies are installed, and the repository's own verification
   completes successfully.
2. **Prime.** Achieve an oriented marimba driving session: it has loaded the factory's governing
   sources in their prescribed order, completed its toolchain preflight, and stopped without
   volunteering a live status board.
3. **Ask marimba for one job.** Achieve one launched job from an ordinary-language description of
   the desired result and acceptance boundary. Let marimba prepare the request and choose the
   configured route; do not tell it which command to type.
4. **Watch it.** Achieve a clear account of the job's progress and current outcome through the
   factory's read-only observation surfaces, including the task, attempt, lifecycle state, and calls
   spent against the ceiling.
5. **Read a refusal.** Achieve an explanation of one genuine refusal: what the factory refused, the
   unmet precondition or missing evidence it named, and which owner decision is now available. Do
   not route around the refusal.
6. **Stop at an owner act with its evidence.** Achieve the final handoff at the act only the owner
   may perform, with the candidate and all evidence required for that act identified. Stop without
   performing or authorising the act.

### What becomes an entry

There are two entry classes:

1. **Consultation.** Record any consultation of a source other than the document in order to
   proceed. This includes the source tree, a plan, a previous transcript, the dashboard when it is
   used as a substitute for an explanation, and unaided memory of how the factory works. The entry
   is required even when the driver already knows the answer and is only confirming it.
2. **Expectation mismatch.** Record anything that behaves differently from what the driver
   expected, even when the driver already knows why it behaved that way.

Number entries in occurrence order. For every consultation, record the consulted source, the
question it answered, and the leg and exact point within that leg where it happened. For every
expectation mismatch, record the expected behaviour, the observed behaviour, and the leg and exact
point where they diverged. If one occurrence belongs to both classes, record both entries. Record
observations only, not a diagnosis and not a fix.

### Limit and unchanged re-use

An author-driven run cannot prove that the document is comprehensible to somebody new. It can prove
only that the document is sufficient to drive with. No later task may report the stronger claim.

This same protocol runs unchanged twice in M5. Its entry classes, six legs, and recording fields may
not be adjusted before or between those runs. Changing the protocol makes the consultation delta
between the two runs meaningless.

## Seven derived rules that live in the work itself, recorded here because each has a wrong answer that produces a plausible result with no error anywhere

These are not frontmatter fields. Each is a decision a later session would otherwise reconstruct from
an assumption that reads as obviously correct and is wrong.

### "Document everything" is only buildable because it was turned into set equality

The owner asked the document to cover what marimba invokes, the lifecycles, every gate, and what
happens across a full session — and asked for it to be complete. **Taken as a writing instruction
that is the shape the spine rejected**, and this project's own evidence says it would be wrong within
one workstream.

It became buildable by turning it into a **set-equality property over six named, extractable
classes**. An invented entry fails; a **missing** entry fails too. That is what makes completeness a
test rather than a promise, and it is why `INV-2` says a class with no fence is not documented at all.

**Two plausible wrong moves, both of which look helpful.** Writing a seventh section for something
with no extractable source, because the owner asked for coverage. And writing a *subset* of a class
because the full set is long — the fence asserts equality, so a subset is a red suite, and the fix
somebody reaches for is weakening the assertion. If a class has no source, that is a finding about
the factory. Route it.

### Both directions of every class fence, or the fence is half-built

Asserting that everything in the document exists is the easy direction and it catches nothing here.
**All three stale facts measured while authoring would have passed it.** The direction that matters
is the other one: everything in the source appears in the document.

T09 requires twelve specimen cases — one omission and one invention per class — and T10 requires
twelve induced failures against them. A class proven in one direction is not proven.

### The stale facts are measured, and they are the workstream's evidence

Measured 2026-08-27, from exports and from the script itself rather than from prose:

| Fact | Source of truth | What a document says | Where |
| --- | --- | --- | --- |
| lifecycle states | **11** — `TASK_STATES` | 10 / "Ten" | `README.md`, diagram label and prose |
| legal edges | **27** — `LEGAL_EDGES` | 24 in the diagram, "twenty-five" in the prose | `README.md`, disagreeing with itself |
| owner acts | **7** — the verb loop at line 118 | "one of the six acts" | `delegation-guard.sh` header |

`PUBLISHED` arrived with W08 and `publish` arrived with it in the guard's loop. **The stale "six" has
already been copied into a second document as if true** — the owner's external technical reference
repeats it in its W01 row. Nobody transcribed a mistake; a session read a stale line and believed it.

**Consequence for anyone reading a ticket:** read the export, not the prose. Read the loop, not the
header. T06 repairs the README as part of building the fence and records the measurement rather than
quietly editing the numbers.

### One file, and the two obligations that created

Q10 chose a single authored `docs/cheatsheet.html`. That removed the markdown twin, the renderer and
the byte-identity fence — **one file cannot drift from itself, and a generator that does not exist
cannot emit a non-deterministic byte.**

Two things the vanished generator was doing became fences instead. The index was going to be
generated from the headings; it is now hand-written and held to the sections by **set equality**
(`INV-8`). And the file was going to be self-contained by construction; it is now self-contained by
**assertion** (`INV-9`).

**The plausible wrong move, and it will arrive wearing a convenience argument:** adding a markdown
copy later "so it reads better in a diff". That is the drift the single-file decision removed, and
the scope table names it for exactly that reason.

### The reader warning is load-bearing, and it looks like an introduction

Q5 kept the driving tree's prose exemption rather than banning command-shaped text, because Q2 had
already removed the ban's premise: a reader who drives a session never types a command. **What pays
for the exemption is one sentence** — that these are not for typing — and a sentence a later edit
could delete would be weaker than the ban it replaced.

So `AC-4` asserts it: the warning must exist, and it must appear **before** the first command block.
Both failure modes are proven by induction. Anyone tidying the document's opening will trip it, which
is the point.

**One note on the record:** the owner's written reason for Q5 arrived truncated. The reading taken is
recorded in the plan's Q5 block. If the unfinished clause carried a further condition, it arrives as
an Amendment before T07, which is the only task that depends on it.

### The graduation tasks are planned by the factory, never by W12

W12 supplies a one-paragraph **request** per run. The factory does the design, the plan and the
build. If W12 plans a task, the run demonstrates nothing about the factory, which is the entire point
of calling it a graduation.

Two claims must stay apart in the record: **what the factory produced**, and **what the document
proved**. A factory failure on a real task is recorded as its own finding and does not fail the
document's rows. T19, T20 and T21 all say so.

### An author-driven run measures consultation, and two runs measure a delta

The driver is the factory's author and cannot be surprised by it. The measure that survives is
**every consultation of a source other than the document in order to proceed** — the source tree, a
plan, a previous transcript, or unaided memory. Each is a place the document was insufficient, and it
does not depend on being surprised.

**Two runs add a dimension one could not have.** Consultations should fall between run one and run
two. A fall means the document is being learned from; **flat or rising is a finding about the
document, not about the driver**; a fall to zero is checked against whether the driver read it or
remembered it. `AC-10` requires the delta to be recorded *and interpreted*, and **T20 forbids editing
the document between the runs** — an edit mid-series makes the delta a measurement of the edit.

**The limit is stated in four places and may not be softened in any of them:** the plan, this README,
the document's own limits section, and the closing Amendment. An author-driven run proves the
document is *sufficient to drive with*. It does not prove it is *comprehensible to somebody new*.
Only a second reader proves that, and Q7 defers it as scheduled future work rather than as a gate.

## What no ticket in this set may do

Eight things, each a rule a plausible convenience would break:

1. Read either frozen candidate record (`specs/awsf-v2-candidates.md`,
   `specs/awsf-v2-candidates-GPT-version.md`).
2. Add or change a CLI command, or any behaviour in `core/src` beyond this workstream's own
   meta-test.
3. Write any path matched by `policy.protected_paths`.
4. Commit a report, receipt or manifest file. **Note the junk-drawer rule**: the meta-test rejects
   any tracked basename containing `receipt` or `manifest`. Name around it; do not widen it.
5. Commit a live task, attempt, session or run identifier, or an absolute machine path. Worked
   examples use `TASK` and `PROJECT`.
6. Narrow the command matcher to restore a green.
7. Document a fact class that has no fence, **or a subset of one**.
8. Create a markdown copy of the cheatsheet, or any build step that generates it.

**And one ordering rule that outranks all eight:** no file at `docs/cheatsheet.html` may exist until
M2's tests are committed. The ordering is observed in the commit record, so adding a fence afterwards
does not repair a violation — it only hides it from a reader who does not check `git log`.

## Thirteen Questionables — twelve decided, one dissolved

| Questionable | Decision | Reaches |
| --- | --- | --- |
| Q1 — who the intended reader is | no external reader; the owner drives | T01, T02, T14, T19 |
| Q2 — CLI or a driven session | a marimba session, plus behind the curtain | T12, T13, T16 |
| Q3 — where the document lives | `docs/`, outside the driving tree, Forest design | T11 |
| Q4 — how the reader reaches it | the owner hands it over | T11 |
| Q5 — fence discipline | fenced-only **plus an asserted warning** | T07, T09, T12 |
| Q6 — which walkthrough | this checkout, real tasks | T02, T03, T19, T20 |
| Q7 — second attempt | plan for two readers, neither available yet | T22, T23 |
| Q8 — index | include one, hand-written and fenced | T11, T14, T16 |
| Q9 — no external reader | the owner acts as reader, limit stated | T01, T14, T19, T23 |
| Q10 — the two renderings | **HTML is the only authored file** | T08, T11, T16 |
| Q11 — how the reference half is kept true | **set-equality fences per fact class** | T06, T09, T16 |
| Q12 — which task the runs drive | small reproducible example; **two** real tasks | T12, T19, T20 |
| Q13 — where the renderer lives | **DISSOLVED** — Q10 removed the renderer | — |

**Q9 carries a spine consequence.** W13 and W14 both name *"v2's core lands (W01–W08, W11, W12 all
`[x]`)"* as a precondition. If any W12 row closes `[f]`, T23 must state explicitly whether that
satisfies it rather than leaving a later session to resolve the ambiguity by guessing.

## Owner-side work this workstream produces but cannot land

Named here so no ticket absorbs it:

- **The external technical-reference document's update.** It lives outside this repository. T23
  prepares the package as text — corrected §08 rows, a marimba subsection, a link to the cheatsheet,
  and the extension prompt in the shape that document's own §19 specifies — and hands it over. **It
  is not committed here.**
- **Installing `/prime-awsf` and marimba's guard.** Both live at per-user paths. The document's
  first two legs must be readable by somebody who has done neither.
- **Carrying the Forest palette into the dashboard.** This is now the *subject* of graduation run
  one, which means **the factory does it, not W12**. The cheatsheet's own design becomes the input to
  the first job driven through the finished factory.

## The friction log — filled by T02 and T03

*Empty at authoring time.* T02 records every consultation, verbatim and numbered in occurrence order,
plus what marimba invoked at each leg — which is the raw material M4 writes the reference half from.
T03 merges the six inherited stops, marks each entry INHERITED or OBSERVED, gives every one exactly
one disposition (**document**, **route**, **owner-side**, **accepted absence**) and assigns it to a
half (**walkthrough** or **reference**).

### Inherited from W11's T01 — carried forward, to be confirmed against the drive

| # | Inherited stop | Confirmed? |
| --- | --- | --- |
| I1 | Two of the four inter-stage boundaries are crossed by hand-authoring and committing a file; no command produces an `awsf.project.yaml` | |
| I2 | The configuration `awsf init` writes enables only `intake`, declares zero agents, and names no adapter any later stage can reach | |
| I3 | `awsf init` runs `git init` with no `-b`, so the branch is the machine default (measured `master`) while the catalog usually says `main` | |
| I4 | The owner-typed `awsf run` cannot reach the zero-quota stub route — `adapters.stub` is `kind: fixture` and the production binding answers `null` on purpose | |
| I5 | With no configured gates, the `tests` phase records `"all configured commands passed"` with `"commands":[]` — a vacuous green | |
| I6 | One task's journal measured 793,310 bytes, 59.8% of it repeated configuration snapshots | |
| I7 | The README's lifecycle description is stale in every number, so a reader who consults it to understand the factory is currently misled | |

An inherited stop the owner does **not** hit is a stop that has been fixed since W11's run, and
saying so is a finding.

## The graduation record — filled by T19, T20 and T21

*Empty at authoring time.* Two runs, one protocol, no edits between them.

| | Run one | Run two |
| --- | --- | --- |
| Request | the dashboard carried to the Forest palette, desktop view | the backlog view reading the spine, deep plans and ticket states |
| Consultations | | |
| Where the driver looked first | | |
| Reference sections used | | |
| Reference sections never opened | | |
| Cost, against what the document said | | |
| What the factory produced, and whether it landed | | |

**The delta, and which of the three readings it fell under:** *(filled by T20)* — a fall means the
document is being learned from; flat or rising is a finding about the document; a fall to zero is
checked against whether the driver read it or remembered it.

**The stated limit** *(repeated by both runs)*: the driver is the factory's author, so these runs
prove the document is sufficient to drive with, not that it is comprehensible to somebody new.

## Shared read-first set

Every fresh session reads `AGENTS.md`, the named task and containing milestone in the HTML plan, and
the source files its own prompt names.

## Sync rule

`core/test/unit/meta/ticket-plan-sync.test.ts` resolves this plan through the registered plan source
and checks task coverage, milestone, marker and checklist state, title, dependency ordering, exact
Section B prompt bytes, and the identifier-spine COVERAGE / ORPHANS / MIRROR rules. The HTML plan is
the status source of truth.

**On the `-build-prompts.md` file:** the current `plan-sota` skill says the ticket directory should be
the only prompt artifact. This repository's landed fence requires the companion file —
`ticket-plan-sync.test.ts` asserts `existsSync(source.promptsPath)` for every plan with a ticket set.
The repository wins, and the conflict is named in the plan's Notes as something for the owner to
settle rather than for a task here to resolve.
