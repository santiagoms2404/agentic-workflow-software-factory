// B1-19: commitAsHost stages the whole change-set with `git add --all`. When the
// commit that follows is refused (here by a pre-commit hook), the index must be
// handed back as it was before staging, so the attempt's change-set reads the
// same and nothing it did not commit is left staged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureChangeSet, runGit, systemGitRunner } from "../../../src/git/changes.ts";
import { commitAsHost } from "../../../src/git/commit.ts";

interface World { readonly repository: string; readonly git: ReturnType<typeof systemGitRunner>; readonly dispose: () => void }

/** A repository whose pre-commit hook exits with `hookStatus`; `based` gives it one commit. */
function world(hookStatus: number, based: boolean): World {
  const root = mkdtempSync(join(tmpdir(), "awsf-commit-staging-"));
  const repository = join(root, "repository");
  const hooks = join(root, "hooks");
  mkdirSync(repository);
  mkdirSync(hooks);
  const git = systemGitRunner(repository);
  runGit(git, ["init", "-q", "-b", "main"]);
  // Repo-local, so an ambient global hooksPath cannot decide the outcome.
  runGit(git, ["config", "core.hooksPath", hooks]);
  if (based) {
    writeFileSync(join(repository, "README.md"), "base\n");
    runGit(git, ["add", "README.md"]);
    runGit(git, ["-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-q", "--no-verify", "-m", "chore: base"]);
  }
  const hook = join(hooks, "pre-commit");
  writeFileSync(hook, `#!/bin/sh\necho lint failed >&2\nexit ${String(hookStatus)}\n`);
  chmodSync(hook, 0o755);
  return { repository, git, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

const status = (w: World): string => runGit(w.git, ["status", "--porcelain"]);
const head = (w: World): string => runGit(w.git, ["rev-parse", "HEAD"]).trim();

test("RED B1-19: a commit refused by its pre-commit hook leaves the index as it was before staging", () => {
  const w = world(1, true);
  try {
    writeFileSync(join(w.repository, "README.md"), "changed\n");
    writeFileSync(join(w.repository, "candidate.txt"), "candidate\n");
    const before = status(w);
    const parent = head(w);
    assert.throws(() => commitAsHost({ repository: w.repository, message: "feat: candidate" }), /lint failed/u);
    assert.equal(head(w), parent, "the refused commit moved HEAD");
    assert.equal(status(w), before);
  } finally { w.dispose(); }
});

test("B1-19: the change-set fingerprint the next gate compares is unchanged by a refused commit", () => {
  const w = world(1, true);
  try {
    writeFileSync(join(w.repository, "candidate.txt"), "candidate\n");
    const before = captureChangeSet(w.repository, w.git);
    assert.deepEqual(before, { "candidate.txt": "untracked" });
    assert.throws(() => commitAsHost({ repository: w.repository, message: "feat: candidate" }), /lint failed/u);
    assert.deepEqual(captureChangeSet(w.repository, w.git), before);
  } finally { w.dispose(); }
});

test("B1-19: a refused first commit on an unborn branch (awsf init) unstages too", () => {
  const w = world(1, false);
  try {
    writeFileSync(join(w.repository, "awsf.project.yaml"), "version: awsf.project/v1\n");
    assert.equal(status(w), "?? awsf.project.yaml\n");
    assert.throws(() => commitAsHost({ repository: w.repository, message: "chore: awsf init baseline" }), /lint failed/u);
    assert.equal(status(w), "?? awsf.project.yaml\n");
  } finally { w.dispose(); }
});

test("B1-19: an accepted commit still commits the whole change-set and leaves the tree clean", () => {
  const w = world(0, true);
  try {
    writeFileSync(join(w.repository, "README.md"), "changed\n");
    writeFileSync(join(w.repository, "candidate.txt"), "candidate\n");
    const parent = head(w);
    const sha = commitAsHost({ repository: w.repository, message: "feat: candidate" });
    assert.equal(head(w), sha);
    assert.notEqual(sha, parent);
    assert.equal(status(w), "");
    assert.equal(runGit(w.git, ["diff-tree", "--no-commit-id", "--name-only", "-r", sha]), "README.md\ncandidate.txt\n");
  } finally { w.dispose(); }
});
