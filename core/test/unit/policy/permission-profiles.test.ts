import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PermissionProfileInvalid,
  assertToolAllowed,
  resolvePermissionProfile,
  toolAllowed,
} from "../../../src/policy/permission-profiles.ts";

test("profiles preserve the exact configured allowlist", () => {
  const profile = resolvePermissionProfile("managed-worker", ["read", "edit"], ["src/**"]);
  assert.deepEqual(profile.tools, ["read", "edit"]);
  assert.equal(toolAllowed(profile, "edit"), true);
  assert.equal(toolAllowed(profile, "write"), false);
  assert.throws(() => assertToolAllowed(profile, "write"), PermissionProfileInvalid);
});

test("read-only and no-tools ceilings fail closed", () => {
  assert.throws(() => resolvePermissionProfile("readonly", ["exec"], []), PermissionProfileInvalid);
  assert.throws(() => resolvePermissionProfile("no-tools", ["read"], []), PermissionProfileInvalid);
  assert.throws(() => resolvePermissionProfile("future-profile", [], []), PermissionProfileInvalid);
});

test("writes: [] affects the repository only", () => {
  const reviewer = resolvePermissionProfile("no-tools", [], []);
  assert.equal(reviewer.repositoryReadOnly, true);
  assert.equal(reviewer.sessionRuntimeWritable, true);
});

test("the widened reviewer may read the code on disk and may still not run or write", () => {
  // The committed reviewer route, as configured. Widening it to `readonly` is
  // what lets it judge the code rather than the builder's summary; the ceiling
  // is what keeps that from becoming a shell, and `writes: []` is what keeps a
  // reviewer that cannot fix from quietly fixing.
  const reviewer = resolvePermissionProfile("readonly", ["read", "grep", "find", "ls"], []);
  assert.deepEqual(reviewer.tools, ["read", "grep", "find", "ls"]);
  assert.equal(toolAllowed(reviewer, "read"), true);
  assert.equal(reviewer.repositoryReadOnly, true);
  for (const forbidden of ["exec", "bash", "edit", "write"]) {
    assert.equal(toolAllowed(reviewer, forbidden), false, `${forbidden} must not be dispatchable`);
    assert.throws(() => resolvePermissionProfile("readonly", ["read", forbidden], []), PermissionProfileInvalid);
  }
});
