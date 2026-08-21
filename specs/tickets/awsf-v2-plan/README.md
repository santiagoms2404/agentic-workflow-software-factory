# Tickets — AWSF v2 spine, W01–W14

One file per **workstream**, split from
[`../../awsf-v2-plan-build-prompts.md`](../../awsf-v2-plan-build-prompts.md) § Section B on
2026-08-20. **Every build prompt is carried verbatim** — this split added frontmatter and
cross-links and changed no prompt text. The files were generated from Section B rather than
transcribed, so the two cannot have drifted at birth.

[`../../awsf-v2-plan.html`](../../awsf-v2-plan.html) remains the authority for content and status.
These files exist so the spine's workstreams become individually addressable, countable and
boardable.

**These are not runtime tickets.** The runtime `awsf.ticket/v1` contract
(`core/src/contracts/ticket.ts`) pins `id` to `^T[0-9]{2}$` and requires `tier`, `workflow`,
`outcome`, `context`, `acceptance` and `non_goals`. `TicketStore` reads `specs/tickets` with no
recursion and matches only `^T\d\d\.md$`, so nothing in this directory is loaded by `awsf ticket
list` or `awsf backlog`, and the runtime schema does not apply to it. The `W` prefix is what marks
that difference, and the ticket/plan sync fence accepts `Wnn` alongside `Tnn` for exactly this
case.

**Every ticket here is a meta-prompt.** It authors one workstream's deep plan and stops at the
owner-review gate. None writes implementation code. The deep plan each produces carries its own
build prompts and its own `specs/tickets/<stem>/` set, which the plan-aware fence will pair against
it the moment it exists.

## Frontmatter schema

| Field | Type | Source |
|---|---|---|
| `id` | `W01`–`W14`, zero-padded | filename; maps to the spine's task number (`W05` = spine task 5 = milestone M5) |
| `title` | string, always quoted | the Section B heading, verbatim |
| `milestone` | `M1`–`M14` | the spine's Workstreams grouping — one milestone per workstream |
| `state` | `todo` \| `wip` \| `done` \| `failed` | mirrors the spine's `[]` / `[wip]` / `[x]` / `[f]` markers |
| `depends_on` | list of ids | **derived** — see below |

`tier` and `workflow` are **absent, deliberately.** The plan skill's rule is to omit a field when
the plan defines no such vocabulary rather than invent one, and the sync fence treats both as
optional for that reason. This spine assigns no risk tier and names no execution recipe: its units
are planning acts, not builds. The tiers and recipes that *do* apply belong to each workstream's
own deep plan, where they are decided against that workstream's actual paths — and W02's block, for
one, already records that `dashboard/**` is tier 1 by `risk.paths`.

## Derived: `depends_on`

**`depends_on` here orders the authoring of deep plans**, because that is what these tickets' build
prompts do. It is not a build order.

| Ticket | Depends on | Why |
|---|---|---|
| `W01`, `W02`, `W03` | — | three independent starts. W01 is listed first because it drives the sessions that author the rest, not because anything technically waits on it. |
| `W04` | `W03` | the registry registers what `awsf init` creates; the catalog shape must cover its minimal config. |
| `W05` | `W04` | recipes resolve against a registered plan source, and the coverage gate extends the sync relation W04 redefines. |
| `W06` | `W05` | the shared per-role block must cover the roles W05 introduces. |
| `W07` | `W04` | needs the registry's per-project shape. |
| `W08` | `W04` | the remote allowlist lives in the catalog. |
| `W09` | `W06` | the documenter role's prompt path goes through centralised composition. |
| `W10` | `W04` | first real customer of W04's multi-repo capability. |
| `W11` | `W03`, `W04`, `W05`, `W06` | it consumes all four and adds no mechanism of its own. |
| `W12` | `W03`, `W07`, `W08`, `W11` | every workstream that adds or changes a command the reader will type. |
| `W13`, `W14` | `W12` | both are authored after v2's core lands; W12 is the last core workstream, so it is the marker. |

**One edge runs the other way, and it is not in this field.** Ordering gate **G1**: W05's deep plan
is authored before W06's, but W05's new agent-role code lands after W06's centralisation. Build-order
constraints like this are named as ordering gates in the spine's Shared Invariants section and belong
to the deep plans, not to these tickets. Both prompts that touch G1 state it explicitly.

A reviewer who disagrees with a derivation should edit the rule here, not re-derive it downstream.

## Derived: `milestone`

One workstream per milestone, `W0n` → `Mn`. This is not a stylistic choice. The sync fence checks a
ticket's `state` against both its milestone's marker and its task's checklist; grouping several
workstreams under one milestone would mean a finished workstream's ticket could not go `done` while
its milestone marker was still `[]`. One-to-one is the shape where both checks stay simultaneously
satisfiable as workstreams complete one at a time.

## Why the Section B headings say `T` and the tickets say `W`

The sync fence parses Section B with a `T`-anchored pattern (`### T(\d+) — (.+)`), so the heading
number has to be `T<nn>` for the ticket-to-prompt mapping to resolve. The **workstream identity is
the `W<nn>` that opens every title**, and it is what the ticket id, the filename, the spine
milestone and the spine's own prose all use. The mapping is one-to-one on the number: heading `T05`
↔ ticket `W05` ↔ milestone `M5` ↔ spine task 5.

## Keeping state in sync

The spine's status markers are the source of truth. When a workstream's marker flips in
`awsf-v2-plan.html`, flip `state:` here **in the same commit** — AGENTS.md invariant 12, enforced by
`core/test/unit/meta/ticket-plan-sync.test.ts`.

A spine marker moves to `[wip]` when the owner approves that workstream's deep plan, and to `[x]`
only when that deep plan's own final phase completes. **The session that authors a deep plan flips
nothing here.** Current plan-aligned states: **W01–W14 `todo`.**
