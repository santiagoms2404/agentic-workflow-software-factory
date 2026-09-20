import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { HostCommitIntent } from "../../src/contracts/host-validation.ts";
import { changesSinceBase, runGit, systemGitRunner, type GitRunner } from "../../src/git/changes.ts";
import { HOST_AUTHOR, commitAsHost } from "../../src/git/commit.ts";
import { hostCommitContentDigest, reconcileHostCommit } from "../../src/git/commit-reconcile.ts";

const MESSAGE = "feat: write the bounded source";
const HASH = "a".repeat(64);

/**
 * One disposable repository per case. No runtime attempt, worktree or journal
 * of this project is ever opened — a crash-cut test that reached a real attempt
 * would be indistinguishable from the crash it is meant to study.
 */
async function fixture(): Promise<{ repo: string; git: GitRunner; parentSha: string; dispose: () => void }> {
  const repo = mkdtempSync(join(tmpdir(), "awsf-commit-reconcile-"));
  const git = systemGitRunner(repo);
  runGit(git, ["init", "-q", "-b", "main"]);
  await write(repo, "README.md", "base\n");
  runGit(git, ["add", "--all"]);
  runGit(git, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--no-gpg-sign", "-q", "-m", "chore: base"]);
  const parentSha = runGit(git, ["rev-parse", "HEAD"]).trim();
  return { repo, git, parentSha, dispose: () => rmSync(repo, { recursive: true, force: true }) };
}

async function write(repo: string, path: string, contents: string): Promise<void> {
  await mkdir(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), contents);
}

/** Exactly what the host records immediately before calling the commit transport. */
async function intentFor(repo: string, git: GitRunner, message = MESSAGE): Promise<HostCommitIntent> {
  const parentSha = runGit(git, ["rev-parse", "HEAD"]).trim();
  return {
    intentId: randomUUID(), phaseKey: "builder", ordinal: 1, round: 0, runId: "run-1",
    parentSha, message, author: HOST_AUTHOR, committer: HOST_AUTHOR,
    changedPaths: ["src/a.ts"], committedPaths: [...changesSinceBase(repo, parentSha, git)],
    contentDigest: await hostCommitContentDigest(repo, parentSha, git), treeDigest: HASH,
  };
}

interface Observation { readonly head: string; readonly status: string; readonly files: Record<string, string> }

function observe(repo: string, git: GitRunner, paths: readonly string[]): Observation {
  const files: Record<string, string> = {};
  for (const path of paths) {
    try { files[path] = readFileSync(join(repo, path), "utf8"); } catch { files[path] = "<absent>"; }
  }
  return { head: runGit(git, ["rev-parse", "HEAD"]).trim(), status: runGit(git, ["status", "--porcelain"]), files };
}

/** Every refusal must leave HEAD, the working tree and the index exactly as the crash left them. */
async function refuses(repo: string, git: GitRunner, intent: HostCommitIntent, pattern: RegExp): Promise<void> {
  const paths = ["README.md", "src/a.ts", "src/b.ts", "stray.txt"];
  const before = observe(repo, git, paths);
  const result = await reconcileHostCommit(intent, { worktree: repo, git });
  assert.equal(result.outcome, "refused");
  assert.ok(result.outcome === "refused");
  assert.match(result.reason, pattern);
  assert.deepEqual(observe(repo, git, paths), before, "a refusal reset, cleaned or committed something");
}

test("an uncommitted intent whose exact bytes survive is recognised as never having run", async () => {
  const { repo, git, dispose } = await fixture();
  try {
    await write(repo, "src/a.ts", "export const a = 1;\n");
    const intent = await intentFor(repo, git);
    assert.deepEqual(intent.committedPaths, ["src/a.ts"]);
    const before = observe(repo, git, ["src/a.ts"]);
    assert.deepEqual(await reconcileHostCommit(intent, { worktree: repo, git }), { outcome: "not-committed" });
    assert.deepEqual(observe(repo, git, ["src/a.ts"]), before);
  } finally { dispose(); }
});

