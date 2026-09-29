// stop-judgment v1: what Jev is asked when a run stops (W19 task 2).
//
// The questions the owner's 2026-09-28 smoke call asked: is the run
// progressing, which act fits this stop, and how risky is acting now. The
// smoke answer (next_act `raise` at 0.75, confidence 0.68, progressing 0.81)
// is this set's fixture of a correct "wait": the confidence bar is 0.85.
//
// The policy reads only the answers and the acts the caller allowed. It never
// acts; a Delegate policy (task 5) takes this result as one input among host
// facts, and its own numbers decide first.

import type { ChoiceAnswer, JevQuestions, NoulAnswer } from "../jev-transport.ts";
import type { Answers, QuestionSet } from "../question-set.ts";

export const STOP_JUDGMENT_ID = "stop-judgment";
export const STOP_JUDGMENT_VERSION = 1;

/** Offered at every stop so the choice is never empty (T01 C2). */
export const WAIT_FOR_OWNER = "wait_for_owner";
export const OTHER = "other";

export const STOP_JUDGMENT_THRESHOLDS = Object.freeze({
  /** Below this `progressing` noul, the stop waits for the owner. */
  progressingMin: 0.7,
  /** Below this `next_act` confidence, the pick is not trusted and the stop waits. */
  nextActConfidenceMin: 0.85,
});
export type StopJudgmentThresholds = typeof STOP_JUDGMENT_THRESHOLDS;

export interface StopJudgmentParams {
  /** The acts the caller allows at this stop, in its preferred order. Offered besides wait_for_owner and other. */
  readonly allowedActs: readonly string[];
}

export type StopJudgmentWaitReason = "not-progressing" | "low-confidence" | "chose-wait" | "chose-other" | "act-not-allowed";

export type StopJudgmentResult =
  | { readonly kind: "act"; readonly act: string; readonly confidence: number }
  | { readonly kind: "wait"; readonly reason: StopJudgmentWaitReason };

const RISK_LEVELS = [
  "Low: acting now cannot lose work or spend beyond what the stop already allows.",
  "Medium: acting now could waste calls or time but loses no work.",
  "High: acting now could lose work, spend heavily, or hide a failure from the owner.",
] as const;

function stopJudgmentQuestions(params: StopJudgmentParams): JevQuestions {
  const criteria: Record<string, string | null> = {};
  for (const act of params.allowedActs) {
    if (act !== WAIT_FOR_OWNER && act !== OTHER) criteria[act] = null;
  }
  criteria[WAIT_FOR_OWNER] = "Leave the stop for the owner to decide.";
  criteria[OTHER] = "None of the offered acts fits this stop.";
  return {
    progressing: {
      type: "noul",
      instructions: "Is the run making progress toward its goal?",
      criteria: {
        true: "Recent phases moved the candidate forward: gates newly pass or findings shrink.",
        false: "The run repeats itself, regresses, or fails the same way again.",
      },
    },
    next_act: {
      type: "choice",
      instructions: "Given this stop and the run's state, which act fits best now?",
      criteria,
    },
    risk: { type: "score", instructions: "How risky is taking the chosen act now?", criteria: [...RISK_LEVELS] },
  };
}

function stopJudgmentPolicy(
  answers: Answers,
  thresholds: StopJudgmentThresholds,
  params: StopJudgmentParams,
): StopJudgmentResult {
  // The transport's strict validation guarantees every declared answer with its type.
  const progressing = answers.progressing as NoulAnswer;
  const nextAct = answers.next_act as ChoiceAnswer;
  if (progressing.noul < thresholds.progressingMin) return { kind: "wait", reason: "not-progressing" };
  if (nextAct.choice === WAIT_FOR_OWNER) return { kind: "wait", reason: "chose-wait" };
  if (nextAct.choice === OTHER) return { kind: "wait", reason: "chose-other" };
  if (!params.allowedActs.includes(nextAct.choice)) return { kind: "wait", reason: "act-not-allowed" };
  if (nextAct.confidence < thresholds.nextActConfidenceMin) return { kind: "wait", reason: "low-confidence" };
  return { kind: "act", act: nextAct.choice, confidence: nextAct.confidence };
}

export const STOP_JUDGMENT: QuestionSet<StopJudgmentParams, StopJudgmentResult, StopJudgmentThresholds> = Object.freeze({
  id: STOP_JUDGMENT_ID,
  version: STOP_JUDGMENT_VERSION,
  thresholds: STOP_JUDGMENT_THRESHOLDS,
  questions: stopJudgmentQuestions,
  sampleParams: Object.freeze({ allowedActs: Object.freeze([]) }),
  policy: stopJudgmentPolicy,
});
