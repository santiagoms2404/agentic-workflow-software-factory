import { Value } from "@sinclair/typebox/value";
import type { EnvelopeBase } from "./envelope-base.ts";
import { isEnvelopeSchemaId, schemaForId, type EnvelopeSchemaId, type EnvelopeTypeById } from "./registry.ts";
import { VIOLATION_VALUE_MAX_CHARS, type EnvelopeExtraction, type ValidationViolation } from "./stored-envelope.ts";
import { PUBLISH_OUTPUT_SCHEMA_ID, publishedRecoveryRefusal } from "./publish-output.ts";
import { utf8ByteLength } from "./typebox.ts";

// The envelope parser.
//
// Rules, from the Envelope & Gate Contract:
//   - Final assistant content must be exactly one JSON object.
//   - Prose and code fences are rejected — but the parser strips fences and
//     salvages a complete JSON object *before* rejecting. It first tries the
//     outermost `{…}`, then the last complete object when a provider abandoned
//     a partial object and emitted a corrected one in the same final message.
//     If neither parses, it tries the complete first-brace object without any
//     brace-containing prose after it. Existing suffix precedence is preserved.
//     The trace distinguishes clean JSON from host extraction without burning
//     a correction round on transport-shaped duplication.
//   - Maximum envelope size 256 KiB.
//   - Unknown fields rejected (every schema is `additionalProperties: false`).
//   - Invalid envelopes are retained with their violations.

export const MAX_ENVELOPE_BYTES = 256 * 1024;

// How the JSON object was recovered (`EnvelopeExtraction`) is defined in
// stored-envelope.ts, so the persisted record can name it. `trailing-object` is
// the backward suffix salvage and its own kind on purpose: it deliberately
// returns an INNER object, the last suffix that parses whole. Labelling it
// `outermost-object` made the retained trace claim the host had taken the
// outermost object when it had taken a trailing one, which is unreadable
// afterwards precisely when the salvage went wrong.

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
  // The cut is in UTF-16 code units. Backing off one unit when it would strand a
  // high surrogate keeps the retained text whole, so a character is never split
  // into a lone half that does not survive UTF-8 (B3-11).
  let cut = VIOLATION_VALUE_MAX_CHARS - 1;
  const kept = rendered.charCodeAt(cut - 1);
  if (kept >= 0xd800 && kept <= 0xdbff) cut -= 1;
  return `${rendered.slice(0, cut)}…`;
}

function tryParseObject(text: string): { ok: true; value: unknown } | { ok: false; why: string } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    // The reason is KEPT, not swallowed. A `not-json` violation used to carry
    // only a bounded head of the payload, so a 30 KB envelope broken at line 98
    // and a payload with a conversational preamble were indistinguishable in
    // the record — and both a driving session and a review session read the
    // real case as the cosmetic one and proposed a fix for the wrong defect.
    // The parser already knows which it is; this is only a matter of saying so.
    return { ok: false, why: error instanceof Error ? error.message : String(error) };
  }
}

/** Find only the first object's boundary; JSON.parse still decides whether it is valid JSON. */
function firstObjectEnd(text: string, first: number): number | null {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = first; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return null;
}

/** Return the opening brace paired with a closing brace, ignoring braces inside JSON strings. */
function openingBraceFor(text: string, closing: number): number | null {
  let depth = 0;
  let quoted = false;
  for (let index = closing; index >= 0; index -= 1) {
    const char = text[index];
    if (char === '"') {
      let backslashes = 0;
      for (let previous = index - 1; previous >= 0 && text[previous] === "\\"; previous -= 1) {
        backslashes += 1;
      }
      if (backslashes % 2 === 0) quoted = !quoted;
    } else if (!quoted && char === "}") depth += 1;
    else if (!quoted && char === "{") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return null;
}

/** Recovers the single JSON object from a model's final message, recording how much digging it took. */
function extract(raw: string): { extraction: EnvelopeExtraction; value: unknown } | { why: string | null } {
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
  let sliceFailure: string | null = null;
  if (first !== -1 && last > first) {
    const parsed = tryParseObject(trimmed.slice(first, last + 1));
    if (parsed.ok) return { extraction: "outermost-object", value: parsed.value };
    // Keep the parse position if all salvage fails. A brace in trailing prose
    // can widen this slice beyond a well-formed object, so failure here alone
    // does not establish that the object itself is broken.
    sliceFailure = parsed.why;

    // Some provider streams retain an abandoned partial object immediately
    // before the corrected final object. A valid JSON suffix ending at `last`
    // must begin at the opening brace paired with that close, so one
    // string-aware scan is sufficient; repeatedly parsing every earlier brace
    // only re-parsed longer prefixes of the same malformed suffix.
    const opening = openingBraceFor(trimmed, last);
    if (opening !== null && opening > first) {
      const suffix = tryParseObject(trimmed.slice(opening, last + 1));
      if (suffix.ok) return { extraction: "trailing-object", value: suffix.value };
    }

    // The suffix scan cannot recover the first object when prose after it
    // contains braces. Locate its own closing brace in one string-aware pass
    // (bounded by the raw byte cap), then let JSON.parse validate the slice.
    // Do this AFTER suffix salvage: a genuine trailing JSON object keeps its
    // existing precedence, even if it subsequently fails envelope validation.
    const end = firstObjectEnd(trimmed, first);
    if (end !== null && end < last) {
      const prefix = tryParseObject(trimmed.slice(first, end + 1));
      if (prefix.ok) return { extraction: "outermost-object", value: prefix.value };
    }
  }

  return { why: sliceFailure };
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
  if (!("extraction" in extracted)) {
    // Naming WHERE it broke is what separates a broken object from a payload
    // that is merely wrapped in prose — prose around a well-formed object is
    // recovered, so a failure here is the object's own. Without this the two
    // read identically in the record and get the same wrong diagnosis.
    const why = extracted.why === null ? "" : `; the outermost object did not parse: ${extracted.why}`;
    return {
      valid: false,
      extraction: null,
      violations: [
        {
          kind: "not-json",
          path: "",
          message: `final message is not a single JSON object, with or without fences${why}`,
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
  // Cross-field rules the structural schema cannot state (B3-32).
  if (schemaId === PUBLISH_OUTPUT_SCHEMA_ID) {
    const refusal = publishedRecoveryRefusal(extracted.value);
    if (refusal !== null) {
      return {
        valid: false,
        extraction: extracted.extraction,
        violations: [{ kind: "schema-mismatch", path: "/result/status/recovery", message: refusal, received: null }],
      };
    }
  }

  return { valid: true, extraction: extracted.extraction, payload: extracted.value as unknown as EnvelopeBase };
}
