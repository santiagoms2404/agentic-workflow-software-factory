# Gotchas — symptom, cause, guard

A lookup surface for behaviour that surprises a driving session. Everything in
the live table was **verified against the code** when it was written; the entries
in `Historical` were measured the expensive way, on real runs, and are kept
because knowing what used to be true is what makes some of the current design
legible.

**The two sections are never mixed.** An entry is either currently reproducible
or it is historical and names the commit that closed it. A repaired defect
carried in the live table would send a session hunting a symptom that no longer
exists, which is the exact failure this document exists to prevent. When you add
an entry, verify it against the source first and cite the file — an unverifiable
trap is worse than an absent one.

---

## Live

### 1. Owner rework is refused above the middle tier

**Symptom.** `awsf rework` refuses a top-tier attempt outright, before anything
is spent, and points you at cancel and retry instead.

**Cause.** Rework re-runs one writable builder phase, so the candidate it
produces has never been reviewed — and the verdict-consistency gate binds a
review to the exact revision it read. Letting it through would leave an attempt
that gates cleanly and can never satisfy landing. `core/src/cli/commands/rework.ts`
refuses on any tier that is not the middle one.

**Guard.** The refusal is the guard. The honest route is cancel plus retry, which
re-runs the whole pipeline including its opposite-provider review and carries the
spend forward — see entry 3 before you suggest it.

### 2. Owner acts refuse after the configuration changed under them

**Symptom.** `awsf rework` or `awsf review` refuses with a configuration-snapshot
complaint on an attempt that was fine an hour ago.

**Cause.** A snapshot of the effective configuration is recorded when the attempt
is created, and both commands compare the current configuration against it before
doing anything. Editing `awsf.config.yaml` mid-attempt — or running from a
different working directory, which resolves a different configuration file
entirely — makes them disagree.

**Guard.** The comparison. It is not a bug to route around: the attempt's phases
were compiled against the recorded configuration, and re-entering under a
different one would produce evidence about a workflow that never ran. Restore the
configuration, or start a new attempt. Note that `awsf retry` takes a **fresh**
snapshot rather than refusing, which is why retry works where rework does not.

### 3. Retry does not refund; it carries the spend forward

**Symptom.** A retried attempt runs out of calls almost immediately, or refuses a
replacement review for insufficient headroom.

**Cause.** Spend is scoped to the task rather than to the attempt, deliberately:
a task cannot buy an unlimited budget by failing repeatedly. `awsf retry` mints the next
attempt carrying the previous one's spent calls (`core/src/cli/commands/retry.ts`).

**Guard.** Check what remains before recommending a retry. What retry *does*
reset is the attempt-scoped owner re-entry allowance, and the per-phase
correction counters — so a retry buys another owner re-entry and not another
call. Those are different currencies and confusing them is how a plan for a
retried attempt turns out to be unaffordable.

Retry also refuses while the previous attempt is not terminal, and refuses while
any call reservation is still outstanding. An attempt with a stale reservation is
reconciled by re-running the command that left it, not by retrying past it.

### 4. A non-zero exit does not mean something went wrong

**Symptom.** A wrapper script or a session treats exit 1 as an error and reports
a failure that did not happen.

**Cause.** Several commands use the exit code to report an *outcome*, not a
fault. `core/src/cli/main.ts` is the whole story, and it is short:

| Command | Exits non-zero when |
|---|---|
| `awsf run` | the attempt came to rest anywhere other than awaiting the owner — including a perfectly ordinary block |
| `awsf resume` | the owner declined, or the workflow came to rest before the owner handoff, including another quota pause |
| `awsf rework` · `awsf review` | the owner **declined** at the confirmation prompt, which is a decision and not a failure |
| `awsf land` · `awsf cancel` | the attempt did not reach the state that act targets, decline included |
| `awsf doctor` | any finding at all was reported |
| `awsf db rebuild` | the rebuild was refused and the candidate retained |

**Guard.** Read the state and the printed lines, never the code alone. This is
also why a driving session should not wrap these commands in shell conditionals.

### 5. The diagnosis command reports and never repairs

**Symptom.** `awsf doctor` exits non-zero on a stale lock left by a killed
session, and nothing you do makes it green.

**Cause.** It has no repair path, on purpose: a finding is evidence for the
owner, not permission to alter an attempt. It inspects durable state only — it
never takes a lock, opens a writer, or fixes anything
(`core/src/cli/commands/doctor.ts`).

