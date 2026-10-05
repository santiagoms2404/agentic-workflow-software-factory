// Whose fault a blocked run was, by heuristic. Pure: one frozen table read
// with the code the run blocked on, which is the blocking phase's
// `error_code` (the name of the error it failed with) when it has one, and
// the BLOCKED transition's `reason_code` otherwise. A code the table does not
// hold is `unknown`, never the nearest guess.
//
// Only a `model` block counts against a route (W18 F5, D4). The owner's
// journaled override takes precedence over this value where one exists.

import { ATTRIBUTION_CAUSES, type AttributionCause } from "../contracts/attribution-record.ts";

/** The effective attribution's vocabulary, which is the owner record's. The heuristic never answers `owner`; only the owner's override can. */
export const ATTRIBUTIONS = ATTRIBUTION_CAUSES;
export type Attribution = AttributionCause;

/** One phase of the run, host phases included, as the projection holds it. */
export interface RunPhase {
  readonly key: string;
  readonly ordinal: number;
  /** `agent` runs a provider; `code` and `engineer` phases are executed by the host. */
  readonly kind: string;
  readonly owner: string;
  readonly status: string;
  readonly errorCode: string | null;
}

export interface RunTransition {
  readonly seq: number;
  readonly toState: string;
  readonly reasonCode: string | null;
}

export interface AttributionRun {
  readonly lifecycleState: string;
  readonly phases: readonly RunPhase[];
  readonly transitions: readonly RunTransition[];
}

/**
 * When a row of the table applies. `after-build`: the blocking phase is a host
 * phase and the agent phase it judged belongs to the builder. `host-phase`:
 * the blocking phase is a host phase.
 */
export type AttributionCondition = "always" | "after-build" | "host-phase";

export interface AttributionRule {
  readonly code: string;
  readonly when: AttributionCondition;
  readonly attribution: Exclude<Attribution, "owner">;
}

export const HEURISTIC_ATTRIBUTION_RULES: readonly AttributionRule[] = Object.freeze(([
  { code: "CommandPhaseFailure", when: "after-build", attribution: "model" },
  { code: "PhaseGateFailure", when: "always", attribution: "model" },
  { code: "EnvelopeValidationFailure", when: "always", attribution: "model" },
  { code: "ReplacementReviewInconsistent", when: "always", attribution: "model" },
  { code: "ReplacementReviewMalformed", when: "always", attribution: "model" },
  { code: "PermissionBreach", when: "always", attribution: "model" },
  { code: "AdapterError", when: "always", attribution: "factory" },
  { code: "OwnerReworkCredentialRejected", when: "always", attribution: "factory" },
  // A bare `Error` is the host's own code failing, and only a host phase runs nothing else.
  { code: "Error", when: "host-phase", attribution: "factory" },
  { code: "ExecutableNotFound", when: "always", attribution: "environment" },
  // The catch-all blocker code: it says the phase stopped, not why.
  { code: "phase-abort", when: "always", attribution: "unknown" },
] as const satisfies readonly AttributionRule[]).map((rule): AttributionRule => Object.freeze({ ...rule })));

function isHostPhase(phase: RunPhase): boolean {
  return phase.kind !== "agent";
}

/** The phase a BLOCKED run stopped in: its last FAILED phase by ordinal. `null` for any other run, or when no phase failed. */
export function blockingPhase(run: AttributionRun): RunPhase | null {
  if (run.lifecycleState !== "BLOCKED") return null;
  let blocking: RunPhase | null = null;
  for (const phase of run.phases) {
    if (phase.status === "FAILED" && (blocking === null || phase.ordinal > blocking.ordinal)) blocking = phase;
  }
  return blocking;
}

/** The last transition into BLOCKED, by sequence. */
export function blockingTransition(run: AttributionRun): RunTransition | null {
  let blocking: RunTransition | null = null;
  for (const transition of run.transitions) {
    if (transition.toState === "BLOCKED" && (blocking === null || transition.seq > blocking.seq)) blocking = transition;
  }
  return blocking;
}

/**
 * The agent phase a block lands on: the blocking phase itself when an agent
 * ran it; otherwise the nearest agent phase before it, whose output the host
 * phase was judging (a shift's `t01-tests` judges `t01-build`). `null` when
 * the run is not BLOCKED, no phase failed, or no agent phase precedes it.
 */
export function blockedAgentPhase(run: AttributionRun): RunPhase | null {
  const blocking = blockingPhase(run);
  if (blocking === null || !isHostPhase(blocking)) return blocking;
  let judged: RunPhase | null = null;
  for (const phase of run.phases) {
    if (!isHostPhase(phase) && phase.ordinal < blocking.ordinal && (judged === null || phase.ordinal > judged.ordinal)) {
      judged = phase;
    }
  }
  return judged;
}

function applies(rule: AttributionRule, run: AttributionRun, blocking: RunPhase | null): boolean {
  switch (rule.when) {
    case "always":
      return true;
    case "host-phase":
      return blocking !== null && isHostPhase(blocking);
    case "after-build":
      return blocking !== null && isHostPhase(blocking) && blockedAgentPhase(run)?.owner === "builder";
  }
}

/** The heuristic attribution of a BLOCKED run; `null` for a run that is not BLOCKED. */
export function heuristicAttribution(run: AttributionRun): Exclude<Attribution, "owner"> | null {
  if (run.lifecycleState !== "BLOCKED") return null;
  const blocking = blockingPhase(run);
  const code = blocking?.errorCode ?? blockingTransition(run)?.reasonCode ?? null;
  if (code === null) return "unknown";
  const rule = HEURISTIC_ATTRIBUTION_RULES.find((candidate) => candidate.code === code);
  return rule !== undefined && applies(rule, run, blocking) ? rule.attribution : "unknown";
}

/** The owner's journaled override for one run (`awsf attribute`): the latest record for its attempt. */
export interface OwnerAttribution {
  readonly cause: Attribution;
  readonly reason: string;
  readonly at: string;
}

export type AttributionSource = "owner" | "heuristic";

export interface EffectiveAttribution {
  /** The attribution in force. `null` unless BLOCKED or an owner-attributed CANCELLED run. */
  readonly attribution: Attribution | null;
  readonly source: AttributionSource | null;
  /** The heuristic's answer, kept beside any override so the two can be compared. */
  readonly heuristic: Exclude<Attribution, "owner"> | null;
}

/**
 * The owner's record wins over the BLOCKED heuristic. CANCELLED runs have no
 * heuristic; only a projected owner record can attribute one. Records on any
 * other state are ignored rather than trusted.
 */
export function effectiveAttribution(run: AttributionRun, owner: OwnerAttribution | null): EffectiveAttribution {
  const heuristic = heuristicAttribution(run);
  if (run.lifecycleState === "CANCELLED") return owner === null
    ? { attribution: null, source: null, heuristic: null }
    : { attribution: owner.cause, source: "owner", heuristic: null };
  if (heuristic === null) return { attribution: null, source: null, heuristic: null };
  return owner === null
    ? { attribution: heuristic, source: "heuristic", heuristic }
    : { attribution: owner.cause, source: "owner", heuristic };
}
