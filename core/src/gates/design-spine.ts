import type { DesignOutput } from "../contracts/design-output.ts";
import type { DesignPlanOutput } from "../contracts/design-plan-output.ts";
import type { PlanContext } from "../contracts/plan-context.ts";
import {
  ACCEPTANCE_CRITERION_IDENTIFIER_PATTERN,
  DECISION_IDENTIFIER_PATTERN,
  INVARIANT_IDENTIFIER_PATTERN,
  declarationSequenceIssue,
  isPlanIdentifierClaim,
  type DeclarationIdentifierPrefix,
  type PlanSpineDeclaration,
} from "../registry/plan-spine.ts";
import { GateReport } from "./interface.ts";

export interface SpineDeclaredExpectation {
  readonly ownerRecordedRequest: string;
}

interface DeclarationGroup {
  readonly prefix: DeclarationIdentifierPrefix;
  readonly pattern: RegExp;
  readonly declarations: readonly PlanSpineDeclaration[];
}

function listed(values: readonly string[]): string {
  return values.length === 0 ? "none" : values.join(", ");
}

export interface SpineCarriedContext {
  readonly identifierSet: PlanContext["identifierSet"];
}

/**
 * Validate the planner's mapping against the host-carried local spine and the
 * plan stems resolved from the catalog. Qualified references need only that
 * list: no cross-plan identifier allocator or registry exists.
 */
export function spineCarried(
  planEnvelope: DesignPlanOutput,
  context: SpineCarriedContext,
  knownStems: readonly string[],
): GateReport {
  const report = new GateReport("spine_carried");
  const carried = [
    ...context.identifierSet.invariants.map((declaration) => declaration.id),
    ...context.identifierSet.acceptanceCriteria.map((declaration) => declaration.id),
  ];
  const served = planEnvelope.steps.flatMap((step) => step.serves);
  const unserved = carried.filter((identifier) => !served.includes(identifier));
  const qualifiedReferences = served.filter((identifier) =>
    identifier.includes("#") && isPlanIdentifierClaim(identifier),
  );
  const unknown = served.filter((identifier) =>
    !carried.includes(identifier) && !qualifiedReferences.includes(identifier),
  );
  const unresolvedStems = qualifiedReferences.flatMap((identifier) => {
    const separator = identifier.indexOf("#");
    if (separator === -1) return [];
    const stem = identifier.slice(0, separator);
    return knownStems.includes(stem) ? [] : [stem];
  });
  const expectedStepIds = planEnvelope.steps.map((_, index) => `T${String(index + 1).padStart(2, "0")}`);
  const malformedStepIds = planEnvelope.steps
    .map((step, index) => ({ actual: step.id, expected: expectedStepIds[index]! }))
    .filter(({ actual, expected }) => actual !== expected)
    .map(({ actual, expected }) => `${actual} (expected ${expected})`);
  const forwardDependencies = planEnvelope.steps.flatMap((step, index) =>
    step.dependsOn
      .filter((dependency) => !expectedStepIds.slice(0, index).includes(dependency))
      .map((dependency) => `${step.id} depends on ${dependency}`),
  );

  report.check(
    "every carried identifier is served",
    unserved.length === 0,
    unserved.length === 0
      ? `${String(carried.length)} carried identifier(s) served by at least one step`
      : `served by nothing: ${listed(unserved)}`,
  );
  report.check(
    "steps serve only carried local identifiers",
    unknown.length === 0,
    unknown.length === 0
      ? "every bare step identifier is carried by the plan context"
      : `identifier(s) absent from plan context: ${listed(unknown)}`,
  );
  report.check(
    "qualified references resolve to catalog plan stems",
    unresolvedStems.length === 0,
    unresolvedStems.length === 0
      ? "every qualified reference resolves to a catalog plan stem"
      : `unresolvable plan stem(s): ${listed(unresolvedStems)}`,
  );
  report.check(
    "step identifiers are contiguous",
    malformedStepIds.length === 0,
    malformedStepIds.length === 0
      ? `${String(planEnvelope.steps.length)} step id(s), contiguous from T01`
      : `non-contiguous step id(s): ${listed(malformedStepIds)}`,
  );
  report.check(
    "step dependencies point backward",
    forwardDependencies.length === 0,
    forwardDependencies.length === 0
      ? "every dependency points to an earlier step"
      : `dependency/dependencies must point earlier: ${listed(forwardDependencies)}`,
  );
  return report;
}

/** Validate the design's local identifier spine without consulting host state. */
export function spineDeclared(
  design: DesignOutput,
  expectation: SpineDeclaredExpectation,
): GateReport {
  const report = new GateReport("spine_declared");
  const answeredRequest = design.answeredRequest.trim();
  const ownerRecordedRequest = expectation.ownerRecordedRequest.trim();
  const groups: readonly DeclarationGroup[] = [
    {
      prefix: "INV",
      pattern: INVARIANT_IDENTIFIER_PATTERN,
      declarations: design.invariants,
    },
    {
      prefix: "AC",
      pattern: ACCEPTANCE_CRITERION_IDENTIFIER_PATTERN,
      declarations: design.acceptanceCriteria,
    },
    {
      prefix: "D",
      pattern: DECISION_IDENTIFIER_PATTERN,
      declarations: design.decisions,
    },
  ];
  const declarations = groups.flatMap((group) => group.declarations);

  report.check(
    "answered request matches owner request",
    answeredRequest === ownerRecordedRequest,
    `owner-recorded=${JSON.stringify(ownerRecordedRequest)}; answered=${JSON.stringify(answeredRequest)}`,
  );

  const malformed = groups.flatMap((group) =>
    group.declarations
      .filter((declaration) => !group.pattern.test(declaration.id))
      .map((declaration) => declaration.id),
  );
  report.check(
    "declaration identifier grammar",
    malformed.length === 0,
    malformed.length === 0
      ? `${String(declarations.length)} declaration identifier(s) match their class grammar`
      : `invalid declaration identifier(s): ${listed(malformed)}`,
  );

  const qualified = declarations
    .map((declaration) => declaration.id)
    .filter((identifier) => identifier.includes("#"));
  report.check(
    "declarations are local identifiers",
    qualified.length === 0,
    qualified.length === 0
      ? "no declaration is qualified by a plan stem"
      : `qualified declaration(s) are forbidden: ${listed(qualified)}`,
  );

  for (const group of groups) {
    const issue = declarationSequenceIssue(group.declarations, group.prefix);
    report.check(
      `${group.prefix} identifiers contiguous and unique`,
      issue === undefined,
      issue === undefined
        ? `${String(group.declarations.length)} ${group.prefix} declaration(s), contiguous from ${group.prefix}-1 with no duplicates`
        : `${issue.identifier}: ${issue.reason}`,
    );
  }

  const blankStatements = declarations
    .filter((declaration) => declaration.statement.trim().length === 0)
    .map((declaration) => declaration.id);
  report.check(
    "declaration statements non-empty",
    blankStatements.length === 0,
    blankStatements.length === 0
      ? `${String(declarations.length)} declaration statement(s) are non-empty after trimming`
      : `empty statement on: ${listed(blankStatements)}`,
  );

  report.check(
    "acceptance boundary declared",
    design.acceptanceCriteria.length > 0,
    `${String(design.acceptanceCriteria.length)} acceptance criterion/criteria declared; at least one is required`,
  );
  return report;
}
