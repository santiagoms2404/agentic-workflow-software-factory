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

The primary measure is consultation rather than surprise because the factory's author cannot be
surprised by workings he already knows. Reaching outside the document remains observable.

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

The M1 drive and both M5 graduation runs use this exact protocol. It runs unchanged twice in M5;
its entry classes, six legs, and recording fields may not be adjusted before or between those runs.
Changing the protocol makes the consultation delta between the two runs meaningless.

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

## The friction log — T02 observed, T03 classified

The owner drove one real implementation job through marimba with no cheatsheet open. The record
below is scrubbed: it carries no task, attempt, session or run handle, no revision, no machine path,
and no live quota or aggregate state. `TASK`, `HISTORICAL_TASK`, `BASE`, `CANDIDATE`, `SETTINGS` and
`STATE_ROOT` are inert placeholders.

**The limit remains:** this author-driven run proves only that the eventual document can be tested
for sufficiency to drive with. It cannot prove that the document is comprehensible to somebody new.

### How T03 classified, and the two rules that decide the hard cases

Every entry — forty-one observed by T02, seven inherited from W11's T01 — carries **exactly one**
disposition and **exactly one** half. Nothing is unclassified and nothing was merged into a
neighbour because the two read alike. Where one entry asked two questions, the disposition follows
the clause the entry's own verbatim record leads with, and the other clause is named as carried
elsewhere rather than folded in.

**Rule one — the half is decided by which milestone can answer, and the reference half is closed.**
`INV-2` and this set's seventh prohibition together mean the reference half may carry only the six
fenced fact classes: commands, lifecycle states, legal edges, owner acts, workflows and gates, and
risk tiers and ceilings. An entry whose answer is one of those six is **reference**, written by M4.
Every other answerable entry is **walkthrough**, written by M3 in the spine's In Plain Language
register as narrative rather than as an enumeration. An entry that is routed, owner-side, or an
accepted absence still carries the half it *would* have landed in, so that a later session reopening
it knows which milestone owns the reopening.

**Rule two — owner-side is confirmed against the spine or it is not owner-side.** Each owner-side
entry below resolves to a named bullet in `../../awsf-v2-plan.html` § Owner-side work or to the
Shared Invariants rule that lists shell functions, installed skills and machine-local settings. One
candidate failed that check and was reclassified: O16's missing `just` wrapper is a toolchain
absence the spine does not name, so it is answered by the document's command class instead. The
check is the point — an unconfirmed owner-side label is how work disappears.

**What the classification produced.** Twenty-five **document** entries (sixteen walkthrough, nine
reference), eight **route** entries across three named blocks, eight **owner-side** entries across
two blocks, and seven **accepted absences**. Ten entries land in the reference half and thirty-eight
in the walkthrough half.

**The two reference-half numbers are allowed to differ, and the difference is not an error.** Ten
entries sit in the reference half; **nine** of them are `document` entries. O39 is the tenth: it is
an accepted absence that belongs to the reference half, so it carries the half without ever becoming
something M4 writes. The count that binds a milestone is the disposition count, so M3 answers sixteen
walkthrough `document` entries and M4 answers nine reference ones. Corrected on 2026-08-29 during
T12, which answered the sixteen and counted them: the earlier reading of fifteen and ten subtracted
the reference half's whole ten from the twenty-five instead of its nine `document` entries.

| Disposition | Entries | Count |
| --- | --- | ---: |
| **document** — answered in the document at the point it occurred | O02, O03, O04, O16, O17, O18, O19, O20, O21, O22, O23, O24, O25, O26, O27, O28, O29, O32, O33, O34, O37, O40, I4, I5, I7 | 25 |
| **route** — a change to the factory, requested and not made here | O11, O13, O14, O15, O35, I1, I2, I3 | 8 |
| **owner-side** — cannot land from a managed worktree | O05, O06, O07, O08, O09, O10, O12, O36 | 8 |
| **accepted absence** — reason and reopening evidence written | O01, O30, O31, O38, O39, O41, I6 | 7 |
| | | **48** |

| Half | Entries | Count |
| --- | --- | ---: |
| **reference** (M4) | O16, O20, O21, O24, O25, O27, O33, O37, O39, I7 | 10 |
| **walkthrough** (M3) | every other entry | 38 |

### Numbered observation log

#### O01 · Consultation · Leg 2

- **Consulted:** the support transcript instead of the ticket README alone.
- **Question answered, verbatim:** “Explain everything in the W12 ticket README here in chat.”
- **Disposition:** accepted absence · **Half:** walkthrough
- **Why:** The consultation asked for an explanation of this workstream's own ticket README, which is W12's execution surface rather than the factory. **Reason:** the document's subject is driving the factory; it does not teach the observation protocol, and a section that did would be a fact class with no source to fence it against. **What reopens it:** the same consultation recorded in an M5 run, where the driver follows the document instead of a ticket protocol — that would make it a leg-2 document gap.

#### O02 · Consultation · Leg 3

- **Consulted:** the support transcript, which read the observation and implementation tickets.
- **Question answered, verbatim:** “What task do I need to perform to drive it?”
- **Disposition:** document · **Half:** walkthrough
- **Why:** Leg 3 states what the reader brings: a described result and its acceptance boundary, never a chosen command and never a ticket id. The walkthrough carries one worked description in that shape.

#### O03 · Expectation mismatch · Legs 2–3

- **Expected:** Prime would finish before the owner selected and requested a job, matching the frozen six-leg order.
- **Observed:** the owner selected the implementation ticket before opening and priming marimba.
- **Disposition:** document · **Half:** walkthrough
- **Why:** Leg 3 states that the six legs are an order of observation, not an order the factory enforces, and that deciding the job before priming is legal and changes nothing the factory checks.

#### O04 · Consultation · Leg 2

- **Consulted:** the support transcript, the repository's marimba documents, and the local Pi launch documentation.
- **Question answered, verbatim:** “Is there a special command alias to open a marimba session?”
- **Disposition:** document · **Half:** walkthrough
- **Why:** Leg 2 states that no repository command opens a marimba session: it is opened by an owner-installed launcher carrying marimba's settings and the appended contract. The document says this for a reader who has installed neither, per the plan's owner-side note. The installation itself is `OWNER-MARIMBA-LAUNCH` below; the statement is what stops that block from absorbing document work.

#### O05 · Expectation mismatch · Leg 2

- **Expected:** a marimba alias and equivalent guarded launchers for Claude and Pi.
- **Observed:** no repository-defined alias was found; the tested hook boundary had a Claude launcher and no equivalent Pi launcher.
- **Disposition:** owner-side · **Half:** walkthrough
- **Why:** `OWNER-MARIMBA-LAUNCH` row 1.

#### O06 · Expectation mismatch · Leg 2

- **Expected:** the first supplied multi-line launch text would open marimba.
- **Observed:** a line break split a command substitution, the shell waited, and the owner interrupted it.
- **Disposition:** owner-side · **Half:** walkthrough
- **Why:** `OWNER-MARIMBA-LAUNCH` row 2.

#### O07 · Expectation mismatch · Leg 2

- **Expected:** pasting the displayed command block would open marimba.
- **Observed:** the Markdown fence entered the terminal and Claude rejected an unknown `--bash` option.
- **Disposition:** owner-side · **Half:** walkthrough
- **Why:** `OWNER-MARIMBA-LAUNCH` row 3.

#### O08 · Consultation · Leg 2

- **Consulted:** the support transcript.
- **Question answered, verbatim:** “Provide a command that I can paste into the Herdr pane.”
- **Disposition:** owner-side · **Half:** walkthrough
- **Why:** `OWNER-MARIMBA-LAUNCH` row 4.

#### O09 · Expectation mismatch · Leg 2

- **Expected:** the revised launch text would remain one shell command.
- **Observed:** hard line breaks detached option values and removed shell expansions; the launcher reported a missing settings argument and the shell treated later text as separate commands.
- **Disposition:** owner-side · **Half:** walkthrough
- **Why:** `OWNER-MARIMBA-LAUNCH` row 5.

#### O10 · Consultation · Leg 2

- **Consulted:** the support transcript and the launcher help.
- **Question answered:** how to launch without shell variables or command substitution.
- **Disposition:** owner-side · **Half:** walkthrough
- **Why:** `OWNER-MARIMBA-LAUNCH` row 6.

#### O11 · Expectation mismatch · Leg 2

