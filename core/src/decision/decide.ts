// decide(): one Jev call, one journaled record (W19 task 2, DD3, INV-2, INV-7).
//
// Asks the transport the set's questions, applies the set's pure policy to an
// answer, appends one awsf.decision/v1 record to the task's decisions.jsonl
// through Journal, and returns the outcome. An unavailable, refused or
// contract-breaking call returns its outcome with no policy result: the
// caller's own fallback applies. Nothing here moves lifecycle state, and no
// outcome is ever a BLOCKED reason (INV-2).

import { randomUUID } from "node:crypto";
import {
  assertDecisionRecord,
  decisionBodies,
  DECISION_RECORD_SCHEMA_ID,
  type DecisionCaller,
  type DecisionRecord,
} from "../contracts/decision-record.ts";
import { appendTaskDecision } from "../persistence/task-decisions.ts";
import { scrubCredentialString, scrubJsonText } from "../policy/redaction.ts";
import {
  ContractError,
  JEV_DEFAULT_MODEL,
  type JevAnswer,
  type JevOutcome,
  type JevQuestions,
  type JevState,
  type JevTransport,
} from "./jev-transport.ts";
import type { Answers, QuestionSet, Thresholds } from "./question-set.ts";

export interface DecideContext<Params> {
  /** The host's one transport per process (T01 C3); tests stub it. */
  readonly transport: Pick<JevTransport, "ask">;
  /** `<state-root>/projects/<project>/tasks/<task>`: where decisions.jsonl lives. */
  readonly taskRoot: string;
  readonly project: string;
  readonly taskId: string;
  /** The attempt the call is for, or null for a task-level call. */
  readonly attempt: number | null;
  readonly caller: DecisionCaller;
  readonly params: Params;
  /** Pin a model for this call; otherwise the transport's own. Recorded as requested. */
  readonly model?: string;
  readonly signal?: AbortSignal;
  /** Projects the durable record, e.g. a DashboardProjection. Never throws into decide(). */
  readonly projectDecision?: (record: DecisionRecord) => void;
  readonly now?: () => string;
  readonly newId?: () => string;
}

export interface Decision<Result> {
  readonly outcome: JevOutcome["outcome"];
  /** Present only when answered. */
  readonly answers: Answers | null;
  /** The set's policy over the answers; null unless answered. */
  readonly policyResult: Result | null;
  readonly recordId: string;
  readonly record: DecisionRecord;
}

export async function decide<Params, Result, T extends Thresholds>(
  questionSet: QuestionSet<Params, Result, T>,
  state: JevState,
  context: DecideContext<Params>,
): Promise<Decision<Result>> {
  const questions = questionSet.questions(context.params);
  const askOptions = {
    ...(context.model === undefined ? {} : { model: context.model }),
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  };
  // Throws QuestionValidationError for a request that could never be valid (T01 C2): a code defect, not an outcome.
  const result = declaredOnly(questions, await context.transport.ask(state, questions, askOptions));

  const record = toRecord(questionSet, context, result);
  assertDecisionRecord(record);
  await appendTaskDecision(context.taskRoot, record);
  try {
    context.projectDecision?.(record);
  } catch {
    // Durable first, projected second: the record is in the task's file, and a rebuild places it.
  }

  if (result.outcome !== "answered") {
    return { outcome: result.outcome, answers: null, policyResult: null, recordId: record.id, record };
  }
  const policyResult = questionSet.policy(result.answers, questionSet.thresholds, context.params);
  return { outcome: "answered", answers: result.answers, policyResult, recordId: record.id, record };
}

/**
 * An answered outcome narrowed to the declared questions (B2-01). Jev output
 * is untrusted and the transport passes the provider's answers object through
 * as it came: it validates the declared ids and ignores the rest. So the
 * declared questions are walked here, never the answers' own keys; an
 * undeclared key is not part of the contract, is neither recorded nor shown
 * to the policy, and cannot stop the record being written (INV-7). A declared
 * answer that is missing or of another type breaks the contract: it becomes a
 * contract-error outcome naming the question, journaled like any other.
 */
