// The rejection vocabulary of the Lifecycle Contract.
//
// Eleven ordered rejections, one spawn-site invariant, and the two closed
// vocabularies the guards check against. Every class carries the ordered pair
// it refused: a journal entry that says "illegal" without saying WHICH pair is
// useless to the human reading it at 2 a.m.
//
// Pure by construction — this file imports no runtime module at all.

import type { TaskState } from "./task-machine.ts";
import type { Tier } from "./tiers.ts";

// ---------------------------------------------------------------------------
// Closed vocabularies.
// ---------------------------------------------------------------------------

/**
 * Step 1's closed allowlist: "process state, exit codes, git state, gate
 * results, record faults, explicit human input". Six sources, no seventh.
 *
 * A clock is deliberately absent, and that absence is load-bearing:
 * AWAITING_OWNER has no timeout, so no timer can produce L21 no matter what
 * else it satisfies. Membership is EXACT — no trimming, no case folding. A
 * machine that lower-cases its way to acceptance has a hole a prompt can
 * drive through.
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

export function isDeterministicSource(source: string | undefined): source is ReasonSource {
  return (DETERMINISTIC_REASON_SOURCES as readonly string[]).includes(source ?? "");
}

/**
 * Every reason code a `→ BLOCKED` edge may carry, per edge, gathered from the
 * Guard column of L2, L5, L8, L13, L17, L21 and L24.
 *
 * The vocabulary is closed AND per-edge: an unrecognized code is not a
 * blocker, it is an unexplained halt, and a code from another edge's
 * vocabulary is a misdiagnosis. L5 carries L8's fault vocabulary and NOT
 * `preflight-failed`, because preflight must already have passed to reach
 * PREPARED.
 */
export const EDGE_BLOCKER_CODES = {
  L2: ["preflight-failed"],
  L5: ["crash", "silence", "quota-exhausted", "phase-abort", "permission-breach", "budget-exhausted"],
  L8: ["crash", "silence", "quota-exhausted", "phase-abort", "permission-breach", "budget-exhausted"],
  L13: ["correction-budget-exhausted"],
  // L17 names the three review failures the HOST can declare terminal without
  // interpreting a verdict. `review-unavailable` is transport after one retry;
  // `review-malformed` is an envelope TypeBox either validated or did not;
  // `review-evidence-invalid` is a `review_evidence_present` row that failed or
  // a post-review revalidation that found the tree moved. A `verdict_consistent`
  // failure is deliberately absent — an inconsistent verdict is CONTENT, and
  // the host does not decide what a bad review means.
  L17: ["review-unavailable", "review-malformed", "review-evidence-invalid"],
  L21: ["record-corrupt", "unknown-state", "ambiguous-pid", "unreadable-worktree"],
  L24: ["non-fast-forward", "dirty-canonical-tree", "git-failure", "ambiguous-recovery"],
} as const satisfies Record<string, readonly string[]>;

/** The union of every per-edge set — `reason.code ∈ BLOCKER_CODES` in L2's guard. */
export const BLOCKER_CODES: readonly string[] = [
  ...new Set(Object.values(EDGE_BLOCKER_CODES).flat()),
].sort();

/**
 * L25's eligibility vocabulary — two members, both HOST-determined from the
 * persisted gate rows of the recorded review phase.
 *
 * `evidence-gate-absent` is a review phase with no `review_evidence_present`
 * row at all: every review produced before that gate existed, which is the
 * legacy class the edge exists to migrate. `evidence-gate-failed` is a row
 * whose `passed` is false.
 *
 * The list is exactly two long on purpose. A review carrying a PASSING
 * evidence row is not replaceable at all — its verdict stands, whatever it
 * says, and the owner's remedies are the ones the contract already provides.
 * The owner's `--reason` string is a record, never a key: if disliking a
 * verdict could buy a replacement review, the mandatory opposite-provider
 * review would be a one-shot lottery, and "you may only do it once" is not an
 * answer to that, because once is enough.
 */
export const REVIEW_EVIDENCE_DEFECTS = ["evidence-gate-absent", "evidence-gate-failed"] as const;
export type ReviewEvidenceDefect = (typeof REVIEW_EVIDENCE_DEFECTS)[number];

// ---------------------------------------------------------------------------
// The base.
// ---------------------------------------------------------------------------

