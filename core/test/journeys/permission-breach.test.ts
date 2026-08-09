import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PermissionSession } from "../../src/policy/sandbox-broker.ts";
import { PermissionBreach } from "../../src/policy/path-policy.ts";

function git(repository: string, ...argv: string[]): void {
  execFileSync("git", ["-C", repository, ...argv], { stdio: "ignore" });
}

test("stub writes outside its globs abort with named paths and no correction attempt", () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-permission-journey-"));
  const canonical = join(root, "canonical");
  const worktree = join(root, "worktrees", "attempt-1");
  const runtime = join(root, "state", "sessions", "s1", "attempts", "1");
  try {
    mkdirSync(canonical, { recursive: true });
    mkdirSync(runtime, { recursive: true });
    git(canonical, "init", "-b", "main");
    git(canonical, "config", "user.name", "Santiago Marin");
    git(canonical, "config", "user.email", "santiagomarinsuarez@me.com");
    writeFileSync(join(canonical, "README.md"), "base\n");
    git(canonical, "add", "README.md");
    git(canonical, "commit", "-m", "test: seed permission journey");
    mkdirSync(join(root, "worktrees"), { recursive: true });
    git(canonical, "worktree", "add", "--detach", worktree, "HEAD");

    const permissions = new PermissionSession({
      canonicalRepository: canonical,
      worktree,
      sessionRuntime: runtime,
      profile: "managed-worker",
      tools: ["read", "write"],
      writes: ["allowed/**"],
      protectedPaths: ["protected/**"],
      platform: "linux",
      sandboxProbe: () => false,
    });

    // A scripted zero-spend worker: one allowed output and two violations.
    const stubRun = (): void => {
      mkdirSync(join(worktree, "allowed"), { recursive: true });
      writeFileSync(join(worktree, "allowed", "result.ts"), "export {};\n");
      writeFileSync(join(worktree, "outside-a.ts"), "breach\n");
      mkdirSync(join(worktree, "protected"), { recursive: true });
      writeFileSync(join(worktree, "protected", "policy.ts"), "breach\n");
      writeFileSync(join(runtime, "report.json"), "{}\n");
    };

    let correctionAttempts = 0;
    stubRun();
    assert.throws(() => permissions.enforce(), (error: Error) => {
      if (!(error instanceof PermissionBreach)) return false;
      assert.deepEqual(error.offendingPaths, ["outside-a.ts", "protected/policy.ts"]);
      // There is no correction callback on PermissionSession. A workflow catches
      // this terminal error and blocks; it cannot spend the correction allowance.
      assert.equal(correctionAttempts, 0);
      return true;
    });
    assert.equal(correctionAttempts, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
