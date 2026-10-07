import { SEED_CUT } from "./population.ts";
import { SEEDS, type Seed } from "./seeds.ts";

// W02-Q1 and G02-S: the closed cut over all registered non-prove stops.
// population.ts owns selection; this is the same instant, not another rule.
export const TRAP_CUT = SEED_CUT;

/** Reasons a seed cannot have a trap, as defined by W02's Solution:
 * fixed: a removed factory defect; evidence cites its fix and regression test.
 * after-spend: a condition arising only after provider calls began; evidence
 * names any mitigation (for example the phase-boundary quota pause).
 * owner: an owner decision, such as cancelling to replace a task.
 * unexplained: no recorded evidence names a cause, often an older cancel.
 * not-a-stop: live gotchas only; surprising behaviour that never stops a run.
 */
export const NO_TRAP_KINDS = ["fixed", "after-spend", "owner", "unexplained", "not-a-stop"] as const;
export type NoTrapKind = (typeof NO_TRAP_KINDS)[number];
export type TrapId = `TR-${number}`;
export type RefusalPoint = "k1-field" | "start" | "run-before-l4" | "owner-act" | "shift-admission";

export interface TrapEntry {
  readonly id: TrapId;
  readonly family: string;
  readonly title: string;
  readonly seeds: readonly string[];
  readonly refusalPoint: RefusalPoint;
  /** The refusing error or host record name; K1's family identifies its field. */
  readonly refusal: string;
}
export interface NoTrapEntry {
  readonly seed: string;
  readonly kind: NoTrapKind;
  readonly evidence: string;
}
export interface PendingEntry {
  readonly task: NonNullable<Seed["pendingTask"]>;
  readonly seeds: readonly string[];
}

// Entries describe refusals that exist today. T04 supplies their tests and
// markers; until then an entry alone is not a proven trap. Empty seed lists
// are K1 field journeys (or S34's complementary run-time shape), not invented
// historical stops. Each ledger key is assigned exactly once.
export const TRAPS: readonly TrapEntry[] = [
  { id: "TR-01", family: "suite", title: "A red base refuses preparation", seeds: [],
    refusalPoint: "k1-field", refusal: "awsf.preflight-refused/v1" },
  { id: "TR-02", family: "write-boundary", title: "Declared writes must fit the recipe", seeds: [],
    refusalPoint: "k1-field", refusal: "awsf.preflight-refused/v1" },
  { id: "TR-03", family: "protected-paths", title: "Protected paths must be classified", seeds: ["S34"],
    refusalPoint: "k1-field", refusal: "awsf.preflight-refused/v1" },
  { id: "TR-04", family: "git-storage", title: "DrvFs modes refuse preparation", seeds: ["S36"],
    refusalPoint: "k1-field", refusal: "awsf.preflight-refused/v1" },
  { id: "TR-05", family: "duplicate", title: "Live or landed overlapping work refuses preparation", seeds: [],
    refusalPoint: "k1-field", refusal: "awsf.preflight-refused/v1" },
  { id: "TR-06", family: "request-shape", title: "The request needs four ordered labelled lines", seeds: [],
    refusalPoint: "k1-field", refusal: "awsf.preflight-refused/v1" },
  { id: "TR-07", family: "prior-attempts", title: "Consulted sessions must match the journal", seeds: [],
    refusalPoint: "k1-field", refusal: "awsf.preflight-refused/v1" },
  { id: "TR-08", family: "confirmation", title: "The owner confirms this request and its paths", seeds: [],
    refusalPoint: "k1-field", refusal: "awsf.preflight-refused/v1" },
  // S34 belongs to TR-03. This is its declared-write/run-time half, with no
  // second ledger assignment: a planned protected write needs a grant at L4.
  { id: "TR-09", family: "protected-grant", title: "A planned protected write needs a grant before L4", seeds: [],
    refusalPoint: "run-before-l4", refusal: "ProtectedGrantRefused" },
  { id: "TR-10", family: "config-snapshot", title: "Owner rework refuses a changed configuration", seeds: ["G02"],
    refusalPoint: "owner-act", refusal: "ProductionConfigSnapshotMismatch" },
  { id: "TR-11", family: "continuity", title: "Resume needs the host-owned session store", seeds: ["G09"],
    refusalPoint: "run-before-l4", refusal: "E_BACKEND_FAILURE" },
  { id: "TR-12", family: "interrupted-start", title: "An interrupted attempt tree is retained, not overwritten", seeds: ["G11"],
    refusalPoint: "start", refusal: "AttemptWorktreeExists" },
];

function isNoTrapKind(outcome: Seed["outcome"]): outcome is NoTrapKind {
  return (NO_TRAP_KINDS as readonly string[]).includes(outcome);
}

// Evidence stays in the confirmed ledger instead of a second editable copy.
export const NO_TRAPS: readonly NoTrapEntry[] = SEEDS.flatMap(seed =>
  isNoTrapKind(seed.outcome) ? [{ seed: seed.id, kind: seed.outcome, evidence: seed.evidence }] : []);

// Gaps have no trap id yet: M4 supplies the refusal before assigning an id.
// S27's K1 subshapes are TR-02/TR-06, but its unresolved ticket-demand shape
// is assigned here only, rather than counted twice as already trapped.
export const PENDING: readonly PendingEntry[] = [
  { task: "T08", seeds: ["S11", "S17"] },
  { task: "T09", seeds: ["S42"] },
  { task: "T10", seeds: ["S27"] },
  { task: "T11", seeds: ["S21", "S24"] },
  { task: "T12", seeds: ["C5-baseline", "C8-adopt", "C8-later-grant"] },
];

