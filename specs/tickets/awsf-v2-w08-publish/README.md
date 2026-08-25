# Ticket set — AWSF v2 W08 publish

This directory is the addressable execution surface for
[`../../awsf-v2-w08-publish.html`](../../awsf-v2-w08-publish.html).
The readable concatenated source is
[`../../awsf-v2-w08-publish-build-prompts.md`](../../awsf-v2-w08-publish-build-prompts.md)
§ Section B. Each ticket's build-prompt body is byte-identical to its Section B block, and the
tickets were generated from that file rather than transcribed, so the two cannot drift by hand.

## Frontmatter schema

```yaml
id: T01                 # filename and plan task number, zero-padded
title: "..."            # quoted; exact Section B heading
milestone: M1           # derived from the containing plan phase
state: todo             # todo | wip | done | failed; mirrors plan markers
depends_on: []          # plan dependency chain
serves: [INV-2]         # present only when the plan task claims identifiers
```

`tier` and `workflow` are omitted: this plan defines neither vocabulary for its own tasks. The
plan-sync fence treats an absent optional field as a legitimate shape and a present-but-wrong one as
the defect, so inventing a taxonomy to fill them would be the error. **`serves` is absent on T13 and
T17**, because both carry display or documentation surface that follows from a declaration rather
than asserting one — the dashboard's eleventh state, and the owner-act document cascade.

## Derived-field rules

Every field below was derived rather than read off the plan. Edit the rule here rather than
re-deriving it downstream.

- **`milestone`**: M1 for T01–T03, M2 for T04–T05, M3 for T06–T08, M4 for T09–T10, M5 for T11–T14,
  M6 for T15–T18, M7 for T19–T22, M8 for T23–T24.
- **`depends_on`**: T01 has none. A milestone's final Testing-Strategy task depends on **every**
  substantive task in its milestone, not only the immediately preceding one — T03 on [T01, T02],
  T08 on [T06, T07], T14 on [T11, T12, T13], T18 on [T15, T16, T17], T22 on [T20, T21] — because a
  testing task exercises the whole milestone. Every other task depends on the one before it, because
  each consumes the module, schema, or harness its predecessor produced.
- **`serves`**: copied from the plan task's own `<code class="serves">` claims. The sync fence's
  MIRROR rule compares the two as sets and fails when they differ, so this field is never edited on
  one side alone.
- **`state`**: mirrors both the containing milestone marker and the task's own checklist. Flip the
  HTML markers and the ticket state in the same commit.

## Four derived rules that live in the code, recorded here because each has a wrong answer that
produces a plausible result with no error anywhere

These are not frontmatter fields. They are recorded here because all four were established by
measurement during authoring, and all four would otherwise be reconstructed from an assumption
that reads as obviously correct and is wrong.

### The allowlist keys on a remote NAME, never a URL

`core/src/registry/catalog.ts` runs `assertNoAbsolutePaths` over every string leaf of a catalog, and
`ABSOLUTE_PATH_PATTERN` in `core/src/config/machine-path.ts` refuses `/tmp/bare.git` and
`C:\bare.git` alike. **Every test in this workstream needs exactly such a path**, so a URL-keyed
allowlist could not name the local bare remote the spine requires the whole thing be tested against.
The one spelling that would slip through — `file:///tmp/bare.git` — passes only because the pattern
anchors on a leading `/` or a drive letter, which is smuggling a machine path past a check rather
than satisfying it.

The consequence is a security property rather than a compromise: **no URL enters the push argv**, so
a credential embedded in a remote URL cannot reach the process arguments, the journal, or an
operator message, and that holds with no scrubbing code at all. The URL stays in the repository's
own Git config, where it already is.

The cost, stated because it is real: a remote name is a local, rewritable binding, and
`git remote set-url` redirects the push without the catalog noticing. The optional `host` field
closes that when declared. It is optional for the same reason W04's `identity.root_commit` is
optional — a local bare remote has no host — so **the verification is opt-in and its absence is
silent**.

### "Non-delete" is not "the source is non-empty"

Measured 2026-08-24 against a local bare remote:
`git push origin 0000000000000000000000000000000000000000:refs/heads/main` printed
`remote: warning: deleting a non-existent ref` and `- :refs/heads/main [deleted]` at **exit 0**.
An all-zeros object id is Git's deletion sentinel, so a refspec whose source is forty hex characters
can still be a branch deletion.

