import { commandLedgerKey, type CommandDispatcherId, type CommandDispatchIntent,
  type CommandDispatchResult, type CommandOccurrenceClosed,
  type CommandOccurrenceOpened } from "../contracts/command-ledger.ts";

/**
 * One occurrence that reached its dispatch point.
 *
 * Derived from a `candidate_hygiene` gate record that PASSED. Every dispatcher
 * persists that record unconditionally and awaits it before the first spawn, so
 * it is the one observable an ungoverned binary cannot fail to leave behind —
 * unlike the `commands_pass` aggregate, which is the last statement after the
 * loop and is skipped by every abort, including the crash-inside-`spawnSync`
 * that recovery exists for.
 *
 * A FAILING hygiene record is not a dispatch point: that path returns before any
 * command runs, so its occurrence legitimately holds no ledger evidence.
 */
export interface CommandDispatchPoint {
  readonly dispatcherId: CommandDispatcherId;
  readonly occurrenceKey: string;
}

/** What is durably on disk for one result's retained output, as the reader observed it. */
export interface RetainedOutputObservation {
  readonly intentId: string;
  /** Null when the file is missing or unreadable — torn evidence, never a restore. */
  readonly bytes: number | null;
  readonly digest: string | null;
}

export interface CommandLedgerSnapshot {
  readonly intents: readonly CommandDispatchIntent[];
  readonly results: readonly CommandDispatchResult[];
  readonly openings: readonly CommandOccurrenceOpened[];
  readonly closures: readonly CommandOccurrenceClosed[];
  readonly dispatchPoints: readonly CommandDispatchPoint[];
  readonly retained: readonly RetainedOutputObservation[];
}

/**
 * Everything a restore must match, supplied by the caller from what it is about
 * to run rather than read back from the record it is checking.
 *
 * `gateIds` is the CURRENT `config.gates` key set. It is the completeness
 * predicate's quantifier domain, and it has to come from here: the gate evidence
 * record carries no list of configured gates, and deriving the domain from the
 * ledger's own intents would be circular — an ungoverned occurrence has zero
 * intents, so it would be vacuously complete.
 */
export interface CommandExpectation {
  readonly dispatcherId: CommandDispatcherId;
  readonly occurrenceKey: string;
  readonly gateId: string;
  readonly gateIds: readonly string[];
  readonly argvDigest: string;
  readonly gateConfigDigest: string;
  readonly gatesConfigDigest: string;
  readonly cwd: string;
  readonly worktreeRealPath: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly candidateSha: string;
  readonly attempt: number;
  readonly sessionId: string;
}

export type CommandRecovery =
  | { readonly action: "dispatch" }
  | { readonly action: "restore"; readonly intent: CommandDispatchIntent; readonly result: CommandDispatchResult }
  | { readonly action: "refuse"; readonly reason: string };

/** The adopted-measurement decision for a host command phase reusing the builder's work. */
export type AdoptedMeasurement =
  | { readonly action: "dispatch" }
  | { readonly action: "adopt"; readonly entries: readonly { readonly intent: CommandDispatchIntent; readonly result: CommandDispatchResult }[] }
  | { readonly action: "refuse"; readonly reason: string };

const refuse = (reason: string): CommandRecovery => Object.freeze({ action: "refuse" as const, reason });

const keyOf = (entry: { dispatcherId: CommandDispatcherId; occurrenceKey: string; gateId: string }): string =>
  commandLedgerKey(entry.dispatcherId, entry.occurrenceKey, entry.gateId);

const isClosed = (snapshot: CommandLedgerSnapshot, dispatcherId: CommandDispatcherId, occurrenceKey: string): boolean =>
  snapshot.closures.some(closure => closure.dispatcherId === dispatcherId && closure.occurrenceKey === occurrenceKey);

/**
 * This occurrence was reached by a host that records what it dispatches.
 *
 * This is the whole of what makes "no intent" mean "never ran", and it must be
 * evaluated BEFORE the caller writes its own opening — otherwise a run that
 * correctly refuses leaves behind the very marker that would convince the next
 * run the occurrence was always governed, and that run re-dispatches the
 * owner's argv over an unknown prior effect.
 */
