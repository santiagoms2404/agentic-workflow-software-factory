// The task lifecycle: eleven states, twenty-six legal edges, ninety-five
// rejected ordered pairs, one ordered rejection contract.
//
// `transition()` is a pure function. It starts no process, reads no file, asks
// no clock, and consults no provider — everything it reasons over arrives as
// evidence somebody else already gathered. That is what makes the whole 100-
// pair matrix testable offline, and it is enforced by the state-purity fence
// meta-test rather than by good intentions.
//
// The order of the checks below IS the contract. A rejection must name the
// REAL defect, or fixing what it named would let an illegitimate transition
// through. Do not reorder them to make a test pass.

import { assertEvidence } from "./guards.ts";
import {
  ActorNotPermitted,
  AlreadyInState,
  CallCeilingExceeded,
  CorrectionAllowanceExhausted,
  HumanGateBypass,
  IllegalSpawnSite,
  IllegalTransition,
  InteractiveOwnerRequired,
  NonDeterministicEvidence,
  TerminalAttempt,
  isDeterministicSource,
} from "./errors.ts";
import { ceilingFor, fitsCeiling, type Tier } from "./tiers.ts";
import type { ReviewFinding, ReviewVerdict } from "../contracts/index.ts";

// ---------------------------------------------------------------------------
// Vocabulary.
// ---------------------------------------------------------------------------

/**
 * PLANNING / BUILDING / DOCUMENTING are deliberately absent: they are phases,
 * and promoting them to states would make this matrix workflow-dependent and
 * destroy its testability. See `phase-machine.ts`.
 */
export const TASK_STATES = [
  "DRAFT",
  "PREPARED",
  "RUNNING",
  "GATING",
  "REVIEWING",
  "AWAITING_OWNER",
  "LANDING",
  "LANDED",
  "PUBLISHED",
  "BLOCKED",
  "CANCELLED",
] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const TERMINAL_STATES = ["LANDED", "PUBLISHED", "BLOCKED", "CANCELLED"] as const;

   /** States after which this attempt permits no further transition. */
   export const SEALED_STATES = ["BLOCKED", "CANCELLED", "PUBLISHED"] as const;

/** `transitions.actor TEXT NOT NULL CHECK (actor IN ('host','owner','human'))`. */
export const ACTORS = ["host", "owner", "human"] as const;
export type Actor = (typeof ACTORS)[number];

/**
 * `host` draws the automatic tranche; `owner` and `human` draw the owner
 * tranche. This is what makes "L10's second correction is owner-only" true,
 * and what keeps step 9's rationale — "the other actor's tranche may remain" —
 * meaningful.
 */
export const ACTOR_TRANCHE: Readonly<Record<Actor, "auto" | "owner">> = {
  host: "auto",
  owner: "owner",
  human: "owner",
};

export type EdgeId =
  | "L1" | "L2" | "L3" | "L4" | "L5" | "L6" | "L7" | "L8"
  | "L9" | "L10" | "L11" | "L12" | "L13" | "L14" | "L15" | "L16"
  | "L17" | "L18" | "L19" | "L20" | "L21" | "L22" | "L23" | "L24"
  | "L25" | "L26" | "L27";

export interface LegalEdge {
  readonly id: EdgeId;
  readonly from: TaskState;
  readonly to: TaskState;
  /** The Actor column, read literally. A human is not a superset of an owner. */
  readonly actors: readonly Actor[];
  /** The ✦ column. True exactly when `to` is RUNNING or REVIEWING. */
  readonly spawnSite: boolean;
  /** "explicit, interactive" / "interactive TTY" in the Guard column. */
  readonly interactive: boolean;
}

