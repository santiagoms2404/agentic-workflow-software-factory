/**
 * marimba's two fences as pure rules, with no harness in them.
 *
 * `delegation-guard.sh` enforces these for a `PreToolUse` shell hook and
 * `marimba-guard.pi.ts` enforces them for a pi extension. Both are the same
 * boundary or marimba means two different things depending on how it was
 * launched, so the lists live here once and the suite asserts the shell script's
 * own `for` loops still name exactly these.
 *
 * This file imports nothing. That is deliberate twice over: the meta-test can
 * load it without pulling a harness SDK into this repository's dependency
 * graph, and a reviewer can read the whole boundary without reading a runtime.
 */

/**
 * The acts the lifecycle reserves for the owner.
 *
 * Not a policy preference. `processOwnerTerminal()` checks
 * `process.stdin.isTTY`, which is a terminal-SHAPE check, and a same-user agent
 * with shell access can allocate a PTY and answer the confirmation. This list is
 * what makes the boundary real while a driving session runs with prompts off.
 */
export const OWNER_ACTS = ["land", "cancel", "rework", "review", "journey", "raise", "publish"] as const;

/**
 * Whole-name exclusions, never substrings.
 *
 * Observe-or-stop: denying these could strand work already running with no way
 * to inspect or end it. Plan-only: a harness's session-local todo list has no
 * executor, so it is a false positive of the `task` stem rather than policy.
 * `listagents` enumerates and creates nothing, so it belongs here too.
 */
export const ALLOWED_WHOLE_NAMES = [
  "taskoutput", "taskstop", "taskget", "tasklist", "listagents",
  "cronlist", "bashoutput", "killshell", "taskcreate", "taskupdate",
] as const;

/**
 * Delegation stems. A tool whose name contains one starts work the factory has
 * no attempt directory, journal record, reserved call or gate for.
 *
 * Classification is by SHAPE rather than against a fixed list of tool names, so
 * a delegation tool that did not exist when this was written is denied on
 * arrival. That property is also what lets one list serve two harnesses whose
 * tool inventories differ.
 */
export const DELEGATION_STEMS = [
  "agent", "subagent", "task", "workflow", "cron", "schedul", "worktree",
  "delegate", "spawn", "dispatch", "handoff", "remote", "sendmessage", "monitor",
] as const;

/** Lowercase and strip to letters and digits, so a separator cannot hide a stem. */
export function normalizeToolName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

/**
 * Collapse runs of whitespace and pad, matching the shell guard's
 * `" ".join(c.split())` followed by its `case " $cmd " in` test.
 *
 * Whitespace is the ONLY shell transformation either fence undoes. A variable,
 * a line continuation, a quoted or split verb each write the act as text this
 * does not contain, and each passes. That is the design's ceiling, not a set of
 * holes to plug: closing the two easiest would leave the rest open while reading
 * as though the fence had started covering intent.
 */
export function normalizeCommand(command: string): string {
  return ` ${command.split(/\s+/u).filter(Boolean).join(" ")} `;
}

/** The owner act a shell command invokes, or null. Reads text, never intent. */
export function ownerActViolation(command: string): string | null {
  const normalized = normalizeCommand(command);
  return OWNER_ACTS.find((act) => normalized.includes(`awsf ${act}`)) ?? null;
}

/** Whether a tool name is delegation-shaped and must be refused. */
export function delegationViolation(toolName: string): boolean {
  // An MCP server chooses its own nouns, so fence 1 does not read them: a stem
  // inside a server's name is coincidence, not delegation.
  if (toolName.startsWith("mcp__")) return false;
  const normalized = normalizeToolName(toolName);
  if (normalized.length === 0) return false;
  if ((ALLOWED_WHOLE_NAMES as readonly string[]).includes(normalized)) return false;
  return DELEGATION_STEMS.some((stem) => normalized.includes(stem));
}
