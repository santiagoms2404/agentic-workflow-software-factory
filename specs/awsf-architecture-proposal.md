# AWSF — Agentic Workflow Software Factory
## Fused Architectural Proposal

*Both source models operated under a read/search/list host policy and wrote no files; this response is deliverable content only. The two canonical artifacts and their paths:*

| Artifact | Canonical path |
|---|---|
| This proposal | `D:\Santiago Marin\Project Repositories\Agentic Orchestration\agentic-workflow-software-factory\specs\awsf-architecture-proposal.md` (committed 2026-08-04, after M0) |
| The `/planf3` build prompt (§7.11) | `D:\…\Agentic Orchestration\awsf-planf3-build-prompt.md` |

---

## 7.1 Executive Summary

`my-agentic-workflow` (MAW) and `super-simple-software-factory` (SSSF) are not competitors — **they each solved the problem the other ignored** [ARCHITECT]. MAW owns the *task lifecycle*: states, guarded transitions, a PID-before-spawn barrier that makes hidden processes structurally impossible (`src/run.mjs:80-112`), and a human-only landing edge. SSSF owns the *work inside a single unit of execution*: typed phases, runtime-validated envelopes, postcondition gates with same-session correction loops, and a real-time SQLite trace. MAW has no idea what happens between `RUNNING` and `GATING`. SSSF has no idea what a task *is*.

The fusion is one sentence: **the state machine governs the task; the phase engine governs the sojourn inside the executing states.** A workflow is a sequence of typed phases; gate failures inside a phase are corrected the SSSF way — re-prompt the *same* session with the violations, context intact, cheap (`agents.py:148-173`). Only when a phase's intra-phase budget is exhausted does the failure escalate to a *state transition*, which is expensive, counted against the tier ceiling, and governed by MAW's evidence rules (`state.mjs:118`). That yields **two-tier correction economics** [ARCHITECT]: cheap corrections that preserve the context window, and expensive corrections that the state machine rations — with **call reservations** so concurrent paths and composite adapters cannot overrun a ceiling [BUILDER].

Four further decisions carry the design:

1. **SQLite is a projection, never truth.** The authoritative record is an fsynced append-only `journal.jsonl` plus an atomically replaced `status.json` snapshot. `awsf db rebuild` reconstructs the database from journals. Delete `awsf.db` and you lose nothing — so the dashboard can never become a liability [both].
2. **Spawning is centralized in a host `TransportBroker`, not in adapters** [BUILDER]. Adapters build *pure* launch descriptors [ARCHITECT] and may not import `node:child_process`, enforced by an architecture test. Otherwise a future adapter bypasses PID registration and the barrier becomes advisory.
3. **`LANDING` is a persisted state** [BUILDER]. MAW lands directly from `AWAITING_OWNER`, so a crash mid-fast-forward leaves an ambiguous world. A durable intermediate state makes landing crash-recoverable.
4. **One language, one runtime, two workspaces** — because the highest-severity defect in the current stack is portability, and portability is a process-supervision problem that must be solved once, in one place, and contract-tested per machine.

**Read-only audit findings that argue against extending either codebase in place** [BUILDER, with ARCHITECT concurrence on the argv item]: MAW's permission guard is well-tested but not wired into the actual Claude/Pi tool surface; normal gate failures are not connected to the CLI correction path; prompts ride process arguments rather than stdin (`providers/claude-code.mjs:6`); process supervision depends on Linux `/proc` and **fails silently elsewhere** (`run.mjs:15-24`, `README.md:72-75`); landing has no durable intermediate state; acceptance records can be written into the canonical checkout after landing. SSSF cannot reach Claude Pro at all — `agents.py:61-63` rejects any agent whose `coding_agent != "pi"`; it runs on the active branch with no worktree isolation, no human landing gate, and enforces permissions only after mutation. These are read-only inferences; MAW's "500 tests passing / 1,477 lines" claims were not re-executed.

---

## 7.2 Language & Runtime Recommendation

### Decision: **TypeScript on Node.js ≥ 22.12 LTS. Vue 3 + Vite for the browser. Bun never required.**

**Not Python.** SSSF's own code disqualifies it: it is pi-only (`agents.py:61-63`), defaults to `google/gemini-3.6-flash` (`sssf.config.yaml:5`), and can reach exactly one of Santiago's three subscriptions. Adopting its runtime buys a stack whose entire provider layer must be rewritten anyway.

**Not hybrid.** Two runtimes means the envelope schema defined twice, and it will drift. SSSF already recognized this and put `shared/types.ts` between its Bun server and Vue client. Extend that idea one hop and the second runtime disappears. [ARCHITECT]

**Why TypeScript, concretely:**

1. **It already runs here with no build step.** `fusion-harness/core/adapters.ts:260-263` documents avoiding constructor parameter properties *because Node's strip-only mode rejects them at load*. Production TypeScript executing directly under Node is settled by evidence.
2. **`node:sqlite` removes Python's last advantage** — WAL SQLite in core, behind a thin driver boundary with a startup feature probe, avoiding `better-sqlite3` native builds across three OSes.
3. **Subprocess streaming is the center of the system.** Byte streams, abort signals, and line-framed JSON from long-lived children are Node's home turf. `LineFramer` with a per-instance streaming `TextDecoder` handling chunk boundaries mid-code-point (`adapters.ts:115-137`) is already written, tested, and correct.
4. **Portability is decided here.** `run.mjs:15-24` reads `/proc` and returns `[]` on non-Linux. On the incoming M5 MacBook Pro, today's code reports every cancellation as successful *without having looked*. One `ProcessSupervisor` port, per-platform implementations, one contract suite — tractable in one language, two ports of the same bug in two.

### Dependency policy — **declared and enforced, not zero** [BUILDER, over ARCHITECT]

ARCHITECT proposed a zero-dependency core with a hand-rolled ~200-line validator. I am rejecting that, for one concrete functional reason rather than convenience: **the envelope schema must be machine-emittable as JSON Schema so it can be injected into prompts automatically.** SSSF's worst maintenance defect is the same contract handwritten in three places — Pydantic model, prompt example, gate. A schema library that emits JSON Schema kills that class of drift permanently. A bespoke validator would have to grow that capability anyway.

The runtime allowlist, pinned and asserted by a meta-test:

