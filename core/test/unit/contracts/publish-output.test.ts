import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parseEnvelope } from "../../../src/contracts/parse-envelope.ts";
import { PUBLISH_OUTPUT_SCHEMA_ID } from "../../../src/contracts/publish-output.ts";
import { repoRoot } from "../meta/_walk.ts";

function record(value: unknown, label: string): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

test("the captured S5 publish output replays with zero violations", () => {
  const fixturePath = join(repoRoot(), "core", "test", "fixtures", "stages", "S5.json");
  const capture = record(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown, "S5.json");
  const output = record(capture.output, "S5.json.output");
  const result = record(output.result, "S5.json.output.result");
  const status = record(result.status, "S5.json.output.result.status");

  const replay = {
    schema: PUBLISH_OUTPUT_SCHEMA_ID,
    producerStatus: "success",
    summary: status.lastActivity,
    artifacts: [],
    notesForNextPhase: "",
    ...output,
  };
  const parsed = parseEnvelope(JSON.stringify(replay), PUBLISH_OUTPUT_SCHEMA_ID);

  assert.deepEqual(parsed.valid ? [] : parsed.violations, []);
  assert.equal(parsed.valid, true);
  if (parsed.valid) {
    for (const [field, capturedValue] of Object.entries(output)) {
      assert.deepEqual(parsed.payload[field as keyof typeof parsed.payload], capturedValue, field);
    }
  }
});
