# Read a blocked attempt

**Do not cancel and retry before you have read the evidence.**

That is the entire document, and everything below is why and how.

A blocked attempt, and an attempt waiting on the owner, are both **retained on
purpose**. The journal, the envelopes, the gate rows, the raw command output and
the process record are all still there, and they are there because a system that
tore them down would throw away the only account of what went wrong. Cancel and
retry is the move that discards them in effect: the attempt is superseded, the
spend carries forward, and the question that caused the block is asked again with
no more information than the first time.

The discipline is the same one the gates already follow. A gate that fails
**reports, stops, and leaves the evidence in place**. Do the same.

## Read in this order

Stop at the step that answers you. Most blocks are answered by step 2.

**1. The state line.** The status display already carries the blocker code and
its detail beside the lifecycle state, and a single next action.

```bash
just awsf status TASK
```

The blocker code is a vocabulary, not a sentence: it names the *class* of the
refusal. The detail beside it is the instance. Read both — a session that reports
only the code has told the owner which drawer the answer is in.

**2. The last envelope.** The phase's own claim about what it did. This is where
a producer says it succeeded, which is a different question from whether the host
agreed.

**3. The gate rows.** What the host measured, per gate, for that phase. This is
the half that disagrees with step 2, and the disagreement is the finding. A phase
claiming success beside a failed gate row is not a contradiction to resolve — it
is the normal shape of a block, and the gate is the one that is right.

Steps 2, 3 and 5 are one command:

```bash
just awsf status TASK --evidence
```

It appends three sections under the nine the state line already prints: the
failing gate rows with each failed sub-check and its note, the last envelope
verbatim with its validity, and the retained process record. The envelopes stay
on disk under the attempt's `envelopes/` directory, one immutable file per phase
and correction round, and `evidence_map.md` says where each lives — read them
directly when you need a round the command does not surface.

**4. The retained command output.** When a configured command is what failed, its
bounded evidence carries three windows — the opening, the first failure with its
surroundings, and the summary — with an explicit note of how much was omitted.
Read the middle one first. It exists because a trailing window alone can hold the
count or the cause but never both.

**5. The process record.** Only when steps 1–4 disagree with each other, or when
nothing appears to have run at all. `--evidence` prints it too.

`evidence_map.md` says where each of these lives. `lifecycle.md` says which
source owns the vocabulary each one speaks.

## What you are deciding

You are not deciding what to do. You are deciding **what the owner needs to know
in order to decide**, and the shape of that report is fixed:

- the handle — task, attempt, lifecycle state, calls spent against the ceiling;
- the blocker, code and detail;
- what the phase claimed, and what the host measured, side by side;
- which owner acts the evidence actually supports, and which the lifecycle would
  refuse — `owner_acts.md`;
- what remains: calls, correction rounds, owner re-entries.

Then stop. Every remedy for a blocked attempt is an owner act performed at a
terminal, and recommending one without the evidence its edge requires is the
failure this document exists to prevent.

## Two traps specific to reading a block

**A retry is not free and not a rewind.** Spend is scoped to the task rather than
to the attempt: a new attempt carries the calls the old one spent, so retrying a
top-tier attempt that already spent most of its ceiling produces an attempt that
cannot finish. Check what remains before you suggest it.

**The absence of a failure is not evidence of success.** A phase that shows
failed may never have completed, and a phase still queued never started — see
`run_and_observe.md`, "Every phase starts failed". A blocked attempt frequently
contains several phases in the default state that are simply phases nothing ever
reached.

## What is deliberately not in this document

**The gathering used to be archaeology.** It is not any more. The status display
prints nine lines — the blocker code and detail, the phase and its state,
correction rounds against their maximum, calls spent and reserved against the
ceiling, the resolved model with its provenance, the last activity, the per-phase
correction budget, the attempt-scoped owner re-entry allowance, and a next action
— and `awsf status TASK --evidence` prints the three that were missing beside
them: the failing gate rows, the last envelope, and the retained process record.
Use the flag. Walking the state root by hand is now a fallback for a specific
round or a raw output window, not the normal path.

What this document still does not contain is **the judgment**, and that is
deliberate. The command gathers; it does not tell you which disagreement between
step 2 and step 3 is the finding, which owner act the evidence supports, or when
the honest answer is that nothing ran. That is the whole of the reading above and
it is not a gap.

One thing the command cannot do is decide for the owner. Every remedy is an owner
act at a terminal, and `--evidence` makes the case readable rather than making it
for you.