**Guard.** Report the finding; do not tidy it away before the owner has seen it.
Half the value of a stale lock is that it says a process died, which is exactly
the sort of thing a session is tempted to clean up before mentioning.

### 6. `awsf gc` never deletes anything

**Symptom.** Disk usage is unchanged after running it.

**Cause.** It lists cleanup candidates and that is all; no delete operation
exists in the module (`core/src/cli/commands/operator.ts`), and no push, force or
auto-delete path exists anywhere in the codebase.

**Guard.** By design, and enforced by a meta-test. Deleting a candidate is the
owner's decision, made with an ordinary file manager, and only after the evidence
in it is no longer wanted.

### 7. Everything is resolved from the working directory

**Symptom.** A task is created against the wrong repository, or picks up a
configuration you did not mean, and the mistake is permanent because attempts are
retained.

**Cause.** `awsf new` records the current working directory as the attempt's
repository, and every command resolves `awsf.config.yaml` relative to it unless
`--config` is given. Nothing displays the resolution before acting.

**Guard.** There is no mechanical guard today, and that is the point of the entry
— this exact mistake has already produced a permanently retained junk task. A
displayed resolved repository and HEAD, confirmed at a terminal, is carried as
named backlog in the plan's Amendments. Until it lands, confirm your working
directory before `awsf new` and treat that as a real step rather than a
formality.

### 8. Piped standard input refuses every owner act

**Symptom.** `awsf land`, `cancel`, `journey`, `rework`, `review`, `raise`, `publish` or `resume` refuses when
run from a script, a pipe, or any non-terminal context.

**Cause.** All eight — `land`, `cancel`, `journey`, `rework`, `review`, `raise`, `publish`, `resume` —
require an interactive owner terminal, and the refusal comes from the
normative machine *before* any process can receive a signal and before any
call is reserved. The check is a terminal-shape test (`process.stdin.isTTY`),
not the authorisation boundary itself.

**Guard.** No flag bypasses it, but a PTY makes the check pass — `script -qec`
supplies one and clears it. The fence that actually holds the line is the
per-invocation tool-surface denial marimba's hook performs.

### 9. The two provider routes fail in opposite directions on an unknown session

**Symptom.** A correction on one route refuses before launching, while the same
condition on the other route would have produced a conversation with no memory of
the turn it was correcting.

**Cause.** The CLIs genuinely differ, and both adapters document it. One route's
`--session-id` **creates** a session it cannot find — a warning on standard
error and a fresh session wearing the requested id, which is a cold start with a
resume's name. The other route's `--resume` **refuses** an id it does not have.
Neither behaviour is wrong; they are just not the same, and only one of them
fails safely.

**Guard.** The host's own `assertResumable`, which runs before the launch and
does not trust the CLI. On the fail-open route it is a real filesystem proof:
the session must exist in the host-owned store, must be unique there, must have
been recorded against the same working directory, and must actually have an
assistant turn to correct. On the fail-closed route it is deliberately weaker and
is labelled as such in the source, because there the CLI itself refuses and a
rejected resume costs a process and no call.

The rule for a driving session: **never work around a refusal to resume.** It is
the one check standing between a correction and a silently cold restart that
bills like a continuation.

### 10. Every phase starts failed

**Symptom.** An attempt appears to have several failed phases and looks much
worse than it is.

**Cause.** A phase is constructed failed-equivalent. It starts queued, any
abnormal exit records a failure, and only a clean exit through validation flips
it to the one state that means it worked
(`core/src/state/phase-machine.ts` — *success must be earned*).

**Guard.** Read the failed state as "did not complete", not as "was attempted and
went wrong", and read the queued state as "never started". Only the earned
success state is a claim about the work. Do not dress up a partial run as a
success — and do not report a partial run as a disaster either.

### 11. An interrupted `awsf start` leaves a tree the retry cannot create

**Symptom.** `awsf start` is interrupted — a timeout, a Ctrl-C, a killed
session — while it is seeding. The next `awsf start` refuses with
`AttemptWorktreeExists`, saying the attempt's execution tree already exists.
`awsf status` still reads `DRAFT` with `0` calls spent.

**Cause.** `awsf start` creates the execution tree, seeds it, and only then
persists `PREPARED`. Interrupted between the first step and the last, Git has
the tree while the attempt record does not, and the retry has nowhere to put a
second one. Nothing ran and nothing was spent — the attempt is intact, only its
tree is in the way.

