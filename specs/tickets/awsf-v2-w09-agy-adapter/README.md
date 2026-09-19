# `awsf-v2-w09-agy-adapter` — ticket set

Execution surface for [`../../awsf-v2-w09-agy-adapter.html`](../../awsf-v2-w09-agy-adapter.html), the deep
plan for **W09 — the `agy` adapter, parser first**: a parser written against bytes that are already in the
tree, a set of refusals that are not approximations, and a route that ends the workstream **disabled**.

- **Deep plan:** [`../../awsf-v2-w09-agy-adapter.html`](../../awsf-v2-w09-agy-adapter.html)
- **Spine:** [`../../awsf-v2-plan.html`](../../awsf-v2-plan.html) § Implementation Phases → Milestone M9 → W09
- **Spine ticket:** [`../awsf-v2-plan/W09.md`](../awsf-v2-plan/W09.md)
- **Prompt source:** [`../../awsf-v2-w09-agy-adapter-build-prompts.md`](../../awsf-v2-w09-agy-adapter-build-prompts.md)
  § Section B — each ticket's `## Build prompt` is byte-identical to its block there.
- **The evidence:** [`../../fixtures/agy/`](../../fixtures/agy/) — five streams, a help dump and a version
  string, captured 2026-09-15 from `agy.exe` 1.1.15. **Read its `README.md` before the spine's W09 prose.**

Twenty tickets, `T01`…`T20`, across five milestones. One ticket is one fresh session.

---

## This workstream is optional, and M1 is allowed to end it

Nothing in v2 waits on W09. **Milestone M1 is a decision milestone and it costs no quota.** It retains the
bytes where the repository's own fences reach them, pins the containment obstacle to a test, extends the
credential sweep, and then **stops for the owner's answer to Q4**. Closing the workstream there — with the
evidence retained and the gap recorded — is a legitimate outcome the spine sanctions by name, and the
capture has made it *more* defensible rather than less.

**T04 must not start M2.** A session that reaches T04, runs the validation set and then keeps going has
skipped the gate.

---

## The route ends disabled, and that is the stop condition

Not an incomplete state. The plan's stop condition is *the parser is fixture-complete with the route still
disabled, and enabling it is a separate, explicit owner act*. T18 proves it is off through three independent
doors. **No ticket enables it and no ticket edits `awsf.config.yaml`** — that file is protected, and
`path-policy` rejects `protected-path` independently of the write globs.

---

## Gates before execution

**A session that starts a gated task before its gate has landed should stop and say so rather than work
around it.**

### G9-A — the owner answers Q4 before T05 (gates **T05**)

M1's four tasks run unconditionally. **M2 does not start until the owner has answered Q4**, because the
alternative branch — close unbuilt, keep the bytes — makes every later ticket unnecessary rather than
merely deferred. T04's prompt puts the decision to the owner and stops for it.

### G9-B — no executable is resolvable, and this blocks graduation rather than building (informational)

`executable: agy` fails `resolveExecutable`'s PATH search, because the binary is reached through a
**shell alias** and the environment allowlist passes only `PATH`, `HOME` and `TMPDIR`. An absolute path
cannot be committed instead: `ABSOLUTE_PATH_PATTERN` in `core/src/config/machine-path.ts` matches `/`,
`C:\`, `\\` and `~` on **every string leaf**. The two exits are an owner-side `PATH` install or the
machine-local layer `awsf-v2-w04-project-registry` introduces. **Both are outside this workstream.** No
ticket is blocked by this; it is recorded so nobody discovers it mid-build and widens a task to absorb it.

### G9-C — the `--sandbox` probe has not been run (gates nothing; **closes** graduation)

The spine's permission-graduation condition waits for captured bytes proving a tool-scoping flag or an OS
boundary. `help.txt` confirms **no allow/deny flag exists**, closing the first branch on read evidence.
`--sandbox` is the only untested candidate for the second, and **no `stream7` exists in the capture**.
Absent bytes means graduation waits — that is the condition working. T19 writes the dossier that records
this as *closed for want of evidence*, specifies the probe, and fixes the reading of each outcome before
any bytes arrive. **No ticket runs the probe**; it is an owner act.

---

## Conventions used by every prompt

### The read-first set

Every session reads `AGENTS.md` in full, this README, and the deep plan's **Purpose, Problem, Solution,
Identifier Spine and "The Event Mapping"** sections in full before its own milestone. Each ticket adds the
files specific to its task.

**Read `specs/fixtures/agy/README.md` before the spine's W09 prose.** The capture corrects that prose, and
the plan's Problem section 1 lists all four corrections with what each one changes.

### The baseline rule

Run `npm run test:unit` **at the exact base SHA before changing anything**, and again after. `doctor` and
`lint` do not catch a red baseline, and a red base blocks a correct build. Record both counts in the commit
body. This applies after *any* commit, including the owner's.

### Marker discipline — both sets, always

Two marker sets, and every prompt addresses both explicitly:

1. **This plan's own markers** in `specs/awsf-v2-w09-agy-adapter.html` — the task's checklist boxes, and the
   milestone header on a milestone's last task. **Flip them on every task, including the first.**
2. **The spine's W09 marker** in `specs/awsf-v2-plan.html` — **do not touch it until T20**, which is the only
   ticket that writes to the spine at all.

Flip the ticket's `state:` in the same commit as the HTML markers. The plan's status markers are the source
of truth; the ticket mirrors them.

### The commit rule

One Conventional Commit per ticket, once its Definition of Done is green, with a body saying what changed
and **why** — the decision behind the shape, the alternative rejected, and any row left `[f]` with the
condition holding it. Include the plan marker flips and the ticket's `state:` change in the same commit.
**Never put an agent, model, or AI tool in the commit identity, message, or trailers.**

### The handoff duty

Every prompt ends with it: before finishing, open the ticket files whose `depends_on` names this id and
append dated, numbered entries (`C1`, `C2`, …) to their `## Handoff` section — contradictions, moved files,
findings, rejected options, scope that moved. Say plainly which source wins when two disagree. An empty
handoff is a real answer.

