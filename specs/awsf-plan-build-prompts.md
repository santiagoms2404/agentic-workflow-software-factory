# Build Prompts — AWSF (Agentic Workflow Software Factory)

Companion to [`awsf-plan.html`](./awsf-plan.html). Created 2026-08-04 by claude-fable-5 alongside the plan and [`awsf-plan-acceptance.md`](./awsf-plan-acceptance.md).

Each prompt below is **self-contained** and written for a **fresh session with no prior context**. Copy one, paste it, let it run to completion, clear context, move to the next.

- **Section A — Milestone prompts (9).** One per implementation milestone (M1–M9; M9 is post-v1). Use these if you are driving a whole milestone in one session.
- **Section B — Task prompts (34).** One per bounded task. This honours the plan's own rule — *one worker, one task, one fresh session, a bounded diff* — and **this is the recommended path.**

Do not run both for the same work. Pick a granularity and stay with it.

**Repository root** (created by T1): `D:\Santiago Marin\Project Repositories\Agentic Orchestration\agentic-workflow-software-factory\` — in WSL: `/mnt/d/Santiago Marin/Project Repositories/Agentic Orchestration/agentic-workflow-software-factory/`. All paths below are relative to this root unless absolute.

---

## Before anything: two gates

1. **Owner approval (M0).** The owner has reviewed `specs/awsf-plan.html` — especially its nine Questionables — and approved the architecture. No T1 session starts before that approval is recorded (an exported `planf3-review v1` block or a note in the plan's Amendments).
2. **Q1 resolved.** Even resolving it *to its default* (Antigravity adapter ships as a probe returning `blocked` with `E_ADAPTER_UNVERIFIED`) counts — but it must be an explicit decision, not an omission.

---

## Decisions already made — do not re-litigate these

The architecture is **accepted** (`awsf-architecture-proposal.md` is the authority). A downstream session must not burn a context window re-deriving any of this:

| # | Decision | Status |
|---|---|---|
| D1 | **TypeScript on Node ≥ 22.12.** `core/` runs under native type-stripping with **no build step**; Vite builds the dashboard; `tsc --noEmit` + `vue-tsc` are CI gates. Bun never required. No `enum`, no parameter properties, no decorators — `as const` unions. | settled |
| D2 | **Dependency allowlist, enforced by meta-test:** core = `@sinclair/typebox`, `yaml`; dashboard = `vue`, `vite`, `@vitejs/plugin-vue`, `lucide-vue-next`; dev = `typescript`, `vue-tsc`, `oxlint`. No web framework — `node:http`. `node:sqlite` behind a driver boundary + startup probe. | settled |
| D3 | **The fusion:** the state machine governs the task; the phase engine governs the sojourn inside the executing states. | settled |
| D4 | **Two-tier correction economics + reservations.** Intra-phase corrections re-prompt the SAME session and consume no tier calls. Calls reserved before launch, spent on `GO`, released on registration failure. Spend carries across attempts. | settled |
| D5 | **Journal is truth; SQLite is a rebuildable projection.** Projection failure never kills a run: `sqlite-projection-failed` notice, `observability_degraded`, no advancement past `GATING` until `awsf db rebuild` succeeds. | settled |
| D6 | **10 states, 24 edges, 76 rejections, an 11-step ordered rejection contract**, persisted `LANDING`. `AWAITING_OWNER → LANDING` is interactive-human-on-a-TTY only. Any other route to `LANDED` throws `HumanGateBypass`. The dashboard has **no** landing/approval/retry/cancel/config-mutation route — absence asserted by meta-test. | settled |
| D7 | **Spawning is centralized in the host `TransportBroker`.** Adapters build pure `ProcessSpec` descriptors and parse streams; they may not import `node:child_process` or call `fetch`. Architecture-tested. | settled |
| D8 | **One `ProcessSupervisor` port, three implementations, one contract suite.** A port that cannot enumerate survivors **errors**, never returns `[]`. | settled |
| D9 | **Cost authority is three-valued** (`provider | catalog-estimate | unavailable`), pricing table empty by default → Claude routes render `— subscription`, never `$0.00`; mixed totals labelled *partial*; token `null ≠ 0`; `reasoningRelation` recorded; thinking streamed, never persisted. | settled |
| D10 | **Cross-provider review inversion enforced by the router.** A routing failure means the review did not happen — never a substitute provider, never a quieter tier. | settled |
| D11 | **Host owns Git.** Agents edit, never commit/merge/push/rebase/reset/clean. `diff_matches_claims` is exact set equality including deletions. Permission breaches **abort**, never correct. Landing is local FF only; no push exists. | settled |
| D12 | **Six workflows initially:** scout, plan, build, plan-build-test, build-review, simple-sdlc. | settled |
| D13 | **Dashboard:** Vue 3 + Vite, cursor polling (no WebSockets), loopback-only, Host/Origin validated, strict CSP, one write endpoint (archive), plus AWSF-only **StateRibbon** and **OwnerGateCard**. Sandbox states are `os-enforced | tool-policy | unavailable` — never a blanket "sandboxed". | settled |
| D14 | **Architectural fitness tests replace hard LOC caps**; budgets are advisory tripwires prompting design review, never red builds. | settled |
| D15 | **Prompts ride stdin, never argv.** System prompts via mode-0600 file. Env is an allowlist + post-filter injection; credential-shaped values are a hard error. | settled |
| D16 | **Routing may never read quota.** The owner picks the provider per task; quota exhaustion blocks with the reset time. | settled |
| Q1–Q9 | The plan's nine Questionables, resolved by the owner at M0 review. Their **recommended defaults** (probe-stub agy · dashboard in v1 · fresh state namespace · TS recipes · fusion in v1.1 · `~/Library/Application Support` on macOS · pricing empty · per-machine worktree root · pattern-reuse with attribution) are assumed by every prompt below; if the owner chose otherwise, the affected prompt says which knob moves. | owner-resolved at M0 |

---

## Model selection

Every prompt opens with a two-route recommendation instead of a single model:

```
[CHOOSE YOUR PROVIDER — pick by live quota; see "Model selection" for the grounding]
  CLAUDE  claude:<selector> · /effort <level>
  GPT     codex:<selector> · reasoning <level>
  SHAPE   <what kind of work this is, and which family the benchmarks favour>
  WHY     <what makes the task hard — the same on both routes>
  NOTE    <only where the task has a provider-specific consideration>
```

Selectors are the ones the `mf models` catalog actually accepts (family aliases for Claude — `claude:opus`, not `claude:opus-5`). **Pick by looking at your two quota dashboards before you start.** That is an operator capability decision made in advance — exactly what D16 protects. The rule bans *the runner* inferring a provider from quota, not you doing it deliberately.

> ⚠ **Provenance and freshness.** The catalog, tier mapping, benchmark figures, and prices below are **carried forward from `my-agentic-workflow/specs/agentic-workflow-redesign-plan-build-prompts.md:48-135`, gathered 2026-08-03** (sources cited there: Simon Willison, Vellum, OpenHands, Artificial Analysis, Vals AI, VentureBeat; prices post-2026-07-30 cuts). Nothing here was re-fetched or invented for this file. **Before spending on any flagship-tier task, re-confirm the selectors against a fresh `mf models` run** — if the catalog has changed, operator confirmation overrides this table.

### Your catalog, mapped

| Selector | Tier | List price /1M | Available to you | Used here |
|---|---|---|---|---|
| `claude:opus` | flagship | $5 / $25 | subscription | **default heavy route** |
| `claude:sonnet` | mid | $2 / $10 (intro → $3/$15 after 2026-08-31) | subscription | **default light route** |
| `claude:fable` | frontier | $10 / $50 | ⚠ **CREDIT-BILLED — explicit authorization required** | excluded from routine tasks; see the Fable warning below |
| `codex:gpt-5.6-sol` | flagship | $5 / $30 | subscription | **default heavy route** |
| `codex:gpt-5.6-terra` | mid | $2 / $12 | subscription | **default light route** |
| `codex:gpt-5.6-luna` | small | $0.20 / $1.20 | subscription | **not recommended** — see below |
| `codex:gpt-5.5` and earlier | prior gens | — | subscription | not used — you want latest |

**List prices are a weight-class proxy, not your cost.** Every route above except `claude:fable` bills to a *subscription*; per-token pricing tells you what capability class a model sits in, not what a task costs you. What you actually spend is quota inside two separate subscriptions.

> ⚠ **Fable credit warning.** `claude:fable` bills real credits, not subscription quota. Do not route any build prompt to Fable without explicit, per-task owner authorization. The tasks below that say "top tier" mean `claude:opus` or `codex:gpt-5.6-sol` — never Fable by default. (This plan itself was authored on Fable under an explicit credit top-up; that authorization does not extend to build sessions.)

### The tier mapping — corrected, and shape-not-tier

| GPT | Claude | Evidence (2026-08-03) |
|---|---|---|
| **Sol** | **Opus 5** | Terminal-Bench 2.1: 89.5 vs 89.1 · SWE-bench Verified 96.2 vs 97.0 — effectively tied |
| **Terra** | **Sonnet 5** | SWE-bench Pro 63.4 vs 63.2 — near-identical; Terra *stronger* on terminal work (87.4 vs 74.5–80.4) |
| **Luna** | *(no analogue in your catalog)* | $0.20/$1.20 class; nearest Claude analogue is Haiku, which `mf` does not expose |
| — | **Fable 5** | no GPT counterpart; credit-billed anyway |

**They are not tier-equivalents — they are differently shaped.** Claude wins repo-level code generation (SWE-bench Pro: Opus 5 79.2 / Fable 80.0 vs Sol 64.6 — a 15-point gap). GPT-5.6 wins long-horizon agentic work (Agents' Last Exam: Sol 53.6 vs Fable 40.5). On pure terminal work they are tied. The per-task question is **which shape**, not which tier — which is what the `SHAPE` line in each prompt answers.

### Why Luna is not recommended for any task here

Every prompt requires reading a large plan document plus source material. Luna's long-context recall is **41.3% on MRCR against Terra's 89.6%** — a specific disqualifier for this workload, not a general judgement. Use `codex:gpt-5.6-terra` as the light GPT route.

### Benchmark trust ranking (for this workflow specifically)

| Benchmark | Trust | Why it matters here |
|---|---|---|
| **Terminal-Bench 2.x** | **Highest** | This system *is* a terminal agent — process groups, tree cancellation, gates. Highest transfer. |
| **Agents' Last Exam** | High | Long-horizon multi-step work; matches the journey/pilot tasks. |
| **LiveBench** | High *methodologically* | Monthly rotation prevents memorization; breadth over depth. |
| **Coding Agent Index** | Moderate | Useful composite, less transparent. |
| **Frontier-Bench v0.1** | Moderate | Novel-problem reasoning; cited for the adversarial-design tasks. |
| **SWE-bench Verified** | **Declining** | Contaminated and saturated (top models 85–97%); differences are noise. |
| **SWE-bench Pro** | **Caution** | ~30% of public-split tasks found broken in OpenAI's July 2026 audit; best difficulty signal available, but small gaps are not real. |

### The caveat that outranks every number above

**Scaffold choice accounts for 11–15 performance points**, and you run Claude Code CLI and Pi/Codex — different scaffolds from the leaderboards'. Treat every number as **setting the initial routing table, not settling it.** AWSF counts every model call by category from pilot one; let *your* data correct this table. That is the same instrumentation-over-story discipline the plan applies to itself.

### Effort dials are not interchangeable

Claude Code's `/effort low|medium|high|xhigh|max` is a session control. The Pi/Codex harness has its own reasoning control with different levels. The `reasoning` values in each prompt are **guidance about how much thinking the task deserves**, not a literal flag — set the nearest equivalent your harness offers. Sub-agent fan-out (where a prompt suggests it) differentiates workers by MODEL override, sets EFFORT once for the orchestrating session, and uses prompt-level reasoning cues for workers — there is no per-worker effort knob.

---

## Practical budgeting

- **⚠ M3 (T9–T12) is the highest-value spend in the plan.** It is the milestone whose failures are silent — a ghost process no record knows about. Use the top tier on whichever provider you pick, do not economize, and give it your most focused review attention.
- **Spend the flagship also on:** **T4** (defines every downstream semantic — the 24/76 matrix and rejection order are enumerated here), **T17** (permission boundaries — a wrong answer is a real safety defect), **T19** (the correction engine — the fusion's economic heart), **T21** (the human gate and crash-recoverable landing).
- **Cheap (mid tier is ample):** T1, T2, T6, T16, T22, T24, T26, T28. Send these to whichever subscription you are conserving. Never Luna.
- **Claude-favoured by shape** (repo-level correctness, adversarial enumeration, novel spec design): T3, T4, T5, T17, T18, T19, T21, T23.
- **GPT-favoured by shape** (long-horizon agentic, terminal orchestration): T20, T27, T29, T30 driving sessions.
- **Genuinely level — pick on quota alone:** T1, T2, T6, T7, T8, T9, T10, T11, T12, T15, T16, T22, T24, T25, T26, T28.
- **Constrained choices:**
  1. **T13 (Claude adapter) prefers a GPT-driven session; T14 (Pi adapter) prefers a Claude-driven session** — the cross-building rule: the opposite provider implements/reviews the adapter whose assumptions concern that provider, so its blind spots don't self-confirm.
  2. **T17 must not use `claude:sonnet`** — Sonnet 5 scored 0% on exploit-development evaluations, and write-boundary/sandbox hardening is exactly that shape. Use `claude:opus` or `codex:gpt-5.6-sol`.
  3. **T30's internal pairing is fixed by design** — whichever provider builds, the other reviews. That inversion *is* the experiment; do not substitute. The session *driving* the pilot can be either provider.

---

## Conventions used by every prompt

**Marker discipline.** This is a **leaf plan** with a single marker set, in `specs/awsf-plan.html`. There is no parent spine plan and no second marker set. Every session **must flip the markers for the work it completed** — the milestone `<h3><code class="status">` header and every checklist `<code class="status">` item it finished — `[]` → `[wip]` → `[x]` (or `[f]` if genuinely blocked, with the reason).

**On completion, every session must also:**
1. Append today's ISO date to the `modified` field in the plan's metadata `<dl>` (comma-separated, append-only — never overwrite existing entries).
2. Append the commit SHA to the `commits` field (same rule), and its agent name / session id to those fields.
3. Add a `<details>` entry to the plan's `#amendments` section: `<summary>YYYY-MM-DD — Milestone N / Task N complete</summary>` with what changed, the SHA, and **`built on: <provider>:<model>`**.

