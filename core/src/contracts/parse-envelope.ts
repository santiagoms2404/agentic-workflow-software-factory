import { Value } from "@sinclair/typebox/value";
import type { EnvelopeBase } from "./envelope-base.ts";
import { isEnvelopeSchemaId, schemaForId, type EnvelopeSchemaId, type EnvelopeTypeById } from "./registry.ts";
import { VIOLATION_VALUE_MAX_CHARS, type ValidationViolation } from "./stored-envelope.ts";
import { utf8ByteLength } from "./typebox.ts";

// The envelope parser.
//
// Rules, from the Envelope & Gate Contract:
//   - Final assistant content must be exactly one JSON object.
//   - Prose and code fences are rejected — but the parser strips fences and
//     salvages a complete JSON object *before* rejecting. It first tries the
//     outermost `{…}`, then the last complete object when a provider abandoned
//     a partial object and emitted a corrected one in the same final message.
//     The trace distinguishes clean JSON from host extraction without burning
//     a correction round on transport-shaped duplication.
//   - Maximum envelope size 256 KiB.
//   - Unknown fields rejected (every schema is `additionalProperties: false`).
//   - Invalid envelopes are retained with their violations.

export const MAX_ENVELOPE_BYTES = 256 * 1024;

/** How the JSON object was recovered from the model's final message. */
export type EnvelopeExtraction = "exact" | "fence-stripped" | "outermost-object";

export type ParseEnvelopeResult<T extends EnvelopeBase> =
  | { valid: true; payload: T; extraction: EnvelopeExtraction }
  | { valid: false; violations: ValidationViolation[]; extraction: EnvelopeExtraction | null };

const FENCED_BLOCK_RE = /```[A-Za-z0-9_-]*[ \t]*\r?\n?([\s\S]*?)```/;

function bound(value: unknown): string | null {
  if (value === undefined) return null;
  let rendered: string;
  try {
    rendered = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  } catch {
    rendered = String(value);
  }
  if (rendered.length <= VIOLATION_VALUE_MAX_CHARS) return rendered;
  return `${rendered.slice(0, VIOLATION_VALUE_MAX_CHARS - 1)}…`;
}

function tryParseObject(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/** Recovers the single JSON object from a model's final message, recording how much digging it took. */
function extract(raw: string): { extraction: EnvelopeExtraction; value: unknown } | null {
  const trimmed = raw.trim();

  // The whole message is already valid JSON. Whether it is an *object* is the
  // next check's business — reporting "not an object" beats reporting "not
  // JSON" when the model emitted a perfectly good array.
  const exact = tryParseObject(trimmed);
  if (exact.ok) return { extraction: "exact", value: exact.value };

  const fenced = FENCED_BLOCK_RE.exec(trimmed);
  if (fenced?.[1] !== undefined) {
    const inner = fenced[1].trim();
    const parsed = tryParseObject(inner);
    if (parsed.ok) return { extraction: "fence-stripped", value: parsed.value };
  }

  // First opening brace to last closing brace handles ordinary prose wrapping.
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) {
    const parsed = tryParseObject(trimmed.slice(first, last + 1));
    if (parsed.ok) return { extraction: "outermost-object", value: parsed.value };

    // Some provider streams retain an abandoned partial object immediately
    // before the corrected final object. Work backward from the final closing
    // brace and accept only a suffix that parses whole. The bound prevents a
    // brace-heavy malformed response from turning salvage into unbounded work.
    let opening = trimmed.lastIndexOf("{", last - 1);
    for (let attempts = 0; opening > first && attempts < 1_024; attempts += 1) {
      const suffix = tryParseObject(trimmed.slice(opening, last + 1));
      if (suffix.ok) return { extraction: "outermost-object", value: suffix.value };
      opening = trimmed.lastIndexOf("{", opening - 1);
    }
  }

  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses and validates a model's final message against one envelope schema.
 *
 * Never throws on bad model output — every failure comes back as a retained
 * violation list, because an invalid envelope is evidence, not an absence.
 */
export function parseEnvelope<K extends EnvelopeSchemaId>(
  raw: string,
  schemaId: K,
): ParseEnvelopeResult<EnvelopeTypeById[K]>;
export function parseEnvelope(raw: string, schemaId: string): ParseEnvelopeResult<EnvelopeBase>;
export function parseEnvelope(raw: string, schemaId: string): ParseEnvelopeResult<EnvelopeBase> {
  if (!isEnvelopeSchemaId(schemaId)) {
    return {
      valid: false,
      extraction: null,
      violations: [
        {
          kind: "unknown-schema-id",
          path: "",
          message: `unknown envelope schema id: "${schemaId}"`,
          received: bound(schemaId),
        },
      ],
    };
  }

  const byteLength = utf8ByteLength(raw);
  if (byteLength > MAX_ENVELOPE_BYTES) {
    return {
      valid: false,
      extraction: null,
      violations: [
        {
          kind: "size-exceeded",
          path: "",
          message: `envelope is ${byteLength} bytes; the maximum is ${MAX_ENVELOPE_BYTES}`,
          received: null,
        },
      ],
    };
  }

  const extracted = extract(raw);
  if (extracted === null) {
    return {
      valid: false,
      extraction: null,
      violations: [
        {
          kind: "not-json",
          path: "",
          message: "final message is not a single JSON object, with or without fences",
          received: bound(raw.trim()),
        },
      ],
    };
  }

  if (!isPlainObject(extracted.value)) {
    return {
      valid: false,
      extraction: extracted.extraction,
      violations: [
        {
          kind: "not-an-object",
          path: "",
          message: `final message parsed as ${Array.isArray(extracted.value) ? "an array" : typeof extracted.value}, not a JSON object`,
          received: bound(extracted.value),
        },
      ],
    };
  }

  const schema = schemaForId(schemaId);
  if (!Value.Check(schema, extracted.value)) {
    const violations: ValidationViolation[] = [...Value.Errors(schema, extracted.value)].map((error) => ({
      kind: "schema-mismatch" as const,
      path: error.path,
      message: error.message,
      received: bound(error.value),
    }));
    return { valid: false, extraction: extracted.extraction, violations };
  }

  return { valid: true, extraction: extracted.extraction, payload: extracted.value as unknown as EnvelopeBase };
}