### Why the Handoff section comes first

The sync fence splits each ticket body on `## Build prompt\n\n` and compares **everything after it** against
Section B byte for byte. A `## Handoff` section below the prompt would break byte-identity on its first
entry. It therefore sits **above** the prompt, where it can grow freely.

### The never-do list

Each of these is a plausible convenience that would break a locked decision. The reason each is tempting is
stated, because a rule without its reason gets worked around.

- **Do not enable the route, or edit `awsf.config.yaml`.** *Tempting because:* the parser works and the
  config change is one word. It is a protected file, and enabling it is an owner act — inventing an
  owner-authorized change mechanism to route around that is the boundary working.
- **Do not turn a refusal into a default to make a test pass.** *Tempting because:* the three refusals in
  M3 look like unimplemented features. They are measurements: `--effort` has no off switch, there is no
  allow/deny flag, and the executable cannot be named in committed config.
- **Do not describe detection as prevention.** *Tempting because:* the ordering evidence is real and
  "detected before it ran" is a natural sentence. `ACTIVE` precedes **completion**, not proven
  **initiation**, and a subagent's calls are not in the parent's stream at all.
- **Do not claim invariant 3 contains the provider's spawns.** *Tempting because:* the fence is strict and
  well tested. It confines **AWSF's** spawns. `invoke_subagent` means the tool creates spawn sites on the
  far side of it.
- **Do not scrub the capture's machine paths.** *Tempting because:* invariant 9 and the ownership table are
  strict about machine paths elsewhere. Here the `cwd` values **are the evidence** for two of the plan's
  four corrections; T01 records that decision so a later sweep does not discover it.
- **Do not regenerate a fixture.** *Tempting because:* a fresh capture would "refresh" the bytes. It spends
  quota to reproduce what the tree already holds, and it breaks the provenance.
- **Do not synthesise a fixture for an unobserved shape.** *Tempting because:* a coverage hole is
  uncomfortable. A byte **prefix** of a real capture is legitimate — every byte in it was captured, and
  `capture.startsWith(prefix)` is asserted. An invented variant is not.
- **Do not map anything to `E_QUOTA_EXHAUSTED` on this route.** *Tempting because:* the other two routes
  have quota fixtures. No quota refusal has been captured here and `agy` is closed-source, so there is no
  wording to read. Guessing it is how a retry loop gets built on a sentence nobody has seen.
- **Do not set `costAuthority` to `catalog-estimate`.** *Tempting because:* token counts are right there.
  The provider reports **no cost**, there are no rate figures for this family, and `MODEL_FAMILIES` keeps
  `contextWindow: null` for exactly this reason.
- **Do not run the `--sandbox` probe or the `--input-format` probe.** *Tempting because:* both are one
  command. Both are owner acts outside the task graph, and the plan recommends they ride in one session or
  not at all.
- **Do not edit the build prompts or the tickets by hand.** *Tempting because:* a one-word fix is obvious.
  The two must stay byte-identical; regenerate both from one source.
- **Do not read `specs/awsf-v2-candidates.md` or `specs/awsf-v2-candidates-GPT-version.md`.** Both headers
  mark claims inside them as false. The fused version supersedes them.

---

## Frontmatter schema

```yaml
---
id: T05                    # matches the filename
title: "The decoder skeleton, and a stream that opens with prose"
milestone: M2              # the plan's milestone for this task
state: todo                # todo | wip | done | failed — mirrors []/[wip]/[x]/[f]
depends_on: [T04]          # [] for T01 only
serves: [AC-2]             # the plan task's identifier-spine claims
---
```

**Deliberately absent.** `tier` is omitted: this plan defines no risk tier of its own, and the task ids are
already `T`-prefixed, so a `tier` field would collide unreadably. `workflow` is omitted: this plan names no
execution route from the workflow catalog — every task is ordinary repository work run by hand.

