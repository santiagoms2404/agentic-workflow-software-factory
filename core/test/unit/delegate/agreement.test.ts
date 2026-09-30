// Agreement and earned autonomy (W19 task 6): exact pairing at read time,
// 7 of 8 unlocks and 6 of 8 does not, replay pairs count and are labeled,
// owner-all unlocks and is labeled, and land-shadow never unlocks.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AttemptEvent, AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import type { AttemptEvidence } from "../../../src/observability/attempt-evidence.ts";
import { Journal, type JournalRecord } from "../../../src/persistence/journal.ts";
import { appendTaskDelegateProposal } from "../../../src/persistence/task-delegate.ts";
import { actOf, pairAttempt, pairTask, type Pair, type PairableProposal } from "../../../src/delegate/agreement.ts";
import {
  CODE_DECIDED_ACTS,
  EARN_WINDOW,
  JUDGMENT_ACTS,
  autonomyFor,
  earningWindow,
  type LeaseAutonomy,
} from "../../../src/delegate/autonomy.ts";
import { PROPOSED_ACT_NAMES, type ProposedActName } from "../../../src/delegate/policy.ts";
import { readLivePairs, taskAttemptDir } from "../../../src/delegate/pairs.ts";
import type { DelegateProposalRecord } from "../../../src/delegate/proposal.ts";
import type { TaskState } from "../../../src/state/task-machine.ts";

function next(revision: number): AttemptStatus {
  return { sessionId: "s-1", revision } as unknown as AttemptStatus;
}

/** One journal record per entry; `null` is a record that shows no act (a phase update). */
function journal(entries: readonly (AttemptEvidence | null)[]): JournalRecord<AttemptEvent>[] {
  return entries.map((evidence, index) => ({
    source_seq: index + 1,
    recorded_at: `2026-09-29T09:${String(index).padStart(2, "0")}:00Z`,
    event: { kind: "attempt.updated", next: next(index + 1), ...(evidence === null ? {} : { evidence }) },
  }));
}

function transition(from: TaskState, to: TaskState, edgeId: string, actor: "host" | "owner" | "human" = "human"): AttemptEvidence {
  return { type: "transition", id: `t-${edgeId}`, seq: 1, from, to, actor, edgeId, reasonSource: "gate", reasonCode: null, reasonDetail: null, spawnSite: false, at: "t" };
}
const GRANT: AttemptEvidence = { type: "ceiling-grant", calls: 5, from: 5, to: 10, reason: "why", attempt: 1, at: "t" };
const RESUME = { type: "resume-activation", operationId: "o", checkpointId: "c", reason: "r", reservationId: null, phase: null } as AttemptEvidence;
const DEGRADE: AttemptEvidence = { type: "review-degradation", reason: "why", attempt: 1, at: "t" };

function proposal(id: string, statusRevision: number, act: ProposedActName, at = `2026-09-29T10:${id.padStart(2, "0")}:00Z`): PairableProposal {
  return { id, taskId: "task-1", attempt: 1, sessionId: "s-1", statusRevision, at, proposal: { act: { act } } };
}

test("agreement: the act mapping is closed and exact", () => {
  const [grant, resume, degrade, cancel, rework, replace, land, gating, phase] = journal([
    GRANT, RESUME, DEGRADE, transition("AWAITING_OWNER", "CANCELLED", "L22"), transition("AWAITING_OWNER", "RUNNING", "L19"),
    transition("AWAITING_OWNER", "REVIEWING", "L25", "owner"), transition("AWAITING_OWNER", "LANDING", "L20"), transition("RUNNING", "GATING", "L7", "host"), null,
  ]);
  assert.deepEqual([grant, resume, degrade, cancel, rework, replace, land, gating, phase].map((record) => actOf(record!)),
    ["raise", "resume", "degrade-review", "cancel", "rework", "replacement-review", "land", null, null]);
});

test("agreement: each proposal pairs with the next act after its stop and before the next stop", () => {
  // Stops at revisions 1 and 4; the grant (rev 2) answers the first, the cancel (rev 5) the second.
  const records = journal([null, GRANT, RESUME, null, transition("RUNNING", "CANCELLED", "L9")]);
  const pairs = pairAttempt([proposal("2", 4, "raise"), proposal("1", 1, "raise")], records, "live");
  assert.deepEqual(pairs.map((pair) => [pair.proposalId, pair.observedAct, pair.observedAtSeq, pair.outcome]), [
    ["1", "raise", 2, "match"],
    ["2", "cancel", 5, "mismatch"],
  ]);
});

