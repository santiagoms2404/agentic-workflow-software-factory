// The harness the five T4 suites drive `core/src/state/**` through.
//
// The module under test DOES NOT EXIST while T4 is the current task — that is
// the ordering gate G1, not an accident. So every module reference here is a
// lazy, non-literal dynamic `import()`:
//
//   * non-literal, so `tsc` does not try to resolve a file that is absent by
//     design and report it as a type error;
//   * lazy, so each test fails on its own with ERR_MODULE_NOT_FOUND naming the
//     missing file, instead of the whole suite failing to load and hiding how
//     much of the contract is unwritten.
//
// The interfaces below are the CONTRACT T5 implements. They are declared here,
// not imported from `src`, for the same reason the tables are transcribed by
// hand: a suite that imports its own expectations from the implementation
// proves nothing.

import type {
  Actor,
  EdgeId,
  RejectionName,
  TaskState,
  Tier,
} from "./_lifecycle-tables.ts";
import { edge } from "./_lifecycle-tables.ts";
import type { ReviewFinding, ReviewVerdict } from "../../src/contracts/index.ts";

// ---------------------------------------------------------------------------
// The transition contract.
// ---------------------------------------------------------------------------

export interface TransitionReason {
  /**
   * Deliberately `string`, not the six-value union: an off-allowlist source is
   * exactly what step 1 exists to reject at RUNTIME. A type that made the bad
   * value unrepresentable would delete the test.
   */
  source: string;
  /** `transitions.reason_code` — required on every `→ BLOCKED` edge. */
  code?: string;
  detail?: string;
  /** L10 only: the exact failed command. */
  command?: readonly string[];
  /** L10 only: its output. */
  output?: string;
}

export interface PreflightEvidence {
  adapter: boolean;
  sandbox: boolean;
  observability: boolean;
}

export interface ReviewEvidence {
  verdict: ReviewVerdict;
  reviewedSha: string;
  findings: readonly ReviewFinding[];
}

/** One recorded host gate row, as the host measured it. */
export interface GateEvidenceRow {
  gateId: string;
  passed: boolean;
  candidateSha: string;
}

/**
 * The rows behind `gatesPass`, plus the gate ids the configuration requires.
 * L25 spends a call to PRESERVE a green, so it checks the green rather than
 * the boolean summarising it — and a pure guard cannot go and read the rows.
 */
export interface GateEvidence {
  configured: readonly string[];
  rows: readonly GateEvidenceRow[];
}

export interface LandingEvidence {
  shaDisplayed: string;
  summaryDisplayed: string;
  confirmed: boolean;
  requiredReviewPresent: boolean;
  journeyApproved: boolean;
  protectedApprovalsValid: boolean;
  fastForwardPreflightPasses: boolean;
}

export interface QuotaStopEvidence {
  route?: string;
  minutesToReset?: number;
  thresholdMinutes?: number;
}

export interface TransitionEvidence {
  // L1
  worktreeCreated?: boolean;
  configValid?: boolean;
  preflight?: PreflightEvidence;
  // L1, L7
  baseSha?: string;
  // L4
  workflowCompiled?: boolean;
  // L7
  requiredPhasesTerminalSuccess?: boolean;
  hostCommitCreated?: boolean;
  // L7, L11, L15, L16, L20, L23
  candidateSha?: string;
  // L9
  treeTerminated?: boolean;
  survivorsReported?: boolean;
  // L10, L11, L12, L13, L20, L25
  gatesPass?: boolean;
  // L25 — the rows behind that boolean
  gateEvidence?: GateEvidence;
  // L16, L19; and L25, which requires it ABSENT
  gatesInvalidated?: boolean;
  // L19, L25
  reviewInvalidated?: boolean;
  // L25
  reviewInvalidationReason?: string;
  // L19
  reworkRequest?: string;
  // L15, L16, L25
  review?: ReviewEvidence;
  // L17
  reviewTransportRetries?: number;
  /**
   * L25's eligibility and L17's non-transport blocker. Deliberately `string`
   * rather than the closed unions, for the same reason `reason.source` is: an
   * off-vocabulary value is exactly what the guard must reject at RUNTIME.
   */
  reviewEvidenceDefect?: string;
  reviewFailure?: string;
  // L25 — host observation, because a pure guard may not touch a filesystem
  candidateUnchanged?: boolean;
  // L20
  landing?: LandingEvidence;
  // L23
  headSha?: string;
  checkoutClean?: boolean;
  // L26
  quotaStop?: QuotaStopEvidence;
}