`core/src/publish/refspec.ts` therefore sets `deleting` for an empty source **and** for a forty-zeros
source, and truth-table row 11 refuses both **independently of row 12**. Row 12 (`inexact-source`)
already excludes all-zeros because a landed candidate is never all-zeros — but if row 12 were ever
relaxed, a deletion hole would reopen with no test noticing. The redundancy is deliberate.

The same measurement covers force: `git push origin +<sha>:refs/heads/main` printed
`(forced update)` at exit 0. Both spellings are argv-array forms that the retired
`no-destructive-paths` push scan never saw, which is why T20 adds them as unconditional absences
rather than only relying on the truth table.

### The porcelain flag is one character and one of them is a space

`git push --porcelain` writes to **stdout**: a first line `To <url>`, then one tab-separated line per
ref, then `Done`. Prose and the URL-bearing failure text go to stderr and are never read. The flag
vocabulary, measured:

| flag | meaning | exit |
| --- | --- | --- |
| `*` | new branch created | 0 |
| `=` | up to date — the idempotent retry | 0 |
| (space) | fast-forwarded, with `old..new` in the last field | 0 |
| `!` | rejected, reason in parentheses | 1 |
| `+` | forced update — must never occur | 0 |
| `-` | deleted — must never occur | 0 |

**The fast-forward flag is a literal space**, so `line.trim().split("\t")[0]` silently converts a
fast-forward into the ref name. `parsePorcelain` reads the first character of the **untrimmed** line,
then splits. The `To <url>` line is dropped rather than parsed, which is what keeps the remote URL
out of the journalled record.

### Two exit codes that mean the opposite of what they look like

- `git ls-remote <remote> refs/heads/<branch>` exits **0 with empty stdout** when the branch does not
  exist. That is a creation, not a failure, and the observation reads the output rather than the
  status. Reading the status instead computes `fastForward` against nothing.
- `git config --local --get-regexp '^credential\.'` exits **1** when nothing matches. That is the
  outcome the credential test wants, so the assertion is on the empty output and never on the status.

### A new state is not a new edge, and the migration cannot run against the current runner

Added 2026-08-25 while applying Q2. W07 established that a new legal **edge** needs no migration,
because `transitions.from_state`, `to_state` and `edge_id` carry no `CHECK`. **That does not
generalise.** `sessions.lifecycle_state` in `0001-initial.sql` is declared
`CHECK (lifecycle_state IN (…))` listing all ten current states, four lines away in the same file,
so a new **state** needs a table rebuild in the protected `migrations/` directory. Verified: inserting
`PUBLISHED` against the current schema fails with `CHECK constraint failed`.

Three rebuild routes were measured against a miniature of the real shape — a parent with a `CHECK`,
a child with `ON DELETE RESTRICT`, an index:

| Route | Result |
| --- | --- |
| The runner as it stands — rebuild inside `BEGIN IMMEDIATE` | **fails:** `FOREIGN KEY constraint failed` at the `DROP` |
| `PRAGMA defer_foreign_keys = ON` inside the transaction | **fails identically** — SQLite's `RESTRICT` is not deferrable |
| `PRAGMA foreign_keys = OFF` hoisted ahead of `BEGIN IMMEDIATE` | **works:** rows copied, `foreign_key_check` empty afterwards, every child's `REFERENCES` intact through the rename, orphan child still refused once restored |

`node:sqlite`'s `DatabaseSync` defaults `foreign_keys` to **ON**, where raw SQLite defaults it off.
`PRAGMA foreign_keys = ON` at the top of `0001-initial.sql` is a no-op — it runs inside
`BEGIN IMMEDIATE` where SQLite ignores it, and the setting is per-connection and unsaved anyway. The
behaviour is right by the driver's default rather than by that line.

**T11 adds `foreign_keys` to `TRANSACTION_UNSAFE_PRAGMA` and restores it afterwards, and it must land
before the owner's G8-C commit.** An owner who commits the migration first will find every command
failing to open the database.

## Three gates on this ticket set

All three are owner-authored commits into protected paths. **No agent writes any of them**, and each
gated ticket's first act is to verify the commit landed and to mark itself `[f]` if it has not.
Routing around a protected path is not an option this ticket set offers.

**G8-B blocks T12 onward.** `core/src/state/**`. One commit touching `task-machine.ts` — `PUBLISHED`
in `TASK_STATES` and in `TERMINAL_STATES`, a new `SEALED_STATES` of exactly
`BLOCKED`/`CANCELLED`/`PUBLISHED`, step 2 of `transition()` reading `SEALED_STATES`, `L27` in the
`EdgeId` union, and the `LEGAL_EDGES` row `L27 — LANDED → PUBLISHED` with actor `human`,
`spawnSite: false`, `interactive: true` — and `guards.ts`, which gains `L27`'s guard.

