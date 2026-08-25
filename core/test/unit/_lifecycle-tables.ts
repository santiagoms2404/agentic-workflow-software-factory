// The Lifecycle Contract, transcribed.
//
// Every table below is copied by hand out of `specs/awsf-plan.html`
// § "The Lifecycle Contract". Nothing here is derived from
// `core/src/state/**` — that is the whole point of T4: the legal set is
// enumerated LITERALLY so the implementation written in T5 cannot quietly
// define its own semantics and still be green.
//
// If a table here and the plan disagree, the plan wins and this file is wrong.
//
// One place the plan disagrees with ITSELF is recorded at
// `TERMINAL_ATTEMPT_PAIRS` — read that note before changing anything.

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

/** Terminal for this attempt. `awsf retry` mints attempt n+1 at DRAFT — not a transition. */
export const TERMINAL_STATES = ["LANDED", "BLOCKED", "CANCELLED"] as const;

/** The six states a human may cancel from (L3 / L6 / L9 / L14 / L18 / L22). LANDING is not one. */
export const CANCELLABLE_STATES = [
  "DRAFT",
  "PREPARED",
  "RUNNING",
  "GATING",
  "REVIEWING",
  "AWAITING_OWNER",
] as const;

/** `sessions.risk_tier INTEGER NOT NULL CHECK (risk_tier IN (0,1,2))` — the DDL is the state layer's vocabulary. */
export type Tier = 0 | 1 | 2;

/** `transitions.actor TEXT NOT NULL CHECK (actor IN ('host','owner','human'))`. */
export const ACTORS = ["host", "owner", "human"] as const;
export type Actor = (typeof ACTORS)[number];

export type EdgeId =
  | "L1" | "L2" | "L3" | "L4" | "L5" | "L6" | "L7" | "L8"
  | "L9" | "L10" | "L11" | "L12" | "L13" | "L14" | "L15" | "L16"
  | "L17" | "L18" | "L19" | "L20" | "L21" | "L22" | "L23" | "L24"
  | "L25" | "L26";

export interface LegalEdge {
  readonly id: EdgeId;
  readonly from: TaskState;
  readonly to: TaskState;
  /** The Actor column of the L-table, read literally. No widening. */
  readonly actors: readonly Actor[];
  /** The ✦ column: legal only on edges entering RUNNING or REVIEWING. */
  readonly spawnSite: boolean;
  /** Guard prose says "explicit, interactive" / "interactive TTY". */
  readonly interactive: boolean;
}

/**
 * The twenty-six legal transitions, in L-order, exactly as the amended plan's
 * L-table lists them. This array IS the legal set; no test may compute it from
 * the implementation.
 */
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
];

/** "L4, L10, L11, L16, L19, L25 — precisely the edges entering RUNNING or REVIEWING." */
export const SPAWN_SITE_EDGES = ["L4", "L10", "L11", "L16", "L19", "L25"] as const;

/** The four edges that consume a correction allowance (escalation-ladder rungs 4 and 5). */
export const CORRECTION_EDGES = ["L10", "L16", "L19", "L25"] as const;

// ---------------------------------------------------------------------------
// The seventy-four illegal ordered pairs, by class.
// ---------------------------------------------------------------------------

export type Pair = readonly [TaskState, TaskState];

/**
 * 27 = 3 terminal sources × the OTHER NINE states.
 *
 * NOTE — the one place the plan's two normative tables disagree. The class
 * table defines this class as "every pair from BLOCKED, LANDED, CANCELLED to
 * any of the OTHER NINE states (3 × 9)" = 27, and defines the self-transition
 * class as "all ten X → X pairs" = 10. The 11-step order, read literally,
 * would instead give `TerminalAttempt` (step 2) to BLOCKED → BLOCKED,
 * LANDED → LANDED and CANCELLED → CANCELLED, making the counts 30 / 7.
 *
 * The counts win, and step 2 is read as narrowed to `from` terminal AND
 * `from !== to`. Reasons: the first three classes remain 27 / 10 / 6 after
 * the single-cell L25 and L26 amendments; only the final class changed from
 * 33 to 32 and then 31. The reasoning column justifies steps 2 and 3
 * each against step 5 ("illegal pair") and never against one another — the
 * overlap was not considered when the order was written. `rejection-order.test.ts`
 * pins this reading explicitly instead of leaving it implicit.
 *
 * The last class read 33 until L25 (`AWAITING_OWNER → REVIEWING`) became
 * legal, then 31 when L26 (`RUNNING → AWAITING_OWNER`) became legal. Each is
 * a single-cell amendment: only the "everything else" class moved, and the
 * first three classes' arithmetic is untouched.
 */
