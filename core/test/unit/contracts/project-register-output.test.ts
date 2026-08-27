import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PROJECT_REGISTER_OUTPUT_SCHEMA_ID } from "../../../src/contracts/project-register-output.ts";
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
