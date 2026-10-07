// Sealed historical references only. No runtime file or provider output is a fixture.
// Sources: W02 Notes, W01 Notes and 2026-10-07 Amendments, the forensics
// draft dated 2026-10-01, and gotchas.md's Live table. G02-S is still required.
// An observation date is NOT a claimed terminal timestamp. The published plan
// omits exact dates for its newer rows; do not invent them or infer them from Git.
export type SeedOutcome = "refused" | "gap" | "fixed" | "after-spend" | "owner" | "unexplained" | "not-a-stop";
export type SeedSource =
  | { readonly project: string; readonly task: string; readonly attempt: number }
  | { readonly gotcha: string };
export interface Seed {
  readonly id: string;
  readonly source: SeedSource;
  readonly date: string;
  readonly dateBasis: "terminal-day" | "observation";
  readonly recordedBlockerCode: string | null;
  readonly family: string | null;
  readonly outcome: SeedOutcome;
  readonly evidence: string;
  readonly replay: string | null;
  readonly pendingTask: "T08" | "T09" | "T10" | "T11" | "T12" | null;
}

function stop(id: number, task: string, attempt: number, day: string | null, code: string, family: string | null,
  outcome: SeedOutcome, evidence: string, replay: string | null = null, pendingTask: Seed["pendingTask"] = null,
  project = "agentic-workflow-software-factory"): Seed {
  return { id: `S${String(id).padStart(2, "0")}`, source: { project, task, attempt },
    date: day === null ? "2026-10-07" : `2026-${day}`, dateBasis: day === null ? "observation" : "terminal-day",
    recordedBlockerCode: code, family, outcome, evidence, replay, pendingTask };
}
function gotcha(id: string, family: string | null, outcome: SeedOutcome, evidence: string,
  replay: string | null = null, pendingTask: Seed["pendingTask"] = null): Seed {
  return { id, source: { gotcha: id }, date: "2026-10-07", dateBasis: "observation",
    recordedBlockerCode: null, family, outcome, evidence, replay, pendingTask };
}

