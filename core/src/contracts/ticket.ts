import { Type, type Static } from "@sinclair/typebox";
import { stringUnion, toJsonSchema, type UnionOf } from "./typebox.ts";

// Tickets are durable, file-backed work items. Like every contract in this
// directory, this one TypeBox definition is the validator's shape, the static
// TypeScript type, and the JSON Schema consumers may emit.
export const TICKET_STATES = ["todo", "wip", "done", "failed"] as const;
export type TicketState = UnionOf<typeof TICKET_STATES>;

export const TICKET_WORKFLOWS = [
  "scout",
  "plan",
  "build",
  "plan-build-test",
  "build-review",
  "simple-sdlc",
  "intake",
] as const;
export type TicketWorkflow = UnionOf<typeof TICKET_WORKFLOWS>;

const TicketId = Type.String({ pattern: "^T[0-9]{2}$" });
const TicketText = Type.String({ minLength: 1 });

export const TicketSchema = Type.Object(
  {
    id: TicketId,
    title: TicketText,
    milestone: Type.String({ pattern: "^M[0-9]+$" }),
    tier: Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2)]),
    state: stringUnion(TICKET_STATES),
    depends_on: Type.Array(TicketId),
    workflow: stringUnion(TICKET_WORKFLOWS),
    outcome: TicketText,
    context: Type.Array(TicketText),
    acceptance: Type.Array(TicketText),
    non_goals: Type.Array(TicketText),
  },
  { additionalProperties: false, $id: "awsf.ticket/v1", title: "Ticket" },
);

export type Ticket = Static<typeof TicketSchema>;

/** The JSON Schema emission of TicketSchema; never a hand-maintained copy. */
export function emitTicketJsonSchema(): Record<string, unknown> {
  return toJsonSchema(TicketSchema, {
    $id: "https://awsf.local/schemas/awsf.ticket/v1",
    title: "Ticket",
    description: "A durable AWSF work ticket.",
  });
}
