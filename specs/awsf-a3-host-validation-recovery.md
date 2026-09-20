# A3 — safe recovery after host validation or a host commit has started

## Authority and scope

This extends the existing saved-reply recovery boundary described by D2, D4, D5
and D7 of `awsf-protected-quota-architecture.md`. It implements two rows of D5's
crash-cut table and no others:

- *Provider terminal durable, envelope or gates not yet accepted.*
- *Host commit intent durable, commit/binding or phase acceptance incomplete.*

It claims **no interrupted-turn recovery**. No provider is contacted, no
conversation is reopened, no model call is repeated and no adapter continuity
capability is asserted. Every cut here is downstream of a reply that was already
complete, already stored and already paid for; the only question is what the
host did with it afterwards.

It also implements no protected-write grant. D7 is consumed here only as a
constraint: a recovered commit must remain reconcilable with a candidate
binding, and the interface that binding needs is listed under *Open interface*
rather than invented.

## What existed before

`inspectPhaseRecovery` accepts two checkpoint kinds that matter here:
`completed-phase` (a phase was accepted) and `result-ready` (a complete reply is
stored, its original call is spent, and host validation has not begun). The
moment `runAgentPhase` calls `onValidationStart`, the host wrote
`{ recovery: null }` and recovery refused everything afterwards with *no durable
accepted-phase checkpoint*. That refusal was correct and deliberate: nothing in
the journal said how far validation had got, so nothing could distinguish a
gate that had not run from a commit that had.

## The stage vocabulary

Host validation of one reply is seven ordered stages, in the order
`runAgentPhase` performs them:

| # | Stage | Class | What it does |
|---|---|---|---|
| 1 | `envelope-check` | read-only | reduces the stored envelope to valid/invalid |
| 2 | `gates` | read-only | runs the phase's gates over the envelope and the retained tree |
| 3 | `permission-enforce` | read-only | compares the change-set against the write globs and the protected list |
| 4 | `capture-diff` | read-only | observes the host-owned change-set |
| 5 | `commit` | **effectful** | `git add --all` plus one host-attributed commit |
| 6 | `verify-candidate` | **effectful** | dispatches the owner-configured commands against that commit |
| 7 | `accept` | durable | writes the accepted envelope and the phase's acceptance |

Stages 1–4 are functions of durable bytes. They read the stored envelope and the
retained worktree and leave nothing behind, so a crash inside any of them is
recovered by running the whole prefix again. Stages 5 and 6 act. Their work
cannot be undone by observing that it failed to finish, so a crash at or after
either is recovered by identifying what actually happened — never by repeating
it.

`core/src/contracts/host-validation.ts` holds the vocabulary and the durable
shapes; `core/src/workflow/host-validation.ts` holds the pure decision.

## Durable intent

The `PhaseRecovery` checkpoint gains a fourth kind, `validating`, carrying a
`HostValidationProgress`:

```
{ schema, phaseKey, ordinal, round, runId, envelopeId, envelopeDigest,
  resultCheckpointId, stage, commitIntent, commitResult }
```

`resultCheckpointId` names the `result-ready` checkpoint this segment descends
from, so the original debit proof — the spent reservation, the released process
record, the completed exit, the route — stays reachable from every later stage.
The contract refuses a progress whose stage disagrees with its commit evidence,
whose intent belongs to another turn, round or run, whose result cites another
intent, or which claims a commit for an empty change-set.

Immediately before the commit transport, the host records:

```
HostCommitIntent = { intentId, phaseKey, ordinal, round, runId,
                     parentSha, message, author, committer,
                     changedPaths, committedPaths, contentDigest, treeDigest }
```

`changedPaths` is the host-captured diff object the permission check ran on.
`committedPaths` and `contentDigest` describe the **whole** working tree against
`parentSha`, because `commitAsHost` stages `--all`; an intent recorded over only
the paths one turn wrote would accept a commit that carried extra content.
`contentDigest` is computed from the working tree, so the same function reads
the same value before the commit and after it — which is what lets one
measurement answer both *has it happened* and *is what happened the thing that
was intended*.

After the transport returns, the host records
`HostCommitResult = { intentId, commitSha, treeDigest }`, where `commitSha` is
null for a phase that changed nothing.

## Reconciling the host commit

`reconcileHostCommit` in `core/src/git/commit-reconcile.ts` takes the recorded
intent and a read-only Git runner and returns exactly one of `not-committed`,
`committed` or `refused`. It writes nothing: no reset, no clean, no stash, no
staging, no commit.

`not-committed` requires HEAD still at `parentSha` **and** the working tree's
content digest still equal to the recorded one.

`committed` requires all of:

