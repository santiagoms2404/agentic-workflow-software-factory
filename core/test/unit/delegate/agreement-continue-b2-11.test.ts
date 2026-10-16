// B2-11 (M9): a Delegate "continue" can be earned. W19 task 6 decision (2)
// keeps resume-activation as resume, and task 15 makes a continuation a new
// task: the source attempt is cancelled and a follow-up task records
// `continuesTask`. So a cancel on T counts as the owner's continue only when
// another task in the same store continues T.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AttemptEvent, AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import type { AttemptEvidence } from "../../../src/observability/attempt-evidence.ts";
import { Journal, type JournalRecord } from "../../../src/persistence/journal.ts";
import { journalFilePath, statusFilePath } from "../../../src/persistence/platform-paths.ts";
import { appendTaskDelegateProposal } from "../../../src/persistence/task-delegate.ts";
import { actOf, pairAttempt, pairTask, type PairableProposal } from "../../../src/delegate/agreement.ts";
import { readLivePairs, taskAttemptDir } from "../../../src/delegate/pairs.ts";
import type { DelegateProposalRecord } from "../../../src/delegate/proposal.ts";
import type { ProposedActName } from "../../../src/delegate/policy.ts";

function journal(entries: readonly (AttemptEvidence | null)[]): JournalRecord<AttemptEvent>[] {
  return entries.map((evidence, index) => ({
    source_seq: index + 1,
    recorded_at: `2026-09-29T09:${String(index).padStart(2, "0")}:00Z`,
    event: {
      kind: "attempt.updated",
      next: { sessionId: "s-1", revision: index + 1 } as unknown as AttemptStatus,
      ...(evidence === null ? {} : { evidence }),
    },
  }));
}

const CANCEL: AttemptEvidence = {
  type: "transition", id: "t-L22", seq: 1, from: "AWAITING_OWNER", to: "CANCELLED", actor: "owner", edgeId: "L22",
  reasonSource: "gate", reasonCode: null, reasonDetail: null, spawnSite: false, at: "t",
};

function proposal(act: ProposedActName, taskId = "task-1"): PairableProposal {
  return { id: "1", taskId, attempt: 1, sessionId: "s-1", statusRevision: 1, at: "2026-09-29T10:00:00Z", proposal: { act: { act } } };
}

test("B2-11: a continue on a cancelled task that another task continues pairs as agreement on continue", () => {
  const [pair] = pairAttempt([proposal("continue")], journal([null, CANCEL]), "live",
    [{ taskId: "task-1", continuesTask: null }, { taskId: "task-2", continuesTask: "task-1" }]);
  assert.deepEqual([pair!.observedAct, pair!.observedAtSeq, pair!.outcome], ["continue", 2, "match"]);
});

test("B2-11: a cancelled task with no follow-up still pairs as cancel", () => {
  const cancelled = journal([null, CANCEL]);
  const [continued] = pairAttempt([proposal("continue")], cancelled, "live", [{ taskId: "task-1", continuesTask: null }]);
  assert.deepEqual([continued!.observedAct, continued!.outcome], ["cancel", "mismatch"]);
  const [cancel] = pairAttempt([proposal("cancel")], cancelled, "live");
  assert.deepEqual([cancel!.observedAct, cancel!.outcome], ["cancel", "match"]);
});

test("B2-11: resume-activation evidence still maps to resume only, even with a follow-up task", () => {
  const RESUME = { type: "resume-activation", operationId: "o", checkpointId: "c", reason: "r", reservationId: null, phase: null } as AttemptEvidence;
  const resumed = journal([null, RESUME]);
  assert.equal(actOf(resumed[1]!), "resume");
  const follow = [{ taskId: "task-2", continuesTask: "task-1" }];
  const [continued] = pairAttempt([proposal("continue")], resumed, "live", follow);
  assert.deepEqual([continued!.observedAct, continued!.outcome], ["resume", "mismatch"]);
  const [resume] = pairAttempt([proposal("resume")], resumed, "live", follow);
  assert.deepEqual([resume!.observedAct, resume!.outcome], ["resume", "match"]);
});

test("B2-11: a follow-up of a different task, or a task naming itself, does not count", () => {
  const cancelled = journal([null, CANCEL]);
  const [other] = pairAttempt([proposal("continue")], cancelled, "live", [{ taskId: "task-2", continuesTask: "task-9" }]);
  assert.deepEqual([other!.observedAct, other!.outcome], ["cancel", "mismatch"]);
  const [self] = pairAttempt([proposal("continue")], cancelled, "live", [{ taskId: "task-1", continuesTask: "task-1" }]);
  assert.deepEqual([self!.observedAct, self!.outcome], ["cancel", "mismatch"]);
  // pairTask hands the same continuations to every attempt it pairs.
  const [viaTask] = pairTask([proposal("continue")], () => cancelled, "replay", [{ taskId: "task-3", continuesTask: "task-1" }]);
  assert.deepEqual([viaTask!.observedAct, viaTask!.outcome, viaTask!.source], ["continue", "match", "replay"]);
});

test("B2-11: readLivePairs reads the sibling task's continuesTask from its status", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-agreement-continue-"));
  try {
    const tasks = join(root, "projects", "awsf", "tasks");
    const taskRoot = join(tasks, "task-1");
    mkdirSync(taskAttemptDir(taskRoot, 1), { recursive: true });
    const log = new Journal<AttemptEvent>(journalFilePath(taskAttemptDir(taskRoot, 1)));
    for (const record of journal([null, CANCEL])) await log.append(record.event);
    await log.close();
    const record: DelegateProposalRecord = {
      schema: "awsf.delegate-proposal/v1", type: "delegate.proposal", id: "1", project: "awsf", taskId: "task-1", attempt: 1,
      sessionId: "s-1", statusRevision: 1, at: "2026-09-29T10:01:00Z", stopKind: "ticket-block", edge: null, checkpointId: "cp",
      leased: false, decision: { recordId: null, outcome: "unavailable" },
      proposal: { act: { act: "continue" }, rationale: "jev-picked", executable: true },
      allowedActs: ["continue", "cancel"], facts: {} as DelegateProposalRecord["facts"],
    } as unknown as DelegateProposalRecord;
    await appendTaskDelegateProposal(taskRoot, record);
    const status = (taskId: string, continuesTask: string | null): void => {
      const dir = taskAttemptDir(join(tasks, taskId), 1);
      mkdirSync(dir, { recursive: true });
      writeFileSync(statusFilePath(dir), JSON.stringify({ taskId, continuesTask, budget: { allowance: { auto: 0, owner: 0 } } }));
    };
    status("task-unrelated", "task-7");
    assert.deepEqual((await readLivePairs(taskRoot)).map((entry) => [entry.observedAct, entry.outcome]), [["cancel", "mismatch"]]);
    status("task-2", "task-1");
    assert.deepEqual((await readLivePairs(taskRoot)).map((entry) => [entry.observedAct, entry.outcome]), [["continue", "match"]]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
