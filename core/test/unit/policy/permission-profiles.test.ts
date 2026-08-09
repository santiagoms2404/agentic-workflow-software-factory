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
