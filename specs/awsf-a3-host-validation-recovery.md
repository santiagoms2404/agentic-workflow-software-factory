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

It implements no protected-write grant. D7 is consumed here only as a
constraint, and as an obligation: A2's `ProtectedCandidateBindingSchema` states
that A3 must reconcile its exact parent/tree/commit tuple and never replay
commit creation. That is done under *The protected host effect* below.

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
  resultCheckpointId, stage, commitIntent, commitResult, protectedConsumptionId }
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

`planHostValidationRecovery` maps a durable stage to one of four actions. No
branch authorizes a model call, a second commit, a reset or a guess. A phase
that commits under a protected grant records `protectedConsumptionId` instead of
a `HostCommitIntent`, because that transport keeps its own durable intent and
binding and a second, weaker copy here would be one more thing to disagree.

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
| A3-11 | protected `commit`, HEAD and index pre-publication | proved-completed-result-recovery | compare-and-swap to the existing object, install the pinned index, bind |
| A3-12 | protected `commit`, HEAD published, index pending, retained lock **witnessed** | proved-completed-result-recovery | adopt that exact inode, install the pinned index, bind |
| A3-12r | protected `commit`, a retained lock with no witness or a witness that does not match it | proved-safe-refusal | named refusal, the lock left untouched and undeleted |
| A3-13 | protected, binding missing but publication complete | proved-completed-result-recovery | bind only |
| A3-14 | protected, any other HEAD/index pair | proved-safe-refusal | named refusal, nothing touched |
| A3-15 | protected, attempt sealed | proved-safe-refusal | named refusal, nothing touched |

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

Protected-effect side, from `protectedEffectContext`, `adoptRetainedIndexLock`
and `assertReconcilableAttempt`:

- `protected candidate lacks its original spent OS-enforced execution proof`.
- `protected repository root identity changed`, `protected parent identity
  changed`, `protected file deleted or permissions changed` — the grant's own
  filesystem proofs, re-run.
- `the worktree Git directory is not the one this grant was issued against`.
- `the common Git directory is not the one this grant was issued against`.
- `the Git index path is redirected away from the granted worktree Git directory`.
- `<file> is a symbolic link; protected recovery never reads or writes through one`.
- `<file> is not a regular, single-link file owned by this user`.
- `the retained Git index lock is reachable by other accounts (mode <m>);
  protected recovery only adopts a lock whose permissions it wrote itself`.
- `<directory> is not an owner-private directory`.
- `a Git index lock this publication did not write is present; recovery does not
  break another holder's lock`.
- `the retained Git index lock is still open in live process(es) <pids>; recovery
  never takes a lock somebody is holding`.
- `the retained Git index lock has no durable creation witness, so recovery
  cannot show this publication created it rather than an ordinary same-user Git;
  HEAD, the index, the lock and the journal are left exactly as they are` — the
  legacy case, and the crash between lock creation and its witness.
- `the retained Git index lock is not the file this publication created (<field>
  differs from its durable creation witness); recovery neither adopts nor breaks
  a lock it cannot identify` — a replacement, a recycled inode, or an in-place
  rewrite.
- `the retained Git index lock's durable witness belongs to a different
  protected publication`.
- `the retained Git index lock's durable witness was recorded against a
  different worktree, Git directory or lock path`.
- `the retained Git index lock was created by process <pid>, which is still
  running; recovery never takes over from a live writer`.
- `protected index-lock witness is orphaned, duplicated, forked or bound to
  another publication` — from `readProtectedState`, which refuses the whole
  journal rather than choosing between two records that fork one chain.
- `protected index-lock witness is not a complete, well-formed creation record`.
- `<the Git index lock> no longer matches its durable creation witness (<field>
  differs); this publication refuses before it mutates the index, HEAD or the
  lock` — the mutation boundary, on all three publication paths.
- `this process does not hold the attempt's execution lease` — now raised by
  `commitProtectedAsHost` as well, before it reads or writes anything.
- `the attempt status file and its journal disagree, so candidate <sha> has no
  single lifecycle to bind against`.
- `this attempt is sealed in <state>, so candidate <sha> cannot receive its
  durable binding here` — now also raised under the lease, after the owner
  confirmed.

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

## The protected host effect

A2's `commitProtectedAsHost` is a second commit transport with its own durable
evidence: a `protected-commit-intent` written before it publishes anything, and
a `protected-candidate` binding written after everything. It creates the commit
object with `commit-tree` **before** recording the intent, so at every cut
between the two the candidate already exists in the object store and what is
missing is only a HEAD compare-and-swap and the installation of one pre-staged
index — both pinned by digest in that intent.

