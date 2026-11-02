import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");

export function repoRoot(): string {
  return REPO_ROOT;
}

// Default code coverage includes both module systems and JavaScript as well as
// TypeScript. Roots and explicit extension overrides remain the caller's policy;
// widening defaults cannot repair a fence that supplies its own narrower list.
export const CODE_EXTS = [".ts", ".tsx", ".vue", ".mts", ".cts", ".js", ".mjs", ".cjs"] as const;

export function walkFiles(dir: string, exts: readonly string[] = CODE_EXTS): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkFiles(full, exts));
    } else if (exts.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

export function relRepo(path: string): string {
  return relative(REPO_ROOT, path).split("\\").join("/");
}
