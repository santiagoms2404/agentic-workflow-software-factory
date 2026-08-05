import { toJsonSchema } from "./typebox.ts";
import { ENVELOPE_SCHEMA_IDS, schemaForId, type EnvelopeSchemaId } from "./registry.ts";

// JSON Schema emission and prompt injection.
//
// This module exists so that no prompt, gate, or document ever contains a
// handwritten copy of an envelope shape. SSSF's worst maintenance defect was
// keeping the schema, the example, and the gate in three places and letting
// them drift; here the prompt's schema block is *generated* from the same
// TypeBox definition the validator uses, at compile time, every time.
// `core/test/unit/meta/no-handwritten-schema.test.ts` fails the build if a
// handwritten block reappears under `prompts/`.

/** The token a prompt template must contain; the compiler replaces it with the emitted schema. */
export const OUTPUT_SCHEMA_PLACEHOLDER = "{output_schema}";

/** The token the workflow compiler replaces with the previous phase's validated payload (T20). */
export const PREVIOUS_ENVELOPE_PLACEHOLDER = "{previous_envelope}";

export class MissingSchemaPlaceholderError extends Error {
  readonly code = "E_MISSING_SCHEMA_PLACEHOLDER";
  constructor() {
    super(
      `prompt template contains no ${OUTPUT_SCHEMA_PLACEHOLDER} placeholder; ` +
        "an agent prompt must never ship without its output schema",
    );
    this.name = "MissingSchemaPlaceholderError";
  }
}

/** Emits the JSON Schema for one envelope id — the third emission of the single TypeBox definition. */
export function emitEnvelopeJsonSchema(schemaId: string): Record<string, unknown> {
  const schema = schemaForId(schemaId);
  return toJsonSchema(schema, {
    $id: `https://awsf.local/schemas/${schemaId}`,
    title: schemaId,
  });
}

/** Every envelope schema, emitted. Useful for `awsf schema dump` and for contract tests. */
export function emitAllEnvelopeJsonSchemas(): Record<EnvelopeSchemaId, Record<string, unknown>> {
  const out = {} as Record<EnvelopeSchemaId, Record<string, unknown>>;
  for (const id of ENVELOPE_SCHEMA_IDS) {
    out[id] = emitEnvelopeJsonSchema(id);
  }
  return out;
}

/**
 * Renders the block that goes into an agent prompt.
 *
 * Deliberately terse and machine-shaped: the schema itself carries the
 * descriptions, so there is nothing here for a human to keep in sync.
 */
export function renderSchemaBlock(schemaId: string): string {
  const emitted = emitEnvelopeJsonSchema(schemaId);
  return [
    "Your final message must be exactly one JSON object and nothing else —",
    "no prose before or after it, no code fences.",
    "It must validate against this JSON Schema; unknown fields are rejected.",
    "",
    "```json",
    JSON.stringify(emitted, null, 2),
    "```",
  ].join("\n");
}

/**
 * Substitutes the emitted schema into a prompt template.
 *
 * Throws when the placeholder is absent: a template that silently ships
 * without its schema is precisely the failure this task exists to make
 * impossible, so it fails loudly at compile time rather than at parse time.
 */
export function injectOutputSchema(template: string, schemaId: string): string {
  if (!template.includes(OUTPUT_SCHEMA_PLACEHOLDER)) {
    throw new MissingSchemaPlaceholderError();
  }
  return template.split(OUTPUT_SCHEMA_PLACEHOLDER).join(renderSchemaBlock(schemaId));
}
