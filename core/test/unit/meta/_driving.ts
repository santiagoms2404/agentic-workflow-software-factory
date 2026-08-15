import { join } from "node:path";
import { repoRoot, walkFiles } from "./_walk.ts";

/**
 * The driving-document tree: the owner-side skill and command documents that
 * teach a driving session how to operate AWSF.
 *
 * It lives at `docs/driving/` and deliberately NOT at `.claude/`. A provider
 * CLI discovers skills from its own working directory, and a Claude-route
 * phase's cwd is a managed worktree of this repository — so a committed
 * `.claude/` tree would put owner-tier instructions inside a worker phase's
 * context. `pi-codex` suppresses discovery explicitly with `--no-skills`;
 * `claude-code` has no verified equivalent, so placement is the control. A
 * path the CLI does not scan cannot be discovered from the worktree.
 *
 * THE TREE DOES NOT EXIST YET. `walkFiles` returns `[]` for a missing
 * directory, so every fence scoped here is vacuously green until the first
 * document lands. That is why each of those fences ships with a companion test
 * that feeds its matcher a synthetic offender in memory: delete the companion
 * and what is left reports green forever and catches nothing.
 *
 * CAUTION for whoever writes the documents: the junk-drawer meta-test rejects
 * any tracked basename containing `receipt` or `manifest`, so a cookbook named
 * `read_a_manifest.md` trips a fence that has nothing to do with it. Name
 * around it; do not widen that rule.
 */
export const DRIVING_REL = "docs/driving";

export function drivingDir(): string {
  return join(repoRoot(), "docs", "driving");
}

/** The documents themselves. The tree is markdown by design. */
export const DRIVING_DOC_EXTS = [".md"];

/**
 * Anything text-shaped that could land in the tree beside the documents.
 * Invariants 4 and 9 say "nowhere" and "anywhere else", so their sweeps read
 * wider than the markdown the document-level fences parse.
 */
export const DRIVING_TEXT_EXTS = [".md", ".txt", ".json", ".yaml", ".yml", ".sh", ".ts"];

export function drivingDocs(): string[] {
  return walkFiles(drivingDir(), DRIVING_DOC_EXTS);
}

export function drivingTextFiles(): string[] {
  return walkFiles(drivingDir(), DRIVING_TEXT_EXTS);
}