**Cross-platform note — applies to every task touching `core/src/execution/`** (T9, T10, T11, T12, and T27): these tasks may be *developed* on WSL2/Linux. They must be *verified* on Linux, macOS, and WSL2 — **and that verification is a separate, later, per-machine event (T27), never claimed from the development machine.** Write no README sentence that asserts macOS or Windows behavior; write `PENDING` matrix rows instead.

**Fixture integrity rule.** No task may satisfy itself using fixtures invented from the same unverified protocol assumption it is testing. Every real adapter (T13, T14, and any future `agy`) requires a captured real stream fixture from one bounded live probe. Stub fixtures are for stub tests.

**Cross-building rule.** Where practical, use the opposite provider to review or implement an adapter whose assumptions concern that provider (T13 ↔ GPT session, T14 ↔ Claude session).

**Never do, in any session:** push to any remote · delete or prune a worktree, attempt, journal, DB file, or log · mutate `my-agentic-workflow`, `super-simple-software-factory`, or `fusion-harness` · spend live quota to prove anything reproducible from files or fixtures · add a dependency outside the allowlist · claim platform behavior from another platform · write credentials into any artifact · flip a status marker for work you did not complete.

---

# Section A — Milestone prompts

## M1 — Contracts & State (T1–T5)

```
[CHOOSE YOUR PROVIDER — pick by live quota; see "Model selection" for the grounding]
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  SHAPE   adversarial enumeration and spec-to-tests discipline — CLAUDE-FAVOURED
          (repo-level correctness, SWE-bench Pro gap), though T1/T2 alone are mid-tier work.
  WHY     T4 defines the semantics every later task is measured against; it must enumerate
          the 24 legal edges and 76 rejections LITERALLY and encode an 11-step rejection
          ORDER as pairwise tests. A weaker setting quietly derives instead of enumerating.
  NOTE    If driving the whole milestone in one session, do T1–T3 at normal depth and
          raise attention for T4/T5. Fable is NOT authorized for this.

Implement Milestone M1 of specs/awsf-plan.html — "Contracts & State", Tasks T1–T5, in
D:\Santiago Marin\Project Repositories\Agentic Orchestration\agentic-workflow-software-factory\
(WSL: /mnt/d/Santiago Marin/Project Repositories/Agentic Orchestration/agentic-workflow-software-factory/).

READ FIRST, IN FULL:
  1. specs/awsf-plan.html — the M1 milestone block, plus "The Lifecycle Contract",
     "The Phase Contract", "Envelope & Gate Contract" (schemas), "Ownership and Trust
     Boundaries", and "File Manifest". The tables are normative, not illustrative.
  2. specs/awsf-plan-acceptance.md — every row tagged M1.
  3. The two learned config rules cited in the plan (tools-not-a-sandbox; extension
     tools must be named) — encode them, do not rediscover them.

ENTRY: M0 is [x] in the plan (owner approved; Q1 resolved). The directory contains
only specs/ with the three planning artifacts.

LOCKED DECISIONS THAT BITE HERE: D1 (strip-only: no enum/param-properties/decorators),
D2 (allowlist, meta-tested), D6 (10 states / 24 edges / 76 rejections / 11-step order),
D14 (advisory budgets). THE ORDERING GATE G1: T4's suites are written RED before
task-machine code exists; T5 implements to green; and NOTHING in M3 may be started
in any session until this milestone is green.

DELIVERABLES (full checklists in the plan HTML — follow them box by box):
  T1 git init + workspaces + canonical scripts + tsconfig + AGENTS.md + all meta-tests
  T2 core/src/config/{schema,load,effective-config}.ts + committed awsf.config.yaml
  T3 core/src/contracts/* — 7 envelopes + normalized-events + JSON Schema emission +
     prompt-injection helper + no-handwritten-schema meta-test
  T4 five contract suites, RED, module absent: transitions (24/76 with class→error),
     rejection-order (pairwise), actors, ceilings, evidence
  T5 core/src/state/* pure implementation to green + import-fence test

DEFINITION OF DONE:
  npm run test:unit        # 24 accepted · 76 rejected w/ exact errors · order · actors ·
                           # ceilings · evidence · contracts · config · meta-tests
  npm run typecheck && npm run lint
  node --experimental-strip-types core/src/state/task-machine.ts   # loads, no build step
  git status --porcelain   # clean

STOP WHEN the M1 checklist in the plan is fully green. Flip T1–T5 markers and the M1
header, append the modified date + commit SHA + agent/session to the plan metadata, and
add an Amendment entry with `built on: <provider>:<model>`. Do NOT begin M2.
```

## M2 — Durable Persistence (T6–T8)

```
[CHOOSE YOUR PROVIDER — pick by live quota; see "Model selection" for the grounding]
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  SHAPE   crash-ordering and file-system atomicity — LEVEL; both flagships handle it.
          T6 alone is mid-tier; the crash-injection suite (T8) is where depth pays.
  WHY     the write protocol's step ordering (lock → validate → append+fsync → atomic
          status → project → unlock) must survive a kill between EVERY pair of steps,
          and recovery must reconstruct-or-block, never guess.
  NOTE    Zero providers, zero quota. All simulation.

Implement Milestone M2 of specs/awsf-plan.html — "Durable Persistence", Tasks T6–T8.

READ FIRST: specs/awsf-plan.html — the M2 block, "Ownership and Trust Boundaries"
(the storage tree), "Observability Contract" IN FULL (the DDL is normative and goes
into migrations/0001-initial.sql verbatim); specs/awsf-plan-acceptance.md rows tagged M2.

ENTRY: M1 is [x] in the plan. Verify before writing code.

LOCKED: D5 (journal truth / projection rebuildable / degraded-mode-blocks-GATING),
Q3/Q6 resolutions (state roots), the write protocol as specified. G2: the M3 barrier
may not release a provider until this milestone is green.

DELIVERABLES: T6 persistence (paths/journal/status/locks, byte-prefix immutability,
0600 continuity), T7 sqlite driver + migrations + idempotent projector + tool-call
folding, T8 replay + rebuild (prior file retained, byte-identical views) + crash
injection at every protocol boundary + degraded mode.

DEFINITION OF DONE:
  npm run test:sim         # crash matrix · rebuild identity · degraded mode
  npm run test:unit && npm run typecheck && npm run lint
  git status --porcelain   # clean

STOP WHEN the M2 checklist is green. Flip markers, metadata, Amendment. Do NOT begin M3.
```

## M3 — Execution Kernel (T9–T12) ⚠ HIGHEST-VALUE SPEND

