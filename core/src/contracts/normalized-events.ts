import { Type, type Static, type TProperties } from "@sinclair/typebox";
import { NullableCount, stringUnion, type UnionOf } from "./typebox.ts";

// The normalized event vocabulary — twelve kinds, adopted from
// `fusion-harness/core/events.ts:6-19` because it is already implemented,
// sequenced, and tested. Every adapter parser emits these and nothing else;
// provider-specific event shapes never escape `core/src/adapters/`.
//
// `as const` tuples, not `enum`: `enum` is not erasable and would break
// `node --experimental-strip-types`.

export const NORMALIZED_EVENT_KINDS = [
  "run.started",
  "model.resolved",
  "text.delta",
  "thinking.delta",
  "tool.requested",
  "tool.completed",
  "usage",
  "quota",
  "notice",
  "run.completed",
  "run.failed",
  "run.cancelled",
] as const;
export type NormalizedEventKind = UnionOf<typeof NORMALIZED_EVENT_KINDS>;

/** Exactly one of these occurs per run, and it is the last event of that run. */
export const TERMINAL_EVENT_KINDS = ["run.completed", "run.failed", "run.cancelled"] as const;
export type TerminalEventKind = UnionOf<typeof TERMINAL_EVENT_KINDS>;

export function isTerminalKind(kind: NormalizedEventKind): kind is TerminalEventKind {
  return (TERMINAL_EVENT_KINDS as readonly string[]).includes(kind);
}

/**
 * Invariant 9: thinking is streamed for live display and NEVER persisted.
 *
 * Reasoning *token counts* are recorded (they arrive on `usage`);
 * chain-of-thought *content* is neither handoff nor evidence. This predicate
 * is the one place that rule is expressed, so the journal writer and the
 * projector cannot disagree about it.
 */
export function isPersistableKind(kind: NormalizedEventKind): boolean {
  return kind !== "thinking.delta";
}

export const NOTICE_CODES = [
  "unknown-provider-event",
  "non-json-output",
  "clock-skew",
  "malformed-usage",
  "output-truncated",
  "sqlite-projection-failed",
] as const;
export type NoticeCode = UnionOf<typeof NOTICE_CODES>;

export const RUN_ERROR_CODES = [
  "E_INVALID_REQUEST",
  "E_BACKEND_FAILURE",
  "E_TERMINAL_MISSING",
  "E_MODEL_UNRESOLVED",
  "E_MODEL_MISMATCH",
  "E_TIMEOUT",
  "E_CANCELLED",
  "E_QUOTA_EXHAUSTED",
  "E_POLICY_CEILING_UNENFORCEABLE",
  "E_ADAPTER_UNVERIFIED",
  "E_REDACTION",
] as const;
export type RunErrorCode = UnionOf<typeof RUN_ERROR_CODES>;

/**
 * How a resolved model identity was established.
 *
 * `stream-authoritative` — the provider named the model in its own stream.
 * `route-attributed` — the host inferred it from the route it requested.
 * The UI must never present the second as the first.
 */
export const MODEL_RESOLUTION_PROVENANCES = ["stream-authoritative", "route-attributed"] as const;
export type ModelResolutionProvenance = UnionOf<typeof MODEL_RESOLUTION_PROVENANCES>;

/** Whether reasoning tokens are already inside `output`, added on top of it, or unknown. */
export const REASONING_RELATIONS = ["included-in-output", "additive", "unknown"] as const;
export type ReasoningRelation = UnionOf<typeof REASONING_RELATIONS>;

export const TOOL_OUTCOMES = ["ok", "error", "cancelled"] as const;
export type ToolOutcome = UnionOf<typeof TOOL_OUTCOMES>;

/**
 * The five token metrics. Every one is required-and-nullable: `null` means the
 * provider did not report it, `0` means it reported zero and is authoritative
 * data. SSSF's "reasoning is a share of output" convention becomes the
 * `included-in-output` case of `reasoningRelation`, never a global truth.
 */
export const TokenUsageSchema = Type.Object(
  {
    inputTokens: NullableCount,
    outputTokens: NullableCount,
    cacheReadTokens: NullableCount,
    cacheWriteTokens: NullableCount,
    reasoningTokens: NullableCount,
    reasoningRelation: stringUnion(REASONING_RELATIONS),
  },
  { additionalProperties: false },
);
export type TokenUsage = Static<typeof TokenUsageSchema>;

/** A usage record in which the provider reported nothing. Not zeros — nulls. */
export const UNREPORTED_TOKEN_USAGE: TokenUsage = {
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  reasoningTokens: null,
  reasoningRelation: "unknown",
};