/**
 * Mirrors the `sessions` columns the state layer reasons over:
 * `calls_reserved`, `calls_spent`, `corrections_auto`, `corrections_owner`,
 * `owner_reentries`, plus the allowance limits from
 * `risk.correction_allowance`.
 *
 * `callsSpent` is TASK-lifetime, not attempt-lifetime — spend carries across
 * attempts of the same task.
 *
 * `correctionsAuto` / `correctionsOwner` bound the INTRA-PHASE correction and
 * are per phase. `ownerReentries` bounds OWNER RE-ENTRY (L10-owner, L16, L19,
 * L25) and is per attempt. One pair of counters used to carry both, which
 * meant a phase beginning after an owner re-entry refunded it.
 */
export interface BudgetState {
  attempt: number;
  callsSpent: number;
  callsReserved: number;
  correctionsAuto: number;
  correctionsOwner: number;
  ownerReentries: number;
  allowance: { auto: number; owner: number; ownerReentries: number };
  /**
   * This task's effective ceiling: its tier ceiling plus any owner-granted
   * raise. Optional for the reason the real declaration gives — a journal
   * written before the ceiling became a dial records none.
   *
   * This interface mirrors `core/src/state/task-machine.ts` rather than
   * importing it, because the harness loads that module dynamically to keep
   * the purity fence honest. That mirroring is why it silently fell behind
   * when `awsf raise` added this field, and why the repository-wide typecheck
   * is the thing that noticed.
   */
  ceiling?: number;
}

/**
 * Presence means "this transition intends to spawn". The plan states the
 * closure both ways — "spawn ⇔ entering an executing state" — so a spawn on a
 * non-spawn-site edge AND a spawn-site edge that declares no spawn are both
 * `IllegalSpawnSite`.
 *
 * `cost` is the FULL declared cost: a composite (fusion) adapter running two
 * workers and a fuser declares 3 before anything launches.
 */
export interface SpawnRequest {
  cost: number;
}

export interface TransitionInput {
  from: TaskState;
  to: TaskState;
  actor: Actor;
  tier: Tier;
  reason: TransitionReason;
  interactive: boolean;
  budget: BudgetState;
  evidence?: TransitionEvidence;
  spawn?: SpawnRequest;
}

export interface TransitionResult {
  edge: EdgeId;
  from: TaskState;
  to: TaskState;
  actor: Actor;
  /** Feeds `transitions.spawn_site`. */
  spawnSite: boolean;
  spends: {
    /** Calls reserved by this transition: the spawn's declared cost, or 0. */
    calls: number;
    /** Which correction tranche this transition draws from, if any. */
    correctionTranche: "auto" | "owner" | null;
  };
}

export interface TaskMachineModule {
  TASK_STATES: readonly TaskState[];
  transition(input: TransitionInput): TransitionResult;
}

export interface WorkflowCallSpec {
  id: string;
  minimumCalls: number;
}

export interface TiersModule {
  /** The documented defaults. A ceiling now RESOLVES — from config, or from an owner grant. */
  DEFAULT_CALL_CEILINGS: Readonly<Record<Tier, number>>;
  MIN_CALL_CEILING: number;
  MAX_CALL_CEILING: number;
  /** `resolved` is the effective configuration's table or one attempt's own ceiling. */
  ceilingFor(tier: Tier, resolved?: Readonly<Record<Tier, number>> | number): number;
  callCeilingsOf(configured: { T0: number; T1: number; T2: number }): Readonly<Record<Tier, number>>;
  assertCeiling(ceiling: number, subject: string): number;
  fitsCeiling(committed: number, requested: number, tier: Tier, resolved?: Readonly<Record<Tier, number>> | number): boolean;
  /** Workers plus the fuser: the full cost a composite adapter declares in advance. */
  compositeCost(workerCount: number): number;
  /** Throws `CallCeilingExceeded` when the workflow's minimum cannot fit the tier. */
  assertWorkflowFitsTier(workflow: WorkflowCallSpec, tier: Tier, resolved?: Readonly<Record<Tier, number>> | number): void;
}

export interface StateErrorsModule {
  BLOCKER_CODES: readonly string[];
  DETERMINISTIC_REASON_SOURCES: readonly string[];
  [error: string]: unknown;
}

// ---------------------------------------------------------------------------
// Lazy module access.
// ---------------------------------------------------------------------------

