import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emitAllEnvelopeJsonSchemas,
  emitEnvelopeJsonSchema,
  parseEnvelope,
} from "../../../src/contracts/index.ts";
import {
  validArchitectureReviewOutput,
  validDesignContext,
  validDesignOutput,
  validDesignPlanOutput,
  validPlanContext,
} from "./fixtures.ts";

const DESIGN_ENVELOPE_IDS = [
  "awsf.design-output/v1",
  "awsf.architecture-review-output/v1",
  "awsf.plan-context/v1",
  "awsf.design-plan-output/v1",
] as const;

const MILESTONE_ENVELOPE_IDS = [
  ...DESIGN_ENVELOPE_IDS,
  "awsf.design-context/v1",
] as const;

const GOOD_PAYLOADS = {
  "awsf.design-output/v1": validDesignOutput,
  "awsf.architecture-review-output/v1": validArchitectureReviewOutput,
  "awsf.plan-context/v1": validPlanContext,
  "awsf.design-plan-output/v1": validDesignPlanOutput,
} as const;

function assertSchemaRejection(schemaId: string, payload: unknown, expectedPath: string): void {
  const result = parseEnvelope(JSON.stringify(payload), schemaId);
  assert.equal(result.valid, false, `${schemaId} accepted invalid payload at ${expectedPath}`);
  if (result.valid) return;
  assert.ok(
    result.violations.some((violation) => violation.path === expectedPath),
    `${schemaId} violation did not name ${expectedPath}: ${JSON.stringify(result.violations)}`,
  );
}

for (const schemaId of DESIGN_ENVELOPE_IDS) {
  test(`${schemaId}: emits its registered JSON Schema and validates its good payload`, () => {
    const emitted = emitEnvelopeJsonSchema(schemaId);
    assert.equal(emitted["$id"], `https://awsf.local/schemas/${schemaId}`);
    assert.equal(emitted["title"], schemaId);

    const result = parseEnvelope(JSON.stringify(GOOD_PAYLOADS[schemaId]()), schemaId);
    assert.equal(result.valid, true);
  });

  test(`${schemaId}: rejects an unknown top-level field`, () => {
    assertSchemaRejection(schemaId, { ...GOOD_PAYLOADS[schemaId](), unexpected: true }, "/unexpected");
  });
}

test("awsf.design-output/v1 rejects unknown fields in every nested object shape", () => {
  const base = validDesignOutput();
  const cases: readonly [string, unknown][] = [
    ["/components/0/unexpected", { ...base, components: [{ ...base.components[0], unexpected: true }] }],
    ["/decisions/0/unexpected", { ...base, decisions: [{ ...base.decisions[0], unexpected: true }] }],
    ["/invariants/0/unexpected", { ...base, invariants: [{ ...base.invariants[0], unexpected: true }] }],
    [
      "/acceptanceCriteria/0/unexpected",
      { ...base, acceptanceCriteria: [{ ...base.acceptanceCriteria[0], unexpected: true }] },
    ],
  ];
  for (const [path, payload] of cases) {
    assertSchemaRejection("awsf.design-output/v1", payload, path);
  }
});

test("awsf.architecture-review-output/v1 rejects an unknown field inside findings[]", () => {
  const base = validArchitectureReviewOutput();
  assertSchemaRejection(
    "awsf.architecture-review-output/v1",
    { ...base, findings: [{ ...base.findings[0], unexpected: true }] },
    "/findings/0/unexpected",
  );
});

test("awsf.plan-context/v1 rejects unknown fields at every nested object depth", () => {
  const base = validPlanContext();
  const cases: readonly [string, unknown][] = [
    ["/identifierSet/unexpected", { ...base, identifierSet: { ...base.identifierSet, unexpected: true } }],
    [
      "/identifierSet/invariants/0/unexpected",
      {
        ...base,
        identifierSet: {
          ...base.identifierSet,
          invariants: [{ ...base.identifierSet.invariants[0], unexpected: true }],
        },
      },
    ],
    [
      "/identifierSet/acceptanceCriteria/0/unexpected",
      {
        ...base,
        identifierSet: {
          ...base.identifierSet,
          acceptanceCriteria: [{ ...base.identifierSet.acceptanceCriteria[0], unexpected: true }],
        },
      },
    ],
    [
      "/nonBlockingFindings/0/unexpected",
      { ...base, nonBlockingFindings: [{ ...base.nonBlockingFindings[0], unexpected: true }] },
    ],
  ];
  for (const [path, payload] of cases) {
    assertSchemaRejection("awsf.plan-context/v1", payload, path);
  }
});

test("awsf.design-plan-output/v1 rejects unknown fields in milestones[], steps[], and risks[]", () => {
  const base = validDesignPlanOutput();
  const cases: readonly [string, unknown][] = [
    ["/milestones/0/unexpected", { ...base, milestones: [{ ...base.milestones[0], unexpected: true }] }],
    ["/steps/0/unexpected", { ...base, steps: [{ ...base.steps[0], unexpected: true }] }],
    ["/risks/0/unexpected", { ...base, risks: [{ ...base.risks[0], unexpected: true }] }],
  ];
  for (const [path, payload] of cases) {
    assertSchemaRejection("awsf.design-plan-output/v1", payload, path);
  }
});

test("awsf.plan-context/v1 pins blockingFindingCount to literal zero", () => {
  assertSchemaRejection(
    "awsf.plan-context/v1",
    { ...validPlanContext(), blockingFindingCount: 1 },
    "/blockingFindingCount",
  );
});

test("awsf.architecture-review-output/v1 requires limitations to name at least one limit", () => {
  assertSchemaRejection(
    "awsf.architecture-review-output/v1",
    { ...validArchitectureReviewOutput(), limitations: [] },
    "/limitations",
  );
});

test("emitAllEnvelopeJsonSchemas includes all five M3 envelope ids", () => {
  const emitted = emitAllEnvelopeJsonSchemas();
  for (const schemaId of MILESTONE_ENVELOPE_IDS) {
    assert.ok(schemaId in emitted, `missing emitted schema ${schemaId}`);
  }
});

test("awsf.design-context/v1 requires at least one absolute machine-local target path", () => {
  const base = validDesignContext();
  assert.equal(parseEnvelope(JSON.stringify(base), "awsf.design-context/v1").valid, true);
  assertSchemaRejection("awsf.design-context/v1", { ...base, targets: [] }, "/targets");
  assertSchemaRejection(
    "awsf.design-context/v1",
    { ...base, targets: [{ ...base.targets[0], path: "relative/repository" }] },
    "/targets/0/path",
  );
  assertSchemaRejection(
    "awsf.design-context/v1",
    { ...base, targets: [{ ...base.targets[0], unexpected: true }] },
    "/targets/0/unexpected",
  );
});
