import { type Static } from "@sinclair/typebox";
import { phaseEnvelope } from "./envelope-base.ts";
import { TicketSchema } from "./ticket.ts";

export const INTAKE_OUTPUT_SCHEMA_ID = "awsf.intake-output/v1" as const;

/**
 * The intake phase remains an AWSF envelope while carrying the Ticket itself
 * from the one TicketSchema source. The host validates both layers before a
 * ticket can be written.
 */
export const IntakeOutputSchema = phaseEnvelope(
  INTAKE_OUTPUT_SCHEMA_ID,
  { ticket: TicketSchema },
  "A validated work-intake result containing one durable ticket.",
);

export type IntakeOutput = Static<typeof IntakeOutputSchema>;