test("the one commit the intent describes is identified by parent, message, identity, paths and content", async () => {
  const { repo, git, dispose } = await fixture();
  try {
    await write(repo, "src/a.ts", "export const a = 1;\n");
    await write(repo, "src/b.ts", "export const b = 2;\n");
    const intent = await intentFor(repo, git);
    assert.deepEqual(intent.committedPaths, ["src/a.ts", "src/b.ts"]);
    const commitSha = commitAsHost({ repository: repo, message: MESSAGE }, git);
    assert.deepEqual(await reconcileHostCommit(intent, { worktree: repo, git }), { outcome: "committed", commitSha });
    // Reconciliation is a read. Repeating it returns the same verdict and creates nothing.
    assert.equal(runGit(git, ["rev-list", "--count", "HEAD"]).trim(), "2");
    assert.deepEqual(await reconcileHostCommit(intent, { worktree: repo, git }), { outcome: "committed", commitSha });
    assert.equal(runGit(git, ["rev-list", "--count", "HEAD"]).trim(), "2");
  } finally { dispose(); }
});

test("a phase that changed nothing reconciles as uncommitted rather than inventing an empty candidate", async () => {
  const { repo, git, dispose } = await fixture();
  try {
    const intent = await intentFor(repo, git);
    assert.deepEqual(intent.committedPaths, []);
    assert.deepEqual(await reconcileHostCommit(intent, { worktree: repo, git }), { outcome: "not-committed" });
  } finally { dispose(); }
});

test("uncommitted work that moved since the intent refuses instead of committing whatever is there now", async () => {
  const { repo, git, dispose } = await fixture();
  try {
    await write(repo, "src/a.ts", "export const a = 1;\n");
    const intent = await intentFor(repo, git);
    await write(repo, "src/a.ts", "export const a = 99;\n");
    await refuses(repo, git, intent, /retained working tree no longer matches the recorded intent/);
  } finally { dispose(); }
});

test("a second commit after the intent is ambiguous and refuses", async () => {
  const { repo, git, dispose } = await fixture();
  try {
    await write(repo, "src/a.ts", "export const a = 1;\n");
    const intent = await intentFor(repo, git);
    commitAsHost({ repository: repo, message: MESSAGE }, git);
    await write(repo, "src/b.ts", "export const b = 2;\n");
    commitAsHost({ repository: repo, message: "chore: a second candidate" }, git);
    await refuses(repo, git, intent, /identifies one commit, but 2 revisions were created after it/);
  } finally { dispose(); }
});

test("a commit carrying another message, author or committer is not this intent's commit", async () => {
  for (const variant of ["message", "author", "committer"] as const) {
    const { repo, git, dispose } = await fixture();
    try {
      await write(repo, "src/a.ts", "export const a = 1;\n");
      const intent = await intentFor(repo, git);
      if (variant === "message") {
        commitAsHost({ repository: repo, message: "chore: a message nobody recorded" }, git);
        await refuses(repo, git, intent, /different message than the recorded intent/);
      } else {
        runGit(git, ["add", "--all"]);
        const identity = variant === "author"
          ? ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--no-gpg-sign", "-q", "-m", MESSAGE]
          : ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--author", HOST_AUTHOR, "--no-gpg-sign", "-q", "-m", MESSAGE];
        runGit(git, identity);
        await refuses(repo, git, intent, /different author or committer than the recorded intent/);
      }
    } finally { dispose(); }
  }
});

test("a matching commit beside a dirty tree cannot prove the recorded change-set is complete", async () => {
  const { repo, git, dispose } = await fixture();
  try {
    await write(repo, "src/a.ts", "export const a = 1;\n");
    const intent = await intentFor(repo, git);
    commitAsHost({ repository: repo, message: MESSAGE }, git);
    await write(repo, "stray.txt", "written after the commit\n");
    await refuses(repo, git, intent, /worktree is not clean/);
    assert.equal(readFileSync(join(repo, "stray.txt"), "utf8"), "written after the commit\n");
  } finally { dispose(); }
});