- **Core:** `@sinclair/typebox` (runtime schema + derived static types + JSON Schema emission), `yaml` (MAW's homemade YAML parser is a liability, not an asset).
- **Dashboard:** `vue`, `vite`, `@vitejs/plugin-vue`, `lucide-vue-next`.
- **Dev:** `typescript`, `vue-tsc`, `oxlint`.
- **No web framework.** `node:http` is sufficient.

**Build posture, splitting the difference:** `core/` runs under Node's native type-stripping with **no build step** [ARCHITECT] — TypeBox is value-based and fully compatible with strip-only mode. `tsc --noEmit` and `vue-tsc` run as CI typecheck gates [BUILDER]. The dashboard builds through Vite. Fast local loop, full type safety at the gate.

**Costs, named:** strip-only mode forbids `enum`, parameter properties, and decorators — use `as const` unions, as the fusion harness already does (`events.ts:6-20`). `node:sqlite` is younger than CPython's `sqlite3` — mitigated by the driver boundary and by `db rebuild` making a corrupt DB disposable. TypeScript types vanish at runtime — which is precisely why envelope validation is an explicit runtime schema, enforced by design.

---

## 7.3 Architectural Specification

### 7.3.1 Governing invariants

1. **Host owns the loop.** No model selects phases, changes risk tier, advances lifecycle state, lands code, or repairs orchestration state.
2. **Journal is durable truth.** `journal.jsonl` is append-only and fsynced; `status.json` is its atomically replaced snapshot.
3. **SQLite is a rebuildable projection.**
4. **No process executes before registration.** The launcher stays blocked until journal, status, and projection acknowledge its identity.
5. **Agents do not commit, merge, push, rebase, reset, or clean.** The host captures diffs, validates permissions, and creates commits [BUILDER].
6. **No shell parsing.** Executable + argv array, `shell: false`, always.
7. **No provider fallback.** A failed declared route blocks the attempt. Review inversion is a routing rule, not a fallback.
8. **Landing is TTY-only.** No landing endpoint exists in the API — its *absence* is asserted by a meta-test.
9. **Thinking text is streamed but never persisted** [BUILDER]. Reasoning token counts are recorded; chain-of-thought content is neither handoff nor evidence.
10. **No automatic deletion, push, tier downgrade, provider substitution, or model restart.**

### 7.3.2 Truth and storage

```
<state-root>/projects/<project>/tasks/<task>/<attempt>/
├── status.json              # atomic snapshot (temp file → rename)
├── journal.jsonl            # append-only canonical event stream, fsynced at phase boundaries
├── raw/<run-id>.jsonl       # private provider stream
├── envelopes/<phase>-<round>.json
├── gates/<gate>-<sha>.log
└── private/continuity.json  # provider session references, mode 0600
```

State roots resolve through one `platform-paths.ts` module: `$XDG_STATE_HOME`, `~/Library/Application Support`, `%LOCALAPPDATA%`. Project runtime data (`.awsf/`) and machine-local lifecycle records are different ownership classes and stay apart, per MAW's boundary rule.

**Write protocol:** acquire attempt lock → validate expected state revision and transition → append canonical event with `source_seq` and fsync → atomically replace `status.json` → project into SQLite in a transaction → release lock.

**Projection-failure policy — resolving a direct conflict.** ARCHITECT said observability may never fail a task; BUILDER said a failed projection should terminate the run rather than execute invisibly. Both concerns are legitimate, so: **a projection failure never kills a running model.** It emits a `sqlite-projection-failed` notice, marks the session `observability_degraded`, and the run continues — the journal already has the event. But **the attempt may not advance past `GATING` while degraded**; the CLI reports it loudly and `awsf db rebuild` must succeed first. Truth is preserved, invisible completion is impossible, and no provider is killed for a dashboard's sake.

If projection fails *before* provider release, the provider simply never executes.

### 7.3.3 Typed phase engine

One primitive [SSSF via both]:

```ts
type PhaseKind = "agent" | "code" | "engineer";

interface PhaseDefinition<TOutput> {
  id: string;
  kind: PhaseKind;
  owner: string;
  description: string;          // earned, not restated
  outputSchema: TSchema;
  maxCorrections: number;
  gates: readonly GateDefinition[];
  execute(ctx: PhaseContext): Promise<TOutput>;
}
```

**Success must be earned:** every phase is constructed `FAILED` and only a clean exit flips it (`data_types.py:63`, `runner.py:104-106`). The **earned-description rule** ports verbatim and fires at *workflow compilation*, not runtime (`data_types.py:31-53`): a description that is blank or a normalized restatement of the phase name is rejected, because that sentence is the only intent the trace, console, and phase block ever show.

**Initial workflow set — six, not twelve** [BUILDER]. Do not clone SSSF's full catalog; add one only after a repeated real use case appears.

| Workflow | Phases | Tier |
|---|---|---|
| `scout` | request → scout | T0 |
| `plan` | request → planner | T0 |
| `build` | request → builder → tests | T1 |
| `plan-build-test` | request → planner → builder → tests | T1 |
| `build-review` | request → builder → tests → reviewer | T2 |
| `simple-sdlc` | planner → builder → tests → documenter → final tests → reviewer | T2 |

### 7.3.4 Risk tiers and call budgets

| Tier | Meaning | Call ceiling | Required controls |
|---|---|---:|---|
| T0 | Read-only analysis or planning | 1 | No mutation |
| T1 | Localized, reversible mutation | 3 | Worktree, host commit, gates, human landing |
| T2 | Security, process control, persistent data, cross-component, ambiguous or weakly-tested work | 5 | T1 plus opposite-provider review and end-user journey |

`protected` is orthogonal: credential access, external mutation, deletion, migration, release/cutover, credit-billed execution.

**Reservations** [BUILDER]: reserve before launch so concurrent paths cannot exceed the ceiling; convert to spent when the launcher receives `GO`; release if registration fails and the provider never ran. **Spend carries across attempts of the same task.** Composite Fusion declares its full cost in advance — two workers plus a fuser consume three calls. A workflow whose minimum call count cannot fit the selected tier is rejected before execution.

**Intra-phase corrections do not consume tier calls.** They re-enter an existing session; they cost tokens, not a call. This is the fusion's central economic claim and it must be visible: the dashboard shows both `calls 3/5` and per-phase `round 2/2`.

### 7.3.5 Single YAML configuration

`awsf.config.yaml` is the only committed tuning surface. Machine paths come from OS defaults or environment, never committed absolutes.

```yaml
schema: awsf/v1

project:
  slug: agentic-workflow-software-factory
  default_workflow: plan-build-test

runtime:
  silence_timeout_seconds: 2700
  process_grace_seconds: 2
  max_output_bytes: 67108864
  max_event_count: 100000

adapters:
  claude:      { kind: claude-code, executable: claude }
  codex:       { kind: pi-codex, executable: pi, provider: openai-codex }
  antigravity: { kind: antigravity, executable: agy, enabled: false }
  stub:        { kind: fixture }
  fusion:      { kind: composite-fusion }

routing:
  default_worker: claude
  review: invert-provider
  no_fallback: true

agents:
  - name: planner
    model: claude:opus
    thinking: high
    color: "#A78BFA"
    purpose: Produce an implementable plan with explicit acceptance criteria.
    prompt: { system: prompts/planner/system.md, user: prompts/planner/user.md }
    harness: { adapter: claude, continuity: same-session }
    tools: { profile: readonly, allow: [read, grep, find, ls] }
    writes: []

  - name: builder
    model: codex:gpt-5.6-sol
    thinking: high
    color: "#22D3EE"
    purpose: Implement the validated plan in the assigned worktree.
    prompt: { system: prompts/builder/system.md, user: prompts/builder/user.md }
    harness: { adapter: codex, continuity: same-session }
    tools: { profile: managed-worker, allow: [read, grep, find, ls, edit, write, exec] }
    writes: ["src/**", "test/**", "dashboard/**", "docs/**"]

  - name: reviewer
    model: claude:opus          # inverted automatically when the builder runs on claude
    thinking: high
    color: "#F43F5E"
    purpose: Find concrete defects the deterministic gates do not cover.
    prompt: { system: prompts/reviewer/system.md, user: prompts/reviewer/user.md }
    harness: { adapter: claude, continuity: none }
    tools: { profile: no-tools, allow: [] }
    writes: []                  # a reviewer that cannot fix cannot quietly fix

workflows:
  enabled: [scout, plan, build, plan-build-test, build-review, simple-sdlc]

gates:
  test:      { argv: [node, --test], timeout_seconds: 600 }
  typecheck: { argv: [npm, run, typecheck], timeout_seconds: 300 }

risk:
  default: T1
  call_ceiling: { T0: 1, T1: 3, T2: 5 }
  correction_allowance: { auto: 1, owner: 1 }
  paths:
    "src/execution/**": T2
    "src/policy/**": T2
    "src/state/**": T2
    "dashboard/**": T1

policy:
  protected_paths:
    - awsf.config.yaml
    - src/state/**
    - src/policy/**
    - src/observability/migrations/**
  protected_operations: [credential-access, external-mutation, delete, migration, release-cutover, credit-billed-model]

observability:
  poll_ms: 500
  db: state://awsf.db
  persist_thinking_text: false

pricing:
  display_mode: estimated-api-equivalent
  effective_date: null
  models: {}            # empty by default ⇒ subscription routes render "— subscription"
```

Two rules carried over because they were learned the hard way [ARCHITECT, from `permissions.py:3-11` and `sssf.config.yaml:9-11`]: **`tools` is a capability list, not a sandbox** — `exec` runs anything and `write` reaches any path, so `writes` is the enforced statement; and **`--tools` filters extension tools too**, so an agent whose harness extension registers a tool must name that tool or the extension loads and its tool is silently filtered out. `writes: []` restricts the repository, never the session runtime — every agent can always write its own report under the attempt directory.

**The output schema is generated from TypeBox and injected into each prompt automatically** [BUILDER]. AWSF must never maintain a handwritten envelope example alongside the schema and the gate.

### 7.3.6 Permissions, worktrees, and Git

A write-capable agent requires all seven layers: managed worktree, clean start, adapter tool allowlist, OS sandbox grant where available, post-run Git change-set comparison, exact write-glob enforcement, canonical repository outside the sandbox root, host-only Git mutation.

**Permission breaches are not gate violations** [ARCHITECT, adopting SSSF's reasoning at `permissions.py:23-25`]: a gate violation is work an agent can be asked to redo; a breach cannot be corrected by re-prompting because *the write already happened*. It aborts the phase and names every offending path. The mechanism — fingerprint the tree's change-set before, diff after (`permissions.py:50-75`) — catches what a write-watcher misses: an agent that runs `git checkout` to revert a file it was being judged by. That actually happened to IndyDevDan.

Git ownership: the host captures the exact phase diff, compares actual changed paths to the envelope **including deletions**, creates the commit with deterministic author identity, and runs gates against exact committed SHAs with clean-before/clean-after checks. Any later mutation invalidates prior gates and review. Landing is local fast-forward only; there is no push implementation.

**Platform policy — staged, honest** [BUILDER, over ARCHITECT's more optimistic native-Windows plan]:

| Platform | Supervision | Sandbox | v1 write-capable? |
|---|---|---|---|
| Linux | `detached` process group; `kill(-pgid)`; survivors from `/proc` | Bubblewrap / Landlock broker | yes |
| macOS | same signals; survivors via `ps -o pid=,pgid=,stat=` | reviewed Seatbelt/`sandbox-exec` broker | yes |
| Windows | Job Object launcher + `TerminateJobObject`; survivors via `Get-CimInstance Win32_Process` | none native | **no — route through WSL2** |

Native Windows hosts the dashboard and read-only workflows in v1. Native mutation stays blocked until a `CREATE_SUSPENDED` launcher and a filesystem sandbox broker exist. **A supervisor that cannot enumerate survivors must return an error, never `[]`** [ARCHITECT] — that rule is the direct fix for the README's quiet-failure warning, and it is a contract test on every platform. The UI must distinguish `os-enforced`, `tool-policy`, and `unavailable`; it must not call all three "sandboxed."

### 7.3.7 Observability pipeline

```
provider bytes → LineFramer → adapter parser → EventSequencer
  → canonical journal → atomic status → SQLite projector
  → localhost REST → Vue cursor polling
```

**Tool-call folding** [BUILDER]: `tool.requested` creates one projected `tool_call` row in `running`; updates do not create rows; `tool.completed` updates it with result snippet, duration, and outcome. The canonical journal still retains request and completion separately.

**Token accounting** [both, merged]: input, output, cache-read, cache-write, reasoning. **`null` means the provider did not report it; `0` is authoritative data** (`events.ts:24`). Record `reasoningRelation: included-in-output | additive | unknown` rather than assuming SSSF's nesting rule universally — SSSF's own convention (reasoning is a share of output, never added; `data_types.py:398-403`) becomes the `included-in-output` case, not a global truth.

**Context occupancy is not a sum** [ARCHITECT]: it is the occupancy after the *last* turn, while spend accumulates across all turns (`agents.py:107-110`). The context meter and the cost chip read different numbers from the same phase.

**Cost authority — resolving a divergence.** ARCHITECT would render `— subscription` and never a number; BUILDER would render a catalog-derived `≈ $0.64` labelled *estimated API-equivalent*. BUILDER's three-valued model is the better data structure, ARCHITECT's is the safer default, so: `costAuthority: provider | catalog-estimate | unavailable`, with `pricing.models` **empty by default**. Out of the box a Claude-routed phase renders `— subscription`, never `$0.00`, and a mixed session total is labelled *partial*. If Santiago populates the pricing table, the same phases render `≈ $0.21 (est.)` with the authority visible. Never a bare number without its authority.

---

## 7.4 Folder Structure

Two npm workspaces, so the dependency allowlist is mechanically checkable.

```
agentic-workflow-software-factory/
├── awsf.config.yaml
├── package.json                    # workspaces: ["core", "dashboard"]
├── tsconfig.json
├── justfile                        # just plan | build | sdlc | dash | doctor | rebuild
├── AGENTS.md                       # invariants an agent working on AWSF must not break
│
├── core/
│   ├── src/
│   │   ├── cli/{main.ts, tty.ts, commands/}
│   │   ├── config/{schema.ts, load.ts, effective-config.ts}
│   │   ├── state/                  # PURE. May not import execution, adapters, git, sqlite.
│   │   │   ├── task-machine.ts     # 10 states, 24 edges, 76 rejections, ordered errors
│   │   │   ├── phase-machine.ts
│   │   │   ├── guards.ts  tiers.ts  errors.ts
│   │   ├── contracts/              # TypeBox: runtime schema + static type + JSON Schema
│   │   │   ├── envelope-base.ts  plan-output.ts  build-output.ts
│   │   │   ├── test-output.ts  review-output.ts  document-output.ts
│   │   │   └── normalized-events.ts
│   │   ├── workflow/
│   │   │   ├── compiler.ts  engine.ts  phase.ts  corrections.ts
│   │   │   └── recipes/{scout,plan,build,plan-build-test,build-review,simple-sdlc}.ts
│   │   ├── execution/
│   │   │   ├── transport-broker.ts    # THE ONLY module importing node:child_process
│   │   │   ├── launcher-barrier.ts    # PID-before-exec handshake, platform-neutral
│   │   │   ├── launcher.ts            # the gated child
│   │   │   ├── process-controller.ts  # TERM → grace → KILL → enumerate survivors
│   │   │   ├── platform/{posix,darwin,win32}.ts
│   │   │   ├── call-budget.ts         # reservations
│   │   │   └── continuity-store.ts    # mode 0600
│   │   ├── adapters/
│   │   │   ├── interface.ts  registry.ts  catalog.ts
│   │   │   ├── claude-code.ts  pi-codex.ts  antigravity.ts  stub.ts  fusion.ts
│   │   │   └── stream/{line-framer,event-sequencer,output-budget}.ts
│   │   ├── persistence/{journal,status-store,attempt-lock,replay,platform-paths}.ts
│   │   ├── observability/
│   │   │   ├── sqlite.ts  projector.ts  rebuild.ts  queries.ts
│   │   │   └── migrations/0001-initial.sql
│   │   ├── gates/{interface,envelope,artifacts,git-diff,commands,review,journey}.ts
│   │   ├── git/{worktrees,changes,commit,land}.ts
│   │   ├── policy/{permission-profiles,path-policy,sandbox-broker,risk,redaction}.ts
│   │   └── api/{server,routes,responses,security}.ts
│   └── test/{unit, contract, simulation, journeys, platform, fixtures/{providers,permissions}}
│
├── prompts/{scout,planner,builder,reviewer,documenter}/{system.md,user.md}
│
├── dashboard/
│   ├── shared/types.ts             # imported by BOTH api layer and client — SSSF's pattern
│   ├── src/{components,composables,routes,stores,styles}/
│   └── vite.config.ts
│
├── specs/{awsf-plan.html, awsf-plan-build-prompts.md, awsf-plan-acceptance.md}
└── records/pilots/                 # concise accepted pilot summaries, not routine receipts
```

Rationale for departures from the suggested tree: **there is no `orchestrator/` directory** [ARCHITECT] — there is a CLI that calls a workflow that opens phases; naming a directory `orchestrator` is how one grows back. `state/` is pure and import-fenced. Only `transport-broker.ts` spawns. Only projector and query layer touch SQLite. `dashboard/shared/types.ts` sits at the workspace root because both sides import it, exactly as SSSF does. Runtime files never live in the repository.

---

## 7.5 State Machine Definition

**Ten states, twenty-four legal edges, seventy-six rejected ordered pairs.**

This merges ARCHITECT's `GATING`/`REVIEWING` (which encode "gates run outside model control" and "review is a distinct spawn site with an inverted provider" *structurally*, rather than as workflow convention) with BUILDER's `LANDING` (which makes the fast-forward crash-recoverable). I collapsed BUILDER's `PREPARING`/`READY` split into a single `PREPARED`: the distinction is transient and adds an edge class without adding a guard.

**Rejected: `PLANNING`, `BUILDING`, `DOCUMENTING` as states** [ARCHITECT]. Those are phases. Promoting them would make the transition matrix workflow-dependent and destroy the property that makes it testable. The state machine answers *"what may happen to this task next?"*; the phase engine answers *"what is happening right now?"*

```
DRAFT → PREPARED → RUNNING → GATING → REVIEWING → AWAITING_OWNER → LANDING → LANDED
                      ▲        │  │                     │  │
                      └────────┘  └─────────────────────┘  │   (tier<2 skips review)
                      corrections & owner-authorized rework
   any active state → CANCELLED (human, explicit)
   any active state → BLOCKED (host, explicit reason code, NEVER by clock)
```

| State | Meaning | Provider may run |
|---|---|---|
| `DRAFT` | Intent, tier, and route recorded. No worktree. | no |
| `PREPARED` | Worktree materialized, base SHA pinned, roster resolved, adapter/sandbox/observability preflight passed. | no |
| `RUNNING` | Phase engine active; a worker is registered and executing. | yes |
| `GATING` | Host runs postcondition gates on the committed candidate SHA, outside model control. | no |
| `REVIEWING` | T2 only. Cross-provider reviewer, diff-scoped, advisory. | yes |
| `AWAITING_OWNER` | Everything machine-checkable has passed. Waiting on a human. No timeout. | no |
| `LANDING` | Human approved the exact candidate; local fast-forward in progress. | no |
| `LANDED` | Canonical `HEAD` equals the candidate. Terminal. | no |
| `BLOCKED` | Halted with a reason code. Terminal for this attempt; `awsf retry` mints attempt *n+1* at `DRAFT`. | no |
| `CANCELLED` | Human stopped it. Tree terminated, survivors reported. Terminal. | no |

### The twenty-four legal transitions

| # | From → To | Actor | Guard | Spawn |
|---|---|---|---|---|
| L1 | DRAFT → PREPARED | host | worktree created, base SHA pinned, config validates, preflight passes | — |
| L2 | DRAFT → BLOCKED | host | `reason.code ∈ BLOCKER_CODES` | — |
| L3 | DRAFT → CANCELLED | human | explicit, interactive | — |
| L4 | PREPARED → RUNNING | host | workflow compiled; tier ceiling has headroom; call reserved | ✔ |
| L5 | PREPARED → BLOCKED | host | blocker code | — |
| L6 | PREPARED → CANCELLED | human | explicit | — |
| L7 | RUNNING → GATING | host | all required phases terminal-success; host commit created; 40-hex candidate SHA ≠ base | — |
| L8 | RUNNING → BLOCKED | host | crash / silence / quota / phase abort / permission breach / budget exhaustion | — |
| L9 | RUNNING → CANCELLED | human | tree terminated, no survivors | — |
| L10 | GATING → RUNNING | host **or** owner | gate failed, correction budget remains; `reason.command` and `reason.output` both present; tranche unspent | ✔ |
| L11 | GATING → REVIEWING | host | gates pass **and** tier ≥ 2 | ✔ |
| L12 | GATING → AWAITING_OWNER | host | gates pass **and** tier < 2 | — |
| L13 | GATING → BLOCKED | host | gates failed, budget spent | — |
| L14 | GATING → CANCELLED | human | explicit | — |
| L15 | REVIEWING → AWAITING_OWNER | host | verdict recorded and internally consistent | — |
| L16 | REVIEWING → RUNNING | **owner** | ≥1 finding of severity ≥ medium with both `file` and `detail`; owner tranche unspent; stale gates invalidated | ✔ |
| L17 | REVIEWING → BLOCKED | host | mandatory review unavailable after one transport retry | — |
| L18 | REVIEWING → CANCELLED | human | explicit | — |
| L19 | AWAITING_OWNER → RUNNING | **human** | concrete named defect or rework request; budget remains; gates and review invalidated | ✔ |
| L20 | **AWAITING_OWNER → LANDING** | **human** | interactive TTY; exact SHA and summary displayed and confirmed; gates pass; required review present; journey and protected approvals valid; FF preflight passes | — |
| L21 | AWAITING_OWNER → BLOCKED | host | `reason.source === 'record'`, code ∈ {record-corrupt, unknown-state, ambiguous-pid, unreadable-worktree} | — |
| L22 | AWAITING_OWNER → CANCELLED | human | explicit rejection | — |
| L23 | LANDING → LANDED | host | canonical `HEAD` equals candidate; checkout clean | — |
| L24 | LANDING → BLOCKED | host | non-FF, dirty canonical tree, Git failure, ambiguous crash recovery | — |

**Four spawn sites, and only four:** L4, L10, L11, L16 — plus L19, which enters `RUNNING` and therefore permits a spawn under the same reservation rules. Any other from/to pair attempting a spawn raises `IllegalSpawnSite`. (ARCHITECT listed three sites but also allowed L16 to re-enter `RUNNING`, which is a hole; defining "spawn is permitted only on transitions into `RUNNING` or `REVIEWING`" closes it.)

**L21 is deliberately narrow.** `AWAITING_OWNER` has no timeout, so **no clock may produce this edge** — only a corrupt record or an unreadable worktree (`state.mjs:55-60`). A task waiting on you waits forever. That is the point. [ARCHITECT]

**L16 requires a concrete defect.** A style note is not a defect: if it authorized re-work, "the reviewer had opinions" would be indistinguishable from "the code is wrong" (`state.mjs:89-95`). This is why `ReviewOutput` carries `severity` — SSSF's review envelope has no such field, which is why SSSF cannot express the rule.

**Pair matrix.** 10 × 10 = 100 ordered pairs; 24 legal; **76 illegal**, each an explicit test asserting both that it throws and *which* error it throws. Notable classes: every skip-ahead (`DRAFT → RUNNING`, `PREPARED → GATING`, `GATING → LANDED`); every edge out of a terminal state; all ten self-transitions; `RUNNING → REVIEWING` (review reads a committed diff, so gating is mandatory first); and any `→ LANDED` from a state other than `LANDING`, which is specially reported as **`HumanGateBypass`** [BUILDER] so the error names the actual violation rather than the generic one.

### Rejection ordering — a contract, not an implementation detail

A rejection must name the **real** defect, or fixing what it named would let an illegitimate transition through (`state.mjs:8-24`). Evaluated strictly in order:

1. `NonDeterministicEvidence` — `reason.source` not on the closed allowlist
2. `TerminalAttempt` — from-state is `BLOCKED` / `LANDED` / `CANCELLED`
3. `AlreadyInState` — self-transition
4. `HumanGateBypass` — target is `LANDED` from anything but `LANDING`
5. `IllegalTransition` — the pair is not one of the 24
6. `CorrectionAllowanceExhausted` (global) — the whole budget is gone; no actor can restore it
7. `ActorNotPermitted` — pair is legal, this actor may not make it
8. `InteractiveOwnerRequired` — human edge attempted without a TTY
9. `CorrectionAllowanceExhausted` (tranche) — this actor's own tranche is spent
10. `InsufficientEvidence` — pair, actor, budget fine; evidence is not
11. `CallCeilingExceeded` — a spawn-site edge at the per-tier or lifetime ceiling

### Phase submachine

```
QUEUED → RUNNING → VALIDATING → SUCCEEDED
            │           ├─→ CORRECTING → RUNNING
            │           └─→ FAILED
            └─────────────→ FAILED
QUEUED → SKIPPED
QUEUED|RUNNING|VALIDATING|CORRECTING --human cancel--> CANCELLED
```

`CORRECTING → RUNNING` must resume the **same** adapter, provider, model, and provider session — no cold restart disguised as a correction [BUILDER]. Invalid JSON and correctable gate violations share one allowance. Permission breaches, host failures, and transport errors are **not** correctable and block immediately. A review concern reaches the human; it does not automatically invoke the builder.

---

## 7.6 Envelope & Gate Specifications

### Common envelope

```ts
interface ArtifactClaim {
  path: string;                 // worktree-relative, normalized, no traversal
  kind: "source" | "test" | "plan" | "documentation" | "report";
  description: string;
}

interface EnvelopeBase {
  schema: string;               // e.g. "awsf.build-output/v1"
  producerStatus: "success" | "failure";
  summary: string;
  artifacts: ArtifactClaim[];
  notesForNextPhase: string;
}
```

**Wire envelope vs stored envelope** [ARCHITECT] — SSSF conflates these. The wire envelope is only what the model emits; a model should never be asked to echo a `phase_id` it could get wrong. The host wraps it:

```ts
interface StoredEnvelope<T extends EnvelopeBase> {
  envelopeId: string; sessionId: string; phaseId: string;
  correctionRound: number; agent: string; schemaId: string;
  valid: boolean; createdAt: string;
  payload: T | null;
  violations: ValidationViolation[];
  rawOutputPath: string;
}
```

### Phase envelopes

```ts
interface PlanOutput extends EnvelopeBase {
  schema: "awsf.plan-output/v1";
  goals: string[]; nonGoals: string[];
  implementationSteps: Array<{ id: string; title: string; files: string[]; acceptanceCriteria: string[] }>;
  testStrategy: string[];
  risks: Array<{ risk: string; mitigation: string }>;
  openQuestions: string[];              // a successful plan may leave none that are blocking
}

interface BuildOutput extends EnvelopeBase {
  schema: "awsf.build-output/v1";
  changedFiles: string[];               // candidate SHA deliberately ABSENT — the host computes it
  implementationNotes: string[];
  commandsRun: Array<{ argv: string[]; exitCode: number | null }>;
  proposedCommitMessage: string;
}

interface TestOutput extends EnvelopeBase {        // HOST-generated, not model-generated
  schema: "awsf.test-output/v1";
  passed: boolean; candidateSha: string;
  commands: Array<{ gateId: string; argv: string[]; exitCode: number; durationMs: number; outputRef: string }>;
  failures: string[];
  outputTail: string;                   // verbatim, unparsed, ≤ 4000 chars
}

interface ReviewFinding {
  id: string;
  severity: "low" | "medium" | "high" | "critical";
  file: string; line: number | null;
  title: string; detail: string; evidence: string;
}

interface ReviewOutput extends EnvelopeBase {
  schema: "awsf.review-output/v1";
  verdict: "accept" | "concern";
  reviewedSha: string;
  findings: ReviewFinding[];
  limitations: string[];
}

interface DocumentOutput extends EnvelopeBase {
  schema: "awsf.document-output/v1";
  changedFiles: string[];
  documentedAreas: Array<{ subject: string; documentPath: string }>;
  proposedCommitMessage: string;
}

interface ScoutOutput extends EnvelopeBase {
  schema: "awsf.scout-output/v1";
  findings: Array<{ file: string; note: string }>;
}
```

`TestOutput.outputTail` carries the failure **verbatim and unparsed** [ARCHITECT, from `data_types.py:158-163`] — the builder cannot open a log file it was never handed, and every test runner formats failures differently, so a generic parser would be confidently wrong. `concern` requires at least one concrete finding; `accept` cannot carry a high or critical finding.

### Validation

Final assistant content must be exactly one JSON object; prose and code fences are rejected (the parser strips fences and takes the outermost `{…}` before rejecting). Maximum envelope size 256 KiB. Unknown fields are rejected. Paths are normalized and containment-checked against the worktree. Invalid envelopes are **retained** with their violations so the trace shows what the model actually said. Valid envelopes are written immutably to disk, appended to the journal, then projected. **Downstream phases receive validated payloads by host rendering into `{{previous_envelope}}`, not via conversational memory.**

### Gates

`gate(envelope, ctx) => GateReport`, where `report.check(item, ok, note)` appends and returns `this` (`data_types.py:264-283`). **Every check is recorded whether or not it passed**, so a green gate says *what it verified*, not merely that it passed.

| Gate | Applies to | What it checks |
|---|---|---|
| `envelope_valid` | every agent phase | schema parses; `producerStatus === "success"` |
| `artifacts_exist` | every agent phase | each declared artifact exists; note carries size |
| `files_non_empty` | plan, document | declared artifacts are non-zero |
| `json_parses` | any phase declaring `.json` artifacts | it parses; note carries the top-level type |
| `diff_matches_claims` ★ | build, fix, document | **exact set equality** between the host-captured diff (including deletions) and `changedFiles` — closing SSSF's one-directional hole at `gates.py:61-68`, which never notices files the agent changed and did not report |
| `head_advanced` | build | a host commit exists and differs from base — the "said done, wrote nothing" gate |
| `no_protected_paths` ★ | every agent phase | no `policy.protected_paths` entry in the change-set |
| `writes_within_globs` | every write-capable phase | every changed path matches the agent's `writes` |
| `verdict_consistent` | review | `accept` ⇒ no high/critical findings; `concern` ⇒ at least one concrete finding; reviewed SHA equals candidate |
| `commands_pass(gateId)` | code phases | configured argv, clean before/after, exit 0, bounded tail on failure |
| `journey_passes` | T2 / protected | the recorded end-user journey ran against the exact candidate SHA |

★ = strengthened or new in AWSF.

**Gates by phase:** Plan — envelope, non-empty goals/steps/acceptance, no blocking questions. Build — envelope, exact diff match, writes allowed, protected machinery unchanged, head advanced. Test — configured argv, exact candidate SHA, clean before/after, all required exit codes zero. Review — opposite provider, exact reviewed SHA, verdict consistent, finding paths inside candidate context. Document — docs allowlist, non-empty files, exact diff match, final tests re-run afterward. Final task — required phases complete, budget valid, exact SHA gated, required review present, journey passing for T2/protected, FF possible.

### Correction loop

```
send(prompt)
  → parse (≤ 2 JSON fix attempts, SAME session)
  → for round in 0..maxCorrections:
        run gates; record GateReport rows and gate events
        if clean: break
        if round === maxCorrections: throw GateFailure → phase FAILED → L8/L13
        send CorrectionRequest into the SAME session:
            phase + round · previous envelope ref · exact schema violations
            · gate checks with bounded output tails · remaining call budget
  → permissions.enforce(treeBefore)   ← breach ABORTS, never corrects
  → host captures diff, creates commit, persists envelope + agent_session row
```

Defaults: one automatic correction per phase, plus at most one human-authorized correction if the task ceiling has room. Both are intra-phase and **do not consume tier calls**. Transport failure does not cold-restart a correction session.

**Usage accounting across corrections** [ARCHITECT, `agents.py:107-110`]: every send costs, so spend *accumulates* across all rounds; but context occupancy is the *last* send's, because retries re-enter the same window. The `phase_end` event carries phase totals, never the last send's.

---

## 7.7 Adapter Interface Contract

**Adapters describe and parse; the broker spawns.** [BUILDER — this is the single most important structural correction to ARCHITECT's version, which put `spawn()` on the adapter and would let a future adapter bypass PID registration.] ARCHITECT's insight that launch descriptors must be **pure data** is preserved: the descriptor is built and unit-tested without spawning anything.

```ts
interface ModelInfo {
  adapter: string; provider: string; requestedModel: string;
  contextWindow: number | null;
  supportsThinking: boolean; supportsTools: boolean; supportsImages: boolean;
  continuity: "same-session-correction" | "none";
  usageAuthority: "provider" | "partial" | "none";
  costAuthority: "provider" | "catalog-estimate" | "unavailable";
}

interface ProcessSpec {                          // PURE DATA. Spawns nothing.
  executable: string;                            // NAME; the broker resolves it
  argv: readonly string[];                       // never a command line
  cwd: string;
  env: Readonly<Record<string, string>>;         // allowlist + injection
  stdin: string;                                 // the prompt NEVER rides argv
  shell: false;                                  // structural, not a default
}

interface HarnessAdapter {
  readonly id: string;
  isAvailable(signal?: AbortSignal): Promise<Availability>;
  getModelInfo(model: string): Promise<ModelInfo>;
  buildSpec(request: ModelRequest): ProcessSpec;             // pure — descriptor tests assert exact argv
  parse(transport: ProcessTransport): AsyncIterable<NormalizedEvent>;
  execute(request: ModelRequest, broker: TransportBroker, signal: AbortSignal): AsyncIterable<NormalizedEvent>;
}

interface TransportBroker {
  startProcess(registration: ProcessRegistration, spec: ProcessSpec, signal: AbortSignal): Promise<ProcessTransport>;
  startHttp?(registration: DispatchRegistration, spec: HttpRequestSpec, signal: AbortSignal): Promise<HttpTransport>;
}
```

**Architecture tests enforce:** no module under `adapters/` imports `node:child_process` or calls global `fetch`; only `transport-broker.ts` spawns.

**Environment is an allowlist, not a filter** [ARCHITECT, `launch.ts:33-62`]. `PATH`, `HOME`, `TMPDIR` pass; `LANG`/`LC_ALL`/`TZ`/`NO_COLOR`/`TERM` are injected *after* filtering so ambient values cannot override them; an allowlisted key holding credential-shaped bytes is a hard error, not a pass-through. System prompts go to a mode-0600 temp file, never argv.

### Adapters and their real flags

| Adapter | Command | Notes |
|---|---|---|
| `claude-code` | `claude --print --output-format stream-json --include-partial-messages --verbose --model <m> --no-session-persistence --effort <lvl> --append-system-prompt-file <f>` | Read-only profiles pass an **explicit deny list** (`--disallowed-tools Bash,Write,Edit,NotebookEdit`) rather than trusting the default — a default that widens in a future release silently widens your ceiling (`launch.ts:66-76`) |
| `pi-codex` | `pi --mode json -p --provider openai-codex --model <m> --no-session --thinking <lvl> --no-extensions --no-skills --no-prompt-templates --no-themes --no-context-files --tools <list>` | `--no-extensions` is load-bearing: it stops a child recursively loading the harness (`launch.ts:139-141`) |
| `antigravity` | `agy` | **Ships disabled behind a documented probe.** Until a JSON stream mode is confirmed, `isAvailable()` returns `blocked` with `E_ADAPTER_UNVERIFIED`. Do not design around a CLI whose contract nobody has read. The interface has a slot; the slot is empty and honest. |
| `stub` | none | Fixture transcripts. Every phase, gate, workflow, and journey test runs on this at zero quota cost. |
| `fusion` | composite | Fans one prompt to two backends and merges; **every constituent call is separately reserved and registered.** Nearly free — the harness already exists. |

### Normalized event vocabulary

Adopted from `fusion-harness/core/events.ts:6-19` because it is already implemented, sequenced, and tested:

```
run.started · model.resolved · text.delta · thinking.delta · tool.requested
tool.completed · usage · quota · notice · run.completed · run.failed · run.cancelled
```

Invariants: **sequence is authoritative, provider timestamps advisory** (`events.ts:46-48`); exactly one terminal event per run; `tool.completed` is an *explicit* settlement — a terminal never closes tool calls implicitly, and cancellation settles every open tool *first* (`adapters.ts:504-513, 789-798`); provider tool IDs never reach a normalized event, the harness mints `t1, t2, …`; `TokenUsage` null ≠ zero; a model the harness cannot represent does **not** silently resolve — it fails closed via `E_MODEL_UNRESOLVED` (`adapters.ts:396-413`). `model.resolved` carries `provenance: "stream-authoritative" | "route-attributed"` [BUILDER] so the UI never presents an inferred model identity as a confirmed one.

Notice codes: `unknown-provider-event`, `non-json-output`, `clock-skew`, `malformed-usage`, `output-truncated`, `sqlite-projection-failed`.

### The launcher barrier

```
host                                             launcher child            provider
 │ broker.startProcess(registration, spec) ────▶  │
 │                                                │ report {pid, pgid} on the control channel
 │ ◀──────────── {pid, pgid} ────────────────────│ block awaiting GO
 │ journal.append(process-registered) + fsync     │
 │ status.replace()                               │
 │ projector.apply()                              │
 │   ├─ any failure ⇒ terminateTree(pgid)         │  (never released; provider NEVER ran;
 │   │                 release call reservation   │   reservation returned to the budget)
 │   └─ ok ⇒                                      │
 │ send "GO"  ───────────────────────────────────▶│ exec(provider) ────────────▶ │
 │ reservation → spent
```

On POSIX the control channel is the fd3/fd4 pair and release is followed by `execve`, preserving PID stability (`providers/launcher.mjs:9-17`). On Windows it is a named pipe pair and *"create the provider suspended inside a Job Object, resume on release."* **The observable contract is identical and is what the test asserts: kill the host between registration and release, and no provider process exists.**

Liveness while running (`run.mjs:139-146`): a monitor watches process-group CPU, a record-update-failed flag, a hard timeout, and the silence window. Any trip starts tree termination — TERM to the group, grace, KILL — and then **reports reality**: survivors are enumerated and reported, never assumed dead. A platform port that cannot enumerate must return an error.

**Errors:** `E_INVALID_REQUEST`, `E_BACKEND_FAILURE`, `E_TERMINAL_MISSING`, `E_MODEL_UNRESOLVED`, `E_MODEL_MISMATCH`, `E_TIMEOUT`, `E_CANCELLED`, `E_QUOTA_EXHAUSTED`, `E_POLICY_CEILING_UNENFORCEABLE`, `E_ADAPTER_UNVERIFIED`, `E_REDACTION`. One retry on 5xx-class *transport* failure, then `ProviderUnavailable` (`providers/index.mjs:8-18`). **Quota is never a retry** — it blocks with the reset time. And **routing may never read quota**: you choose the provider; the runner never chooses it for you because one subscription was running low.

---

## 7.8 SQLite Schema

BUILDER's DDL is markedly better engineered — `STRICT` tables, `CHECK` constraints, `json_valid()`, partial indexes — and is adopted as the base. Merged in from ARCHITECT: a **`transitions` table**, which BUILDER omits and which is the state machine's audit trail (SSSF has no equivalent because it has no state machine), and **`checks_json`** on gate results, recording what a gate verified whether or not it passed.

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA wal_autocheckpoint = 1000;

CREATE TABLE sessions (
  session_id             TEXT PRIMARY KEY,
  project_slug           TEXT NOT NULL,
  task_id                TEXT NOT NULL,
  attempt                INTEGER NOT NULL CHECK (attempt >= 1),
  workflow_id            TEXT NOT NULL,
  risk_tier              INTEGER NOT NULL CHECK (risk_tier IN (0,1,2)),
  is_protected           INTEGER NOT NULL CHECK (is_protected IN (0,1)),
  lifecycle_state        TEXT NOT NULL CHECK (lifecycle_state IN (
                           'DRAFT','PREPARED','RUNNING','GATING','REVIEWING',
                           'AWAITING_OWNER','LANDING','LANDED','BLOCKED','CANCELLED')),
  request_text           TEXT NOT NULL,
  base_sha               TEXT, head_sha TEXT, candidate_sha TEXT,
  worker_provider        TEXT, worker_model_requested TEXT, worker_model_resolved TEXT,
  review_provider        TEXT, review_verdict TEXT,
  call_ceiling           INTEGER NOT NULL,
  calls_reserved         INTEGER NOT NULL DEFAULT 0 CHECK (calls_reserved >= 0),
  calls_spent            INTEGER NOT NULL DEFAULT 0 CHECK (calls_spent >= 0),
  corrections_auto       INTEGER NOT NULL DEFAULT 0,
  corrections_owner      INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER, output_tokens INTEGER,
  cache_read_tokens INTEGER, cache_write_tokens INTEGER,
  reasoning_tokens INTEGER, total_tokens INTEGER,
  reasoning_relation     TEXT NOT NULL DEFAULT 'unknown'
                         CHECK (reasoning_relation IN ('included-in-output','additive','unknown')),
  usage_authority        TEXT NOT NULL DEFAULT 'none'
                         CHECK (usage_authority IN ('provider','partial','none')),
  estimated_cost_usd     REAL,
  cost_authority         TEXT NOT NULL DEFAULT 'unavailable'
                         CHECK (cost_authority IN ('provider','catalog-estimate','unavailable')),
  cost_partial           INTEGER NOT NULL DEFAULT 0 CHECK (cost_partial IN (0,1)),
  observability_degraded INTEGER NOT NULL DEFAULT 0 CHECK (observability_degraded IN (0,1)),
  archived               INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  started_at TEXT NOT NULL, updated_at TEXT NOT NULL, ended_at TEXT,
  state_revision         INTEGER NOT NULL DEFAULT 0 CHECK (state_revision >= 0),
  last_projected_seq     INTEGER NOT NULL DEFAULT 0 CHECK (last_projected_seq >= 0),
  config_snapshot_json   TEXT NOT NULL CHECK (json_valid(config_snapshot_json)),
  journal_path           TEXT NOT NULL,
  UNIQUE (project_slug, task_id, attempt)
) STRICT;

-- The state machine's audit trail. SSSF has no equivalent.
CREATE TABLE transitions (
  transition_id  TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE RESTRICT,
  seq            INTEGER NOT NULL CHECK (seq >= 1),
  from_state     TEXT NOT NULL, to_state TEXT NOT NULL,
  actor          TEXT NOT NULL CHECK (actor IN ('host','owner','human')),
  edge_id        TEXT NOT NULL,                       -- 'L20'
  reason_source  TEXT NOT NULL, reason_code TEXT, reason_detail TEXT,
  spawn_site     INTEGER NOT NULL DEFAULT 0 CHECK (spawn_site IN (0,1)),
  at             TEXT NOT NULL,
  UNIQUE (session_id, seq)
) STRICT;

CREATE TABLE phases (
  phase_id       TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE RESTRICT,
  ordinal        INTEGER NOT NULL CHECK (ordinal >= 1),
  phase_key TEXT NOT NULL, name TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('agent','code','engineer')),
  owner TEXT NOT NULL, description TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN (
                   'QUEUED','RUNNING','VALIDATING','CORRECTING',
                   'SUCCEEDED','FAILED','SKIPPED','CANCELLED')),
  correction_count INTEGER NOT NULL DEFAULT 0 CHECK (correction_count >= 0),
  max_corrections  INTEGER NOT NULL DEFAULT 0 CHECK (max_corrections >= 0),
  error_code TEXT, error_message TEXT,
  started_at TEXT, ended_at TEXT, created_at TEXT NOT NULL,
  UNIQUE (session_id, ordinal)
) STRICT;

CREATE TABLE events (
  event_row         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id          TEXT NOT NULL UNIQUE,
  session_id        TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE RESTRICT,
  phase_id          TEXT REFERENCES phases(phase_id) ON DELETE RESTRICT,
  run_id TEXT, parent_event_id TEXT,
  first_source_seq  INTEGER NOT NULL CHECK (first_source_seq >= 1),
  last_source_seq   INTEGER NOT NULL CHECK (last_source_seq >= first_source_seq),
  type TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', status TEXT,
  payload_json      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  started_at TEXT NOT NULL, ended_at TEXT,
  input_tokens INTEGER, output_tokens INTEGER,
  cache_read_tokens INTEGER, cache_write_tokens INTEGER,
  reasoning_tokens INTEGER, total_tokens INTEGER,
  estimated_cost_usd REAL,
  cost_authority    TEXT CHECK (cost_authority IS NULL OR cost_authority IN
                      ('provider','catalog-estimate','unavailable')),
  redaction_level   TEXT NOT NULL DEFAULT 'public'
                    CHECK (redaction_level IN ('public','private-ref'))
) STRICT;

CREATE TABLE envelopes (
  envelope_id      TEXT PRIMARY KEY,
  session_id       TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE RESTRICT,
  phase_id         TEXT NOT NULL REFERENCES phases(phase_id) ON DELETE RESTRICT,
  agent TEXT NOT NULL, schema_id TEXT NOT NULL,
  correction_round INTEGER NOT NULL CHECK (correction_round >= 0),
  valid            INTEGER NOT NULL CHECK (valid IN (0,1)),
  producer_status  TEXT CHECK (producer_status IS NULL OR producer_status IN ('success','failure')),
  payload_json     TEXT NOT NULL CHECK (json_valid(payload_json)),
  violations_json  TEXT NOT NULL CHECK (json_valid(violations_json)),
  file_path TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE (phase_id, correction_round)
) STRICT;

CREATE TABLE gate_results (
  gate_result_id   TEXT PRIMARY KEY,
  session_id       TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE RESTRICT,
  phase_id         TEXT NOT NULL REFERENCES phases(phase_id) ON DELETE RESTRICT,
  correction_round INTEGER NOT NULL CHECK (correction_round >= 0),
  gate_id          TEXT NOT NULL,
  gate_kind        TEXT NOT NULL CHECK (gate_kind IN ('pure','filesystem','git','subprocess','journey')),
  candidate_sha    TEXT,
  passed           INTEGER NOT NULL CHECK (passed IN (0,1)),
  command_json     TEXT CHECK (command_json IS NULL OR json_valid(command_json)),
  exit_code        INTEGER,
  checks_json      TEXT NOT NULL CHECK (json_valid(checks_json)),   -- WHAT it verified, pass or fail
  violations_json  TEXT NOT NULL CHECK (json_valid(violations_json)),
  output_path TEXT, started_at TEXT NOT NULL, ended_at TEXT NOT NULL,
  UNIQUE (phase_id, correction_round, gate_id)
) STRICT;

CREATE TABLE processes (
  process_id       TEXT PRIMARY KEY,
  session_id       TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE RESTRICT,
  phase_id         TEXT REFERENCES phases(phase_id) ON DELETE RESTRICT,
  run_id TEXT NOT NULL, adapter_id TEXT NOT NULL, role TEXT NOT NULL,
  transport        TEXT NOT NULL CHECK (transport IN ('process','http','fixture','composite')),
  pid INTEGER, pgid INTEGER,
  process_start_identity TEXT,                       -- so a recycled PID is never killed by mistake
  status           TEXT NOT NULL CHECK (status IN
                     ('RESERVED','REGISTERED','RUNNING','EXITED','FAILED','CANCELLED')),
  command_json     TEXT NOT NULL CHECK (json_valid(command_json)),
  cwd_display TEXT NOT NULL,
  registered_at TEXT NOT NULL, released_at TEXT, ended_at TEXT,
  exit_code INTEGER, exit_signal TEXT,
  cancellation_json TEXT CHECK (cancellation_json IS NULL OR json_valid(cancellation_json)),
  UNIQUE (session_id, run_id)
) STRICT;

CREATE TABLE agent_sessions (
  session_id       TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE RESTRICT,
  agent TEXT NOT NULL, adapter_id TEXT NOT NULL, provider TEXT NOT NULL, color TEXT,
  requested_model TEXT NOT NULL, resolved_model TEXT,
  model_provenance TEXT CHECK (model_provenance IN ('stream-authoritative','route-attributed')),
  host_continuity_ref TEXT,
  context_tokens   INTEGER,                          -- occupancy after the LAST turn, not a sum
  context_window   INTEGER,                          -- NULL = catalog declares no ceiling
  call_count       INTEGER NOT NULL DEFAULT 0 CHECK (call_count >= 0),
  input_tokens INTEGER, output_tokens INTEGER,
  cache_read_tokens INTEGER, cache_write_tokens INTEGER,
  reasoning_tokens INTEGER, total_tokens INTEGER,
  estimated_cost_usd REAL,
  cost_authority   TEXT NOT NULL DEFAULT 'unavailable'
                   CHECK (cost_authority IN ('provider','catalog-estimate','unavailable')),
  created_at TEXT NOT NULL, last_used_at TEXT NOT NULL,
  PRIMARY KEY (session_id, agent)
) STRICT;

CREATE INDEX idx_sessions_recent      ON sessions(archived, started_at DESC, session_id);
CREATE INDEX idx_sessions_state       ON sessions(lifecycle_state, started_at DESC);
CREATE INDEX idx_sessions_task        ON sessions(project_slug, task_id, attempt DESC);
CREATE INDEX idx_transitions_session  ON transitions(session_id, seq);
CREATE INDEX idx_phases_session       ON phases(session_id, ordinal);
CREATE INDEX idx_events_cursor        ON events(session_id, event_row);
CREATE INDEX idx_events_phase_cursor  ON events(phase_id, event_row);
CREATE INDEX idx_events_type          ON events(session_id, type, event_row);
CREATE INDEX idx_envelopes_phase      ON envelopes(phase_id, created_at);
CREATE INDEX idx_gates_phase          ON gate_results(phase_id, correction_round, gate_id);
CREATE INDEX idx_processes_live       ON processes(session_id, status)
                                      WHERE status IN ('RESERVED','REGISTERED','RUNNING');
CREATE INDEX idx_agent_sessions       ON agent_sessions(session_id, last_used_at);

PRAGMA user_version = 1;
```

`idx_events_cursor` is the load-bearing one: the poll query is `WHERE session_id = ? AND event_row > ? ORDER BY event_row LIMIT ?`. **SSSF has no indexes at all**, so every dashboard query is a full scan every 500 ms.

**Migrations.** Numbered SQL files plus `PRAGMA user_version`, each in `BEGIN IMMEDIATE`. Startup refuses a database *newer* than the binary — which is why SSSF's marker-less additive `ALTER` list (`tracer.py:92-99`) forces its reader to `PRAGMA table_info`-probe on every request (`db.ts:97-120`). Migrations never rewrite canonical journals and never invent missing usage, cost, or model identity. **`awsf db rebuild` writes a fresh DB from journals and atomically swaps it after validation; the previous file is retained, not deleted.**

**Concurrency:** one writer per workflow process; reader on a `readonly: true` connection with every query a `SELECT`, except the single archive write on its own lazily-opened connection.

---

## 7.9 Dashboard API & Component Specification

Grounded in the screenshots. `IMG_3271.PNG` shows the sessions grid: per-session cards headed by an 8-hex id in lavender, the workflow chain, the truncated request, a per-card time ruler (`0s 1m 2m 3m`), one dot-plot row per agent lane, a green `✓ success` pill with phase dots, and three metric chips — `$0.6479` · `3m 05s` · `3.48M`, with overflow collapsing to `+2 more agents`. `IMG_3291.PNG` shows the phase detail: left pane a collapsible tree (`agent config`, `description`, `compiled prompts (2)` with per-file line counts, `gates (1)`, `cost`) with the rendered `previous_envelope` inline; right pane a monospace event log, `events (34)`, columns timestamp · type · command/path · duration, `tool_call` rows in cyan, `agent_start` in violet, a green `● live` dot top-right.

### Server

`node:http` bound to `127.0.0.1`/`::1` only. Read-only `node:sqlite` connection. `Host` and `Origin` validated. No permissive CORS. Strict CSP, no remote scripts or fonts. Path segments validated against `/^[A-Za-z0-9._-]+$/` and **rejected outright rather than sanitized** (`server/index.ts:63-67`). Every handler wrapped so a malformed query cannot take the server down mid-run. Compiled prompts and envelope content escaped before rendering. Raw provider logs are never exposed directly. Non-loopback binding would require an explicit one-use bearer token and is out of MVP scope.

| Method | Route | Returns |
|---|---|---|
| GET | `/api/v1/health` | `{ok, schemaVersion, journalMode, project, activeSessions, projectorLag, degradedSessions}` |
| GET | `/api/v1/sessions?limit=&before=&state=&archived=` | cards with embedded phases and agents, so an L1 card costs no extra request |
| GET | `/api/v1/sessions/:id` | session, ordered phases, roster, usage totals, process summary, candidate SHA, gates, review summary, transitions, allowed next actions |
| GET | `/api/v1/sessions/:id/phases/:phaseId` | metadata, redacted effective config, compiled prompts, **all** envelope rounds, gate checks and violations, usage, model-identity evidence, process summary |
| GET | `/api/v1/sessions/:id/events?after=<row>&limit=` | `{events, cursor, hasMore}` — rowid cursor, insertion order, bounded page |
| GET | `/api/v1/settings` · `/api/v1/adapters` | read-only, redacted |
| POST | `/api/v1/sessions/:id/archive` | `{archived}` — **the only write in the process** |

**There is deliberately no endpoint for landing, approval, retry, cancellation, provider switching, or configuration mutation.** Those are CLI operations. A meta-test greps the route table and fails if a landing route appears. `awsf land` refuses when `!process.stdin.isTTY`. Private continuity references are never returned.

**Polling, not WebSockets** [both agree]. SSSF's rule is right (`index.ts:6-8`): *"There is no ingest endpoint and no websocket. The data path is agents → sqlite → web ui."* Cursor polling matches SQLite insertion order, serves live and historical views through one mechanism, survives a host restart with no reconnection or replay protocol, and works after the workflow process has exited. Cadence: 500 ms while a session runs, 2 s on the grid, 5 s idle, exponential backoff on API failure, immediate poll on browser focus.

### Component hierarchy

```
AppShell
├── TopNav                 Breadcrumbs · ProjectBadge · LiveIndicator (green when a poll
│                          landed < 2× poll_ms ago) · DegradedObservabilityBanner
├── SessionsRoute
│   ├── SessionsToolbar
│   └── SessionsGrid → SessionCard[]
│         id (lavender mono) · workflow chain · request (2-line clamp) · TimeRuler
│         · MiniAgentTimeline (one dot row per agent, colored by agent, x by started_at,
│           width by duration) · StateChip · PhaseDots · CallBudgetChip (3/5)
│         · MetricsRow (cost+authority | duration | tokens) · "+N more agents"
├── SessionRoute
│   ├── SessionHeader        request · state · totals · "partial cost" note when mixed
│   ├── StateRibbon ★        DRAFT→…→LANDED with each edge's actor and reason on hover
│   ├── AgentRoster → AgentCard[]  swatch · ModelBadge (with provenance) · ContextMeter
│   │                              · SandboxBadge (os-enforced | tool-policy | unavailable)
│   ├── SwimlaneChart
│   │   ├── TimeAxis          scale from min(started_at) … max(ended_at ?? now)
│   │   └── Lane[]            one per agent + a code/git lane + an engineer lane
│   │        └── PhaseBlock[] rounded rect in agent color, label = the earned description
│   │                         · sparkline = tool-call density · GateBadge cluster
│   │                         · commit pill on the code lane
│   ├── OwnerGateCard ★       shown only in AWAITING_OWNER: diff stat, gate results, verdict,
│   │                         exact candidate SHA, and the terminal command — with a prominent
│   │                         note that landing happens in a terminal
│   └── PhaseDetailDrawer     bottom slide-up, spring physics
│        ├── PhaseInspector   AgentConfig · Prompts · Gates · Usage · Envelope (all rounds)
│        └── EventLog         monospace: timestamp · type · command/path · duration
└── SettingsRoute             EffectiveConfig · AdapterHealth · DatabaseHealth
```

★ = AWSF-only; SSSF has no place for either, because it has no state machine and no landing gate.

### Design tokens

Both models independently arrived at the same palette, which is a good sign it is read correctly from the screenshots.

```css
:root{
  --bg:#0F1017; --surface:rgba(28,30,43,.85); --surface-solid:#1C1E2B;
  --border:rgba(255,255,255,.07); --text:#E7E9F0; --muted:#8B90A6;

  --agent-engineer:#F59E0B; --agent-scout:#FBBF24; --agent-planner:#A78BFA;
  --agent-builder:#22D3EE;  --agent-reviewer:#F43F5E; --agent-documenter:#C084FC;
  --agent-code:#10B981;

  --ok:#22C55E; --running:#3B82F6; --error:#EF4444; --warn:#F97316;

  --font-ui:"Inter","Outfit",system-ui,sans-serif;
  --font-mono:"JetBrains Mono","Fira Code",ui-monospace,monospace;
  --num:tabular-nums;

  --r-card:14px; --r-block:6px; --r-pill:999px;
  --shadow-card:0 1px 0 rgba(255,255,255,.04) inset, 0 8px 24px rgba(0,0,0,.35);
  --dur-fast:120ms; --dur-drawer:280ms; --ease-spring:cubic-bezier(.22,1.2,.36,1);
}
```

Per-agent colors come from `agent_sessions.color`, sourced from `awsf.config.yaml`; the `--agent-*` tokens are fallbacks for the built-in roster only.

**Display rules that are correctness, not taste:** context meters render nothing when the denominator is unknown; estimated costs carry `≈` and their authority label; a mixed-authority total is labelled *partial*; `route-attributed` model identity is visually distinct from `stream-authoritative`. Running phase blocks grow horizontally each poll; running state carries a pulsing halo; gate results fade in sequentially; cards lift 2px on hover — all inside `@media (prefers-reduced-motion: reduce)`. Keyboard navigation and visible focus are required, and **no critical state may be communicated by color alone.**

---

## 7.10 Implementation Roadmap

Every milestone before M4 runs entirely on the **stub adapter** — zero quota spend, the same discipline that let MAW's Phase 1 be built for free.

| # | Milestone | Delivers | Hard acceptance gate |
|---|---|---|---|
| **M0** | PlanF3 | plan HTML, build prompts, acceptance checklist, platform matrix | Owner approves architecture before any code |
| **M1** | Contracts & state | TypeBox contracts, config loader, task + phase machines (**pure, no I/O**), meta-tests (dependency allowlist, import fences, no-land-route, no `shell:true`) | 24 legal / 76 illegal pairs and the ordered rejection contract green **before any spawn code exists** |
| **M2** | Durable persistence | journal, atomic status, attempt locks, replay, SQLite schema + projector + rebuild | Crash injection reconstructs exact state; projector is idempotent; `db rebuild` reproduces every dashboard view |
| **M3** | Execution kernel ⚠ | call reservations, `TransportBroker`, launcher barrier, process controller, three platform impls, stub adapter, `LineFramer` + `EventSequencer` | **Kill the host between registration and release ⇒ no provider process exists.** Cancel with a grandchild ⇒ grandchild reaped, survivors reported truthfully |
| **M4** | Real adapters | Claude Code, Pi/Codex, model identity and usage parsing, same-session corrections, catalog | Captured-stream fixtures first; then **one bounded live probe per provider** |
| **M5** | Workflows & gates | worktrees, sandbox brokers, permission enforcement, envelopes, phase engine, corrections, host commits, risk compiler | Stub journey covers failed gate → same-session correction → final SHA |
| **M6** | Owner controls | CLI (`new start status watch land cancel retry doctor rebuild dash`), `LANDING`, FF-only landing | Non-TTY and API landing impossible; non-FF blocks safely |
| **M7** | API & dashboard | Node API, shared types, sessions grid, swimlanes, drawer, usage/context panels | A live stub run is visible *before* it completes; SQLite remains WAL |
| **M8** | Platform & pilots | WSL/Linux/macOS matrix, two real pilots (one T1, one T2 with cross-provider review), packaging, docs | Real end-user journey, crash recovery, opposite-provider review — each verified **on the machine it names** |

**Ordering gates that cannot be resequenced** [merging both]:

1. State-transition tests green **before** any provider-spawning code exists. MAW learned this: the barrier is only meaningful if the transition it gates is already proven. A downstream model handed the whole design at once will build the barrier first, because it is the interesting part, and then have no way to prove it gates anything.
2. Journal/status crash recovery green **before** the barrier may release a provider.
3. Stub adapter and process simulations green **before** any live provider probe.
4. Sandbox/worktree/write-boundary controls exist **before** a real write-capable model runs.
5. Envelope and failed-gate correction journeys green **before** implementation pilots.
6. Human landing and end-user journey tests pass **before** production adoption.
7. Platform claims are made only after execution on the destination machine.

**M3 is the riskiest milestone in the plan** [ARCHITECT] and should get the most capable model and the most attention. It is where a wrong answer fails *quietly* — exactly the defect class this redesign exists to eliminate.

### Size discipline — fitness functions, not a line cap

ARCHITECT proposed hard LOC ceilings enforced by test (~6,950 source total); BUILDER estimated 12,000–17,000 and argued the old 1,500-line cap has begun producing homemade YAML parsers and line-compression tricks. **BUILDER is right about the mechanism, ARCHITECT is right about the vigilance.** So:

**Primary enforcement — architectural fitness tests** (these catch real defects; a line count catches only verbosity):

- No import of `node:child_process` outside `execution/transport-broker.ts`
- No direct SQLite write outside `observability/projector.ts` and migrations
- No import from `state/` into adapters, git, sqlite, or process APIs
- No `shell: true` anywhere
- No push, force merge, automatic cleanup, or automatic deletion
- No human actor outside TTY CLI commands
- No runtime artifacts committed; no junk-drawer receipt/manifest/digest files
- No credentials in journals, SQLite, API responses, or fixtures
- The dependency allowlist matches `package.json` exactly

**Secondary — advisory budgets** that trigger a design review rather than a red build: `core/src` ≈ 6,000–9,000 · `core/workflows` ≈ 800 · `dashboard` ≈ 4,000–5,500 · per-file review threshold 350–450 logical lines. Realistic total: roughly **11,000–15,000 production lines and 10,000–15,000 test lines.** Exceeding a budget prompts the question "what feature should be deleted?" — it does not fail CI.

**Milestones you can feel:** after M3, watch a stub run start and kill the host mid-registration — no orphan. After M6, run a whole SDLC on the stub, terminal only, zero spend. After M7, the swimlane, live. After M8, two real tasks landed, with counted evidence of what each cost.

---

## 7.11 `/planf3` Evaluation — **YES**

### Warranted, for four specific reasons

1. **Scale.** MAW is ~1,477 lines and needed a plan plus fourteen companion build prompts. AWSF is an order of magnitude larger across two workspaces, six pillars, five adapters, two nested state machines, and three operating systems. If a 1,477-line project earned a formal plan, this is not a judgement call.
2. **Two failure modes here are of the *quiet* kind** — the exact class the last plan was written to eliminate. The `/proc` portability defect fails silently by returning `[]`. Cost authority fails silently by rendering `$0.00` for a subscription that reports no money. Neither is caught by "does it run?" Both need a spec that names them in advance with an acceptance test attached.
3. **The ordering gates are real and non-obvious**, and a fresh session handed the whole design at once will violate them.
4. **You are going to spend real quota.** Build prompts with a model-selection catalog let you route each task by shape and by which dashboard has headroom.

### Format: **extend `agentic-workflow-redesign-plan.html`** — with fixes

That format earns its keep: an *In Plain Language* section explaining the whole system with no technical vocabulary, a phase graph, an amendments log, and a Questionables register with resolutions. Three sections must be **added**, because the existing format has no slot for them and all three are load-bearing: **Visual Design Contract** (tokens, component table, one screenshot reference per component), **Portability Matrix** (one row per platform-dependent behaviour × three OSes), and **Observability Contract** (DDL, projection rule, cost authority, rebuild guarantee).

And these production fixes apply [BUILDER]: keep only two active artifacts plus the acceptance checklist; **inline SVG and CSS, no CDN-hosted Mermaid**; treat the HTML as the approved plan, not a runtime state database; validate every documented acceptance command against actual package scripts; mark impossible criteria `[f]` with the design correction rather than fabricating evidence; **generate output schemas into prompts instead of maintaining a three-file contract by hand**; and refresh model recommendations from the real local catalog rather than inventing selectors, pricing, context windows, or benchmark figures.

**One Questionable must be resolved before Task 1:** can `agy` produce a machine-parseable stream? Until someone runs it and reads the output, the Antigravity adapter is a probe and a stub. Do not design around an unread CLI contract.

---

# 📄 The `/planf3` Build Prompt

**Save as:** `D:\Santiago Marin\Project Repositories\Agentic Orchestration\awsf-planf3-build-prompt.md`

**Then:** open a fresh session with **Opus 5** (`claude:opus`, `/effort high`), paste it whole, and let it run to completion. It produces planning artifacts, not code. Fable only with explicit credit authorization.

````markdown
# Build Prompt — Generate `/planf3` for `agentic-workflow-software-factory`

**Addressed to:** Opus 5 (`claude:opus`, `/effort high`), or Fable 5 only with explicit
usage-credit authorization. **Your output is planning artifacts, not application code.**

## 0. What you are doing

Santiago Marin has two working agentic systems and is merging them into a third,
**`agentic-workflow-software-factory` (AWSF)**. An architectural proposal exists and is
**accepted**. Turn it into buildable artifacts. Produce three files:

| # | File |
|---|---|
| 1 | `D:\…\Agentic Orchestration\agentic-workflow-software-factory\specs\awsf-plan.html` |
| 2 | `…\specs\awsf-plan-build-prompts.md` |
| 3 | `…\specs\awsf-plan-acceptance.md` |

Create only the minimum `specs/` directory needed. Do not write application source code, do
not initialize a source repository, do not call a provider, do not create a worktree. The plan
must say this about itself.

## 1. Ground yourself — read in this order

### Your authority
`D:\Santiago Marin\Project Repositories\Agentic Orchestration\agentic-workflow-software-factory\specs\awsf-architecture-proposal.md`
(at the time this build prompt was written, this file lived one level above the repository;
it is now committed at the path above, alongside the plan it authorized)

Every decision in it is settled. Disagreements become **Questionables** with a recommended
default — do not silently change anything and do not re-open decisions in prose.

### Source A — `my-agentic-workflow` (deterministic control plane)
`D:\…\my-agentic-workflow\` — `README.md` (read the Portability table; it is the #1 defect),
`AGENTS.md`, `fused-workflow-redesign.md`, `AGENTIC-WORKFLOW-FUSION-BRIEF.md`,
`agent-project.yaml`, `specs\agentic-workflow-redesign-plan.html` (**the format you are
extending**), `specs\agentic-workflow-redesign-plan-build-prompts.md` (**the companion format
+ model catalog**), all of `src\`, `prompts\`, `test\`, `records\`.

Read closely: `state.mjs:8-24` (rejection **ordering** is a contract);
`state.mjs:104-130` (legal transitions and guards); `state.mjs:89-95` (why a style note may
not authorize re-work); `state.mjs:55-60` (why `AWAITING_OWNER → BLOCKED` is unreachable by any
clock); `run.mjs:80-112` (the barrier: register durably, *then* release, else kill the tree);
`run.mjs:28-37` (TERM → grace → KILL, then **report reality**); `run.mjs:15-24` (**the `/proc`
bug**); `run.mjs:196-243` (cross-provider review: advisory, single-shot, never a substitute
provider); `providers\launcher.mjs:9-17` (the 19-line fd3/fd4 handshake — read all of it);
`providers\claude-code.mjs:6` (prompt in argv — a leak and a length limit);
`README.md:51-75` (the portability table and the "fails quietly" warning).

### Source B — `super-simple-software-factory` (observable pipeline)
`D:\…\super-simple-software-factory\README.md` and `.claude\skills\sssf\` in full — `SKILL.md`,
`cookbooks\`, `references\{config,handoff,observability}.md`,
`templates\sssf.config.yaml`, `templates\adws\adw_modules\` (`data_types.py`, `runner.py`,
`agents.py`, `agent_pi.py`, `gates.py`, `permissions.py`, `tracer.py`, `session.py`,
`quality.py`, `changes.py`, `git_helper.py`, `prompts.py`), `templates\adws\adw_*.py`,
`templates\prompt_engineering\`, `apps\visualizer\` (`server\index.ts`, `server\db.ts`,
`shared\types.ts`, `src\components\*.vue`).

Read closely: `data_types.py:31-53` (the **earned description** rule, construction-time on
purpose); `data_types.py:388-433` (the 5 token metrics; reasoning as a share of output);
`runner.py:72-111` (every phase starts `fail`); `agents.py:107-216` (the full agent call: spend
accumulates while context occupancy is the *last* send's); **`agents.py:61-63` (SSSF v1 is
pi-only and cannot use Claude Pro at all)**; `gates.py:61-68` (`diff_matches_claims` checks only
one direction); `permissions.py:1-30` (why `tools` is not a sandbox; the real `git checkout`
incident); `tracer.py:17-99` (7 tables, additive migrations, **no version marker**, and
`tracer.event()` has no error boundary so a locked DB aborts the phase); `server\index.ts:1-12,
44-67` (no websocket; path-segment rejection); `server\db.ts:97-120, 323-384` (readonly
connection, column probing, rowid cursor).

### Source C — `fusion-harness` (execution environment; adapter model)
`D:\…\fusion-harness\` — `README.md`, `specs\`, `bin\`, `live_final_generation\`, and
`extensions\fusion-harness\core\`: `events.ts:6-19, 24-33, 51-54` (event vocabulary and
invariants); **`adapters.ts:57-61` (cost authority: `claude-code` is `"unavailable"` —
load-bearing)**; `adapters.ts:98-143` (`LineFramer`, per-instance decoder);
`adapters.ts:504-525, 789-798` (terminals never close tools implicitly);
`adapters.ts:396-413` (fail closed on unresolvable models);
`launch.ts:16-62` (pure descriptors, argv-not-command-line, env allowlist + injection);
`launch.ts:66-181` (the exact `claude` and `pi` flags, and why `--no-extensions` matters);
`process-backends.ts:20-31, 137-237` (detached groups, exit hook, bounded capture);
plus `process-tree.ts`, `guards.ts`, `capabilities.ts`, `model-catalog.ts`,
`permission-policy.ts`, `errors.ts`, `quota.ts`, `redaction.ts`, and `test\*.test.ts`.

### Visual specification — 37 screenshots. **These are the design spec.**
`D:\…\super_simple_software_factory_indydevdan_youtube_video_screenshots\` — look at all of
them; at minimum `IMG_3271` (sessions grid: cards, per-agent dot timelines,
`$0.6479 · 3m 05s · 3.48M`, success pills, `+2 more agents`, `● live`), `IMG_3286` (gate report
and envelope detail), `IMG_3291` (phase detail: left ConfigTree with `compiled prompts (2)`,
`gates (1)`, `cost`, rendered `previous_envelope`; right monospace event log),
`IMG_3305` (SDLC script and phases), `IMG_3309` (YAML config and roster),
`IMG_3316` ("in-distribution primitives"). Transcript:
`…\super_simple_software_factory_indydevdan_youtube_video_transcript.txt`.

### The prompt chain
`…\agentic_workflow_software_factory_gemini3.1Pro_prompt.md` (stage 1) and
`…\agentic_workflow_software_factory_opus4.6_prompt.md` (stage 2 — read its §8 for Santiago's
own words).

## 2. Hard constraints — facts about Santiago's machine, not preferences

**No API keys. Three consumer subscriptions, each reachable only through its CLI:**

| Subscription | CLI | Invocation |
|---|---|---|
| Claude Pro | `claude` | `--print --output-format stream-json --verbose --model <m> --no-session-persistence`, prompt on **stdin** |
| ChatGPT Plus | `pi` | `--mode json -p --provider openai-codex --model <m> --no-session --no-extensions`, prompt on **stdin** |
| Google AI Pro | `agy` | Antigravity CLI. **Stream format unverified.** Adapter ships as a probe + stub until someone reads its output. |

Claude Pro **cannot** be used through Pi. The CLI-subprocess adapter pattern is not a
workaround; design for it natively. New providers must require implementing one interface and
changing no orchestration code — direct API adapters, local adapters (Ollama / LM Studio /
vLLM), and the fusion harness as a composite adapter must all drop in.

**Platform.** Develops on Windows with WSL2; buying an M5 MacBook Pro; building a Linux
desktop. The predecessor's process supervision is Linux-only and **fails silently** elsewhere.
Treat this as a first-class requirement with its own matrix and acceptance rows. **Windows
write-capable v1 runs through WSL2**; do not claim native Windows suspended-process parity
until a native helper exists.

**This is a proposal.** Nothing built so far is considered perfect. Total redesign is permitted
where it is better.

## 3. Accepted architecture — build the plan around this; do not re-litigate

1. **TypeScript on Node ≥ 22.12**, native type-stripping for `core/` (no build step), Vite for
   the dashboard, `tsc --noEmit` + `vue-tsc` as CI typecheck gates. Bun never required.
2. **Declared dependency allowlist, not zero dependencies:** `@sinclair/typebox`, `yaml` in
   core; `vue`, `vite`, `@vitejs/plugin-vue`, `lucide-vue-next` in the dashboard; enforced by a
   meta-test. TypeBox is chosen specifically so the envelope schema is **emitted as JSON Schema
   and injected into prompts automatically** — never handwritten in three places as SSSF does.
   `node:sqlite` behind a driver boundary with a startup feature probe.
3. **The fusion:** the state machine governs the task; the phase engine governs the sojourn
   inside the executing states.
4. **Two-tier correction economics + reservations.** Intra-phase corrections re-prompt the
   *same* session and do not consume tier calls. Calls are reserved before launch, converted to
   spent on `GO`, and released if registration fails. Spend carries across attempts.
5. **Journal is truth; SQLite is a rebuildable projection.** A projection failure never kills a
   running model — it emits `sqlite-projection-failed`, marks the session
   `observability_degraded`, and **blocks advancement past `GATING`** until `awsf db rebuild`
   succeeds.
6. **10 states, 24 edges, 76 rejections, an ordered rejection contract**, including a persisted
   `LANDING` state. `AWAITING_OWNER → LANDING` is interactive-human-on-a-TTY only;
   `LANDING → LANDED` is host code after the canonical repo is confirmed at the exact candidate
   SHA. Any `→ LANDED` from elsewhere reports `HumanGateBypass`. **The dashboard has no landing,
   approval, retry, cancel, or config-mutation route** — absence asserted by a meta-test.
7. **Spawning is centralized in a host `TransportBroker`.** Adapters build pure `ProcessSpec`
   descriptors and parse streams; they may not import `node:child_process` or call `fetch`.
   Enforced by an architecture test.
8. **One process-supervision port, three implementations, one contract suite.** A port that
   cannot enumerate survivors must **error**, never return `[]`.
9. **Cost authority is three-valued** — `provider | catalog-estimate | unavailable` — with the
   pricing table empty by default, so Claude routes render `— subscription`, never `$0.00`, and
   mixed totals are labelled *partial*. Token metrics: `null` ≠ `0`; record
   `reasoningRelation`. Thinking deltas stream for live display but are **never persisted**;
   counts only.
10. **Cross-provider review inversion enforced by the router.** A routing failure means the
    review did not happen — never a substitute provider, never a quieter tier.
11. **Host owns Git.** Agents may edit but never commit, merge, push, rebase, reset, or clean.
    `diff_matches_claims` is exact set equality including deletions. Permission breaches
    **abort**, they do not correct. Landing is local fast-forward only; no push exists.
12. **Six workflows initially**, not twelve: scout, plan, build, plan-build-test, build-review,
    simple-sdlc.
13. **Dashboard:** Vue 3 + Vite, cursor polling (no WebSockets), loopback-only, `Host`/`Origin`
    validated, strict CSP, one write endpoint (archive). Plus two AWSF-only components:
    **StateRibbon** and **OwnerGateCard**. The UI distinguishes `os-enforced` from
    `tool-policy` from `unavailable` — never calls all three "sandboxed."
14. **Architectural fitness tests replace the old 1,500-line cap**; LOC budgets are advisory
    tripwires that prompt a design review, not a red build.

## 4. Deliverable 1 — `specs\awsf-plan.html`

Match `agentic-workflow-redesign-plan.html`, extended. Self-contained: **inline CSS and inline
SVG; no CDN-hosted Mermaid or remote assets.** Dark theme using §6 tokens.

Required sections, in order:

1. **Header** — title, one-line purpose, status, date, back refs, forward ref. Phase graph with
   the ordering gates called out in the figcaption.
2. **In Plain Language** — *no technical vocabulary at all*, matching the register of
   `agentic-workflow-redesign-plan.html:222-308`. Cover: what this is about; why two systems are
   being merged; a workshop or factory analogy; what using it feels like day to day; what each
   milestone is for and what he can *do* when it finishes; why both AI companies are used and
   why *he* picks and the program never does; how he will know it worked; what is deliberately
   not being built; and a boxed one-paragraph version. One plain-language diagram. **Not
   optional, and not a summary** — it is a full explanation for a reader who does not code.
3. **Purpose** · 4. **Problem** (with **file:line evidence from the real repositories** — at
   minimum: MAW has no observability layer and no typed inter-phase contracts; SSSF has no state
   machine, no spawn barrier, and cannot reach Claude Pro (`agents.py:61-63`); MAW's supervision
   fails silently off Linux (`run.mjs:15-24`, `README.md:72-75`); MAW passes prompts in argv
   (`claude-code.mjs:6`) and has no durable landing state; SSSF's `diff_matches_claims` is
   one-directional (`gates.py:61-68`); SSSF's SQLite has no indexes and no version marker
   (`tracer.py:92-99`); SSSF's tracer has no error boundary) · 5. **Solution** (the six pillars
   and the four fusion decisions).
6. **Current-source audit** — verified vs unverified claims, stated as such. MAW's "500 tests /
   1,477 lines" was not re-executed; say so.
7. **Ownership and trust boundaries.**
8. **The Lifecycle Contract** — 10 states; the 24-edge table (from · to · actor · trigger ·
   guard · spawn-site); the 76 illegal pairs by class with the error each throws; the ordered
   rejection contract *with the reasoning for the order*; call-ceiling and correction-allowance
   rules; the phase submachine. Inline SVG state diagram.
9. **The Phase Contract** — `PhaseDefinition`, the three kinds, the earned-description rule,
   success-must-be-earned, the full agent-call pipeline, and the escalation ladder from
   intra-phase correction to inter-state transition.
10. **Envelope & Gate Contract** — every schema; wire vs stored; validation and parse-retry;
    all eleven gates and which phases they apply to; why a permission breach is not a gate
    violation; the schema-injection-into-prompts mechanism.
11. **Adapter & Launcher Contract** — the interface, the broker separation, the 12 event kinds
    and their invariants, the barrier as a sequence diagram, the per-platform cancellation
    ladder, and the cost/quota/usage authority table.
12. **§ Observability Contract** *(new)* — full DDL, indexes, pragmas, `user_version`
    migrations, the projection rule, degraded mode, and the rebuild guarantee.
13. **§ Visual Design Contract** *(new)* — tokens; a component table (name · route · props ·
    data source · **screenshot reference by filename**); the animation inventory with durations
    and easings; `prefers-reduced-motion`; accessibility rules.
14. **§ Portability Matrix** *(new)* — one row per platform-dependent behaviour (state root,
    process-group enumeration, tree cancellation, sandbox broker, worktree containment on
    case-insensitive filesystems, CLI launch, TTY detection for `land`, installed-vs-portable
    consistency) × {Linux, macOS, Windows-native, WSL2}. Every cell starts `PENDING`. **State
    explicitly that no cell may be filled from a machine other than the one it names**, and that
    a passing Linux suite is not evidence about Darwin.
15. **Exclusions** — no LLM orchestrator, supervisor, or doctor; no auto-restart; no background
    monitors; no receipt pipelines; no dashboard write path to the lifecycle; no push; no
    automatic deletion of anything. Explain that removing machinery removes the problems it was
    catching.
16. **File Manifest** — full folder structure, one line of purpose per file.
17. **Milestones & Tasks** — decompose into **bounded tasks**, each sized for one worker in one
    fresh session: id, name, entry conditions, exact output paths, proofs (named tests),
    stopping criteria, dependencies. Preserve all seven ordering gates.
18. **Testing pyramid** and **Validation** — the verification layers, what each proves and what
    it cannot. Destination-hardware testing is explicitly pending until run on the actual
    machines. **Canonical package scripts are the validation interface; validate every
    documented command against the real scripts.**
19. **Questionables** — each with a recommended default and the consequence of choosing
    otherwise. **Q1 must be: can `agy` emit a machine-parseable stream? Default: ship the
    Antigravity adapter as a probe returning `blocked` with `E_ADAPTER_UNVERIFIED`; resolve
    before Task 1.** Include at least: dashboard in v1 or v1.1; reuse MAW's `$XDG_STATE_HOME`
    layout or a fresh one; workflows as TS modules or declarative YAML; fusion adapter in v1
    scope; the macOS state root; and whether the pricing catalog is populated at all.
20. **Risks and rejected alternatives** · 21. **Amendments** — an empty, dated, append-only log.

## 5. Deliverable 2 — `specs\awsf-plan-build-prompts.md`

Match `agentic-workflow-redesign-plan-build-prompts.md`, extended.

1. **Preamble** — each prompt is self-contained for a fresh session with no prior context. Copy
   one, paste it, let it run, clear context, move on. Section A = milestone prompts; Section B =
   task prompts and **this is the recommended path**. Do not run both for the same work.
2. **Decisions already made — do not re-litigate.** A table of every settled decision from §3,
   so a downstream model does not burn a context window re-deriving the runtime choice.
3. **Model selection.** Carry forward the catalog from
   `agentic-workflow-redesign-plan-build-prompts.md:48-120` — the selector table, the corrected
   Sol↔Opus / Terra↔Sonnet tier mapping, the shape-not-tier argument, why Luna is disqualified
   for long-context work, the benchmark trust ranking, and the caveat that scaffold choice
   accounts for 11–15 points so this table sets routing rather than settling it. Update it for
   AWSF's task mix. **Do not fabricate model selectors, pricing, context windows, or benchmark
   results.** If `mf models` or equivalent catalog evidence is unavailable, mark model selection
   as requiring operator confirmation. Every prompt opens with:
   ```
   [CHOOSE YOUR PROVIDER — pick by live quota]
     CLAUDE  claude:opus · /effort high
     GPT     codex:gpt-5.6-sol · reasoning high
     SHAPE   <what kind of work this is, and which family the benchmarks favour>
     WHY     <what makes this task hard — the same on both routes>
     NOTE    <only where there is a provider-specific consideration>
   ```
   Include a Fable credit warning wherever relevant.
4. **Practical budgeting** — which tasks are cheap enough for the mid tier, which deserve the
   flagship, which are Claude-favoured or GPT-favoured by shape, and which are level enough to
   pick on quota alone. **Mark M3 (execution kernel) as the highest-value spend in the plan** —
   it is the milestone whose failures are silent.
5. **Section A — milestone prompts.**
6. **Section B — task prompts**, each containing: the model-selection block; absolute paths of
   every file to read first; exact entry conditions; the immutable architecture decisions that
   apply; the permitted mutation boundary; deliverables with paths; the named tests and
   acceptance commands that constitute proof; explicit stopping criteria; a scoped "do not do
   this" list; and plan marker/amendment instructions.
7. **A cross-platform note on every task touching `core/src/execution/`**: which OS it may be
   *developed* on, which OSes it must be *verified* on, and that verification is a separate,
   later, per-machine event.
8. **Cross-building rule:** where practical, use the opposite provider to review or implement an
   adapter whose assumptions concern that provider.
9. **Fixture integrity rule:** no task may satisfy itself using fixtures invented from the same
   unverified protocol assumption it is testing. Every real adapter requires a captured real
   stream fixture from a bounded probe.

## 6. Deliverable 3 — `specs\awsf-plan-acceptance.md`

A checklist of claims, each with the mechanism that proves it. Every row mechanically checkable.
At minimum:

- All 24 legal transitions succeed; all 76 illegal pairs throw, each with the *correct* error,
  in the *correct* rejection order.
- Kill the host between registration and release: **no provider process exists.** All platforms.
- Cancel a run with a grandchild: **the grandchild is reaped and survivors are reported
  truthfully.** A supervisor that cannot enumerate must error, not return `[]`.
- Crash mid-`LANDING`: recovery is unambiguous, and an ambiguous recovery blocks.
- Delete `awsf.db`, run `awsf db rebuild`, and every dashboard view is byte-identical; the prior
  file is retained, not deleted.
- Corrupt the SQLite file mid-run: the task keeps running, a `sqlite-projection-failed` notice
  appears, the session is flagged degraded, and it **cannot advance past `GATING`** until rebuilt.
- An intra-phase correction does not increment `calls_spent`; a `GATING → RUNNING` transition
  does. A registration failure returns the reservation.
- A Claude-routed phase renders `— subscription`, never `$0.00`, and a mixed total is *partial*.
- A reviewer configured `writes: []` that edits a repo file **aborts the phase** and names the
  path — it does not get a correction attempt.
- An agent that changes a file it did not declare fails `diff_matches_claims`; one that reports
  success with no diff fails `head_advanced`; one that touches a protected path fails
  `no_protected_paths`.
- Grep the API route table: **no landing, approval, retry, cancel, or config-mutation route.**
- `awsf land` with `stdin` not a TTY refuses.
- Architecture tests: no `node:child_process` outside the broker; no SQLite write outside the
  projector; `state/` imports nothing impure; no `shell: true`; dependency allowlist matches
  `package.json`; no runtime artifacts committed; no credentials in journals, SQLite, API
  responses, or fixtures.
- The full stub-adapter journey suite runs end to end with **zero quota spend.**
- The portability matrix has been filled on each machine it names, from that machine.

## 7. Design tokens — use verbatim in the Visual Design Contract

```css
--bg:#0F1017; --surface:rgba(28,30,43,.85); --surface-solid:#1C1E2B;
--border:rgba(255,255,255,.07); --text:#E7E9F0; --muted:#8B90A6;
--agent-engineer:#F59E0B; --agent-scout:#FBBF24; --agent-planner:#A78BFA;
--agent-builder:#22D3EE;  --agent-reviewer:#F43F5E; --agent-documenter:#C084FC;
--agent-code:#10B981;
--ok:#22C55E; --running:#3B82F6; --error:#EF4444; --warn:#F97316;
--font-ui:"Inter","Outfit",system-ui,sans-serif;
--font-mono:"JetBrains Mono","Fira Code",ui-monospace,monospace;
--num:tabular-nums;
--r-card:14px; --r-block:6px; --r-pill:999px;
--dur-fast:120ms; --dur-drawer:280ms; --ease-spring:cubic-bezier(.22,1.2,.36,1);
```

Per-agent colors are read from `awsf.config.yaml` at runtime; these are fallbacks for the
built-in roster only.

## 8. How to work

1. **Be opinionated.** The architecture is settled. Make it buildable, do not relitigate it.
2. **Be concrete.** Real paths, real interfaces, real DDL, real component and test names. Never
   "implement appropriate validation."
3. **Cite the source repos** with `file:line` when stating an invariant that came from one. It
   is how a downstream builder verifies rather than trusts.
4. **Be honest about trade-offs.** Name the cost next to the decision.
5. **Never fabricate.** No invented benchmarks, selectors, pricing, or fixture evidence. A
   criterion discovered to be impossible is marked `[f]` with the design correction. Missing
   token metrics are null, never zero. Distinguish provider-reported cost from catalog estimate
   from unavailable.
6. **Preserve source-project licenses and attribution** where SSSF visualizer code is reused.
7. **Do not mutate** `my-agentic-workflow`, `super-simple-software-factory`, or `fusion-harness`.
   Do not inspect credentials, keys, cookies, or private provider session data. Do not push,
   delete worktrees, prune Git state, or spend live quota to prove anything reproducible from
   files or fixtures.
8. **State plainly, in the plan itself, that it is a planning artifact only.**
9. When you finish, print the three absolute output paths and report: milestone and task count;
   unresolved owner decisions; whether any requested architecture was infeasible; which model
   catalog evidence was used; and confirmation that no AWSF production code, live provider call,
   push, deletion, or source-repository mutation occurred.

## 9. Original request, in Santiago's words

> "Compare what I have built in the my-agentic-workflow project to the
> super-simple-software-factory. Take the best things from both projects and create a new one
> that works for me. I do want to have the visual and observability aspect of my workflow
> inspired by the looks of the super-simple-software-factory […]. Something important to know is
> that the current tools that I have in terms of which models I have availability are only 3
> subscriptions I have (claude pro which I can only use in the claude code harness, I can not
> use it in the Pi harness with my subscription. ChatGPT plus which I can use in the Pi harness,
> and the Google AI Pro subscription with the antigravity CLI which I do not know if I can use
> it in the Pi harness, I do not think so). This is a limitation I have that needs to be
> considered when building […], but I do want it to be scalable so when I do have access to APIs
> from multiple providers and even local models I can run this agentic workflow software
> factory."

> "This is strictly a proposal, and everything that has been built so far is not something that
> I consider perfect at all. I will certainly accept changes and suggestions, we do not need to
> force whatever is going to be built on top of the current my-agentic-workflow, it is simply
> the current state that can be completely redesigned if needed if there is a better and more
> efficient way to structure the upcoming agentic-workflow-software-factory."
````

**Review the generated PlanF3 before building from it** — specifically its state machine, its truth model, its sandbox claims, and whether its acceptance commands correspond to real package scripts.

---

# Consensus & Divergence

**Agreed (both models, independently):** TypeScript on Node 22 with a Vue 3 + Vite dashboard, and both rejected Python on the same evidence (`agents.py:61-63` — SSSF cannot reach Claude Pro). Journal-as-truth with SQLite as a rebuildable projection. PID-before-spawn barrier as the load-bearing invariant. Human-TTY-only landing with no landing endpoint in the API. Cross-provider review inversion with no fallback. Cursor polling over WebSockets. Single YAML config with the Model/Prompt/Harness/Tools dial. Antigravity disabled behind a probe. Stub adapter for zero-quota testing. Seven SQLite domain tables with WAL and `user_version` migrations. Cost authority as a first-class field, `null ≠ 0` for tokens. Permission breaches abort rather than correct. `/planf3` warranted. They even converged on the identical design token palette.

**Divergences resolved:**

- **Adapter spawning.** [ARCHITECT · claude:opus] put `spawn()` on the adapter; [BUILDER · codex:gpt-5.6-sol] centralized it in a `TransportBroker` with adapters forbidden from importing `node:child_process`. Took BUILDER — an adapter that can spawn can bypass the barrier — while keeping ARCHITECT's pure `buildLaunch`/`ProcessSpec` descriptor so argv stays unit-testable.
- **State machine.** ARCHITECT: 9 states / 21 edges with `GATING` and `REVIEWING`. BUILDER: 9 states / 18 edges folding those into `EXECUTING` but adding a persisted `LANDING`. Merged to **10 states / 24 edges / 76 rejections**: ARCHITECT's `GATING`+`REVIEWING` (they encode host-owned gating and inverted-provider review structurally) plus BUILDER's `LANDING` (crash-recoverable fast-forward) plus BUILDER's `AWAITING_OWNER → RUNNING` owner-rework edge and `HumanGateBypass` error. Collapsed BUILDER's `PREPARING`/`READY` split — the distinction adds edges without adding a guard. Also closed a hole in ARCHITECT's "three spawn sites" claim, which allowed `REVIEWING → RUNNING` to re-enter an executing state uncounted.
- **Dependencies.** ARCHITECT: zero-dep core, hand-rolled ~200-line validator. BUILDER: TypeBox + `yaml`. Took BUILDER on one concrete functional ground — a schema library emits JSON Schema, which lets the envelope contract be injected into prompts automatically and kills SSSF's worst drift class — but kept ARCHITECT's discipline as a *pinned, meta-tested allowlist*, and kept ARCHITECT's no-build-step type-stripping for `core/`, which TypeBox permits.
- **SQLite projection failure.** Directly contradictory: ARCHITECT said continue with a notice, BUILDER said terminate and block. Neither alone is right — continuing forever risks invisible completion, terminating contradicts "projection is never truth." Resolved as: never kill a running model, but flag `observability_degraded` and refuse to advance past `GATING` until rebuild succeeds.
- **Cost display.** ARCHITECT's `— subscription` default with BUILDER's three-valued `costAuthority` data model and empty-by-default pricing table. Best of both: safe default, useful upgrade path.
- **Size.** ARCHITECT's ~6,950-line total with hard test-enforced caps is not achievable for what §7.3–7.9 specify; BUILDER's 12–17k is realistic. Adopted BUILDER's architectural fitness functions as primary enforcement, with LOC budgets demoted to advisory tripwires — a hard cap catches verbosity, an import fence catches an actual security regression.
- **Windows.** ARCHITECT's native Job Object plan is the right eventual design but overstates v1 readiness; adopted BUILDER's staged WSL2-for-writes posture, retaining ARCHITECT's non-negotiable rule that a supervisor unable to enumerate survivors must error.
- **Workflow count.** Took BUILDER's six over ARCHITECT's ten — scope discipline.
- **`/planf3` prompt.** ARCHITECT's is far more usable (In Plain Language requirement, Portability Matrix, Visual Design Contract, model-catalog carry-forward) and forms the skeleton; folded in BUILDER's anti-fabrication guardrails (inline SVG not CDN Mermaid, no invented selectors or benchmarks, `[f]` marking, fixture-integrity rule, license attribution, validate commands against real package scripts).

**Discarded:** ARCHITECT's `EnvelopeBase` with `status`/`summary`/`artifacts` as bare strings, in favour of BUILDER's typed `ArtifactClaim` and `producerStatus`. ARCHITECT's claim that reasoning tokens are universally a share of output — that is SSSF's convention, now one case of an explicit `reasoningRelation` field. ARCHITECT's `head_advanced` framing as "agent made a commit" — with host-owned commits it becomes "a diff exists." BUILDER's `PREPARING`/`READY` split, as noted. BUILDER's omission of a `transitions` audit table, restored from ARCHITECT.