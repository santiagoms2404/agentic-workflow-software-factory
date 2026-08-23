import { test } from "node:test";
import assert from "node:assert/strict";
import type { DesignOutput } from "../../../src/contracts/design-output.ts";
import { spineDeclared } from "../../../src/gates/design-spine.ts";
import { validDesignOutput } from "../contracts/fixtures.ts";

const OWNER_REQUEST = "Make design claims traceable into rendered tickets.";

function reportFor(design: DesignOutput) {
  return spineDeclared(design, { ownerRecordedRequest: OWNER_REQUEST });
}

function failedItems(design: DesignOutput): string[] {
  return reportFor(design).checks
    .filter((check) => !check.ok)
    .map((check) => check.item);
}

test("spine_declared passes a local, contiguous design spine and notes every check", () => {
  const design = validDesignOutput();
  design.answeredRequest = `  ${OWNER_REQUEST}  `;
  const report = reportFor(design);

  assert.equal(report.gateId, "spine_declared");
  assert.equal(report.passed, true);
  assert.equal(report.checks.length, 8);
  assert.ok(report.checks.every((check) => check.note.length > 0));
});

test("an answered-request mismatch reports both values", () => {
  const design = validDesignOutput();
  design.answeredRequest = "Design something else.";
  const check = reportFor(design).checks.find((candidate) =>
    candidate.item.includes("answered request"),
  );

  assert.equal(check?.ok, false);
  assert.match(check?.note ?? "", /owner-recorded="Make design claims traceable/u);
  assert.match(check?.note ?? "", /answered="Design something else\."/u);
});

for (const scenario of [
  {
    name: "INV gap",
    item: "INV identifiers contiguous and unique",
    mutate(design: DesignOutput) {
      design.invariants[0]!.id = "INV-2";
    },
  },
  {
    name: "AC duplicate",
    item: "AC identifiers contiguous and unique",
    mutate(design: DesignOutput) {
      design.acceptanceCriteria.push({ ...design.acceptanceCriteria[0]! });
    },
  },
  {
    name: "D gap",
    item: "D identifiers contiguous and unique",
    mutate(design: DesignOutput) {
      design.decisions[0]!.id = "D-2";
    },
  },
] as const) {
  test(`spine_declared rejects a ${scenario.name}`, () => {
    const design = validDesignOutput();
    scenario.mutate(design);
    assert.ok(failedItems(design).includes(scenario.item));
  });
}

test("spine_declared rejects empty declaration statements after trimming", () => {
  const design = validDesignOutput();
  design.decisions[0]!.statement = " \n ";
  const report = reportFor(design);
  const check = report.checks.find((candidate) =>
    candidate.item === "declaration statements non-empty",
  );

  assert.equal(check?.ok, false);
  assert.match(check?.note ?? "", /D-1/u);
});

test("spine_declared requires at least one acceptance criterion", () => {
  const design = validDesignOutput();
  design.acceptanceCriteria = [];
  assert.ok(failedItems(design).includes("acceptance boundary declared"));
});

test("spine_declared rejects a declaration qualified by a plan stem by name", () => {
  const design = validDesignOutput();
  design.invariants[0]!.id = "other-plan#INV-1";
  const report = reportFor(design);
  const check = report.checks.find((candidate) =>
    candidate.item === "declarations are local identifiers",
  );

  assert.equal(check?.ok, false);
  assert.match(check?.note ?? "", /other-plan#INV-1/u);
  assert.ok(failedItems(design).includes("declaration identifier grammar"));
});
