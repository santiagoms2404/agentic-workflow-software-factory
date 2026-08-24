import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  QUOTA_UNAVAILABLE_REASON_CODES,
  buildEnabledProviderCsv,
  buildQuotaAxiArgv,
  compareNumericVersions,
  isBelowQuotaStopThreshold,
  knownMinuteFigure,
  probeQuota,
  retainQuotaFailureInAttempt,
} from "../../../src/quota/probe.ts";

const PROBE_SOURCE = new URL("../../../src/quota/probe.ts", import.meta.url);
const CAPTURE_SOURCE = new URL("../../fixtures/quota-axi/capture-probe.ts", import.meta.url);
const NOMINAL_FIXTURE = new URL("../../fixtures/quota-axi/nominal.json", import.meta.url);
const STALE_FIXTURE = new URL("../../fixtures/quota-axi/derived-stale.json", import.meta.url);

const ARGV_CONSTRUCTION_SITES = [
  { name: "runtime probe", argv: (): readonly string[] => buildQuotaAxiArgv("claude,codex") },
  { name: "fixture capture", argv: (): readonly string[] => buildQuotaAxiArgv("claude,codex") },
] as const;

const BARRED_ARGV = ["--refresh", "--tui", "--once", "--full"] as const;

test("quota argv construction sites use only the default JSON provider selector", () => {
  for (const site of ARGV_CONSTRUCTION_SITES) {
    const argv = site.argv();
    assert.deepEqual(argv, ["--provider", "claude,codex", "--json"], site.name);
    for (const flag of BARRED_ARGV) assert.equal(argv.includes(flag), false, `${site.name}: ${flag}`);
  }

  for (const source of [PROBE_SOURCE, CAPTURE_SOURCE]) {
    const text = readFileSync(source, "utf8");
    for (const flag of BARRED_ARGV) assert.equal(text.includes(flag), false, `${source.pathname}: ${flag}`);
    assert.equal(text.includes("npx"), false, `${source.pathname}: npx`);
  }
});

test("the probe resolves quota-axi against its command environment and passes configured timeoutMs", async () => {
  const calls: Array<{ executable: string; argv: readonly string[]; options: unknown }> = [];
  const env = { PATH: "/project/bin" };
  const failures: unknown[] = [];
  const result = await probeQuota({
    resolveExecutable: (executable, resolvedEnv) => {
      assert.equal(executable, "quota-axi");
      assert.equal(resolvedEnv, env);
      return "/project/bin/quota-axi";
    },
    runCommand: (executable, argv, options) => {
      calls.push({ executable, argv, options });
      return argv[0] === "--version"
        ? { status: 0, stdout: "quota-axi 0.1.29\n", stderr: "", error: null }
        : { status: 0, stdout: '{"providers":[]}', stderr: "", error: null };
    },
    routes: [
      { provider: "claude" },
      { provider: "codex", enabled: true },
      { provider: "unused", enabled: false },
      { provider: "claude" },
    ],
    purpose: "phase-boundary",
    options: { env },
    now: "2026-08-24T20:26:39.429Z",
    journalFailure: (failure) => { failures.push(failure); },
    retainFailureBytes: async () => { throw new Error("nominal probe must retain nothing"); },
  });

  assert.equal(buildEnabledProviderCsv([
    { provider: "claude" },
    { provider: "unused", enabled: false },
    { provider: "codex" },
  ]), "claude,codex");
  assert.deepEqual(calls, [
    {
      executable: "/project/bin/quota-axi",
      argv: ["--version"],
      options: { timeoutMs: 2_500, env },
    },
    {
      executable: "/project/bin/quota-axi",
      argv: ["--provider", "claude,codex", "--json"],
      options: { timeoutMs: 2_500, env },
    },
  ]);
  assert.equal(result.availability, "unavailable");
  assert.equal(result.failure.reasonCode, "semantics-unresolved");
  assert.equal(failures.length, 1);
});

test("the version floor uses numeric ordering and journals both found and floor versions", async () => {
  assert.equal(compareNumericVersions("0.1.9", "0.1.29"), -1);
  assert.equal(compareNumericVersions("0.1.30", "0.1.29"), 1);
  assert.equal(compareNumericVersions("1.0.0", "0.99.99"), 1);

  const journal: unknown[] = [];
  const calls: string[][] = [];
  const result = await probeQuota({
    resolveExecutable: () => "/project/bin/quota-axi",
    runCommand: (_executable, argv) => {
      calls.push([...argv]);
      return { status: 0, stdout: "quota-axi 0.1.9\n", stderr: "", error: null };
    },
    routes: [{ provider: "claude" }],
    purpose: "phase-boundary",
    options: { env: { PATH: "/project/bin" } },
    now: "2026-08-24T20:26:39.429Z",
    journalFailure: (failure) => { journal.push(failure); },
    retainFailureBytes: async () => { throw new Error("a below-floor version retains no payload"); },
  });

  assert.deepEqual(calls, [["--version"]]);
  assert.equal(result.availability, "unavailable");
  assert.deepEqual(result.failure, {
    reasonCode: "version-below-floor",
    foundVersion: "0.1.9",
    floorVersion: "0.1.29",
  });
  assert.deepEqual(journal, [result.failure]);
});

