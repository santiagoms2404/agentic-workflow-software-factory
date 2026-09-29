// Versioned question sets (W19 task 2, DD2): a registry that refuses a
// duplicate id@version and a malformed set, and stop-judgment v1's pure policy,
// with the 2026-09-28 smoke answer as its fixture of a correct "wait".

import assert from "node:assert/strict";
import { test } from "node:test";
import { QuestionValidationError, validateJevQuestions, type JevAnswer } from "../../../src/decision/jev-transport.ts";
import {
  QuestionSetError,
  QuestionSetRegistry,
  questionSetRef,
  type Answers,
  type QuestionSet,
} from "../../../src/decision/question-set.ts";
import {
  OTHER,
  STOP_JUDGMENT,
  STOP_JUDGMENT_THRESHOLDS,
  WAIT_FOR_OWNER,
  type StopJudgmentParams,
} from "../../../src/decision/question-sets/stop-judgment.ts";

/** The 2026-09-28 smoke answer: raise at 0.75 with confidence 0.68, progressing 0.81, risk 0.97 of 2. */
const SMOKE_ANSWERS: Answers = Object.freeze({
  progressing: { type: "noul", noul: 0.81 },
  next_act: { type: "choice", choice: "raise", probabilities: { raise: 0.75, wait_for_owner: 0.2, other: 0.05 }, confidence: 0.68 },
  risk: {
    type: "score", score: 0.97, legend: { "0": "low", "1": "medium", "2": "high" },
    probabilities: { "0": 0.3, "1": 0.43, "2": 0.27 }, confidence: 0.4,
  },
} satisfies Record<string, JevAnswer>);

const CEILING_STOP: StopJudgmentParams = { allowedActs: ["raise", "cancel"] };

function simpleSet(overrides: Partial<QuestionSet<null, boolean>> = {}): QuestionSet<null, boolean> {
  return {
    id: "file-judgment",
    version: 1,
    thresholds: { min: 0.5 },
    questions: () => ({ ok: { type: "noul", instructions: "Is this file fine?" } }),
    sampleParams: null,
    policy: (answers, thresholds) => (answers.ok as { noul: number }).noul >= thresholds.min!,
    ...overrides,
  };
}

test("a registry registers a set, finds it by id@version, and refuses a duplicate id@version", () => {
  const registry = new QuestionSetRegistry();
  const v1 = registry.register(simpleSet());
  assert.equal(questionSetRef(v1), "file-judgment@1");
  assert.equal(registry.get("file-judgment", 1), v1);
  assert.equal(registry.get("file-judgment", 2), undefined);
  assert.throws(() => registry.register(simpleSet()), (error: unknown) =>
    error instanceof QuestionSetError && /file-judgment@1 is already registered/.test(error.message));
  // A new version of the same id is a different set.
  registry.register(simpleSet({ version: 2 }));
  registry.register(STOP_JUDGMENT);
  assert.deepEqual(registry.refs(), ["file-judgment@1", "file-judgment@2", "stop-judgment@1"]);
});

test("a registry refuses a non-kebab id, a non-integer version, a non-finite threshold and a malformed question", () => {
  const registry = new QuestionSetRegistry();
  for (const id of ["File-Judgment", "file_judgment", "file-", "", "-file"]) {
    assert.throws(() => registry.register(simpleSet({ id })), QuestionSetError, id);
  }
  for (const version of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => registry.register(simpleSet({ version })), QuestionSetError, String(version));
  }
  assert.throws(() => registry.register(simpleSet({ thresholds: { min: Number.POSITIVE_INFINITY } })), QuestionSetError);
  // T01 C2: a malformed set is a code defect, caught when it is registered, not when it is asked.
  assert.throws(
    () => registry.register(simpleSet({ questions: () => ({ level: { type: "score", instructions: "x", criteria: ["only one"] } }) })),
    QuestionValidationError,
  );
  assert.deepEqual(registry.refs(), []);
});

test("stop-judgment v1 asks progressing, next_act and risk, and always offers wait_for_owner and other", () => {
  assert.equal(questionSetRef(STOP_JUDGMENT), "stop-judgment@1");
  const questions = STOP_JUDGMENT.questions(CEILING_STOP);
  validateJevQuestions(questions);
  assert.deepEqual(Object.keys(questions), ["progressing", "next_act", "risk"]);
  assert.equal(questions.progressing?.type, "noul");
  assert.equal(questions.risk?.type, "score");
  assert.equal(questions.risk?.type === "score" ? questions.risk.criteria.length : 0, 3);
  const nextAct = questions.next_act;
  assert.ok(nextAct?.type === "choice");
  assert.deepEqual(Object.keys(nextAct.criteria), ["raise", "cancel", WAIT_FOR_OWNER, OTHER]);
  // A stop that allows nothing still has a nonempty choice, and a caller naming the reserved options does not duplicate them.
  const none = STOP_JUDGMENT.questions({ allowedActs: [] }).next_act;
  assert.ok(none?.type === "choice");
  assert.deepEqual(Object.keys(none.criteria), [WAIT_FOR_OWNER, OTHER]);
  const named = STOP_JUDGMENT.questions({ allowedActs: [OTHER, "resume", WAIT_FOR_OWNER] }).next_act;
  assert.ok(named?.type === "choice");
  assert.deepEqual(Object.keys(named.criteria), ["resume", WAIT_FOR_OWNER, OTHER]);
});

test("the smoke call's answer is a correct wait: raise at confidence 0.68 is under the 0.85 bar", () => {
  assert.equal(STOP_JUDGMENT_THRESHOLDS.nextActConfidenceMin, 0.85);
  assert.deepEqual(STOP_JUDGMENT.policy(SMOKE_ANSWERS, STOP_JUDGMENT.thresholds, CEILING_STOP), { kind: "wait", reason: "low-confidence" });
});

test("stop-judgment's policy: numbers from code decide every wait, and a confident allowed pick is an act", () => {
  const answers = (progressing: number, choice: string, confidence: number): Answers => ({
    ...SMOKE_ANSWERS,
    progressing: { type: "noul", noul: progressing },
    next_act: { type: "choice", choice, probabilities: { raise: 1, wait_for_owner: 0, other: 0 }, confidence },
  });
  const policy = (a: Answers, params = CEILING_STOP) => STOP_JUDGMENT.policy(a, STOP_JUDGMENT.thresholds, params);
  assert.deepEqual(policy(answers(0.9, "raise", 0.9)), { kind: "act", act: "raise", confidence: 0.9 });
  assert.deepEqual(policy(answers(0.7, "raise", 0.85)), { kind: "act", act: "raise", confidence: 0.85 }, "both bars are inclusive");
  assert.deepEqual(policy(answers(0.69, "raise", 0.99)), { kind: "wait", reason: "not-progressing" });
  assert.deepEqual(policy(answers(0.9, WAIT_FOR_OWNER, 0.99)), { kind: "wait", reason: "chose-wait" });
  assert.deepEqual(policy(answers(0.9, OTHER, 0.99)), { kind: "wait", reason: "chose-other" });
  assert.deepEqual(policy(answers(0.9, "raise", 0.99), { allowedActs: ["cancel"] }), { kind: "wait", reason: "act-not-allowed" });
});
