import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { nextRevision, persistAttempt, type AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import { statusCommand } from "../../../src/cli/commands/status.ts";
import { assertPhaseRecovery, type PhaseRecovery } from "../../../src/contracts/phase-recovery.ts";
import { HOST_VALIDATION_STAGES, type HostValidationStage } from "../../../src/contracts/host-validation.ts";

function checkpoint(status: AttemptStatus, kind: PhaseRecovery["kind"], stage: HostValidationStage): PhaseRecovery {
  const hash = "a".repeat(64);
  const saved = kind === "validating" || kind === "result-ready";
  const recovery: PhaseRecovery = {
    schema: "awsf.phase-recovery/v1", id: "checkpoint", sessionId: status.sessionId, kind,
    workflowId: status.workflow, bindingDigest: hash, budgetDigest: hash,
    repository: status.repository, worktree: status.repository, commonGitDir: join(status.repository, ".git"),
    integrationBaseSha: "b".repeat(40), worktreeHeadSha: "b".repeat(40), createdAt: status.lastActivityAt,
    prefix: [{ phaseKey: "plan", ordinal: 1, envelopeId: "plan-envelope", envelopeDigest: hash, round: 0, candidateSha: null }],
    quota: kind === "quota-pause" ? {
      adapterId: "fixture", provider: "fixture", scope: "account", minutes: 0, threshold: 5,
      observedAt: status.lastActivityAt, readoutDigest: hash,
    } : null,
    ...(kind === "ticket-block" ? { ticket: "T02" } : {}),
    ...(saved ? { pending: {
      phaseKey: "build", ordinal: 2, runId: "run", envelopeId: "build-envelope", envelopeDigest: hash,
      round: 0, worktreeDigest: hash, before: {}, sandboxBadge: "os-enforced" as const,
      reservation: { id: "call", cost: 1 as const, kind: "single" as const, edge: null, attempt: 1, state: "spent" as const, spent: 1 as const },
      model: { adapter: "fixture", provider: "fixture", requestedModel: "fixture", contextWindow: null,
        supportsThinking: false, supportsTools: false, supportsImages: false, continuity: "none" as const,
        usageAuthority: "none" as const, costAuthority: "unavailable" as const },
    } } : {}),
    ...(kind === "validating" ? { validation: {
      schema: "awsf.host-validation/v1" as const, phaseKey: "build", ordinal: 2, round: 0, runId: "run",
      envelopeId: "build-envelope", envelopeDigest: hash, resultCheckpointId: "result-ready", stage,
      commitIntent: null, commitResult: null,
      protectedConsumptionId: ["commit", "verify-candidate", "accept"].includes(stage) ? "consumption" : null,
    } } : {}),
  };
  assertPhaseRecovery(recovery);
  return recovery;
}

async function readout(kind: PhaseRecovery["kind"] | null, stage: HostValidationStage = "gates", update: Partial<AttemptStatus> = {}): Promise<string[]> {
  const root = mkdtempSync(join(tmpdir(), "awsf-status-b3-04-"));
  try {
    const created = await newCommand({ stateRoot: join(root, "state"), repository: root,
      project: "fixture", taskId: "readout", request: "Read retained validation progress", workflow: "build", tier: 1 });
    await persistAttempt(created.attemptDir, created.status.revision, { kind: "attempt.updated",
      next: nextRevision(created.status, {
        lifecycleState: "RUNNING", recovery: kind === null ? null : checkpoint(created.status, kind, stage),
        budget: { ...created.status.budget, callsSpent: 1 }, ...update,
      }),
    });
    const statusPath = join(created.attemptDir, "status.json");
    const journalPath = join(created.attemptDir, "journal.jsonl");
    const before = [readFileSync(statusPath), readFileSync(journalPath)];
    const lines = await statusCommand(created.attemptDir);
    assert.deepEqual([readFileSync(statusPath), readFileSync(journalPath)], before, "status is read-only");
    return lines.filter(line => line.startsWith("Recovery:"));
  } finally { rmSync(root, { recursive: true, force: true }); }
}

for (const stage of HOST_VALIDATION_STAGES) {
  test(`B3-04: validating at ${stage} is not an accepted result`, async () => {
    assert.deepEqual(await readout("validating", stage), [
      "Recovery: saved reply awaiting host validation; 1 completed phase(s). Native interrupted-turn reconnect is not implied.",
    ]);
  });
}

for (const [kind, label] of [
  ["result-ready", "saved reply awaiting host validation"],
  ["completed-phase", "saved accepted phase result"],
  ["quota-pause", "quota-paused"],
  ["ceiling-pause", "ceiling-paused; the owner raises the ceiling, the shift never does"],
  ["ticket-block", "ticket-blocked; the owner fixes the cause, the shift never retries itself"],
] as const) {
  test(`B3-04: ${kind} retains its distinct recovery wording`, async () => {
    assert.deepEqual(await readout(kind), [
      `Recovery: ${label}; 1 completed phase(s)${kind === "ticket-block" ? "; next ticket T02" : ""}. Native interrupted-turn reconnect is not implied.`,
    ]);
  });
}

test("B3-04: no checkpoint or an active process has no parked recovery readout", async () => {
  assert.deepEqual(await readout(null), []);
  assert.deepEqual(await readout("validating", "gates", {
    process: { pid: 123, pgid: 123, startIdentity: "fixture", startIdentitySource: "fixture" },
  }), []);
});

test("B3-04: an unsettled call has no parked recovery readout", async () => {
  assert.deepEqual(await readout("validating", "gates", {
    budget: { attempt: 1, callsSpent: 1, callsReserved: 1, ceiling: 3, correctionsAuto: 0, correctionsOwner: 0,
      ownerReentries: 0, allowance: { auto: 1, owner: 1, ownerReentries: 1 } },
  }), []);
});
