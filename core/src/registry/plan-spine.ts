export const INVARIANT_IDENTIFIER_PATTERN = /^INV-[1-9][0-9]*$/u;
export const ACCEPTANCE_CRITERION_IDENTIFIER_PATTERN = /^AC-[1-9][0-9]*$/u;
export const DECISION_IDENTIFIER_PATTERN = /^D-[1-9][0-9]*$/u;

export type PlanIdentifierKind = "inv" | "ac";

export interface PlanSpineDeclaration {
  readonly id: string;
  readonly statement: string;
}

export interface PlanIdentifierGrammarIssue {
  readonly identifier: string;
  readonly reason: string;
}

export type SpineCoverageRule = "COVERAGE" | "ORPHANS" | "MIRROR" | "Q5";

export interface SpineCoverageDeclared {
  readonly label: string;
  readonly declarations: readonly PlanSpineDeclaration[];
}

export interface SpineCoveragePlanTask {
  readonly id: string;
  readonly serves: readonly string[];
}

export interface SpineCoverageTicket {
  readonly id: string;
  readonly serves: readonly string[] | undefined;
}

export interface SpineCoverageViolation {
  readonly plan: string;
  readonly identifier: string;
  readonly rule: SpineCoverageRule;
  readonly message: string;
}

export type DeclarationIdentifierPrefix = "INV" | "AC" | "D";

const QUALIFIED_IDENTIFIER_PATTERN = /^[^#\s]+#(?:INV|AC)-[1-9][0-9]*$/u;

/** True only for an unqualified identifier whose prefix matches its declaration class. */
export function isPlanDeclarationIdentifier(identifier: string, kind: PlanIdentifierKind): boolean {
  return kind === "inv"
    ? INVARIANT_IDENTIFIER_PATTERN.test(identifier)
    : ACCEPTANCE_CRITERION_IDENTIFIER_PATTERN.test(identifier);
}

/** Claims may name a local identifier or qualify one with a plan filename stem. */
export function isPlanIdentifierClaim(identifier: string): boolean {
  return INVARIANT_IDENTIFIER_PATTERN.test(identifier)
    || ACCEPTANCE_CRITERION_IDENTIFIER_PATTERN.test(identifier)
    || QUALIFIED_IDENTIFIER_PATTERN.test(identifier);
}

function coverageViolation(
  plan: string,
  identifier: string,
  rule: SpineCoverageRule,
  reason: string,
): SpineCoverageViolation {
  return Object.freeze({
    plan,
    identifier,
    rule,
    message: `${plan}/${identifier}: ${rule} rule broken: ${reason}`,
  });
}

function servedSet(serves: readonly string[]): readonly string[] {
  return [...new Set(serves)].toSorted();
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Decide the four identifier-spine coverage rules from caller-resolved data.
 * Runtime gates and offline fences pass different task shapes through these
 * small interfaces, but neither surface owns a second coverage algorithm.
 */
export function spineCoverage(
  declared: SpineCoverageDeclared,
  planTasks: readonly SpineCoveragePlanTask[],
  tickets: readonly SpineCoverageTicket[] | undefined,
  knownStems: readonly string[],
): readonly SpineCoverageViolation[] {
  const violations: SpineCoverageViolation[] = [];
  const declaredIds = new Set(declared.declarations.map((declaration) => declaration.id));
  const planClaims = planTasks.flatMap((task) => task.serves);
  const knownStemSet = new Set(knownStems);

  for (const declaration of declared.declarations) {
    if (!planClaims.includes(declaration.id)) {
      violations.push(coverageViolation(
        declared.label,
        declaration.id,
        "COVERAGE",
        "the declaration is served by no plan task",
      ));
    }
  }

  const claimViolations = (
    source: "plan task" | "ticket",
    sourceId: string,
    claims: readonly string[],
  ): void => {
    for (const identifier of claims) {
      if (declaredIds.has(identifier)) continue;
      const qualified = QUALIFIED_IDENTIFIER_PATTERN.exec(identifier);
      if (qualified !== null) {
        const stem = identifier.slice(0, identifier.indexOf("#"));
        if (!knownStemSet.has(stem)) {
          violations.push(coverageViolation(
            declared.label,
            identifier,
            "Q5",
            `${source} ${sourceId} names unresolvable plan stem ${stem}`,
          ));
        }
        continue;
      }
      violations.push(coverageViolation(
        declared.label,
        identifier,
        "ORPHANS",
        `${source} ${sourceId} claims an identifier the plan does not declare`,
      ));
    }
  };

  for (const task of planTasks) claimViolations("plan task", task.id, task.serves);
  if (tickets !== undefined) {
    for (const ticket of tickets) claimViolations("ticket", ticket.id, ticket.serves ?? []);

    const tasksById = new Map(planTasks.map((task) => [task.id, task]));
    const ticketsById = new Map(tickets.map((ticket) => [ticket.id, ticket]));
    const ids = [...new Set([...tasksById.keys(), ...ticketsById.keys()])].toSorted();
    for (const id of ids) {
      const task = tasksById.get(id);
      const ticket = ticketsById.get(id);
      const taskServes = servedSet(task?.serves ?? []);
      const ticketServes = servedSet(ticket?.serves ?? []);
      if (task === undefined || ticket === undefined || !sameStrings(taskServes, ticketServes)) {
        violations.push(coverageViolation(
          declared.label,
          id,
          "MIRROR",
          `plan task serves [${taskServes.join(", ")}], ticket serves [${ticketServes.join(", ")}]`,
        ));
      }
    }
  }

  for (const prefix of ["INV", "AC"] as const) {
    const issue = declarationSequenceIssue(declared.declarations, prefix);
    if (issue !== undefined) {
      violations.push(coverageViolation(declared.label, issue.identifier, "Q5", issue.reason));
    }
  }

  return Object.freeze(violations);
}

/** The first uniqueness or contiguity issue for one declaration class. */
export function declarationSequenceIssue(
  declarations: readonly PlanSpineDeclaration[],
  prefix: DeclarationIdentifierPrefix,
): PlanIdentifierGrammarIssue | undefined {
  const identifiers = declarations
    .map((declaration) => declaration.id)
    .filter((identifier) => identifier.startsWith(`${prefix}-`));
  const seen = new Set<string>();

  for (const identifier of identifiers) {
    if (seen.has(identifier)) {
      return { identifier, reason: `${prefix} declarations must be unique` };
    }
    seen.add(identifier);
  }

  const ordered = identifiers.toSorted(
    (left, right) => Number(left.slice(prefix.length + 1)) - Number(right.slice(prefix.length + 1)),
  );
  for (const [index, identifier] of ordered.entries()) {
    const expected = `${prefix}-${index + 1}`;
    if (identifier !== expected) {
      return {
        identifier,
        reason: `${prefix} declarations must be contiguous from ${prefix}-1; expected ${expected}`,
      };
    }
  }
  return undefined;
}

/**
 * Plan declarations of each kind form independently contiguous, unique
 * sequences beginning at 1. The first issue is returned so the parser can name it.
 */
export function planDeclarationSequenceIssue(
  declarations: readonly PlanSpineDeclaration[],
): PlanIdentifierGrammarIssue | undefined {
  for (const prefix of ["INV", "AC"] as const) {
    const issue = declarationSequenceIssue(declarations, prefix);
    if (issue !== undefined) return issue;
  }
  return undefined;
}
