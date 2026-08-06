// The task lifecycle: ten states, twenty-four legal edges, seventy-six
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
  "BLOCKED",
  "CANCELLED",
] as const;
export type TaskState = (typeof TASK_STATES)[number];

/** Terminal for THIS attempt. `awsf retry` mints attempt n+1 at DRAFT — which is not a transition. */
export const TERMINAL_STATES = ["LANDED", "BLOCKED", "CANCELLED"] as const;

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
  | "L17" | "L18" | "L19" | "L20" | "L21" | "L22" | "L23" | "L24";

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

/** The twenty-four legal transitions, in L-order. */
export const LEGAL_EDGES: readonly LegalEdge[] = [
  { id: "L1",  from: "DRAFT",          to: "PREPARED",       actors: ["host"],          spawnSite: false, interactive: false },
  { id: "L2",  from: "DRAFT",          to: "BLOCKED",        actors: ["host"],          spawnSite: false, interactive: false },
  { id: "L3",  from: "DRAFT",          to: "CANCELLED",      actors: ["human"],         spawnSite: false, interactive: true  },
  { id: "L4",  from: "PREPARED",       to: "RUNNING",        actors: ["host"],          spawnSite: true,  interactive: false },
  { id: "L5",  from: "PREPARED",       to: "BLOCKED",        actors: ["host"],          spawnSite: false, interactive: false },
  { id: "L6",  from: "PREPARED",       to: "CANCELLED",      actors: ["human"],         spawnSite: false, interactive: true  },
  { id: "L7",  from: "RUNNING",        to: "GATING",         actors: ["host"],          spawnSite: false, interactive: false },
  { id: "L8",  from: "RUNNING",        to: "BLOCKED",        actors: ["host"],          spawnSite: false, interactive: false },
  { id: "L9",  from: "RUNNING",        to: "CANCELLED",      actors: ["human"],         spawnSite: false, interactive: true  },
  { id: "L10", from: "GATING",         to: "RUNNING",        actors: ["host", "owner"], spawnSite: true,  interactive: false },
  { id: "L11", from: "GATING",         to: "REVIEWING",      actors: ["host"],          spawnSite: true,  interactive: false },
  { id: "L12", from: "GATING",         to: "AWAITING_OWNER", actors: ["host"],          spawnSite: false, interactive: false },
  { id: "L13", from: "GATING",         to: "BLOCKED",        actors: ["host"],          spawnSite: false, interactive: false },
  { id: "L14", from: "GATING",         to: "CANCELLED",      actors: ["human"],         spawnSite: false, interactive: true  },
  { id: "L15", from: "REVIEWING",      to: "AWAITING_OWNER", actors: ["host"],          spawnSite: false, interactive: false },
  { id: "L16", from: "REVIEWING",      to: "RUNNING",        actors: ["owner"],         spawnSite: true,  interactive: false },
  { id: "L17", from: "REVIEWING",      to: "BLOCKED",        actors: ["host"],          spawnSite: false, interactive: false },
  { id: "L18", from: "REVIEWING",      to: "CANCELLED",      actors: ["human"],         spawnSite: false, interactive: true  },
  { id: "L19", from: "AWAITING_OWNER", to: "RUNNING",        actors: ["human"],         spawnSite: true,  interactive: true  },
  { id: "L20", from: "AWAITING_OWNER", to: "LANDING",        actors: ["human"],         spawnSite: false, interactive: true  },
  { id: "L21", from: "AWAITING_OWNER", to: "BLOCKED",        actors: ["host"],          spawnSite: false, interactive: false },
  { id: "L22", from: "AWAITING_OWNER", to: "CANCELLED",      actors: ["human"],         spawnSite: false, interactive: true  },
  { id: "L23", from: "LANDING",        to: "LANDED",         actors: ["host"],          spawnSite: false, interactive: false },
  { id: "L24", from: "LANDING",        to: "BLOCKED",        actors: ["host"],          spawnSite: false, interactive: false },
];

/** The three edges that draw on a correction allowance — escalation-ladder rungs 4 and 5. */
export const CORRECTION_EDGES = ["L10", "L16", "L19"] as const;

const EDGE_BY_PAIR: ReadonlyMap<string, LegalEdge> = new Map(
  LEGAL_EDGES.map((e) => [`${e.from}->${e.to}`, e]),
);

export function edgeFor(from: TaskState, to: TaskState): LegalEdge | undefined {
  return EDGE_BY_PAIR.get(`${from}->${to}`);
}

function isTerminal(state: TaskState): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(state);
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
  gatesInvalidated?: boolean;
  reviewInvalidated?: boolean;
  reworkRequest?: string;
  review?: ReviewEvidence;
  reviewTransportRetries?: number;
  landing?: LandingEvidence;
  headSha?: string;
  checkoutClean?: boolean;
}

/**
 * The `sessions` columns this layer reasons over: `calls_reserved`,
 * `calls_spent`, `corrections_auto`, `corrections_owner`, plus the limits from
 * `risk.correction_allowance`.
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
  allowance: { auto: number; owner: number };
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

/** The whole correction budget: once it is gone, no actor can restore it. */
function globalAllowanceSpent(budget: BudgetState): boolean {
  return (
    budget.correctionsAuto >= budget.allowance.auto &&
    budget.correctionsOwner >= budget.allowance.owner
  );
}

function trancheSpent(budget: BudgetState, tranche: "auto" | "owner"): boolean {
  return tranche === "auto"
    ? budget.correctionsAuto >= budget.allowance.auto
    : budget.correctionsOwner >= budget.allowance.owner;
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
  // Narrowed to `from !== to` deliberately. Read literally this step would
  // swallow BLOCKED → BLOCKED, LANDED → LANDED and CANCELLED → CANCELLED and
  // make the class counts 30/7; the plan's class table states 27/10 with the
  // arithmetic spelled out ("3 × 9", "all ten X → X pairs"), and 76 decomposes
  // as 27 + 10 + 6 + 33 only under this reading. The reasoning column justifies
  // steps 2 and 3 each against step 5 and never against one another, so the
  // overlap was simply not considered when the order was written.
  if (isTerminal(from) && from !== to) {
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
      `auto ${budget.correctionsAuto}/${budget.allowance.auto}, owner ${budget.correctionsOwner}/${budget.allowance.owner}`,
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
        : `owner ${budget.correctionsOwner}/${budget.allowance.owner}`,
    );
  }

  // 10 — only a fully legitimate request earns a critique of its evidence.
  assertEvidence(edge, input);

  // 11 — last, because its remedy is economic and it must not mask a defect
  // the checks above would have named.
  const calls = spawn === undefined ? 0 : spawn.cost;
  if (spawn !== undefined) {
    const committed = budget.callsSpent + budget.callsReserved;
    if (!fitsCeiling(committed, calls, tier)) {
      throw new CallCeilingExceeded({
        from,
        to,
        subject: `${from} -> ${to} (${edge.id})`,
        tier,
        ceiling: ceilingFor(tier),
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
