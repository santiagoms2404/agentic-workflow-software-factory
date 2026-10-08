import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { TrapLinkSchema } from "./attribution-record.ts";
import { NO_TRAP_KINDS } from "../traps/catalogue.ts";

/** Read-only host inventory, never an owner act or a provider envelope. */
export const TRAPS_READOUT_SCHEMA_ID = "awsf.traps/v1";
const text = Type.String({ minLength: 1, pattern: "\\S" });
const instant = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T" });
const count = Type.Integer({ minimum: 0 });
const trapId = Type.String({ pattern: "^TR-[0-9]{2}$" });
const identity = { project: text, taskId: text, attempt: Type.Integer({ minimum: 1 }) };
const stop = { ...identity, terminalAt: instant, lifecycleState: Type.Union([Type.Literal("BLOCKED"), Type.Literal("CANCELLED")]) };
const trap = TrapLinkSchema.anyOf[0];
const none = TrapLinkSchema.anyOf[1];
const closed = { additionalProperties: false } as const;

export const TrapsReadoutSchema = Type.Object({
  schema: Type.Literal(TRAPS_READOUT_SCHEMA_ID),
  cut: instant,
  catalogue: Type.Object({
    traps: count,
    byTrap: Type.Array(Type.Object({ id: trapId, seeds: count }, closed)),
    noTraps: count,
    byNoTrapKind: Type.Object(Object.fromEntries(NO_TRAP_KINDS.map(kind => [kind, count])) as Record<(typeof NO_TRAP_KINDS)[number], typeof count>, closed),
  }, closed),
  stops: Type.Object({
    total: count,
    linkedToTrap: Type.Array(Type.Object({ ...stop, trap }, closed)),
    linkedToNoTrap: Type.Array(Type.Object({ ...stop, trap: none }, closed)),
    missingTrap: Type.Array(Type.Object({ ...stop, trap }, closed)),
    unlinked: Type.Array(Type.Object({ ...stop, preLink: Type.Boolean() }, closed)),
  }, closed),
  nextFreeTrapId: trapId,
  projects: Type.Array(Type.Object({
    project: text,
    newestLanded: Type.Union([Type.Null(), Type.Object({
      taskId: text, attempt: Type.Integer({ minimum: 1 }), landedAt: instant,
      baseSha: Type.Union([text, Type.Null()]), candidateSha: Type.Union([text, Type.Null()]),
      traps: Type.Object({ passed: Type.Union([Type.Boolean(), Type.Null()]), sha: Type.Union([text, Type.Null()]) }, closed),
    }, closed)]),
  }, closed)),
}, { ...closed, $id: TRAPS_READOUT_SCHEMA_ID, title: "TrapsReadout" });

export type TrapsReadout = Static<typeof TrapsReadoutSchema>;

export function assertTrapsReadout(value: unknown): asserts value is TrapsReadout {
  if (!Value.Check(TrapsReadoutSchema, value)) {
    const first = [...Value.Errors(TrapsReadoutSchema, value)][0];
    throw new Error(`invalid ${TRAPS_READOUT_SCHEMA_ID} readout at ${first?.path}: ${first?.message}`);
  }
}
