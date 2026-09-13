// The pi port of marimba's guard, and the thing that stops two harnesses from
// becoming two boundaries.
//
// `marimba-guard.test.ts` drives the shell hook by spawning it with real
// payloads, which is the only way to test a shell script honestly. That cannot
// be done for a pi extension without running pi, so the fences were lifted into
// `marimba-guard-rules.mts` — a module that imports nothing — and this file does
// two things the spawn-based test cannot:
//
//   1. Asserts the SHELL script's own `for` loops still name exactly the rules
//      in that module. This is the anti-drift check. Editing one harness's list
//      without the other now fails here rather than at the tool surface of
//      whichever harness nobody happened to be driving.
//   2. Exercises the fences directly, including the rows the shell guard's
//      spawn test covers, so the pi binding is held to the same answers.
//
// What it deliberately does NOT do is re-implement either fence. A test that
// carried its own copy of the rules would pass while both harnesses drifted.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import { drivingDir } from "./_driving.ts";
import {
  ALLOWED_WHOLE_NAMES,
  DELEGATION_STEMS,
  OWNER_ACTS,
  TIMEOUT_GUARDED_LIFECYCLE_COMMANDS,
  delegationViolation,
  lifecycleTimeoutViolation,
  normalizeCommand,
  ownerActViolation,
} from "../../../../docs/driving/marimba/marimba-guard-rules.mts";

const MARIMBA_DIR = join(drivingDir(), "marimba");
const SHELL_GUARD = readFileSync(join(MARIMBA_DIR, "delegation-guard.sh"), "utf8");
const PI_GUARD = readFileSync(join(MARIMBA_DIR, "marimba-guard.pi.ts"), "utf8");

/** The words of one `for NAME in a b c; do` list in the shell guard. */
function shellList(variable: string): readonly string[] {
  const match = new RegExp(`for ${variable} in ([^;]+); do`, "u").exec(SHELL_GUARD);
  assert.ok(match, `delegation-guard.sh has no \`for ${variable} in ...\` list`);
  return (match[1] ?? "").trim().split(/\s+/u);
}

// Exercise the actual binding without making the optional installed Pi SDK a
// repository dependency. Only its tool-name type predicate is substituted. The
// policy functions below are the same shared functions used in production.
type Handler = (event: Record<string, unknown>, context: { ui: Record<string, unknown> }) => Promise<{ block: boolean; reason?: string } | void>;
function bindingHandlers(environment: Readonly<Record<string, string>> = {}): Map<string, Handler> {
  const source = stripTypeScriptTypes(PI_GUARD)
    .replace(/import \{ isToolCallEventType \} from "@mariozechner\/pi-coding-agent";/u, "")
    .replace(/import\s*\{[^}]*\}\s*from "\.\/marimba-guard-rules\.mts";/u, "")
    .replace("export default function", "function registerGuard");
  const register = runInNewContext(`${source}\nregisterGuard`, {
    isToolCallEventType: (name: string, event: { toolName: string }) => event.toolName === name,
    OWNER_ACTS, DELEGATION_STEMS, ownerActViolation, delegationViolation,
    TIMEOUT_GUARDED_LIFECYCLE_COMMANDS, lifecycleTimeoutViolation,
    process: { env: environment },
  }) as (api: { on: (name: string, handler: Handler) => void }) => void;
  const handlers = new Map<string, Handler>();
  register({ on: (name, handler) => handlers.set(name, handler) });
  return handlers;
}

for (const unavailable of ["none", "setStatus", "notify", "setWidget", "all"]) {
  test(`guard startup keeps independent display paths when ${unavailable} is unavailable`, async () => {
    const calls: { name: string; args: unknown[] }[] = [];
    const ui = Object.fromEntries(["setStatus", "notify", "setWidget"].map((name) => [name, (...args: unknown[]) => {
      if (unavailable === name || unavailable === "all") throw new Error("UI surface unavailable");
      calls.push({ name, args });
    }]));
    const handlers = bindingHandlers();
    await handlers.get("session_start")!({}, { ui });
    if (unavailable !== "all") {
      for (const name of ["setStatus", "notify", "setWidget"].filter((value) => value !== unavailable)) {
        assert.ok(calls.some((call) => call.name === name), `${name} must not depend on another display path`);
      }
      const widget = calls.find((call) => call.name === "setWidget");
      if (widget) {
        assert.equal(widget.args[0], "marimba-guard");
        assert.match((widget.args[1] as string[])[0]!, /marimba guard active/u);
      }
    }
    const denied = await handlers.get("tool_call")!({ toolName: "bash", input: { command: "awsf land example" } }, { ui });
    assert.equal(denied?.block, true, "display failures must not disable the owner-act fence");
  });
}