`ProtectedCandidateBindingSchema` states the obligation directly: *A3 must
reconcile this exact parent/tree/commit tuple, never replay commit creation.*
`core/src/git/protected-reconcile.ts` does exactly that.

### Nothing established before the crash is taken on trust

`protectedEffectContext` is the one door into both the inspection and the
completion, and it re-proves the machine from scratch every time it is opened.
The grant's four physical roots and both Git directories are compared against
the filesystem again (`verifyProtectedFilesystem`, plus `--absolute-git-dir` and
`--git-common-dir`), every granted path is re-walked for symlinks, type, link
count and ownership, and the original one-use OS-enforced execution is re-proved
from the journal (`assertProtectedExecutionProof`). A grant whose roots moved
names a different machine, and a candidate with no spent sandboxed execution
behind it is not this generation's.

The index is then located at `<worktreeGitDir>/index`, derived from that proof
rather than from `rev-parse --git-path index` — which honours an inherited
`GIT_INDEX_FILE` and would otherwise let an ambient environment variable point
the whole reconciliation at a file the intent never measured. Git's own answer
is still asked, and a disagreement refuses by name.

Every Git control file this code reads or replaces — the index, the retained
`index.lock`, the pre-staged index — is opened with `O_NOFOLLOW` and judged
through that descriptor: regular file, exactly one link, owned by this user.
Permission bits are required exactly where this codebase chose them and nowhere
else; which file gets which test, and the DrvFs consequence of that choice, are
under *Which permission checks apply, and why* below.

`inspectProtectedPublication` is read-only. It verifies the candidate object's
parent and tree, re-derives the protected delta from the tree and compares it to
the binding, checks every granted path's current bytes against the recorded
blob, then reads HEAD and the index file:

| HEAD | Index | Outcome |
|---|---|---|
| granted pre-write revision | pre-publication digest | `unpublished` |
| recorded candidate | pre-publication digest | `head-published` |
| recorded candidate | staged digest | `published` |
| anything else | anything else | `refused`, by name |

`completeProtectedPublication` finishes only what remains. For `unpublished` it
performs the compare-and-swap against the granted pre-write revision and
installs the staged index; for `head-published` it installs the staged index
alone, adopting the interrupted run's own leftover `index.lock` **only when a
durable creation witness identifies that exact file**, and refusing otherwise;
for `published` it appends the binding and nothing else. It stages nothing,
resets nothing and creates no commit.

### Adopting a lock needs a record made when it was created

A lock holding exactly the staged digest is *consistent with* being the dead
run's own, and that is all. It establishes neither ownership nor quiescence.
Scanning `/proc` for open descriptors does not repair that, for a reason that
disqualifies it as evidence: **Git's index lock is exclusive by existence**, not
by an open file handle. `O_CREAT | O_EXCL` takes it and a rename or unlink
releases it, so its owner can close every descriptor and still own it. An empty
scan therefore proves nothing — and three lesser problems point the same way:
`/proc` visibility can be restricted even for this user's own processes
(`hidepid`, a PID namespace), a holder can open the file in the instant after
the scan returns, and unreadable entries are invisible.

**Nor is it enough to add owner-private permissions and a live AWSF lease.** The
case that defeats that argument needs no attacker. Our writer dies; an ordinary
same-user `git add` or `git status` in the same worktree creates its own
`index.lock`, writes an index, closes every descriptor and goes on owning the
lock by existence. It never takes this attempt's execution lease and never
touches its journal, so no trusted component is compromised and nothing about
the lease says anything about that file. Against a `head-published` tree — where
HEAD is already the candidate and the working files are the candidate's content
— a foreign Git staging the same entries against the same inodes can produce
byte-identical bytes. Such a file is regular, single-link, this user's, `0600`,
digest-equal and invisible to the scan. Adopting it would destroy a live
holder's lock and its in-flight index, which is precisely what this recovery
promises never to do.

The missing fact is *continuity*: exclusivity **now** is not the same as "this
file has existed continuously since we created it", and nothing observable after
the fact distinguishes them. So continuity is **recorded at creation** instead of
inferred afterwards. Whichever half creates the lock — the transport, or an
earlier reconciliation — writes a durable `protected-lock-witness` to the
journal once the lock's bytes are final and fsynced and **before** anything is
published:

```
{ schema, id, supersedes, writer: "host-commit" | "recovery",
  grantId, consumptionId, candidateSha, parentSha, treeSha,
  beforeIndexDigest, stagedIndexDigest, contentDigest,
  worktree, worktreeGitDir, indexPath, lockPath,
  identity: { device, inode, links, uid, gid, mode, sizeBytes, ctimeNs, mtimeNs },
  controller: { leaseId, pid, startIdentity }, createdAt }
```

