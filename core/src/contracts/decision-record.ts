import { createHash } from "node:crypto";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { stringUnion } from "./typebox.ts";

// One Jev call, journaled (W19 DD3, INV-7, Q18). Host-written by `decide()` and
// never parsed out of provider output, so it is registered as a record and never
// as a wire envelope. Task-scoped: it lives in the task's `decisions.jsonl`,
// beside the attempt directories, and `awsf db rebuild` replays that file.
//
// A record says what was asked, what came back and what it cost. It never says
// what was decided from the answer: that is the question set's policy, which is
// code, and it reproduces from `answers` (INV-2).
export const DECISION_RECORD_SCHEMA_ID = "awsf.decision/v1";

/** Every way a call can end. Mirrors `JevOutcome` in `core/src/decision/jev-transport.ts`. */
export const DECISION_OUTCOMES = ["answered", "unavailable", "refused-by-switch", "contract-error"] as const;
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];

export const DECISION_UNAVAILABLE_REASONS = [
  "missing-key",
  "http-status",
  "retries-exhausted",
  "network",
  "redirect",
  "timeout",
  "aborted",
] as const;

/** Who asked: a stop, a phase hook, a tool, or the replay. */
export const DECISION_CALLER_KINDS = ["stop", "phase-hook", "tool", "replay"] as const;
export type DecisionCallerKind = (typeof DECISION_CALLER_KINDS)[number];

/** Q18: the redacted bodies are kept whole when together they fit in 16 KiB; otherwise only their digests. */
export const DECISION_BODY_LIMIT_BYTES = 16 * 1024;

const id = Type.String({ minLength: 1 });
const unit = Type.Number({ minimum: 0, maximum: 1 });
const count = Type.Integer({ minimum: 0 });
const sha256 = Type.String({ pattern: "^[0-9a-f]{64}$" });
const distribution = Type.Record(Type.String(), unit);

const AnswerSchema = Type.Union([
  Type.Object({ type: Type.Literal("noul"), noul: unit }, { additionalProperties: false }),
  Type.Object(
    { type: Type.Literal("choice"), choice: id, probabilities: distribution, confidence: unit },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("score"),
      score: Type.Number({ minimum: 0 }),
      legend: Type.Record(Type.String(), Type.String()),
      probabilities: distribution,
      confidence: unit,
    },
    { additionalProperties: false },
  ),
]);

const CostSchema = Type.Union([
  Type.Object(
    { amount: Type.Number({ minimum: 0 }), source: stringUnion(["reported", "estimated"] as const) },
    { additionalProperties: false },
  ),
  Type.Object({ amount: Type.Null(), source: Type.Literal("unknown") }, { additionalProperties: false }),
]);

const BodiesSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("inline"),
      /** The redacted request exactly as sent, or null when nothing was built (refused by the switch). */
      request: Type.Union([Type.String(), Type.Null()]),
      /** The scrubbed response text, or null when none arrived. */
      response: Type.Union([Type.String(), Type.Null()]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("digest"),
      requestSha256: Type.Union([sha256, Type.Null()]),
      responseSha256: Type.Union([sha256, Type.Null()]),
      /** The bytes the digests stand for, so a reader knows why the bodies are absent. */
      bytes: count,
    },
    { additionalProperties: false },
  ),
]);

export const DecisionRecordSchema = Type.Object(
  {
    schema: Type.Literal(DECISION_RECORD_SCHEMA_ID),
    id,
    project: id,
    taskId: id,
    /** The attempt the call was made for, or null for a task-level call (the replay). */
    attempt: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    caller: Type.Object({ kind: stringUnion(DECISION_CALLER_KINDS), name: id }, { additionalProperties: false }),
    questionSet: Type.Object(
      { id: Type.String({ pattern: "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$" }), version: Type.Integer({ minimum: 1 }) },
      { additionalProperties: false },
    ),
    requestedModel: id,
    /** Present only when answered (T01 C5): never a copy of the requested alias. */
    resolvedModel: Type.Optional(id),
    outcome: stringUnion(DECISION_OUTCOMES),
    /** Present only when unavailable. */
    reason: Type.Optional(stringUnion(DECISION_UNAVAILABLE_REASONS)),
    status: Type.Optional(Type.Integer({ minimum: 100, maximum: 599 })),
    /** Operator-facing and credential-free: the transport's detail or the contract error's message. */
    detail: Type.Optional(Type.String({ maxLength: 2_000 })),
    answers: Type.Union([Type.Record(Type.String(), AnswerSchema), Type.Null()]),
    usage: Type.Union([
      Type.Object({ input_tokens: count, output_tokens: count }, { additionalProperties: false }),
      Type.Null(),
    ]),
    /** An unknown cost stays null; it is never coerced to 0 (T01 C5). */
    cost: CostSchema,
    elapsedMs: count,
    attempts: count,
    redacted: Type.Boolean(),
    bodies: BodiesSchema,
    at: id,
  },
  { additionalProperties: false, $id: DECISION_RECORD_SCHEMA_ID, title: "DecisionRecord" },
);

export type DecisionRecord = Static<typeof DecisionRecordSchema>;
export type DecisionCaller = DecisionRecord["caller"];
export type DecisionBodies = DecisionRecord["bodies"];

export function assertDecisionRecord(value: unknown): asserts value is DecisionRecord {
  if (!Value.Check(DecisionRecordSchema, value)) {
    const first = [...Value.Errors(DecisionRecordSchema, value)][0];
    throw new Error(`invalid ${DECISION_RECORD_SCHEMA_ID} record${first === undefined ? "" : ` at ${first.path}: ${first.message}`}`);
  }
}

const digest = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/**
 * Q18's rule over bodies that are already redacted. Both bodies whole when their
 * UTF-8 bytes together are under the limit, else both as sha256 digests. Never
 * one of each, so a record is either auditable or only verifiable, never half.
 */
export function decisionBodies(request: string | null, response: string | null): DecisionBodies {
  const bytes = Buffer.byteLength(request ?? "", "utf8") + Buffer.byteLength(response ?? "", "utf8");
  if (bytes < DECISION_BODY_LIMIT_BYTES) return { kind: "inline", request, response };
  return {
    kind: "digest",
    requestSha256: request === null ? null : digest(request),
    responseSha256: response === null ? null : digest(response),
    bytes,
  };
}
