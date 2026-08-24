import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { type QuotaStopEntry } from "../../../src/config/schema.ts";
import {
  buildQuotaReadout,
  renderQuotaReadout,
} from "../../../src/quota/readout.ts";
import { probeQuota, type QuotaProbeResult } from "../../../src/quota/probe.ts";
import type { ProjectQuotaRoute } from "../../../src/quota/routes.ts";

const FIXTURE_ROOT = new URL("../../fixtures/quota-axi/", import.meta.url);
const SNAPSHOT = new URL("./readout.snapshot.txt", import.meta.url);
const NOW = "2026-08-24T20:26:39.429Z";
const CLAUDE_ROUTE: ProjectQuotaRoute = {
  adapterId: "claude-route",
  adapterKind: "claude-code",
  disposition: "measurable",
  providers: ["claude"],
  memberKinds: [],
  reason: null,
};
const THRESHOLD: QuotaStopEntry = { minutes: 2_400, probe_timeout_ms: 8_000 };

function fixture(name: string): string {
  return readFileSync(new URL(name, FIXTURE_ROOT), "utf8");
}

async function probeWith(
  probeOutput: string,
  versionOutput = "quota-axi 0.1.29\n",
  versionStatus = 0,
  probeStatus = 0,
): Promise<QuotaProbeResult> {
  const responses = [
    { status: versionStatus, stdout: versionOutput, stderr: "", error: null },
    { status: probeStatus, stdout: probeOutput, stderr: "", error: null },
  ];
  return probeQuota({
    resolveExecutable: () => "/test/bin/quota-axi",
    runCommand: () => {
      const response = responses.shift();
      assert.ok(response, "fake runCommand script was exhausted");
      return response;
    },
    routes: [{ provider: "claude" }],
    purpose: "interactive-preflight",
    options: { env: { PATH: "/test/bin" } },
    now: NOW,
    journalFailure: () => undefined,
    retainFailureBytes: async () => "raw/quota.txt",
  });
}

function rendered(result: QuotaProbeResult, route = CLAUDE_ROUTE): string {
  return renderQuotaReadout(buildQuotaReadout({
    routes: [route],
    probeResult: result,
    defaultThreshold: THRESHOLD,
  }))[0]!;
}

test("the disagreement fixture renders effective availability and matches the text snapshot", async () => {
  const output = rendered(await probeWith(fixture("derived-windows-disagree.json")));
  assert.match(output, /effective remaining=4%/);
  assert.doesNotMatch(output, /effective remaining=92%/);
  assert.equal(output, readFileSync(SNAPSHOT, "utf8").trimEnd());
});

test("a provider-named adapter id renders the provider derived from its own kind", async () => {
  const codexNamedClaude: ProjectQuotaRoute = {
    adapterId: "claude",
    adapterKind: "pi-codex",
    disposition: "measurable",
    providers: ["codex"],
    memberKinds: [],
    reason: null,
  };
  const output = rendered(await probeWith(fixture("nominal.json")), codexNamedClaude);
  assert.match(output, /^adapter=claude \| provider=codex \|/);
});

test("each unavailable reason code renders a distinct non-blank row", async () => {
  const results: readonly QuotaProbeResult[] = [
    await probeQuota({
      resolveExecutable: () => { throw new Error("missing"); },
      runCommand: () => { throw new Error("must not run"); },
      routes: [{ provider: "claude" }],
      purpose: "interactive-preflight",
      options: { env: { PATH: "/test/bin" } },
      now: NOW,
      journalFailure: () => undefined,
      retainFailureBytes: async () => "raw/quota.txt",
    }),
    await probeQuota({
      resolveExecutable: () => "/test/bin/quota-axi",
      runCommand: () => ({ status: null, stdout: "", stderr: "", error: "ETIMEDOUT" }),
      routes: [{ provider: "claude" }],
      purpose: "interactive-preflight",
      options: { env: { PATH: "/test/bin" } },
      now: NOW,
      journalFailure: () => undefined,
      retainFailureBytes: async () => "raw/quota.txt",
    }),
    await probeWith("", "quota-axi 0.1.29\n", 1),
    await probeWith("", "not a version\n"),
    await probeWith("", "quota-axi 0.1.28\n"),
    await probeWith(fixture("derived-semantics-partial.json")),
    await probeWith(fixture("derived-stale.json")),
  ];
  const rows = results.map((result) => rendered(result));
  const codes = results.map((result) => result.failure?.reasonCode);

  assert.deepEqual(codes, [
    "executable-not-found",
    "timeout",
    "nonzero-exit",
    "unparseable",
    "version-below-floor",
    "semantics-unresolved",
    "stale",
  ]);
  assert.equal(new Set(rows).size, 7);
  for (let index = 0; index < rows.length; index += 1) {
    assert.ok(rows[index]!.trim().length > 0);
    assert.match(rows[index]!, new RegExp(`reason=${codes[index]}`));
  }
});
