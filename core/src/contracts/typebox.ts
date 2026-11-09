import { Type, type Static, type TLiteral, type TSchema, type TUnion } from "@sinclair/typebox";

// Shared TypeBox helpers for `core/src/contracts/`. The whole point of this
// directory is that a schema exists exactly ONCE and yields three emissions —
// the runtime validator, the static TypeScript type, and the JSON Schema
// injected into agent prompts. Anything here that would let those three drift
// apart is a defect.

/** Shared wire patterns for persisted object ids and digests. */
export const OBJECT_ID_PATTERN = "^[0-9a-f]{40}$";
export const SHA256_HEX_PATTERN = "^[0-9a-f]{64}$";
export const SHA256_DIGEST_PATTERN = "^sha256:[0-9a-f]{64}$";

/** A tuple of literal schemas mirroring a readonly string tuple, mutable so it satisfies `TSchema[]`. */
type LiteralsOf<T extends readonly string[]> = {
  -readonly [K in keyof T]: TLiteral<T[K] & string>;
};

/**
 * Turns an `as const` string tuple into a TypeBox union of literals.
 *
 * The tuple stays the single source: it is exported for runtime membership
 * checks, the schema validates against it, and `Static<>` of the schema is
 * the same union of string literals. `enum` is deliberately not used anywhere
 * in this codebase — it is not erasable and would break
 * `node --experimental-strip-types`.
 */
export function stringUnion<const T extends readonly string[]>(values: T): TUnion<LiteralsOf<T>> {
  return Type.Union(values.map((value) => Type.Literal(value))) as unknown as TUnion<LiteralsOf<T>>;
}

/** Convenience alias: the static type of a `stringUnion` over a given tuple. */
export type UnionOf<T extends readonly string[]> = Static<TUnion<LiteralsOf<T>>>;

/**
 * A metric a provider may simply not report.
 *
 * `null` means "the provider did not report it"; `0` means "the provider
 * reported zero" and is authoritative data. The two are never collapsed
 * (`fusion-harness/core/events.ts:24-33`). The field is required-and-nullable,
 * never optional — an absent key would reintroduce exactly the ambiguity this
 * type exists to remove.
 */
export const NullableCount = Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]);

/**
 * UTF-8 byte length, using the same encoder as the host's byte buffers.
 *
 * The envelope cap is stated in bytes, and a cap that silently measured
 * UTF-16 code units would let a multibyte payload sail past it. Buffer's
 * built-in implementation also handles lone surrogates exactly as UTF-8
 * encoding does elsewhere in the host.
 */
export function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/**
 * Strips TypeBox's symbol-keyed metadata and returns plain JSON Schema.
 *
 * TypeBox schemas *are* JSON Schema objects with extra symbol keys, so a
 * structured clone through JSON is a faithful, lossless emission of the same
 * definition — not a second, hand-maintained copy of it.
 *
 * Precedence: a `$id`, `title` or `description` the schema declares is the one
 * emitted. The options fill only the keys the schema leaves open, so an option
 * the schema contradicts never reaches the output (B3-20). `$schema` is always
 * the draft 2020-12 URI.
 */
export function toJsonSchema(
  schema: TSchema,
  options: { $id?: string; title?: string; description?: string } = {},
): Record<string, unknown> {
  const emitted = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  const head: Record<string, unknown> = { $schema: "https://json-schema.org/draft/2020-12/schema" };
  if (options.$id !== undefined) head["$id"] = options.$id;
  if (options.title !== undefined) head["title"] = options.title;
  if (options.description !== undefined) head["description"] = options.description;
  return { ...head, ...emitted };
}
