// Authorization for ordinary agent phases inside the durable RUNNING sojourn.
//
// This is deliberately not a lifecycle transition. The first provider launch
// is still L4; review and owner rework still use L11/L16/L19. Once L4 is
// durable, a later ordinary agent phase needs proof that it belongs to the
// exact compiled workflow and explicit configured route for this task.
//
// Trust boundary: the callbacks below are host capabilities. They may read the
// durable status store and the host's retained compiled/configured workflow;
// the verifier itself performs no I/O. The broker trusts only the verifier
// installed at host composition time, never a bearer string supplied by a
// launch caller. No verifier means no phase launch.

import type {
  AgentPhaseLaunchEvidence,
  AgentPhaseLaunchVerifier,
  AgentPhaseProcessRegistration,
  PhaseCorrectionLaunchEvidence,
  PhaseCorrectionLaunchVerifier,
  PhaseCorrectionProcessRegistration,
} from "../adapters/interface.ts";
import type { TaskState } from "../state/task-machine.ts";
import type { CompiledWorkflow } from "./compiler.ts";

export interface DurablePhaseLaunchStatus {
  readonly taskSessionId: string;
  readonly lifecycleState: TaskState;
  readonly workflowId: string;
}

export interface ConfiguredPhaseRoute {
  readonly adapterId: string;
  readonly role: string;
  /** Mandatory review and the first owner-rework launch stay on task edges. */
  readonly launchAuthorization: "agent-phase" | "task-edge";
}

export interface PhaseLaunchAuthorizationHost {
  statusFor(taskSessionId: string): DurablePhaseLaunchStatus | null;
  compiledWorkflowFor(taskSessionId: string): CompiledWorkflow | null;
  configuredRouteFor(input: {
    taskSessionId: string;
    workflowId: string;
    phaseId: string;
    phaseOrdinal: number;
  }): ConfiguredPhaseRoute | null;
}

export class PhaseLaunchAuthorizationRejected extends Error {
  readonly detail: string;

  constructor(registration: AgentPhaseProcessRegistration, detail: string) {
    super(`phase launch ${registration.runId || "(unnamed run)"} is not authorized: ${detail}`);
    this.name = "PhaseLaunchAuthorizationRejected";
    this.detail = detail;
  }
}

/**
 * Builds the host verifier injected into TransportBroker. One-based ordinals
 * bind a phase id to one exact slot, so duplicate/lookalike phase identities
 * cannot be substituted even if a malformed compiled object reaches the host.
 */
