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
