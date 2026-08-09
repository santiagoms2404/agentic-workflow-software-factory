import { test } from "node:test";
import assert from "node:assert/strict";
import {
  InvalidPolicyPath,
  PermissionBreach,
  enforcePathPolicy,
  evaluatePathPolicy,
  matchesPathGlob,
  normalizeRepositoryPath,
  writeTargetAllowed,
} from "../../../src/policy/path-policy.ts";

test("single-star globs stop at separators while double-star crosses them", () => {
  assert.equal(matchesPathGlob("src/a.ts", "src/*.ts"), true);
  assert.equal(matchesPathGlob("src/nested/a.ts", "src/*.ts"), false);
  assert.equal(matchesPathGlob("src/nested/a.ts", "src/**/*.ts"), true);
  assert.equal(matchesPathGlob("README.md", "**/*.md"), true);
  assert.equal(matchesPathGlob("docs/a/b.md", "**/*.md"), true);
});

test("paths are refused rather than repaired into a different authorization", () => {
  for (const path of ["", "/etc/passwd", "../escape", "src/../escape", "./src/a", "src//a", "src\\a", "C:/repo/a", "a\0b"]) {
    assert.throws(() => normalizeRepositoryPath(path), InvalidPolicyPath, path);
  }
});

test("malformed policy globs fail closed even when the run changed nothing", () => {
  assert.throws(
    () => evaluatePathPolicy([], { writes: ["src/../**"], protectedPaths: [] }),
    InvalidPolicyPath,
  );
});

test("protected paths are refused even when a write glob otherwise grants them", () => {
  assert.deepEqual(
    evaluatePathPolicy(["core/src/policy/risk.ts"], {
      writes: ["core/src/**"],
      protectedPaths: ["core/src/policy/**"],
    }),
    [{ path: "core/src/policy/risk.ts", reasons: ["protected-path"] }],
  );
});

test("a breach names every offending path once and is explicitly uncorrectable", () => {
  assert.throws(
    () => enforcePathPolicy(["z.txt", "ok/a.ts", "a.txt", "z.txt"], {
      writes: ["ok/**"],
      protectedPaths: [],
    }),
    (error: Error) => {
      if (!(error instanceof PermissionBreach)) return false;
      assert.deepEqual(error.offendingPaths, ["a.txt", "z.txt"]);
      assert.equal(error.correctable, false);
      assert.equal(error.phaseCause, "permission-breach");
      assert.match(error.message, /"a\.txt", "z\.txt"/);
      return true;
    },
  );
});

test("writes: [] is repository-read-only while session runtime is always writable", () => {
  const policy = { writes: [], protectedPaths: [] };
  assert.equal(writeTargetAllowed({ scope: "repository", path: "review-fix.ts" }, policy), false);
  assert.equal(writeTargetAllowed({ scope: "session-runtime" }, policy), true);
});

test("case-insensitive mode does not permit case tricks around protected paths", () => {
  assert.deepEqual(
    evaluatePathPolicy(["CORE/SRC/POLICY/x.ts"], {
      writes: ["**"],
      protectedPaths: ["core/src/policy/**"],
      caseSensitive: false,
    }),
    [{ path: "CORE/SRC/POLICY/x.ts", reasons: ["protected-path"] }],
  );
});