/** The twenty-five legal transitions, in L-order. */
export const LEGAL_EDGES: readonly LegalEdge[] = [
  { id: "L1",  from: "DRAFT",          to: "PREPARED",       actors: ["host"],           spawnSite: false, interactive: false },
  { id: "L2",  from: "DRAFT",          to: "BLOCKED",        actors: ["host"],           spawnSite: false, interactive: false },
  { id: "L3",  from: "DRAFT",          to: "CANCELLED",      actors: ["human"],          spawnSite: false, interactive: true  },
  { id: "L4",  from: "PREPARED",       to: "RUNNING",        actors: ["host"],           spawnSite: true,  interactive: false },
  { id: "L5",  from: "PREPARED",       to: "BLOCKED",        actors: ["host"],           spawnSite: false, interactive: false },
  { id: "L6",  from: "PREPARED",       to: "CANCELLED",      actors: ["human"],          spawnSite: false, interactive: true  },
  { id: "L7",  from: "RUNNING",        to: "GATING",         actors: ["host"],           spawnSite: false, interactive: false },
  { id: "L8",  from: "RUNNING",        to: "BLOCKED",        actors: ["host"],           spawnSite: false, interactive: false },
  { id: "L9",  from: "RUNNING",        to: "CANCELLED",      actors: ["human"],          spawnSite: false, interactive: true  },
  { id: "L10", from: "GATING",         to: "RUNNING",        actors: ["host", "owner"],  spawnSite: true,  interactive: false },
  { id: "L11", from: "GATING",         to: "REVIEWING",      actors: ["host"],           spawnSite: true,  interactive: false },
  { id: "L12", from: "GATING",         to: "AWAITING_OWNER", actors: ["host"],           spawnSite: false, interactive: false },
  { id: "L13", from: "GATING",         to: "BLOCKED",        actors: ["host"],           spawnSite: false, interactive: false },
  { id: "L14", from: "GATING",         to: "CANCELLED",      actors: ["human"],          spawnSite: false, interactive: true  },
  { id: "L15", from: "REVIEWING",      to: "AWAITING_OWNER", actors: ["host"],           spawnSite: false, interactive: false },
  { id: "L16", from: "REVIEWING",      to: "RUNNING",        actors: ["owner"],          spawnSite: true,  interactive: false },
  { id: "L17", from: "REVIEWING",      to: "BLOCKED",        actors: ["host"],           spawnSite: false, interactive: false },
  { id: "L18", from: "REVIEWING",      to: "CANCELLED",      actors: ["human"],          spawnSite: false, interactive: true  },
  { id: "L19", from: "AWAITING_OWNER", to: "RUNNING",        actors: ["human"],          spawnSite: true,  interactive: true  },
  { id: "L20", from: "AWAITING_OWNER", to: "LANDING",        actors: ["human"],          spawnSite: false, interactive: true  },
  { id: "L21", from: "AWAITING_OWNER", to: "BLOCKED",        actors: ["host"],           spawnSite: false, interactive: false },
  { id: "L22", from: "AWAITING_OWNER", to: "CANCELLED",      actors: ["human"],          spawnSite: false, interactive: true  },
  { id: "L23", from: "LANDING",        to: "LANDED",         actors: ["host"],           spawnSite: false, interactive: false },
  { id: "L24", from: "LANDING",        to: "BLOCKED",        actors: ["host"],           spawnSite: false, interactive: false },
  { id: "L25", from: "AWAITING_OWNER", to: "REVIEWING",      actors: ["owner", "human"], spawnSite: true,  interactive: true  },
  { id: "L26", from: "RUNNING",        to: "AWAITING_OWNER", actors: ["host"],           spawnSite: false, interactive: false },
  { id: "L27", from: "LANDED",         to: "PUBLISHED",      actors: ["human"],          spawnSite: false, interactive: true  },
];

/** The four edges that draw on a correction allowance — escalation-ladder rungs 4 and 5. */
export const CORRECTION_EDGES = ["L10", "L16", "L19", "L25"] as const;

const EDGE_BY_PAIR: ReadonlyMap<string, LegalEdge> = new Map(
  LEGAL_EDGES.map((e) => [`${e.from}->${e.to}`, e]),
);

export function edgeFor(from: TaskState, to: TaskState): LegalEdge | undefined {
  return EDGE_BY_PAIR.get(`${from}->${to}`);
}

function isSealed(state: TaskState): boolean {
     return (SEALED_STATES as readonly string[]).includes(state);
}

function isCorrectionEdge(id: EdgeId): boolean {
  return (CORRECTION_EDGES as readonly string[]).includes(id);
}

// ---------------------------------------------------------------------------
// The request.
// ---------------------------------------------------------------------------

