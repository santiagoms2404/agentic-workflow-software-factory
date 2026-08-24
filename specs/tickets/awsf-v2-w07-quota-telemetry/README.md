# Ticket set — AWSF v2 W07 quota telemetry

This directory is the addressable execution surface for
[`../../awsf-v2-w07-quota-telemetry.html`](../../awsf-v2-w07-quota-telemetry.html).
The readable concatenated source is
[`../../awsf-v2-w07-quota-telemetry-build-prompts.md`](../../awsf-v2-w07-quota-telemetry-build-prompts.md)
§ Section B. Each ticket's build-prompt body is byte-identical to its Section B block, and the
tickets were generated from that file rather than transcribed, so the two cannot drift by hand.

## Frontmatter schema

```yaml
id: T01                 # filename and plan task number, zero-padded
title: "..."            # quoted; exact Section B heading
milestone: M1           # derived from the containing plan phase
state: todo             # todo | wip | done | failed; mirrors plan markers
depends_on: []          # plan dependency chain
serves: [AC-1]          # present only when the plan task claims identifiers
```

`tier` and `workflow` are omitted: this plan defines neither vocabulary for its own tasks. The
plan-sync fence treats an absent optional field as a legitimate shape and a present-but-wrong one as
the defect, so inventing a taxonomy to fill them would be the error.

## Derived-field rules

Every field below was derived rather than read off the plan. Edit the rule here rather than
re-deriving it downstream.

- **`milestone`**: M1 for T01–T03, M2 for T04–T06, M3 for T07–T08, M4 for T09–T11, M5 for T12–T13,
  M6 for T14–T17, M7 for T18–T20.
- **`depends_on`**: T01 has none. A milestone's final Testing-Strategy task depends on **every**
  substantive task in its milestone, not only the immediately preceding one — T03 on [T01, T02],
  T06 on [T04, T05], T11 on [T09, T10], T17 on [T14, T15, T16], T20 on [T18, T19] — because a
  testing task exercises the whole milestone. Every other task depends on the one before it, because
  each consumes the module or fixture its predecessor produced.
- **`serves`**: copied from the plan task's own `<code class="serves">` claims. The sync fence's
  MIRROR rule compares the two as sets and fails when they differ, so this field is never edited on
  one side alone.
- **`state`**: mirrors both the containing milestone marker and the task's own checklist. Flip the
  HTML markers and the ticket state in the same commit.

## Two derived rules that live in the code, recorded here because they are easy to re-derive wrongly

These are not frontmatter fields. They are recorded in this README because both are derivations a
later reader would otherwise reconstruct from scratch, and both have a wrong answer that produces a
plausible number with no error anywhere.

### The render-source rule — how minutes-to-reset is obtained without reading `windows[]`

The runtime contract says render only from `quotaSemantics.effectiveAvailability` and never from
`windows[]`, yet the reset instant lives on a window. These do not conflict.

> **`effectiveAvailability` selects which window binds; the reset instant is then read from that
> named window and from no other.**

The scope's `runway` supplies `limitingWindowId` and, for a finite projection, `usableRunwaySeconds`
and `projectedExhaustedAt`; `boundedBy` names every window included in the effective figure. The
forbidden act is **choosing** a window by scanning `windows[]` — never the act of dereferencing the
one the effective figure already named. Written as a rule a test holds: *no code path may index
`windows[]` except by an id that came out of `effectiveAvailability`.* When `runway.status` is
`through_reset` there is deliberately no synthetic deadline and the reset instant is the binding
window's `resetsAt`; when it is `unknown`, minutes-to-reset is `null` — never zero, never inferred.

### The route-mapping rule — two different ids, deliberately

- The **threshold** is keyed by **adapter id**, matching `ConfiguredPhaseRoute.adapterId` in
  `core/src/workflow/phase-launch-authorization.ts`, because that is what "route" already means in
  this repository.
- The **provider probed** is derived from the adapter's **kind**: `claude-code → claude`,
  `pi-codex → codex`. `fixture` maps to nothing and is reported as *spends no quota*;
  `antigravity` maps to nothing measurable and is reported as *unmeasurable*; `composite-fusion`
  reports the kinds of its members, or *unmeasurable* when they do not resolve.

The reason they are different: **an adapter id is an owner-chosen label.** A project that named its
Codex route `claude` would, under an id-based mapping, probe the wrong provider and report a
plausible wrong window with no error anywhere. A disabled adapter is neither probed nor reported,
and the provider CSV is built from enabled routes only — a full sweep would touch auth sources for
providers the project does not use and buy nothing.

## The two gates on this ticket set

Both are owner-authored commits into protected paths. **No agent writes either file**, and each
gated ticket's first act is to verify the commit landed and to mark itself `[f]` if it has not —
routing around a protected path is not an option this ticket set offers.

**G7-A blocks T07 onward.** The per-route threshold lives in `awsf.config.yaml`, listed in
`policy.protected_paths`. One commit restates that file's durable-intent line to distinguish
measured quota state (still forbidden) from a durable quota policy threshold (permitted).
**It is the permission only, and adds no `quota_stop` block:** `RoutingSchema` carries
`additionalProperties: false` and `load.ts` hard-fails, so a block written before T07's schema change
breaks every command with `/routing/quota_stop: Unexpected property`. T07 extends the schema —
`core/src/config/**` is not protected — and actual values are a separate optional owner commit
afterwards, since absent means the stop is disabled. T01–T06 do not wait on it.

**G7-B blocks T15 onward.** Q1 was decided on 2026-08-24: the stop gets its own legal edge,
`L26 — RUNNING → AWAITING_OWNER`, actor `host`, not a spawn site, not interactive, not a correction
edge. `core/src/state/**` is protected, so one commit touches two files — the edge in
`task-machine.ts` and its guard in `guards.ts`. **No migration is involved**: `0001-initial.sql`
declares `from_state`, `to_state` and `edge_id` with no `CHECK`. The test-side mirrors in
`core/test/unit/_lifecycle-tables.ts` and `core/test/unit/transitions.test.ts` are agent work and
belong to T15. T01–T14 do not wait on it.

The two gates are independent and may land in either order.

## Shared read-first set

Every fresh session reads `AGENTS.md`, the named task and containing milestone in the HTML plan, and
the source files its own prompt names. `CLAUDE.md` and `docs/TESTING.md` did not exist when this plan
was authored and must not be invented to satisfy a template.

## Sync rule

`core/test/unit/meta/ticket-plan-sync.test.ts` resolves this plan through the registered plan source
and checks task coverage, milestone, marker and checklist state, title, dependency ordering, exact
Section B prompt bytes, and the identifier-spine COVERAGE / ORPHANS / MIRROR rules. The HTML plan is
the status source of truth.

## No open questions

All nine of the plan's Questionables were decided by the owner on 2026-08-24 and are constraints
this ticket set implements. The only two things the workstream waits on are the owner commits behind
**G7-A** and **G7-B** above, and both are acts rather than decisions.

Q9's decision is the one that reaches into a ticket body: **T05 makes retention automatic** — on
`unparseable` or `nonzero-exit` the probe writes the raw bytes to the attempt's private uncommitted
area at `0o600` and journals the path, never the bytes. T20 re-checks the outcome, so the named
absence either closes with a scrubbed fixture or stands with its record still accurate.
