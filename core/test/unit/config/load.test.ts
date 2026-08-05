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
  ConfigUnknownAdapterReferenceError,
  ConfigUnknownWorkflowError,
  ConfigUnknownGateError,
  ConfigUnknownProtectedOperationError,
  ConfigInvalidCeilingError,
  ConfigInvalidNoFallbackError,
  ConfigInvalidPersistThinkingError,
} from "../../../src/config/load.ts";
import { repoRoot } from "../meta/_walk.ts";
import { validConfig, deepClone } from "./fixture.ts";

test("loads a fully valid config", () => {
  const config = loadConfig(toYaml(validConfig()));
  assert.equal(config.schema, "awsf/v1");
  assert.equal(config.project.slug, "test-project");
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

test("rejects a tier ceiling not in {1,3,5}", () => {
  const doc = deepClone(validConfig());
  doc.risk.call_ceiling.T1 = 4;
  assert.throws(() => loadConfig(toYaml(doc)), ConfigInvalidCeilingError);
});

for (const ceiling of [0, 2, 4, 6, 100]) {
  test(`rejects tier ceiling ${ceiling} specifically`, () => {
    const doc = deepClone(validConfig());
    doc.risk.call_ceiling.T0 = ceiling;
    assert.throws(() => loadConfig(toYaml(doc)), ConfigInvalidCeilingError);
  });
}

test("rejects routing.no_fallback: false", () => {
  const doc = deepClone(validConfig());
  doc.routing.no_fallback = false;
  assert.throws(() => loadConfig(toYaml(doc)), ConfigInvalidNoFallbackError);
});

test("rejects observability.persist_thinking_text: true", () => {
  const doc = deepClone(validConfig());
  doc.observability.persist_thinking_text = true;
  assert.throws(() => loadConfig(toYaml(doc)), ConfigInvalidPersistThinkingError);
});
