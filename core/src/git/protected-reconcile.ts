import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { recoveryDigest } from "../contracts/phase-recovery.ts";
import type { ProtectedCandidateBinding, ProtectedGrant, ProtectedGrantConsumption } from "../contracts/protected-grant.ts";
import type { AwsfConfig } from "../config/schema.ts";
import { runGit, systemGitRunner } from "./changes.ts";
import { protectedContentDeltas, protectedTreeDelta } from "./protected-delta.ts";
import { matchesPathGlob } from "../policy/path-policy.ts";
import { protectedBlobId, protectedReadOnlyGit, readProtectedContent } from "../workflow/protected-files.ts";
import type { ProtectedState } from "../workflow/protected-grants.ts";
import type { ProtectedCommitIntent } from "./protected-commit.ts";

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/**
 * The one unfinished protected host effect, or null.
 *
 * `commitProtectedAsHost` writes its intent before it publishes anything and
 * its binding after everything, so a consumption carrying an intent and no
 * binding is exactly the crash window between them. More than one is not a
 * window — the generation is one-use, so a second unfinished effect is
 * corruption rather than a cut.
 */
export function unfinishedProtectedEffect(state: ProtectedState): ProtectedCommitIntent | null {
  const unbound = state.intents.filter(intent => !state.bindings.some(binding => binding.consumptionId === intent.binding.consumptionId));
  if (unbound.length > 1) throw new Error("protected evidence carries more than one unfinished host effect");
  const orphaned = state.consumptions.filter(consumption =>
    !state.bindings.some(binding => binding.consumptionId === consumption.id) &&
    !state.intents.some(intent => intent.binding.consumptionId === consumption.id));
  if (orphaned.length > 0) return null;
  return unbound[0] ?? null;
}

/**
 * How far the publication of one already-created candidate object got.
 *
 * `commitProtectedAsHost` creates the commit object with `commit-tree` BEFORE
 * it records the intent, so at every cut below the candidate already exists in
 * the object store. What remains is a HEAD compare-and-swap and the
 * installation of one exact pre-staged index, both of which are pinned by
 * digest in the durable intent. That is why these cuts are completable rather
 * than replayable: nothing is recreated, chosen or inferred.
 */
export type ProtectedPublication =
  | { readonly outcome: "unpublished"; readonly candidateSha: string }
  | { readonly outcome: "head-published"; readonly candidateSha: string }
  | { readonly outcome: "published"; readonly candidateSha: string }
  | { readonly outcome: "refused"; readonly reason: string };

const refuse = (reason: string): ProtectedPublication => Object.freeze({ outcome: "refused" as const, reason });

export interface ProtectedEffectContext {
  readonly grant: ProtectedGrant;
  readonly consumption: ProtectedGrantConsumption;
  readonly binding: ProtectedCandidateBinding;
  readonly root: string;
  readonly indexPath: string;
}

export function protectedEffectContext(state: ProtectedState, intent: ProtectedCommitIntent): ProtectedEffectContext {
  const grant = state.grants.find(value => value.id === intent.binding.grantId);
  const consumption = state.consumptions.find(value => value.id === intent.binding.consumptionId);
  if (grant === undefined || consumption === undefined) throw new Error("protected host effect has no issued generation");
  const root = grant.subject.worktree;
  return Object.freeze({ grant, consumption, binding: intent.binding, root,
    indexPath: runGit(protectedReadOnlyGit(root), ["rev-parse", "--path-format=absolute", "--git-path", "index"]).trim() });
}

/**
 * Identify the publication state of one unfinished protected host effect.
 *
 * Read-only in the strictest sense: it opens no lock, stages nothing, moves no
 * reference and reads only immutable objects, the index file's bytes and the
 * granted paths' own content. A state it cannot name exactly is refused, and a
 * refusal authorizes nothing.
 */
export function inspectProtectedPublication(state: ProtectedState, intent: ProtectedCommitIntent): ProtectedPublication {
  const context = protectedEffectContext(state, intent);
  const { binding, grant, root } = context;
  const git = protectedReadOnlyGit(root);
  if (git(["cat-file", "-e", `${binding.candidateSha}^{commit}`]).status !== 0) {
    return refuse("the recorded candidate is not a commit object in this repository");
  }
  const parents = runGit(git, ["rev-list", "--parents", "-n", "1", binding.candidateSha]).trim().split(/\s+/).slice(1);
  if (parents.length !== 1 || parents[0] !== binding.parentSha) return refuse("the recorded candidate does not have the granted pre-write HEAD as its only parent");
  if (runGit(git, ["rev-parse", `${binding.candidateSha}^{tree}`]).trim() !== binding.treeSha) return refuse("the recorded candidate carries a different tree than its intent");

  const config = JSON.parse(state.status.configSnapshotJson) as AwsfConfig;
  const rows = protectedTreeDelta(git, binding.parentSha, binding.treeSha)
    .filter(row => config.policy.protected_paths.some(glob => matchesPathGlob(row.path, glob, false)));
  if (recoveryDigest(protectedContentDeltas(rows, grant.files)) !== recoveryDigest(binding.deltas)) {
    return refuse("the recorded candidate's protected delta differs from its intent");
  }
  for (const delta of binding.deltas) {
    const stat = lstatSync(join(root, delta.path));
    if (!stat.isFile() || stat.nlink !== 1 || ((stat.mode & 0o111) === 0 ? "100644" : "100755") !== delta.afterMode ||
        protectedBlobId(readProtectedContent(root, delta.path)) !== delta.afterBlob) {
      return refuse("the granted worktree bytes no longer match the recorded candidate");
    }
  }

  const head = runGit(git, ["rev-parse", "HEAD"]).trim();
  const index = sha256(readFileSync(context.indexPath));
  if (head === binding.parentSha && index === intent.beforeIndexDigest) return Object.freeze({ outcome: "unpublished" as const, candidateSha: binding.candidateSha });
  if (head === binding.candidateSha && index === intent.beforeIndexDigest) return Object.freeze({ outcome: "head-published" as const, candidateSha: binding.candidateSha });
  if (head === binding.candidateSha && index === intent.stagedIndexDigest) return Object.freeze({ outcome: "published" as const, candidateSha: binding.candidateSha });
  if (head !== binding.parentSha && head !== binding.candidateSha) return refuse("HEAD is neither the granted pre-write revision nor the recorded candidate");
  return refuse("the Git index is neither the exact pre-publication nor the exact staged bytes the intent recorded");
}

