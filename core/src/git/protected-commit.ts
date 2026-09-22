import { closeSync, constants, fsyncSync, lstatSync, mkdtempSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { runSystemCommand } from "../execution/transport-broker.ts";
import { ownExecutionLease } from "../execution/operation-lease.ts";
import { assertWitnessedLockAtMutationBoundary, captureLockWitness, readOwnedRegularFile, type ProtectedLockWitness } from "./protected-lock.ts";
import { runGit, systemGitRunner, type GitRunner } from "./changes.ts";
import { protectedContentDeltas, protectedTreeDelta } from "./protected-delta.ts";
import { protectedWriteContext, type ProtectedFilesCapability } from "../contracts/protected-capability.ts";
import type { ProtectedCandidateBinding } from "../contracts/protected-grant.ts";
import { assertExactProtectedPath } from "../contracts/protected-grant.ts";
import { assertProtectedOutput, assertProtectedExecutionProof, candidateBinding, readProtectedState } from "../workflow/protected-grants.ts";
import { inspectProtectedPhysicalPath, treeFile, readProtectedContent } from "../workflow/protected-files.ts";
import { enforcePathPolicy, matchesPathGlob } from "../policy/path-policy.ts";

export interface ProtectedCommitIntent {
  readonly binding: ProtectedCandidateBinding;
  readonly beforeIndexDigest: string;
  readonly stagedIndexDigest: string;
}
const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** One candidate, staged without filters/hooks, verified before HEAD CAS; never resets the worktree. */
export async function commitProtectedAsHost(options: {
  attemptDir: string; capability: ProtectedFilesCapability; message: string; paths: readonly string[];
  writes: readonly string[]; protectedPaths: readonly string[];
  /**
   * Interruption seam after the HEAD CAS and before index installation.
   *
   * Throwing here models a handled interruption, which this function finishes
   * and then re-raises. Killing the process here models the other half — the
   * one only `awsf resume` can reconcile.
   */
  afterHeadPublished?: () => Promise<void> | void;
  persistIntent: (intent: ProtectedCommitIntent) => Promise<void>;
  /**
   * The lock's creation record, durable BEFORE anything is published.
   *
   * Without it a crash leaves an `index.lock` that no later reconciliation can
   * attribute — matching bytes and owner-private permissions are consistent
   * with an ordinary same-user Git having taken the lock in the meantime, and
   * consistency is not identity.
   */
  persistWitness: (witness: ProtectedLockWitness) => Promise<void>;
  persistBinding: (binding: ProtectedCandidateBinding) => Promise<void>;
  /** Wall clock for the witness record. Injectable so a test can pin it; defaults to now. */
  now?: () => string;
}): Promise<string | null> {
  // Leg 3 of the adoption argument, enforced at the writer rather than left
  // ambient in whatever wrapper happened to call this. Everything a later
  // recovery concludes from "the writer held this attempt's execution lease"
  // is only as good as this line, and it is the first thing this function does
  // so that a caller outside a lease changes nothing at all.
  const lease = await ownExecutionLease(options.attemptDir);
  const proof = protectedWriteContext(options.capability);
  if (proof === null) throw new Error("protected commit requires host permission authority");
  const { grant, consumption } = proof;
  if (JSON.stringify(options.writes) !== JSON.stringify(proof.policy.writes) || JSON.stringify(options.protectedPaths) !== JSON.stringify(proof.policy.protectedPaths)) throw new Error("protected commit policy differs from its launch authority");
  const root = grant.subject.worktree; const git = systemGitRunner(root);
  const state = readProtectedState(options.attemptDir);
  if (state.status.process !== null || state.bindings.some(value => value.consumptionId === consumption.id) || state.records.some(record => record.event.evidence?.type === "protected-commit-intent" && record.event.evidence.intent.binding.consumptionId === consumption.id)) throw new Error("protected host effect is active or already started; no automatic replay");
  assertProtectedExecutionProof(state, consumption);
  assertProtectedOutput(options.capability, root);
  enforcePathPolicy(options.paths, { writes: options.writes, protectedPaths: options.protectedPaths, protectedCapability: options.capability });
  if (options.paths.length === 0) throw new Error("protected generation produced no candidate changes; no automatic replay is authorized");
  const indexPath = runGit(git, ["rev-parse", "--path-format=absolute", "--git-path", "index"]).trim();
  const beforeIndex = readFileSync(indexPath);
  const stagingRoot = join(options.attemptDir, "private", "protected-host");
  mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
  const stage = mkdtempSync(join(stagingRoot, "candidate-"));
  const privateIndex = join(stage, "index");
  const env = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    GIT_INDEX_FILE: privateIndex, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "Santiago Marin", GIT_AUTHOR_EMAIL: "santiagomarinsuarez@me.com", GIT_COMMITTER_NAME: "Santiago Marin", GIT_COMMITTER_EMAIL: "santiagomarinsuarez@me.com" };
  const stagedGit: GitRunner = argv => runSystemCommand("git", ["-C", root, "-c", "core.fsync=all", ...argv], { timeoutMs: 30_000, env });
  runGit(stagedGit, ["read-tree", grant.subject.preWriteHeadSha]);
  const snapshots = new Map<string, string>();
  let totalBytes = 0;
  for (const [index, path] of options.paths.entries()) {
    assertExactProtectedPath(path);
    inspectProtectedPhysicalPath(root, path);
    const physical = join(root, path); const stat = lstatSync(physical);
    if (!stat.isFile() || stat.nlink !== 1 || stat.isSymbolicLink() || (stat.mode & 0o7000) !== 0) throw new Error("grant-bearing execution only commits regular single-link content");
    const old = treeFile(git, grant.subject.preWriteHeadSha, path);
    const mode = (stat.mode & 0o111) === 0 ? "100644" : "100755";
    if (mode !== (old?.mode ?? "100644")) throw new Error("grant-bearing execution cannot change executable modes");
    const bytes = readProtectedContent(root, path); totalBytes += bytes.length;
    if (totalBytes > 64 * 1024 * 1024) throw new Error("protected candidate exceeds its bounded content snapshot");
    snapshots.set(path, digest(bytes));
    const snapshotPath = join(stage, `content-${index}`); writeFileSync(snapshotPath, bytes, { mode: 0o600, flag: "wx" });
    const blob = runGit(stagedGit, ["hash-object", "-w", "--no-filters", "--", snapshotPath]).trim();
    runGit(stagedGit, ["update-index", "--add", "--cacheinfo", mode, blob, path]);
  }
  const tree = runGit(stagedGit, ["write-tree"]).trim();
  const rows = protectedTreeDelta(git, grant.subject.preWriteHeadSha, tree);
  if (JSON.stringify(rows.map(row => row.path).sort()) !== JSON.stringify([...options.paths].sort())) throw new Error("protected staged tree differs from the host-observed path set");
  const protectedRows = rows.filter(row => options.protectedPaths.some(glob => matchesPathGlob(row.path, glob, false)));
  const deltas = protectedContentDeltas(protectedRows, grant.files);
  assertProtectedOutput(options.capability, root);
  const candidate = runGit(stagedGit, ["commit-tree", tree, "-p", grant.subject.preWriteHeadSha, "-m", options.message]).trim();
  const binding = candidateBinding(options.capability, tree, candidate, deltas);
  const stagedIndex = readFileSync(privateIndex);
  await options.persistIntent({ binding, beforeIndexDigest: digest(beforeIndex), stagedIndexDigest: digest(stagedIndex) });
  assertProtectedOutput(options.capability, root);
  for (const [path, expected] of snapshots) {
    const stat = lstatSync(join(root, path));
    if (!stat.isFile() || stat.nlink !== 1 || digest(readProtectedContent(root, path)) !== expected) throw new Error("protected candidate bytes changed before publication");
  }
  const lockPath = `${indexPath}.lock`;
  // `O_EXCL` is the lock — Git's index lock is exclusive by existence, and this
  // is how it is taken. `O_RDWR` rather than write-only because the bytes
  // written below have to be read back through this same descriptor: once to
  // witness them, and again at the mutation boundary. Reading by name instead
  // would defeat the point of holding a descriptor at all.
  const lock = openSync(lockPath, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL, 0o600);
  let headPublished = false;
  /** The durable creation record for the lock now open above, once it exists. */
  let witness: ProtectedLockWitness | null = null;
  /** A caught interruption after the HEAD CAS. Finished below, then re-thrown. */
  let interruption: unknown = null;
  try {
    if (digest(readFileSync(indexPath)) !== digest(beforeIndex)) throw new Error("protected index changed before publication");
    writeFileSync(lock, stagedIndex); fsyncSync(lock);
    // The bytes are final and nothing has been published yet, so the identity
    // measured here is the identity this file keeps until it is renamed onto
    // the index. Durable before the compare-and-swap, because a lock created
    // and then lost to a crash before its witness is a lock nobody can prove is
    // ours — and that has to refuse rather than be adopted on resemblance.
    const current = await ownExecutionLease(options.attemptDir);
    if (current.id !== lease.id) throw new Error("the attempt's execution lease changed owner mid-publication");
    witness = captureLockWitness({ descriptor: lock, writer: "host-commit", supersedes: null,
      lockPath, indexPath, worktree: root, worktreeGitDir: grant.subject.worktreeGitDir,
      grantId: binding.grantId, consumptionId: binding.consumptionId, candidateSha: binding.candidateSha,
      parentSha: binding.parentSha, treeSha: binding.treeSha,
      beforeIndexDigest: digest(beforeIndex), stagedIndexDigest: digest(stagedIndex),
      controller: { leaseId: current.id, pid: current.pid, startIdentity: current.startIdentity },
      now: options.now ?? (() => new Date().toISOString()) });
    await options.persistWitness(witness);
    runGit(git, ["-c", "core.fsync=all", "update-ref", "HEAD", candidate, grant.subject.preWriteHeadSha]);
    headPublished = true;
    await options.afterHeadPublished?.();
    assertWitnessedLockAtMutationBoundary(lock, lockPath, witness, "the Git index lock this publication created");
    renameSync(lockPath, indexPath);
  } catch (error) {
    if (!headPublished) throw error;
    // The compare-and-swap has already published this exact authorized
    // candidate. Installing the index it was staged against is the remainder of
    // that one act — same process, same execution lease, same one-use
    // authority, and before anything can seal this attempt — so finishing it
    // here is completion, not a retry: no object is created, no outcome is
    // chosen and no rule about sealed attempts is relaxed. Leaving it instead
    // strands a paid, owner-granted generation behind a sealed state that
    // correctly refuses to bind it.
    //
    // A handled interruption only. Process death still lands in `awsf resume`'s
    // reconciliation, which is the same completion proved from durable evidence.
    interruption = error;
    // If even the rename cannot be completed — or the lock is no longer
    // provably the one this publication created — the original interruption is
    // what the caller sees, and the retained lock, index and evidence are left
    // exactly as the recovery path expects to find them.
    try {
      if (witness === null) throw error;
      assertWitnessedLockAtMutationBoundary(lock, lockPath, witness, "the Git index lock this publication created");
      renameSync(lockPath, indexPath);
    } catch { throw error; }
  } finally { closeSync(lock); }
  const indexDirectory = openSync(dirname(indexPath), "r");
  try { fsyncSync(indexDirectory); } finally { closeSync(indexDirectory); }
  // HEAD, the tree AND the index. The index digest is checked here for the same
  // reason the recovery path checks it: `rename(2)` takes names, so between the
  // descriptor checks above and the rename a same-uid process can still swap
  // the source. Verifying the installed bytes turns that residual into detected
  // damage before any binding becomes durable, instead of silence.
  if (runGit(git, ["rev-parse", "HEAD"]).trim() !== candidate || runGit(git, ["rev-parse", `${candidate}^{tree}`]).trim() !== tree ||
      digest(readOwnedRegularFile(indexPath, "the Git index", "inherited")) !== digest(stagedIndex)) {
    throw new Error("protected candidate publication could not be verified", interruption === null ? undefined : { cause: interruption });
  }
  await options.persistBinding(binding);
  if (interruption !== null) throw interruption;
  return candidate;
}