export const SEEDS: readonly Seed[] = [
  stop(1, "pilot-1-sandbox-survey", 1, "08-11", "phase-abort", "T6", "after-spend", "Draft: test and typecheck exited 1; no evidence those commands were red at the base, rather than on the candidate."),
  stop(2, "pilot-1-sandbox-survey", 2, "08-11", "cancel", null, "unexplained", "Draft: no reason recorded."),
  stop(3, "pilot-1-sandbox-survey", 3, "08-11", "cancel", null, "unexplained", "Draft: no reason recorded."),
  stop(4, "pilot-1-sandbox-survey-claude", 1, "08-12", "cancel", null, "unexplained", "Draft: cancelled in builder, no recorded reason."),
  stop(5, "backlog-plan-cards", 1, "08-29", "phase-abort", "T5", "fixed", "1aafbe5 inverts against the builder, not planner; core/test/journeys/production-runner.test.ts: simple-sdlc accepts planner=A, builder=B, reviewer=A before launch."),
  stop(6, "backlog-plan-view", 1, "08-30", "phase-abort", null, "after-spend", "Draft: planner exhausted corrections on envelope_valid; the envelope exists only after its call."),
  stop(7, "backlog-plan-view-2", 1, "08-30", "phase-abort", null, "after-spend", "Draft: planner failed artifacts_exist and files_non_empty after producing its declarations."),
  stop(8, "dashboard-backlog-plan-view", 1, "08-31", "permission-breach", "T3", "after-spend", "Draft: documenter wrote protected docs/driving/.../gotchas.md; no pre-call declaration of that write is recorded. Its docs/** role is not permission to write protected content."),
  stop(9, "dashboard-backlog-plans", 1, "08-31", "review-malformed", null, "after-spend", "Draft: reviewer terminal gate failure; review output requires a call."),
  stop(10, "backlog-plan-grouped-view", 1, "09-02", "phase-abort", null, "after-spend", "Draft: planner emitted no valid envelope."),
  stop(11, "backlog-plan-grouped-view", 2, "09-02", "phase-abort", "T1", "gap", "ExecutableNotFound claude; name-only isAvailable admits an absent executable and the stub GO is reached (launch replay).", "launch", "T08"),
  stop(12, "backlog-view-corrections", 1, "09-03", "phase-abort", "T5", "after-spend", "Draft: rework aborts on credential-shaped gate output. reworkPrompt in rework.ts carries no prior gate output; credentialSafeText(rawCommandOutput) runs after the builder call. core/test/traps/replay/rework-after-spend.test.ts pins BLOCKED only after one GO and fresh gate output, not a pre-call retained input."),
  stop(13, "backlog-controls-and-redaction", 1, "09-03", "cancel", null, "unexplained", "Draft: no reason recorded."),
  stop(14, "backlog-literal-selection-and-masking", 1, "09-03", "phase-abort", "T5", "after-spend", "Draft: same credential-shaped rework gate-output failure as S12 six hours later; core/test/traps/replay/rework-after-spend.test.ts pins the same fresh-output failure after one call."),
  stop(15, "sessions-workflow-and-state-filters", 1, "09-03", "phase-abort", "T6", "after-spend", "Draft: test exited 1; no recorded measurement establishes a red base."),
  stop(16, "stack-tone-modes-and-default-run", 1, "09-04", "cancel", null, "unexplained", "Draft: cancelled in builder without a reason."),
  stop(17, "stack-tone-modes-and-default-run", 2, "09-04", "phase-abort", "T1", "gap", "Draft: ExecutableNotFound claude despite working in the owner's terminal; launch replay reaches stub GO with the name absent from PATH.", "launch", "T08"),
  stop(18, "task-3.5", 1, "09-06", "quota-exhausted", "T2", "after-spend", "Draft explicitly says ChatGPT Plus limit hit mid-run, not an exhausted starting window; phase-boundary quota pause is mitigation."),
  stop(19, "task-3.5", 2, "09-07", "review-inconsistent", null, "after-spend", "Draft: replacement review inconsistent; a review must be generated first."),
  stop(20, "task-8a-recovery-adoption", 1, "09-07", "cancel", null, "unexplained", "Draft: cancelled in builder without a reason."),
  stop(21, "marimba-lifecycle-timeout-fence", 1, "09-07", "phase-abort", "T5", "unexplained", "Draft only says ENOENT on a state-root file, without naming the file. No fixing commit/regression can be tied to that missing precondition; G02-S must supply the filename before calling it fixed or trappable."),
  stop(22, "task-8a-recovery-adoption-continuation", 1, "09-08", "quota-exhausted", "T2", "after-spend", "Draft: Codex usage limit, second quota stop in two days; no exhausted-at-start observation is recorded."),
  stop(23, "task-8a-recovery-adoption-continuation", 2, "09-08", "review-inconsistent", null, "after-spend", "Draft: replacement review inconsistent, a generated-output condition."),
  stop(24, "task-8b-protected-quota-foundation", 1, "09-08", "phase-abort", "T5", "unexplained", "Draft: same unnamed state-root ENOENT as S21. No exact file or fixing regression is recorded; cannot silently substitute placement.yaml for it."),
  stop(25, "task-8b-protected-quota-foundation", 2, "09-08", "phase-abort", null, "after-spend", "Draft: plan-context terminal gate failure at round 0; no evidence identifies a gate defect or a pre-call missing input."),
  stop(26, "task-8b-…-continuation", 1, "09-08", "phase-abort", null, "after-spend", "Draft records this abbreviated task name and the same round-0 output gate failure as S25; exact task spelling needs G02-S, not inference."),
  stop(27, "w16-m1-shift", 1, "09-26", "permission-breach", "T3", "gap", "W01 map: malformed request and declared specs/ writes refuse in K1; a well-shaped Where omitting the plan write demanded by its ticket still reaches the builder (shift replay).", "shift", "T10"),
  stop(28, "w18-m1", 1, "09-27", "cancel", null, "unexplained", "Draft: no reason recorded."),
  stop(29, "w18-m1-continuation", 1, "09-27", "phase-abort", null, "after-spend", "Draft: claude-code stream ended without a terminal event after launch. 833f8dc improves diagnosis, not prediction of provider failure."),
  stop(30, "w18-stale-prefix-integration-fix", 1, "09-27", "phase-abort", null, "after-spend", "Draft: owner-rework terminal gate failure; rework has no correction round, but the failure is observed after output."),
  stop(31, "w18-m1-prefix-adoption", 1, "09-28", "cancel", null, "unexplained", "Draft: no reason recorded."),
  stop(32, "w18-m1-seed-binding-repair", 1, "09-28", "cancel", null, "unexplained", "Draft: no reason recorded."),
  stop(33, "w18-m5-advisory-export", 1, "10-01", "review-unavailable", null, "after-spend", "Draft: opposite-provider anthropic review unavailable during review, not a recorded pre-launch executable failure."),
  stop(34, "review-transport-diagnostics", 1, "10-01", "permission-breach", "T3", "refused", "W01 map names unclassified transport-broker.ts; protected-paths replay asserts StartPreflightRefused, DRAFT, no tree and zero reservations. Declaring the write instead requires its grant.", "protected-paths"),
  stop(35, "review-transport-diagnostics", 2, "10-01", "phase-abort", null, "fixed", "07b20f9 fixes broker-resolved bwrap verification; core/test/unit/workflow/protected-grants.test.ts: A2 accepts durable host broker-resolved Linux bwrap proof and refuses altered evidence. 7bc48b5 aligns the fake in core/test/journeys/production-runner.test.ts: A2 exact protected grant completes build."),
  stop(36, "review-transport-diagnostics", 3, "10-01", "phase-abort", "T4", "refused", "Draft: DrvFs index lock mode 777; git-storage replay changes common-dir/root modes and asserts the named K1 refusal with no reservation.", "git-storage"),
  stop(37, "w01-m1-owner-check-20261005-023132", 1, null, "cancel", null, "owner", "W02 Notes: cancelled acceptance exercise; observation date only, not a supplied terminal date."),
  stop(38, "v3-w01-m2-m3", 1, null, "phase-abort", null, "after-spend", "W02 Notes only establish head_advanced failed at round 0. No selection/base comparison proves the selected work was already done; a no-op generated reply also fails this gate after spend."),
  stop(39, "v3-w01-m3-k2", 1, null, "quota-exhausted", "T2", "after-spend", "W02 Notes: mid-run quota exhaustion, mitigated by phase-boundary pause; terminal date not published."),
  stop(40, "v3-w01-m3-k2", 2, null, "review-unavailable", null, "fixed", "833f8dc fixes full-journal source_seq reads (W01 closing Amendment); core/test/unit/persistence/journal.test.ts: lastSourceSeq reads only the tail of a journal far larger than one chunk."),
  stop(41, "v3-w01-m4-k1", 1, null, "quota-exhausted", "T2", "after-spend", "W02 Notes: mid-run quota exhaustion; W01 closing Amendment says the M4 shift review was lost to the five-hour window."),
  stop(42, "v3-w01-m5-k1", 1, null, "quota-exhausted", "T2", "gap", "W01 2026-10-07 Amendment: five-hour window refused the first build call; exhausted quota at run start still reaches stub GO in the quota replay.", "quota", "T09"),
  stop(43, "v3-w01-m5-k1", 2, null, "quota-exhausted", "T2", "after-spend", "W01 closing Amendment: T11 and T12 built before the same window refused T13's first call; not the first call of the attempt."),
  stop(44, "v3-w01-m5-t11-t12", 1, null, "cancel", null, "owner", "W01 closing Amendment: owner cancelled the first adoption target after interruption during gates."),
  stop(45, "v3-w01-m5-t13", 1, null, "cancel", null, "owner", "W02 Notes records an owner cancel, not a deterministic pre-call factory fault."),
  stop(46, "T30.1", 1, null, "review-malformed", null, "after-spend", "W02 Notes: malformed generated review; no pre-call condition supplied.", null, null, "fusion-harness"),
  stop(47, "t30-herdr-visible-fusion-corrected", 1, null, "phase-abort", "T6", "after-spend", "W02 Notes: suspected red base only (as S01); no base gate observation establishes that precondition.", null, null, "fusion-harness"),
  gotcha("G01", null, "fixed", "Live gotcha is stale: 31a1a97 adds T2 owner rework; core/test/journeys/owner-rework-t2.test.ts: the builder gets the defect and the reviewer gets the candidate; neither the defect nor the superseded verdict reaches the reviewer."),
  gotcha("G02", "config-snapshot", "refused", "Config snapshot mismatch refuses before owner rework reserves anything (configuration replay).", "configuration"),
  gotcha("G03", null, "not-a-stop", "retry.ts intentionally carries callsSpent and task raises; retry itself is not the later insufficient-budget stop."),
  gotcha("G04", null, "not-a-stop", "main.ts uses nonzero exit codes for reported outcomes, including owner decline; an exit alone is not a stop."),
  gotcha("G05", null, "not-a-stop", "doctor.ts reports durable findings with no repair path; stale locks are evidence, not a run started by doctor."),
  gotcha("G06", null, "not-a-stop", "operator.ts gc only lists; core/test/unit/meta/no-destructive-paths.test.ts enforces absence of clearing paths."),
  gotcha("G07", null, "not-a-stop", "new.ts intentionally records the caller's repository; wrong-directory creation succeeds and spends nothing. No recorded stop or pre-call predicate distinguishes it from intended creation (cwd replay).", "cwd"),
  gotcha("G08", null, "not-a-stop", "Owner terminal refusal is intentional; no BLOCKED/CANCELLED attempt is created by piped stdin."),
  gotcha("G09", "continuity", "refused", "PiCodexAdapter.assertResumable rejects a missing host-owned session store with E_BACKEND_FAILURE before launch (continuity replay).", "continuity"),
  gotcha("G10", null, "not-a-stop", "phase-machine.ts constructs queued/failed-equivalent phases; only validation earns success, not a new halt."),
  gotcha("G11", "interrupted-start", "refused", "start.ts already refuses a pre-existing attempt tree with AttemptWorktreeExists. Replay creates the interrupted tree after confirmation: DRAFT and zero reservations.", "interrupted-start"),
  gotcha("C5-baseline", "stale-baseline", "gap", "prepareBaselineWorktree keeps an existing ignored seed; a recorder measuring its stale bytes can falsely pass the suite and admit a provider call (baseline replay).", "baseline", "T12"),
  gotcha("C8-adopt", "adoption-k1", "gap", "adopt.ts creates its target GATING without start/K1; adoption replay of a malformed fresh owner request reaches its cold review.", "adoption", "T12"),
  gotcha("C8-interrupted-adoption", null, "after-spend", "W01 closing Amendment: interruption during adoption's gates leaves GATING with no host. Interruption is an external event during work, not a fact measurable before its start; recovery is an owner cancel."),
  gotcha("C8-later-grant", "grant-boundary", "gap", "grant.ts accepts a later documenter grant at PREPARED; the subject is bound before intervening phases. Replay asserts acceptance and an intervening stub call, not that the later phase can consume it.", "later-grant", "T12"),
];
