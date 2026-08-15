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

**2. The last envelope.** The phase's own claim about what it did lives under the
attempt's `envelopes/` directory, one immutable file per phase and correction
round. This is where a producer says it succeeded, which is a different question
from whether the host agreed.

**3. The gate rows.** What the host measured, per gate, for that phase. This is
the half that disagrees with step 2, and the disagreement is the finding. A phase
claiming success beside a failed gate row is not a contradiction to resolve — it
is the normal shape of a block, and the gate is the one that is right.

**4. The retained command output.** When a configured command is what failed, its
bounded evidence carries three windows — the opening, the first failure with its
surroundings, and the summary — with an explicit note of how much was omitted.
Read the middle one first. It exists because a trailing window alone can hold the
count or the cause but never both.

**5. The process record.** Only when steps 1–4 disagree with each other, or when
nothing appears to have run at all.

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

**The gathering.** Steps 2, 3 and 5 above are archaeology: the blocker is
displayed, but the failing gate rows, the last envelope and the retained process
record are not, so reading them means walking the state root by hand. That is
work a command should do, and prose asking a human to do it reliably is a defect
wearing a cookbook's costume.

The gap is **narrower than it is sometimes described**, and the narrowing is
worth stating rather than repeating a stale claim. The status display is not one
budget line; it prints nine, and it already carries the blocker code and detail,
the phase and its state, correction rounds against their maximum, calls spent and
reserved against the ceiling, the resolved model with its provenance, the last
activity, the per-phase correction budget, the attempt-scoped owner re-entry
allowance, and a next action. What it does **not** print is the failing gate
rows, the last envelope, and the retained process record — which is precisely
steps 2, 3 and 5.

So the backlog item is an evidence mode on the status command that prints those
three beside the blocker it already shows, and it is recorded in the plan's
Amendments in those terms. It does not exist today, and `awsf status` accepts no
flags of its own — do not write one into a runnable block on the strength of this
paragraph. Until it lands, this cookbook teaches the judgment and the archaeology
is done by hand, which is an open defect and not a habit this document has
quietly absorbed.