/**
 * Every refusal the state layer can produce.
 *
 * `from`/`to` are `string | null` rather than `TaskState` because the phase
 * submachine and the workflow-fit check reuse this hierarchy and do not speak
 * in task states; the task-level subclasses below still take `TaskState`
 * arguments, so nothing untyped reaches a task rejection.
 */
export class StateError extends Error {
  readonly from: string | null;
  readonly to: string | null;

  constructor(name: string, from: string | null, to: string | null, message: string) {
    super(message);
    this.name = name;
    this.from = from;
    this.to = to;
  }
}

function pair(from: string, to: string): string {
  return `${from} -> ${to}`;
}

// ---------------------------------------------------------------------------
// The eleven ordered rejections.
// ---------------------------------------------------------------------------

/** Step 1. Evidence legitimacy precedes everything: a well-formed lie must not reach any later check. */
export class NonDeterministicEvidence extends StateError {
  readonly source: string | null;

  constructor(from: TaskState, to: TaskState, source: string | undefined) {
    super(
      "NonDeterministicEvidence",
      from,
      to,
      `${pair(from, to)}: reason.source ${source === undefined ? "(absent)" : JSON.stringify(source)} is not on the deterministic allowlist (${DETERMINISTIC_REASON_SOURCES.join(", ")})`,
    );
    this.source = source ?? null;
  }
}

/** Step 2. A sealed attempt says "this attempt is over" — the fix is `awsf retry`, not a different pair. */
export class TerminalAttempt extends StateError {
  constructor(from: TaskState, to: TaskState) {
    super(
      "TerminalAttempt",
      from,
      to,
      `${pair(from, to)}: ${from} is terminal for this attempt; \`awsf retry\` mints attempt n+1 at DRAFT`,
    );
  }
}

/** Step 3. "You are already there" is more precise than "illegal pair", and a self-transitioning retry loop must hear it. */
export class AlreadyInState extends StateError {
  constructor(from: TaskState, to: TaskState) {
    super("AlreadyInState", from, to, `${pair(from, to)}: the task is already in ${from}`);
  }
}

/** Step 4. Naming the violated invariant beats naming the violated pair: an automation bug that tries to land is exactly that. */
export class HumanGateBypass extends StateError {
  constructor(from: TaskState, to: TaskState) {
    super(
      "HumanGateBypass",
      from,
      to,
      `${pair(from, to)}: LANDED is reachable only from LANDING, which is reachable only through a human at a TTY`,
    );
  }
}

/** Step 5. Only now is "unknown pair" the true, most-specific complaint. */
export class IllegalTransition extends StateError {
  constructor(from: TaskState, to: TaskState) {
    super("IllegalTransition", from, to, `${pair(from, to)}: not one of the twenty-five legal transitions`);
  }
}

/**
 * Steps 6 and 9. `scope` tells them apart: `global` means no actor can restore
 * the budget (so reporting an actor complaint first would invite switching
 * actors, which cannot help), `tranche` means this actor's own share is spent
 * and the other actor's may remain.
 */
export class CorrectionAllowanceExhausted extends StateError {
  readonly scope: "global" | "tranche";
  readonly tranche: "auto" | "owner" | null;

  constructor(
    scope: "global" | "tranche",
    from: string,
    to: string,
    tranche: "auto" | "owner" | null,
    detail: string,
  ) {
    super(
      "CorrectionAllowanceExhausted",
      from,
      to,
      `${pair(from, to)}: the ${scope === "global" ? "whole correction budget" : `${String(tranche)} correction tranche`} is spent (${detail})`,
    );
    this.scope = scope;
    this.tranche = tranche;
  }
}

/** Step 7. Actor legitimacy precedes actor-specific budgets: "you may never do this" beats "you ran out". */
export class ActorNotPermitted extends StateError {
  readonly actor: string;
  readonly permitted: readonly string[];

  constructor(from: TaskState, to: TaskState, edge: string, actor: string, permitted: readonly string[]) {
    super(
      "ActorNotPermitted",
      from,
      to,
      `${pair(from, to)} (${edge}): ${actor} may not make this transition; ${edge} permits ${permitted.join("/")}`,
    );
    this.actor = actor;
    this.permitted = permitted;
  }
}

/** Step 8. The right actor in the wrong medium must hear "come to a terminal", not a budget or evidence complaint. */
export class InteractiveOwnerRequired extends StateError {
  readonly actor: string;