**G8-C blocks T12 onward.** `core/src/observability/migrations/**`. One commit adding
`0004-published-state.sql`. See the rule above for why **T11 must land first**.

**G8-A blocks T19 onward.** `AGENTS.md`, invariant 8. **The gate is enforced by a task, not by a
test, and that is deliberate.** Measured during authoring: `no-destructive-paths.test.ts`'s push
clause is `/git\s+push/`, and this repository never writes those two words adjacently because
invariant 4 bans `shell: true` and every Git call is `runSystemCommand("git", [...argv])`. So the
scan **cannot see** the argv site T06 creates, the suite stays green through M6 whether or not the
amendment landed, and nothing mechanical forces the gate. T19 reads the file, confirms the phrase,
and stops if it is absent. T01–T18 do not wait on it.

**This repository's own catalog is still not a gate.** `awsf.project.yaml` is protected, so a
`publish` block for this repository would be an owner commit — but the schema is agent work under
`core/src/registry/**`, the block is optional, an absent block means the repository is simply not
publishable, and every test builds its own catalog in a temporary directory.

## Eight decided Questionables, and which ticket each one reaches

**All eight were decided by the owner on 2026-08-25** and are constraints this ticket set implements.
Six were taken as recommended; **Q2 and Q3 went the other way**, and both are implemented as decided
rather than re-argued. Nothing in this ticket set is still an open question.

| Questionable | Decision | Reaches |
| --- | --- | --- |
| Q1 — remote or URL | remote name and branch, optional `host` | T04 |
| **Q2 — lifecycle edge** | **a new `PUBLISHED` state** *(against the recommendation)* | T11–T14, T15, T18, T23 |
| **Q3 — credential requirement** | **inherit the owner's helper** *(against the recommendation)* | T06, T09, T10 |
| Q4 — retain a failed push's stderr | never retain | T09, T16 |
| Q5 — fast-forward verdict | observe with `ls-remote` first | T07 |
| Q6 — catalog placement | sibling `publish` object | T04 |
| Q7 — owner-act cascade | in scope for this workstream | T17 |
| Q8 — landing approval record | require it, and match its SHA | T02 |

**Q2 is the decision that reshaped the set.** It added a milestone, four tasks, two owner-authored
commits, one invariant and one acceptance criterion, and it exposed a seal that the rejected option
would have needed too — recorded in the plan's Amendments and in Q2's own entry, because the
comparison the owner was shown had priced it wrongly.

## What no ticket in this set may do

Restated here because the spine names the first of these as the single most likely failure across all
fourteen workstreams: **absorb any deployment scope, in code or in prose.** Publication is source
publication; W13 is the deploy workstream and it is declared, not built. Also: write `AGENTS.md`,
`awsf.config.yaml`, `awsf.project.yaml`, `core/src/state/**` or
`core/src/observability/migrations/**`; let a test touch the network; put a URL into the push argv or
into the journal; store a Git process's stdout or stderr anywhere; add a dependency outside the
invariant 7 allowlist.

**Two claims that are false after Q3 and must not be written anywhere.** Publish does *not* guarantee
that no credential is read — it inherits the owner's helper, and `INV-4` is the narrower claim that
no credential *value* passes through AWSF. And `GIT_TERMINAL_PROMPT=0` is *not* a credential control:
it exists because `spawnSync` captures stdio, so a prompt would hang until the timeout rather than
reach anybody.

**One practical note on who does the work.** After W01's amendment narrowed the documenter role's
`writes` to `["README.md"]`, no managed role's write globs reach `docs/driving/**` at all. T17's edits
to the guard script and the four driving documents are therefore made by the driving session running
that task, exactly as W01's own tasks were — not by a worker phase. That is a fact about the route,
not a reason to move the work out of this plan.

## Shared read-first set

Every fresh session reads `AGENTS.md`, the named task and containing milestone in the HTML plan, and
the source files its own prompt names. `CLAUDE.md` and `docs/TESTING.md` did not exist when this plan
was authored and must not be invented to satisfy a template.

## Sync rule

`core/test/unit/meta/ticket-plan-sync.test.ts` resolves this plan through the registered plan source
and checks task coverage, milestone, marker and checklist state, title, dependency ordering, exact
Section B prompt bytes, and the identifier-spine COVERAGE / ORPHANS / MIRROR rules. The HTML plan is
the status source of truth.
