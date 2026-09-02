# How to prompt, for the owner

The request text is the one artefact a driving session authors itself. Everything
else it does is choosing a command and reading a result.

**The four-line shape lives in `preflight_a_task.md` §1** — the ask, Where, Done
means, Out of scope — because that is the document open at the moment the shape
is used, and a pointer standing where a checklist should be is worse than a
short duplicate. This document is the other half: how to get four good lines out
of one sentence, and how to tell when you have not.

## Why this is worth a document at all

The request is persisted by `awsf new`, and the production runner renders it into
the plan envelope every later phase reads
(`core/src/cli/commands/production-run.ts`). It is also carried verbatim into an
attempt's review evidence, so the reviewer is judged against the same words the
builder was. One sentence is therefore read by every agent in the chain, and at
the top tier the chain is bought against a ceiling of a handful of calls.

That is the whole argument, and it is arithmetic rather than taste: a vague line
is not a small tax, it is paid again at every phase, and the phases are the
budget.

## The intent is the owner's; the precision is yours

The distinction decides what you may change.

- **Intent** — what the owner wants to be true afterwards. Never yours to edit.
  If you think the intent is wrong, say so as a sentence to the owner and stop;
  do not quietly launch a better idea.
- **Precision** — which files, which condition ends it, what a well-meaning agent
  would otherwise drag in. Yours to supply, and the reason a driving session
  exists.

The failure mode is the inversion: a session that softens the ask to something
easier while inventing a scope the owner never mentioned. Both halves are wrong
in the same move.

## Getting the four lines out of one sentence

Most requests arrive as the first line only. The other three are interviewed out
of the repository, not out of the owner.

**The ask.** Keep the owner's words. Trim the sentence, do not rewrite it. If you
cannot leave it intact, the ask is really two asks and should be two tasks.

**Where.** Read before you write this line. The owner names a symptom; the files
are yours to find, and naming a directory you have not opened is guessing with a
confident face. If the honest answer is "anywhere", the task is not scoped yet —
say that rather than writing "anywhere".

**Done means.** The highest-value line and the one most often skipped. It must be
a condition something can check: a command that exits zero, an assertion that
holds, an output that changes shape. A restatement of the ask in the future tense
is not a condition.

| Not a condition | The same thing as a condition |
|---|---|
| "the parser is more robust" | a malformed input is rejected with a named error instead of throwing |
| "add tests" | the new branch is exercised by a test that fails when the branch is reverted |
| "clean up the module" | behaviour is unchanged and the existing suite still passes |

If you cannot write the right-hand column, the task is not ready to launch, and
that is a finding to report rather than a gap to paper over. No command can
supply this line for you — it is the one place in the whole preflight where the
judgment is irreducible.

**Out of scope.** Written against a specific temptation, not as a genre. "No
refactors" is decoration; "do not touch the adapter descriptors — they are pinned
byte-for-byte by a test" is a fence. The good version usually names a file and a
reason.

## Resolving before cutting

The four lines are not finished when they read well. They are finished when
every fact in them has been opened in the repository — which is
`preflight_a_task.md` §3, and it belongs before the cut rather than after,
because resolving usually *adds* a line or two that cutting must then leave
alone.

The distinction that matters here: **a symptom is what the owner can see, and a
blocking fact is what the agent needs.** "The backlog does not show the spine
plan's tickets" is a symptom, and a planner handed only that will spend its one
pass rediscovering why. "The store filter is `/^T\d\d\.md$/` while the spine
plan's tickets are named `WNN.md`" is the fact, it costs you one grep, and it
turns a discovery into an instruction.

Owners write symptoms, because a symptom is what they experienced. Converting
each one into the fact underneath it is the single highest-value edit you make
to a request, and it is the edit that is invisible in the result — a run that
went well because the request was resolved looks exactly like a run that went
well by luck.

## Cutting

Once the four lines exist and their facts are resolved, cut them.

- Delete every sentence that would not change what an agent does. Background,
  history and reassurance are context the model pays for and does not use.
- Delete every instruction the tooling already enforces. A gate that already
  refuses the thing does not need the request to also ask for it, and asking
  twice invites a model to negotiate with one of the two copies.
- Keep every constraint that is only true here. Repository-specific rules are
  exactly what a phase cannot infer.
- **Never cut a resolved fact to make the request shorter.** A file path, a
  line, an exact expression or a named helper is the cheapest thing in the
  request and the most expensive thing to rediscover.

## What you never do

- **Never put a credential, a token, a URL with an embedded password, or a path
  that only exists on your machine into a request.** It is persisted, projected
  and rendered into prompts; the host scrubs what it recognises, and recognition
  is not a guarantee.
- **Never encode which attempt or session is live.** The request outlives the
  run.
- **Never write the request as instructions to a specific model.** It is read by
  every phase in the recipe, on both providers.

## What is deliberately not in this document

No prompt template, and no worked example of a good request for this repository.
A template is copied and then edited into something that no longer matches its
own advice, and a worked example ages into the thing people submit instead of
thinking. The four lines and the tests above are the whole method.