// ---------------------------------------------------------------------------
// Event envelope
// ---------------------------------------------------------------------------

/**
 * `seq` is authoritative; `providerAt` is advisory (`events.ts:45-49`).
 *
 * Provider clocks skew, arrive out of order, and are sometimes absent
 * entirely — ordering is never derived from them. `hostAt` is the host's own
 * observation time and is always present; `providerAt` is nullable and is only
 * ever displayed, never sorted on.
 */
const EVENT_BASE_PROPERTIES = {
  seq: Type.Integer({ minimum: 1 }),
  runId: Type.String({ minLength: 1 }),
  hostAt: Type.String({ minLength: 1 }),
  providerAt: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
};

// Return type inferred, for the same reason as `phaseEnvelope`.
function eventSchema<const K extends NormalizedEventKind, P extends TProperties>(kind: K, payload: P) {
  return Type.Object(
    { ...EVENT_BASE_PROPERTIES, kind: Type.Literal(kind), ...payload },
    { additionalProperties: false },
  );
}

export const RunStartedEventSchema = eventSchema("run.started", {
  adapter: Type.String({ minLength: 1 }),
  requestedModel: Type.String({ minLength: 1 }),
});

export const ModelResolvedEventSchema = eventSchema("model.resolved", {
  adapter: Type.String({ minLength: 1 }),
  provider: Type.String({ minLength: 1 }),
  requestedModel: Type.String({ minLength: 1 }),
  resolvedModel: Type.String({ minLength: 1 }),
  // A model the harness cannot represent does not silently resolve — the
  // adapter fails closed with `E_MODEL_UNRESOLVED` and this event never fires.
  provenance: stringUnion(MODEL_RESOLUTION_PROVENANCES),
});

export const TextDeltaEventSchema = eventSchema("text.delta", { text: Type.String() });

// Streamed for live display; excluded from persistence by `isPersistableKind`.
export const ThinkingDeltaEventSchema = eventSchema("thinking.delta", { text: Type.String() });

export const ToolRequestedEventSchema = eventSchema("tool.requested", {
  // Host-minted `t1, t2, …`. Provider tool ids never reach a normalized event.
  toolCallId: Type.String({ pattern: "^t[1-9][0-9]*$" }),
  name: Type.String({ minLength: 1 }),
  inputSummary: Type.String(),
});

export const ToolCompletedEventSchema = eventSchema("tool.completed", {
  toolCallId: Type.String({ pattern: "^t[1-9][0-9]*$" }),
  outcome: stringUnion(TOOL_OUTCOMES),
  durationMs: Type.Integer({ minimum: 0 }),
  resultSnippet: Type.String(),
});

export const UsageEventSchema = eventSchema("usage", { usage: TokenUsageSchema });

// Quota is never a retry — it blocks with the reset time. Routing may never
// read quota, so no routing-relevant field belongs on this event.
export const QuotaEventSchema = eventSchema("quota", {
  scope: Type.String({ minLength: 1 }),
  resetAt: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  message: Type.String(),
});

export const NoticeEventSchema = eventSchema("notice", {
  code: stringUnion(NOTICE_CODES),
  message: Type.String({ minLength: 1 }),
  detail: Type.Union([Type.String(), Type.Null()]),
});

export const RunCompletedEventSchema = eventSchema("run.completed", {
  exitCode: Type.Union([Type.Integer(), Type.Null()]),
});

export const RunFailedEventSchema = eventSchema("run.failed", {
  errorCode: stringUnion(RUN_ERROR_CODES),
  message: Type.String({ minLength: 1 }),
});

export const RunCancelledEventSchema = eventSchema("run.cancelled", {
  reason: Type.String({ minLength: 1 }),
});

/** One schema per kind, keyed by kind — the registry parsers and the journal share. */
export const NORMALIZED_EVENT_SCHEMAS = {
  "run.started": RunStartedEventSchema,
  "model.resolved": ModelResolvedEventSchema,
  "text.delta": TextDeltaEventSchema,
  "thinking.delta": ThinkingDeltaEventSchema,
  "tool.requested": ToolRequestedEventSchema,
  "tool.completed": ToolCompletedEventSchema,
  usage: UsageEventSchema,
  quota: QuotaEventSchema,
  notice: NoticeEventSchema,
  "run.completed": RunCompletedEventSchema,
  "run.failed": RunFailedEventSchema,
  "run.cancelled": RunCancelledEventSchema,
} as const;

