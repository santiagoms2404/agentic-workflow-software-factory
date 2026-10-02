# Tickets — AWSF v3 spine, W01–W15

One file per **workstream**, generated from
[`../../awsf-v3-plan-build-prompts.md`](../../awsf-v3-plan-build-prompts.md) § Section B on
2026-10-02. Every build prompt is carried byte for byte, so the two cannot have drifted at birth.
[`../../awsf-v3-plan.html`](../../awsf-v3-plan.html) is the authority for content and status.

**These are not runtime tickets.** The runtime `awsf.ticket/v1` contract pins `id` to `^T[0-9]{2}$`,
and `TicketStore` reads only `specs/tickets/T<nn>.md` without recursion, so nothing here is loaded by
`awsf ticket list` or `awsf backlog`. The `W` prefix marks that difference, and the ticket/plan sync
fence accepts `Wnn` for exactly this case.

**Every ticket is a meta-prompt.** It authors one workstream's deep plan and stops at the
owner-review gate. W05 is the exception in shape: its deep plan already exists as v2's W19, and its
prompt re-cuts that plan.

## Execution

| Item | Rule |
|---|---|
| Writable repository | This AWSF checkout, `specs/` only. W08 and W15 plan work in other repositories but write only here. |
| Execution context | **Manual, logged exception** (spine gate GM) until W03 is `[x]`: no factory role can write `specs/*.html`. After that, deep plans may be authored through the factory as W03's deep plan describes. |
| Commits | Only when the owner authorizes it in the session, as Santiago Marin `<santiagomarinsuarez@me.com>`. Never an agent, model or tool in identity, message or trailers (invariant 11). |
| Shared conventions | The prompts file's "Conventions used by every prompt" section. |
| Asset access | None. No workstream here has a design input yet; a deep plan that adds one names its asset gate. |

## Frontmatter schema

| Field | Type | Source |
|---|---|---|
| `id` | `W01`–`W15` | filename; `W05` = spine task 5 = milestone M5 |
| `title` | quoted string | the Section B heading after `T<nn> — `, verbatim |
| `milestone` | `M1`–`M15` | one workstream per milestone |
| `state` | `todo` \| `wip` \| `done` \| `failed` | mirrors the spine's `[]` / `[wip]` / `[x]` / `[f]` |
| `depends_on` | list of ids | derived, below |

`tier`, `workflow`, `serves` and `task_class` are absent on purpose. This spine assigns no risk
tier, names no recipe and declares no identifier spine: its units are planning acts. Each deep
plan decides those against its own paths.

## Derived: `depends_on`

`depends_on` orders deep-plan authoring: a workstream's deep plan is authored after every
dependency's deep plan is approved. Because the sync fence refuses a `done` ticket whose dependency
is not `done`, it also orders completion. Edges are real and backward, never a chain.

| Ticket | Depends on | Why |
|---|---|---|
| W01, W03, W04 | — | independent starts in Phase A |
| W02 | W01 | traps assert K1's refusals, and W01's cause record names the trap a stop needs |
| W05 | W01, W02 | Delegate acts are expressed in K2's actor model; GR |
| W06 | W02, W05 | the policy composes with leases and W19 M4's fallback route; GR |
| W07 | W02, W05 | W05's re-cut hands it W19 M5; GR for the agent-driven half |
| W08 | W01, W02, W04 | K3 builds on K2; native capture uses W04's format; GR |
| W09 | W03, W05, W08 | closed specs are known once closure works; W19 M6–M7 via W05; the harness is the driver the index serves |
| W10 | W01, W02, W04, W05, W08 | labels, records and confirmations; suites from W02 and W08; W19 M8 via W05; GR |
| W11 | W02 | the dev-environment category reuses doctor's checks |
| W12 | W02 | the VM host is accepted by doctor and the trap suite |
| W13 | W02, W07, W11 | staging receives validated builds of a scored project; GR |
| W14 | W02, W08, W13 | pulled when the harness opens, watching what deploy published; GR |
| W15 | W08, W12 | only after the harness is proven, and the native app needs the Mac |

**Gate GR (intent decision 13)** is stricter than the fence: no autonomy-widening build in W05,
W06, W07 (agent-driven half), W08, W10, W13 or W14 lands before W02 is `[x]`. Each of those lists
W02 directly so the rule is visible here, and each deep plan carries GR as a gate before its first
widening build.

A reviewer who disagrees with a derivation edits the rule here, not downstream.

## Why the Section B headings say `T` and the tickets say `W`

The fence parses Section B with `^### T(\d+) — (.+)$`. The workstream identity is the `W<nn>` that
opens every title. The mapping is one-to-one on the number: heading `T05` ↔ ticket `W05` ↔
milestone `M5` ↔ spine task 5.

## Keeping state in sync

The spine's markers are the source of truth. When a workstream's marker flips in
`awsf-v3-plan.html`, its `state:` here flips **in the same commit** (invariant 12, enforced by
`core/test/unit/meta/ticket-plan-sync.test.ts`). A marker moves to `[wip]` in the owner's commit
approving the deep plan, and to `[x]` only when that deep plan's final milestone lands. **The
session that authors a deep plan flips nothing here.** At authoring, W01–W15 are all `todo`.

## Handoff sections

`## Handoff` sits above `## Build prompt` so dated findings can be appended without breaking
Section B equality. W05's session writes W19's carried milestones into the Handoff of W07, W09 and
W10. No Handoff ever records live attempt state.
