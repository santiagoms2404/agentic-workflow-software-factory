import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { recoveryDigest } from "../contracts/phase-recovery.ts";
import type { ProtectedCandidateBinding, ProtectedGrant, ProtectedGrantConsumption } from "../contracts/protected-grant.ts";
import type { AwsfConfig } from "../config/schema.ts";
import { runGit, systemGitRunner } from "./changes.ts";
import { protectedContentDeltas, protectedTreeDelta } from "./protected-delta.ts";
import { matchesPathGlob } from "../policy/path-policy.ts";
import { protectedBlobId, protectedReadOnlyGit, readProtectedContent, verifyProtectedFilesystem } from "../workflow/protected-files.ts";
import { assertProtectedExecutionProof, type ProtectedState } from "../workflow/protected-grants.ts";
import { assertControllerSettled, ownExecutionLease, type Holder } from "../execution/operation-lease.ts";
import { assertOwnedRegular, assertPrivateDirectory, assertWitnessedLockAtMutationBoundary, captureLockWitness,
  descriptorDigest, lockIdentityDrift, lockIdentityOf, readOwnedRegularFile, type ProtectedLockWitness } from "./protected-lock.ts";
import type { ProtectedCommitIntent } from "./protected-commit.ts";

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/**
 * Processes seen holding this exact inode open — an opportunistic refusal
 * trigger, and deliberately not a proof of anything.
 *
 * Git's index lock is exclusive **by existence**: `O_CREAT | O_EXCL` creates it
 * and a rename or unlink releases it. Its owner need hold no descriptor at all,
 * and routinely does not. An empty result here therefore says nothing about who
 * owns the lock, and this function must never be read as establishing
 * exclusivity. Three further reasons it cannot: `/proc` visibility can be
 * restricted even for this user's own processes (`hidepid`, a PID namespace); a
 * holder can open the file in the instant after the scan returns; and a process
 * that has closed its descriptor still owns the lock.
 *
 * Only one direction is sound, and only that one is used: if somebody is
 * visibly holding the file, something is wrong and recovery stops. Exclusivity
 * itself is established by the argument in `adoptRetainedIndexLock`, which does
 * not rest on this.
 *
 * Because nothing is claimed from an empty result, a process this user cannot
 * see into is skipped rather than refused — on any shared host most processes
 * are unreadable, and turning that into a hard failure would buy no safety the
 * argument does not already have.
 */
function visibleDescriptorHolders(device: number, inode: number): readonly number[] {
  if (process.platform !== "linux") return [];
  const holders: number[] = [];
  let processes: readonly string[];
  try { processes = readdirSync("/proc"); } catch { return []; }
  for (const entry of processes) {
    if (!/^[0-9]+$/u.test(entry)) continue;
    const pid = Number(entry);
    if (pid === process.pid) continue;
    let descriptors: readonly string[];
    try { descriptors = readdirSync(`/proc/${entry}/fd`); } catch { continue; }
    for (const descriptor of descriptors) {
      try {
        const target = statSync(`/proc/${entry}/fd/${descriptor}`);
        if (target.dev === device && target.ino === inode) { holders.push(pid); break; }
      } catch { /* the descriptor or the process disappeared mid-scan, so it holds nothing now */ }
    }
  }
  return holders;
}

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

/**
 * Re-prove, from scratch, that this is still the machine the grant was issued
 * against — and locate the index by that proof rather than by asking Git.
 *
 * Every caller here is about to decide whether an effect happened, and two of
 * them are about to write. Neither may rely on identities established before
 * the crash: the original physical roots and both Git directories are compared
 * again, the granted paths are re-walked for symlinks, type, link count and
 * ownership, and the original one-use OS-enforced execution is re-proved from
 * the journal. The index path is then derived from the *verified* worktree Git
 * directory, because `rev-parse --git-path` honours an inherited
 * `GIT_INDEX_FILE` and would happily name a file the intent never measured.
 * Git's own answer is still consulted, and a disagreement refuses by name.
 */