---

## Derived-field rules

Every field not read verbatim off the plan, and every parser rule the plan derived from the bytes rather
than reading off a document. **Edit the rule here rather than re-deriving it downstream.**

### Ticket frontmatter

| Field | Derivation |
|---|---|
| `id`, `milestone` | Read off the plan: `<h4>n.` is the task number, and the enclosing `Milestone Mx` heading is the milestone. |
| `title` | The plan's `<h4>` text with its number and any markup stripped. It must equal the Section B heading exactly; the fence compares them. |
| `serves` | The plan task's `<code class="serves">` claims, as a **set**. The fence compares both directions. |
| `depends_on` | The plan's stated order, **not** a blind `n−1` chain. Three forks are real: T06 and T07 both depend only on T05; T11 and T12 both depend only on T10; T14, T15 and T16 all depend only on T13. Each milestone's Testing-Strategy task depends on every substantive task in its milestone. |
| `state` | `todo` at authoring. The fence checks it against both the milestone marker and the task's own checklist. |

### Parser rules derived from the capture

These are the plan's § The Event Mapping, restated so a build session does not have to re-derive them.

| Rule | Derivation |
|---|---|
| **`usage` is emitted once, from `result`** | `result.usage` is the exact field-by-field **sum** of the `DONE` steps' usage. Measured on `stream2`: 13351+2180+2534+3153 = 21218 input; 790+92+394+104 = 1380 output; 0+12126+12120+12119 = 36365 cache-read; total 22598. Emitting per step **and** at the terminal would double every figure. |
| **`total_tokens` excludes cache reads** | Per step, `total_tokens` equals `input + output` exactly in all four of `stream2`'s usage-bearing steps. `cache_read_tokens` is reported alongside, never inside. |
| **`reasoningRelation: "unknown"`** | `thinking_tokens ≤ output_tokens` in every step, which is *consistent* with reasoning being a share of output and is **not proof**. `agy` is closed-source, so the vendor-source reading that settled it on the `pi` route is unavailable. |
| **`cacheWriteTokens: null`** | The provider reports no such field. `null` means "not reported"; `0` would be authoritative data about something nobody measured. |
| **`durationMs = Math.round(duration_seconds × 1000)`** | The contract requires a non-negative integer; the provider reports a float (`8.198992` → `8199`). |
| **`provenance: "route-attributed"`** | The capture contains **no model identity at all** — `init` carries exactly `cwd`, `tools`, `permission_mode`, and a scan of all five streams for the substring `model` returns zero matches. |
| **`costAuthority: "unavailable"`** | Five token counts and **no cost** anywhere in the stream, and no rate figures exist for this family. |
| **`toolCallId` is host-minted** | `mintToolCallId` over a map from `step_index`. `ACTIVE` and `DONE` share a `step_index`, which is what pairs them; provider ids never reach a normalized event. |
| **`user_input` and `system_message` emit nothing** | Both were observed carrying no text, no usage and no target. A *decision* about two observed-empty step types, not a fallthrough — an unrecognised step type still yields `notice / unknown-provider-event`. |
| **Non-JSON lines are tolerated** | `stream3` opens with seven lines of human prose before a well-formed `result`. Each becomes one `notice / non-json-output`; the count is capped and reaching the cap emits one final notice. |
| **`status: "ERROR"` → `E_BACKEND_FAILURE`** | The only captured error is `authentication failed or timed out`. There is no quota fixture and no source to read a quota refusal's wording from, so no quota mapping exists on this route. |

---

## Execution order

```
T01 ─┬─ T02 ─┬─ T04 ★ decision gate — the owner answers Q4 here
     └─ T03 ─┘
                  │  (M2 starts only on a "build" answer)
                  ▼
T05 ─┬─ T06 ─┬─ T08 ─┬─ T09
     └─ T07 ─┴───────┘
                  ▼
T10 ─┬─ T11 ─┬─ T13
     └─ T12 ─┘
                  ▼
T13 ─┬─ T14 ─┐
     ├─ T15 ─┼─ T17
     └─ T16 ─┘
                  ▼
T18 ── T19 ──┬─ T20 ★ the only ticket that writes to the spine
             └──────
```

**Where it forks.** Three times, and each fork is real parallelism rather than a convenience: T02 and T03
touch different files (a sweep and a meta-test); T06 and T07 touch different halves of the decoder (steps
and usage); T14, T15 and T16 touch three different modules (the sandbox badge, path policy, the broker).

**Where it joins.** Each milestone's Testing-Strategy task — T04, T09, T13, T17, T20 — and each carries that
milestone's closing Amendment duty.

**Where it can stop.** T04. If the owner answers Q4 by closing the workstream, T04 records it in the plan's
Amendments, every later ticket stays `state: todo`, and the session says so in their Handoff sections.