export interface BlockerCoverage {
  readonly edge: string;
  readonly code: string;
  readonly target: { readonly family: string } | { readonly kind: NoTrapKind };
  readonly evidence: string;
}

// Closed, explicit (edge, code) coverage, not generated from the vocabulary:
// adding a state blocker must force a new classification in the unit fence.
// A code can also describe a pre-call subshape (for example S17's launch
// environment); those confirmed seeds remain pending above. These rows classify
// the lifecycle edge's general fault, not an assertion that every subshape is
// already trapped. L21's recovery from AWAITING_OWNER and L24's landing
// follow build/review calls; their later record/Git faults are after-spend.
export const BLOCKER_COVERAGE: readonly BlockerCoverage[] = [
  { edge: "L2", code: "preflight-failed", target: { family: "suite" }, evidence: "K1 measures configured gates at the base before preparation (TR-01)." },
  { edge: "L5", code: "crash", target: { kind: "after-spend" }, evidence: "A running process can crash after GO; launch-environment seeds are separately pending T08." },
  { edge: "L5", code: "silence", target: { kind: "after-spend" }, evidence: "Silence is observed over an already released process." },
  { edge: "L5", code: "quota-exhausted", target: { kind: "after-spend" }, evidence: "A provider reports exhaustion after GO; S42's initially exhausted shape is pending T09." },
  { edge: "L5", code: "phase-abort", target: { kind: "after-spend" }, evidence: "The running phase fails its output contract after its call." },
  { edge: "L5", code: "permission-breach", target: { kind: "after-spend" }, evidence: "Actual writes are inspected after the phase; planned protected writes are TR-09." },
  { edge: "L5", code: "budget-exhausted", target: { kind: "after-spend" }, evidence: "Continuation cannot buy another call after consuming its budget." },
  { edge: "L8", code: "crash", target: { kind: "after-spend" }, evidence: "A released running process crashes." },
  { edge: "L8", code: "silence", target: { kind: "after-spend" }, evidence: "A released running process becomes silent." },
  { edge: "L8", code: "quota-exhausted", target: { kind: "after-spend" }, evidence: "The phase-boundary quota pause mitigates mid-run exhaustion." },
  { edge: "L8", code: "phase-abort", target: { kind: "after-spend" }, evidence: "A later phase returns invalid output after its call." },
  { edge: "L8", code: "permission-breach", target: { kind: "after-spend" }, evidence: "The gate inspects a running phase's actual writes." },
  { edge: "L8", code: "budget-exhausted", target: { kind: "after-spend" }, evidence: "The ongoing attempt has consumed its call budget." },
  { edge: "L13", code: "correction-budget-exhausted", target: { kind: "after-spend" }, evidence: "Invalid output has already spent the correction allowance." },
  { edge: "L17", code: "review-unavailable", target: { kind: "after-spend" }, evidence: "Mandatory review transport fails after the build call." },
  { edge: "L17", code: "review-malformed", target: { kind: "after-spend" }, evidence: "The review reply is malformed after the review call." },
  { edge: "L17", code: "review-evidence-invalid", target: { kind: "after-spend" }, evidence: "Host checks the returned review evidence after the review call." },
  { edge: "L17", code: "review-inconsistent", target: { kind: "after-spend" }, evidence: "Host finds a contradiction in the returned review." },
  { edge: "L17", code: "quota-exhausted", target: { kind: "after-spend" }, evidence: "Review-time exhaustion follows the build call." },
  { edge: "L17", code: "silence", target: { kind: "after-spend" }, evidence: "The released review process becomes silent." },
  { edge: "L17", code: "phase-abort", target: { kind: "after-spend" }, evidence: "The released review phase aborts." },
  { edge: "L17", code: "permission-breach", target: { kind: "after-spend" }, evidence: "Host finds forbidden writes by the review process." },
  { edge: "L17", code: "budget-exhausted", target: { kind: "after-spend" }, evidence: "Review continuation has consumed its funded calls." },
  { edge: "L21", code: "record-corrupt", target: { kind: "after-spend" }, evidence: "Recovery from AWAITING_OWNER reads a damaged record after build/review calls." },
  { edge: "L21", code: "unknown-state", target: { kind: "after-spend" }, evidence: "Recovery from AWAITING_OWNER cannot resolve state after build/review calls." },
  { edge: "L21", code: "ambiguous-pid", target: { kind: "after-spend" }, evidence: "Recovery from AWAITING_OWNER cannot identify a process after build/review calls." },
  { edge: "L21", code: "unreadable-worktree", target: { kind: "after-spend" }, evidence: "Recovery from AWAITING_OWNER cannot inspect the candidate after build/review calls." },
  { edge: "L24", code: "non-fast-forward", target: { kind: "after-spend" }, evidence: "Landing checks canonical ancestry after build and review." },
  { edge: "L24", code: "dirty-canonical-tree", target: { kind: "after-spend" }, evidence: "Landing checks current canonical cleanliness after build and review." },
  { edge: "L24", code: "git-failure", target: { kind: "after-spend" }, evidence: "Git fails during owner-approved landing after provider calls." },
  { edge: "L24", code: "ambiguous-recovery", target: { kind: "after-spend" }, evidence: "An interrupted landing cannot be reconciled after the candidate was built." },
];
