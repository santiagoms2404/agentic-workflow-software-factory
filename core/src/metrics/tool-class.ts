// Tool names differ by harness: pi spells them `read`, `grep`, `bash`; Claude
// Code spells them `Read`, `Grep`, `Bash`, `Glob`. Every cross-harness
// comparison folds them into five classes first, so one route's `Grep` and
// another's `grep` count as the same kind of work.

export const TOOL_CLASSES = ["read", "search", "edit", "exec", "other"] as const;
export type ToolClass = (typeof TOOL_CLASSES)[number];

/** Keyed by lower-cased name. A name not listed here is `other`, never a guess at the nearest class. */
export const TOOL_CLASS_BY_NAME: Readonly<Record<string, ToolClass>> = Object.freeze({
  read: "read",
  grep: "search",
  glob: "search",
  find: "search",
  ls: "search",
  edit: "edit",
  write: "edit",
  bash: "exec",
});

export function toolClass(name: string): ToolClass {
  const key = name.toLowerCase();
  return Object.hasOwn(TOOL_CLASS_BY_NAME, key) ? TOOL_CLASS_BY_NAME[key]! : "other";
}