- `parentSha` is a commit object in this repository;
- HEAD descends from `parentSha`;
- exactly one revision exists in `parentSha..HEAD`;
- that revision's only parent is `parentSha`;
- its message equals the recorded message;
- its author and committer equal the recorded identities;
- the worktree is clean;
- `git diff --name-only parentSha <sha>` equals `committedPaths` exactly;
- the working tree's content digest equals `contentDigest`.

Anything else refuses. Ambiguity is a refusal in both directions: two commits
after the intent refuse, and so does a matching commit sitting beside a dirty
tree, because neither names one outcome.

## The cut table

`planHostValidationRecovery` maps a durable stage to one of three actions. No
branch authorizes a model call, a second commit, a reset or a guess.

| Cut | Durable stage | Classification | Action |
|---|---|---|---|
| A3-1 | `envelope-check` | proved-resume | replay the read-only prefix from `envelope-check` |
| A3-2 | `gates` | proved-resume | replay the read-only prefix from `envelope-check` |
| A3-3 | `permission-enforce` | proved-resume | replay the read-only prefix from `envelope-check` |
| A3-4 | `capture-diff` | proved-resume | replay the read-only prefix from `envelope-check` |
| A3-5 | `commit`, no commit object | proved-resume | the transport never ran; commit once |
| A3-6 | `commit`, one exactly matching commit | proved-completed-result-recovery | adopt that revision; do not commit again |
| A3-7 | `commit`, anything else | proved-safe-refusal | named refusal, nothing touched |
| A3-8 | `verify-candidate` | proved-safe-refusal | named refusal, candidate and tree retained |
| A3-9 | `accept`, repository agrees with the recorded result | proved-completed-result-recovery | reconcile, then accept without re-running anything |
| A3-10 | `accept`, repository disagrees | proved-safe-refusal | named refusal, nothing touched |

Replay always restarts at `envelope-check` rather than at the recorded stage.
That costs one extra pure reduction and removes the question of whether a
half-finished gate left a verdict behind.

A3-8 refuses because the owner-configured commands have no per-command
intent/result ledger to consult, and a missing result is not proof that a
command did not run. D10.3 names that ledger — record intent before dispatch,
result before acknowledgement — and building it is the work that would convert
this cut from a refusal into a reconciliation. Until then the candidate commit,
the clean tree and the original debit are all preserved and the owner is told
which command boundary was uncertain.

## Exact refusal cases

Journal-side, from `inspectPhaseRecovery`:

- `host validation stage has no durable advance evidence` — the checkpoint was
  installed by an ordinary status update rather than by a stage advance, or no
  advance ever cited the originating `result-ready` checkpoint.
- `saved reply validation has started or its completion proof changed` — the
  cited `result-ready` checkpoint is absent, is not of that kind, or the stage
  advance moved a binding it may not move: the accepted prefix, the identity
  pins, the retained worktree HEAD, the saved reply or its digest.
- `host validation progress belongs to another saved reply` — phase, ordinal,
  round, run or envelope identity disagrees with the pending reply.
- `host commit intent names a different pre-commit revision than the checkpoint`.
- `host validation stage disagrees with its recorded commit evidence` — an
  intent before the commit stage, a result at it, or a missing result after it.
- `recovery refused: active or unsettled execution` — an unsettled reservation
  or a live process. Unchanged from before; uncertain liability is retained,
  never refunded.
- `recovery refused: no durable accepted-phase checkpoint` — the pre-A3 shape,
  where the checkpoint was cleared. Still refuses, because nothing in that
  journal says what ran.

Repository-side, from `reconcileHostValidation` and `reconcileHostCommit`:

- `recovery refused: HEAD moved during read-only host validation`.
- `saved reply worktree or index bytes changed` — the retained bytes moved
  before the commit could have run.
- `recovery refused: worktree or index bytes changed after the recorded commit`.
- `the recorded pre-commit revision is not a commit object in this repository`.
- `HEAD is still the recorded pre-commit revision but the retained working tree
  no longer matches the recorded intent`.
- `current HEAD does not descend from the recorded pre-commit revision`.
- `the recorded intent identifies one commit, but N revisions were created after it`.
- `the created commit does not have the recorded pre-commit revision as its only parent`.
- `the created commit carries a different message than the recorded intent`.
- `the created commit carries a different author or committer than the recorded intent`.
- `a commit exists after the recorded intent but the worktree is not clean`.
- `the created commit changes a different set of paths than the recorded intent`.
- `the created commit carries different content than the recorded intent`.
- `recovery refused: the durable commit result and the repository name different revisions`.
- `recovery refused: <the A3-8 command-ledger reason>`.

Every one of these leaves HEAD, the working tree, the index, the candidate, the
accepted prefix, the original debit and any uncertain liability exactly as the
crash left them.

## What A3 preserves