```
[CHOOSE YOUR PROVIDER — pick by live quota; see "Model selection" for the grounding]
  CLAUDE  claude:opus · /effort xhigh
  GPT     codex:gpt-5.6-sol · reasoning xhigh
  SHAPE   detached process groups, an exec-preserving release barrier, reservation
          concurrency — Terminal-Bench territory, where Sol 89.5 and Opus 5 89.1 are
          LEVEL. Pick by quota; pick the TOP tier; do not economize here.
  WHY     this is the milestone whose failures are silent: a subtle ordering bug leaves
          ghost processes that every later test happily ignores. The kill-host test and
          the grandchild test are the two proofs the whole plan exists to make possible.
  NOTE    Fable would be defensible here IF the owner explicitly authorizes credits —
          ask first, never assume. All work remains stub-only: zero quota.

Implement Milestone M3 of specs/awsf-plan.html — "Execution Kernel", Tasks T9–T12.

READ FIRST: specs/awsf-plan.html — the M3 block, "Adapter & Launcher Contract" IN FULL
(the barrier diagram is the spec), "The Lifecycle Contract" (spawn sites), the
cross-platform note in awsf-plan-build-prompts.md Conventions; acceptance rows M3.
Reference (read-only, cite don't copy): my-agentic-workflow/src/providers/launcher.mjs
(the fd3/fd4 handshake), my-agentic-workflow/src/run.mjs:28-37 (report reality),
fusion-harness core/adapters.ts:98-143 (LineFramer) and process-backends.ts:20-31.

ENTRY: M1 AND M2 are [x] — G1 and G2. VERIFY EXPLICITLY: run npm run test:unit and
npm run test:sim green before writing a single line here.

LOCKED: D7 (broker-only spawning), D8 (enumerate-or-error), D4 (reservations),
the five spawn sites (L4/L10/L11/L16/L19 — everything else IllegalSpawnSite),
silence window from process/output activity only, TERM → grace → KILL → report,
process_start_identity against PID recycling.

DELIVERABLES: T9 call-budget, T10 broker + barrier + launcher + stub adapter,
T11 process controller + posix/darwin/win32 ports + one contract suite,
T12 stream layer (LineFramer port with attribution, sequencer, output budget).

DEFINITION OF DONE (the two proofs, plus the suites):
  npm run test:sim         # KILL HOST between registration and release ⇒ no provider
                           # process exists · registration failure ⇒ reservation
                           # returned, provider never ran · grandchild reaped,
                           # survivors reported truthfully · forced enumeration
                           # failure ⇒ error, never []
  npm run test:contract    # supervision contract on this platform · descriptor purity
  npm run test:unit && npm run typecheck && npm run lint
  git status --porcelain   # clean

CROSS-PLATFORM: develop on WSL2/Linux; darwin/win32 ports compile + pass mock suites;
NO macOS/Windows claim anywhere — matrix cells stay PENDING until T27 runs there.

STOP WHEN the M3 checklist is green. Flip markers, metadata, Amendment. Do NOT begin M4.
```

## M4 — Real Adapters (T13–T15)

```
[CHOOSE YOUR PROVIDER — pick by live quota; see "Model selection" for the grounding]
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  SHAPE   protocol parsing against captured streams — LEVEL. But the CROSS-BUILDING
          RULE applies per task: prefer a GPT session for T13 (Claude-facing adapter)
          and a Claude session for T14 (Pi-facing adapter). If one session drives all
          of M4, have the opposite provider REVIEW the adapter whose assumptions
          concern it before marking done.
  WHY     each adapter encodes assumptions about a provider's stream; the provider's
          own family is the worst auditor of those assumptions.
  NOTE    EXACTLY TWO live calls are budgeted for this milestone — one bounded probe
          per real provider, captured into fixtures. More means fixtures are being
          regenerated instead of replayed. agy gets NO live call (Q1 default).

Implement Milestone M4 of specs/awsf-plan.html — "Real Adapters", Tasks T13–T15.

READ FIRST: specs/awsf-plan.html — the M4 block, "Adapter & Launcher Contract"
(the exact flag tables), the Fixture Integrity Rule in the build-prompts Conventions;
acceptance rows M4. Reference read-only: fusion-harness core/launch.ts:105-181
(the reviewed claude/pi argv), my-agentic-workflow/src/providers/claude-code.mjs
(the stream-json event shapes it observed).

ENTRY: M3 is [x] (G3) — verify: npm run test:sim green.

LOCKED: D9 (cost authority: claude-code = unavailable → "— subscription"), D15
(stdin prompts, 0600 system-prompt file, env allowlist), D16 (quota never a retry),
fail-closed model identity (E_MODEL_UNRESOLVED), provenance on model.resolved,
antigravity ships blocked with E_ADAPTER_UNVERIFIED.

DELIVERABLES: T13 claude-code adapter + captured fixtures, T14 pi-codex adapter +
captured fixtures, T15 catalog/registry/identity + antigravity probe + docs of the
verification procedure.

DEFINITION OF DONE:
  npm run test:unit        # byte-exact argv descriptors · parsers green on CAPTURED
                           # fixtures · no prompt in argv (grep test) · agy blocked
  npm run test:sim         # stub journeys unregressed
  live probes: exactly one per provider, ≤ 1 call, captured to
  core/test/fixtures/providers/{claude,codex}/, committed, replayed green
  git status --porcelain   # clean

STOP WHEN the M4 checklist is green. Flip markers, metadata, Amendment. Do NOT begin M5.
```

## M5 — Workflows & Gates (T16–T20)

```
[CHOOSE YOUR PROVIDER — pick by live quota; see "Model selection" for the grounding]
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  SHAPE   permission boundaries + the correction engine — CLAUDE-FAVOURED (adversarial
          write-boundary reasoning; repo-level correctness). T17 must NOT use
          claude:sonnet (0% on exploit-development evals; this is that shape of work).
  WHY     T17 is where a wrong answer is a safety defect (breach must abort, never
          correct), and T19 is the fusion's economic heart (same-session corrections
          that provably cost tokens, not calls).
  NOTE    All journeys on the stub — zero quota. G4 and G5 both close here.

Implement Milestone M5 of specs/awsf-plan.html — "Workflows & Gates", Tasks T16–T20.

READ FIRST: specs/awsf-plan.html — the M5 block, "The Phase Contract", "Envelope &
Gate Contract" IN FULL (eleven gates; breach-is-not-a-gate-violation card), the
permission mechanism citations (permissions.py:50-75 change-set fingerprinting —
read the real file, read-only); acceptance rows M5.

ENTRY: M4 is [x]. Verify the full suite green first.

LOCKED: D11 (host owns Git; exact set equality incl. deletions; breach aborts),
D4 (correction economics), D3 (phase engine inside executing states), earned
descriptions at compile time, success-must-be-earned, schema injection into prompts,
{previous_envelope} host-rendered — never conversational memory.

DELIVERABLES: T16 worktrees + changes + commit (no delete function exists),
T17 policy (profiles, globs, protected paths, bwrap broker, breach abort, redaction),
T18 the eleven gates with positive+negative coverage, T19 compiler/engine/corrections,
T20 six recipes + stub journeys (correction · breach · T2-review-inversion).

DEFINITION OF DONE:
  npm run test:journeys    # correction journey (no call spent) · breach abort naming
                           # paths · review inversion, no substitute · zero quota
  npm run test:unit && npm run test:sim && npm run typecheck && npm run lint
  npm test                 # full suite, one invocation
  git status --porcelain   # clean — tests never leave the repo dirty

STOP WHEN the M5 checklist is green. Flip markers, metadata, Amendment. Do NOT begin M6.
```

## M6 — Owner Controls (T21–T22)

```
[CHOOSE YOUR PROVIDER — pick by live quota; see "Model selection" for the grounding]
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  SHAPE   TTY interaction + crash-recoverable Git fast-forward — CLAUDE-FAVOURED
          slightly (the landing edge is adversarial-correctness work); T22 is mid-tier.
  WHY     the human gate is the keystone: land must refuse non-TTY, display the exact
          SHA, persist LANDING, recover a crash unambiguously or block, and be
          reachable from exactly one call site.
  NOTE    Zero quota. After this milestone, run one whole stub SDLC by hand — the
          plan requires feeling it, not just testing it.

Implement Milestone M6 of specs/awsf-plan.html — "Owner Controls", Tasks T21–T22.

READ FIRST: specs/awsf-plan.html — the M6 block, "The Lifecycle Contract" rows
L19–L24 and the rejection order (InteractiveOwnerRequired at position 8);
acceptance rows M6.

ENTRY: M5 is [x]. Verify npm test green.

LOCKED: D6 (TTY-only landing; HumanGateBypass; persisted LANDING), no push path,
gc lists only, doctor mutates nothing, retry mints attempt n+1 carrying spend.

DELIVERABLES: T21 CLI (new start status watch land cancel retry) + land.ts complete,
T22 doctor + db rebuild + gc + dash launcher.

DEFINITION OF DONE:
  npm run test:journeys    # owner command path new→land on stub · human gate
                           # un-bypassable · non-TTY refused · one call site
  npm run test:sim         # crash mid-LANDING recovers-or-blocks · doctor exit codes
  npm test && git status --porcelain
  by hand: stub simple-sdlc start→land in a terminal, zero spend

STOP WHEN the M6 checklist is green. Flip markers, metadata, Amendment. Do NOT begin M7.
```

## M7 — API & Dashboard (T23–T26)

