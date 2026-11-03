// B10-05, B10-06, B10-07, B10-08: Tier 4 Batch 10 config regression tests.

import assert from "node:assert/strict";
import { test } from "node:test";
import { stringify as toYaml } from "yaml";
import { buildMinimalConfig } from "../../../src/config/init-template.ts";
import {
  ConfigDuplicateAgentNameError,
  ConfigUnknownAdapterReferenceError,
  loadConfig,
} from "../../../src/config/load.ts";
import { InvalidPolicyPath } from "../../../src/policy/path-policy.ts";

test("B10-05: buildMinimalConfig sets practical production defaults rather than schema floors", () => {
  const config = buildMinimalConfig("test-project");

  // Runtime limits
  assert.equal(config.runtime.silence_timeout_seconds, 2700);
  assert.equal(config.runtime.process_grace_seconds, 2);
  assert.equal(config.runtime.max_output_bytes, 67108864);
  assert.equal(config.runtime.max_event_count, 100000);

  // Risk settings
  assert.equal(config.risk.default, "T1");
  assert.deepEqual(config.risk.call_ceiling, { T0: 1, T1: 3, T2: 5 });
  assert.deepEqual(config.risk.correction_allowance, { auto: 1, owner: 1 });
});

test("B10-06: loadConfig rejects undeclared adapter references in quota_stop.by_adapter", () => {
  const minimal = buildMinimalConfig("quota-project");
  const withInvalidQuota = {
    ...minimal,
    routing: {
      ...minimal.routing,
      quota_stop: {
        default: { minutes: 60, probe_timeout_ms: 1000 },
        by_adapter: {
          claud: { minutes: 240, probe_timeout_ms: 5000 },
        },
      },
    },
  };

  assert.throws(
    () => loadConfig(toYaml(withInvalidQuota)),
    (err: unknown) => err instanceof ConfigUnknownAdapterReferenceError,
    "loadConfig must reject unknown adapter in quota_stop.by_adapter",
  );
});

test("B10-07: loadConfig rejects duplicate agent names", () => {
  const minimal = buildMinimalConfig("dup-agent-project");
  const agentTemplate = {
    name: "builder",
    model: "claude-3-5",
    thinking: "high" as const,
    color: "#22D3EE",
    purpose: "Implements plan steps",
    prompt: { system: "prompts/builder/system.md", user: "prompts/builder/user.md" },
    harness: { adapter: "claude", continuity: "same-session" as const },
    tools: { profile: "managed-worker", allow: ["read", "write"] },
    writes: ["src/**"],
  };

  const withDuplicateAgents = {
    ...minimal,
    agents: [
      { ...agentTemplate },
      { ...agentTemplate, writes: [] },
    ],
  };

  assert.throws(
    () => loadConfig(toYaml(withDuplicateAgents)),
    (err: unknown) => err instanceof ConfigDuplicateAgentNameError,
    "loadConfig must reject duplicate agent names",
  );
});

test("B10-08: loadConfig validates globs in risk.paths, policy.protected_paths, and agent.writes", () => {
  const minimal = buildMinimalConfig("glob-project");

  // Trailing slash in risk.paths glob
  const invalidRiskGlob = {
    ...minimal,
    risk: {
      ...minimal.risk,
      paths: {
        "core/state/**/": "T2",
      },
    },
  };
  assert.throws(
    () => loadConfig(toYaml(invalidRiskGlob)),
    (err: unknown) => err instanceof InvalidPolicyPath,
    "loadConfig must reject malformed risk glob with trailing slash",
  );

  // Trailing slash in policy.protected_paths
  const invalidProtectedGlob = {
    ...minimal,
    policy: {
      ...minimal.policy,
      protected_paths: ["core/state/**/"],
    },
  };
  assert.throws(
    () => loadConfig(toYaml(invalidProtectedGlob)),
    (err: unknown) => err instanceof InvalidPolicyPath,
    "loadConfig must reject malformed protected_paths glob",
  );

  // Malformed glob in agent.writes
  const invalidAgentWritesGlob = {
    ...minimal,
    agents: [
      {
        name: "builder",
        model: "claude-3-5",
        thinking: "high" as const,
        color: "#22D3EE",
        purpose: "Implements plan steps",
        prompt: { system: "prompts/builder/system.md", user: "prompts/builder/user.md" },
        harness: { adapter: "claude", continuity: "same-session" as const },
        tools: { profile: "managed-worker", allow: ["read", "write"] },
        writes: ["src/**/"],
      },
    ],
  };
  assert.throws(
    () => loadConfig(toYaml(invalidAgentWritesGlob)),
    (err: unknown) => err instanceof InvalidPolicyPath,
    "loadConfig must reject malformed agent.writes glob",
  );
});
