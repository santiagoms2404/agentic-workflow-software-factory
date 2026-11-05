import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Value } from "@sinclair/typebox/value";
import {
  PROJECT_REGISTER_OUTPUT_SCHEMA_ID,
  ProjectRegisterOutputSchema,
} from "../../../src/contracts/project-register-output.ts";
import { parseEnvelope } from "../../../src/contracts/parse-envelope.ts";
import { repoRoot } from "../meta/_walk.ts";

function record(value: unknown, label: string): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

test("the captured S2 project-register output replays with zero violations", () => {
  const fixturePath = join(repoRoot(), "core", "test", "fixtures", "stages", "S2.json");
  const capture = record(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown, "S2.json");
  const output = record(capture.output, "S2.json.output");
  assert.equal(typeof output.line, "string");

  const replay = {
    schema: PROJECT_REGISTER_OUTPUT_SCHEMA_ID,
    producerStatus: "success",
    summary: output.line,
    artifacts: [],
    notesForNextPhase: "",
    ...output,
  };
  const parsed = parseEnvelope(JSON.stringify(replay), PROJECT_REGISTER_OUTPUT_SCHEMA_ID);

  assert.deepEqual(parsed.valid ? [] : parsed.violations, []);
  assert.equal(parsed.valid, true);
  if (parsed.valid) {
    for (const [field, capturedValue] of Object.entries(output)) {
      assert.deepEqual(parsed.payload[field as keyof typeof parsed.payload], capturedValue, field);
    }
  }
});

test("project-register output reuses the catalog contract and configured gate rules", () => {
  const fixturePath = join(repoRoot(), "core", "test", "fixtures", "stages", "S2.json");
  const capture = record(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown, "S2.json");
  const output = record(capture.output, "S2.json.output");
  const valid: Record<string, unknown> = {
    schema: PROJECT_REGISTER_OUTPUT_SCHEMA_ID,
    producerStatus: "success",
    summary: output.line,
    artifacts: [],
    notesForNextPhase: "",
    ...output,
  };
  assert.equal(Value.Check(ProjectRegisterOutputSchema, valid), true);

  const invalidGate = structuredClone(valid);
  const project = record(invalidGate.resolvedProject, "resolvedProject");
  const repositories = record(project.repositories, "repositories");
  const canonical = record(repositories.canonical, "canonical repository");
  canonical.gates = [{ gateId: "empty-argv", argv: [], timeout_seconds: 1 }];
  assert.equal(Value.Check(ProjectRegisterOutputSchema, invalidGate), false);

  const invalidContract = structuredClone(valid);
  const contractProject = record(invalidContract.resolvedProject, "resolvedProject");
  contractProject.contracts = [{
    id: "contract",
    digest: `sha256:${"a".repeat(64)}`,
    producer: { repository: "bad id", path: "src/contract.ts" },
    consumers: [{ repository: "canonical", path: "src/contract.ts" }],
  }];
  assert.equal(Value.Check(ProjectRegisterOutputSchema, invalidContract), false);
});
