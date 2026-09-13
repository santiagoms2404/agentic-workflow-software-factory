// The reservation ledger: reserve before launch, spend on GO, release on
// registration failure.
//
// `core/src/state/tiers.ts` owns the ARITHMETIC — what a ceiling is, what a
// composite costs, whether a number fits. This file owns the LEDGER: the
// mutable, task-lifetime account that arithmetic is applied to, and the only
// place a call is ever committed.
//
// The invariant it exists to hold is economic, not structural:
//
//     spent + reserved <= ceiling(tier), at every observable moment,
//     under any interleaving of concurrent launches.
//
// That is why `reserve()` is synchronous and why it must stay synchronous. The
// check and the commit happen in one turn of the event loop with no `await`
// between them, so two concurrent paths cannot both read a spend counter that
// has not caught up yet and both slip under the ceiling. Making `reserve()`
// async — or awaiting anything between `fitsCeiling` and the increment — would
// reopen exactly the hole the reservation exists to close. A unit test pins
// this: `reserve` must not be an `AsyncFunction`.
//
// `callsSpent` is TASK-lifetime, never attempt-lifetime. `awsf retry` mints
// attempt n+1 and carries the spend forward, so failing repeatedly does not
// buy a larger budget.
//
// Nothing here spawns, reads a clock, or touches the filesystem. Reservation
// ids are host-minted and monotonic, so a replay of the same journal produces
// the same ids.

import { CallCeilingExceeded } from "../state/errors.ts";
import { assertTurnBinding, continuityDigest, InterruptedTurnRefused, type TurnBinding } from "../contracts/interrupted-turn.ts";
import { isVerifiedReconnectAuthorization, type VerifiedReconnectAuthorization } from "../workflow/turn-reconnect-authorization.ts";
import {
  phaseTransition,
  type PhaseTransitionInput,
  type PhaseTransitionResult,
} from "../state/phase-machine.ts";
import {
  correctionAllowance,
  transition,
  type BudgetState,
  type CorrectionAllowance,
  type EdgeId,
  type TransitionInput,
  type TransitionResult,
} from "../state/task-machine.ts";
import {
  assertCeiling,
  assertWorkflowFitsTier,
  ceilingFor,
  compositeCost,
  fitsCeiling,
  type ResolvedCeiling,
  type Tier,
  type WorkflowCallSpec,
} from "../state/tiers.ts";

// ---------------------------------------------------------------------------
// Faults.
// ---------------------------------------------------------------------------

/**
 * A reservation was settled twice, or settled by an id the ledger never issued.
 *
 * Loud rather than lenient: a double `spendOnGo` is a launcher that thinks it
 * got two `GO`s for one child, and silently absorbing it would bill the second
 * one to nobody.
 */
export class ReservationNotHeld extends Error {
  readonly reservationId: string;
  readonly state: string;

  constructor(reservationId: string, state: ReservationState | "unknown") {
    super(
      state === "unknown"
        ? `reservation ${reservationId} was never issued by this ledger`
        : `reservation ${reservationId} is already ${state}; a reservation settles exactly once`,
    );
    this.name = "ReservationNotHeld";
    this.reservationId = reservationId;
    this.state = state;
  }
}

/**
 * An attempt boundary was crossed with reservations still held.
 *
 * The ledger refuses to guess. A held reservation means a launch is in flight
 * and nobody has said whether the provider ran; releasing it would forgive a
 * call that may have been spent, and spending it would bill one that may never
 * have launched. Recovery reconstructs from the journal — it does not assume.
 */
export class ReservationOutstanding extends Error {
  readonly reservationIds: readonly string[];

  constructor(subject: string, reservationIds: readonly string[]) {
    super(
      `${subject}: ${reservationIds.length} reservation(s) still held (${reservationIds.join(", ")}); ` +
        `each must be spent on GO or released on registration failure first`,
    );
    this.name = "ReservationOutstanding";
    this.reservationIds = reservationIds;
  }
}

