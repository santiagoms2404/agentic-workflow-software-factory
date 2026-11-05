import { decide } from "../decision/decide.ts";
import { QuestionValidationError, type JevOutcome, type JevTransport } from "../decision/jev-transport.ts";
import { STOP_JUDGMENT } from "../decision/question-sets/stop-judgment.ts";
import type { DecisionRecord } from "../contracts/decision-record.ts";
import type { JudgmentInput } from "./policy.ts";
import type { StopFacts } from "./stop-facts.ts";

export interface StopJudgeOptions {
  readonly transport: Pick<JevTransport, "ask">;
  readonly taskRoot: string;
  readonly caller: "stop" | "replay";
  readonly allowedActs: readonly string[];
  readonly projectDecision?: (record: DecisionRecord) => void;
  readonly now?: () => string;
  readonly newId?: () => string;
}

/** Shared stop-judgment adapter: transport throws become typed unavailable, while validation and persistence errors propagate. */
export async function judgeStop(facts: StopFacts, options: StopJudgeOptions): Promise<{
  readonly judgment: JudgmentInput;
  readonly decision: { readonly recordId: string; readonly outcome: JevOutcome["outcome"] };
}> {
  const transport: Pick<JevTransport, "ask"> = {
    ask: async (state, questions, askOptions) => {
      try {
        return await options.transport.ask(state, questions, askOptions);
      } catch (error) {
        if (error instanceof QuestionValidationError) throw error;
        return { outcome: "unavailable", reason: "network", detail: "decision transport failed" };
      }
    },
  };
  const decided = await decide(STOP_JUDGMENT, { stop: facts }, {
    transport,
    taskRoot: options.taskRoot,
    project: facts.project,
    taskId: facts.task,
    attempt: facts.attempt,
    caller: { kind: options.caller, name: facts.stopKind },
    params: { allowedActs: options.allowedActs },
    ...(options.projectDecision === undefined ? {} : { projectDecision: options.projectDecision }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.newId === undefined ? {} : { newId: options.newId }),
  });
  return {
    judgment: { outcome: decided.outcome, result: decided.policyResult },
    decision: { recordId: decided.recordId, outcome: decided.outcome },
  };
}
