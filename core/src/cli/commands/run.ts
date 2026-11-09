// The zero-quota, terminal-facing exercise path. It is deliberately opt-in and
// fixture-only: real adapter execution remains owned by the workflow host.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { commitAsHost } from "../../git/commit.ts";
import { gateKindFor } from "../../gates/interface.ts";
import type { AttemptEvidence } from "../../observability/attempt-evidence.ts";
import { transition } from "../../state/task-machine.ts";
import {
  nextRevision,
  persistAttempt,
  readAttempt,
  type AttemptAdvancementGuard,
  type AttemptProjector,
  type AttemptStatus,
} from "./attempt.ts";
import { CANDIDATE_GATE_IDS, candidateGateEvidence, readAttemptEvidence } from "./review-record.ts";

export interface StubRunOptions {
  readonly liveMs?: number;
  readonly projectRecord?: AttemptProjector;
  readonly assertAdvancement?: AttemptAdvancementGuard;
  /** Test seam for the bounded fixture window; production uses a timer only. */
  readonly wait?: (milliseconds: number) => Promise<void>;
}

async function advance(
  attemptDir: string,
  current: AttemptStatus,
  to: "RUNNING" | "GATING" | "REVIEWING" | "AWAITING_OWNER",
  reason: "git" | "gate",
  evidence: Parameters<typeof transition>[0]["evidence"],
  options: StubRunOptions,
  spawn = false,
): Promise<AttemptStatus> {
  options.assertAdvancement?.(current.sessionId, to);
  const decision = transition({
    from: current.lifecycleState, to, actor: "host", tier: current.tier,
    reason: { source: reason }, interactive: false, budget: current.budget,
    // Spread rather than assigned: under `exactOptionalPropertyTypes` an
    // explicit `evidence: undefined` is not the same as an absent `evidence`,
    // and the transition input means the latter.
    ...(evidence === undefined ? {} : { evidence }),
    ...(spawn ? { spawn: { cost: 1 } } : {}),
  });
  const next = nextRevision(current, {
    lifecycleState: decision.to,
    ...(typeof evidence?.candidateSha === "string" ? { candidateSha: evidence.candidateSha } : {}),
    // No gate, reviewer or owner wrote these four flags, and the record says so
    // (owner call O7): `attestationProvenance: "stub"` travels with them, and
    // L20 refuses it at T2, so the fixture's review and journey can never be
    // landed as if a reviewer and the owner had made them.
    ...(to === "AWAITING_OWNER" ? {
      gatesPass: true,
      requiredReviewPresent: current.tier === 2,
      journeyApproved: true,
      protectedApprovalsValid: true,
      attestationProvenance: "stub" as const,
    } : {}),
    lastActivityAt: new Date().toISOString(),
    lastActivity: `stub simple-sdlc reached ${decision.to} through ${decision.edge}`,
  });
  return persistAttempt(
    attemptDir,
    current.revision,
    { kind: "attempt.transitioned", next },
    options.projectRecord,
  );
}

async function recordStubGateRows(
  attemptDir: string,
  status: AttemptStatus,
  candidateSha: string,
  options: StubRunOptions,
): Promise<AttemptStatus> {
  const phaseId = `${status.sessionId}:stub-gating`;
  const at = new Date().toISOString();
  status = await persistAttempt(attemptDir, status.revision, {
    kind: "attempt.updated",
    next: nextRevision(status, {}),
    evidence: { type: "phase", phase: {
      phaseId, ordinal: 1, key: "stub-gating", name: "Stub fixture gates", kind: "code", owner: "host",
      description: "Synthetic current-candidate evidence for the deterministic fixture", status: "SUCCEEDED",
      correctionCount: 0, maxCorrections: 0, errorCode: null, errorMessage: null,
      startedAt: at, endedAt: at, createdAt: at,
    } },
  }, options.projectRecord);
  for (const gateId of CANDIDATE_GATE_IDS) {
    const evidence: Extract<AttemptEvidence, { type: "gate" }> = {
      type: "gate",
      id: `${status.sessionId}:stub-gate:${gateId}`,
      phaseId,
      round: 0,
      gateId,
      kind: gateKindFor(gateId),
      candidateSha,
      passed: true,
      exitCode: 0,
      checks: [{ item: "stub fixture gate", ok: true, note: "synthetic passing row for this fixture candidate" }],
      violations: [],
      outputPath: null,
      startedAt: at,
      endedAt: at,
    };
    status = await persistAttempt(attemptDir, status.revision, {
      kind: "attempt.updated",
      next: nextRevision(status, {}),
      evidence,
    }, options.projectRecord);
  }
  return status;
}