test("unparseable bytes are retained at 0600 and only their attempt-relative path is journalled", async () => {
  const attemptDir = mkdtempSync(join(tmpdir(), "awsf-quota-probe-"));
  try {
    const journal: unknown[] = [];
    const raw = "private rate-limit response";
    const result = await probeQuota({
      resolveExecutable: () => "/project/bin/quota-axi",
      runCommand: (_executable, argv) => argv[0] === "--version"
        ? { status: 0, stdout: "0.1.29\n", stderr: "", error: null }
        : { status: 0, stdout: raw, stderr: "", error: null },
      routes: [{ provider: "claude" }],
      purpose: "phase-boundary",
      options: { env: { PATH: "/project/bin" } },
      now: "2026-08-24T20:26:39.429Z",
      journalFailure: (failure) => { journal.push(failure); },
      retainFailureBytes: retainQuotaFailureInAttempt(attemptDir, "phase/one"),
    });

    assert.equal(result.availability, "unavailable");
    assert.equal(result.failure.reasonCode, "unparseable");
    if (result.failure.reasonCode !== "unparseable") assert.fail("wrong failure variant");
    const retained = join(attemptDir, result.failure.retainedPath);
    assert.equal(readFileSync(retained, "utf8"), raw);
    assert.equal(statSync(retained).mode & 0o777, 0o600);
    assert.deepEqual(journal, [result.failure]);
    assert.equal(JSON.stringify(journal).includes(raw), false, "journal carries the path, never raw bytes");
  } finally {
    rmSync(attemptDir, { recursive: true, force: true });
  }
});

test("the interactive timeout is passed through and fails open with a journalled code", async () => {
  const journal: unknown[] = [];
  let observedTimeout: number | null = null;
  const result = await probeQuota({
    resolveExecutable: () => "/project/bin/quota-axi",
    runCommand: (_executable, _argv, options) => {
      observedTimeout = options.timeoutMs;
      return { status: null, stdout: "", stderr: "", error: "ETIMEDOUT" };
    },
    routes: [{ provider: "claude" }],
    purpose: "interactive-preflight",
    options: { env: { PATH: "/project/bin" } },
    now: "2026-08-24T20:26:39.429Z",
    journalFailure: (failure) => { journal.push(failure); },
    retainFailureBytes: async () => { throw new Error("timeouts carry no response bytes"); },
  });

  assert.equal(observedTimeout, 8_000);
  assert.equal(result.availability, "unavailable");
  assert.deepEqual(result.failure, { reasonCode: "timeout", command: "version", timeoutMs: 8_000 });
  assert.deepEqual(journal, [result.failure]);
});

test("exit 0 with a stale fixture is unavailable by structural state, not exit code", async () => {
  const stale = readFileSync(STALE_FIXTURE, "utf8");
  const journal: unknown[] = [];
  const script = [
    { status: 0, stdout: "quota-axi 0.1.29\n", stderr: "", error: null },
    { status: 0, stdout: stale, stderr: "", error: null },
  ];
  const result = await probeQuota({
    resolveExecutable: () => "/project/bin/quota-axi",
    runCommand: () => {
      const response = script.shift();
      assert.ok(response, "fake command script was exhausted");
      return response;
    },
    routes: [{ provider: "claude" }, { provider: "codex" }],
    purpose: "phase-boundary",
    options: { env: { PATH: "/project/bin" } },
    now: "2026-08-24T20:26:39.429Z",
    journalFailure: (failure) => { journal.push(failure); },
    retainFailureBytes: async () => { throw new Error("stale reports retain no bytes"); },
  });

  assert.equal(result.availability, "unavailable");
  assert.deepEqual(result.failure, { reasonCode: "stale", providers: ["claude", "codex"] });
  assert.deepEqual(result.parsed.readout.providers.map((provider) => provider.stateStatus), ["stale", "stale"]);
  assert.deepEqual(journal, [result.failure]);
});

test("exit 1 retains its code while structurally parsing a well-formed payload", async () => {
  const nominal = readFileSync(NOMINAL_FIXTURE, "utf8");
  const journal: unknown[] = [];
  const retained: string[] = [];
  const script = [
    { status: 0, stdout: "quota-axi 0.1.29\n", stderr: "", error: null },
    { status: 1, stdout: nominal, stderr: "provider reported a partial failure", error: null },
  ];
  const result = await probeQuota({
    resolveExecutable: () => "/project/bin/quota-axi",
    runCommand: () => {
      const response = script.shift();
      assert.ok(response, "fake command script was exhausted");
      return response;
    },
    routes: [{ provider: "claude" }, { provider: "codex" }],
    purpose: "phase-boundary",
    options: { env: { PATH: "/project/bin" } },
    now: "2026-08-24T20:26:39.429Z",
    journalFailure: (failure) => { journal.push(failure); },
    retainFailureBytes: async (bytes) => {
      retained.push(bytes);
      return "raw/quota-probe.txt";
    },
  });

  assert.equal(result.availability, "unavailable");
  assert.deepEqual(result.failure, {
    reasonCode: "nonzero-exit",
    command: "probe",
    exitCode: 1,
    retainedPath: "raw/quota-probe.txt",
  });
  assert.equal(result.parsed.faults.length, 0);
  assert.deepEqual(result.parsed.readout.providers.map((provider) => provider.provider), ["claude", "codex"]);
  assert.deepEqual(retained, [`${nominal}provider reported a partial failure`]);
  assert.deepEqual(journal, [result.failure]);
});

test("the closed failure vocabulary and known-minute comparator exclude unavailable figures", () => {
  assert.deepEqual(QUOTA_UNAVAILABLE_REASON_CODES, [
    "executable-not-found",
    "timeout",
    "nonzero-exit",
    "unparseable",
    "version-below-floor",
    "semantics-unresolved",
    "stale",
  ]);
  assert.equal(knownMinuteFigure(null), null);
  const known = knownMinuteFigure(12);
  assert.ok(known);
  assert.equal(isBelowQuotaStopThreshold(known, 15), true);
  assert.equal(isBelowQuotaStopThreshold(known, 10), false);
});