test("agreement: similar is not equal, silence is none, and wait-for-owner proposes nothing", () => {
  const cancelled = journal([null, transition("RUNNING", "CANCELLED", "L9")]);
  assert.equal(pairAttempt([proposal("1", 1, "wait-until")], cancelled, "live")[0]!.outcome, "mismatch");
  assert.equal(pairAttempt([proposal("1", 1, "wait-for-owner")], cancelled, "live")[0]!.outcome, "none");
  const quiet = journal([null, null, transition("RUNNING", "GATING", "L7", "host")]);
  assert.deepEqual(pairAttempt([proposal("1", 1, "resume")], quiet, "live")[0]!.observedAct, null);
  // A stop the journal never recorded pairs with nothing.
  assert.equal(pairAttempt([proposal("1", 99, "raise")], journal([GRANT]), "live")[0]!.outcome, "none");
  // An act before the next stop is not credited to a later one: the second proposal sees nothing.
  const one = pairAttempt([proposal("1", 1, "raise"), proposal("2", 3, "raise")], journal([null, GRANT, null]), "live");
  assert.deepEqual(one.map((pair) => pair.outcome), ["match", "none"]);
});

test("agreement: land-shadow pairs with the owner's land, and pairTask keeps the source label", () => {
  const records = journal([null, transition("AWAITING_OWNER", "LANDING", "L20")]);
  const [pair] = pairTask([proposal("1", 1, "land-shadow")], () => records, "replay");
  assert.deepEqual([pair!.observedAct, pair!.outcome, pair!.source], ["land", "match", "replay"]);
});

let serial = 0;
function pair(act: ProposedActName, outcome: "match" | "mismatch" | "none", source: "live" | "replay" = "live"): Pair {
  serial += 1;
  return {
    proposalId: `p-${String(serial).padStart(4, "0")}`, source, taskId: "task-1", attempt: 1,
    at: `2026-09-${String(1 + Math.floor(serial / 60)).padStart(2, "0")}T00:${String(serial % 60).padStart(2, "0")}:00Z`,
    proposedAct: act, observedAct: null, observedAtSeq: null, outcome,
  };
}
function history(act: ProposedActName, outcomes: readonly ("match" | "mismatch" | "none")[], source: "live" | "replay" = "live"): Pair[] {
  return outcomes.map((outcome) => pair(act, outcome, source));
}
const M = "match" as const;
const X = "mismatch" as const;

test("autonomy: 7 of the last 8 unlocks a judgment act, and it is labeled earned", () => {
  const report = autonomyFor("rework", history("rework", [X, M, M, M, M, M, M, M]), "earned");
  assert.deepEqual([report.live, report.basis, report.matched, report.window.length], [true, "earned", 7, EARN_WINDOW]);
});

test("autonomy: 6 of 8 does not unlock, nor do 7 of 7, and older history drops out of the window", () => {
  assert.equal(autonomyFor("rework", history("rework", [X, X, M, M, M, M, M, M]), "earned").basis, "not-earned");
  assert.equal(autonomyFor("rework", history("rework", [M, M, M, M, M, M, M]), "earned").live, false, "not a full window");
  // Eight matches long ago, then two recent mismatches among the last eight: 6 of 8.
  const pairs = history("continue", [M, M, M, M, M, M, M, M, M, M, X, M, M, M, X, M]);
  const report = autonomyFor("continue", pairs, "earned");
  assert.deepEqual([report.matched, report.live], [6, false]);
  // "none" pairs are not paired proposals and do not dilute the window.
  const withNones = [...history("rework", [X, M, M, M, M, M, M, M]), ...history("rework", ["none", "none"])];
  assert.equal(autonomyFor("rework", withNones, "earned").live, true);
  // Another act's history never counts.
  assert.equal(autonomyFor("rework", history("continue", [M, M, M, M, M, M, M, M]), "earned").live, false);
});

