// The zero-quota, terminal-facing exercise path. It is deliberately opt-in and
// fixture-only: real adapter execution remains owned by the workflow host.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { commitAsHost } from "../../git/commit.ts";
import { transition } from "../../state/task-machine.ts";
import {
  nextActionFor,
  nextRevision,
  persistAttempt,
  readAttempt,
  type AttemptAdvancementGuard,
  type AttemptProjector,
  type AttemptStatus,
} from "./attempt.ts";

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
    reason: { source: reason }, interactive: false, budget: current.budget, evidence,
    ...(spawn ? { spawn: { cost: 1 } } : {}),
  });
  const next = nextRevision(current, {
    lifecycleState: decision.to,
    ...(typeof evidence?.candidateSha === "string" ? { candidateSha: evidence.candidateSha } : {}),
    ...(to === "AWAITING_OWNER" ? {
      gatesPass: true,
      requiredReviewPresent: current.tier === 2,
      journeyApproved: true,
      protectedApprovalsValid: true,
    } : {}),
    lastActivityAt: new Date().toISOString(),
    lastActivity: `stub simple-sdlc reached ${decision.to} through ${decision.edge}`,
    nextAction: nextActionFor(decision.to, current.taskId),
  });
  return persistAttempt(
    attemptDir,
    current.revision,
    { kind: "attempt.transitioned", next },
    options.projectRecord,
  );
}

/**
 * Runs the deterministic fixture SDLC used to feel the owner path end to end.
 * It writes one declared fixture result and makes the same host-owned candidate
 * commit that landing will later fast-forward. It never invokes a provider.
 */
export async function runStubCommand(attemptDir: string, options: StubRunOptions = {}): Promise<AttemptStatus> {
  let status = await readAttempt(attemptDir);
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
    requiredPhasesTerminalSuccess: true, hostCommitCreated: true, baseSha: status.baseSha, candidateSha,
  }, options);
  if (status.tier === 2) {
    status = await advance(
      attemptDir,
      status,
      "REVIEWING",
      "gate",
      { gatesPass: true, candidateSha },
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
      { gatesPass: true, candidateSha },
      options,
    );
  }
  return status;
}