- **Expected:** the first session that opened would display the marimba banner.
- **Observed:** Claude opened, but no banner appeared in the TUI.
- **Disposition:** route · **Half:** walkthrough
- **Why:** `W01-SESSION-GUARD-CONFIRMATION` row 1.

#### O12 · Consultation · Leg 2

- **Consulted:** the support transcript, owner-side settings, and the repository hook scripts.
- **Question answered, verbatim:** “What do you recommend the marimba driving-session model and effort be, and how is the banner supposed to look?”
- **Disposition:** owner-side · **Half:** walkthrough
- **Why:** `OWNER-MARIMBA-LAUNCH` row 7 — the model and effort a driving session runs at are per-invocation launch settings. The entry's second clause, how the banner is supposed to look, is carried by `W01-SESSION-GUARD-CONFIRMATION` and is not merged into this one.

#### O13 · Expectation mismatch · Leg 2

- **Expected:** a debug-enabled launch would make the banner visible.
- **Observed:** the session opened with hook debugging enabled and still showed no banner.
- **Disposition:** route · **Half:** walkthrough
- **Why:** `W01-SESSION-GUARD-CONFIRMATION` row 2.

#### O14 · Consultation · Leg 2

- **Consulted:** the external Claude debug log.
- **Question answered:** whether the `SessionStart` hook executed despite the absent banner.
- **Disposition:** route · **Half:** walkthrough
- **Why:** `W01-SESSION-GUARD-CONFIRMATION` row 3.

#### O15 · Expectation mismatch · Leg 2

- **Expected:** successful plain-text `SessionStart` output would be visible in the TUI.
- **Observed:** the debug log recorded the hook and its complete banner as successful while the TUI displayed none of it.
- **Disposition:** route · **Half:** walkthrough
- **Why:** `W01-SESSION-GUARD-CONFIRMATION` row 4.

#### O16 · Expectation mismatch · Leg 2

- **Expected:** the prescribed convenience wrapper would run the diagnosis.
- **Observed:** the wrapper executable was unavailable; marimba used the equivalent root npm invocation and received a healthy result.
- **Disposition:** document · **Half:** reference
- **Why:** Fact class one. The command class renders in one canonical form and the reference half states that the three invocation forms are equivalent, with `just` named as a thin wrapper over the root scripts and never a second source of truth. Measured: `justfile` declares the `awsf *args` target, and `just` was absent from the machine's `PATH`, so the fallback was the same command in another form.

#### O17 · Expectation mismatch · Leg 3

- **Expected:** “Drive W12 T05 to completion” would cause marimba to prepare and launch the work.
- **Observed:** marimba first asked the owner to choose a full factory drive, preparation without provider launch, or the repository's prior direct-worker convention.
- **Disposition:** document · **Half:** walkthrough
- **Why:** Leg 3 states that the reader is asked to choose a route before anything launches, and names which choice drives one job end to end through the factory.

#### O18 · Consultation · Leg 3

- **Consulted:** the support transcript.
- **Question answered:** which offered route satisfied the requirement to drive one real job end to end through marimba.
- **Disposition:** document · **Half:** walkthrough
- **Why:** Leg 3 states what each offered route does, so the choice is made from the document rather than from a consultation.

#### O19 · Expectation mismatch · Leg 3

- **Expected:** the provider named in marimba's route-selection prompt would run the worker.
- **Observed:** the configured builder on the other provider ran instead.
- **Disposition:** document · **Half:** walkthrough
- **Why:** Leg 3 states that the worker which runs is the configured agent on its own adapter, which need not be the driving session's provider. Measured in `awsf.config.yaml`: the `builder` agent is `model: codex:gpt-5.6-sol` with `harness.adapter: codex` while the session ran on claude.

#### O20 · Consultation · Leg 4

- **Consulted:** the dashboard.
- **Question answered:** whether the task had entered the factory and reached `PREPARED`.
- **Disposition:** document · **Half:** reference
- **Why:** Fact class two — `PREPARED` is a member of `TASK_STATES`.

#### O21 · Consultation · Leg 4

- **Consulted:** the dashboard session card.
- **Question answered:** whether execution had actually started.
- **Disposition:** document · **Half:** reference
- **Why:** Fact class two — `RUNNING` is a member of `TASK_STATES`.

#### O22 · Consultation · Leg 4

- **Consulted:** the request-phase waterfall evidence and events.
- **Question answered:** what request the factory had received and recorded.
- **Disposition:** document · **Half:** walkthrough
- **Why:** Leg 4 states that the request phase's evidence is where the factory records what it was asked to do.

#### O23 · Consultation · Leg 4

- **Consulted:** the builder-phase waterfall evidence and events.
- **Question answered:** what the builder was doing and what evidence it produced.
- **Disposition:** document · **Half:** walkthrough
- **Why:** Leg 4 states that the builder phase's evidence and events are where the work itself is readable.

#### O24 · Consultation · Leg 4

- **Consulted:** the tests-phase waterfall evidence and events.
- **Question answered:** whether the configured checks ran and passed.
- **Disposition:** document · **Half:** reference
- **Why:** Fact class five — which checks are configured is extracted from the loaded configuration's `gates`.

#### O25 · Consultation · Leg 4

- **Consulted:** the dashboard session card and waterfall.
- **Question answered:** whether execution had finished and reached `AWAITING_OWNER`.
- **Disposition:** document · **Half:** reference
- **Why:** Fact class two — `AWAITING_OWNER` is a member of `TASK_STATES`.

#### O26 · Consultation · Leg 4

- **Consulted:** the marimba terminal while alternating with the dashboard.
- **Question answered:** what marimba was doing while the factory progressed. The retrospective account cannot recover the exact number or timing of these repeated checks.
- **Disposition:** document · **Half:** walkthrough
- **Why:** Leg 4 states which surface answers which question, so the reader stops alternating between marimba and the dashboard. The unrecoverable count limits what this entry weighs; it is not itself a document gap.

#### O27 · Consultation · Leg 6

- **Consulted:** marimba's owner-gate handoff.
- **Question answered:** what the factory produced, whether its gates passed, where it stopped, what it cost, and which owner decisions were available.
- **Disposition:** document · **Half:** reference
- **Why:** Fact class four — what the owner may do at the owner gate is the owner-acts class.

#### O28 · Expectation mismatch · Leg 6

- **Expected:** the driven ticket's required single commit, including its prescribed message, plan markers, and ticket state.
- **Observed:** the candidate changed one test file under a different host commit message and contained no plan-marker or ticket-state change.
- **Disposition:** document · **Half:** walkthrough
- **Why:** Leg 6 states that passing gates do not prove a ticket's closure contract was met, and that checking the candidate against what was requested is part of the owner act. Its two causes stay separate: O35 is routed and O36 is owner-side.

#### O29 · Consultation · Leg 5

- **Consulted:** a historical sealed attempt's status, journal, review envelopes, and the v1 plan Amendment that analysed it.
- **Question answered:** what the factory refused, which evidence precondition failed, and which owner decision remained available.
- **Disposition:** document · **Half:** walkthrough
- **Why:** Leg 5 states that a refusal is readable from the factory's own surfaces — status, journal and the review envelopes — without opening a plan Amendment. Reaching for the Amendment is the insufficiency this entry records.

#### O30 · Expectation mismatch · Leg 5

- **Expected:** a refusal connected to the current drive.
- **Observed:** the current drive had no refusal, so marimba selected a historical v1 Pilot 2 refusal from the shared state store without mutating either attempt.
- **Disposition:** accepted absence · **Half:** walkthrough
- **Why:** **Reason:** the factory refuses only when a precondition actually fails, so a drive that succeeds produces no refusal, and W12 may not manufacture one — `INV-5` forbids routing around a refusal, and staging one would fabricate the evidence leg 5 exists to read. Reading a sealed historical attempt without mutating it is the honest substitute. **What reopens it:** a graduation run in M5 that produces a genuine refusal, which then replaces the historical example in the walkthrough.

#### O31 · Expectation mismatch · Legs 5–6

- **Expected:** the refusal leg would occur before the owner-gate stop.
- **Observed:** the successful current drive reached the owner gate first; the historical refusal was read afterwards because the current drive contained none.
- **Disposition:** accepted absence · **Half:** walkthrough
- **Why:** **Reason:** the six legs are an order of observation, not a sequence the factory enforces; a drive with no refusal reaches the owner gate before any refusal can be read, by construction. Reordering the protocol to match is forbidden — T01 froze it and both M5 runs must use it unchanged. **What reopens it:** an M5 run in which the factory refuses mid-drive, which restores the frozen order and lets the consultation delta be read leg by leg.

