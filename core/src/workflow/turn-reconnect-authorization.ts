// Host-owned reconnect admission. This grants no capability to an adapter:
// the host must supply current checkpoint, lease, and exact live-proof evidence.
import { assertTurnBinding, continuityDigest, InterruptedTurnRefused, type TurnBinding, type TurnCapabilityKey } from "../contracts/interrupted-turn.ts";
import type { TurnReconnectProcessRegistration, ProcessSpec } from "../adapters/interface.ts";

export interface ReconnectLaunchState {
  readonly binding: TurnBinding;
  /** Recomputed from current lifecycle, compiled route, config and retained original inputs. */
  readonly currentBinding: TurnBinding;
  readonly phaseState: "RUNNING" | "FAILED" | "SUCCEEDED" | "other";
  readonly ownerCancelled: boolean;
  readonly turnCompleted: boolean;
  readonly runId: string;
  readonly interruptionAnchorId: string;
  readonly continuityHandle: string;
  readonly reconnectStage: "authorized" | "launch-intent" | "registered" | "reattached" | "settled";
  readonly reconnectGeneration: number;
  readonly reconnectOperationId: string;
  readonly checkpointDigest: string;
  readonly admissionDigest: string;
  readonly ownerAmendmentDigest: string | null;
  readonly effectiveInputDigest: string;
  readonly descriptorDigest: string;
  readonly leaseId: string;
  readonly localControllerExclusive: boolean;
  readonly localTreeQuiescent: boolean;
  readonly providerFence: "exclusive" | "exclusive-read-only" | "unknown";
  readonly providerNeverAccepted: boolean;
  readonly checkpointVerified: boolean;
  readonly toolFrontierVerified: boolean;
  readonly amendmentAcknowledgementVerified: boolean;
  readonly capability: TurnCapabilityKey;
  /** Bound external proof digest, absent unless verified for this exact key. */
  readonly liveProofDigest: string | null;
  readonly originalReservationState: "held" | "spent" | "released" | "unknown";
}

export interface TurnReconnectAuthorizationHost {
  /** The single ledger used by this operation's verifier, broker, and settlement. */
  readonly ledger: object;
  /** Read under the controller lease/operation lock, never supplied by the launch caller. */
  stateFor(registration: TurnReconnectProcessRegistration): ReconnectLaunchState | null;
  /** The verified external release evidence must cover this exact capability key. */
  liveProofFor(key: TurnCapabilityKey): string | null;
}

export interface VerifiedReconnectAuthorization {
  readonly registration: Readonly<TurnReconnectProcessRegistration>;
  readonly binding: Readonly<TurnBinding>;
  readonly descriptorDigest: string;
  readonly stage: "before-spawn" | "before-go" | "before-release";
  readonly providerNeverAccepted: boolean;
  readonly originalReservationState: "held" | "spent";
}
const verified = new WeakMap<object, object>();
export function isVerifiedReconnectAuthorization(value: unknown, ledger?: object): value is VerifiedReconnectAuthorization {
  return typeof value === "object" && value !== null && verified.has(value) && (ledger === undefined || verified.get(value) === ledger);
}

export interface TurnReconnectLaunchVerifier {
  verify(registration: TurnReconnectProcessRegistration, spec: ProcessSpec, stage?: "before-spawn" | "before-go" | "before-release"): VerifiedReconnectAuthorization;
}

