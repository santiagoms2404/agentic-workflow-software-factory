// A bounded, printable stand-in for a value the host did not write.
//
// Tool inputs and tool results are provider-shaped: a string, an object, a
// megabyte of file content, or something that throws when you serialize it.
// Every decoder needs the same answer to "what may the trace show of this?",
// and the answer is a rule rather than an opinion — so it lives here once
// instead of twice, the way `usage.ts` and `model-identity.ts` do for the two
// rules T12 extracted for the same reason.
//
// The ceiling is on the SNIPPET, not on the run: the output budget bounds what
// a run may emit in total, and this bounds what any single field may contribute
// to it. A provider that returns a whole file from `read` would otherwise put
// that file in the journal under the word "summary".

const SNIPPET_LIMIT = 400;

/** A bounded, printable stand-in for a tool input or result of any shape. */
export function summarize(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : safeJson(value);
  return boundText(text, SNIPPET_LIMIT);
}

/**
 * `text`, cut to at most `limit` code units and marked with an ellipsis when it
 * was cut.
 *
 * The cut never leaves half of a surrogate pair behind. A lone high surrogate
 * at the end is not well-formed text, and any UTF-8 encoding of it replaces the
 * half with U+FFFD, so the trace would show a corrupted character it never held
 * (B11-21).
 */
export function boundText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let cut = limit;
  const before = text.charCodeAt(cut - 1);
  if (before >= 0xd800 && before <= 0xdbff) cut -= 1;
  return `${text.slice(0, cut)}…`;
}

/** `JSON.stringify` that cannot throw — a cyclic result is still a result. */
export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "[unserializable]";
  }
}