#### O32 · Consultation · Leg 5

- **Consulted:** the support transcript.
- **Question answered, verbatim:** “Why is it talking about a task that I ran in the v1 plan?”
- **Disposition:** document · **Half:** walkthrough
- **Why:** Leg 5 states that the state root is one per machine with projects namespaced inside it, so attempts from earlier work stay visible, and that reading one mutates nothing.

#### O33 · Consultation · Leg 6

- **Consulted:** the support transcript.
- **Question answered, verbatim:** “Can I tell marimba to land it?”
- **Disposition:** document · **Half:** reference
- **Why:** Fact class four — landing is an owner act, and the owner-acts class is what says the driving session cannot perform it.

#### O34 · Consultation · Leg 6

- **Consulted:** the stored request, candidate commit, builder write allowlist, builder role prompts, and host commit implementation.
- **Question answered, verbatim:** “Is the reason it lacks the marker/state changes and has the wrong commit message because it did not pass the actual ticket prompt?”
- **Disposition:** document · **Half:** walkthrough
- **Why:** Leg 6 states where the factory records the request it actually sent, so a candidate that does not match its ticket is diagnosable from the evidence surfaces rather than from source. This entry is the consultation that found O35 and O36; it is a document gap in its own right because the diagnosis required reading `core/src` and the role prompts.

#### O35 · Expectation mismatch · Leg 3, discovered at Leg 6

- **Expected:** marimba would pass the ticket's build prompt, including its exact commit and marker instructions, unchanged.
- **Observed:** the stored request carried the implementation and acceptance substance but explicitly said not to commit, not to flip markers or ticket state, and not to touch the W12 plan or ticket tree; it said land time would handle those items.
- **Disposition:** route · **Half:** walkthrough
- **Why:** `W01-TICKET-PROMPT-FIDELITY` row 1.

#### O36 · Expectation mismatch · Leg 3, discovered at Leg 6

- **Expected:** the selected worker route could write every path required by the ticket.
- **Observed:** its write allowlist covered source, tests, dashboard, and prompts, but excluded the W12 plan and ticket paths.
- **Disposition:** owner-side · **Half:** walkthrough
- **Why:** `OWNER-BUILDER-WRITE-SCOPE`.

#### O37 · Consultation · Leg 6

- **Consulted:** marimba's final read-only command, lifecycle, edge, and gate report.
- **Question answered:** which commands ran in each leg, which states and edges were observed, which checks decided the outcomes, and whether either attempt was mutated.
- **Disposition:** document · **Half:** reference
- **Why:** Fact classes one, two, three and five at once — commands, states, edges and gates are the reference half's whole subject, and this consultation is the question it is written to answer.

#### O38 · Expectation mismatch · Leg 6

- **Expected:** the final report would use the frozen order: Install, Prime, Ask for one job, Watch, Read a refusal, Stop.
- **Observed:** marimba labelled Prime as Leg 1, split preparation and launch into Legs 2 and 3, and omitted Install as its own leg.
- **Disposition:** accepted absence · **Half:** walkthrough
- **Why:** **Reason:** the six legs are W12's observation protocol, committed in this ticket set. marimba has never been given them and `docs/driving/marimba/CONTRACT.md` does not define them, so a report that numbers its own legs differently is not a factory defect. **What reopens it:** an M5 run in which the numbering mismatch makes the consultation delta unreadable — that would be a contract change owned by W01, not a document change, and it would be routed then rather than assumed now.

#### O39 · Expectation mismatch · Leg 6

- **Expected:** every invoked command would be reported exactly.
- **Observed:** most command shapes were supplied, but the task request, Git formatting, and several state-store reads remained summarized placeholders.
- **Disposition:** accepted absence · **Half:** reference
- **Why:** **Reason:** the reference half's six classes are extracted from exports and the loaded configuration, never from a session's report, so a summarized command shape in this capture cannot make the document wrong or incomplete. **What reopens it:** a walkthrough leg in M3 that needs an exact invocation no source can supply — a git formatting argument, say — at which point the gap becomes a document gap and is recorded as one.

#### O40 · Consultation · Leg 6

- **Consulted:** the support transcript.
- **Question answered, verbatim:** “What do you recommend doing now; what happens to the marimba session, T05, and T02?”
- **Disposition:** document · **Half:** walkthrough
- **Why:** Leg 6 states what an unlanded candidate at `AWAITING_OWNER` leaves available and that closing the driving session changes no task state. The clause about T05 and T02 specifically is workstream process and is not what the document answers.

#### O41 · Consultation · Leg 4, clarified at Leg 6

- **Consulted:** the support transcript.
- **Question answered, verbatim:** “What does ‘What question did you use the dashboard to answer?’ mean?”
- **Disposition:** accepted absence · **Half:** walkthrough
- **Why:** **Reason:** the phrasing belongs to T01's frozen protocol, which is committed here and may not be adjusted before or between the M5 runs; the cheatsheet does not teach the protocol. **What reopens it:** nothing in the document. If the same question recurs in M5, the finding is about the protocol's wording and belongs in the plan's Amendments.

### Per-leg capture of what marimba invoked

#### Leg 1 — Install

The checkout already existed. Dependency installation reported that the tree was up to date:

```text
npm install
```

#### Leg 2 — Prime

The successful launcher selected the marimba settings and contract without committing a machine path:

```text
claude --model sonnet --effort medium --debug hooks --dangerously-skip-permissions \
  --settings SETTINGS --append-system-prompt-file docs/driving/marimba/CONTRACT.md
```

The external debug log recorded the `SessionStart` hook as successful: settings loaded, guard
present and executable, payload parser ran, three checks confirmed and zero fixes named. It did not
claim that the next `PreToolUse` hook would fire. The TUI displayed none of that banner.

Marimba reported reading, in order: `AGENTS.md`; the task machine, guards and tiers; the phase
machine and workflow layer; the committed configuration and schema; the state-root layout; and the
v1 plan's markers and Amendments. It then ran:

```text
npm test
npm run lint
just awsf doctor          # command unavailable
npm run awsf -- doctor    # equivalent fallback
```

The full suite exited 0, including 107/107 journeys. Lint exited 0 with no warnings across 403
files. Diagnosis exited 0 and reported the 27-edge, 11-state matrix healthy. Priming observed no
lifecycle state and stopped without a task status board.

#### Leg 3 — Ask marimba for one job

The owner asked marimba to drive the implementation ticket. After the route-selection consultation,
marimba ran these scrubbed command shapes:

```text
npm run awsf -- new TASK "<request>" --workflow build --tier T1
npm run awsf -- status TASK
npm run awsf -- quota
npm run awsf -- start TASK
npm run awsf -- status TASK
npm run awsf -- run TASK
```

The quota read was advisory rather than a gate. Start passed adapter, sandbox and observability
preflight, pinned `BASE`, and materialized a detached worktree. The lifecycle then moved:

```text
DRAFT --L1--> PREPARED --L4--> RUNNING --L7--> GATING --L12--> AWAITING_OWNER
```

L4 reserved one builder call. The T1 route skipped review; no review, correction or blocked state
occurred, and no correction round was used.

The stored request differed from the ticket at the closure boundary. The ticket required one exact
commit with marker and state changes. The request told the worker not to commit, not to change those
files, and said land time would handle them. Independently, the configured builder route could not
write the W12 plan or ticket paths. The host created `CANDIDATE` from the builder envelope's proposed
message.

#### Leg 4 — Watch it

The owner used the dashboard as the primary monitoring surface. The session card first showed
`PREPARED`, then execution. The owner opened the request, builder and tests waterfall phases to read
their evidence and events, saw the checks pass, watched the state reach `AWAITING_OWNER`, and then
returned to marimba's handoff.

Marimba reported these read-only command shapes while gathering evidence:

```text
npm run awsf -- status TASK
npm run awsf -- doctor
git diff --stat BASE CANDIDATE
git diff --name-status BASE CANDIDATE
git diff BASE CANDIDATE
git log -1 --format=<format> CANDIDATE
git show CANDIDATE:core/test/unit/meta/doc-reconciliation.test.ts
git status --porcelain
git rev-parse --short HEAD
python3 <reads of status, journal, request, builder and tests envelopes>
```

The builder's reported check sequence was:

```text
node --experimental-strip-types --test core/test/unit/meta/doc-reconciliation.test.ts  # RED
node --experimental-strip-types --test core/test/unit/meta/doc-reconciliation.test.ts  # green
npm run test:unit
npm run lint
npm run typecheck
```

