import { sha256 } from "../../src/contracts/owner-amendment.ts";
import { continuityDigest } from "../../src/contracts/interrupted-turn.ts";
import { CallBudget } from "../../src/execution/call-budget.ts";
import { createTurnReconnectVerifier, type ReconnectLaunchState } from "../../src/workflow/turn-reconnect-authorization.ts";
import type { ProcessSpec, TurnReconnectProcessRegistration } from "../../src/adapters/interface.ts";
import type { InterruptedTurnCheckpoint, ToolCheckpoint, TurnBinding } from "../../src/contracts/interrupted-turn.ts";

export function turnBinding(): TurnBinding {
  const digest = sha256("fixture binding");
  return {
    interruptedTurnEnabled: true,
    taskSessionId: "fixture-task-session", workflowId: "build-review", phaseKey: "builder", phaseOrdinal: 2,
    correctionRound: 0, logicalTurnId: "fixture-turn", originOperationId: "fixture-operation",
    originAuthorizationId: "fixture-authorization", originReservationId: "fixture-operation:r1", originalLaunchKind: "task-edge",
    originalRequestDigest: digest, originalPromptBundleDigest: digest, compiledRecipeDigest: digest,
    originalTurnInputDigest: digest, effectiveInputDigest: digest, ownerAmendmentDigest: null,
    configDigest: digest, routeAndExecutableDigest: digest, toolsAndSandboxDigest: digest, protectedGrantGeneration: null,
    adapterId: "fixture-adapter", provider: "fixture-provider", model: "fixture-model", effort: "low", role: "builder",
    lifecycle: "RUNNING", candidateSha: null, reviewContextDigest: null,
    preWriteHeadSha: "a".repeat(40), permissionBaselineDigest: digest,
  };
}

export function toolCheckpoint(): ToolCheckpoint {
  return { providerToolCallId: "fixture-private-tool", executionKey: "fixture-effect-key", name: "write",
    argumentsJson: '{"path":"partial.txt"}', argumentsDigest: sha256('{"path":"partial.txt"}'),
    state: "ready", resultJson: null, resultDigest: null, effect: "not-dispatched", acknowledgement: "not-delivered" };
}

export function turnCheckpoint(): InterruptedTurnCheckpoint {
  return { schema: "awsf.interrupted-turn-checkpoint/v1", binding: turnBinding(), generation: 1, priorDigest: null,
    continuityHandle: "continuity:fixture", providerIdentity: { conversationId: null, requestId: null, acceptance: "not-sent", checkpointLineage: null },
    output: { text: "", digest: sha256(""), acceptedBytes: 0, cursor: null, toolIdMap: [], nextSequence: 1 }, tools: [],
    worktreeContentDigest: sha256("fixture dirty bytes"), indexDigest: sha256("fixture index"),
    providerAcknowledgementFrontier: null, completed: false, terminalResultDigest: null };
}

/** Synthetic host evidence for accounting tests, never a provider release proof. */
export function reconnectFixture(originalState: "held" | "spent" = "spent", review = false) {
  const ledger = new CallBudget({ taskId: "fixture-task", tier: 2, reservationNamespace: "fixture-operation" });
  const reservation = ledger.reserve({ cost: 1, edge: "L4" });
  const binding = turnBinding();
  if (review) {
    binding.lifecycle = "REVIEWING";
    binding.role = "reviewer";
    binding.phaseKey = "review";
    binding.provider = "fixture-inverse-provider";
    binding.candidateSha = "b".repeat(40);
    binding.reviewContextDigest = sha256("fixture immutable review context");
  }
  ledger.bindOriginalTurn(binding);
  if (originalState === "spent") ledger.spendOnGo(reservation.id);
  const spec: ProcessSpec = { executable: process.execPath, argv: ["-e", "process.stdout.write('continued')"],
    cwd: process.cwd(), env: { PATH: process.env["PATH"] ?? "" }, stdin: "", shell: false };
  const registration: TurnReconnectProcessRegistration = {
    kind: "turn-reconnect", runId: "fixture-physical-reconnect", taskSessionId: binding.taskSessionId,
    workflowId: binding.workflowId, phaseId: binding.phaseKey, phaseOrdinal: binding.phaseOrdinal,
    correctionRound: binding.correctionRound, adapterId: binding.adapterId, role: binding.role,
    logicalTurnId: binding.logicalTurnId, continuityHandle: "continuity:fixture",
    originOperationId: binding.originOperationId, originAuthorizationId: binding.originAuthorizationId,
    originReservationId: binding.originReservationId, interruptionAnchorId: "fixture-interruption",
    reconnectOperationId: "fixture-reconnect-operation", reconnectGeneration: 1,
    checkpointDigest: sha256("fixture checkpoint"), admissionDigest: sha256("fixture admission"),
    ownerAmendmentDigest: null, leaseId: "fixture-exclusive-lease",
  };
  const state: ReconnectLaunchState = {
    binding, currentBinding: structuredClone(binding), phaseState: "RUNNING", ownerCancelled: false, turnCompleted: false,
    runId: registration.runId, interruptionAnchorId: registration.interruptionAnchorId,
    continuityHandle: registration.continuityHandle, reconnectStage: "launch-intent",
    reconnectGeneration: registration.reconnectGeneration, reconnectOperationId: registration.reconnectOperationId,
    checkpointDigest: registration.checkpointDigest, admissionDigest: registration.admissionDigest,
    ownerAmendmentDigest: null, effectiveInputDigest: binding.effectiveInputDigest, descriptorDigest: continuityDigest(spec),
    leaseId: registration.leaseId, localControllerExclusive: true, localTreeQuiescent: true, providerFence: "exclusive",
    providerNeverAccepted: originalState === "held", checkpointVerified: true, toolFrontierVerified: true,
    amendmentAcknowledgementVerified: false,
    capability: { adapterId: binding.adapterId, adapterSourceDigest: sha256("fixture source"), executableVersion: "fixture-v1",
      protocolVersion: "fixture-v1", provider: binding.provider, model: binding.model, effort: binding.effort, role: binding.role,
      toolExecutor: "fixture-executor", sandboxMechanism: "fixture-sandbox", amendmentMode: "none" },
    liveProofDigest: sha256("synthetic accounting-test evidence, not live proof"), originalReservationState: originalState,
  };
  const control = { ledger, binding, reservation, registration, spec, state, proofAvailable: true };
  const proofKeyDigest = continuityDigest(state.capability);
  const proofDigest = state.liveProofDigest;
  const verifier = createTurnReconnectVerifier({ ledger,
    stateFor: () => control.state,
    liveProofFor: (key) => control.proofAvailable && continuityDigest(key) === proofKeyDigest ? proofDigest : null,
  });
  return Object.assign(control, { verifier });
}
