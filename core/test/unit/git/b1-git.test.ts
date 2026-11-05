import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { HostCommitIntent } from "../../../src/contracts/host-validation.ts";
import type { ProtectedCandidateBinding, ProtectedGrantConsumption } from "../../../src/contracts/protected-grant.ts";
import type { ProtectedState } from "../../../src/workflow/protected-grants.ts";
import {
  isPermissionMaskedMount,
  type ProtectedCommitIntent,
} from "../../../src/git/protected-commit.ts";
import {
  stagedIndexBytes,
  unfinishedProtectedEffect,
} from "../../../src/git/protected-reconcile.ts";
import {
  captureChangeSet,
  changedPaths,
  changesSinceBase,
  runGit,
  systemGitRunner,
  type GitRunner,
} from "../../../src/git/changes.ts";
import { HOST_AUTHOR, commitAsHost } from "../../../src/git/commit.ts";
import {
  hostCommitContentDigest,
  normalizeCommitMessage,
  reconcileHostCommit,
} from "../../../src/git/commit-reconcile.ts";

const OWNER = ["-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com"];

function createTestRepo(t: { after(fn: () => void): void }): { root: string; git: GitRunner } {
  const root = mkdtempSync(join(tmpdir(), "awsf-b1-39-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = systemGitRunner(root);
  runGit(git, ["init", "--quiet", "-b", "main"]);
  return { root, git };
}

test("B1-39: rewrites of tracked files with identical line counts generate distinct fingerprints and are detected in changedPaths", (t) => {
  const { root, git } = createTestRepo(t);

  // Commit initial base content
  writeFileSync(join(root, "file.txt"), "base content\nline 2\n");
  runGit(git, ["add", "file.txt"]);
  runGit(git, [...OWNER, "commit", "--quiet", "--no-gpg-sign", "-m", "initial"]);

  // First modification: rewrite with 1 line added, 1 line deleted
  writeFileSync(join(root, "file.txt"), "rewrite alpha\nline 2\n");
  const before = captureChangeSet(root, git);

  // Second modification: rewrite with different content but same 1 line added, 1 line deleted
  writeFileSync(join(root, "file.txt"), "rewrite omega\nline 2\n");
  const after = captureChangeSet(root, git);

  // Both have line counts 1,1 relative to HEAD, but diff contents differ
  assert.notEqual(
    before["file.txt"],
    after["file.txt"],
    "fingerprints must differ despite identical line counts",
  );
  assert.deepEqual(
    changedPaths(before, after),
    ["file.txt"],
    "changedPaths must detect file rewritten with identical line counts",
  );
});

test("B1-39: multi-line tracked rewrites with identical added/deleted counts generate distinct fingerprints", (t) => {
  const { root, git } = createTestRepo(t);

  writeFileSync(join(root, "multi.txt"), "alpha\nbravo\ncharlie\n");
  runGit(git, ["add", "multi.txt"]);
  runGit(git, [...OWNER, "commit", "--quiet", "--no-gpg-sign", "-m", "initial multi"]);

  // First modification: replace 2 lines with 2 new lines (+2, -2)
  writeFileSync(join(root, "multi.txt"), "alpha\nMODIFIED_1\nMODIFIED_2\n");
  const before = captureChangeSet(root, git);

  // Second modification: replace with 2 different lines (+2, -2)
  writeFileSync(join(root, "multi.txt"), "alpha\nDIFFERENT_A\nDIFFERENT_B\n");
  const after = captureChangeSet(root, git);

  assert.notEqual(before["multi.txt"], after["multi.txt"]);
  assert.deepEqual(changedPaths(before, after), ["multi.txt"]);
});

test("B1-39: mock GitRunner verifying fingerprint incorporates content hash from git diff", () => {
  const diffCommand = "diff HEAD -- src/worker.ts";
  const numstatCommand = "diff HEAD --numstat --no-renames -z";
  const lsFilesCommand = "ls-files --others --exclude-standard -z";

  function makeMockRunner(diffOutput: string): GitRunner {
    return (argv) => {
      const key = argv.join(" ");
      if (key === numstatCommand) {
        return { status: 0, stdout: "1\t1\tsrc/worker.ts\0", stderr: "", error: null };
      }
      if (key === lsFilesCommand) {
        return { status: 0, stdout: "", stderr: "", error: null };
      }
      if (key === diffCommand) {
        return { status: 0, stdout: diffOutput, stderr: "", error: null };
      }
      throw new Error(`unexpected git command: ${key}`);
    };
  }

  const gitBefore = makeMockRunner("--- a/src/worker.ts\n+++ b/src/worker.ts\n@@ -1 +1 @@\n-old\n+first-rewrite\n");
  const gitAfter = makeMockRunner("--- a/src/worker.ts\n+++ b/src/worker.ts\n@@ -1 +1 @@\n-old\n+second-rewrite\n");

  const before = captureChangeSet("/repo", gitBefore);
  const after = captureChangeSet("/repo", gitAfter);

  assert.ok(before["src/worker.ts"], "before snapshot contains path");
  assert.ok(after["src/worker.ts"], "after snapshot contains path");
  assert.notEqual(
    before["src/worker.ts"],
    after["src/worker.ts"],
    "mock runner rewrites with same numstat must generate different fingerprints",
  );
  assert.deepEqual(changedPaths(before, after), ["src/worker.ts"]);
});

test("B1-39: unchanged dirty path preserves identical fingerprint and is not in changedPaths", (t) => {
  const { root, git } = createTestRepo(t);

  writeFileSync(join(root, "file.txt"), "base content\n");
  runGit(git, ["add", "file.txt"]);
  runGit(git, [...OWNER, "commit", "--quiet", "--no-gpg-sign", "-m", "initial"]);

  writeFileSync(join(root, "file.txt"), "dirty content\n");
  const first = captureChangeSet(root, git);
  const second = captureChangeSet(root, git);

  assert.equal(first["file.txt"], second["file.txt"]);
  assert.deepEqual(changedPaths(first, second), []);
});

test("B1-40: hostCommitContentDigest re-throws non-ENOENT lstat errors (EACCES, EPERM)", async () => {
  const mockGit: GitRunner = (argv) => {
    if (argv[0] === "diff") return { status: 0, stdout: "restricted.txt\0", stderr: "", error: null };
    if (argv[0] === "ls-files") return { status: 0, stdout: "", stderr: "", error: null };
    return { status: 0, stdout: "", stderr: "", error: null };
  };

  const eacces = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
  await assert.rejects(
    () => hostCommitContentDigest("/repo", "parent-sha", mockGit, {
      lstat: async () => { throw eacces; },
    }),
    (err: unknown) => (err as NodeJS.ErrnoException).code === "EACCES",
    "must re-throw EACCES instead of treating it as deleted",
  );

  const eperm = Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
  await assert.rejects(
    () => hostCommitContentDigest("/repo", "parent-sha", mockGit, {
      lstat: async () => { throw eperm; },
    }),
    (err: unknown) => (err as NodeJS.ErrnoException).code === "EPERM",
    "must re-throw EPERM instead of treating it as deleted",
  );
});

test("B1-40: hostCommitContentDigest catches ENOENT and records path as removed", async () => {
  const mockGit: GitRunner = (argv) => {
    if (argv[0] === "diff") return { status: 0, stdout: "deleted.txt\0", stderr: "", error: null };
    if (argv[0] === "ls-files") return { status: 0, stdout: "", stderr: "", error: null };
    return { status: 0, stdout: "", stderr: "", error: null };
  };

  const enoent = Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
  const digest = await hostCommitContentDigest("/repo", "parent-sha", mockGit, {
    lstat: async () => { throw enoent; },
  });
  assert.equal(typeof digest, "string");
  assert.equal(digest.length, 64);
});

test("B1-40: hostCommitContentDigest handles real filesystem deletions as removed: true", async (t) => {
  const { root, git } = createTestRepo(t);
  writeFileSync(join(root, "file.txt"), "hello world\n");
  runGit(git, ["add", "file.txt"]);
  runGit(git, [...OWNER, "commit", "--quiet", "--no-gpg-sign", "-m", "initial"]);
  const parentSha = runGit(git, ["rev-parse", "HEAD"]).trim();

  // Delete the file on disk
  rmSync(join(root, "file.txt"));
  // hostCommitContentDigest must resolve without throwing ENOENT
  const digest = await hostCommitContentDigest(root, parentSha, git);
  assert.equal(typeof digest, "string");
  assert.equal(digest.length, 64);
});

test("B1-41: normalizeCommitMessage strips trailing whitespace, collapses blank lines, and normalizes line endings", () => {
  // Trailing whitespace per line
  assert.equal(
    normalizeCommitMessage("feat: title   \nbody line 1  \nbody line 2\t  "),
    "feat: title\nbody line 1\nbody line 2",
  );

  // Consecutive blank lines collapsed to single empty line
  assert.equal(
    normalizeCommitMessage("feat: title\n\n\n\nbody paragraph 1\n\n\nbody paragraph 2"),
    "feat: title\n\nbody paragraph 1\n\nbody paragraph 2",
  );

  // Leading and trailing blank lines stripped
  assert.equal(
    normalizeCommitMessage("\n\n\nfeat: title\nbody\n\n\n"),
    "feat: title\nbody",
  );

  // Lines with only whitespace treated as blank and collapsed
  assert.equal(
    normalizeCommitMessage("feat: title\n   \n\t  \nbody"),
    "feat: title\n\nbody",
  );

  // CRLF line endings normalized
  assert.equal(
    normalizeCommitMessage("feat: title\r\n\r\n\r\nbody\r\n"),
    "feat: title\n\nbody",
  );

  // Empty or whitespace-only messages
  assert.equal(normalizeCommitMessage(""), "");
  assert.equal(normalizeCommitMessage("   \n\t\n  "), "");
});

test("B1-41: reconcileHostCommit accepts commit with benign whitespace differences in commit message", async (t) => {
  const { root, git } = createTestRepo(t);
  writeFileSync(join(root, "file.txt"), "hello\n");
  runGit(git, ["add", "file.txt"]);
  runGit(git, [...OWNER, "commit", "--quiet", "--no-gpg-sign", "-m", "initial"]);
  const parentSha = runGit(git, ["rev-parse", "HEAD"]).trim();

  // Make a change
  writeFileSync(join(root, "file.txt"), "hello updated\n");

  const unnormalizedMessage = "feat: add feature  \n\n\nmore context on the change\t  \n\n";
  const contentDigest = await hostCommitContentDigest(root, parentSha, git);

  const intent: HostCommitIntent = {
    intentId: randomUUID(),
    phaseKey: "builder",
    ordinal: 1,
    round: 0,
    runId: "run-1",
    parentSha,
    message: unnormalizedMessage,
    author: HOST_AUTHOR,
    committer: HOST_AUTHOR,
    changedPaths: ["file.txt"],
    committedPaths: [...changesSinceBase(root, parentSha, git)],
    contentDigest,
    treeDigest: "a".repeat(64),
  };

  // Commit with git commit -m which normalizes whitespace
  const commitSha = commitAsHost({ repository: root, message: unnormalizedMessage }, git);

  // reconcileHostCommit must accept the commit despite benign whitespace differences
  const result = await reconcileHostCommit(intent, { worktree: root, git });
  assert.deepEqual(result, { outcome: "committed", commitSha });
});

test("B1-61: an uncommitted intent does not scan worktree status before returning", async (t) => {
  const { root, git } = createTestRepo(t);
  writeFileSync(join(root, "file.txt"), "base\n");
  runGit(git, ["add", "file.txt"]);
  runGit(git, [...OWNER, "commit", "--quiet", "--no-gpg-sign", "-m", "initial"]);
  const parentSha = runGit(git, ["rev-parse", "HEAD"]).trim();
  const contentDigest = await hostCommitContentDigest(root, parentSha, git);
  const intent: HostCommitIntent = {
    intentId: randomUUID(), phaseKey: "builder", ordinal: 1, round: 0, runId: "run-1",
    parentSha, message: "feat: intended", author: HOST_AUTHOR, committer: HOST_AUTHOR,
    changedPaths: [], committedPaths: [], contentDigest, treeDigest: "a".repeat(64),
  };
  const calls: string[] = [];
  const observed: GitRunner = (argv) => {
    calls.push(argv.join(" "));
    if (argv[0] === "status") throw new Error("status scan is not needed for an uncommitted intent");
    return git(argv);
  };

  const result = await reconcileHostCommit(intent, { worktree: root, git: observed });
  assert.deepEqual(result, { outcome: "not-committed" });
  assert.equal(calls.some((command) => command.startsWith("status ")), false);
});

test("B1-41: reconcileHostCommit still refuses when messages have semantic differences", async (t) => {
  const { root, git } = createTestRepo(t);
  writeFileSync(join(root, "file.txt"), "hello\n");
  runGit(git, ["add", "file.txt"]);
  runGit(git, [...OWNER, "commit", "--quiet", "--no-gpg-sign", "-m", "initial"]);
  const parentSha = runGit(git, ["rev-parse", "HEAD"]).trim();

  writeFileSync(join(root, "file.txt"), "hello updated\n");
  const contentDigest = await hostCommitContentDigest(root, parentSha, git);

  const intent: HostCommitIntent = {
    intentId: randomUUID(),
    phaseKey: "builder",
    ordinal: 1,
    round: 0,
    runId: "run-1",
    parentSha,
    message: "feat: intended message",
    author: HOST_AUTHOR,
    committer: HOST_AUTHOR,
    changedPaths: ["file.txt"],
    committedPaths: [...changesSinceBase(root, parentSha, git)],
    contentDigest,
    treeDigest: "a".repeat(64),
  };

  commitAsHost({ repository: root, message: "feat: completely different message" }, git);

  const result = await reconcileHostCommit(intent, { worktree: root, git });
  assert.equal(result.outcome, "refused");
  if (result.outcome === "refused") {
    assert.match(result.reason, /the created commit carries a different message than the recorded intent/);
  }
});

test("B1-43: isPermissionMaskedMount detects masked permissions reporting 0777 or platform characteristics", () => {
  assert.equal(isPermissionMaskedMount("/any/path", 0o777), true);
  assert.equal(isPermissionMaskedMount("/any/path", 0o100777), true);
  assert.equal(isPermissionMaskedMount("/any/path", 0o777n), true);
  if (process.platform !== "win32") {
    assert.equal(isPermissionMaskedMount("/any/path", 0o644), false);
    assert.equal(isPermissionMaskedMount("/any/path", 0o755), false);
  }
});

test("B1-43: stagedIndexBytes accepts staging directories with mode 0777 under masked permission mounts", (t) => {
  const attemptDir = mkdtempSync(join(tmpdir(), "awsf-b1-43-staging-"));
  t.after(() => rmSync(attemptDir, { recursive: true, force: true }));

  const stagingRoot = join(attemptDir, "private", "protected-host");
  const candidateDir = join(stagingRoot, "candidate-1");
  mkdirSync(candidateDir, { recursive: true, mode: 0o777 });
  // Explicitly chmod to simulate DrvFS/9p 0777 reporting
  try { chmodSync(stagingRoot, 0o777); } catch {}
  try { chmodSync(candidateDir, 0o777); } catch {}

  const indexContent = Buffer.from("staged-index-bytes-test");
  const indexPath = join(candidateDir, "index");
  writeFileSync(indexPath, indexContent);

  const stagedIndexDigest = createHash("sha256").update(indexContent).digest("hex");
  const dummyIntent: ProtectedCommitIntent = {
    binding: {
      schema: "awsf.protected-candidate-binding/v1",
      id: "b-1",
      grantId: "g-1",
      grantDigest: "0".repeat(64),
      consumptionId: "c-1",
      generationId: "gen-1",
      operationId: "op-1",
      phaseKey: "builder",
      phaseOrdinal: 1,
      parentSha: "0".repeat(40),
      treeSha: "0".repeat(40),
      candidateSha: "0".repeat(40),
      deltas: [],
      sandboxBadge: "os-enforced",
      createdAt: "2026-01-01T00:00:00.000Z",
      digest: "0".repeat(64),
    },
    beforeIndexDigest: "0".repeat(64),
    stagedIndexDigest,
  };

  const bytes = stagedIndexBytes(attemptDir, dummyIntent);
  assert.deepEqual(bytes, indexContent, "must successfully load staged index even when directories report 0777");
});

test("B1-44: unfinishedProtectedEffect returns unbound intent when present alongside orphaned consumption", () => {
  const c1: ProtectedGrantConsumption = {
    id: "c1", grantId: "g1", grantDigest: "a".repeat(64), generationId: "gen1",
    operationId: "op1", reservationId: "res1", phaseKey: "builder", phaseOrdinal: 1,
  };
  const c2: ProtectedGrantConsumption = {
    id: "c2", grantId: "g1", grantDigest: "a".repeat(64), generationId: "gen2",
    operationId: "op2", reservationId: "res2", phaseKey: "builder", phaseOrdinal: 2,
  };

  const b1: ProtectedCandidateBinding = {
    schema: "awsf.protected-candidate-binding/v1", id: "b-c1", grantId: "g1",
    grantDigest: "a".repeat(64), consumptionId: "c1", generationId: "gen1",
    operationId: "op1", phaseKey: "builder", phaseOrdinal: 1, parentSha: "b".repeat(40),
    treeSha: "c".repeat(40), candidateSha: "d".repeat(40), deltas: [],
    sandboxBadge: "os-enforced", createdAt: "2026-09-21T00:00:00.000Z", digest: "e".repeat(64),
  };

  const intent1: ProtectedCommitIntent = {
    binding: b1,
    beforeIndexDigest: "1".repeat(64),
    stagedIndexDigest: "2".repeat(64),
  };

  const testState: ProtectedState = {
    status: {} as ProtectedState["status"],
    records: [],
    grants: [],
    // c1 has an unbound intent; c2 is an orphaned consumption (no intent, no binding)
    consumptions: [c1, c2],
    intents: [intent1],
    bindings: [],
    witnesses: [],
  };

  // Must NOT return null; must return the unbound intent to continue reconciliation
  const result = unfinishedProtectedEffect(testState);
  assert.notEqual(result, null, "must not return null when an unbound intent is present alongside orphaned consumption");
  assert.equal(result?.binding.consumptionId, "c1");
});

test("B1-44: unfinishedProtectedEffect returns null when only orphaned consumption exists without unbound intent", () => {
  const cOrphaned: ProtectedGrantConsumption = {
    id: "c-orphan", grantId: "g1", grantDigest: "a".repeat(64), generationId: "gen1",
    operationId: "op1", reservationId: "res1", phaseKey: "builder", phaseOrdinal: 1,
  };

  const testState: ProtectedState = {
    status: {} as ProtectedState["status"],
    records: [],
    grants: [],
    consumptions: [cOrphaned],
    intents: [],
    bindings: [],
    witnesses: [],
  };

  assert.equal(unfinishedProtectedEffect(testState), null);
});