export const TERMINAL_ATTEMPT_PAIRS: readonly Pair[] = [
  ["LANDED", "DRAFT"], ["LANDED", "PREPARED"], ["LANDED", "RUNNING"],
  ["LANDED", "GATING"], ["LANDED", "REVIEWING"], ["LANDED", "AWAITING_OWNER"],
  ["LANDED", "LANDING"], ["LANDED", "BLOCKED"], ["LANDED", "CANCELLED"],

  ["BLOCKED", "DRAFT"], ["BLOCKED", "PREPARED"], ["BLOCKED", "RUNNING"],
  ["BLOCKED", "GATING"], ["BLOCKED", "REVIEWING"], ["BLOCKED", "AWAITING_OWNER"],
  ["BLOCKED", "LANDING"], ["BLOCKED", "LANDED"], ["BLOCKED", "CANCELLED"],

  ["CANCELLED", "DRAFT"], ["CANCELLED", "PREPARED"], ["CANCELLED", "RUNNING"],
  ["CANCELLED", "GATING"], ["CANCELLED", "REVIEWING"], ["CANCELLED", "AWAITING_OWNER"],
  ["CANCELLED", "LANDING"], ["CANCELLED", "LANDED"], ["CANCELLED", "BLOCKED"],
];

/** 10 = "all ten X → X pairs, including RUNNING → RUNNING". */
export const ALREADY_IN_STATE_PAIRS: readonly Pair[] = TASK_STATES.map(
  (s) => [s, s] as Pair,
);

/**
 * 6 = {DRAFT, PREPARED, RUNNING, GATING, REVIEWING, AWAITING_OWNER} → LANDED.
 * LANDING → LANDED is L23 (legal); the three terminal sources fall under
 * `TerminalAttempt`, which fires earlier; LANDED → LANDED is a self-transition.
 */
export const HUMAN_GATE_BYPASS_PAIRS: readonly Pair[] = [
  ["DRAFT", "LANDED"],
  ["PREPARED", "LANDED"],
  ["RUNNING", "LANDED"],
  ["GATING", "LANDED"],
  ["REVIEWING", "LANDED"],
  ["AWAITING_OWNER", "LANDED"],
];

/** 31 = everything else: skip-aheads, backward jumps not on the correction list, and LANDING's dead ends. */
export const ILLEGAL_TRANSITION_PAIRS: readonly Pair[] = [
  // DRAFT — 5 skip-aheads.
  ["DRAFT", "RUNNING"], ["DRAFT", "GATING"], ["DRAFT", "REVIEWING"],
  ["DRAFT", "AWAITING_OWNER"], ["DRAFT", "LANDING"],

  // PREPARED — 1 backward, 4 skip-aheads.
  ["PREPARED", "DRAFT"], ["PREPARED", "GATING"], ["PREPARED", "REVIEWING"],
  ["PREPARED", "AWAITING_OWNER"], ["PREPARED", "LANDING"],

  // RUNNING — 2 backward; RUNNING → REVIEWING is illegal because review reads a
  // committed diff, so GATING is mandatory first. RUNNING → AWAITING_OWNER left
  // this class when L26 added a guarded quota suspension that advances no work.
  ["RUNNING", "DRAFT"], ["RUNNING", "PREPARED"], ["RUNNING", "REVIEWING"],
  ["RUNNING", "LANDING"],

  // GATING — 2 backward, 1 skip-ahead.
  ["GATING", "DRAFT"], ["GATING", "PREPARED"], ["GATING", "LANDING"],

  // REVIEWING — 3 backward, 1 skip-ahead.
  ["REVIEWING", "DRAFT"], ["REVIEWING", "PREPARED"], ["REVIEWING", "GATING"],
  ["REVIEWING", "LANDING"],

  // AWAITING_OWNER — 3 backward. AWAITING_OWNER → REVIEWING left this class
  // when L25 was added: the owner may re-buy a review of an unchanged
  // candidate whose recorded review carried no evidence.
  ["AWAITING_OWNER", "DRAFT"], ["AWAITING_OWNER", "PREPARED"],
  ["AWAITING_OWNER", "GATING"],

  // LANDING — 6 backward plus LANDING → CANCELLED: the cancel note lists
  // L3/L6/L9/L14/L18/L22 only, so a landing in progress is not cancellable.
  ["LANDING", "DRAFT"], ["LANDING", "PREPARED"], ["LANDING", "RUNNING"],
  ["LANDING", "GATING"], ["LANDING", "REVIEWING"], ["LANDING", "AWAITING_OWNER"],
  ["LANDING", "CANCELLED"],
];

