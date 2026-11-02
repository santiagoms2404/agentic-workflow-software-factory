// Regression test for B2-08:
// The resume-time quota probe passes an empty journalFailure, so an unavailable probe
// is never journalled, although probe.ts makes journalling mandatory for every unavailable result.

import assert from "node:assert/strict";
import { test } from "node:test";
import { probeQuota, type QuotaProbeFailure, DEFAULT_QUOTA_PROBE_TIMEOUTS } from "../../../src/quota/probe.ts";

test("B2-08: probeQuota notifies journalFailure when probe fails or is unavailable", async () => {
  let capturedFailure: QuotaProbeFailure | null = null;
  const failureBytes: string[] = [];

  const probe = await probeQuota({
    runCommand: () => ({ status: 1, stdout: "", stderr: "network timeout", error: null }),
    resolveExecutable: () => "/path/to/quota-axi",
    routes: [
      {
        adapterId: "claude-code",
        provider: "anthropic",
        routeId: "claude",
        disposition: "measurable",
        providers: ["anthropic"],
        reason: null,
      },
    ],
    purpose: "phase-boundary",
    now: "2026-10-21T12:00:00Z",
    timeouts: DEFAULT_QUOTA_PROBE_TIMEOUTS,
    options: { cwd: "/tmp", env: {}, maxBuffer: 1024 * 1024 },
    journalFailure: (failure) => {
      capturedFailure = failure;
    },
    retainFailureBytes: async (content) => {
      failureBytes.push(content);
      return "/tmp/retained-failure.txt";
    },
  });

  assert.equal(probe.availability, "unavailable");
  assert.ok(capturedFailure !== null);
  assert.equal(capturedFailure.reasonCode, "nonzero-exit");
  assert.equal(failureBytes.length, 1);
});
