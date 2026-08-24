import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stringify as toYaml } from "yaml";
import {
  loadConfig,
  ConfigSchemaError,
  ConfigAbsolutePathError,
  ConfigCredentialShapedError,
  ConfigUnknownAdapterError,
  ConfigUnverifiedAdapterError,
  ConfigUnknownAdapterReferenceError,
  ConfigUnknownWorkflowError,
  ConfigUnknownGateError,
  ConfigUnknownProtectedOperationError,
  ConfigInvalidCeilingError,
  ConfigInvalidNoFallbackError,
  ConfigInvalidPersistThinkingError,
  ConfigInvalidSeedPathError,
} from "../../../src/config/load.ts";
import { MAX_CALL_CEILING } from "../../../src/state/tiers.ts";
import { repoRoot } from "../meta/_walk.ts";
import { validConfig, deepClone } from "./fixture.ts";

test("loads a fully valid config", () => {
  const config = loadConfig(toYaml(validConfig()));
  assert.equal(config.schema, "awsf/v1");
  assert.equal(config.project.slug, "test-project");
});

test("omitting quota_stop yields a disabled stop", () => {
  const config = loadConfig(toYaml(validConfig()));
  assert.equal(config.routing.quota_stop, undefined);
});

test("quota_stop default applies to every adapter and by_adapter overrides only its adapter", () => {
  const doc = deepClone(validConfig());
  doc.routing.quota_stop = {
    default: { minutes: 30, probe_timeout_ms: 2_500 },
    by_adapter: { codex: { minutes: 15, probe_timeout_ms: 3_000 } },
  };
  const config = loadConfig(toYaml(doc));
  const stopFor = (adapterId: string) => config.routing.quota_stop?.by_adapter?.[adapterId] ?? config.routing.quota_stop?.default;
  assert.deepEqual(stopFor("claude"), { minutes: 30, probe_timeout_ms: 2_500 });
  assert.deepEqual(stopFor("stub"), { minutes: 30, probe_timeout_ms: 2_500 });
  assert.deepEqual(stopFor("codex"), { minutes: 15, probe_timeout_ms: 3_000 });
});

test("rejects measured quota fields by name", () => {
  for (const [field, value] of [
    ["percentage", 42],
    ["resetsAt", "2026-08-25T00:00:00Z"],
    ["window_id", "five-hour"],
  ] as const) {
    const doc = deepClone(validConfig()) as unknown as Record<string, unknown>;
    (doc.routing as Record<string, unknown>).quota_stop = {
      default: { minutes: 30, probe_timeout_ms: 2_500, [field]: value },
    };
    assert.throws(() => loadConfig(toYaml(doc)), (error: Error) =>
      error instanceof ConfigSchemaError && error.violations.some((violation) => violation.endsWith(`/routing/quota_stop/default/${field}: Unexpected property`)));
  }
});

test("rejects negative and non-integer quota stop minutes", () => {
  for (const minutes of [-1, 2.5]) {
    const doc = deepClone(validConfig()) as unknown as Record<string, unknown>;
    (doc.routing as Record<string, unknown>).quota_stop = {
      default: { minutes, probe_timeout_ms: 2_500 },
    };
    assert.throws(() => loadConfig(toYaml(doc)), ConfigSchemaError);
  }
});

test("the committed default awsf.config.yaml loads and validates", () => {
  const text = readFileSync(join(repoRoot(), "awsf.config.yaml"), "utf8");
  const config = loadConfig(text);
  assert.equal(config.schema, "awsf/v1");
  assert.equal(config.routing.no_fallback, true);
  assert.equal(config.observability.persist_thinking_text, false);
});

test("rejects a document that fails the awsf/v1 schema", () => {
  const doc = deepClone(validConfig());
  // @ts-expect-error deliberately malformed for the test
  delete doc.project;
  assert.throws(() => loadConfig(toYaml(doc)), ConfigSchemaError);
});

test("rejects an absolute POSIX path anywhere in the document", () => {
  const doc = deepClone(validConfig());
  doc.policy.protected_paths.push("/etc/passwd");
  assert.throws(() => loadConfig(toYaml(doc)), ConfigAbsolutePathError);
});

test("rejects a Windows drive-letter path", () => {
  const doc = deepClone(validConfig());
  doc.agents[0]!.prompt.system = "C:\\Users\\owner\\prompts\\builder\\system.md";
  assert.throws(() => loadConfig(toYaml(doc)), ConfigAbsolutePathError);
});

test("rejects a home-relative (~) path", () => {
  const doc = deepClone(validConfig());
  doc.policy.protected_paths.push("~/.ssh/id_rsa");
  assert.throws(() => loadConfig(toYaml(doc)), ConfigAbsolutePathError);
});

test("rejects an absolute path used as an adapter id (object key)", () => {
  const doc = deepClone(validConfig()) as Record<string, unknown>;
  const adapters = doc.adapters as Record<string, unknown>;
  adapters["/etc/passwd"] = { kind: "claude-code" };
  assert.throws(() => loadConfig(toYaml(doc)), ConfigAbsolutePathError);
});

test("rejects a credential-shaped value", () => {
  const doc = deepClone(validConfig());
  doc.project.slug = "sk-abcdefghijklmnopqrstuvwx".toLowerCase();
  assert.throws(() => loadConfig(toYaml(doc)), ConfigCredentialShapedError);
});

