import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnvelope } from "../../../src/contracts/parse-envelope.ts";
import { envelopeValid } from "../../../src/gates/envelope.ts";
import { validBuildOutput } from "../contracts/fixtures.ts";

test("envelope_valid positive records schema and success checks", () => {
  const report = envelopeValid(parseEnvelope(JSON.stringify(validBuildOutput()), "awsf.build-output/v1"));
  assert.equal(report.passed, true);
  assert.equal(report.checks.length, 2);
});

test("envelope_valid negative records every check after schema failure", () => {
  const report = envelopeValid(parseEnvelope("{}", "awsf.build-output/v1"));
  assert.equal(report.passed, false);
  assert.equal(report.checks.length, 2);
  assert.deepEqual(report.checks.map((check) => check.ok), [false, false]);
});
