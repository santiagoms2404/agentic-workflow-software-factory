import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { canonicalJson } from "./owner-amendment.ts";
import { sha256 } from "./hash.ts";
import { ShiftManifestTicketSchema } from "./shift-selection-record.ts";
import { SHA256_HEX_PATTERN } from "./typebox.ts";

/** Host-owned selection; plan=null names exactly one flat light ticket, never a paired set. */
export const TICKET_SELECTION_SCHEMA_ID = "awsf.ticket-selection/v1";
export const TicketSelectionSchema = Type.Object({
  plan: Type.Union([Type.String({ pattern: "^[a-z0-9][a-z0-9.-]*$" }), Type.Null()]),
  tickets: Type.Array(ShiftManifestTicketSchema, { minItems: 1 }),
  selectionDigest: Type.String({ pattern: SHA256_HEX_PATTERN }),
}, { additionalProperties: false, $id: TICKET_SELECTION_SCHEMA_ID, title: "TicketSelection" });
export type TicketSelection = Static<typeof TicketSelectionSchema>;
type Body = Omit<TicketSelection, "selectionDigest">;
export function ticketSelectionDigest({ plan, tickets }: Body): string {
  return sha256(canonicalJson({ plan, tickets }));
}
export function sealTicketSelection(body: Body): TicketSelection {
  const record = { plan: body.plan, tickets: body.tickets.map(ticket => ({ ...ticket })),
    selectionDigest: ticketSelectionDigest(body) };
  assertTicketSelection(record);
  return record;
}
export function assertTicketSelection(record: TicketSelection): void {
  if (!Value.Check(TicketSelectionSchema, record)
    || (record.plan === null && (record.tickets.length !== 1 || !/^T\d\d$/u.test(record.tickets[0]!.id)))
    || new Set(record.tickets.map(ticket => ticket.id)).size !== record.tickets.length
    || ticketSelectionDigest(record) !== record.selectionDigest) {
    throw new Error("ticket selection is not a sealed awsf.ticket-selection/v1");
  }
}
