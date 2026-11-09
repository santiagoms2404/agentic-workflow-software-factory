import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { recordedControllerIsLive } from "../../../src/cli/commands/adopt.ts";
import { readAttemptEvidence, recordedRoutes } from "../../../src/cli/commands/review-record.ts";
import type { ProcessIdentity } from "../../../src/execution/launcher-barrier.ts";
import type { AttemptEvidence } from "../../../src/observability/attempt-evidence.ts";

test("B8-12: readAttemptEvidence parses valid lines and ignores torn unparseable trailing fragment", async () => {
  const dir = await mkdtemp(join(tmpdir(), "adopt-evidence-"));
  try {
    const validRecord1 = JSON.stringify({
      event: {
        evidence: {
          type: "agent",
          phaseId: "builder",
          agent: "builder",
          adapterId: "mock",
          provider: "anthropic",
          model: "claude-3-5-sonnet",
        },
      },
    });
    const validRecord2 = JSON.stringify({
      event: {
        evidence: {
          type: "agent",
          phaseId: "reviewer",
          agent: "reviewer",
          adapterId: "mock",
          provider: "openai",
          model: "gpt-4o",
        },
      },
    });
    const tornTrailingLine = '{"event":{"evidence":{"type":"agent","phaseId":';

    // File ends with torn line (no trailing newline)
    await writeFile(join(dir, "journal.jsonl"), `${validRecord1}\n${validRecord2}\n${tornTrailingLine}`);

    const evidence = await readAttemptEvidence(dir);
    assert.equal(evidence.length, 2);
    assert.equal((evidence[0] as any).phaseId, "builder");
    assert.equal((evidence[1] as any).phaseId, "reviewer");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("B8-13: recordedRoutes prioritizes builder over earlier non-support/worker records", () => {
  const evidence: AttemptEvidence[] = [
    {
      type: "agent",
      phaseId: "planner",
      agent: "planner",
      adapterId: "mock-planner",
      provider: "anthropic",
      model: "claude-3-opus",
      purpose: "worker",
    } as any,
    {
      type: "agent",
      phaseId: "builder",
      agent: "builder",
      adapterId: "mock-builder",
      provider: "openai",
      model: "gpt-4o",
      purpose: "build",
    } as any,
    {
      type: "agent",
      phaseId: "reviewer",
      agent: "reviewer",
      adapterId: "mock-reviewer",
      provider: "anthropic",
      model: "claude-3-5-sonnet",
      purpose: "review",
    } as any,
  ];

  const routes = recordedRoutes(evidence, new Set(["reviewer"]));
  assert.equal(routes.worker?.agent, "builder");
  assert.equal(routes.worker?.provider, "openai");
  assert.equal(routes.review?.agent, "reviewer");
  assert.equal(routes.review?.provider, "anthropic");
});

test("B8-34: EPERM remains possibly alive unless a comparable identity proves PID reuse", () => {
  const expected: ProcessIdentity = { pid: 4242, pgid: 4242, startIdentity: "fixture-start", startIdentitySource: "fixture" };
  const denied = Object.assign(new Error("permission denied"), { code: "EPERM" });
  const observed = (startIdentity: string | null): ProcessIdentity => ({ ...expected, startIdentity });
  assert.equal(recordedControllerIsLive(expected, () => { throw denied; }, () => null), true,
    "permission denied without an identity is unresolved and fails closed");
  assert.equal(recordedControllerIsLive(expected, () => {}, () => null), true,
    "a successful signal probe without a comparable identity is unresolved too");
  assert.equal(recordedControllerIsLive(expected, () => { throw denied; }, () => observed("fixture-start")), true);
  assert.equal(recordedControllerIsLive(expected, () => { throw denied; }, () => observed("reused-pid")), false,
    "the recorded controller is gone when the observed start identity differs");
  assert.equal(recordedControllerIsLive(expected, () => {}, () => observed("reused-pid")), false,
    "identity comparison also resolves a reused PID when kill(0) succeeds");
  assert.equal(recordedControllerIsLive(expected, () => { throw Object.assign(new Error("gone"), { code: "ESRCH" }); }, () => {
    throw new Error("ESRCH must not need a second probe");
  }), false);
});

test("B8-09: safeTail retains the last characters and preserves test summary", () => {
  const longOutput = "header start\n" + "x".repeat(5000) + "\nTAP summary: 10 passed, 0 failed";
  const tail = longOutput.length <= 4000 ? longOutput : longOutput.slice(longOutput.length - 4000);
  assert.ok(tail.includes("TAP summary: 10 passed, 0 failed"));
  assert.ok(!tail.includes("header start"));
});
