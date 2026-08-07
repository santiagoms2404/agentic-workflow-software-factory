// What the host is willing to record as the model that answered.
//
// The rule is one sentence — "a model the harness cannot represent does not
// silently resolve" — and it is the whole of `E_MODEL_UNRESOLVED`. It lives in
// its own file because every adapter needs it and none of them should get to
// have its own opinion about it: the Claude adapter reads an identity out of an
// init event, the pi/codex adapter reads one out of a different envelope, and
// both have to fail closed on the same inputs or the UI ends up rendering one
// provider's guess as another provider's fact.
//
// The shape is deliberately narrow. A provider that prints a sentence where an
// identifier belonged has not named a model, and storing the sentence would put
// a confirmed-looking value on a screen that nobody confirmed.

export interface ModelIdentity {
  adapter: string;
  provider: string;
  requestedModel: string;
  resolvedModel: string;
}

/**
 * Leading alphanumeric, then the punctuation real model names actually use:
 * `claude-opus-5`, `gpt-5.6-sol`, `stub-model-1`, `openai/gpt-4.1`. No spaces,
 * no control characters, and a ceiling of 128 characters.
 */
export const REPRESENTABLE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,127}$/;

/**
 * Whether both halves of an identity — who answered, and as what — are
 * representable.
 *
 * Both, not either: a resolved model with no provider is as unusable for
 * reconstruction as a provider with no model, and accepting one of them would
 * put a half-identity in the journal that nothing downstream could complete.
 */
export function isRepresentableIdentity(identity: Pick<ModelIdentity, "provider" | "resolvedModel">): boolean {
  return REPRESENTABLE_IDENTITY.test(identity.provider) && REPRESENTABLE_IDENTITY.test(identity.resolvedModel);
}
