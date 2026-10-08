import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeReviewEvidence } from "../../src/workflow/review-evidence.ts";

export async function reviewDeliveryFixture(singleFile = false, smallFileContent = "after\n") {
  const root = mkdtempSync(join(tmpdir(), "awsf-full-review-"));
  const repository = join(root, "repository");
  const worktree = join(root, "worktree");
  const stateRoot = join(root, "state");
  const attemptDir = join(stateRoot, "attempt");
  mkdirSync(repository); mkdirSync(attemptDir, { recursive: true });
  const git = (cwd: string, ...argv: string[]): string => execFileSync("git", ["-C", cwd, ...argv], { encoding: "utf8" });
  git(repository, "init", "-b", "main");
  writeFileSync(join(repository, "small.ts"), "before\n");
  writeFileSync(join(repository, "partial.ts"), ["before", ...Array.from({ length: 100 }, (_, i) => `context ${i}`), "end", ""].join("\n"));
  git(repository, "add", ".");
  const commit = (cwd: string) => git(cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture");
  commit(repository);
  const baseSha = git(repository, "rev-parse", "HEAD").trim();
  git(repository, "worktree", "add", "--detach", worktree, "HEAD");
  if (!singleFile) {
    writeFileSync(join(worktree, "small.ts"), smallFileContent);
    writeFileSync(join(worktree, "partial.ts"), ["after", ...Array.from({ length: 100 }, (_, i) => `context ${i}`), "end", "large addition ".repeat(15_000), ""].join("\n"));
    writeFileSync(join(worktree, 'quote " tab\t newline\n ü.ts'), "unusual filename\n");
    writeFileSync(join(worktree, "literal[1].ts"), "literal pathspec\n");
    writeFileSync(join(worktree, "binary.dat"), Buffer.from([0, 1, 2, 3]));
    chmodSync(join(worktree, "small.ts"), 0o755);
  }
  writeFileSync(join(worktree, "huge.ts"), `${"large addition ".repeat(15_000)}\n`);
  git(worktree, "add", "."); commit(worktree);
  const candidateSha = git(worktree, "rev-parse", "HEAD").trim();
  const location = { attemptDir, worktree, repository, stateRoot, runId: "fixture-review-run" };
  let retained = "";
  const composed = await composeReviewEvidence({ worktree, baseSha, candidateSha,
    intent: { request: "Review the entire change", goals: ["complete review"], nonGoals: ["no commands"], acceptanceCriteria: ["all files inspectable"], testStrategy: ["fixture"] },
    testOutput: { schema: "awsf.test-output/v1", producerStatus: "success", summary: "fixture gates pass", artifacts: [], notesForNextPhase: "review", passed: true, candidateSha, commands: [], failures: [], outputTail: "pass" },
    diffRef: "raw/full.diff", delivery: location,
    retainFullDiff: async (ref, text) => { retained = text; mkdirSync(join(attemptDir, "raw")); writeFileSync(join(attemptDir, ref), text, { mode: 0o600 }); return text; },
  });
  return { root, location, composed, retained, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