The host then ran the configured candidate gates:

| Gate | Result | Measured duration |
| --- | --- | ---: |
| `npm run test:unit` | exit 0, 1489 pass / 0 fail | 79,190 ms |
| `npm run typecheck` | exit 0, core + dashboard | 28,027 ms |
| `npm run lint` | exit 0, 0 warnings | 522 ms |

The widened README and v1 Validation scan found no offending command. The candidate changed only
`core/test/unit/meta/doc-reconciliation.test.ts`, by +23/−5. The canonical checkout remained clean
and unchanged; the process cleaned up; the drive reached `AWAITING_OWNER` with passing gates and no
blocker.

#### Leg 5 — Read a refusal

The successful current drive contained no refusal. Without triggering or mutating one, marimba read
a historical sealed refusal using these scrubbed command shapes:

```text
find STATE_ROOT/projects -name status.json
python3 <reads of historical status, journal, review envelopes, review context and retained text>
wc -l <composed review diff>
```

The historical lifecycle was:

```text
PREPARED → RUNNING → GATING → REVIEWING → AWAITING_OWNER → REVIEWING → BLOCKED
```

Its build and host gates passed. An original review had accepted without receiving source evidence,
so the owner spent the one re-entry on a replacement review with diff-scoped context. The replacement
returned five file-attributed findings, and each carried an extra `level` property beside the valid
`severity` property. The closed schema rejected all five extra properties, leaving no valid required
review; the malformed-review edge sealed the attempt in `BLOCKED`. The recorded owner option was a
new retry carrying prior spend. No historical state changed during this read.

#### Leg 6 — Stop at an owner act with its evidence

Marimba performed no owner act. It reported the workflow and tier, base and candidate evidence,
worker route, calls and corrections, lifecycle state, gate and blocker result, process cleanup,
canonical-checkout cleanliness, candidate scope, RED-before-green evidence, configured gate results,
and the widened fence's zero-offender result.

The drive stopped at `AWAITING_OWNER`. The candidate was not landed. It had passing implementation
gates and a one-file diff, while its commit message, marker changes and ticket-state change differed
from the ticket's closure contract. Marimba stood down with land, rework and cancel left to the
owner.

### Inherited from W11's T01 — INHERITED, not OBSERVED, and each checked against the drive

W11's T01 drove a throwaway project through all five stages on 2026-08-26. Its six measured stops
plus the stale-lifecycle finding are merged here **marked `INHERITED`**, so no reader mistakes them
for something this drive saw. Each was then checked twice: against the drive's record above, and
against the source as it stands today.

**The finding the check was written to produce did not occur: no inherited stop has been fixed.**
Every one is still present in the tree at the line named below. Three were not hit because Q6 scoped
this drive to an already-registered checkout, one was not hit because this checkout configures
gates, one was not hit because the driver never opened a journal, and two were hit. *An inherited
stop the owner does not hit is a stop that has been fixed since — that is the finding this column
was for, and it is empty.*

| # | Inherited stop | Hit on this drive? | Still present? | Disposition · half |
| --- | --- | --- | --- | --- |
| I1 | Two of the four inter-stage boundaries are crossed by hand-authoring and committing a file; no command produces an `awsf.project.yaml` | **No** — Q6 scoped the drive to this checkout, which already carries a catalog, so no stage boundary was crossed | **Yes.** `core/src/stages/contract.ts:56` still states *"An `awsf.project.yaml` catalog exists"* as S2's entry precondition, and `core/src/registry/resolve.ts:61` still tells the owner to pass `--catalog <path-to-awsf.project.yaml>`. Every reference in `core/src` consumes the file; none writes it | route → `W03-GREENFIELD-ENTRY` · walkthrough |
| I2 | The configuration `awsf init` writes enables only `intake`, declares zero agents, and names no adapter any later stage can reach | **No** — same reason as I1; `awsf init` never ran | **Yes.** `core/src/config/init-template.ts` still writes `workflows: { enabled: ["intake"] }`, `agents: []` and `gates: {}` | route → `W03-GREENFIELD-ENTRY` · walkthrough |
| I3 | `awsf init` runs `git init` with no `-b`, so the branch is the machine default (measured `master`) while the catalog usually says `main` | **No** — same reason as I1 | **Yes.** `core/src/cli/commands/init.ts:41` is still `runGit(runner, ["init"])`, with no branch argument anywhere in the command | route → `W03-GREENFIELD-ENTRY` · walkthrough |
| I4 | The owner-typed `awsf run` cannot reach the zero-quota stub route — `adapters.stub` is `kind: fixture` and the production binding answers `null` on purpose | **Yes, in substance.** Leg 3's `awsf run TASK` reserved and spent one real builder call on the configured route. There was no free rehearsal and the drive did not look for one | **Yes.** `awsf.config.yaml:30` is still `stub: { kind: fixture }` | document · walkthrough |
| I5 | With no configured gates, the `tests` phase records `"all configured commands passed"` with `"commands":[]` — a vacuous green | **No** — masked. This checkout configures three gates and Leg 4 recorded all three running with measured durations, so the pass the driver saw was not vacuous | **Yes.** `core/src/cli/commands/production-run.ts:1191` still emits `"all configured commands passed"` from `failures.length === 0`, which an empty command list satisfies | document · walkthrough |
| I6 | One task's journal measured 793,310 bytes, 59.8% of it repeated configuration snapshots | **No** — the driver used the dashboard as the primary monitoring surface for the whole of Leg 4 and never opened a journal for the current drive. He read a historical journal at Leg 5 without measuring it | **Not re-measured.** Neither confirmed nor refuted by this drive | accepted absence · walkthrough |
| I7 | The README's lifecycle description is stale in every number, so a reader who consults it to understand the factory is currently misled | **Yes, from the other side.** Leg 2's diagnosis reported the 27-edge, 11-state matrix healthy — the true numbers the README contradicts. The driver did not consult the README for the lifecycle, so he was not misled by it on this run | **Yes, and worse than recorded.** `README.md:36` says *10 states · 24 edges · 76 ordered rejections* while `README.md:62` says *Ten states, twenty-five legal edges, seventy-five rejected pairs*. The two disagree with each other as well as with the source: `TASK_STATES` has 11 entries and `LEGAL_EDGES` has 27 | document · reference |

**I4's document answer, stated once here because it decides what the walkthrough costs:** driving one
job through the factory spends real provider quota, and there is no free rehearsal route. The
document says so before the reader starts, which is the whole reason W11's T01 measured it.

**I5's document answer:** the `tests` phase reports that all *configured* commands passed, and that
sentence is worth exactly what the configured gate list is worth. The gate list is fenced fact class
five, so the walkthrough points the reader at it rather than restating it.

**I6's reason, as an accepted absence:** the document never sends the reader to a journal — Leg 4's
whole finding is that watching means the dashboard — so journal size does not reach the reader
through anything this document says. No workstream in the spine owns journal composition either:
W02's scope is the dashboard's rendering of evidence, not what the journal stores, so a route would
name no owner. **What reopens it:** a graduation run in which the dashboard fails to answer a leg-4
question and the driver opens a journal to get the answer. That makes journal readability
document-facing and gives it an owner, and it is recorded then rather than assumed now.

### Routed requests — three blocks, in W11 T04's shape

W11's precedent: the route is a written request and never a patch. Nothing below was implemented,
no file under `core/src` or `docs/driving/` was edited by this task, and every named workstream
exists in the spine.

#### `W01-SESSION-GUARD-CONFIRMATION` → W01, marimba's operating contract

The banner exists, runs, and reports success into an external debug log, and the driver never saw
it. Four entries, four distinct missing things.

