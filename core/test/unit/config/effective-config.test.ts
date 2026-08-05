import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEffectiveConfig, toConfigSnapshotJson } from "../../../src/config/effective-config.ts";
import { validConfig, deepClone } from "./fixture.ts";

test("effective config is structurally identical to a config with nothing to redact", () => {
  const config = validConfig();
  const effective = buildEffectiveConfig(config);
  assert.deepEqual(effective, config);
});

test("config_snapshot_json is valid JSON that round-trips to the effective config", () => {
  const config = validConfig();
  const json = toConfigSnapshotJson(config);
  assert.doesNotThrow(() => JSON.parse(json));
  const parsed = JSON.parse(json);
  assert.deepEqual(parsed, buildEffectiveConfig(config));
});

test("defense-in-depth: an absolute path reaching effective-config directly is redacted", () => {
  const config = deepClone(validConfig());
  config.agents[0]!.prompt = "/etc/awsf/private/builder.md";
  const effective = buildEffectiveConfig(config);
  assert.equal(effective.agents[0]!.prompt, "[REDACTED]");
});

test("defense-in-depth: a credential-shaped value reaching effective-config directly is redacted", () => {
  const config = deepClone(validConfig());
  config.project.name = "AKIAABCDEFGHIJKLMNOP";
  const effective = buildEffectiveConfig(config);
  assert.equal(effective.project.name, "[REDACTED]");
});

test("redaction does not mutate the input config", () => {
  const config = deepClone(validConfig());
  config.project.name = "AKIAABCDEFGHIJKLMNOP";
  buildEffectiveConfig(config);
  assert.equal(config.project.name, "AKIAABCDEFGHIJKLMNOP");
});