/** A settlement that does not add up to the reservation's declared cost. */
export class InvalidSettlement extends Error {
  constructor(reservationId: string, cost: number, spent: number) {
    super(
      `reservation ${reservationId} declared ${cost} call(s); a settlement of ${spent} spent is not between 0 and ${cost}`,
    );
    this.name = "InvalidSettlement";
  }
}

// ---------------------------------------------------------------------------
// Reservations.
// ---------------------------------------------------------------------------

export type ReservationState = "held" | "spent" | "released" | "part-spent";

/**
 * `single` is one provider call. `composite` is a fusion adapter's FULL
 * declared cost — two workers plus a fuser reserve three before any of the
 * three launch, so the fuser cannot discover the ceiling after the workers
 * have already burned quota.
 */
export type ReservationKind = "single" | "composite";

export interface ReservationRequest {
  /** The FULL declared cost. Always `>= 1`; a composite declares all of it. */
  cost: number;
  kind?: ReservationKind;
  /** The spawn-site edge this reservation was made for, when there is one. */
  edge?: EdgeId;
  /** Free-text subject for the refusal message a human reads. */
  subject?: string;
}

export interface Reservation {
  readonly id: string;
  readonly cost: number;
  readonly kind: ReservationKind;
  readonly edge: EdgeId | null;
  /** The attempt that made it — reservations never cross an attempt boundary. */
  readonly attempt: number;
  readonly state: ReservationState;
  /** How much of `cost` became spend. `0` until settlement. */
  readonly spent: number;
}

interface MutableReservation {
  id: string;
  cost: number;
  kind: ReservationKind;
  edge: EdgeId | null;
  attempt: number;
  state: ReservationState;
  spent: number;
}

function freeze(reservation: MutableReservation): Reservation {
  return { ...reservation };
}

// ---------------------------------------------------------------------------
// The workflow-fit hook.
// ---------------------------------------------------------------------------

/**
 * The hook `core/src/workflow/compiler.ts` calls before it admits a recipe.
 *
 * Two refusals, one error class. The first is the plan's rule: a workflow whose
 * minimum call count cannot fit the selected tier is rejected BEFORE execution,
 * not halfway through when the refusal has already cost the calls it is
 * refusing. The second is the same rule applied to a task that has already
 * spent: a retry of a T1 task with 2 calls behind it cannot admit a workflow
 * needing 3, even though T1's ceiling would have fit it at attempt 1.
 *
 * A free function, not a method, so the compiler can call it with nothing but a
 * tier — a workflow is admitted before any ledger exists for the run.
 */
export function admitWorkflow(
  workflow: WorkflowCallSpec,
  tier: Tier,
  committed = 0,
  resolved?: ResolvedCeiling,
): void {
  assertWorkflowFitsTier(workflow, tier, resolved);
  if (!fitsCeiling(committed, workflow.minimumCalls, tier, resolved)) {
    throw new CallCeilingExceeded({
      from: null,
      to: null,
      subject: `workflow ${workflow.id} at T${tier} with ${committed} already committed`,
      tier,
      ceiling: ceilingFor(tier, resolved),
      requested: workflow.minimumCalls,
      committed,
    });
  }
}

// ---------------------------------------------------------------------------
// The ledger.
// ---------------------------------------------------------------------------

export interface CallBudgetOptions {
  /** For the refusal message; the ledger itself is per task. */
  taskId: string;
  tier: Tier;
  /** Durable invocation namespace recorded by the host before reserving a recoverable turn. */
  reservationNamespace?: string;
  /**
   * `risk.correction_allowance` — the `auto`/`owner` pair is per phase,
   * defaulting to the config's `{auto: 1, owner: 1}`. `ownerReentries` is per
   * attempt and defaults to `owner`, because D3 couples them.
   */
  allowance?: { auto: number; owner: number; ownerReentries?: number };
  /**
   * This task's effective ceiling — its configured tier ceiling plus whatever
   * `awsf raise` granted it. Omitted, the tier's documented default applies,
   * which is what every caller predating the dial was already getting.
   */
  ceiling?: number;
  /**
   * Rehydration from the journal. Spend is task-lifetime, so a ledger rebuilt
   * mid-task starts where the last one left off. Reservations are deliberately
   * NOT rehydratable: a reservation is in-flight state, and a host that died
   * holding one leaves the journal to reconcile, not a counter to restore.
   */
  carried?: {
    attempt?: number;
    callsSpent?: number;
    correctionsAuto?: number;
    correctionsOwner?: number;
    ownerReentries?: number;
  };
}