export interface TransitionReason {
  /**
   * Deliberately `string`, not `ReasonSource`: an off-allowlist source is what
   * step 1 exists to reject at RUNTIME, and a type that made the bad value
   * unrepresentable would delete the check along with the risk it guards.
   */
  source: string;
  /** `transitions.reason_code` — required on every `→ BLOCKED` edge. */
  code?: string;
  detail?: string;
  /** L10 only: the exact failed command, argv array. */
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
  /** The tree the gate actually ran against — not the tree somebody hoped it ran against. */
  candidateSha: string;
}

/**
 * The host gate rows behind `gatesPass`, and the gate ids the current config
 * requires. `gatesPass` is one boolean an earlier transition wrote; an edge
 * that PRESERVES a green must check the green rather than the flag summarising
 * it, and a pure guard cannot go and read the rows itself.
 *
 * This is the GATING-phase gate set measured against the candidate. The review
 * phase's own gate rows are not here — what an L25 request has to say about
 * those is `reviewEvidenceDefect`, and conflating the two would let a failed
 * `review_evidence_present` row read as a failed candidate gate.
 */
export interface GateEvidence {
  /** Every gate id the current configuration requires of this attempt. */
  configured: readonly string[];
  /** The recorded rows. Every configured id must appear. */
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

/** Everything the Guard column can ask for. Every field is somebody else's finding, never this layer's. */
export interface TransitionEvidence {
  worktreeCreated?: boolean;
  configValid?: boolean;
  preflight?: PreflightEvidence;
  baseSha?: string;
  workflowCompiled?: boolean;
  requiredPhasesTerminalSuccess?: boolean;
  hostCommitCreated?: boolean;
  candidateSha?: string;
  treeTerminated?: boolean;
  survivorsReported?: boolean;
  gatesPass?: boolean;
  gateEvidence?: GateEvidence;
  gatesInvalidated?: boolean;
  reviewInvalidated?: boolean;
  /** L25: why the recorded review is not evidence. A record, never a key — see `reviewEvidenceDefect`. */
  reviewInvalidationReason?: string;
  reworkRequest?: string;
  review?: ReviewEvidence;
  reviewTransportRetries?: number;
  /**
   * L25's eligibility, and L17's non-transport blocker. Deliberately `string`
   * rather than the closed unions in `errors.ts`, for the same reason
   * `TransitionReason.source` is: an off-vocabulary value is exactly what the
   * guard exists to reject at RUNTIME, and a type that made the bad value
   * unrepresentable would delete the check along with the risk it guards.
   */
  reviewEvidenceDefect?: string;
  reviewFailure?: string;
  /**
   * L25: host observation that the tree under review has not moved — worktree
   * HEAD is the candidate and clean, canonical HEAD is the base and clean.
   * Supplied evidence, because `core/src/state/**` may not touch a filesystem;
   * the physical read lives in the command that authorizes the edge.
   */
  candidateUnchanged?: boolean;
  landing?: LandingEvidence;
  headSha?: string;
  checkoutClean?: boolean;
   /**
   * L26: the reading that authorised the quota stop. Supplied evidence, because
   * `core/src/state/**` may neither spawn nor read a clock; the probe lives in
   * the command that authorizes the edge. `minutesToReset` is a number when the
   * read was usable and ABSENT when it was not — there is no "unknown" value to
   * mistake for zero, which is what makes fail-open structural rather than
   * conventional.
   */
  quotaStop?: QuotaStopEvidence;
}

/**
 * The two correction allowances, which are two different things that one pair
 * of counters used to carry.
 *
 * `auto` and `owner` bound the INTRA-PHASE correction (escalation-ladder rungs
 * 2–3). They are per PHASE — `beginPhase()` refreshes them, and the contract
 * that says so is stated verbatim in `call-budget.ts`.
 *
 * `ownerReentries` bounds OWNER RE-ENTRY (rungs 4–5: L16, L19, L25 and an
 * owner-actor L10). It is per ATTEMPT, charged when a task edge draws the owner
 * tranche, and reset only by `awsf retry`. Before it existed, a phase beginning
 * after an owner re-entry silently erased that charge.
 *
 * It is not a new configuration key: D3 couples the two, so the configured
 * `risk.correction_allowance.owner` bounds both — one owner-authorized
 * re-entry, of either kind, per attempt.
 */
export interface CorrectionAllowance {
  auto: number;
  owner: number;
  ownerReentries: number;
}

export interface QuotaStopEvidence {
  /** The adapter id whose configured threshold this reading was compared against. */
  route?: string;
  /** Minutes to the binding window's reset. Present only when the read was usable. */
  minutesToReset?: number;
  /** That route's configured threshold, in minutes. */
  thresholdMinutes?: number;
}

/**
 * Widens the configured `risk.correction_allowance` to the three counters the
 * ledger keeps, defaulting `ownerReentries` to the configured owner allowance.
 */
export function correctionAllowance(
  configured: { auto: number; owner: number; ownerReentries?: number },
): CorrectionAllowance {
  return {
    auto: configured.auto,
    owner: configured.owner,
    ownerReentries: configured.ownerReentries ?? configured.owner,
  };
}

/**
 * The `sessions` columns this layer reasons over: `calls_reserved`,
 * `calls_spent`, `corrections_auto`, `corrections_owner`, `owner_reentries`,
 * plus the limits from `risk.correction_allowance`.
 *
 * `callsSpent` is TASK-lifetime, not attempt-lifetime. Spend carries across
 * attempts, so failing repeatedly does not buy a larger budget.
 */
export interface BudgetState {
  attempt: number;
  callsSpent: number;
  callsReserved: number;
  correctionsAuto: number;
  correctionsOwner: number;
  /** Attempt-scoped. The counter every owner-authorized TASK edge draws on. */
  ownerReentries: number;
  allowance: CorrectionAllowance;
  /**
   * This task's effective call ceiling: its configured tier ceiling plus any
   * owner-granted raise. Optional because a journal written before the ceiling
   * became a dial records none, and reading one of those as the tier default is
   * the same answer it was actually run under — never an invented one.
   */
  ceiling?: number;
}

/**
 * Presence means "this transition intends to spawn"; `cost` is the FULL
 * declared cost, so a composite adapter running two workers and a fuser
 * declares 3 before anything launches.
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
    /** Calls this transition reserves: the spawn's declared cost, or 0. */
    calls: number;
    /** The correction tranche it draws from, if any. */
    correctionTranche: "auto" | "owner" | null;
  };
}