```
[CHOOSE YOUR PROVIDER — pick by live quota; see "Model selection" for the grounding]
  CLAUDE  claude:opus · /effort medium   (T23 security review deserves high)
  GPT     codex:gpt-5.6-sol · reasoning medium
  SHAPE   Vue components against a fixed visual contract — LEVEL, and the largest
          task-count milestone; consider fan-out: keep T23 (security surface) in the
          orchestrating session, spawn mid-tier workers (claude:sonnet /
          codex:gpt-5.6-terra) for T24/T25/T26 component batches, integrate centrally.
          The harness spawns NO workers unless you explicitly instruct it to.
  WHY     correctness here is mostly display-honesty rules (no bare costs, provenance
          distinction, tri-state sandbox) plus one hard boundary: the API has no
          write route except archive — meta-tested, not promised.
  NOTE    The Visual Design Contract's component table IS the scope. Anything not in
          it is v1.1. Screenshots are the spec — load the six named PNGs.

Implement Milestone M7 of specs/awsf-plan.html — "API & Dashboard", Tasks T23–T26.

READ FIRST: specs/awsf-plan.html — the M7 block and "Visual Design Contract" IN FULL
(tokens verbatim; component table; animation inventory; accessibility rules);
"Observability Contract" (poll query, cadence); acceptance rows M7. Design spec:
the six named screenshots in
D:\Santiago Marin\Project Repositories\Agentic Orchestration\super_simple_software_factory_indydevdan_youtube_video_screenshots\
(IMG_3271, IMG_3286, IMG_3291, IMG_3305, IMG_3309, IMG_3316).

ENTRY: M6 is [x]. Verify npm test green.

LOCKED: D13 (polling, loopback, CSP, one write route, StateRibbon + OwnerGateCard),
D9 display rules (— subscription; ≈ + authority; partial totals), Q9 resolution
(pattern-reuse; MIT attribution on literal ports).

DELIVERABLES: T23 API server + shared/types.ts + no-write-route meta-test,
T24 shell/grid/polling, T25 session route (StateRibbon, swimlanes, OwnerGateCard),
T26 drawer/event log/settings + reduced-motion + a11y.

DEFINITION OF DONE:
  npm run typecheck        # tsc --noEmit AND vue-tsc
  npm run test:unit        # display-correctness rules · no-write-route meta-test
  by hand: start a stub simple-sdlc, open awsf dash, watch it live BEFORE it
  completes; SQLite stays WAL throughout
  git status --porcelain   # clean

STOP WHEN the M7 checklist is green. Flip markers, metadata, Amendment. Do NOT begin M8.
```

## M8 — Platform & Pilots (T27–T30)

```
[CHOOSE YOUR PROVIDER — pick by live quota; see "Model selection" for the grounding]
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  SHAPE   long-horizon operational driving — GPT-FAVOURED for the driving session
          (Agents' Last Exam); but T30's INTERNAL worker/review pairing is fixed by
          design and must not be substituted.
  WHY     this is where claims meet machines: every matrix cell from its own machine,
          and two real tasks with counted costs.
  NOTE    The only milestone that spends real quota beyond probes. Pilot ceilings are
          hard: ≤ 3 calls (T29), ≤ 5 calls (T30). The macOS column WAITS for the Mac.

Implement Milestone M8 of specs/awsf-plan.html — "Platform & Pilots", Tasks T27–T30.

READ FIRST: specs/awsf-plan.html — the M8 block, "Portability Matrix" IN FULL
(including the no-cross-machine-claims rule), "Testing Pyramid" layers 6–7;
acceptance rows M8.

ENTRY: M7 is [x]. Verify npm test green. Owner has picked pilot tasks and providers
(their choice, recorded in the journal — never inferred from quota).

LOCKED: G6, G7, D10 (review inversion is the experiment in T30), D16.

DELIVERABLES: T27 matrix filled per machine (WSL2 now; macOS on arrival; Windows
native = dashboard + read-only rows only), T28 packaging/docs/justfile + the
doc-reconciliation test, T29 pilot 1 (real T1 task, ≤ 3 calls, landed via TTY),
T30 pilot 2 (real T2 task, opposite-provider review, journey against the exact
candidate SHA, ≤ 5 calls) + records/pilots/*.md summaries.

DEFINITION OF DONE:
  every matrix cell for owned machines: filled from that machine, or PENDING with
  the machine named · doc-reconciliation test green · both pilots landed within
  ceilings with calls counted and categorized · npm test green after both ·
  git status --porcelain clean

STOP WHEN the M8 checklist is green. Flip markers, metadata, Amendment. AWSF is
adopted only when the plan's Validation section is fully checked.
```

---

## M9 — Work Intake (T31–T34) — POST-v1

```
[CHOOSE YOUR PROVIDER — pick by live quota; see "Model selection" for the grounding]
  CLAUDE  claude:sonnet · /effort medium   (T34 touches the landing path — use high)
  GPT     codex:gpt-5.6-terra · reasoning medium
  SHAPE   contract-plus-CRUD over machinery that already exists — LEVEL. The hard
          parts (path policy, no-land-route, cost authority) were built and tested
          in M5/M6/M7 and are reused here, not re-derived.
  WHY     the risk is not difficulty, it is scope: every task here is one small
          addition that must not weaken an invariant M1–M8 spent nine milestones
          establishing.
  NOTE    POST-v1. Do not start M9 before M8 is [x] and AWSF is adopted. Nothing in
          this milestone may add a push path, a daemon, or a dashboard write route.

Implement Milestone M9 of specs/awsf-plan.html — "Work Intake", Tasks T31–T34.

READ FIRST: specs/awsf-plan.html — the M9 block, "Envelope & Gate Contract" (the
one-source rule the Ticket contract follows), Q10 IN FULL, "Explicitly Not Built";
specs/tickets/README.md (the corpus and its derivation rules); AGENTS.md
invariant 12.

ENTRY: M8 is [x] and AWSF is adopted. Verify npm test green.

LOCKED: Q10 (no publish/push path in v1 — the contract is reserved, not built),
D6 (no dashboard write route), D11 (host owns Git; landing is local FF only),
invariant 12 (tickets and plan never disagree).

DELIVERABLES: T31 Ticket contract + file-backed store, T32 the intake recipe +
awsf ticket, T33 awsf backlog + the read-only /backlog route, T34 the
pull-request-shaped landing summary.

DEFINITION OF DONE:
  every ticket in specs/tickets/ validates · the no-land-route meta-test green
  WITH /backlog present · the M1 no-push string scan passes UNCHANGED ·
  ticket-plan-sync green · npm test green · git status --porcelain clean

STOP WHEN the M9 checklist is green. Flip markers, metadata, Amendment.
```


## M10 — Correction Economy (T35–T36) — v1.1, POST-PILOT

```
[CHOOSE YOUR PROVIDER — pick by live quota; see "Model selection" for the grounding]
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  SHAPE   two normative changes to the owner's control surface — CLAUDE-FAVOURED.
          Neither is large in lines; both decide what an attempt may cost and
          whether a real review finding can be acted on at all.
  WHY     both defects were found by M8's own pilots rather than by any test, and
          both were paid for in scarce subscription quota. They are carried as
          tasks so the next one is not.
  NOTE    POST-PILOT v1.1. Gated behind M8 being [x]; independent of M9. Nothing
          here weakens a v1 invariant: the ceiling stays a real bound, every act
          added is TTY-only and journalled, and no push path appears.

Read the M10 block, both task blocks, and the 2026-08-16 pilot-2 Amendment IN FULL
before touching anything: the Amendment is where both defects are measured rather
than asserted.

STOP WHEN the M10 checklist is green. Flip markers, metadata, Amendment.
```

---

# Section B — Task prompts (recommended)

Thirty-six prompts, one per bounded task — the granularity the plan is designed around. T31–T34 are M9, post-v1, and T35–T36 are M10, post-pilot v1.1: do not start either group before M8 is `[x]`. Every prompt assumes the shared **Conventions** above (marker discipline, completion metadata, never-do list, cross-platform note, fixture integrity, cross-building). Each prompt names the same **read-first set** unless it says otherwise:

> `specs/awsf-plan.html` (this task's block IN FULL, plus "The Lifecycle Contract" and the contract section the task implements), `specs/awsf-plan-acceptance.md` (rows tagged with this task's milestone), `AGENTS.md` once it exists, and the existing `core/src`.

---

### T1 — Workspace bootstrap and meta-tests

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:sonnet · /effort low
  GPT     codex:gpt-5.6-terra · reasoning low
  SHAPE   spec-following file creation — LEVEL; either mid tier is ample.
  WHY     scaffolding against a spec already written in full; no architectural judgement.
  NOTE    Cheapest task in the plan. Never Luna (long-context recall disqualifier).

Task T1 of specs/awsf-plan.html (Milestone M1). Read the T1 block and "File Manifest".

ENTRY: M0 is [x] — owner approved, Q1 resolved. Directory contains only specs/.

DO: git init (explicit default branch) · first commit = the three specs UNCHANGED ·
root package.json (workspaces ["core","dashboard"], engines >=22.12, canonical scripts
test/test:unit/test:contract/test:sim/test:journeys/typecheck/lint) · pinned deps
exactly per D2 · tsconfig (strict, strip-only-safe) · core/ + dashboard/ skeletons ·
AGENTS.md (ten invariants; no live task state ever) · justfile · meta-tests:
dependency allowlist · no shell:true · child_process fence · sqlite-write fence ·
state/ purity fence · no push/auto-delete strings · junk-drawer · no-land-route ·
no credentials in fixtures · advisory LOC budget (warns only).

DO NOT write any state-machine code (T4 tests come first). DO NOT add any dependency
beyond the allowlist.

DONE WHEN: npm run test:unit green (all meta-tests), one baseline commit exists.
Flip T1's checklist and set M1's header to [wip]; metadata + Amendment per Conventions.
```

### T2 — Configuration schema and loader

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  SHAPE   schema modelling — LEVEL.
  WHY     one committed tuning surface with hard rejections; the two learned rules
          (tools-not-a-sandbox, extension tools must be named) must be encoded, not
          rediscovered.

Task T2 of specs/awsf-plan.html (M1). Read the T2 block and the proposal's §7.3.5
config example reproduced there.

ENTRY: T1 is [x].

DO: core/src/config/schema.ts (TypeBox, awsf/v1, full surface incl. routing
no_fallback:true, review:invert-provider, pricing empty default) · load.ts (rejects
absolute machine paths, credential-shaped values, unknown adapters/workflows/gates,
ceilings not {1,3,5}) · effective-config.ts (redacted snapshot for API/UI +
config_snapshot_json) · the committed default awsf.config.yaml.

DONE WHEN: loader rejection suite green; snapshot round-trips; npm run test:unit green.
Markers/metadata/Amendment per Conventions.
```

### T3 — Envelope and event contracts

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:opus · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  SHAPE   contract design — CLAUDE-FAVOURED (repo-level correctness).
  WHY     these schemas are the single source for validators, types, AND the JSON
          Schema injected into every prompt; a subtle looseness here becomes every
          later phase's parsing bug.

Task T3 of specs/awsf-plan.html (M1). Read the T3 block and "Envelope & Gate
Contract" IN FULL — the interfaces there are normative.

ENTRY: T1 is [x] (T2 recommended first for shared helpers).

DO: core/src/contracts/ — EnvelopeBase + ArtifactClaim + the six phase envelopes
(ReviewFinding.severity included) · normalized-events.ts (12 kinds as `as const`
union, notice codes incl. sqlite-projection-failed, provenance on model.resolved) ·
StoredEnvelope wrapper (wire/stored split — the model never echoes phase_id) ·
JSON Schema emission + prompt-injection helper · parser (strip fences, outermost
object, 256 KiB cap, unknown fields rejected, violations retained) ·
no-handwritten-schema meta-test over prompts/.

