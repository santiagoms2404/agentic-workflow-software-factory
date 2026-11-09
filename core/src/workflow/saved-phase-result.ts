import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import { join } from "node:path";
import { recoveryDigest } from "../contracts/phase-recovery.ts";
import { captureChangeSet, changedPaths, runGit, type GitRunner } from "../git/changes.ts";
import { enforcePathPolicy, normalizeRepositoryPath } from "../policy/path-policy.ts";
import { resolvePermissionProfile } from "../policy/permission-profiles.ts";
import type { AgentDefinition } from "../config/schema.ts";
import type { SavedPhaseResult } from "../contracts/saved-phase-result.ts";
import type { PermissionSession } from "../policy/sandbox-broker.ts";

export class ResultSnapshotUnavailable extends Error {}

/** The cumulative file-byte ceiling of one saved-result snapshot, seeded paths excluded. */
export const SAVED_RESULT_TREE_MAX_BYTES = 64 * 1024 * 1024;

export interface SavedResultTreeOptions {
  /** Tests only: a lower byte ceiling, so an over-limit tree needs no 64 MiB fixture. */
  readonly maxBytes?: number;
}

/**
 * Complete physical worktree plus Git index. Links are observed, never followed into another tree.
 *
 * B6-01: every `runtime.seed_paths` entry is excluded from the walk. The seeded
 * `node_modules` alone is about 137 MB, so including it put every reply over
 * the byte ceiling, after about 90 s of hashing on `/mnt/d`, and no result-ready
 * checkpoint was ever written. Excluding seeds loses nothing the digest exists
 * to prove: a seed is not agent output, and since H2 a phase cannot change it
 * unseen — it is bound read-only under bwrap, or size/mtime/inode fingerprinted
 * by `PermissionSession`, whose enforcement fails the phase on any change. The
 * excluded paths are themselves rows of the digest, so a producer and a
 * verifier that disagree about the seed list disagree about the digest too.
 * Every caller, production and recovery alike, passes the same
 * `config.runtime.seed_paths`; the empty default exists only for callers whose
 * configuration seeds nothing.
 */
export async function savedResultTreeDigest(worktree: string, git: GitRunner, seedPaths: readonly string[] = [],
  options: SavedResultTreeOptions = {}): Promise<string> {
  const maxBytes = options.maxBytes ?? SAVED_RESULT_TREE_MAX_BYTES;
  const seeded = new Set(seedPaths.map(normalizeRepositoryPath));
  const rows: unknown[] = [];
  let bytes = 0;
  const visit = async (path: string, label: string, relative: string | null): Promise<void> => {
    if (relative !== null && seeded.has(relative)) { rows.push({ path: label, seeded: true }); return; }
    const info = await lstat(path);
    if (rows.length > 100_000) throw new ResultSnapshotUnavailable("saved-result tree has too many entries");
    const metadata = { path: label, mode: info.mode, uid: info.uid, gid: info.gid, links: info.nlink };
    if (info.isSymbolicLink()) rows.push({ ...metadata, link: await readlink(path) });
    else if (info.isDirectory()) {
      rows.push({ ...metadata, directory: true });
      for (const name of (await readdir(path)).sort()) {
        await visit(join(path, name), `${label}/${name}`, relative === null ? null : relative === "" ? name : `${relative}/${name}`);
      }
    } else if (info.isFile()) {
      bytes += info.size;
      if (bytes > maxBytes) throw new ResultSnapshotUnavailable(`saved-result tree exceeds ${maxBytes} bytes outside runtime.seed_paths`);
      rows.push({ ...metadata, digest: createHash("sha256").update(await readFile(path)).digest("hex") });
    } else throw new ResultSnapshotUnavailable("saved-result tree contains a special filesystem node");
  };
  await visit(worktree, "worktree", "");
  await visit(runGit(git, ["rev-parse", "--path-format=absolute", "--git-path", "index"]).trim(), "git-index", null);
  return recoveryDigest(rows);
}

/**
 * The result-ready snapshot, or `null` after `onSkip` has durably recorded why
 * there is none.
 *
 * B6-01: a tree that cannot be snapshotted still skips the result-ready
 * checkpoint — the reply stays valid, only its crash reuse is lost — but the
 * skip used to be a bare `return`, so a paid reply silently became
 * unrecoverable and nothing said so. `onSkip` must finish before this returns
 * `null`; any other error still propagates.
 */
export async function savedResultTreeDigestOrSkip(worktree: string, git: GitRunner, seedPaths: readonly string[],
  onSkip: (reason: string) => Promise<void>, options: SavedResultTreeOptions = {}): Promise<string | null> {
  try { return await savedResultTreeDigest(worktree, git, seedPaths, options); }
  catch (error) {
    if (!(error instanceof ResultSnapshotUnavailable)) throw error;
    await onSkip(error.message);
    return null;
  }
}

/** No process capability is created. Enforcement uses the same profile and path-policy functions as PermissionSession. */
export function savedResultPermissions(saved: SavedPhaseResult, agent: AgentDefinition, worktree: string,
  protectedPaths: readonly string[]): Pick<PermissionSession, "before" | "sandboxBadge" | "enforce" | "sandbox" | "profile"> {
  const profile = resolvePermissionProfile(agent.tools.profile, agent.tools.allow, agent.writes);
  return { profile, before: saved.before, sandboxBadge: saved.sandboxBadge,
    sandbox: () => { throw new Error("saved-result validation has no process launch authority"); },
    enforce: () => {
      const mutations = changedPaths(saved.before, captureChangeSet(worktree));
      enforcePathPolicy(mutations, { writes: profile.writes, protectedPaths });
      return { changedPaths: mutations, sandboxBadge: saved.sandboxBadge };
    },
  };
}
