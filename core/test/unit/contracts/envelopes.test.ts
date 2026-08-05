import { test } from "node:test";
import assert from "node:assert/strict";
import { Value } from "@sinclair/typebox/value";
import {
  ARTIFACT_KINDS,
  ArtifactClaimSchema,
  ENVELOPE_BASE_PROPERTIES,
  ENVELOPE_SCHEMAS,
  ENVELOPE_SCHEMA_IDS,
  HOST_OWNED_FIELD_NAMES,
  PRODUCER_STATUSES,
  REVIEW_SEVERITIES,
  REVIEW_VERDICTS,
  TEST_OUTPUT_TAIL_MAX_CHARS,
  schemaForId,
  severityRank,
  UnknownEnvelopeSchemaError,
} from "../../../src/contracts/index.ts";
import { VALID_ENVELOPES } from "./fixtures.ts";

const SCHEMA_IDS = Object.keys(VALID_ENVELOPES) as (keyof typeof VALID_ENVELOPES)[];

test("the registry holds exactly the six phase envelopes", () => {
  assert.deepEqual(
    [...ENVELOPE_SCHEMA_IDS].sort(),
    [
      "awsf.build-output/v1",
      "awsf.document-output/v1",
      "awsf.plan-output/v1",
      "awsf.review-output/v1",
      "awsf.scout-output/v1",
      "awsf.test-output/v1",
    ],
  );
});

for (const schemaId of SCHEMA_IDS) {
  test(`${schemaId}: a valid envelope validates`, () => {
    assert.equal(Value.Check(ENVELOPE_SCHEMAS[schemaId], VALID_ENVELOPES[schemaId]()), true);
  });

  test(`${schemaId}: an unknown top-level field is rejected`, () => {
    const doc = { ...VALID_ENVELOPES[schemaId](), candidateSha: "deadbeef" };
    assert.equal(Value.Check(ENVELOPE_SCHEMAS[schemaId], doc), false);
  });

  test(`${schemaId}: an unknown field nested inside an artifact claim is rejected`, () => {
    const base = VALID_ENVELOPES[schemaId]();
    const doc = {
      ...base,
      artifacts: [{ path: "a.ts", kind: "source", description: "x", bytes: 12 }],
    };
    assert.equal(Value.Check(ENVELOPE_SCHEMAS[schemaId], doc), false);
  });

  test(`${schemaId}: the schema literal is pinned — another envelope's id is rejected`, () => {
    const other = SCHEMA_IDS.find((id) => id !== schemaId);
    assert.ok(other);
    const doc = { ...VALID_ENVELOPES[schemaId](), schema: other };
    assert.equal(Value.Check(ENVELOPE_SCHEMAS[schemaId], doc), false);
  });

  test(`${schemaId}: carries all five EnvelopeBase fields`, () => {
    const properties = ENVELOPE_SCHEMAS[schemaId].properties as Record<string, unknown>;
    for (const field of Object.keys(ENVELOPE_BASE_PROPERTIES)) {
      assert.ok(field in properties, `${schemaId} is missing base field ${field}`);
    }
  });

  test(`${schemaId}: is a wire schema — it declares no host-owned field`, () => {
    const properties = Object.keys(ENVELOPE_SCHEMAS[schemaId].properties as Record<string, unknown>);
    for (const hostField of HOST_OWNED_FIELD_NAMES) {
      assert.equal(
        properties.includes(hostField),
        false,
        `${schemaId} asks the model for host-owned field "${hostField}"`,
      );
    }
  });

  test(`${schemaId}: every property is required — no optional wire fields`, () => {
    const schema = ENVELOPE_SCHEMAS[schemaId];
    const properties = Object.keys(schema.properties as Record<string, unknown>).sort();
    const required = [...((schema.required ?? []) as string[])].sort();
    assert.deepEqual(required, properties);
  });
}

test("schemaForId fails closed on an unregistered id", () => {
  assert.throws(() => schemaForId("awsf.fix-output/v1"), UnknownEnvelopeSchemaError);
});

