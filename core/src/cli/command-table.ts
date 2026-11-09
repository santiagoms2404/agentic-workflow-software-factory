/** The complete owner-facing command table used by the CLI and documentation fences. */
export const CLI_COMMANDS = Object.freeze([
  "init", "project", "new", "seed", "preflight", "confirm", "start", "run", "resume", "next", "status", "watch", "rework", "review", "raise", "grant", "degrade-review", "attribute", "prove", "journey", "preview", "land", "close", "publish", "cancel", "retry",
  "relate", "doctor", "traps", "gc", "dash", "routes", "metrics", "metrics export", "db rebuild", "ticket", "backlog", "quota", "stage", "workflows", "shift plan", "group",
]);

/** Flags that take no value; documentation reconciles against this too. */
export const CLI_BOOLEAN_FLAGS: ReadonlySet<string> = new Set(["evidence", "json", "advise"]);