export function protectedEffectContext(state: ProtectedState, intent: ProtectedCommitIntent): ProtectedEffectContext {
  const grant = state.grants.find(value => value.id === intent.binding.grantId);
  const consumption = state.consumptions.find(value => value.id === intent.binding.consumptionId);
  if (grant === undefined || consumption === undefined) throw new Error("protected host effect has no issued generation");
  assertProtectedExecutionProof(state, consumption);
  verifyProtectedFilesystem(grant, true);
  const root = grant.subject.worktree;
  const git = protectedReadOnlyGit(root);
  if (runGit(git, ["rev-parse", "--absolute-git-dir"]).trim() !== grant.subject.worktreeGitDir) throw new Error("the worktree Git directory is not the one this grant was issued against");
  if (runGit(git, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim() !== grant.subject.commonGitDir) throw new Error("the common Git directory is not the one this grant was issued against");
  const indexPath = join(grant.subject.worktreeGitDir, "index");
  if (runGit(git, ["rev-parse", "--path-format=absolute", "--git-path", "index"]).trim() !== indexPath) throw new Error("the Git index path is redirected away from the granted worktree Git directory");
  assertOwnedRegular(lstatSync(indexPath), "the Git index", "inherited");
  return Object.freeze({ grant, consumption, binding: intent.binding, root, indexPath });
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
  const index = sha256(readOwnedRegularFile(context.indexPath, "the Git index", "inherited"));
  if (head === binding.parentSha && index === intent.beforeIndexDigest) return Object.freeze({ outcome: "unpublished" as const, candidateSha: binding.candidateSha });
  if (head === binding.candidateSha && index === intent.beforeIndexDigest) return Object.freeze({ outcome: "head-published" as const, candidateSha: binding.candidateSha });
  if (head === binding.candidateSha && index === intent.stagedIndexDigest) return Object.freeze({ outcome: "published" as const, candidateSha: binding.candidateSha });
  if (head !== binding.parentSha && head !== binding.candidateSha) return refuse("HEAD is neither the granted pre-write revision nor the recorded candidate");
  return refuse("the Git index is neither the exact pre-publication nor the exact staged bytes the intent recorded");
}

/**
 * The pre-staged index the intent pinned, located by its own digest and by
 * nothing else.
 *
 * These bytes are the reason a retained lock can be attributed to this run at
 * all, so their own protection has to hold: the staging root and each candidate
 * directory are `0700` directories this codebase created, on the attempt's
 * filesystem — the same one whose modes `readProtectedState` already relies on
 * for the journal. The index file inside is written by Git and carries Git's
 * mode, which is why the directory is what is checked and not the file.
 */
export function stagedIndexBytes(attemptDir: string, intent: ProtectedCommitIntent): Buffer {
  const stagingRoot = join(attemptDir, "private", "protected-host");
  const matches: Buffer[] = [];
  let directories: readonly string[];
  try { directories = readdirSync(stagingRoot); }
  catch { throw new Error("the pre-staged index this publication needs was not retained"); }
  assertPrivateDirectory(stagingRoot, "the protected staging root");
  for (const name of directories) {
    const candidate = join(stagingRoot, name, "index");
    let bytes: Buffer;
    try {
      assertPrivateDirectory(join(stagingRoot, name), `the retained staging directory ${name}`);
      bytes = readOwnedRegularFile(candidate, `the retained staged index ${name}`, "inherited");
    } catch { continue; }
    if (sha256(bytes) === intent.stagedIndexDigest) matches.push(bytes);
  }
  if (matches.length !== 1) throw new Error("the pre-staged index this publication needs is missing or ambiguous");
  return matches[0]!;
}

/** The current creation record for this publication's index lock, or null if none was ever durable. */
export function retainedLockWitness(state: ProtectedState, intent: ProtectedCommitIntent): ProtectedLockWitness | null {
  return state.witnesses.filter(witness => witness.consumptionId === intent.binding.consumptionId).at(-1) ?? null;
}

/**
 * The witness is this publication's, and describes this repository.
 *
 * Journal reading already binds a witness to its intent; this is the same
 * question asked again at the point of use, plus the part the journal cannot
 * see — that the paths it was written against are the paths being completed.
 * A grant whose roots or Git directory moved is refused upstream by
 * `protectedEffectContext`; this refuses the narrower case of a witness that
 * was recorded somewhere else entirely.
 */
function assertWitnessDescribesPublication(witness: ProtectedLockWitness, intent: ProtectedCommitIntent,
  context: ProtectedEffectContext, lockPath: string): void {
  const binding = intent.binding;
  if (witness.consumptionId !== binding.consumptionId || witness.grantId !== binding.grantId ||
      witness.candidateSha !== binding.candidateSha || witness.parentSha !== binding.parentSha || witness.treeSha !== binding.treeSha ||
      witness.beforeIndexDigest !== intent.beforeIndexDigest || witness.stagedIndexDigest !== intent.stagedIndexDigest ||
      witness.contentDigest !== intent.stagedIndexDigest) {
    throw new Error("the retained Git index lock's durable witness belongs to a different protected publication");
  }
  if (witness.lockPath !== lockPath || witness.indexPath !== context.indexPath ||
      witness.worktree !== context.root || witness.worktreeGitDir !== context.grant.subject.worktreeGitDir) {
    throw new Error("the retained Git index lock's durable witness was recorded against a different worktree, Git directory or lock path");
  }
}

/**
 * Take over the interrupted run's own `index.lock`, or refuse.
 *
 * A crash between the HEAD compare-and-swap and the index rename leaves that
 * lock behind holding the staged bytes, and renaming it is literally the step
 * the dead process did not reach. **Matching bytes do not license that, and
 * neither do owner-private permissions plus a live AWSF lease.** Git's lock is
 * exclusive *by existence*, so an ordinary same-user `git add` or `git status`
 * in this worktree can create a replacement `index.lock` at `0600`, write an
 * index, close every descriptor and go on owning it — without ever taking this
 * attempt's lease or touching its journal. Against a `head-published` tree,
 * where HEAD is already the candidate and the working files are the candidate's
 * content, that foreign Git can even stage byte-identical bytes. Adopting it
 * would destroy a live holder's lock and its in-flight index.
 *
 * So exclusivity *now* is not continuity *since our writer*, and the gap is
 * closed by recording identity at creation rather than by inferring it
 * afterwards. Adoption needs all of:
 *
 * 1. **A durable creation witness exists for this publication.** Written by
 *    whichever half created the lock — the transport or an earlier
 *    reconciliation — after its bytes were final and before anything was
 *    published. No witness means the lock cannot be attributed at all, and that
 *    refuses. (A crash in the gap between creation and witness lands here, by
 *    design: unprovable is not adoptable.)
 * 2. **The file at `lockPath` is that exact inode.** `dev`, `ino`, `ctimeNs`,
 *    `mtimeNs`, size, mode, uid, gid and link count are compared against the
 *    witness through one `O_NOFOLLOW` descriptor. `ctimeNs` is why a recycled
 *    inode or a same-byte replacement does not pass: an unprivileged process
 *    cannot set it, and every operation that would forge it moves it to now.
 * 3. **It still holds the witnessed bytes**, digested from that same
 *    descriptor — and those bytes are the exact pre-staged index the intent
 *    pinned, built in a `0700` directory on the attempt's own filesystem.
 * 4. **The controller that created it is settled.** The witness names the
 *    execution-lease holder by pid and start identity. Either that is this very
 *    process — which holds the lease now, proved separately — or the census
 *    must show it is no longer running.
 * 5. **The file is what it claims to be**: not a symbolic link (`ELOOP` refuses
 *    by name), regular, exactly one link, owned by this user, and carrying the
 *    `0600` mode this codebase writes. All from that one descriptor.
 *
 * `visibleDescriptorHolders` sits on top as defence in depth, not as a leg:
 * seeing a holder refuses, seeing none proves nothing, since a lock owner need
 * hold no descriptor.
 *
 * Anything that fails belongs to somebody else, or cannot be shown not to. This
 * never unlinks, truncates or writes over a lock it has not established is its
 * own — a refusal here leaves the lock, the index, HEAD and the journal exactly
 * as they were — and `null`, no lock at all, is the only case in which a new one
 * is created.
 */
function adoptRetainedIndexLock(lockPath: string, intent: ProtectedCommitIntent, witness: ProtectedLockWitness | null,
  context: ProtectedEffectContext, lease: Holder): number | null {
  let descriptor: number;
  try { descriptor = openSync(lockPath, constants.O_RDWR | constants.O_NOFOLLOW); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    if (code === "ELOOP") throw new Error("the retained Git index lock is a symbolic link; recovery does not write through one");
    throw error;
  }
  try {
    const stat = fstatSync(descriptor, { bigint: true });
    assertOwnedRegular(stat, "the retained Git index lock", "owner-private");
    if (descriptorDigest(descriptor) !== intent.stagedIndexDigest) {
      throw new Error("a Git index lock this publication did not write is present; recovery does not break another holder's lock");
    }
    const holders = visibleDescriptorHolders(Number(stat.dev), Number(stat.ino));
    if (holders.length > 0) {
      throw new Error(`the retained Git index lock is still open in live process(es) ${holders.join(", ")}; recovery never takes a lock somebody is holding`);
    }
    if (witness === null) {
      throw new Error("the retained Git index lock has no durable creation witness, so recovery cannot show this publication created it " +
        "rather than an ordinary same-user Git; HEAD, the index, the lock and the journal are left exactly as they are");
    }
    assertWitnessDescribesPublication(witness, intent, context, lockPath);
    const drift = lockIdentityDrift(lockIdentityOf(stat), witness.identity);
    if (drift !== null) {
      throw new Error(`the retained Git index lock is not the file this publication created (${drift} differs from its durable creation witness); ` +
        "recovery neither adopts nor breaks a lock it cannot identify");
    }
    if (witness.controller.pid !== lease.pid || witness.controller.startIdentity !== lease.startIdentity) {
      assertControllerSettled(witness.controller, "the retained Git index lock");
    }
    return descriptor;
  } catch (error) { closeSync(descriptor); throw error; }
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
  /**
   * The creation record for a lock THIS reconciliation creates, durable before
   * it publishes anything. A recovery that dies mid-protocol leaves exactly the
   * state the next one has to reason about, so it owes the next one the same
   * evidence the transport owes it.
   */
  readonly persistWitness: (witness: ProtectedLockWitness) => Promise<void>;
  /** Wall clock for that record. Injectable so a test can pin it; defaults to now. */
  readonly now?: () => string;
  /**
   * Interruption seam at the same boundary `commitProtectedAsHost` has one:
   * after the HEAD compare-and-swap, before the index is installed. It exists
   * so a test can be killed here for real, leaving a `head-published`
   * repository no `finally` block ever tidied.
   */
  readonly afterHeadPublished?: () => void;
}): Promise<string> {
  const { attemptDir, intent, publication } = options;
  if (publication.outcome === "refused") throw new Error(`protected host-effect recovery refused: ${publication.reason}`);
  // The lease is what the interrupted run held. Holding it here is what makes
  // that run's death a fact rather than an assumption — and the holder itself
  // is needed below, to tell "the writer was me, before the interruption" from
  // "the writer was another process, which had better be gone".
  const lease = await ownExecutionLease(attemptDir);
  const context = protectedEffectContext(options.state, intent);
  const { binding, root, indexPath } = context;
  if (publication.outcome !== "published") {
    const staged = stagedIndexBytes(attemptDir, intent);
    const git = systemGitRunner(root);
    const lockPath = `${indexPath}.lock`;
    const retained = retainedLockWitness(options.state, intent);
    const adopted = adoptRetainedIndexLock(lockPath, intent, retained, context, lease);
    const lock = adopted ?? openSync(lockPath, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    let witness = retained;
    try {
      if (sha256(readOwnedRegularFile(indexPath, "the Git index", "inherited")) !== intent.beforeIndexDigest) throw new Error("the Git index changed before this publication could be completed");
      // An adopted lock already holds exactly these bytes, proved through its
      // own descriptor. Rewriting them would buy nothing and would make a
      // refusal after this point less inert than it is.
      if (adopted === null) writeFileSync(lock, staged);
      fsyncSync(lock);
      if (adopted === null) {
        // A lock this reconciliation created. Its identity is recorded before
        // the compare-and-swap for the same reason the transport records its
        // own: the next recovery must be able to prove where it came from, and
        // a resemblance argument is exactly what this change removes.
        witness = captureLockWitness({ descriptor: lock, writer: "recovery", supersedes: retained?.id ?? null,
          lockPath, indexPath, worktree: root, worktreeGitDir: context.grant.subject.worktreeGitDir,
          grantId: binding.grantId, consumptionId: binding.consumptionId, candidateSha: binding.candidateSha,
          parentSha: binding.parentSha, treeSha: binding.treeSha, beforeIndexDigest: intent.beforeIndexDigest,
          stagedIndexDigest: intent.stagedIndexDigest,
          controller: { leaseId: lease.id, pid: lease.pid, startIdentity: lease.startIdentity },
          now: options.now ?? (() => new Date().toISOString()) });
        await options.persistWitness(witness);
      }
      if (publication.outcome === "unpublished") {
        // Compare-and-swap. If anything moved HEAD since the inspection above,
        // Git refuses and this leaves the repository untouched.
        runGit(git, ["-c", "core.fsync=all", "update-ref", "HEAD", binding.candidateSha, binding.parentSha]);
      }
      options.afterHeadPublished?.();
      // Before installation, not after it: the lock we are about to install is
      // re-proved to be the witnessed inode, holding the witnessed bytes, still
      // reachable at the name we are about to rename. A failure here leaves the
      // index and that file untouched — but for an `unpublished` cut the
      // compare-and-swap above has already run, so what it leaves is the
      // `head-published` state, not the pre-publication one. What remains after
      // it is the rename's own name-resolution window, which no Linux call can
      // close.
      if (witness === null) throw new Error("this publication has no durable creation witness for the lock it is about to install");
      assertWitnessedLockAtMutationBoundary(lock, lockPath, witness, "the Git index lock this publication is installing");
      renameSync(lockPath, indexPath);
    } finally { closeSync(lock); }
    const indexDirectory = openSync(dirname(indexPath), "r");
    try { fsyncSync(indexDirectory); } finally { closeSync(indexDirectory); }
  }
  const git = protectedReadOnlyGit(root);
  if (runGit(git, ["rev-parse", "HEAD"]).trim() !== binding.candidateSha ||
      runGit(git, ["rev-parse", `${binding.candidateSha}^{tree}`]).trim() !== binding.treeSha ||
      sha256(readOwnedRegularFile(indexPath, "the Git index", "inherited")) !== intent.stagedIndexDigest) {
    throw new Error("protected publication could not be verified after completion");
  }
  await options.persistBinding(binding);
  return binding.candidateSha;
}