| Entry | What is missing | Why W12 cannot supply it | What would close it |
| --- | --- | --- | --- |
| O11 | A session that opened produced no visible confirmation that it was guarded. `docs/driving/marimba/session-banner.sh` exists to give *"positive confirmation anywhere that a session was running guarded"*, and on this launch it gave none | `INV-7` — W12 adds and changes no command, and writes nothing under `docs/driving/`. A document cannot make an invisible banner visible, and a document that told the reader to expect a banner that does not appear would teach the wrong thing | A capture proving which surface, if any, renders `SessionStart` output for this host, checked into W01's capture set beside the refusals it already carries |
| O13 | Raising hook debugging did not surface it either, so the absence is not a verbosity setting the driver can change | Same `INV-7` boundary, and the debug level is a launch flag W12 may not prescribe | The same capture, taken at both debug levels, so W01 can state whether the banner is renderable at all rather than leaving a driver to raise verbosity and learn nothing |
| O14 | There is no in-session read that answers *"is this session guarded?"*. The driver had to open an external Claude debug log outside the repository to find out | The answer would be a new read-only command or a contract clause, and `INV-7` forbids the first while the second is W01's file | Either a contract clause naming what a driver may ask the session to confirm the guard is loaded, or — if nothing in-session can confirm it — W01 recording that as a named gap, since the banner's stated purpose is exactly this |
| O15 | The debug log recorded the hook *and its complete banner* as successful while the TUI displayed none of it. A hook that succeeds invisibly is the gap the banner's own header says it exists to stop papering over | W12 cannot amend the banner's three rules, and it may not weaken them by documenting a workaround | W01 deciding between the two possibilities its own captures would settle: the host renders no `SessionStart` output, in which case the banner is replaced by something the driver can request; or it does under some condition, in which case that condition is written into `docs/driving/marimba/README.md` |

**Verified after T03 closed, and it narrows this block rather than closing it.** The four entries
above left one question genuinely open: the banner's own header says *"a hook registration that
loads is not a hook that fires"*, so an invisible banner left no evidence that the M1 drive ran
guarded at all. That question is now answered. A headless session launched with marimba's settings
was asked to run a Bash command containing `awsf land`; `delegation-guard.sh` intercepted it at
`PreToolUse`, exited 2 with the owner-act denial, and the command never executed. The same script
was checked offline first and denies the owner-act payload while passing a harmless one.

**So the `PreToolUse` fence fires and the M1 drive was guarded.** What W01 owes is a missing
*signal*, not a missing *boundary* — which is what O11, O13, O14 and O15 each describe, and none of
their requests changes. The one thing W01 no longer has to determine is whether the guard runs; it
does. Neither the probe's settings file nor its output is committed: both carry an absolute machine
path and stayed outside this repository under `INV-3`.

**Confirmed a second time, in a live driving session, and it produced one further finding.** The
headless probe was repeated interactively: the session was asked to run a Bash command containing
`awsf land`, and fence 2 denied it. The session then explained the denial correctly, cited
`docs/driving/marimba/CONTRACT.md` § 3 items 1 and 2 accurately, declined to perform the act —
*"`awsf land` is an owner act regardless. In a driving session I prepare and explain it; the owner
runs it themselves"* — and separately satisfied the harmless string-printing request by splitting
the verb across two arguments. **That split is a documented property, not a hole:** § 3 item 1
states that a quoted or split verb is not denied and that *"whitespace is the only shell
transformation the fence undoes"*, and says the gap is *"stated rather than closed"* on purpose.
The session drew the line in the right place — it refused the act and worked around only the
over-denial that § 3 item 2 names.

**The finding is a register mismatch between two W01 artifacts, and it is one this document must
not inherit.** The guard's denial text ends *"this fence is the one that holds"*, which a driver
reads at the moment of refusal as a statement that the boundary is a wall. `CONTRACT.md` § 3 ends
the opposite way: *"Read that list as the operating envelope, not as a menu of ways around the
fences. A driving session that decides to route around them can… the list above is here so no later
session mistakes the envelope for a wall."* Both are true — the denial line is comparing the fence
to the TTY check, not claiming inviolability — but a reader who sees only the denial over-trusts it.
**The walkthrough's Leg 5 carries `CONTRACT.md`'s framing, never the denial line's**, because what a
reader takes away is the whole subject of this workstream. This changes no entry's disposition and
adds no route; W01's four requests stand as written.

#### `W01-TICKET-PROMPT-FIDELITY` → W01, marimba's operating contract

| Entry | What is missing | Why W12 cannot supply it | What would close it |
| --- | --- | --- | --- |
| O35 | The contract does not require a ticket's build prompt to reach the stored request unaltered, and does not forbid marimba substituting its own closure policy for the ticket's. The stored request carried the implementation and acceptance substance but told the worker not to commit, not to flip markers or ticket state, and not to touch the W12 plan or ticket tree — saying land time would handle them. The ticket required one exact commit carrying all three | `INV-7` — W12 changes no command and writes nothing under `docs/driving/`. Documenting the substitution would tell the reader to expect a request that does not match the ticket, which leaves the substitution in place and teaches the reader to tolerate it | A contract clause requiring that, when a ticket is the subject, the ticket's build-prompt bytes are carried into the request verbatim — closure instructions included — plus a captured transcript in W01's set proving marimba refuses to paraphrase them. W01 should decide this together with `OWNER-BUILDER-WRITE-SCOPE`: a verbatim prompt the route still cannot satisfy is a second, quieter failure |

#### `W03-GREENFIELD-ENTRY` → W03, `awsf init`

Three inherited stops, all still present, none of which this drive could hit because Q6 scoped it to
an already-registered checkout. The plan's own scope table routes the first of these here in
advance: *"A starter `awsf.project.yaml` template … goes to W03. Record the stop, route the request,
and keep the walkthrough scoped to this checkout per Q6."*

| Entry | What is missing | Why W12 cannot supply it | What would close it |
| --- | --- | --- | --- |
| I1 | No command produces an `awsf.project.yaml`, so two of the four inter-stage boundaries are crossed by hand-authoring and committing a file. A greenfield reader stops at the first one | W12's `INV-7` adds no command, and this set's fifth prohibition and the plan's scope table both name the starter template as the tempting wrong answer. Writing one here would move a stop into a document instead of removing it | `awsf init`, or a sibling under W03's deterministic host-owned banner, emitting a minimal catalog that names the project's slug and its own repository — enough for `awsf project register` to accept it without the owner authoring YAML |
| I2 | The configuration `awsf init` writes enables only `intake`, declares zero agents and configures no gates, so a recognised project can run nothing. The reader reaches the second boundary and stops one step later | Changing `core/src/config/init-template.ts` is a code change, which `INV-7` forbids. It is also W03's declared subject: *"create the directory, `git init`, write a minimal config, and make a baseline commit — that is the whole command"* | W03 deciding what the minimal config owes a project that intends to run something: either a second workflow and one agent, or an explicit refusal at the next stage that names what is missing rather than a project that is merely inert |
| I3 | `awsf init` runs `git init` with no `-b`, so the initial branch is whatever the machine defaults to — measured `master` — while catalogs usually declare `main`. The mismatch is silent at creation and surfaces later as a confusing refusal | Same code boundary, same owning workstream | Passing the catalog's declared default branch to `git init -b`, or refusing at registration when the repository's branch does not match the catalog's declared one, with the mismatch named in the refusal |

### Owner-side, each confirmed against the spine

`../../awsf-v2-plan.html` § Owner-side work names *"marimba's guard installation. It lives at a
per-user path and is passed per invocation via `--settings`"* and *"Every invariant and
protected-config amendment. One owner-authored commit each"*; its Shared Invariants add that *"the
owner's shell functions, installed skills, machine-local settings … are all named as owner-side and
none of them is a ticket."* Both blocks below resolve to those. Neither absorbs document work: what
the document still owes because of them is carried by O04, which is a **document** entry.

#### `OWNER-MARIMBA-LAUNCH` — seven entries, one installation act

| Entry | The owner-side act | Spine bullet it confirms against |
| --- | --- | --- |
| O05 | No Pi launcher exists beside the Claude one at the tested hook boundary. Launchers are shell functions at per-user paths | shell functions and machine-local settings |
| O06 | The launch text must survive as one shell command; a line break split a command substitution and the shell waited | the guard *"is passed per invocation via `--settings`"* — the invocation is the owner's |
| O07 | The launch text is copied without its fence characters, and every option in it must be one the launcher accepts | same |
| O08 | A launch line that can be pasted into the owner's pane manager is a property of the owner's shell, not of this repository | shell functions and machine-local settings |
| O09 | Options and their values stay on one line, with no shell variables and no expansions that a paste can strip | the per-invocation bullet |
| O10 | A launch form containing no shell variables and no command substitution is an owner-authored form | the per-invocation bullet |
| O12 | The model and effort a driving session runs at are per-invocation launch settings the owner chooses. `INV-3` also forbids this repository carrying a machine-local setting | shell functions, installed skills, machine-local settings |

**What the document still owes, so this block absorbs nothing:** O04's walkthrough statement at Leg 2
that no repository command opens a marimba session, that the session is opened by an owner-installed
launcher carrying marimba's settings and the appended contract, and that both must be working before
Leg 2 begins. The plan already requires it: *"the document's first two legs must be readable by
somebody who has done neither."*

