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
import {
  phaseTransition,
  type PhaseTransitionInput,
  type PhaseTransitionResult,
} from "../state/phase-machine.ts";
import {
  transition,
  type BudgetState,
  type EdgeId,
  type TransitionInput,
  type TransitionResult,
} from "../state/task-machine.ts";
import {
  assertWorkflowFitsTier,
  ceilingFor,
  compositeCost,
  fitsCeiling,
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
export function admitWorkflow(workflow: WorkflowCallSpec, tier: Tier, committed = 0): void {
  assertWorkflowFitsTier(workflow, tier);
  if (!fitsCeiling(committed, workflow.minimumCalls, tier)) {
    throw new CallCeilingExceeded({
      from: null,
      to: null,
      subject: `workflow ${workflow.id} at T${tier} with ${committed} already committed`,
      tier,
      ceiling: ceilingFor(tier),
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
  /** `risk.correction_allowance` — per phase, defaulting to the config's `{auto: 1, owner: 1}`. */
  allowance?: { auto: number; owner: number };
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
  };
}

const DEFAULT_ALLOWANCE = { auto: 1, owner: 1 } as const;

export class CallBudget {
  readonly taskId: string;
  readonly tier: Tier;
  readonly allowance: { auto: number; owner: number };

  #attempt: number;
  #callsSpent: number;
  #correctionsAuto: number;
  #correctionsOwner: number;
  #held = new Map<string, MutableReservation>();
  #settled: MutableReservation[] = [];
  #nextId = 1;

  constructor(options: CallBudgetOptions) {
    this.taskId = options.taskId;
    this.tier = options.tier;
    this.allowance = { ...(options.allowance ?? DEFAULT_ALLOWANCE) };
    const carried = options.carried ?? {};
    this.#attempt = carried.attempt ?? 1;
    this.#callsSpent = carried.callsSpent ?? 0;
    this.#correctionsAuto = carried.correctionsAuto ?? 0;
    this.#correctionsOwner = carried.correctionsOwner ?? 0;
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
    return ceilingFor(this.tier);
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
      allowance: { ...this.allowance },
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
    if (!fitsCeiling(committed, cost, this.tier)) {
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
    const reservation: MutableReservation = {
      id: `r${this.#nextId++}`,
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
    if (result.spends.correctionTranche !== null) {
      this.#chargeCorrection(result.spends.correctionTranche);
    }
    return { result, reservation };
  }

  /**
   * Decide a phase transition against the live correction counters.
   *
   * Structurally incapable of touching the call ledger: it never calls
   * `reserve` or `settle`. Intra-phase corrections re-prompt the SAME provider
   * session — they cost tokens, not calls, and this is where that is enforced
   * rather than remembered.
   */
  recordPhaseTransition(
    input: Omit<PhaseTransitionInput, "corrections" | "allowance">,
  ): PhaseTransitionResult {
    const result = phaseTransition({
      ...input,
      corrections: { auto: this.#correctionsAuto, owner: this.#correctionsOwner },
      allowance: { ...this.allowance },
    });
    if (result.correctionTranche !== null) {
      this.#chargeCorrection(result.correctionTranche);
    }
    return result;
  }

  #chargeCorrection(tranche: "auto" | "owner"): void {
    if (tranche === "auto") this.#correctionsAuto += 1;
    else this.#correctionsOwner += 1;
  }

  // -- Boundaries ----------------------------------------------------------

  /**
   * The correction allowance is per PHASE (`{auto: 1, owner: 1}`), so a new
   * phase refreshes it. The call ledger is per TASK and is deliberately
   * untouched here — a workflow with five phases does not get five ceilings.
   */
  beginPhase(): void {
    this.#correctionsAuto = 0;
    this.#correctionsOwner = 0;
  }

  /**
   * `awsf retry` minted attempt n+1. Spend carries forward unchanged; only the
   * attempt number moves.
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
    this.beginPhase();
  }

  /** The compiler's hook, bound to this ledger's tier and what it has already committed. */
  admitWorkflow(workflow: WorkflowCallSpec): void {
    admitWorkflow(workflow, this.tier, this.committed);
  }
}