export function ledgerGovernanceFailure(
  snapshot: CommandLedgerSnapshot, dispatcherId: CommandDispatcherId, occurrenceKey: string,
): string | null {
  // Scoped to THIS occurrence, not the whole journal. Soundness only needs one
  // thing: that the occurrence whose absent intent is being read was run by a
  // host that records dispatches. Another occurrence's history says nothing
  // about this key, and quantifying globally would make one legacy phase
  // anywhere poison every later decision in the attempt.
  const reached = snapshot.dispatchPoints.some(point =>
    point.dispatcherId === dispatcherId && point.occurrenceKey === occurrenceKey);
  if (!reached) return null;

  // The snapshot is read BEFORE this run writes its own hygiene record, so a
  // dispatch point visible here belongs to an EARLIER run. If that run had been
  // ledger-aware it would have left an opening or a closure; a bare hygiene
  // record means some host reached the dispatch point and recorded nothing.
  const governed = snapshot.openings.some(opening =>
    opening.dispatcherId === dispatcherId && opening.occurrenceKey === occurrenceKey) ||
    isClosed(snapshot, dispatcherId, occurrenceKey);
  if (!governed) {
    return `a configured-command dispatch point (${dispatcherId} ${occurrenceKey}) was reached by a host that does not record dispatches, so a command may have run outside the ledger`;
  }
  return null;
}

/**
 * A3's cut table for one owner-configured command.
 *
 * Every non-`restore` branch leaves the candidate, the worktree, the retained
 * bytes and the liability exactly as found. Corruption refuses rather than
 * re-dispatching, because re-running argv that may already have had an effect is
 * the thing this ledger exists to prevent.
 */
export function planCommandRecovery(snapshot: CommandLedgerSnapshot, expectation: CommandExpectation): CommandRecovery {
  const governance = ledgerGovernanceFailure(snapshot, expectation.dispatcherId, expectation.occurrenceKey);
  if (governance !== null) return refuse(governance);

  const key = keyOf(expectation);
  const intents = snapshot.intents.filter(intent => keyOf(intent) === key);
  if (intents.length > 1) return refuse("two dispatch intents share one ledger key");
  const intent = intents[0];
  if (intent === undefined) {
    if (isClosed(snapshot, expectation.dispatcherId, expectation.occurrenceKey)) {
      return refuse("this occurrence was closed before the gate was dispatched; its remaining commands were withheld deliberately and are not resumable");
    }
    return Object.freeze({ action: "dispatch" as const });
  }

  const results = snapshot.results.filter(result => result.intentId === intent.intentId);
  if (results.length > 1) return refuse("two dispatch results cite one intent");
  const result = results[0];
  if (result === undefined) {
    return refuse("a configured command was dispatched for this occurrence with no durable result; a missing result is not proof that it did not run, so recovery neither re-dispatches it nor accepts the measurement");
  }

  const drift = bindingDrift(intent, expectation);
  if (drift !== null) return refuse(drift);

  if (result.outcome === "withheld") {
    return refuse("this command's output was withheld by the credential check, so no measurement was retained and none can be restored");
  }
  if (result.outcome === "no-exit") {
    return refuse("this command never reported an exit status, so whether it completed, timed out or was killed is unknown and its measurement is not restorable");
  }
  if (!result.cleanAfter) {
    return refuse("this command left the worktree dirty, which aborts the measurement; a dirty cut is never restored as a passing one");
  }
  if (result.headAfter !== expectation.candidateSha) {
    return refuse("this command moved the candidate, which aborts the measurement");
  }

  const observation = snapshot.retained.find(entry => entry.intentId === intent.intentId);
  if (observation === undefined || observation.digest === null || observation.bytes === null) {
    return refuse("the retained output this result cites is missing or unreadable");
  }
  if (observation.digest !== result.outputDigest || observation.bytes !== result.outputBytes) {
    return refuse("the retained output does not match the digest and length this result recorded");
  }

  return Object.freeze({ action: "restore" as const, intent, result });
}

function bindingDrift(intent: CommandDispatchIntent, expectation: CommandExpectation): string | null {
  if (intent.argvDigest !== expectation.argvDigest) return "the configured command's argv changed since it was dispatched";
  if (intent.gateConfigDigest !== expectation.gateConfigDigest) return "this gate's configuration changed since it was dispatched";
  if (intent.gatesConfigDigest !== expectation.gatesConfigDigest) return "the configured gate set changed since it was dispatched";
  if (intent.cwd !== expectation.cwd) return "the command was dispatched from a different working directory";
  if (intent.worktreeRealPath !== expectation.worktreeRealPath) return "the worktree moved since the command was dispatched";
  if (intent.timeoutMs !== expectation.timeoutMs) return "this gate's timeout changed since it was dispatched";
  if (intent.maxOutputBytes !== expectation.maxOutputBytes) return "the output ceiling changed since the command was dispatched";
  if (intent.candidateSha !== expectation.candidateSha) return "the measurement was taken against a different candidate";
  if (intent.attempt !== expectation.attempt) return "the measurement belongs to another attempt";
  if (intent.sessionId !== expectation.sessionId) return "the measurement belongs to another session";
  return null;
}

