import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { INIT_OUTPUT_SCHEMA_ID } from "../../../src/contracts/init-output.ts";
import { parseEnvelope } from "../../../src/contracts/parse-envelope.ts";
import { repoRoot } from "../meta/_walk.ts";

function record(value: unknown, label: string): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

test("the captured S1 init output replays with zero violations", () => {
  const fixturePath = join(repoRoot(), "core", "test", "fixtures", "stages", "S1.json");
  const capture = record(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown, "S1.json");
  const output = record(capture.output, "S1.json.output");
  assert.equal(typeof output.line, "string");

  const replay = {
    schema: INIT_OUTPUT_SCHEMA_ID,
    producerStatus: "success",
    summary: output.line,
    artifacts: [],
    notesForNextPhase: "",
    ...output,
  };
  const parsed = parseEnvelope(JSON.stringify(replay), INIT_OUTPUT_SCHEMA_ID);

  assert.deepEqual(parsed.valid ? [] : parsed.violations, []);
  assert.equal(parsed.valid, true);
  if (parsed.valid) {
    for (const [field, capturedValue] of Object.entries(output)) {
      assert.deepEqual(parsed.payload[field as keyof typeof parsed.payload], capturedValue, field);
    }
  }
});
