import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { canonicalJson, sha256 } from "./owner-amendment.ts";

const id = Type.String({ minLength: 1, maxLength: 256 });
const digest = Type.String({ pattern: "^[a-f0-9]{64}$" });
const sha = Type.String({ pattern: "^[a-f0-9]{40}$" });
const nullableDigest = Type.Union([digest, Type.Null()]);

export const CONTINUITY_REFUSALS = ["continuity-not-enabled", "proof-unavailable", "recovery-ambiguous", "checkpoint-invalid", "binding-mismatch", "turn-already-completed"] as const;
export type ContinuityRefusalCode = typeof CONTINUITY_REFUSALS[number];

/** Never include provider locators or raw tool/input bytes in refusal messages. */
export class InterruptedTurnRefused extends Error {
  readonly code: ContinuityRefusalCode;
  constructor(code: ContinuityRefusalCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "InterruptedTurnRefused";
    this.code = code;
  }
}

/** A public binding contains host handles and digests only. */
export const TurnBindingSchema = Type.Object({
  interruptedTurnEnabled: Type.Literal(true),
  taskSessionId: id, workflowId: id, phaseKey: id, phaseOrdinal: Type.Integer({ minimum: 1 }),
  correctionRound: Type.Integer({ minimum: 0 }), logicalTurnId: id,
  originOperationId: id, originAuthorizationId: id, originReservationId: id,
  originalLaunchKind: Type.Union([Type.Literal("task-edge"), Type.Literal("agent-phase"), Type.Literal("phase-correction")]),
  originalRequestDigest: digest, originalPromptBundleDigest: digest, compiledRecipeDigest: digest,
  originalTurnInputDigest: digest, effectiveInputDigest: digest, ownerAmendmentDigest: nullableDigest,
  configDigest: digest, routeAndExecutableDigest: digest, toolsAndSandboxDigest: digest,
  protectedGrantGeneration: Type.Union([id, Type.Null()]),
  adapterId: id, provider: id, model: id, effort: id, role: id,
  lifecycle: Type.Union([Type.Literal("RUNNING"), Type.Literal("REVIEWING")]),
  candidateSha: Type.Union([sha, Type.Null()]), reviewContextDigest: nullableDigest,
  preWriteHeadSha: sha, permissionBaselineDigest: digest,
}, { additionalProperties: false });
export type TurnBinding = Static<typeof TurnBindingSchema>;

export const ToolCheckpointSchema = Type.Object({
  /** These two ids are PRIVATE, unlike the host-normalized t1/t2 names. */
  providerToolCallId: id, executionKey: id, name: id,
  argumentsJson: Type.String(), argumentsDigest: digest,
  state: Type.Union([Type.Literal("arguments-partial"), Type.Literal("ready"), Type.Literal("dispatch-intent"), Type.Literal("result-durable"), Type.Literal("acknowledged")]),
  resultJson: Type.Union([Type.String(), Type.Null()]), resultDigest: nullableDigest,
  effect: Type.Union([Type.Literal("not-dispatched"), Type.Literal("known"), Type.Literal("unknown")]),
  acknowledgement: Type.Union([Type.Literal("not-delivered"), Type.Literal("acknowledged"), Type.Literal("unknown")]),
}, { additionalProperties: false });
export type ToolCheckpoint = Static<typeof ToolCheckpointSchema>;

/** Private record. Only its reference/digest may enter the public journal. */
export const InterruptedTurnCheckpointSchema = Type.Object({
  schema: Type.Literal("awsf.interrupted-turn-checkpoint/v1"), binding: TurnBindingSchema,
  generation: Type.Integer({ minimum: 1 }), priorDigest: nullableDigest,
  continuityHandle: id,
  providerIdentity: Type.Object({
    conversationId: Type.Union([id, Type.Null()]), requestId: Type.Union([id, Type.Null()]),
    acceptance: Type.Union([Type.Literal("not-sent"), Type.Literal("accepted"), Type.Literal("unknown"), Type.Literal("completed")]),
    checkpointLineage: Type.Union([id, Type.Null()]),
  }, { additionalProperties: false }),
  output: Type.Object({
    text: Type.String(), digest, acceptedBytes: Type.Integer({ minimum: 0 }),
    cursor: Type.Union([Type.String(), Type.Null()]),
    toolIdMap: Type.Array(Type.Object({ providerId: id, hostId: Type.String({ pattern: "^t[1-9][0-9]*$" }) }, { additionalProperties: false })),
    nextSequence: Type.Integer({ minimum: 1 }),
  }, { additionalProperties: false }),
  tools: Type.Array(ToolCheckpointSchema),
  worktreeContentDigest: digest, indexDigest: digest,
  providerAcknowledgementFrontier: Type.Union([Type.String(), Type.Null()]),
  completed: Type.Boolean(), terminalResultDigest: nullableDigest,
}, { additionalProperties: false });
export type InterruptedTurnCheckpoint = Static<typeof InterruptedTurnCheckpointSchema>;

