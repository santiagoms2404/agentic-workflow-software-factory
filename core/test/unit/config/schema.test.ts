import { test } from "node:test";
import assert from "node:assert/strict";
import { Value } from "@sinclair/typebox/value";
import { AwsfConfigSchema } from "../../../src/config/schema.ts";
import { validConfig } from "./fixture.ts";

test("a fully-populated valid config satisfies the awsf/v1 schema", () => {
  assert.equal(Value.Check(AwsfConfigSchema, validConfig()), true);
});

test("wrong schema literal is rejected", () => {
  const doc = { ...validConfig(), schema: "awsf/v2" };
  assert.equal(Value.Check(AwsfConfigSchema, doc), false);
});

test("unknown top-level field is rejected (additionalProperties: false)", () => {
  const doc = { ...validConfig(), unexpected_field: true };
  assert.equal(Value.Check(AwsfConfigSchema, doc), false);
});

test("unknown field on a nested agent object is rejected", () => {
  const config = validConfig();
  const doc = {
    ...config,
    agents: [{ ...config.agents[0], sandbox_escape: true }],
  };
  assert.equal(Value.Check(AwsfConfigSchema, doc), false);
});

test("agent.prompt must be a {system, user} pair, not a single string", () => {
  const config = validConfig();
  const doc = { ...config, agents: [{ ...config.agents[0], prompt: "prompts/builder.md" }] };
  assert.equal(Value.Check(AwsfConfigSchema, doc), false);
});

test("routing.no_fallback must be a boolean at the schema level", () => {
  const config = validConfig();
  const doc = { ...config, routing: { ...config.routing, no_fallback: "true" } };
  assert.equal(Value.Check(AwsfConfigSchema, doc), false);
});

test("observability.db must use the state:// scheme", () => {
  const config = validConfig();
  const doc = { ...config, observability: { ...config.observability, db: "awsf.db" } };
  assert.equal(Value.Check(AwsfConfigSchema, doc), false);
});

test("pricing.models defaults to an empty object and is accepted", () => {
  assert.deepEqual(validConfig().pricing.models, {});
  assert.equal(Value.Check(AwsfConfigSchema, validConfig()), true);
});
