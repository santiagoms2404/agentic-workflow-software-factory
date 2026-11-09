// B1-20: commitProtectedAsHost takes the worktree's Git index lock with O_EXCL
// before it has a durable witness for it. A handled error in that window (the
// index changed underneath, the lease changed owner, the witness could not be
// captured) published nothing, yet left the lock behind: every later Git index
// write failed, and recovery refuses a lock nobody can attribute. The process
// that created the lock now sets it aside — renamed, never deleted — when it is
// still provably the inode it holds open.
import { test } from "node:test";
import assert from "node:assert/strict";
import { closeSync, constants, existsSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setAsideUnpublishedIndexLock } from "../../../src/git/protected-commit.ts";

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

interface World { readonly repository: string; readonly lockPath: string; readonly aside: string; readonly dispose: () => void }

function world(): World {
  const root = mkdtempSync(join(tmpdir(), "awsf-protected-lock-"));
  const repository = join(root, "repository");
  assert.equal(spawnSync("git", ["init", "-q", "-b", "main", repository], { env: GIT_ENV }).status, 0);
  const lockPath = join(repository, ".git", "index.lock");
  return { repository, lockPath, aside: `${lockPath}.awsf-unpublished-candidate-test`, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

/** The lock exactly as the transport takes it: O_EXCL, owner-private, the staged bytes written through the descriptor. */
function takeLock(lockPath: string, bytes: string): number {
  const lock = openSync(lockPath, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL, 0o600);
  writeSync(lock, bytes);
  return lock;
}

function gitAdd(repository: string, path: string): number | null {
  writeFileSync(join(repository, path), "work\n");
  return spawnSync("git", ["-C", repository, "add", path], { env: GIT_ENV }).status;
}

test("RED B1-20: after a handled pre-witness failure, Git can take the worktree's index lock again", () => {
  const w = world();
  const lock = takeLock(w.lockPath, "staged index bytes");
  try {
    assert.notEqual(gitAdd(w.repository, "blocked.txt"), 0, "precondition: the held lock blocks Git");
    assert.equal(setAsideUnpublishedIndexLock(lock, w.lockPath, w.aside), true);
    assert.equal(existsSync(w.lockPath), false);
    assert.equal(gitAdd(w.repository, "after.txt"), 0);
  } finally { closeSync(lock); w.dispose(); }
});

test("B1-20: the lock is renamed aside with its bytes, never deleted", () => {
  const w = world();
  const lock = takeLock(w.lockPath, "staged index bytes");
  try {
    assert.equal(setAsideUnpublishedIndexLock(lock, w.lockPath, w.aside), true);
    assert.equal(readFileSync(w.aside, "utf8"), "staged index bytes");
  } finally { closeSync(lock); w.dispose(); }
});

test("B1-20: a lock at that name that is not the held inode is left exactly as it is", () => {
  const w = world();
  const lock = takeLock(w.lockPath, "ours");
  try {
    // Ours was moved away and another holder's lock now sits at the name.
    renameSync(w.lockPath, `${w.lockPath}.moved`);
    writeFileSync(w.lockPath, "another holder", { flag: "wx", mode: 0o600 });
    assert.equal(setAsideUnpublishedIndexLock(lock, w.lockPath, w.aside), false);
    assert.equal(readFileSync(w.lockPath, "utf8"), "another holder");
    assert.equal(existsSync(w.aside), false);
  } finally { closeSync(lock); w.dispose(); }
});

test("B1-20: an existing file at the aside name is never overwritten", () => {
  const w = world();
  const lock = takeLock(w.lockPath, "ours");
  try {
    writeFileSync(w.aside, "earlier evidence", { flag: "wx" });
    assert.equal(setAsideUnpublishedIndexLock(lock, w.lockPath, w.aside), false);
    assert.equal(readFileSync(w.aside, "utf8"), "earlier evidence");
    assert.equal(readFileSync(w.lockPath, "utf8"), "ours");
  } finally { closeSync(lock); w.dispose(); }
});

test("B1-20: commitProtectedAsHost sets the lock aside only before its witness is offered", () => {
  // The witnessed window keeps its lock: once persistWitness has been called the
  // record may be durable, and recovery adopts a witnessed lock rather than a
  // fresh one (production-runner journeys, the `witness` cut).
  const source = readFileSync(new URL("../../../src/git/protected-commit.ts", import.meta.url), "utf8");
  assert.match(source, /witnessOffered = true;\s*await options\.persistWitness\(witness\);/u);
  assert.match(source, /if \(!headPublished\) \{(?:\s*\/\/[^\n]*)*\s*if \(!witnessOffered\) setAsideUnpublishedIndexLock\(lock, lockPath, /u);
});