const TASK_MACHINE_SPECIFIER = "../../src/state/task-machine.ts";
const TIERS_SPECIFIER = "../../src/state/tiers.ts";
const ERRORS_SPECIFIER = "../../src/state/errors.ts";

const loaded = new Map<string, Promise<unknown>>();

function load(specifier: string): Promise<unknown> {
  let pending = loaded.get(specifier);
  if (!pending) {
    // Non-literal on purpose — see the header.
    pending = import(specifier);
    loaded.set(specifier, pending);
  }
  return pending;
}

export async function taskMachine(): Promise<TaskMachineModule> {
  return (await load(TASK_MACHINE_SPECIFIER)) as TaskMachineModule;
}

export async function tiers(): Promise<TiersModule> {
  return (await load(TIERS_SPECIFIER)) as TiersModule;
}

export async function stateErrors(): Promise<StateErrorsModule> {
  return (await load(ERRORS_SPECIFIER)) as StateErrorsModule;
}

/** The error class the module exports under `name`, or a clear failure if it does not. */
export async function errorClass(name: RejectionName): Promise<new (...args: never[]) => Error> {
  const mod = await stateErrors();
  const ctor = mod[name];
  if (typeof ctor !== "function") {
    throw new Error(`core/src/state/errors.ts exports no ${name} class`);
  }
  return ctor as new (...args: never[]) => Error;
}

// ---------------------------------------------------------------------------
// Assertions.
// ---------------------------------------------------------------------------

export interface RejectionExpectation {
  /** `CorrectionAllowanceExhausted` carries `scope` to tell step 6 from step 9. */
  scope?: "global" | "tranche";
  /** Extra context for the failure message. */
  because?: string;
}

/**
 * Runs `transition(input)` expecting it to throw `expected`, and returns the
 * error so a caller can assert further. Asserts both `instanceof` and `.name`
 * so a single class masquerading under eleven names cannot pass.
 */
export async function expectRejection(
  expected: RejectionName,
  input: TransitionInput,
  options: RejectionExpectation = {},
): Promise<Error & Record<string, unknown>> {
  const { transition } = await taskMachine();
  const ctor = await errorClass(expected);
  const where = options.because ? ` (${options.because})` : "";
  const label = `${input.from} -> ${input.to} by ${input.actor}${where}`;

  let thrown: unknown;
  let returned: unknown;
  try {
    returned = transition(input);
  } catch (error) {
    thrown = error;
  }

  if (thrown === undefined) {
    throw new Error(
      `expected ${expected} for ${label}, but the transition was accepted: ${JSON.stringify(returned)}`,
    );
  }
  if (!(thrown instanceof Error)) {
    throw new Error(`expected ${expected} for ${label}, but a non-Error was thrown: ${String(thrown)}`);
  }
  // Read the fields before the `instanceof` check: a failed check narrows
  // `thrown` to `never`, and the failure message is the whole point of it.
  const { name, message } = thrown;
  if (!(thrown instanceof ctor)) {
    throw new Error(`expected ${expected} for ${label}, got ${name}: ${message}`);
  }
  if (name !== expected) {
    throw new Error(`expected the thrown error to be named ${expected} for ${label}, got ${name}`);
  }
  const detailed = thrown as Error & Record<string, unknown>;
  if (options.scope !== undefined && detailed["scope"] !== options.scope) {
    throw new Error(
      `expected ${expected} scope ${options.scope} for ${label}, got ${String(detailed["scope"])}`,
    );
  }
  return detailed;
}

/** Runs `transition(input)` expecting acceptance, and returns the result. */
export async function expectAccepted(input: TransitionInput): Promise<TransitionResult> {
  const { transition } = await taskMachine();
  return transition(input);
}

/** The rejection class a call produced, or `null` if it was accepted. Never throws. */
export async function rejectionNameOf(input: TransitionInput): Promise<string | null> {
  const { transition } = await taskMachine();
  try {
    transition(input);
    return null;
  } catch (error) {
    return error instanceof Error ? error.name : `non-error: ${String(error)}`;
  }
}

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

export const BASE_SHA = "b".repeat(40);
export const CANDIDATE_SHA = "c".repeat(40);

/**
 * `allowance` is patched field by field rather than replaced wholesale, so a
 * case that says `{auto: 2, owner: 1}` is still talking about the same
 * re-entry allowance it did not mention.
 */
export type BudgetOverrides =
  Partial<Omit<BudgetState, "allowance">> & { allowance?: Partial<BudgetState["allowance"]> };

