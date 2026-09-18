# Ticket set — AWSF v2 W16, the pi/OpenRouter adapter

This directory is the addressable execution surface for
[`../../awsf-v2-w16-openrouter-adapter.html`](../../awsf-v2-w16-openrouter-adapter.html), which is
workstream **W16** of [the AWSF v2 spine](../../awsf-v2-plan.html). Each ticket is one unit of
fresh-session work: the owner clears context between units, so every ticket stands alone and links
back to its plan section rather than duplicating it.

Read this file once before your ticket. Read your ticket. Do not read the other eleven.

---

## Gates before ticket T01 runs

1. **The owner has approved the plan.** It was authored in one session and stops at the owner-review
   gate; no implementation was written.
2. **The baseline is green at the exact base SHA.** T01 records the `npm run test:unit` pass count
   before it changes anything. Neither `doctor` nor `lint` catches a red baseline, and a red base
   blocks a correct build.
3. **All three Questionables are answered.** The owner decided them on 2026-09-15:
   **Q1** — a `pi`-level retry is **one call**; the ceiling counts host-launched processes.
   **Q2** — **any distinct provider may review**; open-weight routes are admissible for reviewer
   phases. **Q3** — **the provider string is the unit of inversion**, with **no per-recipe cap** on
   OpenRouter phases.
   Q2 and Q3 went against the plan's recommendations, and **neither needs code**. T11 records both
   and proves the code already matches: `oppositeProvider` asks only that a reviewer be *different*,
   and the exactly-two pair rule already refuses a recipe whose builder and reviewer both resolve to
   `openrouter`. A session that "implements" Q2 by adding a reviewer-provider allowlist has read the
   verdict backwards and built the fence it removed.
4. **No document that does not exist in this repository may be invented.** In particular there is
   **no run-failures surface** — the plan's Problem §3 records the sweep that established this, and
   a ticket that writes against one has invented it.

---

## Conventions used by every prompt

### The read-first set

- `AGENTS.md`, in full. Invariants 1, 3, 7, 9, 11 and 12 all reach this workstream.
- The task's own milestone block in the plan, and the **What Already Exists** section, which every
  prompt assumes has been read. Every row there was verified against this checkout while the plan
  was authored rather than recalled.
- `core/src/adapters/pi-codex.ts` in full, once, at T01. It is the reviewed shape this workstream is
  modelled on and **no task edits it**.

### Marker discipline — two sets, and every prompt names both

1. **This leaf plan's own markers**, in `specs/awsf-v2-w16-openrouter-adapter.html`: the task's
   checklist boxes, and at a milestone's last task the milestone `<h3>` marker too. **Flip them on
   every task, including the first.**
2. **The spine's W16 marker**, in `specs/awsf-v2-plan.html`: **do not touch it until T12.** T12 is
   the only ticket in this set that writes to the spine.

A prompt that carried only the negative would be a bug — builders read a lone "do not flip" as
"leave all markers alone", the leaf plan never advances, and the next ticket's "confirm the prior
task is `[x]`" precondition breaks. Both halves are stated in every prompt for that reason.

Flip the ticket's `state:` in the same commit as the HTML marker.

### The commit rule

One Conventional Commit per ticket, on green, with a body that says **why** the change is shaped the
way it is — the decision taken, the alternative rejected, and any row left `[f]` with the block that
holds it. `scope` is this workstream's vocabulary (`adapters`, `catalog`, `stream`, `cost`,
`registry`, `routing`), never a file path. The plan HTML marker flips and the ticket `state:` change
go in the same commit. Never name an agent, model, or AI tool in a commit identity, message, or
trailer — `no-agent-coauthor.test.ts` enforces it.

### The handoff duty

Every prompt ends with one. Before finishing, open the ticket files whose `depends_on` names your id
and append dated, numbered entries (C1, C2, …) to their `## Handoff` section: contradictions between
their prompt and what is now true (saying which wins), moved or renamed files their read-first block
names, findings that change what they should do, options you rejected so they are not re-litigated,
and scope they can skip or must now absorb. **Do not rewrite their build prompt** — the prompt is
the authored record and the Handoff is the correction layer. An empty Handoff is a real answer.

### The never-do list

Each is a plausible convenience that would break a locked decision, with the reason it is tempting.

