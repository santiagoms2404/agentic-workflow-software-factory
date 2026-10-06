// The project's one reusable baseline worktree (specs/awsf-v3-w01-driver-checks.html,
// W01-Q5): where `awsf preflight` runs every configured gate at the base L1
// would pin, when no landed attempt has already measured that base.
//
// It is created once under the worktree root and never removed. AGENTS.md
// invariant 8 and the no-destructive-paths fence keep every clearing path out of
// core/src, and a fresh tree per run would add one more tree to a host that
// already holds hundreds. A later run re-points the same tree with a detached
// checkout, and only after a clean-tree check: a dirty tree is refused and never
// cleaned, because whatever made it dirty may be the evidence somebody needs.

import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { assertClean, runGit, systemGitRunner, type GitRunner } from "../git/changes.ts";
import { createWorktree, seedWorktreePaths, worktreePath } from "../git/worktrees.ts";

/** The tree's directory name under the worktree root: never a session id, so no attempt can claim it. */
export function baselineWorktreeName(project: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(project)) throw new Error(`project ${JSON.stringify(project)} is not one path-safe identifier`);
  return `awsf-baseline-${project}`;
}

/** Something already occupies the baseline path, and Git does not call it a worktree of this repository. */
export class BaselineWorktreeForeign extends Error {
  readonly path: string;
  constructor(path: string, detail: string) {
    super(
      `the baseline worktree path ${JSON.stringify(path)} is occupied by something that is not a worktree of this repository (${detail}); ` +
        "AWSF clears nothing itself (AGENTS.md invariant 8), so move it aside by hand and run preflight again",
    );
    this.name = "BaselineWorktreeForeign";
    this.path = path;
  }
}

export interface BaselineWorktreeRequest {
  readonly repository: string;
  /** The machine-local worktree root, absolute. */
  readonly root: string;
  readonly project: string;
  readonly baseSha: string;
  readonly seedPaths: readonly string[];
  readonly protectedPaths: readonly string[];
}

export interface BaselineWorktree {
  readonly path: string;
  /** The commit it now holds: the base, resolved. */
  readonly head: string;
  /** True when this call created it; false when an existing tree was re-pointed. */
  readonly created: boolean;
  /** Seed paths copied by this call. A seed path already present is kept as it is. */
  readonly seeded: readonly string[];
}

function commonDir(runner: GitRunner): string {
  return runGit(runner, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim();
}

/**
 * Creates the baseline worktree at the base, or re-points the existing one.
 *
 * Re-pointing checks, in order, that the path is the top of a worktree sharing
 * this repository's Git directory, that it is clean, and only then checks the
 * base out detached. Seed paths are copied only where they are still missing:
 * an ignored seed path a gate depends on survives the checkout, and nothing in
 * core/src may delete it to copy it again.
 */
export async function prepareBaselineWorktree(request: BaselineWorktreeRequest): Promise<BaselineWorktree> {
  const repositoryGit = systemGitRunner(request.repository);
  const root = resolve(request.root);
  const name = baselineWorktreeName(request.project);
  const path = worktreePath(root, name);
  const head = runGit(repositoryGit, ["rev-parse", `${request.baseSha}^{commit}`]).trim();
  let created = false;
  if (!existsSync(path)) {
    createWorktree({ repository: request.repository, root, attemptId: name, baseSha: head }, repositoryGit);
    created = true;
  } else {
    const tree = systemGitRunner(path);
    const top = tree(["rev-parse", "--show-toplevel"]);
    if (top.status !== 0) throw new BaselineWorktreeForeign(path, (top.error ?? top.stderr).trim() || "Git cannot read it");
    if (await realpath(top.stdout.trim()) !== await realpath(path)) {
      throw new BaselineWorktreeForeign(path, `Git places its top level at ${top.stdout.trim()}`);
    }
    if (await realpath(commonDir(tree)) !== await realpath(commonDir(repositoryGit))) {
      throw new BaselineWorktreeForeign(path, "it belongs to another repository");
    }
    assertClean(path, "before", tree);
    runGit(tree, ["checkout", "--quiet", "--detach", head]);
  }
  const tree = systemGitRunner(path);
  const observed = runGit(tree, ["rev-parse", "HEAD"]).trim();
  if (observed !== head) throw new Error(`the baseline worktree holds ${observed} after the checkout, not the base ${head}`);
  const missing = request.seedPaths.filter((seed) => !existsSync(resolve(path, seed)));
  const seeded = missing.length === 0 ? [] : await seedWorktreePaths({
    repository: request.repository, worktree: path, seedPaths: missing, protectedPaths: request.protectedPaths,
  });
  assertClean(path, "before", tree);
  return Object.freeze({ path, head, created, seeded: Object.freeze([...seeded]) });
}