export type RejectionName =
  | "NonDeterministicEvidence"
  | "TerminalAttempt"
  | "AlreadyInState"
  | "HumanGateBypass"
  | "IllegalTransition"
  | "CorrectionAllowanceExhausted"
  | "ActorNotPermitted"
  | "InteractiveOwnerRequired"
  | "InsufficientEvidence"
  | "CallCeilingExceeded"
  // Not one of the eleven ordered rejections: the spawn-site closure
  // ("spawn ⇔ entering RUNNING or REVIEWING") is a separate invariant.
  | "IllegalSpawnSite";

export interface RejectionStep {
  readonly step: number;
  readonly error: RejectionName;
  /** `CorrectionAllowanceExhausted` appears twice; the scope tells the two apart. */
  readonly scope?: "global" | "tranche";
  readonly firesWhen: string;
}

/** The ordered rejection contract, steps 1–11. Evaluated strictly in order. */
export const REJECTION_ORDER: readonly RejectionStep[] = [
  { step: 1,  error: "NonDeterministicEvidence", firesWhen: "reason.source not on the closed allowlist" },
  { step: 2,  error: "TerminalAttempt",          firesWhen: "from-state is BLOCKED / LANDED / CANCELLED" },
  { step: 3,  error: "AlreadyInState",           firesWhen: "self-transition" },
  { step: 4,  error: "HumanGateBypass",          firesWhen: "target is LANDED from anything but LANDING" },
  { step: 5,  error: "IllegalTransition",        firesWhen: "the pair is not one of the 26" },
  { step: 6,  error: "CorrectionAllowanceExhausted", scope: "global",  firesWhen: "the whole correction budget is gone" },
  { step: 7,  error: "ActorNotPermitted",        firesWhen: "pair is legal, this actor may not make it" },
  { step: 8,  error: "InteractiveOwnerRequired", firesWhen: "a human edge attempted without a TTY" },
  { step: 9,  error: "CorrectionAllowanceExhausted", scope: "tranche", firesWhen: "this actor's own tranche is spent" },
  { step: 10, error: "InsufficientEvidence",     firesWhen: "pair, actor, budget fine; evidence is not" },
  { step: 11, error: "CallCeilingExceeded",      firesWhen: "a spawn-site edge at the per-tier or lifetime ceiling" },
];

// ---------------------------------------------------------------------------
// Evidence vocabulary.
// ---------------------------------------------------------------------------

/**
 * Step 1's closed allowlist: "process state, exit codes, git state, gate
 * results, record faults, explicit human input". Six sources, no seventh.
 * A clock is deliberately absent — that is what makes L21 clock-proof.
 */
export const DETERMINISTIC_REASON_SOURCES = [
  "process",
  "exit-code",
  "git",
  "gate",
  "record",
  "human",
] as const;
export type ReasonSource = (typeof DETERMINISTIC_REASON_SOURCES)[number];

/**
 * Sources that must never reach a later check. The conversational ones are the
 * "well-formed lie" case; `clock`/`timer`/`timeout` are here because
 * AWAITING_OWNER has no timeout and no clock may produce a transition out of it.
 */
export const NON_DETERMINISTIC_REASON_SOURCES = [
  "model",
  "assistant",
  "conversation",
  "chat",
  "transcript",
  "agent-claim",
  "llm",
  "reviewer-opinion",
  "summary",
  "clock",
  "timer",
  "timeout",
  "heuristic",
  "inference",
  "",
  // Case and whitespace variants of allowlisted values: an allowlist is exact
  // membership, never a fuzzy match.
  "HUMAN",
  "Process",
  " git",
  "gate ",
] as const;

/**
 * Every reason code a `→ BLOCKED` edge may carry, gathered from the guard
 * column of L2, L5, L8, L13, L17, L21 and L24. A closed vocabulary: an
 * unrecognized code is not a blocker, it is an unexplained halt.
 */
export const EDGE_BLOCKER_CODES = {
  // L2 — preflight failure. The only way to fail out of DRAFT.
  L2: ["preflight-failed"],
  // L5 — "fault". Preflight already passed to reach PREPARED, so it is not a
  // preflight code; it is the L8 fault vocabulary.
  L5: ["crash", "silence", "quota-exhausted", "phase-abort", "permission-breach", "budget-exhausted"],
  // L8 — "crash / silence / quota / phase abort / permission breach / budget exhaustion".
  L8: ["crash", "silence", "quota-exhausted", "phase-abort", "permission-breach", "budget-exhausted"],
  // L13 — "gates failed, correction budget exhausted".
  L13: ["correction-budget-exhausted"],
  // L17 — the three review failures the host may declare terminal without
  // interpreting a verdict: "mandatory review unavailable after one transport
  // retry", an envelope that failed schema validation, and a
  // `review_evidence_present` row that failed. A `verdict_consistent` failure
  // is deliberately not among them.
  L17: ["review-unavailable", "review-malformed", "review-evidence-invalid"],
  // L21 — the plan names these four and only these four.
  L21: ["record-corrupt", "unknown-state", "ambiguous-pid", "unreadable-worktree"],
  // L24 — "non-FF, dirty canonical tree, Git failure, ambiguous crash recovery".
  L24: ["non-fast-forward", "dirty-canonical-tree", "git-failure", "ambiguous-recovery"],
} as const satisfies Record<string, readonly string[]>;

