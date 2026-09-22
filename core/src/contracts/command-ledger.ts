import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { sha256, canonicalJson } from "./owner-amendment.ts";

const id = Type.String({ minLength: 1 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const sha = Type.String({ pattern: "^[a-f0-9]{40}$" });

/**
 * Every site that dispatches an owner-configured `config.gates` command.
 *
 * The list is closed on purpose. A recovery decision about a dispatcher this
 * attempt's activation record does not name is refused rather than guessed at,
 * so adding a fourth site is a protocol change and not a silent widening.
 */
export const COMMAND_DISPATCHERS = [
  "production-run/measure-candidate", "rework/owner-gates", "adopt/adoption-tests",
] as const;
export type CommandDispatcherId = (typeof COMMAND_DISPATCHERS)[number];
const DispatcherSchema = Type.Union(COMMAND_DISPATCHERS.map(value => Type.Literal(value)));

export const COMMAND_LEDGER_PROTOCOL_VERSION = 1;

/**
 * Which call site produced a measurement, and therefore who may adopt it.
 *
 * `verify-candidate` is the builder's own pre-acceptance measurement — the only
 * one that enters `candidateMeasurements` today, and so the only one a later
 * host command phase may reuse. `phase-dispatch` is a phase measuring for
 * itself; a second phase adopting one of those would silently elide a configured
 * command phase that was meant to re-run after the tree changed.
 */
export const COMMAND_ORIGINS = ["verify-candidate", "phase-dispatch"] as const;
export type CommandOrigin = (typeof COMMAND_ORIGINS)[number];
const OriginSchema = Type.Union(COMMAND_ORIGINS.map(value => Type.Literal(value)));

/**
 * One owner-configured command, recorded before it is spawned.
 *
 * `runId` is deliberately optional and never part of the key: it names a
 * physical process, not a logical occurrence, and two of the three dispatch
 * sites have none in scope. The occurrence is identified by
 * `(dispatcherId, occurrenceKey, gateId)`, which each site derives to be
 * one-to-one with the path its retained output already lands on.
 */
export const CommandDispatchIntentSchema = Type.Object({
  schema: Type.Literal("awsf.command-dispatch-intent/v1"),
  intentId: id, dispatcherId: DispatcherSchema, occurrenceKey: id, gateId: id,
  origin: OriginSchema,
  phaseKey: id, phaseOrdinal: Type.Integer({ minimum: 0 }), round: Type.Integer({ minimum: 0 }),
  attempt: Type.Integer({ minimum: 1 }), sessionId: id,
  runId: Type.Optional(id),
  argv: Type.Array(Type.String(), { minItems: 1 }), argvDigest: hash,
  cwd: id, worktreeRealPath: id,
  timeoutMs: Type.Integer({ minimum: 0 }), maxOutputBytes: Type.Integer({ minimum: 0 }),
  gateConfigDigest: hash, gatesConfigDigest: hash,
  candidateSha: sha, headBefore: sha, cleanBefore: Type.Boolean(),
  dispatchedAt: id,
}, { additionalProperties: false });
export type CommandDispatchIntent = Static<typeof CommandDispatchIntentSchema>;

/**
 * How that command settled, recorded before anything reads the measurement.
 *
 * `outcome` is computed only from what `runSystemCommand` actually returns —
 * a numeric status or not. It deliberately does NOT try to separate a timeout
 * from an external kill from a spawn failure: the broker discards `signal` and
 * `error.code`, so that distinction would rest on matching a message string.
 * All three collapse to `no-exit`, which is never restorable.
 *
 * `descendantQuiescence` has one legal value. `runSystemCommand` surfaces no pid
 * and no pgid, so a surviving grandchild cannot be attributed to the command
 * that spawned it. The field names the limit where a reader will look for it
 * rather than leaving it implicit.
 */
export const COMMAND_OUTCOMES = ["exited", "no-exit", "withheld"] as const;
export type CommandOutcome = (typeof COMMAND_OUTCOMES)[number];
const OutcomeSchema = Type.Union(COMMAND_OUTCOMES.map(value => Type.Literal(value)));

export const CommandDispatchResultSchema = Type.Object({
  schema: Type.Literal("awsf.command-dispatch-result/v1"),
  intentId: id, outcome: OutcomeSchema,
  exitCode: Type.Integer(), durationMs: Type.Integer({ minimum: 0 }),
  outputRef: Type.Union([id, Type.Null()]),
  outputBytes: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  outputDigest: Type.Union([hash, Type.Null()]),
  headAfter: sha, cleanAfter: Type.Boolean(),
  descendantQuiescence: Type.Literal("unproved"),
  settledAt: id,
}, { additionalProperties: false });
export type CommandDispatchResult = Static<typeof CommandDispatchResultSchema>;

/**
 * A ledger-aware dispatcher reached this occurrence's dispatch point.
 *
 * This is what makes absence of an intent mean anything. A passing
 * `candidate_hygiene` record proves only that SOME host reached the dispatch
 * point; it cannot tell a governed run that died before writing its first
 * intent from a pre-ledger binary that dispatched and recorded nothing, because
 * both leave zero intents. Only ledger-aware code writes this marker, so a
 * dispatch point without one is ungoverned and refuses, while a dispatch point
 * with one may be reasoned about gate by gate.
 *
 * Written after the hygiene record and before the first spawn.
 */
export const CommandOccurrenceOpenedSchema = Type.Object({
  schema: Type.Literal("awsf.command-occurrence-opened/v1"),
  dispatcherId: DispatcherSchema, occurrenceKey: id,
  protocolVersion: Type.Integer({ minimum: 1 }),
  openedAt: id,
}, { additionalProperties: false });
export type CommandOccurrenceOpened = Static<typeof CommandOccurrenceOpenedSchema>;

export function assertCommandOccurrenceOpened(value: unknown): asserts value is CommandOccurrenceOpened {
  if (!Value.Check(CommandOccurrenceOpenedSchema, value)) throw new Error("command occurrence opening is invalid");
}

/**
 * This occurrence will dispatch nothing further, on purpose.
 *
 * Two shapes reach it. A gate loop that stopped early because a command dirtied
 * the tree must NOT have its remaining gates resumed — those commands were
 * withheld deliberately. And four aborts sit between the unconditional hygiene
 * record and the first spawn, so an occurrence can reach the dispatch point and
 * dispatch nothing; without a marker the completeness predicate would read that
 * as an ungoverned dispatch and refuse every later decision in the attempt.
 */
export const CommandOccurrenceClosedSchema = Type.Object({
  schema: Type.Literal("awsf.command-occurrence-closed/v1"),
  dispatcherId: DispatcherSchema, occurrenceKey: id,
  reason: Type.String({ minLength: 1 }),
  closedAt: id,
}, { additionalProperties: false });
export type CommandOccurrenceClosed = Static<typeof CommandOccurrenceClosedSchema>;

export const argvDigest = (argv: readonly string[]): string => sha256(canonicalJson([...argv]));
export const gateConfigDigest = (gate: { argv: readonly string[]; timeout_seconds: number }): string =>
  sha256(canonicalJson({ argv: [...gate.argv], timeout_seconds: gate.timeout_seconds }));
export const gatesConfigDigest = (gates: Readonly<Record<string, { argv: readonly string[]; timeout_seconds: number }>>): string =>
  sha256(canonicalJson(Object.keys(gates).sort().map(key => [key, { argv: [...gates[key]!.argv], timeout_seconds: gates[key]!.timeout_seconds }])));

/** The one spelling of an occurrence's identity, so key and retained path cannot drift apart. */
export function commandLedgerKey(dispatcherId: CommandDispatcherId, occurrenceKey: string, gateId: string): string {
  return `${dispatcherId}\u0000${occurrenceKey}\u0000${gateId}`;
}

export function assertCommandDispatchIntent(value: unknown): asserts value is CommandDispatchIntent {
  if (!Value.Check(CommandDispatchIntentSchema, value)) throw new Error("command dispatch intent is invalid");
  if (value.argvDigest !== argvDigest(value.argv)) throw new Error("command dispatch intent argv disagrees with its digest");
}

export function assertCommandDispatchResult(value: unknown): asserts value is CommandDispatchResult {
  if (!Value.Check(CommandDispatchResultSchema, value)) throw new Error("command dispatch result is invalid");
  // Withheld output is the one case with nothing retained: the command ran and
  // its bytes were refused, so there is no ref, no length and no digest to
  // record. Every other outcome retained something, even a timeout's partial
  // capture, and all three fields move together.
  const retained = value.outcome !== "withheld";
  if ((value.outputRef !== null) !== retained || (value.outputBytes !== null) !== retained ||
      (value.outputDigest !== null) !== retained) {
    throw new Error("command dispatch result retention disagrees with its outcome");
  }
}

export function assertCommandOccurrenceClosed(value: unknown): asserts value is CommandOccurrenceClosed {
  if (!Value.Check(CommandOccurrenceClosedSchema, value)) throw new Error("command occurrence closure is invalid");
}