#### `OWNER-BUILDER-WRITE-SCOPE` — one protected-config amendment

| Entry | The owner-side act | Spine bullet it confirms against |
| --- | --- | --- |
| O36 | The `builder` agent's `writes` list in `awsf.config.yaml:57` is `["core/src/**", "core/test/**", "dashboard/**", "prompts/**"]`, which excludes `specs/**`. The worker could not have flipped a plan marker or a ticket `state` even had the request asked it to. Widening or re-scoping that list is a protected-config change: `awsf.config.yaml` is in `policy.protected_paths`, this set's third prohibition forbids writing it, and gate **G2** requires the amendment to land as an owner-approved commit before the workstream that needs it builds | *"Every invariant and protected-config amendment. One owner-authored commit each, one at a time, recorded in the Amendments section of the plan that needed it"* |

**Read this beside `W01-TICKET-PROMPT-FIDELITY`.** O35 and O36 are two independent causes of the one
mismatch O28 recorded, and fixing either alone leaves the mismatch: a verbatim ticket prompt still
cannot write `specs/**`, and a widened write scope still receives a request that told the worker not
to. The owner decides whether the ticket's closure work belongs to the worker at all or stays with
the host at land time — and that decision, not either fix, is what closes O28.

## The graduation record — filled by T19, T20 and T21

Two runs, one protocol, no edits between them. Run one is recorded below; run two remains empty until
T20.

**Two rows that are allowed to disagree, and why they were split.** `AC-9` asks whether a run
*reached the owner act with the evidence that act requires*. T02's drive did exactly that —
`AWAITING_OWNER`, three gates green, full evidence — and the candidate still did not do what the
ticket asked (**O28**). By `AC-9`'s letter that run was a success, which is the one reading this
workstream cannot afford. So the record carries **two separate rows**: whether the run reached the
owner act, and whether the candidate met the acceptance boundary stated before it started. A run
where the two disagree is a **finding**, not a pass, and it is recorded as one.

**The boundary is written before the run, not after it.** The frozen protocol's Leg 3 already
requires the driver to describe *"the desired result and acceptance boundary"*; this row records the
boundary as supplied before launch, rather than adjusting it to fit what arrived.

| | Run one | Run two |
| --- | --- | --- |
| Request | Carry the desktop dashboard into named light and dark palettes while preserving its structure and information hierarchy; retain the current style as an option; add a minimal Lab-palette menu with palette and Light/Dark/System selection; enlarge selected type and replace and enlarge the agent-phase icons. The six added ramps came from an owner-side external style guide. | Bring the dashboard backlog up to date so it reads the spine, deep plans and ticket states. Group expandable tickets by plan; show each ticket byte-identically to its Markdown source; add informative, filterable, multi-select plan cards in one horizontally scrollable styled row; render no tickets until a plan is selected; and provide Select all. |
| **Acceptance boundary, written before the run starts** | The desktop dashboard consistently applies the selected colors without replacing the current style or changing its structure; the menu, three display modes, larger type and distinct enlarged phase icons work; the repository checks still pass. This was broader than T19's planned Forest-only request and named the worker roles rather than leaving the route wholly to marimba. | Every selected spine or deep-plan card shows its own status counts and groups all of its tickets in the backlog; every ticket expands to the byte-identical Markdown source; multi-selection, Select all, filtering and the styled overflow row work; no selection renders no tickets. The owner supplied the result as one paragraph and left the plan to the factory. |
| **Reached the owner act with the evidence it requires** (`AC-9`) | **Yes.** The first visual handoff was a static reconstruction and was insufficient. The owner asked for the actual candidate, then inspected it in Chrome at desktop size. Instrumented checks covered 34 captures, persistence, live System-mode response, overflow, clipping, overlap and Classic comparison. The task remained at `AWAITING_OWNER`; no owner act was performed. | **Yes, as a refusal rather than a candidate handoff.** Workflow compilation refused the prepared attempt before its planning phase because the mandatory opposite-provider review resolved to the same provider as the phase the inversion logic treated as the worker. The handoff named the failed precondition, zero spend and the available owner decisions. The owner performed none. |
| **Candidate met the stated acceptance boundary** — recorded separately, and allowed to disagree with the row above | **Owner judged yes after inspecting the live candidate, with disclosed deviations.** The structure and information hierarchy remained, while larger type made the page and agent lanes taller. Classic retained its surfaces, borders and text colors but intentionally inherited the new accent and font size. The reviewer also recorded low contrast in one dark palette, light shadow halos in dark palettes, a mode-label mismatch for Classic and two tests that assert shadowed declarations rather than runtime values. | **No candidate existed.** No phase ran, so the acceptance boundary was not evaluated. This is a factory result, separate from what the document proved. |
| Consultations | **11**, recorded verbatim below. | **8**, recorded below. |
| Where the driver looked first | `Prime a session` before priming; the support conversation rather than `Give it one small job` before writing the expanded request; the dashboard card before asking about prepared and running state; `Stop at the signature` before requesting the final comparison; the static reconstruction before requesting the live candidate. | marimba's priming handoff before making the request; unaided memory of run one rather than any document section while writing it; the refusal handoff when launch stopped; then the support conversation and marimba's diagnosis while deciding whether a two-provider route could proceed. |
| Reference sections used | **None.** | **None.** The driver opened no part of the document during run two. |
| Reference sections never opened | `Commands`; `Lifecycle states`; `Legal edges`; `Owner acts`; `Workflows and gates`; `Risk tiers and call ceilings`. | `Commands`; `Lifecycle states`; `Legal edges`; `Owner acts`; `Workflows and gates`; `Risk tiers and call ceilings`. |
| Cost, against what the document said | **Two provider calls:** one build and one review. The refused first launch spent zero. This matched the document's claims that only Leg 3 spends, that no free driven rehearsal exists, and that a review route buys another opinion. It did not match the walkthrough example's one-call expectation because the expanded request explicitly chose a build-and-review route. Spend remained inside the T2 ceiling of five, though the driver never opened that reference section. | **Zero provider calls.** The document says a driven job spends on Leg 3; this request was refused during pre-launch workflow compilation, so the refusal itself cost nothing and the planned work never began. |
| What the factory produced, and whether it landed | Seven dashboard files changed: runtime palette and mode handling, persistence, a Lab-palette menu, larger type, and distinct enlarged phase icons. Unit tests reported 1509 pass and 0 fail; typecheck exited 0; lint reported no warnings or errors; the dashboard build and diff check exited 0. **It landed after the graduation protocol stopped.** The protocol itself stopped before the owner act; afterwards the owner personally attested the live journey and landed the existing candidate by local fast-forward, with no rebuild and no further provider call. | The factory produced a zero-spend refusal with the failed provider-inversion precondition and owner choices. It produced no plan, candidate or gate evidence, and nothing landed. |

### Run one consultations, in occurrence order

The quotations preserve the driver's words. One absolute path, every live handle, the candidate
revision, local ports, process number, artifact address and managed-worktree path were removed during
the scrub. Raw notes remain outside the repository.

1. **Leg 3, before the request — support conversation.** The driver used W12's supplied request as
   the starting point, then expanded it. Question answered: what paragraph should be given to
   marimba. The supplied words began: **“Carry the dashboard to the Forest palette in its desktop
   view while keeping its existing structure and information hierarchy.”** First look: the support
   conversation; `Give it one small job` was not opened.
2. **Leg 3, while expanding the request — owner-side external style guide.** Question answered,
   verbatim: **“Where you can get the six new pallet colors is from this document in the ‘Style
   guide sheet’ section.”** The source's machine path was scrubbed. First look: the draft request.
3. **Leg 3, after preparation — marimba's preparation handoff.** No question was asked; the driver
   read the staged scope, route, zero-spend state and request for permission to launch. First look:
   the new dashboard card, reported verbatim as **“I currently see the new session card prepared in
   the dashboard.”**
4. **Leg 3, after `PREPARED` and before spend — support conversation.** Question answered: whether
   to authorize the paid run after marimba stopped. The owner's resulting instruction was verbatim:
   **“run it with awsf”.** First look: the prepared dashboard card.
5. **Leg 3, at launch — marimba's refusal and replacement account.** Question answered: why the
   prepared task did not run and what happened next. The factory refused because the review workflow
   required T2 while the task had been prepared at T1; zero calls were spent. marimba described this
   verbatim as **“Small hitch, corrected”**, created a replacement at T2 and continued without first
   stopping for the owner to read the refusal or choose an owner decision. This is a factory-driving
   finding, separate from the document rows.
