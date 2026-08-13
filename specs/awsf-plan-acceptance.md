# AWSF — Acceptance Checklist

Companion to [`awsf-plan.html`](./awsf-plan.html) and [`awsf-plan-build-prompts.md`](./awsf-plan-build-prompts.md). Created 2026-08-04 by claude-fable-5.

Every row is a **claim** paired with the **mechanism that proves it** — a named test, a named command, or a named grep. A row is checked only when its mechanism has actually run and passed; a row that turns out to be impossible as written is marked `[f]` with the design correction recorded in the plan's Amendments, never quietly reworded. Rows are tagged by the milestone whose Definition of Done owns them. Nothing here has been executed yet — this file is authored at M0, before any code exists.

Conventions: test paths are relative to the repository root; `unit | contract | sim | journeys` refer to the canonical scripts `npm run test:unit` etc. created in T1. Where a row names a specific test file, T-tasks must create exactly that file (renames are plan amendments).

---

## Lifecycle contract (M1)

- [ ] **All 24 legal transitions succeed** with their guards satisfied, enumerated literally from the plan's L-table. — `unit: core/test/unit/transitions.test.ts` generates the 10×10 matrix and asserts exactly 24 accepts.
- [ ] **All 76 illegal ordered pairs throw**, each with the **correct error**: 27 `TerminalAttempt`, 10 `AlreadyInState`, 6 `HumanGateBypass`, 33 `IllegalTransition`. — same suite, class→error map asserted pair by pair.
- [ ] **The 11-step rejection order is a contract**: for every adjacent pair of rejection classes, an input violating both raises the earlier one. — `unit: core/test/unit/rejection-order.test.ts`.
- [ ] **`AWAITING_OWNER` has no timeout**: no clock-driven path can produce `AWAITING_OWNER → BLOCKED`; only `reason.source === 'record'` with codes {record-corrupt, unknown-state, ambiguous-pid, unreadable-worktree}. — `unit: evidence guards` + a clock-injection negative test.
- [ ] **A style note cannot authorize rework**: L16 requires ≥ 1 finding of severity ≥ medium with both `file` and `detail`. — `unit: core/test/unit/actors.test.ts`.
- [ ] **Task-edge spawn is legal on exactly five edges** (L4, L10, L11, L16, L19); every other task-state pair attempting one raises `IllegalSpawnSite`. — `unit` + `sim` (broker-level assertion in M3).
- [ ] **A later ordinary compiled agent phase launches without a fake `RUNNING → RUNNING` transition** only while durable task state is `RUNNING`, through an exact workflow/phase/ordinal + configured adapter/role verifier and one held reservation. Wrong state, unknown/local/mismatched phase, task-edge-only review/rework, missing reservation, malformed registration, absent verifier, and verifier equivocation create no child; a valid second agent process spends on `GO`. — `unit: core/test/unit/execution/phase-launch-authorization.test.ts` + `sim: core/test/simulation/phase-launch-authorization.test.ts`.
- [ ] **An intra-phase correction does not increment `calls_spent`; a `GATING → RUNNING` transition does.** — `unit: core/test/unit/ceilings.test.ts` + `journeys` correction journey.
- [ ] **A registration failure returns the reservation.** — `unit: call-budget` + `sim: barrier registration-failure case`.
- [ ] **Spend carries across attempts of the same task; composite adapters declare full cost in advance; a workflow whose minimum call count cannot fit the tier is rejected before execution.** — `unit: ceilings + call-budget suites`.
- [ ] **The state layer is pure**: `core/src/state/` imports nothing impure (no child_process, fs, net, sqlite, adapters, git). — `unit: import-fence meta-test`.

## Persistence and truth (M2)

