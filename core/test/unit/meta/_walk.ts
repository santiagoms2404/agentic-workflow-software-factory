import { readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");

export function repoRoot(): string {
  return REPO_ROOT;
}

// Default code coverage includes both module systems and JavaScript as well as
// TypeScript. Roots and explicit extension overrides remain the caller's policy;
// widening defaults cannot repair a fence that supplies its own narrower list.
export const CODE_EXTS = [".ts", ".tsx", ".vue", ".mts", ".cts", ".js", ".mjs", ".cjs"] as const;

/** Directories a walk skips by default. A fence that must read build output passes its own list. */
export const DEFAULT_PRUNE = ["node_modules", "dist", ".git"] as const;

export interface WalkOptions {
  /** Missing optional roots must be named by the caller; other read failures remain errors. */
  readonly allowMissingRoot?: boolean;
}

export function walkFiles(
  dir: string,
  exts: readonly string[] = CODE_EXTS,
  prune: readonly string[] = DEFAULT_PRUNE,
  options: WalkOptions = {},
): string[] {
  return walkDirectory(dir, exts, prune, true, options.allowMissingRoot === true);
}

function walkDirectory(
  dir: string,
  exts: readonly string[],
  prune: readonly string[],
  isRoot: boolean,
  allowMissingRoot: boolean,
): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (isRoot && allowMissingRoot && (error as NodeJS.ErrnoException).code === "ENOENT") return out;
    throw error;
  }
  for (const entry of entries) {
    if (prune.includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkDirectory(full, exts, prune, false, false));
    } else if (entry.isFile()) {
      if (exts.some((ext) => entry.name.endsWith(ext))) out.push(full);
    } else if (entry.isSymbolicLink()) {
      // Preserve the old stat-following behavior for links; ordinary directory entries need no stat call.
      const stat = statSync(full);
      if (stat.isDirectory()) out.push(...walkDirectory(full, exts, prune, false, false));
      else if (stat.isFile() && exts.some((ext) => entry.name.endsWith(ext))) out.push(full);
    } else {
      const stat = statSync(full);
      if (stat.isDirectory()) out.push(...walkDirectory(full, exts, prune, false, false));
      else if (stat.isFile() && exts.some((ext) => entry.name.endsWith(ext))) out.push(full);
    }
  }
  return out;
}

/** Candidate paths for extension-less imports, aligned with the walker's tracked source suffixes. */
export function sourceImportCandidates(base: string): string[] {
  if (extname(base) !== "") return [base];
  return [base, ...CODE_EXTS.map((ext) => `${base}${ext}`), ...CODE_EXTS.map((ext) => join(base, `index${ext}`))];
}

export function relRepo(path: string): string {
  return relative(REPO_ROOT, path).split("\\").join("/");
}