  constructor(from: TaskState, to: TaskState, edge: string, actor: string) {
    super(
      "InteractiveOwnerRequired",
      from,
      to,
      `${pair(from, to)} (${edge}): a human edge requires an interactive terminal; piped stdin and API callers cannot make it`,
    );
    this.actor = actor;
  }
}

/** Step 10. Only a fully legitimate request earns a critique of its evidence — otherwise fabricating evidence would look like the fix. */
export class InsufficientEvidence extends StateError {
  readonly edge: string;
  readonly violations: readonly string[];

  constructor(from: TaskState, to: TaskState, edge: string, violations: readonly string[]) {
    super(
      "InsufficientEvidence",
      from,
      to,
      `${pair(from, to)} (${edge}): ${violations.join("; ")}`,
    );
    this.edge = edge;
    this.violations = violations;
  }
}

/**
 * Step 11. Last, because it is the only rejection whose remedy is economic —
 * a new attempt or an owner decision — and it must not mask a defect the
 * checks above would have named. Carries the ceiling and the price so the
 * owner can decide without reading the code.
 */
export class CallCeilingExceeded extends StateError {
  readonly tier: Tier;
  readonly ceiling: number;
  readonly requested: number;
  readonly committed: number;

  constructor(options: {
    from: TaskState | null;
    to: TaskState | null;
    subject: string;
    tier: Tier;
    ceiling: number;
    requested: number;
    committed: number;
  }) {
    super(
      "CallCeilingExceeded",
      options.from,
      options.to,
      `${options.subject}: ${options.committed} of T${options.tier}'s ${options.ceiling} calls are already committed and this would reserve ${options.requested} more`,
    );
    this.tier = options.tier;
    this.ceiling = options.ceiling;
    this.requested = options.requested;
    this.committed = options.committed;
  }
}

// ---------------------------------------------------------------------------
// The spawn-site closure — not one of the eleven.
// ---------------------------------------------------------------------------

/**
 * "Spawn ⇔ entering an executing state." The plan states the rule as a
 * closure, so BOTH directions are the same invariant: a spawn declared on an
 * edge that does not enter RUNNING or REVIEWING, and an edge that does enter
 * one without declaring a reservation, are the same defect — a provider
 * launched off the books.
 */
export class IllegalSpawnSite extends StateError {
  readonly edge: string;
  readonly declared: boolean;

  constructor(from: TaskState, to: TaskState, edge: string, declared: boolean, spawnSite: boolean) {
    super(
      "IllegalSpawnSite",
      from,
      to,
      declared && !spawnSite
        ? `${pair(from, to)} (${edge}): spawning is legal only on edges entering RUNNING or REVIEWING`
        : `${pair(from, to)} (${edge}): an edge into an executing state must declare its reservation before launch`,
    );
    this.edge = edge;
    this.declared = declared;
  }
}

// ---------------------------------------------------------------------------
// The phase submachine.
// ---------------------------------------------------------------------------

/** A phase-state pair that is not on the submachine's edge list. */
export class IllegalPhaseTransition extends StateError {
  readonly phase: string;

  constructor(phase: string, from: string, to: string) {
    super("IllegalPhaseTransition", from, to, `phase ${phase}: ${pair(from, to)} is not a phase transition`);
    this.phase = phase;
  }
}

/**
 * CORRECTING → RUNNING must resume the SAME adapter, provider, model and
 * provider session. A cold restart wearing a correction's name loses every
 * turn of context the correction is supposed to build on, and bills for it
 * twice.
 */
export class SessionIdentityBroken extends StateError {
  readonly phase: string;
  readonly differences: readonly string[];

  constructor(phase: string, differences: readonly string[]) {
    super(
      "SessionIdentityBroken",
      "CORRECTING",
      "RUNNING",
      `phase ${phase}: a correction must resume the same session, but ${differences.join("; ")}`,
    );
    this.phase = phase;
    this.differences = differences;
  }
}

/**
 * Permission breaches, host failures and transport errors are not correctable
 * and block immediately. Only invalid JSON and correctable gate violations
 * share the allowance.
 */
export class UncorrectableViolation extends StateError {
  readonly phase: string;
  readonly cause: string;

  constructor(phase: string, cause: string) {
    super(
      "UncorrectableViolation",
      "VALIDATING",
      "CORRECTING",
      `phase ${phase}: ${cause} is not correctable — the phase fails and the task blocks`,
    );
    this.phase = phase;
    this.cause = cause;
  }
}
