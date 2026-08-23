import type { DesignOutput } from "../contracts/design-output.ts";
import {
  ACCEPTANCE_CRITERION_IDENTIFIER_PATTERN,
  DECISION_IDENTIFIER_PATTERN,
  INVARIANT_IDENTIFIER_PATTERN,
  declarationSequenceIssue,
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