/**
 * Runs the deterministic fixture SDLC used to feel the owner path end to end.
 * It writes one declared fixture result and makes the same host-owned candidate
 * commit that landing will later fast-forward. It never invokes a provider.
 */
export async function runStubCommand(attemptDir: string, options: StubRunOptions = {}): Promise<AttemptStatus> {
  let status = await readAttempt(attemptDir);
  // Only an attempt `awsf start --stub true` prepared is a stub attempt (O7).
  // Without this, any session could run the fixture on a real PREPARED attempt
  // and write the owner's attestations with no terminal and no lease (B7-07).
  if ((status.stub ?? null) === null) {
    throw new Error(`stub run refused: ${status.taskId} was not prepared by awsf start --stub true, so it is not a stub attempt; run it with awsf run ${status.taskId}`);
  }
  if (status.lifecycleState !== "PREPARED") throw new Error(`stub run requires PREPARED, got ${status.lifecycleState}`);
  if (status.workflow !== "simple-sdlc") throw new Error("stub run is only available for simple-sdlc");
  if (status.worktree === null || status.baseSha === null) throw new Error("PREPARED attempt has no managed worktree or base SHA");

  status = await advance(attemptDir, status, "RUNNING", "git", { workflowCompiled: true }, options, true);
  const liveMs = options.liveMs ?? 0;
  if (liveMs > 0) {
    await (options.wait ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))))(liveMs);
  }
  await mkdir(join(status.worktree!, ".awsf-stub"), { recursive: true });
  await writeFile(join(status.worktree!, ".awsf-stub", "simple-sdlc.txt"), "stub simple-sdlc completed without a provider\n", "utf8");
  const candidateSha = commitAsHost({ repository: status.worktree!, message: "test: complete stub simple-sdlc" });
  status = await advance(attemptDir, status, "GATING", "git", {
    requiredPhasesTerminalSuccess: true, hostCommitCreated: true, candidateSha,
    // `baseSha` is nullable on the attempt and optional in the evidence; a null
    // base is an absent one, never the string "null".
    ...(status.baseSha === null ? {} : { baseSha: status.baseSha }),
  }, options);
  // The fixture runs no gate processes. Record explicit synthetic rows for the
  // exact candidate so L11/L20 can inspect the same row shape as real runs;
  // O7 provenance still makes its T2 review and journey unlandable.
  status = await recordStubGateRows(attemptDir, status, candidateSha, options);
  const gateEvidence = candidateGateEvidence(await readAttemptEvidence(attemptDir), candidateSha, status.sessionId);
  if (status.tier === 2) {
    status = await advance(
      attemptDir,
      status,
      "REVIEWING",
      "gate",
      { gatesPass: true, candidateSha, gateEvidence },
      options,
      true,
    );
    status = await advance(attemptDir, status, "AWAITING_OWNER", "gate", {
      candidateSha, review: { verdict: "accept", reviewedSha: candidateSha, findings: [] },
    }, options);
  } else {
    status = await advance(
      attemptDir,
      status,
      "AWAITING_OWNER",
      "gate",
      { gatesPass: true, candidateSha, gateEvidence },
      options,
    );
  }
  return status;
}