- **Worktree and index bytes.** Before the commit, the retained bytes must equal
  `pending.worktreeDigest`, the same measurement the existing saved-reply path
  already pins. After it, they must equal `commitResult.treeDigest`.
- **Candidate ancestry.** The reconciled commit's only parent is the
  checkpoint's own recorded pre-commit HEAD, which the contract binds to
  `worktreeHeadSha`.
- **Accepted prefix.** A stage advance may change only `id`, `createdAt`, `kind`
  and `validation`. Everything else is compared by digest against the
  originating `result-ready` checkpoint.
- **Original debit.** The saved reply's spent reservation, its released process
  record and its completed exit remain the proof, reached through
  `resultCheckpointId`. Recovery reuses that debit and never reserves against
  it; the existing `restoreReservation` path is unchanged.
- **Uncertain liability.** An unsettled reservation or live process still
  refuses before anything else is evaluated. Nothing here refunds.

## Integration requirements

A3 adds no call site inside `production-run.ts` or `engine.ts`; those files, and
`attempt-evidence.ts` and `land.ts`, belong to the A2 protected-grant work. The
seams below are what A2 (or whoever owns those files) must add for the cuts to
become reachable from `awsf resume`. Two of the four files turn out to need no
change at all.

**`core/src/observability/attempt-evidence.ts` — no change.** The existing
`phase-validation-started` member (`{ phaseId, checkpointId }`) carries every
stage advance. `checkpointId` names the checkpoint being superseded, which is
exactly the chaining the recovery reader verifies.

**`core/src/observability/projector.ts` — no change.**
`phase-validation-started` is already a projector no-op, and the checkpoint
travels inside `next`, which the recovery reader consumes directly.

**`core/src/cli/commands/land.ts` — no change expected.** A3 produces no new
landing evidence; the reconciled candidate is an ordinary accepted phase.

**`core/src/workflow/engine.ts` — two optional callbacks.** Both absent means
byte-identical behaviour to today.

```ts
readonly onValidationStage?: (stage: HostValidationStage) => Promise<void>;
readonly hostCommitRecovery?: {
  intent(parentSha: string, changedPaths: readonly string[], message: string): Promise<void>;
  reconcile(): Promise<{ commitSha: string | null } | null>;
  result(commitSha: string | null): Promise<void>;
};
```

`onValidationStage` replaces the single `onValidationStart` call with one call
per stage, made **before** the stage runs. `hostCommitRecovery.intent` is
awaited immediately before `options.hostGit.commit(...)`.
`hostCommitRecovery.reconcile` is consulted **in place of**
`options.hostGit.commit(...)` when a restored checkpoint already carries an
intent; returning `null` means the transport never ran and the ordinary commit
should proceed. `hostCommitRecovery.result` is awaited immediately after the
commit returns.

**`core/src/cli/commands/production-run.ts` — carry the checkpoint across the
segment.** Today `onValidationStart` persists `{ recovery: null }`. Instead,
each stage advance persists `{ recovery: <next validating checkpoint> }` with
the existing `phase-validation-started` evidence, citing the previous
checkpoint's id. The commit intent is built from the worktree with
`hostCommitContentDigest` and `changesSinceBase`, and the resume entry consults
`verifyRecoveryWorktree`'s returned `ValidationReconciliation` to decide whether
to replay the read-only prefix, adopt an existing commit or refuse. The saved
reply's existing ban on a model call during validation stays in force.

## Open interface

D7's **candidate-binding** evidence is not defined here, because A3 does not own
it. A3's requirement on it is narrow and should be satisfied when it is written:

1. The binding must be derivable from durable journal intent plus Git objects
   alone, so that a crash between `git commit` and the binding append is
   reconcilable rather than ambiguous.
2. The binding must cite the same pre-write HEAD that `HostCommitIntent`
   records as `parentSha`, so that one reconciled revision satisfies both.
3. If the binding is appended in a later event than the commit result, the gap
   is an A3 cut and needs its own stage between `commit` and `verify-candidate`.
   Appending it in the same event as the commit result removes that cut
   entirely, which is the cheaper answer.

## Tests

| Suite | File | Covers |
|---|---|---|
| unit | `core/test/unit/contracts/host-validation.test.ts` | stage order, the read-only/effectful split, every contract refusal |
| unit | `core/test/unit/workflow/host-validation.test.ts` | the cut table, and that no cut authorizes a call, a second commit or a reset |
| simulation | `core/test/simulation/host-commit-reconcile.test.ts` | commit reconciliation against disposable repositories, including every refusal and a non-destructiveness assertion after each one |
| journeys | `core/test/journeys/host-validation-recovery.test.ts` | the cuts end to end against a disposable attempt and its own managed worktree |

Every fixture is created by `mkdtemp` and removed in `finally`. No test opens a
runtime attempt of this project, and no test produces a crash in work anybody is
relying on.