test("a commit over a different path set refuses", async () => {
  const { repo, git, dispose } = await fixture();
  try {
    await write(repo, "src/a.ts", "export const a = 1;\n");
    const intent = await intentFor(repo, git);
    await write(repo, "src/b.ts", "export const b = 2;\n");
    commitAsHost({ repository: repo, message: MESSAGE }, git);
    await refuses(repo, git, intent, /different set of paths than the recorded intent/);
  } finally { dispose(); }
});

test("a commit over the same paths with different content refuses", async () => {
  const { repo, git, dispose } = await fixture();
  try {
    await write(repo, "src/a.ts", "export const a = 1;\n");
    const intent = await intentFor(repo, git);
    await write(repo, "src/a.ts", "export const a = 99;\n");
    commitAsHost({ repository: repo, message: MESSAGE }, git);
    await refuses(repo, git, intent, /different content than the recorded intent/);
  } finally { dispose(); }
});

test("a merge commit is refused even when it is the only revision after the intent", async () => {
  const { repo, git, dispose } = await fixture();
  try {
    const rootSha = runGit(git, ["rev-list", "--max-parents=0", "HEAD"]).trim();
    await write(repo, "README.md", "base, revised\n");
    runGit(git, ["add", "--all"]);
    runGit(git, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--no-gpg-sign", "-q", "-m", "chore: second base"]);
    const parentSha = runGit(git, ["rev-parse", "HEAD"]).trim();
    assert.notEqual(parentSha, rootSha);
    await write(repo, "src/a.ts", "export const a = 1;\n");
    const intent = await intentFor(repo, git);
    runGit(git, ["add", "--all"]);
    const tree = runGit(git, ["write-tree"]).trim();
    const merged = runGit(git, ["-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com",
      "commit-tree", tree, "-p", parentSha, "-p", rootSha, "-m", MESSAGE]).trim();
    runGit(git, ["reset", "--soft", merged]);
    assert.equal(runGit(git, ["rev-list", `${parentSha}..HEAD`]).trim().split("\n").length, 1);
    await refuses(repo, git, intent, /only parent/);
  } finally { dispose(); }
});

test("a HEAD that does not descend from the recorded revision refuses", async () => {
  const { repo, git, dispose } = await fixture();
  try {
    await write(repo, "src/a.ts", "export const a = 1;\n");
    const intent = await intentFor(repo, git);
    runGit(git, ["add", "--all"]);
    const tree = runGit(git, ["write-tree"]).trim();
    const unrelated = runGit(git, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
      "commit-tree", tree, "-m", "chore: an unrelated root"]).trim();
    runGit(git, ["reset", "--soft", unrelated]);
    await refuses(repo, git, intent, /does not descend from the recorded pre-commit revision/);
  } finally { dispose(); }
});

test("an intent naming a revision this repository does not hold refuses", async () => {
  const { repo, git, dispose } = await fixture();
  try {
    await write(repo, "src/a.ts", "export const a = 1;\n");
    const intent = { ...await intentFor(repo, git), parentSha: "f".repeat(40) };
    await refuses(repo, git, intent, /not a commit object in this repository/);
  } finally { dispose(); }
});

test("the content digest reads the same value before and after the commit that carries it", async () => {
  const { repo, git, dispose } = await fixture();
  try {
    await write(repo, "src/a.ts", "export const a = 1;\n");
    await write(repo, "src/nested/c.ts", "export const c = 3;\n");
    const intent = await intentFor(repo, git);
    commitAsHost({ repository: repo, message: MESSAGE }, git);
    assert.equal(await hostCommitContentDigest(repo, intent.parentSha, git), intent.contentDigest);
  } finally { dispose(); }
});

test("a deletion is carried by the digest as a deletion, not as an absent path", async () => {
  const { repo, git, dispose } = await fixture();
  try {
    rmSync(join(repo, "README.md"));
    const intent = await intentFor(repo, git);
    assert.deepEqual(intent.committedPaths, ["README.md"]);
    assert.deepEqual(await reconcileHostCommit(intent, { worktree: repo, git }), { outcome: "not-committed" });
    const commitSha = commitAsHost({ repository: repo, message: MESSAGE }, git);
    assert.deepEqual(await reconcileHostCommit(intent, { worktree: repo, git }), { outcome: "committed", commitSha });
  } finally { dispose(); }
});