/** The pre-staged index the intent pinned, located by its own digest and by nothing else. */
export function stagedIndexBytes(attemptDir: string, intent: ProtectedCommitIntent): Buffer {
  const stagingRoot = join(attemptDir, "private", "protected-host");
  const matches: Buffer[] = [];
  let directories: readonly string[];
  try { directories = readdirSync(stagingRoot); }
  catch { throw new Error("the pre-staged index this publication needs was not retained"); }
  for (const name of directories) {
    const candidate = join(stagingRoot, name, "index");
    let bytes: Buffer;
    try { bytes = readFileSync(candidate); } catch { continue; }
    if (sha256(bytes) === intent.stagedIndexDigest) matches.push(bytes);
  }
  if (matches.length !== 1) throw new Error("the pre-staged index this publication needs is missing or ambiguous");
  return matches[0]!;
}

/**
 * Finish one interrupted protected publication, and nothing else.
 *
 * Every byte written here was fixed before the crash: the commit object already
 * exists, the HEAD move is a compare-and-swap against the granted pre-write
 * revision, and the index is the exact pre-staged file the intent pinned by
 * digest. Nothing is staged, recreated, reset or chosen. A publication whose
 * inspection did not name one outcome never reaches this function.
 */
export async function completeProtectedPublication(options: {
  readonly attemptDir: string;
  readonly state: ProtectedState;
  readonly intent: ProtectedCommitIntent;
  readonly publication: ProtectedPublication;
  readonly persistBinding: (binding: ProtectedCandidateBinding) => Promise<void>;
}): Promise<string> {
  const { attemptDir, intent, publication } = options;
  if (publication.outcome === "refused") throw new Error(`protected host-effect recovery refused: ${publication.reason}`);
  const context = protectedEffectContext(options.state, intent);
  const { binding, root, indexPath } = context;
  if (publication.outcome !== "published") {
    const staged = stagedIndexBytes(attemptDir, intent);
    const git = systemGitRunner(root);
    const lockPath = `${indexPath}.lock`;
    // A crash between the HEAD compare-and-swap and the index rename leaves the
    // interrupted run's own lock behind, already holding the staged bytes.
    // Adopting exactly those bytes completes the rename it did not reach; a
    // lock holding anything else belongs to somebody and is never taken.
    let existing: Buffer | null = null;
    try { existing = readFileSync(lockPath); } catch { existing = null; }
    if (existing !== null && sha256(existing) !== intent.stagedIndexDigest) {
      throw new Error("a Git index lock this publication did not write is present; recovery does not break another holder's lock");
    }
    const lock = existing === null ? openSync(lockPath, "wx", 0o600) : openSync(lockPath, "r+", 0o600);
    try {
      if (sha256(readFileSync(indexPath)) !== intent.beforeIndexDigest) throw new Error("the Git index changed before this publication could be completed");
      writeFileSync(lock, staged); fsyncSync(lock);
      if (publication.outcome === "unpublished") {
        // Compare-and-swap. If anything moved HEAD since the inspection above,
        // Git refuses and this leaves the repository untouched.
        runGit(git, ["-c", "core.fsync=all", "update-ref", "HEAD", binding.candidateSha, binding.parentSha]);
      }
      renameSync(lockPath, indexPath);
    } finally { closeSync(lock); }
    const indexDirectory = openSync(dirname(indexPath), "r");
    try { fsyncSync(indexDirectory); } finally { closeSync(indexDirectory); }
  }
  const git = protectedReadOnlyGit(root);
  if (runGit(git, ["rev-parse", "HEAD"]).trim() !== binding.candidateSha ||
      runGit(git, ["rev-parse", `${binding.candidateSha}^{tree}`]).trim() !== binding.treeSha ||
      sha256(readFileSync(indexPath)) !== intent.stagedIndexDigest) {
    throw new Error("protected publication could not be verified after completion");
  }
  await options.persistBinding(binding);
  return binding.candidateSha;
}
