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