- [ ] **The journal is append-only**: after any 10 further transitions, the prior byte prefix of `journal.jsonl` is byte-identical. — `unit: byte-prefix test`.
- [ ] **A reader never observes a partial `status.json`** under 500 concurrent reads during 500 writes. — `unit: status-store concurrency test`.
- [ ] **Sealed attempts refuse writes** (`SealedAttempt`) once terminal. — `unit`.
- [ ] **Crash anywhere in the write protocol recovers exactly or blocks**: a kill injected between every pair of protocol steps yields deterministic reconstruction where unambiguous and `BLOCKED` naming the exact bad key where not; corrupt files retained byte-identical. — `sim: crash-injection matrix`.
- [ ] **Delete `awsf.db`, run `awsf db rebuild`, and every dashboard view is byte-identical; the prior file is retained, not deleted.** — `sim: rebuild-identity test` (query-level comparison over every API read).
- [ ] **Corrupt the SQLite file mid-run: the task keeps running**, a `sqlite-projection-failed` notice appears, the session is flagged `observability_degraded`, and it **cannot advance past `GATING`** until rebuild succeeds. — `sim: degraded-mode test`.
- [ ] **The projector is idempotent**: re-applying any journal event is a no-op. — `sim/unit: double-apply test`.
- [ ] **Startup refuses a database newer than the binary** (`user_version` ahead). — `unit: migration refusal test`.
- [ ] **Only the projector and migrations write to SQLite.** — `unit: sqlite-write fence meta-test`.

## Execution kernel (M3)

- [ ] **Kill the host between registration and release: no provider process exists** — and the stub's side-effect file proves the provider command never ran. — `sim: kill-host barrier test`. *Platform rows re-proven per machine in T27.*
- [ ] **Cancel a run with a grandchild: the grandchild is reaped and survivors are reported truthfully.** — `sim: grandchild cancellation test`.
- [ ] **A supervisor that cannot enumerate survivors errors — it never returns `[]`.** — `contract: forced-enumeration-failure test against every platform port`.
- [ ] **The silence window trips on process/output inactivity only** — never on conversational markers; a record-update failure also trips termination. — `sim: liveness monitor tests`.
- [ ] **Only `transport-broker.ts` imports `node:child_process`; adapters never spawn or `fetch`.** — `unit: architecture fence meta-tests`.
- [ ] **A recycled PID is never killed by mistake** (`process_start_identity` checked before any signal). — `sim`.
- [ ] **LineFramer survives chunk boundaries mid-code-point with per-instance decoders; abrupt EOF yields a visible malformed tail; framing reads past the output budget so terminals stay observable.** — `unit: stream suites`.
- [ ] **Exactly one terminal event per run; tools are settled explicitly before a cancellation terminal; provider tool IDs never appear (host mints `t1, t2, …`).** — `unit: sequencer suites`.
- [ ] **An unrepresentable model identity fails closed** (`E_MODEL_UNRESOLVED`), never silently resolves. — `unit`.

## Adapters (M4)

- [ ] **No prompt ever rides argv** — descriptor tests are byte-exact and a grep test over `core/src` finds no prompt-bearing argv construction. — `unit`.
- [ ] **Env is an allowlist plus post-filter injection; an allowlisted key holding credential-shaped bytes is a hard `E_REDACTION` error.** — `unit: filterEnv suites`.
- [ ] **Both real adapters parse captured real fixtures** obtained from exactly one bounded live probe each, committed under `core/test/fixtures/providers/{claude,codex}/` — never invented from the assumption under test. — `unit` + fixture provenance note in each fixture directory.
- [ ] **A Claude-routed phase renders `— subscription`, never `$0.00`; a pi-routed phase carries provider-reported cost; a mixed total is labelled *partial*.** — `unit: cost-authority display tests` (+ dashboard rules in M7).
- [ ] **Quota exhaustion blocks with the reset time — it is never a retry and never a substitution.** — `unit: adapter error mapping` + `journeys`.
- [ ] **`antigravity.isAvailable()` returns `blocked` with `E_ADAPTER_UNVERIFIED`; enabling it without the verification flag fails config validation.** — `unit`.
- [ ] **Model identity provenance (`stream-authoritative` vs `route-attributed`) is recorded end-to-end.** — `unit` + `agent_sessions.model_provenance` column populated in `sim`.

## Workflows, gates, permissions (M5)

