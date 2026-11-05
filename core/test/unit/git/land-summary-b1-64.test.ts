import assert from "node:assert/strict";
import { test } from "node:test";
import { completeLanding } from "../../../src/git/land.ts";
import type { GitRunner } from "../../../src/git/changes.ts";

test("completeLanding omits the owner-facing candidate summary", () => {
  const calls: string[] = [];
  let headReads = 0;
  const runner: GitRunner = (argv) => {
    const command = argv.join(" ");
    calls.push(command);
    if (command === "rev-parse HEAD") {
      headReads += 1;
      return { status: 0, stdout: headReads === 1 ? "head\n" : "candidate\n", stderr: "", error: null };
    }
    if (command === "rev-parse candidate^{commit}") {
      return { status: 0, stdout: "candidate\n", stderr: "", error: null };
    }
    if (command === "rev-list --left-right --count HEAD...candidate") {
      return { status: 0, stdout: "0 1\n", stderr: "", error: null };
    }
    if (command === "status --porcelain --untracked-files=all") {
      return { status: 0, stdout: "", stderr: "", error: null };
    }
    if (command === "merge-base --is-ancestor head candidate") {
      return { status: 0, stdout: "", stderr: "", error: null };
    }
    if (command === "merge --ff-only --no-edit candidate") {
      return { status: 0, stdout: "", stderr: "", error: null };
    }
    throw new Error(`unexpected git command: ${command}`);
  };

  const outcome = completeLanding("/repo", "candidate", runner);
  assert.deepEqual(outcome, {
    ahead: 0, behind: 1, headSha: "candidate", candidateSha: "candidate",
    clean: true, fastForwardPossible: true, summary: "", checkoutClean: true,
  });
  assert.equal(calls.some((command) => command.startsWith("show ") || command.startsWith("diff --stat ")), false);
});
