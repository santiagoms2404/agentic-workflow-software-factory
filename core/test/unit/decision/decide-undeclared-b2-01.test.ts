// B2-01: decide() records the declared questions only. Jev output is
// untrusted: an answered response may carry keys the question set never
// asked. Those are not part of the contract, so they are neither recorded nor
// allowed to stop the record being written (INV-7: one record per call). A
// declared answer of the wrong type breaks the contract and is journaled as a
// contract-error naming the question, never handed to the policy.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { taskRoot } from "../../../src/cli/commands/attempt.ts";
import { decide, type DecideContext } from "../../../src/decision/decide.ts";
import { JEV_DEFAULT_MODEL, type JevAnswered, type JevOutcome } from "../../../src/decision/jev-transport.ts";
import { STOP_JUDGMENT, type StopJudgmentParams } from "../../../src/decision/question-sets/stop-judgment.ts";
import { readTaskDecisions } from "../../../src/persistence/task-decisions.ts";

const PROJECT = "agentic-workflow-software-factory";
const TASK = "undeclared-task";

/** The 2026-09-28 smoke answer: exactly the three declared questions of stop-judgment. */
const DECLARED = {
  progressing: { type: "noul", noul: 0.81 },
  next_act: { type: "choice", choice: "raise", probabilities: { raise: 0.75, cancel: 0, wait_for_owner: 0.2, other: 0.05 }, confidence: 0.68 },
  risk: {
    type: "score", score: 0.97, legend: { "0": "a", "1": "b", "2": "c" },
    probabilities: { "0": 0.3, "1": 0.43, "2": 0.27 }, confidence: 0.4,
  },
} as const;

function answered(answers: Record<string, unknown>): JevOutcome {
  return {
    outcome: "answered",
    answers: answers as JevAnswered["answers"],
    usage: { input_tokens: 670, output_tokens: 88 },
    resolvedModel: "typesafe/jev-1.13-20260917",
    cost: { amount: 0.00002814, source: "reported" },
    responseText: JSON.stringify({ model: "typesafe/jev-1.13-20260917", answers }),
    requestedModel: JEV_DEFAULT_MODEL,
    elapsedMs: 900,
    attempts: 1,
    redacted: false,
    requestText: "{}",
  };
}

async function run(outcome: JevOutcome) {
  const root = mkdtempSync(join(tmpdir(), "awsf-decide-b2-01-"));
  const stateRoot = join(root, "state");
  const context: DecideContext<StopJudgmentParams> = {
    transport: { ask: async () => outcome },
    taskRoot: taskRoot(stateRoot, PROJECT, TASK), project: PROJECT, taskId: TASK, attempt: 1,
    caller: { kind: "stop", name: "ceiling-pause" }, params: { allowedActs: ["raise", "cancel"] },
    now: () => "2026-09-29T10:00:00.000Z", newId: () => "decision-b2-01",
  };
  try {
    const decision = await decide(STOP_JUDGMENT, { stop: "ceiling" }, context);
    const records = await readTaskDecisions(context.taskRoot);
    return { decision, records };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("undeclared keys in an answered response do not throw; the record is written and holds none of them", async () => {
  for (const extra of [null, "junk", { type: "noul", noul: 0.5 }]) {
    let ran: Awaited<ReturnType<typeof run>> | undefined;
    await assert.doesNotReject(async () => { ran = await run(answered({ ...DECLARED, extra })); }, `extra: ${JSON.stringify(extra)}`);
    const { decision, records } = ran!;
    assert.equal(decision.outcome, "answered", `extra: ${JSON.stringify(extra)}`);
    assert.equal(records.length, 1, `one record is written with extra: ${JSON.stringify(extra)}`);
    assert.deepEqual(Object.keys(records[0]!.answers ?? {}), ["progressing", "next_act", "risk"]);
    assert.deepEqual(Object.keys(decision.answers ?? {}), ["progressing", "next_act", "risk"], "the policy sees declared answers only");
    assert.deepEqual(decision.policyResult, { kind: "wait", reason: "low-confidence" });
  }
});

test("a declared answer of the wrong type is refused as a contract-error naming the question, and still journaled", async () => {
  const { decision, records } = await run(answered({
    ...DECLARED,
    progressing: { type: "score", score: 1, legend: { "0": "a", "1": "b" }, probabilities: { "0": 0.5, "1": 0.5 }, confidence: 0.5 },
  }));
  assert.deepEqual([decision.outcome, decision.answers, decision.policyResult], ["contract-error", null, null]);
  assert.equal(records.length, 1);
  assert.equal(records[0]!.outcome, "contract-error");
  assert.equal(records[0]!.detail, "Missing or mismatched answer: progressing");
  assert.equal(records[0]!.answers, null);

  const missing = await run(answered({ progressing: DECLARED.progressing, risk: DECLARED.risk, next_act: null }));
  assert.equal(missing.decision.outcome, "contract-error");
  assert.equal(missing.records[0]!.detail, "Missing or mismatched answer: next_act");
});

test("a valid set of declared answers is recorded unchanged", async () => {
  const { decision, records } = await run(answered({ ...DECLARED }));
  assert.equal(decision.outcome, "answered");
  assert.deepEqual(records[0]!.answers, DECLARED);
  assert.deepEqual(decision.answers, DECLARED);
});