const DEFAULT_ALLOWANCE = { auto: 1, owner: 1, ownerReentries: 1 } as const;

export class CallBudget {
  readonly taskId: string;
  readonly tier: Tier;
  readonly allowance: CorrectionAllowance;
  /** Resolved once at construction; a ledger's ceiling never moves under it. */
  readonly #resolvedCeiling: number;

  #attempt: number;
  #callsSpent: number;
  #correctionsAuto: number;
  #correctionsOwner: number;
  #ownerReentries: number;
  #held = new Map<string, MutableReservation>();
  #settled: MutableReservation[] = [];
  #nextId = 1;
  readonly #reservationNamespace: string | null;
  readonly #restorableSpend: number;
  #restoredSpend = 0;
  readonly #turnBindings = new Map<string, TurnBinding>();
  readonly #completedTurns = new Set<string>();
  readonly #reconnectLaunches = new Map<string, string>();
  readonly #reattachments = new Map<string, { digest: string; reservation: Reservation }>();

  constructor(options: CallBudgetOptions) {
    this.taskId = options.taskId;
    this.tier = options.tier;
    this.allowance = correctionAllowance(options.allowance ?? DEFAULT_ALLOWANCE);
    this.#resolvedCeiling = options.ceiling === undefined
      ? ceilingFor(options.tier)
      : assertCeiling(options.ceiling, `task ${options.taskId}`);
    const carried = options.carried ?? {};
    this.#attempt = carried.attempt ?? 1;
    this.#callsSpent = carried.callsSpent ?? 0;
    this.#restorableSpend = this.#callsSpent;
    this.#reservationNamespace = options.reservationNamespace ?? null;
    if (this.#reservationNamespace !== null && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(this.#reservationNamespace)) {
      throw new Error("invalid durable reservation namespace");
    }
    this.#correctionsAuto = carried.correctionsAuto ?? 0;
    this.#correctionsOwner = carried.correctionsOwner ?? 0;
    this.#ownerReentries = carried.ownerReentries ?? 0;
  }

  // -- Reading -------------------------------------------------------------

  get attempt(): number {
    return this.#attempt;
  }

  get callsSpent(): number {
    return this.#callsSpent;
  }