Every 64-bit field is a decimal string: a device or inode number can exceed
`Number.MAX_SAFE_INTEGER`, and `ctimeNs` must keep every nanosecond digit.
`ctimeNs` is the load-bearing one. `dev`/`ino` alone are recyclable — unlink a
file and the next `O_CREAT` may be handed the same inode — and an unprivileged
process can set `mtime` with `utimensat`, but it cannot set `ctime`: every
operation that would forge one moves it to now.

Adoption then requires all of:

1. **A durable creation witness exists for this publication**, resolved as the
   last record in that consumption's chain. No witness means the lock cannot be
   attributed, and that refuses.
2. **The file at `lockPath` is that exact inode** — device, inode, link count,
   uid, gid, mode, size, `ctimeNs` and `mtimeNs` all compared against the
   witness through one `O_NOFOLLOW` descriptor.
3. **It still holds the witnessed bytes**, digested from that same descriptor,
   and those bytes are the exact pre-staged index the intent pinned, built in a
   `0700` directory on the attempt's own filesystem.
4. **The controller that created it is settled.** The witness names the
   execution-lease holder by pid and start identity. Either that is this very
   process — which holds the lease now, proved separately — or the process
   census must show it is no longer running. `startIdentity` is what makes that
   proof against PID reuse; a census that cannot report one counts as a live
   match, never as an absence.
5. **The file is what it claims to be**: not a symbolic link (`ELOOP` refuses by
   name), regular, exactly one link, owned by this user, and carrying the `0600`
   mode this codebase writes.

The witness also carries the lease that created it, which is only meaningful if
the writer really held one — so `commitProtectedAsHost` now **asserts** its own
execution lease as its first statement, rather than inheriting it ambiently from
whatever wrapper called it. A caller outside a lease changes nothing at all.

`visibleDescriptorHolders` sits on top as defence in depth: seeing a holder
refuses; seeing none is claimed as nothing. Because nothing is claimed from it,
an unreadable process is skipped rather than turned into a hard failure.

An adopted lock is never rewritten, because its bytes are already verified and a
refusal after that point should leave nothing altered. A new lock is created
only when there is none, with `O_CREAT | O_EXCL | O_NOFOLLOW` — and that
creation writes its own witness, chained to any previous one by `supersedes`, so
the next recovery is owed the same evidence this one demanded. Nothing here ever
unlinks, truncates or writes over a lock it has not established is its own, and
nothing tells an operator to delete one it cannot prove.

**The ordering cost, accepted deliberately.** A crash between creating the lock
and making its witness durable leaves a lock nothing can attribute. That refuses
by name, permanently and automatically, with HEAD, the index, the lock and the
journal untouched. Fail-closed is the point: the alternative is adopting on
resemblance, which is the defect being corrected.

### The mutation boundary, and what it cannot close

`rename(2)` resolves a **name**. Linux offers no rename-by-descriptor —
`renameat2` takes names, and `/proc/self/fd/N` re-resolves to the path rather
than to the inode — so holding the lock open does not make installing it atomic
with respect to a same-uid swap. That is stated rather than engineered around.

Immediately before every rename, on all three publication paths, three facts are
re-proved from the descriptor held since creation: the inode still carries the
witnessed identity (an in-place rewrite moves `ctimeNs` and size; an unlink moves
the link count), it still holds the witnessed bytes, and the *name* about to be
renamed still resolves to that same inode. A failure is a **pre-mutation
refusal**: the index, HEAD and the lock are exactly as they were.

What remains is the instant between that check and the rename. It is not
closable here, so it is converted from silence into **detected damage**: after
the rename, all three paths — normal, handled-error and recovery — now verify
the installed **index digest** against the staged digest before any binding
becomes durable. Previously only the recovery path did; the normal and
handled-error paths checked HEAD and tree alone, which made the same swap
undetectable there.

The two are deliberately distinguishable in the evidence. A pre-mutation refusal
names the witness (`... no longer matches its durable creation witness (<field>
differs); this publication refuses before it mutates the index, HEAD or the
lock`); detected damage names verification (`protected candidate publication
could not be verified`).

### Which permission checks apply, and why

Permission bits are required exactly where this codebase chose them and can
therefore insist on them, and nowhere else:

| File | Written by | Check |
|---|---|---|
| retained `index.lock` | AWSF, `wx 0o600` | owner-private: any group or other bit refuses |
| `<attemptDir>/private/protected-host/**` directories | AWSF, `0o700` | owner-private directory |
| the pre-staged index inside them | Git | type, single link, ownership; its protection is the `0700` directory above it |
| the working index | Git | type, single link, ownership — `0644` is Git's normal, correct answer |