| Never | Tempting because | Why not |
| --- | --- | --- |
| Edit `PI_PROVIDER` or `PiCodexAdapter`'s argv | one config parameter would save a whole file | an unreviewed route would inherit a reviewed adapter's descriptor tests — the pin's own comment says so |
| Widen `SAFE_MODEL_SELECTOR` in place | it is one regex, and both routes are `pi` | it would admit `vendor/model` on the Codex route, where a slash still names a second provider inside a flag that already has one, and every positive test would still pass |
| Widen `ENV_ALLOWLIST` | an API key sounds like something a provider needs | it is not: the key lives in `pi`'s auth store, reached through `HOME`, already allowlisted. AWSF touches no credential |
| Add a normalized event kind for retries | a retry feels like an event | the twelve kinds are a vocabulary every adapter shares and every consumer switches on; one CLI's transport behaviour is a `notice` |
| Charge a retry against the call ceiling | it did cost tokens | it needs the ledger mutated mid-run from a stream event, reopening the concurrency hole `reserve()`'s synchronicity closes. See Questionable 1 |
| Widen inversion to three providers | the refusal is inconvenient | decided against on 2026-09-15 (Q3): the pair rule stands and the provider string is the unit |
| Add a reviewer-provider allowlist | "open-weight reviewers are now allowed" sounds configurable | the opposite — nothing ever forbade them (Q2). A list of permitted reviewers is a fence the verdict removed |
| Claim `costAuthority: "provider"` early | the number is right there and looks like money | the Codex route was demoted for exactly this once already; four evidence items gate it and one is unread |
| Regenerate a fixture to refresh it | it is one command | fixtures here are replayed. A second live call is warranted only by a new fact nobody has captured |

---

## Why the Handoff section comes first

In every ticket here, `## Handoff` sits **above** `## Build prompt`, which is the reverse of the
usual reading order. It is mechanical rather than stylistic.

`core/test/unit/meta/ticket-plan-sync.test.ts` reads a ticket's prompt as *everything after the
build-prompt heading*, and asserts it byte-identical to the matching `### Tnn — title` block in
`../../awsf-v2-w16-openrouter-adapter-build-prompts.md`. A `## Handoff` section placed after the
prompt would therefore be compared against Section B and fail the moment anyone appended to it —
which is the one thing the Handoff exists to allow. Putting it above keeps the prompt as the file's
tail, so appending to the Handoff never puts the ticket out of sync.

**The consequence to remember:** a session that edits a build prompt must edit **both** this
directory's ticket and Section B of the build-prompts file, in the same commit. The fence will tell
you, loudly, but by then you have already written it twice.

## Two prompt surfaces, and why this set has both

The plan-sota ticket workflow says the ticket directory is the only prompt artifact and that no
`<stem>-build-prompts.md` should exist. **This repository's own fence disagrees, mechanically:**
`resolvePlanSources` pairs every `.html` in `specs/` with `<stem>-build-prompts.md`, and where a
ticket set exists the sync test asserts that file exists and that every prompt matches it byte for
byte. A fence that fails the suite beats a convention in a skill file, so this set ships both.
Reconciling the two properly belongs to whoever owns invariant 12, not to this workstream.

---

## Frontmatter schema

```yaml
id: T01                 # filename and plan task number, zero-padded
title: "..."            # quoted; exact Section B heading text
milestone: M1           # the plan milestone the task lives in
state: todo             # todo | wip | done | failed; mirrors the plan's markers
depends_on: []          # this plan's dependency chain, pointing backwards only
serves: [AC-2]          # the plan task's own Identifier Spine claims
```

`tier` and `workflow` are **deliberately absent**: this plan defines neither vocabulary for its own
tasks. The sync fence treats an absent optional field as a legitimate shape and a present-but-wrong
one as the defect, so inventing a taxonomy to fill them would be the error.

## Derived-field rules

Every field below was derived rather than read verbatim off the plan. Edit the rule here rather than
re-deriving it downstream.

- **`milestone`** — M1 for T01–T03, M2 for T04–T06, M3 for T07–T09, M4 for T10–T12.
- **`depends_on`** — follows the plan's stated chain including its granted parallelism, not a blind
  `n−1` chain. Two places fork and rejoin: **T07 and T08 both depend on T06 and not on each other**
  (the rendering fix and the live capture are independent, and T08 must not wait on T07), and a
  milestone's final testing task depends on **every** substantive task in its milestone — T03 on
  [T01, T02], T06 on [T04, T05], T09 on [T07, T08], T12 on [T10, T11].
- **`serves`** — copied from the plan task's own `<code class="serves">` claims. The fence's MIRROR
  rule compares the two as sets and fails when either side is edited alone.
- **`state`** — mirrors both the containing milestone marker and the task's own checklist. Flip the
  HTML markers and the ticket `state:` in the same commit.

## Execution order

```
T01 ─▶ T02 ─▶ T03 ─┐            M1 · selector admission
                   ▼
                  T04 ─▶ T05 ─▶ T06 ─┐      M2 · the adapter
                                     ▼
                              ┌── T07 ──┐
                              │         ▼
                              └── T08 ─▶ T09 ─┐   M3 · cost authority, earned
                                              ▼
                                        T10 ─▶ T11 ─▶ T12   M4 · registration and closure
```

It forks once, at T06, and rejoins at T09. Everything else is a straight line, because each task
consumes the module or the fixture its predecessor produced.

**T08 is the only ticket that spends live quota** — one bounded call, which is the workstream's
entire budget. **T12 is the only ticket that writes to the spine.**
