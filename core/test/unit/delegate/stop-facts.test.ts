// Stop facts (W19 task 4): one synthetic fixture per stop kind, nine in all:
// the three parked checkpoints, AWAITING_OWNER after L12, L15 and L26, and
// BLOCKED on three different edges. Each builds the record from a status and
// journal records only.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { JournalRecord } from "../../../src/persistence/journal.ts";
import type { AttemptEvent, AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import type { AttemptEvidence } from "../../../src/observability/attempt-evidence.ts";
import type { AcceptedPhase, BoundaryQuota, PhaseRecovery } from "../../../src/contracts/phase-recovery.ts";
import { REVIEW_OUTPUT_SCHEMA_ID, type ReviewFinding } from "../../../src/contracts/review-output.ts";
import { MAX_CALL_CEILING } from "../../../src/state/tiers.ts";
import type { TaskState } from "../../../src/state/task-machine.ts";
import {
  STOP_FACTS_SCHEMA_ID,
  STOP_KINDS,
  buildStopFacts,
  type StopFactsConfig,
} from "../../../src/delegate/stop-facts.ts";
import { repoRoot } from "../meta/_walk.ts";

const HASH = "a".repeat(64);
const SHA = "b".repeat(40);
const PROSE = "PROSE-THAT-MUST-NOT-LEAK";

const CONFIG: StopFactsConfig = {
  phases: [
    { id: "plan", ticket: null, route: "claude-code" },
    { id: "T01-build", ticket: "T01", route: "pi-codex" },
    { id: "T01-gates", ticket: "T01", route: null },
    { id: "T02-build", ticket: "T02", route: "pi-codex" },
    { id: "T02-gates", ticket: "T02", route: null },
    { id: "review", ticket: null, route: "claude-code" },
  ],
};

function accepted(keys: readonly string[]): AcceptedPhase[] {
  return keys.map((phaseKey, index) => ({
    phaseKey, ordinal: index + 1, envelopeId: `env-${phaseKey}`, envelopeDigest: HASH, round: 0, candidateSha: SHA,
  }));
}

function checkpoint(kind: PhaseRecovery["kind"], prefix: readonly string[], extra: Partial<PhaseRecovery> = {}): PhaseRecovery {
  return {
    schema: "awsf.phase-recovery/v1", id: `cp-${kind}`, sessionId: "s-1", kind, workflowId: "shift", bindingDigest: HASH,
    prefix: accepted(prefix), repository: "/repo", worktree: "/wt", commonGitDir: "/repo/.git",
    integrationBaseSha: SHA, worktreeHeadSha: SHA, budgetDigest: HASH, quota: null, createdAt: "2026-09-29T10:00:00Z",
    ...extra,
  };
}

function status(lifecycleState: TaskState, extra: Record<string, unknown> = {}): AttemptStatus {
  return {
    schema: "awsf/attempt-status/v1", sessionId: "s-1", project: "awsf", taskId: "task-1", continuesTask: null,
    groupId: null, planRef: null, attempt: 2, repository: "/repo", worktree: "/wt", workflow: "shift", tier: 2,
    request: PROSE, configSnapshotJson: "{}", lifecycleState, baseSha: SHA, candidateSha: SHA, phase: null,
    budget: {
      attempt: 2, callsSpent: 4, callsReserved: 0, correctionsAuto: 1, correctionsOwner: 0, ownerReentries: 0,
      allowance: { auto: 2, owner: 1, ownerReentries: 1 },
    },
    ceilingGrants: [], routeOverrides: {}, reviewDegradation: null, model: null,
    lastActivityAt: "2026-09-29T10:00:00Z", lastActivity: PROSE, nextAction: PROSE,
    gatesPass: false, requiredReviewPresent: false, journeyApproved: false, protectedApprovalsValid: false,
    process: null, landingApproval: null, blocker: null, recovery: null, revision: 9, lastSourceSeq: 9,
    ...extra,
  } as unknown as AttemptStatus;
}

function journal(current: AttemptStatus, evidence: readonly AttemptEvidence[]): JournalRecord<AttemptEvent>[] {
  return evidence.map((item, index) => ({
    source_seq: index + 1,
    recorded_at: `2026-09-29T09:${String(index).padStart(2, "0")}:00Z`,
    event: { kind: "attempt.updated", next: current, evidence: item },
  }));
}

function gate(phaseId: string, round: number, gateId: string, passed: boolean): AttemptEvidence {
  return {
    type: "gate", id: `${phaseId}-${gateId}-${String(round)}`, phaseId, round, gateId: gateId as never, kind: "subprocess",
    candidateSha: SHA, passed, exitCode: passed ? 0 : 1, checks: [], violations: [], outputPath: null,
    startedAt: "2026-09-29T09:00:00Z", endedAt: "2026-09-29T09:01:00Z",
  } as AttemptEvidence;
}

function transition(from: TaskState, to: TaskState, edgeId: string, reasonCode: string | null): AttemptEvidence {
  return {
    type: "transition", id: `t-${edgeId}`, seq: 1, from, to, actor: "host", edgeId, reasonSource: "gate",
    reasonCode, reasonDetail: PROSE, spawnSite: false, at: "2026-09-29T09:30:00Z",
  };
}

function snapshot(completedPhaseKey: string, nextPhaseKey: string, percent: number | null, minutes: number | null): AttemptEvidence {
  return {
    type: "quota-snapshot", attribution: "none", scope: "account-window", completedPhaseKey, nextPhaseKey,
    effectivePercentRemaining: percent, minutesToReset: minutes, reasonCode: null, resolvedVersion: "1.0.0",
  };
}

function phaseAccepted(phaseKey: string, ordinal: number): AttemptEvidence {
  return { type: "phase-accepted", phase: {} as never, accepted: { ...accepted([phaseKey])[0]!, ordinal } };
}

const FINDING: ReviewFinding = {
  id: "F1", severity: "medium", file: "core/src/x.ts", line: 12, title: "Unchecked branch",
  detail: "The else branch returns before the journal append.", consequence: PROSE, evidence: PROSE,
};

function reviewRecords(): AttemptEvidence[] {
  return [
    {
      type: "envelope", phaseId: "review",
      envelope: {
        envelopeId: "env-review", sessionId: "s-1", phaseId: "review", correctionRound: 0, agent: "reviewer",
        schemaId: REVIEW_OUTPUT_SCHEMA_ID, valid: true, createdAt: "2026-09-29T09:20:00Z",
        payload: { schema: REVIEW_OUTPUT_SCHEMA_ID, verdict: "concern", reviewedSha: SHA, findings: [FINDING], limitations: [] } as never,
        violations: [], rawOutputPath: "/raw",
      },
    },
    { type: "review", phaseId: "review", adapterId: "claude-code", provider: "anthropic", verdict: "concern", reviewedSha: SHA, findingCount: 1, at: "2026-09-29T09:21:00Z" },
  ];
}

const T01_GREEN = [gate("T01-gates", 0, "tests", true), gate("T01-gates", 0, "lint", true)];

test("stop facts: ceiling-pause reads the raised ceiling, the next build and ticket progress", () => {
  const cp = checkpoint("ceiling-pause", ["plan", "T01-build", "T01-gates"], { ticket: "T02" });
  const current = status("RUNNING", {
    recovery: cp,
    budget: { attempt: 2, callsSpent: 7, callsReserved: 0, correctionsAuto: 1, correctionsOwner: 0, ownerReentries: 0,
      allowance: { auto: 2, owner: 1, ownerReentries: 1 }, ceiling: 8 },
  });
  const facts = buildStopFacts(current, journal(current, T01_GREEN), CONFIG)!;
  assert.equal(facts.schema, STOP_FACTS_SCHEMA_ID);
  assert.equal(facts.stopKind, "ceiling-pause");
  assert.equal(facts.lifecycle, "RUNNING");
  assert.equal(facts.edge, null);
  assert.equal(facts.reasonCode, null);
  assert.equal(facts.checkpointId, "cp-ceiling-pause");
  assert.equal(facts.ticket, "T02");
  assert.equal(facts.callsSpent, 7);
  assert.equal(facts.ceiling, 8);
  assert.equal(facts.maxCallCeiling, MAX_CALL_CEILING);
  assert.equal(facts.nextPhase, "T02-build");
  assert.equal(facts.nextRoute, "pi-codex");
  assert.deepEqual(facts.ticketsDone, ["T01"]);
  assert.deepEqual(facts.ticketsRemaining, ["T02"]);
  assert.deepEqual(facts.gates, { phaseId: "T01-gates", round: 0, rows: [{ name: "tests", passed: true }, { name: "lint", passed: true }] });
  assert.equal(facts.review, null);
  assert.equal(facts.quota, null);
  assert.deepEqual(facts.corrections, { auto: 1, autoAllowance: 2, owner: 0, ownerAllowance: 1, ownerReentries: 0, ownerReentriesAllowance: 1 });
  assert.deepEqual([facts.project, facts.task, facts.attempt, facts.workflow, facts.tier], ["awsf", "task-1", 2, "shift", 2]);
});

test("stop facts: quota-pause joins the latest snapshot to the checkpoint's binding", () => {
  const binding: BoundaryQuota = { adapterId: "pi-codex", provider: "openai", scope: "5h", minutes: 42, threshold: 60,
    observedAt: "2026-09-29T09:59:00Z", readoutDigest: HASH };
  const cp = checkpoint("quota-pause", ["plan", "T01-build", "T01-gates"], { ticket: "T02", quota: binding });
  const current = status("RUNNING", { recovery: cp });
  const records = journal(current, [snapshot("plan", "T01-build", 80, 200), ...T01_GREEN, snapshot("T01-gates", "T02-build", 3, 42)]);
  const facts = buildStopFacts(current, records, CONFIG)!;
  assert.equal(facts.stopKind, "quota-pause");
  assert.equal(facts.edge, null);
  assert.equal(facts.nextPhase, "T02-build");
  assert.equal(facts.nextRoute, "pi-codex");
  assert.equal(facts.ceiling, 5, "no raise recorded: the tier-2 default");
  assert.deepEqual(facts.quota, {
    completedPhaseKey: "T01-gates", nextPhaseKey: "T02-build", percentRemaining: 3, minutesToReset: 42, reasonCode: null,
    observedAt: records.at(-1)!.recorded_at, adapterId: "pi-codex", provider: "openai", window: "5h", thresholdMinutes: 60,
  });
});

test("stop facts: ticket-block names the red ticket, its reason code and the gate phase to re-measure", () => {
  const cp = checkpoint("ticket-block", ["plan", "T01-build"], { ticket: "T01" });
  const current = status("RUNNING", {
    recovery: cp, blocker: { code: "phase-abort", detail: PROSE, ahead: null, behind: null, source: "gate" },
  });
  const records = journal(current, [gate("T01-gates", 0, "tests", false), gate("T01-gates", 0, "lint", true)]);
  const facts = buildStopFacts(current, records, CONFIG)!;
  assert.equal(facts.stopKind, "ticket-block");
  assert.equal(facts.reasonCode, "phase-abort");
  assert.equal(facts.ticket, "T01");
  assert.equal(facts.nextPhase, "T01-gates");
  assert.equal(facts.nextRoute, null, "a gate phase is host-only");
  assert.deepEqual(facts.ticketsDone, []);
  assert.deepEqual(facts.ticketsRemaining, ["T01", "T02"]);
  assert.deepEqual(facts.gates?.rows, [{ name: "tests", passed: false }, { name: "lint", passed: true }]);
});

test("stop facts: AWAITING_OWNER after gating (L12) reports only the last gate round", () => {
  const current = status("AWAITING_OWNER");
  const records = journal(current, [
    gate("T01-gates", 0, "tests", false), gate("T01-gates", 0, "lint", true),
    gate("T01-gates", 1, "tests", true), gate("T01-gates", 1, "lint", false),
    transition("GATING", "AWAITING_OWNER", "L12", null),
  ]);
  const facts = buildStopFacts(current, records, CONFIG)!;
  assert.equal(facts.stopKind, "gating-hold");
  assert.equal(facts.lifecycle, "AWAITING_OWNER");
  assert.equal(facts.edge, "L12");
  assert.equal(facts.checkpointId, null);
  assert.equal(facts.nextPhase, null);
  assert.deepEqual(facts.gates, { phaseId: "T01-gates", round: 1, rows: [{ name: "tests", passed: true }, { name: "lint", passed: false }] });
  assert.equal(facts.review, null);
});

test("stop facts: AWAITING_OWNER after review (L15) carries the verdict and verbatim findings", () => {
  const current = status("AWAITING_OWNER");
  const records = journal(current, [
    phaseAccepted("plan", 1), phaseAccepted("T01-build", 2), phaseAccepted("T01-gates", 3),
    phaseAccepted("T02-build", 4), phaseAccepted("T02-gates", 5),
    gate("T02-gates", 0, "tests", true), ...reviewRecords(), transition("REVIEWING", "AWAITING_OWNER", "L15", null),
  ]);
  const facts = buildStopFacts(current, records, CONFIG)!;
  assert.equal(facts.stopKind, "review-hold");
  assert.equal(facts.edge, "L15");
  assert.deepEqual(facts.ticketsDone, ["T01", "T02"]);
  assert.deepEqual(facts.ticketsRemaining, []);
  assert.deepEqual(facts.review, {
    phaseId: "review", verdict: "concern", reviewedSha: SHA, findingCount: 1,
    findings: [{ id: "F1", severity: "medium", file: "core/src/x.ts", line: 12, title: FINDING.title, text: FINDING.detail }],
  });
});

test("stop facts: AWAITING_OWNER at the quota stop (L26) names the phase it held back", () => {
  const current = status("AWAITING_OWNER");
  const records = journal(current, [...T01_GREEN, snapshot("T01-gates", "T02-build", 1, 9), transition("RUNNING", "AWAITING_OWNER", "L26", null)]);
  const facts = buildStopFacts(current, records, CONFIG)!;
  assert.equal(facts.stopKind, "quota-stop");
  assert.equal(facts.edge, "L26");
  assert.equal(facts.nextPhase, "T02-build");
  assert.equal(facts.nextRoute, "pi-codex");
  assert.equal(facts.quota?.percentRemaining, 1);
  assert.equal(facts.quota?.minutesToReset, 9);
  assert.equal(facts.quota?.provider, null, "no checkpoint binding is journaled at L26");
  assert.equal(facts.quota?.window, null);
});

for (const [from, edge, code] of [
  ["RUNNING", "L8", "silence"],
  ["GATING", "L13", "phase-abort"],
  ["REVIEWING", "L17", "review-malformed"],
] as const) {
  test(`stop facts: BLOCKED on ${edge} carries the edge and reason code ${code}`, () => {
    const current = status("BLOCKED", { blocker: { code, detail: PROSE, ahead: null, behind: null } });
    const records = journal(current, [transition("PREPARED", "RUNNING", "L4", null), transition(from, "BLOCKED", edge, code)]);
    const facts = buildStopFacts(current, records, CONFIG)!;
    assert.equal(facts.stopKind, "blocked");
    assert.equal(facts.lifecycle, "BLOCKED");
    assert.equal(facts.edge, edge);
    assert.equal(facts.reasonCode, code);
    assert.equal(facts.nextPhase, null);
    assert.equal(facts.nextRoute, null);
  });
}

test("stop facts: no fact field carries status, blocker, transition or review prose other than the findings", () => {
  const current = status("AWAITING_OWNER");
  const records = journal(current, [...reviewRecords(), transition("REVIEWING", "AWAITING_OWNER", "L15", null)]);
  const text = JSON.stringify(buildStopFacts(current, records, CONFIG));
  assert.equal(text.includes(PROSE), false);
  assert.equal(text.includes(FINDING.detail), true);
});

test("stop facts: an attempt that is not at a stop has none, and an unexplained hold refuses", () => {
  const running = status("RUNNING");
  assert.equal(buildStopFacts(running, journal(running, []), CONFIG), null);
  const completed = status("RUNNING", { recovery: checkpoint("completed-phase", ["plan"]) });
  assert.equal(buildStopFacts(completed, journal(completed, []), CONFIG), null);
  const landed = status("LANDED");
  assert.equal(buildStopFacts(landed, journal(landed, []), CONFIG), null);
  const waiting = status("AWAITING_OWNER");
  assert.throws(() => buildStopFacts(waiting, journal(waiting, []), CONFIG), /no journaled L12, L15 or L26/);
  const blocked = status("BLOCKED");
  assert.throws(() => buildStopFacts(blocked, journal(blocked, []), CONFIG), /BLOCKED has no journaled transition/);
});

test("stop facts: the kind list is closed at seven and the builder reads no file, clock, network or provider", () => {
  assert.deepEqual([...STOP_KINDS], ["ceiling-pause", "quota-pause", "ticket-block", "gating-hold", "review-hold", "quota-stop", "blocked"]);
  const source = readFileSync(join(repoRoot(), "core/src/delegate/stop-facts.ts"), "utf8");
  const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]!);
  assert.deepEqual(imports.filter((path) => path.startsWith("node:") || !path.startsWith(".")), []);
  for (const forbidden of [/\bfetch\(/, /Date\.now\(/, /new Date\(/, /process\.env/, /quota\/probe/, /decision\/jev-transport/]) {
    assert.equal(forbidden.test(source), false, `stop-facts.ts must not match ${String(forbidden)}`);
  }
});