export function budget(overrides: BudgetOverrides = {}): BudgetState {
  const { allowance, ...counters } = overrides;
  return {
    attempt: 1,
    callsSpent: 0,
    callsReserved: 0,
    correctionsAuto: 0,
    correctionsOwner: 0,
    ownerReentries: 0,
    ...counters,
    allowance: { auto: 1, owner: 1, ownerReentries: 1, ...allowance },
  };
}

export function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: "F1",
    severity: "medium",
    file: "core/src/cli/main.ts",
    line: 42,
    title: "Exit code is swallowed",
    detail: "The catch block returns 0 even when the command failed.",
    evidence: "core/src/cli/main.ts:42 returns 0 in the catch arm.",
    ...overrides,
  };
}

/** A style note: real, but not a defect. L16 must refuse to spend a call on it. */
export function styleNote(): ReviewFinding {
  return finding({
    id: "F-style",
    severity: "low",
    title: "Prefer const over let",
    detail: "`let` is never reassigned here.",
  });
}

type EdgeInputs = Readonly<Record<EdgeId, () => TransitionInput>>;

/**
 * A fully-guard-satisfying input for each of the twenty-six legal edges.
 * These are the inputs the transition matrix asserts are ACCEPTED, so every
 * field here is load-bearing: remove one and the edge must start failing.
 */
