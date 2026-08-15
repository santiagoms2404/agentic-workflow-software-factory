# Evidence map — where each artefact lives

**This document says where things are. It never says what is inside one.** The
shape of an envelope, a gate row or a journal record is single-sourced in
`core/src/contracts/` and restating any of it here would be a second source of
truth that goes wrong quietly.

`core/src/persistence/platform-paths.ts` is the authority for every path below.
It is pure path arithmetic and it names the files inside an attempt directory, so
read it rather than assuming a layout — the state root differs by platform and
honours an explicit environment override on all of them.

## The two roots

**The state root** is machine-local durable state and is resolved per platform by
`resolveStateRoot`. Everything AWSF remembers lives under it. It is not inside
the repository, and nothing under it is ever committed.

**The canonical repository** is the project itself, and the **managed worktree**
is the checkout a run writes into. An attempt records both. They are not
evidence stores — they are the subject.

## Inside the state root

| Where | What it is |
|---|---|
| `projects/<project>/tasks/<task>/<attempt>/` | one attempt directory, addressed by `attemptDir` |
| `awsf.db` | the SQLite projection: sessions, phases, gate rows, processes. Derived, never authoritative — it is rebuilt from journals |
| `awsf.db.superseded-<stamp>` · `awsf.db.rebuild-<stamp>` | what a projection rebuild leaves beside the live database. `awsf gc` names them as cleanup candidates and deletes nothing |

The projection is the right surface for anything cross-attempt or cross-session,
and for the process rows. The journal is the right surface for one attempt's
history. When the two disagree, the journal wins and the projection wants
rebuilding.

## Inside an attempt directory

| Where | What it is | Read it? |
|---|---|---|
| `journal.jsonl` | the append-only record of the attempt. **The source of truth**; everything else is derived from it | yes |
| `status.json` | the atomic status projection the status and watch commands print, carrying a revision counter | yes, via the commands |
| `envelopes/` | one immutable file per phase and correction round — a phase's own claim about what it did. A replacement review's artefacts are generation-qualified so they never overwrite the ones they supersede | yes |
| `raw/` | the retained, **unredacted** host capture of a provider run or a configured command, one file per run id, mode `0600`. Written by the production runner, `awsf rework` and `awsf review` | with care — see below |
| `attempt.lock` | the attempt's exclusive lock. Its holder's pid and acquisition time are what the diagnosis command reports as a stale lock | diagnostically |
| `private/` | host-private. **Never opened** — see below | **no** |

A note that will save you a search: `platform-paths.ts` exposes a helper for the
raw path that no writer currently uses, and the writers choose the filename. When
a helper and a writer disagree about a path, follow the writer.

## `private/` is never opened

Rule 3 of the skill's hard rules, made concrete here because this is the document
where you would otherwise go looking.

`private/` holds `continuity.json` at mode `0600` — the provider session
locators, minted by the host — and, per phase, a runtime directory at mode `0700`
containing the materialized system prompts and the provider's own session store.

A driving session has no reason to read any of it and must not. The locator
reaches the provider on argv because that is the protocol, and the barrier
records argv verbatim into the process row — so the host **redacts the locator
out of that record on purpose**. Its absence from the journal, the projection and
the dashboard is the mechanism working. Opening `private/` to recover what was
redacted is defeating a control, not doing research, and pasting a locator into a
report or a request re-publishes exactly what the redaction removed.

This is said out loud rather than merely omitted, because a directory left
unmentioned is avoided by habit and a directory named as forbidden is avoided by
rule.

## `raw/` is readable, and is not safe to quote

`raw/` is not `private/`: it is retained deliberately so that the complete output
survives the bounded window that went into an envelope, and reading it is a
legitimate step when the bounded evidence cut off what you need.

But it is the **unredacted** capture. What the host scrubs on the way into an
envelope, a journal record or a projection row has not been scrubbed here. So:
read it, quote nothing from it verbatim into a report, a request or a commit, and
never copy a line from it into a file. Recognition-based scrubbing is what
protects everything downstream of `raw/`, and a hand-copied line goes around it.

## Which surface answers which question

| Question | Surface |
|---|---|
| what happened to this attempt, in order | the journal |
| what state is it in right now, and what is the next action | the status command |
| what did this phase claim | the envelope for that phase and round |
| what did the host measure | the gate rows, through the projection or the dashboard |
| what process ran, with what argv | the process rows in the projection |
| how are several attempts doing | the dashboard |
| is anything orphaned, stale or degraded | the diagnosis command |
| what did the full output say, when the bounded window was not enough | `raw/`, read and not quoted |

## What is deliberately not in this document

No field names, no record shapes, no schema ids, no gate ids, no example of any
artefact's contents. `core/src/contracts/` defines all of it, and a driving
document may not restate a schema at all — so it never needs to show one.
