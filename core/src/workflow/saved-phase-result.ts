import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import { join } from "node:path";
import { recoveryDigest } from "../contracts/phase-recovery.ts";
import { captureChangeSet, changedPaths, runGit, type GitRunner } from "../git/changes.ts";
import { enforcePathPolicy } from "../policy/path-policy.ts";
import { resolvePermissionProfile } from "../policy/permission-profiles.ts";
import type { AgentDefinition } from "../config/schema.ts";
import type { SavedPhaseResult } from "../contracts/saved-phase-result.ts";
import type { PermissionSession } from "../policy/sandbox-broker.ts";

export class ResultSnapshotUnavailable extends Error {}

/** Complete physical worktree plus Git index. Links are observed, never followed into another tree. */
export async function savedResultTreeDigest(worktree: string, git: GitRunner): Promise<string> {
  const rows: unknown[] = [];
  let bytes = 0;
  const visit = async (path: string, label: string): Promise<void> => {
    const info = await lstat(path);
    if (rows.length > 100_000) throw new ResultSnapshotUnavailable("saved-result tree has too many entries");
    const metadata = { path: label, mode: info.mode, uid: info.uid, gid: info.gid, links: info.nlink };
    if (info.isSymbolicLink()) rows.push({ ...metadata, link: await readlink(path) });
    else if (info.isDirectory()) {
      rows.push({ ...metadata, directory: true });
      for (const name of (await readdir(path)).sort()) await visit(join(path, name), `${label}/${name}`);
    } else if (info.isFile()) {
      bytes += info.size;
      if (bytes > 64 * 1024 * 1024) throw new ResultSnapshotUnavailable("saved-result tree exceeds 64 MiB");
      rows.push({ ...metadata, digest: createHash("sha256").update(await readFile(path)).digest("hex") });
    } else throw new ResultSnapshotUnavailable("saved-result tree contains a special filesystem node");
  };
  await visit(worktree, "worktree");
  await visit(runGit(git, ["rev-parse", "--path-format=absolute", "--git-path", "index"]).trim(), "git-index");
  return recoveryDigest(rows);
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