const VALID_INPUTS: EdgeInputs = {
  L1: () => ({
    from: "DRAFT", to: "PREPARED", actor: "host", tier: 1,
    reason: { source: "git", detail: "awsf start" },
    interactive: false, budget: budget(),
    evidence: {
      worktreeCreated: true,
      baseSha: BASE_SHA,
      configValid: true,
      preflight: { adapter: true, sandbox: true, observability: true },
    },
  }),
  L2: () => ({
    from: "DRAFT", to: "BLOCKED", actor: "host", tier: 1,
    reason: { source: "process", code: "preflight-failed", detail: "sandbox broker unavailable" },
    interactive: false, budget: budget(),
  }),
  L3: () => ({
    from: "DRAFT", to: "CANCELLED", actor: "human", tier: 1,
    reason: { source: "human", detail: "awsf cancel" },
    interactive: true, budget: budget(),
  }),
  L4: () => ({
    from: "PREPARED", to: "RUNNING", actor: "host", tier: 1,
    reason: { source: "process", detail: "workflow start" },
    interactive: false, budget: budget(),
    evidence: { workflowCompiled: true },
    spawn: { cost: 1 },
  }),
  L5: () => ({
    from: "PREPARED", to: "BLOCKED", actor: "host", tier: 1,
    reason: { source: "process", code: "crash", detail: "launcher exited before registration" },
    interactive: false, budget: budget(),
  }),
  L6: () => ({
    from: "PREPARED", to: "CANCELLED", actor: "human", tier: 1,
    reason: { source: "human", detail: "awsf cancel" },
    interactive: true, budget: budget(),
  }),
  L7: () => ({
    from: "RUNNING", to: "GATING", actor: "host", tier: 1,
    reason: { source: "git", detail: "phases complete" },
    interactive: false, budget: budget(),
    evidence: {
      requiredPhasesTerminalSuccess: true,
      hostCommitCreated: true,
      baseSha: BASE_SHA,
      candidateSha: CANDIDATE_SHA,
    },
  }),
  L8: () => ({
    from: "RUNNING", to: "BLOCKED", actor: "host", tier: 1,
    reason: { source: "process", code: "silence", detail: "no output for the silence window" },
    interactive: false, budget: budget(),
  }),
  L9: () => ({
    from: "RUNNING", to: "CANCELLED", actor: "human", tier: 1,
    reason: { source: "human", detail: "awsf cancel" },
    interactive: true, budget: budget(),
    evidence: { treeTerminated: true, survivorsReported: true },
  }),
  L10: () => ({
    from: "GATING", to: "RUNNING", actor: "host", tier: 1,
    reason: {
      source: "gate",
      command: ["npm", "run", "test:unit"],
      output: "1 failing\n  contracts > rejects unknown fields",
    },
    interactive: false, budget: budget(),
    evidence: { gatesPass: false, candidateSha: CANDIDATE_SHA },
    spawn: { cost: 1 },
  }),
  L11: () => ({
    from: "GATING", to: "REVIEWING", actor: "host", tier: 2,
    reason: { source: "gate", detail: "gates pass" },
    interactive: false, budget: budget(),
    evidence: { gatesPass: true, candidateSha: CANDIDATE_SHA },
    spawn: { cost: 1 },
  }),
  L12: () => ({
    from: "GATING", to: "AWAITING_OWNER", actor: "host", tier: 1,
    reason: { source: "gate", detail: "gates pass" },
    interactive: false, budget: budget(),
    evidence: { gatesPass: true, candidateSha: CANDIDATE_SHA },
  }),
  L13: () => ({
    from: "GATING", to: "BLOCKED", actor: "host", tier: 1,
    reason: { source: "gate", code: "correction-budget-exhausted" },
    interactive: false,
    budget: budget({ correctionsAuto: 1, correctionsOwner: 1, ownerReentries: 1, callsSpent: 3 }),
    evidence: { gatesPass: false },
  }),
  L14: () => ({
    from: "GATING", to: "CANCELLED", actor: "human", tier: 1,
    reason: { source: "human", detail: "awsf cancel" },
    interactive: true, budget: budget(),
  }),
  L15: () => ({
    from: "REVIEWING", to: "AWAITING_OWNER", actor: "host", tier: 2,
    reason: { source: "gate", detail: "review recorded" },
    interactive: false, budget: budget({ callsSpent: 2 }),
    evidence: {
      candidateSha: CANDIDATE_SHA,
      review: { verdict: "accept", reviewedSha: CANDIDATE_SHA, findings: [] },
    },
  }),
  L16: () => ({
    from: "REVIEWING", to: "RUNNING", actor: "owner", tier: 2,
    reason: { source: "human", detail: "owner accepts finding F1" },
    interactive: false, budget: budget({ callsSpent: 2 }),
    evidence: {
      candidateSha: CANDIDATE_SHA,
      review: { verdict: "concern", reviewedSha: CANDIDATE_SHA, findings: [finding()] },
      gatesInvalidated: true,
    },
    spawn: { cost: 1 },
  }),
  L17: () => ({
    from: "REVIEWING", to: "BLOCKED", actor: "host", tier: 2,
    reason: { source: "process", code: "review-unavailable" },
    interactive: false, budget: budget({ callsSpent: 2 }),
    evidence: { reviewTransportRetries: 1 },
  }),
  L18: () => ({
    from: "REVIEWING", to: "CANCELLED", actor: "human", tier: 2,
    reason: { source: "human", detail: "awsf cancel" },
    interactive: true, budget: budget({ callsSpent: 2 }),
  }),
  L19: () => ({
    from: "AWAITING_OWNER", to: "RUNNING", actor: "human", tier: 1,
    reason: { source: "human", detail: "rework: the CLI ignores --json" },
    interactive: true, budget: budget({ callsSpent: 1 }),
    evidence: {
      candidateSha: CANDIDATE_SHA,
      reworkRequest: "`awsf status --json` still prints the human table.",
      gatesInvalidated: true,
      reviewInvalidated: true,
    },
    spawn: { cost: 1 },
  }),
  L20: () => ({
    from: "AWAITING_OWNER", to: "LANDING", actor: "human", tier: 2,
    reason: { source: "human", detail: "awsf land" },
    interactive: true, budget: budget({ callsSpent: 2 }),
    evidence: {
      candidateSha: CANDIDATE_SHA,
      gatesPass: true,
      landing: {
        shaDisplayed: CANDIDATE_SHA,
        summaryDisplayed: "Add the --json flag to awsf status.",
        confirmed: true,
        requiredReviewPresent: true,
        journeyApproved: true,
        protectedApprovalsValid: true,
        fastForwardPreflightPasses: true,
      },
    },
  }),
  L21: () => ({
    from: "AWAITING_OWNER", to: "BLOCKED", actor: "host", tier: 1,
    reason: { source: "record", code: "record-corrupt", detail: "status.json failed to parse" },
    interactive: false, budget: budget(),
  }),
  L22: () => ({
    from: "AWAITING_OWNER", to: "CANCELLED", actor: "human", tier: 1,
    reason: { source: "human", detail: "owner rejected the candidate" },
    interactive: true, budget: budget(),
  }),
  L23: () => ({
    from: "LANDING", to: "LANDED", actor: "host", tier: 1,
    reason: { source: "git", detail: "fast-forward confirmed" },
    interactive: false, budget: budget({ callsSpent: 1 }),
    evidence: { candidateSha: CANDIDATE_SHA, headSha: CANDIDATE_SHA, checkoutClean: true },
  }),
  L24: () => ({
    from: "LANDING", to: "BLOCKED", actor: "host", tier: 1,
    reason: { source: "git", code: "non-fast-forward", detail: "canonical is 2 commits ahead" },
    interactive: false, budget: budget({ callsSpent: 1 }),
  }),
  // L25 — the owner re-buys a review of an UNCHANGED candidate. Note what is
  // deliberately absent: `gatesInvalidated`. L16 and L19 must assert it because
  // they change the tree; L25 exists precisely because the tree does not, so
  // asserting it would be a rework wearing a review's name.
  L25: () => ({
    from: "AWAITING_OWNER", to: "REVIEWING", actor: "human", tier: 2,
    reason: { source: "human", detail: "awsf review" },
    interactive: true, budget: budget({ callsSpent: 2 }),
    evidence: {
      candidateSha: CANDIDATE_SHA,
      gatesPass: true,
      gateEvidence: {
        configured: ["tests", "typecheck"],
        rows: [
          { gateId: "tests", passed: true, candidateSha: CANDIDATE_SHA },
          { gateId: "typecheck", passed: true, candidateSha: CANDIDATE_SHA },
        ],
      },
      reviewInvalidated: true,
      reviewInvalidationReason: "the recorded review carries no review_evidence_present row",
      review: { verdict: "accept", reviewedSha: CANDIDATE_SHA, findings: [] },
      reviewEvidenceDefect: "evidence-gate-absent",
      candidateUnchanged: true,
    },
    spawn: { cost: 1 },
  }),
  L26: () => ({
    from: "RUNNING", to: "AWAITING_OWNER", actor: "host", tier: 1,
    reason: { source: "process", detail: "quota reset in 4 minutes; threshold is 5 minutes" },
    interactive: false, budget: budget({ callsSpent: 1 }),
    evidence: { quotaStop: { route: "pi-codex", minutesToReset: 4, thresholdMinutes: 5 } },
  }),
};

