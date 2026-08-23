import { test } from "node:test";
import assert from "node:assert/strict";
import type { DesignOutput } from "../../../src/contracts/design-output.ts";
import type { DesignPlanOutput } from "../../../src/contracts/design-plan-output.ts";
import type { PlanContext } from "../../../src/contracts/plan-context.ts";
import { spineCarried, spineDeclared } from "../../../src/gates/design-spine.ts";
import {
  validDesignOutput,
  validDesignPlanOutput,
  validPlanContext,
} from "../contracts/fixtures.ts";

const OWNER_REQUEST = "Make design claims traceable into rendered tickets.";

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

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

test("spine_declared produces deterministic checks for a frozen design", () => {
  const design = freeze(validDesignOutput());

  assert.deepEqual(reportFor(design).checks, reportFor(design).checks);
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

function carriedReport(
  plan: DesignPlanOutput = validDesignPlanOutput(),
  context: PlanContext = validPlanContext(),
  knownStems: readonly string[] = ["current-plan"],
) {
  return spineCarried(plan, context, knownStems);
}

test("spine_carried accepts complete local coverage and resolvable qualified references", () => {
  const plan = validDesignPlanOutput();
  plan.steps[0]!.serves.push("other-plan#INV-1");
  const report = carriedReport(plan, validPlanContext(), ["current-plan", "other-plan"]);

  assert.equal(report.gateId, "spine_carried");
  assert.equal(report.passed, true);
  assert.equal(report.checks.length, 5);
  assert.ok(report.checks.every((check) => check.note.length > 0));
});

test("spine_carried produces deterministic checks for frozen plan inputs", () => {
  const plan = freeze(validDesignPlanOutput());
  const context = freeze(validPlanContext());
  const stems = freeze(["current-plan"]);

  assert.deepEqual(carriedReport(plan, context, stems).checks, carriedReport(plan, context, stems).checks);
});

test("spine_carried names context identifiers served by nothing", () => {
  const context = validPlanContext();
  context.identifierSet.acceptanceCriteria.push({
    id: "AC-2",
    statement: "A dropped claim is reported.",
    verifiedBy: "Run the gate.",
  });
  const report = carriedReport(validDesignPlanOutput(), context);
  const check = report.checks.find((candidate) => candidate.item === "every carried identifier is served");

  assert.equal(check?.ok, false);
  assert.match(check?.note ?? "", /AC-2/u);
});

test("spine_carried rejects bare identifiers absent from the plan context", () => {
  const plan = validDesignPlanOutput();
  plan.steps[0]!.serves.push("AC-2");
  const report = carriedReport(plan);
  const check = report.checks.find((candidate) => candidate.item === "steps serve only carried local identifiers");

  assert.equal(check?.ok, false);
  assert.match(check?.note ?? "", /AC-2/u);
});

test("spine_carried names an unresolvable qualified plan stem", () => {
  const plan = validDesignPlanOutput();
  plan.steps[0]!.serves.push("no-such-plan#INV-1");
  const report = carriedReport(plan);
  const check = report.checks.find((candidate) => candidate.item === "qualified references resolve to catalog plan stems");

  assert.equal(check?.ok, false);
  assert.match(check?.note ?? "", /no-such-plan/u);
});

test("spine_carried rejects non-contiguous step identifiers", () => {
  const plan = validDesignPlanOutput();
  plan.steps.push({ ...plan.steps[0]!, id: "T03", dependsOn: ["T01"] });
  const report = carriedReport(plan);
  const check = report.checks.find((candidate) => candidate.item === "step identifiers are contiguous");

  assert.equal(check?.ok, false);
  assert.match(check?.note ?? "", /T03/u);
  assert.match(check?.note ?? "", /T02/u);
});

test("spine_carried rejects dependencies that do not point to earlier steps", () => {
  const plan = validDesignPlanOutput();
  plan.steps.push({ ...plan.steps[0]!, id: "T02", dependsOn: ["T02"] });
  const report = carriedReport(plan);
  const check = report.checks.find((candidate) => candidate.item === "step dependencies point backward");

  assert.equal(check?.ok, false);
  assert.match(check?.note ?? "", /T02 depends on T02/u);
});