test("Pi lifecycle timeout floor covers metadata, npm, whitespace, and wrappers", () => {
  assert.deepEqual([...TIMEOUT_GUARDED_LIFECYCLE_COMMANDS], ["run", "rework", "review", "resume"]);
  assert.equal(lifecycleTimeoutViolation("awsf resume T01", 1), "resume");
  assert.equal(lifecycleTimeoutViolation("npm run awsf --silent -- resume T01", 1), "resume");
  assert.equal(lifecycleTimeoutViolation("timeout 60s awsf resume T01", undefined), "resume");
  assert.equal(lifecycleTimeoutViolation("awsf run T01", 1), "run");
  assert.equal(lifecycleTimeoutViolation("npm run awsf --silent -- run T01", 1), "run");
  assert.equal(lifecycleTimeoutViolation("  awsf   rework T01", 1), "rework");
  assert.equal(lifecycleTimeoutViolation("timeout 60s awsf review T01", undefined), "review");
  assert.equal(lifecycleTimeoutViolation("awsf run T01", undefined), null);
});

test("quiet Pi startup keeps the named status and both fences", async () => {
  const calls: { name: string; args: unknown[] }[] = [];
  const ui = Object.fromEntries(["setStatus", "notify", "setWidget"].map((name) => [name, (...args: unknown[]) => {
    calls.push({ name, args });
  }]));
  const handlers = bindingHandlers({ PI_MARIMBA: "1" });
  await handlers.get("session_start")!({}, { ui });
  assert.deepEqual(calls.map((call) => call.name), ["setStatus"]);
  assert.deepEqual(calls[0]?.args, ["marimba-guard", "active"]);
  const denied = await handlers.get("tool_call")!({ toolName: "bash", input: { command: "awsf land T01" } }, { ui });
  assert.equal(denied?.block, true);
});

test("the actual guard binding denies delegation and admits read-only planning", async () => {
  const handler = bindingHandlers().get("tool_call")!;
  assert.equal((await handler({ toolName: "Workflow_Dispatch", input: {} }, { ui: {} }))?.block, true);
  assert.equal((await handler({ toolName: "bash", input: { command: "npm run awsf --silent -- group checklist" } }, { ui: {} }))?.block, false);
  assert.equal((await handler({ toolName: "bash", input: { command: "awsf run T01", timeout: 1 } }, { ui: {} }))?.block, true);
  assert.equal((await handler({ toolName: "bash", input: { command: "awsf run T01" } }, { ui: {} }))?.block, false);
});

// ---------------------------------------------------------------------------
// 1. The two harnesses carry one rule set.
// ---------------------------------------------------------------------------

test("the shell guard's owner acts are exactly the shared list, in the same order", () => {
  assert.deepEqual(shellList("verb"), [...OWNER_ACTS]);
});

test("the shell guard's delegation stems are exactly the shared list, in the same order", () => {
  assert.deepEqual(shellList("stem"), [...DELEGATION_STEMS]);
});

test("the shell guard's whole-name exclusions are exactly the shared list", () => {
  // Order is not load-bearing here — it is a membership test in both harnesses
  // — so this compares as sets and says so.
  assert.deepEqual([...shellList("allowed")].sort(), [...ALLOWED_WHOLE_NAMES].sort());
});

test("the pi binding delegates to the shared rules rather than restating them", () => {
  // The failure this prevents: someone pastes the lists into the extension to
  // drop a relative import, and the anti-drift tests above go on passing while
  // the extension enforces something else entirely.
  assert.match(PI_GUARD, /from "\.\/marimba-guard-rules\.mts"/u);
  for (const stem of DELEGATION_STEMS) {
    assert.doesNotMatch(PI_GUARD, new RegExp(`"${stem}"`, "u"), `${stem} is restated in the pi binding`);
  }
  for (const act of OWNER_ACTS) {
    assert.doesNotMatch(PI_GUARD, new RegExp(`"${act}"`, "u"), `${act} is restated in the pi binding`);
  }
});

