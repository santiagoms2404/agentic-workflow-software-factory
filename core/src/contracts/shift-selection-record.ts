import { createHash } from "node:crypto";
import { Type, type Static } from "@sinclair/typebox";
import { canonicalJson } from "./owner-amendment.ts";
import { TICKET_WORKFLOWS } from "./ticket.ts";
import { stringUnion, toJsonSchema } from "./typebox.ts";

// The durable record of one shift selection: which plan, which milestones in
// the owner's order, and every selected ticket file with a digest of its bytes.
// It is written once at selection and is the input recovery recompiles from,
// so the recipe can be rebuilt byte-for-byte or refused (INV-4). A shift
// selects one or more milestones; `milestones` is a list even when it holds
// one, and there is no singular form.
export const SHIFT_MANIFEST_SCHEMA_ID = "awsf.shift-manifest/v1";

const Sha256Hex = Type.String({ pattern: "^[a-f0-9]{64}$" });

export const ShiftManifestTicketSchema = Type.Object(
  {
    id: Type.String({ pattern: "^[TW][0-9]{2}$" }),
    /** Repository-relative POSIX path of the ticket file. */
    path: Type.String({ pattern: "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[^\\\\]+\\.md$" }),
    /** sha256 hex over the whole ticket file, not its prompt block. */
    digest: Sha256Hex,
    tier: Type.Optional(Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2)])),
    workflow: Type.Optional(stringUnion(TICKET_WORKFLOWS)),
  },
  { additionalProperties: false },
);

export const ShiftManifestSchema = Type.Object(
  {
    /** The plan stem: the plan HTML's basename and its ticket directory's name. */
    plan: Type.String({ pattern: "^[a-z0-9][a-z0-9.-]*$" }),
    milestones: Type.Array(Type.String({ pattern: "^M[0-9]+$" }), { minItems: 1, uniqueItems: true }),
    tickets: Type.Array(ShiftManifestTicketSchema, { minItems: 1 }),
    manifestDigest: Sha256Hex,
  },
  { additionalProperties: false, $id: SHIFT_MANIFEST_SCHEMA_ID, title: "ShiftManifest" },
);

export type ShiftManifestTicket = Static<typeof ShiftManifestTicketSchema>;
export type ShiftManifest = Static<typeof ShiftManifestSchema>;
export type ShiftManifestBody = Omit<ShiftManifest, "manifestDigest">;

/**
 * sha256 hex over the canonical JSON of everything but the digest itself.
 * Each ticket's own digest is inside it, so any byte of any selected ticket
 * file moving changes this value.
 */
export function shiftManifestDigest(body: ShiftManifestBody): string {
  const { plan, milestones, tickets } = body;
  return createHash("sha256").update(canonicalJson({ plan, milestones, tickets }), "utf8").digest("hex");
}

export function sealShiftManifest(body: ShiftManifestBody): ShiftManifest {
  return {
    plan: body.plan,
    milestones: [...body.milestones],
    tickets: body.tickets.map((ticket) => ({ ...ticket })),
    manifestDigest: shiftManifestDigest(body),
  };
}

/** The JSON Schema emission of ShiftManifestSchema; never a hand-maintained copy. */
export function emitShiftManifestJsonSchema(): Record<string, unknown> {
  return toJsonSchema(ShiftManifestSchema, {
    $id: `https://awsf.local/schemas/${SHIFT_MANIFEST_SCHEMA_ID}`,
    title: "ShiftManifest",
    description: "One shift selection: a plan, its selected milestones, and a byte digest per ticket file.",
  });
}
