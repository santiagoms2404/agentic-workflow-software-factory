import assert from "node:assert/strict";
import { test } from "node:test";
import type { ArchitectureReviewOutput } from "../../../src/contracts/architecture-review-output.ts";
import type { DesignOutput } from "../../../src/contracts/design-output.ts";
import {
  architectureReviewClear,
  architectureVerdictConsistent,
} from "../../../src/gates/architecture-review.ts";
import {
  validArchitectureReviewOutput,
  validDesignOutput,
  validPlanContext,
} from "../contracts/fixtures.ts";

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function reportFor(
  review: ArchitectureReviewOutput,
  design: DesignOutput = validDesignOutput(),
) {
  return architectureVerdictConsistent(review, design);
}

function failedItems(review: ArchitectureReviewOutput): string[] {
  return reportFor(review).checks
    .filter((check) => !check.ok)
    .map((check) => check.item);
}

test("architecture_verdict_consistent passes a matching review and states its limit", () => {
  const review = freeze(validArchitectureReviewOutput());
  const design = freeze(validDesignOutput());
  const first = architectureVerdictConsistent(review, design);
  const second = architectureVerdictConsistent(review, design);

  assert.equal(first.gateId, "architecture_verdict_consistent");
  assert.equal(first.passed, true);
  assert.equal(first.checks.length, 5);
  assert.ok(first.checks.every((check) => check.note.length > 0));
  assert.match(
    first.checks.find((check) => check.item === "accept has no high/critical findings")?.note ?? "",
    /not the review's thoroughness/u,
  );
  assert.match(
    first.checks.find((check) => check.item === "review limitations declared")?.note ?? "",
    /Did not execute the future renderer\./u,
  );
  assert.deepEqual(first.checks, second.checks);
});

test("reviewedDesign must echo the design summary exactly and reports both values", () => {
  const review = validArchitectureReviewOutput();
  review.reviewedDesign = "A different design summary.";
  const check = reportFor(review).checks.find((candidate) => candidate.item === "reviewed design exact");

  assert.equal(check?.ok, false);
  assert.match(check?.note ?? "", /expected="Designed a typed envelope registry\."/u);
  assert.match(check?.note ?? "", /reviewed="A different design summary\."/u);
});

test("finding subjects resolve to declared identifiers or named components", () => {
  for (const subject of ["INV-1", "AC-1", "D-1", "contract registry"]) {
    const review = validArchitectureReviewOutput();
    review.findings[0]!.subject = subject;
    assert.equal(reportFor(review).passed, true, subject);
  }

  const review = validArchitectureReviewOutput();
  review.findings.push({
    ...review.findings[0]!,
    id: "F2",
    subject: "unknown component",
  });
  const check = reportFor(review).checks.find((candidate) =>
    candidate.item === "finding subjects resolve against the design",
  );
  assert.equal(check?.ok, false);
  assert.match(check?.note ?? "", /unknown component/u);
});

test("accept rejects blocking findings without turning concern into a zero-blocker gate", () => {
  const accept = validArchitectureReviewOutput();
  accept.findings[0]!.severity = "critical";
  assert.ok(failedItems(accept).includes("accept has no high/critical findings"));

  const concern = validArchitectureReviewOutput();
  concern.verdict = "concern";
  concern.findings[0]!.severity = "critical";
  const report = reportFor(concern);
  assert.equal(report.passed, true);
  assert.match(
    report.checks.find((check) => check.item === "accept has no high/critical findings")?.note ?? "",
    /^1 blocking of 1 finding\(s\)/u,
  );
});

test("concern requires one finding with all four concrete fields", () => {
  const review = validArchitectureReviewOutput();
  review.verdict = "concern";
  review.findings[0]!.evidence = " \n ";

  assert.ok(failedItems(review).includes("concern has a concrete finding"));
});

test("limitations must say what the reviewer did not check", () => {
  const review = validArchitectureReviewOutput();
  review.limitations = [" \n "];
  const check = reportFor(review).checks.find((candidate) => candidate.item === "review limitations declared");

  assert.equal(check?.ok, false);
  assert.equal(check?.note, "reviewer declared it did not check: nothing");
});

test("architecture_review_clear passes a clear review with the design's exact identifier set", () => {
  const review = freeze(validArchitectureReviewOutput());
  const design = freeze(validDesignOutput());
  const planContext = freeze(validPlanContext());
  const carried = freeze({ design, planContext: planContext.identifierSet });
  const first = architectureReviewClear(review, carried);
  const second = architectureReviewClear(review, carried);

  assert.equal(first.gateId, "architecture_review_clear");
  assert.equal(first.passed, true);
  assert.equal(first.checks.length, 3);
  assert.ok(first.checks.every((check) => check.note.length > 0));
  assert.match(
    first.checks.find((check) => check.item === "no blocking findings")?.note ?? "",
    /not the review's thoroughness/u,
  );
  assert.deepEqual(first.checks, second.checks);
});

test("architecture_review_clear rejects every blocking severity", () => {
  for (const severity of ["high", "critical"] as const) {
    const review = validArchitectureReviewOutput();
    review.findings[0]!.severity = severity;
    const report = architectureReviewClear(review, {
      design: validDesignOutput(),
      planContext: validPlanContext().identifierSet,
    });

    assert.equal(report.passed, false, severity);
    assert.equal(report.checks.find((check) => check.item === "no blocking findings")?.ok, false);
  }
});

test("architecture_review_clear requires an accept verdict independently of finding count", () => {
  const review = validArchitectureReviewOutput();
  review.verdict = "concern";
  review.findings[0]!.severity = "medium";
  const report = architectureReviewClear(review, {
    design: validDesignOutput(),
    planContext: validPlanContext().identifierSet,
  });

  assert.equal(report.checks.find((check) => check.item === "no blocking findings")?.ok, true);
  assert.equal(report.checks.find((check) => check.item === "review verdict accepts design")?.ok, false);
  assert.equal(report.passed, false);
});

test("architecture_review_clear requires the full carried identifier set to equal the design", () => {
  const cases = [
    {
      name: "changed invariant",
      mutate: (identifierSet: ReturnType<typeof validPlanContext>["identifierSet"]): void => {
        identifierSet.invariants[0]!.statement = "Changed after review.";
      },
    },
    {
      name: "changed acceptance criterion",
      mutate: (identifierSet: ReturnType<typeof validPlanContext>["identifierSet"]): void => {
        identifierSet.acceptanceCriteria[0]!.verifiedBy = "A different observation.";
      },
    },
    {
      name: "extra identifier",
      mutate: (identifierSet: ReturnType<typeof validPlanContext>["identifierSet"]): void => {
        identifierSet.invariants.push({ id: "INV-2", statement: "Not declared by the design." });
      },
    },
  ];

  for (const fixture of cases) {
    const identifierSet = validPlanContext().identifierSet;
    fixture.mutate(identifierSet);
    const report = architectureReviewClear(validArchitectureReviewOutput(), {
      design: validDesignOutput(),
      planContext: identifierSet,
    });
    const check = report.checks.find((candidate) => candidate.item === "carried identifier set equals design");

    assert.equal(check?.ok, false, fixture.name);
    assert.match(check?.note ?? "", /design=.*plan-context=/u, fixture.name);
  }
});
