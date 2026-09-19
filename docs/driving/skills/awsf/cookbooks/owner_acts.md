# Owner acts

Nine commands are the owner's and not yours: `journey`, `land`, `cancel`,
`rework`, `review`, `degrade-review`, `raise`, `publish`, `resume`. This document
is about **which one the evidence supports** and **what to hand the owner before
they decide**. It is not a table
of what each one costs, and the reason is at the bottom.

## The rule

Prepare and explain. Never perform, and never recommend performing one without
the evidence its edge requires.

This is not merely a convention you could talk yourself out of — the lifecycle
refuses a non-interactive invocation. Every one of the nine requires an
interactive owner terminal, and a piped or redirected standard input is
refused by the normative machine *before* any process can receive a signal and
before any call is reserved. That refusal is a terminal-shape check, not the
authorisation boundary: it stops an accidental non-interactive invocation, and
the boundary a driving session actually operates under is the per-invocation
tool-surface denial marimba's guard performs.

The evidence each edge demands is in `core/src/state/guards.ts`, and the edges
themselves in `core/src/state/task-machine.ts`. Read them there when it matters.

## Read the confirmation prompt; it is the source of truth

Each of these commands displays what it is about to do and then asks. **The
prompt is the authority on the cost and the consequences of that act, at that
moment, for that attempt** — not this document, not your memory, and not a
summary you wrote earlier in the session.

The prompts are not advisory copy. `awsf review`'s is asserted line by line by a
test: it must carry the candidate, the superseded verdict and the evidence defect
that made it replaceable, the spend against the ceiling, the state the attempt
leaves and the state it enters, and the fact that once the allowance is spent the
other two owner re-entries are gone.

So the useful thing you can do is **run the command and read its screen to the
owner**, rather than paraphrasing a table. If a prompt does not say what it
should, that is a defect in the command — say so and fix it there.

## Choosing between them

The question is always the same: *what does the evidence support?*

**`journey`** is an attestation, not an action. You are recording that a human
exercised a named journey against an exact revision and it passed. The command
checks separately that the revision resolves and that the journey report says
what it claims. **You cannot attest on the owner's behalf**, and preparing the
attestation means telling the owner exactly which revision they need to have
exercised — not the branch, the revision.

**`land`** is the end of the road and the only place the change leaves the
managed worktree. It is a local fast-forward the owner authorizes at a terminal,
and it reaches no remote: publishing is a separate act, taken later and only on
what has already landed. The screen shows the candidate, a summary, the
fast-forward meter, and — when a review was replaced — both verdicts side by
side. Prepare it by making sure the gates, the required
review and the attestation are all genuinely present, rather than by asking.

**`publish`** settles that the exact landed revision reached its configured remote branch. It forecloses every later act on that attempt: publication transitions it to `PUBLISHED`, which seals it. Prepare it only when the owner should make this the attempt's final act, with the exact revision, remote name and branch they are about to confirm.

**`cancel`** ends the attempt. Reach for it last. A cancelled attempt is still
retained evidence, but the decision to stop is the owner's, and the case for it
has to be made from what was read, not from impatience. Read
`read_a_blocked_attempt.md` first, always.

**`rework`** re-runs one writable builder phase against the same candidate with a
defect you describe. It is the right act when the build is wrong in a way you can
state in a sentence and the surrounding evidence is sound. It is the wrong act
when you cannot name the defect, and it is **refused outright above the middle
tier** for a structural reason worth understanding rather than memorising — see
`gotchas.md`.

**`raise`** is one of the two that buy nothing and move no state. It grants one
named task more calls while its attempt is live, so a run that halted at its
ceiling can continue instead of being cancelled and re-rolled. Two things about
it are worth understanding rather than memorising. It is a **command and not a
configuration edit**, because an attempt is compared against the configuration
snapshot it recorded before `rework` and `review` — editing `awsf.config.yaml`
mid-attempt would lock the owner out of exactly the acts the raise was for. And
it is **bounded and task-scoped**: there is no unbounded grant, and a grant made
for one task widens nothing else. Preparing it means telling the owner what
halted, what the next act needs, and what the raise would cost them — never
performing it, and never proposing it as a way around a refusal that was about
evidence rather than about budget.

**`degrade-review`** is the other. It lets one attempt buy its review from the
provider that wrote the candidate, which the factory otherwise refuses: two
models from one provider are still one provider, and a provider checking its own
output finds less than an independent one. It is a command and not a
configuration edit for the same reason `raise` is, and it is **attempt-scoped and
unrepeatable** — one grant per attempt, and a retry asks the owner again rather
than inheriting it. Prepare it when the owner is provider-constrained and says
so; state what it costs in the same breath, because the candidate it produces is
weaker evidence than a cross-provider run. Never propose it as a way around a
quota wall on your own initiative, and never describe the host as able to select
it: a quota error, a transport failure and an unavailable adapter each leave the
review independent, by construction. `select_a_route.md` has the rest of the
routing picture.

**`review`** buys one replacement review, and only when the recorded review is
genuinely unevidenced. Eligibility is determined by the host from the recorded
evidence row, so a review that carried passing evidence is refused at zero cost
no matter how much you disliked its verdict. The command requires a written
reason, and the reason is a record rather than a key: it does not unlock
anything.

**`resume`** continues an unstarted phase from a journal-backed quota pause, or
finishes a phase result that the host already validated and durably accepted.
It preserves the original request, accepted phases, candidate and debit. It does
not reopen a genuinely interrupted model turn. Missing checkpoints, unsettled
execution, changed bindings and unknown quota refuse. Read the evidence and
prepare the owner command with a reason. Restart a driving session after updating
its guard so its loaded rules include this act.

## What to hand the owner

The same shape every time, and it is short:

- the handle — task, attempt, lifecycle state, calls spent against the ceiling;
- what the evidence says, with the phase's claim and the host's measurement kept
  distinct;
- which of the nine the evidence supports, which it does not, and why;
- what remains — calls, correction rounds, and the attempt-scoped owner re-entry
  allowance, which is what several of these draw on and which does not refresh
  within an attempt.

Then let them read the confirmation screen and decide.

## What is deliberately not in this document

**A table of what each act costs and what each invalidates.** That is the thing
§V.5 principle 4 forbids most directly: ceilings, allowances and invalidation
rules are single-sourced in the state machine and the ledger, and a markdown copy
drifts the moment any of them moves — silently, in the document a session trusts
at the exact moment it is spending the owner's money.

The right home for that information is **each command's own confirmation prompt**,
where it is computed from the attempt in front of it and cannot be stale.
`awsf review` already does this and is the model. The others are uneven, and the
gap is real rather than rhetorical:

- **`cancel`** displays nothing but the question. It does not say that the spend
  is not refunded, or that a retry carries it forward.
- **`land`** displays the candidate, a summary and the fast-forward meter, but no
  statement of what landing settles or forecloses.
- **`rework`** displays the route and what remains of the budget and the owner
  re-entry allowance — good on cost — but never says in words that it invalidates
  the gates and the recorded review, even though its own transition evidence
  records exactly that.

So the backlog item is: **bring `cancel`, `land` and `rework`'s confirmation
prompts up to `awsf review`'s standard — each stating its own cost and its own
invalidation, computed at the prompt.** It is recorded in the plan's Amendments
in those terms. None of it is implemented here; this is a document commit, and
until it lands the gap is an open defect rather than a habit this document has
absorbed by writing the table anyway.
