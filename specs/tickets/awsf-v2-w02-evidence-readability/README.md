# Tickets — AWSF v2 W02, evidence readability, T01–T05

One file per **task**, split from
[`../../awsf-v2-w02-evidence-readability-build-prompts.md`](../../awsf-v2-w02-evidence-readability-build-prompts.md)
§ Section B on 2026-08-20. **Every build prompt is carried verbatim** — this split added frontmatter
and cross-links and changed no prompt text. The files were **generated** from Section B rather than
transcribed, so the two cannot have drifted at birth.

[`../../awsf-v2-w02-evidence-readability.html`](../../awsf-v2-w02-evidence-readability.html) remains
the authority for content and status. These files exist so the plan's five tasks become
individually addressable, countable and boardable — the same granularity
`specs/tickets/awsf-v2-w01-marimba-contract/` uses (one file per `<h4>` task, not per `<h3>`
milestone).

**These are not runtime tickets.** The runtime `awsf.ticket/v1` contract
(`core/src/contracts/ticket.ts`) requires `tier`, `workflow`, `outcome`, `context`, `acceptance` and
`non_goals`, and `TicketStore` reads `specs/tickets` with no recursion. Nothing in this directory is
loaded by `awsf ticket list` or `awsf backlog`, and the runtime schema does not apply to it.

**Unlike the spine's ticket set, every prompt here writes code.** The spine's `W01`–`W14` are
meta-prompts that author deep plans. This directory is that deep plan's own build, one ticket per
implementation task.

## Frontmatter schema

| Field | Type | Source |
|---|---|---|
| `id` | `T01`–`T05`, zero-padded | filename; maps to the plan's own task numbering (`T04` = plan task 4) |
| `title` | string, always quoted | the plan's task `<h4>` heading, verbatim |
| `milestone` | `M1`–`M4` | **derived** — see below |
| `state` | `todo` \| `wip` \| `done` \| `failed` | mirrors the plan's `[]` / `[wip]` / `[x]` / `[f]` markers |
| `depends_on` | list of ids | **derived** — see below |

## Derived: `milestone`

The plan groups five tasks under four milestones, and the mapping is read off the plan's own `<h3>`
blocks rather than invented — mirroring how `awsf-v2-w01-marimba-contract`'s README derives the same
column for its nine tasks under five milestones:

| Milestone | Tasks | What it delivers |
|---|---|---|
| `M1` | `T01` | per-kind summarisers replace the five-key fallback chain |
| `M2` | `T02`, `T03` | contiguous `text.delta` runs fold into one row, reassembled and re-redacted, proven by the split-credential fixture |
| `M3` | `T04` | a rendered view sits beside the raw JSON, defaulting to rendered |
| `M4` | `T05` | the clipped run cards stop clipping, and the spine's W02 marker flips |

**Why M2 holds two tasks while M1, M3 and M4 hold one each.** M2 is the workstream's
highest-risk milestone — Collision 1's redaction-on-reassembly adaptation is security-relevant, and
the fixture that proves it (a credential split deliberately across a chunk boundary) is adversarial
by design. Splitting "write the fold module" (`T02`) from "write the tests that try to defeat it"
(`T03`) means the adversarial fixture is authored and reviewed as its own unit of work, not folded
into the same session that wrote the code it is testing — the same reason
`awsf-v2-w01-marimba-contract` splits "land the guard" (`T03` there) from "the offline denial matrix"
(`T04` there) rather than merging them.

**Why several tasks may share a milestone here, when a plan with strictly one-task milestones would
not need this note.** The sync fence checks a ticket's `state` against *both* its milestone's marker
and its own task's checklist. A shared milestone is safe when its tasks finish in order and the
milestone marker moves to `[x]` only with the last of them — which is exactly what `T03`'s prompt
instructs.

## Derived: `depends_on`

**A strict `n-1` chain**, matching the plan's own "four pieces, in this order of leverage"
instruction for the four *pieces of leverage* (M1–M4) and the finer split within M2:

| Ticket | Depends on | Why it is a real edge |
|---|---|---|
| `T01` | — | the first task; `EventLog.vue`'s `summary()` is replaced before anything else touches the component |
| `T02` | `T01` | the fold's own em-dash/unfolded-`text.delta` case reuses task 1's summariser rather than duplicating a formatting rule |
| `T03` | `T02` | the adversarial tests are written against the fold module task 2 produces; there is nothing to write fixtures against before then |
| `T04` | `T03` | the rendered view's folded-row branch (`row.reassembledText`) is only provably safe to expose once task 3's redaction fixture is green |
| `T05` | `T04` | not a data dependency — carried last because it is unrelated to the rest and because it is the task that closes the workstream and flips the spine marker, which must happen only once every other task is `[x]` |

A reviewer who disagrees with a derivation should edit this table, not re-derive it downstream.

## Derived: `tier` and `workflow` are absent

Both are **omitted deliberately**. `awsf.config.yaml`'s `risk.paths` maps `dashboard/**` to **T1**
(per the fuse-version record's Buildability note for this candidate), which would normally populate
`tier: 1`. It is recorded here in prose rather than in frontmatter for the same reason W01's README
gives: **a `tier` in a ticket reads as a call-ceiling reservation against a scheduled attempt**, and
none of these five tasks is scheduled through AWSF's own executor — they are direct implementation
work on the factory's own dashboard, driven by a human copying prompts. Naming a `workflow` would
carry the same false implication about an execution recipe. The sync fence treats both as optional
for exactly this case.

## Why Section B's headings and these ids both say `T`

Unlike the spine — whose units are workstreams and whose tickets therefore say `W` — this plan's
units are ordinary implementation tasks, so `T<nn>` is both the heading number a reader parses and
the ticket id: `T04` ↔ ticket `T04` ↔ plan task 4. One numbering, no mapping to remember. This
mirrors `awsf-v2-w01-marimba-contract`'s convention exactly.

## Keeping state in sync

The plan's status markers are the source of truth. When a task's checklist or its milestone marker
flips in `awsf-v2-w02-evidence-readability.html`, flip `state:` here **in the same commit** —
AGENTS.md invariant 12, enforced by `core/test/unit/meta/ticket-plan-sync.test.ts`.

**Two marker sets, and only one of them moves before the end.** This plan's own markers and these
tickets move on every task. The spine's W02 marker in `specs/awsf-v2-plan.html`, and `W02.md` in
`specs/tickets/awsf-v2-plan/`, are touched by **T05 only**. Current plan-aligned states: **T01–T05
`todo`.**

## Owner decisions these tickets carry

All three of the plan's Questionables were **decided 2026-08-21**, each taking the recommended
option, via an exported `plan-sota-review v1` block. They are constraints on the build, not
assignments to it — no ticket's prompt changes shape as a result, since every prompt already built
toward the recommended option. `T02`'s prompt still opens with the Q1 check (confirm it is decided
before proceeding); that check now passes rather than blocks:

| Questionable | Decision | Which ticket applies it |
|---|---|---|
| Q1 | The shared credential-matching predicate lives in `dashboard/shared/credential-patterns.ts` | `T02` |
| Q2 | The rendered view is the one-line summary, reused from `summarizeEvent()` — no richer per-kind panel | `T04` |
| Q3 | The run-card height fix bumps `.card-wrap` to `452px`, uniform across all cards | `T05` |

See the plan's own Amendments entry for 2026-08-21 for the full record.