- [ ] **An agent that changes a file it did not declare fails `diff_matches_claims`** — exact set equality **including deletions**. — `unit: gate negatives`.
- [ ] **An agent that reports success with no diff fails `head_advanced`.** — `unit`.
- [ ] **An agent touching a protected path fails `no_protected_paths`.** — `unit`.
- [ ] **A reviewer configured `writes: []` that edits a repo file aborts the phase and names the path — it does not get a correction attempt.** — `journeys: breach journey`.
- [ ] **A reversion counts as a modification** (the `git checkout` case): the before/after change-set fingerprint catches it. — `unit: changes.ts fingerprint suite`.
- [ ] **Gates record every check whether or not it passed** (`checks_json` non-empty on green gates). — `unit: GateReport suites`.
- [ ] **The earned-description rule fires at workflow compilation**: a blank or name-restating description is a construction-time error. — `unit: compiler suite`.
- [ ] **Corrections re-enter the same adapter, provider, model, and provider session** — identity asserted; a transport failure does not cold-restart a correction session. — `unit: corrections suite` + `journeys`.
- [ ] **The stub correction journey runs end to end at zero quota**: injected gate failure → same-session correction (no call spent) → pass → host commit → exact candidate SHA gated → `AWAITING_OWNER`. — `journeys`.
- [ ] **The real T1 production command seam is zero-quota verifiable**: `build` uses one registered call, `plan-build-test` uses two separately registered calls, dashboard projection sees `RUNNING` before completion, host request/test envelopes and exact candidate gates reach `AWAITING_OWNER`, and unsupported/unavailable/continuity-mismatch/unimplemented-multi-turn/registration/schema/permission/gate/command/projector negatives fail closed with no fallback or held reservation. A process-backed case uses the real `ProcessTransportBroker`, gated launcher, and captured-stream pi parser fixture to prove durable registration and spend before provider start, exact machine-local command evidence, one-count usage, API path privacy, and no residue. — `journeys: core/test/journeys/production-runner.test.ts`.
- [ ] **Mandatory review unavailability after one transport retry blocks — never a substitute provider, never a quieter tier.** — `journeys: inversion journey`.
- [ ] **`verdict_consistent` holds**: `accept` with a high/critical finding fails; `concern` without a concrete finding fails; reviewed SHA must equal candidate. — `unit`.
- [ ] **The JSON Schema injected into every agent prompt is emitted from the TypeBox source** — a meta-test greps `prompts/` and compiled prompts for handwritten schema blocks and fails on any. — `unit`.
- [ ] **Invalid envelopes are retained with violations** and visible in the trace (never silently repaired or discarded). — `unit` + `sim projection`.
- [ ] **No worktree delete function exists anywhere.** — `unit: no-destructive-paths meta-test`.

## Owner controls (M6)

- [ ] **`awsf land` with stdin not a TTY refuses.** — `journeys: piped-stdin refusal test`.
- [ ] **`AWAITING_OWNER → LANDED` is un-bypassable**: throws for host and owner actors, succeeds only for an interactive human, and `transition(…, 'LANDING')` has exactly one call site (grep-asserted). — `journeys: human-gate test`.
- [ ] **Crash mid-`LANDING`: recovery is unambiguous, and an ambiguous recovery blocks** (`L24`), with ahead/behind counts reported on non-FF. — `sim: landing crash test`.
- [ ] **`LANDED` only when canonical `HEAD` equals the exact candidate SHA and the checkout is clean.** — `journeys: landing verification`.
- [ ] **No push path exists anywhere in `core/src`.** — `unit: no-destructive-paths meta-test` (push patterns).
- [ ] **`awsf doctor` is read-only**: exit 0 healthy; exit 1 listing an injected orphan by PID; mutates nothing (tree hash identical before/after). — `sim: doctor test`.
- [ ] **`awsf gc` lists candidates and deletes nothing.** — `unit` + tree-hash assertion.
- [ ] **`awsf retry` mints attempt n+1 at `DRAFT`, carries spend forward, and is not modelled as a transition out of a terminal state.** — `unit` + `journeys`.

## API & dashboard (M7)

