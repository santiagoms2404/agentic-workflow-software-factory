import { test } from "node:test";
import assert from "node:assert/strict";
import {
  probeQuota,
  type QuotaProbeFailure,
  type RunQuotaCommand,
  type ResolveQuotaExecutable,
} from "../../../src/quota/probe.ts";

const NOW = "2026-10-21T20:00:00.000Z";
const ENV = { PATH: "/usr/bin" };

test("B2-15: probeQuota with empty routes returns unavailable without calling runCommand", async () => {
  let runCommandCalls = 0;
  const runCommand: RunQuotaCommand = () => {
    runCommandCalls += 1;
    throw new Error("runCommand should not be called when routes is empty");
  };

  let resolveExecutableCalls = 0;
  const resolveExecutable: ResolveQuotaExecutable = (name) => {
    resolveExecutableCalls += 1;
    return `/usr/bin/${name}`;
  };

  const journaled: QuotaProbeFailure[] = [];
  const result = await probeQuota({
    runCommand,
    resolveExecutable,
    routes: [],
    purpose: "phase-boundary",
    options: { env: ENV },
    now: NOW,
    journalFailure: (failure) => {
      journaled.push(failure);
    },
    retainFailureBytes: async () => {
      throw new Error("retainFailureBytes should not be called");
    },
  });

  assert.equal(runCommandCalls, 0, "runCommand must not be called when routes is empty");
  assert.equal(resolveExecutableCalls, 0, "resolveExecutable must not be called when routes is empty");
  assert.equal(result.availability, "unavailable");
  assert.equal(result.resolvedVersion, null);
  assert.deepEqual(result.failure, {
    reasonCode: "semantics-unresolved",
    providers: [null],
  });
  assert.deepEqual(journaled, [
    {
      reasonCode: "semantics-unresolved",
      providers: [null],
    },
  ]);
});

test("B2-15 triangulation: probeQuota with disabled or blank provider routes does not call runCommand", async () => {
  let runCommandCalls = 0;
  const runCommand: RunQuotaCommand = () => {
    runCommandCalls += 1;
    throw new Error("runCommand should not be called when no providers exist");
  };

  const journaled: QuotaProbeFailure[] = [];
  const result = await probeQuota({
    runCommand,
    resolveExecutable: (name) => `/usr/bin/${name}`,
    routes: [
      { provider: "", enabled: true },
      { provider: "claude", enabled: false },
    ],
    purpose: "interactive-preflight",
    options: { env: ENV },
    now: NOW,
    journalFailure: (failure) => {
      journaled.push(failure);
    },
    retainFailureBytes: async () => {
      throw new Error("retainFailureBytes should not be called");
    },
  });

  assert.equal(runCommandCalls, 0, "runCommand must not be called when no enabled providers exist");
  assert.equal(result.availability, "unavailable");
  assert.deepEqual(result.failure, {
    reasonCode: "semantics-unresolved",
    providers: [null],
  });
});