  /** The sum of every reservation still held — money promised, not yet paid. */
  get callsReserved(): number {
    let total = 0;
    for (const reservation of this.#held.values()) total += reservation.cost;
    return total;
  }

  /** What the ceiling is measured against: spend plus outstanding reservations. */
  get committed(): number {
    return this.#callsSpent + this.callsReserved;
  }

  get ceiling(): number {
    return ceilingFor(this.tier, this.#resolvedCeiling);
  }

  get remaining(): number {
    return this.ceiling - this.committed;
  }

  /** Exactly the `sessions` columns the pure machines reason over. */
  snapshot(): BudgetState {
    return {
      attempt: this.#attempt,
      callsSpent: this.#callsSpent,
      callsReserved: this.callsReserved,
      correctionsAuto: this.#correctionsAuto,
      correctionsOwner: this.#correctionsOwner,
      ownerReentries: this.#ownerReentries,
      allowance: { ...this.allowance },
      ceiling: this.#resolvedCeiling,
    };
  }

  outstanding(): readonly Reservation[] {
    return [...this.#held.values()].map(freeze);
  }

  reservation(id: string): Reservation | undefined {
    const held = this.#held.get(id);
    if (held !== undefined) return freeze(held);
    const settled = this.#settled.find((r) => r.id === id);
    return settled === undefined ? undefined : freeze(settled);
  }

  history(): readonly Reservation[] {
    return this.#settled.map(freeze);
  }

  // -- Reserving -----------------------------------------------------------

  /**
   * Reserve before launch. SYNCHRONOUS BY CONTRACT — see the file header.
   *
   * Throws `CallCeilingExceeded` before anything is mutated, so a refused
   * reservation costs nothing and leaves no trace to unwind. This is the check
   * that must happen before a child process exists, not after.
   */
  reserve(request: ReservationRequest): Reservation {
    const cost = request.cost;
    if (!Number.isInteger(cost) || cost < 1) {
      // A zero-cost reservation is not a cheap launch, it is an unbooked one.
      throw new RangeError(`task ${this.taskId}: a reservation costs at least one whole call, not ${cost}`);
    }
    const committed = this.committed;
    if (!fitsCeiling(committed, cost, this.tier, this.#resolvedCeiling)) {
      throw new CallCeilingExceeded({
        from: null,
        to: null,
        subject: request.subject ?? `task ${this.taskId}${request.edge === undefined ? "" : ` (${request.edge})`}`,
        tier: this.tier,
        ceiling: this.ceiling,
        requested: cost,
        committed,
      });
    }
    let id: string;
    do { id = `${this.#reservationNamespace === null ? "" : `${this.#reservationNamespace}:`}r${this.#nextId++}`; }
    while (this.reservation(id) !== undefined);
    const reservation: MutableReservation = {
      id,
      cost,
      kind: request.kind ?? (cost > 1 ? "composite" : "single"),
      edge: request.edge ?? null,
      attempt: this.#attempt,
      state: "held",
      spent: 0,
    };
    this.#held.set(reservation.id, reservation);
    return freeze(reservation);
  }

  /**
   * A composite adapter's full cost, declared in advance: `workers + 1` for the
   * fuser. One reservation, not `workers + 1` of them — a partial reservation
   * is what "declare the full cost" exists to forbid.
   */
  reserveComposite(workerCount: number, request: Omit<ReservationRequest, "cost" | "kind"> = {}): Reservation {
    return this.reserve({ ...request, cost: compositeCost(workerCount), kind: "composite" });
  }

  // -- Settling ------------------------------------------------------------

  /** The launcher received `GO`: the whole reservation becomes spend. */
  spendOnGo(id: string): Reservation {
    return this.settle(id, this.#requireHeld(id).cost);
  }

  /**
   * Registration failed and the provider NEVER RAN: the whole reservation goes
   * back. This is the case that makes "kill it anywhere" financially safe — a
   * provider that never executed must never cost a call.
   */
  releaseOnRegistrationFailure(id: string): Reservation {
    return this.settle(id, 0);
  }

  /**
   * The primitive both settlements are made of, and the honest answer for a
   * composite that lands halfway: two workers reached `GO`, the fuser's
   * registration failed, so two are spent and one goes back. `spent` plus the
   * released remainder always equals the declared cost — a reservation never
   * evaporates and never inflates.
   */
  settle(id: string, spent: number): Reservation {
    const reservation = this.#requireHeld(id);
    if (!Number.isInteger(spent) || spent < 0 || spent > reservation.cost) {
      throw new InvalidSettlement(id, reservation.cost, spent);
    }
    this.#held.delete(id);
    reservation.spent = spent;
    reservation.state = spent === 0 ? "released" : spent === reservation.cost ? "spent" : "part-spent";
    this.#callsSpent += spent;
    this.#settled.push(reservation);
    return freeze(reservation);
  }

  #requireHeld(id: string): MutableReservation {
    const held = this.#held.get(id);
    if (held !== undefined) return held;
    const settled = this.#settled.find((r) => r.id === id);
    throw new ReservationNotHeld(id, settled === undefined ? "unknown" : settled.state);
  }

  /** Reconstruct only journal-verified liabilities. Spent counters already include these debits. */
  restoreReservation(record: Reservation): Reservation {
    const existing = this.reservation(record.id);
    if (existing !== undefined) {
      if (continuityDigest(existing) !== continuityDigest(record)) throw new InterruptedTurnRefused("recovery-ambiguous", "reservation recovery disagrees with this ledger");
      return existing;
    }
    if (record.attempt !== this.#attempt || !record.id.includes(":") || record.kind !== "single" || record.cost !== 1 ||
        !["held", "spent", "released"].includes(record.state) || record.spent !== (record.state === "spent" ? 1 : 0)) {
      throw new InterruptedTurnRefused("recovery-ambiguous", "reservation recovery lacks an exact operation-qualified liability");
    }
    if (record.state === "spent" && this.#restoredSpend + record.spent > this.#restorableSpend) {
      throw new InterruptedTurnRefused("recovery-ambiguous", "restored debit exceeds journal-carried spend");
    }
    if (record.state === "held" && this.committed + record.cost > this.ceiling) {
      throw new InterruptedTurnRefused("recovery-ambiguous", "restored held liability exceeds the admitted ceiling");
    }
    if (record.state === "held") this.#held.set(record.id, { ...record });
    else {
      this.#settled.push({ ...record });
      this.#restoredSpend += record.spent;
    }
    return this.reservation(record.id)!;
  }

  /** Bind once before original dispatch, or restore from exact original authorization evidence. */
  bindOriginalTurn(binding: TurnBinding): void {
    assertTurnBinding(binding);
    const reservation = this.reservation(binding.originReservationId);
    if (reservation === undefined || reservation.cost !== 1 || !binding.originReservationId.includes(":") ||
        (reservation.state !== "held" && reservation.state !== "spent")) throw new InterruptedTurnRefused("recovery-ambiguous", "original turn has no usable ledger liability");
    const prior = this.#turnBindings.get(binding.logicalTurnId);
    if (prior !== undefined && continuityDigest(prior) !== continuityDigest(binding)) throw new InterruptedTurnRefused("binding-mismatch", "original turn authorization changed");
    for (const other of this.#turnBindings.values()) {
      if (other.originReservationId === binding.originReservationId && other.logicalTurnId !== binding.logicalTurnId &&
          !(binding.originalLaunchKind === "phase-correction" && binding.correctionRound > other.correctionRound &&
            binding.taskSessionId === other.taskSessionId && binding.phaseKey === other.phaseKey && binding.phaseOrdinal === other.phaseOrdinal)) {
        throw new InterruptedTurnRefused("binding-mismatch", "one original reservation cannot authorize unrelated turns");
      }
    }
    this.#turnBindings.set(binding.logicalTurnId, structuredClone(binding));
  }

  assertReconnectEligible(proof: VerifiedReconnectAuthorization): Reservation {
    if (!isVerifiedReconnectAuthorization(proof, this)) throw new InterruptedTurnRefused("proof-unavailable", "reconnect authorization was not issued for this ledger");
    const original = this.#turnBindings.get(proof.binding.logicalTurnId);
    if (original === undefined || continuityDigest(original) !== continuityDigest(proof.binding)) throw new InterruptedTurnRefused("binding-mismatch", "reconnect belongs to another ledger or original authorization");
    if (this.#completedTurns.has(original.logicalTurnId)) throw new InterruptedTurnRefused("turn-already-completed", "logical turn already completed");
    const reservation = this.reservation(original.originReservationId);
    if (reservation === undefined || (reservation.state !== "spent" && !(reservation.state === "held" && proof.providerNeverAccepted))) {
      throw new InterruptedTurnRefused("recovery-ambiguous", "original liability cannot be reused");
    }
    if (reservation.state !== proof.originalReservationState && this.#reattachments.get(proof.registration.reconnectOperationId)?.digest !== continuityDigest(proof)) {
      throw new InterruptedTurnRefused("binding-mismatch", "ledger liability state differs from durable reconnect admission");
    }
    return reservation;
  }

  /** Consume one physical launch intent synchronously, including across brokers sharing this ledger. */
  claimReconnectLaunch(proof: VerifiedReconnectAuthorization): void {
    this.assertReconnectEligible(proof);
    if (proof.stage !== "before-spawn" || this.#reconnectLaunches.has(proof.registration.reconnectOperationId)) {
      throw new InterruptedTurnRefused("recovery-ambiguous", "reconnect launch intent was already claimed or is at the wrong frontier");
    }
    this.#reconnectLaunches.set(proof.registration.reconnectOperationId, continuityDigest(proof.registration));
  }

  /** Invoked after reconnect registration and before GO. Never creates another reservation. */
  authorizeReconnect(proof: VerifiedReconnectAuthorization): Reservation {
    const original = this.assertReconnectEligible(proof);
    if (proof.stage !== "before-go" || this.#reconnectLaunches.get(proof.registration.reconnectOperationId) !== continuityDigest(proof.registration)) {
      throw new InterruptedTurnRefused("recovery-ambiguous", "reconnect has no matching claimed physical launch");
    }
    const key = proof.registration.reconnectOperationId;
    const digest = continuityDigest(proof);
    const settled = this.#reattachments.get(key);
    if (settled !== undefined) {
      if (settled.digest !== digest) throw new InterruptedTurnRefused("binding-mismatch", "reconnect operation was already accounted with different evidence");
      return { ...settled.reservation };
    }
    // Held, authoritatively never sent: convert the ORIGINAL liability once.
    // Already spent: return that debit without calling spendOnGo or settle.
    const reservation = original.state === "held" ? this.settle(original.id, original.cost) : original;
    this.#reattachments.set(key, { digest, reservation });
    return { ...reservation };
  }

  /** Crash settlement never refunds registered or launch-intent-ambiguous work. */
  settleRecoveredLiability(id: string, knowledge: "never-launched" | "launch-intent" | "registered" | "spent", quiescent: boolean): Reservation {
    const reservation = this.reservation(id);
    if (reservation === undefined) throw new InterruptedTurnRefused("recovery-ambiguous", "recovery names an unknown reservation");
    if (!quiescent || knowledge === "launch-intent") throw new InterruptedTurnRefused("recovery-ambiguous", "launch history or survivor state remains ambiguous");
    if (reservation.state === "spent") return reservation;
    if (reservation.state === "released") {
      if (knowledge !== "never-launched") throw new InterruptedTurnRefused("binding-mismatch", "registered work was recorded as released");
      return reservation;
    }
    if (reservation.state !== "held") throw new InterruptedTurnRefused("recovery-ambiguous", "partial composite recovery is unsupported");
    return this.settle(id, knowledge === "never-launched" ? 0 : reservation.cost);
  }

  markTurnCompleted(logicalTurnId: string): void {
    if (!this.#turnBindings.has(logicalTurnId)) throw new InterruptedTurnRefused("binding-mismatch", "completion names an unknown original turn");
    this.#completedTurns.add(logicalTurnId);
  }

  // -- Driving the machines ------------------------------------------------

  /**
   * Decide a task transition against the LIVE budget and commit what it costs.
   *
   * One entry point, so the two-tier economics are provable rather than
   * conventional: an edge the pure machine prices at zero calls cannot reserve
   * one here, and `GATING → RUNNING` — the escalation out of a spent phase —
   * cannot avoid reserving one. The reservation is made, not spent: the call
   * converts on `GO`, which is the launcher's event, not the machine's.
   */
  authorize(input: Omit<TransitionInput, "budget" | "tier">): {
    result: TransitionResult;
    reservation: Reservation | null;
  } {
    const result = transition({ ...input, tier: this.tier, budget: this.snapshot() });
    const reservation =
      result.spends.calls > 0
        ? this.reserve({ cost: result.spends.calls, edge: result.edge, subject: `${result.from} -> ${result.to} (${result.edge})` })
        : null;
    // A TASK edge drawing the owner tranche is an owner RE-ENTRY, and it is
    // charged to the attempt-scoped counter — never to the per-phase pair,
    // which the next `beginPhase()` would zero and thereby refund. The host's
    // own inter-state escalation (an L10 with actor `host`) still draws the
    // per-phase automatic tranche, exactly as it always has.
    if (result.spends.correctionTranche === "owner") this.#ownerReentries += 1;
    else if (result.spends.correctionTranche === "auto") this.#correctionsAuto += 1;
    return { result, reservation };
  }

  /**
   * Decide a phase transition against the live correction counters.
   *
   * Structurally incapable of touching the call ledger: it never calls
   * `reserve` or `settle`. Same-session corrections cost tokens only. A cold
   * correction is authorized by this allowance too, then its caller must make
   * a separate ordinary reservation against the tier ceiling before GO.
   */
  recordPhaseTransition(
    input: Omit<PhaseTransitionInput, "corrections" | "allowance">,
  ): PhaseTransitionResult {
    const result = phaseTransition({
      ...input,
      corrections: { auto: this.#correctionsAuto, owner: this.#correctionsOwner },
      // The phase machine is bounded by the PER-PHASE pair only. An owner
      // re-entry is a lifecycle act and never something a phase can spend.
      allowance: { auto: this.allowance.auto, owner: this.allowance.owner },
    });
    if (result.correctionTranche === "auto") this.#correctionsAuto += 1;
    else if (result.correctionTranche === "owner") this.#correctionsOwner += 1;
    return result;
  }

  // -- Boundaries ----------------------------------------------------------

  /**
   * The correction allowance is per PHASE (`{auto: 1, owner: 1}`), so a new
   * phase refreshes it. The call ledger is per TASK and is deliberately
   * untouched here — a workflow with five phases does not get five ceilings.
   *
   * `#ownerReentries` deliberately survives: it is per ATTEMPT, and a phase
   * beginning after an owner re-entry must not hand that allowance back. That
   * conflation was dormant only because the production runner never took a
   * correction edge; it is exactly what an owner-authorized replacement review
   * would have activated.
   */
  beginPhase(): void {
    this.#correctionsAuto = 0;
    this.#correctionsOwner = 0;
  }

  /**
   * An owner re-entry that bought nothing gives the allowance back.
   *
   * `authorize()` charges the tranche at the moment the edge is decided, which
   * is correct — the charge must be durable before a child can exist. But an
   * authorization whose reservation is released without ever reaching `GO`
   * bought the owner no provider turn at all, and keeping the charge would
   * confiscate the one re-entry an attempt gets for a launch that never
   * happened. This is the caller's assertion that nothing was spent, so it
   * refuses while any reservation is still held: a held reservation is exactly
   * the state in which "nothing was spent" is not yet known.
   *
   * `awsf review` calls this from its own recovery path. `awsf rework`
   * deliberately does not — changing what a failed rework costs is a normative
   * change, and this commit is not authorized to make it.
   */
  rewindOwnerReentry(): void {
    if (this.#held.size > 0) {
      throw new ReservationOutstanding(
        `task ${this.taskId} cannot rewind an owner re-entry`,
        [...this.#held.keys()],
      );
    }
    if (this.#ownerReentries === 0) {
      throw new RangeError(`task ${this.taskId} has no owner re-entry charge to rewind`);
    }
    this.#ownerReentries -= 1;
  }

  /**
   * `awsf retry` minted attempt n+1. Spend carries forward unchanged; the
   * attempt number moves, and the attempt-scoped owner re-entry allowance is
   * refreshed along with the per-phase pair — a new attempt is the one thing
   * that buys the owner another re-entry.
   *
   * Refuses while a reservation is held, for the reason `ReservationOutstanding`
   * gives: the ledger will not decide on a caller's behalf whether an in-flight
   * provider ran.
   */
  beginAttempt(attempt: number): void {
    if (this.#held.size > 0) {
      throw new ReservationOutstanding(
        `task ${this.taskId} cannot open attempt ${attempt}`,
        [...this.#held.keys()],
      );
    }
    if (!Number.isInteger(attempt) || attempt <= this.#attempt) {
      throw new RangeError(
        `attempt numbers are monotonic: ${attempt} does not follow ${this.#attempt} for task ${this.taskId}`,
      );
    }
    this.#attempt = attempt;
    this.#ownerReentries = 0;
    this.beginPhase();
  }

  /** The compiler's hook, bound to this ledger's tier and what it has already committed. */
  admitWorkflow(workflow: WorkflowCallSpec): void {
    admitWorkflow(workflow, this.tier, this.committed, this.#resolvedCeiling);
  }
}
