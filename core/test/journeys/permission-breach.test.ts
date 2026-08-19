import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BuildOutput } from "../../src/contracts/build-output.ts";
import { CallBudget } from "../../src/execution/call-budget.ts";
import { GateReport } from "../../src/gates/interface.ts";
import { PermissionSession } from "../../src/policy/sandbox-broker.ts";
import { PermissionBreach } from "../../src/policy/path-policy.ts";
import { transition } from "../../src/state/task-machine.ts";
import { compileWorkflow } from "../../src/workflow/compiler.ts";
import type { CorrectionSession } from "../../src/workflow/corrections.ts";
import { runAgentPhase } from "../../src/workflow/engine.ts";
import type { CompiledAgentPhase } from "../../src/workflow/phase.ts";
import { buildWorkflow } from "../../src/workflow/recipes/build.ts";

function git(repository: string, ...argv: string[]): void {
  execFileSync("git", ["-C", repository, ...argv], { stdio: "ignore" });
}

function payload(): BuildOutput {
  return {
    schema: "awsf.build-output/v1",
    producerStatus: "success",
    summary: "wrote the requested file",
    artifacts: [{ path: "allowed/result.ts", kind: "source", description: "allowed output" }],
    notesForNextPhase: "none",
    changedFiles: ["allowed/result.ts"],
    implementationNotes: ["scripted stub output"],
    commandsRun: [],
    proposedCommitMessage: "feat: scripted permission journey",
  };
}

test("stub writes outside its globs block with named paths, no correction, and a settled reservation", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-permission-journey-"));
  const canonical = join(root, "canonical");
  const worktree = join(root, "worktrees", "attempt-1");
  const runtime = join(root, "state", "sessions", "s1", "attempts", "1");
  try {
    mkdirSync(canonical, { recursive: true });
    mkdirSync(runtime, { recursive: true });
    git(canonical, "init", "-b", "main");
    writeFileSync(join(canonical, "README.md"), "base\n");
    git(canonical, "add", "README.md");
    execFileSync("git", ["-C", canonical, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: seed permission journey"], { stdio: "ignore" });
    mkdirSync(join(root, "worktrees"), { recursive: true });
    git(canonical, "worktree", "add", "--detach", worktree, "HEAD");

    const permissions = new PermissionSession({
      canonicalRepository: canonical,
      worktree,
      sessionRuntime: runtime,
      stateRoot: join(root, "state"),
      profile: "managed-worker",
      tools: ["read", "write"],
      writes: ["allowed/**"],
      protectedPaths: ["protected/**"],
      platform: "linux",
      sandboxProbe: () => false,
    });
    const compiled = compileWorkflow(buildWorkflow, buildWorkflow.tier);
    const selected = compiled.phases.find((phase) => phase.id === "builder");
    if (selected?.kind !== "agent") throw new Error("build recipe has no builder agent phase");
    const phase = {
      ...(selected as CompiledAgentPhase<BuildOutput>),
      gates: [{
        id: "envelope_valid" as const,
        run: () => new GateReport("envelope_valid").check("scripted envelope", true, "valid"),
      }],
    };
    let sends = 0;
    const identity = { adapter: "fixture", provider: "stub", model: "stub/success", sessionId: "breach-session" };
    const session: CorrectionSession = {
      identity,
      send: async () => {
        sends += 1;
        mkdirSync(join(worktree, "allowed"), { recursive: true });
        writeFileSync(join(worktree, "allowed", "result.ts"), "export {};\n");
        writeFileSync(join(worktree, "outside-a.ts"), "breach\n");
        mkdirSync(join(worktree, "protected"), { recursive: true });
        writeFileSync(join(worktree, "protected", "policy.ts"), "breach\n");
        writeFileSync(join(runtime, "report.json"), "{}\n");
        return {
          identity,
          rawOutput: JSON.stringify(payload()),
          usage: {
            inputTokens: null,
            outputTokens: null,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            reasoningTokens: null,
            reasoningRelation: "unknown" as const,
          },
          costUsd: null,
        };
      },
    };
    const budget = new CallBudget({ taskId: "journey-breach", tier: 1 });
    const reservation = budget.reserve({ cost: 1, subject: "builder" });
    budget.spendOnGo(reservation.id);

    let breach: PermissionBreach | undefined;
    await assert.rejects(
      runAgentPhase({
        workflowId: compiled.id,
        phase,
        worktree,
        previousEnvelope: null,
        session,
        budget,
        permissions,
        hostGit: {
          captureDiff: () => { throw new Error("permission breach must abort before host diff capture"); },
          commit: () => { throw new Error("permission breach must abort before commit"); },
        },
        persistence: { persist: () => undefined },
        agentSessionId: "breach-agent-session",
      }),
      (error: Error) => {
        if (!(error instanceof PermissionBreach)) return false;
        breach = error;
        return true;
      },
    );

    assert.deepEqual(breach?.offendingPaths, ["outside-a.ts", "protected/policy.ts"]);
    assert.equal(sends, 1, "a breach has no correction callback");
    assert.equal(budget.snapshot().correctionsAuto, 0);
    assert.equal(budget.callsSpent, 1);
    assert.equal(budget.callsReserved, 0);
    assert.equal(budget.reservation(reservation.id)?.state, "spent");
    const blocked = transition({
      from: "RUNNING",
      to: "BLOCKED",
      actor: "host",
      tier: 1,
      reason: { source: "gate", code: "permission-breach", detail: breach?.offendingPaths.join(", ") },
      interactive: false,
      budget: budget.snapshot(),
    });
    assert.equal(blocked.to, "BLOCKED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
