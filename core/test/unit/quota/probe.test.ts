import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildEnabledProviderCsv,
  buildQuotaAxiArgv,
  probeQuota,
} from "../../../src/quota/probe.ts";

const PROBE_SOURCE = new URL("../../../src/quota/probe.ts", import.meta.url);
const CAPTURE_SOURCE = new URL("../../fixtures/quota-axi/capture-probe.ts", import.meta.url);

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

test("the probe resolves quota-axi against its command environment and returns raw bytes", () => {
  const calls: Array<{ executable: string; argv: readonly string[]; options: unknown }> = [];
  const env = { PATH: "/project/bin" };
  const result = probeQuota({
    resolveExecutable: (executable, resolvedEnv) => {
      assert.equal(executable, "quota-axi");
      assert.equal(resolvedEnv, env);
      return "/project/bin/quota-axi";
    },
    runCommand: (executable, argv, options) => {
      calls.push({ executable, argv, options });
      return { status: 0, stdout: '{"providers":[]}', stderr: "", error: null };
    },
    routes: [
      { provider: "claude" },
      { provider: "codex", enabled: true },
      { provider: "unused", enabled: false },
      { provider: "claude" },
    ],
    options: { timeoutMs: 2_500, env },
  });

  assert.equal(buildEnabledProviderCsv([
    { provider: "claude" },
    { provider: "unused", enabled: false },
    { provider: "codex" },
  ]), "claude,codex");
  assert.deepEqual(calls, [{
    executable: "/project/bin/quota-axi",
    argv: ["--provider", "claude,codex", "--json"],
    options: { timeoutMs: 2_500, env },
  }]);
  assert.deepEqual(result, { bytes: '{"providers":[]}', status: 0, stderr: "", error: null });
});