/**
 * A host command phase reusing the measurement the builder already took.
 *
 * This reproduces exactly one existing edge and no more. Today
 * `candidateMeasurements` is written ONLY by the builder's `verifyCandidate` and
 * read by any host command phase against the same SHA — so scoping adoption to
 * `origin: "verify-candidate"` is what keeps a second command phase from
 * inheriting the first one's dispatch and silently never running. A recipe with
 * two such phases is the ordinary case, not a corner one.
 *
 * The builder measures at most one round per SHA — each correction round commits
 * a new candidate, and a round that commits nothing never reaches the
 * measurement — so there is at most one adoptable occurrence and no round to
 * choose between. A torn one refuses rather than falling back to an older
 * measurement, which would launder an unknown effect.
 */
export function planAdoptedMeasurement(
  snapshot: CommandLedgerSnapshot,
  expectation: Omit<CommandExpectation, "gateId" | "occurrenceKey">,
): AdoptedMeasurement {
  // Adoption reads another occurrence's records, so that occurrence's
  // governance is the one that matters.
  const sourceKeys = [...new Set(snapshot.intents
    .filter(intent => intent.dispatcherId === expectation.dispatcherId && intent.origin === "verify-candidate" &&
      intent.candidateSha === expectation.candidateSha)
    .map(intent => intent.occurrenceKey))];
  for (const key of sourceKeys) {
    const governance = ledgerGovernanceFailure(snapshot, expectation.dispatcherId, key);
    if (governance !== null) return Object.freeze({ action: "refuse" as const, reason: governance });
  }

  const adoptable = snapshot.intents.filter(intent =>
    intent.dispatcherId === expectation.dispatcherId && intent.origin === "verify-candidate" &&
    intent.candidateSha === expectation.candidateSha && intent.attempt === expectation.attempt &&
    intent.sessionId === expectation.sessionId);
  if (adoptable.length === 0) return Object.freeze({ action: "dispatch" as const });

  // The occurrence key comes from the records themselves rather than being
  // rebuilt by the caller, so the adopting phase never has to know how the
  // producing phase spelled its own key.
  const keys = [...new Set(adoptable.map(intent => intent.occurrenceKey))];
  if (keys.length > 1) {
    return Object.freeze({ action: "refuse" as const,
      reason: "more than one builder measurement exists for this candidate, so which one the phase would adopt is ambiguous" });
  }
  const occurrenceKey = keys[0]!;

  const entries: { intent: CommandDispatchIntent; result: CommandDispatchResult }[] = [];
  for (const gateId of expectation.gateIds) {
    const planned = planCommandRecovery(snapshot, { ...expectation, occurrenceKey, gateId });
    if (planned.action === "refuse") return Object.freeze({ action: "refuse" as const, reason: planned.reason });
    if (planned.action === "dispatch") {
      return Object.freeze({ action: "refuse" as const,
        reason: `the builder's measurement of this candidate is incomplete for gate ${gateId}, and an incomplete occurrence is never topped up from a later one` });
    }
    entries.push({ intent: planned.intent, result: planned.result });
  }
  return Object.freeze({ action: "adopt" as const, entries: Object.freeze(entries) });
}

/**
 * Reduce the ledger to the one verdict the `verify-candidate` stage needs.
 *
 * The stage is interrupted mid-measurement: the commit is already durable and
 * what is unresolved is which configured commands ran. Every gate must be
 * decidable, and a single refusal makes the whole stage refuse — a measurement
 * assembled from some restored gates and some unknown ones is not a measurement.
 */
export function planVerifyCandidateLedger(
  snapshot: CommandLedgerSnapshot,
  expectations: readonly CommandExpectation[],
): { readonly action: "restore-all" } | { readonly action: "resume"; readonly gateIds: readonly string[] } | { readonly action: "refuse"; readonly reason: string } {
  const dispatch: string[] = [];
  for (const expectation of expectations) {
    const planned = planCommandRecovery(snapshot, expectation);
    if (planned.action === "refuse") return Object.freeze({ action: "refuse" as const, reason: planned.reason });
    if (planned.action === "dispatch") dispatch.push(expectation.gateId);
  }
  return dispatch.length === 0
    ? Object.freeze({ action: "restore-all" as const })
    : Object.freeze({ action: "resume" as const, gateIds: Object.freeze(dispatch) });
}