test("autonomy: replay pairs count toward the window and are labeled", () => {
  const pairs = [...history("replacement-review", [M, M, M, M, M], "replay"), ...history("replacement-review", [X, M, M], "live")];
  const report = autonomyFor("replacement-review", pairs, "earned");
  assert.deepEqual([report.live, report.basis, report.sources], [true, "earned", { live: 3, replay: 5 }]);
  assert.deepEqual(report.window.map((entry) => entry.source), ["replay", "replay", "replay", "replay", "replay", "live", "live", "live"]);
});

test("autonomy: owner-all unlocks every judgment act and is labeled owner-all, never earned", () => {
  for (const act of JUDGMENT_ACTS) {
    const report = autonomyFor(act, [], "all");
    assert.deepEqual([report.live, report.basis], [true, "owner-all"]);
    const earned = autonomyFor(act, history(act, [M, M, M, M, M, M, M, M]), "all");
    assert.equal(earned.basis, "owner-all", "the switch is reported even when the window would have earned it");
  }
});

test("autonomy: code-decided acts are live from the first lease, and nothing is live without one", () => {
  for (const act of CODE_DECIDED_ACTS) {
    assert.deepEqual([autonomyFor(act, [], "earned").live, autonomyFor(act, [], "earned").basis], [true, "code-decided"]);
    assert.deepEqual([autonomyFor(act, [], null).live, autonomyFor(act, [], null).basis], [false, "no-lease"]);
  }
  assert.equal(autonomyFor("rework", history("rework", [M, M, M, M, M, M, M, M]), null).live, false);
});

test("autonomy: land-shadow never unlocks under any input", () => {
  const leases: LeaseAutonomy[] = [null, "earned", "all"];
  const histories = [[], history("land-shadow", [M, M, M, M, M, M, M, M]), history("land-shadow", Array(20).fill(M), "replay"),
    ...PROPOSED_ACT_NAMES.map((act) => history(act, [M, M, M, M, M, M, M, M]))];
  for (const lease of leases) for (const pairs of histories) {
    const report = autonomyFor("land-shadow", pairs, lease);
    assert.deepEqual([report.live, report.basis], [false, "never"]);
    assert.equal(autonomyFor("wait-for-owner", pairs, lease).live, false);
  }
  assert.ok(Object.isFrozen(autonomyFor("land-shadow", [], "all")));
});

test("autonomy: the window orders by proposal time, whatever order the pairs arrive in", () => {
  const pairs = history("rework", [X, M, M, M, M, M, M, M]);
  assert.deepEqual(earningWindow("rework", [...pairs].reverse()).map((entry) => entry.proposalId), pairs.map((entry) => entry.proposalId));
});

test("pairs: readLivePairs recomputes from delegate.jsonl and the attempt journal on every call", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-agreement-"));
  try {
    const taskRoot = join(root, "tasks", "task-1");
    mkdirSync(taskAttemptDir(taskRoot, 1), { recursive: true });
    const log = new Journal<AttemptEvent>(join(taskAttemptDir(taskRoot, 1), "journal.jsonl"));
    for (const record of journal([null, null])) await log.append(record.event);
    const record = (id: string, statusRevision: number): DelegateProposalRecord => ({
      schema: "awsf.delegate-proposal/v1", type: "delegate.proposal", id, project: "awsf", taskId: "task-1", attempt: 1,
      sessionId: "s-1", statusRevision, at: `2026-09-29T10:0${id}:00Z`, stopKind: "ceiling-pause", edge: null, checkpointId: "cp",
      leased: false, decision: { recordId: null, outcome: "unavailable" },
      proposal: { act: { act: "raise", calls: 5, raiseActs: 1, finalCeiling: 10 }, rationale: "ceiling-short", executable: true },
      allowedActs: ["raise", "cancel"], facts: {} as DelegateProposalRecord["facts"],
    });
    await appendTaskDelegateProposal(taskRoot, record("1", 1));
    assert.deepEqual((await readLivePairs(taskRoot)).map((entry) => entry.outcome), ["none"]);
    // The owner acts: only the journal changes, and the next read sees it.
    await log.append({ kind: "attempt.updated", next: next(3), evidence: GRANT });
    await log.close();
    const pairs = await readLivePairs(taskRoot);
    assert.deepEqual(pairs.map((entry) => [entry.outcome, entry.source, entry.observedAct]), [["match", "live", "raise"]]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