// ---------------------------------------------------------------------------
// 2. The fences themselves. The rows mirror the spawn test's table; the three
//    it carries that this cannot are named rather than dropped.
// ---------------------------------------------------------------------------

test("fence 2 denies every owner act, through a wrapper, padded, or under a PTY", () => {
  for (const act of OWNER_ACTS) {
    assert.equal(ownerActViolation(`awsf ${act} T01`), act, act);
  }
  assert.equal(ownerActViolation("just awsf rework T01"), "rework", "a task runner in front does not hide it");
  assert.equal(ownerActViolation("awsf   land   T01"), "land", "whitespace is normalised before matching");
  assert.equal(ownerActViolation('script -qec "awsf land T01"'), "land", "the PTY bypass this fence exists for");
});

test("fence 2 is a targeted refusal, not a blanket one", () => {
  for (const command of ["echo hello", "awsf status", "awsf run T01", "awsf retry T01"]) {
    assert.equal(ownerActViolation(command), null, command);
  }
});

test("fence 2's known evasion and known over-denial are both pinned", () => {
  // THE KNOWN EVASION. The fence reads written text, not resolved intent. If
  // this turns red someone widened the match: read that decision rather than
  // deleting this row.
  assert.equal(ownerActViolation('v=land; script -qec "awsf $v T01"'), null);
  // THE ACCEPTED OVER-DENIAL. Separating a mention from an invocation means
  // parsing shell, and a guard that parses shell stops being reviewable.
  assert.equal(ownerActViolation('grep -rn "awsf land" docs/'), "land");
  assert.equal(ownerActViolation("echo awsf land > f.txt"), "land");
});

test("fence 1 denies by shape, including a name no harness ships yet", () => {
  for (const name of ["Task", "Agent", "SendMessage", "Monitor", "ScheduleWakeup", "EnterWorktree"]) {
    assert.equal(delegationViolation(name), true, name);
  }
  assert.equal(delegationViolation("Workflow_Dispatch"), true, "punctuation and case do not hide a stem");
  assert.equal(delegationViolation("PiSubagentSpawner"), true, "a pi-shaped name the shell guard never saw");
});

test("fence 1 admits the observe-or-stop names, and reads no MCP server's nouns", () => {
  for (const name of ["TaskOutput", "TaskStop", "TaskGet", "TaskList", "ListAgents", "CronList", "TaskCreate", "TaskUpdate", "BashOutput", "KillShell"]) {
    assert.equal(delegationViolation(name), false, name);
  }
  assert.equal(delegationViolation("mcp__srv__task"), false, "a stem inside a server's name is coincidence");
  assert.equal(delegationViolation(""), false, "an empty name is not a delegation");
  for (const name of ["bash", "read", "write", "edit", "grep", "find", "ls"]) {
    assert.equal(delegationViolation(name), false, `pi's own ${name} tool must pass`);
  }
});

test("the three rows the shell guard owns alone are named, not silently absent", () => {
  // Each is about the shell guard's OWN mechanism, and each is why the pi port
  // has a different failure mode rather than the same one.
  const bashOnly = {
    "payload · malformed JSON": "pi delivers a typed event, so there is no payload for a parser to reject",
    "payload · empty": "the same fail-open shape, which only a stdin hook protocol has",
    "machine · the payload parser cannot run": "an external interpreter is the shell guard's own mechanism; this port parses nothing",
  };
  assert.equal(Object.keys(bashOnly).length, 3);
  for (const [row, why] of Object.entries(bashOnly)) {
    assert.ok(why.length > 0, row);
  }
  // The replacement failure mode is non-loading, so the binding must announce
  // itself. Without this the extension can be absent and silent.
  assert.match(PI_GUARD, /session_start/u);
  assert.match(PI_GUARD, /marimba guard active/u);
});

test("normalizeCommand collapses whitespace and pads, and the match stays a substring", () => {
  assert.equal(normalizeCommand("  awsf   land  T01 "), " awsf land T01 ");

  // THE THIRD FACE OF THE ACCEPTED OVER-DENIAL, pinned rather than fixed.
  // Padding makes the match whitespace-insensitive; it does NOT make it
  // word-bounded, so an act name embedded in a longer word is still denied.
  // The shell guard's `case " $cmd " in *"awsf land"*` has exactly this
  // behaviour, and matching it is the point: a port that quietly denied less
  // than the harness it claims parity with would be the worse defect.
  assert.equal(ownerActViolation("echo noawsf landing"), "land");
});
