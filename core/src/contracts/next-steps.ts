import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { ACTORS, LEGAL_EDGES, TASK_STATES } from "../state/task-machine.ts";
import { stringUnion } from "./typebox.ts";

/** Host-owned lifecycle inventory, never an agent-output envelope or authorization. */
export const NEXT_STEPS_SCHEMA_ID = "awsf.next/v1";
const text = Type.String({ minLength: 1, pattern: "\\S" });
const edge = stringUnion(LEGAL_EDGES.map(value => value.id));
const state = stringUnion(TASK_STATES);
const advice = {
  verb: text,
  /** Executable plus tokens; placeholders require real values before invocation. */
  argv: Type.Array(text, { minItems: 3 }),
  who: stringUnion(["driver", "owner"]),
  interactive: Type.Boolean(),
  spendsCalls: Type.Boolean(),
  // T11 supplies K1 requirements; reserving their shape now avoids a second schema.
  requires: Type.Array(Type.Object({ check: text, field: text, status: text }, { additionalProperties: false })),
};

export const NextStepSchema = Type.Union([
  Type.Object({ kind: Type.Literal("edge"), edge, to: state, ...advice }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("act"), ...advice }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("read"), ...advice }, { additionalProperties: false }),
]);
export const NextWaitSchema = Type.Object({
  edge, to: state, who: Type.Literal("host"),
}, { additionalProperties: false });
export const UnavailableEdgeSchema = Type.Object({
  edge, to: state,
  actors: Type.Array(stringUnion(ACTORS), { minItems: 1, uniqueItems: true }),
  reason: Type.Literal("not-implemented"),
  detail: text,
}, { additionalProperties: false });

export const NextStepsSchema = Type.Object({
  schema: Type.Literal(NEXT_STEPS_SCHEMA_ID),
  project: text,
  taskId: text,
  attempt: Type.Integer({ minimum: 1 }),
  revision: Type.Integer({ minimum: 0 }),
  state,
  steps: Type.Array(NextStepSchema),
  waits: Type.Array(NextWaitSchema),
  unavailable: Type.Array(UnavailableEdgeSchema),
}, { additionalProperties: false, $id: NEXT_STEPS_SCHEMA_ID, title: "NextSteps" });

export type NextStep = Static<typeof NextStepSchema>;
export type NextWait = Static<typeof NextWaitSchema>;
export type UnavailableEdge = Static<typeof UnavailableEdgeSchema>;
export type NextSteps = Static<typeof NextStepsSchema>;

export function assertNextSteps(value: unknown): asserts value is NextSteps {
  if (!Value.Check(NextStepsSchema, value)) {
    const first = [...Value.Errors(NextStepsSchema, value)][0];
    throw new Error(`invalid ${NEXT_STEPS_SCHEMA_ID} record${first === undefined ? "" : ` at ${first.path}: ${first.message}`}`);
  }
}