export function createCompiledPhaseLaunchVerifier(
  host: PhaseLaunchAuthorizationHost,
): AgentPhaseLaunchVerifier {
  return {
    verify(registration): AgentPhaseLaunchEvidence {
      const reject = (detail: string): never => {
        throw new PhaseLaunchAuthorizationRejected(registration, detail);
      };
      const status = host.statusFor(registration.taskSessionId);
      if (status === null) return reject("the durable task session is unknown");
      if (status.taskSessionId !== registration.taskSessionId) {
        return reject("the durable task session is unknown");
      }
      if (status.lifecycleState !== "RUNNING") {
        return reject(`the durable task is ${status.lifecycleState}, not RUNNING`);
      }
      if (status.workflowId !== registration.workflowId) {
        return reject(`durable workflow ${JSON.stringify(status.workflowId)} does not match ${JSON.stringify(registration.workflowId)}`);
      }

      const workflow = host.compiledWorkflowFor(registration.taskSessionId);
      if (workflow === null) return reject("the named workflow is not the host-retained compiled workflow");
      if (workflow.id !== registration.workflowId) {
        return reject("the named workflow is not the host-retained compiled workflow");
      }
      const phase = workflow.phases[registration.phaseOrdinal - 1];
      if (phase === undefined) return reject("the phase id and one-based ordinal do not identify a compiled phase");
      if (phase.id !== registration.phaseId) {
        return reject("the phase id and one-based ordinal do not identify a compiled phase");
      }
      if (phase.kind !== "agent") {
        return reject(`compiled phase ${registration.phaseId} is ${phase.kind}, not agent`);
      }
      if (phase.owner !== registration.role) {
        return reject(`compiled role ${JSON.stringify(phase.owner)} does not match ${JSON.stringify(registration.role)}`);
      }

      const route = host.configuredRouteFor({
        taskSessionId: registration.taskSessionId,
        workflowId: registration.workflowId,
        phaseId: registration.phaseId,
        phaseOrdinal: registration.phaseOrdinal,
      });
      if (route === null) return reject("no explicit configured provider route exists for this phase");
      if (route.launchAuthorization !== "agent-phase") {
        return reject("explicit config requires a task-edge launch (mandatory review or owner rework)");
      }
      if (route.adapterId !== registration.adapterId || route.role !== registration.role) {
        return reject("the adapter or role was selected outside the explicit configured route");
      }

      return Object.freeze({
        taskSessionId: registration.taskSessionId,
        taskState: "RUNNING",
        workflowId: registration.workflowId,
        phaseId: registration.phaseId,
        phaseOrdinal: registration.phaseOrdinal,
        phaseKind: "agent",
        adapterId: registration.adapterId,
        role: registration.role,
        launchAuthorization: "agent-phase",
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Correction turns.
// ---------------------------------------------------------------------------

/**
 * What the host knows about a phase's open conversation, without ever handing
 * the verifier the provider locator itself. The verifier decides whether a
 * correction may launch; it has no business knowing how to reach the provider.
 */
export interface OpenConversation {
  readonly handle: string;
  readonly adapterId: string;
  readonly role: string;
  /** Completed sends. A conversation with none has nothing to correct. */
  readonly turns: number;
  /** The adapter's own answer, read from `getModelInfo` at preflight. */
  readonly verifiedContinuity: "same-session-correction" | "none";
}

/** The live correction counters and the configured per-phase allowance. */
export interface CorrectionAllowanceState {
  readonly used: { readonly auto: number; readonly owner: number };
  readonly allowance: { readonly auto: number; readonly owner: number };
}

export interface CorrectionLaunchAuthorizationHost extends PhaseLaunchAuthorizationHost {
  conversationFor(input: { taskSessionId: string; phaseId: string }): OpenConversation | null;
  correctionStateFor(input: { taskSessionId: string; phaseId: string }): CorrectionAllowanceState | null;
}

export class CorrectionLaunchAuthorizationRejected extends Error {
  readonly detail: string;

  constructor(registration: PhaseCorrectionProcessRegistration, detail: string) {
    super(`correction launch ${registration.runId || "(unnamed run)"} is not authorized: ${detail}`);
    this.name = "CorrectionLaunchAuthorizationRejected";
    this.detail = detail;
  }
}

/**
 * The verifier for a launch that charges nothing.
 *
 * It reuses the compiled-phase verifier for everything a correction shares with
 * an ordinary phase launch — durable `RUNNING`, exact compiled identity,
 * explicit configured route — and then adds the two questions that only matter
 * when no reservation is standing behind the launch:
 *
 *   1. Is there a conversation to re-enter, on a route whose adapter actually
 *      reports `same-session-correction`? A configured declaration is not
 *      enough; the pilot that produced this work stopped precisely because a
 *      config and a transport had drifted apart.
 *   2. Is this round inside the configured allowance, in the tranche the phase
 *      machine charged? This is what replaces the ceiling. The check is `<=`
 *      against the tranche's limit because the charge has already happened by
 *      the time a launch is described — the phase machine debits on
 *      `VALIDATING → CORRECTING`, and this runs on the way into `RUNNING`.
 */
export function createCorrectionLaunchVerifier(
  host: CorrectionLaunchAuthorizationHost,
): PhaseCorrectionLaunchVerifier {
  const phaseVerifier = createCompiledPhaseLaunchVerifier(host);
  return {
    verify(registration): PhaseCorrectionLaunchEvidence {
      const reject = (detail: string): never => {
        throw new CorrectionLaunchAuthorizationRejected(registration, detail);
      };
      // Everything an ordinary phase launch must prove, proved the same way and
      // by the same code. A correction is not a weaker launch, only a cheaper
      // one.
      const base: AgentPhaseLaunchEvidence = phaseVerifier.verify({
        kind: "agent-phase",
        runId: registration.runId,
        taskSessionId: registration.taskSessionId,
        workflowId: registration.workflowId,
        phaseId: registration.phaseId,
        phaseOrdinal: registration.phaseOrdinal,
        reservationId: registration.originReservationId,
        adapterId: registration.adapterId,
        role: registration.role,
      });

      const conversation = host.conversationFor({
        taskSessionId: registration.taskSessionId,
        phaseId: registration.phaseId,
      });
      if (conversation === null) return reject("no conversation is open for this phase");
      if (conversation.handle !== registration.continuityHandle) {
        return reject("the registration names a conversation this phase did not open");
      }
      if (conversation.verifiedContinuity !== "same-session-correction") {
        return reject("the adapter on this route does not report same-session correction");
      }
      if (conversation.adapterId !== registration.adapterId || conversation.role !== registration.role) {
        return reject("the conversation was opened on a different adapter or role");
      }
      if (conversation.turns < 1) {
        return reject("the conversation has no completed turn to correct");
      }

      const corrections = host.correctionStateFor({
        taskSessionId: registration.taskSessionId,
        phaseId: registration.phaseId,
      });
      if (corrections === null) return reject("the correction allowance for this phase is unknown");
      const used = registration.tranche === "auto" ? corrections.used.auto : corrections.used.owner;
      const limit = registration.tranche === "auto" ? corrections.allowance.auto : corrections.allowance.owner;
      if (used > limit || limit === 0) {
        return reject(`the ${registration.tranche} correction allowance is spent (${used}/${limit})`);
      }
      const total = corrections.allowance.auto + corrections.allowance.owner;
      if (registration.correctionRound > total) {
        return reject(`round ${registration.correctionRound} exceeds the configured allowance of ${total}`);
      }

      return Object.freeze({
        taskSessionId: base.taskSessionId,
        taskState: "RUNNING",
        workflowId: base.workflowId,
        phaseId: base.phaseId,
        phaseOrdinal: base.phaseOrdinal,
        phaseKind: "agent",
        adapterId: base.adapterId,
        role: base.role,
        correctionRound: registration.correctionRound,
        tranche: registration.tranche,
        continuityHandle: registration.continuityHandle,
        verifiedContinuity: "same-session-correction",
        launchAuthorization: "phase-correction",
      });
    },
  };
}
