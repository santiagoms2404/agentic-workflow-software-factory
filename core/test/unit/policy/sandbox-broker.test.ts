import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PermissionSession,
  assertSandboxRoots,
  grantSandbox,
} from "../../../src/policy/sandbox-broker.ts";
import { PermissionBreach } from "../../../src/policy/path-policy.ts";
import type { GitRunner } from "../../../src/git/changes.ts";

const ROOTS = {
  canonicalRepository: "/srv/repos/project",
  worktree: "/srv/awsf-worktrees/attempt-1",
  sessionRuntime: "/srv/awsf-state/sessions/s1/attempts/1",
};

const SPEC = {
  executable: "pi",
  argv: ["--mode", "json"],
  cwd: ROOTS.worktree,
  env: { PATH: "/usr/bin" },
  stdin: "private prompt on stdin",
  shell: false as const,
};

test("Linux bwrap grants only runtime for writes: [] and wraps argv without a shell", () => {
  const grant = grantSandbox(SPEC, { ...ROOTS, writes: [], platform: "linux" }, () => true);
  assert.equal(grant.badge, "os-enforced");
  assert.equal(grant.mechanism, "linux-bwrap");
  assert.deepEqual(grant.writableRoots, [ROOTS.sessionRuntime]);
  assert.equal(grant.spec.executable, "bwrap");
  assert.equal(grant.spec.shell, false);
  assert.equal(grant.spec.stdin, SPEC.stdin);
  assert.equal(grant.spec.env["TMPDIR"], ROOTS.sessionRuntime);
  assert.ok(grant.spec.argv.includes("--ro-bind"));
  assert.ok(!grant.spec.argv.includes(SPEC.stdin));
  const worktree = grant.spec.argv.indexOf(ROOTS.worktree);
  assert.equal(grant.spec.argv[worktree - 1], "--ro-bind");
});

test("a write-capable Linux grant mounts the managed worktree and runtime writable", () => {
  const grant = grantSandbox(SPEC, { ...ROOTS, writes: ["src/**"], platform: "linux" }, () => true);
  assert.deepEqual(grant.writableRoots, [ROOTS.worktree, ROOTS.sessionRuntime]);
  const worktree = grant.spec.argv.indexOf(ROOTS.worktree);
  assert.equal(grant.spec.argv[worktree - 1], "--bind");
});

test("the badge distinguishes Linux tool policy from an unverified Darwin sandbox", () => {
  const linux = grantSandbox(SPEC, { ...ROOTS, writes: [], platform: "linux" }, () => false);
  const darwin = grantSandbox(SPEC, { ...ROOTS, writes: [], platform: "darwin" }, () => true);
  assert.equal(linux.badge, "tool-policy");
  assert.equal(darwin.badge, "unavailable");
  assert.equal(darwin.spec, SPEC);
});

test("the canonical checkout cannot overlap any sandbox writable root", () => {
  assert.throws(() => assertSandboxRoots({
    canonicalRepository: "/srv/repos/project",
    worktree: "/srv/repos/project/.worktrees/a",
    sessionRuntime: ROOTS.sessionRuntime,
  }), /disjoint/);
  assert.throws(() => assertSandboxRoots({
    ...ROOTS,
    sessionRuntime: "/srv/repos/project/runtime",
  }), /canonical repository writable/);
});

function gitRunner(outputs: Record<string, string[]>): GitRunner {
  return (argv) => {
    const key = argv.join(" ");
    const stdout = outputs[key]?.shift();
    if (stdout === undefined) throw new Error(`unexpected git command: ${key}`);
    return { status: 0, stdout, stderr: "", error: null };
  };
}

test("the post-run comparison aborts with every path and exposes no correction path", () => {
  const git = gitRunner({
    "status --porcelain": [""],
    "diff HEAD --numstat --no-renames -z": [
      "",
      ["1\t0\tallowed/a.ts", "1\t0\toutside-a.ts", "1\t0\toutside-b.ts", ""].join("\0"),
    ],
    "ls-files --others --exclude-standard -z": ["", ""],
  });
  const session = new PermissionSession({
    ...ROOTS,
    writes: ["allowed/**"],
    protectedPaths: [],
    profile: "managed-worker",
    tools: ["read", "write"],
    platform: "linux",
    sandboxProbe: () => false,
    git,
  });
  assert.equal(session.sandboxBadge, "tool-policy");
  assert.throws(() => session.enforce(), (error: Error) => {
    if (!(error instanceof PermissionBreach)) return false;
    assert.deepEqual(error.offendingPaths, ["outside-a.ts", "outside-b.ts"]);
    return true;
  });
});

test("a reviewer configured writes: [] aborts if it edits a repository file", () => {
  const git = gitRunner({
    "status --porcelain": [""],
    "diff HEAD --numstat --no-renames -z": ["", "1\t0\tquiet-fix.ts\0"],
    "ls-files --others --exclude-standard -z": ["", ""],
  });
  const reviewer = new PermissionSession({
    ...ROOTS,
    writes: [],
    protectedPaths: [],
    profile: "no-tools",
    tools: [],
    platform: "linux",
    sandboxProbe: () => false,
    git,
  });
  assert.throws(() => reviewer.enforce(), (error: Error) => {
    if (!(error instanceof PermissionBreach)) return false;
    assert.deepEqual(error.offendingPaths, ["quiet-fix.ts"]);
    return true;
  });
});

test("a clean reviewer writes: [] run is green", () => {
  const git = gitRunner({
    "status --porcelain": [""],
    "diff HEAD --numstat --no-renames -z": ["", ""],
    "ls-files --others --exclude-standard -z": ["", ""],
  });
  const session = new PermissionSession({
    ...ROOTS,
    writes: [],
    protectedPaths: [],
    profile: "no-tools",
    tools: [],
    platform: "darwin",
    git,
  });
  assert.deepEqual(session.enforce(), { changedPaths: [], sandboxBadge: "unavailable" });
});
