import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createWorktree, seedWorktreePaths, WorktreeSeedError } from "../../../src/git/worktrees.ts";

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

function fixture(): { root: string; canonical: string; worktree: string } {
  const root = mkdtempSync(join(tmpdir(), "awsf-seeds-"));
  const canonical = join(root, "canonical");
  execFileSync("git", ["init", "-b", "main", canonical], { stdio: "ignore" });
  mkdirSync(join(canonical, "core"), { recursive: true });
  writeFileSync(join(canonical, ".gitignore"), "node_modules/\nignored-cache/\n");
  writeFileSync(join(canonical, "core", "index.js"), "export const canonical = true;\n");
  writeFileSync(join(canonical, "README.md"), "base\n");
  git(canonical, "add", ".gitignore", "core/index.js", "README.md");
  git(canonical, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: seed dependency copy");
  const managed = createWorktree({
    repository: canonical,
    root: join(root, "worktrees"),
    attemptId: "attempt-1",
    baseSha: "HEAD",
  });
  return { root, canonical, worktree: managed.path };
}

function dependencies(canonical: string): void {
  mkdirSync(join(canonical, "node_modules", "pkg"), { recursive: true });
  mkdirSync(join(canonical, "node_modules", ".bin"), { recursive: true });
  mkdirSync(join(canonical, "node_modules", "@awsf"), { recursive: true });
  writeFileSync(join(canonical, "node_modules", "pkg", "index.js"), "dependency source\n");
  symlinkSync("../pkg/index.js", join(canonical, "node_modules", ".bin", "pkg-tool"));
  symlinkSync("../../core", join(canonical, "node_modules", "@awsf", "core"));
}

function contained(root: string, candidate: string): boolean {
  const fromRoot = relative(realpathSync(root), realpathSync(candidate));
  return fromRoot === "" || (!fromRoot.startsWith("..") && !fromRoot.startsWith("/"));
}

test("ignored dependency seeds are copied with relative links rebased into the managed worktree", async () => {
  const world = fixture();
  try {
    dependencies(world.canonical);
    await seedWorktreePaths({
      repository: world.canonical,
      worktree: world.worktree,
      seedPaths: ["node_modules"],
      protectedPaths: ["awsf.config.yaml", "core/src/state/**"],
    });

    const sourceDependency = join(world.canonical, "node_modules", "pkg", "index.js");
    const copiedDependency = join(world.worktree, "node_modules", "pkg", "index.js");
    const copiedBin = join(world.worktree, "node_modules", ".bin", "pkg-tool");
    const copiedWorkspace = join(world.worktree, "node_modules", "@awsf", "core");
    assert.equal(readFileSync(copiedDependency, "utf8"), "dependency source\n");
    assert.equal(readlinkSync(copiedBin), "../pkg/index.js");
    assert.equal(readlinkSync(copiedWorkspace), "../../core");
    assert.equal(contained(world.worktree, copiedBin), true);
    assert.equal(contained(world.worktree, copiedWorkspace), true);
    assert.equal(git(world.worktree, "status", "--porcelain"), "", "the ignored seed is never Git-visible");

    writeFileSync(copiedDependency, "host gate mutation\n");
    writeFileSync(join(copiedWorkspace, "index.js"), "provider workspace mutation\n");
    assert.equal(readFileSync(sourceDependency, "utf8"), "dependency source\n");
    assert.equal(readFileSync(join(world.canonical, "core", "index.js"), "utf8"), "export const canonical = true;\n");
    assert.equal(git(world.canonical, "status", "--porcelain"), "", "mutations in the worktree cannot flow into canonical dependencies or source");
  } finally {
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("dependency seeding refuses missing, non-ignored, protected, present, and escaping sources before PREPARED", async (t) => {
  await t.test("missing configured source", async () => {
    const world = fixture();
    try {
      await assert.rejects(
        seedWorktreePaths({ repository: world.canonical, worktree: world.worktree, seedPaths: ["node_modules"], protectedPaths: [] }),
        (error: unknown) => error instanceof WorktreeSeedError && /node_modules.*missing.*canonical/i.test(error.message),
      );
    } finally { rmSync(world.root, { recursive: true, force: true }); }
  });

  await t.test("source outside Git ignore", async () => {
    const world = fixture();
    try {
      mkdirSync(join(world.canonical, "visible-cache"));
      await assert.rejects(
        seedWorktreePaths({ repository: world.canonical, worktree: world.worktree, seedPaths: ["visible-cache"], protectedPaths: [] }),
        (error: unknown) => error instanceof WorktreeSeedError && /not ignored by Git/.test(error.message),
      );
    } finally { rmSync(world.root, { recursive: true, force: true }); }
  });

  await t.test("protected ignored source", async () => {
    const world = fixture();
    try {
      mkdirSync(join(world.canonical, "ignored-cache", "protected"), { recursive: true });
      writeFileSync(join(world.canonical, "ignored-cache", "protected", "value"), "x\n");
      await assert.rejects(
        seedWorktreePaths({ repository: world.canonical, worktree: world.worktree, seedPaths: ["ignored-cache"], protectedPaths: ["ignored-cache/protected/**"] }),
        (error: unknown) => error instanceof WorktreeSeedError && /protected committed intent/.test(error.message),
      );
    } finally { rmSync(world.root, { recursive: true, force: true }); }
  });

  await t.test("already-present destination", async () => {
    const world = fixture();
    try {
      dependencies(world.canonical);
      mkdirSync(join(world.worktree, "node_modules"));
      await assert.rejects(
        seedWorktreePaths({ repository: world.canonical, worktree: world.worktree, seedPaths: ["node_modules"], protectedPaths: [] }),
        (error: unknown) => error instanceof WorktreeSeedError && /destination already exists/.test(error.message),
      );
    } finally { rmSync(world.root, { recursive: true, force: true }); }
  });

  await t.test("unsupported filesystem source type", { skip: process.platform === "win32" }, async () => {
    const world = fixture();
    try {
      mkdirSync(join(world.canonical, "ignored-cache"));
      execFileSync("mkfifo", [join(world.canonical, "ignored-cache", "pipe")]);
      await assert.rejects(
        seedWorktreePaths({ repository: world.canonical, worktree: world.worktree, seedPaths: ["ignored-cache"], protectedPaths: [] }),
        (error: unknown) => error instanceof WorktreeSeedError && /unsupported source type/.test(error.message),
      );
    } finally { rmSync(world.root, { recursive: true, force: true }); }
  });

  await t.test("absolute symlink back into canonical", async () => {
    const world = fixture();
    try {
      mkdirSync(join(world.canonical, "node_modules"));
      symlinkSync(join(world.canonical, "core"), join(world.canonical, "node_modules", "canonical-core"));
      await assert.rejects(
        seedWorktreePaths({ repository: world.canonical, worktree: world.worktree, seedPaths: ["node_modules"], protectedPaths: [] }),
        (error: unknown) => error instanceof WorktreeSeedError && /not a safe relative symlink/.test(error.message),
      );
    } finally { rmSync(world.root, { recursive: true, force: true }); }
  });

  await t.test("symlink escaping the canonical repository", async () => {
    const world = fixture();
    try {
      mkdirSync(join(world.canonical, "node_modules"));
      symlinkSync("../../outside", join(world.canonical, "node_modules", "escape"));
      mkdirSync(join(world.root, "outside"));
      await assert.rejects(
        seedWorktreePaths({ repository: world.canonical, worktree: world.worktree, seedPaths: ["node_modules"], protectedPaths: [] }),
        (error: unknown) => error instanceof WorktreeSeedError && /symlink.*escapes/.test(error.message),
      );
      assert.equal(lstatSync(join(world.canonical, "node_modules", "escape")).isSymbolicLink(), true);
    } finally { rmSync(world.root, { recursive: true, force: true }); }
  });
});