export const TurnCheckpointReferenceSchema = Type.Object({
  schema: Type.Literal("awsf.turn-checkpoint-ref/v1"), logicalTurnId: id,
  generation: Type.Integer({ minimum: 1 }), digest, bindingDigest: digest,
}, { additionalProperties: false });
export type TurnCheckpointReference = Static<typeof TurnCheckpointReferenceSchema>;

/** A capability is specific to all of these dimensions, never just a model name. */
export const TurnCapabilityKeySchema = Type.Object({
  adapterId: id, adapterSourceDigest: digest, executableVersion: id, protocolVersion: id,
  provider: id, model: id, effort: id, role: id, toolExecutor: id, sandboxMechanism: id,
  amendmentMode: Type.Union([Type.Literal("none"), Type.Literal("idempotent-in-turn")]),
}, { additionalProperties: false });
export type TurnCapabilityKey = Static<typeof TurnCapabilityKeySchema>;

export function continuityDigest(value: unknown): string { return sha256(canonicalJson(value)); }

export function assertTurnBinding(value: unknown): asserts value is TurnBinding {
  if (!Value.Check(TurnBindingSchema, value)) throw new InterruptedTurnRefused("binding-mismatch", "invalid original-turn binding");
  if (value.lifecycle === "REVIEWING" && (value.candidateSha === null || value.reviewContextDigest === null)) {
    throw new InterruptedTurnRefused("binding-mismatch", "review lacks its original candidate or context binding");
  }
}

export function assertTurnCheckpoint(value: unknown): asserts value is InterruptedTurnCheckpoint {
  const refuse = (): never => { throw new InterruptedTurnRefused("checkpoint-invalid", "private checkpoint schema or frontier is inconsistent"); };
  if (!Value.Check(InterruptedTurnCheckpointSchema, value)) return refuse();
  assertTurnBinding(value.binding);
  if (value.output.digest !== sha256(value.output.text) || value.output.acceptedBytes !== Buffer.byteLength(value.output.text, "utf8")) return refuse();
  if (value.completed !== (value.terminalResultDigest !== null) || value.completed !== (value.providerIdentity.acceptance === "completed")) return refuse();
  if (value.completed && value.terminalResultDigest !== value.output.digest) return refuse();
  if ((value.providerIdentity.acceptance === "accepted" || value.completed) &&
      (value.providerIdentity.conversationId === null || (value.providerIdentity.requestId === null && value.providerIdentity.checkpointLineage === null))) return refuse();
  if (value.generation === 1 ? value.priorDigest !== null : value.priorDigest === null) return refuse();
  if (new Set(value.tools.map((tool) => tool.providerToolCallId)).size !== value.tools.length ||
      new Set(value.tools.map((tool) => tool.executionKey)).size !== value.tools.length) return refuse();
  const mapping = value.output.toolIdMap;
  if (new Set(mapping.map((item) => item.providerId)).size !== mapping.length || new Set(mapping.map((item) => item.hostId)).size !== mapping.length) return refuse();
  for (const tool of value.tools) {
    if (sha256(tool.argumentsJson) !== tool.argumentsDigest) return refuse();
    try {
      if (tool.state !== "arguments-partial") {
        const args: unknown = JSON.parse(tool.argumentsJson);
        if (args === null || typeof args !== "object" || Array.isArray(args)) return refuse();
      }
      if (tool.resultJson !== null) JSON.parse(tool.resultJson);
    } catch { return refuse(); }
    if ((tool.resultJson === null) !== (tool.resultDigest === null) || (tool.resultJson !== null && sha256(tool.resultJson) !== tool.resultDigest)) return refuse();
    const resultKnown = tool.state === "result-durable" || tool.state === "acknowledged";
    if (resultKnown !== (tool.resultDigest !== null) || (resultKnown && tool.effect !== "known")) return refuse();
    if ((tool.state === "ready" || tool.state === "arguments-partial") && tool.effect !== "not-dispatched") return refuse();
    if ((tool.state === "acknowledged") !== (tool.acknowledgement === "acknowledged")) return refuse();
    if (value.completed && (tool.effect === "unknown" || !resultKnown)) return refuse();
  }
}

/** Pure decision only. This never executes a tool or treats a missing result as nonexecution. */
export function reconcileToolCheckpoint(tool: ToolCheckpoint, proof: {
  readonly neverDispatched: boolean; readonly idempotentResultDelivery: boolean; readonly transactionalOutcomeLookup: boolean;
}): "dispatch-original" | "deliver-retained-result" | "query-original-outcome" | "already-acknowledged" | "refuse" {
  if (tool.state === "acknowledged") return "already-acknowledged";
  if (tool.effect === "unknown") return proof.transactionalOutcomeLookup ? "query-original-outcome" : "refuse";
  if (tool.state === "result-durable") return proof.idempotentResultDelivery ? "deliver-retained-result" : "refuse";
  if (tool.state === "ready" && tool.effect === "not-dispatched" && proof.neverDispatched) return "dispatch-original";
  return "refuse";
}