test("rejects an unknown adapter kind", () => {
  const doc = deepClone(validConfig());
  doc.adapters.mystery = { kind: "not-a-real-adapter" };
  assert.throws(() => loadConfig(toYaml(doc)), ConfigUnknownAdapterError);
});

test("rejects enabled Antigravity without the explicit verification flag", () => {
  const doc = deepClone(validConfig());
  doc.adapters.antigravity = { kind: "antigravity", executable: "agy", enabled: true };
  assert.throws(() => loadConfig(toYaml(doc)), ConfigUnverifiedAdapterError);
});

test("accepts enabled Antigravity only with explicit verification", () => {
  const doc = deepClone(validConfig());
  doc.adapters.antigravity = { kind: "antigravity", executable: "agy", enabled: true, verified: true };
  assert.equal(loadConfig(toYaml(doc)).adapters.antigravity?.verified, true);
});

test("rejects routing.default_worker naming an undeclared adapter", () => {
  const doc = deepClone(validConfig());
  doc.routing.default_worker = "undeclared-adapter";
  assert.throws(() => loadConfig(toYaml(doc)), ConfigUnknownAdapterReferenceError);
});

test("rejects an agent naming an undeclared harness adapter", () => {
  const doc = deepClone(validConfig());
  doc.agents[0]!.harness.adapter = "undeclared-adapter";
  assert.throws(() => loadConfig(toYaml(doc)), ConfigUnknownAdapterReferenceError);
});

test("rejects an unknown workflow id in workflows.enabled", () => {
  const doc = deepClone(validConfig());
  doc.workflows.enabled.push("seventh-workflow");
  assert.throws(() => loadConfig(toYaml(doc)), ConfigUnknownWorkflowError);
});

test("rejects project.default_workflow pointing at an unknown workflow", () => {
  const doc = deepClone(validConfig());
  doc.project.default_workflow = "not-a-workflow";
  assert.throws(() => loadConfig(toYaml(doc)), ConfigUnknownWorkflowError);
});

test("accepts lint as an argv-driven host gate id", () => {
  const doc = deepClone(validConfig());
  doc.gates.lint = { argv: ["npm", "run", "lint"], timeout_seconds: 60 };
  assert.deepEqual(loadConfig(toYaml(doc)).gates.lint?.argv, ["npm", "run", "lint"]);
});

test("rejects an unknown gate id", () => {
  const doc = deepClone(validConfig());
  doc.gates.mystery_gate = { argv: ["echo", "hi"], timeout_seconds: 5 };
  assert.throws(() => loadConfig(toYaml(doc)), ConfigUnknownGateError);
});

test("rejects an unknown protected operation", () => {
  const doc = deepClone(validConfig());
  doc.policy.protected_operations.push("mind-control");
  assert.throws(() => loadConfig(toYaml(doc)), ConfigUnknownProtectedOperationError);
});

// The dial, not a shortlist. `risk.call_ceiling` was formerly checked against
// {1,3,5} — the three values the hardcoded constant already had — which made
// the field look like a tuning surface while admitting nothing new. Every whole
// number of calls the bound admits is now accepted, and the bound itself is the
// only refusal left.
for (const ceiling of [1, 2, 4, 6, MAX_CALL_CEILING]) {
  test(`accepts tier ceiling ${ceiling}: the field is a real dial`, () => {
    const doc = deepClone(validConfig());
    doc.risk.call_ceiling.T1 = ceiling;
    assert.equal(loadConfig(toYaml(doc)).risk.call_ceiling.T1, ceiling);
  });
}

for (const ceiling of [0, -1, MAX_CALL_CEILING + 1, 100]) {
  test(`rejects tier ceiling ${ceiling}: below one call or past the hard bound`, () => {
    const doc = deepClone(validConfig());
    doc.risk.call_ceiling.T0 = ceiling;
    assert.throws(() => loadConfig(toYaml(doc)), ConfigInvalidCeilingError);
  });
}

test("rejects a fractional tier ceiling", () => {
  const doc = deepClone(validConfig());
  doc.risk.call_ceiling.T2 = 2.5;
  assert.throws(() => loadConfig(toYaml(doc)), (error: Error) =>
    error instanceof ConfigInvalidCeilingError || error.name === "ConfigSchemaError");
});

test("rejects routing.no_fallback: false", () => {
  const doc = deepClone(validConfig());
  doc.routing.no_fallback = false;
  assert.throws(() => loadConfig(toYaml(doc)), ConfigInvalidNoFallbackError);
});

test("rejects traversal, ambiguous separators, and overlapping runtime seed paths", () => {
  for (const paths of [
    ["../node_modules"],
    ["vendor\\modules"],
    ["node_modules", "node_modules/pkg"],
  ]) {
    const doc = deepClone(validConfig());
    doc.runtime.seed_paths = paths;
    assert.throws(() => loadConfig(toYaml(doc)), ConfigInvalidSeedPathError, JSON.stringify(paths));
  }
});

test("accepts normalized repository-relative runtime seed paths", () => {
  const doc = deepClone(validConfig());
  doc.runtime.seed_paths = ["node_modules", "vendor/cache"];
  assert.deepEqual(loadConfig(toYaml(doc)).runtime.seed_paths, ["node_modules", "vendor/cache"]);
});

test("rejects observability.persist_thinking_text: true", () => {
  const doc = deepClone(validConfig());
  doc.observability.persist_thinking_text = true;
  assert.throws(() => loadConfig(toYaml(doc)), ConfigInvalidPersistThinkingError);
});