DONE WHEN: for each envelope, validator + static type + emitted JSON Schema derive
from one definition; null≠0 explicit in TokenUsage; npm run test:unit green.
Markers/metadata/Amendment per Conventions.
```

### T4 — Task-machine contract tests, written RED

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  SHAPE   adversarial enumeration — CLAUDE-FAVOURED (novel spec design).
  WHY     highest-leverage task in M1: it defines the semantics every later task is
          measured against, and it must enumerate LITERALLY (24 legal, 76 by class
          with exact errors, 11-step order pairwise) rather than derive. Do not
          economize. Fable is NOT authorized.

Task T4 of specs/awsf-plan.html (M1). Read the T4 block and THE LIFECYCLE CONTRACT
IN FULL — every table is normative: states, L1–L24 with guards, the 76-pair class
table (27 TerminalAttempt · 10 AlreadyInState · 6 HumanGateBypass · 33
IllegalTransition), the 11-step rejection order WITH its reasoning column.

ENTRY: T1 is [x]. core/src/state/task-machine.ts DOES NOT EXIST and must not exist
when you finish.

DO: five suites, ALL RED: transitions (programmatic 10×10; assert exactly 24 accept,
exactly 33+27+10+6 throwing with mapped classes; legal set enumerated literally) ·
rejection-order (for each adjacent rejection pair, an input violating both asserts
the earlier fires) · actors (L20 human+TTY only; L16/L19 owner/human; tranche rules;
NonDeterministicEvidence on any conversational reason.source) · ceilings (T0=1 T1=3
T2=5 pre-spawn; reservations; composite full-cost; workflow-min-fit; spend across
attempts) · evidence (per-edge guards incl. L21 record-fault-only/no-clock).

DO NOT implement anything to make them pass — that is T5.

DONE WHEN: all five suites exist, are exhaustive against the plan's tables, and fail
cleanly ("module not found" / stub throw). Record the failure output in your
completion note as the proof of ordering. Markers/metadata/Amendment per Conventions.
```

### T5 — Task machine and phase machine to green

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  SHAPE   pure-logic implementation against a hostile suite — CLAUDE-FAVOURED.
  WHY     the implementation must satisfy tests it did not write, including an
          ordered-rejection contract that punishes shortcut error handling.

Task T5 of specs/awsf-plan.html (M1). Read the T5 block, the Lifecycle Contract, and
the failing T4 suites — the suites are the spec now.

ENTRY: T4 is [x] and its five suites are RED.

DO: core/src/state/{task-machine, phase-machine, guards, tiers, errors}.ts — pure, no
I/O, no imports of execution/adapters/git/sqlite (the fence test bites now). Phase
submachine with same-session resume identity on CORRECTING → RUNNING.

DO NOT touch the T4 suites except to fix a demonstrable test bug — and record any
such fix in the Amendment.

DONE WHEN: npm run test:unit fully green · npm run typecheck && npm run lint green ·
node --experimental-strip-types core/src/state/task-machine.ts loads bare.
Flip T5 + the M1 header to [x]; metadata + Amendment. G1 is now satisfied.
```

### T6 — Platform paths, journal, status, attempt locks

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  SHAPE   filesystem atomicity — LEVEL; mid tier with care.
  WHY     append-only + fsync + atomic rename are simple to write and easy to get
          subtly wrong; the byte-prefix proof keeps it honest.

Task T6 of specs/awsf-plan.html (M2). Read the T6 block, "Ownership and Trust
Boundaries" (storage tree), and the write protocol in the M2/Observability sections.

ENTRY: M1 is [x] (verify npm run test:unit green).

DO: core/src/persistence/{platform-paths, journal, status-store, attempt-lock}.ts —
state roots per Q3/Q6 ($XDG_STATE_HOME / ~/Library/Application Support / %LOCALAPPDATA%,
XDG honored when explicitly set) · O_APPEND journal, fsync at phase boundaries,
source_seq · temp+rename status · exclusive attempt lock · sealing on terminal states
(SealedAttempt on later writes) · private/continuity.json mode 0600.

DONE WHEN: byte-prefix immutability proven · no partial status observable under
concurrent reads (500/500) · sealed attempts throw · npm run test:unit green.
Markers/metadata/Amendment per Conventions.
```

### T7 — SQLite driver, migrations, projector

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  SHAPE   DDL transcription + idempotent projection — LEVEL.
  WHY     the DDL is given verbatim in the plan; the judgement is in idempotency and
          the error boundary (projection failure must never throw into a phase).

Task T7 of specs/awsf-plan.html (M2). Read the T7 block and "Observability Contract"
IN FULL — the DDL goes into migrations/0001-initial.sql verbatim, pragmas included.

ENTRY: T6 is [x].

DO: core/src/observability/{sqlite, projector, queries}.ts + migrations/0001-initial.sql ·
startup feature probe (WAL, STRICT, json_valid) · user_version migrations in BEGIN
IMMEDIATE · refuse newer-than-binary DBs · idempotent event application (re-apply is a
no-op) · tool-call folding · projection failure → notice + observability_degraded flag,
NEVER a throw into the caller · only projector + migrations write (fence test).

DONE WHEN: projector suite green incl. double-apply; refusal both directions tested;
npm run test:unit green. Markers/metadata/Amendment per Conventions.
```

### T8 — Replay, rebuild, crash injection

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  SHAPE   crash-ordering adversarial testing — LEVEL; use a flagship, the suite must
          think of the kills the implementation didn't.
  WHY     G2 closes here: the barrier may not release a provider until recovery
          provably reconstructs-or-blocks at EVERY protocol boundary.

Task T8 of specs/awsf-plan.html (M2). Read the T8 block and the degraded-mode card.

ENTRY: T7 is [x].

DO: core/src/persistence/replay.ts · core/src/observability/rebuild.ts (fresh DB from
journals, validate, atomic swap, PRIOR FILE RETAINED) · simulation suites: kill
injected between every pair of write-protocol steps (reconstruct exactly or BLOCKED
with the exact bad key; corrupt files retained byte-identical) · rebuild identity
(delete awsf.db → rebuild → every query view byte-identical) · degraded mode (corrupt
DB mid-run: task continues, notice emitted, flagged, GATING advancement refused until
rebuild).

DONE WHEN: npm run test:sim green · full unit suite unregressed. Flip T8 + M2 header;
metadata + Amendment. G2 is now satisfied.
```

### T9 — Call-budget reservations

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  SHAPE   concurrency invariants — LEVEL (M3 tier: top models only).
  WHY     the reservation ledger is what makes "kill it anywhere" financially safe:
          a provider that never ran must never cost a call, concurrently.

Task T9 of specs/awsf-plan.html (M3). Read the T9 block and the reservations rules in
the Lifecycle Contract. ENTRY: M2 is [x] — VERIFY npm run test:unit AND test:sim
green before any code (G1+G2).

DO: core/src/execution/call-budget.ts — reserve-before-launch / spend-on-GO /
release-on-registration-failure · property test: N concurrent attempts vs ceiling C
never exceed C · composite full-cost declaration · workflow-min-fit rejection hook ·
corrections provably budget-neutral; GATING→RUNNING provably not · spend carried
across attempts.

DONE WHEN: property + unit suites green. Markers/metadata/Amendment per Conventions.
```

### T10 — TransportBroker, launcher barrier, stub adapter

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:opus · /effort xhigh
  GPT     codex:gpt-5.6-sol · reasoning xhigh
  SHAPE   detached-group handshake where registration must provably precede exec —
          Terminal-Bench territory, LEVEL. The most failure-prone task in the plan.
  WHY     a subtle ordering bug here is invisible in tests written to pass; the
          kill-host proof is the entire reason M1–M2 came first.
  NOTE    Fable defensible ONLY with explicit owner credit authorization — ask first.

Task T10 of specs/awsf-plan.html (M3). Read the T10 block and "Adapter & Launcher
Contract" IN FULL (the barrier sequence diagram is the spec). Reference read-only:
my-agentic-workflow/src/providers/launcher.mjs (fd3/fd4, execve),
my-agentic-workflow/src/run.mjs:80-112 (register durably then release, else kill).

ENTRY: T9 is [x]; the T4/T5 suite is green — verify explicitly (G1).

DO: transport-broker.ts (THE ONLY child_process importer) · launcher-barrier.ts ·
launcher.ts (report {pid,pgid} on fd3; block on fd4 for GO; execve preserving PID) ·
stub adapter (scriptable: success/timeout/silence/overload/malformed/model-line/
no-model-line/grandchild-spawner) · spawn-site enforcement (only L4/L10/L11/L16/L19
reach the broker; IllegalSpawnSite before any child) · process_start_identity.

DONE WHEN: npm run test:sim — kill host between registration and release ⇒ NO
provider process exists AND the stub's side-effect file was never created ·
registration failure ⇒ tree killed + reservation returned. Markers/metadata/Amendment.
```

### T11 — Process controller and the three platform ports

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:opus · /effort xhigh
  GPT     codex:gpt-5.6-sol · reasoning xhigh
  SHAPE   process-tree control — Terminal-Bench territory, LEVEL, top tier.
  WHY     this is the direct fix for the predecessor's silent [] on Darwin; the
          contract "enumerate or ERROR" is the single most important portability rule.

Task T11 of specs/awsf-plan.html (M3). Read the T11 block, the per-platform
cancellation ladder, and the cross-platform note in Conventions. Reference read-only:
my-agentic-workflow/src/run.mjs:19-37 (the /proc scan AND the report-reality ladder).

ENTRY: T10 is [x].

DO: process-controller.ts (TERM → grace 2s → KILL → enumerate → report
{termSent,killSent,survivors,terminated}) · platform/{posix,darwin,win32}.ts under ONE
contract suite · a port that cannot enumerate returns an ERROR — force the failure in
a test · silence window (2700s, process/output activity only) + record-update-failed
trip · liveness monitor.

CROSS-PLATFORM: developed on WSL2/Linux; darwin/win32 compile + pass mock suites;
live verification is T27, per machine; write no platform claim anywhere.

