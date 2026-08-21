# Tickets — AWSF v2 W01, marimba's operating contract, T01–T09

One file per **task**, split from
[`../../awsf-v2-w01-marimba-contract-build-prompts.md`](../../awsf-v2-w01-marimba-contract-build-prompts.md)
§ Section B on 2026-08-21. **Every build prompt is carried verbatim** — this split added frontmatter
and cross-links and changed no prompt text. The files were **generated** from Section B rather than
transcribed, so the two cannot have drifted at birth.

[`../../awsf-v2-w01-marimba-contract.html`](../../awsf-v2-w01-marimba-contract.html) remains the
authority for content and status. These files exist so the plan's nine tasks become individually
addressable, countable and boardable.

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
| `id` | `T01`–`T09`, zero-padded | filename; maps to the plan's own task numbering (`T04` = plan task 4) |
| `title` | string, always quoted | the Section B heading, verbatim |
| `milestone` | `M1`–`M5` | **derived** — see below |
| `state` | `todo` \| `wip` \| `done` \| `failed` | mirrors the plan's `[]` / `[wip]` / `[x]` / `[f]` markers |
| `depends_on` | list of ids | **derived** — see below |

## Derived: `milestone`

The plan groups nine tasks under five milestones, and the mapping is read off the plan's own
`<h3>` blocks rather than invented:

| Milestone | Tasks | What it delivers |
|---|---|---|
| `M1` | `T01`, `T02` | the tree's three false boundary claims retired, and a fence so the wording cannot return |
| `M2` | `T03`, `T04` | marimba's four installed files landed in one directory — guard, session banner, settings example, README — with the offline denial matrix over them |
| `M3` | `T05`, `T06` | the contract, and the fences that hold its three properties |
| `M4` | `T07` | the route hole closed for every document in the tree, not just the contract |
| `M5` | `T08`, `T09` | the owner's install, the evidence record, and the spine roll-up |

**Why several tasks may share a milestone here, when the spine used one-to-one.** The sync fence
checks a ticket's `state` against *both* its milestone's marker and its own task's checklist. A
shared milestone is safe when its tasks finish in order and the milestone marker moves to `[x]` only
with the last of them — which is exactly what this plan's prompts instruct. The spine needed
one-to-one for the opposite reason: its fourteen workstreams complete in an order nothing constrains.

## Derived: `depends_on`

**A strict `n-1` chain, and here that is a derivation rather than laziness.** Each task in this plan
genuinely consumes the previous one's output:

| Ticket | Depends on | Why it is a real edge |
|---|---|---|
| `T01` | — | the first task |
| `T02` | `T01` | the fence is written against the repaired tree; written first it would fail on the sentences task 1 removes |
| `T03` | `T02` | the guard moves only after the tree it joins stops contradicting it |
| `T04` | `T03` | the matrix runs against the **committed** scripts — guard and banner — which task 3 creates |
| `T05` | `T04` | the contract asserts the guard's behaviour, so that behaviour is pinned by a test first |
| `T06` | `T05` | a fence over a document needs the document |
| `T07` | `T06` | the generalised route scan reuses the matcher task 6 imports, and must not race its export |
| `T08` | `T07` | the evidence record describes work that is finished |
| `T09` | `T08` | acceptance runs last, and is the only task that touches the spine |

A reviewer who disagrees with a derivation should edit this table, not re-derive it downstream.

## Derived: `tier` and `workflow` are absent

Both are **omitted deliberately**, and the reason is not that no tier applies. `awsf.config.yaml`'s
`risk.paths` maps no glob to `docs/**` or `core/test/**`, so `risk.default: T1` is what these paths
would take. It is recorded here rather than in frontmatter because **a `tier` in a ticket reads as a
call-ceiling reservation against an attempt**, and none of these nine tasks is scheduled through
AWSF's own executor — they are owner-driven work on the factory itself. Naming a `workflow` would
carry the same false implication about an execution recipe. The sync fence treats both as optional
for exactly this case: present-but-wrong is the defect, absent is a legitimate shape.

## Why Section B's headings and these ids both say `T`

Unlike the spine — whose units are workstreams and whose tickets therefore say `W` — this plan's
units are ordinary implementation tasks, so `T<nn>` is both the heading number the sync fence parses
(`### T(\d+) — (.+)`) and the ticket id. Heading `T05` ↔ ticket `T05` ↔ plan task 5. One numbering,
no mapping to remember.

## Keeping state in sync

The plan's status markers are the source of truth. When a task's checklist or its milestone marker
flips in `awsf-v2-w01-marimba-contract.html`, flip `state:` here **in the same commit** — AGENTS.md
invariant 12, enforced by `core/test/unit/meta/ticket-plan-sync.test.ts`.

**Two marker sets, and only one of them moves before the end.** This plan's markers and these
tickets move on every task. The spine's W01 marker in `specs/awsf-v2-plan.html`, and `W01.md` in
`specs/tickets/awsf-v2-plan/`, are touched by **task 9 only**. Current plan-aligned states:
**T01–T09 `todo`.**

## Owner decisions these tickets carry

All seven of the plan's Questionables were decided by the owner on **2026-08-21**, each taking the
recommended option — five through an exported `plan-sota-review v1` block, and two by owner
direction after that block left them without a verdict. They are constraints on the build, not
assignments to it, and `T03`, `T04` and `T08` carry them in their prompts:

| Questionable | Decision | Which ticket applies it |
|---|---|---|
| Q6 | the repository holds the guard's only copy | `T03` |
| Q1 | everything lives in `docs/driving/marimba/` | `T03` |
| Q2 | a rejected payload fails open; an unrunnable parser fails closed | `T03` writes it, `T04` asserts it |
| Q4 | a `SessionStart` banner lands with the guard | `T03` writes it, `T04` asserts it |
| Q5 | captured refusals are payload fixtures plus a redacted quotation in the plan's Amendments | `T08` |
| Q3 | **do not build** the guard's self-write fence; state the gap instead | `T03`, as an explicit checklist item |
| Q7 | **do not add** `--setting-sources user`; the launcher keeps `--settings` alone | no ticket — the launcher is owner-side |

**Two of the seven were decided as "do not build it", and each names its own trigger to reopen** —
an actual accidental edit to the guard for Q3, and one unrun probe for Q7. `T03` carries Q3's
refusal as a checklist item on purpose: a decision not to build looks identical to an oversight
unless the plan says which one it is.

The verdicts changed one ticket's **title**: `T03` was "Move the guard into the tree as its single
source of truth…" and became "Land marimba's installed files in the tree…", because Q4 added a
fourth installed file and the old title no longer covered what the task does. Ticket ids, milestone
grouping and `depends_on` are unchanged.