**Guard.** The state is safe. Do not cancel the attempt and do not retry it —
both spend something to fix a problem that has cost nothing. AWSF clears no tree
itself, by design: `AGENTS.md` invariant 8 keeps every force and auto-clearing
path out of `core/src`, and that absence is the point rather than an omission.
Clear it with Git yourself and start again. The error states which of the two
cases you are in — Git tracks the tree, or it is an untracked leftover
directory — because the recovery differs. Use `git worktree` for the first and
an ordinary directory deletion for the second, then:

```bash
just awsf start TASK
```

Seeding copies the configured `runtime.seed_paths`; on this repository that is
`node_modules`, which is large. On a slow or network-backed filesystem the first
`awsf start` can take many minutes, and a caller imposing its own timeout is the
most common way to land here. Give `start` room rather than interrupting it.

---

## Historical

Closed. **None of these reproduces today.** They are kept because each one
explains a piece of the current design that would otherwise look arbitrary.

### H1. The mandatory review audited nothing — closed by `9481a23`

The runner handed the opposite-provider reviewer the trailing test output and a
no-tools profile: an exit code, a bounded tail, no diff, no file list, no source,
and no way to go and look. Its acceptance was structurally guaranteed whenever
its findings were empty, and they were empty because nothing was inspectable.

**Why it is worth knowing.** It is the reason a review can now be *replaced* at
all, and the reason eligibility for replacement is decided by the host from a
recorded evidence row rather than by the owner's opinion of the verdict. Every
review taken before that commit was structurally unevidenced.

### H2. Owner re-entry was charged against a per-phase counter — closed by `99e8e55`

One counter was charged by two different things: intra-phase corrections and
attempt-scoped owner re-entry. An attempt-scoped allowance now carries owner
re-entry, and the phase machine is handed only the per-phase pair, so a phase
structurally cannot spend a lifecycle allowance.

**A correction worth keeping with it.** The first diagnosis of this defect —
"stop the phase machine resetting the owner correction counter" — was **wrong and
was withdrawn in the commit that fixed it**, because suppressing that reset would
have converted every rung-three correction into a once-per-attempt one across
every recipe. The defect was never the reset; it was the sharing. A plausible
diagnosis surviving into a trap table is exactly what the live/historical split
exists to stop.

### H3. A failed command's retained evidence was a trailing window only — closed by `fa82d00`

A builder claimed a fully green suite; the host ran the configured command
against the exact candidate and measured one failure. The evidence retained was
the final bounded segment of the output, which truthfully carried the totals and
began in the middle of an unrelated test — the failing test's identity had
scrolled off the front.

**Why it is worth knowing.** It is the reason retained command evidence now
carries three labelled windows with an explicit omission count. Runners print the
failure where it happens and the summary at the end, so a single window can hold
the count or the cause but never both.

### H4. The continuity locator rode argv into the durable process record — closed by `fa82d00`

The locator reaches the provider on argv, which is the protocol working as
designed, and the launch barrier records that argv verbatim. So the moment
same-session continuity worked, it would have published the locator to the
journal, the projection and the dashboard — the exact opposite of what a
host-private continuity file at mode `0600` is for.

**Why it is worth knowing.** It is why the locator is missing from the process
record you read when a run is stuck, and why that absence is correct rather than
a gap. The redaction is exact-match rather than pattern-based, because the host
minted those strings and can name them precisely instead of guessing what a
session id looks like on a route it has not met.

---

## Verified against the code, and two candidates that were dropped

Two traps proposed for this table are **not in it**, and the reasons are recorded
so nobody proposes them again without new evidence.

**A flag precedence rule inside one provider CLI**, where a no-session flag was
said to win over an explicit session id. It is cited in an adapter comment
against a pinned version of that CLI's own source, which is not a file this
repository contains and not something a driving session can verify. It is also
unreachable from here: the adapter emits one branch or the other and never both.
An entry nobody can reproduce and nobody can trigger is a lead, not a trap.

**A fork-session flag that must never be passed.** Verified — it is passed
nowhere, and the adapter's own comment says why. But it is a rule for whoever
edits an adapter, enforced by the invariants and by a descriptor test, and a
driving session has no argv of its own to put it in. It has no symptom, so it has
no row.