DONE WHEN: npm run test:contract green here · grandchild test green (spawn stub that
spawns a sleeper; cancel; both dead; survivors truthful). Markers/metadata/Amendment.
```

### T12 — Stream layer: LineFramer, EventSequencer, output budget

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  SHAPE   byte-level framing + event invariants — LEVEL.
  WHY     chunk boundaries mid-code-point, budget overruns that must not hide
          terminals, and explicit tool settlement are all quiet-failure surfaces.

Task T12 of specs/awsf-plan.html (M3). Read the T12 block and the twelve-event
invariant list. Reference read-only WITH ATTRIBUTION on any literal port:
fusion-harness core/adapters.ts:98-143 (LineFramer, per-instance decoder, flush).

ENTRY: T10 is [x].

DO: adapters/stream/{line-framer, event-sequencer, output-budget}.ts — per-instance
streaming decoder · flush releases unterminated tails as visible malformed lines ·
framing reads past the budget so terminals stay observable · exactly one terminal per
run · tools settled explicitly before a cancellation terminal · host-minted tool ids ·
null≠0 · E_MODEL_UNRESOLVED fail-closed · notice codes wired.

DONE WHEN: the M3 milestone checklist in the plan is fully green (this is M3's last
task — run the whole DEFINITION OF DONE from the M3 milestone prompt). Flip T12 + the
M3 header; metadata + Amendment. G3 is now satisfied.
```

### T13 — Claude Code adapter

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high   ← PREFERRED session (cross-building rule)
  SHAPE   protocol parsing — LEVEL, but the adapter's assumptions concern CLAUDE, so
          prefer the GPT route to implement, or have GPT review before marking done.
  WHY     stream-json parsing, identity provenance, quota-error mapping — assumptions
          a same-family session tends to confirm rather than test.
  NOTE    EXACTLY ONE bounded live Claude call is budgeted: small prompt, read-only
          tools, captured to fixtures. The fixture-integrity rule forbids invented
          fixtures.

Task T13 of specs/awsf-plan.html (M4). Read the T13 block and the adapter flag table.
Reference read-only: fusion-harness core/launch.ts:105-131 (reviewed argv incl. the
explicit deny list), my-agentic-workflow/src/providers/claude-code.mjs (event shapes).

ENTRY: M3 is [x] (G3) — verify npm run test:sim green.

DO: adapters/claude-code.ts — buildSpec pure (byte-exact argv per the plan's table;
prompt on STDIN; system prompt via 0600 file; env allowlist) · parse() for stream-json
(init model, assistant deltas, tools, result, quota-shaped errors → E_QUOTA_EXHAUSTED
with reset, never retried) · costAuthority "unavailable" → "— subscription" ·
same-session correction continuity · ONE bounded live probe captured to
core/test/fixtures/providers/claude/ and replayed green.

DONE WHEN: descriptor tests byte-exact; parser green on CAPTURED fixtures; live probe
committed. Markers/metadata/Amendment per Conventions.
```

### T14 — Pi/Codex adapter

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:opus · /effort high   ← PREFERRED session (cross-building rule)
  GPT     codex:gpt-5.6-sol · reasoning high
  SHAPE   protocol parsing — LEVEL; assumptions concern GPT/PI, so prefer the Claude
          route to implement, or have Claude review before marking done.
  WHY     same as T13 with provider cost parsing on top (pi reports real cost).
  NOTE    EXACTLY ONE bounded live pi call, captured. --no-extensions is load-bearing.

Task T14 of specs/awsf-plan.html (M4). Read the T14 block and the adapter flag table.
Reference read-only: fusion-harness core/launch.ts:147-181 (reviewed pi argv).

ENTRY: M3 is [x]; T13 need not precede this — T13/T14 are parallel across sessions.

DO: adapters/pi-codex.ts — buildSpec pure (byte-exact argv incl. --no-extensions
--no-skills --no-prompt-templates --no-themes --no-context-files; prompt on STDIN) ·
parse() incl. usage/cost mapping (five metrics; reasoningRelation included-in-output
for pi; costAuthority "provider") · ONE bounded live probe captured to
core/test/fixtures/providers/codex/ and replayed green.

DONE WHEN: descriptor tests byte-exact; parser green on captured fixtures; probe
committed. Markers/metadata/Amendment per Conventions.
```

### T15 — Catalog, model identity, Antigravity probe

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  SHAPE   registry plumbing — LEVEL, mid tier.
  WHY     selectors are aliases, identities are evidence; the honest "blocked" state
          for agy is a five-line adapter and a well-documented procedure.
  NOTE    NO live agy call in this task (Q1 default). If the owner resolved Q1 to
          "verify now", the captured transcript arrives as an INPUT to this task.

Task T15 of specs/awsf-plan.html (M4). Read the T15 block and Questionable Q1.

ENTRY: T13 and T14 are [x].

DO: adapters/{catalog,registry}.ts (family-alias selectors; resolved identity from
stream evidence or "unknown"; provenance plumbed end-to-end) · antigravity.ts
(isAvailable → blocked + E_ADAPTER_UNVERIFIED; config-enable without verification
flag fails validation; header documents the exact verification procedure: run one
bounded agy session, capture raw output, read it, decide) · M4 milestone checklist.

