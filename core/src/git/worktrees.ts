// Managed execution trees live under the machine-local Q8 root, never in state or the canonical checkout.
import { existsSync, promises as fs } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { matchesPathGlob, normalizeRepositoryPath } from "../policy/path-policy.ts";
import { runGit, systemGitRunner, type GitRunner } from "./changes.ts";

const { cp, lstat, mkdir, opendir, readlink, realpath } = fs;

export interface WorktreeRequest {
  readonly repository: string;
  readonly root: string;
  readonly attemptId: string;
  readonly baseSha: string;
}

export interface ManagedWorktree {
  readonly attemptId: string;
  readonly path: string;
  readonly head: string;
}

export interface SeedWorktreeRequest {
  readonly repository: string;
  readonly worktree: string;
  readonly seedPaths: readonly string[];
  readonly protectedPaths: readonly string[];
}

export class WorktreeSeedError extends Error {
  readonly seedPath: string;
  constructor(seedPath: string, detail: string) {
    super(`cannot seed ${JSON.stringify(seedPath)} before PREPARED: ${detail}`);
    this.name = "WorktreeSeedError";
    this.seedPath = seedPath;
  }
}

function isContained(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function assertDestinationParent(worktree: string, destination: string, seedPath: string): Promise<void> {
  let ancestor = dirname(destination);
  while (!(await pathExists(ancestor))) {
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new WorktreeSeedError(seedPath, "destination has no existing contained parent");
    ancestor = parent;
  }
  const physical = await realpath(ancestor);
  if (!isContained(worktree, physical)) {
    throw new WorktreeSeedError(seedPath, "destination parent resolves outside the managed worktree");
  }
}

async function validateSeedEntry(
  source: string,
  repository: string,
  worktree: string,
  repositoryPath: string,
  protectedPaths: readonly string[],
  seedPath: string,
): Promise<void> {
  let metadata;
  try {
    metadata = await lstat(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new WorktreeSeedError(seedPath, "configured source is missing in the canonical repository; restore it or correct runtime.seed_paths");
    }
    throw new WorktreeSeedError(seedPath, `source cannot be inspected: ${errorDetail(error)}`);
  }

  if (protectedPaths.some((glob) => matchesPathGlob(repositoryPath, glob))) {
    throw new WorktreeSeedError(seedPath, `${JSON.stringify(repositoryPath)} is protected committed intent`);
  }
  if (metadata.isFile()) return;
  if (metadata.isDirectory()) {
    const directory = await opendir(source);
    for await (const entry of directory) {
      await validateSeedEntry(
        resolve(source, entry.name),
        repository,
        worktree,
        `${repositoryPath}/${entry.name}`,
        protectedPaths,
        seedPath,
      );
    }
    return;
  }
  if (metadata.isSymbolicLink()) {
    const target = await readlink(source);
    if (isAbsolute(target) || /^[A-Za-z]:/.test(target) || target.includes("\\")) {
      throw new WorktreeSeedError(seedPath, `${JSON.stringify(repositoryPath)} is not a safe relative symlink`);
    }
    const lexicalSourceTarget = resolve(dirname(source), target);
    if (!isContained(repository, lexicalSourceTarget)) {
      throw new WorktreeSeedError(seedPath, `symlink ${JSON.stringify(repositoryPath)} escapes the canonical repository`);
    }
    let physicalSourceTarget: string;
    try {
      physicalSourceTarget = await realpath(source);
    } catch (error) {
      throw new WorktreeSeedError(seedPath, `symlink ${JSON.stringify(repositoryPath)} cannot be resolved: ${errorDetail(error)}`);
    }
    if (!isContained(repository, physicalSourceTarget)) {
      throw new WorktreeSeedError(seedPath, `symlink ${JSON.stringify(repositoryPath)} resolves outside the canonical repository`);
    }
    const destination = resolve(worktree, repositoryPath);
    const destinationTarget = resolve(dirname(destination), target);
    if (!isContained(worktree, destinationTarget)) {
      throw new WorktreeSeedError(seedPath, `symlink ${JSON.stringify(repositoryPath)} would escape the managed worktree`);
    }
    return;
  }
  throw new WorktreeSeedError(seedPath, `${JSON.stringify(repositoryPath)} has an unsupported source type`);
}

function assertGitIgnored(seedPath: string, runner: GitRunner): void {
  const tracked = runner(["ls-files", "-z", "--", seedPath]);
  if (tracked.status !== 0) {
    throw new WorktreeSeedError(seedPath, `Git could not inspect committed intent: ${tracked.error ?? tracked.stderr.trim()}`);
  }
  if (tracked.stdout.length > 0) {
    throw new WorktreeSeedError(seedPath, "source or one of its descendants is tracked committed intent");
  }
  const ignored = runner(["check-ignore", "--quiet", "--", seedPath]);
  if (ignored.status !== 0) {
    const detail = ignored.status === 1 ? "source is not ignored by Git" : `Git ignore check failed: ${ignored.error ?? ignored.stderr.trim()}`;
    throw new WorktreeSeedError(seedPath, detail);
  }
}

/**
 * Copy owner-configured, ignored repository material into a detached tree.
 * This is local provisioning only: no installer, network action, canonical
 * symlink, removal operation, or child-process route exists here.
 */
export async function seedWorktreePaths(
  request: SeedWorktreeRequest,
  runner = systemGitRunner(request.repository),
): Promise<readonly string[]> {
  const repository = await realpath(request.repository);
  const worktree = await realpath(request.worktree);
  if (isContained(repository, worktree) || isContained(worktree, repository)) {
    throw new WorktreeSeedError("(root)", "canonical repository and managed worktree must be separate trees");
  }

  const prepared: { seedPath: string; source: string; destination: string; directory: boolean }[] = [];
  for (const configured of request.seedPaths) {
    let seedPath: string;
    try {
      seedPath = normalizeRepositoryPath(configured);
    } catch (error) {
      throw new WorktreeSeedError(configured, errorDetail(error));
    }
    const source = resolve(repository, seedPath);
    const destination = resolve(worktree, seedPath);
    if (!(await pathExists(source))) {
      throw new WorktreeSeedError(seedPath, "configured source is missing in the canonical repository; restore it or correct runtime.seed_paths");
    }
    assertGitIgnored(seedPath, runner);
    if (!isContained(repository, source) || !isContained(worktree, destination)) {
      throw new WorktreeSeedError(seedPath, "seed path escapes its repository-relative destination");
    }
    if (await pathExists(destination)) {
      throw new WorktreeSeedError(seedPath, "destination already exists in the managed worktree");
    }
    await assertDestinationParent(worktree, destination, seedPath);
    await validateSeedEntry(source, repository, worktree, seedPath, request.protectedPaths, seedPath);
    prepared.push({ seedPath, source, destination, directory: (await lstat(source)).isDirectory() });
  }

  for (const item of prepared) {
    await mkdir(dirname(item.destination), { recursive: true });
    try {
      await cp(item.source, item.destination, {
        recursive: item.directory,
        errorOnExist: true,
        force: false,
        preserveTimestamps: true,
        verbatimSymlinks: true,
      });
    } catch (error) {
      throw new WorktreeSeedError(item.seedPath, `filesystem copy failed: ${errorDetail(error)}`);
    }
  }
  return Object.freeze(prepared.map((item) => item.seedPath));
}

function attemptPath(root: string, attemptId: string): string {
  if (!attemptId || attemptId !== basename(attemptId) || attemptId === "." || attemptId === "..") {
    throw new Error("attempt id must be one path component");
  }
  const absoluteRoot = resolve(root);
  const path = resolve(absoluteRoot, attemptId);
  if (relative(absoluteRoot, path) === "" || relative(absoluteRoot, path).startsWith("..")) {
    throw new Error("attempt worktree escapes its configured root");
  }
  return path;
}

/**
 * An attempt's execution tree is already on disk.
 *
 * The state an interrupted `awsf start` leaves behind: Git has the tree, the
 * attempt record is still `DRAFT`, and nothing has run. Before this existed the
 * retry surfaced git's own `fatal: '<path>' already exists` through
 * `GitCommandFailed`, which names neither what happened nor what to do, and the
 * operator had to work out that the tree was registered while the attempt was
 * not.
 *
 * AWSF clears nothing itself — `AGENTS.md` invariant 8 keeps every force and
 * auto-clearing path out of `core/src`, and that is deliberate rather than
 * missing. So this reports precisely, and the operator recovery lives in
 * `docs/driving/skills/awsf/references/gotchas.md`.
 */
export class AttemptWorktreeExists extends Error {
  readonly path: string;
  /** True when Git tracks the tree, which decides which recovery applies. */
  readonly registered: boolean;

  constructor(path: string, registered: boolean) {
    super(
      `this attempt's execution tree already exists at ${JSON.stringify(path)}` +
        `${registered ? " and Git still tracks it" : " as an untracked directory"}. ` +
        "An interrupted `awsf start` leaves it behind while the attempt record stays DRAFT, " +
        "so no phase ran and no provider call was spent. " +
        "AWSF exposes no path that clears a tree, by design (AGENTS.md invariant 8): " +
        "clear it yourself with Git, then run `awsf start` again. " +
        "docs/driving/skills/awsf/references/gotchas.md carries the exact recovery.",
    );
    this.name = "AttemptWorktreeExists";
    this.path = path;
    this.registered = registered;
  }
}

/** Create exactly the attempt's detached execution tree. No removal operation is exposed. */
export function createWorktree(request: WorktreeRequest, runner = systemGitRunner(request.repository)): ManagedWorktree {
  if (!isAbsolute(request.root)) throw new Error("worktree root must be an absolute machine-local path");
  const path = attemptPath(request.root, request.attemptId);
  const head = runGit(runner, ["rev-parse", request.baseSha]).trim();
  // Diagnose before asking Git, so the failure names the condition rather than
  // repeating git's message about a path.
  if (existsSync(path)) {
    const tracked = runGit(runner, ["worktree", "list", "--porcelain"])
      .split(/\r?\n/)
      .some((line) => line.startsWith("worktree ") && resolve(line.slice("worktree ".length)) === resolve(path));
    throw new AttemptWorktreeExists(path, tracked);
  }
  runGit(runner, ["worktree", "add", "--detach", path, head]);
  return Object.freeze({ attemptId: request.attemptId, path, head });
}

/** List only the worktrees under this machine's configured root. */
export function listWorktrees(repository: string, root: string, runner = systemGitRunner(repository)): readonly ManagedWorktree[] {
  const absoluteRoot = resolve(root);
  return Object.freeze(runGit(runner, ["worktree", "list", "--porcelain"])
    .split(/\r?\n\r?\n/)
    .flatMap((record) => {
      const lines = record.split(/\r?\n/);
      const path = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
      const head = lines.find((line) => line.startsWith("HEAD "))?.slice("HEAD ".length);
      if (!path || !head || relative(absoluteRoot, resolve(path)).startsWith("..")) return [];
      return [{ attemptId: basename(path), path, head }];
    }));
}

export function worktreePath(root: string, attemptId: string): string {
  return attemptPath(root, attemptId);
}