6. **Leg 4, after replacement — dashboard session card.** Question answered: whether the replacement
   had entered the factory and was running. The driver's report was verbatim: **“it had to create a
   new session card but now I can see the session running in the dashboard”.** First look: that new
   card.
7. **Leg 6, first owner-gate handoff — marimba.** No question was asked; marimba reported what the
   factory produced, the gates, review findings, two calls spent, remaining allowance and owner
   options. First look: marimba's handoff. The driver then opened `Stop at the signature`.
8. **Leg 6, after reading `Stop at the signature` — marimba.** The owner's question was verbatim:
   **“Show me the request as the factory received it, and how the candidate compares with the
   boundary I gave you. and supply the missing visual evidence.”** It answered request fidelity,
   candidate-to-boundary comparison and the available visual evidence. First look: `Stop at the
   signature`.
9. **Leg 6, first visual check — generated static reconstruction.** Question answered: how the seven
   palettes and three modes looked at desktop size. The owner found it useful but insufficient,
   verbatim: **“it is not the actual result.”** First look: the reconstruction supplied by marimba.
10. **Leg 6, after the static check — support conversation.** The owner's question was verbatim:
    **“So do you recommend me asking marimba that I want to see the actual dashboard changes in
    chrome, and can marimba execute the commands to run that version of the dashboard?”** It answered
    whether a live candidate render was appropriate evidence and whether marimba could serve it
    without taking an owner act. First look: the static reconstruction.
11. **Leg 6, final visual check — actual candidate dashboard and marimba's instrumented browser
    results.** Question answered: whether the real candidate met runtime palette behavior and desktop
    visual constraints. The driver inspected the live candidate and reported verbatim: **“Im
    honestly impressed with the results, I like them so I think im ready to land it”.** First look:
    the actual candidate in Chrome. The owner reported no other source or unaided-memory consultation.

### Run one expectation mismatches

1. The first paid launch was prepared at the wrong tier and refused before spend.
2. Instead of stopping at that genuine refusal, marimba created a replacement task and continued.
3. The first owner-gate handoff supplied a static reconstruction rather than the live candidate, so
   it could not prove persistence, System-mode response or parity.
4. The live candidate closed that evidence gap, but disclosed the layout growth, Classic accent
   difference and four reviewer tradeoffs recorded in the table above.

### Run two consultations, in occurrence order

The quotations preserve the owner's words where a question was asked. Every live handle, attempt
number, revision, timestamp, machine path and owner-side memory filename was removed during the
scrub. Raw notes remain outside the repository.

1. **Leg 2, after priming — marimba's priming handoff.** No question was asked; it confirmed the
   governing reads in their prescribed order, a green toolchain preflight, the guard boundary and
   readiness to drive. First look: marimba's response.
2. **Leg 3, while writing the request — unaided memory of run one.** Question answered: how to shape
   the second graduation request. The owner said verbatim: **“memory since I performed the first
   graduation task in the previous ticket.”** First look: memory of performing run one. No section
   of the document was opened.
3. **Leg 3, at launch — marimba's refusal handoff.** No question was asked; it answered why no phase
   ran, which provider-inversion precondition failed, what remained unspent and which owner decisions
   were available. First look: marimba's handoff.
4. **Leg 6, after the refusal — support conversation.** The owner's question was verbatim: **“I do
   want to use the double provider so what should we do?”** It answered which read-only diagnosis to
   request before choosing a route. First look: the refusal handoff.
5. **Leg 6, route diagnosis — marimba's read-only account of the runner and committed routing.**
   Question answered: whether provider availability, authentication, environment or committed
   routing caused the refusal. It found committed routing: review inversion keys off the first agent
   phase, which is the planner on this workflow, while the configured reviewer resolves to the same
   provider. First look: marimba's diagnosis.
6. **Leg 6, after diagnosis — support conversation.** The owner's question was verbatim: **“how
   should I procede now?”** It answered that the two-provider route which already worked omitted the
   factory-planning phase required by this graduation, so the run should stop at the factory finding
   rather than switch routes. First look: marimba's diagnosis.
7. **Leg 6, deciding the immediate next step — support conversation.** The owner's question was
   verbatim: **“then what should we do?”** It answered how to stop without an owner act or a
   replacement task, and what evidence the graduation record still needed. First look: the prior
   support answer.
8. **Leg 6, final stop — marimba's handoff.** No question was asked; it confirmed the provider-
   inversion finding, zero spend, no owner act, no replacement and the blocked attempt left
   unchanged. First look: marimba's response.

### Run two expectation mismatches

1. **Before the drive, monitoring setup:** this task session was expected only to monitor and record
   the owner's separate marimba drive. It initially began the protocol itself and attempted to
   create the factory job. The command aborted before creation, the owner corrected the boundary,
   and no repository change resulted.
2. **Leg 3:** the selected workflow was expected to plan and run the backlog job. Instead, workflow
   compilation treated its first agent phase as the worker for review inversion, resolved the
   mandatory reviewer to the same provider, and blocked before the planning call.
3. **Leg 6:** the existing two-provider workflow was expected to be a possible replacement, but its
   route does not contain the factory-planning phase this graduation requires. Switching to it would
   have changed the acceptance boundary rather than completed the request.

**The delta, and which of the three readings it fell under:** consultations fell from **11 in run
one to 8 in run two**, a delta of **−3**, so this is the plan's **fall** reading: the document is
being learned from. The evidence is limited and mixed. The driver opened no section in run two and
said explicitly that fresh memory of run one supplied the request shape; memory was itself recorded
as consultation 2, and seven more outside consultations were still needed. The two sections opened
in run one and not run two were `Prime a session` and `Stop at the signature`. The sections never
opened in either run were `Start here`, `Install it`, `Give it one small job`, `Watch it work`, `Read
a refusal`, `What you are never asked to do`, `What this document owns`, `What this document does
not cover`, `Commands`, `Lifecycle states`, `Legal edges`, `Owner acts`, `Workflows and gates`, and
`Risk tiers and call ceilings`. That is a finding about the document's shape and the driver's route
through it, not proof that any unopened section is unnecessary.

**The stated limit** *(repeated by both runs)*: the driver is the factory's author, so these runs
prove only that the document is sufficient to drive with, not that it is comprehensible to somebody
new. Run two's eight consultations and its reliance on memory prevent reporting it as a clean
external pass. The factory's zero-spend refusal is a separate finding and does not strengthen or
weaken that document claim.

## T21 — every graduation consultation closed

All nineteen consultations, eleven from run one and eight from run two, carry exactly one of T03's
four dispositions. Entry `1.n` is run one's consultation `n` and `2.n` is run two's, numbered as
recorded above. No two were merged: where two entries share an answer, each names the sentence that
answers it.

**The rule that separates `document` from `accepted absence` here.** Several consultations were
reads of a surface the document already sent the reader to at that point, and the answer was the
job's own facts: its card, or marimba's report. A document cannot contain one job's facts, so those
are accepted absences. A consultation is `document` when the document, at the point it happened,
did not yet say what the reader needed. Every such answer is a new or changed sentence in
`docs/cheatsheet.html` at that leg.