- [ ] **Grep the API route table: no landing, approval, retry, cancel, or config-mutation route exists.** — `unit: no-write-route meta-test` (fails on any verb beyond the seven reads + archive).
- [ ] **The server binds loopback only, validates `Host` and `Origin`, serves a strict CSP with zero remote assets, and rejects (never sanitizes) invalid path segments.** — `unit: security suites`.
- [ ] **The API reads on a `readonly` SQLite connection; the single archive write uses its own connection.** — `unit` + connection-mode assertion.
- [ ] **Private continuity references and raw provider logs are never present in any API response.** — `unit: redaction sweep over every route's response shape`.
- [ ] **Context meters render nothing when the denominator is unknown; costs never render as bare numbers; mixed totals say *partial*; `route-attributed` identity is visually distinct; sandbox states are exactly the tri-state.** — `unit: display-correctness component tests`.
- [ ] **A live stub run is visible in the dashboard before it completes**, and SQLite remains in WAL throughout. — by-hand M7 acceptance run, recorded in the plan's Amendment for T26.
- [ ] **Every animation honors `prefers-reduced-motion: reduce`.** — `unit: component tests toggling the media query`.

## Meta / architecture (checked continuously from M1)

- [ ] **The dependency allowlist matches both `package.json` files exactly.** — `unit: allowlist meta-test`.
- [ ] **No `shell: true` anywhere.** — `unit meta-test`.
- [ ] **No credentials in journals, SQLite, API responses, or fixtures.** — `unit: credential-pattern sweep`.
- [ ] **No runtime artifacts, receipts, manifests, or digest files are committed.** — `unit: junk-drawer meta-test`.
- [ ] **`core/` loads under bare Node type-stripping with no build step.** — `node --experimental-strip-types core/src/state/task-machine.ts` in CI script.
- [ ] **The full stub-adapter journey suite runs end to end with zero quota spend.** — `journeys` executed with no provider CLIs on PATH (environment-asserted).
- [ ] **Tests never leave the repository dirty.** — `git status --porcelain` empty after `npm test`.
- [ ] **Every command documented in README and the plan's Validation section exists as a real package script / CLI command / just target.** — `unit: doc-reconciliation test (T28)`.

## Platform & pilots (M8)

- [ ] **The portability matrix has been filled on each machine it names, from that machine** — per-cell dates and command evidence; no cell filled remotely; macOS cells stay `PENDING` until the Mac runs them locally. — matrix cells in `specs/awsf-plan.html` + per-machine Amendment entries.
- [ ] **The kill-host and grandchild proofs pass on every write-capable platform, run locally.** — `sim` + `contract` executed per machine in T27.
- [ ] **Native Windows makes no write-capable claim**: write rows recorded BLOCKED-by-design; dashboard and read-only rows only. — matrix + README consistency check.
- [x] **Pilot 1 landed a real T1 task with ≤ 3 calls, counted and categorized, via TTY landing.** — `records/pilots/pilot-1.md` + journal evidence.
- [ ] **A tier-2 recipe reaches a provider through the real command path.** `awsf run` and `awsf rework` accept `build-review`/`simple-sdlc` on a tier-2 attempt, and no persisted transition carries a hardcoded tier. — `journeys: T2 production path` + `unit: tier/recipe agreement`.
- [ ] **The review provider is chosen by inversion, not by configuration.** The reviewer phase resolves through `oppositeProvider`; an adapter configuration that disagrees raises `InvalidReviewInversion`; unavailability after one transport retry blocks and no substitute is attempted. — `journeys: inversion journey through the real command`.
- [ ] **The inversion is provable after the fact.** `sessions.review_provider` and `sessions.review_verdict` are written by the production path, not merely read by the dashboard. — `unit: projection writer` + a landed session row.
- [ ] **The T2 landing guards receive evidence, never constants.** `requiredReviewPresent` reflects a completed opposite-provider review and `journeyApproved` reflects a `journey_passes` report whose journey ran, passed, and named the exact candidate SHA. — `journeys: landing refused with no review; landing refused on a stale journey SHA`.
- [ ] **Pilot 2 landed a real T2 task with ≤ 5 calls; the review provider is provably the inverse of the worker provider in the session record; the end-user journey ran against the exact candidate SHA.** — `records/pilots/pilot-2.md` + `sessions.review_provider` vs `worker_provider` + `journey_passes` gate row.
- [ ] **Nothing was deleted and nothing was pushed during either pilot.** — journal sweep + `git reflog` of the target repo.

---

*A row proven impossible as written is marked `[f]` here, with the design correction recorded as a plan Amendment — evidence is never fabricated to satisfy a checklist.*
