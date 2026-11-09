import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { TestOutput } from "../../../src/contracts/test-output.ts";
import { composeReviewEvidence } from "../../../src/workflow/review-evidence.ts";

const OWNER = ["-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com"];

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...OWNER, ...argv], { encoding: "utf8" }).trim();
}

// B6-31: a binary file reports `-` for both numstat counts. The comment beside the
// loop says adding it as zero is a lie, yet `|| 0` did exactly that, so the
// review summary read +0/-0 for a change that added a file.
test("B6-31: a binary file is named as uncounted in the review summary, not summed as +0/-0", async () => {
  const repository = mkdtempSync(join(tmpdir(), "awsf-review-b6-31-"));
  git(repository, "init", "-q", "-b", "main");
  writeFileSync(join(repository, "README.md"), "base\n");
  git(repository, "add", ".");
  git(repository, "commit", "-q", "-m", "base");
  const baseSha = git(repository, "rev-parse", "HEAD");

  writeFileSync(join(repository, "README.md"), "base\nadded one\nadded two\n");
  mkdirSync(join(repository, "assets"), { recursive: true });
  writeFileSync(join(repository, "assets", "logo.bin"), Buffer.from([0, 1, 2, 0, 255, 0]));
  git(repository, "add", ".");
  git(repository, "commit", "-q", "-m", "candidate");
  const candidateSha = git(repository, "rev-parse", "HEAD");

  const composed = await composeReviewEvidence({
    worktree: repository,
    baseSha,
    candidateSha,
    intent: {
      request: "Add a line and a logo.", goals: ["Add a line to the README."], nonGoals: [],
      acceptanceCriteria: ["README gains two lines."], testStrategy: ["Compare the review summary with the diff."],
    },
    testOutput: {
      schema: "awsf.test-output/v1", producerStatus: "success", summary: "quality commands passed", artifacts: [],
      notesForNextPhase: "", passed: true, candidateSha, commands: [], failures: [], outputTail: "",
    } as unknown as TestOutput,
    diffRef: "review-diff.patch",
    retainFullDiff: async (_relativePath, diff) => diff,
  });

  assert.equal(composed.changedFiles.length, 2);
  assert.match(
    composed.context.summary,
    /2 file\(s\), \+2\/-0 \(1 binary file\(s\) not counted\)/,
    `summary was: ${composed.context.summary}`,
  );
  assert.equal(composed.context.insertions, 2, "the text change is still counted exactly");
});