/** A fresh, fully-valid input for a legal edge. Mutate the copy freely. */
export function validInput(id: EdgeId): TransitionInput {
  return VALID_INPUTS[id]();
}

/** `validInput`, with a shallow patch applied. */
export function inputFor(id: EdgeId, patch: Partial<TransitionInput> = {}): TransitionInput {
  return { ...validInput(id), ...patch };
}

/** `validInput`, with its evidence patched (and the rest left intact). */
export function withEvidence(id: EdgeId, patch: Partial<TransitionEvidence>): TransitionInput {
  const base = validInput(id);
  return { ...base, evidence: { ...base.evidence, ...patch } };
}

/** `validInput`, with one evidence key removed entirely — the "absent", not "false", case. */
export function withoutEvidence(id: EdgeId, key: keyof TransitionEvidence): TransitionInput {
  const base = validInput(id);
  const evidence = { ...base.evidence };
  delete evidence[key];
  return { ...base, evidence };
}

/** `validInput`, with its reason patched. */
export function withReason(id: EdgeId, patch: Partial<TransitionReason>): TransitionInput {
  const base = validInput(id);
  return { ...base, reason: { ...base.reason, ...patch } };
}

/** `validInput`, with its budget patched. */
export function withBudget(id: EdgeId, patch: BudgetOverrides): TransitionInput {
  const { allowance, ...counters } = patch;
  const base = validInput(id);
  return {
    ...base,
    budget: {
      ...base.budget,
      ...counters,
      allowance: { ...base.budget.allowance, ...allowance },
    },
  };
}

/**
 * A neutral, deterministic probe for an ILLEGAL ordered pair. Everything a
 * later step could complain about is satisfied — allowlisted evidence source,
 * a full budget, unspent tranches, an interactive session — so whatever throws
 * is the pair-legality complaint (steps 2–5) and nothing else.
 */
export function probeInput(from: TaskState, to: TaskState): TransitionInput {
  return {
    from,
    to,
    actor: "host",
    tier: 1,
    reason: { source: "process", detail: "matrix probe" },
    interactive: true,
    budget: budget(),
  };
}

/** The valid input for a legal pair, or a neutral probe for an illegal one. */
export function matrixInput(from: TaskState, to: TaskState): TransitionInput {
  const legal = LEGAL_EDGE_BY_PAIR.get(`${from}->${to}`);
  return legal ? validInput(legal) : probeInput(from, to);
}

const LEGAL_EDGE_BY_PAIR: ReadonlyMap<string, EdgeId> = new Map(
  (Object.keys(VALID_INPUTS) as EdgeId[]).map((id) => {
    const e = edge(id);
    return [`${e.from}->${e.to}`, id];
  }),
);
