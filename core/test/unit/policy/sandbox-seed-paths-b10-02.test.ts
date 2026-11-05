import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PermissionSession, grantSandbox } from "../../../src/policy/sandbox-broker.ts";
import { PermissionBreach } from "../../../src/policy/path-policy.ts";
import type { GitRunner } from "../../../src/git/changes.ts";

// B10-02: `enforce()` diffs Git's view of the worktree, and Git never lists
// ignored paths, so a builder could rewrite a seeded `node_modules/.bin/tsc`
// that the host gates then run. Seeded paths are bound read-only under bwrap,
// and fingerprinted (size, mtime, inode) between phase snapshots without it.

const FIXED_SECONDS = 1_700_000_000;

/** An attempt worktree in tmpdir holding two seeded paths, with whole-second mtimes so a restore is exact. */
function seededWorld() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "awsf-seed-paths-")));
  const worktree = join(root, "worktrees", "attempt-1");
  const tool = join(worktree, "node_modules", ".bin", "tool");
  mkdirSync(join(worktree, "node_modules", ".bin"), { recursive: true });
  mkdirSync(join(worktree, "vendor-cache"), { recursive: true });
  writeFileSync(tool, ["#!/bin/sh", "exit 1", ""].join("\n"));
  writeFileSync(join(worktree, "vendor-cache", "index"), "cache\n");
  for (const path of [tool, join(worktree, "node_modules", ".bin"), join(worktree, "node_modules")]) {
    utimesSync(path, FIXED_SECONDS, FIXED_SECONDS);
  }
  const roots = {
    canonicalRepository: join(root, "canonical"),
    worktree,
    sessionRuntime: join(root, "state", "attempts", "1", "private", "builder"),
    stateRoot: join(root, "state"),
  };
  const spec = {
    executable: "pi", argv: ["--mode", "json"], cwd: worktree,
    env: { PATH: "/usr/bin" }, stdin: "private prompt on stdin", shell: false as const,
  };
  return { root, worktree, tool, roots, spec, seedPaths: ["node_modules", "vendor-cache"] };
}

/** A clean Git view before and after: every seeded change is invisible to Git, as in the finding. */
function cleanGit(): GitRunner {
  const outputs: Record<string, string[]> = {
    "status --porcelain --untracked-files=all": [""],
    "diff HEAD --numstat --no-renames -z": ["", ""],
    "ls-files --others --exclude-standard -z": ["", ""],
  };
  return (argv) => {
    const key = argv.join(" ");
    const stdout = outputs[key]?.shift();
    if (stdout === undefined) throw new Error(`unexpected git command: ${key}`);
    return { status: 0, stdout, stderr: "", error: null };
  };
}

function toolPolicySession(world: ReturnType<typeof seededWorld>): PermissionSession {
  return new PermissionSession({
    ...world.roots,
    seedPaths: world.seedPaths,
    writes: ["src/**"],
    protectedPaths: [],
    profile: "managed-worker",
    tools: ["read", "write"],
    platform: "linux",
    sandboxProbe: () => false,
    git: cleanGit(),
  });
}

function breachPaths(run: () => unknown): readonly string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof PermissionBreach) return error.offendingPaths;
    throw error;
  }
  return [];
}

test("the bwrap argv binds every seeded path read-only over the writable worktree", () => {
  const world = seededWorld();
  try {
    for (const confinement of ["host", "worktree"] as const) {
      const spec = confinement === "worktree"
        ? { ...world.spec, executable: "sh", env: { PATH: "/usr/bin:/bin", HOME: join(world.root, "home") } }
        : world.spec;
      const grant = grantSandbox(spec, { ...world.roots, seedPaths: world.seedPaths, writes: ["src/**"], platform: "linux", confinement }, () => true);
      const argv = grant.spec.argv;
      const worktreeBind = argv.indexOf(world.worktree);
      assert.equal(argv[worktreeBind - 1], "--bind", `${confinement}: the worktree itself stays writable`);
      for (const seed of world.seedPaths) {
        const path = join(world.worktree, seed);
        const at = argv.indexOf(path);
        assert.equal(argv[at - 1], "--ro-bind", `${confinement}: ${seed} is bound read-only`);
        assert.equal(argv[at + 1], path, `${confinement}: ${seed} is bound onto itself`);
        assert.ok(at > worktreeBind, `${confinement}: ${seed} is bound after the worktree, so the read-only bind is what survives`);
        assert.ok(at < argv.indexOf("--"), `${confinement}: ${seed} is a bwrap mount, not a child argument`);
      }
    }
  } finally { rmSync(world.root, { recursive: true, force: true }); }
});

test("without an OS sandbox a size change to a seeded file raises a PermissionBreach", () => {
  const world = seededWorld();
  try {
    const session = toolPolicySession(world);
    assert.equal(session.sandboxBadge, "tool-policy");
    const inode = statSync(world.tool).ino;
    writeFileSync(world.tool, ["#!/bin/sh", "exit 0 ", ""].join("\n"));
    utimesSync(world.tool, FIXED_SECONDS, FIXED_SECONDS);
    assert.equal(statSync(world.tool).ino, inode, "the fixture changes the size alone");
    assert.deepEqual(breachPaths(() => session.enforce()), ["node_modules/.bin/tool"]);
  } finally { rmSync(world.root, { recursive: true, force: true }); }
});

test("without an OS sandbox an mtime change alone raises a PermissionBreach", () => {
  const world = seededWorld();
  try {
    const session = toolPolicySession(world);
    utimesSync(world.tool, FIXED_SECONDS + 60, FIXED_SECONDS + 60);
    assert.deepEqual(breachPaths(() => session.enforce()), ["node_modules/.bin/tool"]);
  } finally { rmSync(world.root, { recursive: true, force: true }); }
});

test("without an OS sandbox a same-size, same-mtime replacement is caught by its inode", () => {
  const world = seededWorld();
  try {
    const session = toolPolicySession(world);
    const bin = join(world.worktree, "node_modules", ".bin");
    const forged = join(bin, "forged");
    writeFileSync(forged, ["#!/bin/sh", "exit 0", ""].join("\n"));
    utimesSync(forged, FIXED_SECONDS, FIXED_SECONDS);
    renameSync(forged, world.tool);
    utimesSync(bin, FIXED_SECONDS, FIXED_SECONDS);
    assert.deepEqual(breachPaths(() => session.enforce()), ["node_modules/.bin/tool"]);
  } finally { rmSync(world.root, { recursive: true, force: true }); }
});

test("without an OS sandbox a seeded path that is only read passes, and a seed created during the phase does not", () => {
  const world = seededWorld();
  try {
    const session = toolPolicySession(world);
    assert.equal(readFileSync(world.tool, "utf8").startsWith("#!/bin/sh"), true);
    assert.deepEqual(session.enforce(), { changedPaths: [], sandboxBadge: "tool-policy" });

    const absentSeed = new PermissionSession({
      ...world.roots,
      seedPaths: ["absent-seed"],
      writes: ["src/**"],
      protectedPaths: [],
      profile: "managed-worker",
      tools: ["read", "write"],
      platform: "linux",
      sandboxProbe: () => true,
      git: cleanGit(),
    });
    mkdirSync(join(world.worktree, "absent-seed"));
    assert.deepEqual(breachPaths(() => absentSeed.enforce()), ["absent-seed"],
      "a seed missing at open has no read-only bind, so even under bwrap its appearance is a breach");
  } finally { rmSync(world.root, { recursive: true, force: true }); }
});