function declaredOnly(questions: JevQuestions, result: JevOutcome): JevOutcome {
  if (result.outcome !== "answered") return result;
  const answers: Record<string, JevAnswer> = {};
  for (const [id, question] of Object.entries(questions)) {
    const answer: unknown = Object.hasOwn(result.answers, id) ? result.answers[id] : undefined;
    if (answer === null || typeof answer !== "object" || (answer as { type?: unknown }).type !== question.type) {
      return {
        outcome: "contract-error",
        error: new ContractError(`Missing or mismatched answer: ${id}`),
        responseText: result.responseText,
        requestedModel: result.requestedModel,
        elapsedMs: result.elapsedMs,
        attempts: result.attempts,
        redacted: result.redacted,
        requestText: result.requestText,
      };
    }
    answers[id] = answer as JevAnswer;
  }
  return { ...result, answers };
}

/**
 * The answers exactly as the contract declares them. declaredOnly() already
 * dropped every undeclared key and checked each declared type; anything else
 * the provider added is not part of the contract and is not recorded (the
 * scrubbed response body keeps it, under Q18).
 */
function recordedAnswers(answers: Answers): NonNullable<DecisionRecord["answers"]> {
  const out: NonNullable<DecisionRecord["answers"]> = {};
  for (const [key, answer] of Object.entries(answers)) {
    if (answer.type === "noul") out[key] = { type: "noul", noul: answer.noul };
    else if (answer.type === "choice") {
      out[key] = { type: "choice", choice: answer.choice, probabilities: { ...answer.probabilities }, confidence: answer.confidence };
    } else {
      out[key] = {
        type: "score", score: answer.score, legend: { ...answer.legend },
        probabilities: { ...answer.probabilities }, confidence: answer.confidence,
      };
    }
  }
  return out;
}

function toRecord<Params>(
  questionSet: Pick<QuestionSet<Params, unknown>, "id" | "version">,
  context: DecideContext<Params>,
  result: JevOutcome,
): DecisionRecord {
  const base = {
    schema: DECISION_RECORD_SCHEMA_ID,
    id: (context.newId ?? randomUUID)(),
    project: context.project,
    taskId: context.taskId,
    attempt: context.attempt,
    caller: context.caller,
    questionSet: { id: questionSet.id, version: questionSet.version },
    at: (context.now ?? (() => new Date().toISOString()))(),
  } as const;
  const unknownCost = { amount: null, source: "unknown" } as const;

  switch (result.outcome) {
    case "refused-by-switch":
      // Nothing was built, so nothing was redacted and no body exists (T01 C1).
      return {
        ...base,
        requestedModel: (context.transport as any).model ?? context.model ?? JEV_DEFAULT_MODEL,
        outcome: "refused-by-switch",
        detail: scrubCredentialString(result.detail),
        answers: null,
        usage: null,
        cost: unknownCost,
        elapsedMs: 0,
        attempts: 0,
        redacted: false,
        bodies: decisionBodies(null, null),
      };
    case "unavailable":
      return {
        ...base,
        requestedModel: result.requestedModel ?? context.model ?? JEV_DEFAULT_MODEL,
        outcome: "unavailable",
        reason: result.reason,
        ...(result.status === undefined ? {} : { status: result.status }),
        detail: scrubCredentialString(result.detail),
        answers: null,
        usage: null,
        cost: unknownCost,
        elapsedMs: result.elapsedMs ?? 0,
        attempts: result.attempts ?? 0,
        redacted: result.redacted ?? false,
        bodies: decisionBodies(result.requestText ?? null, null),
      };
    case "contract-error":
      return {
        ...base,
        requestedModel: result.requestedModel,
        outcome: "contract-error",
        detail: scrubCredentialString(result.error.message).slice(0, 2_000),
        answers: null,
        usage: null,
        cost: unknownCost,
        elapsedMs: result.elapsedMs,
        attempts: result.attempts,
        redacted: result.redacted,
        // The provider's raw text is not redacted by the transport (T01 C4).
        bodies: decisionBodies(result.requestText, scrubJsonText(result.responseText)),
      };
    case "answered":
      return {
        ...base,
        requestedModel: result.requestedModel,
        resolvedModel: result.resolvedModel,
        outcome: "answered",
        answers: recordedAnswers(result.answers),
        usage: { input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens },
        cost: result.cost,
        elapsedMs: result.elapsedMs,
        attempts: result.attempts,
        redacted: result.redacted,
        bodies: decisionBodies(result.requestText, scrubJsonText(result.responseText)),
      };
  }
}