// ---------------------------------------------------------------------------
// The ordered rejection contract.
// ---------------------------------------------------------------------------

/**
 * A TASK edge's owner tranche is the attempt-scoped re-entry allowance, never
 * the per-phase owner counter. The two are separate accounts, and reading the
 * per-phase one here is what let a later `beginPhase()` refund an owner
 * re-entry it never authorized.
 */
function ownerTrancheSpent(budget: BudgetState): boolean {
  return budget.ownerReentries >= budget.allowance.ownerReentries;
}

function autoTrancheSpent(budget: BudgetState): boolean {
  return budget.correctionsAuto >= budget.allowance.auto;
}

/** The whole correction budget: once it is gone, no actor can restore it. */
function globalAllowanceSpent(budget: BudgetState): boolean {
  return autoTrancheSpent(budget) && ownerTrancheSpent(budget);
}

function trancheSpent(budget: BudgetState, tranche: "auto" | "owner"): boolean {
  return tranche === "auto" ? autoTrancheSpent(budget) : ownerTrancheSpent(budget);
}

/**
 * Decides one state change and reports what it costs. Throws the FIRST
 * applicable rejection in the plan's order — never the most convenient one.
 *
 * The function does not mutate: it returns the reservation the caller must
 * make, and the caller is what persists it. A pure decision is what lets the
 * whole matrix be replayed against a journal.
 */