DONE WHEN: the M4 checklist in the plan is fully green (this is M4's last task).
Flip T15 + the M4 header; metadata + Amendment.
```

### T16 — Worktrees and host-owned Git

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  SHAPE   git plumbing — LEVEL, mid tier with care on the fingerprint semantics.
  WHY     the change-set comparison must catch reversions (the real git-checkout
          incident), appearances, and deletions — not just modifications.

Task T16 of specs/awsf-plan.html (M5). Read the T16 block. Reference read-only:
super-simple-software-factory .claude/skills/sssf/templates/adws/adw_modules/
permissions.py:50-75 (the fingerprint mechanism being ported).

ENTRY: M4 is [x] — verify npm test green.

DO: git/{worktrees,changes,commit}.ts + land.ts scaffold — one worktree per attempt
under the Q8 root; create/list ONLY (no delete function exists anywhere) · change-set
fingerprint before/after (numstat + untracked; reversion counts as change) · host
commits with deterministic author · clean-before/clean-after around gates · staleness:
post-gate mutation invalidates prior gates and review.

DONE WHEN: fingerprint suite green incl. the reversion case; no-delete asserted by
the destructive-paths meta-test. Markers/metadata/Amendment per Conventions.
```

### T17 — Permission profiles, path policy, sandbox broker

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:opus · /effort high     ← NOT claude:sonnet (0% exploit-dev evals;
                                           this is write-boundary hardening)
  GPT     codex:gpt-5.6-sol · reasoning high
  SHAPE   security boundary work — CLAUDE-FAVOURED (adversarial correctness).
  WHY     a wrong answer here is a real safety defect: a breach must ABORT with named
          paths, never earn a correction; globs must not cross path separators;
          protected paths must hold against creative encodings.

Task T17 of specs/awsf-plan.html (M5). Read the T17 block and the breach card in
"Envelope & Gate Contract" (why a breach is not a gate violation).

ENTRY: T16 is [x].

DO: policy/{permission-profiles, path-policy, sandbox-broker, risk, redaction}.ts —
the seven layers wired: worktree · clean start · tool allowlist · OS sandbox grant
where available (Linux bwrap; darwin deferred to its machine) · post-run change-set
comparison · exact write-glob enforcement (* stops at separators) · canonical repo
outside the sandbox root · breach abort naming every offending path · writes:[] =
repo-read-only, session-runtime always writable · SandboxBadge tri-state surfaced ·
risk classifier (risk.paths → tier, operator override) · shared credential scrubber.

DONE WHEN: breach journey (stub writes outside globs) aborts naming paths with no
correction attempt; reviewer-writes:[] case green; redaction meta-test green.
Markers/metadata/Amendment per Conventions.
```

### T18 — The eleven gates

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:opus · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  SHAPE   checkers with recorded evidence — CLAUDE-FAVOURED, moderate depth.
  WHY     each gate needs positive AND negative coverage, and diff_matches_claims is
          exact set equality INCLUDING deletions — the one-directional hole is the
          named defect being closed.

Task T18 of specs/awsf-plan.html (M5). Read the T18 block and the eleven-gate table.

ENTRY: T16 is [x] (parallel with T17 across sessions is fine).

DO: gates/{interface, envelope, artifacts, git-diff, commands, review, journey}.ts —
GateReport.check(item, ok, note) recording EVERY check pass or fail · all eleven
gates per the table · signature negatives: undeclared change fails diff_matches_claims;
success-with-no-diff fails head_advanced; protected-path touch fails
no_protected_paths; accept-with-critical-finding fails verdict_consistent.

DONE WHEN: 11 × (positive + negative) suites green. Markers/metadata/Amendment.
```

### T19 — Phase engine, corrections, schema injection

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  SHAPE   the fusion's economic heart — CLAUDE-FAVOURED; top tier, do not economize.
  WHY     same-session corrections that provably cost tokens-not-calls, compile-time
          earned descriptions, host-rendered {previous_envelope}, retained invalid
          envelopes — every economic claim in the plan runs through this file set.

Task T19 of specs/awsf-plan.html (M5). Read the T19 block, "The Phase Contract" IN
FULL (pipeline + escalation ladder), and the correction-loop pseudocode.

ENTRY: T18 is [x] (T17 must also be [x] — the engine calls permissions.enforce).

DO: workflow/{compiler, engine, phase, corrections}.ts — earned-description rejection
at compile · success-must-be-earned · send → parse (≤2 in-session) → gate rounds →
correction request (phase+round · envelope ref · schema violations · gate checks with
bounded tails · remaining budget) into the SAME session (adapter+provider+model+
session identity asserted) · permissions.enforce AFTER the loop (breach aborts) ·
host diff capture + commit · envelope persistence (invalid retained w/ violations) ·
JSON Schema injection into compiled prompts · usage: spend accumulates, context
occupancy = last send.

DONE WHEN: engine suites green; correction provably budget-neutral; a transport
failure provably does NOT cold-restart a correction session. Markers/metadata/Amendment.
```

### T20 — The six recipes and the stub journeys

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high   ← slight GPT edge (long-horizon journeys)
  SHAPE   end-to-end journey construction — GPT-FAVOURED (Agents' Last Exam shape).
  WHY     G5 closes here: the whole economic story — correction, breach, inversion —
          must run on the stub at zero quota, or the pilots have no safety net.

Task T20 of specs/awsf-plan.html (M5). Read the T20 block and the M5 checklist.

ENTRY: T19 is [x].

DO: workflow/recipes/{scout, plan, build, plan-build-test, build-review,
simple-sdlc}.ts (data-shaped TS per Q4) · journeys: correction (injected gate fail →
same-session fix → no call spent → AWAITING_OWNER) · breach (abort naming paths,
reservation accounting correct) · T2 inversion (stub review opposite provider;
unavailability after one transport retry → BLOCKED, never a substitute) ·
workflow-min-fit rejection.

DONE WHEN: the M5 checklist in the plan is fully green (M5's last task): npm run
test:journeys + full npm test green, git status --porcelain clean. Flip T20 + the M5
header; metadata + Amendment. G4 and G5 are now satisfied.
```

### T21 — CLI and TTY-only landing through persisted LANDING

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  SHAPE   the human gate — CLAUDE-FAVOURED (adversarial correctness on the keystone).
  WHY     land must refuse non-TTY, show the exact SHA, persist LANDING, recover a
          crash unambiguously or block, and be reachable from exactly one call site.
          Every bypass is a HumanGateBypass by construction, not by convention.

Task T21 of specs/awsf-plan.html (M6). Read the T21 block, Lifecycle rows L19–L24,
and the rejection order (InteractiveOwnerRequired is step 8 for a reason).

ENTRY: M5 is [x] — verify npm test green.

DO: cli/{main, tty, commands/*}.ts — new · start · status · watch · land · cancel ·
retry · git/land.ts complete: TTY check (!process.stdin.isTTY refuses) → display
exact SHA + summary → confirm → transition L20 → persisted LANDING → FF preflight →
FF → verify HEAD == candidate + clean → L23 LANDED; non-FF/dirty → L24 BLOCKED with
ahead/behind counts · crash-mid-LANDING recovery unambiguous-or-blocks · status/watch
lines all actionable (state, round meter, call meter, resolved model + provenance,
last activity, next action).

DONE WHEN: human-gate journey green (throws for host/owner actors; refuses piped
stdin; ONE call site; no API route reaches it). Markers/metadata/Amendment.
```

### T22 — Doctor, rebuild, gc — deterministic and read-only

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  SHAPE   read-only diagnosis CLI — LEVEL, mid tier.
  WHY     doctor lists, never fixes; gc lists, never deletes; rebuild is the M2
          guarantee exposed as an operator command.

Task T22 of specs/awsf-plan.html (M6). Read the T22 block.

ENTRY: T21 is [x].

DO: awsf doctor (orphans by PID, lock states, degraded sessions, matrix status;
exit 0 healthy / exit 1 listing findings; MUTATES NOTHING) · awsf db rebuild (wraps
T8) · awsf gc (lists cleanup candidates only) · awsf dash (serves the built dashboard
or a clear not-built-yet message).

DONE WHEN: the M6 checklist in the plan is fully green (M6's last task), including
the by-hand stub SDLC start→land. Flip T22 + the M6 header; metadata + Amendment.
```

### T23 — Read-only API server

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  SHAPE   security surface — CLAUDE-FAVOURED. Keep this task OUT of any fan-out; it
          is the boundary the meta-test guards.
  WHY     loopback + Host/Origin + CSP + segment rejection + readonly connection +
          exactly one write route — each is a one-line mistake away from mattering.

Task T23 of specs/awsf-plan.html (M7). Read the T23 block and the API table in
"Observability Contract"/proposal §7.9. Reference read-only:
sssf apps/visualizer/server/index.ts:44-67 (safely() wrapper; segment rejection).

ENTRY: M6 is [x] — verify npm test green.

DO: api/{server, routes, responses, security}.ts + dashboard/shared/types.ts —
bind 127.0.0.1/::1 only · validate Host and Origin · strict CSP, zero remote assets ·
path segments /^[A-Za-z0-9._-]+$/ rejected outright, never sanitized · every handler
error-wrapped · readonly node:sqlite connection (archive write on its own lazy
connection) · routes exactly: health · sessions (embedded phases+agents) ·
sessions/:id · sessions/:id/phases/:phaseId · sessions/:id/events?after=&limit=
(rowid cursor, bounded) · settings · adapters · POST sessions/:id/archive ·
continuity refs and raw logs never exposed · THE no-write-route meta-test.

DONE WHEN: route suites + meta-test green. Markers/metadata/Amendment.
```

### T24 — Dashboard shell, sessions grid, polling

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  SHAPE   Vue against a fixed visual contract — LEVEL, mid tier; the contract does
          the thinking. Load IMG_3271 before writing a component.
  WHY     the grid IS the glass wall's first impression; fidelity to the screenshot
          grammar (cards, dot trails, chips, pills, +N overflow) is the acceptance.

Task T24 of specs/awsf-plan.html (M7). Read the T24 block and "Visual Design
Contract" (tokens verbatim; component table rows for the grid). Design spec:
IMG_3271.PNG in the screenshots directory named in the M7 milestone prompt.

ENTRY: T23 is [x].

DO: AppShell · TopNav (breadcrumbs, project badge) · LiveIndicator (green < 2×
poll_ms) · DegradedObservabilityBanner · SessionsGrid/SessionCard (lavender mono id,
workflow chain, 2-line request clamp, TimeRuler, MiniAgentTimeline colored by agent,
StateChip, PhaseDots, CallBudgetChip "calls n/m", MetricsRow cost+authority/duration/
tokens, "+N more agents") · usePolling (500ms live / 2s grid / 5s idle · exponential
backoff · immediate on focus).

DONE WHEN: vue-tsc green; display-correctness units green (— subscription, ≈+authority,
partial). Markers/metadata/Amendment.
```

### T25 — Session route: StateRibbon, swimlanes, OwnerGateCard

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  SHAPE   Vue against the contract — LEVEL; the two AWSF-only components carry the
          judgement, keep them in-session if fanning out the rest.
  WHY     StateRibbon renders the audit trail SSSF cannot have; OwnerGateCard must
          point at a terminal, never offer a button.

Task T25 of specs/awsf-plan.html (M7). Read the T25 block + component table rows.
Design spec: IMG_3271, IMG_3286, IMG_3309.

ENTRY: T24 is [x].

DO: SessionHeader (partial-cost note) · StateRibbon (DRAFT→…→LANDED from the
transitions table; actor + reason on hover) · AgentRoster/AgentCard (swatch,
ModelBadge with provenance distinction, ContextMeter rendering NOTHING when window
unknown, SandboxBadge tri-state) · SwimlaneChart (lanes per agent + code + engineer;
PhaseBlocks in agent color labeled by earned description; tool-density sparkline;
GateBadge cluster; commit pill) · OwnerGateCard (only in AWAITING_OWNER: diff stat,
gates, verdict, exact candidate SHA, the terminal command, the prominent
landing-happens-in-a-terminal note).

DONE WHEN: component suites green; no color-only state anywhere. Markers/metadata/
Amendment.
```

### T26 — Drawer, event log, settings, accessibility

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  SHAPE   Vue + a11y polish — LEVEL, mid tier.
  WHY     the drawer is the deep-inspection surface (IMG_3291/IMG_3286); reduced
          motion and focus management are contract rows, not niceties.

Task T26 of specs/awsf-plan.html (M7). Read the T26 block + animation inventory +
accessibility rules. Design spec: IMG_3291, IMG_3286, IMG_3309, IMG_3316.

ENTRY: T25 is [x].

DO: PhaseDetailDrawer (spring slide-up 280ms, focus trap + restore) · PhaseInspector
(AgentConfig · compiled Prompts with line counts · Gates with checks · Usage ·
Envelope all rounds incl. invalid-retained) · EventLog (monospace; timestamp · type ·
command/path · duration; tool_call cyan, agent_start violet; cursor paging) ·
SettingsRoute (EffectiveConfig redacted · AdapterHealth · DatabaseHealth) · every
animation inside prefers-reduced-motion · keyboard nav + visible focus.

DONE WHEN: the M7 checklist in the plan is fully green (M7's last task), including
the by-hand live-before-complete run. Flip T26 + the M7 header; metadata + Amendment.
```

### T27 — Portability matrix, per machine

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:opus · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium   ← slight GPT edge (operational driving)
  SHAPE   run-observe-record on real machines — GPT-FAVOURED, but mostly discipline.
  WHY     G7: a cell filled from the wrong machine is worse than PENDING — it is the
          silent-failure pattern coming back as documentation.

Task T27 of specs/awsf-plan.html (M8). Read the T27 block and "Portability Matrix"
IN FULL including its filling rule. Runs ON each machine, FROM that machine.

ENTRY: M7 is [x]. This task re-runs per machine: WSL2 now; the Linux desktop and the
M5 MacBook Pro each when available; Windows-native for dashboard/read-only rows only.

DO (per machine): npm run test:contract && npm run test:sim locally · fill each
matrix cell in specs/awsf-plan.html with date + the command evidence reference ·
update the README portability table to point at the matrix · leave unowned machines'
cells PENDING with the machine named.

DO NOT fill any cell from another machine. DO NOT claim native-Windows write parity.

DONE WHEN: every cell for machines you own today is filled-or-explicitly-deferred.
Markers/metadata/Amendment (one Amendment per machine run).
```

### T28 — Packaging, docs, and script reconciliation

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:sonnet · /effort low
  GPT     codex:gpt-5.6-terra · reasoning low
  SHAPE   docs + one meta-test — LEVEL, cheapest of M8.
  WHY     "canonical package scripts are the validation interface" only holds if a
          test forces every documented command to exist for real.

Task T28 of specs/awsf-plan.html (M8). Read the T28 block and the Validation section.

ENTRY: T27 has run at least on the development machine.

DO: README (usage · install · the portability table linking the matrix) · justfile
targets wrapping npm scripts (never a second truth) · the doc-reconciliation test:
extract every `npm run` / `awsf` / `just` command from README + the plan's Validation
section, assert each exists in package.json / the CLI command table / the justfile.

DONE WHEN: reconciliation test green; README makes no platform claim the matrix
doesn't back. Markers/metadata/Amendment.
```

### T29 — Pilot 1: a real T1 task

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:opus · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium   ← slight GPT edge (long-horizon driving)
  SHAPE   operational driving of the real factory — GPT-FAVOURED for the DRIVING
          session; the WORKER provider inside the pilot is the OWNER's recorded choice.
  WHY     first real work: the ceilings, the landing, and the cost counting must
          survive contact with a task that was not designed for them.
  NOTE    HARD CEILING: ≤ 3 calls. The driving session never overrides the owner's
          worker-provider choice and never consults quota to pick it.

Task T29 of specs/awsf-plan.html (M8). Read the T29 block.

ENTRY: T28 is [x]. The owner has named: a small, easily-reversible real task, the
target repo, and the worker provider (recorded, not inferred).

DO: drive `awsf new …`, then `awsf start …`, then `awsf run …` for the owner's
task via build or plan-build-test · watch on the dashboard · owner runs
`awsf land …` via TTY · write records/pilots/pilot-1.md: task, route, calls by
category, tokens, duration, gates, outcome — concise, no receipt sprawl.

DONE WHEN: landed via TTY; calls ≤ 3 counted and categorized; dashboard showed it
live; nothing deleted. Markers/metadata/Amendment.
```

### T30 — Pilot 2: the live T2 binding, then a real T2 task with opposite-provider review

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:opus · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  SHAPE   operational driving — GPT-FAVOURED for the driving session, EXCEPT when the
          pilot's own worker runs on GPT: the driving session is the larger consumer
          by far, and starving the worker's pool blocks a leg D16 forbids rerouting.
  WHY     G6 closes here: the end-user journey against the exact candidate SHA and
          the live review inversion are the two things no stub can prove.
  NOTE    THE INTERNAL PAIRING IS FIXED BY DESIGN: whichever provider builds, the
          other reviews. That inversion IS the experiment — do not substitute, do not
          soften a routing failure into a same-provider review. HARD CEILING: ≤ 5 calls
          for PART 2. PART 1 is hand-built and spends none.

Task T30 of specs/awsf-plan.html (M8). Read the T30 block and D10.

ENTRY: T29 is [x]. Owner has named a genuinely tricky task + worker provider.
The live tier-2 production binding does not exist: T20 proved the inversion on
stubs and acceptance scoped the delivered production seam to T1, so `awsf run`
and `awsf rework` refuse a tier-2 recipe and review-routing, verdict_consistent,
and journey_passes are imported by nothing outside core/test.

DO — PART 1, by hand, zero AWSF calls: admit tier-2 recipes and stop hardcoding
tier in persisted transitions · route the reviewer phase through
runMandatoryReview/oppositeProvider, never adapter config alone · apply
verdict_consistent to the review envelope · write sessions.review_provider and
review_verdict, which the dashboard already reads · source requiredReviewPresent
and journeyApproved from measured evidence instead of constants · journeys for
each, incl. inversion blocking after one transport retry, a refused stale journey
SHA, and a refused landing when the review is absent.

DO — PART 2: drive build-review or simple-sdlc · record the end-user journey
BEFORE the build and run it against the exact candidate SHA (journey_passes gate)
· owner reads findings, lands via TTY (or exercises L19 rework — also a valid
pilot outcome) · write records/pilots/pilot-2.md incl. whether the review found
anything the gates did not (the first datum for the review-yield question).

DONE WHEN: the M8 checklist AND the plan's Validation section rows this pilot proves
are green; calls ≤ 5; review provider provably inverse of worker in the record.
Flip T30 + the M8 header; metadata + Amendment. AWSF is adopted.
```

### T31 — Ticket contract and file-backed store

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  SHAPE   schema authoring against an existing corpus — LEVEL.
  WHY     the shape is already fixed by thirty real files; the work is encoding it
          once so validator, type, and JSON Schema cannot drift apart.

Task T31 of specs/awsf-plan.html (M9). Read the T31 block, "Envelope & Gate
Contract" (the one-source rule), and specs/tickets/README.md.

ENTRY: M8 is [x]. specs/tickets/ holds the corpus.

DO: core/src/contracts/ticket.ts — TypeBox Ticket (id, title, milestone, tier,
state, depends_on, workflow, outcome, context, acceptance, non_goals) yielding
runtime validator + static type + JSON Schema from ONE source ·
core/src/persistence/ticket-store.ts — frontmatter read/write, no database.

DO NOT give the store a SQLite table, a cache, or an index — the files are the
store. DO NOT repair an invalid ticket silently.

DONE WHEN: every ticket in specs/tickets/ validates · invalid tickets retained with
violations · depends_on cycles rejected at load · the sqlite-write fence and
ticket-plan-sync meta-tests still green. Flip T31; metadata + Amendment.
```

### T32 — The intake recipe and awsf ticket

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:opus · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  SHAPE   prompt and recipe design with a write boundary — CLAUDE-FAVOURED slightly;
          the judgement is in what a good ticket contains, not in the plumbing.
  WHY     this is the first agent AWSF runs that writes into its OWN repository, so
          its writes glob is the entire safety argument.

Task T32 of specs/awsf-plan.html (M9). Read the T32 block, "The Phase Contract",
and T17's path policy.

ENTRY: T31 is [x].

DO: core/src/workflow/recipes/intake.ts (request → intake, T0) ·
prompts/intake/{system.md, user.md} with the JSON Schema injected at compile time ·
awsf ticket new | refine | list | show.

DO NOT hand-write the schema into the prompt (the no-handwritten-schema meta-test
bites). DO NOT give the intake agent a writes glob beyond specs/tickets/**.

DONE WHEN: intake output is a validated Ticket · invalid retained with violations ·
the writes glob is specs/tickets/** and nothing else, proven by T17's path policy
rather than by prompt wording · the recipe fits the T0 ceiling and the compiler
rejects it if it cannot · the earned-description rule fires. Flip T32; metadata +
Amendment.
```

### T33 — awsf backlog and the board route

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  SHAPE   one read endpoint plus one Vue route against a fixed component contract —
          LEVEL.
  WHY     the only trap is scope: a board invites buttons, and this one may not have
          a single one.

Task T33 of specs/awsf-plan.html (M9). Read the T33 block, the Visual Design
Contract's two M9-reserved component rows, and T23's route table.

ENTRY: T32 is [x].

DO: awsf backlog (read-only; counts by state/milestone/tier plus the ready set) ·
GET /api/v1/tickets · the /backlog route with BacklogBoard, TicketCard,
BacklogMetricsRow · extend the no-land-route meta-test to cover the new surface.

DO NOT add any write endpoint, action, or button. DO NOT compute the ready set
twice — one query, two renderers.

DONE WHEN: CLI and route report identical counts and identical ready sets ·
no-land-route meta-test green WITH /backlog present · projected cost carries its
authority label and says partial when mixed, never $0.00. Flip T33; metadata +
Amendment.
```

### T34 — Pull-request-shaped landing summary

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  SHAPE   a small change to the most safety-bearing command in the system —
          CLAUDE-FAVOURED.
  WHY     awsf land is the human gate. The diff is tiny; the invariant it must not
          break is the largest one in the plan.
  NOTE    Q10 is DECIDED: no push, no remote, no network. If the implementation
          reaches for a remote, it has misread the task.

Task T34 of specs/awsf-plan.html (M9). Read the T34 block, Q10 IN FULL,
"Explicitly Not Built", and T21's landing implementation.

ENTRY: T33 is [x].

DO: awsf land additionally writes landing-summary.md into the attempt directory —
Problem · Changes · Verification · Risks — rendered on the OwnerGateCard · plus the
M9 Testing Strategy checklist.

DO NOT add a push, remote, fetch, or network call of any kind. DO NOT make the
summary a gate: it is a record, and failing to write it must never block a landing
the human already approved.

DONE WHEN: the M9 checklist is green · the M1 no-push/no-destructive-paths string
scan passes UNCHANGED · the journey test (vague intent → ticket → ready → stub run)
passes on the stub adapter with zero spend. Flip T34 + the M9 header; metadata +
Amendment.
```

### T35 — The owner-adjustable call ceiling

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  SHAPE   a normative change to how spend is bounded — CLAUDE-FAVOURED.
  WHY     the ceiling decides whether the reviewer-to-builder loop is affordable
          at all. Getting it wrong either strands an attempt that was nearly
          finished or hands an agent an unbounded budget.
  NOTE    the defect is measured in the 2026-08-16 pilot-2 Amendment, not assumed.

Task T35 of specs/awsf-plan.html (M10). Read the T35 block, the M10 block, the
2026-08-16 pilot-2 Amendment IN FULL, core/src/state/tiers.ts,
core/src/config/schema.ts, and the configuration-snapshot comparison in
core/src/cli/commands/{rework,review}.ts.

ENTRY: M8 is [x].

DO: make the tier ceiling an owner-set number with a configured default —
ceilingFor resolves from the effective configuration instead of the hardcoded
CALL_CEILINGS constant, and the VALID_TIER_CEILINGS three-value allowlist is
deleted so risk.call_ceiling becomes a real dial. Then add a TTY-only owner act
that RAISES a named task's ceiling while its attempt is live, recording the grant
and the owner's written reason in the journal.

DO NOT make the raise a configuration edit. An attempt's recorded configuration
snapshot is compared before rework and review, so editing awsf.config.yaml
mid-attempt would lock the owner out of the very acts the raise was for. DO NOT
remove the ceiling, DO NOT allow an unbounded grant, DO NOT let a grant for one
task widen another, and DO NOT let a non-interactive caller take it.

DONE WHEN: the M10 T35 checklist is green · a raise is journalled, bounded and
task-scoped · an attempt that halted at its ceiling resumes after a raise with no
configuration-snapshot mismatch, proved by a journey rather than by inspection ·
fitsCeiling and assertWorkflowFitsTier keep their semantics and the T0/T1/T2
defaults are unchanged. Flip T35; metadata + Amendment.
```

### T36 — Owner rework at tier 2

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  SHAPE   completing a half-written branch in the owner's correction path —
          CLAUDE-FAVOURED.
  WHY     the lifecycle already forks correctly; only the command is missing its
          second branch, and the missing half is the reviewer-to-builder loop the
          T2 tier exists for.
  NOTE    the defect is measured in the 2026-08-16 pilot-2 Amendment, not assumed.

Task T36 of specs/awsf-plan.html (M10). Read the T36 block, the M10 block, the
2026-08-16 pilot-2 Amendment IN FULL, core/src/state/guards.ts (L11 and L12), and
core/src/cli/commands/{rework,review,production-run}.ts.

ENTRY: M8 is [x].

DO: let awsf rework serve a tier-2 attempt. The lifecycle already demands the
shape — L11 requires tier >= 2 out of GATING and L12 forbids it — while rework.ts
hardcodes the T1 branch and refuses every other tier. After the builder phase and
its host gates, a T2 rework must take L11, re-compose the review context, run the
opposite-provider review, and take L15 back to AWAITING_OWNER. Persist a
TestOutput envelope for the new candidate; without one the reviewer is handed
retained evidence naming the superseded candidate and refuses. Extract the review
half of awsf review into one module both commands call, and generation-qualify
and round-scope the rework's review artefacts.

DO NOT relax the tier fork. DO NOT let a reworked T2 candidate reach landing
without a review bound to that exact revision. DO NOT brief the reviewer on the
owner's defect statement or on the superseded verdict — the builder gets the
defect, the reviewer gets the candidate. DO NOT renegotiate the T1 branch.

DONE WHEN: the M10 T36 checklist is green · a T2 rework spends builder plus
review and returns to AWAITING_OWNER with a review bound to the new candidate ·
headroom is refused before anything is spent · the existing T1 rework journeys
pass UNCHANGED. Flip T36 + the M10 header; metadata + Amendment.
```