export function createTurnReconnectVerifier(host: TurnReconnectAuthorizationHost): TurnReconnectLaunchVerifier {
  return { verify(registration, spec, stage = "before-spawn") {
    const fail = (detail: string): never => { throw new InterruptedTurnRefused("recovery-ambiguous", detail); };
    const state = host.stateFor(registration);
    if (state === null) return fail("no durable reconnect activation for this operation");
    assertTurnBinding(state.binding);
    assertTurnBinding(state.currentBinding);
    if (continuityDigest(state.binding) !== continuityDigest(state.currentBinding)) return fail("current lifecycle, phase, route or original binding changed");
    const expectedStage = stage === "before-spawn" ? "launch-intent" : stage === "before-go" ? "registered" : "reattached";
    if (state.reconnectStage !== expectedStage) return fail("reconnect operation is not at its authorized launch frontier");
    const binding = state.binding;
    if (!/^[a-f0-9]{64}$/.test(state.effectiveInputDigest) ||
        (state.ownerAmendmentDigest === null && state.effectiveInputDigest !== binding.effectiveInputDigest)) return fail("original effective input changed without an amendment");
    if (state.phaseState !== "RUNNING" || state.ownerCancelled || state.turnCompleted) return fail("the original logical phase cannot be revived");
    if (!state.localControllerExclusive || !state.localTreeQuiescent || state.providerFence === "unknown") return fail("exclusive takeover is unproved");
    if (!state.checkpointVerified || !state.toolFrontierVerified) return fail("the original checkpoint/tool frontier is unproved");
    if (state.ownerAmendmentDigest !== null && !state.amendmentAcknowledgementVerified) return fail("same-turn amendment acknowledgement is unproved");
    if (state.liveProofDigest === null || !/^[a-f0-9]{64}$/.test(state.liveProofDigest) || host.liveProofFor(state.capability) !== state.liveProofDigest) {
      throw new InterruptedTurnRefused("proof-unavailable", "this exact adapter/model/effort/role/executor/sandbox/amendment mode has no verified live proof");
    }
    if (state.capability.adapterId !== binding.adapterId || state.capability.provider !== binding.provider || state.capability.model !== binding.model ||
        state.capability.effort !== binding.effort || state.capability.role !== binding.role ||
        (state.ownerAmendmentDigest === null ? state.capability.amendmentMode !== "none" : state.capability.amendmentMode !== "idempotent-in-turn")) return fail("live proof belongs to another route or input mode");
    if (registration.kind !== "turn-reconnect" || typeof registration.runId !== "string" || registration.runId.length === 0 || registration.runId !== state.runId ||
        registration.taskSessionId !== binding.taskSessionId || registration.workflowId !== binding.workflowId || registration.phaseId !== binding.phaseKey ||
        registration.phaseOrdinal !== binding.phaseOrdinal || registration.correctionRound !== binding.correctionRound || registration.adapterId !== binding.adapterId ||
        registration.role !== binding.role || registration.logicalTurnId !== binding.logicalTurnId || registration.originOperationId !== binding.originOperationId ||
        registration.originAuthorizationId !== binding.originAuthorizationId || registration.originReservationId !== binding.originReservationId ||
        registration.continuityHandle !== state.continuityHandle || registration.interruptionAnchorId !== state.interruptionAnchorId || registration.reconnectGeneration !== state.reconnectGeneration ||
        registration.reconnectOperationId !== state.reconnectOperationId || registration.checkpointDigest !== state.checkpointDigest ||
        registration.admissionDigest !== state.admissionDigest || registration.ownerAmendmentDigest !== state.ownerAmendmentDigest || registration.leaseId !== state.leaseId) return fail("reconnect registration differs from its durable activation");
    if (!Number.isSafeInteger(registration.reconnectGeneration) || registration.reconnectGeneration < 1 ||
        !/^[a-f0-9]{64}$/.test(state.checkpointDigest) || !/^[a-f0-9]{64}$/.test(state.admissionDigest)) return fail("invalid checkpoint/admission generation");
    if (continuityDigest(spec) !== state.descriptorDigest) return fail("actual reconnect descriptor differs from preflight");
    if (state.originalReservationState !== "spent" && !(state.originalReservationState === "held" && state.providerNeverAccepted)) return fail("the original debit is unusable or acceptance is ambiguous");
    const result: VerifiedReconnectAuthorization = Object.freeze({ registration: Object.freeze({ ...registration }), binding: Object.freeze({ ...binding }),
      descriptorDigest: state.descriptorDigest, stage, providerNeverAccepted: state.providerNeverAccepted,
      originalReservationState: state.originalReservationState as "held" | "spent" });
    verified.set(result, host.ledger);
    return result;
  } };
}
