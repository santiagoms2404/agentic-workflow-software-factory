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
  stateRoot: "/srv/awsf-state",
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

test("the bwrap namespace masks the state root before it rebinds this phase's runtime", () => {
  // `--ro-bind / /` makes the WHOLE host filesystem readable, and `writes: []`
  // confines writes only. A readonly reviewer holding a model-driven Read that
  // can name an absolute path would otherwise reach every other attempt's
  // directory and this attempt's own `private/`. bwrap applies binds in argv
  // order, so the ORDER below is the control and is asserted exactly.
  const grant = grantSandbox(SPEC, { ...ROOTS, writes: [], platform: "linux" }, () => true);
  const argv = grant.spec.argv;
  const rootBind = argv.indexOf("--ro-bind");
  const mask = argv.indexOf("--tmpfs");
  const runtime = argv.lastIndexOf(ROOTS.sessionRuntime);

  assert.equal(argv[mask + 1], ROOTS.stateRoot, "the mask covers the state root itself");
  assert.ok(mask > rootBind, "the mask must come after the whole-filesystem read bind it narrows");
  assert.equal(argv[rootBind + 1], "/");
  assert.ok(runtime > mask, "this phase's own runtime is rebound after the mask, or it would be hidden too");
  assert.equal(argv[argv.indexOf(ROOTS.sessionRuntime) - 1], "--bind", "the runtime stays writable");
  assert.deepEqual(argv.slice(0, mask + 2), [
    "--die-with-parent", "--new-session", "--unshare-all", "--share-net",
    "--ro-bind", "/", "/",
    "--tmpfs", ROOTS.stateRoot,
  ]);
});

test("the canonical checkout cannot overlap any sandbox writable root", () => {
  assert.throws(() => assertSandboxRoots({
    canonicalRepository: "/srv/repos/project",
    worktree: "/srv/repos/project/.worktrees/a",
    sessionRuntime: ROOTS.sessionRuntime,
    stateRoot: ROOTS.stateRoot,
  }), /disjoint/);
  assert.throws(() => assertSandboxRoots({
    ...ROOTS,
    sessionRuntime: "/srv/repos/project/runtime",
  }), /canonical repository writable/);
  assert.throws(() => assertSandboxRoots({
    ...ROOTS,
    stateRoot: "relative/state",
  }), /absolute machine-local path/);
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

test("the widened readonly reviewer may read the worktree and still may not write to it", () => {
  const git = gitRunner({
    "status --porcelain": [""],
    "diff HEAD --numstat --no-renames -z": ["", "1\t0\tquiet-fix.ts\0"],
    "ls-files --others --exclude-standard -z": ["", ""],
  });
  const reviewer = new PermissionSession({
    ...ROOTS,
    writes: [],
    protectedPaths: [],
    profile: "readonly",
    tools: ["read", "grep", "find", "ls"],
    platform: "linux",
    sandboxProbe: () => true,
    git,
  });
  // Reading is the point of the widening; `writes: []` is what keeps it from
  // becoming a second builder, and the worktree bind stays read-only with it.
  assert.equal(reviewer.profile.repositoryReadOnly, true);
  const grant = reviewer.sandbox(SPEC);
  assert.deepEqual(grant.writableRoots, [ROOTS.sessionRuntime]);
  assert.equal(grant.spec.argv[grant.spec.argv.indexOf(ROOTS.worktree) - 1], "--ro-bind");
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

test("delivered visual references are re-bound read-only after the state-root mask, and only when present", () => {
  const references = "/srv/awsf-state/sessions/s1/attempts/1-refs";
  const plain = grantSandbox(SPEC, { ...ROOTS, writes: ["src/**"], platform: "linux" }, () => true);
  const empty = grantSandbox(SPEC, { ...ROOTS, writes: ["src/**"], readOnlyRoots: [], platform: "linux" }, () => true);
  assert.deepEqual(empty.spec.argv, plain.spec.argv, "a request with no inputs keeps the reviewed argv byte for byte");
  const grant = grantSandbox(SPEC, { ...ROOTS, writes: ["src/**"], readOnlyRoots: [references], platform: "linux" }, () => true);
  const argv = grant.spec.argv;
  const bind = argv.indexOf(references);
  assert.equal(argv[bind - 1], "--ro-bind");
  assert.equal(argv[bind + 1], references);
  assert.ok(bind > argv.indexOf("--tmpfs"), "the mask comes first, so the rebind is what survives");
  assert.ok(!grant.writableRoots.includes(references));
  const toolPolicy = grantSandbox(SPEC, { ...ROOTS, writes: [], readOnlyRoots: [references], platform: "linux" }, () => false);
  assert.equal(toolPolicy.badge, "tool-policy", "without bwrap nothing claims the inputs are OS-protected");
});

test("a read-only input root may not overlap the worktree or the writable runtime", () => {
  for (const root of [ROOTS.worktree, `${ROOTS.worktree}/refs`, ROOTS.sessionRuntime, `${ROOTS.sessionRuntime}/refs`, "relative/refs"]) {
    assert.throws(() => assertSandboxRoots({ ...ROOTS, readOnlyRoots: [root] }), /read-only input roots/, root);
  }
});
