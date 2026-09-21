import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
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
import { assertOwnExecutionLease } from "../execution/operation-lease.ts";
import type { ProtectedCommitIntent } from "./protected-commit.ts";

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/**
 * Read one Git control file through a descriptor that cannot have been
 * redirected under us.
 *
 * `O_NOFOLLOW` refuses a symbolic link outright, and every remaining property —
 * regular file, one link, owned by this user — is taken from the *descriptor*
 * rather than from the name, so nothing can be swapped between the check and
 * the read. A path that fails any of these is not the file the intent measured,
 * whatever its bytes say.
 */
function readOwnedRegularFile(path: string, what: string, privacy: Privacy): Buffer {
  let descriptor: number;
  try { descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") throw new Error(`${what} is a symbolic link; protected recovery never reads or writes through one`);
    throw error;
  }
  try {
    assertOwnedRegular(fstatSync(descriptor), what, privacy);
    return readFileSync(descriptor);
  } finally { closeSync(descriptor); }
}

/**
 * Whose decision this file's permission bits are.
 *
 * `owner-private` is for a file *this codebase* creates with an explicit mode
 * and can therefore insist on. Exactly one file qualifies: the retained
 * `index.lock`, which `commitProtectedAsHost` opens `wx, 0o600`. Group or other
 * bits on that file mean it is not the file this code wrote.
 *
 * `inherited` is for a file whose mode somebody else chose — the working index
 * (Git's, normally `0644`) and the pre-staged index (also written by Git, into
 * a `0700` directory this codebase does create). Demanding privacy of those
 * would refuse honest repositories on every filesystem, not just an unusual
 * one. Their protection is the containing directory's mode, checked where they
 * are read. The mode claim is dropped here because AWSF does not own that
 * decision — never as a way around a filesystem that is inconvenient.
 */
type Privacy = "owner-private" | "inherited";

function assertOwnedRegular(stat: { isFile: () => boolean; nlink: number; mode: number; uid: number }, what: string, privacy: Privacy): void {
  if (!stat.isFile() || stat.nlink !== 1 || (process.getuid !== undefined && stat.uid !== process.getuid())) {
    throw new Error(`${what} is not a regular, single-link file owned by this user`);
  }
  if (privacy === "owner-private" && (stat.mode & 0o077) !== 0) {
    throw new Error(`${what} is reachable by other accounts (mode ${(stat.mode & 0o7777).toString(8)}); ` +
      "protected recovery only adopts a lock whose permissions it wrote itself");
  }
}

/** A directory this codebase created `0700` and still expects to be its own. */
function assertPrivateDirectory(path: string, what: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0 || (process.getuid !== undefined && stat.uid !== process.getuid())) {
    throw new Error(`${what} is not an owner-private directory`);
  }
}

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

/**
 * Take over the interrupted run's own `index.lock`, or refuse.
 *
 * A crash between the HEAD compare-and-swap and the index rename leaves that
 * lock behind holding the staged bytes, and renaming it is literally the step
 * the dead process did not reach. Matching bytes alone do not license that:
 * they say what a file contains, not who owns it or whether anybody is still
 * working. The licence comes from four facts that have to hold together, and
 * the caller supplies the two that matter most.
 *
 * 1. **Those bytes could only have come from this run.** They are the exact
 *    digest of an index built in `<attemptDir>/private/protected-host/<mkdtemp>`
 *    — a `0700` directory on the attempt's own filesystem, never handed to any
 *    other process. Nothing else on this machine can produce them.
 * 2. **No other Git process holds this index lock.** Git's lock is exclusive by
 *    existence: a second Git cannot create `index.lock` while this one exists.
 *    So whatever else is true, no concurrent Git operation is mid-protocol
 *    here.
 * 3. **The run that wrote it is dead.** `commitProtectedAsHost` executes under
 *    this attempt's execution lease. `assertOwnExecutionLease` proves that this
 *    process now holds that lease, and taking it required
 *    `assertNoExecutionController` to find no live controller. The writer was a
 *    controller; there is none; the writer is gone.
 * 4. **The file is what it claims to be.** Not a symbolic link, one link only
 *    (so not an alias into another tree), owned by this user, and carrying the
 *    `0600` mode this codebase writes — all read from a single `O_NOFOLLOW`
 *    descriptor, so nothing can be substituted between the check and the use.
 *
 * `visibleDescriptorHolders` is defence in depth on top of that, not a leg of
 * the argument: seeing a holder refuses, but seeing none proves nothing, since
 * a lock owner need hold no descriptor.
 *
 * Anything that fails belongs to somebody else. This never unlinks, truncates
 * or writes over a lock it has not established is its own, and `null` — no lock
 * at all — is the only case in which a new one is created.
 */
function adoptRetainedIndexLock(lockPath: string, stagedIndexDigest: string): number | null {
  let descriptor: number;
  try { descriptor = openSync(lockPath, constants.O_RDWR | constants.O_NOFOLLOW); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    if (code === "ELOOP") throw new Error("the retained Git index lock is a symbolic link; recovery does not write through one");
    throw error;
  }
  try {
    const stat = fstatSync(descriptor);
    assertOwnedRegular(stat, "the retained Git index lock", "owner-private");
    if (sha256(readFileSync(descriptor)) !== stagedIndexDigest) {
      throw new Error("a Git index lock this publication did not write is present; recovery does not break another holder's lock");
    }
    const holders = visibleDescriptorHolders(stat.dev, stat.ino);
    if (holders.length > 0) {
      throw new Error(`the retained Git index lock is still open in live process(es) ${holders.join(", ")}; recovery never takes a lock somebody is holding`);
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
  // that run's death a fact rather than an assumption, and it is the leg the
  // lock adoption below actually stands on.
  await assertOwnExecutionLease(attemptDir);
  const context = protectedEffectContext(options.state, intent);
  const { binding, root, indexPath } = context;
  if (publication.outcome !== "published") {
    const staged = stagedIndexBytes(attemptDir, intent);
    const git = systemGitRunner(root);
    const lockPath = `${indexPath}.lock`;
    const adopted = adoptRetainedIndexLock(lockPath, intent.stagedIndexDigest);
    const lock = adopted ?? openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      if (sha256(readOwnedRegularFile(indexPath, "the Git index", "inherited")) !== intent.beforeIndexDigest) throw new Error("the Git index changed before this publication could be completed");
      // An adopted lock already holds exactly these bytes, proved through its
      // own descriptor. Rewriting them would buy nothing and would make a
      // refusal after this point less inert than it is.
      if (adopted === null) writeFileSync(lock, staged);
      fsyncSync(lock);
      if (publication.outcome === "unpublished") {
        // Compare-and-swap. If anything moved HEAD since the inspection above,
        // Git refuses and this leaves the repository untouched.
        runGit(git, ["-c", "core.fsync=all", "update-ref", "HEAD", binding.candidateSha, binding.parentSha]);
      }
      options.afterHeadPublished?.();
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
