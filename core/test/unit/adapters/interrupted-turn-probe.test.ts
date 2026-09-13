import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { capture, CutObserver, diagnose, privateFile, type ProbeFacts } from "../../live/support/continuation-probe.ts";

const facts: ProbeFacts = {
  cutObserved: true, localTreeStopped: true, originalCompleted: false,
  originalModel: "test-model", expectedModel: "test-model", conversationReused: true,
  reopenCompleted: true, retainedBytesUnchanged: true, timedOut: false,
};
const base = { seq: 1, runId: "fixture", hostAt: "fixture-time", providerAt: null };

for (const [name, patch, reason] of [
  ["same conversation and completion", {}, "CONVERSATION_REUSE_IS_NOT_TURN_PROOF"],
  ["missed cut", { cutObserved: false }, "INTERRUPTION_NOT_ESTABLISHED"],
  ["already completed", { originalCompleted: true }, "INTERRUPTION_NOT_ESTABLISHED"],
  ["unknown survivors", { localTreeStopped: false }, "LOCAL_SURVIVORS_UNRESOLVED"],
  ["model mismatch", { originalModel: "different" }, "EXACT_MODEL_NOT_PROVED"],
  ["model absent", { originalModel: null }, "EXACT_MODEL_NOT_PROVED"],
  ["mutated bytes", { retainedBytesUnchanged: false }, "RETAINED_BYTES_CHANGED"],
  ["no completion", { reopenCompleted: false }, "NO_ORIGINAL_TURN_COMPLETION"],
  ["different conversation", { conversationReused: false }, "ORIGINAL_TURN_IDENTITY_UNPROVED"],
  ["watchdog", { timedOut: true }, "WATCHDOG_EXPIRED"],
] as const) {
  test(`diagnostic cannot enable rescue: ${name}`, () => {
    const result = diagnose({ ...facts, ...patch });
    assert.equal(result.reason, reason);
    assert.equal(result.productionEligible, false);
    assert.equal(result.providerLiability, "unknown-retained");
    assert.ok(result.classification === "failed" || result.classification === "not-exercised");
  });
}

test("worker cut requires one observed successful Write, never a request or failed tool", () => {
  const observer = new CutObserver("worker");
  assert.equal(observer.observe({ ...base, kind: "tool.requested", toolCallId: "t1", name: "Write", inputSummary: "fixture" }), false);
  const completed = { ...base, kind: "tool.completed" as const, toolCallId: "t1", outcome: "ok" as const, durationMs: 1, resultSnippet: "fixture" };
  assert.equal(observer.observe({ ...completed, outcome: "error" }), false);
  assert.equal(observer.observe({ ...completed, toolCallId: "t2" }), false);
  assert.equal(observer.observe(completed), true);
  assert.equal(observer.observe(completed), false);
});

test("review cut requires a completed read before nonempty streamed text", () => {
  const observer = new CutObserver("review");
  assert.equal(observer.observe({ ...base, kind: "text.delta", text: "pre-tool commentary" }), false);
  observer.observe({ ...base, kind: "tool.requested", toolCallId: "t1", name: "Read", inputSummary: "fixture" });
  observer.observe({ ...base, kind: "tool.completed", toolCallId: "t1", outcome: "ok", durationMs: 1, resultSnippet: "fixture" });
  assert.equal(observer.observe({ ...base, kind: "text.delta", text: " " }), false);
  assert.equal(observer.observe({ ...base, kind: "text.delta", text: "review text" }), true);
  assert.equal(observer.observe({ ...base, kind: "text.delta", text: "later" }), false);
  observer.observe({ ...base, kind: "run.completed", exitCode: 0 });
  assert.equal(observer.completed, true);
});

test("private snapshots are exact, private, and cannot overwrite retained evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-probe-unit-"));
  const path = join(root, "snapshot");
  privateFile(path, "original\n");
  assert.equal(readFileSync(path, "utf8"), "original\n");
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.throws(() => privateFile(path, "replacement"), { code: "EEXIST" });
  assert.equal(readFileSync(path, "utf8"), "original\n");
});

test("raw capture preserves chunked UTF-8 bytes before yielding", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-probe-unit-"));
  const path = join(root, "stdout");
  const bytes = Buffer.from("stream: ñ\n");
  async function* chunks() { yield bytes.subarray(0, 9); yield bytes.subarray(9); }
  const seen: Uint8Array[] = [];
  for await (const chunk of capture(chunks(), path)) {
    seen.push(chunk);
    assert.deepEqual(readFileSync(path), Buffer.concat(seen));
  }
  assert.deepEqual(readFileSync(path), bytes);
});

test("raw output ceiling refuses rather than silently truncating a proof", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-probe-unit-"));
  async function* chunks() { yield Buffer.from("too long"); }
  await assert.rejects(async () => {
    for await (const _chunk of capture(chunks(), join(root, "stdout"), 2)) { /* drain */ }
  }, /PROBE_OUTPUT_LIMIT/);
});
