// The submachine inside every phase.
//
// PLANNING / BUILDING / DOCUMENTING are not task states — they are phases, and
// this is where their lifecycle lives. Keeping them here is what stops the
// task matrix from becoming workflow-dependent.
//
// Two rules carry the weight:
//
//   * CORRECTING → RUNNING must resume the SAME adapter, provider, model and
//     provider session. A cold restart wearing a correction's name loses every
//     turn of context the correction exists to build on, and bills for it
//     twice.
//   * Success must be EARNED. A phase is constructed FAILED-equivalent — it
//     starts QUEUED and any abnormal exit records a failure. Only a clean exit
//     through VALIDATING flips it to SUCCEEDED.
//
// Pure, like the task machine: nothing here spawns, waits, or reads a clock.

import {
  CorrectionAllowanceExhausted,
  IllegalPhaseTransition,
  SessionIdentityBroken,
  UncorrectableViolation,
} from "./errors.ts";

export const PHASE_STATES = [
  "QUEUED",
  "RUNNING",
  "VALIDATING",
  "CORRECTING",
  "SUCCEEDED",
  "FAILED",
  "SKIPPED",
  "CANCELLED",
] as const;
export type PhaseState = (typeof PHASE_STATES)[number];

/** Once here, the phase is over. `SUCCEEDED` is the only one that means it worked. */
export const PHASE_TERMINAL_STATES = ["SUCCEEDED", "FAILED", "SKIPPED", "CANCELLED"] as const;

/** Human cancel reaches CANCELLED from exactly these four. */
export const PHASE_CANCELLABLE_STATES = ["QUEUED", "RUNNING", "VALIDATING", "CORRECTING"] as const;

/**
 * "Invalid JSON and correctable gate violations share one allowance." Both are
 * the model's output being wrong, which another turn in the same session can
 * fix.
 */
export const CORRECTABLE_CAUSES = ["schema-violation", "gate-violation"] as const;

/**
 * "Permission breaches, host failures and transport errors are not correctable
 * and block immediately." A breach in particular ABORTS — it is never
 * corrected, because asking the model to try again is asking it to try the
 * breach again.
 */
export const UNCORRECTABLE_CAUSES = [
  "permission-breach",
  "host-failure",
  "transport-error",
  "crash",
  "silence",
] as const;

export type PhaseCause =
  | (typeof CORRECTABLE_CAUSES)[number]
  | (typeof UNCORRECTABLE_CAUSES)[number];

/**
 * The provider session a phase is bound to. All four fields are identity: a
 * correction that changes any one of them is a different conversation.
 */
export interface PhaseSession {
  adapter: string;
  provider: string;
  model: string;
  /** The PROVIDER's own session id, not the host's `agent_session` row id. */
  sessionId: string;
}

export interface PhaseCorrections {
  auto: number;
  owner: number;
}

export interface PhaseTransitionInput {
  /** The phase id, for the message a human reads in the trace. */
  phase: string;
  from: PhaseState;
  to: PhaseState;
  /** The session the phase is bound to now. */
  session: PhaseSession;
  /** CORRECTING → RUNNING only: the session the resume would actually run in. */
  resumeSession?: PhaseSession;
  /** VALIDATING → CORRECTING, and every → FAILED: what went wrong. */
  cause?: PhaseCause;
  /** Who authorizes a correction. `host` draws `auto`, `owner`/`human` draw `owner`. */
  actor?: "host" | "owner" | "human";
  corrections: PhaseCorrections;
  allowance: PhaseCorrections;
}

export interface PhaseTransitionResult {
  phase: string;
  from: PhaseState;
  to: PhaseState;
  terminal: boolean;
  /** The session the phase is bound to after this transition — identical across a correction. */
  session: PhaseSession;
  correctionTranche: "auto" | "owner" | null;
}

const PHASE_EDGES: readonly (readonly [PhaseState, PhaseState])[] = [
  ["QUEUED", "RUNNING"],
  ["QUEUED", "SKIPPED"],
  ["RUNNING", "VALIDATING"],
  ["RUNNING", "FAILED"],
  ["VALIDATING", "SUCCEEDED"],
  ["VALIDATING", "CORRECTING"],
  ["VALIDATING", "FAILED"],
  ["CORRECTING", "RUNNING"],
  ...PHASE_CANCELLABLE_STATES.map((from) => [from, "CANCELLED"] as const),
];

const PHASE_EDGE_KEYS: ReadonlySet<string> = new Set(PHASE_EDGES.map(([from, to]) => `${from}->${to}`));

export function isPhaseTerminal(state: PhaseState): boolean {
  return (PHASE_TERMINAL_STATES as readonly string[]).includes(state);
}

/** Success is earned, never assumed: every phase begins here. */
export function initialPhaseState(): PhaseState {
  return "QUEUED";
}

/**
 * Where a phase lands when it exits abnormally — a crash, a kill, a host that
 * went away. Always FAILED unless the phase had already settled, because the
 * alternative is a phase that says it succeeded because nothing said otherwise.
 */
export function settleAbnormalExit(state: PhaseState): PhaseState {
  return isPhaseTerminal(state) ? state : "FAILED";
}

function sessionDifferences(current: PhaseSession, resumed: PhaseSession): string[] {
  const fields = ["adapter", "provider", "model", "sessionId"] as const;
  return fields
    .filter((field) => current[field] !== resumed[field])
    .map((field) => `${field} ${JSON.stringify(current[field])} became ${JSON.stringify(resumed[field])}`);
}

/**
 * Decides one phase state change. Throws on the first violation; returns the
 * session the phase is bound to afterwards, which for a correction is the same
 * object identity it went in with.
 */
export function phaseTransition(input: PhaseTransitionInput): PhaseTransitionResult {
  const { phase, from, to, session, corrections, allowance } = input;

  if (!PHASE_EDGE_KEYS.has(`${from}->${to}`)) {
    throw new IllegalPhaseTransition(phase, from, to);
  }

  let correctionTranche: "auto" | "owner" | null = null;

  if (to === "CORRECTING") {
    const cause = input.cause;
    if (cause === undefined || !(CORRECTABLE_CAUSES as readonly string[]).includes(cause)) {
      throw new UncorrectableViolation(phase, cause ?? "an unnamed violation");
    }
    // The allowance is per phase — `correction_allowance: {auto: 1, owner: 1}` —
    // and running out is not an error state, it is the road to VALIDATING →
    // FAILED and from there to L8 / L13.
    correctionTranche = input.actor === "host" || input.actor === undefined ? "auto" : "owner";
    const used = correctionTranche === "auto" ? corrections.auto : corrections.owner;
    const limit = correctionTranche === "auto" ? allowance.auto : allowance.owner;
    if (used >= limit) {
      throw new CorrectionAllowanceExhausted(
        corrections.auto >= allowance.auto && corrections.owner >= allowance.owner ? "global" : "tranche",
        from,
        to,
        correctionTranche,
        `phase ${phase}: ${correctionTranche} ${used}/${limit}`,
      );
    }
  }

  // The one identity check. It runs on the resume, not on the correction, so a
  // provider that dropped the session between the two is caught here rather
  // than discovered as a suspiciously context-free reply.
  if (from === "CORRECTING" && to === "RUNNING") {
    const resumed = input.resumeSession ?? session;
    const differences = sessionDifferences(session, resumed);
    if (differences.length > 0) {
      throw new SessionIdentityBroken(phase, differences);
    }
  }

  return {
    phase,
    from,
    to,
    terminal: isPhaseTerminal(to),
    session,
    correctionTranche,
  };
}
