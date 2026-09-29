// A question set: everything AWSF asks Jev about one kind of moment, in one
// file (W19 DD2, INV-2). The questions, the thresholds that read the answers,
// and the pure policy that turns typed answers into a typed result live
// together, versioned, so a changed question is a new version and every
// decision record names exactly which one it asked.
//
// Jev supplies facts; code decides. A set's questions ask for judgment only:
// no arithmetic, dates or counts. Those stay in the policy, which is ordinary
// code over the answers and the caller's parameters.

import { validateJevQuestions, type JevAnswer, type JevQuestions } from "./jev-transport.ts";

export type Answers = Readonly<Record<string, JevAnswer>>;
export type Thresholds = Readonly<Record<string, number>>;

export interface QuestionSet<Params, Result, T extends Thresholds = Thresholds> {
  /** Kebab-case. */
  readonly id: string;
  /** A positive integer. A changed question or threshold is a new version. */
  readonly version: number;
  readonly thresholds: T;
  /**
   * The questions for one call. A function because a set can depend on the
   * caller's parameters: `stop-judgment`'s `next_act` offers the acts a stop
   * allows. It must be pure; the same parameters always build the same questions.
   */
  readonly questions: (params: Params) => JevQuestions;
  /** Parameters the registry builds the questions from, to validate the set when it is registered (T01 C2). */
  readonly sampleParams: Params;
  /** Pure: typed answers (already contract-valid) and the call's parameters to a typed result. */
  readonly policy: (answers: Answers, thresholds: T, params: Params) => Result;
}

/** Any question set, for storage in a registry. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyQuestionSet = QuestionSet<any, unknown, any>;

const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export class QuestionSetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestionSetError";
  }
}

export function questionSetRef(set: Pick<AnyQuestionSet, "id" | "version">): string {
  return `${set.id}@${String(set.version)}`;
}

/** Throws QuestionSetError for a bad id, version or threshold, and QuestionValidationError for a bad question. */
export function assertQuestionSet(set: AnyQuestionSet): void {
  if (typeof set.id !== "string" || !KEBAB.test(set.id)) {
    throw new QuestionSetError(`question set id ${JSON.stringify(set.id)} must be kebab-case`);
  }
  if (!Number.isSafeInteger(set.version) || set.version < 1) {
    throw new QuestionSetError(`question set ${set.id} version must be a positive integer; got ${String(set.version)}`);
  }
  for (const [name, value] of Object.entries(set.thresholds)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new QuestionSetError(`question set ${questionSetRef(set)} threshold ${name} must be a finite number`);
    }
  }
  validateJevQuestions(set.questions(set.sampleParams));
}

/** Question sets by id@version. Refuses a duplicate: a version, once registered, means one thing. */
export class QuestionSetRegistry {
  readonly #sets = new Map<string, AnyQuestionSet>();

  register<S extends AnyQuestionSet>(set: S): S {
    assertQuestionSet(set);
    const ref = questionSetRef(set);
    if (this.#sets.has(ref)) throw new QuestionSetError(`question set ${ref} is already registered`);
    this.#sets.set(ref, set);
    return set;
  }

  get(id: string, version: number): AnyQuestionSet | undefined {
    return this.#sets.get(`${id}@${String(version)}`);
  }

  has(id: string, version: number): boolean {
    return this.#sets.has(`${id}@${String(version)}`);
  }

  /** Every registered id@version, sorted. */
  refs(): readonly string[] {
    return [...this.#sets.keys()].sort();
  }
}
