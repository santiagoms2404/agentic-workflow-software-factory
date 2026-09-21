import { runGit, type GitRunner } from "./changes.ts";
import { assertExactProtectedPath, type ProtectedBlobDelta, type ProtectedFileBaseline } from "../contracts/protected-grant.ts";

export interface RawGitDelta {
  readonly path: string;
  readonly status: string;
  readonly beforeMode: string;
  readonly afterMode: string;
  readonly beforeBlob: string;
  readonly afterBlob: string;
}
const ZERO = "0".repeat(40);

/** Requires --raw --no-abbrev --no-renames -z. Never interprets quoted or line-count output. */
export function parseProtectedRawDiff(raw: string): readonly RawGitDelta[] {
  if (raw === "") return Object.freeze([]);
  if (!raw.endsWith("\0")) throw new Error("protected raw diff is truncated");
  const fields = raw.slice(0, -1).split("\0");
  if (fields.length % 2 !== 0) throw new Error("protected raw diff has incomplete path records");
  const rows: RawGitDelta[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < fields.length; index += 2) {
    const match = /^:([0-7]{6}) ([0-7]{6}) ([a-f0-9]{40}) ([a-f0-9]{40}) ([AMDT])$/u.exec(fields[index]!);
    const path = fields[index + 1]!;
    if (match === null || path.length === 0 || seen.has(path)) throw new Error("protected raw diff has unsupported or duplicate records");
    seen.add(path);
    rows.push(Object.freeze({ path, beforeMode: match[1]!, afterMode: match[2]!, beforeBlob: match[3]!, afterBlob: match[4]!, status: match[5]! }));
  }
  return Object.freeze(rows);
}

function assertOid(value: string): void {
  if (!/^[a-f0-9]{40}$/u.test(value)) throw new Error("protected delta requires an exact Git object id");
}

/** Reads immutable tree objects; staging/commit publication are separate host operations. */
export function protectedTreeDelta(git: GitRunner, parent: string, tree: string): readonly RawGitDelta[] {
  assertOid(parent); assertOid(tree);
  return parseProtectedRawDiff(runGit(git, ["diff", "--raw", "--no-abbrev", "--no-renames", "--no-ext-diff", "--no-textconv", "-z", parent, tree, "--"]));
}

/** Only exact, granted regular-file content changes can become a candidate-binding delta. */
export function protectedContentDeltas(rows: readonly RawGitDelta[], baselines: readonly ProtectedFileBaseline[]): readonly ProtectedBlobDelta[] {
  const result: ProtectedBlobDelta[] = [];
  for (const row of rows) {
    assertExactProtectedPath(row.path);
    assertOid(row.beforeBlob); assertOid(row.afterBlob);
    const baseline = baselines.find(file => file.path === row.path);
    if (baseline === undefined || row.beforeBlob !== (baseline.blob ?? ZERO) || row.beforeMode !== (baseline.mode ?? "000000") ||
        row.status !== (baseline.blob === null ? "A" : "M") || row.afterMode !== (baseline.mode ?? "100644") ||
        row.afterBlob === ZERO || row.afterBlob === row.beforeBlob) {
      throw new Error(`protected change is outside its exact content-only baseline: ${JSON.stringify(row.path)}`);
    }
    result.push(Object.freeze({ path: row.path, beforeBlob: baseline.blob, beforeMode: baseline.mode,
      afterBlob: row.afterBlob, afterMode: (baseline.mode ?? "100644") }));
  }
  return Object.freeze(result);
}
