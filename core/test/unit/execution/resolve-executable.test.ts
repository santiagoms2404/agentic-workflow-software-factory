// `resolveExecutable` must not report a machine fault as a missing file.
//
// A blocked run is what made this worth a test. The documenter phase failed
// with `executable "claude" is not runnable`, on a PATH whose entries
// demonstrably contained `claude` — the same binary the planner had launched
// successfully minutes earlier in the same attempt, and which passed an
// `accessSync` X_OK check 3000 times out of 3000 immediately afterwards. Two
// sessions then went looking for a missing or misconfigured binary that was
// neither, because the syscall's own answer had been discarded by a bare
// `catch` and replaced with the conclusion "not runnable".
//
// The mechanism behind that instant is still unknown. What is fixed here is
// that the next occurrence says what the kernel said instead of guessing.

import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ExecutableNotFound, resolveExecutable } from "../../../src/execution/transport-broker.ts";

function world(): string {
  return mkdtempSync(join(tmpdir(), "awsf-resolve-exec-"));
}

function caught(run: () => unknown): ExecutableNotFound {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof ExecutableNotFound, `expected ExecutableNotFound, got ${String(error)}`);
    return error;
  }
  throw new Error("expected resolveExecutable to refuse");
}

test("an executable present and runnable on PATH resolves to its absolute path", () => {
  const root = world();
  try {
    const dir = join(root, "bin");
    mkdirSync(dir);
    const exe = join(dir, "tool");
    writeFileSync(exe, "#!/bin/sh\nexit 0\n");
    chmodSync(exe, 0o755);
    assert.equal(resolveExecutable("tool", { PATH: dir }), exe);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an ordinary absence stays quiet, so a long PATH does not bury the real case", () => {
  const root = world();
  try {
    mkdirSync(join(root, "a"));
    mkdirSync(join(root, "b"));
    const failure = caught(() => resolveExecutable("tool", { PATH: `${join(root, "a")}:${join(root, "b")}` }));
    // Every directory answered ENOENT — the file is simply not there. Naming
    // each one would be noise on a thirty-entry PATH.
    assert.deepEqual(failure.obstructions, []);
    assert.match(failure.message, /is not runnable/u);
    assert.doesNotMatch(failure.message, /obstructed/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a present but non-executable file is reported as an obstruction, not an absence", () => {
  const root = world();
  try {
    const dir = join(root, "bin");
    mkdirSync(dir);
    const exe = join(dir, "tool");
    writeFileSync(exe, "not executable\n");
    chmodSync(exe, 0o644);

    const failure = caught(() => resolveExecutable("tool", { PATH: dir }));
    assert.equal(failure.obstructions.length, 1);
    assert.match(failure.obstructions[0] ?? "", /tool: EACCES/u);
    // The message has to carry it too: the blocker detail persisted into the
    // attempt is this string, and it is all an operator sees first.
    assert.match(failure.message, /obstructed rather than empty-handed/u);
    assert.match(failure.message, /EACCES/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an absolute executable that cannot be checked carries its reason too", () => {
  const root = world();
  try {
    const exe = join(root, "tool");
    writeFileSync(exe, "not executable\n");
    chmodSync(exe, 0o644);
    const failure = caught(() => resolveExecutable(exe, {}));
    assert.match(failure.message, /EACCES/u);
    assert.equal(failure.obstructions.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