test("artifact paths must be worktree-relative, normalized, and traversal-free", () => {
  const ok = ["core/src/a.ts", "README.md", "a/b/c/d.txt", "dir/.hidden"];
  for (const path of ok) {
    assert.equal(
      Value.Check(ArtifactClaimSchema, { path, kind: "source", description: "d" }),
      true,
      `expected ${path} to be accepted`,
    );
  }
  const bad = [
    "/etc/passwd",
    "C:/Users/x/a.ts",
    "\\\\server\\share\\a.ts",
    "core\\src\\a.ts",
    "../outside.ts",
    "core/../../outside.ts",
    "core//src/a.ts",
    "./core/a.ts",
    "core/src/",
    "",
    "..",
  ];
  for (const path of bad) {
    assert.equal(
      Value.Check(ArtifactClaimSchema, { path, kind: "source", description: "d" }),
      false,
      `expected ${JSON.stringify(path)} to be rejected`,
    );
  }
});

test("artifact kind and producer status are closed sets", () => {
  assert.deepEqual([...ARTIFACT_KINDS], ["source", "test", "plan", "documentation", "report"]);
  assert.deepEqual([...PRODUCER_STATUSES], ["success", "failure"]);
  assert.equal(Value.Check(ArtifactClaimSchema, { path: "a.ts", kind: "config", description: "d" }), false);
});

test("BuildOutput does not ask the model for a candidate SHA — the host computes it", () => {
  const properties = Object.keys(ENVELOPE_SCHEMAS["awsf.build-output/v1"].properties as Record<string, unknown>);
  assert.equal(properties.includes("candidateSha"), false);
});

test("BuildOutput.commandsRun.exitCode distinguishes null from 0", () => {
  const schema = ENVELOPE_SCHEMAS["awsf.build-output/v1"];
  const withNull = { ...VALID_ENVELOPES["awsf.build-output/v1"]() };
  withNull.commandsRun = [{ argv: ["npm", "test"], exitCode: null }];
  assert.equal(Value.Check(schema, withNull), true);
  const withZero = { ...VALID_ENVELOPES["awsf.build-output/v1"]() };
  withZero.commandsRun = [{ argv: ["npm", "test"], exitCode: 0 }];
  assert.equal(Value.Check(schema, withZero), true);
  const missing = { ...VALID_ENVELOPES["awsf.build-output/v1"]() };
  missing.commandsRun = [{ argv: ["npm", "test"] } as never];
  assert.equal(Value.Check(schema, missing), false);
});

test("TestOutput.candidateSha must be a 40-hex SHA", () => {
  const schema = ENVELOPE_SCHEMAS["awsf.test-output/v1"];
  for (const bad of ["", "HEAD", "a".repeat(39), "A".repeat(40), `${"a".repeat(40)}x`]) {
    assert.equal(Value.Check(schema, { ...VALID_ENVELOPES["awsf.test-output/v1"](), candidateSha: bad }), false);
  }
});

test("TestOutput.outputTail is bounded at 4000 characters, verbatim", () => {
  const schema = ENVELOPE_SCHEMAS["awsf.test-output/v1"];
  const atLimit = { ...VALID_ENVELOPES["awsf.test-output/v1"](), outputTail: "x".repeat(TEST_OUTPUT_TAIL_MAX_CHARS) };
  assert.equal(Value.Check(schema, atLimit), true);
  const over = { ...VALID_ENVELOPES["awsf.test-output/v1"](), outputTail: "x".repeat(TEST_OUTPUT_TAIL_MAX_CHARS + 1) };
  assert.equal(Value.Check(schema, over), false);
});

test("ReviewFinding.severity is the four-value ordered set, and line may be null but not absent", () => {
  assert.deepEqual([...REVIEW_SEVERITIES], ["low", "medium", "high", "critical"]);
  assert.deepEqual([...REVIEW_VERDICTS], ["accept", "concern"]);
  assert.ok(severityRank("medium") > severityRank("low"));
  assert.ok(severityRank("critical") > severityRank("high"));

  const schema = ENVELOPE_SCHEMAS["awsf.review-output/v1"];
  const base = VALID_ENVELOPES["awsf.review-output/v1"]();
  const finding = {
    id: "F1",
    severity: "medium",
    file: "core/src/contracts/parse-envelope.ts",
    line: 42,
    title: "t",
    detail: "d",
    evidence: "e",
  };

  assert.equal(Value.Check(schema, { ...base, findings: [{ ...finding, line: null }] }), true);
  assert.equal(Value.Check(schema, { ...base, findings: [{ ...finding, severity: "blocker" }] }), false);

  const { line: _line, ...withoutLine } = finding;
  assert.equal(Value.Check(schema, { ...base, findings: [withoutLine] }), false);
});
