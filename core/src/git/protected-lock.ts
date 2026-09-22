import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";

/**
 * Whose decision a Git control file's permission bits are.
 *
 * `owner-private` is for a file *this codebase* creates with an explicit mode
 * and can therefore insist on. Exactly one file qualifies: the retained
 * `index.lock`, which the protected transport opens `wx, 0o600`. Group or other
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
export type Privacy = "owner-private" | "inherited";

/** Accepts both `Stats` and `BigIntStats`, so one `fstat` can serve every check. */
interface OwnedRegularStat { isFile: () => boolean; nlink: number | bigint; mode: number | bigint; uid: number | bigint }

export function assertOwnedRegular(stat: OwnedRegularStat, what: string, privacy: Privacy): void {
  if (!stat.isFile() || Number(stat.nlink) !== 1 || (process.getuid !== undefined && Number(stat.uid) !== process.getuid())) {
    throw new Error(`${what} is not a regular, single-link file owned by this user`);
  }
  if (privacy === "owner-private" && (Number(stat.mode) & 0o077) !== 0) {
    throw new Error(`${what} is reachable by other accounts (mode ${(Number(stat.mode) & 0o7777).toString(8)}); ` +
      "protected recovery only adopts a lock whose permissions it wrote itself");
  }
}

/** A directory this codebase created `0700` and still expects to be its own. */
export function assertPrivateDirectory(path: string, what: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0 || (process.getuid !== undefined && stat.uid !== process.getuid())) {
    throw new Error(`${what} is not an owner-private directory`);
  }
}

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
export function readOwnedRegularFile(path: string, what: string, privacy: Privacy): Buffer {
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
 * The digest of everything a descriptor addresses, read from absolute offsets.
 *
 * `readFileSync(fd)` consumes the descriptor's cursor, so a second call on the
 * same descriptor reads nothing. The lock is measured twice — once when it is
 * identified and again at the mutation boundary — so both reads have to be
 * repeatable and neither may disturb the other.
 */
export function descriptorDigest(descriptor: number): string {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = 0;
  for (;;) {
    const read = readSync(descriptor, buffer, 0, buffer.length, position);
    if (read === 0) break;
    hash.update(buffer.subarray(0, read));
    position += read;
  }
  return hash.digest("hex");
}

/**
 * One file's inode identity, encoded so nothing is lost on the way to JSON.
 *
 * Every 64-bit field is a decimal string: a device or inode number can exceed
 * `Number.MAX_SAFE_INTEGER`, and `ctimeNs` must keep every one of its nanosecond
 * digits. Truncating either would silently widen the set of files that compare
 * equal, which is the one thing this record exists to prevent.
 *
 * `ctimeNs` is the load-bearing field. `dev`/`ino` alone are recyclable — unlink
 * a file and the next `O_CREAT` can be handed the same inode — and an
 * unprivileged process can set `mtime` to anything it likes with `utimensat`,
 * but it cannot set `ctime`: every operation that would forge one moves it to
 * now. So an inode that carries the recorded `ctimeNs` is, short of a
 * coarse-granularity clock colliding, the same inode that was witnessed.
 */
export interface ProtectedLockIdentity {
  readonly device: string;
  readonly inode: string;
  readonly links: number;
  readonly uid: number;
  readonly gid: number;
  readonly mode: number;
  readonly sizeBytes: string;
  readonly ctimeNs: string;
  readonly mtimeNs: string;
}

interface BigIntFileStat {
  readonly dev: bigint; readonly ino: bigint; readonly nlink: bigint; readonly uid: bigint;
  readonly gid: bigint; readonly mode: bigint; readonly size: bigint;
  readonly ctimeNs: bigint; readonly mtimeNs: bigint;
}

export function lockIdentityOf(stat: BigIntFileStat): ProtectedLockIdentity {
  return Object.freeze({
    device: stat.dev.toString(), inode: stat.ino.toString(), links: Number(stat.nlink),
    uid: Number(stat.uid), gid: Number(stat.gid), mode: Number(stat.mode) & 0o7777,
    sizeBytes: stat.size.toString(), ctimeNs: stat.ctimeNs.toString(), mtimeNs: stat.mtimeNs.toString(),
  });
}

/** The first field on which two identities disagree, or null when every one agrees. */
export function lockIdentityDrift(actual: ProtectedLockIdentity, witnessed: ProtectedLockIdentity): string | null {
  for (const field of ["device", "inode", "links", "uid", "gid", "mode", "sizeBytes", "ctimeNs", "mtimeNs"] as const) {
    if (actual[field] !== witnessed[field]) return field;
  }
  return null;
}

/**
 * The durable proof that a specific inode, holding specific bytes, was created
 * as this publication's index lock by a specific controller.
 *
 * Matching bytes, owner-private permissions and a live AWSF lease do not
 * establish that the file now at `index.lock` is the one the interrupted writer
 * made. Git's lock is exclusive *by existence*, so an ordinary same-user
 * `git add` can create a replacement lock, hold it with no open descriptor, and
 * never touch the journal or the lease — and against a `head-published` tree it
 * can stage byte-identical content. Only a record written by the creator, at
 * creation, distinguishes the two, which is what this is.
 *
 * It is written after the lock's bytes are final and before anything is
 * published, so the identity it carries is the identity the file keeps until it
 * is renamed onto the index. A crash in the gap between creation and this
 * record leaves a lock nothing can attribute, and that must refuse.
 */
export interface ProtectedLockWitness {
  readonly schema: "awsf.protected-lock-witness/v1";
  readonly id: string;
  /** The witness this one replaces, so the chain for a consumption stays linear and a fork is corruption. */
  readonly supersedes: string | null;
  /** Which half of the protocol created the lock: the original transport, or a later reconciliation. */
  readonly writer: "host-commit" | "recovery";
  readonly grantId: string;
  readonly consumptionId: string;
  readonly candidateSha: string;
  readonly parentSha: string;
  readonly treeSha: string;
  readonly beforeIndexDigest: string;
  readonly stagedIndexDigest: string;
  readonly worktree: string;
  readonly worktreeGitDir: string;
  readonly indexPath: string;
  readonly lockPath: string;
  readonly contentDigest: string;
  readonly identity: ProtectedLockIdentity;
  /** The execution-lease holder that created it — the authority, named, not assumed. */
  readonly controller: { readonly leaseId: string; readonly pid: number; readonly startIdentity: string };
  readonly createdAt: string;
}

const HEX_64 = /^[a-f0-9]{64}$/u;
const HEX_40 = /^[a-f0-9]{40}$/u;
const DECIMAL = /^[0-9]+$/u;

/** Shape only. Whether a witness belongs to *this* publication is a separate, relational question. */
export function assertProtectedLockWitness(witness: ProtectedLockWitness): void {
  const identity = witness.identity as ProtectedLockIdentity | undefined;
  const controller = witness.controller as ProtectedLockWitness["controller"] | undefined;
  if (witness.schema !== "awsf.protected-lock-witness/v1" ||
      typeof witness.id !== "string" || witness.id.length === 0 ||
      !(witness.supersedes === null || (typeof witness.supersedes === "string" && witness.supersedes.length > 0)) ||
      (witness.writer !== "host-commit" && witness.writer !== "recovery") ||
      typeof witness.grantId !== "string" || typeof witness.consumptionId !== "string" ||
      !HEX_40.test(witness.candidateSha) || !HEX_40.test(witness.parentSha) || !HEX_40.test(witness.treeSha) ||
      !HEX_64.test(witness.beforeIndexDigest) || !HEX_64.test(witness.stagedIndexDigest) || !HEX_64.test(witness.contentDigest) ||
      typeof witness.worktree !== "string" || typeof witness.worktreeGitDir !== "string" ||
      typeof witness.indexPath !== "string" || typeof witness.lockPath !== "string" ||
      typeof witness.createdAt !== "string" || identity === undefined || controller === undefined ||
      !DECIMAL.test(identity.device) || !DECIMAL.test(identity.inode) || !DECIMAL.test(identity.sizeBytes) ||
      !DECIMAL.test(identity.ctimeNs) || !DECIMAL.test(identity.mtimeNs) ||
      !Number.isSafeInteger(identity.links) || !Number.isSafeInteger(identity.uid) ||
      !Number.isSafeInteger(identity.gid) || !Number.isSafeInteger(identity.mode) ||
      !Number.isSafeInteger(controller.pid) || controller.pid < 1 ||
      typeof controller.leaseId !== "string" || controller.leaseId.length === 0 ||
      typeof controller.startIdentity !== "string" || controller.startIdentity.length === 0) {
    throw new Error("protected index-lock witness is not a complete, well-formed creation record");
  }
}

/**
 * Measure the lock that is open on `descriptor` and bind that measurement to the
 * publication it was created for.
 *
 * Called with the lock's final bytes already written and synced, and before any
 * reference moves, so what it records is exactly what a later reconciliation
 * has to find.
 */
export function captureLockWitness(input: {
  readonly descriptor: number;
  readonly writer: ProtectedLockWitness["writer"];
  readonly supersedes: string | null;
  readonly lockPath: string;
  readonly indexPath: string;
  readonly worktree: string;
  readonly worktreeGitDir: string;
  readonly grantId: string;
  readonly consumptionId: string;
  readonly candidateSha: string;
  readonly parentSha: string;
  readonly treeSha: string;
  readonly beforeIndexDigest: string;
  readonly stagedIndexDigest: string;
  readonly controller: ProtectedLockWitness["controller"];
  readonly now: () => string;
}): ProtectedLockWitness {
  const stat = fstatSync(input.descriptor, { bigint: true });
  assertOwnedRegular(stat, "the Git index lock this publication created", "owner-private");
  const contentDigest = descriptorDigest(input.descriptor);
  if (contentDigest !== input.stagedIndexDigest) {
    throw new Error("the Git index lock this publication created does not hold the exact pre-staged index its intent pinned");
  }
  const witness: ProtectedLockWitness = Object.freeze({
    schema: "awsf.protected-lock-witness/v1" as const, id: randomUUID(), supersedes: input.supersedes, writer: input.writer,
    grantId: input.grantId, consumptionId: input.consumptionId, candidateSha: input.candidateSha,
    parentSha: input.parentSha, treeSha: input.treeSha, beforeIndexDigest: input.beforeIndexDigest,
    stagedIndexDigest: input.stagedIndexDigest, worktree: input.worktree, worktreeGitDir: input.worktreeGitDir,
    indexPath: input.indexPath, lockPath: input.lockPath, contentDigest,
    identity: lockIdentityOf(stat), controller: Object.freeze({ ...input.controller }), createdAt: input.now(),
  });
  assertProtectedLockWitness(witness);
  return witness;
}

/**
 * The last check before a rename installs this lock as the repository index.
 *
 * Three things are re-proved from the descriptor we have held open the whole
 * time: that the inode still carries the witnessed identity (so nothing rewrote
 * it in place — `ctimeNs` moves for any such write), that it still holds the
 * witnessed bytes, and that the *name* we are about to rename still resolves to
 * that same inode (so nothing swapped a different file into `lockPath`).
 *
 * All three refuse before the rename, so the index is never installed from a
 * file this publication cannot identify, and the file itself is left alone.
 *
 * **What this refusal does NOT undo, and must not claim to.** Two of the three
 * call sites reach it with the compare-and-swap already done — the transport
 * publishes HEAD before installing the index, and so does the recovery path for
 * an `unpublished` cut. Refusing here therefore leaves the repository in the
 * `head-published` state, which is precisely the state the reconciliation is
 * built to finish; it does not restore a pre-publication one. Only the recovery
 * `head-published` cut reaches this check with HEAD untouched by the caller.
 * The messages below say what is true of the index and the lock and stay silent
 * about HEAD, because there is no single true statement about HEAD here.
 *
 * **What it cannot close.** Linux has no rename-by-descriptor — `renameat2`
 * takes names, and `/proc/self/fd/N` re-resolves to the path rather than to the
 * inode — so a same-uid process can still swap `lockPath` in the instant between
 * this check and the `rename(2)` that follows. That residual is named, not
 * claimed away; the post-rename index digest check downstream turns it into
 * detected damage rather than silence, and it is the only mutation-boundary
 * guarantee this platform allows.
 */
const REFUSES_INSTALLATION =
  "this publication refuses to install it as the Git index; that file and the index are left exactly as they are";

export function assertWitnessedLockAtMutationBoundary(descriptor: number, path: string, witness: ProtectedLockWitness, what: string): void {
  const held = lockIdentityOf(fstatSync(descriptor, { bigint: true }));
  const drift = lockIdentityDrift(held, witness.identity);
  if (drift !== null) {
    throw new Error(`${what} no longer matches its durable creation witness (${drift} differs); ${REFUSES_INSTALLATION}`);
  }
  if (descriptorDigest(descriptor) !== witness.contentDigest) {
    throw new Error(`${what} no longer holds the bytes it was witnessed with; ${REFUSES_INSTALLATION}`);
  }
  const named = lstatSync(path, { bigint: true });
  if (named.dev !== BigInt(witness.identity.device) || named.ino !== BigInt(witness.identity.inode)) {
    throw new Error(`${what} at its own path is no longer the file this publication holds open; ${REFUSES_INSTALLATION}`);
  }
}
