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

test("the registry holds exactly the seven phase envelopes", () => {
  assert.deepEqual(
    [...ENVELOPE_SCHEMA_IDS].sort(),
    [
      "awsf.build-output/v1",
      "awsf.document-output/v1",
      "awsf.plan-output/v1",
      "awsf.review-context/v1",
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
    // A name no envelope declares, so this proves `additionalProperties: false`
    // rather than accidentally proving a declared field's own pattern. The
    // narrower claim — that BuildOutput does not ask for `candidateSha` — has
    // its own test below.
    const doc = { ...VALID_ENVELOPES[schemaId](), hostOnlyExtra: "deadbeef" };
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

test("every declared path field, in every envelope, obeys the same worktree rule", () => {
  // Regression guard for a real inconsistency in T3's first pass: scout
  // findings were strict while review findings and plan step files were bare
  // strings, so `../../etc/passwd` was rejected in one envelope and accepted
  // in another. One rule, everywhere.
  const traversal = "../../etc/passwd";

  const plan = VALID_ENVELOPES["awsf.plan-output/v1"]();
  plan.implementationSteps = [{ id: "S1", title: "t", files: [traversal], acceptanceCriteria: ["a"] }];
  assert.equal(Value.Check(ENVELOPE_SCHEMAS["awsf.plan-output/v1"], plan), false);

  const review = VALID_ENVELOPES["awsf.review-output/v1"]();
  review.findings = [
    { id: "F1", severity: "high", file: traversal, line: null, title: "t", detail: "d", evidence: "e" },
  ];
  assert.equal(Value.Check(ENVELOPE_SCHEMAS["awsf.review-output/v1"], review), false);

  const scout = VALID_ENVELOPES["awsf.scout-output/v1"]();
  scout.findings = [{ file: traversal, note: "n" }];
  assert.equal(Value.Check(ENVELOPE_SCHEMAS["awsf.scout-output/v1"], scout), false);

  const build = VALID_ENVELOPES["awsf.build-output/v1"]();
  build.changedFiles = [traversal];
  assert.equal(Value.Check(ENVELOPE_SCHEMAS["awsf.build-output/v1"], build), false);

  const doc = VALID_ENVELOPES["awsf.document-output/v1"]();
  doc.documentedAreas = [{ subject: "s", documentPath: traversal }];
  assert.equal(Value.Check(ENVELOPE_SCHEMAS["awsf.document-output/v1"], doc), false);

  const changed = VALID_ENVELOPES["awsf.review-context/v1"]();
  changed.changedFiles = [traversal];
  assert.equal(Value.Check(ENVELOPE_SCHEMAS["awsf.review-context/v1"], changed), false);

  const omitted = VALID_ENVELOPES["awsf.review-context/v1"]();
  omitted.diffOmittedFiles = [traversal];
  assert.equal(Value.Check(ENVELOPE_SCHEMAS["awsf.review-context/v1"], omitted), false);
});

test("ReviewContext nests the WHOLE TestOutput — a curated one is rejected", () => {
  // The reviewer used to receive the test envelope and now receives this
  // instead, so anything dropped here is evidence the reviewer stopped getting.
  // Nesting the schema whole is what makes that impossible to do by accident.
  const schema = ENVELOPE_SCHEMAS["awsf.review-context/v1"];
  const base = VALID_ENVELOPES["awsf.review-context/v1"]();
  assert.equal(Value.Check(schema, base), true);

  const { outputTail: _tail, ...withoutTail } = base.testOutput;
  assert.equal(Value.Check(schema, { ...base, testOutput: withoutTail }), false);

  const { failures: _failures, ...withoutFailures } = base.testOutput;
  assert.equal(Value.Check(schema, { ...base, testOutput: withoutFailures }), false);

  const commands = base.testOutput.commands.map(({ durationMs: _duration, ...rest }) => rest);
  assert.equal(Value.Check(schema, { ...base, testOutput: { ...base.testOutput, commands } }), false);
});

test("ReviewContext binds its evidence to exact identities, not to shapes", () => {
  const schema = ENVELOPE_SCHEMAS["awsf.review-context/v1"];
  const base = VALID_ENVELOPES["awsf.review-context/v1"]();
  for (const bad of ["", "HEAD", "a".repeat(39), "A".repeat(40)]) {
    assert.equal(Value.Check(schema, { ...base, candidateSha: bad }), false);
    assert.equal(Value.Check(schema, { ...base, baseSha: bad }), false);
  }
  // The digest is of the FULL diff, so it is a SHA-256 and not a git object id.
  for (const bad of ["", "c".repeat(40), "C".repeat(64), `${"c".repeat(64)}0`]) {
    assert.equal(Value.Check(schema, { ...base, diffSha256: bad }), false);
  }
  assert.equal(Value.Check(schema, { ...base, request: "" }), false);
  assert.equal(Value.Check(schema, { ...base, insertions: -1 }), false);
  assert.equal(Value.Check(schema, { ...base, diffOmittedChars: -1 }), false);
});

test("the host-owned guard list covers every StoredEnvelope field except the wire's own `schema`", () => {
  // Keeps the deny list from silently falling behind the wrapper it guards.
  const storedFields = [
    "envelopeId",
    "sessionId",
    "phaseId",
    "correctionRound",
    "agent",
    "schemaId",
    "valid",
    "createdAt",
    "payload",
    "violations",
    "rawOutputPath",
  ];
  const guarded = new Set<string>(HOST_OWNED_FIELD_NAMES);
  // `payload` is the wrapper's container for the wire envelope, not a field a
  // wire schema could plausibly collide with; everything else must be guarded.
  for (const field of storedFields.filter((f) => f !== "payload")) {
    assert.ok(guarded.has(field), `HOST_OWNED_FIELD_NAMES is missing StoredEnvelope field "${field}"`);
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
