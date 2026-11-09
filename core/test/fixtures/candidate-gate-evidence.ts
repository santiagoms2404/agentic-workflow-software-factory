import { GateReport, gateKindFor } from "../../src/gates/interface.ts";
import { candidateHygiene } from "../../src/gates/candidate-hygiene.ts";
import { isWorktreeClean, runGit, systemGitRunner } from "../../src/git/changes.ts";
import { nextRevision, persistAttempt, readAttempt, type AttemptProjector } from "../../src/cli/commands/attempt.ts";

/** Record actual host measurements for a fixture with no configured command gates. */
export async function recordCandidateGateEvidence(
  attemptDir: string,
  projectRecord: AttemptProjector,
  at: string,
): Promise<void> {
  let status = await readAttempt(attemptDir);
  const { worktree, baseSha, candidateSha, sessionId } = status;
  if (worktree === null || baseSha === null || candidateSha === null) {
    throw new Error("candidate gate fixture requires a pinned candidate worktree");
  }
  const snapshot = JSON.parse(status.configSnapshotJson) as { readonly gates?: Readonly<Record<string, unknown>> };
  if (Object.keys(snapshot.gates ?? {}).length !== 0) {
    throw new Error("candidate gate fixture must execute its configured commands rather than synthesize them");
  }

  const git = systemGitRunner(worktree);
  const observedBaseSha = runGit(git, ["rev-parse", baseSha]).trim();
  const headBefore = runGit(git, ["rev-parse", "HEAD"]).trim();
  const cleanBefore = isWorktreeClean(git);
  const diffCheck = git(["diff", "--check", `${baseSha}..${candidateSha}`, "--"]);
  const headAfter = runGit(git, ["rev-parse", "HEAD"]).trim();
  const cleanAfter = isWorktreeClean(git);
  const hygiene = candidateHygiene({
    expectedBaseSha: baseSha,
    observedBaseSha,
    expectedCandidateSha: candidateSha,
    headBefore,
    headAfter,
    cleanBefore,
    cleanAfter,
    exitCode: diffCheck.status ?? -1,
    output: `${diffCheck.stdout}${diffCheck.stderr}${diffCheck.error === null ? "" : `\n${diffCheck.error}`}`,
  });
  const commands = new GateReport("commands_pass");
  commands.check("configured commands", true, "no commands configured for this synthetic repository");
  const phaseId = `${sessionId}:candidate-gates`;
  status = await persistAttempt(attemptDir, status.revision, {
    kind: "attempt.updated",
    next: nextRevision(status, {}),
    evidence: { type: "phase", phase: {
      phaseId, ordinal: 1, key: "candidate-gates", name: "Candidate gate measurement", kind: "code", owner: "host",
      description: "Host measured hygiene and the empty configured-command set on the exact candidate.", status: "SUCCEEDED",
      correctionCount: 0, maxCorrections: 0, errorCode: null, errorMessage: null,
      startedAt: at, endedAt: at, createdAt: at,
    } },
  }, projectRecord);

  for (const report of [hygiene, commands]) {
    status = await persistAttempt(attemptDir, status.revision, {
      kind: "attempt.updated",
      next: nextRevision(status, {}),
      evidence: {
        type: "gate", id: `${phaseId}:0:${report.gateId}`, phaseId, round: 0,
        gateId: report.gateId, kind: gateKindFor(report.gateId), candidateSha,
        passed: report.passed, exitCode: report.gateId === "candidate_hygiene" ? diffCheck.status ?? -1 : 0,
        checks: report.checks, violations: report.checks.filter(check => !check.ok).map(check => `${check.item}: ${check.note}`),
        outputPath: null, startedAt: at, endedAt: at,
      },
    }, projectRecord);
  }
}