export function transition(input: TransitionInput): TransitionResult {
  const { from, to, actor, tier, reason, interactive, budget, spawn } = input;

  // 1 — evidence legitimacy precedes everything. If a fabricated source could
  // reach any later check, a well-formed lie would pass all of them.
  const source: string | undefined = reason?.source;
  if (!isDeterministicSource(source)) {
    throw new NonDeterministicEvidence(from, to, source);
  }

  // 2 — a sealed attempt must say "this attempt is over".
  //
  // BLOCKED, CANCELLED, and PUBLISHED permit no outgoing transition.
  // LANDED remains terminal for reporting but permits the human-authorized
  // L27 transition to PUBLISHED.
  //
  // Narrowed to `from !== to` deliberately. Read literally this step would
  // swallow BLOCKED → BLOCKED, LANDED → LANDED and CANCELLED → CANCELLED and
  // make the class counts 30/7; the plan's class table states 27/10 with the
  // arithmetic spelled out ("3 × 9", "all ten X → X pairs"), and 76 decomposes
  // as 27 + 10 + 6 + 33 only under this reading. The reasoning column justifies
  // steps 2 and 3 each against step 5 and never against one another, so the
  // overlap was simply not considered when the order was written.
  if (isSealed(from) && from !== to) {
    throw new TerminalAttempt(from, to);
  }

  // 3 — before pair legality: a retry loop that self-transitions must hear
  // "you are already there", not "illegal pair".
  if (from === to) {
    throw new AlreadyInState(from, to);
  }

  // 4 — naming the violated invariant beats naming the violated pair.
  if (to === "LANDED" && from !== "LANDING") {
    throw new HumanGateBypass(from, to);
  }

  // 5 — only now is "unknown pair" the true, most-specific complaint.
  const edge = edgeFor(from, to);
  if (edge === undefined) {
    throw new IllegalTransition(from, to);
  }

  // The spawn-site closure. Not one of the eleven — it is a separate
  // invariant, and it sits here so it can never mask a pair complaint.
  const declaresSpawn = spawn !== undefined && spawn.cost > 0;
  if (declaresSpawn !== edge.spawnSite) {
    throw new IllegalSpawnSite(from, to, edge.id, declaresSpawn, edge.spawnSite);
  }

  const tranche = isCorrectionEdge(edge.id) ? ACTOR_TRANCHE[actor] : null;

  // 6 — the global budget outranks actor identity: reporting an actor
  // complaint first would invite switching actors, which cannot help.
  if (tranche !== null && globalAllowanceSpent(budget)) {
    throw new CorrectionAllowanceExhausted(
      "global",
      from,
      to,
      tranche,
      `auto ${budget.correctionsAuto}/${budget.allowance.auto}, owner re-entries ${budget.ownerReentries}/${budget.allowance.ownerReentries}`,
    );
  }

  // 7 — "you may never do this" beats "you ran out".
  if (!edge.actors.includes(actor)) {
    throw new ActorNotPermitted(from, to, edge.id, actor, edge.actors);
  }

  // 8 — the right actor in the wrong medium hears "come to a terminal".
  if (edge.interactive && !interactive) {
    throw new InteractiveOwnerRequired(from, to, edge.id, actor);
  }

  // 9 — actor-specific budget after actor legitimacy; the other tranche may remain.
  if (tranche !== null && trancheSpent(budget, tranche)) {
    throw new CorrectionAllowanceExhausted(
      "tranche",
      from,
      to,
      tranche,
      tranche === "auto"
        ? `auto ${budget.correctionsAuto}/${budget.allowance.auto}`
        : `owner re-entries ${budget.ownerReentries}/${budget.allowance.ownerReentries}`,
    );
  }

  // 10 — only a fully legitimate request earns a critique of its evidence.
  assertEvidence(edge, input);

  // 11 — last, because its remedy is economic and it must not mask a defect
  // the checks above would have named.
  const calls = spawn === undefined ? 0 : spawn.cost;
  if (spawn !== undefined) {
    const committed = budget.callsSpent + budget.callsReserved;
    // The attempt's own ceiling, so a machine decision and the ledger that
    // executes it cannot disagree about what an owner raise bought.
    if (!fitsCeiling(committed, calls, tier, budget.ceiling)) {
      throw new CallCeilingExceeded({
        from,
        to,
        subject: `${from} -> ${to} (${edge.id})`,
        tier,
        ceiling: ceilingFor(tier, budget.ceiling),
        requested: calls,
        committed,
      });
    }
  }

  return {
    edge: edge.id,
    from,
    to,
    actor,
    spawnSite: edge.spawnSite,
    spends: { calls, correctionTranche: tranche },
  };
}