The distinction is authorship, not convenience. Demanding privacy of Git's own
index would refuse honest repositories on every filesystem.

**A known consequence, unresolved.** A worktree on a Windows drive under WSL
(`/mnt/...`, DrvFs) reports mode `0777` for every inode, including files this
code creates `0600`. The retained lock there cannot be shown to be owner-private
and the `head-published` cut will refuse by name rather than adopt it. That is
fail-closed and deliberate — the alternative is to drop a real check to
accommodate one filesystem — but it means this one cut needs the owner's
intervention when the repository lives on such a mount. The `unpublished` and
`published` cuts are unaffected.

`unfinishedProtectedEffect` treats a second unfinished effect as corruption
rather than a cut, and a consumption with no intent at all as unreconcilable —
that generation never reached the window and has no exact outcome to complete.

### A handled interruption is finished, not orphaned

`commitProtectedAsHost` publishes in two steps: the HEAD compare-and-swap, then
the rename that installs the pre-staged index. An exception thrown between them
used to propagate untouched — the phase failed, the attempt sealed in `BLOCKED`,
and the reconciliation above then correctly refused, because a sealed attempt
can never take the binding. The candidate was orphaned: a paid, OS-sandboxed,
owner-granted generation that only a fresh grant and another paid generation
could recover.

The window is now closed at its own end. When the interruption is *handled* —
the process is alive, still holds the execution lease, still holds the same
one-use authority, and the attempt has not sealed yet — the remainder of that
one already-authorized act is completed in place: the pinned index is installed
and the binding that was already computed is appended. Then the original error
is re-raised, so the interruption still fails the phase and still seals the
attempt with its real reason.

This is completion, not retry. No object is created, no outcome is chosen, no
missing proof is invented, and no rule about sealed attempts is relaxed — the
work simply happens before sealing rather than after it. If even the rename
cannot be completed, the original interruption is what the caller sees and the
retained lock, index and evidence are left exactly as the reconciliation path
expects to find them.

Process death is the other half and is unchanged: a killed host runs no `catch`
and writes no lifecycle transition, so its cut is reconciled by `awsf resume`
from durable evidence alone. The two are tested separately, and the second with
a real `SIGKILL` in a real child process rather than a thrown error standing in
for one.

### Where it runs

The reconciliation is **not** gated behind the phase checkpoint. These crashes
routinely leave the phase FAILED, and an attempt whose HEAD, index and journal
disagree has to be reconcilable whatever became of the phase. It is its own
owner-confirmed act at the head of `awsf resume`: read-only inspection, a
confirmation naming the candidate and the publication state, then completion
under the execution lease. It spends no call, runs no model, grants no further
protected write and does **not** continue the workflow — the generation is
one-use and stays spent. Declining is inert.

Two refusals bound it. A publication whose state cannot be named exactly refuses
before anything is touched. A **sealed** attempt (`BLOCKED`, `CANCELLED`,
`PUBLISHED`) refuses too: it takes no further writes, so the binding could never
become durable and completing the publication would leave the repository ahead
of the journal. The retained worktree, index, stale lock and evidence all stay
as the crash left them.

Both are asked twice. The owner's answer takes wall-clock time, and a
concurrent `awsf cancel` lands inside exactly that window, so eligibility, the
status/journal agreement, the retained intent's identity and the publication
state are all re-proved **under the execution lease** before a byte moves.
`withExecutionLease` runs that revalidation inside its claim lock and before it
writes its own lease file, so a cancellation racing the confirmation leaves the
journal, HEAD, the index, the retained lock and the worktree byte-for-byte as
they were. A status file that disagrees with its own journal is a third
refusal: it names no single lifecycle, so neither the sealed test nor the
binding's anchor can be trusted, and reconciling the attempt itself comes
first.

Running a workflow while an effect is outstanding is refused: a later phase
would otherwise measure against whichever revision the crash left behind.

## Integration

Applied on this branch, against `0eb01c1`. Three of the four files A2 owned need
no change:

**`core/src/observability/attempt-evidence.ts` — one added member.** The
existing `phase-validation-started` member (`{ phaseId, checkpointId }`) carries
every stage advance; `checkpointId` names the checkpoint being superseded, which
is the chaining the recovery reader verifies. The lock-provenance correction
adds `protected-lock-witness`, the only durable record written *between* the
intent and the binding.