| Entry | Leg and point | Disposition | Answered where, or the reason and what reopens it |
| --- | --- | --- | --- |
| 1.1 | Leg 3, before the request | document | **Give it one small job**, the new paragraph after the worked example: a real job is written in the worked example's four parts, the boundary is written before launch because leg 6 compares against it, and the route stays out of the paragraph |
| 1.2 | Leg 3, expanding the request | accepted absence | **Reason:** the style guide supplied the job's subject matter, not knowledge of the factory, and no driving guide can hold one job's content. Limits bullet *What your job is about*. **Reopens:** a run in which the factory cannot reach material the request names, which is a factory question, not this document's |
| 1.3 | Leg 3, after preparation | document | **Give it one small job**, *marimba may stop after preparing and ask before it runs*: what the stop at `PREPARED` reports, and that it is the cheapest point to check the recorded request |
| 1.4 | Leg 3, after `PREPARED`, before spend | document | **Give it one small job**, *Your answer to that stop is the spending decision*: go means the first route and a spent call, no means a prepared job that cost nothing |
| 1.5 | Leg 3, at launch | document | **Give it one small job**, two paragraphs: a refusal can arrive at launch and is read with leg 5's four things, and a replacement job created to get past a refusal is the owner's decision, to be seen and agreed before it runs |
| 1.6 | Leg 4, after the replacement | accepted absence | **Reason:** the job's dashboard card is the surface leg 4 already named for *has it started*, and the answer was that job's own state. Limits bullet *Your job's own account*. **Reopens:** a run in which the card cannot answer a leg-4 question the document sends the reader to it for |
| 1.7 | Leg 6, first handoff | accepted absence | **Reason:** marimba's owner-gate report is the fixed set leg 6 already listed, and it carried that job's own evidence. The driver then opened the document. Limits bullet *Your job's own account*. **Reopens:** a handoff that needs a fact outside leg 6's fixed set |
| 1.8 | Leg 6, after reading `Stop at the signature` | document | **Stop at the signature**, *Some changes can only be judged by looking at them*. The first two clauses of the question were the document's own *Ask for* line verbatim; the third, visual evidence, had no answer until this sentence |
| 1.9 | Leg 6, first visual check | document | **Stop at the signature**, *A picture of the candidate is not the candidate*: a reconstruction is the claim half of claim and measurement |
| 1.10 | Leg 6, after the static check | document | **Stop at the signature**, *Asking marimba to build the candidate and show it to you is a read*, with an *Ask for* line |
| 1.11 | Leg 6, final visual check | accepted absence | **Reason:** inspecting the candidate against the boundary is the owner act's own evidence, and the document's job is to send the reader there, which 1.8–1.10 now do. Limits bullet *Whether the candidate is right*. **Reopens:** a run in which judging the candidate needs a source other than the candidate itself |
| 2.1 | Leg 2, after priming | accepted absence | **Reason:** leg 2's *How to read what comes back* already said what a priming report contains, and the report carried that session's own facts. Limits bullet *Your job's own account*. **Reopens:** a priming report containing something that section does not cover |
| 2.2 | Leg 3, writing the request | document | **Give it one small job**, the same paragraph as 1.1. Kept separate from 1.1 because this entry is memory of run one rather than a conversation, which `AC-10`'s read-or-remembered check needs to see |
| 2.3 | Leg 3, at launch | document | **Give it one small job**, *A refusal can arrive here, at launch*. The same paragraph answers the first half of 1.5; the replacement half of 1.5 has no counterpart here, because run two created no replacement |
| 2.4 | Leg 6, after the refusal | document | **Stop at the signature**, new subsection *When the route ended in a refusal instead*: a refused job reaches leg 6 without a candidate, and the first thing to ask for is a read-only diagnosis of the cause, with an *Ask for* line |
| 2.5 | Leg 6, route diagnosis | document | Same subsection, *The diagnosis is marimba's reading to do*: marimba may read configuration or source, the reader should not have to, and what comes back is which of four causes it is |
| 2.6 | Leg 6, after diagnosis | document | Same subsection, *Only the first is yours to fix by changing the request*: a route that skips a step the boundary required swaps the job for a smaller one |
| 2.7 | Leg 6, deciding the next step | document | Same subsection, *Stopping is a complete ending*: leave the refused job as it is, with no replacement and no owner act, and treat a cause in the factory as a finding for its maintainer |
| 2.8 | Leg 6, final stop | accepted absence | **Reason:** marimba's closing report confirmed that job's own state, and 2.7's sentence now says what a stop leaves. Limits bullet *Your job's own account*. **Reopens:** a stop whose report the leg-6 subsection does not explain |

| Disposition | Entries | Count |
| --- | --- | ---: |
| **document** | 1.1, 1.3, 1.4, 1.5, 1.8, 1.9, 1.10, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7 | 13 |
| **route** | none | 0 |
| **owner-side** | none | 0 |
| **accepted absence** | 1.2, 1.6, 1.7, 1.11, 2.1, 2.8 | 6 |
| | | **19** |

**One sentence outside the consultation points changed, and why.** Leg 5 ended by saying the move
after a refusal is *always* to change the request. Run two refused on the factory's own route, where
changing the request fixes nothing, so 2.6's answer would have contradicted it. The sentence now says
the move is to change the request, or to stop when the cause is the route, and points to leg 6.

**No consultation is routed, so no plan row is `[f]`.** Every consultation's answer was reachable
without a factory change. The factory causes behind both runs' refusals are factory results, recorded
below, not document gaps. Run two's cause, review inversion computed against the planner instead of
the builder, was fixed by `1aafbe5` after T20's record, and the plan's 2026-08-30 Amendment records
the inversion holding on the next live drive.

**The six accepted absences are in the document's limits section** as three bullets: *What your job
is about* (1.2), *Your job's own account* (1.6, 1.7, 2.1, 2.8) and *Whether the candidate is right*
(1.11). Each entry keeps its own reason and reopening evidence in the table above.

### What the factory produced, recorded apart from what the document proved

The two claims are separate. The document's claim for both runs is the one already stated: sufficient
to drive with, 11 and then 8 consultations, author-driven. The rows below are the factory's result
for each real task, and a factory failure in them is not a document failure.

| Task | Under the frozen protocol | After the protocol stopped | Landed |
| --- | --- | --- | --- |
| Run one: dashboard palettes | A build-and-review candidate at T2 on two provider calls, after a zero-spend refusal of the same job prepared at T1: seven dashboard files, unit suite 1509/0, typecheck and lint clean. The protocol stopped at `AWAITING_OWNER` | The owner attested the journey and landed the same candidate by local fast-forward, with no rebuild and no further call | **Yes**, `5985f52` |
| Run two: plan-grouped backlog | A zero-spend refusal before the planning phase: the mandatory review resolved to the planner's provider. No plan, candidate or gate evidence | Recorded in the plan's Amendments: three `simple-sdlc` attempts blocked at the planner's gates (2026-08-30); a `build-review` candidate that was gate-green and accepted but stranded at `REVIEWING` (2026-08-30); a `simple-sdlc` attempt whose planner never received the request and built a different task (2026-08-31); then two `build-review` T2 drives with an owner rework between them that blocked, of which the second reached `AWAITING_OWNER` with verdict `accept`, 17 of 17 gates and 2 calls (2026-09-03) | **Yes.** The 2026-09-03 Amendment records the journeyed landing at `1d34a02`. `main` shows the grouped backlog arriving at `2fb0bc6`, the parent of `1d34a02`, which that Amendment does not attribute to a run |

**The factory findings from the runs' expectation mismatches stay factory findings.** Run one's
second mismatch, marimba creating a replacement job after a refusal and continuing without stopping
for the owner, is not a consultation and is not dispositioned here. The document now tells the reader
to expect to see a refusal before any replacement (1.5). No route for marimba's behaviour was written
by T19, T20 or this task.

### Fences re-run over the edited document

The edits added no section, no index entry, no command block and no external reference.
`node --experimental-strip-types --test core/test/unit/meta/cheatsheet-reconciliation.test.ts` runs
the six class fences, the command fence, the reader-warning fence, the index fence and the
offline fence over `docs/cheatsheet.html`: 20 pass, 0 fail, exit 0. Re-running the induced-failure
legs is T22's.

## M3 close — T15 walkthrough coverage and fence evidence

The sixteen `document · walkthrough` entries are answered at the point where the reader needs them:

| Entries | Where in `docs/cheatsheet.html` |
| --- | --- |
| O02, O03, O17, O18, O19 | **Give it one small job** — the requested result, six-leg order, route choice, and configured worker |
| O04 | **Prime a session** — the owner-installed launcher boundary |
| O22, O23, O26, I5 | **Watch it work** — request, builder, checks, and the dashboard/session split |
| O28, O34, O40 | **Stop at the signature** — candidate versus request, evidence, and unchanged waiting state |
| O29, O32 | **Read a refusal** — readable refusal evidence and durable project-namespaced history |
| I4 | **Start here** and **Give it one small job** — real provider cost and the spend point |

T15 induced each real-file failure with `node --experimental-strip-types --test core/test/unit/meta/cheatsheet-reconciliation.test.ts`: `docs/cheatsheet.html` plus `awsf frobnicate`; deleted and late reader warning; missing `limits` index entry and dangling `no-section` entry; and an external stylesheet at `https://example.test/induced.css`. Each run failed one target assertion and restored green. A local Chrome headless render of the file with `--host-resolver-rules="MAP * 0.0.0.0"` succeeded. The live-id scan found no task, attempt, session, run, revision, or UUID-shaped identifier beyond the `TASK` and `PROJECT` placeholders; the absolute-path scan found none. Tier labels are canonical fenced values, not live identifiers.

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