export const NormalizedEventSchema = Type.Union([
  RunStartedEventSchema,
  ModelResolvedEventSchema,
  TextDeltaEventSchema,
  ThinkingDeltaEventSchema,
  ToolRequestedEventSchema,
  ToolCompletedEventSchema,
  UsageEventSchema,
  QuotaEventSchema,
  NoticeEventSchema,
  RunCompletedEventSchema,
  RunFailedEventSchema,
  RunCancelledEventSchema,
]);
export type NormalizedEvent = Static<typeof NormalizedEventSchema>;

/** Host-minted tool call id. Provider ids are never propagated. */
export function mintToolCallId(ordinal: number): string {
  if (!Number.isInteger(ordinal) || ordinal < 1) {
    throw new RangeError(`tool call ordinal must be an integer >= 1, got ${String(ordinal)}`);
  }
  return `t${ordinal}`;
}

// ---------------------------------------------------------------------------
// Sequence invariants — pure, so they can be asserted on any recorded run
// ---------------------------------------------------------------------------

export const EVENT_SEQUENCE_VIOLATION_CODES = [
  "seq-not-contiguous",
  "terminal-not-last",
  "terminal-missing",
  "terminal-duplicated",
  "tool-settled-without-request",
  "tool-settled-twice",
  "tool-unsettled-at-terminal",
  "tool-id-reused",
] as const;
export type EventSequenceViolationCode = UnionOf<typeof EVENT_SEQUENCE_VIOLATION_CODES>;

export interface EventSequenceViolation {
  code: EventSequenceViolationCode;
  seq: number | null;
  detail: string;
}

/**
 * Checks the invariants that hold over a whole run's event list.
 *
 * - Sequence is authoritative: `seq` starts at 1 and is contiguous.
 * - Exactly one terminal event per run, and it is last.
 * - `tool.completed` is an *explicit* settlement: a terminal never closes tool
 *   calls implicitly, so an open tool call at the terminal is a violation, not
 *   a shrug (`events.ts:51-54`, `adapters.ts:504-513, 789-798`). Cancellation
 *   settles every open tool *first* — which is exactly why an unsettled tool
 *   at `run.cancelled` is as much a defect as one at `run.completed`.
 *
 * Pure: returns every violation it finds rather than throwing on the first, so
 * a trace can show the full picture of what a parser got wrong.
 */
export function validateEventSequence(events: readonly NormalizedEvent[]): EventSequenceViolation[] {
  const violations: EventSequenceViolation[] = [];

  events.forEach((event, index) => {
    if (event.seq !== index + 1) {
      violations.push({
        code: "seq-not-contiguous",
        seq: event.seq,
        detail: `event at position ${index} carries seq ${event.seq}; expected ${index + 1}`,
      });
    }
  });

  const terminals = events.filter((event) => isTerminalKind(event.kind));
  if (terminals.length === 0) {
    violations.push({ code: "terminal-missing", seq: null, detail: "run has no terminal event" });
  } else if (terminals.length > 1) {
    for (const extra of terminals.slice(1)) {
      violations.push({
        code: "terminal-duplicated",
        seq: extra.seq,
        detail: `second terminal event ${extra.kind}; exactly one is permitted`,
      });
    }
  }
  const firstTerminal = terminals[0];
  if (firstTerminal !== undefined && events[events.length - 1] !== firstTerminal) {
    violations.push({
      code: "terminal-not-last",
      seq: firstTerminal.seq,
      detail: `terminal ${firstTerminal.kind} is followed by further events`,
    });
  }

  const requested = new Set<string>();
  const settled = new Set<string>();
  for (const event of events) {
    if (event.kind === "tool.requested") {
      if (requested.has(event.toolCallId)) {
        violations.push({
          code: "tool-id-reused",
          seq: event.seq,
          detail: `tool call id ${event.toolCallId} requested twice`,
        });
      }
      requested.add(event.toolCallId);
    } else if (event.kind === "tool.completed") {
      if (!requested.has(event.toolCallId)) {
        violations.push({
          code: "tool-settled-without-request",
          seq: event.seq,
          detail: `tool call id ${event.toolCallId} settled with no preceding tool.requested`,
        });
      } else if (settled.has(event.toolCallId)) {
        violations.push({
          code: "tool-settled-twice",
          seq: event.seq,
          detail: `tool call id ${event.toolCallId} settled more than once`,
        });
      }
      settled.add(event.toolCallId);
    }
  }
  if (firstTerminal !== undefined) {
    for (const id of requested) {
      if (!settled.has(id)) {
        violations.push({
          code: "tool-unsettled-at-terminal",
          seq: firstTerminal.seq,
          detail: `tool call id ${id} was still open at ${firstTerminal.kind}; terminals never settle tools implicitly`,
        });
      }
    }
  }

  return violations;
}