**`core/src/observability/projector.ts` — unchanged.**
`phase-validation-started` is already a projector no-op, and the checkpoint
travels inside `next`. `protected-lock-witness` needs no case either: the
evidence switch has no default branch and every `protected-*` member is already
a no-op there. It is recovery evidence, not a dashboard fact, so it is read from
the journal and projected nowhere — no SQLite migration, no schema change.

**`core/src/git/protected-lock.ts` — new.** The descriptor-identity layer both
halves share: the witness shape and its validator, `O_NOFOLLOW` reads judged
from the descriptor, nanosecond-safe identity capture and comparison, a
repeatable absolute-offset digest (a descriptor's cursor is consumed by an
ordinary read, and the lock is measured twice), and the mutation-boundary
assertion.

**`core/src/cli/commands/land.ts` — unchanged.** A reconciled candidate is an
ordinary bound candidate; `inspectProtectedCandidate` and the landing
authorization see it exactly as they would have seen it without the crash.

**`core/src/workflow/engine.ts`** gains two optional callbacks. Both absent is
byte-identical to the previous behaviour.

```ts
readonly onValidationStage?: (stage: HostValidationStage, context: HostValidationContext<T>) => Promise<void>;
readonly reconcileCommit?: (context: HostValidationContext<T>) => Promise<HostCommitAdoption | null>;
```

`onValidationStage` replaces the single `onValidationStart` call with one call
per stage, made **before** the stage runs. `reconcileCommit` is consulted in
place of `hostGit.commit(...)` when a restored checkpoint carries a durable
intent; returning `null` means the transport provably never ran and the ordinary
commit proceeds. Its `verified` flag is what stops an owner-configured command
that already finished from being dispatched a second time.

**`core/src/cli/commands/production-run.ts`** advances the checkpoint instead of
clearing it. Each stage persists `{ recovery: <next validating checkpoint> }`
with the existing `phase-validation-started` evidence citing the checkpoint it
supersedes. The `commit` stage records either a `HostCommitIntent`, built from
the worktree with `hostCommitContentDigest` and `changesSinceBase`, or the
protected consumption id when the phase commits under a grant. The saved reply's
existing ban on a model call during validation stays in force.

### One behaviour A2 pinned that A3 changes

`core/test/journeys/production-runner.test.ts` asserted that a cut inside host
validation refuses (`/no durable accepted-phase checkpoint/`), and that resume
after a protected `intent-crash` leaves HEAD unmoved. Both pinned the boundary
this work was asked to extend, and the second contradicts the obligation written
into `ProtectedCandidateBindingSchema`. Those assertions now state the
reconciled outcomes instead. Every preservation assertion beside them — retained
bytes, unchanged spend, one model call, inert refusal — is kept.

## Tests

| Suite | File | Covers |
|---|---|---|
| unit | `core/test/unit/contracts/host-validation.test.ts` | stage order, the read-only/effectful split, every contract refusal |
| unit | `core/test/unit/workflow/host-validation.test.ts` | the cut table, and that no cut authorizes a call, a second commit or a reset |
| simulation | `core/test/simulation/host-commit-reconcile.test.ts` | commit reconciliation against disposable repositories, including every refusal and a non-destructiveness assertion after each one |
| journeys | `core/test/journeys/host-validation-recovery.test.ts` | the cuts end to end against a disposable attempt and its own managed worktree |
| journeys | `core/test/journeys/production-runner.test.ts` | the read-only prefix replayed through `awsf resume` without another model call, and A2's protected crash cuts reconciled or refused |
| journeys | `core/test/journeys/production-runner.test.ts` + `_protected-kill-host.ts` | a real `SIGKILL` at each publication boundary, then reconciliation; a seal landing inside the confirmation; foreign, symlinked, hardlinked and live-held index locks; index drift, changed granted bytes, a changed parent identity and a redirected `GIT_INDEX_FILE` |
| journeys | `core/test/journeys/production-runner.test.ts` + `_protected-kill-host.ts` | lock provenance: a real `SIGKILL` **before** the witness is durable (refuses) and **after** it (reconciles); adoption of the transport's own witnessed lock; a same-byte `0600` replacement with a closed descriptor, against both a transport-written and a recovery-written witness; an in-place rewrite; a witness recorded against another lock path; a forked witness chain; and a lock swapped at the writer's own mutation boundary, refused before the index moves |
| unit | `core/test/unit/execution/operation-lease.test.ts` | the transport refuses outright without the attempt's execution lease, writing nothing; a live witnessed controller never counts as settled |

Every fixture is created by `mkdtemp` and removed in `finally`. No test opens a
runtime attempt of this project, and no test produces a crash in work anybody is
relying on.
