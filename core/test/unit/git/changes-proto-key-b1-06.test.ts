import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { captureChangeSet, changedPaths, runGit, systemGitRunner } from "../../../src/git/changes.ts";
import { PermissionBreach } from "../../../src/policy/path-policy.ts";
import { PermissionSession } from "../../../src/policy/sandbox-broker.ts";

// B1-06: a change-set snapshot keyed a plain object by path, so a root file
// named exactly `__proto__` hit the Object.prototype setter and never became
// an entry. The path policy then never saw it. These run real Git, because the
// bug lives between Git's output and the snapshot, not in a stubbed runner.

const OWNER = ["-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com"];

// Only the Git runner touches disk; the sandbox roots are never mounted here.
const ROOTS = {
  canonicalRepository: "/srv/repos/project",
  worktree: "/srv/awsf-worktrees/attempt-1",
  sessionRuntime: "/srv/awsf-state/sessions/s1/attempts/1",
  stateRoot: "/srv/awsf-state",
};

function repository(t: { after(fn: () => void): void }, tracked: readonly string[] = ["tracked.txt"]): string {
  const root = mkdtempSync(join(tmpdir(), "awsf-proto-key-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = systemGitRunner(root);
  runGit(git, ["init", "--quiet", "-b", "main"]);
  for (const path of tracked) writeFileSync(join(root, path), "base\n");
  runGit(git, ["add", "--", ...tracked]);
  runGit(git, [...OWNER, "commit", "--quiet", "--no-gpg-sign", "-m", "base"]);
  return root;
}

function trackedFingerprint(root: string, path: string, numstat: string): string {
  const diff = runGit(systemGitRunner(root), ["diff", "HEAD", "--", path]);
  return `${numstat}:${createHash("sha256").update(diff).digest("hex").slice(0, 16)}`;
}

function session(root: string): PermissionSession {
  return new PermissionSession({
    ...ROOTS,
    writes: ["allowed/**"],
    protectedPaths: [],
    profile: "managed-worker",
    tools: ["read", "write"],
    platform: "darwin",
    git: systemGitRunner(root),
  });
}

function offending(run: () => unknown): readonly string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof PermissionBreach) return error.offendingPaths;
    throw error;
  }
  return [];
}

test("an untracked root file named __proto__ is in the change set and refused by the path policy", (t) => {
  const root = repository(t);
  const permission = session(root);
  writeFileSync(join(root, "__proto__"), "smuggled\n");
  writeFileSync(join(root, "tracked.txt"), "edited\n");

  const snapshot = captureChangeSet(root);
  assert.equal(Object.hasOwn(snapshot, "__proto__"), true, "the snapshot keeps __proto__ as its own entry");
  assert.equal(snapshot["__proto__"], "untracked");
  assert.equal(Object.getPrototypeOf(snapshot), Object.prototype, "the snapshot's prototype is not replaced");
  assert.deepEqual(changedPaths(permission.before, snapshot), ["__proto__", "tracked.txt"]);
  assert.deepEqual(offending(() => permission.enforce()), ["__proto__", "tracked.txt"]);
});

test("a tracked root file named __proto__ that is edited reaches the policy through the numstat side", (t) => {
  const root = repository(t, ["tracked.txt", "__proto__"]);
  const permission = session(root);
  writeFileSync(join(root, "__proto__"), "edited\n");

  const snapshot = captureChangeSet(root);
  assert.deepEqual(Object.keys(snapshot), ["__proto__"]);
  assert.equal(snapshot["__proto__"], trackedFingerprint(root, "__proto__", "1,1"));
  assert.deepEqual(offending(() => permission.enforce()), ["__proto__"]);
});

test("restoring a dirty __proto__ is still a change", (t) => {
  const root = repository(t, ["tracked.txt", "__proto__"]);
  writeFileSync(join(root, "__proto__"), "edited\n");
  const dirty = captureChangeSet(root);
  writeFileSync(join(root, "__proto__"), "base\n");
  assert.deepEqual(changedPaths(dirty, captureChangeSet(root)), ["__proto__"]);
});

test("a root file named constructor is seen and refused too", (t) => {
  const root = repository(t);
  const permission = session(root);
  writeFileSync(join(root, "constructor"), "smuggled\n");

  const snapshot = captureChangeSet(root);
  assert.equal(Object.hasOwn(snapshot, "constructor"), true);
  assert.equal(snapshot["constructor"], "untracked");
  assert.deepEqual(offending(() => permission.enforce()), ["constructor"]);
});

test("ordinary paths are unchanged: a plain snapshot, and an allowed write passes", (t) => {
  const root = repository(t);
  const permission = session(root);
  assert.deepEqual(permission.before, {});
  mkdirSync(join(root, "allowed"));
  writeFileSync(join(root, "allowed", "a.ts"), "export const a = 1;\n");

  // deepStrictEqual compares prototypes, so this also pins the snapshot as a
  // plain object for every consumer that compares or serializes it.
  assert.deepEqual(captureChangeSet(root), { "allowed/a.ts": "untracked" });
  assert.deepEqual(permission.enforce(), { changedPaths: ["allowed/a.ts"], sandboxBadge: "unavailable" });

  writeFileSync(join(root, "tracked.txt"), "edited\n");
  assert.deepEqual(captureChangeSet(root), { "allowed/a.ts": "untracked", "tracked.txt": trackedFingerprint(root, "tracked.txt", "1,1") });
  assert.deepEqual(offending(() => permission.enforce()), ["tracked.txt"]);
});
