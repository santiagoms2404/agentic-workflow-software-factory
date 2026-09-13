import { createHash } from "node:crypto";
import { closeSync, fsyncSync, openSync, writeSync } from "node:fs";
import type { NormalizedEvent } from "../../../src/contracts/normalized-events.ts";

export type ProbeRole = "worker" | "review";

/** Diagnostic observations, never an authorization or provider-quiescence proof. */
export interface ProbeFacts {
  cutObserved: boolean;
  localTreeStopped: boolean;
  originalCompleted: boolean;
  originalModel: string | null;
  expectedModel: string;
  conversationReused: boolean;
  reopenCompleted: boolean;
  retainedBytesUnchanged: boolean;
  timedOut: boolean;
}

export function diagnose(facts: ProbeFacts): {
  classification: "failed" | "not-exercised";
  reason: string;
  productionEligible: false;
  providerLiability: "unknown-retained";
} {
  let reason: string;
  let classification: "failed" | "not-exercised" = "not-exercised";
  if (facts.timedOut) reason = "WATCHDOG_EXPIRED";
  else if (!facts.cutObserved || facts.originalCompleted) reason = "INTERRUPTION_NOT_ESTABLISHED";
  else if (!facts.localTreeStopped) reason = "LOCAL_SURVIVORS_UNRESOLVED";
  else if (facts.originalModel !== facts.expectedModel) {
    reason = "EXACT_MODEL_NOT_PROVED";
    classification = "failed";
  } else if (!facts.retainedBytesUnchanged) {
    reason = "RETAINED_BYTES_CHANGED";
    classification = "failed";
  } else if (!facts.reopenCompleted) reason = "NO_ORIGINAL_TURN_COMPLETION";
  else reason = facts.conversationReused
    ? "CONVERSATION_REUSE_IS_NOT_TURN_PROOF"
    : "ORIGINAL_TURN_IDENTITY_UNPROVED";
  // These CLIs' conversation APIs supply no authoritative turn/cursor/tool
  // checkpoint or reconnect accounting. Even a successful reopen cannot pass.
  return { classification, reason, productionEligible: false, providerLiability: "unknown-retained" };
}

export class CutObserver {
  readonly role: ProbeRole;
  readonly tools = new Map<string, string>();
  cutObserved = false;
  completed = false;
  readCompleted = false;

  constructor(role: ProbeRole) { this.role = role; }

  observe(event: NormalizedEvent): boolean {
    if (event.kind === "run.completed") this.completed = true;
    if (event.kind === "tool.requested") this.tools.set(event.toolCallId, event.name.toLowerCase());
    if (event.kind === "tool.completed" && event.outcome === "ok" && this.tools.get(event.toolCallId) === "read") this.readCompleted = true;
    const cut = this.role === "worker"
      ? event.kind === "tool.completed" && event.outcome === "ok" && this.tools.get(event.toolCallId) === "write"
      : this.readCompleted && event.kind === "text.delta" && event.text.trim().length > 0;
    if (this.cutObserved || !cut) return false;
    this.cutObserved = true;
    return true;
  }
}

export function digest(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeAll(fd: number, bytes: Uint8Array): void {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = writeSync(fd, bytes, offset, bytes.byteLength - offset);
    if (written === 0) throw new Error("PROBE_SHORT_WRITE");
    offset += written;
  }
}

/** Private exact bytes, exclusive creation, synced before returning a reference. */
export function privateFile(path: string, bytes: string | Uint8Array): string {
  const fd = openSync(path, "wx", 0o600);
  try { writeAll(fd, typeof bytes === "string" ? Buffer.from(bytes) : bytes); fsyncSync(fd); }
  finally { closeSync(fd); }
  return digest(bytes);
}

/** Raw capture retains bytes before the production decoder consumes them. */
export async function* capture(
  source: AsyncIterable<Uint8Array>, path: string, limit = 8 * 1024 * 1024,
): AsyncIterable<Uint8Array> {
  const fd = openSync(path, "wx", 0o600);
  let count = 0;
  try {
    for await (const chunk of source) {
      count += chunk.byteLength;
      if (count > limit) throw new Error("PROBE_OUTPUT_LIMIT");
      writeAll(fd, chunk);
      fsyncSync(fd);
      yield chunk;
    }
  } finally { closeSync(fd); }
}