/** The union of every per-edge set — `reason.code ∈ BLOCKER_CODES` in L2's guard. */
export const BLOCKER_CODES: readonly string[] = [
  ...new Set(Object.values(EDGE_BLOCKER_CODES).flat()),
].sort();

// ---------------------------------------------------------------------------
// Ceilings and allowances.
// ---------------------------------------------------------------------------

/** T0 = 1, T1 = 3, T2 = 5. `awsf.config.yaml` calls these `risk.call_ceiling`. */
export const CALL_CEILINGS: Readonly<Record<Tier, number>> = { 0: 1, 1: 3, 2: 5 };

/**
 * `risk.correction_allowance: {auto: 1, owner: 1}`, widened to the three
 * counters the ledger keeps. `auto` and `owner` are per PHASE; `ownerReentries`
 * is per ATTEMPT and is coupled to the configured owner allowance by D3 — one
 * owner-authorized re-entry, of either kind, per attempt.
 */
export const CORRECTION_ALLOWANCE = { auto: 1, owner: 1, ownerReentries: 1 } as const;

/**
 * L25's eligibility vocabulary — two members, both determined by the host from
 * the recorded review phase's gate rows. A review carrying a PASSING
 * `review_evidence_present` row is not replaceable at all.
 */
export const REVIEW_EVIDENCE_DEFECTS = ["evidence-gate-absent", "evidence-gate-failed"] as const;

/**
 * The actor → tranche map. `host` draws the automatic tranche; `owner` and
 * `human` draw the owner tranche — which is what makes "L10's second
 * correction is owner-only" true and keeps step 9's rationale ("the other
 * actor's tranche may remain") meaningful.
 */
export const ACTOR_TRANCHE: Readonly<Record<Actor, "auto" | "owner">> = {
  host: "auto",
  owner: "owner",
  human: "owner",
};

/**
 * The six workflows of the Phase Contract with their minimum PROVIDER-call
 * count — `code` phases (tests, typecheck) and `engineer` phases (the request)
 * run on the host and reserve nothing.
 */
export const WORKFLOW_MINIMUM_CALLS: readonly {
  readonly id: string;
  readonly tier: Tier;
  readonly minimumCalls: number;
}[] = [
  { id: "scout",           tier: 0, minimumCalls: 1 }, // request → scout
  { id: "plan",            tier: 0, minimumCalls: 1 }, // request → planner
  { id: "build",           tier: 1, minimumCalls: 1 }, // request → builder → tests(code)
  { id: "plan-build-test", tier: 1, minimumCalls: 2 }, // request → planner → builder → tests(code)
  { id: "build-review",    tier: 2, minimumCalls: 2 }, // request → builder → tests(code) → reviewer
  { id: "simple-sdlc",     tier: 2, minimumCalls: 4 }, // planner → builder → tests → documenter → final tests → reviewer
];

// ---------------------------------------------------------------------------
// Derived-for-convenience only. Never a substitute for the literal tables.
// ---------------------------------------------------------------------------

export function edgeFor(from: TaskState, to: TaskState): LegalEdge | undefined {
  return LEGAL_EDGES.find((e) => e.from === from && e.to === to);
}

export function edge(id: EdgeId): LegalEdge {
  const found = LEGAL_EDGES.find((e) => e.id === id);
  if (!found) throw new Error(`no such edge in the L-table: ${id}`);
  return found;
}

export function pairKey(from: TaskState, to: TaskState): string {
  return `${from}->${to}`;
}

export function allOrderedPairs(): Pair[] {
  return TASK_STATES.flatMap((from) => TASK_STATES.map((to) => [from, to] as Pair));
}

/** The class table, as a lookup keyed by `from->to`. Built from the four literal lists. */
export const REJECTION_CLASS_BY_PAIR: ReadonlyMap<string, RejectionName> = new Map<string, RejectionName>([
  ...TERMINAL_ATTEMPT_PAIRS.map((p) => [pairKey(p[0], p[1]), "TerminalAttempt"] as const),
  ...ALREADY_IN_STATE_PAIRS.map((p) => [pairKey(p[0], p[1]), "AlreadyInState"] as const),
  ...HUMAN_GATE_BYPASS_PAIRS.map((p) => [pairKey(p[0], p[1]), "HumanGateBypass"] as const),
  ...ILLEGAL_TRANSITION_PAIRS.map((p) => [pairKey(p[0], p[1]), "IllegalTransition"] as const),
]);
