/**
 * marimba guard, pi port. The same two fences as `delegation-guard.sh`, bound
 * to pi's tool surface instead of a `PreToolUse` shell hook.
 *
 * This file is the BINDING only. Both fences live in `marimba-guard-rules.mts`,
 * which imports nothing and which the suite asserts still agrees with the shell
 * guard's own `for` loops. Read that file for what is denied and why; read this
 * one for how pi is wired to it.
 *
 * IT IS NOT A SANDBOX. It does not confine what the session reads, writes or
 * runs, it does not protect its own files, and a session that decides to route
 * around it can.
 *
 * ---------------------------------------------------------------------------
 * WHERE THIS PORT DIFFERS FROM THE SHELL GUARD. Stated rather than smoothed
 * over, because a boundary that reads as identical and behaves differently is
 * worse than two boundaries that admit it.
 * ---------------------------------------------------------------------------
 *
 *   NO EXTERNAL INTERPRETER, SO NEITHER PARSER FAILURE EXISTS. The shell guard
 *   shells out to python3 and splits its two failures on purpose: a payload it
 *   cannot parse fails OPEN, an interpreter that cannot run fails CLOSED. This
 *   runs in pi's own process against a typed event, so there is no payload to
 *   reject and no interpreter to be missing. The suite marks those three rows
 *   `bashOnly` rather than letting them vanish from one harness in silence.
 *
 *   THE FAILURE THAT REPLACES THEM IS NON-LOADING, and it is worse. An
 *   extension that is not loaded denies nothing and says nothing, which is
 *   exactly the silently-absent guard the shell version's closed-fail branch
 *   exists to prevent. `session_start` therefore announces the guard by name:
 *   a marimba session whose banner does not name it is not guarded, whatever
 *   the alias said. That is a weaker signal than failing closed, and it is the
 *   honest cost of this port.
 *
 *   FENCE 2 OVER-DENIES, identically. `grep -rn "awsf land" docs/` is refused.
 *   Accepted for the same reason as in the shell guard: telling a mention from
 *   an invocation means parsing shell, and a guard that parses shell stops
 *   being reviewable.
 *
 *   IT DOES NOT PROTECT ITS OWN FILE. A write aimed here is not denied. Said
 *   out loud rather than fenced, because a fence on the file tools would leave
 *   the shell route open while reading as though it had closed both.
 *
 * The repository holds the only copy: load it by absolute path with `pi -e`, so
 * the file that is reviewed and the file that executes are the same bytes.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import {
  DELEGATION_STEMS,
  OWNER_ACTS,
  delegationViolation,
  ownerActViolation,
} from "./marimba-guard-rules.mts";

function ownerActReason(verb: string): string {
  return [
    `Denied: \`awsf ${verb}\` is an owner act and is denied in a driving session.`,
    "",
    "Prepare it and explain it: the handle, what the evidence supports, and what",
    "remains. The owner runs it themselves. The TTY prompt is a terminal-shape",
    "check, not an authorization boundary, so this fence is the one that holds.",
  ].join("\n");
}

function delegationReason(toolName: string): string {
  return [
    `Denied: ${toolName} is delegation-shaped and is denied in a driving session.`,
    "",
    "Work started this way has no attempt directory, no journal record, no",
    "reserved call and no gate, so every AWSF guard counts zero. Use the awsf",
    "CLI instead.",
  ].join("\n");
}

export default function (pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    const announcement =
      `marimba guard active — ${String(OWNER_ACTS.length)} owner acts and ` +
      `${String(DELEGATION_STEMS.length)} delegation stems denied at the tool surface. ` +
      "It is a denial, not a sandbox.";
    // Startup notifications can be hidden by another extension's notification.
    // A dedicated widget keeps the guard visible without relying on timing or
    // a custom footer displaying extension statuses. Each surface is optional
    // and independent; tool_call below enforces the fences even without a UI.
    try {
      ctx.ui.setWidget("marimba-guard", [announcement]);
    } catch { /* Some harnesses have no widget surface. */ }
    try {
      ctx.ui.setStatus("marimba-guard", "active");
    } catch { /* A custom footer may not support extension statuses. */ }
    try {
      ctx.ui.notify(announcement);
    } catch { /* The widget remains visible when notifications are unavailable. */ }
  });

  pi.on("tool_call", async (event, _ctx) => {
    // Fence 2 first: an owner act reached through the shell is the more
    // consequential of the two, and a shell tool is never delegation-shaped, so
    // the order costs nothing. Same order as the shell guard.
    if (isToolCallEventType("bash", event)) {
      const verb = ownerActViolation(event.input.command);
      if (verb !== null) return { block: true, reason: ownerActReason(verb) };
    }
    if (delegationViolation(event.toolName)) {
      return { block: true, reason: delegationReason(event.toolName) };
    }
    return { block: false };
  });
}
